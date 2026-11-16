import { scene, member, click, type, wait, waitGone, scroll, check } from "./steps.mjs";

const disconnected = { connected: false, enabled: false, running: false, error: null, bot: null, allowed: [], pending: [] };
const connected = (name, code) => ({ connected: true, enabled: true, running: true, error: null, bot: { username: name }, allowed: [], pending: [{ code, name: "Owner", expires_in_s: 120 }] });
const channels = { slack: connected("Research", "SL1234"), discord: connected("ResearchBot", "DC1234") };
const desktop = { desktop: { state: "running", ready: true, control: "member" } };
const menu = [member(1), {action:'open-details'}, click('[data-det="tab"][data-tab="computer"]'), wait('.desktop-panel[data-desktop-state="member"]'), click('[data-desktop="enlarge"]'),click('[data-desktop="take"]'),wait('.desktop-panel[data-expanded][data-interactive="true"]'),click('[data-desktop="menu"]'), wait('#app-popover [data-pick]')];
const login = [member(1), wait('[data-secret-card="card-login"]')];
const keyed = [member(1), wait('[data-secret-card="card-key"]')];
// Raphael's bots live in its panel, not in Settings.
const raphael = [member(0), { action: "open-details" }];

export default [
  scene("work-messaging-setup", "Raphael's panel: a work chat not set up is one row whose 設定 asks him in the conversation, with no token field", [...raphael, wait('.mb-panel-suggest [data-intent="setup-slack"]'), click('.mb-panel-suggest [data-intent="setup-slack"]'), click('.mb-panel-suggest [data-intent="setup-slack"]'), check("work-messaging")], { workMessaging: { slack: disconnected, discord: disconnected } }),
  scene("work-messaging-pairing", "Slack and Discord have independent pairing codes in Raphael's panel and no remote approval", [...raphael, scroll('.mb-panel-suggest [data-msg-kind="discord"]'), wait('[data-msg-kind="discord"] [data-code="DC1234"]'), check("work-pairing")], { workMessaging: channels }),
  scene("computer-menu-teach-only", "The member computer panel's ⋯ menu lists one entry, 教他做一次, and no file-changes entry", [...menu, check("computer-menu-teach-only"), check("computer-foot-layout")], desktop),
  scene("computer-login-card", "The existing secret card asks for a login without putting either value in markup", [...login, type('[data-login-user]', 'private-look-owner'), type('[data-secret-card="card-login"] [data-secret-input]', 'private-look-password'), check("login-private")], { loginCard: true }),
  scene("computer-key-card", "The existing secret card asks for a key for a program in the member's computer: the variable's name, what it is for and one masked field", [...keyed, type('[data-secret-card="card-key"] [data-secret-input]', 'sk-or-v1-private-look-key'), check("key-private")], { keyCard: true }),
  scene("computer-key-saved", "Saving the key empties its field and sends one call, with no copy of the value in the page", [...keyed, type('[data-secret-card="card-key"] [data-secret-input]', 'sk-or-v1-private-look-key'), click('[data-secret-card="card-key"] [data-act="card-save"]'), waitGone('[data-secret-card="card-key"] [data-secret-input]'), check("key-saved")], { keyCard: true }),
  scene("computer-login-saved", "Saving the login empties its fields and exposes completion metadata only", [...login, type('[data-login-user]', 'private-look-owner'), type('[data-secret-card="card-login"] [data-secret-input]', 'private-look-password'), click('[data-secret-card="card-login"] [data-act="card-save"]'), waitGone('[data-login-user]'), check("login-saved")], { loginCard: true }),
];
