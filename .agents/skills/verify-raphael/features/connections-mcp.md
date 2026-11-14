# Connections and MCP

## Connect apps as Grok Bot's, one view (2026-11-12): read this first

This section supersedes every later paragraph that speaks of the 已連結 and 商店 tabs, the tab counts, the pager of 18-card pages,
the chip row that scrolls sideways (`plugins-store-wheel`), the store that lists only the apps not added yet, the need words on a
row, the 推薦 section under a list of the connected, and the dialog of a connected service (`.cs-dialog` over the list). Owner,
2026-11-12: 「它不會分已連結跟商店，他們都在一起的…上面放你已連接的，下面放一些推薦的…分全部、溝通、生產力、開發之類的…也不會顯示它現在有幾個」
(R-APPS-01, R-APPS-02, R-FLOAT-01).

- The dialog is one view: the title at the left and, at the right, a quiet chip with the marks of up to four connected apps and
  「N 個已連結」 (N is the core's count; with nothing connected the chip is not there; with no number to give it says only 「已連結」);
  a search 「搜尋應用程式」 over the whole catalog with 新增 beside it; one row of chips (全部, the first five categories, 更多 with the
  rest; a chip that does not fit moves into 更多, the row never wraps or scrolls); then, under 全部, 為你推薦 and a section of six apps for each
  category, each with 查看全部 (which chooses that chip). A chosen chip lists all its apps, drawn 24 at a time as the list scrolls; a
  search replaces the sections and ignores the chip; no count of the catalogue is anywhere.
- A row is the app's mark on a white 40 px tile, its name, and 「連結」 (a round button filled `--float-ctl`) or 「✓ 已連結」. The row opens
  the app's page; 「連結」 runs the existing flow (sign-in, key form, the conversation for n8n, own Google and developer apps).
- The chip opens the list of the connected apps in the same dialog (rows with tile, name, line and switch; 應用程式 and 尚未連結
  headings as before), behind a back chevron. Esc steps back from an app's page, then from that list, then closes.
- A connected row is pressable (2026-11-14): the mark, the name, the line and the gap open the app's page (the page the main view's row opens),
  the switch only turns the app on or off; a row under the pointer has the pointer and `--float-hover` clear of its words, in the main view's rows too (scene `connect-apps-row-hover`). The back chevron (the
  list's title row and every app's page) is the ✕'s own 36 px round control with an 18 px glyph, on the ✕'s line. Scenes
  `connect-apps-connected-rows` (a real press on each part of a row, the keyboard, the switch, the hover) and `connect-app-from-row`; the check
  `connect-back` is on every scene that shows the chevron.
- The owner's own list (his picture of 2026-11-14: Gmail, Google Calendar and Google Drive from Composio, Mobbin MCP of his own, Notion, Hugging Face and GitHub built in,
  all on, no heading) is the fixture `OWNER_LIST` in `scenes/connect-apps.mjs`: `connected-owner-rows` presses the line, the name, the mark, the empty end and the top edge
  of all seven (real `page.mouse` presses, each must open that app's own page), `-loaded` after every app's tools were read and after a `ConnectionsChanged`, `-late` and
  `-failed` with the tools slow or failing (`toolsLate`, `toolsFail`), `-straddled` with the core's event arriving between the button going down and coming up
  (`pressThrough`). A page that draws itself again from under a press loses it, so `load()` draws only when the reading changes what the dialog drew (`drawn`).
- 「✓ 已連結」 of a main-view row is pressable (the row opens the app's page from anywhere but 連結): `connected-owner-state-press`, check `app-state-press`.
  On an app's own page it stays words: its destination would be the page itself.
- An app's page replaces the view (no title row; a bare back chevron and the dialog's ✕): the mark on a 56 px white tile with the name,
  and at the right 「連結」 (white, round) or, when connected, 「✓ 已連結」 with its switch and ⋯; a paragraph; accounts; for a connected app
  a 工具 card (kind switches, the folded tool list); a 資訊 card (提供者, 類別, 登入方式, 伺服器, 工具) of 38 px rows; the latest actions and
  the 試用, sign-in and refresh buttons. After a sign-in from a page the page stays and shows the connected state.
- The colour rule for everything that floats (R-FLOAT-01): `--float`, `--float-edge`, `--float-ctl`, `--float-hover`, `--float-sel`,
  `--float-on-sel` in styles.css, one scope (`:where(.menu, .modal, .mb-dialog, ...)`) that points the ordinary tokens at them, and the
  `float-surface` check appended to the scenes of its consumers: delete question (`member-delete-ask`), a context menu
  (`context-menu-member`), the composer's model menu (`composer-model-small`, `composer-model-sources`), the member maker (`member-maker`), the
  calendar's popovers (`automations-detail-own`, `automations-create-slot`), the model chooser (`model-choices-answer`), the theme menu
  (`appearance-menu`), the settings dialog (`profile`), and the menus of this dialog (`connections-add-menu`, `server-menu`,
  `connections-delete`, `connect-apps-more`).

```powershell
npm run look -- connect-apps connect-apps-scrolled connect-apps-category connect-apps-more connect-apps-search connect-apps-connected connect-app-oauth connect-app-key connect-app-connected connect-apps-connected-rows connect-app-from-row connect-apps-row-hover connected-owner-rows connected-owner-rows-loaded connected-owner-rows-late connected-owner-rows-failed connected-owner-rows-straddled connected-owner-state-press --theme both --width 1120,720,1920x1080
npm run look -- member-delete-ask context-menu-member composer-model-small composer-model-sources member-maker automations-detail-own automations-create-slot appearance-menu model-choices-answer profile connections-add-menu server-menu connections-delete --theme both --width 1120,720,1920x1080
```

Marks and inner cards (2026-11-13):

- Marks keep their owners' colours on the tile and in the chip (R-ICON-01): `connect-icons` shows a row for every mark of `SERVICE_ICONS` (fixture
  variant `iconMarks`) and `icon-colours` compares the computed colour of each with its brand hex (Simple Icons) in the real browser;
  `service-icons.test.ts` pins the table and the rule that wins on the tile.
- Inside a floating surface a card is the surface with a hairline and a control the control fill (R-FLOAT-02): the check `float-cards` is
  appended to every tab of Settings and to the dialogs, menus and popovers that hold cards, fields or rows (`FLOAT_CARD_SCENES` in
  `scenes/index.mjs`); it fails on a near-identical grey without an edge or a darker hole. The model chooser is one tone with a hairline
  between its columns and no light edge on the chosen row (`model-choices-answer`, `quick-model-menu`, `chooser-chatgpt-signed-out`).

```powershell
npm run look -- connect-icons --theme both --width 1120,720,1920x1080
npm run look -- profile appearance models dictation tools safety about usage model-choices-answer model-choices-local quick-model-menu cli-account-menu member-maker slime-picker template-preview template-review-pages connections-command --theme both --width 1120,720,1920x1080
```

Scene changes of the same round: the scenes of the connected list start with `[data-conn="connected"]` (`plugins-installed`,
`plugins-detail`, `connections-hover`, `connected-apps-only`, `connections-app-switch`, `connector-*`); the scenes of the apps start
on the view (`plugins-store*`, `store-n8n`, `plugins-setup-*`); `plugins-store-wheel` and `missing-store-repair` are gone (nothing scrolls
sideways, and the notice that sent the owner to a store tab is gone with the tab). `plugins-store-needs` now proves a row says
nothing of what an app asks for; `plugins-store-needs-page` proves the page says it once.

Owner decision 2026-10-30: Settings > Connections is the only connected-app entry.
The sidebar has no app entry or badge. The installed tab retains the shared inventory
count and its unknown/loading state; connection and permission behavior is unchanged.

## Accounts of an app, and a sign-in that waits (2026-11-13): R-ACCT-01, R-ACCT-02

Owner, 2026-11-13: 「帳號登入如果中途取消都要可以拿掉 不然他會有超級多沒有用的帳號卡在這裡」 and 「為什麼大部分人都沒有辦法連結？」.

- An app's accounts card (a Composio app): each row is a person, a name, a status and a quiet ⋯ (no 帳號名稱 button). The ⋯ opens 重新命名
  and then 移除 in red. A row that is not connected (等待登入, 已過期, 已撤銷, 失敗, 未啟用) is removed at once; a connected one asks the app's
  delete question first (「移除「name」？」, one sentence, 取消 and a red 移除); the last connected account is the app, so its 移除 is the app's own
  two-press disconnect (the menu then says 「確定中斷？」). 加入另一個帳號 is unchanged.
- A sign-in that was given up leaves no account: the core gives back (Composio and the list) the account of a flow that was cancelled, closed,
  failed or ran out, and any waiting one older than ten minutes when the list is read. `look` cannot prove that (the core is a mock there):
  `core/tests/test_connector_accounts.py` does, and the scene `accounts-card` shows the list after the core gave the old one back.
- A waiting sign-in holds nothing back: the waiting row says 請在瀏覽器登入… with an enabled 取消 (a Composio one too), every other 連結
  stays pressable, and pressing another one ends the waiting one at the core first (`integrations.connect_cancel`).
- Driving it: open Connect Apps (`#nav .sidebar-apps`), the chip 已連結, the app's row; the ⋯ is `[data-conn="account-menu"][data-account]`.
  Gotchas: the menu's items are `account-label` and `account-remove`; a stale account is a fixture row with `stale: true` that the mock
  drops on `connectors.status`; a waiting sign-in is the fixture flag `pluginsConnecting` (the mock holds the connect call until
  `integrations.connect_cancel`).

```powershell
npm run look -- accounts-card accounts-menu accounts-remove-ask accounts-remove-yes accounts-remove-waiting accounts-remove-last account-labels account-label-edit sign-in-waits sign-in-replaced sign-in-cancelled --theme both --width 1120,720,1920x1080
```

## Setup in the conversation (owner, 2026-11-09)

Owner: 「這種設定不管是 composio 還是甚麼的 一律全部都在對話中進行…除非真的是登入就結束 或是輸入金鑰匙就結束」. In the
store, a sign-in or one key is still done at once; 加入 on anything more (a server of the owner's own such as n8n, a
developer app of theirs) puts the owner's words 「幫我連接 <name>」 in the conversation's composer (`store.setUpInChat`)
and its row says nothing it would have to explain. The member answers with a connect card (`connect_app`): a server
card has `needs: "own_server"` and carries its own `fields` (n8n: `url`, `token`), which the card's inline form shows
with no catalog read; `integrations.card_connect {id, fields}` takes them, the token field is emptied on submit, and
the member explains each field in its reply. Scenes: store-n8n and plugins-setup-own-app (`store-in-chat`).

```powershell
npm run look -- store-n8n plugins-setup-own-app plugins-store-needs --theme both --width 1120,720,1920x1080
```
## The store is only what is not added yet; n8n is a preset (owner, 2026-11-08)

The store is one list, 「全部」 (or the chosen chip's name), of the apps not added yet: no 已連結 and no 常用
sections. Popular apps still lead it while browsing, in bounded 18-card pages. n8n is offered as the owner's
own server (`PRESET_FORMS` in `connections.ts`): it runs at each owner's own address and has no Composio
toolkit, so the built-in catalogue (fixed official addresses only) cannot carry it. Its row says 「需要自己的
伺服器」; 加入 opens the server form with type http, name n8n and `Authorization=Bearer ` filled in and the
address field focused (placeholder `https://n8n.example.com/mcp-server/http`). A connection whose name or host
is n8n takes it out of the store.

```powershell
npm run look -- store-n8n plugins-store plugins-store-key plugins-store-all --theme both --width 1120,720,1920x1080
```

`plugins-store` requires the single section and no 已安裝 state; `store-n8n` and `store-n8n-form` check the mark,
the need words, the filled form and the focus.


## Owner round 10 connected apps and chosen models

API and CLI brain prompts share the Composio discovery/execution contract:
COMPOSIO_SEARCH_TOOLS returns a tool slug and schema; execute that slug through
COMPOSIO_MULTI_EXECUTE_TOOL with its arguments. Discovery alone does not establish
that the requested app is unavailable. The execute envelope accepts the documented
optional string fields thought/current_step/current_step_metric/session_id and a
boolean sync_response_to_workbench that must stay false. Unknown fields, malformed
per-call objects, disabled slugs and draft-only violations are blocked. The actual
contained slugs use the same read/write classifier as Connections: all enabled
reads are T1 and run without a permission card; any write is T2 and requires one.
Production agent/gate/MCP flow is exercised with a fake MCP and synthetic email.

Conversation and routing fallback controls are absent from the UI. Only the chosen
model is called; hidden legacy agent_fallbacks/router_fallbacks confer no consent.
Implicit CLEANUP_FALLBACKS are removed from agent, tool-selection, computer and
memory consumer defaults. Dictation cleanup retains its separate documented retry
contract and saved fallback behavior. Each provider attempt receives the complete
caller timeout. A failed answer names the selected model, a localized failure and
an actionable next step; successful history records the actual answering model.

Focused evidence: core/tests/agent/test_composio.py (21), test_persona.py (121),
test_model_choice.py (11), test_service.py (174), test_routing.py (111),
core/tests/test_connectors.py (91), core/tests/brain/test_provider_registry.py (26),
test_providers_more.py (48). All use fakes or mock transports.


## Owner round 10 contracts (supersedes round 9 message previews)

Only owner messages use eight-line faded previews with a quiet expand action inside
the bubble. Assistant messages render fully; authored reply envelopes retain separate
bubbles and complete Markdown blocks in private and room conversations. Chief,
member and room scrollers hide their scrollbar, retain normal scrolling and expose
an accessible jump-to-latest action only when away from the bottom. New messages do
not move an owner reading older messages. Recording/STT cancels on one Escape;
in-flight in-app answers require two. Menus, dialogs and ordinary overlay keep their
existing Escape handling.

`dictionary.correct` carries bounded dictation snapshots to the same Rust Tracker
used for external editor corrections. Core owns final term acceptance and opaque,
single-use batch Undo, including prior evidence restoration. A separate passive
`learned.html` native window shows the learned batch and localized Undo at the active
monitor's horizontal center, 56% down its work area. It expires after five seconds
without hover. The ordinary overlay remains click-through. Fixture pill evidence
does not establish native hit-testing, positioning, paste or persistence.

`stable-click` records the clicked view control and persistent content above it,
then rejects position/size changes over 1px after settling. Normal look clicks on
tabs, switches, pressed filters, Settings panes and view controls automatically use
it (sidebar/Home excluded for the parallel redesign). Explicit scenes cover
Connections tabs/categories, Dictionary filters and Models/Settings tabs. Existing
Calendar, member and Plugins scene clicks inherit this check. Connections search is
below the fixed Installed/Store switch in both states. A selected look report is
required to establish the actual covered controls and any remaining movements.

Round 10 scenes: `long-owner`, `long-owner-expanded`, `long-member-reply`,
`long-room-messages`, `reply-split-bubbles`, `conversation-chief-up`,
`conversation-chief-bottom`, `conversation-member-up`, `conversation-member-bottom`,
`conversation-room-up`, `conversation-room-bottom`, `overlay-learned-pill`,
`stable-connections-switch`, `stable-dictionary-controls`, `stable-settings-controls`.
Run both themes at 1120,720,1920x1080. One heavy
process at a time, Vitest --maxWorkers=2, CARGO_BUILD_JOBS=2 and the shared native
CARGO_TARGET_DIR apply.


## Sub-features

Settings > Connections contains one connected view (the tab 已連結) for Composio
toolkits, private Google and custom MCP servers: connectors only (owner, 2026-11-07).
A member's skills, their sharing and their import are managed in that member's own
panel, never here; the dialog has no skills section, no import button and no skill
rows. Every row has a bare service mark (or a generic plug),
name, one-line description, switch and detail chevron. Managed bridge
servers are not duplicate rows. Tool switches are grouped by write/read in the
detail. Disconnect lives in the detail overflow with a second-press confirmation.
Custom MCP add/edit/test, command/HTTP, JSON paste and local discovery stay reachable.

The rows sit under two headings: 應用程式 (their tools can be called now) and 尚未連結
(waiting for sign-in, failed, a duplicate of another connection, all tools off or
unreadable, each with its reason). An app is connected only when its tools
can be called now, and the core defines that once (`integrations/inventory.py`); the
Settings > Connections tab's number and its installed rows
all show that one count. An unreadable inventory shows 「—」 instead of a number (the
entry's accessible name says it cannot be read), and an app whose state cannot be read
says 「無法讀取」 on its row.
An app's detail shows its account(s) by status, `已開啟 N/M 個工具` with a switch per
tool, signing in again and, in the overflow, disconnect. Sharing an app is not offered
until members can share across users (P13).

The Store always reads Raphael's built-in services from integrations.catalog, with
popular/all sections, local search and the existing integrations.connect join flow.
Composio is optional. Without a key, a final row opens the small connection-style
password dialog; it never replaces the service list. With a key, one connectors.catalog call supplies the complete Composio
list and its categories. Core follows cursors up to 3,000 raw entries and caches an atomic snapshot
in memory for one hour; a failed refresh returns the last good snapshot. Changing or
removing the project key invalidates it. No Load more control remains. Nine broad category chips filter both sources locally through the shared finder vocabulary.
Matching normalized slugs or names appear once, as Raphael's built-in service. Search
covers both sources; the Store badge and pager count the same addable apps under
the current filters. Connected entries remain separate context, outside that count.
Popular and other available apps share bounded 18-card pages. Failure/loading of Composio leaves the built-in catalog available.
Both catalogs render through the same compact row component: a bare mark, a name,
one summary line, a right-aligned outlined Add button and a bottom divider. Added,
connecting and needs-a-key states use the same row/action slots, with no managed
card CSS or primary Add variant. Every row's name opens the shared store detail;
managed entries omit unavailable example/server sections. Managed sign-in does not
expose a cancellation RPC, so its shared Cancel control is disabled while waiting;
built-in cancellation still uses integrations.connect_cancel.
Known mismatched key types fail before
any request: sk-or- is an OpenRouter key and ck_ is a Composio consumer key, not the
project key Raphael needs. Other non-empty keys are probed without a prefix allowlist.
Errors distinguish both mismatched key types, Composio refusal and network/timeout
failure, with generic copy otherwise; keys never enter view state or error copy.
Consumer-key errors point to Composio Settings > Project Settings > API Keys in
zh-TW, en and ja; the password field is cleared.
Remote logos accept only HTTPS Composio domains under the existing image CSP;
bundled marks/generic plug cover absent artwork. The fixture uses installed marks
and does not prove remote image availability.

## How to get to it (user POV)

Open Settings > Connections from the account footer. Use 已連結 to open a service
detail, change its switch or open an overflow. Add offers custom command/URL, pasted JSON and import.
Use Store to search and Add a built-in service without configuring Composio;
complete its existing login, then return to 已連結. Optionally use the setup row at
the end to save a Composio project key and add its extra apps.

Under the 已連結 list a 推薦 section (owner, 2026-11-08: the page looked empty) shows up to six popular store apps not
added yet as the store's own cards with 加入 in place; an app already there is never recommended, however it was added
(matched by id, name, description and its store entry: Notion directly, Gmail through the Google connection). It hides
while searching; the store tab keeps the whole catalogue. Scene: connections-recommended.

## Driving it with look

```powershell
npm run look -- connections-recommended connections --theme both --width 1120,720,1920x1080
npm run look -- plugins-installed plugins-detail plugins-store plugins-store-category plugins-store-key plugins-store-key-openrouter plugins-store-key-consumer plugins-connecting --theme both --width 1120,720,1920x1080
npm run look -- connections connections-hover server-menu connections-add-menu connections-command connections-test connections-url connections-edit connections-delete --theme both --width 1120,720,1920x1080
npm run look -- connections-paste connections-paste-preview connections-discover connections-empty connections-discover-empty --theme both --width 1120,720,1920x1080
npm run look -- connect-apps-categories connected-apps-only connected-apps-unreadable connections-app-switch connector-many-tools connector-account-tools connector-uninstalled --theme both --width 1120,720,1920x1080
```

For this local store change, the selected acceptance matrix is:

```powershell
npm run look -- plugins-store plugins-store-category plugins-store-key plugins-store-key-openrouter plugins-store-key-consumer plugins-connecting --theme both --width 1120,720,1920x1080
```

`plugins-store-rows` runs in all six selected store scenes and checks identical
Add classes, main/text/action slot structure, flex layout and bottom dividers. Its
regression test rejects primary Add variants, static managed main slots and card
grid styling. Unit tests compare the sources in all four service states.
`plugins-store` checks both sources, count and deduplication; `plugins-store-key`
checks built-ins plus the optional setup row without issuing connectors.catalog.
Both error scenes open the small password dialog. `plugins-connecting` joins the
built-in GitHub entry without a Composio key and checks integrations.connect.
The fixture has four representative built-ins from the repository catalog. The
configured Store scenes add 360 synthetic entries with multiple category
memberships and a duplicate. Broad-group chips and local search operate on the
complete index, while connected context and 18-card result pages bound the DOM.
The shared driver's measure field records real click/input-to-next-painted-frame
durations with a 250ms budget and a 50ms maximum long task. Search reaches app 360
and opens its detail without rendering the entire catalog.
Use `LOOK_TRACE=1` with the shared look command to retain per-interaction Chrome
traces, including budget failures. These measurements concern this offline browser fixture;
they do not establish live provider or native timing. Unit tests cover source
failures, local search/count, category isolation and late replies after reset.
Core tests cover cursor paging, concurrent cache reads, one-hour expiry, atomic
failure fallback, key invalidation, repeated cursors and the 3,000-entry cap.

The last command in the broader list above is the apps set (`scenes/apps.mjs`). Each scene enters
through Settings > Connections; `apps-count` compares the tab's
number, the rows and the roster, `apps-unreadable` checks that an unreadable
inventory shows no count, and `connectors-only` (scene `connected-apps-only`, whose fixture
gives the members skills) requires no skills section, import button, skill row, plugin set or word of skills (connections.test.ts pins that the dialog never reads a member's skills; the open member panel behind it may).
The scenes `connected-apps-skills`, `skill-private-detail` and the `skills-*` import, grant, source and plugin scenes were
retired on 2026-11-07 with the dialog's skills section; the member panel's skills are covered by `details-skills` and the members map.

All switches in Connections are binary (owner, 2026-10-28). The app switch reflects
only its enabled flag; turning it off or on preserves every tool exclusion. A
loaded app dialog exposes two permission rows, Write and Read, each with its own
enabled/total count and switch, above the folded per-tool list. A kind switch is
on only when every tool in that kind is on; a partly enabled kind is off. Pressing
off enables the whole kind; pressing on disables the whole kind. An empty kind
is off and disabled. Managed apps send one connectors.set_tools disabled_tools
update, retaining exclusions in the other kind and unlisted tools. Custom servers
send one integrations.set_tools_enabled call. Neither kind switch enables the app.
The optional expanded list still has per-tool switches.

The selected acceptance matrix for these permission and sign-in changes is:

```powershell
npm run look -- connections-app-switch connector-many-tools connector-account-tools --theme both --width 1120,720,1920x1080
```

`connections-binary` rejects any mixed/middle state in the connection list or its
dialogs and runs throughout all three journeys. Its regression test rejects a mixed
switch. `app-switch-all` now checks disable/enable without changing the 18 excluded
GitHub tools. `connector-folded` exercises bulk Write/Read updates for 46 tools,
checks independent states/counts and keeps the individual list folded. The managed
`connector-tools` journey switches both kinds off/on, validates disabled_tools-only
RPCs and then expands the individual list. Its sign-in failure step checks the
dedicated toolkit-not-allowed words. All scenes retain the shared real entry and
synthetic IPC boundary.

Also run `home` (the global sidebar on the wide
and compact layouts) and the `plugins-*` scenes above for regressions.

Inspect every contact sheet and detail/store/key/menu full-size image, especially
720px scrolling, ellipsized descriptions and overflow confirmation. Browser scenes
exercise the real entry and IPC doubles. Vitest covers asynchronous connection,
catalog races/local filters, key privacy and managed tool decisions. Core tests cover
default-on new tools, persisted service switches, provider failures and the shared
API/CLI MCP definitions for Raphael and members without a restart.

## Gotchas

Composio opens the login in the core and polls there; no frontend OAuth URL or token
is stored. A chat's connector card (see [Conversation](conversation.md)) signs in through these same
`connectors.google.connect` and `connectors.connect` methods, so their lock and value-free failures apply. connectors.changed maps to ConnectionsChanged. Status reads here use
refresh:false to avoid account refresh/notification loops. tools reads can notify;
the controller keeps the in-flight tool state when reloading the list. A whole
service switch preserves individual exclusions via connectors.set_tools.enabled.
Before requesting a Composio login link, connect temporarily patches the session's
toolkit allowlist to include the requested slug, preserving existing tools and
restrictions. Success publishes the connected configuration through the usual patch
path. Refusal, timeout, browser errors and cancellation restore the prior toolkit
configuration. Temporary patches do not refresh MCP or change search/execute flags.
HTTP 400 with the exact provider error slug/code ToolRouterV2_ToolkitNotAllowed maps
to toolkit_not_allowed and dedicated localized copy; provider messages never reach
the UI. The fake transport rejects links until the toolkit is allowed and tests
successful ordering and rollback, including actual task cancellation.
Google consent scopes and existing execution gates still apply independently.

Fixture server notes supplies custom edit/test flows. All credentials, tools and
catalog entries in browser evidence are synthetic. Browser network is blocked outside
the owned Vite origin. These scenes cannot prove OAuth, OS credential persistence,
remote logo hosting, provider schemas, account expiry/revocation or actual tools.

The count is the core's, never the page's: `integrations.inventory` returns it with each
app's state, `connections()` carries the same states, and a change of either notifies
`integrations.changed` (a failure that appears or recovers, a connection added or
removed, a switch). A tool switched off or an app disconnected leaves the offered tools of both
brains at once and the gate refuses it too, also when the owner had said 一律允許 (the
narrow rule `tool:<key>` never revives it; the rule itself stays listed in Settings).
The account is shown by status only (「帳號 N」, 「你的 Google 帳號」, 「已登入」) because the core
keeps no name or address for one. A skill's trigger is its description plus its switch;
deleting it, or turning it off, removes it from the prompt and from `skill_read`.
`members.skills.read` is in the shell's method allowlist (`commands.rs`), covered by its
unit test and compiled only in CI. Fixture connections and skills are synthetic; the
IPC double computes the inventory from them as the core does, so a scene cannot prove
that the core's real states (a provider's account status, a failing server) map the same way.

A chat's secret card (see [Conversation](conversation.md)) fills a secret a connection already declares: it writes the same
vault slot `integrations.add` and `integrations.update` do (`<server>:header:<name>` or `<server>:env:<name>`), never any
other name, so Composio's project key, Google's client and the model keys are out of its reach.

## Native acceptance

Run the full look matrix, judge with external ChatGPT/Codex reference images and
verify --live in the authorized environment.
Use an isolated data directory and a scoped Composio test key. Save/reopen, search
and change categories, Add through browser sign-in, cancel/deny/expire and retry,
disable a tool/service, verify the next API and CLI turns for Raphael and a member,
and disconnect/revoke. Confirm new tools default on, exclusions survive restart,
remote logos load under native CSP, and logs contain no key/token/payload.

For private Google use an owner-provided Desktop client: configure through the
existing core RPC, sign in, exercise partial consent and refresh, and verify Gmail
and Calendar tool switches and revocation. The calendar reads only through the
enabled private calendar_list_events tool. From a chat, ask for a nonce mail, connect from its Gmail card,
cancel once, finish once and reconnect once; only that task resumes and reads the mail. Test a custom local MCP server with
add/test/edit/paste/discover, a harmless call and removal; stop only that test server.

Count the connected apps by hand against Settings: connect one, let a sign-in expire, add
the same service twice and uninstall one, and watch the number follow each time; ask a CLI
and an API brain how many apps are connected. Switch a tool off, start a new turn and a
running one, and confirm neither brain offers or runs it; do the same after uninstalling,
once with 一律允許 chosen earlier. Edit a skill in the member's own panel (not here), ask for what its
description names and see it used; delete it and see that it is not.

## UI audit regression coverage

Custom MCP transport uses the shared dropdown (`data-k="conn-type"`); HTTP
journeys choose the `http` menu item. Custom server deletion asks to delete; managed
connector disconnection asks to disconnect. Security and secret-storage notices remain.

## Right click on a connection (R-UI-44)

A custom server's ⋯ sits in the header of its dialog, and a subscription account's ⋯ on its card in Settings › 模型; a right click anywhere on the header or the card
opens that menu at the pointer (測試, 編輯伺服器, 刪除; 中斷連線), the one the ⋯ opens. See [Members](members.md) for the rule and its table.

```powershell
npm run look -- context-menu-connection context-menu-cli-account --theme both --width 1120,720,1920x1080
```

## Dialog feedback and unobstructed actions

A failed sign-in or re-link started in an app dialog uses the Store's same localized
loginFailure copy in a note with role=alert after the account rows. It does not
raise a toast. Retry, close and success clear the error; a pending failure from a
closed or replaced dialog is discarded. Other connections-owned feedback raised
while an app or project-key dialog is open stays inside that dialog:
re-login success, tool/app operation errors,
custom server test/refresh and device/browser/cancellation errors. Successful removal closes its dialog
before showing the usual list-level toast.

The selected regression matrix for this change is:

~~~powershell
npm run look -- connector-account-tools connector-many-tools connections-app-switch plugins-detail plugins-store plugins-store-category plugins-store-key connector-uninstalled --theme both --width 1120,720,1920x1080
~~~

connector-account-tools checks the refusal inline with no refusal toast, then
connections-dialog-actions calls elementFromPoint at EVERY footer button centre
and requires the button or its child. It checks both the folded and expanded tool
states. connector-many-tools runs the same footer check. Happy-dom
tests cover refusal/denial/timeout/network copy, retry/success/close, stale replies
after reopening and the footer check's covered-button failure.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Owner round 4 settings alignment

Connections uses the shared 640px settings-pane measure, including its header
actions, toolbar and list/store grids. Search ends at the same content edge;
capability lists outside Settings retain their own reading cap.

## Owner round 7 contracts

Settings retains the connected-app inventory count; the sidebar has no app entry or count. `apps-count` and `apps-unreadable` check the installed tab against the shared inventory.
## Search-first catalog and chat discovery (2026-10-29)

Built-in and managed apps share the vocabulary in connectors/finder-data.json:
name, slug, descriptions and aliases. Connected apps lead, then available popular
apps. Nine broad group chips replace provider category dropdowns by explicit owner
exception to R-UI-20. Result pages contain 18 cards and retain the shared R-UI-45
card measures. Search is debounced and indexed; no filtered catalog fetch occurs.

```powershell
npm run look -- plugins-store plugins-store-category plugins-store-search plugins-store-all plugins-store-empty plugins-store-motion connector-slack connector-slack-authorizing --theme both --width 1120,720,1920x1080,1180x780
npm run look -- connector-reconnected --theme both --width 1120,720,1920x1080
```

`find_app` reads the same public vocabulary and reports id/name/provider/connected;
`connect_app` validates any returned id, creates the existing T0 private chat card
and resumes once only after its tools become available. Catalog display names and
providers survive restart. Unknown ids fail closed. Non-Google cards never use
private Google authorization. Rooms, nested exchanges, voice and quick requests
cannot open these cards.
Resumed turns carry the persisted catalog names separately from app ids, so an
unknown app keeps its display name without losing existing Google brand marks.

From a normal owner shell, build the isolated debug app, then run
`npm run native -- store-finder catalog-connect`. Set RAPHAEL_NATIVE_APP to a
non-Gmail catalog slug with managed sign-in (default slack, verified by the owner). Both explicitly
allow only Composio network and read only its existing Credential Manager key;
credentials/configuration writes remain inside the run. Catalog-connect scripts
only the fake provider's tool choice, then drives production tools, gates, stores
and sign-in for Raphael and a member. It stops before consent, cancelling only
its first pending login to exercise the second speaker. This proves the core/UI
path, not a live model's choice of tools. Store-finder records catalog size,
paint time, DOM nodes and long tasks; >250 ms paint or >50 ms long tasks fails.
Sandbox credential failures are blocked, not performance or authorization PASS.

Settings headers, toolbars and content share one `.set-content` reading measure,
including the Add button and the store's full-width search. Group chips stay on
one horizontally scrollable row with no visible scrollbar. The shared content-width look guard checks
these edges; profile, appearance and the custom MCP form represent ordinary rows,
choice grids and flex/scrolling forms affected by this setting-wide constraint.
Native screenshots wait for finite entrance animations, independently of measured
click-to-paint. `plugins-store-motion` leaves motion enabled and requires all rows
to reach full opacity with only the normal section gap before capture.
Catalog logos persist with conversation cards (migration 43) and resumed turns,
and store/card marks use the same renderer and HTTPS Composio allowlist. Slack's
public catalog SVG has an exact offline snapshot declared in fixture.json, so
pending and authorizing scenes exercise the real image element without network.

## Accepted store and connector judge findings (2026-10-29)

The store's search, tabs and single-row group chips stay above a separate results
scrollport. `plugins-store-all` scrolls to pagination both before and after a page
change and checks every toolbar control by bounds and hit testing; only results
may scroll. The results fill the allocated flex space with layout and size
containment, so their intrinsic height does not expand the fixed toolbar shell.
Search, empty results and the optional key setup retain that layout.

The custom MCP form keeps its trust notice and actions below the fields scrollport.
Fields have bottom padding and scroll padding so revealing the final field leaves
it and the environment variables fully above the footer. Header Add, input fields,
trust notice and footer actions reserve the same scrollbar gutter; the rendered
checks require their right edges to match without horizontal overflow.

A pending chat connection card shows its app name and Connect action without a
helper line (R-UI-02). Reconnect errors, authorization status and tool counts remain
essential states. Authorizing copy has no literal ellipsis, uses the available text
width and stays fully visible before Cancel. The turn remains paused while the
card owns cancellation; composer Stop, sidebar selection and details-panel placement
are unchanged by this fix.

```powershell
npm run look -- plugins-store plugins-store-all plugins-store-category plugins-store-search plugins-store-empty plugins-store-key connections-command connections-url connections-test connector-slack connector-slack-authorizing chat-connect-gmail connector-authorizing connector-reconnected --theme both --width 1120,720,1920x1080,1180x780
```

## Store counts and single-row categories (round 4, 2026-10-29)

The Store tab counts apps the owner can add under the current search/category,
excluding already connected entries. The pager uses that same filtered snapshot
and total. Popular apps lead that available list and share its 18-card pages;
they are no longer a separate uncounted block outside pagination. Connected apps
remain a separate context section. The regression test in connections.test.ts
walks every page, checking identical tab/pager totals, page sizes and exactly-once
coverage of all addable apps, including popular apps.

All ten category chips occupy one horizontal row at 720, 1120 and 1920x1080.
The row scrolls without a visible scrollbar. Repainting results preserves its
horizontal offset and the selected chip's keyboard focus. The category journey
tabs through every chip, selects Other with Enter, checks it remains fully visible
and focused, then returns to Productivity. Rendered checks reject wrapped chips,
visible scrollbars and differing Store/pager totals. Toolbar hit tests cover the
search and fully visible chips while results scroll independently.

The mouse wheel scrolls the chip row sideways and hands the page back at either
end. An arrow button and a fade stand only at an end with more chips behind it
(`chip-scroll.ts`, shared by any `[data-chip-row]`). The ten chips fit the sheet
from 1120 px up, so `plugins-store-wheel` measures it at 720 px, where they overflow. It turns
a real wheel over the chips, checks the left arrow can be pressed and the page
did not scroll, then presses it and checks the row is back at its start with
only the right arrow.

```powershell
npm run look -- plugins-store plugins-store-all plugins-store-category plugins-store-search plugins-store-empty plugins-store-key plugins-store-motion --theme both --width 1120,720,1920x1080
```

Fixture/browser results do not establish native,
live-provider or design-judge acceptance.


## Store merge geometry (2026-10-29)

Search, tabs, category chips and results share the settings content measure at
720, 1120 and 1920x1080. Store grids use two tracks when the pane is wider than
the 384px short-card cap, and one below it; cards fill their allocated tracks
without leaving the former narrow-window gap. The shared content-width check
compares the result edge and each card with its actual grid track.

The category row uses the conversation scrollport's linear-gradient mask treatment
at its right edge, with 24px end padding so keyboard scrolling fully reveals the
last chip. The existing category journey retains focus and offset after redraw;
its rendered check also requires the fade and safe end padding. Settings headers
keep their narrow-window clearance from Close through the set-content wrapper.

The merge retains chief-role trigger migration 41, adds catalog name/provider in
42 and catalog logo in 43. Migration tests preserve existing Google cards, catalog
metadata and the chief guard. Self-diagnosis and cancelled-turn guards also apply
to dynamic catalog cards; resumed names come from persisted connected cards.


Opening a loaded Store still refreshes its catalog. An identical catalog and category
reply retains the current rendered rows instead of forcing a second settings layout;
changed metadata or categories still redraw. The controller regression in
`app/src/main/connections.test.ts` covers both outcomes, while the existing measured
Store scenes enforce the unchanged 250ms paint and 50ms long-task budgets.

## Acceptance fixes (2026-10-30)

Connect apps categories uses the existing single scrolling row of broad group
buttons, replacing the retired provider dropdown journey. The scene focuses every
chip with Tab, checks that each full chip is visible and hit-testable, selects the
last group with Enter, then clicks Productivity and checks filtered rows. Selection
also reveals a chip when pointer activation did not first focus it.

Switching Installed/Store preserves the Connections shell and uses shared swapHTML
inside it, avoiding full Settings reconstruction and synchronous scroll restoration.
A unit regression checks both directions without host redraw. Existing 250ms paint
and 50ms long-task budgets remain enforced; use LOOK_TRACE=1 for CPU/layout evidence.
The acceptance matrix includes plugins-store, plugins-store-category,
plugins-store-search, plugins-store-all, plugins-store-empty, plugins-store-motion,
connect-apps-categories and neighbouring connections, connections-empty,
plugins-installed, plugins-detail, plugins-store-key and plugins-connecting.
Run both themes at 1120,720,1920x1080. Fixture timing does not prove native/provider
timing.

Focus-in on the Settings Connections pane reveals the entire category button
before selection, reserving the existing right fade padding. The focus helper is
shared with selected-category repaint, and a unit regression checks both scroll
directions without changing the selected group or redrawing Settings.

## Store long-task diagnostics (2026-10-30)

Tab switching also retains the original toolbar, tab buttons and search input.
Only the result body is replaced, so a clicked tab keeps native focus without a
second focus call forcing synchronous layout. The existing controller regression
checks both directions without a full redraw, and checks node identity, selected
state and no focus restoration when entering Store.
The six Store scenes retain the 250ms paint and 50ms long-task gates.

The shared look runner records navigation-to-capture long tasks for measured scenes,
including startup and neighbouring actions, without removing any task from the
existing interaction interval. Failed interaction assertions retain their metrics.
Use LOOK_PROFILE=1 for full-scene CDP samples and LOOK_TRACE=1 for measured timeline
events. Compare both with ordinary unprofiled repeats; diagnostic overhead is not
production timing. Historical failures without samples cannot be assigned a cause
solely from a later passing run. See app/scripts/look/README.md for clock mapping.

## Store click-to-paint work (third pass, 2026-10-30)

The default first-screen snapshot is prepared as the catalog loads, keyed by the
catalog identities, configuration and locale; non-default filters use fresh data.
Opening Store preserves the toolbar and immediately builds twelve app names and
working actions, with stable tracks for the remaining page. After paint, two rows
per task receive their summaries, Add icons and asynchronously decoded marks, followed by
offscreen rows. Existing name/action nodes remain intact. The cached-catalog refresh
also starts after paint. A generation, host visibility and body attachment guard
prevent late writes after redraw, filter changes, tab changes or reset. Selecting
the current category on its first page retains the existing rows.

The controller tests cover staged completion, stable nodes, unchanged category
selection and cancellation on switching/reset. The existing plugins-store-rows
check also verifies that names, summaries and actions fit within each row.
Store scenes wait for pending details after the unchanged measured opening step;
the observer interval and 250ms/50ms gates are not changed. Use the same six Store
scenes in both themes at 1120,720,1920x1080 for five consecutive ordinary passes.
LOOK_CPU_SLOWDOWN labels additional CDP stress evidence separately from ordinary
machine timing; see the shared look README. Neither kind proves native/provider
timing, or the cause of a historical failure without its CPU samples.


## Composio request compatibility (2026-10-30)

The v3.1 session PATCH accepts the session configuration, without
expected_config_version. Keep the local session lock and fail closed on provider
conflicts. HTTP 400/422 is invalid_request with plain owner copy, never unknown or
a transient server retry. Session creation, enabled toolkit update and link creation
must succeed before authorizing is accepted as a real pending provider link.

```powershell
npm run look -- connector-invalid-request connector-slack connector-slack-authorizing connector-authorizing plugins-store --theme both --width 1120,720,1920x1080
npm run native -- catalog-connect
```

Run catalog-connect with RAPHAEL_NATIVE_APP=slack and gmail separately. It uses the
fake brain with the real core, policy, cards, Composio and Settings join flow, for
Raphael and a new member. It stops before consent and never reads account data.
The browser's provider page still needs separate visual inspection; pending alone
is not proof of an external page. No CLI brain or OpenRouter is used.

## Apps that ask for the owner's own key or developer app (2026-10-31)

Owner report: most of the store could not be added. Measured on the real catalog (1,714 toolkits): about 9% had a
shared sign-in; 1,407 take only an API key or token, 88 are OAuth-only without Composio's shared login (X/Twitter
among them) and need a developer app of the owner's own. Nothing in the store is a dead end now.

- Core: `connectors/toolkits.py` reads each toolkit's `auth_config_details` into one plan (`sign_in`, `key` or
  `own_app`; the fields, the guide, the service's page, the redirect address) and the catalog list carries `needs`
  (no `can_connect`). `connectors.toolkit {toolkit}` returns the plan, never a value. `connectors.connect
  {toolkit, fields?}` creates the toolkit's auth config at Composio (`POST /auth_configs`, `use_custom_auth`), then for
  a key creates the account at once (`POST /connected_accounts`, `state.val`), and for a developer app opens the
  normal browser sign-in with the auth config in the session (`auth_configs`). Missing or wrong fields are
  `needs_key`, `needs_own_app`, `key_rejected`; a Composio key that is missing or refused is `missing_key`. Giving the app
  back deletes the account and the auth config and starts the session again (a session update only adds auth configs).
- Window: `connection-setup.ts` is the one form (store 加入 and the chat card's 填入金鑰 / 設定開發者 app): masked
  fields for what the service asks, where to get it (guide, else the service's page, else that there is none), plain
  steps, the redirect address with a copy button for a developer app, and one line that Composio keeps it. A row of the
  store says 需要 API key / 需要自己的開發者 app in words; no 加入 is disabled for want of anything. Without a Composio key
  the store row says so and its button adds the key.
- Chat: `find_app` results and the card carry `needs`; a failed card is `needs_composio_key`, `needs_key`,
  `needs_own_app` or `key_rejected`, with a button to the form or to Settings, and the member is told exactly what is
  missing and where to add it (not a bare "not configured").
- Evidence: `core/tests/test_connector_setup.py`, `core/tests/test_toolkits.py`, `app/src/main/connection-setup.test.ts`;
  real request shapes were proved against Composio with a made-up key on `0codekit` (account ACTIVE, the session read
  back with its `auth_configs`, eight tools, then account and auth config deleted) and the own-app auth config shape
  with made-up values on `twitter` (created, deleted). Composio does not test a key against the service when it is
  stored, so a wrong key shows only when a tool runs.

```powershell
npm run look -- plugins-store-needs plugins-store-needs-page plugins-setup-key plugins-setup-noguide plugins-setup-own-app plugins-setup-added plugins-setup-rejected plugins-setup-composio-key plugins-setup-plan-failed connector-key connector-app connector-key-form connector-key-sent connector-key-rejected connector-failed-continued --theme both --width 1120,720,1920x1080
```

`plugins-store-needs` requires the words on each row and no disabled 加入; the `setup-*` checks require masked
fields, the guide or its fallback, the redirect address for a developer app, a key that is in no page text and no call
but the one that adds the app, and an emptied masked field after a refusal; `card-*` checks require the same for the chat.

An app on the owner's own server (n8n) is set up in the conversation (owner, 2026-11-09: setup happens in the chat
unless it ends at a sign-in or a key). Its card (`needs: "own_server"`) says 需要自己的伺服器 and carries the fields
the core declared: the address plain, the token masked, one 安全儲存, no modal and no catalog guide. Both values leave
in the card's one `integrations.card_connect` call and in no page text.

```powershell
npm run look -- connector-server connector-server-sent --theme both --width 1120,720,1920x1080
```

## A card says why it did not connect, and the owner's own Google (2026-11-11, R-CONNECT-01 to 03)

Owner's open task since 2026-10-25 (「接上 Composio 與自己的 Google 授權」). Two behaviours, one machine (`connectors/cards.py`):

- A failed connection card is always a named cause (`CAUSES`: busy, vault, browser, network, no_answer, service_down, rate_limit,
  refused, invalid_request, not_found, bad_response, address, not_allowed, key_refused, needs_*, client_rejected, denied, timeout,
  state, scope, signin_failed, signin_expired, no_refresh, api_disabled, mcp_unavailable, interrupted, unknown). The view carries
  `error` (the cause), `retry`, `fix` (`settings` or `form`) and `detail` (the service's short words for `refused`, the technical
  reason for `unknown`). The member gets `cause <name>: ...` as the failure's reason. The attempt that used to be bare is `busy`:
  `connectors.connect` answers `busy` before it sends anything while another sign-in or `connectors.*` work holds its lock.
- The owner's own Google is the app `google` (`apps.OWN_GOOGLE`): `connect_app google`, or 加入 on 「Google（私人連接）」 in the store,
  which leaves for the composer with 「幫我連接我自己的 Google 帳號」. Its card (`needs: "own_google"`) walks five steps (open), gives
  the scopes and the return address as text to copy, asks for the Client ID (plain) and the Client secret (masked) and signs in with
  one 連接 Google. The two values leave in `integrations.card_connect` and reach the vault through `connectors.google.configure`.
  With a Client ID kept the card has no fields: one button signs in. Connected, it says the account (Gmail's profile) and the tool count.
- A card of an older core (no `retry`, `fix`, `detail`) keeps the actions it had.

```powershell
npm run look -- connector-cause-busy connector-cause-refused connector-cause-unknown connector-google-steps connector-google-filled connector-google-authorizing connector-google-connected connector-google-kept connector-google-rejected store-google store-google-in-chat --theme both --width 1120,720,1920x1080
npm run look -- connector-invalid-request connector-failed-continued connector-server connector-key-form plugins-store --theme both --width 1120,720,1920x1080
```

`connector-cause-*` require the cause's own sentence (never 沒有連上), one 再試一次 only where it can help, the × to put the card away,
no technical reason on the card's face and, for `unknown`, the reason folded under 詳細資料. `connector-google-*` require five open
steps, the two texts to copy, a plain Client ID and a masked Client secret, one primary 連接 Google, a secret that is in no page text
and in no call but the card's own, the sign-in waiting with only 取消, and the account on the connected card. What only a real Google
client proves: that Google accepts a Desktop client with no registered return address, the real consent screens (including the
unverified-app warning), the 7-day expiry of a project left in Testing, and that `access_type=offline` returns a refresh token.

## Executable round 10 matrix

```powershell
npm run look -- conversation-chief-up conversation-chief-bottom conversation-member-up conversation-member-bottom conversation-room-up conversation-room-bottom reply-split-bubbles overlay-learned-pill stable-connections-switch stable-dictionary-controls stable-settings-controls --theme both --width 1120,720,1920x1080
```

The stable-connections-switch scene also opens Notion tool permissions and clicks
both read/write group switches in both directions, retaining the control and
layout above it within one pixel. automations-day visits day/week/day to cover
both calendar period controls with the same generic stable-click contract.

## Connections from a conversation (2026-11-01)

The shared private/room MCP proposal card edits the name, command or URL, arguments and secret names. Secret values use SecretCards and the vault. Test initializes and discovers tools while disabled, groups read/write tools, then enables the tested revision and continues the original request. Stdio uses the existing local-command decisions. Edits invalidate discovery; cancellation settles secret cards too. Saving public fields has the shared stable-click check and the card has no inner scroll panel or JSON editor.

The proposal keeps the connector-card mark, metadata and button styles. Its public URL/command form uses shared field controls and a 520px maximum width so local-command choices fit; it reflows within the same conversation column. Secret entry remains the original narrower SecretCard.

connections_list/manage_connection share Settings' existing backend services. API, CLI tools/list and running background offers refresh at the next model step; execution still checks the current grant. Managed tool slugs remain subject to the existing envelope and draft-only policy.

Selected matrix (both themes, 1120,720,1920x1080): mcp-proposal-edit, mcp-proposal-tested, mcp-proposal-enabled, mcp-proposal-stdio, mcp-proposal-cancelled, mcp-proposal-room, mcp-proposal-secret. Representative existing consumers: connector-slack, chat-secret-masked, local-command-consent.

```powershell
npm run look -- mcp-proposal-edit mcp-proposal-tested mcp-proposal-enabled mcp-proposal-stdio mcp-proposal-cancelled mcp-proposal-room mcp-proposal-secret connector-slack chat-secret-masked local-command-consent --theme both --width 1120,720,1920x1080
```

Offline contracts: core/tests/integrations/test_chat_connections.py, core/tests/agent/test_connection_management.py, core/tests/background/test_connection_offers.py, core/tests/test_connect_cards.py, core/tests/test_secret_cards.py, core/tests/brain/test_db.py, app/src/main/mcp-proposal.test.ts. Native provider/OAuth/stdio processes, Rust, live and judge remain separately authorized checks.


## Named connected accounts (2026-11-05)

R-COLLEAGUE-04: Connections > an app shows each public account label; Account label edits that exact account. Add another account reuses existing sign-in and asks for a label afterward. A returned email is the default; provider refresh retains owner labels by account ID. Members and connections_list receive public labels and the shared instruction to ask which account unless specified.

```powershell
npm run look -- account-labels account-label-edit output-folder-picker output-folder-picker-cancel --theme both --width 1120,720,1920x1080
```

Core fakes prove persistence and projection. IPC fixtures never prove OAuth or provider metadata. Custom MCP services without multiple managed account identities retain their service identity.

## Primary management intent regression (2026-11-05)

Connection management is offered only to the current primary in an interactive
owner private chat. Connect, enable/disable and turn on/off requests select the
connection area, alongside disconnect/reconnect and explicit connection/MCP terms.
Since the fixed tool list (2026-11-10, owner-management.md) every request keeps
management out of the list: find_tools returns it and use_tool calls it, and the
words above only rank what find_tools returns. The default primary snapshot lists 43. Discovery never widens nonprimary or worker
access, and execution rechecks the live primary and exact-action owner approval.
Disconnect asks even under bypass. Local reconnect still requires proposal testing
and the existing local-command consent before launching a server; ask mode also
shows the ordinary management confirmation.

Core-only regression evidence: core/tests/members/test_management.py (intent,
primary transfer, default count, discovery and server-side rejection),
core/tests/integrations/test_chat_connections.py (offer changes, stale aliases,
secret/test/enable ordering and local reconnect), and
core/tests/evaluate/test_guardian.py (scenario intent reaches the shared snapshot,
recorded creates without side effects and approval pause/resume). No UI changes;
look, judge, native providers and live models are outside this offline repair.
