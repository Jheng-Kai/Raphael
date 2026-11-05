import { expect, test } from 'vitest';
import { LOOPS, eyeStyle, loopState, sample } from './slime-motion';
import raw from './slime-motion-data';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { motionSource } from '../../scripts/slime-cels.mjs';

test('the loop reserve retains the body and accessory envelope at every sampled pose', () => {
  // Includes the outermost wings/hat, with padding for their independent mark rotation.
  for (const state of Object.keys(LOOPS) as (keyof typeof LOOPS)[]) {
    for (let cel = 0; cel < 12; cel++) {
      const pose = sample(`slime-${state}-body`, cel/12, LOOPS[state].ease);
      if (state === 'error') pose.scale = [1.08,.62];
      const angle = pose.rotate[0]! * Math.PI/180;
      for (const x of [-4,104]) for (const y of [0,96]) {
        const dx = (x-50)*pose.scale[0]!, dy = (y-86)*pose.scale[1]!;
        const drawnX = 50 + pose.translate[0]! + dx*Math.cos(angle) - dy*Math.sin(angle);
        const drawnY = 86 + pose.translate[1]! + dx*Math.sin(angle) + dy*Math.cos(angle);
        expect(drawnX, `${state}/${cel} x`).toBeGreaterThan(-19);
        expect(drawnX, `${state}/${cel} x`).toBeLessThan(119);
        expect(drawnY, `${state}/${cel} y`).toBeGreaterThan(-12);
        expect(drawnY, `${state}/${cel} y`).toBeLessThan(126);
      }
    }
  }
});

test('generated pose data matches the vector source of truth', () => {
  expect(raw).toBe(motionSource(readFileSync(resolve(__dirname,'slime.css'),'utf8')));
});

test('samples the original kneading boundaries without droplets or bubbles', () => {
  expect(raw).toContain('@keyframes slime-working-body');
  expect(sample('slime-working-body',0).scale).toEqual([1.14,.82]);
  expect(sample('slime-working-body',.18).scale[1]).toBeCloseTo(1.1,4);
  expect(raw).not.toMatch(/droplet|slime-sweat|slime-drip|slime-bubble|slime-sleeping-body/);
});

test('sleeping retains closed eyes without a sampled loop', () => {
  expect(loopState('sleeping')).toBe(false);
  expect(LOOPS).not.toHaveProperty('sleeping');
  expect(eyeStyle('sleeping')).toContain('M 38.51 50.31 Q 43 50 47.49 49.69');
});

test('samples the segment easing instead of linearly flattening the approved poses', () => {
  const pose=sample('slime-working-body',.09);
  expect(pose.scale[1]).toBeGreaterThan(1.03);
  expect(pose.scale[1]).toBeLessThan(1.1);
  expect(sample('slime-thinking-body',.5).rotate[0]).toBe(6);
});

test('the twelve working poses retain the original 900ms knead without droplet tracks', () => {
  expect(LOOPS.working.body).toBe(.9);
  expect(new Set(Array.from({length:12},(_,i)=>JSON.stringify(sample('slime-working-body',i/12)))).size).toBeGreaterThan(8);
});
