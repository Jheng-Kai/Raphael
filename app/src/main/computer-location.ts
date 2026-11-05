/** The shared computer host setting, edited beside the member's screen. */
import * as api from "./api";
import { onLocaleChange, t } from "./i18n";
import { btn, closeMenu, esc, fieldHTML, ico, openMenu, openMenuOnArrow, openPopover, patchHTML, placeMenu, row, sel } from "./ui";

export const validComputerAlias = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);

export function computerLocationHTML(remote: boolean, alias: string, invalid = false, saving = false, error = ""): string {
  return `<p class="computer-location-purpose">${esc(t("desktop.sharedLocation"))}</p><div class="slist">` +
    row(t("desktop.host"), "", sel([
      { value: "local", label: t("desktop.local") }, { value: "remote", label: t("desktop.remote") },
    ], remote ? "remote" : "local", t("desktop.host"), ` data-k="computer-host"${saving ? " disabled" : ""}`)) +
    (remote ? row(t("desktop.sshAlias"), "", fieldHTML("", alias, { id: "computer-ssh-alias", label: t("desktop.sshAlias"), invalid, disabled: saving })) : "") + `</div>` +
    (invalid ? `<p class="computer-location-error" role="alert" data-computer-host-error>${esc(t("desktop.invalidAlias"))}</p>` : "") +
    (error ? `<p class="computer-location-error" role="alert">${esc(error)}</p>` : "");
}

export function mountComputerLocation(host: HTMLElement, changed: () => void) {
  const control = document.createElement("div");
  control.className = "computer-location";
  host.append(control);
  let alias = "", draft = "", remote = false, loaded = false, saving = false, invalid = false, saveError = "", hostError = false;
  let panel: HTMLElement | null = null, epoch = 0;
  const draw = (): void => {
    patchHTML(control, btn(ico("monitor") + `<span>${esc(loaded ? alias || t("desktop.locationLocal") : t("common.loading"))}</span>` + ico("down"), "sm", ` data-computer-location aria-label="${esc(t("desktop.host"))}" aria-haspopup="dialog" aria-expanded="${!!panel}"${loaded ? "" : " disabled"}`));
    if (panel) {
      patchHTML(panel, computerLocationHTML(remote, draft, invalid, saving, saveError || (hostError && alias ? t("desktop.locationHostError") : "")));
      placeMenu();
    }
  };
  const save = async (value: string): Promise<void> => {
    if (saving) return;
    saving = true; saveError = ""; draw();
    try {
      alias = (await api.settingsSet("computer_ssh_alias", value)).settings.computer_ssh_alias ?? "";
      draft = alias; remote = !!alias; hostError = false; changed();
    } catch { saveError = t("desktop.locationSaveError"); }
    finally { saving = false; draw(); }
  };
  const open = (): void => {
    if (panel) { closeMenu(); return; }
    remote = !!alias; draft = alias; invalid = false; saveError = "";
    panel = openPopover(control.querySelector<HTMLElement>("button")!, computerLocationHTML(remote, draft, false, false, hostError && alias ? t("desktop.locationHostError") : ""), {
      className: "menu computer-location-popover", role: "dialog", label: t("desktop.host"),
      onClose: () => { panel = null; draw(); },
    });
    panel.addEventListener("click", event => {
      const target = event.target as Element;
      if (target.closest('[data-k="computer-host"]')) {
        const anchor = panel!.querySelector<HTMLElement>('[data-k="computer-host"]')!;
        openMenu(anchor, [
          { value: "local", label: t("desktop.local") }, { value: "remote", label: t("desktop.remote") },
        ], remote ? "remote" : "local", value => {
          open(); remote = value === "remote"; invalid = false; draw();
          if (remote) panel?.querySelector<HTMLInputElement>("input")?.focus();
          else void save("");
        }, undefined, [], { placement: "beside" });
      }
    });
    const commit = (input: HTMLInputElement): void => {
      draft = input.value; invalid = !validComputerAlias(draft); saveError = "";
      if (invalid) draw(); else void save(draft);
    };
    panel.addEventListener("keydown", event => {
      if (openMenuOnArrow(event)) return;
      const input = event.target as HTMLInputElement;
      if (event.key === "Enter" && !event.isComposing && input.id === "computer-ssh-alias") {
        event.preventDefault(); commit(input);
      }
    });
    panel.addEventListener("input", event => {
      const input = event.target as HTMLInputElement;
      if (input.id === "computer-ssh-alias") draft = input.value;
    });
    panel.addEventListener("change", event => {
      const input = event.target as HTMLInputElement;
      if (input.id !== "computer-ssh-alias") return;
      commit(input);
    });
    panel.querySelector<HTMLElement>("button")?.focus();
  };
  control.addEventListener("click", open);
  onLocaleChange(draw);
  draw();
  return {
    control,
    async refresh(): Promise<void> {
      const mine = ++epoch;
      try {
        const result = await api.settingsGet();
        if (mine !== epoch || saving || panel) return;
        alias = result.settings.computer_ssh_alias ?? ""; draft = alias; remote = !!alias; loaded = true; draw();
      } catch { if (mine === epoch && !saving && !panel) { loaded = false; draw(); } }
    },
    status(error: boolean): void { if (hostError !== error) { hostError = error; draw(); } },
    hide(): void { epoch++; if (panel) closeMenu(); },
    isRemote: () => !!alias,
    ready: () => loaded,
  };
}
