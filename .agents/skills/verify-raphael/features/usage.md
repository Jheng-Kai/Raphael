# Usage

## Sub-features

用量 is a Settings tab of its own, right after 模型 (R-USE-01), with two small tabs (ui.ts `tabs()`): 概覽 and 分析.
模型 shows the models in use, the subscription accounts and the providers directly, with no tabs inside.

**概覽** (R-UI-109) is plain. 這個月 leads: a line of what it counts (what everyone spent with API keys since the first of
the month; subscriptions are not counted) and a card with 本月花費, the amount, one quiet line with where the month ends
at this pace and the limit (未設上限, or 上限 US$ X，已用 N% with a bar in Raphael's blue), and a gear (每月上限) at its top
right. The gear opens the monthly limit (R-USE-02, `usage-cap.ts`): a small popover of the app's own, 不設上限 or 設上限 as
a dropdown and, when set, a US$ field; a change is stored at once (不設上限 stores null; an amount when it is typed, with
Enter, leaving the field or closing the popover; what is not a number is said under the field). `monthly_limit_usd` is
null by default (no hidden cap for a new install), and null never stops anything.

方案額度 follows (`usage-analytics.ts`): each signed-in subscription brain (Claude, Codex, Antigravity) has one card, its
name with the maker's mark and, at its right, 訂閱; every window it reports (5 小時額度, 每週額度) has its name, how long until
it resets and what is left on one line, and a bar of what is left; a number from the last run says when it was updated, and
an honest line says when the percentage is unknown or the allowance ran out. A window whose reported reset has passed says
已重置, with no number or bar. ChatGPT has its card, named by its account, with 管理用量, which opens its own usage page, and
OpenRouter has its card with its key's limit as OpenRouter itself reports it (this month's use, the limit, what is left and
its bar). With nothing signed in or keyed the cards stand aside. The account menu's 用量 submenu lists the same providers,
one block each (its tightest window and its number, with no reset time; 已重置; OpenRouter's spend; or 無法讀取 for one that
cannot be read), from the same readings, decided once in `usage-blocks.ts`.

**分析** (R-USE-03, `usage-analysis.ts`) reads the core's `usage.analytics` (read-only; the shell allows it and still refuses
`usage.runs`, `usage.export` and `usage.clear`: commands.rs `usage_is_a_named_read_of_the_main_window_only`) for 7 or 30
days. Four sections: 花費紀錄 (the period's total, a stacked bar a day with its scale and two lines, the dates of a few days,
and a legend with each line's share; by purpose, model or provider in a dropdown; no 依成員, since no member is kept a day),
誰花最多 (each one's face, replies, cost and most used model, five rows then 顯示更多), 工具使用 (a line a day per kind of tool,
with counts) and 訊息 (a line a day per model or source, a segmented choice). A section with nothing in the period says so in
one line; `__other__` reads 其他, a model as the app names models, purposes, tools and sources in words.

A window with 10% or less left is said once (R-QUOTA-01).
Whoever reads it (a CLI turn, a background task or this page), the core tells each provider,
window and reset time once, `quota.warning` → `MainEvent::QuotaWarning`, and keeps what it told
in the `quota_warned` setting: a restart says nothing again, the next window after a reset is
told again. The main window shows one toast (`quota-warning.ts`, the shared toaster): the
subscription, the window, what is left and when it resets, as a time within a day and with its
date beyond. A hidden window shows it when next seen, and not at all once that window has reset.
A spent window keeps its own line, a subscription blocked by another window says nothing more,
and no model, member or setting moves.

## How to get to it (user POV)

Open Settings > 用量 (or the account menu's 用量 › 管理用量); it opens at 概覽. The page has no refresh button: each
opening of Settings, on whatever tab, reads 模型 and 用量 again at once and unseen
(`refreshInBackground` in settings.ts: the catalogue, the speech models, `usage.allowances` and
`chatgpt.status`), so the numbers are current by the time the tab is reached. The page shows what it last
knew immediately; a new value replaces the old in place, a reading that finds the same numbers
touches nothing, one that fails leaves what is shown, an opening while a reading is under way
joins it. Every opening asks again, however soon after the last; only the catalogue and the speech models are reused for 30 seconds. 分析 reads its period each time it is opened or the period changes, showing what it last read for that period until the answer comes. In the core, readings that overlap (Settings opened twice, Settings and another reader) share one read and one `codex app-server`; a live reading replaces the stored windows, drops a window the provider no longer reports, and tells the other readers (`quota.changed`) only when something really changed; a reading that fails or finds no window keeps the last known numbers and says nothing. A told warning is told again when its window is later read with 20% or more left and falls to the last tenth again. Activity while the page is open
(a turn, a provider change) refreshes the allowances quietly as before.

What a reading really asks for, per subscription (no model turn is ever spent):

| Source | What `usage.allowances` does |
| --- | --- |
| Codex | Starts `codex app-server` and asks `account/rateLimits/read` (8 s limit): the live 5-hour and weekly windows and credits. |
| Claude | Nothing live (no CLI command or file gives its windows without a model turn; `claude auth status` only says whether it is signed in). Its card can therefore keep an old 「接近額度上限」 until a Claude turn names that window again. The windows are what earlier turns reported in their `rate_limit_event` packets, each naming one window (`rateLimitType`), with the time it was updated. A window that no recent event named keeps its last row for good (the table is keyed by subscription and window) and shows 「更新於 …」, then 「此回報的重設時間已過」 once its reset time has passed. Which window the CLI names is the CLI's choice; Raphael cannot ask for one, so a 5-hour row can stay eleven days old while the weekly row is current. |
| Antigravity (Gemini) | Nothing live; only what its turns reported. |
| ChatGPT sign-in | No windows are recorded; the card has 管理用量 for ChatGPT's own page. |
| OpenRouter | Not part of this reading: its card and the menu's block read `status.get` (`openrouter.usage`, the key's own monthly use and remaining limit); the spend row is the app's ledger. No key, or the key not yet asked: no card. A key OpenRouter refuses, or with no usage: 「無法讀取」. |

The quota warning has no page of its own: it comes over whatever the window shows when a
subscription's window reaches nine-tenths used.

## Driving it with look

```powershell
npm run look -- settings-usage-overview settings-usage-cap settings-usage-analytics settings-usage-analytics-empty usage usage-owner usage-allowances-chatgpt usage-empty usage-opens-quietly --theme both --width 1120,720,1920x1080
```

`settings-usage-overview` checks `usage-overview`: 這個月 says what it counts, the gear stands at the card's top right with
no words under it, every window has its name over when it resets (left) and what is left (right), and no card is wider than
the tab. `settings-usage-cap` opens the gear (`usage-cap-open`: the fixture's limit of US$20 opens as 設上限 with 20),
chooses 不設上限 (`usage-cap-none`: `settings.set` with null, the card says 未設上限 with no bar) and then 設上限 with 30 and
Enter (`usage-cap-set`: stored at once, the card's line and bar follow, the popover stays open). `settings-usage-analytics`
checks the week (`usage-analytics`: `usage.analytics` asked for 7d, seven bars and three dates, the purposes in words with
其他, five people then 顯示更多, six lines) and, after 顯示更多, 依來源 and 30 天, the month (`usage-analytics-month`: thirty
bars and five dates, six people, the sources in words). `settings-usage-analytics-empty` is a period with nothing in it:
one line a section and no chart frame. The mock's `usage.analytics` (mock-ipc.js) makes its numbers from fixed waves.

`usage-owner` is the owner's own mix (Codex live, Claude whose window has reset, the ChatGPT sign-in, OpenRouter) and checks `usage-owner-cards`: four cards in that order, Claude with no number or bar.
`usage-plain` asserts this month's card leads 概覽 and the allowance cards follow it, the bars keep their height, no chart
of 分析 is on 概覽 and no refresh button or icon stands beside the tab's name or anywhere on it. `usage-empty` has no
subscription and no spend.

`usage-opens-quietly` first asserts the app read `usage.allowances` once after it started, before
Settings was ever opened (`usage-open-launch`); it then opens Settings on 一般 and
asserts the mock IPC saw exactly one more at the opening; on the usage tab the cards are already there and nothing more
was asked. It closes Settings, moves the fixture clock 31 s and reopens (`usage-open-same`: one more
reading, and a MutationObserver on the allowances saw no change at all because the numbers were equal),
then lowers a fixture number and reopens again (`usage-open-changed`: the same card now shows the new
number, the observer saw it replaced in place, `aria-busy` was never true and no toast appeared).

```powershell
npm run look -- quota-warning quota-warning-weekly --theme both --width 1120,720,1920x1080
```

Both replay the shell's `QuotaWarning` at the fixture clock (10:00). `quota-warning` is a
Codex 5-hour window over a conversation: the toast above the composer (`toast-clearance`).
`quota-warning-weekly` is a Claude weekly Opus window over the calendar whose reset names its date.
`quota-warning` checks the exact words, the status role, the toast inside the window and that
no model, member or setting call follows the event.

## Gotchas

CLI allowances, spend rows and the analytics are synthetic. A real `usage.analytics` reading is core/tests/brain/test_usage.py;
the monthly limit's null in the core (settings, `SpendTracker.is_over`, every caller) is pytest (R-USE-02). Look cannot prove provider billing or quota
refresh; a real subscription reading is native acceptance if that path changes. The reading at
each opening is unit-proved with a fake core (settings-providers.test.ts) and in look with the
mock IPC; whether Codex's app-server answers in time (8 s) on a real machine is not.

Look replays the shell event only. Telling a window once, across restarts and resets, is
core/tests/agent/test_quota.py; passing only known identifiers is commands.rs
`a_quota_warning_carries_only_its_window_and_numbers`. A real subscription crossing 90% is
native acceptance. The own-harness ChatGPT sign-in records no windows, so it has no warning.

## Shared content measures

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.
