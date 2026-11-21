const field = ".page-agent:not([hidden]) .mb-chat .cmp-input";
const round = value => +value.toFixed(2);
const percentile = (values, quantile) => round([...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1]);
const targets = { plain: 4, slashFilter: 8, mentionFilter: 8 };
const limits = { plain: 8, slashOpen: 85, slashArrows: 9, slashFilter: 21, mentionOpen: 110, mentionArrows: 9, mentionFilter: 12 };

/** Real keyboard input, one key per painted frame, with main-thread counters from the renderer. */
export async function typingProbe(page) {
  const client = await page.createCDPSession();
  await client.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  await page.focus(field);
  await page.waitForFunction(() => {
    const look = window.__look;
    if (look.typingCalls !== look.calls.length) {
      look.typingCalls = look.calls.length;
      look.typingQuietSince = performance.now();
    }
    return performance.now() - look.typingQuietSince > 500;
  }, { polling: 50 });
  await page.evaluate(selector => {
    const input = document.querySelector(selector);
    const probe = window.__typingProbe = { input, mark: 0, frames: [], foreignReads: [] };
    const records = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(document.body, { subtree: true, attributes: true, characterData: true, childList: true });
    const side = ".mb-col, .side", thread = ".thread, .ra-scroll";
    const outside = `${side}, ${thread}`;
    const restore = [];
    const watch = (prototype, key, member) => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (!descriptor?.[member]) return;
      Object.defineProperty(prototype, key, { ...descriptor, [member](...args) {
        if (probe.reading && this instanceof Element && this.closest(outside)) probe.foreignReads.push(key);
        return descriptor[member].apply(this, args);
      } });
      restore.push(() => Object.defineProperty(prototype, key, descriptor));
    };
    for (const key of ["getBoundingClientRect", "getClientRects"]) watch(Element.prototype, key, "value");
    for (const key of ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft", "offsetParent"]) watch(HTMLElement.prototype, key, "get");
    for (const key of ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight", "scrollTop", "scrollLeft"]) watch(Element.prototype, key, "get");
    const computedStyle = window.getComputedStyle;
    window.getComputedStyle = function (element, ...args) {
      if (probe.reading && element.closest(outside)) probe.foreignReads.push("getComputedStyle");
      return computedStyle.call(this, element, ...args);
    };
    const count = (bucket, nodes) => nodes.forEach(node => {
      bucket.add(node);
      node.querySelectorAll?.("*").forEach(child => bucket.add(child));
    });
    probe.start = () => {
      observer.takeRecords();
      records.length = 0;
      probe.foreignReads.length = 0;
      probe.reading = true;
      probe.calls = window.__look.calls.length;
      probe.painted = null;
    };
    probe.end = async () => {
      const paint = await probe.painted;
      if (!paint) throw new Error("The keystroke did not reach the composer");
      probe.reading = false;
      records.push(...observer.takeRecords());
      const nodes = { composer: new Set(), menu: new Set(), thread: new Set(), sidebar: new Set(), other: new Set() };
      const classify = element => element?.closest(".composer") ? "composer" : element?.closest("#app-popover") ? "menu"
        : element?.closest(thread) ? "thread" : element?.closest(side) ? "sidebar" : "other";
      for (const record of records) {
        const area = classify(record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement);
        if (record.type !== "childList") nodes[area].add(record.target);
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          const childArea = classify(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
          count(nodes[childArea === "other" ? area : childArea], [node]);
        }
      }
      return { ...paint, foreignReads: [...probe.foreignReads], ipc: window.__look.calls.slice(probe.calls).map(call => call.method ?? call.command),
        nodes: Object.fromEntries(Object.entries(nodes).map(([area, set]) => [area, set.size])) };
    };
    let previousFrame = 0;
    const frame = at => {
      if (previousFrame) probe.frames.push(at - previousFrame);
      if (probe.frames.length > 24) probe.frames.shift();
      previousFrame = at;
      probe.frameRequest = requestAnimationFrame(frame);
    };
    probe.frameRequest = requestAnimationFrame(frame);
    probe.keydown = event => {
      if (event.target !== input) return;
      const name = `typing-key-${++probe.mark}`;
      performance.mark(name + "-start");
      const started = performance.now(), previous = previousFrame;
      const cadence = probe.cadence || 16.67;
      probe.painted = new Promise(resolve => requestAnimationFrame(at => {
        const after = new MessageChannel();
        after.port1.onmessage = () => {
          performance.mark(name + "-end");
          after.port1.close();
          after.port2.close();
          const paintMs = performance.now() - started;
          resolve({ paintMs, frames: Math.max(1, Math.round((at - previous) / cadence), Math.ceil(paintMs / cadence)) });
        };
        after.port2.postMessage(0);
      }));
    };
    document.addEventListener("keydown", probe.keydown, true);
    probe.dispose = () => {
      observer.disconnect();
      for (const undo of restore) undo();
      window.getComputedStyle = computedStyle;
      document.removeEventListener("keydown", probe.keydown, true);
      cancelAnimationFrame(probe.frameRequest);
      delete window.__typingProbe;
    };
  }, field);
  const cases = {}, failures = [];
  const fixture = await page.evaluate(() => {
    const { data } = window.__look;
    return { turns: data.turns.length, members: data.members.length, skills: data.skills.length, packageSkills: data.skillLibrary[0].skills.length };
  });
  try {
    await page.evaluate(async () => {
      const probe = window.__typingProbe;
      for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame);
      probe.cadence = [...probe.frames].sort((a, b) => a - b)[Math.floor(probe.frames.length / 2)];
    });
    async function sample(keys, name, expectedMenu) {
      const samples = [];
      for (const key of keys) {
        await page.evaluate(() => window.__typingProbe.start());
        const before = await metrics();
        await page.keyboard.press(key);
        await page.evaluate(() => window.__typingProbe.painted);
        const after = await metrics();
        const evidence = await page.evaluate(() => window.__typingProbe.end());
        const delta = metric => round((after[metric] - before[metric]) * 1000);
        samples.push({ key, ...evidence, paintMs: round(evidence.paintMs), mainMs: delta("TaskDuration"), scriptMs: delta("ScriptDuration"),
          layoutMs: delta("LayoutDuration"), styleMs: delta("RecalcStyleDuration"),
          layouts: after.LayoutCount - before.LayoutCount, styles: after.RecalcStyleCount - before.RecalcStyleCount });
        if (expectedMenu) await page.waitForSelector(expectedMenu, { visible: true, timeout: 3000 });
      }
      const quantile = (key, percentileOf) => percentile(samples.map(sample => sample[key]), percentileOf);
      cases[name] = { medianMs: quantile("mainMs", 0.5), p95Ms: quantile("mainMs", 0.95),
        medianFrames: quantile("frames", 0.5), p95Frames: quantile("frames", 0.95), samples };
      // Detailed invalidation tracing instruments every affected element and changes renderer timing.
      if (process.env.LOOK_TRACE !== "1" && cases[name].p95Ms > limits[name]) failures.push(`${name} p95 ${cases[name].p95Ms} > ${limits[name]} ms`);
      for (const [index, entry] of samples.entries()) {
        if (entry.nodes.thread || entry.nodes.sidebar) failures.push(`${name} key ${index + 1} changed the thread or sidebar`);
        if (entry.foreignReads.length) failures.push(`${name} key ${index + 1} measured the thread or sidebar: ${entry.foreignReads.join(", ")}`);
        if (entry.ipc.some(method => /^(agent\.history|members\.(skills|commands)\.list)/.test(method) && name !== "slashOpen"))
          failures.push(`${name} key ${index + 1} made an inventory or history read`);
      }
    }
    const clear = () => page.evaluate(() => {
      const { input } = window.__typingProbe;
      input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    const slash = "#app-popover.slash-menu", mention = "#app-popover.team-mentions-menu";
    await sample("Please compare the notes for this report".split("").map(key => key === " " ? "Space" : key), "plain");
    await clear();
    await sample(["/"], "slashOpen", slash);
    const slashList = await page.$eval(slash, el => ({ mounted: el.querySelectorAll("[role=option]").length, total: Number(el.querySelector("[role=option]")?.getAttribute("aria-setsize")) }));
    if (slashList.total !== 150 || slashList.mounted >= 32) failures.push(`Expected a window into 150 skills: ${JSON.stringify(slashList)}`);
    await sample(Array(8).fill("ArrowDown"), "slashArrows", slash);
    await sample("researcher", "slashFilter", slash);
    await clear();
    await page.keyboard.press("/");
    await page.waitForSelector(slash, { visible: true });
    await page.keyboard.press("ArrowUp");
    await page.waitForSelector(`${slash} [aria-posinset="150"][aria-selected="true"]`);
    await page.keyboard.press("Tab");
    if ((await page.$eval(field, input => input.value)) !== "/researcher-150 ") failures.push("The last skill could not be reached and selected");
    await clear();
    await sample(["@"], "mentionOpen", mention);
    await sample(Array(8).fill("ArrowDown"), "mentionArrows", mention);
    await sample("analys", "mentionFilter", mention);
  } finally {
    await page.evaluate(() => window.__typingProbe.dispose());
    await client.detach();
  }
  if (fixture.turns !== 400 || fixture.members !== 25 || fixture.skills !== 150 || fixture.packageSkills !== 60) failures.push("The typing fixture is incomplete");
  const targetMisses = Object.entries(targets).filter(([name, target]) => cases[name].p95Ms >= target).map(([name]) => name);
  const result = { check: "typing-performance", fixture, limits, targets, targetMisses, timingAssertions: process.env.LOOK_TRACE !== "1", cases, failures };
  if (failures.length) throw Object.assign(new Error(failures.join("; ")), { assertion: result });
  return result;
}
