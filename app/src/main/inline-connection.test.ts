// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { connectorCardHTML } from "./connector-card";
import { mountInlineConnectionSetup } from "./connection-setup";
import { setLocale, t } from "./i18n";
const api = vi.hoisted(() => ({ connectorsToolkit: vi.fn(), openExternalUrl: vi.fn() }));
vi.mock("./api", () => api);
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); setLocale("zh-TW"); });

test("the inline guide names its own save button in every language for keys and developer apps", async () => {
  for (const locale of ["zh-TW", "en", "ja"] as const) for (const needs of ["key", "own_app"] as const) {
    setLocale(locale);
    api.connectorsToolkit.mockResolvedValue({slug:"sample",name:"Sample",needs,fields:[{name:"key",label:"Key",secret:true,required:true}]});
    const thread=document.createElement("div");document.body.append(thread);
    thread.innerHTML=connectorCardHTML({id:"sample",app:"sample",name:"Sample",state:"pending",needs,error:null,reconnect:false,tool_count:null,expires_at_ms:0,resumed:false});
    const controller=mountInlineConnectionSetup(thread,vi.fn());
    await vi.waitFor(()=>expect(thread.querySelector(".cn-steps li:last-child")).not.toBeNull());
    expect(thread.querySelector(".cn-steps li:last-child")!.textContent).toContain(t("card.keySave"));
    controller.disconnect();thread.remove();
  }
});

test("inline field hints stay on one line and the guide heading is not repeated inside its disclosure", async () => {
  // The catalog's hint is the provider's English: an English window shows it (connection-setup.ts).
  setLocale("en");
  const {readFileSync}=await import("node:fs");
  api.connectorsToolkit.mockResolvedValue({slug:"sample",name:"Sample",needs:"key",fields:[{name:"key",label:"API Key",description:"A long catalog hint for this field",secret:true,required:true}]});
  const thread=document.createElement("div");document.body.append(thread);
  thread.innerHTML=connectorCardHTML({id:"sample",app:"sample",name:"Sample",needs:"key",state:"pending",error:null,reconnect:false,tool_count:null,expires_at_ms:0,resumed:false});
  const controller=mountInlineConnectionSetup(thread,vi.fn());
  await vi.waitFor(()=>expect(thread.querySelector(".cn-hint")).not.toBeNull());
  expect(thread.querySelector(".cn-hint")?.getAttribute("title")).toBe("A long catalog hint for this field");
  expect(thread.querySelector(".card-detail")?.hasAttribute("hidden")).toBe(true);
  expect(thread.querySelector(".cn-where h3")).toBeNull();
  const {resolve}=await import("node:path");
  const css=readFileSync(resolve(import.meta.dirname,"card.css"),"utf8");
  expect(css).toMatch(/\.inline-connection-setup \.cn-hint\s*\{[^}]*white-space:\s*nowrap/);
  controller.disconnect();
});
test("a reader at the latest line stays there when the card's form arrives, and one reading earlier lines is not moved", async () => {
  api.connectorsToolkit.mockResolvedValue({ slug: "sample", name: "Sample", needs: "key", fields: [{ name: "key", label: "Key", secret: true, required: true }] });
  for (const [from, moved] of [[900, true], [200, false]] as const) {
    const scroller = document.createElement("div"); scroller.className = "ra-scroll"; document.body.append(scroller);
    const thread = document.createElement("div"); scroller.append(thread);
    thread.innerHTML = connectorCardHTML({ id: "sample", app: "sample", name: "Sample", state: "pending", needs: "key", error: null, reconnect: false, tool_count: null, expires_at_ms: 0, resumed: false });
    // The thread grows by the form itself once it arrives.
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 100 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => thread.querySelector("[data-setup-field]") ? 1300 : 1000 });
    scroller.scrollTop = from;
    const controller = mountInlineConnectionSetup(thread, vi.fn());
    await vi.waitFor(() => expect(thread.querySelector("[data-setup-field]")).not.toBeNull());
    expect(scroller.scrollTop, `from ${from}`).toBe(moved ? 1300 : 200);
    controller.disconnect(); scroller.remove();
  }
});

test("conversation key setup stays inline and sends secrets only to its own connection call", async () => {
  api.connectorsToolkit.mockResolvedValue({ slug: "sample", name: "Sample", needs: "key", fields: [{ name: "key", label: "Key", secret: true, required: true }], guide_url: "https://example.invalid/keys" });
  const thread = document.createElement("div"); document.body.append(thread);
  thread.innerHTML = connectorCardHTML({ id: "sample", app: "sample", name: "Sample", state: "pending", needs: "key", error: null, reconnect: false, tool_count: null, expires_at_ms: 0, resumed: false });
  const connect = vi.fn(async (_id: string, _fields: Record<string, string>) => ({ connected: true }));
  const controller = mountInlineConnectionSetup(thread, connect);
  await vi.waitFor(() => expect(thread.querySelector('input[type="password"]')).not.toBeNull());
  const input = thread.querySelector<HTMLInputElement>("input")!; input.value = "synthetic-secret-value";
  thread.querySelector<HTMLButtonElement>("[data-inline-submit]")!.click();
  await vi.waitFor(() => expect(connect).toHaveBeenCalledExactlyOnceWith("sample", { key: "synthetic-secret-value" }));
  expect(input.value).toBe(""); expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(JSON.stringify(api.connectorsToolkit.mock.calls)).not.toContain("synthetic-secret-value");
  expect(document.body.innerHTML).not.toContain("synthetic-secret-value");
  expect(thread.querySelector(".card-detail")?.hasAttribute("hidden")).toBe(true);
  controller.disconnect();
});

test("a rejected setup retains the inline form node, values and folded guide", async () => {
 const setup = await import("./connection-setup");
 api.connectorsToolkit.mockResolvedValue({ slug: "sample", name: "Sample", needs: "key", fields: [{ name: "key", label: "Key", secret: true, required: true }] });
 const thread = document.createElement("div"); document.body.append(thread);
 const html = connectorCardHTML({ id: "sample", app: "sample", name: "Sample", state: "pending", needs: "key", error: null, reconnect: false, tool_count: null, expires_at_ms: 0, resumed: false });
 const before = document.createElement("div"); before.innerHTML = html; thread.append(before);
 const controller = mountInlineConnectionSetup(thread, vi.fn());
 await vi.waitFor(() => expect(before.querySelector("input")).not.toBeNull());
 const field = before.querySelector<HTMLInputElement>("input")!; field.value = "synthetic-kept-key";
 const after = document.createElement("div"); after.innerHTML = html.replace('data-card-state="pending"', 'data-card-state="failed"');
 const restore = setup.carryInlineSetup(before, after); before.before(after); restore(); before.remove();
 await Promise.resolve();
 expect(after.querySelector("input")).toBe(field); expect(field.value).toBe("synthetic-kept-key");
 expect(api.connectorsToolkit).toHaveBeenCalledTimes(1); controller.disconnect();
});


test("a secret card folds its catalog guide link and never reads the typed key for metadata", async () => {
 const { secretCardHTML } = await import("./secret-card");
 api.connectorsToolkit.mockResolvedValue({slug:"sample",name:"Sample",needs:"key",fields:[],guide_url:"https://example.invalid/keys"});
 const thread=document.createElement("div");document.body.append(thread);
 thread.innerHTML=secretCardHTML({id:"secret-guide",name:"Sample",secret:"API_KEY",state:"pending",error:null,expires_at_ms:0,resumed:false});
 const controller=mountInlineConnectionSetup(thread,vi.fn());
 await vi.waitFor(()=>expect(thread.querySelector('[data-secret-guide-open]')).not.toBeNull());
 expect(thread.querySelector('.card-detail')?.hasAttribute('hidden')).toBe(true);
 thread.querySelector<HTMLButtonElement>('[data-secret-guide-open]')!.click();
 expect(api.openExternalUrl).toHaveBeenCalledWith('https://example.invalid/keys');
 expect(api.connectorsToolkit).toHaveBeenCalledWith('sample'); controller.disconnect();
});

test("a failed guide opens a local retry without submitting the typed secret", async () => {
  const {secretCardHTML} = await import("./secret-card");
  api.connectorsToolkit.mockResolvedValue({slug:"sample", name:"Sample", needs:"key", fields:[], guide_url:"https://example.invalid/keys"});
  api.openExternalUrl.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(undefined);
  const thread = document.createElement("div"); document.body.append(thread);
  thread.innerHTML = secretCardHTML({id:"guide", name:"Sample", secret:"API_KEY", state:"pending", error:null, expires_at_ms:0, resumed:false});
  const connect = vi.fn(), controller = mountInlineConnectionSetup(thread, connect);
  await vi.waitFor(() => expect(thread.querySelector("[data-secret-guide-open]")).not.toBeNull());
  const field = thread.querySelector<HTMLInputElement>("[data-secret-input]")!; field.value = "synthetic-unsent-key";
  thread.querySelector<HTMLButtonElement>("[data-card-disclosure]")!.click();
  thread.querySelector<HTMLButtonElement>("[data-secret-guide-open]")!.click();
  await vi.waitFor(() => expect(thread.querySelector("[data-card-retry]")).not.toBeNull());
  thread.querySelector<HTMLButtonElement>("[data-card-retry]")!.click();
  await vi.waitFor(() => expect(api.openExternalUrl).toHaveBeenCalledTimes(2));
  expect(field.value).toBe("synthetic-unsent-key"); expect(connect).not.toHaveBeenCalled();
  expect(JSON.stringify(api.openExternalUrl.mock.calls)).not.toContain("synthetic-unsent-key");
  controller.disconnect();
});
