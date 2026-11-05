// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { occurrences } from "./automation-calendar";
import { setLocale } from "./i18n";
import { openTimezoneMenu, zonedTime } from "./timezones";
import { closeMenu } from "./ui";
import type { Routine } from "./types";

afterEach(() => { closeMenu(); document.body.innerHTML = ""; });
test("a searchable zone choice and auto-detect use the shared popover", () => {
  setLocale("zh-TW");
  const anchor = document.createElement("button"); document.body.append(anchor);
  const pick = vi.fn();
  openTimezoneMenu(anchor, "", pick);
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = "台北"; input.dispatchEvent(new Event("input"));
  expect(document.querySelectorAll("[data-zone]")).toHaveLength(1);
  document.querySelector<HTMLButtonElement>('[data-zone="Asia/Taipei"]')!.click();
  expect(pick).toHaveBeenCalledWith("Asia/Taipei");
  openTimezoneMenu(anchor, "Asia/Taipei", pick);
  document.querySelector<HTMLButtonElement>('[data-zone=""]')!.click();
  expect(pick).toHaveBeenLastCalledWith("");
});
test("calendar matches the saved eight AM zone across spring and autumn DST", () => {
  const routine: Routine = {id:1,member_id:1,title:"Sample",prompt:"Review",enabled:true,last_run:null,next_run:Date.parse("2026-03-07T13:00Z"),schedule:{kind:"daily",time:"08:00",timezone:"America/New_York"}};
  expect(occurrences(routine, new Date("2026-03-07T00:00Z"), new Date("2026-03-10T00:00Z")).map(item=>new Date(item.at).toISOString())).toEqual(["2026-03-07T13:00:00.000Z","2026-03-08T12:00:00.000Z","2026-03-09T12:00:00.000Z"]);
  routine.next_run = Date.parse("2026-10-31T12:00Z");
  expect(occurrences(routine, new Date("2026-10-31T00:00Z"), new Date("2026-11-03T00:00Z")).map(item=>new Date(item.at).toISOString())).toEqual(["2026-10-31T12:00:00.000Z","2026-11-01T13:00:00.000Z","2026-11-02T13:00:00.000Z"]);
});
test("DST gaps are skipped and repeated times resolve to the earlier occurrence", () => {
  expect(zonedTime("2026-03-08", "02:30", "America/New_York")).toBeNaN();
  expect(zonedTime("2026-11-01", "01:30", "America/New_York")).toBe(Date.parse("2026-11-01T05:30Z"));
});
test.each(["", "25:00", "not a time"])("invalid wall time %s returns invalid without throwing", time => {
  expect(zonedTime("2026-11-05", time, "Asia/Taipei")).toBeNaN();
});
