#!/usr/bin/env python3
"""build_payload_v2.py - Reads data/coins_v2 CSVs, writes the v2 sentiment payload.

Stateless: recomputes everything from the CSVs every run. Marker-gated against the
v2 ingest marker. Writes to a SEPARATE path from v1, which keeps serving 1.0.14
users until the Phase 8 cutover.

Three rules this file enforces, in order:

1. NO IDENTIFIERS. Author ids, usernames, tweet ids and raw post text are refused
   at ingest (see docs/CSV_V2_SCHEMA.md) and cannot reach this file. Everything
   served is an aggregate over public posts.

2. Nothing directional. Tone is a description of posts. No field in this payload
   may be rendered as a price forecast, and none is named to invite it.

3. Timestamps are base + minute offsets. The v1 payload spent 1.79 MB of 3.69 MB
   (48.5%) on ISO strings in `sparkline_ts` alone.

Cron (Phase 3.4):
    7,17,27,37,47,57 * * * * /usr/bin/python3 /srv/instrumetriq-extension/scripts/build_payload_v2.py >> /srv/instrumetriq-extension/logs/build_payload_v2.log 2>&1
"""

import bisect
import csv
import json
import logging
import os
import statistics
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import metrics_v2 as m  # noqa: E402

DATA_DIR   = SCRIPT_DIR.parent / "data"
# Overridable so the same builder can run against a trimmed copy of the CSVs,
# which is how "as of <past cycle>" payloads are produced for screenshots without
# a second implementation of any metric. Unset in production.
COINS_DIR  = Path(os.environ.get("COINS_DIR_V2", DATA_DIR / "coins_v2"))
UNIVERSE   = SCRIPT_DIR / "coin_universe.json"

UPDATE_MARKER = DATA_DIR / ".last_update_ts_v2"
BUILD_MARKER  = DATA_DIR / ".last_build_ts_v2"

OUTPUT_PATH = Path(os.environ.get(
    "PAYLOAD_V2_PATH", "/var/www/instrumetriq-api/data/extension_payload_v2.json"))

BUILDER_VERSION    = "2.0.0"
FEED_INTERRUPTED_H = 6
SPARK_FULL_DAYS    = 8      # full cycle resolution for this many days; older thinned to ~1/day
LOUDEST_N          = 8
LOUDEST_MIN_POSTS  = 10     # absolute floor: without it the ranking fills with 1-post microcaps
QUIET_BASELINE_DAYS = 14
MIN_BASELINE_DAYS   = 3      # fewer clean days than this -> no 'usually N' claim

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%Y-%m-%dT%H:%M:%S")
log = logging.getLogger("build_payload_v2")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v):
    f = _num(v)
    return None if f is None else int(f)


def read_marker(path):
    try:
        return path.read_text().strip()
    except OSError:
        return None


def write_marker(path, content):
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(content)
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _row_val(rows, field):
    """Newest non-empty value of `field` across `rows`."""
    for r in reversed(rows):
        v = r.get(field)
        if v not in (None, ""):
            return v
    return None


def parse_ts(ts):
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def format_usd(v):
    if v is None:
        return None
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(v) >= div:
            return f"${v/div:.1f}{suf}"
    return f"${v:.0f}"


def load_query_changed():
    """{symbol: cutoff datetime} for coins whose SEARCH POPULATION changed.

    Written by ingest_buckets.py from twscrape's guard-impact file (statuses
    QUERY_CHANGED / BOTH). Six coins in two waves on 2026-08-02: 0G 07:29,
    1000CAT 07:44, BIGTIME 07:51, XVG/MAGIC 18:14, OP 18:32. Times come from the
    daemon logs, not config edit times, because queries are only rebuilt at
    restart.

    Per-coin instants, not one version cutoff: the first three changed ~10 hours
    before the 0.11.0 boundary, so gating them on the version would discard
    valid data.

    NOT the 147 MATCHING_CHANGED coins. Those changed what category_counts and
    top_terms MEAN, and we read those only from the newest row in the 24h window.
    Every stored series we chart or average is a population measure, so only a
    query change can invalidate one.
    """
    try:
        raw = json.loads((DATA_DIR / "query_changed_coins.json").read_text())["coins"]
    except Exception:
        return {}
    out = {}
    for sym, iso in raw.items():
        try:
            out[sym] = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
    return out


def load_pairs():
    try:
        data = json.loads(UNIVERSE.read_text())
        return {d["symbol"]: d.get("pair_symbols", []) for d in data if isinstance(d, dict)}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Sparkline: base timestamp + minute offsets
# ---------------------------------------------------------------------------

def build_spark(rows, query_cutoff=None):
    """Per-cycle series with timestamps encoded as offsets from a base.

    Values are `distinct_authors_total` - the same quantity the attention metric
    is built on, so the chart and the badge cannot disagree.

    Rows older than SPARK_FULL_DAYS are thinned to roughly one per day; the recent
    window keeps full cycle resolution.
    """
    if not rows:
        return None
    if query_cutoff is not None:
        # Drop bars drawn from a different search population. BIGTIME ran 1760
        # posts/day against 2 today; charting them together shows a cliff that is
        # a measurement change, not a change in interest.
        rows = [r for r in rows
                if (parse_ts(r.get("ts")) or query_cutoff) >= query_cutoff]
        if not rows:
            return None
    cutoff = datetime.now(timezone.utc) - timedelta(days=SPARK_FULL_DAYS)
    keep, seen_days = [], set()
    for r in rows:
        dt = parse_ts(r.get("ts"))
        if dt is None:
            continue
        if dt >= cutoff:
            keep.append((dt, r))
        else:
            day = r["ts"][:10]
            if day not in seen_days:
                seen_days.add(day)
                keep.append((dt, r))
    if not keep:
        return None
    keep.sort(key=lambda t: t[0])

    t0 = keep[0][0]
    dt_list, v, tone, pos, neg = [], [], [], [], []
    for dt, r in keep:
        dt_list.append(int((dt - t0).total_seconds() // 60))
        v.append(_int(r.get("distinct_authors_total")))
        p, g = _num(r.get("pos_ratio")), _num(r.get("neg_ratio"))
        pos.append(round(p, 3) if p is not None else None)
        neg.append(round(g, 3) if g is not None else None)
        tone.append(int(round((p - g) * 100)) if (p is not None and g is not None) else None)
    return {
        "t0": t0.strftime("%Y-%m-%dT%H:%MZ"),
        "dt": dt_list, "v": v, "tone": tone, "pos": pos, "neg": neg,
    }


# ---------------------------------------------------------------------------
# Per-coin assembly
# ---------------------------------------------------------------------------

def build_coin(symbol, rows, pairs, now, query_cutoff=None):
    """One coin -> payload entry. Returns None if the coin has no usable rows."""
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: (r.get("ts") or "", str(r.get("cycle_id"))))
    last = rows[-1]
    last_dt = parse_ts(last.get("ts"))
    ago = int((now - last_dt).total_seconds() // 60) if last_dt else None

    # Attention for the LATEST cycle, against the median of prior ACTIVE cycles.
    #
    # The current value must come from rows[-1], the same cycle the sparkline's
    # newest bar and `updated_ago_min` describe. Taking the last NON-SILENT row
    # instead let the three disagree: AXS on 2026-08-04 reported "7.0x usual"
    # beside a 24-min-old stamp while its newest three cycles were all silent and
    # the newest bar drew as zero. The 7.0x was 2.5 hours stale. 166 of 277 coins
    # (60%) were reporting a ratio for a cycle that was not their latest, and BOTH
    # coins then flagged "unusual" were stale spikes.
    #
    # The BASELINE still excludes silent cycles: a coin silent 60% of the time has
    # a median of 0, and a zero baseline is undefined by construction (it would
    # make any single post an infinite spike). So the comparison is "this cycle
    # against a typical ACTIVE cycle", which is what the tooltip says.
    # Prefer cycles collected under the current matching rules, but fall back to
    # the full history when there are too few of them. Gating outright would have
    # cost 33 coins their attention row to correct ONE genuinely distorted
    # baseline (MAGIC, 5.5 -> 1.0 authors; the next four differ by 1 author vs 2,
    # which is noise). The fallback leaves those 33 exactly as they are today and
    # gives the other 244 a clean baseline, and it self-heals as clean cycles
    # accumulate.
    _active = [r for r in rows[:-1]
               if r.get("is_silent") != "True" and r.get("distinct_authors_total")]
    _clean = [r for r in _active if m.version_at_least(r.get("scraper_version"),
                                                       m.MIN_BASELINE_VERSION)]
    prior = [_num(r.get("distinct_authors_total"))
             for r in (_clean if len(_clean) >= m.SPIKE_MIN_PRIOR else _active)]
    last_silent = last.get("is_silent") == "True"
    cur = 0.0 if last_silent else (_num(last.get("distinct_authors_total")) or 0.0)
    ratio = m.spike_ratio(cur, prior)
    # A silent cycle is not an "intermediate" reading, it is an absence. State is
    # cleared so no band lights up and no alert can fire on it.
    state = None if last_silent else m.spike_state(ratio)

    days = m.rollup_daily(rows)
    # Summarise the most recent COMPLETE day where possible: the current day is
    # partial and systematically under-reports (a trap hit twice in Phases 1 and 2).
    day = None
    if len(days) >= 2:
        day = days[-2] if days[-1]["date"] == now.strftime("%Y-%m-%d") else days[-1]
    elif days:
        day = days[-1]
    if day is None:
        return {"symbol": symbol, "pair_symbols": pairs.get(symbol, []),
                "quality": "no_data", "updated_ago_min": ago}

    # ONE window for everything below the chart: a rolling 24 hours.
    #
    # Decided 2026-07-28 after the FLOKI report. Five of the eight card rows were
    # already 24h (who's posting, posts, volume, range, discussed); tone was the
    # only per-cycle one, which is what produced "mostly positive" beside a red
    # newest candle. Coverage settles it too - tone is readable for 88% of coins
    # over 24h versus 28% on a single ~40min cycle, and a cycle with 10 posts
    # swings on one viral tweet.
    #
    # `Attention` deliberately stays per-cycle: it is the live signal, the
    # published definition, and what fires alerts. Now on top, 24h below.
    win_rows = [r for r in rows
                if (parse_ts(r.get("ts")) or last_dt) >= last_dt - timedelta(hours=24)] \
               if last_dt else [last]
    win = {
        "pos_ratio":  m.weighted_mean((r.get("pos_ratio"),  r.get("ai_posts_scored")) for r in win_rows),
        "neg_ratio":  m.weighted_mean((r.get("neg_ratio"),  r.get("ai_posts_scored")) for r in win_rows),
        "neu_ratio":  m.weighted_mean((r.get("neu_ratio"),  r.get("ai_posts_scored")) for r in win_rows),
        "ai_prob_std": m.weighted_mean((r.get("ai_prob_std"), r.get("ai_posts_scored")) for r in win_rows),
        "ai_posts_scored": sum(_num(r.get("ai_posts_scored")) or 0 for r in win_rows),
        "src_referee_override": sum(_num(r.get("src_referee_override")) or 0 for r in win_rows),
    }
    split = m.tone_split(win["pos_ratio"], win["neu_ratio"], win["neg_ratio"],
                         win["ai_posts_scored"])
    # Why a block is absent, so the card can SAY why instead of quietly dropping
    # a row. v1 did this for tone and v2 lost it: 21% of coins render with no tone
    # row and no explanation, and "How clear-cut" disappears with it because it
    # qualifies tone. A hole the reader cannot account for looks like a bug.
    reasons = {}
    if ratio is None:
        # spike_baseline needs SPIKE_MIN_PRIOR active cycles before "usual" means
        # anything. A newly tracked or long-silent coin has no baseline yet.
        reasons["attention"] = "no_baseline"
    tone = None
    if split:
        tone = {
            "pos": split["pos"], "neu": split["neu"], "neg": split["neg"],
            "posts": split["posts"], "label": m.tone_label(split), "window": "24h",
        }
    else:
        scored = _num(win["ai_posts_scored"]) or 0
        reasons["tone"] = "too_few_posts" if scored < m.TONE_MIN_POSTS else "unclear"

    # Computed INDEPENDENTLY of tone, not nested inside it. The two share a
    # threshold (both need TONE_MIN_POSTS scored posts) but they are separate
    # measurements: tone_split can fail on unusable ratios while the scoring
    # dispersion behind `conviction` is still perfectly measurable. Nesting it
    # meant that case silently dropped a value we actually had.
    conviction = m.conviction(win["ai_prob_std"], win["src_referee_override"],
                              win["ai_posts_scored"])
    if conviction is None:
        # The real cause, same gate as tone. NOT "needs a tone reading": that
        # described a dependency between rows rather than the actual reason, and
        # it would have been wrong in the case above where tone fails but this
        # does not.
        reasons["conviction"] = "too_few_posts"

    # Topics: what is DISCUSSED, deliberately not framed as explaining tone.
    # Terms are scoped to the dominant model label so the evidence matches the
    # claim; counts stay unscoped because they are an honest description.
    topics = None
    # Counts and words now share ONE window (`win_rows`, rolling 24h), matching
    # the tone row above and the "Last 24 hours" heading over both.
    #
    # Words come from upstream's own last_24h.top_terms_distinctive (twscrape
    # 0.10.0), ranked by count x idf over a 2,391-term table built from 169k
    # tweets. That replaced a cycles-seen re-ranking done here, which could only
    # reorder what each cycle had already truncated to its own top 15. idf also
    # demotes words every coin uses: FLOKI's top 5 went from
    # [massive, strong, super, strongest, bullish] to
    # [bullish setup, still alive, is heating up, thrive, strong community].
    #
    # The earlier vocabulary gap (counts from 1,342 vocab terms, words from a
    # 129-term keyword dict) is closed upstream: both sides now read the same
    # 3,235-term vocabulary.
    # Counts AND words both come from upstream's own last_24h wherever it exists,
    # so the pair can never straddle a vocabulary change. Summing our per-cycle
    # `cat_*` columns instead would mix generations: on the 0.11.0 rollout OP's
    # window held 17 post-guard cycles at 1.00 positive matches/post beside 7
    # pre-guard cycles at 2.29, and the sum reported both as one number.
    # `rollup_window` stays as the fallback for windows with no such cycle yet.
    win24 = m.rollup_window(win_rows)
    latest_terms, latest_cats = {}, {}
    for r in reversed(win_rows):                 # newest row carrying the window
        blob = r.get("terms24_json")
        if blob:
            try:
                latest_terms = json.loads(blob) or {}
            except (ValueError, TypeError):
                latest_terms = {}
            try:
                latest_cats = json.loads(r.get("cats24_json") or "{}") or {}
            except (ValueError, TypeError):
                latest_cats = {}
            break
    if latest_cats:
        for cat in m.DRIVER_LABELS:
            win24[f"cat_{cat}"] = int(latest_cats.get(cat) or 0)
        pt24 = _num(_row_val(win_rows, "posts_total_24h"))
        if pt24:
            win24["posts_total"] = pt24
    # `cat_by_label` has no last_24h equivalent, so label-scoping keeps using the
    # per-cycle merge. It only decides WHICH categories may show words, never a
    # displayed number, so a generation mix there cannot alter what we report.
    # Fallback for windows with no 0.10.0 cycle yet: merge the per-cycle terms
    # over the SAME window. Ranked by cycles-seen, so it is a weaker ordering
    # than idf, but it keeps a count from ever rendering with no words beside it.
    # On the 0.10.0 rollout this covered 102 of 278 coins; it shrinks to zero as
    # the window fills, and stays as the guard for any future upstream gap.
    if not latest_terms:
        latest_terms = m.merge_cycle_terms(win_rows)
    items = m.narrative_drivers(win24, latest_terms)
    if not items:
        # No category matched. Either nobody posted, or they posted nothing our
        # curated vocabulary recognises. Those are different facts, so say which.
        reasons["topics"] = ("no_posts" if not (_num(win24.get("posts_total")) or 0)
                             else "no_matches")
    if items:
        lead = "pos" if (tone and tone["pos"] >= tone["neg"]) else "neg"
        scoped = {d["category"] for d in m.drivers_for_label(win24, lead)}
        # An EMPTY scoped set means the dominant label carries no lexicon data at
        # all, not that every category mismatched. Filtering on it blanked every
        # word on 38 coins: AVNT reads "leaning positive" while its lexicon hits
        # are almost all tagged neg, so cat_by_label["pos"] held nothing and the
        # card showed three topic names with nothing behind any of them. Fall back
        # to unscoped evidence, which is what drivers_for_label's docstring says
        # the caller should do.
        for it in items if scoped else []:
            if it["category"] not in scoped:
                it["terms"] = []          # keep the count, drop mismatched evidence
        cov = sum(int(_num(win24.get(f"cat_{d['category']}")) or 0) for d in items)
        topics = {
            "items": [{"label": d["label"], "count": d["count"], "terms": d["terms"]}
                      for d in items],
            # Vocabulary MATCHES, not posts: one post can hit several terms,
            # so this legitimately exceeds total_posts (FLOKI 125 vs 110).
            # Named for what it counts so nothing downstream reads it as posts.
            "coverage_matches": cov,
            "total_posts": int(_num(win24.get("posts_total")) or 0),
        }

    # A coin nobody posted about has no crowd to describe. `activity.posts` still
    # carries the post count for the quiet-coin line.
    # win24, NOT `day`. Everything under the "Last 24 hours" heading has to
    # measure the same 24 hours. `day` is the last COMPLETE CALENDAR day, which at
    # 07:00 ended seven hours ago: coin A reported "7 posts / 5 accounts" from
    # 2026-08-03 while the real trailing 24h held 2 posts and upstream's own
    # distinct_authors_24h said 2. Tone and topics were moved to this window in
    # Phases 5c/5l; these rows were left behind and kept the false label.
    crowd = None
    shape = m.crowd_shape(win24)
    if not shape:
        reasons["crowd"] = "no_authors"
    if shape:
        _n, basis = m.author_count(win24)
        crowd = {
            "authors": shape["authors"], "basis": basis,
            "blue": shape["blue"] or None,
            "followers_median": shape["followers_median"],
            "followers_max": shape["followers_max"],
        }

    # Quiet-copy baseline: this coin's own median daily posting, excluding today.
    # Baseline days must be collected under the SAME matching rules as the number
    # they are compared against. twscrape's coin-name guard (0.10.0, 2026-08-02)
    # cut BIGTIME from 1760 posts/day to 2, XVG 1430 -> 5, MAGIC 1185 -> 6,
    # 1000CAT 1704 -> 105: coins named after ordinary words had been sweeping in
    # unrelated posts. A median spanning that boundary reads "168 posts, usually
    # 1736" and makes a correctly-measured coin look dead. 11 coins fell 3x or
    # more. Same lesson as the vocabulary-generation mix in Phase 5c, one level up.
    hist = [d for d in days[:-1]
            if not d["is_silent"] and d.get("baseline_trusted")][-QUIET_BASELINE_DAYS:]
    # Below this many clean days, say nothing rather than compare against a
    # baseline we know is contaminated. It fills in as clean days accumulate.
    base_posts = (statistics.median([_num(d.get("posts_total")) or 0 for d in hist])
                  if len(hist) >= MIN_BASELINE_DAYS else None)
    activity = m.quiet_summary(win24, base_posts)

    # Newest reading, not the last complete day's. Binance computes these over a
    # trailing 24h at sample time, so a value sampled seven hours ago is a stale
    # 24h window, not the current one.
    market = {
        "range_pct_24h": round(_num(win24.get("range_pct_24h")), 2) if _num(win24.get("range_pct_24h")) is not None else None,
        "volume_usd": _num(win24.get("volume_usd")),
        "volume_fmt": format_usd(_num(win24.get("volume_usd"))),
        "volume_label": None,   # percentile filled in by the caller across all coins
        # Signed 24h change, kept SEPARATE from range. Range is (high-low) and
        # has no direction, so it cannot be coloured up or down; this can.
        "chg_pct_24h": round(_num(win24.get("chg_pct_24h")), 2) if _num(win24.get("chg_pct_24h")) is not None else None,
    }

    stale = ago is not None and ago > FEED_INTERRUPTED_H * 60
    return {
        "symbol": symbol,
        "pair_symbols": pairs.get(symbol, []),
        "quality": "stale" if stale else "ok",
        "updated_ago_min": ago,
        "day": day["date"],
        "attention": {"ratio": round(ratio, 2) if ratio is not None else None,
                      "state": state, "silent": last_silent, "pct_rank": None},
        "tone": tone,
        "conviction": conviction,
        "reasons": reasons or None,
        "topics": topics,
        "crowd": crowd,
        "activity": activity,
        "market": market,
        "spark": build_spark(rows, query_cutoff),
    }


# ---------------------------------------------------------------------------
# Market-wide daily index
# ---------------------------------------------------------------------------

def build_market_index(all_rows):
    """Trailing DAILY average of the market-wide positive share.

    Deliberately NOT the latest cycle. Measured on 7 days x 177 cycles: day-to-day
    sd 1.04 vs within-day cycle sd 2.57 (ratio 0.41 - fails), but vs the standard
    error of the daily mean 0.51 (ratio 2.04 - passes). A per-cycle reading is
    ~2.5x noise per 1x signal; the daily average is real.

    The panel is unbalanced - zero coins clear 5 posts in every cycle - so part of
    the day-to-day movement comes from composition rather than sentiment. `coins_in_index` is
    published so that is visible rather than hidden.
    """
    per_day = {}
    for rows in all_rows.values():
        for r in rows:
            n = _num(r.get("ai_posts_scored"))
            if not n or n < 5:
                continue
            day = (r.get("ts") or "")[:10]
            if not day:
                continue
            p, g, u = _num(r.get("pos_ratio")), _num(r.get("neg_ratio")), _num(r.get("neu_ratio"))
            if p is None or g is None:
                continue
            if u is None:
                u = max(0.0, 1.0 - p - g)
            d = per_day.setdefault(day, [0.0, 0.0, set()])
            d[0] += p * n
            d[1] += (p + g + u) * n
            d[2].add(r.get("_symbol"))

    series = []
    for day in sorted(per_day):
        pos, tot, coins = per_day[day]
        if tot > 0:
            series.append((day, round(pos / tot * 100, 2), len(coins)))
    if not series:
        return {"value": None, "pct_rank": None, "days": 0, "trend": [], "coins_in_index": None}

    # Drop the current (partial) day from the headline, keep it out of the rank.
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    complete = [s for s in series if s[0] != today]
    if not complete:
        complete = series
    value = complete[-1][1]
    vals = [s[1] for s in complete]
    pct = round(sum(1 for v in vals if v <= value) / len(vals) * 100)
    return {
        "value": value,
        "pct_rank": pct,
        "days": len(complete),
        "trend": [s[1] for s in complete],
        "coins_in_index": complete[-1][2],
    }


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build(output_path):
    # Overridable so an "as of <past cycle>" build treats that moment as now.
    # Without it, rows from ten hours ago are correctly judged stale and the
    # payload comes back feed_ok:false, which is right for a live build and wrong
    # for a historical one. Unset in production.
    _asof = os.environ.get("NOW_UTC_V2")
    now = (datetime.strptime(_asof, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
           if _asof else datetime.now(timezone.utc))
    pairs = load_pairs()

    all_rows = {}
    for path in sorted(COINS_DIR.glob("*.csv")):
        sym = path.stem
        with open(path, newline="") as fh:
            rows = list(csv.DictReader(fh))
        for r in rows:
            r["_symbol"] = sym
        if rows:
            all_rows[sym] = rows
    if not all_rows:
        log.error("No CSVs in %s - refusing to write an empty payload", COINS_DIR)
        return False
    log.info("Read %d coin CSVs", len(all_rows))

    query_changed = load_query_changed()
    log.info("Query-changed coins (population discontinuity): %d", len(query_changed))
    coins = [c for c in (build_coin(s, r, pairs, now, query_changed.get(s))
                         for s, r in all_rows.items()) if c]

    # Volume percentile across coins (a coin's label is its rank in the universe).
    vols = sorted(c["market"]["volume_usd"] for c in coins
                  if c.get("market") and c["market"]["volume_usd"])
    def vol_label(v):
        if v is None or not vols:
            return None
        pct = sum(1 for x in vols if x <= v) / len(vols) * 100
        for thr, lab in ((10, "Very low"), (35, "Low"), (65, "Moderate"), (90, "High")):
            if pct < thr:
                return lab
        return "Very high"
    for c in coins:
        if c.get("market"):
            c["market"]["volume_label"] = vol_label(c["market"]["volume_usd"])

    # Cross-sectional attention rank: share of tracked coins this one is strictly
    # busier THAN. The old form was (i+1)/n, which handed the top coin a flat 100
    # and read as "busier than 100% of the coins we track", i.e. busier than
    # itself. It also ignored ties, so two coins on an identical ratio got
    # different percentiles. Counting strictly-lower ratios fixes both, and one
    # decimal keeps 99.3 from rounding back up to 100.
    rated = sorted((c for c in coins if (c.get("attention") or {}).get("ratio") is not None),
                   key=lambda c: c["attention"]["ratio"])
    ratios = [c["attention"]["ratio"] for c in rated]
    n = len(rated)
    for i, c in enumerate(rated):
        below = bisect.bisect_left(ratios, c["attention"]["ratio"])
        c["attention"]["pct_rank"] = round(below / n * 100, 1) if n else None

    # Loudest: continuous ratio AND an absolute post floor.
    loudest = []
    for c in coins:
        a = c.get("attention") or {}
        posts = (c.get("activity") or {}).get("posts") or 0
        # A coin with no posts in the latest cycle cannot be "busiest now",
        # whatever its 24h post count says. Ratio 0 already sorts it to the
        # bottom, so this only bites when the whole universe is quiet, which is
        # exactly when a zero-ratio coin would otherwise surface in the list.
        if a.get("ratio") is None or a.get("silent") or posts < LOUDEST_MIN_POSTS:
            continue
        loudest.append({"symbol": c["symbol"], "ratio": a["ratio"], "state": a["state"],
                        "posts": int(posts),
                        "authors": (c.get("crowd") or {}).get("authors")})
    loudest.sort(key=lambda d: -d["ratio"])
    loudest = loudest[:LOUDEST_N]

    freshest = min((c["updated_ago_min"] for c in coins
                    if c.get("updated_ago_min") is not None), default=None)
    # Cadence for the chart's first timeframe button. Sampled over 24h, not the
    # last 5 gaps: the feed genuinely drifts (median 50-53 min for nine days to
    # 2026-08-02, 58 on 2026-08-03) and a 5-gap sample locks onto whatever the
    # last few hours did, which put "65m" on the button while the day's median was
    # 58 and the nine-day norm 52. Rounded to 5 min so the label stops flickering
    # between neighbouring values on every build.
    cutoff = now - timedelta(hours=24)
    gaps = []
    for rows in all_rows.values():
        ts = [parse_ts(r.get("ts")) for r in rows]
        ts = [t for t in ts if t and t >= cutoff]
        gaps += [(b - a).total_seconds() / 60 for a, b in zip(ts, ts[1:]) if b > a]
    cycle_min = int(5 * round(statistics.median(gaps) / 5)) if gaps else None

    latest_day = max((c["day"] for c in coins if c.get("day")), default=None)
    payload = {
        "schema_version": 2,
        "pushed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "feed_ok": freshest is not None and freshest <= FEED_INTERRUPTED_H * 60,
        "cycle_minutes_approx": cycle_min,
        "builder_version": BUILDER_VERSION,
        "universe": {
            "coins_tracked": len(coins),
            "active_coins": sum(1 for c in coins
                                if (c.get("activity") or {}).get("posts")),
            "spiking": sum(1 for c in coins
                           if (c.get("attention") or {}).get("state") == "spike"),
            # Coins at >=1.5x their own normal. `spiking` (>=6x) is rare by
            # design - median 1 per cycle, zero on 40% of them - so it cannot
            # carry an always-visible line on its own.
            "busy": sum(1 for c in coins
                        if ((c.get("attention") or {}).get("ratio") or 0) >= 1.5),
            "market": build_market_index(all_rows),
            "loudest": loudest,
        },
        "coins": coins,
    }

    blob = json.dumps(payload, separators=(",", ":"))
    fd, tmp = tempfile.mkstemp(dir=str(output_path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(blob)
        os.chmod(tmp, 0o644)          # nginx worker (www-data) must be able to read it
        os.replace(tmp, str(output_path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    log.info("Payload written: %d coins, %d active, %d spiking, %.2f MB, latest day %s",
             len(coins), payload["universe"]["active_coins"],
             payload["universe"]["spiking"], len(blob) / 1048576, latest_day)
    return True


def main():
    log.info("--- build_payload_v2 start ---")
    upd, bld = read_marker(UPDATE_MARKER), read_marker(BUILD_MARKER)
    if upd and bld and bld >= upd and "--force" not in sys.argv:
        log.info("Already up to date (build %s >= update %s) - skipping", bld, upd)
        return
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if build(OUTPUT_PATH):
        write_marker(BUILD_MARKER, datetime.now(timezone.utc).isoformat())
    log.info("--- build_payload_v2 done ---")


if __name__ == "__main__":
    main()
