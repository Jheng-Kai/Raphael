import { scene, member, click, wait, check, key } from './steps.mjs';

const details = [member(1), {action:'open-details'}, wait('.mb-det[data-details-tab="details"] .mb-panel-tasks')];
const computer = [...details, click('.mb-tabs [data-tab="computer"]'), wait('.desktop-panel:not([hidden]) .desktop-message')];
const state = (value, extra = {}) => ({desktop:{state:value,ready:value==='running',control:'member',host:'',target:'synthetic-member',...extra}});
export default [
  scene('member-panel-details', 'Details opens first with newest work, routines and conversations', [...details,wait('[data-panel-task]'),check('member-panel-details')], {memberPanelWork:true}),
  ...[['stop',701],['rerun',703]].map(([action,id]) => scene(`member-panel-task-${action}`, 'Work actions reuse the contextual menu without acting on read', [...details,wait('[data-panel-task]'),click(`[data-panel-task-menu="${id}"]`),wait('.menu [role="menuitem"]'),check(`member-panel-task-${action}`)], {memberPanelWork:true})),
  scene('member-panel-details-empty', 'Details keeps one-line empty sections', [...details,check('member-panel-details-empty')], {routineEmpty:true}),
  scene('member-panel-library', 'Arrow navigation reaches Library with shared file chips and bounded Show more', [...details,click('.mb-tabs [data-tab="details"]'),key('ArrowRight'),wait('.mb-det[data-details-tab="library"] [data-panel-file]'),check('member-panel-library'),click('[data-panel-more]'),wait('[data-panel-file="sample-14"]'),check('member-panel-library-more')], {memberPanelFiles:true}),
  scene('member-panel-library-empty', 'Library keeps its empty sentence and arrow keys reach Computer and return', [...details,click('.mb-tabs [data-tab="library"]'),wait('.mb-det[data-details-tab="library"] .mp-empty'),check('member-panel-library-empty'),key('ArrowRight'),wait('.mb-det[data-details-tab="computer"]'),key('ArrowLeft'),wait('.mb-det[data-details-tab="library"]'),check('member-panel-library-empty')]),
  scene('member-panel-computer-live', 'The chat monitor selects Computer with the existing live stream', [member(1),click('.page-agent [data-act="computer"]'),wait('.desktop-screen iframe:not([hidden])'),check('member-panel-computer-live')], state('running')),
  ...[
    ['asleep',state('stopped')], ['starting',state('starting')], ['waking',state('preparing',{lifecycle:'waking'})], ['updating',state('building',{lifecycle:'updating'})], ['repairing',state('preparing',{lifecycle:'repairing'})],
    ['docker-stopped',state('unavailable',{error:'docker_stopped'})], ['docker-missing',state('absent',{error:'docker_missing'})],
    ['remote', {...state('unavailable',{error:'remote_unavailable',host:'studio-mini'}),computerHost:'studio-mini'}], ['image-missing',state('missing',{image:false})],
  ].map(([name, fixture]) => scene(`member-panel-computer-${name}`, 'A short header word agrees with the single screen sentence and nonoverlapping recovery', name==='starting'||['waking','updating','repairing'].includes(name)
    ? [...details,click('.mb-tabs [data-tab="computer"]'),wait('.desktop-stage'),check('member-panel-computer-state'),check('panel-state-layout')]
    : [...computer,check(`member-panel-computer-${name}`),check('panel-state-layout')], fixture)),
  scene('member-panel-docker-start', 'Only an owner press starts this PC and the ready result stays contextual', [...computer,click('[data-desktop="retry"]'),wait('.desktop-error:not([hidden])'),check('member-panel-docker-start')], state('unavailable',{error:'docker_stopped'})),
  scene('member-panel-remote-location', 'Remote recovery opens the existing location control', [...computer,click('[data-desktop-location]'),wait('.computer-location-popover'),check('member-panel-remote-location')], state('unavailable',{error:'docker_stopped'})),
];
