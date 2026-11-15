/**
 * The owner reads a member's conversation at its bottom while the member's reply arrives as the core sends it (owner,
 * 2026-11-14: 「成員回覆的時候，有時候畫面會從最底部往上跳一點…完全不要有任何移動」, R-FOLLOW-01). Every frame is sampled at
 * the point it is painted: a ResizeObserver on a 1 px probe that changes size each animation frame is told after layout,
 * after the app's own observers (made before it) and before paint, so it reads what the owner sees, not a state the same
 * frame still corrects. Each frame records how far the thread stands above its bottom (`scrollHeight - scrollTop -
 * clientHeight`) and, when the owner reads higher up, where the line he reads stands.
 *
 *  - `open`: the conversation is opened by its row with the probe already sampling (the first frame it is seen in counts);
 *  - `position`: "bottom" (the owner follows the newest turn), or "up" (he wheeled up to read, with the real mouse: `wheel` px,
 *    by default most of a screen; a few tens of px is still his own place, never pulled back to the bottom);
 *  - `reply`: the reply is played as it arrives: the owner's message sent from the composer (bottom only), the turn starting,
 *    the work line and its words, a short picture strip that comes late (it grows the thread by less than the 80 px band),
 *    the reply's words growing, a large picture the core reads back late, the turn ending (the work
 *    line and the slime go, the composer leaves its running state), the reply settling into its final bubbles (paced), the
 *    member's reaction to the owner's message;
 *  - `settle`: ms watched after the last step.
 *
 * Fails, with every bad frame named by its phase, when a frame stands more than `slack` px above the bottom (bottom) or the
 * read line moved by more than `slack` px (up) while the owner gave no scrolling input. Throws an error carrying `assertion`.
 */
export async function followProbe(page, { selector = ".mb-chat:not([hidden]) .ra-scroll", open, position = "bottom", wheel, reply = true, member = 1, settle = 2600, slack = 1, waitFor } = {}) {
  await page.evaluate(selector => {
    const seen = window.__follow = { frames: [], phase: "open", input: 0, started: performance.now() };
    const tick = document.createElement("div");
    tick.setAttribute("aria-hidden", "true");
    tick.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0;contain:strict";
    document.body.append(tick);
    seen.tick = tick;
    seen.observer = new ResizeObserver(() => {
      const scroller = document.querySelector(selector);
      // Not seen yet: not drawn, held back while it opens (`is-opening`), or empty.
      if (!scroller || !scroller.clientHeight || scroller.classList.contains("is-opening") || getComputedStyle(scroller).visibility === "hidden" || !scroller.querySelector(".tn")) return;
      const frame = { at: Math.round(performance.now() - seen.started), phase: seen.phase, input: seen.input, gap: +(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toFixed(1), top: +scroller.scrollTop.toFixed(1), height: scroller.scrollHeight, client: scroller.clientHeight };
      if (seen.anchor?.isConnected) frame.line = +(seen.anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toFixed(1);
      // How tall each stored picture of the thread stands: one drawn again must not stand empty (the text above it would move).
      frame.pictures = Object.fromEntries([...scroller.querySelectorAll(".thread img[data-attachment]")].map(image => [image.dataset.attachment, Math.round(image.getBoundingClientRect().height)]));
      seen.frames.push(frame);
    });
    seen.observer.observe(tick);
    let flip = false;
    const loop = () => { flip = !flip; tick.style.width = flip ? "2px" : "1px"; seen.raf = requestAnimationFrame(loop); };
    seen.raf = requestAnimationFrame(loop);
    // Scrolling input of the owner's own: a frame after it is his, not the thread's.
    seen.mark = () => { seen.input++; };
    for (const type of ["wheel", "touchstart"]) document.addEventListener(type, seen.mark, { capture: true, passive: true });
  }, selector);
  const phase = name => page.evaluate(name => { window.__follow.phase = name; }, name);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    if (open !== undefined) await page.click(`.mb-col [data-member="${open}"]`);
    await page.waitForSelector(waitFor ?? `${selector} .tn`, { visible: true, timeout: 10000 });
    // The conversation has opened and stands still at its bottom before the owner does anything.
    await page.waitForFunction(selector => {
      const scroller = document.querySelector(selector);
      return scroller && !scroller.classList.contains("is-opening") && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 1;
    }, { timeout: 8000 }, selector);
    if (open !== undefined) await pause(settle);
    if (position === "up") {
      const box = await (await page.$(selector)).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const up = wheel ?? Math.round(box.height * 0.6);
      await page.mouse.wheel({ deltaY: -up });
      // A wheel scrolls smoothly: wait until it rests, then take the line the owner reads (the first turn whose top is in view).
      await page.waitForFunction((selector, up) => {
        const scroller = document.querySelector(selector), seen = window.__follow;
        const still = seen.lastTop === scroller.scrollTop; seen.lastTop = scroller.scrollTop;
        return still && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >= up * 0.8;
      }, { timeout: 4000, polling: 150 }, selector, up);
      await page.evaluate(selector => {
        const scroller = document.querySelector(selector), top = scroller.getBoundingClientRect().top, seen = window.__follow;
        seen.anchor = [...scroller.querySelectorAll(".thread > li")].find(line => line.getBoundingClientRect().top >= top + 8);
        seen.reading = seen.input;
      }, selector);
    }
    await phase("pinned");
    await pause(300);
    if (reply) {
      const step = name => page.evaluate(replyStep, { name, member });
      if (position === "bottom") {
        await phase("send");
        await page.focus(".mb-chat:not([hidden]) .cmp-input");
        await page.keyboard.type("幫我整理這週的會議重點，再附一張示意圖。");
        await page.keyboard.press("Enter");
        await pause(250);
      }
      for (const [name, wait] of [["thinking", 400], ["working", 350], ["progress", 350], ["banner", 200]]) { await phase(name); await step(name); await pause(wait); }
      await phase("words");
      for (let index = 1; index <= 8; index++) { await step(`words:${index}`); await pause(140); }
      await phase("picture"); await step("picture"); await pause(300);
      await phase("done"); await step("done"); await pause(400);
      await phase("reaction"); await step("reaction");
    }
    await phase("settle");
    await pause(settle);
    const frames = await page.evaluate(() => {
      const seen = window.__follow;
      cancelAnimationFrame(seen.raf); seen.observer.disconnect(); seen.tick.remove();
      for (const type of ["wheel", "touchstart"]) document.removeEventListener(type, seen.mark, { capture: true });
      return seen.frames.map(frame => ({ ...frame, input: frame.input - (seen.reading ?? 0) }));
    });
    const result = judgeFollow(frames, { position, slack, opening: open !== undefined });
    if (result.failures.length) {
      const error = new Error(`The thread moved while the owner read it ${position === "up" ? "higher up" : "at its bottom"}: ${result.failures.join("; ")} | ${JSON.stringify(result.summary)}`);
      error.assertion = result; throw error;
    }
    return result;
  } finally {
    await page.evaluate(() => { const seen = window.__follow; if (seen) { cancelAnimationFrame(seen.raf); seen.observer?.disconnect(); seen.tick?.remove(); } }).catch(() => {});
  }
}

/**
 * Which frames the owner saw move: at the bottom, a frame above it by more than `slack`; reading higher up, a frame whose
 * read line stands elsewhere than in the first sampled frame. Frames after a scrolling input of the owner's are his own.
 * Bad frames are grouped by phase, with their count, the largest distance and the first time, so a report says what moved.
 */
export function judgeFollow(frames, { position = "bottom", slack = 1, opening = false } = {}) {
  // The frames before the owner's place is set (the scene's start, the wheel up) count only when the opening itself is watched.
  const watched = frames.filter(frame => (frame.phase !== "open" || (opening && position === "bottom")) && !frame.input);
  const first = watched.find(frame => frame.line !== undefined);
  const off = frame => position === "up" ? (frame.line === undefined || first === undefined ? 0 : Math.abs(frame.line - first.line)) : frame.gap;
  const bad = watched.filter(frame => off(frame) > slack);
  const phases = {};
  for (const frame of bad) {
    const entry = phases[frame.phase] ??= { frames: 0, worstPx: 0, firstAtMs: frame.at };
    entry.frames++; entry.worstPx = Math.max(entry.worstPx, +off(frame).toFixed(1));
  }
  const failures = watched.length ? Object.entries(phases).map(([name, entry]) => `${name}: ${entry.frames} frame(s) ${position === "up" ? "moved" : "above the bottom"}, up to ${entry.worstPx}px from ${entry.firstAtMs}ms`) : ["no frame of the thread was seen"];
  // A picture that stands shorter than it already stood (empty while its bytes decode, or its line drawn again and the picture
  // standing empty or as its name until it is loaded once more): what is above it moves down, then up. A picture only grows.
  const drawn = new Map(), blinks = {};
  for (const frame of position === "bottom" ? watched : []) for (const [id, height] of Object.entries(frame.pictures ?? {})) {
    const tallest = drawn.get(id) ?? 0;
    if (height < tallest - 1) { const entry = blinks[frame.phase] ??= { frames: 0, worstPx: 0, firstAtMs: frame.at }; entry.frames++; entry.worstPx = Math.max(entry.worstPx, tallest - height); }
    drawn.set(id, Math.max(tallest, height));
  }
  for (const [name, entry] of Object.entries(blinks)) failures.push(`${name}: a picture already drawn stood shorter in ${entry.frames} frame(s), by up to ${entry.worstPx}px, from ${entry.firstAtMs}ms`);
  if (position === "up" && first === undefined && watched.length) failures.push("the line the owner read was not found");
  const last = watched.at(-1);
  return { check: "follow-probe", position, slack, failures, badSamples: bad.slice(0, 24),
    summary: { frames: watched.length, badFrames: bad.length, worstPx: +Math.max(0, ...bad.map(off)).toFixed(1), endGap: last?.gap, phases, blinks } };
}

/** One step of the member's reply, as the core writes it and tells the window (runs in the page, with the mock's data). */
function replyStep({ name, member }) {
  const look = window.__look, data = look.data, emit = look.emit;
  const seen = window.__followReply ??= {};
  const words = ["好的，這週的會議重點整理如下：", "一、產品時程維持不變，下週三前完成測試版。", "二、設計稿再調整一次首頁的版面與字級。", "三、客服流程改成先分類再回覆，減少重複回答。",
    "四、行銷活動延後一週，等測試版穩定後再開始。", "五、下次會議請大家先看過這份整理，帶著問題來。", "示意圖附在下面，標出了每一項的負責人。", "有需要再調整的地方告訴我。"];
  const picture = { id: `${"c".repeat(32)}.png`, name: "會議重點示意圖.png", mime: "image/png", size: 52114 };
  // A short strip of a picture: when it comes it grows the thread by less than the 80 px a thread still counts as "near its bottom".
  const banner = { id: `${"d".repeat(32)}.png`, name: "本週進度條.png", mime: "image/png", size: 3120 };
  const now = Date.now();
  if (name === "thinking") {
    const base = data.turns.findLast(turn => turn.member_id === member && turn.status === "done") ?? data.turns.at(-1);
    // The call's arguments are recorded beside its name (mock-ipc.js `invoke`): the turn is the one the owner's message asked for.
    const requestId = look.calls.findLast(call => call.command === "agent_ask_text")?.requestId;
    seen.turn = { ...structuredClone(base), id: 400000, member_id: member, status: "running", route: "answer", source: "app", prefix: "", text: "", detail: null, steps: [], messages: [], task: null,
      attachments: [], reactions: {}, pages: [], question: requestId ? "幫我整理這週的會議重點，再附一張示意圖。" : "", session_id: requestId ?? "follow-probe", created_at_ms: now };
    data.turns.push(seen.turn);
    emit({ type: "MemberActivity", member_id: member, state: "thinking" });
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
  } else if (name === "working") {
    emit({ type: "MemberActivity", member_id: member, state: "working", label: "讀取會議紀錄" });
    seen.turn.steps.push({ kind: "tool", tool: "read_file", server: "Raphael", outcome: "ok", ms: 120, at_ms: now });
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
  } else if (name === "progress") {
    seen.turn.messages.push({ seq: seen.turn.messages.length + 1, kind: "progress", text: "正在比對三份會議紀錄", at_ms: now });
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
  } else if (name === "banner") {
    seen.turn.messages.push({ seq: seen.turn.messages.length + 1, kind: "media", text: JSON.stringify({ attachment: banner }), at_ms: now });
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
  } else if (name.startsWith("words:")) {
    // The reply's words come in as the model writes them: the turn's text grows, one sentence at a time.
    seen.turn.text = words.slice(0, Number(name.slice(6))).join("\n\n");
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
  } else if (name === "picture") {
    seen.turn.messages.push({ seq: seen.turn.messages.length + 1, kind: "media", text: JSON.stringify({ attachment: picture }), at_ms: now });
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
  } else if (name === "done") {
    // The reply settles into its bubbles: the words become reply messages (more than one at once, so they are paced in).
    const replies = [words.slice(0, 3).join("\n\n"), words.slice(3, 6).join("\n\n"), words.slice(6).join("\n\n")];
    for (const text of replies) seen.turn.messages.push({ seq: seen.turn.messages.length + 1, kind: "reply", text, at_ms: now });
    Object.assign(seen.turn, { status: "done", prefix: "答", text: words.join("\n\n") });
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
    emit({ type: "MemberActivity", member_id: member, state: "done" });
    emit({ type: "MembersChanged" });
    look.answerAsk?.();
  } else if (name === "reaction") {
    seen.turn.reactions = { owner: ["👍"] };
    emit({ type: "AgentTurn", turn_id: seen.turn.id, member_id: member });
  }
}
