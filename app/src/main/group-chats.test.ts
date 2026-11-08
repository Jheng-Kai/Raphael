// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import type { AppContext, HandoffView, Member } from "./types";
import * as chatComposer from "./chat-composer";
import * as richScroll from "./message-rich";
const api=vi.hoisted(()=>({membersList:vi.fn(),roomsCreate:vi.fn(),roomsList:vi.fn(),roomMessages:vi.fn(),roomSend:vi.fn(),roomsDelete:vi.fn(),roomsUpdate:vi.fn(),roomStop:vi.fn(),core:vi.fn(),pagesOpen:vi.fn(),ownerQuestionBring:vi.fn(),openTeamFile:vi.fn().mockResolvedValue(undefined)}));
vi.mock("./api",()=>api);
import { configureRooms, openNewGroupChat, openGroupChat, openRoomsMenu, createRoomsSection, createRoomPane, clearRoomSelection } from "./group-chats";
import { getLocale, setLocale, t } from "./i18n";
import { setAvatar } from './avatar';

test('an avatar repaint uses the loaded room and roster without IPC reads', async () => {
  const section=createRoomsSection();document.body.append(section);await flush();
  await pane(); api.roomsList.mockClear();api.membersList.mockClear();api.roomMessages.mockClear();
  setAvatar(null);await flush();
  expect(api.roomsList).not.toHaveBeenCalled();
  expect(api.membersList).not.toHaveBeenCalled();
  expect(api.roomMessages).not.toHaveBeenCalled();
});
const flush=async():Promise<void>=>{for(let i=0;i<24;i++)await Promise.resolve();};
const room={id:1,name:"Launch",member_ids:[0,1],group_id:null,created:1,is_team:0};
let event:(e:any)=>void;
let app:AppContext;
const pane=async()=>{const view=createRoomPane(app,vi.fn());document.body.append(view.el);await view.open(1);return view;};
const draft=(text:string)=>{const input=document.querySelector<HTMLTextAreaElement>("#room-message")!;input.value=text;input.dispatchEvent(new Event("input"));return input;};

test("a room page appends to its composer and waits for the owner's send", async () => {
  const page = { id: "room-page-draft", title: "Sample page", rev: 0, height: 320, source: "html", server: null };
  api.pagesOpen.mockResolvedValue({ ...page, url: "http://127.0.0.1:9/room-page-draft" });
  api.roomMessages.mockResolvedValue({ messages: [{ id: 22, member_id: 1, text: "Page", created: 1, status: "done", turn: { pages: [page] } }] });
  const view = await pane(); await flush();
  const input = draft("My room draft");
  const frame = view.el.querySelector<HTMLIFrameElement>(".pg-frame")!;
  Object.defineProperty(navigator, "userActivation", { value: { isActive: true }, configurable: true });
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  const focus = vi.spyOn(document, "activeElement", "get").mockReturnValue(frame);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  const event = new MessageEvent("message", { data: { raphaelPage: 1, type: "send", text: "Page room words" } });
  Object.defineProperty(event, "source", { value: frame.contentWindow });
  window.dispatchEvent(event); focus.mockRestore(); await flush();
  expect(api.roomSend).not.toHaveBeenCalled();
  expect(input.value).toBe("My room draft\nPage room words");
  expect(document.activeElement).toBe(input);
  expect(view.el.querySelector<HTMLElement>(".cmp-page-note")!.hidden).toBe(false);
  view.el.querySelector<HTMLFormElement>("form.composer")!.requestSubmit(); await flush();
  expect(api.roomSend).toHaveBeenCalledExactlyOnceWith(1, "My room draft\nPage room words", expect.any(String), getLocale(), [], undefined);
  view.close(); Reflect.deleteProperty(navigator, "userActivation");
});

test("bringing a room question releases queued scroll corrections before revealing its moved turn", async () => {
 const question={id:'pending-room',kind:'ask_owner',state:'asked',question:'Choose a date',turn_id:10};
 api.roomMessages.mockResolvedValue({messages:[],pending_questions:[question]});
 const view=await pane();
 const pending = '.pending-questions:not(.room-meeting-row) .pending-question';
 await vi.waitFor(()=>expect(view.el.querySelector(pending)).not.toBeNull());
 const released=vi.spyOn(richScroll,'releaseRichScroll');
 api.ownerQuestionBring.mockResolvedValue({turn_id:99});
 api.roomMessages.mockResolvedValue({messages:[{id:999,member_id:1,text:'Moved question',created:2,status:'done',turn_id:99}],pending_questions:[{...question,turn_id:99}]});
 view.el.querySelector<HTMLButtonElement>(pending)!.click();
 await vi.waitFor(()=>expect(released).toHaveBeenCalledOnce());
 expect(view.el.querySelector('[data-room-message="999"]')).not.toBeNull();
 released.mockRestore(); view.close();
});

test("startup rooms recover from a failed first read without a CoreReady event", async () => {
 vi.useFakeTimers();
 try {
  api.roomsList.mockRejectedValueOnce(new Error("The core is starting"));
  const section=createRoomsSection();document.body.append(section);await flush();
  expect(section.querySelector('[data-room="1"]')).toBeNull();
  await vi.advanceTimersByTimeAsync(3500);await flush();
  expect(section.querySelector('[data-room="1"] b')?.textContent).toBe("Launch");
  const reads=api.roomsList.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.roomsList).toHaveBeenCalledTimes(reads);
  section.remove();
 } finally { vi.useRealTimers(); }
});

test("startup rooms retry a failed roster and stop after a successful empty list", async () => {
 vi.useFakeTimers();
 try {
  api.membersList.mockRejectedValueOnce(new Error("The core is starting"));
  api.roomsList.mockResolvedValue({rooms:[]});
  const section=createRoomsSection();document.body.append(section);await flush();
  await vi.advanceTimersByTimeAsync(3500);await flush();
  expect(api.membersList.mock.calls.length).toBeGreaterThan(1);
  const reads=api.roomsList.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.roomsList).toHaveBeenCalledTimes(reads);
  section.remove();
 } finally { vi.useRealTimers(); }
});

test("a detached sidebar stops startup retries", async () => {
 vi.useFakeTimers();
 try {
  api.roomsList.mockRejectedValue(new Error("The core is starting"));
  const section=createRoomsSection();document.body.append(section);await flush();section.remove();
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.roomsList).toHaveBeenCalledTimes(1);
  api.roomsList.mockResolvedValue({rooms:[room]});
 } finally { vi.useRealTimers(); }
});

test("startup retry delay stays bounded during a longer core outage", async () => {
 vi.useFakeTimers();
 try {
  api.roomsList.mockRejectedValue(new Error("The core is starting"));
  const section=createRoomsSection();document.body.append(section);await flush();
  await vi.advanceTimersByTimeAsync(3850);
  const reads=api.roomsList.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1999);
  expect(api.roomsList).toHaveBeenCalledTimes(reads);
  api.roomsList.mockResolvedValue({rooms:[room]});
  await vi.advanceTimersByTimeAsync(1);await flush();
  expect(api.roomsList).toHaveBeenCalledTimes(reads+1);
  expect(section.querySelector('[data-room="1"] b')?.textContent).toBe("Launch");
  section.remove();
 } finally { api.roomsList.mockResolvedValue({rooms:[room]});vi.useRealTimers(); }
});

test("returning to a visible window refreshes room rows without a core event", async () => {
 const section=createRoomsSection();document.body.append(section);await flush();
 const hidden=vi.spyOn(document,"hidden","get").mockReturnValue(true);
 try {
  document.dispatchEvent(new Event("visibilitychange"));
  api.roomsList.mockResolvedValue({rooms:[{...room,name:"Changed while hidden"}]});
  hidden.mockReturnValue(false);document.dispatchEvent(new Event("visibilitychange"));await flush();
  expect(section.querySelector('[data-room="1"] b')?.textContent).toBe("Changed while hidden");
 } finally { hidden.mockRestore();section.remove(); }
});

test("room drafts retain files and quotes in memory and words across a new pane", async () => {
 const view=await pane(); draft('Unsent room words');
 const file=new File(['Sample file'],'sample.txt',{type:'text/plain'});
 const transfer={files:[file],types:['Files']};const drop=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:transfer});view.el.querySelector('.ra-stage')!.dispatchEvent(drop);
 await new Promise(resolve=>setTimeout(resolve,0));await flush();
 view.close();await view.open(1);
 expect(view.el.querySelector<HTMLTextAreaElement>('#room-message')!.value).toBe('Unsent room words');
 expect(view.el.querySelector('.cmp-chip-t')?.textContent).toBe('sample.txt');
 view.close();view.el.remove();
 const next=await pane();expect(next.el.querySelector<HTMLTextAreaElement>('#room-message')!.value).toBe('Unsent room words');
 expect(next.el.querySelector('.cmp-chip')).toBeNull();next.close();
});

test("a deleted room drops its stored words and reply target", async () => {
 api.roomMessages.mockResolvedValue({messages:[{id:12,member_id:1,text:'Quoted sample',created:1,status:'done'}]});
 const view=await pane();document.querySelector<HTMLElement>('[data-room-act="reply"]')!.click();draft('Unsent sample');
 view.close();await view.open(1);
 expect(view.el.querySelector('.cmp-quote')!.textContent).toContain('Reply to Alice');
 view.close();view.el.remove();
 const next=await pane();expect(next.el.querySelector('.cmp-quote')!.textContent).toContain('Reply to Alice');
 api.roomsList.mockResolvedValue({rooms:[]});await next.refresh();
 expect(JSON.parse(localStorage.getItem('raphael.composer.drafts')??'{}')['room:1']).toBeUndefined();
});

test("only consecutive room receipts fold, and an arriving receipt keeps the line and the intervening message", async () => {
 const task = (id:number, created:number):HandoffView => ({task_id:id,source_turn_id:1,work_turn_id:100+id,member_id:1,member_name:"Alice",from_member_id:0,
  stage_id:"",mode:"work",state:"done",reason:null,created_at_ms:created,ready_at_ms:created,dispatch_policy:"immediate",result:"Sample result",evidence:[]});
 const history={messages:[{id:1,member_id:0,text:"A separating message",created:5,status:"done"}],handoffs:[task(1,1),task(2,2),task(3,7),task(4,8)]};
 api.roomMessages.mockResolvedValue(history);
 const view=await pane();
 const groups=view.el.querySelectorAll<HTMLElement>('[data-handoff-group]'); expect(groups).toHaveLength(2);
 expect([...view.el.querySelectorAll('.au-room-thread > li')].map(row=>row.classList.contains('handoff-row'))).toEqual([true,false,true]);
 expect(groups[0].textContent).toContain('2 messages');
 const message=view.el.querySelector('[data-room-message="1"]'); history.handoffs.push(task(5,3)); await view.refresh();
 expect(view.el.querySelector('[data-handoff-group]')).toBe(groups[0]);
 expect(groups[0].textContent).toContain('3 messages'); expect(view.el.querySelector('[data-room-message="1"]')).toBe(message);
 view.close();
});

test("room rows render the RPC summary and select only the visible conversation page", async () => {
 let active = true;
 const last_at = Date.UTC(2026, 9, 30, 9, 10);
 api.roomsList.mockResolvedValue({rooms:[{...room,preview:"Latest room reply",last_at,unread:true}]});
 const section=createRoomsSection(() => active);document.body.append(section);await flush();
 expect(section.querySelector('[data-room="1"] .mb-row-p')?.textContent).toBe('Latest room reply');
 expect(section.querySelector('time')).toBeNull();
 expect(section.querySelector('[data-room="1"] .is-unread')).not.toBeNull();
 openGroupChat(1);await flush();
 expect(section.querySelector('[data-room="1"]')?.getAttribute('aria-current')).toBe('true');
 active=false;section.dispatchEvent(new Event('sidebar-draw'));
 expect(section.querySelector('[aria-current="true"]')).toBeNull();
 active=true;section.dispatchEvent(new Event('sidebar-draw'));
 expect(section.querySelector('[data-room="1"]')?.getAttribute('aria-current')).toBe('true');
});

test("a room update during opening never draws an incomplete room before the newer refresh finishes", async () => {
 let first!: (value: unknown) => void, next!: (value: unknown) => void;
 api.roomsList.mockReturnValueOnce(new Promise(resolve => {first=resolve;})).mockReturnValueOnce(new Promise(resolve => {next=resolve;}));
 const view=createRoomPane(app,vi.fn());document.body.append(view.el);
 const opening=view.open(1);
 const refreshing=view.refresh();
 first({rooms:[room]});
 await expect(opening).resolves.toBeUndefined();
 expect(view.el.querySelector('.au-room-heading')?.textContent).toBe('');
 next({rooms:[room]});await refreshing;await flush();
 expect(view.el.querySelector('.au-room-heading b')?.textContent).toBe('Launch');
 view.close();
});

test("a message sent while room details load keeps the requested room identity", async () => {
 let release!: (value: unknown) => void;
 api.roomsList.mockReturnValueOnce(new Promise(resolve => {release=resolve;}));
 const view=createRoomPane(app,vi.fn());document.body.append(view.el);
 const opening=view.open(1);
 draft("Sent while loading");document.querySelector('form.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await flush();
 expect(api.roomSend.mock.calls[0]?.slice(0,2)).toEqual([1,"Sent while loading"]);
 release({rooms:[room]});await opening;await flush();
 expect(view.el.querySelector('.au-room-heading b')?.textContent).toBe('Launch');
 view.close();
});

test("an open room deleted elsewhere closes before its missing history can produce an error", async () => {
 const view=await pane();
 api.roomsList.mockResolvedValue({rooms:[]});
 api.roomMessages.mockRejectedValue(new Error("room not found"));
 event({type:"RoomsChanged"}); await flush();
 expect(view.active).toBe(false);
 expect(document.body.textContent).not.toContain("room not found");
 expect(document.body.textContent).toContain("This group was deleted");
});
test("deletion racing the history request rechecks existence before reporting an error",async()=>{
 const view=await pane();
 api.roomsList.mockResolvedValueOnce({rooms:[room]}).mockResolvedValue({rooms:[]});
 api.roomMessages.mockRejectedValue(new Error("room not found"));
 event({type:"RoomsChanged"});await flush();
 expect(view.active).toBe(false);expect(document.body.textContent).not.toContain("room not found");
});
test("a hidden room keeps unread messages until its visible history is acknowledged", async () => {
 const hidden = document.createElement("div"); hidden.hidden = true; document.body.append(hidden);
 const view = createRoomPane(app, vi.fn()); hidden.append(view.el);
 api.roomsList.mockResolvedValue({rooms:[{...room,unread:true}]});
 api.roomMessages.mockResolvedValue({messages:[{id:12,member_id:1,text:"Ready",created:1,status:"done"}]});
 await view.open(1);
 expect(api.roomsUpdate).not.toHaveBeenCalled();
 hidden.hidden = false; await view.refresh();
 expect(api.roomsUpdate).toHaveBeenCalledWith(1, {read:true,read_through:12});
 view.close();
});

test("the sidebar offers no everyone group: an empty former team room is gone, one with a conversation stays", async () => {
 const rows=async(rooms:unknown[])=>{
  api.roomsList.mockResolvedValue({rooms});
  const section=createRoomsSection();document.body.append(section);await flush();
  const names=[...section.querySelectorAll('[data-room] b')].map(el=>el.textContent);
  section.remove();
  return names;
 };
 expect(await rows([])).toEqual([]);
 expect(await rows([{...room,id:2,is_team:1}])).toEqual([]);
 expect(await rows([room,{...room,id:2,is_team:1,last_at:5}])).toEqual(["Launch","Everyone"]);
 expect(api.roomsCreate).not.toHaveBeenCalled();
});
beforeEach(()=>{ localStorage.clear();document.body.innerHTML="";vi.clearAllMocks();setLocale("en");const members=[0,1].map(id=>({id,name:id?"Alice":"Raphael",avatar:""} as Member));api.membersList.mockResolvedValue({members,groups:[]});api.roomsCreate.mockResolvedValue({room});api.roomsList.mockResolvedValue({rooms:[room]});api.roomMessages.mockResolvedValue({messages:[]});api.roomSend.mockResolvedValue({message_id:1,duplicate:false});app={go:vi.fn(),onEvent:(fn:any)=>{event=fn;return()=>{};}} as unknown as AppContext;clearRoomSelection();configureRooms(app);api.roomsUpdate.mockResolvedValue({room});});
test("a primary changes room picker order and becomes the required chief", async () => {
 const { members } = await api.membersList();
 api.membersList.mockResolvedValue({ members, groups: [], team_context: { primary_id: 1 } });
 await openNewGroupChat();
 expect([...document.querySelectorAll<HTMLElement>('[data-dlg="member"]')].map(row=>row.dataset.member)).toEqual(['1','0']);
 const chief=document.querySelector<HTMLButtonElement>('[data-dlg="member"][data-member="1"]')!;
 expect(chief.disabled).toBe(true); expect(chief.getAttribute('aria-pressed')).toBe('true');
 expect(document.querySelector('[data-dlg="member"][data-member="0"]')!.getAttribute('aria-pressed')).toBe('false');
 document.querySelector<HTMLElement>('[data-dlg="member"][data-member="0"]')!.click();
 // The rows' own checks say who takes part (owner, 2026-11-09): no second line of picked names.
 expect([...document.querySelectorAll<HTMLElement>('[data-dlg="member"][aria-pressed="true"]')].map(row=>row.querySelector('.room-row-name')!.textContent)).toEqual(['Alice','Raphael']);
 expect(document.querySelector('[data-picked]')).toBeNull();
 expect(api.roomsCreate).not.toHaveBeenCalled();
 document.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
});

test("new group requires members and saves checked identities",async()=>{
 await openNewGroupChat();document.querySelector<HTMLInputElement>('#room-name')!.value="Launch";document.querySelector("#room-name")!.dispatchEvent(new Event("input"));document.querySelector<HTMLElement>('[data-dlg="create"]')!.click();await flush();expect(api.roomsCreate).not.toHaveBeenCalled();expect(document.querySelector('input[type="checkbox"]')).toBeNull();expect(document.querySelector<HTMLInputElement>('#room-name')!.placeholder).toBeTruthy();document.querySelector<HTMLElement>('[data-member="1"]')!.click();expect(document.querySelector('[data-member="1"]')!.getAttribute('aria-pressed')).toBe('true');document.querySelector<HTMLElement>('[data-dlg="member"][data-member="0"]')!.click();document.querySelector<HTMLElement>('[data-dlg="create"]')!.click();await flush();expect(api.roomsCreate).toHaveBeenCalledWith({name:"Launch",member_ids:[0,1],group_id:null,default_responder:"auto",request_id:expect.any(String)});expect(app.go).toHaveBeenCalledWith('agent');expect(document.querySelector('.au-room-dialog')).toBeNull();
});
test("failed send retains the draft and reuses its idempotency key on retry",async()=>{
 api.roomSend.mockRejectedValueOnce(new Error("offline"));await pane();const input=draft("@Alice hello");document.querySelector<HTMLElement>('.cmp-send')!.click();await flush();const id=api.roomSend.mock.calls[0][2];expect(input.value).toBe("@Alice hello");document.querySelector<HTMLElement>('.cmp-send')!.click();await flush();expect(api.roomSend.mock.calls[1][2]).toBe(id);expect(input.value).toBe("");
});

test("Stop during send acknowledgement also cancels the exchange once accepted",async()=>{
 let accept!:(value:unknown)=>void;
 api.roomSend.mockImplementationOnce(()=>new Promise(resolve=>{accept=resolve;}));
 api.roomStop.mockResolvedValue({stopped:true});await pane();draft("Start work");
 document.querySelector<HTMLElement>('.cmp-send')!.click();
 expect(document.querySelector<HTMLElement>('.composer')!.dataset.taskState).toBe('ack');
 document.querySelector<HTMLButtonElement>('.cmp-voice')!.click();await flush();
 expect(api.roomStop).toHaveBeenCalledOnce();
 accept({message_id:1,duplicate:false});await flush();
 expect(api.roomStop).toHaveBeenCalledTimes(2);
 expect(document.querySelector<HTMLElement>('.composer')!.dataset.taskState).toBe('idle');
});

test("generated room names preserve owner edits and creation retries reuse the request",async()=>{
 api.roomsCreate.mockRejectedValueOnce(new Error("offline"));
 await openNewGroupChat();
 expect(document.querySelector<HTMLButtonElement>('[data-dlg="member"][data-member="0"]')!.disabled).toBe(true);
 document.querySelector<HTMLElement>('[data-dlg="member"][data-member="1"]')!.click();
 const input=document.querySelector<HTMLInputElement>('#room-name')!;
 expect(input.value).toBe('Raphael · Alice');input.value='Owner name';input.dispatchEvent(new Event('input'));
 document.querySelector<HTMLElement>('[data-dlg="create"]')!.click();await flush();
 document.querySelector<HTMLElement>('[data-dlg="create"]')!.click();await flush();
 expect(api.roomsCreate.mock.calls[0][0]).toEqual(api.roomsCreate.mock.calls[1][0]);
 expect(api.roomsCreate.mock.calls[1][0].name).toBe('Owner name');
});

test("reply labels distinguish owner sources from unavailable sources",async()=>{
 api.roomMessages.mockResolvedValue({messages:[
  {id:2,member_id:1,text:'Answer',created:1,status:'done',reply_reference:{message_id:1,author_kind:'owner',author_member_id:null}},
  {id:3,member_id:1,text:'Kept reply',created:1,status:'done',reply_reference:{message_id:9,unavailable:true}},
 ]});await pane();
 expect([...document.querySelectorAll('.au-room-reply')].map(el=>el.textContent)).toEqual(['Reply to You','Source unavailable']);
});

test("the room voice target seeds correction learning while preserving reply delivery",async()=>{
 const create=vi.spyOn(chatComposer,"createChatComposer");
 try {
  api.core.mockResolvedValue({learned:["OpenMausBot"]});
  api.roomMessages.mockResolvedValue({messages:[{id:7,member_id:1,text:"Ready",created:1,status:"done"}]});
  await pane();document.querySelector<HTMLElement>('[data-room-act="reply"]')!.click();
  create.mock.calls[create.mock.calls.length-1][0].transcriptTarget!()("Please use Open Mouse Bot");
  draft("Please use OpenMausBot");document.querySelector<HTMLElement>('.cmp-send')!.click();await flush();
  expect(api.roomSend).toHaveBeenCalledWith(1,"Please use OpenMausBot",expect.any(String),"en",[],7);
  expect(api.core).toHaveBeenCalledWith("dictionary.correct",{edits:[{before:"Please use Open Mouse Bot",after:"Please use OpenMausBot"}]});
  expect(document.querySelector('.cmp-quote')!.textContent).toBe("");
 } finally { create.mockRestore(); }
});
test("live replies keep the composer draft, speaker identity and escaped text",async()=>{
 await pane();const input=draft("Unsaved draft");api.roomMessages.mockResolvedValue({messages:[{id:1,member_id:1,text:"<script>untrusted()</script>",created:1,status:"done"}]});event({type:"RoomsChanged",room_id:1});await flush();expect(input.value).toBe("Unsaved draft");expect(document.querySelector('.au-room-thread')!.textContent).toContain("Alice");expect(document.querySelector('.au-room-thread script')).toBeNull();
});
test("sidebar section loads rooms and opens the selected thread",async()=>{
 const section=createRoomsSection();document.body.append(section);await flush();expect(section.textContent).toContain("Launch");section.querySelector<HTMLElement>('[data-room="1"]')!.click();await flush();expect(app.go).toHaveBeenCalledWith('agent');expect(document.querySelector('.au-room-dialog')).toBeNull();
});

test("loading older messages survives live refresh and stops offering exhausted history",async()=>{
 const latest=Array.from({length:100},(_,i)=>({id:i+101,room_id:1,member_id:null,text:`Message ${i+101}`,created:1,status:"done"}));
 api.roomMessages.mockResolvedValueOnce({messages:latest});await pane();
 api.roomMessages.mockResolvedValueOnce({messages:[{...latest[0],id:1,text:"Oldest message"}]});
 document.querySelector<HTMLElement>('[data-room-act="older"]')!.click();await flush();
 expect(document.querySelector('[data-room-act="older"]')).toBeNull();
 api.roomMessages.mockResolvedValue({messages:latest});event({type:"RoomsChanged",room_id:1});await flush();
 expect(document.querySelector('.au-room-thread')!.textContent).toContain("Oldest message");
});

test("an open group closes when its room is deleted live",async()=>{
 const view=await pane();api.roomsList.mockResolvedValue({rooms:[]});event({type:"RoomsChanged",room_id:1});await flush();expect(view.el.hidden).toBe(true);
});

test("compact rooms menu opens an existing room and offers creation",async()=>{
 const anchor=document.createElement("button");document.body.append(anchor);await openRoomsMenu(anchor);
 document.querySelector<HTMLElement>('#app-popover [data-value="1"]')!.click();await flush();expect(app.go).toHaveBeenCalledWith('agent');expect(document.querySelector('.au-room-dialog')).toBeNull();
 await openRoomsMenu(anchor);
 document.querySelector<HTMLElement>('#app-popover [data-action]')!.click();await flush();expect(document.querySelector('#room-name')).not.toBeNull();
});


test("room thread uses owner bubbles and keeps room turns out of private navigation",async()=>{
 api.roomMessages.mockResolvedValue({messages:[{id:1,member_id:null,text:"Hello",created:1,status:"done"},{id:2,member_id:1,text:"Done",created:2,status:"done",turn_id:23}]});
 await pane();expect(document.querySelector('.me .bubble .message-text')!.textContent).toBe("Hello");expect(document.querySelector('.ra .au-room-author')!.textContent).toBe("Alice");
 expect(document.querySelector('[data-room-act="turn"]')).toBeNull();expect(document.querySelector('.cmp-attach')).not.toBeNull();expect(document.querySelector('.cmp-voice')).not.toBeNull();expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("room header members menu saves selected identities",async()=>{
 await pane();document.querySelector<HTMLElement>('[data-room-menu]')!.click();document.querySelector<HTMLElement>('#app-popover [data-pick="members"]')!.click();
 await flush();
 document.querySelector<HTMLElement>('[data-dlg="member"][data-member="0"]')!.click();document.querySelector<HTMLElement>('[data-dlg="save"]')!.click();await flush();expect(api.roomsUpdate).toHaveBeenCalledWith(1,{member_ids:[0,1],default_responder:"auto"});
});

test("room rows expose rename, membership and confirmed deletion through more",async()=>{
 const section=createRoomsSection();document.body.append(section);await flush();
 expect(section.querySelector('[data-room-delete]')).toBeNull();
 const more=section.querySelector<HTMLButtonElement>('[data-room-more="1"]')!;
 expect(more.getAttribute('aria-haspopup')).toBe('menu');more.click();
 expect([...document.querySelectorAll('#app-popover [data-pick]')].map(el=>(el as HTMLElement).dataset.pick)).toEqual(['pin','hide','rename','members','roles','delete']);
 document.querySelector<HTMLElement>('[data-pick="delete"]')!.click();await flush();
 expect(api.roomsDelete).not.toHaveBeenCalled();
 document.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();await flush();
 expect(api.roomsDelete).not.toHaveBeenCalled();
 more.click();document.querySelector<HTMLElement>('[data-pick="delete"]')!.click();await flush();
 document.querySelector<HTMLElement>('[data-dlg="delete"]')!.click();await flush();
 expect(api.roomsDelete).toHaveBeenCalledWith(1);
});

test("reply chips identify their recipient including Raphael's zero id and escape names",async()=>{
 api.membersList.mockResolvedValue({members:[{id:0,name:'Raphael',avatar:''},{id:1,name:'<img src=x onerror=bad()>',avatar:''}],groups:[]});
 api.roomMessages.mockResolvedValue({messages:[{id:1,member_id:0,text:'Agreed',reply_reference:{message_id:8,author_kind:'member',author_member_id:1},reply_to_member:1,kind:'message',created:1,status:'done'},{id:2,member_id:1,text:'Thanks',reply_reference:{message_id:9,author_kind:'member',author_member_id:0},reply_to_member:0,created:2,status:'done'}]});
 await pane();const chips=[...document.querySelectorAll('.au-room-reply')];
 expect(chips.map(el=>el.textContent)).toEqual(['Reply to <img src=x onerror=bad()>','Reply to Raphael']);
 expect(document.querySelector('.au-room-reply img')).toBeNull();
});

test("a streamed room table stays provisional and becomes a rich card only after completion",async()=>{
 const message={id:91,member_id:1,text:'Summary\n\n| Name | Value |\n| --- | --- |\n| partial',created:1,status:'running'};
 api.roomMessages.mockResolvedValue({messages:[message]});await pane();
 expect(document.querySelector('.message-table')).toBeNull();
 expect(document.querySelector('.au-room-message .message-text')!.textContent).toContain('| partial');
 api.roomMessages.mockResolvedValue({messages:[{...message,status:'done',text:message.text+' | complete |'}]});
 event({type:'RoomsChanged',room_id:1});await flush();
 expect(document.querySelector('.message-table td')!.textContent).toBe('partial');
 expect(document.querySelector('.ans .message-table')).toBeNull();
});

test("each working member has a live action row which disappears when completed",async()=>{
 const replies=[{id:1,member_id:1,text:'',created:1,status:'running'},{id:2,member_id:0,text:'',created:2,status:'running'}];
 api.roomMessages.mockResolvedValue({messages:replies});await pane();
 expect(document.querySelectorAll('.au-room-thinking')).toHaveLength(2);
 expect(document.querySelector('.au-room-thinking')!.textContent).toBe('AliceThinking');
 expect(document.querySelector('.au-room-thinking .av')).not.toBeNull();
 expect(document.querySelectorAll('.au-room-message')).toHaveLength(0);
 api.roomMessages.mockResolvedValue({messages:replies.map(m=>({...m,status:'done',text:'Finished'}))});
 event({type:'RoomsChanged',room_id:1});await flush();
 expect(document.querySelector('.au-room-thinking')).toBeNull();
 expect(document.querySelectorAll('.au-room-message')).toHaveLength(2);
});

test("new room saves a selected default responder and resets it when that member leaves",async()=>{
 await openNewGroupChat();document.querySelector<HTMLInputElement>('#room-name')!.value='Plans';document.querySelector('#room-name')!.dispatchEvent(new Event('input'));
 for(const id of [0,1])document.querySelector<HTMLElement>(`[data-dlg="member"][data-member="${id}"]`)!.click();
 document.querySelector<HTMLElement>('[data-dlg="responder"]')!.click();
 document.querySelector<HTMLElement>('#app-popover [data-value="member:1"]')!.click();
 document.querySelector<HTMLElement>('[data-dlg="create"]')!.click();await flush();
 expect(api.roomsCreate).toHaveBeenCalledWith({name:'Plans',member_ids:[0,1],group_id:null,default_responder:'member:1',request_id:expect.any(String)});
 await openNewGroupChat();
 for(const id of [0,1])document.querySelector<HTMLElement>(`[data-dlg="member"][data-member="${id}"]`)!.click();
 document.querySelector<HTMLElement>('[data-dlg="responder"]')!.click();document.querySelector<HTMLElement>('#app-popover [data-value="member:1"]')!.click();
 document.querySelector<HTMLElement>('[data-dlg="member"][data-member="1"]')!.click();
 expect(document.querySelector('[data-dlg="responder"]')!.textContent).toContain('Everyone decides');
});

test("reply controls target a member message and can be cancelled",async()=>{
 api.roomMessages.mockResolvedValue({messages:[{id:12,member_id:1,text:'Ready',created:1,status:'done'}]});await pane();
 document.querySelector<HTMLElement>('[data-room-act="reply"]')!.click();
 expect(document.querySelector('.cmp-quote')!.textContent).toContain('Reply to Alice');
 draft('More details');document.querySelector<HTMLElement>('.cmp-send')!.click();await flush();
 expect(api.roomSend.mock.calls[0][5]).toBe(12);
 document.querySelector<HTMLElement>('[data-room-act="reply"]')!.click();document.querySelector<HTMLElement>('[data-room-act="cancel-reply"]')!.click();
 expect((document.querySelector('.cmp-quote') as HTMLElement).hidden).toBe(true);
});

test("active exchanges expose stop, and Raphael's wrap-up is his ordinary message",async()=>{
 api.roomStop.mockResolvedValue({stopped:true});
 api.roomMessages.mockResolvedValue({messages:[{id:12,member_id:0,text:'Alice owns testing',kind:'wrapup',created:1,status:'done'}],exchange:{state:'running',stop_requested:0}});
 await pane();
 const wrapup=document.querySelector('.au-room-wrapup')!;
 expect(wrapup.querySelector('.au-room-author')!.textContent).toBe('Raphael');
 expect(wrapup.textContent).not.toContain('Wrap-up');
 expect(wrapup.querySelector('h3')).toBeNull();
 expect(document.querySelector('.au-room-crown')!.getAttribute('aria-label')).toBe('Chief of staff');
 document.querySelector<HTMLElement>('.au-room-pane .composer[data-task-state="running"] .cmp-voice')!.click();await flush();expect(api.roomStop).toHaveBeenCalledWith(1);
 api.roomMessages.mockResolvedValue({messages:[],exchange:{state:'stopped',stop_requested:1}});event({type:'RoomsChanged',room_id:1});await flush();
 expect(document.querySelector('.au-room-pane .composer[data-task-state="running"] .cmp-voice')).toBeNull();
});

test("a blocked reply is a line of the thread after its exchange, with its reason in words",async()=>{
 const intent=(id:number,origin:number,reason:string)=>({id,origin_message_id:origin,source_message_id:origin,recipient_id:1,recipient_name:'Alice',state:'blocked',reason});
 api.roomMessages.mockResolvedValue({messages:[{id:1,member_id:null,text:'@Alice check',created:1,status:'done'},{id:2,member_id:0,text:'On it.',created:2,status:'done',origin_message_id:1},
   {id:3,member_id:null,text:'@Alice again',created:3,status:'done'}],exchange:{state:'stopped',stop_requested:1,reply_intents:[intent(7,1,'cli_rate_limited'),intent(8,3,'cli_quota'),intent(9,3,'mystery')]}});
 await pane();
 const rows=[...document.querySelectorAll('.au-room-thread > li')].map(row=>row.matches('.room-intent-blocked')?row.textContent:(row as HTMLElement).dataset.roomMessage);
 expect(rows).toEqual(['1','2',"Alice couldn't reply: Rate limited for too many requests",'3',"Alice couldn't reply: Subscription quota used up","Alice couldn't reply: Something went wrong"]);
 expect(document.querySelector('.au-room-controls')!.textContent).toBe('');
});

test("a hand-off line names its assignee and opens their conversation with the request, result and files, never its number",async()=>{
 api.roomMessages.mockResolvedValue({messages:[{id:1,member_id:0,text:'Alice, write the report.',created:1,status:'done',turn_id:5}],exchange:null,handoffs:[{task_id:42,source_turn_id:5,work_turn_id:6,member_id:1,member_name:'Alice',from_member_id:0,stage_id:'stage-xyz',mode:'work',state:'done',reason:null,created_at_ms:2,ready_at_ms:2,dispatch_policy:'immediate',request:'Write the report.',result:'Report ready.',evidence:[{kind:'artifact',uri:'out/report.html',mime:'text/html',digest:'abc',verdict:'verified'}]}]});
 const view=await pane();
 const line=document.querySelector<HTMLElement>('[data-handoff="42"]')!;
 expect(line.textContent).toBe('2 messages with Alice');
 line.click();
 const chat=view.el.querySelector<HTMLElement>(':scope > .peer-chat')!;
 expect(chat.getAttribute('aria-label')).toBe(`${t("agent.title")} ⇄ Alice`);
 expect([...chat.querySelectorAll('.peer-line')].map(row=>row.querySelector('.peer-who')!.textContent)).toEqual([t("agent.title"),'Alice']);
 expect(chat.querySelector('.peer-line .message-text')!.textContent).toBe('Write the report.');
 expect(chat.querySelector('.handoff-files')!.textContent).toBe('report.html');
 expect(line.textContent+chat.textContent).not.toMatch(/42|abc|stage-xyz/);
 chat.querySelector<HTMLElement>('.peer-close')!.click();
 expect(view.el.querySelector('.peer-chat')).toBeNull();
});

test("concurrent speech stays visible beside the board and a report opens its real private turn",async()=>{
 const task:HandoffView={task_id:42,source_turn_id:5,work_turn_id:6,member_id:1,member_name:'Alice',from_member_id:1,
  stage_id:'review',mode:'work',state:'done',reason:null,created_at_ms:2,ready_at_ms:2,dispatch_policy:'immediate',result:'Public result',evidence:[{id:51,kind:'artifact',uri:'out/review.txt',digest:'receipt',verdict:'verified'}]};
 api.roomMessages.mockResolvedValue({messages:[
  {id:1,member_id:0,text:'',created:1,status:'running'},
  {id:2,member_id:1,text:'',created:1,status:'running'},
  {id:3,member_id:1,text:'Public result',created:2,status:'done',kind:'report',report:task}],
  handoffs:[task],decisions:[{id:4,member_id:0,text:'One stage owner'}]});
 const view=await pane();
 expect(view.el.querySelectorAll('.au-room-thinking')).toHaveLength(2);
 const row=view.el.querySelector<HTMLElement>('.room-meeting-row')!;
 expect(row.hidden).toBe(false);
 expect(view.el.querySelector('.ra-scroll')!.contains(row)).toBe(false);
 expect(view.el.querySelector('.thread [data-room-board]')).toBeNull();
 row.querySelector<HTMLButtonElement>('button')!.click();
 expect(document.querySelector('#app-popover [data-room-board]')?.textContent).toContain('One stage owner');
 expect(document.querySelector('#app-popover .card-status')).not.toBeNull();
 row.querySelector<HTMLButtonElement>('button')!.click();
 view.el.querySelector<HTMLButtonElement>('[data-room-act="artifact-open"]')!.click();
 expect(api.openTeamFile).toHaveBeenCalledWith('task-artifact:42:51');
 expect(view.el.querySelectorAll('[data-room-report="42"]')).toHaveLength(1);
 expect(view.el.querySelector('[data-handoff="42"]')).toBeNull();
 const opened=vi.fn();window.addEventListener('raphael:open-member',opened);
 try {
  view.el.querySelector<HTMLButtonElement>('[data-room-act="private-work"]')!.click();
  expect(app.go).toHaveBeenCalledWith('agent');
  expect(opened.mock.calls[0][0].detail).toEqual({memberId:1,turnId:6});
 } finally { window.removeEventListener('raphael:open-member',opened);view.close(); }
});

test("a closing message is what the chief wrote, escaped, with no parts imposed on it",async()=>{
 setLocale('zh-TW');
 api.membersList.mockResolvedValue({members:[{id:0,name:'拉斐爾',avatar:''},{id:1,name:'小晴',avatar:''}],groups:[]});
 api.roomMessages.mockResolvedValue({messages:[{id:12,member_id:0,kind:'wrapup',created:1,status:'done',text:'我們先測試，小晴來做。<script>bad()</script>'}]});
 await pane();
 const card=document.querySelector('.au-room-wrapup')!;
 expect(card.querySelector('h3')).toBeNull();
 expect(card.textContent).toContain('我們先測試，小晴來做。');
 expect(card.textContent).toContain('<script>bad()</script>');
 expect(card.querySelector('script')).toBeNull();
});

test("a member's question waits in the room above its composer, and its row says so",async()=>{
 setLocale('zh-TW');
 const question={id:'q1',task_id:9,member_id:1,prefix:'問',text:'本機指令',tier:'ask',created_at_ms:1,expires_at_ms:2,room_id:1,permission:{id:'q1',source:'background',kind:'local_command',service:'小晴',tool:'local_exec',summary:'Get-Process',reason:'D:/repo',digest:'d',always:false,state:'pending',expires_at_ms:2}};
 api.core.mockImplementation(async(method:string,params:{room_id?:number})=>method==='background.questions.list'?{questions:params.room_id===1?[question]:[]}:{});
 api.roomMessages.mockResolvedValue({messages:[]});
 await pane();await flush();
 const card=document.querySelector('.au-room-pane .ra-dock .ra-bgq .permission-card')!;
 expect(card.textContent).toContain('Get-Process');
 expect(api.core).toHaveBeenCalledWith('background.questions.list',{room_id:1});
 card.querySelector<HTMLButtonElement>('[data-act="local-settings"]')!.click();
 expect(app.go).toHaveBeenCalledWith('settings','safety');
 api.roomsList.mockResolvedValue({rooms:[{...room,waiting:true,preview:'舊的預覽'}]});
 const section=createRoomsSection(()=>true);document.body.append(section);await flush();
 expect(section.querySelector('[data-room="1"] .mb-dot.is-wait')).not.toBeNull();
 expect(section.querySelector('[data-room="1"] .mb-row-p')!.textContent).toBe('等你處理');
});


test("unchanged room reads retain heading faces and lines; unrelated workers read nothing", async () => {
  api.roomMessages.mockResolvedValue({ messages: [{ id: 71, room_id: 1, member_id: 1, text: "A settled reply", created: 1, status: "done" }] });
  const view = await pane(), line = view.el.querySelector(".tn"), face = view.el.querySelector(".au-room-faces .av");
  const input = draft("Unsent draft"); input.focus(); input.setSelectionRange(3, 3);
  await view.refresh();
  expect(view.el.querySelector(".tn")).toBe(line); expect(view.el.querySelector(".au-room-faces .av")).toBe(face);
  expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(3);
  api.roomMessages.mockClear();
  event({ type: "WorkerChanged", task_id: 999, state: "running", running: true }); await flush();
  event({ type: "RoomsChanged", room_id: 2 }); await flush();
  expect(api.roomMessages).not.toHaveBeenCalled(); view.close();
});

test("a new room message retains older slime lines across animation clocks", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  let view: Awaited<ReturnType<typeof pane>> | undefined;
  try {
    const message = { id: 71, room_id: 1, member_id: 1, text: "A settled reply", created: 1, status: "done" };
    api.roomMessages.mockResolvedValue({ messages: [message] }); view = await pane();
    const line = view.el.querySelector('[data-room-message="71"]'), face = line!.querySelector("svg.slime");
    clock.mockReturnValue(3000);
    api.roomMessages.mockResolvedValue({ messages: [message, { ...message, id: 72, text: "A new reply", created: 2 }] });
    await view.refresh();
    expect(view.el.querySelector('[data-room-message="71"]')).toBe(line);
    expect(line!.querySelector("svg.slime")).toBe(face);
    expect(view.el.querySelector('[data-room-message="72"]')?.textContent).toContain("A new reply");
  } finally { clock.mockRestore(); view?.close(); }
});

test("late room delivery retains the next draft saved while switching away", async () => {
 let accept!: (value: unknown) => void;
 api.roomSend.mockImplementationOnce(()=>new Promise(resolve=>{accept=resolve;}));
 const view=await pane();draft('Submitted sample');view.el.querySelector<HTMLFormElement>('form.composer')!.requestSubmit();await flush();
 draft('Next unfinished sample');view.close();
 accept({message_id:1,duplicate:false});await flush();await view.open(1);
 expect(view.el.querySelector<HTMLTextAreaElement>('#room-message')!.value).toBe('Next unfinished sample');view.close();
});

test("empty meetings hide the pinned row and an open board refreshes in place",async()=>{
 const view=await pane();
 const row=view.el.querySelector<HTMLElement>('.room-meeting-row')!;
 expect(row.hidden).toBe(true);
 const task:HandoffView={task_id:42,source_turn_id:5,work_turn_id:6,member_id:1,member_name:'Alice',from_member_id:1,
  stage_id:'Review',mode:'work',state:'running',reason:null,created_at_ms:2,ready_at_ms:2,dispatch_policy:'immediate',result:'',evidence:[]};
 api.roomMessages.mockResolvedValue({messages:[],handoffs:[task],decisions:[]});
 await view.refresh();
 expect(row.hidden).toBe(false);
 const anchor=row.querySelector<HTMLButtonElement>('button')!;
 anchor.click();
 const panel=document.querySelector('#app-popover')!;
 expect(anchor.getAttribute('aria-expanded')).toBe('true');
 api.roomMessages.mockResolvedValue({messages:[],handoffs:[{...task,state:'done'}],decisions:[{id:5,member_id:0,text:'Ship it'}]});
 await view.refresh();
 expect(row.querySelector('button')).toBe(anchor);
 expect(document.querySelector('#app-popover')).toBe(panel);
 expect(panel.querySelector('.card-status.is-done')).not.toBeNull();
 expect(panel.textContent).toContain('Ship it');
 api.roomMessages.mockResolvedValue({messages:[],handoffs:[],decisions:[]});
 await view.refresh();
 expect(row.hidden).toBe(true);
 expect(document.querySelector('#app-popover')).toBeNull();
 view.close();
});
