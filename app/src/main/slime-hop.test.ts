import { expect, test } from "vitest";
import { cheerPlan, facingOf, hopPlan, hopsFor } from "./slime-hop";

const translate = (frame: Keyframe) => String(frame.transform).match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)!.slice(1).map(Number);

test.each([
  [30, 2, 14, 810], [100, 2, 17.5, 810], [330, 3, 38.5, 1198], [800, 4, 70, 1750], [1500, 6, 80, 2710],
])("a %i px move takes %i hops of %f px and lasts %i ms", (distance, hops, rise, duration) => {
  expect(hopsFor(distance)).toMatchObject({ hops, rise });
  const plan = hopPlan(-distance, 0);
  expect(plan.descents).toHaveLength(hops);
  expect(plan.duration).toBe(duration);
  expect(plan.arrival).toBe(duration);
});

test("never one hop for the whole way, and the farther the move the bigger each hop", () => {
  const sizes = [20, 60, 150, 330, 600, 900, 1400].map(distance => ({ distance, ...hopsFor(distance) }));
  for (const { hops } of sizes) expect(hops).toBeGreaterThanOrEqual(2);
  for (let index = 1; index < sizes.length; index++) {
    const [before, after] = [sizes[index - 1]!, sizes[index]!];
    expect(after.distance / after.hops).toBeGreaterThan(before.distance / before.hops);
    expect(after.rise).toBeGreaterThanOrEqual(before.rise);
  }
});

test("the ground goes along one straight line from start to end, an equal share in each hop", () => {
  const plan = hopPlan(300, -120);
  const points = plan.ground.map(translate);
  expect(points[0]).toEqual([300, -120]);
  expect(points[points.length - 1]).toEqual([0, 0]);
  // Every place the ground stops at is on the line from the start to the end, never to one side of it.
  for (const [x, y] of points) expect(x * -120 - y * 300).toBeCloseTo(0);
  const stops = [...new Set(points.map(point => point.join()))];
  expect(stops).toEqual(["300,-120", "200,-80", "100,-40", "0,0"]);
});

test("a hop never rises above the room the window leaves", () => {
  const plan = hopPlan(-900, 0, { maxRise: 30 });
  const tops = plan.body.map(frame => parseFloat(String(frame.transform).slice("translateY(".length)));
  expect(Math.min(...tops)).toBe(-30);
});

test("an interrupted hop starts from the pose on screen and skips the crouch", () => {
  const plan = hopPlan(-200, 0, { from: { y: -20, width: 0.97, height: 1.04, tilt: 2, opacity: 1, glowWidth: 0.7, glowOpacity: 0.4, falling: true } });
  expect(plan.body[0]!.transform).toBe("translateY(-20px) rotate(2deg) scale(0.97, 1.04)");
  expect(plan.body.some(frame => String(frame.transform).endsWith("scale(1.12, 0.88)"))).toBe(false);
});

test("the cheer adds two 12 px hops in place after the landing", () => {
  const plan = cheerPlan(hopPlan(-40, 0));
  expect(plan.arrival).toBe(810);
  expect(plan.duration).toBe(1110);
  expect(plan.body.slice(-4).map(frame => parseFloat(String(frame.transform).slice("translateY(".length)))).toEqual([-12, 0, -12, 0]);
});

test("a slime turns to its side only for a move wide enough", () => {
  expect([facingOf(200), facingOf(-200), facingOf(10)]).toEqual(["left", "right", undefined]);
});
