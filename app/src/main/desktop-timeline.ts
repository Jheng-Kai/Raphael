/** The handoff card of either computer, rendered in its work's turn. Work the member does on its own shows in the
 *  Computer tab, which opens when the work begins, and puts no card in the conversation. */
import type { DesktopState } from "./desktop-viewer";
import { t } from "./i18n";
import { esc, ico } from "./ui";
import { btn, patchHTML } from "./ui";
import { cardHTML, cardPromptText, waitingCloseHTML } from "./card";

export interface DesktopWork {
  id: string;
  turn_id: number;
  state: "running" | "waiting_control" | "returning" | "done" | "stopped" | "expired";
  tool: string;
  reason: "" | "sign_in" | "password" | "two_factor" | "captcha" | "payment" | "certificate" | "other";
  transport?: "host";
  detail?: string;
  request_id?: string;
}

export function desktopWorkText(work: DesktopWork): string {
  if (work.state === "waiting_control") {
    if (work.detail) return work.detail;
    if (work.reason === "certificate") return t("memberComputer.certificate", { p0: "Chrome", p1: t("desktop.done") });
    const reasons = { sign_in: "desktop.need.sign_in", password: "desktop.need.password", two_factor: "desktop.need.two_factor",
      captcha: "desktop.need.captcha", payment: "desktop.need.payment", other: "desktop.need.other" } as const;
    return t(reasons[work.reason || "other"]);
  }
  if (work.state === "done") return t("desktop.finished");
  if (work.state === "stopped" || work.state === "expired") return t("desktop.ended");
  // The line already says whose computer it is.
  const actions = { click: "desktop.doing.click", double_click: "desktop.doing.click", type_text: "desktop.doing.type",
    press_key: "desktop.doing.keys", scroll: "desktop.doing.scroll", get_desktop_state: "desktop.doing.look" } as const;
  return work.tool in actions ? t(actions[work.tool as keyof typeof actions]) : t("desktop.working");
}

export function mountDesktopTimeline(host: HTMLElement): { update(state: DesktopState): void; sync(): void; clear(): void } {
  let state: DesktopState | undefined;
  const rendered = new WeakMap<Element, string>();
  function sync(): void {
    for (const slot of host.querySelectorAll<HTMLElement>("[data-desktop-slot]")) {
      const work = state?.works?.find(work => work.state === "waiting_control" && String(work.turn_id) === slot.dataset.desktopSlot);
      const html = work ? cardHTML({ title: t("card.pcTitle"), status: "waiting", statusText: cardPromptText("computer"), body: desktopWorkText(work),
        content: `<div class="card-computer-screen" data-card-desktop-screen><button type="button" class="btn" data-card-desktop="take" aria-label="${esc(t("cards.takeover"))}">${ico("monitor")}</button></div>`,
        actions: btn(esc(t("cards.takeover")), "sm pri", ' data-card-desktop="take"') + btn(esc(t("desktop.done")), "sm", ' data-card-desktop="return"'),
        close: waitingCloseHTML(' data-card-desktop="skip"', t("cards.skip")), statusInHeading: true,
        cls: "computer-card", attrs: ` data-desktop-work="${esc(work.id)}" data-work-state="${work.state}"`,
      }) : "";
      if (rendered.get(slot) === html) continue;
      patchHTML(slot, html); rendered.set(slot, html);
    }
  }
  return { update(next) { state = next; sync(); }, sync, clear() { state = undefined; sync(); } };
}
