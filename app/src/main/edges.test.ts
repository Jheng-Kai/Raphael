/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// R-UI-162: what stands apart from the page on its own wears a hairline a shade above its fill; a fill inside another surface wears none.
const read = (file: string): string => readFileSync(join(__dirname, file), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const styles = read("styles.css");
const block = (opener: RegExp): string => {
  const match = opener.exec(styles);
  expect(match, String(opener)).not.toBeNull();
  const start = styles.indexOf("{", match!.index) + 1;
  return styles.slice(start, styles.indexOf("\n}", start));
};
const light = block(/^:root\s*\{/m);
const dark = block(/^:root\[data-theme="dark"\]\s*\{/m);
const token = (body: string, name: string): string | undefined => new RegExp(`--${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim();
/** Every declaration the stylesheet gives `selector` in rules of its own, in order. */
const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(match => match[1]!);
  expect(bodies.length, selector).toBeGreaterThan(0);
  return bodies.join(";");
};

test("in both themes a pill's or a round button's rim is a shade off its fill, never the fill itself", () => {
  for (const body of [light, dark]) expect(token(body, "edge-rim")).not.toBe(token(body, "surface-2"));
  expect(token(dark, "edge-rim")).toBe(token(dark, "float-edge"));
  for (const body of [light, dark]) expect(token(body, "ans-edge")).not.toBe(token(body, "panel"));
});

test("the Connections pill wears the rim in the list and none on the rail, and the composer's plus wears none", () => {
  const sidebar = read("sidebar.css");
  expect(rule(sidebar, ".side .side-foot .sidebar-apps")).toContain("box-shadow: inset 0 0 0 1px var(--edge-rim)");
  expect(rule(sidebar, ":root[data-sidebar-collapsed] .side .side-foot .sidebar-apps")).toContain("box-shadow: none");
  expect(rule(styles, ".page-agent .cmp-bar .btn.cmp-attach")).toContain("box-shadow: none");
});
