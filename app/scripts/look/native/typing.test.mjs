import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { typingSummary } from "./typing.mjs";

const profile = { nodes: [{ id: 1, callFrame: { functionName: "draw", url: "app.js", lineNumber: 2 } }], samples: [1], timeDeltas: [200] };
test("Event Timing below its floor stays censored instead of becoming zero milliseconds", () => {
  const result = typingSummary({ keys: 200, paint: Array.from({length:200}, (_,index) => ({start:index*100,secondFrame:index*100+8})), events: [{ name: "keydown", target: "cmp-input", duration: 32 }], frames: [] }, profile);
  assert.equal(result.keyToSecondFrame.medianMs, 8); assert.equal(result.keyToSecondFrame.p95Ms, 8); assert.equal(result.medianMs, null); assert.match(result.medianBound, /<16ms/);
  assert.equal(result.worstMs, 32); assert.equal(result.omittedBelow16ms, 199);
  assert.equal(result.cpuSelfMs[0].milliseconds, 0.2); assert.deepEqual(result.failures, []);
});
test("the typing journey rejects every budget failure and incomplete key counts", () => {
  const result = typingSummary({ keys: 199, paint: Array.from({length:199}, (_,index) => ({start:index*100,secondFrame:index*100+56})), events: Array.from({ length: 199 }, () => ({ name: "keydown", target: "cmp-input", duration: 56 })), frames: [{ duration: 101 }] }, profile);
  assert.equal(result.failures.length, 5);
});

test("long-thread fixture prose is localized and its jump marker is unique", () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixture.json', import.meta.url), 'utf8')).windowSample;
  for (const value of [fixture.question,fixture.answer,fixture.paragraph]) {
    assert.match(value, /\p{Script=Han}/u);
    assert.ok(!value.includes(fixture.needle));
  }
  assert.match(fixture.needle, /\p{Script=Han}/u);
});
