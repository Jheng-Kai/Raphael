import { scene, member, click, wait, check, key, scroll } from './steps.mjs';
import { learnedSkill, sharedSourceSkill } from './chat.mjs';

// The member settings page (member-settings.ts): the panel's gear opens it where the conversation is.
const gear = [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), wait('.ms-pane [data-k="ms-voice"]')];
const page = [member(1), ...gear];
const filled = { memberSettings: true, skills: [learnedSkill(1), sharedSourceSkill] };
export const memberSettingsPage = page;
export default [
  scene('member-settings', 'The gear opens the member as a page: a cover from its slime colour, the face across the cover, name and role in place, then one tinted list per section', [...page, check('member-settings')], filled),
  scene('member-settings-raphael', 'Raphael has the same page with only what is his: skills, commands, model, voice, memory and drafts', [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), wait('.ms-pane [data-k="ms-voice"]'), check('member-settings'), check('member-settings-raphael')], filled),
  scene('member-settings-lower', 'Under the model: the connections as switches, the voice card, the memory row, then the drafts and the group', [...page, scroll('.ms-pane [data-k="ms-more"]'), check('member-settings'), check('member-settings-lower')], filled),
  scene('member-settings-field', 'A long field is one line; a press opens its box in place and blur saves it', [...page, click('.ms-pane [data-ms="edit"][data-field="personality"]'), wait('.ms-pane #ms-personality'), check('member-settings-field')], filled),
  scene('member-settings-skill', 'A skill opens in a view of its own with its text, and the arrow goes back to the page', [...page, click('.ms-pane [data-ms="skill-open"]'), wait('.ms-pane #ms-skill-text'), check('member-settings-skill')], filled),
  scene('member-settings-command', 'A command opens in a view of its own with its name, description and template', [...page, click('.ms-pane [data-ms="command-open"]'), wait('.ms-pane #ms-command-name'), check('member-settings-command')], filled),
  scene('member-settings-memory', 'The memory is one row with its count; a press opens both documents in a view of its own', [...page, check('member-settings-memory-row'), click('.ms-pane [data-ms="memory"]'), wait('.ms-pane [data-mem-space="own"] .mem-entry'), check('member-settings-memory')], filled),
  scene('member-settings-back', 'Escape and the arrow return to the member\'s conversation, and the panel is as it was', [...page, key('Escape'), wait('.page-agent:not([hidden]) .mb-chat .composer'), check('member-settings-back')], filled),
];
