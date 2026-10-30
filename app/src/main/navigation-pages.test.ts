// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createNavigationPage, registerNavigationPages } from "./navigation-pages";
import type { AppContext, Page } from "./types";

test("both rail destinations use their registered production factories", () => {
  const ctx = {} as AppContext;
  const page = (id: "automations") => ({ id, el: document.createElement("section"), show() {}, hide() {} }) as Page;
  const automations = page("automations");
  registerNavigationPages({
    automations: received => { expect(received).toBe(ctx); return automations; },
  });
  expect(createNavigationPage("automations", ctx)).toBe(automations);
});
