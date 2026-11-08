// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { emptyCliBrainsView, type CliBrainsView } from "../cli-brains";
import { setLocale } from "../i18n";
import type { CliBrain, ModelProvider, ProviderKind, StoreService } from "../types";
import { emptyProvidersView } from "../providers";
import { abilitiesHTML, matchServices, serviceTilesHTML, servicesHTML, toolCards, toolsHTML, welcomeHTML } from "./screens";

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
const items = (host: HTMLElement): string[] => [...host.querySelectorAll<HTMLElement>(".ob-tile")].map((el) => el.dataset.item!);

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("zh-TW"));

describe("every screen", () => {
  test("is real buttons and the app's own switches: no native select and no link-looking text", () => {
    const html = [
      welcomeHTML(),
      toolsHTML(accounts(), noKey, ""),
      servicesHTML({ services: [service("notion", "Notion")], waiting: null, failed: null }),
      abilitiesHTML('<section class="sgroup svc"></section>'),
    ].join("");
    expect(html).not.toMatch(/<select|class="link"|<a /);
    expect(html).not.toContain("title=");
  });

  test("has a headline of its own and no line of purpose under it", () => {
    for (const html of [toolsHTML(accounts(), noKey, ""), servicesHTML({ services: "loading", waiting: null, failed: null }), abilitiesHTML("")]) {
      const host = dom(html);
      expect(host.querySelectorAll("h2")).toHaveLength(1);
      expect(host.querySelector(".ob-sub, .ob-line")).toBeNull();
    }
  });

  test("three of the team's characters float by each step's title, others on every step and in other places, as decoration only", () => {
    const seen = new Set<string>(), places = new Set<string>();
    for (const html of [toolsHTML(accounts(), noKey, ""), servicesHTML({ services: "loading", waiting: null, failed: null }), abilitiesHTML("")]) {
      const host = dom(html);
      const floaters = host.querySelector(".ob-floaters")!;
      expect(floaters.getAttribute("aria-hidden")).toBe("true");
      expect(floaters.querySelectorAll(".slime-surface")).toHaveLength(3);
      for (const slime of floaters.querySelectorAll<HTMLElement>(".ob-fl")) { seen.add(slime.innerHTML); places.add(slime.getAttribute("style")!); }
      expect(host.querySelector("h2")!.closest(".ob-floaters")).toBeNull();
      expect(host.querySelector(".ob-aside, .ob-say, .ob-bar-steps, [role=progressbar]")).toBeNull();
    }
    expect(seen.size).toBe(9);
    expect(places.size).toBe(9);
  });
});

describe("the welcome", () => {
  test("is Raphael's emblem, his name and an ask he answers as himself, with no slogan and no language field in the column", () => {
    const host = dom(welcomeHTML());
    expect(host.querySelector('.ob-emblem[aria-hidden="true"] canvas.ob-emb')).not.toBeNull();
    expect(host.querySelector("h2")!.textContent).toBe("Raphael");
    expect(host.querySelector(".ob-line")).toBeNull();
    expect(host.querySelector('.ob-demo-ask[aria-hidden="true"] [data-ob-typed]')!.textContent!.length).toBeGreaterThan(0);
    expect(host.querySelector(".ob-demo-reply")!.textContent).toMatch(/^(告|解|否)。|^(Notice|Answer|No)\./);
    expect(host.querySelector(".ob-sr")!.textContent!.length).toBeGreaterThan(0);
    expect(host.querySelector(".sel, .lang-btn, label")).toBeNull();
    expect(host.querySelector(".ob-floaters, .slime-surface")).toBeNull();
  });
});

describe("step 1: the AI tools", () => {
  test("is a store: 熱門 is the same for everyone, the rest by kind and name, every tile alike with one control", () => {
    const host = dom(toolsHTML(accounts(), noKey, ""));
    expect([...host.querySelectorAll("[data-ob-group]")].map((el) => el.getAttribute("data-ob-group"))).toEqual(["popular", "accounts"]);
    expect(items(host.querySelector<HTMLElement>('[data-ob-group="popular"]')!)).toEqual(["chatgpt", "claude", "codex", "openrouter"]);
    expect(items(host.querySelector<HTMLElement>('[data-ob-group="accounts"]')!)).toEqual(["gemini"]);
    expect([...host.querySelectorAll(".ob-section")].map((el) => el.textContent)).toEqual(["Popular", "Subscription accounts"]);
    for (const el of host.querySelectorAll(".ob-tile")) expect(el.querySelector(".ob-ctl")!.children.length).toBeGreaterThan(0);
    expect(host.querySelector(".ob-tile.wide, .ob-grid.two")).toBeNull();
    expect(host.querySelector('.ob-find input#ob-tools-find[aria-label]')).not.toBeNull();
  });

  test("what one owner has set up never moves a tile (owner, 2026-11-08)", () => {
    const none = items(dom(toolsHTML(accounts({ clis: [cli("claude", { available: false }), cli("codex", { available: false }), cli("gemini", { available: false })] }), noKey, "")));
    const all = items(dom(toolsHTML(accounts({ chatgpt: { signed_in: true, email: "me@example.test", plan_scope_granted: true }, clis: [cli("claude"), cli("codex"), cli("gemini")] }), { ...noKey, has: true }, "")));
    expect(all).toEqual(none);
  });

  test("the search finds tools by name, forgiving a typo, in one grid", () => {
    const host = dom(toolsHTML(accounts(), noKey, "", emptyProvidersView(), "codx"));
    expect(items(host)[0]).toBe("codex");
    expect(items(host)).not.toContain("openrouter");
    expect(host.querySelector("[data-ob-found]")).not.toBeNull();
    expect(dom(toolsHTML(accounts(), noKey, "", emptyProvidersView(), "zzzz")).querySelector(".ob-state")!.textContent).toBe("No tool matches");
  });

  test("what is ready says so and has the check; what is not has the button the account controller listens to", () => {
    const host = dom(toolsHTML(accounts(), noKey, ""));
    const control = (id: string) => host.querySelector(`[data-item="${id}"] .ob-ctl`)!;
    expect(control("claude").querySelector(".st .dot.ok")).not.toBeNull();
    expect(control("claude").querySelector("button")).toBeNull();
    expect(host.querySelector('[data-item="claude"].on .ob-tick')).not.toBeNull();
    expect(host.querySelector('[data-item="codex"]')!.classList.contains("on")).toBe(false);
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

  test("the key: 連線 opens a masked field with 貼上 across its row; a set key shows its state and a way to replace it", () => {
    const empty = dom(toolsHTML(accounts(), noKey, ""));
    expect(empty.querySelector("#ob-key-input")).toBeNull();
    expect(empty.querySelector('[data-item="openrouter"] [data-ob="key-replace"]')!.textContent).toBe("Connect");
    const entering = dom(toolsHTML(accounts(), { ...noKey, replacing: true }, ""));
    expect(entering.querySelector('#ob-key-input[type="password"]')).not.toBeNull();
    expect(entering.querySelector('[data-ob="key-paste"]')).not.toBeNull();
    expect(entering.querySelector('[data-ob="key-cancel"]')).not.toBeNull();
    expect(entering.querySelector('[data-item="openrouter"]')!.classList.contains("wide")).toBe(true);
    const set = dom(toolsHTML(accounts(), { ...noKey, has: true }, ""));
    expect(set.querySelector("#ob-key-input")).toBeNull();
    expect(set.querySelector('[data-item="openrouter"] .dot.ok')).not.toBeNull();
    expect(set.querySelector('[data-ob="key-replace"]')).not.toBeNull();
    const replacing = dom(toolsHTML(accounts(), { ...noKey, has: true, replacing: true }, ""));
    expect(replacing.querySelector("#ob-key-input")).not.toBeNull();
    expect(replacing.querySelector('[data-ob="key-cancel"]')).not.toBeNull();
  });

  test("a refused key and a failed sign-in are told as alerts, the key's beside its field", () => {
    const host = dom(toolsHTML(accounts(), { ...noKey, error: "That key was refused" }, "Sign-in did not finish"));
    expect([...host.querySelectorAll('[role="alert"]')].map((el) => el.textContent)).toEqual(["Sign-in did not finish", "That key was refused"]);
    expect(host.querySelector("#ob-key-input")!.getAttribute("aria-invalid")).toBe("true");
  });

  test("one tile each: the accounts, then every provider of the catalog, connected ones to manage, others to connect", () => {
    const kind = (id: string, name: string, group: "official" | "gateway" | "local", available = true) =>
      ({ kind: id, name, group, available, fields: ["key"], default_base_url: null, docs_url: null, local_context_hint: false }) as unknown as ProviderKind;
    const providers = { ...emptyProvidersView(), state: "ready" as const,
      kinds: [kind("ollama", "Ollama", "local"), kind("openrouter", "OpenRouter", "gateway"), kind("xai", "xAI", "official"), kind("anthropic", "Anthropic", "official"), kind("future", "Future AI", "official", false)],
      providers: [{ id: "p1", kind: "anthropic", name: "Anthropic", enabled: true, status: "ok", models: 3 } as unknown as ModelProvider] };
    const host = dom(toolsHTML(accounts(), noKey, "", providers));
    // Anthropic is popular; the rest of the catalog follows by group, each group by name, under its own label
    expect(items(host.querySelector<HTMLElement>('[data-ob-group="popular"]')!)).toEqual(["chatgpt", "claude", "codex", "openrouter", "provider:anthropic"]);
    expect([...host.querySelectorAll("[data-ob-group]")].map((el) => el.getAttribute("data-ob-group"))).toEqual(["popular", "accounts", "official", "local"]);
    expect(items(host.querySelector<HTMLElement>('[data-ob-group="official"]')!)).toEqual(["provider:future", "provider:xai"]);
    expect(items(host.querySelector<HTMLElement>('[data-ob-group="local"]')!)).toEqual(["provider:ollama"]);
    expect(host.querySelector('[data-item="provider:anthropic"].on [data-pv="open"][data-id="p1"]')).not.toBeNull();
    expect(host.querySelector('[data-item="provider:xai"] [data-pv="add"][data-id="xai"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-item="provider:future"] [data-pv="add"]')!.disabled).toBe(true);
  });
});

describe("step 2: the services", () => {
  const view = (over = {}) => ({ services: [service("gmail", "Gmail"), service("notion", "Notion", { server_id: "n1" }), service("slack", "Slack")], waiting: null as string | null, failed: null as string | null, ...over });

  test("a search box and one tile for each service with its mark and name; the whole tile signs in, a connected one has the check", () => {
    const host = dom(servicesHTML(view()));
    expect(host.querySelector('.ob-find input#ob-find[aria-label]')).not.toBeNull();
    expect(items(host)).toEqual(["gmail", "notion", "slack"]);
    for (const el of host.querySelectorAll(".ob-tile")) expect(el.querySelector(".ob-ic .mono")).not.toBeNull();
    const gmail = host.querySelector('button.ob-tile[data-item="gmail"]')!;
    expect(gmail.getAttribute("data-ob")).toBe("conn-login");
    expect(gmail.getAttribute("data-service")).toBe("gmail");
    expect(gmail.getAttribute("aria-label")).toBe("Sign in Gmail");
    expect(host.querySelector('[data-item="notion"].on .dot.ok')).not.toBeNull();
    expect(host.querySelector('[data-item="notion"].on .ob-tick')).not.toBeNull();
    expect(host.querySelector('[data-item="notion"] button')).toBeNull();
    expect(host.querySelector("[data-ob-services]")!.classList.contains("ob-grid")).toBe(true);
  });

  test("while one login is open it can be cancelled and the others wait", () => {
    const host = dom(servicesHTML(view({ waiting: "gmail" })));
    expect(host.querySelector('[data-item="gmail"] [data-ob="conn-cancel"]')).not.toBeNull();
    expect(host.querySelector('button.ob-tile[data-item="slack"]')!.hasAttribute("disabled")).toBe(true);
  });

  test("a managed app's tile can stop waiting too (owner, 2026-11-08: a cancelled login left the step stuck)", () => {
    const host = dom(servicesHTML(view({ services: [service("gmail", "Gmail", { source: "composio" })], waiting: "gmail" })));
    expect(host.querySelector('[data-ob="conn-cancel"]')!.hasAttribute("disabled")).toBe(false);
  });

  test("loading shows a spinner, a failure offers another try, a login that failed is told", () => {
    expect(dom(servicesHTML({ services: "loading", waiting: null, failed: null })).querySelector(".spin")).not.toBeNull();
    expect(dom(servicesHTML({ services: "failed", waiting: null, failed: null })).querySelector('[data-ob="conn-reload"]')).not.toBeNull();
    expect(dom(servicesHTML(view({ failed: "The sign-in did not finish" }))).querySelector('[role="alert"]')?.textContent).toBe("The sign-in did not finish");
    expect(dom(servicesHTML({ services: "loading", waiting: null, failed: null })).querySelector(".ob-find")).toBeNull();
  });

  test("the search narrows the tiles by name or id, ignoring case and spaces, and says when none match", () => {
    const list = [service("gmail", "Gmail"), service("googlecalendar", "Google Calendar"), service("notion", "Notion")];
    expect(matchServices(list, "").map((s) => s.id)).toEqual(["gmail", "googlecalendar", "notion"]);
    expect(matchServices(list, " GOOGLE cal ").map((s) => s.id)).toEqual(["googlecalendar"]);
    expect(matchServices(list, "mail").map((s) => s.id)).toEqual(["gmail"]);
    const host = dom(servicesHTML({ services: list, waiting: null, failed: null, query: "notion" }));
    expect(items(host)).toEqual(["notion"]);
    expect(host.querySelector<HTMLInputElement>("#ob-find")!.value).toBe("notion");
    const none = dom(`<div>${serviceTilesHTML({ services: list, waiting: null, failed: null, query: "zzz" })}</div>`);
    expect(none.querySelector(".ob-tile")).toBeNull();
    expect(none.querySelector(".ob-state")!.textContent).toBe("No service matches");
  });
});

describe("step 3: the abilities", () => {
  test("are Settings › Tools' own rows under the step's title (owner, 2026-11-07: a switch alone did not say which service)", () => {
    const host = dom(abilitiesHTML('<section class="sgroup svc" data-svc-section><h2>Services</h2><div class="cs-list"></div></section>'));
    expect(host.querySelectorAll("h2")).toHaveLength(2);
    expect(host.querySelector("[data-ob-abilities] [data-svc-section]")).not.toBeNull();
    expect(host.querySelector('button[role="switch"][data-ob="ability"]')).toBeNull();
  });
});
