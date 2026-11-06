import { afterEach, describe, expect, test } from "vitest";
import { buildGrid, heatmapSVG } from "./heatmap";
import { setLocale } from "./i18n";

afterEach(() => setLocale("zh-TW"));

/** `n` days up to 2026-10-14 (a Wednesday), oldest first, with words from `words(k)` for day k from today. */
function days(n: number, words: (back: number) => number = () => 0) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(2026, 9, 14, 12) - k * 86_400_000);
    const w = words(k);
    out.push({ date: d.toISOString().slice(0, 10), dictations: w > 0 ? 1 : 0, words: w });
  }
  return out;
}

/** Dictations on the 8th, 10th and 13th of October 2026; none on the other days. */
const grid = () => buildGrid(days(21, (k) => ({ 1: 40, 4: 120, 6: 15 })[k] ?? 0), 3);

describe("the days of the grid", () => {
  test("a day's words show in its title under the pointer, in the language of the window", () => {
    expect(heatmapSVG(grid())).toContain("<title>10 月 13 日：40 字</title>");
    setLocale("en");
    expect(heatmapSVG(grid())).toContain("40 words</title>");
  });

  test("a day is no button: pressing it would only say what its title already says (owner, 2026-11-07)", () => {
    const svg = heatmapSVG(grid());
    expect(svg).not.toContain('role="button"');
    expect(svg).not.toContain("tabindex");
  });

  test("the grid is a group with a summary label, not an image", () => {
    const svg = heatmapSVG(grid());
    expect(svg).toContain('role="group"');
    expect(svg).not.toContain('role="img"');
    expect(svg).toContain('aria-label="9 月 27 日到10 月 17 日，有 3 天聽寫，共 175 字"');
  });

  test("future days have no title", () => {
    const svg = heatmapSVG(grid());
    expect(svg).toContain('class="future"');
    for (const tag of svg.match(/<rect class="future"[^>]*>(<title>)?/g) ?? []) expect(tag).not.toContain("<title>");
  });
});
