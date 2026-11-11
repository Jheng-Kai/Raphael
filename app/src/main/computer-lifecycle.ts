import * as api from "./api";
import type { DesktopState } from "./desktop-viewer";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { btn, closeMenu, esc, iconButton, openMenu, patchHTML } from "./ui";
import { computerStateLabel } from './computer-state';

export type ComputerMaintenance = "restart" | "update" | "repair" | "reset";
const maintenanceWords = {
  restart: ['desktop.restart', 'desktop.restartHint'], update: ['desktop.update', 'desktop.updateHint'],
  repair: ['desktop.repair', 'desktop.repairHint'], reset: ['desktop.reset', 'desktop.resetHint'],
} as const;

export function mountComputerLifecycle(_host: HTMLElement, panel: HTMLElement, member: () => number,
  read: () => DesktopState | undefined, perform: (action: ComputerMaintenance, captured: DesktopState) => Promise<void>): { draw(): void; locationHost: HTMLElement } {
  const header = panel.querySelector('.desktop-location-header') ?? panel;
  const holder = document.createElement('span');
  holder.className = 'computer-lifecycle';
  holder.innerHTML = `<span class="computer-lifecycle-state" role="status"></span><span class="computer-lifecycle-location"></span>${iconButton('more', t('chat.more'), ' data-computer-menu aria-haspopup="menu" aria-expanded="false"')}`;
  header.insertBefore(holder, header.querySelector('[data-det="gear"]'));
  const button = holder.querySelector<HTMLButtonElement>('[data-computer-menu]')!;
  const label = holder.querySelector<HTMLElement>('[role="status"]')!;
  const repaired = document.createElement('p'); repaired.className = 'computer-repair-note'; repaired.hidden = true; repaired.setAttribute('role','status'); panel.append(repaired);
  const fail = (): void => { const error = panel.querySelector<HTMLElement>('.desktop-error')!; error.textContent = t('desktop.maintenanceFailed'); error.hidden = false; };
  function menu(): void {
    const captured = read(); if (!captured) return;
    const owner = member();
    const reportFailure = (): void => { if (owner === member()) fail(); };
    const run = (action: ComputerMaintenance): void => {
      closeMenu();
      if (owner !== member()) return;
      if (action !== 'reset') { void perform(action, captured).catch(reportFailure); return; }
      openDialog({ title: t('desktop.resetConfirm'), cls: 'mb-confirm', describedByBody: true,
        body: `<p>${esc(t('desktop.resetHint'))}</p><p>${esc(t(captured.mode === 'shared' ? 'desktop.shared' : 'desktop.perMember'))}</p>`,
        actions: { secondary: btn(esc(t('common.cancel')), '', ' data-dlg="cancel"'), primary: { label: esc(t('desktop.reset')), attrs: ' data-dlg="reset"' } },
        onAct(action, _target, dialog) { dialog.close(); if (action === 'reset' && owner === member()) void perform('reset', captured).catch(reportFailure); } });
    };
    openMenu(button, [], '', () => {}, t(captured.mode === 'shared' ? 'desktop.shared' : 'desktop.perMember'), [
      { label: t('desktop.wait'), desc: t('desktop.waitHint'), run() { closeMenu(); } },
      ...(['restart','update','repair','reset'] as const).map(action => ({ label: t(maintenanceWords[action][0]), desc: t(maintenanceWords[action][1]), busy: !!captured.lifecycle,
        run() { run(action); } })),
      { label: t('desktop.sleepAfter'), desc: t(captured.idle_minutes === 0 ? 'desktop.neverSleep' : 'desktop.sleepMinutes', {p0: captured.idle_minutes ?? 15}),
        run() {
          closeMenu();
          openMenu(button, [5,15,60,0].map(value => ({value:String(value),label:t(value === 0 ? 'desktop.neverSleep' : 'desktop.sleepMinutes',{p0:value})})), String(captured.idle_minutes ?? 15), value => {
            void api.settingsSet('computer_vm_idle_minutes', Number(value)).then(() => { if (owner === member() && read()) read()!.idle_minutes = Number(value); }).catch(fail);
          }, t('desktop.sleepAfter'));
        } },
    ]);
  }
  button.addEventListener('click', menu);
  return { locationHost: holder.querySelector<HTMLElement>('.computer-lifecycle-location')!, draw() {
    const state = read();
    // R-UI-71: an unchanged renewal writes nothing here either.
    const set = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void => { if (target[key] !== value) target[key] = value; };
    set(repaired, 'hidden', !state?.repair_revision);
    if (state?.repair_revision) set(repaired, 'textContent', t('desktop.repaired'));
    const available = !!state && state.state !== 'absent';
    // No words over a computer that is not running: its state shows once its screen is up.
    set(label, 'hidden', !state || state.state !== 'running'); set(button, 'hidden', !available);
    if (button.getAttribute('aria-label') !== t('chat.more')) button.setAttribute('aria-label', t('chat.more'));
    set(button, 'title', t('chat.more'));
    patchHTML(label, `<span data-computer-state-text>${esc(computerStateLabel(state))}</span>`);
  } };
}
