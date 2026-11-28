// Targets and results of the guided tour, in the order Raphael introduces them.

import { bindingLabels } from "../keys";
import type { DeviceSettings } from "../types";
import type { Box, Side } from "./place";

type StepId = "permission" | "model" | "model-list" | "apps" | "team" | "account" | "dictation" | "calendar" | "raphael" | "keys";
type Line = "permission" | "model" | "modelList" | "apps" | "team" | "account" | "dictation" | "calendar" | "raphael" | "keys";
type Seen = "permissionSeen" | "modelListSeen" | "appsSeen" | "teamSeen" | "dictationSeen" | "calendarSeen" | "raphaelSeen";
type Title = "permission" | "model" | "apps" | "team" | "account" | "dictation" | "calendar" | "raphael" | "keys";
export type Layer = keyof typeof LAYERS;

/** The target's box with the room round it and the corner radius of the cut-out. */
export interface Spot { box: Box; radius: number }

/**
 * A step is one thing the person does (`text`, the framed `target`), and, when it opens something worth a look, a second
 * moment (`seen`) where that thing is lit and explained until the person says they have understood. A step without
 * `seen` moves on by itself once the app reacts, into a step that works inside what just opened.
 */
export interface TourStep {
  id: StepId;
  title: `tour.${Title}Title`;
  text: `tour.${Line}`;
  seen?: `tour.${Seen}`;
  /** What is lit while `seen` is read; the layer the step opened when it names none. */
  look?: string;
  target?: string;
  layer?: Layer;
  opens?: Layer;
  /** The page the step's row goes to, instead of a layer: the tour comes back to the conversation once it was looked at. */
  page?: string;
  reacted?: () => boolean;
  prefer: readonly Side[];
  pad?: number;
  keys?: true;
}

/** The first visible match, ignoring copies kept on hidden pages. */
export function firstShown(selector: string, { includeInert = false } = {}): HTMLElement | null {
  const unavailable = includeInert ? "[hidden], .leaving" : "[hidden], [inert], .leaving";
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.closest(unavailable) || !el.checkVisibility({ visibilityProperty: true })) continue;
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
export const SEND = COMPOSER + " .cmp-send:not(:disabled)";
export const ACTION_MODE = COMPOSER + " .cmp-mode:not(:disabled)";
export const LAYERS = {
  permission: ".cb-menu:has(.cb-modes)",
  model: ".cb-menu:has(.cb-now)",
  apps: '.modal-scrim[data-standalone="connections"] > .modal',
  team: ".mb-scrim > .cr-dialog",
  account: ".account-menu",
  settings: '.modal-scrim[data-page="settings"]:not([data-standalone]) > .modal',
} as const;

/** The page area beside the sidebar, lit while a page the account menu opened is looked at. */
export const PAGE_AREA = "#main";
const PAGES = {
  dictation: "#main > .page-dictation",
  calendar: "#main > .au-page",
  raphael: "#main > .page-agent[data-raphael]",
} as const;
const accountRow = (id: string) => `${LAYERS.account} [data-account="${id}"]`;
const pageStep = (id: keyof typeof PAGES): Pick<TourStep, "target" | "layer" | "page" | "look" | "reacted"> => ({
  target: accountRow(id), layer: "account", page: PAGES[id], look: PAGE_AREA, reacted: () => !!firstShown(PAGES[id]),
});

export const PRESSABLE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable], [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="switch"], [data-conn][data-row]';

/** The part of each control still visible inside its scrollport, if any. */
export function pressableBoxes(layer: HTMLElement): Box[] {
  return [...layer.querySelectorAll<HTMLElement>(PRESSABLE)].flatMap(element => {
    if (!element.checkVisibility({ visibilityProperty: true })) return [];
    let { left, right, top, bottom } = element.getBoundingClientRect();
    for (let parent = element.parentElement; parent && layer.contains(parent); parent = parent.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(parent);
      if (overflowX !== "visible" || overflowY !== "visible") {
        const clip = parent.getBoundingClientRect();
        if (overflowX !== "visible") { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (overflowY !== "visible") { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
    }
    return right > left && bottom > top ? [{ left, top, width: right - left, height: bottom - top }] : [];
  });
}

export const STEPS: readonly TourStep[] = [
  { id: "permission", title: "tour.permissionTitle", text: "tour.permission", seen: "tour.permissionSeen",
    target: ACTION_MODE, opens: "permission", prefer: ["above"], pad: 4 },
  { id: "model", title: "tour.modelTitle", text: "tour.model", target: COMPOSER + " .cmp-model .mp-trigger:not(:disabled)",
    opens: "model", prefer: ["above"], pad: 4 },
  { id: "model-list", title: "tour.modelTitle", text: "tour.modelList", seen: "tour.modelListSeen",
    target: LAYERS.model + ' .cb-pick[data-cb-act="models"]', layer: "model",
    reacted: () => !!firstShown('.cb-menu .cb-body[data-view="models"]'), prefer: ["left", "right"] },
  { id: "apps", title: "tour.appsTitle", text: "tour.apps", seen: "tour.appsSeen",
    target: "#nav .sidebar-apps", opens: "apps", prefer: ["right", "above"], pad: 4 },
  { id: "team", title: "tour.teamTitle", text: "tour.team", seen: "tour.teamSeen",
    target: '#nav [data-col="add"]', opens: "team", prefer: ["right", "below"], pad: 4 },
  { id: "account", title: "tour.accountTitle", text: "tour.account",
    target: "#nav .sidebar-account", opens: "account", prefer: ["above"], pad: 4 },
  // Each row of the account menu worth knowing is pressed in turn; after a look the tour opens the menu again for the next one.
  { id: "dictation", title: "tour.dictationTitle", text: "tour.dictation", seen: "tour.dictationSeen", ...pageStep("dictation"), prefer: ["right", "above"] },
  { id: "calendar", title: "tour.calendarTitle", text: "tour.calendar", seen: "tour.calendarSeen", ...pageStep("calendar"), prefer: ["right", "above"] },
  { id: "raphael", title: "tour.raphaelTitle", text: "tour.raphael", seen: "tour.raphaelSeen", ...pageStep("raphael"), prefer: ["right", "above"] },
  { id: "keys", title: "tour.keysTitle", text: "tour.keys", prefer: ["inside"], keys: true },
];

/** The first shortcut that asks Raphael, in the words of the window. */
export function askKeys(device: Pick<DeviceSettings, "agent_keys">): string[] {
  const binding = device.agent_keys[0];
  return binding ? bindingLabels(binding) : [];
}
