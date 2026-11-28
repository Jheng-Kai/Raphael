// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the tour primary button has a solid border in its fill color at rest, on hover and on press", () => {
  const style = document.createElement("style");
  // Happy DOM cannot drive pointer states. Attribute selectors preserve their specificity.
  style.textContent = ["../styles.css", "./tour.css"]
    .map(path => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n")
    .replace(/:(hover|active)\b/g, "[data-$1]");
  document.head.append(style);
  document.body.innerHTML = '<div class="tour-bubble"><button class="btn sm pri">Start</button></div>';
  const button = document.querySelector("button")!;

  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    for (const state of ["rest", "hover", "pressed"]) {
      button.toggleAttribute("data-hover", state !== "rest");
      button.toggleAttribute("data-active", state === "pressed");
      const computed = getComputedStyle(button);
      const context = `${theme}, ${state}`;
      expect(computed.borderTopStyle, context).toBe("solid");
      expect(parseFloat(computed.borderTopWidth), context).toBeGreaterThan(0);
      expect(computed.borderTopColor, context).toBe(computed.backgroundColor);
      expect(["", "transparent", "rgba(0, 0, 0, 0)"], context).not.toContain(computed.borderTopColor);
    }
  }
});
