// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { openRoutineDialog } from "./routine-dialog";
import type { Routine } from "./types";

const api = vi.hoisted(() => ({core:vi.fn(), routineWebhook:vi.fn(), routineRuns:vi.fn(), settingsGet:vi.fn()}));
vi.mock("./api", () => api);
vi.mock("./routine-run", () => ({routineRunState:()=>({running:false}), watchRoutineRuns:()=>()=>{}, runStatusWords:()=>"", testRoutine:vi.fn()}));
afterEach(() => {document.body.innerHTML = ""; vi.clearAllMocks();});
const settle = async (): Promise<void> => {for (let i=0;i<15;i++) await Promise.resolve();};

test("a webhook test retains its normalized URL and copying never requests the key again", async () => {
  api.routineWebhook.mockResolvedValue({address:"http://127.0.0.1:43210/routines/91"});
  api.routineRuns.mockResolvedValue({runs:[]});
  api.settingsGet.mockResolvedValue({settings:{}});
  api.core.mockImplementation(async (_method, params) => params.url ? {tested:true,address:"https://example.test/routines/91"} : {address:"http://127.0.0.1:43210/routines/91",secret:"synthetic-key"});
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {value:{writeText:copy}, configurable:true});
  const routine = {id:91,member_id:1,title:"Form delivery",prompt:"Review deliveries",schedule:null,when:{webhook:true},enabled:true} as Routine;
  const dialog = openRoutineDialog({members:[],routine});
  const click = (action: string): void => dialog.el.querySelector<HTMLButtonElement>(`[data-dlg="${action}"]`)!.click();
  await settle(); click("tunnel");
  dialog.el.querySelector<HTMLInputElement>("[data-tunnel-url]")!.value = "https://example.test";
  click("tunnel-test"); await settle();
  expect(dialog.el.querySelector<HTMLInputElement>("[data-tunnel-url]")!.value).toBe("https://example.test/routines/91");
  click("hook-show"); await settle();
  expect(api.core).toHaveBeenCalledWith("routines.webhook", {id:91,reveal:true,rotate:true});
  const calls = api.core.mock.calls.length;
  click("hook-copy"); await settle();
  expect(copy).toHaveBeenCalledWith("synthetic-key");
  expect(api.core).toHaveBeenCalledTimes(calls);
  const field = dialog.el.querySelector<HTMLInputElement>(".au-hook-secret")!;
  dialog.close(); expect(field.value).toBe("");
});
