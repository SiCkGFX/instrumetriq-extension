# Methodology

How Instrumetriq computes the indicators shown in the extension popup.

---

## Data source

Instrumetriq processes posts from X (Twitter) about cryptocurrency coins. The pipeline
collects posts matching known coin symbols and cashtags, then runs NLP analysis to
classify tone and extract engagement metrics. Data refreshes every 2-4 hours.

The extension does not scrape, collect, or read any data from the pages you visit.
It only reads the URL to detect which coin you are viewing.

---

## Engagement Coefficient (EC)

The core metric behind the chatter level indicator. EC measures how much attention a
coin is receiving on X, weighted by the reach of the accounts posting about it.

```
EC = (total_likes + total_retweets) x log(1 + follower_reach) / posts_total
```

- **total_likes** and **total_retweets**: sum of all likes and retweets across posts
  in the current cycle
- **follower_reach**: sum of follower counts of all authors who posted
- **posts_total**: number of posts collected in the cycle
- The logarithm prevents a single whale account from dominating the score
- Dividing by post count normalizes for volume - a coin with 5 high-engagement posts
  scores higher than one with 50 low-engagement posts

EC is displayed on a logarithmic scale in the sparkline chart. Values typically range
from 0 (no activity) to 20,000+ (major events).

---

## Chatter level

Each coin's current EC is compared to its own 30-day rolling mean. The ratio determines
the label:

| EC / 30-day mean | Label |
|---|---|
| Below 0.5x | **Quiet** - unusually low activity |
| 0.5x to 2x | **Active** - normal range |
| 2x to 6x | **Buzzing** - elevated discussion |
| Above 6x | **Spiking** - unusual surge in attention |

The baseline is recomputed every cycle, so it adapts to each coin's typical activity
level. A coin that is always busy has a higher baseline, and only unusually high
activity triggers Buzzing or Spiking.

---

## Tone analysis

Posts are classified by an NLP pipeline into positive, negative, or neutral sentiment.
The extension shows a tone shift relative to each coin's own baseline.

### How tone shift works

1. For each cycle, compute the raw net sentiment: `pos_ratio - neg_ratio`
2. Compute a baseline from the coin's last 30 days of qualifying cycles
   (minimum 30 samples required)
3. Shift = `(raw_net - baseline) x 100`, clamped to the range -100 to +100

The shift tells you whether the crowd is more positive or negative than usual for
this specific coin - not in absolute terms, but relative to its own history.

### Tone labels

| Shift value | Label |
|---|---|
| Above +16 | Bullish |
| +8 to +16 | Positive |
| -8 to +8 | Neutral |
| -16 to -8 | Negative |
| Below -16 | Bearish |

### Quality gate

Tone is only shown when all of the following pass:

- At least 5 posts collected in the cycle
- NLP confidence score above the minimum threshold
- Underlying X data flagged as healthy
- Data is from the latest cycle (stale tone labels are never shown)

When the quality gate fails, the card shows "Insufficient data" instead of a
potentially misleading label.

If fewer than 30 qualifying samples exist in the 30-day window (new coin or sparse
data), the raw net sentiment is shown as a fallback instead of the shift.

---

## Derivatives indicators

Derivatives data comes from exchange futures markets. Three indicators are shown when
data is available:

### Funding rate

The perpetual futures funding rate shows which side of the market is paying the other.

| Condition | Label |
|---|---|
| Funding rate > 0 | **Longs paying** - long positions pay short positions |
| Funding rate < 0 | **Shorts paying** - short positions pay long positions |
| Funding rate = 0 | **Neutral** |

The rate is shown as a percentage per 8-hour funding cycle (e.g., "0.012% / 8h").

### Open interest flow

The percentage change in total open interest over the recent period.

| Change | Label |
|---|---|
| Above +0.5% | **OI rising** - new positions being opened |
| Below -0.5% | **OI falling** - positions being closed |
| Within +/- 0.5% | **OI stable** |

The absolute OI value in USD is also shown (e.g., "$1.2B").

### Whale positioning

The long/short ratio of top trader accounts, compared to the market-wide distribution.

| Condition | Label |
|---|---|
| Ratio above 75th percentile (market-wide) | **Whales leaning long** |
| Ratio below 25th percentile (market-wide) | **Whales leaning short** |
| Between 25th and 75th percentile | **Neutral** |

The 25th and 75th percentile thresholds are computed fresh each cycle across all coins
with valid futures data, so the labels reflect relative positioning within the current
market - not fixed thresholds.

### Derivatives quality gate

All futures rows are hidden (not shown at all) when any of these conditions are true:

- No futures contract exists for the coin
- Exchange data flagged as unhealthy
- Data flagged as stale
- Data is older than 1 hour

This prevents showing outdated or unreliable positioning data.

---

## 24-hour volume

Trading volume is ranked against the coin's own 30-day history using percentiles.

| Percentile | Label |
|---|---|
| Above 75th | **Elevated** |
| 50th to 75th | **Above avg** |
| 25th to 50th | **Below avg** |
| Below 25th | **Low** |

This tells you whether today's volume is high or low for this specific coin, not
compared to other coins.

---

## Sparkline chart

The engagement chart shows EC values over time with tone coloring on each bar.

### Timeframe modes

| Mode | Window | Granularity |
|---|---|---|
| **C** (Cycle) | Last 7 days | One bar per data cycle (every 2-4 hours) |
| **D** (Day) | Last 30 days | One bar per calendar day (average EC for the day) |
| **W** (Week) | Last 4 weeks | One bar per 7-day window (average EC for the week) |

### Bar heights

EC values are displayed on a logarithmic scale (`log(1 + EC)`), normalized so the
tallest bar fills the chart. The log scale prevents extreme spikes from flattening all
other bars.

### Bar colors

Each bar is colored by the tone shift for that time period:

| Tone shift | Color |
|---|---|
| Above +8 (more positive than usual) | Green |
| Below -8 (more negative than usual) | Red |
| Between -8 and +8, or no data | Gray |

---

## Feed health

If no new data has arrived for 6+ hours, the extension shows an amber badge and a
"Data temporarily unavailable" notice. This indicates a pipeline interruption, not a
problem with any specific coin.

---

## What this is not

Instrumetriq shows what the crowd on X is saying about crypto coins. It does not:

- Generate trading signals, buy/sell indicators, or price predictions
- Forecast price movements or market direction
- Provide financial advice of any kind

The data may be delayed by 2-4 hours. Social chatter and derivatives positioning are
context for your own research - nothing more.
