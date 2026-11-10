// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { TRANSCRIPT_WINDOW } from "./transcript-window";
import { unreadInTail } from "./unread-divider";

test("a first unseen turn inside the newest window leaves the window alone", () => {
  // Fourteen unseen turns used to centre a window on the line and cut the newest turns off (R-UI-96).
  expect(unreadInTail(36 - 16, 36)).toBe(true);
  expect(unreadInTail(36 - TRANSCRIPT_WINDOW.initial, 36)).toBe(true);
  expect(unreadInTail(0, 5)).toBe(true);
});

test("a first unseen turn farther back than the newest window is centred, as a run that long opens at its line", () => {
  expect(unreadInTail(36 - TRANSCRIPT_WINDOW.initial - 1, 36)).toBe(false);
  expect(unreadInTail(10, 100)).toBe(false);
});
