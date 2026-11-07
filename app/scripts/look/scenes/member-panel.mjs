import { scene, member, click, wait, check, key, hover } from './steps.mjs';

const details = [member(1), {action:'open-details'}, wait('.mb-det[data-details-tab="details"] .mb-panel-routines')];
const computer = [...details, click('.mb-tabs [data-tab="computer"]'), wait('.desktop-panel:not([hidden]) .desktop-message')];
const state = (value, extra = {}) => ({desktop:{state:value,ready:value==='running',control:'member',host:'',target:'synthetic-member',...extra}});
export default [
  scene('member-panel-details', 'Details opens first with the routines and no list of past work', [...details,wait('.mb-rts .mb-rt'),check('member-panel-details')]),
  scene('member-panel-details-empty', 'Details keeps one-line empty sections', [...details,check('member-panel-details-empty')], {routineEmpty:true}),
  scene('member-panel-library', 'Arrow navigation reaches Library with shared file chips and bounded Show more', [...details,click('.mb-tabs [data-tab="details"]'),key('ArrowRight'),wait('.mb-det[data-details-tab="library"] [data-panel-file]'),check('member-panel-library'),click('[data-panel-more]'),wait('[data-panel-file="sample-14"]'),check('member-panel-library-more')], {memberPanelFiles:true}),
  scene('member-panel-library-empty', 'Library keeps its empty sentence and arrow keys reach Computer and return', [...details,click('.mb-tabs [data-tab="library"]'),wait('.mb-det[data-details-tab="library"] .mp-empty'),check('member-panel-library-empty'),key('ArrowRight'),wait('.mb-det[data-details-tab="computer"]'),key('ArrowLeft'),wait('.mb-det[data-details-tab="library"]'),check('member-panel-library-empty')]),
  scene('member-panel-computer-live', 'The Computer tab of the panel shows the existing live stream', [member(1),{action:'open-details'},click('.page-agent #member-tab-computer'),wait('.desktop-screen iframe:not([hidden])'),check('member-panel-computer-live')], state('running')),
  ...[
    ['asleep',state('stopped')], ['starting',state('starting')], ['waking',state('preparing',{lifecycle:'waking'})], ['updating',state('building',{lifecycle:'updating'})], ['repairing',state('preparing',{lifecycle:'repairing'})],
    ['docker-stopped',state('unavailable',{error:'docker_stopped'})], ['docker-missing',state('absent',{error:'docker_missing'})],
    ['remote', {...state('unavailable',{error:'remote_unavailable',host:'studio-mini'}),computerHost:'studio-mini'}], ['image-missing',state('missing',{image:false})],
  ].map(([name, fixture]) => scene(`member-panel-computer-${name}`, 'A short header word agrees with the single screen sentence and nonoverlapping recovery', name==='starting'||['waking','updating','repairing'].includes(name)
    ? [...details,click('.mb-tabs [data-tab="computer"]'),wait('.desktop-stage'),check('member-panel-computer-state'),check('panel-state-layout')]
    : [...computer,check(`member-panel-computer-${name}`),check('panel-state-layout')], fixture)),
  scene('member-panel-docker-start', 'Only an owner press starts this PC and the ready result stays contextual', [...computer,click('[data-desktop="retry"]'),wait('.desktop-error:not([hidden])'),check('member-panel-docker-start')], state('unavailable',{error:'docker_stopped'})),
  scene('member-panel-location-hover', 'The computer location is words and a chevron with no frame or fill, even under the pointer', [...computer,hover('.desktop-location-header [data-computer-location]'),check('member-panel-location-hover')], {...state('unavailable',{error:'remote_unavailable',host:'mac-mini'}),computerHost:'mac-mini'}),
  scene('member-panel-remote-location', 'Remote recovery opens the existing location control', [...computer,click('[data-desktop-location]'),wait('.computer-location-popover'),check('member-panel-remote-location')], state('unavailable',{error:'docker_stopped'})),
];
