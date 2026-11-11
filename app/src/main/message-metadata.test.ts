// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { mountMessageMetadata, reactionControlHTML, reactionRowHTML } from "./message-metadata";
import { closeMenu } from "./ui";

beforeEach(() => { closeMenu(); document.body.innerHTML = ""; setLocale("en"); });
const flush = async (): Promise<void> => { for (let i=0;i<8;i++) await Promise.resolve(); };

test("the react button opens the quick bar, a reaction only updates its message while decision cards remain untouched", async () => {
  const host = document.createElement("section"); document.body.append(host);
  host.innerHTML = `<div class="chat-message"><div class="message-actions">${reactionControlHTML()}</div>${reactionRowHTML(["👍"])}</div><button data-permission>Approve</button><input data-question value="Unanswered"><textarea data-draft>Unsent</textarea>`;
  const react = vi.fn().mockResolvedValue({ok:true}), refresh = vi.fn(), fail = vi.fn();
  const unmount = mountMessageMetadata(host, () => ({reactions:["👍"],react}), refresh, fail);
  host.querySelector<HTMLButtonElement>('[data-act="react-message"]')!.click();
  const bar = document.querySelector<HTMLElement>("#app-popover.reaction-bar")!;
  expect([...bar.querySelectorAll<HTMLElement>("[data-quick]")].map(b => b.dataset.quick)).toEqual(["👍", "😂", "👎", "❤️", "🎉", "+"]);
  expect(bar.querySelector('[data-quick="👍"]')!.getAttribute("aria-pressed")).toBe("true");
  bar.querySelector<HTMLButtonElement>('[data-quick="🎉"]')!.click(); await flush();
  expect(react).toHaveBeenCalledExactlyOnceWith("🎉",true);
  expect(document.querySelector("#app-popover")).toBeNull();
  expect(refresh).toHaveBeenCalledOnce(); expect(fail).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('[data-question]')!.value).toBe("Unanswered");
  expect(host.querySelector<HTMLTextAreaElement>('[data-draft]')!.value).toBe("Unsent");
  host.querySelector<HTMLButtonElement>('[data-reaction="👍"]')!.click(); await flush();
  expect(host.querySelector('[data-reaction="👍"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[data-reaction="👍"]')?.getAttribute("aria-label")).toBe("Reaction 👍");
  expect(react).toHaveBeenLastCalledWith("👍",false);
  unmount();
});

test("any emoji a message has shows as its own chip, the old ones too", () => {
  const row = document.createElement("div");
  row.innerHTML = reactionRowHTML(["✓", "🎉", "👨‍👩‍👧"]);
  expect([...row.querySelectorAll<HTMLElement>("[data-reaction]")].map(chip => chip.dataset.reaction)).toEqual(["✓", "🎉", "👨‍👩‍👧"]);
  expect(reactionRowHTML([])).toBe("");
});

