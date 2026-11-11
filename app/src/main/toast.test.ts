// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { toaster } from "./ui";

const shown = (): string[] => [...document.querySelectorAll(".toasts .toast")].map(toast => toast.querySelector("span")!.textContent ?? "");

afterEach(() => { toaster.hide(); vi.useRealTimers(); document.body.innerHTML = ""; });

test("the same note shown again takes the place of the one on screen, so repeated failures are one note and not a pile", () => {
  vi.useFakeTimers();
  for (let press = 0; press < 6; press++) toaster.info("Could not save the picture");
  expect(shown()).toEqual(["Could not save the picture"]);
  // Another note stands beside it, and the first one coming again moves to the end.
  toaster.info("Copied");
  toaster.info("Could not save the picture");
  expect(shown()).toEqual(["Copied", "Could not save the picture"]);
});

test("a note that comes again starts its time over: the time the replaced one had left takes nothing from it", () => {
  vi.useFakeTimers();
  // 26 letters stay 4.6 seconds.
  toaster.info("Could not save the picture");
  vi.advanceTimersByTime(4000);
  toaster.info("Could not save the picture");
  // The first one's time has run out by now; the one on screen was shown a second ago.
  vi.advanceTimersByTime(1000);
  expect(shown()).toEqual(["Could not save the picture"]);
  vi.advanceTimersByTime(4000);
  expect(shown()).toEqual([]);
});

test("a note with 復原 is left alone by a plain note that says the same", () => {
  vi.useFakeTimers();
  toaster.show("Member deleted", vi.fn());
  toaster.info("Member deleted");
  expect(shown()).toEqual(["Member deleted", "Member deleted"]);
  expect(document.querySelectorAll(".toasts .toast button")).toHaveLength(1);
});
