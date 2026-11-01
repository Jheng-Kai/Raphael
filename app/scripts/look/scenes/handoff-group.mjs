import { scene, wait, click, room, check } from "./steps.mjs";

export default [
  scene("handoff-group", "Ten receipts fold into one quiet line", [wait('[data-handoff-group]'), check("handoff-group")], { handoffGroup: "mixed" }),
  scene("handoff-group-done", "Finished exchanges have no state words", [wait('[data-handoff-group]'), check("handoff-group-done")], { handoffGroup: "done" }),
  scene("handoff-group-many", "Six people name three and count the others", [wait('[data-handoff-group]'), check("handoff-group-many")], { handoffGroup: "many" }),
  scene("handoff-group-long", "Long and unbroken names wrap inside the centred column", [wait('[data-handoff-group]'), check("handoff-group-long")], { handoffGroup: "long" }),
  scene("handoff-group-open", "Disclosures survive work storms and arriving receipts", [wait('[data-handoff-group]'), click('[data-handoff-group] > summary'),
    click('[data-handoff="800"] > summary'), { action: "handoff-arrival" }, check("handoff-group-open")], { handoffGroup: "mixed" }),
  scene("handoff-group-room", "A room message separates consecutive groups", [room(1), wait('.au-room-thread [data-handoff-group]'), check("handoff-group-room")], { handoffGroup: "room" }),
];
