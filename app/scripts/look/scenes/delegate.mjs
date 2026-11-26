import { scene, wait, click, check } from "./steps.mjs";

export default [
  scene("delegate-running", "Sub-workers a member started: one line, its rows open to each goal, model and state", [wait('[data-delegate-group]'), click('[data-delegate-group] > summary'), wait('.delegate-child'), check("delegate-running")], { delegateGroup: "running" }),
  scene("delegate-done", "Finished sub-workers fold into one line with no state words", [wait('[data-delegate-group]'), check("delegate-done")], { delegateGroup: "done" }),
];
