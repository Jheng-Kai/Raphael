import data from "../../../core/src/raphael_core/connectors/finder-data.json";
import type { StoreService } from "./types";
import { type PreparedName, prepareName, preparedScore } from "./find-match";

export const STORE_PAGE_SIZE = 18;
export const STORE_GROUPS = [...Object.keys(data.groups), "other"];
const indexed = new WeakMap<StoreService, string>();
const preparedNames = new WeakMap<StoreService, PreparedName[]>();
const normalize = (text: string): string => text.normalize("NFKC").toLowerCase().trim();

/**
 * How well a found app's own names answer the query, best first (owner, 2026-11-14: 「line」 listed apps whose descriptions
 * say "timeline" or "online" before LINE itself): 0 the name (or id, or another name) is the query, 1 the name starts with
 * it, 2 a word of the name starts with it, 3 the name holds it, 4 its id, publisher or other names hold it, 5 only its
 * description does.
 */
export function storeNameRank(item: StoreService, query: string): number {
  const q = normalize(query);
  const name = normalize(item.name);
  const others = [item.id, item.publisher ?? "", data.aliases[item.id as keyof typeof data.aliases] ?? ""].map(normalize);
  if (name === q || others.some(other => other === q || other.split(/[\s,]+/).includes(q))) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(/[\s\-_./()]+/).some(word => word.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  if (others.some(other => other.includes(q))) return 4;
  return 5;
}

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
 * typos and swapped letters forgiven (`find-match.ts`: 「gamil」 finds Gmail); Infinity when it does not.
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

const grouped = new WeakMap<StoreService, string>();
export function storeGroup(item: StoreService): string {
  let group = grouped.get(item);
  if (group === undefined) {
    const category = normalize(item.category);
    group = Object.entries(data.groups).find(([, terms]) => terms.some(term => category.includes(term)))?.[0] ?? "other";
    grouped.set(item, group);
  }
  return group;
}

export const popularApp = (item: StoreService): boolean => data.popular.includes(item.id);

/** Where an app stands among the popular ones; the unlisted come after all of them. */
export const popularRank = (item: StoreService): number => {
  const at = data.popular.indexOf(item.id);
  return at < 0 ? data.popular.length : at;
};
