import { describe, expect, it } from "vitest";
import { summarizeTrace } from "./drag-probe.mjs";

const main = { name: "thread_name", ph: "M", pid: 1, tid: 2, args: { name: "CrRendererMain" } };
const slice = (name, ms, extra = {}) => ({ name, ph: "X", pid: 1, tid: 2, ts: 0, dur: ms * 1000, ...extra });

describe("the drag probe's reading of a trace", () => {
  it("counts the main thread's long tasks under either browser's name for a task, and sums where the time went", () => {
    const events = [main, slice("ThreadControllerImpl::RunTask", 57.9), slice("ThreadControllerImpl::RunTask", 4), slice("RunTask", 61),
      slice("FunctionCall", 12), slice("UpdateLayoutTree", 19.2), slice("UpdateLayoutTree", 19.1), slice("Layout", 2.3), slice("Paint", 1),
      slice("EventDispatch", 1, { args: { data: { type: "drop" } } }), slice("EventDispatch", 1, { args: { data: { type: "pointermove" } } }),
      { ...slice("RunTask", 500), tid: 9 }];
    expect(summarizeTrace(events)).toEqual({ tasksOver50ms: 2, longestTaskMs: 61, taskMs: 122.9, functionCallMs: 12, layoutMs: 2.3, styleMs: 38.3, paintMs: 1, dragEvents: 1 });
  });
  it("says nothing when the trace has no main thread", () => {
    expect(summarizeTrace([slice("RunTask", 80)])).toMatchObject({ tasksOver50ms: 0, longestTaskMs: 0, taskMs: 0 });
  });
});
