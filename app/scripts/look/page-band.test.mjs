import { expect, it } from "vitest";
import { bandPlan, bandProblems, contrast, rgb, toneOf } from "./page-band.mjs";

// The frame as the window shows it (a 1920 x 1080 window, the page beside a 260 px sidebar), and what a light reading page says of itself.
const frame = { left: 260, top: 56, right: 1920, bottom: 1080 };
const fade = (at, colour = [247, 241, 227]) => ({ at, visible: true, fixed: true, pointer: "none", colour, clear: true, height: 76 });
const measure = { canvas: "rgb(247, 241, 227)", image: false, fades: [fade("top"), fade("bottom")], bodyLeft: 270, bodyRight: 1390, firstTop: 92, lastBottom: 3000, scrollY: 0, scrollMax: 2200, innerHeight: 1024, foot: 124, head: 60 };
const toned = { tone: "light", ink: [10, 10, 10] };
const shown = { frame, composerTop: 960, windowHeight: 1080 };
const page = [247, 241, 227], black = [10, 10, 10];

it("reads a colour the page paints, and nothing else", () => {
  expect(rgb("rgb(247, 241, 227)")).toEqual([247, 241, 227]);
  expect(rgb("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0]);
  expect(rgb(null)).toBeNull();
  expect(rgb("red")).toBeNull();
});

it("looks above the first line from the top and below the last line at the end, and always at the window's foot", () => {
  const top = bandPlan({ where: "top", ...shown, measure, headGap: 700 });
  expect(top.problems).toEqual([]);
  expect(top.points.map(point => point.name)).toEqual(["above the content", "the header's row", "the window's foot"]);
  // Above the content: inside the body's width, between the head room the header's buttons take and the first line.
  expect(top.points[0].x).toBe(260 + 270 + 8);
  expect(top.points[0].y).toBeGreaterThan(56 + 60);
  expect(top.points[0].y).toBeLessThan(56 + 92);
  // The header's row stands between its buttons, at the frame's top edge.
  expect(top.points[1]).toMatchObject({ x: 700, y: 62 });
  expect(top.points[2]).toMatchObject({ x: 264, y: 1076 });
  // A header with no room between its buttons is not sampled.
  expect(bandPlan({ where: "top", ...shown, measure }).points.map(point => point.name)).toEqual(["above the content", "the window's foot"]);

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

it("a band of the window's own colour above, below or beside the page is the failure, and the page's own colour everywhere is the pass", () => {
  const plan = bandPlan({ where: "top", ...shown, measure });
  expect(bandProblems(plan, measure, [page, page], page, toned)).toEqual([]);
  // A few levels of difference is no band; the black strip above a light page is.
  expect(bandProblems(plan, measure, [[245, 241, 227], page], page, toned)).toEqual([]);
  expect(bandProblems(plan, measure, [black, page], page, toned)[0]).toMatch(/above the content shows rgb\(10, 10, 10\) where the page paints rgb\(247, 241, 227\)/);
  expect(bandProblems(plan, measure, [page, black], page, toned)[0]).toMatch(/window's foot shows rgb\(10, 10, 10\)/);
  // A page that paints nothing of its own is judged against the area's own colour behind it: every place shows that one colour.
  const bare = { ...measure, canvas: null, fades: [fade("top", black), fade("bottom", black)] };
  expect(bandProblems(plan, bare, [black, black], black, { tone: "dark", ink: [245, 245, 245] })).toEqual([]);
  expect(bandProblems(plan, bare, [[255, 255, 255], black], black, { tone: "dark", ink: [245, 245, 245] })).toHaveLength(1);
  // A place that could not be read is a failure, never a pass.
  expect(bandProblems(plan, measure, [undefined, page], page, toned)[0]).toMatch(/nothing was read/);
});

it("what scrolls under the header and the composer fades out in the page's own colour, and the window's buttons take the page's tone (R-PAGE-17)", () => {
  const plan = bandPlan({ where: "top", ...shown, measure });
  // The page's tone is light above a luminance of 0.179: the ink is dark on it, light on a dark one.
  expect(toneOf(page)).toBe("light");
  expect(toneOf(black)).toBe("dark");
  expect(toneOf([20, 30, 40])).toBe("dark");
  // A fade in the app's own black over a light page, a fade that is missing, one that takes the pointer or does not end clear: each is the failure.
  expect(bandProblems(plan, { ...measure, fades: [fade("top", black), fade("bottom")] }, [page, page], page, toned)[0]).toMatch(/top fade is rgb\(10, 10, 10\), not the page's own rgb\(247, 241, 227\)/);
  expect(bandProblems(plan, { ...measure, fades: [fade("top")] }, [page, page], page, toned)[0]).toMatch(/1 fades, not 2/);
  expect(bandProblems(plan, { ...measure, fades: [{ ...fade("top"), pointer: "auto" }, fade("bottom")] }, [page, page], page, toned)[0]).toMatch(/top fade is fixed and takes no pointer/);
  expect(bandProblems(plan, { ...measure, fades: [{ ...fade("top"), clear: false }, fade("bottom")] }, [page, page], page, toned)[0]).toMatch(/top fade does not end clear/);
  // The window was told the wrong tone: light ink on a light page.
  expect(bandProblems(plan, measure, [page, page], page, { tone: "dark", ink: [245, 245, 245] })[0]).toMatch(/page's tone is light .* told dark/);
  // A page whose ground is a picture or a gradient has no fade and is mixed.
  const picture = { ...measure, canvas: null, image: true, fades: [{ ...fade("top"), visible: false }, { ...fade("bottom"), visible: false }] };
  expect(bandProblems(plan, picture, [page, page], page, { tone: "mixed", ink: [10, 10, 10] })).toEqual([]);
  expect(bandProblems(plan, { ...picture, fades: [fade("top"), fade("bottom")] }, [page, page], page, { tone: "mixed", ink: [10, 10, 10] })[0]).toMatch(/no one colour to fade into/);
  expect(bandProblems(plan, picture, [page, page], page, { tone: "light", ink: [10, 10, 10] })[0]).toMatch(/tone of a page with no one ground is mixed/);
});

it("the window's buttons are read at a corner of their cell: their ink must read on what is behind them, 3 to 1 at least", () => {
  const plan = bandPlan({ where: "top", ...shown, measure, caption: { x: 1800, y: 3 } });
  expect(plan.points.map(point => point.name)).toContain("the window's buttons");
  // Dark ink on a light page reads; the same ink on a dark page (the app's dark theme with a page that is dark too, or an ink the page's tone did not ask for) does not.
  expect(bandProblems(plan, measure, [page, page, page, page].slice(0, plan.points.length), page, toned)).toEqual([]);
  const wrong = bandProblems(plan, measure, plan.points.map(point => (point.caption ? black : page)), page, toned);
  expect(wrong.some(problem => /window's buttons: ink rgb\(10, 10, 10\) on rgb\(10, 10, 10\) reads 1 to 1, under 3/.test(problem))).toBe(true);
  expect(contrast([10, 10, 10], [247, 241, 227])).toBeGreaterThan(10);
  expect(contrast([245, 245, 245], [247, 241, 227])).toBeLessThan(1.2);
});
