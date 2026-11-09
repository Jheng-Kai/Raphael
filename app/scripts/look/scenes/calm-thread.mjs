import { scene, member, wait, check } from "./steps.mjs";

export default [
  scene("calm-thread", "Synthetic zh-TW routine failure at 07:00 and owner retry at 08:00", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread")], {calmThread:true}),
  scene("calm-thread-days", "A calm thread crossing two calendar days", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread-days")], {calmThread:"days"}),
  scene("chat-usage-limit", "A reply that failed on ChatGPT's usage limit leads with Manage usage under its words", [member(1), wait('[data-act="manage-usage"]'), check("chat-usage-limit")], {usageLimit:true}),
];
