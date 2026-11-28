// Targets and results of the guided tour, in the order Raphael introduces them.

import { bindingLabels } from "../keys";
import type { DeviceSettings } from "../types";
import type { Box, Side } from "./place";

type StepId = "composer" | "permission" | "manual" | "model" | "model-list" | "apps" | "app-search" |
  "team" | "slime-look" | "account" | "settings" | "usage" | "keys";
type Line = "composer" | "permission" | "manual" | "model" | "modelList" | "apps" | "appSearch" |
  "team" | "slimeLook" | "account" | "settings" | "usage" | "keys";
type Title = "composer" | "permission" | "model" | "apps" | "team" | "account" | "keys";
export type Layer = keyof typeof LAYERS;

/** The target's box with the room round it and the corner radius of the cut-out. */
export interface Spot { box: Box; radius: number }

export interface TourStep {
  id: StepId;
  title: `tour.${Title}Title`;
  text: `tour.${Line}`;
  target?: string;
  layer?: Layer;
  opens?: Layer;
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

const APP_SEARCH = LAYERS.apps + " #conn-search";

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
  { id: "composer", title: "tour.composerTitle", text: "tour.composer", target: COMPOSER_FIELD, prefer: ["above"], pad: 6 },
  { id: "permission", title: "tour.permissionTitle", text: "tour.permission", target: ACTION_MODE, opens: "permission", prefer: ["above"], pad: 4 },
  { id: "manual", title: "tour.permissionTitle", text: "tour.manual", target: LAYERS.permission + ' .cb-row[data-mode="ask"]',
    layer: "permission", reacted: () => !firstShown(LAYERS.permission) && firstShown(ACTION_MODE)?.dataset.mode === "ask", prefer: ["right", "left"] },
  { id: "model", title: "tour.modelTitle", text: "tour.model", target: COMPOSER + " .cmp-model .mp-trigger:not(:disabled)",
    opens: "model", prefer: ["above"], pad: 4 },
  { id: "model-list", title: "tour.modelTitle", text: "tour.modelList", target: LAYERS.model + ' .cb-pick[data-cb-act="models"]',
    layer: "model", reacted: () => !!firstShown('.cb-menu .cb-body[data-view="models"]'), prefer: ["left", "right"] },
  { id: "apps", title: "tour.appsTitle", text: "tour.apps", target: "#nav .sidebar-apps", opens: "apps", prefer: ["right", "above"], pad: 4 },
  { id: "app-search", title: "tour.appsTitle", text: "tour.appSearch", target: APP_SEARCH, layer: "apps",
    reacted: () => !!document.querySelector<HTMLInputElement>(APP_SEARCH)?.value.trim() &&
      !!firstShown(LAYERS.apps + " [data-cs-body] > :is(.cs-grid, .cs-none)"), prefer: ["right", "left"] },
  { id: "team", title: "tour.teamTitle", text: "tour.team", target: '#nav [data-col="add"]', opens: "team", prefer: ["right", "below"], pad: 4 },
  { id: "slime-look", title: "tour.teamTitle", text: "tour.slimeLook", target: ".cr-dialog .cr-picker", layer: "team",
    reacted: () => !!firstShown('.cr-dialog .cr-face svg[data-state="arriving"]'), prefer: ["right", "left"] },
  { id: "account", title: "tour.accountTitle", text: "tour.account", target: "#nav .sidebar-account", opens: "account", prefer: ["above"], pad: 4 },
  { id: "settings", title: "tour.accountTitle", text: "tour.settings", target: '.account-menu [data-account="settings"]',
    layer: "account", opens: "settings", prefer: ["right", "above"] },
  { id: "usage", title: "tour.accountTitle", text: "tour.usage", target: LAYERS.settings + ' [data-pane="usage"]', layer: "settings",
    reacted: () => !!firstShown(LAYERS.settings + ' [data-usage-tab][aria-selected="true"]'), prefer: ["right", "left"] },
  { id: "keys", title: "tour.keysTitle", text: "tour.keys", prefer: ["inside"], keys: true },
];

/** The first shortcut that asks Raphael, in the words of the window. */
export function askKeys(device: Pick<DeviceSettings, "agent_keys">): string[] {
  const binding = device.agent_keys[0];
  return binding ? bindingLabels(binding) : [];
}
