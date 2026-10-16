# Crypto Hot Tracker (v1)

Surface Binance Spot USDT coins that are **hot right now** (volume spike + short-term uptrend) so you can day-trade **manually**.

**No auto-trading. No exchange API keys.**

## What it does

### Phase 1 — Poller + score

1. Poll Binance public REST (`/api/v3/ticker/24hr` + `/api/v3/klines`)
2. Hard-filter: 24h quote volume ≥ $5M, 15m return > 0, exclude stables + denylist
3. Score and write **Top 20** → `out/latest.json` + `out/latest.csv` (+ timestamped snapshot)

### Phase 2 — Read-only dashboard

Single-page UI that loads `out/latest.json`, auto-refreshes every ~90s, phone-friendly, client-side filters. **No Telegram yet.**

## Hot score (explainable)

Within the filtered universe, each component is **min–max normalized** to 0–1, then:

| Component | Weight | Source |
|-----------|--------|--------|
| 15m price return | 35% | 15m klines: `(close_now − close_1_ago) / close_1_ago` |
| 1h price return | 20% | 15m klines: `(close_now − close_4_ago) / close_4_ago` |
| Volume spike | 30% | last 15m quote vol / mean of prior ~16 windows |
| 24h quote volume | 15% | ticker `quoteVolume` (liquidity) |

`score = 100 × Σ (weight × norm)`

Hard filters run **before** ranking (illiquid / non-uptrend coins never get a score).

## Setup

Python 3.10+ recommended. **No pip packages required** (stdlib only).

```bash
cd /workspace/crypto-hot-tracker
```

Optional: edit `config.json` (`min_quote_volume_usdt`, `top_n`, `weights`) or add bases to `denylist.txt`.

## Run poller once (live Binance)

```bash
cd /workspace/crypto-hot-tracker
python3 -m src.run_once
```

Outputs:

- `out/latest.json` — Top 20 + metadata
- `out/latest.csv` — same rows, spreadsheet-friendly
- `out/snapshots/hot_<timestamp>.json|.csv` — immutable copy of that run

## Optional poller loop

```bash
python3 -m src.run_once --loop 180   # every 3 minutes
```

## Dashboard (phase 2)

### Recommended: small server (+ optional poller)

```bash
cd /workspace/crypto-hot-tracker
python3 -m src.run_once                  # ensure latest.json exists
python3 -m src.serve_dashboard           # http://127.0.0.1:8765/dashboard/
```

With background poller every 3 minutes:

```bash
python3 -m src.serve_dashboard --with-poller 180
```

Open on this machine / phone on same LAN (if you bind broader):

| What | URL |
|------|-----|
| Dashboard | http://127.0.0.1:8765/dashboard/ |
| Raw JSON | http://127.0.0.1:8765/out/latest.json |

Bind options:

```bash
python3 -m src.serve_dashboard --host 0.0.0.0 --port 8765
```

### Alternative: plain http.server

```bash
cd /workspace/crypto-hot-tracker
python3 -m http.server 8765
# then open http://127.0.0.1:8765/dashboard/
```

### Dashboard behaviour

- Polls `out/latest.json` every **90s** (no full page reload)
- Shows **last updated** age; **stale banner** if data older than **10 minutes**
- Client filters (do not change poller):
  - Min 24h volume (USDT)
  - Exclude majors (BTC / ETH)
  - Exclude gold proxies (PAXG / XAUT) — on by default
- Green / red % columns; symbol links to Binance spot trade page
- Filter prefs saved in browser `localStorage`

## Config knobs (`config.json`)

| Key | Default | Meaning |
|-----|---------|---------|
| `min_quote_volume_usdt` | `5000000` | Liquidity floor |
| `top_n` | `20` | Rows written |
| `include_majors` | `true` | Allow BTC/ETH if they pass filters |
| `stable_bases` | USDC, FDUSD, … | Excluded quote/base noise |
| `denylist_file` | `denylist.txt` | Extra user exclusions (base symbols) |

## Universe decision (v1)

- Default: **all Binance USDT pairs** that pass filters, **including BTC/ETH** if they qualify.
- Stables and fiat-pegged bases are excluded via `stable_bases`.
- Prefer alts-heavy ranking in practice (majors rarely dominate volume-spike + 15m uptrend together).

## Not in v1 yet

- Telegram / WhatsApp alerts (phase 3)
- Auto orders / trading keys
- Social heat (X/Reddit)

## Suggested next

Phase 3: Telegram alerts on Top-10 entry / volume+return spike, with rate limits.
