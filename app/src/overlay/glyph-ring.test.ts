import { expect, test } from "vitest";
import { BAND, PALETTES, STROKE, TEX_HALF, drawGlyphRing, glyphLayout, type RingContext } from "./glyph-ring";
import { isRefusal } from "./overlay";

/** A context that writes down what is drawn: the styles of each stroke and fill, and every point the pen goes to. */
function recorder() {
  const calls: { op: string; style?: string; width?: number }[] = [];
  const points: [number, number][] = [];
  let x = 0, y = 0, angle = 0;
  const stack: [number, number, number][] = [];
  const at = (px: number, py: number): void => {
    const c = Math.cos(angle), s = Math.sin(angle);
    points.push([x + px * c - py * s, y + px * s + py * c]);
  };
  const ctx = {
    strokeStyle: "", fillStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    save: () => stack.push([x, y, angle]), restore: () => { [x, y, angle] = stack.pop()!; },
    translate: (dx: number, dy: number) => { x += dx; y += dy; }, rotate: (a: number) => { angle += a; },
    beginPath: () => {}, moveTo: at, lineTo: at, quadraticCurveTo: (_cx: number, _cy: number, px: number, py: number) => at(px, py),
    arc: (px: number, py: number) => at(px, py),
    stroke: () => calls.push({ op: "stroke", style: String(ctx.strokeStyle), width: ctx.lineWidth }),
    fill: () => calls.push({ op: "fill", style: String(ctx.fillStyle) }),
  };
  return { ctx: ctx as unknown as RingContext, calls, points };
}

test("the runes are the same every time, fill the ring with two word breaks, and differ from one another", () => {
  const a = glyphLayout(), b = glyphLayout();
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(a.length).toBeGreaterThan(55);
  const steps = a.slice(1).map((g, i) => g.angle - a[i]!.angle);
  expect(steps.filter(step => step > Math.min(...steps) * 1.5)).toHaveLength(2);
  expect(new Set(a.map(g => JSON.stringify(g.strokes))).size).toBeGreaterThan(12);
  expect(JSON.stringify(glyphLayout(7))).not.toBe(JSON.stringify(a));
});

test("each letter is a dark rim, then a gold edge, then an orange core, all inside the band around the white ring", () => {
  const { ctx, calls, points } = recorder();
  const size = 1024, R = size / 2 / TEX_HALF;
  drawGlyphRing(ctx, size, PALETTES.gold);
  const strokes = calls.filter(call => call.op === "stroke");
  const order = [...new Set(strokes.map(call => call.style))];
  expect(order).toEqual([PALETTES.gold.rim, PALETTES.gold.edge, PALETTES.gold.core]);
  expect(strokes.find(call => call.style === PALETTES.gold.edge)!.width).toBeCloseTo(STROKE.edge * R);
  // Every point lies in the band (a dot may sit just past its ends), never over the white ring at 0.6.
  for (const [px, py] of points) {
    const r = Math.hypot(px - size / 2, py - size / 2) / R;
    expect(r).toBeGreaterThan(BAND.inner - 0.03);
    expect(r).toBeLessThan(BAND.outer + 0.03);
  }
});

test("his anger is red, and each palette has a deeper ink for the white theme", () => {
  expect(PALETTES.angry.edge).not.toBe(PALETTES.gold.edge);
  const red = (hex: string): number => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(3, 5), 16);
  expect(red(PALETTES.angry.edge)).toBeGreaterThan(100);
  expect(red(PALETTES.gold.edge)).toBeLessThan(60);
  expect(PALETTES.goldInk.edge).not.toBe(PALETTES.gold.edge);
  expect(PALETTES.angryInk.edge).not.toBe(PALETTES.angry.edge);
});

test("a refusal is a 否 or Negative line, in any interface language; a report is not", () => {
  expect(isRefusal("《否。未偵測到麥克風。》")).toBe(true);
  expect(isRefusal("《Negative. No microphone was found.》")).toBe(true);
  expect(isRefusal("否。目前無法回答。")).toBe(true);
  expect(isRefusal("《告。一切正常。》")).toBe(false);
  expect(isRefusal("《Notice. All is well.》")).toBe(false);
  expect(isRefusal("我否認這件事")).toBe(false);
});
