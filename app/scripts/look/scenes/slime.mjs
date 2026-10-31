import { scene, click, check, member, wait } from "./steps.mjs";

const doing = (member_id, state) => ({ action: "main-event", event: { type: "MemberActivity", member_id, state } });

export default [
  { ...scene("slime-states", "Each member's slime moves with what that member is doing", [{ action: "member-column", collapsed: false }, doing(1, "thinking"), doing(2, "working"), doing(3, "computer"), check("slime-states"), { action: "freeze-motion", at: 450 }]), motion: true },
  scene("slime-picker", "A member's slime is a character or a colour, tried in a menu that stays open", [member(1), { action: "open-details" }, wait(".mb-det:not([hidden])"), click(".mb-avbtn"), wait(".mb-avpop"), click('.mb-avpop [data-slime-color="coral"]'), click('.mb-avpop [data-slime-character="shion"]'), check("slime-picker")]),
];
