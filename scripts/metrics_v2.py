#!/usr/bin/env python3
"""metrics_v2.py - Pure metric functions for the v2 sentiment payload.

No I/O, no paths, no globals. Every function takes plain data and returns plain
data so it can be unit-tested in isolation. `build_payload_v2.py` is the only
caller.

Three rules encoded here, in order of importance:

1. ATTENTION uses the published definition, unchanged:
   distinct posting authors vs the median of up to 20 strictly-prior sessions
   (minimum 5), spike at ratio >= 6. Do not "improve" this - its base rate (~1%)
   and its lift are measured properties of this exact formula.

2. TONE IS DESCRIPTIVE, NEVER DIRECTIONAL. Tone describes what posts say, not
   what a price will do. No label produced here may imply a price move.

3. NO IDENTIFIERS, EVER. Author ids, usernames, tweet ids and raw post text are
   refused at ingest and never reach this module. Everything here is an aggregate
   over public posts.
"""

import json
import re
import statistics

# ---------------------------------------------------------------------------
# Constants (published definition - see docs/CSV_V2_SCHEMA.md)
# ---------------------------------------------------------------------------

SPIKE_LOOKBACK   = 20    # sessions of history used for the baseline
SPIKE_MIN_PRIOR  = 5     # fewer prior sessions than this -> no baseline
SPIKE_THRESHOLD  = 6.0   # ratio at or above this is a spike (inclusive)
NORMAL_LOW       = 0.8   # "normal" band, per the published note
NORMAL_HIGH      = 1.2

# twscrape 0.5.0 fixed `sentiment_activity` by CHANGING values, not adding fields.
# Rows from earlier versions carry wrong hours_since_latest_tweet / sa_is_silent.
MIN_ACTIVITY_VERSION = "0.5.0"

# The coin-name guard landed in twscrape 0.10.0 (2026-08-02). Before it, coins
# named after ordinary words swept in unrelated posts: BIGTIME 1760 posts/day ->
# 2, XVG (Verge) 1430 -> 5, MAGIC 1185 -> 6, 1000CAT 1704 -> 105. Any baseline
# built across that boundary compares clean data against contaminated history.
MIN_BASELINE_VERSION = "0.10.0"

# NOT a version gate. Query narrowings happened in TWO waves on 2026-08-02, at
# 07:29-07:51 and 18:14-18:32, and the first wave predates 0.10.0 entirely, so no
# single version expresses it. The cutoff is per coin and per instant, carried in
# data/query_changed_coins.json (see build_payload_v2.load_query_changed). Kept
# only so the boundary is documented next to the other two.
QUERY_NARROWED_WAVES_UTC = ("2026-08-02T07:29:13Z", "2026-08-02T18:14:00Z")


def _ver(v):
    """Version string -> comparable tuple.

    STRING comparison is wrong and was live: "0.10.0" < "0.5.0" lexicographically,
    so the moment twscrape reached double digits every day was marked untrusted
    and `hours_since_latest_tweet` / `sa_is_silent` were blanked universally
    (measured 2026-08-05: 60 of 60 sampled coins). Compare numerically.
    """
    try:
        return tuple(int(x) for x in str(v or "").split("."))
    except (TypeError, ValueError):
        return ()


def version_at_least(v, minimum):
    """True when `v` is a parseable version at or above `minimum`."""
    t = _ver(v)
    return bool(t) and t >= _ver(minimum)

TONE_MIN_POSTS   = 5     # below this, tone is not reported at all
SPLIT_STD        = 0.35  # prob_std at or above this reads as a split crowd
CONTESTED_SHARE  = 0.15  # referee-override share at or above this reads contested

# Category -> user-facing driver label. Curated lexicon vocabulary only.
DRIVER_LABELS = {
    "pump_hype":        "hype",
    "fud_fear":         "fear",
    "scam_rug":         "scam talk",
    "meme_slang":       "memes",
    "positive_general": "positive language",
    "negative_general": "negative language",
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _num(val):
    """Parse a CSV cell to float, or None. Empty string and None both -> None."""
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _int(val):
    f = _num(val)
    return None if f is None else int(f)


def _truthy(val):
    """CSV booleans arrive as the strings 'True'/'False'."""
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() == "true"


def _merge_by_label(json_blobs):
    """Sum category_counts_by_label across a day's cycles.

    Input is the packed `cat_by_label_json` column (zeros dropped). Merges
    per-label, per-category. Returns {} when nothing usable is present, so a
    caller can distinguish "no hybrid data" from "all zero".
    """
    out = {}
    for blob in json_blobs:
        if not blob:
            continue
        try:
            parsed = json.loads(blob) if isinstance(blob, str) else blob
        except (ValueError, TypeError):
            continue
        if not isinstance(parsed, dict):
            continue
        for label, cats in parsed.items():
            if not isinstance(cats, dict):
                continue
            bucket = out.setdefault(label, {})
            for cat, val in cats.items():
                v = _num(val)
                if v:
                    bucket[cat] = bucket.get(cat, 0) + v
    return out


def rollup_window(win_rows):
    """Category counts over an arbitrary row window, shaped like a `rollup_daily`
    entry so it can be passed to `narrative_drivers` / `drivers_for_label`.

    Exists because the card's topic row pairs a count with the words behind it.
    Those two came from different windows until 2026-08-02: the count was summed
    over the calendar day while tone beside it used a rolling 24h, so at 14:50 the
    shared "Last 24 hours" heading described 14.8h for one row and 24h for the
    other. Neither number was wrong; the heading was. Both now use this window.
    """
    out = {"posts_total": sum(_num(r.get("posts_total")) or 0 for r in win_rows)}
    for cat in DRIVER_LABELS:
        out[f"cat_{cat}"] = sum(_num(r.get(f"cat_{cat}")) or 0 for r in win_rows)
    out["cat_by_label"] = _merge_by_label(r.get("cat_by_label_json") for r in win_rows)

    # Upstream's own trailing-24h post count wins when present: it is computed over
    # the real window rather than summed from cycles we happen to hold.
    pt24 = _last_value(win_rows, "posts_total_24h")
    if pt24 is not None:
        out["posts_total"] = pt24

    # Author counts are NOT summable: the same account posting in three cycles is
    # one author. Only `distinct_authors_24h` is a true trailing-24h figure from
    # upstream, so it takes the newest reading; the rest need window aggregation
    # that matches what the card claims beside them.
    v = _last_value(win_rows, "distinct_authors_24h")
    if v is not None:
        out["distinct_authors_24h"] = v

    # MAX over the window, a valid lower bound: if N distinct verified accounts
    # posted in one cycle, at least N posted in the 24h containing it. The newest
    # cycle's value was being shown beside a 24h author count, so "333 accounts,
    # 55 verified" mixed a day with a single ~55 minute update.
    for field in ("distinct_authors_total", "distinct_authors_blue", "followers_max"):
        vals = [_num(r.get(field)) for r in win_rows]
        vals = [x for x in vals if x is not None]
        if vals:
            out[field] = max(vals)

    # Median of the per-cycle medians. Not a true median over all authors, which
    # we cannot compute without per-author rows, but it is a central value for the
    # window rather than whichever cycle happened to land last.
    meds = [_num(r.get("followers_median")) for r in win_rows]
    meds = [x for x in meds if x is not None]
    if meds:
        out["followers_median"] = statistics.median(meds)

    # Market fields are point-in-time readings that Binance already computes over
    # a trailing 24h, so the newest one is the current one.
    for field in ("range_pct_24h", "volume_usd", "chg_pct_24h"):
        v = _last_value(win_rows, field)
        if v is not None:
            out[field] = v
    return out


def _last_value(rows, field):
    """Newest parseable value of `field`, or None."""
    for r in reversed(rows):
        v = _num(r.get(field))
        if v is not None:
            return v
    return None


def merge_cycle_terms(rows):
    """Fallback term ranking from the per-cycle `top_terms_json` column.

    Used only when no row in the window carries upstream's idf-ranked
    `terms24_json`. Ranks by how many of the window's cycles a term appeared in;
    within a cycle, upstream's own ordering breaks ties. Weaker than idf, because
    each cycle has already truncated to its own top 15 before we see it.
    """
    hits = {}
    for r in rows:
        blob = r.get("top_terms_json")
        if not blob:
            continue
        try:
            parsed = json.loads(blob) if isinstance(blob, str) else blob
        except (ValueError, TypeError):
            continue
        if not isinstance(parsed, dict):
            continue
        for cat, words in parsed.items():
            bucket = hits.setdefault(cat, {})
            for rank, w in enumerate(words or []):
                seen, best = bucket.get(w, (0, 999))
                bucket[w] = (seen + 1, min(best, rank))
    return {
        cat: [w for w, _ in sorted(d.items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0]))]
        for cat, d in hits.items()
    }


def drivers_for_label(day, label, limit=3):
    """Narrative drivers restricted to posts the model scored `label`.

    This is the fix for the contradiction found in Phase 2.4b, where a coin could
    render "mostly positive" beside drivers "negative language [bearish, drop,
    short]" - the lexicon and the model disagree on ~79% of rows. Showing drivers
    for the label being described makes the two consistent by construction.

    Returns [] when the by-label block is absent, so the caller can fall back to
    undifferentiated drivers rather than showing nothing.
    """
    cats = (day.get("cat_by_label") or {}).get(label) or {}
    scored = [
        {"category": c, "label": DRIVER_LABELS[c], "count": int(n)}
        for c, n in cats.items()
        if c in DRIVER_LABELS and n
    ]
    scored.sort(key=lambda d: (-d["count"], d["category"]))
    return scored[:limit]


# Words carrying no topic meaning. A phrase reduced to nothing but these keeps
# its raw tokens, so "all in" and "go for it" stay comparable.
_STOPWORDS = frozenset("""
a an the is are was were be been am so to of in on at for with and or but not no
it its this that these those as by from up out about into over after before than
then just very really all any some more most much many we i you he she they them
my your our their his her me us do does did doing have has had will would can
could should keeps keep get gets got go goes going still yet even also
""".split())

# Checked longest-first. "ion" is here for rejection/rejected, seen live.
_SUFFIXES = ("ion", "ing", "ers", "est", "ed", "es", "er", "ly", "s")


def _variants(word):
    """Word plus its plausible stems.

    A SET rather than one stem, because a single stem misses pairs the two sides
    reduce differently: "fakes" -> "fak" under -es but "fake" has no suffix to
    strip, so they never meet. Emitting both "fake" and "fak" for "fakes" lets
    them match. Same for vibes/vibe and rejection/rejected.
    """
    out = {word}
    for suf in _SUFFIXES:
        if len(word) > len(suf) + 2 and word.endswith(suf):
            root = word[:-len(suf)]
            out.add(root)
            # bigg -> big, pumm -> pum. Not ll/ss/ff/zz, which are usually real.
            if len(root) > 2 and root[-1] == root[-2] and root[-1] not in "lsfz":
                out.add(root[:-1])
    return out


def _term_key(term):
    """Every stem variant of every meaningful word in `term`."""
    tokens = re.findall(r"[a-z0-9']+", term.lower())
    meaningful = [t for t in tokens if t not in _STOPWORDS] or tokens
    key = set()
    for tok in meaningful:
        key |= _variants(tok)
    return key


def dedupe_terms(terms, limit):
    """Up to `limit` terms, skipping any that repeat a word already shown.

    Upstream ranks by count x idf, which readily fills every slot with one word:
    OP (the coin is called Optimism) returned ["with optimism", "renewed
    optimism", "optimism about", ...]. Five slots, one idea.

    Matching is on words ANYWHERE in the phrase, not the first word. An earlier
    version keyed on the leading token and so let those three through: "with",
    "renewed" and "optimism" are three different openings of the same word.
    Measured across 744 live coin-categories, this drops overlapping pairs among
    the five shown from 44 to 0 while costing 2 lists a fifth entry.

    Returns fewer than `limit` when the input cannot supply that many distinct
    ideas. That is intended: four real words beat five that repeat.

    PRESENTATION ONLY. Category counts include every match regardless of what is
    shown here, and the UI labels these "Examples", never "top" or "most common".
    """
    out, seen = [], []
    for term in terms:
        key = _term_key(term)
        if any(key & prev for prev in seen):
            continue
        seen.append(key)
        out.append(term)
        if len(out) >= limit:
            break
    return out


def weighted_mean(pairs):
    """Posts-weighted mean of (value, weight). None values and non-positive
    weights are skipped. Returns None when nothing qualifies."""
    num = den = 0.0
    for value, weight in pairs:
        v, w = _num(value), _num(weight)
        if v is None or w is None or w <= 0:
            continue
        num += v * w
        den += w
    return None if den <= 0 else num / den


# ---------------------------------------------------------------------------
# 1. Attention spike - the published definition
# ---------------------------------------------------------------------------

def spike_baseline(prior_authors):
    """Median of up to SPIKE_LOOKBACK strictly-prior author counts.

    Returns None if there are fewer than SPIKE_MIN_PRIOR priors, or if the median
    is non-positive (a coin that has been silent throughout has no usable
    baseline - returning 0 here would make every later session an infinite spike).
    """
    vals = [v for v in (_num(a) for a in prior_authors[-SPIKE_LOOKBACK:]) if v is not None]
    if len(vals) < SPIKE_MIN_PRIOR:
        return None
    med = statistics.median(vals)
    return None if med <= 0 else med


def spike_ratio(current_authors, prior_authors):
    """Current author count as a multiple of its own baseline. None if undefined."""
    cur = _num(current_authors)
    if cur is None:
        return None
    base = spike_baseline(prior_authors)
    if base is None:
        return None
    return cur / base


def spike_state(ratio):
    """'spike' | 'normal' | 'intermediate' | None.

    Per the published note, sessions between the normal band and the spike
    threshold belong to neither group (~57-61% of sessions) and are not compared.
    """
    if ratio is None:
        return None
    if ratio >= SPIKE_THRESHOLD:
        return "spike"
    if NORMAL_LOW <= ratio <= NORMAL_HIGH:
        return "normal"
    return "intermediate"


def attention_series(author_counts):
    """Rolling spike ratios for a full series, no look-ahead.

    Element i uses only elements [0, i). Returns a list the same length as the
    input, with None wherever the baseline is undefined.
    """
    out = []
    for i, cur in enumerate(author_counts):
        out.append(spike_ratio(cur, author_counts[:i]))
    return out


# ---------------------------------------------------------------------------
# 2. Daily rollups
# ---------------------------------------------------------------------------

# Columns summed across the cycles of a day.
_SUM_COLS = (
    "posts_total", "media_count",
    "lex_posts_pos", "lex_posts_neu", "lex_posts_neg",
    "total_likes", "total_retweets", "total_replies", "total_quotes", "total_bookmarks",
    "ai_posts_scored", "ai_posts_pos", "ai_posts_neu", "ai_posts_neg",
    "src_primary_default", "src_referee_override", "src_referee_neutral_band",
    "cat_positive_general", "cat_negative_general", "cat_pump_hype", "cat_fud_fear",
    "cat_meme_slang", "cat_scam_rug", "cat_emoji_pos", "cat_emoji_neg",
    "posts_with_media", "posts_with_links", "posts_with_hashtags",
    "posts_with_cashtags", "posts_with_mentions",
)

# Columns averaged, weighted by that cycle's scored-post count.
_WEIGHTED_COLS = (
    "pos_ratio", "neg_ratio", "neu_ratio", "mean_score",
    "primary_conf_mean", "referee_conf_mean",
    "ai_prob_mean", "ai_prob_std", "ai_prob_min", "ai_prob_max",
    "ai_label_3class_mean", "lex_score",
    "followers_median", "followers_mean",
)


def rollup_daily(rows):
    """Per-cycle rows -> one entry per UTC date, ascending.

    Rows are deduplicated by `cycle_id` first, so passing the same cycle twice
    changes nothing. This is the guarantee v1 could not make.

    Aggregation rules (documented in docs/CSV_V2_SCHEMA.md):
      counts              -> sum
      ratios/confidences  -> mean weighted by ai_posts_scored
      distinct authors    -> MAX across cycles, never summed (the same author
                             recurs across cycles; summing invents unique people)
      followers_max       -> max
      market fields       -> last non-empty value of the day
      is_silent           -> true only if every cycle that day is silent
    """
    by_cycle = {}
    for r in rows:
        cid = str(r.get("cycle_id") or "")
        if cid:
            by_cycle[cid] = r

    days = {}
    for r in sorted(by_cycle.values(), key=lambda x: (x.get("ts") or "", str(x.get("cycle_id")))):
        ts = r.get("ts") or ""
        day = ts[:10]
        if not day:
            continue
        d = days.setdefault(day, {"date": day, "cycles": 0, "_rows": []})
        d["cycles"] += 1
        d["_rows"].append(r)

    out = []
    for day in sorted(days):
        d = days[day]
        rs = d.pop("_rows")

        for col in _SUM_COLS:
            vals = [_num(r.get(col)) for r in rs]
            vals = [v for v in vals if v is not None]
            d[col] = sum(vals) if vals else None

        for col in _WEIGHTED_COLS:
            d[col] = weighted_mean((r.get(col), r.get("ai_posts_scored")) for r in rs)

        authors = [_num(r.get("distinct_authors_total")) for r in rs]
        authors = [a for a in authors if a is not None]
        d["distinct_authors_total"] = max(authors) if authors else None

        # 24h count is already a rolling window per cycle, so the day's value is
        # the peak reach observed that day - MAX, mirroring twscrape's own
        # last_2_cycles rule. Never summed, for the same reason as above.
        a24 = [_num(r.get("distinct_authors_24h")) for r in rs]
        a24 = [a for a in a24 if a is not None]
        d["distinct_authors_24h"] = max(a24) if a24 else None

        # Version gate: 0.5.0 CHANGED sentiment_activity values rather than adding
        # to them, so rows ingested before it carry wrong ones. Report the day's
        # max version and blank the affected fields when any part of the day
        # predates the fix.
        vers = [str(r.get("scraper_version") or "") for r in rs]
        vers = [v for v in vers if v]
        d["scraper_version"] = max(vers) if vers else None
        d["activity_trusted"] = bool(vers) and all(
            version_at_least(v, MIN_ACTIVITY_VERSION) for v in vers)
        # Baseline trust is a SEPARATE, later gate: post counts only became
        # comparable once the coin-name guard shipped.
        d["baseline_trusted"] = bool(vers) and all(
            version_at_least(v, MIN_BASELINE_VERSION) for v in vers)
        if not d["activity_trusted"]:
            d["hours_since_latest_tweet"] = None
            d["sa_is_silent"] = None
        else:
            hs = [_num(r.get("hours_since_latest_tweet")) for r in rs]
            hs = [h for h in hs if h is not None]
            d["hours_since_latest_tweet"] = min(hs) if hs else None
            d["sa_is_silent"] = all(_truthy(r.get("sa_is_silent")) for r in rs)

        d["cat_by_label"] = _merge_by_label(r.get("cat_by_label_json") for r in rs)

        blue = [_num(r.get("distinct_authors_blue")) for r in rs]
        blue = [b for b in blue if b is not None]
        d["distinct_authors_blue"] = max(blue) if blue else None

        fmax = [_num(r.get("followers_max")) for r in rs]
        fmax = [f for f in fmax if f is not None]
        d["followers_max"] = max(fmax) if fmax else None

        fsum = [_num(r.get("followers_sum")) for r in rs]
        fsum = [f for f in fsum if f is not None]
        d["followers_sum"] = max(fsum) if fsum else None

        for col in ("range_pct_24h", "volume_usd", "chg_pct_24h"):
            last = None
            for r in rs:
                v = _num(r.get(col))
                if v is not None:
                    last = v
            d[col] = last

        d["is_silent"] = all(_truthy(r.get("is_silent")) for r in rs)
        d["ts"] = rs[-1].get("ts")
        out.append(d)

    return out


# ---------------------------------------------------------------------------
# 3. Author counts
# ---------------------------------------------------------------------------

def author_count(entry):
    """Distinct authors for the entry, preferring the true 24h count.

    Falls back to the per-cycle `distinct_authors_total` on rows ingested before
    twscrape 0.4.0, which is always <= the 24h count (verified 278/278).

    Returns (count, basis) where basis is "24h" | "cycle" | None.
    """
    n = _num(entry.get("distinct_authors_24h"))
    if n is not None:
        return n, "24h"
    n = _num(entry.get("distinct_authors_total"))
    if n is not None:
        return n, "cycle"
    return None, None


# ---------------------------------------------------------------------------
# 4. Descriptive labels - never directional
# ---------------------------------------------------------------------------

def tone_split(pos_ratio, neu_ratio, neg_ratio, posts_scored):
    """Positive/neutral/negative shares as whole percentages summing to 100.

    Returns None when too few posts were scored to say anything. Describes the
    POSTS, not the price - callers must not render this as a direction.
    """
    n = _num(posts_scored)
    if n is None or n < TONE_MIN_POSTS:
        return None
    p, u, g = _num(pos_ratio), _num(neu_ratio), _num(neg_ratio)
    if p is None or g is None:
        return None
    if u is None:
        u = max(0.0, 1.0 - p - g)
    total = p + u + g
    if total <= 0:
        return None
    pct = [round(p / total * 100), round(u / total * 100), round(g / total * 100)]
    pct[1] += 100 - sum(pct)          # absorb rounding drift into neutral
    return {"pos": pct[0], "neu": pct[1], "neg": pct[2], "posts": int(n)}


def tone_label(split):
    """Plain description of a tone split. No directional vocabulary."""
    if not split:
        return None
    p, g = split["pos"], split["neg"]
    lead = p - g
    if abs(lead) < 10:
        return "mixed"
    if lead >= 40:
        return "mostly positive"
    if lead >= 10:
        return "leaning positive"
    if lead <= -40:
        return "mostly negative"
    return "leaning negative"


def conviction(prob_std, referee_override, posts_scored):
    """How much the scoring agreed with itself.

    'split' when per-post probabilities are widely dispersed; 'contested' when the
    referee model overrode the primary on a meaningful share of posts. Says
    nothing about direction.
    """
    n = _num(posts_scored)
    if n is None or n < TONE_MIN_POSTS:
        return None
    std = _num(prob_std)
    ovr = _num(referee_override) or 0.0
    share = ovr / n if n else 0.0
    if share >= CONTESTED_SHARE:
        return "contested"
    if std is not None and std >= SPLIT_STD:
        return "split"
    return "consistent"


def narrative_drivers(day, top_terms=None, limit=3, max_terms=5):
    """Top lexicon categories driving the conversation, with evidence terms.

    `top_terms` maps category -> list of matched words, straight from the curated
    lexicon. Raw hashtags and mentions are never eligible: they are free text and
    can identify accounts.
    """
    if isinstance(top_terms, str):
        try:
            top_terms = json.loads(top_terms) if top_terms else {}
        except (ValueError, TypeError):
            top_terms = {}
    top_terms = top_terms or {}

    scored = []
    for cat, label in DRIVER_LABELS.items():
        count = _num(day.get(f"cat_{cat}")) or 0
        if count > 0:
            scored.append({
                "category": cat,
                "label": label,
                "count": int(count),
                # Top 5 per category. Upstream (0.8.0+) sends up to 15 drawn from
                # the same vocabulary as the counts, already ranked; we dedupe
                # inflections so five slots carry five distinct words.
                "terms": dedupe_terms(top_terms.get(cat) or [], max_terms),
            })
    scored.sort(key=lambda d: (-d["count"], d["category"]))
    return scored[:limit]


def crowd_shape(day):
    """Who is talking. Counts and follower aggregates only.

    NO "concentrated" FLAG. One existed until 2026-08-04, set when
    followers_max / followers_median >= 20 and rendered as "not a broad crowd".
    It measured FOLLOWER-SIZE SKEW, which is heavy-tailed for any real audience,
    and said nothing about who was doing the posting. It fired on 62 of 258 coins,
    58 of them with 50+ accounts: ACX was called "not a broad crowd" with 1,385
    distinct accounts posting.

    Posting concentration is NOT MEASURABLE from what we ingest. It needs
    per-author post counts, and the only field carrying those is `mention_counts`,
    whose keys are usernames and which is refused at ingest on privacy grounds. So
    the honest position is to report the counts and not infer breadth from them.

    Returns None only when there is nobody to describe.
    """
    authors, _basis = author_count(day)
    if not authors:
        return None
    fmax, fmed = _num(day.get("followers_max")), _num(day.get("followers_median"))
    blue = _num(day.get("distinct_authors_blue"))
    # Clamp: the verified figure is a max across cycles in OUR window while
    # `authors` is upstream's own trailing 24h, so the two windows can disagree at
    # the edges. STEEM rendered "1 account, 2+ verified" on 2026-08-04. A subset
    # can never exceed its superset on screen, whatever the sources do.
    if blue is not None:
        blue = min(blue, authors)
    return {
        "authors": int(authors),
        "blue": int(blue) if blue is not None else None,
        "followers_max": int(fmax) if fmax else None,
        "followers_median": int(fmed) if fmed else None,
    }


def quiet_summary(day, baseline_posts):
    """Descriptive line for a coin with little activity.

    'below its usual N' compares against the coin's own recent daily posting, so
    it is informative rather than an empty state.
    """
    posts = _num(day.get("posts_total"))
    if posts is None:
        return None
    # 0 reads as absent rather than "0 accounts", which sits oddly beside a
    # non-zero post count.
    n, _basis = author_count(day)
    authors = n if n else None
    base = _num(baseline_posts)
    out = {"posts": int(posts), "authors": int(authors) if authors is not None else None,
           "usual": int(base) if base is not None else None, "relative": None}
    if base and base > 0:
        if posts < base * 0.6:
            out["relative"] = "below"
        elif posts > base * 1.4:
            out["relative"] = "above"
        else:
            out["relative"] = "typical"
    return out
