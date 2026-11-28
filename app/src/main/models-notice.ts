// What the core says about the models of the features (R-DEFAULT-05). Nothing ships a model: when a source is connected,
// the core fills the features that had none with that source's recommended models, and the choices on screen show it (no
// toast says so, R-TOAST-01); when a feature is used with no model it says which feature (`ModelMissing`), and the toast's
// one button opens that feature's own choice. The words name the feature, never a provider.

import { t } from "./i18n";
import { btn, esc, toaster } from "./ui";

export type ModelRole = "answer" | "quick" | "cleanup" | "stt";
const ROLES: readonly ModelRole[] = ["answer", "quick", "cleanup", "stt"];
const MISSING = { answer: "models.missing.answer", quick: "models.missing.quick", cleanup: "models.missing.cleanup", stt: "models.missing.stt" } as const;

export function modelMissingHTML(role: ModelRole): string {
  return `<span class="model-missing" role="status">${esc(t(MISSING[role]))}</span>` +
    btn(esc(t("models.choose")), "sm", ` data-model-missing="${role}"`);
}

const toastOf = (doc: Document, role: ModelRole): HTMLElement | undefined =>
  [...doc.querySelectorAll<HTMLElement>(".toast")].find(toast => toast.querySelector(`[data-model-missing="${role}"]`));

/** Says which feature has no model, unless its toast is on screen already; its button runs `choose` with that feature. */
export function warnModelMissing(missing: { role: string }, choose: (role: ModelRole) => void, doc: Document = document): void {
  const role = ROLES.find(item => item === missing.role);
  if (!role || toastOf(doc, role)) return;
  toaster.notice(() => modelMissingHTML(role));
  const toast = toastOf(doc, role);
  toast?.addEventListener("click", event => {
    if (!(event.target as Element).closest("[data-model-missing]")) return;
    toast.remove();
    choose(role);
  });
}
