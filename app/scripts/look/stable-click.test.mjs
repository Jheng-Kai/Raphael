// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { assertStableClick, stableSnapshot } from "./stable-click.mjs";
const control = { selector: '#switch', x: 20, y: 40, width: 100, height: 32 };
test("stable-click accepts subpixel settling and rejects a moved control or content inserted above it", () => {
  expect(assertStableClick([control], [{ ...control, y: 40.5 }]).check).toBe("stable-click");
  expect(() => assertStableClick([control], [{ ...control, y: 80 }])).toThrow("#switch moved");
  expect(() => assertStableClick([control], [])).toThrow("disappeared");
  const heading = { ...control, selector: 'h1', y: 10 };
  expect(() => assertStableClick([control, heading], [control, { ...heading, y: 12 }])).toThrow("h1 moved");
});


test("snapshot follows the visible control across redraws and rejects an empty run", () => {
  document.body.innerHTML = '<div hidden><button class="switch"></button></div><section class="page"><h1>Heading</h1><button class="switch">Store</button></section>';
  const button = document.querySelector('section button');
  const rect = (y) => ({ x: 20, y, width: 100, height: 32, top: y, bottom: y + 32 });
  button.getBoundingClientRect = () => rect(60);
  document.querySelector('h1').getBoundingClientRect = () => rect(10);
  const before = stableSnapshot('.switch');
  expect(before).toHaveLength(2);
  expect(assertStableClick(before, stableSnapshot('.switch', before.map(item => item.selector))).check).toBe('stable-click');
  button.getBoundingClientRect = () => rect(90);
  expect(() => assertStableClick(before, stableSnapshot('.switch', before.map(item => item.selector)))).toThrow('moved');
  expect(() => assertStableClick([], [])).toThrow('no visible control');
  document.body.innerHTML = '';
});
