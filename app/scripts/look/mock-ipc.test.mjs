import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { installMock } from "./mock-ipc.js";
import { checkRendered } from "./checks.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
describe("shared look IPC boundary", () => {
  it("keeps member-store empty, offline and warning variants at the IPC boundary", async () => {
    for (const variant of [{storeEmpty:true}, {storeOffline:true}, {storeWarning:true}]) {
      const target = {}, state = installMock(fixture, {fixture:variant}, target);
      const call = params => target.__TAURI_INTERNALS__.invoke("core_call", {method:"members.template",params});
      const catalogue = await call({action:"catalog"});
      expect(catalogue.entries).toHaveLength(variant.storeWarning ? 4 : 0);
      expect(catalogue.offline).toBe(!!variant.storeOffline);
      if (variant.storeWarning) {
        const before = state.data.members.length;
        const preview = await call({action:"catalog-preview",catalog_id:"research"});
        expect(preview.findings).toEqual([{kind:"injection",path:"template.instructions"}]);
        expect(preview.template.instructions).not.toBe(fixture.memberCatalog.templates.research.instructions);
        expect(state.data.members).toHaveLength(before);
      }
      expect(state.errors).toEqual([]);
    }
  });
  it("installs a plugin set once, preserves its member choice on update and removes every set capability", async () => {
    const source = {kind:"plugin",name:"desk",version:"1.0.0",source:"local:C:/synthetic/plugin",skills:[{name:"write",description:"Write"},{name:"check",description:"Check"}],commands:[{name:"review",description:"Review",set_kind:"command"}]};
    const target = {}, state = installMock(fixture,{fixture:{skillSources:[source]}},target);
    const call=(method,params)=>target.__TAURI_INTERNALS__.invoke("core_call",{method,params});
    const first=await call("members.skills.import",{member_id:0,shared:true,plugin:true,source:source.source});
    expect(first.skills).toHaveLength(3); expect(state.data.skillSets).toHaveLength(1);
    await call("members.skills.update",{member_id:0,id:first.skills[0].id,enabled:false});
    await call("members.skills.import",{member_id:0,shared:true,set_id:first.set.id});
    expect((await call("members.skills.list",{member_id:0})).skills[0].enabled).toBe(false);
    await call("members.skills.delete",{member_id:0,shared:true,set_id:first.set.id});
    expect((await call("members.skills.list",{member_id:0})).skills).toEqual([]);
    expect(state.data.skillSets).toEqual([]); expect(state.errors).toEqual([]);
  });
  it("keeps shared imports distinct from Raphael's own skills and grants each member independently", async () => {
    const target = {}, state = installMock(fixture, { fixture: { skillSources: [{ source: "local:C:/synthetic/writer", name: "writer", description: "Write" }] } }, target);
    const call = (method, params) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
    state.data.skills = [{ id: 20, member_id: 0, name: "private", description: "Own", source: "owner", enabled: true }];
    expect((await call("members.skills.list", {member_id:0,shared:true})).skills).toEqual([]);
    expect((await call("members.skills.list", {member_id:0,discover:true})).sources).toHaveLength(1);
    const {skill} = await call("members.skills.import", {member_id:0,shared:true,source:state.data.skillSources[0].source});
    expect((await call("members.skills.list", {member_id:0})).skills).toHaveLength(2);
    await call("members.skills.update", {member_id:0,id:skill.id,enabled:false});
    expect((await call("members.skills.list", {member_id:0})).skills.find(s=>s.id===skill.id).enabled).toBe(false);
    expect((await call("members.skills.list", {member_id:1})).skills[0]).toMatchObject({id:skill.id,shared:true,enabled:true});
    await expect(call("members.skills.update", {member_id:0,id:skill.id,text:"Changed"})).rejects.toThrow("shared library");
  });
  it("keeps room message timestamps renderable before and after bringing a pending question", async () => {
    const target = {}, state = installMock(fixture, {fixture:{ownerQuestion:"pending-room"}}, target);
    const invoke = (method, params) => target.__TAURI_INTERNALS__.invoke("core_call", {method, params});
    const checkTimes = async () => {
      const { messages } = await invoke("rooms.messages", {room_id:1});
      expect(messages.length).toBeGreaterThan(12);
      for (const message of messages) expect(Number.isFinite(new Date(message.created).getTime())).toBe(true);
      return messages;
    };
    const before = await checkTimes();
    const question = before.flatMap(message => message.turn?.owner_questions ?? [])[0];
    const moved = await invoke("owner_questions.bring", {id:question.id});
    expect((await checkTimes()).at(-1).turn_id).toBe(moved.turn_id);
    expect(state.errors).toEqual([]);
  });
  it("offers connected event choices and returns ordinary detected conditions without creating", async () => {
    const target = {}, state=installMock(fixture, {}, target);
    const call=(params={})=>target.__TAURI_INTERNALS__.invoke("core_call",{method:"routines.list",params});
    const before=state.data.routines.length;
    expect((await call()).events.some(e=>e.id==='gmail-mail')).toBe(true);
    const picked=await call({member_id:1,event:'gmail-mail',value:''});
    expect(picked.when.event.items).toBe('data.results.0.response.data.messages');
    expect(picked.when.event.arguments.tools[0].arguments).toEqual({max_results:20,include_payload:false,verbose:false});
    expect(state.data.routines).toHaveLength(before);
    const created=await target.__TAURI_INTERNALS__.invoke('core_call',{method:'routines.create',params:{member_id:1,title:'Sample',prompt:'Review',when:picked.when}});
    expect(created.routine.app_name).toBe('Gmail');
    const empty={}; installMock(fixture,{fixture:{eventUndetectable:true}},empty);
    expect((await empty.__TAURI_INTERNALS__.invoke('core_call',{method:'routines.list',params:{event:'gmail-mail'}})).event_error).toBeTruthy();
  });
  it("keeps Calendar's detected numeric path and moving window through create and reopen", async () => {
    const target = {}; installMock(fixture, {}, target);
    const call = (method, params = {}) => target.__TAURI_INTERNALS__.invoke('core_call', {method, params});
    const picked = await call('routines.list', {member_id:1,event:'calendar-event'});
    expect(picked.when.event).toMatchObject({items:'data.results.0.response.data.items',id:'id',since:{arg:'updatedMin',format:'iso'},
      arguments:{tools:[{tool_slug:'GOOGLECALENDAR_EVENTS_LIST',arguments:{calendarId:'primary',maxResults:50,singleEvents:true,orderBy:'updated'}}]}});
    const {routine} = await call('routines.create', {member_id:1,title:'Sample',prompt:'Review',when:picked.when});
    expect((await call('routines.list',{member_id:1})).routines.find(r=>r.id===routine.id).when).toEqual(picked.when);
  });
  it("keeps both existing-copy and no-copy drafts available to the real mail scenes", () => {
    for (const copy of ['', 'reviewer@example.com']) {
      const target = {}, state = installMock(fixture, {fixture:{mailDraft:'draft',mailCopy:copy}}, target);
      expect(state.data.turns.flatMap(turn => turn.drafts ?? []).find(draft => draft.id === 'mail-1').cc).toBe(copy);
    }
  });
  it("keeps a connected message draft through one failed approval and its original retry", async () => {
    const target = {}; installMock(fixture, {fixture:{permissionCard:'tool',cardMessagePreview:true,cardPermissionFailure:true}}, target);
    const invoke = target.__TAURI_INTERNALS__.invoke;
    const question = await invoke('agent_question_open', {});
    const read = async () => (await invoke('core_call', {method:'agent.history.list',params:{member_id:0}})).turns.flatMap(turn => turn.permissions ?? []).find(card => card.id === question.id);
    const before = await read(); expect(before.message).toEqual({workspace:'範例工作室',to:'#規劃',thread:'123.456',body:'請確認範例排程，並回覆方便討論的時間。'});
    await expect(invoke('agent_question_answer', {id:question.id,approved:true})).rejects.toThrow('Synthetic approval unavailable');
    expect((await read()).message).toEqual(before.message); expect((await read()).state).toBe('pending');
    await invoke('agent_question_answer', {id:question.id,approved:true});
    expect((await read()).message).toEqual(before.message); expect((await read()).state).toBe('allowed');
  });
  it("the card sheet exposes the same live desktop work as its conversation turn", async () => {
    const target = {}, state = installMock(fixture, {fixture: {cardDeck: true}}, target);
    const desktop = await target.__TAURI_INTERNALS__.invoke("core_call", {method: "computer.viewer_status", params: {member_id: 1}});
    expect(desktop).toMatchObject({state: "running", works: [{turn_id: 980, state: "waiting_control", request_id: "sheet-request"}]});
    expect(state.data.turns[0].id).toBe(desktop.works[0].turn_id);
  });
  it("records caption calls once without changing the fixture conversation", async () => {
    const target = {}, state = installMock(fixture, {}, target);
    for (const action of ['minimize','toggle_maximize','close','start_dragging']) {
      await expect(target.__TAURI_INTERNALS__.invoke(`plugin:window|${action}`)).resolves.toBeUndefined();
      expect(state.calls.filter(call=>call.command===`plugin:window|${action}`)).toHaveLength(1);
    }
    expect(state.errors).toEqual([]);
    expect(state.data.turns).toEqual(fixture.turns);
  });
  it.each(["http", "stdio", "secret", "room"])("keeps the MCP %s scene card separate from its variant selector", async variant => {
    const target = {}; installMock(fixture, { fixture: { mcpProposal: variant } }, target);
    const history = await target.__TAURI_INTERNALS__.invoke("core_call", { method: "agent.history.list", params: { member_id: 1, conversation_id: 11 } });
    const card = history.turns.find(turn => turn.id === 946).connection_proposals[0];
    expect(card.fields.name).toBe("Sample");
    expect(card.fields.transport).toBe(variant === "stdio" ? "stdio" : "http");
  });
  it("keeps event routines exclusive of schedules and resets their baseline only when the condition changes", async () => {
    const target = {}; installMock(fixture, {}, target);
    const call = (method, params = {}) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
    const when = { app: "gmail", event: { tool: "mcp:gmail/messages", arguments: {}, items: "", id: "id" }, filter: { field: "sender", equals: "client@example.com" } };
    const { routine } = await call("routines.create", { member_id: 1, title: "Client mail", prompt: "Draft a reply", when });
    expect(routine).toMatchObject({ when, schedule: null, last_checked: null, last_error: "" });
    const updated = (await call("routines.update", { id: routine.id, when: { ...when, filter: { ...when.filter, equals: "owner@example.com" } } })).routine;
    expect(updated).toMatchObject({ schedule: null, last_checked: null, last_error: "", when: { filter: { equals: "owner@example.com" } } });
    const schedule = { kind: "daily", time: "09:00" };
    expect((await call("routines.update", { id: routine.id, schedule })).routine).toMatchObject({ when: null, schedule });
  });
  it("adds an own calendar event without replacing Google, then updates and deletes only that event", async () => {
    const target = {}, state = installMock(fixture, {}, target);
    const call = (method, params = {}) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
    const google = structuredClone((await call("home.overview")).calendar_events.filter(item => item.kind === "event"));
    expect(google.length).toBeGreaterThan(0);
    const { event } = await call("calendar.add", { title: "Visit", start: "2026-10-24T11:00:00+08:00", end: "2026-10-24T12:00:00+08:00" });
    const events = async () => (await call("home.overview")).calendar_events;
    expect((await events()).filter(item => item.kind === "event")).toEqual(google);
    expect((await events()).find(item => item.event_id === event.id)).toMatchObject({ kind: "own", title: "Visit", added_by: null });
    await call("calendar.update", { id: event.id, title: "Updated visit" });
    expect((await events()).find(item => item.event_id === event.id).title).toBe("Updated visit");
    await call("calendar.delete", { id: event.id });
    expect((await events()).some(item => item.event_id === event.id)).toBe(false);
    expect((await events()).filter(item => item.kind === "event")).toEqual(google);
    expect(state.errors).toEqual([]);
  });
  it("returns offline link metadata without fetching a table cell's URL or thumbnail", async () => {
    const target = {}, state = installMock(fixture, {}, target);
    const url = 'https://example.com/research';
    const preview = await target.__TAURI_INTERNALS__.invoke('core_call', { method: 'links.preview', params: { url } });
    // example.com stands for a page that has a title, so a bare link's chip can say it (link-chips).
    expect(preview).toEqual({ url, site: 'example.com', title: '範例網頁標題', description: '這一頁的摘要很長：從產品的來歷、每一種尺寸與顏色、材質與保養方式，一路說到配送、退換貨與保固的每一條細節，沒有人會在預覽裡讀完它。', thumbnail: null });
    const other = await target.__TAURI_INTERNALS__.invoke('core_call', { method: 'links.preview', params: { url: 'https://x.com/a' } });
    expect(other).toEqual({ url: 'https://x.com/a', site: 'x.com', title: '', description: '', thumbnail: null });
    expect(state.errors).toEqual([]);
  });
  it("lists what the owner typed as the core does: typed private turns, newest first, a repeat in a row once, or what a scene states", async () => {
    const target = {}, data = structuredClone(fixture);
    data.turns.push(...[["one", "app"], ["said aloud", "voice"], ["two", "app"], ["two", "app"]].map(([question, source], index) => ({ ...data.turns[0], id: 900 + index, question, source })));
    installMock(data, {}, target);
    const call = (method, params = {}) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
    const { texts } = await call("agent.history.sent");
    expect(texts.slice(0, 2)).toEqual(["two", "one"]);
    expect(texts).not.toContain("said aloud");
    expect((await call("agent.history.sent", { limit: 1 })).texts).toEqual(["two"]);
    const stated = {}; installMock(fixture, { fixture: { typedHistory: ["b", "a"] } }, stated);
    expect((await stated.__TAURI_INTERNALS__.invoke("core_call", { method: "agent.history.sent", params: {} })).texts).toEqual(["b", "a"]);
  });
  it("accepts only the declared native correction snapshot without duplicating acceptance rules", async () => {
    const target = {}, edit = { before: "Please use Open Mouse", after: "Please use OpenMausBot" };
    const state = installMock(fixture, { fixture: { dictationText: edit } }, target);
    const call = (params) => target.__TAURI_INTERNALS__.invoke("core_call", { method: "dictionary.correct", params });
    expect(await call({ edits: [edit] })).toEqual({ learned: ["OpenMausBot"], undo: "synthetic-correction-batch" });
    expect(state.errors).toEqual([]);
    await expect(call({ edits: [{ ...edit, after: "A different edit" }] })).rejects.toThrow("fixture edit");
  });

  it("projects room previews, timestamps and unread from messages, preserving summaries after reading", async () => {
    const target = {}; installMock(fixture, {}, target);
    const call = (method, params = {}) => target.__TAURI_INTERNALS__.invoke("core_call", {method, params});
    const latest = fixture.messages.filter(message => message.room_id === 1).at(-1);
    const before = (await call("rooms.list")).rooms.find(room => room.id === 1);
    expect(before).toMatchObject({preview:latest.text, last_at:latest.created, unread:true});
    expect((await call("rooms.list")).rooms.find(room => room.id === 2)).toMatchObject({preview:"", last_at:null, unread:false});
    await call("rooms.update", {room_id:1, read:true, read_through:latest.id});
    expect((await call("rooms.list")).rooms.find(room => room.id === 1)).toMatchObject({preview:latest.text, last_at:latest.created, unread:false});
    await call("rooms.send", {room_id:1, text:"Owner follow-up", request_id:"summary"});
    expect((await call("rooms.list")).rooms.find(room => room.id === 1)).toMatchObject({preview:"Owner follow-up", last_at:fixture.now, unread:false});
  });
  it("does not replace a room summary with empty, pass, running or failed member replies", async () => {
    const target = {}, data = structuredClone(fixture);
    const latest = data.messages.filter(message => message.room_id === 1).at(-1);
    for (const [status, text] of [["done", " （PASS）。 "], ["done", ""], ["running", "Pending"], ["error", "Failure"]]) {
      data.messages.push({...latest, id:data.messages.at(-1).id + 1, status, text});
    }
    data.rooms[0].read_message_id = latest.id;
    installMock(data, {}, target);
    const {rooms} = await target.__TAURI_INTERNALS__.invoke("core_call", {method:"rooms.list", params:{}});
    expect(rooms.find(room => room.id === 1)).toMatchObject({preview:latest.text, last_at:latest.created, unread:false});
  });
  it("loads the one-member and eight-member sidebar roster without replacing its fixture data with the flag", async () => {
    const target = {}; installMock(fixture, { fixture: { sidebarMany: true } }, target);
    const invoke = (method) => target.__TAURI_INTERNALS__.invoke('core_call', { method, params: {} });
    const roster = await invoke('members.list');
    expect(roster.members.filter(member => member.group_id === 1)).toHaveLength(1);
    expect(roster.members.filter(member => member.id && member.group_id === null)).toHaveLength(8);
    expect(roster.members.find(member => member.id === 3).model).toBe('cli:claude:haiku');
    expect((await invoke('brains.cli')).clis.find(cli => cli.id === 'codex').models.some(model => model.name === 'GPT-6.1 Sol')).toBe(true);
  });
  it("the plain usage page reads only allowances, as the shell allows, and the month's spend stays the ledger's", async () => {
    const target = {};
    const state = installMock(fixture, {}, target);
    const call = (method, params = {}) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
    expect((await call("usage.allowances")).brains.length).toBeGreaterThan(0);
    expect((await call("status.get")).spend.month_usd).toBeCloseTo(1.24);
    for (const retired of ["usage.runs", "usage.analytics", "usage.export"]) await expect(call(retired, { range: "month" })).rejects.toThrow(`Unmocked IPC: ${retired}`);
    state.errors.length = 0;
  });
  it("usageEmpty has no subscriptions and nothing spent", async () => {
    const target = {};
    installMock(fixture, { fixture: { usageEmpty: true } }, target);
    const call = (method, params = {}) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
    expect((await call("usage.allowances")).brains).toEqual([]);
    expect((await call("status.get")).spend.month_usd).toBe(0);
  });
  it.each([undefined, -1])("rejects an approval without an explicit existing source turn (%s)", turn_id => {
    const data = structuredClone(fixture);
    data.adminQuestions.draft.turn_id = turn_id;
    expect(() => installMock(data, { fixture: { adminApproval: "draft" } }, {})).toThrow("Approval fixture requires its explicit source turn");
  });
  it("puts running state in the visible formal conversation and preserves quick questions", async () => {
    const target = {};
    installMock(fixture, { fixture: { running: true } }, target);
    const history = conversation_id => target.__TAURI_INTERNALS__.invoke('core_call', { method: 'agent.history.list', params: { member_id: 0, conversation_id } });
    const turn = (await history(1)).turns[0];
    expect(turn.status).toBe('running');
    expect(turn.messages.some(message => message.kind === 'reply')).toBe(false);
    expect((await history(4)).turns[0].status).toBe('done');
  });
  it("stops only the named quick request and delivers an announced quick answer, leaving formal history alone", async () => {
    const target = {};
    installMock(fixture, { fixture: { quickRunning: true, arrivals: [{ ...fixture.turns[0], id: 91, session_id: "look-quick-later" }] } }, target);
    const invoke = target.__TAURI_INTERNALS__.invoke;
    const history = conversation_id => invoke("core_call", { method: "agent.history.list", params: { member_id: 0, conversation_id } });
    const formal = await history(1);
    expect((await history(4)).turns.map(turn => [turn.id, turn.status])).toEqual([[90, "running"]]);
    expect(await invoke("core_call", { method: "agent.history.stop", params: { session_id: "look-quick", member_id: 0 } })).toEqual({ stopped: true });
    const [stopped] = (await history(4)).turns;
    expect([stopped.status, stopped.text, stopped.messages.some(message => message.kind === "reply")]).toEqual(["denied", "已取消。", false]);
    target.__look.emit({ type: "AgentTurn", turn_id: 91, member_id: 0 });
    expect((await history(4)).turns.map(turn => turn.id)).toEqual([91, 90]);
    expect(await history(1)).toEqual(formal);
  });
  it.each([true, false])("settles draft approval in the formal conversation while preserving quick history (%s)", async approved => {
    const target = {};
    installMock(fixture, { fixture: { adminApproval: "draft" } }, target);
    const invoke = target.__TAURI_INTERNALS__.invoke;
    const history = conversation_id => invoke("core_call", { method: "agent.history.list", params: { member_id: 0, conversation_id } });
    const quick = await history(4);
    expect((await history(1)).turns[0].status).toBe("confirm");
    const question = await invoke("agent_question_open");
    await invoke("agent_question_answer", { id: question.id, approved, drafts: question.drafts });
    const turn = (await history(1)).turns[0];
    expect(turn.status).toBe(approved ? "done" : "denied");
    expect(turn.text).toBe(approved ? "已建立 COO、PM、RD" : "已取消建立成員。");
    if (approved) expect(turn.detail.split("\n")).toHaveLength(3);
    expect(await history(4)).toEqual(quick);
  });
  it("initializes rendered owner-view helpers before checking a reply and rejects progress in final messages", () => {
    const answer = { textContent: "需要重新登入並授予讀取權限。", checkVisibility: () => true, getBoundingClientRect: () => ({ width: 400, height: 40 }) };
    vi.stubGlobal("document", { querySelectorAll: () => [answer] });
    vi.stubGlobal("window", { __look: { calls: [{ method: "agent.history.list", params: { member_id: 0 } }] } });
    try {
      expect(checkRendered("live-scenario-owner-view").answers).toBe(1);
      window.__look.calls[0].params = { conversation_id: 1 };
      expect(checkRendered("live-scenario-owner-view").scope).toBe("personal");
      answer.textContent += "正在查看";
      expect(() => checkRendered("live-scenario-owner-view")).toThrow("progress stays outside");
    } finally { vi.unstubAllGlobals(); }
  });
  it("replays the Guardian owner-view event/history contract without changing personal scope", async () => {
    const target = {};
    installMock(fixture, { fixture: { liveScenarioOwnerView: true } }, target);
    const result = await target.__TAURI_INTERNALS__.invoke("core_call", { method: "agent.history.list", params: { member_id: 0, conversation_id: 1 } });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({ source: "app", member_id: 0, conversation_id: 1 });
    expect(result.turns[0].messages.map(message => message.kind)).toEqual(["progress", "reply"]);
    expect(result.turns[0].messages[1].text).not.toContain("正在");
  });
  it("settles an approval in its source conversation after quick history is prepended", async () => {
    const target = {};
    installMock(fixture, { fixture: { adminApproval: "draft" } }, target);
    const invoke = target.__TAURI_INTERNALS__.invoke;
    const question = await invoke("agent_question_open");
    const quickBefore = structuredClone(target.__look.data.turns.find(turn => turn.conversation_id === 4));
    await invoke("agent_question_answer", { id: question.id, approved: true, drafts: question.drafts });
    const formal = (await invoke("core_call", { method: "agent.history.list", params: { member_id: 0, conversation_id: 1 } })).turns;
    expect(formal.some(turn => turn.status === "done" && turn.text.startsWith("已建立"))).toBe(true);
    expect(target.__look.data.turns.find(turn => turn.conversation_id === 4)).toEqual(quickBefore);
  });
  it("keeps reports out of today's work in both default and expanded home fixtures", async () => {
    for (const homeManyQuestions of [false, true]) {
      const target = {};
      installMock(fixture, { fixture: { homeManyQuestions } }, target);
      const home = await target.__TAURI_INTERNALS__.invoke("core_call", { method: "home.overview" });
      // Since brief 9 today is every item of the day (questions, routine runs, calendar and own events), never a report.
      expect(home.today.every(item => ["question", "routine", "event", "own"].includes(item.kind))).toBe(true);
      expect(home.today.some(item => home.reports.some(report => report.id === item.id))).toBe(false);
      expect(home.counts.today).toBe(home.today.length);
      expect(home.today.filter(item => item.kind === "question").length).toBe(homeManyQuestions ? 9 : 1);
      expect(home.today.map(item => item.at_ms)).toEqual([...home.today.map(item => item.at_ms)].sort((a, b) => a - b));
    }
  });
  it("keeps empty home spend and the sidebar status consistent and exposes connection problems", async () => {
    const target = {};
    installMock(fixture, { fixture: { homeEmpty: true, problem: true } }, target);
    const call = method => target.__TAURI_INTERNALS__.invoke("core_call", { method });
    const home = await call("home.overview"), status = await call("status.get");
    expect(home.usage.month_usd).toBe(status.spend.month_usd);
    expect(home.report.openrouter.state).toBe("no_key");
    expect(home.today).toEqual([]);
    expect(JSON.stringify(fixture.home)).not.toMatch(/\?{3}/);
  });
  it("creates the approved member in the promised group with an empty conversation", async () => {
    const target = {};
    installMock(fixture, { fixture: { adminApproval: "create" } }, target);
    const invoke = target.__TAURI_INTERNALS__.invoke;
    const question = await invoke("agent_question_open");
    await invoke("agent_question_answer", { id: question.id, approved: true });
    const roster = await invoke("core_call", { method: "members.list" });
    const created = roster.members.find(member => member.id === 8);
    expect(roster.groups.find(group => group.id === created.group_id)?.name).toBe("個人公司");
    expect(created.preview).toBe("");
    expect(created.last_at).toBeNull();
  });
  it("isolates conversations by member and turns by conversation", async () => {
    const target = {};
    installMock(fixture, {}, target);
    const call = (method, params) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
    expect((await call("conversations.list", { member_id: 1 })).conversations.map(c => c.id)).toEqual([11]);
    expect((await call("agent.history.list", { member_id: 0, conversation_id: 2 })).turns).toEqual([]);
    expect((await call("agent.history.list", { member_id: 1, conversation_id: 11 })).turns[0].member_id).toBe(1);
  });
  it("registers native event channels and emits settings changes", async () => {
    const target = {};
    installMock(fixture, {}, target);
    const events = [];
    await target.__TAURI_INTERNALS__.invoke("main_events", { channel: { onmessage(event) { events.push(event); } } });
    await target.__TAURI_INTERNALS__.invoke("device_settings_set", { patch: { appearance: "dark" } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(events[0].settings.appearance).toBe("dark");
  });
  it("fails unsupported IPC even if the app catches the rejection", async () => {
    const target = {};
    const state = installMock(fixture, {}, target);
    await expect(target.__TAURI_INTERNALS__.invoke("core_call", { method: "new.feature.list" })).rejects.toThrow("Unmocked IPC: new.feature.list");
    expect(state.errors).toEqual(["Unmocked IPC: new.feature.list"]);
  });
  it("models idle Escape cancellation while rejecting unsupported native hotkeys", async () => {
    const target = {};
    const state = installMock(fixture, {}, target);
    await expect(target.__TAURI_INTERNALS__.invoke("window_hotkey", { kind: "cancel" })).resolves.toBeUndefined();
    expect(state.calls).toContainEqual({ command: "window_hotkey", kind: "cancel" });
    expect(state.errors).toEqual([]);
    await expect(target.__TAURI_INTERNALS__.invoke("window_hotkey", { kind: "dictation_down" })).rejects.toThrow("Unmocked IPC: window_hotkey");
    await expect(target.__TAURI_INTERNALS__.invoke("window_hotkey", { kind: "unknown" })).rejects.toThrow("Unmocked IPC: window_hotkey");
    expect(state.errors).toEqual(["Unmocked IPC: window_hotkey", "Unmocked IPC: window_hotkey"]);
  });
  it("starts each scene from isolated fixture data", async () => {
    const first = {}, second = {};
    installMock(fixture, { fixture: { turns: [], problem: true }, theme: "dark", locale: "ja" }, first);
    installMock(fixture, {}, second);
    const invoke = (target, method) => target.__TAURI_INTERNALS__.invoke("core_call", { method });
    expect((await invoke(first, "agent.history.list")).turns).toEqual([]);
    expect((await invoke(first, "status.get")).openrouter.state).toBe("no_key");
    expect((await invoke(second, "agent.history.list")).turns).toHaveLength(2);
    expect((await invoke(second, "status.get")).openrouter.state).toBe("ok");
    expect((await first.__TAURI_INTERNALS__.invoke("device_settings_get")).ui_language).toBe("ja");
  });
});

describe("the apps and the private skills at the IPC boundary", () => {
  const ask = (target, method, params = {}) => target.__TAURI_INTERNALS__.invoke("core_call", { method, params });
  const toolkit = (slug, over = {}) => ({ id: `composio:${slug}`, kind: "composio", name: slug, status: "ACTIVE", enabled: true, enabled_tools: [`${slug}_one`, `${slug}_two`], disabled_tools: [], accounts: [{ id: `ca_${slug}`, status: "ACTIVE" }], ...over });
  const google = { id: "google", kind: "google", status: "ACTIVE", enabled: true, enabled_tools: ["gmail_list_messages", "calendar_list_events"], disabled_tools: [] };

  it("counts the apps whose tools can be called now and lists the others with their state, as the core's inventory does", async () => {
    const target = {};
    installMock(fixture, { fixture: { servers: [], managedConnectors: [
      toolkit("notion"), toolkit("slack", { status: "INITIALIZING" }), toolkit("linear", { status: "FAILED" }), toolkit("trello", { enabled: false }),
      toolkit("jira", { disabled_tools: ["jira_one", "jira_two"] }), google, toolkit("gmail"), toolkit("googlecalendar"),
    ] } }, target);
    const inventory = await ask(target, "integrations.inventory");
    expect(Object.fromEntries(inventory.apps.map(app => [app.id, app.state]))).toEqual({
      "composio:notion": "ready", "composio:slack": "needs_sign_in", "composio:linear": "error", "composio:trello": "disabled", "composio:jira": "no_tools",
      google: "ready", "composio:gmail": "duplicate", "composio:googlecalendar": "duplicate" });
    expect([inventory.state, inventory.count]).toEqual(["complete", 2]);
    expect(inventory.apps.filter(app => app.connected).map(app => app.id)).toEqual(["composio:notion", "google"]);
  });

  it("gives the roster of a model the same inventory and the same count as the sidebar and the page", async () => {
    const target = {};
    installMock(fixture, {}, target);
    const inventory = await ask(target, "integrations.inventory");
    const { team_context } = await ask(target, "members.list");
    expect([team_context.inventory_state, team_context.connected, team_context.apps]).toEqual(["complete", inventory.count, inventory.apps]);
    // and it moves as the core moves it: an uninstall, a tool switched off, an app switched off
    await ask(target, "connectors.disconnect", { id: "composio:notion" });
    expect((await ask(target, "integrations.inventory")).count).toBe(inventory.count - 1);
    await ask(target, "connectors.set_tools", { id: "google", enabled: false });
    const after = await ask(target, "integrations.inventory");
    expect(after.count).toBe(inventory.count - 2);
    expect((await ask(target, "members.list")).team_context.connected).toBe(after.count);
  });

  it("is an inventory that cannot be read when the scene says so", async () => {
    const target = {};
    installMock(fixture, { fixture: { inventoryUnreadable: true } }, target);
    expect(await ask(target, "integrations.inventory")).toEqual({ state: "unknown", count: null, apps: [] });
    const { team_context } = await ask(target, "members.list");
    expect([team_context.inventory_state, team_context.connected]).toEqual(["unknown", null]);
  });

  it("reads, edits, switches and deletes a skill of a member as the core does, and refuses a document it cannot keep", async () => {
    const target = {};
    const skill = (id, name, over = {}) => ({ id, member_id: 1, name, description: `Use for ${name}`, enabled: true, source: "owner/repo", ...over });
    const state = installMock(fixture, { fixture: { skills: [skill(7, "summary"), skill(8, "notes", { text: "---\nname: notes\ndescription: Use for notes\n---\nBody" })] } }, target);
    const list = async () => (await ask(target, "members.skills.list", { member_id: 1 })).skills;
    expect((await list()).map(item => Object.keys(item).includes("text"))).toEqual([false, false]); // the list holds no document
    const read = await ask(target, "members.skills.read", { member_id: 1, id: 7 });
    expect(read.text).toBe("---\nname: summary\ndescription: Use for summary\n---\n");
    expect(read.skill).toMatchObject({ id: 7, name: "summary" });
    const edited = "---\nname: summaries\ndescription: Use for a summary of a thread\n---\nStart with the verdict.";
    const answered = await ask(target, "members.skills.update", { member_id: 1, id: 7, text: edited });
    expect(answered.skill).toMatchObject({ name: "summaries", description: "Use for a summary of a thread", enabled: true });
    expect((await ask(target, "members.skills.read", { member_id: 1, id: 7 })).text).toBe(edited);
    for (const [text, message] of [["no frontmatter", "name must not be empty"], ["---\nname: x\n---\n", "description must not be empty"],
      ["---\nname: Notes\ndescription: Use\n---\n", "a skill with that name already exists"]])
      await expect(ask(target, "members.skills.update", { member_id: 1, id: 7, text })).rejects.toThrow(message);
    expect((await ask(target, "members.skills.read", { member_id: 1, id: 7 })).text).toBe(edited); // refused: nothing changed
    expect((await ask(target, "members.skills.update", { member_id: 1, id: 8, enabled: false })).skill.enabled).toBe(false);
    await expect(ask(target, "members.skills.read", { member_id: 2, id: 7 })).rejects.toThrow("no such member skill");
    expect(await ask(target, "members.skills.delete", { member_id: 1, id: 7 })).toEqual({ deleted: true });
    expect((await list()).map(item => item.id)).toEqual([8]);
    expect(state.errors).toEqual([]);
  });
});
