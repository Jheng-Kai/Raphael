import { scene, accountMenu, click, wait, check } from "./steps.mjs";

// Raphael is the app's guide and keeper, not one of the owner's slimes: it has its own entry in the account menu, its own
// conversation space in the same chat view (its one conversation: what was typed and what was said at the key), and no row in the sidebar. The chief of staff is a
// slime like the others, or nobody. Each scene begins at the app's own start (`start: "app"`), where the app opens on the chief's
// conversation (Raphael's when there is no slime), and then goes where the owner goes.
const atStart = { start: "app" };
const chiefOpen = wait('.mb-col .mb-chief[aria-current="true"]');
const details = [{ action: "open-details" }, wait(".mb-det:not([hidden]) .mb-panel-identity")];
const raphaelOpen = [accountMenu("raphael"), wait(".page-agent:not([hidden]) .conversation-trigger"), ...details, wait('.tn[data-id="90"]')];
// The tour's card, as the core's greeting writes it (the look fixture's fake brain, `tour`): Raphael's welcome and the one question.
const tourCard = '[data-owner-question^="greeting-card-"][data-card-state="asked"]';

export default [
  scene("raphael-entry", "The account menu has Raphael's own entry after 行事曆, apart from the rows above and from 設定 by a hairline each, with its blue slime where the others have their icon",
    [chiefOpen, accountMenu(), wait('#app-popover.account-menu [data-account="raphael"]'), check("raphael-entry")], atStart),
  scene("raphael-space", "Raphael's entry opens its conversation space in the same chat view: its one conversation with what was typed and what was said at the key, a ⋯ in place of the share button, a face with nothing to change, and no row of the sidebar is the open one",
    [chiefOpen, ...raphaelOpen, check("raphael-space"), check("sidebar-shell"), check("raphael-not-in-sidebar")], atStart),
  scene("chief-space", "The chief of staff opens as a slime like the others: the crown, a share button, a face to change, and no ⋯ of Raphael's",
    [chiefOpen, ...details, check("chief-space"), check("raphael-not-in-sidebar")], atStart),
  scene("raphael-route-back", "Opening Raphael and then a slime's row is one place after another: the sidebar's selection follows, the chief's conversation comes back as a slime's",
    [chiefOpen, accountMenu("raphael"), wait(".page-agent:not([hidden]) .conversation-trigger"), click(".mb-col .mb-chief"), wait('.mb-col .mb-chief[aria-current="true"]'), ...details, check("chief-space")], atStart),
  scene("no-slimes", "With no slime at all the app opens on Raphael's conversation, the sidebar's list is empty with its plus, and nothing wears a crown",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), check("no-slimes"), check("sidebar-shell")], { ...atStart, onlyRaphael: true }),
  scene("raphael-tour", "An empty conversation of Raphael's begins its guided tour on its own: its welcome and one card of what to do first, never the old greeting",
    [wait(tourCard), check("raphael-tour")], { turns: [], tour: true }),
  scene("raphael-tour-answer", "The pick on the card is the card's own and the tour goes on below it: what the part is, and the offer that waits for the owner's yes",
    [wait(tourCard), click('[data-owner-question^="greeting-card-"] [data-owner-option]'), { action: "wait-text", selector: ".ra-scroll", text: "經你同意才會動手" }, check("raphael-tour-answer")], { turns: [], tour: true }),
  scene("raphael-no-model", "With no answer model Raphael cannot speak: its empty page says answers have no model yet, with the one button that chooses it, and no greeting stands there",
    [wait(".ra-notice:not([hidden])"), check("raphael-no-model")], { turns: [], tour: true, noSources: true }),
  scene("no-chief", "Slimes without a chief (the role is nobody's): the app opens on Raphael's conversation, the slimes are listed, and no row leads or wears a crown",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), wait('.mb-col [data-member="1"]'), check("no-chief"), check("sidebar-shell")], { ...atStart, primaryMember: null }),
];
