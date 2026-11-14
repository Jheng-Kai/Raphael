import { describe, expect, test } from "vitest";
import { type FlowEvent, type FlowState, STEPS, initialState, isLast, reduce, segments } from "./flow";

const run = (state: FlowState, ...events: FlowEvent[]): FlowState => events.reduce(reduce, state);
const NEXT: FlowEvent = { type: "NEXT" };
const BACK: FlowEvent = { type: "BACK" };

describe("the order of the guide", () => {
  test("a welcome, then the AI tools, the services and the abilities: three choices", () => {
    expect(STEPS).toEqual(["welcome", "tools", "services", "abilities"]);
    expect(initialState().step).toBe("welcome");
  });

  test("there are no lessons: no step asks for a key press or speech", () => {
    expect(STEPS).not.toContain("practice");
    expect(STEPS).not.toContain("mic");
  });

  test("next and back walk the steps in order", () => {
    const state = run(initialState(), NEXT, NEXT);
    expect(state.step).toBe("services");
    expect(run(state, BACK).step).toBe("tools");
  });

  test("a step can be gone past without choosing anything", () => {
    expect(run(initialState(), NEXT, NEXT, NEXT).step).toBe("abilities");
  });

  test("back from the welcome and next from the last step stay where they are", () => {
    const welcome = initialState();
    expect(reduce(welcome, BACK)).toBe(welcome);
    const last = run(welcome, NEXT, NEXT, NEXT);
    expect(reduce(last, NEXT)).toBe(last);
  });

  test("only the abilities step is the last", () => {
    expect(STEPS.filter((step) => isLast({ step }))).toEqual(["abilities"]);
  });

});

describe("the bar", () => {
  test("it has one segment for each choice and none for the welcome", () => {
    expect(segments({ step: "welcome" })).toEqual({ total: 3, current: -1 });
    expect(segments({ step: "tools" })).toEqual({ total: 3, current: 0 });
    expect(segments({ step: "services" })).toEqual({ total: 3, current: 1 });
    expect(segments({ step: "abilities" })).toEqual({ total: 3, current: 2 });
  });
});
