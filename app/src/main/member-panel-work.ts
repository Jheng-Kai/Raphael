import * as api from "./api";
import { t } from "./i18n";
import { fileChipHTML } from "./message-content";
import { btn, esc, ico, iconButton } from "./ui";

export interface PanelTask { id: number; turn_id: number | null; conversation_id: number | null; title: string; state: string; created_at_ms: number; started_at_ms: number | null; finished_at_ms: number | null }
export interface PanelFile { id: string; name: string; path?: string; kind: 'file' | 'page'; at_ms: number; turn_id?: number; conversation_id?: number }
export interface PanelWork { tasks: PanelTask[]; files: PanelFile[]; has_more: boolean }
export const readPanelWork = (member: number, limit = 12): Promise<PanelWork> => api.core('members.list', {panel_member_id: member, panel_limit: limit});
export function taskState(state: string): 'running' | 'waiting' | 'done' | 'failed' {
  return state === 'done' ? 'done' : ['waiting', 'waiting_control', 'waiting_owner', 'confirm', 'blocked'].includes(state) ? 'waiting' : ['queued', 'running'].includes(state) ? 'running' : 'failed';
}
export function panelTasksHTML(work: PanelWork | null, failed: boolean): string {
  const tasks = work?.tasks ?? [];
  return `<div class="mb-dh">${esc(t('members.panelWork'))}</div>` + (tasks.length ? tasks.map(task => {
    const state = taskState(task.state);
    const at = task.finished_at_ms ?? task.started_at_ms ?? task.created_at_ms;
    return `<div class="mb-task-row" data-k="panel-task:${task.id}"><button type="button" class="btn mb-task-open" data-panel-task="${task.id}"${task.turn_id ? '' : ' disabled'}>${ico(state === 'done' ? 'check' : state === 'running' ? 'clock' : state === 'waiting' ? 'pause' : 'x')}<span>${esc(task.title.split(/\r?\n/, 1)[0])}</span><small>${esc(t(({running:'members.panelTask.running', waiting:'members.panelTask.waiting', done:'members.panelTask.done', failed:'members.panelTask.failed'} as const)[state]))}</small><time datetime="${new Date(at).toISOString()}">${esc(new Date(at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))}</time></button>${iconButton('more', t('chat.more'), ` data-panel-task-menu="${task.id}" aria-haspopup="menu"`)}</div>`;
  }).join('') : `<p class="mp-empty">${esc(t(failed ? 'members.panelReadFailed' : work ? 'members.panelNoWork' : 'common.loading'))}</p>`);
}
export function panelLibraryHTML(work: PanelWork | null, failed: boolean): string {
  const files = work?.files ?? [];
  if (!files.length) return `<p class="mp-empty">${esc(t(failed ? 'members.panelReadFailed' : work ? 'members.panelNoFiles' : 'common.loading'))}</p>`;
  const week = new Date(); week.setHours(0,0,0,0); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  return [true, false].map(recent => {
    const group = files.filter(file => (file.at_ms >= week.getTime()) === recent);
    return group.length ? `<section><div class="mb-dh">${esc(t(recent ? 'members.panelThisWeek' : 'members.panelEarlier'))}</div><div class="mb-library-files">` + group.map(file => fileChipHTML(esc(file.name), ` data-panel-file="${esc(file.id)}"`)).join('') + `</div></section>` : '';
  }).join('') + (work?.has_more ? btn(esc(t('members.panelMore')), 'sm', ' data-panel-more') : '');
}
