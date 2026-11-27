// R-PAGE-10, R-PAGE-11: a page's own background is the only one. Nothing of the window's own colour may stand above, below or beside a page's
// content, and the page runs from the window's top edge to its foot with the header's buttons and the composer floating over it. The page is
// another origin, so what the screen shows of it can only be read from the screen: this reads the pixels of a real capture at the places a band
// once stood (the header's row between its buttons, the room above a page's first line, the room under its last, and the window's foot beside the
// composer) and compares them with the colour the page paints itself.
// The measure of the page (where its body and content stand, how far it is read, what it paints) is read inside its frame (checks.mjs
// `checkFrame("page-band-measure")`); the places and the verdict are plain functions, tested in page-band.test.mjs.

const TOLERANCE = 3;

/** The relative luminance of an [r, g, b] colour (WCAG), and the contrast ratio of two. */
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const lin = value => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
export const contrast = (a, b) => { const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y); return (high + 0.05) / (low + 0.05); };
/** The tone the helper says a ground is (core agent/pages.py `shade`): light above a luminance of 0.179, where dark ink and light ink read the same. */
export const toneOf = colour => (luminance(colour) > 0.179 ? "light" : "dark");

/** The three numbers of an `rgb()` or `rgba()` colour, or null. */
export function rgb(text) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(text));
  return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Where to look, in window pixels. `frame` is the page's frame in the window, `measure` what the page says of itself (frame coordinates), `composerTop`
 * the top of what floats over the page's foot, `headGap` the x of a place in the header's row between its buttons (none when there is no room),
 * `caption` a place in a corner of the window's first button's cell, away from its glyph. `where` is "top" (the page read from its top) or "end"
 * (read to its end).
 */
export function bandPlan({ where, frame, measure, composerTop, windowHeight, headGap, caption, side }) {
  const problems = [], points = [];
  // At the body's left edge, or (`side` "right") at the window's right, for a page whose left is a column of its own colour (a rail).
  const x = side === "right" ? frame.right - 24 : Math.min(frame.right - 24, Math.max(frame.left + 2, frame.left + measure.bodyLeft + 8));
  if (where === "top") {
    if (measure.scrollY !== 0) problems.push(`the page is read from its top, not ${measure.scrollY} px down`);
    // The room between the header's buttons and the page's first line is the page's own (its body's padding below the head room it was told).
    else if (measure.firstTop - measure.head >= 8) points.push({ name: "above the content", x, y: frame.top + measure.head + (measure.firstTop - measure.head) / 2 });
  } else {
    if (measure.scrollY < measure.scrollMax - 1) problems.push(`the page is read to its end, not ${measure.scrollY} of ${measure.scrollMax} px`);
    const last = frame.top + measure.lastBottom, room = composerTop - last;
    // The page's own last line stands clear above what floats over its foot: the room the window tells it (R-PAGE-11) is under it.
    if (room < 4) problems.push(`the page's last line stands under the composer: it ends at ${Math.round(last)}, the composer begins at ${Math.round(composerTop)}`);
    else points.push({ name: "below the content", x, y: last + Math.min(room - 2, 24) / 2 + 1 });
  }
  // The header's row between its buttons: the frame starts at the window's top edge, so the page's colour is there, never the app's own. Read to
  // its end the page's content has scrolled under the header, which is transparent, and fades out under it in the page's own colour (R-PAGE-17):
  // what shows between the buttons is the page's colour still, never its words.
  if (Number.isFinite(headGap)) points.push({ name: "the header's row", x: headGap, y: frame.top + 6 });
  // The window's own buttons stand on the page with no plate, in ink that reads on it: its pixel is read for the contrast of the ink (not compared with the ground).
  if (caption) points.push({ name: "the window's buttons", x: caption.x, y: caption.y, caption: true });
  // The window's foot, beside the composer and under the page: the page's colour runs down to the window's last pixel.
  points.push({ name: "the window's foot", x: frame.left + 4, y: windowHeight - 4 });
  return { points, problems };
}

/** What is wrong with the pixels read at the plan's places, against the colour the page paints (its own, or, with none, the area's own behind it: `ground`). */
export function bandProblems(plan, measure, pixels, ground, window = {}) {
  const expected = rgb(measure.canvas) ?? ground;
  const problems = [...plan.problems];
  for (const [index, point] of plan.points.entries()) {
    const seen = pixels[index];
    if (!expected || !seen) { problems.push(`${point.name}: nothing was read`); continue; }
    if (point.caption) {
      // The window's buttons: drawn in the ink that reads on what stands behind them (3 to 1, as an icon asks), whatever the app's theme is.
      const ratio = window.ink ? contrast(window.ink, seen) : 0;
      if (!window.ink || ratio < 3) problems.push(`${point.name}: ink rgb(${(window.ink ?? []).join(", ")}) on rgb(${seen.join(", ")}) reads ${Math.round(ratio * 10) / 10} to 1, under 3`);
      continue;
    }
    if (expected.some((value, channel) => Math.abs(value - seen[channel]) > TOLERANCE)) {
      problems.push(`${point.name} shows rgb(${seen.join(", ")}) where the page paints rgb(${expected.join(", ")}): a band of the window's own colour`);
    }
  }
  // R-PAGE-17: what scrolls under the header's buttons and the composer fades out in the page's own colour, and the window's buttons take the tone of its ground.
  const fades = (measure.fades ?? []).filter(fade => fade.visible);
  if (measure.image) {
    if (fades.length) problems.push("a page whose ground is a gradient or a picture has no one colour to fade into, yet it has a fade");
    if (window.tone !== "mixed") problems.push(`the tone of a page with no one ground is mixed, not ${window.tone}`);
  } else if (expected) {
    if (fades.length !== 2) problems.push(`what scrolls under the header and the composer fades out: ${fades.length} fades, not 2`);
    for (const fade of fades) {
      if (!fade.fixed || fade.pointer !== "none") problems.push(`the ${fade.at} fade is fixed and takes no pointer`);
      if (!fade.colour || fade.colour.some((value, channel) => value !== expected[channel])) problems.push(`the ${fade.at} fade is rgb(${(fade.colour ?? []).join(", ")}), not the page's own rgb(${expected.join(", ")})`);
      if (!fade.clear) problems.push(`the ${fade.at} fade does not end clear`);
    }
    if (window.tone !== toneOf(expected)) problems.push(`the page's tone is ${toneOf(expected)} (rgb(${expected.join(", ")})), the window was told ${window.tone}`);
  }
  return problems;
}

/**
 * Nothing a person can press may stand under what floats over the page (R-PAGE-16): the composer and the answer line over its foot, the
 * header's buttons and the window's own over its head. The zones are measured in the app, in the frame's own coordinates, and the page itself is
 * asked what it has under them (checks.mjs `checkFrame("page-covered")`). `where` is "top" or "end" (what the page's normal flow has there: at its
 * top nothing may stand under the header's buttons, at its end nothing under the composer) or "stuck" (only what is fixed or sticky, which never
 * scrolls clear: a rail one window tall with its buttons at its foot, a bar at an edge).
 */
export async function pageCovered(page, frame, where, checkFrame) {
  const zones = await page.evaluate(() => {
    const box = document.querySelector(".pgv-frame-box iframe")?.getBoundingClientRect();
    if (!box) return null;
    const named = (name, element) => { const rect = element?.getBoundingClientRect(); return rect && rect.width > 0 && rect.height > 0 ? { name, side: name === "the composer" || name === "the answer line" ? "foot" : "head", left: rect.left - box.left, top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top } : null; };
    return [named("the composer", document.querySelector(".ra-stage.is-page > .ra-dock .composer")), named("the answer line", document.querySelector(".pgv-status:not([hidden]) > *")),
      named("the arrow", document.querySelector(".mb-head [data-page-back]")), named("the page's pill", document.querySelector(".mb-head .pgv-pill")),
      ...[...document.querySelectorAll(".mb-head .ra-tools > *")].map(tool => named("a header tool", tool)), named("the window's buttons", document.querySelector(".window-chrome .window-controls"))].filter(Boolean);
  });
  if (!zones) throw new Error("page-covered: no page stands open in the conversation's place");
  return frame.evaluate(checkFrame, "page-covered", { zones, where });
}

/** Reads a real capture of the window at the plan's places. `page` is the app's page, `frame` the page's own frame. */
export async function pageBand(page, frame, where, checkFrame, side) {
  const measure = await frame.evaluate(checkFrame, "page-band-measure");
  const place = await page.evaluate(() => {
    const box = document.querySelector(".pgv-frame-box iframe")?.getBoundingClientRect(), composer = document.querySelector(".ra-stage.is-page > .ra-dock .composer")?.getBoundingClientRect();
    const line = document.querySelector(".pgv-status:not([hidden]) > *")?.getBoundingClientRect();
    const back = document.querySelector(".mb-head [data-page-back]")?.getBoundingClientRect(), pill = document.querySelector(".mb-head .pgv-pill")?.getBoundingClientRect();
    const headGap = back && pill && pill.left - back.right >= 12 ? (back.right + pill.left) / 2 : undefined;
    const button = document.querySelector(".window-chrome .window-button")?.getBoundingClientRect(), ink = document.querySelector(".window-chrome .window-button");
    const caption = button && button.width > 0 ? { x: button.left + 3, y: button.top + 3 } : undefined;
    return box && composer && { frame: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, composerTop: Math.min(composer.top, line?.top ?? Infinity), windowHeight: innerHeight, ratio: devicePixelRatio, headGap, caption, tone: document.documentElement.dataset.pageTone ?? "", ink: ink ? getComputedStyle(ink).color : null, ground: getComputedStyle(document.querySelector(".pgv-page")).backgroundColor };
  });
  if (!place) throw new Error("page-band: no page stands open in the conversation's place");
  const plan = bandPlan({ where, frame: place.frame, measure, composerTop: place.composerTop, windowHeight: place.windowHeight, headGap: place.headGap, caption: place.caption, side });
  const shot = await page.screenshot({ encoding: "base64", type: "png" });
  const read = await page.evaluate(async (data, points, ratio) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0);
    return points.map(point => Array.from(context.getImageData(Math.min(image.width - 1, Math.round(point.x * ratio)), Math.min(image.height - 1, Math.round(point.y * ratio)), 1, 1).data).slice(0, 3));
  }, shot, plan.points, place.ratio);
  const problems = bandProblems(plan, measure, read, rgb(place.ground), { tone: place.tone, ink: rgb(place.ink) });
  const result = { check: "page-band", where, canvas: measure.canvas, tone: place.tone, ink: place.ink, fades: (measure.fades ?? []).length, foot: measure.foot, head: measure.head, points: plan.points.map((point, index) => ({ at: point.name, x: Math.round(point.x), y: Math.round(point.y), seen: read[index] })) };
  if (problems.length) throw Object.assign(new Error(`page-band ${where}: ${problems.join("; ")}`), { assertion: { ...result, problems } });
  return result;
}
