/** Compare wire values without serializing message histories or retaining a second copy of their strings. */
export function sameWire(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameWire(left[key], right[key]));
}

/** A page owns its rendered lines. Only a changed record or that line's presentation dependencies rebuilds it. */
export class ThreadRenderCache {
  private readonly lines = new Map<string, { source: unknown; dependencies: readonly unknown[]; html: string }>();

  line(key: string, source: unknown, dependencies: readonly unknown[], draw: () => string): string {
    const before = this.lines.get(key);
    if (before && dependencies.length === before.dependencies.length && dependencies.every((value, index) => value === before.dependencies[index]) &&
        (source === before.source || sameWire(source, before.source))) return before.html;
    const html = draw();
    this.lines.set(key, { source, dependencies, html });
    return html;
  }

  retain(keys: ReadonlySet<string>): void { for (const key of this.lines.keys()) if (!keys.has(key)) this.lines.delete(key); }
  clear(): void { this.lines.clear(); }
}
