import { visibilityGate, windowVisible } from "./window-visibility";
/** One persistent noVNC stream shared by the card, preview and takeover. */
import { noticeHTML } from "./missing";
import * as api from "./api";
import { getLocale, onLocaleChange, t } from "./i18n";
import { esc, iconButton, btn, patchHTML } from "./ui";
import { openActions } from "./member-column";
import "./desktop-viewer.css";
import { mountDesktopTimeline, desktopWorkText, type DesktopWork } from "./desktop-timeline";
import { mountMemberResources } from "./member-profile-resources";
import { mountCheckpoints } from "./checkpoint-view";
import { cardFailure } from "./card";
import { mountComputerLocation } from "./computer-location";
import { mountComputerLifecycle } from "./computer-lifecycle";
import { computerStateText } from './computer-state';

export interface DesktopState {
  lifecycle?: "waking" | "updating" | "repairing";
  host?: string;
  target?: string;
  mode?: "shared" | "per-bot";
  idle_minutes?: number;
  repair_revision?: number;
  state: "absent" | "unavailable" | "missing" | "stopped" | "incompatible" | "running" | "starting" | "building" | "preparing";
  ready: boolean;
  image?: boolean;
  control: "member" | "owner";
  progress?: string;
  error?: string;
  works?: DesktopWork[];
  preview_allowed?: boolean;
  /** Whether the owner has allowed this member its computer. */
  granted?: boolean;
  teaching?: api.TeachingDraft;
  teach_available?: boolean;
}
export interface DesktopSession { session: string; url: string }
const STATUS_KEY = { stopped: "desktop.stopped", unavailable: "desktop.unavailable", connecting: "desktop.connecting", starting: "desktop.starting", building: "desktop.building", preparing: "desktop.preparing", owner: "desktop.owner", member: "desktop.member" } as const;

export function preparationHTML(state: DesktopState, face = ""): string {
  const stages = ["starting", "building", "preparing"] as const;
  const at = stages.indexOf(state.state as typeof stages[number]);
  const percent = state.progress?.match(/\b(\d{1,3}(?:\.\d+)?)%/);
  const value = percent ? Math.min(100, Number(percent[1])) : undefined;
  const character = document.createElement('template');
  character.innerHTML = face;
  const identity = character.content.querySelector('[data-presence-member]')?.getAttribute('data-presence-member') ?? '';
  for (const node of character.content.querySelectorAll<HTMLElement>('.av')) node.style.removeProperty('--av');
  for (const node of character.content.querySelectorAll('[data-presence-member], [data-tooltip]')) { node.removeAttribute('data-presence-member'); node.removeAttribute('data-tooltip'); }
  // Boot has its own working motion, independent of the member's conversation activity.
  for (const node of character.content.querySelectorAll('.slime-surface, svg.slime')) { node.setAttribute('data-state', 'working'); node.removeAttribute('data-slime-member'); }
  const label = esc(t(STATUS_KEY[stages[Math.max(0, at)]]));
  return `<div class="desktop-preparation" role="status"><div class="desktop-boot-face" data-k="desktop-face-${esc(identity)}" aria-hidden="true">${character.innerHTML}</div>` +
    `<p class="desktop-stage">${esc(computerStateText(state))}</p>` +
    (value === undefined ? "" : `<progress aria-label="${label}" max="100" value="${value}"></progress>`) +
    // R-UI-93: only a first build says how long it can take.
    (state.state === "building" ? `<p class="desktop-first-build">${esc(t("desktop.firstBuild"))}</p>` : "") +
    `</div>`;
}

export function mountDesktopViewer(host: HTMLElement, member: () => number,
  options: { timeline: HTMLElement; conversation: () => number | undefined; name: () => string; face?(): string; closePanel?(): void; openPanel(): void; panelVisible(): boolean; status?(active: boolean): void; changed?(): void; stop?(turnId: number): Promise<unknown>; trySkill?(text: string): void }): { show(): void; hide(close?: boolean): void; refresh(): void; sync(): void; carry(before: Element): void; takeover(): void; files(): void; waitingForOwner(turnId: number): boolean } {
  const panel = document.createElement("section");
  panel.className = "desktop-panel"; panel.id = 'member-computer-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'member-tab-computer'); panel.hidden = true;
  panel.innerHTML = `<div class="desktop-location-header"></div><div class="desktop-takeover-bar" hidden>${iconButton("left", t("members.panelBack"), ' data-desktop="back" hidden')}<span class="desktop-identity"></span><span class="desktop-live" role="status"></span>${iconButton("stop", t("agent.stop"), ' data-desktop="stop" hidden')}${iconButton("left", t("agent.collapsePdf"), ' data-desktop="collapse" hidden')}${btn("", "sm", ' data-desktop="return"')}${iconButton("more", t("chat.more"), ' data-desktop="menu" aria-haspopup="menu" aria-expanded="false"')}</div><p class="desktop-request" role="status" hidden></p><div class="desktop-shell">` +
    `<div class="desktop-screen"><img class="desktop-wallpaper" alt=""><img class="desktop-last" alt="" hidden><div class="desktop-placeholder"></div>${btn("", "sm", ' data-desktop="retry" hidden')}` +
    `<iframe referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" hidden></iframe>` +
    `<button type="button" class="btn desktop-hit" data-desktop="peek" hidden></button>${iconButton("expand", t("desktop.expand"), ' data-desktop="enlarge"', 'desktop-enlarge')}<span class="desktop-owner" role="status" hidden></span></div><h2 class="desktop-caption"></h2></div>` +
    `<p class="desktop-error" role="alert" hidden></p><p class="desktop-recording" role="status" hidden></p><div class="desktop-teach-missing" hidden></div><div class="desktop-actions">${btn("", "sm", ' data-desktop="revoke" hidden')}${btn("", "sm", ' data-desktop="take" hidden')}${btn("", "sm", ' data-desktop="discard-teach" hidden')}${btn("", "sm", ' data-desktop="teach"')}</div><div class="desktop-review" hidden></div><div class="desktop-try" hidden><input class="mb-fin" data-teach-input maxlength="4000">${btn("", "sm", ' data-desktop="try-teach"')}</div>`;
  const locationHeader = panel.querySelector<HTMLElement>(".desktop-location-header")!;
  const location = mountComputerLocation(locationHeader, draw);
  const frame = panel.querySelector<HTMLIFrameElement>('iframe')!;
  frame.dataset.desktopStream = "";
  frame.remove();
  const tabBar = host.querySelector('.mb-tabs');
  if (tabBar) tabBar.after(panel); else (host.querySelector('.mb-det-scroll') ?? host).prepend(panel);
  const hit = panel.querySelector<HTMLButtonElement>('[data-desktop="peek"]')!;
  const take = panel.querySelector<HTMLButtonElement>('[data-desktop="take"]')!;
  const action = panel.querySelector<HTMLButtonElement>('[data-desktop="return"]')!;
  const retry = panel.querySelector<HTMLButtonElement>('[data-desktop="retry"]')!;
  const placeholder = panel.querySelector<HTMLElement>('.desktop-placeholder')!;
  const stateContent = document.createElement('div'); stateContent.className = 'desktop-state-content';
  const stateActions = document.createElement('div'); stateActions.className = 'desktop-state-actions';
  const stateRecovery = document.createElement('span'); stateRecovery.className = 'desktop-state-recovery';
  stateActions.append(retry, stateRecovery); placeholder.append(stateContent, stateActions);
  const previewActions = document.createElement('div'); previewActions.className = 'desktop-preview-actions';
  const enlarge = panel.querySelector<HTMLButtonElement>('[data-desktop="enlarge"]')!;
  enlarge.className = 'btn sm'; enlarge.textContent = t('desktop.expand');
  previewActions.append(enlarge, take); panel.querySelector('.desktop-shell')!.after(previewActions);
  const revoke = panel.querySelector<HTMLButtonElement>('[data-desktop="revoke"]')!;
  const error = panel.querySelector<HTMLElement>('.desktop-error')!;
  function showNotice(message: string, ready = false): void { error.textContent = message; error.setAttribute('role', ready ? 'status' : 'alert'); error.hidden = false; }
  const teach = panel.querySelector<HTMLButtonElement>('[data-desktop="teach"]')!;
  const discardTeach = panel.querySelector<HTMLButtonElement>('[data-desktop="discard-teach"]')!;
  const review = panel.querySelector<HTMLElement>('.desktop-review')!;
  const tryHost = panel.querySelector<HTMLElement>('.desktop-try')!;
  const tryInput = tryHost.querySelector<HTMLInputElement>('[data-teach-input]')!;
  let demonstration: api.TeachingDraft | undefined, skillName = "";
  let skillEditor: ReturnType<typeof mountMemberResources> | undefined;
  let teachingBusy = false, drafting = false;
  const checkpoints = mountCheckpoints(panel, member);
  const timeline = mountDesktopTimeline(options.timeline, options.name);
  let visible = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined, watching = false;
  let drawn = "", drawnInline: Element | null = null, suspended = false, returnPanelOpen = false, filesOpen = false, filesOnly = false;
  let returnedRequests: string[] = [];
  let state: DesktopState | undefined, session: DesktopSession | undefined;
  let maintenance: { member: number; phase: NonNullable<DesktopState['lifecycle']> } | undefined;
  const lifecycle = mountComputerLifecycle(host, panel, member, () => state, async (action, captured) => {
    const id = member();
    const operation = { member: id, phase: (action === 'update' ? 'updating' : action === 'repair' ? 'repairing' : 'waking') as NonNullable<DesktopState['lifecycle']> };
    maintenance = operation;
    if (state) state = { ...state, lifecycle: operation.phase }; draw();
    closeStream();
    const current = generation;
    try {
      const next = await api.desktopMaintain(id, action, captured, action === 'reset');
      if (id === member() && current === generation) update(next);
    } finally { if (maintenance === operation) maintenance = undefined; if (id === member() && current === generation) { if (state) state = {...state, lifecycle: undefined}; draw(); if (state?.state === 'running' && active()) void openStream(); } }
  });
  let connected = false, interactive = false, changing = false, loading = false, opening = false, takeOnConnect = false;
  let closePending: Promise<unknown> = Promise.resolve(), clickedAt = 0;
  // Nothing is painted until the read answers, so the town never flashes under the owner's picture.
  let ownWallpaper: string | undefined, wallpaperKnown = false, wallpaperRead: Promise<void> | undefined;
  const readWallpaper = (): void => {
    wallpaperRead ??= Promise.resolve().then(() => api.desktopWallpaper())
      .then(result => { ownWallpaper = result?.image; }, () => {})
      .then(() => { wallpaperKnown = true; draw(); });
  };
  // Left for a moment, the stream stays: coming back then costs no reconnect at all.
  const LINGER_MS = 120_000;
  const lastFrames = new Map<number, string>();
  let lingering: ReturnType<typeof setTimeout> | undefined, streamMember: number | undefined, streamConversation: number | undefined;
  const last = panel.querySelector<HTMLImageElement>('.desktop-last')!;
  const pending = (): DesktopWork | undefined => state?.works?.find(work => work.state === "waiting_control");
  const waitingTurns = (): string => [...new Set((state?.works ?? []).filter(work => work.state === "waiting_control").map(work => work.turn_id))].sort((a,b) => a-b).join(",");
  const waitingRequests = (): string[] => (state?.works ?? []).filter(work => work.state === 'waiting_control').map(work => work.request_id || work.id);
  const active = (): boolean => visible && (options.panelVisible() || !!options.timeline.querySelector("[data-card-desktop-screen], [data-card-screen]"));
  const send = (held: boolean, pointer?: { x:number; y:number }): void => { if (session) frame.contentWindow?.postMessage({ type:"raphael-desktop-control", held, pointer }, new URL(session.url).origin); };

  function paint<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
    if (target[key] !== value) target[key] = value;
  }

  function draw(): void {
    const inline = options.timeline.querySelector<HTMLElement>('[data-card-desktop-screen], [data-card-screen]');
    // A closed panel with no card on screen shows no face, and building one on every render is most of a draw.
    const face = inline || options.panelVisible() || panel.hasAttribute('data-expanded') ? options.face?.() ?? "" : "";
    const hour = new Date().getHours();
    const period = hour >= 6 && hour < 11 ? 'morning' : hour >= 11 && hour < 16 ? 'noon' : hour >= 16 && hour < 19 ? 'dusk' : hour >= 19 && hour < 22 ? 'evening' : 'night';
    const signature = JSON.stringify([visible, options.panelVisible(), member(), state, connected, interactive, changing, opening, suspended, demonstration, skillName, teachingBusy, drafting, !!skillEditor, review.hidden, filesOpen, filesOnly, panel.hasAttribute('data-expanded'), options.name(), face.replace(/--slime-(?:delay|since):[^;"\s]+;?| data-slime-mounted="[\d.]+"/g, ""), getLocale(), location.ready(), location.isRemote(), session, lastFrames.get(member()), period, wallpaperKnown, !!ownWallpaper]);
    if (signature === drawn && inline === drawnInline) return;
    drawn = signature; drawnInline = inline;
    lifecycle.draw();
    paint(panel, "hidden", !visible || !state);
    paint(panel.querySelector('h2')!, 'textContent', t("desktop.screenOf", { p0: options.name() }));
    patchHTML(panel.querySelector('.desktop-identity')!, face + `<span>${esc(options.name())}</span>`);
    options.status?.(state?.state === "running");
    paint(frame, "title", t("desktop.open")); hit.setAttribute('aria-label', t("desktop.expand"));
    const expanded = panel.hasAttribute('data-expanded');
    const locationHost = expanded ? panel.querySelector<HTMLElement>('.desktop-takeover-bar')! : lifecycle.locationHost;
    if (location.control.parentElement !== locationHost) locationHost.insertBefore(location.control, expanded ? locationHost.querySelector('[data-desktop="menu"]') : null);
    locationHeader.hidden = expanded;
    location.status(!!state?.error);
    const currentWork = state?.works?.find(work => work.state === 'running' || work.state === 'waiting_control');
    paint(panel.querySelector<HTMLElement>('.desktop-live')!, 'textContent', currentWork ? desktopWorkText(currentWork) : '');
    const stop = panel.querySelector<HTMLElement>('[data-desktop="stop"]')!;
    paint(stop, 'hidden', !watching || !currentWork || !options.stop);
    stop.setAttribute('title', t('agent.stop')); stop.setAttribute('aria-label', t('agent.stop'));
    paint(panel.querySelector<HTMLElement>('[data-desktop="collapse"]')!, 'hidden', !watching);
    panel.querySelector<HTMLElement>('.desktop-takeover-bar')!.hidden = !expanded;
    panel.querySelector<HTMLElement>('[data-desktop="back"]')!.hidden = !filesOpen && (!skillEditor || review.hidden);
    panel.toggleAttribute('data-files', filesOpen);
    const request = panel.querySelector<HTMLElement>('.desktop-request')!;
    paint(request, "hidden", !pending()); paint(request, "textContent", pending() ? desktopWorkText(pending()!) : "");
    panel.toggleAttribute("data-request", !!pending());
    const running = state?.state === "running", owner = state?.control === "owner";
    checkpoints.update(!!running);
    const recording = demonstration && ["recording", "full"].includes(demonstration.state);
    panel.toggleAttribute('data-teaching', !!recording || drafting || !!demonstration);
    paint(teach, "textContent", t(drafting ? "teach.drafting" : recording ? "teach.stop" : demonstration ? "teach.review" : "teach.start"));
    paint(teach, "disabled", teachingBusy || changing || !demonstration && (!running || !connected || !!pending() || state?.teach_available === false));
    paint(teach, "hidden", !!skillEditor);
    const missing = panel.querySelector<HTMLElement>('.desktop-teach-missing')!;
    paint(missing, "hidden", state?.teach_available !== false);
    patchHTML(missing, state?.teach_available === false ? noticeHTML('member_computer', 'computer', 'computer') : '');
    paint(discardTeach, "textContent", t("teach.discard")); paint(discardTeach, "hidden", !demonstration || !!skillEditor); paint(discardTeach, "disabled", teachingBusy && !drafting);
    const warning = panel.querySelector<HTMLElement>('.desktop-recording')!;
    paint(warning, "hidden", !recording && !drafting); paint(warning, "textContent", t(drafting ? "teach.drafting" : demonstration?.state === "full" ? "teach.full" : "teach.warning"));
    const tryButton = tryHost.querySelector<HTMLButtonElement>('button')!;
    paint(tryButton, "textContent", t("teach.try")); tryInput.placeholder = t("teach.input"); tryInput.setAttribute('aria-label', t("teach.input"));
    paint(tryHost, "hidden", !skillName);
    const preparing = state && (!!state.lifecycle || ["starting", "building", "preparing"].includes(state.state));
    const label = preparing ? state!.state as "starting" | "building" | "preparing" : !running ? state?.state === "stopped" || state?.state === "missing" ? "stopped" : "unavailable" : !connected && !suspended ? "connecting" : owner ? "owner" : "member";
    paint(panel.dataset, "desktopState", label);
    paint(panel.dataset, "interactive", String(interactive));
    // Only pressing the preview or a takeover action acquires input.
    paint(hit, "hidden", !running || !connected && !suspended || owner || panel.hasAttribute('data-expanded'));
    paint(take, "textContent", t("desktop.take")); paint(take, "hidden", !running || !connected || owner || !!demonstration); paint(take, "disabled", changing);
    paint(frame, "hidden", !running || !connected);
    paint(frame.style, "pointerEvents", interactive && !watching ? "auto" : "none");
    const status = panel.querySelector<HTMLElement>('.desktop-owner')!;
    paint(status, "textContent", t("desktop.operating")); paint(status, "hidden", !owner || !connected);
    paint(action, "textContent", t(pending() ? "desktop.done" : "desktop.release")); paint(action, "hidden", watching || !expanded || !!recording || filesOnly);
    paint(panel.querySelector<HTMLElement>('[data-desktop="menu"]')!, "hidden", watching || filesOnly); paint(action, "disabled", changing);
    const asleep = state?.state === "stopped" || state?.state === "missing";
    paint(retry, "textContent", t(state?.error === 'docker_stopped' ? 'desktop.startDocker' : state?.state === 'missing' && state.image === false ? 'desktop.prepareImage' : asleep ? "computer.open" : "desktop.retry"));
    paint(retry, "hidden", !!running || !!preparing || state?.state === "absent" || state?.error === 'remote_unavailable'); paint(retry, "disabled", opening);
    enlarge.textContent = t('desktop.expand');
    paint(enlarge, 'hidden', expanded || !running || !connected); paint(previewActions, 'hidden', expanded || !running || !connected);
    paint(revoke, "textContent", t("desktop.revoke")); paint(revoke, "hidden", !state?.granted || owner || !!preparing);
    const source = ownWallpaper ?? `/wallpapers/${period}.svg`;
    const paintWallpaper = (image: HTMLImageElement): void => {
      if (wallpaperKnown && image.getAttribute('src') !== source) image.setAttribute('src', source);
      image.toggleAttribute('data-own', !!ownWallpaper);
    };
    paintWallpaper(panel.querySelector<HTMLImageElement>('.desktop-wallpaper')!);
    const picture = running && (!connected || inline && !expanded) ? lastFrames.get(member()) : undefined;
    paint(last, "hidden", !picture);
    if (picture && last.src !== picture) paint(last, "src", picture);
    paint(placeholder, "hidden", (!!running && connected) || !!picture);
    const character = document.createElement('template'); character.innerHTML = face;
    for (const node of character.content.querySelectorAll('[data-presence-member], [data-tooltip]')) { node.removeAttribute('data-presence-member'); node.removeAttribute('data-tooltip'); }
    for (const node of character.content.querySelectorAll('.slime-surface, svg.slime')) { node.setAttribute('data-state', asleep ? 'sleeping' : preparing ? 'working' : 'idle'); node.removeAttribute('data-slime-member'); }
    patchHTML(stateContent, preparing ? preparationHTML(state!, face) : `<div class="desktop-boot-face" aria-hidden="true">${character.innerHTML}</div><span class="desktop-message">${esc(computerStateText(state))}</span>`);
    patchHTML(stateRecovery, state?.error === 'docker_stopped' || state?.error === 'remote_unavailable'
      ? btn(esc(t('desktop.useRemote')), 'sm', ' data-desktop-location')
      : state?.state === 'absent' && state.error !== 'disabled' && !location.isRemote() ? btn(esc(t('desktop.download')), 'sm', ' data-act="docker-download"') : '');
    if (!running && frame.hasAttribute('src')) { frame.remove(); frame.removeAttribute('src'); connected = interactive = false; }
    if (running && session && !frame.hasAttribute('src') && active()) { paint(frame, "src", session.url); panel.querySelector('.desktop-screen')!.append(frame); }
    if (inline) {
      let background = inline.querySelector<HTMLImageElement>(':scope > .desktop-wallpaper');
      if (!background) { background = document.createElement('img'); background.className = 'desktop-wallpaper'; background.alt = ''; inline.prepend(background); }
      paintWallpaper(background);
      let waiting = inline.querySelector<HTMLElement>(':scope > .desktop-placeholder');
      if (!waiting) { waiting = document.createElement('div'); waiting.className = 'desktop-placeholder'; inline.append(waiting); }
      paint(waiting, 'hidden', !!running && connected);
      patchHTML(waiting, stateContent.innerHTML);
      inline.toggleAttribute("data-owner-control", !!owner);
      const cover = inline.querySelector<HTMLButtonElement>(":scope > button"); if (cover) paint(cover, "hidden", !!owner);
    }
    const destination = inline && !panel.hasAttribute('data-expanded') ? inline : panel.querySelector<HTMLElement>('.desktop-screen')!;
    if (frame.hasAttribute('src') && frame.parentElement !== destination) {
      if ('moveBefore' in destination && frame.isConnected) destination.moveBefore(frame, destination.firstChild);
      else destination.prepend(frame);
    }
  }
  function closeStream(): void {
    clearTimeout(lingering);
    generation++; takeOnConnect = false; watching = false; filesOnly = false; send(false); frame.remove(); frame.removeAttribute('src'); connected = interactive = false;
    const previous = session; session = undefined;
    if (previous) closePending = closePending.then(() => api.desktopClose(previous.session)).catch(() => {});
    panel.removeAttribute('data-expanded'); document.documentElement.removeAttribute('data-desktop-expanded');
    document.documentElement.removeAttribute('data-desktop-watch');
  }
  /** Out of sight: the stream lingers, unless the owner holds the controls, which end with the view. */
  function leave(): void {
    if (!session) return;
    if (state?.control === "owner") { closeStream(); return; }
    clearTimeout(lingering);
    lingering = setTimeout(closeStream, LINGER_MS);
  }
  function message(event: MessageEvent): void {
    if (!session || event.source !== frame.contentWindow || event.origin !== new URL(session.url).origin || event.data?.type !== 'raphael-desktop') return;
    if (event.data.state === 'frame') {
      if (state?.control === 'owner' || pending()) return;
      if (typeof event.data.image === 'string' && event.data.image.startsWith('data:image/jpeg;base64,') && streamMember !== undefined) lastFrames.set(streamMember, event.data.image);
      return;
    }
    if (event.data.state === 'interactive') {
      interactive = event.data.held === true && state?.control === 'owner';
      if (interactive && clickedAt) panel.dataset.controlLatencyMs = String(performance.now() - clickedAt);
    } else if (event.data.state === 'input-accepted' && interactive && clickedAt) {
      panel.dataset.acceptedInputLatencyMs = String(performance.now() - clickedAt); clickedAt = 0;
    } else if (event.data.state === 'input' && interactive) {
      panel.dataset.inputLatencyMs = String(event.data.latencyMs);
    } else {
      connected = event.data.state === 'connected';
      if (!connected) { interactive = false; closeStream(); if (state) state = { ...state, control:'member' }; }
      // Only a fresh takeover click can acquire input after the new stream connects.
    }
    draw();
    if (connected && takeOnConnect) { takeOnConnect = false; void control(true); }
  }
  window.addEventListener('message', message);
  async function openStream(): Promise<void> {
    if (session || opening || suspended || maintenance?.member === member() || !active()) return;
    opening = true;
    const current = generation, id = member();
    try {
      await closePending;
      const opened = await api.desktopOpen(id, { conversation_id: options.conversation() });
      if (current !== generation || id !== member() || !active()) { await api.desktopClose(opened.session); return; }
      session = opened; streamMember = id; streamConversation = options.conversation();
    } catch { if (current === generation) { takeOnConnect = false; showNotice(t('desktop.unavailable')); } }
    finally { opening = false; if (current === generation) draw(); }
  }
  function parkFrame(): void {
    const destination = panel.querySelector<HTMLElement>('.desktop-screen')!;
    if (frame.parentElement === destination || !frame.hasAttribute('src')) return;
    if (destination.moveBefore && frame.isConnected) destination.moveBefore(frame, destination.firstChild);
    else destination.prepend(frame);
  }
  function update(next: DesktopState): void {
    const beganWork = state && !state.works?.some(work => work.state === 'running') && next.works?.some(work => work.state === 'running');
    if (beganWork) options.openPanel();
    const previousWaiting = waitingTurns();
    if (!next.works?.some(work => work.state === "waiting_control")) parkFrame();
    state = maintenance?.member === member() ? { ...next, lifecycle: maintenance.phase } : next;
    if (pending()) lastFrames.delete(member());
    if (suspended && waitingRequests().some(request => !returnedRequests.includes(request))) suspended = false;
    if (next.state !== 'running') connected = interactive = false;
    timeline.update(next);
    if (previousWaiting !== waitingTurns()) options.changed?.();
    if (next.teaching && !teachingBusy) demonstration = next.teaching;
    // Looking never starts a computer: only a running one is streamed, and only a press starts one.
    if (maintenance?.member !== member() && active() && next.state === 'running') void openStream();
    draw();
  }
  let pollDelay = 2000;
  const pollGate = visibilityGate(() => { clearTimeout(timer); void poll(); }, () => host.isConnected && (visible || !!session));
  async function poll(): Promise<void> {
    if ((!visible && !session) || loading || !windowVisible()) return;
    loading = true;
    const current = generation, id = member();
    try {
      // The core renews a connected lease from the authenticated socket and live work metadata.
      const next = session ? await api.desktopRenew(session.session) : await api.desktopStatus(id, options.conversation());
      if ((visible || session) && current === generation && id === member()) {
        pollDelay = JSON.stringify(next) === JSON.stringify(state) ? Math.min(10_000, pollDelay * 2) : 2000;
        update(next);
      }
    } catch {
      if (current === generation) { closeStream(); state = { state:'unavailable', ready:false, control:'member' }; draw(); }
    } finally { loading = false; if (visible || session) { clearTimeout(timer); timer = setTimeout(pollGate.run, pollDelay); } }
  }
  async function control(held: boolean, pointer?: { x:number; y:number }): Promise<void> {
    if (!session || changing || held && !connected) return;
    changing = true; error.hidden = true;
    // A renewal started before this click must not overwrite the new lease state.
    const current = ++generation, opened = session, request = pending()?.request_id;
    if (held) { clickedAt = performance.now(); delete panel.dataset.controlLatencyMs; delete panel.dataset.acceptedInputLatencyMs; }
    interactive = false; send(false); draw();
    try {
      const next = request ? await api.desktopControl(opened.session, held, request) : await api.desktopControl(opened.session, held);
      if (current !== generation || session !== opened) return;
      update(next); send(held, pointer);
      if (held) frame.focus({ preventScroll:true });
    } catch {
      if (current === generation) { showNotice(t('desktop.busy')); cardFailure(options.timeline.querySelector('.desktop-takeover-card, .computer-card'), () => { void control(held); }); }
    } finally { changing = false; if (current === generation) draw(); }
  }
  const expand = (on: boolean): void => {
    if (on && !panel.hasAttribute('data-expanded')) { returnPanelOpen = options.panelVisible(); options.openPanel(); }
    panel.toggleAttribute('data-expanded', on);
    document.documentElement.toggleAttribute('data-desktop-expanded', on);
    draw();
  };
  function collapseWatch(): void {
    if (!watching) return;
    watching = false; document.documentElement.removeAttribute('data-desktop-watch'); expand(false);
    if (interactive && state?.control === 'owner') send(true);
    if (!returnPanelOpen) options.closePanel?.();
    draw();
  }
  panel.querySelector('[data-desktop="enlarge"]')!.addEventListener('click', () => {
    if (state?.state !== 'running' || !connected) return;
    watching = true;
    send(false);
    document.documentElement.setAttribute('data-desktop-watch', '');
    expand(true);
  });
  panel.querySelector('[data-desktop="collapse"]')!.addEventListener('click', collapseWatch);
  panel.querySelector('[data-desktop="stop"]')!.addEventListener('click', () => {
    const work = state?.works?.find(work => work.state === 'running' || work.state === 'waiting_control');
    if (work) void options.stop?.(work.turn_id);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && watching) { event.preventDefault(); collapseWatch(); }
  });
  function clearReview(): void { skillEditor?.destroy(); skillEditor = undefined; review.replaceChildren(); review.hidden = true; }
  async function discardRecording(id = member(), recording = demonstration): Promise<void> {
    if (!recording) return;
    const current = ++generation;
    await api.desktopTeach({action:'discard', member_id:id, id:recording.id});
    if (current !== generation || member() !== id) return;
    demonstration = undefined; clearReview(); if (state) state = {...state,control:'member'}; send(false); interactive = false; draw();
    await handback();
  }
  function editDraft(draft: api.TeachingDraft): void {
    clearReview(); demonstration = draft; review.hidden = false;
    const id = member(), conversation = options.conversation();
    skillEditor = mountMemberResources(review, {memberId:id,tab:'skills',standalone:true,draft:{text:draft.text,
      async save(text) {
        ++generation;
        const result = await api.desktopTeach({action:'save',member_id:id,id:draft.id,text});
        if (member() !== id || options.conversation() !== conversation) return;
        demonstration = undefined; skillName = result.skill?.name ?? ''; clearReview(); draw(); tryInput.focus();
      },
      discard: () => discardRecording(id,draft),
    }});
    draw(); review.querySelector('textarea')?.focus();
  }
  teach.addEventListener('click', () => {
    if (teachingBusy || teach.disabled) return;
    if (skillEditor) { review.hidden = false; draw(); review.querySelector('textarea')?.focus(); return; }
    const opened = session, id = member(), conversation = options.conversation();
    const action = demonstration ? ['recording','full'].includes(demonstration.state) ? 'stop' : demonstration.state === 'draft' ? 'read' : 'draft' : 'start';
    if (action === 'start' && !opened) return;
    const current = ++generation;
    teachingBusy = true; drafting = action === 'stop' || action === 'draft'; error.hidden = true;
    if (action === 'stop' && demonstration) { demonstration = {...demonstration,state:'stopped'}; interactive = false; send(false); if (state) state = {...state,control:'member'}; }
    draw();
    void (async () => {
      try {
        const result = await api.desktopTeach(action === 'start' || action === 'stop' ? {action,session:opened!.session} : {action,member_id:id,id:demonstration!.id});
        if (current !== generation || member() !== id || options.conversation() !== conversation || session !== opened) return;
        demonstration = result;
        if (action === 'start') { skillName = ''; state = {...state!,control:'owner'}; expand(true); send(true); }
        else { state = {...state!,control:'member'}; interactive = false; send(false); editDraft(result); }
      } catch {
        if (current !== generation) return;
        if (action === 'stop' && demonstration) { demonstration = {...demonstration,state:'stopped'}; interactive = false; send(false); if (state) state = {...state,control:'member'}; }
        showNotice(t('teach.failed'));
      }
      finally { if (current === generation) { teachingBusy = drafting = false; draw(); } }
    })();
  });
  discardTeach.addEventListener('click', () => {
    if (teachingBusy && !drafting) return;
    teachingBusy = true; drafting = false; draw();
    void discardRecording().catch(() => { showNotice(t('teach.failed')); }).finally(() => { teachingBusy = false; draw(); });
  });
  tryHost.querySelector('button')!.addEventListener('click', () => {
    const value = tryInput.value.trim();
    if (!value || !skillName) { tryInput.focus(); return; }
    const prompt = t('teach.tryPrompt',{name:skillName,input:value});
    void handback().then(returned => {
      if (!returned) return;
      skillName = ''; tryInput.value = ''; draw(); options.trySkill?.(prompt);
    });
  });
  function acquire(): void {
    suspended = false; takeOnConnect = true; expand(true);
    if (connected) { takeOnConnect = false; void control(true); } else if (state?.state === 'running') void openStream();
  }
  panel.addEventListener('click', event => {
    if ((event.target as Element).closest('[data-act="docker-download"]')) void api.openExternalUrl("https://www.docker.com/products/docker-desktop/").catch(() => { showNotice(t("desktop.unavailable")); });
  });
  hit.addEventListener('click', acquire);
  // A small picture is no place to work: the same stream fills the window, under the owner's hands.
  take.addEventListener('click', acquire);
  async function handback(): Promise<boolean> {
    if (changing) return false;
    const opened = session, id = member(), conversation = options.conversation();
    returnedRequests = waitingRequests();
    suspended = true;
    await control(false);
    if (session !== opened || member() !== id || options.conversation() !== conversation) return false;
    if (state?.control === 'owner') { suspended = false; return false; }
    expand(false); checkpoints.hide(); filesOpen = false; review.hidden = true; closeStream();
    if (!returnPanelOpen || innerWidth < 1440) options.closePanel?.();
    draw(); return true;
  }
  action.addEventListener('click', () => { void handback(); });
  options.timeline.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-card-desktop]');
    if (!button || button.disabled) return;
    if (button.dataset.cardDesktop === 'take') {
      // Owner input stays in the conversation's existing RFB iframe.
      suspended = false; takeOnConnect = true;
      if (connected) { takeOnConnect = false; void control(true); }
      else if (state?.state === 'running') void openStream();
    }
    else if (button.dataset.cardDesktop === 'return') void handback();
    else {
      const work = pending();
      if (work) void options.stop?.(work.turn_id).catch(() => cardFailure(button.closest('.conversation-card'), () => button.click()));
    }
  });
  retry.addEventListener('click', () => {
    if (state?.error !== 'docker_stopped') { suspended = false; closeStream(); void openStream(); return; }
    const id = member(), current = generation, capturedHost = state.host ?? '';
    opening = true; state = {...state, lifecycle:'waking'}; draw();
    void api.core<DesktopState>('computer.viewer_status', {member_id:id, start_docker:true, host:capturedHost})
      .then(next => { if (id === member() && current === generation) { update(next); showNotice(t('desktop.dockerReady'), true); } })
      .catch(() => { if (id === member() && current === generation) { if (state) state = {...state, lifecycle:undefined}; showNotice(t('desktop.dockerStartFailed')); } })
      .finally(() => { if (current === generation) { opening = false; draw(); } });
  });
  panel.addEventListener('click', event => { if ((event.target as Element).closest('[data-desktop-location]')) location.open(); });
  revoke.addEventListener('click', () => {
    void api.desktopRevoke(member()).then(() => { if (state) state = { ...state, granted: false }; draw(); })
      .catch(() => { showNotice(t('desktop.busy')); });
  });
  panel.querySelector('[data-desktop="menu"]')!.addEventListener('click', event => openActions(event.currentTarget as HTMLElement, [
    { id: 'files', label: t('files.changes'), icon: 'file' },
    { id: 'teach', label: teach.textContent ?? t('teach.start'), icon: 'steps' },
  ], choice => { if (choice === 'files') { filesOpen = true; void checkpoints.show(); draw(); } else teach.click(); }));
  panel.querySelector('[data-desktop="back"]')!.addEventListener('click', () => {
    filesOpen = false; checkpoints.hide(); review.hidden = true;
    // Opened from a card, nothing was taken over: Back is the way home.
    if (filesOnly) { filesOnly = false; expand(false); if (!returnPanelOpen || innerWidth < 1440) options.closePanel?.(); }
    draw();
  });
  onLocaleChange(draw);
  return {
    show() { if (options.panelVisible()) void location.refresh().then(draw); visible = true; suspended = false; pollDelay = 2000; clearTimeout(lingering); clearTimeout(timer); readWallpaper(); void poll(); },
    hide(close = false) { location.hide(); visible = false; if (close || panel.hasAttribute('data-expanded')) closeStream(); else leave(); timeline.clear(); draw(); },
    refresh() {
      // Back to the conversation whose stream is still open: nothing to reconnect.
      if (session && streamMember === member() && streamConversation === options.conversation()) { clearTimeout(lingering); draw(); return; }
      closeStream(); opening = false; error.hidden = true; error.setAttribute('role', 'alert'); suspended = false; pollDelay = 2000; filesOpen = false; checkpoints.hide(); clearReview(); demonstration = undefined; skillName = ''; teachingBusy = drafting = false; state = undefined; timeline.clear(); clearTimeout(timer); draw(); if (visible) void poll();
    },
    sync() { if (!options.panelVisible()) location.hide(); timeline.sync(); if (!active() && session) leave(); else { clearTimeout(lingering); if (active() && state?.state === 'running') void openStream(); } draw(); },
    carry(before) { if (before.contains(frame)) parkFrame(); },
    takeover() { visible = true; acquire(); void poll(); },
    files() { visible = true; filesOnly = !panel.hasAttribute('data-expanded'); expand(true); filesOpen = true; void checkpoints.show(); draw(); },
    waitingForOwner: turnId => !!state?.works?.some(work => work.turn_id === turnId && work.state === "waiting_control"),
  };
}
