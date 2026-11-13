import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scene, member, click, wait, check, key, hover } from './steps.mjs';

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../fixture.json'), 'utf8'));
/** The fixture's members with member `id` as the slime `avatar` (a yellow or a white-ish one, for the colour on its switches). */
const withSlime = (id, avatar) => fixture.members.map(item => item.id === id ? {...item, avatar} : item);
const details = [member(1), {action:'open-details'}, wait('.mb-det[data-details-tab="details"] .mb-panel-routines')];
// Nothing is written over an offline computer, so scenes wait for the state the panel keeps in data.
const computer = (phase = 'unavailable') => [...details, click('.mb-tabs [data-tab="computer"]'), wait(`.desktop-panel:not([hidden])[data-desktop-state="${phase}"]`)];
const state = (value, extra = {}) => ({desktop:{state:value,ready:value==='running',control:'member',host:'',target:'synthetic-member',...extra}});
export default [
  scene('member-panel-details', 'Details opens first with the routines and no list of past work', [...details,wait('.mb-rts .mb-rt'),check('member-panel-details')]),
  scene('member-panel-details-empty', 'Details keeps one-line empty sections', [...details,check('member-panel-details-empty')], {routineEmpty:true}),
  // The computer is one quiet row for every member, never asked about (owner, 2026-11-11): asleep, connecting or awake with a small screen,
  // or one line with the one action that fixes a PC that cannot give one.
  ...[
    ['asleep', state('stopped'), 'asleep'], ['connecting', state('starting'), 'connecting'], ['awake', state('running'), 'awake'],
    // A member's own tool woke it (R-COMP-WAKE-01): the line that names the member and why stands where 已喚醒 does.
    ['awake-woken', state('running', {woken:{member:1,name:'小晴',reason:'page'}}), 'awake'],
    ['docker-missing', state('absent', {error:'docker_missing'}), 'unavailable'], ['docker-stopped', state('unavailable', {error:'docker_stopped'}), 'unavailable'],
    ['remote', {...state('unavailable', {error:'remote_unavailable', host:'studio-mini'}), computerHost:'studio-mini'}, 'unavailable'],
  ].map(([kind, fixture, phase]) => scene(`member-panel-details-computer-${kind}`, 'Details carries one computer row: its state in a word or two and a small screen, or one line and its one fix', [...details,
    wait(`.mb-computer[data-computer-state="${phase}"]`), ...(kind === 'awake' ? [wait('.mb-computer-thumb[data-thumb="live"]')] : []), check(`member-panel-details-computer-${kind}`)], fixture)),
  scene('member-panel-details-computer-open', 'One press on the computer row opens the running computer in the larger view', [...details, wait('.mb-computer-thumb[data-thumb="live"]'),
    click('.mb-computer-row'), wait(':root[data-desktop-watch]'), check('desktop-watch')], state('running')),
  scene('member-panel-details-computer-wake', 'One press on the sleeping computer row wakes it in the Computer tab', [...details, wait('.mb-computer[data-computer-state="asleep"]'),
    click('.mb-computer-row'), wait('.mb-det[data-details-tab="computer"] .desktop-screen iframe:not([hidden])'), hover('.mb-det-head'), check('member-panel-computer-live')], {...state('stopped'), desktopStarts:true}),
  scene('member-panel-library', 'Arrow navigation reaches Library, as Grok Bot\'s: the four chips always, groups by recency, each one card of one-line rows; everything the member delivered, no links', [...details,click('.mb-tabs [data-tab="details"]'),key('ArrowRight'),wait('.mb-det[data-details-tab="library"] [data-panel-file]'),wait('.lib-thumb img[src]'),check('member-panel-library')], {memberPanelFiles:true}),
  ...[['pages', '頁面'], ['media', '媒體'], ['files', '檔案']].map(([chip, word]) => scene(`member-panel-library-${chip}`, `The ${word} chip narrows the Library to its kind, in the same cards`, [...details,click('.mb-tabs [data-tab="library"]'),wait('.mb-det[data-details-tab="library"] [data-panel-file]'),wait('.lib-thumb img[src]'),click(`[data-lib-filter="${chip}"]`),wait(`[data-lib-filter="${chip}"][aria-pressed="true"]`),check(`member-panel-library-${chip}`)], {memberPanelFiles:true})),
  // A member whose deliverables are all one kind still has the four chips (owner, 2026-11-13); the chip of a kind it has not
  // delivered opens to one quiet line.
  scene('member-panel-library-single', 'A Library of one kind alone still shows 全部 / 頁面 / 媒體 / 檔案, with that kind\'s cards under 全部', [...details,click('.mb-tabs [data-tab="library"]'),wait('.mb-det[data-details-tab="library"] [data-panel-file]'),wait('.lib-thumb img[src]'),check('member-panel-library-single')], {memberPanelFiles:'single'}),
  scene('member-panel-library-single-pages', 'The 頁面 chip of a Library with no pages is one quiet line in the cards\' place', [...details,click('.mb-tabs [data-tab="library"]'),wait('.mb-det[data-details-tab="library"] [data-panel-file]'),click('[data-lib-filter="pages"]'),wait('[data-lib-filter="pages"][aria-pressed="true"]'),wait('.lib-filters + .mp-empty'),check('member-panel-library-single-pages')], {memberPanelFiles:'single'}),
  scene('member-panel-library-long', 'A long Library (the core\'s bound of 100) is every kind in cards that scroll inside the panel, with no Show more', [...details,click('.mb-tabs [data-tab="library"]'),wait('.mb-det[data-details-tab="library"] [data-panel-file]'),check('member-panel-library-long')], {memberPanelFiles:'long'}),
  scene('member-panel-library-open', 'A delivered file opens with the computer\'s own program, and a picture opens large', [...details,click('.mb-tabs [data-tab="library"]'),wait('.lib-thumb img[src]'),click('[data-panel-file="delivered-file:bundle"]'),click('.lib-row:has(.lib-thumb)'),wait('.media-lightbox'),check('member-panel-library-open')], {memberPanelFiles:true}),
  scene('member-panel-library-empty', 'Library keeps its empty sentence and arrow keys reach Computer and return', [...details,click('.mb-tabs [data-tab="library"]'),wait('.mb-det[data-details-tab="library"] .mp-empty'),check('member-panel-library-empty'),key('ArrowRight'),wait('.mb-det[data-details-tab="computer"]'),key('ArrowLeft'),wait('.mb-det[data-details-tab="library"]'),check('member-panel-library-empty')]),
  scene('member-panel-computer-live', 'The Computer tab of the panel shows the existing live stream', [member(1),{action:'open-details'},click('.page-agent #member-tab-computer'),wait('.desktop-screen iframe:not([hidden])'),check('member-panel-computer-live')], state('running')),
  ...[
    ['asleep',state('stopped'),'stopped'], ['starting',state('starting'),'starting'], ['waking',state('preparing',{lifecycle:'waking'}),'preparing'], ['updating',state('building',{lifecycle:'updating'}),'building'], ['repairing',state('preparing',{lifecycle:'repairing'}),'preparing'],
    ['docker-stopped',state('unavailable',{error:'docker_stopped'}),'unavailable'], ['docker-missing',state('absent',{error:'docker_missing'}),'unavailable'],
    ['remote', {...state('unavailable',{error:'remote_unavailable',host:'studio-mini'}),computerHost:'studio-mini'},'unavailable'], ['image-missing',state('missing',{image:false}),'stopped'],
  ].map(([name, fixture, phase]) => scene(`member-panel-computer-${name}`, 'The screen over an offline computer is the wallpaper alone: no words, face, button or header word, and a press starts it', name==='starting'||['waking','updating','repairing'].includes(name)
    ? [...computer(phase),check('member-panel-computer-state'),check('panel-state-layout')]
    : [...computer(phase),check(`member-panel-computer-${name}`),check('panel-state-layout')], fixture)),
  scene('member-panel-docker-start', 'Only an owner press on the screen starts this PC and the ready result stays contextual', [...computer('unavailable'),click('[data-desktop="enlarge"]'),wait('.desktop-error:not([hidden])'),check('member-panel-docker-start')], state('unavailable',{error:'docker_stopped'})),
  scene('member-panel-location-hover', 'The computer location is words and a chevron with no frame or fill, even under the pointer', [...computer('unavailable'),hover('.desktop-location-header [data-computer-location]'),check('member-panel-location-hover')], {...state('unavailable',{error:'remote_unavailable',host:'mac-mini'}),computerHost:'mac-mini'}),
  scene('member-panel-remote-location', 'An unavailable computer keeps the header location control, which opens the existing popover', [...computer('unavailable'),click('.desktop-location-header [data-computer-location]'),wait('.computer-location-popover'),check('member-panel-remote-location')], state('unavailable',{error:'docker_stopped'})),
  // A member's colour is on its switches too (owner, 2026-11-12): a routine that is on in the member's panel, the panel of a yellow
  // and of a white-ish slime (a knob that still shows), and Raphael's own in his blue.
  scene('member-switch', 'In the member\'s panel a routine that is on has a switch in the member\'s colour, and the off ones are as they were', [...details, wait('.mb-routine-row .tg[aria-checked="true"]'), check('member-switch')]),
  scene('member-switch-yellow', 'A yellow slime\'s switch keeps a knob that shows', [...details, wait('.mb-routine-row .tg[aria-checked="true"]'), check('member-switch-light')], {members: withSlime(1, 'slime:ramiris')}),
  scene('member-switch-white', 'A white-ish slime\'s switch keeps a knob that shows', [...details, wait('.mb-routine-row .tg[aria-checked="true"]'), check('member-switch-light')], {members: withSlime(1, 'slime:testarossa')}),
  scene('member-switch-raphael', 'Raphael\'s own panel wears Raphael\'s blue on a routine that is on', [{action:'open-details'}, wait('.mb-routine-row .tg[aria-checked="true"]'), check('member-switch')]),
];
