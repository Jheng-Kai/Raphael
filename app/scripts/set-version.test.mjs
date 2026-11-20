import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLACES, current, setVersion } from "./set-version.mjs";

const root = resolve(import.meta.dirname, "../..");
const read = path => readFileSync(resolve(root, path), "utf8");

describe("set-version", () => {
  it("changes the version in all eight places and nothing else, reading every file before writing any", () => {
    const from = current(read), [major, minor, patch] = from.split(".").map(Number), to = `${major}.${minor}.${patch + 1}`;
    const written = {};
    const result = setVersion(to, { read, write: (path, text) => { written[path] = text; } });
    expect(result).toEqual({ from, to, files: Object.keys(PLACES) });
    let lines = 0;
    for (const [path, text] of Object.entries(written)) {
      const before = read(path).split("\n"), after = text.split("\n");
      expect(after).toHaveLength(before.length);
      const changed = after.filter((line, i) => line !== before[i]);
      expect(changed.length).toBeGreaterThan(0);
      for (const line of changed) expect(line).toContain(to);
      lines += changed.length;
    }
    expect(lines).toBe(9);  // the same nine lines a version pull request changed by hand
  });

  it("refuses a version that is not three numbers, and a file whose version is not the app's", () => {
    expect(() => setVersion("2.0", { read, write: () => {} })).toThrow(/three numbers/);
    const written = [];
    const stale = path => path === "core/uv.lock" ? read(path).replace(/(name = "raphael-core"\r?\nversion = ")[^"]+/, "$10.0.1") : read(path);
    expect(() => setVersion("9.9.9", { read: stale, write: path => written.push(path) })).toThrow(/expected version/);
    expect(written).toEqual([]);  // nothing is half written
  });
});
