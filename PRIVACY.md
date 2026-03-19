# Privacy Policy

**Instrumetriq - Crypto Sentiment & Market Pulse**
Last updated: March 19, 2026

---

## Summary

Instrumetriq does not collect, store, or transmit any personal information.
It reads only what is strictly necessary to display market chatter data for the coins you choose to track.

---

## What the Extension Reads

### Current tab URL (coin detection)
When you open the popup, the extension reads the URL of your active tab to detect whether you are on a supported trading or data site (such as Binance, TradingView, CoinGecko, etc.). A symbol like `BTC` or `ETH` is extracted from the URL using pattern matching. This value is used only to display a matching card in the popup. It is **never stored**, **never logged**, and **never sent anywhere**.

No page content, DOM elements, form data, cookies, or browsing history are accessed at any point.

### Your settings (local storage only)
The extension stores your preferences using `chrome.storage.local`, which is private to your device and browser profile. No data from this storage is ever transmitted externally.

| What is stored | Why |
|---|---|
| Your selected coins (up to 2 free, unlimited Pro) | To know which cards to show |
| Badge mode (my coins / all coins) | To control the toolbar badge |
| Notifications on/off | To control spike alerts |
| Theme (dark / light / auto) | To remember your display preference |
| Last payload received | To display data when offline or between polls |
| Pro status cache | To avoid checking on every popup open |

---

## Network Requests

The extension makes exactly two types of outbound requests:

### 1. Market data feed
A `GET` request is made to `https://api.instrumetriq.com/data/extension_payload.json` approximately every 2 hours. This is a shared static file containing aggregated market metrics. No user data, coin selections, or identifiers are included in this request.

### 2. Pro license verification (Pro users only)
If you subscribe to Instrumetriq Pro, the extension contacts [ExtensionPay](https://extensionpay.com) to verify your license status. Payment processing and account management are handled entirely by ExtensionPay and Stripe. Instrumetriq never receives or stores your payment details or email address. See [ExtensionPay's privacy policy](https://extensionpay.com/privacy) for details on how they handle your data.

---

## What the Extension Does Not Do

- Does not collect or log your browsing history
- Does not read page content or scrape any website
- Does not include any analytics, telemetry, or tracking pixels
- Does not share any data with advertisers or third parties
- Does not create any user accounts or profiles
- Does not use cookies

---

## Permissions

| Permission | Why it is needed |
|---|---|
| `alarms` | Schedules polling every ~2 hours using `chrome.alarms` (the correct MV3 approach - no background keep-alive) |
| `storage` | Stores your preferences and the last payload locally on your device |
| `notifications` | Sends a desktop alert when a tracked coin crosses into Buzzing or Spiking |
| `activeTab` | Queries the active tab ID to ask the content script for the current coin symbol |
| Host: `api.instrumetriq.com` | Fetches the market data payload |
| Host: `extensionpay.com` | Verifies Pro subscription status |

The extension also injects a minimal content script on 25 supported trading and data sites. This script reads only `window.location.href` and responds to a single internal message from the popup. It performs no other action.

---

## Data Retention

All data stored by the extension lives exclusively in your local browser storage. You can clear it at any time by removing the extension or via your browser's extension storage management. Instrumetriq retains no copy of your settings or usage on any server.

---

## Contact

Questions about this policy: support@instrumetriq.com
