// Conversation geometry stays responsive while type and rows use the shared scale.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const read = (name: string): string => readFileSync(join(__dirname, name), "utf8");
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const agent = strip(read("agent.css"));
const members = strip(read("members.css"));
const both = agent + "\n" + members + "\n" + strip(read("conversations.css"));

/** The block that sets the tokens: its selectors and its declarations. */
const block = /(\.page-agent, \.side, \.mb-scrim[^{]*)\{([^{}]*)\}/.exec(agent);

/** `--pa-name: calc(A px + B * var(--pa-u))` as [A, A + B]: the size in a small window and in a maximised one. */
function ends(name: string): [number, number] {
  const m = new RegExp(`--${name}: calc\\(([\\d.]+)px \\+ ([\\d.]+) \\* var\\(--pa-u\\)\\);`).exec(block![2]);
  if (!m) throw new Error(`--${name} is not a fluid token`);
  return [Number(m[1]), Number(m[1]) + Number(m[2])];
}

describe("the page's responsive sizes", () => {
  test("the tokens are on the page and what it opens at the body, never on :root", () => {
    expect(block).not.toBeNull();
    const selectors = block![1].split(",").map((s) => s.trim());
    expect(selectors).toEqual([".page-agent", ".side", ".mb-scrim", ".menu.mb-avpop", ".menu.mb-menu", ".menu.mb-toolpop", ".menu.side-search", ".toasts"]);
    expect(/(^|[\s,])(:root|html|body|\*)([\s,{]|$)/.test(block![1])).toBe(false);
  });

  test("the sizes grow from 0 at 960 px wide to the full step at 1920 px, and no further", () => {
    expect(block![2]).toContain("--pa-t: clamp(0px, calc(100vw - 960px), 960px);");
    expect(block![2]).toContain("--pa-u: calc(var(--pa-t) / 960);");
  });

  test("the global sidebar is fixed and the details retain responsive width", () => {
    expect(read("styles.css")).toContain("--sidebar-width: min(348px, calc(100vw - 604px));");
    expect(block![2]).toContain("--pa-det: clamp(300px, 24vw, 460px);");
    expect(members).toContain(".page.page-agent { position: relative; max-width: none; height: 100%; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr);");
    expect(members).toContain('.page.page-agent[data-det="open"]:not(.is-room) { grid-template-columns: minmax(0, 1fr) var(--pa-det); }');
  });

  test("the columns and controls retain their responsive geometry", () => {
    const wanted: Record<string, [number, number]> = {
      "pa-tool": [30, 48], "pa-pill-av": [22, 36],
      "pa-cmp-fs": [15.5, 17],
      "pa-det-av": [64, 96],
    };
    for (const [name, [small, big]] of Object.entries(wanted)) expect(ends(name), name).toEqual([small, big]);
  });

  test("the conversation's thread measure stops growing with the window", () => {
    expect(block![2]).toContain("--pa-colw: var(--layout-thread-max);");
    // The 960 px message column.
    expect(read("styles.css")).toContain("--layout-thread-max: calc(30 * var(--sp-6));");
    expect(agent).toMatch(/\.ra-col \{ max-width: var\(--pa-colw\)/);
    expect(agent).toMatch(/\.composer \{[^}]*max-width: var\(--layout-thread-max\)/);
  });

  test("every token a rule reads is set, and every token set is read", () => {
    const set = new Set([...block![2].matchAll(/--(pa-[\w-]+):/g)].map((m) => m[1]));
    const used = new Set([...both.matchAll(/var\(--(pa-[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !set.has(name))).toEqual([]);
    // --pa-t is read by --pa-u alone
    expect([...set].filter((name) => !used.has(name) && name !== "pa-t")).toEqual([]);
  });

  test("a face follows the sizes by --av, set again with !important over the markup's own, and nothing else is !important", () => {
    const important = [...both.matchAll(/([^;{}]+!important)/g)].map((m) => m[1].trim());
    const strays = important.filter((d) => !/^--av: var\(--pa-[\w-]+\) !important$/.test(d) && !/^animation: none !important$/.test(d) && !/^transition: none !important$/.test(d));
    expect(strays).toEqual([]);
    for (const selector of [".nav.mb-row > .av", ".conversation-trigger .mb-pill .av", ".page-agent .btn.mb-avbtn .av", ".ra-face .av", ".ask-face .av"]) {
      expect(both, selector).toContain(`${selector} { --av: var(--pa-`);
    }
  });

  test("the panel overlays compact chat and the sidebar becomes an 88 px rail of faces under 860 px", () => {
    expect(members).toMatch(/@media \(max-width: 1119px\) \{[^@]*\.mb-det \{ position: absolute;[^}]*width: var\(--pa-det\)/);
    expect(read("sidebar.css")).toContain("@media (max-width: 859px) { :root { --sidebar-width: 88px; } }");
    expect(read("sidebar.css")).not.toContain("translateX(-100%)");
  });

  test("icons stay at 16 or 20 px: they step at 1280 px wide instead of following the fluid sizes", () => {
    // (ui-rules.test.ts holds every icon rule to 16 or 20 px; these are the steps that rule leaves)
    expect(agent).toMatch(/@media \(min-width: 1280px\) \{[^@]*\.ra-tool \.i \{ width: 20px; height: 20px; \}/);
    expect(members).toMatch(/@media \(min-width: 1280px\) \{[^@]*\.mb-tool \.i[^{]*\{ width: 20px; height: 20px; \}/);
  });

  test("the wide-window block is gone: the fluid sizes cover it", () => {
    expect(agent).not.toMatch(/@media \(min-width: 1440px\)/);
  });

  test("Raphael's thread keeps its bare style: no frame, background, border or shadow on his lines or his face", () => {
    for (const selector of [".ra", ".ra-face", ".ra-body", ".ans"]) {
      const rule = new RegExp(`(^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(agent);
      expect(rule, selector).not.toBeNull();
      expect(rule![2], selector).not.toMatch(/(^|[\s;])(background|border|box-shadow|outline|filter)[\w-]*\s*:/);
    }
  });
});

test("the composer is one 44 px pill at every window size, on one grid that ends at the row's bottom, 16 px above the window (owner, 2026-11-12: Grok Bot's one-row composer)", () => {
  const css = strip(read("agent.css"));
  expect(block![2]).toContain("--pa-cmp-h: 44px;");
  expect(block![2]).toContain("--pa-cmp-ctl: 32px;");
  expect(block![2]).toContain("--pa-dock-bottom: var(--sp-4);");
  // Fixed numbers, not fluid ones: no size of the composer follows the window.
  expect(block![2]).not.toMatch(/--pa-cmp-(btn|r|p|py):/);
  // The corners are half the one row's height, and stay that when the draft grows.
  expect(css).toMatch(/\.composer \{[^}]*border-radius: calc\(var\(--pa-cmp-h\) \/ 2\)/);
  // One grid for the +, the words and the other controls, whose items end at its bottom: never one layout for one row and another for two.
  expect(css).toMatch(/\.cmp-row \{[^}]*grid-template-columns: auto minmax\(200px, 1fr\) auto; align-items: end;/);
  expect(css).not.toMatch(/\.cmp-row \{[^}]*(flex-wrap|display: flex)/);
  // A narrow composer changes its own row by a query of its own, never by a second row.
  expect(css).toMatch(/\.composer \{[^}]*container: cmp \/ inline-size/);
  expect(css).toMatch(/@container cmp \(max-width: 452px\) \{[^@]*\.cb-depth \{ display: none; \}/);
  expect(css).toMatch(/@container cmp \(max-width: 372px\) \{[^@]*\.cmp-row \{ grid-template-columns: auto minmax\(120px, 1fr\) auto; \}/);
  // The words' line is the controls' height, so a one-line draft is the controls' row and the last line of a longer one is level with them.
  expect(css).toMatch(/\.cmp-input \{[^}]*min-height: var\(--pa-cmp-ctl\)[^}]*padding: var\(--cmp-py\) 4px/);
  // Nothing but the dock's own padding stands under it, at every window height.
  expect(css).not.toMatch(/\.ra-dock \{[^}]*padding-bottom/);
});

test("the composer field sizes itself to its text, so a keystroke never lays out the thread from script", () => {
  expect(read("agent.css")).toMatch(/\.cmp-input \{[^}]*max-height: min\([^}]*6lh[^}]*field-sizing: content;/);
  for (const source of [read("pages/agent.ts"), read("chat-composer.ts")]) {
    expect(source).not.toMatch(/input\.style\.height|input\.scrollHeight/);
  }
});

test("a member's conversation wears its colour on selected words in the owner's bubble, send, stop and its computer", () => {
  const css = read("agent.css");
  expect(css).toContain(".mb-chat[data-member-bubble] .owner-message :is(.bubble, .bubble *)::selection { background: var(--on-bubble); color: var(--member-bubble); }");
  expect(css).toContain('.mb-chat[data-member-bubble] .composer .cmp-pair { --accent-icon: var(--member-accent); --accent-text: var(--member-accent); }');
  expect(read("pages/agent.ts")).toContain('memberChat.style.setProperty("--member-accent", memberAccent(color));');
});
