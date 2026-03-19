# Instrumetriq

**X (Twitter) chatter indicators for crypto, right in your browser.**

Instrumetriq is a Chrome and Firefox extension that shows you what the crowd is saying
about any coin - chatter levels, tone shifts, derivatives positioning, and volume -
updated every 2-4 hours. Open any supported exchange or coin page, click the icon, and
see the full picture without leaving your tab.

This is a passive awareness tool. It does not generate trading signals, price
predictions, or financial advice of any kind.

---

## Features

### Chatter level

Every coin is rated against its own 30-day baseline engagement on X:

- **Quiet** - unusually low discussion
- **Active** - normal range
- **Buzzing** - elevated chatter
- **Spiking** - unusual surge in attention

The underlying metric (Engagement Coefficient) accounts for likes, retweets, poster
reach, and post count. A visual scale strip on each card shows where the coin falls.

### Tone shift

NLP analysis classifies posts as positive, negative, or neutral and computes a shift
relative to the coin's own historical baseline:

- **Bullish / Positive / Neutral / Negative / Bearish** labels
- Shift magnitude shown (e.g., "+28 shift")
- Quality-gated: hidden when data is insufficient or stale, so you never see a
  misleading label

### Derivatives dashboard

For coins with perpetual futures contracts:

- **Funding rate** - are longs or shorts paying? Shown as a percentage per 8-hour cycle
- **Open interest flow** - is OI rising, falling, or stable? Absolute OI in USD included
- **Whale positioning** - top-account long/short ratio vs. the market-wide distribution

All derivatives rows are hidden entirely when the underlying data is stale or
unavailable - no partial or outdated displays.

### 24-hour volume

Current trading volume ranked against the coin's own 30-day history:
Elevated / Above avg / Below avg / Low.

### Engagement chart

Interactive sparkline showing engagement history with tone-colored bars:

- **Cycle mode (C)** - per-cycle bars over the last 7 days
- **Day mode (D)** - daily averages over the last 30 days
- **Week mode (W)** - weekly averages over the last 4 weeks

Bar heights use a log scale so spikes don't flatten everything else. Green bars = more
positive than usual, red = more negative, gray = neutral or no tone data.

### Auto-detection

The extension detects which coin you are viewing from the page URL (never reads page
content). Supported on 22 sites:

**Exchanges:** Binance, Bybit, OKX, Coinbase, TradingView, Kraken, Bitget, KuCoin,
Gate.io, MEXC, HTX, Crypto.com, Phemex, BingX, Bitfinex, dYdX

**Info/analytics:** CoinGecko, CoinMarketCap, CoinDesk, CryptoCompare, Messari,
DeFiLlama

When you open the popup on a supported page, the detected coin appears as a suggestion
card if it is not already in your tracked list.

### Coin picker

Search the full 257-coin universe by symbol. Sort alphabetically or by current
activity level (Spiking first, then Buzzing, etc.). Free users pick 2; Pro users
track as many as they want.

### Badge indicator

The extension icon shows a color-coded badge:

- **Cyan** - one or more coins are Buzzing or Spiking
- **Gray** - all coins are Quiet or Active
- **Amber** - data feed interrupted (no update in 6+ hours)

Badge scope is configurable: "My coins" (only your tracked coins) or "All coins"
(entire universe).

### Notifications

One aggregated notification per update cycle when any tracked coin crosses into
Buzzing or Spiking. Never per-coin spam. Suppressible with one click.

### Theme support

Light, Dark, or Auto (follows your system preference).

---

## Pricing

**Free** - 2 tracked coins, all features included, no time limit.

**Pro** - all 257 coins. Monthly ($5/mo) or yearly ($45/yr, save 25%). Payment
handled by Stripe via ExtensionPay. No account creation needed - just an email for
the receipt.

All data is visible to all users. Pro unlocks tracking more coins - nothing else is
paywalled.

---

## Privacy

- No user data collected or stored on any server
- Coin detection uses the page URL only - the extension never reads page content
- All settings stored locally in `chrome.storage.local`
- Payments handled entirely by Stripe/ExtensionPay - we never see card details
- No analytics, no tracking pixels, no third-party scripts

---

## How it works

See [METHODOLOGY.md](METHODOLOGY.md) for the full breakdown of how every indicator is
computed, including the Engagement Coefficient formula, chatter level thresholds, tone
shift calculation, derivatives quality gates, and volume percentile ranking.

---

## Repository layout

```
extension/           Extension source (popup, background worker, content script)
scripts/
  build_payload.py   Computes all metrics from per-coin CSVs, writes the JSON payload
  build_zip.py       Builds distributable .zip files for Chrome and Firefox
nginx/               Server config template
METHODOLOGY.md       Full methodology documentation
CHANGELOG.md         Release history
```

---

## License

All rights reserved. Source code is provided for transparency and review. See the
extension store listing for terms of use.
