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
