// Team skills in Settings: packages, who may use each, and the importer.
import { scene, click, type, wait, waitGone, settings, scroll, key, check } from "./steps.mjs";
import { memberSettingsPage } from "./member-settings.mjs";

const list = [...settings("skills"), wait(".skl-pack")];
const opened = [...list, click('[data-skl="open"][data-key="set:1"]'), wait('.skl-page .skl-skills .skl-skill')];
const importing = [...list, wait("#skl-source")];
export default [
  scene("skill-library", "One row per package: its name and count, who may use it, its switch and ⋯; a large set reaches nobody until chosen", [...list, check("skill-library-list")]),
  scene("skill-library-open", "Pressing a package's row opens it on a page of its own in the tab: the back arrow and its name, who may use it, its switch and ⋯, then its skills, each with its own switch", [...opened, check("skill-library-open")]),
  scene("skill-library-back", "From a package low in a long library, Esc returns to the list where it was left, the focus on that package's row", [
    ...list, scroll('[data-skl-pack="pack:37"]'), click('[data-skl="open"][data-key="pack:37"]'), wait('.skl-page[data-skl-page="pack:37"]'), check("skill-library-page-top"),
    key("Escape"), waitGone(".skl-page"), check("skill-library-back")], { skillPackages: true }),
  scene("skill-library-access", "Who may use a package: the whole team, or the characters ticked, in one menu that stays open while names are ticked; each row leads with a face (the team's own picture for the whole team) and its check stands at the right", [
    ...list, click('[data-skl="access"][data-key="pack:2"]'), wait(".skl-access-menu [data-member]"), check("skill-library-access")]),
  scene("skill-library-import", "The importer is the tab's first card: a link or owner/repo, or pasted SKILL.md in its place, a file, a folder, and one 匯入", [
    ...importing, click('[data-skl="paste"]'), wait("#skl-text"), check("skill-library-import")]),
  scene("skill-library-imported", "Pasted SKILL.md text becomes a package of one for the whole team, opened at once, and the card goes back to the link", [
    ...importing, click('[data-skl="paste"]'), wait("#skl-text"), type("#skl-text", "---\nname: travel\ndescription: 依日期整理行程與訂位\n---\n# 旅行行程"),
    click('[data-skl="import-go"]'), wait('.skl-pack[data-skl-pack="pack:13"]'), check("skill-library-imported")]),
  scene("skill-library-import-failed", "A source with no SKILL.md says so in the importer and keeps it open", [
    ...importing, type("#skl-source", "nothing/here"), click('[data-skl="import-go"]'), wait(".skl-error"), check("skill-library-import-failed")]),
  scene("member-skills-library", "A member's skills show assigned packages under From Team skills, with a button to open Team skills", [
    ...memberSettingsPage, click('.ms-pane .ms-nav [data-cat="skills"]'), wait('.ms-pane [data-k="ms-library"]'), check("member-skills-library")], { memberSettings: true }),
];
