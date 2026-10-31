// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { sentFileHTML } from "./attachments";
import { stepHTML } from "./timeline";
import { setLocale, t } from "./i18n";
import { describeError } from "./format";

test("an expired attachment tells the owner to attach the original next to the disabled control", () => {
  setLocale("zh-TW");
  const root = document.createElement("div"); root.innerHTML = sentFileHTML({name: "old.pdf", mime: "application/pdf", size: 300});
  expect(root.querySelector("button")!.disabled).toBe(true);
  expect(root.textContent).toContain("重新附加原檔");
});

test("a persisted search step shows the missing URL and its exact repair action in each language", () => {
  for (const language of ["zh-TW", "en", "ja"]) {
    setLocale(language);
    const root = document.createElement("div");
    root.innerHTML = stepHTML({kind: "tool", tool: "web_search", server: "Raphael", outcome: "error", reason: "not_configured", ms: 10, at_ms: 0, detail: "searxng", missing: {resource: "searxng", requirement: "url", state: "missing", repair: "search"}}, false);
    expect(root.textContent).toContain(t("missing.url"));
    expect(root.querySelector("[data-missing-repair]")?.getAttribute("data-missing-resource")).toBe("searxng");
    expect(root.textContent).not.toContain("缺少金鑰");
  }
  setLocale("zh-TW");
});

test("unknown RPC errors never leak credentials or invent a missing key, while microphone denial names its permission", () => {
  setLocale("zh-TW");
  expect(describeError(new Error("unknown synthetic-token-value"))).toBe(t("missing.unknown"));
  expect(describeError(new DOMException("Permission denied", "NotAllowedError"))).toBe(t("missing.microphone"));
});
