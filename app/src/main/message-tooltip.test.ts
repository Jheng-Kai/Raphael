// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { messageTooltip } from "./message-tooltip";

test("the armed Escape hint replaces the hovered or focused Stop tooltip", () => {
  document.body.innerHTML = '<section><button data-tooltip="Stop">Stop</button></section>';
  const host = document.querySelector("section")!, button = host.querySelector("button")!;
  messageTooltip(host);
  const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  button.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(tooltip.hidden).toBe(false);
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  button.dataset.cancelArmed = "true";
  for (const type of ["pointerover", "focusin"]) {
    button.dispatchEvent(new Event(type, { bubbles: true }));
    expect(tooltip.hidden).toBe(true);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  }
  delete button.dataset.cancelArmed;
  button.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(tooltip.hidden).toBe(false);
});
