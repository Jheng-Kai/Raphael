import { scene, click, wait, member, settings, scroll, check } from "./steps.mjs";
const computer = (state = "running") => ({ running:"fresh", runningMember:1, desktop:{ state:"running", ready:true, control:"member", works:[
  {id:"private-computer-task",request_id:"private-takeover-request",turn_id:2,state,tool:"get_desktop_state",reason:state === "waiting_control" ? "sign_in" : ""},
]} });
const entry = [member(1), wait('.desktop-panel:not([hidden])'), wait('.desktop-panel[data-desktop-state="member"]'), wait('.desktop-screen iframe:not([hidden])')];
const take = [...entry, click('[data-desktop="take"]'), wait('.desktop-panel[data-interactive="true"][data-control-latency-ms]')];
export default [
  scene("desktop-panel", "One live computer in the existing member side panel with only a system event in chat", [...entry,check("computer-panel"),check("desktop-frame")],computer()),
  scene("desktop-takeover", "A private sign-in need opens the side panel with its request above the live screen", [...entry,check("computer-takeover")],computer("waiting_control")),
  scene("desktop-takeover-owner", "Clicking the screen enables input in place with the same frame and stream", [...take,check("computer-takeover-owner"),check("desktop-frame")],computer("waiting_control")),
  scene("desktop-takeover-done", "One explicit done returns the current request once", [...take,click('[data-desktop="return"]'),wait('.desktop-panel[data-desktop-state="member"]'),check("computer-takeover-done")],computer("waiting_control")),
  scene("desktop-entry", "Computer section opens automatically in a working member conversation", [...entry,check("computer-panel")],computer()),
  scene("desktop-viewer", "Expand the existing stream without a new dialog or session", [...entry,click('[data-desktop="expand"]'),wait('.desktop-panel[data-expanded]'),{action:"settle-motion"},check("desktop-viewer"),check("desktop-frame")],computer()),
  scene("desktop-owner", "A screen click acquires the lease immediately without a reconnect", [...take,check("desktop-owner"),check("desktop-frame")],computer()),
  scene("desktop-handback", "Hand back preserves the stream and clears interactive input", [...take,click('[data-desktop="return"]'),wait('.desktop-panel[data-interactive="false"]'),check("desktop-handback")],computer()),
  ...["stopped","unavailable","starting","building","preparing"].map(state=>scene(`desktop-${state}`, "Desktop preparation and contextual retry in the existing side panel", [member(1),click('[data-act="computer"]'),wait(`.desktop-panel[data-desktop-state="${state}"]`),check("desktop-offline")], {desktop:{state,ready:false,control:"member",...(state === "building" ? {progress:"#3 [2/4] Installing desktop tools"} : {}),...(state === "unavailable" ? {error:"docker_start_timeout"} : {})}})),
  scene("desktop-absent", "Docker absent has no computer section", [member(1),check("desktop-absent")]),
  scene("desktop-install", "Absent Docker keeps the existing download action", [...settings("agent"),scroll('[data-act="docker-download"]'),check("desktop-install")]),
];
