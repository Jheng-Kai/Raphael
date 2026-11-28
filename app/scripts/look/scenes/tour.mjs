import { scene, click, type, typing, wait, waitGone, check, key, page, pressAt, waitCall } from "./steps.mjs";

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
const settings = '.modal-scrim:not([hidden]):not(.leaving):not([data-standalone])';
const maker = ".mb-scrim:not(.leaving) > .cr-dialog";
const steps = [
  ["composer", "Send a greeting in the conversation", [typing(agent + " .cmp-input", "你好", "{Enter}"),
    waitCall("agent_ask_text"), { action: "wait-text", selector: '.page-agent:not([hidden]) [data-message="question"] .message-text', text: "你好" }]],
  ["permission", "Open the permission menu", [click(agent + " .cmp-mode"), wait(".cb-menu .cb-modes")]],
  ["manual", "Choose Manual in the permission menu", [click('.cb-modes .cb-row[data-mode="ask"]'), waitGone(".cb-menu"), wait(agent + ' .cmp-mode[data-mode="ask"]')]],
  ["model", "Open the model menu", [click(agent + " .cmp-model .mp-trigger"), wait(".cb-menu .cb-now")]],
  ["model-list", "Open the model list and leave without picking a model", [click('.cb-menu [data-cb-act="models"]'), wait('.cb-menu .cb-body[data-view="models"]')], [waitGone(".cb-menu")]],
  ["apps", "Open the Connect apps dialog", [click("#nav .sidebar-apps"), wait(apps + " #conn-search"), check("tour-apps-layer-clear")]],
  ["app-search", "Search for Gmail and close the Connect apps dialog", [typing(apps + " #conn-search", "Gmail"), wait(apps + " [data-cs-body] > .cs-grid")], [waitGone(apps), check("page-unshifted")]],
  ["team", "Open the member maker from the sidebar plus", [click('#nav [data-col="add"]'), wait(maker)]],
  ["slime-look", "Try a look and cancel the maker without creating a member",
    [click(maker + ' .cr-picker [data-slime-character]:not([aria-pressed="true"])'), wait(maker + ' .cr-face svg[data-state="arriving"]')],
    [waitGone(maker), check("tour-no-member-created")]],
  ["account", "Open the account menu", [click("#nav .sidebar-account"), wait(".account-menu")]],
  ["settings", "Open Settings from the account menu", [click('.account-menu [data-account="settings"]'), wait(settings + " [data-pane]")]],
  ["usage", "Open the usage pane and close Settings", [click(settings + ' [data-pane="usage"]'), wait(settings + ' [data-usage-tab][aria-selected="true"]')], [waitGone(settings), check("page-unshifted")]],
  ["keys", "Try the quick-ask shortcut and finish", [
    { action: "key", key: "Space", altRight: true }, wait(FINISH, 1500),
  ]],
];
const step = (index, timeout) => wait('.tour[data-step="' + steps[index][0] + '"]', timeout);
const inspect = index => check("tour-step-" + (index + 1));
const begin = [wait(OFFER), click(START), SAVE, step(0)];
const act = index => [...steps[index][2], ...(steps[index + 1] ? [step(index + 1, 3500)] : []), ...(steps[index][3] ?? [])];
const to = index => [...begin, ...steps.slice(0, index).flatMap((_, i) => act(i))];
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
      [...to(index), inspect(index), ...([0, 5, 6].includes(index) ? [check("page-unshifted")] : [])], returning),
    afterCapture: act(index),
  })),
  scene("tour-end", "Finish sends Raphael back to the sidebar foot with a short goodbye",
    [...to(12), ...act(12), click(FINISH), ...goodbye, check("page-unshifted")], returning),
  scene("tour-end-closed", "The goodbye fades and the window is ready for input",
    [...to(12), wait(FINISH, 10000), click(FINISH), wait(BYE), waitGone(".tour"), check("tour-closed")], returning),
  scene("tour-end-ask", "The shared End tour confirmation takes input above the dim and open model menu",
    [...to(4), click(CLOSE), wait(CONFIRM), check("tour-confirm-end")], returning),
  scene("tour-close", "Escape resumes the same step, then confirming End tour clears the tour and open menu",
    [...to(4), click(CLOSE), wait(CONFIRM), key("Escape"), waitGone(CONFIRM),
      inspect(4), click(CLOSE), wait(CONFIRM), click(CONFIRM_ACTION), waitGone(".tour"),
      waitGone(".cb-menu"), check("tour-closed"), check("tour-saved-once")], returning),
  { ...scene("tour-hop", "Raphael hops to the permission step with its grounded blue light",
    [wait(OFFER), { action: "settle-motion" }, check("tour-offer"), ...begin.slice(1), { action: "settle-motion" },
      ...act(0), { action: "settle-motion" }, inspect(1)], returning), motion: true },
];
