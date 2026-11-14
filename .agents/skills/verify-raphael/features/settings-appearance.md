# Settings and appearance

## Interface locale coverage (brief 21, 2026-11-08)

The language data exposes native and English names for fifteen LTR interface locales: zh-TW, en, ja,
zh-CN, ko, es, fr, de, pt-BR, it, ru, vi, th, id and tr. The original three catalogs retain their source
copy. New catalogs require every source key and the same formatted fields. Korean, Simplified Chinese
and Thai use script-specific installed font fallbacks. Localized date and number labels use Intl.
Fixed core health, error, receipt, permission, messaging, event and store copy and native notices cover
the same locales. Unknown locales use English. Authored member speech still follows persona/owner
instructions and the conversation; interface metadata never overrides that policy.

Use the existing appearance and appearance-menu scenes with --locale ko, th and de for representative
script/long-label checks at both themes and 1120,720,1920x1080. The visual/native locale lists must match
the app's exposed LOCALES. The native locale sweep covers all fifteen choices; a fixture run alone
does not prove native settings persistence, recording, paste or provider behavior.

The overlay locale scenes check installed script fonts, visible subtitles and a two-line limit.
Korean uses a 52-character page budget so a long notice does not accumulate three Hangul lines.

```powershell
npm run look -- overlay-locale-ko overlay-locale-th overlay-locale-de --theme both --width 1120,720,1920x1080
```

## Memory has no tab, and About's controls are icons (owner, 2026-11-08, 2026-11-11)

Settings has six flat tabs: 一般, 工具, 安全, 模型與用量, 聽寫與快捷鍵 and 關於. For one day (2026-11-08 to
2026-11-11) a seventh, 記憶, held the shared owner memory; the owner then decided that no memory is shown anywhere
(R-MEM-10, see [Members](members.md#no-memory-on-screen-owner-decision-2026-11-11)), so the tab, its lists and its
loading are gone, and an old link or saved pane named `memory` opens 一般. There is no import from other assistants
either (owner, 2026-11-08: 「匯入記憶不要這樣設計…沒有什麼實際的意義」); the memory lives in Raphael's data folder, and
moving to another PC means keeping that folder. 一般 keeps 關於你, 外觀, 拉斐爾 and 啟動, with no memory. 關於's Help is
an outward-arrow icon and the license a chevron; the shortcuts' and the OpenRouter key's 「變更」 is a pencil. This
supersedes the notes below that place memory and its import in General.

```powershell
npm run look -- profile about settings-owner dictation models --theme both --width 1120,720,1920x1080
```

`settings-owner` refuses memory in 一般 and a 記憶 tab.
The core no longer registers an owner memory-import RPC or management boundary row.
MemoryFile.apply and the four memory document/summary RPCs remain intact. Verify with
core/tests/memory, the members management suites and architecture/test_boundaries.py.

## Grok Bot's six tabs (owner, 2026-11-07, R-UI-115)

Settings has six flat tabs, as Grok Bot's: 一般, 聽寫與快捷鍵, 工具, 安全, 模型與用量 and 關於. There are no
group names, no search box and no line under a tab's name. Each tab is its name, then sections: a small name
over one rounded card (`--panel`) of rows with no lines between them, the name left and the control right.
一般 holds, in order: 關於你 (the owner's picture, name and about me), 外觀 (theme and language), 拉斐爾 (the
routines' time zone and the output folder) and 啟動 (the guide). Telegram, Slack and Discord are no section here: each member's panel
sets them up in its conversation (2026-11-07 evening). Links of before land on 一般: `appearance` scrolls to its section, and
`messaging` and `memory` open 一般 as it is. 連結應用程式 stays a dialog of its own from the sidebar (R-UI-111).
This supersedes the About-you grouping and the search notes below.

```powershell
npm run look -- profile appearance dictation tools safety models about settings-owner appearance-menu work-messaging-setup --theme both --width 1120,720,1920x1080
```

`settings-shell` refuses group names, the search and a line under a tab's name on every settings scene.

## Signed updates (2026-11-05)

The owner memory import of this date was removed on 2026-11-08 (see above).
Time zone and output folder keep their regrouped owner rows; updates stay in About.

```powershell
npm run look -- about-no-updater-key update-found update-ready update-auto settings-owner about --theme both --width 1120,720,1920x1080
```

With a compiled public key, About checks https://github.com/Jheng-Kai/Raphael/releases/latest/download/latest.json on opening.
The release-assets test rejects the former owner in updater configurations and publication.
Release verification also covers both owner updater keys, neither key and either key alone.
Only both keys enable version-bound signing and latest.json; otherwise one warning accompanies
the verified installer, notices, BUILD-INFO and checksums, with no .sig or feed. The disabled
mode uses a small config override and records its reason in BUILD-INFO. Publication reads the
checked version job output in both modes. Signed mode refuses missing or malformed signatures
and a mismatched trusted-comment version. These offline contracts do not prove a CI build or
GitHub publication. Without a compiled public key, the existing native not_configured result
maps to a quiet About row with the current app version, localized release-page guidance and
one shared button. It opens https://github.com/Jheng-Kai/Raphael/releases through the existing
open_external_url boundary. No unavailable check/install/automatic controls or error notice
appear. The native check returns before contacting the feed; the release-page action makes
no update request. The configured-key UI remains unchanged. about-no-updater-key checks the
real settings entry, native opener boundary and absence of another update check.
A newer version shows escaped notes
and Download and restart. Auto update is off by default; opt-in downloads in the background,
then installs only after ten minutes of native idle and a complete idle roster. The signed
artifact must include the manifest's version. One startup receipt reports the installed
version when the main page is visible; hidden startup retains the receipt. Unknown state,
missing core, active or waiting members prevent installation.

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
GitHub releases, OS idle time, native asset ranges, upgrade restart or one-shot persistence.

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

## Settings merge consumers (2026-11-05)

General keeps the owner profile, weather city and output folder
together in About you. Tools and Safety retain their shared scope; legacy agent
links resolve to Tools.
Computer search opens that member's panel. Host checks and copyable repair
commands use the location popover, never the retired settings pane.

```powershell
npm run look -- desktop-host-local desktop-host-error settings-owner --theme both --width 1120,720,1920x1080
```

## Owner output folder in General (2026-11-05)

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

Owner decision 2026-10-30 adds the owner's avatar to the account/profile section.
Use the existing presets or file picker and drag/zoom crop dialog. A bounded 192px
WebP is stored in the existing owner_photo setting. Sidebar account footer and all
owner messages share the same face and owner_name, with a person-icon fallback.
The footer opens account settings; connected apps live only in Connections.


Models in use includes one Quick questions row directly below Raphael's answer.
The model uses the shared provider/model card and chooser, with the shortcut's
purpose and price on the left, or above the picker at narrow widths. An empty quick model displays and inherits the answer
model. Quick effort is chosen inside the chooser, in the same effort row as the answer
model's (owner, 2026-10-27: never a separate control beside the card); a newly chosen
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
npm run look -- model-choices-answer model-choices-cleanup model-choices-stt model-choices-local model-choices-local-selected --theme both --width 1120,720,1920x1080
```

Claude Code's tab of the chooser (`chooser-claude-models`, R-MODEL-04) lists what Claude Code
says and knows: its own four first, in its order, then the older models its program still runs,
each name with its version and each row the exact model id (`cli:claude:claude-opus-5-5`), made
and sized as a Codex row (`chooser-claude-style`); `chooser-claude-older` scrolls to the oldest. Inspect that every name is whole at 720 wide.
The fixture is the shape of the core's answer, with aliases on the four current rows.

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

The model-choice scenes open Models and usage, then its answer, cleanup or speech
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

## Switching the whole window language (2026-10-28, R-UI-14)

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

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Owner round 4 pane alignment

Every settings pane caps its direct content, header, toolbar, lists and grids at
the same 640px measure. Settings list padding is removed at the pane boundary,
so each pane retains aligned controls. Appearance alone uses its narrow row card. The rendered alignment
check also covers connected-app headers, search tools and rows.

Header actions themselves share that right edge, without the old 32px inset.
Compact panes with header actions reserve vertical clearance below the corner
Close button. settings-alignment compares control bounds as well as containers
and rejects overlap with Close.

## Owner round 6 contracts

Owner round 6: profile, dictation, appearance, models, data and messaging use settings-concise to reject the specifically retired helper paragraphs. Model row labels and prices remain, while narrow rows stack their picker below the label/price. Telegram retains BotFather and the token field. Appearance/skin subtitles are removed; other app copy is unchanged.

## Owner round 7 contracts

Models omits the reference-price helper paragraph while retaining price/subscription information on each purpose row. Catalog failure remains an essential error. settings-concise rejects the redundant price note in the normal Models fixture; models-responsive retains the stacked narrow-row contract.

## Acceptance fixes (2026-10-30)

The quick-model-row check follows rounds 6/7 and R-UI-02: its localized row label
says Quick questions, its shared picker shows model/source, and its price remains
visible. No helper paragraph is required or permitted. The affected matrix is
models, quick-model-menu, quick-effort-menu and quick-model-selection, both themes
at 1120,720,1920x1080. The audit regression rejects a generic Model label.

## OpenRouter selection identity (2026-10-30)

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

## Theme and clarity (owner, 2026-10-30)

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


## Settings by purpose (2026-11-05)

This owner decision supersedes the former Settings > Raphael pane and its earlier
scene names. General owns the owner profile and weather city.
Dictation & shortcuts groups dictation, paste, cancel and Ask Raphael shortcuts.
Tools owns shared search, page reading, images, PDFs and their keys (no voice service since 2026-11-10);
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
mcp-proposal.test.ts, nav-history.test.ts and the shared look audit test. Per the integrator's 2026-11-05 handoff instruction,
tsc and these targeted tests run without the waiter. The selected look matrix
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


## Shared owner vault (2026-11-05)

R-VAULT-01..05: Settings > Safety contains Vault. Entries have login, contact or
card kinds, counted list filters, a label, one-line owner hint and all/chosen-member
access. The counted filters browse records; they are not setting-value controls.
Use the shared fieldHTML, sel/openMenu, row action menu and confirm menu.

```powershell
npm run look -- vault-list vault-filter vault-entry-menu vault-new-login vault-new-contact vault-new-card vault-sharing vault-import-preview vault-card-permission calm-thread --theme both --width 1120,720,1920x1080
```

Selected scenes: vault-list, vault-filter, vault-entry-menu, vault-new-login, vault-new-contact,
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


## Attachment root and Office expansion security (2026-11-05)

R-SEC-FILES-01/03: core/tests/services/test_reader_security.py verifies attachment read,
save and chunk-upload admission against a redirected storage root and limits repeated
XLSX shared-string output before allocation/join. Keep the existing upload, text/Office,
PDF/media, vault and memory suites in the affected core scope. Existing size limits,
opaque IDs, owner CSV preview and private-fill consent semantics are retained. No UI
change means no local look/judge run; OS vault and native file opening are unverified.

## Owner-only persistence and bounded native logs (2026-11-05 follow-up 1)

R-SEC-DATA-01 and R-SEC-LOG-02: tests/test_storage_security.py uses temporary folders
for owner-only DACL verification, fail-closed ACL errors and five-version migration
backup retention. Include tests/test_paths.py, memory/test_files.py and app startup
consumers. Never infer a real owner data migration from these isolated tests.
Rust core_stderr tests cover credential forms, overlong lines, UTF-8/EOF and benign
diagnostics; run cargo test --locked offline with a worktree-local target directory.
This changes no Settings markup or navigation and adds no look scope.

## Settings and Connect Apps, small fixes (2026-11-14, R-UI-150 to R-UI-153)

關於我 has no drag handle, is four lines at rest with the rest folded, and grows while written; the about tab's mark and name select nothing;
Safety has no 電腦操作 section; a connected app's 「✓ 已連結」 is inside the row's one button in Connect Apps.

```powershell
npm run look -- settings-owner settings-owner-about-typing settings-owner-about-rest settings-about-brand local-command-settings-gone connect-apps connect-apps-connected-hover connect-apps-row-hover connect-apps-connected-rows --theme both --width 1120,720,1920x1080
```
