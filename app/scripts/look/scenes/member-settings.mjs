import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scene, member, click, hover, wait, check, key, scroll, waitScrollEnd, type } from './steps.mjs';
import { learnedSkill, sharedSourceSkill } from './chat.mjs';

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../fixture.json'), 'utf8'));
const withSlime = (id, avatar) => fixture.members.map(item => item.id === id ? {...item, avatar} : item);
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
// The personality and instructions kind (owner, 2026-11-12): two quiet rows of the member's words, each a pencil away from a field.
const manner = '嚴厲但耐心，直接稱呼你。';
const job = '教我日文 N1 等級 嚴厲的老師';
// Twenty lines, some long enough to wrap: it must read whole as a row and edit whole as a field.
const longJob = [
  '每天開始前，先用日文問我一個問題，並等我回答。', '我答錯時，先指出是哪一個文法或單字錯了，再給正確說法。', '不要直接給答案，先給一個提示，讓我再試一次。',
  '所有日文句子都附上假名讀音，漢字不要省略讀音。', '解釋文法時用中文，例句用日文，例句不超過兩句。', '每週五把這一週錯過的單字整理成一張清單給我。',
  '單字清單依照 JLPT N1 的出題範圍排序，先放我最常錯的。', '遇到我偷懶或敷衍的回答，要明白地說出來，不用客氣。', '稱讚要具體，說清楚哪一句寫得好、好在哪裡。',
  '我問閒聊的問題時，也用日文回答，並在最後加一行中文翻譯。', '不要一次丟出太多新單字，每次最多五個。', '考試前兩週，每天加一次限時的閱讀練習。',
  '閱讀文章從新聞、小說和論述文輪流選，長度約四百字。', '每篇文章後面問三個問題，其中一個問作者的立場。', '我寫的作文要逐句批改，用刪除線和新句子標出差別。',
  '批改之後，把最常犯的三種錯誤另外寫成一段總結。', '如果我連續三天沒有練習，下一次開頭先問我發生了什麼事。', '不要假裝知道我沒有教過你的教材內容。',
  '任何時候都不要用英文解釋，除非我明說要用。', '最後一條：每個月底，幫我寫一段這個月的進步與下個月的目標。',
].join('\n');
const persona = (personality, instructions) => ({ ...filled, persona: { name: '紫苑', role: '日文老師', personality, instructions } });
const soul = [...page, ...kind('soul', '.ms-pane [data-k="ms-personality"]')];
const edit = field => [click(`.ms-pane [data-ms="edit"][data-field="${field}"]`), wait(`.ms-pane #ms-${field}`)];
const typed = '嚴厲但耐心，直接稱呼你。\n講日文時先說一遍，再用中文解釋。';
const personaScenes = [
  scene('member-persona-empty', 'Nothing written: the personality and the instructions are each one quiet line of what could stand there, with a pencil, and no box', [...soul, check('member-settings-persona-empty')], persona('', '')),
  scene('member-persona-filled', 'Both written: each is a row of its words as they are, with a pencil, in the same cards as the other kinds', [...soul, check('member-settings-persona-filled')], persona(manner, job)),
  scene('member-persona-mixed', 'The usual page: no personality (one quiet line), the instructions as words, both the same kind of row', [...soul, check('member-settings-persona-mixed')], persona('', job)),
  scene('member-persona-long', 'Twenty lines of instructions read whole as a row, in lines no wider than a page of text', [...soul, check('member-settings-persona-long')], persona(manner, longJob)),
  scene('member-persona-editing', 'A press on the personality turns its row into a field in place with the words typed, as tall as its words and with no grip', [...soul, ...edit('personality'), type('.ms-pane #ms-personality', typed), check('member-settings-persona-editing')], persona('', job)),
  scene('member-persona-editing-long', 'The twenty lines open whole in their field: no inner scrollbar, no grip, the same width as the row', [...soul, ...edit('instructions'), check('member-settings-persona-editing-long')], persona(manner, longJob)),
  scene('member-persona-saved', 'Enter on one line saves it: the row is back with the new words, the pencil is back and nothing is said', [...soul, ...edit('personality'), type('.ms-pane #ms-personality', manner), key('Enter'), wait('.ms-pane [data-ms="edit"][data-field="personality"]:not([aria-busy])'), check('member-settings-persona-saved')], persona('', job)),
  scene('member-persona-escape', 'Escape puts the old words back, saves nothing and says nothing', [...soul, ...edit('instructions'), type('.ms-pane #ms-instructions', '全部改掉'), key('Escape'), wait('.ms-pane [data-ms="edit"][data-field="instructions"]'), check('member-settings-persona-escape')], persona(manner, job)),
];
export default [
  ...personaScenes,
  scene('member-settings', 'The gear opens the member as a page: a cover it can change, the face across it, name and role in place, the kinds of settings on the left and only the chosen one beside them', [...page, check('member-settings')], filled),
  scene('member-settings-raphael', 'Raphael has the same page and the same kinds as every member: tools, skills and commands, personality and instructions, notifications', [{ action: 'open-details' }, click('.mb-det [data-det="gear"]'), wait('.ms-pane:not([hidden]) .ms-name'), wait('.ms-pane .ms-nav [data-cat="tools"][aria-current="page"]'), check('member-settings'), check('member-settings-raphael')], filled),
  scene('member-settings-skills', 'Skills and commands: names with switches and pluses, nothing else on the page', [...page, ...kind('skills', '.ms-pane [data-k="ms-skills"]'), check('member-settings')], filled),
  scene('member-settings-tools', 'The tools kind: each connection with its mark and a switch, the drafts switch under them', [...page, ...kind('tools', '.ms-pane [data-k="ms-tools"]'), check('member-settings')], filled),
  scene('member-settings-notify', 'The notifications kind: one switch, and no voice anywhere', [...page, ...kind('notify', '.ms-pane [data-k="ms-notify"]'), check('member-settings')], filled),
  scene('member-settings-field', 'A long field is a row of its words; a press opens its field in place and leaving it saves', [...page, ...kind('soul', '.ms-pane [data-k="ms-personality"]'), click('.ms-pane [data-ms="edit"][data-field="personality"]'), wait('.ms-pane #ms-personality'), check('member-settings-field')], filled),
  scene('member-settings-skill', 'A skill opens in a view of its own with its text, and the arrow goes back to the page', [...page, ...kind('skills', '.ms-pane [data-ms="skill-open"]'), click('.ms-pane [data-ms="skill-open"]'), wait('.ms-pane #ms-skill-text'), check('member-settings-skill')], filled),
  scene('member-settings-command', 'A command opens in a view of its own with its name, description and template', [...page, ...kind('skills', '.ms-pane [data-ms="command-open"]'), click('.ms-pane [data-ms="command-open"]'), wait('.ms-pane #ms-command-name'), check('member-settings-command')], filled),
  scene('member-settings-cover', 'The cover\'s round button opens its patterns as small covers and a picture from this PC', [...page, click('.ms-pane [data-ms="cover"]'), wait('#app-popover .ms-swatch'), check('member-settings-cover')], filled),
  scene('member-settings-cover-picture', 'The owner\'s picture as the cover fills it and cannot be dragged out of the window', [...page, wait('.ms-pane .ms-cover-img'), check('member-settings-cover-picture')], { ...filled, coverPicture: true }),
  scene('member-settings-back-hover', 'On the owner\'s picture the way back keeps its round surface under the pointer', [...page, wait('.ms-pane .ms-cover-img'), hover('.ms-pane [data-ms="back"]'), check('member-settings-back-hover')], { ...filled, coverPicture: true }),
  // The page hides the conversation, and a hidden scroller forgets its place: the way back puts it where it was (owner, 2026-11-11).
  scene('member-settings-back-bottom', 'Back from the settings page a thread that was at its bottom is at its bottom', [member(1), wait('.tn[data-id="300050"]'), waitScrollEnd('.mb-chat .ra-scroll'), ...back, waitScrollEnd('.mb-chat .ra-scroll'), check('member-settings-place-bottom')], longThread),
  scene('member-settings-back-kept', 'Back from the settings page a thread read higher up stays where it was', [member(1), wait('.tn[data-id="300035"]'), { ...scroll('.tn[data-id="300035"]'), block: 'center' }, check('member-settings-place-before'), ...back, check('member-settings-place-kept')], longThread),
  scene('member-settings-back', 'Escape and the arrow return to the member\'s conversation, and the panel is as it was', [...page, key('Escape'), wait('.page-agent:not([hidden]) .mb-chat .composer'), check('member-settings-back')], filled),
  // A member's colour is on the switches of its settings page too (owner, 2026-11-12), light slimes keeping a knob that shows.
  scene('member-switch-tools', 'The tools kind: the switches that are on wear the member\'s colour, the drafts switch under them too', [...page, ...kind('tools', '.ms-pane [data-k="ms-tools"]'), wait('.ms-pane .tg[aria-checked="true"]'), check('member-switch')], filled),
  scene('member-switch-tools-yellow', 'A yellow slime\'s settings switches keep a knob that shows', [...page, ...kind('tools', '.ms-pane [data-k="ms-tools"]'), wait('.ms-pane .tg[aria-checked="true"]'), check('member-switch-light')], { ...filled, members: withSlime(1, 'slime:ramiris') }),
  scene('member-switch-skills', 'The skills kind: a skill that is on wears the member\'s colour', [...page, ...kind('skills', '.ms-pane [data-k="ms-skills"]'), wait('.ms-pane .tg[aria-checked="true"]'), check('member-switch')], filled),
  scene('member-switch-notify', 'The notifications kind: its one switch, once on, wears the member\'s colour', [...page, ...kind('notify', '.ms-pane [data-k="ms-notify"]'), wait('.ms-pane [data-ms="notify"][aria-checked="true"]'), check('member-switch')], { ...filled, members: fixture.members.map(item => item.id === 1 ? { ...item, notify: true } : item) }),
  scene('member-switch-notify-off', 'A switch that is off keeps its look in the member\'s settings: no colour, the grey knob at the left', [...page, ...kind('notify', '.ms-pane [data-k="ms-notify"]'), wait('.ms-pane [data-ms="notify"][aria-checked="false"]'), check('member-switch-off')], { ...filled, members: fixture.members.map(item => item.id === 1 ? { ...item, notify: false } : item) }),
];
