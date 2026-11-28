import { scene, click, type, wait, waitGone, check, key, page, pressAt, waitCall } from "./steps.mjs";

const returning = { start: "app", tourUnanswered: true, tourQuickAsk: true };
const firstRun = { onboarding: true, tourUnanswered: true };
const OFFER = '.tour[data-mode="offer"]:not(.is-covered)';
const BYE = '.tour[data-mode="bye"]';
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

const apps = '.modal-scrim[data-standalone="connections"]:not([hidden]):not(.leaving)';
const maker = ".mb-scrim:not(.leaving) > .cr-dialog";
const GOT_IT = '.tour [data-tour="gotIt"]';
const ACCOUNT_MENU = "#app-popover.account-menu";
const row = id => click(`${ACCOUNT_MENU} [data-account="${id}"]`);
// [id, what the person does, the actions, whether what it opens is then lit and explained, what must hold once the tour moves on]
const steps = [
  ["permission", "Open the permission menu", [click(agent + " .cmp-mode"), wait(".cb-menu .cb-modes")], true, [waitGone(".cb-menu")]],
  ["model", "Open the model menu", [click(agent + " .cmp-model .mp-trigger"), wait(".cb-menu .cb-now")], false],
  ["model-list", "Open the model list inside the model menu", [click('.cb-menu [data-cb-act="models"]'), wait('.cb-menu .cb-body[data-view="models"]')], true, [waitGone(".cb-menu")]],
  ["apps", "Open the Connect apps dialog", [click("#nav .sidebar-apps"), wait(apps + " #conn-search")], true, [waitGone(apps), check("page-unshifted")]],
  ["team", "Open the member maker from the sidebar plus", [click('#nav [data-col="add"]'), wait(maker)], true, [waitGone(maker), check("tour-no-member-created")]],
  ["account", "Open the account menu", [click("#nav .sidebar-account"), wait(ACCOUNT_MENU)], false],
  // Each page is looked at, and 好的 brings the conversation back with the account menu open again for the next row.
  ["dictation", "Press 聽寫 in the account menu", [row("dictation"), wait("#main > .page-dictation:not([hidden])")], true,
    [wait(".page-agent:not([hidden]) .composer"), wait(ACCOUNT_MENU)]],
  ["calendar", "Press 行事曆 in the account menu", [row("calendar"), wait("#main > .au-page:not([hidden])")], true,
    [wait(".page-agent:not([hidden]) .composer"), wait(ACCOUNT_MENU)]],
  ["raphael", "Press Raphael's own row in the account menu", [row("raphael"), wait("#main > .page-agent[data-raphael]:not([hidden])")], true,
    [check("page-unshifted")]],
  ["keys", "Try the quick-ask shortcut and finish", [
    { action: "key", key: "Space", altRight: true }, wait(FINISH, 1500),
  ], false],
];
const MODEL_LIST = steps.findIndex(([id]) => id === "model-list");
const KEYS = steps.findIndex(([id]) => id === "keys");
const step = (index, timeout) => wait('.tour[data-step="' + steps[index][0] + '"][data-state="do"]', timeout);
const seeing = index => wait('.tour[data-step="' + steps[index][0] + '"][data-state="see"]', 3500);
const inspect = index => check("tour-step-" + (index + 1));
const begin = [wait(OFFER), click(START), SAVE, step(0)];
/** The action, and then either what it opened lit and explained, or the next step. */
const act = index => [...steps[index][2], ...(steps[index][3] ? [seeing(index)] : steps[index + 1] ? [step(index + 1, 3500)] : [])];
/** 懂了 after a step that explains what it opened, then the next step and what must hold once the opened thing is put away. */
const gotIt = index => steps[index][3] ? [click(GOT_IT), ...(steps[index + 1] ? [step(index + 1, 4000)] : []), ...(steps[index][4] ?? [])] : [];
const to = index => [...begin, ...steps.slice(0, index).flatMap((_, i) => [...act(i), ...gotIt(i)])];
const goodbye = [wait(BYE), check("tour-bye")];

export default [
  scene("tour-offer", "Raphael introduces itself after the first-run guide, offers a hands-on tour and waits for an answer",
    [...guide, wait(OFFER), check("tour-offer"), check("page-unshifted")], firstRun),
  scene("tour-offer-returning", "An ordinary onboarded launch still offers the unanswered tour",
    [wait(OFFER), check("tour-offer"), check("page-unshifted")], returning),
  scene("tour-offer-settings-open", "Settings cover the unanswered tour offer, which is hidden and out of the tab order",
    [wait(OFFER), page("settings"), wait('.modal-scrim:not([hidden]) > .modal'), waitGone(OFFER),
      check("tour-offer-settings-open"), check("tour-unanswered")], returning),
  scene("tour-offer-skip-ask", "Skip asks before saving an answer, with the offer still in place",
    [wait(OFFER), click(SKIP), wait(CONFIRM), check("tour-confirm-skip")], returning),
  scene("tour-offer-skip", "Confirming Skip remembers the answer and dismisses the offer",
    [wait(OFFER), click(SKIP), wait(CONFIRM), pressAt(".tour-confirm", 0.05, 0.2, OFFER), waitGone(CONFIRM),
      check("tour-offer"), click(SKIP), wait(CONFIRM), click(CONFIRM_ACTION), SAVE, waitGone(".tour"), check("tour-closed")], returning),
  scene("tour-offer-escape", "Escape dismisses the offer without saving an answer",
    [wait(OFFER), key("Escape"), waitGone(".tour"), check("tour-closed"), check("tour-unanswered")], returning),
  ...steps.map(([, description], index) => ({
    ...scene("tour-step-" + (index + 1), description,
      [...to(index), inspect(index), ...([0, 3].includes(index) ? [check("page-unshifted")] : [])], returning),
    afterCapture: act(index),
  })),
  // What a step opened, lit and explained, waiting for 好的.
  ...steps.flatMap(([, description, , seen], index) => seen ? [{
    ...scene("tour-step-" + (index + 1) + "-seen", description + ": what it opened is lit and explained until 好的",
      [...to(index), ...act(index), check("tour-step-" + (index + 1) + "-seen"), check("page-unshifted")], returning),
    afterCapture: gotIt(index),
  }] : []),
  scene("tour-end", "Finish sends Raphael back to the sidebar foot with a short goodbye",
    [...to(KEYS), ...act(KEYS), click(FINISH), ...goodbye, check("page-unshifted")], returning),
  scene("tour-end-closed", "The goodbye fades and the window is ready for input",
    [...to(KEYS), wait(FINISH, 10000), click(FINISH), wait(BYE), waitGone(".tour"), check("tour-closed")], returning),
  scene("tour-end-ask", "The shared End tour confirmation takes input above the dim and open model menu",
    [...to(MODEL_LIST), click(CLOSE), wait(CONFIRM), check("tour-confirm-end")], returning),
  scene("tour-close", "Escape resumes the same step, then confirming End tour clears the tour and open menu",
    [...to(MODEL_LIST), click(CLOSE), wait(CONFIRM), key("Escape"), waitGone(CONFIRM),
      inspect(MODEL_LIST), click(CLOSE), wait(CONFIRM), click(CONFIRM_ACTION), waitGone(".tour"),
      waitGone(".cb-menu"), check("tour-closed"), check("tour-saved-once")], returning),
  { ...scene("tour-hop", "Raphael hops along the way to the permission menu with its grounded blue light",
    [wait(OFFER), { action: "settle-motion" }, check("tour-offer"), ...begin.slice(1), { action: "settle-motion" },
      ...act(0), { action: "settle-motion" }, check("tour-step-1-seen")], returning), motion: true },
];
