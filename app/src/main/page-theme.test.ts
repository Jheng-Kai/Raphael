import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// An HTML page a member makes draws in the app's own theme (core agent/pages.py `THEME`, R-PAGE-05): the words it is given
// must be the window's, in both themes, so a page and a report's charts read as one app.
const styles = readFileSync(resolve(import.meta.dirname, "styles.css"), "utf8");
const pages = readFileSync(resolve(import.meta.dirname, "../../../core/src/raphael_core/agent/pages.py"), "utf8");
const tokens = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key!, value!.trim()]));
const light = tokens(styles.match(/:root\s*\{([\s\S]*?)\n\}/)![1]!);
const dark = { ...light, ...tokens(styles.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)![1]!) };
const hexes = (text: string): string[] => [...text.matchAll(/"(#[0-9a-f]{6})"/gi)].map(([, hex]) => hex!.toLowerCase());

test("an HTML page gets the window's own theme words and chart colours, in both themes", () => {
  const names = ["content", "panel", "text", "text-2", "text-3", "line", "accent", "on-accent", "link", "ok", "warn", "err"];
  const given = pages.match(/zip\(\(([^)]*)\)/)![1]!.match(/"[^"]+"/g)!.map(word => word.slice(1, -1));
  expect(given).toEqual(["bg", "surface", "fg", "fg-2", "muted", "line", "accent", "on-accent", "link", "ok", "warn", "err"]);
  for (const [theme, palette] of [["light", light], ["dark", dark]] as const) {
    const colours = hexes(pages.match(new RegExp(`\\("${theme}", \\(([^)]*)\\)\\)`))![1]!);
    expect(colours, theme).toEqual(names.map(name => palette[name]!.toLowerCase()));
    const charts = hexes(pages.match(new RegExp(`"${theme}": \\(([^)]*)\\)`))![1]!);
    expect(charts, theme).toEqual(Array.from({ length: 8 }, (_, index) => palette[`chart-${index + 1}`]!.toLowerCase()));
  }
  // The face is the window's, the generic names in the same order.
  const face = pages.match(/FONT = '([^']+)'/)![1]!.split(",");
  expect(face).toEqual(light.ui!.split(",").map(name => name.trim()));
});
