// The sidebar shows downloaded or available updates. Only a press requests an
// installation. While members finish, the same button lets the owner cancel.
import * as api from "./api";
import { onLocaleChange, t } from "./i18n";
import { esc, ico, patchHTML } from "./ui";
import { updateErrorText, UPDATE_STATUS_MS } from "./updates";

export function updateNoticeHTML(view: api.UpdateView | null, busy = false): string {
  const version = view?.version && view.state !== "installing" ? view.version : "";
  if (!version) return "";
  const waiting = view?.state === "waiting";
  const label = waiting ? t("update.waiting") : busy ? t("update.downloading")
    : view?.state === "error" ? updateErrorText(view.error) : t("update.found", { p0: version });
  const action = waiting ? t("update.cancel") : t("update.now");
  return `<button type="button" class="nav sidebar-update-btn" data-update-now aria-label="${esc(label + " " + action)}" title="${esc(label)}"${busy ? " disabled" : ""}>${ico(waiting ? "x" : "download")}` +
    `<span class="nav-t"${waiting ? " data-update-waiting" : ""}>${esc(label)}</span><span class="sidebar-update-act">${esc(action)}</span></button>`;
}

export function mountUpdateNotice(slot: HTMLElement): () => void {
  let view: api.UpdateView | null = null, busy = false;
  const draw = (): void => {
    const html = updateNoticeHTML(view, busy);
    slot.hidden = !html;
    // Read again whenever the window returns to the front: the button on screen is patched, never swapped for an equal one
    // (an innerHTML compare never matched, since the browser writes the markup back differently).
    patchHTML(slot, html);
  };
  let revision = 0;
  const read = async (): Promise<void> => {
    if (busy) return;
    const mine = ++revision;
    try {
      const next = await api.updateControl("status");
      if (mine !== revision) return;
      view = next;
      draw();
    } catch { /* Keep the last known state until native services answer again. */ }
  };
  slot.addEventListener("click", (event) => {
    if (busy || !(event.target as Element).closest("[data-update-now]")) return;
    const action = view?.state === "waiting" ? "cancel" : "install";
    revision++;
    busy = true; draw();
    void api.updateControl(action).then((next) => { view = next; }).catch(() => {}).finally(() => { busy = false; draw(); });
  });
  const timer = setInterval(() => void read(), UPDATE_STATUS_MS);
  const focus = (): void => void read();
  window.addEventListener("focus", focus);
  const stopLocale = onLocaleChange(draw);
  void read();
  return () => { clearInterval(timer); window.removeEventListener("focus", focus); stopLocale(); revision++; };
}
