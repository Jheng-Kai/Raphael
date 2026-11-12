import { scene, member, click, type, wait, waitGone, scroll, check } from "./steps.mjs";

const disconnected = { connected: false, enabled: false, running: false, error: null, bot: null, allowed: [], pending: [] };
const connected = (name, code) => ({ connected: true, enabled: true, running: true, error: null, bot: { username: name }, allowed: [], pending: [{ code, name: "Owner", expires_in_s: 120 }] });
const channels = { slack: connected("Research", "SL1234"), discord: connected("ResearchBot", "DC1234") };
const desktop = { desktop: { state: "running", ready: true, control: "member" }, checkpoints: true };
const review = [member(1), {action:'open-details'}, click('[data-det="tab"][data-tab="computer"]'), wait('.desktop-panel[data-desktop-state="member"]'), click('[data-desktop="enlarge"]'),click('[data-desktop="take"]'),wait('.desktop-panel[data-expanded][data-interactive="true"]'),click('[data-desktop="menu"]'),click('#app-popover [data-pick="files"]'), wait('.checkpoint'), scroll('.checkpoint'), click('.checkpoint summary'), wait('.checkpoint details[open] pre')];
const login = [member(1), wait('[data-secret-card="card-login"]')];
// Raphael's bots live in his panel, not in Settings.
const raphael = [member(0), { action: "open-details" }];

export default [
  scene("work-messaging-setup", "Raphael's panel: a work chat not set up is one row whose 設定 asks him in the conversation, with no token field", [...raphael, wait('.mb-panel-suggest [data-intent="setup-slack"]'), click('.mb-panel-suggest [data-intent="setup-slack"]'), click('.mb-panel-suggest [data-intent="setup-slack"]'), check("work-messaging")], { workMessaging: { slack: disconnected, discord: disconnected } }),
  scene("work-messaging-pairing", "Slack and Discord have independent pairing codes in Raphael's panel and no remote approval", [...raphael, scroll('.mb-panel-suggest [data-msg-kind="discord"]'), wait('[data-msg-kind="discord"] [data-code="DC1234"]'), check("work-pairing")], { workMessaging: channels }),
  scene("computer-file-changes", "The existing computer panel exposes a readable before/after file diff", [...review, check("file-changes"), check("computer-foot-layout")], desktop),
  scene("computer-file-partial", "Uncovered files are named without claiming they can be restored", [...review, check("file-partial")], { ...desktop, checkpointPartial: true }),
  scene("computer-file-confirm", "Restore waits for the existing destructive confirmation dialog", [...review, click('[data-checkpoint-restore]'), wait('.mb-confirm'), check("file-confirm")], desktop),
  scene("computer-file-restored", "Confirmed restore returns the file result and marks that snapshot restored", [...review, click('[data-checkpoint-restore]'), wait('.mb-confirm'), click('[data-dlg="restore"]'), waitGone('[data-checkpoint-restore]'), check("file-restored")], desktop),
  scene("computer-file-bypass", "Full permission restores from the review without waiting for another yes", [...review, click('[data-checkpoint-restore]'), waitGone('[data-checkpoint-restore]'), check("file-bypass")], { ...desktop, fullPermission: true }),
  scene("computer-login-card", "The existing secret card asks for a login without putting either value in markup", [...login, type('[data-login-user]', 'private-look-owner'), type('[data-secret-card="card-login"] [data-secret-input]', 'private-look-password'), check("login-private")], { loginCard: true }),
  scene("computer-login-saved", "Saving the login empties its fields and exposes completion metadata only", [...login, type('[data-login-user]', 'private-look-owner'), type('[data-secret-card="card-login"] [data-secret-input]', 'private-look-password'), click('[data-secret-card="card-login"] [data-act="card-save"]'), waitGone('[data-login-user]'), check("login-saved")], { loginCard: true }),
];
