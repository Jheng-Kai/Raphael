// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { chooserPrice, chooserSources, mountModelPicker, priceText, type ModelPicker } from "./model-picker";
import type { CatalogModel, ModelCatalog, ModelProvider } from "./types";
const model = (id: string, provider_id = "openrouter", provider = "OpenAI"): CatalogModel => ({
  id, provider_id, provider_name: provider_id === "openrouter" ? "OpenRouter" : provider_id, name: id, provider,
  input_per_mtok: null, output_per_mtok: null, per_minute: null, free: false, variable_price: false,
  context_length: 128000, created_at_ms: null, capabilities: {}, roles: { answer: { usable: true, reason: null } },
});
const catalog = (llm: CatalogModel[]): ModelCatalog => ({ llm, stt: [], source: "live", fetched_at_ms: null, replaced: [] });
let picker: ModelPicker;
afterEach(() => { picker?.close(); document.body.innerHTML = ""; localStorage.clear(); });
function mount(models: CatalogModel[], providers?: ModelProvider[]) {
  const slot = document.createElement("div"); document.body.append(slot);
  picker = mountModelPicker(slot, { role: "answer", current: models[0]?.id ?? "", catalog: catalog(models), providers, label: "Answer", onChoose: vi.fn() });
  picker.open(); return picker;
}
test("only sources above twelve models show search and sort; maker dropdown requires multiple makers", () => {
  mount(Array.from({ length: 12 }, (_, i) => model(`openai/m${i}`)));
  expect(document.querySelector(".mc-tools")).toBeNull();
  picker.update({ catalog: catalog(Array.from({ length: 13 }, (_, i) => model(`openai/m${i}`))) });
  expect(document.querySelector(".mc-search")).not.toBeNull(); expect(document.querySelector("[data-sort]")).not.toBeNull();
  expect(document.querySelector("[data-maker]")).toBeNull();
  picker.update({ catalog: catalog([...Array.from({ length: 12 }, (_, i) => model(`openai/m${i}`)), model("anthropic/sonnet", "openrouter", "Anthropic")]) });
  expect(document.querySelector("[data-maker]")).not.toBeNull();
  const search = document.querySelector<HTMLInputElement>(".mc-search")!;
  search.value = "sonnet"; search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.querySelectorAll(".mc-row")).toHaveLength(1);
});
test("enabled empty providers remain in the proper group and disabled providers disappear", () => {
  const provider: ModelProvider = { id: "local", name: "Ollama", kind: "ollama", base_url: "http://localhost:11434", enabled: true, has_key: false, models: 0, status: "unknown" };
  const sources = chooserSources({ role: "cleanup", catalog: catalog([]), providers: [provider, { ...provider, id: "off", enabled: false }], label: "Cleanup", current: "" });
  expect(sources.map((s) => [s.id, s.group])).toEqual([["local", "local"]]);
  mount([], [provider]); document.querySelector<HTMLButtonElement>('[data-source="local"]')!.click();
  expect(document.querySelectorAll(".mc-row")).toHaveLength(0); expect(document.querySelector(".mc-empty")).not.toBeNull();
});
test("price fallback requires exact maker plus model identity, otherwise it is blank", () => {
  const direct = model("gpt-5", "p3"), router = { ...model("openai/gpt-5"), input_per_mtok: 1.25, output_per_mtok: 10 };
  expect(chooserPrice(direct, [router], "answer")).toBe("$1.25 / $10");
  expect(chooserPrice({ ...direct, id: "gpt-5-mini" }, [router], "answer")).toBe("");
  expect(chooserPrice({ ...direct, provider: "Other" }, [router], "answer")).toBe("");
  expect(chooserPrice(direct, [], "answer")).toBe("");
});
test("a model on the owner's plan never borrows a router's price", () => {
  const router = { ...model("openai/gpt-5"), input_per_mtok: 1.25, output_per_mtok: 10 };
  expect(chooserPrice(model("@chatgpt:gpt-5", "chatgpt"), [router], "answer")).toBe("");
  expect(chooserPrice(model("cli:codex:gpt-5", "cli:codex"), [router], "answer")).toBe("");
});
test("API rows show maker logos and escaped names; a saved recent model leads without duplication", () => {
  localStorage.setItem("raphael.chooser.recent.answer", JSON.stringify(["openai/recent"]));
  mount([model("openai/other"), { ...model("openai/recent"), name: "<img src=x>" }]);
  const rows = [...document.querySelectorAll<HTMLElement>(".mc-row")];
  expect(rows.map((row) => row.dataset.model)).toEqual(["openai/recent", "openai/other"]);
  expect(rows[0].querySelector("img[src=x]")).toBeNull(); expect(rows[0].textContent).toContain("<img src=x>");
  expect(rows[0].querySelector(".mono")).not.toBeNull();
});
test("Codex's drawing model wears OpenAI's mark as the source, its head and its row, never the plug or the robot", async () => {
  const { providerMark } = await import("./provider-marks");
  const codex: CatalogModel = { ...model("@codex:gpt-image-2", "codex", "Codex"), provider_name: "Codex", name: "Codex (subscription)", roles: {}, billing_source: "subscription" };
  const router: CatalogModel = { ...model("openai/gpt-image-1"), name: "GPT Image" };
  const slot = document.createElement("div"); document.body.append(slot);
  picker = mountModelPicker(slot, { role: "image", current: "", catalog: { ...catalog([]), image: [router, codex] }, label: "Image", onChoose: vi.fn() });
  picker.open();
  document.querySelector<HTMLButtonElement>('[data-source="codex"]')!.click();
  const openai = providerMark("openai", true);
  expect(openai).not.toBe("");
  const source = document.querySelector('[data-source="codex"] > :first-child')!;
  const head = document.querySelector(".mc-pane-head > :first-child")!;
  const row = document.querySelector('.mc-row[data-model="@codex:gpt-image-2"] > :nth-child(2)')!;
  for (const node of [source, head, row]) {
    expect(node.outerHTML).toBe(providerMark("openai"));
    expect(node.querySelector(".mono")).toBeNull();
    expect(node.innerHTML).not.toContain("lucide-plug");
  }
  expect(document.querySelector(".mc-pane-head h3")!.textContent).toBe("Codex");
  // The core's English name is said in the window's language: one language on the row.
  expect(document.querySelector('.mc-row[data-model="@codex:gpt-image-2"] strong')!.textContent).toBe("Codex 訂閱");
});
test("a subscription's drawing model stands under the subscriptions with no price per token", () => {
  const codex: CatalogModel = { ...model("@codex:gpt-image-2", "codex", "Codex"), provider_name: "Codex", name: "Codex (subscription)", roles: {}, billing_source: "subscription" };
  const router: CatalogModel = { ...model("openai/gpt-image-1"), name: "GPT Image" };
  const slot = document.createElement("div"); document.body.append(slot);
  picker = mountModelPicker(slot, { role: "image", current: "", catalog: { ...catalog([]), image: [router, codex] }, label: "Image", onChoose: vi.fn() });
  picker.open();
  const headings = [...document.querySelectorAll(".mc-source-list h3")].map((h) => h.textContent);
  expect(headings).toEqual(["訂閱", "API"]);
  expect(document.querySelector('.mc-source-list section:first-child [data-source="codex"]')).not.toBeNull();
  expect(document.querySelector('.mc-source-list section:last-child [data-source="openrouter"]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[data-source="codex"]')!.click();
  expect(document.querySelector(".mc-pane-head p")!.textContent).toBe("使用你的訂閱額度，不另計費");
  const row = document.querySelector('.mc-row[data-model="@codex:gpt-image-2"]')!;
  expect(row.querySelector(".mc-price")).toBeNull();
  expect(row.textContent).not.toContain("價格未知");
  expect(document.querySelector(".mc-pane")!.textContent).not.toContain("每百萬 token");
  expect(priceText(codex, "image")).toBe("訂閱");
});
test("every subscription tool has its maker's mark wherever it stands as a source", async () => {
  const { providerMark } = await import("./provider-marks");
  const { CLIS } = await import("./cli-brains");
  for (const cli of CLIS) {
    const wanted = providerMark(cli.mark, true);
    expect(wanted, cli.name).not.toBe("");
    // the id, the name and the lowercased name a source can carry (chooserSources lowercases a name into the kind)
    for (const kind of [cli.id, cli.name.toLowerCase()]) expect(providerMark(kind, true), `${cli.name} as ${kind}`).toBe(wanted);
  }
});

