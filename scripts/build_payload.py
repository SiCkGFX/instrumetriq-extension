#!/usr/bin/env python3
"""build_payload.py - Reads per-coin CSVs, computes metrics, writes payload JSON.

Stateless: reads CSVs every run, computes everything from scratch, writes output.
Marker-gated: only runs when update_csvs has written a newer completion marker.

Cron:
    2,12,22,32,42,52 * * * * cd /srv/instrumetriq-extension && /usr/bin/python3 scripts/build_payload.py >> logs/build_payload.log 2>&1
"""

import csv
import json
import logging
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR  = Path(__file__).resolve().parent
DATA_DIR    = SCRIPT_DIR.parent / "data"
COINS_DIR   = DATA_DIR / "coins"
UNIVERSE    = SCRIPT_DIR / "coin_universe.json"

UPDATE_MARKER = DATA_DIR / ".last_update_ts"
BUILD_MARKER  = DATA_DIR / ".last_build_ts"

OUTPUT_PATH = Path("/var/www/instrumetriq-api/data/extension_payload.json")

MIN_BASELINE       = 30
FEED_INTERRUPTED_H = 6
FUTURES_STALE_SEC  = 3600

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("build_payload")


# ---------------------------------------------------------------------------
# CSV parsing
# ---------------------------------------------------------------------------

def _float(val: str):
    """Parse a CSV string to float, or None if empty/invalid."""
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _int(val: str):
    """Parse a CSV string to int, or None if empty/invalid."""
    f = _float(val)
    if f is None:
        return None
    return int(f)


def _bool(val: str):
    """Parse a CSV string to bool. Empty or missing -> None."""
    if val is None or val == "":
        return None
    return val == "True"


def read_coin_csv(path: Path) -> list[dict]:
    """Read a per-coin CSV and return rows as typed dicts, sorted by ts."""
    rows = []
    with open(path, "r", newline="") as f:
        for row in csv.DictReader(f):
            rows.append({
                "ts":                       row["ts"],
                "posts_total":              _int(row["posts_total"]),
                "total_likes":              _int(row["total_likes"]),
                "total_retweets":           _int(row["total_retweets"]),
                "followers_sum":            _int(row["followers_sum"]),
                "distinct_authors":         _int(row["distinct_authors"]),
                "pos_ratio":                _float(row["pos_ratio"]),
                "neg_ratio":                _float(row["neg_ratio"]),
                "primary_conf_mean":        _float(row["primary_conf_mean"]),
                "is_silent":                _bool(row["is_silent"]),
                "twitter_data_ok":          _bool(row["twitter_data_ok"]),
                "futures_contract_exists":  _bool(row["futures_contract_exists"]),
                "futures_data_ok":          _bool(row["futures_data_ok"]),
                "futures_stale":            _bool(row["futures_stale"]),
                "funding_now":              _float(row["funding_now"]),
                "open_interest":            _float(row["open_interest"]),
                "oi_delta_pct":             _float(row["oi_delta_pct"]),
                "whale_ratio":              _float(row["whale_ratio"]),
                "futures_age_sec":          _int(row["futures_age_sec"]),
                "volume_usd":              _float(row["volume_usd"]),
            })
    rows.sort(key=lambda r: r["ts"])
    return rows


# ---------------------------------------------------------------------------
# EC (engagement coefficient)
# ---------------------------------------------------------------------------

def compute_ec(row: dict) -> float | None:
    """EC = (likes + retweets) * log1p(followers) / posts_total.

    Returns None if is_silent or data missing, 0.0 if posts_total == 0.
    """
    if row.get("is_silent"):
        return None
    posts = row.get("posts_total")
    if posts is None:
        return None
    if posts == 0:
        return 0.0
    likes     = row.get("total_likes") or 0
    rts       = row.get("total_retweets") or 0
    followers = row.get("followers_sum") or 0
    try:
        return max(0.0, (likes + rts) * math.log1p(followers) / posts)
    except (ZeroDivisionError, TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Chatter level
# ---------------------------------------------------------------------------

def chatter_level(ec: float, mean: float) -> str:
    if mean <= 0:
        return "Quiet"
    r = ec / mean
    if r < 0.5:
        return "Quiet"
    if r < 2.0:
        return "Active"
    if r <= 6.0:
        return "Buzzing"
    return "Spiking"


# ---------------------------------------------------------------------------
# Tone quality gate + single-source shift
# ---------------------------------------------------------------------------

def tone_quality_gate(row: dict) -> bool:
    """Does this row have reliable enough NLP output for a tone label?"""
    posts = row.get("posts_total")
    if posts is None or posts < 5:
        return False
    if not row.get("twitter_data_ok"):
        return False
    conf = row.get("primary_conf_mean")
    if conf is None or conf < 0.55:
        return False
    return True


def compute_tone_arrays(rows: list[dict]) -> tuple[list, float | None]:
    """Single-source tone shift: compute ALL shifts from one baseline.

    Returns:
        shifts:   list of int|None, one per row (becomes sparkline_tone)
        baseline: float|None (the raw 0..1 scale baseline, or None if < 30 samples)
    """
    # Step 1: collect raw_net for all rows passing the quality gate
    qualifying_nets = []
    for row in rows:
        if tone_quality_gate(row):
            pos = row.get("pos_ratio")
            neg = row.get("neg_ratio")
            if pos is not None and neg is not None:
                qualifying_nets.append(pos - neg)

    # Step 2: compute baseline (requires MIN_BASELINE samples)
    if len(qualifying_nets) < MIN_BASELINE:
        baseline = None
    else:
        baseline = sum(qualifying_nets) / len(qualifying_nets)

    # Step 3: compute shift for every row
    shifts = []
    for row in rows:
        if baseline is None:
            shifts.append(None)
            continue
        if not tone_quality_gate(row):
            shifts.append(None)
            continue
        pos = row.get("pos_ratio")
        neg = row.get("neg_ratio")
        if pos is None or neg is None:
            shifts.append(None)
            continue
        raw_net = pos - neg
        shift = max(-100, min(100, round((raw_net - baseline) * 100)))
        shifts.append(shift)

    return shifts, baseline


# ---------------------------------------------------------------------------
# Futures gate + labels
# ---------------------------------------------------------------------------

def futures_gate(row: dict) -> tuple[bool, str]:
    if not row.get("futures_contract_exists"):
        return False, "no_contract"
    if not row.get("futures_data_ok"):
        return False, "data_error"
    if row.get("futures_stale"):
        return False, "stale"
    age = row.get("futures_age_sec")
    if age is not None and age > FUTURES_STALE_SEC:
        return False, "stale"
    return True, "ok"


def funding_label(fn: float) -> str:
    if fn > 0:
        return "Longs paying"
    if fn < 0:
        return "Shorts paying"
    return "Neutral"


def oi_label(delta: float) -> str:
    if delta > 0.005:
        return "OI rising"
    if delta < -0.005:
        return "OI falling"
    return "OI stable"


def whale_label(ratio: float, p25: float, p75: float) -> str:
    if ratio > p75:
        return "Whales leaning long"
    if ratio < p25:
        return "Whales leaning short"
    return "Neutral"


# ---------------------------------------------------------------------------
# Volume helpers
# ---------------------------------------------------------------------------

def volume_percentile(cur: float, values: list[float]) -> float:
    n = len(values)
    if n == 0:
        return 50.0
    below = sum(1 for v in values if v < cur)
    equal = sum(1 for v in values if v == cur)
    return 100.0 * (below + 0.5 * equal) / n


def volume_label_from_pct(pct: float) -> str:
    if pct > 75:
        return "Elevated"
    if pct > 50:
        return "Above avg"
    if pct >= 25:
        return "Below avg"
    return "Low"


def format_usd(v: float) -> str:
    if v >= 1_000_000_000:
        return "${:.1f}B".format(v / 1_000_000_000)
    if v >= 1_000_000:
        return "${:.1f}M".format(v / 1_000_000)
    if v >= 1_000:
        return "${:.1f}K".format(v / 1_000)
    return "${:.0f}".format(v)


# ---------------------------------------------------------------------------
# Marker helpers
# ---------------------------------------------------------------------------

def read_marker(path: Path) -> str | None:
    if not path.exists():
        return None
    return path.read_text().strip()


def write_marker(path: Path, content: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.rename(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Payload assembly
# ---------------------------------------------------------------------------

def build_payload(output_path: Path) -> None:
    _now = datetime.now(timezone.utc)

    # Load coin universe
    with open(UNIVERSE) as f:
        universe = json.load(f)
    pairs_map = {c["symbol"]: c["pair_symbols"] for c in universe}
    universe_symbols = set(pairs_map)

    # ---------- Read all CSVs ----------
    all_coin_rows: dict[str, list[dict]] = {}
    for csv_file in sorted(COINS_DIR.glob("*.csv")):
        symbol = csv_file.stem
        if symbol not in universe_symbols:
            continue
        rows = read_coin_csv(csv_file)
        if rows:
            all_coin_rows[symbol] = rows

    log.info("Read %d coin CSVs", len(all_coin_rows))

    # ---------- Market-wide whale percentiles ----------
    whale_ratios: list[float] = []
    for symbol, rows in all_coin_rows.items():
        last = rows[-1]
        ok, _ = futures_gate(last)
        if ok:
            wr = last.get("whale_ratio")
            if wr is not None and wr > 0:
                whale_ratios.append(wr)

    p25 = p75 = 1.0
    if len(whale_ratios) >= 4:
        whale_ratios.sort()
        n = len(whale_ratios)
        p25 = whale_ratios[max(0, int(n * 0.25) - 1)]
        p75 = whale_ratios[min(n - 1, int(n * 0.75))]

    # ---------- Find most recent archive ts across all coins ----------
    latest_ts_global = None
    for rows in all_coin_rows.values():
        ts = rows[-1]["ts"]
        if latest_ts_global is None or ts > latest_ts_global:
            latest_ts_global = ts

    # ---------- Build per-coin entries ----------
    coins: list[dict] = []
    active_count = 0

    for symbol in sorted(universe_symbols):
        entry: dict = {
            "symbol":       symbol,
            "pair_symbols": pairs_map[symbol],
        }

        rows = all_coin_rows.get(symbol)

        if not rows:
            entry["chatter"]  = {"ok": False}
            entry["futures"]  = {"ok": False, "reason": "no_data"}
            entry["volume"]   = {"ok": False}
            entry["quality"]  = "insufficient_data"
            coins.append(entry)
            continue

        last = rows[-1]

        # ---- EC values for sparkline + chatter level ----
        ec_vals = []
        for r in rows:
            ec = compute_ec(r)
            ec_vals.append(ec)

        # Filter to non-None for mean
        ec_non_none = [v for v in ec_vals if v is not None]
        ec_mean = sum(ec_non_none) / len(ec_non_none) if ec_non_none else 0.0
        cur_ec = ec_vals[-1] if ec_vals else None

        # ---- Chatter block ----
        if cur_ec is not None and ec_mean > 0:
            level = chatter_level(cur_ec, ec_mean)

            # Single-source tone shift
            shifts, baseline = compute_tone_arrays(rows)

            # Use latest cycle's shift only - must agree with newest sparkline bar.
            # If the latest cycle fails the quality gate, tone is hidden (not
            # backfilled from a stale cycle).
            last_shift = shifts[-1] if shifts else None

            if last_shift is not None and baseline is not None:
                last_row_for_tone = rows[-1]
                pr = last_row_for_tone.get("pos_ratio") or 0
                nr = last_row_for_tone.get("neg_ratio") or 0
                raw_net_val = pr - nr
                tone_shift = last_shift
                tone_raw = max(-100, min(100, round(raw_net_val * 100)))
                tone_baseline = round(baseline * 100)
                tone_pos = round(pr * 100)
                tone_neg = round(nr * 100)
            else:
                tone_shift = None
                tone_raw = None
                tone_baseline = None
                tone_pos = None
                tone_neg = None

            # updated_ago_min: minutes since the last row's ts
            last_ts = last["ts"]  # e.g. "2026-03-18T07:00Z"
            try:
                last_dt = datetime.strptime(last_ts, "%Y-%m-%dT%H:%MZ").replace(
                    tzinfo=timezone.utc
                )
                updated_ago = int((_now - last_dt).total_seconds() / 60)
            except (ValueError, TypeError):
                updated_ago = None

            distinct = last.get("distinct_authors") or 0

            entry["chatter"] = {
                "level":            level,
                "tone_shift":       tone_shift,
                "tone_raw":         tone_raw,
                "tone_baseline":    tone_baseline,
                "tone_pos":         tone_pos,
                "tone_neg":         tone_neg,
                "updated_ago_min":  updated_ago,
                "distinct_authors": distinct,
                "ok":               True,
            }

            if level in ("Buzzing", "Spiking"):
                active_count += 1
        else:
            entry["chatter"] = {"ok": False}
            shifts = [None] * len(rows)

        # ---- Futures block ----
        fut_ok, fut_reason = futures_gate(last)
        if fut_ok:
            fn  = last.get("funding_now") or 0
            oi  = last.get("oi_delta_pct") or 0
            wl  = last.get("whale_ratio") or 1
            oi_raw = last.get("open_interest") or 0
            fn_pct = "{:.4f}%".format(abs(fn) * 100)
            wl_long_pct = round(wl / (1 + wl) * 100) if wl > 0 else 50

            entry["futures"] = {
                "funding_label": funding_label(fn),
                "funding_rate":  fn_pct,
                "oi_label":      oi_label(oi),
                "oi_usd":        round(oi_raw, 2),
                "oi_usd_fmt":    format_usd(oi_raw),
                "whale_label":   whale_label(wl, p25, p75),
                "whale_pct":     wl_long_pct,
                "whale_ratio":   round(wl, 4),
                "ok":            True,
            }
        else:
            entry["futures"] = {"ok": False, "reason": fut_reason}

        # ---- Volume block ----
        vol_vals = [r.get("volume_usd") for r in rows
                    if r.get("volume_usd") is not None]
        if vol_vals:
            cur_vol = vol_vals[-1]
            pct = volume_percentile(cur_vol, vol_vals)
            entry["volume"] = {
                "usd":     round(cur_vol, 2),
                "usd_fmt": format_usd(cur_vol),
                "label":   volume_label_from_pct(pct),
                "pct":     round(pct, 1),
                "ok":      True,
            }
        else:
            entry["volume"] = {"ok": False}

        # ---- Sparklines ----
        entry["sparkline"] = [round(v, 4) if v is not None else None
                              for v in ec_vals]
        entry["sparkline_tone"] = shifts
        entry["sparkline_pos"] = [
            round(r["pos_ratio"], 4) if (r.get("pos_ratio") is not None
                                         and tone_quality_gate(r))
            else None
            for r in rows
        ]
        entry["sparkline_neg"] = [
            round(r["neg_ratio"], 4) if (r.get("neg_ratio") is not None
                                         and tone_quality_gate(r))
            else None
            for r in rows
        ]
        entry["sparkline_ts"] = [r["ts"] for r in rows]

        # ---- Quality ----
        entry["quality"] = (
            "ok" if (entry["chatter"].get("ok") or entry["futures"].get("ok"))
            else "insufficient_data"
        )
        coins.append(entry)

    # ---------- Feed health ----------
    feed_ok = True
    if latest_ts_global:
        try:
            latest_dt = datetime.strptime(latest_ts_global, "%Y-%m-%dT%H:%MZ").replace(
                tzinfo=timezone.utc
            )
            age_h = (_now - latest_dt).total_seconds() / 3600
            if age_h > FEED_INTERRUPTED_H:
                feed_ok = False
        except (ValueError, TypeError):
            pass

    payload = {
        "pushed_at":         _now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "feed_ok":           feed_ok,
        "active_coin_count": active_count,
        "coins":             coins,
    }

    # ---------- Write atomically ----------
    out_dir = output_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.chmod(tmp, 0o644)
        os.rename(tmp, str(output_path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    log.info("Payload written: %d coins, %d active, feed_ok=%s",
             len(coins), active_count, feed_ok)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    log.info("--- build_payload start ---")

    # Marker gate: only run if update_csvs has finished since our last build
    update_ts = read_marker(UPDATE_MARKER)
    build_ts = read_marker(BUILD_MARKER)

    if update_ts is None:
        log.info("No update marker found - CSVs not ready yet, exiting")
        return

    if build_ts is not None and build_ts >= update_ts:
        log.info("Payload already up to date (build=%s >= update=%s), exiting",
                 build_ts, update_ts)
        return

    build_payload(OUTPUT_PATH)

    write_marker(BUILD_MARKER, datetime.now(timezone.utc).isoformat())
    log.info("--- build_payload done ---")


if __name__ == "__main__":
    main()
