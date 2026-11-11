/** The shared computer host setting, edited beside the member's screen. */
import * as api from "./api";
import { onLocaleChange, t } from "./i18n";
import { messageHTML } from "./message-content";
import { describeError } from "./format";
import { btn, closeMenu, copyButton, esc, fieldHTML, ico, note, openMenu, openMenuOnArrow, openPopover, patchHTML, placeMenu, row, sel, st, toaster } from "./ui";

export const validComputerAlias = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);

// What each failed check says. The core names the class and the one command that fixes it (owner, 2026-11-11), so the
// panel never invents a command: a command is shown only when the core sent one, and it is pasted as it stands.
const HEALTH_WORDS = {
  ssh: 'desktop.health.ssh', docker: 'desktop.health.docker', ssh_unreachable: 'desktop.health.ssh_unreachable', ssh_key: 'desktop.health.ssh_key',
  ssh_hostkey: 'desktop.health.ssh_hostkey', ssh_hostkey_changed: 'desktop.health.ssh_hostkey_changed', ssh_alias_unknown: 'desktop.health.ssh_alias_unknown',
  docker_path: 'desktop.health.docker_path', docker_missing: 'desktop.health.docker_missing', docker_stopped: 'desktop.health.docker_stopped',
  docker_access: 'desktop.health.docker_access', architecture: 'desktop.health.architecture', image_pending: 'desktop.health.image_pending',
} as const;

export function computerHostHealthHTML(health: api.ComputerHostHealth): string {
  return `<div class="slist">` + health.checks.flatMap(check => {
    const label = t(check.kind.startsWith('ssh') ? 'desktop.health.connection' : check.kind === 'architecture' || check.kind === 'image_pending' ? 'desktop.health.image' : 'desktop.health.runtime');
    // A host with no image yet is healthy: its first start prepares the image there, and the row says so.
    const state = check.ok ? t(check.kind === 'image_pending' ? 'desktop.health.image_pending' : 'desktop.health.ok') : check.kind === 'ssh_key' && check.user ? t('desktop.health.ssh_key_user', { p0: check.user }) : t(HEALTH_WORDS[check.kind as keyof typeof HEALTH_WORDS] ?? 'desktop.health.ssh_unreachable');
    const lead = check.kind === 'ssh_unreachable' ? 'desktop.health.localTerminal' : check.kind === 'ssh_alias_unknown' ? 'desktop.health.editConfig' : 'desktop.health.runHere';
    return [row(esc(label), '', st(check.ok ? 'ok' : 'err', state), { attrs: ` data-computer-host-health="${esc(check.kind)}" role="status"` }),
      ...(!check.ok && check.command ? [note(`<p>${esc(t(lead))}</p>` + messageHTML('```sh\n' + check.command + '\n```', '', true), ' data-computer-host-repair')] : [])];
  }).join('') + `</div>`;
}

export function computerLocationHTML(remote: boolean, alias: string, invalid = false, saving = false, error = "", health?: api.ComputerHostHealth, checking = false): string {
  return `<p class="computer-location-purpose">${esc(t("desktop.sharedLocation"))}</p><div class="slist">` +
    row(t("desktop.host"), "", sel([
      { value: "local", label: t("desktop.local") }, { value: "remote", label: t("desktop.remote") },
    ], remote ? "remote" : "local", t("desktop.host"), ` data-k="computer-host"${saving ? " disabled" : ""}`)) +
    // The field stays enabled while it saves: disabling it dropped its focus and closed the popover on Enter.
    (remote ? row(t("desktop.sshAlias"), "", fieldHTML("", alias, { id: "computer-ssh-alias", label: t("desktop.sshAlias"), invalid })) : "") + `</div>` +
    // The check reads the typed alias, so it never waits for the save that leaving the field starts.
    (remote ? btn(esc(t(checking ? 'desktop.checkingHost' : 'desktop.checkHost')), 'sm', ` data-act="computer-host-check"${checking || !validComputerAlias(alias) ? ' disabled' : ''}`) : '') +
    (health ? computerHostHealthHTML(health) : '') +
    (invalid ? `<p class="computer-location-error" role="alert" data-computer-host-error>${esc(t("desktop.invalidAlias"))}</p>` : "") +
    (error ? `<p class="computer-location-error" role="alert">${esc(error)}</p>` : "");
}

export function mountComputerLocation(host: HTMLElement, changed: () => void) {
  const control = document.createElement("div");
  control.className = "computer-location";
  host.append(control);
  let alias = "", draft = "", remote = false, loaded = false, saving = false, invalid = false, saveError = "", hostError = false;
  let panel: HTMLElement | null = null, epoch = 0;
  let health: api.ComputerHostHealth | undefined, checking = false, healthEpoch = 0;
  const draw = (): void => {
    patchHTML(control, btn(ico("monitor") + `<span>${esc(loaded ? alias || t("desktop.locationLocal") : t("common.loading"))}</span>` + ico("down"), "sm", ` data-computer-location aria-label="${esc(t("desktop.host"))}" aria-haspopup="dialog" aria-expanded="${!!panel}"${loaded ? "" : " disabled"}`));
    if (panel) {
      patchHTML(panel, computerLocationHTML(remote, draft, invalid, saving, saveError || (hostError && alias ? t("desktop.locationHostError") : ""), health, checking));
      placeMenu();
    }
  };
  const save = async (value: string): Promise<void> => {
    if (saving) return;
    saving = true; saveError = ""; health = undefined; healthEpoch++; checking = false; draw();
    try {
      alias = (await api.settingsSet("computer_ssh_alias", value)).settings.computer_ssh_alias ?? "";
      draft = alias; remote = !!alias; hostError = false; changed();
    } catch { saveError = t("desktop.locationSaveError"); }
    finally { saving = false; draw(); }
  };
  const open = (): void => {
    if (panel) { closeMenu(); return; }
    remote = !!alias; draft = alias; invalid = false; saveError = ""; health = undefined; healthEpoch++; checking = false;
    panel = openPopover(control.querySelector<HTMLElement>("button")!, computerLocationHTML(remote, draft, false, false, hostError && alias ? t("desktop.locationHostError") : ""), {
      className: "menu computer-location-popover", role: "dialog", label: t("desktop.host"),
      onClose: () => { panel = null; draw(); },
    });
    panel.addEventListener("click", event => {
      const target = event.target as Element;
      const copy = target.closest<HTMLElement>('[data-act="copy-code"]');
      if (copy) { void copyButton(copy, copy.closest('.message-code')?.querySelector('code')?.textContent ?? '').catch(error => toaster.info(describeError(error))); return; }
      if (target.closest('[data-act="computer-host-check"]')) {
        if (checking || !validComputerAlias(draft)) return;
        const selected = draft, mine = ++healthEpoch;
        checking = true; health = undefined; draw();
        void api.desktopHostCheck(selected).then(result => { if (mine === healthEpoch && selected === draft) health = result; })
          .catch(() => { if (mine === healthEpoch && selected === draft) health = {host:selected,ok:false,checks:[{kind:'ssh_unreachable',ok:false,command:`ssh ${selected}`}]}; })
          .finally(() => { if (mine === healthEpoch) { checking = false; draw(); } });
        return;
      }
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
      draft = input.value; invalid = !validComputerAlias(draft); saveError = ""; health = undefined; healthEpoch++; checking = false;
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
      if (input.id !== "computer-ssh-alias") return;
      draft = input.value;
      // Tab from a valid alias reaches 檢查主機 instead of leaving the popover.
      const check = panel?.querySelector<HTMLButtonElement>('[data-act="computer-host-check"]');
      if (check) check.disabled = checking || !validComputerAlias(draft);
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
    open,
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
