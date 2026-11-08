import data from "../../../core/src/raphael_core/connectors/finder-data.json";
import type { StoreService } from "./types";
import { type PreparedName, prepareName, preparedScore } from "./find-match";

export const STORE_PAGE_SIZE = 18;
export const STORE_GROUPS = [...Object.keys(data.groups), "other"];
const indexed = new WeakMap<StoreService, string>();
const preparedNames = new WeakMap<StoreService, PreparedName[]>();
const normalize = (text: string): string => text.normalize("NFKC").toLowerCase().trim();

export function storeMatches(item: StoreService, query: string): boolean {
  let text = indexed.get(item);
  if (text === undefined) {
    const aliases = data.aliases[item.id as keyof typeof data.aliases] ?? "";
    text = normalize([item.id, item.name, item.publisher, ...Object.values(item.summary), ...Object.values(item.about), aliases].join(" "));
    indexed.set(item, text);
  }
  return normalize(query).split(/\s+/).every(token => text.includes(token));
}

/**
 * How near a query that finds nothing as typed comes to an app's names (its name, id, publisher and other names), with
 * typos and swapped letters forgiven (`find-match.ts`, owner 2026-11-08: 「gamil」 finds Gmail); Infinity when it does not.
 * Only the names, never the long descriptions: a near miss in a paragraph is noise.
 */
export function storeNear(item: StoreService, query: string): number {
  let names = preparedNames.get(item);
  if (!names) {
    names = [item.id, item.name, item.publisher, data.aliases[item.id as keyof typeof data.aliases] ?? ""].filter(Boolean).map(prepareName);
    preparedNames.set(item, names);
  }
  return preparedScore(names, query);
}

export function storeGroup(item: StoreService): string {
  const category = normalize(item.category);
  return Object.entries(data.groups).find(([, terms]) => terms.some(term => category.includes(term)))?.[0] ?? "other";
}

export const popularApp = (item: StoreService): boolean => data.popular.includes(item.id);

/** Where an app stands among the popular ones; the unlisted come after all of them. */
export const popularRank = (item: StoreService): number => {
  const at = data.popular.indexOf(item.id);
  return at < 0 ? data.popular.length : at;
};
