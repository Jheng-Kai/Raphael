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
const fixed = (value: number): string => String(+value.toFixed(3));
/** A drop of `y` down the strip, as it reads inside a body pose (the inverse of the pose's rotation and scale applied to it). */
function dropWithin(pose: ReturnType<typeof sample>, y: number): [number, number] {
  const angle = (pose.rotate[0] ?? 0) * Math.PI / 180;
  return [y * Math.sin(angle) / (pose.scale[0] ?? 1), y * Math.cos(angle) / (pose.scale[1] ?? pose.scale[0] ?? 1)];
}
function staticMarks(markup: string): string {
  const skipped: boolean[] = [];
  return markup.replace(/<\/?g\b[^>]*>/g, tag => {
    if(tag.startsWith('</'))return skipped.pop()?'':tag;
    const skip=/class="slime-(?:correction|counterturn)"/.test(tag);
    skipped.push(skip);return skip?'':tag;
  });
}

/** Independent strip axes retain the body's and the eyes' original periods without scaling a raster. */
export function motionStrips(state: LoopState, body: string, eyes: string, back = '', worn = ''): [string, string] {
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
  // An eye cel is its body cel's place and pose (the group's transform attribute), then the face (slime.css: the separate
  // translate and scale of .slime-cel-eye), then its gaze and blink (the path's own transform attribute). WebKit (macOS)
  // multiplies the lengths of an SVG element's CSS `transform` by the page zoom (the window's ⌘+ and ⌘-), and the attribute
  // and the separate properties keep the drawing's units: placed by CSS transforms, the eyes of cel n stood n tenths of a
  // cel off at 110 %, so in a looping strip they slid out of the body and back. One group per body cel, so a strip of some
  // 1,500 eye paths gains a few dozen nodes; a row of gaze or blink is a drop down the strip, carried inside the pose.
  const looks = Array.from({length:gazes}, (_, gazeIndex) => {
    const gaze = sample(`slime-${state}-gaze`,gazeIndex/gazes,timing.gaze);
    if (state === 'blocked') gaze.translate = [0,-6];
    return poseTransform(gaze);
  });
  const origin = 50;
  const eyeCells = poses.map((pose, bodyIndex) => `<g class="slime-cel-pose" transform="translate(${bodyIndex*FRAME} 0) ${aboutBase(pose)}">` +
    looks.flatMap((look, gazeIndex) => (blink ? blinkPoses : [[1,1]]).map(([sx,sy], blinkIndex) => {
      const [x, y] = dropWithin(pose, (gazeIndex*(blink?4:1)+blinkIndex)*FRAME);
      const row = x || y ? ` style="--cel-row-x:${fixed(x)};--cel-row-y:${fixed(y)}"` : '';
      return `<path class="slime-cel-eye" d="${eyes}" fill="none" stroke="#fff" stroke-linecap="round" transform="${look} translate(50 ${origin}) scale(${sx} ${sy}) translate(-50 -${origin})"${row}/>`;
    })).join('') + '</g>').join('');
  const strips: [string,string] = [strip('body',bodyCells,FRAME*(independent?PROP_ROWS:1)),strip('eyes',eyeCells,FRAME*gazes*(blink?4:1))];
  cache.set(key,strips); return strips;
}
