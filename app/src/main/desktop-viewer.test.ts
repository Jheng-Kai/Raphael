// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ desktopStatus:vi.fn(), desktopOpen:vi.fn(), desktopRenew:vi.fn(), desktopControl:vi.fn(), desktopClose:vi.fn(), desktopRevoke:vi.fn() }));
vi.mock("./api", () => api);
import { mountDesktopViewer, type DesktopState } from "./desktop-viewer";
import { setLocale } from "./i18n";
const running: DesktopState = { state:"running", ready:true, control:"member" };
const work = { id:"task", request_id:"nonce", turn_id:42, state:"waiting_control", reason:"sign_in", tool:"get_desktop_state" } as const;
let host: HTMLElement, mounted: ReturnType<typeof mountDesktopViewer>, member = 1, panelOpen = false;
const flush = async (): Promise<void> => { for (let i=0; i<30; i++) await Promise.resolve(); };
const panel = (): HTMLElement => host.querySelector('.desktop-panel')!;
const frame = (): HTMLIFrameElement => host.querySelector('iframe')!;
const take = (): HTMLButtonElement => host.querySelector('[data-desktop="take"]')!;
const peek = (): HTMLButtonElement => host.querySelector('[data-desktop="peek"]')!;
const handback = (): HTMLButtonElement => host.querySelector('[data-desktop="return"]')!;
function message(state: string, extra = {}): void { window.dispatchEvent(new MessageEvent('message', {source:frame().contentWindow, origin:'http://127.0.0.1:5000', data:{type:'raphael-desktop', state, ...extra}})); }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); setLocale('zh-TW'); member=1; panelOpen=false;
  api.desktopStatus.mockResolvedValue(running); api.desktopRenew.mockResolvedValue(running); api.desktopClose.mockResolvedValue({});
  api.desktopOpen.mockResolvedValue({session:'one',url:'http://127.0.0.1:5000/one/vnc.html'});
  host=document.createElement('aside'); host.innerHTML='<div class="mb-det-scroll"></div><ol><li data-desktop-slot="42"></li></ol>'; document.body.append(host);
  mounted=mountDesktopViewer(host,()=>member,{timeline:host.querySelector('ol')!,conversation:()=>11,name:()=>"小晴",openPanel:()=>{panelOpen=true;},panelVisible:()=>panelOpen});
});
afterEach(async()=>{mounted.hide();await flush();document.body.replaceChildren();vi.useRealTimers();});
test('working conversations reveal the existing panel and open one persistent stream',async()=>{
  api.desktopStatus.mockResolvedValue({...running,works:[{...work,state:'running',reason:''}]});
  mounted.show();await flush();message('connected');
  expect(panelOpen).toBe(true);expect(frame().hidden).toBe(false);
  expect(api.desktopOpen).toHaveBeenCalledWith(1,{conversation_id:11});
  expect(host.querySelector('ol iframe')).toBeNull();expect(host.querySelector('ol')!.textContent).toContain('小晴');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
test('a screen click changes input in place without replacing the frame, URL or session',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame(),url=same.src;
  api.desktopControl.mockResolvedValue({...running,control:'owner'});take().click();await flush();message('interactive',{held:true});
  expect(api.desktopControl).toHaveBeenCalledWith('one',true);expect(frame()).toBe(same);expect(frame().src).toBe(url);
  expect(frame().style.pointerEvents).toBe('auto');expect(panel().dataset.interactive).toBe('true');expect(handback().textContent).toBe('交還');
  api.desktopControl.mockResolvedValue(running);handback().click();handback().click();await flush();
  expect(api.desktopControl.mock.calls.filter(call=>call[1]===false)).toHaveLength(1);expect(frame()).toBe(same);expect(frame().src).toBe(url);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);expect(document.querySelector('[role="dialog"]')).toBeNull();
});
test('explicit done includes the current nonce once; close never sends handback',async()=>{
  api.desktopStatus.mockResolvedValue({...running,works:[work]});mounted.show();await flush();message('connected');
  expect(host.querySelector('.desktop-request')!.textContent).toContain('登入');
  api.desktopControl.mockResolvedValue({...running,control:'owner',works:[work]});take().click();await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one',true,'nonce');expect(handback().textContent).toBe('我完成了');
  api.desktopControl.mockResolvedValue({...running,works:[{...work,state:'returning'}]});handback().click();handback().click();await flush();
  expect(api.desktopControl.mock.calls.filter(call=>call[1]===false&&call[2]==='nonce')).toHaveLength(1);
  mounted.hide(true);await flush();expect(api.desktopClose).toHaveBeenCalledWith('one');expect(api.desktopControl).toHaveBeenCalledTimes(2);
});
test('leaving keeps the stream for a moment, so coming back costs no reconnect',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame();
  mounted.hide();await flush();expect(api.desktopClose).not.toHaveBeenCalled();expect(frame()).toBe(same);
  await vi.advanceTimersByTimeAsync(60_000);mounted.show();await flush();
  expect(frame()).toBe(same);expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  mounted.hide();await vi.advanceTimersByTimeAsync(120_000);await flush();expect(api.desktopClose).toHaveBeenCalledWith('one');
});
test('access can be taken back from the panel',async()=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue({...running,granted:true});api.desktopRevoke.mockResolvedValue({granted:false});mounted.show();await flush();
  const revoke=host.querySelector<HTMLButtonElement>('[data-desktop="revoke"]')!;expect(revoke.hidden).toBe(false);
  revoke.click();await flush();expect(api.desktopRevoke).toHaveBeenCalledTimes(1);expect(revoke.hidden).toBe(true);
});
test('a stopped computer is shown, not started, until the owner presses start',async()=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'});mounted.show();await flush();
  expect(api.desktopOpen).not.toHaveBeenCalled();
  host.querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.click();await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});
test('expansion retains the same iframe and lease',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame();
  host.querySelector<HTMLButtonElement>('[data-desktop="expand"]')!.click();expect(panel().hasAttribute('data-expanded')).toBe(true);
  host.querySelector<HTMLButtonElement>('[data-desktop="expand"]')!.click();expect(frame()).toBe(same);expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});
test('a renewal started before a screen click cannot overwrite the acquired lease',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  let finish!:(value:DesktopState)=>void;api.desktopRenew.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await vi.advanceTimersByTimeAsync(2000);
  api.desktopControl.mockResolvedValue({...running,control:'owner'});take().click();await flush();message('interactive',{held:true});
  finish(running);await flush();
  expect(panel().dataset.interactive).toBe('true');expect(take().hidden).toBe(true);expect(handback().hidden).toBe(false);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});
test('navigation closes a late session without showing another member screen',async()=>{
  let finish!:(value:{session:string;url:string})=>void;api.desktopOpen.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  panelOpen=true;mounted.show();await flush();member=2;mounted.hide();finish({session:'late',url:'http://127.0.0.1:5000/late'});await flush();
  expect(api.desktopClose).toHaveBeenCalledWith('late');expect(host.querySelector('iframe')).toBeNull();
});
test('foreign messages and failed acquisition never enable input',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');api.desktopControl.mockRejectedValue(new Error('busy'));take().click();await flush();
  window.dispatchEvent(new MessageEvent('message',{origin:'http://foreign.test',data:{type:'raphael-desktop',state:'interactive',held:true}}));
  expect(frame().style.pointerEvents).toBe('none');expect(host.querySelector('.desktop-error')!.textContent).toContain('請稍後再試');
});
test('disconnection closes the lease without completing the pending request',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');message('disconnected');await flush();
  expect(api.desktopClose).toHaveBeenCalledWith('one');expect(api.desktopControl).not.toHaveBeenCalled();
});
test.each(['starting','building','preparing'] as const)('%s shows preparation without a blank stream',async state=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue({state,ready:false,control:'member',progress:'#3 [2/4] Installing tools'});mounted.show();await flush();
  expect(host.querySelector('iframe')).toBeNull();expect(host.querySelectorAll('.desktop-preparation li')).toHaveLength(3);expect(take().hidden).toBe(true);
});
test('absent Docker has no computer section',async()=>{
  api.desktopStatus.mockResolvedValue({...running,state:'absent'});mounted.show();await flush();expect(panel().hidden).toBe(true);expect(api.desktopOpen).not.toHaveBeenCalled();
});

test('the member frame collapses in place without completing a takeover or reconnecting',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame();
  mounted.view('computer');peek().click();await flush();
  host.querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!.click();await flush();
  expect(mounted.viewing()).toBe('details');expect(panel().hasAttribute('data-expanded')).toBe(false);
  expect(document.documentElement.hasAttribute('data-desktop-expanded')).toBe(false);
  expect(frame()).toBe(same);expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  expect(api.desktopControl).not.toHaveBeenCalled();
});

test('a press on the picture only enlarges it, and only the named button takes the computer',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  expect(peek().hidden).toBe(false);expect(take().hidden).toBe(false);
  peek().click();await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(true);expect(peek().hidden).toBe(true);
  expect(api.desktopControl).not.toHaveBeenCalled();
  api.desktopControl.mockResolvedValue({...running,control:'owner'});take().click();await flush();
  expect(api.desktopControl).toHaveBeenCalledTimes(1);expect(take().hidden).toBe(true);
});
