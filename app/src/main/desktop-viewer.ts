/** A member's optional desktop inside the existing conversation dialog. */
import * as api from "./api";
import { onLocaleChange, t } from "./i18n";
import { openDialog, type Dialog } from "./member-dialogs";
import { esc, iconButton } from "./ui";
import "./desktop-viewer.css";

export interface DesktopState {
  state: "absent" | "unavailable" | "missing" | "stopped" | "incompatible" | "running" | "starting" | "building" | "preparing";
  ready: boolean;
  control: "member" | "owner";
  progress?: string;
  error?: string;
}
export interface DesktopSession { session: string; url: string }
const STATUS_KEY = { stopped: "desktop.stopped", unavailable: "desktop.unavailable", connecting: "desktop.connecting", starting: "desktop.starting", building: "desktop.building", preparing: "desktop.preparing", owner: "desktop.owner", member: "desktop.member" } as const;

export function mountDesktopViewer(host: HTMLElement, member: () => number): { show(): void; hide(): void; refresh(): void } {
  host.insertAdjacentHTML("afterbegin", iconButton("monitor", t("desktop.open"), ' data-desktop="open" hidden', "ra-tool"));
  const entry = host.querySelector<HTMLButtonElement>('[data-desktop="open"]')!;
  onLocaleChange(() => { entry.setAttribute("aria-label", t("desktop.open")); entry.title = t("desktop.open"); });
  let visible = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let dialog: Dialog | undefined, session: DesktopSession | undefined;
  let state: DesktopState | undefined, frame: HTMLIFrameElement | undefined;
  let connected = false, loading = false, changing = false;
  let connectingSince = 0;
  let closePending: Promise<unknown> = Promise.resolve();

  function draw(): void {
    if (!dialog) return;
    const running = state?.state === "running";
    const preparing = state?.state === "starting" || state?.state === "building" || state?.state === "preparing";
    const label = preparing ? state!.state as "starting" | "building" | "preparing" : !running ? (state?.state === "stopped" || state?.state === "missing" ? "stopped" : "unavailable")
      : !connected ? "connecting" : state?.control === "owner" ? "owner" : "member";
    dialog.el.dataset.desktopState = label;
    const status = dialog.el.querySelector<HTMLElement>(".desktop-status")!;
    status.textContent = t(STATUS_KEY[label]);
    status.hidden = !running;
    const action = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="control"]')!;
    action.textContent = t(state?.control === "owner" ? "desktop.release" : !running ? "desktop.retry" : "desktop.take");
    action.hidden = state?.control !== "owner" && (preparing || running && !connected);
    action.disabled = changing || state?.control !== "owner" && running && !connected;
    frame!.hidden = !running || !connected;
    const placeholder = dialog.el.querySelector<HTMLElement>(".desktop-placeholder")!;
    placeholder.hidden = !!running && connected;
    const failure = state?.error === "build_failed" || state?.error === "pull_failed" ? "desktop.buildFailed" : "desktop.startFailed";
    placeholder.textContent = t(!running && state?.error ? failure : STATUS_KEY[label]) + (state?.progress ? `\n${state.progress}` : "");
    if (!running && frame!.hasAttribute("src")) {
      frame!.removeAttribute("src");
      connected = false;
    }
    // Retry failed initial HTML/module loads too, before the RFB reconnect loop exists.
    if (running && !connected && frame!.hasAttribute("src") && Date.now() - connectingSince >= 30000) frame!.removeAttribute("src");
    if (running && session && !frame!.hasAttribute("src")) {
      connectingSince = Date.now();
      frame!.src = session.url;
    }
  }

  function close(): void {
    generation++;
    window.removeEventListener("message", message);
    frame?.contentWindow?.postMessage({ type: "raphael-desktop-disable" }, session ? new URL(session.url).origin : "*");
    frame?.removeAttribute("src");
    const previous = session;
    session = undefined;
    dialog = undefined;
    frame = undefined;
    connected = false;
    if (previous) closePending = api.desktopClose(previous.session).catch(() => {});
  }

  function message(event: MessageEvent): void {
    if (!session || !frame || event.source !== frame.contentWindow || event.origin !== new URL(session.url).origin
      || event.data?.type !== "raphael-desktop") return;
    connected = event.data.state === "connected";
    draw();
  }

  async function poll(): Promise<void> {
    if (!visible || loading) return;
    loading = true;
    const current = generation, id = member();
    try {
      const next = session ? await api.desktopRenew(session.session) : await api.desktopStatus(id);
      if (!visible || current !== generation || id !== member()) return;
      state = next;
      entry.hidden = next.state === "absent";
      draw();
    } catch {
      if (current === generation) {
        state = { state: "unavailable", ready: false, control: "member" };
        draw();
        if (session && dialog) {
          const expired = session;
          session = undefined;
          await api.desktopClose(expired.session).catch(() => {});
          const reopened = await api.desktopOpen(id).catch(() => undefined);
          if (reopened) {
            if (visible && current === generation) session = reopened;
            else await api.desktopClose(reopened.session).catch(() => {});
          }
        }
      }
    } finally {
      loading = false;
      if (visible) timer = setTimeout(() => void poll(), 2000);
    }
  }

  entry.addEventListener("click", () => { void open(); });
  async function open(): Promise<void> {
    if (dialog || changing) return;
    changing = true;
    const current = generation, id = member();
    try {
      await closePending;
      const opened = await api.desktopOpen(id);
      if (!visible || current !== generation || id !== member()) {
        await api.desktopClose(opened.session);
        return;
      }
      session = opened;
      dialog = openDialog({
        title: t("desktop.open"), cls: "desktop-viewer",
        body: `<p class="desktop-status" role="status"></p><div class="desktop-screen"><div class="desktop-placeholder">${esc(t("desktop.connecting"))}</div><iframe title="${esc(t("desktop.open"))}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" hidden></iframe></div><p class="desktop-error" role="alert" hidden></p>`,
        actions: { primary: { label: t("desktop.take"), attrs: ' data-dlg="control" disabled' } },
        onAct: action => { if (action === "control") void control(); }, onClose: close,
      });
      frame = dialog.el.querySelector("iframe")!;
      window.addEventListener("message", message);
      draw();
    } catch {
      entry.setAttribute("aria-label", t("desktop.unavailable"));
    } finally { changing = false; if (current === generation) draw(); }
  }

  async function control(): Promise<void> {
    if (!session || changing || !dialog) return;
    changing = true;
    const current = generation, opened = session;
    const held = state?.control !== "owner";
    frame?.contentWindow?.postMessage({ type: "raphael-desktop-disable" }, new URL(opened.url).origin);
    draw();
    try {
      if (state?.state !== "running" && state?.control !== "owner") {
        await api.desktopClose(opened.session);
        const next = await api.desktopOpen(member());
        if (current !== generation) { await api.desktopClose(next.session); return; }
        session = next;
        state = { state: "preparing", ready: false, control: "member" };
        return;
      }
      const next = await api.desktopControl(opened.session, held);
      if (current !== generation) return;
      state = next;
      connected = false;
      frame!.removeAttribute("src");
      dialog.el.querySelector<HTMLElement>(".desktop-error")!.hidden = true;
    } catch {
      if (current === generation && dialog) {
        const error = dialog.el.querySelector<HTMLElement>(".desktop-error")!;
        error.textContent = t("desktop.busy");
        error.hidden = false;
      }
    } finally { changing = false; if (current === generation) draw(); }
  }

  return {
    show() { visible = true; clearTimeout(timer); entry.setAttribute("aria-label", t("desktop.open")); void poll(); },
    hide() { visible = false; generation++; clearTimeout(timer); dialog?.close(); entry.hidden = true; },
    refresh() { generation++; dialog?.close(); clearTimeout(timer); entry.hidden = true; if (visible && !loading) void poll(); },
  };
}
