import { placesProblems, slimePlaces } from "./slime-places.mjs";

/**
 * What a calm screen is while the core talks (R-SLIME-02; owner, 2026-11-11: 「我希望整體的畫面永遠保持正常顯示，不要有任何問題」):
 * no element of the member list, the header, the thread or the panel is replaced (a text node may be), no text that was
 * there is ever empty at a frame, no scroller moves, and no slime outside the two places that may move is moving.
 */
export function calmProblems(result) {
  const problems = [];
  const list = (name, items) => { if (items?.length) problems.push(`${name}: ${[...new Set(items)].slice(0, 6).join(" | ")}`); };
  list("an element was replaced", result.calmReplaced);
  list("text was emptied", result.calmEmptied);
  if (result.blankFrames) problems.push(`text was blank at ${result.blankFrames} frame(s)`);
  if (result.scrollMoved) problems.push(`a scroller moved by ${result.scrollMoved}px`);
  list("a slime moved where only pictures belong", result.stray);
  return problems;
}

/** Nearest-rank P90 gates sustained input latency; retain every sample and the worst frame. */
export function keyLatency(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { keyP90Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? 0,
    keySlowestMs: Math.round(Math.max(0, ...samples)), keySamples: samples.length };
}

/** Drive the real wheel and keyboard while the fake core publishes team work. */
export async function eventStorm(page, options) {
  const { selector, seconds = 4, every = 200, wheelEvery = 100, wheelBy = 720, type = null,
    quiet = false, compareQuiet = false, position = "top", progress = false, liveText = false, arrival = false, hover = false, home = false, roster = false, calm = false, limits = {} } = options;
  let control;
  if (compareQuiet) control = await eventStorm(page, { ...options, compareQuiet: false, quiet: true, limits: { fromBottom: 80 } });
  await page.evaluate(({ selector, position }) => {
    const scroller = document.querySelector(selector);
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    proto.set.call(scroller, position === "bottom" ? scroller.scrollHeight : position === "middle" ? scroller.scrollHeight / 2 : 0);
  }, { selector, position });
  await new Promise(resolve => setTimeout(resolve, 300));
  const point = await page.$eval(hover ? `${selector} [data-id="200000"] a.link-chip` : selector, element => {
    if (element.matches("a.link-chip")) element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + Math.min(rect.height / 2, 200) };
  });
  await page.mouse.move(point.x, point.y);
  if (type) await page.focus(type);
  await page.evaluate(({ selector, hover, type, roster, calm }) => {
    const scroller = document.querySelector(selector);
    const seen = window.__storm = { replacedLines: 0, replacedCards: 0, replacedFaces: 0, scrollWrites: 0, longTaskMs: 0, keyMs: [],
      cachedMisses: 0, changedKeys: [], calls: window.__look.calls.length, top: scroller.scrollTop, clock: Date.now(), startedMs: performance.now(), typed: "",
      hovered: hover ? scroller.querySelector('[data-id="200000"] a.link-chip') : null };
    if (roster) {
      // Idle and sleeping faces intentionally have no loops; visible working faces must have them.
      // A face off screen, as in the closed narrow drawer, pauses its loops to save the main thread.
      const onScreen = svg => {
        const box = svg.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
      };
      const faces = [...document.querySelectorAll('.mb-row svg.slime')].filter(onScreen);
      seen.motionRequired = faces.some(svg => ['thinking', 'working', 'searching', 'computer', 'waiting', 'blocked', 'error'].includes(svg.dataset.state));
      seen.animations = faces.flatMap(svg => {
        const member = window.__look.data.members.find(member => member.id === Number(svg.dataset.slimeMember));
        if (member) member.activity = svg.dataset.state;
        return svg.closest('.slime-surface').getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect.getTiming().iterations === Infinity)
          .map(animation => ({ animation, start: animation.startTime, delay: animation.effect.getTiming().delay }));
      });
      seen.rosterPreview = window.__look.data.members.find(member => member.id === 1)?.preview ?? '';
    }
    if (calm) {
      // The main areas, watched for anything a calm screen does not do: replace an element, empty a text, move a scroller.
      const areas = [".mb-list", ".mb-head", selector, ".mb-det"].map(css => document.querySelector(css)).filter(Boolean);
      const moving = node => !!(node.nodeType === 1 ? node : node.parentElement)?.closest(".slime-surface:not([data-slime-still])");
      const named = node => `${node.nodeName.toLowerCase()}${node.className && typeof node.className === "string" ? "." + node.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      const calmSeen = seen.calm = { replaced: [], emptied: [], blank: 0, frames: 0, probes: [], scrolls: [...document.querySelectorAll(".mb-scroll, .ra-scroll, .mb-det-scroll")].map(element => [element, element.scrollTop]) };
      for (const area of areas) for (const element of area.querySelectorAll("*")) {
        if (element.children.length === 0 && element.textContent.trim() && !moving(element) && element.checkVisibility?.()) calmSeen.probes.push(element);
      }
      calmSeen.probes.length = Math.min(calmSeen.probes.length, 400);
      calmSeen.observer = new MutationObserver(records => {
        for (const record of records) {
          if (moving(record.target)) continue;
          if (record.type === "characterData") { if (record.oldValue?.trim() && !record.target.data.trim()) calmSeen.emptied.push(named(record.target.parentElement ?? record.target)); continue; }
          for (const node of record.removedNodes) {
            if (node.nodeType === 1) calmSeen.replaced.push(`${named(node)} in ${named(record.target)}`);
            else if (node.nodeType === 3 && node.data.trim() && !record.addedNodes.length && !record.target.textContent.trim()) calmSeen.emptied.push(named(record.target));
          }
        }
      });
      for (const area of areas) calmSeen.observer.observe(area, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
      const frame = () => {
        if (window.__storm?.calm !== calmSeen) return;
        calmSeen.frames++;
        for (const probe of calmSeen.probes) if (probe.isConnected && probe.checkVisibility?.() && !probe.textContent.trim()) calmSeen.blank++;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
    seen.observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node.nodeType !== 1) continue;
          const lines = [...(node.matches(".tn") ? [node] : []), ...node.querySelectorAll(".tn")];
          seen.replacedLines += lines.length;
          seen.changedKeys.push(...lines.map(line => line.dataset.key));
          seen.replacedCards += (node.matches("a.link-chip") ? 1 : 0) + node.querySelectorAll("a.link-chip").length;
          const face = ".av, .slime, .ra-face";
          seen.replacedFaces += (node.matches(face) ? 1 : 0) + node.querySelectorAll(face).length;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1 || !node.matches(".tn")) continue;
          for (const chip of node.querySelectorAll("a.link-chip[data-link-title]")) if (!chip.dataset.linkState) seen.cachedMisses++;
        }
      }
    });
    seen.observer.observe(document.body, { childList: true, subtree: true });
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get() { return proto.get.call(this); }, set(value) { seen.scrollWrites++; proto.set.call(this, value); } });
    seen.longTasks = [];
    seen.performance = new PerformanceObserver(list => { for (const entry of list.getEntries()) { seen.longTaskMs += entry.duration; seen.longTasks.push({ atMs: Math.round(entry.startTime - seen.startedMs), ms: Math.round(entry.duration) }); } });
    seen.performance.observe({ entryTypes: ["longtask"] });
    // Time the real input event through paint, excluding automation transport and scheduling.
    seen.keydown = event => {
      if (!type || !event.target.matches(type)) return;
      const start = performance.now(), index = seen.keyMs.length;
      performance.mark(`storm-key-${index}-start`);
      seen.keyPaint = new Promise(resolve => requestAnimationFrame(frame => {
        const end = performance.now(), duration = end - start;
        performance.mark(`storm-key-${index}-end`);
        if (!seen.keySlowest || duration > seen.keySlowest.duration) seen.keySlowest = { index, start, end, frame, duration, eventTime: event.timeStamp, visibility: document.visibilityState };
        seen.keyMs.push(duration); resolve();
      }));
    };
    document.addEventListener("keydown", seen.keydown, true);
  }, { selector, hover, type, roster, calm });
  const strays = [];
  let placesAt = 0;
  const began = Date.now(), ends = began + seconds * 1000;
  const ticking = (async () => {
    while (Date.now() < ends) {
      if (calm && Date.now() - placesAt > 1000) {
        placesAt = Date.now();
        strays.push(...placesProblems(await page.evaluate(slimePlaces)));
      }
      if (!quiet) await page.evaluate(({ elapsed, progress, liveText, arrival, home, roster, calm }) => {
        const seen = window.__storm, data = window.__look.data;
        if (calm && Math.floor(elapsed / 500) !== seen.calmStep) {
          // A member's step and the words for it, as the core says them: the state, then the roster that carries the label.
          seen.calmStep = Math.floor(elapsed / 500);
          const state = ["thinking", "working", "searching"][seen.calmStep % 3], label = `Checking ${seen.calmStep}`;
          Object.assign(data.members.find(member => member.id === 1), { activity: state, activity_label: label });
          window.__look.emit({ type: "MemberActivity", member_id: 1, state, label });
          window.__look.emit({ type: "MembersChanged" });
        }
        window.__look.now = seen.clock + elapsed;
        const turn = data.turns.find(turn => turn.id === 200000);
        if (roster && Math.floor(elapsed / 1000) > (seen.rosterStep ?? 0)) {
          seen.rosterStep = Math.floor(elapsed / 1000);
          data.members.find(member => member.id === 1).preview = `${seen.rosterPreview} ${seen.rosterStep}`;
          window.__look.emit({ type: 'MembersChanged' });
        }
        if (progress && turn && Math.floor(elapsed / 1000) > (seen.step ?? 0)) {
          seen.step = Math.floor(elapsed / 1000);
          turn.steps.push({ kind: "tool", tool: "web_search", server: "Raphael", outcome: "ok", ms: 120, at_ms: Date.now() });
        }
        if (liveText && turn && Math.floor(elapsed / 1000) > (seen.textStep ?? 0)) {
          seen.textStep = Math.floor(elapsed / 1000);
          turn.messages.push({seq:1000 + seen.textStep,kind:"progress",text:`Checking sample ${seen.textStep}`,at_ms:Date.now()});
        }
        if (arrival && !seen.arrived && elapsed >= 1000) {
          seen.arrived = true;
          const fresh = { ...structuredClone(turn), id: 200001, task: null, steps: [], session_id: "storm-arrival", question: "New question", created_at_ms: Date.now() };
          data.turns.push(fresh);
          window.__look.emit({ type: "AgentTurn", turn_id: fresh.id, member_id: 0 });
        }
        window.__look.emit(home ? { type: "AgentTurn", turn_id: 500, member_id: 1 } : { type: "WorkerChanged", task_id: 71, state: "running", running: true });
      }, { elapsed: Date.now() - began, progress, liveText, arrival, home, roster, calm });
      await new Promise(resolve => setTimeout(resolve, every));
    }
  })();
  const rolling = (async () => {
    while (Date.now() < ends && wheelBy) {
      await page.mouse.wheel({ deltaY: wheelBy });
      await new Promise(resolve => setTimeout(resolve, wheelEvery));
    }
  })();
  const typing = (async () => {
    if (!type) return;
    let text = "";
    while (Date.now() < ends) {
      await page.keyboard.type("a"); text += "a";
      await page.evaluate(async text => { await window.__storm.keyPaint; window.__storm.typed = text; }, text);
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  })();
  await Promise.all([ticking, rolling, typing]);
  await new Promise(resolve => setTimeout(resolve, 600));
  const result = await page.evaluate(({ selector, type, hover, arrival, position, liveText }) => {
    const scroller = document.querySelector(selector), seen = window.__storm;
    const calmSeen = seen.calm;
    if (calmSeen) { calmSeen.observer.disconnect(); delete seen.calm; }
    seen.observer.disconnect(); seen.performance.disconnect(); document.removeEventListener("keydown", seen.keydown, true); delete scroller.scrollTop;
    const calls = window.__look.calls.slice(seen.calls).map(call => call.method ?? call.command);
    const reads = Object.fromEntries([...new Set(calls)].sort().map(name => [name, calls.filter(method => method === name).length]));
    const input = type ? document.querySelector(type) : null;
    return { check: "busy-team", replacedLines: seen.replacedLines, replacedCards: seen.replacedCards, replacedFaces: seen.replacedFaces, scrollWrites: seen.scrollWrites,
      reads, allReads: calls.length, memberReads: reads["members.list"] ?? 0, longTaskMs: Math.round(seen.longTaskMs), longTasks: seen.longTasks,
      fromBottom: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight), height: scroller.scrollHeight,
      keyMs: seen.keyMs, keySlowest: seen.keySlowest, startedMs: seen.startedMs, typed: seen.typed,
      typingIntact: !input || (seen.keyMs.length === seen.typed.length && input.value === seen.typed && document.activeElement === input && input.selectionStart === input.value.length),
      cachedMisses: seen.cachedMisses, changedKeys: [...new Set(seen.changedKeys)],
      hoverIntact: !hover || (seen.hovered.isConnected && seen.hovered.matches(":hover")),
      calmReplaced: calmSeen?.replaced, calmEmptied: calmSeen?.emptied, blankFrames: calmSeen?.blank, calmFrames: calmSeen?.frames,
      scrollMoved: calmSeen ? Math.round(calmSeen.scrolls.reduce((sum, [element, top]) => sum + Math.abs(element.scrollTop - top), 0)) : undefined,
      motionSamples: seen.animations?.length ?? 0,
      motionRequired: seen.motionRequired ?? false,
      motionIntact: !seen.animations || ((!seen.motionRequired || seen.animations.length > 0) && seen.animations.every(({ animation, start, delay }) => animation.playState === 'running' && animation.startTime === start && animation.effect.getTiming().delay === delay)),
      anchorMovement: arrival && position === "middle" ? Math.abs(scroller.scrollTop - seen.top) : 0,
      arrivalShown: !arrival || !!scroller.querySelector('[data-id="200001"].is-new'),
      liveTextUpdated: !liveText || scroller.querySelector('[data-id="200000"] .live-action')?.textContent === `Checking sample ${seen.textStep}`,
    };
  }, { selector, type, hover, arrival, position, liveText });
  Object.assign(result, keyLatency(result.keyMs));
  if (calm) result.stray = [...strays, ...placesProblems(await page.evaluate(slimePlaces))];
  if (!roster && !calm) result.unrelatedReads = ['members.skills.list', 'members.commands.list', 'rooms.list'].reduce((sum, name) => sum + (result.reads[name] ?? 0), 0);
  if (control) result.quiet = control;
  const over = Object.entries(limits).filter(([name, limit]) => result[name] > limit).map(([name, limit]) => `${name} ${result[name]} > ${limit}`);
  if (result.unrelatedReads) over.push(`unrelated reads ${result.unrelatedReads}`);
  if (!result.typingIntact || !result.hoverIntact || !result.arrivalShown || !result.motionIntact) over.push("typing, hover, arrival or animation lost");
  if (progress && result.changedKeys.some(key => key !== "turn:200000")) over.push("an unchanged line was replaced");
  if (result.liveTextUpdated === false) over.push("the current public action did not update");
  if (calm) over.push(...calmProblems(result));
  if (over.length) { const error = new Error(`A busy team disturbs the reader: ${over.join(", ")} | ${JSON.stringify(result)}`); error.assertion = result; throw error; }
  return result;
}
