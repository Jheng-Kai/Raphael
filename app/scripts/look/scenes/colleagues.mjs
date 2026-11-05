import {scene,click,type,wait,waitGone,member,settings,check,scroll} from "./steps.mjs";

const maker = [{action:"member-column",collapsed:false},click('[data-col="add"]'),click('#app-popover [data-pick="member"]'),wait(".cr-dialog"),click('[data-dlg="templates"]'),wait(".template-gallery")];
const preview = [...maker,click('[data-dlg="open"]'),wait(".template-preview"),check("template-content")];
const accountFixture = {managedConnectors:[{id:"composio:gmail",kind:"composio",name:"Gmail",description:"整理重要來信與準備回覆",status:"ACTIVE",enabled:true,enabled_tools:["GMAIL_FETCH_EMAILS"],disabled_tools:[],accounts:[{id:"work",status:"ACTIVE",label:"工作信箱 · work@example.test"},{id:"personal",status:"ACTIVE",label:"私人信箱 · personal@example.test"}]}]};
const accounts = [...settings("connections"),click('[data-conn="open"][data-id="composio:gmail"]'),wait(".cs-accts")];
const hookFixture = {routines:[{id:91,member_id:1,title:"表單回覆整理",prompt:"整理表單回覆，只在對話中回報。",schedule:null,when:{webhook:true},enabled:true,last_run:null,next_run:null}]};
const hook = [member(1),{action:"open-details"},wait('[data-routine="91"]'),click('[data-det="routine-open"][data-id="91"]'),wait('.au-hook-address'),click('[data-dlg="tunnel"]'),wait('.au-tunnel')];

export default [
  scene("member-template-gallery","Eight local slime colleague recipes",[...maker,check("colleague-gallery")]),
  scene("member-template-preview","Opening a recipe previews skills, paused routines and separate connect cards",[...preview,check("colleague-preview")]),
  scene("member-template-starter","A local starter uses catalogue brand names without granting a connection",[...maker,click('[data-dlg="starter"][data-index="3"]'),wait('.template-preview'),check('template-content')]),
  scene("member-template-imported","Explicit import creates the colleague with routines off and no app grants",[...preview,type('[data-template-name]',"範例研究夥伴"),click('.template-preview [data-dlg="import"]'),waitGone('.template-preview [data-dlg="import"]'),scroll('.template-preview [data-dlg="connect"]'),check("colleague-imported")]),
  scene("member-template-export","The member menu reviews then exports one private-state-free recipe",[{action:"member-column",collapsed:false},click('[data-member-more="1"]'),click('#app-popover [data-pick="export-template"]'),wait('.template-export-review'),check('template-content'),click('.template-export-review [data-dlg="export"]'),check("colleague-export")]),
  scene("member-greeting-choices","The first message uses the shared answer form with local choices and free text",[member(1),wait('[data-greeting-question]'),check("colleague-greeting")],{colleague:"greeting"}),
  scene("member-greeting-goal","Choosing sends the owner words and the colleague asks one outcome question",[member(1),wait('[data-greeting-option]'),click('[data-greeting-option]'),{action:"wait-text",selector:'.ra-scroll',text:"這些工作希望達成什麼成果"},check("colleague-goal")],{colleague:"greeting"}),
  scene("team-folder-handoff","A colleague handoff can cite context, meetings and project paths",[member(1),{action:"wait-text",selector:'.ra-scroll',text:"/home/cua/team/projects/"},check("colleague-handoff")],{colleague:"handoff"}),
  scene("account-labels","Connections distinguishes work and personal accounts",[...accounts,check("colleague-accounts")],accountFixture),
  scene("account-label-edit","The owner names an exact signed-in account",[...accounts,click('[data-conn="account-label"][data-account="work"]'),wait('[data-account-name]'),type('[data-account-name]',"研究信箱"),click('.mb-dialog [data-dlg="save"]'),waitGone('[data-account-name]'),check("colleague-label-saved")],accountFixture),
  scene("webhook-external","Existing tunnel tools have exact commands and a PC-on reminder",[...hook,scroll('.au-tunnel'),check("colleague-tunnel")],hookFixture),
  scene("webhook-external-tested","A self-post tests the public URL without a job",[...hook,type('[data-tunnel-url]',"https://sample.ts.net"),click('[data-dlg="tunnel-test"]'),{action:"wait-text",selector:'.au-tunnel',text:"已收到自測 POST"},scroll('.au-tunnel'),check("colleague-tunnel-tested")],hookFixture),
  scene("webhook-external-hmac","HMAC authentication shares the one-time key and copy actions",[...hook,click('[data-dlg="hook-show"]'),click('[data-auth="hmac"]'),scroll('.au-tunnel'),check("colleague-tunnel-hmac")],hookFixture),
  scene("output-folder-picker","The native folder picker updates the existing full-path field",[...settings("general"),click('[data-act="output-pick"]'),wait('#owner-output-folder[value="C:\\\\Owner\\\\交付成果"]'),check("colleague-output")],{ownerOutputFolder:true}),
  scene("output-folder-picker-cancel","Cancelling the native folder picker preserves the typed path",[...settings("general"),click('[data-act="output-pick"]'),check("colleague-output-cancel")],{ownerOutputFolder:true,folderCancel:true}),
];
