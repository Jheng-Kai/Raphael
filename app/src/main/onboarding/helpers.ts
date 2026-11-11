// Small rules of the guide that do not belong to one step. Pure, so each is tested on its own.

import { popularRank } from "../store-finder";
import type { StoreService } from "../types";

/** The services the second step offers: six rows of the three-column grid, the rest of the store being a search away. */
export const SERVICES_SHOWN = 18;

/** How long the services step waits for the store's lists before it offers 重試. */
export const SERVICES_WAIT_MS = 15_000;

/**
 * `promise`, or a rejection after `ms`: a call the core does not answer never keeps a screen spinning.
 */
export function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

const identity = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every app the guide can add, from the same lists as the store of Connect apps, in order: the built-in catalog, the
 * apps run on the owner's own server (n8n), and, when Composio is set up, its managed apps. An app listed twice is
 * kept where it first comes, so a built-in app wins over a managed one of the same name.
 */
export function mergeServices(...lists: readonly (readonly StoreService[])[]): StoreService[] {
  const seen = new Set<string>();
  return lists.flatMap((list) =>
    list.filter((s) => {
      const keys = [identity(s.id), identity(s.name)];
      if (keys.some((key) => seen.has(key))) return false;
      keys.forEach((key) => seen.add(key));
      return true;
    }));
}

/**
 * What the step shows before anything is searched: the apps that ask no more than a sign-in, the popular ones first in
 * the store's own order. An app that wants its own key, developer app or server is a search away, set up in its tile.
 */
export function popularServices(all: readonly StoreService[], limit = SERVICES_SHOWN): StoreService[] {
  return all
    .filter((s) => (s.needs ?? "sign_in") === "sign_in")
    .map((s, at) => ({ s, at }))
    .sort((a, b) => popularRank(a.s) - popularRank(b.s) || Number(b.s.popular) - Number(a.s.popular) || a.at - b.at)
    .slice(0, limit)
    .map(({ s }) => s);
}

/** The popular sign-in apps of the built-in catalog and Composio's managed apps together. */
export function pickServices(builtin: readonly StoreService[], managed: readonly StoreService[], limit = SERVICES_SHOWN): StoreService[] {
  return popularServices(mergeServices(builtin, managed), limit);
}
