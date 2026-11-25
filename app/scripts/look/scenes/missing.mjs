import { scene, click, wait, member, settings, check, scroll } from "./steps.mjs";

const prerequisite = {resource: "searxng", requirement: "url", state: "missing", repair: "search"};
const turn = {id: 502, session_id: "look-missing", member_id: 1, conversation_id: 11, created_at_ms: 1792807154000,
  question: "請搜尋這週的公開資料。", route: "answer", source: "app", prefix: "", text: "搜尋尚未完成，請先補齊服務設定。",
  detail: null, status: "error", cost_usd: 0, model: "openai/gpt-6-luna", attachments: [],
  messages: [{seq: 1, kind: "reply", text: "搜尋尚未完成，請先補齊服務設定。", at_ms: 1792807160000}],
  steps: [{kind: "tool", tool: "web_search", server: "Raphael", outcome: "error", reason: "not_configured", detail: "searxng", ms: 20, at_ms: 1792807155000, missing: prerequisite}]};
// What a step was missing stands in sight with its repair: the work it was part of is never opened.
const search = [member(1), wait('.page-agent:not([hidden]) .turn-prerequisites .missing-note')];
const cause = (reason, detail, missing, outcome = "error") => ({...turn, steps: [{kind: missing.requirement === "provider" ? "model" : "tool", tool: missing.resource === "openrouter" ? "provider" : "read_attachment", server: "Raphael", reason, detail, outcome, missing, ms: 20}]});
const provider = {resource: "openrouter", requirement: "provider", state: "broken", repair: "models"};
const keychainRefused = [member(1), {action: "main-event", event: {type: "KeychainRefused"}}, {action: "main-event", event: {type: "KeychainRefused"}},
  wait(".toast .keychain-refused"), check("keychain-refused"), check("toast-clearance")];
export default [
  // The owner chose Deny on the macOS Keychain (R-PRIV-KEYCHAIN-01): one toast above the composer says so with 再問一次,
  // which asks the core to ask again and leaves the note of what happens next. Only the shell's event is synthetic.
  scene("keychain-refused", "A refused Keychain, told twice, is said in one toast above the composer with 再問一次", keychainRefused),
  scene("keychain-asked", "再問一次 asks the core once and leaves the note of what happens next",
    [...keychainRefused, click("[data-keychain-ask-again]"), wait(".toast:not(:has(.keychain-refused))"), check("keychain-asked")]),
  scene("missing-card", "The shared connection card names the exact Composio form in visible words", [member(1), wait('.connector-card .missing-note'), check("missing-card")], {composioConfigured: false, turns: [{...turn, steps: [], connectors: [{id: "missing-gmail", app: "gmail", name: "Gmail", state: "failed", error: "needs_composio_key", reconnect: false, tool_count: 0, missing: {resource: "composio", requirement: "composio_key", state: "missing", repair: "store"}}]}]}),
  // #320: Composio refused the saved key while a member connected an app: the card's button opens the key form over the saved key.
  scene("card-key-refused-repair", "A card whose Composio key was refused opens the form that replaces the saved key", [member(1), wait('.connector-card [data-act="card-settings"]'),
    click('.connector-card [data-act="card-settings"]'), wait('#conn-key'), check("composio-key-replace")],
    {composioConfigured: true, composioKeyRefused: true, turns: [{...turn, steps: [], connectors: [{id: "refused-calendar", app: "googlecalendar", name: "Google Calendar", state: "failed", error: "key_refused", fix: "settings", retry: false, reconnect: false, tool_count: 0}]}]}),
  scene("missing-card-repair", "The shared card opens the exact existing Composio key field", [member(1), wait('.connector-card .missing-note'), check("missing-card"), click('.connector-card [data-missing-repair="store"]'), wait('#conn-key'), check("missing-card-repair")], {composioConfigured: false, turns: [{...turn, steps: [], connectors: [{id: "missing-gmail", app: "gmail", name: "Gmail", state: "failed", error: "needs_composio_key", reconnect: false, tool_count: 0, missing: {resource: "composio", requirement: "composio_key", state: "missing", repair: "store"}}]}]}),
  scene("missing-provider", "Provider authentication keeps its real cause and account repair", [...search, check("missing-provider")], {turns: [cause("provider_broken", "openrouter", provider)]}),
  scene("missing-provider-repair", "Provider repair opens the existing credential card", [...search, click('[data-missing-repair="models"]'), wait('#pv-dialog'), check("missing-provider-repair")], {turns: [cause("provider_broken", "openrouter", provider)]}),
  scene("missing-routines", "Failed routine loading has visible recovery in member details", [member(1), {action: "open-details"},  wait('.mb-det .missing-note'), check("missing-routines")], {missingRoutines: true}),
  scene("missing-learned", "Undeliverable learning notices name the real dictionary", [member(1), {action: "main-event", event: {type: "SetupMissing", missing: {resource: "dictionary", requirement: "learned", state: "broken", repair: null}}}, wait('.toast .missing-note'), check("missing-learned")]),
  scene("missing-pdf", "A scanned PDF offers the image model settings", [...search, check("missing-pdf")], {turns: [cause("no_text", "pdf", {resource: "pdf", requirement: "no_text", state: "broken", repair: "vision"})]}),
  scene("missing-media", "Partial media reading retains the missing decoder without an invented setting", [...search, check("missing-media")], {turns: [cause(null, "audio_ffmpeg", {resource: "audio", requirement: "audio_ffmpeg", state: "missing", repair: null}, "ok")]}),
  scene("missing-expired", "Expired attachment recovery wraps inside the real conversation", [member(1), wait('.attachment-file:disabled small')], {turns: [{...turn, steps: [], attachments: [{name: "old.pdf", mime: "application/pdf", size: 300}]}]}),
  scene("missing-mail", "A mail draft with no sender links to the existing store", [member(1), wait('.mail-card .missing-note'), check("missing-mail")], {mailDraft: "draft", missingMail: true}),
  scene("missing-search", "A persisted step keeps a missing SearXNG address visible with its one exact repair", [...search, check("missing-search")], {turns: [turn], missingSearch: true}),
  scene("missing-search-repair", "The step opens the existing SearXNG URL field", [...search, click('[data-missing-repair="search"]'), wait('#svc-url'), check("missing-search-repair")], {turns: [turn], missingSearch: true}),
  scene("missing-vision", "Same-as-answer says why an incompatible image model cannot be used", [...settings("tools"), click('button[data-svc="open"][data-id="vision"]'), wait('#svc-dialog'), click('[data-svc="service"][data-service="same"]'), wait('#svc-dialog .missing-note'), check("missing-vision")], {missingVision: true}),
  scene("missing-model-list", "A signed-in account with no models offers reload and account settings", [...settings("models"), click('.modal-scrim [data-row="quick-model"] .mp-trigger'), wait('.model-chooser'), click('[data-source="cli:codex"]'), wait('[data-dlg="reload"]'), check("missing-model-list")], {missingModelList: true}),
];
