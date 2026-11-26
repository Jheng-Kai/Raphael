// Team skills in Settings: packages, who may use each, and the importer.
import { scene, click, type, wait, waitGone, settings, scroll, focus, key, check, hover, sideButton, dropFile } from "./steps.mjs";
import { memberSettingsPage } from "./member-settings.mjs";

/** What the core refuses an import with: its kind, its reason and what the reason names (members/skill_errors.py). */
const MB = 1024 * 1024;
const REFUSALS = {
  "clash-single": ["clash/single", ["taken", "clash", { skill: "pdf-read", held_by: "pdf", off: false, incoming: "" }]],
  "clash-package": ["clash/package", ["taken", "clash", { skill: "tdd", held_by: "pstack", off: true, incoming: "office-kit" }]],
  "size": ["huge/folder", ["size", "package", { file: "assets/demo-video.mp4", size: 300 * MB, limit: 256 * MB }]],
  "repo": ["owner/missing", ["not_found", "repo", { repo: "owner/missing" }]],
  "network": ["owner/offline", ["download", "network", {}]],
  "document": ["owner/bad-doc", ["skill", "front_matter", { file: "skills/bad/SKILL.md", line: 4 }]],
  // The one box turns away what no slime could convert: no model to write it with, or nothing to make a skill of.
  "no-model": ["https://example.com/handbook", ["convert", "no_model", {}]],
  "no-skill": ["https://example.com/menu", ["convert", "no_skill", { why: "這是一份菜單，裡面沒有可以照著做的步驟。" }]],
};
const list = [...settings("skills"), wait(".skl-pack")];
const opened = [...list, click('[data-skl="open"][data-key="set:1"]'), wait('.skl-page .skl-skills .skl-skill')];
// 匯入 is in the page's header and opens the importer's dialog.
const importing = [...list, click('[data-skl="import-open"]'), wait(".skl-dlg #skl-input")];
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
    ...list, scroll('[data-skl-pack="pack:45"]'), focus('[data-skl="open"][data-key="pack:45"]'), key("Enter"), wait('.skl-page[data-skl-page="pack:45"]'), check("skill-library-page-top"),
    key("Escape"), waitGone(".skl-page"), check("skill-library-back")], { skillPackages: true }),
  scene("skill-library-access", "Who may use a package: the whole team, or the characters ticked, in one menu that stays open while names are ticked; each row leads with a face (the team's own picture for the whole team) and its check stands at the right", [
    ...list, click('[data-skl="access"][data-key="pack:2"]'), wait(".skl-access-menu [data-member]"), check("skill-library-access")]),
  scene("skill-library-import", "匯入 in the page's header opens one dialog: a field that takes anything, a way to choose files and 匯入", [
    ...importing, check("skill-library-import")]),
  scene("skill-library-import-link", "A link pasted in the box waits for 匯入, the box holding it as it was pasted", [
    ...importing, type("#skl-input", "https://example.com/team-handbook"), check("skill-library-import-link")]),
  scene("skill-library-import-menu", "選擇檔案 opens one small menu: the system's file dialog or its folder dialog", [
    ...importing, click('[data-skl="pick"]'), wait(".skl-pick-menu [data-pick]"), check("skill-library-import-menu")]),
  scene("skill-library-imported", "Pasted SKILL.md text becomes a package of one for the whole team, and the importer closes", [
    ...importing, type("#skl-input", "---\nname: travel\ndescription: 依日期整理行程與訂位\n---\n# 旅行行程"),
    click('[data-skl="import-go"]'), wait('.skl-pack[data-skl-pack="pack:13"]'), check("skill-library-imported")]),
  scene("skill-library-import-failed", "A source with no SKILL.md says so in the importer and keeps it open", [
    ...importing, type("#skl-input", "nothing/here"), click('[data-skl="import-go"]'), wait(".skl-error"), check("skill-library-import-failed")]),
  // What is no skill yet is converted by the primary contact: the card says which slime and model while it works, and the
  // skill it wrote is in the list when it is done.
  scene("skill-library-converting", "A file dropped on the box that is no skill is converted by a slime: the card says which slime and which model, in place", [
    ...importing, dropFile(".skl-import", "team-handbook.pdf", { mime: "application/pdf" }), wait('.skl-progress[role="status"]'), check("skill-library-converting")],
    { skillConvert: { match: "team-handbook.pdf", ends: "never", task: { task_id: 31, member: { id: 0, name: "拉斐爾" }, model: "openrouter/anthropic/claude-sonnet-5" } } }),
  scene("skill-library-converted", "The conversion ends: the skill the slime wrote is in the list for the whole team, and the card says who made it", [
    ...importing, dropFile(".skl-import", "team-handbook.pdf", { mime: "application/pdf" }), wait('.skl-progress[role="status"]'),
    wait('.skl-pack[data-skl-pack="skill:weekly"]', 12000), check("skill-library-converted")],
    { skillConvert: { match: "team-handbook.pdf", ends: "done", task: { task_id: 31, member: { id: 0, name: "拉斐爾" }, model: "openrouter/anthropic/claude-sonnet-5" } } }),
  // Importing: the progress, the plugin it makes, what it leaves out, an empty library and each failure in its own words.
  scene("skill-library-empty", "A library with nothing in it says so, and 匯入 stays in the header", [
    ...settings("skills"), wait(".skl-empty"), check("skill-library-empty")], { skillLibraryEmpty: true }),
  scene("skill-library-importing", "An import under way says so under the card, quietly, and holds the importer still", [
    ...importing, type("#skl-input", "owner/slow-import"), click('[data-skl="import-go"]'), wait('.skl-progress[role="status"]'), check("skill-library-importing")],
    { skillImportPending: true }),
  scene("skill-library-plugin-imported", "Skills of one name prefix imported from a GitHub link become one plugin that opens on its page at once", [
    ...importing, type("#skl-input", "https://github.com/owner/desk-kit"), click('[data-skl="import-go"]'),
    wait('.skl-page[data-skl-page="pack:desk"] .skl-skill'), check("skill-library-plugin-imported")], {
    importMade: { "https://github.com/owner/desk-kit": { key: "pack:desk", name: "desk-kit", kind: "plugin", id: 500, skills: ["pdf-read", "pdf-fill", "pdf-merge", "docx-read"] } } }),
  scene("skill-library-skipped", "An import that left skills out because their names are taken lists them with who holds each name", [
    ...importing, type("#skl-input", "owner/leftover"), click('[data-skl="import-go"]'),
    wait('.skl-page[data-skl-page="pack:left"] .skl-skipped'), check("skill-library-skipped")], {
    importMade: { "owner/leftover": { key: "pack:left", name: "office-kit", kind: "pack", id: 520, skills: ["slides", "notes"],
      skipped: [{ name: "tdd", held_by: "pstack" }, { name: "review", held_by: "研究工具" }] } } }),
  ...Object.entries(REFUSALS).map(([id, [source, refusal]]) =>
    scene(`skill-library-failed-${id}`, "A failed import says its real cause in the importer, with the file, the size or the packages it names", [
      ...importing, type("#skl-input", source), click('[data-skl="import-go"]'), wait(".skl-error"), check(`skill-library-failed-${id}`)],
      { importRefusal: { [source]: refusal } })),
  scene("skill-library-rename", "One skill of a pack is renamed on its own page: its title becomes a field, and the pencil stands beside its trash and switch", [
    ...list, click('[data-skl="open"][data-key="pack:2"]'), wait(".skl-page .skl-skill"), click('.skl-page [data-skl="open-skill"][data-id="201"]'),
    wait(".skl-doc-page .skl-doc .ans"), click('[data-skl="skill-rename"][data-id="201"]'), wait("#skl-rename"), check("skill-library-rename")]),
  scene("member-skills-library", "A member's skills show assigned packages under From Team skills, with a button to open Team skills", [
    ...memberSettingsPage, click('.ms-pane .ms-nav [data-cat="skills"]'), wait('.ms-pane [data-k="ms-library"]'), check("member-skills-library")], { memberSettings: true }),
];
