// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { missingHTML, bindMissing, type Missing } from "./missing";
import { setLocale } from "./i18n";

const missing: Missing = { resource: "searxng", requirement: "url", state: "missing", repair: "search" };
test("a missing address is visible beside its one real repair button, never a hover reason", () => {
  setLocale("zh-TW");
  const root = document.createElement("div"); root.innerHTML = missingHTML(missing);
  expect(root.textContent).toContain("尚未設定 SearXNG 網址");
  expect(root.textContent).toContain("設定 › 拉斐爾 › 服務 › 搜尋網路 › SearXNG");
  expect(root.querySelectorAll("button")).toHaveLength(1);
  expect(root.querySelector("[title]")).toBeNull();
  const go = vi.fn(); bindMissing(root, go);
  root.querySelector("button")!.click();
  expect(go).toHaveBeenCalledWith("settings", "repair:search:searxng");
});
test("an installation dependency has no invented settings button, in every language", () => {
  for (const language of ["zh-TW", "en", "ja"]) {
    setLocale(language);
    const root = document.createElement("div");
    root.innerHTML = missingHTML({resource: "computer", requirement: "installation", state: "missing", repair: null});
    expect(root.textContent!.length).toBeGreaterThan(20);
    expect(root.querySelector("button")).toBeNull();
  }
  setLocale("zh-TW");
});


test("known provider authentication and unknown failures keep different visible recovery", () => {
  for (const language of ["zh-TW", "en", "ja"]) {
    setLocale(language);
    const root = document.createElement("div");
    root.innerHTML = missingHTML({resource: "chatgpt", requirement: "provider", state: "broken", repair: "models"});
    expect(root.textContent).toContain("ChatGPT");
    expect(root.querySelectorAll("button")).toHaveLength(1);
    const known = root.textContent;
    root.innerHTML = missingHTML({resource: "chatgpt", requirement: "provider", state: "unknown", repair: null});
    expect(root.textContent).not.toBe(known);
    expect(root.querySelector("button")).toBeNull();
  }
  setLocale("zh-TW");
});

test("following a toast repair clears the notice before opening the existing form", () => {
  const root = document.createElement("div");
  root.innerHTML = `<div class="toast">${missingHTML(missing)}</div>`;
  const go = vi.fn(() => expect(root.querySelector(".toast")).toBeNull());
  const stop = bindMissing(root, go);
  root.querySelector("button")!.click();
  expect(go).toHaveBeenCalledOnce();
  stop();
});


test("early startup failure names unavailable settings and recovery without a dead action", () => {
  for (const [language, words] of [["zh-TW", "目前無法開啟設定"], ["en", "settings are unavailable"], ["ja", "設定を開けません"]]) {
    setLocale(language);
    const root = document.createElement("div");
    root.innerHTML = missingHTML({resource: "app", requirement: "startup", state: "broken", repair: null});
    expect(root.textContent).toContain(words);
    expect(root.querySelector("button")).toBeNull();
  }
  setLocale("zh-TW");
});
