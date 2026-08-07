#!/usr/bin/env python3
"""Capture the numbered store screenshot set.

    python3 tools/screenshot/store_set.py

Each shot names the coin AND the moment it is taken from. Those moments are real:
`as_of.py` rewinds the stored CSVs to a past cycle and runs the real builder, so
every figure on screen was measured at the time shown. Nothing is synthesised.

Numbering continues from the existing listing images (01-04, 06), so the new set
lands beside them for comparison rather than replacing them.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "store"
TMP = Path(os.environ.get("SHOT_TMP", "/tmp")) / "instrumetriq_shots"

CHROME = os.environ.get("CHROMIUM") or str(HERE / "chrome/chrome-linux64/chrome")

# number, name, cutoff for as_of, coin, harness query
SHOTS = [
    ("07", "unusual-positive", "2026-08-06T15:20Z", "IMX",
     "theme=dark", "Unusual attention, positive tone"),
    ("08", "busy-negative",    "2026-08-06T15:20Z", "CKB",
     "theme=dark&alerts=1", "Busy, negative tone, alerts on"),
    ("09", "unusual-light",    "2026-08-03T13:31Z", "CAKE",
     "theme=light", "Unusual attention, light theme"),
    ("10", "coin-picker",      "2026-08-06T15:20Z", "IMX",
     "theme=dark&panel=picker&pro=1&sort=attention", "Coin picker, current activity bands"),
    # Raw only, not composed: the user frames this over a trading page themselves.
    ("11", "coin-detection",    "2026-08-06T15:20Z", "XRP",
     "theme=dark&alerts=1&detect=1", "Detected but untracked, teaser card"),
]


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + r.stderr)
        raise SystemExit(f"failed: {' '.join(map(str, cmd))}")
    return r.stdout


def main():
    if not Path(CHROME).exists():
        raise SystemExit(f"no chrome at {CHROME}; set CHROMIUM=")
    TMP.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    # One payload per distinct cutoff, reused across shots that share it.
    payloads = {}
    for _, _, cutoff, _, _, _ in SHOTS:
        if cutoff in payloads:
            continue
        pj = TMP / f"payload_{cutoff.replace(':','').replace('-','')}.json"
        if not pj.exists():
            print(f"  building payload as of {cutoff} ...")
            run([sys.executable, str(HERE / "as_of.py"), cutoff, "--out", str(pj)])
        payloads[cutoff] = pj

    for num, name, cutoff, coin, query, caption in SHOTS:
        run([sys.executable, str(HERE / "make_harness.py"),
             "--payload", str(payloads[cutoff])])
        target = TMP / f"{num}.png"
        url = (HERE / "build/harness.html").as_uri() + f"?{query}&coin={coin}"
        run([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--hide-scrollbars", "--force-device-scale-factor=2",
             "--window-size=400,600", "--virtual-time-budget=3500",
             f"--screenshot={target}", url])
        shutil.copy2(target, OUT / f"raw-{num}.png")
        print(f"  {num}  {coin:<6} {caption}")
        print(f"       from {cutoff}  ->  {OUT.name}/raw-{num}.png")

    print(f"\n  raw captures in {OUT}")
    print("  compose to 1280x800 with:")
    print("    python3 tools/screenshot/compose.py --all")


if __name__ == "__main__":
    main()
