/** Metadata-only system events; live pixels belong to the member side panel. */
import type { DesktopState } from "./desktop-viewer";
import { t } from "./i18n";
import { NAME, eventLineHTML } from "./event-line";
import { esc, ico } from "./ui";

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

export function mountDesktopTimeline(host: HTMLElement, name: () => string): { update(state: DesktopState): void; sync(): void; clear(): void } {
  let state: DesktopState | undefined;
  function sync(): void {
    if (!state) return;
    for (const slot of host.querySelectorAll<HTMLElement>("[data-desktop-slot]")) {
      const work = state.works?.find(work => String(work.turn_id) === slot.dataset.desktopSlot);
      if (!work) { slot.replaceChildren(); continue; }
      slot.innerHTML = `<div class="conversation-event-line" data-desktop-work="${esc(work.id)}" data-work-state="${work.state}">` +
        eventLineHTML(t("desktop.event", { p0: NAME }), ico("monitor"), name(), desktopWorkText(work)) + `</div>`;
    }
  }
  return { update(next) { state = next; sync(); }, sync, clear() { state = undefined; host.querySelectorAll('[data-desktop-work]').forEach(el => el.remove()); } };
}
