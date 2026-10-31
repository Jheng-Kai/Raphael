import * as api from "./api";
import { openConnectionSetup } from "./connection-setup";
import { describeError } from "./format";
import { t } from "./i18n";
import { mountMailActions } from "./mail-actions";
import { toaster } from "./ui";

/** Room cards use the same services and forms as private conversations. */
export function mountConversationCardActions(thread: HTMLElement, manageConnections: () => void): void {
  mountMailActions(thread, error => toaster.info(describeError(error)), text => toaster.info(text));
  thread.addEventListener("input", event => {
    const input = (event.target as Element).closest<HTMLInputElement>("input[data-secret-input]");
    const save = input?.closest(".secret-card")?.querySelector<HTMLButtonElement>('[data-act="card-save"]');
    if (save) save.disabled = !input!.value.trim();
  });
  thread.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-act^="card-"]');
    if (!button || button.disabled) return;
    const id = button.dataset.card ?? "";
    const action = button.dataset.act;
    if (action === "card-setup") {
      void openConnectionSetup({ slug: button.dataset.toolkit ?? "", name: button.dataset.name ?? "", needs: button.dataset.needs === "own_app" ? "own_app" : "key" }, {
        connect: async fields => {
          const result = await api.cardConnect(id, fields);
          return result.started || !["pending", "failed", "cancelled"].includes(result.card.state) ? { connected: true } : { connected: false, error: "busy" };
        }, composioKey: manageConnections,
      });
      return;
    }
    let call: Promise<unknown>;
    if (action === "card-connect") call = api.cardConnect(id).then(result => { if (!result.started) toaster.info(t("card.busy")); });
    else if (action === "card-cancel") call = api.cardCancel(id);
    else if (action === "card-resume") call = api.cardResume(id);
    else if (action === "card-save") {
      const input = button.closest(".secret-card")?.querySelector<HTMLInputElement>("input[data-secret-input]");
      if (!input?.value.trim()) return;
      const value = input.value; input.value = "";
      call = api.cardSave(id, value);
    } else return;
    button.disabled = true;
    void call.catch(error => toaster.info(describeError(error))).finally(() => { button.disabled = false; });
  });
}
