// The order of the guide, as pure rules: a welcome and three steps that are each a choice (the AI
// tools to think with, the services to connect, the abilities members have), what 「繼續」 and
// 「返回」 do, and how far along the bar is. Nothing here touches the window or the core (mount.ts
// does); `reduce` takes a state and an event and gives the next state, so every rule can be tested
// without a browser.
//
// Every step can be gone past without choosing: connecting, signing in and switching are done where
// they are shown and never undone by going on or back.

/** `first`: the first run, which saves `onboarded` at the end. `rerun`: from the settings, which does not. */
export type Mode = "first" | "rerun";

export type StepId = "welcome" | "tools" | "services" | "abilities";

/** The screens, in order. */
export const STEPS: readonly StepId[] = ["welcome", "tools", "services", "abilities"];

export interface FlowState {
  mode: Mode;
  step: StepId;
}

export type FlowEvent = { type: "NEXT" } | { type: "BACK" };

export const initialState = (mode: Mode): FlowState => ({ mode, step: "welcome" });

/** The last step: 「繼續」 there is 「完成」, and it ends the guide. */
export const isLast = (state: Pick<FlowState, "step">): boolean => state.step === STEPS[STEPS.length - 1];

export function reduce(state: FlowState, event: FlowEvent): FlowState {
  const at = STEPS.indexOf(state.step);
  const step = STEPS[event.type === "NEXT" ? at + 1 : at - 1];
  return step ? { ...state, step } : state;
}

/**
 * The bar at the top: one segment for each step after the welcome, and which of them the guide is
 * at. The welcome is before the first (`current` -1).
 */
export function segments(state: Pick<FlowState, "step">): { total: number; current: number } {
  return { total: STEPS.length - 1, current: STEPS.indexOf(state.step) - 1 };
}
