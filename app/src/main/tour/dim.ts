import type { Spot } from "./steps";

/** Keep the outer contour tied to the viewport while the rounded opening moves in pixels. */
function contour({ box, radius }: Spot): string {
  const { left, top, width, height } = box;
  const right = left + width, bottom = top + height;
  const r = Math.min(Math.max(0, radius), width / 2, height / 2);
  const corners = [[right - r, top + r], [right - r, bottom - r], [left + r, bottom - r], [left + r, top + r]];
  // Eight segments per quarter keep the curve within a fraction of a pixel at tour target sizes.
  const opening = corners.flatMap(([x, y], corner) => Array.from({ length: 9 }, (_, segment) => {
    const angle = (corner - 1 + segment / 8) * Math.PI / 2;
    return `${(x + r * Math.cos(angle)).toFixed(3)}px ${(y + r * Math.sin(angle)).toFixed(3)}px`;
  }));
  return `${opening.join(", ")}, ${opening[0]}, 0 0`;
}

export function dimClip(spot: Spot): string {
  // The opening's closed contour returns over a bridge to the corner so it only cuts out its own interior.
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${contour(spot)})`;
}
