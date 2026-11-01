# Composer discovery

## Sub-features

@ names members, groups and connected services. / invokes commands and enabled skills. Packaging is small print, never a section; automatic routines/rules and individual tools are absent. Both consume `ui.ts::openMenu` and its non-focusable `.menu-head` headings. Existing chip and IME behavior remains shared with `mention-field.ts`.

## How to get to it (user POV)

Open a private conversation and type @ or / at the start. Open a group through the sidebar for the allowed-recipient consumer. Show all replaces the service section in place with eight-service pages, keeping every connection reachable without an inner scrollbar. Oversized member or skill lists also page to fit the available height. Search caps results at eight and ranks exact, prefix and substring name/alias matches within each section. The fixture contains 32 synthetic services, including unavailable connections and plugin provenance.

## Driving it with look

Selected look matrix, both themes at 1120,720,1920x1080:

```powershell
npm run look -- completion-mentions completion-filtered completion-expanded completion-expanded-last completion-group completion-slash completion-plugin completion-clash mention-ime-open mention-ime-at mention-ime-filter mention-chip-composer mention-chip-room slash-commands room-menu --theme both --width 1120,720,1920x1080
```

The first eight scenes assert section order, five recent services, alias cap, in-place expansion, all-service reachability, sign-in/key tags, group scope, descriptions, plugin small print, collision resolution, Tab selection, viewport containment and no inner scroll. Ready services have no status tag; only sign-in or key requirements have one. Existing IME/chip scenes cover the shared consumers. `room-menu` supplies the ordinary shared-menu consistency reference at the same theme/size.

Core coverage: `tests/evaluate/test_slash_skills.py`, `tests/integrations/test_inventory.py`, and the affected agent/background/members/worker/integrations suites. Explicit skills resolve at the shared member capability boundary and reuse existing bounded `read_skill`, including references. API/CLI user messages and background worker requests receive that guidance as untrusted data. Original conversation/task text remains the slash request. No new RPC or table is introduced; plugin-qualified internal names use the existing skills table and mirror.

## Gotchas

Run `.fold/wait-heavy.ps1` before each heavy step. No network, real provider, judge, cargo or native journey is authorized. Synthetic browser and fake-model evidence do not establish native, live or independent design acceptance. See root `CODEX_REPORT.md` for actual commands, exits and image review.
