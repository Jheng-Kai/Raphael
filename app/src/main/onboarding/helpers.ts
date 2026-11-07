// Small rules of the guide that do not belong to one step. Pure, so each is tested on its own.

import { popularRank } from "../store-finder";
import type { StoreService } from "../types";

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
