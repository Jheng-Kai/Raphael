import { CEL_COUNT, LOOPS, eyeStyle, poseTransform, sample, type LoopState } from './slime-motion';

const FRAME = 276;
const cache = new Map<string, [string, string]>();
const blinkPoses = [0, .085, .09, .124].map(phase => sample('slime-blink',phase).scale);
const bodyPose = (state: LoopState, phase: number): ReturnType<typeof sample> => {
  const pose = sample(`slime-${state}-body`, phase, LOOPS[state].ease);
  if (state === 'error') pose.scale = [1.08,.62];
  return pose;
};
const aboutBase = (pose: ReturnType<typeof sample>): string => `translate(50 86) ${poseTransform(pose)} translate(-50 -86)`;
const cssTransform = (value: string): string => value.replace(/(translate|rotate|scale)\(([^)]+)\)/g, (_, kind, numbers: string) =>
  `${kind}(${numbers.trim().split(/[ ,]+/).map(number => number+(kind==='translate'?'px':kind==='rotate'?'deg':'')).join(',')})`);
function staticMarks(markup: string): string {
  const skipped: boolean[] = [];
  return markup.replace(/<\/?g\b[^>]*>/g, tag => {
    if(tag.startsWith('</'))return skipped.pop()?'':tag;
    const skip=/class="slime-(?:correction|counterturn)"/.test(tag);
    skipped.push(skip);return skip?'':tag;
  });
}

/** Independent strip axes retain the body's and the eyes' original periods without scaling a raster. */
export function motionStrips(state: LoopState, body: string, eyes: string, face: string, back = '', worn = ''): [string, string] {
  const key = `${state}|${back}|${worn}`;
  const cached = cache.get(key); if (cached) return cached;
  back=staticMarks(back);worn=staticMarks(worn);
  const timing = LOOPS[state], blink = state === 'thinking' || state === 'searching';
  const gazeRows = ['thinking','searching','computer','waiting'].includes(state) ? CEL_COUNT : 1;
  const independent = state === 'thinking' || state === 'searching';
  const bodyColumns = CEL_COUNT;
  const propPeriod = state === 'thinking' ? 3.6 : timing.body;
  const propDelay = state === 'thinking' ? 140 : state === 'searching' ? 120 : 0;
  const poses = Array.from({length:CEL_COUNT}, (_, index) => bodyPose(state,index/CEL_COUNT));
  const wornAt = (phase: number): string => {
    const angle = sample(`slime-${state}-mark`, phase, timing.ease).rotate[0]!;
    return worn.replace(/class="slime-mark" style="--mark-x:([\d.]+)px;--mark-y:([\d.]+)px;--mark-give:([\d.]+)"/g,
      (_, x, y, give) => `class="slime-mark" style="--mark-x:${x}px;--mark-y:${y}px;--mark-give:${give}" transform="rotate(${angle*Number(give)})"`);
  };
  const props = (phase: number): string => {
    if (state !== 'sleeping') return '';
    const pose = sample('slime-bubble', phase, 'ease-in-out');
    return `<g class="slime-cel-prop" transform="${poseTransform(pose)}" opacity="${pose.alpha[0]}" fill="var(--slime-color)"><circle r="5.5"/></g>`;
  };
  const strip = (kind: string, cells: string, height = FRAME): string => `<span class="slime-loop slime-loop-${kind}${blink ? ' has-blink' : ''}" data-state="${state}" style='--loop-body:${timing.body}s;--loop-eyes:${timing.eyes}s;--loop-props:${propPeriod}s;--loop-prop-delay:${propDelay}ms;--loop-rows:${gazeRows*(blink?4:1)};${eyeStyle(state)}'><span class="slime-cels">${kind === 'eyes' ? '<span class="slime-eye-cels"><span class="slime-blink-cels">' : independent ? '<span class="slime-prop-cels">' : ''}<svg width="${FRAME*(kind==='body'?bodyColumns:CEL_COUNT)}" height="${height}" viewBox="-88 -81 ${FRAME*(kind==='body'?bodyColumns:CEL_COUNT)} ${height}">${cells}</svg>${kind === 'eyes' ? '</span></span>' : independent ? '</span>' : ''}</span></span>`;
  const bodyCells = Array.from({length:independent?CEL_COUNT:1},(_,row) => Array.from({length:bodyColumns},(_,index) => { const pose=poses[index%CEL_COUNT]!; return `<g transform="translate(${index*FRAME} ${row*FRAME})"><g data-loop-pose='${JSON.stringify(pose)}' transform="${aboutBase(pose)}">${back}<path class="slime-cel-body" d="${body}" fill="var(--slime-color)"/>${wornAt(independent?row/CEL_COUNT:index/CEL_COUNT)}</g>${props(index/CEL_COUNT)}</g>`; }).join('')).join('');
  const eyeCells = Array.from({length:gazeRows}, (_, gazeIndex) => {
    const gaze = sample(`slime-${state}-gaze`,gazeIndex/CEL_COUNT,timing.gaze);
    if (state === 'blocked') gaze.translate = [0,-6];
    return poses.flatMap((pose,bodyIndex) => (blink ? blinkPoses : [[1,1]]).map(([sx,sy],blinkIndex) => {
      const origin = state === 'sleeping' ? 52 : 50;
      // These transforms are static poses; a single path avoids collecting two transient groups per cel.
      const transform=`${cssTransform(`translate(${bodyIndex*FRAME} ${(gazeIndex*(blink?4:1)+blinkIndex)*FRAME}) ${aboutBase(pose)}`)} var(--slime-face-fit,${cssTransform(face)}) ${cssTransform(poseTransform(gaze))} translate(50px,${origin}px) scale(${sx},${sy}) translate(-50px,-${origin}px)`;
      return `<path class="slime-face slime-cel-eye" d="${eyes}" fill="none" stroke="#fff" stroke-linecap="round" style="transform:${transform}"/>`;
    })).join('');
  }).join('');
  const strips: [string,string] = [strip('body',bodyCells,FRAME*(independent?CEL_COUNT:1)),strip('eyes',eyeCells,FRAME*gazeRows*(blink?4:1))];
  cache.set(key,strips); return strips;
}
