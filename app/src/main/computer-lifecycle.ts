import * as api from "./api";
import type { DesktopState } from "./desktop-viewer";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { btn, closeMenu, esc, iconButton, openMenu } from "./ui";

export type ComputerMaintenance = "restart" | "update" | "repair" | "reset";
const maintenanceWords = {
  restart: ['desktop.restart', 'desktop.restartHint'], update: ['desktop.update', 'desktop.updateHint'],
  repair: ['desktop.repair', 'desktop.repairHint'], reset: ['desktop.reset', 'desktop.resetHint'],
} as const;

export function mountComputerLifecycle(holder: HTMLElement, member: () => number,
  read: () => DesktopState | undefined, perform: (action: ComputerMaintenance, captured: DesktopState) => Promise<void>): { draw(show: boolean): void } {
  holder.innerHTML = iconButton('more', t('chat.more'), ' data-computer-menu aria-haspopup="menu" aria-expanded="false"');
  const button = holder.querySelector<HTMLButtonElement>('[data-computer-menu]')!;
  function menu(): void {
    const captured = read(); if (!captured || button.hidden) return;
    const owner = member();
    const run = (action: ComputerMaintenance): void => {
      closeMenu();
      if (owner !== member()) return;
      if (action !== 'reset') { void perform(action, captured); return; }
      openDialog({ title: t('desktop.resetConfirm'), cls: 'mb-confirm', describedByBody: true,
        body: `<p>${esc(t('desktop.resetHint'))}</p><p>${esc(t(captured.mode === 'shared' ? 'desktop.shared' : 'desktop.perMember'))}</p>`,
        actions: { secondary: btn(esc(t('common.cancel')), '', ' data-dlg="cancel"'), primary: { label: esc(t('desktop.reset')), attrs: ' data-dlg="reset"' } },
        onAct(action, _target, dialog) { dialog.close(); if (action === 'reset' && owner === member()) void perform('reset', captured); } });
    };
    openMenu(button, [], '', () => {}, t(captured.mode === 'shared' ? 'desktop.shared' : 'desktop.perMember'), [
      { label: t('desktop.wait'), desc: t('desktop.waitHint'), run() { closeMenu(); } },
      ...(['restart','update','repair','reset'] as const).map(action => ({ label: t(maintenanceWords[action][0]), desc: t(maintenanceWords[action][1]), busy: !!captured.lifecycle,
        run() { run(action); } })),
      { label: t('desktop.sleepAfter'), desc: t(captured.idle_minutes === 0 ? 'desktop.neverSleep' : 'desktop.sleepMinutes', {p0: captured.idle_minutes ?? 15}),
        run() {
          closeMenu();
          openMenu(button, [5,15,60,0].map(value => ({value:String(value),label:t(value === 0 ? 'desktop.neverSleep' : 'desktop.sleepMinutes',{p0:value})})), String(captured.idle_minutes ?? 15), value => {
            void api.settingsSet('computer_vm_idle_minutes', Number(value)).then(() => { if (owner === member() && read()) read()!.idle_minutes = Number(value); }).catch(() => {});
          }, t('desktop.sleepAfter'));
        } },
    ]);
  }
  button.addEventListener('click', menu);
  return { draw(show) {
    const state = read();
    // R-UI-71: an unchanged renewal writes nothing here either.
    const set = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void => { if (target[key] !== value) target[key] = value; };
    const available = !!state && state.state !== 'absent' && state.transport !== 'host';
    set(button, 'hidden', !show || !available);
    if (button.getAttribute('aria-label') !== t('chat.more')) button.setAttribute('aria-label', t('chat.more'));
    set(button, 'title', t('chat.more'));
  } };
}
