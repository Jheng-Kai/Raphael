import { describe, expect, it } from "vitest";
import { onlyTiming, overLimits } from "./resize-probe.mjs";

describe("the resize probe's limits", () => {
  it("names every limit a result is over, and none it meets", () => {
    expect(overLimits({ workMsP95: 18, rewraps: 0, anchorDrift: 3 }, { workMsP95: 16, rewraps: 0, anchorDrift: 1 })).toEqual(["workMsP95", "anchorDrift"]);
    expect(overLimits({ workMsP95: 16 }, { workMsP95: 16 })).toEqual([]);
  });
  it("measures a drag again only when every limit missed is a frame's timing, never what the screen shows", () => {
    expect(onlyTiming(["workMsP95"])).toBe(true);
    expect(onlyTiming(["workMsP95", "framesOver20", "framesOver50", "workMsMax", "framesOver25"])).toBe(true);
    expect(onlyTiming(["workMsP95", "anchorDrift"])).toBe(false);
    for (const seen of ["rewraps", "colOffGrid", "overflowMax", "hscrollMax", "flicker", "wholeSteps", "recalcElementsPerWrite"]) expect(onlyTiming([seen])).toBe(false);
    expect(onlyTiming([])).toBe(false);
  });
});
