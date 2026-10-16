# Crypto Hot Tracker — Starter Plan (Day Trade Assist)

Goal: surface coins that are **hot right now** (volume + short-term uptrend momentum) so David can day-trade manually. **No auto-trading in v1.**

## Product
1. **Live ranking dashboard** — top hot coins, refreshed every 1–5 minutes.
2. **Alerts** — Telegram (primary) + optional WhatsApp later if easy; push when a coin newly enters Top N or spikes.

## Data sources (v1)
- **Binance Spot USDT pairs** (public REST + optional websocket later)
  - 24h ticker: price change %, quote volume
  - Recent klines (1m / 5m / 15m): short-window return, volume vs average
- Optional later: Bybit / OKX for cross-check; CoinGecko only for metadata (name, logo), not for day-trade timing.

## Hot score (v1 — simple, explainable)
For each USDT pair (exclude stables like USDC/FDUSD/TUSD, and maybe BTC/ETH if we want alts-only — decide at build):

| Signal | Weight (start) | Notes |
|--------|----------------|-------|
| 15m price return | 35% | positive only counts toward “uptrend” filter |
| 1h price return | 20% | |
| Volume spike (15m vol / 15m avg) | 30% | catch sudden interest |
| 24h quote volume rank | 15% | liquidity floor |

**Hard filters before ranking:**
- Min 24h quote volume (e.g. ≥ $5M USDT) — avoid illiquid traps
- 15m return > 0 (or > small threshold) — “uptrend now”
- Not on a denylist (user-editable)

Output: Top 20 table with score, price, %15m/%1h/%24h, vol spike, last updated.

## Dashboard (v1)
- Single page: Top 20 table + sparkline or mini spark if cheap
- Filters: min volume, timeframe focus (15m vs 1h), include/exclude majors
- Hosted simply (static HTML + backend poller, or small Node/Python app on box / Railway later)
- Cantonese / EN UI labels OK; numbers first

## Alerts (v1)
- Telegram bot: DM David when
  - Coin **enters Top 10** from outside
  - Volume spike ≥ X **and** 15m return ≥ Y
- Rate-limit: max N alerts / hour; digest mode optional
- WhatsApp: phase 2 unless Meta Business API already available

## Explicitly out of scope (v1)
- Auto buy/sell / exchange API keys for trading
- Complex ML / order-book microstructures
- Social (X/Reddit) — **phase 2** as a filter, not the core signal
- Portfolio PnL, tax, accounting

## Build phases
1. **Poller + score + CSV/JSON store** (prove ranking makes sense on live data)
2. **Dashboard** read-only
3. **Telegram alerts**
4. **Tune thresholds** with David for 1–2 weeks
5. **Phase 2:** social heat overlay, multi-exchange, paper-trade log

## Risks / honesty
- “Hot” ≠ guaranteed uptrend continuation; day trading is high risk.
- Exchange API rate limits / outages → need backoff + stale banner on UI.
- Thin coins can spike and dump; liquidity filter is mandatory.

## Success criteria for v1 ship
- Live Top 20 updates ≤ 5 min lag
- Telegram alert fires on a real Top-10 entry within 1–2 minutes of detection
- David can open dashboard on phone and decide entries manually

## Open decisions (defaults marked)
- Universe: all Binance USDT alts (**default**) vs include BTC/ETH
- Min 24h volume: **$5M** starting point
- Alert channel: **Telegram first**
- New dedicated bot vs keep under 安俞真: after plan sign-off

