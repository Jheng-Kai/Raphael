/// <reference types="node" />
// R-UI-164: every app, tool server and service the app knows wears a mark of its own wherever it is listed (the 工具 tab, the
// @ menu, 連結應用程式, the Connections pill, the cards and the work steps all draw from service-mark.ts), drawn in one square
// whatever the size or shape of its picture. An app nobody drew wears the one generic app mark, never the plug or a letter.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { LOGO_IDS, SERVICE_ICONS, hasLogo, serviceIconOf, type ServiceIconId } from "./service-icons";
import { entryIcon, genericGlyph, genericMark, iconHTML, isIcon, pillMarks } from "./service-mark";
import { ownGoogleEntry, ownServerApps } from "./connections";
import { connectionMarkHTML } from "./secret-card";

/** A mark of its own: our drawn mark, a logo file or the catalogue's picture, each a `.logo` the shared square reaches. */
const own = (html: string): boolean =>
  !html.includes("logo-generic") && !html.includes('class="i"') &&
  (/<svg class="logo" viewBox="[-\d. ]+" aria-hidden="true" focusable="false">(?:<path fill="[^"]+" d="[^"]+"\/>)+<\/svg>/.test(html) ||
    /<img class="logo(?: lg-l)?" src="(?:data:image\/(?:svg\+xml|png)[;,]|https:\/\/[a-z0-9.-]*composio\.dev\/)[^"]+"/.test(html));

const OUTLOOK = "https://logos.composio.dev/api/outlook";

describe("every app the app knows wears its own mark", () => {
  test("every mark of the set and every installed logo draws itself, never the generic mark", () => {
    const ids = [...Object.keys(SERVICE_ICONS), ...LOGO_IDS.filter(hasLogo)] as ServiceIconId[];
    for (const id of ids) expect(own(iconHTML(id, id, "md")), id).toBe(true);
  });

  test("every brand of the set is found by its own name, so a card or a list that only knows the name draws it", () => {
    // The name an app of each brand goes by where it is not the mark's title.
    const named: Partial<Record<keyof typeof SERVICE_ICONS, string>> = { brave: "Brave Search" };
    for (const [id, { title }] of Object.entries(SERVICE_ICONS) as [keyof typeof SERVICE_ICONS, { title: string }][]) {
      const name = named[id] ?? title;
      expect(serviceIconOf({ name }), name).toBe(id);
      expect(own(entryIcon({ name }, "md")), name).toBe(true);
      expect(own(connectionMarkHTML(name)), name).toBe(true);
    }
  });

  test("the apps the owner names in every list wear their own marks: Google wears Google's G, in every language of the app", () => {
    for (const name of ["Google", "Gmail", "Google Calendar", "Google Drive", "Notion", "GitHub", "Slack", "Telegram", "Discord", "Hugging Face", "Mobbin MCP", "OpenRouter"]) {
      expect(own(entryIcon({ name }, "md")), name).toBe(true);
    }
    const dir = "src/main/i18n";
    const labels = readdirSync(dir).filter((file) => /^[a-z]{2}(?:-[A-Z]{2})?\.ts$/.test(file))
      .map((file) => /"plugins\.privateGoogle": "([^"]+)"/.exec(readFileSync(join(dir, file), "utf8"))?.[1]).filter((label): label is string => !!label);
    expect(labels.length).toBeGreaterThan(10);
    for (const name of ["Google", ...labels]) {
      expect(serviceIconOf({ name }), name).toBe("google");
      // the 工具 tab gives the connection's id as its icon; the @ menu and the cards know only its name
      expect(entryIcon({ name, icon: "google" }, "md"), name).toBe(iconHTML(name, "google", "md"));
      expect(entryIcon({ name }, "md"), name).toBe(iconHTML(name, "google", "md"));
    }
    expect(ownGoogleEntry(null).icon).toBe("google");
  });

  test("an app the catalogue draws wears its picture, and another Google product keeps its own rather than the account's G", () => {
    expect(entryIcon({ name: "Outlook", icon: "composio:outlook", logo: OUTLOOK }, "md")).toContain(`<img class="logo" src="${OUTLOOK}"`);
    const sheets = "https://logos.composio.dev/api/googlesheets";
    expect(serviceIconOf({ name: "Google Sheets" })).toBeNull();
    expect(entryIcon({ name: "Google Sheets", logo: sheets }, "md")).toContain(`src="${sheets}"`);
  });

  test("the store's apps, the core's catalogue, the messaging channels and the pill's starters all have marks of their own", () => {
    const catalog = readFileSync("../core/src/raphael_core/integrations/catalog.py", "utf8");
    const icons = /^ICONS = \(([^)]*)\)/m.exec(catalog)![1]!.match(/"([^"]+)"/g)!.map((word) => word.slice(1, -1));
    expect(icons.length).toBeGreaterThan(20);
    const store = [...ownServerApps(), ownGoogleEntry(null)].map((app) => app.icon ?? `${app.id} has no icon`);
    for (const id of [...icons, ...store, "telegram", "slack", "discord"]) {
      expect(isIcon(id), id).toBe(true);
      expect(own(iconHTML(id, id as ServiceIconId, "md")), id).toBe(true);
    }
    const starters = /const STARTER_APPS = (\[[^\n]*\]) as const;/.exec(readFileSync("src/main/sidebar.ts", "utf8"))![1]!;
    const entries = JSON.parse(starters.replace(/(\w+):/g, '"$1":')) as { name: string; icon: string }[];
    expect(pillMarks([], entries, 3).map((mark) => own(mark.html))).toEqual([true, true, true]);
  });
});

describe("an app nobody drew", () => {
  test("wears the one generic app mark at every size, from the one place every list draws it", () => {
    for (const size of ["md", "xl"] as const) {
      expect(iconHTML("團隊資料庫", null, size)).toBe(genericMark(size));
      expect(entryIcon({ name: "團隊資料庫", icon: "remote" }, size)).toBe(genericMark(size));
    }
    expect(genericMark("md")).toBe(`<span class="mono md" aria-hidden="true">${genericGlyph()}</span>`);
    // a mark, sized by the shared square like every other one, and a line drawing in the colour around it
    expect(genericGlyph()).toMatch(/^<svg class="logo logo-generic" viewBox="0 0 24 24" aria-hidden="true">/);
    expect(connectionMarkHTML("天氣服務")).toBe(genericMark("md"));
  });

  test("never wears the plug, the icon of 工具 and 連結應用程式: no source draws it as a mark", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [join(dir, entry.name)] : []);
    const plugs = files("src").filter((file) => /ico\(\s*["']plug["']\s*\)|\?\?\s*["']plug["']/.test(readFileSync(file, "utf8")));
    expect(plugs).toEqual([]);
  });
});

describe("every mark is drawn in one square", () => {
  const sheets = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? sheets(join(dir, entry.name)) : entry.name.endsWith(".css") ? [join(dir, entry.name)] : []);
  const rules = sheets("src").flatMap((file) =>
    [...readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .map(([, selectors, body]) => ({ file, selectors: selectors!.split(",").map((one) => one.trim()), body: body! })));
  const value = (body: string, property: string): string | undefined => new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim();
  const ruleOf = (selector: string) => rules.filter((rule) => rule.file.endsWith("connections.css") && rule.selectors.includes(selector)).pop();

  test("the box is one grid cell and the mark a square as tall as it, whatever its picture's own size or shape", () => {
    // Without the cell a picture's height has nothing to resolve against: a catalogue's 128 px picture (Outlook's) was drawn
    // as wide as the 28 px box while the marks beside it were 22.
    expect(value(ruleOf(".mono")!.body, "grid-template")).toBe("minmax(0, 1fr) / minmax(0, 1fr)");
    const mark = ruleOf(".mono .logo")!.body;
    expect([value(mark, "width"), value(mark, "height"), value(mark, "max-width"), value(mark, "aspect-ratio")]).toEqual(["auto", "100%", "100%", "1"]);
    // the full-colour pictures are fitted in that square, never stretched back to the box
    const art = ruleOf(".logo-art .logo")!.body;
    expect([value(art, "width"), value(art, "height"), value(art, "object-fit")]).toEqual([undefined, undefined, "contain"]);
  });

  test("no rule anywhere draws a mark wider than it is tall", () => {
    const sizing = rules.filter((rule) => rule.selectors.some((selector) => /(?:\.logo|\.mono (?:svg|img)|\.mono > svg)$/.test(selector)));
    expect(sizing.length).toBeGreaterThan(5);
    for (const rule of sizing) {
      if (rule.file.endsWith("connections.css") && rule.selectors.includes(".mono .logo")) continue;
      const [width, height] = [value(rule.body, "width"), value(rule.body, "height")];
      expect(width, `${rule.selectors.join(", ")} (${rule.file})`).toBe(height);
    }
  });
});
