// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { closeMenu, openMenu } from "./ui";

afterEach(() => { closeMenu(); document.body.innerHTML = ""; });

test("a menu's check stands at the end of the chosen row, after its name", () => {
  const anchor = document.body.appendChild(document.createElement("button"));
  openMenu(anchor, [{ value: "a", label: "A", detail: "1" }, { value: "b", label: "B" }], "a", () => {});
  const check = document.querySelector("#app-popover .ck svg")!.closest(".ck")!;
  expect(check.previousElementSibling).not.toBeNull();
  expect(check.nextElementSibling).toBeNull();
});
