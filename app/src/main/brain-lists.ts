/**
 * The one copy of what the core last said about the brains, for everything that draws a model: the composer and
 * Settings read the same lists, so one can never name a model the other only knows by its id.
 */
import type { CliBrain, ModelCatalog } from "./types";

let clis: CliBrain[] = [];
let catalog: ModelCatalog | null = null;

export const knownClis = (): CliBrain[] => clis;
export const knownCatalog = (): ModelCatalog | null => catalog;
export function rememberClis(next: CliBrain[]): void { clis = next; }
export function rememberCatalog(next: ModelCatalog): void { catalog = next; }
