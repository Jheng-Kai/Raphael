# Plugins, connections and MCP

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
sidebar's 連結應用程式 entry (a count beside its label, or a badge on its icon only in the rail), the tab's number, the rows
under 應用程式 and the roster every model is given (`TeamContextSnapshot.connected`)
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
connecting and unavailable states use the same row/action slots, with no managed
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

Press 連結應用程式 at the bottom of the sidebar (the plug with a count at the bottom
of the rail), or open Settings > Connections. Use 已連結 to open a service
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
The fixture has four representative built-ins from the repository catalog. The two
configured Store scenes add 360 synthetic entries across three categories (with
multiple-category memberships and a duplicate), yielding 363 unique managed rows
and 367 total rows. They check complete grouping, provider category order, local
search for the last entry and the category dropdown. The shared driver's optional
measure field records real click/input-to-next-painted-frame durations, with a
250 ms budget for opening and searching the large list; it excludes automation
transport time. Each render shares one filtered catalog snapshot between its rows
and count. A refresh retains the existing rows until the reply, without a redundant
pending-state redraw. Off-screen managed row contents use browser content visibility
with a 64px intrinsic height; every app remains in its original grid and category.
`plugins-store` scrolls to app 360, checks the row layout and opens its detail,
then returns to the top; search and the category journey still cover the full list.
Use `LOOK_TRACE=1` with the shared look command to retain per-interaction Chrome
traces, including budget failures. These measurements concern this offline browser fixture;
they do not establish live provider or native timing. Unit tests cover source
failures, local search/count, category isolation and late replies after reset.
Core tests cover cursor paging, concurrent cache reads, one-hour expiry, atomic
failure fallback, key invalidation, repeated cursors and the 3,000-entry cap.

The last command in the broader list above is the apps and skills set (`scenes/apps.mjs`). Each scene enters
through the sidebar's 連結應用程式; `apps-count` compares the badge, the tab's
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

`skill-page` checks the action order and that the document is whole and starts at its first line. Also run `home` (the sidebar entry on the wide
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

## Native acceptance owned by the maintainer

Run the full look matrix, judge with external ChatGPT/Codex reference images and
verify --live in the authorized environment, as reserved in .brief-plugins.md.
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

Count the connected apps by hand against the sidebar: connect one, let a sign-in expire, add
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

The connected-app count stays at the row end beside the label in every expanded sidebar, including 720px. Only the icon-only rail places the count over the plug icon. sidebar-count-alignment checks both modes using representative Home, Team, calendar, dictation and conversation scenes; inventory semantics remain unchanged.
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
card owns cancellation; composer Stop, rail selection and details-panel placement
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

```powershell
npm run look -- plugins-store plugins-store-all plugins-store-category plugins-store-search plugins-store-empty plugins-store-key plugins-store-motion --theme both --width 1120,720,1920x1080
```

This round's design judge is explicitly reserved for the maintainer's Codex shell;
do not run it from this task. Fixture/browser results do not establish native,
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
