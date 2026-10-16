"""Hot score: volume spike + short-term uptrend momentum.

Weights (config-driven, defaults):
  - 15m price return: 35%
  - 1h price return:  20%
  - Volume spike:     30%  (last 15m vol / mean of prior lookback windows)
  - 24h quote vol rank: 15%

Hard filters applied before ranking (see run_once.py).
Score = 100 * sum(weight_i * minmax_norm(component_i)) within filtered universe.
"""

from __future__ import annotations

from typing import Any


def _f(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def parse_kline_metrics(
    klines: list[list[Any]],
    vol_spike_lookback: int = 16,
) -> dict[str, float] | None:
    """Derive pct_15m, pct_1h, vol_spike from 15m klines.

    Candle layout (Binance):
      [0] open time, [1] open, [2] high, [3] low, [4] close,
      [5] volume, [6] close time, [7] quote volume, ...

    Uses the currently forming candle as "now" close/volume.
    pct_15m: (close_now - close_1_ago) / close_1_ago
    pct_1h:  (close_now - close_4_ago) / close_4_ago   (4 * 15m = 1h)
    vol_spike: quote_vol_now / mean(quote_vol of prior lookback completed candles)
    """
    if not klines or len(klines) < 5:
        return None

    closes = [_f(k[4]) for k in klines]
    quote_vols = [_f(k[7]) for k in klines]

    c_now = closes[-1]
    c_15m = closes[-2]
    c_1h = closes[-5]
    if c_15m <= 0 or c_1h <= 0 or c_now <= 0:
        return None

    pct_15m = (c_now - c_15m) / c_15m * 100.0
    pct_1h = (c_now - c_1h) / c_1h * 100.0

    # Prior completed candles only (exclude forming last)
    prior = quote_vols[-(vol_spike_lookback + 1) : -1]
    if len(prior) < max(4, vol_spike_lookback // 2):
        prior = quote_vols[:-1]
    if not prior:
        return None
    avg_vol = sum(prior) / len(prior)
    vol_now = quote_vols[-1]
    if avg_vol <= 0:
        vol_spike = 0.0
    else:
        vol_spike = vol_now / avg_vol

    return {
        "pct_15m": pct_15m,
        "pct_1h": pct_1h,
        "vol_spike": vol_spike,
        "price": c_now,
    }


def _minmax(values: list[float]) -> list[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi <= lo:
        return [0.5] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def score_candidates(
    rows: list[dict[str, Any]],
    weights: dict[str, float],
) -> list[dict[str, Any]]:
    """Add normalized component scores and final hot score; sort desc."""
    if not rows:
        return []

    w15 = float(weights.get("pct_15m", 0.35))
    w1h = float(weights.get("pct_1h", 0.20))
    wvs = float(weights.get("vol_spike", 0.30))
    wqv = float(weights.get("quote_vol_rank", 0.15))

    n15 = _minmax([float(r["pct_15m"]) for r in rows])
    n1h = _minmax([float(r["pct_1h"]) for r in rows])
    nvs = _minmax([float(r["vol_spike"]) for r in rows])
    # Higher 24h quote volume → higher rank score
    nqv = _minmax([float(r["quote_volume_24h"]) for r in rows])

    scored: list[dict[str, Any]] = []
    for i, r in enumerate(rows):
        score = 100.0 * (w15 * n15[i] + w1h * n1h[i] + wvs * nvs[i] + wqv * nqv[i])
        out = dict(r)
        out["score"] = round(score, 4)
        out["norm_pct_15m"] = round(n15[i], 4)
        out["norm_pct_1h"] = round(n1h[i], 4)
        out["norm_vol_spike"] = round(nvs[i], 4)
        out["norm_quote_vol"] = round(nqv[i], 4)
        scored.append(out)

    scored.sort(key=lambda x: (-x["score"], -x["quote_volume_24h"]))
    return scored
