// A resting slime's eyes turn toward the pointer when it comes near, as Grok Bot's bots do (owner, 2026-11-06): in the
// sidebar, the panel, the member maker's preview, anywhere a slime is drawn. One reading per frame at most, only the
// slimes close to the pointer move, and the rest ease back. Sleeping and working slimes keep their own eyes.

/** How far the eyes go, in the drawing's units (its view box is 92 wide). */
const REACH_X = 3.2, REACH_Y = 2.4;
/** How far from a slime, in its own widths, the pointer still draws its eyes. */
const NEAR = 4;

/** The eyes' offset toward the pointer at (`x`, `y`) for a slime in `box`, or null when the pointer is too far. */
export function followOffset(box: { left: number; top: number; width: number; height: number }, x: number, y: number): { x: number; y: number } | null {
  if (box.width <= 0) return null;
  const cx = box.left + box.width / 2, cy = box.top + box.height * 0.48;
  const dx = x - cx, dy = y - cy, distance = Math.hypot(dx, dy);
  if (distance > Math.max(160, box.width * NEAR)) return null;
  // Close by, the eyes go only part of the way; a slime's width away and more, all of it.
  const pull = Math.min(1, distance / box.width) / Math.max(distance, 1);
  return { x: Number((dx * pull * REACH_X).toFixed(2)), y: Number((dy * pull * REACH_Y).toFixed(2)) };
}

export function installSlimeFollow(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win || win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  let x = 0, y = 0, queued = false;
  const moved = new Set<SVGElement>();
  const place = (group: SVGElement, offset: { x: number; y: number } | null): void => {
    if (offset) {
      group.style.setProperty("--slime-follow-x", `${offset.x}px`);
      group.style.setProperty("--slime-follow-y", `${offset.y}px`);
      moved.add(group);
    } else if (moved.delete(group)) {
      group.style.removeProperty("--slime-follow-x");
      group.style.removeProperty("--slime-follow-y");
    }
  };
  const update = (): void => {
    queued = false;
    const near = new Set<SVGElement>();
    for (const svg of doc.querySelectorAll<SVGElement>("svg.slime[data-state=\"idle\"]")) {
      const group = svg.querySelector<SVGElement>(".slime-follow");
      if (!group) continue;
      const offset = followOffset(svg.getBoundingClientRect(), x, y);
      if (offset) { place(group, offset); near.add(group); }
    }
    for (const group of [...moved]) if (!near.has(group)) place(group, null);
  };
  const onMove = (event: PointerEvent): void => {
    x = event.clientX; y = event.clientY;
    if (!queued) { queued = true; win.requestAnimationFrame(update); }
  };
  const onLeave = (): void => { for (const group of [...moved]) place(group, null); };
  doc.addEventListener("pointermove", onMove, { passive: true });
  doc.documentElement.addEventListener("pointerleave", onLeave);
  return () => {
    doc.removeEventListener("pointermove", onMove);
    doc.documentElement.removeEventListener("pointerleave", onLeave);
    onLeave();
  };
}
