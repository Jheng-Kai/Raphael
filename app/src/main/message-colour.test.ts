/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/** The text of a message bubble is the normal text colour whatever its kind or its turn's state (the timed
 *  progress messages and the replies of a failed turn drew a step paler than an ordinary message, in the dark theme). A message
 *  is `.ans`; no rule may colour it or the text inside it with anything but `var(--text)`, or fade it. */
const MESSAGE = /(?:^|[\s>+~])(?:\.ans|\.message-text|\.chat-message)(?:\.[\w-]+|\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/;

function paleMessageRules(css: string): string[] {
  const found: string[] = [];
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const own = selectors.split(",").map(selector => selector.trim()).filter(selector => MESSAGE.test(selector));
    if (!own.length) continue;
    const colour = /(?:^|;|\s)(?:color|opacity|-webkit-text-fill-color)\s*:\s*([^;]+)/g;
    for (const [, value] of body.matchAll(colour)) {
      if (!/^(?:var\(--text\)|inherit|1)\s*(?:!important)?$/.test(value.trim())) found.push(`${own.join(", ")} { ${value.trim()} }`);
    }
  }
  return found;
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? cssFiles(full) : full.endsWith(".css") ? [full] : [];
  });
}

test("the rules that made progress messages and failed replies paler are found", () => {
  expect(paleMessageRules(".ans.progress { color: var(--text-2); }")).toHaveLength(1);
  expect(paleMessageRules('.tn[data-status="error"] .ans, .tn[data-status="denied"] .ans { color: var(--text-2); }')).toHaveLength(1);
  expect(paleMessageRules(".page-agent .chat-message > .ans { opacity: .6 }")).toHaveLength(1);
  expect(paleMessageRules(".ans { color: var(--text); }")).toEqual([]);
  expect(paleMessageRules(".message-text blockquote { color: var(--text-2); } .ans h1 { color: var(--text-2); }")).toEqual([]);
});

test("no style makes the text of a message paler than an ordinary message (R-MSG-COLOUR-01)", () => {
  const pale = cssFiles(path.resolve("src")).flatMap(file => paleMessageRules(readFileSync(file, "utf8")).map(rule => `${path.relative("src", file)}: ${rule}`));
  expect(pale).toEqual([]);
});
