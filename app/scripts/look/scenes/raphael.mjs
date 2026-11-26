import { scene, accountMenu, click, wait, check } from "./steps.mjs";

// Raphael is the app's guide and keeper, not one of the owner's slimes: it has its own entry in the account menu, its own
// conversation space in the same chat view (with its quick questions), and no row in the sidebar. The chief of staff is a
// slime like the others, or nobody. Each scene begins at the app's own start (`start: "app"`), where the app opens on the chief's
// conversation (Raphael's when there is no slime), and then goes where the owner goes.
const atStart = { start: "app" };
const chiefOpen = wait('.mb-col .mb-chief[aria-current="true"]');
const details = [{ action: "open-details" }, wait(".mb-det:not([hidden]) .mb-panel-identity")];
const raphaelOpen = [accountMenu("raphael"), wait(".page-agent:not([hidden]) .conversation-trigger"), ...details, wait('.mb-det [data-slot="conversations"] [data-conversation-open]')];

export default [
  scene("raphael-entry", "The account menu has Raphael's own entry after 行事曆, apart from the rows above and from 設定 by a hairline each, with its blue slime where the others have their icon",
    [chiefOpen, accountMenu(), wait('#app-popover.account-menu [data-account="raphael"]'), check("raphael-entry")], atStart),
  scene("raphael-space", "Raphael's entry opens its conversation space in the same chat view: its quick-question history beside its own conversation, no share button, a face with nothing to change, and no row of the sidebar is the open one",
    [chiefOpen, ...raphaelOpen, check("raphael-space"), check("sidebar-shell"), check("raphael-not-in-sidebar")], atStart),
  scene("chief-space", "The chief of staff opens as a slime like the others: the crown, a share button, a face to change, and no quick-question list",
    [chiefOpen, ...details, check("chief-space"), check("raphael-not-in-sidebar")], atStart),
  scene("raphael-route-back", "Opening Raphael and then a slime's row is one place after another: the sidebar's selection follows, the chief's conversation comes back without its quick list",
    [chiefOpen, accountMenu("raphael"), wait(".page-agent:not([hidden]) .conversation-trigger"), click(".mb-col .mb-chief"), wait('.mb-col .mb-chief[aria-current="true"]'), ...details, check("chief-space")], atStart),
  scene("no-slimes", "With no slime at all the app opens on Raphael's conversation, the sidebar's list is empty with its plus, and nothing wears a crown",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), check("no-slimes"), check("sidebar-shell")], { ...atStart, onlyRaphael: true }),
  scene("no-chief", "Slimes without a chief (the role is nobody's): the app opens on Raphael's conversation, the slimes are listed, and no row leads or wears a crown",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), wait('.mb-col [data-member="1"]'), check("no-chief"), check("sidebar-shell")], { ...atStart, primaryMember: null }),
];
