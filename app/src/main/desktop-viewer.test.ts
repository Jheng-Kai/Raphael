// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ desktopTeach:vi.fn(), desktopStatus:vi.fn(), desktopOpen:vi.fn(), desktopRenew:vi.fn(), desktopControl:vi.fn(), desktopClose:vi.fn(), desktopRevoke:vi.fn() }));
vi.mock("./api", () => api);
import { mountDesktopViewer, type DesktopState } from "./desktop-viewer";
import { setLocale } from "./i18n";
import { faceHTML } from "./members";
const running: DesktopState = { state:"running", ready:true, control:"member" };
const work = { id:"task", request_id:"nonce", turn_id:42, state:"waiting_control", reason:"sign_in", tool:"get_desktop_state" } as const;
let host: HTMLElement, mounted: ReturnType<typeof mountDesktopViewer>, member = 1, panelOpen = false;
const flush = async (): Promise<void> => { for (let i=0; i<30; i++) await Promise.resolve(); };
const panel = (): HTMLElement => host.querySelector('.desktop-panel')!;
const frame = (): HTMLIFrameElement => host.querySelector('iframe')!;
const take = (): HTMLButtonElement => host.querySelector('[data-desktop="take"]')!;
const peek = (): HTMLButtonElement => host.querySelector('[data-desktop="peek"]')!;
const handback = (): HTMLButtonElement => host.querySelector('[data-desktop="return"]')!;
const trySent = vi.fn();
const waitChanged = vi.fn();
test('teaching takes the member computer, warns visibly, and opens the shared unsaved skill editor on stop',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'recording',text:''});
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  expect(api.desktopTeach).toHaveBeenCalledWith({action:'start',session:'one'});
  expect(host.textContent).toContain('錄製');expect(host.textContent).toContain('私人');
  expect(handback().hidden).toBe(true);
  api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'draft',text:'Draft instructions'});
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  expect(host.querySelector<HTMLTextAreaElement>('#mp-skill-text')!.value).toBe('Draft instructions');
  expect(api.desktopTeach.mock.calls.filter(([p])=>p.action==='save')).toHaveLength(0);
  api.desktopTeach.mockResolvedValueOnce({skill:{id:9,name:'report'}});
  host.querySelector<HTMLButtonElement>('[data-res="skill-save"]')!.click();await flush();
  expect(api.desktopTeach).toHaveBeenLastCalledWith({action:'save',member_id:1,id:'demo',text:'Draft instructions'});
  expect(host.querySelector('[data-teach-input]')).not.toBeNull();
  const input = host.querySelector<HTMLInputElement>('[data-teach-input]')!;
  input.value = 'Quarter two';
  host.querySelector<HTMLButtonElement>('[data-desktop="try-teach"]')!.click();
  await flush();
  expect(trySent).toHaveBeenCalledWith('請使用「report」技能試做一次。這次的輸入：Quarter two');
  expect(panel().hasAttribute('data-expanded')).toBe(false);
});

test('one discard releases the recording and never creates a skill',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'recording',text:''});
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  api.desktopTeach.mockResolvedValueOnce({});
  host.querySelector<HTMLButtonElement>('[data-desktop="discard-teach"]')!.click();await flush();
  expect(api.desktopTeach).toHaveBeenLastCalledWith({action:'discard',member_id:1,id:'demo'});
  expect(api.desktopTeach.mock.calls.some(([p])=>p.action==='save')).toBe(false);
  expect(panel().hasAttribute('data-expanded')).toBe(false);
});

test('a teaching trial cannot send into another conversation while handback is pending',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'recording',text:''});
 host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click(); await flush();
 api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'draft',text:'Sample procedure'});
 host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click(); await flush();
 api.desktopTeach.mockResolvedValueOnce({skill:{id:9,name:'report'}});
 host.querySelector<HTMLButtonElement>('[data-res="skill-save"]')!.click(); await flush();
 let release!: (value: DesktopState) => void;
 api.desktopControl.mockImplementationOnce(() => new Promise<DesktopState>(resolve => { release=resolve; }));
 host.querySelector<HTMLInputElement>('[data-teach-input]')!.value='Sample input';
 host.querySelector<HTMLButtonElement>('[data-desktop="try-teach"]')!.click();
 member=2; mounted.refresh(); await flush(); release(running); await flush();
 expect(trySent).not.toHaveBeenCalled();
 expect(frame()).not.toBeNull();
});
function message(state: string, extra = {}): void { window.dispatchEvent(new MessageEvent('message', {source:frame().contentWindow, origin:'http://127.0.0.1:5000', data:{type:'raphael-desktop', state, ...extra}})); }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); setLocale('zh-TW'); member=1; panelOpen=false;
  api.desktopStatus.mockResolvedValue(running); api.desktopRenew.mockResolvedValue(running); api.desktopClose.mockResolvedValue({});
  api.desktopOpen.mockResolvedValue({session:'one',url:'http://127.0.0.1:5000/one/vnc.html'});
  host=document.createElement('aside'); host.innerHTML='<div class="mb-det-scroll"></div><ol><li data-desktop-slot="42"></li></ol>'; document.body.append(host);
  mounted=mountDesktopViewer(host,()=>member,{timeline:host.querySelector('ol')!,conversation:()=>11,name:()=>"小晴",face:()=>faceHTML({id:member,name:'Sample'},22),openPanel:()=>{panelOpen=true;},closePanel:()=>{panelOpen=false;},panelVisible:()=>panelOpen,trySkill:trySent,changed:waitChanged});
});
afterEach(async()=>{mounted.hide();await flush();document.body.replaceChildren();vi.useRealTimers();});

test('returning from another page restores an unchanged stopped screen and its Start button',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'});
 mounted.show(); await flush(); mounted.hide(); await flush();
 expect(panel().hidden).toBe(true);
 mounted.show(); await flush();
 expect(panel().hidden).toBe(false);
 expect(host.querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.hidden).toBe(false);
});

test('a failed takeover open cannot acquire input when a later watching stream connects',async()=>{
 api.desktopOpen.mockRejectedValueOnce(new Error('Synthetic open failure'));
 mounted.takeover(); await flush();
 await vi.advanceTimersByTimeAsync(2000); await flush(); message('connected'); await flush();
 expect(api.desktopOpen).toHaveBeenCalledTimes(2);
 expect(api.desktopControl).not.toHaveBeenCalled();
 expect(panel().dataset.interactive).toBe('false');
});

test('a new control request after handback resumes watching without acquiring input',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({...running,works:[work]});
 mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValueOnce({...running,control:'owner',works:[work]}).mockResolvedValueOnce({...running,works:[work]});
 peek().click(); await flush(); handback().click(); await flush();
 const askedAgain={...running,works:[{...work,request_id:'next-request'}]};
 api.desktopStatus.mockResolvedValue(askedAgain); api.desktopRenew.mockResolvedValue(askedAgain);
 api.desktopOpen.mockResolvedValue({session:'two',url:'http://127.0.0.1:5000/two/vnc.html'});
 await vi.advanceTimersByTimeAsync(2000); await flush();
 expect(api.desktopOpen).toHaveBeenCalledTimes(2);
 message('connected'); await flush();
 expect(host.querySelector('[data-card-desktop-screen] iframe')).toBe(frame());
 expect(api.desktopControl).toHaveBeenCalledTimes(2);
});

test('handing back the current request does not reopen its watching stream',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({...running,works:[work]});
 mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValueOnce({...running,control:'owner',works:[work]}).mockResolvedValueOnce({...running,works:[{...work,state:'returning'}]});
 peek().click(); await flush(); handback().click(); await flush();
 await vi.advanceTimersByTimeAsync(4000); await flush();
 expect(api.desktopOpen).toHaveBeenCalledTimes(1);
 expect(api.desktopClose).toHaveBeenCalledWith('one');
});

test('a changed status does not rewrite the unchanged wallpaper source attribute',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 const wallpaper=host.querySelector<HTMLImageElement>('.desktop-wallpaper')!;
 const writes:MutationRecord[]=[];
 const observer=new MutationObserver(records=>writes.push(...records)); observer.observe(wallpaper,{attributes:true,attributeFilter:['src']});
 api.desktopRenew.mockResolvedValue({...running,progress:'Synthetic progress'});
 await vi.advanceTimersByTimeAsync(2000); await flush();
 expect([...writes,...observer.takeRecords()]).toHaveLength(0); observer.disconnect();
});

test('owner-wait changes redraw the thread once without reconnecting its stream',async()=>{
  api.desktopStatus.mockResolvedValue({...running,works:[work]});
  api.desktopRenew.mockResolvedValue({...running,works:[work]});
  mounted.show();await flush();
  expect(mounted.waitingForOwner(42)).toBe(true);
  expect(mounted.waitingForOwner(43)).toBe(false);
  expect(waitChanged).toHaveBeenCalledTimes(1);
  mounted.show();await flush();
  expect(waitChanged).toHaveBeenCalledTimes(1);
  api.desktopStatus.mockResolvedValue({...running,works:[{...work,state:'running',reason:''}]});
  api.desktopRenew.mockResolvedValue({...running,works:[{...work,state:'running',reason:''}]});
  mounted.show();await flush();
  expect(mounted.waitingForOwner(42)).toBe(false);
  expect(waitChanged).toHaveBeenCalledTimes(2);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  expect(api.desktopControl).not.toHaveBeenCalled();
});

test('a slow draft can be discarded once and its late answer cannot open an editor',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'recording',text:''});
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  let finish!:(value:unknown)=>void;
  api.desktopTeach.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  expect(host.textContent).toContain('正在整理技能草稿');
  const discard=host.querySelector<HTMLButtonElement>('[data-desktop="discard-teach"]')!;
  expect(discard.disabled).toBe(false);
  api.desktopTeach.mockResolvedValueOnce({});discard.click();await flush();
  finish({id:'demo',state:'draft',text:'Late draft'});await flush();
  expect(host.querySelector('#mp-skill-text')).toBeNull();expect(trySent).not.toHaveBeenCalled();
});

test('a failed draft can be retried without recording again',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'recording',text:''});
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  api.desktopTeach.mockRejectedValueOnce(new Error('model unavailable'));
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  expect(host.querySelector<HTMLElement>('.desktop-recording')!.hidden).toBe(true);
  api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'draft',text:'Retry draft'});
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  expect(api.desktopTeach).toHaveBeenLastCalledWith({action:'draft',member_id:1,id:'demo'});
  expect(host.querySelector<HTMLTextAreaElement>('#mp-skill-text')!.value).toBe('Retry draft');
});

test('shared computers show why teaching is unavailable and offer the existing repair',async()=>{
  api.desktopStatus.mockResolvedValue({...running,teach_available:false});
  panelOpen=true;mounted.show();await flush();message('connected');
  expect(host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.disabled).toBe(true);
  expect(host.querySelector('.desktop-teach-missing')!.textContent).toContain('成員自己的電腦');
  expect(host.querySelector('.desktop-teach-missing [data-missing-repair="computer"]')).not.toBeNull();
});
test('an explicitly opened working-member preview opens one persistent stream',async()=>{
  api.desktopStatus.mockResolvedValue({...running,works:[{...work,state:'running',request_id:'',reason:''}]});
  panelOpen=true; mounted.show();await flush();message('connected');
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
  expect(api.desktopControl.mock.calls.filter(call=>call[1]===false)).toHaveLength(1);expect(api.desktopClose).toHaveBeenCalledWith('one');
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
test('a screen press retains the same iframe and lease while opening takeover',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame();
  peek().click();await flush();expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(frame()).toBe(same);expect(api.desktopOpen).toHaveBeenCalledTimes(1);
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
test('absent Docker keeps a visible reason and the exact installation entry without starting a computer',async()=>{
  api.desktopStatus.mockResolvedValue({...running,state:'absent'});mounted.show();await flush();expect(panel().hidden).toBe(false);expect(api.desktopOpen).not.toHaveBeenCalled();
  expect(panel().textContent).toContain('成員電腦需要 Docker Desktop');
  expect(panel().querySelector('[data-missing-repair="computer"]')).not.toBeNull();
  expect(panel().querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.hidden).toBe(true);
});

test('a press on the picture opens takeover and takes control without reconnecting',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected'); const same=frame();
  api.desktopControl.mockResolvedValue({...running,control:'owner'});
  peek().click();await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(api.desktopControl).toHaveBeenCalledWith('one',true);
  expect(frame()).toBe(same);expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  expect(panel().querySelector('[data-desktop="collapse"], [data-desktop="expand"]')).toBeNull();
});
test('waiting control streams inline without opening the panel, and card takeover reuses the frame',async()=>{
 api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
 expect(panelOpen).toBe(false); const same=frame(); expect(host.querySelector('[data-card-desktop-screen] iframe')).toBe(same);
 api.desktopControl.mockResolvedValue({...running,control:'owner',works:[work]});
 host.querySelector<HTMLButtonElement>('[data-card-desktop-screen] button')!.click(); await flush();
 expect(api.desktopControl).toHaveBeenLastCalledWith('one',true,'nonce'); expect(frame()).toBe(same); expect(api.desktopOpen).toHaveBeenCalledTimes(1);
 api.desktopControl.mockResolvedValue({...running,works:[{...work,state:'running'}]});
 host.querySelector<HTMLButtonElement>('[data-card-desktop="return"]')!.click(); await flush();
 expect(api.desktopControl).toHaveBeenLastCalledWith('one',false,'nonce'); expect(api.desktopClose).toHaveBeenCalledWith('one');
 expect(host.querySelector('.computer-card .card-status.is-done')).not.toBeNull();
});

test('card takeover fills the window with the existing frame and handback closes the lease',async()=>{
 api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
 const same=frame();
 api.desktopControl.mockResolvedValue({...running,control:'owner',works:[work]});
 host.querySelector<HTMLButtonElement>('[data-card-desktop="take"]')!.click(); await flush();
 expect(panel().hasAttribute('data-expanded')).toBe(true);
 expect(panel().querySelector('iframe')).toBe(same);
 expect(host.querySelector('.desktop-takeover-bar [data-desktop="return"]')).not.toBeNull();
 api.desktopControl.mockResolvedValue({...running,works:[{...work,state:'returning'}]});
 handback().click(); await flush();
 expect(panel().hasAttribute('data-expanded')).toBe(false);
 expect(api.desktopClose).toHaveBeenCalledWith('one');
 expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('the panel keeps a picture while its live frame is carried by the conversation card',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
 expect(host.querySelector('[data-card-desktop-screen] iframe')).toBe(frame());
 expect(panel().querySelector<HTMLImageElement>('.desktop-wallpaper')!.hidden).toBe(false);
 message('frame',{image:'data:image/jpeg;base64,c2FtcGxl'}); mounted.sync();
 expect(panel().querySelector<HTMLImageElement>('.desktop-last')!.hidden).toBe(false);
 expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('an unchanged status renewal makes no DOM writes',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 const writes: MutationRecord[]=[]; const observer=new MutationObserver(records=>writes.push(...records)); observer.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
 await vi.advanceTimersByTimeAsync(2000); await flush();
 expect([...writes,...observer.takeRecords()]).toHaveLength(0);
 observer.disconnect();
});

test('an unchanged stopped renewal touches nothing after a running stream stops',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopRenew.mockResolvedValue({state:'stopped',ready:false,control:'member'});
 await vi.advanceTimersByTimeAsync(2000); await flush();
 const writes: MutationRecord[]=[]; const observer=new MutationObserver(records=>writes.push(...records)); observer.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
 await vi.advanceTimersByTimeAsync(2000); await flush();
 expect([...writes,...observer.takeRecords()]).toHaveLength(0);
 observer.disconnect();
});

test('the panel has a screen caption and quiet wallpaper with start inside the screen',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'}); mounted.show(); await flush();
 expect(panel().querySelector('.desktop-screen [data-desktop="retry"]')).not.toBeNull();
 expect(panel().querySelector('.desktop-wallpaper')).not.toBeNull();
 expect(panel().querySelector('.desktop-caption')?.textContent).toBe('小晴的畫面');
 expect(panel().querySelector('[data-desktop="retry"]')?.textContent).toBe('開啟');
 expect(panel().querySelector('[data-desktop="collapse"], [data-desktop="expand"]')).toBeNull();
});

test('a member without a provisioned or granted computer has no screen block',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'missing',ready:false,control:'member',granted:false}); mounted.show(); await flush();
 expect(panel().hidden).toBe(true); expect(api.desktopOpen).not.toHaveBeenCalled();
});

test('handback restores the compact conversation even when takeover began in its preview',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValue({...running,control:'owner'}); peek().click(); await flush();
 api.desktopControl.mockResolvedValue(running); handback().click(); await flush();
 expect(panelOpen).toBe(false);
});

test('handback can be followed by a fresh takeover after its new stream connects',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValue({...running,control:'owner'}); peek().click(); await flush();
 api.desktopControl.mockResolvedValue(running); handback().click(); await flush();
 expect(panel().querySelector('.desktop-placeholder')!.textContent).not.toContain('正在連線');
 expect(peek().hidden).toBe(false);
 api.desktopOpen.mockResolvedValue({session:'two',url:'http://127.0.0.1:5000/two/vnc.html'});
 api.desktopControl.mockResolvedValue({...running,control:'owner'}); peek().click(); await flush();
 expect(api.desktopOpen).toHaveBeenCalledTimes(2);
 expect(api.desktopControl).toHaveBeenCalledTimes(2);
 message('connected'); await flush();
 expect(api.desktopControl).toHaveBeenLastCalledWith('two',true);
 expect(api.desktopControl).toHaveBeenCalledTimes(3);
});

test('file changes opened from a card offer only Back, which returns to the conversation',async()=>{
 panelOpen=false; mounted.show(); await flush();
 mounted.files(); await flush();
 expect(panel().hasAttribute('data-expanded')).toBe(true);
 expect(handback().hidden).toBe(true);
 expect(host.querySelector<HTMLElement>('[data-desktop="menu"]')!.hidden).toBe(true);
 host.querySelector<HTMLButtonElement>('[data-desktop="back"]')!.click(); await flush();
 expect(panel().hasAttribute('data-expanded')).toBe(false);
 expect(panelOpen).toBe(false);
 expect(api.desktopControl).not.toHaveBeenCalled();
});

test('Back hides an unsaved teaching draft and the menu resumes the same editor',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'recording',text:''});
 host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click(); await flush();
 api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'draft',text:'Draft instructions'});
 host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click(); await flush();
 const editor=host.querySelector<HTMLTextAreaElement>('#mp-skill-text')!; editor.value='My unsaved draft';
 host.querySelector<HTMLButtonElement>('[data-desktop="back"]')!.click();
 expect(host.querySelector('.desktop-review')!.hasAttribute('hidden')).toBe(true);
 expect(host.querySelector('#mp-skill-text')).toBe(editor);
 host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click(); await flush();
 expect(host.querySelector('.desktop-review')!.hasAttribute('hidden')).toBe(false);
 expect(editor.value).toBe('My unsaved draft'); expect(api.desktopTeach).toHaveBeenCalledTimes(2);
});
