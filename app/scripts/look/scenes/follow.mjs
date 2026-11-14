import { scene, member, wait } from "./steps.mjs";

// The owner reads a member's conversation at its bottom while the member answers (owner, 2026-11-14: 「成員回覆的時候，有時候
// 畫面會從最底部往上跳一點…完全不要有任何移動」, R-FOLLOW-01). `follow-probe` samples every painted frame (follow-probe.mjs).
const now = 1792807200000;
const topics = ["產品時程", "首頁版面", "客服流程", "行銷活動", "測試名單", "會議紀錄", "預算分配", "招募進度", "合作夥伴", "使用者訪談", "季度目標", "文件整理", "上線檢查", "回饋整理"];
const turn = (topic, index, extra = {}) => {
  const text = `${topic}已經整理好了：先確認負責人和期限，再把還沒決定的地方列出來。\n\n下一步請在週五前回覆，我會把結果補進本週的摘要。`;
  const at = now - (topics.length - index) * 300000;
  return { id: 3000 + index, session_id: `follow-${index}`, member_id: 1, conversation_id: 11, created_at_ms: at, question: `幫我整理${topic}的重點。`, route: "answer", source: "app",
    prefix: "答", text, detail: null, status: "done", cost_usd: 0, model: "openai/gpt-6-sol", steps: [], attachments: [], reactions: {}, pages: [], task: null,
    messages: [{ seq: 1, kind: "reply", text, at_ms: at + 20000 }], ...extra };
};
const thread = topics.map((topic, index) => turn(topic, index));
// Pictures the core reads back late (`pictureLate`): the reply's sketch, and two large ones in the newest turn of the opening scene.
const sketch = `${"c".repeat(32)}.png`, strip = `${"d".repeat(32)}.png`, square = { id: `${"e".repeat(32)}.png`, name: "白天的辦公室.png", mime: "image/png", size: 48211 }, wide = { id: `${"f".repeat(32)}.png`, name: "晚上的辦公室.png", mime: "image/png", size: 51630 };
const drawnPictures = {
  [sketch]: { width: 1200, height: 800, wall: "#e9e4da", window: "#a9c6d9", floor: "#b9a58a", desk: "#6b5a48" },
  [strip]: { width: 360, height: 40, wall: "#dfe7ee", window: "#7aa6c2", floor: "#c9d6df", desk: "#4f6d7a" },
  [square.id]: { width: 1024, height: 1024, wall: "#e9e4da", window: "#a9c6d9", floor: "#b9a58a", desk: "#6b5a48" },
  [wide.id]: { width: 1280, height: 720, wall: "#2e3440", window: "#d8a657", floor: "#3b3f4a", desk: "#a3896b" },
};
const replying = { turns: thread, drawnPictures, pictureLate: 700, askUntilAnswered: true };
const pictured = [...thread.slice(0, -1), turn(topics.at(-1), topics.length - 1, {
  question: "幫我畫兩張辦公室的圖：白天一張、晚上一張。", text: "兩張都畫好了：白天的採光比較好，晚上的燈光偏暖。",
  messages: [{ seq: 1, kind: "media", text: JSON.stringify({ attachment: square }), at_ms: now - 280000 }, { seq: 2, kind: "media", text: JSON.stringify({ attachment: wide }), at_ms: now - 279950 },
    { seq: 3, kind: "reply", text: "兩張都畫好了：白天的採光比較好，晚上的燈光偏暖。", at_ms: now - 279900 }] })];
const newest = `.tn[data-id="${3000 + topics.length - 1}"]`;
const probe = options => ({ action: "follow-probe", ...options });

export default [
  { ...scene("follow-reply-bottom", "Read at its bottom, a member's reply as it arrives (the owner's message, the work line, growing words, a late picture, the end of the work, paced bubbles, a reaction) keeps the thread at its bottom in every frame",
    [member(1), wait(newest), probe({ position: "bottom" }), wait('.tn[data-id="400000"] img[data-attachment][src]')], replying), motion: true },
  { ...scene("follow-reply-reading", "Read higher up, the same reply never moves the line the owner reads",
    [member(1), wait(newest), probe({ position: "up" })], replying), motion: true },
  { ...scene("follow-reply-near", "Read a little above the bottom (inside the 80 px a thread once counted as its bottom), the reply never pulls the owner back down",
    [member(1), wait(newest), probe({ position: "up", wheel: 40 })], replying), motion: true },
  { ...scene("follow-open-pictures", "A conversation that opens with large pictures still on their way stays at its bottom as they load",
    [probe({ open: 1, reply: false, waitFor: `${newest} img[data-attachment]` }), wait(`${newest} .chat-message[data-picture] img[data-attachment][src]`)],
    { turns: pictured, drawnPictures, pictureLate: 700 }), motion: true },
];
