// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import { permissionGuide, type GuideActions } from "./permission-guide";
import { setLocale } from "../main/i18n";

const app = path.resolve(import.meta.dirname, "..", "..");
const page = readFileSync(path.join(app, "permission-guide.html"), "utf8");
let root: HTMLElement, actions: { layout: Mock<GuideActions["layout"]>; close: Mock<GuideActions["close"]> };

const box = (x: number, y: number, width: number, height: number) =>
  ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;

beforeEach(() => {
  document.body.innerHTML = page.split("<body>")[1].split("<script")[0];
  root = document.querySelector("#permission-guide")!;
  root.getBoundingClientRect = () => box(0, 0, 420, 118.4);
  root.querySelector<HTMLElement>(".guide-tile")!.getBoundingClientRect = () => box(13, 60, 394, 46);
  actions = { layout: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
});
afterEach(() => { document.body.innerHTML = ""; delete document.documentElement.dataset.theme; setLocale("zh-TW"); });

test.each([
  ["zh-TW", "把下方的 Raphael 拖進上方清單，再打開它的開關。", "關閉"],
  ["en", "Drag Raphael below into the list above, then turn its switch on.", "Close"],
  ["ja", "下の Raphael を上のリストにドラッグして、スイッチをオンにしてください。", "閉じる"],
])("the %s card says to drag the app, named as System Settings lists it, into the list and turn it on", async (language, text, close) => {
  const guide = permissionGuide(root, actions);
  expect(guide.show({ revision: 1, name: "Raphael", language, theme: "dark" })).toBe(true);
  expect(root.hidden).toBe(false);
  expect(root.querySelector(".guide-text")!.textContent).toBe(text);
  expect(root.querySelector(".guide-name")!.textContent).toBe("Raphael");
  expect(root.querySelector(".guide-close")!.getAttribute("aria-label")).toBe(close);
  expect(document.documentElement.dataset.theme).toBe("dark");
  await vi.waitFor(() => expect(actions.layout).toHaveBeenCalledOnce());
  // The window is the card's size, and the native drag starts from the tile's place in it.
  expect(actions.layout).toHaveBeenCalledWith(1, 420, 119, { x: 13, y: 60, width: 394, height: 46 });
});

test("an older or repeated guide is not drawn again", async () => {
  const guide = permissionGuide(root, actions);
  guide.show({ revision: 2, name: "Raphael", language: "en" });
  await vi.waitFor(() => expect(actions.layout).toHaveBeenCalledOnce());
  expect(guide.show({ revision: 2, name: "Other", language: "en" })).toBe(false);
  expect(guide.show({ revision: 1, name: "Other", language: "en" })).toBe(false);
  expect(root.querySelector(".guide-name")!.textContent).toBe("Raphael");
  expect(guide.show({ revision: 3, name: "Raphael", language: "zh-TW" })).toBe(true);
  await vi.waitFor(() => expect(actions.layout).toHaveBeenCalledTimes(2));
  expect(actions.layout.mock.calls[1][0]).toBe(3);
});

test("the × closes the guide shown, once, and can be pressed again if closing failed", async () => {
  const guide = permissionGuide(root, actions);
  const close = root.querySelector<HTMLButtonElement>(".guide-close")!;
  close.click();
  expect(actions.close).not.toHaveBeenCalled();
  guide.show({ revision: 4, name: "Raphael", language: "zh-TW" });
  close.click(); close.click();
  expect(actions.close).toHaveBeenCalledExactlyOnceWith(4);
  actions.close.mockRejectedValueOnce(new Error("gone"));
  guide.show({ revision: 5, name: "Raphael", language: "zh-TW" });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  close.click();
  await vi.waitFor(() => expect(close.disabled).toBe(false));
  warn.mockRestore();
});

test("the page never drags the app itself: the tile is not draggable and the page calls only its three commands", () => {
  // A drag the page started would be WebKit's, which System Settings does not take; AppKit starts it from the tile's place.
  expect(page).toMatch(/<img class="guide-icon"[^>]*draggable="false"/);
  const entry = readFileSync(path.join(import.meta.dirname, "permission-guide-entry.ts"), "utf8");
  expect([...entry.matchAll(/invoke\("([^"]+)"/g)].map(match => match[1]).sort())
    .toEqual(["permission_guide_close", "permission_guide_layout", "permission_guide_subscribe"]);
  expect(readFileSync(path.join(import.meta.dirname, "permission-guide.css"), "utf8")).toMatch(/\.guide-icon \{[^}]*-webkit-user-drag: none/);
});
