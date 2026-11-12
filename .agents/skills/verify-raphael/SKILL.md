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
Readiness means Home's Raphael report (or onboarding Next button / overlay progress)
is visible. Non-home journeys then enter the conversation through the real rail,
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

Choose the smallest verification scope that covers the changed behavior and its
affected consumers before running commands. Use the feature map to name those scenes
and state the selection briefly. A shared dialog, for example, needs its conversation,
routine, group and room confirmation scenes, not unrelated settings, onboarding and
dictation journeys. Keep all three sizes and both themes for the selected UI scenes.

```powershell
npm run verify
npm run look -- <affected scenes> --theme both --width 1120,720,1920x1080
```

Use the selected feature matrix for a local UI handoff. Reserve the full matrix for
integration/release acceptance, CI, explicit requests or genuinely app-wide changes
such as global tokens, navigation and shared layout. Sharing a component alone does
not require full-project verification. Add core or Rust checks only when their code,
contracts or behavior change; frontend-only styling does not require either suite.
Documentation-only changes need diff/link review. All commands are from `app/`.
`verify -- --quick` omits contrast and is only an iteration check. Report unavailable
dependencies and exact exits; do not rerun unchanged, unrelated suites to replace a
blocked check.

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
a set-up argument the driver refuses fails every screen tool, and fakes take anything).
This drives `LocalVm` and the image helper: 1, 3 and 6 outputs, panels, boot readiness,
authenticated clipped RFB views, screen-local launcher input and raw pixels, restart,
helper/view recovery, X-server loss, the core's `DesktopViewer` relay, and available
layer 4 start/update/erase fixtures with preserved workspace files. It uses its own
owner, data folder and `raphael-acceptance/cua-local-vm:<run id>` image tag; cleanup
never touches another owner or the real image tag. `--keep` on the Python module
retains its resources and prints them; interruption/failure otherwise cleans them.
Missing/non-Linux Docker exits 2, a failed check exits 1, success exits 0. A missing
layer 4 image is a named skip. Every failure includes expected/observed evidence.

`computer.log` and `computer-acceptance.json` are in the verify run folder alongside
`report.json`. Direct use from `core/` is
`python -m raphael_core.evaluate.computer_acceptance --screens 1,4,6 --out <folder>`;
omit `--out` to print only. Offline protocol/parser/isolation regressions are in
`core/tests/evaluate/test_computer_acceptance.py`. Their fakes do not prove containers.
Real container acceptance proves the core relay, not the native app's panel around
it, a remote SSH host, or later stages' shared member seats. Keep those separate.

## Guardian hand-off gates

Read [RULES.md](../../product/RULES.md) and [ARCHITECTURE.md](../../product/ARCHITECTURE.md).
Their named tests run in the ordinary Vitest/pytest suites on every PR, not local hooks.
From app/, the complete integration offline check is `npm run verify -- --contract --rust` together with CI's result
on the exact commit: CI runs the whole core suite on every push (about a quarter of an hour over eight machines),
so `--core`, the same suite on a developer's machine, is for when CI cannot be used. A core change runs the test
folders it touched and `--contract` (the scenario drivers in `core/tests/evaluate` and the default prompt's size
budget) before it is handed back: on 2026-11-11 units that ran only their own files let 5, 6 and 9 failures
through to the merged tree, nearly all of them in those two places.
Local changes use the affected frontend/core/Rust boundaries described above.

CI deals the Python test files among eight machines by the seconds recorded in
`core/tests/shard-durations.json` (2026-11-11). When one share runs much longer than the others,
refresh the record as the header of `core/tests/shard_durations.py` describes: merge the
`python-durations-*` artifacts of one green CI run. A pull request that touches `core/packaging`,
`core/pyproject.toml` or `core/uv.lock` also runs the frozen-core smoke test (not a required gate).
A release workflow run asks for a green CI run on its commit instead of repeating the suites.

For local UI hand-off, capture the selected affected scenes at both themes and all
three sizes. Full UI integration acceptance uses
`npm run look -- --all --theme both --width 1120,720,1920x1080`.
The 1920 viewport is 1080px high. Inspect every generated contact sheet and relevant
full-size image, then run `npm run judge -- <look run dir> --references <external png/jpg paths...>`
(or `npm run verify -- --judge <look run dir>` with RAPHAEL_JUDGE_REFERENCES as a JSON
array of external paths). Judge reviews the same selected look run; it must not widen
a local change into a full-project review. Judge is required after look and before UI hand-off,
or must be recorded as blocked/SKIP with the reason when unavailable.
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

## Native regression gate

Every owner report and every native change must be reproduced in a native journey
that fails before its fix and passes after. From app/, build the isolated debug
binary offline with CARGO_BUILD_JOBS=2, then run:

```powershell
npm run native -- locale-sweep voice-conversation delete-conversation
```

See the native section of [look README](../../../app/scripts/look/README.md) for
CARGO_TARGET_DIR, installed Python/models, debug-only RAPHAEL_TEST_NATIVE isolation,
WebView2 CDP, cost guards and PID cleanup. Every run uses RAPHAEL_FAKE_LLM=1. Never
include gmail-connect implicitly: the owner runs it explicitly with a signed-in
Codex CLI brain and Composio access, stopping before Google consent approval.
Keep report.json, all screenshots/contact sheets, app logs and SQLite evidence in
app/.native/run-*. A regression's expected failure exits 1, never PASS. Inspect the
images and name exact app failures separately from launch/dependency blockers.
Native regression evidence does not replace the selected look/judge design gate.
