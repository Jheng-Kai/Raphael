import { scene, settings, click, wait, scroll, type, dropFile, check } from "./steps.mjs";

const about = [...settings("about"), wait("[data-updates]"), scroll("[data-updates]")];
const memory = [...settings("general"), scroll("[data-memory-import]"), click('[data-import="open"]'), wait("[data-import-answer]")];
export default [
  scene("about-no-updater-key", "About offers the releases page when this build has no updater public key", [
    ...about, wait('[data-act="update-releases"]'), check("about-no-updater-key"),
    click('[data-act="update-releases"]'), check("about-release-page-opened"),
  ], {appUpdate:"not_configured"}),
  scene("update-found", "A signed release is named with readable notes and an install action", [...about, wait('[data-act="update-install"]'), check("app-update-found")], {appUpdate:"found"}),
  scene("update-ready", "A verified downloaded release waits for restart", [...about, check("app-update-ready")], {appUpdate:"ready"}),
  scene("update-auto", "Automatic updates are explicitly enabled through the shared switch", [...about, click('[data-k="auto-update"]'), wait('[data-k="auto-update"][aria-checked="true"]'), check("app-update-auto")], {appUpdate:"found"}),
  scene("import-memory", "General shows the handover prompt and owner answer field", [...memory, check("app-memory-import")]),
  scene("import-memory-result", "Memory import lists saved facts and redacted refusals", [...memory, type("[data-import-answer]", "我喜歡以繁體中文溝通，每週五整理研究筆記。\n\npassword is synthetic123"), click('[data-import="save"]'), wait(".import-result"), scroll(".import-result"), check("app-memory-result")]),
  scene("attachment-limits", "The real composer keeps twenty files and refuses a twenty-first", [
    ...Array.from({length:20}, (_, i) => dropFile(".composer", `研究筆記-${i + 1}.txt`, {mime:"text/plain"})),
    wait('.cmp-chip:nth-child(20)'), dropFile(".composer", "超過數量.txt", {mime:"text/plain"}), check("app-attachment-count"),
  ]),
  scene("attachment-too-large", "Document and video refusals name their separate byte limits before any read", [
    dropFile(".composer", "大型研究資料.pdf", {mime:"application/pdf",size:250 * 1024 * 1024 + 1}),
    dropFile(".composer", "大型錄影.mp4", {mime:"video/mp4",size:1024 * 1024 * 1024 + 1}), check("app-attachment-size"),
  ]),
];
