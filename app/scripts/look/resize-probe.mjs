import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeTrace } from "./drag-probe.mjs";

/**
 * A pane's edge dragged as the owner's hand does (R-PERF-09): a real pointer takes the edge, goes `dx` across in `moves`
 * steps a frame apart and back, and what the owner feels is measured, not guessed:
 *
 *  - the frame the page draws between two moves (`frameGapMax`, `framesOver25`: a frame later than 25 ms is a dropped one at 60 Hz);
 *  - what the main thread did for it, per frame (`layoutsPerFrame`, `styleRecalcsPerFrame`, `layoutMs`, `styleMs`, `scriptMs`) and,
 *    from the trace, how many objects the layouts touched (`layoutObjects`);
 *  - how many style writes the app made (`widthWrites`) and how many ResizeObserver callbacks ran (`observerRuns`);
 *  - in a second, sampled pass, where the text stood: every watched element's first line is read each frame, and `shake` counts
 *    the frames in which a text moved against the edge it belongs to (`ref`: the left edge of its column; none: it stands still)
 *    or by a part of a pixel (`fractional`: a step that is not a whole pixel), and `rewraps` the changes of a paragraph's number of lines.
 *
 * `toggle` instead of an edge opens and closes a pane (the list: "sidebar", the panel: a selector to press) and measures the same.
 * `limits` fails the step. Throws an error that carries `assertion`.
 */
export async function resizeProbe(page, { edge, dx, moves = 60, toggle, watch = [], limits = {}, ...rest }, directory) {
  // `LOOK_RESIZE_THROTTLE=4` slows the page's CPU four times, as a PC with a quarter of this one's speed.
  const throttle = Number(process.env.LOOK_RESIZE_THROTTLE) || rest.throttle || 1;
  await page.waitForFunction(() => {
    const now = performance.now(), calls = window.__look.calls.filter(call => call.command === "core_call");
    return calls.every(call => call.t1 !== undefined) && now - Math.max(0, ...calls.map(call => call.t1)) > 800;
  }, { timeout: 15000, polling: 100 });
  const client = await page.createCDPSession();
  await client.send("Performance.enable");
  if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const read = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  const traceFile = `resize-probe-${edge ?? toggle}`.replace(/[^a-z0-9-]+/gi, "_") + ".trace.json";

  /** One pass: the press and the moves out and back (or the toggle twice), the frames and what was drawn. */
  const pass = async sampled => {
    await page.evaluate((sampled, watch) => {
      const seen = window.__resize = { frames: [], loaf: [], longTasks: [], writes: 0, observerRuns: 0, samples: [], marks: [] };
      seen.tasks = new PerformanceObserver(list => { for (const entry of list.getEntries()) seen.longTasks.push(Math.round(entry.duration)); });
      seen.tasks.observe({ entryTypes: ["longtask"] });
      try {
        seen.frameObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) seen.loaf.push({ ms: Math.round(entry.duration) }); });
        seen.frameObserver.observe({ type: "long-animation-frame", buffered: false });
      } catch { seen.noLoaf = true; }
      // Every style the app writes while the press lasts, on the root and on the panes.
      seen.mutations = new MutationObserver(records => { seen.writes += records.length; });
      for (const node of [document.documentElement, document.querySelector("#nav"), document.querySelector(".page-agent"), document.querySelector(".mb-det"), document.querySelector(".wbody")]) {
        if (node) seen.mutations.observe(node, { attributes: true, attributeFilter: ["style", "data-sidebar-collapsed", "data-det", "data-resizing"] });
      }
      // The page's own ResizeObserver callbacks are counted by `window.__resizeRuns` (runner.mjs wraps the class before the app's code runs).
      const nav = document.querySelector("#nav");
      const lines = node => { const range = document.createRange(); range.selectNodeContents(node); return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; };
      const sample = () => {
        const row = { nav: nav.getBoundingClientRect().width, text: [] };
        for (const entry of watch) {
          const node = document.querySelector(entry.selector);
          const first = node?.getClientRects()[0], box = entry.ref ? document.querySelector(entry.ref)?.getBoundingClientRect() : null, ref = box ? (entry.refEdge === "right" ? box.right : box.left) : 0;
          row.text.push(first ? { x: first.left, y: first.top, ref, lines: entry.lines ? lines(node) : 1 } : null);
        }
        seen.samples.push(row);
      };
      seen.runsBefore = window.__resizeRuns ?? 0;
      seen.frameLoop = true;
      let last = performance.now();
      // The text is read where the owner sees it: a ResizeObserver on a 1 px probe that changes size each frame is told after layout, after
      // the app's own observers (made before it, which keep a thread at its bottom) and before paint (follow-probe.mjs).
      let beat = null, flip = false;
      if (sampled) {
        beat = document.createElement("div");
        beat.setAttribute("aria-hidden", "true");
        beat.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0;contain:strict";
        document.body.append(beat);
        seen.observer = new ResizeObserver(() => { if (seen.frameLoop) sample(); });
        seen.observer.observe(beat);
      }
      seen.beat = beat;
      const tick = now => { if (!seen.frameLoop) return; seen.frames.push(now - last); last = now; if (beat) { flip = !flip; beat.style.width = flip ? "2px" : "1px"; } requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, sampled, watch);

    const before = await read();
    if (!sampled) await page.tracing.start({ path: join(directory, traceFile), categories: ["toplevel", "devtools.timeline", "blink.user_timing", "v8.execute", ...(process.env.LOOK_INVALIDATIONS ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : [])] });
    if (toggle) {
      // Open or close as the owner does (a key, a click) and let the pane settle: twice, so it ends where it began.
      for (let round = 0; round < 2; round++) {
        await page.evaluate(toggle => { if (toggle === "sidebar") window.dispatchEvent(new Event("raphael:toggle-sidebar")); else document.querySelector(toggle).click(); }, toggle);
        await new Promise(resolve => setTimeout(resolve, 700));
      }
    } else {
      const handle = await (await page.$(edge)).boundingBox();
      const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
      await page.mouse.move(x, y);
      await page.evaluate(() => window.__resize.marks.push(window.__resize.frames.length));
      await page.mouse.down();
      // A hand: a frame between two moves; out by `dx`, and back to where it began.
      for (let step = 1; step <= moves; step++) { await page.mouse.move(x + dx * step / moves, y); await new Promise(resolve => setTimeout(resolve, 16)); }
      for (let step = moves - 1; step >= 0; step--) { await page.mouse.move(x + dx * step / moves, y); await new Promise(resolve => setTimeout(resolve, 16)); }
      await page.evaluate(() => window.__resize.marks.push(window.__resize.frames.length));
      await page.mouse.up();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const after = await read();
    await page.evaluate(() => { window.__resize.end = window.__resize.frames.length; });
    let events = [];
    if (!sampled) {
      await page.tracing.stop();
      const raw = await readFile(join(directory, traceFile), "utf8"), tracing = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
      events = tracing.traceEvents ?? tracing;
    }
    const seen = await page.evaluate(() => {
      const seen = window.__resize;
      seen.tasks.disconnect(); seen.mutations.disconnect(); seen.frameObserver?.disconnect(); seen.observer?.disconnect(); seen.beat?.remove(); seen.frameLoop = false;
      return { frames: seen.frames, loaf: seen.loaf, longTasks: seen.longTasks, writes: seen.writes, observerRuns: (window.__resizeRuns ?? 0) - seen.runsBefore, samples: seen.samples, marks: seen.marks, end: seen.end };
    });
    return { before, after, events, seen };
  };

  const timed = await pass(false);
  await new Promise(resolve => setTimeout(resolve, 300));
  const sampledPass = watch.length ? await pass(true) : null;
  if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await client.detach();

  const round = (value, digits = 1) => +value.toFixed(digits);
  // The frames of the press and of the settling after it; what the trace's own flush does to the page after that is not the pane's.
  const frames = timed.seen.frames.slice(1, timed.seen.end), count = Math.max(1, frames.length);
  const delta = name => timed.after[name] - timed.before[name];
  const trace = summarizeTrace(timed.events);
  const layoutObjects = timed.events.filter(event => event.name === "Layout" && event.ph === "X").reduce((sum, event) => sum + (event.args?.beginData?.dirtyObjects ?? 0), 0);
  // With LOOK_INVALIDATIONS=1 the trace says why each style recalculation ran, and how many elements it covered.
  const recalcs = timed.events.filter(event => event.name === "UpdateLayoutTree" && event.ph === "X");
  const reasons = {};
  for (const event of timed.events.filter(event => /Invalidat/.test(event.name) && event.args?.data)) {
    const data = event.args.data, key = `${event.name}: ${data.reason ?? ""} ${data.changedProperty ?? data.changedAttribute ?? ""} ${data.nodeName ?? ""}`.trim();
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  const result = {
    check: "resize-probe", recalcElements: recalcs.reduce((sum, event) => sum + (event.args?.elementCount ?? 0), 0), recalcCount: recalcs.length,
    ...(process.env.LOOK_INVALIDATIONS ? { reasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12)) } : {}), edge, toggle, moves, throttle, trace: traceFile,
    frameCount: frames.length, frameGapMax: round(Math.max(0, ...frames)), frameGapMedian: round([...frames].sort((a, b) => a - b)[Math.floor(frames.length / 2)] ?? 0),
    // Where the late frames fall: `press` and `release` are the frames the pointer went down and up at, which are not the drag's own.
    slowFrames: frames.map((gap, at) => [at, round(gap)]).filter(([, gap]) => gap > 25).slice(0, 12), marks: timed.seen.marks,
    framesOver25: frames.filter(gap => gap > 25).length, framesOver50: frames.filter(gap => gap > 50).length,
    longTasks: timed.seen.longTasks.length, longestTaskMs: Math.max(0, ...timed.seen.longTasks), longFrames: timed.seen.loaf.length, longestFrameMs: Math.max(0, ...timed.seen.loaf.map(frame => frame.ms)),
    layoutsPerFrame: round(delta("LayoutCount") / count, 2), styleRecalcsPerFrame: round(delta("RecalcStyleCount") / count, 2),
    layoutMs: round(delta("LayoutDuration") * 1000), styleMs: round(delta("RecalcStyleDuration") * 1000), scriptMs: round(delta("ScriptDuration") * 1000), taskMs: round(delta("TaskDuration") * 1000),
    layoutMsPerFrame: round(delta("LayoutDuration") * 1000 / count, 2), styleMsPerFrame: round(delta("RecalcStyleDuration") * 1000 / count, 2),
    layoutObjectsPerFrame: Math.round(layoutObjects / count), paintMs: trace.paintMs,
    // How many elements each width write restyled: the quantity the mechanism changes, the same on any PC (a width written where every
    // element inherits it restyles the window; one written on the elements that read it, a hundred or so).
    recalcElementsPerWrite: timed.seen.writes ? Math.round(recalcs.reduce((sum, event) => sum + (event.args?.elementCount ?? 0), 0) / timed.seen.writes) : 0,
    widthWrites: timed.seen.writes, widthWritesPerFrame: round(timed.seen.writes / count, 2), observerRuns: timed.seen.observerRuns, nodes: timed.after.Nodes,
  };
  if (sampledPass) {
    const rows = sampledPass.seen.samples;
    let shake = 0, fractional = 0, rewraps = 0;
    const perText = watch.map((entry, at) => {
      let shakes = 0, odd = 0, wraps = 0, missing = 0, prev = null;
      const changes = [];
      for (const row of rows) {
        const now = row.text[at];
        if (!now) { prev = null; missing++; continue; }
        if (prev) {
          // A step of a part of a pixel is what makes text shimmer: its glyphs are drawn at another offset each frame.
          const step = now.x - prev.x;
          if (Math.abs(step - Math.round(step)) > 0.01) odd++;
          // The text moves with the edge it sits against (`ref`: its column's own left edge), and with nothing else.
          if (Math.abs((now.x - now.ref) - (prev.x - prev.ref)) > 0.01 || Math.abs(now.y - prev.y) > 0.01) {
            shakes++;
            if (changes.length < 16) changes.push([rows.indexOf(row), Math.round((now.x - now.ref - prev.x + prev.ref) * 100) / 100, Math.round((now.y - prev.y) * 100) / 100]);
          }
          if (now.lines !== prev.lines) wraps++;
        }
        prev = now;
      }
      shake += shakes; fractional += odd; rewraps += wraps;
      return { selector: entry.selector, shakes, fractionalFrames: odd, rewraps: wraps, missing, ...(process.env.LOOK_SERIES ? { changes } : {}) };
    });
    Object.assign(result, { sampledFrames: rows.length, shake, fractional, rewraps, perText });
  }
  const problems = [];
  for (const [name, limit] of Object.entries(limits)) if (result[name] > limit) problems.push(`${name} ${JSON.stringify(result[name])} > ${limit}`);
  if (problems.length) throw Object.assign(new Error(`Resizing a pane stalls or shakes: ${problems.join("; ")} | ${JSON.stringify({ ...result, perText: undefined })}`), { assertion: result });
  return result;
}
