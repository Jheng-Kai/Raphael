import * as api from "./api";
import { t } from "./i18n";
import { fileChipHTML } from "./message-content";
import { btn, esc } from "./ui";

// The member panel's Library. Its 工作 list of what the member did was removed (owner, 2026-11-07: it meant nothing).
export interface PanelFile { id: string; name: string; path?: string; kind: 'file' | 'page'; at_ms: number; turn_id?: number; conversation_id?: number }
export interface PanelWork { files: PanelFile[]; has_more: boolean }
export const readPanelWork = (member: number, limit = 12): Promise<PanelWork> => api.core('members.list', {panel_member_id: member, panel_limit: limit});
export function panelLibraryHTML(work: PanelWork | null, failed: boolean): string {
  const files = work?.files ?? [];
  if (!files.length) return `<p class="mp-empty">${esc(t(failed ? 'members.panelReadFailed' : work ? 'members.panelNoFiles' : 'common.loading'))}</p>`;
  const week = new Date(); week.setHours(0,0,0,0); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  return [true, false].map(recent => {
    const group = files.filter(file => (file.at_ms >= week.getTime()) === recent);
    return group.length ? `<section><div class="mb-dh">${esc(t(recent ? 'members.panelThisWeek' : 'members.panelEarlier'))}</div><div class="mb-library-files">` + group.map(file => fileChipHTML(esc(file.name), ` data-panel-file="${esc(file.id)}"`)).join('') + `</div></section>` : '';
  }).join('') + (work?.has_more ? btn(esc(t('members.panelMore')), 'sm', ' data-panel-more') : '');
}
