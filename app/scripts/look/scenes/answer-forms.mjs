import { scene, wait, check, room } from "./steps.mjs";
export default [
  ...["forecast", "board", "chart-bar", "chart-line", "invalid", "streaming"].map(kind =>
    scene(`form-${kind}`, `Answer form ${kind} in the real conversation`, [wait(kind === "invalid" || kind === "streaming" ? '.message-code' : `.message-${kind.startsWith("chart") ? "chart" : kind}`), check(`form-${kind}`)], { richReply: `form-${kind}` })),
  scene("form-room", "Group messages share the same answer forms", [room(1), wait('.message-forecast'), wait('.message-board'), wait('.message-chart'), check("form-room")], { richReply: "form-room" }),
];
