/** One persistent noVNC stream in the existing member details panel. */
import * as api from "./api";
import { onLocaleChange, t } from "./i18n";
import { esc, iconButton, btn } from "./ui";
import "./desktop-viewer.css";
import { mountDesktopTimeline, desktopWorkText, type DesktopWork } from "./desktop-timeline";

export interface DesktopState {
  state: "absent" | "unavailable" | "missing" | "stopped" | "incompatible" | "running" | "starting" | "building" | "preparing";
  ready: boolean;
  control: "member" | "owner";
  progress?: string;
  error?: string;
  works?: DesktopWork[];
  preview_allowed?: boolean;
  /** Whether the owner has allowed this member its computer. */
  granted?: boolean;
}
export interface DesktopSession { session: string; url: string }
const STATUS_KEY = { stopped: "desktop.stopped", unavailable: "desktop.unavailable", connecting: "desktop.connecting", starting: "desktop.starting", building: "desktop.building", preparing: "desktop.preparing", owner: "desktop.owner", member: "desktop.member" } as const;

export function preparationHTML(state: DesktopState): string {
  const stages = ["starting", "building", "preparing"] as const;
  const at = stages.indexOf(state.state as typeof stages[number]);
  const percent = state.progress?.match(/\b(\d{1,3}(?:\.\d+)?)%/);
  const value = percent ? Math.min(100, Number(percent[1])) : undefined;
  return `<div class="desktop-preparation"><span class="spin" aria-hidden="true"></span>` +
    `<ol>${stages.map((stage, index) => `<li data-stage="${index < at ? "done" : index === at ? "current" : "next"}"${index === at ? ' aria-current="step"' : ""}>${esc(t(STATUS_KEY[stage]))}</li>`).join("")}</ol>` +
    `<progress aria-label="${esc(t(STATUS_KEY[stages[Math.max(0, at)]]))}" max="100"${value === undefined ? "" : ` value="${value}"`}></progress>` +
    (state.progress ? `<p class="desktop-build-progress">${esc(state.progress)}</p>` : "") +
    (state.state === "building" ? `<p>${esc(t("desktop.firstBuild"))}</p>` : "") + `</div>`;
}

export function mountDesktopViewer(host: HTMLElement, member: () => number,
  options: { timeline: HTMLElement; conversation: () => number | undefined; name: () => string; openPanel(): void; panelVisible(): boolean; available?(on: boolean): void }): { show(): void; hide(close?: boolean): void; refresh(): void; sync(): void; view(next: "computer" | "details"): void; viewing(): "computer" | "details" } {
  const panel = document.createElement("section");
  panel.className = "desktop-panel"; panel.hidden = true;
  panel.innerHTML = `<div class="desktop-heading"><h2></h2>${iconButton("expand", t("desktop.expand"), ' data-desktop="expand"')}</div>` +
    `<p class="desktop-request" role="status" hidden></p><div class="desktop-screen"><img class="desktop-last" alt="" hidden><div class="desktop-placeholder"></div>` +
    `<iframe referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" hidden></iframe>` +
    `<button type="button" class="btn desktop-hit" data-desktop="take" hidden></button><span class="desktop-owner" role="status" hidden></span></div>` +
    `<p class="desktop-error" role="alert" hidden></p><div class="desktop-actions">${btn("", "sm", ' data-desktop="revoke" hidden')}${btn("", "sm", ' data-desktop="retry" hidden')}${btn("", "sm pri", ' data-desktop="return" hidden')}</div>`;
  const frame = panel.querySelector<HTMLIFrameElement>('iframe')!;
  frame.remove();
  (host.querySelector('.mb-det-scroll') ?? host).prepend(panel);
  const hit = panel.querySelector<HTMLButtonElement>('[data-desktop="take"]')!;
  const action = panel.querySelector<HTMLButtonElement>('[data-desktop="return"]')!;
  const retry = panel.querySelector<HTMLButtonElement>('[data-desktop="retry"]')!;
  const revoke = panel.querySelector<HTMLButtonElement>('[data-desktop="revoke"]')!;
  const error = panel.querySelector<HTMLElement>('.desktop-error')!;
  const timeline = mountDesktopTimeline(options.timeline, options.name);
  let visible = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let state: DesktopState | undefined, session: DesktopSession | undefined;
  let connected = false, interactive = false, changing = false, loading = false, opening = false;
  let closePending: Promise<unknown> = Promise.resolve(), clickedAt = 0;
  const revealed = new Set<string>();
  // Left for a moment, the stream stays: coming back then costs no reconnect at all.
  const LINGER_MS = 120_000;
  const lastFrames = new Map<number, string>();
  let lingering: ReturnType<typeof setTimeout> | undefined, streamMember: number | undefined, streamConversation: number | undefined;
  const last = panel.querySelector<HTMLImageElement>('.desktop-last')!;
  let viewing: "computer" | "details" = "details";
  const setView = (next: "computer" | "details"): void => { viewing = next; host.dataset.detView = next; };
  setView("details");
  const pending = (): DesktopWork | undefined => state?.works?.find(work => work.state === "waiting_control");
  const active = (): boolean => visible && options.panelVisible();
  const send = (held: boolean, pointer?: { x:number; y:number }): void => { if (session) frame.contentWindow?.postMessage({ type:"raphael-desktop-control", held, pointer }, new URL(session.url).origin); };

  function draw(): void {
    panel.hidden = !visible || !state || state.state === "absent";
    panel.querySelector('h2')!.textContent = t("desktop.screenOf", { p0: options.name() });
    const absent = !state || state.state === "absent";
    options.available?.(visible && !absent);
    if (absent && viewing === "computer") setView("details");
    frame.title = t("desktop.open"); hit.setAttribute('aria-label', t("desktop.take"));
    const expand = panel.querySelector<HTMLButtonElement>('[data-desktop="expand"]')!;
    expand.title = t(panel.hasAttribute('data-expanded') ? "members.close" : "desktop.expand"); expand.setAttribute('aria-label', expand.title);
    const request = panel.querySelector<HTMLElement>('.desktop-request')!;
    request.hidden = !pending(); request.textContent = pending() ? desktopWorkText(pending()!) : "";
    panel.toggleAttribute("data-request", !!pending());
    const running = state?.state === "running", owner = state?.control === "owner";
    const preparing = state && ["starting", "building", "preparing"].includes(state.state);
    const label = preparing ? state!.state as "starting" | "building" | "preparing" : !running ? state?.state === "stopped" || state?.state === "missing" ? "stopped" : "unavailable" : !connected ? "connecting" : owner ? "owner" : "member";
    panel.dataset.desktopState = label;
    panel.dataset.interactive = String(interactive);
    hit.hidden = !running || !connected || owner; hit.disabled = changing;
    frame.hidden = !running || !connected;
    frame.style.pointerEvents = interactive ? "auto" : "none";
    const status = panel.querySelector<HTMLElement>('.desktop-owner')!;
    status.textContent = t("desktop.operating"); status.hidden = !owner || !connected;
    action.textContent = t(pending() ? "desktop.done" : "desktop.release"); action.hidden = !owner; action.disabled = changing;
    const asleep = state?.state === "stopped" || state?.state === "missing";
    retry.textContent = t(asleep ? "desktop.start" : "desktop.retry"); retry.hidden = !!running || !!preparing; retry.disabled = opening;
    revoke.textContent = t("desktop.revoke"); revoke.hidden = !state?.granted || owner || !!preparing;
    const placeholder = panel.querySelector<HTMLElement>('.desktop-placeholder')!;
    const picture = running && !connected ? lastFrames.get(member()) : undefined;
    last.hidden = !picture;
    if (picture && last.src !== picture) last.src = picture;
    placeholder.hidden = (!!running && connected) || !!picture;
    placeholder.innerHTML = preparing ? preparationHTML(state!) : esc(t(!running && state?.error ? state.error === "build_failed" || state.error === "pull_failed" ? "desktop.buildFailed" : "desktop.startFailed" : STATUS_KEY[label]));
    if (!running && frame.hasAttribute('src')) { frame.remove(); frame.removeAttribute('src'); connected = interactive = false; }
    if (running && session && !frame.hasAttribute('src') && active()) { frame.src = session.url; panel.querySelector('.desktop-screen')!.append(frame); }
  }
  function closeStream(): void {
    clearTimeout(lingering);
    generation++; send(false); frame.remove(); frame.removeAttribute('src'); connected = interactive = false;
    const previous = session; session = undefined;
    if (previous) closePending = closePending.then(() => api.desktopClose(previous.session)).catch(() => {});
    panel.removeAttribute('data-expanded'); document.documentElement.removeAttribute('data-desktop-expanded');
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
      // Reconnecting is always view-only. Only a fresh click may reacquire input.
    }
    draw();
  }
  window.addEventListener('message', message);
  async function openStream(): Promise<void> {
    if (session || opening || !active()) return;
    opening = true;
    const current = generation, id = member();
    try {
      await closePending;
      const opened = await api.desktopOpen(id, { conversation_id: options.conversation() });
      if (current !== generation || id !== member() || !active()) { await api.desktopClose(opened.session); return; }
      session = opened; streamMember = id; streamConversation = options.conversation();
    } catch { error.textContent = t('desktop.unavailable'); error.hidden = false; }
    finally { opening = false; if (current === generation) draw(); }
  }
  function update(next: DesktopState): void {
    state = next; timeline.update(next);
    for (const work of next.works ?? []) {
      const key = `${work.id}:${work.request_id ?? ''}:${work.state === 'waiting_control' ? 'help' : 'work'}`;
      if (visible && ["running", "waiting_control"].includes(work.state) && !revealed.has(key)) { revealed.add(key); setView("computer"); options.openPanel(); }
    }
    // Looking never starts a computer: only a running one is streamed, and only a press starts one.
    if (active() && next.state === 'running') void openStream();
    draw();
  }
  async function poll(): Promise<void> {
    if ((!visible && !session) || loading) return;
    loading = true;
    const current = generation, id = member();
    try {
      const next = session ? await api.desktopRenew(session.session) : await api.desktopStatus(id, options.conversation());
      if ((visible || session) && current === generation && id === member()) update(next);
    } catch {
      if (current === generation) { closeStream(); state = { state:'unavailable', ready:false, control:'member' }; draw(); }
    } finally { loading = false; if (visible || session) { clearTimeout(timer); timer = setTimeout(() => void poll(), 2000); } }
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
      if (current === generation) { error.textContent = t('desktop.busy'); error.hidden = false; }
    } finally { changing = false; if (current === generation) draw(); }
  }
  const expand = (on: boolean): void => {
    panel.toggleAttribute('data-expanded', on);
    document.documentElement.toggleAttribute('data-desktop-expanded', on);
  };
  hit.addEventListener('click', event => {
    const box = hit.getBoundingClientRect();
    // A small picture is no place to work: the same stream fills the window, under the owner's hands.
    expand(true);
    void control(true, { x:box.width ? Math.max(0, Math.min(1, (event.clientX-box.left)/box.width)) : 0.5, y:box.height ? Math.max(0, Math.min(1, (event.clientY-box.top)/box.height)) : 0.5 });
  });
  action.addEventListener('click', () => { expand(false); void control(false); });
  retry.addEventListener('click', () => { closeStream(); void openStream(); });
  revoke.addEventListener('click', () => {
    void api.desktopRevoke(member()).then(() => { if (state) state = { ...state, granted: false }; draw(); })
      .catch(() => { error.textContent = t('desktop.busy'); error.hidden = false; });
  });
  panel.querySelector('[data-desktop="expand"]')!.addEventListener('click', () => {
    expand(!panel.hasAttribute('data-expanded')); draw();
  });
  onLocaleChange(draw);
  return {
    show() { visible = true; clearTimeout(lingering); clearTimeout(timer); void poll(); },
    hide(close = false) { visible = false; if (close) closeStream(); else leave(); timeline.clear(); panel.hidden = true; options.available?.(false); },
    refresh() {
      // Back to the conversation whose stream is still open: nothing to reconnect.
      if (session && streamMember === member() && streamConversation === options.conversation()) { clearTimeout(lingering); draw(); return; }
      closeStream(); state = undefined; revealed.clear(); timeline.clear(); clearTimeout(timer); draw(); if (visible) void poll();
    },
    sync() { timeline.sync(); if (!active() && session) leave(); else { clearTimeout(lingering); if (active() && state?.state === 'running') void openStream(); } draw(); },
    view: setView,
    viewing: () => viewing,
  };
}
