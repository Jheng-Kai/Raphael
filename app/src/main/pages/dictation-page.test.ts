// @vitest-environment happy-dom
// 聽寫's own page (pages/dictation.ts): its three tabs are the app's shared tab pills, and it opens on 總覽 every time.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppContext, DictationTab, Page } from "../types";

vi.mock("../problem-notice", () => ({ createProblemNotice: () => ({ el: document.createElement("div"), show: vi.fn(), hide: vi.fn() }) }));

import { setLocale } from "../i18n";
import { createDictation } from "./dictation";

const page = (id: DictationTab): Page & { show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> } => {
  const el = document.createElement("div");
  el.dataset.page = id;
  return { id, el, show: vi.fn(), hide: vi.fn() } as unknown as Page & { show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> };
};

describe("the dictation page", () => {
  beforeEach(() => { document.body.innerHTML = ""; setLocale("zh-TW"); });

  test("its tabs are the app's shared tabs() pills", () => {
    const dictation = createDictation({} as AppContext, { overview: page("overview"), history: page("history"), dictionary: page("dictionary") });
    document.body.append(dictation.el);
    const list = dictation.el.querySelector('.dictation-nav [role="tablist"]')!;
    expect(list.matches(".tabs.plain")).toBe(true);
    expect([...list.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => [tab.dataset.dictationTab, tab.matches(".tab"), tab.getAttribute("aria-selected")]))
      .toEqual([["overview", true, "true"], ["history", true, "false"], ["dictionary", true, "false"]]);
  });

  test("it opens on 總覽 again after it was left on another tab (owner, 2026-11-09)", () => {
    const pages = { overview: page("overview"), history: page("history"), dictionary: page("dictionary") };
    const dictation = createDictation({} as AppContext, pages);
    document.body.append(dictation.el);
    dictation.show();
    dictation.setTab("history");
    expect(dictation.tab()).toBe("history");
    expect(pages.history.show).toHaveBeenCalled();
    dictation.hide();
    dictation.show();
    expect(dictation.tab()).toBe("overview");
    expect(pages.overview.el.hidden).toBe(false);
    expect(pages.history.el.hidden).toBe(true);
    expect(dictation.el.querySelector('[data-dictation-tab="overview"]')!.getAttribute("aria-selected")).toBe("true");
  });

  test("going back through the navigation history still lands on the tab that place was", () => {
    const pages = { overview: page("overview"), history: page("history"), dictionary: page("dictionary") };
    const dictation = createDictation({} as AppContext, pages);
    dictation.show();
    dictation.hide();
    // main.ts sets the remembered tab before it shows the page again.
    dictation.setTab("dictionary", false);
    dictation.show();
    expect(dictation.tab()).toBe("dictionary");
    expect(pages.dictionary.show).toHaveBeenCalled();
  });
});
