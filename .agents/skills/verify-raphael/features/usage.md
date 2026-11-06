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

## How to get to it (user POV)

Open Settings > 模型與用量 > 用量. 重新整理 reads the allowances again; activity while the
page is open refreshes them quietly.

## Driving it with look

```powershell
npm run look -- usage usage-allowances-chatgpt usage-empty usage-key-menu usage-key-removed --theme both --width 1120,720,1920x1080
```

`usage-plain` asserts the cards stand above the rows, the bars keep their height, the
three rows are there, and nothing of the old analytics is on the page. `usage-empty`
has no subscription and no spend.

## Gotchas

CLI allowances and spend rows are synthetic. Look cannot prove provider billing or quota
refresh; a real subscription reading is native acceptance if that path changes.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.
