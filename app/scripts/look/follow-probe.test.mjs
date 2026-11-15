import { describe, expect, it } from "vitest";
import { judgeFollow } from "./follow-probe.mjs";

const frame = (phase, gap, extra = {}) => ({ at: 0, phase, input: 0, gap, top: 0, height: 2000, client: 600, ...extra });

describe("the follow probe's reading of the frames the owner saw (R-FOLLOW-01)", () => {
  it("names each phase whose frames stood above the bottom, with how many, how far and from when", () => {
    const frames = [frame("open", 300), frame("pinned", 0), frame("words", 12, { at: 40 }), frame("words", 0.6), frame("settle", 376, { at: 90 }), frame("settle", 405, { at: 100 })];
    const result = judgeFollow(frames);
    expect(result.failures).toEqual(["words: 1 frame(s) above the bottom, up to 12px from 40ms", "settle: 2 frame(s) above the bottom, up to 405px from 90ms"]);
    expect(result.summary).toMatchObject({ frames: 5, badFrames: 3, worstPx: 405, endGap: 405 });
  });
  it("counts the opening only when the opening is watched, and leaves the frames after the owner's own scrolling to him", () => {
    expect(judgeFollow([frame("open", 544), frame("settle", 0)]).failures).toEqual([]);
    expect(judgeFollow([frame("open", 544, { at: 7 }), frame("settle", 0)], { opening: true }).failures).toEqual(["open: 1 frame(s) above the bottom, up to 544px from 7ms"]);
    expect(judgeFollow([frame("pinned", 0), frame("words", 120, { input: 1 })]).failures).toEqual([]);
  });
  it("reading higher up, fails a frame whose read line moved, and says so when there was no line", () => {
    const frames = [frame("pinned", 800, { line: 40 }), frame("words", 800, { line: 40.4 }), frame("settle", 900, { line: 12, at: 60 })];
    expect(judgeFollow(frames, { position: "up" }).failures).toEqual(["settle: 1 frame(s) moved, up to 28px from 60ms"]);
    expect(judgeFollow([frame("pinned", 800)], { position: "up" }).failures).toEqual(["the line the owner read was not found"]);
    expect(judgeFollow([], { position: "up" }).failures).toEqual(["no frame of the thread was seen"]);
  });
  it("fails a picture already drawn that stands shorter again, while a picture still on its way only grows", () => {
    const frames = [frame("banner", 0, { pictures: { a: 0 } }), frame("words", 0, { pictures: { a: 40 } }), frame("words", 0, { at: 50, pictures: { a: 18, b: 0 } }),
      frame("words", 0, { at: 66, pictures: { a: 0, b: 18 } }), frame("done", 0, { pictures: { a: 40, b: 272 } }), frame("done", 0, { pictures: { a: 39.5, b: 272 } })];
    expect(judgeFollow(frames).failures).toEqual(["words: a picture already drawn stood shorter in 2 frame(s), by up to 40px, from 50ms"]);
  });
});
