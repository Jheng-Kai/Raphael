// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { emptyCliBrainsView, type CliBrainsView } from "../cli-brains";
import { setLocale } from "../i18n";
import type { CliBrain, StoreService } from "../types";
import type { AbilityRow } from "./helpers";
import { abilitiesHTML, servicesHTML, toolCards, toolsHTML, topHTML, welcomeHTML } from "./screens";

const WORDS = { "zh-TW": "", en: "", ja: "" };
const service = (id: string, name: string, over: Partial<StoreService> = {}): StoreService => ({
  id, name, publisher: "", url: "", category: "", icon: null, popular: true,
  summary: WORDS, about: WORDS, examples: { "zh-TW": [], en: [], ja: [] }, server_id: null, ...over,
});
const cli = (id: CliBrain["id"], over: Partial<CliBrain> = {}): CliBrain => ({
  id, name: id, installed: true, logged_in: true, disconnected: false, available: true, version: "1.2.3", login_command: "", models: [], ...over,
});
const accounts = (over: Partial<CliBrainsView> = {}): CliBrainsView => ({
  ...emptyCliBrainsView(), state: "ready", clis: [cli("claude"), cli("codex", { available: false, logged_in: false }), cli("gemini", { installed: false, available: false })], ...over,
});
const noKey = { has: false, name: null, replacing: false, busy: false, error: null };

const dom = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};
const items = (host: HTMLElement): string[] => [...host.querySelectorAll<HTMLElement>(".ob-item")].map((el) => el.dataset.item!);

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("zh-TW"));

describe("every screen", () => {
  test("is real buttons and the app's own switches: no native select and no link-looking text", () => {
    const html = [
      welcomeHTML({ rerun: false, languageSelect: '<button type="button" class="sel"></button>' }),
      toolsHTML(accounts(), noKey, ""),
      servicesHTML({ services: [service("notion", "Notion")], waiting: null, failed: null }),
      abilitiesHTML({ rows: [{ kind: "search", icon: "search", label: "Web search", about: "x", on: true, note: null }], busy: null }),
    ].join("");
    expect(html).not.toMatch(/<select|class="link"|<a /);
    expect(html).not.toContain("title=");
  });

  test("has a headline of its own and no line of purpose under it", () => {
    for (const html of [toolsHTML(accounts(), noKey, ""), servicesHTML({ services: "loading", waiting: null, failed: null }), abilitiesHTML({ rows: "loading", busy: null })]) {
      const host = dom(html);
      expect(host.querySelectorAll("h2")).toHaveLength(1);
      expect(host.querySelector(".ob-sub")).toBeNull();
    }
  });
});

describe("the bar", () => {
  test("has a way back, a segment for each step, and no way to skip", () => {
    const host = dom(topHTML({ segments: { total: 3, current: 1 }, back: true }));
    expect(host.querySelector('[data-ob="back"]')).not.toBeNull();
    expect(host.querySelectorAll(".ob-bar-steps i")).toHaveLength(3);
    expect(host.querySelectorAll(".ob-bar-steps i.done")).toHaveLength(1);
    expect(host.querySelector('[data-ob="skip"]')).toBeNull();
    expect(dom(topHTML({ segments: { total: 3, current: -1 }, back: false })).querySelector('[data-ob="back"]')).toBeNull();
  });
});

describe("step 1: the AI tools", () => {
  test("lists ChatGPT, the three command-line tools and OpenRouter, each with its name and one control", () => {
    const host = dom(toolsHTML(accounts(), noKey, ""));
    expect(items(host)).toEqual(["chatgpt", "claude", "codex", "gemini", "openrouter"]);
    expect([...host.querySelectorAll(".ob-item .nm")].map((el) => el.textContent)).toEqual(["ChatGPT", "Claude Code", "Codex", "Antigravity", "OpenRouter"]);
    for (const el of host.querySelectorAll(".ob-item")) expect(el.querySelector(".ob-ctl")!.children.length).toBeGreaterThan(0);
  });

  test("what is ready says so, and what is not has the button the account controller listens to", () => {
    const host = dom(toolsHTML(accounts(), noKey, ""));
    const control = (id: string) => host.querySelector(`[data-item="${id}"] .ob-ctl`)!;
    expect(control("claude").querySelector(".st .dot.ok")).not.toBeNull();
    expect(control("claude").querySelector("button")).toBeNull();
    expect(control("chatgpt").querySelector('button[data-chatgpt="sign-in"]')).not.toBeNull();
    expect(control("codex").querySelector('button[data-cli="codex"]')?.textContent).toBe("Connect");
    expect(control("gemini").querySelector('button[data-cli="gemini"]')?.textContent).toBe("Install guide");
  });

  test("ChatGPT signed in shows the account; signing in offers to cancel", () => {
    const signed = toolCards(accounts({ chatgpt: { signed_in: true, email: "me@example.test", plan_scope_granted: true } }))[0];
    expect(signed.ready).toBe(true);
    expect(signed.line).toContain("me@example.test");
    const signing = toolCards(accounts({ chatgpt: { signed_in: false, signing_in: true } }))[0];
    expect(signing.action?.attrs).toContain('data-chatgpt="cancel"');
  });

  test("nothing can be pressed while the accounts are still being read", () => {
    const cards = toolCards(accounts({ state: "loading", clis: [] }));
    expect(cards.every((card) => card.action === null && !card.ready)).toBe(true);
  });

  test("the key: a masked field and 貼上 until there is one, then its state and a way to replace it", () => {
    const empty = dom(toolsHTML(accounts(), noKey, ""));
    expect(empty.querySelector('#ob-key-input[type="password"]')).not.toBeNull();
    expect(empty.querySelector('[data-ob="key-paste"]')).not.toBeNull();
    const set = dom(toolsHTML(accounts(), { ...noKey, has: true }, ""));
    expect(set.querySelector("#ob-key-input")).toBeNull();
    expect(set.querySelector('[data-item="openrouter"] .dot.ok')).not.toBeNull();
    expect(set.querySelector('[data-ob="key-replace"]')).not.toBeNull();
    const replacing = dom(toolsHTML(accounts(), { ...noKey, has: true, replacing: true }, ""));
    expect(replacing.querySelector("#ob-key-input")).not.toBeNull();
    expect(replacing.querySelector('[data-ob="key-cancel"]')).not.toBeNull();
  });

  test("a refused key and a failed sign-in are told as alerts", () => {
    const host = dom(toolsHTML(accounts(), { ...noKey, error: "That key was refused" }, "Sign-in did not finish"));
    expect([...host.querySelectorAll('[role="alert"]')].map((el) => el.textContent)).toEqual(["That key was refused", "Sign-in did not finish"]);
    expect(host.querySelector("#ob-key-input")!.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("step 2: the services", () => {
  const view = (over = {}) => ({ services: [service("gmail", "Gmail"), service("notion", "Notion", { server_id: "n1" }), service("slack", "Slack")], waiting: null as string | null, failed: null as string | null, ...over });

  test("one item for each service with its mark, name and a sign-in or its connected state", () => {
    const host = dom(servicesHTML(view()));
    expect(items(host)).toEqual(["gmail", "notion", "slack"]);
    for (const el of host.querySelectorAll(".ob-item")) expect(el.querySelector(".ob-ic .mono")).not.toBeNull();
    expect(host.querySelector('[data-item="gmail"] button[data-ob="conn-login"][data-service="gmail"]')).not.toBeNull();
    expect(host.querySelector('[data-item="notion"] .dot.ok')).not.toBeNull();
    expect(host.querySelector('[data-item="notion"] button')).toBeNull();
  });

  test("while one login is open it can be cancelled and the others wait", () => {
    const host = dom(servicesHTML(view({ waiting: "gmail" })));
    expect(host.querySelector('[data-item="gmail"] [data-ob="conn-cancel"]')).not.toBeNull();
    expect(host.querySelector('[data-item="slack"] [data-ob="conn-login"]')!.hasAttribute("disabled")).toBe(true);
  });

  test("a managed app's login cannot be cancelled, as in the store", () => {
    const host = dom(servicesHTML(view({ services: [service("gmail", "Gmail", { source: "composio" })], waiting: "gmail" })));
    expect(host.querySelector('[data-ob="conn-cancel"]')!.hasAttribute("disabled")).toBe(true);
  });

  test("loading shows a spinner, a failure offers another try, a login that failed is told", () => {
    expect(dom(servicesHTML({ services: "loading", waiting: null, failed: null })).querySelector(".spin")).not.toBeNull();
    expect(dom(servicesHTML({ services: "failed", waiting: null, failed: null })).querySelector('[data-ob="conn-reload"]')).not.toBeNull();
    expect(dom(servicesHTML(view({ failed: "The sign-in did not finish" }))).querySelector('[role="alert"]')?.textContent).toBe("The sign-in did not finish");
  });
});

describe("step 3: the abilities", () => {
  const rows: AbilityRow[] = [
    { kind: "search", icon: "search", label: "Web search", about: "Look things up online", on: true, note: null },
    { kind: "read", icon: "globe", label: "Read web pages", about: "Read the pages you share", on: false, note: null },
    { kind: "voice", icon: "voice", label: "Speech service", about: "Say the answers aloud", on: false, note: "Needs a key" },
  ];

  test("each ability is a row with its name and a switch that says whether it is on", () => {
    const host = dom(abilitiesHTML({ rows, busy: null }));
    expect(items(host)).toEqual(["search", "read", "voice"]);
    const switches = [...host.querySelectorAll<HTMLElement>('.ob-item button[role="switch"]')];
    expect(switches.map((el) => el.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(switches.map((el) => el.dataset.id)).toEqual(["search", "read", "voice"]);
    expect(switches.map((el) => el.getAttribute("aria-label"))).toEqual(["Web search", "Read web pages", "Speech service"]);
  });

  test("one that waits for a key says so in place of its line and cannot be switched on here", () => {
    const host = dom(abilitiesHTML({ rows, busy: null }));
    expect(host.querySelector('[data-item="voice"] .ds')!.textContent).toBe("Needs a key");
    expect(host.querySelector('[data-item="voice"] button')!.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector('[data-item="read"] button')!.hasAttribute("disabled")).toBe(false);
  });

  test("while one switch is turning no switch can be pressed", () => {
    const host = dom(abilitiesHTML({ rows, busy: "search" }));
    expect([...host.querySelectorAll("button[role=switch]")].every((el) => el.hasAttribute("disabled"))).toBe(true);
  });

  test("loading and failing are told, and a failure can be tried again", () => {
    expect(dom(abilitiesHTML({ rows: "loading", busy: null })).querySelector(".spin")).not.toBeNull();
    expect(dom(abilitiesHTML({ rows: "failed", busy: null })).querySelector('[data-ob="abilities-reload"]')).not.toBeNull();
  });
});
