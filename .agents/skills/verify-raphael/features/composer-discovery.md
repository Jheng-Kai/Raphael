# Composer discovery

## Sub-features

@ names the other members and the connected apps, as Grok Bot's does (R-MENU-01): no group, no everyone, no heading; a member says 「成員」 at the right, an app says 「應用程式」, and one that is not signed in says 「需要登入」 after its name and, pressed, opens the apps dialog instead of becoming an address. / invokes commands and enabled skills. Packaging is small print, never a section; automatic routines/rules and individual tools are absent. Both consume `ui.ts::openMenu` (the / menu with its non-focusable `.menu-head` headings, the @ menu with none and a `trail` word at the right of each row). Existing chip and IME behavior remains shared with `mention-field.ts`.

## How to get to it (user POV)

Open a private conversation and type @ or / at the start. Open a group through the sidebar for the allowed-recipient consumer. Show all replaces the service section in place with eight-service pages, keeping every connection reachable without an inner scrollbar. Oversized member or skill lists also page to fit the available height. Search caps results at eight and ranks exact, prefix and substring name/alias matches (the one matcher, R-FIND-01), members before apps. The fixture contains 32 synthetic services, including unavailable connections and plugin provenance.

## Driving it with look

Selected look matrix, both themes at 1120,720,1920x1080:

```powershell
npm run look -- mention-menu-open mention-menu-filter mention-menu-signin mention-menu-signin-pick mention-menu-room completion-mentions completion-filtered completion-expanded completion-expanded-last completion-group completion-slash completion-plugin completion-clash mention-ime-open mention-ime-at mention-ime-filter mention-chip-composer mention-chip-room slash-commands room-menu --theme both --width 1120,720,1920x1080
```

The mention-menu scenes assert the 360 px floating surface, rows of the menu height, 16 px marks, the quiet word at the right of every row lining up, the sign-in tag after the name, the highlighted first row, the conversation's own member absent, and that pressing a signed-out app opens the apps dialog and leaves no address in the words. The first eight completion scenes assert member-then-app order, five recent services, alias cap, in-place expansion, all-service reachability, sign-in/key tags, group scope, descriptions, plugin small print, collision resolution, Tab selection, viewport containment and no inner scroll. Ready services have no status tag; only sign-in or key requirements have one. Existing IME/chip scenes cover the shared consumers. `room-menu` supplies the ordinary shared-menu consistency reference at the same theme/size.

Core coverage: `tests/evaluate/test_slash_skills.py`, `tests/integrations/test_inventory.py`, and the affected agent/background/members/worker/integrations suites. Explicit skills resolve at the shared member capability boundary and reuse existing bounded `read_skill`, including references. API/CLI user messages and background worker requests receive that guidance as untrusted data. Original conversation/task text remains the slash request. No new RPC or table is introduced; plugin-qualified internal names use the existing skills table and mirror.

## Gotchas

Synthetic browser and fake-model evidence do not establish native, live or independent design acceptance.
