// The code of a device sign-in (GitHub's). The core signs in one service at a time, and whoever started it (the apps'
// dialog, a chat's card, the guide, a template) the core tells the window the code (`DeviceCode`) and, however it ended,
// that it ended (`DeviceDone`). So the code has one place: this dialog over the window, with the code in keycaps and the
// one button that copies it and opens the service's page. Closing it ends the sign-in; a core that started again has none.

import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { type Dialog, openDialog } from "./member-dialogs";
import type { MainEvent } from "./types";
import { btn, copyButton, esc, toaster } from "./ui";
import "./device-login.css";

type CodeEvent = Extract<MainEvent, { type: "DeviceCode" }>;

let shown: { dialog: Dialog; code: CodeEvent } | null = null;

/** The dialog's body: what to do with the code, and the code in keycaps (a dash between its halves). */
export function deviceCodeHTML(code: Pick<CodeEvent, "user_code">): string {
  const caps = [...code.user_code].map((ch) => (ch === "-" ? '<span class="dl-dash">-</span>' : `<span class="dl-cap">${esc(ch)}</span>`)).join("");
  return `<p class="dl-hint">${esc(t("conn.device.hint"))}</p><div class="dl-code" aria-label="${esc(code.user_code)}">${caps}</div>`;
}

/** Takes the code down without ending the sign-in: the core ended it, or a newer code takes its place. */
function takeDown(): void {
  const was = shown;
  shown = null;
  was?.dialog.close();
}

function show(code: CodeEvent): void {
  takeDown();
  const dialog = openDialog({
    title: t("conn.connectAria", { p0: code.name }),
    body: deviceCodeHTML(code),
    describedByBody: true,
    cls: "mb-confirm dl-dialog",
    noClose: true,
    actions: {
      secondary: btn(esc(t("conn.cancel")), "", ' data-dlg="cancel"'),
      primary: { label: esc(t("conn.device.open", { p0: code.name })), attrs: ' data-dlg="open"' },
    },
    onAct(act, target, self) {
      if (act === "open") void openPage(target, code);
      else self.close();
    },
    // Closed by the person (取消, Escape or a press beside it), not taken down: the sign-in ends with it.
    onClose() {
      if (shown?.dialog !== dialog) return;
      shown = null;
      api.integrationsConnectCancel().catch((err) => toaster.info(describeError(err)));
    },
  });
  shown = { dialog, code };
  dialog.el.querySelector<HTMLElement>('[data-dlg="open"]')?.focus();
}

/** Puts the code on the clipboard, so that it is pasted at the page that opens, and opens the page. */
async function openPage(button: HTMLElement, code: CodeEvent): Promise<void> {
  try {
    if (!await copyButton(button, code.user_code)) return;
    await api.openLink(code.verification_uri);
  } catch (err) {
    toaster.info(describeError(err));
  }
}

/** Follows the main window's events: a code comes up, and goes when its sign-in ended or the core started again. */
export function followDeviceLogin(event: MainEvent): void {
  if (event.type === "DeviceCode") show(event);
  else if ((event.type === "DeviceDone" && shown?.code.catalog_id === event.catalog_id) || (event.type === "CoreReady" && shown)) takeDown();
}
