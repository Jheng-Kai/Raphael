import { scene, click, wait, member, settings, scroll, check } from "./steps.mjs";

const entry = [member(1), wait('[data-desktop="open"]:not([hidden])')];
const open = [...entry, click('[data-desktop="open"]'), wait('.desktop-viewer[data-desktop-state="member"]')];
const computer = (state = "running") => ({ running: "fresh", runningMember: 1, desktop: { state: "running", ready: true, control: state === "waiting_control" ? "owner" : "member", works: [
  { id: "private-computer-task", request_id: "private-takeover-request", turn_id: 2, state, tool: "get_desktop_state", reason: state === "waiting_control" ? "sign_in" : "" },
] } });
const inline = [...entry, wait('[data-desktop-work]')];
export default [
  scene("desktop-inline", "One live read-only computer card in the task's private conversation", [...inline, wait('.desktop-preview iframe'), check("computer-inline")], computer()),
  scene("desktop-takeover", "A private typed sign-in request with one owner action and no secret field", [...inline, check("computer-takeover")], computer("waiting_control")),
  scene("desktop-takeover-owner", "The takeover card opens the existing viewer with owner control", [...inline, click('[data-desktop-card-open]'), wait('.desktop-viewer[data-desktop-state="owner"]'), check("computer-takeover-owner"), check("desktop-frame")], computer("waiting_control")),
  scene("desktop-takeover-done", "An explicit done returns control to the same task and updates its single card", [...inline, click('[data-desktop-card-open]'), wait('.desktop-viewer[data-desktop-state="owner"]'), click('[data-dlg="control"]'), wait('.desktop-viewer[data-desktop-state="member"]'), check("computer-takeover-done")], computer("waiting_control")),
  scene("desktop-entry", "One accessible desktop icon in the member conversation", [...entry, check("desktop-entry")], { desktop: { state: "running", ready: true, control: "member" } }),
  scene("desktop-viewer", "The container viewer opens inside the conversation's shared dialog", [...open, check("desktop-viewer"), check("desktop-frame")], { desktop: { state: "running", ready: true, control: "member" } }),
  scene("desktop-owner", "Taking control acquires the lease and handing back releases it", [...open, click('[data-dlg="control"]'), wait('.desktop-viewer[data-desktop-state="owner"]'), check("desktop-owner"), check("desktop-frame")], { desktop: { state: "running", ready: true, control: "member" } }),
  scene("desktop-handback", "The member controls the same desktop after the owner hands it back", [...open, click('[data-dlg="control"]'), wait('.desktop-viewer[data-desktop-state="owner"]'), click('[data-dlg="control"]'), wait('.desktop-viewer[data-desktop-state="member"]'), check("desktop-handback"), check("desktop-frame")], { desktop: { state: "running", ready: true, control: "member" } }),
  ...["stopped", "unavailable", "starting", "building", "preparing"].map(state => scene(`desktop-${state}`, "Desktop preparation has progress and failures have an enabled retry", [...entry, click('[data-desktop="open"]'), wait(`.desktop-viewer[data-desktop-state="${state}"]`), check("desktop-offline")], { desktop: { state, ready: false, control: "member", ...(state === "building" ? { progress: "#3 [2/4] Installing desktop tools" } : {}), ...(state === "unavailable" ? { error: "docker_start_timeout" } : {}) } })),
  scene("desktop-absent", "No computer entry when Docker is absent", [member(1), check("desktop-absent")]),
  scene("desktop-install", "Absent Docker has one download action in the existing computer settings", [...settings("agent"), scroll('[data-act="docker-download"]'), wait('[data-act="docker-download"]'), check("desktop-install")]),
];
