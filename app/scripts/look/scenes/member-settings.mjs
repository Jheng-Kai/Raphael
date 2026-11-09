import { scene, member, click, wait, check, key, scroll } from './steps.mjs';
import { learnedSkill, sharedSourceSkill } from './chat.mjs';

// The member settings page (member-settings.ts): the panel's gear opens it where the conversation is.
const gear = [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), wait('.ms-pane .ms-nav [data-cat][aria-current="page"]')];
const page = [member(1), ...gear];
// Chooses a kind in the page's left column and waits for its first section.
const kind = (id, ready) => [click(`.ms-pane .ms-nav [data-cat="${id}"]`), wait(`.ms-pane .ms-nav [data-cat="${id}"][aria-current="page"]`), wait(ready)];
const filled = { memberSettings: true, skills: [learnedSkill(1), sharedSourceSkill] };
export const memberSettingsPage = page;
export default [
  scene('member-settings', 'The gear opens the member as a page: a cover it can change, the face across it, name and role in place, the kinds of settings on the left and only the chosen one beside them', [...page, check('member-settings')], filled),
  scene('member-settings-raphael', 'Raphael has the same page with only his kinds: skills and commands, model, voice, memory and general', [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), wait('.ms-pane .ms-nav [data-cat="skills"][aria-current="page"]'), check('member-settings'), check('member-settings-raphael')], filled),
  scene('member-settings-skills', 'Skills and commands: names with switches and pluses, nothing else on the page', [...page, ...kind('skills', '.ms-pane [data-k="ms-skills"]'), check('member-settings')], filled),
  scene('member-settings-model', 'The model kind: the composer\'s own dropdown as the one row', [...page, ...kind('model', '.ms-pane [data-slot="model"] .mp-trigger'), check('member-settings')], filled),
  scene('member-settings-tools', 'The tools kind: the member\'s connections as switches', [...page, ...kind('tools', '.ms-pane [data-k="ms-tools"]'), check('member-settings')], filled),
  scene('member-settings-voice', 'The voice kind: its voice dropdown and the notify switch', [...page, ...kind('voice', '.ms-pane [data-k="ms-voice"]'), check('member-settings')], filled),
  scene('member-settings-general', 'The general kind: the drafts switch and the group dropdown', [...page, ...kind('general', '.ms-pane [data-k="ms-general"]'), check('member-settings')], filled),
  scene('member-settings-field', 'A long field is one line; a press opens its box in place and blur saves it', [...page, click('.ms-pane [data-ms="edit"][data-field="personality"]'), wait('.ms-pane #ms-personality'), check('member-settings-field')], filled),
  scene('member-settings-skill', 'A skill opens in a view of its own with its text, and the arrow goes back to the page', [...page, ...kind('skills', '.ms-pane [data-ms="skill-open"]'), click('.ms-pane [data-ms="skill-open"]'), wait('.ms-pane #ms-skill-text'), check('member-settings-skill')], filled),
  scene('member-settings-command', 'A command opens in a view of its own with its name, description and template', [...page, ...kind('skills', '.ms-pane [data-ms="command-open"]'), click('.ms-pane [data-ms="command-open"]'), wait('.ms-pane #ms-command-name'), check('member-settings-command')], filled),
  scene('member-settings-memory', 'The memory kind shows both documents beside the column, each with its pencil', [...page, ...kind('memory', '.ms-pane [data-mem-space="own"] .mem-entry'), check('member-settings'), check('member-settings-memory')], filled),
  scene('member-settings-cover', 'The cover\'s round button opens its patterns as small covers and a picture from this PC', [...page, click('.ms-pane [data-ms="cover"]'), wait('#app-popover .ms-swatch'), check('member-settings-cover')], filled),
  scene('member-settings-cover-picture', 'The owner\'s picture as the cover fills it and cannot be dragged out of the window', [...page, wait('.ms-pane .ms-cover-img'), check('member-settings-cover-picture')], { ...filled, coverPicture: true }),
  scene('member-settings-back', 'Escape and the arrow return to the member\'s conversation, and the panel is as it was', [...page, key('Escape'), wait('.page-agent:not([hidden]) .mb-chat .composer'), check('member-settings-back')], filled),
];
