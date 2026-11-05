import source from './slime-motion-data';

type Pose = { translate: number[]; scale: number[]; rotate: number[]; alpha: number[] };
type Frame = { at: number; values: Partial<Pose>; ease?: string };
const defaults: Pose = { translate: [0, 0], scale: [1, 1], rotate: [0], alpha: [1] };
const frames = new Map<string, Frame[]>();
for (const match of source.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
  const list: Frame[] = [];
  for (const frame of match[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const values: Partial<Pose> = {};
    for (const declaration of frame[2]!.split(';')) {
      const [name, text] = declaration.split(':').map(value => value.trim());
      const property = name === '--slime-liquid-alpha' ? 'alpha' : name;
      if (!['translate','rotate','scale','alpha'].includes(property ?? '')) continue;
      // Character give is applied by the caller.
      const value = text!.replace(/calc\(var\(--mark-give\) \* ([-\d.]+)deg\)/g, '$1');
      if (value.includes('calc')) continue;
      const numbers = value.match(/-?[\d.]+/g)?.map(Number);
      if (numbers) values[property as keyof Pose] = numbers;
    }
    const ease = /animation-timing-function:\s*([^;]+)/.exec(frame[2]!)?.[1];
    for (const at of frame[1]!.matchAll(/(\d+(?:\.\d+)?)%|\b(from|to)\b/g)) list.push({ at: at[2] === 'from' ? 0 : at[2] === 'to' ? 1 : Number(at[1]) / 100, values, ease });
  }
  frames.set(match[1]!, list.sort((a,b) => a.at-b.at));
}

export function easing(name: string, x: number): number {
  if (name === 'linear') return x;
  const curves: Record<string, number[]> = { 'ease-in-out':[.42,0,.58,1], 'ease-in':[.42,0,1,1], 'ease-out':[0,0,.58,1], ease:[.25,.1,.25,1] };
  const curve = curves[name] ?? name.match(/-?[\d.]+/g)?.map(Number) ?? [0,0,1,1];
  const [x1,y1,x2,y2] = curve as [number,number,number,number];
  const cubic = (t: number, a: number, b: number): number => 3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
  let low=0, high=1;
  for (let i=0;i<20;i++) { const mid=(low+high)/2; if(cubic(mid,x1,x2)<x)low=mid;else high=mid; }
  return cubic((low+high)/2,y1,y2);
}

/** The vector keyframes are the source of truth; sampling runs once when a character needs a strip. */
export function sample(name: string, phase: number, ease = 'linear'): Pose {
  const list = frames.get(name) ?? [];
  const pose = structuredClone(defaults);
  for (const property of Object.keys(defaults) as (keyof Pose)[]) {
    const keyed = list.filter(frame => frame.values[property]);
    if (!keyed.length) continue;
    const at = ((phase % 1)+1)%1;
    const before = [...keyed].reverse().find(frame => frame.at <= at) ?? {at:0,values:defaults};
    const after = keyed.find(frame => frame.at > at) ?? {at:1,values:defaults};
    const amount = easing(before.ease ?? ease, (at-before.at)/(after.at-before.at || 1));
    pose[property] = defaults[property].map((_, index) => {
      const a = before.values[property]![index] ?? before.values[property]![0]!;
      const b = after.values[property]![index] ?? after.values[property]![0]!;
      return +(a+(b-a)*amount).toFixed(5);
    });
  }
  return pose;
}

export const LOOPS = {
  thinking: {body:2.8, eyes:4.3, ease:'cubic-bezier(.45,.05,.55,.95)', gaze:'cubic-bezier(.25,.9,.3,1)'},
  working: {body:.9, eyes:1.8, ease:'linear', gaze:'linear'},
  searching: {body:3.2, eyes:3.2, ease:'cubic-bezier(.4,0,.3,1)', gaze:'cubic-bezier(.25,.9,.3,1)'},
  computer: {body:1.7, eyes:3.4, ease:'cubic-bezier(.3,0,.3,1)', gaze:'cubic-bezier(.25,.9,.3,1)'},
  waiting: {body:6, eyes:6, ease:'ease-in-out', gaze:'ease-in-out'},
  blocked: {body:1.8, eyes:1.8, ease:'linear', gaze:'linear'},
  error: {body:6, eyes:6, ease:'ease-in', gaze:'linear'},
} as const;
export type LoopState = keyof typeof LOOPS;
export const CEL_COUNT = 12;
export const loopState = (state: string): state is LoopState => state in LOOPS;
export function poseTransform(pose: Pose): string {
  return `translate(${pose.translate.join(' ')}) rotate(${pose.rotate[0]}) scale(${pose.scale.join(' ')})`;
}

export function eyeStyle(state: string): string {
  const rule = new RegExp(`\\.slime\\[data-state="${state}"\\] \\{([^}]+)`).exec(source)?.[1] ?? '';
  const base = /\.slime \{ ([^}]*--eyes:[^}]+)\}/.exec(source)?.[1] ?? '';
  return (base+rule).replace(/--eye-y:[^;]+;/g, '');
}
