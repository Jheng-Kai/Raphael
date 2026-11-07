// Small rules of the guide that do not belong to one step. Pure, so each is tested on its own.

import { type Capability, CAPABILITIES, canTurnOn, isOn, serviceRows } from "../services";
import { popularRank } from "../store-finder";
import type { BrainSettings, ServicesStatus, StoreService } from "../types";
import type { IconName } from "../ui";

/** One ability of the third step: what a member can use, and whether it is on. */
export interface AbilityRow {
  kind: Capability;
  icon: IconName;
  label: string;
  about: string;
  on: boolean;
  /** Why it cannot be turned on yet (it needs a key, an address or a voice model, set in the settings); null when it can. */
  note: string | null;
}

/**
 * The abilities the members share, in the order of Settings > Tools, with the switches as they are.
 * Seeing images is always one switch away; the others wait for what their service needs.
 */
export function abilityRows(status: ServicesStatus, brain: BrainSettings | null): AbilityRow[] {
  return CAPABILITIES.map((entry) => {
    const chosen = serviceRows(entry.kind, status, brain).find((row) => row.chosen);
    const waits = entry.kind !== "vision" && !canTurnOn(entry.kind, status, brain);
    return {
      kind: entry.kind,
      icon: entry.icon,
      label: entry.label(),
      about: entry.about(),
      on: isOn(entry.kind, status, brain),
      note: waits ? chosen?.note || null : null,
    };
  });
}

/** The services the second step offers. */
export const SERVICES_SHOWN = 6;

const identity = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The services the guide offers to connect, from the same lists as the store of Connect apps: the
 * built-in catalog and, when Composio is set up, its managed apps. Only what asks no more than a
 * sign-in is offered (an app that wants its own key or developer app is set up in the store, with
 * its form). The popular ones come first, in the store's own order; a built-in app wins over a
 * managed one of the same name.
 */
export function pickServices(builtin: readonly StoreService[], managed: readonly StoreService[], limit = SERVICES_SHOWN): StoreService[] {
  const seen = new Set<string>();
  const unique = (list: readonly StoreService[]): StoreService[] =>
    list.filter((s) => {
      const keys = [identity(s.id), identity(s.name)];
      if (keys.some((key) => seen.has(key))) return false;
      keys.forEach((key) => seen.add(key));
      return true;
    });
  const all = [...unique(builtin), ...unique(managed)].filter((s) => (s.needs ?? "sign_in") === "sign_in");
  return all
    .map((s, at) => ({ s, at }))
    .sort((a, b) => popularRank(a.s) - popularRank(b.s) || Number(b.s.popular) - Number(a.s.popular) || a.at - b.at)
    .slice(0, limit)
    .map(({ s }) => s);
}
