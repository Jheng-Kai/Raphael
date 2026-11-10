import { expect, test } from "vitest";
import * as storm from "./event-storm.mjs";

test("a single slow frame stays visible without failing the key latency percentile", () => {
  const samples = [218, ...Array(27).fill(26)];
  expect(storm.keyLatency(samples)).toEqual({ keyP90Ms: 26, keySlowestMs: 218, keySamples: 28 });
  expect(samples[0]).toBe(218);
});

test("repeated slow keys fail the percentile without hiding the slowest frame", () => {
  expect(storm.keyLatency([...Array(24).fill(26), ...Array(4).fill(168)]))
    .toEqual({ keyP90Ms: 168, keySlowestMs: 168, keySamples: 28 });
});

test("the key percentile keeps its exact threshold and handles quiet controls", () => {
  expect(storm.keyLatency([100.01]).keyP90Ms).toBeGreaterThan(100);
  expect(storm.keyLatency([])).toEqual({ keyP90Ms: 0, keySlowestMs: 0, keySamples: 0 });
});

test("a storm that replaces a node, empties text, moves a scroll or animates a picture is told apart from a calm one", () => {
  const calm = { calmReplaced: [], calmEmptied: [], blankFrames: 0, scrollMoved: 0, stray: [] };
  expect(storm.calmProblems(calm)).toEqual([]);
  expect(storm.calmProblems({ ...calm, calmReplaced: ["li.tn in ol.thread"] })).toEqual(["an element was replaced: li.tn in ol.thread"]);
  expect(storm.calmProblems({ ...calm, calmEmptied: ["span.live-action"], blankFrames: 2 })).toHaveLength(2);
  expect(storm.calmProblems({ ...calm, scrollMoved: 12 })).toEqual(["a scroller moved by 12px"]);
  expect(storm.calmProblems({ ...calm, stray: ["a slime moves or could move at div.mb-head: CSSAnimation slime-working-body"] })).toHaveLength(1);
});
