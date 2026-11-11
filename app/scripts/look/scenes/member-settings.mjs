import { scene, member, click, hover, wait, check, key, scroll, waitScrollEnd } from './steps.mjs';
import { learnedSkill, sharedSourceSkill } from './chat.mjs';

// The member settings page (member-settings.ts): the panel's gear opens it where the conversation is.
const gear = [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), wait('.ms-pane .ms-nav [data-cat][aria-current="page"]')];
const page = [member(1), ...gear];
// Chooses a kind in the page's left column and waits for its first section.
const kind = (id, ready) => [click(`.ms-pane .ms-nav [data-cat="${id}"]`), wait(`.ms-pane .ms-nav [data-cat="${id}"][aria-current="page"]`), wait(ready)];
const filled = { memberSettings: true, skills: [learnedSkill(1), sharedSourceSkill] };
export const memberSettingsPage = page;
// A long conversation of the member's, so that the thread scrolls and its place can be told.
const longThread = { ...filled, heavyThread: { member: 1, count: 30, newest: 300050 } };
const back = [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), key('Escape'), wait('.page-agent:not([hidden]) .mb-chat .composer')];
export default [
  scene('member-settings', 'The gear opens the member as a page: a cover it can change, the face across it, name and role in place, the kinds of settings on the left and only the chosen one beside them', [...page, check('member-settings')], filled),
  scene('member-settings-raphael', 'Raphael has the same page and the same kinds as every member: tools, skills and commands, personality and instructions, notifications', [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), wait('.ms-pane .ms-nav [data-cat="tools"][aria-current="page"]'), check('member-settings'), check('member-settings-raphael')], filled),
  scene('member-settings-skills', 'Skills and commands: names with switches and pluses, nothing else on the page', [...page, ...kind('skills', '.ms-pane [data-k="ms-skills"]'), check('member-settings')], filled),
  scene('member-settings-tools', 'The tools kind: each connection with its mark and a switch, the drafts switch under them', [...page, ...kind('tools', '.ms-pane [data-k="ms-tools"]'), check('member-settings')], filled),
  scene('member-settings-notify', 'The notifications kind: one switch, and no voice anywhere', [...page, ...kind('notify', '.ms-pane [data-k="ms-notify"]'), check('member-settings')], filled),
  scene('member-settings-field', 'A long field is one line; a press opens its box in place and blur saves it', [...page, ...kind('soul', '.ms-pane [data-k="ms-personality"]'), click('.ms-pane [data-ms="edit"][data-field="personality"]'), wait('.ms-pane #ms-personality'), check('member-settings-field')], filled),
  scene('member-settings-skill', 'A skill opens in a view of its own with its text, and the arrow goes back to the page', [...page, ...kind('skills', '.ms-pane [data-ms="skill-open"]'), click('.ms-pane [data-ms="skill-open"]'), wait('.ms-pane #ms-skill-text'), check('member-settings-skill')], filled),
  scene('member-settings-command', 'A command opens in a view of its own with its name, description and template', [...page, ...kind('skills', '.ms-pane [data-ms="command-open"]'), click('.ms-pane [data-ms="command-open"]'), wait('.ms-pane #ms-command-name'), check('member-settings-command')], filled),
  scene('member-settings-cover', 'The cover\'s round button opens its patterns as small covers and a picture from this PC', [...page, click('.ms-pane [data-ms="cover"]'), wait('#app-popover .ms-swatch'), check('member-settings-cover')], filled),
  scene('member-settings-cover-picture', 'The owner\'s picture as the cover fills it and cannot be dragged out of the window', [...page, wait('.ms-pane .ms-cover-img'), check('member-settings-cover-picture')], { ...filled, coverPicture: true }),
  scene('member-settings-back-hover', 'On the owner\'s picture the way back keeps its round surface under the pointer', [...page, wait('.ms-pane .ms-cover-img'), hover('.ms-pane [data-ms="back"]'), check('member-settings-back-hover')], { ...filled, coverPicture: true }),
  // The page hides the conversation, and a hidden scroller forgets its place: the way back puts it where it was (owner, 2026-11-11).
  scene('member-settings-back-bottom', 'Back from the settings page a thread that was at its bottom is at its bottom', [member(1), wait('.tn[data-id="300050"]'), waitScrollEnd('.mb-chat .ra-scroll'), ...back, waitScrollEnd('.mb-chat .ra-scroll'), check('member-settings-place-bottom')], longThread),
  scene('member-settings-back-kept', 'Back from the settings page a thread read higher up stays where it was', [member(1), wait('.tn[data-id="300035"]'), { ...scroll('.tn[data-id="300035"]'), block: 'center' }, check('member-settings-place-before'), ...back, check('member-settings-place-kept')], longThread),
  scene('member-settings-back', 'Escape and the arrow return to the member\'s conversation, and the panel is as it was', [...page, key('Escape'), wait('.page-agent:not([hidden]) .mb-chat .composer'), check('member-settings-back')], filled),
];
