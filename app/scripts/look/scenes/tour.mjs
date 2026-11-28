import { scene, click, type, wait, waitGone, check, key, waitCall } from "./steps.mjs";

const returning = { start: "app", tourUnanswered: true };
const firstRun = { onboarding: true, tourUnanswered: true };
const OFFER = '.tour[data-mode="offer"]';
const BYE = '.tour[data-mode="bye"]';
const NEXT = '.tour [data-tour="next"]';
const BACK = '.tour [data-tour="back"]';
const START = '.tour [data-tour="start"]';
const FINISH = '.tour [data-tour="done"]';
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
const modelMenu = '.cb-menu:has(.cb-now)';
const appsDialog = '.modal-scrim[data-standalone="connections"]:not([hidden]) > .modal';
const step = (id, state) => wait('.tour[data-step="' + id + '"]' + (state ? '[data-state="' + state + '"]' : ""));
const assert = (id, state) => check("tour-step-" + id + "-" + state);
const begin = [wait(OFFER), click(START), SAVE, step("composer", "ask")];
const to = id => [...begin, ...steps.slice(1, steps.indexOf(id) + 1).flatMap(next => [click(NEXT), step(next)])];
const answer = id => [click(targets[id]), step(id, "done"), assert(id, "done")];
const goodbye = [wait(BYE), check("tour-bye")];

export default [
  scene("tour-offer", "Raphael introduces itself after the first-run guide, offers a hands-on tour and waits for an answer",
    [...guide, wait(OFFER), check("tour-offer")], firstRun),
  scene("tour-offer-returning", "An ordinary onboarded launch still offers the unanswered tour",
    [wait(OFFER), check("tour-offer")], returning),
  scene("tour-offer-skip", "Skip remembers the answer and shows the goodbye",
    [wait(OFFER), click('.tour [data-tour="skip"]'), SAVE, ...goodbye], returning),
  scene("tour-offer-escape", "Escape dismisses the offer without saving an answer",
    [wait(OFFER), key("Escape"), ...goodbye, waitGone(".tour"), check("tour-closed"), check("tour-unanswered")], returning),

  ...Object.keys(targets).flatMap(id => [
    scene("tour-" + id, "Raphael asks you to try the " + id + " control while it is highlighted", [...to(id), step(id, "ask"), assert(id, "ask")], returning),
    scene("tour-" + id + "-done", "Press the " + id + " control to see the follow-up and primary Next", [...to(id), step(id, "ask"), ...answer(id)], returning),
  ]),
  scene("tour-team", "The team list has one slime per job and memory; the plus adds a helper",
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
  scene("tour-escape", "Escape closes the composer model menu first; another Escape ends the walk",
    [...to("model"), ...answer("model"), key("Escape"), waitGone(modelMenu), step("model", "ask"),
      key("Escape"), ...goodbye], returning),
  scene("tour-close", "The close button ends the walk",
    [...to("permission"), click('.tour [data-tour="close"]'), ...goodbye], returning),
  { ...scene("tour-hop", "Raphael lands beside the next step with its grounded blue light",
    [wait(OFFER), { action: "settle-motion" }, check("tour-offer"), ...begin.slice(1), { action: "settle-motion" },
      click(NEXT), step("permission", "ask"), { action: "settle-motion" }, assert("permission", "ask")], returning), motion: true },
];
