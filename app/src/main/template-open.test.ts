import { describe, expect, test, vi } from "vitest";
import { followTemplateFile, openPendingTemplate, type TemplateOpenTarget } from "./template-open";
import type { MainEvent } from "./types";

/** A window that notes what it was asked to do, in order, with the text of the file the shell holds (or none). */
function fakeWindow(pending: string | null, inGuide = false): TemplateOpenTarget & { done: string[] } {
  const done: string[] = [];
  let held = pending;
  return {
    done,
    inGuide: () => inGuide,
    take: vi.fn(async () => { done.push("take"); const text = held; held = null; return text; }),
    go: (page) => void done.push(`go ${page}`),
    review: (text) => void done.push(`review ${text}`),
  };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("a template file opened from the file manager reaches the import review", () => {
  test("the shell's word takes the file once, shows the members page, then its review", async () => {
    const target = fakeWindow("{\"format\":\"raphael-member\"}");
    followTemplateFile({ type: "TemplateFile" }, target);
    await flush();
    expect(target.done).toEqual(["take", "go agent", "review {\"format\":\"raphael-member\"}"]);
    followTemplateFile({ type: "TemplateFile" }, target);
    await flush();
    expect(target.done).toHaveLength(4); // asked again, and nothing more came
  });

  test("starting with a file does the same without any event", async () => {
    const target = fakeWindow("text");
    expect(await openPendingTemplate(target)).toBe(true);
    expect(target.done).toEqual(["take", "go agent", "review text"]);
  });

  test("with no file waiting nothing opens", async () => {
    const target = fakeWindow(null);
    expect(await openPendingTemplate(target)).toBe(false);
    expect(target.done).toEqual(["take"]);
  });

  test("the first-run guide stays in front and the file waits untouched", async () => {
    const target = fakeWindow("text", true);
    expect(await openPendingTemplate(target)).toBe(false);
    followTemplateFile({ type: "TemplateFile" }, target);
    await flush();
    expect(target.done).toEqual([]);
    expect(target.take).not.toHaveBeenCalled();
  });

  test("no other word of the shell opens a template", async () => {
    const target = fakeWindow("text");
    for (const event of [{ type: "CoreReady" }, { type: "MembersChanged" }, { type: "TrayOpen", page: "home" }] as MainEvent[]) followTemplateFile(event, target);
    await flush();
    expect(target.done).toEqual([]);
  });
});
