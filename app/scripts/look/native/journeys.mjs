import { perform } from "../driver.mjs";
import { checkRendered } from "../checks.mjs";
import { deletionAudit, privateTimeline } from "./deletion-audit.mjs";

export const journeys = [
  { name: "skill-growth", description: "Learn after ten real tool calls, then read the skill on the next similar task" },
  { name: "memory-growth", description: "Recall a turn-one fact on turn twenty-five and inspect the member-written home" },
  { name: "bot-homes", description: "Migrate three copied notes and an imported skill, then answer with an offline Codex child" },
  { name: "readable-layout", description: "Inspect readable Team opening, aligned details and compact identity in the real WebView" },
  { name: "locale-sweep", description: "Switch every locale and visit main pages and settings" },
  { name: "voice-conversation", description: "Speak into a newly created conversation and inspect persistence" },
  { name: "delete-conversation", description: "Delete conversations/member after real exchanges and room reports; detect stale timeline rows" },
  { name: "gmail-connect", description: "Owner-only Composio card sign-in; stop before approving Google consent" },
  { name: "self-diagnosis", description: "Force an offline connection card failure; the same member checks and explains the real reason" },
];
const click = (page, selector) => perform(page, { action: "click", selector });
const wait = (page, selector) => perform(page, { action: "wait", selector });
const type = (page, selector, text) => perform(page, { action: "type", selector, text });
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function details(page) {
  if (await page.$('.conversation-trigger[aria-expanded="false"]')) await click(page, ".conversation-trigger");
  await wait(page, "[data-conversation-new]");
}
async function chat(page) {
  await click(page, '#nav [data-go="agent"]');
  await wait(page, ".composer .cmp-input");
}
async function newConversation(context) {
  await chat(context.page); await details(context.page);
  const before = new Set((await context.snapshot()).conversations.map(row => row.id));
  await click(context.page, "[data-conversation-new]");
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
  const inspect = (element, text, attribute = "text") => {
    if (!text.trim() || !element.getBoundingClientRect().width || !element.checkVisibility({ checkVisibilityCSS: true })) return;
    if (element.closest('script,style,textarea,.chat-message,.bubble,[contenteditable],.lm-name,.mc-name')) return;
    if (text.trim() === "Raphael") return;
    // Device names come from the OS, but surrounding application labels must still translate.
    let checked = text;
    if (element.closest('[data-k="mic"], [data-ob="mic"], .mic-ctl')) {
      // Closed controls abbreviate an OS name to its kind before the device parentheses.
      // Match only known device text; the application's Automatic/Disconnected wording stays checked.
      const names = [...new Set(deviceNames.flatMap(name => [name, name.split(" (")[0]]))].filter(Boolean).sort((a,b)=>b.length-a.length);
      for (const name of names) checked = checked.split(name).join("");
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
  if (name === "skill-growth") {
    const { member: colleague } = await context.rpc("members.create", { name: "Skill reviewer", role: "Reviewer" });
    await chat(page);
    await perform(page, { action: "member", id: colleague.id });
    await details(page);
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
    result.second = await send("[native-skills:reuse] Repeat the clock audit using your learned procedure.", "The learned clock audit procedure was read.");
    const audit = await snapshot();
    result.steps = audit.agent_steps.filter(s => s.turn_id === result.first.id || s.turn_id === result.second.id);
    if (result.steps.filter(s => s.turn_id === result.first.id && s.kind === "tool").length !== 10 ||
        !result.steps.some(s => s.turn_id === result.second.id && s.tool === "skill_read" && s.outcome === "ok")) throw new Error("Persisted tool evidence does not prove learning and reuse");
    if (audit.agent_turns.some(t => t.cost_usd !== 0)) throw new Error("The fake skill journey recorded nonzero spend");
    await capture("learned-skill-reused");
  } else if (name === "memory-growth") {
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
  } else if (name === "readable-layout") {
    result.layout = [];
    const inspect = async (label, checks) => {
      const entry = { label, viewport: page.viewport(), checks: [], failures: [] };
      for (const check of checks) {
        try { entry.checks.push(await page.evaluate(checkRendered, check)); }
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
    await click(page, '#nav [data-go="team"]');
    await wait(page, '.team-group-members .team-member'); await pause(250);
    await inspect("team-opening-1280", ["team-readable", "team-card-lines", "content-width"]);
    await click(page, '[data-team="fit"]'); await pause(200);
    await inspect("team-explicit-fit-1280", ["team-canvas-fit", "content-width"]);
    await page.setViewport({ width: 1920, height: 1080 });
    await chat(page); await details(page); await pause(250);
    await inspect("details-1920", ["details-alignment", "conversation-header", "details-quick-once", "conversation-scroll-edge"]);
    await click(page, '.mb-det [data-det="close"]');
    await page.setViewport({ width: 720, height: 900 }); await pause(250);
    await inspect("conversation-720", ["conversation-header"]);
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
    await inspect("home-720", ["sidebar-count-alignment", "home-lead-width"]);
  } else if (name === "self-diagnosis") {
    await chat(page);
    await perform(page, { action: "member-column", collapsed: false });
    await click(page, '.mb-col [data-col="add"]');
    await click(page, '#app-popover [data-pick="member"]');
    await type(page, "#mb-new-name", "NativeDiagnosis");
    await type(page, "#mb-new-role", "Diagnosis colleague");
    await click(page, '.mp-dialog [data-dlg="create"]');
    await page.waitForSelector(".mp-dialog", { hidden: true });
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
    if (failedCard.error !== "not_configured") throw new Error("Connection card did not preserve the real failure reason");
    await perform(page, { action: "wait-text", selector: `.mb-col [data-member="${member.id}"] .mb-row-p`, text: "Gmail 還沒登入" });
    result.ownerCopy = await page.evaluate(checkRendered, "failure-owner-copy");
    result.assertions = { failure_kind: "auth_expired", reason: failedCard.error, self_check: true,
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
      await click(page, '.modal-scrim [data-pane="general"]');
      await click(page, '[data-k="ui-language"]');
      await click(page, `#app-popover [data-value="${locale}"]`);
      await page.waitForFunction(locale => document.documentElement.lang === locale, {}, locale);
      await pause(250);
      for (const pane of ["general", "appearance", "connections", "models", "dictation", "agent", "messaging", "data", "about"]) {
        await click(page, `.modal-scrim [data-pane="${pane}"]`); await pause(180);
        const issues = await page.evaluate(wrongLanguage, locale, phrases[locale], deviceNames);
        result.visits.push({ locale, page: `settings/${pane}`, issues });
        await capture(`${locale}-settings-${pane}`);
      }
      await click(page, '.modal-scrim [data-act="close"]');
      for (const destination of ["home", "agent", "team", "dictation"]) {
        await click(page, `#nav [data-go="${destination}"]`); await pause(200);
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
