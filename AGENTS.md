# Working in Raphael

- Use English for code, comments and commit messages; talk to the maintainer in Traditional Chinese (繁體中文).
- Test what changed (below): the same rule for everyone, every change. Do not run suites by habit.
- For local UI changes, run mapped affected scenes with
  `npm run look -- <affected scenes> --theme both --width 1120,720,1920x1080` from `app/`.
  Shared components need representative affected consumers, not every unrelated page.
  Drive the real app entry, inspect every generated contact sheet and relevant full-size
  image, and report the selected scope, failures and evidence.
- Reserve `look -- --all` and the complete Guardian matrix for explicit requests or changes
  whose impact genuinely spans the app (for example global tokens, navigation or the shared
  layout). Not for a release: on this PC the whole matrix takes about twelve hours, and each
  merged pull request already ran its own scenes. Do not expand a local change to the whole
  project solely because it is a UI change.
- A passing build or test suite alone never proves user-facing behavior.
- Put deterministic steps in scripts. Extend the existing `verify` and `look`
  workflow instead of creating another feature-specific harness.
- A failure seen twice becomes a lint or test rule.
- Read [verify-raphael](.agents/skills/verify-raphael/SKILL.md) and its feature map.
  Keep the map current when behavior or navigation changes.
- Preserve unrelated work and formatting. Report incomplete checks plainly.

## Test what changed

A change is checked by what it touches and by the regression tests that guard that behavior, never by
running everything. Tests that the change cannot reach, and suites that already passed and that the change
does not touch, are not run again: CI runs the whole Vitest suite, the whole core suite and the Rust suite on
every pull request, and a pull request merges only on CI green on its exact commit.

From `app/`, `npm run verify -- --changed` is the local check of every change. It works out the selection
from git (everything that differs from where the branch left `origin/main`, committed or not) and runs:

1. `tsc`, the app's own TypeScript check.
2. The Vitest tests related to each changed frontend file (`vitest related`: the tests that import it, and
   changed test files themselves).
3. The repository's rule tests, which read the whole tree: the product rules (RULES.md and its area files in
   `.agents/product/rules/`) and their named tests, the feature maps,
   design tokens, focus rings, layout, UI rules, every locale and the history marks (`repo-clean`).
4. For each changed core package, its test folder (`raphael_core/members/…` → `core/tests/members`), for a
   changed top-level module its test file, each changed core test file, and the core tests that read a changed
   file as text (the shell's method list feeds the boundary tests; `READ_BY_CORE_TESTS` in `verify-checks.mjs`), with
   warnings as errors.
5. Contrast only when CSS changed, and Rust formatting only when Rust changed.

Add to it only what the change itself calls for:

| The change touches | Also run |
| --- | --- |
| UI (markup, CSS, words on screen) | the feature-map scenes that show it, `npm run look -- <scenes> --theme both --width 1120,720,1920x1080`, and inspect every contact sheet and the changed parts at full size |
| A new screen or a visual redesign | `npm run judge` on that same look run (a fix that keeps the design needs no judge) |
| The core loop, a prompt, the tool list or `core/tests/evaluate` | `--contract` (the scenario drivers and the default prompt's size budget) |
| Rust that no owner build or CI run will compile before hand-off | `--rust` |
| A path offline tests cannot reach (a container, a native call, a provider) | one real run of that path, or record it as unverified |
| The brain/tool path | `npm run verify -- --live` in an authorized live environment |
| The computer image, the container's shape in `vm.py` or the view path | `npm run verify -- --computer` with Docker already running (it never starts Docker, never runs in CI) |

Not run locally unless the table above asks for it: the whole `npm run verify`, `--core`, `--contract`,
`--rust`, `look -- --all` and judge. Documentation-only changes need diff/link review only.

Report in the pull request which checks ran with their exits, which scenes were inspected, and what was not
run and why. A check that could not run is reported as not run, never as passed.

## Definition of done

Follow [product rules](.agents/product/RULES.md), [architecture](.agents/product/ARCHITECTURE.md)
and [verify-raphael](.agents/skills/verify-raphael/SKILL.md). Run the checks of "Test what changed" for the
change, explain omissions and tool blockers, and merge on CI green on the exact commit.
Before a release, test only what changed since the merged pull requests' own checks (the last
fixes and any failure), with `--contract` when the core loop, a prompt or the tool list changed; CI
green on the exact commit runs the whole core, frontend and Rust suites, and the release workflow
builds and verifies both installers. No whole look matrix and no local
`--rust` unless the change calls for them.
CI enforces repository contracts and the offline suites on every PR; the rendered matrix,
judge and live checks run locally and never in CI. A Windows release starts only after CI has
passed on its exact commit or on one with the same files (the merge of an up-to-date pull request; run CI by hand
when neither did). The version is set in the release's last pull request with `npm run set-version -- x.y.z` (app/),
never in a pull request of its own, and the release runs from main once that merged. Batch the fixes of a day into
few pull requests: each one waits for a whole CI run. Use the [PR contract](.github/pull_request_template.md)
for commands, exits, rule IDs, evidence and anything unverified. Details stay in the skill.
