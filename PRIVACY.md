# Privacy Policy

**Instrumetriq - Crypto Sentiment & Market Pulse**
Last updated: March 19, 2026

---

## Summary

Instrumetriq does not collect, store, or transmit any personal information.
It reads only what is strictly necessary to show social conversation data for the coins you choose to track.

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
A `GET` request is made to `https://api.instrumetriq.com/data/extension_payload.json` every 5 minutes. An `If-Modified-Since` header is included, so the server responds with `304 Not Modified` (no body) when the feed has not changed. The payload file is rebuilt up to every ~10 minutes as new archive data arrives, but each individual coin's data is refreshed every 2-3 hours on average (per-coin scrape cadence). Most requests result in a 304. No user data, coin selections, or identifiers are included in any request.

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

Taken from `extension/manifest.json`, which is in this repository and can be checked
against this table.

| Permission | Why it is needed |
|---|---|
| `alarms` | Schedules a periodic check for new data using `chrome.alarms`, the standard approach for Manifest V3. No background process is kept alive. |
| `storage` | Stores your preferences and the last received data locally on your device |
| `activeTab` | When you click the icon, reads the address of the tab you are on so the popup can open to the coin you are looking at |

### Requested only if you ask for it

| Permission | Why it is needed |
|---|---|
| `notifications` | Desktop alerts when a tracked coin reaches unusual attention. This is an **optional** permission. Your browser will not ask for it at install, only if you switch alerts on, and revoking it stops the alerts without breaking anything else. |

### Site access

| Host | Why it is needed |
|---|---|
| `extensionpay.com` | Verifies Pro subscription status. This is the only site the extension has access to. |

The data feed at `api.instrumetriq.com` is fetched **without** a host permission, using
a standard cross-origin request. That is why the extension does not ask for access to
any address outside `extensionpay.com`.

### No content script on trading sites

Earlier versions injected a small script into supported exchange pages to detect which
coin you were viewing. That was removed in version 1.0.14. The extension now reads the
tab's address directly when you click the icon, granted by `activeTab`, and works out
the coin from the address alone.

The only script the extension runs on any page is the payment helper on
`extensionpay.com`.

---

## Data Retention

All data stored by the extension lives exclusively in your local browser storage. You can clear it at any time by removing the extension or via your browser's extension storage management. Instrumetriq retains no copy of your settings or usage on any server.

---

## Contact

Questions about this policy: support@instrumetriq.com
