// The rules of docs/ui.md that a machine can check. They read the sources, so a new violation fails
// here before anyone has to see it. The allowlists are frozen: they may shrink, never grow.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { en } from "./main/i18n/en";
import { ja } from "./main/i18n/ja";
import { zhTW } from "./main/i18n/zh-TW";
import { actionRow, btn } from "./main/ui";

const SRC = __dirname;
const MAIN = join(SRC, "main");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (name === "service-logos" ? [] : walk(path)) : [path];
  });
const rel = (path: string): string => relative(MAIN, path).split(sep).join("/");
const read = (path: string): string => readFileSync(path, "utf8");

const mainFiles = walk(MAIN);
/** Application code of the main window: every .ts that is not a test. */
const sources = mainFiles.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes(`${sep}i18n${sep}`));

test("copy controls use the shared in-place feedback", () => {
  for (const file of sources.filter(file => rel(file) !== 'ui.ts')) {
    expect(read(file), rel(file)).not.toMatch(/\bcopyText\s*\(/);
  }
});
const i18nFiles = mainFiles.filter((f) => f.includes(`${sep}i18n${sep}`) && !f.endsWith(".test.ts"));

test("every button and every menu row takes its height from the shared controls, never a number of its own (owner, 2026-11-08)", () => {
  // Rows and tiles built from a button (a list row, a card, a day of the calendar, an emoji) and the round edge controls
  // keep their own sizes. Frozen: it may shrink, never grow.
  const TILES = /\.(?:conversation-latest|peer-latest|peer-close|draft-av-btn|attachment-file|reaction|au-day-num|cal-more|gr|cs-open|cs-main|conversation-trigger|ho-event|ho-stat|lib-row|ms-open|tpr-row|mb-fold-head|mb-panel-row|mb-chat-choice|mb-rt|question-choices|mc-source|ghost|owner-photo|pv-create|mb-tool|mb-more|mb-avbtn|sidebar-toggle|cmp-pair|cmp-attach|ra-tool|au-members|au-month-grid|ob-foot|room-row)\b|::(?:before|after)/;
  // (`.ob-foot`: the guide keeps its own wide pills, the owner's one exception, 2026-11-08.)
  const bad: string[] = [];
  for (const file of mainFiles.filter((f) => f.endsWith(".css"))) {
    for (const [, selector, body] of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // The rule must style the button itself (its last compound), not an icon inside it.
      const last = (part: string): string => { const compounds = part.trim().split(/[\s>+~]+/); return compounds[compounds.length - 1] ?? ""; };
      const targets = selector!.split(",").filter((part) => /\.btn\b|^button\b|menu-choice|menu-action/.test(last(part)) && /\.btn\b|\.menu\b|menu-choice|menu-action/.test(part) && !TILES.test(part) && !/\.icon\b/.test(part));
      if (!targets.length) continue;
      for (const [, prop, value] of body!.matchAll(/(?:^|;)\s*(min-height|height)\s*:\s*([^;]+)/g)) {
        if (!/^(?:auto|0|100%|var\(--h-[\w-]+\))$/.test(value!.trim())) bad.push(`${rel(file)}: ${targets.join(",").trim()} { ${prop}: ${value!.trim()} }`);
      }
      // Nor does a padding above and below make it taller than its words: at most 3 px (a menu row's 4 px is its 28 px).
      const menu = targets.every((part) => /\.menu\b/.test(part));
      for (const [, prop, value] of body!.matchAll(/(?:^|;)\s*(padding(?:-block|-top|-bottom)?)\s*:\s*([^;]+)/g)) {
        const vertical = value!.trim().split(/\s+(?![^(]*\))/)[0]!;
        if (!(menu ? /^(?:0|0px|[1-4]px|var\(--sp-1\))$/ : /^(?:0|0px|[1-3]px)$/).test(vertical)) bad.push(`${rel(file)}: ${targets.join(",").trim()} { ${prop}: ${value!.trim()} }`);
      }
    }
  }
  expect(bad).toEqual([]);
});

test("no picture can be dragged out of the window (owner, 2026-11-09: 「這個圖片放進去不要可以拖拉出來」)", () => {
  const css = (file: string): string => read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const base = [...css(join(MAIN, "styles.css")).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => selector!.trim() === "img");
  expect(base.map(([, , body]) => body!.trim())).toEqual(["-webkit-user-drag: none;"]);
  // No stylesheet hands a picture back to the pointer.
  const loose = mainFiles.filter((f) => f.endsWith(".css") && /-webkit-user-drag\s*:\s*(?:auto|element)/.test(css(f))).map(rel);
  expect(loose).toEqual([]);
});

test("closing is a ×, never a 「關閉」 text button (owner, 2026-11-08: 「上面明明就有叉叉了，為什麼下面還要有關閉」)", () => {
  for (const file of sources) {
    const text = read(file);
    // A text button or a dialog action labelled with the close words.
    expect(text, rel(file)).not.toMatch(/\bbtn\(\s*(?:esc\()?\s*t\(\s*"(?:common|providers)\.close"\s*\)/);
    expect(text, rel(file)).not.toMatch(/label:\s*(?:esc\()?\s*t\(\s*"(?:common|providers)\.close"\s*\)/);
  }
});

describe("action rows", () => {
  test("primary is last, Cancel immediately precedes it, and destruction is first", () => {
    const html = actionRow({
      primary: { label: "Save", attrs: ' data-action="save" disabled' },
      secondary: btn("Cancel", "", ' data-action="cancel"'),
      destructive: { label: "Delete", attrs: ' data-action="delete"' },
    });
    expect([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1])).toEqual(["delete", "cancel", "save"]);
    expect(html).toMatch(/class="action-destructive"><button[^>]*class="btn danger"/);
    expect(html).toMatch(/class="btn pri" data-action="save" disabled>Save<\/button><\/div>$/);
  });

  test("a delete confirmation separates danger on the left from Cancel on the right", () => {
    const html = actionRow({ secondary: btn("Cancel"), destructive: { label: "Delete" } });
    expect(html).toMatch(/Delete<\/button><\/span><button[^>]*>Cancel<\/button><\/div>$/);
    expect(html).not.toContain("btn pri");
  });

  test("shared alignment, destructive separation and sticky footers use the app's tokens", () => {
    const css = read(join(MAIN, "styles.css"));
    expect(css).toMatch(/\.action-row\s*\{[^}]*justify-content:\s*flex-end/);
    expect(css).toMatch(/\.action-destructive\s*\{[^}]*margin-inline-end:\s*auto/);
    expect(css).toMatch(/\.action-row\.is-sticky\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0[^}]*background:\s*var\(--panel\)/);
  });

  test("form footers use the shared row instead of hand-written button containers", () => {
    // Provider/model-picker work is owned by another branch; gold approval cards keep their product order.
    const rows = /<(?:div|span) class="(?:mb-dlg-act|mb-ract|av-crop-act|cs-acts|cs-device-acts|add-acts|svc-acts|mem-edit-actions|addword-actions|rules-acts)"/;
    expect(sources.filter((f) => !["providers.ts", "model-picker.ts"].includes(rel(f)) && rows.test(read(f))).map(rel)).toEqual([]);
    for (const file of ["member-dialogs.ts", "avatar-settings.ts", "connections.ts", "services.ts", "messaging.ts", "memory-view.ts", "pages/dictionary.ts", "setup-rows.ts", "onboarding/mount.ts", "safety-rules.ts", "local-models.ts"]) {
      expect(read(join(MAIN, file)), file).toContain("actionRow(");
    }
  });
});

describe("buttons", () => {
  // Every <button> is one of the shapes of the component inventory (docs/ui.md), or a part of a menu / list / dialog.
  const ALLOWED_CLASS = [
    "btn", "sel", "tg", "tab", "nav", "usage-box", "menu-choice", "menu-action", "lang-item", "lm-main", "mp-star", "mp-opt", "mp-dd", "chip-x", "sess", "mb-preset", "mb-slime-color", "message-quote",
  ];
  const ALLOWED_ROLE = ["option", "menuitem", "menuitemradio", "radio", "checkbox", "switch", "tab"];
  const classOf = (tag: string): string[] => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);
  const roleOf = (tag: string): string => /\brole="([^"]*)"/.exec(tag)?.[1] ?? "";

  test("every <button> in the code and the translations carries an allowed class or role", () => {
    const bad: string[] = [];
    for (const file of [...sources, ...i18nFiles]) {
      for (const [raw] of read(file).matchAll(/<button\b[^>]*>/g)) {
        // translations escape their quotes; templates hold ${...}
        const tag = raw.replace(/\\"/g, '"').replace(/\$\{[^}]*\}/g, "");
        const ok = classOf(tag).some((c) => ALLOWED_CLASS.includes(c)) || ALLOWED_ROLE.includes(roleOf(tag));
        if (!ok) bad.push(`${rel(file)}: ${tag}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("no clickable text: the old icon-btn class and the link look are gone", () => {
    const all = [...sources, ...i18nFiles, ...mainFiles.filter((f) => f.endsWith(".css"))].map(read).join("\n");
    expect(all).not.toMatch(/icon-btn|class="link"|class="quiet"/);
  });

  // Text buttons keep their surfaces; icon controls communicate through color and focus.
  test("icon-only controls have no hover/active surface and keep keyboard focus", () => {
    const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
    const styles = strip(read(join(MAIN, "styles.css")));
    expect(styles).toMatch(/\.btn\.icon\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.btn\.icon:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
    const classes = new Set(["icon", "cmp-attach", "cmp-send", "cmp-voice", "mp-star", "chip-x", "window-button", "window-close"]);
    const composer = strip(read(join(MAIN, "agent.css")));
    expect(composer).toMatch(/\.composer \.cmp-pair \.btn\.cmp-send[^{}]*\{[^}]*background: transparent; color: var\(--accent-icon\)/);
    // Read the optional class argument of every iconButton/iconBtn call, balancing nested calls.
    for (const file of sources) {
      const source = read(file);
      for (const call of source.matchAll(/\bicon(?:Button|Btn)\(/g)) {
        let depth = 1, quote = "", arg = "";
        const args: string[] = [];
        for (let i = call.index! + call[0].length; i < source.length && depth; i++) {
          const c = source[i]!;
          if (quote) { arg += c; if (c === "\\") { arg += source[++i]; } else if (c === quote) quote = ""; continue; }
          if (c === '"' || c === "'" || c === "`") { quote = c; arg += c; }
          else if (c === "(") { depth++; arg += c; }
          else if (c === ")") { if (--depth) arg += c; else args.push(arg); }
          else if (c === "," && depth === 1) { args.push(arg); arg = ""; }
          else arg += c;
        }
        for (const match of (args[3] ?? "").matchAll(/["'`]([a-z][\w -]*)["'`]/g))
          match[1]!.split(/\s+/).forEach(cls => classes.add(cls));
      }
    }
    for (const modifier of ["pri", "sm", "row", "danger", "btn"]) classes.delete(modifier);
    // Owner-approved caption hover exception (2026-10-25); ordinary icon controls stay frameless.
    const allowlist: readonly string[] = [
      // Daily sidebar controls share the owner's requested round soft press surface.
      'sidebar.css: .side .side-foot .btn.icon[aria-current="page"]:active:not(:disabled)',
      "sidebar.css: .side .btn.icon:hover:not(:disabled)", "sidebar.css: .side .btn.icon:active:not(:disabled)",
      // Search and plus, and the buttons on the window's edges, are Grok Bot's soft round buttons (owner, 2026-11-06).
      "sidebar.css: .side .btn.icon.mb-tool[data-col]:hover:not(:disabled)", "sidebar.css: .side .btn.icon.mb-tool[data-col]:active:not(:disabled)",
      ...[':is(:hover, [aria-expanded="true"]):not(:disabled)', ":active:not(:disabled)"].flatMap(state => [
        `styles.css: :is(.page-agent .mb-det-head, .page-agent .mb-head .ra-tools, .page-agent .mb-head .mb-head-l, .mb-dlg-head, .cs-dlg-head, .lb-head, .room-side-thread > header, .desktop-panel[data-expanded] .desktop-dock, .rp-top) .btn.icon${state}`,
        `styles.css: .page-agent .cmp-bar .btn.cmp-attach${state}`,
      ]),
      "styles.css: .btn.icon.modal-x:hover:not(:disabled)", "styles.css: .btn.icon.modal-x:active:not(:disabled)",
      // The larger view's fold back and Back live in the window strip and fill as its own buttons do (R-COMP-PERF-07).
      'desktop-viewer.css: .window-chrome > .btn.icon:is([data-desktop="collapse"], [data-desktop="back"]):is(:hover, :active):not(:disabled)',
      'desktop-viewer.css: .window-chrome > .btn.icon:is([data-desktop="collapse"], [data-desktop="back"]):active:not(:disabled)',
      "styles.css: .window-button:hover", "styles.css: .window-button:active",
      "styles.css: .window-close:hover", "styles.css: .window-close:active",
      // The guide's round arrow keeps the grey surface its 上一步 pill had, lighter under the pointer (owner, 2026-11-11).
      "styles.css: .ob-foot .ob-back:is(:hover, :active):not(:disabled)",
      // R-UI-50: the contextual latest action floats over messages and needs an opaque surface.
      "agent.css: .page-agent .btn.conversation-latest:hover:not(:disabled)",
      "conversations.css: .peer-chat > .btn.peer-latest:hover:not(:disabled)",
    ];
    const violations = (css: string): string[] => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) => {
      const surfaces = [...body!.matchAll(/(?:^|;)\s*background(?:-color|-image)?\s*:\s*([^;]+)/g)]
        .filter(([, value]) => !/^(?:transparent|none)\s*(?:!important)?$/.test(value!.trim()));
      if (!surfaces.length) return [];
      return selectors!.split(/,(?![^()]*\))/).filter(selector => /:(?:hover|active)\b/.test(selector) &&
        [...selector.matchAll(/\.([\w-]+)/g)].some(([, cls]) => classes.has(cls!))).map(selector => selector.trim());
    });
    // Guard the guard: both the shared class and a helper's custom class must be caught.
    expect(violations(".btn.icon:hover { background: var(--hover); }")).toEqual([".btn.icon:hover"]);
    expect(violations(".cmp-voice:active { background-color: var(--pressed); }")).toEqual([".cmp-voice:active"]);
    const bad = mainFiles.filter(file => file.endsWith(".css")).flatMap(file =>
      violations(read(file)).map(selector => `${rel(file)}: ${selector}`).filter(rule => !allowlist.includes(rule)));
    expect(bad).toEqual([]);
  });

  test("the icon-only buttons are made by iconButton / iconBtn, which say what they do in their label and tooltip", () => {
    const ui = read(join(MAIN, "ui.ts"));
    expect(ui).toMatch(/export const iconButton = [\s\S]*?class="btn icon\$\{[\s\S]*?aria-label="\$\{esc\(label\)\}" title="\$\{esc\(label\)\}"/);
    // nothing else writes the class by hand
    const byHand = sources.filter((f) => rel(f) !== "ui.ts" && /class="btn icon/.test(read(f))).map(rel);
    expect(byHand).toEqual([]);
  });
});

describe("type weight", () => {
  const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const sheets = (): [string, string][] => mainFiles.filter((f) => f.endsWith(".css")).map((f) => [rel(f), stripComments(read(f))]);

  // Grok Bot keeps one quiet weight: emphasis is size and colour (white or grey), never heavier type (owner, 2026-11-07).
  test("weights come from the tokens, and nothing is heavier than medium", () => {
    const bad: string[] = [];
    for (const [file, css] of sheets()) {
      for (const m of css.matchAll(/font-weight:\s*([^;}\s]+)/g)) if (!/^(var\(--weight-(regular|medium|semibold)\)|400|500|inherit|100)$/.test(m[1])) bad.push(`${file}: ${m[0]}`);
      for (const m of css.matchAll(/\bfont:\s*(\d{3}|bold)\b/g)) if (!/^(400|500)$/.test(m[1])) bad.push(`${file}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
    expect(read(join(MAIN, "styles.css"))).toMatch(/--weight-semibold:\s*500;/);
  });

  test("a chosen, current or pressed item changes its background or colour, never its weight", () => {
    const bad: string[] = [];
    for (const [file, css] of sheets()) {
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (/aria-(current|selected|pressed|checked)|\.is-(today|live|active|wait)\b/.test(m[1]) && /font-weight/.test(m[2])) bad.push(`${file}: ${m[1].trim().slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("colours", () => {
  const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

  test("no #hex / rgb() in the style sheets outside the token blocks of styles.css", () => {
    const bad: string[] = [];
    for (const file of mainFiles.filter((f) => f.endsWith(".css"))) {
      let css = stripComments(read(file));
      // the token blocks: custom properties only
      if (rel(file) === "styles.css") css = css.replace(/(?::root(?:\[data-(?:theme|skin)="[a-z]+"\]){0,2}(?:,\s*\.skin-sample\[data-preview="[a-z]+"\]\[data-mode="(?:light|dark)"\])?|\.skin-sample\[data-preview="[a-z]+"\]\[data-mode="(?:light|dark)"\])\s*\{[^}]*\}/g, "");
      css.split("\n").forEach((line, i) => COLOUR.test(line) && bad.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 80)}`));
    }
    expect(bad).toEqual([]);
  });

  test("the token block holds colours only as custom properties, brand colours as --brand-*", () => {
    const css = stripComments(read(join(MAIN, "styles.css")));
    const blocks = [...css.matchAll(/:root(?:\[data-theme="dark"\])?\s*\{([^}]*)\}/g)].map((m) => m[1]);
    for (const body of blocks) {
      for (const decl of body.split(";").map((d) => d.trim()).filter(Boolean)) {
        if (COLOUR.test(decl)) expect(decl).toMatch(/^--[a-z0-9-]+:/);
      }
    }
    const brand = [...css.matchAll(/(--brand-[a-z0-9-]+):\s*#/g)].map((m) => m[1]);
    expect(brand).toContain("--brand-telegram");
  });

  test("no colour literals in the main window's code, apart from the service logos and the mascots' art", () => {
    const logoFiles = ["service-icons.ts", "brand.ts", "slime.ts"];
    const bad = sources
      .filter((f) => !logoFiles.includes(rel(f)))
      .filter((f) => /#[0-9a-fA-F]{6}\b|\brgba?\(/.test(read(f)))
      .map(rel);
    expect(bad).toEqual([]);
  });
});

describe("tabs", () => {
  // The member Library sorts its deliverables by kind with the same filter (owner, 2026-11-08: sorted, never 「顯示更多」).
  test("the segmented filter is used by History, Dictionary and the member Library only", () => {
    const users = sources.filter((f) => /kind: "filter"|\btabs seg\b/.test(read(f))).map(rel).sort();
    expect(users).toEqual(["member-panel-work.ts", "pages/dictionary.ts", "pages/history.ts", "ui.ts"]);
  });

  test("there is one tab implementation: the old class names are gone", () => {
    const all = [...sources, ...i18nFiles, ...mainFiles.filter((f) => f.endsWith(".css"))].map(read).join("\n");
    expect(all).not.toMatch(/cs-seg|class="mp-tabs?"|\.mp-tab\b|btn seg/);
  });
});

describe("translations", () => {
  test("onboarding.* keys are used by the guide alone", () => {
    const bad = sources.filter((f) => !rel(f).startsWith("onboarding/") && /["'`]onboarding\./.test(read(f))).map(rel);
    expect(bad).toEqual([]);
  });

  test("no new numbered keys outside the ones that exist", () => {
    // The numbered keys (page.001) are frozen at 220 (lower it when some are renamed): new strings get names (page.meaning).
    const numbered = (cat: Record<string, string>): number => Object.keys(cat).filter((k) => /\.\d{3}$/.test(k)).length;
    expect(numbered(zhTW)).toBeLessThanOrEqual(220);
  });

  // The strings that still carry markup. Structure belongs in code; this list only shrinks (docs/ui.md, backlog).
  const MARKUP_ALLOWLIST = new Set([
    "languages.007", "languages.008", "main.004", "main.005", "common.or",
    "dictionary.004", "dictionary.005", "dictionary.008", "dictionary.009", "dictionary.018", "dictionary.019",
    "history.005", "history.006", "history.010", "history.011", "history.013",
    "home.017", "home.025", "home.026", "settings.082", "settings.084", "history.dayEmpty",
  ]);

  test.each([
    ["zh-TW", zhTW],
    ["en", en],
    ["ja", ja],
  ] as const)("%s: only the frozen list of strings contains '<'", (_name, catalog) => {
    const offenders = Object.entries(catalog as Record<string, string>)
      .filter(([, value]) => value.includes("<"))
      .map(([key]) => key)
      .filter((key) => !MARKUP_ALLOWLIST.has(key));
    expect(offenders).toEqual([]);
  });
});

describe("icons", () => {
  // The icons are Lucide's 24 x 24 drawings with their stroke of 2 (icon-set.ts, as Grok Bot's since 2026-11-06): shown
  // at 16 px, 18 on the round edge buttons (Grok Bot's 1.5 px lines) or 20 where a larger one is meant; at 12 to 15 px
  // their lines thin out and blur. The window's own minimise, maximise and close are Windows' caption glyphs, drawn for
  // 12 px: not icons of the set.
  const SIZES = new Set(["16px", "18px", "20px"]);
  const NOT_ICONS = new Set([".slime-cels > svg", ".slime-prop-cels > svg", ".slime-blink-cels > svg", ".window-button svg"]);
  const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const cssFiles = [...mainFiles, ...walk(join(SRC, "overlay"))].filter((f) => f.endsWith(".css"));
  const iconRules = (): { file: string; selector: string; body: string }[] =>
    cssFiles.flatMap((file) =>
      [...strip(read(file)).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) =>
        selectors
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /(\.i|\bsvg)(?![\w-])/.test(s) && !NOT_ICONS.has(s))
          .map((selector) => ({ file: rel(file), selector, body })),
      ),
    );

  test("an icon is shown at 16 or 20 px, never 12 to 15", () => {
    const bad = iconRules().flatMap(({ file, selector, body }) =>
      [...body.matchAll(/(?:^|;)\s*(width|height)\s*:\s*([^;]+)/g)]
        // The owner requested the send glyph match the adjacent voice portrait exactly.
        .filter(([, , value]) => !SIZES.has(value.trim()) && !(file === "sidebar.css" && selector === ".room-avatar > .av > svg.i" && value.trim() === "100%") && !(file === "sidebar.css" && selector === ".sidebar-app-marks :is(svg" && value.trim() === "18px") && !(file === "agent.css" && ((selector === ".attachment-drop > .i" && value.trim() === "28px") || (selector === ".composer .cmp-pair .cmp-send .i" && value.trim() === "32px"))))
        .map(([, prop, value]) => `${file}: ${selector} { ${prop}: ${value.trim()} }`),
    );
    expect(iconRules().length).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  test("an icon keeps the stroke of 2 it is drawn for", () => {
    const bad = iconRules()
      .filter(({ body }) => [...body.matchAll(/stroke-width\s*:\s*([^;]+)/g)].some(([, value]) => value.trim() !== "2"))
      .map(({ file, selector }) => `${file}: ${selector}`);
    expect(bad).toEqual([]);
  });

  test("no page keeps a copy of an icon: every drawing of the set comes from icon-set.ts", () => {
    const drawings = [...read(join(SRC, "main/icon-set.ts")).matchAll(/d=\\"([^\\"]{12,})\\"/g)].map(([, d]) => d);
    expect(drawings.length).toBeGreaterThan(50);
    const copies = sources.filter((f) => !["ui.ts", "icon-set.ts"].includes(rel(f)) && (read(f).includes('viewBox="0 0 16 16"') || drawings.some((d) => read(f).includes(d)))).map(rel);
    expect(copies).toEqual([]);
  });
});
