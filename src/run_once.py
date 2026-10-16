#!/usr/bin/env python3
"""One-shot Binance Hot Tracker run.

Fetches live Spot USDT data, applies hard filters, scores, writes Top N
to out/latest.json, out/latest.csv, and a timestamped snapshot.

Usage:
  python3 -m src.run_once
  python3 -m src.run_once --loop 180   # optional: every N seconds
  python3 src/run_once.py             # also works from project root
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow `python3 src/run_once.py` from project root
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.binance_client import BinanceClient
from src.scorer import parse_kline_metrics, score_candidates


OUT_FIELDS = [
    "rank",
    "symbol",
    "score",
    "price",
    "pct_15m",
    "pct_1h",
    "pct_24h",
    "vol_spike",
    "quote_volume_24h",
    "updated_at",
]


def project_root() -> Path:
    return _ROOT


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_denylist(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip().upper()
        if not s or s.startswith("#"):
            continue
        out.add(s)
    return out


def base_asset(symbol: str, quote: str = "USDT") -> str:
    if symbol.endswith(quote):
        return symbol[: -len(quote)]
    return symbol


def hk_now_iso() -> str:
    # Asia/Hong_Kong = UTC+8 fixed (no DST)
    from datetime import timedelta

    hk = timezone(timedelta(hours=8), name="HKT")
    return datetime.now(hk).isoformat(timespec="seconds")


def filter_universe(
    tickers: list[dict[str, Any]],
    cfg: dict[str, Any],
    denylist: set[str],
) -> list[dict[str, Any]]:
    quote = cfg.get("quote_asset", "USDT")
    min_vol = float(cfg.get("min_quote_volume_usdt", 5_000_000))
    stables = {s.upper() for s in cfg.get("stable_bases", [])}
    include_majors = bool(cfg.get("include_majors", True))

    rows: list[dict[str, Any]] = []
    for t in tickers:
        sym = str(t.get("symbol", ""))
        if not sym.endswith(quote):
            continue
        base = base_asset(sym, quote)
        if base in stables or base in denylist:
            continue
        if not include_majors and base in {"BTC", "ETH"}:
            continue
        # Skip leveraged tokens / weird suffixes often noisy
        if base.endswith(("UP", "DOWN", "BULL", "BEAR")) and len(base) > 3:
            # Keep real coins like LINK; skip BTCUP-style if present on spot
            if base.endswith(("UP", "DOWN")) and base[:-2] in {"BTC", "ETH", "BNB", "ADA", "XRP"}:
                continue

        qv = float(t.get("quoteVolume") or 0)
        if qv < min_vol:
            continue

        rows.append(
            {
                "symbol": sym,
                "base": base,
                "price": float(t.get("lastPrice") or 0),
                "pct_24h": float(t.get("priceChangePercent") or 0),
                "quote_volume_24h": qv,
            }
        )
    return rows


def enrich_with_klines(
    client: BinanceClient,
    candidates: list[dict[str, Any]],
    cfg: dict[str, Any],
) -> list[dict[str, Any]]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    interval = cfg.get("klines_interval", "15m")
    limit = int(cfg.get("klines_limit", 20))
    lookback = int(cfg.get("vol_spike_lookback", 16))
    workers = max(1, int(cfg.get("klines_workers", 8)))

    def one(c: dict[str, Any]) -> dict[str, Any] | None:
        kl = client.klines(c["symbol"], interval=interval, limit=limit)
        m = parse_kline_metrics(kl, vol_spike_lookback=lookback)
        if m is None or m["pct_15m"] <= 0:
            return None
        row = dict(c)
        row["pct_15m"] = round(m["pct_15m"], 4)
        row["pct_1h"] = round(m["pct_1h"], 4)
        row["vol_spike"] = round(m["vol_spike"], 4)
        row["price"] = float(row.get("price") or m["price"])
        return row

    enriched: list[dict[str, Any]] = []
    errors = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(one, c): c["symbol"] for c in candidates}
        for fut in as_completed(futs):
            sym = futs[fut]
            try:
                row = fut.result()
                if row is not None:
                    enriched.append(row)
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"[warn] klines failed for {sym}: {e}", file=sys.stderr)
    if errors:
        print(f"[warn] klines errors total: {errors}", file=sys.stderr)
    return enriched


def write_outputs(
    ranked: list[dict[str, Any]],
    top_n: int,
    out_dir: Path,
    updated_at: str,
    weights: dict[str, float] | None = None,
) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    snap_dir = out_dir / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)

    top = ranked[:top_n]
    table = []
    for i, r in enumerate(top, start=1):
        table.append(
            {
                "rank": i,
                "symbol": r["symbol"],
                "score": r["score"],
                "price": r["price"],
                "pct_15m": r["pct_15m"],
                "pct_1h": r["pct_1h"],
                "pct_24h": round(float(r["pct_24h"]), 4),
                "vol_spike": r["vol_spike"],
                "quote_volume_24h": round(float(r["quote_volume_24h"]), 2),
                "updated_at": updated_at,
            }
        )

    payload = {
        "updated_at": updated_at,
        "top_n": top_n,
        "count": len(table),
        "universe_scored": len(ranked),
        "score_formula": {
            "weights": weights or {
                "pct_15m": 0.35,
                "pct_1h": 0.20,
                "vol_spike": 0.30,
                "quote_vol_rank": 0.15,
            },
            "normalization": "minmax within filtered universe",
            "hard_filters": [
                "quote_volume_24h >= min_quote_volume_usdt",
                "pct_15m > 0",
                "exclude stable_bases + denylist",
            ],
        },
        "rows": table,
    }

    latest_json = out_dir / "latest.json"
    latest_csv = out_dir / "latest.csv"
    stamp = updated_at.replace(":", "").replace("+", "_")
    snap_json = snap_dir / f"hot_{stamp}.json"
    snap_csv = snap_dir / f"hot_{stamp}.csv"

    for path in (latest_json, snap_json):
        with path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")

    for path in (latest_csv, snap_csv):
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
            w.writeheader()
            w.writerows(table)

    return {
        "latest_json": latest_json,
        "latest_csv": latest_csv,
        "snap_json": snap_json,
        "snap_csv": snap_csv,
    }


def run_once(cfg: dict[str, Any], root: Path) -> list[dict[str, Any]]:
    client = BinanceClient(
        base_url=cfg.get("binance_base_url", "https://api.binance.com"),
        timeout_sec=float(cfg.get("request_timeout_sec", 15)),
        max_retries=int(cfg.get("max_retries", 4)),
        backoff_base_sec=float(cfg.get("backoff_base_sec", 1.0)),
    )
    denylist = load_denylist(root / cfg.get("denylist_file", "denylist.txt"))

    print("[1/4] Fetching 24h tickers…")
    tickers = client.ticker_24hr()
    candidates = filter_universe(tickers, cfg, denylist)
    print(f"      {len(tickers)} tickers → {len(candidates)} after volume/stable/denylist filters")

    print("[2/4] Fetching 15m klines + momentum filters…")
    enriched = enrich_with_klines(client, candidates, cfg)
    print(f"      {len(enriched)} candidates with pct_15m > 0")

    print("[3/4] Scoring…")
    ranked = score_candidates(enriched, cfg.get("weights", {}))
    updated_at = hk_now_iso()
    for r in ranked:
        r["updated_at"] = updated_at

    top_n = int(cfg.get("top_n", 20))
    print(f"[4/4] Writing Top {top_n}…")
    paths = write_outputs(ranked, top_n, root / "out", updated_at, cfg.get("weights"))
    print(f"      {paths['latest_json']}")
    print(f"      {paths['latest_csv']}")
    print(f"      snapshot: {paths['snap_json'].name}")

    # Compact preview
    print("\n=== Top 10 ===")
    hdr = f"{'#':>2} {'SYMBOL':<12} {'SCORE':>7} {'PX':>12} {'15m%':>8} {'1h%':>8} {'24h%':>8} {'VSpike':>7} {'Vol24h$':>14}"
    print(hdr)
    for row in ranked[:10]:
        print(
            f"{ranked.index(row)+1:2d} {row['symbol']:<12} {row['score']:7.2f} "
            f"{row['price']:12.6g} {row['pct_15m']:7.2f}% {row['pct_1h']:7.2f}% "
            f"{float(row['pct_24h']):7.2f}% {row['vol_spike']:7.2f} "
            f"{row['quote_volume_24h']:14,.0f}"
        )
    return ranked


def main() -> int:
    parser = argparse.ArgumentParser(description="Crypto Hot Tracker — one-shot / loop")
    parser.add_argument(
        "--config",
        default=str(project_root() / "config.json"),
        help="Path to config.json",
    )
    parser.add_argument(
        "--loop",
        type=int,
        default=0,
        metavar="SECONDS",
        help="If >0, re-run every SECONDS (e.g. 180). Ctrl+C to stop.",
    )
    args = parser.parse_args()
    root = project_root()
    cfg = load_config(Path(args.config))

    if args.loop and args.loop > 0:
        print(f"Loop mode: every {args.loop}s (Ctrl+C to stop)")
        while True:
            try:
                run_once(cfg, root)
            except Exception as e:
                print(f"[error] run failed: {e}", file=sys.stderr)
            print(f"Sleeping {args.loop}s…\n")
            time.sleep(args.loop)
    else:
        run_once(cfg, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
