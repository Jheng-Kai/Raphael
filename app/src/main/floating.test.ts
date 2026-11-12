/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// R-FLOAT-01: everything that floats stands on one surface with one edge (owner, 2026-11-12, after Grok Bot's measured colours).
const read = (file: string): string => readFileSync(join(__dirname, file), "utf8").replace(/\r\n/g, "\n");
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const styles = strip(read("styles.css"));

const block = (css: string, opener: RegExp): string => {
  const match = opener.exec(css);
  expect(match, String(opener)).not.toBeNull();
  const start = css.indexOf("{", match!.index) + 1;
  return css.slice(start, css.indexOf("\n}", start));
};
const light = block(styles, /^:root\s*\{/m);
const dark = block(styles, /^:root\[data-theme="dark"\]\s*\{/m);
const token = (body: string, name: string): string | undefined => new RegExp(`--${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

/** The floating surfaces and the file and selector whose rule draws each one. */
const SURFACES: [file: string, selector: string, scope: string][] = [
  ["styles.css", ".menu", ".menu"],
  ["styles.css", ".modal", ".modal"],
  ["members.css", ".mb-dialog", ".mb-dialog"],
  ["connections.css", ".cs-dialog", ".cs-dialog"],
  ["automations.css", ".au-pop", ".au-pop"],
  ["composer-brain.css", ".cb-card", ".cb-card"],
  ["agent.css", ".link-hover", ".link-hover"],
  ["agent.css", ".message-tooltip", ".message-tooltip"],
  ["home.css", ".ho-tip", ".ho-tip"],
];

const ruleOf = (file: string, selector: string): string => {
  const css = strip(read(file));
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `${file}: ${selector}`).not.toBeNull();
  return match![1]!;
};

describe("everything that floats", () => {
  test("the tokens are Grok Bot's measured values in the dark theme and a white surface in the light one", () => {
    expect(token(dark, "float")).toBe("#1f1f1f");
    expect(token(dark, "float-edge")).toBe("#353535");
    expect(token(dark, "float-ctl")).toBe("#282828");
    expect(token(dark, "float-hover")).toBe("#292929");
    expect(token(dark, "float-sel")).toBe("#f5f5f5");
    expect(token(dark, "float-on-sel")).toBe("#0a0a0a");
    expect(token(light, "float")).toBe("#ffffff");
    expect(token(light, "float-edge")).toBe("#e5e5e5");
    expect(token(light, "float-sel")).toBe("#0a0a0a");
    expect(token(light, "float-on-sel")).toBe("#ffffff");
    // The old menu surface is the floating one, so a menu nobody remembered follows the rule.
    expect(token(light, "menu")).toBe("var(--float)");
    expect(token(dark, "menu")).toBe("var(--float)");
    // Both themes say every token of the rule.
    for (const name of ["float", "float-edge", "float-ctl", "float-ctl-hover", "float-hover", "float-pressed", "float-sel", "float-on-sel"]) {
      expect(token(light, name), `light --${name}`).toBeTruthy();
      expect(token(dark, name), `dark --${name}`).toBeTruthy();
    }
  });

  test("every floating surface stands on the floating tokens and says it in one scope", () => {
    const scope = /:where\(([^)]*)\)\s*\{([^}]*)\}/.exec(styles);
    expect(scope, "the shared scope of the floating surfaces").not.toBeNull();
    const listed = scope![1]!.split(",").map((part) => part.trim());
    const body = scope![2]!;
    // Inside a floating surface the ordinary tokens point at the floating ones.
    for (const pair of ["--btn: var(--float-ctl)", "--hover: var(--float-hover)", "--edge: var(--float-edge)", "--line: var(--float-edge)", "--panel: var(--float-ctl)"]) expect(body).toContain(pair);
    for (const [file, selector, name] of SURFACES) {
      expect(listed, `${selector} is in the scope`).toContain(name);
      const rule = ruleOf(file, selector);
      expect(rule, `${file}: ${selector} background`).toMatch(/background:\s*var\(--float\)/);
      expect(rule, `${file}: ${selector} must not draw its own surface`).not.toMatch(/background:\s*var\(--(?:panel|content|menu|side|surface-2)\)/);
      // A tooltip may go without an edge (the home chart's has a shadow) but never with another colour of it.
      expect(rule, `${file}: ${selector} edge`).not.toMatch(/border(?:-color)?:[^;]*var\(--(?:edge|line|btn-edge|edge-rim)\)/);
    }
  });

  test("the chosen chip, a button on a floating surface and the white tile of a mark use the rule's tokens", () => {
    const css = strip(read("connections.css"));
    expect(css).toMatch(/\.cs-chip\[aria-pressed="true"\][^{]*\{[^}]*color:\s*var\(--float-on-sel\)[^}]*background:\s*var\(--float-sel\)/);
    expect(css).toMatch(/\.cs-tile\s*\{[^}]*background:\s*var\(--tile\)/);
    // A button's hover and press come from the surface it stands on.
    expect(styles).toMatch(/\.btn:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--btn-hover, var\(--hover\)\)/);
  });
});
