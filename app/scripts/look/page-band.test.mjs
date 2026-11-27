import { expect, it } from "vitest";
import { bandPlan, bandProblems, rgb } from "./page-band.mjs";

// The frame as the window shows it (a 1920 x 1080 window, the page beside a 260 px sidebar), and what a light reading page says of itself.
const frame = { left: 260, top: 56, right: 1920, bottom: 1080 };
const measure = { canvas: "rgb(247, 241, 227)", bodyLeft: 270, bodyRight: 1390, firstTop: 32, lastBottom: 3000, scrollY: 0, scrollMax: 2200, innerHeight: 1024, foot: 124 };
const shown = { frame, composerTop: 960, windowHeight: 1080 };
const page = [247, 241, 227], black = [10, 10, 10];

it("reads a colour the page paints, and nothing else", () => {
  expect(rgb("rgb(247, 241, 227)")).toEqual([247, 241, 227]);
  expect(rgb("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0]);
  expect(rgb(null)).toBeNull();
  expect(rgb("red")).toBeNull();
});

it("looks above the first line from the top and below the last line at the end, and always at the window's foot", () => {
  const top = bandPlan({ where: "top", ...shown, measure });
  expect(top.problems).toEqual([]);
  expect(top.points.map(point => point.name)).toEqual(["above the content", "the window's foot"]);
  // Above the content: inside the body's width, between the frame's top and the first line.
  expect(top.points[0].x).toBe(260 + 270 + 8);
  expect(top.points[0].y).toBeGreaterThan(56);
  expect(top.points[0].y).toBeLessThan(56 + 32);
  expect(top.points[1]).toMatchObject({ x: 264, y: 1076 });

  const end = bandPlan({ where: "end", ...shown, measure: { ...measure, lastBottom: 860, scrollY: 2200 } });
  expect(end.problems).toEqual([]);
  expect(end.points[0].name).toBe("below the content");
  expect(end.points[0].y).toBeGreaterThan(56 + 860);
  expect(end.points[0].y).toBeLessThan(960);
});

it("refuses a page that is not read where the check says, or whose last line is under the composer", () => {
  expect(bandPlan({ where: "top", ...shown, measure: { ...measure, scrollY: 400 } }).problems[0]).toMatch(/read from its top/);
  expect(bandPlan({ where: "end", ...shown, measure: { ...measure, lastBottom: 860, scrollY: 100 } }).problems[0]).toMatch(/read to its end/);
  // The last line ends at 56 + 930 = 986: past where the composer begins (960).
  const under = bandPlan({ where: "end", ...shown, measure: { ...measure, lastBottom: 930, scrollY: 2200 } });
  expect(under.problems[0]).toMatch(/last line stands under the composer/);
});

it("a band of the window's own colour above, below or beside the page is the failure; the page's own colour everywhere is the pass", () => {
  const plan = bandPlan({ where: "top", ...shown, measure });
  expect(bandProblems(plan, measure, [page, page], page)).toEqual([]);
  // A few levels of difference is no band; the black strip above a light page is.
  expect(bandProblems(plan, measure, [[245, 241, 227], page], page)).toEqual([]);
  expect(bandProblems(plan, measure, [black, page], page)[0]).toMatch(/above the content shows rgb\(10, 10, 10\) where the page paints rgb\(247, 241, 227\)/);
  expect(bandProblems(plan, measure, [page, black], page)[0]).toMatch(/window's foot shows rgb\(10, 10, 10\)/);
  // A page that paints nothing of its own is judged against its own corner: every place shows the one colour.
  const bare = { ...measure, canvas: null };
  expect(bandProblems(plan, bare, [black, black], black)).toEqual([]);
  expect(bandProblems(plan, bare, [[255, 255, 255], black], black)).toHaveLength(1);
  // A place that could not be read is a failure, never a pass.
  expect(bandProblems(plan, measure, [undefined, page], page)[0]).toMatch(/nothing was read/);
});
