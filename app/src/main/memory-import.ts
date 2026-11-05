import * as api from "./api";
import { t } from "./i18n";
import { btn, esc, copyButton } from "./ui";
import { describeError } from "./format";

export function createMemoryImport(changed: () => void) {
  let open = false, text = "", busy = false, error = "";
  let result: api.MemoryImportResult | null = null;
  return {
    html(): string {
      return `<section class="sgroup memory-import" data-memory-import><h2>${esc(t("import.title"))}</h2>` +
        (open ? `<label class="import-field">${esc(t("import.promptLabel"))}<textarea class="field" rows="4" readonly data-import-prompt>${esc(t("import.prompt"))}</textarea></label>` +
          btn(t("import.copy"), "", ' data-import="copy"') +
          `<label class="import-field">${esc(t("import.answer"))}<textarea class="field" rows="5" maxlength="64000" data-import-answer${busy ? " disabled" : ""}>${esc(text)}</textarea></label>` +
          btn(t(busy ? "import.saving" : "import.add"), "", ` data-import="save"${busy || !text.trim() ? " disabled" : ""}`) :
          btn(t("import.title"), "", ' data-import="open"')) +
        (error ? `<p role="alert" class="note">${esc(error)}</p>` : "") +
        (result ? `<div class="import-result" role="status"><h3>${esc(t("import.kept", {p0:result.kept.length}))}</h3><ul>${result.kept.map(entry => `<li>${esc(entry)}</li>`).join("")}</ul>` +
          `<h3>${esc(t("import.refused", {p0:result.refused.length}))}</h3><ul>${result.refused.map(entry => `<li>${esc(t("import.item", {p0:entry.index}))} · ${esc(t(entry.reason === "secret" ? "import.secret" : entry.reason === "injection" ? "import.injection" : "import.limit"))}</li>`).join("")}</ul></div>` : "") + `</section>`;
    },
    input(target: Element): void {
      if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-import-answer]")) return;
      text = target.value;
      const save = target.closest("[data-memory-import]")?.querySelector<HTMLButtonElement>('[data-import="save"]');
      if (save) save.disabled = busy || !text.trim();
    },
    click(target: Element): boolean {
      const control = target.closest<HTMLElement>("[data-import]");
      if (!control) return false;
      if (control.dataset.import === "open") { open = true; changed(); }
      if (control.dataset.import === "copy") void copyButton(control, t("import.prompt")).catch(errorValue => { error = describeError(errorValue); changed(); });
      if (control.dataset.import === "save" && !busy && text.trim()) {
        busy = true; error = ""; result = null; changed();
        void api.importMemory(text).then(value => { result = value; text = ""; }).catch(value => { error = describeError(value); }).finally(() => { busy = false; changed(); });
      }
      return true;
    },
    reset(): void { if (!busy) { open = false; text = ""; result = null; error = ""; } },
  };
}
