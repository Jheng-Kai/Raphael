import * as api from "./api";
import { mountInlineConnectionSetup } from "./connection-setup";
import { cardFailure } from "./card";
import { describeError } from "./format";
import { t } from "./i18n";
import { mountMailActions } from "./mail-actions";
import { toaster } from "./ui";

// A secret program key's least length, as the core's vault keeps it (computer/vault_entries.py KEY_MIN).
const KEY_MIN = 6;

/** Room cards use the same services and forms as private conversations. */
export function mountConversationCardActions(thread: HTMLElement, _manageConnections: () => void): void {
  mountInlineConnectionSetup(thread, async (id, fields) => {
    const result = await api.cardConnect(id, fields);
    return { connected: result.started || !["pending", "failed", "cancelled"].includes(result.card.state) };
  });
  mountMailActions(thread, error => toaster.info(describeError(error)), text => toaster.info(text));
  // Save waits for every field; a secret program key also for its six characters, said under it while it is shorter (#281).
  // A key marked as no secret is shown as typed and may be short.
  const fieldsChanged = (event: Event): void => {
    const input = (event.target as Element).closest<HTMLInputElement>("input[data-secret-input], input[data-login-user], input[data-secret-plain]");
    const card = input?.closest(".secret-card");
    const save = card?.querySelector<HTMLButtonElement>('[data-act="card-save"]');
    if (!card || !save) return;
    const secret = card.querySelector<HTMLInputElement>("input[data-secret-input]");
    const plain = card.querySelector<HTMLInputElement>("input[data-secret-plain]");
    if (secret && plain) secret.type = plain.checked ? "text" : "password";
    const short = !!plain && !plain.checked && !!secret && secret.value.trim().length > 0 && secret.value.trim().length < KEY_MIN;
    const hint = card.querySelector<HTMLElement>("[data-secret-hint]");
    if (hint) hint.hidden = !short;
    save.disabled = short || [...card.querySelectorAll<HTMLInputElement>("input:not([type=checkbox])")].some(field => !field.value.trim());
  };
  thread.addEventListener("input", fieldsChanged);
  thread.addEventListener("change", fieldsChanged);
  thread.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-act^="card-"]');
    if (!button || button.disabled) return;
    const id = button.dataset.card ?? "";
    const action = button.dataset.act;
    if (action === "card-setup") {
      button.closest("[data-connector]")?.querySelector<HTMLInputElement>("[data-setup-field]")?.focus();
      return;
    }
    let call: Promise<unknown>;
    if (action === "card-connect") call = api.cardConnect(id).then(result => { if (!result.started) toaster.info(t("card.busy")); });
    else if (action === "card-cancel") call = api.cardCancel(id);
    else if (action === "card-resume") call = api.cardResume(id);
    else if (action === "card-save") {
      const input = button.closest(".secret-card")?.querySelector<HTMLInputElement>("input[data-secret-input]");
      if (!input?.value.trim()) return;
      const user = button.closest(".secret-card")?.querySelector<HTMLInputElement>("[data-login-user]");
      if (user && !user.value.trim()) { user.focus(); return; }
      const value = user ? JSON.stringify({ username: user.value, password: input.value }) : input.value;
      const plain = !!button.closest(".secret-card")?.querySelector<HTMLInputElement>("input[data-secret-plain]")?.checked;
      input.value = ""; if (user) user.value = "";
      call = api.cardSave(id, value, plain);
    } else return;
    button.disabled = true;
    void call.catch(error => { if (!cardFailure(button.closest(".conversation-card"), () => button.click())) toaster.info(describeError(error)); }).finally(() => { button.disabled = false; });
  });
}
