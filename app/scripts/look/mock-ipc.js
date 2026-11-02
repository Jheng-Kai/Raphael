// Only the native boundary is replaced; the real index.html, modules and CSS still run.
export function installMock(fixture, config = {}, target = window) {
  const data = structuredClone(fixture);
  const variant = config.fixture ?? {};
  if (variant.presence) {
    const sample = data.presenceSample;
    const base = structuredClone(data.turns.find(turn => turn.member_id === 1 && turn.conversation_id !== 4));
    const working = variant.presence === "working";
    const turn = {...base, id: 651, question: sample.question, text: working ? "" : sample.answer, status: working ? "running" : "done", task: null, steps: [], handoffs: [],
      model: "sample/model", cost_usd: .001, messages: [{seq: 1, kind: "progress", text: sample.progress, at_ms: base.created_at_ms + 1000}, ...working ? [] : [{seq: 2, kind: "reply", text: sample.answer, at_ms: base.created_at_ms + 3000}]]};
    data.turns = [turn];
    data.members.forEach(member => { member.activity = "idle"; member.activity_label = ""; member.waiting = false; });
    const states = variant.presence === "states" ? ["thinking", "working", "blocked"] : [variant.presence === "blocked" ? "blocked" : variant.presence === "colleague" ? "waiting" : working ? "working" : variant.presence === "hover" ? "searching" : "idle"];
    states.forEach((state, i) => Object.assign(data.members.find(member => member.id === i + 1), {activity: state, activity_label: state === "idle" ? "" : sample.progress, waiting: state === "blocked"}));
    if (["events", "collapse"].includes(variant.presence)) {
      data.routines.find(routine => routine.id === 2).title = sample.routine;
      turn.messages = Array.from({length: variant.presence === "collapse" ? 3 : 1}, (_, i) => ({seq: i + 1, kind: "event", text: JSON.stringify({type: "routine", action: "created", id: 2, name: sample.routine}), at_ms: turn.created_at_ms + i}));
    }
    if (variant.presence === "calendar") turn.messages = [{seq: 1, kind: "event", text: JSON.stringify({type: "calendar", action: "created", id: 1, name: sample.calendar, date: "2026-10-24"}), at_ms: turn.created_at_ms}];
    if (variant.presence === "spacing") turn.messages = [
      {kind: "event", text: JSON.stringify({type: "routine", action: "created", id: 2, name: sample.routine})},
      {kind: "reply", text: sample.answer},
      {kind: "event", text: JSON.stringify({type: "routine", action: "updated", id: 2, name: sample.routine})},
      {kind: "media", text: JSON.stringify({type: "link", url: sample.source, title: sample.routine, description: sample.answer})},
      {kind: "event", text: JSON.stringify({type: "calendar", action: "created", id: 1, name: sample.calendar, date: "2026-10-24"})},
      {kind: "event", text: JSON.stringify({type: "routine", action: "deleted", id: 2, name: sample.routine})},
      {kind: "reply", text: sample.answer},
    ].map((message, index) => ({...message, seq: index + 1, at_ms: turn.created_at_ms + index}));
    if (variant.presence === "detail") turn.messages.push({seq: 3, kind: "reply", text: sample.secondAnswer, at_ms: turn.created_at_ms + 3000});
    if (variant.presence === "gap") data.turns.push(...[5,35].map((minutes, i) => ({...structuredClone(turn), id: 652 + i, created_at_ms: turn.created_at_ms + minutes * 60000})));
    data.rooms.forEach(room => { room.preview = sample.answer; room.preview_member_id = 1; });
  }
  const routineEventChoices = variant.noEventApps ? [] : [
    {id:'gmail-mail',toolkit:'gmail',slug:'GMAIL_FETCH_EMAILS',input:'',label:'新郵件',app:'composio:gmail',app_name:'Gmail'},
    {id:'calendar-event',toolkit:'googlecalendar',slug:'GOOGLECALENDAR_EVENTS_LIST',input:'',label:'新行程',app:'composio:googlecalendar',app_name:'Google 日曆'},
    {id:'github-failure',toolkit:'github',slug:'GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY',input:'repository',label:'工作流程失敗',app:'composio:github',app_name:'GitHub'},
    {id:'slack-message',toolkit:'slack',slug:'SLACK_FETCH_CONVERSATION_HISTORY',input:'channel',label:'頻道新訊息',app:'composio:slack',app_name:'Slack'},
  ];
  if (variant.menuMoveFlip) data.groups[1].name = data.handoffGroupSample.menuGroup;
  if (variant.polishData) data.history = Array.from({length:25}, (_,i)=>({...data.history[0], id:i+1, created_at_ms:data.now+i*1000, text:`Synthetic dictation ${i+1}` + (i===24 ? " Example text for checking the two-line preview. ".repeat(30) : "")})).reverse();
  if (variant.polishSearch) {
    data.turns = [0,1].flatMap(member=>Array.from({length:205},(_,i)=>({...structuredClone(data.turns.find(t=>(t.member_id??0)===member && t.conversation_id!==4)), id:1000+member*1000+i, question:`Synthetic ${i} needle`, text:'needle and needle', messages:[], attachments:[], steps:[], session_id:`polish-${member}-${i}`, status:'done', member_id:member})));
    data.messages = Array.from({length:105},(_,i)=>({...structuredClone(data.messages[0]), id:3000+i, room_id:1, text:`Synthetic ${i} needle and needle`, status:'done'}));
  }
  if (variant.polishVoice) {
    Object.defineProperty(target.navigator, 'mediaDevices', {configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
    target.MediaRecorder = class { state='inactive'; start(){this.state='recording';} stop(){this.state='inactive';this.onstop?.();} };
    target.AudioContext = class { async decodeAudioData(){return {numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array([0])};} async close(){} };
  }
  if (variant.missingSearch) data.serviceStatus.search.options.push({id: "searxng", needs_key: false, has_key: false, key_optional: false});
  if (variant.missingVision) data.serviceStatus.vision.supports_images = false;
  if (variant.missingModelList) data.clis = data.clis.map(cli => cli.id === "codex" ? {...cli, installed: true, available: true, models: []} : cli);
  if (variant.richReply) {
    const source = data.richContent[variant.richReply === true ? "reply" : variant.richReply];
    data.turns = [0, 1].map((member, index) => ({ ...structuredClone(data.turns.find(turn => (turn.member_id ?? 0) === member && turn.conversation_id !== 4)), id: 701 + index,
      member_id: member, text: source, question: "請整理研究資料，並提供表格與流程。", status: "done", route: "answer", steps: [],
      messages: [{ seq: 1, kind: "reply", text: source, at_ms: data.now }], attachments: [] }));
    data.messages = [{ ...structuredClone(data.messages.find(message => message.member_id !== null)), id: 701, member_id: 1, text: source, kind: "message", status: "done", attachments: [] }];
  }
  let codexArrived = false, codexTimer;
  const desktopSessions = new Map();
  let desktopSequence = 0;
  let teaching;
  for (const [key, value] of Object.entries(variant)) if (key in data) data[key] = structuredClone(value);
  if (variant.routineSentence && variant.routineSentence !== "waiting") {
    const routine = data.routines.find(r => r.member_id === 1);
    const template = data.turns.find(t => t.member_id === 1);
    data.turns.push({...structuredClone(template),id:990,member_id:1,source:'routine',route:'routine',question:routine.title,
      session_id:`routine:${routine.id}`,routine:structuredClone(routine),status:'error',text:'範例工作未完成，可開啟例行任務檢查。',messages:[],steps:[],task:null});
  }
  if (variant.fullPermission) data.settings.action_mode = "bypass";
  if (variant.mediaModels) {
    const media = { ...data.catalog.llm[0], id: "google/gemini-image", name: "Gemini Image", provider: "Google", provider_id: "openrouter", provider_name: "OpenRouter",
      roles: {}, input_per_mtok: 2, output_per_mtok: 12, image_output_per_mtok: 30, reasoning_efforts: [], default_effort: null };
    const unit = { ...media, provider: "Example", input_per_mtok: null, output_per_mtok: null, image_output_per_mtok: null };
    data.catalog.image = [media, { ...unit, id: "test/image-unit", name: "圖片單價範例", per_image: .04 },
      { ...unit, id: "test/image-request", name: "請求單價範例", per_request: .025 }];
    data.catalog.video = [];
    data.settings.image_model = ""; data.settings.video_model = "";
    if (variant.mediaModels === "set") {
      data.providers.push({ id: "media-openai", kind: "openai", name: "OpenAI", enabled: true, has_key: true, status: "ok", models: 1, base_url: "https://api.openai.com/v1" });
      data.catalog.video = [{ ...media, id: "@media-openai:sora-test", name: "影片模型範例", provider: "OpenAI", provider_id: "media-openai", provider_name: "OpenAI",
        input_per_mtok: null, output_per_mtok: null, image_output_per_mtok: null, per_request: .12 }];
      data.settings.image_model = "google/gemini-image";
      data.settings.video_model = "@media-openai:sora-test";
    }
  }
  if (variant.pluginsMany) {
    const base = [...data.pluginCatalog];
    for (let i = 0; i < data.pluginCatalogLoad.count; i++) {
      const item = base[i % base.length], category = data.pluginCategories[i % data.pluginCategories.length].id;
      data.pluginCatalog.push({ ...item, slug: `${item.slug}-${i}`, name: `${item.name} ${String(i + 1).padStart(3, "0")}`,
        categories: [category, data.pluginCategories[(i + 1) % data.pluginCategories.length].id] });
    }
    data.pluginCatalog.push(data.pluginCatalog[6]);
  }
  Object.assign(data.device, { appearance: config.theme ?? "light", ui_language: config.locale ?? "zh-TW", onboarded: !variant.onboarding });
  if (variant.ownerVoice) data.conversations.push(structuredClone(data.ownerRound.memberConversation));
  if (variant.ownerEmptyRecords) data.turns.push(...structuredClone(data.ownerRound.emptyRecords));
  if (variant.liveScenarioOwnerView) data.turns = structuredClone(data.liveScenarioOwnerTurns);
  if (variant.sidebarMany) {
    const roster = data.sidebarRoster;
    data.members = roster.members.map((member, position) => ({ ...structuredClone(data.members.find(item => item.id === member.id) ?? data.members[1]), ...member, position }));
    data.groups = structuredClone(roster.groups);
    for (const cli of data.clis) if (roster.models[cli.id]) cli.models.push(structuredClone(roster.models[cli.id]));
    data.settings.agent_model = "cli:codex:gpt-6.1-sol?effort=high";
  }
  if (variant.sidebarUnread) {
    data.members[1].unread = true;
    data.members[1].last_at = data.now;
    data.messages.push({ ...data.messages.at(-1), id: Math.max(...data.messages.map(message => message.id)) + 1, room_id: data.rooms[0].id, text: "週五計畫已準備完成", created: data.now, status: "done" });
  }
  if (variant.onlyRaphael) data.members = data.members.filter(member => member.id === 0);
  if (variant.chatgptSignedIn) {
    data.chatgpt = { signed_in: true, email: "owner@example.test", plan_scope_granted: true };
    data.settings.agent_model = "@chatgpt:gpt-6-sol?effort=medium";
    data.settings.quick_model = "";
  }
  if (variant.modelsMany) {
    for (let index = 1; index <= 40; index++) data.catalog.llm.push({ ...data.catalog.llm[0], id: `maker/model-${index}`, name: `Model ${index}`, created_at_ms: index });
    data.catalog.llm.push({ ...data.catalog.llm[0], id: "maker/no-depth", name: "Model 99", created_at_ms: 99, reasoning_efforts: [], default_effort: null });
  }
  if (variant.waitingMember !== undefined) data.members.find(member => member.id === variant.waitingMember).waiting = true;
  // The owner's primary contact: Raphael until another member is chosen (`primaryMember` seeds it). The roster says it, as the core does.
  data.primaryId = variant.primaryMember ?? 0;
  data.roomWrapupMessage.member_id = data.primaryId;
  if (variant.problem) data.status.openrouter.state = "no_key";
  let adminQuestion = variant.adminApproval ? data.adminQuestions[variant.adminApproval] : null;
  let adminTurn = adminQuestion ? data.turns.find(turn => turn.id === adminQuestion.turn_id) : null;
  if (variant.unconfiguredRaphael) {
    data.members = [{ ...data.members[0], profile_ready: false }];
    data.groups = [];
    data.turns = [];
    adminQuestion = adminTurn = null;
  }
  if (adminQuestion && !adminTurn) throw new Error("Approval fixture requires its explicit source turn");
  if (adminQuestion) {
    adminTurn.status = "confirm";
    adminTurn.messages = adminTurn.messages.filter(message => message.kind !== "reply");
    adminTurn.text = "";
  }
  if (variant.running || variant.quickRunning) {
    const conversation = data.conversations.find(item => item.member_id === (variant.runningMember ?? 0) && (variant.quickRunning ? item.kind === "quick" : item.is_default));
    const runningTurn = data.turns.find(turn => turn.member_id === conversation?.member_id && turn.conversation_id === conversation?.id);
    runningTurn.status = "running";
    // "fresh": the reply has only just started, before any step or progress line.
    runningTurn.messages = variant.running === "fresh" ? [] : runningTurn.messages.filter(message => message.kind !== "reply");
    if (variant.running === "fresh") runningTurn.steps = [];
    runningTurn.text = "";
    if (variant.generatedProgress) {
      runningTurn.question = "請製作辦公室宣傳影片。";
      runningTurn.messages = [{seq:1,kind:"progress",text:"正在製作影片 · 40%",at_ms:data.now - 1000}];
      runningTurn.steps = [{kind:"tool",tool:"video_generate",server:"media",outcome:"in_progress",ms:0,at_ms:data.now - 3000}];
    }
    if (variant.stopBackground) {
      runningTurn.status = "done";
      runningTurn.task = { id: 71, state: "running", started_at_ms: data.now - 5000, finished_at_ms: null };
    }
    if (variant.linkedThread) {
      // A long conversation the way a team leaves it: earlier replies hold links, and the newest turn's work is still running.
      const link = variant.linkedThreadURL;
      const reply = (id, at) => ({ ...structuredClone(runningTurn), id, status: "done", task: null, steps: [], session_id: `linked-${id}`, created_at_ms: at, question: `第 ${id} 個問題`,
        text: `已依[新參考規格](${link})整理好第 ${id} 項。\n\n${link}`, detail: null, messages: [{ seq: 1, kind: "reply", text: `已依[新參考規格](${link})整理好第 ${id} 項。\n\n${link}`, at_ms: at }] });
      for (let index = 0; index < variant.linkedThread; index++) data.turns.push(reply(100000 + index, data.now - (variant.linkedThread - index) * 60_000));
      runningTurn.id = 200000;
      runningTurn.created_at_ms = data.now - 30_000;
      runningTurn.text = `已派發[新參考規格](${link})給團隊。`;
      runningTurn.messages = [{ seq: 1, kind: "reply", text: runningTurn.text, at_ms: data.now - 29_000 }];
    }
  }
  if (variant.linkedRoom) {
    const source = data.messages.find(message => message.room_id === 1 && message.member_id !== null);
    data.messages = Array.from({ length: variant.linkedRoom }, (_, index) => ({ ...structuredClone(source), id: 100000 + index,
      created: data.now - (variant.linkedRoom - index) * 60000, status: "done", turn: null,
      text: `${variant.linkedRoomText} ${variant.linkedRoomURL}` }));
  }
  // Turns the core writes later and then announces (agent.turn), such as an Alt+Space answer.
  const arrivals = new Map((variant.arrivals ?? []).map(turn => [turn.id, structuredClone(turn)]));
  const pendingReplies = new Map();
  if (variant.p04Blocked) {
    data.roomHandoffs=[{...data.roomHandoff,state:"failed",reason:"missing_artifact",result:"",evidence:[]}];
    data.messages.at(-1).text="尚未取得檔案，目前沒有可驗收結果。";
    data.messages.push({...data.roomWrapupMessage,reply_to:null,reply_to_member:null,text:"目前沒有可驗收的成果。小晴的檔案尚未完成，補齊後可以重新驗收，要不要重試由你決定。"});
  }
  if (variant.p04Short) {
    data.messages=[data.messages[0],{...data.messages[1],text:"目前沒有交付成果，需要先取得來源權限。"},
      {...data.roomWrapupMessage,reply_to:null,reply_to_member:null,text:"目前沒有可驗收的成果。小晴還需要來源的權限，取得後就會處理。"}];
  }
  if (variant.roomThinking) { data.messages.push(...data.roomThinkingMessages); data.roomExchanges.push(data.roomActiveExchange); }
  if (variant.p03Handoff) {
    const task = { ...data.roomHandoff, state: variant.p03Handoff };
    data.messages = [data.messages[0], { ...data.messages[1], member_id: 0, text: "請小晴立即整理驗收報告。" }];
    if (variant.p03SourceDates) data.messages[0].text = "來源寫明早截止、明天中午提交。現在就開始整理驗收報告。";
    if (task.state !== "done") { task.result = ""; task.evidence = []; }
    if (task.state === "failed") task.reason = "work_without_action";
    data.roomHandoffs = [task];
    if (task.state === "running") data.messages.push({ ...data.roomThinkingMessages[0], turn_id: task.work_turn_id });
    if (task.state === "done") data.messages.push({ ...data.messages[1], id: 4, member_id: 1, turn_id: task.work_turn_id, text: task.result, created: task.created_at_ms + 1000 });
    if (variant.p03Private) {
      const source = data.turns.find(turn => turn.member_id === 0 && turn.conversation_id === 1);
      data.turns = [{ ...source, question: "請小晴立即整理驗收報告。", text: "", detail: null, messages: [], handoffs: [task] }];
    }
  }
  if (variant.p02Meeting) data.turns.find(turn => turn.member_id === 0 && turn.conversation_id === 1).messages.push({ seq: 99, kind: "event", text: JSON.stringify(data.p02MeetingEvent), at_ms: data.now });
  if (variant.splitReply) {
    // The core writes a long reply as messages of one 《答。…》 line (agent/service.py `_message`).
    const turn = data.turns.find(turn => turn.id === 1), reply = turn.messages.find(message => message.kind === "reply");
    const [first, last] = reply.text.split("\n\n我已");
    turn.messages = [...turn.messages.filter(message => message !== reply), { ...reply, text: first }, { ...reply, seq: reply.seq + 1, text: `我已${last}`, at_ms: reply.at_ms + 500 }];
  }
  if (variant.systemEvents) {
    const turn = data.turns.find(turn => turn.id === 1);
    turn.handoffs = [{ ...data.roomHandoff, state: "done" }, { ...data.roomHandoff, task_id: 43, member_id: 2, member_name: "小森", mode: "consult", state: "running", result: "", evidence: [] }];
    turn.messages.push({ seq: 99, kind: "event", text: JSON.stringify(data.p02MeetingEvent), at_ms: data.now });
  }
  if (variant.handoffGroup) {
    const many = variant.handoffGroup === "many", done = variant.handoffGroup === "done";
    const sample = data.handoffGroupSample, people = variant.handoffGroup === "long" ? sample.longPeople : sample.people;
    data.members.push(...people.slice(3).map((name, i) => ({ ...data.members[1], id: i + 4, name })));
    data.members.forEach(member => { if (member.id > 0) member.name = people[member.id - 1]; });
    const tasks = Array.from({ length: many ? 6 : 10 }, (_, i) => ({ ...structuredClone(data.roomHandoff),
      task_id: 800 + i, work_turn_id: 900 + i, member_id: i % (many ? 6 : 4) + 1, member_name: people[i % (many ? 6 : 4)],
      mode: i % 2 ? "consult" : "work", request: sample.consult, result: sample.result,
      state: done || many ? "done" : ["done", "running", "waiting", "failed"][i % 4], waiting_owner: !done && !many && i === 2 ? 1 : 0,
      created_at_ms: data.roomHandoff.created_at_ms + i, evidence: [{ kind: "artifact", uri: "reports/sample.html", digest: "sample", verdict: "verified" }] }));
    const turn = data.turns.find(turn => turn.id === 1);
    data.turns = [{ ...turn, question: sample.request, text: sample.answer, messages: [], steps: [], handoffs: tasks }];
    if (variant.handoffGroup === "room") {
      data.roomHandoffs = tasks;
      const first = { ...data.messages[0], created: tasks[0].created_at_ms - 1, text: sample.request };
      data.messages = [first, { ...data.messages[1], id: 800, created: tasks[4].created_at_ms + .5, text: sample.separator }];
    }
  }
  // A task that waits for an app shows its connector card; `cardSignIn` "approve" finishes the sign-in the
  // way the core reports it (authorizing, then connected) and adds the turn that resumes the task.
  if (variant.connectorCard) {
    const turn = structuredClone(data.connectorTurns[variant.connectorCard]);
    if (variant.connectorMember) Object.assign(turn, { member_id: variant.connectorMember,
      conversation_id: data.conversations.find(item => item.member_id === variant.connectorMember && item.is_default).id, prefix: "" });
    data.turns.push(turn);
  }
  // A task that waits for a key shows its secret card, and one paused for the owner's hands its computer card. The
  // fixture reports their states as the core does and keeps only the states: the key typed into a card is
  // received by `integrations.card_save` and forgotten (`resumeFails`: the task does not continue; `signedIn`:
  // the page no longer asks for the sign-in when the owner presses 我完成了).
  if (variant.secretCard) data.turns.push(structuredClone(data.secretTurns[variant.secretCard]));
  if (variant.mcpProposal) {
    const card = structuredClone(data.mcpProposalCard);
    if (variant.mcpProposal === "stdio") Object.assign(card.fields, { transport: "stdio", command: "sample-mcp", args: ["--stdio"], url: "" });
    if (variant.mcpProposal === "secret") card.fields.headers = ["Authorization"];
    const turn = { ...structuredClone(data.turns.find(turn => turn.member_id === 1 && turn.conversation_id === 11)),
      id: 946, session_id: "sample-mcp", question: "連接 Sample，查詢一筆範例資料。", text: "請確認這個連線。", status: "done", messages: [], steps: [], connection_proposals: [card] };
    data.turns = [turn];
    if (variant.mcpProposal === "secret") turn.secrets = [{ ...structuredClone(data.secretTurns.notion.secrets[0]), id: "card-mcp-key", name: "Sample", secret: "Authorization" }];
    if (variant.mcpProposal === "room") data.messages.push({ ...structuredClone(data.messages.find(message => message.member_id === 1)), id: 946, room_id: 1, text: turn.text, status: "done", turn_id: turn.id, turn });
  }
  if (variant.loginCard) {
    const turn = structuredClone(data.secretTurns.notion);
    Object.assign(turn, {id: 132, member_id: 1, conversation_id: 11, question: "請登入研究網站。", text: "請在安全卡片儲存登入資料，完成後我會接著工作。", steps: [], messages: []});
    turn.secrets = [{...turn.secrets[0], id: "card-login", name: "https://research.example", secret: "login", login: true}];
    data.turns.push(turn);
  }
  if (variant.ownerQuestion) {
    const question = structuredClone(data.ownerQuestionCard);
    const turn = { ...structuredClone(data.turns.find(turn => turn.member_id === 1 && turn.conversation_id === 11)),
      id: question.turn_id, session_id: "owner-question", question: "請幫我整理並寄出報告。", route: "delegate", source: variant.ownerQuestion === "background" ? "routine" : "app",
      text: "報告已整理完成，需要你決定寄出的日期。", detail: null, messages: [], steps: [], owner_questions: [question], status: variant.ownerQuestion === "background" ? "running" : "done",
      task: { id: question.task_id, state: "waiting", waiting_owner: 1, started_at_ms: data.now - 20000, created_at_ms: data.now - 20000, finished_at_ms: null } };
    if (variant.routineSentence === "waiting") {
      const routine = data.routines.find(r => r.member_id === 1);
      Object.assign(turn, {routine:structuredClone(routine),route:"routine",question:routine.title,session_id:`routine:${routine.id}`});
    }
    data.turns = [turn];
    if (variant.ownerQuestion === "room") data.messages.push({ ...structuredClone(data.messages.find(message => message.member_id === 1)), id: 940, room_id: 1, text: turn.text, status: "done", turn_id: turn.id, turn });
  }
  if (variant.computerCard) data.turns.push(structuredClone(data.computerTurns[variant.computerCard]));
  // A step that needs the owner's yes shows its permission card, and the question it follows is the one the window holds
  // (`agent_question_open`), answered with `agent_question_answer`; the card follows the answer as the core reports it.
  // `memberDraftFirst` sets whether 小晴 writes mail as a draft first.
  let permission = null;
  const messagePreview = { workspace: "範例工作室", to: "#規劃", thread: "123.456", body: "請確認範例排程，並回覆方便討論的時間。" };
  if (variant.permissionCard) {
    const made = structuredClone(data.permissionTurns[variant.permissionCard]);
    if (variant.cardMessagePreview) Object.assign(made.turn.permissions[0], { service: "Slack", tool: "SLACK_SEND_MESSAGE", summary: "透過 Slack 傳送規劃訊息。", message: messagePreview });
    data.turns.push(made.turn);
    permission = { ...made, card: made.turn.permissions[0] };
  }
  let localQuestion = null;
  if (variant.localCommand) {
    const made = structuredClone(data.permissionTurns.local), card = made.turn.permissions[0];
    card.service = data.members.find(member => member.id === 1).name;
    if (variant.localCommand === "later") { card.kind = "local_command"; card.always = false; }
    if (variant.localCommand === "background") {
      card.source = "background"; card.expires_at_ms = data.now + 1800000;
      localQuestion = { id: card.id, task_id: 920, member_id: 1, prefix: "問", text: card.summary, tier: "T2", created_at_ms: data.now, expires_at_ms: card.expires_at_ms, permission: card };
    } else {
      data.turns.push(made.turn);
      permission = { ...made, card };
    }
  }
  if (variant.memberDraftFirst !== undefined) data.members.find(member => member.id === 1).draft_first = variant.memberDraftFirst;
  // A member's email draft is a card in its chat. The fixture keeps the states and the digests only: what the owner types
  // is received by `integrations.draft_save` as a new version, and nothing is ever sent (`sent` lists what 傳送 would send).
  // `mailOffer` has the member ask whether 小森 may send it.
  if (variant.mailDraft) {
    const mail = structuredClone(data.mailTurns[variant.mailDraft]);
    if (typeof variant.mailCopy === "string") mail.drafts[0].cc = variant.mailCopy;
    if (variant.missingMail) mail.drafts[0].senders = [];
    if (variant.mailOffer) mail.drafts[0].offer = { member_id: 2, name: data.members.find(member => member.id === 2).name };
    data.turns.push(mail);
    if (!data.conversations.some(item => item.id === data.colleagueConversation.id)) data.conversations.push(structuredClone(data.colleagueConversation));
  }
  if (variant.pageTurn) {
    const base = data.turns.find(turn => turn.member_id === 1);
    data.turns.push({ ...structuredClone(base), id: 801, question: "幫我找一個輕量後背包。", text: "這款符合你的需求,可以直接在下面操作。", status: "done", route: "answer", steps: [],
      messages: [{ seq: 1, kind: "reply", text: "這款符合你的需求,可以直接在下面操作。", at_ms: data.now }], attachments: [],
      pages: [{ id: "page-product", title: "輕量後背包", rev: 1, height: 320, source: "html", server: null, fallback: "輕量後背包 NT$ 1,280,防潑水、重量 480 公克。" }] });
  }
  if (variant.roomOwnerCard) {
    const kind = variant.roomOwnerCard;
    const base = kind === "connect" ? data.connectorTurns.gmail : kind === "secret" ? data.secretTurns.notion : kind === "mail" ? data.mailTurns.draft : data.turns.at(-1);
    const turn = { ...structuredClone(base), id: 950, member_id: 1, scope: "room", room_id: 1, conversation_id: null, steps: [] };
    if (kind === "result") turn.task = {id:950,state:"done"};
    if (kind === "page") {
      turn.owner_questions = [{ ...structuredClone(data.ownerQuestionCard), id: "room-page-q", task_id: 950, turn_id: turn.id,
        kind: "show_page", card_id: "page-product", question: "請在頁面選擇商品。", options: [] }];
      turn.task = { id: 950, state: "waiting", waiting_owner: 1 };
    }
    data.turns = [turn];
    data.messages = [{ ...structuredClone(data.messages.find(message => message.member_id === 1)), id: 950, room_id: 1, member_id: 1, text: turn.text, status: "done", turn_id: turn.id, turn }];
  }
  if (variant.colleagues) {
    // 小森 asked 小晴 from its own chat; 小晴's main chat shows each question where it came.
    data.conversations.push(data.colleagueConversation);
    data.turns.push(data.colleagueTurn, ...data.colleagueExchanges.slice(0, variant.colleagues));
  }
  if (variant.p02Roles) data.rooms[0].roles = data.p02Roles;
  if (variant.p02Blocked || variant.p02Fallback || variant.p02LongExchange) {
    const exchange = { ...data.roomActiveExchange, state: "stopped", active_turn: null };
    if (variant.p02Blocked) {
      // 小森's first reply hit the CLI rate limit; the owner then stopped a second request.
      data.messages = [data.messages[0], data.messages[1], data.p02BlockedMessage];
      exchange.origin_message_id = data.p02BlockedMessage.id;
      exchange.reply_intents = data.p02BlockedIntents;
    }
    if (variant.p02Fallback) exchange.routing = { fallback: "timeout", model: "fixture/router" };
    if (variant.p02LongExchange) { exchange.turns_taken = 8; exchange.hops = 5; exchange.state = "done"; exchange.reply_intents = [{ id: 100, recipient_id: 1, recipient_name: data.members[1].name, state: "done", reason: "" }]; }
    data.roomExchanges.push(exchange);
  }
  if (variant.roomDiscussion || variant.roomWrapup) data.messages.push(...data.roomDiscussionMessages);
  if (variant.roomWrapup) data.messages.push(data.roomWrapupMessage);
  if (variant.roomMissingSource) data.messages[2].reply_reference = { message_id: 999, unavailable: true };
  if (variant.usageFishVoice) { data.settings.tts_enabled = true; data.settings.tts_service = "fish"; }
  if (variant.usageEmpty) {
    data.spendRows = [];
    data.status.spend.month_usd = 0;
    data.usage.total = 0;
    data.usage.summary = Object.fromEntries(Object.keys(data.usage.summary).map(key => [key, 0]));
    data.usage.groups = Object.fromEntries(Object.keys(data.usage.groups).map(key => [key, []]));
  }
  if (variant.homeManyQuestions) {
    data.home.today.unshift(...[3, 4].map(id => ({ ...data.home.today[0], id: `question:${id}`, turn_id: id,
      title: id === 3 ? "確認資料來源範圍" : "核准後續研究安排" })));
    data.home.counts.today = data.home.today.length;
  }
  if (variant.calendarSparse) data.routines = data.routines.slice(0, 1);
  if (variant.calendarAllDay) {
    const event = data.home.calendar.find(item => item.kind === "event");
    if (event) data.home.calendar.push({ ...event, id: "event:all-day", title: "素材整理日", all_day: true });
  }
  if (variant.longOwner || variant.longReply || variant.rawReplyEnvelope) {
    const turn = data.turns.find(turn => turn.member_id === (variant.longReply ? 1 : 0) && turn.conversation_id !== 4);
    const text = Array.from({ length: 12 }, (_, index) => `${index + 1}. 整理每日新聞素材：先閱讀來源與發表日期，再核對事件發生時間。保留原始連結、重點摘要與尚待確認的資訊。\n\n將已確認的素材依主題整理，為下一次編輯保留完整脈絡。`).join("\n\n");
    if (variant.longOwner) turn.question = text;
    if (variant.longReply || variant.rawReplyEnvelope) {
      turn.text = variant.rawReplyEnvelope ? JSON.stringify({ text: "Gmail 需要先連線。", messages: ["Gmail 需要先連線。"], say_ja: "接続が必要です。" }) : text;
      turn.messages = [{ seq: 1, kind: "reply", text: turn.text, at_ms: turn.created_at_ms }];
    }
  }
  if (variant.splitReplies) {
    const turn = data.turns.find(turn => turn.member_id === 1 && turn.conversation_id !== 4);
    const parts = ["我先核對了來源與時間。", "接著確認資料：\n\n- 第一個來源已更新\n- 第二個來源日期一致", "最後一步保留完整範例：\n\n```ts\nconst ready = true;\n```"];
    turn.text = parts.at(-1);
    turn.messages = parts.map((text, index) => ({ seq: index + 1, kind: "reply", text, at_ms: turn.created_at_ms + index }));
  }
  if (variant.longRoomMessages) {
    const text = Array.from({ length: 12 }, (_, index) => `${index + 1}. 整理每日新聞素材：核對來源、日期與重點，再保留下一次編輯需要的完整脈絡。\n\n完成後依主題整理，確認所有素材都有可追溯的來源。`).join("\n\n");
    for (const message of data.messages.slice(0, 2)) message.text = text;
  }
  const own = (id, title, start, end, more = {}) => ({ id: `own:${id}`, kind: "own", event_id: id, title, summary: "", at_ms: start, end_ms: end, member_id: -1, name: "", avatar: "", turn_id: null, conversation_id: null, routine_id: null, all_day: false, notes: "", added_by: null, ...more });
  const octoberAt = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
  const addedBy = id => { const person = data.members.find(member => member.id === id); return { member_id: id, added_by: id, name: person.name, avatar: person.avatar ?? "" }; };
  const daily = structuredClone(data.home.calendar.find(item => item.kind === "routine" && item.routine_id === 1));
  const routineTime = new Date(daily.at_ms); routineTime.setHours(9, 0, 0, 0);
  daily.at_ms = routineTime.getTime(); daily.id = `routine:1:${daily.at_ms}`;
  const eventAt = (day, hour) => new Date(2026, 9, day, hour).getTime();
  data.home.calendar_google = variant.calendarGoogle ?? "connected";
  data.home.calendar_events = [
    ...data.home.calendar.filter(item => item.kind === "event"),
    ...[["month-start",2,10,"月初規劃"],["month-end",30,15,"月末回顧"],["busy-1",24,10,"設計審查"],["busy-2",24,11,"衝刺規劃"],["busy-3",24,16,"研究同步"]].map(([id,day,hour,title]) => ({...daily,id:`event:${id}`,kind:"event",routine_id:null,at_ms:eventAt(day,hour),end_ms:eventAt(day,hour)+3600000,title})),
    own(1, "牙醫回診", octoberAt(24, 14), octoberAt(24, 15), { notes: "帶健保卡，診所在中山路。" }),
    own(2, "供應商會議", octoberAt(23, 13), octoberAt(23, 14, 30), { ...addedBy(1), notes: "從今天的信件整理：對方想確認交期。" }),
    own(3, "交付截止日", octoberAt(22, 0), octoberAt(23, 0), { all_day: true }),
  ];
  if (variant.presence === "calendar") data.home.calendar_events.find(item => item.id === "own:1").title = data.presenceSample.calendar;
  if (variant.calendarGoogle && variant.calendarGoogle !== "connected") data.home.calendar_events = data.home.calendar_events.filter(item => item.kind === "own");
  if (variant.homeOwnEvents) {
    const preview = data.home.calendar_events.find(item => item.id === "own:1");
    preview.at_ms = octoberAt(24, 9, 30); preview.end_ms = octoberAt(24, 10, 30);
  }
  if (variant.calendarBusy) data.home.calendar_events.push(
    own(11, "產品審查", octoberAt(21, 9), octoberAt(21, 10, 30)),
    own(12, "與小晴對齊", octoberAt(21, 9, 30), octoberAt(21, 10), addedBy(1)),
    own(13, "客戶來電", octoberAt(21, 10), octoberAt(21, 11)),
    own(14, "午餐", octoberAt(20, 12), octoberAt(20, 12, 30)),
    own(15, "簽核", octoberAt(20, 12, 15), octoberAt(20, 12, 45)),
    own(16, "寄出合約", octoberAt(20, 12, 30), octoberAt(20, 13)),
    own(17, "校對標題非常長的一份文件與所有附件", octoberAt(19, 15), octoberAt(19, 17)),
    own(18, "出差台中", octoberAt(19, 0), octoberAt(22, 0), { all_day: true }),
    own(19, "展會", octoberAt(20, 0), octoberAt(21, 0), { all_day: true }),
    own(20, "換季盤點", octoberAt(20, 0), octoberAt(21, 0), { all_day: true }),
    own(21, "發薪日", octoberAt(20, 0), octoberAt(21, 0), { all_day: true }),
    ...[8, 9, 10, 11, 13, 14, 16].map((hour, index) => own(30 + index, `第 ${index + 1} 場訪談`, octoberAt(28, hour), octoberAt(28, hour + 1))),
  );
  const reproject = () => {
    const monthly = [...(variant.homeSparse || variant.homeEmpty ? [] : [daily]), ...data.home.calendar_events].sort((a,b)=>a.at_ms-b.at_ms);
    data.home.calendar_counts = {};
    data.home.calendar_items = monthly.filter(item => {
      const key = new Date(item.at_ms).toISOString().slice(0,10);
      data.home.calendar_counts[key] = (data.home.calendar_counts[key] ?? 0) + 1;
      return data.home.calendar_counts[key] <= 3;
    });
    data.home.calendar_days = Object.keys(data.home.calendar_counts);
  };
  reproject();
  if (variant.calendarRhythm) {
    const rhythm = { id:91, member_id:1, title:"Gmail 與行程檢查", prompt:"整理樣本狀態。", schedule:{kind:"every",hours:3,from:"08:00",to:"23:00"}, enabled:true,last_run:octoberAt(24,14),next_run:octoberAt(24,17) };
    data.routines = [rhythm,{...rhythm,id:92,title:"每日摘要",schedule:{kind:"daily",time:"09:00"},next_run:octoberAt(24,9)}];
    data.routineRuns = [[8,"done"],[11,"error"],[14,"confirm"]].map(([hour,status],i)=>({id:901+i,routine_id:91,scheduled:octoberAt(24,hour),started:octoberAt(24,hour),finished:status==="confirm"?null:octoberAt(24,hour)+60000,status,turn_id:2,summary:"樣本報告",cost:0}));
    data.home.calendar_events = [own(80,"樣本整理日",octoberAt(24,0),octoberAt(25,0),{all_day:true})];
    const person = data.members.find(m=>m.id===1);
    const bars=Array.from({length:42},(_,i)=>{
      const day=new Date(2026,8,28+i), key=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
      return {...daily,id:`rhythm:91:${key}`,routine_id:91,title:rhythm.title,member_id:1,name:person.name,avatar:person.avatar,at_ms:day.getTime(),end_ms:new Date(day.getFullYear(),day.getMonth(),day.getDate()+1).getTime(),all_day:true,rhythm:true,rhythm_schedule:rhythm.schedule};
    });
    const exceptions=data.routineRuns.filter(r=>r.status!=="done").map(r=>({...daily,id:`routine:91:${r.scheduled}`,routine_id:91,title:rhythm.title,at_ms:r.scheduled,member_id:1,name:person.name,avatar:person.avatar,run_status:r.status,all_day:false}));
    data.home.calendar_items=[...data.home.calendar_events,...bars,...exceptions];
    data.home.calendar_counts=Object.fromEntries(bars.map(b=>[new Date(b.at_ms+43200000).toISOString().slice(0,10),1]));
    data.home.calendar_counts['2026-10-24']=4;
    data.home.calendar_days=Object.keys(data.home.calendar_counts);
  }
  if (variant.calendarComposio) {
    data.managedConnectors = data.managedConnectors.filter(c=>c.id!=="google" && c.id!=="composio:googlecalendar");
    data.managedConnectors.push({id:"composio:googlecalendar",kind:"composio",name:"Google Calendar",status:"ACTIVE",enabled:true,enabled_tools:["GOOGLECALENDAR_EVENTS_LIST"]});
    data.home.calendar_google="connected";
  }
  if (variant.homeSparse || variant.homeEmpty) {
    data.home.calendar_days = []; data.home.calendar_items = []; data.home.calendar_counts = {}; data.home.calendar_events = [];
    data.home.today = []; data.home.reports = []; data.home.calendar = [];
    data.home.counts = { today: 0, reports: 0, calendar: 0 };
    data.home.usage = { month_usd: 0, limit_usd: 20, daily: Array(14).fill(0), allowances: { brains: [] } };
    data.status.spend = { ...data.status.spend, month_usd: 0, today_usd: 0, daily: Array(14).fill(0) };
    data.home.dictation = { words: 0, audio_seconds: 0, time_saved_seconds: 0, speed_wpm: null, daily: Array(14).fill(0) };
    if (variant.homeSparse) {
      data.home.usage.month_usd = .88;
      data.home.usage.allowances.brains = [
        { id: "codex", name: "Codex", windows: [{ period: "weekly", remaining_percent: 0, resets_at: 1793109600 }, { period: "fiveHour", remaining_percent: 60, resets_at: 1792821600 }] },
        { id: "claude", name: "Claude", windows: [] },
      ];
      data.status.spend.month_usd = .88;
    }
  }
  function usageBill(period) {
    // The shared fixture clock and browser run in Asia/Taipei.
    const local = new Date(data.now + 8 * 3600000);
    const midnight = (year, month, day) => Date.UTC(year, month, day) - 8 * 3600000;
    const year = local.getUTCFullYear(), month = local.getUTCMonth(), day = local.getUTCDate();
    let lower = -Infinity, upper = Infinity;
    if (period === "month") { lower = midnight(year, month, 1); upper = midnight(year, month + 1, 1); }
    if (period === "last_month") { lower = midnight(year, month - 1, 1); upper = midnight(year, month, 1); }
    if (period === "week") {
      const monday = day - (local.getUTCDay() + 6) % 7;
      lower = midnight(year, month, monday); upper = midnight(year, month, monday + 7);
    }
    const rows = data.spendRows.filter(row => row.created_at_ms >= lower && row.created_at_ms < upper);
    const total = rows.reduce((sum, row) => sum + row.cost_usd, 0);
    const amounts = { agent: 0, stt: 0, cleanup: 0, memory: 0 };
    for (const row of rows) {
      const purpose = ["agent", "stt", "cleanup", "memory"].includes(row.purpose) ? row.purpose : "other";
      amounts[purpose] = (amounts[purpose] ?? 0) + row.cost_usd;
    }
    return { cost_usd: total, purposes: Object.entries(amounts).map(([purpose, cost_usd]) => ({ purpose, cost_usd, share: total ? cost_usd / total : 0 })) };
  }
  // Sidebar and overview use the same ledger rows, including floating-point totals.
  if (!variant.homeEmpty && !variant.homeSparse) data.status.spend.month_usd = usageBill("month").cost_usd;
  if (variant.cardDeck || variant.cardTaskResult) {
    const base = structuredClone(data.mailTurns.draft);
    Object.assign(base, {id: 980, member_id:1, conversation_id:11, question:'整理專案摘要。', text:'專案摘要已備妥，請確認。', steps:[], messages:[], drafts:[], task:{id:980,state:'done'}});
    if (variant.cardDeck) Object.assign(base, {
      drafts: structuredClone(data.mailTurns.draft.drafts),
      connectors: [structuredClone(data.connectorTurns.gmail.connectors[0])],
      secrets: [structuredClone(data.secretTurns.notion.secrets[0])],
      permissions: [structuredClone(data.permissionTurns.tool.turn.permissions[0])],
      owner_questions: [structuredClone(data.ownerQuestionCard)],
      connection_proposals: [structuredClone(data.mcpProposalCard)],
      computers: [],
    });
    if (variant.cardDeck) {
      base.drafts[0].cc = "copy@example.invalid";
      base.permissions.push({...structuredClone(base.permissions[0]), id:"sheet-message", service:"Slack", tool:"SLACK_SEND_MESSAGE", message:messagePreview});
      adminQuestion = {...structuredClone(data.adminQuestions.draft), member_id:1, conversation_id:11, turn_id:980};
      data.desktop = {state:"running",ready:true,control:"member",works:[{id:"sheet-computer",request_id:"sheet-request",turn_id:980,state:"waiting_control",reason:"sign_in",tool:"get_desktop_state"}]};
      base.status = "confirm";
    }
    data.turns = [base];
  }
  const state = { data, calls: [], errors: [], urls: [], sent: [], exported: null, channel: null, emit(event) {
    if (event.type === "AgentTurn" && arrivals.has(event.turn_id)) { data.turns.push(arrivals.get(event.turn_id)); arrivals.delete(event.turn_id); }
    state.channel?.onmessage(event);
  } };
  let maximized = false;
  target.__look = state;
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const nextId = items => Math.max(0, ...items.map(item => item.id)) + 1;
  const unsupported = name => { const message = `Unmocked IPC: ${name}`; state.errors.push(message); throw new Error(message); };
  let keyRemoved = false;
  const notify = (type, extra = {}) => { setTimeout(() => state.emit({ type, ...extra }), 0); };
  const byMember = (items, p) => items.filter(item => item.member_id === (p.member_id ?? 0));
  const memoryFile = p => p.space === "shared" ? "shared" : String(p.member_id ?? 0);
  const memoryDocument = p => {
    const text = data.memoryFiles?.[memoryFile(p)] ?? "";
    const shared = p.space === "shared";
    return { text, revision: `revision-${text.length}`, chars: text.trim().length, entries: text.split(/\n\s*\n/).filter(part => part.trim()).length,
      limit: shared ? 1375 : 2200, summary: shared ? null : data.memorySummary };
  };
  // As the core's Conversations.main: a member always has a main conversation; when it is deleted the latest one takes
  // over, and a new one is made only when none is left.
  const mainConversation = member => {
    const own = data.conversations.filter(item => item.member_id === member && item.kind !== "quick");
    if (own.some(item => item.is_default)) return;
    const latest = [...own].sort((a, b) => b.updated_at_ms - a.updated_at_ms || b.id - a.id)[0];
    if (latest) latest.is_default = true;
    else data.conversations.push({ id: nextId(data.conversations), member_id: member, title: "", is_default: true, kind: "standard", created_at_ms: data.now, updated_at_ms: data.now });
  };
  const update = (items, id, patch) => {
    const item = items.find(item => item.id === id);
    if (!item) throw new Error(`Fixture item not found: ${id}`);
    Object.assign(item, patch); return item;
  };
  // The core's inventory of the owner's apps (integrations/inventory.py) as a double, computed from the fixture's connections so that
  // every scene that switches, signs in or uninstalls moves the count as the core moves it: an app is connected when its tools can be
  // called now; one that waits for a sign-in, failed, is off, has every tool off, or is a second way to an app that is counted already
  // is listed and never counted. `inventoryUnreadable` is a core that cannot say.
  const inventory = () => {
    if (variant.inventoryUnreadable) return { state: "unknown", count: null, apps: [] };
    if (variant.mentionMany) return { state: "complete", count: data.mentionServices.filter(app => app.connected).length, apps: data.mentionServices };
    const entries = [
      ...data.servers.map(server => {
        const tools = server.enabled ? server.tools.filter(tool => tool.enabled).length : 0;
        const state = !server.enabled ? "disabled" : server.error === "auth" ? "needs_sign_in" : server.error ? "error" : server.status === "unchecked" ? "unchecked" : tools ? "ready" : "no_tools";
        return { id: server.id, name: server.name, enabled: server.enabled, state, tools, services: server.catalog_id ? [server.catalog_id] : [], rank: 2 };
      }),
      ...data.managedConnectors.map(connector => {
        const off = new Set(connector.disabled_tools ?? []);
        const ready = connector.enabled && connector.status === "ACTIVE" ? connector.enabled_tools.filter(tool => !off.has(tool)) : [];
        const waiting = ["INITIALIZING", "INITIATED", "EXPIRED", "REVOKED", "INACTIVE"].includes(connector.status);
        const state = !connector.enabled ? "disabled" : waiting ? "needs_sign_in" : connector.status === "FAILED" ? "error" : ready.length ? "ready" : "no_tools";
        const google = connector.kind === "google";
        const services = google ? [["gmail", "gmail_"], ["googlecalendar", "calendar_"]].filter(([, prefix]) => ready.some(tool => tool.startsWith(prefix))).map(([id]) => id) : [connector.id.replace("composio:", "")];
        return { id: connector.id, name: connector.name || (google ? "Google" : connector.id), enabled: connector.enabled, state, tools: ready.length, services, rank: google ? 0 : 1 };
      }),
    ];
    const claimed = new Set();
    for (const entry of [...entries].sort((a, b) => a.rank - b.rank)) {
      if (entry.state !== "ready") continue;
      if (entry.services.length && entry.services.every(service => claimed.has(service))) entry.state = "duplicate";
      else entry.services.forEach(service => claimed.add(service));
    }
    const apps = entries.map(({ id, name, enabled, state, tools }) => ({ id, name, enabled, state, tools, connected: state === "ready" }));
    return { state: "complete", count: apps.filter(app => app.connected).length, apps };
  };
  // A skill's document: its frontmatter says its name and when to use it, as the core reads them (members/capabilities.py `skill_metadata`).
  const skillText = skill => skill.text ?? `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n`;
  const skillUndo = new Map();
  const saveSkills = member => skillUndo.set(member, { revision: `skill-${Date.now()}`, skills: structuredClone(data.skills.filter(s => s.member_id === member)) });
  const skillRow = ({ text, ...skill }) => skill;
  const skillOf = p => {
    const skill = data.skills.find(item => item.id === p.id && item.member_id === p.member_id);
    if (!skill) throw new Error("Invalid params: no such member skill");
    return skill;
  };
  const frontmatter = (text, key) => {
    const head = text.startsWith("---") ? text.split("---")[1] ?? "" : "";
    return head.split("\n").map(line => line.trim()).find(line => line.startsWith(`${key}:`))?.slice(key.length + 1).trim() ?? "";
  };
  async function core(method, p = {}) {
    if (variant.missingHidden && method === "members.list" && target.document.querySelector('[data-hidden-members]')) throw new Error("Synthetic hidden member read failure");
    switch (method) {
      case "links.preview": return { url: p.url, site: new URL(p.url).hostname, title: "", description: "", thumbnail: null };
      case "pages.open":
        if (variant.pageGone) throw { kind: "not_found", message: "gone" };
        // Not a file of the dev server, which would write its own client into the page.
        return { url: `data:text/html;charset=utf-8,${encodeURIComponent(data.pageProductHtml)}`, title: "輕量後背包", rev: 1, height: 320, source: "html", server: null };
      case "computer.viewer_status": return data.desktop ?? { state: "absent", ready: false, control: "member" };
      case "computer.viewer_open": {
        if (variant.desktopStarts) data.desktop = { ...data.desktop, state: "running", ready: true };
        const session = `look-desktop-${++desktopSequence}`;
        desktopSessions.set(session, { preview: p.preview, held: false, member:p.member_id, conversation:p.conversation_id });
        return { session, url: `${location.origin}/scripts/look/fixtures/desktop.html` };
      }
      case "computer.viewer_renew": return { ...data.desktop, ...(teaching ? {teaching} : {}), control: desktopSessions.get(p.session)?.held ? "owner" : "member" };
      case "computer.teach": {
        const session = desktopSessions.get(p.session);
        if (p.action === 'start') {
          if (!session || session.preview || data.desktop?.teach_available === false) throw new Error('Member computer required');
          teaching = {id:'owner-demonstration',state:'recording',text:'',conversation_id:session.conversation,member:session.member};
          session.held = true;
        } else if (p.action === 'stop' || p.action === 'draft') {
          if (session) session.held = false;
          teaching.state = 'draft';
          teaching.text = '---\nname: checked-report\ndescription: Prepare a checked report\n---\n\n## When to use\nWhen the owner asks for a report.\n\n## Inputs\nreport_title: the new report title.\n\n## Procedure\n1. Open the report editor and locate its title field.\n2. Enter report_title and save the report.\n\n## Pitfalls\nAsk the owner to take over for sign-in.\n\n## Verification\nCheck the saved title and report contents.';
        } else if (p.action === 'save') {
          if (teaching?.state !== 'draft' || !p.text) throw new Error('Review the draft first');
          const skill = {id:Math.max(0,...data.skills.map(s=>s.id))+1,member_id:p.member_id,name:frontmatter(p.text,'name'),description:frontmatter(p.text,'description'),text:p.text,enabled:true,source:'owner',provenance:'owner'};
          data.skills.push(skill); teaching = undefined;
          notify('members.skills.changed',{member_id:p.member_id});
          return {skill:skillRow(skill)};
        } else if (p.action === 'discard') {
          for (const current of desktopSessions.values()) current.held = false;
          teaching = undefined; return {};
        } else if (p.action !== 'read') throw new Error('Unknown demonstration action');
        return teaching;
      }
      case "computer.viewer_control": {
        const session = desktopSessions.get(p.session);
        if (session.preview) throw new Error("Read-only preview");
        session.held = p.held;
        data.desktop.control = p.held ? "owner" : "member";
        if (!p.held && p.takeover) for (const work of data.desktop.works ?? []) if (work.request_id === p.takeover) work.state = "running";
        return data.desktop;
      }
      case "computer.viewer_close": {
        if (desktopSessions.get(p.session)?.held && data.desktop) data.desktop.control = "member";
        desktopSessions.delete(p.session); return {};
      }
      case "settings.get": return { settings: data.settings };
      // A question opening later is not there at the first read, as one that opens while the owner is elsewhere.
      case "background.waiting.list": { data.waitingReads = (data.waitingReads ?? 0) + 1; return { waiting: variant.roomQuestion && (!variant.roomQuestionLate || data.waitingReads > 1) ? [{ id: "room-q", member_id: 1, member_name: "小晴", room_id: 1 }] : [] }; }
      case "attachments.get": {
        if (variant.generatedFile?.id === p.id) return {mime:variant.generatedFile.mime,data:variant.generatedData};
        if (data.keptFiles?.[p.id]) return data.keptFiles[p.id];
        if (!variant.audioFile || p.id !== variant.audioFile.id) return unsupported(method);
        const bytes = new Uint8Array(16044), view = new DataView(bytes.buffer);
        const word = (offset, text) => [...text].forEach((letter, index) => { bytes[offset + index] = letter.charCodeAt(0); });
        word(0, "RIFF"); view.setUint32(4, 16036, true); word(8, "WAVEfmt "); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data"); view.setUint32(40, 16000, true);
        return {mime: "audio/wav", data: btoa(String.fromCharCode(...bytes))};
      }
      case "settings.set": data.settings[p.key] = p.value; notify("SettingsChanged"); return { settings: data.settings };
      case "status.get": return data.status;
      case "home.overview": {
        if (!p.month) return {...data.home,report:data.status};
        const shift = at => { const old = new Date(at), [year,month] = p.month.split('-').map(Number); return new Date(year,month-1,Math.min(old.getDate(),new Date(year,month,0).getDate()),old.getHours(),old.getMinutes()).getTime(); };
        const project = item => { const at_ms=shift(item.at_ms);return {...item,at_ms,...(item.end_ms===undefined?{}:{end_ms:at_ms+item.end_ms-item.at_ms}),id:item.kind==='routine' && !item.rhythm?`routine:${item.routine_id}:${at_ms}`:item.id}; };
        const calendar_items = data.home.calendar_items.map(project), calendar_events = data.home.calendar_events.map(project);
        const calendar_counts = Object.fromEntries(Object.entries(data.home.calendar_counts).map(([key,count])=>[new Date(shift(new Date(`${key}T12:00:00`).getTime())).toISOString().slice(0,10),count]));
        return {...data.home,calendar_items,calendar_events,calendar_counts,calendar_days:Object.keys(calendar_counts),report:data.status};
      }
      case "status.check_openrouter": data.status.openrouter.state = "ok"; return data.status.openrouter;
      case "secrets.status": return { has_key: !variant.problem && !keyRemoved };
      case "stats.summary": return data.stats;
      case "history.list": return { total:data.history.length, items: data.history.filter(item => (!p.query || item.text.includes(p.query)) && (!p.after_ms || item.created_at_ms >= p.after_ms) && (!p.before_ms || item.created_at_ms < p.before_ms || (item.created_at_ms === p.before_ms && item.id < p.before_id))).slice(0,p.limit??50) };
      case "history.delete": data.history = data.history.filter(item => item.id !== p.id); return { deleted: true };
      case "dictionary.list": return { entries: data.dictionary };
      case "dictionary.add": { const entry = { ...p, id: nextId(data.dictionary), misheard: [], source: "manual", created_at_ms: data.now }; data.dictionary.push(entry); return { entry }; }
      case "dictionary.correct": {
        // Model only this scene's declared IPC response; acceptance belongs to native/core tests.
        const edit = variant.dictationText;
        if (!edit || JSON.stringify(p.edits) !== JSON.stringify([{ before: edit.before, after: edit.after }])) return unsupported("dictionary.correct fixture edit");
        const word = "OpenMausBot";
        if (!data.dictionary.some(entry => entry.word === word)) data.dictionary.push({ id: nextId(data.dictionary), word, misheard: [], source: "learned", created_at_ms: data.now });
        return { learned: [word], undo: "synthetic-correction-batch" };
      }
      case "dictionary.learn": {
        const learned = [];
        for (const { word } of p.corrections) {
          if (data.dictionary.some(entry => entry.word === word)) continue;
          data.dictionary.push({ id: nextId(data.dictionary), word, misheard: [], source: "learned", created_at_ms: data.now });
          learned.push(word);
        }
        return { learned };
      }
      case "dictionary.delete": data.dictionary = data.dictionary.filter(item => item.id !== p.id); return { deleted: true };
      case "members.list": {
        // the roster of every model carries the same inventory and the same count as the sidebar and the connections page
        const counted = inventory();
        return { members: data.members.map(m => ({ ...m, chief: m.id === data.primaryId, pinned: m.id === 0 ? !!data.settings.chief_pinned : m.pinned })), groups: data.groups, team_context: {
          schema_version: 1, revision: "fixture", self_id: 0, count: data.members.length, primary_id: data.primaryId, chief_id: data.primaryId,
          inventory_state: counted.state, room_member_ids: null,
          members: data.members.map(m => ({ id: m.id, name: m.name, role: m.role, blurb: m.blurb ?? "" })),
          apps: counted.apps, connected: counted.count,
        } };
      }
      case "members.viewing": case "members.read": return {};
      case "members.tool_choices": return { tools: [], connections: data.servers };
      case "members.update": { const member = update(data.members, p.id, p); if (p.hidden && p.id === data.primaryId) data.primaryId = 0; notify("MembersChanged", { member_id: p.id }); return { member }; }
      case "members.set_primary": {
        // as the core: Raphael or a member that is there and not hidden from the sidebar; only the choice changes
        if (p.id !== 0 && !data.members.some(member => member.id === p.id && !member.hidden)) throw new Error("Invalid params: no such member");
        data.primaryId = p.id; notify("MembersChanged", { member_id: p.id }); return { primary_id: p.id };
      }
      case "members.create": {
        const member = { ...data.members[1], role: "", blurb: "", ...p, id: nextId(data.members) };
        data.members.push(member);
        if (p.greet) {
          mainConversation(member.id);
          const conversation = data.conversations.find(item => item.member_id === member.id);
          data.turns.push({ id: nextId(data.turns), session_id: `greeting-${member.id}`, question: "", route: "greeting", prefix: "", text: `你好，我是${member.name}。你想請我幫你做什麼？`, detail: null, status: "done", cost_usd: 0, source: "greeting", model: null, steps: [], messages: [], attachments: [], member_id: member.id, conversation_id: conversation.id, created_at_ms: data.now, created_at: new Date(data.now).toISOString() });
        }
        notify("MembersChanged", { member_id: member.id });
        return { member, routine_offer: variant.routineOffer ? {title:"範例摘要",prompt:"整理範例資料。",schedule:{kind:"daily",time:"09:00"}} : null };
      }
      case "members.delete": data.members = data.members.filter(item => item.id !== p.id); if (p.id === data.primaryId) data.primaryId = 0; notify("MembersChanged", { member_id: p.id }); return { deleted: true };
      case "members.skills.list": return { skills: byMember(data.skills, p).map(skillRow), undo: skillUndo.get(p.member_id)?.revision ?? null };
      case "members.skills.read": { const skill = skillOf(p); return { skill: skillRow(skill), text: skillText(skill) }; }
      case "members.skills.update": {
        if (p.undo) {
          const previous = skillUndo.get(p.member_id);
          if (!previous || previous.revision !== p.undo) throw new Error("Invalid params: skill revision is no longer current");
          const current = structuredClone(data.skills.filter(s => s.member_id === p.member_id));
          data.skills = [...data.skills.filter(s => s.member_id !== p.member_id), ...previous.skills];
          skillUndo.set(p.member_id, { revision: `skill-${Date.now()}`, skills: current });
          notify("MembersChanged", { member_id: p.member_id });
          return { skills: byMember(data.skills, p).map(skillRow) };
        }
        saveSkills(p.member_id);
        const skill = skillOf(p);
        if (p.text !== undefined) {
          // as the core refuses a document it cannot keep: nothing changes
          const name = frontmatter(p.text, "name"), description = frontmatter(p.text, "description");
          if (!name) throw new Error("Invalid params: name must not be empty");
          if (!description) throw new Error("Invalid params: description must not be empty");
          if (data.skills.some(other => other !== skill && other.member_id === skill.member_id && other.name.toLowerCase() === name.toLowerCase())) throw new Error("Invalid params: a skill with that name already exists");
          Object.assign(skill, { name, description, text: p.text });
        }
        if (p.enabled !== undefined) skill.enabled = p.enabled;
        notify("MembersChanged", { member_id: p.member_id });
        return { skill: skillRow(skill) };
      }
      case "members.skills.delete": {
        saveSkills(p.member_id);
        const deleted = data.skills.some(item => item.id === p.id && item.member_id === p.member_id);
        data.skills = data.skills.filter(item => !(item.id === p.id && item.member_id === p.member_id));
        notify("MembersChanged", { member_id: p.member_id });
        return { deleted };
      }
      case "members.commands.list": return { commands: byMember(data.commands, p) };
      case "members.voices": return data.voices;
      case "groups.create": { const group = { ...p, id: nextId(data.groups), position: data.groups.length, sources: [] }; data.groups.push(group); notify("MembersChanged", { member_id: 0 }); return { group }; }
      case "groups.update": { const group = update(data.groups, p.id, p); notify("MembersChanged", { member_id: 0 }); return { group }; }
      case "groups.delete": data.groups = data.groups.filter(item => item.id !== p.id); notify("MembersChanged", { member_id: 0 }); return { deleted: true };
      case "conversations.list": mainConversation(p.member_id ?? 0); return { conversations: byMember(data.conversations, p).map(c=>({...c,turn_count:data.turns.filter(t=>t.conversation_id===c.id).length})) };
      case "conversations.create": { mainConversation(p.member_id ?? 0); const conversation = { id: nextId(data.conversations), member_id: p.member_id ?? 0, title: p.title ?? "", is_default: false, kind: "standard", created_at_ms: data.now, updated_at_ms: data.now }; data.conversations.push(conversation); return { conversation }; }
      case "conversations.rename": update(data.conversations, p.id, { title: p.title }); return {};
      case "conversations.clear": { const member = data.conversations.find(item => item.id === p.id).member_id; data.turns = data.turns.filter(item => item.conversation_id !== p.id); notify("ConversationsChanged", { member_id: member }); notify("AgentTurn", { turn_id: 0, member_id: member }); return { cleared: 1 }; }
      case "conversations.delete": { const gone = data.conversations.find(item => item.id === p.id); data.turns = data.turns.filter(item => item.conversation_id !== p.id); data.conversations = data.conversations.filter(item => item.id !== p.id); if (gone) mainConversation(gone.member_id); return { deleted: 1 }; }
      case "agent.history.list": {
        return { turns: byMember(data.turns, p).filter(turn => p.conversation_id === undefined || turn.conversation_id === p.conversation_id).filter(turn=>!p.before_id||turn.id<p.before_id).sort((a,b)=>b.id-a.id).slice(0,p.limit??50) };
      }
      // What the owner typed, newest first (the core's rule: typed turns of the private conversations, repeats in a row once); a scene may state it.
      case "agent.history.sent": {
        const typed = variant.typedHistory ?? data.turns.filter(turn => (turn.scope ?? "private") === "private" && turn.source === "app" && turn.route !== "draft" && turn.question.trim()).slice().reverse().map(turn => turn.question);
        return { texts: typed.filter((text, index) => text !== typed[index - 1]).slice(0, p.limit ?? 50) };
      }
      case "agent.history.search": case "messages.search": return { turns: byMember(data.turns, p).filter(turn => `${turn.question} ${turn.text} ${turn.messages.map(message => message.text).join(" ")}`.includes(p.query)).map(turn => ({ ...turn, conversation_title: data.conversations.find(c => c.id === turn.conversation_id)?.title })) };
      case "agent.history.delete": data.turns = data.turns.filter(item => item.id !== p.id); notify("AgentTurn", { turn_id: p.id, member_id: p.member_id ?? 0 }); return { deleted: true };
      case "agent.history.stop": {
        pendingReplies.get(p.session_id)?.();
        pendingReplies.delete(p.session_id);
        // As the core settles a stopped request: denied, with no answer, keeping its public steps.
        for (const turn of data.turns.filter(item => item.session_id === p.session_id && item.member_id === (p.member_id ?? 0) && ["running", "confirm"].includes(item.status))) {
          Object.assign(turn, { status: "denied", prefix: "了", text: "已取消。", messages: turn.messages.filter(message => message.kind !== "reply") });
          notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        }
        return { stopped: true };
      }
      case "worker.cancel": {
        for (const turn of data.turns.filter(item => item.task?.id === p.task_id)) turn.task.state = "cancelled";
        notify("WorkerChanged");
        return { cancelled: true };
      }
      case "agent.speech.status": return data.speech;
      case "agent.question.open": return null;
      case "background.questions.list": {
        if (variant.roomQuestion && p.room_id === 1) return { questions: [{ id: "room-q", task_id: 950, member_id: 1, prefix: "問", text: "本機指令", tier: "T2", created_at_ms: data.now, expires_at_ms: data.now + 1800000, room_id: 1,
          permission: { id: "room-q", source: "background", kind: "local_command", service: "小晴", tool: "local_exec", summary: "Get-ChildItem -LiteralPath app -Force", reason: "D:\\專案", digest: "room-digest", always: false, state: "pending", expires_at_ms: data.now + 1800000 } }] };
        return { questions: localQuestion && p.member_id === 1 ? [localQuestion] : [] };
      }
      case "owner_questions.answer": {
        const turn = data.turns.find(turn => turn.owner_questions?.some(question => question.id === p.id));
        const question = turn?.owner_questions.find(question => question.id === p.id);
        if (!question) throw new Error("Unknown owner question");
        if (question.state !== "asked") return { status: question.state };
        question.state = p.answer === null ? "cancelled" : "answered";
        question.result = p.answer === null ? { state: "cancelled" } : { state: "answered", answer: p.answer };
        turn.task = { ...turn.task, state: "done", waiting_owner: 0, finished_at_ms: data.now };
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        return { status: question.state };
      }
      case "background.answer": {
        if (!localQuestion || p.question_id !== localQuestion.id || p.digest !== localQuestion.permission.digest) throw new Error("Unknown local question");
        if (p.always) data.settings.local_commands_mode = "always";
        if (p.never) data.settings.local_commands_mode = "never";
        localQuestion = null;
        notify("WorkerChanged", {});
        return { status: p.approved ? "approved" : "denied" };
      }
      case "quota.list": return { quotas: data.allowances.quotas };
      case "memory.get": return memoryDocument(p);
      case "memory.update": data.memoryFiles = { ...data.memoryFiles, [memoryFile(p)]: p.text }; return memoryDocument(p);
      case "memory.clear": data.memoryFiles = { ...data.memoryFiles, [memoryFile(p)]: "" }; return { cleared: true };
      case "memory.summary_clear": data.memorySummary = null; return { cleared: true };
      case "safety.rules.list": return { rules: data.safetyRules };
      case "routines.list": {
        if (variant.missingRoutines) throw new Error("Synthetic routines read failure");
        const events=routineEventChoices;
        const choice=events.find(e=>e.id===p.event);
        const value=p.value ?? '', [owner,repo]=value.split('/');
        const calendar=choice?.id==='calendar-event';
        const args=calendar ? {calendarId:'primary',maxResults:50,singleEvents:true,orderBy:'updated'} : choice?.input==='repository' ? {owner,repo,per_page:20,status:'failure'} : choice?.input==='channel' ? {channel:value,limit:20} : {max_results:20,include_payload:false,verbose:false};
        const path=calendar ? 'items' : choice?.input==='repository' ? 'workflow_runs' : 'messages';
        const detected=!p.event ? {} : variant.eventUndetectable || !choice ? {event_error:'目前沒有可用的 Gmail 項目。出現新項目後，請再試一次。'} : {when:{app:choice.app,event:{tool:'mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL',arguments:{tools:[{tool_slug:choice.slug,arguments:args}]},items:`data.results.0.response.data.${path}`,id:choice.id==='gmail-mail' ? 'messageId' : choice.input==='channel' ? 'ts' : 'id',...(calendar ? {since:{arg:'updatedMin',format:'iso'}} : {})},filter:{field:'',equals:''}}};
        return {routines:p.member_id===undefined ? data.routines : byMember(data.routines,p),events,event_apps:variant.noEventApps ? [] : ['Gmail','Google 日曆','GitHub','Slack'],...detected};
      }
      case "routines.webhook": return {address:`http://127.0.0.1:43210/routines/${p.id}`, address_changed:!!variant.hookAddressChanged, ...(p.reveal ? {secret:'sample-fake-secret-for-visual-checks'} : {})};
      case "routines.runs": return { runs: data.routineRuns.filter(run => run.routine_id === p.routine_id), total: data.routineRuns.filter(run => run.routine_id === p.routine_id).length };
      case "routines.create": { const routine = { ...p, ...(p.when ? { schedule: null, last_checked: null, last_error: "", app_name:routineEventChoices.find(e=>e.app===p.when.app)?.app_name ?? p.when.app ?? "" } : {}), id: nextId(data.routines), enabled: p.enabled ?? true, last_run: null, next_run: p.when ? data.now : data.now + 86400000 }; data.routines.push(routine); notify("RoutinesChanged", { member_id: routine.member_id }); return { routine }; }
      case "routines.update": {
        const previous = data.routines.find(item => item.id === p.id);
        const reset = p.when && JSON.stringify(previous?.when) !== JSON.stringify(p.when);
        const routine = update(data.routines, p.id, { ...p, ...(p.when ? { schedule: null } : p.schedule ? { when: null } : {}), ...(reset ? { last_checked: null, last_error: "", next_run: data.now } : {}) });
        notify("RoutinesChanged", { member_id: routine.member_id }); return { routine };
      }
      case "routines.delete": data.routines = data.routines.filter(item => item.id !== p.id); notify("RoutinesChanged", { member_id: 0 }); return { deleted: true };
      case "calendar.add": case "calendar.update": {
        const current = method === "calendar.update" ? data.home.calendar_events.find(item => item.kind === "own" && item.event_id === p.id) : undefined;
        if (method === "calendar.update" && !current) throw new Error("Calendar fixture not found");
        const when = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).getTime() : new Date(value).getTime();
        const allDay = p.all_day ?? current?.all_day ?? false;
        const start = p.start ? when(p.start) : current.at_ms;
        const end = p.end ? when(p.end) + (allDay ? 86400000 : 0) : current?.end_ms ?? start + 3600000;
        const id = current?.event_id ?? Math.max(100, ...data.home.calendar_events.map(item => item.event_id ?? 0)) + 1;
        const item = { ...(current ?? { id: `own:${id}`, kind: "own", event_id: id, summary: "", member_id: -1, name: "", avatar: "", turn_id: null, conversation_id: null, routine_id: null, notes: "", added_by: null }),
          title: p.title ?? current?.title, notes: p.notes ?? current?.notes ?? "", at_ms: start, end_ms: end, all_day: allDay };
        if (current) Object.assign(current, item); else data.home.calendar_events.push(item);
        reproject(); notify("CalendarChanged");
        return { event: { id, title: item.title, start: p.start ?? new Date(start).toISOString(), end: p.end ?? new Date(end).toISOString(), all_day: allDay, notes: item.notes, added_by: item.added_by } };
      }
      case "calendar.delete": data.home.calendar_events = data.home.calendar_events.filter(item => item.event_id !== p.id); reproject(); notify("CalendarChanged"); return { deleted: true };
      case "rooms.list": return { rooms: data.rooms.map(room => {
        const messages = data.messages.filter(message => message.room_id === room.id && (message.member_id == null || message.status === "done" && message.text.trim() && !/^[(（]?\s*pass\s*[)）]?[.。]?$/i.test(message.text.trim()))).sort((a, b) => b.id - a.id);
        const latest = messages[0];
        return { ...room, preview: latest?.text.slice(0, 300) ?? "", last_at: latest?.created ?? null, waiting: !!variant.roomQuestion && room.id === 1,
          unread: messages.some(message => message.member_id != null && message.id > (room.read_message_id ?? 0)) };
      }) };
      case "rooms.messages": return { messages: data.messages.filter(item => item.room_id === p.room_id && (!p.before || item.id < p.before)).sort((a,b)=>a.id-b.id).slice(-100), exchange: data.roomExchanges.filter(item => item.room_id === p.room_id).at(-1) ?? null, handoffs: data.roomHandoffs };
      case "rooms.create": { const room = { ...p, member_ids: p.is_team ? data.members.map(m => m.id) : p.member_ids, id: nextId(data.rooms), created: data.now, group_id: p.group_id ?? null, is_team: Number(p.is_team ?? false), default_responder: p.default_responder ?? "auto" }; data.rooms.push(room); return { room }; }
      case "rooms.update": {
        const room = data.rooms.find(room => room.id === p.room_id), previous = room.read_message_id ?? 0;
        update(data.rooms, p.room_id, p);
        if (p.read) room.read_message_id = Math.max(previous, p.read_through ?? Math.max(0, ...data.messages.filter(message => message.room_id === room.id).map(message => message.id)));
        if ((p.read && room.read_message_id > previous) || p.pinned !== undefined || p.hidden !== undefined || p.name !== undefined) notify("RoomsChanged", { room_id:room.id });
        return { room };
      }
      case "rooms.delete": data.rooms = data.rooms.filter(item => item.id !== p.room_id); return { deleted: true };
      case "rooms.stop": { for (const exchange of data.roomExchanges.filter(item => item.room_id === p.room_id && ["running", "queued"].includes(item.state))) exchange.stop_requested = 1; for(const exchange of data.roomExchanges.filter(item=>item.room_id===p.room_id)){exchange.state="stopped";exchange.active_turn=null;}for(const message of data.messages.filter(item=>item.room_id===p.room_id&&item.status==="running")){message.status="error";message.text="已停止工作。";}for(const task of data.roomHandoffs.filter(item=>["queued","running","waiting"].includes(item.state)))task.state="cancelled";data.messages.push({...data.roomWrapupMessage,id:nextId(data.messages),reply_to:null,reply_to_member:null,text:"### 結論\n已停止本次工作，已完成的動作保留。\n\n### 待決定\n尚未完成的工作已取消。\n\n### 下一步\n等待你的新指示。"});notify("RoomsChanged", { room_id: p.room_id }); return { stopped: true }; }
      case "rooms.send": { const message = { id: nextId(data.messages), room_id: p.room_id, member_id: null, text: p.text, request_id: p.request_id, status: "done", created: data.now, reply_to: p.reply_to ?? null, turn_id: null, reply_to_member: data.messages.find(item => item.id === p.reply_to)?.member_id ?? null, origin_message_id: nextId(data.messages), kind: "message", attachments: (p.attachments ?? []).map((file, index) => { const id = `${"f".repeat(30)}${String(index).padStart(2, "0")}.png`; (data.keptFiles ??= {})[id] = { mime: file.mime, data: file.data }; return { id, name: file.name, mime: file.mime }; }) }; data.messages.push(message); return { message_id: message.id, duplicate: false }; }
      case "computer.revoke": if (data.desktop) data.desktop.granted = false; return { granted: false };
      case "brains.cli":
        // As the core does: a CLI's models come after the first read, in the background.
        if (variant.codexLate && !codexArrived) {
          // Counted from the menu opening, so that a slow start of the scene still sees them come.
          if (!codexTimer && target.document.querySelector(".cb-menu")) codexTimer = setTimeout(() => { codexArrived = true; notify("BrainsChanged", {}); }, variant.codexLate);
          return { clis: data.clis.map(cli => cli.id === "codex" ? { ...cli, models: [] } : cli) };
        }
        return { clis: data.clis };
      case "chatgpt.status": return data.chatgpt ?? (config.fixture?.chatgptSignedIn ? { signed_in: true, email: "owner@example.test", plan_scope_granted: true } : { signed_in: false });
      case "chatgpt.sign_in": data.chatgpt = { signed_in: true, email: "owner@example.test", plan_scope_granted: true }; notify("ProvidersChanged"); return data.chatgpt;
      case "chatgpt.models": return { models: [] };
      case "chatgpt.cancel": return { cancelled: true };
      case "chatgpt.sign_out": data.chatgpt = { signed_in: false }; return { signed_out: true };
      case "brains.cli_disconnect": {
        const cli = data.clis.find(cli => cli.id === p.id);
        cli.disconnected = true; cli.available = false;
        cli.savedModels = cli.models; cli.models = [];
        notify("BrainsChanged", {});
        return { disconnected: true };
      }
      case "brains.cli_login": {
        const cli = data.clis.find(cli => cli.id === p.id);
        cli.disconnected = false;
        cli.available = cli.installed && cli.logged_in === true;
        if (cli.available && cli.savedModels) cli.models = cli.savedModels;
        notify("BrainsChanged", {});
        return { started: !cli.available, reconnected: cli.available };
      }
      case "models.catalog": return data.chatgpt?.signed_in ? { ...data.catalog, llm: [...data.catalog.llm, { ...data.catalog.llm[0], id: "gpt-6-sol", provider_id: "chatgpt", provider_name: "ChatGPT", provider: "OpenAI", name: "GPT-6-Sol", input_per_mtok: null, output_per_mtok: null, free: false, variable_price: false, per_minute: null, reasoning_efforts: ["low", "medium", "high", "xhigh", "max"], default_effort: "medium" }] } : data.catalog;
      case "models.status": return data.modelStatus;
      case "models.local": return { models: data.localModels };
      case "providers.list": return { providers: data.providers };
      case "providers.kinds": return { kinds: data.providerKinds };
      case "providers.models": return { models: data.catalog.llm.map(model => ({ id: model.id, name: model.name, context: model.context_length, vision: true, tools: true, audio_in: false, price_in: model.input_per_mtok, price_out: model.output_per_mtok })) };
      case "languages.list": return { groups: data.languages };
      case "audio.devices": return data.audioDevices;
      case "audio.monitor": return {};
      case "services.status": return data.serviceStatus;
      case "connectors.status": return { connectors: data.managedConnectors, composio_configured: data.composioConfigured, google_configured: true };
      case "connectors.catalog": {
        if (!data.composioConfigured) return { ok: false, error: "missing_key" };
        return { items: data.pluginCatalog, categories: data.pluginCategories, next_cursor: null };
      }
      case "connectors.categories": return { items: data.pluginCategories };
      case "connectors.tools": return { items: data.pluginTools[p.id] ?? [] };
      case "connectors.set_key": {
        if (p.key.startsWith("sk-or-")) return { ok: false, error: "openrouter_key" };
        if (p.key.startsWith("ck_")) return { ok: false, error: "consumer_key" };
        data.composioConfigured = true; return { configured: true };
      }
      case "connectors.set_tools": {
        const connector = data.managedConnectors.find(c => c.id === p.id);
        if (p.enabled !== undefined) connector.enabled = p.enabled;
        if (p.disabled_tools) {
          connector.disabled_tools = p.disabled_tools;
          for (const tool of data.pluginTools[p.id] ?? []) tool.enabled = !p.disabled_tools.includes(tool.slug);
          connector.enabled_tools = (data.pluginTools[p.id] ?? []).filter(t => t.enabled).map(t => t.slug);
        }
        state.emit({ type: "ConnectionsChanged" }); return { connector };
      }
      case "connectors.toolkit": {
        if (variant.toolkitPlanFails) return { ok: false, error: "network" };
        return data.toolkitPlans[p.toolkit] ?? { ok: false, error: "gone" };
      }
      case "connectors.connect": {
        if (variant.connectorLinkRefused) return { ok: false, error: "toolkit_not_allowed" };
        if (variant.pluginsConnecting) return new Promise(() => {});
        const entry = data.pluginCatalog.find(s => s.slug === p.toolkit);
        // An app that asks for a key or a developer app is not added without it; the fixture never keeps what was given.
        if (entry.needs !== "sign_in" && !p.fields) return { ok: false, error: entry.needs === "key" ? "needs_key" : "needs_own_app" };
        if (variant.connectFails) return { ok: false, error: variant.connectFails };
        data.managedConnectors.push({ id: `composio:${entry.slug}`, kind: "composio", name: entry.name, description: entry.description, status: "ACTIVE", enabled: true, enabled_tools: [], disabled_tools: [] });
        state.emit({ type: "ConnectionsChanged" }); return { connected: true };
      }
      case "connectors.google.connect": return { connected: true };
      case "connectors.disconnect": data.managedConnectors = data.managedConnectors.filter(c => c.id !== p.id); state.emit({ type: "ConnectionsChanged" }); return { disconnected: true };
      case "integrations.card_connect": {
        const turn = data.turns.find(item => item.connectors?.some(card => card.id === p.id));
        const card = turn?.connectors.find(item => item.id === p.id);
        if (!card) throw new Error(`Fixture card not found: ${p.id}`);
        if (!["pending", "failed", "cancelled"].includes(card.state)) return { card: copy(card), started: false };
        if (card.needs && card.needs !== "sign_in" && !p.fields) throw new Error("Fixture: this card needs the form's fields");
        Object.assign(card, { state: "authorizing", error: null });
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        if (variant.cardSignIn === "approve") {
          setTimeout(() => {
            Object.assign(card, { state: "connected", tool_count: 2, resumed: true });
            data.turns.push(structuredClone(data.connectorResume));
            state.emit({ type: "AgentTurn", turn_id: turn.id, member_id: turn.member_id });
          }, 0);
        }
        if (variant.cardSignIn === "fail") {
          setTimeout(() => {
            Object.assign(card, { state: "failed", error: variant.cardFailureKind || "not_configured" });
            const continuation = structuredClone(data.connectorResume);
            Object.assign(continuation, { member_id: turn.member_id, conversation_id: turn.conversation_id,
              prefix: turn.prefix, text: variant.cardFailureText, resumed_apps: [],
              steps: [{ kind: "tool", tool: "self_check", server: "Raphael", outcome: "ok", ms: 1 }],
              messages: [{ seq: 1, kind: "reply", text: variant.cardFailureText, at_ms: continuation.created_at_ms }] });
            data.turns.push(continuation);
            Object.assign(data.members.find(member => member.id === continuation.member_id), {
              preview: continuation.text, last_at: continuation.created_at_ms });
            state.emit({ type: "AgentTurn", turn_id: turn.id, member_id: turn.member_id });
            state.emit({ type: "AgentTurn", turn_id: continuation.id, member_id: continuation.member_id });
          }, 0);
        }
        return { card: copy(card), started: true };
      }
      case "integrations.card_save": {
        const turn = data.turns.find(item => item.secrets?.some(card => card.id === p.id));
        const card = turn?.secrets.find(item => item.id === p.id);
        if (!card) throw new Error(`Fixture card not found: ${p.id}`);
        if (typeof p.value !== "string" || !p.value.trim()) throw new Error("Fixture: a key is needed");
        if (!["pending", "failed"].includes(card.state)) return { card: copy(card), saved: false };
        Object.assign(card, { state: "saved", error: null });
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        setTimeout(() => {
          if (variant.resumeFails) Object.assign(card, { state: "saved", error: "resume_failed" });
          else {
            Object.assign(card, { state: "resumed", resumed: true });
            if (!card.login) data.turns.push(structuredClone(data.secretResume));
          }
          state.emit({ type: "AgentTurn", turn_id: turn.id, member_id: turn.member_id });
        }, 0);
        return { card: copy(card), saved: true };
      }
      case "integrations.proposal": {
        const turn = data.turns.find(turn => turn.connection_proposals?.some(card => card.id === p.id));
        const card = turn?.connection_proposals.find(card => card.id === p.id);
        if (!card || card.revision !== p.revision) throw new Error("Proposal changed");
        if (p.operation === "edit") Object.assign(card, { fields: copy(p.fields), state: "draft", revision: card.revision + 1, groups: [] });
        else if (p.operation === "test") {
          if (card.fields.transport === "stdio" && !p.local_choice) card.state = "approval";
          else Object.assign(card, { state: "tested", groups: copy(data.mcpProposalTools) });
        } else if (p.operation === "enable") {
          if (card.state !== "tested") throw new Error("Test the current configuration first");
          card.state = "enabled";
          turn.text = "已連接 Sample，查到一筆範例資料。";
        } else if (p.operation === "cancel") card.state = "cancelled";
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        return { proposal: copy(card) };
      }
      case "integrations.card_resume": {
        const turn = data.turns.find(item => item.secrets?.some(card => card.id === p.id));
        const card = turn?.secrets.find(item => item.id === p.id);
        if (!card) throw new Error(`Fixture card not found: ${p.id}`);
        if (card.state !== "saved" || !card.error) return { card: copy(card), resumed: false };
        Object.assign(card, { state: "resumed", error: null, resumed: true });
        data.turns.push(structuredClone(data.secretResume));
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        return { card: copy(card), resumed: true };
      }
      case "integrations.card_done": {
        const turn = data.turns.find(item => item.computers?.some(card => card.id === p.id));
        const card = turn?.computers.find(item => item.id === p.id);
        if (!card) throw new Error(`Fixture card not found: ${p.id}`);
        if (card.state !== "control") return { card: copy(card), done: false };
        Object.assign(card, { state: "returning", note: null });
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        setTimeout(() => {
          if (variant.signedIn) {
            Object.assign(card, { state: "done" });
            data.turns.push(structuredClone(data.computerResume));
          } else Object.assign(card, { state: "control", note: "still" });
          state.emit({ type: "AgentTurn", turn_id: turn.id, member_id: turn.member_id });
        }, 0);
        return { card: copy(card), done: true };
      }
      case "integrations.card_stop": {
        const turn = data.turns.find(item => item.computers?.some(card => card.id === p.id));
        const card = turn?.computers.find(item => item.id === p.id);
        if (!card) throw new Error(`Fixture card not found: ${p.id}`);
        if (!["control", "returning"].includes(card.state)) return { card: copy(card), stopped: false };
        Object.assign(card, { state: "stopped", note: null });
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        return { card: copy(card), stopped: true };
      }
      case "integrations.card_cancel": {
        const turn = data.turns.find(item => item.connectors?.some(card => card.id === p.id));
        const card = turn?.connectors.find(item => item.id === p.id);
        if (card?.state !== "authorizing") return { cancelled: false };
        card.state = "cancelled";
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        return { cancelled: true };
      }
      case "integrations.draft_save": case "integrations.draft_send": case "integrations.draft_discard": case "integrations.draft_handover": {
        let turn, draft;
        for (const item of data.turns) {
          draft = item.drafts?.find(each => each.id === p.id && each.mode === "card");
          if (draft) { turn = item; break; }
        }
        if (!draft) throw new Error(`Fixture draft not found: ${p.id}`);
        const changed = () => { notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id }); return turn; };
        const open = ["draft", "failed"].includes(draft.state);
        if (method === "integrations.draft_save") {
          if (p.digest !== draft.digest || !open) return { draft: copy(draft), saved: false };
          const fields = { to: p.to ?? draft.to, cc: p.cc ?? draft.cc, subject: p.subject ?? draft.subject, body: p.body ?? draft.body };
          const from = draft.senders.find(sender => sender.key === p.via) ?? draft.from;
          if (from.key === draft.from.key && Object.keys(fields).every(key => fields[key] === draft[key])) return { draft: copy(draft), saved: false };
          // A new version with a new digest, as the core makes one.
          const version = draft.version + 1;
          Object.assign(draft, fields, { from, version, digest: String(version).padStart(64, "b"), error: null, state: "draft" });
          changed();
          return { draft: copy(draft), saved: true };
        }
        if (method === "integrations.draft_send") {
          if (p.retry_version !== undefined && draft.state === 'failed' && p.retry_version === draft.version && p.digest === draft.digest) {
            draft.version++; draft.digest = 'c'.repeat(63) + draft.version; draft.state = 'draft';
          }
          if (p.digest !== draft.digest && p.retry_version === undefined || draft.state !== "draft") return { draft: copy(draft), sent: false };
          if (variant.cardMailFailure && !variant.cardMailRetried) { variant.cardMailRetried = true; draft.state = 'failed'; draft.error = 'send_failed'; changed(); return {draft:copy(draft),sent:false}; }
          state.sent.push({ id: draft.id, digest: p.digest, via: draft.from.key, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body });
          draft.state = "sent";
          changed();
          return { draft: copy(draft), sent: true };
        }
        if (method === "integrations.draft_discard") {
          const discarded = open;
          if (discarded) { draft.state = "discarded"; changed(); }
          return { draft: copy(draft), discarded };
        }
        // The owner's answer to 「這封回信可以交給…寄嗎？」: yes moves the same version to the colleague's chat, as a card
        // on a turn of that chat, and leaves one centred line in this one. It never sends.
        if (!draft.offer || draft.state !== "draft") return { draft: copy(draft), handed: false };
        if (p.choice === "no") { draft.offer = null; changed(); return { draft: copy(draft), handed: false, declined: true }; }
        const author = data.members.find(member => member.id === turn.member_id).name;
        const carrier = { id: nextId(data.turns), session_id: `draft-${draft.id}-${draft.version}`, member_id: draft.offer.member_id,
          conversation_id: data.colleagueConversation.id, created_at_ms: data.now, question: "", route: "draft", source: "draft", prefix: "",
          text: `${author}把一封郵件草稿「${draft.subject}」交給你，等主人編輯後寄出。`, detail: null, status: "done", cost_usd: 0, model: null,
          steps: [], attachments: [], messages: [], drafts: [{ ...structuredClone(draft), offer: null, holder_id: draft.offer.member_id, author_name: author }] };
        turn.drafts = turn.drafts.map(each => each === draft ? { id: draft.id, mode: "handed", state: draft.state, holder_id: draft.offer.member_id, holder_name: draft.offer.name } : each);
        data.turns.push(carrier);
        notify("AgentTurn", { turn_id: carrier.id, member_id: carrier.member_id });
        changed();
        return { draft: copy(carrier.drafts[0]), handed: true };
      }
      case "toolsets.list": return { groups: data.servers };
      case "integrations.connect": {
        if (variant.pluginsConnecting) return new Promise(() => {});
        return { connected: false, error: "cancelled" };
      }
      case "integrations.catalog": return { services: data.services };
      case "integrations.audit": return { entries: [] };
      case "integrations.inventory": return inventory();
      case "integrations.test": return { ok: true, tools: ["search", "save"] };
      case "integrations.preview": { const entries = Object.entries(JSON.parse(p.text).mcpServers ?? {}); return { candidates: entries.map(([name, definition], index) => ({ ...data.candidates[0], ...definition, id: `paste-${index}`, name })), rejected: 0 }; }
      case "integrations.discover": return { candidates: data.candidates, rejected: 0 };
      case "integrations.import": return { servers: data.candidates.filter(item => p.ids.includes(item.id)) };
      case "integrations.add": { const server = { ...data.servers[0], ...p, id: `server-${data.servers.length + 1}` }; data.servers.push(server); return { server }; }
      case "integrations.update": return { server: update(data.servers, p.id, p) };
      case "integrations.set_enabled": return { server: update(data.servers, p.id, { enabled: p.enabled, status: p.enabled ? "ready" : "disabled" }) };
      case "integrations.refresh": return { server: data.servers.find(s => s.id === p.id) };
      case "integrations.set_tool_enabled": {
        data.servers.find(s => s.id === p.id).tools.find(t => t.name === p.tool).enabled = p.enabled;
        return {};
      }
      case "integrations.set_tools_enabled": {
        for (const tool of data.servers.find(s => s.id === p.id).tools) if (p.tools.includes(tool.name)) tool.enabled = p.enabled;
        return {};
      }
      case "integrations.disconnect": update(data.servers, p.id, { enabled: false, status: "disconnected", auth: "none" }); return { disconnected: true };
      case "usage.runs": return { ...data.usage, range: p.range ?? data.usage.range, bill: usageBill(p.range ?? "month"), fish_voice: !!(data.settings.tts_enabled && data.settings.tts_service === "fish") };
      case "usage.allowances": return data.allowances;
      case "usage.analytics": return { ...data.analytics, range: p.range ?? data.analytics.range };
      case "usage.export": return { csv: data.usageCsv };
      case "messaging.telegram.status": return data.messaging;
      case "messaging.slack.status":
      case "messaging.discord.status": return variant.workMessaging?.[method.split('.')[1]] ?? {connected:false,enabled:false,running:false,error:null,bot:null,allowed:[],pending:[]};
      case "messaging.slack.connect":
      case "messaging.discord.connect": {
        const kind = method.split('.')[1];
        const connected = {connected:true,enabled:true,running:true,error:null,bot:{username:kind === 'slack' ? 'Research' : 'ResearchBot'},allowed:[],pending:[]};
        variant.workMessaging ??= {}; variant.workMessaging[kind] = connected;
        return {ok:true,status:connected};
      }
      case "computer.checkpoints": {
        const checkpoint = {id:'1234567890abcdef1234567890abcdef',member:1,turn:variant.roomOwnerCard === 'result' ? 950 : variant.cardTaskResult || variant.cardDeck ? 980 : 7,created:1792807185000,state:'ready',review_token:'a'.repeat(64),partial:!!variant.checkpointPartial,uncovered:variant.checkpointPartial ? ['/home/cua/workspace/video.mp4','/home/cua/workspace'] : [],files:[{path:'/home/cua/team/report.md',diff:'--- before\n+++ after\n@@ -1 +1 @@\n-舊版研究摘要\n+新版研究摘要，附來源與日期。\n'}]};
        if (p.action === 'restore') { variant.checkpointRestored = true; return {restored:[checkpoint.files[0].path],skipped:[]}; }
        return {checkpoints:variant.checkpoints || variant.cardDeck ? [{...checkpoint,state:variant.checkpointRestored ? 'restored' : 'ready'}] : [],busy:false,confirmation_required:data.settings.action_mode !== 'bypass'};
      }
      case "messaging.telegram.remove_user": data.messaging.allowed = data.messaging.allowed.filter(user => user.user_id !== p.user_id); return data.messaging;
      case "secrets.clear_openrouter_key": keyRemoved = true; return {};
      case "history.clear": { const deleted=data.history.length; data.history=[]; return {deleted}; }
      case "agent.history.clear": { const before=data.turns.length;data.turns=data.turns.filter(t=>t.member_id!==(p.member_id??0));return {deleted:before-data.turns.length}; }
      default: return unsupported(method);
    }
  }
  const callbacks = new Map(); let callbackId = 0;
  target.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(fn) { callbacks.set(++callbackId, fn); return callbackId; },
    unregisterCallback(id) { callbacks.delete(id); },
    runCallback(id, value) { callbacks.get(id)?.(value); },
    convertFileSrc(path) { return path; },
    async invoke(command, args = {}) {
      const recorded = command === "core_call" && args.method === "integrations.card_save" && args.params?.id === "card-login" ? {...args,params:{...args.params,value:"[private login]"}} : args;
      state.calls.push({ command, ...copy(command === "main_events" ? {} : recorded) });
      // Native Channel instances contain callbacks; do not serialize them before registration.
      if (command === "overlay_subscribe") {
        state.overlayChannel = args.channel;
        for (const event of variant.overlayEvents ?? []) args.channel.onmessage(copy(event));
        return;
      }
      if (command === "learned_subscribe") {
        state.learnedChannel = args.channel;
        for (const notice of variant.learnedNotices ?? []) args.channel.onmessage({ ...copy(notice), theme: config.theme ?? "light" });
        return;
      }
      if (command === "learned_layout" || command === "learned_finish") return;
      if (command === "floating_controls") return;
      if (command === "overlay_log") return;
      if (command === "overlay_confirm") return;
      if (command === "overlay_cancel") { state.overlayChannel?.onmessage({type:"hide"});return; }
      if (command === "agent_retract") {
        data.turns=data.turns.filter(turn=>turn.session_id!==args.sessionId&&turn.id!==args.turnId);
        pendingReplies.get(args.sessionId)?.();pendingReplies.delete(args.sessionId);
        notify("AgentTurn",{member_id:args.memberId,turn_id:args.turnId??0});return;
      }
      if (command === "main_events") { state.channel = args.channel; return; }
      if (command === "main_window_forward") return;
      if (command === "window_hotkey" && variant.ownerVoice && ["agent_down", "agent_up"].includes(args.kind)) {
        const member = args.memberId ?? 0;
        if (!data.conversations.some(c => c.id === args.conversationId && c.member_id === member)) throw new Error("Composer voice must name its own conversation");
        notify("Dictation", { phase: args.kind === "agent_down" ? "listening" : "processing", agent: true, member_id: member });
        if (args.kind === "agent_up" && variant.ownerVoice === "answer") {
          const turn = { ...copy(data.ownerRound.voiceReply), member_id: member, conversation_id: args.conversationId };
          data.turns.push(turn); notify("AgentTurn", { turn_id: turn.id, member_id: member });
        }
        return;
      }
      // Escape reaches the native worker even when no capture is active.
      if (command === "window_hotkey" && (args.kind === "cancel" || args.kind === "cancel_key")) {
        if (variant.stopVoice) notify("Dictation", { phase: "cancelled", agent: true, member_id: variant.stopVoiceMember ?? 0 });
        return;
      }
      if (command === "agent_ask_text") {
        if (variant.cardSendFailure && !variant.cardSendRetried) { variant.cardSendRetried = true; throw new Error("Synthetic send unavailable"); }
        if (variant.ownerAddition) {
          const active = data.turns.find(turn => turn.status === "running" && turn.member_id === args.memberId);
          if (!active) throw new Error("No running member turn");
          data.turns.push({...active, id: 901, session_id: args.requestId, question: args.text, route: "owner_input", text: "", status: "done", steps: [], messages: [], created_at_ms: data.now});
          notify("AgentTurn", {turn_id: 901, member_id: active.member_id});
          return null;
        }
        // The native call stays pending until the reply ends, including before the first agent.turn.
        if (variant.stopPending) return new Promise(resolve => pendingReplies.set(args.requestId, resolve));
        return null;
      }
      if (command === "core_call") return copy(await core(args.method, args.params));
      if (command === "device_settings_get") return copy(data.device);
      if (command === "device_settings_set") { Object.assign(data.device, args.patch); notify("DeviceSettings", { settings: copy(data.device) }); return copy(data.device); }
      if (command === "avatar_get") return copy(data.avatar);
      if (command === "agent_question_open") return copy(adminQuestion ?? permission?.question ?? null);
      if (command === "agent_question_answer" && permission) {
        if (args.id !== permission.question.id) throw new Error("Unknown permission question");
        if (variant.cardPermissionFailure && !variant.cardPermissionRetried) { variant.cardPermissionRetried = true; throw new Error("Synthetic approval unavailable"); }
        // The core settles the card once, and the turn with what Raphael says of it.
        const { turn, card } = permission;
        if (card.kind === "local_access" && args.approved && args.always) data.settings.local_commands_mode = "always";
        card.state = !args.approved ? "denied" : args.always ? "always" : "allowed";
        const text = args.approved ? permission.done : permission.denied;
        Object.assign(turn, { status: args.approved ? "done" : "denied", prefix: args.approved ? "答" : "了", text, messages: [{ seq: 1, kind: "reply", text, at_ms: data.now }] });
        notify("AgentQuestionClosed", { id: card.id });
        notify("AgentTurn", { turn_id: turn.id, member_id: turn.member_id });
        permission = null;
        return;
      }
      if (command === "agent_question_answer" && adminQuestion) {
        if (args.id !== adminQuestion.id) throw new Error("Unknown approval question");
        if (Array.isArray(args.drafts)) {
          if (args.approved) {
            const groups = args.groups ?? (data.adminGroup ? [data.adminGroup] : []);
            for (const proposed of groups) {
              const existing = data.groups.find(g => g.id === proposed.group_id);
              if (existing) existing.name = proposed.name;
              else if (!data.groups.some(g => g.name === proposed.name)) {
                data.groups.push({ ...copy(data.adminGroup), name: proposed.name });
              }
            }
            let nextMemberId = 8;
            for (const draft of args.drafts) {
              const group = data.groups.find(g => g.name === draft.group) ?? null;
              const id = nextMemberId++;
              data.members.push({
                ...data.members[1],
                ...data.adminMember,
                id,
                name: draft.name,
                role: draft.role,
                blurb: draft.blurb,
                personality: draft.personality ?? "",
                instructions: draft.instructions ?? "",
                group_id: group ? group.id : null,
                avatar: draft.avatar_preset ? (draft.avatar_preset.startsWith("preset:") ? draft.avatar_preset : `preset:${draft.avatar_preset}`) : "",
                avatar_url: null,
                position: data.members.length,
              });
              data.conversations.push({ id: 80 + id, member_id: id, title: "", is_default: true, created_at_ms: data.now, updated_at_ms: data.now });
            }
            notify("MembersChanged", { member_id: 8 });
            const names = args.drafts.map(d => d.name).join("、");
            adminTurn.status = "done";
            adminTurn.text = `已建立 ${names}`;
            adminTurn.detail = args.drafts.map(d => {
              const head = [d.name, d.role, d.group].filter(Boolean).join(" · ");
              return d.blurb ? `${head} — ${d.blurb}` : head;
            }).join("\n");
            adminTurn.messages.push({ seq: 4, kind: "reply", text: adminTurn.text, at_ms: data.now });
          } else {
            adminTurn.status = "denied";
            adminTurn.text = "已取消建立成員。";
            adminTurn.messages.push({ seq: 4, kind: "reply", text: adminTurn.text, at_ms: data.now });
          }
          notify("AgentQuestionClosed", { id: adminQuestion.id });
          notify("AgentTurn", { turn_id: adminTurn.id, member_id: 0 });
          adminQuestion = null;
          return;
        }
        if (args.approved && adminQuestion.tier !== "T3") {
          data.groups.push(copy(data.adminGroup));
          data.members.push({ ...data.members[1], ...data.adminMember });
          data.conversations.push({ id: 80, member_id: data.adminMember.id, title: "", is_default: true, created_at_ms: data.now, updated_at_ms: data.now });
          notify("MembersChanged", { member_id: data.adminMember.id });
        }
        adminTurn.status = args.approved ? "done" : "denied";
        adminTurn.text = args.approved ? "已建立 COO：營運長。" : "已取消建立成員。";
        adminTurn.messages.push({ seq: 4, kind: "reply", text: adminTurn.text, at_ms: data.now });
        notify("AgentQuestionClosed", { id: adminQuestion.id });
        notify("AgentTurn", { turn_id: adminTurn.id, member_id: 0 });
        adminQuestion = null;
        return;
      }
      if (command === "avatar_pick") return null;
      if (command === "plugin:app|version") return "0.2.0";
      if (command === "plugin:event|listen") return ++callbackId;
      if (command === "plugin:window|is_maximized") return maximized;
      if (command === "plugin:window|toggle_maximize") { maximized = !maximized; return; }
      if (command === "keyboard_has_altgr") return false;
      if (command === "mic_access") return { allowed: true, blocked_by: null };
      if (command === "schedule_keep_awake_get") return data.awake ?? false;
      if (command === "schedule_keep_awake_set") return data.awake = args.enabled;
      if (["open_external_url", "open_link"].includes(command)) {
        if (variant.cardLinkFailure && !variant.cardLinkRetried) { variant.cardLinkRetried = true; throw new Error("Unavailable"); }
        state.urls.push(args.url); return;
      }
      if (command === "save_usage_csv") { state.exported = args.csv; return true; }
      if (["agent_page_shown", "hotkeys_pause", "hotkeys_practice", "plugin:event|unlisten", "plugin:window|set_focus", "plugin:window|minimize", "plugin:window|close", "plugin:window|start_dragging", "plugin:webview|set_webview_zoom"].includes(command)) return;
      return unsupported(command);
    },
  };
  target.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  return state;
}
