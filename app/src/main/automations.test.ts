// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppContext, Member, Routine } from "./types";
const api = vi.hoisted(() => ({ homeOverview:vi.fn(), membersList:vi.fn(), routinesList:vi.fn(), routineWebhook:vi.fn(), routineRuns:vi.fn(), routinesRun:vi.fn(), routinesCreate:vi.fn(), routinesUpdate:vi.fn(), routinesDelete:vi.fn(), calendarAdd:vi.fn(), calendarUpdate:vi.fn(), calendarDelete:vi.fn(), keepAwakeGet:vi.fn(), keepAwakeSet:vi.fn(), roomsList:vi.fn(), settingsGet:vi.fn(), modelsCatalog:vi.fn(), brainsCli:vi.fn(), groupsCreate:vi.fn(), groupsUpdate:vi.fn(), groupsDelete:vi.fn(), membersUpdate:vi.fn(), roomsCreate:vi.fn(), roomSend:vi.fn(), roomStop:vi.fn(), roomMessages:vi.fn() }));
vi.mock("./api",()=>api);
import { openRoutineDialog } from "./routine-dialog";
import { occurrences } from "./automation-calendar";
import { createAutomationsPage } from "./pages/automations";
import { dateKey, localDay, monthGrid, shiftDay } from "./schedule-picker";
import { setLocale } from "./i18n";
import { closeMenu } from "./ui";
import { allDayBars, dayLayout, entryOfItem, type CalendarEntry } from "./calendar-view";
import { besidePlacement, closePanel } from "./calendar-popover";
import type { HomeItem } from "./home-types";
const person = (id:number,name:string):Member => ({id,name,role:"Research",instructions:"",avatar:"",group_id:id?1:null,model:"",tools:null,position:id,created:0,unread:false,waiting:false,preview:"",last_at:null});
const members = [person(0,"Raphael"),person(1,"Alice"),person(2,"Bob")];
const plan:Routine = {id:1,member_id:1,title:"Review",prompt:"Check progress",schedule:{kind:"daily",time:"09:00"},enabled:true,last_run:null,next_run:new Date("2026-10-24T09:00").getTime()};
const flush = async ():Promise<void>=>{for(let i=0;i<16;i++)await Promise.resolve();};
const click=(selector:string):void=>{document.querySelector<HTMLElement>(selector)!.click();};
const field=(selector:string,value:string):void=>{document.querySelector<HTMLInputElement>(selector)!.value=value;};
let events: ((e:any)=>void)[];
const app=():AppContext=>({onEvent:(fn:any)=>{events.push(fn);return ()=>{};},go:vi.fn()} as unknown as AppContext);
beforeEach(()=>{
  closePanel(); closeMenu(); document.body.innerHTML="";vi.clearAllMocks();setLocale("en");events=[];localStorage.clear();
  api.calendarAdd.mockResolvedValue({event:{id:9}});api.calendarUpdate.mockResolvedValue({event:{id:9}});api.calendarDelete.mockResolvedValue({deleted:true});
  api.homeOverview.mockResolvedValue({calendar:[]});api.modelsCatalog.mockResolvedValue(null);api.brainsCli.mockResolvedValue({clis:[]});
  api.membersList.mockResolvedValue({members,groups:[{id:1,name:"Work",position:0,sources:[]}]});
  api.routinesList.mockResolvedValue({routines:[plan]});api.routineRuns.mockResolvedValue({runs:[]});
  api.routinesCreate.mockResolvedValue({routine:plan});api.routinesUpdate.mockResolvedValue({routine:plan});api.routinesDelete.mockResolvedValue({deleted:true});
  api.keepAwakeGet.mockResolvedValue(false);api.keepAwakeSet.mockResolvedValue(true);api.roomsList.mockResolvedValue({rooms:[]});api.settingsGet.mockResolvedValue({settings:{agent_model:"openai/shared-model"}});
});

test.each([0, 1, 2])("routine history and test results use relative days and minutes (%s days ago)", async days => {
  setLocale("zh-TW");
  const now = new Date(2026, 10, 5, 12).getTime();
  const started = new Date(2026, 10, 5 - days, 8, 0, 37).getTime();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const label = ["今天", "昨天", "11 月 3 日"][days];
  const routine = { ...plan, id: 1001 + days };
  api.routineRuns.mockResolvedValue({runs:[{id:501,routine_id:routine.id,started,finished:started+1000,status:"done",summary:"Completed",cost:0,turn_id:12}]});
  api.routinesRun.mockResolvedValue({run_id:501});
  try {
    const dialog = openRoutineDialog({members, routine});
    await flush();
    expect(document.querySelector('[data-run-status="done"]')?.textContent).toBe(`成功 · ${label} 08:00Completed`);
    click('[data-dlg="test"]');
    await flush();
    expect(document.querySelector('.au-test-status')?.textContent).toBe(`成功 · ${label} 08:00 · Completed`);
    expect(document.querySelector('.au-run-section')?.textContent).not.toContain("08:00:37");
    dialog.close();
  } finally { clock.mockRestore(); }
});

test("monthly and minute choices save through the existing routine dialog", async () => {
  openRoutineDialog({members, routine: plan});
  click('[data-dlg="kind"][data-kind="monthly"]');
  field('#au-month-day', '31'); click('[data-dlg="save"]'); await flush();
  expect(api.routinesUpdate).toHaveBeenCalledWith(1, expect.objectContaining({schedule:expect.objectContaining({kind:'monthly',day:31})}));
  openRoutineDialog({members, routine: plan});
  click('[data-dlg="kind"][data-kind="every"]'); click('[data-dlg="hours"]');
  click('#app-popover [data-value="m30"]'); click('[data-dlg="save"]'); await flush();
  expect(api.routinesUpdate).toHaveBeenLastCalledWith(1, expect.objectContaining({schedule:expect.objectContaining({kind:'every',minutes:30})}));
  expect(api.routinesUpdate.mock.lastCall?.[1].schedule).not.toHaveProperty('hours');
});

test("monthly dates clamp in the calendar and minutes remain one rhythm", () => {
  const monthly = {...plan, next_run:new Date('2026-01-31T09:00').getTime(), schedule:{kind:'monthly',day:31,time:'09:00'}} as Routine;
  const rows = occurrences(monthly, localDay('2026-02-01'), localDay('2026-04-01'));
  expect(rows.map(row=>dateKey(new Date(row.at)))).toEqual(['2026-02-28','2026-03-31']);
});

test("webhook choice saves without exposing technical event fields", async () => {
  openRoutineDialog({members, routine:plan});
  click('[data-dlg="trigger"]'); click('#app-popover [data-value="webhook"]');
  expect(document.querySelector('.au-routine-dialog')!.textContent).toContain('this PC');
  click('[data-dlg="save"]'); await flush();
  expect(api.routinesUpdate).toHaveBeenCalledWith(1, expect.objectContaining({when:{webhook:true}}));
});

test("webhook details share the masked secret field and reveal only on request", async () => {
  api.routineWebhook.mockImplementation(async (_id:number,reveal:boolean)=>({address:'http://127.0.0.1:43210/routines/1',...(reveal?{secret:'sample-secret'}:{})}));
  openRoutineDialog({members,routine:{...plan,schedule:null,when:{webhook:true}}}); await flush();
  expect(document.querySelector('.field.sc-field .au-hook-secret')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('.au-hook-secret')?.type).toBe('password');
  expect(api.routineWebhook).toHaveBeenCalledWith(1,false);
  expect(document.body.innerHTML).not.toContain('sample-secret');
  click('[data-dlg="hook-show"]'); await flush();
  expect(api.routineWebhook).toHaveBeenLastCalledWith(1,true);
  expect(document.querySelector<HTMLInputElement>('.au-hook-secret')?.value).toBe('sample-secret');
  click('[data-dlg="hook-show"]');
  expect(document.querySelector<HTMLInputElement>('.au-hook-secret')?.type).toBe('password');
  expect(document.body.innerHTML).not.toContain('sample-secret');
});

test("copying a webhook secret keeps the unchanged form and its mask", async () => {
  const copied = vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue();
  api.routineWebhook.mockImplementation(async (_id:number,reveal:boolean)=>({address:'http://127.0.0.1:43210/routines/1',...(reveal?{secret:'sample-secret'}:{})}));
  openRoutineDialog({members,routine:{...plan,schedule:null,when:{webhook:true}}}); await flush();
  const input = document.querySelector('.au-hook-secret');
  click('[data-dlg="hook-copy"]'); await flush();
  expect(copied).toHaveBeenCalledWith('sample-secret');
  expect(document.querySelector('.au-hook-secret')).toBe(input);
  expect(document.querySelector<HTMLInputElement>('.au-hook-secret')?.type).toBe('password');
  expect(document.body.innerHTML).not.toContain('sample-secret');
  copied.mockRestore();
});

test("copying a webhook secret keeps its feedback when the address changes", async () => {
  const copied = vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue();
  api.routineWebhook.mockResolvedValueOnce({address:'http://127.0.0.1:43210/routines/1'});
  openRoutineDialog({members,routine:{...plan,schedule:null,when:{webhook:true}}}); await flush();
  let complete!: (value: unknown) => void;
  api.routineWebhook.mockImplementationOnce(() => new Promise(resolve => { complete=resolve; }));
  const button=document.querySelector<HTMLButtonElement>('[data-dlg="hook-copy"]')!;
  button.click();
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  complete({address:'http://127.0.0.1:43211/routines/1',address_changed:true,secret:'sample-secret'}); await flush();
  expect(document.querySelector('.au-hook-address')?.textContent).toContain(':43211/');
  expect(document.querySelector('.au-webhook [role="status"]')?.textContent).toBeTruthy();
  expect(document.querySelector('[data-dlg="hook-copy"]')).toBe(button);
  expect(button.getAttribute('aria-label')).toBe('Copied');
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute('aria-busy')).toBe(false);
  expect(document.querySelector<HTMLInputElement>('.au-hook-secret')?.type).toBe('password');
  copied.mockRestore();
});

test("event choices explain the empty verified catalogue", async () => {
  openRoutineDialog({members, routine:plan});
  click('[data-dlg="trigger"]'); click('#app-popover [data-value="event"]'); await flush();
  expect(document.querySelector('.au-routine-dialog')!.textContent).toContain('verified events');
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled).toBe(true);
});

const mailChoice = {id:"gmail-mail",toolkit:"gmail",slug:"GMAIL_FETCH_EMAILS",input:"",label:"New mail",app:"composio:gmail",app_name:"Gmail"};
const detectedMail = {app:"composio:gmail",event:{tool:"mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL",arguments:{tools:[{tool_slug:"GMAIL_FETCH_EMAILS",arguments:{max_results:20,include_payload:false,verbose:false}}]},items:"data.results.0.response.data.messages",id:"messageId"},filter:{field:"",equals:""}};
const calendarChoice = {...mailChoice,id:"calendar-event",toolkit:"googlecalendar",slug:"GOOGLECALENDAR_EVENTS_LIST",label:"New event",app:"composio:googlecalendar",app_name:"Google Calendar"};
const detectedCalendar = {app:calendarChoice.app,event:{tool:detectedMail.event.tool,arguments:{tools:[{tool_slug:calendarChoice.slug,arguments:{calendarId:"primary",maxResults:50,singleEvents:true,orderBy:"updated"}}]},items:"data.results.0.response.data.items",id:"id",since:{arg:"updatedMin",format:"iso"}},filter:{field:"",equals:""}};

test.each([{choice:mailChoice,condition:detectedMail},{choice:calendarChoice,condition:detectedCalendar}])("picking $choice.toolkit reads once and saves the detected ordinary when", async ({choice,condition}) => {
  api.routinesList.mockImplementation(async (_member:number, pick?:unknown)=>({routines:[],events:[choice],event_apps:[choice.app_name],...(pick?{when:condition}:{})}));
  openRoutineDialog({members,routine:plan});
  click('[data-dlg="trigger"]'); click('#app-popover [data-value="event"]'); await flush();
  click('[data-dlg="event"]'); click(`#app-popover [data-value="${choice.id}"]`); await flush();
  expect(api.routinesList).toHaveBeenLastCalledWith(plan.member_id,{event:choice.id,value:""});
  expect(document.querySelector('[data-dlg="event"]')?.textContent).toContain(choice.label);
  expect(document.querySelector('.au-routine-dialog')!.textContent).not.toContain("data.results");
  click('[data-dlg="save"]'); await flush();
  expect(api.routinesUpdate).toHaveBeenCalledWith(1,expect.objectContaining({when:condition}));
  expect(api.routinesList).toHaveBeenCalledTimes(2);
});

test("undetectable events keep their choice and retry without creating a routine", async () => {
  api.routinesList.mockImplementation(async (_member:number,pick?:unknown)=>({routines:[],events:[mailChoice],event_apps:["Gmail"],...(pick?{event_error:"No Gmail items are available yet. Try again after an item arrives."}:{})}));
  openRoutineDialog({members,routine:plan});
  click('[data-dlg="trigger"]'); click('#app-popover [data-value="event"]'); await flush();
  click('[data-dlg="event"]'); click('#app-popover [data-value="gmail-mail"]'); await flush();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("No Gmail items");
  expect(document.querySelector('[data-dlg="event"]')?.textContent).toContain("New mail");
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled).toBe(true);
  click('[data-dlg="event-check"]'); await flush();
  expect(api.routinesList).toHaveBeenCalledTimes(3);
  expect(api.routinesCreate).not.toHaveBeenCalled();
  expect(api.routinesUpdate).not.toHaveBeenCalled();
});

test("repository is a plain field and edits invalidate the previous detection", async () => {
  const choice={...mailChoice,id:"github-failure",toolkit:"github",app:"composio:github",app_name:"GitHub",label:"Workflow failed",input:"repository"};
  api.routinesList.mockImplementation(async (_member:number,pick?:unknown)=>({routines:[],events:[choice],event_apps:["GitHub"],...(pick?{when:detectedMail}:{})}));
  openRoutineDialog({members,routine:plan});
  click('[data-dlg="trigger"]'); click('#app-popover [data-value="event"]'); await flush();
  click('[data-dlg="event"]'); click('#app-popover [data-value="github-failure"]'); await flush();
  expect(document.querySelector('#au-event-value')?.hasAttribute('pattern')).toBe(false);
  field('#au-event-value','team name/repo.name'); click('[data-dlg="event-check"]'); await flush();
  expect(api.routinesList).toHaveBeenLastCalledWith(plan.member_id,{event:"github-failure",value:"team name/repo.name"});
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled).toBe(false);
  field('#au-event-value','other/repo');
  document.querySelector('#au-event-value')!.dispatchEvent(new Event('input',{bubbles:true}));
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled).toBe(true);
});

test("a webhook replacement address has a visible update notice", async () => {
  api.routineWebhook.mockResolvedValue({address:'http://127.0.0.1:43211/routines/1',address_changed:true});
  openRoutineDialog({members,routine:{...plan,schedule:null,when:{webhook:true}}}); await flush();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("address changed");
  expect(document.querySelector('.au-hook-address')?.textContent).toContain('43211');
});

test("editing the scope during a read leaves a usable check button and ignores the late reply", async () => {
  const choice={...mailChoice,id:"github-failure",input:"repository"};
  let reply!:(value:unknown)=>void;
  api.routinesList.mockImplementation((_member:number,pick?:unknown)=>pick ? new Promise(resolve=>{reply=resolve;}) : Promise.resolve({routines:[],events:[choice],event_apps:["Gmail"]}));
  openRoutineDialog({members,routine:plan});
  click('[data-dlg="trigger"]'); click('#app-popover [data-value="event"]'); await flush();
  click('[data-dlg="event"]'); click('#app-popover [data-value="github-failure"]');
  field('#au-event-value','sample/first'); click('[data-dlg="event-check"]');
  field('#au-event-value','sample/second');
  document.querySelector('#au-event-value')!.dispatchEvent(new Event('input',{bubbles:true}));
  reply({when:detectedMail}); await flush();
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="event-check"]')!.disabled).toBe(false);
  expect(document.querySelector('[data-dlg="event-check"]')!.textContent).toBe('Check event');
});

test("one every routine saves and reopens its daytime window through real controls", async () => {
  openRoutineDialog({members, routine: {...plan, schedule: {kind:"every", hours:3, from:"08:00", to:"23:00"}}});
  expect(document.querySelector('[data-dlg="window-from"]')?.textContent).toContain("08:00");
  expect(document.querySelector<HTMLInputElement>('#au-time')?.value).toBe("08:00");
  expect(document.querySelector<HTMLInputElement>('#au-time')?.disabled).toBe(true);
  click('[data-dlg="window-from"]'); click('#app-popover [data-value="07:00"]');
  click('[data-dlg="save"]'); await flush();
  expect(api.routinesUpdate).toHaveBeenCalledWith(1, expect.objectContaining({schedule:expect.objectContaining({kind:"every",hours:3,from:"07:00",to:"23:00"})}));
});

test.each(["day","month"])("the chosen %s view survives a fresh page but its date starts today", async view => {
  const page=createAutomationsPage(app());document.body.append(page.el);page.show("2026-10-24");await flush();
  click('[data-au="view"]');click(`#app-popover [data-value="${view}"]`);click('[data-au="next"]');
  const before=page.el.querySelector('.au-toolbar h1')!.textContent;
  page.hide();page.show();await flush();
  expect(page.el.querySelector('.au-toolbar h1')!.textContent).toBe(before);
  expect(localStorage.getItem('raphael.calendar.view')).toBe(view);
  page.hide();page.el.remove();
  const fresh=createAutomationsPage(app());document.body.append(fresh.el);fresh.show();await flush();
  expect(!!fresh.el.querySelector('.au-month-view')).toBe(view==='month');
  expect(fresh.el.querySelector('[aria-current="date"]')).not.toBeNull();
  fresh.hide();
});

test.each([null,"invalid"])("an empty or invalid stored view %s defaults to week", async stored => {
  if(stored) localStorage.setItem('raphael.calendar.view',stored);
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
  expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(7);page.hide();
});

test("unavailable browser storage still allows choosing and returning to a view", async () => {
  const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Unavailable');});
  const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Unavailable');});
  const page=createAutomationsPage(app());document.body.append(page.el);
  try {
    page.show();await flush();expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(7);
    click('[data-au="view"]');click('#app-popover [data-value="month"]');page.hide();page.show();await flush();
    expect(page.el.querySelector('.au-month-view')).not.toBeNull();
  } finally {page.hide();page.el.remove();read.mockRestore();write.mockRestore();}
});

test.each([761,844,624,720,1644,480])("week columns fit %i px of app content", async width => {
  const page=createAutomationsPage(app());Object.defineProperty(page.el,'clientWidth',{get:()=>width});
  document.body.append(page.el);page.show('calendar-week:2026-10-24');await flush();
  expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(width<520?3:7);
  if(width<520) expect(page.el.querySelector('.au-toolbar h1')!.textContent).toContain('24');
  page.hide();
});

test("today shares an ordered quiet group with the arrows and is disabled when the view holds today", async () => {
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
  expect([...page.el.querySelectorAll('.au-date-nav button')].map(button=>(button as HTMLElement).dataset.au)).toEqual(['prev','today','next']);
  expect(page.el.querySelector<HTMLButtonElement>('[data-au="today"]')!.disabled).toBe(true);
  click('[data-au="next"]');expect(page.el.querySelector<HTMLButtonElement>('[data-au="today"]')!.disabled).toBe(false);
  click('[data-au="today"]');expect(page.el.querySelector<HTMLButtonElement>('[data-au="today"]')!.disabled).toBe(true);
  page.hide();
});

test.each(["calendar-day", "calendar-month"])("%s keeps exceptions legible and month rhythms concise", async view => {
  api.routinesList.mockResolvedValue({routines:[{...plan,schedule:{kind:"every",hours:3,from:"08:00",to:"23:00"}}]});
  api.routineRuns.mockResolvedValue({runs:["error","confirm"].map((status,i)=>({id:i+1,routine_id:1,started:new Date(`2026-10-24T${i?"14":"11"}:00`).getTime(),finished:null,status,turn_id:i+1,summary:"",cost:0}))});
  const page=createAutomationsPage(app());document.body.append(page.el);page.show("2026-10-24");await flush();
  if(view==="calendar-month"){click('[data-au="view"]');click('#app-popover [data-value="month"]');await flush();}
  const exceptions=[...page.el.querySelectorAll('.cal-chip .cal-run-mark')];
  expect(exceptions).toHaveLength(2);
  expect(exceptions.every(mark=>!mark.closest('.cal-chip')!.classList.contains('is-past'))).toBe(true);
  const bar=page.el.querySelector('.is-rhythm')!;
  if(view==="calendar-month") {
    expect(bar.querySelector('small, time')).toBeNull();
    expect(bar.querySelector('.av')).not.toBeNull();
  } else expect(bar.textContent).toContain("Every 3 hours");
  expect(bar.textContent!.includes("08:00")).toBe(view!=="calendar-month");
  page.hide();
});

test("window occurrences restart at the first time each local day", () => {
  const from=localDay("2026-10-24");
  const routine={...plan,next_run:new Date("2026-10-24T08:00").getTime(),schedule:{kind:"every" as const,hours:3,from:"08:00",to:"23:00"}};
  expect(occurrences(routine,from,shiftDay(from,2)).map(o=>new Date(o.at).getHours())).toEqual([8,11,14,17,20,23,8,11,14,17,20,23]);
  expect(occurrences(routine,shiftDay(from,1),shiftDay(from,2),7).map(o=>new Date(o.at).getHours())).toEqual([8]);
});

test("routine editor saves the chosen weekdays, owner, date and end count",async()=>{
  openRoutineDialog({members,memberId:2,date:"2030-10-24",time:"09:00"});
  field("#au-title","Morning report");field("#au-prompt","Read progress");
  click('[data-kind="weekly"]');click('[data-day="1"]');click('[data-day="3"]');click('[data-dlg="more"]');click('[data-dlg="end"]');click('#app-popover [data-value="after"]');field("#au-count","5");
  expect(document.querySelector<HTMLInputElement>("#au-title")!.value).toBe("Morning report");
  click('[data-dlg="save"]');await flush();
  expect(api.routinesCreate).toHaveBeenCalledWith(expect.objectContaining({member_id:2,title:"Morning report",prompt:"Read progress",schedule:expect.objectContaining({kind:"weekly",max_runs:5,start_date:"2030-10-24",time:"09:00"})}));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("routine editing preserves an until date and never changes the member",async()=>{
  openRoutineDialog({members,routine:{...plan,schedule:{kind:"weekdays",time:"08:30",start_date:"2030-01-01",until:"2030-12-31"}}});
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="member"]')!.disabled).toBe(true);
  click('[data-dlg="save"]');await flush();
  expect(api.routinesUpdate).toHaveBeenCalledWith(1,expect.objectContaining({schedule:{kind:"weekdays",time:"08:30",start_date:"2030-01-01",until:"2030-12-31",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}}));
});

test.each(["25:00","09:61","oops"])("routine editor refuses invalid time %s",async time=>{
  openRoutineDialog({members,date:"2030-10-24",time});field("#au-title","Review");field("#au-prompt","Check");click('[data-dlg="save"]');await flush();expect(api.routinesCreate).not.toHaveBeenCalled();
});

test("date picker has real day buttons and leaves the form draft intact",()=>{
  openRoutineDialog({members,date:"2030-10-24",time:"09:00"});field("#au-title","Draft");click('[data-dlg="date"]');click('[data-date="2030-10-25"]');expect(document.querySelector<HTMLInputElement>("#au-title")!.value).toBe("Draft");expect(document.querySelector('[data-dlg="date"]')!.textContent).toBe("2030-10-25");
});

test("Escape closes a menu first and the editor second",()=>{
  openRoutineDialog({members,date:"2030-10-24"});click('[data-dlg="more"]');click('[data-dlg="end"]');document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));expect(document.querySelector('.au-routine-dialog')).not.toBeNull();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));expect(document.querySelector('.au-routine-dialog')).toBeNull();
});

test("the calendar opens directly, without a list, and the keep-awake switch persists",async()=>{
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
  expect(page.el.querySelector('[data-view]')).toBeNull();
  expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(7);
  expect(page.el.querySelector('.au-calendar > .au-calendar-side + .au-calendar-main > .au-calendar-scroll')).not.toBeNull();
  click('[data-au="awake"]');await flush();expect(api.keepAwakeSet).toHaveBeenCalledWith(true);expect(page.el.querySelector('[data-au="awake"]')!.getAttribute("aria-checked")).toBe("true");
  page.hide();
});

test("Home opens the full calendar on the selected date and preserves monthly connected events",async()=>{
  api.homeOverview.mockResolvedValue({calendar:[],calendar_events:[{kind:"event",at_ms:new Date("2026-11-03T10:00").getTime(),title:"Month event"}]});
  const page=createAutomationsPage(app());document.body.append(page.el);page.show("2026-11-03");await flush();
  expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(1);
  expect(page.el.querySelector('[data-day="2026-11-03"]')).not.toBeNull();
  expect(page.el.querySelector('.au-calendar-event')?.textContent).toContain("Month event");
  page.hide();
});

test("a Home event opens its exact day and highlights the corresponding Calendar event",async()=>{
  api.homeOverview.mockResolvedValue({calendar:[],calendar_events:[{id:"event:review",kind:"event",at_ms:new Date("2026-11-03T10:00").getTime(),title:"Review"}]});
  const page=createAutomationsPage(app());document.body.append(page.el);page.show("calendar:2026-11-03:event%3Areview");await flush();
  expect(page.el.querySelector('[data-day="2026-11-03"]')).not.toBeNull();
  expect(page.el.querySelector('.au-calendar-event.is-home-focus')?.getAttribute('data-calendar-item')).toBe('event:review');
  page.hide();
});

test("live routine notifications refresh the list, and hide invalidates pending responses",async()=>{
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();api.routinesList.mockResolvedValue({routines:[{...plan,title:"Changed"}]});events.forEach(fn=>fn({type:"RoutinesChanged",member_id:1}));await flush();expect(page.el.textContent).toContain("Changed");page.hide();
});

test.each(["AgentTurn","AgentQuestion","AgentQuestionClosed"])("%s refreshes the calendar's real run statuses", async type => {
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
  api.routineRuns.mockClear();events.forEach(fn=>fn({type,member_id:1,status:"confirm"}));await flush();
  expect(api.routineRuns).toHaveBeenCalled();page.hide();
});

test("calendar tools retain month navigation and awake state, close on date selection and hide",async()=>{
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
  click('[data-au="tools"]');
  const month=document.querySelector('.au-calendar-tools .au-month-head b')!.textContent;
  click('.au-calendar-tools [data-au="month-next"]');
  expect(document.querySelector('.au-calendar-tools .au-month-head b')!.textContent).not.toBe(month);
  click('.au-calendar-tools [data-au="awake"]');await flush();
  expect(api.keepAwakeSet).toHaveBeenCalledWith(true);
  expect(document.querySelector('.au-calendar-tools [data-au="awake"]')!.getAttribute('aria-checked')).toBe('true');
  const key=document.querySelector<HTMLElement>('.au-calendar-tools [data-mini-date]')!.dataset.miniDate!;
  click('.au-calendar-tools [data-mini-date]');
  expect(document.querySelector('.au-calendar-tools')).toBeNull();
  expect(page.el.querySelector(`[data-day="${key}"]`)).not.toBeNull();
  click('[data-au="tools"]');page.hide();expect(document.querySelector('.au-calendar-tools')).toBeNull();
});

test("dragging a member from calendar tools supplies the member and dismisses the popover",async()=>{
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();click('[data-au="tools"]');
  const transfer={setData:vi.fn()},event=new Event('dragstart',{bubbles:true});Object.defineProperty(event,'dataTransfer',{value:transfer});
  document.querySelector('.au-calendar-tools [data-drag-member="2"]')!.dispatchEvent(event);
  expect(transfer.setData).toHaveBeenCalledWith('application/x-raphael-member','2');
  expect(document.querySelector('.au-calendar-tools')).toBeNull();page.hide();
});

test("mini month uses single Chinese weekday characters and retains full weekday tooltips",()=>{
  setLocale('zh-TW');const host=document.createElement('div');host.innerHTML=monthGrid(localDay('2026-10-24'),'2026-10-24','data-mini-date');
  const weekdays=[...host.querySelectorAll('.au-month-grid > span')];
  expect(weekdays.map(day=>day.textContent)).toEqual(['一','二','三','四','五','六','日']);
  expect(weekdays[0].getAttribute('title')).toBe('週一');
});

test("calendar switches between day and week and mini dates navigate",async()=>{
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(7);click('[data-au="view"]');click('#app-popover [data-value="day"]');expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(1);click('[data-mini-date]');expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(1);page.hide();
});

test("calendar chips keep complete compact times and full task details when edited",async()=>{
  const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
  const chip=page.el.querySelector<HTMLButtonElement>('.au-occurrence')!;
  expect(chip.querySelector('time')?.textContent).toBe("09:00");
  expect(chip.title).toContain("Review");expect(chip.title).toContain("09:00");
  expect(chip.getAttribute("aria-label")).toContain("Alice");
  chip.click();click('[data-pop="open-routine"]');expect(document.querySelector<HTMLInputElement>("#au-title")!.value).toBe("Review");
  expect(document.querySelector<HTMLInputElement>("#au-time")!.value).toBe("09:00");page.hide();
});


test("interval phases and remaining run limits survive calendar boundaries",()=>{
 const routine={...plan,schedule:{kind:"every" as const,hours:3}};const from=localDay("2026-10-24");expect(occurrences(routine,from,shiftDay(from,1),2).map(o=>new Date(o.at).getHours())).toEqual([9,12]);expect(occurrences({...routine,next_run:null},from,shiftDay(from,1))).toEqual([]);expect(dateKey(shiftDay(localDay("2026-12-31"),1))).toBe("2027-01-01");
});

test("calendar accepts member drops with date and hour but ignores unrelated drags",async()=>{
 const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
 const slot=page.el.querySelector<HTMLElement>('[data-slot][data-hour="9"]')!;
 const drop=(value:string):void=>{const event=new Event("drop",{bubbles:true,cancelable:true});Object.defineProperty(event,"dataTransfer",{value:{getData:()=>value}});slot.dispatchEvent(event);};
 drop("");expect(document.querySelector('.au-routine-dialog')).toBeNull();drop("2");
 expect(document.querySelector('[data-dlg="member"][aria-pressed="true"]')!.textContent).toContain("Bob");expect(document.querySelector('[data-dlg="date"]')!.textContent).toBe(slot.dataset.slot);expect(document.querySelector<HTMLInputElement>('#au-time')!.value).toBe("09:00");page.hide();
});

test("future calendar windows account for occurrences before the visible range",()=>{
 const from=localDay("2026-10-26"),to=localDay("2026-11-02");
 expect(occurrences(plan,from,to,2)).toEqual([]);
 expect(occurrences({...plan,schedule:{kind:"every",hours:3}},from,to,4)).toEqual([]);
 expect(occurrences({...plan,schedule:{kind:"weekdays",time:"09:00"}},from,to,2)).toHaveLength(2);
});




test("status summaries have one separator and history appears in past calendar days",async()=>{
 const at=new Date();at.setHours(9,0,0,0);at.setDate(at.getDate()-2);
 api.routineRuns.mockResolvedValue({runs:[{id:5,routine_id:1,scheduled:at.getTime(),started:at.getTime()+120000,finished:at.getTime()+180000,status:"done",summary:"Completed。．.",cost:0,turn_id:12}]});
 const page=createAutomationsPage(app());document.body.append(page.el);page.show();await flush();
 click('[data-mini-date="'+dateKey(at)+'"]');click('[data-au="view"]');click('#app-popover [data-value="day"]');
 expect(page.el.querySelector('[data-run="5"]')).not.toBeNull();page.hide();
});

const at=(hour:number,minute=0,day=24):number=>new Date(2026,9,day,hour,minute).getTime();
const entry=(id:string,start:number,end:number,more:Partial<CalendarEntry>={}):CalendarEntry=>({id,kind:"own",title:id,start,end,allDay:false,source:"own",...more});
const own=(id:number,title:string,start:number,end:number,more:Partial<HomeItem>={}):HomeItem=>({id:`own:${id}`,kind:"own",event_id:id,title,summary:"",at_ms:start,end_ms:end,member_id:-1,name:"",avatar:"",turn_id:null,conversation_id:null,routine_id:null,all_day:false,notes:"",added_by:null,...more});
const google=(id:string,title:string,start:number,end:number):HomeItem=>({...own(0,title,start,end),id:`event:${id}`,kind:"event",event_id:undefined,member_id:0,name:"Google Calendar",added_by:undefined});

test("events that overlap stand side by side, and a group of overlaps shares its width",()=>{
 const parts=dayLayout([entry("a",at(9),at(10,30)),entry("b",at(9,30),at(10)),entry("c",at(10),at(11)),entry("d",at(14),at(15))],localDay("2026-10-24"));
 const of=(id:string)=>parts.find(part=>part.entry.id===id)!;
 expect([of("a").lane,of("b").lane,of("c").lane]).toEqual([0,1,1]);
 expect([of("a").lanes,of("b").lanes,of("c").lanes]).toEqual([2,2,2]);
 expect(of("d")).toMatchObject({lane:0,lanes:1});
});

test("two short events that would touch on screen stand apart, and one past midnight is on both days",()=>{
 const parts=dayLayout([entry("a",at(12),at(12,10)),entry("b",at(12,15),at(12,25))],localDay("2026-10-24"));
 expect(parts.map(part=>part.lanes)).toEqual([2,2]);
 const night=entry("n",at(22),at(2,0,25));
 expect(dayLayout([night],localDay("2026-10-24"))[0]).toMatchObject({start:at(22),end:at(0,0,25)});
 expect(dayLayout([night],localDay("2026-10-25"))[0]).toMatchObject({start:at(0,0,25),end:at(2,0,25)});
 expect(dayLayout([entry("day",at(9),at(10,0,25))],localDay("2026-10-24"))).toEqual([]);
});

test("all-day events are bars across their days, in rows, and what does not fit is counted per day",()=>{
 const days=Array.from({length:7},(_,n)=>shiftDay(localDay("2026-10-19"),n));
 const allDay=(id:string,from:number,to:number)=>entry(id,at(0,0,from),at(0,0,to+1),{allDay:true});
 const {bars,more,used}=allDayBars([allDay("trip",19,21),allDay("a",20,20),allDay("b",20,20),allDay("c",20,20),allDay("next",24,28)],days);
 const of=(id:string)=>bars.find(bar=>bar.entry.id===id)!;
 expect(of("trip")).toMatchObject({column:0,span:3,row:0,startsBefore:false,endsAfter:false});
 expect(of("next")).toMatchObject({column:5,span:2,row:0,endsAfter:true});
 expect(used).toBe(3);
 expect(more).toEqual([0,1,0,0,0,0,0]);
});

test("a panel stands beside what it is about and inside the window",()=>{
 const viewport={width:1120,height:800,top:32};
 expect(besidePlacement({left:300,right:380,top:200},{width:344,height:300},viewport)).toEqual({left:388,top:200});
 expect(besidePlacement({left:800,right:900,top:200},{width:344,height:300},viewport)).toEqual({left:448,top:200});
 expect(besidePlacement({left:300,right:380,top:700},{width:344,height:300},viewport).top).toBe(492);
 expect(besidePlacement({left:10,right:700,top:5},{width:344,height:300},{...viewport,width:720})).toEqual({left:368,top:40});
});

test("an own event keeps who added it and is one entry from its item",()=>{
 const item=own(4,"Dentist",at(14),at(15),{added_by:2,name:"Bob",member_id:2,notes:"Bring card"});
 expect(entryOfItem(item)).toMatchObject({id:"own:4",kind:"own",eventId:4,notes:"Bring card",member:{id:2,name:"Bob"},source:"own"});
 expect(entryOfItem(own(5,"Mine",at(14),at(15))).member).toBeUndefined();
 expect(entryOfItem(google("g","Out",at(9),at(10)))).toMatchObject({kind:"event",source:"google"});
});

test("a truly narrow week names its days and returns to seven columns with enough room",async()=>{
 const page=createAutomationsPage(app());document.body.append(page.el);
 let width=480;vi.spyOn(page.el,"clientWidth","get").mockImplementation(()=>width);
 page.show("calendar-week:2026-10-24");await flush();
 expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(3);
 expect(page.el.querySelector('.au-day-col')?.getAttribute('data-day')).toBe("2026-10-24");
 width=844;page.show();await flush();expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(7);
 width=1600;page.show();await flush();expect(page.el.querySelectorAll('.au-day-col')).toHaveLength(7);
 page.hide();
});

describe("the calendar's own events",()=>{
 const open=async(items:HomeItem[],arg?:string,state="connected"):Promise<ReturnType<typeof createAutomationsPage>>=>{
  api.homeOverview.mockResolvedValue({calendar:[],calendar_events:items,calendar_google:state});
  const page=createAutomationsPage(app());document.body.append(page.el);page.show(arg as never);await flush();return page;
 };
 test("建立 opens the small form and saving sends what was typed, as an instant, and draws what the core then has",async()=>{
  const page=await open([],"calendar-week:2026-10-24");
  click('[data-au="new"]');
  const panel=document.querySelector('.au-pop-editor');expect(panel).not.toBeNull();
  expect(document.querySelector('.mb-scrim')).toBeNull();
  expect(page.el.querySelector('.au-draft')).not.toBeNull();
  const title=document.querySelector<HTMLInputElement>('#cal-title')!;title.value="Dentist";title.dispatchEvent(new Event("input",{bubbles:true}));
  expect(page.el.querySelector('.au-draft b')!.textContent).toBe("Dentist");
  api.homeOverview.mockResolvedValue({calendar:[],calendar_events:[own(9,"Dentist",at(9),at(10))],calendar_google:"connected"});
  click('.au-pop-editor [data-pop="save"]');await flush();
  expect(api.calendarAdd).toHaveBeenCalledWith(expect.objectContaining({title:"Dentist",all_day:false,start:expect.stringMatching(/Z$/),end:expect.stringMatching(/Z$/)}));
  expect(document.querySelector('.au-pop-editor')).toBeNull();
  expect(page.el.querySelector('.au-draft')).toBeNull();
  expect(page.el.querySelector('.cal-chip.is-own b')!.textContent).toBe("Dentist");
  page.hide();
 });
 test("no title, no event; and an all-day event sends dates",async()=>{
  const page=await open([],"calendar-week:2026-10-24");
  click('[data-au="new"]');click('.au-pop-editor [data-pop="save"]');await flush();
  expect(api.calendarAdd).not.toHaveBeenCalled();
  field('#cal-title',"Holiday");document.querySelector('#cal-title')!.dispatchEvent(new Event("input",{bubbles:true}));click('[data-pop="all-day"]');
  expect(document.querySelector('.au-pop-editor [data-pop="start-time"]')).toBeNull();
  click('.au-pop-editor [data-pop="save"]');await flush();
  expect(api.calendarAdd).toHaveBeenCalledWith(expect.objectContaining({title:"Holiday",all_day:true,start:"2026-10-24",end:"2026-10-24"}));
  page.hide();
 });
 test("a press outside closes a form with nothing typed and leaves one that holds words",async()=>{
  const page=await open([],"calendar-week:2026-10-24");
  click('[data-au="new"]');field('#cal-title',"Half typed");document.querySelector('#cal-title')!.dispatchEvent(new Event("input",{bubbles:true}));
  page.el.click();await flush();
  expect(document.querySelector('.au-pop-editor')).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  expect(document.querySelector('.au-pop-editor')).toBeNull();
  page.hide();
 });
 test("an own event shows its time, notes and who added it, with edit, and delete only in its ⋯, asking once more",async()=>{
  const page=await open([own(4,"Dentist",at(14),at(15),{notes:"Bring card",added_by:2,name:"Bob",member_id:2})],"calendar-week:2026-10-24");
  click('[data-entry="own:4"][data-au="entry"]');
  const panel=document.querySelector('.au-pop-detail')!;
  expect(panel.textContent).toContain("14:00 – 15:00");expect(panel.textContent).toContain("Bring card");expect(panel.textContent).toContain("Added by Bob");
  expect([...panel.querySelectorAll('button')].filter(button=>/delete/i.test(button.textContent??""))).toEqual([]);
  click('.au-pop-detail [data-pop="more"]');
  click('#app-popover [data-confirm-item]');expect(api.calendarDelete).not.toHaveBeenCalled();
  click('#app-popover [data-confirm-item]');await flush();
  expect(api.calendarDelete).toHaveBeenCalledWith(4);
  expect(document.querySelector('.au-pop-detail')).toBeNull();
  expect(page.el.querySelector('[data-entry="own:4"]')).toBeNull();
  page.hide();
 });
 test("edit changes that event, keeping its id",async()=>{
  const page=await open([own(4,"Dentist",at(14),at(15))],"calendar-week:2026-10-24");
  click('[data-entry="own:4"][data-au="entry"]');click('[data-pop="edit"]');
  expect(document.querySelector<HTMLInputElement>('#cal-title')!.value).toBe("Dentist");
  field('#cal-title',"Orthodontist");click('.au-pop-editor [data-pop="save"]');await flush();
  expect(api.calendarUpdate).toHaveBeenCalledWith(4,expect.objectContaining({title:"Orthodontist"}));
  expect(api.calendarAdd).not.toHaveBeenCalled();
  page.hide();
 });
 test("a right click reaches the same ⋯ through its row, and only an own event has one",async()=>{
  const {overflowAt}=await import("./context-menu");
  const page=await open([own(4,"Dentist",at(14),at(15)),google("g","Outside",at(16),at(17))],"calendar-week:2026-10-24");
  expect(overflowAt(page.el.querySelector('[data-au="entry"][data-entry="own:4"]'))?.button.dataset.au).toBe("event-more");
  expect(overflowAt(page.el.querySelector('[data-au="entry"][data-entry="event:g"]'))).toBeNull();
  page.hide();
 });
 test("a Google event is read here and says where it comes from",async()=>{
  const page=await open([google("g","Outside",at(16),at(17))],"calendar-week:2026-10-24");
  click('[data-entry="event:g"][data-au="entry"]');
  const panel=document.querySelector('.au-pop-detail')!;
  expect(panel.textContent).toContain("From Google Calendar");
  expect(panel.querySelector('[data-pop="edit"]')).toBeNull();expect(panel.querySelector('[data-pop="more"]')).toBeNull();
  page.hide();
 });
 test("the month draws its days with chips and a click on an empty day makes an all-day event there",async()=>{
  const page=await open([own(4,"Dentist",at(14),at(15))],"calendar-week:2026-10-24");
  click('[data-au="view"]');click('#app-popover [data-value="month"]');
  expect(page.el.querySelectorAll('.au-month-cell')).toHaveLength(42);
  expect(page.el.querySelector('[data-month-day="2026-10-24"] .cal-chip.is-own b')!.textContent).toBe("Dentist");
  click('[data-month-day="2026-10-27"]');
  expect(document.querySelector('.au-pop-editor [data-pop="start-time"]')).toBeNull();
  expect(page.el.querySelector('[data-month-day="2026-10-27"] .au-draft')).not.toBeNull();
  page.hide();
 });
 test("a source's check hides it and remembers, and the month's arrows ask the core for that month",async()=>{
  const page=await open([own(4,"Dentist",at(14),at(15))],"calendar-week:2026-10-24");
  click('[data-source="own"]');
  expect(page.el.querySelector('[data-entry="own:4"]')).toBeNull();
  expect(page.el.querySelector('[data-source="own"]')!.getAttribute("aria-checked")).toBe("false");
  page.hide();page.el.remove();
  const again=await open([own(4,"Dentist",at(14),at(15))],"calendar-week:2026-10-24");
  expect(again.el.querySelector('[data-entry="own:4"]')).toBeNull();
  click('[data-source="own"]');expect(again.el.querySelector('[data-entry="own:4"]')).not.toBeNull();
  click('[data-au="view"]');click('#app-popover [data-value="month"]');click('[data-au="next"]');await flush();
  expect(api.homeOverview).toHaveBeenLastCalledWith(expect.anything(),"2026-11");
  again.hide();
 });
 test("a change of the calendar elsewhere redraws it",async()=>{
  const page=await open([],"calendar-week:2026-10-24");
  api.homeOverview.mockResolvedValue({calendar:[],calendar_events:[own(4,"Added by a member",at(14),at(15))],calendar_google:"connected"});
  events.forEach(fn=>fn({type:"CalendarChanged"}));await flush();
  expect(page.el.textContent).toContain("Added by a member");
  page.hide();
 });
 test("the page opens with the form on the day Home asked for",async()=>{
  const page=await open([],"calendar-new:2026-10-27");
  expect(document.querySelector('.au-pop-editor')).not.toBeNull();
  expect(page.el.querySelector('.au-day-col[data-day="2026-10-27"] .au-draft')).not.toBeNull();
  page.hide();expect(document.querySelector('.au-pop-editor')).toBeNull();
 });
 test("an empty calendar is calm and offers to make something",async()=>{
  api.routinesList.mockResolvedValue({routines:[]});
  const page=await open([],"calendar-week:2026-10-24");
  const hint=page.el.querySelector('.au-empty-hint')!;
  expect(hint.querySelector('[data-au="new"]')).not.toBeNull();
  expect(page.el.querySelector('.cal-notice')).toBeNull();
  page.hide();
 });
});

describe("what the calendar says of Google",()=>{
 const open=async(state:string,items:HomeItem[]=[own(4,"Dentist",at(14),at(15))]):Promise<{page:ReturnType<typeof createAutomationsPage>;go:ReturnType<typeof vi.fn>}>=>{
  api.homeOverview.mockResolvedValue({calendar:[],calendar_events:items,calendar_google:state});
  const context=app();const page=createAutomationsPage(context);document.body.append(page.el);page.show("calendar-week:2026-10-24" as never);await flush();
  return {page,go:context.go as ReturnType<typeof vi.fn>};
 };
 test("not connected is said once, with the place to connect it, and closed it stays closed",async()=>{
  const {page,go}=await open("not_connected");
  const notice=page.el.querySelector('.cal-notice')!;
  expect(notice.textContent).toContain("isn't connected");
  expect(page.el.querySelector('[data-entry="own:4"]')).not.toBeNull();
  expect(page.el.querySelector('[data-source="google"]')).toBeNull();
  click('[data-calendar-go]');expect(go).toHaveBeenCalledWith("settings","connections");
  click('[data-calendar-dismiss]');
  expect(page.el.querySelector('[data-calendar-go]')).toBeNull();expect(page.el.querySelector('.cal-notice.is-closed')!.textContent).toContain("isn't connected");
  page.hide();page.el.remove();
  const again=await open("not_connected");
  expect(again.page.el.querySelector('[data-calendar-go]')).toBeNull();
  again.page.hide();
 });
 test("a read that failed says so, names where to check, cannot be closed, and own events still show",async()=>{
  const {page,go}=await open("unreadable");
  expect(page.el.querySelector('.cal-notice')!.textContent).toContain("can't be read");
  expect(page.el.querySelector('[data-calendar-dismiss]')).toBeNull();
  expect(page.el.querySelector('[data-entry="own:4"]')).not.toBeNull();
  expect(page.el.querySelector('[data-calendar-go]')!.textContent).toContain("Settings");
  click('[data-calendar-go]');expect(go).toHaveBeenCalledWith("settings","connections");
  page.hide();
 });
 test("connected, nothing is said and Google has a row of its own",async()=>{
  const {page}=await open("connected");
  expect(page.el.querySelector('.cal-notice')).toBeNull();
  expect(page.el.querySelector('[data-source="google"]')).not.toBeNull();
  page.hide();
 });
 test("a successful Composio reading shows the Google source row",async()=>{
  const {page}=await open("connected");
  expect(page.el.querySelector('.cal-notice')).toBeNull();
  expect(page.el.querySelector('[data-source="google"]')).not.toBeNull();
  page.hide();
 });
});

test("routine destination uses an app dropdown",()=>{
 openRoutineDialog({members});click('[data-dlg="more"]');click('[data-dlg="destination"]');
 expect(document.querySelector('#app-popover')!.textContent).toContain("Member's main thread");
});


test("unchanged calendar reads preserve every visible event and face", async () => {
  const page = createAutomationsPage(app()); document.body.append(page.el); page.show("2026-10-24"); await flush();
  const calendar = page.el.querySelector(".au-calendar-main");
  events.forEach(emit => emit({ type: "AgentTurn", turn_id: 999, member_id: 2 })); await flush();
  expect(page.el.querySelector(".au-calendar-main")).toBe(calendar); page.hide();
});
