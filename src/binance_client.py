"""Binance Spot public REST client with retries and backoff.

No API keys. Read-only market data only.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class BinanceClient:
    def __init__(
        self,
        base_url: str = "https://api.binance.com",
        timeout_sec: float = 15.0,
        max_retries: int = 4,
        backoff_base_sec: float = 1.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries
        self.backoff_base_sec = backoff_base_sec

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        qs = urllib.parse.urlencode(params or {})
        url = f"{self.base_url}{path}"
        if qs:
            url = f"{url}?{qs}"

        last_err: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "crypto-hot-tracker/1.0", "Accept": "application/json"},
                    method="GET",
                )
                with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                    body = resp.read().decode("utf-8")
                    return json.loads(body)
            except urllib.error.HTTPError as e:
                last_err = e
                # 418/429 = rate limit; 5xx = server; retry with backoff
                if e.code in (418, 429, 500, 502, 503, 504) and attempt < self.max_retries:
                    sleep_s = self.backoff_base_sec * (2**attempt)
                    # Respect Retry-After if present
                    ra = e.headers.get("Retry-After") if e.headers else None
                    if ra:
                        try:
                            sleep_s = max(sleep_s, float(ra))
                        except ValueError:
                            pass
                    time.sleep(sleep_s)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                last_err = e
                if attempt < self.max_retries:
                    time.sleep(self.backoff_base_sec * (2**attempt))
                    continue
                raise
        raise RuntimeError(f"Binance GET failed after retries: {last_err}")

    def ticker_24hr(self) -> list[dict[str, Any]]:
        """All symbols 24h ticker stats (weight ~40)."""
        data = self._get("/api/v3/ticker/24hr")
        if not isinstance(data, list):
            raise TypeError("Expected list from /api/v3/ticker/24hr")
        return data

    def klines(
        self,
        symbol: str,
        interval: str = "15m",
        limit: int = 20,
    ) -> list[list[Any]]:
        """OHLCV klines for one symbol (weight 1–2 depending on limit)."""
        data = self._get(
            "/api/v3/klines",
            {"symbol": symbol, "interval": interval, "limit": limit},
        )
        if not isinstance(data, list):
            raise TypeError(f"Expected list from /api/v3/klines for {symbol}")
        return data
