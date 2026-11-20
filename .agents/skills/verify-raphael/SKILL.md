---
name: verify-raphael
description: Verify Raphael's real desktop UI entry with the shared look CLI, inspect visual evidence, and check native behavior when a task requires it. Use after UI changes, for feature acceptance, or when reproducing a user-facing regression.
---

# Verify Raphael

Read the relevant [feature map](features/README.md), then follow this workflow.
This follows the project-local verification and feature-map structure of
[pstack](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).
The maintained harness instructions are in [look README](../../../app/scripts/look/README.md).

## Launch

From the repository's `app/` directory:

```powershell
npm run look -- --list
npm run look -- chat --theme both --width 1120,720
```

`look` starts its own Vite server on a random loopback port and installed Edge/Chrome,
loads the real `index.html`, modules and CSS, and closes both after capture. Each
scene has an isolated fixture and each run has its own browser profile. No running
native app, credentials, real database or separate preview server is needed.
Readiness means Raphael's conversation (or onboarding Next button / overlay progress)
is visible: the app opens on it, as it does for the owner.
Every other page is reached through the real app, the account menu at the sidebar's foot,
followed by the scene's own prerequisite and resulting-state waits.

Use the installed dependencies; `puppeteer-core` is pinned to `25.13.0`. Do not
reinstall or download a browser as a workaround for a failed run. `LOOK_BROWSER`
can select an already installed Edge/Chrome executable.

## Health checks

1. Check cwd, branch and `git status --short`.
2. `npm run look -- --list` must list the intended scene. Unknown scenes fail.
3. Run the small launch command above. Read its newly printed `report.json`; check
   browser/version, selected themes/widths, per-scene results and top-level errors.
   A process or HTTP listener alone is not readiness.
4. Retain exact launch errors and the report. GPU/renderer access failures or startup
   timeouts mean no UI evidence was captured. Do not reuse older green images,
   disable checks, or classify this as an application defect.

## User-facing behavior

The project's rule is "Test what changed" in [AGENTS.md](../../../AGENTS.md): check what the change
touches and the regression tests that guard it, and leave the whole suites to CI. Choose the smallest
verification scope that covers the changed behavior and its affected consumers before running commands.
Use the feature map to name those scenes and state the selection briefly. A shared dialog, for example,
needs its conversation, routine, group and room confirmation scenes, not unrelated settings, onboarding
and dictation journeys. Keep all three sizes and both themes for the selected UI scenes.

```powershell
npm run verify -- --changed
npm run look -- <affected scenes> --theme both --width 1120,720,1920x1080
```

`--changed` reads the change from git (everything that differs from where the branch left `origin/main`,
committed or not) and runs `tsc`, the Vitest tests related to the changed frontend files, the repository's
rule tests, the core test folders of the changed core packages, and contrast or Rust formatting only when
CSS or Rust changed. It prints the changed files and each check's targets first; copy them into the pull
request. Add `--contract`, `--rust`, judge, `--live` or `--computer` only when AGENTS.md's table asks for
them. Do not run the whole `npm run verify`, `--core` or `look -- --all` for a local change: CI runs the
whole suites on every pull request.

Use the selected feature matrix for a local UI handoff. Reserve the full matrix for
integration/release acceptance, CI, explicit requests or genuinely app-wide changes
such as global tokens, navigation and shared layout. Sharing a component alone does
not require full-project verification. Documentation-only changes need diff/link review.
All commands are from `app/`. Report unavailable dependencies and exact exits; do not
rerun unchanged, unrelated suites to replace a blocked check.

Scenes use real clicks, input, hover, menus and navigation. Extend
`app/scripts/look/scenes/*.mjs` and the one `fixture.json` when a journey is missing.
Mock only the existing Tauri IPC boundary (`mock-ipc.js`). Unsupported IPC remains
a failure even when caught by the app. Do not mock page modules or inject fake UI.
Keep prerequisite failures visible; fix stale tool selectors, not application code,
when the task is verification only. Removed owner menu/photo controls have no scenes.

The fixture proves UI behavior with synthetic native responses. It cannot prove
microphone capture, STT, global hotkeys, paste, persistence, provider calls, OAuth,
MCP servers or OS dialogs. Follow the feature's native journey when needed and
authorized by the task. The documented native launch command is
`npm run tauri -- dev`; use a dedicated `RAPHAEL_DATA_DIR` inside the worktree for
test data. Never drive a shared installed session or alter the user's credentials.
Record unexercised native steps as unverified.

## Evidence

- Keep the new `.look/run-*/report.json`, every PNG, `contacts.json` and every
  `contact-*.png`; default output is `app/.look/`. Verify logs and summaries live
  in `.look/verify-*/`. Never treat zero results as a pass.
- Inspect **every** contact sheet yourself. Open full-size PNGs for small controls,
  overlays, long text, clipped content and all reported failures. Review light/dark
  and 1120/720; passing automated checks do not imply visual acceptance.
- Preserve action-to-result evidence: scene names, commands, resulting state and
  boundary calls/side effects where relevant. Add deterministic assertions to the
  shared workflow when a journey needs more than a screenshot.
- Record date, branch, exact commands/exits, run paths, inspected sheet names,
  findings and incomplete/native checks in your hand-off or pull request description. Separate tool
  faults, environment blockers and app defects. Defects need reproduction,
  expected/observed behavior, affected combinations and image/report pointers.
- A failure seen twice becomes a lint/test rule. Keep regression tests alongside
  the shared runner. DOM tests are not browser/layout evidence.

## Consistency gate

The last check before any hand-off, done by whoever hands over, never delegated to
the implementer's report or passing tests. For every kind of element the change
touches (button, switch, chip, notice, waiting line, dialog, card, menu), find the
same kind elsewhere in the app and put the full-size images side by side at the same
theme and width. They must share component, words, icon, size, position and states.
A difference is a defect unless the feature doc says why. Record the pairs compared
and what differed. A difference found twice becomes a look check in `checks.mjs`.

## Cleanup

The CLI closes only its own browser and Vite server in `finally`. Check the final
report for cleanup errors and confirm PNGs/reports still exist after exit. Never
kill processes by name. If interrupted, identify only the instance/profile/port
started by this run before stopping it. Keep evidence; do not wipe `.look/` during
a handoff. Stop only a native dev process that this task started; leave the user's
installed app and other worktrees untouched.


## Real computer containers (explicit opt-in)

From `app/`, run `npm run verify -- --computer` when `computer/image/`, `vm.py`'s
container shape or the view path changes. It needs an already running Linux Docker
engine and never starts Docker. It never runs implicitly, with `--core`, or in CI.
An image build can download the base image and image dependencies; the host gets no
new dependency. `RAPHAEL_CORE_PYTHON` can select an installed repository interpreter.

It also makes the product's own driver connection (`VmTools._connection`) twice on each
computer, the second as a core started again, and calls a tool through it (R-COMP-DRIVER-01:
a set-up argument the driver refuses fails every screen tool; offline doubles now validate the measured input fixture).
This drives `LocalVm` and the image helper: 1, 3 and 6 outputs, panels, boot readiness,
authenticated clipped RFB views, screen-local launcher input and raw pixels, restart,
helper/view recovery, X-server loss, the core's `DesktopViewer` relay, and available
layer 4 and layer 5 start/update/erase fixtures with preserved workspace files. Since
layer 6 it also reads what the desktop shows (the owner's picture, the drawn town once the
picture is gone, never one flat colour: R-COMP-PICTURE-01), presses ctrl+F2, ctrl+F4 and
ctrl+alt+d with a window open (R-COMP-KEYS-01), and after ending the X server of the
one-screen and of the largest computer starts each again (R-COMP-XLOSS-01). It uses its own
owner, data folder and `raphael-acceptance/cua-local-vm:<run id>` image tag; cleanup
never touches another owner or the real image tag. `--keep` on the Python module
retains its resources and prints them; interruption/failure otherwise cleans them.
Missing/non-Linux Docker exits 2, a failed check exits 1, success exits 0. A released
layer whose image is not on this PC is a named skip (`previous layer 4`, `previous layer 5`).
For the layer before the current one it also makes the six-screen computer every member shares in that layer's
shape and starts it on the new layer (`previous layer 9 shared`): the upgrade an owner's own computer takes.
Every count reads its launchers for the browser's own name and mark, the helper, the menu's entries and
`x-www-browser`, requires that no Firefox ESR is left, and opens XFCE's "Web Browser" to see which window comes
("N screens browser mark").
The shared block reads the running browser's flags and what a page is told of `navigator.webdriver`, presses the
Browser icon's command ("shared browser is a person's"), and sends the owner's own click and typed line through
the app's relay path to a held seat ("shared owner input"). It then puts the owner's text through the viewer's
clipboard into the computer and reads it back ("shared owner paste"), brings the computer's copy to a recorder in place
of the PC's clipboard, once ("shared owner copy"), and places files through the viewer's `put_file` and reads them as
the guest's own user ("shared owner files"): the clipboard is read and written by xclip or xsel when the image has one,
else by the driver.
Every failure includes expected/observed evidence.

Every per-count block compares the live tools/list of all DRIVER_TOOLS with
core/src/raphael_core/computer/driver_schemas.json after driver connection, words and
order included, then asks the driver through VmTools and requires the offered tools to
stay as they were (R-COMP-DRIVER-02). It writes the list to driver-tools.json in the run
folder. A mismatch fails --computer until both kept files are written again from that
list (core/tests/computer/fixtures/generate_driver_tools.py) and SHARED_ARGUMENTS is reviewed.
The default Stage C2 shared block follows the per-count blocks: real members drive
product LocalVm/VmTools/CuaBridge for seat isolation, native timings, one computer-owned
browser with independent bindings, clipped PNGs, owner holds and idle displacement.
It also observes out-of-seat/desktop-frame/target refusals before dispatch, unchanged
real pointer on refusal, seat-2 tree/token and single-JSON prose, pointer coordinates,
seat-local verification, one workspace and peer mapped windows after global shortcuts,
and foreground browser input blocked while page navigation continues during a hold.
Dependent checks that did not run are skipped, success detail claims only observations,
and any inner failure fails the outer shared block. --no-shared explicitly skips it.
The real bridge argv retain the same IsolatedDocker owner guard. Offline doubles
validate the measured fixture with every validation keyword retained (strict top-level unknown-argument rejection), while the table guard covers every nested property. Browser fakes additionally reproduce the measured exact-tab requirement and http/https/about navigation restriction. Offline generator tests compare full-schema and fixture refusals for numeric bounds and element_token patterns; this is not real-driver acceptance. Offline protocol/PNG evidence
does not establish image/native behavior. Final computer acceptance is run by the
maintainer in an authorized Docker environment; it does not prove the native app
panel or a remote SSH host.

## Guardian hand-off gates

Read [RULES.md](../../product/RULES.md) and [ARCHITECTURE.md](../../product/ARCHITECTURE.md).
Their named tests run in the ordinary Vitest/pytest suites on every PR, not local hooks.
From app/, the complete integration offline check is `npm run verify -- --contract --rust` together with CI's result
on the exact commit: CI runs the whole core suite on every push (about a quarter of an hour over eight machines),
so `--core`, the same suite on a developer's machine, is for when CI cannot be used. A core change runs the test
folders it touched (`--changed` names them). A change to the core loop, a prompt, the tool list or
`core/tests/evaluate` also runs `--contract` (the scenario drivers and the default prompt's size budget)
before it is handed back: those are the two places where units that each passed alone broke together.
Local changes use the affected frontend/core/Rust boundaries described above.

CI deals the Python test files among eight machines by the seconds recorded in
`core/tests/shard-durations.json`. When one share runs much longer than the others,
refresh the record as the header of `core/tests/shard_durations.py` describes: merge the
`python-durations-*` artifacts of one green CI run. A pull request that touches `core/packaging`,
`core/pyproject.toml` or `core/uv.lock` also runs the frozen-core smoke test (not a required gate).
A release workflow run asks for a green CI run on its commit instead of repeating the suites.

For local UI hand-off, capture the selected affected scenes at both themes and all
three sizes. The whole matrix (`npm run look -- --all --theme both --width 1120,720,1920x1080`)
runs only when asked or when a change spans the app, never by habit before a release (AGENTS.md).
The 1920 viewport is 1080px high. Inspect every generated contact sheet and relevant
full-size image, then run `npm run judge -- <look run dir> --references <external png/jpg paths...>`
(or `npm run verify -- --judge <look run dir>` with RAPHAEL_JUDGE_REFERENCES as a JSON
array of external paths). Judge reviews the same selected look run; it must not widen
a local change into a full-project review. Judge is required for a new screen or a visual
redesign, after look and before UI hand-off, or must be recorded as blocked/SKIP with the reason
when unavailable; a fix that keeps the design records it as SKIP, not a redesign.
It refuses failed/incomplete look evidence, uses judge rules plus each scene's
feature entry, and fails scores below 4, hard violations, malformed reviews and
budget exhaustion. Reports and summaries live in app/.look/judge-*/; cache identity
includes candidate bytes, model, rules, feature and reference bytes.

Judge defaults to the signed-in Claude Code subscription (`--brain claude`).
Select `--brain codex` for the signed-in Codex subscription. Both use read-only,
isolated CLI turns and remove API keys and endpoint overrides. Claude reads the
attached image paths; Codex receives `-i` images. Three candidates share a request
by default (`--batch-size 1..4`); `--max-requests` bounds submitted batches. Reports
record CLI version, requested/actual model, redacted diagnostics and per-image
scores; cache hits submit no review request. Login and external reference images
are required. Missing prerequisites are blocked/SKIP, never design PASS.

Testing never spends OpenRouter. Do not run its judge without an explicit owner
request. The retained API implementation is accessible only through explicit
`--brain openrouter`, with its existing dollar/request admission checks. The CLI
paths never construct the OpenRouter client. Reference images stay outside git.
Enabled reviews fail closed on missing login or references.

For brain/tool-path hand-off, the maintainer runs `npm run verify -- --live` with
installed/logged-in subscriptions and the OS key. RAPHAEL_LIVE_CONFIG can select a
JSON models list; core/guardian-models.json is the portable API example. Each turn
uses production loops/tool definitions/MCP with a recording executor and synthetic
files. It performs no real member, routine, memory, URL or deletion action. A model
request still uses network/subscription/API budget. Missing login/key is SKIP;
a failed scenario exits 1 and an entirely skipped/capped matrix exits 2. Reports
live in core/.live/run-*/report.json. Native CLI-internal model round trips are not
observable; the hard run cap counts API calls and submitted CLI turns, plus per-cell
timeouts. The nightly API-only workflow needs no CLI login and is explicitly opt-in.
The scenario contracts S01–S22, the tool-coverage manifest and the exit codes are in
[scenarios.md](scenarios.md); an unbuilt contract reports FAIL "not implemented".

Use the PR template to record rule IDs, commands/exits, look/judge/live artifacts,
images inspected and all incomplete/native acceptance. Never infer deployed or native
acceptance from offline gates.

## macOS

The same app runs on macOS (Apple silicon, macOS 13 or later). The shell's native code for it is
in `app/src-tauri/src/macos` (the accessibility API, posted keys, the pasteboard, power and
permissions), with a macOS file beside each Windows one: `paste/macos.rs`, `media/macos.rs`,
`learn/ax.rs`, `computer/ax.rs`, and the event tap of the vendored keyboard listener
(`vendor/handy-keys/src/platform/macos/listener.rs`). On a Mac:

- `npm run look` renders in the installed Chrome, whose user agent says Macintosh, so the page draws
  its macOS frame (no Windows window controls). On a Mac every main-window scene also draws the native
  traffic lights where `tauri.macos.conf.json` puts them, and fails when a control, face or word is under
  them (`scripts/look/traffic-lights.mjs`); change `trafficLightPosition` and that check together. The real
  app uses WKWebView (Safari's engine), which Chrome does not show: check a change to fonts, scrolling,
  form controls, clipping or iframes in the packaged app too. WebKit differs from WebView2 in ways that
  broke features here before:
  - The Enter, Escape or arrow that picks an IME candidate comes after `compositionend` with only
    keyCode 229: `guardImeKeys()` (shared/ime.ts) keeps it from every page handler; keep it first in main.ts.
  - A clicked `<button>` takes no focus (`focusout.relatedTarget` is null), and the page may not read the
    clipboard (`api.clipboardText` asks the shell on a Mac).
  - No `overflow-clip-margin` (use the `@supports not` clip-path fallbacks), no `field-sizing` before
    Safari 26 (shared/field-sizing.ts), no `Element.moveBefore` (a moved iframe reloads: page cards and
    the member computer's view reconnect when moved), no Referer from `tauri://` (YouTube plays from
    the core's page host, `pages.video_base`).
  - ⌘ is the window's command key (`primaryKey`, `shortcutText`), Control combinations stay with text
    fields, Option+arrows move by word (back/forward is ⌘[ / ⌘]), and no keyup comes for a key let go
    under ⌘.
  - Words: `systemMessage` reads `macCatalogs`, then `macRenames` (PC → Mac, Enter → Return); i18n.test.ts
    fails when a message names a Windows key, program or store on a Mac.
- Dictation, pasting, learning from corrections and operating the desktop need the permissions macOS
  asks for once: Microphone, Accessibility (the hotkeys and ⌘V) and Input Monitoring (the watch on the
  owner's input during a run). A development build runs from the terminal, so macOS asks for, and
  records, the terminal app; grant it there, then restart `tauri dev`.
  The packaged app asks for itself: a refused or unanswered microphone stops the dictation before it
  records (`MicrophoneGate`, NO_SOUND's Mac words), keys waiting for Accessibility tell the window once
  (`missing.accessibility`, with a button to the pane), and an ad-hoc signed rebuild is a new app to
  macOS, so its Accessibility must be allowed again.
- Claude Code keeps its sign-in in the login Keychain on a Mac (R-CLI-SIGNIN-04): only the item's
  existence and date are read, never its secret.
- `npm run native` and `--computer` stay Windows/Docker gates; on a Mac verify native behavior by hand
  in `tauri dev` and say so in the PR.
- Pausing media: macOS 15.4 and later answer MediaRemote only for Apple's processes, so the media
  paused while a recording lasts are the scriptable players that run (Music, Spotify, TV, VLC); a video
  in a browser keeps playing there.

## Native regression gate

Every owner report and every native change must be reproduced in a native journey
that fails before its fix and passes after. From app/, build the isolated debug
binary offline with CARGO_BUILD_JOBS=2, then run:

```powershell
npm run native -- locale-sweep voice-conversation delete-conversation
```

Before a release, run the offline pre-release smoke on the release's own debug build (about five minutes, fake brain,
an isolated data folder): `npm run native -- delete-conversation self-diagnosis calendar pages`. It deletes a member,
clears quick questions, fails a connection card, edits the calendar and drives a page, and it found journeys that had
fallen behind the design and a page that typed into the composer from its preview.

See the native section of [look README](../../../app/scripts/look/README.md) for
CARGO_TARGET_DIR, installed Python/models, debug-only RAPHAEL_TEST_NATIVE isolation,
WebView2 CDP, cost guards and PID cleanup. Every run uses RAPHAEL_FAKE_LLM=1. Never
include gmail-connect implicitly: the owner runs it explicitly with a signed-in
Codex CLI brain and Composio access, stopping before Google consent approval.
Keep report.json, all screenshots/contact sheets, app logs and SQLite evidence in
app/.native/run-*. A regression's expected failure exits 1, never PASS. Inspect the
images and name exact app failures separately from launch/dependency blockers.
Native regression evidence does not replace the selected look/judge design gate.
