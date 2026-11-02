import { expect, test } from 'vitest';
import { LOOPS, sample } from './slime-motion';
import raw from './slime-motion-data';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { motionSource } from '../../scripts/slime-cels.mjs';

test('generated pose data matches the vector source of truth', () => {
  expect(raw).toBe(motionSource(readFileSync(resolve(__dirname,'slime.css'),'utf8')));
});

test('samples the original kneading boundaries, liquid alpha and working droplet arc', () => {
  expect(raw).toContain('@keyframes slime-working-body');
  expect(sample('slime-working-body',0).scale).toEqual([1.14,.82]);
  expect(sample('slime-working-body',.18).scale[1]).toBeCloseTo(1.1,4);
  expect(sample('slime-working-droplet',.39).alpha[0]).toBe(0);
  expect(sample('slime-working-droplet',.49).translate).toEqual([16,49]);
  expect(sample('slime-bubble',.75).translate).toEqual([50,19]);
  expect(sample('slime-sleeping-body',.44,'ease-in-out').scale).toEqual([1,1.02]);
});

test('samples the segment easing instead of linearly flattening the approved poses', () => {
  const pose=sample('slime-working-body',.09);
  expect(pose.scale[1]).toBeGreaterThan(1.03);
  expect(pose.scale[1]).toBeLessThan(1.1);
  expect(sample('slime-thinking-body',.5).rotate[0]).toBe(6);
});

test('the twelve working poses retain the original 900ms knead independently of its droplets', () => {
  expect(LOOPS.working.body).toBe(.9);
  expect(new Set(Array.from({length:12},(_,i)=>JSON.stringify(sample('slime-working-body',i/12)))).size).toBeGreaterThan(8);
});
