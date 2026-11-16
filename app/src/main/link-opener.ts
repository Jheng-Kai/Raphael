// The one way a link in the window opens: in the owner's browser, through the shell (`open_external_url`), which alone decides
// what may be opened (http and https with a host and no sign-in in it). The window itself never follows a link.
import * as api from "./api";
import { describeError } from "./format";
import { toaster } from "./ui";

/** A link of the words (`linkedText`, a message's link chip) or a button that opens an address. */
const LINK = '[data-act="open-url"]';

let installed = false;

/**
 * Listens on the whole document, before any row, card or panel under the link hears the press: a link inside something
 * that opens on a press opens only the link. A click, a Ctrl or Shift click and a middle click all open it the same way;
 * a right click is left to the app's own menu.
 */
export function installLinkOpener(): void {
  if (installed) return;
  installed = true;
  const press = (event: MouseEvent): void => {
    if (event.button !== (event.type === "auxclick" ? 1 : 0)) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>(LINK) : null;
    if (!link || (link as HTMLButtonElement).disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const url = link.dataset.url ?? "";
    if (/^https?:\/\//i.test(url)) void api.openExternalUrl(url).catch(error => toaster.info(describeError(error)));
  };
  document.addEventListener("click", press, true);
  document.addEventListener("auxclick", press, true);
}
