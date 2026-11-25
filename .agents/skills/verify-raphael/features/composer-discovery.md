# Composer discovery

## Sub-features

@ names the other members and the connected apps, (R-MENU-01): no group, no everyone, no heading; a member says 「成員」 at the right, an app says 「應用程式」, and one that is not signed in says 「需要登入」 after its name and, pressed, opens the apps dialog instead of becoming an address. / invokes commands and enabled skills. Packaging is small print, never a section; automatic routines/rules and individual tools are absent. Both consume `ui.ts::openMenu` (the / menu with its non-focusable `.menu-head` headings, the @ menu with none and a `trail` word at the right of each row). Existing chip and IME behavior remains shared with `mention-field.ts`.

The composer's + (`composer-plus.ts`, R-UI-166) is the third way in. In a member's own conversation it opens one menu above itself: 加入檔案或圖片 (Ctrl+U, ⌘U on a Mac, also heard anywhere in the composer), 加入資料夾 (the composer's folder button's own action, offered while that button is shown), 斜線指令 (a / at the caret, which opens the / menu as typing it does), a hairline, then 應用程式 › and 技能 ›. 應用程式 opens 瀏覽應用程式 (Connect Apps) and 管理應用程式 (the member's settings on 工具), a hairline and each connected app with its own mark and a switch; 技能 opens the member's skills with switches, a hairline and 管理技能 (the settings on 技能與指令). The switches are the settings' own (`member-tools.ts` decides the member's list of apps for both, the skill is updated by the same `members.skills.update`), and wear the member's colour. A room's composer has no menu: its + opens the picker.

## How to get to it (user POV)

Open a private conversation and type @ or /, at the start or after other words: both open where an @ stands or a / begins a word (`completion-trigger.ts` holds the two rules; a / inside a word or an address such as `a/b` or `https://x.com/y` opens nothing). Open a group through the sidebar for the allowed-recipient consumer. With nothing typed the @ menu is one list of every other member and then every offered app, in a menu of a fixed height (seven rows and half of the next, so the cut row says it goes on) that scrolls with the mouse wheel and keeps the row the arrow keys reach in view (there is no Show all row and no pages). Oversized skill lists in the / menu use one scroll window and keep the keyboard selection visible. Search caps results at eight and ranks exact, prefix and substring name/alias matches (the one matcher, R-FIND-01), members before apps. The fixture contains 32 synthetic services, including unavailable connections and plugin provenance.

## Driving it with look

```powershell
npm run look -- composer-typing-performance --theme both --width 1120,720,1920x1080
```

R-PERF-22 drives the real composer with 400 stored turns (the ordinary
transcript window still bounds what is mounted), 25 members and 150 skills,
including a 60-skill package. It measures 40 plain keys, each opening key,
ten slash and six mention filter keys, and eight arrows in each menu. It checks
the mounted window can wrap to the last skill and select it, and rejects
transcript/sidebar mutations, geometry reads and repeated inventory reads.
Set `LOOK_TRACE=1` for per-key trace marks, renderer stacks and style invalidation. Timings from this mode are diagnostic.

Selected look matrix, both themes at 1120,720,1920x1080:

```powershell
npm run look -- mention-menu-open mention-menu-filter mention-menu-signin mention-menu-signin-pick mention-menu-room completion-mentions completion-filtered completion-scrolled completion-arrows completion-group completion-slash completion-plugin completion-clash mention-ime-open mention-ime-at mention-ime-filter mention-chip-composer mention-chip-room slash-many slash-usage slash-usage-opened slash-commands slash-after-words slash-after-words-pick slash-inside-word room-menu --theme both --width 1120,720,1920x1080
```

The mention-menu scenes assert the 360 px floating surface, rows of the menu height, 16 px marks, the quiet word at the right of every row lining up, the sign-in tag after the name, the highlighted first row, the conversation's own member absent, and that pressing a signed-out app opens the apps dialog and leaves no address in the words. The completion scenes assert member-then-app order, all thirty-two services on the one list with the ones that need a sign-in or a key last, no show-all row, the fixed maximum height with a cut row at its foot, the wheel reaching the last row with its tag whole in view (`completion-scrolled`), ArrowUp from the first row wrapping to the last with the highlight scrolled into view and the focus still in the field (`completion-arrows`), alias cap, sign-in/key tags, group scope, descriptions, plugin small print, collision resolution, Tab selection, viewport containment, and for the / menu no inner scroll. Ready services have no status tag; only sign-in or key requirements have one. Existing IME/chip scenes cover the shared consumers. `room-menu` supplies the ordinary shared-menu consistency reference at the same theme/size.

The / scenes: `slash-usage` (the app's own /usage leads the menu under 內建, R-SLASH-APP-01), `slash-usage-opened` (choosing it opens Settings › 用量, leaves no /usage in the draft and sends nothing), `slash-many` (thirty skills: one list that scrolls with a cut row at the bottom and no 下一頁, R-MENU-02, issue 241), `slash-commands` (a / alone), `slash-after-words` (words, then a space and a /: the menu opens beside that /, checked within 24 px of it and above or below its line), `slash-after-words-pick` (Tab puts `/review` where the / was, the caret after it, one chip drawn) and `slash-inside-word` (after an open menu, an address and `a/b` close it and open none). R-MENU-05.

The + scenes: `composer-plus-menu` (five rows in order, an icon on each and none repeated, 28 px rows, the shortcut and the chevrons at one right edge, the one hairline, above the + with their left edges together), `composer-plus-apps` and `composer-plus-skills` (the submenu beside its row and level with it, whole inside the window, 38 x 22 switches at one right edge, 20 px marks at one size, a switch that is on in the member's colour and one that is off as everywhere, a tooltip only on a cut name), `composer-plus-apps-saved` and `composer-plus-skills-saved` (a switch pressed in the menu is off in the settings tab that 管理應用程式 or 管理技能 opens).

```powershell
npm run look -- composer-plus-menu composer-plus-apps composer-plus-skills composer-plus-apps-saved composer-plus-skills-saved composer-folder composer-folder-menu --theme both --width 1120,720,1920x1080
```

Core coverage: `tests/evaluate/test_slash_skills.py`, `tests/integrations/test_inventory.py`, and the affected agent/background/members/worker/integrations suites. Explicit skills resolve at the shared member capability boundary and reuse existing bounded `read_skill`, including references. API/CLI user messages and background worker requests receive that guidance as untrusted data. Original conversation/task text remains the slash request. No new RPC or table is introduced; plugin-qualified internal names use the existing skills table and mirror.

## Gotchas

`MemberCapabilities.resolve_slash` (the one place every turn, API, CLI and background task expands a command or skill) loads a `/name` that begins a word anywhere in the message, when its whole token is a command or an enabled skill of that member. The first such call loads; any other `/word` (unknown, disabled, `/name.` with punctuation, a second call), a path and an address (`a/b`, `https://x.com/y`) stay words. The request is the message without the token (words before and after joined, as the words after it at the start): a custom command fills `{input}` with it, a skill sends it ahead of the skill document. A custom command wins over a skill of the same name, as at the start. Core tests: `tests/evaluate/test_slash_skills.py` (mid-text load, unknown words and paths, two calls).

Synthetic browser and fake-model evidence do not establish native, live or independent design acceptance.
