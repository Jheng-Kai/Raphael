import { scene, click, hover, check, page, member, room, type, wait, paste, stableClick, settings, key, waitGone } from "./steps.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import settingsScenes from "./settings.mjs";
import presenceScenes from "./presence.mjs";
import desktopScenes from "./desktop.mjs";
import automationScenes from "./automations.mjs";
const fixture=JSON.parse(readFileSync(join(import.meta.dirname, '../fixture.json'),'utf8'));
const input='.page-agent .mb-chat:not([hidden]) .cmp-input';
const marks={appsInventory:{state:'complete',count:3,apps:['GitHub','Notion','Slack'].map((name,i)=>({id:`sample-${i}`,name,connected:true,enabled:true,state:'ready',tools:1,last_used_at:3-i}))}};
const faces=count=>({rooms:fixture.rooms.map(item=>({...item,member_ids:item.id===1?[0,1,2,3].slice(0,count):item.member_ids})),members:fixture.members.map(item=>({...item,avatar:{1:'slime:diablo',2:'slime:rigurd',3:'slime:shion'}[item.id]??item.avatar}))});

export default [
  scene('daily-footer-hover','Connections pill has an outlined quiet hover',[{action:'member-column',collapsed:false},hover('.sidebar-apps'),check('sidebar-shell')]),
  scene('daily-footer-marks','Three connected service marks share the outlined door',[{action:'member-column',collapsed:false},wait('.sidebar-app-marks .mono'),check('daily-marks'),check('sidebar-shell')],marks),
  scene('daily-footer-home','Home retains the selected icon surface',[page('home'),{action:'member-column',collapsed:false},check('sidebar-shell'),check('sidebar-selection')]),
  scene('daily-press-feedback','Ordinary and selected sidebar controls answer a press without moving',[
    page('agent'),{action:'member-column',collapsed:false},
    {action:'press-feedback',selectors:['.sidebar-apps','.sidebar-account','.sidebar-dictation','.sidebar-home','.mb-chief']},
    hover('.mb-chat:not([hidden]) .ra .chat-message'),
    {action:'press-feedback',selectors:['.mb-chat:not([hidden]) .ra [data-act="copy-message"]']},
    type(input,'Press feedback sample'),
    {action:'press-feedback',selectors:['.mb-chat:not([hidden]) .cmp-attach','.mb-chat:not([hidden]) .cmp-send','.mb-chat:not([hidden]) .cmp-mode','.mb-chat:not([hidden]) .conversation-trigger']},
    room(1),{action:'press-feedback',selectors:['[data-room="1"]']},
    page('home'),{action:'press-feedback',selectors:['.sidebar-home']},
    page('dictation'),{action:'press-feedback',selectors:['.sidebar-dictation']},
  ]),
  scene('daily-press-surfaces','Quiet Home, connections and calendar controls retain visible stationary press feedback',[
    page('home'),{action:'press-feedback',selectors:[{selector:'.ho-target',x:.02,y:.02},'.ho-row','.ho-calendar .btn.icon','.ho-date-btn']},
    ...settings('connections'),{action:'press-feedback',selectors:['.cs-open']},
    click('[data-conn="tab"][data-id="store"]'),wait('.cs-card'),{action:'press-feedback',selectors:['.cs-main']},
    key('Escape'),waitGone('.modal-scrim:not([hidden])'),
    ...automationScenes.find(item=>item.name==='automations-sparse').steps,
    {action:'calendar-tools'},
    {action:'press-feedback',selectors:['.au-month-grid .btn[aria-pressed="true"]','.au-month-grid .btn[aria-current="date"]']},
    key('Escape'),
    ...settingsScenes.find(item=>item.name==='model-choices-stt').steps,
    {action:'press-feedback',selectors:['.mc-source:not([aria-pressed="true"])','.mc-source[aria-pressed="true"]']},
  ]),
  (()=>{const source=presenceScenes.find(item=>item.name==='event-routine-line');return {...source,name:'daily-press-event',description:'An event receipt answers a press without opening during measurement',steps:[...source.steps,{action:'press-feedback',selectors:['.mb-chat:not([hidden]) .btn.event-open']}]};})(),
  scene('daily-press-card','A conversation card primary action answers before its asynchronous work',[page('agent'),wait('[data-permission-card]'),{action:'press-feedback',selectors:['[data-act="perm-once"]']}],{permissionCard:'tool'}),
  (()=>{const source=desktopScenes.find(item=>item.name==='panel-screen-routines');return {...source,name:'daily-press-desktop',description:'Desktop preview controls answer without changing geometry',steps:[...source.steps,{action:'press-feedback',selectors:['.desktop-hit']}]};})(),
  scene('daily-newest','A new window opens recent activity rather than the stable default',[page('agent'),check('daily-newest')],{conversations:[
    {id:1,member_id:0,title:'Older sample',kind:'standard',is_default:1,created_at_ms:1,updated_at_ms:1},
    {id:77,member_id:0,title:'Newest sample',kind:'standard',is_default:0,created_at_ms:2,updated_at_ms:20},
    {id:4,member_id:0,title:'Quick sample',kind:'quick',is_default:0,created_at_ms:3,updated_at_ms:100},
  ]}),
  scene('daily-folder-heading','Pressing the group name folds its existing body',[{action:'member-column',collapsed:false},click('[data-group="1"] .mb-gname'),check('sidebar-folded')]),
  ...['chief','member','room'].map(kind=>scene(`daily-copy-${kind}`,'Copy answers in the same control with a tick',[
    ...(kind==='room'?[room(1)]:kind==='member'?[member(1)]:[page('agent')]),
    hover(kind==='room'?'.au-room-thread .ra .chat-message':'.mb-chat:not([hidden]) .ra .chat-message'),
    click(kind==='room'?'.au-room-thread .ra [data-room-act="copy-message"], .au-room-thread .ra [data-act="copy-message"]':'.mb-chat:not([hidden]) .ra [data-act="copy-message"]'),check('daily-copy'),
  ])),
  scene('daily-copy-setup','A copy control with words keeps its bounds and answers in place',[
    ...settingsScenes.find(item=>item.name==='plugins-setup-own-app').steps.filter(step=>step.action!=='check'),
    stableClick('.cn-setup-dialog [data-dlg="copy"]'),check('daily-copy'),
  ]),
  (()=>{const source=automationScenes.find(item=>item.name==='automation-webhook-address-changed');return {...source,name:'daily-copy-webhook',description:'A masked webhook secret copies on its existing button and retains its address notice',steps:[...source.steps,stableClick('[data-dlg="hook-copy"]'),check('daily-copy'),check('moving-webhook-changed')]};})(),
  scene('daily-draft-member','A member draft waits through other conversations and Home',[
    member(1),type(input,'Unfinished sample draft'),member(2),type(input,'Another sample draft'),member(1),page('home'),member(1),check('daily-draft-member'),
  ]),
  scene('daily-draft-room','Room words wait through another room and member',[
    room(1),type('#room-message','Unfinished sample draft'),room(2),type('#room-message','Another room draft'),member(1),room(1),check('daily-draft-room'),
  ]),
  ...['chief','room'].map(kind=>scene(`daily-paste-${kind}`,'A 200,000 character paste becomes one normal file chip without a long task',[
    ...(kind==='room'?[room(1)]:[page('agent')]),{action:'composer-measure-start'},paste(kind==='room'?'#room-message':input,{text:'x'.repeat(200000)}),wait(kind==='room'?'.au-room-pane .cmp-chip':'.mb-chat:not([hidden]) .cmp-chip'),{action:'composer-measure-end',selector:kind==='room'?'#room-message':input},
  ])),
  scene('daily-long-draft','A stored long draft restores without a long task',[{action:'composer-restore-long'},{action:'reload'},{action:'composer-measure-start'},{...page('agent'),measure:{name:'long-draft-restore',budgetMs:100,maxLongTaskMs:100}},{action:'composer-measure-end',selector:input,longDraft:true}]),
  ...[2,3,4].map(count=>scene(`daily-faces-${count}-rail`,'Bare participant faces retain marks and rail centring',[room(1),{action:'member-column',collapsed:false},click('[data-sidebar="collapse"]'),check('sidebar-room-avatar'),check('sidebar-rail')],faces(count))),
  ...[2,3,4].map(count=>scene(`daily-faces-${count}`,'The sidebar cluster and single header row retain hats and horns',[room(1),{action:'member-column',collapsed:false},check('sidebar-room-avatar'),check('sidebar-shell')],faces(count))),
];
