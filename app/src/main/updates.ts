import * as api from "./api";
import { t } from "./i18n";
import { btn, esc, row, tg, toaster } from "./ui";

export function updateHTML(view: api.UpdateView | null, automatic: boolean, currentVersion = ""): string {
  if (view?.state === "error" && view.error === "not_configured") {
    return `<section class="sgroup" data-updates><h2>${esc(t("update.title"))}</h2><div class="slist">` +
      row(esc(t("update.currentVersion", { p0: currentVersion })), t("update.releasePageHint"),
        btn(t("update.openReleases"), "", ' data-act="update-releases"')) + `</div></section>`;
  }
  const state = view?.state ?? "idle";
  const busy = ["checking", "downloading", "installing"].includes(state);
  const available = !!view?.version;
  // No heading over the row that already says 應用程式更新.
  return `<section class="sgroup" data-updates aria-label="${esc(t("update.title"))}"><div class="slist">` +
    row(available ? t("update.found", {p0:view!.version}) : t("update.title"),
      state === "error" ? t(view?.error === "busy" ? "update.busy" : view?.error === "version" ? "update.versionError" : view?.error === "verification" ? "update.signatureError" : "update.feedError") : t(state === "ready" ? "update.ready" : state === "downloading" ? "update.downloading" : state === "checking" ? "update.checking" : available ? "update.available" : "update.current"),
      btn(t(available ? state === "ready" ? "update.restart" : "update.install" : "update.check"), "", ` data-act="${available ? "update-install" : "update-check"}"${busy ? " disabled" : ""}`)) +
    row(t("update.auto"), t("update.autoHelp"), tg(automatic, t("update.auto"), ' data-k="auto-update"')) + `</div>` +
    (view?.notes ? `<p class="note update-notes">${esc(view.notes)}</p>` : "") + `</section>`;
}

export async function installedUpdateNotice(): Promise<void> {
  if (document.hidden) {
    const visible = (): void => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", visible);
      void installedUpdateNotice();
    };
    document.addEventListener("visibilitychange", visible);
    return;
  }
  try { const status = await api.updateControl("status"); if (status.installed) toaster.info(t("update.installed", {p0:status.installed})); } catch { /* A page can start before native services are ready. */ }
}
