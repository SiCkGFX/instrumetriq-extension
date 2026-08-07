<img src="extension/icons/instrumetriq-logo.svg" alt="Instrumetriq" width="480">

**What people on X (Twitter) are actually saying about crypto, right in your browser.**

Instrumetriq is a Chrome and Firefox extension that describes the conversation around
270+ coins: how many accounts are posting, in what proportion of positive to negative,
about what, and how that compares with each coin's own normal. Open any supported
exchange or coin page, click the icon, and read it without leaving your tab.

This is a passive awareness tool. It does not generate trading signals, price
predictions, or financial advice of any kind.

---

## Features

### Posting attention

How many distinct accounts posted about a coin in the latest update, against that
coin's own recent normal. Four bands, colour-coded throughout the card:

- **Quiet** - below half its usual
- **Steady** - around its usual
- **Busy** - 1.5x or more
- **Unusual** - 6x or more

When nobody posted in the latest update, it says "no posts" rather than showing a
multiple.

### Tone

The split of positive, neutral and negative language across the last 24 hours, with a
separate reading of whether the scoring agreed with itself. Descriptive only: it says
what posts said, never what a price will do.

### Discussed

The topics people actually raised - hype, fear, scam talk, memes, positive and negative
language - with example words behind each on hover.

### Who's posting

Distinct accounts over the last 24 hours, and at least how many of them were verified.

### Posts, volume and price

Posts in the last 24 hours against what is normal for that coin, plus 24h traded
value, price change and high-to-low swing from Binance.

### Market panel

The whole universe at a glance before you pick a coin: whether the conversation is more
or less positive than usual, which coins are busiest right now, and how many are seeing
unusual activity.

### Activity chart

Distinct accounts posting, per update window, per day or per week. Bar colour reflects
the tone of posts in that period.

### Every row explains itself

Any reading that cannot be filled stays in place and says why, rather than leaving a
gap: too few posts, nothing recognised, nobody posting, or not enough comparable
history yet.

### Auto-detection

Opens to the coin you are already looking at on a supported exchange or info site.

### Coin picker

Search and sort the full universe. Free tier tracks 2 coins; Pro tracks all of them.

### Badge indicator

Colour-coded icon reflecting activity across your tracked coins, or the whole universe.

### Notifications

Optional desktop alerts when a tracked coin reaches unusual attention. Permission is
requested only if you switch them on.

### Theme support

Light, dark, or follow the system.

---

## Pricing

**Free** - 2 tracked coins, all features included, no time limit.

**Pro** - all 270+ coins. Monthly ($5/mo) or yearly ($45/yr, save 25%). Payment
handled by Stripe via ExtensionPay. No account creation needed - just an email for
the receipt.

All data is visible to all users. Pro unlocks tracking more coins - nothing else is
paywalled.

> **Note for sideloaded installs:** If you install the extension by loading the `.zip`
> directly (developer mode / unpacked), ExtensionPay will route you to a test payment
> page and Pro cannot be activated. This is a limitation of ExtensionPay - it only
> enables real payments for extensions installed through an official browser store.
> To use Pro, install through the
> [Chrome Web Store](https://chromewebstore.google.com) or
> [Firefox Add-ons](https://addons.mozilla.org).

---

## Privacy

- No user data collected or stored on any server
- Coin detection uses the page URL only - the extension never reads page content
- All settings stored locally in `chrome.storage.local`
- Payments handled entirely by Stripe/ExtensionPay - we never see card details
- No analytics, no tracking pixels, no third-party scripts

---

## How it works

See [METHODOLOGY.md](METHODOLOGY.md) for how every reading is computed: the attention
bands and the baseline behind them, the tone and agreement thresholds, how topic
matches are counted, and how the chart is built.

---

## Repository layout

```
extension/           Extension source (popup, background worker, content script)
scripts/
  metrics_v2.py      Pure metric functions, unit-tested in isolation
  build_payload_v2.py  Computes every reading from per-coin CSVs, writes the JSON payload
  test_metrics_v2.py Unit tests for the metric layer
  build_zip.py       Builds distributable .zip files for Chrome and Firefox
nginx/               Server config template
METHODOLOGY.md       Full methodology documentation
CHANGELOG.md         Release history
```

---

## License

All rights reserved. Source code is provided for transparency and review. See the
extension store listing for terms of use.
