import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const css = (file: string): string => readFileSync(path.resolve(import.meta.dirname, file), "utf8");
const rule = (file: string, selector: string): string => {
  const at = css(file).indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css(file).slice(at, css(file).indexOf("}", at));
};

test("關於我 has no drag handle, is four lines at rest with the rest folded, and grows while written", () => {
  const rest = rule("owner-settings.css", ".owner-profile textarea.field");
  expect(rest).toMatch(/resize:\s*none/);
  expect(rest).toMatch(/--about-rest:\s*calc\(4lh/);
  expect(rest).toMatch(/height:\s*var\(--about-rest\)/);
  expect(rest).toMatch(/overflow:\s*hidden/);
  const writing = rule("owner-settings.css", ".owner-profile textarea.field:focus");
  expect(writing).toMatch(/field-sizing:\s*content/);
  expect(writing).toMatch(/min-height:\s*var\(--about-rest\)/);
  expect(readFileSync(path.resolve(import.meta.dirname, "pages/settings.ts"), "utf8")).toContain('e.target.dataset.owner === "owner_about") e.target.scrollTop = 0');
});

test("the app's mark and the about tab's name select nothing", () => {
  expect(css("styles.css")).toMatch(/\.app-icon \{[^}]*user-select:\s*none/);
  expect(rule("settings-polish.css", ".about-brand")).toMatch(/user-select:\s*none/);
});
