// Shared and member skills use the existing Connections rows and document dialog.
// Import copies packages; scripts use the ordinary local command approval path.

import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { faceHTML } from "./members";
import type { MemberSkill } from "./types";
import { skillOriginLabel, skillSourceLabel } from "./skill-source";
import { type SkillSet, type SkillMarketplace, marketplacesHTML, skillSetHeading } from "./skill-sets";
import { actionRow, btn, esc, ico, st, tg } from "./ui";

/** A skill with the member whose it is. */
export interface SkillItem {
  member: { id: number; name: string; avatar_url?: string };
  skill: MemberSkill;
  grants?: SkillItem[];
}

/** Connections shows each library package once; member access remains in its dialog. */
export function skillListItems(items: SkillItem[]): SkillItem[] {
  return items.filter(item => item.member.id === -1 || !item.skill.shared).map(item => item.member.id === -1 ? {
    ...item,
    grants: items.filter(each => each.member.id >= 0 && each.skill.shared && each.skill.id === item.skill.id)
      .sort((a, b) => Number(b.member.id === 0) - Number(a.member.id === 0)),
  } : item);
}

const skillOwner = (item: SkillItem): string => item.member.id === -1
  ? `${t("skills.shared")} · ${t("skills.granted", { p0: (item.grants ?? []).filter(each => each.skill.enabled).length })}` : item.member.name;
const skillIcon = (item: SkillItem, size: number): string => item.member.id === -1 ? `<span class="cs-library-icon">${ico("book")}</span>` : faceHTML(item.member, size);

/** The page of one skill that is open: its document as saved and as it is being edited. */
export interface SkillPage {
  memberId: number;
  id: number;
  /** The saved document; null until it is read. */
  saved: string | null;
  draft: string;
  state: "loading" | "ready" | "failed";
  busy: boolean;
  /** What the core refused, already in the words of the window. */
  error: string | null;
}

export interface LocalSkillSource { source: string; name: string; description: string; plugin?: string; kind?: "plugin"; version?: string; skill_count?: number; skills?: LocalSkillSource[] }

/** Local discovery is explicit; source groups live in the existing Connections dialog. */
export function skillImportsHTML(sources: LocalSkillSource[] | "loading" | "failed", closeButton = "", notice = "", markets: SkillMarketplace[] = [], busy = false): string {
  const head = `<div class="cs-dlg-head"><h2 class="cs-dlg-name" id="cs-dlg-title">${esc(t("skills.discover"))}</h2><span class="sp"></span>${closeButton}</div>`;
  if (sources === "loading") return head + `<p role="status">${esc(t("conn.loading"))}</p>`;
  if (sources === "failed") return head + `<p role="alert">${esc(t("conn.skills.failed"))}</p>` + btn(esc(t("plugins.retry")), "sm", ' data-conn="skill-discover"');
  const groups = ["Claude Code", "Codex", t("skills.plugins")];
  const groupOf = (source: LocalSkillSource): number => source.plugin || /[\\/]plugins[\\/]cache[\\/]/.test(source.source) ? 2 : /[\\/]\.claude[\\/]/.test(source.source) ? 0 : 1;
  return head + marketplacesHTML(markets, busy) + (sources.length ? groups.map((name, group) => {
    const rows = sources.map((source, index) => ({ source, index })).filter(({ source }) => groupOf(source) === group);
    return rows.length ? `<section class="cs-sec" data-skill-origin="${group}"><h3>${esc(name)}</h3><div class="cs-list">` + rows.map(({ source, index }) =>
      `<div class="cs-item cs-source"${source.kind ? ' data-plugin-source' : ""}><div class="cs-open"><span class="tx"><span class="nm">${esc(source.name)}${source.version ? ` · ${esc(source.version)}` : ""}</span><span class="ds">${esc(source.description)}</span><span class="ds" data-skill-provenance title="${esc(skillSourceLabel(source.source, source.plugin))}">${source.kind ? esc(t("skills.pluginCount", { p0: source.skill_count ?? 0 })) : esc(skillSourceLabel(source.source, source.plugin))}</span></span></div>${btn(ico("download") + esc(t("skills.import")), "sm gr", ` data-conn="skill-import-local" data-source="${index}" title="${esc(t("skills.importShared"))}"${busy ? " disabled" : ""}`)}</div>` +
      (source.skills?.length ? `<details class="cs-plugin-skills"><summary>${esc(t("skills.individualSkills"))}</summary><div class="cs-list">${source.skills.map((child, at) => `<div class="cs-item cs-source"><div class="cs-open"><span class="tx"><span class="nm">${esc(child.name)}</span><span class="ds">${esc(child.description)}</span></span></div>${btn(ico("download") + esc(t("skills.import")), "sm gr", ` data-conn="skill-import-alone" data-source="${index}" data-child="${at}"${busy ? " disabled" : ""}`)}</div>`).join("")}</div></details>` : "")).join("") + `</div></section>` : "";
  }).join("") : `<p class="cs-desc">${esc(t("skills.noLocal"))}</p>`) + notice;
}

export const skillPage = (memberId: number, id: number): SkillPage =>
  ({ memberId, id, saved: null, draft: "", state: "loading", busy: false, error: null });

export const sameSkill = (item: SkillItem, memberId: number, id: number): boolean => item.member.id === memberId && item.skill.id === id;

/** Shared packages and every member's effective skills, including Raphael. */
export async function loadSkillItems(): Promise<{ items: SkillItem[]; sets: SkillSet[] }> {
  const { members } = await api.membersList();
  let sets: SkillSet[] = [];
  const lists = await Promise.all([...members, { id: -1, name: t("skills.shared"), avatar_url: undefined }].map(async (member) =>
    { const result = await api.membersSkillsList(member.id); if (member.id === -1) sets = result.sets ?? []; return result.skills.map((skill): SkillItem => ({ member: { id: member.id, name: member.name, avatar_url: member.avatar_url }, skill })); }));
  return { items: lists.flat(), sets };
}

/** A row of the list, drawn like an app's: the member's face, the skill's name, who has it and when it is used, a switch and a chevron. */
export function skillRowHTML(item: SkillItem): string {
  const { member, skill } = item;
  const ids = ` data-member="${member.id}" data-id="${skill.id}"`;
  const key = `${member.id}:${skill.id}`;
  return (
    `<div class="cs-item cs-skill"${member.id === -1 ? ' data-library-skill' : ""} data-conn="skill-open"${ids}>` +
    btn(
      `<span class="ic">${skillIcon(item, 28)}</span><span class="tx"><span class="nm">${esc(skill.name)}</span><span class="ds">${esc(skillOwner(item))}${member.id === -1 ? "" : ` · ${esc(skill.description)}`}</span><span class="ds" data-skill-provenance title="${esc(skillOriginLabel(skill))}">${esc(skillOriginLabel(skill))}${skill.source_changed ? ` · ${esc(t("skills.changed"))}` : ""}</span></span>`,
      "cs-open",
      ` data-conn="skill-open"${ids} data-k="cs-skill:${key}" aria-haspopup="dialog" title="${esc(t("conn.skill.open", { p0: skill.name }))}"`,
    ) +
    (skill.source_changed ? btn(ico("refresh") + esc(t("skills.reimport")), "sm gr", ` data-conn="skill-reimport" data-member="${skill.shared ? -1 : member.id}" data-id="${skill.id}"`) : "") +
    (member.id === -1 ? "" : tg(skill.enabled, t("conn.skill.switch", { p0: skill.name }), ` data-conn="skill-enable"${ids} data-k="cs-skill-enable:${key}"`)) +
    `<span class="chev" aria-hidden="true">${ico("right")}</span></div>`
  );
}

/** The list of skills, under its name. */
export const skillsSectionHTML = (items: SkillItem[], failed = false, sets: SkillSet[] = []): string =>
  `<section class="cs-sec" data-skills-section><div class="data-heading"><h2>${esc(t("conn.skills"))}</h2>${btn(ico("download") + esc(t("skills.import")), "sm gr", ' data-conn="skill-discover" aria-haspopup="dialog"')}</div>` +
  (failed ? `<div class="alert core-note">${st("err", t("conn.skills.failed"))}${btn(esc(t("plugins.retry")), "sm", ' data-conn="retry-skills"')}</div>` :
    (items.some(item => !item.skill.set_id) ? `<div class="cs-list" data-stagger="skills">${items.filter(item => !item.skill.set_id).map(skillRowHTML).join("")}</div>` : "") +
    sets.map(set => `<section class="cs-set">${skillSetHeading(set)}<div class="cs-list">${items.filter(item => item.skill.set_id === set.id).map(skillRowHTML).join("")}</div></section>`).join("")) + `</section>`;

/** Whether the draft is not what was saved: the one reason to enable 「儲存」. */
export const skillChanged = (page: SkillPage): boolean => page.state === "ready" && page.draft !== page.saved;

/**
 * The page of a skill, as a dialog over the tab (the same dialog an app has): the switch is the trigger, on or off; the line under the
 * name says who has it and when it is used (its description, which the document's first lines hold); the instructions are the whole
 * document. 「刪除技能」 is the destructive action on the left, 「儲存」 the primary one.
 */
export function skillDialogHTML(item: SkillItem, page: SkillPage, closeButton: string, retry: string, notice = ""): string {
  const { member, skill } = item;
  const readOnly = skill.shared || !!skill.set_id;
  const ids = ` data-member="${member.id}" data-id="${skill.id}"`;
  const head =
    `<div class="cs-dlg-head">${skillIcon(item, 40)}<span class="sp"></span>` +
    tg(skill.enabled, t("conn.skill.switch", { p0: skill.name }), ` data-conn="skill-enable"${ids} data-k="cs-skill-dlg-enable"`) +
    closeButton + `</div><h2 class="cs-dlg-name" id="cs-dlg-title">${esc(skill.name)}</h2>` +
    `<p class="cs-desc">${esc(skillOwner(item))} · ${esc(skill.description)}</p><p class="cs-desc" data-skill-provenance>${esc(skillOriginLabel(skill))}</p>`;
  const grants = member.id === -1 ? `<section class="cs-skill-grants"><h3>${esc(t("skills.members"))}</h3><div class="cs-list">` + (item.grants ?? []).map(each =>
    `<div class="mp-resource" data-skill-grant="${each.member.id}"><span>${faceHTML(each.member, 28)} ${esc(each.member.name)}</span>${tg(each.skill.enabled, t("skills.memberAccess", { p0: each.member.name, p1: skill.name }), ` data-conn="skill-enable" data-member="${each.member.id}" data-id="${skill.id}" data-k="cs-skill-enable:${each.member.id}:${skill.id}"`)}</div>`).join("") + `</div></section>` : "";
  const body = page.state === "loading" ? `<p role="status">${esc(t("conn.loading"))}</p>`
    : page.state === "failed" ? `<div class="note" role="alert">${esc(t("conn.skill.loadFailed"))}${retry}</div>`
    : `<label class="cs-field"><span class="flabel">${esc(t("conn.skill.instructions"))}</span>` +
      `<textarea id="skill-text" class="field cs-skill-text" rows="14" spellcheck="false" data-k="cs-skill-text"${page.busy ? " disabled" : ""}${readOnly ? " readonly" : ""}>${esc(page.draft)}</textarea></label>` +
      (page.error ? `<div class="note" role="alert">${st("err", page.error)}</div>` : "");
  const acts = actionRow({
    cls: "cs-acts", sticky: true,
    ...(readOnly ? {} : { destructive: { label: esc(t("conn.skill.delete")), attrs: ` data-conn="skill-delete"${ids} data-k="cs-skill-delete"${page.busy ? " disabled" : ""}` } }),
    primary: { label: esc(t("conn.skill.save")), attrs: ` data-conn="skill-save"${ids} data-k="cs-skill-save"${skillChanged(page) && !page.busy && !readOnly ? "" : " disabled"}` },
  });
  return head + grants + (skill.source_changed && !skill.shared ? btn(esc(t("skills.reimport")), "sm", ` data-conn="skill-reimport"${ids}`) : "") + body + notice + acts;
}

/** What a refusal of the core says of a document, in the words of the window; any other failure as it is described elsewhere. */
export function skillErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/must not be empty|must be text|at most \d+ characters/.test(text) && /name|description/.test(text)) return t("conn.skill.err.header");
  if (/already exists/.test(text)) return t("conn.skill.err.taken");
  if (/too large/.test(text)) return t("conn.skill.err.size");
  if (/UTF-8 Markdown/.test(text)) return t("conn.skill.err.invalid");
  return describeError(error);
}
