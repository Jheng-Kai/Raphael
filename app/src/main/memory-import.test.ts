// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as api from "./api";
import { createMemoryImport } from "./memory-import";
vi.mock("./api", () => ({importMemory:vi.fn()}));

test("owner-confirmed import preserves the draft on failure and shows redacted results", async () => {
  const root = document.createElement("div");
  const view = createMemoryImport(() => {root.innerHTML=view.html();});
  root.innerHTML=view.html();
  view.click(root.querySelector('[data-import="open"]')!);
  expect(root.querySelector("[data-import-prompt]")).not.toBeNull();
  const field = root.querySelector<HTMLTextAreaElement>("[data-import-answer]")!;
  field.value="Owner preferences\n\npassword is sample123";view.input(field);
  vi.mocked(api.importMemory).mockRejectedValueOnce("offline");
  view.click(root.querySelector('[data-import="save"]')!);
  for(let i=0;i<12;i++)await Promise.resolve();
  expect(root.querySelector<HTMLTextAreaElement>("[data-import-answer]")!.value).toContain("Owner preferences");
  vi.mocked(api.importMemory).mockResolvedValueOnce({kept:["Owner preferences"],refused:[{index:2,reason:"secret"}]});
  view.click(root.querySelector('[data-import="save"]')!);
  for(let i=0;i<12;i++)await Promise.resolve();
  expect(root.querySelector(".import-result")!.textContent).toContain("Owner preferences");
  expect(root.querySelector(".import-result")!.textContent).not.toContain("sample123");
  expect(root.querySelector<HTMLTextAreaElement>("[data-import-answer]")!.value).toBe("");
});
