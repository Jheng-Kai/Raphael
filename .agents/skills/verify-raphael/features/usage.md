# Usage

## Sub-features

Usage is as plain as Grok Bot's (owner, 2026-11-06, R-UI-109). At the top, each signed-in
subscription brain (Claude, Codex, Antigravity) has one card: every window it reports
(5 hours, weekly) as the share left with a bar and when it resets, whether the number is
live or from the last run, and an honest line when the percentage is unknown or the
allowance ran out. ChatGPT has its card with 管理用量, which opens its own usage page.
With no subscription signed in the cards stand aside.

Below them are three rows: the OpenRouter key, what Raphael spent this month (the same
ledger as everywhere else) and the key's own monthly usage with its limit and what is left.

There are no periods, charts, breakdowns by purpose, member or model, work statistics,
CSV export or footnotes: the shell no longer allows `usage.analytics`, `usage.runs` or
`usage.export`, and `save_usage_csv` is gone (app/src-tauri/src/commands.rs
`usage_is_a_named_read_of_the_main_window_only`).

A window with 10% or less left is said once (owner decision 5, 2026-11-09, R-QUOTA-01).
Whoever reads it (a CLI turn, a background task or this page), the core tells each provider,
window and reset time once, `quota.warning` → `MainEvent::QuotaWarning`, and keeps what it told
in the `quota_warned` setting: a restart says nothing again, the next window after a reset is
told again. The main window shows one toast (`quota-warning.ts`, the shared toaster): the
subscription, the window, what is left and when it resets, as a time within a day and with its
date beyond. A hidden window shows it when next seen, and not at all once that window has reset.
A spent window keeps its own line, a subscription blocked by another window says nothing more,
and no model, member or setting moves.

## How to get to it (user POV)

Open Settings > 模型與用量 > 用量. The page has no refresh button (owner, 2026-11-11): each
opening of Settings, on whatever tab, reads Models and usage again at once and unseen
(`refreshInBackground` in settings.ts: the catalogue, the speech models, `usage.allowances` and
`chatgpt.status`), so the numbers are current by the time the tab is reached. The page shows what it last
knew immediately; a new value replaces the old in place, a reading that finds the same numbers
touches nothing, one that fails leaves what is shown, an opening while a reading is under way
joins it and one within 30 seconds of a good reading reuses it. Activity while the page is open
(a turn, a provider change) refreshes the allowances quietly as before.

What a reading really asks for, per subscription (no model turn is ever spent):

| Source | What `usage.allowances` does |
| --- | --- |
| Codex | Starts `codex app-server` and asks `account/rateLimits/read` (8 s limit): the live 5-hour and weekly windows and credits. |
| Claude | Nothing live. `claude auth status --json` only says whether it is signed in. The windows are what earlier turns reported in their `rate_limit_event` packets, each naming one window (`rateLimitType`), with the time it was updated. A window that no recent event named keeps its last row for good (the table is keyed by subscription and window) and shows 「更新於 …」, then 「此回報的重設時間已過」 once its reset time has passed. Which window the CLI names is the CLI's choice; Raphael cannot ask for one, so a 5-hour row can stay eleven days old while the weekly row is current. |
| Antigravity (Gemini) | Nothing live; only what its turns reported. |
| ChatGPT sign-in | No windows are recorded; the card has 管理用量 for ChatGPT's own page. |
| OpenRouter | Not part of this reading: the spend rows come from `status.get`, the key's own usage is OpenRouter's to show. |

The quota warning has no page of its own: it comes over whatever the window shows when a
subscription's window reaches nine-tenths used.

## Driving it with look

```powershell
npm run look -- usage usage-allowances-chatgpt usage-empty usage-opens-quietly usage-key-menu usage-key-removed --theme both --width 1120,720,1920x1080
```

`usage-plain` asserts the cards stand above the rows, the bars keep their height, the
three rows are there, nothing of the old analytics is on the page and no refresh button or
icon stands beside the tab's name or anywhere on it. `usage-empty` has no subscription and no spend.

`usage-opens-quietly` opens Settings on 一般 and asserts the mock IPC saw exactly one
`usage.allowances` at the opening; on the usage tab the cards are already there and nothing more
was asked. It closes Settings, moves the fixture clock 31 s and reopens (`usage-open-same`: one more
reading, and a MutationObserver on the allowances saw no change at all because the numbers were equal),
then lowers a fixture number and reopens again (`usage-open-changed`: the same card now shows the new
number, the observer saw it replaced in place, `aria-busy` was never true and no toast appeared).

```powershell
npm run look -- quota-warning quota-warning-weekly --theme both --width 1120,720,1920x1080
```

Both replay the shell's `QuotaWarning` at the fixture clock (10:00). `quota-warning` is a
Codex 5-hour window over a conversation: the toast above the composer (`toast-clearance`).
`quota-warning-weekly` is a Claude weekly Opus window over Home whose reset names its date.
`quota-warning` checks the exact words, the status role, the toast inside the window and that
no model, member or setting call follows the event.

## Gotchas

CLI allowances and spend rows are synthetic. Look cannot prove provider billing or quota
refresh; a real subscription reading is native acceptance if that path changes. The reading at
each opening is unit-proved with a fake core (settings-providers.test.ts) and in look with the
mock IPC; whether Codex's app-server answers in time (8 s) on a real machine is not.

Look replays the shell event only. Telling a window once, across restarts and resets, is
core/tests/agent/test_quota.py; passing only known identifiers is commands.rs
`a_quota_warning_carries_only_its_window_and_numbers`. A real subscription crossing 90% is
native acceptance. The own-harness ChatGPT sign-in records no windows, so it has no warning.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.
