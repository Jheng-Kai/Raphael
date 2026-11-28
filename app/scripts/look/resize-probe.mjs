import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeTrace } from "./drag-probe.mjs";

/**
 * A pane's edge dragged as the owner's hand does (R-PERF-25): a real pointer takes the edge, goes `dx` across in `moves`
 * steps a frame apart and back, and what the owner feels is measured, not guessed:
 *
 *  - the frame the page draws between two moves (`frameGapMax`, `framesOver25`: a frame later than 25 ms is a dropped one at 60 Hz);
 *  - what the main thread did for it, per frame (`layoutsPerFrame`, `styleRecalcsPerFrame`, `layoutMs`, `styleMs`, `scriptMs`) and,
 *    from the trace, how many objects the layouts touched (`layoutObjects`);
 *  - how many style writes the app made (`widthWrites`) and how many ResizeObserver callbacks ran (`observerRuns`);
 *  - in a second, sampled pass, where the text stood: every watched element's first line is read each frame, and `shake` counts
 *    the frames in which a text moved against the edge it belongs to (`ref`: the left edge of its column; none: it stands still)
 *    or by a part of a pixel (`fractional`: a step that is not a whole pixel), and `rewraps` the changes of a paragraph's number of lines;
 *  - with `anchor`, what matters when the lines rewrap while the edge is held (R-PERF-27): the conversation takes the width it has,
 *    so no text element's box may reach past the visible conversation area (`overflowMax`, in px, and `hscrollMax`: what the thread
 *    scrolls sideways), the line the owner reads (the last visible line of a thread at its bottom, otherwise the first one fully in
 *    view) keeps its place on the screen (`anchorDrift`, in px, over the frames of the press), and no word jumps up and down again in
 *    the next frame (`flicker`);
 *  - the work of each frame up to its layout (`workMsMax`, `workMsP95`: the time from the frame's start to a ResizeObserver told
 *    after layout, so the style and layout of a frame and the scripts before them) and `framesOver20`, the frames later than 20 ms;
 *  - `shots` frames of the press itself (`resize-<edge>-mid-<n>.png`), taken while the hand holds the edge.
 *
 * `toggle` instead of an edge opens and closes a pane (the list: "sidebar", the panel: a selector to press) and measures the same.
 * `limits` fails the step. Throws an error that carries `assertion`.
 *
 * A drag that misses only a timing limit is measured once more on the same page (the edge went out and back, a toggle closed
 * again): a PC busy with other work misses a frame budget now and then (1920-wide drags at 16-18 ms under a loaded verify, 5-14 ms
 * alone), while a real regression misses it twice. What the owner sees (rewraps, drift, overflow, flicker) is never measured again.
 */
export async function resizeProbe(page, options, directory) {
  const limits = options.limits ?? {};
  let result = await measureResize(page, options, directory), missed = overLimits(result, limits);
  if (onlyTiming(missed)) {
    const first = Object.fromEntries(missed.map(name => [name, result[name]]));
    result = { ...(await measureResize(page, options, directory)), firstTry: first };
    missed = overLimits(result, limits);
  }
  if (missed.length) {
    const problems = missed.map(name => `${name} ${JSON.stringify(result[name])} > ${limits[name]}`);
    throw Object.assign(new Error(`Resizing a pane stalls or shakes: ${problems.join("; ")} | ${JSON.stringify({ ...result, perText: undefined })}`), { assertion: result });
  }
  return result;
}

/** The limits a frame's timing sets, which depend on what else the PC is doing; every other limit is what the screen shows. */
export const TIMING_LIMITS = new Set(["workMsMax", "workMsP95", "framesOver20", "framesOver25", "framesOver50"]);

/** The names of the limits `result` is over. */
export const overLimits = (result, limits) => Object.entries(limits).filter(([name, limit]) => result[name] > limit).map(([name]) => name);

/** Whether the limits missed are all timing ones, the only kind measured a second time. */
export const onlyTiming = missed => missed.length > 0 && missed.every(name => TIMING_LIMITS.has(name));

async function measureResize(page, { edge, dx, moves = 60, toggle, watch = [], everyWord = false, anchor = false, shots = 0, step = 24, ...rest }, directory) {
  // `LOOK_RESIZE_THROTTLE=4` slows the page's CPU four times, as a PC with a quarter of this one's speed.
  const throttle = Number(process.env.LOOK_RESIZE_THROTTLE) || rest.throttle || 1;
  await page.waitForFunction(() => {
    const now = performance.now(), calls = window.__look.calls.filter(call => call.command === "core_call");
    return calls.every(call => call.t1 !== undefined) && now - Math.max(0, ...calls.map(call => call.t1)) > 800;
  }, { timeout: 15000, polling: 100 });
  // The page has drawn what it opens with: thirty frames in a row on time (a window that is still building itself is not the drag's to answer for).
  await page.waitForFunction(() => new Promise(resolve => {
    let last = performance.now(), good = 0;
    const tick = now => { good = now - last < 25 ? good + 1 : 0; last = now; if (good >= 30) resolve(true); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { timeout: 20000 });
  const client = await page.createCDPSession();
  await client.send("Performance.enable");
  if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const read = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  const traceFile = `resize-probe-${edge ?? toggle}`.replace(/[^a-z0-9-]+/gi, "_") + ".trace.json";

  /** One pass: the press and the moves out and back (or the toggle twice), the frames and what was drawn. */
  const pass = async sampled => {
    // Starting the trace stalls the page for a moment: it is started, and left to settle, before the frames are counted.
    if (!sampled) await page.tracing.start({ path: join(directory, traceFile), categories: ["toplevel", "devtools.timeline", "blink.user_timing", "v8.execute", ...(process.env.LOOK_INVALIDATIONS ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : [])] });
    if (!sampled) await new Promise(resolve => setTimeout(resolve, 500));
    // The pointer comes to the edge before the frames are counted: its first crossing of a busy window is a hover of its own, not the drag's.
    let grip = null;
    if (edge) {
      const handle = await (await page.$(edge)).boundingBox();
      grip = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await page.mouse.move(grip.x, grip.y);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    await page.evaluate((sampled, watch, everyWord, anchor) => {
      const seen = window.__resize = { frames: [], work: [], loaf: [], longTasks: [], writes: 0, observerRuns: 0, samples: [], marks: [] };
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
      // `everyWord`: besides the watched texts, every text the window shows is read each frame, by its height alone (a horizontal
      // drag moves words sideways with their column, never up or down unless their own paragraph rewraps).
      const words = everyWord || anchor ? [...document.querySelectorAll("body *")].filter(node => {
        if (!(node instanceof HTMLElement) || node.closest("[hidden], [aria-hidden='true']")) return false;
        if (![...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
      }).slice(0, 400) : [];
      seen.wordNames = words.map(node => `${node.tagName.toLowerCase()}${node.className && typeof node.className === "string" ? "." + node.className.trim().split(/\s+/).join(".") : ""} «${node.textContent.trim().slice(0, 24)}»`);
      // The conversation's own boxes (`anchor`): the area its words may fill (the stage between the panes), the line the owner reads, and
      // every text of the stage, read each frame against that area.
      const scroller = anchor ? document.querySelector(".page-agent:not([hidden]) .ra-scroll") : null, stage = scroller?.closest(".ra-stage") ?? scroller;
      const column = scroller?.querySelector(":scope > .ra-col");
      const area = () => { const box = stage.getBoundingClientRect(); return { left: Math.max(0, box.left), right: Math.min(innerWidth, box.right) }; };
      const stageTexts = scroller ? [...stage.querySelectorAll("*")].filter(node => {
        if (!(node instanceof HTMLElement) || node.closest("[hidden], [aria-hidden='true'], svg")) return false;
        if (![...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
      }).slice(0, 600) : [];
      seen.stageNames = stageTexts.map(node => `${node.tagName.toLowerCase()}${typeof node.className === "string" && node.className ? "." + node.className.trim().split(/\s+/).join(".") : ""} «${node.textContent.trim().slice(0, 24)}»`);
      // The line read: the last whole line in view of a thread at its bottom, else the first one. It is found by its text position,
      // so it is the same text after the lines rewrap; its top is what must stay.
      let line = null;
      if (scroller) {
        const view = scroller.getBoundingClientRect(), bottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 4;
        seen.anchorMode = bottom ? "bottom" : "top";
        const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
        let best = null;
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (!text.textContent.trim() || text.parentElement.closest("[hidden], [aria-hidden='true'], svg, textarea")) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          for (const rect of range.getClientRects()) {
            if (rect.width < 4 || rect.height < 6 || rect.top < view.top + 2 || rect.bottom > view.bottom - 2) continue;
            if (!best || (bottom ? rect.bottom > best.rect.bottom : rect.top < best.rect.top)) best = { text, rect };
          }
        }
        if (best) {
          // The character that starts that line: the first one whose own box is on the line's top and left edge.
          const one = document.createRange();
          let at = 0;
          for (; at < best.text.length; at++) {
            one.setStart(best.text, at); one.setEnd(best.text, at + 1);
            const box = one.getBoundingClientRect();
            if (box.width > 0 && Math.abs(box.top - best.rect.top) < 2 && Math.abs(box.left - best.rect.left) < 2) break;
          }
          line = { text: best.text, at: Math.min(at, best.text.length - 1) };
          seen.anchorText = best.text.textContent.slice(line.at, line.at + 20);
        }
      }
      const lineTop = () => {
        if (!line?.text.isConnected) return null;
        const one = document.createRange();
        one.setStart(line.text, line.at); one.setEnd(line.text, line.at + 1);
        const box = one.getBoundingClientRect();
        return box.height ? box.top : null;
      };
      const sample = () => {
        const row = { nav: nav.getBoundingClientRect().width, pressed: !!seen.pressed, text: [], words: [] };
        if (scroller) {
          const now = area();
          let over = 0, who = "";
          stageTexts.forEach((node, at) => {
            if (!node.isConnected) return;
            const box = node.getBoundingClientRect();
            if (!box.width) return;
            const out = Math.max(now.left - box.left, box.right - now.right);
            if (out > over) { over = out; who = seen.stageNames[at]; }
          });
          row.over = over; row.overWho = who; row.hscroll = scroller.scrollWidth - scroller.clientWidth; row.line = lineTop(); row.scrollTop = scroller.scrollTop; row.gap = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop; row.col = column?.getBoundingClientRect().width;
        }
        for (const entry of watch) {
          const node = document.querySelector(entry.selector);
          const first = node?.getClientRects()[0], box = entry.ref ? document.querySelector(entry.ref)?.getBoundingClientRect() : null, ref = box ? (entry.refEdge === "right" ? box.right : box.left) : 0;
          row.text.push(first ? { x: first.left, y: first.top, ref, lines: entry.lines ? lines(node) : 1 } : null);
        }
        for (const node of words) {
          const first = node.isConnected ? node.getClientRects()[0] : null;
          row.words.push(first ? [Math.round(first.top * 100) / 100, lines(node)] : null);
        }
        seen.samples.push(row);
      };
      seen.runsBefore = window.__resizeRuns ?? 0;
      seen.frameLoop = true;
      let last = performance.now();
      // The text is read where the owner sees it: a ResizeObserver on a 1 px probe that changes size each frame is told after layout, after
      // the app's own observers (made before it, which keep a thread at its bottom) and before paint (follow-probe.mjs).
      let beat = null, flip = false;
      // Both passes have it: it also says how long each frame's own work took before it was drawn (`work`).
      beat = document.createElement("div");
      beat.setAttribute("aria-hidden", "true");
      beat.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0;contain:strict";
      document.body.append(beat);
      let frameStart = 0;
      const onBeat = () => { if (!seen.frameLoop) return; seen.work.push(performance.now() - frameStart); if (sampled) sample(); };
      seen.observer = new ResizeObserver(onBeat);
      seen.observer.observe(beat);
      // Observers are told in the order they were made: made again once the edge is held, this one is told after the one the drag
      // makes for the conversation's place (reading-place.ts followLines), so it reads what the owner sees.
      seen.rearm = () => { seen.observer.disconnect(); seen.observer = new ResizeObserver(onBeat); seen.observer.observe(beat); };
      seen.beat = beat;
      const tick = now => { if (!seen.frameLoop) return; seen.frames.push(now - last); last = now; frameStart = now; flip = !flip; beat.style.width = flip ? "2px" : "1px"; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, sampled, watch, everyWord, anchor);

    const before = await read();
    // LOOK_CPUPROFILE=1: the script's own time, by function, of the press (the timed pass only).
    if (!sampled && process.env.LOOK_CPUPROFILE) { await client.send("Profiler.enable"); await client.send("Profiler.setSamplingInterval", { interval: 200 }); await client.send("Profiler.start"); }
    if (toggle) {
      // Open or close as the owner does (a key, a click) and let the pane settle: twice, so it ends where it began.
      for (let round = 0; round < 2; round++) {
        await page.evaluate(toggle => { if (toggle === "sidebar") window.dispatchEvent(new Event("raphael:toggle-sidebar")); else document.querySelector(toggle).click(); }, toggle);
        await new Promise(resolve => setTimeout(resolve, 700));
      }
    } else {
      const { x, y } = grip;
      await page.evaluate(() => window.__resize.marks.push(window.__resize.frames.length));
      await page.mouse.down();
      // The frames of the press: what the words do while the hand holds the edge (`everyWord`).
      await page.evaluate(() => { window.__resize.pressed = true; window.__resize.rearm(); });
      // A hand: a frame between two moves; out by `dx`, and back to where it began.
      for (let step = 1; step <= moves; step++) { await page.mouse.move(x + dx * step / moves, y); await new Promise(resolve => setTimeout(resolve, 16)); }
      for (let step = moves - 1; step >= 0; step--) { await page.mouse.move(x + dx * step / moves, y); await new Promise(resolve => setTimeout(resolve, 16)); }
      await page.evaluate(() => { window.__resize.marks.push(window.__resize.frames.length); window.__resize.pressed = false; });
      await page.mouse.up();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const after = await read();
    let profile = null;
    if (!sampled && process.env.LOOK_CPUPROFILE) {
      const { profile: taken } = await client.send("Profiler.stop");
      const self = new Map(), byId = new Map(taken.nodes.map(node => [node.id, node]));
      taken.samples.forEach((id, at) => { const frame = byId.get(id).callFrame, key = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").slice(-2).join("/")}:${frame.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + (taken.timeDeltas[at] ?? 0) / 1000); });
      profile = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, ms]) => [name, Math.round(ms)]);
    }
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
      return { frames: seen.frames, work: seen.work, anchorMode: seen.anchorMode, anchorText: seen.anchorText, loaf: seen.loaf, longTasks: seen.longTasks, writes: seen.writes, observerRuns: (window.__resizeRuns ?? 0) - seen.runsBefore, samples: seen.samples, wordNames: seen.wordNames, marks: seen.marks, end: seen.end };
    });
    return { before, after, events, seen, profile };
  };

  const timed = await pass(false);
  await new Promise(resolve => setTimeout(resolve, 300));
  const sampledPass = watch.length || everyWord || anchor ? await pass(true) : null;
  // Frames of the press itself: the hand holds the edge a part of the way out, and the window is photographed as it stands.
  const shotFiles = [];
  if (shots && edge) {
    const slug = edge.replace(/[^a-z0-9-]+/gi, "_");
    await new Promise(resolve => setTimeout(resolve, 300));
    const handle = await (await page.$(edge)).boundingBox(), x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    let at = 0;
    for (let n = 1; n <= shots; n++) {
      const to = dx * n / shots;
      for (let step = 1; step <= 20; step++) { await page.mouse.move(x + at + (to - at) * step / 20, y); await new Promise(resolve => setTimeout(resolve, 16)); }
      at = to;
      await new Promise(resolve => setTimeout(resolve, 120));
      const file = `resize-${slug}-mid-${n}.png`;
      await page.screenshot({ path: join(directory, file) });
      shotFiles.push(file);
    }
    for (let step = 19; step >= 0; step--) { await page.mouse.move(x + at * step / 20, y); await new Promise(resolve => setTimeout(resolve, 16)); }
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 300));
  }
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
    // The work of a frame up to its layout, from its start to the ResizeObserver told after it, and the frames that came later than 20 ms.
    workMsMax: round(Math.max(0, ...timed.seen.work.slice(1))), workMsP95: round([...timed.seen.work.slice(1)].sort((a, b) => a - b)[Math.floor(timed.seen.work.length * 0.95)] ?? 0, 2),
    workMsMedian: round([...timed.seen.work.slice(1)].sort((a, b) => a - b)[Math.floor(timed.seen.work.length * 0.5)] ?? 0, 2),
    framesOver20: frames.filter(gap => gap > 20).length, shots: shotFiles, ...(timed.profile ? { profile: timed.profile } : {}),
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
    // The steps of a part of a pixel of the texts that must move by whole pixels (`whole`: the reading column's, centred in its pane).
    const wholeSteps = perText.reduce((sum, entry, at) => sum + (watch[at].whole ? entry.fractionalFrames : 0), 0);
    Object.assign(result, { sampledFrames: rows.length, shake, fractional, wholeSteps, rewraps, perText });
    if (everyWord || anchor) {
      // A horizontal drag moves words sideways with their column and never up or down: every word that moved up or down in a
      // frame of the press (a line it gained or lost, or one gained above it) is counted, with how often and how far it went.
      // The one setting of the lines when the edge is let go is not the press's.
      const moved = (sampledPass.seen.wordNames ?? []).map((name, at) => {
        let frames = 0, most = 0, prev = null;
        for (const row of rows) {
          const now = row.pressed ? row.words?.[at] : null;
          if (now && prev && Math.abs(now[0] - prev[0]) > 0.01) { frames++; most = Math.max(most, Math.abs(now[0] - prev[0])); }
          prev = now;
        }
        return { name, frames, most: Math.round(most * 100) / 100 };
      }).filter(word => word.frames).sort((a, b) => b.frames - a.frames);
      Object.assign(result, { wordsWatched: sampledPass.seen.wordNames?.length ?? 0, wordsJumped: moved.length, moved: moved.slice(0, 20) });
      // A word that jumps one way and back the next frame is shaking (a correction that lags the layout it corrects); a jump that
      // stays is the paragraph above it gaining or losing a line, which no place kept can avoid.
      const flickering = new Set(), flickerWords = [];
      (sampledPass.seen.wordNames ?? []).forEach((name, at) => {
        let prev = null, before = 0;
        rows.forEach((row, index) => {
          const now = row.pressed ? row.words?.[at]?.[0] : null;
          const step = now != null && prev != null ? now - prev : 0;
          if (Math.abs(step) > 0.5 && Math.abs(before) > 0.5 && Math.sign(step) !== Math.sign(before) && Math.abs(step + before) <= 1) { flickering.add(index); if (flickerWords.length < 8) flickerWords.push(`${name} @${index} ${before > 0 ? "+" : ""}${round(before)},${step > 0 ? "+" : ""}${round(step)}`); }
          before = step; prev = now;
        });
      });
      Object.assign(result, { flicker: flickering.size, flickerWords });
    }
    if (anchor) {
      const lines = rows.map(row => row.line).filter(value => value != null);
      const base = lines[0] ?? 0;
      // A thread at its bottom keeps its bottom (what stands under a line may wrap again and move the line itself): the distance from the end
      // is what must stay 0. Otherwise the line read keeps its top.
      Object.assign(result, {
        anchorMode: sampledPass.seen.anchorMode, anchorText: sampledPass.seen.anchorText, anchorSamples: lines.length,
        // The line read stays where it stood: its top is the same in every frame of the press and after it.
        anchorDrift: sampledPass.seen.anchorMode === "bottom" ? round(Math.max(0, ...rows.filter(row => row.gap != null).map(row => Math.abs(row.gap))), 2) : round(Math.max(0, ...lines.map(value => Math.abs(value - base))), 2),
        // No word of the stage is cut or covered by the list, the panel or the window.
        overflowMax: round(Math.max(0, ...rows.map(row => row.over ?? 0)), 1), overflowFrames: rows.filter(row => (row.over ?? 0) > 1.5).length,
        overflowWho: [...new Set(rows.filter(row => (row.over ?? 0) > 1.5).map(row => row.overWho))].slice(0, 6),
        hscrollMax: Math.max(0, ...rows.map(row => row.hscroll ?? 0)),
      });
      // The column's width goes in steps while the edge is held (R-PERF-27): it changes only by whole steps (`colOffGrid` counts the frames
      // that moved it by anything else) and the paragraphs wrap again only in those frames (`colSteps`, against `moves` pointer moves out and back).
      const cols = rows.filter(row => row.pressed && row.col != null).map(row => row.col);
      let colSteps = 0, colOffGrid = 0;
      cols.forEach((width, at) => {
        if (!at || Math.abs(width - cols[at - 1]) < 0.01) return;
        colSteps++;
        const change = Math.abs(width - cols[at - 1]), off = Math.abs(change / step - Math.round(change / step)) * step;
        if (off > 0.2) colOffGrid++;
      });
      Object.assign(result, {
        colSteps, colOffGrid, colStep: step, colWidths: [...new Set(cols.map(width => Math.round(width * 10) / 10))].length,
        ...(process.env.LOOK_SERIES ? { anchorSeries: rows.filter(row => row.pressed).map(row => [Math.round((row.line ?? -1) * 10) / 10, Math.round(row.scrollTop * 10) / 10, Math.round(row.nav)]) } : {}),
      });
    }
  }
  return result;
}
