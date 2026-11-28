import { expect, test } from "vitest";
import { dimClip } from "./dim";

function painted(clip: string, width: number, height: number, x: number, y: number): boolean {
  const coordinate = (value: string, size: number) => parseFloat(value) * (value.endsWith("%") ? size / 100 : 1);
  const vertices = clip.slice("polygon(evenodd, ".length, -1).split(", ").map(pair => {
    const [vx, vy] = pair.split(" ");
    return [coordinate(vx, width), coordinate(vy, height)];
  });
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [ax, ay] = vertices[j], [bx, by] = vertices[i];
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

test.each([[720, 900], [1120, 900], [1920, 1080]])("a round account opening still dims all four corners and the centre at %ix%i", (width, height) => {
  const top = height - 48;
  const clip = dimClip({ box: { left: 8, top, width: 44, height: 44 }, radius: 22 });
  for (const [x, y] of [[1, 1], [width - 1, 1], [1, height - 1], [width - 1, height - 1], [width / 2, height / 2]]) {
    expect(painted(clip, width, height, x, y)).toBe(true);
  }
  expect(painted(clip, width, height, 30, top + 2)).toBe(false);
  expect(painted(clip, width, height, 10, top + 2)).toBe(true);
  // The outer contour fills a resized viewport before the opening has moved.
  expect(painted(clip, width + 200, height + 200, width + 199, height + 199)).toBe(true);
});

test("a wide rounded opening can extend past the window and keep the centre clear", () => {
  const clip = dimClip({ box: { left: -20, top: 140, width: 500, height: 260 }, radius: 16 });
  expect(painted(clip, 720, 480, 360, 240)).toBe(false);
  expect(painted(clip, 720, 480, 1, 240)).toBe(false);
  expect(painted(clip, 720, 480, 478, 142)).toBe(true);
  expect(painted(clip, 720, 480, 481, 240)).toBe(true);
});
