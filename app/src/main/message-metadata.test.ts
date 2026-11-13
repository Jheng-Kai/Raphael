// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { mountMessageMetadata, reactionControlHTML, reactionRowHTML, withReactions } from "./message-metadata";
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

test("reactions are drawn inside the first bubble, so what follows it never takes them from it", () => {
  const sibling = (html: string): Element[] => { const host = document.createElement("div"); host.innerHTML = html; return [...host.children]; };
  const reply = sibling(withReactions('<div class="ans"><div class="message-text">Expired</div></div><div class="turn-signin"><button>Sign in</button></div>', ["👎"]));
  expect(reply.map(part => part.className)).toEqual(["ans", "turn-signin"]);
  expect([...reply[0].children].map(part => part.className)).toEqual(["message-reactions", "message-text"]);
  expect(reply[1].querySelector(".message-reactions")).toBeNull();
  const owner = sibling(withReactions('<div class="owner-content"><div class="me-files"></div><div class="bubble"><div class="message-quote"></div><div class="message-text">Hi</div></div></div>', ["🎉", "😂"]));
  expect(owner[0].querySelector(".bubble > .message-reactions")?.querySelectorAll("[data-reaction]")).toHaveLength(2);
  expect(owner[0].querySelector(".me-files .message-reactions")).toBeNull();
  const card = sibling(withReactions('<section class="rich-block"></section>', ["👍"]));
  expect(card.map(part => part.className)).toEqual(["rich-block", "message-reactions"]);
  expect(withReactions('<div class="ans-x"></div>', ["👍"])).toBe('<div class="ans-x"></div>' + reactionRowHTML(["👍"]));
  expect(withReactions('<div class="ans"></div>', [])).toBe('<div class="ans"></div>');
  expect(withReactions('<div class="ans"></div>', undefined)).toBe('<div class="ans"></div>');
});
