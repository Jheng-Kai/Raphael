import { perform, pressInFrame } from "../driver.mjs";
import { checkRendered } from "../checks.mjs";
import { deletionAudit, privateTimeline } from "./deletion-audit.mjs";
import { idleCost, slimeSharp } from "../slime-board.mjs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { typingJourney } from "./typing.mjs";

export const journeys = [
  { name: "computer-speed", description: "Five warm first observations, browser opens and five-step forms; isolated disposable container, median/worst budgets, no paid model" },
  { name: "typing", description: "200 human-paced keys on 150 persisted rich turns with concurrent offline brains; Event Timing, long frames and CPU profile" },
  { name: "appearance", description: "Real Appearance dropdown, theme persistence and narrow rows at three native sizes" },
  { name: "owner-face", description: "A window that may load before the core still hears it: a saved owner photo reaches the sidebar" },
  { name: "sidebar-home", description: "Inspect the Grok-style sidebar, in-place search and Home emblem in the real WebView" },
  { name: "rich-content", description: "Persisted rich reply renders tables, highlighted code and SVG; remote images require consent" },
  { name: "owner-round10", description: "Native learned batch Undo, hover/expiry, passive window and stable conversation controls" },
  { name: "home-timing", description: "Measure first painted Home against a two-second offline CLI allowance read" },
  { name: "hidden-window", description: "Close to tray and minimize suspend page timers; returning catches up a fake reply completed while hidden" },
  { name: "startup-rooms", description: "Ten normal and ten slow-core owner-path launches keep seeded group chats in the sidebar, without a page reload" },
  { name: "model-sync", description: "The real core and the real Codex CLI: its models reach the composer, a choice and a depth reach Settings, a change reaches the composer, and a turn runs on it" },
  { name: "owner-words", description: "The real core and the real Codex CLI, on what the owner really asks: an event goes on today's calendar, and a question about this PC's CPU runs read-only commands after the card" },
  { name: "office-mission", description: "The acceptance test, on the real Codex and real computers: the owner asks for a 3D office, Raphael plans roles, makes the team and hands out the work, and they finish it" },
  { name: "member-job", description: "The real core and the real Codex CLI: a member made with only a name speaks first, and the owner's answer becomes its job" },
  { name: "pages", description: "A stored page from the core's real host under the real CSP: isolated, speaks only on a real press, survives a redraw, expands, follows the theme, comes back after a reload" },
  { name: "model-picker", description: "Real public OpenRouter catalog, real picker/settings/member persistence and fake next-turn provider metadata" },
  { name: "skill-growth", description: "Learn after ten real tool calls, then read the skill on the next similar task" },
  { name: "memory-growth", description: "Recall a turn-one fact on turn twenty-five and inspect the member-written home" },
  { name: "bot-homes", description: "Migrate three copied notes and an imported skill, then answer with an offline Codex child" },
  { name: "upgrade", description: "A copy of an older data folder (RAPHAEL_NATIVE_UPGRADE_FROM) opens on this build with the fake brain: its people, conversations and every settings pane" },
  { name: "member-computer", description: "Docker desktop with fake brain, real MCP screenshot, exec, attachment and noVNC; no host desktop actions" },
  { name: "readable-layout", description: "Inspect the shared sidebar, aligned details and compact drawer in the real WebView" },
  { name: "slime-sharp", description: "Twelve slimes in the real sidebar: moving, each paints the pixels of its pose held still, and what they cost while idle" },
  { name: "locale-sweep", description: "Switch every locale and visit main pages and settings" },
  { name: "voice-conversation", description: "Speak into a newly created conversation and inspect persistence" },
  { name: "voice-call", description: "Real shell admission, empty-member entry, draft guard and missing-voice repair without paid speech" },
  { name: "voice-keys", description: "The real worker: after the composer's microphone the dictation key works during the answer, one Esc ends it, the recognising light shows, and a slow brain at high depth finishes" },
  { name: "long-think", description: "The real core: a model that thinks past the old 60 second deadline finishes its turn, and the answer reaches the window" },
  { name: "every-source", description: "One real turn on every signed-in CLI: Claude Code, Codex, Antigravity, with Claude's models as the CLI lists them" },
  { name: "openrouter-turn", description: "One real turn through the owner's OpenRouter key on a free model: no other paid request" },
  { name: "delete-conversation", description: "Delete conversations/member after real exchanges and room reports; detect stale timeline rows" },
  { name: "gmail-connect", description: "Owner-only Composio card sign-in; stop before approving Google consent" },
  { name: "self-diagnosis", description: "Force an offline connection card failure; the same member checks and explains the real reason" },
  { name: "calendar", description: "The real core and SQLite: the owner makes, moves and removes an event on the Calendar page, a member told 加到今天的行程 adds one with the real tool, and Home draws them" },
  { name: "store-finder", description: "Real Composio catalog: measure all-app paint, DOM size and long tasks" },
  { name: "catalog-connect", description: "Raphael and member find/connect a non-Gmail catalog app; stop before consent" },
];
const click = (page, selector) => perform(page, { action: "click", selector });
const wait = (page, selector) => perform(page, { action: "wait", selector });
const type = (page, selector, text) => perform(page, { action: "type", selector, text });
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function nativeLaunches(selected) {
  return selected.flatMap(journey => journey.name !== "startup-rooms" ? [journey] :
    ["normal", "slow"].flatMap(variant => Array.from({ length: 10 }, (_, i) => ({
      ...journey, id: `startup-rooms-${variant}-${i + 1}`, startup: { variant, attempt: i + 1, delayMs: variant === "slow" ? 3000 : 0 },
    }))));
}

export function startupEvidence(log, probe) {
  const events = log.split(/\r?\n/).flatMap(line => {
    const value = line.split("native startup: ")[1];
    return value ? [JSON.parse(value)] : [];
  });
  const firstShowAt = events.find(event => event.event === "first_show")?.at;
  const firstShow = events.findIndex(event => event.event === "first_show");
  const beforeShow = index => firstShow < 0 || index < firstShow;
  return { events, firstShowAt, coreHelloAt: events.find(event => event.event === "core_hello")?.at,
    suspendRequestedBeforeFirstShow: events.some((event, index) => event.event === "suspend_requested" && beforeShow(index)),
    suspendedBeforeFirstShow: events.some((event, index) => event.event === "suspend_completed" && beforeShow(index)),
    hiddenBeforeFirstShow: !probe ? null : probe.visibility.some(event => event.state === "hidden" && (!firstShowAt || event.at < firstShowAt))
      ? true : firstShowAt && probe.startedAt <= firstShowAt ? false : null,
    coreReadyAt: probe?.coreReady[0] ?? null };
}

export function assertWindowSlept({ ticks, hiddenAt, showAt }) {
  // Allow the asynchronous TrySuspend transition, then observe six full seconds.
  const from = hiddenAt + 1500;
  if (showAt - from < 6000) throw new Error("Hidden counter observation was shorter than six seconds");
  const before = ticks.filter(at => at < from).length;
  const after = ticks.filter(at => at < showAt).length;
  if (after !== before) throw new Error(`Hidden page counter advanced by ${after - before}; timers were throttled, not suspended`);
  return { from, to: showAt, before, after };
}

export async function forwardMainWindow(wakePage) {
  if (!/\/learned\.html(?:[?#]|$)/.test(wakePage.url())) throw new Error("Window wake must use the never-suspended learned page");
  const session = await wakePage.createCDPSession();
  try {
    const wake = await session.send("Runtime.evaluate", {
      expression: 'window.__TAURI_INTERNALS__.invoke("main_window_forward")', awaitPromise: true, timeout: 3000,
    }, { timeout: 3000 });
    if (wake.exceptionDetails) throw new Error(JSON.stringify(wake.exceptionDetails));
  } catch (error) {
    throw new Error(`Learned page could not wake the main window: ${error.message}`, { cause: error });
  } finally { await session.detach(); }
}

/** The window runs beside whatever the owner is doing on this PC: their taking the focus is not what a journey tests. */
async function keepFocus(page) {
  const session = await page.createCDPSession();
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
}

async function details(page) {
  if (await page.$('.conversation-trigger[aria-expanded="false"]')) await click(page, ".conversation-trigger");
  for (let back; (back = await page.$('.mb-det [data-det="back"]:not([hidden])')); await pause(50)) { await back.click(); await back.dispose(); }
  await wait(page, "[data-conversation-new]");
}
async function chat(page) {
  await click(page, '.mb-chief');
  await wait(page, ".composer .cmp-input");
}
async function newConversation(context, member = 0) {
  await chat(context.page);
  if (member !== 0) {
    await perform(context.page, { action: "member", id: member });
    await wait(context.page, ".composer .cmp-input");
  }
  await details(context.page);
  const rows = (await context.snapshot()).conversations, before = new Set(rows.map(row => row.id));
  // One nobody has written in is already new: the button rests on it, or goes to it.
  const unwritten = rows.find(row => row.member_id === member && !row.title && row.kind !== "quick");
  if (!await context.page.$eval("[data-conversation-new]", button => button.disabled)) await click(context.page, "[data-conversation-new]");
  if (unwritten) { await wait(context.page, ".cmp-input"); return unwritten.id; }
  for (let i = 0; i < 80; i++) {
    const created = (await context.snapshot()).conversations.find(row => !before.has(row.id) && row.kind !== "quick");
    if (created) { await wait(context.page, ".cmp-input"); return created.id; }
    await pause(100);
  }
  throw new Error("New conversation did not persist");
}
async function typed(context, text, conversation) {
  await type(context.page, ".composer .cmp-input", text); await click(context.page, ".cmp-send");
  for (let i = 0; i < 120; i++) {
    const rows = (await context.snapshot()).agent_turns;
    if (rows.some(row => row.conversation_id === conversation && row.question === text && row.status === "done")) return;
    await pause(150);
  }
  throw new Error(`Typed turn did not finish in conversation ${conversation}: ${text}`);
}

// Inspect visible UI text nodes and field labels, retaining exact offending elements.
export function wrongLanguage(locale, otherPhrases, deviceNames = []) {
  const violations = [];
  const knownNames = [...new Set(deviceNames.flatMap(name => [name, name.split(" (")[0]]))].sort((a, b) => b.length - a.length);
  const inspect = (element, text, attribute = "text") => {
    if (!text.trim() || !element.getBoundingClientRect().width || !element.checkVisibility({ checkVisibilityCSS: true })) return;
    if (element.closest('script,style,textarea,.chat-message,.bubble,[contenteditable],.lm-name,.mc-name')) return;
    if (text.trim() === "Raphael") return;
    // Device names come from the OS, but surrounding application labels must still translate.
    let checked = text;
    if (element.closest('[data-k="mic"], [data-ob="mic"], .mic-ctl')) {
      // Closed controls abbreviate an OS name to its kind before the device parentheses.
      // Match only known device text; the application's Automatic/Disconnected wording stays checked.
      for (const name of knownNames) checked = checked.split(name).join("");
    }
    const wrong = locale === "en" ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(checked) :
      locale === "zh-TW" ? /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(checked) : false;
    if (wrong || otherPhrases.includes(checked.trim())) violations.push({ tag: element.tagName, id: element.id, class: element.className, attribute, text: text.trim() });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) inspect(walker.currentNode.parentElement, walker.currentNode.textContent);
  for (const element of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
    for (const attribute of ["placeholder", "aria-label", "title"]) inspect(element, element.getAttribute(attribute) || "", attribute);
  }
  // The language selector deliberately names all available languages in their own scripts.
  return violations.filter(item => !/^(繁體中文|日本語|English)$/.test(item.text));
}

export async function drive(name, context) {
  const { page, result, capture, snapshot, phrases } = context;
  if (name === "typing") return typingJourney(context);
  if (name === "startup-rooms") {
    const expected = (await snapshot()).rooms.filter(room => room.name.startsWith("Startup room "));
    if (expected.length !== 3 || expected.some(room => room.hidden)) throw new Error("Startup fixture needs three visible persisted rooms");
    result.startup.expected = expected.map(room => ({ id: room.id, name: room.name }));
    for (let i = 0; i < 300; i++) {
      result.startup.evidence = startupEvidence(await context.nativeLog());
      if (result.startup.evidence.coreHelloAt && result.startup.evidence.firstShowAt) break;
      await pause(200);
    }
    if (!result.startup.evidence.coreHelloAt || !result.startup.evidence.firstShowAt) throw new Error("Startup never reached its normal first show and core hello; inspect native startup trace");
    const state = await context.windowAction("state");
    if (!state.visible || state.minimized) throw new Error("Owner-path startup did not show the main window");
    try {
      await page.waitForFunction(rooms => rooms.every(room => {
        const row = document.querySelector(`.au-rooms-section [data-room="${room.id}"]`);
        return row?.checkVisibility() && row.querySelector('b')?.textContent === room.name;
      }), { timeout: 5000, polling: 100 }, result.startup.expected);
    } finally {
      result.startup.probe = await page.evaluate(() => window.__nativeStartup);
      result.startup.evidence = startupEvidence(await context.nativeLog(), result.startup.probe);
    }
    if (!result.startup.probe) throw new Error("Startup probe is missing; rebuild the instrumented debug shell");
    const painted = result.startup.probe.rows.find(sample => result.startup.expected.every(room => sample.rows.some(row => row.id === room.id && row.name === room.name)));
    result.startup.roomsAfterReadyMs = painted?.at - Math.max(result.startup.evidence.firstShowAt, result.startup.evidence.coreHelloAt);
    if (!painted || result.startup.roomsAfterReadyMs > 5000) throw new Error("Seeded rooms did not paint within five seconds of first show and core readiness");
    if (result.startup.probe.errors.length) throw new Error(`Startup runtime errors: ${JSON.stringify(result.startup.probe.errors)}`);
    await capture("rooms-visible");
    return;
  }
  if (name === "hidden-window") {
    const { member } = await context.rpc("members.create", { name: "Window sleeper", role: "Offline suspension check" });
    const conversation = await newConversation(context, member.id);
    await typed(context, "Visible baseline before the window sleeps", conversation);
    result.windowSleep = { member: member.id, conversation, before: await snapshot(), cycles: [], visibilityLog: [] };
    let wakePage;
    for (let i = 0; i < 30 && !wakePage; i++) {
      wakePage = await context.learnedPage();
      if (!wakePage) await pause(100);
    }
    if (!wakePage) throw new Error("Never-suspended learned page is missing; cannot wake the main window");
    await wakePage.waitForFunction(() => typeof window.__TAURI_INTERNALS__?.invoke === "function", { timeout: 3000 });
    result.windowSleep.wakeUrl = wakePage.url();
    const logVisibility = message => {
      if (/^main page: document (hidden|visible)$/.test(message.text())) result.windowSleep.visibilityLog.push(message.text());
    };
    page.on("console", logVisibility);
    try {
      for (const action of ["close", "minimize"]) {
        const cycle = { action, visibilityLogStart: result.windowSleep.visibilityLog.length };
        result.windowSleep.cycles.push(cycle);
        await page.evaluate(() => {
          window.__nativeWindowProbe = { ticks: [] };
          // Deliberately unconditional: a visibility-gated counter cannot prove suspension.
          window.__nativeWindowProbe.timer = setInterval(() => window.__nativeWindowProbe.ticks.push(Date.now()), 100);
        });
        await pause(350);
        cycle.before = await page.evaluate(() => ({ count: window.__nativeWindowProbe.ticks.length, visibility: document.visibilityState }));
        if (cycle.before.count < 2 || cycle.before.visibility !== "visible") throw new Error("The visible page counter was not running");
        await capture(`${action}-before`);
        const question = `Offline reply completed while ${action} hides the window`;
        // Start the existing typed RPC while visible; the fake brain waits four seconds in the core.
        // No page evaluation, animation-frame wait or screenshot may wake it during the hidden dwell.
        await page.evaluate(({ text, memberId, conversationId }) => {
          void window.__TAURI_INTERNALS__.invoke("agent_ask_text", { text, memberId, conversationId })
            .catch(error => console.error(`Hidden-window typed turn: ${error}`));
        }, { text: question, memberId: member.id, conversationId: conversation });
        cycle.hiddenWindow = await context.windowAction(action);
        cycle.hiddenAt = Date.now();
        const pending = (await snapshot()).agent_turns.find(turn => turn.conversation_id === conversation && turn.question === question);
        if (pending && pending.status !== "running") throw new Error("The fake reply finished before the window was hidden");
        await pause(7600);
        for (let i = 0; i < 100; i++) {
          cycle.reply = (await snapshot()).agent_turns.find(turn => turn.conversation_id === conversation && turn.question === question && turn.status === "done");
          if (cycle.reply) break;
          await pause(100);
        }
        if (!cycle.reply?.text.trim() || cycle.reply.member_id !== member.id || cycle.reply.cost_usd !== 0) throw new Error("No zero-cost member reply completed while hidden");
        cycle.completedWhileHiddenAt = Date.now();
        cycle.stillHidden = await context.windowAction("state");
        if (action === "close" ? cycle.stillHidden.visible : !cycle.stillHidden.minimized) throw new Error("The window returned before its hidden reply was stored");
        cycle.showAt = Date.now();
        // Only the never-suspended learned page invokes the tray's shared Resume/show/restore path.
        await forwardMainWindow(wakePage);
        cycle.shownWindow = await context.windowAction("state");
        if (!cycle.shownWindow.visible || cycle.shownWindow.minimized) throw new Error("The main window did not return visible and restored");
        const wakeCount = await page.evaluate(() => window.__nativeWindowProbe.ticks.length);
        await page.waitForFunction(count => !document.hidden && window.__nativeWindowProbe.ticks.length > count,
          { timeout: 3000, polling: 50 }, wakeCount);
        cycle.awakeMs = Date.now() - cycle.showAt;
        if (cycle.awakeMs > 3000) throw new Error(`Page did not answer within three seconds of showing: ${cycle.awakeMs} ms`);
        cycle.after = await page.evaluate(() => ({ ticks: window.__nativeWindowProbe.ticks, visibility: document.visibilityState }));
        cycle.counter = assertWindowSlept({ ticks: cycle.after.ticks, hiddenAt: cycle.hiddenAt, showAt: cycle.showAt });
        let replyText = cycle.reply.text;
        try { replyText = JSON.parse(replyText).text ?? replyText; } catch { /* Plain stored replies need no decoding. */ }
        await page.waitForFunction(({ id, text }) => {
          const reply = document.querySelector(`.tn[data-id="${id}"] .ra`);
          if (!reply?.innerText.replace(/\s+/g, " ").includes(text.replace(/\s+/g, " "))) return false;
          const rect = reply.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0;
        }, { timeout: 3000 }, { id: cycle.reply.id, text: replyText });
        cycle.visibilityLog = result.windowSleep.visibilityLog.slice(cycle.visibilityLogStart);
        if (cycle.visibilityLog.indexOf("main page: document hidden") < 0 ||
            cycle.visibilityLog.indexOf("main page: document visible") <= cycle.visibilityLog.indexOf("main page: document hidden")) throw new Error("Main page did not log hidden then visible");
        await capture(`${action}-returned`);
        await page.evaluate(() => clearInterval(window.__nativeWindowProbe.timer));
      }
      if (result.runtimeErrors.length) throw new Error("Hidden-window journey collected runtime errors");
    } finally {
      page.off("console", logVisibility);
    }
    return;
  }
  if (name === "appearance") {
    await click(page, '#nav [data-go="settings"]');
    await click(page, '.modal-scrim [data-pane="appearance"]');
    await wait(page, '.appearance-settings');
    result.appearance = [];
    for (const width of [1120, 720, 1920]) {
      await page.setViewport({ width, height: width === 1920 ? 1080 : 900 });
      for (const value of ['light', 'dark']) {
        await click(page, '[data-k="appearance"]');
        await wait(page, '.menu [data-value="dark"]');
        result.appearance.push(await page.evaluate(checkRendered, 'appearance-settings'));
        await click(page, `.menu [data-value="${value}"]`);
        await page.waitForFunction(value => document.documentElement.dataset.theme === value, {}, value);
        await capture(`${value}-${width}`);
      }
    }
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('.page-home:not([hidden]) .ho-hero');
    await page.waitForSelector(':root[data-theme="dark"]');
    await capture('dark-restored');
    return;
  }
  if (name === "owner-face") {
    await context.rpc("settings.set", { key: "owner_photo", value: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA" });
    await page.waitForSelector('.sidebar-account .owner-face img', { timeout: 15000 });
    await capture("owner-face");
    result.face = true;
    return;
  }
  if (name === "sidebar-home") {
    result.layout = [];
    for (const width of [1120, 720, 1920]) {
      await page.setViewport({ width, height: width === 1920 ? 1080 : 900 });
      await pause(250);
      result.layout.push(await page.evaluate(checkRendered, "home-hero"));
      if (width === 720) { await click(page, '[data-sidebar="open"]'); await pause(300); }
      result.layout.push(await page.evaluate(checkRendered, "sidebar-shell"));
      await page.evaluate(checkRendered, "sidebar-search-before");
      await click(page, '.mb-find-input');
      result.layout.push(await page.evaluate(checkRendered, "sidebar-search-open"));
      await capture(`home-sidebar-${width}`);
      if (width === 720) await click(page, '.sidebar-scrim');
    }
    return;
  }
  if (name === "rich-content") {
    await chat(page);
    result.richContent = [];
    const code = '.message-code:not(.message-diagram)', diagram = '.message-diagram[data-diagram-state="rendered"]';
    await wait(page, '.message-table');
    await perform(page, { action: "scroll", selector: code });
    await wait(page, '.message-code[data-highlighted="true"]');
    await perform(page, { action: "scroll", selector: '.message-diagram' });
    await wait(page, diagram);
    for (const [width, height] of [[1120, 900], [720, 900], [1920, 1080]]) {
      await page.setViewport({ width, height });
      for (const [label, selector, check] of [["table", '.message-table', 'rich-content'], ["code", code, 'rich-code'], ["diagram", diagram, 'rich-diagram'], ["image-consent", '.message-image', 'rich-image']]) {
        await perform(page, { action: "scroll", selector });
        result.richContent.push(await page.evaluate(checkRendered, check));
        await capture(`${label}-${width}`);
      }
    }
    await click(page, `${diagram} [data-rich-act="view-source"]`);
    result.richContent.push(await page.evaluate(checkRendered, "rich-source")); await capture("source");
    await click(page, `${diagram} [data-rich-act="expand"]`); await wait(page, '.rich-view-dialog svg');
    result.richContent.push(await page.evaluate(checkRendered, "rich-expand")); await capture("expanded");
    result.stored = (await snapshot()).agent_turns.filter(turn => turn.session_id === "native-rich-content");
    if (result.stored.length !== 1 || !result.stored[0].text.includes('```mermaid')) throw new Error("Rich reply source was not persisted intact");
    return;
  }
  if (name === "home-timing") {
    await page.waitForFunction(() => window.__homeTiming?.firstPaintMs !== null);
    result.homeTiming = await page.evaluate(() => window.__homeTiming);
    await capture("first-paint");
    await page.waitForFunction(() => document.querySelector('.ho-allowance')?.textContent.includes('40%'), { timeout: 15000 });
    result.homeTiming.liveVisibleMs = await page.evaluate(() => performance.now());
    await capture("live-allowance");
    if (result.homeTiming.firstPaintMs >= 1500) throw new Error(`Home waited for CLI allowances: ${result.homeTiming.firstPaintMs.toFixed(1)} ms`);
    if (!result.homeTiming.firstAllowance?.includes('25%')) throw new Error("Home did not first paint the stored allowance before the live 40% window");
    return;
  }
  if (name === "voice-keys") {
    await keepFocus(page);
    const heard = async (words, from, what) => {
      for (let i = 0; i < 100; i++) { if ((await context.nativeLog()).slice(from).includes(words)) return; await pause(100); }
      await capture("voice-keys-stuck");
      throw new Error(what);
    };
    let sol;
    for (let i = 0; i < 300 && !sol; i++) {
      sol = (await context.rpc("brains.cli", {})).clis.find(cli => cli.id === "codex")?.models.find(model => /gpt-6\.1-sol$/.test(model.id));
      if (!sol) await pause(200);
    }
    if (!sol) throw new Error("The real Codex does not list GPT-6.1-Sol");
    const ref = `${sol.id}?effort=high`;
    await context.rpc("settings.set", { key: "agent_model", value: ref });
    const conversation = await newConversation(context);
    const before = new Set((await snapshot()).agent_turns.map(row => row.id));
    await click(page, ".composer .cmp-voice");
    await page.waitForSelector(".is-voice", { timeout: 15000 });
    await pause(context.audioMs + 700);
    await click(page, ".composer .cmp-voice");
    await page.waitForSelector('[data-key="hearing"] .shimmer', { timeout: 15000 });
    const light = await page.$eval('[data-key="hearing"] .shimmer', el => { const mask=el.querySelector('.shimmer-mask'), style=getComputedStyle(mask ?? el,mask ? '::after' : null); return { image: style.backgroundImage, name: style.animationName, mask: mask ? getComputedStyle(mask).maskImage : 'none' }; });
    result.light = light;
    await capture("recognising");
    if (new Set(light.image.match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? []).size < 2 || light.name === "none" || light.mask === 'none') throw new Error(`The recognising light shows nothing: ${JSON.stringify(light)}`);
    let turn;
    for (let i = 0; i < 600 && !turn; i++) {
      turn = (await snapshot()).agent_turns.find(row => !before.has(row.id) && row.conversation_id === conversation);
      if (!turn) await pause(100);
    }
    if (!turn) throw new Error("The spoken turn never began");
    let mark = (await context.nativeLog()).length;
    const running = (await snapshot()).agent_turns.find(row => row.id === turn.id);
    if (running.status !== "running") throw new Error(`The answer ended before the keys could be tried: ${running.status}`);
    await page.keyboard.press("AltRight");
    await heard("dictation: recording", mark, "After the composer's microphone the dictation key did nothing during the answer");
    await capture("dictating-during-answer");
    mark = (await context.nativeLog()).length;
    await pause(400);
    await page.keyboard.press("Escape");
    await heard("dictation: cancelled", mark, "One Esc with the app in front did not end the dictation");
    if ((await snapshot()).agent_turns.find(row => row.id === turn.id).status !== "running") throw new Error("Esc on the dictation stopped the answer as well");
    let final;
    for (let i = 0; i < 2400 && !final; i++) {
      final = (await snapshot()).agent_turns.find(row => row.id === turn.id && row.status !== "running");
      if (!final) await pause(250);
    }
    result.turn = final && { model: final.model, status: final.status, seconds: Math.round((Date.now() - turn.created_at_ms) / 1000), text: final.text.slice(0, 80) };
    await capture("answered-on-sol");
    if (!final || final.status !== "done" || !final.text.trim()) throw new Error(`The spoken turn on ${ref} did not answer: ${JSON.stringify(result.turn)}`);
    mark = (await context.nativeLog()).length;
    await page.keyboard.press("AltRight");
    await heard("dictation: recording", mark, "The dictation key did nothing with the app in front");
    mark = (await context.nativeLog()).length;
    await pause(400);
    await page.keyboard.press("Escape");
    await heard("dictation: cancelled", mark, "One Esc did not end a dictation started with the app in front");
    return;
  }
  if (name === "long-think") {
    await keepFocus(page);
    const conversation = await newConversation(context);
    const text = "Think about this for as long as it takes.";
    const began = Date.now();
    await type(page, ".composer .cmp-input", text);
    await click(page, ".cmp-send");
    let turn;
    for (let i = 0; i < 1500 && !turn; i++) {
      turn = (await snapshot()).agent_turns.find(row => row.conversation_id === conversation && row.question === text && row.status !== "running");
      if (!turn) await pause(200);
    }
    result.seconds = Math.round((Date.now() - began) / 1000);
    result.turn = turn && { status: turn.status, text: turn.text.slice(0, 80) };
    await capture("after-long-think");
    if (turn?.status !== "done") throw new Error(`The long think did not finish: ${JSON.stringify(result.turn)}`);
    if (result.seconds < 75) throw new Error(`The model did not think as long as asked: ${result.seconds} s`);
    return;
  }
  if (name === "every-source" || name === "openrouter-turn") {
    await keepFocus(page);
    const outcomes = result.sources = [];
    const askOn = async (source, ref) => {
      await context.rpc("settings.set", { key: "agent_model", value: ref });
      const conversation = await newConversation(context);
      const text = `Reply with the single word ready. (${source})`, began = Date.now();
      await type(page, ".composer .cmp-input", text);
      await click(page, ".cmp-send");
      let turn;
      for (let i = 0; i < 1200 && !turn; i++) {
        turn = (await snapshot()).agent_turns.find(row => row.conversation_id === conversation && row.question === text && ["done", "error"].includes(row.status));
        if (!turn) await pause(250);
      }
      const outcome = { source, model: ref, status: turn?.status ?? "no answer", answeredBy: turn?.model, seconds: Math.round((Date.now() - began) / 1000), text: turn?.text.slice(0, 120) };
      outcomes.push(outcome);
      await capture(`source-${source}`);
      if (turn) await page.waitForFunction(id => document.querySelector(`.tn[data-id="${id}"]`), { timeout: 10000 }, turn.id);
      return outcome;
    };
    if (name === "openrouter-turn") {
      const { llm } = await context.rpc("models.catalog", {});
      const free = llm.filter(model => model.free && model.roles?.answer?.usable && !model.id.startsWith("@") && !model.id.startsWith("cli:"));
      if (!free.length) throw new Error("OpenRouter lists no free model that can answer");
      await context.rpc("settings.set", { key: "cleanup_model", value: free[0].id }).catch(() => undefined);
      // A free model is often rate limited by whoever hosts it: that says nothing of the route through the key.
      for (const model of free.slice(0, 6)) {
        const outcome = await askOn("openrouter", model.id);
        if (outcome.status === "done" && outcome.text?.trim()) return;
      }
      throw new Error(`No free model on OpenRouter answered: ${JSON.stringify(outcomes)}`);
    }
    const prefer = { claude: /haiku$/, codex: /luna$/, gemini: /flash/ };
    for (const id of ["claude", "codex", "gemini"]) {
      let cli;
      for (let i = 0; i < 300; i++) {
        cli = (await context.rpc("brains.cli", {})).clis.find(row => row.id === id);
        if (!cli?.available || (cli.models.length && (id !== "claude" || cli.models.length !== 4))) break;
        await pause(200);
      }
      if (!cli?.available) { outcomes.push({ source: id, status: "not available", installed: cli?.installed, logged_in: cli?.logged_in, disconnected: cli?.disconnected }); continue; }
      if (id === "claude") {
        result.claudeModels = cli.models.map(model => `${model.id} [${model.reasoning_efforts?.join(",")}]`);
        const fable = cli.models.find(model => model.id === "cli:claude:fable");
        if (!fable || !fable.reasoning_efforts?.includes("xhigh") || !fable.reasoning_efforts?.includes("max")) throw new Error(`Claude's list is not the CLI's: ${result.claudeModels}`);
      }
      const model = cli.models.find(row => prefer[id].test(row.id)) ?? cli.models.at(-1);
      const effort = model.reasoning_efforts?.includes("low") ? "low" : "";
      await askOn(id, model.effort_models?.[effort] ?? (effort ? `${model.id}?effort=${effort}` : model.id));
    }
    const broken = outcomes.filter(outcome => outcome.status !== "done" && outcome.status !== "not available");
    if (broken.length) throw new Error(`Sources that did not answer: ${JSON.stringify(broken)}`);
    if (!outcomes.some(outcome => outcome.status === "done")) throw new Error("No source was available");
    return;
  }
  if (name === "model-sync") {
    await keepFocus(page);
    const composerName = () => page.$eval(".composer .cmp-model .mp-tname", el => el.textContent);
    const savedModel = async () => (await context.rpc("settings.get", {})).settings.agent_model;
    const until = async (check, what) => {
      for (let i = 0; i < 150; i++) { if (await check()) return; await pause(100); }
      await capture("model-sync-stuck");
      throw new Error(`${what}: saved ${await savedModel()}, composer ${await composerName()}`);
    };
    await chat(page);
    // A menu closes when the window loses focus or changes size, which a window driven in the background can do.
    await page.evaluate(() => {
      const log = window.__menuClosers = [];
      for (const type of ["blur", "resize", "focus"]) window.addEventListener(type, () => log.push(`${type}@${Math.round(performance.now())}${document.querySelector(".cb-menu") ? " open" : ""}`), true);
      new MutationObserver(() => { const open = !!document.querySelector(".cb-menu"); if (open !== window.__menuWas) { window.__menuWas = open; log.push(`${open ? "opened" : "closed"}@${Math.round(performance.now())} focus=${document.hasFocus()} anchor=${document.querySelector(".composer .cmp-model .mp-trigger")?.isConnected}`); } }).observe(document.body, { childList: true });
    });
    context.menuLog = () => page.evaluate(() => window.__menuClosers);
    await click(page, ".composer .cmp-model .mp-trigger");
    await wait(page, ".cb-menu");
    await click(page, ".cb-pick");
    await click(page, '.cb-menu [data-cb-source="cli:codex"]');
    try { await page.waitForSelector('.cb-menu [data-model^="cli:codex:"]', { timeout: 30000 }); }
    catch (error) {
      await capture("composer-codex-missing");
      result.menuLog = await context.menuLog();
      const listed = (await context.rpc("brains.cli", {})).clis.map(cli => ({ id: cli.id, installed: cli.installed, logged_in: cli.logged_in, available: cli.available, models: cli.models.length, notes: cli.notes }));
      result.brains = listed;
      result.pane = await page.$eval(".cb-menu .cb-body", el => el.textContent.slice(0, 120)).catch(() => "the menu is closed");
      throw new Error(`The real Codex's models never reached the composer: ${JSON.stringify(listed)} / ${result.pane}`, { cause: error });
    }
    await capture("composer-codex-models");
    const models = await page.$$eval('.cb-menu [data-model^="cli:codex:"]', rows => rows.map(row => row.dataset.model));
    result.codexModels = models;
    const id = models.find(model => model.endsWith("gpt-5.6-luna")) ?? models.at(-1);
    await click(page, `.cb-menu [data-model="${id}"]`);
    await until(async () => (await savedModel()).startsWith(id), "the composer's choice did not reach the core");
    try { await wait(page, ".cb-menu .mc-range"); }
    catch (error) { result.menuLog = await context.menuLog(); throw error; }
    await perform(page, { action: "slider-stop", selector: ".cb-menu .mc-range", level: "low" });
    await until(async () => (await savedModel()) === `${id}?effort=low`, "the slider's depth did not reach the core");
    await capture("composer-depth");
    const chosenName = await composerName();
    result.composer = chosenName;
    await click(page, ".composer .cmp-model .mp-trigger");
    await page.waitForSelector(".cb-menu", { hidden: true });
    await click(page, '#nav [data-go="settings"]');
    await perform(page, { action: "settle-motion" });
    await click(page, '.modal-scrim [data-pane="models"]');
    await wait(page, '.modal-scrim [data-row="quick-model"] .mp-trigger');
    if (await page.$('.modal-scrim [data-row="agent-model"]')) throw new Error("Settings still choose what Raphael answers on");
    await capture("settings-has-no-answer-row");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".modal-scrim", { hidden: true });
    const conversation = await newConversation(context);
    const text = "Reply with the single word ready.";
    await type(page, ".composer .cmp-input", text);
    await click(page, ".cmp-send");
    let turn;
    for (let i = 0; i < 600 && !turn; i++) {
      turn = (await snapshot()).agent_turns.find(row => row.conversation_id === conversation && row.question === text && ["done", "error"].includes(row.status));
      if (!turn) await pause(200);
    }
    if (!turn) throw new Error("The turn on the chosen Codex model did not finish");
    await capture("turn-on-codex");
    result.turn = { model: turn.model, status: turn.status, text: turn.text.slice(0, 80) };
    if (turn.status !== "done" || !turn.model.startsWith("cli:codex") || !turn.text.trim()) throw new Error(`The turn did not answer on Codex: ${JSON.stringify(result.turn)}`);
    // Each member holds its own: a choice in one conversation moves no one else.
    const { member: colleague } = await context.rpc("members.create", { name: "NativeSync", role: "Model sync" });
    const { member: other } = await context.rpc("members.create", { name: "NativeOther", role: "Keeps its model" });
    await context.rpc("members.update", { id: colleague.id, model: "cli:claude:haiku" });
    await perform(page, { action: "member", id: colleague.id });
    await until(async () => (await composerName()).includes("Haiku"), "the member's own model did not show");
    const raphael = await savedModel(), others = (await context.rpc("members.list", {})).members.find(row => row.id === other.id).model;
    await click(page, ".composer .cmp-model .mp-trigger");
    await wait(page, ".cb-menu");
    await click(page, ".cb-pick");
    await click(page, '.cb-menu [data-cb-source="cli:codex"]');
    await click(page, `.cb-menu [data-model="${id}"]`);
    await until(async () => (await context.rpc("members.list", {})).members.find(row => row.id === colleague.id).model.startsWith(id), "the member's composer did not save its model");
    if ((await savedModel()) !== raphael) throw new Error("A member's choice moved Raphael's model");
    if ((await context.rpc("members.list", {})).members.find(row => row.id === other.id).model !== others) throw new Error("A member's choice moved another member");
    await capture("member-chose-for-itself");
    await click(page, ".composer .cmp-model .mp-trigger");
    await page.waitForSelector(".cb-menu", { hidden: true });
    return;
  }
  if (name === "owner-words") {
    await keepFocus(page);
    let codex;
    for (let i = 0; i < 150 && !codex; i++) {
      const models = (await context.rpc("brains.cli", {})).clis.find(cli => cli.id === "codex")?.models ?? [];
      codex = models.find(model => model.id.endsWith("gpt-6-luna")) ?? models.at(-1);
      if (!codex) await pause(200);
    }
    if (!codex) throw new Error("The real Codex listed no models");
    await context.rpc("settings.set", { key: "agent_model", value: `${codex.id}?effort=low` });
    const { member } = await context.rpc("members.create", { name: "NativeMis", role: "MIS" });
    const ask = async (text, onCard) => {
      const conversation = await newConversation(context, member.id);
      await type(page, ".composer .cmp-input", text);
      await click(page, ".cmp-send");
      for (let i = 0; i < 1800; i++) {
        if (await page.$('.page-agent [data-act="perm-once"]:not([disabled])')) {
          if (!onCard) throw new Error(`A card was shown for: ${text}`);
          await onCard();
          await page.waitForFunction(() => !document.querySelector('.page-agent [data-act="perm-once"]:not([disabled])'), { timeout: 15000 });
        }
        const turn = (await snapshot()).agent_turns.find(row => row.conversation_id === conversation && row.question === text && ["done", "error"].includes(row.status));
        if (turn) return turn;
        await pause(250);
      }
      throw new Error(`No answer to: ${text}`);
    };
    const calendar = await ask("幫我把下午三點看牙醫加到今天的行程");
    await capture("calendar-answered");
    const added = (await snapshot()).calendar_events;
    result.calendar = { status: calendar.status, events: added.length, text: calendar.text.slice(0, 80) };
    if (calendar.status !== "done" || !added.some(row => row.title.includes("牙醫"))) throw new Error(`The event did not reach the calendar: ${JSON.stringify(result.calendar)}`);
    if (!added.some(row => new Date(row.start_ms).getHours() === 15)) throw new Error(`The event is not at three: ${JSON.stringify(added.map(row => row.start_ms))}`);
    const commands = [];
    const cpu = await ask("幫我看一下為甚麼我電腦 CPU 使用率這麼高", async () => {
      const command = await page.$eval(".page-agent .local-command", el => el.textContent);
      commands.push(command);
      await capture(`card-${commands.length}`);
      if (/\b(remove|stop|set|new|start|restart|invoke|clear|rename|move|copy|add|disable|enable|format-volume)-\w+|\b(taskkill|del|rmdir|rm|reg|shutdown|net)\s/i.test(command)) {
        await click(page, '.page-agent [data-act="perm-deny"]');
        throw new Error(`Not a read-only command, refused: ${command}`);
      }
      await click(page, '.page-agent [data-act="perm-once"]');
    });
    await capture("cpu-answered");
    const data = await snapshot();
    const computer = data.tool_audit.filter(row => row.server === "computer").length, local = data.tool_audit.filter(row => row.server === "local").length;
    result.cpu = { status: cpu.status, commands: commands.length, local, computer, text: cpu.text.slice(0, 120) };
    if (cpu.status !== "done" || !commands.length || !local) throw new Error(`The local command did not answer: ${JSON.stringify(result.cpu)}`);
    if (computer) throw new Error("The question about this PC went to a computer");
    if (JSON.stringify(cpu.steps ?? []).includes(commands[0].slice(0, 30))) throw new Error("A command reached the public steps");
    if (cpu.member_id !== member.id || calendar.member_id !== member.id) throw new Error("The member was not the one asked");
    return;
  }
  if (name === "office-mission") {
    await keepFocus(page);
    let codex;
    for (let i = 0; i < 150 && !codex; i++) {
      const models = (await context.rpc("brains.cli", {})).clis.find(cli => cli.id === "codex")?.models ?? [];
      codex = models.find(model => model.id.endsWith("gpt-6-sol")) ?? models.at(-1);
      if (!codex) await pause(200);
    }
    if (!codex) throw new Error("The real Codex listed no models");
    await context.rpc("settings.set", { key: "agent_model", value: `${codex.id}?effort=medium` });
    await context.computerSignin(0);  // the owner has let Raphael use a computer; those it makes have one too
    await newConversation(context);
    const text = "幫我做一個 3D 的 Bots 辦公室：先想好需要哪些角色，把團隊成員建立起來，分派給他們一起完成。成品是一個用瀏覽器打開就能看的 three.js 網頁，放在團隊資料夾，裡面每位成員有自己的辦公桌和史萊姆造型，可以用滑鼠環顧。做好後告訴我檔案在哪裡，以及每個人做了什麼。";
    await type(page, ".composer .cmp-input", text);
    await click(page, ".cmp-send");
    const began = Date.now(), mission = result.mission = { cards: 0, questions: 0, states: [] };
    let seen = "", changed = Date.now(), done = false, shots = 0;
    while (Date.now() - began < 90 * 60_000) {
      const yes = await page.$('.page-agent [data-act="perm-once"]:not([disabled])');
      if (yes) { mission.cards += 1; await yes.click().catch(() => undefined); await pause(1000); }
      for (const question of (await context.rpc("background.questions.list", {})).questions ?? []) {
        mission.questions += 1;
        await context.rpc("background.answer", { task_id: question.task_id, question_id: question.id, approved: true }).catch(() => undefined);
      }
      const data = await snapshot();
      const tasks = data.worker_tasks ?? [], turns = data.agent_turns;
      const state = JSON.stringify([data.members.map(row => row.name), tasks.map(task => [task.id, task.member_id, task.state, task.tool_calls]), turns.map(turn => [turn.id, turn.status])]);
      if (state !== seen) {
        seen = state; changed = Date.now();
        mission.states.push({ at_s: Math.round((changed - began) / 1000), members: data.members.length, tasks: tasks.map(task => `${task.id}:${task.state}:${task.tool_calls}`).join(" "), turns: turns.map(turn => `${turn.id}:${turn.status}`).join(" ") });
        if (mission.states.length % 8 === 0 && shots < 12) { shots += 1; await capture(`mission-${shots}`).catch(() => undefined); }
      }
      const open = tasks.filter(task => !["done", "failed", "cancelled", "interrupted", "stopped"].includes(task.state));
      done = tasks.length > 0 && !open.length && !turns.some(turn => ["running", "confirm"].includes(turn.status));
      if (done && Date.now() - changed > 30_000) break;
      await pause(3000);
    }
    await capture("mission-end");
    const data = await snapshot();
    mission.seconds = Math.round((Date.now() - began) / 1000);
    mission.finished = done;
    mission.members = data.members.map(row => ({ id: row.id, name: row.name, role: row.role }));
    mission.tasks = (data.worker_tasks ?? []).map(task => ({ id: task.id, member: task.member_id, state: task.state, reason: task.reason, model_calls: task.model_calls, tool_calls: task.tool_calls, report: (task.report_text ?? "").slice(0, 300) }));
    mission.turns = data.agent_turns.map(turn => ({ id: turn.id, member: turn.member_id, status: turn.status, text: (turn.text ?? "").slice(0, 600) }));
    mission.tools = data.tool_audit.reduce((all, row) => ({ ...all, [row.server]: (all[row.server] ?? 0) + 1 }), {});
    const found = [];
    const walk = (folder, depth = 0) => {
      let rows = [];
      try { rows = readdirSync(folder); } catch { return; }
      for (const row of rows) {
        const path = join(folder, row);
        let info;
        try { info = statSync(path); } catch { continue; }
        if (info.isDirectory()) { if (depth < 6 && !["node_modules", ".cache", ".config", ".mozilla", ".local", "Desktop"].includes(row)) walk(path, depth + 1); }
        else if (/\.(html|js|md)$/i.test(row)) found.push({ path, bytes: info.size });
      }
    };
    walk(join(result.data, "vm-shared")); walk(join(result.data, "vm-homes"));
    mission.files = found.slice(0, 40);
    if (!done) throw new Error("The mission did not finish in 90 minutes");
    if (!mission.tasks.some(task => task.member === 0 && task.state === "done")) throw new Error("Raphael never went on from what came back");
    if (!found.some(file => /\.html$/i.test(file.path) && file.bytes > 500)) throw new Error("No page came of the mission");
    const idle = mission.members.filter(member => !mission.tasks.some(task => task.member === member.id && task.state === "done"));
    if (idle.length) throw new Error(`No finished work from ${idle.map(member => member.name).join(", ")}`);
    const asked = data.agent_turns.find(turn => turn.member_id === 0 && turn.question)?.id;
    const told = (await page.$eval(`.tn[data-id="${asked}"]`, row => row.innerText).catch(() => "")).replace(/\s+/g, " ");
    mission.told = told.slice(-1500);
    if (!/\.html/i.test(told)) throw new Error("The last reply on the page does not say where the page is");
    const unnamed = mission.members.filter(member => !told.includes(member.name));
    if (unnamed.length) throw new Error(`The last reply on the page does not say what ${unnamed.map(member => member.name).join(", ")} did`);
    return;
  }
  if (name === "member-job") {
    await keepFocus(page);
    let codex;
    for (let i = 0; i < 150 && !codex; i++) {
      const models = (await context.rpc("brains.cli", {})).clis.find(cli => cli.id === "codex")?.models ?? [];
      codex = models.find(model => model.id.endsWith("gpt-6-luna")) ?? models.at(-1);
      if (!codex) await pause(200);
    }
    if (!codex) throw new Error("The real Codex listed no models");
    await context.rpc("settings.set", { key: "agent_model", value: `${codex.id}?effort=low` });
    await click(page, '[data-col="add"]');
    await click(page, '#app-popover [data-pick="member"]');
    await wait(page, ".cr-dialog");
    await capture("maker");
    await click(page, '.cr-characters [data-slime-character="gobta"]');
    await type(page, "#mb-new-name", "NativeJob");
    await click(page, '.cr-dialog [data-dlg="create"]');
    await page.waitForSelector(".cr-dialog", { hidden: true });
    await wait(page, ".page-agent .ra-body");
    const member = (await context.rpc("members.list", {})).members.find(row => row.name === "NativeJob");
    if (!member) throw new Error("The member was not made");
    if (member.avatar !== "slime:gobta") throw new Error(`The member lost its slime: ${member.avatar}`);
    const greeting = await page.$eval(".page-agent .ra-body", el => el.textContent);
    result.greeting = greeting;
    if (!greeting.includes("NativeJob") || !greeting.includes("？")) throw new Error(`It did not speak first: ${greeting}`);
    if (await page.$(".page-agent .owner-message")) throw new Error("A message was put in the owner's mouth");
    if (member.role || member.instructions) throw new Error("A job was made up before the owner said one");
    await capture("greeting");
    const conversation = (await snapshot()).conversations.find(row => row.member_id === member.id);
    const text = "幫我看我貼給你的發布說明，每次都整理成三行重點。";
    await type(page, ".composer .cmp-input", text);
    await click(page, ".cmp-send");
    let turn;
    for (let i = 0; i < 900 && !turn; i++) {
      turn = (await snapshot()).agent_turns.find(row => row.conversation_id === conversation.id && row.question === text && ["done", "error"].includes(row.status));
      if (!turn) await pause(200);
    }
    if (!turn) throw new Error("The turn on the real Codex did not finish");
    await capture("answered");
    result.turn = { model: turn.model, status: turn.status, text: turn.text.slice(0, 160) };
    if (turn.status !== "done") throw new Error(`The turn failed: ${JSON.stringify(result.turn)}`);
    const saved = (await context.rpc("members.list", {})).members.find(row => row.id === member.id);
    result.job = { role: saved.role, instructions: saved.instructions };
    if (!saved.role || !saved.instructions) throw new Error(`The owner's answer did not become its job: ${JSON.stringify(result.job)}`);
    await details(page);
await click(page, '[data-det="gear"]');
await page.waitForFunction(role => document.querySelector('#mb-det-role')?.value === role, { timeout: 10000 }, saved.role);
    await capture("job-saved");
    return;
  }
  if (name === "pages") {
    const frameNow = async () => {
      for (let i = 0; i < 100; i++) {
        const frame = page.frames().find(item => /^http:\/\/127\.0\.0\.1:\d+\/p\//.test(item.url()));
        if (frame && await frame.$("#ready").catch(() => null)) return frame;
        await pause(100);
      }
      throw new Error("The page's frame never ran from the core's host");
    };
    const inFrame = (frame, id) => frame.$eval(id, el => el.textContent);
    const asked = async question => (await snapshot()).agent_turns.filter(row => row.question === question);
    const refuseAsk = async () => {
      if (await page.waitForSelector(".pg-ask", { timeout: 2500 }).catch(() => null)) {
        await click(page, '.pg-ask [data-dlg="cancel"]');
        await page.waitForSelector(".pg-ask", { hidden: true });
      }
    };
    await chat(page);
    await wait(page, '.pg-body[data-state="ready"] iframe');
    let frame = await frameNow();
    result.page = { origin: await inFrame(frame, "#origin"), parent: await inFrame(frame, "#parent"), network: await inFrame(frame, "#network"), helper: await inFrame(frame, "#helper") };
    if (result.page.origin !== "null") throw new Error(`The page has an origin: ${result.page.origin}`);
    if (result.page.parent !== "isolated") throw new Error("The page reached the app's document");
    if (result.page.helper !== "object") throw new Error("The page's helper did not run under the real CSP");
    for (let i = 0; i < 50 && await inFrame(frame, "#network") === "waiting"; i++) await pause(100);
    result.page.network = await inFrame(frame, "#network");
    if (result.page.network !== "blocked") throw new Error(`The page reached the network: ${result.page.network}`);
    const fit = await frame.evaluate(() => ({ inner: innerHeight, content: document.documentElement.scrollHeight }));
    result.page.fit = fit;
    if (fit.content > fit.inner) throw new Error(`The page scrolls inside its card: ${JSON.stringify(fit)}`);
    await capture("shown");
    // Right after a press elsewhere in the app, a page that sends by itself has the app's activation, and takes the focus.
    await pause(2500);
    result.page.autoSent = (await asked("Sent by the page alone")).length;
    if (result.page.autoSent) throw new Error("A page spoke for the owner with no press inside it");
    result.page.autoAsked = await page.$eval(".pg-ask", el => el.textContent).catch(() => "");
    if (!result.page.autoAsked.includes("Sent by the page alone")) throw new Error("A page's own attempt to speak was not shown to the owner");
    await capture("asked");
    await click(page, '.pg-ask [data-dlg="cancel"]');
    await page.waitForSelector(".pg-ask", { hidden: true });
    if ((await asked("Sent by the page alone")).length) throw new Error("A refused message was sent");
    await pressInFrame(page, await frame.$("#add"));
    await pressInFrame(page, await frame.$("#add"));
    if (await inFrame(frame, "#count") !== "2") throw new Error("A press inside the page did not reach it");
    const loaded = await inFrame(frame, "#loaded");
    await pressInFrame(page, await frame.$("#ask"));
    for (let i = 0; i < 120 && !(await asked("Pressed in the page")).some(row => row.status === "done"); i++) await pause(150);
    if (!(await asked("Pressed in the page")).some(row => row.status === "done")) throw new Error("A real press inside the page did not become the owner's message");
    await pause(500);
    frame = await frameNow();
    result.page.afterRedraw = { count: await inFrame(frame, "#count"), kept: await inFrame(frame, "#loaded") === loaded };
    if (!result.page.afterRedraw.kept || result.page.afterRedraw.count !== "2") throw new Error(`A redraw reloaded the page: ${JSON.stringify(result.page.afterRedraw)}`);
    await capture("after-press");
    await pressInFrame(page, await frame.$("#later"));
    await pause(7500);
    result.page.lateSent = (await asked("Sent long after the press")).length;
    if (result.page.lateSent) throw new Error("A page spoke long after the owner's press");
    await click(page, '.pg-card [data-page-act="expand"]');
    await wait(page, ".pg-view iframe");
    frame = await frameNow();
    if (await inFrame(frame, "#count") !== "2") throw new Error("Making the page larger lost what was in it");
    await capture("expanded");
    await click(page, '.pg-view-dialog [data-dlg="close"]');
    await page.waitForSelector(".pg-view-dialog", { hidden: true });
    frame = await frameNow();
    if (await inFrame(frame, "#count") !== "2") throw new Error("Closing the larger page lost what was in it");
    result.layout = [];
    for (const [width, height] of [[1120, 900], [720, 900], [1920, 1080]]) {
      await page.setViewport({ width, height });
      await pause(300);
      await perform(page, { action: "scroll", selector: ".pg-card" });
      result.layout.push(await page.evaluate(checkRendered, "page-card"));
      await capture(`light-${width}`);
      frame = await frameNow();
      if (await inFrame(frame, "#loaded") !== loaded) throw new Error(`A change of the window to ${width} reloaded the page`);
    }
    await page.setViewport({ width: 1120, height: 900 });
    await click(page, '#nav [data-go="settings"]');
    await perform(page, { action: "settle-motion" });
    await click(page, '.modal-scrim [data-pane="appearance"]');
    frame = await frameNow();
    if (await inFrame(frame, "#loaded") !== loaded) throw new Error("Opening Settings reloaded the page");
    await click(page, '[data-k="appearance"]');
    await click(page, '.menu [data-value="dark"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    // The theme reloads the page, and this one tries to speak each time it loads: refused once, it no longer asks.
    if (await page.waitForSelector(".pg-ask", { timeout: 2500 }).catch(() => null)) throw new Error("A page the owner refused asked again");
    await click(page, '.modal-scrim [data-act="close"]');
    await page.waitForSelector(".modal-scrim", { hidden: true });
    await chat(page);
    await wait(page, '.pg-body[data-state="ready"] iframe');
    for (let i = 0; i < 50 && !page.frames().some(item => /[?&]theme=dark/.test(item.url())); i++) await pause(100);
    frame = await frameNow();
    result.page.darkBackground = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
    if (result.page.darkBackground !== "#18181b") throw new Error(`The page did not follow the theme: ${result.page.darkBackground}`);
    await perform(page, { action: "scroll", selector: ".pg-card" });
    await capture("dark");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".page-home:not([hidden]) .ho-hero", { visible: true, timeout: 90000 });
    await chat(page);
    await wait(page, '.pg-body[data-state="ready"] iframe');
    await refuseAsk();
    frame = await frameNow();
    if (await inFrame(frame, "#helper") !== "object") throw new Error("The page did not come back after a reload");
    await perform(page, { action: "scroll", selector: ".pg-card" });
    await capture("after-reload");
    return;
  }
  if (name === "model-picker") {
    const catalog = await context.rpc("models.catalog", {});
    const usable = catalog.llm.filter(model => model.provider_id === "openrouter" && model.roles.answer.usable);
    const answer = usable.find(model => model.id === "openai/gpt-6.1-terra") ?? usable.find(model => model.reasoning_efforts?.includes("high"));
    const quick = usable.find(model => model.id !== answer?.id && model.reasoning_efforts?.includes("high"));
    const memberModel = usable.find(model => !model.capabilities.reasoning && !model.reasoning_efforts?.length);
    if (!answer || !quick || !memberModel) throw new Error("The real catalog must contain two reasoning models and one non-reasoning model");
    result.catalog = { source: catalog.source, count: catalog.llm.length, selected: [answer.id, quick.id, memberModel.id] };
    const choose = async (trigger, model, effort, label) => {
      await click(page, trigger); await wait(page, ".model-chooser");
      await click(page, '.model-chooser [data-source="openrouter"]');
      await type(page, '.model-chooser input[type="search"]', model.id);
      await click(page, `.model-chooser [data-model="${model.id}"]`);
      if (effort) await perform(page, { action: "slider-stop", selector: ".model-chooser .mc-range", level: effort });
      else if (await page.$('.model-chooser [data-effort]')) throw new Error("A non-reasoning model offered effort controls");
      await capture(`${label}-choice`);
      await click(page, '.model-chooser [data-dlg="use"]');
      await page.waitForSelector(".model-chooser", { hidden: true });
    };
    const saved = async (key, expected, label) => {
      for (let i = 0; i < 60; i++) {
        const settings = (await context.rpc("settings.get", {})).settings;
        if (settings[key] === expected) return settings;
        const error = await page.$eval("body", el => el.querySelector(".toasts .toast")?.textContent ?? "");
        if (error.includes("Invalid params")) { await capture(`${label}-refused`); throw new Error(error); }
        await pause(100);
      }
      throw new Error(`${key} did not persist ${expected}`);
    };
    const shown = async (trigger, model, effort, label) => {
      await page.waitForFunction((selector, name) => document.querySelector(selector)?.textContent.includes(name), {}, trigger, model.name);
      await click(page, trigger); await wait(page, `.model-chooser [data-model="${model.id}"][aria-checked="true"]`);
      if (effort) await wait(page, `.model-chooser [data-effort="${effort}"][data-on="true"]`);
      else if (await page.$('.model-chooser [data-effort]')) throw new Error("A saved non-reasoning model offered effort");
      await capture(`${label}-reopened`);
      await click(page, '.model-chooser [data-dlg="close"]');
    };
    await context.rpc("settings.set", { key: "agent_model", value: `${answer.id}?effort=high` });
    await click(page, '#nav [data-go="settings"]');
    await click(page, '.modal-scrim [data-pane="models"]');
    await click(page, '[data-models-tab="models"]');
    await choose('[data-k="quick-model"]', quick, "high", "quick");
    const settings = await saved("quick_model", quick.id, "quick");
    if (settings.quick_effort !== "high") await saved("quick_effort", "high", "quick");
    await shown('[data-k="quick-model"]', quick, "high", "quick");
    await capture("settings-saved");
    const quickPrice = await page.$eval('[data-price="quick-model"]', element => element.textContent);
    if (!quickPrice || quickPrice.includes("價格未知")) throw new Error("The selected reasoning model lost its catalog price");
    await click(page, '.modal-scrim [data-act="close"]');
    const assertTurn = async (model, effort, label, conversation) => {
      let before = 0;
      try { before = (await context.modelRequests()).length; } catch { /* No model requests yet. */ }
      await typed(context, `Native model selection ${label}`, conversation);
      const requests = (await context.modelRequests()).slice(before);
      if (!requests.some(request => request.model === model && request.effort === effort)) throw new Error(`Next ${label} turn did not use the selected model/effort: ${JSON.stringify(requests)}`);
      result[label] = { model, effort, requests };
      await capture(`${label}-turn`);
    };
    await chat(page); await perform(page, { action: "member", id: 0 });
    const main = (await snapshot()).conversations.find(row => row.member_id === 0 && row.is_default && row.kind !== "quick");
    await assertTurn(answer.id, "high", "answer", main.id);
    await details(page);
    const quickConversation = (await snapshot()).conversations.find(row => row.kind === "quick");
    await click(page, `[data-conversation-open="${quickConversation.id}"]`);
    await assertTurn(quick.id, "high", "quick", quickConversation.id);
    const created = await context.rpc("members.create", { name: "NativeModel", role: "Model routing audit" });
    await perform(page, { action: "member", id: created.member.id });
    const other = await context.rpc("members.create", { name: "NativeOther", role: "Keeps its own model" });
    await click(page, ".composer .cmp-model .mp-trigger"); await click(page, ".cb-pick");
    await click(page, '.cb-menu [data-cb-source="openrouter"]');
    if (await page.$('.cb-menu [data-cb-act="all"]')) await click(page, '.cb-menu [data-cb-act="all"]');
    if (await page.$(".cb-menu .cb-search")) await type(page, ".cb-menu .cb-search", memberModel.id);
    await click(page, `.cb-menu [data-model="${memberModel.id}"]`);
    await wait(page, ".cb-now:not([hidden]) .cb-pick");
    await capture("member-choice");
    await click(page, ".composer .cmp-model .mp-trigger");
    for (let i = 0; i < 60; i++) {
      if ((await snapshot()).members.find(row => row.id === created.member.id)?.model === memberModel.id) break;
      if (i === 59) throw new Error("Member model did not persist");
      await pause(100);
    }
    const after = await snapshot();
    if (after.members.find(row => row.id === other.member.id)?.model !== `${answer.id}?effort=high`) throw new Error("Another member moved with this one");
    await saved("agent_model", `${answer.id}?effort=high`, "answer");
    await capture("member-saved");
    await page.waitForFunction(name => document.querySelector(".composer .cmp-model .mp-tname")?.textContent.includes(name), {}, memberModel.name);
    const memberConversation = await newConversation(context);
    await assertTurn(memberModel.id, "none", "member", memberConversation);
    await assertTurn(answer.id, "high", "answer-after-member", main.id);
    result.paid_requests = 0;
    result.transport = "Fake provider; real picker, RPC, catalog cache, settings, member and agent routing";
    return;
  }
  if (name === "computer-speed") { result.paid_requests = 0; return; }
  if (name === "member-computer") {
    // The pre-launch smoke deliberately creates a desktop before Home knows TZ.
    // Await the real app's timezone propagation before checking that same VM.
    const ownerZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await context.rpc("home.overview", { tz: ownerZone });
    const minutes = -new Date().getTimezoneOffset();
    const expected = `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
    // Home schedules reconciliation asynchronously; its RPC reply is not readiness.
    const timezoneChecks = [], timezoneDeadline = Date.now() + 120000;
    let clock;
    do {
      try { clock = await context.computerOffset(); timezoneChecks.push(clock); }
      catch (error) { timezoneChecks.push({ error: error.message }); }
      if (clock?.offset === expected) break;
      await pause(1000);
    } while (Date.now() < timezoneDeadline);
    result.computer.timezone = { ...clock, ownerZone, expected, checks: timezoneChecks };
    if (clock?.offset !== expected) throw new Error(`VM UTC offset ${clock?.offset ?? "unavailable"} differs from host ${expected}`);
    await chat(page);
    await click(page, '[data-act="computer"]');  // the panel shows the computer on demand, until something is at work on it
    await wait(page, ' .desktop-panel:not([hidden])');
    await capture("entry");
    await page.waitForSelector('.desktop-panel[data-desktop-state="member"]', { visible: true, timeout: 60000 });
    const iframe = await page.$('.desktop-panel iframe');
    const desktop = await iframe.contentFrame();
    await desktop.waitForSelector('#noVNC_container canvas', { visible: true, timeout: 60000 });
    await desktop.waitForFunction(() => document.querySelector('#noVNC_container canvas')?.width > 100, { timeout: 60000 });
    if (await page.$eval('.desktop-panel iframe', element => /password/i.test(element.src))) throw new Error("Credential in viewer URL");
    const inspectDesktop = async label => {
      await desktop.waitForFunction(() => {
        const canvas = document.querySelector('#noVNC_container canvas');
        if (!canvas?.width) return false;
        const box = canvas.getBoundingClientRect();
        return Math.min(Math.abs(box.width - innerWidth), Math.abs(box.height - innerHeight)) <= 2;
      }, { timeout: 60000 });
      (result.computer.frames ??= []).push({ state: label, ...await desktop.evaluate(checkRendered, "desktop-frame") });
    };
    await inspectDesktop("viewer");
    await capture("viewer");
    await click(page, '[data-desktop="take"]');
    await page.waitForSelector('.desktop-panel[data-interactive="true"]', { visible: true, timeout: 60000 });
    const state = await context.rpc("computer.viewer_status", { member_id: 0 });
    if (state.control !== "owner") throw new Error("Take control did not acquire the real lease");
    result.computer.uiHeld = state.control;
    await inspectDesktop("owner");
    await capture("owner");
    await click(page, '[data-desktop="return"]');
    await page.waitForSelector('.desktop-panel[data-desktop-state="member"]', { visible: true, timeout: 60000 });
    if ((await context.rpc("computer.viewer_status", { member_id: 0 })).control !== "member") throw new Error("Handback retained the lease");
    result.computer.uiHandback = "member";
    await inspectDesktop("handback");
    await capture("handback");
    await click(page, '.mb-det [data-det="close"]');
    const { member: colleague } = await context.rpc("members.create", { name: "Computer tester", role: "Local computer test" });
    await context.computerSignin(colleague.id);
    await perform(page, { action: "member", id: colleague.id });
    await type(page, ".composer .cmp-input", "Complete the local test sign-in [native-computer:signin]");
    await click(page, ".cmp-send");
    await page.waitForSelector('[data-desktop-work][data-work-state="waiting_control"]', { visible: true, timeout: 60000 });
    await capture("takeover");
    const auditBefore = (await snapshot()).tool_audit.filter(row => row.server === "computer").length;
    await page.waitForSelector('.desktop-panel iframe:not([hidden])', {visible:true,timeout:60000});
    await click(page, '[data-desktop="take"]');
    await page.waitForSelector('.desktop-panel[data-interactive="true"][data-control-latency-ms]', { visible: true, timeout: 60000 });
    const ownerFrame = await (await page.$('.desktop-panel iframe')).contentFrame();
    await ownerFrame.waitForSelector('#noVNC_container canvas', { visible: true, timeout: 60000 });
    const canvas = await ownerFrame.$('#noVNC_container canvas');
    const desktopBox = await canvas.boundingBox();
    // The local page focuses Email when the owner clicks its background. Avoid
    // browser accelerators, which WebView2 can intercept before noVNC sees them.
    await canvas.click({ offset: { x: Math.floor(desktopBox.width * 0.1), y: Math.floor(desktopBox.height * 0.75) } });
    // All owner input travels through the real noVNC keyboard connection.
    await page.keyboard.type("owner@example.test"); await page.keyboard.press("Tab");
    await page.keyboard.type("native-only-dummy"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    await pause(700);
    const auditHeld = (await snapshot()).tool_audit.filter(row => row.server === "computer").length;
    if (auditHeld !== auditBefore) throw new Error("Member computer call completed while the owner held control");
    if (await page.$eval('[data-desktop="return"]', el => el.textContent) !== "我完成了") throw new Error("Explicit takeover done action missing");
    const latency = await page.$eval('.desktop-panel', el => Number(el.dataset.controlLatencyMs));
    if (!Number.isFinite(latency) || latency >= 300) throw new Error(`Click-to-interactive ${latency}ms exceeds 300ms`);
    result.computer.clickToInteractiveMs = latency;
    await capture("signed-in");
    await click(page, '[data-desktop="return"]');
    await page.waitForSelector('.desktop-panel[data-desktop-state="member"]', { visible: true, timeout: 60000 });
    await click(page, '.mb-det [data-det="close"]');
    let resumed;
    for (let attempt = 0; attempt < 100; attempt++) {
      resumed = (await snapshot()).agent_turns.find(turn => turn.member_id === colleague.id);
      if (resumed?.status === "done") break;
      await pause(200);
    }
    if (resumed?.status !== "done" || !resumed.text.includes("繼續一次")) throw new Error("Original computer task did not continue");
    const rows = (await snapshot()).tool_audit.filter(row => row.server === "computer");
    const continuation = rows.slice(auditBefore);
    if (continuation.map(row => row.tool).join(",") !== "request_takeover,get_desktop_state,vm_exec" || continuation.some(row => row.outcome !== "ok")) throw new Error("Sign-in check or the single real continuation failed");
    if (rows.filter(row => row.tool === "request_takeover" && row.outcome === "ok").length !== 1) throw new Error("Takeover did not resume exactly once");
    result.computer.takeover = { turn: resumed.id, state: resumed.status, resumeCount: 1, noMemberCallsWhileHeld: true };
    await capture("continued-once");
    return;
  }
  if (name === "skill-growth") {
    const { member: colleague } = await context.rpc("members.create", { name: "Skill reviewer", role: "Reviewer" });
    await chat(page);
    await perform(page, { action: "member", id: colleague.id });
    await details(page);
    await click(page, '[data-det="gear"]');
    await click(page, '[data-det="tab"][data-tab="memory"]');
    await page.waitForSelector('[data-mem-space="own"]');
    result.memoryHeading = await page.$eval('[data-mem-space="own"]', el => el.getAttribute("aria-label"));
    await capture("memory-heading");
    if (result.memoryHeading !== `${colleague.name}的記憶`) throw new Error(`Memory heading has unwanted spacing: ${result.memoryHeading}`);
    await click(page, '.mb-det [data-det="close"]');
    const send = async (text, expected) => {
      const before = (await snapshot()).agent_turns.length;
      await type(page, ".composer .cmp-input", text); await click(page, ".cmp-send");
      for (let attempt = 0; ; attempt++) {
        const turns = (await snapshot()).agent_turns;
        const turn = turns.at(-1);
        if (turns.length > before && turn.member_id === colleague.id && turn.status === "done") {
          if (turn.text !== expected) throw new Error(`Skill task mismatch: ${turn.text}`);
          return turn;
        }
        if (turn?.status === "error" || attempt > 200) throw new Error(`Skill task failed: ${JSON.stringify(turn)}`);
        await pause(150);
      }
    };
    result.first = await send("[native-skills:learn] Complete a clock audit with ten observations.", "Clock audit completed.");
    for (let attempt = 0; ; attempt++) {
      result.learned = await context.rpc("members.skills.list", { member_id: colleague.id });
      if (result.learned.skills.some(s => s.name === "clock-audit" && s.provenance === "learned")) break;
      if (attempt > 100) throw new Error("The production background review did not learn a skill");
      await pause(150);
    }
    await page.waitForFunction(() => document.querySelector('.conversation-event-line')?.textContent.includes("clock-audit"));
    await capture("skill-learned-notice");
    result.noticeOrder = await page.$eval('.conversation-event-line', notice => {
      const reply = notice.closest('.tn')?.querySelector('.ra');
      return !!reply && !!(reply.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (!result.noticeOrder) throw new Error("The learned-skill notice precedes the reply that produced it");
    result.second = await send("[native-skills:reuse] Repeat the clock audit using your learned procedure.", "The learned clock audit procedure was read.");
    const audit = await snapshot();
    result.steps = audit.agent_steps.filter(s => s.turn_id === result.first.id || s.turn_id === result.second.id);
    if (result.steps.filter(s => s.turn_id === result.first.id && s.kind === "tool").length !== 10 ||
        !result.steps.some(s => s.turn_id === result.second.id && s.tool === "skill_read" && s.outcome === "ok")) throw new Error("Persisted tool evidence does not prove learning and reuse");
    if (audit.agent_turns.some(t => t.cost_usd !== 0)) throw new Error("The fake skill journey recorded nonzero spend");
    await capture("learned-skill-reused");
    await details(page);
    await click(page, '[data-det="gear"]');
    await click(page, '[data-det="tab"][data-tab="skills"]');
    await page.waitForSelector('.mp-resource');
    result.skillDate = await page.$eval('.mp-resource', el => el.textContent);
    await capture("learned-skill-date");
    if (!/自行學會 · \d{4}\/\d{2}\/\d{2}/.test(result.skillDate)) throw new Error("The learned-skill date does not follow the Chinese UI");
  }
  if (name === "catalog-connect") {
    const app = context.catalogApp;
    if (!/^[a-z0-9_-]{1,100}$/.test(app)) throw new Error("Select a real catalog slug with RAPHAEL_NATIVE_APP");
    const catalog = await context.rpc("connectors.catalog", {});
    if (catalog.ok === false) throw new Error(`Real catalog unavailable: ${catalog.error}`);
    if (!catalog.items.some(item => item.slug === app && item.needs === "sign_in")) throw new Error(`Catalog app ${app} is absent or asks for more than a sign-in`);
    result.providerChoice = "Deterministic native fake brain; production find_app, connect_app, policy, persistence and Composio login";
    const pendingAccounts = async () => (await context.rpc("connectors.status", { refresh: false }))
      .connectors?.find(item => item.id === `composio:${app}`)?.accounts ?? [];
    result.cards = [];
    await chat(page);
    await perform(page, { action: "member-column", collapsed: false });
    await click(page, '.mb-col [data-col="add"]');
    await click(page, '#app-popover [data-pick="member"]');
    await type(page, '#mb-new-name', 'NativeConnector');
    await click(page, '.cr-dialog [data-dlg="create"]');
    await page.waitForSelector('.cr-dialog', { hidden: true });
    const member = (await snapshot()).members.find(item => item.name === 'NativeConnector');
    if (!member) throw new Error("Native member did not persist");
    for (const memberId of [0, member.id]) {
      await perform(page, { action: "member", id: memberId });
      await wait(page, '.composer .cmp-input');
      await type(page, '.composer .cmp-input', `Find and connect ${app}. Do not read any account data. [native-connect:${app}]`);
      await click(page, '.cmp-send');
      await page.waitForSelector('[data-connector] [data-act="card-connect"]', { timeout: 30000 });
      const before = (await snapshot()).connect_cards.filter(card => card.member_id === memberId && card.app === app).at(-1);
      if (!before || before.state !== 'pending' || before.resumed_at_ms) throw new Error("Catalog card must start pending and unresumed");
      let steps = [];
      for (let attempt = 0; attempt < 100; attempt++) {
        steps = (await snapshot()).agent_steps.filter(step => step.turn_id === before.turn_id);
        if (steps.some(step => step.tool === 'connect_app')) break;
        await pause(100);
      }
      if (JSON.stringify(steps.map(step => step.tool)) !== JSON.stringify(['find_app', 'connect_app']) || steps.some(step => step.outcome !== 'ok'))
        throw new Error(`Expected only successful discovery and card tools before authorization: ${JSON.stringify(steps)}`);
      await capture(`member-${memberId}-pending`);
      const previousAccounts = new Set((await pendingAccounts()).map(account => account.id));
      await click(page, '[data-connector] [data-act="card-connect"]');
      await page.waitForFunction(() => !!document.querySelector('[data-connector][data-card-state="authorizing"]'), { timeout: 30000 });
      for (let attempt = 0; ; attempt++) {
        const status = await context.rpc("connectors.status", { refresh: false });
        const connector = status.connectors?.find(item => item.id === `composio:${app}`);
        const card = (await snapshot()).connect_cards.find(item => item.id === before.id);
        if (card?.state === "failed") throw new Error(`Real sign-in failed: ${card.error}`);
        if (connector?.accounts?.some(account => !previousAccounts.has(account.id)) && card?.state === "authorizing") break;
        if (attempt >= 120) throw new Error("Authorizing state never reached a real Composio pending link");
        await pause(250);
      }
      const authorized = (await snapshot()).connect_cards.find(card => card.id === before.id);
      if (authorized.state !== 'authorizing' || authorized.resumed_at_ms) throw new Error("Expected authorizing without resumption or account access");
      result.cards.push({ ...authorized, steps });
      await capture(`member-${memberId}-authorizing`);
      {
        await click(page, '[data-connector] [data-act="card-cancel"]');
        await page.waitForFunction(() => !!document.querySelector('[data-connector][data-card-state="cancelled"]'));
      }
    }
    await click(page, '#nav [data-go="settings"]');
    await click(page, '.modal-scrim [data-pane="connections"]');
    await click(page, '[data-conn="tab"][data-id="store"]');
    await type(page, '#conn-search', app);
    const previousAccounts = new Set((await pendingAccounts()).map(account => account.id));
    await page.waitForSelector(`[data-conn="join"][data-id="${app}"]`, { timeout: 30000 });
    await click(page, `[data-conn="join"][data-id="${app}"]`);
    for (let attempt = 0; ; attempt++) {
      const status = await context.rpc("connectors.status", { refresh: false });
      const entry = status.connectors?.find(item => item.id === `composio:${app}`);
      const pending = await page.$('[data-conn="cancel-login"]');
      if (entry?.accounts?.some(account => !previousAccounts.has(account.id)) && pending) break;
      if (attempt >= 120) throw new Error("Settings did not reach a real pending provider sign-in");
      await pause(250);
    }
    await capture("settings-authorizing");
    result.settingsSignIn = "Real Composio pending link; consent not approved";
    result.stop = "Real pending links from both conversation cards and Settings; no consent approved";
    return;
  }
  if (name === "store-finder") {
    await click(page, '#nav [data-go="settings"]');
    await click(page, '.modal-scrim [data-pane="connections"]');
    await click(page, '[data-conn="tab"][data-id="store"]');
    const catalog = await context.rpc("connectors.catalog", {});
    result.catalog = catalog;
    if (catalog.ok === false) throw new Error(`Real catalog unavailable: ${catalog.error}`);
    if (catalog.truncated) throw new Error("Real catalog is truncated; performance cannot prove complete availability");
    if (catalog.items.length < 100) throw new Error("Real catalog prerequisite: at least 100 toolkits");
    await page.waitForFunction(() => document.querySelectorAll('.cs-card').length > 10, { timeout: 90000 });
    const oldMenu = await page.$('[data-k="conn-category"]');
    if (oldMenu) await click(page, '[data-k="conn-category"]');
    const selector = oldMenu ? '#app-popover [data-value=""]' : '[data-conn="store-group"][data-id=""]';
    result.performance = await perform(page, { action: "click", selector, measure: { name: "store-all-paint", budgetMs: 250, maxLongTaskMs: 50, enforce: false } });
    await capture("all-apps");
    if (result.performance.durationMs > 250 || result.performance.longTasks.some(task => task.duration > 50))
      throw new Error(`Store exceeds paint/long-task budget: ${JSON.stringify(result.performance)}`);
    return;
  }
  if (name === "memory-growth") {
    const { member: colleague } = await context.rpc("members.create", { name: "Memory reviewer", role: "Reviewer" });
    await chat(page);
    await perform(page, { action: "member", id: colleague.id });
    const send = async (text, expected) => {
      const before = (await snapshot()).agent_turns.filter(row => row.member_id === colleague.id).length;
      await type(page, ".composer .cmp-input", text);
      await click(page, ".cmp-send");
      for (let attempt = 0; ; attempt++) {
        const turns = (await snapshot()).agent_turns.filter(row => row.member_id === colleague.id);
        const turn = turns.at(-1);
        if (turns.length > before && turn.status === "done") {
          if (turn.text !== expected) throw new Error(`Memory answer mismatch: ${turn.text}`);
          return turn;
        }
        if (turn?.status === "error" || attempt > 120) throw new Error(`Memory turn failed: ${JSON.stringify(turn)}`);
        await pause(100);
      }
    };
    await send("[native-memory:record] The project colour is heliotrope.", "The member saved the project colour.");
    for (let n = 2; n <= 24; n++) await send(`[native-memory:step] Unrelated work step ${n}.`, "Work step recorded.");
    result.turn25 = await send("[native-memory:recall] What is the project colour?", "The project colour is heliotrope.");
    result.memory = await context.memoryHome(colleague.id);
    if (!result.memory.exists || !result.memory.body.includes("heliotrope") || result.memory.otherHomes.length) throw new Error("Member memory is missing or leaked to another home");
    result.turns = (await snapshot()).agent_turns.filter(row => row.member_id === colleague.id);
    if (result.turns.length !== 25 || result.turns.some(row => row.cost_usd !== 0)) throw new Error("Native memory journey did not complete exactly 25 free turns");
    await capture("turn-twenty-five-recalled");
  } else if (name === "upgrade") {
    const data = await snapshot();
    result.upgraded = { members: data.members.length, turns: data.agent_turns.length, conversations: data.conversations.length };
    if (!data.members.length || !data.agent_turns.length) throw new Error("The older data did not come through");
    await page.waitForSelector(".page-home:not([hidden]) .ho-hero", { visible: true, timeout: 60000 });
    await pause(1500);
    await capture("home");
    await chat(page); await pause(1000);
    await capture("chief");
    for (const member of data.members.slice(0, 6)) {
      await perform(page, { action: "member", id: member.id });
      await wait(page, ".composer .cmp-input");
      await pause(800);
      await capture(`member-${member.id}`);
    }
    await click(page, '#nav [data-go="settings"]');
    await wait(page, ".modal-scrim [data-pane]");
    const panes = await page.$$eval(".modal-scrim [data-pane]", rows => rows.map(row => row.dataset.pane));
    result.upgraded.panes = panes;
    for (const pane of panes) {
      await click(page, `.modal-scrim [data-pane="${pane}"]`);
      await pause(700);
      await capture(`settings-${pane}`);
    }
  } else if (name === "bot-homes") {
    const initial = await context.homes();
    if (!initial.verified || Object.keys(initial.files).length !== 4) throw new Error("Migration lost copied memories or skills");
    await chat(page);
    await perform(page, { action: "member", id: 1 });
    await wait(page, '.composer .cmp-input');
    await type(page, '.composer .cmp-input', 'Verify your home and reply.'); await click(page, '.cmp-send');
    for (let i = 0; ; i++) {
      const turns = (await snapshot()).agent_turns.filter(row => row.member_id === 1);
      const done = turns.find(row => row.status === "done" && row.text === "Native Codex home verified.");
      if (done) { result.turn = done; break; }
      if (turns.some(row => row.status === "error") || i > 120) throw new Error(`Member CLI did not answer: ${JSON.stringify(turns)}`);
      await pause(200);
    }
    result.homes = await context.homes();
    if (!result.homes.receipt?.member_home || !String(result.turn.model).startsWith("cli:codex")) throw new Error("The member did not use its Codex brain and migrated home");
    await capture("member-codex-answer");
  } else if (name === "slime-sharp") {
    for (let index = 0; index < 12; index++) await context.rpc("members.create", { name: `Colleague ${index + 1}`, role: "Research" });
    await page.setViewport({ width: 1280, height: 800 });
    await chat(page); await pause(1500);
    result.idle = await idleCost(page, 10);
    await capture("slime-sidebar");
    result.sharp = await slimeSharp(page, "#nav");
  } else if (name === "readable-layout") {
    result.layout = [];
    const inspect = async (label, checks, checkContext = {}) => {
      const entry = { label, viewport: page.viewport(), checks: [], failures: [] };
      for (const check of checks) {
        try { entry.checks.push(await page.evaluate(checkRendered, check, checkContext)); }
        catch (error) { entry.failures.push(error.message); result.failures.push(error.message); }
      }
      result.layout.push(entry);
      await capture(label);
    };
    // Persist prerequisites through production RPC; UI geometry is never replaced.
    for (const [groupIndex, count] of [[1, 1], [2, 8]]) {
      const { group } = await context.rpc("groups.create", { name: `Layout group ${groupIndex}` });
      for (let index = 0; index < count; index++) await context.rpc("members.create", {
        name: `Colleague ${groupIndex}-${index + 1}`, role: index === 1 ? "Strategy and decisions" : "Research", group_id: group.id,
      });
    }
    await page.setViewport({ width: 1280, height: 800 });
    await chat(page); await pause(250);
    await inspect("sidebar-opening-1280", ["sidebar-shell", "content-width"]);
    await click(page, '[data-group-fold]'); await pause(250);
    await inspect("sidebar-folded-1280", ["sidebar-shell", "content-width"]);
    await page.setViewport({ width: 1920, height: 1080 });
    await chat(page); await details(page); await pause(250);
    await inspect("details-1920", ["details-alignment", "conversation-header", "details-quick-once", "conversation-scroll-edge"]);
    await click(page, '.mb-det [data-det="close"]');
    await page.setViewport({ width: 720, height: 900 }); await pause(250);
    await inspect("conversation-720", ["conversation-header"]);
    await click(page, '[data-sidebar="open"]');
    await inspect("sidebar-drawer-720", ["sidebar-shell"]);
    await page.keyboard.press("Escape");
    await details(page); await pause(250);
    await inspect("details-sheet-720", ["details-sheet"]);
    const scrim = await page.$('.mb-det-scrim'), bounds = await scrim?.boundingBox();
    if (bounds) {
      await page.mouse.click(bounds.x + 4, bounds.y + 80);
      await page.waitForSelector('.conversation-trigger[aria-expanded="false"]');
      await page.waitForFunction(() => document.querySelector('.mb-det')?.hidden && getComputedStyle(document.querySelector('.mb-det-scrim')).display === 'none');
      await inspect("details-dismissed-720", ["conversation-header"]);
    }
    await scrim?.dispose();
    await click(page, '#nav [data-go="home"]'); await wait(page, '.ho-hero h1');
    await inspect("home-720", ["sidebar-shell", "home-lead-width", "home-overview", "home-redesign"]);
    const originalMonth = await page.$eval('.ho-calendar', node => node.dataset.month);
    await click(page, '[data-home-month="1"]');
    await page.waitForFunction(month => document.querySelector('.ho-calendar')?.dataset.month !== month, {}, originalMonth);
    await click(page, '[data-home-month="-1"]');
    await page.waitForFunction(month => document.querySelector('.ho-calendar')?.dataset.month === month, {}, originalMonth);
    await perform(page, {action:'scroll',selector:'.ho-calendar'});
    await inspect("home-month-720", ["home-month"]);
    await click(page, '[data-home-today]');
    await page.setViewport({ width: 1920, height: 1080 });
    await inspect("home-month-full-1920", ["home-month", "home-redesign"]);
    await page.setViewport({ width: 1280, height: 800 });
    await perform(page, {action:'scroll',selector:'.ho-calendar'});
    await inspect("home-month-compact-1280", ["home-month"]);
    await perform(page, {action:'click-position',selector:'.ho-calendar',x:.02,y:.02,expect:'.au-day-col'}); await pause(200);
    await inspect("calendar-week-1280", ["calendar-shell"]);
    await click(page, '[data-au="view"]'); await click(page, '#app-popover [data-value="day"]');
    await inspect("calendar-day-1280", ["calendar-shell"]);
    const conversation = await newConversation(context);
    if (await page.$('.conversation-trigger[aria-expanded="true"]')) await click(page, '.mb-det [data-det="close"]');
    const workflow = Array.from({ length: 12 }, (_, index) => `${index + 1}. 整理每日新聞素材：先確認來源與日期，再將背景、事實與引用分成段落。\n\n保留可查核的出處與摘要，下一步請繼續整理後續素材。`).join('\n\n');
    await typed(context, workflow, conversation);
    await inspect("long-owner-preview-1280", ["message-no-inner-scroll", "message-preview", "message-no-raw-envelope"]);
    const expand = '.tn:last-child .owner-message [data-act="expand-message"]';
    await click(page, expand);
    await inspect("long-owner-expanded-1280", ["message-no-inner-scroll", "message-expanded"]);
    await click(page, expand);
    await inspect("long-owner-collapsed-1280", ["message-no-inner-scroll", "message-preview"]);
    const roster = (await context.rpc("members.list", {})).members;
    for (const count of [2, 3]) {
      const ids = [0, ...roster.filter(member => member.id !== 0).slice(0, count - 1).map(member => member.id)];
      const { room } = await context.rpc("rooms.create", {name:`Native sidebar ${count} faces`, member_ids:ids});
      await context.rpc("rooms.send", {room_id:room.id, text:"Native sidebar summary.", request_id:`sidebar-summary-${count}`});
      await perform(page, {action:"room", id:room.id});
      await pause(1000);
      const summary = (await context.rpc("rooms.list", {})).rooms.find(item => item.id === room.id);
      await page.waitForFunction((id, preview) => document.querySelector(`[data-room="${id}"] .mb-row-p`)?.textContent.endsWith(preview.replace(/\s+/g, ' ')), {}, room.id, summary.preview);
      await inspect(`sidebar-room-${count}-1280`, ["sidebar-room-avatar", "sidebar-room-summary", "sidebar-selection"], {roomId:room.id, latest:{text:summary.preview, created:summary.last_at}});
      await click(page, '#nav [data-go="home"]'); await wait(page, '.ho-hero h1');
      await inspect(`sidebar-home-after-room-${count}-1280`, ["sidebar-selection"]);
    }
  } else if (name === "calendar") {
    const events = async () => (await snapshot()).calendar_events;
    const until = async (test, what) => {
      for (let i = 0; i < 80; i++) { const rows = await events(); if (test(rows)) return rows; await pause(100); }
      throw new Error(`The calendar store never showed: ${what}`);
    };
    const inspectPage = async (label, checks) => { await pause(200); for (const check of checks) await page.evaluate(checkRendered, check); await capture(label); };
    await page.setViewport({ width: 1280, height: 800 });
    await perform(page, { action: "click-position", selector: ".ho-calendar", x: .02, y: .02, expect: ".au-day-col" });
    await inspectPage("week-empty", ["calendar-shell", "calendar-now"]);
    // The owner, by hand: 建立, then the small form beside the placeholder.
    await click(page, '[data-au="new"]');
    await wait(page, ".au-pop-editor");
    await inspectPage("create-form", ["calendar-editor"]);
    await type(page, "#cal-title", "NativeOwner");
    await click(page, '.au-pop-editor [data-pop="save"]');
    const [made] = await until(rows => rows.length === 1, "the owner's event");
    if (made.added_by !== null || made.title !== "NativeOwner") throw new Error(`The owner's event was stored wrongly: ${JSON.stringify(made)}`);
    const chip = `.cal-chip.is-own[data-entry="own:${made.id}"]`;
    await wait(page, chip);
    await inspectPage("created", ["calendar-shell"]);
    // A drag down moves it, a drag on its edge changes when it ends; a detail never opens for either.
    await perform(page, { action: "pointer-drag", selector: chip, dx: 0, dy: await page.evaluate(() => parseFloat(document.querySelector(".au-page").style.getPropertyValue("--au-hour"))), y: .3 });
    const moved = (await until(rows => rows[0].start_ms !== made.start_ms, "the moved event"))[0];
    if (moved.end_ms - moved.start_ms !== made.end_ms - made.start_ms) throw new Error("Moving the event changed how long it lasts");
    await wait(page, chip);
    await perform(page, { action: "pointer-drag", selector: `[data-wrap="own:${made.id}"] .au-event-edge`, dx: 0, dy: 40 });
    const resized = (await until(rows => rows[0].end_ms !== moved.end_ms, "the resized event"))[0];
    if (resized.start_ms !== moved.start_ms || resized.end_ms <= moved.end_ms) throw new Error("The edge did not change only the end");
    if (await page.$(".au-pop-detail")) throw new Error("A drag opened the detail");
    await capture("moved-resized");
    // A member, through the real tool: the owner's words, a scripted provider choice, the production gate and store.
    await chat(page);
    await perform(page, { action: "member-column", collapsed: false });
    await click(page, '.mb-col [data-col="add"]');
    await click(page, '#app-popover [data-pick="member"]');
    await type(page, "#mb-new-name", "NativeSecretary");
    await click(page, '.cr-dialog [data-dlg="create"]');
    await page.waitForSelector(".cr-dialog", { hidden: true });
    const member = (await snapshot()).members.find(row => row.name === "NativeSecretary");
    if (!member) throw new Error("The member was not persisted");
    await perform(page, { action: "member", id: member.id });
    await wait(page, ".composer .cmp-input");
    const conversation = (await snapshot()).conversations.find(row => row.member_id === member.id && row.is_default);
    await typed(context, "把牙醫加到今天的行程 [native-calendar]", conversation.id);
    const rows = await until(list => list.some(row => row.added_by === member.id), "the member's event");
    const added = rows.find(row => row.added_by === member.id);
    const state = await snapshot();
    if (!state.agent_steps.some(step => step.tool === "calendar_add" && step.outcome === "ok")) throw new Error("The member's turn has no successful calendar_add step");
    await capture("member-added");
    // Home draws both, and a click on the member's event opens it on the Calendar page.
    await perform(page, { action: "click", selector: '#nav [data-go="home"]' });
    await wait(page, ".ho-hero h1");
    const eventOnHome = `.ho-calendar [data-home-event="own:${added.id}"]`;
    await wait(page, eventOnHome);
    await inspectPage("home", ["home-calendar-language"]);
    await click(page, eventOnHome);
    await wait(page, ".au-pop-detail");
    const detail = await page.$eval(".au-pop-detail", node => node.textContent);
    if (!detail.includes("NativeSecretary") || !detail.includes("From the member")) throw new Error(`The detail does not say who added it: ${detail}`);
    await inspectPage("member-event-detail", ["calendar-detail-own"]);
    // The ⋯ asks once more, then the event is gone from the store and the page.
    await click(page, '.au-pop-detail [data-pop="more"]');
    await click(page, "#app-popover [data-confirm-item]");
    await click(page, "#app-popover [data-confirm-item]");
    await until(list => !list.some(row => row.id === added.id), "the deletion");
    await wait(page, ".toast");
    await capture("deleted");
    result.assertions = { owner_event: made.id, member_event: added.id, added_by: added.added_by, moved: moved.start_ms !== made.start_ms, resized: resized.end_ms !== moved.end_ms };
    result.stored = { calendar_events: await events() };
  } else if (name === "self-diagnosis") {
    await chat(page);
    await perform(page, { action: "member-column", collapsed: false });
    await click(page, '.mb-col [data-col="add"]');
    await click(page, '#app-popover [data-pick="member"]');
    await type(page, "#mb-new-name", "NativeDiagnosis");
    await click(page, '.cr-dialog [data-dlg="create"]');
    await page.waitForSelector(".cr-dialog", { hidden: true });
    const member = (await snapshot()).members.find(row => row.name === "NativeDiagnosis");
    if (!member) throw new Error("Diagnosis member was not persisted");
    await perform(page, { action: "member", id: member.id });
    await wait(page, ".composer .cmp-input");
    const conversation = (await snapshot()).conversations.find(row => row.member_id === member.id && row.is_default);
    if (!conversation) throw new Error("Diagnosis member has no private conversation");
    await typed(context, "請幫我整理 Gmail [native-diagnosis]", conversation.id);
    await wait(page, '[data-connector][data-card-state="pending"]');
    await capture("pending");
    // The isolated fake vault has neither OAuth configuration nor a Composio key.
    await click(page, '[data-connector] [data-act="card-connect"]');
    await wait(page, '[data-connector][data-card-state="failed"]');
    await capture("failed");
    let continuation;
    for (let i = 0; i < 100; i++) {
      const state = await snapshot();
      continuation = state.agent_turns.find(row => row.member_id === member.id && row.conversation_id === conversation.id && row.source === "connector" && row.status === "done" && row.text.includes("我已檢查設定"));
      if (continuation) { result.stored = state; break; }
      await pause(150);
    }
    if (!continuation) throw new Error("Failed connection card never returned a natural reply to the member's completed turn");
    await page.waitForFunction(id => document.querySelector(`.tn[data-id="${id}"]`)?.innerText.includes("我已檢查設定"), {}, continuation.id);
    if (await page.$(`[data-resumed="${continuation.id}"]`)) throw new Error("Failed continuation claimed that the app was connected");
    result.continuation = continuation;
    const checks = result.stored.agent_steps.filter(step => step.turn_id === continuation.id);
    if (!checks.some(step => step.tool === "self_check" && step.outcome === "ok")) throw new Error("Member did not run the read-only self-check");
    if (result.stored.connect_cards.length !== 1) throw new Error("Failure recovery minted another connection card");
    const failedCard = result.stored.connect_cards[0];
    if (continuation.member_id !== failedCard.member_id || continuation.conversation_id !== failedCard.conversation_id) throw new Error("Failure continuation escaped the originating member conversation");
    if (failedCard.error !== "needs_composio_key") throw new Error("Connection card did not preserve the real failure reason");
    await perform(page, { action: "wait-text", selector: `.mb-col [data-member="${member.id}"] .mb-row-p`, text: "要連上 Gmail" });
    result.ownerCopy = await page.evaluate(checkRendered, "failure-owner-copy");
    result.assertions = { failure_kind: failedCard.error, reason: failedCard.error, self_check: true,
      same_member: continuation.member_id === failedCard.member_id,
      same_conversation: continuation.conversation_id === failedCard.conversation_id, card_count: 1 };
    await capture("continued");
  } else if (name === "locale-sweep") {
    result.visits = [];
    const devices = await context.rpc("audio.devices", { refresh: false });
    const deviceNames = [...new Set([devices.automatic_device, devices.selected, ...devices.devices.map(device => device.name)].filter(Boolean))];
    result.deviceNames = deviceNames;
    for (const locale of ["en", "ja", "zh-TW"]) {
      await click(page, '#nav [data-go="settings"]');
      await click(page, '.modal-scrim [data-pane="appearance"]');
      await click(page, '[data-k="ui-language"]');
      await click(page, `#app-popover [data-value="${locale}"]`);
      await page.waitForFunction(locale => document.documentElement.lang === locale, {}, locale);
      await pause(250);
      for (const pane of ["general", "appearance", "connections", "models", "dictation", "tools", "safety", "messaging", "data", "about"]) {
        await click(page, `.modal-scrim [data-pane="${pane}"]`); await pause(180);
        const issues = await page.evaluate(wrongLanguage, locale, phrases[locale], deviceNames);
        result.visits.push({ locale, page: `settings/${pane}`, issues });
        await capture(`${locale}-settings-${pane}`);
      }
      await click(page, '.modal-scrim [data-act="close"]');
      for (const destination of ["home", "agent", "dictation"]) {
        await click(page, destination === "agent" ? ".mb-chief" : `#nav [data-go="${destination}"]`); await pause(200);
        const tabs = destination === "dictation" ? ["overview", "history", "dictionary"] : [null];
        for (const tab of tabs) {
          if (tab) { await click(page, `[data-dictation-tab="${tab}"]`); await pause(150); }
          result.visits.push({ locale, page: `${destination}${tab ? `/${tab}` : ""}`, issues: await page.evaluate(wrongLanguage, locale, phrases[locale], deviceNames) });
          await capture(`${locale}-${destination}${tab ? `-${tab}` : ""}`);
        }
      }
    }
    const wrong = result.visits.filter(visit => visit.issues.length);
    if (wrong.length) result.failures.push(`Wrong-language UI in ${wrong.length} visits; exact elements in visits[].issues`);
  } else if (name === "owner-round10") {
    const conversation = await newConversation(context);
    await typed(context, Array.from({length: 55}, (_, i) => `Review step ${i + 1}: retain this complete owner instruction.`).join("\n"), conversation);
    await capture("long-owner");
    await click(page, '.owner-message [data-act="expand-message"]');
    await capture("long-owner-expanded");
    if (await page.$('.ra [data-act="expand-message"]')) throw new Error("A native reply still exposes collapse");
    await perform(page, {action:"conversation-position",position:"up"});
    await page.evaluate(checkRendered,"conversation-up");
    await capture("scrolled-up");
    await click(page,'.conversation-latest:not([hidden])');
    await pause(700);
    await page.evaluate(checkRendered,"conversation-bottom");
    await capture("at-bottom");
    await type(page,".composer .cmp-input","[native-round10:wait] Hold this synthetic answer until I stop it.");
    await click(page,".composer .cmp-send");
    await page.waitForSelector('.composer [data-task-state], .composer[data-task-state="running"], .composer[data-task-state="ack"]');
    await pause(500);
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-cancel-armed="true"]');
    result.firstEscape = (await snapshot()).agent_turns.find(turn => turn.question.includes("[native-round10:wait]"));
    if (result.firstEscape?.status !== "running") throw new Error("The first Escape stopped the native answer");
    await page.evaluate(checkRendered, "cancel-armed");
    await capture("answer-first-escape");
    await page.keyboard.press("Escape");
    for (let i=0;i<60;i++) {
      result.secondEscape = (await snapshot()).agent_turns.find(turn => turn.id === result.firstEscape.id) ?? null;
      if (result.secondEscape?.status !== "running") break;
      await pause(100);
    }
    if (result.secondEscape && result.secondEscape.status !== "denied") throw new Error(`The second Escape did not cancel the native answer: ${JSON.stringify(result.secondEscape)}`);
    await page.waitForSelector('.composer[data-task-state="idle"]');
    result.afterAnswerStop = await snapshot();
    if (!result.afterAnswerStop.agent_turns.some(turn => turn.conversation_id === conversation && turn.status === "done")) throw new Error("Stopping the pending answer removed the previous completed answer");
    await capture("answer-stopped");
    const learned = await context.learnedPage();
    if (!learned) throw new Error("Native learned notification target is missing");
    result.beforeLearning = await snapshot();
    result.focusBefore = await context.windows();
    const before = "Please ask Allice and Cloude to review the next release notes carefully.";
    const middle = before.replace("Allice","Alice"), after = middle.replace("Cloude","Claude");
    const edits = [{before,after:middle},{before:middle,after}];
    result.batch = await context.rpc("dictionary.correct",{edits});
    if (JSON.stringify([...result.batch.learned].sort()) !== JSON.stringify(["Alice","Claude"])) throw new Error(`Native Tracker did not learn the complete batch: ${JSON.stringify(result.batch)}`);
    await learned.waitForSelector('#learned-pill:not([hidden])',{visible:true});
    await learned.hover('#learned-pill');
    await pause(6200);
    if (!await learned.$('#learned-pill:not([hidden])')) throw new Error("Hover did not retain the native learned pill");
    result.focusDuring = await context.windows();
    const pillWindow = result.focusDuring.windows.find(window => window.title === "Raphael learned word");
    // The mouse passes through until the real pointer is on the pill's own controls, which CDP hovering never moves.
if (!pillWindow || !(pillWindow.style & 0x08000000) || !pillWindow.rounded) throw new Error(`Native learned pill is not passive with its rounded click region: ${JSON.stringify(pillWindow)}`);
    const [left,top,right,bottom] = pillWindow.rect, work = result.focusBefore.workArea;
    // 16 logical pixels above the taskbar, at any scale from 100% to 300%.
    if (Math.abs((left+right)/2-(work[0]+work[2])/2)>1 || work[3]-bottom<16 || work[3]-bottom>48 || top<work[1]) throw new Error(`Native pill is not centred just above the taskbar of the active monitor: ${JSON.stringify({pill:pillWindow.rect,work})}`);
    if (result.focusBefore.foreground !== result.focusDuring.foreground) throw new Error("Publishing the learned pill changed the foreground window");
    await capture("learned-hover",learned);
    await learned.click('.learned-undo');
    await learned.waitForSelector('#learned-pill[hidden]');
    result.afterUndo = await snapshot();
    for (const table of ["dictionary","dictionary_evidence"]) if (JSON.stringify(result.beforeLearning[table]) !== JSON.stringify(result.afterUndo[table])) throw new Error(`Native Undo did not restore ${table} exactly`);
    result.focusAfter = await context.windows();
    if (result.focusBefore.foreground !== result.focusAfter.foreground) throw new Error("Undo stole the foreground focus");
    result.expiringBatch = await context.rpc("dictionary.correct",{edits});
    await learned.waitForSelector('#learned-pill:not([hidden])',{visible:true});
    await learned.mouse.move(-20,-20);
    await learned.waitForSelector('#learned-pill[hidden]',{timeout:9000});
    result.afterExpiry = await context.windows();
    if (!(result.afterExpiry.windows.find(window => window.title === "Raphael learned word").style & 0x20)) throw new Error("Expired learned window is not click-through");
    await capture("learned-expired");
  } else if (name === "voice-call") {
    // A new isolated profile deliberately has no voice key; never borrow the owner's key.
    const { member } = await context.rpc("members.create", { name: "Voice member", role: "Assistant" });
    const conversation = await newConversation(context, member.id);
    result.expectedConversation = conversation;
    await wait(page, '.cmp-voice[data-voice-call-start="true"]');
    await capture("empty-member-entry");
    await type(page, ".composer .cmp-input", "Keep this draft");
    await page.waitForFunction(() => document.querySelector('.cmp-voice')?.dataset.voiceCallStart === "false");
    await capture("draft-keeps-send");
    await page.$eval('.cmp-input', input => { input.value = ""; input.dispatchEvent(new Event("input", {bubbles:true})); });
    await wait(page, '.cmp-voice[data-voice-call-start="true"]');
    await click(page, '.cmp-voice[data-voice-call-start="true"]');
    await wait(page, '.vc-failure [data-missing-repair="voice"]');
    result.status = await context.rpc("voice_chat.status", {});
    result.stored = await snapshot();
    if (result.status.call || result.stored.voice_calls.length) throw new Error("Missing voice must not admit a native call");
    await capture("voice-unavailable");
    await click(page, '.vc-failure [data-missing-repair="voice"]');
    await wait(page, '#svc-key-fish');
    await capture("existing-repair-settings");
  } else if (name === "voice-conversation") {
    const conversation = await newConversation(context);
    const before = new Set((await snapshot()).agent_turns.map(row => row.id));
    result.expectedConversation = conversation;
    await capture("voice-destination");
    await click(page, ".composer .cmp-voice");
    await page.waitForSelector(".is-voice", { timeout: 15000 });
    await capture("voice-listening");
    // Toggle mode: the first click starts the WAV; the next ends capture, as the owner does.
    await pause(context.audioMs + 700);
    await click(page, ".composer .cmp-voice");
    let spoken = [];
    for (let i = 0; i < 180; i++) {
      spoken = (await snapshot()).agent_turns.filter(row => !before.has(row.id));
      if (spoken.some(row => row.status === "done")) break;
      await pause(500);
    }
    result.spokenTurns = spoken;
    result.stored = await snapshot();
    await capture("spoken-result");
    if (!spoken.length) throw new Error("No spoken turn was stored after composer voice capture");
    const misplaced = spoken.filter(row => row.conversation_id !== conversation);
    if (misplaced.length) throw new Error(`Composer voice expected conversation ${conversation}; stored turns ${misplaced.map(row => `${row.id} in conversation ${row.conversation_id} (${result.stored.conversations.find(c => c.id === row.conversation_id)?.kind})`).join(", ")}`);
    await page.waitForFunction(ids => ids.some(id => document.querySelector(`.tn[data-id="${id}"]`)), {}, spoken.map(row => row.id));
    const beforeCancel = (await snapshot()).agent_turns.length;
    await click(page,".composer .cmp-voice");
    await page.waitForSelector(".is-voice",{timeout:15000});
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".is-voice"),{timeout:15000});
    await pause(700);
    result.recordingEscape = await snapshot();
    if (result.recordingEscape.agent_turns.length !== beforeCancel) throw new Error("One Escape created a voice answer instead of cancelling capture");
    await capture("recording-one-escape");
  } else if (name === "delete-conversation") {
    await deletionAudit(context, { click, wait, type, pause, details, typed, newConversation, remaining });
    await perform(page, { action: "member", id: 0 });
    const conversation = await newConversation(context);
    await typed(context, "Native journey first typed turn", conversation);
    await typed(context, "Native journey second typed turn", conversation);
    result.beforeDelete = await snapshot();
    await details(page);
    await click(page, `[data-conversation-more="${conversation}"]`);
    await click(page, '#app-popover [data-pick="delete"]');
    await click(page, '.mb-confirm [data-dlg="delete"]');
    await pause(900);
    result.afterDelete = await snapshot();
    result.remaining = remaining(result.afterDelete, conversation);
    result.staleSidebar = !!await page.$(`[data-conversation-open="${conversation}"]`);
    if (Object.values(result.remaining).some(rows => rows.length) || result.staleSidebar) result.failures.push(`Deleted conversation ${conversation} remains: ${JSON.stringify(result.remaining)}; staleSidebar=${result.staleSidebar}`);
    await capture("formal-deleted");
    const quick = result.afterDelete.conversations.find(row => row.kind === "quick");
    if (!quick) throw new Error("The quick conversation was not created by the real app");
    await details(page); await click(page, `[data-conversation-open="${quick.id}"]`);
    await typed(context, "Native journey quick first turn", quick.id);
    await typed(context, "Native journey quick second turn", quick.id);
    result.quickDeleteUI = !!await page.$(`[data-conversation-more="${quick.id}"]`);
    if (!result.quickDeleteUI) throw new Error("Quick conversation has no sidebar clear-history menu");
    await click(page, `[data-conversation-more="${quick.id}"]`);
    await click(page, '#app-popover [data-pick="clear"]');
    await click(page, '.mb-confirm [data-dlg="delete"]');
    await page.waitForFunction(() => !document.querySelector(".mb-confirm"));
    await pause(900);
    result.afterQuickClear = await snapshot();
    result.quickRemaining = remaining(result.afterQuickClear, quick.id);
    if (!result.afterQuickClear.conversations.some(row => row.id === quick.id && row.kind === "quick") ||
        Object.entries(result.quickRemaining).some(([table, rows]) => table !== "conversations" && rows.length)) result.failures.push(`Quick history clear did not retain only its permanent conversation: ${JSON.stringify(result.quickRemaining)}`);
    result.quickTimeline = await page.evaluate(privateTimeline);
    if (result.quickTimeline.rows.length) result.failures.push(`Cleared quick history retains timeline rows: ${JSON.stringify(result.quickTimeline)}`);
    await capture("quick-history-cleared");
  } else if (name === "gmail-connect") {
    await chat(page);
    const conversation = await newConversation(context);
    await type(page, ".composer .cmp-input", "Connect Gmail using the connect_app tool. Show me its connection card. Do not read or send any mail.");
    await click(page, ".cmp-send");
    for (let attempt = 0; ; attempt++) {
      if (await page.$('[data-connector] [data-act="card-connect"]')) break;
      const turns = (await snapshot()).agent_turns.filter(row => row.conversation_id === conversation);
      if (turns.some(row => row.status === "error")) {
        result.cliTurns = turns;
        throw new Error(`Gmail CLI failed before card: ${turns.map(row => row.detail || row.text).join("; ")}`);
      }
      if (attempt >= 360) throw new Error("Gmail connect card did not appear within 180 seconds");
      await pause(500);
    }
    await capture("gmail-card-before");
    await click(page, '[data-connector] [data-act="card-connect"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-connector]')].some(card => ["authorizing", "failed", "connected", "expired", "cancelled"].includes(card.dataset.cardState)), { timeout: 30000 }).catch(error => {
      if (error.name !== "TimeoutError") throw error;
      // A human sign-in remains authorizing; never follow or approve its Google consent page.
    });
    result.card = await page.$eval('[data-connector]', element => ({ state: element.dataset.cardState, error: element.dataset.cardError, text: element.innerText }));
    result.card.stored = (await snapshot()).connect_cards;
    result.card.error = result.card.stored.find(card => card.state === result.card.state)?.error || "";
    result.manualApprovalPending = result.card.state === "authorizing";
    result.conversation = conversation;
    result.stop = "Stopped before approving any Google consent; no browser consent interaction is automated";
    await capture("gmail-card-final");
    if (result.card.state === "failed" || result.card.error) result.failures.push(`Gmail card: ${JSON.stringify(result.card)}`);
  }
}

export function remaining(snapshot, conversation) {
  return Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.filter(row => table === "conversations" ? row.id === conversation : row.conversation_id === conversation)]));
}
