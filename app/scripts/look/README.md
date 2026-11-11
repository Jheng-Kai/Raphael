# Look and verify

## Native journeys

`native` extends this workflow with the real debug shell, Python core and SQLite.
It reuses `driver.mjs`, `options.mjs`, `report.mjs` and `contact-sheet.mjs`; it never
installs the mock IPC or substitutes page modules. Every owner report and every
native change must have a native journey that fails before the fix and passes after.
An expected regression still exits 1; keep the failure and its exact evidence.

Build once after changing Rust or frontend code, offline, with two Cargo jobs:

```powershell
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) '.native/cargo-target'
$env:CARGO_BUILD_JOBS = '2'
$env:CARGO_NET_OFFLINE = 'true'
npm run tauri -- build --debug --no-bundle
npm run native -- --list
npm run native -- locale-sweep voice-conversation delete-conversation
```

Keep that target directory inside this worktree. Never use the owner's
main-checkout `app/src-tauri/target`.
Run this Tauri build **after** `verify -- --rust` when using the same target: Cargo
integration tests can rebuild `app.exe` against the development URL instead of the
bundled entry. A `localhost:1420` target without a dev server is a build prerequisite
failure, not a native regression result.
`RAPHAEL_CORE_PYTHON` can select an existing Python 3.12 interpreter; the runner sets
`PYTHONPATH` to **this checkout's** `core/src`. No install or network fallback occurs.
When dependencies are shared read-only via a `node_modules` junction, Vite needs
`--configLoader runner`: put `{"build":{"beforeBuildCommand":"npm run build -- --configLoader runner"}}`
in `.native/build.json` and pass `--config .native/build.json` to the build command.

`npm run native -- typing` seeds 150 rich turns and eight offline fake members,
checks the shared 25/20/100-turn window (including a prepend across a core page),
then types 200 keys at 120ms intervals while seven members work and authored
multi-message replies use normal reply pacing. This exercises offline pacing,
not live provider token streaming. The report retains Event Timing, frames over
50ms, per-key second-rAF timings and CPU self time; raw entries and the 1ms sampled `typing.cpuprofile` live
under `typing/`. Events omitted below the 16ms reporting floor remain censored,
never zero. A second-rAF median >=16ms, worst >=50ms or a frame >100ms fails the journey.
For an old binary only, `RAPHAEL_NATIVE_TYPING_BASELINE=1` pages through the full
history before typing and records the old mount count without the 25/45/65 setup
guards. Remove that flag for the changed binary. Use the same runner for both;
neither mode touches an installed session or uses paid providers.

`npm run native -- bot-homes` seeds three synthetic copied memories and an imported skill,
checks their migration hashes, then answers as a member on `cli:codex` through an offline
Python child at the CLI protocol boundary. The child verifies that its prompt contains
that member's own memory and skill. It uses isolated fake CLI authentication and never
reads the owner's CLI profile or sends provider requests.

Every journey has fresh `run-*/<journey>/data`, including its own WebView2, device
settings, logs and real `raphael.db`. `RAPHAEL_TEST_NATIVE=1` works only in debug
builds and skips single-instance, global hotkeys/hooks, tray, overlay and autostart
effects. The normal hotkey worker, composer and native dictation controller still run;
only registration with the global keyboard is replaced by a window-only backend. The owner's
process is never selected or stopped. All runs use `RAPHAEL_FAKE_LLM=1`; the existing
EchoClient answers normal agent turns. In native mode only, `[native-consult:Name]`
scripts its choice of the real `ask_member` tool. The normal tool gate, shared
AgentService, room scheduler and SQLite stores create the exchanges/reports.

`npm run native -- startup-rooms` expands to ten normal and ten slow-core launches,
each with fresh SQLite data containing three named rooms. It uses `first_run::start`
and the owner's hidden-then-shown window path; it never reloads the main page or
sets its viewport. The slow variant delays core import by three seconds and rejects
the first `rooms.list` once, through debug-native-only switches. This separates a
repeatable first-read failure from the unproven pre-first-show suspension theory.
An initialization script installed before the real entry records visibility,
CoreReady delivery, early runtime errors/toasts and room rows, including before CDP
attaches. Native logs record first successful show, hello, suspension requests and
actual completions. Each launch must show all persisted room rows within five
seconds of both first show and core readiness, with no runtime errors.
`report.json` retains per-launch `startup.probe`, `startup.evidence`,
`startup.roomsAfterReadyMs` and `startupCounts` for normal/slow pass/fail totals.
Keep the failing pre-fix control and fixed runs; neither missing instrumentation
nor zero launches establishes the required before/after native acceptance.

`npm run native -- hidden-window` opts only that isolated debug instance into the
real CloseRequested hide path (`RAPHAEL_TEST_NATIVE_WINDOW_LIFECYCLE=1`). It also
minimizes/restores once. The existing Python helper sends Win32 system commands to
the runner's owned PID. Both cycles wake through CDP on the never-suspended learned
page, invoking `main_window_forward` and the tray's actual `show_main_window`
routine (Resume before show/unminimize) without a tray icon or Win32 ShowWindow.
Only this isolated debug lifecycle mode permits learned to call that command;
ordinary instances retain the main-only caller check. The main page is never
evaluated while hidden, including at wake time. CDP has a five-second protocol
timeout and the passive-page wake command has its own three-second bound.
An unconditional 100 ms page interval must remain flat for at least six seconds
after a 1.5-second suspend grace, then tick again within three seconds of showing.
No CDP evaluation or screenshot occurs during that hidden observation. A typed
RPC submitted just before hiding finishes in the core after the fake brain's
four-second delay; SQLite must contain its completed zero-cost reply while the
window is still hidden, and its real reply row must be visible on return. Both
cycles retain timer timestamps, native window states, page visibility console logs
and before/returned screenshots in the ordinary native report. The runner closes
this lifecycle instance by its owned PID, because CloseRequested now only hides it.
The integrator must run both the suspension build and a control build without
main-window suspension; throttled hidden timer ticks must make the latter exit 1.

The voice journey synthesizes its own short 16 kHz mono WAV offline with Windows
`System.Speech` into its run; it never reads a sample from the owner's data. It uses
the real local Qwen3 ASR and VAD models, read-only. `RAPHAEL_NATIVE_WAV` supplies an
explicit sample override and `RAPHAEL_MODELS_DIR` selects the installed model root.
After retaining the sample, a preflight checks the core registry's required files
before launching the app. Missing models report `BLOCKED` with their exact folder
and missing files; the journey and overall run fail with exit 1. Missing audio and
synthesis errors also fail, with no sample, engine, download or cloud fallback.
Non-speech journeys copy only the installed VAD into their model directory.
The native model manager refuses all downloads. Only initialization
writes fixture prerequisites to SQLite; assertions reopen that run's DB with `mode=ro`.
Conversation deletion reports all tables with `conversation_id`, including turns,
summaries, CLI sessions and cards. Quick history is cleared through its real sidebar
menu and confirmation; its permanent conversation must remain with no dependent
records or timeline rows.
`delete-conversation` also creates two members and a room through the UI. One member
consults Raphael and the other member; explicit room mentions generate real reports
for both recipients. It deletes their private conversations and the source member,
then inspects replacement defaults and explicitly created named conversations.
Every old row, date separator or exchange summary in a new private timeline fails,
even if it has no turn id or its deleted member name is empty. `deletionAudit` retains
before/after SQLite snapshots, exchange and room audit rows (with their actual
delivery conversation IDs), DOM markup, actual
`agent.history.list` replies and the exact production `_thread` SQL/parameters
re-executed read-only; SQL and IPC ids must match. Room rows are checked as isolation
controls: their turns and messages must survive deletion and remain readable through
`rooms.messages`. Private/exchange rows with missing members or delivery conversations
fail as orphans. Current UI cannot create legacy `scope=quarantine` rows; none are fabricated.

Console errors, page exceptions, unhandled rejections and unexpected/error toasts
fail the journey. Explicit creation/deletion/history-clearing success toasts are the only toast exemption.
Locale sweeps inspect visible text/labels against scripts and exact other-language
catalog phrases, retaining offending elements. The brand `Raphael` is accepted;
actual OS microphone names (including their shortened device prefix) from `audio.devices` are exempt only inside the microphone
selector, while surrounding application labels remain checked. Japanese Kanji shared with Chinese
cannot be distinguished by Unicode script alone; exact catalog checks cover static
copy while dynamic/backend text still needs review. Every non-loopback URL in the
run log fails the cost guard, except declared Composio hosts in explicitly selected
`gmail-connect`, `store-finder` and `catalog-connect` journeys. Provider clients are fake;
connectors also use offline transport except these opt-in journeys.

For real store performance and catalog authorization, run from the owner's normal
PowerShell (the restricted agent shell cannot read Windows Credential Manager):

```powershell
Set-Location app  # from the repository root
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) '.native/cargo-target'
$env:CARGO_BUILD_JOBS = '2'
$env:RAPHAEL_CORE_PYTHON = Join-Path (Get-Location) '../core/.venv/Scripts/python.exe'
$env:RAPHAEL_NATIVE_APP = 'slack'
npm.cmd run native -- store-finder catalog-connect
```

Both journeys read only the existing Composio credential. No key is supplied in the
environment or written to reports. `store-finder` requires at least 100 real catalog
entries, records the public catalog, click-to-paint duration, long tasks, DOM nodes and
card count, then rejects paint over 250 ms or any long task over 50 ms. It supports
the old category dropdown for a before-fix measurement and the new All chip afterward.
`catalog-connect` scripts only the fake brain's `find_app` then `connect_app` choice;
the UI, core tools, policy, cards, database and Composio sign-in are real. It checks
both Raphael and a new member, requires exactly those two successful tool steps,
and waits for a real Composio pending link before accepting authorizing without
resumption. Both card logins are cancelled before checking Settings' Store join
flow. The runner never drives an external consent page; inspect that page separately.
Use `RAPHAEL_NATIVE_APP=slack` and `gmail` for the connect-and-Docker acceptance.
Gmail uses Composio when the isolated run has no private Google configuration.
The runner sets `RAPHAEL_TEST_NATIVE_CATALOG=1` only for these two explicit journeys.
They do not use a CLI model or OpenRouter. Missing Credential Manager access is a
prerequisite failure, never evidence that the owner's key is missing.

Only `member-computer` enables the real computer adapter in native fake-brain
journeys. Its shared lifecycle can start installed Docker Desktop and build the
pinned image, so run it only with explicit Docker authorization and no other heavy
process. Stop Docker afterward if the journey started it.

`npm run native -- model-picker` requires `RAPHAEL_NATIVE_MODEL_CATALOG` to name a
saved public OpenRouter `/api/v1/models` JSON response. It seeds only the isolated
catalog cache, selects two listed reasoning models and one non-reasoning model
through the real shared chooser, then checks persisted answer/quick/member settings,
reopened selections, prices and the next turn's model/effort. The fake provider
records only public model/effort metadata in that run's `data/model-requests.jsonl`.
This journey makes no provider request and never enables Docker. A public catalog
read and mocked HTTP-body tests remain separate from paid provider acceptance.

Native captures wait for finite entrance animations before taking screenshots;
click-to-paint measurements are retained from the original event interval. Infinite
activity indicators do not block capture. `plugins-store-motion` covers the real
staggered rows reaching full opacity; other store scenes keep reduced motion.
Store groups wrap without horizontal scrolling. Every settings pane uses the same
content measure for its heading, toolbar and body. Catalog artwork declared in
fixture.json.imageResponses is served from recorded public assets offline; all
undeclared external requests remain failures.

```powershell
# Owner-only: do not include this in routine regression runs.
Set-Location app  # from the repository root
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) '.native/cargo-target'
$env:CARGO_BUILD_JOBS = '2'
$env:RAPHAEL_CORE_PYTHON = Join-Path (Get-Location) '../core/.venv/Scripts/python.exe'
npm.cmd run native -- gmail-connect --keep
```

Gmail uses the signed-in Codex CLI brain with fake API clients. With both native
flags set, only the Composio credential is read by the app from Windows Credential
Manager; every credential write stays in memory. The harness never reads or logs
the key. The journey asks for the real `connect_app` card, presses Connect and records
the card's state/error and nearby core log lines. It never drives or approves Google
consent. No API brain or paid speech service is permitted. CLI-internal billing and
transport are not observable through the app log.
The Gmail model comes from the owner's configured public Codex model id (or
`RAPHAEL_NATIVE_CODEX_MODEL`), validated against its local model cache when present.
No model family alias is guessed. Native CLI workspaces/state stay inside the run's
`data/cli`, separate from the owner's CLI workspace; only the existing login is borrowed.
Unpackaged native tests record redacted CLI error events and a bounded stderr tail
in `native.log`/`app.log` and `report.json`'s `cliDiagnosticLog`. This requires
`RAPHAEL_TEST_NATIVE=1`, fake API clients and a test data directory; packaged cores
never enable it. Known login/MCP tokens, sensitive fields, token patterns and URLs
are removed before logging. Normal CLI runs continue to discard stderr.
CLI failure before a card now fails immediately; after Connect, the journey stops
at authorizing or a terminal state without following any consent browser.
The existing packaged debug binary in that target is required. The runner sets
`RAPHAEL_TEST_NATIVE=1`, `RAPHAEL_TEST_NATIVE_GMAIL=1`, `RAPHAEL_FAKE_LLM=1`,
`PYTHONPATH` to this checkout and a fresh `RAPHAEL_DATA_DIR` itself. Do not point it
at the owner's data. It uses the installed `%APPDATA%/Raphael/models/silero-vad`
(or `RAPHAEL_MODELS_DIR`), a signed-in Codex CLI and the app's existing Composio key;
no OpenRouter key is required. Missing prerequisites fail without downloading.

Reports, per-step screenshots, contact sheets, SQLite data and app logs stay under
`.native/run-*`. `--keep` additionally keeps the contact-renderer's temporary profile;
it never leaves a native process running. Cleanup always closes only the spawned
PID and its child tree in `finally`, including the Python core and WebView2. A debug-only
kill-on-close Windows Job contains the complete tree, including when Windows denies
`taskkill` and cleanup must use the owned spawn handle. `native.log` copies the shell's
persisted log; `app.log` combines it with stdout/stderr for the cost guard. Run one
build/app at a time. Unit checks are included in `npm run verify` (two Vitest workers).
These regression captures do not establish the full look/theme matrix or judge design
acceptance; no paid judge/live matrix is part of this offline command.

From `app/`:

```sh
npm run look -- --list
npm run look -- chat details --theme both --width 1120,720
npm run look -- --all --theme both --width 1120,720,1920x1080
npm run look -- composer-learn member-composer-learn room-composer-learn --theme both --width 1120,720,1920x1080
npm run look -- appearance --locale ja --out .look/review
npm run verify
npm run verify -- --quick
npm run verify -- --contract --rust
npm run judge -- .look/run-EXAMPLE --references <external-reference.png>
npm run verify -- --live
```

On memory-constrained Windows machines shared by worktrees, set
`RAPHAEL_VERIFY_WAIT_FOR_IDLE=1` to query `Get-CimInstance Win32_Process` before
each verification boundary and wait for active cargo, rustc, pytest, Vitest,
look or native runs. This never stops another process.

For local changes, select scenes from the affected feature map and run those at both
themes and 1120/720/1920x1080. A shared confirmation dialog, for example, uses
`npm run look -- delete automation-delete team-delete room-delete --theme both --width 1120,720,1920x1080`.
Shared components need representative affected consumers, not every unrelated page.
Reserve `--all` for integration/release acceptance, CI, explicit requests or genuinely
app-wide changes. Add `verify -- --contract` or `verify -- --rust` only when those
boundaries change; documentation-only work needs diff/link review. Judge reviews the
same selected look run. State the selection and any incomplete evidence in the handoff.

A click or type step may carry `measure: { name: "interaction-paint", budgetMs: 250 }`.
The shared driver records the event through the next painted frame (two animation
frames), excluding automation transport time, and emits the duration as an assertion
in `report.json`. The Store's configured scenes use 360 extra synthetic apps from
`pluginCatalogLoad` with the `pluginsMany` variant, then measure opening and searching
the complete grouped list. This is offline browser timing, not provider/native timing.

Set `LOOK_TRACE=1` to save a Chrome performance trace for each measured interaction
beside the report (including failed budget assertions). `look-paint-start` and
`look-paint-end` delimit the measured interval; trace filenames are listed per result.
Tracing is optional diagnostic overhead and does not change the 250 ms budget.

`LOOK_PROFILE=1` saves a CDP `.cpuprofile` for each measured scene, starting before
navigation and ending after its steps. `profileNavigationStart` in the result maps
PerformanceObserver's page-relative times to the profile's monotonic clock (seconds).
Measured scenes also retain every navigation-to-capture long task in `longTasks`,
including startup and neighbouring actions; interaction assertions retain their own
unchanged budget interval. Failed measurements keep their assertion data as well.
Profiling adds diagnostic overhead; confirm acceptance with it disabled too.

`LOOK_CPU_SLOWDOWN=3` applies CDP CPU throttling to each page for a labelled
headroom stress run without starting a competing workload. The report records the
rate (default 1). It leaves the interaction observer, timing interval and budgets
unchanged. Stress results are separate from ordinary machine timing; use the same
rate before and after a performance change, and retain unthrottled acceptance too.

Look needs an installed Edge/Chrome and the pinned **puppeteer-core** devDependency (the version `app/package.json` names).
It never downloads a browser or installs packages. Preserve the package/lockfile pin.
`LOOK_BROWSER` optionally selects an executable. Node 22 or later is required.

Before opening the browser, look transforms each selected HTML entry and waits for
Vite's static import crawl. Navigation waits for DOM content, then the scene's real
readiness selector; unrelated network activity does not gate that readiness.
Request failures still fail the scene. Only `net::ERR_ABORTED` requests from a
document superseded by a committed main-frame navigation are retained separately
as `navigationAborts`; current-document aborts, other network failures and HTTP
errors remain failures. Closing the captured page is outside the capture window.

`--width` accepts widths (900px height) and explicit `WIDTHxHEIGHT` viewports.
Each run creates `.look/run-*/` with viewport PNGs, paginated PNG contact sheets,
`contacts.json` and `report.json`. `--out` changes the parent directory. A nonzero exit
means a scene, runtime, layout, raw translation key, raw Markdown text, mixed-language copy, non-finite work duration, or visible native select/time-input
or checked product-rule violation failed; missing dependencies produce a `blocked`
report and a nonzero exit. Product rules include duplicate tooltips, visible row
destruction, action frames/order and known untranslated interface copy. These
checks do not replace design review.
Inspect contact sheets and full-size PNGs as well as the automated checks.
The shared audit rejects visible text nodes containing Markdown heading markers,
unchecked task markers, paired bold markers or triple backticks, including outside
chat messages. Hidden pages, content outside scrollports and the text inside an editor
field (a textarea holds a document its owner edits, such as a private skill) are excluded.

The real `index.html`, `main.ts` and CSS run through Vite. Overlay scenes select
the production `overlay.html` entry. Only the Tauri IPC boundary is
replaced by `mock-ipc.js`. Unsupported calls are failures, including rejections caught by
the app. External browser requests are blocked and reported. Every scene gets a fresh
copy of `fixture.json`: public synthetic Traditional Chinese content, local/embedded avatars,
conversations, work/replies/attachments, team/rooms, schedules/runs, usage/CLI allowances,
MCP servers, providers/models and dictation data. Browser dates are fixed to the fixture's
`now`, in Asia/Taipei. Change data in that file, not in a second mock.

The normal entry opens Home and waits for Raphael's status strip. Existing non-home
journeys then click the real Raphael rail destination before driving their steps.
Home scenes cover rich/empty data, reports, routines and calendar navigation.

Add a `scene(name, description, steps, fixtureOverrides)` to a module in `scenes/` and
export it from `scenes/index.mjs`. Steps include click, type, hover, key (`shift: true` holds Shift), ime (a composition and what commits it, through the browser's own input-method path, with the events it made recorded in `window.__imeLog`), right-click, pointer-drag, wait, scroll,
member/room selection and drag/drop. Use real UI selectors and wait for the resulting
state; do not replace app modules or inject a separate preview page. Fixture overrides
can replace collections; `running`, `problem`, `onlyRaphael`, `usageEmpty`
and `onboarding` select boundary variants; `permissionCard`, `memberDraftFirst`, `mailDraft` and `mailOffer` seed the permission and email cards of a chat (the Conversation feature map, P08c). `overlayEvents` replays the native overlay
channel contract; `advance-time` advances the shared fixed clock for production timers. Scenes run with reduced motion,
so nothing moves in a still frame; a scene about something that moves sets `motion: true` and holds every animation at
one time with `freeze-motion` (`at` in ms), the same frame each run. A scene starts once the home (or the overlay's
caption) is up; one that waits for something else names it in `ready` (`overlay-long-answer` waits for its subtitle).
All scenarios appear in `--list`.

Use `check(name)` for browser assertions that need rendered geometry. The shared
`checks.mjs` guards title/panel state, conversation-list overflow, the single composer
action slot, percentage captions, complete calendar-chip times and 20px faces,
conversation design and horizontal dictation navigation. Successful measurements are saved in each
result's `assertions`. Every settings journey checks the dialog radius and close-control
hit target, then waits for the requested navigation entry to become current. Keep prerequisite
data in the shared fixture: usage expansion needs more than five historical member
groups, and a dictation heatmap day must have a nonzero count before it can be opened.

Coverage merges auto's automation/team/room matrix, nav's settings/MCP/usage matrix,
polish's composers/skins, layout's dictation/notices/onboarding and narrate's chat states.
Conversation management opens through the title-controlled details panel. Usage
retains aggregate summaries, grouping, allowances and CSV; per-run navigation is removed. The deliberately removed owner menu/photo controls have no
scenes. There are 469 current scenes (2814 combinations across light/dark and 1120, 720, 1920x1080). The member-column scenes cover the primary top slot, its exchange with Raphael, collapse, face tooltips and re-expansion; primary scenes also cover member/conversation/room/routine pickers, calendar tools and mentions without stars; dictation tabs use horizontal keyboard navigation. Team mentions and slash commands align to their text character and prefer the space above it, without an empty icon/check column. Calendar checks prohibit horizontal scrolling, keep every displayed day visible at readable widths and exercise responsive month/member/keep-awake controls. Team headers share the page padding and align Add with the title. Geometry checks cover all three sizes. The default Team scene also enforces R-UI-01: group panels size to their own members while chief/group containers share a capped column; no area minimum or sibling-height stretching. Opening starts at 100%; overflowing groups remain pannable, and reopening preserves the chosen session zoom. Fit is explicit. The chief uses the same compact card track and inset as group members. Group members wrap across the available panel width into at most three columns, while a one-member panel retains empty card tracks. Drop previews grow and shrink column capacity and rerun collision resolution. The seven canvas scenes use the one-person 學習/eight-person 未分組 CLI roster in `fixture.json.teamBoard`. Checks reject stretched panels and raw CLI refs, and require the whole chief on opening and after fit (at the 50% floor a tall roster may continue below the canvas). The opening and primary-board screenshots do not press Fit; `team-zoom` reopens the page and checks session zoom retention. Raphael roles use `memberRole` and the existing three-language `rooms.chief` key across member views. Model-choice scenes cover cloud/local row spacing, themed borders, readable metadata, scroll access and keyboard selection without downloading.
Team administration scenes cover full, long and eight-member batch approvals, held deletion approval,
live member selection after approval, and an unchanged roster after rejection.
The right-click scenes (`scenes/context-menu.mjs`, R-UI-44) press the real right button with the `right-click` step, which keeps its point in `window.__look.pointer`, and their `context-menu` check asserts that the menu is open, starts at the pointer, does not cover it and has the items of the menu a click on the ⋯ opens; `context-menu-key` presses Shift+F10 on a focused row. Every scene's audit also asks `context-menu.ts` for the ⋯ buttons that no row of its table reaches (`R-UI-44`).
The primary-contact scenes (`primary-contact-menu`, `primary-contact-picker`, `primary-contact-set`, `primary-contact-strip`, `primary-room-chief`) choose the owner's primary contact through the real member menu and
picker; the IPC double keeps `primaryId` (the fixture key `primaryMember` seeds it) and answers `members.set_primary` and the list's `team_context.primary_id` as the core does.
The apps and skills scenes (`scenes/apps.mjs`) enter through the sidebar's connected-apps entry.
The IPC double derives the inventory and the roster's count from the fixture's connections as the
core does, and the `apps-count` check compares the sidebar badge, the tab's number, the rows under it
and the roster; the fixture key `inventoryUnreadable` makes it a core that cannot list the apps
(`apps-unreadable`), and `wait-gone` waits for a row to leave after an uninstall.
Answer scenes select expandable replies, avoiding collapsed work's hidden messages;
the driver chooses the first visible match. Favicon requests return an empty 204.

Subscription account scenes drive the shared row menu through disconnect and reconnect. The
`window-control` driver step checks caption hover/pressed tokens, rounded geometry, glyph
centering, inner margins, labels, keyboard focus and close contrast without closing the page.
Its `hoverOnly` option preserves an open settings modal for the resulting screenshot.

Verify always runs TypeScript and Vitest; its default also runs contrast. `--quick`
excludes contrast; `--contract` adds the core's scenario drivers and the default prompt's size budget; `--core` adds
the whole offline pytest suite with warnings as errors (CI runs it on every push); `--rust` adds what CI's Windows shell
job checks: `cargo fmt --check`, offline locked cargo tests for the app and the vendored
listener, and Clippy with warnings denied. Optional checks use the existing environment/cache and fail if unavailable.
Use `--out dir` to select a writable evidence directory for look or verify.
Logs, exit codes and a JSON summary live in `.look/verify-*/` by default; independent checks
continue after a failure. These tools do not build, install, launch or deploy the native app.

Guardian's required UI sequence is look, inspection, then judge. Judge requires
all three sizes and both themes for every selected scene and a passed look report.
Its rules, feature context, external reference paths, budgets and cache are
documented in the verify-raphael skill. The verify alias is
`npm run verify -- --judge <look run>`; set `RAPHAEL_JUDGE_REFERENCES` to a JSON array
of external image paths. Judge defaults to the signed-in Claude Code subscription;
`npm run judge -- <look run> --brain codex --references <external image>` selects
Codex. Both use read-only isolated CLI turns, strip API credentials/endpoints,
review three candidates per request and preserve per-image scores/cache/refusal.
`--max-requests` bounds submitted batches; reports record CLI version, model and
redacted diagnostics. No OpenRouter client is constructed on these paths. Testing
must never use OpenRouter. The retained API provider requires an explicit owner
request and `--brain openrouter`; its dollar admission limits still apply.
Ordinary verify/look and fake-model tests remain offline. Missing subscription
login or external references is blocked/SKIP, never design acceptance.

The nine `composer-stop-*` scenes cover roster repaints, typed requests before the first turn, native voice processing, quick/member navigation and a live background task. Result scenes press the same slot and assert the exact cancellation boundary, no voice key, and the returned idle emblem. `composer-task-stop` also rejects an emblem mislabeled as Stop.

### Designed main viewport

With no --width argument, look reads the main window's dimensions from
src-tauri/tauri.conf.json (1280x800). Explicit plain widths retain the 900px
height, and WIDTHxHEIGHT remains available. The default leaves taskbar space
on a 1536x864 logical desktop at 125% scaling. Native window-state restores
remembered bounds; manual first/second launches show and focus the window,
while --autostart leaves it in the tray.

Home's four equal blocks and adaptive calendar, two-by-two dictation totals,
896px conversation measure, shared settings edges, fixed conversation sidebar and
centered welcome are asserted by their ordinary feature scenes. no-naming
replaces the removed first-Bot setup scenes. Details' pointer focus assertion
runs before its separate keyboard icon-interaction check.

## Readable conversation layout

Run all main-page scenes in both themes at 1120, 720, 1920x1080 and 1280x800.
`sidebar-shell` checks the fixed conversation list and compact drawer, including
open and folded folders. `details-alignment` compares New conversation, the search
input and routines/memory block. `conversation-header` rejects duplicate compact
identity and clipped header line boxes. The former Team canvas and Fit/zoom
interactions are replaced by the conversation sidebar.

`npm run native -- readable-layout` applies the same assertions to an isolated
WebView/SQLite run. Roster prerequisites use production RPC; folder folding,
drawer navigation, Home month changes and details controls use the real UI. Captures
record their actual viewport dimensions.

## Conversation layout checks

The feature map names the affected scene matrix and shared checks. Native readable-layout now also checks separate model/source lines, aligned card actions, a single quick-question row label, the conversation fade and Home/sidebar geometry. Keep the pre-fix binary identity separate from exact source build evidence. Run design judge locally from a signed-in shell.

The theme-clarity scene records computed surface/filter evidence. Computer desktop-* scenes use the existing member side panel and persistent stream; no desktop dialog or inline screen is mounted. Native member-computer uses the same screen-click and explicit nonce handback.
### Stable view controls (R-UI-49)

`stableClick(selector, then)` records the clicked control and persistent preceding
layout, performs real clicks and dependent actions, settles motion and rejects any
position or size change over 1px. Missing controls or anchors fail. Normal click
steps on tabs, switches, pressed filters, Settings panes and view controls also
record this assertion, including alongside existing paint measurements. Sidebar
and Home are excluded while their parallel redesign is owned elsewhere. Evidence
is stored in the existing action assertions; there is no separate browser harness.
The learned notification uses the real `learned.html` entry with only IPC mocked.

## Native round 10 regression journey

```powershell
npm.cmd run native -- owner-round10 voice-conversation locale-sweep delete-conversation
```

`owner-round10` uses the bundled debug shell, real Rust correction Tracker, core
acceptance and SQLite evidence. It checks owner expansion, conversation scrolling,
two Escape presses for a pending fake answer, a complete learned batch, five-second
hover retention, exact batch/evidence Undo and expiry. Read-only Win32 inspection
checks the learned window's NOACTIVATE style, rounded click region, click-through
expiry, active-monitor placement and foreground continuity. The passive learned
window starts independently of the ordinary overlay, including native isolation.
`voice-conversation` additionally verifies one Escape cancels a new native recording.
Its speech path still requires installed local Qwen3 ASR and VAD; missing models
are BLOCKED. The pending-answer marker is inert outside isolated fake native runs.
No real provider, owner data, Gmail, Composio or OpenRouter is used.

When multiple worktrees share a Cargo target, copy the completed debug app.exe
into this worktree immediately after its build and set RAPHAEL_NATIVE_BINARY to
that copy. The native runner records the selected executable, so a later build
from another worktree cannot replace the binary under test. CARGO_TARGET_DIR
continues to select the shared build cache.

Follow-up 2 records all 200 capturing-keydown `performance.now()` timestamps and
both subsequent rAF callback times. `keyToSecondFrame` retains median, p95 and
worst without Event Timing's 16ms censoring; do not subtract a refresh interval.
Keep the older Event Timing fields as a cross-check. The typing raw artifact also
logs per-call rich-scroll measurements and every `agent.history.list` /
`rooms.messages` response's UTF-8 byte size, returned IDs and timed JSON parse.
The recorder reads the response body once and parses it once; decoding/waiting,
byte counting and callback/render work are outside `parseMs`. Both binaries use
the identical instrumentation. Long-thread fixtures use synthetic zh-TW prose.
Compare old/changed builds three times each in alternating order, retaining every
run and the median of the three run statistics, plus per-run free memory and busy
process count (`RAPHAEL_NATIVE_LOAD` is recorded in the native report).

CPU profiling defaults to a 1000-microsecond sampling interval. For a separate
observer-overhead sensitivity comparison, set
`RAPHAEL_NATIVE_TYPING_PROFILE_INTERVAL_US=5000` for both binaries. The report
records the interval; retain the default results separately. This changes only
CPU sampling resolution, never the key/rAF/event/frame samples or budgets.

For an attribution-only diagnostic, `RAPHAEL_NATIVE_TYPING_TRACE=1` adds a local
Chromium timeline `typing-trace.json`. Keep this traced run separate from paired
performance comparisons: the additional timeline recording changes overhead.
