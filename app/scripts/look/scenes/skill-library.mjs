// Team skills in Settings: packages, who may use each, and the importer.
import { scene, click, type, wait, waitGone, settings, scroll, focus, key, check, hover, rightClick, sideButton } from "./steps.mjs";
import { memberSettingsPage } from "./member-settings.mjs";

const list = [...settings("skills"), wait(".skl-pack")];
const opened = [...list, click('[data-skl="open"][data-key="set:1"]'), wait('.skl-page .skl-skills .skl-skill')];
const importing = [...list, wait("#skl-source")];
export default [
  scene("skill-library", "Plugins and standalone skills have separate sections and equal rows", [...list, check("skill-library")]),
  scene("skill-library-row-lit", "A plugin's row under the pointer is lit across its whole card, corners and all", [...list, hover('[data-skl="open"][data-key="set:1"]'), check("skill-library-row-lit")]),
  scene("skill-library-details", "The overflow opens the full description of a standalone skill", [
    ...list, click('[data-skl="more"][data-key="skill:3"]'), click('[data-pick="details"]'), wait(".skl-details"), check("skill-library-details")]),
  scene("skill-library-open", "The round back and close share the plugin title row. Access, ⋯ and the switch sit below it, followed by left-aligned skill rows.", [...opened, check("skill-library-open")]),
  scene("skill-library-skill-details", "Right-clicking a skill row opens its overflow, whose Details action reveals the full description", [
    ...opened, rightClick('.skl-page [data-library-skill="101"]'), click('[data-pick="details"]'), wait(".skl-details"), check("skill-library-skill-details")]),
  scene("nav-side-plugin", "Mouse Back returns from a plugin to Team skills and restores focus to its row", [
    ...opened, sideButton("back"), waitGone(".skl-page"), check("nav-side-plugin"),
  ]),
  scene("skill-library-back", "Enter opens a package low in a long library, and Esc returns to the list where it was left, the focus on that package's row", [
    ...list, scroll('[data-skl-pack="pack:37"]'), focus('[data-skl="open"][data-key="pack:37"]'), key("Enter"), wait('.skl-page[data-skl-page="pack:37"]'), check("skill-library-page-top"),
    key("Escape"), waitGone(".skl-page"), check("skill-library-back")], { skillPackages: true }),
  scene("skill-library-access", "Who may use a package: the whole team, or the characters ticked, in one menu that stays open while names are ticked; each row leads with a face (the team's own picture for the whole team) and its check stands at the right", [
    ...list, click('[data-skl="access"][data-key="pack:2"]'), wait(".skl-access-menu [data-member]"), check("skill-library-access")]),
  scene("skill-library-import", "The importer is the tab's first card: a link or owner/repo, or pasted SKILL.md in its place, a file, a folder, and one 匯入", [
    ...importing, click('[data-skl="paste"]'), wait("#skl-text"), check("skill-library-import")]),
  scene("skill-library-imported", "Pasted SKILL.md text becomes a package of one for the whole team, and the card goes back to the link", [
    ...importing, click('[data-skl="paste"]'), wait("#skl-text"), type("#skl-text", "---\nname: travel\ndescription: 依日期整理行程與訂位\n---\n# 旅行行程"),
    click('[data-skl="import-go"]'), wait('.skl-pack[data-skl-pack="pack:13"]'), check("skill-library-imported")]),
  scene("skill-library-import-failed", "A source with no SKILL.md says so in the importer and keeps it open", [
    ...importing, type("#skl-source", "nothing/here"), click('[data-skl="import-go"]'), wait(".skl-error"), check("skill-library-import-failed")]),
  scene("member-skills-library", "A member's skills show assigned packages under From Team skills, with a button to open Team skills", [
    ...memberSettingsPage, click('.ms-pane .ms-nav [data-cat="skills"]'), wait('.ms-pane [data-k="ms-library"]'), check("member-skills-library")], { memberSettings: true }),
];
