import { scene, member, wait, click, check, settings, scroll } from "./steps.mjs";
import { png, mp4 } from "../media-fixture.mjs";

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
  scene("generated-image-bill", "The work step names the drawing model and its separate API cost", [member(1),wait('.work-toggle[data-act="thinking"]'),click('.work-toggle[data-act="thinking"]'),wait('.step-list .step-detail'),check('generated-media-bill')],
    {turns:[turn(image,{steps:[{kind:"tool",tool:"image_generate",server:"media",outcome:"ok",ms:900,at_ms:1792807160000,detail:JSON.stringify({model:"google/gemini-image",cost_usd:.042})}]})],generatedFile:image,generatedData:png}),
  scene("generated-image", "A generated picture uses the existing stored image card", [member(1), wait('.ra-body img[data-attachment][src]'), check('generated-image')], {turns:[turn(image)],generatedFile:image,generatedData:png}),
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
