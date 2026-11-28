// Targets and results of the guided tour, in the order Raphael introduces them.

import { bindingLabels } from "../keys";
import type { MessageKey } from "../i18n/zh-TW";
import type { DeviceSettings } from "../types";
import type { Box, Side } from "./place";

type StepId = "composer" | "permission" | "model" | "apps" | "team" | "account" | "keys";

/** The target's box with the room round it and the corner radius of the cut-out. */
export interface Spot { box: Box; radius: number }

export interface TourStep {
  id: StepId;
  text: MessageKey;
  followup?: MessageKey;
  target?: () => HTMLElement | null;
  opened?: () => HTMLElement | null;
  prefer: readonly Side[];
  pad?: number;
  keys?: true;
}

/** The first visible match, ignoring copies kept on hidden pages. */
export function firstShown(selector: string, { includeInert = false } = {}): HTMLElement | null {
  const unavailable = includeInert ? "[hidden], .leaving" : "[hidden], [inert], .leaving";
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.closest(unavailable)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 4 && rect.height > 4 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight) return el;
  }
  return null;
}

/** A settings dialog scales in from its centre. Keep its final footprint clear throughout the entrance. */
export function boxOf(element: HTMLElement): Box {
  const scrim = element.offsetParent;
  if (!element.matches(".modal-scrim > .modal") || !(scrim instanceof HTMLElement)) return element.getBoundingClientRect();
  const shell = scrim.getBoundingClientRect();
  return { left: shell.left + element.offsetLeft, top: shell.top + element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
}

/** The target's rectangle with room round it and a radius that follows its own. */
export function spotOf(element: HTMLElement, pad: number): Spot {
  const rect = boxOf(element);
  const own = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  const box: Box = { left: Math.round(rect.left - pad), top: Math.round(rect.top - pad), width: Math.round(rect.width + 2 * pad), height: Math.round(rect.height + 2 * pad) };
  return { box, radius: Math.round(Math.min(Math.max(own + pad, 12), Math.min(box.width, box.height) / 2)) };
}

export const COMPOSER = ".page-agent:not([hidden]) .composer";
export const COMPOSER_FIELD = COMPOSER + " .cmp-input";

export const STEPS: readonly TourStep[] = [
  { id: "composer", text: "tour.composer", followup: "tour.composerDone", target: () => firstShown(COMPOSER), prefer: ["above", "right"], pad: 6 },
  { id: "permission", text: "tour.permission", followup: "tour.permissionDone", target: () => firstShown(COMPOSER + " .cmp-mode"),
    opened: () => firstShown(".cb-menu:has(.cb-modes)"), prefer: ["above"], pad: 4 },
  { id: "model", text: "tour.model", followup: "tour.modelDone", target: () => firstShown(COMPOSER + " .cmp-model:has(.mp-trigger:not(:disabled))"),
    opened: () => firstShown(".cb-menu:has(.cb-now)"),
    prefer: ["above"], pad: 4 },
  { id: "apps", text: "tour.apps", followup: "tour.appsDone", target: () => firstShown("#nav .sidebar-apps"),
    opened: () => firstShown('.modal-scrim[data-standalone="connections"] > .modal'),
    prefer: ["right", "above"], pad: 4 },
  { id: "team", text: "tour.team", target: () => firstShown("#nav .sidebar-conversations"), prefer: ["right"] },
  { id: "account", text: "tour.account", followup: "tour.accountDone", target: () => firstShown("#nav .sidebar-account"),
    opened: () => firstShown(".account-menu"), prefer: ["above"], pad: 4 },
  { id: "keys", text: "tour.keys", prefer: ["inside"], keys: true },
];

export const SECONDS_PER_STEP = 15;
export const tourMinutes = (steps: number): number => Math.max(1, Math.round(steps * SECONDS_PER_STEP / 60));

/** The first shortcut that asks Raphael, in the words of the window. */
export function askKeys(device: Pick<DeviceSettings, "agent_keys">): string[] {
  const binding = device.agent_keys[0];
  return binding ? bindingLabels(binding) : [];
}
