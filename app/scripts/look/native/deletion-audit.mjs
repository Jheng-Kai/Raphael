import { perform } from "../driver.mjs";
import { checkRendered } from "../checks.mjs";

// Inspect the actual private timeline, including empty chrome without a turn id.
export function privateTimeline() {
  const thread = document.querySelector(".page-agent .ra-stage > .ra-scroll .thread");
  if (!thread) throw new Error("Private timeline is missing");
  return {
    rows: [...thread.children].map(row => ({ tag: row.tagName, class: row.className, id: row.dataset.id ?? null, text: row.innerText, html: row.outerHTML })),
    separators: [...thread.querySelectorAll("li.day")].map(row => row.innerText),
    exchanges: [...thread.querySelectorAll(".exchange-row summary")].map(row => row.innerText),
    turnIds: [...thread.querySelectorAll(".tn[data-id]")].map(row => Number(row.dataset.id)),
  };
}

export async function deletionAudit(context, helpers) {
  const { page, result, snapshot, capture, rpc, threadQuery } = context;
  const { click, wait, type, pause, details, typed, newConversation, remaining } = helpers;
  const audit = result.deletionAudit = { checkpoints: [], failures: [], deletedConversations: [] };
  const fail = message => { audit.failures.push(message); result.failures.push(message); };
  const until = async (read, label, attempts = 120) => {
    for (let i = 0; i < attempts; i++) { const value = await read(); if (value) return value; await pause(250); }
    throw new Error(`Deletion audit prerequisite: ${label}`);
  };
  const select = async member => {
    await click(page, '.mb-chief');
    await perform(page, { action: "member-column", collapsed: false });
    await perform(page, { action: "member", id: member });
    await wait(page, ".composer .cmp-input");
  };
  const createMember = async name => {
    await click(page, '.mb-col [data-col="add"]');
    await click(page, '#app-popover [data-pick="member"]');
    await type(page, "#mb-new-name", name);
    await type(page, "#mb-new-role", "Native audit colleague");
    await click(page, '.mp-dialog [data-dlg="create"]');
    const member = await until(async () => (await snapshot()).members.find(row => row.name === name), `create ${name}`);
    await page.waitForSelector(".mp-dialog", { hidden: true });
    return member.id;
  };
  await select(0);
  const source = await createMember("NativeSource");
  const target = await createMember("NativeTarget");
  console.log(`Deletion audit: created members ${source}, ${target}`);
  audit.members = { source, target };
  await select(source);
  const sourceConversation = await until(async () => (await snapshot()).conversations.find(row => row.member_id === source && row.is_default), "source private conversation");
  for (const name of ["Raphael", "NativeTarget"]) {
    await typed(context, `Ask ${name} for a report [native-consult:${name}]`, sourceConversation.id);
  }
  await until(async () => {
    const rows = (await snapshot()).agent_turns;
    return [0, target].every(member => rows.some(row => row.member_id === member && row.peer_id === source && row.scope === "exchange" && row.status === "done"));
  }, "real ask_member exchange must reach both recipients");

  for (const member of [0, target]) {
    await select(member);
    const main = (await snapshot()).conversations.find(row => row.member_id === member && row.is_default);
    for (const index of [1, 2]) await typed(context, `NATIVE-AUDIT-PRIVATE member ${member} turn ${index}`, main.id);
  }

  await perform(page, { action: "new-room" });
  await type(page, "#room-name", "Native audit room");
  for (const member of [source, target]) await click(page, `.au-group-dialog [data-dlg="member"][data-member="${member}"]`);
  await click(page, '.au-group-dialog [data-dlg="create"]');
  const room = await until(async () => (await snapshot()).rooms.find(row => row.name === "Native audit room"), "create room");
  await type(page, "#room-message", "@Raphael @NativeTarget NATIVE-AUDIT-ROOM: give a short report for the owner.");
  await click(page, ".au-room-pane .cmp-send");
  await until(async () => {
    const db = await snapshot();
    return [0, target].every(member => db.agent_turns.some(row => row.member_id === member && row.room_id === room.id && row.scope === "room" && row.status === "done")) &&
      db.room_exchanges.some(row => row.room_id === room.id && ["done", "stopped"].includes(row.state));
  }, "real room report must finish for both recipients", 360);
  audit.room = room.id;
  audit.beforeDelete = await snapshot();
  audit.oldTurnIds = audit.beforeDelete.agent_turns.map(row => row.id);
  audit.exchangeRows = audit.beforeDelete.agent_turns.filter(row => row.scope === "exchange" && row.source === "member" && row.peer_id === source);
  audit.roomRows = audit.beforeDelete.agent_turns.filter(row => row.scope === "room" && row.source === "room" && row.room_id === room.id);
  audit.roomHistoryBefore = await rpc("rooms.messages", { room_id: room.id });
  if (![0, target].every(member => audit.exchangeRows.some(row => row.member_id === member) && audit.roomRows.some(row => row.member_id === member))) {
    throw new Error("Deletion audit prerequisite: exchange/member and room/room rows are required for both recipients");
  }
  await capture("room-reports-before-delete");
  console.log(`Deletion audit: produced ${audit.exchangeRows.length} exchange and ${audit.roomRows.length} room audit rows`);

  const inspect = async (member, conversation, stage) => {
    await select(member); await details(page);
    await click(page, `[data-conversation-open="${conversation}"]`);
    // Let the real history IPC and its paint finish; never inject a timeline or model response.
    await pause(800);
    const query = await threadQuery(member, conversation);
    const api = await rpc("agent.history.list", { member_id: member, conversation_id: conversation, limit: 200 });
    const dom = await page.evaluate(privateTimeline);
    const dbIds = query.rows.map(row => row.id).sort((a, b) => a - b);
    const apiIds = api.turns.map(row => row.id).sort((a, b) => a - b);
    if (JSON.stringify(dbIds) !== JSON.stringify(apiIds)) throw new Error("Read-only SQL did not match the actual history IPC result");
    const old = new Set(audit.oldTurnIds);
    const checkpoint = { stage, member, conversation, query, api, dom, staleQueryIds: query.rows.filter(row => old.has(row.id)).map(row => row.id), staleApiIds: api.turns.filter(row => old.has(row.id)).map(row => row.id) };
    audit.checkpoints.push(checkpoint);
    if (stage !== "before-delete" && (query.rows.length || api.turns.length || dom.rows.length || dom.separators.length || dom.exchanges.length)) {
      fail(`Stale private timeline ${stage}: member=${member}, conversation=${conversation}, DB=${checkpoint.staleQueryIds}, API=${checkpoint.staleApiIds}, rows=${dom.rows.length}, separators=${dom.separators.length}, exchangeLines=${JSON.stringify(dom.exchanges)}`);
    }
    const roomIds = new Set(audit.roomRows.map(row => row.id));
    checkpoint.leakedRoomIds = api.turns.filter(row => roomIds.has(row.id)).map(row => row.id);
    if (checkpoint.leakedRoomIds.length) fail(`Room audit rows leaked into private history: ${checkpoint.leakedRoomIds}`);
    await capture(`member-${member}-${stage}`);
    try { checkpoint.toastClearance = await page.evaluate(checkRendered, "toast-clearance"); }
    catch (error) { fail(`Toast clearance ${stage}, member=${member}: ${error.message}`); }
  };

  for (const member of [0, target]) {
    const conversations = (await snapshot()).conversations.filter(row => row.member_id === member && row.kind !== "quick");
    const original = conversations.find(row => row.is_default);
    if (!original) throw new Error(`Missing recipient default conversation: ${member}`);
    await inspect(member, original.id, "before-delete");
    for (const conversation of conversations) {
      await details(page); await click(page, `[data-conversation-more="${conversation.id}"]`);
      await click(page, '#app-popover [data-pick="delete"]');
      await click(page, '.mb-confirm [data-dlg="delete"]');
      await until(async () => !(await snapshot()).conversations.some(row => row.id === conversation.id), "conversation deletion");
      const db = await snapshot();
      const kept = remaining(db, conversation.id);
      audit.deletedConversations.push({ member, id: conversation.id, remaining: kept });
      if (Object.values(kept).some(rows => rows.length)) fail(`Deleted conversation ${conversation.id} retained associated rows`);
      await pause(400);
    }
    const replacement = (await snapshot()).conversations.find(row => row.member_id === member && row.is_default);
    if (!replacement || audit.beforeDelete.conversations.some(row => row.id === replacement.id)) throw new Error("Delete did not create a fresh default conversation");
    await inspect(member, replacement.id, "replacement-default");
  }

  await click(page, `.mb-col [data-member-more="${source}"]`);
  await click(page, '#app-popover [data-pick="delete"]');
  await click(page, '.mb-dialog [data-dlg="delete"]');
  await until(async () => !(await snapshot()).members.some(row => row.id === source), "source member deletion");
  audit.afterMemberDelete = await snapshot();
  audit.orphanExchangeRows = audit.afterMemberDelete.agent_turns.filter(row => row.scope === "exchange" && row.peer_id === source);
  if (audit.orphanExchangeRows.length) fail(`Deleted source member retained exchange rows: ${audit.orphanExchangeRows.map(row => row.id)}`);
  if (audit.afterMemberDelete.agent_turns.some(row => row.scope === "private" && (row.member_id === source || row.peer_id === source))) fail("Deleted member still has private rows");
  for (const member of [0, target]) {
    const main = (await snapshot()).conversations.find(row => row.member_id === member && row.is_default);
    await inspect(member, main.id, "deleted-source-default");
    await select(member);
    const named = await newConversation(context, member);
    await inspect(member, named, "new-named-control");
  }
  audit.after = await snapshot();
  const conversations = new Set(audit.after.conversations.map(row => row.id));
  const members = new Set([0, ...audit.after.members.map(row => row.id)]);
  audit.orphanRows = audit.after.agent_turns.filter(row => ["private", "exchange"].includes(row.scope) &&
    (!members.has(row.member_id) || (row.peer_id !== null && !members.has(row.peer_id)) || !conversations.has(row.conversation_id)));
  if (audit.orphanRows.length) fail(`Orphan private/exchange rows remain: ${audit.orphanRows.map(row => row.id)}`);
  audit.roomHistoryAfter = await rpc("rooms.messages", { room_id: room.id });
  const roomTurns = new Set(audit.after.agent_turns.filter(row => row.scope === "room" && row.room_id === room.id).map(row => row.id));
  const roomMessages = new Set(audit.after.room_messages.filter(row => row.room_id === room.id).map(row => row.id));
  const historyMessages = new Set(audit.roomHistoryAfter.messages.map(row => row.id));
  if (!audit.roomRows.every(row => roomTurns.has(row.id)) ||
      !audit.beforeDelete.room_messages.filter(row => row.room_id === room.id).every(row => roomMessages.has(row.id)) ||
      !audit.roomHistoryBefore.messages.every(row => historyMessages.has(row.id))) fail("Deleting private conversations/member damaged room history");
  await perform(page, { action: "room", id: room.id });
  await wait(page, ".au-room-pane #room-message");
  await capture("room-history-after-delete");
  audit.quarantine = "Current real UI writes scope=room; quarantine is a legacy migration scope. No synthetic legacy rows were inserted.";
}
