import { scene, member, wait, check } from "./steps.mjs";

export default [
  scene("calm-thread", "Synthetic zh-TW routine failure at 07:00 and owner retry at 08:00", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread")], {calmThread:true}),
  scene("calm-thread-days", "A calm thread crossing two calendar days", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread-days")], {calmThread:"days"}),
];
