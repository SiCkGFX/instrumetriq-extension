#!/usr/bin/env python3
"""Capture popup screenshots from the generated harness.

    python3 tools/screenshot/make_harness.py
    python3 tools/screenshot/shoot.py --list
    python3 tools/screenshot/shoot.py                    # every shot in SHOTS
    python3 tools/screenshot/shoot.py --only card-busy

Needs a chromium binary. Set CHROMIUM= if it is not on PATH.

Captures at 400x600 with a 2x device scale factor, so the raw PNG is 800x1200
and stays sharp when composed onto a 1280x800 store canvas by compose.py.
"""

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
OUT = HERE / "out"

POPUP_W, POPUP_H = 400, 600
SCALE = 2

# name -> query string for harness.html. Each is one store screenshot candidate.
SHOTS = {
    "card":         "theme=dark",
    "card-light":   "theme=light",
    "how-it-works": "theme=dark&panel=methodology",
    "onboarding":   "theme=dark&panel=onboarding",
    "picker":       "theme=dark&panel=picker&pro=1",
    "chart-cycle":  "theme=dark&tf=cycle",
    "chart-week":   "theme=dark&tf=week",
    "sites":        "theme=dark&panel=sites",
    "privacy":      "theme=dark&panel=privacy",
}


def find_chromium():
    env = os.environ.get("CHROMIUM")
    if env and shutil.which(env):
        return shutil.which(env)
    for name in ("chromium", "chromium-browser", "google-chrome",
                 "google-chrome-stable", "chrome"):
        p = shutil.which(name)
        if p:
            return p
    return None


def shoot(binary, name, query, coin):
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{name}.png"
    q = query + (f"&coin={coin}" if coin else "")
    url = (BUILD / "harness.html").as_uri() + "?" + q
    cmd = [
        binary,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--force-device-scale-factor=" + str(SCALE),
        f"--window-size={POPUP_W},{POPUP_H}",
        # The shim sets data-shot-ready after it applies the scenario. A fixed
        # delay is cruder but chromium's --screenshot has no wait-for-selector,
        # and the popup renders from already-seeded storage so there is no
        # network to wait on.
        "--virtual-time-budget=3000",
        f"--screenshot={target}",
        url,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    ok = target.exists() and target.stat().st_size > 0
    return ok, target, (r.stderr or "").strip().splitlines()[-1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="capture a single named shot")
    ap.add_argument("--coin", default="", help="force a coin symbol")
    ap.add_argument("--list", action="store_true", help="list shot names and exit")
    args = ap.parse_args()

    if args.list:
        for k, v in SHOTS.items():
            print(f"  {k:<14} {v}")
        return

    if not (BUILD / "harness.html").exists():
        sys.exit("no harness. Run: python3 tools/screenshot/make_harness.py")

    binary = find_chromium()
    if not binary:
        sys.exit(
            "No chromium found.\n"
            "  Install:  sudo apt install -y chromium\n"
            "  Or point at one:  CHROMIUM=/path/to/chrome python3 tools/screenshot/shoot.py"
        )
    print(f"  using {binary}")

    todo = {args.only: SHOTS[args.only]} if args.only else SHOTS
    if args.only and args.only not in SHOTS:
        sys.exit(f"unknown shot {args.only!r}. --list to see them.")

    failed = 0
    for name, query in todo.items():
        ok, path, err = shoot(binary, name, query, args.coin)
        size = path.stat().st_size if path.exists() else 0
        print(f"  {'OK  ' if ok else 'FAIL'} {name:<14} {size:>8} bytes  {' '.join(err)}")
        if not ok:
            failed += 1
    print(f"\n  written to {OUT}")
    if failed:
        sys.exit(f"{failed} shot(s) failed")


if __name__ == "__main__":
    main()
