import { scene, wait, check, room } from "./steps.mjs";
export default [
  ...["forecast", "board", "chart-bar", "chart-line", "invalid"].map(kind =>
    scene(`form-${kind}`, `Answer form ${kind} in the real conversation`, [wait(kind === "invalid" ? '.message-code' : `.message-${kind.startsWith("chart") ? "chart" : kind}`), check(`form-${kind}`)], { richReply: `form-${kind}` })),
  scene("form-streaming", "A form still arriving is a quiet pending card, never half its JSON", [wait('.answer-form-pending'), check("form-streaming")], { richReply: "form-streaming", richRunning: true }),
  scene("form-truncated", "A reply that ended inside a form keeps its source to read and copy", [wait('.message-code'), check("form-truncated")], { richReply: "form-streaming" }),
  scene("form-room", "Group messages share the same answer forms", [room(1), wait('.message-forecast'), wait('.message-board'), wait('.message-chart'), check("form-room")], { richReply: "form-room" }),
];
