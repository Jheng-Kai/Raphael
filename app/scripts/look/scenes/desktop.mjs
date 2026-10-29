import { scene, click, wait, member, check } from "./steps.mjs";

const entry = [member(1), wait('[data-desktop="open"]:not([hidden])')];
const open = [...entry, click('[data-desktop="open"]'), wait('.desktop-viewer[data-desktop-state="member"]')];
export default [
  scene("desktop-entry", "One accessible desktop icon in the member conversation", [...entry, check("desktop-entry")], { desktop: { state: "running", ready: true, control: "member" } }),
  scene("desktop-viewer", "The container viewer opens inside the conversation's shared dialog", [...open, check("desktop-viewer"), check("desktop-frame")], { desktop: { state: "running", ready: true, control: "member" } }),
  scene("desktop-owner", "Taking control acquires the lease and handing back releases it", [...open, click('[data-dlg="control"]'), wait('.desktop-viewer[data-desktop-state="owner"]'), check("desktop-owner"), check("desktop-frame")], { desktop: { state: "running", ready: true, control: "member" } }),
  scene("desktop-handback", "The member controls the same desktop after the owner hands it back", [...open, click('[data-dlg="control"]'), wait('.desktop-viewer[data-desktop-state="owner"]'), click('[data-dlg="control"]'), wait('.desktop-viewer[data-desktop-state="member"]'), check("desktop-handback"), check("desktop-frame")], { desktop: { state: "running", ready: true, control: "member" } }),
  ...["stopped", "unavailable"].map(state => scene(`desktop-${state}`, "Stopped desktops and unavailable engines show a clear state", [...entry, click('[data-desktop="open"]'), wait(`.desktop-viewer[data-desktop-state="${state}"]`), check("desktop-offline")], { desktop: { state, ready: false, control: "member" } })),
  scene("desktop-absent", "No computer entry when Docker is absent", [member(1), check("desktop-absent")]),
];
