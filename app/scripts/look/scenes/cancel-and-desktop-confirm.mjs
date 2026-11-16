import { scene, check, click, hover, key, member, room, wait } from "./steps.mjs";

const arm = [key("Escape"), check("cancel-armed")];
const roomTask = [room(1), wait('.au-room-pane .composer[data-task-state="running"] .cmp-voice')];
const recording = [{action:"main-event",event:{type:"Dictation",phase:"listening",agent:true,member_id:0}}];
const desktop = (name, px, steps, events) => ({...scene(name, "Passive desktop confirmation and cancellation at the native window size", [
  {action:"viewport",width:540,height:Math.round(px*1.3)+(events.some(event=>event.type==="ask")?300:40)}, ...steps,
], {overlayEvents:[{type:"settings",px,subtitles:"on",language:"zh-TW"},...events]}),entry:"overlay.html",ready:"#ask.on, #overlay-stop:not([hidden])"});
const prompt = (long=false) => ({type:"ask",id:"round3-confirmation",tier:"T2",prefix:"問",text:long ?
  "建立每週專案報告\n讀取範例專案的 GitHub 更新與 Notion 專案資料庫，核對本週合併的變更、測試結果及可驗證的進度。\n依專案分別列出已完成事項、仍在處理的工作、阻礙與需要主人決定的問題，保留原始來源連結。\n將整理結果寫入對應的 Notion 紀錄，附上日期與負責成員，並為每個未完成事項記下明確的下一步。\n遇到缺少證據或無法存取的來源時，標示待確認並說明原因，保留現有紀錄供後續核對。" :
  "建立每週專案報告\n每週五下午整理進度並儲存到 Notion。",yes:"是",no:"否",timeout_ms:120000});

export default [
  scene("esc-main-armed", "First Escape arms Stop and typing disarms it", [hover('.composer .cmp-voice'),...arm,key("a"),check("cancel-cleared"),key("Backspace"),...arm], {running:true}),
  scene("esc-member-armed", "The member reply uses the shared gesture", [member(1),hover('.composer .cmp-voice'),...arm], {running:true,runningMember:1}),
  scene("esc-recording-cancel", "One Escape immediately cancels recording without arming Stop", [...recording,key("Escape"),check("cancel-recording-result"),wait('.composer[data-task-state="idle"]')], {stopVoice:true}),
  scene("esc-room-armed", "Room Stop uses the same primary action and cancellation hint", [...roomTask,hover('.composer .cmp-voice'),...arm], {roomThinking:true}),
  ...[120,150,194].flatMap(px=>[false,true].map(long=>desktop(`overlay-confirm-${long?"long":"short"}-${px}`,px,[wait('#ask.on'),check("overlay-confirmation"),check("overlay-confirmation-content"),check("overlay-confirm-without-stop"),...(!long&&px===120?[...arm,key("Escape"),check("cancel-overlay-result"),{action:"overlay-event",event:prompt(false)},wait('#ask.on')]:[]),...(long&&px===150?[...arm]:[])],[prompt(long)]))),
  desktop("overlay-confirm-expanded",194,[wait('#ask.on'),click('#ask-expand'),check("overlay-confirm-without-stop"),check("overlay-confirmation-content"),check("overlay-confirmation"),check("overlay-confirmation-expanded")],[prompt(true)]),
];
