// A repository reads as the product's own when nothing in it tells how it was made: who asked for a thing
// and when, quoted requests, dates in comments and prose, and pointers into a tracker that a clone of the
// repository does not have. This lint finds those four kinds of mark in every tracked text file.
//
//   owner   a provenance mark in front of a note or a rule
//   quote   speech quoted after such a mark
//   dated   a calendar date in a comment, a docstring, prose or the title of a test
//   ref     a pointer into history: a pull request, a brief, a task or a turn number
//
// "The owner" as the person who uses the app is product vocabulary and is not a mark. A date that is data
// (a fixture, an expected value, the Date column of the rule ledger) is not a date in a comment.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const defaultRepository = resolve(dirname(script), "..", "..");

/** Files whose text belongs to someone else, or is generated, and so is not ours to word. */
const SKIPPED_PREFIXES = [
  "core/packaging/licenses/",
  "app/scripts/release-licenses/",
  "app/src-tauri/vendor/",
  "core/src/raphael_core/computer/image/THIRD_PARTY_NOTICES.txt",
];
const SKIPPED_NAMES = new Set(["package-lock.json", "Cargo.lock", "uv.lock", "LICENSE"]);
const TEXT_SUFFIXES = new Set([
  ".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".rs", ".css", ".html", ".md", ".json", ".toml", ".yml", ".yaml",
  ".txt", ".ps1", ".sh", ".svg", ".cfg", ".ini", ".nsh", ".nsi", ".xml", ".plist", ".dockerfile", "",
]);

// Each suffix says how a comment starts. A suffix in none of the sets has no comment to look in.
const PROSE_SUFFIXES = new Set([".md", ".txt"]);
const HASH_COMMENT = new Set([".py", ".yml", ".yaml", ".toml", ".ps1", ".sh", ".cfg", ".ini", ".dockerfile", ""]);
const SLASH_COMMENT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".rs", ".css", ".nsh", ".nsi"]);
const MARKUP_COMMENT = new Set([".html", ".svg", ".xml"]);

// A word boundary that treats every letter and digit as part of a word, so a mark glued to CJK text is not a
// separate word.
const WORD = String.raw`[\p{L}\p{N}_]`;
const START = `(?<!${WORD})`;
const END = `(?!${WORD})`;

const DATE = String.raw`20(?:25|26)-[01]\d-[0-3]\d`;

const OWNER = new RegExp(
  [
    String.raw`\(owner[,:]? ?(?:20\d\d|\d{1,2}/\d{1,2})`,
    `${START}owner,? ${DATE}`,
    `${START}Owner(?:'s)? (?:\\(|request|report|note|feedback|decision)`,
    String.raw`^\s*(?:[#/*>-]+\s*)?Owner[,:]`,
    `${START}The same [o]wner${END}`,
    `${START}Owner, ${DATE}`,
    `${START}owner \\d{1,2}/\\d{1,2}${END}`,
    String.raw`\| Owner(?:'s)?[,: ]`,
    `${START}[O]wner, with${END}`,
    `${START}[O]wner's (?:check|picture|words|message|own words)${END}`,
    `${START}Same (?:report|conversation|owner):`,
    `${START}[O]wner ${DATE}`,
    `${START}[o]wner-approved${END}`,
    `${START}the [o]wner asked for (?:this|it)${END}`,
  ].join("|"),
  "u",
);
const QUOTE = /[Oo]wner[^「\n]{0,60}[:：,] ?「/u;
const REF = new RegExp(
  [
    `${START}PR ?#?\\d{2,3}${END}`,
    `${START}brief \\d+${END}`,
    `${START}(?:task|turn|routine) \\d{3,5}${END}`,
    `${START}owner-(?:next|run|[a-z]|\\d{4})${END}(?![-\\p{L}\\p{N}_])`,
  ].join("|"),
  "u",
);
// A test titled with a date keeps the history in the name it reports; a Python test is named by its function.
const TITLE_DATE = new RegExp(
  `${START}(?:it|test|describe)(?:\\.${WORD}+)*\\(\\s*["'\`][^\\n]*${DATE}|^\\s*(?:async )?def test_${WORD}*20(?:25|26)_?[01]\\d`,
  "u",
);
const DATE_EVERYWHERE =new RegExp(DATE, "gu");
// The one place a date is data in prose: the Date column of the rule ledger.
const LEDGER_ROW = new RegExp(`^\\| R-[A-Z0-9-]+[a-z]? \\| (${DATE}) \\|`, "du");

/** The extension of a file name in lower case; a name that only starts with a dot has none. */
function suffixOf(path) {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : "";
}

/** Where the comment part of a line begins, or -1 when the line shows no comment. */
function commentStart(line, suffix) {
  if (HASH_COMMENT.has(suffix)) return line.indexOf("#");
  if (SLASH_COMMENT.has(suffix)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return line.length - trimmed.length;
    const spots = [line.indexOf("//"), line.indexOf("/*")].filter((index) => index >= 0);
    return spots.length ? Math.min(...spots) : -1;
  }
  if (MARKUP_COMMENT.has(suffix)) return line.indexOf("<!--");
  return -1;
}

/** The lines of a text the way a text editor counts them; a final line break does not start another line. */
function linesOf(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * Every mark of history in one file's text, as { line, rule, text }; `line` counts from 1 and `text` is the
 * trimmed line. Nothing is read from disk, so a sample can be judged under any path.
 */
export function hitsOf(path, text) {
  const suffix = suffixOf(path);
  const prose = PROSE_SUFFIXES.has(suffix);
  const hits = [];
  let inDocstring = false;
  let inBlock = false;
  const markup = MARKUP_COMMENT.has(suffix);
  const [opener, closer] = markup ? ["<!--", "-->"] : ["/*", "*/"];
  linesOf(text).forEach((line, index) => {
    // A line inside a docstring or a block comment is comment text, however it begins.
    let inDocLine = inDocstring;
    if (suffix === ".py" && (line.split('"""').length - 1) % 2 === 1) {
      inDocstring = !inDocstring;
      inDocLine = true;
    } else if (SLASH_COMMENT.has(suffix) || markup) {
      inDocLine = inBlock;
      const opened = line.lastIndexOf(opener);
      const closed = line.lastIndexOf(closer);
      if (opened > closed) inBlock = true;
      else if (closed >= 0) inBlock = false;
    }
    const found = [];
    if (OWNER.test(line)) found.push("owner");
    if (QUOTE.test(line)) found.push("quote");
    if (REF.test(line)) found.push("ref");
    const dates = [...line.matchAll(DATE_EVERYWHERE)];
    if (TITLE_DATE.test(line)) {
      found.push("dated");
    } else if (dates.length) {
      if (prose || inDocLine) {
        const ledger = LEDGER_ROW.exec(line);
        const ledgerDate = ledger ? ledger.indices[1][0] : -1;
        if (dates.some((date) => date.index !== ledgerDate)) found.push("dated");
      } else {
        const start = commentStart(line, suffix);
        if (start >= 0 && dates.some((date) => date.index > start)) found.push("dated");
      }
    }
    for (const rule of found) hits.push({ line: index + 1, rule, text: line.trim() });
  });
  return hits;
}

/** Whether a tracked path is text of ours, and lies under one of the given paths when any are given. */
export function isScanned(path, roots = []) {
  if (SKIPPED_PREFIXES.some((prefix) => path.startsWith(prefix)) || SKIPPED_NAMES.has(basename(path))) return false;
  if (!TEXT_SUFFIXES.has(suffixOf(path))) return false;
  return !roots.length || roots.some((root) => path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`));
}

/** Every mark in the tracked files of a repository, as { path, line, rule, text }, in the order git lists them. */
export function trackedHits(repository = defaultRepository, roots = []) {
  const listing = execFileSync("git", ["ls-files", "-z"], { cwd: repository, maxBuffer: 1 << 28 }).toString("utf8");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const hits = [];
  for (const path of listing.split("\0")) {
    if (!path || !isScanned(path, roots)) continue;
    let text;
    try {
      text = decoder.decode(readFileSync(resolve(repository, path)));
    } catch {
      continue; // Not text, or not there (a deleted file, a submodule folder).
    }
    for (const hit of hitsOf(path, text)) hits.push({ path, ...hit });
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  const roots = process.argv.slice(2).map((path) => path.replaceAll("\\", "/").replace(/\/+$/, ""));
  const hits = trackedHits(defaultRepository, roots);
  for (const hit of hits) console.log(`${hit.path}:${hit.line}:${hit.rule}: ${[...hit.text].slice(0, 200).join("")}`);
  if (hits.length) {
    console.error(`repo-clean: ${hits.length} ${hits.length === 1 ? "mark" : "marks"} of history in tracked files`);
    process.exitCode = 1;
  }
}
