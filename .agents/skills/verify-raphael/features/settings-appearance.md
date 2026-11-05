# Settings and appearance

## Signed updates and owner memory import (2026-11-05)

General > About you > Import memory shows a copyable handover prompt, an answer field
and Add to memory. The explicit action calls memory.import; accepted facts enter shared
USER.md via the existing writer, while refused entries show an index and safe reason.
Secret text is cleared after success and never echoed in refusals.

About checks https://github.com/Jheng-Kai/Raphael/releases/latest/download/latest.json on opening.
The release-assets test rejects the former owner in updater configurations and publication.
A newer version shows escaped notes
and Download and restart. Auto update is off by default; opt-in downloads in the background,
then installs only after ten minutes of native idle and a complete idle roster. The signed
artifact must include the manifest's version. One startup receipt reports the installed
version when the main page is visible; hidden startup retains the receipt. Unknown state,
missing core, active or waiting members prevent installation.

Selected look: update-found, update-ready, update-auto, import-memory,
import-memory-result, profile, chat, attachment-limits and attachment-too-large;
zh-TW, both themes, 1120,720,1920x1080. Compare About's update actions and switch with
General's existing controls, and import fields/buttons with the owner profile and settings.
Judge must use this same run and external references. Fake fixtures do not prove real
GitHub releases, OS idle time, native asset ranges, upgrade restart or one-shot persistence.

Targeted checks: updates, attachment-stream, memory-import, settings-view, agent-attach,
chat-composer, attachment-media, architecture and catalog Vitest; memory service/import
and attachment upload/readers pytest; release-asset tests with a temporary generated key.
Offline Rust: cargo fmt --all -- --check; cargo test --offline --locked;
cargo clippy --offline --locked --all-targets -- -D warnings; vendored listener unchanged.
Use the official updater 2.14.1 recorded in Cargo.lock; populate the private Cargo cache
from an authorized fetch before running offline. The fake-feed test covers a valid artifact,
tampered bytes, an empty signature, an inflated version with an old signature and an older
release, using a temporary generated key and never executing the payload. MSVC embeds the
shared common-controls v6 manifest in both the app and library unit-test executables.
No private key belongs in source.

## Owner output folder in General (2026-11-05)

R-OUTPUT-01 adds the optional absolute delivery folder to Settings > General,
using its existing row, text field and settings search. Changing the preference
never moves existing files. The shared owner context tells every speaker to use
it by default within existing permissions; VM and owner-PC paths remain distinct.
See [Daily work](daily-work.md) for prompt and native delivery limits.
Follow-up 1 authorizes the selected look run; actual native/live delivery is deferred.

```powershell
npm run look -- owner-output-folder --theme both --width 1120,720,1920x1080
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
npm run look -- profile appearance appearance-menu appearance-keyboard models dictation agent messaging data about theme-clarity --theme both --width 1120,720
npm run look -- home sidebar sidebar-search sidebar-group-avatar-pair sidebar-group-avatar-four chat appearance appearance-menu appearance-keyboard desktop-takeover-owner home-calendar dictation-dictionary theme-clarity --theme both --width 1120,720,1920x1080
npm run look -- appearance --theme both --width 1120,720,1920x1080 --locale ja
npm run look -- chatgpt-signed-out chatgpt-signed-in chooser-chatgpt-signed-out chooser-chatgpt-signed-in cli-account-menu cli-account-disconnected cli-account-reconnected window-hover-minimize window-hover-maximize window-hover-restore window-hover-close window-hover-modal --theme both --width 1120,720,1920x1080
npm run look -- model-choices-answer model-choices-cleanup model-choices-stt model-choices-local model-choices-local-selected --theme both --width 1120,720,1920x1080
```

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
menu (R-UI-11). Memory rows use the same policy and retain Undo.

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
