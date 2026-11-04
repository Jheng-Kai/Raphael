// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { registerDismissal } from "./dismissals";

test("caption buttons and dragging bypass outside dismissal on their first activation", () => {
  document.body.innerHTML = '<header id="window-chrome"><button>Minimize</button><div data-window-drag></div></header><section></section>';
  const close = vi.fn(), act = vi.fn(), panel = document.querySelector("section")!;
  const dispose = registerDismissal(panel, close);
  for (const target of document.querySelectorAll("#window-chrome > *")) {
    target.addEventListener("click", act);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }
  expect(close).not.toHaveBeenCalled();
  expect(act).toHaveBeenCalledTimes(2);
  document.body.click();
  expect(close).toHaveBeenCalledOnce();
  dispose();
});
