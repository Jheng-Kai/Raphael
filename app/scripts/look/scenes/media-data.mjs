import { scene, member, room, wait, click, hover, check, settings, scroll } from "./steps.mjs";
import { png, mp4 } from "../media-fixture.mjs";

// Two pictures a member drew before its words (owner, 2026-11-14: each is a message the owner can copy and reply to, R-UI-156):
// a square one and a landscape one, drawn by the mock (`drawnPictures`); the landscape one carries the owner's ❤️.
const square = { id: `${"e".repeat(32)}.png`, name: "office-day.png", mime: "image/png", size: 48211 };
const wide = { id: `${"f".repeat(32)}.png`, name: "office-night.png", mime: "image/png", size: 51630 };
const drawnPictures = {
  [square.id]: { width: 1024, height: 1024, wall: "#e9e4da", window: "#a9c6d9", floor: "#b9a58a", desk: "#6b5a48" },
  [wide.id]: { width: 1280, height: 720, wall: "#2e3440", window: "#d8a657", floor: "#3b3f4a", desk: "#a3896b" },
};
const pictureTurn = { id: 822, member_id: 1, conversation_id: 11, session_id: "member-pictures", created_at_ms: 1792807154000,
  question: "幫我畫兩張辦公室的圖：白天一張、晚上一張。", route: "answer", source: "app", prefix: "", text: "兩張都畫好了：白天的採光比較好，晚上的燈光偏暖。", status: "done", cost_usd: 0,
  steps: [], attachments: [], reactions: { "2": ["❤️"] },
  messages: [{ seq: 1, kind: "media", text: JSON.stringify({ attachment: square }), at_ms: 1792807160000 }, { seq: 2, kind: "media", text: JSON.stringify({ attachment: wide }), at_ms: 1792807160050 },
    { seq: 3, kind: "reply", text: "兩張都畫好了：白天的採光比較好，晚上的燈光偏暖。", at_ms: 1792807160100 }] };
const pictureOf = seq => `.tn[data-id="822"] .chat-message[data-picture][data-message="${seq}"]`;
const picturesOpen = [member(1), wait(`${pictureOf(1)} img[data-attachment][src]`), wait(`${pictureOf(2)} img[data-attachment][src]`)];
const pictures = { turns: [pictureTurn], drawnPictures };
// The same pictures in a group room: the member's room message carries the turn that drew them.
const roomMessages = [
  { id: 1, room_id: 1, member_id: null, text: "@小晴 幫我畫一張辦公室的圖。", created: 1792807110000, status: "done", request_id: null, reply_to: null, turn_id: null, reply_to_member: null, kind: "message" },
  { id: 2, room_id: 1, member_id: 1, text: "畫好了，白天的採光比較好。", created: 1792807140000, status: "done", request_id: null, reply_to: null, turn_id: 823, reply_to_member: null, origin_message_id: 1, kind: "message",
    turn: { id: 823, member_id: 1, status: "done", messages: [{ seq: 1, kind: "media", text: JSON.stringify({ attachment: square }), at_ms: 1792807139000 }, { seq: 2, kind: "reply", text: "畫好了，白天的採光比較好。", at_ms: 1792807140000 }] } },
];
const roomPicture = '[data-room-message="2"] .chat-message[data-picture]';

const file = (extension, mime) => ({ id: `${"b".repeat(32)}.${extension}`, name: `office.${extension}`, mime, size: 1727 });
const image = file("png", "image/png"), video = file("mp4", "video/mp4"), chart = file("svg", "image/svg+xml");
const turn = (attachment, extra = {}) => ({ id: 821, member_id: 1, conversation_id: 11, session_id: "media-data",
  created_at_ms: 1792807154000, question: "請整理辦公室資料，並交付宣傳素材。", route: "answer", source: "app", prefix: "",
  text: "檔案已準備好。", status: "done", cost_usd: 0, steps: [], attachments: [],
  messages: [{seq: 1, kind: "media", text: JSON.stringify({attachment}), at_ms: 1792807160000},
    {seq: 2, kind: "reply", text: "檔案已準備好。", at_ms: 1792807160100}], ...extra });
const missing = kind => {
  const prerequisite = {resource:kind, requirement:`${kind}_generation`,state:"missing",repair:"models"};
  return turn(null, {attachments:[],messages:[{seq:1,kind:"media",text:JSON.stringify({missing:prerequisite}),at_ms:1792807160000}],text:"請先選擇生成模型，費用由 API 供應商另計。",status:"error",
    steps:[{kind:"tool",tool:`${kind}_generate`,server:"media",outcome:"error",reason:"not_configured",missing:prerequisite,ms:20,at_ms:1792807155000}]});
};

export default [
  scene("media-models-unset", "Media models default unset, paid API is explicit and absent video stays unavailable", [...settings('models'), scroll('[data-row="video-model"]'), check('media-models-unset')], {mediaModels:"unset"}),
  scene("media-models-set", "Explicit drawing and video model rows show their own prices", [...settings('models'), scroll('[data-row="video-model"]'), check('media-models-set')], {mediaModels:"set"}),
  scene("media-models-menu", "The existing picker offers image-only models with token, image and request prices", [...settings('models'), scroll('[data-k="image-model"]'), click('[data-k="image-model"]'), wait('.model-chooser [data-model="google/gemini-image"]'), check('media-models-menu')], {mediaModels:"unset"}),
  // The drawing model on the Codex subscription wears OpenAI's mark as a source, in its head and as a row, not a plug or a robot (owner, 2026-11-11).
  scene("media-models-codex", "Codex's drawing model has OpenAI's mark in the source list, in the head of its models and on its row", [...settings('models'), scroll('[data-k="image-model"]'), click('[data-k="image-model"]'), wait('.model-chooser [data-source="codex"]'), click('.model-chooser [data-source="codex"]'), wait('.model-chooser .mc-row[data-model="@codex:gpt-image-2"]'), check('media-models-codex')], {mediaModels:"unset", mediaCodex:true}),
  scene("generated-image", "A generated picture uses the existing stored image card", [member(1), wait('.ra-body img[data-attachment][src]'), check('generated-image')], {turns:[turn(image)],generatedFile:image,generatedData:png}),
  scene("picture-message", "Each picture a member sends is a message: the react, reply and ⋯ of a reply stand beside it, against the picture, when it is pointed at", [...picturesOpen, check('picture-message'), scroll('.tn[data-id="822"] .chat-message[data-reply]'), hover(`${pictureOf(2)} .attachment-picture`), check('picture-message-hover')], pictures),
  scene("picture-message-menu", "A picture's ⋯ opens the reply's menu, its reactions first, with Reply and 複製圖片", [...picturesOpen, hover(`${pictureOf(1)} .attachment-picture`), click(`${pictureOf(1)} [data-act="more-message"]`), wait('#app-popover [data-pick="copy"]'), check('picture-message-menu')], pictures),
  scene("picture-message-reply", "Replying to a picture quotes it in the composer as the picture: its thumbnail, the author and the word for a picture", [...picturesOpen, hover(`${pictureOf(1)} .attachment-picture`), click(`${pictureOf(1)} [data-act="reply-message"]`), wait('.cmp-quote:not([hidden]) .quote-thumb[src]'), check('picture-message-reply')], pictures),
  scene("room-picture-message", "A member's picture in a group room has its room message's actions beside it, with Copy copying the picture", [room(1), wait(`${roomPicture} img[data-attachment][src]`), hover(`${roomPicture} .attachment-picture`), check('picture-message-room')], { messages: roomMessages, drawnPictures }),
  scene("generated-video", "A generated video uses the existing stored player", [member(1), wait('.ra-body video[data-attachment][src]'), check('generated-video')], {turns:[turn(video)],generatedFile:video,generatedData:mp4}),
  scene("dataset-chart", "A dataset chart is a stored downloadable file beside the answer", [member(1), wait('.ra-body .attachment-file'), check('dataset-chart')], {turns:[turn(chart)]}),
  scene("dataset-table", "A continued query uses the existing rich table reply", [member(1),wait('.ra-body .message-table'),check('dataset-table')], {turns:[turn(null,{attachments:[],text:'| 區域 | 合計 |\n|---|---:|\n| 台北 | 36 |\n| 台中 | 24 |',messages:[{seq:1,kind:'reply',text:'| 區域 | 合計 |\n|---|---:|\n| 台北 | 36 |\n| 台中 | 24 |',at_ms:1792807160000}]})]}),
  ...['image','video'].map(kind => scene(`generated-${kind}-missing`, "An absent configured capability names its existing repair", [member(1),wait('.ra-body [data-missing-repair="models"]'),check('generated-missing')], {turns:[missing(kind)]})),
  scene("generated-image-repair", "The missing image capability opens the existing Models settings", [member(1),
    wait('.ra-body [data-missing-repair="models"]'), click('.ra-body [data-missing-repair="models"]'),
    wait('[data-models-tab="models"][aria-selected="true"]'),wait('[data-k="image-model"]:focus'),check('media-models-repair')], {turns:[missing('image')],mediaModels:"unset"}),
  scene("generated-video-repair", "Video repair focuses exactly the video model row", [member(1),wait('.ra-body [data-missing-repair="models"]'),click('.ra-body [data-missing-repair="models"]'),wait('[data-k="video-model"]:focus'),check('media-models-repair')], {turns:[missing('video')],mediaModels:"unset"}),
  scene("generated-video-running", "Video progress keeps the existing running line and Stop", [member(1), wait('.composer[data-task-state="running"]'), check('generated-video-running')], {running:true,runningMember:1,generatedProgress:true,stopBackground:true}),
  scene("generated-video-cancelled", "The existing Stop cancels the video task once", [member(1), wait('.composer[data-task-state="running"] .cmp-voice'),click('.composer[data-task-state="running"] .cmp-voice'),wait('.composer[data-task-state="idle"]'),check('generated-video-cancelled')], {running:true,runningMember:1,generatedProgress:true,stopBackground:true}),
];
