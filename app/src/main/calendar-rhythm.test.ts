// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { allDayBars, chipHTML, dayLayout, monthEntries, routineEntries } from "./calendar-view";
import { localDay, shiftDay } from "./schedule-picker";
import { openEventDetail, closePanel } from "./calendar-popover";
import { setLocale } from "./i18n";
import type { Routine, RoutineRun } from "./types";

const day = localDay("2026-10-24");
const at = (hour: number): number => new Date(2026, 9, 24, hour).getTime();
const member = {id:1,name:"Sample",avatar:""};
const routine: Routine = {id:1,member_id:1,title:"Review samples",prompt:"Review",enabled:true,
  last_run:null,next_run:at(8),schedule:{kind:"every",hours:3,from:"08:00",to:"23:00"}};
const run = (id:number,hour:number,status:string): RoutineRun => ({id,routine_id:1,scheduled:at(hour),started:at(hour),finished:at(hour)+100,
  status,turn_id:id,summary:"Sample report",cost:0});

test("one rhythm bar replaces hourly chips, with failed and waiting exceptions at their times", () => {
  const entries = routineEntries(routine,member,day,shiftDay(day,2),[run(1,8,"done"),run(2,11,"error"),run(3,14,"confirm")]);
  expect(entries.filter(e=>e.rhythm)).toHaveLength(1);
  expect(dayLayout(entries,day).map(s=>s.entry.run?.status)).toEqual(["error","confirm"]);
  const bars=allDayBars(entries,[day,shiftDay(day,1)]);
  expect(bars.bars).toHaveLength(1);expect(bars.bars[0]!.span).toBe(2);
  expect(monthEntries(entries,"2026-10-24")).toHaveLength(3);
  const html=chipHTML(entries.find(e=>e.rhythm)!,"is-line","",{face:20});
  expect(html).not.toContain("<time>");expect(html).toContain("08:00");expect(html).toContain("av");
});

test.each([
  {kind:"daily",time:"08:00"}, {kind:"every",hours:24}, {kind:"weekly",days:[6],time:"08:00"},
  {kind:"every",hours:12,from:"08:00",to:"10:00"},
] as const)("once a day or less remains a timed chip: %j", schedule => {
  const entries=routineEntries({...routine,schedule:structuredClone(schedule) as Routine["schedule"]},member,day,shiftDay(day,1),[]);
  expect(entries).toHaveLength(1);expect(entries[0]!.rhythm).toBeFalsy();expect(dayLayout(entries,day)).toHaveLength(1);
});

test("real all-day entries precede rhythms and rhythms count toward more events", () => {
  const entries=routineEntries(routine,member,day,shiftDay(day,1),[]);
  const own={...entries[0]!,id:"own:1",kind:"own" as const,rhythm:false,title:"Holiday"};
  expect(allDayBars([...entries,own],[day],1).bars[0]!.entry.id).toBe("own:1");
  expect(allDayBars([...entries,own],[day],1).more).toEqual([1]);
});

test("a rhythm can show only its face and title without timing", () => {
  const entry=routineEntries(routine,member,day,shiftDay(day,1),[])[0]!;
  const host=document.createElement('div');
  host.innerHTML=chipHTML(entry,"is-line","",{clock:false,face:16,timing:false});
  expect(host.querySelector('b')?.textContent).toBe(routine.title);
  expect(host.querySelector('.av')).not.toBeNull();
  expect(host.querySelector('small, time')).toBeNull();
});

test("rhythm popover shows today's status icons, next run, report, edit and off", () => {
  setLocale("en");
  const entry=routineEntries(routine,member,day,shiftDay(day,1),[run(1,8,"done"),run(2,11,"error")])[0]!;
  const opened:number[]=[];
  const panel=openEventDetail({left:0,right:100,top:0},entry,{today:day,onRun:r=>opened.push(r.id),onOpenRoutine:()=>{},onOff:()=>{}});
  expect(panel.el.querySelectorAll('[data-rhythm-time]')).toHaveLength(6);
  expect(panel.el.querySelector('[data-status="done"] .i')).not.toBeNull();
  expect(panel.el.textContent).toContain("Next run");
  expect(panel.el.textContent?.match(/Every 3 hours/g)).toHaveLength(1);
  panel.el.querySelector<HTMLButtonElement>('[data-rhythm-time="'+at(8)+'"]')!.click();
  expect(opened).toEqual([1]);closePanel();
});
