// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({routinesRun:vi.fn(), routineRuns:vi.fn()}));
vi.mock("./api",()=>api);
import { routineRunState, testRoutine } from "./routine-run";
afterEach(()=>vi.useRealTimers());
test("a test stays pending through owner input and completes only when its history finishes", async()=>{
  vi.useFakeTimers();
  api.routinesRun.mockResolvedValue({run_id:91,turn_id:99});
  const pending = {id:91,routine_id:51,started:1,finished:null,status:"confirm",summary:"",cost:0};
  api.routineRuns.mockResolvedValue({runs:[pending]});
  await testRoutine(51);
  expect(routineRunState(51).running).toBe(true);
  await testRoutine(51);
  expect(api.routinesRun).toHaveBeenCalledTimes(1);
  api.routineRuns.mockResolvedValue({runs:[{...pending,finished:2,status:"done",summary:"Synthetic report"}]});
  await vi.advanceTimersByTimeAsync(1000);
  expect(routineRunState(51)).toMatchObject({running:false,run:{status:"done",summary:"Synthetic report"}});
});
test("a readable refusal ends pending without a false successful run",async()=>{
  api.routinesRun.mockResolvedValue({status:"refused",reason:"Hourly member limit reached"});
  await testRoutine(52);
  expect(routineRunState(52)).toEqual({running:false,reason:"Hourly member limit reached"});
});
test("a failed history read keeps the test pending until a later read confirms its outcome",async()=>{
  vi.useFakeTimers();
  api.routinesRun.mockResolvedValue({run_id:93}); api.routineRuns.mockRejectedValueOnce(new Error("Offline"));
  await testRoutine(53);
  expect(routineRunState(53).running).toBe(true);
  api.routineRuns.mockResolvedValue({runs:[{id:93,finished:3,status:"error",summary:"Synthetic refusal"}]});
  await vi.advanceTimersByTimeAsync(3000);
  expect(routineRunState(53)).toMatchObject({running:false,run:{status:"error"}});
});
