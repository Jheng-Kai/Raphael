// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core:vi.fn(), settingsGet:vi.fn(), settingsSet:vi.fn(), desktopMaintain:vi.fn(), desktopWallpaper:vi.fn(), desktopTeach:vi.fn(), desktopStatus:vi.fn(), desktopOpen:vi.fn(), desktopRenew:vi.fn(), desktopControl:vi.fn(), desktopClose:vi.fn() }));
vi.mock("./api", () => api);
import { mountDesktopViewer, preparationHTML, type DesktopState } from "./desktop-viewer";
import { setLocale, t } from "./i18n";
import { faceHTML } from "./members";
import { computerStateText } from './computer-state';
import { computerRowOf, forgetComputerRow } from './computer-row';
const running: DesktopState = { state:"running", ready:true, control:"member" };
const work = { id:"task", request_id:"nonce", turn_id:42, state:"waiting_control", reason:"sign_in", tool:"get_desktop_state" } as const;
let host: HTMLElement, mounted: ReturnType<typeof mountDesktopViewer>, member = 1, panelOpen = false, rowOpen = false;
const flush = async (): Promise<void> => { for (let i=0; i<30; i++) await Promise.resolve(); };
const panel = (): HTMLElement => host.querySelector('.desktop-panel')!;
const frame = (): HTMLIFrameElement => host.querySelector('iframe')!;
const take = (): HTMLButtonElement => host.querySelector('[data-desktop="take"]')!;
const enlarge = (): HTMLButtonElement => host.querySelector('[data-desktop="enlarge"]')!;
/** The preview opens the larger view, and Take control there acquires input. */
const takeOver = async (): Promise<void> => { enlarge().click(); await flush(); take().click(); await flush(); };
const handback = (): HTMLButtonElement => host.querySelector('[data-desktop="return"]')!;
/** The words a reader sees: hidden elements and the cover's hover pill (hidden by CSS when the screen is not up) do not count. */
const shownText = (node: Node): string => node.nodeType === 3 ? node.textContent! : node instanceof HTMLElement && (node.hidden || node.classList.contains('desktop-open-pill')) ? '' : [...node.childNodes].map(shownText).join('');
/** A computer that is not showing its live screen carries nothing over its wallpaper. */
const expectBareScreen = (scope: ParentNode): void => {
  for (const screen of scope.querySelectorAll<HTMLElement>('.desktop-placeholder')) {
    expect(shownText(screen).trim()).toBe('');
    expect(screen.querySelector('svg, img, progress, .desktop-boot-face, .desktop-message, .desktop-stage, .desktop-preparation, .desktop-first-build')).toBeNull();
    expect([...screen.querySelectorAll('button')].filter(button => !button.hidden)).toEqual([]);
  }
  // The one press that starts the computer is the whole-screen cover; no other button is drawn on the screen.
  for (const button of scope.querySelectorAll<HTMLButtonElement>('.desktop-screen button')) if (!button.hidden) expect(button.dataset.desktop).toBe('enlarge');
};
/** The panel as a whole: bare screen, no caption under it, no state label in the header, no recovery entries. */
const expectBare = (): void => {
  expectBareScreen(panel());
  expect(panel().querySelector<HTMLElement>('.desktop-caption')!.hidden).toBe(true);
  expect(panel().querySelector<HTMLElement>('.computer-lifecycle-state')!.hidden).toBe(true);
  expect(panel().querySelector('[data-desktop-location], [data-act="docker-download"]')).toBeNull();
};
const trySent = vi.fn();
const waitChanged = vi.fn();
const maintenanceState: DesktopState = {...running,host:'studio',target:'member-one',mode:'per-bot',idle_minutes:15};
const menuPick = (index: number): void => {
  host.querySelector<HTMLButtonElement>('[data-computer-menu]')!.click();
  document.querySelector<HTMLButtonElement>(`.menu [data-action="${index}"]`)!.click();
};
test('reset cancellation sends no maintenance and explicit yes pins the original target',async()=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue(maintenanceState);mounted.show();await flush();
  menuPick(4); expect(api.desktopMaintain).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-dlg="cancel"]')!.click(); await flush();
  expect(api.desktopMaintain).not.toHaveBeenCalled();
  api.desktopMaintain.mockResolvedValue(maintenanceState);
  menuPick(4);document.querySelector<HTMLButtonElement>('[data-dlg="reset"]')!.click();await flush();
  expect(api.desktopMaintain).toHaveBeenCalledExactlyOnceWith(1,'reset',maintenanceState,true);
  expect(api.desktopOpen).toHaveBeenCalledTimes(2);
});
test('a reset confirmation cannot act on another member after navigation',async()=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue(maintenanceState);mounted.show();await flush();menuPick(4);
  member=2;mounted.refresh();await flush();
  document.querySelector<HTMLButtonElement>('[data-dlg="reset"]')!.click();await flush();
  expect(api.desktopMaintain).not.toHaveBeenCalled();
});
test.each([5,15,60,0])('sleep dropdown persists %s without starting or deleting a computer',async value=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue(maintenanceState);mounted.show();await flush();menuPick(5);
  api.settingsSet.mockResolvedValue({settings:{computer_vm_idle_minutes:value}});
  document.querySelector<HTMLButtonElement>(`.menu [data-value="${value}"]`)!.click();await flush();
  expect(api.settingsSet).toHaveBeenCalledWith('computer_vm_idle_minutes',value);
  expect(api.desktopMaintain).not.toHaveBeenCalled();
});
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
  vi.useFakeTimers(); vi.resetAllMocks(); setLocale('zh-TW'); member=1; panelOpen=false; rowOpen=false; forgetComputerRow(1); forgetComputerRow(2);
  api.settingsGet.mockResolvedValue({settings:{computer_ssh_alias:""}});
  api.desktopStatus.mockResolvedValue(running); api.desktopRenew.mockResolvedValue(running); api.desktopClose.mockResolvedValue({});
  api.desktopOpen.mockResolvedValue({session:'one',url:'http://127.0.0.1:5000/one/vnc.html'});
  host=document.createElement('aside'); host.innerHTML='<div class="mb-det-scroll"></div><ol><li data-desktop-slot="42"></li></ol>'; document.body.append(host);
  mounted=mountDesktopViewer(host,()=>member,{timeline:host.querySelector('ol')!,conversation:()=>11,name:()=>"小晴",face:()=>faceHTML({id:member,name:'Sample'},22),openPanel:()=>{panelOpen=true;},closePanel:()=>{panelOpen=false;},panelVisible:()=>panelOpen,rowShown:()=>rowOpen,trySkill:trySent,changed:waitChanged});
});
afterEach(async()=>{mounted.hide();await flush();document.body.replaceChildren();vi.useRealTimers();});

test('the captioned preview opens the larger view to watch the same stream, Esc folds it back without control, and another member starts small', async () => {
  panelOpen=true; mounted.show(); await flush();
  expect(enlarge().hidden).toBe(false); expect(take().hidden).toBe(true);
  expect(enlarge().getAttribute('aria-label')).toBe('開啟大畫面');
  expect(panel().querySelector('.desktop-open-pill')?.textContent).toBe('開啟');
  // Nothing is written over the screen or under it, not even before the stream is up.
  expectBareScreen(panel());
  message('connected');
  expect(panel().querySelector<HTMLElement>('.computer-lifecycle-state')!.hidden).toBe(false);
  expect(panel().querySelector('[data-computer-state-text]')?.textContent).toBe(t('desktop.state.running'));
  expect(panel().querySelector<HTMLElement>('.desktop-caption')!.hidden).toBe(true);
  const stream=frame();
  enlarge().click(); await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(document.documentElement.hasAttribute('data-desktop-watch')).toBe(true);
  expect(enlarge().hidden).toBe(true);
  expect(panel().querySelector('.desktop-mode-label')?.textContent).toBe('觀看中');
  expect(take().hidden).toBe(false); expect(take().textContent).toBe('接手控制'); expect(handback().hidden).toBe(true);
  expect(panel().querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!.hidden).toBe(false);
  expect(frame()).toBe(stream); expect(api.desktopControl).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));
  expect(panel().hasAttribute('data-expanded')).toBe(false);
  expect(take().hidden).toBe(true);
  expect(frame()).toBe(stream); expect(api.desktopClose).not.toHaveBeenCalled();
  enlarge().click();
  member=2; mounted.refresh(); await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(false);
  expect(document.documentElement.hasAttribute('data-desktop-watch')).toBe(false);
});

test('a screen still connecting opens large at once and connects there', async () => {
  let opened!: (value: {session:string;url:string}) => void;
  api.desktopOpen.mockImplementationOnce(() => new Promise(resolve => { opened = resolve; }));
  panelOpen=true; mounted.show(); await flush();
  expect(enlarge().hidden).toBe(false);
  enlarge().click(); await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(take().hidden).toBe(false); expect(take().disabled).toBe(true);
  opened({session:'one',url:'http://127.0.0.1:5000/one/vnc.html'}); await flush();
  message('connected'); await flush();
  expect(take().disabled).toBe(false);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  api.desktopControl.mockResolvedValue({...running,control:'owner'});
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenCalledWith('one',true);
  expect(panel().querySelector('.desktop-mode-label')?.textContent).toBe('正在接手…');
  message('interactive',{held:true}); await flush();
  expect(panel().querySelector('.desktop-mode-label')?.textContent).toBe('你正在控制');
  expect(handback().hidden).toBe(false); expect(take().hidden).toBe(true);
});

test('watching shows one pill with Stop beside it under its translated tooltip', async () => {
  panelOpen=true;
  api.desktopStatus.mockResolvedValue({...running,works:[{...work,state:'running',tool:'type_text'}]});
  mounted.show(); await flush(); message('connected');
  enlarge().click();
  expect(panel().querySelector('.desktop-dock .desktop-mode-label')?.textContent).toBe('觀看中');
  const stop = panel().querySelector<HTMLButtonElement>('.desktop-dock [data-desktop="stop"]')!;
  expect(stop.title).toBe(t('agent.stop'));
  expect(stop.getAttribute('aria-label')).toBe(stop.title);
});

test("a sign-in card's 接手 opens the same stream large under the owner's hands, and 我完成了 in its pill hands the nonce back once", async () => {
  api.desktopStatus.mockResolvedValue({...running,works:[work]});
  api.desktopControl.mockResolvedValueOnce({...running,control:'owner',works:[work]})
    .mockResolvedValueOnce({...running,works:[{...work,state:'running'}]});
  mounted.show(); await flush(); message('connected');
  const stream=frame();
  expect(host.querySelector('[data-card-desktop-screen] iframe')).toBe(stream);
  host.querySelector<HTMLButtonElement>('[data-card-desktop="take"].pri')!.click(); await flush();
  // R-PANEL-09: no work in a small picture; the larger view takes control with the same frame.
  expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(panel().querySelector('.desktop-screen iframe')).toBe(stream);
  expect(api.desktopControl).toHaveBeenCalledWith('one',true,'nonce');
  expect(panel().querySelector('.desktop-mode-label')!.textContent).toBe('正在接手…');
  message('interactive',{held:true});
  expect(panel().querySelector('.desktop-mode-label')!.textContent).toBe('你正在控制');
  expect(stream.style.pointerEvents).toBe('auto');
  message('frame',{image:'data:image/jpeg;base64,SYNTHETIC_PRIVATE'});
  expect(host.querySelector<HTMLImageElement>('.desktop-last')!.src).not.toContain('SYNTHETIC_PRIVATE');
  expect(handback().textContent).toBe('我完成了'); expect(panel().querySelector('.desktop-request')!.textContent).toContain('登入');
  handback().click(); await flush();
  expect(api.desktopControl.mock.calls.filter(([,held])=>!held)).toEqual([['one',false,'nonce']]);
  expect(panel().hasAttribute('data-expanded')).toBe(false);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('the screen on the sign-in card takes control as its 接手 does', async () => {
  api.desktopStatus.mockResolvedValue({...running,works:[work]});
  api.desktopControl.mockResolvedValue({...running,control:'owner',works:[work]});
  mounted.show(); await flush(); message('connected');
  host.querySelector<HTMLButtonElement>('[data-card-desktop-screen] > [data-card-desktop="take"]')!.click(); await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(api.desktopControl).toHaveBeenCalledWith('one',true,'nonce');
});

test('a lease the screen never confirms is not called control: 正在接手, then a failure under the screen and watching again', async () => {
  api.desktopStatus.mockResolvedValue({...running,works:[work]});
  api.desktopControl.mockResolvedValueOnce({...running,control:'owner',works:[work]}).mockResolvedValueOnce({...running,works:[work]});
  mounted.show(); await flush(); message('connected');
  // The core holds the lease for the owner all along; only the screen never says it took the owner's input.
  api.desktopRenew.mockResolvedValue({...running,control:'owner',works:[work]});
  host.querySelector<HTMLButtonElement>('[data-card-desktop="take"].pri')!.click(); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!;
  expect(label()).toBe('正在接手…'); expect(frame().style.pointerEvents).toBe('none');
  await vi.advanceTimersByTimeAsync(5_000); await flush();
  expect(label()).toBe('正在接手…');
  await vi.advanceTimersByTimeAsync(1_500); await flush();
  // Given back without the request id: a failed take is not 我完成了.
  expect(api.desktopControl.mock.calls.filter(([,held])=>!held)).toEqual([['one',false]]);
  expect(label()).toBe('觀看中'); expect(document.documentElement.hasAttribute('data-desktop-watch')).toBe(true);
  expect(panel().querySelector('.desktop-error')!.textContent).toBe(t('desktop.takeFailed'));
  expect(panel().querySelector<HTMLElement>('.desktop-error')!.hidden).toBe(false);
  // Back with the member, Take control offers one more try.
  api.desktopRenew.mockResolvedValue({...running,works:[work]});
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(take().hidden).toBe(false); expect(take().disabled).toBe(false);
});

test('enlarging an owner-held screen disables viewer input without changing the lease', async () => {
  api.desktopStatus.mockResolvedValue({...running,control:'owner'});
  panelOpen=true; mounted.show(); await flush(); message('connected'); message('interactive',{held:true});
  const before=api.desktopControl.mock.calls.length;
  host.querySelector<HTMLButtonElement>('[data-desktop="enlarge"]')!.click();
  expect(frame().style.pointerEvents).toBe('none');
  expect(panel().querySelector('.desktop-mode-label')!.textContent).toBe('觀看中');
  expect(api.desktopControl.mock.calls).toHaveLength(before);
});

test('watching always offers Take control, whoever the core says holds the lease: one press takes it again (owner, 2026-11-14)', async () => {
  panelOpen=true; mounted.show(); await flush(); message('connected');
  enlarge().click(); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!.trim();
  // An earlier take-over's lease that the core still keeps for this session, while the view only watches.
  api.desktopRenew.mockResolvedValue({ ...running, control:'owner' });
  await vi.advanceTimersByTimeAsync(2_500); await flush();
  expect(label()).toBe(t('desktop.watching'));
  expect(take().hidden).toBe(false); expect(take().disabled).toBe(false);
  expect(frame().style.pointerEvents).toBe('none');
  api.desktopControl.mockResolvedValue({ ...running, control:'owner' });
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', true);
  expect(label()).toBe(t('desktop.taking'));
  message('interactive', { held:true }); await flush();
  expect(label()).toBe(t('desktop.operating')); expect(take().hidden).toBe(true);
});

test('a take the core is still deciding reads 正在接手…, and one it refuses leaves Take control to press again (owner, 2026-11-14)', async () => {
  panelOpen=true; mounted.show(); await flush(); message('connected');
  enlarge().click(); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!.trim();
  let refuse!: (error: Error) => void;
  api.desktopControl.mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }));
  take().click(); await flush();
  expect(label()).toBe(t('desktop.taking')); expect(take().hidden).toBe(true);
  // A member's action was still running when the press arrived and the core would not wait for it.
  refuse(new Error('desktop busy')); await flush();
  expect(label()).toBe(t('desktop.watching'));
  expect(take().hidden).toBe(false); expect(take().disabled).toBe(false); expect(handback().hidden).toBe(true);
  expect(panel().querySelector<HTMLElement>('.desktop-error')!.hidden).toBe(false);
  api.desktopControl.mockResolvedValue({ ...running, control:'owner' });
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', true); expect(label()).toBe(t('desktop.taking'));
});

test('a lease the core gave back is not kept on screen: the pill watches, input stops and Take control returns (owner, 2026-11-14)', async () => {
  panelOpen=true; mounted.show(); await flush(); message('connected');
  api.desktopControl.mockResolvedValue({ ...running, control:'owner' });
  await takeOver(); message('interactive', { held:true }); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!.trim();
  expect(label()).toBe(t('desktop.operating')); expect(frame().style.pointerEvents).toBe('auto');
  // The core released it (nothing was typed for a long while): the next renewal says so.
  api.desktopRenew.mockResolvedValue(running);
  await vi.advanceTimersByTimeAsync(2_500); await flush();
  expect(label()).toBe(t('desktop.watching')); expect(frame().style.pointerEvents).toBe('none');
  expect(take().hidden).toBe(false); expect(handback().hidden).toBe(true);
  api.desktopControl.mockClear(); api.desktopControl.mockResolvedValue({ ...running, control:'owner' });
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', true);
});

test('returning from another page restores an unchanged sleeping screen that wakes with a press',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'});
 mounted.show(); await flush(); mounted.hide(); await flush();
 expect(panel().hidden).toBe(true);
 mounted.show(); await flush();
 expect(panel().hidden).toBe(false);
 expect(host.querySelector<HTMLButtonElement>('[data-desktop="enlarge"][data-asleep]')!.hidden).toBe(false);
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
 await takeOver(); handback().click(); await flush();
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
 await takeOver(); handback().click(); await flush();
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

test("the larger view keeps the review, the file changes and one foot inside the screen's shell, and the draft is said once",async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  const shell = panel().querySelector('.desktop-shell')!, foot = shell.querySelector(':scope > .desktop-foot')!;
  // R-PANEL-08: the screen, the boxes that take its place and the foot are one column; nothing of the computer sits outside it.
  expect([...shell.children].map(child => child.className)).toEqual(['desktop-screen', 'desktop-caption', 'desktop-review', 'desktop-checkpoints', 'desktop-foot']);
  expect([...foot.querySelectorAll(':scope > .desktop-notes > *')].map(child => child.className)).toEqual(['desktop-request', 'desktop-error', 'desktop-recording', 'desktop-teach-missing', 'desktop-try']);
  expect(foot.querySelector(':scope > .desktop-bar > .desktop-dock [data-desktop="menu"]')).not.toBeNull();
  expect(foot.querySelector(':scope > .desktop-bar > .desktop-actions [data-desktop="teach"]')).not.toBeNull();
  api.desktopTeach.mockResolvedValueOnce({id:'demo',state:'recording',text:''});
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  api.desktopTeach.mockImplementationOnce(()=>new Promise(()=>{}));
  host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.click();await flush();
  // While the draft is written the line says so and no button repeats it; Discard stays.
  expect(shownText(panel()).split('正在整理技能草稿').length - 1).toBe(1);
  expect(host.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!.hidden).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[data-desktop="discard-teach"]')!.hidden).toBe(false);
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
  expect(host.querySelector('ol iframe')).toBeNull();expect(host.querySelector('ol')!.textContent).toBe('');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
test('a screen click changes input in place without replacing the frame, URL or session',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame(),url=same.src;
  api.desktopControl.mockResolvedValue({...running,control:'owner'});take().click();await flush();message('interactive',{held:true});
  expect(api.desktopControl).toHaveBeenCalledWith('one',true);expect(frame()).toBe(same);expect(frame().src).toBe(url);
  expect(frame().style.pointerEvents).toBe('auto');expect(panel().dataset.interactive).toBe('true');expect(handback().textContent).toBe('停止');
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
test('nothing in the panel asks whether the member may have its computer, or takes it back',async()=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue(running);mounted.show();await flush();
  expect(host.querySelector('[data-desktop="revoke"]')).toBeNull();
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);expect(api.desktopOpen).toHaveBeenCalledWith(1,{conversation_id:11});
});
test('a sleeping computer is shown, not started, until the owner presses its screen',async()=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'});mounted.show();await flush();
  expect(api.desktopOpen).not.toHaveBeenCalled();
  let opened!:(value:{session:string;url:string})=>void;
  api.desktopOpen.mockImplementationOnce(()=>new Promise(resolve=>{opened=resolve;}));
  host.querySelector<HTMLButtonElement>('[data-desktop="enlarge"]')!.click();await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  // Waking says nothing on the screen either; the press is spent (the cover is gone) and the wallpaper stays alone.
  expectBare(); expect(enlarge().hidden).toBe(true);
  // A status read from before the press cannot put the screen back to sleep: the cover does not come back asleep.
  await vi.advanceTimersByTimeAsync(2000); await flush();
  expect(enlarge().hidden).toBe(true); expect(enlarge().hasAttribute('data-asleep')).toBe(false);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  opened({session:'one',url:'http://127.0.0.1:5000/one/vnc.html'}); api.desktopRenew.mockResolvedValue(running);
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(panel().dataset.desktopState).not.toBe('stopped');
  expect(panel().querySelector<HTMLElement>('.computer-lifecycle-state')!.hidden).toBe(false);
  expect(panel().querySelector('.desktop-preparation')).toBeNull();
});

// What one press on the bare screen does for each state the computer can be in while it is not showing its screen:
// wake it, start the engine, reopen the stream, or nothing while it is already getting ready.
test.each([
  [{state:'stopped'}, 'stopped', 'wake'], [{state:'missing'}, 'stopped', 'wake'],
  [{state:'starting'}, 'starting', 'none'], [{state:'preparing'}, 'preparing', 'none'], [{state:'building'}, 'building', 'none'],
  [{state:'preparing',lifecycle:'waking'}, 'preparing', 'none'], [{state:'building',lifecycle:'updating'}, 'building', 'none'], [{state:'preparing',lifecycle:'repairing'}, 'preparing', 'none'],
  [{state:'unavailable',error:'docker_stopped'}, 'unavailable', 'docker'], [{state:'absent',error:'docker_missing'}, 'unavailable', 'reopen'],
  [{state:'unavailable',error:'remote_unavailable',host:'studio'}, 'unavailable', 'reopen'], [{state:'missing',image:false}, 'stopped', 'reopen'],
  [{state:'incompatible'}, 'unavailable', 'reopen'], [{state:'unavailable'}, 'unavailable', 'reopen'],
] as const)('offline %j draws nothing over the wallpaper, keeps its state in data, and one press does: %s / %s', async (status, dataState, press) => {
  const snapshot: DesktopState = {...status,ready:false,control:'member'};
  panelOpen=true; api.desktopStatus.mockResolvedValue(snapshot); api.core.mockResolvedValue({state:'stopped',ready:false,control:'member',host:''});
  mounted.show(); await flush();
  expect(panel().dataset.desktopState).toBe(dataState);
  expectBare();
  // The words that used to explain the state are written nowhere in the panel, header included.
  const sentence = computerStateText(snapshot);
  if (sentence) expect(shownText(panel())).not.toContain(sentence);
  expect(panel().querySelector('.computer-lifecycle-face')).toBeNull();
  expect(take().hidden).toBe(true); expect(panel().querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.hidden).toBe(true);
  // The cover is there unless the computer is already getting ready; nothing started before the press.
  expect(enlarge().hidden).toBe(press === 'none');
  expect(api.desktopOpen).not.toHaveBeenCalled(); expect(api.core).not.toHaveBeenCalled();
  // A hidden cover cannot be pressed, so a computer that is getting ready is simply left alone.
  if (!enlarge().hidden) enlarge().click();
  await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(false); expect(take().hidden).toBe(true);
  expect(api.desktopOpen).toHaveBeenCalledTimes(press === 'wake' || press === 'reopen' ? 1 : 0);
  if (press === 'docker') expect(api.core).toHaveBeenCalledExactlyOnceWith('computer.viewer_status',{member_id:1,start_docker:true,host:''});
  else expect(api.core).not.toHaveBeenCalled();
});
test('the preview opens the larger view with the same iframe and session',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame();
  enlarge().click();await flush();expect(panel().hasAttribute('data-expanded')).toBe(true);
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
test.each(['starting','building','preparing'] as const)('%s shows no preparation text, face or progress, only the wallpaper, and no blank stream',async state=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue({state,ready:false,control:'member',progress:'#3 [2/4] Installing tools'});mounted.show();await flush();
  expect(host.querySelector('iframe')).toBeNull();expect(take().hidden).toBe(true);
  expect(panel().dataset.desktopState).toBe(state);
  expectBare();
  expect(host.querySelector('.desktop-preparation, .desktop-stage, .desktop-first-build, progress')).toBeNull();
  expect(shownText(panel())).not.toContain('#3'); expect(shownText(panel())).not.toContain(t(`desktop.${state}`));
  // Getting ready is not pressable: there is nothing to start twice.
  expect(enlarge().hidden).toBe(true); expect(panel().querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.hidden).toBe(true);
  expect(api.desktopOpen).not.toHaveBeenCalled();
});

test('real build percent updates change only the state in data and an unchanged refresh writes nothing',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'building',ready:false,control:'member',progress:'Downloading 12%'}); mounted.show(); await flush();
 expect(panel().dataset.desktopState).toBe('building'); expectBare();
 api.desktopStatus.mockResolvedValue({state:'preparing',ready:false,control:'member',progress:'Starting 74%'}); await vi.advanceTimersByTimeAsync(2000); await flush();
 expect(panel().dataset.desktopState).toBe('preparing'); expectBare();
 expect(panel().querySelector('progress, svg.slime')).toBeNull();
 const observer=new MutationObserver(()=>{}); observer.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
 await vi.advanceTimersByTimeAsync(2000); await flush(); expect(observer.takeRecords()).toHaveLength(0); observer.disconnect();
});

const OWN_PICTURE = 'data:image/jpeg;base64,/9j/sample';
test.each(['data-card-desktop-screen','data-card-screen'])('the owner picture replaces the town on the panel and the %s card',async attribute=>{
 panelOpen=true; api.desktopWallpaper.mockResolvedValue({image:OWN_PICTURE});
 const inline=document.createElement('div'); inline.setAttribute(attribute,''); host.querySelector('ol')!.append(inline);
 api.desktopStatus.mockResolvedValue({state:'starting',ready:false,control:'member'}); mounted.show(); await flush();
 for (const picture of [panel().querySelector('.desktop-wallpaper'),inline.querySelector('.desktop-wallpaper')]) {
  expect(picture?.getAttribute('src')).toBe(OWN_PICTURE);
  expect(picture?.hasAttribute('data-own')).toBe(true);
 }
});

test('the picture is read once and a failed read keeps the town without any owner marking',async()=>{
 panelOpen=true; api.desktopWallpaper.mockRejectedValue(new Error('Synthetic read failure'));
 mounted.show(); await flush(); mounted.hide(); await flush(); mounted.show(); await flush();
 const picture=panel().querySelector('.desktop-wallpaper')!;
 expect(picture.getAttribute('src')).toMatch(/^\/wallpapers\/(morning|noon|dusk|evening|night)\.svg$/);
 expect(picture.hasAttribute('data-own')).toBe(false);
 expect(api.desktopWallpaper).toHaveBeenCalledTimes(1);
});

test('the town never flashes before the picture read answers',async()=>{
 panelOpen=true; let answer!:(value:{image?:string})=>void;
 api.desktopWallpaper.mockReturnValue(new Promise(resolve=>{answer=resolve;}));
 mounted.show(); await flush();
 expect(panel().querySelector('.desktop-wallpaper')?.hasAttribute('src')).toBe(false);
 answer({image:OWN_PICTURE}); await flush();
 expect(panel().querySelector('.desktop-wallpaper')?.getAttribute('src')).toBe(OWN_PICTURE);
});

test.each(['data-card-desktop-screen','data-card-screen'])('the %s card shares the boot wallpaper and, like the panel, says nothing over it',async attribute=>{
 panelOpen=true;
 const inline=document.createElement('div'); inline.setAttribute(attribute,''); host.querySelector('ol')!.append(inline);
 api.desktopStatus.mockResolvedValue({state:'starting',ready:false,control:'member'}); mounted.show(); await flush();
 expect(inline.querySelector('.desktop-wallpaper')?.getAttribute('src')).toBe(panel().querySelector('.desktop-wallpaper')?.getAttribute('src'));
 expect(inline.querySelector('.desktop-placeholder')).not.toBeNull();
 expectBareScreen(inline); expectBareScreen(panel());
 expect(inline.querySelector('.desktop-stage, svg.slime')).toBeNull();
 expect(panel().dataset.desktopState).toBe('starting');
});

test('a booting inline card waits for readiness and stays bare until the stream connects',async()=>{
 api.desktopStatus.mockResolvedValue({state:'building',ready:false,control:'member',works:[work]}); mounted.show(); await flush();
 host.querySelector<HTMLButtonElement>('[data-card-desktop="take"]')!.click(); await flush();
 // The larger view opens at once and connects there; nothing starts a stream before the computer is up.
 expect(panel().hasAttribute('data-expanded')).toBe(true); expect(api.desktopOpen).not.toHaveBeenCalled();
 expectBareScreen(host);
 api.desktopStatus.mockResolvedValue({state:'preparing',ready:false,control:'member',works:[work]}); await vi.advanceTimersByTimeAsync(2000);
 expectBareScreen(host); expect(host.querySelector('.desktop-preparation')).toBeNull();
 api.desktopStatus.mockResolvedValue({...running,works:[work]}); await vi.advanceTimersByTimeAsync(2000); await flush();
 expect(api.desktopOpen).toHaveBeenCalledTimes(1); message('connected');
 expect(panel().querySelector<HTMLImageElement>('.desktop-wallpaper')!.hidden).toBe(false);
 expect(frame().hidden).toBe(false);
});

test.each(['zh-TW','en','ja'] as const)('%s uses the existing stage words and hides raw build output',locale=>{
 setLocale(locale);
 const stage=document.createElement('div'); stage.innerHTML=preparationHTML({state:'building',ready:false,control:'member',progress:'Synthetic step 37%'},faceHTML({id:1,name:'Sample'},22));
 expect(stage.querySelector('.desktop-stage')?.textContent).toBe(t('desktop.building'));
 expect(stage.querySelector('.desktop-first-build')?.textContent).toBe(t('desktop.firstBuild'));
 expect(stage.querySelector('progress')?.getAttribute('value')).toBe('37');
 expect(stage.textContent).not.toContain('Synthetic');
});
test('absent Docker keeps the panel with its wallpaper alone: no reason, no download button, nothing started until the press',async()=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue({...running,state:'absent'});mounted.show();await flush();expect(panel().hidden).toBe(false);expect(api.desktopOpen).not.toHaveBeenCalled();
  expect(panel().dataset.desktopState).toBe('unavailable');
  expectBare();
  expect(shownText(panel())).not.toContain(t('desktop.dockerMissing'));
  expect(panel().querySelector('[data-act="docker-download"]')).toBeNull();
  expect(panel().querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.hidden).toBe(true);
  // The location menu stays, so the owner can still choose another computer.
  expect(panel().querySelector('[data-computer-location]')).not.toBeNull();
  expect(enlarge().hidden).toBe(false);
  enlarge().click();await flush();expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('Take control in the larger view acquires input without reconnecting',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected'); const same=frame();
  api.desktopControl.mockResolvedValue({...running,control:'owner'});
  await takeOver();
  expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(api.desktopControl).toHaveBeenCalledWith('one',true);
  expect(frame()).toBe(same);expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  expect(panel().querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!.hidden).toBe(true);
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

test('card takeover carries the inline frame into the larger view and handback closes the lease',async()=>{
 api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
 const same=frame();
 api.desktopControl.mockResolvedValue({...running,control:'owner',works:[work]});
 host.querySelector<HTMLButtonElement>('[data-card-desktop="take"]')!.click(); await flush();
 expect(panel().hasAttribute('data-expanded')).toBe(true);
 expect(panel().querySelector('.desktop-screen iframe')).toBe(same);
 expect(host.querySelector('[data-card-desktop="return"]')).not.toBeNull();
 api.desktopControl.mockResolvedValue({...running,works:[{...work,state:'returning'}]});
 handback().click(); await flush();
 expect(panel().hasAttribute('data-expanded')).toBe(false);
 expect(api.desktopClose).toHaveBeenCalledWith('one');
 expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('a private owner request never caches the live card picture in the details panel',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
 expect(host.querySelector('[data-card-desktop-screen] iframe')).toBe(frame());
 expect(panel().querySelector<HTMLImageElement>('.desktop-wallpaper')!.hidden).toBe(false);
 message('frame',{image:'data:image/jpeg;base64,c2FtcGxl'}); mounted.sync();
 expect(panel().querySelector<HTMLImageElement>('.desktop-last')!.hidden).toBe(true);
 expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('the live view is asked for pictures only while the panel shows one, and asked again after it reconnects',async()=>{
 panelOpen=true; mounted.show(); await flush();
 const post=vi.fn(); Object.defineProperty(frame(),'contentWindow',{configurable:true,value:{postMessage:post}});
 const asks=():boolean[]=>post.mock.calls.map(([data])=>data as {type?:string;on?:boolean}).filter(data=>data.type==='raphael-desktop-frames').map(data=>data.on!);
 message('connected'); mounted.sync();
 expect(asks()).toEqual([]);
 const inline=document.createElement('div'); inline.setAttribute('data-card-desktop-screen',''); host.querySelector('ol')!.append(inline);
 mounted.sync(); expect(asks()).toEqual([true]);
 mounted.sync(); expect(asks()).toEqual([true]);
 message('connected'); mounted.sync(); expect(asks()).toEqual([true,true]);
 inline.remove(); mounted.sync(); expect(asks()).toEqual([true,true,false]);
});

test('a computer whose connection repaired itself says nothing about it',async()=>{
 api.desktopStatus.mockResolvedValue({...running,repair_revision:3}); api.desktopRenew.mockResolvedValue({...running,repair_revision:3});
 panelOpen=true; mounted.show(); await flush(); message('connected');
 await vi.advanceTimersByTimeAsync(2000); await flush();
 expect(host.querySelector('.computer-repair-note')).toBeNull();
 expect(host.textContent).not.toMatch(/修復|repair/i);
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

test('the sleeping panel is the wallpaper alone: no caption, face or line, and the whole screen is the press that wakes it',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'}); mounted.show(); await flush();
 expect(panel().querySelector('.desktop-wallpaper')).not.toBeNull();
 expectBare(); expect(shownText(panel())).not.toContain('電腦在休眠'); expect(shownText(panel())).not.toContain('小晴的畫面');
 expect(panel().querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.hidden).toBe(true);
 const cover = panel().querySelector<HTMLButtonElement>('[data-desktop="enlarge"]')!;
 expect(cover.hidden).toBe(false); expect(cover.getAttribute('aria-label')).toBe('喚醒電腦');
 expect(panel().querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!.hidden).toBe(true);
});

test('a member without a computer retains location controls without starting one',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'missing',ready:false,control:'member'}); mounted.show(); await flush();
 expect(panel().hidden).toBe(false); expect(panel().querySelector("[data-computer-location]")).not.toBeNull(); expect(api.desktopOpen).not.toHaveBeenCalled();
});

test('handback restores the compact conversation even when takeover began in its preview',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValue({...running,control:'owner'}); await takeOver();
 api.desktopControl.mockResolvedValue(running); handback().click(); await flush();
 expect(panelOpen).toBe(false);
});

test('handback can be followed by a fresh takeover after its new stream connects',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValue({...running,control:'owner'}); await takeOver();
 api.desktopControl.mockResolvedValue(running); handback().click(); await flush();
 expect(panel().querySelector('.desktop-placeholder')!.textContent).not.toContain('正在連線');
 expect(enlarge().hidden).toBe(false);
 api.desktopOpen.mockResolvedValue({session:'two',url:'http://127.0.0.1:5000/two/vnc.html'});
 api.desktopControl.mockResolvedValue({...running,control:'owner'});
 enlarge().click(); await flush();
 expect(api.desktopOpen).toHaveBeenCalledTimes(2);
 expect(take().disabled).toBe(true);
 expect(api.desktopControl).toHaveBeenCalledTimes(2);
 message('connected'); await flush();
 take().click(); await flush();
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


test("desktop renewal skips hidden ticks and resumes once without requiring focus", async () => {
  let hidden = false;
  const visibility = vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  panelOpen = true; mounted.show(); await flush();
  hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  const before = api.desktopRenew.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(api.desktopRenew.mock.calls.length).toBe(before);
  hidden = false; document.dispatchEvent(new Event("visibilitychange")); await flush();
  expect(api.desktopRenew.mock.calls.length).toBe(before + 1);
  window.dispatchEvent(new Event("blur"));
  // An unchanged lease backs off up to ten seconds; losing focus must not stop it.
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(api.desktopRenew.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
  visibility.mockRestore();
});


test('an absent remote host never offers a local Docker download', async () => {
  panelOpen = true;
  api.settingsGet.mockResolvedValue({settings:{computer_ssh_alias:"studio-mini"}});
  api.desktopStatus.mockResolvedValue({state:'unavailable',ready:false,control:'member',host:'studio-mini',error:'remote_unavailable'});
  mounted.show(); await flush();
  expect(panel().querySelector('[data-act="docker-download"]')).toBeNull();
  // The host name is no longer written on the screen; the location menu still names where the computer lives.
  expectBare(); expect(panel().querySelector('.desktop-placeholder')!.textContent).not.toContain('studio-mini');
  expect(panel().querySelector('[data-computer-location]')).not.toBeNull();
  expect(api.desktopOpen).not.toHaveBeenCalled();
  // The press only tries the remote stream again; nothing local is downloaded or started for it.
  enlarge().click(); await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(1); expect(api.core).not.toHaveBeenCalled();
  expect(panel().querySelector('[data-act="docker-download"]')).toBeNull();
});

test('Docker recovery waits for one press on the screen, uses the local host and reports readiness', async () => {
  panelOpen = true; api.desktopStatus.mockResolvedValue({state:'unavailable',ready:false,control:'member',host:'',error:'docker_stopped'});
  api.core.mockResolvedValue({state:'stopped',ready:false,control:'member',host:''});
  mounted.show(); await flush();
  expect(api.core).not.toHaveBeenCalled();
  // No Start Docker or Use remote button is drawn: the whole screen is the press.
  const button = panel().querySelector<HTMLButtonElement>('[data-desktop="retry"]')!;
  expect(button.hidden).toBe(true); expect(panel().querySelector('[data-desktop-location]')).toBeNull();
  expect(shownText(panel())).not.toContain(t('desktop.startDocker'));
  expect(enlarge().hidden).toBe(false);
  // A second press while the engine is starting changes nothing.
  enlarge().click(); enlarge().click(); await flush();
  expect(api.core).toHaveBeenCalledExactlyOnceWith('computer.viewer_status',{member_id:1,start_docker:true,host:''});
  expect(api.desktopOpen).not.toHaveBeenCalled();
  expect(panel().querySelector('.desktop-error')?.textContent).toBe(t('desktop.dockerReady'));
  expect(panel().querySelector('.desktop-error')?.getAttribute('role')).toBe('status');
});

test('new computer work opens Computer while an initial idle read leaves Details alone', async () => {
  api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'});
  mounted.show(); await flush();
  expect(panelOpen).toBe(false);
  api.desktopStatus.mockResolvedValue({...running,works:[{...work,state:'running'}]});
  await vi.advanceTimersByTimeAsync(4_000); await flush();
  expect(panelOpen).toBe(true);
});

test('an engine recovery reply cannot update another member after navigation', async () => {
  let resolve!: (value: DesktopState) => void;
  panelOpen = true; api.desktopStatus.mockResolvedValue({state:'unavailable',ready:false,control:'member',host:'',error:'docker_stopped'});
  api.core.mockImplementation(() => new Promise<DesktopState>(done => {resolve=done;}));
  mounted.show(); await flush();
  enlarge().click();
  member = 2; api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'}); mounted.refresh(); await flush();
  expect(enlarge().disabled).toBe(false); expect(enlarge().hasAttribute('data-asleep')).toBe(true);
  resolve(running); await flush();
  expect(panel().querySelector('.desktop-error')?.textContent).not.toBe(t('desktop.dockerReady'));
  expect(api.desktopOpen).not.toHaveBeenCalled();
});

test('a stream that never connects stays silent, waits after a while, and one press reopens it', async () => {
  panelOpen = true; mounted.show(); await flush();
  expectBareScreen(panel()); expect(panel().dataset.desktopState).toBe('connecting');
  expect(shownText(panel())).not.toContain(t('desktop.connecting'));
  await vi.advanceTimersByTimeAsync(20_000); await flush();
  // Stalled: still not a word on the screen, and no retry button; the screen is the press.
  expectBareScreen(panel());
  expect(panel().querySelector<HTMLButtonElement>('[data-desktop="retry"]')!.hidden).toBe(true);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  expect(enlarge().hidden).toBe(false);
  enlarge().click(); await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(2);
  expectBareScreen(panel());
  message('connected'); await flush();
  expect(panel().querySelector<HTMLElement>('.desktop-placeholder')!.hidden).toBe(true);
});

test('a stream that ends before it ever showed the screen, or says it cannot reach it, waits for a press instead of reopening', async () => {
  panelOpen = true; mounted.show(); await flush();
  message('unreachable'); await flush();
  expectBareScreen(panel());
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  enlarge().click(); await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(2);
  // The core finding the screen out of reach closes the stream and again waits for a press, not the next poll.
  api.desktopRenew.mockResolvedValue({ ...running, error: 'viewer_unreachable' });
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expectBareScreen(panel());
  expect(api.desktopClose).toHaveBeenCalledWith('one');
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(2);
});

test('the computer row follows asleep, connecting and awake, and holds the last picture of the screen', async () => {
  const states: DesktopState[] = [{ state:'stopped', ready:false, control:'member' }, { state:'starting', ready:false, control:'member' }];
  api.desktopStatus.mockResolvedValue(states[0]); panelOpen=false; rowOpen=true; mounted.show(); await flush();
  expect(computerRowOf(1)).toMatchObject({ member:1, state:'asleep' });
  api.desktopStatus.mockResolvedValue(states[1]); await vi.advanceTimersByTimeAsync(2000); await flush();
  expect(computerRowOf(1)?.state).toBe('connecting');
  // Running, the stream opens unseen so the row has a picture; it reads connecting until the screen is up.
  api.desktopStatus.mockResolvedValue(running); await vi.advanceTimersByTimeAsync(2000); await flush();
  expect(computerRowOf(1)?.state).toBe('connecting'); expect(frame()).not.toBeNull();
  message('connected'); expect(computerRowOf(1)).toMatchObject({ state:'awake' });
  expect(computerRowOf(1)?.picture).toBeUndefined();
  message('frame', { image:'data:image/jpeg;base64,AAAA' }); expect(computerRowOf(1)?.picture).toBe('data:image/jpeg;base64,AAAA');
});

test('a PC that cannot give a computer says so in the row with the one action that fixes it', async () => {
  rowOpen=true;
  const cases: [Partial<DesktopState>, string, string | undefined][] = [
    [{ state:'absent', error:'docker_missing' }, 'unavailable', 'download'],
    [{ state:'unavailable', error:'docker_stopped' }, 'unavailable', 'start'],
    [{ state:'unavailable', error:'remote_unavailable', host:'studio' }, 'unavailable', 'retry'],
    [{ state:'absent', error:'disabled' }, 'unavailable', 'retry'],
    // A missing image is a first start, not a fault: the row is asleep and the same press prepares it.
    [{ state:'missing', image:false }, 'asleep', undefined],
  ];
  for (const [partial, state, fix] of cases) {
    api.desktopStatus.mockResolvedValue({ ready:false, control:'member', ...partial } as DesktopState); mounted.refresh(); mounted.show(); await flush();
    expect(computerRowOf(1)?.state, JSON.stringify(partial)).toBe(state); expect(computerRowOf(1)?.fix, JSON.stringify(partial)).toBe(fix);
  }
  expect(api.desktopOpen).not.toHaveBeenCalled();
});

test('pressing the row wakes a sleeping computer and opens a running one large, the way the Computer tab does', async () => {
  api.desktopStatus.mockResolvedValue({ state:'stopped', ready:false, control:'member' }); rowOpen=true; mounted.show(); await flush();
  expect(api.desktopOpen).not.toHaveBeenCalled();
  rowOpen=false; panelOpen=true; mounted.watch(); await flush();
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  api.desktopStatus.mockResolvedValue(running); await vi.advanceTimersByTimeAsync(2000); await flush(); message('connected');
  mounted.watch(); await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(true); expect(document.documentElement.hasAttribute('data-desktop-watch')).toBe(true);
});

test('the pill reads watching with Take control, then you are in control with Stop, which hands the computer back', async () => {
  panelOpen=true; mounted.show(); await flush(); message('connected');
  enlarge().click(); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!.trim();
  expect(label()).toBe(t('desktop.watching')); expect(take().textContent).toBe(t('desktop.take')); expect(take().hidden).toBe(false);
  api.desktopControl.mockResolvedValue({ ...running, control:'owner' }); take().click(); await flush();
  expect(label()).toBe(t('desktop.taking'));
  message('interactive',{held:true}); await flush();
  expect(label()).toBe(t('desktop.operating')); expect(handback().textContent).toBe(t('desktop.release')); expect(handback().hidden).toBe(false);
  expect(t('desktop.release')).toBe('停止'); expect(t('desktop.operating')).toBe('你正在控制');
  api.desktopControl.mockResolvedValue(running); handback().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', false);
});
