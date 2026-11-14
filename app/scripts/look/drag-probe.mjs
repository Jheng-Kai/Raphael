import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reordering the sidebar as the owner does (owner, 2026-11-14: 「為什麼它只是調順序而已也會卡」, R-SIDE-03): a real pointer
 * takes a member row or a folder, carries it over the list and lets go. What the owner feels is measured, not guessed:
 *
 *  - when the row stands where it was dropped (`orderMs`, from the drop), and whether it ever stood in another place on the way
 *    (`orderStates`: every order the list was seen in after the drop);
 *  - what the drop asked of the core (`saves`: members.update and groups.update, one is enough) and how often it was read again;
 *  - what the drop drew: element nodes made new or left in the sidebar and in the conversation, and which rows of the list are
 *    not the same node afterwards (`replaced`, by key; a moved row may be, the rows beside it may not);
 *  - the main thread: long tasks, long animation frames, frames over 50 ms, the pointer's own handlers, and the Performance
 *    domain's script, layout and style time over the whole press (the trace of it is kept beside the report).
 *
 * `limits` fails the step; `moved` names the keys that may be new nodes. Throws an error that carries `assertion`.
 */
export async function dragProbe(page, { kind = "member", item, over, edge = "top", expect, moved = [], moves = 24, throttle = 1, limits = {} }, directory) {
  // The page has read what it reads when it opens: no core request waits or has just been asked for, and nothing has changed for a while.
  await page.waitForFunction(() => {
    const now = performance.now(), calls = window.__look.calls.filter(call => call.command === "core_call");
    return calls.every(call => call.t1 !== undefined) && now - Math.max(0, ...calls.map(call => call.t1)) > 800;
  }, { timeout: 15000, polling: 100 });
  const rowOf = id => kind === "group" ? `.mb-col .mb-sec[data-group="${id}"]` : `.mb-col [data-member-item="${id}"]`;
  const handle = kind === "group" ? " .mb-ghead" : "", grab = rowOf(item) + handle, target = rowOf(over) + handle;
  for (const selector of [grab, target]) await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  // Both ends on screen at once: the list is scrolled so that the span between them is centred.
  await page.evaluate((grab, target) => {
    const scroller = document.querySelector(".mb-col .mb-scroll"), a = document.querySelector(grab).getBoundingClientRect(), b = document.querySelector(target).getBoundingClientRect();
    const box = scroller.getBoundingClientRect(), middle = (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2;
    scroller.scrollTop += middle - (box.top + box.height / 2);
  }, grab, target);
  await new Promise(resolve => setTimeout(resolve, 150));

  await page.evaluate((kind, expect) => {
    const seen = window.__drag = { kind, longTasks: [], frames: [], loaf: [], dragover: [], orders: [], dropAt: 0, orderAt: 0, sidebar: { fresh: 0, moved: 0, gone: 0, batches: 0 }, conversation: { fresh: 0, gone: 0, batches: 0 }, lastMutation: 0, startedMs: performance.now() };
    // Every order the list is read in: the expected one is the only one the owner should ever see.
    const order = () => expect.map(entry => [...document.querySelectorAll(entry.selector)].map(node => node.getAttribute(entry.attribute)).join(",")).join("|");
    const wanted = expect.map(entry => entry.ids.join(",")).join("|");
    seen.order = order;
    seen.initialOrder = order();
    seen.tasks = new PerformanceObserver(list => { for (const entry of list.getEntries()) seen.longTasks.push({ atMs: Math.round(entry.startTime - seen.startedMs), ms: Math.round(entry.duration) }); });
    seen.tasks.observe({ entryTypes: ["longtask"] });
    try {
      seen.frameObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) seen.loaf.push({ atMs: Math.round(entry.startTime - seen.startedMs), ms: Math.round(entry.duration), scriptMs: Math.round(entry.scripts.reduce((sum, script) => sum + script.duration, 0)), blockingMs: Math.round(entry.blockingDuration) }); });
      seen.frameObserver.observe({ type: "long-animation-frame", buffered: false });
    } catch { seen.noLoaf = true; }
    // The pointer's own work: a listener ahead of the app's and one behind it bound each dragover.
    let began = 0;
    window.addEventListener("dragover", () => { began = performance.now(); }, true);
    window.addEventListener("dragover", () => { seen.dragover.push(performance.now() - began); });
    window.addEventListener("drop", () => { seen.dropAt = performance.now(); }, true);
    // The rows and faces that stand before the press; a node that is another one afterwards was drawn again.
    const keyOf = node => node.matches(".mb-item") ? `item:${node.dataset.memberItem}` : node.matches(".mb-sec") ? `folder:${node.dataset.group}` : `face:${node.closest("[data-member-item]")?.dataset.memberItem ?? "?"}`;
    seen.keyed = new Map([...document.querySelectorAll(".mb-col .mb-item, .mb-col .mb-sec, .mb-col .mb-item svg.slime")].map(node => [keyOf(node), node]));
    seen.keyOf = keyOf;
    const known = new WeakSet(document.querySelectorAll(".mb-col *, .mb-chat *"));
    seen.mutations = new MutationObserver(records => {
      const now = performance.now();
      let side = false, talk = false;
      for (const record of records) {
        if (record.type !== "childList") continue;
        const inSide = record.target.closest?.(".mb-col"), inTalk = record.target.closest?.(".mb-chat");
        if (!inSide && !inTalk) continue;
        const into = inSide ? seen.sidebar : seen.conversation;
        for (const node of record.addedNodes) if (node instanceof Element) {
          if (known.has(node)) { if (inSide) into.moved++; } else { into.fresh++; known.add(node); for (const inner of node.querySelectorAll("*")) { known.add(inner); into.fresh++; } }
        }
        for (const node of record.removedNodes) if (node instanceof Element) into.gone++;
        if (inSide) side = true; else talk = true;
      }
      if (side) { seen.sidebar.batches++; seen.lastMutation = now; }
      if (talk) { seen.conversation.batches++; seen.lastMutation = now; }
      const current = order();
      if (seen.dropAt) {
        if (!seen.orders.length || seen.orders.at(-1).order !== current) seen.orders.push({ atMs: Math.round(now - seen.dropAt), order: current });
        if (!seen.orderAt && current === wanted) seen.orderAt = now;
      }
    });
    seen.mutations.observe(document.body, { childList: true, subtree: true });
    // Frames: the gap between two animation frames of the page while the press lasts.
    seen.frameLoop = true;
    let last = performance.now();
    const tick = now => { if (!seen.frameLoop) return; seen.frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    seen.calls = window.__look.calls.length;
  }, kind, expect);

  const client = await page.createCDPSession();
  await client.send("Performance.enable");
  if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const read = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  const traceFile = `drag-probe-${kind}-${item}-${over}.trace.json`;
  await page.tracing.start({ path: join(directory, traceFile), categories: ["toplevel", "devtools.timeline", "blink.user_timing", "v8.execute"] });
  const before = await read();
  // A folder is taken by its heading (anywhere else in it is a member's row) and let go over the heading of the one it goes before.
  const source = await (await page.$(grab)).boundingBox(), end = await (await page.$(target)).boundingBox();
  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const to = { x: end.x + end.width / 2, y: edge === "bottom" ? end.y + end.height - 3 : edge === "middle" ? end.y + end.height / 2 : end.y + 3 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A hand: sixteen milliseconds between two moves, the frame the browser draws between them.
  for (let step = 1; step <= moves; step++) {
    await page.mouse.move(from.x + (to.x - from.x) * step / moves, from.y + (to.y - from.y) * step / moves);
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  // The hand rests a moment where it lets go: the browser asks the page once more whether the row may land there.
  await page.mouse.move(to.x, to.y);
  await new Promise(resolve => setTimeout(resolve, 150));
  const dragging = await page.evaluate(() => window.__drag.dragover.length);
  const midway = await read();
  await page.mouse.up();
  // Until the list has been still for a while: the drop's own redraws, and the ones the core's answers bring.
  const quiet = 500, deadline = Date.now() + 8000;
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const idle = await page.evaluate(() => performance.now() - Math.max(window.__drag.dropAt, window.__drag.lastMutation));
    if (idle > quiet || Date.now() > deadline) break;
  }
  const after = await read();
  await page.tracing.stop();
  const raw = await readFile(join(directory, traceFile), "utf8"), tracing = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await client.detach();

  const seen = await page.evaluate(() => {
    const seen = window.__drag;
    seen.tasks.disconnect(); seen.mutations.disconnect(); seen.frameObserver?.disconnect(); seen.frameLoop = false;
    const kept = [], replaced = [];
    for (const [key, node] of seen.keyed) {
      const now = key.startsWith("face:") ? document.querySelector(`.mb-col [data-member-item="${key.slice(5)}"] svg.slime`)
        : key.startsWith("item:") ? document.querySelector(`.mb-col [data-member-item="${key.slice(5)}"]`) : document.querySelector(`.mb-col .mb-sec[data-group="${key.slice(7)}"]`);
      (now === node ? kept : replaced).push(key);
    }
    const calls = window.__look.calls.slice(seen.calls).filter(call => call.command === "core_call").map(call => call.method);
    const tally = Object.fromEntries([...new Set(calls)].sort().map(name => [name, calls.filter(method => method === name).length]));
    return { longTasks: seen.longTasks, loaf: seen.loaf, noLoaf: !!seen.noLoaf, frames: seen.frames, dragover: seen.dragover, dropAt: seen.dropAt, orderAt: seen.orderAt, orders: seen.orders, initialOrder: seen.initialOrder, finalOrder: seen.order(),
      sidebar: seen.sidebar, conversation: seen.conversation, kept: kept.length, replaced, calls: tally, nodes: document.querySelectorAll("*").length };
  });
  const summary = summarizeTrace(tracing.traceEvents ?? tracing);

  const sorted = values => [...values].sort((a, b) => a - b), percentile = (values, p) => values.length ? sorted(values)[Math.min(values.length - 1, Math.floor(values.length * p))] : 0;
  const round = (value, digits = 1) => +value.toFixed(digits);
  const metric = (name, from, to) => round((to[name] - from[name]) * 1000);
  const dropPhase = { scriptMs: metric("ScriptDuration", midway, after), layoutMs: metric("LayoutDuration", midway, after), styleMs: metric("RecalcStyleDuration", midway, after), taskMs: metric("TaskDuration", midway, after) };
  const dragPhase = { scriptMs: metric("ScriptDuration", before, midway), layoutMs: metric("LayoutDuration", before, midway), styleMs: metric("RecalcStyleDuration", before, midway), taskMs: metric("TaskDuration", before, midway) };
  const saves = (seen.calls["members.update"] ?? 0) + (seen.calls["groups.update"] ?? 0);
  const result = {
    check: "drag-probe", kind, item, over, throttle, trace: traceFile,
    orderMs: seen.orderAt && seen.dropAt ? Math.round(seen.orderAt - seen.dropAt) : -1,
    orderStates: seen.orders.length, orders: seen.orders,
    saves, calls: seen.calls, reads: seen.calls["members.list"] ?? 0,
    longTasks: seen.longTasks, longestTaskMs: Math.max(0, ...seen.longTasks.map(task => task.ms)),
    longestFrameScriptMs: Math.max(0, ...seen.loaf.map(frame => frame.scriptMs)), longFrames: seen.loaf.length, loafSupported: !seen.noLoaf,
    frameGapMax: round(Math.max(0, ...seen.frames)), framesOver50: seen.frames.filter(gap => gap > 50).length, frameCount: seen.frames.length,
    dragoverCount: seen.dragover.length, dragoverMedianMs: round(percentile(seen.dragover, 0.5), 2), dragoverMaxMs: round(Math.max(0, ...seen.dragover), 2),
    dragPhase, dropPhase, scriptMsPerFrame: round((after.ScriptDuration - before.ScriptDuration) * 1000 / Math.max(1, seen.frames.length), 2),
    sidebarFresh: seen.sidebar.fresh, sidebarMoved: seen.sidebar.moved, sidebarGone: seen.sidebar.gone, sidebarBatches: seen.sidebar.batches,
    conversationFresh: seen.conversation.fresh, conversationGone: seen.conversation.gone, conversationBatches: seen.conversation.batches,
    kept: seen.kept, replaced: seen.replaced, unexpectedlyReplaced: seen.replaced.filter(key => !moved.includes(key)),
    nodes: seen.nodes, nodesDelta: after.Nodes - before.Nodes, trace: { file: traceFile, ...summary },
    finalOrder: seen.finalOrder, initialOrder: seen.initialOrder, dragged: dragging > 0,
  };
  const problems = [];
  if (!result.dragged) problems.push("the pointer never made the browser drag (no dragover)");
  if (result.finalOrder !== expect.map(entry => entry.ids.join(",")).join("|")) problems.push(`the list ended as ${result.finalOrder}, not as dropped`);
  for (const [name, limit] of Object.entries(limits)) {
    const value = name === "replaced" ? result.unexpectedlyReplaced.length : result[name];
    if (value > limit) problems.push(`${name} ${JSON.stringify(value)} > ${limit}`);
  }
  if (problems.length) throw Object.assign(new Error(`Reordering the sidebar stalls or redraws too much: ${problems.join("; ")} | ${JSON.stringify({ ...result, orders: undefined, trace: undefined })}`), { assertion: result });
  return result;
}

/** What a trace says about the main thread: its long tasks and where the time of the press went. */
export function summarizeTrace(events) {
  const main = events.find(event => event.name === "thread_name" && event.args?.name === "CrRendererMain");
  const own = main ? events.filter(event => event.pid === main.pid && event.tid === main.tid && event.ph === "X") : [];
  const total = name => Math.round(own.filter(event => event.name === name).reduce((sum, event) => sum + event.dur, 0) / 100) / 10;
  // Chrome names a task of the main thread RunTask; Edge's build calls the same slice ThreadControllerImpl::RunTask.
  const tasks = own.filter(event => event.name === "ThreadControllerImpl::RunTask" || event.name === "RunTask").map(event => event.dur / 1000);
  return {
    tasksOver50ms: tasks.filter(ms => ms > 50).length, longestTaskMs: Math.round(Math.max(0, ...tasks) * 10) / 10, taskMs: Math.round(tasks.reduce((sum, ms) => sum + ms, 0) * 10) / 10,
    functionCallMs: total("FunctionCall"), layoutMs: total("Layout"), styleMs: total("UpdateLayoutTree"), paintMs: total("Paint"),
    dragEvents: own.filter(event => event.name === "EventDispatch" && ["dragover", "drop", "dragstart"].includes(event.args?.data?.type)).length,
  };
}
