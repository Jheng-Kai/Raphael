import { scene, click, wait, check, settings, scroll, key, type, member, room } from "./steps.mjs";

const chooser = [...settings("models"), click('[data-k="quick-model"]'), click('.model-chooser [data-source="cli:codex"]'), click('.model-chooser [data-model="cli:codex:gpt-6.1"]')];
const conversationRuler = [click('.composer .cmp-model .mp-trigger'), click('.cb-pick'), click('.cb-menu [data-cb-source="cli:codex"]'), click('.cb-menu [data-model="cli:codex:gpt-6.1"]'), wait('.cb-now:not([hidden]) .mc-range'), { action:'slider-stop', selector:'.cb-now .mc-range', level:'medium' }, check('polish-effort-reference')];
export default [
  scene("polish-effort-composer", "The conversation ruler at the same medium effort used by Settings", conversationRuler),
  scene("polish-effort", "Settings and the conversation share the identical effort ruler", [...conversationRuler, key('Escape'), ...chooser, { action:'slider-stop', selector:'.mc-effort .mc-range', level:'medium' }, check('polish-effort')]),
  scene("polish-scroll", "Reopening and changing panes reset the long Settings content", [...settings('models'), scroll('[data-pv="directory"]'), check('polish-scrolled'), click('.modal-x'), ...settings('models'), check('polish-scroll'), scroll('[data-pv="directory"]'), check('polish-scrolled'), click('[data-pane="about"]'), click('[data-pane="models"]'), check('polish-scroll')]),
  ...['settings', 'member', 'confirm'].map(kind => scene(`polish-caption-${kind}`, "Window actions work once through the shared dialog dismissal", [
    ...(kind === 'settings' ? settings('models') : kind === 'member' ? [member(1), { action: 'open-details' }, click('[data-det="tab"][data-tab="settings"]'),click('[data-det="edit"]')] : [room(1), click('[data-room-menu]'), click('[data-pick="delete"]')]),
    { action: 'polish-caption', kind }, check('polish-caption'),
  ], { polishData: true })),
  ...['chief', 'member', 'room'].map(kind => scene(`polish-search-${kind}`, "Search navigates exact words across unloaded history without losing the conversation", [
    ...(kind === 'member' ? [member(1)] : kind === 'room' ? [room(1)] : []),
    click(kind === 'room' ? '[data-room-search]' : '[data-act="search"]'),
    type(kind === 'room' ? '.au-room-pane .ra-find-input' : '.page-agent .ra-find-input', 'needle'),
    { action: 'polish-search', total: kind === 'room' ? 210 : 615 }, check('polish-search'),
  ], { polishSearch: true })),
  scene('polish-room-recording', 'Group recording uses the same send glyph and state as a member', [room(1), click('.au-room-pane .cmp-voice'), wait('.au-room-pane .composer[data-task-state]'), check('polish-room-recording')], { polishVoice: true }),
];
