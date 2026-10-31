import { scene, member, room, wait, waitGone, click, type, key } from "./steps.mjs";

const file = { id: `${"a".repeat(32)}.wav`, name: "speech.wav", mime: "audio/wav", size: 16044 };
const turn = (member_id, extra = {}) => ({ id: 801 + member_id, member_id, conversation_id: member_id ? 11 : 1,
  session_id: "look-batch", created_at_ms: 1792807154000, question: "請把這段語音整理成可播放的檔案。", route: "answer", source: "app",
  prefix: "", text: "語音檔已準備好。", status: "done", cost_usd: 0, steps: [], attachments: [file],
  messages: [{seq: 1, kind: "media", text: JSON.stringify({attachment: file}), at_ms: 1792807160000},
    {seq: 2, kind: "reply", text: "語音檔已準備好。", at_ms: 1792807160100}], ...extra });
const missing = {resource: "fish", requirement: "setup", state: "missing", repair: "voice"};
const absent = turn(1, {status: "error", attachments: [], text: "請先設定語音服務。", messages: [{seq: 1, kind: "media", text: JSON.stringify({missing}), at_ms: 1792807160000}],
  steps: [{kind: "tool", tool: "generate_audio", server: "Raphael", outcome: "error", reason: "not_configured", detail: "fish", missing, ms: 20, at_ms: 1792807155000}]});
const openMissing = [member(1), click('.page-agent:not([hidden]) [data-act="thinking"]'), wait('.step-list [data-missing-repair="voice"]')];

export default [
  ...[0, 1].map(id => scene(`generated-audio-${id ? "member" : "chief"}`, "Generated audio shares the owner's existing stored audio card", [member(id), wait('.ra-body .attachment-audio'), wait('.ra-body [data-audio-progress]:not([disabled])')], {turns: [turn(id)], audioFile: file})),
  scene("generated-audio-room", "Room replies play the same stored audio card", [room(1), wait('.ra-body [data-audio-progress]:not([disabled])')],
    {audioFile: file, messages: [{id: 901, room_id: 1, member_id: 1, text: "語音檔已準備好。", created: 1792807160000, status: "done", kind: "message", turn_id: 802, turn: turn(1)}]}),
  scene("generated-audio-missing", "Missing voice service states the repair in the failed generation step", openMissing, {turns: [absent]}),
  scene("generated-audio-repair", "Audio generation opens the existing voice service settings", [...openMissing, click('.step-list [data-missing-repair="voice"]'), wait('#svc-voice-id')], {turns: [absent]}),
  scene("owner-addition", "An owner addition appears immediately beside continuing work and Stop", [member(1), type('.cmp-input', "也請保留原始檔案。"), key("Enter"), wait('.tn[data-id="901"] .owner-message'), waitGone('.tn[data-id="901"] .ra-face'), wait('.composer[data-task-state="running"]')],
    {running: true, runningMember: 1, ownerAddition: true}),
];
