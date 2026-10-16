"""Serve the read-only Crypto Hot Tracker dashboard (phase 2).

Serves project root so:
  /dashboard/          → dashboard/index.html
  /out/latest.json     → live rankings from the poller

Optional: --with-poller N also runs src.run_once in a loop every N seconds.

Usage:
  cd /workspace/crypto-hot-tracker
  python3 -m src.serve_dashboard
  python3 -m src.serve_dashboard --port 8765 --with-poller 180

Then open: http://127.0.0.1:8765/dashboard/
"""

from __future__ import annotations

import argparse
import functools
import http.server
import os
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = ROOT / "dashboard"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        # Keep terminal readable; still print errors
        if args and str(args[1]).startswith("2"):
            return
        super().log_message(fmt, *args)

    def end_headers(self) -> None:
        # Avoid stale JSON in browsers / mobile Safari
        path = self.path.split("?", 1)[0]
        if path.endswith(".json"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def _poller_loop(interval: int, stop: threading.Event) -> None:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    while not stop.is_set():
        print(f"[poller] running run_once …", flush=True)
        try:
            r = subprocess.run(
                [sys.executable, "-m", "src.run_once"],
                cwd=str(ROOT),
                env=env,
                check=False,
            )
            print(f"[poller] exit={r.returncode}; sleep {interval}s", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[poller] error: {exc}; sleep {interval}s", flush=True)
        # Interruptible sleep
        for _ in range(interval):
            if stop.is_set():
                break
            time.sleep(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Crypto Hot Tracker dashboard")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port (default 8765)")
    parser.add_argument(
        "--with-poller",
        type=int,
        metavar="SEC",
        default=0,
        help="Also run ranking poller every SEC seconds (e.g. 180)",
    )
    args = parser.parse_args()

    if not DASHBOARD.is_dir():
        print(f"Missing dashboard at {DASHBOARD}", file=sys.stderr)
        return 1

    os.chdir(ROOT)
    handler = functools.partial(QuietHandler, directory=str(ROOT))

    stop = threading.Event()
    poller_thread = None
    if args.with_poller and args.with_poller > 0:
        poller_thread = threading.Thread(
            target=_poller_loop,
            args=(args.with_poller, stop),
            name="cht-poller",
            daemon=True,
        )
        poller_thread.start()
        print(f"[serve] poller enabled every {args.with_poller}s", flush=True)

    # Allow reuse after Ctrl-C
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((args.host, args.port), handler) as httpd:
        url = f"http://{args.host}:{args.port}/dashboard/"
        print(f"[serve] root={ROOT}", flush=True)
        print(f"[serve] open {url}", flush=True)
        print(f"[serve] JSON  http://{args.host}:{args.port}/out/latest.json", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[serve] shutting down…", flush=True)
        finally:
            stop.set()
            httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
