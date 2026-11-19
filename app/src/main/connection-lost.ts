// A connected app's account stopped working at Composio (R-ACCT-04). The core reads the accounts on its own, a minute after
// start and every twenty minutes, and tells the window once (`ConnectionLost`). One toast says which app, with the one way
// back: 重新登入 opens that app's page and signs in again in place of the account that stopped. One toast an app at a time.

import { t } from "./i18n";
import { btn, esc, toaster } from "./ui";

export function connectionLostHTML(name: string, id: string): string {
  return `<span class="connection-lost" role="status">${esc(t("conn.lost", { p0: name }))}</span>` +
    btn(esc(t("conn.relogin")), "sm", ` data-connection-relogin="${esc(id)}"`);
}

const toastOf = (doc: Document, id: string): HTMLElement | undefined =>
  [...doc.querySelectorAll<HTMLElement>(".toast")].find(toast =>
    [...toast.querySelectorAll<HTMLElement>("[data-connection-relogin]")].some(button => button.dataset.connectionRelogin === id));

/** Says that `name` stopped working, unless its toast is on screen already; its button runs `relogin` with the app's id. */
export function warnConnectionLost(lost: { id: string; name: string }, relogin: (id: string) => void, doc: Document = document): void {
  if (toastOf(doc, lost.id)) return;
  toaster.notice(() => connectionLostHTML(lost.name, lost.id));
  const toast = toastOf(doc, lost.id);
  toast?.addEventListener("click", event => {
    if (!(event.target as Element).closest("[data-connection-relogin]")) return;
    toast.remove();
    relogin(lost.id);
  });
}
