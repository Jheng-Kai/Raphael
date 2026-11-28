// Team skills in Settings: packages, who may use each, and the importer.
import { scene, click, type, wait, waitGone, settings, scroll, focus, key, check, hover, sideButton, dropFile, lookCall, paste } from "./steps.mjs";
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
  // A Git address fetched by the system's git (members/skill_git.py): what is wrong, said with the one thing that helps.
  "git-sign-in": ["git@gitlab.example.com:group/handbook.git", ["source", "git_sign_in", { host: "gitlab.example.com" }]],
  "git-host-key": ["ssh://git@gitlab.example.com/group/handbook.git", ["source", "git_host_key", { host: "gitlab.example.com" }]],
  "git-network": ["https://gitlab.example.com/group/handbook.git", ["download", "git_network", { host: "gitlab.example.com" }]],
  "git-missing": ["git@git.example.org:team/tools.git", ["source", "git_missing", {}]],
};
/** What the core answers when what was put in is no skill: the facts the window hands to Raphael's conversation (members/skill_intake.py). */
const HANDOFFS = [
  { match: "https://example.com/handbook", handoff: { kind: "link", label: "https://example.com/handbook", address: "https://example.com/handbook" } },
  { match: "team-handbook.pdf", handoff: { kind: "file", label: "team-handbook.pdf" } },
  { match: "git@gitlab.example.com:group/handbook.git", handoff: { kind: "folder", label: "handbook", address: "git@gitlab.example.com:group/handbook.git",
    path: "C:\\Users\\owner\\Raphael\\skill-sources\\handbook-1a2b3c" } },
];
const LAZY_TEXT = "---\nname: lazy-mode\ndescription: Do the least that works\n---\nRead [how](actions/how.md) before you act.";
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
  // The importer (R-SKILL-26) in its states: idle, a file dragged over it, a file chosen, what is no skill, the import under way at
  // each step, cancelled back to idle, and the failures below.
  // The menu of who may use a package stays short however many characters there are (R-SKILL-17).
  scene("skill-library-access-many", "With 25 characters the menu stays short: the whole team, a search, six rows in view and the rest scrolling, and 移除所有人 at its foot", [
    ...list, click('[data-skl="access"][data-key="pack:2"]'), wait(".skl-access-menu [data-member]"), check("skill-library-access-many")], { skillMembers: 25 }),
  scene("skill-library-access-search", "Typing in the menu's search narrows the characters to those that match, and what is ticked stays ticked", [
    ...list, click('[data-skl="access"][data-key="pack:2"]'), wait(".skl-access-menu [data-skl-search]"), type(".skl-access-menu [data-skl-search]", "小"),
    wait('.skl-access-menu [data-member="1"]'), check("skill-library-access-search")], { skillMembers: 25 }),
  scene("skill-library-access-clear", "移除所有人 sets the package to nobody, takes the ticks away, and the menu stays open", [
    ...list, click('[data-skl="access"][data-key="pack:2"]'), wait(".skl-access-menu [data-member]"), click('.skl-access-menu [data-access="none"]'),
    wait('.skl-access-menu [data-access="none"][aria-disabled="true"]'), check("skill-library-access-clear")], { skillMembers: 25 }),
  scene("skill-library-import", "匯入 opens the importer: a dashed drop zone with one button, one line for an address, nothing at the foot", [
    ...importing, check("skill-library-import")]),
  scene("skill-library-import-link", "An address pasted in the line waits for its small arrow or Enter", [
    ...importing, type("#skl-input", "https://example.com/team-handbook"), check("skill-library-import-link")]),
  scene("skill-library-import-over", "A file dragged over the importer lights the drop zone", [
    ...importing, dropFile(".skl-import", "pstack.zip", { mime: "application/zip", hold: true }), wait(".skl-zone.is-over"), check("skill-library-import-over")]),
  scene("skill-library-import-chosen", "選擇檔案 takes a SKILL.md: its folder is what is imported, and the dialog says so", [
    ...importing, click('[data-skl="pick"]'), wait(".skl-import.is-busy"), check("skill-library-import-chosen")],
    { pickedSource: "C:\\Users\\owner\\skills\\pstack\\SKILL.md", skillImportPending: true }),
  scene("skill-library-imported", "Pasted SKILL.md text becomes a package of one for the whole team, and the importer closes", [
    ...importing, paste("#skl-input", { text: "---\nname: travel\ndescription: 依日期整理行程與訂位\n---\n# 旅行行程" }),
    wait('.skl-pack[data-skl-pack="pack:13"]'), check("skill-library-imported")]),
  scene("skill-library-import-failed", "A source with no SKILL.md says so in the importer and keeps it open", [
    ...importing, type("#skl-input", "nothing/here"), click('[data-skl="import-go"]'), wait(".skl-error"), check("skill-library-import-failed")]),
  // What is no skill: the dialog says what it is and asks; only 請拉斐爾做 closes it and opens Raphael's own conversation with the
  // owner's words (the source as readable words, a file as the message's own attachment) and Raphael's first answer, a question card.
  scene("skill-library-notskill", "A web page that is no skill: the dialog says what it is, with 換一個 and 請拉斐爾做", [
    ...importing, type("#skl-input", "https://example.com/handbook"), click('[data-skl="import-go"]'), wait(".skl-notice"), check("skill-library-notskill")],
    { skillHandoff: HANDOFFS }),
  scene("skill-library-notskill-file", "A document dropped on the importer that is no skill is said to be a document, with the same two buttons", [
    ...importing, dropFile(".skl-import", "team-handbook.pdf", { mime: "application/pdf" }), wait(".skl-notice"), check("skill-library-notskill-file")],
    { skillHandoff: HANDOFFS }),
  scene("skill-library-notskill-another", "換一個 gives the importer back, with the address as it was", [
    ...importing, type("#skl-input", "https://example.com/handbook"), click('[data-skl="import-go"]'), wait(".skl-notice"),
    click('[data-skl="import-another"]'), wait(".skl-zone"), check("skill-library-import")], { skillHandoff: HANDOFFS }),
  scene("skill-library-handoff", "請拉斐爾做 closes the dialog and opens Raphael's conversation with the owner's words and Raphael's choices as a question card", [
    ...importing, type("#skl-input", "https://example.com/handbook"), click('[data-skl="import-go"]'), wait(".skl-notice"), click('[data-skl="import-ask"]'),
    wait('[data-owner-question="skill-choice"]'), check("skill-library-handoff")], { skillHandoff: HANDOFFS }),
  scene("skill-library-handoff-file", "A file that is no skill goes to Raphael's conversation as the message's own file when asked", [
    ...importing, dropFile(".skl-import", "team-handbook.pdf", { mime: "application/pdf" }), wait(".skl-notice"), click('[data-skl="import-ask"]'),
    wait('[data-owner-question="skill-choice"]'), check("skill-library-handoff-file")], { skillHandoff: HANDOFFS }),
  scene("skill-library-handoff-repo", "A Git repository of other material is fetched, and Raphael is told where it was put", [
    ...importing, type("#skl-input", "git@gitlab.example.com:group/handbook.git"), click('[data-skl="import-go"]'), wait(".skl-notice"), click('[data-skl="import-ask"]'),
    wait('[data-owner-question="skill-choice"]'), check("skill-library-handoff-repo")], { skillHandoff: HANDOFFS }),
  scene("skill-library-handoff-back", "Back in Settings after a hand-off, Team skills shows nothing half-done: no dialog, no draft, no error", [
    ...importing, type("#skl-input", "https://example.com/handbook"), click('[data-skl="import-go"]'), wait(".skl-notice"), click('[data-skl="import-ask"]'),
    wait('[data-owner-question="skill-choice"]'), ...settings("skills"), wait(".skl-pack"), click('[data-skl="import-open"]'), wait(".skl-dlg #skl-input"),
    check("skill-library-handoff-back"), key("Escape"), waitGone(".skl-dlg")], { skillHandoff: HANDOFFS }),
  // The import under way: the title names the source, the bar and one line say the step, 取消 is the only way out and really stops it.
  scene("skill-library-fetching", "A Git address being fetched: the title names the repository and the first step is getting the files", [
    ...importing, type("#skl-input", "git@gitlab.example.com:group/handbook.git"), click('[data-skl="import-go"]'),
    wait(".skl-import.is-busy .skl-bar"), check("skill-library-fetching")], { skillImportPending: true }),
  scene("skill-library-importing", "An import reading skill 3 of 7: the bar, the step, no ×, and Esc does nothing", [
    ...importing, type("#skl-input", "owner/slow-import"), click('[data-skl="import-go"]'), wait(".skl-import.is-busy .skl-bar"),
    lookCall("importStep", "read", 3, 7), key("Escape"), check("skill-library-importing")], { skillImportPending: true }),
  scene("skill-library-importing-install", "The last step writes the library, and 取消 waits: it can no longer stop it without a trace", [
    ...importing, type("#skl-input", "owner/slow-import"), click('[data-skl="import-go"]'), wait(".skl-import.is-busy .skl-bar"),
    lookCall("importStep", "read", 7, 7), lookCall("importStep", "install"), check("skill-library-importing-install")], { skillImportPending: true }),
  scene("skill-library-import-cancelled", "取消 stops the import: the core is told, and the dialog is the importer again with the address kept", [
    ...importing, type("#skl-input", "owner/slow-import"), click('[data-skl="import-go"]'), wait(".skl-import.is-busy .skl-bar"),
    lookCall("importStep", "read", 2, 7), click('[data-skl="import-cancel"]'), wait(".skl-zone"), check("skill-library-import-cancelled")], { skillImportPending: true }),
  // Pasted text that is a skill but sends the model to other files cannot bring them: it is said, and the owner may keep the text alone.
  scene("skill-library-failed-needs-files", "A pasted skill that names other files says so, and asks for its folder instead", [
    ...importing, paste("#skl-input", { text: LAZY_TEXT }), wait(".skl-error"), check("skill-library-failed-needs-files")], { needsFiles: true }),
  scene("skill-library-needs-files-alone", "只匯入這段文字 imports the text as it is, once the owner says it needs nothing else", [
    ...importing, paste("#skl-input", { text: LAZY_TEXT }), wait(".skl-error"), click('[data-skl="import-alone"]'),
    wait('.skl-pack[data-skl-pack="pack:13"]'), check("skill-library-needs-files-alone")], { needsFiles: true }),
  // An empty library, then the plugin it makes, what it leaves out and each failure in its own words.
  scene("skill-library-empty", "A library with nothing in it says so, and 匯入 stays in the header", [
    ...settings("skills"), wait(".skl-empty"), check("skill-library-empty")], { skillLibraryEmpty: true }),
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
