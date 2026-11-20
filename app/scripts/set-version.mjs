// Sets the app's version in every file that carries it, so a version rides in the last pull request of a release
// instead of a pull request (and a CI run) of its own.
//
//   npm run set-version -- 2.0.6
//
// The eight places: the app's package.json and package-lock.json (twice), tauri.conf.json, the shell's Cargo.toml and
// its entry in Cargo.lock, the core's pyproject.toml, __version__ and its entry in uv.lock.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "../..");

/** Each file, and how its version is changed from `from` to `to`; every change must find exactly what it expects. */
export const PLACES = {
  "app/package.json": (text, from, to) => once(text, `"version": "${from}"`, `"version": "${to}"`),
  "app/package-lock.json": (text, from, to) => twice(text, `"version": "${from}"`, `"version": "${to}"`),
  "app/src-tauri/tauri.conf.json": (text, from, to) => once(text, `"version": "${from}"`, `"version": "${to}"`),
  "app/src-tauri/Cargo.toml": (text, from, to) => entry(text, /(\[package\]\r?\nname = "app"\r?\nversion = ")([^"]+)(")/, from, to),
  "app/src-tauri/Cargo.lock": (text, from, to) => entry(text, /(\[\[package\]\]\r?\nname = "app"\r?\nversion = ")([^"]+)(")/, from, to),
  "core/pyproject.toml": (text, from, to) => entry(text, /(\[project\]\r?\nname = "raphael-core"\r?\nversion = ")([^"]+)(")/, from, to),
  "core/src/raphael_core/__init__.py": (text, from, to) => once(text, `__version__ = "${from}"`, `__version__ = "${to}"`),
  "core/uv.lock": (text, from, to) => entry(text, /(\[\[package\]\]\r?\nname = "raphael-core"\r?\nversion = ")([^"]+)(")/, from, to),
};

function once(text, old, now) {
  if (text.split(old).length !== 2) throw new Error(`expected ${old} once`);
  return text.replace(old, now);
}

function twice(text, old, now) {
  // The lock's own version and its root package's: the two first occurrences, before any dependency.
  const first = text.indexOf(old), second = text.indexOf(old, first + 1);
  if (first < 0 || second < 0) throw new Error(`expected ${old} twice`);
  return text.slice(0, first) + now + text.slice(first + old.length, second) + now + text.slice(second + old.length);
}

function entry(text, pattern, from, to) {
  const match = pattern.exec(text);
  if (!match || match[2] !== from) throw new Error(`expected version ${from}, found ${match ? match[2] : "no entry"}`);
  return text.replace(pattern, `$1${to}$3`);
}

/** The version the app has now (package.json's). */
export const current = (read = path => readFileSync(resolve(root, path), "utf8")) => JSON.parse(read("app/package.json")).version;

/** Sets `to` everywhere; every file is read and checked before any is written. */
export function setVersion(to, { read = path => readFileSync(resolve(root, path), "utf8"), write = (path, text) => writeFileSync(resolve(root, path), text) } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(to)) throw new Error(`a version is three numbers, like 2.0.6, not ${to}`);
  const from = current(read);
  const changed = Object.entries(PLACES).map(([path, change]) => [path, change(read(path), from, to)]);
  for (const [path, text] of changed) write(path, text);
  return { from, to, files: changed.map(([path]) => path) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { from, to, files } = setVersion(process.argv[2] ?? "");
  console.log(`${from} -> ${to} in ${files.length} files: ${files.join(", ")}`);
}
