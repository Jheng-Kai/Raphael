import {scene,click,type,wait,member,check,scroll} from "./steps.mjs";
const store = [{action:"member-column",collapsed:false},click('[data-col="add"]'),click('#app-popover [data-pick="member-store"]'),wait(".member-store"),wait(".store-entry")];
const empty = [{action:"member-column",collapsed:false},click('[data-col="add"]'),click('#app-popover [data-pick="member-store"]'),wait(".member-store"),{action:"wait-text",selector:".store-results",text:"商店目前沒有內容"}];
const preview = [...store,click('.store-entry [data-id="research"]'),wait(".template-preview")];
export default [
  scene("store-home", "Featured catalogue and shared tabs preserve the creation title", [...store,check("creator-tabs"),click('.cr-tabs [data-tab="maker"]'),check("creator-tabs"),click('.cr-tabs [data-tab="store"]'),check("creator-tabs"),check("store-home")]),
  scene("store-category", "Category chips filter locally", [...store,click('[data-category="engineering"]'),check("store-category")]),
  scene("store-search", "Search filters names and summaries locally", [...store,type('[data-store-search]',"文字"),check("store-search")]),
  scene("store-empty", "A catalogue without entries has a calm empty state", [...empty,check("store-empty")], {storeEmpty:true}),
  scene("store-offline", "An unavailable catalogue has a calm empty state", [...empty,check("store-offline")], {storeOffline:true}),
  scene("template-preview", "Full instructions, skills, paused schedules and individual connect cards", [...preview,scroll('.template-preview [data-dlg="connect"]'),check("store-preview")]),
  scene("template-preview-warning", "Third-party and injection notices precede explicit installation", [...preview,check("store-warning")], {storeWarning:true}),
  scene("template-export-review", "Review a private-state-free recipe before export or publish", [member(1),{action:"member-column",collapsed:false},click('[data-member-more="1"]'),click('#app-popover [data-pick="export-template"]'),wait(".template-export-review"),check("store-export")]),
];
