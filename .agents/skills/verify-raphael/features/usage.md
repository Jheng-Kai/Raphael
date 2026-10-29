# Usage

## Sub-features

The overview starts with the selected period's ledger bill: conversations and work,
speech recognition, dictation cleanup, memory and any other purpose, each with an
amount, share and bar. This month's total equals the sidebar, using the same spend
tracker, clock and calendar zone. History deletion never reduces the bill.

CLI subscriptions link to allowances and enabled Fish Audio voice is identified as
separately billed. These exclusions appear only when applicable. Below the bill,
Conversations and work contains retained run cost, time, tokens, AI steps, tool uses,
errors and member/model/day/provider/routine groups, with a retained-record caveat.
CSV remains retained-run data. No per-run list or trace navigation.

## How to get to it (user POV)

Open Settings > Models > Usage. Select this week, this month, last month or all time.
Read the bill before retained work metrics. Expand members, change grouping or export
CSV. The subscription exclusion button scrolls and moves focus to allowances below.

## Driving it with look

```powershell
npm run look -- usage usage-bill-breakdown usage-members usage-period usage-group-day usage-group-provider usage-group-routine usage-empty usage-allowances --theme both --width 1120,720,1920x1080
```

Keep all summary/group/allowance PNGs and the report. Inspect both themes at all
three sizes for monetary labels and overflow. `usage-bill-breakdown` asserts the
ledger total and formatted amount equal the sidebar, includes all purposes and an
unknown purpose, and identifies enabled Fish Audio voice and subscription allowances.
The fixture's spend rows drive period bills. `usage-empty` clears ledger rows and
retained runs independently of subscriptions. Core tests cover local month equality,
calendar boundaries, DST, all periods, unknown purposes and retained-record deletion.

## Gotchas

CLI allowances and spend rows are synthetic. Scroll before driving lower sections.
Look cannot prove provider billing, native persistence, quota refresh or CSV filesystem
writes. Retained run periods use the requested IANA display zone; bills always use the
sidebar ledger's zone and full calendar boundaries. A real harmless turn/routine and
sanitized export remain native acceptance if those paths change. No live provider or
user database access is required for this presentation change.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Owner round 6 contracts

Owner round 6: usage/usage-bill-breakdown display the zh-TW glossary term 權杖數 and remove the breakdown helper paragraph. CSV export uses the shared download icon button with an accessible localized name and tooltip. compact-action asserts the icon-only control and localized heading.
