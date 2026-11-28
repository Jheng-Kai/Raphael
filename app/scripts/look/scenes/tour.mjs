import { scene, click, type, wait, waitGone, check, key, pressAt, sideButton, waitCall } from "./steps.mjs";

const returning = { start: "app", tourUnanswered: true };
const firstRun = { onboarding: true, tourUnanswered: true };
const OFFER = '.tour[data-mode="offer"]';
const BYE = '.tour[data-mode="bye"]';
const NEXT = '.tour [data-tour="next"]';
const BACK = '.tour [data-tour="back"]';
const START = '.tour [data-tour="start"]';
const SKIP = '.tour [data-tour="skip"]';
const CLOSE = '.tour [data-tour="close"]';
const FINISH = '.tour [data-tour="done"]';
const CONFIRM = '.tour-confirm > .mb-confirm';
const CONFIRM_ACTION = CONFIRM + ' [data-dlg="delete"]';
const SAVE = waitCall("device_settings_set", "tour_offered");
const agent = ".page-agent:not([hidden]) .composer";
const pickFirstSlime = [click('.ob-first-picker [data-slime-tab="red"]'), click('.ob-first-picker [data-slime-character="horns-red"]')];
const guide = [click('[data-ob="next"]'), wait('#ob-first-name'), type('#ob-first-name', '小藍'), ...pickFirstSlime, click('[data-ob="next"]'),
  click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-ob="next"]'), wait(".page-agent:not([hidden]) .conversation-trigger")];

const steps = ["composer", "permission", "model", "apps", "team", "account", "keys"];
const targets = {
  composer: agent + " .cmp-input",
  permission: agent + " .cmp-mode",
  model: agent + " .cmp-model .mp-trigger",
  apps: "#nav .sidebar-apps",
  account: "#nav .sidebar-account",
};
const appsDialog = '.modal-scrim[data-standalone="connections"]:not([hidden]) > .modal';
const stepSelector = (id, state) => '.tour[data-step="' + id + '"]' + (state ? '[data-state="' + state + '"]' : "");
const step = (id, state) => wait(stepSelector(id, state));
const assert = (id, state) => check("tour-step-" + id + "-" + state);
const begin = [wait(OFFER), click(START), SAVE, step("composer", "ask")];
const tryStep = id => targets[id] ? [click(targets[id]), step(id, "done")] : [];
const to = id => [...begin, ...steps.slice(0, steps.indexOf(id)).flatMap((current, index) => [...tryStep(current), click(NEXT), step(steps[index + 1])])];
const blocked = id => ["composer", "model"].includes(id) ? [
  pressAt("#nav .sidebar-account", 0.5, 0.5, stepSelector(id, "ask")),
  check("tour-blocks-outside-" + id),
] : [];
const answer = id => [click(targets[id]), step(id, "done"), assert(id, "done")];
const goodbye = [wait(BYE), check("tour-bye")];

export default [
  scene("tour-offer", "Raphael introduces itself after the first-run guide, offers a hands-on tour and waits for an answer",
    [...guide, wait(OFFER), check("tour-offer")], firstRun),
  scene("tour-offer-returning", "An ordinary onboarded launch still offers the unanswered tour",
    [wait(OFFER), check("tour-offer")], returning),
  scene("tour-offer-skip-ask", "Skip asks before saving an answer, with the offer still in place",
    [wait(OFFER), click(SKIP), wait(CONFIRM), check("tour-confirm-skip")], returning),
  scene("tour-offer-skip", "Confirming Skip remembers the answer and dismisses the offer",
    [wait(OFFER), click(SKIP), wait(CONFIRM), pressAt(".tour-confirm", 0.05, 0.2, OFFER), waitGone(CONFIRM),
      check("tour-offer"), click(SKIP), wait(CONFIRM), click(CONFIRM_ACTION), SAVE, waitGone(".tour"), check("tour-closed")], returning),
  scene("tour-offer-escape", "Escape dismisses the offer without saving an answer",
    [wait(OFFER), key("Escape"), waitGone(".tour"), check("tour-closed"), check("tour-unanswered")], returning),

  ...Object.keys(targets).flatMap(id => [
    scene("tour-" + id, "Raphael asks you to try the " + id + " control while it is highlighted", [...to(id), step(id, "ask"), ...blocked(id), assert(id, "ask")], returning),
    scene("tour-" + id + "-done", "Press the " + id + " control to see the follow-up and primary Next", [...to(id), step(id, "ask"), ...answer(id)], returning),
  ]),
  scene("tour-team", "Raphael points out the team and the plus that adds another slime",
    [...to("team"), assert("team", "look")], returning),
  scene("tour-keys", "The last step shows the real shortcut as key caps and offers Finish",
    [...to("keys"), assert("keys", "look")], returning),
  scene("tour-back", "Next closes the opened apps dialog; Back returns to its waiting step",
    [...to("apps"), ...answer("apps"), click(NEXT), step("team"), waitGone(appsDialog),
      click(BACK), step("apps", "ask"), assert("apps", "ask")], returning),
  scene("tour-end", "Finish sends Raphael back to the sidebar foot with a short goodbye",
    [...to("keys"), click(FINISH), ...goodbye], returning),
  scene("tour-end-closed", "The goodbye fades and the window is ready for input",
    [...to("keys"), click(FINISH), wait(BYE), waitGone(".tour"), check("tour-closed")], returning),
  scene("tour-escape", "Escape and the mouse side buttons leave the tour and its open layer in place",
    [...to("model"), key("Escape"), assert("model", "ask"), ...answer("model"), key("Escape"),
      sideButton("back"), sideButton("forward"), assert("model", "done")], returning),
  scene("tour-end-ask", "The shared End tour confirmation takes input above the dim and the open model menu",
    [...to("model"), ...answer("model"), click(CLOSE), wait(CONFIRM), check("tour-confirm-end")], returning),
  scene("tour-close", "Escape resumes the same step, then confirming End tour clears the tour and its open menu",
    [...to("model"), ...answer("model"), click(CLOSE), wait(CONFIRM), key("Escape"), waitGone(CONFIRM),
      assert("model", "done"), click(CLOSE), wait(CONFIRM), click(CONFIRM_ACTION), waitGone(".tour"),
      waitGone(".cb-menu"), check("tour-closed"), check("tour-saved-once")], returning),
  { ...scene("tour-hop", "Raphael lands beside the next step after a series of small hops with its grounded blue light",
    [wait(OFFER), { action: "settle-motion" }, check("tour-offer"), ...begin.slice(1), { action: "settle-motion" },
      ...tryStep("composer"), click(NEXT), step("permission", "ask"), { action: "settle-motion" }, assert("permission", "ask")], returning), motion: true },
];
