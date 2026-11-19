// R-COPY-03: what a first-time user reads says things in plain words. A price is counted in words, not tokens; a failed
// connection or a stopped program is told without MCP and CLI; a key is checked without its milliseconds; the Composio
// dialog speaks one language. The custom connection's own form keeps its technical words (MCP JSON, API version).
import { describe, expect, test } from "vitest";
import { catalogs, LOCALES } from "./i18n";

type Messages = Record<string, string>;
const messages = (id: (typeof LOCALES)[number]["id"]): Messages => catalogs[id] as unknown as Messages;

/** The messages that a person who has never heard of the words reads (the forms of a custom connection are not among them). */
const WITHOUT_MCP = ["agent.reason.protocol", "conn.err.not_found", "conn.err.protocol", "conn.err.missing_secret"];
const WITHOUT_CLI = ["missing.cli", "agent.reason.cliStopped", "rooms.blockedLogin", "rooms.blockedBusy"];
const PRICES = ["pricing.002", "pricing.004", "chooser.apiNote", "chooser.apiMediaNote"];
/** The word for a token in each language that has one of its own (the others write Token or token). */
const TOKEN = /token|トークン|토큰|jeton|токен|โทเคน/i;

describe("plain words in what a first-time user reads", () => {
  test("a failed connection is told without MCP, environment variables or headers, in every language", () => {
    for (const { id } of LOCALES) {
      for (const key of WITHOUT_MCP) expect(messages(id)[key], `${id} ${key}`).not.toMatch(/MCP/);
      for (const key of ["agent.reason.missing_secret", "conn.err.missing_secret"]) {
        expect(messages(id)[key], `${id} ${key}`).not.toMatch(/environment variable|環境變數|环境变量|環境変数|환경 변수|variables? d[eo]|variabili d|Umgebungsvariable|variáveis de ambiente|переменн|biến môi trường|ตัวแปรสภาพแวดล้อม|variabel lingkungan|ortam değişken|header|標頭|标头|ヘッダー|헤더|cabeceras|en-têtes|intestazioni|заголовки|tiêu đề|ส่วนหัว|başlık/i);
      }
    }
  });

  test("a subscription program is named by its name, not by CLI", () => {
    for (const { id } of LOCALES) for (const key of WITHOUT_CLI) expect(messages(id)[key], `${id} ${key}`).not.toMatch(/\bCLI\b/);
    expect(messages("zh-TW")["missing.cli"]).toContain("Claude Code 或 Codex");
    expect(messages("en")["rooms.blockedLogin"]).toBe("Needs to be installed or signed in");
  });

  test("a price is counted in words, never in tokens", () => {
    for (const { id } of LOCALES) for (const key of PRICES) expect(messages(id)[key], `${id} ${key}`).not.toMatch(TOKEN);
    expect(messages("zh-TW")["pricing.004"]).toBe("{p0} 約每百萬字");
    expect(messages("en")["pricing.002"]).toBe("Input {p0} / output {p1} per million words (approx.)");
  });

  test("no message counts milliseconds, and a key's check says only whether it is connected", () => {
    for (const { id } of LOCALES) {
      expect(messages(id)["settings.041"], id).toBeUndefined();
      for (const [key, value] of Object.entries(messages(id))) expect(value, `${id} ${key}`).not.toMatch(/\{p\d\}\s*(?:ms|мс)\b/);
    }
  });

  test("the Composio dialog is in one language: the name of the app and of the key follow the window's", () => {
    expect(messages("zh-TW")["setup.keepKey"]).not.toMatch(/Raphael/);
    expect(messages("zh-TW")["setup.keepApp"]).not.toMatch(/Raphael/);
    expect(messages("zh-CN")["setup.keepKey"]).not.toMatch(/Raphael/);
    expect(messages("ja")["setup.keepKey"]).not.toMatch(/Raphael/);
    expect(messages("zh-TW")["plugins.keyPrompt"]).toBe("Composio API 金鑰");
    expect(messages("zh-TW")["common.apiKeyField"]).toBe("OpenRouter API 金鑰");
  });
});
