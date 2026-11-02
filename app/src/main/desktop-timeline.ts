/** Working events stay compact; owner handoffs use the shared card and existing live stream. */
import type { DesktopState } from "./desktop-viewer";
import { t } from "./i18n";
import { NAME, eventLineHTML } from "./event-line";
import { esc, ico } from "./ui";
import { btn, patchHTML } from "./ui";
import { cardDisclosureHTML, cardHTML, cardPromptText } from "./card";

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
  // The line already says whose computer it is.
  const actions = { click: "desktop.doing.click", double_click: "desktop.doing.click", type_text: "desktop.doing.type",
    press_key: "desktop.doing.keys", scroll: "desktop.doing.scroll", get_desktop_state: "desktop.doing.look" } as const;
  return work.tool in actions ? t(actions[work.tool as keyof typeof actions]) : t("desktop.working");
}

export function mountDesktopTimeline(host: HTMLElement, name: () => string): { update(state: DesktopState): void; sync(): void; clear(): void } {
  let state: DesktopState | undefined;
  const rendered = new WeakMap<Element, string>();
  const asked = new Set<string>();
  function sync(): void {
    if (!state) return;
    for (const slot of host.querySelectorAll<HTMLElement>("[data-desktop-slot]")) {
      const work = state.works?.find(work => String(work.turn_id) === slot.dataset.desktopSlot);
      if (work?.state === "waiting_control") asked.add(work.id);
      const html = !work ? "" : work.state === "waiting_control" ? cardHTML({ title: t("card.pcTitle"), status: "waiting", statusText: cardPromptText("computer"), body: desktopWorkText(work),
        content: `<div class="card-computer-screen" data-card-desktop-screen><button type="button" class="btn" data-card-desktop="take" aria-label="${esc(t("cards.takeover"))}">${ico("monitor")}</button></div>`,
        actions: btn(esc(t("cards.takeover")), "sm pri", ' data-card-desktop="take"') + btn(esc(t("desktop.done")), "sm", ' data-card-desktop="return"') + btn(esc(t("cards.skip")), "sm card-quiet", ' data-card-desktop="skip"'),
        cls: "computer-card", attrs: ` data-desktop-work="${esc(work.id)}" data-work-state="${work.state}"`,
      }) : (asked.has(work.id) || !!work.request_id) ? cardHTML({ title: t("card.pcTitle"), status: "done", statusText: t("cards.done"),
        content: cardDisclosureHTML(`computer-${work.id}`, `<p class="card-body">${esc(desktopWorkText(work))}</p>`),
        cls: "computer-card", attrs: ` data-desktop-work="${esc(work.id)}" data-work-state="${work.state}"`,
      }) : `<div class="conversation-event-line" data-desktop-work="${esc(work.id)}" data-work-state="${work.state}">` +
        eventLineHTML(t("desktop.event", { p0: NAME }), ico("monitor"), name(), desktopWorkText(work)) + `</div>`;
      if (rendered.get(slot) === html) continue;
      patchHTML(slot, html); rendered.set(slot, html);
    }
  }
  return { update(next) { state = next; sync(); }, sync, clear() { state = undefined; asked.clear(); host.querySelectorAll('[data-desktop-work]').forEach(el => el.remove()); } };
}
