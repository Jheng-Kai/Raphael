/// <reference types="node" />
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { emptyConnectionsView } from "../connections";
import { emptyMemoryView } from "../memory-view";
import { emptyRulesView } from "../safety-rules";
import { emptyServicesView } from "../services";
import { emptyProvidersView } from "../providers";
import { setLocale, t } from "../i18n";
import { computerHostHealthHTML } from "../computer-location";
import type { LanguageGroup } from "../languages";
import type { BrainSettings, CatalogModel, DeviceSettings, LocalModel, ModelCatalog, SettingsPane, Status } from "../types";
import {
  APPEARANCES,
  PANES,
  canonicalPane,
  RETENTIONS,
  computerApps,
  type SettingsView,
  loadingHTML,
  settingsMicrophones,
  modelPickerLook,
  paneHTML,
  paneListHTML,
  priceTexts,
  WORKER_COST_CAPS,
} from "./settings-view";

afterEach(() => setLocale("zh-TW"));

test("local commands use the shared three-choice dropdown beside computer operations", () => {
  const html = tab("safety");
  expect(html).toContain('data-k="local-commands"');
  expect(html).toContain("本機指令");
  expect(html).toContain("每次詢問");
});

test("Models has its own settings navigation entry and provider page", () => {
  expect(paneListHTML()).toContain('data-pane="models"');
  expect(tab("models", { providers: { ...emptyProvidersView(), state: "ready" } })).toContain("新增供應商");
});

const NOW = Date.UTC(2026, 9, 20, 6, 0);
const REALTEK = "麥克風排列 (Realtek(R) Audio)";

const device: DeviceSettings = {
  dictation_keys: ["AltRight"],
  dictation_mode: "toggle",
  paste_last_keys: ["AltRight+KeyV"],
  agent_keys: ["AltRight+Space"],
  microphone: null,
  emblem_size: 150,
  subtitles: "on",
  appearance: "system",
  ui_language: "zh-TW",
  autostart: false,
  onboarded: true,
  computer_apps: [],
};
const brain: BrainSettings = {
  monthly_limit_usd: 10,
  cleanup_model: "openai/gpt-6-luna",
  languages: ["zh-TW", "en-US"],
  history_retention_days: 30,
  stt_engine: "cloud",
  stt_cloud_model: "elevenlabs/scribe-v2",
  agent_model: "openai/gpt-6-luna",
  agent_city: "台北",
};
/** A model of the catalog that every role of its kind can use. */
const model = (id: string, name: string, provider: string, price: Partial<CatalogModel>, stt = false): CatalogModel => ({
  id, name, provider, input_per_mtok: null, output_per_mtok: null, per_minute: null, free: false, variable_price: false,
  context_length: stt ? null : 1_000_000, created_at_ms: NOW, capabilities: {},
  roles: stt ? { stt: { usable: true, reason: null } } : { cleanup: { usable: true, reason: null }, answer: { usable: true, reason: null } },
  ...price,
});
const catalog: ModelCatalog = {
  llm: [
    model("openai/gpt-6-luna", "GPT-6 Luna", "OpenAI", { input_per_mtok: 0.1, output_per_mtok: 0.4 }),
    model("anthropic/claude-haiku-5.5", "Claude Haiku 5.5", "Anthropic", { input_per_mtok: 1, output_per_mtok: 5 }),
  ],
  stt: [model("elevenlabs/scribe-v2", "Scribe v2", "ElevenLabs", { per_minute: 0.0067 }, true)],
  fetched_at_ms: NOW,
  source: "live",
  replaced: [],
};
const openrouter: Status["openrouter"] = {
  state: "ok", latency_ms: 120, checked_at_ms: NOW, error: null, key: null,
  usage: { daily: 0.5, weekly: 1, monthly: 3.21, total: 9, limit: null, limit_remaining: null },
};
const spend: Status["spend"] = { month_usd: 1.2, today_usd: 0.1, limit_usd: 10, forecast_usd: 2.5, daily: [] };
const GROUPS: LanguageGroup[] = [
  { id: "zh", name: "中文", variants: [{ id: "zh-TW", name: "繁體中文（台灣）" }, { id: "zh-HK", name: "繁體中文（香港）" }] },
  { id: "en", name: "English", variants: [{ id: "en-US", name: "English (United States)" }, { id: "en-GB", name: "English (United Kingdom)" }] },
  { id: "ja", name: "日本語", variants: [{ id: "ja-JP", name: "日本語" }] },
];

const LOCAL_MODELS: LocalModel[] = [
  { name: "qwen3-asr", title: "Qwen3-ASR", languages: ["zh", "en"], note: "dictionary", size: 878_702_423, ready: true },
  { name: "sensevoice", title: "SenseVoice", languages: ["zh", "en"], note: "fast", size: 163_002_883, ready: true },
];
const view = (over: Partial<SettingsView> = {}): SettingsView => ({
  pane: "general", device, brain, hasKey: true, openrouter, spend, catalog, checkingOpenrouter: false,
  devices: { devices: [{ index: 0, name: REALTEK, is_default: true }], selected: null, automatic_device: REALTEK },
  altgr: false, version: "0.1.0", replacingKey: false, keyBusy: false, keyError: null, limitDraft: null, limitError: null,
  languageGroups: GROUPS, now: NOW, connections: emptyConnectionsView(),
  localModels: LOCAL_MODELS, localDownload: null, ...over,
});

test("appearance is a section of 一般: one theme dropdown and the language, without a preview gallery", () => {
  for (const pane of ["general", "appearance"] as const) {
    const html = paneHTML(view({ pane }));
    expect(html).toContain('data-k="appearance"');
    expect(html).toContain('data-k="ui-language"');
    expect(html).not.toContain("極致黑");
    expect(html).not.toContain('skin-preview');
    expect(html).not.toContain('data-skin-choice');
  }
  expect(canonicalPane("appearance")).toBe("general");
});
test("no bot is set in Settings: Telegram, Slack and Discord live in each member's panel (owner, 2026-11-07)", () => {
  for (const id of ["general", "dictation", "agent", "connections", "usage", "about"] as const) expect(tab(id)).not.toContain("data-msg");
  expect(canonicalPane("messaging")).toBe("general");
});

test("shared owner memory lives in General, while own memory stays out of Settings", () => {
  const memoryShared = { ...emptyMemoryView(), status: { text: "Owner document", revision: "r", chars: 14, entries: 1, limit: 2200, summary: null }, space: "shared" as const, title: "共同記憶" };
  const html = tab("general", { memoryShared });
  expect(html).toContain('data-mem-space="shared"');
  const document = new Window().document;
  document.body.innerHTML = html;
  // Grok Bot's order of sections: the account first, then appearance, Raphael, memory and the guide.
  expect(document.querySelector(".set-account > h2")?.textContent).toBe("關於你");
  expect(document.querySelector("[data-memory-import]")).not.toBeNull();
  expect(html.indexOf("data-memory-import")).toBeGreaterThan(html.indexOf('data-mem-space="shared"'));
  expect(document.querySelector('[data-k="routine-timezone"]')).not.toBeNull();
  expect(document.querySelector('[data-row="output-folder"] [data-act="output-pick"]')).not.toBeNull();
  for (const pane of ["tools", "safety", "dictation"] as const) expect(tab(pane, { memoryShared })).not.toContain("data-mem-section");
  expect(tab("general", { memoryShared })).not.toContain('data-mem-space="own"');
});

test("shared safety rules and local permissions live in Safety", () => {
  const rules = { ...emptyRulesView(), status: [{ id: 1, action: "Payment", verdict: "ask" as const, position: 1 }] };
  const html = tab("safety", { rules });
  expect(html).toContain("data-rules-section");
  expect(html).toContain('data-k="local-commands"');
  expect(html).not.toContain('data-k="computer-host"');
  expect(tab("tools", { rules })).not.toContain("data-rules-section");
});

test.each(["zh-TW", "en", "ja"] as const)("shared safety and connection wording applies to all members in %s", locale => {
  setLocale(locale);
  for (const key of ["rules.placeholder", "rules.action", "rules.err.empty"] as const) {
    expect(t(key)).not.toMatch(/Raphael|拉斐爾|ラファエル/);
    expect(t(key)).toContain(locale === "zh-TW" ? "成員" : locale === "ja" ? "メンバー" : "member");
  }
});

test("Tools contains five shared service rows and leaves memory in the owner pane", () => {
  const agent = tab("tools", { services: emptyServicesView() });
  expect(agent).toContain("<h2>服務</h2>");
  expect(agent.indexOf("data-svc-section")).toBeGreaterThan(agent.indexOf('data-k="worker-cap"'));
  expect(agent).not.toContain("data-mem-section");
  expect(agent.match(/data-k="svc-open:/g)).toHaveLength(5);
  // Service choices and fields belong to their dialog rather than the shared list.
  expect(agent).not.toContain("data-model-picker");
  expect(agent).not.toContain('data-k="svc-search"');
  // The explicit vision service uses the existing picker of image-capable models.
  const picker = tab("agent", { services: { ...emptyServicesView(), open: { kind: "vision", service: "model" } }, brain: { ...brain, vision_model: "anthropic/claude-haiku-5.5" } });
  expect(picker).toMatch(/<span class="mp-slot" data-model-picker="vision"><button type="button" class="sel mp-trigger"[^>]*data-k="svc-vision">/);
  expect(picker).toContain('<strong class="mp-tname">Claude Haiku 5.5</strong>');
  expect(tab("agent", { services: { ...emptyServicesView(), open: { kind: "vision", service: "model" } } })).toContain('<strong class="mp-tname">與拉斐爾相同</strong>');
  for (const id of ["general", "dictation", "connections", "usage", "about"] as const) {
    expect(tab(id, { services: emptyServicesView() })).not.toContain("data-svc");
  }
});

const tab = (pane: SettingsPane, over: Partial<SettingsView> = {}): string => paneHTML(view({ pane, ...over }));

test.each(["zh-TW", "en", "ja"] as const)("About exposes localized help and feedback in %s", locale => {
  setLocale(locale);
  const html = tab("about");
  expect(html).toContain('data-act="help"');
  expect(html).toContain(t("nav.help"));
});

test.each([catalog, "loading", "failed"] as const)("a CLI answer is priced as subscription regardless of API catalog availability", (source) => {
  expect(priceTexts(view({ catalog: source, brain: { ...brain, agent_model: "cli:codex" } }))["quick-model"]).toBe("訂閱");
});

test.each([catalog, "loading", "failed"] as const)("a ChatGPT plan answer is priced as subscription regardless of API catalog availability", (source) => {
  expect(priceTexts(view({ catalog: source, brain: { ...brain, agent_model: "@chatgpt:gpt-5" } }))["quick-model"]).toBe("訂閱");
});

test("an inherited quick price keeps the catalog identity when effort is selected", () => {
  const plain = priceTexts(view());
  const selected = priceTexts(view({ brain: { ...brain, agent_model: brain.agent_model + "?effort=high", quick_model: "" } }));
  expect(selected["quick-model"]).toBe(plain["quick-model"]);
});
const IDS = PANES.map((p) => p.id);
const LOCALES = ["zh-TW", "en", "ja"] as const;

/** The opening tag of every button. */
const buttons = (html: string): string[] => html.match(/<button\b[^>]*>/g) ?? [];
/** The names of the groups, and of the rows, in order. */
const groups = (html: string): string[] => [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
const names = (html: string): string[] => [...html.matchAll(/<div class="t">(.*?)<\/div>/g)].map((m) => m[1]);
/** The row called `name`, from its start to the start of the next one. */
function rowOf(html: string, name: string): string {
  const rows = html.split(/(?=<div class="row[ "]|<section)/);
  const found = rows.find((r) => r.includes(`<div class="t">${name}</div>`));
  if (!found) throw new Error(`no row called ${name}`);
  return found;
}
/** The rows that have a line under their name. */
const described = (html: string): string[] =>
  html.split(/(?=<div class="row[ "])/).filter((r) => r.includes('<div class="d">')).map((r) => /<div class="t">(.*?)<\/div>/.exec(r)![1]);

describe("the tabs", () => {
  test("are Grok Bot's six: General, Dictation, Tools, Safety, Models & usage and About, in each language", () => {
    expect(IDS).toEqual(["general", "dictation", "tools", "safety", "models", "about", "connections"]);
    const titles = {
      "zh-TW": ["一般", "聽寫與快捷鍵", "工具", "安全", "模型與用量", "關於", "連結應用程式"],
      en: ["General", "Dictation & shortcuts", "Tools", "Safety", "Models & usage", "About", "Connect apps"],
      ja: ["一般", "音声入力とショートカット", "ツール", "安全", "モデルと使用量", "アプリ情報", "アプリを連携"],
    };
    for (const locale of LOCALES) {
      setLocale(locale);
      expect(PANES.map((p) => p.title())).toEqual(titles[locale]);
    }
  });

  test("sit flat, as Grok Bot's: no group names and no search (owner, 2026-11-07)", () => {
    const list = paneListHTML();
    // 連結應用程式 is no tab: the sidebar opens it as a dialog of its own (R-UI-111).
    expect([...list.matchAll(/data-pane="(\w+)"/g)].map((m) => m[1])).toEqual(["general", "dictation", "tools", "safety", "models", "about"]);
    expect(list).not.toContain("nav-group");
    expect(list).not.toContain("set-search");
  });

  test("every tab is a real button and links of before land on their new tab", () => {
    expect(paneListHTML().match(/<button type="button" class="nav" data-pane="\w+" aria-current="false">/g)).toHaveLength(6);
    expect(paneListHTML()).not.toContain('data-pane="agent"');
    expect(canonicalPane("agent")).toBe("tools");
    expect(canonicalPane("appearance")).toBe("general");
    expect(canonicalPane("messaging")).toBe("general");
  });

  test("each opens with its name alone, as Grok Bot's: no line under it (owner, 2026-11-07)", () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const id of IDS) {
        const html = tab(id);
        const title = PANES.find((p) => p.id === id)!.title();
        const head = `<h1 id="set-title" tabindex="-1">${title.replace("&", "&amp;")}</h1>`;
        expect(html).not.toContain("set-purpose");
        // Connections' Add stands on the row of its two views, clear of the dialog's ✕ (owner, 2026-11-07).
        if (id === "connections") expect(html).toMatch(/<div class="cs-bar">.*?<\/div><button type="button" class="sel cs-add"[^>]*data-k="conn-add"/s);
        expect(html.startsWith(head)).toBe(true);
        expect(html).not.toContain('class="purpose"');
      }
    }
  });

  test("keeps the pane title while settings are being read", () => {
    const html = loadingHTML(view({ pane: "usage" }));
    expect(html).toContain('<h1 id="set-title" tabindex="-1">模型與用量</h1>');
    expect(html).not.toContain('<p class="purpose">');
    expect(html).toContain("settings-skeleton");
  });
});

describe("the rules for every tab, in every language", () => {
  test("an action is a button with a shape and a choice is a dropdown or a switch: nothing else can be clicked", () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const id of IDS) {
        for (const over of [{}, { hasKey: false }, { brain: null }, { altgr: true }]) {
          const html = tab(id, over);
          for (const tag of buttons(html)) expect(tag).toMatch(/class="(btn[ "]|sel[ "]|tg|tab"|ca-item[ "])/);
          expect(html).not.toMatch(/quiet|class="link"|<a\b/);
        }
      }
    }
  });

  test("no tab shows the options of a setting in a row: no segmented controls, radio rows or chips", () => {
    for (const id of IDS) {
      const doc = new Window().document;
      doc.body.innerHTML = tab(id);
      // Vault filters browse saved data; they are not mutually exclusive setting values.
      doc.querySelector(".vault .tabs")?.remove();
      const html = doc.body.innerHTML;
      expect(html).not.toMatch(/role="radio|aria-pressed|class="tabs"|class="chip|lchip/);
    }
  });

  test("a line under a row's name only where the setting would otherwise be set wrong", () => {
    expect(described(tab("general"))).toEqual(["時區", "輸出資料夾"]);
    expect(described(tab("dictation"))).toEqual([]);
    // the key's status, the month's forecast, what the limit does, and what each model costs
    expect(described(tab("models"))).toEqual(["拉斐爾的快速提問", "整理文字", "語音轉文字", "畫圖", "做影片"]);
    expect(described(tab("usage"))).toEqual(["金鑰"]);
  });
});

describe("一般", () => {
  test("output folder belongs to General", () => {
    expect(rowOf(tab("general"), "輸出資料夾")).toContain('data-act="output-pick"');
    expect(paneHTML(view({ pane: "agent" }))).not.toContain('data-row="output-folder"');
  });

  test("the output folder is a picker that names the chosen folder and shows its whole path", () => {
    const unset = rowOf(tab("general"), "輸出資料夾");
    expect(unset).not.toMatch(/<input|<textarea/);
    expect(buttons(unset)).toHaveLength(1);
    expect(unset).toContain("選擇資料夾");
    const chosen = rowOf(tab("general", { brain: { ...brain, owner_output_folder: "C:\\Owner\\交付成果\\" } }), "輸出資料夾");
    expect(chosen).not.toMatch(/<input|<textarea/);
    expect(chosen).toContain('<span class="output-name">交付成果</span>');
    expect(chosen).toContain('<span class="output-path">C:\\Owner\\交付成果\\</span>');
    expect(chosen).toContain('aria-label="變更輸出資料夾（目前是 交付成果）"');
    // As Claude's and ChatGPT's: the folder is changed, never cleared with a button standing open (R-UI-56); no title repeats the path.
    expect(buttons(chosen)).toHaveLength(1);
    expect(chosen).not.toMatch(/title="/);
  });
  test("General is Grok Bot's sections: you, appearance, Raphael, then memory and the guide; the bots live in the panels", () => {
    const html = tab("general");
    expect(html).not.toContain("data-msg-section");
    expect(groups(html).slice(0, 3)).toEqual(["關於你", t("skin.title"), t("agent.title")]);
    expect(groups(html).slice(-2)).toEqual([t("members.profile.memory"), "啟動"]);
    // Importing and the tour are one button each, named for what they do, with no row repeating the name (owner, 2026-11-07).
    expect(html).toMatch(/<button[^>]*data-import="open"[^>]*>匯入記憶<\/button>/);
    expect(html).toMatch(/<button[^>]*data-act="rerun-guide"[^>]*>導覽<\/button>/);
    expect(names(html)).not.toContain("匯入記憶");
    expect(html).not.toMatch(/<h2>匯入記憶<\/h2>/);
    expect(names(html).slice(0, 4)).toEqual([t("settings.067"), t("settings.059"), "時區", "輸出資料夾"]);
  });

  test("starts the guide again with a real bordered button, not a switch or a link", () => {
    const html = tab("general");
    expect(html).toMatch(/<button type="button" class="btn"[^>]*data-act="rerun-guide"/);
    expect(html.match(/data-act="rerun-guide"/g)).toHaveLength(1);
  });

  test("offers light, dark, or as Windows is, in that order", () => {
    expect(APPEARANCES.map((c) => c.label)).toEqual(["跟隨系統", "淺色", "深色"]);
    setLocale("en");
    expect(APPEARANCES.map((c) => c.label)).toEqual(["Follow system", "Light", "Dark"]);
  });
});

describe("聽寫", () => {
  test("is how a dictation starts, how Raphael listens, then how long the history is kept", () => {
    const html = tab("dictation");
    expect(groups(html)).toEqual(["快捷鍵", "開始方式", "聆聽方式", "聽寫紀錄"]);
    expect(names(html)).toEqual(["問拉斐爾", "聽寫", "貼上上一次", "取消", "聽寫方式", "你說的語言", "麥克風", "保留聽寫紀錄"]);
  });

  test("shows each shortcut as key caps, with a 變更 button on the one that can be changed here", () => {
    const html = tab("dictation");
    const dictate = rowOf(html, "聽寫");
    expect(dictate).toContain('data-row="hotkey"');
    expect(dictate).toContain("<kbd>右 Alt</kbd>");
    expect(dictate).toContain('<button type="button" class="btn" data-act="rec" data-k="rec">變更</button>');
    expect(rowOf(html, "貼上上一次")).toContain("<kbd>V</kbd>");
    expect(rowOf(html, "取消")).toContain("<kbd>Esc</kbd>");
    for (const name of ["貼上上一次", "取消"]) expect(buttons(rowOf(html, name))).toEqual([]);
    expect(rowOf(html, "聽寫方式")).toMatch(/class="sel"[^>]*data-k="mode"/);
  });

  test("warns about Right Alt only when the keyboard uses it as AltGr", () => {
    expect(tab("dictation", { altgr: true })).toContain("AltGr");
    expect(tab("dictation")).not.toContain("AltGr");
    expect(tab("dictation", { altgr: true, device: { ...device, dictation_keys: ["F9"], agent_keys: ["ControlLeft+Space"] } })).not.toContain("AltGr");
  });

  test("has one row for the languages, a dropdown that opens the picker of languages and their variants", () => {
    const row = rowOf(tab("dictation"), "你說的語言");
    expect(buttons(row)).toHaveLength(1);
    expect(row).toContain('class="sel lang-sel" aria-haspopup="dialog"');
    expect(row).toContain("<span>繁體中文（台灣）、English (United States)</span>");
  });

  test("shows the microphone by a short name, with the whole name in the list and the tooltip, and a meter under it", () => {
    const row = rowOf(tab("dictation"), "麥克風");
    expect(row).toContain('<span class="mic-ctl"><button type="button" class="sel"');
    expect(row).toContain("<span>自動（麥克風排列）</span>");
    expect(row).toContain(`title="自動偵測（目前：${REALTEK}）"`);
    // the meter of small bars, under the dropdown and inside its box, which is as wide as the dropdown
    expect(row).toContain(`<span class="meter" aria-hidden="true">${"<i></i>".repeat(46)}</span></span>`);
    expect(buttons(row)).toHaveLength(1); // the search for microphones is an item of its menu
    const choices = settingsMicrophones(view());
    expect(choices.map((c) => c.label)).toEqual(["自動偵測（目前：麥克風排列）", REALTEK]);
    expect(choices.map((c) => c.short)).toEqual(["自動（麥克風排列）", "麥克風排列"]);
    expect(choices[0].title).toBe(`自動偵測（目前：${REALTEK}）`);
  });

  test("fits a long microphone name to the dropdown and the menu, the whole name in the tooltip", () => {
    const cut = "麥克風 (5- HyperX Cloud II Core Wi"; // as MME gives it: 31 characters at most
    const devices = { devices: [{ index: 0, name: cut, is_default: true }, { index: 1, name: REALTEK, is_default: false }], selected: null, automatic_device: cut };
    const row = rowOf(tab("dictation", { devices }), "麥克風");
    expect(row).toContain("<span>自動（HyperX Cloud II…）</span>");
    expect(row).toContain(`title="自動偵測（目前：${cut}）"`);
    const choices = settingsMicrophones(view({ devices }));
    expect(choices.map((c) => c.label)).toEqual(["自動偵測（目前：HyperX Cloud II Core Wi…）", cut, REALTEK]);
    expect(choices.map((c) => c.short)).toEqual(["自動（HyperX Cloud II…）", "HyperX Cloud II Core Wi…", "麥克風排列"]);
    const chosen = rowOf(tab("dictation", { devices, device: { ...device, microphone: cut } }), "麥克風");
    expect(chosen).toContain("<span>HyperX Cloud II Core Wi…</span>");
    expect(chosen).toContain(`title="${cut}"`);
  });

  test("keeps a chosen microphone that is not plugged in, said so", () => {
    const choices = settingsMicrophones(view({ device: { ...device, microphone: "USB Mic (C-Media)" } }));
    expect(choices[choices.length - 1]).toEqual({ value: "USB Mic (C-Media)", label: "USB Mic (C-Media)（未連接）", short: "USB Mic（未連接）" });
  });

  test("has no switch for pausing the media or for learning: both are always on", () => {
    const html = tab("dictation");
    expect(html).not.toContain('class="tg"');
    expect(html).not.toMatch(/pause-media|data-k="learn"|字典/);
  });
});

describe("拉斐爾", () => {
  test("moved rows keep their existing field ids and shortcut action", () => {
    expect(rowOf(tab("dictation"), "問拉斐爾")).toContain('data-act="rec-agent"');
    expect(rowOf(tab("general"), "輸出資料夾")).toContain('data-act="output-pick"');
  });

  test("hides the retired background cost cap", () => {
    const html = tab("agent");
    expect(html).not.toContain('data-k="worker-cap"');
    expect(tab("agent", { brain: { ...brain, worker_cost_cap_usd: 0.5 } })).not.toContain("US$0.50");
    expect(WORKER_COST_CAPS.map((c) => c.value)).toEqual(["0.1", "0.2", "0.5", "1"]);
  });

  test("has no Telegram: it is in 一般's 訊息平台", () => {
    expect(tab("agent")).not.toContain("Telegram");
  });

  test("shows the missing shortcut beside its change action", () => {
    const html = tab("dictation", { device: { ...device, agent_keys: [] } });
    expect(html).not.toContain('class="purpose"');
    expect(rowOf(html, "問拉斐爾")).toContain("尚未設定");
  });

  test("warns about Right Alt under her key only when the keyboard uses it as AltGr", () => {
    const html = tab("dictation", { altgr: true });
    expect(html).toContain("AltGr");
    expect(html.indexOf("AltGr")).toBeGreaterThan(html.indexOf('data-row="agent-hotkey"'));
    expect(tab("agent")).not.toContain("AltGr");
    expect(tab("dictation", { altgr: true, device: { ...device, dictation_keys: ["F9"], agent_keys: ["ControlLeft+Space"] } })).not.toContain("AltGr");
  });

  test("General keeps it simple: no emblem size, subtitles, start with Windows or weather city to set", () => {
    const html = tab("general");
    for (const gone of ['data-k="size"', 'data-k="subtitles"', 'data-k="autostart"', 'id="agent-city"']) expect(html).not.toContain(gone);
  });
});

describe("Models", () => {
  test("puts providers and model choices on Models, existing usage controls and analytics slot on Usage", () => {
    const html = tab("models");
    expect(groups(html)).toEqual(["使用的模型", "訂閱帳號", "供應商"]);
    expect(names(html)).toEqual(["拉斐爾的快速提問", "整理文字", "語音轉文字", "畫圖", "做影片"]);
    expect(html).not.toContain('data-row="agent-model"');
    expect(html.indexOf('data-pv="directory"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('data-pv="directory"')).toBeGreaterThan(html.indexOf('data-row="stt-model"'));
    expect(html).not.toContain('data-row="raphael-spend"');
    expect(html).not.toContain("data-usage-host");
    expect(html).not.toContain("data-fallback");
    const usage = tab("usage");
    // This month's spending of the app is Grok Bot's usage card above the allowances; an OpenRouter account's own usage is
    // read on OpenRouter (owner, 2026-11-07).
    expect(names(usage)).toEqual(["金鑰"]);
    expect(usage.indexOf('data-row="raphael-spend"')).toBeLessThan(usage.indexOf("data-usage-host"));
    expect(usage).toContain("<h2>拉斐爾本月花費</h2>");
    expect(usage).not.toContain("OpenRouter 帳號本月用量");
    expect(usage).toContain("data-usage-host");
    expect(usage).not.toContain("data-model-picker");
    expect(usage).not.toContain("<h2>用量</h2>");
    expect(usage).not.toContain('data-pv="directory"');
  });

  test("this month's spending is Grok Bot's usage card: the amount, the share of the monthly limit as a bar, the month's end", () => {
    const card = (over: Partial<SettingsView>): string => /<section class="spend-card"[\s\S]*?<\/section>/.exec(tab("usage", over))![0];
    const full = card({});
    expect(full).toContain('<strong class="num">US$1.20</strong><small>已使用 12%</small>');
    expect(full).toContain('role="progressbar" aria-label="拉斐爾本月花費" aria-valuemin="0" aria-valuemax="100" aria-valuenow="12"><i style="width:12%">');
    expect(full).toContain("每月上限 US$10.00 · 照目前速度，月底約 US$2.50");
    expect(card({ spend: { ...spend, month_usd: 14 } })).toContain('aria-valuenow="100"');
    const unknown = card({ spend: null });
    expect(unknown).toContain("暫時無法取得");
    expect(unknown).not.toContain("progressbar");
  });

  test("shows how OpenRouter took the key, with buttons to check again and to change it", () => {
    const key = rowOf(tab("usage"), "金鑰");
    expect(key).toContain("已連線");
    expect(key).toContain("延遲 120 ms");
    expect(buttons(key).slice(0, 2)).toEqual(['<button type="button" class="btn" data-act="or-check">', '<button type="button" class="btn" data-act="key-replace" data-k="key">']);
    expect(key).toContain(">變更</button>");
    const bad = rowOf(tab("usage", { openrouter: { ...openrouter, state: "error", error: "auth" } }), "金鑰");
    expect(bad).toContain("金鑰無效，請更換");
  });

  test("removing the key waits in its row's ⋯, only while a key is set (R-UI-56)", () => {
    const key = rowOf(tab("usage"), "金鑰");
    expect(key).toContain('data-act="key-menu"');
    expect(key).not.toContain("移除金鑰");
    expect(key).not.toContain("danger");
    for (const over of [{ hasKey: false }, { replacingKey: true }]) {
      expect(rowOf(tab("usage", over), "金鑰")).not.toContain("key-menu");
    }
  });

  test("asks for a key when there is none, or while it is being changed", () => {
    for (const over of [{ hasKey: false }, { replacingKey: true }]) {
      const key = rowOf(tab("usage", over), "金鑰");
      expect(key).toContain('id="key-input" type="password"');
      expect(key).toContain('class="btn pri" data-act="key-paste"');
      expect(key).not.toContain('data-act="key-replace"');
    }
    expect(rowOf(tab("usage", { replacingKey: true }), "金鑰")).toContain('data-act="key-cancel"');
    const replacing = rowOf(tab("usage", { replacingKey: true }), "金鑰");
    expect(replacing.indexOf('data-act="key-cancel"')).toBeLessThan(replacing.indexOf('data-act="key-paste"'));
  });

  test("puts the price of what is chosen under each model's name, its picker beside, one self-contained row each", () => {
    const html = tab("models");
    for (const [name, k, role, price, chosen] of [
      ["語音轉文字", "stt-model", "stt", "每分鐘 $0.0067", "Scribe v2"],
      ["整理文字", "model", "cleanup", "輸入 $0.10 / 輸出 $0.40 每百萬 token", "GPT-6 Luna"],
      ["拉斐爾的快速提問", "quick-model", "answer", "輸入 $0.10 / 輸出 $0.40 每百萬 token", "GPT-6 Luna"],
    ]) {
      const row = rowOf(html, name);
      expect(row).toContain(`data-row="${k}"`);
      expect(row).toContain(
        `<span class="price num" data-price="${k}">${price}</span></div></div>` +
          `<div class="ctl"><span class="mp-slot" data-model-picker="${role}"><button type="button" class="sel mp-trigger" aria-haspopup="dialog"`,
      );
      // The button names what is chosen and leaves its price to the line under the row's name.
      expect(row).toMatch(new RegExp(`data-k="${k}">.*<strong class="mp-tname">${chosen}</strong>.*<svg`));
      expect(row).not.toContain("mp-tprice");
      expect(buttons(row).filter((tag) => tag.includes('class="sel mp-trigger"'))).toHaveLength(1);
      expect(row).not.toContain('class="models-purpose-note"');
      expect(row).not.toContain('data-fallback');
    }
    expect(priceTexts(view()).note).toBe("價格來自 OpenRouter，今天更新。實際花費依 OpenRouter 選用的供應商而定。");
    expect(tab("models")).not.toContain('data-price="note"');
  });

  test("gives each picker the catalog, what is chosen and the row's name", () => {
    const look = modelPickerLook(view(), "answer");
    expect(look).toMatchObject({ role: "answer", key: "quick-model", label: "拉斐爾的快速提問", current: "openai/gpt-6-luna", catalog, loading: false, showPrice: false, disabled: false });
    expect(modelPickerLook(view({ brain: { ...brain, stt_cloud_model: "openai/gpt-transcribe" } }), "stt").current).toBe("openai/gpt-transcribe");
  });

  test("gives the speech-to-text picker the local models, and the others none", () => {
    expect(modelPickerLook(view(), "stt").local).toEqual({ models: LOCAL_MODELS, active: null, fallback: null, download: null });
    expect(modelPickerLook(view(), "cleanup").local).toBeUndefined();
    expect(modelPickerLook(view(), "answer").local).toBeUndefined();
  });

  test("the local model is in use when the engine is local, and is qwen3-asr until another is chosen", () => {
    const local = { ...brain, stt_engine: "local" };
    expect(modelPickerLook(view({ brain: local }), "stt").local?.active).toBe("qwen3-asr");
    expect(modelPickerLook(view({ brain: { ...local, stt_local_model: "sensevoice" } }), "stt").local?.active).toBe("sensevoice");
    // With the cloud in use, the local model chosen is only what the fallback is.
    expect(modelPickerLook(view({ brain: { ...brain, stt_local_model: "sensevoice" } }), "stt").local?.active).toBeNull();
    expect(modelPickerLook(view({ brain: { ...brain, stt_local_model: "sensevoice" } }), "stt").local?.fallback).toBe("sensevoice");
    expect(modelPickerLook(view({ brain: { ...brain, stt_local_model: null } }), "stt").local?.fallback).toBeNull();
    expect(modelPickerLook(view({ brain: { ...local, stt_local_model: "sensevoice" } }), "stt").local?.fallback).toBeNull();
  });

  test("a download under way, and the catalogue while it is read, reach the picker", () => {
    const download = { name: "sensevoice", done: 5, total: 10 };
    expect(modelPickerLook(view({ localDownload: download }), "stt").local?.download).toEqual(download);
    expect(modelPickerLook(view({ localModels: "loading" }), "stt").local?.models).toBe("loading");
  });

  test("the cloud model stays the picker's choice, also while the local engine is in use", () => {
    const local = view({ brain: { ...brain, stt_engine: "local", stt_local_model: "sensevoice" } });
    expect(modelPickerLook(local, "stt").current).toBe("elevenlabs/scribe-v2");
    const row = rowOf(tab("models", { brain: { ...brain, stt_engine: "local", stt_local_model: "sensevoice" } }), "語音轉文字");
    expect(row).toContain('<strong class="mp-tname">SenseVoice</strong><span class="mp-source">本機</span>');
    expect(row).toContain('data-price="stt-model">免費</span>');
  });

  test("gives each picker the favourites of its own role, none when the core has not said", () => {
    const starred = { ...brain, model_favorites: { cleanup: ["a/b"], answer: ["c/d", "e/f"] } };
    expect(modelPickerLook(view({ brain: starred }), "cleanup").favorites).toEqual(["a/b"]);
    expect(modelPickerLook(view({ brain: starred }), "answer").favorites).toEqual(["c/d", "e/f"]);
    expect(modelPickerLook(view({ brain: starred }), "stt").favorites).toEqual([]);
    expect(modelPickerLook(view(), "cleanup").favorites).toEqual([]);
    expect(modelPickerLook(view({ brain: null }), "cleanup").favorites).toEqual([]);
  });

  test("says the prices are coming, and shows none it could not get", () => {
    expect(rowOf(tab("models", { catalog: "loading" }), "整理文字")).toContain(">價格載入中…</span>");
    expect(modelPickerLook(view({ catalog: "loading" }), "cleanup")).toMatchObject({ catalog: null, loading: true });
    expect(modelPickerLook(view({ catalog: "failed" }), "cleanup")).toMatchObject({ catalog: null, loading: false });
    expect(priceTexts(view({ catalog: "failed" }))).toEqual({ model: "", "quick-model": "", "stt-model": "", note: "目前無法取得模型價格。" });
    expect(tab("models", { catalog: "failed" })).toContain('目前無法取得模型價格。');
  });

  test("shows a saved model the catalog does not have by its id, with an unknown price", () => {
    const row = rowOf(tab("models", { brain: { ...brain, cleanup_model: "x/old" } }), "整理文字");
    expect(row).toContain('<strong class="mp-tname">old</strong>');
    expect(row).toContain('data-price="model">價格未知</span>');
  });
});

describe("dictation history retention", () => {
  test("lives at the end of 聽寫, there is no Data page, and its old link opens 聽寫", () => {
    expect(groups(tab("dictation")).slice(-1)).toEqual(["聽寫紀錄"]);
    expect(paneListHTML()).not.toContain('data-pane="data"');
    expect(canonicalPane("data")).toBe("dictation");
    expect(tab("dictation")).not.toContain('data-act="data-clear"');
  });

  test("a choice in a Settings row is its value and a chevron, with no box", () => {
    const window = new Window({ settings: { disableCSSFileLoading: true } });
    try {
      const css = ["styles.css", "settings-polish.css"].map(file => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8").replace(/@import[^;]+;/g, "")).join("\n");
      window.document.head.innerHTML = `<style>${css}</style>`;
      window.document.body.innerHTML = `<div class="modal-body">${tab("dictation")}</div>`;
      const style = window.getComputedStyle(window.document.querySelector('.modal-body [data-k="retention"]')!);
      expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(style.backgroundColor);
      expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(style.borderTopColor);
    } finally { window.happyDOM.abort(); }
  });

  test("keeps the dictation history for a choice of days, a dropdown that shows the one in force", () => {
    const row = rowOf(tab("dictation"), "保留聽寫紀錄");
    expect(row).toMatch(/<button type="button" class="sel"[^>]*aria-label="保留聽寫紀錄" title="30 天" data-k="retention">/);
    expect(RETENTIONS.map((c) => c.value)).toEqual(["1", "7", "30", "365", "36500"]);
    expect(rowOf(tab("dictation", { brain: { ...brain, history_retention_days: 36_500 } }), "保留聽寫紀錄")).toContain("一直保留");
    // a retention set elsewhere that is none of the choices is still shown
    expect(rowOf(tab("dictation", { brain: { ...brain, history_retention_days: 90 } }), "保留聽寫紀錄")).toContain("90 天");
  });
});

describe("關於", () => {
  test("has the version, and the license behind a button", () => {
    const html = tab("about", { version: "0.2.0" });
    expect(rowOf(html, "版本")).toContain(">0.2.0</span>");
    expect(rowOf(html, "開源授權")).toContain('<button type="button" class="btn" data-act="license">查看</button>');
  });

  test("shows no number while the version is not known, rather than one written in the code", () => {
    expect(rowOf(tab("about", { version: "" }), "版本")).toContain('<span class="val num"></span>');
  });
});

describe("while the core does not answer", () => {
  test("the tabs that need it say so, and its settings cannot be changed; this computer's still can", () => {
    const down = { brain: null };
    for (const id of ["general", "appearance", "dictation", "agent", "usage"] as const) expect(tab(id, down)).toContain("core-note");
    expect(tab("about", down)).not.toContain("core-note");
    expect(rowOf(tab("dictation", down), "保留聽寫紀錄")).toMatch(/data-k="retention" disabled>/);
    const dictation = tab("dictation", down);
    expect(rowOf(dictation, "你說的語言")).toMatch(/data-k="languages" disabled>/);
    expect(rowOf(dictation, "麥克風")).not.toContain("disabled");
    expect(rowOf(dictation, "聽寫")).not.toContain("disabled");
    expect(rowOf(tab("general", down), "輸出資料夾")).toContain("disabled");
    expect(rowOf(tab("dictation", down), "問拉斐爾")).not.toContain("disabled");
    const usage = tab("usage", down);
    expect(usage).not.toContain('id="limit-input"');
    for (const name of ["語音轉文字", "整理文字", "拉斐爾的快速提問"]) expect(rowOf(tab("models", down), name)).toMatch(/data-k="[\w-]+" disabled>/);
  });
});

describe("電腦操作", () => {
  const EXCEL = { exe: "excel.exe", name: "Microsoft Excel" };
  const CALC = { exe: "calculatorapp.exe", name: "Calculator" };
  const withApps = (apps: DeviceSettings["computer_apps"]) => tab("safety", { device: { ...device, computer_apps: apps } });

  test("is the last section of Raphael: a row per always-allowed app with an overflow menu", () => {
    const html = withApps([EXCEL, CALC]);
    expect(html).toContain("<h2>電腦操作</h2>");
    expect(html.lastIndexOf("<h2>")).toBe(html.indexOf("<h2>電腦操作</h2>"));
    expect(names(html).slice(-2)).toEqual(["Microsoft Excel", "Calculator"]);
    const excel = rowOf(html, "Microsoft Excel");
    expect(excel).toContain('data-act="computer-menu"');
    expect(excel).toContain('data-exe="excel.exe"');
    expect(excel).toContain('aria-label="「Microsoft Excel」的選項"');
    // An overflow icon only: no word beside it, no helper text anywhere.
    expect(excel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).toBe("Microsoft Excel");
    expect(described(html)).toEqual([]);
    expect(buttons(html).filter((b) => b.includes("computer-menu"))).toHaveLength(2);
  });

  test("with no app: one muted row, nothing else", () => {
    for (const apps of [[], undefined as unknown as DeviceSettings["computer_apps"]]) {
      const html = withApps(apps);
      expect(html).toContain('<span class="val">沒有一律允許的 App</span>');
      expect(html).not.toContain("computer-menu");
    }
    setLocale("en");
    expect(withApps([])).toContain("No apps are always allowed");
    setLocale("ja");
    expect(withApps([])).toContain("常に許可されたアプリはありません");
  });

  test("an app name is escaped", () => {
    const html = withApps([{ exe: 'x".exe', name: "<b>Evil</b>" }]);
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(html).toContain('data-exe="x&quot;.exe"');
  });

  test("settings from before the feature have no always-allowed app", () => {
    const old = { ...device } as Partial<DeviceSettings>;
    delete old.computer_apps;
    expect(computerApps(old as DeviceSettings)).toEqual([]);
  });

  test("the settings wire the button to the removal of that one app, never a whole list", () => {
    // two apps removed quickly must not compute both lists from the settings the window had
    const source = readFileSync(path.resolve(import.meta.dirname, "settings.ts"), "utf8");
    expect(source).toContain('case "computer-menu"');
    expect(source).toContain("removeComputerApp(exe)");
    expect(source).not.toContain("computer_apps: computerAppsWithout");
  });

  test("the computer's location is not a Settings row", () => {
    expect(tab("safety")).not.toContain("docker-download");
    expect(tab("safety")).not.toContain('data-k="computer-host"');
  });

  test('host health separates states and offers an exact copyable repair where it must be run', () => {
    const html = computerHostHealthHTML({host:'studio-mini',ok:false,checks:[{kind:'docker_path',ok:false}]});
    expect(html).toContain('data-computer-host-health');
    expect(html).not.toContain('非互動 SSH PATH');
    expect(html).toContain('遠端登入時找不到 Docker');
    expect(html).toContain('那台 Mac 的終端機');
    expect(html).toContain('data-act="copy-code"');
    expect(html).toContain('~/.zshenv');
    expect(html).toContain('/Applications/Docker.app/Contents/Resources/bin');
  });

});

