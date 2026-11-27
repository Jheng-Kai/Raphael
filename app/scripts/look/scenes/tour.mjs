import { scene, click, type, wait, waitGone, check, key, accountMenu, waitCall } from "./steps.mjs";

// Raphael's guided tour of the main window (tour/, R-TOUR-01..04). After the first-run guide Raphael springs out of the account button and
// asks whether the newcomer wants a tour, once; the walk has nine steps, each a dim with one cut-out, Raphael's slime and one plain line.
// The account menu's 導覽 starts it again. The offer's scenes go through the real guide (the fixture's device settings say it was never
// offered: `tourOffer`); the others begin from the app's own start through the menu's entry, as a returning person does.
const atStart = { start: "app" };
const pickFirstSlime = [click('.ob-first-picker [data-slime-tab="red"]'), click('.ob-first-picker [data-slime-character="horns-red"]')];
const guide = [click('[data-ob="next"]'), wait('#ob-first-name'), type('#ob-first-name', '小藍'), ...pickFirstSlime, click('[data-ob="next"]'),
  click('[data-ob="next"]'), click('[data-ob="next"]'), wait('[data-ob-abilities] .svc-item'), click('[data-ob="next"]'), wait(".page-agent:not([hidden]) .conversation-trigger")];
const offered = [...guide, wait('.tour[data-mode="offer"] .tour-bubble')];
const offer = { onboarding: true, tourOffer: true };

const begin = [accountMenu("tour"), wait('.tour[data-mode="step"] .tour-bubble')];
const NEXT = '.tour [data-tour="next"]';
const BACK = '.tour [data-tour="back"]';
const at = (n, of = 9) => ({ action: "wait-text", selector: ".tour .tour-count", text: `${n}/${of}` });
/** From the first step to step `n`: one press of 下一步 each. */
const to = n => [...begin, ...Array.from({ length: n - 1 }, (_, i) => [click(NEXT), at(i + 2)]).flat()];
const settingsStep = pane => wait(`.modal-scrim [data-pane="${pane}"][aria-current="page"]`);

export default [
  scene("tour-offer", "After the first-run guide Raphael springs out of the account button at the bottom left and asks whether you want a tour, with how long it takes; two buttons, nothing dimmed, the window still works under it",
    [...offered, check("tour-offer")], offer),
  scene("tour-offer-remembered", "The offer is kept in the device settings the moment it shows, so that it never comes again on its own",
    [...guide, waitCall("device_settings_set", "tour_offered"), wait('.tour[data-mode="offer"] .tour-bubble'), check("tour-offer")], offer),
  scene("tour-offer-later", "之後再說 closes the offer: Raphael says where to find the tour again and fades, and the window is as it was",
    [...offered, click('.tour [data-tour="later"]'), wait('.tour[data-mode="bye"]'), check("tour-bye")], offer),
  scene("tour-offer-escape", "Escape closes the offer the same way",
    [...offered, key("Escape"), wait('.tour[data-mode="bye"]'), check("tour-bye"), waitGone(".tour"), check("tour-closed")], offer),

  scene("tour-composer", "Step 1: the composer is cut out of the dim; tell a slime what you need, attach files, pick a folder", [...begin, at(1), check("tour-step-composer")], atStart),
  scene("tour-team", "Step 2: the team in the sidebar: each slime has its own work and memory, + adds one", [...to(2), check("tour-step-team")], atStart),
  scene("tour-apps", "Step 3: 連結應用程式, what connecting Gmail and Notion is for", [...to(3), check("tour-step-apps")], atStart),
  scene("tour-permission", "Step 4: the permission chip of the composer, and whether a slime asks before it acts", [...to(4), check("tour-step-permission")], atStart),
  scene("tour-model", "Step 5: the model picker, a subscription you already have or your own key", [...to(5), check("tour-step-model")], atStart),
  scene("tour-usage", "Step 6: Settings opens at 用量 and is cut out whole; Raphael stands in its lower right", [...to(6), settingsStep("usage"), check("tour-step-usage")], atStart),
  scene("tour-skills", "Step 7: Settings at 團隊技能, what a skill is", [...to(7), settingsStep("skills"), check("tour-step-skills")], atStart),
  scene("tour-safety", "Step 8: Settings at 安全, what always needs your yes", [...to(8), settingsStep("safety"), check("tour-step-safety")], atStart),
  scene("tour-keys", "Step 9: no part of the window is pointed at; the keys that ask Raphael from anywhere on the computer are drawn as caps, as the shortcut settings name them, and Settings are closed again",
    [...to(9), waitGone('.modal-scrim:not([hidden]) .modal'), check("tour-step-keys")], atStart),
  scene("tour-end", "完成 on the last step: Raphael hops back to the account button and says where to find the tour again; nothing is dimmed and the window works again",
    [...to(9), click('.tour [data-tour="done"]'), wait('.tour[data-mode="bye"]'), check("tour-bye"), check("tour-closed-window")], atStart),
  scene("tour-end-closed", "The goodbye fades on its own and nothing of the tour is left", [...to(9), click('.tour [data-tour="done"]'), wait('.tour[data-mode="bye"]'), waitGone(".tour"), check("tour-closed")], atStart),
  scene("tour-back", "上一步 goes back one step, out of Settings too, which close again",
    [...to(7), click(BACK), at(6), click(BACK), at(5), waitGone('.modal-scrim:not([hidden]) .modal'), check("tour-step-model")], atStart),
  scene("tour-escape", "Escape in the middle of the walk, with Settings open, ends it: Settings close, the window works again, Raphael says where to find the tour",
    [...to(7), key("Escape"), wait('.tour[data-mode="bye"]'), check("tour-bye"), waitGone(".tour"), check("tour-closed")], atStart),
  scene("tour-close", "The × ends the walk the same way",
    [...to(3), click('.tour [data-tour="close"]'), wait('.tour[data-mode="bye"]'), check("tour-bye"), waitGone(".tour"), check("tour-closed")], atStart),
  // With motion allowed (the look runs with reduced motion unless a scene says `motion`): Raphael hops between the steps.
  { ...scene("tour-hop", "With motion allowed Raphael hops to the next step in an arc and lands beside it",
    [...begin, click(NEXT), at(2), { action: "settle-motion" }, check("tour-step-team")], atStart), motion: true },
];
