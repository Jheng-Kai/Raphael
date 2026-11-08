import { LOOPS, PROP_ROWS, celCount, eyeStyle, gazeRows, poseTransform, sample, type LoopState } from './slime-motion';

// A quarter-avatar reserve per edge covers loop overshoot without rasterizing three avatar widths of blank space.
const FRAME = 138;
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
  // Body cels follow the loop's length, so every state shows about the same frames per second.
  const cels = celCount(state), gazes = gazeRows(state);
  // Only independently moving marks need a second body axis. Plain colours and
  // printed marks otherwise repeat identical rows of body geometry.
  const independent = (state === 'thinking' || state === 'searching') && /class="slime-mark"/.test(worn);
  const propPeriod = state === 'thinking' ? 3.6 : timing.body;
  const propDelay = state === 'thinking' ? 140 : state === 'searching' ? 120 : 0;
  const poses = Array.from({length:cels}, (_, index) => bodyPose(state,index/cels));
  const wornAt = (phase: number): string => {
    const angle = sample(`slime-${state}-mark`, phase, timing.ease).rotate[0]!;
    return worn.replace(/class="slime-mark" style="--mark-x:([\d.]+)px;--mark-y:([\d.]+)px;--mark-give:([\d.]+)"/g,
      (_, x, y, give) => `class="slime-mark" style="--mark-x:${x}px;--mark-y:${y}px;--mark-give:${give}" transform="rotate(${angle*Number(give)})"`);
  };
  const strip = (kind: string, cells: string, height = FRAME): string => `<span class="slime-loop slime-loop-${kind}${blink ? ' has-blink' : ''}" data-state="${state}" style='--loop-body:${timing.body}s;--loop-eyes:${timing.eyes}s;--loop-props:${propPeriod}s;--loop-prop-delay:${propDelay}ms;--loop-cels:${cels};--loop-gaze:${gazes};--loop-prop-rows:${PROP_ROWS};--loop-rows:${gazes*(blink?4:1)};${eyeStyle(state)}'><span class="slime-cels">${kind === 'eyes' ? '<span class="slime-eye-cels"><span class="slime-blink-cels">' : independent ? '<span class="slime-prop-cels">' : ''}<svg width="${FRAME*cels}" height="${height}" viewBox="-19 -12 ${FRAME*cels} ${height}">${cells}</svg>${kind === 'eyes' ? '</span></span>' : independent ? '</span>' : ''}</span></span>`;
  const bodyCells = Array.from({length:independent?PROP_ROWS:1},(_,row) => Array.from({length:cels},(_,index) => { const pose=poses[index]!; return `<g transform="translate(${index*FRAME} ${row*FRAME})"><g transform="${aboutBase(pose)}">${back}<path class="slime-cel-body" d="${body}" fill="var(--slime-color)"/>${wornAt(independent?row/PROP_ROWS:index/cels)}</g></g>`; }).join('')).join('');
  const eyeCells = Array.from({length:gazes}, (_, gazeIndex) => {
    const gaze = sample(`slime-${state}-gaze`,gazeIndex/gazes,timing.gaze);
    if (state === 'blocked') gaze.translate = [0,-6];
    return poses.flatMap((pose,bodyIndex) => (blink ? blinkPoses : [[1,1]]).map(([sx,sy],blinkIndex) => {
      const origin = 50;
      // These transforms are static poses; a single path avoids collecting two transient groups per cel.
      const transform=`${cssTransform(`translate(${bodyIndex*FRAME} ${(gazeIndex*(blink?4:1)+blinkIndex)*FRAME}) ${aboutBase(pose)}`)} var(--slime-face-fit,${cssTransform(face)}) ${cssTransform(poseTransform(gaze))} translate(50px,${origin}px) scale(${sx},${sy}) translate(-50px,-${origin}px)`;
      return `<path class="slime-cel-eye" d="${eyes}" fill="none" stroke="#fff" stroke-linecap="round" style="transform:${transform}"/>`;
    })).join('');
  }).join('');
  const strips: [string,string] = [strip('body',bodyCells,FRAME*(independent?PROP_ROWS:1)),strip('eyes',eyeCells,FRAME*gazes*(blink?4:1))];
  cache.set(key,strips); return strips;
}
