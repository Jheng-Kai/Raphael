import { scene, member, room, wait, click, hover, check, settings, scroll, key, lookCall } from "./steps.mjs";
import { png, mp4, clip, voice } from "../media-fixture.mjs";

// Two pictures a member drew before its words (each is a message the owner can copy and reply to, R-UI-156):
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

// Our own players (R-MEDIA-01): a video a member
// sent, a message of its own (R-MEDIA-02), a sound the owner sent, and files that show a mark by their kind.
const tour = { id: `${"c".repeat(32)}.mp4`, name: "office-tour.mp4", mime: "video/mp4", size: 56034 };
const memo = { id: `${"d".repeat(32)}.m4a`, name: "會議重點.m4a", mime: "audio/mp4", size: 11688 };
const storedFiles = { [tour.id]: { mime: tour.mime, data: clip }, [memo.id]: { mime: memo.mime, data: voice } };
const said = (id, session, question, text, extra) => ({ id, member_id: 1, conversation_id: 11, session_id: session, created_at_ms: 1792807154000,
  question, route: "answer", source: "app", prefix: "", text, status: "done", cost_usd: 0, steps: [], attachments: [], reactions: {},
  messages: [{ seq: 2, kind: "reply", text, at_ms: 1792807160100 }], ...extra });
const videoTurn = said(824, "member-video", "幫我做一段辦公室導覽影片。", "影片做好了，大約三十秒。");
videoTurn.messages.unshift({ seq: 1, kind: "media", text: JSON.stringify({ attachment: tour }), at_ms: 1792807160000 });
const audioTurn = said(825, "owner-audio", "幫我聽這段錄音，整理重點。", "重點有三個：預算、時程和人力。", { attachments: [memo] });
const documents = [["報價單.pdf", "application/pdf"], ["素材.zip", "application/zip"], ["首頁草稿.html", "text/html"]]
  .map(([name, mime], index) => ({ id: `${String(index + 1).repeat(32)}.${name.split(".").pop()}`, name, mime, size: 182000 + index * 9000 }));
const filesTurn = said(826, "owner-files", "這三個檔案幫我看一下。", "看完了：報價單少一頁簽名，其餘沒問題。", { attachments: documents });
const tourOf = '.tn[data-id="824"] .chat-message[data-video]';
const videoOpen = [member(1), wait(`${tourOf} video[src]`), wait(`${tourOf} .mp-length:not(:empty)`)];
const videos = { turns: [videoTurn], storedFiles };
const playFor = ms => ({ ...lookCall("letTimePass"), wait: ms });
const memoOpen = [member(1), wait('.tn[data-id="825"] .attachment-audio .mp-seek:not([disabled])')];
// The pictures of a conversation, opened, left for another member's and opened again: the second open draws them from what the
// window has (R-MEDIA-03). Each mark is set while a conversation without pictures is shown, right before the press.
const mark = label => ({ ...lookCall("mediaMark", label), wait: 0 });
// The same two pictures with a photograph's grain, as heavy as pictures a camera or a model makes (about 2 MB each).
const photos = Object.fromEntries(Object.entries(drawnPictures).map(([id, picture]) => [id, { ...picture, grain: 40 }]));

export default [
  scene("media-models-unset", "Media models default unset, paid API is explicit and absent video stays unavailable", [...settings('models'), scroll('[data-row="video-model"]'), check('media-models-unset'), check('price-parts')], {mediaModels:"unset"}),
  scene("media-models-set", "Explicit drawing and video model rows show their own prices", [...settings('models'), scroll('[data-row="video-model"]'), check('media-models-set'), check('price-parts')], {mediaModels:"set"}),
  scene("media-models-menu", "The drawing picker prices each model by the picture or the request, or not at all, and shows no context length", [...settings('models'), scroll('[data-k="image-model"]'), click('[data-k="image-model"]'), wait('.model-chooser [data-model="google/gemini-image"]'), check('media-models-menu'), check('price-parts')], {mediaModels:"unset"}),
  // The drawing model on the Codex subscription wears OpenAI's mark as a source, in its head and as a row, not a plug or a robot.
  scene("media-models-codex", "Codex's drawing model has OpenAI's mark in the source list, in the head of its models and on its row", [...settings('models'), scroll('[data-k="image-model"]'), click('[data-k="image-model"]'), wait('.model-chooser [data-source="codex"]'), click('.model-chooser [data-source="codex"]'), wait('.model-chooser .mc-row[data-model="@codex:gpt-image-2"]'), check('media-models-codex')], {mediaModels:"unset", mediaCodex:true}),
  scene("generated-image", "A generated picture uses the existing stored image card", [member(1), wait('.ra-body img[data-attachment][src]'), check('generated-image')], {turns:[turn(image)],generatedFile:image,generatedData:png}),
  scene("picture-message", "Each picture a member sends is a message: the react, reply and ⋯ of a reply stand beside it, against the picture, when it is pointed at", [...picturesOpen, check('picture-message'), scroll('.tn[data-id="822"] .chat-message[data-reply]'), hover(`${pictureOf(2)} .attachment-picture`), check('picture-message-hover')], pictures),
  scene("picture-message-menu", "A picture's ⋯ opens the reply's menu, its reactions first, with Reply and 複製圖片", [...picturesOpen, hover(`${pictureOf(1)} .attachment-picture`), click(`${pictureOf(1)} [data-act="more-message"]`), wait('#app-popover [data-pick="copy"]'), check('picture-message-menu')], pictures),
  scene("picture-message-reply", "Replying to a picture quotes it in the composer as the picture: its thumbnail, the author and the word for a picture", [...picturesOpen, hover(`${pictureOf(1)} .attachment-picture`), click(`${pictureOf(1)} [data-act="reply-message"]`), wait('.cmp-quote:not([hidden]) .quote-thumb[src]'), check('picture-message-reply')], pictures),
  scene("room-picture-message", "A member's picture in a group room has its room message's actions beside it, with Copy copying the picture", [room(1), wait(`${roomPicture} img[data-attachment][src]`), hover(`${roomPicture} .attachment-picture`), check('picture-message-room')], { messages: roomMessages, drawnPictures }),
  scene("generated-video", "A generated video uses the existing stored player", [member(1), wait('.ra-body video[data-attachment][src]'), check('generated-video')], {turns:[turn(video)],generatedFile:video,generatedData:mp4}),
  scene("video-message", "A video a member sent stands as a message with our own player at rest: its first frame, the play mark and its length, no browser controls", [...videoOpen, check('video-player-rest')], videos),
  scene("video-message-hover", "Pointing at the video shows our controls: play, the scrubber, the time, sound, speed and full screen", [...videoOpen, hover(`${tourOf} video`), check('video-player-hover')], videos),
  scene("video-message-playing", "A press on the picture plays it: the scrubber shows what was played and what is loaded, and the button pauses", [...videoOpen, click(`${tourOf} video`), wait(`${tourOf} .mp[data-playing]`), playFor(1800), hover(`${tourOf} video`), check('video-player-playing')], videos),
  scene("video-message-space", "Space pauses the focused video part-way; its controls stay while it waits", [...videoOpen, click(`${tourOf} video`), wait(`${tourOf} .mp[data-playing]`), playFor(1200), key(" "), wait(`${tourOf} .mp[data-started]:not([data-playing])`), check('video-player-space')], videos),
  scene("video-full-screen", "The full screen button opens the app's own full screen: the lightbox with the same video and our controls", [...videoOpen, hover(`${tourOf} video`), click(`${tourOf} [data-mp-act="full"]`), wait('.media-lightbox .lb-video video[src]'), check('video-full-screen')], videos),
  // In the app's full screen the speeds once fell below the window, out of sight.
  scene("video-full-screen-speed", "In the app's full screen the speeds open above the controls, every one on screen", [...videoOpen, hover(`${tourOf} video`), click(`${tourOf} [data-mp-act="full"]`), wait('.media-lightbox .lb-video video[src]'), hover('.media-lightbox .lb-video video'), click('.media-lightbox [data-mp-act="rate"]'), wait('#app-popover .menu-choice[data-value="1.5"]'), check('video-full-screen-speed')], videos),
  scene("video-lightbox-playing","F while a video plays carries it into the lightbox where it was, still playing", [...videoOpen, click(`${tourOf} video`), wait(`${tourOf} .mp[data-playing]`), playFor(1200), key("f"), wait('.media-lightbox .lb-video .mp[data-playing]'), playFor(600), hover('.media-lightbox .lb-video video'), check('video-lightbox-playing')], videos),
  scene("video-message-reply", "Replying to a video quotes it as the video: the play mark, the author and 影片", [...videoOpen, hover(`${tourOf} .attachment-video`), click(`${tourOf} [data-act="reply-message"]`), wait('.cmp-quote:not([hidden]) .quote-mark'), check('video-message-reply')], videos),
  scene("audio-message", "A sound the owner sent has our compact row: play, its name over the scrubber and its time, sound and speed", [...memoOpen, check('audio-player-rest')], { turns: [audioTurn], storedFiles }),
  scene("audio-speed-menu", "The speed of a sound is a choice from the app's menu, the current one checked", [...memoOpen, click('.tn[data-id="825"] [data-mp-act="rate"]'), wait('#app-popover .menu-choice[data-value="1.5"]'), check('audio-speed-menu')], { turns: [audioTurn], storedFiles }),
  scene("file-cards", "Files the owner sent show a mark by their kind: a document, an archive and a page", [member(1), wait('.tn[data-id="826"] .attachment-file'), check('file-card-kinds')], { turns: [filesTurn] }),
  scene("media-reopen", "A conversation opened again shows its pictures at once: no call to the shell and no new picture request", [mark("first"), ...picturesOpen, playFor(400), member(2), playFor(800), mark("reopen"), member(1), wait(`${pictureOf(1)} img[data-attachment][src]`), wait(`${pictureOf(2)} img[data-attachment][src]`), playFor(600), check('media-reopen')], { turns: [pictureTurn], drawnPictures: photos, browserCache: true }),
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
