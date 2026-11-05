import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Event Timing omits events below 16ms. Keep that censoring explicit, never report missing events as zero. */
export function typingSummary(lag, profile) {
  const keys = lag.events.filter(event => event.name === "keydown" && /cmp-input/.test(event.target));
  const durations = keys.map(event => event.duration).sort((a, b) => a - b);
  const omitted = lag.keys - keys.length;
  const median = omitted > lag.keys / 2 ? null : durations[Math.max(0, Math.floor(lag.keys / 2) - omitted)];
  const nodes = new Map(profile.nodes.map(node => [node.id, node.callFrame])), self = new Map();
  profile.samples.forEach((id, index) => {
    const frame = nodes.get(id), key = `${frame.functionName || "(anonymous)"} ${frame.url}:${frame.lineNumber + 1}:${(frame.columnNumber ?? -1) + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  const paint = (lag.paint ?? []).map(key => key.secondFrame - key.start).sort((a, b) => a - b);
  const percentile = fraction => paint.length ? paint[Math.ceil(paint.length * fraction) - 1] : null;
  const paintMedian = percentile(.5), paintWorst = paint.at(-1) ?? null;
  const worst = Math.max(0, ...durations), worstFrame = Math.max(0, ...lag.frames.map(frame => frame.duration));
  return { keys: lag.keys, reportedKeys: keys.length, omittedBelow16ms: omitted, medianMs: median,
    medianBound: median === null ? "<16ms (Event Timing reporting floor)" : null,
    worstMs: durations.length ? worst : null, worstBound: durations.length ? null : "<16ms",
    keyToSecondFrame: { count: paint.length, medianMs: paintMedian, p95Ms: percentile(.95), worstMs: paintWorst },
    longFramesOver50ms: lag.frames.length, worstFrameMs: worstFrame,
    cpuSelfMs: [...self].sort((a, b) => b[1] - a[1]).map(([functionName, milliseconds]) => ({ functionName, milliseconds })),
    failures: [lag.keys !== 200 && `Expected 200 keydowns, received ${lag.keys}`,
      paint.length !== 200 && `Expected 200 second-frame samples, received ${paint.length}`,
      paintMedian !== null && paintMedian >= 16 && `Median key-to-second-frame ${paintMedian.toFixed(2)}ms >= 16ms`,
      paintWorst >= 50 && `Worst key-to-second-frame ${paintWorst.toFixed(2)}ms >= 50ms`,
      worstFrame > 100 && `Long animation frame ${worstFrame.toFixed(1)}ms > 100ms`].filter(Boolean) };
}

/** Shared native workflow, real entry, native IPC and persisted history; no page modules or UI are mocked. */
export async function typingJourney({ page, result, capture, snapshot, artifacts, typingBaseline = false }) {
  await page.evaluate(() => {
    const probe = window.__raphaelConversationProbe = { richScroll: [], ipc: [], phase: "opening" };
    const fetch = window.fetch.bind(window), decoder = new TextDecoder(), encoder = new TextEncoder();
    window.fetch = async (...args) => {
      let request;
      try { const body = args[1]?.body; request = JSON.parse(typeof body === "string" ? body : decoder.decode(body)); } catch { /* Non-IPC fetch. */ }
      const method = request?.method;
      const response = await fetch(...args);
      if (method === "agent.history.list" || method === "rooms.messages") {
        response.json = async () => {
          const text = await response.text(), bytes = encoder.encode(text).byteLength;
          const start = performance.now(), value = JSON.parse(text), parseMs = performance.now() - start;
          const rows = value?.turns ?? value?.messages ?? (Array.isArray(value) ? value : []);
          probe.ipc.push({ method, bytes, parseMs, phase: probe.phase, afterId: request.params?.after_id ?? null,
            dirtyIds: request.params?.turn_ids ?? [], rows: rows.length, ids: rows.map(row => row.id) });
          return value;
        };
      }
      return response;
    };
  });
  const data = await snapshot(), people = data.members.filter(member => member.name.startsWith("Typing "));
  if (people.length !== 8) throw new Error("Typing fixture needs eight members");
  const member = people[0];
  await page.click(`.mb-row[data-member="${member.id}"]`);
  await page.waitForSelector('.tn[data-id]');
  const persisted = data.agent_turns.filter(turn => turn.member_id === member.id).length;
  const opened = await page.$$eval('.tn[data-id]', nodes => nodes.length);
  if (persisted < 150 || (!typingBaseline && opened !== 25)) throw new Error(`Typing window needs 150 persisted turns and 25 mounted on open: ${persisted}/${opened}`);
  result.typingWindow = { persisted, opened, baseline: typingBaseline };
  await page.evaluate(() => {
    const thread = document.querySelector('.thread'), probe = window.__typingWindow = { maximum: thread.querySelectorAll('.tn[data-id]').length };
    probe.observer = new MutationObserver(() => { probe.maximum = Math.max(probe.maximum, thread.querySelectorAll('.tn[data-id]').length); });
    probe.observer.observe(thread, { childList: true });
  });
  if (typingBaseline) {
    // Exercise the old reader after paging through its real history, then return to the composer.
    for (let count = opened; count < persisted;) {
      await page.$eval('.ra-scroll', scroll => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event("scroll")); });
      await page.waitForFunction(before => document.querySelectorAll('.tn[data-id]').length > before, { timeout: 15000 }, count);
      count = await page.$$eval('.tn[data-id]', nodes => nodes.length);
    }
  } else {
  await page.$eval('.ra-scroll', scroll => { scroll.scrollTop = 1; scroll.dispatchEvent(new Event("scroll")); });
  await page.waitForFunction(() => document.querySelectorAll('.tn[data-id]').length === 45, { timeout: 15000 });
  result.typingWindow.afterEarlier = await page.$$eval('.tn[data-id]', nodes => nodes.length);
  await page.$eval('.ra-scroll', scroll => { scroll.scrollTop = 1; scroll.dispatchEvent(new Event("scroll")); });
  await page.waitForFunction(() => document.querySelectorAll('.tn[data-id]').length === 65, { timeout: 15000 });
  result.typingWindow.afterSecondEarlier = await page.$$eval('.tn[data-id]', nodes => nodes.length);
  await page.click('.mb-chat:not([hidden]) .conversation-latest');
  await page.waitForFunction(() => document.querySelectorAll('.tn[data-id]').length === 25);
  }
  result.typingFixture = await page.evaluate(() => ({ turns: document.querySelectorAll('.tn[data-id]').length,
    code: document.querySelectorAll('.message-code').length, cards: document.querySelectorAll('.rich-block').length,
    nodes: document.getElementsByTagName('*').length, slimes: document.querySelectorAll('svg.slime').length }));
  if (!result.typingFixture.code || !result.typingFixture.cards) throw new Error("Incomplete typing workload");
  await page.$eval('.ra-scroll', scroll => { scroll.scrollTop = scroll.scrollHeight; });
  await capture("before-typing");
  const tracing = process.env.RAPHAEL_NATIVE_TYPING_TRACE === "1";
  if (tracing) await page.tracing.start({ path: join(artifacts, "typing-trace.json"),
    categories: ["devtools.timeline", "blink.user_timing", "disabled-by-default-devtools.timeline"] });
  const start = params => page.evaluate(params => {
    const turns = window.__typingTurns ??= [], turn = { id: params.session_id, done: false, error: null };
    turns.push(turn);
    void window.__TAURI_INTERNALS__.invoke("agent_ask_text", {
      text: params.text, memberId: params.member_id, requestId: params.session_id,
      ...(params.conversation_id === undefined ? {} : { conversationId: params.conversation_id }),
    }).then(() => { turn.done = true; }, error => { turn.done = true; turn.error = error; });
  }, params);
  const pending = people.slice(1).map(person => start({ session_id: `typing-busy-${person.id}`, text: "[native-typing:busy]", member_id: person.id, source: "app", language: "en" }));
  await page.focus('.composer .cmp-input');
  await page.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes("event") || !PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) throw new Error("Event Timing / long-animation-frame unavailable");
    window.__raphaelConversationProbe.phase = "typing";
    const lag = window.__typingLag = { keys: 0, paint: [], events: [], frames: [], observers: [], start: performance.now() };
    lag.key = event => {
      if (!event.target.matches('.cmp-input')) return;
      const key = { index: lag.keys++, start: performance.now(), firstFrame: null, secondFrame: null };
      lag.paint.push(key);
      requestAnimationFrame(() => {
        key.firstFrame = performance.now();
        requestAnimationFrame(() => { key.secondFrame = performance.now(); });
      });
    };
    document.addEventListener("keydown", lag.key, true);
    const events = new PerformanceObserver(list => { for (const event of list.getEntries()) lag.events.push({ name: event.name, start: event.startTime, duration: event.duration, target: event.target?.className ?? "", delay: event.processingStart - event.startTime, processing: event.processingEnd - event.processingStart }); });
    events.observe({ type: "event", durationThreshold: 16 });
    const frames = new PerformanceObserver(list => { for (const frame of list.getEntries()) lag.frames.push({ start: frame.startTime, duration: frame.duration, scripts: frame.scripts.map(script => ({ functionName: script.sourceFunctionName, url: script.sourceURL, duration: script.duration, invoker: script.invoker })) }); });
    frames.observe({ type: "long-animation-frame" });
    lag.observers.push(events, frames);
  });
  const session = await page.createCDPSession();
  const profileInterval = Number(process.env.RAPHAEL_NATIVE_TYPING_PROFILE_INTERVAL_US ?? 1000);
  if (![1000, 5000].includes(profileInterval)) throw new Error("Typing CPU profile interval must be 1000 or 5000 microseconds");
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: profileInterval });
  await session.send("Profiler.start");
  let profile, lag;
  try {
    // Repeated authored reply bursts use the app's ordinary pacing while seven other fake brains work.
    const conversation = data.conversations.find(row => row.member_id === member.id && row.is_default);
    for (let i = 0; i < 200; i++) {
      if (i % 50 === 0) pending.push(start({ session_id: `typing-stream-${i}`, text: "[native-typing:stream]", member_id: member.id, conversation_id: conversation.id, source: "app", language: "en" }));
      const words = "Typing stays smooth while members work. ";
      await page.keyboard.type(words[i % words.length]);
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally {
    ({ profile } = await session.send("Profiler.stop", {}, { timeout: 30000 }));
    if (tracing) await page.tracing.stop();
    lag = await page.evaluate(() => {
      const lag = window.__typingLag;
      lag.observers.forEach(observer => observer.disconnect());
      document.removeEventListener("keydown", lag.key, true);
      return { keys: lag.keys, paint: lag.paint.filter(key => key.secondFrame !== null), events: lag.events, frames: lag.frames,
        probes: window.__raphaelConversationProbe };
    });
    await session.detach();
    await writeFile(join(artifacts, "typing.cpuprofile"), JSON.stringify(profile));
    await writeFile(join(artifacts, "typing-events.json"), JSON.stringify(lag, null, 2));
    result.typing = typingSummary(lag, profile);
    result.typing.cpuProfileSamplingIntervalUs = profileInterval;
  }
  result.typing.draftLength = await page.$eval('.composer .cmp-input', input => input.value.length);
  result.typingWindow.maximum = await page.evaluate(() => { window.__typingWindow.observer.disconnect(); return window.__typingWindow.maximum; });
  if (result.typingWindow.maximum > 100) result.typing.failures.push(`Mounted ${result.typingWindow.maximum} turns, exceeding 100`);
  await capture("after-typing");
  await Promise.all(pending);
  for (let i = 0; i < 180; i++) {
    result.typing.turns = await page.evaluate(() => window.__typingTurns);
    if (result.typing.turns.every(turn => turn.done)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  result.typing.failures.push(...result.typing.turns.filter(turn => !turn.done || turn.error).map(turn => `Concurrent fake turn failed: ${JSON.stringify(turn)}`));
  result.typing.failures.push(...(result.typing.draftLength !== 200 ? ["Composer draft lost keys"] : []));
  if (result.typing.failures.length) throw new Error(result.typing.failures.join("; "));
}
