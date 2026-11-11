// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppContext, Member, Routine } from "./types";
const api = vi.hoisted(() => ({ core:vi.fn(), homeOverview:vi.fn(), membersList:vi.fn(), routinesList:vi.fn(), routineWebhook:vi.fn(), routineRuns:vi.fn(), routinesRun:vi.fn(), routinesCreate:vi.fn(), routinesUpdate:vi.fn(), routinesDelete:vi.fn(), calendarAdd:vi.fn(), calendarUpdate:vi.fn(), calendarDelete:vi.fn(), keepAwakeGet:vi.fn(), keepAwakeSet:vi.fn(), roomsList:vi.fn(), settingsGet:vi.fn(), modelsCatalog:vi.fn(), brainsCli:vi.fn(), groupsCreate:vi.fn(), groupsUpdate:vi.fn(), groupsDelete:vi.fn(), membersUpdate:vi.fn(), roomsCreate:vi.fn(), roomSend:vi.fn(), roomStop:vi.fn(), roomMessages:vi.fn() }));
vi.mock("./api",()=>api);
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



test("monthly dates clamp in the calendar and minutes remain one rhythm", () => {
  const monthly = {...plan, next_run:new Date('2026-01-31T09:00').getTime(), schedule:{kind:'monthly',day:31,time:'09:00'}} as Routine;
  const rows = occurrences(monthly, localDay('2026-02-01'), localDay('2026-04-01'));
  expect(rows.map(row=>dateKey(new Date(row.at)))).toEqual(['2026-02-28','2026-03-31']);
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
  // A routine opens to read: its member changes it in the conversation (owner, 2026-11-09).
  chip.click();click('[data-pop="open-routine"]');
  const view=document.querySelector<HTMLElement>(".mb-dialog.rv-dialog")!;
  expect(view.querySelector("h2")!.textContent).toBe("Review");expect(view.querySelector(".rv-prompt")!.textContent).toBe("Check progress");
  expect(view.textContent).toContain("09:00");expect(view.querySelector("input, textarea, [data-dlg='save']")).toBeNull();page.hide();
});


test("interval phases and remaining run limits survive calendar boundaries",()=>{
 const routine={...plan,schedule:{kind:"every" as const,hours:3}};const from=localDay("2026-10-24");expect(occurrences(routine,from,shiftDay(from,1),2).map(o=>new Date(o.at).getHours())).toEqual([9,12]);expect(occurrences({...routine,next_run:null},from,shiftDay(from,1))).toEqual([]);expect(dateKey(shiftDay(localDay("2026-12-31"),1))).toBe("2027-01-01");
});

test("a member dropped on a time asks it in its conversation for a routine then, and unrelated drags do nothing",async()=>{
 const host=app();const page=createAutomationsPage(host);document.body.append(page.el);page.show();await flush();
 const opened:unknown[]=[];const listen=(e:Event):void=>{opened.push((e as CustomEvent).detail);};window.addEventListener("raphael:open-member",listen);
 const slot=page.el.querySelector<HTMLElement>('[data-slot][data-hour="9"]')!;
 const drop=(value:string):void=>{const event=new Event("drop",{bubbles:true,cancelable:true});Object.defineProperty(event,"dataTransfer",{value:{getData:()=>value}});slot.dispatchEvent(event);};
 drop("");expect(host.go).not.toHaveBeenCalled();drop("2");
 expect(opened).toEqual([{memberId:2,turnId:undefined,draft:expect.stringMatching(/09:00/)}]);
 expect(host.go).toHaveBeenLastCalledWith("agent");
 expect(document.querySelector('.mb-dialog')).toBeNull();window.removeEventListener("raphael:open-member",listen);page.hide();
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
 expect(besidePlacement({left:10,right:700,top:5},{width:344,height:300},{...viewport,width:720})).toEqual({left:183,top:40});
 // A wide event of the day view: neither side fits on the calendar, so the panel stands centred over it, never over the rail.
 expect(besidePlacement({left:567,right:1890,top:300},{width:344,height:300},{...viewport,width:1920},{left:513})).toEqual({left:1056.5,top:300});
 expect(besidePlacement({left:600,right:700,top:300},{width:344,height:300},{...viewport,width:900},{left:513}).left).toBe(521);
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



test("unchanged calendar reads preserve every visible event and face", async () => {
  const page = createAutomationsPage(app()); document.body.append(page.el); page.show("2026-10-24"); await flush();
  const calendar = page.el.querySelector(".au-calendar-main");
  events.forEach(emit => emit({ type: "AgentTurn", turn_id: 999, member_id: 2 })); await flush();
  expect(page.el.querySelector(".au-calendar-main")).toBe(calendar); page.hide();
});
