# Methodology

How Instrumetriq computes what the extension shows.

---

## Data source

Instrumetriq reads public posts on X (Twitter) about the coins it tracks. A collection
pass sweeps every coin in turn, roughly once an hour, and each pass is processed as one
update window.

Only aggregates leave the pipeline. Account names, account ids, post ids and post text
are refused when the data is stored and never reach the extension. Everything in this
document describes counts and proportions computed over public posts.

The extension does not read the pages you visit. It reads the address of the tab you
are on to work out which coin you are looking at, and nothing else.

---

## The two windows

Every card is split into two parts, and the split is deliberate.

**Latest update** is the most recent completed collection pass. It carries the time it
was collected, which is usually some tens of minutes ago.

**Last 24 hours** is everything below the divider. A single update is often only a
handful of posts, which is too few to read a mood from. A day is enough to be
meaningful.

The two never mix. Where a number covers 24 hours, it is measured over a rolling 24
hours ending at the latest update, not over a calendar day.

---

## Posting attention

The headline reading. It counts how many distinct accounts posted about a coin in the
latest update, and compares that with the same coin's own recent normal.

The comparison is against the median of up to 20 earlier update windows in which the
coin had any activity at all, and needs at least 5 of them before it will say anything.
Silent windows are excluded from that median: a coin that is usually silent would
otherwise have a normal of zero, and any single post would read as an infinite jump.

| reading | meaning |
|---|---|
| **Unusual** | 6x its usual number of posting accounts or more |
| **Busy** | 1.5x to 6x |
| **Steady** | 0.5x to 1.5x |
| **Quiet** | below 0.5x |

If nobody posted in the latest update, the row says "no posts" rather than showing a
multiple. An absence is not a measurement.

The percentage in the tooltip is the share of tracked coins this one is busier than in
the same update. It is never 100%, because a coin cannot be busier than itself.

---

## Tone

The proportion of posts scored positive, neutral and negative over the last 24 hours,
shown as three percentages that sum to 100.

Tone needs at least 5 scored posts in the window. Below that the row says so rather
than reporting a figure, because two or three posts cannot describe a mood.

Tone describes what posts say. It is not a view on price, and no label in the extension
is phrased as one.

### How clear-cut

A separate reading of whether the scoring agreed with itself:

| shown | meaning |
|---|---|
| **clear** | most posts leaned the same way |
| **mixed** | opinion was divided, with strong views either side and little in between |
| **unclear** | the scoring pulled in different directions, so treat the tone above as rough |

This shares tone's 5-post threshold but is measured independently, so it can be
available when tone is not.

---

## Discussed

Topics raised in the last 24 hours, matched against a curated crypto vocabulary:
hype, fear, scam talk, memes, positive language, negative language.

The count beside each topic is **vocabulary matches, not posts**. One post can use
several words from the same topic, so the matches can exceed the post count.

Hovering a topic shows example words behind it. These are examples rather than a
ranking: words that repeat the same idea in different phrasings are collapsed, so five
slots carry five distinct words. Where a coin genuinely has fewer than five, it shows
what it has.

Topics are shown separately from tone and are not an explanation of it. They come from
different methods, and a broadly positive conversation can still discuss risks.

---

## Who's posting

Distinct accounts that posted in the last 24 hours.

The verified figure is a lower bound, written as "60+ verified". Verified accounts
cannot be de-duplicated across update windows, so the number shown is the count from
the busiest single update and the true figure over the day may be higher.

---

## Posts

Posts in the last 24 hours, next to what is normal for that coin.

Normal is the median of up to 14 earlier complete days. Only days collected under the
current matching rules are used. When a change to how posts are matched to coins makes
older days incomparable, they are dropped rather than averaged in, and the comparison
is withheld entirely until enough comparable days exist.

---

## Price and volume

Traded value over 24 hours, the change against 24 hours ago, and the high-to-low swing
in that period. All three come from Binance.

Change and swing answer different questions and neither can be derived from the other:
a coin can finish level after a 12% swing. Only the change carries a direction, so only
it is coloured.

These are market facts shown for context. Nothing links them to the social readings
above.

---

## Activity chart

Bars show how many distinct accounts posted, on the same measure as the attention
reading, so the chart and the headline cannot disagree.

### Timeframes

The three buttons switch between one bar per update window, per day and per week. The
first is labelled with the observed interval between updates, which drifts, so it is
measured over the last 24 hours rather than assumed.

### Bar heights

For day and week bars, height is the average over the update windows in which the coin
was actually being discussed, not over every window in the period. Averaging across
silent stretches would blend how busy a coin was with how often it was discussed into
one number a reader cannot separate. How often it was discussed is shown by how many
bars there are.

### Bar colours

Green, grey and red reflect the tone of posts in that period, on the same scale as the
tone row.

### Missing history

Where a change in how posts were matched means older bars counted a different
population, those bars are not drawn. The chart starts from the point the measurement
became comparable and rebuilds day by day. This affects a small number of coins whose
name is an ordinary English word.

---

## Feed health

If no coin has had new data for six hours or more, the extension shows an amber badge
and a notice. That indicates an interruption in collection, not a problem with any
particular coin.

---

## Limits

Worth knowing before reading anything into a card:

- English-language posts on X only. Conversation elsewhere is invisible here.
- Filtering of automated and promotional posts is imperfect.
- Quiet coins genuinely have little to report, and the extension says so rather than
  filling the space.
- A coin whose name is an ordinary word is harder to measure, because posts using that
  word are not necessarily about the coin.

---

## What this is not

Instrumetriq describes what people are saying about crypto coins on one social network.
It does not:

- Generate trading signals, buy or sell indicators, or price predictions
- Forecast price movements or market direction
- Provide financial advice of any kind

Social conversation is context for your own research, and nothing more.
