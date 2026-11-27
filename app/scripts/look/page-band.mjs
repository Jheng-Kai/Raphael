// R-PAGE-10, R-PAGE-11: a page's own background is the only one. Nothing of the window's own colour may stand above, below or beside a page's
// content, and the page runs down to the window's foot with the composer floating over it. The page is another origin, so what the screen shows
// of it can only be read from the screen: this reads the pixels of a real capture at the places a band once stood (the room above a page's first
// line, the room under its last, and the window's foot beside the composer) and compares them with the colour the page paints itself.
// The measure of the page (where its body and content stand, how far it is read, what it paints) is read inside its frame (checks.mjs
// `checkFrame("page-band-measure")`); the places and the verdict are plain functions, tested in page-band.test.mjs.

const TOLERANCE = 3;

/** The three numbers of an `rgb()` or `rgba()` colour, or null. */
export function rgb(text) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(text));
  return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Where to look, in window pixels. `frame` is the page's frame in the window, `measure` what the page says of itself (frame coordinates), `composerTop`
 * the top of what floats over the page's foot. `where` is "top" (the page read from its top) or "end" (read to its end).
 */
export function bandPlan({ where, frame, measure, composerTop, windowHeight }) {
  const problems = [], points = [];
  const x = Math.min(frame.right - 24, Math.max(frame.left + 2, frame.left + measure.bodyLeft + 8));
  if (where === "top") {
    if (measure.scrollY !== 0) problems.push(`the page is read from its top, not ${measure.scrollY} px down`);
    // The room between the window's top and the page's first line is the page's own (its body's padding): the frame starts under the header's band.
    else if (measure.firstTop >= 8) points.push({ name: "above the content", x, y: frame.top + measure.firstTop / 2 });
  } else {
    if (measure.scrollY < measure.scrollMax - 1) problems.push(`the page is read to its end, not ${measure.scrollY} of ${measure.scrollMax} px`);
    const last = frame.top + measure.lastBottom, room = composerTop - last;
    // The page's own last line stands clear above what floats over its foot: the room the window tells it (R-PAGE-11) is under it.
    if (room < 4) problems.push(`the page's last line stands under the composer: it ends at ${Math.round(last)}, the composer begins at ${Math.round(composerTop)}`);
    else points.push({ name: "below the content", x, y: last + Math.min(room - 2, 24) / 2 + 1 });
  }
  // The window's foot, beside the composer and under the page: the page's colour runs down to the window's last pixel.
  points.push({ name: "the window's foot", x: frame.left + 4, y: windowHeight - 4 });
  return { points, problems, reference: { name: "the page's corner", x: frame.left + 2, y: frame.top + 2 } };
}

/** What is wrong with the pixels read at the plan's places, against the colour the page paints (its own, or, with none, the page's corner). */
export function bandProblems(plan, measure, pixels, reference) {
  const expected = rgb(measure.canvas) ?? reference;
  const problems = [...plan.problems];
  for (const [index, point] of plan.points.entries()) {
    const seen = pixels[index];
    if (!expected || !seen) { problems.push(`${point.name}: nothing was read`); continue; }
    if (expected.some((value, channel) => Math.abs(value - seen[channel]) > TOLERANCE)) {
      problems.push(`${point.name} shows rgb(${seen.join(", ")}) where the page paints rgb(${expected.join(", ")}): a band of the window's own colour`);
    }
  }
  return problems;
}

/** Reads a real capture of the window at the plan's places. `page` is the app's page, `frame` the page's own frame. */
export async function pageBand(page, frame, where, checkFrame) {
  const measure = await frame.evaluate(checkFrame, "page-band-measure");
  const place = await page.evaluate(() => {
    const box = document.querySelector(".pgv-frame-box iframe")?.getBoundingClientRect(), composer = document.querySelector(".ra-stage.is-page > .ra-dock .composer")?.getBoundingClientRect();
    const line = document.querySelector(".pgv-status:not([hidden]) > *")?.getBoundingClientRect();
    return box && composer && { frame: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, composerTop: Math.min(composer.top, line?.top ?? Infinity), windowHeight: innerHeight, ratio: devicePixelRatio };
  });
  if (!place) throw new Error("page-band: no page stands open in the conversation's place");
  const plan = bandPlan({ where, frame: place.frame, measure, composerTop: place.composerTop, windowHeight: place.windowHeight });
  const shot = await page.screenshot({ encoding: "base64", type: "png" });
  const read = await page.evaluate(async (data, points, ratio) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0);
    return points.map(point => Array.from(context.getImageData(Math.min(image.width - 1, Math.round(point.x * ratio)), Math.min(image.height - 1, Math.round(point.y * ratio)), 1, 1).data).slice(0, 3));
  }, shot, [...plan.points, plan.reference], place.ratio);
  const reference = read.pop();
  const problems = bandProblems(plan, measure, read, reference);
  const result = { check: "page-band", where, canvas: measure.canvas, foot: measure.foot, points: plan.points.map((point, index) => ({ at: point.name, x: Math.round(point.x), y: Math.round(point.y), seen: read[index] })) };
  if (problems.length) throw Object.assign(new Error(`page-band ${where}: ${problems.join("; ")}`), { assertion: { ...result, problems } });
  return result;
}
