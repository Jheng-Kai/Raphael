// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { sizeFieldsByScript } from "./field-sizing";

test("a webview that sizes fields by their content is left to do it", () => {
  expect(sizeFieldsByScript(document, true)).toBe(false);
  expect(document.documentElement.dataset.fieldSizing).toBeUndefined();
});

test("elsewhere the composer is sized as the owner types and when the page writes into it, and other fields are not", async () => {
  document.body.innerHTML = '<textarea class="cmp-input"></textarea><textarea class="other"></textarea>';
  expect(sizeFieldsByScript(document, false)).toBe(true);
  const composer = document.querySelector<HTMLTextAreaElement>(".cmp-input")!, other = document.querySelector<HTMLTextAreaElement>(".other")!;
  composer.dispatchEvent(new Event("input", { bubbles: true }));
  expect(composer.style.height).toMatch(/px$/);
  composer.style.height = "";
  composer.value = "";  // a sent message cleared by the page
  await Promise.resolve();
  expect(composer.style.height).toMatch(/px$/);
  other.value = "x"; other.dispatchEvent(new Event("input", { bubbles: true }));
  await Promise.resolve();
  expect(other.style.height).toBe("");
  expect(document.documentElement.dataset.fieldSizing).toBe("script");
});
