/// <reference types="node" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { catalogs, getLocale, isUiLocale, LOCALES, onLocaleChange, setLocale, systemMessage, t, translatedMessage, type UiLocale } from "./index";
import type { MessageKey } from "./zh-TW";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
// TypeScript 7 (the build) ships no compiler API; parsing uses the 6.x compatibility package it recommends for tools.
import ts from "typescript-6";
import { durationParts } from "../stats";
import { DICTATION_MODES } from "../dictation";
import { languagePanelHTML } from "../languages";
import { describeError } from "../format";

afterEach(() => setLocale("zh-TW"));

test("one failed locale listener cannot interrupt later surfaces or reject the setting", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const stopBroken = onLocaleChange(() => { throw new Error("broken surface"); });
  const seen: string[] = [];
  const stopHealthy = onLocaleChange(() => seen.push(t("nav.settings")));
  try {
    expect(() => setLocale("en")).not.toThrow();
    expect(seen).toEqual([catalogs.en["nav.settings"]]);
    expect(warn).toHaveBeenCalledOnce();
  } finally { stopBroken(); stopHealthy(); warn.mockRestore(); }
});

test("the calendar's Google notice button names the sidebar's own entry, never a Settings path that no longer exists", () => {
  // Connect apps is a dialog opened by the sidebar button (R-UI-111); a button that said \u8a2d\u5b9a \u203a \u9023\u63a5 sent people to a place Settings does not have.
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const messages = catalog as Record<string, string>;
    for (const key of ["cal.googleConnect", "cal.googleCheck"]) expect(messages[key], `${locale} ${key}`).toBe(messages["nav.apps"]);
  }
});

test("the all-day toggle labels and month overflow count are in every language",()=>{
  expect(Object.keys(catalogs)).toHaveLength(15);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const messages = catalog as Record<string, string>;
    expect(messages["overview.moreEvents"], `${locale} overview.moreEvents`).toContain("{p0}");
    expect(messages["cal.showAllDay"]?.trim(), `${locale} cal.showAllDay`).toBeTruthy();
    expect(messages["common.showLess"]?.trim(), `${locale} common.showLess`).toBeTruthy();
  }
  expect(catalogs["zh-TW"]["overview.moreEvents"]).toBe("還有 {p0} 個");
  expect(catalogs["zh-TW"]["cal.showAllDay"]).toBe("展開全天事項");
  expect(catalogs["zh-TW"]["common.showLess"]).toBe("收合");
});

const CJK = /[\u3400-\u9fff\u3040-\u30ff]/;

/** The string literals in `files` (TypeScript sources) that hold Chinese or Japanese text, except 《…》 notices. */
function cjkLiterals(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function scan(node: ts.Node): void {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        const text = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map((s) => s.literal.text).join("") : node.text;
        if (CJK.test(text) && !(text.startsWith("《") && text.endsWith("》"))) found.push(`${path.basename(file)}: ${text}`);
      }
      ts.forEachChild(node, scan);
    }
    scan(ast);
  }
  return found;
}

describe("main window translations", () => {
  test("catalogues reject replacement characters and repeated question marks from damaged encoding", () => {
    for (const [locale, messages] of Object.entries(catalogs)) {
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim(), locale + ":" + key).not.toBe("");
        expect(value, `${locale}:${key}`).not.toMatch(/\uFFFD|\?{2,}/);
      }
    }
  });

  test("all locales have exactly the same keys and interpolation parameters", () => {
    const keys = Object.keys(catalogs["zh-TW"]).sort();
    for (const messages of Object.values(catalogs)) {
      expect(Object.keys(messages).sort()).toEqual(keys);
      for (const key of keys) {
        const params = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(params(messages[key as keyof typeof messages])).toEqual(params(catalogs["zh-TW"][key as keyof typeof messages]));
      }
    }
  });

  test("defaults to Traditional Chinese and validates stored locales", () => {
    expect(getLocale()).toBe("zh-TW");
    setLocale("unsupported");
    expect(getLocale()).toBe("zh-TW");
  });

  test("all fifteen locales have searchable names and survive switching", () => {
    expect(LOCALES).toHaveLength(15);
    expect(LOCALES.map(item => item.id).sort()).toEqual(Object.keys(catalogs).sort());
    for (const item of LOCALES) {
      expect(item.native.trim()).not.toBe("");
      expect(item.english).toMatch(/[a-z]/i);
      expect(isUiLocale(item.id)).toBe(true);
      setLocale(item.id);
      expect(getLocale()).toBe(item.id);
      expect(t("nav.settings")).toBe(catalogs[item.id]["nav.settings"]);
    }
    for (const value of ["ar", "he", "constructor", "__proto__", null]) expect(isUiLocale(value)).toBe(false);
  });

  test("new non-Chinese catalogs have no untranslated Chinese outside script examples", () => {
    const examples = new Set(["language.note.zh-TW", "language.note.zh-HK", "language.note.zh-CN", "language.note.yue-HK"]);
    for (const item of LOCALES.filter(item => !["zh-TW", "zh-CN", "ja", "en"].includes(item.id))) {
      for (const [key, value] of Object.entries(catalogs[item.id])) {
        if (!examples.has(key)) expect(value, item.id + ":" + key).not.toMatch(/[\u3400-\u9fff\u3040-\u30ff]/u);
      }
    }
    expect(catalogs["zh-CN"]["nav.settings"]).toBe("设置");
    expect(catalogs.ko["onboarding.demo1Reply"]).toMatch(/^알림\./);
  });

  test("notifies the open window immediately, only when the locale changes", () => {
    const seen: string[] = [];
    const stop = onLocaleChange(() => seen.push(t("nav.settings")));
    setLocale("en");
    setLocale("en");
    setLocale("ja");
    stop();
    setLocale("zh-TW");
    expect(seen).toEqual(["Settings", "設定"]);
  });

  test("refreshes module-level choices, durations and language panels without reimporting", () => {
    setLocale("en");
    expect(DICTATION_MODES[1].label).toBe("Hold to talk");
    expect(durationParts(3660)).toEqual([["1", t("unit.hours")], ["1", t("unit.minutes")]]);
    expect(languagePanelHTML(null, ["zh-TW"])).not.toContain("語言");
    setLocale("ja");
    expect(DICTATION_MODES[1].label).not.toBe("Hold to talk");
    expect(durationParts(3660).flat()).not.toContain(undefined);
  });

  test("keeps user data containing placeholders literal", () => {
    setLocale("en");
    expect(t("update.found", { p0: "{p0}<script>" })).toContain("{p0}<script>");
  });

  test("keeps an existing error translated through repeated locale changes", () => {
    let message = t("common.limitInvalid");
    for (const locale of ["en", "ja", "zh-TW"] as const) {
      setLocale(locale);
      message = translatedMessage(message)();
      expect(message).toBe(t("common.limitInvalid"));
    }
    expect(translatedMessage("User data stays literal")()).toBe("User data stays literal");
  });

  test("retranslates nested error copy while preserving literal user data", () => {
    const error = "Raphael's core is not running";
    const errorMessage = translatedMessage(t("dictionary.021", { p0: () => describeError(error) }));
    const word = t("format.010");
    const userMessage = translatedMessage(t("update.found", { p0: word }));
    for (const locale of ["en", "ja"] as const) {
      setLocale(locale);
      expect(errorMessage()).toContain(t("format.010"));
      expect(userMessage()).toContain(word);
    }
  });

  test("a captured notice resolver survives a large dictionary redraw", () => {
    const message = translatedMessage(t("common.limitInvalid"));
    for (let n = 0; n < 600; n++) t("dictionary.006", { p0: `word-${n}` });
    setLocale("en");
    expect(message()).toBe(t("common.limitInvalid"));
  });

  test("translates known Rust errors while preserving external diagnostic details", () => {
    const diagnostic = "OS error 5";
    for (const locale of ["en", "ja"] as const) {
      setLocale(locale);
      expect(describeError(catalogs["zh-TW"]["backend.conflictingKeys"])).toBe(t("backend.conflictingKeys"));
      expect(describeError(catalogs["zh-TW"]["backend.save"].replace("{p0}", diagnostic))).toBe(t("backend.save", { p0: diagnostic }));
    }
  });

  test("every refusal the Rust side sends the main window has words in each language", () => {
    // The shell writes these in Chinese, and device_settings.rs builds the shortcut ones from the
    // name of each shortcut: backend.ts has to know every one, or an English or Japanese window
    // shows Chinese. A word or two in quotes is part of a longer message (開啟, 關閉), and the
    // shortcuts named by their field go to the log only.
    const shell = (file: string): string =>
      readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "src-tauri", "src", file), "utf8")
        .split("#[cfg(test)]")[0]
        .replace(/^\s*\/\/.*$/gm, "");
    const settings = shell("device_settings.rs");
    const names = [...settings.matchAll(/check_keys\("([^"]+)"/g)].map((m) => m[1]).filter((name) => CJK.test(name));
    const templates = [...settings.matchAll(/format!\("\{what\}([^"]+)"\)/g)].map((m) => m[1]);
    const plain = (source: string): string[] =>
      [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)]
        .map((m) => m[1])
        .filter((text) => CJK.test(text) && !text.includes("{") && text.length > 2 && !names.includes(text));
    const messages = [...names.flatMap((name) => templates.map((rest) => name + rest)), ...plain(settings), ...plain(shell("commands.rs"))];
    expect(names).toHaveLength(3);
    expect(templates).toHaveLength(2);
    expect(messages.length).toBeGreaterThanOrEqual(20);
    for (const locale of ["en", "ja"] as const) {
      setLocale(locale);
      for (const message of messages) expect(describeError(message), message).not.toBe(message);
    }
  });

  test("every key of the catalogue is used by the main window or overlay source", () => {
    // A key built at run time comes from a table of literal keys (VARIANT_NAMES, the `exact` list of
    // backend.ts, ...), so each key in use is written out as a string somewhere.
    const root = path.resolve(import.meta.dirname, "..");
    const catalogues = new Set([...LOCALES.map(item => item.id + ".ts"), "missing-catalogs.ts"]);
    const files = [root, path.join(root, "pages"), path.join(root, "onboarding"), path.join(root, "i18n"), path.join(root, "..", "overlay")].flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !(dir.endsWith("i18n") && catalogues.has(f)))
        .map((f) => path.join(dir, f)),
    );
    const written = new Set<string>();
    for (const file of files) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const scan = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) written.add(node.text);
        ts.forEachChild(node, scan);
      };
      scan(ast);
    }
    expect(Object.keys(catalogs["zh-TW"]).filter((key) => !written.has(key))).toEqual([]);
    // It parses every source as the test below does, and timed out the same way under the whole suite's load.
  }, 60_000);

  test("main-window source has no hard-coded CJK UI literals outside the catalogue", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files = [root, path.join(root, "pages"), path.join(root, "onboarding")].flatMap((dir) =>
      readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(dir, f)),
    );
    expect(cjkLiterals(files)).toEqual([]);
    // Parsing every main-window source takes seconds under the whole suite's load (previously timed out).
  }, 60_000);

  test("overlay source and page have no hard-coded CJK UI text either: Rust sends the words", () => {
    const overlay = path.resolve(import.meta.dirname, "..", "..", "overlay");
    const files = readdirSync(overlay, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(overlay, f));
    expect(files.length).toBeGreaterThan(0);
    expect(cjkLiterals(files)).toEqual([]);
    const page = readFileSync(path.resolve(overlay, "..", "..", "overlay.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    expect(page.split("\n").filter((line) => CJK.test(line))).toEqual([]);
  });
});

describe("on a Mac", () => {
  // What only Windows has, or calls so: its keys, its programs, its credential store, and the owner's computer as a PC.
  const WINDOWS = /Windows|\bCtrl\b|\bWin\b|PowerShell|Credential|\bPCs?\b|\bAlt\b(?![ıi])|檔案總管|工作管理員|资源管理器|任务管理器|エクスプローラー/;
  // A member's own computer is a PC whatever the owner runs.
  const MEMBER_PC: ReadonlySet<string> = new Set(["ja:desktop.incompatible", "ja:missing.docker"]);

  test("no message names a Windows key, program or store, or calls the owner's Mac a PC", () => {
    const found: string[] = [];
    for (const locale of Object.keys(catalogs) as UiLocale[]) {
      for (const key of Object.keys(catalogs[locale]) as MessageKey[]) {
        const text = systemMessage(key, locale, true);
        if (WINDOWS.test(text) && !MEMBER_PC.has(`${locale}:${key}`)) found.push(`${locale}:${key}: ${text.slice(0, 80)}`);
      }
    }
    expect(found, "add the Mac's words to mac-catalogs.ts (macCatalogs, or macRenames for one word)").toEqual([]);
  });

  test("a word changes in each language's own sentence, and Windows keeps its words", () => {
    expect(systemMessage("agent.thisPc", "en", true)).toBe("This Mac");
    expect(systemMessage("agent.thisPc", "ja", true)).toBe("この Mac");
    expect(systemMessage("agent.thisPc", "en", false)).toBe("This PC");
    expect(systemMessage("settings.039", "en", true)).toContain("press Return to test");
    expect(systemMessage("settings.039", "tr", true)).toContain("Return’e basın");
    expect(systemMessage("common.keyPasteHint", "en", true)).toContain("⌘V");
  });
});

// Raphael is the app's guide, separate from the slimes. The answer model, the cleanup of a bot conflict and the team a
// new person meets are not "Raphael", so these words never name him (the names are core/.../agent/speaker.py RAPHAEL_NAMES).
const RAPHAEL_NAMES = ["Raphael", "拉斐爾", "拉斐尔", "ラファエル", "라파엘", "Рафаэль", "ราฟาเอล"];
const NOT_RAPHAEL_KEYS = [
  "services.sameAsAnswer", "services.why.visionSame", "services.why.searchOpenrouter",
  "picker.roleAnswer", "onboarding.demoSummary", "msg.tg.conflict",
] as const;

test("the answer model, the key of a search, the team and a bot conflict never name Raphael in any language", () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const messages = catalog as Record<string, string>;
    for (const key of NOT_RAPHAEL_KEYS) {
      const text = messages[key];
      expect(text?.trim(), `${locale} ${key}`).toBeTruthy();
      for (const name of RAPHAEL_NAMES) expect(text.toLowerCase(), `${locale} ${key} names ${name}`).not.toContain(name.toLowerCase());
    }
  }
  expect(catalogs["zh-TW"]["services.sameAsAnswer"]).toBe("與回答模型相同");
  expect(catalogs["zh-TW"]["picker.roleAnswer"]).toBe("回答模型");
  expect(catalogs.en["services.sameAsAnswer"]).toBe("Same as the answer model");
});
