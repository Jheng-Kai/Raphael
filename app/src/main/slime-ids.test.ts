// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { LEGACY_SLIME_IDS, RETIRED_SLIME_IDS, currentSlimeId, sha256Hex } from "./slime-ids";
import { parseSlime, slimeCharactersHTML } from "./slime";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const same = (text: string): string => text;

// A made-up id stands in for the retired ones: the repository never spells them, so a test adds the digest of its own.
const OLD = "face-from-before", NEW = "horns-red";
const table = RETIRED_SLIME_IDS as Record<string, string>;
const withOld = (run: () => void): void => {
  table[sha(OLD)] = NEW;
  try { run(); } finally { delete table[sha(OLD)]; }
};

test("the hash agrees with the platform's for texts of every length around a block", () => {
  for (const text of ["", "abc", "slime:color:sky", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(200), "角色 ひらがな 🙂"]) {
    expect(sha256Hex(text), text.slice(0, 12)).toBe(sha(text));
  }
});

test("there is one entry for each retired face, and every value is a face the picker has", () => {
  expect(Object.keys(RETIRED_SLIME_IDS)).toHaveLength(24);
  // The keys as a whole: dropping, adding or changing one changes this.
  expect(sha(Object.keys(RETIRED_SLIME_IDS).sort().join("\n"))).toBe("fa8fcb14cc33e624ebc35502f0c206407ba471d2f26a8b8d320cb03cdf7a86a7");
  const picker = document.createElement("div");
  picker.innerHTML = slimeCharactersHTML(null, same);
  const faces = new Set([...picker.querySelectorAll<HTMLElement>("[data-slime-character]")].map(button => button.dataset.slimeCharacter));
  expect(new Set(Object.values(RETIRED_SLIME_IDS)).size).toBe(24);
  for (const id of [...Object.values(RETIRED_SLIME_IDS), ...LEGACY_SLIME_IDS.values()]) {
    expect(faces.has(id), id).toBe(true);
    expect(currentSlimeId(id), `${id} is current, not retired`).toBe(id);
  }
});

test("a retired id draws the face it was renamed to, in every form it was stored in", () => {
  withOld(() => {
    expect(currentSlimeId(OLD)).toBe(NEW);
    expect(parseSlime(`slime:${OLD}`)).toEqual({ character: NEW });
    expect(parseSlime(`slime:${OLD}:coral`)).toEqual({ character: NEW });
  });
  expect(parseSlime(`slime:${OLD}`), "the digest was only for that test").toBeNull();
});

test("an id nobody knows still falls back as it did", () => {
  expect(currentSlimeId("no-such-face")).toBe("no-such-face");
  expect(currentSlimeId("constructor")).toBe("constructor");
  expect(parseSlime("slime:no-such-face")).toBeNull();
  expect(parseSlime("slime:no-such-face:teal")).toEqual({ color: "teal" });
  expect(parseSlime("slime:color:sky")).toEqual({ color: "sky" });
  expect(parseSlime("slime:cat-ears")).toEqual({ character: "cat-ears" });
});

test("the app and the core keep the same table", () => {
  const source = readFileSync(resolve(__dirname, "../../../core/src/raphael_core/slime_ids.py"), "utf8");
  const retired = source.slice(source.indexOf("RETIRED: dict"), source.indexOf("\n}\n", source.indexOf("RETIRED: dict")));
  expect(Object.fromEntries([...retired.matchAll(/"([0-9a-f]{64})": "([a-z-]+)"/g)].map(match => [match[1], match[2]]))).toEqual(RETIRED_SLIME_IDS);
  const legacy = source.slice(source.indexOf("LEGACY: dict"), source.indexOf("\n\n", source.indexOf("LEGACY: dict")));
  expect(new Map([...legacy.matchAll(/"([a-z]+)": "([a-z-]+)"/g)].map(match => [match[1]!, match[2]!]))).toEqual(LEGACY_SLIME_IDS);
});
