# Changelog

All notable changes to Instrumetriq will be documented here.

## [Unreleased] - Server-side

### Added
- 15 more coins are now tracked (272 total), including 1000SATS, 1000CAT, OM, JUV, RAY, and OSMO.

### Fixed
- Coins with a quiet current cycle but real chatter history no longer disappear from the list — they stay visible with their sparkline, level, and "updated" time.
- Funding and open-interest now show for ~38 coins where they were wrongly hidden (a staleness flag was misfiring on coins fetched later in the data-collection cycle).

### Changed
- AI narrative prompt rewritten (v2). The prompt now uses a system + user message split and instructs the model to produce exactly 2 sentences: one synthesising the social picture (chatter level, tone direction, author count), one interpreting what the derivatives signals suggest as a whole rather than listing funding, OI, and whale lean separately. Tone shift magnitude is pre-interpreted in the data layer before the model sees it: under 5 points = "essentially unchanged" (no directional language), 5-15 = mild, 15-30 = notable, 30+ = sharp. max_completion_tokens reduced from 120 to 100. No extension-side changes required - narratives are generated server-side by the Cloudflare Worker and cached in KV.

## [Unreleased] - Extension (targets v1.0.14, not yet submitted to stores)

### Removed
- The `scripting` permission. Coin detection no longer injects a script into trading pages: the popup reads the active tab's URL directly (granted by `activeTab` when you click the icon) and parses it locally. Same feature, smaller permission footprint. (The only script that still runs on any page is the manifest-declared ExtensionPay helper on extensionpay.com, used for payments.)

### Fixed
- Notifications: a coin that stays Buzzing/Spiking across multiple data cycles now alerts only once per hot-spell (it can alert again after cooling down). Previously it re-alerted every cycle, which would have been spammy at the new ~40-minute cadence.

### Added
- New "Chatter volume" row: posts and unique authors for the last update window. Hovering the numbers reveals the engagement behind them (likes + retweets, combined follower reach), and hovering the label shows the raw engagement coefficient and its multiple of the coin's own 30-day average.
- Spot-only coins (no Binance perpetual futures market) now show a "No futures contract" row instead of silently omitting Funding / OI flow / Whale lean. Also noted in "How it works".
- Tone labels now say why tone is hidden: "Too few posts" (a couple of viral posts can spike the chatter level while being too few to read tone from), "Unclear tone" (ambiguous language), or "Awaiting fresh data" - instead of a blanket "Insufficient data". The post threshold for tone was tuned from 5 to 4.

### Changed
- Copy refresh: coin counts now say "250+" (universe grew to 272); onboarding says data updates roughly every 50 minutes (was "~3 hours"); chart help describes ~2-hour bars.
- Chatter sparkline now adapts to higher-frequency data. When updates arrive more often than ~90 minutes apart, the per-cycle ("C") view groups bars into ~2-hour windows so the chart stays readable instead of collapsing into slivers — while the newest bar is always shown on its own, so it reflects the very latest update and its color matches the Chatter tone. Hovering a bar now shows the exact time (or time range) it covers. No visible change on the current feed; this takes effect when the faster data feed goes live.

## [1.0.12] - 2026-03-30

### Fixed
- AI narrative was re-fetched on every popup open because the in-memory cache (`narrativeCache{}`) lives in the popup's JS context, which is destroyed when the popup closes. Fixed by persisting the cache to `chrome.storage.local` under two new keys: `narrativeTexts` (symbol → text map) and `narrativePushedAt` (the feed timestamp the texts were generated for). On popup open, the stored cache is restored if `narrativePushedAt` still matches the current `pushed_at` (same data cycle). On feed cycle advance, the stored cache is cleared via `chrome.storage.local.remove('narrativeTexts')`. Result: reopening the popup surfaces previously fetched narratives instantly with no network call, for the lifetime of the current data cycle.

## [1.0.11] - 2026-03-29

### Fixed
- Race condition on first install where the coin picker could open before the initial payload fetch completed, showing "No coins match your search." Two changes: (1) `storage.onChanged` now calls `renderPickerList()` if the picker panel is currently open, so coins appear automatically when the payload arrives; (2) the onboarding Continue button now sends a `FETCH_NOW` message to the background if no payload is cached yet, ensuring the fetch is kicked off even if the background's `onInstalled` handler was slow to complete.

## [1.0.10] - 2026-03-29

### Fixed
- AMO validator flagged two `innerHTML` assignments in `fetchNarrative()` (popup.js lines 866 and 892). Replaced with `createElement` / `textContent` pattern using two scoped helper functions (`setNarrativeText`, `setNarrativeLoading`). No behavioral change - the fix is purely to satisfy AMO's static analysis requirement.

## [1.0.9] - 2026-03-29

### Fixed
- Notification spam: browser notifications were firing every poll cycle even when no new data had arrived. Root cause: `lastPushedAt` was set once on install and never updated, so `isNew = payload.pushed_at > lastPushedAt` was always `true` after the first feed cycle. Fixed by advancing `lastPushedAt` to `payload.pushed_at` whenever `isNew` is true, so subsequent polls for the same cycle are correctly identified as not new.

## [1.0.8] - 2026-03-29

### Fixed
- On Spiking coins, the X link and updated-ago timestamp were stacking vertically instead of sitting on the same row, pushing the card disclaimer off screen. Restored both elements into a single `.card-footer-row` flex container (space-between) placed after the narrative area.

## [1.0.7] - 2026-03-29

### Changed
- Card spacing reduced in seven places to recover vertical space for the narrative area: card padding (16px -> 12px), card-header margin-bottom (8px -> 4px), level-scale margin-bottom (10px -> 4px), x-axis margin-bottom (8px -> 4px), data-rows padding-top (8px -> 6px) and margin-top/bottom (6px/8px -> 4px/4px), data-row padding (6px 0 -> 4px 0).
- Popup height increased from 580px to 600px to accommodate the narrative area without sacrificing card content.
- Narrative text font size reduced from 12px to 11.5px.

## [1.0.6] - 2026-03-29

### Added
- AI narrative: a 1-2 sentence plain-language summary generated per coin on demand, rendered below the Whale lean row. Generated by OpenAI (gpt-5.4-nano) via `instrumetriq.com/api/coin-narrative`. Two-layer cache: in-memory JS object (invalidated when `pushed_at` advances) and server-side Cloudflare KV keyed by `{SYMBOL}:{pushed_at}`. Fetch is triggered lazily by `showCard()` when the user navigates to a coin - never during background polling. Only data sections with `ok: true` are included in the request. Silent failure on any error (area cleared, nothing shown to user).

### Changed
- Sparkline footnote ("Bars show engagement on a log scale. How it works") removed - the "How it works" link in the footer already covers this.
- Data row vertical padding reduced (6px -> 4px) to recover space for the narrative.
- "See what's being said" X link and "updated X ago" timestamp merged into a single flex row (link left-aligned, timestamp right-aligned). On Quiet/Active coins where the X link is absent, the timestamp sits on its own.
- Footer brand link now points to `https://pulse.instrumetriq.com` instead of the homepage.
- Server-side CORS policy updated to reflect the request origin for `pulse.instrumetriq.com`, `instrumetriq.com`, `chrome-extension://`, and `moz-extension://` origins (allowlist reflection pattern, no credentials involved).

## [1.0.5] - 2026-03-28

### Changed
- Tone shift labels replaced: removed 'Bullish' and 'Bearish' (which imply absolute positive/negative sentiment) with shift-relative labels that correctly describe movement relative to the coin's own baseline. New labels: 'Turning positive' (shift > +16), 'Leaning positive' (+8 to +16), 'Steady' (-8 to +8), 'Leaning negative' (-16 to -8), 'Turning negative' (below -16). The bar coloring thresholds are unchanged. Updated the methodology overlay text to match.

## [1.0.0] - 2026-03-19

First public release.

### Features
- Chatter level indicator (Quiet / Active / Buzzing / Spiking) based on X (Twitter) engagement
- Tone shift analysis (Turning positive / Leaning positive / Steady / Leaning negative / Turning negative) with quality-gated display
- Derivatives dashboard: funding rate, open interest flow, whale positioning
- 24-hour volume with percentile ranking against each coin's own 30-day history
- Interactive sparkline chart with three timeframe modes (Cycle / Day / Week)
- Automatic coin detection on 22 supported sites (17 exchanges, 5 info/analytics)
- Coin picker with search, sort by activity level, and free/pro gating
- Badge indicator: color-coded icon showing activity across tracked or all coins
- Notification alerts (one per update cycle, never spam)
- Theme support: Light / Dark / Auto
- Free tier: 2 tracked coins with full features
- Pro tier: all 257 coins, unlocked via ExtensionPay/Stripe
- Firefox support via separate build target
