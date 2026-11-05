import {scene,click,type,wait,waitGone,member,settings,scroll,check} from "./steps.mjs";
import automations from "./automations.mjs";

const details = [member(1),{action:"open-details"},wait('[data-routine="91"]')];
const editor = [...details,click('[data-det="routine-open"][data-id="91"]'),wait('.au-routine-dialog')];
const run = [...editor,click('[data-dlg="test"]'),scroll('.au-test')];
const hook = {id:91,member_id:1,title:"範例通知",prompt:"整理通知，只在對話中回報。",schedule:null,when:{webhook:true},enabled:true,last_run:null,next_run:null};
const hookEditor = [...details,click('[data-det="routine-open"][data-id="91"]'),wait('.au-hook-address')];
const slack = automations.find(item=>item.name === "automation-event-channel");
export default [
  ...["running","done","refused"].map(state=>scene(`routine-test-${state}`,`A manual routine test remains truthful while ${state}`,[...run,{action:"wait-text",selector:state === "running" ? '[data-dlg="test"]' : '.au-test-status',text:state === "running" ? "試跑中" : state === "done" ? "成功" : "200"},check(`routine-test-${state}`)],{routineWorkflow:state})),
  scene("routine-test-row-menu","The routine row offers the same test action",[...details,click('[data-det="routine-menu"]'),wait('#app-popover [data-pick="test"]'),check("routine-test-menu")],{routineWorkflow:"done"}),
  scene("routine-test-conversation","A row-menu test delivers its result to the member conversation",[...details,click('[data-det="routine-menu"]'),click('#app-popover [data-pick="test"]'),{action:"wait-text",selector:'.au-test-status',text:"成功"},click('.au-routine-dialog [data-dlg="close"]'),waitGone('.au-routine-dialog'),check("routine-test-conversation")],{routineWorkflow:"done"}),
  scene("routine-when-words","Saved schedule words retain the zone on the routine row",[...details,check("routine-when-words")],{routineWorkflow:"words"}),
  scene("routine-when-editor","The shared editor shows the saved schedule with its zone",[...editor,check("routine-when-editor")],{routineWorkflow:"words"}),
  scene("routine-empty-words","Empty routines explain how to ask in the conversation",[member(1),{action:"open-details"},wait('.mb-panel-routines .mp-empty'),check("routine-empty-words")],{routines:[]}),
  scene("routine-run-history","Run history uses running, succeeded and failed words with the reason",[...editor,wait('[data-run-status="error"]'),scroll('.au-run-history'),check("routine-run-history")],{routineWorkflow:"history"}),
  scene("routine-trigger-recipes","Sentry explains the relay, authentication and actual payload fields",[...hookEditor,scroll('.au-recipe-fields'),click('[data-dlg="hook-header"]'),check("daily-copy"),check("routine-recipe-sentry")],{routines:[hook]}),
  scene("routine-trigger-pagerduty","PagerDuty v3 explains where to paste the URL and custom header",[...hookEditor,click('[data-dlg="recipe"]'),click('#app-popover [data-value="pagerduty"]'),scroll('.au-recipe-fields'),check("routine-recipe-pagerduty")],{routines:[hook]}),
  scene("routine-trigger-slack","A selected Slack channel adds a literal mention or phrase filter",[...slack.steps,type('#au-event-contains','<@U012345>'),click('[data-dlg="event-check"]'),{action:"wait-text",selector:'.au-event-status',text:"已就緒"},check("routine-trigger-slack")]),
  scene("routine-zone","General owns the automatic zone used by new routines",[...settings("general"),wait('[data-k="routine-timezone"]'),check("routine-zone")]),
  scene("routine-zone-search","Zone search accepts a Traditional Chinese city name",[...settings("general"),click('[data-k="routine-timezone"]'),type('#app-popover input','台北'),wait('[data-zone="Asia/Taipei"]'),check("routine-zone-search")]),
  scene("routine-zone-saved","A selected zone persists and can return to automatic detection",[...settings("general"),click('[data-k="routine-timezone"]'),type('#app-popover input','New_York'),click('[data-zone="America/New_York"]'),{action:"wait-text",selector:'[data-k="routine-timezone"]',text:'America/New_York'},check("routine-zone-saved"),click('[data-k="routine-timezone"]'),click('[data-zone=""]'),{action:"wait-text",selector:'[data-k="routine-timezone"]',text:'自動偵測'},check("routine-zone-reset")]),
];
