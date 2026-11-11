// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { connectorCardHTML } from "./connector-card";
import { mountInlineConnectionSetup } from "./connection-setup";
import { catalogs, setLocale, t, LOCALES } from "./i18n";
import type { ConnectorCard } from "./types";

const api = vi.hoisted(() => ({ connectorsToolkit: vi.fn(), openExternalUrl: vi.fn() }));
vi.mock("./api", () => api);
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); setLocale("zh-TW"); });

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar.events"];
const FIELDS = [
  { name: "client_id", label: "Client ID", required: true, secret: false },
  { name: "client_secret", label: "Client secret", required: true, secret: true },
];
const card = (over: Partial<ConnectorCard> = {}): ConnectorCard => ({
  id: "g1", app: "google", name: "Google", state: "pending", error: null, reconnect: false, tool_count: null, expires_at_ms: 0, resumed: false,
  needs: "own_google", fields: FIELDS, google: { redirect: "http://127.0.0.1", scopes: SCOPES, configured: false }, ...over,
});
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const actions = (html: string): string[] => [...html.matchAll(/data-act="([^"]+)"/g)].map(match => match[1]!);
const mount = (html: string): HTMLElement => { const thread = document.createElement("div"); document.body.append(thread); thread.innerHTML = html; return thread; };

describe("the owner's own Google card", () => {
  test("walks the steps, gives the scopes and the address to copy, and asks for the two fields", () => {
    const html = connectorCardHTML(card());
    expect(visible(html)).toContain("用你自己的 Google 帳號連接 Gmail 與日曆，不經過 Composio。");
    // Five numbered steps, open (this is the card's work), then what to copy.
    expect([...html.matchAll(/<li>/g)]).toHaveLength(5);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/class="card-detail"[^>]* hidden/);
    expect(html).toContain(`data-copy="${SCOPES.join("\n")}"`);
    expect(html).toContain('data-copy="http://127.0.0.1"');
    expect(html).toContain(`>${SCOPES.join("\n")}</textarea>`);
    // The secret is masked; nothing typed or kept is in the markup.
    expect(html).toMatch(/type="password" data-setup-field="client_secret"/);
    expect(html).toMatch(/type="text" data-setup-field="client_id"/);
    expect(html).not.toMatch(/ value="(?!http:\/\/127\.0\.0\.1)/);
    // One primary button, inside the form: no second footer action, and the title names the app.
    expect([...html.matchAll(/data-inline-submit/g)]).toHaveLength(1);
    expect(visible(html)).toContain("連接 Google");
    expect(actions(html)).toEqual([]);
    expect(html).toContain('<b class="card-title cc-name">連結 Google</b>');
    expect(visible(html)).toContain(t("cards.vault"));
  });

  test("with a Client ID kept it asks for nothing: one button signs in, or signs in again", () => {
    const kept = { redirect: "http://127.0.0.1", scopes: SCOPES, configured: true };
    const pending = connectorCardHTML(card({ google: kept }));
    expect(pending).not.toContain("data-setup-field");
    expect(actions(pending)).toEqual(["card-connect"]);
    expect(visible(pending)).toContain("連接 Google");
    expect(visible(connectorCardHTML(card({ google: kept, reconnect: true })))).toContain("重新連接 Google");
    // Not signed in because the owner declined: the same single button, with the cause said.
    const denied = connectorCardHTML(card({ google: kept, state: "failed", error: "denied", retry: true, fix: null }));
    expect(visible(denied)).toContain(t("card.denied"));
    expect(actions(denied)).toEqual(["card-connect"]);
    expect(actions(connectorCardHTML(card({ google: kept, state: "authorizing" })))).toEqual(["card-cancel"]);
  });

  test("a client Google refused is asked for again, with the cause and the form", () => {
    const html = connectorCardHTML(card({ state: "failed", error: "client_rejected", retry: false, fix: "form" }));
    expect(visible(html)).toContain("Google 沒有接受這組 Client ID 或 Client secret");
    expect(html).toContain('data-setup-field="client_secret"');
    expect(actions(html)).toEqual([]);
  });

  test("when it is connected the card says which account and how many tools", () => {
    const html = connectorCardHTML(card({ state: "connected", tool_count: 7, account: "owner@example.test", google: { redirect: "http://127.0.0.1", scopes: SCOPES, configured: true } }));
    expect(visible(html)).toContain("已連結 · owner@example.test · 7 個工具");
    expect(html).not.toContain("data-setup-field");
    expect(visible(connectorCardHTML(card({ state: "connected", tool_count: 7 })))).toContain("已連結 · 7 個工具");
  });

  test("every language words the whole card, with no key showing and no Chinese outside Chinese and Japanese", () => {
    for (const locale of LOCALES) {
      setLocale(locale.id);
      const holder = document.createElement("div");
      holder.innerHTML = connectorCardHTML(card());
      const text = (holder.textContent ?? "").replace(/\s+/g, " ");
      expect(text, locale.id).not.toMatch(/card\.(google|cause)|store\.google/);
      expect(text, locale.id).toContain(catalogs[locale.id]["card.googleConnect"]);
      if (!["zh-TW", "zh-CN", "ja"].includes(locale.id)) expect(text, locale.id).not.toMatch(/[㐀-鿿぀-ヿ]/u);
    }
  });

  test("the Client ID and Client secret go to the card's one call, the secret field is emptied, and no copy button sends anything", async () => {
    const thread = mount(connectorCardHTML(card()));
    const connect = vi.fn(async (_id: string, _fields: Record<string, string>) => ({ connected: true }));
    const controller = mountInlineConnectionSetup(thread, connect);
    await vi.waitFor(() => expect(thread.querySelectorAll("[data-setup-field]")).toHaveLength(2));
    // The form is the card's own: nothing is read from the catalog.
    expect(api.connectorsToolkit).not.toHaveBeenCalled();
    const [id, secret] = [...thread.querySelectorAll<HTMLInputElement>("[data-setup-field]")];
    thread.querySelector<HTMLButtonElement>("[data-inline-submit]")!.click();
    expect(connect).not.toHaveBeenCalled(); // both are required
    id!.value = "123-abc.apps.googleusercontent.com"; secret!.value = "GOCSPX-synthetic-secret";
    thread.querySelector<HTMLButtonElement>("[data-inline-submit]")!.click();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledExactlyOnceWith("g1", { client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-synthetic-secret" }));
    expect(secret!.value).toBe("");
    expect(document.body.innerHTML).not.toContain("GOCSPX-synthetic-secret");
    expect(JSON.stringify(api.connectorsToolkit.mock.calls)).not.toContain("GOCSPX");
    controller.disconnect();
  });

  test("a copy button puts the card's own text on the clipboard", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { written.push(text); } } });
    const thread = mount(connectorCardHTML(card()));
    const controller = mountInlineConnectionSetup(thread, vi.fn());
    await vi.waitFor(() => expect(thread.querySelectorAll("[data-setup-field]")).toHaveLength(2));
    for (const button of thread.querySelectorAll<HTMLButtonElement>('[data-dlg="copy"]')) button.click();
    await vi.waitFor(() => expect(written).toEqual([SCOPES.join("\n"), "http://127.0.0.1"]));
    controller.disconnect();
  });
});
