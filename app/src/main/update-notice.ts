// A new version, said at the bottom left above Connect apps: 「新版本 1.3.0 · 更新」. The app checks
// on its own every hour (updates.rs, auto update on by default) and installs once the owner and every member are idle;
// this line lets the owner update now instead. It reads the native updater's state when the window opens, every ten
// minutes and whenever the window comes back to the front, and is hidden while there is nothing new.
import * as api from "./api";
import { onLocaleChange, t } from "./i18n";
import { esc, ico } from "./ui";

const EVERY_MS = 10 * 60_000;

export function updateNoticeHTML(view: api.UpdateView | null, busy = false): string {
  const version = view?.version && view.state !== "installing" ? view.version : "";
  if (!version) return "";
  return `<button type="button" class="nav sidebar-update-btn" data-update-now${busy ? " disabled" : ""}>${ico("download")}` +
    `<span class="nav-t">${esc(t("update.found", { p0: version }))}</span><span class="sidebar-update-act">${esc(t("update.now"))}</span></button>`;
}

export function mountUpdateNotice(slot: HTMLElement): () => void {
  let view: api.UpdateView | null = null, busy = false;
  const draw = (): void => {
    const html = updateNoticeHTML(view, busy);
    slot.hidden = !html;
    if (slot.innerHTML !== html) slot.innerHTML = html;
  };
  const read = async (): Promise<void> => {
    try { view = await api.updateControl("status"); } catch { view = null; }
    draw();
  };
  slot.addEventListener("click", (event) => {
    if (busy || !(event.target as Element).closest("[data-update-now]")) return;
    busy = true; draw();
    void api.updateControl("install").then((next) => { view = next; }).catch(() => {}).finally(() => { busy = false; draw(); });
  });
  const timer = setInterval(() => void read(), EVERY_MS);
  const focus = (): void => void read();
  window.addEventListener("focus", focus);
  const stopLocale = onLocaleChange(draw);
  void read();
  return () => { clearInterval(timer); window.removeEventListener("focus", focus); stopLocale(); };
}
