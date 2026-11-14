# Navigation: the start, the sidebar's foot and the account menu

## Sub-features

### Product contract (owner, 2026-11-12 evening, R-SIDE-01 and R-SIDE-02)

Home is gone. After a day of redesigns he did not want, the owner said 「首頁不用變成行事曆 直接就是最大的幕僚長的對話就好」,
「需要開啟再開啟行事曆即可」, 「每天早上一份報告這個我會自己跟拉菲爾說」 and, asked whether the Home work goes, 「對 都刪掉」. With
Grok Bot's pictures he asked for the foot to be 「做的跟 grok bot 這邊一模一樣」, dictation and the calendar moving beside it and the
Connections pill having an effect on hover.

- **The start.** The app opens on Raphael's conversation, the top row of the sidebar selected, on a first run after the guide, and for
  every route that went to Home (the tray's first item, which now says 打開 Raphael, `START_PAGE` in `navigation-pages.ts`). The
  guide itself is as it was. There is no house button and no page button in the sidebar: the only places a row stands selected are the
  open conversation's own (away from the conversation page none is).
- **The foot (list).** One row at the bottom of the list, as Grok Bot's: the owner's round face (32px; a real button named by the owner;
  it opens the account menu) and, taking the rest of the row, the 連結應用程式 pill (36px, fully round, `--surface-2`, no frame, no
  tooltip): its words (medium weight) and the connected apps' marks (up to three) are one group centred in it, the marks right after the
  words, each on a white tile (`.sidebar-app-mark`, 14 x 16px, radius 4px, `--marks-tile`) with the tiles touching at rest. The update notice stays above
  the row. The words never wrap; the marks that do not fit are dropped, last first (`fitMarks` in `sidebar.ts`, on every resize of the
  pill); only a translation longer than the whole pill is cut, with an ellipsis.
- **The hover.** Under the pointer the marks fan out like a hand of cards, with Grok Bot's measured values: the outer ones move 3px away
  from the middle one and turn 8deg outward, the middle one lifts 1.5px, all grow to 1.1, in 180ms ease-out and back in 280ms ease-in-out;
  the fill takes the hover token and the words do not move. Tile `transform` only, finite, none under reduced motion. The values are
  `--marks-spread`, `--marks-lift`, `--marks-scale`, `--marks-turn`, `--marks-time-in`, `--marks-ease-in`, `--marks-time-out` and
  `--marks-ease-out` on `.sidebar-apps`, retuned in one place.
- **The account menu.** Pressing the face opens it above the face, left edges together (beside the whole rail, 8px past its right edge, ending where the face ends): 用量 (a chevron and no number, since 2026-11-14: one provider's figure under the bare word read as everyone's; pointing at it or pressing it opens a submenu at its right
  edge with a block for every provider the owner uses, in a stable order: the subscriptions the reading returns (Claude, Codex, Antigravity, in its order), the ChatGPT sign-in, then OpenRouter. A subscription: its tightest window's name such as 「Codex 每週」, its 已使用 N% and 「6 天後重置」;
  one that reported no percentage says what it reported (可使用, 接近額度上限, 額度已用完); a reported window past its reset is 已重置 with no number; one that cannot be read keeps its block and says 無法讀取 (the ChatGPT sign-in has no usage to read). OpenRouter: 「OpenRouter 本月 US$3.21」, and what is left of the key's limit under it. Owner, 2026-11-14: 「每一個有再使用的供應商都要顯示出來…除非沒有辦法顯示」.
  Then a hairline and 管理用量, which opens Settings at its usage section; with no provider known the row has no chevron and opens that section directly), 聽寫 (the dictation page), 行事曆 (the calendar on today),
  a hairline, 設定. Enter or Space on the face opens it with the focus on the first row, the arrows move, Esc closes it (the submenu alone
  first) and returns the focus to the face, a press outside closes it, the face again closes it (R-UI-124). It uses the app's menu tokens.
- **The member search.** The search button, Ctrl+Shift+F and the palette's Search (on the rail, which has no button, Ctrl+Shift+F) open one card in the middle of the dimmed window, across and down at every size (owner, 2026-11-14, R-MENU-04): 560 px wide (the window's less 24), 480 px tall (the window's less 96), so the words typed never move it, always below the window controls and inside the window. `sidebar-search` (button, typing never moves it), `sidebar-search-rail` (Ctrl+Shift+F on the rail) and `shortcut-search` (the palette) each check it with `search-card-middle`.
- **The rail.** Under 860px, or dragged narrow, the foot is a column: the plus alone (no search on the rail, owner 2026-11-12 23:25; Ctrl+Shift+F still opens it), the apps icon (Lucide `grid-2x2-plus`, accessible name
  only, no tooltip), then the face (named on hover, as the other faces of the rail). The menu is the same, opening beside the rail and covering none of its buttons.
- **What the numbers are.** `usage.allowances` (`api.usageAllowances()`), `chatgpt.status` and `status.get` (OpenRouter's own reading of the key), each read at each opening of the menu, shown at once from
  the last readings and landing as they arrive (a slow Codex read never holds back the others); a reading that fails changes only its own provider's block. What each reading means is decided once in `usage-blocks.ts`,
  which Settings' usage cards read as well, so the menu and the cards cannot disagree. Another unit owns how the allowances read refreshes.

## How to get to it (user POV)

Open the app: Raphael's conversation. Press the round face at the bottom left (the bottom of the rail): 聽寫, 行事曆, 設定, 用量. The
pill beside it is 連結應用程式.

## Driving it with look

```powershell
npm run look -- start-conversation start-startup-order foot-rest foot-account-menu foot-usage-submenu foot-usage-two foot-usage-default foot-usage-owner foot-usage-none foot-usage-manage foot-account-keys foot-usage-keys foot-account-outside foot-account-dictation foot-account-calendar foot-account-settings foot-pill-hover foot-pill-reduced foot-pill-narrow daily-footer-away sidebar-air sidebar-air-foot sidebar-rail opener-toggle-settings opener-toggle-account-menu after-onboarding --theme both --width 1120,720,1920x1080
```

start-conversation and foot-rest measure the foot at rest in both shapes (the list's one row: face 32px, pill 36px and round on
`--surface-2`, 8px between, the pill to the foot's right edge, one row of two, words whole; the rail's column with the 36px icon button
and the face) and fail on any Home, house, microphone or page button; foot-account-menu measures the menu (four rows with distinct Lucide
icons, one hairline before 設定, placement above the face or right of it on the rail, inside the window, the chevron at the
right and no number, menu tokens); foot-usage-submenu and foot-usage-two the submenu (its place at the menu's edge and level with its row, one block per
provider of the mock (the subscriptions in its order, the ChatGPT sign-in when signed in, OpenRouter with a key), in a stable order, each with name and its words (number and reset, 已重置, 無法讀取 or OpenRouter's spend), then a hairline and 管理用量; the first with Claude, Codex and Antigravity (the fixture's Gemini CLI) and OpenRouter, the second with the two the owner has connected and OpenRouter;
foot-usage-owner the owner's own mix of 2026-11-14 (Codex live at 65% used, Claude whose reported window has reset, the ChatGPT sign-in, OpenRouter with its own spend: exactly those four blocks, in that order, Claude with no number);
foot-usage-default the same with the fixture's own windows; foot-usage-none the row with nothing connected (no key either: no number, no chevron, no submenu); foot-account-keys and foot-usage-keys the keyboard
(focus on each row, ArrowRight, Escape closing the submenu alone and then the menu, the focus back on the face); foot-account-outside a
press inside the conversation closing the menu and its submenu; foot-pill-hover the marks' translate, turn and scale against the named values after the
motion settles (nothing to move on the rail) and foot-pill-narrow the narrowest list with the pill's words whole and the marks dropped.
sidebar-air checks the foot with the list's other geometry. Inspect every sheet and the full-size images in both themes.

Native readable-layout inspects the start at 720, 1920x1080 and 1280x800 and opens the calendar from the account menu; the calendar journey
opens a member's event on the Calendar page; the sidebar-foot journey measures the foot and the menu in the real WebView. The native
journeys were rewritten for this change and have not been run.

## Gotchas

### Data and refresh boundaries

`home.overview` stays, but only as the calendar's projection: `calendar_events`, `calendar_google` (and `calendar`, `calendar_items`,
`calendar_counts`, `today`, `reports`, `counts`, which the core's tests keep). The daily line Raphael's own model wrote for Home
(`today_plan`, `DailyNarratives`, `home.changed`), the health check, the charts, the spend, allowance and dictation figures and the
status report are no longer built or sent: the model is no longer asked once a day for nothing, and a calendar read no longer starts a CLI
allowance read. The owner's time zone, which Home sent with every start, now comes with `members.viewing` (the open conversation) and
reaches the calendar's zone and the computers' clock through `members.timezone_seen` (`home.note_timezone`).

Google Calendar uses connectors.status(refresh=false) and the existing private calendar_list_events tool only when ACTIVE/enabled; the
`composio:googlecalendar` toolkit also supplies it through the fixed core read path, and the direct Google sign-in wins when readable.
Unavailable, disabled or expired connections yield no connected events, and `calendar_google` says which it was; own events and local
routines remain available. Offline pytest covers the projection and HTTP doubles; browser fixtures prove the UI.

## First start-up (owner, 2026-11-11)

Owner: 「第一次開 app 的速度還是非常慢，就只有第一次而已」. The first view (the roster, the rooms, the open conversation) is asked for first;
the model, app and Settings read-ahead (`models.catalog`, `brains.cli`, Connect apps, Settings) wait until the first view is answered and
then run one at a time (`app/src/main/startup-reads.ts`, R-START-02). Scene: `start-startup-order` gives the mock core a 60 ms answer time
and fails if `models.catalog` or `brains.cli` began while `members.list` or `rooms.list` was still waiting for its answer, if those two
overlapped, or if a first-view read was never asked for. The roster carries no pictures (`members.picture`, R-START-06): the look mock
still inlines `avatar_url`, so the picture path is covered by vitest, not by look.
