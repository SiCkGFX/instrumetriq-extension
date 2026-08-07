#!/usr/bin/env python3
"""Build a payload as it stood at a past cycle, from the real stored rows.

    python3 tools/screenshot/as_of.py 2026-08-06T15:20Z --out /tmp/imx.json

Why this exists: a store screenshot wants a coin in a particular state (unusual
attention, negative tone) and those states are common but not on demand. Rather
than inventing numbers, this rewinds: it copies the per-coin CSVs, drops every
row after the cutoff, and runs the REAL builder against the copy.

Nothing is fabricated. Every figure in the resulting payload was measured at the
time shown, by the same code that produces the live one.
"""

import argparse
import csv
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "coins_v2"
BUILDER = ROOT / "scripts" / "build_payload_v2.py"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cutoff", help="keep rows with ts <= this, e.g. 2026-08-06T15:20Z")
    ap.add_argument("--out", required=True, help="where to write the payload JSON")
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="asof_"))
    coins = tmp / "coins_v2"
    coins.mkdir()

    kept = dropped = 0
    for f in sorted(SRC.glob("*.csv")):
        with open(f, newline="") as fh:
            rows = list(csv.DictReader(fh))
        if not rows:
            continue
        keep = [r for r in rows if (r.get("ts") or "") <= args.cutoff]
        kept += len(keep)
        dropped += len(rows) - len(keep)
        if not keep:
            continue
        with open(coins / f.name, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(keep)

    env = dict(os.environ)
    env["COINS_DIR_V2"] = str(coins)
    env["NOW_UTC_V2"] = args.cutoff   # so freshness and feed_ok are as of then
    env["PAYLOAD_V2_PATH"] = str(Path(args.out).resolve())
    r = subprocess.run([sys.executable, str(BUILDER), "--force"],
                       env=env, capture_output=True, text=True)
    sys.stdout.write("".join("  " + l + "\n" for l in r.stdout.strip().splitlines()[-2:]))
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        sys.exit(r.returncode)

    print(f"  cutoff {args.cutoff}: kept {kept} rows, dropped {dropped} after it")
    print(f"  wrote {args.out}")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
