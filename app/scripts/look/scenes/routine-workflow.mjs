import {scene,click,type,wait,member,settings,check} from "./steps.mjs";

// A routine is read in the panel and made or changed by its member in the conversation (owner, 2026-11-09): what stays
// here is how its schedule reads and the zone new routines use.
const details = [member(1),{action:"open-details"},wait('[data-routine="91"]')];
export default [
  scene("routine-when-words","Saved schedule words retain the zone on the routine row",[...details,check("routine-when-words")],{routineWorkflow:"words"}),
  scene("routine-empty-words","Empty routines explain how to ask in the conversation",[member(1),{action:"open-details"},wait('.mb-panel-routines .mp-empty'),check("routine-empty-words")],{routines:[]}),
  scene("routine-zone","General owns the automatic zone used by new routines",[...settings("general"),wait('[data-k="routine-timezone"]'),check("routine-zone")]),
  scene("routine-zone-search","Zone search accepts a Traditional Chinese city name",[...settings("general"),click('[data-k="routine-timezone"]'),type('#app-popover input','台北'),wait('[data-zone="Asia/Taipei"]'),check("routine-zone-search")]),
  scene("routine-zone-saved","A selected zone persists and can return to automatic detection",[...settings("general"),click('[data-k="routine-timezone"]'),type('#app-popover input','New_York'),click('[data-zone="America/New_York"]'),{action:"wait-text",selector:'[data-k="routine-timezone"]',text:'America/New_York'},check("routine-zone-saved"),click('[data-k="routine-timezone"]'),click('[data-zone=""]'),{action:"wait-text",selector:'[data-k="routine-timezone"]',text:'自動偵測'},check("routine-zone-reset")]),
];
