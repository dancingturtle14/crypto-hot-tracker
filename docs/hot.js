/* Crypto Hot Tracker — client-side scorer (mirrors src/scorer.py + run_once.py). Read-only, no keys, no orders. */
(function (root) {
  const CFG = {"binance_base_url": "https://api.binance.com", "quote_asset": "USDT", "min_quote_volume_usdt": 5000000, "top_n": 20, "klines_interval": "15m", "klines_limit": 24, "vol_spike_lookback": 16, "weights": {"pct_15m": 0.35, "pct_1h": 0.2, "vol_spike": 0.3, "quote_vol_rank": 0.15}, "stable_bases": ["USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "USDE", "USD1", "EUR", "AEUR", "EURI", "GBP", "AUD", "TRY", "BRL", "BIDR", "PAX", "UST", "USTC", "USDD", "GUSD", "SUSD", "FRAX", "LUSD", "PYUSD", "USDJ", "XUSD", "BFUSD", "U", "RLUSD", "RWUSD"], "denylist_file": "denylist.txt", "request_timeout_sec": 15, "max_retries": 4, "backoff_base_sec": 1.0, "klines_batch_pause_sec": 0.05, "include_majors": true, "klines_workers": 8};
  const DENY = new Set([]);
  const BASES = ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com"];
  let goodBase = null;

  async function getJson(path) {
    const order = goodBase ? [goodBase].concat(BASES.filter(b => b !== goodBase)) : BASES;
    let lastErr;
    for (const b of order) {
      try {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const t = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
        const res = await fetch(b + path, ctl ? { signal: ctl.signal, cache: "no-store" } : {});
        if (t) clearTimeout(t);
        if (!res.ok) { lastErr = "HTTP " + res.status + " " + b; if (res.status === 429 || res.status === 418) continue; continue; }
        const d = await res.json();
        goodBase = b;
        return d;
      } catch (e) { lastErr = String(e && e.message || e) + " @ " + b; }
    }
    throw new Error(lastErr || "all Binance endpoints failed");
  }

  function filterUniverse(tickers) {
    const q = CFG.quote_asset, stables = new Set(CFG.stable_bases.map(s => s.toUpperCase()));
    const out = [];
    for (const t of tickers) {
      const sym = String(t.symbol || "");
      if (!sym.endsWith(q)) continue;
      const base = sym.slice(0, -q.length);
      if (stables.has(base) || DENY.has(base)) continue;
      if (!CFG.include_majors && (base === "BTC" || base === "ETH")) continue;
      if ((base.endsWith("UP") || base.endsWith("DOWN")) && base.length > 3 &&
          ["BTC","ETH","BNB","ADA","XRP"].includes(base.replace(/(UP|DOWN)$/, ""))) continue;
      const qv = parseFloat(t.quoteVolume) || 0;
      if (qv < CFG.min_quote_volume_usdt) continue;
      out.push({ symbol: sym, base, price: parseFloat(t.lastPrice) || 0, pct_24h: parseFloat(t.priceChangePercent) || 0, quote_volume_24h: qv });
    }
    return out;
  }

  function klineMetrics(kl, lb) {
    if (!kl || kl.length < 5) return null;
    const c = kl.map(k => parseFloat(k[4]) || 0), v = kl.map(k => parseFloat(k[7]) || 0);
    const now = c[c.length - 1], c15 = c[c.length - 2], c1h = c[c.length - 5];
    if (c15 <= 0 || c1h <= 0 || now <= 0) return null;
    let prior = v.slice(-(lb + 1), -1);
    if (prior.length < Math.max(4, Math.floor(lb / 2))) prior = v.slice(0, -1);
    if (!prior.length) return null;
    const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
    const lows = kl.map(k => parseFloat(k[3]) || 0);
    return { closes: c, low_1h: Math.min(...lows.slice(-4)), pct_15m: (now - c15) / c15 * 100, pct_1h: (now - c1h) / c1h * 100, vol_spike: avg > 0 ? v[v.length - 1] / avg : 0, price: now };
  }

  function minmax(a) {
    const lo = Math.min(...a), hi = Math.max(...a);
    return hi <= lo ? a.map(() => 0.5) : a.map(x => (x - lo) / (hi - lo));
  }

  function score(rows) {
    if (!rows.length) return [];
    const w = CFG.weights;
    const n15 = minmax(rows.map(r => r.pct_15m)), n1 = minmax(rows.map(r => r.pct_1h)),
          nv = minmax(rows.map(r => r.vol_spike)), nq = minmax(rows.map(r => r.quote_volume_24h));
    return rows.map((r, i) => Object.assign({}, r, {
      score: 100 * (w.pct_15m * n15[i] + w.pct_1h * n1[i] + w.vol_spike * nv[i] + w.quote_vol_rank * nq[i])
    })).sort((a, b) => b.score - a.score || b.quote_volume_24h - a.quote_volume_24h);
  }

  async function pool(items, n, fn) {
    const res = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { res[k] = await fn(items[k]); } catch (e) { res[k] = null; } }
    }));
    return res;
  }

  async function compute(opts) {
    opts = opts || {};
    const tickers = await getJson("/api/v3/ticker/24hr");
    const cands = filterUniverse(tickers);
    const lb = CFG.vol_spike_lookback;
    let errors = 0;
    const all = (await pool(cands, CFG.klines_workers || 8, async c => {
      let kl;
      try { kl = await getJson("/api/v3/klines?symbol=" + c.symbol + "&interval=" + CFG.klines_interval + "&limit=" + CFG.klines_limit); }
      catch (e) { errors++; return null; }
      const m = klineMetrics(kl, lb);
      if (!m) return null;
      return Object.assign({}, c, { pct_15m: m.pct_15m, pct_1h: m.pct_1h, vol_spike: m.vol_spike, closes: m.closes, low_1h: m.low_1h, price: c.price || m.price });
    })).filter(Boolean);
    const measured = all.length, rising15 = all.filter(r => r.pct_15m > 0).length, rising1h = all.filter(r => r.pct_1h > 0).length;
    const enriched = all.filter(r => r.pct_15m > 0);
    const scored = score(enriched);
    const topN = opts.topN || CFG.top_n;
    return {
      updated_at: new Date().toISOString(), top_n: topN, universe_scored: scored.length,
      candidates: cands.length, measured, rising15, rising1h, kline_errors: errors, source: goodBase,
      rows: scored.slice(0, topN), count: Math.min(topN, scored.length)
    };
  }

  function classify(r) {
    if (r.pct_24h < -15 || r.vol_spike < 1 || r.pct_1h < 0) return "warn";
    if (r.pct_1h >= 2 && r.vol_spike >= 1.5) return "hot";
    return "up";
  }
  function reason(r) {
    const f = x => (x >= 0 ? "升" : "跌") + Math.abs(x).toFixed(1) + "%";
    let s = "過去1小時" + f(r.pct_1h) + "，最近15分鐘" + f(r.pct_15m) + "，成交量係平時" + r.vol_spike.toFixed(1) + "倍";
    if (r.pct_24h < -15) s += "；但24小時仍" + f(r.pct_24h) + "，小心假突破";
    else if (r.vol_spike < 1) s += "；成交量未跟上，升勢未確認";
    else if (r.pct_1h < 0) s += "；但1小時仍係跌緊，可能只係短暫反彈";
    return s + "。";
  }
  function mood(d) {
    const p = d.measured ? d.rising1h / d.measured : 0;
    return { ratio: p, level: p >= 0.6 ? "strong" : p >= 0.4 ? "neutral" : "weak" };
  }
  function corr(a, b) {
    const ra = [], rb = [];
    const n = Math.min(a.length, b.length), oa = a.length - n, ob = b.length - n;
    for (let i = 1; i < n; i++) { ra.push(a[oa+i] / a[oa+i-1] - 1); rb.push(b[ob+i] / b[ob+i-1] - 1); }
    const m = ra.length; if (m < 4) return 0;
    const ma = ra.reduce((x, y) => x + y, 0) / m, mb = rb.reduce((x, y) => x + y, 0) / m;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < m; i++) { const da = ra[i] - ma, db = rb[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }
  function fetchKlines(symbol, limit) {
    return getJson("/api/v3/klines?symbol=" + symbol + "&interval=15m&limit=" + limit);
  }
  const api = { corr, fetchKlines, classify, reason, mood, compute, filterUniverse, klineMetrics, score, CFG };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.HotTracker = api;
})(typeof window !== "undefined" ? window : globalThis);
