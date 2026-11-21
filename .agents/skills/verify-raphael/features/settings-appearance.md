# Settings and appearance

## Interface locale coverage

The language data exposes native and English names for fifteen LTR interface locales: zh-TW, en, ja,
zh-CN, ko, es, fr, de, pt-BR, it, ru, vi, th, id and tr. The original three catalogs retain their source
copy. New catalogs require every source key and the same formatted fields. Korean, Simplified Chinese
and Thai use script-specific installed font fallbacks. Localized date and number labels use Intl.
Fixed core health, error, receipt, permission, messaging, event and store copy and native notices cover
the same locales. Unknown locales use English. Authored member speech still follows persona/owner
instructions and the conversation; the interface language reaches no model at all, not even as metadata
(R-LANG-01 to R-LANG-04 and conversation.md R-AG-LANG-01). Switching the locale changes the
words the window draws and nothing a member is sent.

Use the existing appearance and appearance-menu scenes with --locale ko, th and de for representative
script/long-label checks at both themes and 1120,720,1920x1080. The visual/native locale lists must match
the app's exposed LOCALES. The native locale sweep covers all fifteen choices; a fixture run alone
does not prove native settings persistence, recording, paste or provider behavior.

The overlay locale scenes check installed script fonts, visible subtitles and a two-line limit.
Korean uses a 52-character page budget so a long notice does not accumulate three Hangul lines.

```powershell
npm run look -- overlay-locale-ko overlay-locale-th overlay-locale-de --theme both --width 1120,720,1920x1080
```

## Memory has no tab, and About's controls are icons

Settings has flat tabs: 一般, 模型, 用量, 工具, 團隊技能, 聽寫與快捷鍵, 安全 and 關於. No memory is shown anywhere
(R-MEM-10, see [Members](members.md#no-memory-on-screen)), so there is no memory tab, no memory list and no
memory loading, and an old link or saved pane named `memory` opens 一般. There is no import from other assistants
either; the memory lives in Raphael's data folder, and
moving to another PC means keeping that folder. 一般 keeps 關於你, 外觀, 拉斐爾 and 啟動, with no memory. 關於's Help is
an outward-arrow icon and the license a chevron; the OpenRouter key's 「變更」 is a pencil, as is each shortcut's in the 編輯快捷鍵 dialog ([Dictation](dictation.md)). This
supersedes the notes below that place memory and its import in General.

```powershell
npm run look -- profile about settings-owner dictation models --theme both --width 1120,720,1920x1080
```

`settings-owner` refuses memory in 一般 and a 記憶 tab.
The core no longer registers an owner memory-import RPC or management boundary row.
MemoryFile.apply and the four memory document/summary RPCs remain intact. Verify with
core/tests/memory, the members management suites and architecture/test_boundaries.py.

## The eight tabs (R-UI-115)

Settings has eight flat tabs: 一般, 模型, 用量 (R-USE-01, see [Usage](usage.md)), 工具, 團隊技能, 聽寫與快捷鍵, 安全 and 關於.
Up and Down move focus through the list in that order. There are no
group names, no search box and no line under a tab's name. Each tab is its name, then sections: a small name
over one rounded card (`--panel`) of rows with no lines between them, the name left and the control right.
一般 holds, in order: 關於你 (the owner's picture, name and about me), 外觀 (theme and language), 拉斐爾 (the
routines' time zone and the output folder) and 啟動 (the guide). Telegram, Slack and Discord are no section here: each member's panel
sets them up in its conversation. Older links land on 一般: `appearance` scrolls to its section, and
`messaging` and `memory` open 一般 as it is. 連結應用程式 stays a dialog of its own from the sidebar (R-UI-111).
This supersedes the About-you grouping and the search notes below.

## 團隊技能 (R-SKILL-17)

The tab lists the shared skills in packages (skill-library.ts): a row per package with its count, who may use it, its switch and ⋯ (also on a right click). Pressing a package of several (its name, count or chevron) opens it on a page of its own in the tab, in the list's place: the back arrow and its name, its dropdown, switch and ⋯ as on its row, where it came from, then its skills, each with a switch. The back arrow, Esc or a step back return to the list scrolled where it was left, the focus on that row; nothing folds open in the list, and a skill alone keeps its one row. A new package of several opens its page at once. The importer is the tab's first card, with no line above it: a link or owner/repo (or pasted SKILL.md in its place), a picked or dropped file, a folder from the system's dialog (the output folder's picker), and one 匯入. Who may use a package is the vault's choice (整個團隊 or the characters ticked). Its menu leads each row with who it names, a character's 20 px face from the roster and, for 整個團隊, the team's own picture (its first four faces in one square, Raphael first, as the sidebar draws the team); a ticked row's check stands at its right edge, never at the left (R-UI-174, `skill-library-access`). A character's skills page shows the packages given to it read-only under 來自團隊技能, with an 開啟團隊技能 button to this tab. The core is `skills.library.*` (R-SKILL-15, R-SKILL-16); the shell lets those four methods through `core_call`.

```powershell
npm run look -- skill-library skill-library-open skill-library-back skill-library-access skill-library-import skill-library-imported skill-library-import-failed member-skills-library --theme both --width 1120,720,1920x1080
```

```powershell
npm run look -- profile appearance dictation tools safety models about settings-owner appearance-menu work-messaging-setup --theme both --width 1120,720,1920x1080
```

`settings-shell` checks the pane order and refuses group names, the search and a line under a tab's name on every settings scene.

## Signed updates

Time zone and output folder keep their regrouped owner rows. Updates are available in About and the sidebar.
A newer database also offers an update directly from its startup notice.

```powershell
npm run look -- about-no-updater-key update-found update-ready update-auto settings-owner about --theme both --width 1120,720,1920x1080
```

With a compiled public key, About checks https://github.com/Jheng-Kai/Raphael/releases/latest/download/latest.json on opening.
The release-assets test rejects the former owner in updater configurations and publication.
Release verification also covers both owner updater keys, neither key and either key alone.
With both keys the Windows builder signs the installer and the Apple silicon builder verifies the signed .app.tar.gz
archive and the version inside the app. Publication assembles their windows-x86_64 and darwin-aarch64 entries
in one latest.json. Otherwise one warning accompanies
the verified installer, notices, BUILD-INFO and checksums, with no .sig or feed. The disabled
mode uses a small config override and records its reason in BUILD-INFO. Publication reads the
checked version job output in both modes. Signed mode refuses missing or malformed signatures
and a mismatched trusted-comment version. These offline contracts do not prove a CI build or
GitHub publication. Without a compiled public key, the existing native not_configured result
maps to a quiet About row with the current app version, localized release-page guidance and
one shared button. It opens https://github.com/Jheng-Kai/Raphael/releases through the existing
open_external_url boundary. No unavailable check/install/automatic controls or error notice
appear. The native check returns before contacting the feed; the release-page action makes
no update request. about-no-updater-key checks the real settings entry, native opener boundary and
absence of another update check.
A newer version shows escaped notes and an install action. Background checking is on by default and
checks and downloads hourly. An owner's press authorizes installation. It proceeds with an idle roster;
active or waiting members defer the request until idle, and a second press cancels. An unknown roster
defers installation. A core that refused a newer database starts no members, so that startup screen can
install on request. The startup screen shows checking and downloading in the primary button, and reports
a current version or unavailable updater in one line. On a Mac the updater replaces the app bundle and
the shell requests a restart. The signed artifact must include the manifest's version. One startup receipt
reports the installed version when the main page is visible; hidden startup retains the receipt.

Selected look for the release-page fallback: about, about-no-updater-key, update-found,
update-ready and update-auto; zh-TW, both themes, 1120,720,1920x1080. Inspect every contact
sheet and the fallback at light 720 and dark 1120. Compare its button and row with About
Help/License at the same theme and width. This fixture does not prove the default OS browser
or installed-app behavior. No Rust changed for this mapping.

Selected look for the original updater work: update-found, update-ready, update-auto,
profile, chat, attachment-limits and attachment-too-large;
zh-TW, both themes, 1120,720,1920x1080. Compare About's update actions and switch with
General's existing controls.
Judge must use this same run and external references. Fake fixtures do not prove real
GitHub releases, native asset ranges, upgrade restart or one-shot persistence.

Targeted checks: updates, attachment-stream, settings-view, agent-attach,
chat-composer, attachment-media, architecture and catalog Vitest; memory service
and attachment upload/readers pytest; release-asset tests with a temporary generated key.
Offline Rust: cargo fmt --all -- --check; cargo test --offline --locked;
cargo clippy --offline --locked --all-targets -- -D warnings; vendored listener unchanged.
Use the official updater 2.14.1 recorded in Cargo.lock; populate the private Cargo cache
from an authorized fetch before running offline. The fake-feed test covers a valid artifact,
tampered bytes, an empty signature, an inflated version with an old signature and an older
release, using a temporary generated key and never executing the payload. MSVC embeds the
shared common-controls v6 manifest in both the app and library unit-test executables.
No private key belongs in source.

## Settings merge consumers

General keeps the owner profile, weather city and output folder
together in About you. Tools and Safety retain their shared scope; legacy agent
links resolve to Tools.
Computer search opens that member's panel. Host checks and copyable repair
commands use the location popover, never the retired settings pane.

```powershell
npm run look -- desktop-host-local desktop-host-error settings-owner --theme both --width 1120,720,1920x1080
```

## Owner output folder in General

R-OUTPUT-01 adds the optional absolute delivery folder to Settings > General,
chosen with the folder picker of R-COLLEAGUE-06 (no typed field). Changing the preference
never moves existing files. The shared owner context tells every speaker to use
it by default within existing permissions; VM and owner-PC paths remain distinct.
See [Daily work](daily-work.md) for prompt and native delivery limits.
Follow-up 1 authorizes the selected look run; actual native/live delivery is deferred.

```powershell
npm run look -- owner-output-folder output-folder-picker output-folder-picker-cancel --theme both --width 1120,720,1920x1080
```

Inspect its full-size General pane in both themes at all three sizes. Compare
the folder row's field, spacing, help text and focus with the surrounding owner
and General settings; judge the selected run only under authorized prerequisites.

The owner's avatar is part of the account/profile section.
Use the existing presets or file picker and drag/zoom crop dialog. A bounded 192px
WebP is stored in the existing owner_photo setting. Sidebar account footer and all
owner messages share the same face and owner_name, with a person-icon fallback.
The footer opens account settings; connected apps live only in Connections.


Models in use includes one Quick questions row directly below Raphael's answer.
The model uses the shared provider/model card and chooser, with the shortcut's
purpose and price on the left, or above the picker at narrow widths. An empty quick model displays and inherits the answer
model. Quick effort is chosen inside the chooser, in the same effort row as the answer
model's (never a separate control beside the card); a newly chosen
model starts at low, and under 「與回答相同」 the row is the answer model's. The core
still saves the quick model and its effort apart (`quick_model`, `quick_effort`).
API effort metadata and CLI effort mappings follow their existing catalogs. Every effort
list displays none, minimal, low, medium, high, xhigh, max, followed by unknown efforts
in their catalog order; chosen and default efforts keep their existing meaning.
Cleanup does not consume a chosen effort: its chooser has no effort row or footer effort,
and saves the bare model reference without ?effort=. The core's catalog policy decides it.

```powershell
npm run look -- quick-model-menu quick-effort-menu quick-model-selection --theme both --width 1120,720,1920x1080
```

## Sub-features

Owner profile/preferences, themes, models/providers, dictation, assistant,
messaging, data management and About. Usage and MCP have separate maps.
Subscription accounts share the room row-action menu: disconnect disables a CLI only
inside Raphael, removes its models, and leaves a framed Connect action. Reconnect reuses
an existing CLI login. Caption icon controls keep transparent hover/pressed surfaces (R-UI-16). Close uses
the error foreground; glyph contrast and keyboard focus are checked.

Cleanup and answer JSON calls accept models with reasoning off, no reasoning setting or
mandatory reasoning. Calls read the cached catalog: off, omitted or minimal/low/first listed
effort respectively (low if unlisted). Explicit answer efforts stay. The picker uses core
role usability; structured output and max_tokens remain required.

Model choosers for answers, cleanup, speech and vision share separated selection rows.
Local speech models show languages, size, notes and download state; choosing a row only
previews it until the fixed footer's action is used. Rows keep an 8 px gap, subtle
theme borders and visible keyboard focus, with metadata wrapping inside narrow panes.

## How to get to it (user POV)

Open the sidebar account footer, then a settings pane. Appearance has one theme dropdown and one language dropdown in a narrow card; General has owner name/about and the shared avatar picker. Use presets or
upload and crop an image; the resulting face appears on the footer and outgoing messages.

## Driving it with look

```powershell
npm run look -- profile appearance appearance-menu appearance-keyboard models dictation tools safety about theme-clarity --theme both --width 1120,720
npm run look -- sidebar sidebar-search sidebar-group-avatar-pair sidebar-group-avatar-four chat appearance appearance-menu appearance-keyboard desktop-takeover-owner foot-account-calendar dictation-dictionary theme-clarity --theme both --width 1120,720,1920x1080
npm run look -- appearance --theme both --width 1120,720,1920x1080 --locale ja
npm run look -- chatgpt-signed-out chatgpt-signed-in chooser-chatgpt-signed-out chooser-chatgpt-signed-in chooser-claude-models chooser-claude-older cli-account-menu cli-account-disconnected cli-account-reconnected window-hover-minimize window-hover-maximize window-hover-restore window-hover-close window-hover-modal --theme both --width 1120,720,1920x1080
npm run look -- model-choices-answer model-choices-cleanup model-choices-stt model-choices-local model-choices-local-selected settings-local-stt --theme both --width 1120,720,1920x1080
```

Speech to text on this PC (`settings-local-stt`, the fixture flag `localSpeech`, R-MODEL-07) reads the local model's name over 本機 with no mark: the
cloud model kept for later lends it neither its name nor its maker's mark (issue 232), and the name lines up with the other unmarked choices.

Claude Code's tab of the chooser (`chooser-claude-models`, R-MODEL-04) lists what Claude Code
says and knows: its own four first, in its order, then the older models its program still runs,
each name with its version and each row the exact model id (`cli:claude:claude-opus-5-5`), made
and sized as a Codex row (`chooser-claude-style`); `chooser-claude-older` scrolls to the oldest. Inspect that every name is whole at 720 wide.
The fixture is the shape of the core's answer, with aliases on the four current rows.
`model-choices-answer`, `model-choices-cleanup`, `model-choices-stt` and `quick-model-menu` also run `price-parts` (R-MODEL-06): a price never breaks inside one of its parts.

Keep pane/theme PNGs; inspect wrapping, focus, scroll access, active selections and
dropdown/popover contrast. Use `--locale en` and `--locale ja` for translation work;
raw-key checks do not prove translation quality. Extend scenes through change/reopen
for persistence. Native provider/model, messaging, import/export, autostart and data
deletion need isolated real journeys and observable side effects.
CLI credential cleanup and persisted disconnection are covered by temporary-home core
tests; look drives the real account menu through the existing IPC boundary. Check all
caption hover images at full size and keep the driver's centering, margins, transparent pressed,
tooltip, focus and close-contrast assertions. Native OS minimize/maximize/close and a real
CLI login remain separate checks; never log out the user's shared CLI account.

The model-choice scenes open Models, then its answer, cleanup or speech
picker. Speech's local source uses the shared synthetic catalogue, including models
that are not downloaded. Rendered checks reject native outset borders, touching rows,
clipped metadata and overlapping footer actions, reach the last model by scrolling,
and ensure selecting a local model neither downloads it nor saves settings.

Safety-rule editing/deletion and always-allowed app removal use each row's overflow
menu (R-UI-11).

## Gotchas

The theme resolves system/light/dark. There are no skins; a saved skin value from an older build is ignored. Contrast
tests cannot prove every rendered combination. Native settings/provider responses
are fixtures. Profile is reached through Settings, not a retired owner menu. Keep
destructive native steps within task authorization and disposable test data.

## UI audit regression coverage

Appearance choices form exactly two card columns at every matrix width (R-UI-30).
Settings headings omit repeated purpose subtitles (R-UI-02). Model chooser source
actions retain an 8px gap below the list, including a scrolled full list. The selected
source scrolls fully into view when opening or switching sources (R-UI-01).

## Switching the whole window language (R-UI-14)

Dictionary translates its current template, without touching the removed subtitle.
Locale listeners are isolated so a broken surface cannot reject the device setting
or stop settings navigation, sidebar/drawer, pages or notices from refreshing. Failures
are diagnostic warnings, never owner error toasts. Transient menus and closable shared
dialogs dismiss on a locale change; reopening builds their current-language snapshot.
Persistent surfaces use their existing locale listener or redraw on entry.
The avatar crop dialog translates in place and keeps its current crop; an image
lightbox closes so its translated actions are rebuilt on reopening.

```powershell
npm run look -- settings-language-en settings-language-ja settings-language-zh-TW --theme both --width 1120,720,1920x1080
```

Each journey selects the language through Settings, walks every settings pane, main
page, calendar and dictation subtab, then inspects visible UI strings against all
three catalogues. Authored names/documents/backend prose stay in their original language.
A locale-listener warning, console error, error toast or stale interface label fails.
Regression coverage: `i18n/i18n.test.ts` and `pages/locale-switch.test.ts`.

## Shared content measures

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Pane alignment

Every settings pane caps its direct content, header, toolbar, lists and grids at
the same 640px measure. Settings list padding is removed at the pane boundary,
so each pane retains aligned controls. Appearance alone uses its narrow row card. The rendered alignment
check also covers connected-app headers, search tools and rows.

Header actions themselves share that right edge, without the old 32px inset.
Compact panes with header actions reserve vertical clearance below the corner
Close button. settings-alignment compares control bounds as well as containers
and rejects overlap with Close.

## Concise settings copy

Profile, dictation, appearance, models, data and messaging use settings-concise to reject the specifically retired helper paragraphs. Model row labels and prices remain, while narrow rows stack their picker below the label/price. Telegram retains BotFather and the token field. Appearance/skin subtitles are removed; other app copy is unchanged.

## Models without a price note

Models omits the reference-price helper paragraph while retaining price/subscription information on each purpose row. Catalog failure remains an essential error. settings-concise rejects the redundant price note in the normal Models fixture; models-responsive retains the stacked narrow-row contract.

## Acceptance fixes

The quick-model-row check follows rounds 6/7 and R-UI-02: its localized row label
says Quick questions, its shared picker shows model/source, and its price remains
visible. No helper paragraph is required or permitted. The affected matrix is
models, quick-model-menu, quick-effort-menu and quick-model-selection, both themes
at 1120,720,1920x1080. The audit regression rejects a generic Model label.

## OpenRouter selection identity

The shared chooser can save an answer/member API reference with `?effort=`;
quick questions retain a bare model plus separate `quick_effort`. Core validation,
catalog refresh, capability/context lookups and prices use the catalog model identity.
The provider router sends that bare model and maps a selected effort to OpenRouter's
`reasoning.effort`. An explicit `@openrouter:` alias is canonicalized at settings save.
Only reasoning models with supported metadata offer effort; non-reasoning choices
have no effort controls. Cleanup keeps its existing bare-reference contract.

Affected look scope: models, model-choices-answer, quick-model-menu,
quick-effort-menu, quick-model-selection and member-brain-saved, both themes at
1120,720,1920x1080. Native `model-picker` uses an isolated SQLite cache seeded from
a real public catalog response (`RAPHAEL_NATIVE_MODEL_CATALOG`) and exercises
save/reopen/next-turn routing for answer, quick questions and a member. Its provider
is fake; HTTP-body tests separately assert the exact model/reasoning payload.
Neither check is paid OpenRouter acceptance. See the shared look README for launch.

## Hairlines on what stands apart (R-UI-162)

What stands apart from the page on its own wears a hairline a shade above its fill; a fill inside another surface wears
none. In the dark `--edge-rim` is `#2b2b2b` over the `#1f1f1f` fill (it used to be the fill's own colour, so nothing showed): the header's name
pill, the round header buttons, the sidebar's search and plus, the page and peer pills and the Connections pill in the list draw
`inset 0 0 0 1px var(--edge-rim)`; the Connections pill on the rail and the composer's plus draw none. A member's reply keeps the faintest
hairline (`--ans-edge` a step above its fill). The light theme keeps its rims (`#e3e3e3` on `#efefef`). Menus, dialogs, cards and buttons
already had their edges (R-FLOAT-01, `--edge`, `--btn-edge`) and are unchanged; rows, tabs, chips and status pills have none.
`edges.test.ts` holds the tokens and the three rules; `chat`, `conversation-share`, `details`, `sidebar`, `sidebar-rail` and `composer` show them.
The research behind the values is local (the owner's references), never in the repository.

## Theme and clarity

Appearance uses the shared sel/openMenu component, with system/light/dark and
language as two rows inside a <=640px card. Language moved from General to this pane;
search and locale journeys follow that entry. There is no preview gallery or skin grid.
Black uses neutral near-black surfaces, white accent/primary controls, neutral selection,
focus and chart tokens; only semantic status and external service art retain colour.
Default keeps its blue surfaces/accent, with neutral readable secondary text. The actual
conversation radial gradient is removed. theme-clarity records computed root/conversation
opacity, filter, backdrop and background; appearance-settings checks the shared row card.
check-palette covers default/light, default/dark and black/dark, including chart marks.

Run the full two-theme, three-size look matrix once, plus the black
representatives above.

Native `appearance` drives all three theme choices at 1120,720,1920x1080, checks the real shared dropdown and confirms black in the production settings store.


## Settings by purpose

This owner decision supersedes the former Settings > Raphael pane and its earlier
scene names. General owns the owner profile and weather city.
Dictation & shortcuts groups dictation, paste, cancel and Ask Raphael shortcuts.
Tools owns shared search, page reading, images, PDFs and their keys (no voice service);
Safety owns shared safety rules, local command policy and always-allowed apps.
Navigation groups are Basics, Team, Integrations and Account. Every pane retains
its localized purpose as explicitly requested by this brief (a scoped R-UI-02
exception); Tools and Safety explicitly apply to every member.
Legacy pane `agent` resolves to `tools`; setting keys, RPCs and stored values stay
unchanged. Every member's draft
preference switch is the first row inside the same grouped resource card as
Skills and Commands.

The computer panel header owns one compact shared location control, also available
in its empty state. It shows Local or the saved SSH alias, uses the shared popover,
select, field and buttons, saves only `computer_ssh_alias`, and rejects invalid
aliases before storage. Its words describe current state; there is no invented
host check RPC. Remote current-state errors remain inside the popover. A local
absent runtime retains one Docker download action there. Settings searches for
computer location or remote return one result that closes Settings and opens the
computer panel. No host is started or checked by opening the popover, and an
existing viewer stream is not replaced by changing the setting.

Selected scenes (synthetic zh-TW, both themes, 1120,720,1920x1080):
profile, settings-owner, appearance, dictation, tools, safety,
models, connections, about,
local-command-settings-gone,
menu-settings-redraw, missing-vision, missing-search, missing-search-repair,
speaker-draft-chief, speaker-draft-member, speaker-draft-profile,
desktop-host-local,
desktop-host-remote, desktop-host-invalid, desktop-host-error, desktop-install,
desktop-panel, desktop-viewer, desktop-absent, panel-no-computer.

Compare General/Tools/Safety rows with Appearance, the location select/input with
General's city and Appearance's select, the grouped draft row across both members,
and the computer panel header in the landing and expanded viewer. Inspect all
contact sheets and relevant full-size panes/popovers at matching sizes/themes.
Focused tests: settings-view.test.ts, settings-providers.test.ts,
agent-settings.test.ts, agent-members.test.ts, member-details.test.ts, services.test.ts,
computer-location.test.ts, desktop-viewer.test.ts,
missing.test.ts, missing-consumers.test.ts, timeline.test.ts, group-chats.test.ts,
mcp-proposal.test.ts, nav-history.test.ts and the shared look audit test. tsc and these targeted tests run without the waiter. The selected look matrix
calls the waiter once and proceeds on clear or timeout. The final frontend verify
is deferred to the integrator at merge. Native Docker, SSH, audio and persistence
remain separate acceptance. The unit forbids network
and paid APIs, so subscription/API judge is SKIP; local visual review still applies.

Completed work detail also preserves the existing missing-service notice and repair
button from persisted steps, including turns with action events. The missing-search
and missing-search-repair scenes cover the real work section and shared Tools form.
The language audit treats typed synthetic values as owner data while continuing to
reject untranslated control labels. The desktop-absent browser assertion also
requires at least 4.5:1 text contrast for the Docker download button. The button
uses the same existing desktop-frame surface tokens as its neighbouring notices.

The location popover uses one shared inset and stacked, full-width controls. Its
scope is stated once; the header alone names the saved host. Every desktop-host-*
scene runs host-settings-layout, checking each wrapped text line and control edge
within 1px, matching select/field widths, and left-aligned trigger text. Keep the
same standard field/select padding inside those controls. No status note repeats
the host, and host errors remain contextual. The follow-up matrix is the four host
scenes plus desktop-panel, both themes at 1120,720,1920x1080.


## Shared owner vault

R-VAULT-01..05: Settings > Safety contains Vault. Entries have login, contact or
card kinds, counted list filters, a label, one-line owner hint and all/chosen-member
access. The counted filters browse records; they are not setting-value controls.
Use the shared fieldHTML, sel/openMenu and row action menu. Nothing in Safety is a box to
tick (R-UI-174): once 指定對象 is chosen, each member is a row of the group dialog's kind
(`.room-row`, one button with `aria-pressed`), its 28 px face and name at the left and the
round check at the right edge; a chosen row is filled the whole way with `--selected`. They
stand in two columns, one below 800 px so that a long name is read whole. The
rows of an imported file's preview are the same, an entry's label over its site, all chosen
at first. A press chooses where it stands and keeps the private fields typed above it.
`vault-sharing` presses a member and `vault-import-preview` leaves one entry out, each with
the pointer moved away, so the pictures show a chosen row as it stays. Removing an entry is three
presses: ⋯ (or a right click), 移除, which asks 「確定移除這筆資料？」 in its own place in the
same menu (`ActionItem.ask`), and that item again; no second menu opens.

```powershell
npm run look -- vault-list vault-filter vault-entry-menu vault-entry-remove-ask vault-new-login vault-new-contact vault-new-card vault-sharing vault-import-preview vault-card-permission calm-thread --theme both --width 1120,720,1920x1080
```

Selected scenes: vault-list, vault-filter, vault-entry-menu, vault-entry-remove-ask, vault-new-login, vault-new-contact,
vault-new-card, vault-sharing, vault-import-preview, vault-card-permission,
calm-thread on the merged thread layout. Run both themes at
1120,720,1920x1080. Inspect all contact sheets and each new scene at light 720
and dark 1120. Compare fields, dropdowns, list filters, row menus and permission
cards with existing consumers at the same dimensions.

VaultEntries keeps only metadata in SQLite. Values stay in Windows Credential
Manager. Migration 63 preserves every legacy computer_logins reference and its
member grant without reading or rewriting a credential. CSV file input sends
selected owner file bytes to an in-memory, ten-minute preview; previews return
labels/origins only. Confirmation imports only checked entries, once; cancellation
discards the preview. Chrome and 1Password login column variants are supported;
non-HTTPS, malformed or non-login records are counted as skipped. The source is
never copied. Partial credential-store failures report counts and require a fresh
preview; inspect the list before retrying.

The curated computer catalog adds vault_entries, fill_contact and fill_card.
Members see opaque IDs, kinds, labels and hints, choose by hint and ask the owner
if two fit. Value reads recheck member access and HTTPS origin before each input;
driver echoes, exception details and screenshots stay private. Card use is firm
T3 in every mode with no Always option, names merchant/amount/label, and persists
a computer action hold before the first field. Only explicit owner completion of
a payment takeover clears it; navigation, scripts, batched actions and restart
do not. An interrupted payment may therefore require a fresh private payment
takeover, even after restarting the core.

Offline checks: tests/computer/test_vault_entries.py, test_login_vault.py,
test_login_visibility.py, tests/agent/test_private_login.py, background question
and snapshot consumers, frontend vault.test.ts and settings-view.test.ts. Tests
use only fake keyrings and browsers. Real OS persistence, native file selection,
real merchant pages, subscription judgment and live model choice remain separate
acceptance. This unit explicitly skips full verify/core suites and forbids network.

Payment permission cards deliberately show their merchant, amount and label in the
shared card body without disclosure, and omit Always. Other permission cards keep
their existing disclosure and policy. Vault kind filters use the same plain
navigation tabs and inline counts as Connections; segmented filters remain exclusive to History and Dictionary.


## The Keychain is asked once, and a Deny stands

R-PRIV-KEYCHAIN-01. Every secret (the model keys, the service keys, the plugins' and apps' secrets, the
vault, the members' sign-ins) goes through `core/src/raphael_core/keychain.py`; `CredentialKeyStore`,
`CredentialVault` and `ProviderCredentialStore` are its stores. With the macOS Keychain a "has key" (Settings,
the model lists, Connect Apps, the services, the self check) reads the item's attributes only and asks nothing;
a secret is read when it is used, once in a run; a Deny stands until 再問一次 or a new start. The core sends
`keychain.refused`; the shell passes `MainEvent::KeychainRefused` and lets the window call
`keychain.ask_again`; `keychain-refused.ts` shows one toast with 再問一次 above the composer. On Windows every
call goes straight to Credential Manager, which never asks.
On macOS the secrets live in `secrets.bin`, sealed with one master key item, and old items move on first use (R-PRIV-KEYCHAIN-02).

```powershell
npm run look -- keychain-refused keychain-asked --theme both --width 1120,720,1920x1080
```

`keychain-refused` replays the shell's event twice and checks one toast with the exact words, its status role,
its one button beside or under the words, the toast inside the window and clear of the composer, and that
nothing is asked again before the press. `keychain-asked` presses it: the core is asked once, the toast goes and
the note of what happens next stands (on a Mac it names Always Allow). The core's door has pytest (`core/tests/test_keychain.py`), the toast vitest
(`keychain-refused.test.ts`), the shell's pass-through cargo (`commands.rs`). The real Keychain's attribute
read is not reached by any test: it was checked by hand on a Mac with the Keychain's user interaction turned off,
so no question could be shown.

## Attachment root and Office expansion security

R-SEC-FILES-01/03: core/tests/services/test_reader_security.py verifies attachment read,
save and chunk-upload admission against a redirected storage root and limits repeated
XLSX shared-string output before allocation/join. Keep the existing upload, text/Office,
PDF/media, vault and memory suites in the affected core scope. Existing size limits,
opaque IDs, owner CSV preview and private-fill consent semantics are retained. No UI
change means no local look/judge run; OS vault and native file opening are unverified.

## Owner-only persistence and bounded native logs

R-SEC-DATA-01 and R-SEC-LOG-02: tests/test_storage_security.py uses temporary folders
for owner-only DACL verification, fail-closed ACL errors and five-version migration
backup retention. Include tests/test_paths.py, memory/test_files.py and app startup
consumers. Never infer a real owner data migration from these isolated tests.
Rust core_stderr tests cover credential forms, overlong lines, UTF-8/EOF and benign
diagnostics; run cargo test --locked offline with a worktree-local target directory.
This changes no Settings markup or navigation and adds no look scope.

## Settings and Connect Apps, small fixes (R-UI-150 to R-UI-153)

關於我 has no drag handle, is four lines at rest with the rest folded, and grows while written; the about tab's mark and name select nothing;
Safety has no 電腦操作 section; a connected app's 「✓ 已連結」 is inside the row's one button in Connect Apps.

```powershell
npm run look -- settings-owner settings-owner-about-typing settings-owner-about-rest settings-about-brand local-command-settings-gone connect-apps connect-apps-connected-hover connect-apps-row-hover connect-apps-connected-rows --theme both --width 1120,720,1920x1080
```
