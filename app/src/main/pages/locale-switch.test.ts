// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createDictionary } from "./dictionary";
import { onLocaleChange, setLocale, t } from "../i18n";
import type { AppContext } from "../types";

afterEach(() => { setLocale("zh-TW"); document.body.replaceChildren(); vi.restoreAllMocks(); });

test("dictionary updates all controls before the settings and navigation listeners run", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const page = createDictionary({ onEvent: () => () => {}, undo: { begin() {} } } as unknown as AppContext);
  document.body.append(page.el);
  const nav = document.createElement("span");
  const stop = onLocaleChange(() => { nav.textContent = t("nav.settings"); });
  try {
    for (const locale of ["en", "ja", "zh-TW"] as const) {
      setLocale(locale);
      expect(page.el.querySelector("#dict-q")?.getAttribute("placeholder")).toBe(t("dictionary.016"));
      expect(nav.textContent).toBe(t("nav.settings"));
    }
    expect(warn).not.toHaveBeenCalled();
  } finally { stop(); }
});
