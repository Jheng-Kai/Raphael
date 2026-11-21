/// <reference types="node" />
// R-COPY-01: a message that sends the user to 「設定 › …」 names a place Settings has today. The tabs are those of
// PANES, and what is inside each is what the page draws (settings-view.ts); a path that is not there (「設定 › 連接 › 商店」,
// 「設定 › 拉斐爾 › 服務」) sends people to a place that does not exist. The same words are checked in every catalogue,
// in the core (failures.py, persona.py, the tables of _ui_words_data.py ...) and in the shell's notices (notices.rs).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { catalogs, LOCALES, setLocale } from "./i18n";
import { PANES, STANDALONE_PANE } from "./pages/settings-view";

type Locale = (typeof LOCALES)[number]["id"];
type Branch = Map<string, Branch>;
type Messages = Record<string, string>;

const messagesOf = (locale: Locale): Messages => catalogs[locale] as unknown as Messages;

/** The name of Settings is one word per language; these were written once for it and must not come back. */
const OLD_WORDS: Partial<Record<Locale, string[]>> = { es: ["Ajustes"], fr: ["Paramètres"], th: ["ตั้งค่า"] };
/** Composio's own page, which is in English: 「Settings › Project Settings › API Keys」 is a place on its site. */
const EXTERNAL = /^Project Settings/;
/** macOS's own System Settings (「系統設定 › 隱私權與安全性 › 輔助使用」, "System Settings > Privacy & Security"), which a Mac's
 *  words send people to for a permission: a place of the system, not of Raphael's Settings. */
const SYSTEM = String.raw`(?<!System |系統|系统|システム|시스템 )`;
const SEPARATOR = /^\s*(?:›|>|→)\s*/;

const branch = (...names: string[]): Branch => new Map(names.map((name) => [name, new Map()]));
const under = (...pairs: [string, Branch][]): Branch => new Map(pairs);

/** Every place of Settings a message may name, in `locale`'s words: the tab, then a section, then a row. */
export function settingsTree(locale: Locale): Branch {
  const m = messagesOf(locale);
  const media = [m["settings.quickModel"], m["settings.035"], m["settings.031"], m["media.image"], m["media.video"]];
  return under(
    [m["settings.paneGeneral"], branch(m["settings.ownerSection"], m["skin.title"], m["settings.067"], m["settings.059"], m["agent.title"], m["zone.title"], m["output.folder"])],
    // 模型 holds the models in use, the subscription accounts and the providers; a model row is named from 模型 too.
    [m["providers.title"], under(
      [m["models.used"], branch(...media)],
      [m["brains.accounts"], branch("ChatGPT", "Claude Code", "Codex")],
      [m["models.providers"], branch()],
      ...media.map((name): [string, Branch] => [name, branch()]),
    )],
    // 用量 has its two views: 概覽 (this month and the allowances) and 分析.
    [m["models.usage"], branch(m["usage.overview"], m["usage.analysis"])],
    [m["settings.paneTools"], under([m["services.title"], under(
      [m["services.search"], branch("SearXNG")], [m["services.read"], branch()], [m["services.vision"], branch()], [m["services.pdf"], branch()],
    )])],
    [m["settings.paneSkills"], branch()],
    [m["settings.paneDictation"], under(
      [m["home.shortcuts"], branch()],
      [m["settings.groupStart"], branch()],
      [m["settings.groupListen"], branch(m["transcription.title"], m["common.microphone"])],
      [m["data.groupDictation"], branch()],
      [m["transcription.title"], branch()],
      [m["common.microphone"], branch()],
    )],
    [m["settings.paneSafety"], branch(m["vault.title"], m["rules.title"])],
    [m["common.about"], branch()],
  );
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CJK_LOCALES: readonly Locale[] = ["zh-TW", "zh-CN", "ja", "ko", "th"];

interface Reading {
  /** Where the path starts in the text. */
  index: number;
  /** What is wrong with it, or null when it is a place of Settings. */
  problem: string | null;
}

/** Every path into Settings in `text`, read in `locale`'s words. A path ends where no known place follows. */
function readPlaces(locale: Locale, text: string): Reading[] {
  const canonicalWord = messagesOf(locale)["nav.settings"];
  const readings: Reading[] = [];
  for (const word of [canonicalWord, ...(OLD_WORDS[locale] ?? [])]) {
    const start = CJK_LOCALES.includes(locale) ? "" : String.raw`(?<![\p{L}\p{N}])`;
    const opening = new RegExp(String.raw`${start}(?<!Project )${SYSTEM}${escape(word)}\s*(?:›|>|→)\s*`, "gu");
    const canonical = word === canonicalWord ? [] : [...text.matchAll(new RegExp(escape(canonicalWord), "gu"))].map((m) => [m.index, m.index + m[0].length]);
    for (const hit of text.matchAll(opening)) {
      // The old word may be the end of the name now in use (ตั้งค่า in การตั้งค่า).
      if (canonical.some(([from, to]) => hit.index >= from && hit.index < to)) continue;
      let rest = text.slice(hit.index + hit[0].length);
      if (EXTERNAL.test(rest)) continue;
      if (word !== canonicalWord) {
        readings.push({ index: hit.index, problem: `"${word}" is not what this language calls Settings` });
        continue;
      }
      let places = settingsTree(locale);
      const read: string[] = [];
      let problem: string | null = null;
      for (;;) {
        const name = [...places.keys()].filter((key) => rest.startsWith(key)).sort((x, y) => y.length - x.length)[0];
        if (name === undefined) {
          problem = `${[word, ...read].join(" › ")} › ${rest.slice(0, 24).replace(/\s+/g, " ").trim()}`;
          break;
        }
        read.push(name);
        places = places.get(name)!;
        rest = rest.slice(name.length);
        const separator = SEPARATOR.exec(rest);
        if (!separator || places.size === 0) break;
        rest = rest.slice(separator[0].length);
      }
      readings.push({ index: hit.index, problem });
    }
  }
  return readings;
}

/** The paths of `text` that are no place of Settings in `locale`. */
export function missingPlaces(locale: Locale, text: string): string[] {
  return readPlaces(locale, text).flatMap((reading) => (reading.problem === null ? [] : [reading.problem]));
}

/**
 * The paths of a source that mixes languages (a core table, a notice with its translations). Two languages may call
 * Settings by the same word (設定 in Chinese and Japanese): a path is wrong when it is wrong in every one of them.
 */
export function missingPlacesInSource(locales: readonly Locale[], text: string): string[] {
  const at = new Map<number, (string | null)[]>();
  for (const locale of locales) for (const reading of readPlaces(locale, text)) at.set(reading.index, [...(at.get(reading.index) ?? []), reading.problem]);
  return [...at.values()].filter((problems) => problems.every((problem) => problem !== null)).map((problems) => problems[0]!);
}

describe("a path into Settings names a place Settings has", () => {
  test("the checker knows a place that is not there", () => {
    expect(missingPlaces("zh-TW", "請到「設定 › 連接 › 商店」")).toHaveLength(1);
    expect(missingPlaces("zh-TW", "請到「設定 › 拉斐爾 › 服務 › 搜尋網路」")).toHaveLength(1);
    expect(missingPlaces("zh-TW", "請到「設定 › 聽寫」")).toHaveLength(1);
    expect(missingPlaces("en", "Open Settings > Connections.")).toHaveLength(1);
    expect(missingPlaces("zh-TW", "請到「設定 › 工具 › 服務 › 搜尋網路 › SearXNG」")).toEqual([]);
    expect(missingPlaces("zh-TW", "請到「設定 › 聽寫與快捷鍵 › 麥克風」選擇。")).toEqual([]);
    expect(missingPlaces("en", "Check it in Settings > Models > Subscription accounts, then refresh.")).toEqual([]);
    expect(missingPlaces("zh-TW", "請到「設定 › 用量」調整上限。")).toEqual([]);
    expect(missingPlaces("en", "from Settings > Project Settings > API Keys on the Composio website")).toEqual([]);
    expect(missingPlaces("zh-TW", "請到「系統設定 › 隱私權與安全性 › 輔助使用」允許拉斐爾。")).toEqual([]);
    expect(missingPlaces("en", "Allow Raphael in System Settings > Privacy & Security > Accessibility.")).toEqual([]);
    expect(missingPlaces("fr", "dans Paramètres > Outils")).toHaveLength(1);
  });

  test("the tabs of the tree are the tabs of Settings, in every language", () => {
    try {
      for (const { id } of LOCALES) {
        setLocale(id);
        const tabs = PANES.filter((pane) => pane.id !== STANDALONE_PANE).map((pane) => pane.title());
        expect(tabs).toHaveLength(8);
        expect([...settingsTree(id).keys()]).toEqual(tabs);
      }
    } finally { setLocale("zh-TW"); }
  });

  test("every message of every catalogue", () => {
    const wrong: string[] = [];
    for (const { id } of LOCALES) {
      for (const [key, value] of Object.entries(messagesOf(id))) {
        for (const place of missingPlaces(id, value)) wrong.push(`${id} ${key}: ${place}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("every message of the core and the shell", () => {
    const root = path.resolve(import.meta.dirname, "..", "..", "..");
    const files = (dir: string, extension: string): string[] =>
      readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(extension) && !file.split(path.sep).includes("__pycache__"))
        .map((file) => path.join(dir, file));
    const sources = [...files(path.join(root, "core", "src"), ".py"), ...files(path.join(root, "app", "src-tauri", "src"), ".rs")];
    expect(sources.length).toBeGreaterThan(50);
    const wrong: string[] = [];
    for (const file of sources) {
      // A comment is not a message; the code around a message is not a path (`Settings>` of a generic is no 「設定 ›」).
      const code = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => !/^\s*(?:#|\/\/)/.test(line)).join("\n");
      for (const place of missingPlacesInSource(LOCALES.map((locale) => locale.id), code)) wrong.push(`${path.relative(root, file)}: ${place}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);
});
