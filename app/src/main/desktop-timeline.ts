/** One live, read-only computer per private task; the full viewer owns input. */
import * as api from "./api";
import type { DesktopSession, DesktopState } from "./desktop-viewer";
import { t } from "./i18n";
import { btn, esc, ico } from "./ui";

export interface DesktopWork {
  id: string;
  turn_id: number;
  state: "running" | "waiting_control" | "returning" | "done" | "stopped" | "expired";
  tool: string;
  reason: "" | "sign_in" | "password" | "two_factor" | "captcha" | "payment" | "other";
  request_id?: string;
}

export function desktopWorkText(work: DesktopWork): string {
  if (work.state === "waiting_control") {
    const reasons = { sign_in: "desktop.need.sign_in", password: "desktop.need.password", two_factor: "desktop.need.two_factor",
      captcha: "desktop.need.captcha", payment: "desktop.need.payment", other: "desktop.need.other" } as const;
    return t(reasons[work.reason || "other"]);
  }
  if (work.state === "done") return t("desktop.finished");
  if (work.state === "stopped" || work.state === "expired") return t("desktop.ended");
  const actions = { click: "agent.computer.click", double_click: "agent.computer.click", type_text: "agent.computer.type",
    press_key: "agent.computer.keys", scroll: "agent.computer.scroll", get_desktop_state: "agent.computer.look" } as const;
  return work.tool in actions ? t(actions[work.tool as keyof typeof actions]) : t("desktop.working");
}

export function desktopCardHTML(work: DesktopWork): string {
  const waiting = work.state === "waiting_control";
  return `<div class="desktop-card" data-desktop-work="${esc(work.id)}" data-work-state="${work.state}" role="group" aria-label="${esc(t("desktop.open"))}">` +
    `<button type="button" class="btn desktop-preview" aria-label="${esc(t("desktop.open"))}"><span class="desktop-preview-empty">${ico("monitor")}</span></button>` +
    `<div class="desktop-card-meta"><span class="desktop-card-title">${ico("monitor")}${esc(t("card.pcTitle"))}</span>` +
    `<p class="desktop-card-state" role="status">${esc(desktopWorkText(work))}</p>` +
    `<div class="desktop-card-actions">${btn(esc(t(waiting ? "desktop.take" : "desktop.expand")), `sm${waiting ? " pri" : ""}`, ' data-desktop-card-open')}</div></div></div>`;
}

export function mountDesktopTimeline(host: HTMLElement, member: () => number, conversation: () => number | undefined,
  open: (work: DesktopWork) => void): { update(state: DesktopState): void; sync(): void; clear(): void } {
  let state: DesktopState | undefined, epoch = 0;
  const cards = new Map<string, { work: DesktopWork; el: HTMLElement; session?: DesktopSession; pending: boolean }>();
  host.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-desktop-work]");
    if (!target || !(event.target as Element).closest("button")) return;
    const card = cards.get(target.dataset.desktopWork!);
    if (card) open(card.work);
  });

  function clear(): void {
    epoch++;
    for (const card of cards.values()) {
      card.el.remove();
      if (card.session) void api.desktopClose(card.session.session).catch(() => {});
    }
    cards.clear(); state = undefined;
  }

  function sync(): void {
    if (!state) return;
    const works = state.works ?? [], keep = new Set(works.map(work => work.id));
    for (const [id, card] of cards) if (!keep.has(id)) {
      card.el.remove(); cards.delete(id);
      if (card.session) void api.desktopClose(card.session.session).catch(() => {});
    }
    for (const work of works) {
      const slot = host.querySelector<HTMLElement>(`[data-desktop-slot="${work.turn_id}"]`);
      if (!slot) continue;
      let card = cards.get(work.id);
      if (!card) {
        const template = document.createElement("template"); template.innerHTML = desktopCardHTML(work);
        card = { work, el: template.content.firstElementChild as HTMLElement, pending: false };
        cards.set(work.id, card);
      }
      card.work = work;
      card.el.dataset.workState = work.state;
      card.el.querySelector(".desktop-card-state")!.textContent = desktopWorkText(work);
      const action = card.el.querySelector<HTMLButtonElement>("[data-desktop-card-open]")!;
      action.textContent = t(work.state === "waiting_control" ? "desktop.take" : "desktop.expand");
      action.classList.toggle("pri", work.state === "waiting_control");
      if (card.el.parentElement !== slot) slot.append(card.el);
      // Never stream the owner's password/2FA/payment entry into an inline preview.
      const live = state.state === "running" && state.control === "member" && state.preview_allowed !== false && work.state === "running";
      if (!live && card.session) {
        void api.desktopClose(card.session.session).catch(() => {}); card.session = undefined;
        card.el.querySelector("iframe")?.remove();
      }
      if (live && card.session) void api.desktopRenew(card.session.session).catch(() => {
        if (card?.session) { void api.desktopClose(card.session.session).catch(() => {}); card.session = undefined; card.el.querySelector("iframe")?.remove(); }
      });
      if (live && !card.session && !card.pending) {
        card.pending = true;
        const current = epoch, item = card;
        void api.desktopOpen(member(), { conversation_id: conversation(), preview: true }).then(session => {
          if (current !== epoch || !item.el.isConnected || item.work.state !== "running" || state?.control !== "member" || state.preview_allowed === false) {
            void api.desktopClose(session.session).catch(() => {}); return;
          }
          item.session = session;
          const frame = document.createElement("iframe");
          frame.title = t("desktop.open"); frame.tabIndex = -1; frame.referrerPolicy = "no-referrer";
          frame.setAttribute("sandbox", "allow-scripts allow-same-origin"); frame.src = session.url;
          item.el.querySelector(".desktop-preview")!.append(frame);
        }).catch(() => {}).finally(() => { item.pending = false; });
      }
    }
  }
  return { update(next) { state = next; sync(); }, sync, clear };
}
