import { resolve } from "node:path";
import { expect, it } from "vitest";
import { readCatalogs, foreignPhrases } from "./catalogs.mjs";
import { UI_LOCALES } from "../locales.mjs";

it("native language checks include split source catalogs and accept shared Simplified/Traditional words", () => {
  const catalogs = readCatalogs(resolve(import.meta.dirname, "../../../src/main/i18n"));
  expect(Object.keys(catalogs)).toEqual(UI_LOCALES);
  for (const catalog of Object.values(catalogs)) expect(Object.keys(catalog).sort()).toEqual(Object.keys(catalogs["zh-TW"]).sort());
  const phrases = foreignPhrases(catalogs);
  // 「工作方法」 is written the same in Traditional and Simplified Chinese: it is no foreign phrase on either, and one on English.
  expect(phrases["zh-TW"]).not.toContain(catalogs["zh-TW"]["template.skill"]);
  expect(phrases["zh-CN"]).not.toContain(catalogs["zh-TW"]["template.skill"]);
  expect(phrases["en"]).toContain(catalogs["zh-TW"]["template.skill"]);
});
