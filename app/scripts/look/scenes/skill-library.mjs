// 團隊技能庫 (skill-library.ts), a tab of Settings: packages, who may use each, and the importer (#280, #249).
import { scene, click, type, wait, settings, scroll, check } from "./steps.mjs";
import { memberSettingsPage } from "./member-settings.mjs";

const list = [...settings("skills"), wait(".skl-pack")];
const opened = [...list, click('[data-skl="open"][data-key="set:1"]'), wait('.skl-skills .skl-skill')];
const importing = [...list, click('[data-skl="import"]'), wait("#skl-source")];
export default [
  scene("skill-library", "One row per package: its name and count, who may use it, its switch and ⋯; a large set reaches nobody until chosen", [...list, check("skill-library-list")]),
  scene("skill-library-open", "A package's row opens its skills under it, each with its own switch", [...opened, scroll(".skl-skills"), check("skill-library-open")]),
  scene("skill-library-access", "Who may use a package: the whole team, or the characters ticked, in one menu that stays open while names are ticked", [
    ...list, click('[data-skl="access"][data-key="pack:2"]'), wait(".skl-access-menu [data-member]"), check("skill-library-access")]),
  scene("skill-library-import", "匯入 opens the importer: a link or owner/repo, a file, a folder, or pasted SKILL.md text", [
    ...importing, click('[data-skl="paste"]'), wait("#skl-text"), check("skill-library-import")]),
  scene("skill-library-imported", "Pasted SKILL.md text becomes a package of one for the whole team, opened at once, and the importer closes", [
    ...importing, click('[data-skl="paste"]'), wait("#skl-text"), type("#skl-text", "---\nname: travel\ndescription: 依日期整理行程與訂位\n---\n# 旅行行程"),
    click('[data-skl="import-text"]'), wait('.skl-pack[data-skl-pack="pack:13"]'), check("skill-library-imported")]),
  scene("skill-library-import-failed", "A source with no SKILL.md says so in the importer and keeps it open", [
    ...importing, type("#skl-source", "nothing/here"), click('[data-skl="import-link"]'), wait(".skl-error"), check("skill-library-import-failed")]),
  scene("member-skills-library", "A character's skills list what the team library gives it, read-only, with the way to the library", [
    ...memberSettingsPage, click('.ms-pane .ms-nav [data-cat="skills"]'), wait('.ms-pane .ms-lib'), check("member-skills-library")], { memberSettings: true }),
];
