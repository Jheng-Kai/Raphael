/** How many places are kept; the oldest go first. */
export const NAV_LIMIT = 50;

export type NavStep = "back" | "forward";

type RestoreLayer = () => void;
let place: object | undefined;
const forwardLayers: { place?: object; restore: RestoreLayer; discard?: () => void }[] = [];
let restoring = false;

export function setLayerPlace(next: object | undefined): void { place = next; }

export function clearLayerForward(): void {
  if (restoring) return;
  for (const entry of forwardLayers.splice(0)) entry.discard?.();
}

/** An arrow and either navigation shortcut save the same return path. */
export function rememberLayerBack(close: () => void, restore: RestoreLayer, discard?: () => void): void {
  const wasRestoring = restoring;
  restoring = true;
  try { close(); } finally { restoring = wasRestoring; }
  forwardLayers.push({ place, restore, discard });
}

export function restoreLayerForward(): boolean {
  const entry = forwardLayers[forwardLayers.length - 1];
  if (!entry || entry.place !== place) return false;
  forwardLayers.pop();
  restoring = true;
  try { entry.restore(); } finally { restoring = false; }
  return true;
}
