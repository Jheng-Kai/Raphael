import { perform } from "../driver.mjs";
import { deletionAudit } from "./deletion-audit.mjs";

export const journeys = [
  { name: "locale-sweep", description: "Switch every locale and visit main pages and settings" },
  { name: "voice-conversation", description: "Speak into a newly created conversation and inspect persistence" },
  { name: "delete-conversation", description: "Delete conversations/member after real exchanges and room reports; detect stale timeline rows" },
  { name: "gmail-connect", description: "Owner-only Composio card sign-in; stop before approving Google consent" },
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
export function wrongLanguage(locale, otherPhrases) {
  const violations = [];
  const inspect = (element, text, attribute = "text") => {
    if (!text.trim() || !element.getBoundingClientRect().width || !element.checkVisibility({ checkVisibilityCSS: true })) return;
    if (element.closest('script,style,textarea,.chat-message,.bubble,[contenteditable],.lm-name,.mc-name')) return;
    const wrong = locale === "en" ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) :
      locale === "zh-TW" ? /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) : false;
    if (wrong || otherPhrases.includes(text.trim())) violations.push({ tag: element.tagName, id: element.id, class: element.className, attribute, text: text.trim() });
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
  if (name === "locale-sweep") {
    result.visits = [];
    for (const locale of ["en", "ja", "zh-TW"]) {
      await click(page, '#nav [data-go="settings"]');
      await click(page, '.modal-scrim [data-pane="general"]');
      await click(page, '[data-k="ui-language"]');
      await click(page, `#app-popover [data-value="${locale}"]`);
      await page.waitForFunction(locale => document.documentElement.lang === locale, {}, locale);
      await pause(250);
      for (const pane of ["general", "appearance", "connections", "models", "dictation", "agent", "messaging", "data", "about"]) {
        await click(page, `.modal-scrim [data-pane="${pane}"]`); await pause(180);
        const issues = await page.evaluate(wrongLanguage, locale, phrases[locale]);
        result.visits.push({ locale, page: `settings/${pane}`, issues });
        await capture(`${locale}-settings-${pane}`);
      }
      await click(page, '.modal-scrim [data-act="close"]');
      for (const destination of ["home", "agent", "team", "dictation"]) {
        await click(page, `#nav [data-go="${destination}"]`); await pause(200);
        const tabs = destination === "dictation" ? ["overview", "history", "dictionary"] : [null];
        for (const tab of tabs) {
          if (tab) { await click(page, `[data-dictation-tab="${tab}"]`); await pause(150); }
          result.visits.push({ locale, page: `${destination}${tab ? `/${tab}` : ""}`, issues: await page.evaluate(wrongLanguage, locale, phrases[locale]) });
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
    if (!result.quickDeleteUI) result.failures.push("Quick conversation has no sidebar delete menu; diagnostic below calls the real core through its allowlisted native IPC");
    // No synthetic UI: the missing affordance is recorded; probe the real refusal separately.
    result.quickDeleteReply = await context.rpc("conversations.delete", { id: quick.id }).then(value => ({ value }), error => ({ error: String(error) }));
    result.quickRemaining = remaining(await snapshot(), quick.id);
    if (result.quickDeleteReply.error || Object.values(result.quickRemaining).some(rows => rows.length)) result.failures.push(`Quick history delete: ${JSON.stringify(result.quickDeleteReply)}; remaining=${JSON.stringify(result.quickRemaining)}`);
    await capture("quick-delete-refused");
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
