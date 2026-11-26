// @vitest-environment happy-dom
import { navInputs, pressLayer } from "./test-support/nav-layer-input";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const api = vi.hoisted(() => ({ core:vi.fn(), agentAskText:vi.fn(), settingsGet:vi.fn(), settingsSet:vi.fn(), desktopMaintain:vi.fn(), desktopWallpaper:vi.fn(), desktopTeach:vi.fn(), desktopStatus:vi.fn(), desktopOpen:vi.fn(), desktopRenew:vi.fn(), desktopControl:vi.fn(), desktopClose:vi.fn(), ownerClipboardText:vi.fn(), ownerClipboardSequence:vi.fn(), desktopClipboard:vi.fn(), desktopPutFile:vi.fn() }));
vi.mock("./api", () => api);
import { defaultWallpaper, mountDesktopViewer, preparationHTML, type DesktopState } from "./desktop-viewer";
import { setLocale, t } from "./i18n";
import { faceHTML } from "./members";
import { computerStateText, computerUpdateLine } from './computer-state';
import { resetAsks } from './chat-ask';
const running: DesktopState = { state:"running", ready:true, control:"member" };
const work = { id:"task", request_id:"nonce", turn_id:42, state:"waiting_control", reason:"sign_in", tool:"get_desktop_state" } as const;
let host: HTMLElement, mounted: ReturnType<typeof mountDesktopViewer>, member = 1, panelOpen = false;
const chooseComputer = vi.fn(async (_transport: "host" | "docker") => {});
const flush = async (): Promise<void> => { for (let i=0; i<30; i++) await Promise.resolve(); };
const panel = (): HTMLElement => host.querySelector('.desktop-panel')!;
const frame = (): HTMLIFrameElement => host.querySelector('iframe')!;
const computerChoice = (): HTMLButtonElement => panel().querySelector("[data-computer-choice]")!;
const selectComputer = (value: string): void => {
  computerChoice().click();
  document.querySelector<HTMLButtonElement>(`[role="menuitemradio"][data-value="${value}"]`)!.click();
};
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
function message(state: string, extra = {}): void {
  dispatchMessage(state, extra);
  if (state === 'connected') dispatchMessage('painted');
}
function dispatchMessage(state: string, extra = {}): void { window.dispatchEvent(new MessageEvent('message', {source:frame().contentWindow, origin:'http://127.0.0.1:5000', data:{type:'raphael-desktop', state, ...extra}})); }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); setLocale('zh-TW'); member=1; panelOpen=false;
  api.core.mockResolvedValue({}); api.settingsGet.mockResolvedValue({settings:{computer_ssh_alias:""}});
  api.desktopStatus.mockResolvedValue(running); api.desktopRenew.mockResolvedValue(running); api.desktopClose.mockResolvedValue({});
  api.desktopOpen.mockResolvedValue({session:'one',url:'http://127.0.0.1:5000/one/vnc.html'});
  api.ownerClipboardSequence.mockResolvedValue(null); api.desktopClipboard.mockResolvedValue({put:true});
  host=document.createElement('aside'); host.innerHTML='<div class="mb-det-scroll"></div><ol><li data-desktop-slot="42"></li></ol>'; document.body.append(host);
  mounted=mountDesktopViewer(host,()=>member,{timeline:host.querySelector('ol')!,conversation:()=>11,name:()=>"小晴",face:()=>faceHTML({id:member,name:'Sample'},22),openPanel:()=>{panelOpen=true;},closePanel:()=>{panelOpen=false;},panelVisible:()=>panelOpen,trySkill:trySent,changed:waitChanged,chooseComputer});
});
afterEach(async()=>{mounted.hide(true);resetAsks();await flush();document.body.replaceChildren();vi.useRealTimers();});

test("interjects the computer choice and follows the member to the newly active transport", async () => {
  const hostState: DesktopState = {...running, transport:"host"};
  const dockerState: DesktopState = {...running, transport:"docker"};
  panelOpen = true;
  api.desktopStatus.mockResolvedValue(hostState);
  api.desktopRenew.mockResolvedValue(hostState);
  api.desktopOpen.mockResolvedValue({session:"chrome",url:"http://127.0.0.1:5000/chrome/host.html"});
  mounted.show(); await flush(); message("connected");
  selectComputer("docker");
  await flush();
  expect(chooseComputer).toHaveBeenLastCalledWith("docker");
  expect(api.desktopStatus).toHaveBeenLastCalledWith(1, 11, "docker");
  expect(api.desktopClose).not.toHaveBeenCalled();
  api.desktopOpen.mockResolvedValue({session:"isolated",url:"http://127.0.0.1:5000/isolated/vnc.html"});
  api.desktopRenew.mockResolvedValue(dockerState);
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(api.desktopClose).toHaveBeenCalledWith("chrome");
  expect(frame().src).toContain("/isolated/vnc.html");
  expect(computerChoice().textContent).toBe("虛擬機（本機）");
  expect(panel().querySelector("[data-desktop-permission]")).toBeNull();
});

test("only a Docker choice shows the missing-Docker line and asks the member, by its name, through the existing intent", async () => {
  const hostState: DesktopState = {...running, transport:"host"};
  const missing: DesktopState = {state:"absent", ready:false, control:"member", transport:"docker", error:"docker_missing"};
  panelOpen = true;
  api.desktopStatus.mockImplementation(async (_id, _conversation, transport) => transport === "docker" ? missing : hostState);
  api.desktopRenew.mockResolvedValue(hostState);
  api.desktopOpen.mockResolvedValue({session:"chrome",url:"http://127.0.0.1:5000/chrome/host.html"});
  mounted.show(); await flush();
  expect(computerChoice().textContent).toBe("這台電腦");
  expect(panel().querySelector("[data-docker-help]")).toBeNull();
  expect(panel().querySelectorAll(".desktop-location-header button[aria-haspopup]:not([hidden])")).toHaveLength(1);
  selectComputer("docker"); await flush();
  expect(computerChoice().textContent).toBe("虛擬機（本機）");
  expect(frame().src).toContain("/chrome/host.html");
  const help = panel().querySelector<HTMLButtonElement>("[data-docker-help]")!;
  // The member whose computer this is installs it, and the button calls it by its own name.
  expect(help.textContent).toBe("請 小晴 安裝");
  expect(help.parentElement!.textContent).toBe("尚未安裝 Docker 請 小晴 安裝");
  expect(panel().querySelector('[data-act="docker-download"]')).toBeNull();
  help.click(); help.click(); await flush();
  expect(api.agentAskText).toHaveBeenCalledExactlyOnceWith(t("memberComputer.setup"), [], 1, {intent:"setup-docker"});
  selectComputer("host"); await flush();
  expect(computerChoice().textContent).toBe("這台電腦");
  expect(panel().querySelector("[data-docker-help]")).toBeNull();
});

test("the same Docker menu names its SSH host and can save the local location", async () => {
  panelOpen = true;
  api.desktopStatus.mockResolvedValue({...running, transport:"docker", host:"studio-mini"});
  api.settingsGet.mockResolvedValue({settings:{computer_ssh_alias:"studio-mini"}});
  api.settingsSet.mockResolvedValue({settings:{computer_ssh_alias:""}});
  mounted.show(); await flush();
  expect(computerChoice().textContent).toBe("虛擬機（studio-mini）");
  computerChoice().click();
  expect(document.querySelector('[data-value="docker-remote"][aria-checked="true"]')?.textContent).toContain("studio-mini");
  document.querySelector<HTMLButtonElement>('[data-value="docker-local"]')!.click();
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("computer_ssh_alias", "");
  expect(computerChoice().textContent).toBe("虛擬機（本機）");
  expect(chooseComputer).not.toHaveBeenCalled();
});

test('the host sign-in card uses the canvas transport and returns its live request from the shared panel', async () => {
  const hostState: DesktopState = {...running, transport:'host', host_request:work};
  api.desktopStatus.mockResolvedValue(hostState);
  api.desktopRenew.mockResolvedValue(hostState);
  api.desktopOpen.mockResolvedValue({session:'one',url:'http://127.0.0.1:5000/one/host.html'});
  host.querySelector('ol')!.insertAdjacentHTML('beforeend', '<div data-card-screen></div>');
  mounted.show();
  await flush();
  expect(api.desktopOpen).toHaveBeenCalledWith(1, {conversation_id:11,transport:"host",target_id:undefined});
  expect(frame().src).toBe('http://127.0.0.1:5000/one/host.html');
  expect(frame().closest('.desktop-screen')).not.toBeNull();
  message('connected');
  api.desktopControl.mockResolvedValueOnce({...hostState,control:'owner'});
  mounted.takeover();
  await flush();
  message('interactive', {held:true});
  expect(panel().dataset.interactive).toBe('true');
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', true, 'nonce');
  message('input-accepted');
  message('input-accepted');
  expect(panel().dataset.interactive).toBe('true');
  expect(api.desktopClose).not.toHaveBeenCalled();
  api.desktopControl.mockResolvedValueOnce({...running,transport:'host'});
  handback().click();
  await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', false, 'nonce');
  expect(mounted.waitingForOwner(42)).toBe(false);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('Chrome work opens the Computer tab, puts no card in the conversation, and the owner can take the tab like Docker', async () => {
  const hostState: DesktopState = {
    ...running, transport: 'host', target: 'page',
    works: [{ ...work, id: 'page', transport: 'host', state: 'running', request_id: undefined, reason: '' }],
  };
  api.desktopStatus.mockResolvedValue({...running, transport: 'host'});
  api.desktopRenew.mockResolvedValue(hostState);
  api.desktopOpen.mockResolvedValue({session:'one',url:'http://127.0.0.1:5000/one/host.html'});
  mounted.show();
  await flush();
  api.desktopStatus.mockResolvedValue(hostState);
  mounted.refreshStatus();
  await flush();
  expect(panelOpen).toBe(true);
  expect(host.querySelector('[data-desktop-work]')).toBeNull();
  mounted.sync();
  await flush();
  expect(api.desktopOpen).toHaveBeenCalledWith(1, {conversation_id:11,transport:'host',target_id:'page'});
  message('connected');
  message('frame', {image:'data:image/jpeg;base64,AAAA'});
  expect(host.querySelector('[data-desktop-work]')).toBeNull();
  expect(api.desktopControl).not.toHaveBeenCalled();
  api.desktopControl.mockResolvedValue({...hostState, control:'owner'});
  enlarge().click(); await flush();
  expect(take().hidden).toBe(false);
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenCalledWith('one', true);
  hostState.works![0]!.state = 'done';
  mounted.refreshStatus();
  await flush();
  expect(host.querySelector('[data-desktop-work]')).toBeNull();
});

test.each(navInputs)("%s folds the watching view without changing control", async input => {
  panelOpen = true;
  mounted.show(); await flush(); message("connected");
  enlarge().click(); await flush();
  pressLayer(input, "forward");
  expect(panel().hasAttribute("data-expanded")).toBe(true);
  pressLayer(input);
  expect(panel().hasAttribute("data-expanded")).toBe(false);
  expect(api.desktopControl).not.toHaveBeenCalled();
});

test('the captioned preview opens the larger view to watch the same stream, Esc folds it back without control, and another member starts small', async () => {
  panelOpen=true; mounted.show(); await flush();
  expect(enlarge().hidden).toBe(false); expect(take().hidden).toBe(true);
  expect(enlarge().getAttribute('aria-label')).toBe('開啟大畫面');
  expect(panel().querySelector('.desktop-open-pill')?.textContent).toBe('開啟');
  // Nothing is written over the screen or under it, not even before the stream is up.
  expectBareScreen(panel());
  message('connected');
  expect(panel().querySelector<HTMLElement>('.computer-lifecycle-state')!.hidden).toBe(true);
  expect(panel().querySelector('[data-computer-state-text]')).toBeNull();
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

test('watching shows one pill and no Stop of the work beside it: the conversation stops work', async () => {
  panelOpen=true;
  api.desktopStatus.mockResolvedValue({...running,works:[{...work,state:'running',tool:'type_text'}]});
  mounted.show(); await flush(); message('connected');
  enlarge().click();
  expect(panel().querySelector('.desktop-dock .desktop-mode-label')?.textContent).toBe('觀看中');
  expect(panel().querySelector('[data-desktop="stop"]')).toBeNull();
  expect([...panel().querySelectorAll<HTMLElement>('.desktop-dock > .btn:not([hidden])')].map(button => button.dataset.desktop)).toEqual([]);
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

test('a lease the screen never confirms is not called control: 正在接手, then watching again without a panel error', async () => {
  api.desktopStatus.mockResolvedValue({...running,works:[work]});
  api.desktopControl.mockResolvedValueOnce({...running,control:'owner',works:[work]}).mockResolvedValueOnce({...running,works:[work]});
  mounted.show(); await flush(); message('connected');
  // The core holds the lease for the owner all along; only the screen never says it took the owner's input.
  api.desktopRenew.mockResolvedValue({...running,control:'owner',works:[work]});
  host.querySelector<HTMLButtonElement>('[data-card-desktop="take"].pri')!.click(); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!;
  expect(label()).toBe('正在接手…'); expect(panel().dataset.interactive).toBe('false');
  await vi.advanceTimersByTimeAsync(5_000); await flush();
  expect(label()).toBe('正在接手…');
  await vi.advanceTimersByTimeAsync(1_500); await flush();
  // Given back without the request id: a failed take is not 我完成了.
  expect(api.desktopControl.mock.calls.filter(([,held])=>!held)).toEqual([['one',false]]);
  expect(label()).toBe('觀看中'); expect(document.documentElement.hasAttribute('data-desktop-watch')).toBe(true);
  expect(panel().querySelector<HTMLElement>('.desktop-notice')!.hidden).toBe(true);
  expect(api.core).toHaveBeenCalledWith('computer.viewer_status', expect.objectContaining({viewer_problem:'pass control through the viewer'}));
  // Back with the member, Take control offers one more try.
  api.desktopRenew.mockResolvedValue({...running,works:[work]});
  await vi.advanceTimersByTimeAsync(10_000); await flush();
  expect(take().hidden).toBe(false); expect(take().disabled).toBe(false);
});

test('enlarging a screen whose lease was not confirmed keeps watching without changing the lease', async () => {
  api.desktopStatus.mockResolvedValue({...running,control:'owner'});
  panelOpen=true; mounted.show(); await flush(); message('connected');
  const before=api.desktopControl.mock.calls.length;
  host.querySelector<HTMLButtonElement>('[data-desktop="enlarge"]')!.click();
  expect(panel().dataset.interactive).toBe('false');
  expect(panel().querySelector('.desktop-mode-label')!.textContent).toBe('觀看中');
  expect(api.desktopControl.mock.calls).toHaveLength(before);
});

test('watching always offers Take control, whoever the core says holds the lease: one press takes it again', async () => {
  panelOpen=true; mounted.show(); await flush(); message('connected');
  enlarge().click(); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!.trim();
  // An earlier take-over's lease that the core still keeps for this session, while the view only watches.
  api.desktopRenew.mockResolvedValue({ ...running, control:'owner' });
  await vi.advanceTimersByTimeAsync(2_500); await flush();
  expect(label()).toBe(t('desktop.watching'));
  expect(take().hidden).toBe(false); expect(take().disabled).toBe(false);
  expect(panel().dataset.interactive).toBe('false');
  api.desktopControl.mockResolvedValue({ ...running, control:'owner' });
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', true);
  expect(label()).toBe(t('desktop.taking'));
  message('interactive', { held:true }); await flush();
  expect(label()).toBe(t('desktop.operating')); expect(take().hidden).toBe(true);
});

test.each(['interrupted', 'stopped', 'draft'])('a %s demonstration left on the computer never takes Take control away from a pill that watches', async leftOver => {
  // The core recovers every unfinished recording from the member's home and reports it with each status, long after
  // the window that made it is gone (a recording the app was closed on, a draft nobody reviewed).
  const status = { ...running, teach_available: true, teaching: { id: 'old', state: leftOver, text: '', conversation_id: 11 } };
  api.desktopStatus.mockResolvedValue(status); api.desktopRenew.mockResolvedValue(status);
  panelOpen=true; mounted.show(); await flush(); message('connected');
  enlarge().click(); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!.trim();
  expect(label()).toBe(t('desktop.watching'));
  expect(take().hidden).toBe(false); expect(take().disabled).toBe(false);
  api.desktopControl.mockResolvedValue({ ...status, control:'owner' });
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', true);
  expect(label()).toBe(t('desktop.taking'));
  message('interactive', { held:true }); await flush();
  expect(label()).toBe(t('desktop.operating'));
  // Holding the computer, the leftover can be discarded from the same pill's foot.
  expect(host.querySelector<HTMLElement>('[data-desktop="discard-teach"]')!.hidden).toBe(false);
});

test('a take the core is still deciding reads 正在接手…, and one it refuses leaves Take control to press again', async () => {
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
  expect(panel().querySelector<HTMLElement>('.desktop-notice')!.hidden).toBe(true);
  api.desktopControl.mockResolvedValue({ ...running, control:'owner' });
  take().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', true); expect(label()).toBe(t('desktop.taking'));
});

test('a lease the core gave back is not kept on screen: the pill watches, input stops and Take control returns', async () => {
  panelOpen=true; mounted.show(); await flush(); message('connected');
  api.desktopControl.mockResolvedValue({ ...running, control:'owner' });
  await takeOver(); message('interactive', { held:true }); await flush();
  const label = (): string => panel().querySelector('.desktop-mode-label')!.textContent!.trim();
  expect(label()).toBe(t('desktop.operating')); expect(frame().style.pointerEvents).toBe('auto');
  // The core released it (nothing was typed for a long while): the next renewal says so.
  api.desktopRenew.mockResolvedValue(running);
  await vi.advanceTimersByTimeAsync(2_500); await flush();
  expect(label()).toBe(t('desktop.watching')); expect(panel().dataset.interactive).toBe('false');
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

test("the larger view keeps the review and one foot inside the screen's shell, and the draft is said once",async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  const shell = panel().querySelector('.desktop-shell')!, foot = shell.querySelector(':scope > .desktop-foot')!;
  // R-PANEL-08: the screen, the boxes that take its place and the foot are one column; nothing of the computer sits outside it.
  expect([...shell.children].map(child => child.className)).toEqual(['desktop-screen', 'desktop-caption', 'desktop-review', 'desktop-foot']);
  expect([...foot.querySelectorAll(':scope > .desktop-notes > *')].map(child => child.className)).toEqual(['desktop-request', 'desktop-notice', 'desktop-recording', 'desktop-teach-missing', 'desktop-try']);
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
  expect(host.querySelector('.desktop-teach-missing')!.textContent).toContain('各自的電腦');
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
test('Take control changes input in place without replacing the frame, URL or session',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');const same=frame(),url=same.src;
  api.desktopControl.mockResolvedValue({...running,control:'owner'});await takeOver();message('interactive',{held:true});
  expect(api.desktopControl).toHaveBeenCalledWith('one',true);expect(frame()).toBe(same);expect(frame().src).toBe(url);
  expect(frame().style.pointerEvents).toBe('auto');expect(panel().dataset.interactive).toBe('true');expect(handback().textContent).toBe('停止');
  api.desktopControl.mockResolvedValue(running);handback().click();handback().click();await flush();
  // Stop hands the computer back once and nothing else: the stream is neither closed nor reopened.
  expect(api.desktopControl.mock.calls.filter(call=>call[1]===false)).toHaveLength(1);expect(api.desktopClose).not.toHaveBeenCalled();
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(frame()).toBe(same);expect(frame().src).toBe(url);
});
test('ending control keeps watching: the larger view, the stream and the live frame stay, the pill reads 觀看中 and 接手控制 is offered again',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  api.desktopControl.mockResolvedValue({...running,control:'owner'});await takeOver();message('interactive',{held:true});
  expect(panel().querySelector('.desktop-mode-label')!.textContent).toBe('你正在控制');expect(handback().textContent).toBe('停止');
  const same=frame();
  api.desktopControl.mockResolvedValue(running);handback().click();await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one',false);
  expect(panel().hasAttribute('data-expanded')).toBe(true);expect(document.documentElement.hasAttribute('data-desktop-watch')).toBe(true);
  expect(frame()).toBe(same);expect(frame().hidden).toBe(false);expect(panel().dataset.interactive).toBe('false');
  expect(panel().querySelector('.desktop-mode-label')!.textContent).toBe('觀看中');
  expect(take().hidden).toBe(false);expect(take().disabled).toBe(false);expect(handback().hidden).toBe(true);
  expect(api.desktopClose).not.toHaveBeenCalled();expect(api.desktopOpen).toHaveBeenCalledTimes(1);expect(panelOpen).toBe(true);
  // Watching again: Take control works on the same stream, and Esc is what folds the view back.
  api.desktopControl.mockResolvedValue({...running,control:'owner'});take().click();await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one',true);expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  message('interactive',{held:true});api.desktopControl.mockResolvedValue(running);handback().click();await flush();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(false);expect(api.desktopClose).not.toHaveBeenCalled();expect(frame()).toBe(same);
});
test('a stop the core refuses leaves the owner in control: the pill and the screen say so and Stop is offered again',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  api.desktopControl.mockResolvedValue({...running,control:'owner'});await takeOver();message('interactive',{held:true});
  api.desktopControl.mockRejectedValueOnce(new Error('desktop busy'));handback().click();await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(true);expect(document.documentElement.hasAttribute('data-desktop-watch')).toBe(false);
  message('interactive',{held:true});
  expect(panel().querySelector('.desktop-mode-label')!.textContent).toBe('你正在控制');expect(handback().hidden).toBe(false);expect(take().hidden).toBe(true);
  expect(api.desktopClose).not.toHaveBeenCalled();
});
test('explicit done includes the current nonce once; close never sends handback',async()=>{
  api.desktopStatus.mockResolvedValue({...running,works:[work]});mounted.show();await flush();message('connected');
  expect(host.querySelector('.desktop-request')!.textContent).toContain('登入');
  api.desktopControl.mockResolvedValue({...running,control:'owner',works:[work]});host.querySelector<HTMLButtonElement>('[data-card-desktop="take"].pri')!.click();await flush();
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
  expect(panel().querySelector<HTMLElement>('.computer-lifecycle-state')!.hidden).toBe(true);
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
  expect(api.desktopOpen).not.toHaveBeenCalled();
  if (snapshot.error === 'remote_unavailable') {
    expect(api.core).toHaveBeenCalledExactlyOnceWith('computer.viewer_status',
      expect.objectContaining({viewer_problem:'show the screen'}));
    api.core.mockClear();
  } else expect(api.core).not.toHaveBeenCalled();
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
test('a renewal started before Take control cannot overwrite the acquired lease',async()=>{
  panelOpen=true;mounted.show();await flush();message('connected');
  let finish!:(value:DesktopState)=>void;api.desktopRenew.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await vi.advanceTimersByTimeAsync(2000);
  api.desktopControl.mockResolvedValue({...running,control:'owner'});await takeOver();message('interactive',{held:true});
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
  expect(panel().dataset.interactive).toBe('false');expect(panel().querySelector<HTMLElement>('.desktop-notice')!.hidden).toBe(true);
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

// R-COMP-UPDATE-01: an update of the computer's image can take minutes, so it is said in one state line under the
// screen, with how long it may take; the screen itself stays as bare as R-UI-93 has it, and nothing is a notice.
test.each(['building','preparing','starting'] as const)('an update says so in one line under the screen while it is %s, and the line goes with it',async state=>{
  panelOpen=true;api.desktopStatus.mockResolvedValue({state,ready:false,control:'member',update:true,progress:'#12 [12/21] RUN apt-get install'});mounted.show();await flush();
  const caption=panel().querySelector<HTMLElement>('.desktop-caption')!;
  expect(caption.hidden).toBe(false); expect(caption.textContent).toBe(t('desktop.updateLine')); expect(caption.getAttribute('role')).toBe('status');
  expect(panel().hasAttribute('data-desktop-update')).toBe(true); expect(panel().dataset.desktopState).toBe(state);
  expect(caption.closest('.desktop-screen')).toBeNull(); expectBareScreen(panel());
  expect(panel().querySelector<HTMLElement>('.computer-lifecycle-state')!.hidden).toBe(true);
  expect(panel().querySelector<HTMLElement>('.desktop-notice')!.hidden).toBe(true);
  expect(shownText(panel())).not.toContain('#12'); expect(enlarge().hidden).toBe(true); expect(api.desktopOpen).not.toHaveBeenCalled();
  // An unchanged renewal writes nothing, the line included.
  const observer=new MutationObserver(()=>{}); observer.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
  await vi.advanceTimersByTimeAsync(2000); await flush(); expect(observer.takeRecords()).toHaveLength(0); observer.disconnect();
  api.desktopStatus.mockResolvedValue(running); await vi.advanceTimersByTimeAsync(4000); await flush();
  expect(caption.hidden).toBe(true); expect(panel().hasAttribute('data-desktop-update')).toBe(false);
});
test.each(['zh-TW','en','ja'] as const)('in %s the update line is its own sentence of the language',locale=>{
  setLocale(locale);
  expect(computerUpdateLine({state:'building',ready:false,control:'member',update:true})).toBe(t('desktop.updateLine'));
  expect(t('desktop.updateLine')).not.toBe('desktop.updateLine');
  for (const quiet of [{state:'building'},{state:'preparing'},{state:'running',update:true},{state:'stopped',update:true}] as const)
    expect(computerUpdateLine({...quiet,ready:false,control:'member'} as DesktopState)).toBe('');
});
test('a maintenance press while the computer is being updated answers with the update and shows no failure',async()=>{
  const updating: DesktopState = {...maintenanceState,state:'building',ready:false,update:true};
  panelOpen=true;api.desktopStatus.mockResolvedValue(updating);api.desktopMaintain.mockResolvedValue(updating);mounted.show();await flush();
  menuPick(1);await flush();
  expect(api.desktopMaintain).toHaveBeenCalledExactlyOnceWith(1,'restart',updating,false);
  expect(panel().querySelector<HTMLElement>('.desktop-notice')!.hidden).toBe(true);
  expect(panel().querySelector<HTMLElement>('.desktop-caption')!.textContent).toBe(t('desktop.updateLine'));
  expect(panel().dataset.desktopState).toBe('building'); expect(api.desktopOpen).not.toHaveBeenCalled();
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
test.each(['data-card-desktop-screen','data-card-screen'])('the owner picture replaces the default picture on the panel and the %s card',async attribute=>{
 panelOpen=true; api.desktopWallpaper.mockResolvedValue({image:OWN_PICTURE});
 const inline=document.createElement('div'); inline.setAttribute(attribute,''); host.querySelector('ol')!.append(inline);
 api.desktopStatus.mockResolvedValue({state:'starting',ready:false,control:'member'}); mounted.show(); await flush();
 for (const picture of [panel().querySelector('.desktop-wallpaper'),inline.querySelector('.desktop-wallpaper')]) {
  expect(picture?.getAttribute('src')).toBe(OWN_PICTURE);
  expect(picture?.hasAttribute('data-own')).toBe(true);
 }
});

test('the picture is read once and a failed read keeps the default picture without any owner marking',async()=>{
 panelOpen=true; api.desktopWallpaper.mockRejectedValue(new Error('Synthetic read failure'));
 mounted.show(); await flush(); mounted.hide(); await flush(); mounted.show(); await flush();
 const picture=panel().querySelector('.desktop-wallpaper')!;
 expect(picture.getAttribute('src')).toMatch(/^\/wallpapers\/(day|night)\.jpg$/);
 expect(picture.hasAttribute('data-own')).toBe(false);
 expect(api.desktopWallpaper).toHaveBeenCalledTimes(1);
});

// R-UI-92: the same hours as wallpaper.py in the computer, by the window's clock, which is the zone the core gives the
// computer (members.viewing sends this window's Intl zone; the tests run in Asia/Taipei, vitest.config.ts).
test.each([['05:59','night'],['06:00','day'],['17:59','day'],['18:00','night']])('at %s the default picture is the %s one, on the panel and in the computer alike',async(time,expected)=>{
 expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
 const at=new Date(`2026-11-14T${time}:00+08:00`).getTime();
 expect(defaultWallpaper(at)).toBe(`/wallpapers/${expected}.jpg`);
 vi.setSystemTime(at); panelOpen=true; api.desktopWallpaper.mockResolvedValue({});
 api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'}); mounted.show(); await flush();
 expect(panel().querySelector('.desktop-wallpaper')?.getAttribute('src')).toBe(`/wallpapers/${expected}.jpg`);
});

test('an open panel turns to the night picture at 18:00 without being opened again',async()=>{
 vi.setSystemTime(new Date('2026-11-14T17:59:58+08:00')); panelOpen=true; api.desktopWallpaper.mockResolvedValue({});
 api.desktopStatus.mockResolvedValue({state:'stopped',ready:false,control:'member'}); mounted.show(); await flush();
 const picture=panel().querySelector('.desktop-wallpaper')!;
 expect(picture.getAttribute('src')).toBe('/wallpapers/day.jpg');
 await vi.advanceTimersByTimeAsync(5000); await flush();
 expect(picture.getAttribute('src')).toBe('/wallpapers/night.jpg');
 expect(api.desktopWallpaper).toHaveBeenCalledTimes(1);
});

test('the default picture never flashes before the picture read answers',async()=>{
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
 expect(api.desktopOpen).toHaveBeenCalledTimes(1); dispatchMessage('connected');
 expect(panel().querySelector<HTMLImageElement>('.desktop-wallpaper')!.hidden).toBe(false);
 expect(frame().hidden).toBe(true);
 dispatchMessage('painted');
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
  expect(computerChoice()).not.toBeNull();
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
  expect(panel().querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!.hidden).toBe(false);
});
test.each(['docker', 'host'] as const)('the small %s panel never takes page input or shows a control pill', async transport => {
  panelOpen = true;
  api.desktopStatus.mockResolvedValue({...running, transport});
  mounted.show(); await flush();
  message('connected');
  expect(frame().style.pointerEvents).toBe('none');
  expect(frame().tabIndex).toBe(-1);
  expect(panel().querySelector<HTMLElement>('.desktop-mode')!.hidden).toBe(true);
  expect(take().hidden).toBe(true);
  expect(handback().hidden).toBe(true);
  message('take-input');
  take().click();
  await flush();
  expect(api.desktopControl).not.toHaveBeenCalled();
  enlarge().click();
  expect(frame().style.pointerEvents).toBe('none');
  message('take-input');
  expect(api.desktopControl).not.toHaveBeenCalled();
});

test('the host toolbar sends an address from the view-only panel before the first picture', async () => {
  panelOpen = true;
  api.desktopStatus.mockResolvedValue({...running, transport:'host'});
  mounted.show(); await flush();
  const post = vi.fn();
  Object.defineProperty(frame(), 'contentWindow', {configurable:true, value:{postMessage:post}});
  dispatchMessage('connected');
  message('browser', {model:{shown:'work', tabs:[{id:'work', title:'Work', url:'about:blank', favicon:''}], back:true, forward:true}});
  const address = panel().querySelector<HTMLInputElement>('.host-browser-address')!;
  address.value = 'https://example.test/next';
  address.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}));
  expect(post).toHaveBeenCalledWith({type:'raphael-desktop-browser-action',
    action:{action:'navigate', tab:'work', url:'https://example.test/next'}, id:expect.any(Number)}, 'http://127.0.0.1:5000');
  expect(api.desktopControl).not.toHaveBeenCalled();
  expect(frame().hidden).toBe(true);
});

test('taking a host tab with a dialog open leaves the keys in the dialog, even once the page focuses itself', async () => {
  panelOpen = true;
  api.desktopStatus.mockResolvedValue({...running, transport:'host'});
  mounted.show(); await flush();
  message('connected');
  const dialog = {dialog_id:'p1', type:'prompt', message:'Enter the code'};
  message('browser', {model:{shown:'work', tabs:[{id:'work', title:'Work', url:'https://example.test', favicon:''}], back:false, forward:false, dialog}});
  api.desktopControl.mockResolvedValueOnce({...running, transport:'host', control:'owner'});
  await takeOver();
  const answer = (): HTMLInputElement | null => panel().querySelector<HTMLInputElement>('.host-browser-dialog-answer');
  expect(answer()?.disabled).toBe(false);
  expect(document.activeElement).toBe(answer());
  // The page confirms the lease and focuses its own input, which would take the keys into the frame.
  frame().focus();
  message('interactive', {held:true});
  expect(document.activeElement).toBe(answer());
});

test.each(['button', 'escape', ...navInputs] as const)('%s folds a held screen and releases its input lease', async input => {
  panelOpen = true; mounted.show(); await flush(); message('connected');
  api.desktopControl.mockResolvedValueOnce({...running, control:'owner'}).mockResolvedValueOnce(running);
  await takeOver(); message('interactive', {held:true});
  const stream = frame(), collapse = panel().querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!;
  expect(collapse.hidden).toBe(false);
  if (input === 'button') collapse.click();
  else if (input === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));
  else pressLayer(input);
  await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(false);
  expect(panel().dataset.interactive).toBe('false');
  expect(panel().querySelector<HTMLElement>('.desktop-mode')!.hidden).toBe(true);
  expect(frame()).toBe(stream);
  expect(frame().style.pointerEvents).toBe('none');
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  expect(api.desktopControl.mock.calls).toEqual([['one', true], ['one', false]]);
});

test('folding during takeover releases the lease as soon as the take answers', async () => {
  panelOpen = true; mounted.show(); await flush(); message('connected');
  let grant!: (value: DesktopState) => void;
  api.desktopControl.mockImplementationOnce(() => new Promise<DesktopState>(resolve => { grant = resolve; }))
    .mockResolvedValueOnce(running);
  await takeOver();
  panel().querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!.click();
  expect(panel().dataset.interactive).toBe('false');
  grant({...running, control:'owner'}); await flush();
  expect(panel().hasAttribute('data-expanded')).toBe(false);
  expect(api.desktopControl.mock.calls).toEqual([['one', true], ['one', false]]);
});

test('folding a pending takeover keeps the card and its explicit Done action', async () => {
  const waiting = {...running, works:[work]};
  api.desktopStatus.mockResolvedValue(waiting);
  api.desktopControl.mockResolvedValueOnce({...waiting, control:'owner'}).mockResolvedValueOnce(waiting)
    .mockResolvedValueOnce(running);
  mounted.show(); await flush(); message('connected');
  host.querySelector<HTMLButtonElement>('[data-card-desktop="take"].pri')!.click(); await flush();
  message('interactive', {held:true});
  panel().querySelector<HTMLButtonElement>('[data-desktop="collapse"]')!.click(); await flush();
  expect(api.desktopControl.mock.calls).toEqual([['one', true, 'nonce'], ['one', false]]);
  expect(mounted.waitingForOwner(work.turn_id)).toBe(true);
  expect(panelOpen).toBe(true);
  expect(panel().dataset.interactive).toBe('false');
  expect(shownText(host.querySelector('.computer-card')!)).toContain('需要你');
  expect(host.querySelector('[data-card-desktop="take"].pri')).not.toBeNull();
  host.querySelector<HTMLButtonElement>('[data-card-desktop="return"]')!.click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith('one', false, 'nonce');
  expect(mounted.waitingForOwner(work.turn_id)).toBe(false);
});

test.each(['host', 'docker'] as const)('the %s wallpaper stays until the current stream paints', async transport => {
  panelOpen = true;
  api.desktopStatus.mockResolvedValue({...running, transport, target:'live-target'});
  mounted.show(); await flush();
  const wallpaper = panel().querySelector<HTMLImageElement>('.desktop-wallpaper')!;
  expect(wallpaper.hidden).toBe(false);
  for (let attach = 0; attach < 2; attach++) {
    dispatchMessage('connected');
    expect(wallpaper.hidden).toBe(false);
    expect(frame().hidden).toBe(true);
    dispatchMessage('painted');
    expect(frame().hidden).toBe(false);
  }
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
 expect(host.querySelector('.computer-card')).toBeNull();
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

test('a private owner request keeps its live card without caching a picture in the details panel',async()=>{
 api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
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

test('an unchanged stopped status touches nothing after a running stream stops',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 const stopped = {state:'stopped',ready:false,control:'member'};
 api.desktopRenew.mockResolvedValue(stopped);
 api.desktopStatus.mockResolvedValue(stopped);
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

test('a member without a computer retains the computer choice without starting one',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({state:'missing',ready:false,control:'member'}); mounted.show(); await flush();
 expect(panel().hidden).toBe(false); expect(computerChoice()).not.toBeNull(); expect(api.desktopOpen).not.toHaveBeenCalled();
});

test('completing a sign-in request restores the compact conversation even when takeover began in its preview',async()=>{
 panelOpen=true; api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValueOnce({...running,control:'owner',works:[work]}).mockResolvedValueOnce({...running,works:[{...work,state:'returning'}]});
 await takeOver(); handback().click(); await flush();
 expect(panelOpen).toBe(false);
});

test('Stop can be followed by a fresh takeover on the same stream, with no reconnect',async()=>{
 panelOpen=true; mounted.show(); await flush(); message('connected');
 api.desktopControl.mockResolvedValue({...running,control:'owner'}); await takeOver();
 api.desktopControl.mockResolvedValue(running); handback().click(); await flush();
 expect(panel().querySelector('.desktop-placeholder')!.textContent).not.toContain('正在連線');
 expect(take().hidden).toBe(false); expect(take().disabled).toBe(false); expect(enlarge().hidden).toBe(true);
 api.desktopControl.mockResolvedValue({...running,control:'owner'});
 take().click(); await flush();
 expect(api.desktopOpen).toHaveBeenCalledTimes(1);
 expect(api.desktopControl).toHaveBeenLastCalledWith('one',true);
 expect(api.desktopControl).toHaveBeenCalledTimes(3);
});

test("a running computer's panel streams again after a handback that leaves it open, never a black frame with only 開啟",async()=>{
 const width = window.innerWidth; Object.defineProperty(window,'innerWidth',{value:1920,configurable:true});
 try {
  panelOpen=true; api.desktopStatus.mockResolvedValue({...running,works:[work]}); mounted.show(); await flush(); message('connected');
  api.desktopControl.mockResolvedValueOnce({...running,control:'owner',works:[work]}).mockResolvedValueOnce(running);
  await takeOver();
  api.desktopOpen.mockResolvedValue({session:'two',url:'http://127.0.0.1:5000/two/vnc.html'});
  handback().click(); await flush();
  // The view folds back, the wide panel stays open on the Computer tab, and its preview is the stream again.
  expect(panel().hasAttribute('data-expanded')).toBe(false); expect(panelOpen).toBe(true);
  expect(api.desktopClose).toHaveBeenCalledWith('one'); expect(api.desktopOpen).toHaveBeenCalledTimes(2);
  expect(frame().getAttribute('src')).toBe('http://127.0.0.1:5000/two/vnc.html');
  message('connected'); await flush();
  expect(frame().hidden).toBe(false); expect(panel().dataset.desktopState).toBe('member');
 } finally { Object.defineProperty(window,'innerWidth',{value:width,configurable:true}); }
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
  expect(computerChoice().textContent).toContain("studio-mini");
  expect(api.desktopOpen).not.toHaveBeenCalled();
  expect(api.core).toHaveBeenCalledExactlyOnceWith('computer.viewer_status',
    expect.objectContaining({viewer_problem:'show the screen'}));
  api.core.mockClear();
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
  expect(panel().querySelector('.desktop-notice')?.textContent).toBe(t('desktop.dockerReady'));
  expect(panel().querySelector('.desktop-notice')?.getAttribute('role')).toBe('status');
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
  expect(panel().querySelector('.desktop-notice')?.textContent).not.toBe(t('desktop.dockerReady'));
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

test('a running computer is not streamed while its Computer tab is closed: Details carries no computer', async () => {
  // The computer lives in the third tab only, so no stream is opened unseen for another view of the panel.
  api.desktopStatus.mockResolvedValue(running); mounted.show(); await vi.advanceTimersByTimeAsync(2000); await flush();
  expect(api.desktopOpen).not.toHaveBeenCalled(); expect(host.querySelector('iframe')).toBeNull();
});

test.each(['host', 'docker'] as const)('returning from Details immediately shows the running %s computer', async transport => {
  const state: DesktopState = {...running, transport, target:'live-target'};
  api.desktopStatus.mockResolvedValue(state);
  api.desktopRenew.mockResolvedValue(state);
  api.desktopClose.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 1500)));
  if (transport === 'host') api.desktopOpen
    .mockResolvedValueOnce({session:'first',url:'http://127.0.0.1:5000/first/host.html'})
    .mockResolvedValueOnce({session:'second',url:'http://127.0.0.1:5000/second/host.html'});

  const selectTab = async (tab: 'computer' | 'details'): Promise<void> => {
    host.dataset.detailsTab = tab;
    panelOpen = tab === 'computer';
    // The conversation's member-panel-tab handler uses this path for every kind of tab selection.
    mounted.show(); mounted.sync();
    await flush();
  };
  await selectTab('computer');
  message('connected');
  expect(frame().hidden).toBe(false);
  const liveFrame = frame();

  await selectTab('details');
  if (transport === 'host') expect(liveFrame.isConnected).toBe(false);
  await selectTab('computer');
  await vi.advanceTimersByTimeAsync(999);
  if (transport === 'host') {
    expect(api.desktopClose).toHaveBeenCalledExactlyOnceWith('first');
    expect(api.desktopOpen).toHaveBeenCalledTimes(2);
    expect(frame().getAttribute('src')).toContain('/second/host.html');
    message('connected');
  } else {
    expect(api.desktopOpen).toHaveBeenCalledTimes(1);
    expect(frame()).toBe(liveFrame);
  }
  expect(frame().hidden).toBe(false);
  expect(panel().querySelector<HTMLElement>('.desktop-placeholder')!.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(501);
  expect(frame().hidden).toBe(false);
});

test.each([
  [{state:'preparing'}, 'desktop.state.starting'],
  [{state:'stopped', lifecycle:'waking'}, 'desktop.state.waking'],
  [{state:'running', lifecycle:'updating'}, 'desktop.state.updating'],
] as const)('keeps the existing progress label beside the VM controls for %j', async (phase, word) => {
  api.desktopStatus.mockResolvedValue({...running, transport:'docker', ...phase});
  panelOpen = true;
  mounted.show(); await flush();
  const row = panel().querySelector<HTMLElement>('.desktop-choice-row')!;
  const status = row.querySelector<HTMLElement>('.computer-lifecycle-state')!;
  expect(status.hidden).toBe(false);
  expect(status.textContent).toBe(t(word));
  expect([...row.querySelectorAll('button:not([hidden])')]).toEqual([row.querySelector('[data-computer-menu]'), computerChoice()]);
});

test('watching wakes a sleeping computer and opens a running one large, the way the Computer tab does', async () => {
  api.desktopStatus.mockResolvedValue({ state:'stopped', ready:false, control:'member' }); mounted.show(); await flush();
  expect(api.desktopOpen).not.toHaveBeenCalled();
  panelOpen=true; mounted.watch(); await flush();
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

test.each([1, 2])("the stream has a layout box before connecting at device pixel ratio %i", async ratio => {
  vi.stubGlobal("devicePixelRatio", ratio);
  const style = document.createElement("style");
  style.textContent = ["styles.css", "desktop-viewer.css", "card.css"]
    .map(name => readFileSync(resolve(__dirname, name), "utf8")).join("\n");
  document.head.append(style);
  try {
    panelOpen = true;
    mounted.show(); await flush();
    const stream = frame();
    expect(stream.hidden).toBe(true);
    const waiting = getComputedStyle(stream);
    expect(waiting.display).toBe("block");
    expect(waiting.visibility).toBe("hidden");
    expect(waiting.position).toBe("absolute");
    expect([waiting.width, waiting.height]).toEqual(["100%", "100%"]);
    message("connected");
    expect(stream.hidden).toBe(false);
    expect(getComputedStyle(stream).visibility).not.toBe("hidden");
  } finally {
    style.remove();
    vi.unstubAllGlobals();
  }
});

test("a seat's frame draws its line inside and takes no room, so the 1280:900 picture fills it", () => {
  // R-COMP-FRAME-01: a 1 px border put the inside 2 px off the ratio and a dark sliver showed.
  const css = (name: string): string => readFileSync(resolve(__dirname, name), "utf8");
  const screen = /\.desktop-screen \{([^}]*)\}/.exec(css("desktop-viewer.css"))![1]!;
  expect(screen).toContain("aspect-ratio: 1280 / 900");
  expect(screen).not.toMatch(/(^|;)\s*border:/);
  expect(screen).toContain("box-shadow: inset 0 0 0 1px var(--line)");
  expect(css("card.css")).toMatch(/\.card-computer-screen \{[^}]*box-shadow: inset 0 0 0 1px var\(--edge\)/);
  expect(css("card.css")).not.toMatch(/\.card-computer-screen \{[^}]*border: 1px/);
});

test('switching members keeps the same live session and owner control on return', async () => {
  const first = {...running, transport:'host', target:'first-tab'} as const;
  const held = {...first, control:'owner'} as const;
  const second = {...running, transport:'host', target:'second-tab'} as const;
  panelOpen = true;
  api.desktopStatus.mockImplementation(async id => id === 1 ? first : second);
  api.desktopOpen.mockResolvedValueOnce({session:'first', url:'http://127.0.0.1:5000/first'})
    .mockResolvedValue({session:'second', url:'http://127.0.0.1:5000/second'});
  api.desktopRenew.mockImplementation(async session => session === 'first' ? held : second);
  api.desktopControl.mockResolvedValue(held);
  mounted.show(); await flush(); message('connected');
  await takeOver(); message('interactive', {held:true});
  const original = frame();

  member = 2; mounted.refresh(); await flush();
  expect(api.desktopClose).not.toHaveBeenCalledWith('first');
  expect(original.hidden).toBe(true);
  expect(original.isConnected).toBe(true);
  expect(panel().querySelector('iframe[src*="/second"]')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(16_000);
  expect(api.desktopRenew).toHaveBeenCalledWith('first');
  expect(api.desktopClose).not.toHaveBeenCalledWith('first');

  member = 1; mounted.refresh(); await flush();
  expect(panel().querySelector('iframe:not([hidden])')).toBe(original);
  expect(panel().dataset.interactive).toBe('true');
  expect(panel().hasAttribute('data-expanded')).toBe(true);
  expect(api.desktopControl).toHaveBeenCalledExactlyOnceWith('first',true);
  expect(api.desktopOpen.mock.calls.filter(([id]) => id === 1)).toHaveLength(1);

  mounted.hide();
  await vi.advanceTimersByTimeAsync(16_000);
  expect(api.desktopClose).not.toHaveBeenCalledWith('first');
  mounted.show(); await flush();
  expect(panel().querySelector('iframe:not([hidden])')).toBe(original);
  expect(panel().dataset.interactive).toBe('true');
});

test.each(['host', 'docker'] as const)('a visible %s panel reconnects after its viewer lease has closed', async transport => {
  const snapshot = {...running, transport, target:'live-target'};
  panelOpen = true;
  api.desktopStatus.mockResolvedValue(snapshot);
  api.desktopRenew.mockRejectedValueOnce(new Error('desktop session expired')).mockResolvedValue(snapshot);
  api.desktopOpen
    .mockResolvedValueOnce({session:'one', url:'http://127.0.0.1:5000/one'})
    .mockRejectedValueOnce(new Error('stale viewer'))
    .mockResolvedValueOnce({session:'reopened', url:'http://127.0.0.1:5000/reopened'});
  mounted.show(); await flush(); message('connected');
  await vi.advanceTimersByTimeAsync(16_000);
  expect(api.desktopClose).toHaveBeenCalledWith('one');
  expect(frame().getAttribute('src')).toContain('/reopened');
  expect(panel().querySelector<HTMLImageElement>('.desktop-wallpaper')!.hidden).toBe(false);
  message('connected');
  expect(frame().hidden).toBe(false);
});

test.each(['host', 'docker'] as const)('a visible %s panel follows a replacement target after renewal', async transport => {
  const first = {...running, transport, target:'first-target'};
  const replacement = {...first, target:'new-target'};
  panelOpen = true;
  api.desktopStatus.mockResolvedValue(first);
  api.desktopRenew.mockResolvedValue(replacement);
  api.desktopOpen
    .mockResolvedValueOnce({session:'one', url:'http://127.0.0.1:5000/one'})
    .mockResolvedValueOnce({session:'replacement', url:'http://127.0.0.1:5000/replacement'});
  mounted.show(); await flush(); message('connected');
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.desktopClose).toHaveBeenCalledWith('one');
  expect(frame().getAttribute('src')).toContain('/replacement');
  if (transport === 'host') expect(api.desktopOpen).toHaveBeenLastCalledWith(1, {conversation_id:11, transport, target_id:'new-target'});
  message('connected');
  expect(frame().hidden).toBe(false);
});

test("another member opened while the page was away never shows the previous member's screen", async () => {
  // The sidebar switches the member before the page is
  // shown (refresh() runs only for a page on screen), and the first member's stream was still lingering.
  panelOpen = true; mounted.show(); await flush(); message('connected');
  expect(frame().getAttribute('src')).toContain('/one/');
  mounted.hide(); await flush();
  member = 2;
  api.desktopOpen.mockResolvedValue({ session:'two', url:'http://127.0.0.1:5000/two/vnc.html' });
  api.desktopStatus.mockResolvedValue({ ...running, works:[{ id:'b', request_id:'r', turn_id:7, state:'running', reason:'', tool:'' }] });
  mounted.show(); await flush();
  // Member 1's session is neither renewed for member 2's panel nor left open, and its screen is gone from the panel.
  expect(api.desktopRenew).not.toHaveBeenCalledWith('one');
  expect(api.desktopClose).toHaveBeenCalledWith('one');
  expect(api.desktopStatus).toHaveBeenCalledWith(2, 11);
  expect(api.desktopOpen).toHaveBeenLastCalledWith(2, { conversation_id: 11 });
  expect(frame().getAttribute('src')).toContain('/two/');
  expect(host.querySelectorAll('iframe[src*="/one/"]')).toHaveLength(0);
});

test("a member's picture and state are drawn only for that member, however the page came back", async () => {
  panelOpen = true; mounted.show(); await flush(); message('connected');
  message('frame', { image:'data:image/jpeg;base64,AAAA' }); await flush();
  mounted.hide(); await flush();
  member = 2; api.desktopStatus.mockResolvedValue({ state:'stopped', ready:false, control:'member' });
  mounted.show(); await flush();
  expect(panel().dataset.desktopState).toBe('stopped');
  expect(host.querySelectorAll('iframe')).toHaveLength(0);
  expect(panel().querySelector<HTMLImageElement>('.desktop-last')!.hidden).toBe(true);
});

const askPaste = (id: unknown = 7, over: Partial<MessageEventInit> = {}): void => { window.dispatchEvent(new MessageEvent('message', { source: frame().contentWindow, origin: 'http://127.0.0.1:5000', data: { type: 'raphael-desktop-paste-request', id }, ...over })); };
// A page in a happy-dom frame has no window to talk to: this one records what is sent to it.
let peer: { postMessage: ReturnType<typeof vi.fn> };
const wire = (): void => { peer = { postMessage: vi.fn() }; Object.defineProperty(frame(), 'contentWindow', { value: peer, configurable: true }); };
const holdControl = async (): Promise<void> => { panelOpen = true; mounted.show(); await flush(); wire(); message('connected'); api.desktopControl.mockResolvedValue({ ...running, control: 'owner' }); await takeOver(); message('interactive', { held: true }); await flush(); };
const pasteReplies = (sent: { mock: { calls: unknown[][] } }): unknown[][] => sent.mock.calls.filter(([data]) => (data as { type?: string }).type === 'raphael-desktop-paste');
const lastReply = (sent: { mock: { calls: unknown[][] } }): unknown[] | undefined => { const replies = pasteReplies(sent); return replies[replies.length - 1]; };

test('the owner pasting into the screen they hold sends their clipboard text to the page, and to that page alone', async () => {
  await holdControl();
  api.ownerClipboardText.mockResolvedValue('sk-or-v1-0123456789abcdef');
  const sent = peer.postMessage;
  askPaste(7); await flush();
  expect(api.ownerClipboardText).toHaveBeenCalledTimes(1);
  expect(pasteReplies(sent)).toEqual([[{ type: 'raphael-desktop-paste', id: 7, text: 'sk-or-v1-0123456789abcdef' }, 'http://127.0.0.1:5000']]);
});

test('nothing is read from their clipboard while they only watch or while a member works', async () => {
  panelOpen = true; mounted.show(); await flush(); wire(); message('connected'); await flush();
  const sent = peer.postMessage;
  askPaste(7); await flush();
  expect(api.ownerClipboardText).not.toHaveBeenCalled();
  expect(pasteReplies(sent)).toEqual([]);
  // A member at work on the screen, the owner having pressed nothing, is the same.
  api.desktopStatus.mockResolvedValue({ ...running, works: [work] }); mounted.refresh(); await flush();
  askPaste(8); await flush();
  expect(api.ownerClipboardText).not.toHaveBeenCalled();
  expect(pasteReplies(sent)).toEqual([]);
});

test('a request from another origin, another window or with no number reads nothing', async () => {
  await holdControl();
  askPaste(7, { origin: 'http://127.0.0.1:6000' }); askPaste(7, { source: window }); askPaste('7'); askPaste(null); await flush();
  expect(api.ownerClipboardText).not.toHaveBeenCalled();
});

test('control that ends while the clipboard is read is told nothing of it', async () => {
  await holdControl();
  let release!: (text: string) => void;
  api.ownerClipboardText.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
  const sent = peer.postMessage;
  askPaste(7); await flush();
  api.desktopControl.mockResolvedValue(running); handback().click(); await flush();
  release('private-clipboard-text'); await flush();
  expect(pasteReplies(sent)).toEqual([]);
});

test('a clipboard that cannot be read answers with no text, and the page pastes as before', async () => {
  await holdControl();
  api.ownerClipboardText.mockRejectedValue(new Error('busy'));
  const sent = peer.postMessage;
  askPaste(3); await flush();
  expect(pasteReplies(sent)).toEqual([[{ type: 'raphael-desktop-paste', id: 3, text: null }, 'http://127.0.0.1:5000']]);
});

const fromPage = (data: unknown): void => { window.dispatchEvent(new MessageEvent('message', { source: frame().contentWindow, origin: 'http://127.0.0.1:5000', data })); };

test('their paste goes to the computer through the core first, and a clipboard they have not changed since is not sent again', async () => {
  await holdControl();
  api.ownerClipboardText.mockResolvedValue('from the PC'); api.ownerClipboardSequence.mockResolvedValue(41);
  const sent = peer.postMessage;
  askPaste(7); await flush();
  expect(api.desktopClipboard).toHaveBeenCalledWith('one', 'put', 'from the PC');
  expect(lastReply(sent)).toEqual([{ type: 'raphael-desktop-paste', id: 7, text: 'from the PC' }, 'http://127.0.0.1:5000']);
  // Nothing copied on the PC since: the computer pastes its own clipboard, which may hold a copy made in it.
  api.desktopClipboard.mockClear();
  askPaste(8); await flush();
  expect(api.desktopClipboard).not.toHaveBeenCalled();
  expect(lastReply(sent)).toEqual([{ type: 'raphael-desktop-paste', id: 8, text: null }, 'http://127.0.0.1:5000']);
  // A new copy on the PC goes again.
  api.ownerClipboardSequence.mockResolvedValue(42); api.ownerClipboardText.mockResolvedValue('newer');
  askPaste(9); await flush();
  expect(api.desktopClipboard).toHaveBeenCalledWith('one', 'put', 'newer');
});

test('a paste the core could not hand over still gives the page the text, as before, and is tried again next time', async () => {
  await holdControl();
  api.ownerClipboardText.mockResolvedValue('kept'); api.ownerClipboardSequence.mockResolvedValue(5);
  api.desktopClipboard.mockResolvedValue({ put: false });
  const sent = peer.postMessage;
  askPaste(1); await flush();
  expect(lastReply(sent)).toEqual([{ type: 'raphael-desktop-paste', id: 1, text: 'kept' }, 'http://127.0.0.1:5000']);
  api.desktopClipboard.mockClear();
  askPaste(2); await flush();
  expect(api.desktopClipboard).toHaveBeenCalledWith('one', 'put', 'kept');
});

test("their copy in the screen they hold brings the computer's copy to their PC, and that copy is not pasted back", async () => {
  await holdControl();
  api.desktopClipboard.mockImplementation(async (_session: string, action: string) => action === 'take' ? { copied: true } : { put: true });
  api.ownerClipboardSequence.mockResolvedValue(77);
  fromPage({ type: 'raphael-desktop-copied' }); await flush();
  expect(api.desktopClipboard).toHaveBeenCalledWith('one', 'take');
  // Their next paste finds the PC clipboard as the copy left it: the computer pastes its own.
  api.ownerClipboardText.mockResolvedValue('copied in the computer');
  api.desktopClipboard.mockClear();
  askPaste(4); await flush();
  expect(api.desktopClipboard).not.toHaveBeenCalled();
  expect(lastReply(peer.postMessage)?.[0]).toEqual({ type: 'raphael-desktop-paste', id: 4, text: null });
});

test('a copy while they only watch, or from another window, brings nothing', async () => {
  panelOpen = true; mounted.show(); await flush(); wire(); message('connected'); await flush();
  fromPage({ type: 'raphael-desktop-copied' }); await flush();
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:5000', data: { type: 'raphael-desktop-copied' } }));
  await flush();
  expect(api.desktopClipboard).not.toHaveBeenCalled();
});

const uploads = (): void => {
  api.core.mockImplementation(async (method: string, params: { action?: string }) => {
    if (method !== 'attachments.upload') return {};
    if (params.action === 'begin') return { token: 'upload-1' };
    if (params.action === 'finish') return { name: 'notes.txt', mime: 'text/plain', data: '', stored_id: 'stored-1' };
    return {};
  });
};

test("files the page passes on go to the computer's team folder, and one quiet line says where", async () => {
  await holdControl(); uploads();
  api.desktopPutFile.mockResolvedValue({ name: 'notes (2).txt', path: '/home/cua/team/notes (2).txt' });
  fromPage({ type: 'raphael-desktop-files', files: [new File(['hello'], 'notes.txt', { type: 'text/plain' }), 'not a file'] }); await flush();
  expect(api.core).toHaveBeenCalledWith('attachments.upload', expect.objectContaining({ action: 'begin', name: 'notes.txt', size: 5 }));
  expect(api.desktopPutFile).toHaveBeenCalledTimes(1);
  expect(api.desktopPutFile).toHaveBeenCalledWith('one', 'stored-1', 'notes.txt');
  const line = panel().querySelector<HTMLElement>('.desktop-notice')!;
  expect(line.hidden).toBe(false);
  expect(line.getAttribute('role')).toBe('status');
  expect(line.textContent).toBe(t('desktop.filePlaced', { p0: 'notes (2).txt' }));
});

test('a file dropped while only watching goes in too, and an oversized file or a transfer failure leaves the panel quiet', async () => {
  panelOpen = true; mounted.show(); await flush(); wire(); message('connected'); await flush(); uploads();
  const screenBox = panel().querySelector<HTMLElement>('.desktop-screen')!;
  const drop = (files: File[]): Event => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
    screenBox.dispatchEvent(event);
    return event;
  };
  api.desktopPutFile.mockResolvedValue({ name: 'photo.png', path: '/home/cua/team/photo.png' });
  expect(drop([new File(['png'], 'photo.png', { type: 'image/png' })]).defaultPrevented).toBe(true); await flush();
  expect(api.desktopPutFile).toHaveBeenCalledWith('one', 'stored-1', 'photo.png');
  const huge = new File(['x'], 'huge.mp4'); Object.defineProperty(huge, 'size', { value: 251 * 1024 * 1024 });
  api.desktopPutFile.mockClear();
  drop([huge]); await flush();
  expect(api.desktopPutFile).not.toHaveBeenCalled();
  expect(panel().querySelector<HTMLElement>('.desktop-notice')!.hidden).toBe(true);
  api.desktopPutFile.mockRejectedValue(new Error('engine'));
  drop([new File(['a'], 'a.txt')]); await flush();
  expect(panel().querySelector<HTMLElement>('.desktop-notice')!.hidden).toBe(true);
  expect(api.core).toHaveBeenCalledWith('computer.viewer_status', expect.objectContaining({viewer_problem:'send a file to the virtual machine'}));
});

test("the computer's menu offers to send a file, with its own icon", async () => {
  await holdControl();
  host.querySelector<HTMLButtonElement>('[data-desktop="menu"]')!.click(); await flush();
  const item = document.querySelector<HTMLElement>('#app-popover [data-pick="send-file"]');
  expect(item?.textContent).toContain(t('desktop.sendFile'));
  const icons = [...document.querySelectorAll('#app-popover [data-pick] svg')].map(node => node.innerHTML);
  expect(new Set(icons).size).toBe(icons.length);
});

test('a host tab closed while its panel is opening returns quietly to idle (R-COMP-PANEL-QUIET-01)', async () => {
  panelOpen = true;
  api.desktopStatus
    .mockResolvedValueOnce({...running, transport:'host', target:'closed-tab'})
    .mockResolvedValue({state:'absent', ready:false, control:'member', transport:'host'});
  api.desktopOpen.mockRejectedValueOnce(new Error('desktop unavailable'));
  mounted.show();
  await flush();
  expect(panel().dataset.desktopState).toBe('idle');
  expect(panel().querySelector('[data-computer-state-text]')?.textContent).toBe(t('memberComputer.idle'));
  expect(enlarge().hidden).toBe(true);
  expectBareScreen(panel());
  expect(panel().querySelector('[role="alert"], iframe')).toBeNull();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
});

test('a failed VM screen retains the wallpaper and reports the problem for the member (R-COMP-PANEL-QUIET-01)', async () => {
  panelOpen = true;
  api.desktopStatus.mockResolvedValue({state:'unavailable', ready:false, control:'member', transport:'docker',
    target:'member-seat', error:'viewer_unreachable'});
  mounted.show();
  await flush();
  expectBareScreen(panel());
  expect(panel().querySelector('[role="alert"]')).toBeNull();
  expect(panel().querySelector('[data-computer-state-text]')?.textContent).toBe(t('memberComputer.idle'));
  expect(api.core).toHaveBeenCalledExactlyOnceWith('computer.viewer_status', {
    member_id:1, conversation_id:11, viewer_problem:'show the screen', observed_transport:'docker', observed_target:'member-seat',
  });
});
