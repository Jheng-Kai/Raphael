# Working in Raphael

- Use English for code, comments and commit messages; talk to the maintainer in Traditional Chinese (繁體中文).
- Select verification by the changed behavior and its consumers. Frontend changes run
  `npm run verify` from `app/`; add `--contract` or `--rust` only when those boundaries change.
- A core change runs the test folders it touched and `npm run verify -- --contract` (the scenario
  drivers and the default prompt's size budget: where two units that each passed alone break
  together). The whole core suite is CI's: push and read the result; do not run `--core` on a
  developer's machine as a matter of course.
- For local UI changes, run mapped affected scenes with
  `npm run look -- <affected scenes> --theme both --width 1120,720,1920x1080` from `app/`.
  Shared components need representative affected consumers, not every unrelated page.
  Drive the real app entry, inspect every generated contact sheet and relevant full-size
  image, and report the selected scope, failures and evidence.
- Reserve `look -- --all` and the complete Guardian matrix for integration/release
  acceptance, explicit requests, or changes whose impact genuinely spans the app
  (for example global tokens, navigation or the shared layout). Do not expand a local
  change to the whole project solely because it is a UI change.
- A passing build or test suite alone never proves user-facing behavior.
- Put deterministic steps in scripts. Extend the existing `verify` and `look`
  workflow instead of creating another feature-specific harness.
- A failure seen twice becomes a lint or test rule.
- Read [verify-raphael](.agents/skills/verify-raphael/SKILL.md) and its feature map.
  Keep the map current when behavior or navigation changes.
- Preserve unrelated work and formatting. Report incomplete checks plainly.

## Definition of done

Follow [product rules](.agents/product/RULES.md), [architecture](.agents/product/ARCHITECTURE.md)
and [verify-raphael](.agents/skills/verify-raphael/SKILL.md). From `app/`, run
the checks for the affected boundaries and, for UI, the selected scene matrix above;
inspect its contact sheets and relevant full-size images, then run judge on that same
selected look run. Explain omissions and tool blockers. Documentation-only changes
need diff/link review rather than application suites. Full integration acceptance uses
`npm run verify -- --contract --rust`, CI green on the exact commit (it runs the whole core suite),
and `npm run look -- --all --theme both --width 1120,720,1920x1080`.
Brain/tool changes also require `npm run verify -- --live` in an authorized live environment.
CI enforces repository contracts and the offline suites on every PR; the rendered matrix,
judge and live checks run locally and never in CI. A Windows release starts only after CI has
passed on its exact commit (run CI by hand on it when no pull request did). Use the [PR contract](.github/pull_request_template.md)
for commands, exits, rule IDs, evidence and anything unverified. Details stay in the skill.
