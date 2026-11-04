# Connections and MCP

Owner decision 2026-10-30: Settings > Connections is the only connected-app entry.
The sidebar has no app entry or badge. The installed tab retains the shared inventory
count and its unknown/loading state; connection and permission behavior is unchanged.


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
toolkits, private Google, custom MCP servers and the members' private skills. Every
row has a bare service mark (or a generic plug, or the member's face for a skill),
name, one-line description, switch and detail chevron. Managed bridge
servers are not duplicate rows. Tool switches are grouped by write/read in the
detail. Disconnect lives in the detail overflow with a second-press confirmation.
Custom MCP add/edit/test, command/HTTP, JSON paste and local discovery stay reachable.

The rows sit under three headings: 應用程式 (their tools can be called now), 尚未連結
(waiting for sign-in, failed, a duplicate of another connection, all tools off or
unreadable, each with its reason) and 私人技能. An app is connected only when its tools
can be called now, and the core defines that once (`integrations/inventory.py`); the
Settings > Connections tab's number and its installed rows
all show that one count. An unreadable inventory shows 「—」 instead of a number (the
entry's accessible name says it cannot be read), and an app whose state cannot be read
says 「無法讀取」 on its row.
An app's detail shows its account(s) by status, `已開啟 N/M 個工具` with a switch per
tool, signing in again and, in the overflow, disconnect. A private skill's page shows
its name, who has it, its description (when it is used), a switch, the whole
SKILL.md as editable text and 刪除技能. Sharing an app or a skill is not offered
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
detail or a private skill, change their switches or open an overflow. Add offers custom command/URL, pasted JSON and import.
Use Store to search and Add a built-in service without configuring Composio;
complete its existing login, then return to 已連結. Optionally use the setup row at
the end to save a Composio project key and add its extra apps.

## Driving it with look

```powershell
npm run look -- plugins-installed plugins-detail plugins-store plugins-store-category plugins-store-key plugins-store-key-openrouter plugins-store-key-consumer plugins-connecting --theme both --width 1120,720,1920x1080
npm run look -- connections connections-hover server-menu connections-add-menu connections-command connections-test connections-url connections-edit connections-delete --theme both --width 1120,720,1920x1080
npm run look -- connections-paste connections-paste-preview connections-discover connections-empty connections-discover-empty --theme both --width 1120,720,1920x1080
npm run look -- connect-apps-categories connected-apps-skills connected-apps-unreadable connections-app-switch connector-many-tools connector-account-tools connector-uninstalled skill-private-detail --theme both --width 1120,720,1920x1080
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

The last command in the broader list above is the apps and skills set (`scenes/apps.mjs`). Each scene enters
through Settings > Connections; `apps-count` compares the tab's
number, the rows and the roster, and `apps-unreadable` checks that an unreadable
inventory shows no count.

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

`skill-page` checks the action order and that the document is whole and starts at its first line. Also run `home` (the global sidebar on the wide
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
and Calendar tool switches and revocation. Home calendar reads only through the
enabled private calendar_list_events tool. From a chat, ask for a nonce mail, connect from its Gmail card,
cancel once, finish once and reconnect once; only that task resumes and reads the mail. Test a custom local MCP server with
add/test/edit/paste/discover, a harmless call and removal; stop only that test server.

Count the connected apps by hand against Settings: connect one, let a sign-in expire, add
the same service twice and uninstall one, and watch the number follow each time; ask a CLI
and an API brain how many apps are connected. Switch a tool off, start a new turn and a
running one, and confirm neither brain offers or runs it; do the same after uninstalling,
once with 一律允許 chosen earlier. Edit a private skill's document, ask for what its
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
while an app, skill or project-key dialog is open stays inside that dialog:
re-login success, skill save/toggle/delete errors, tool/app operation errors,
custom server test/refresh and device/browser/cancellation errors. Skill save uses
role=status immediately before its actions. Successful removal closes its dialog
before showing the usual list-level toast.

The selected regression matrix for this change is:

~~~powershell
npm run look -- connector-account-tools connector-many-tools connections-app-switch plugins-detail plugins-store plugins-store-category plugins-store-key skill-private-detail connector-uninstalled --theme both --width 1120,720,1920x1080
~~~

connector-account-tools checks the refusal inline with no refusal toast, then
connections-dialog-actions calls elementFromPoint at EVERY footer button centre
and requires the button or its child. It checks both the folded and expanded tool
states. connector-many-tools and skill-private-detail run the same footer check;
the skill scene also checks inline save feedback without a save toast. Happy-dom
tests cover refusal/denial/timeout/network copy, retry/success/close, stale replies
after reopening, skill save feedback and the footer check's covered-button failure.

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
(`chip-scroll.ts`, shared by any `[data-chip-row]`). `plugins-store-wheel` turns
a real wheel over the chips, checks the left arrow can be pressed and the page
did not scroll, then presses it and checks the row is back at its start with
only the right arrow.

```powershell
npm run look -- plugins-store plugins-store-all plugins-store-category plugins-store-search plugins-store-empty plugins-store-key plugins-store-motion plugins-store-wheel --theme both --width 1120,720,1920x1080
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
