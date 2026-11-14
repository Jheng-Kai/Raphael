/** No new core call for this long before the send: the window's start-up reads are done. */
export const QUIET_BEFORE_SEND_MS = 500;
const QUIET_WAIT_MS = 8000;

/** Press Enter on the real composer while the fake core publishes an ordinary turn, and time what the owner feels. */
export async function sendProbe(page, { selector = ".mb-chat:not([hidden]) .cmp-input", memberId = 0, seconds = 6, throttle = 1, limits = {} } = {}) {
  const client = await page.createCDPSession();
  await client.send("Performance.enable");
  if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const read = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  // The window's optional reads start once the first view is answered (startup-reads.ts) and run one at a time; on a busy machine
  // they used to land inside the measured send and count as its reads (43 against 27 on the same code). Measure from a quiet core.
  await page.waitForFunction(quietMs => {
    const look = window.__look, now = performance.now();
    if (look.quietCalls !== look.calls.length) { look.quietCalls = look.calls.length; look.quietSince = now; }
    return now - look.quietSince >= quietMs;
  }, { polling: 50, timeout: QUIET_WAIT_MS }, QUIET_BEFORE_SEND_MS).catch(() => { /* A core that never goes quiet is measured as it is. */ });
  await page.focus(selector);
  await page.keyboard.type("Sample question");
  await page.evaluate(selector => {
    const seen = window.__send = { longTasks: [], keyMs: [], calls: window.__look.calls.length, startedMs: performance.now() };
    seen.tasks = new PerformanceObserver(list => { for (const entry of list.getEntries()) seen.longTasks.push({ atMs: Math.round(entry.startTime - seen.startedMs), ms: Math.round(entry.duration) }); });
    seen.tasks.observe({ entryTypes: ["longtask"] });
    seen.listener = event => {
      if (!event.target.matches(selector)) return;
      const pressed = performance.now(), enter = event.key === "Enter";
      seen.keyPaint = new Promise(resolve => requestAnimationFrame(() => {
        // The task after this frame's callback runs once style, layout and paint of the frame are done.
        const after = new MessageChannel();
        after.port1.onmessage = () => {
          const duration = performance.now() - pressed;
          if (enter) { seen.enterMs = duration; seen.bubbleShown = !!document.querySelector('.mb-chat:not([hidden]) [data-key^="out:"]'); seen.cleared = event.target.value === ""; }
          else seen.keyMs.push(duration);
          resolve();
        };
        after.port2.postMessage(0);
      }));
    };
    document.addEventListener("keydown", seen.listener, true);
  }, selector);
  const before = await read(), began = Date.now();
  await page.keyboard.press("Enter");
  const publish = step => page.evaluate(({ step, memberId }) => {
    const data = window.__look.data, seen = window.__send, emit = window.__look.emit;
    if (step === "thinking") {
      const source = data.turns.findLast(turn => turn.member_id === memberId && turn.status === "done") ?? data.turns.at(-1);
      seen.turn = { ...structuredClone(source), id: 300000, member_id: memberId, status: "running", text: "", steps: [], messages: [], task: null, question: "Sample question", session_id: window.__look.calls.findLast(call => call.command === "agent_ask_text")?.args?.requestId ?? "send-probe", created_at_ms: Date.now() };
      data.turns.push(seen.turn);
      emit({ type: "MemberActivity", member_id: memberId, state: "thinking" });
      emit({ type: "AgentTurn", turn_id: 300000, member_id: memberId });
    } else if (step === "working") {
      emit({ type: "MemberActivity", member_id: memberId, state: "working", label: "Reading sample.md" });
    } else if (step.startsWith("tool")) {
      seen.turn.steps.push({ kind: "tool", tool: "read_file", server: "Raphael", outcome: "ok", ms: 120, at_ms: Date.now() });
      seen.turn.messages.push({ seq: seen.turn.messages.length + 1, kind: "progress", text: `Checking sample ${step}`, at_ms: Date.now() });
      emit({ type: "AgentTurn", turn_id: 300000, member_id: memberId });
    } else if (step === "done") {
      Object.assign(seen.turn, { status: "done", prefix: "答", text: "Sample answer." });
      seen.turn.messages.push({ seq: seen.turn.messages.length + 1, kind: "reply", text: "Sample answer.", at_ms: Date.now() });
      emit({ type: "AgentTurn", turn_id: 300000, member_id: memberId });
      emit({ type: "MemberActivity", member_id: memberId, state: "done" });
      emit({ type: "MembersChanged" });
      window.__look.answerAsk?.();
    }
  }, { step, memberId });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  await pause(100); await publish("thinking");
  await pause(400); await publish("working");
  for (let index = 0; index < Math.max(1, seconds - 2); index++) {
    await pause(500); await publish(`tool ${index}`);
    await page.keyboard.type("a");
    await page.evaluate(() => window.__send.keyPaint);
    await pause(500);
  }
  await publish("done");
  await pause(600);
  const after = await read(), elapsed = (Date.now() - began) / 1000;
  const seen = await page.evaluate(() => {
    const seen = window.__send;
    seen.tasks.disconnect(); document.removeEventListener("keydown", seen.listener, true);
    const calls = window.__look.calls.slice(seen.calls).map(call => call.method ?? call.command);
    return { enterMs: seen.enterMs, bubbleShown: seen.bubbleShown, cleared: seen.cleared, keyMs: seen.keyMs, longTasks: seen.longTasks, allReads: calls.length,
      reads: Object.fromEntries([...new Set(calls)].sort().map(name => [name, calls.filter(method => method === name).length])) };
  });
  if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await client.detach();
  const result = { check: "send-probe", throttle, enterMs: Math.round(seen.enterMs ?? -1), bubbleShown: seen.bubbleShown, cleared: seen.cleared,
    keySlowestMs: Math.round(Math.max(0, ...seen.keyMs)), keySamples: seen.keyMs.length, longestTaskMs: Math.max(0, ...seen.longTasks.map(task => task.ms)), longTasks: seen.longTasks,
    mainThreadPct: +((after.TaskDuration - before.TaskDuration) / elapsed * 100).toFixed(1), stylePct: +((after.RecalcStyleDuration - before.RecalcStyleDuration) / elapsed * 100).toFixed(1),
    layoutPct: +((after.LayoutDuration - before.LayoutDuration) / elapsed * 100).toFixed(1), scriptPct: +((after.ScriptDuration - before.ScriptDuration) / elapsed * 100).toFixed(1),
    allReads: seen.allReads, reads: seen.reads, heapMB: +(after.JSHeapUsedSize / 1e6).toFixed(1), nodes: after.Nodes, seconds: +elapsed.toFixed(1) };
  const over = Object.entries(limits).filter(([name, limit]) => result[name] > limit).map(([name, limit]) => `${name} ${result[name]} > ${limit}`);
  if (result.enterMs < 0 || !result.cleared || !result.bubbleShown) over.push("Enter did not put the message on screen and empty the field");
  if (over.length) { const error = new Error(`Sending a prompt stalls the page: ${over.join(", ")} | ${JSON.stringify(result)}`); error.assertion = result; throw error; }
  return result;
}
