// Team skills in Settings: packages, who may use each, and the importer.
import { scene, click, type, wait, waitGone, settings, scroll, focus, key, check, hover, sideButton } from "./steps.mjs";
import { memberSettingsPage } from "./member-settings.mjs";

const list = [...settings("skills"), wait(".skl-pack")];
const opened = [...list, click('[data-skl="open"][data-key="set:1"]'), wait('.skl-page .skl-skills .skl-skill')];
const importing = [...list, wait("#skl-source")];
export default [
  scene("skill-library", "Plugins and standalone skills have separate sections and equal rows", [...list, check("skill-library")]),
  scene("skill-library-row-lit", "A plugin's row under the pointer is lit across its whole card, corners and all", [...list, hover('[data-skl="open"][data-key="set:1"]'), check("skill-library-row-lit")]),
  scene("skill-library-doc-alone", "A skill alone opens on its own page: its controls, a quote of its words and where it came from, then its document", [
    ...list, click('[data-skl="open-skill"][data-key="skill:3"]'), wait(".skl-doc-page .skl-doc .ans"), check("skill-library-doc-alone")]),
  // Settings has no right click and no ⋯: a package is deleted from its page's trash, which asks in the red dialog.
  scene("skill-library-page-remove", "A plugin's page has its trash beside its update button; it asks in the red dialog naming the package", [
    ...opened, click('.skl-page-actions [data-skl="remove"][data-key="set:1"]'), wait(".mb-dialog.mb-delete"), check("skill-library-page-remove")]),
  scene("skill-library-open", "The way back and the plugin title, then access, the update button and the switch on its row; a quote of its words holds where it came from; each skill row opens its page.", [...opened, check("skill-library-open")]),
  scene("skill-library-skill-page", "A plugin's skill opens on its own page: the way back and its name, its switch, a quote of its words, then its document", [
    ...opened, click('.skl-page [data-skl="open-skill"][data-id="101"]'), wait(".skl-doc-page .skl-doc .ans"), check("skill-library-skill-page")]),
  scene("nav-side-plugin", "Back returns from a skill to its plugin, Team skills and the conversation. Forward restores all three", [
    ...opened, click('.skl-page [data-skl="open-skill"][data-id="101"]'), wait(".skl-doc-page .skl-doc .ans"),
    sideButton("back"), waitGone(".skl-doc-page"), wait(".skl-page"),
    sideButton("back"), waitGone(".skl-page"), check("nav-side-plugin"), sideButton("back"), check("nav-settings-closed"),
    sideButton("forward"), wait(".skl-pack"), sideButton("forward"), wait(".skl-page"), sideButton("forward"), wait(".skl-doc-page"),
  ]),
  scene("skill-library-refresh", "A package shows progress on its own page while its update is pending", [
    ...opened, check("skill-library-open"), click('[data-skl="refresh"][data-key="set:1"]'),
    wait('.skl-refresh-status[role="status"]')], { skillRefreshPending: true }),
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
