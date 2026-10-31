import { scene, click, wait, member, settings, scroll, check, type, key } from "./steps.mjs";
const computer = (state = "running") => ({ running:"fresh", runningMember:1, desktop:{ state:"running", ready:true, control:"member", works:[
  {id:"private-computer-task",request_id:"private-takeover-request",turn_id:2,state,tool:"get_desktop_state",reason:state === "waiting_control" ? "sign_in" : ""},
]} });
const entry = [member(1), wait('.desktop-panel:not([hidden])'), wait('.desktop-panel[data-desktop-state="member"]'), wait('.desktop-screen iframe:not([hidden])')];
const take = [...entry, click('[data-desktop="take"]'), wait('.desktop-panel[data-interactive="true"][data-control-latency-ms]')];
const teachComputer = () => ({desktop:{state:'running',ready:true,control:'member'}});
const teaching = [member(1),click('[data-act="computer"]'),wait('.desktop-screen iframe:not([hidden])'),click('[data-desktop="teach"]'),wait('.desktop-recording:not([hidden])')];
const draft = [...teaching,click('[data-desktop="teach"]'),wait('.desktop-review #mp-skill-text')];
export default [
  scene('desktop-teach-recording','Owner demonstration records only the member computer with a visible privacy line',[...teaching,check('teach-recording')],teachComputer()),
  scene('desktop-teach-draft','Stopping opens the existing unsaved editable skill document',[...draft,check('teach-draft')],teachComputer()),
  scene('desktop-teach-saved','Explicit save offers a new input in the same conversation',[...draft,click('[data-res="skill-save"]'),wait('.desktop-try:not([hidden])'),type('[data-teach-input]','第二季報告'),check('teach-saved')],teachComputer()),
  scene('desktop-teach-try','The saved skill and fresh input enter the existing conversation',[...draft,click('[data-res="skill-save"]'),wait('.desktop-try:not([hidden])'),type('[data-teach-input]','第二季報告'),click('[data-desktop="try-teach"]'),wait('[data-desktop="teach"]:not([disabled])'),check('teach-try')],teachComputer()),
  scene('desktop-teach-discard','One press discards the owner recording and returns control',[...teaching,click('[data-desktop="discard-teach"]'),wait('[data-desktop="teach"]:not([disabled])'),check('teach-discard')],teachComputer()),
  scene('desktop-teach-shared','A shared computer visibly explains the separate member computer requirement',[member(1),click('[data-act="computer"]'),wait('.desktop-teach-missing:not([hidden])'),check('teach-shared')],{desktop:{state:'running',ready:true,control:'member',teach_available:false}}),
  scene("desktop-host-remote", "Select another computer and persist its SSH config alias", [...settings("agent"),scroll('[data-k="computer-host"]'),click('[data-k="computer-host"]'),click('.menu [data-value="remote"]'),type('#computer-ssh-alias','studio-mini'),key('Tab'),wait('#computer-ssh-alias'),check("host-settings-remote")]),
  scene("desktop-host-invalid", "Invalid SSH aliases stay in the field with a contextual error", [...settings("agent"),scroll('[data-k="computer-host"]'),click('[data-k="computer-host"]'),click('.menu [data-value="remote"]'),type('#computer-ssh-alias','-oBad'),key('Tab'),wait('#computer-ssh-alias[aria-invalid="true"]'),check("host-settings-invalid")]),
  scene("desktop-collapse", "Collapse the member frame without handing back or reconnecting", [...entry,click('[data-desktop="collapse"]'),check("host-panel-collapsed")],computer()),
  scene("desktop-panel", "One live computer in the existing member side panel with only a system event in chat", [...entry,check("computer-panel"),check("desktop-frame")],computer()),
  scene("desktop-takeover", "A private sign-in need opens the side panel with its request above the live screen", [...entry,check("computer-takeover")],computer("waiting_control")),
  scene("desktop-takeover-owner", "Clicking the screen enables input in place with the same frame and stream", [...take,check("computer-takeover-owner"),check("desktop-frame")],computer("waiting_control")),
  scene("desktop-takeover-done", "One explicit done returns the current request once", [...take,click('[data-desktop="return"]'),wait('.desktop-panel[data-desktop-state="member"]'),check("computer-takeover-done")],computer("waiting_control")),
  scene("desktop-entry", "Computer section opens automatically in a working member conversation", [...entry,check("computer-panel")],computer()),
  scene("desktop-viewer", "Expand the existing stream without a new dialog or session", [...entry,click('[data-desktop="expand"]'),wait('.desktop-panel[data-expanded]'),{action:"settle-motion"},check("desktop-viewer"),check("desktop-frame")],computer()),
  scene("desktop-owner", "A screen click acquires the lease immediately without a reconnect", [...take,check("desktop-owner"),check("desktop-frame")],computer()),
  scene("desktop-handback", "Hand back preserves the stream and clears interactive input", [...take,click('[data-desktop="return"]'),wait('.desktop-panel[data-interactive="false"]'),check("desktop-handback")],computer()),
  ...["stopped","unavailable","starting","building","preparing"].map(state=>scene(`desktop-${state}`, "Desktop preparation and contextual retry in the existing side panel", [member(1),click('[data-act="computer"]'),wait(`.desktop-panel[data-desktop-state="${state}"]`),check("desktop-offline")], {desktop:{state,ready:false,control:"member",...(state === "building" ? {progress:"#3 [2/4] Installing desktop tools"} : {}),...(state === "unavailable" ? {error:"docker_start_timeout"} : {})}})),
  scene("desktop-absent", "Docker absent keeps the computer entry with a visible reason and repair", [member(1),click('[data-act="computer"]'),wait('.desktop-panel .missing-note'),check("desktop-absent")]),
  scene("desktop-install", "Absent Docker keeps the existing download action", [...settings("agent"),scroll('[data-act="docker-download"]'),check("desktop-install")]),
];
