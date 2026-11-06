// Raphael's glyph ring drawn as vectors (owner, 2026-11-07: brighter, more vivid and crisp, never blurry, and red when he is
// angry). The letters are this app's own runes, made of a few strokes each, not the anime's lettering: tall, narrow and
// upright to the ring's outside, each a gold edge around an orange core, as the owner's reference shows.
//
// The ring is drawn once per palette onto a square canvas laid out as the old picture was (`TEX_HALF` of emblem.ts: the
// canvas's half side is 104/97 of the emblem's outer radius), so the renderer scales and turns it the same way.
//
// This module must stay importable without a browser: nothing touches `document` until `glyphRingCanvas` is called.

/** One letter's strokes in its own box: `u` across (-0.5 to 0.5), `v` down from its top (0, outside) to its foot (1). */
export type Stroke =
  | { kind: "path"; d: readonly (readonly [string, ...number[]])[] }
  | { kind: "ring"; u: number; v: number; r: number }
  | { kind: "dot"; u: number; v: number; r: number };

export interface Glyph { strokes: readonly Stroke[]; angle: number }

export interface GlyphPalette {
  /** The letter's outer stroke. */
  edge: string;
  /** The thin line down its middle. */
  core: string;
  /** The soft dark rim that keeps it readable on any desktop. */
  rim: string;
}

/** Gold on the dark or unknown desktop behind the overlay; a deeper ink on the white theme; red when he is angry. */
export const PALETTES = {
  gold: { edge: "#ffd23f", core: "#f06a12", rim: "rgba(40, 14, 0, 0.55)" },
  goldInk: { edge: "#dc9a12", core: "#b9480b", rim: "rgba(120, 70, 0, 0.18)" },
  angry: { edge: "#ff5b45", core: "#a50e1e", rim: "rgba(30, 0, 0, 0.6)" },
  angryInk: { edge: "#dc3a2a", core: "#8e0c18", rim: "rgba(110, 0, 0, 0.18)" },
} as const satisfies Record<string, GlyphPalette>;

export type PaletteName = keyof typeof PALETTES;

/** Where the letters stand, in units of the emblem's outer radius: the band between the white ring and the edge. */
export const BAND = { inner: 0.785, outer: 1.0 } as const;
/** A letter's width, and the room between two, in units of the outer radius. */
const LETTER = 0.08, GAP = 0.014;
/** The strokes, in units of the outer radius: the dark rim, the gold edge and the orange core, bold as the reference's. */
export const STROKE = { rim: 0.046, edge: 0.032, core: 0.014 } as const;

/** A small seeded random generator (the same as emblem.ts uses), so the ring is the same every time. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shapes the runes are made of: each is a few strokes in the letter's box. */
const SHAPES: readonly (readonly Stroke[])[] = [
  // a stem with a hook at its top
  [{ kind: "path", d: [["M", 0, 0.9], ["L", 0, 0.12], ["L", 0.24, 0.12], ["L", 0.24, 0.32]] }],
  // a cup
  [{ kind: "path", d: [["M", -0.25, 0.14], ["L", -0.25, 0.64], ["Q", -0.25, 0.9, 0, 0.9], ["Q", 0.25, 0.9, 0.25, 0.64], ["L", 0.25, 0.14]] }],
  // an arch on two legs
  [{ kind: "path", d: [["M", -0.25, 0.9], ["L", -0.25, 0.38], ["Q", -0.25, 0.1, 0, 0.1], ["Q", 0.25, 0.1, 0.25, 0.38], ["L", 0.25, 0.9]] }],
  // a long S
  [{ kind: "path", d: [["M", 0.24, 0.2], ["Q", 0.02, 0.04, -0.2, 0.22], ["Q", -0.3, 0.44, 0, 0.5], ["Q", 0.3, 0.56, 0.2, 0.78], ["Q", 0, 0.96, -0.24, 0.8]] }],
  // a loop on a stem
  [{ kind: "ring", u: 0.02, v: 0.3, r: 0.19 }, { kind: "path", d: [["M", -0.17, 0.3], ["L", -0.17, 0.9]] }],
  // two stems and a bar
  [{ kind: "path", d: [["M", -0.24, 0.1], ["L", -0.24, 0.9]] }, { kind: "path", d: [["M", 0.24, 0.1], ["L", 0.24, 0.9]] }, { kind: "path", d: [["M", -0.24, 0.5], ["L", 0.24, 0.5]] }],
  // a stem with three short bars
  [{ kind: "path", d: [["M", -0.2, 0.1], ["L", -0.2, 0.9]] }, { kind: "path", d: [["M", -0.2, 0.14], ["L", 0.24, 0.14]] }, { kind: "path", d: [["M", -0.2, 0.5], ["L", 0.16, 0.5]] }, { kind: "path", d: [["M", -0.2, 0.86], ["L", 0.24, 0.86]] }],
  // a zig
  [{ kind: "path", d: [["M", -0.25, 0.14], ["L", 0.25, 0.14], ["L", -0.25, 0.86], ["L", 0.25, 0.86]] }],
  // a stem with a loop at its foot
  [{ kind: "path", d: [["M", -0.2, 0.1], ["L", -0.2, 0.88]] }, { kind: "ring", u: 0.03, v: 0.68, r: 0.2 }],
  // two loops, one above the other
  [{ kind: "ring", u: 0, v: 0.29, r: 0.17 }, { kind: "ring", u: 0, v: 0.71, r: 0.19 }],
  // a hooked stem, as a seven
  [{ kind: "path", d: [["M", -0.25, 0.14], ["L", 0.24, 0.14], ["Q", 0.08, 0.5, 0.02, 0.9]] }],
];

/** The letter mirrored across, so the same shapes read as more letters. */
const mirror = (strokes: readonly Stroke[]): Stroke[] => strokes.map((s): Stroke => s.kind === "path"
  ? { kind: "path", d: s.d.map(([op, ...n]) => [op, ...n.map((value, i) => (i % 2 === 0 ? -value : value))] as [string, ...number[]]) }
  : { ...s, u: -s.u });

/**
 * The letters of the ring, clockwise from the top: as many as fit the band's middle, with two word breaks, each a shape,
 * sometimes mirrored, sometimes with a dot over it. The same `seed` makes the same ring.
 */
export function glyphLayout(seed = 1237): Glyph[] {
  const rnd = seeded(seed);
  const middle = (BAND.inner + BAND.outer) / 2;
  const slots = Math.floor((2 * Math.PI * middle) / (LETTER + GAP));
  const breaks = new Set([Math.round(slots * 0.27), Math.round(slots * 0.71)]);
  const glyphs: Glyph[] = [];
  for (let i = 0; i < slots; i++) {
    if (breaks.has(i)) continue;
    let strokes: Stroke[] = [...SHAPES[Math.floor(rnd() * SHAPES.length)]!];
    if (rnd() < 0.45) strokes = mirror(strokes);
    if (rnd() < 0.1) strokes.push({ kind: "dot", u: 0, v: rnd() < 0.5 ? -0.02 : 1.02, r: 0.08 });
    glyphs.push({ strokes, angle: (i / slots) * 2 * Math.PI });
  }
  return glyphs;
}

/** The part of the 2D context the ring needs, so a test can record the drawing. */
export type RingContext = Pick<CanvasRenderingContext2D,
  "save" | "restore" | "translate" | "rotate" | "beginPath" | "moveTo" | "lineTo" | "quadraticCurveTo" | "arc" | "stroke" | "fill"> & {
  strokeStyle: string | CanvasGradient | CanvasPattern; fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin;
};

/** Half the canvas's side in units of the outer radius, as emblem.ts draws the ring picture. */
export const TEX_HALF = 104 / 97;

function trace(ctx: RingContext, stroke: Stroke, box: (u: number, v: number) => [number, number], width: number): void {
  ctx.beginPath();
  if (stroke.kind === "path") {
    for (const [op, ...n] of stroke.d) {
      if (op === "M") ctx.moveTo(...box(n[0]!, n[1]!));
      else if (op === "L") ctx.lineTo(...box(n[0]!, n[1]!));
      else if (op === "Q") ctx.quadraticCurveTo(...box(n[0]!, n[1]!), ...box(n[2]!, n[3]!));
    }
  } else {
    const [x, y] = box(stroke.u, stroke.v);
    ctx.arc(x, y, stroke.r * width, 0, 2 * Math.PI);
  }
}

/** Draws the ring on `ctx`, `size` px square, in `palette`: every letter's rim first, then the edges, then the cores. */
export function drawGlyphRing(ctx: RingContext, size: number, palette: GlyphPalette, glyphs: readonly Glyph[] = glyphLayout()): void {
  const R = size / 2 / TEX_HALF;
  const width = LETTER * R, height = (BAND.outer - BAND.inner) * R;
  const box = (u: number, v: number): [number, number] => [u * width, -BAND.outer * R + v * height];
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [style, line] of [[palette.rim, STROKE.rim], [palette.edge, STROKE.edge], [palette.core, STROKE.core]] as const) {
    for (const glyph of glyphs) {
      ctx.save();
      ctx.rotate(glyph.angle);
      for (const stroke of glyph.strokes) {
        trace(ctx, stroke, box, width);
        if (stroke.kind === "dot") { ctx.fillStyle = style; ctx.fill(); }
        else { ctx.strokeStyle = style; ctx.lineWidth = line * R; ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

const canvases = new Map<string, HTMLCanvasElement>();

/**
 * The ring in `palette` on a canvas `size` px square, drawn once and kept. Null where there is no document (the tests in
 * Node), or no 2D context.
 */
export function glyphRingCanvas(palette: PaletteName, size = 1024): HTMLCanvasElement | null {
  const key = `${palette}:${size}`;
  const kept = canvases.get(key);
  if (kept) return kept;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawGlyphRing(ctx, size, PALETTES[palette]);
  canvases.set(key, canvas);
  return canvas;
}
