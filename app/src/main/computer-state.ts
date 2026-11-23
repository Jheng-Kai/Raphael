import { t } from './i18n';
import type { DesktopState } from './desktop-viewer';

/** The full state sentence lives only inside the screen. */
export function computerStateText(state: DesktopState | undefined): string {
  if (state?.lifecycle) return t(({waking:'desktop.waking', updating:'desktop.updating', repairing:'desktop.repairing'} as const)[state.lifecycle]);
  if (state?.error === 'docker_stopped') return t('desktop.dockerStopped');
  if (state?.error === 'remote_unavailable') return t('desktop.remoteUnavailable', {p0:state.host ?? ''});
  if (state?.state === 'absent') return t(state.error === 'disabled' ? 'desktop.disabled' : 'desktop.dockerMissing');
  if (state?.state === 'missing' && state.image === false) return t('desktop.imageMissing');
  if (state?.state === 'stopped' || state?.state === 'missing') return t('desktop.asleep');
  if (state?.state === 'incompatible') return t('desktop.incompatible');
  if (state?.state === 'starting') return t('desktop.starting');
  if (state?.state === 'building') return t('desktop.building');
  if (state?.state === 'preparing') return t('desktop.preparing');
  if (state?.state === 'running') return t(state.control === 'owner' ? 'desktop.owner' : 'desktop.member');
  return t(state?.error === 'build_failed' || state?.error === 'pull_failed' ? 'desktop.buildFailed' : 'desktop.unavailable');
}

/** R-COMP-UPDATE-01: the one line under the screen while the computer is made again on a newer image (the core marks that
 *  preparation `update`), with how long it can take. A wake, a start or a first build still says nothing (R-UI-93). */
export function computerUpdateLine(state: DesktopState | undefined): string {
  return state?.update === true && ['starting', 'building', 'preparing'].includes(state.state) ? t('desktop.updateLine') : '';
}

/** A short header word agrees with the screen without repeating its explanation. */
export function computerStateLabel(state: DesktopState | undefined): string {
  const phase = state?.lifecycle ?? (state?.error || !state || ['absent', 'unavailable', 'incompatible'].includes(state.state) || state.state === 'missing' && state.image === false ? 'idle'
    : state.state === 'stopped' || state.state === 'missing' ? 'sleeping'
    : state.state === 'building' ? 'updating'
    : state.state === 'starting' || state.state === 'preparing' ? 'starting' : 'running');
  return t(({sleeping:'desktop.state.sleeping', starting:'desktop.state.starting', waking:'desktop.state.waking', updating:'desktop.state.updating', repairing:'desktop.state.repairing', idle:'memberComputer.idle', running:'desktop.state.running'} as const)[phase]);
}
