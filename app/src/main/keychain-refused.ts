// The owner refused Raphael the macOS Keychain (R-PRIV-KEYCHAIN-01). The core then asks nothing more and turns every read
// of a secret away (core keychain.py), and the window says so in one toast with the one way to be asked again: 再問一次
// lifts the refusal, and the next read that needs a key asks once more. The core tells again at most once a minute while
// a feature needs a key, so the toast comes back where it is needed; one toast stands at a time.

import * as api from "./api";
import { t } from "./i18n";
import { btn, esc, toaster } from "./ui";

export function keychainRefusedHTML(): string {
  return `<span class="keychain-refused" role="status">${esc(t("keychain.refused"))}</span>` +
    btn(esc(t("keychain.askAgain")), "sm", " data-keychain-ask-again");
}

/** Shows the refusal, unless its toast is on screen already; its button asks the core to ask again. */
export function warnKeychainRefused(doc: Document = document): void {
  if (doc.querySelector(".toast .keychain-refused")) return;
  toaster.notice(keychainRefusedHTML);
  const toast = [...doc.querySelectorAll<HTMLElement>(".toast")].find(shown => shown.querySelector(".keychain-refused"));
  toast?.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-keychain-ask-again]");
    if (!button || button.disabled) return;
    button.disabled = true;
    api.keychainAskAgain().then(() => { toast.remove(); toaster.info(t("keychain.asked")); }, () => { button.disabled = false; });
  });
}
