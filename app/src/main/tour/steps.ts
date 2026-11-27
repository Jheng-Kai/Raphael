// The steps of the guided tour, in the order a newcomer needs them: what they say, what they point at and where Raphael
// stands. A step is written for someone who does not yet know what a connector, a skill or the safety rules are, so each
// line says what the thing is for, never only its name.

import { bindingLabels } from "../keys";
import type { MessageKey } from "../i18n/zh-TW";
import type { DeviceSettings, SettingsPane } from "../types";
import type { Box, Side } from "./place";

export type StepId = "composer" | "team" | "apps" | "permission" | "model" | "usage" | "skills" | "safety" | "keys";

/** What a step points at: its box with the room round it, and the corner radius of the cut-out. */
export interface Spot { box: Box; radius: number }

export interface TourStep {
  id: StepId;
  /** The line Raphael says (tour.* in the catalogues). */
  text: MessageKey;
  /** The sides of the target Raphael tries first. */
  prefer: readonly Side[];
  /** The tab of Settings this step opens and points into; the tour closes Settings again when it leaves the step. */
  pane?: SettingsPane;
  /** The element the step points at; a step with none points at nothing (the keys of the whole computer). */
  target?: () => HTMLElement | null;
  /** Room kept round the target inside the cut-out. */
  pad?: number;
  /** The step draws the keys that ask Raphael as caps under its line. */
  keys?: true;
}

/** Whether `element` is drawn on screen now. A hidden ancestor, no box or a box outside the window all say no. */
export function shown(element: Element | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected || element.closest("[hidden]")) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 4 && rect.height > 4 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
}

/** The first of `selector`'s elements that is drawn (a page that is not on screen may keep its own copy hidden). */
export function firstShown(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) if (shown(element)) return element;
  return null;
}

/** The target's rectangle with `pad` round it, and a corner radius that follows its own. */
export function spotOf(element: HTMLElement, pad: number): Spot {
  const rect = element.getBoundingClientRect();
  const own = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  const box: Box = { left: Math.round(rect.left - pad), top: Math.round(rect.top - pad), width: Math.round(rect.width + 2 * pad), height: Math.round(rect.height + 2 * pad) };
  return { box, radius: Math.round(Math.min(Math.max(own + pad, 12), Math.min(box.width, box.height) / 2)) };
}

const COMPOSER = ".page-agent:not([hidden]) .composer";

export const STEPS: readonly TourStep[] = [
  { id: "composer", text: "tour.composer", prefer: ["above", "right"], target: () => firstShown(COMPOSER), pad: 6 },
  { id: "team", text: "tour.team", prefer: ["right"], target: () => firstShown("#nav .sidebar-conversations"), pad: 0 },
  { id: "apps", text: "tour.apps", prefer: ["right", "above"], target: () => firstShown("#nav .sidebar-apps"), pad: 4 },
  { id: "permission", text: "tour.permission", prefer: ["above"], target: () => firstShown(`${COMPOSER} .cmp-mode`), pad: 4 },
  { id: "model", text: "tour.model", prefer: ["above"], target: () => firstShown(`${COMPOSER} .cmp-model`), pad: 4 },
  { id: "usage", text: "tour.usage", prefer: ["inside"], pane: "usage", target: () => firstShown('.modal-scrim[data-page="settings"] .modal'), pad: 0 },
  { id: "skills", text: "tour.skills", prefer: ["inside"], pane: "skills", target: () => firstShown('.modal-scrim[data-page="settings"] .modal'), pad: 0 },
  { id: "safety", text: "tour.safety", prefer: ["inside"], pane: "safety", target: () => firstShown('.modal-scrim[data-page="settings"] .modal'), pad: 0 },
  { id: "keys", text: "tour.keys", prefer: ["inside"], keys: true },
];

/** Each step takes about this long to read and take in; the offer says how many minutes the tour takes from it. */
export const SECONDS_PER_STEP = 15;
export const tourMinutes = (steps: number): number => Math.max(1, Math.round(steps * SECONDS_PER_STEP / 60));

/** The caps of the keys that ask Raphael, from the shortcut settings: the first binding the owner has, in the words of the window. */
export function askKeys(device: Pick<DeviceSettings, "agent_keys">): string[] {
  const binding = device.agent_keys[0];
  return binding ? bindingLabels(binding) : [];
}
