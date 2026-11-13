// The member's computer as one quiet row in its panel (owner, 2026-11-11, after Grok Bot): the computer is there for
// every member, never asked about, and its state is one or two words (asleep, connecting, awake) with a small picture
// of its screen when it is awake. A press opens the computer. When this PC cannot give it one (no Docker Desktop, a
// stopped engine, a host out of reach) the row says so in one line, with the one action that fixes it if the app has
// one. Everything else about engines, images and hosts stays out of the member's panel.
//
// The viewer (desktop-viewer.ts) reads the computer's state for the panel already; it publishes what the row shows here,
// and the details view draws it.

import { t } from "./i18n";
import { esc, ico } from "./ui";

export type ComputerRowState = "asleep" | "connecting" | "awake" | "unavailable";
/** What can be done about an unavailable computer: the app starts the engine, opens the download, or only the press that retries. */
export type ComputerRowFix = "start" | "download" | "retry";

export interface ComputerRowModel {
  member: number;
  state: ComputerRowState;
  /** A picture of the screen (a JPEG data URL), only while it is awake. */
  picture?: string;
  /** The one quiet line of an unavailable computer. */
  problem?: string;
  fix?: ComputerRowFix;
  /** Who woke the computer and why, when a member's tool did (R-COMP-WAKE-01): it stands in the state's place while awake. */
  note?: string;
}

const models = new Map<number, ComputerRowModel>();
const listeners = new Set<() => void>();
const same = (a: ComputerRowModel | undefined, b: ComputerRowModel): boolean =>
  !!a && a.state === b.state && a.picture === b.picture && a.problem === b.problem && a.fix === b.fix && a.note === b.note;

/** The viewer says what the computer of `model.member` looks like now; nothing changes (and nobody is told) when it is the same. */
export function publishComputerRow(model: ComputerRowModel): void {
  if (same(models.get(model.member), model)) return;
  models.set(model.member, model);
  for (const listener of listeners) listener();
}
export const computerRowOf = (member: number): ComputerRowModel | undefined => models.get(member);
export function onComputerRow(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Forget what was read for a member (its computer was removed, or the panel starts over). */
export function forgetComputerRow(member: number): void {
  if (models.delete(member)) for (const listener of listeners) listener();
}

const STATE_WORD = { asleep: "computer.row.asleep", connecting: "computer.row.connecting", awake: "computer.row.awake", unavailable: "computer.row.asleep" } as const;
const FIX_WORD = { start: "computer.row.start", download: "computer.row.download" } as const;

/** The small screen at the row's right: the last picture while awake, otherwise a dark screen with the monitor on it (as Grok Bot's sleeping one). */
function thumbnailHTML(model: ComputerRowModel): string {
  const live = model.state === "awake" && model.picture;
  return `<span class="mb-computer-thumb" data-computer-thumb data-thumb="${live ? "live" : "idle"}">` +
    `${live ? `<img class="mb-computer-shot" alt="" src="${esc(model.picture!)}">` : `<span class="mb-computer-mark" aria-hidden="true">${ico("monitor")}</span>`}</span>`;
}

/** The section: its heading and the row. `name` is the member's. Before the first answer the row has no state word, never a wrong one. */
export function computerRowHTML(model: ComputerRowModel | undefined, name: string): string {
  const row = model ?? { member: 0, state: "asleep" as const };
  const label = t("desktop.event", { p0: name });
  const unavailable = row.state === "unavailable";
  const state = !model ? "" : unavailable ? (row.problem ?? t("desktop.unavailable")) : row.state === "awake" && row.note ? row.note : t(STATE_WORD[row.state]);
  const fix = unavailable && (row.fix === "start" || row.fix === "download")
    ? `<button type="button" class="btn sm mb-computer-fix" data-det="computer-fix" data-fix="${row.fix}" data-k="computer-fix">${esc(t(FIX_WORD[row.fix]))}</button>` : "";
  return `<div class="mb-dh"><span>${esc(t("members.panelTab.computer"))}</span></div>` +
    `<div class="mb-computer" data-computer-state="${row.state}">` +
    `<button type="button" class="btn mb-computer-row" data-det="computer-open" data-k="computer-row" aria-label="${esc(state ? `${label}: ${state}` : label)}">` +
    `<span class="mb-rt-main"><b>${esc(label)}</b><span class="mb-computer-state" role="status">${esc(state)}</span></span>` +
    `${unavailable ? "" : thumbnailHTML(row)}</button>${fix}</div>`;
}
