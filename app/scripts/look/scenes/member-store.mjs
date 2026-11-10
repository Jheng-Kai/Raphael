import {scene,click,type,wait,member,check,scroll} from "./steps.mjs";
const store = [{action:"member-column",collapsed:false},click('[data-col="add"]'),click('#app-popover [data-pick="member-store"]'),wait(".member-store"),wait(".store-entry")];
const empty = [{action:"member-column",collapsed:false},click('[data-col="add"]'),click('#app-popover [data-pick="member-store"]'),wait(".member-store"),{action:"wait-text",selector:".store-results",text:"商店目前沒有內容"}];
const preview = [...store,click('.store-entry [data-id="research"]'),wait(".template-preview"),check("template-content")];
export default [
  scene("store-home", "Featured catalogue and shared tabs preserve the creation title", [...store,check("creator-tabs"),click('.cr-tabs [data-tab="maker"]'),check("creator-tabs"),click('.cr-tabs [data-tab="store"]'),check("creator-tabs"),check("store-home")]),
  scene("store-category", "Category chips filter locally", [...store,click('[data-category="engineering"]'),check("store-category")]),
  scene("store-search", "Search filters names and summaries locally", [...store,type('[data-store-search]',"文字"),check("store-search")]),
  scene("store-empty", "A catalogue without entries has a calm empty state", [...empty,check("store-empty")], {storeEmpty:true}),
  scene("store-offline", "An unavailable catalogue has a calm empty state", [...empty,check("store-offline")], {storeOffline:true}),
  scene("template-preview", "Full instructions, skills, paused schedules and individual connect cards", [...preview,scroll('.template-preview [data-dlg="connect"]'),check("store-preview")]),
  scene("template-preview-warning", "Third-party and injection notices precede explicit installation", [...preview,check("store-warning")], {storeWarning:true}),
  scene("template-skill-expanded", "The shared disclosure reveals the full skill body without frontmatter", [...preview,click('[data-tpl-skill] [data-card-disclosure]'),check('template-content-expanded')]),
  scene("template-export-review", "Review a private-state-free recipe from the member's template card before saving or publishing it", [member(1),wait('[data-template-card-id="tpl-1"]'),scroll('[data-template-card-id="tpl-1"]'),click('[data-template-card-id="tpl-1"] [data-act="template-view"]'),wait(".template-card-review"),check('template-review-main')], { chatCards: true }),
  scene("template-review-pages", "The review opens each part as Grok Bot's: 內容 and a skill's text, then 例行工作 and one routine's content and trigger", [member(1),wait('[data-template-card-id="tpl-1"]'),scroll('[data-template-card-id="tpl-1"]'),click('[data-template-card-id="tpl-1"] [data-act="template-view"]'),wait(".template-card-review"),click('.tpr [data-tpl-go="context"]'),check('template-review-context'),click('.tpr [data-tpl-go^="skill:"]'),check('template-review-skill'),click('.tpr [data-tpl-back]'),click('.tpr [data-tpl-back]'),click('.tpr [data-tpl-go="routines"]'),click('.tpr [data-tpl-go="routine:0"]'),check('template-review-routine')], { chatCards: true }),
];
