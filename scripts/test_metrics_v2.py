#!/usr/bin/env python3
"""Unit tests for metrics_v2.py.

Run:  python3 -m unittest scripts.test_metrics_v2 -v
      python3 scripts/test_metrics_v2.py

Covers the edge cases Phase 2 of the makeover plan calls out explicitly:
sparse baselines, zero medians, the inclusive spike boundary, cycle-duplicate
immunity, all-neutral and zero-post inputs, and the absence of directional
vocabulary in every produced label.
"""

import unittest

import metrics_v2 as m


# ---------------------------------------------------------------------------
# 2.1 Attention spike - the published definition
# ---------------------------------------------------------------------------

class TestSpikeBaseline(unittest.TestCase):

    def test_fewer_than_five_priors_is_undefined_not_zero(self):
        """A sparse coin must yield None, never 0 - 0 would make the next
        session an infinite spike."""
        for n in range(0, m.SPIKE_MIN_PRIOR):
            self.assertIsNone(m.spike_baseline([3] * n), f"{n} priors should be undefined")

    def test_exactly_five_priors_is_defined(self):
        self.assertEqual(m.spike_baseline([2, 2, 2, 2, 2]), 2)

    def test_zero_median_is_undefined(self):
        """A coin silent throughout has no usable baseline."""
        self.assertIsNone(m.spike_baseline([0, 0, 0, 0, 0, 0]))

    def test_median_ignores_all_but_the_last_twenty(self):
        priors = [1000] * 50 + [2] * 20
        self.assertEqual(m.spike_baseline(priors), 2)

    def test_none_values_are_skipped_not_counted(self):
        self.assertIsNone(m.spike_baseline([5, None, 5, None, 5]))   # only 3 usable
        self.assertEqual(m.spike_baseline([5, None, 5, 5, 5, 5]), 5)  # 5 usable


class TestSpikeRatioAndState(unittest.TestCase):

    def test_threshold_is_inclusive(self):
        prior = [1] * 5
        self.assertEqual(m.spike_state(m.spike_ratio(6, prior)), "spike")

    def test_just_below_threshold_is_not_a_spike(self):
        prior = [10] * 5           # baseline 10; 59 -> 5.9x
        self.assertEqual(m.spike_state(m.spike_ratio(59, prior)), "intermediate")

    def test_normal_band_edges_inclusive(self):
        prior = [10] * 5
        self.assertEqual(m.spike_state(m.spike_ratio(8, prior)), "normal")    # 0.8
        self.assertEqual(m.spike_state(m.spike_ratio(12, prior)), "normal")   # 1.2

    def test_between_normal_and_spike_is_neither(self):
        prior = [10] * 5
        self.assertEqual(m.spike_state(m.spike_ratio(30, prior)), "intermediate")

    def test_undefined_baseline_propagates_as_none(self):
        self.assertIsNone(m.spike_ratio(100, [1, 1]))
        self.assertIsNone(m.spike_state(None))

    def test_silent_cycle_is_a_real_zero_not_undefined(self):
        """A cycle with no posts is 0 authors, which is a measurement. Only a
        missing BASELINE is undefined."""
        self.assertEqual(m.spike_ratio(0, [1] * 6), 0.0)

    def test_zero_ratio_reports_intermediate_and_must_be_overridden(self):
        """spike_state has no "silent" band: 0 falls below NORMAL_LOW and comes
        back as 'intermediate', which would render as a real reading. The builder
        therefore sets state=None itself when the latest cycle is silent. Do NOT
        "fix" this by adding a band here; the caller owns that decision because
        only it knows whether the cycle was silent or merely quiet."""
        self.assertEqual(m.spike_state(0.0), "intermediate")

    def test_series_has_no_lookahead(self):
        """Element i must depend only on elements before it."""
        counts = [1, 1, 1, 1, 1, 50, 1]
        got = m.attention_series(counts)
        self.assertEqual(got[:5], [None] * 5, "first five have too little history")
        self.assertEqual(got[5], 50.0, "spike measured against prior median 1")

    def test_series_length_matches_input(self):
        counts = list(range(30))
        self.assertEqual(len(m.attention_series(counts)), 30)


# ---------------------------------------------------------------------------
# 2.2 Daily rollups
# ---------------------------------------------------------------------------

def _row(cycle_id, ts, **kw):
    base = {
        "cycle_id": str(cycle_id), "ts": ts,
        "posts_total": 10, "ai_posts_scored": 10,
        "distinct_authors_total": 8, "distinct_authors_blue": 2,
        "followers_max": 1000, "followers_sum": 5000,
        "pos_ratio": 0.5, "neg_ratio": 0.3, "neu_ratio": 0.2,
        "is_silent": "False", "total_likes": 100,
        "range_pct_24h": 3.0, "volume_usd": 1_000_000,
    }
    base.update(kw)
    return base


class TestVersionCompare(unittest.TestCase):
    """Regression: versions were compared as STRINGS, so "0.10.0" < "0.5.0" and
    every day was marked untrusted the moment twscrape reached double digits.
    Measured live 2026-08-05: 60 of 60 sampled coins."""

    def test_double_digit_minor_beats_single_digit(self):
        self.assertTrue(m.version_at_least("0.10.0", "0.5.0"))
        self.assertTrue(m.version_at_least("0.11.0", "0.5.0"))
        self.assertFalse(m.version_at_least("0.8.0", "0.10.0"))

    def test_equal_version_passes(self):
        self.assertTrue(m.version_at_least("0.10.0", "0.10.0"))

    def test_below_minimum_fails(self):
        self.assertFalse(m.version_at_least("0.4.0", "0.5.0"))

    def test_missing_or_junk_is_never_trusted(self):
        for v in ("", None, "abc", "0.x.1"):
            self.assertFalse(m.version_at_least(v, "0.5.0"), repr(v))

    def test_query_narrowing_cannot_be_expressed_as_a_version(self):
        """Two waves on 2026-08-02, 07:29 and 18:14. The first predates 0.10.0
        entirely, so a version gate cannot separate query-narrowed data: 0G,
        1000CAT and BIGTIME changed while still stamped 0.8.0. The cutoff is per
        coin and per instant. This test exists so nobody reintroduces a
        MIN_QUERY_VERSION."""
        first, second = m.QUERY_NARROWED_WAVES_UTC
        self.assertLess(first, "2026-08-02T13:31:00Z")   # before 0.10.0 shipped
        self.assertGreater(second, "2026-08-02T13:31:00Z")
        self.assertFalse(hasattr(m, "MIN_QUERY_VERSION"))

    def test_baseline_gate_is_stricter_than_activity_gate(self):
        """A 0.8.0 day is fine for activity fields but must NOT seed a post-count
        baseline: it predates the coin-name guard."""
        self.assertTrue(m.version_at_least("0.8.0", m.MIN_ACTIVITY_VERSION))
        self.assertFalse(m.version_at_least("0.8.0", m.MIN_BASELINE_VERSION))


class TestDailyRollup(unittest.TestCase):

    def test_duplicate_cycle_id_changes_nothing(self):
        """The guarantee v1 could not make."""
        rows = [_row(1, "2026-07-01T01:00Z"), _row(2, "2026-07-01T02:00Z")]
        once = m.rollup_daily(rows)
        twice = m.rollup_daily(rows + [_row(1, "2026-07-01T01:00Z")])
        self.assertEqual(once, twice)
        self.assertEqual(once[0]["cycles"], 2)
        self.assertEqual(once[0]["posts_total"], 20)

    def test_counts_are_summed(self):
        rows = [_row(1, "2026-07-01T01:00Z", posts_total=5),
                _row(2, "2026-07-01T02:00Z", posts_total=7)]
        self.assertEqual(m.rollup_daily(rows)[0]["posts_total"], 12)

    def test_authors_are_max_never_summed(self):
        """The same person posting in three cycles counts once."""
        rows = [_row(1, "2026-07-01T01:00Z", distinct_authors_total=4),
                _row(2, "2026-07-01T02:00Z", distinct_authors_total=9),
                _row(3, "2026-07-01T03:00Z", distinct_authors_total=6)]
        day = m.rollup_daily(rows)[0]
        self.assertEqual(day["distinct_authors_total"], 9)
        self.assertNotEqual(day["distinct_authors_total"], 19)

    def test_ratios_are_posts_weighted_not_plain_mean(self):
        rows = [_row(1, "2026-07-01T01:00Z", pos_ratio=1.0, ai_posts_scored=90),
                _row(2, "2026-07-01T02:00Z", pos_ratio=0.0, ai_posts_scored=10)]
        self.assertAlmostEqual(m.rollup_daily(rows)[0]["pos_ratio"], 0.9)

    def test_days_are_split_and_ordered(self):
        rows = [_row(2, "2026-07-02T01:00Z"), _row(1, "2026-07-01T01:00Z")]
        days = m.rollup_daily(rows)
        self.assertEqual([d["date"] for d in days], ["2026-07-01", "2026-07-02"])

    def test_silent_day_requires_every_cycle_silent(self):
        mixed = [_row(1, "2026-07-01T01:00Z", is_silent="True"),
                 _row(2, "2026-07-01T02:00Z", is_silent="False")]
        allq = [_row(1, "2026-07-01T01:00Z", is_silent="True"),
                _row(2, "2026-07-01T02:00Z", is_silent="True")]
        self.assertFalse(m.rollup_daily(mixed)[0]["is_silent"])
        self.assertTrue(m.rollup_daily(allq)[0]["is_silent"])

    def test_market_fields_take_last_non_empty(self):
        rows = [_row(1, "2026-07-01T01:00Z", volume_usd=111),
                _row(2, "2026-07-01T02:00Z", volume_usd="")]
        self.assertEqual(m.rollup_daily(rows)[0]["volume_usd"], 111)

    def test_empty_input(self):
        self.assertEqual(m.rollup_daily([]), [])

    def test_row_without_ts_is_skipped(self):
        self.assertEqual(m.rollup_daily([_row(1, "")]), [])


# ---------------------------------------------------------------------------
# Author counts
# ---------------------------------------------------------------------------

class TestToneSplit(unittest.TestCase):

    def test_below_min_posts_returns_none(self):
        self.assertIsNone(m.tone_split(0.9, 0.05, 0.05, 4))

    def test_zero_posts_returns_none(self):
        self.assertIsNone(m.tone_split(0.9, 0.05, 0.05, 0))
        self.assertIsNone(m.tone_split(None, None, None, None))

    def test_shares_sum_to_100(self):
        for args in [(0.5, 0.3, 0.2), (0.333, 0.333, 0.334), (1.0, 0.0, 0.0),
                     (0.0, 0.0, 1.0), (0.17, 0.66, 0.17)]:
            s = m.tone_split(*args, 40)
            self.assertEqual(s["pos"] + s["neu"] + s["neg"], 100, f"{args} -> {s}")

    def test_all_neutral(self):
        s = m.tone_split(0.0, 1.0, 0.0, 30)
        self.assertEqual((s["pos"], s["neu"], s["neg"]), (0, 100, 0))

    def test_missing_neutral_is_inferred(self):
        s = m.tone_split(0.6, None, 0.4, 20)
        self.assertEqual(s["neu"], 0)


class TestLabelsAreNotDirectional(unittest.TestCase):
    """Tone describes posts, never a price move. This is a hard product rule."""

    BANNED = ("bull", "bear", "buy", "sell", "moon", "dump", "pump",
              "rally", "expect", "predict", "will ", "signal", "target",
              "up", "down", "rise", "fall", "gain", "loss")

    def _assert_clean(self, text):
        low = str(text).lower()
        for word in self.BANNED:
            self.assertNotIn(word, low, f"directional word {word!r} in {text!r}")

    def test_every_tone_label_is_clean(self):
        seen = set()
        for pos in [i / 20 for i in range(21)]:
            s = m.tone_split(pos, 0.0, 1 - pos, 30)
            label = m.tone_label(s)
            seen.add(label)
            self._assert_clean(label)
        self.assertGreaterEqual(len(seen), 4, "expected several distinct labels")

    def test_every_conviction_label_is_clean(self):
        for std in (0.0, 0.2, 0.4, 0.9):
            for ovr in (0, 3, 20):
                label = m.conviction(std, ovr, 30)
                if label:
                    self._assert_clean(label)

    def test_driver_labels_are_clean(self):
        # "hype"/"fear" describe the language observed, not a forecast.
        for label in m.DRIVER_LABELS.values():
            self._assert_clean(label)

    def test_tone_label_none_when_split_none(self):
        self.assertIsNone(m.tone_label(None))


class TestConviction(unittest.TestCase):

    def test_below_min_posts_is_none(self):
        self.assertIsNone(m.conviction(0.5, 1, 3))

    def test_high_override_share_is_contested(self):
        self.assertEqual(m.conviction(0.1, 10, 30), "contested")

    def test_wide_dispersion_is_split(self):
        self.assertEqual(m.conviction(0.5, 0, 30), "split")

    def test_tight_and_agreed_is_consistent(self):
        self.assertEqual(m.conviction(0.1, 0, 30), "consistent")

    def test_missing_std_does_not_crash(self):
        self.assertEqual(m.conviction(None, 0, 30), "consistent")


class TestNarrativeDrivers(unittest.TestCase):

    def test_ranked_by_count(self):
        day = {"cat_pump_hype": 9, "cat_fud_fear": 2, "cat_meme_slang": 5}
        got = m.narrative_drivers(day)
        self.assertEqual([d["category"] for d in got],
                         ["pump_hype", "meme_slang", "fud_fear"])

    def test_zero_counts_excluded(self):
        day = {"cat_pump_hype": 0, "cat_fud_fear": 0}
        self.assertEqual(m.narrative_drivers(day), [])

    def test_terms_attach_and_are_capped_at_five(self):
        """Upstream (0.8.0+) sends up to 15; the popup shows the top 5."""
        day = {"cat_fud_fear": 3}
        got = m.narrative_drivers(day, {"fud_fear": ["rekt", "crash", "panic", "fear"]})
        self.assertEqual(got[0]["terms"], ["rekt", "crash", "panic", "fear"])
        many = {"fud_fear": ["alpha", "bravo", "charlie", "delta", "echo",
                             "foxtrot", "golf", "hotel"]}
        self.assertEqual(len(m.narrative_drivers(day, many)[0]["terms"]), 5)

    def test_terms_accept_json_string(self):
        day = {"cat_pump_hype": 4}
        got = m.narrative_drivers(day, '{"pump_hype":["moon","send"]}')
        self.assertEqual(got[0]["terms"], ["moon", "send"])

    def test_malformed_json_does_not_crash(self):
        self.assertEqual(m.narrative_drivers({"cat_pump_hype": 1}, "{oops")[0]["terms"], [])

    def test_limit_respected(self):
        day = {f"cat_{c}": 5 for c in m.DRIVER_LABELS}
        self.assertEqual(len(m.narrative_drivers(day, limit=2)), 2)

    def test_empty_day(self):
        self.assertEqual(m.narrative_drivers({}), [])


class TestCrowdShape(unittest.TestCase):

    def test_no_concentration_claim_is_emitted(self):
        """The "concentrated" flag was REMOVED on 2026-08-04. It tested
        followers_max / followers_median >= 20, which is follower-size skew and is
        heavy-tailed for any real audience, then rendered it as "not a broad
        crowd". It fired on 62 of 258 coins, 58 with 50+ accounts; ACX carried it
        with 1,385 distinct accounts posting.

        Do NOT reinstate it. Posting concentration needs per-author post counts,
        and the only field carrying those is `mention_counts`, refused at ingest
        because its keys are usernames. A follower ratio cannot stand in for it.
        """
        got = m.crowd_shape({"distinct_authors_total": 40,
                             "followers_max": 300000, "followers_median": 1000})
        self.assertNotIn("concentrated", got)

    def test_verified_never_exceeds_total_accounts(self):
        """`blue` is a max across our window while `authors` is upstream's own
        trailing 24h, so the two can disagree at the edges. STEEM rendered
        "1 account, 2+ verified" before the clamp."""
        got = m.crowd_shape({"distinct_authors_24h": 1, "distinct_authors_blue": 2})
        self.assertEqual(got["authors"], 1)
        self.assertEqual(got["blue"], 1)

    def test_reports_the_count_the_gate_judged_not_the_cycle_count(self):
        """Regression: gating on 24h while reporting the per-cycle count leaked
        sub-k numbers into the payload (84 coins, caught by the schema)."""
        day = {"distinct_authors_24h": 50, "distinct_authors_total": 2}
        self.assertEqual(m.crowd_shape(day)["authors"], 50)


class TestQuietSummary(unittest.TestCase):

    def test_below_usual(self):
        got = m.quiet_summary({"posts_total": 9, "distinct_authors_total": 6}, 30)
        self.assertEqual((got["posts"], got["authors"], got["usual"], got["relative"]),
                         (9, 6, 30, "below"))

    def test_typical(self):
        self.assertEqual(m.quiet_summary({"posts_total": 30}, 30)["relative"], "typical")

    def test_no_baseline_yields_no_relative_claim(self):
        self.assertIsNone(m.quiet_summary({"posts_total": 5}, None)["relative"])

    def test_zero_post_day_still_describable(self):
        got = m.quiet_summary({"posts_total": 0, "distinct_authors_total": 0}, 20)
        self.assertEqual(got["posts"], 0)
        self.assertEqual(got["relative"], "below")


class TestAuthorCountBasis(unittest.TestCase):
    """Prefer the true 24h count, fall back to the per-cycle count."""

    def test_prefers_24h_when_present(self):
        n, basis = m.author_count(
            {"distinct_authors_24h": 116, "distinct_authors_total": 3})
        self.assertEqual((n, basis), (116, "24h"))

    def test_falls_back_to_cycle_on_old_rows(self):
        n, basis = m.author_count({"distinct_authors_total": 3})
        self.assertEqual((n, basis), (3, "cycle"))

    def test_empty_string_is_not_a_value(self):
        n, basis = m.author_count(
            {"distinct_authors_24h": "", "distinct_authors_total": 7})
        self.assertEqual((n, basis), (7, "cycle"))


class TestVersionGate(unittest.TestCase):
    """0.5.0 changed sentiment_activity values; older rows must not be trusted."""

    def _rows(self, version):
        return [_row(1, "2026-07-01T01:00Z", scraper_version=version,
                     hours_since_latest_tweet=0.5, sa_is_silent="False"),
                _row(2, "2026-07-01T02:00Z", scraper_version=version,
                     hours_since_latest_tweet=0.9, sa_is_silent="False")]

    def test_trusted_at_050(self):
        d = m.rollup_daily(self._rows("0.5.0"))[0]
        self.assertTrue(d["activity_trusted"])
        self.assertEqual(d["hours_since_latest_tweet"], 0.5)
        self.assertFalse(d["sa_is_silent"])

    def test_blanked_below_050(self):
        for v in ("0.3.0", "0.4.0"):
            d = m.rollup_daily(self._rows(v))[0]
            self.assertFalse(d["activity_trusted"], v)
            self.assertIsNone(d["hours_since_latest_tweet"], v)
            self.assertIsNone(d["sa_is_silent"], v)

    def test_mixed_day_is_untrusted(self):
        rows = self._rows("0.5.0")[:1] + [
            _row(2, "2026-07-01T02:00Z", scraper_version="0.4.0",
                 hours_since_latest_tweet=0.9, sa_is_silent="False")]
        self.assertFalse(m.rollup_daily(rows)[0]["activity_trusted"])

    def test_missing_version_is_untrusted(self):
        rows = [_row(1, "2026-07-01T01:00Z", hours_since_latest_tweet=0.5)]
        d = m.rollup_daily(rows)[0]
        self.assertFalse(d["activity_trusted"])
        self.assertIsNone(d["hours_since_latest_tweet"])

    def test_authors_24h_is_max_never_summed(self):
        rows = [_row(1, "2026-07-01T01:00Z", distinct_authors_24h=100),
                _row(2, "2026-07-01T02:00Z", distinct_authors_24h=140),
                _row(3, "2026-07-01T03:00Z", distinct_authors_24h=120)]
        self.assertEqual(m.rollup_daily(rows)[0]["distinct_authors_24h"], 140)


class TestDriversByLabel(unittest.TestCase):
    """Phase 2.4b contradiction fix."""

    def test_merge_sums_across_cycles(self):
        blobs = ['{"neg":{"fud_fear":2}}', '{"neg":{"fud_fear":3,"scam_rug":1}}']
        got = m._merge_by_label(blobs)
        self.assertEqual(got["neg"], {"fud_fear": 5, "scam_rug": 1})

    def test_drivers_restricted_to_label(self):
        day = {"cat_by_label": {"pos": {"pump_hype": 9},
                                "neg": {"negative_general": 4, "fud_fear": 1}}}
        self.assertEqual([d["category"] for d in m.drivers_for_label(day, "pos")],
                         ["pump_hype"])
        self.assertEqual([d["category"] for d in m.drivers_for_label(day, "neg")],
                         ["negative_general", "fud_fear"])

    def test_absent_block_returns_empty_not_error(self):
        self.assertEqual(m.drivers_for_label({}, "pos"), [])
        self.assertEqual(m._merge_by_label([None, "", "{bad"]), {})

    def test_emoji_categories_have_no_driver_label(self):
        day = {"cat_by_label": {"pos": {"emoji_pos": 9, "pump_hype": 2}}}
        self.assertEqual([d["category"] for d in m.drivers_for_label(day, "pos")],
                         ["pump_hype"])


class TestWeightedMean(unittest.TestCase):

    def test_skips_none_and_nonpositive_weights(self):
        self.assertAlmostEqual(m.weighted_mean([(1.0, 10), (None, 10), (0.0, 0)]), 1.0)

    def test_all_invalid_returns_none(self):
        self.assertIsNone(m.weighted_mean([(None, None), (1.0, 0)]))

    def test_empty(self):
        self.assertIsNone(m.weighted_mean([]))






class TestQuietSummaryAuthorBasis(unittest.TestCase):
    """The k>=5 follower/author suppression was built, measured and REMOVED on
    2026-07-28: it applied a private-data framework to public posts. Two tests
    asserting the blanked-author behaviour were deleted with it. Do NOT restore
    them, and do not add a floor to make them pass. `quiet_summary`'s second
    argument is baseline POSTS, never a k floor.
    """

    def test_reports_the_24h_count_not_the_cycle_count(self):
        """2 this cycle, 30 over 24h -> report 30."""
        got = m.quiet_summary(
            {"posts_total": 8, "distinct_authors_total": 2, "distinct_authors_24h": 30}, 5)
        self.assertEqual(got["authors"], 30)

    def test_authors_reported_when_present(self):
        got = m.quiet_summary(
            {"posts_total": 40, "distinct_authors_total": 9, "distinct_authors_24h": 30}, 20)
        self.assertEqual(got["authors"], 30)

    def test_posts_always_survive(self):
        got = m.quiet_summary({"posts_total": 1, "distinct_authors_total": 1}, 4)
        self.assertEqual(got["posts"], 1)

    def test_zero_authors_reads_as_absent(self):
        got = m.quiet_summary({"posts_total": 3, "distinct_authors_total": 0}, 10)
        self.assertIsNone(got["authors"])


class TestDedupeTerms(unittest.TestCase):
    """Upstream ranks by frequency, which surfaces every inflection of one stem."""

    def test_collapses_inflections_of_one_stem(self):
        """FLOKI's real case: strong / a strong / the strongest are one idea.
        `strength` is left as a distinct word - the aim is five distinct slots
        rather than aggressive stemming that merges genuinely different terms."""
        got = m.dedupe_terms(
            ["strongest", "strong", "a strong", "the strongest"], 5)
        self.assertEqual(got, ["strongest"])

    def test_keeps_genuinely_distinct_words(self):
        got = m.dedupe_terms(["trust", "best", "bullish", "conviction", "better"], 5)
        self.assertEqual(len(got), 5)

    def test_strips_leading_articles_when_comparing(self):
        self.assertEqual(m.dedupe_terms(["pump", "the pump", "a pump"], 5), ["pump"])

    def test_respects_the_limit(self):
        got = m.dedupe_terms(["a", "bb", "ccc", "dddd", "eeeee", "ffffff"], 3)
        self.assertEqual(len(got), 3)

    def test_preserves_upstream_ranking(self):
        got = m.dedupe_terms(["moon", "rekt", "lfg"], 5)
        self.assertEqual(got, ["moon", "rekt", "lfg"])

    def test_empty_input(self):
        self.assertEqual(m.dedupe_terms([], 5), [])

    def test_matches_shared_word_in_any_position(self):
        """OP, the coin called Optimism. The shared word sits in a different
        position each time, so keying on the leading token let all three past."""
        got = m.dedupe_terms(
            ["with optimism", "renewed optimism", "optimism about",
             "embrace", "joy", "unwavering"], 5)
        self.assertEqual(got, ["with optimism", "embrace", "joy",
                               "unwavering"])

    def test_matches_when_the_two_sides_stem_differently(self):
        """fakes -> fak under -es, while fake has no suffix to strip, so a single
        stem per word never lets them meet. Same shape: vibes/vibe."""
        self.assertEqual(m.dedupe_terms(["fakes", "scam", "fake"], 5),
                         ["fakes", "scam"])
        self.assertEqual(m.dedupe_terms(["vibes", "gm", "vibe"], 5),
                         ["vibes", "gm"])
        self.assertEqual(m.dedupe_terms(["rejection", "dip", "rejected"], 5),
                         ["rejection", "dip"])

    def test_returns_fewer_than_limit_rather_than_repeating(self):
        got = m.dedupe_terms(["strong", "strongest", "a strong"], 5)
        self.assertEqual(got, ["strong"])

    def test_stopwords_alone_do_not_merge_phrases(self):
        """"all in" and "go for it" share only stopwords and stay separate."""
        got = m.dedupe_terms(["all in", "go for it", "send it"], 5)
        self.assertEqual(len(got), 3)

    def test_does_not_merge_unrelated_words(self):
        got = m.dedupe_terms(
            ["breakout", "conviction", "stellar", "jackpot", "treasure"], 5)
        self.assertEqual(len(got), 5)

    def test_short_words_are_not_over_stemmed(self):
        """gas/less/off must survive suffix stripping intact."""
        got = m.dedupe_terms(["gas", "less", "off", "all"], 5)
        self.assertEqual(len(got), 4)

if __name__ == "__main__":
    unittest.main(verbosity=2)
