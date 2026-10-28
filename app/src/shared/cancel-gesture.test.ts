// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cancelGesture, CANCEL_WINDOW_MS } from "./cancel-gesture";
let stop: HTMLButtonElement, cancel: ReturnType<typeof vi.fn<() => void>>, dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers(); document.body.innerHTML = "";
  stop=document.createElement("button");document.body.append(stop);cancel=vi.fn();
  dispose=cancelGesture().register(()=>({key:"task:1",button:stop,hint:"Press again to cancel",cancel}));
});
afterEach(()=>{dispose();cancelGesture().clear();vi.useRealTimers();});
const esc=()=>stop.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
test("only a second distinct Escape in 1500ms cancels the same target",()=>{
  esc();expect(cancel).not.toHaveBeenCalled();expect(stop.dataset.cancelArmed).toBe("true");
  stop.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,repeat:true}));expect(cancel).not.toHaveBeenCalled();
  vi.advanceTimersByTime(CANCEL_WINDOW_MS-1);esc();expect(cancel).toHaveBeenCalledOnce();expect(stop.dataset.cancelArmed).toBeUndefined();
});
test.each(["key","click","pointer","timeout","blur","input"])("%s clears the first press",kind=>{
  esc();
  if(kind==="key")stop.dispatchEvent(new KeyboardEvent("keydown",{key:"a",bubbles:true}));
  if(kind==="click")stop.click();
  if(kind==="pointer")stop.dispatchEvent(new Event("pointerdown",{bubbles:true}));
  if(kind==="blur")window.dispatchEvent(new Event("blur"));
  if(kind==="input")stop.dispatchEvent(new Event("input",{bubbles:true}));
  if(kind==="timeout")vi.advanceTimersByTime(CANCEL_WINDOW_MS);
  expect(stop.dataset.cancelArmed).toBeUndefined();esc();expect(cancel).not.toHaveBeenCalled();
});
test("a newly selected task never inherits an armed gesture",()=>{
  esc();dispose();dispose=cancelGesture().register(()=>({key:"task:2",button:stop,hint:"Press again to cancel",cancel}));
  esc();expect(cancel).not.toHaveBeenCalled();esc();expect(cancel).toHaveBeenCalledOnce();
});
