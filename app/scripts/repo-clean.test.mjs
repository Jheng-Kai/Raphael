import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { hitsOf, isScanned, trackedHits } from "./repo-clean.mjs";

// A "~" marks where a sample word is broken, so that this file does not hold the very marks it proves the
// lint finds. `rules` gives the rule of each hit a sample earns under a path.
const sample = (text) => text.replaceAll("~", "");
const rules = (path, text) => hitsOf(path, sample(text)).map((hit) => hit.rule);

describe("owner", () => {
  it.each([
    ["a.py", "# (own~er, 2026-~11-09) keep the list sorted"],
    ["a.ts", "// (own~er 11/09) keep the list sorted"],
    ["a.md", "Own~er (2026-~11-09): the card stays"],
    ["a.md", "Own~er's request: a fixed width"],
    ["a.md", "Own~er: the field is wider"],
    ["a.md", "> Own~er, then a reason"],
    ["a.ts", "// The same own~er asked again"],
    ["a.md", "Settled with own~er 11/09 on a call"],
    ["a.md", "| R-UI-01 | A rule. | Own~er, with a picture of the page |"],
    ["a.md", "Own~er's picture of the page: wider"],
    ["a.md", "Same re~port: the card is wider"],
    ["a.md", "Own~er 2026-~11-09 asked for it"],
    ["a.md", "Added because the own~er asked for this"],
  ])("a provenance mark hits: %s %s", (path, text) => {
    expect(rules(path, text)).toContain("owner");
  });

  it.each([
    ["a.md", "The owner opens Settings, and the owner's PC stays on."],
    ["a.ts", "// the owner chooses a folder, and the owner's choice is kept"],
    ["a.md", "Owner private tools stay out of a member's list."],
    ["a.ts", "const ownerVoice = true;"],
    ["a.md", "See owner-management.md for the tools."],
    ["a.md", "A member does what its owner asks."],
    ["a.md", "The own~er asked for items to be listed, and the owner's check runs."],
    ["a.md", "| R-UI-01 | The owner's own list is on top |"],
    ["a.py", "parser.add_argument(\"--own~er-approved-real-smoke\", action=\"store_true\")"],
    ["a.md", "A real key stays own~er-approved; the flag is --own~er-approved-real-smoke."],
  ])("the owner as the app's user does not hit: %s %s", (path, text) => {
    expect(rules(path, text)).toEqual([]);
  });
});

describe("quote", () => {
  it("speech quoted after the word owner hits", () => {
    expect(rules("a.md", "(own~er says: 「another word」)")).toEqual(["quote"]);
    expect(rules("a.md", "Own~er, 「another word」")).toContain("quote");
  });

  it("an interface string in 「」 does not hit", () => {
    expect(rules("a.md", "The button reads 「設定」 and the owner sees it.")).toEqual([]);
    expect(rules("a.md", "The owner's own list has 「連結應用程式」 on top.")).toEqual([]);
  });
});

describe("dated", () => {
  const day = "2026-~11-09";

  it.each([
    ["a.ts", `// shipped on ${day}`],
    ["a.ts", `const gap = 4; // since ${day}`],
    ["a.ts", ` * since ${day}`],
    ["a.rs", `/* since ${day} */`],
    ["a.py", `gap = 4  # since ${day}`],
    ["a.yml", `run: build # ${day}`],
    ["a.html", `<p></p><!-- ${day} -->`],
    ["a.md", `Retired on ${day}.`],
    ["a.md", `## A heading (${day})`],
  ])("a date in a comment or in prose hits: %s %s", (path, text) => {
    expect(rules(path, text)).toContain("dated");
  });

  it.each([
    ["a.ts", `it("keeps the card shown on ${day}", () => {});`],
    ["a.ts", `describe("the card of ${day}", () => {`],
    ["a.mjs", `it.skip("a row of ${day}: %s", () => {});`],
    ["a.py", "def test_card_2026_~11_09():"],
  ])("a date in a test's title hits, in code as well: %s %s", (path, text) => {
    expect(rules(path, text)).toEqual(["dated"]);
  });

  it.each([
    ["a.ts", 'it("keeps the card", () => {});'],
    ["a.py", "def test_card_is_kept():"],
  ])("a test title without a date does not hit: %s %s", (path, text) => {
    expect(rules(path, text)).toEqual([]);
  });

  it("a date inside a Python docstring hits, and the same date in code does not", () => {
    const docstring = ['"""A summary.', `Added ${day}.`, '"""', "gap = 4"].join("\n");
    expect(hitsOf("a.py", sample(docstring)).map((hit) => [hit.line, hit.rule])).toEqual([[2, "dated"]]);
  });

  it("a line inside a block comment hits, and the code after its end does not", () => {
    const css = ["/* a rule that stays", `   measured on ${day}); the thread passes. */`, `.a { content: "${day}"; }`].join("\n");
    expect(hitsOf("a.css", sample(css)).map((hit) => [hit.line, hit.rule])).toEqual([[2, "dated"]]);
    const markup = ["<!-- one", `  of ${day} -->`, `<p>${day}</p>`].join("\n");
    expect(hitsOf("a.html", sample(markup)).map((hit) => [hit.line, hit.rule])).toEqual([[2, "dated"]]);
  });

  it.each([
    ["a.ts", `const day = "${day}";`],
    ["a.py", `DAY = "${day}"`],
    ["a.json", `{ "day": "${day}" }`],
    ["a.rs", `let day = "${day}"; // a fixed day`],
    ["a.md", "A day is written 24 October 2026 when it is data."],
  ])("a date that is data does not hit: %s %s", (path, text) => {
    expect(rules(path, text)).toEqual([]);
  });

  it.each([
    ["a.ts", `const link = "https://example.com/${day}"; const day = "${day}";`],
    ["a.ts", `const glob = './*'; const day = "${day}";`],
    ["a.mjs", `run("gh release create ./*"); stdout: "built (${day})";`],
    ["a.ts", "const note = `a // b ${day}`;"],
    ["a.py", `body = {"kind": "calendar#events", "updated": "${day}"}`],
    ["a.py", `body = 'a # b ${day}'`],
    ["a.rs", `fn run<'a>(x: &'a str) { let day = "${day}"; }`],
    ["a.yml", `url: https://example.com/#anchor-${day}`],
  ])("a comment marker inside a string is text, so a date after it is data: %s %s", (path, text) => {
    expect(rules(path, text)).toEqual([]);
  });

  it.each([
    ["a.ts", `const link = "https://example.com"; // since ${day}`],
    ["a.ts", `const glob = './*'; // since ${day}`],
    ["a.mjs", `const text = "it's"; // since ${day}`],
    ["a.py", `body = {"kind": "calendar#events"}  # since ${day}`],
    ["a.rs", `fn run<'a>(x: &'a str) { // since ${day}`],
    ["a.rs", `let quote = '"'; // since ${day}`],
    ["a.yml", `url: https://example.com/#anchor # since ${day}`],
  ])("a real comment after such a string still hits: %s %s", (path, text) => {
    expect(rules(path, text)).toEqual(["dated"]);
  });

  it("a line of a multi-line template literal is data, and a comment after its end is not", () => {
    const code = ["const prompt = `", `Meet at https://x.test/ // on ${day}`, "`; // note", `const day = "${day}";`].join("\n");
    expect(hitsOf("a.ts", sample(code))).toEqual([]);
    const marked = code.replace("// note", `// since ${day}`);
    expect(hitsOf("a.ts", sample(marked)).map((hit) => [hit.line, hit.rule])).toEqual([[3, "dated"]]);
  });

  it("a prompt held in a triple-quoted string is data, and a docstring is not", () => {
    const quotes = '"""';
    const python = [
      `PROMPT = ${quotes}\\`,
      `Example: "${day} reading the page".`,
      `${quotes} + MORE`,
      "",
      "def read():",
      `    ${quotes}Reads a page.`,
      `    Added ${day}.`,
      `    ${quotes}`,
      `    return "${day}"`,
      "",
      "class Box:",
      `    ${quotes}One box, as of ${day}.${quotes}`,
      "",
      "SYSTEM = (",
      `    ${quotes}\\`,
      `Example ${day}.${quotes}`,
      ")",
    ].join("\n");
    expect(hitsOf("a.py", sample(python)).map((hit) => [hit.line, hit.rule])).toEqual([[7, "dated"], [12, "dated"]]);
  });

  it("a comment after a triple-quoted string, and a module docstring after comments, still count", () => {
    const quotes = '"""';
    const python = [
      "# A header comment.",
      `${quotes}The module.`,
      `Since ${day}.`,
      quotes,
      `X = ${quotes}data ${day}${quotes}  # since ${day}`,
    ].join("\n");
    expect(hitsOf("a.py", sample(python)).map((hit) => [hit.line, hit.rule])).toEqual([[3, "dated"], [5, "dated"]]);
  });

  it("the Date column of the rule ledger is data, and a second date in the row is not", () => {
    const row = `| R-UI-01 | ${day} | A rule. | \`check\` | high | evidence |`;
    expect(rules("a.md", row)).toEqual([]);
    expect(rules("a.md", row.replace("evidence", `fixed ${day}`))).toEqual(["dated"]);
    expect(rules("a.md", row.replace("R-UI-01", "Something else"))).toEqual(["dated"]);
  });
});

describe("ref", () => {
  it.each([
    "see P~R #123 for the change",
    "after P~R 45",
    "(bri~ef 21)",
    "ta~sk 797 asked for it",
    "tu~rn 1580 showed it",
    "rou~tine 4821",
    "the old own~er-a build",
    "the build own~er-1116",
    "the build own~er-next",
  ])("a pointer into history hits: %s", (text) => {
    expect(rules("a.md", text)).toContain("ref");
  });

  it.each([
    "P~R 5 is small",
    "a P~R #12345 number is not one",
    "tu~rn 12 is short",
    "the tasks 797 are many",
    "see own~er-management.md",
    "the own~er-run-time",
  ])("an ordinary phrase does not hit: %s", (text) => {
    expect(rules("a.md", text)).toEqual([]);
  });
});

describe("which files are read", () => {
  it("skips licence texts, lock files and files that are not text", () => {
    expect(isScanned("app/src/main/a.ts")).toBe(true);
    expect(isScanned("README.md")).toBe(true);
    expect(isScanned("Dockerfile")).toBe(true);
    expect(isScanned("core/packaging/licenses/MIT.txt")).toBe(false);
    expect(isScanned("app/package-lock.json")).toBe(false);
    expect(isScanned("LICENSE")).toBe(false);
    expect(isScanned("app/public/brand/mark.png")).toBe(false);
  });

  it("limits the walk to the given paths", () => {
    expect(isScanned("app/src/a.ts", ["app/src"])).toBe(true);
    expect(isScanned("app/src/a.ts", ["app/src/a.ts"])).toBe(true);
    expect(isScanned("app/srcs/a.ts", ["app/src"])).toBe(false);
    expect(isScanned("core/a.py", ["app"])).toBe(false);
  });
});

describe("the walk over tracked files", () => {
  const cache = join(dirname(fileURLToPath(import.meta.url)), "..", ".test-cache", "repo-clean-tests");
  const made = [];

  afterEach(() => {
    for (const folder of made.splice(0)) {
      if (relative(cache, folder).startsWith("..")) throw new Error("Fixture escaped its cache directory");
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("reports the marks of tracked files only, with their path and line", () => {
    mkdirSync(cache, { recursive: true });
    const folder = mkdtempSync(join(cache, "repo-"));
    made.push(folder);
    const git = (...args) => execFileSync("git", args, { cwd: folder, stdio: "ignore" });
    git("init", "-q");
    writeFileSync(join(folder, "clean.md"), "Nothing to see.\n");
    writeFileSync(join(folder, "marked.md"), sample("Fine.\nOwn~er (2026-~11-09): a mark.\n"));
    writeFileSync(join(folder, "untracked.md"), sample("Own~er request: not tracked.\n"));
    git("add", "clean.md", "marked.md");

    const hits = trackedHits(folder);
    expect(hits.map(({ path, line, rule }) => [path, line, rule])).toEqual([
      ["marked.md", 2, "owner"],
      ["marked.md", 2, "dated"],
    ]);
    expect(trackedHits(folder, ["clean.md"])).toEqual([]);
  });
});
