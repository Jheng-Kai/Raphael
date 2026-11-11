/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { readdirSync } from "node:fs";
import { BRAND_COLORS, COLOURED_MARKS, LOGO_IDS, SERVICE_ICONS, brandStyle, hasLogo, monogram, serviceIconOf, serviceIconSVG, serviceLogoHTML } from "./service-icons";
import { iconHTML } from "./connections";
import { ico } from "./ui";
import { providerMark } from "./provider-marks";
import providerKinds from "./fixtures/provider-kinds.json";

test("the provider-kinds fixture covers the local registry", () => {
  const presets = readFileSync("../core/src/raphael_core/brain/providers/presets.py", "utf8");
  const kinds = [...presets.matchAll(/^\s*(?:preset\(|\()"([^"]+)",/gm)].map((match) => match[1]);
  expect([...providerKinds].sort()).toEqual(kinds.sort());
});

test.each(providerKinds)("provider kind %s resolves to installed artwork or its own generic icon", (kind) => {
  const html = providerMark(kind);
  if (["openai_compatible", "koboldcpp", "text_generation_webui"].includes(kind)) {
    expect(html).toContain(ico("plug"));
  } else {
    expect(html).not.toContain(ico("plug"));
    expect(html).toMatch(/logo-(?:art|mono)/);
    expect(html).not.toContain('src=""');
  }
  const base = kind.replace(/_cn$/, "");
  expect(providerMark(`${base}_cn`)).toBe(providerMark(base));
});

test.each([
  ["bedrock", "aws"], ["amazon_bedrock", "aws"], ["ollama_cloud", "ollama"], ["vertex", "vertex"],
] as const)("%s uses the installed %s mark", (kind, mark) => {
  expect(hasLogo(mark)).toBe(true);
  expect(providerMark(kind)).toContain(serviceLogoHTML(mark));
});

test("new provider artwork is reserved and regional variants share the base mark", () => {
  for (const id of ["vertex", "bedrock", "xai", "moonshot", "dashscope", "minimax", "vllm", "text_generation_webui", "inference_net"] as const) {
    expect(LOGO_IDS).toContain(id);
    if (!hasLogo(id)) expect(iconHTML(id, id, "md")).toContain(ico("plug"));
  }
  for (const id of ["moonshot", "dashscope", "minimax"]) expect(providerMark(`${id}_cn`)).toBe(providerMark(id));
});

test("reserved provider brands with no installed artwork show the plug instead of a broken image or initial", () => {
  for (const id of ["openai", "azure", "litellm", "portkey", "nebius", "bifrost", "groq", "anthropic", "googlegemini", "googlecloud", "ollama", "vercel", "lmstudio", "deepseek", "mistral"] as const) {
    expect(LOGO_IDS).toContain(id);
    const html = iconHTML(id, id, "md");
    expect(html).not.toContain('src=""');
    if (!hasLogo(id)) expect(html).toContain(ico("plug"));
  }
});

describe("the marks of well-known programs", () => {
  test.each([
    [{ name: "Notion" }, "notion"],
    [{ name: "docs", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"] }, "notion"],
    [{ name: "x", url: "https://mcp.notion.com/mcp" }, "notion"],
    [{ name: "code", command: "npx", args: ["@modelcontextprotocol/server-github"] }, "github"],
    [{ name: "Google Drive" }, "googledrive"],
    [{ name: "files", command: "npx", args: ["-y", "@modelcontextprotocol/server-gdrive"] }, "googledrive"],
    [{ name: "mail", url: "https://gmail.googleapis.com/mcp" }, "gmail"],
    [{ name: "Google Calendar" }, "googlecalendar"],
    [{ name: "cal", url: "https://calendar.google.com/mcp" }, "googlecalendar"],
    [{ name: "Linear", url: "https://mcp.linear.app/sse" }, "linear"],
    [{ name: "design", command: "npx", args: ["figma-developer-mcp"] }, "figma"],
    [{ name: "Spotify" }, "spotify"],
    [{ name: "chat", command: "uvx", args: ["mcp-discord"] }, "discord"],
    [{ name: "Slack" }, "slack"],
    [{ name: "chat", url: "https://slack.com/api" }, "slack"],
    [{ name: "tasks", command: "npx", args: ["todoist-mcp"] }, "todoist"],
    [{ name: "vault", command: "npx", args: ["obsidian-mcp"] }, "obsidian"],
    [{ name: "x", url: "https://mcp.atlassian.com/v1/mcp" }, "atlassian"],
    [{ name: "Jira" }, "atlassian"],
    [{ name: "x", url: "https://mcp.cloudflare.com/mcp" }, "cloudflare"],
    [{ name: "x", url: "https://mcp.sentry.dev/mcp" }, "sentry"],
    [{ name: "x", url: "https://mcp.stripe.com" }, "stripe"],
    [{ name: "x", url: "https://mcp.zapier.com/api/mcp/mcp" }, "zapier"],
    [{ name: "x", url: "https://mcp.paypal.com/mcp" }, "paypal"],
    [{ name: "OpenRouter" }, "openrouter"],
    [{ name: "Brave Search" }, "brave"],
    [{ name: "SearXNG" }, "searxng"],
    [{ name: "Tavily" }, "tavily"],
    [{ name: "Jina AI" }, "jina"],
    [{ name: "Firecrawl" }, "firecrawl"],
  ] as const)("%j is %s", (hints, id) => {
    expect(serviceIconOf(hints)).toBe(id);
  });

  test("a program that is none of them has none, and a part of a word is not the word", () => {
    expect(serviceIconOf({ name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] })).toBeNull();
    expect(serviceIconOf({ name: "Notes", command: "npx" })).toBeNull();
    expect(serviceIconOf({ name: "Notionally" })).toBeNull();
    expect(serviceIconOf({ name: "calendar" })).toBeNull(); // not Google's, as far as it says
    expect(serviceIconOf({ name: "drive", url: "not an address" })).toBeNull();
    expect(serviceIconOf({ name: "筆記" })).toBeNull();
  });

  test("a one-colour mark is one drawn path; a many-coloured one draws each part in its official colour", () => {
    for (const id of Object.keys(SERVICE_ICONS) as (keyof typeof SERVICE_ICONS)[]) {
      const svg = serviceIconSVG(id);
      expect(svg).toContain('aria-hidden="true"');
      expect(SERVICE_ICONS[id].path).toMatch(/^[Mm][\d. ,\-a-zA-Z]+$/);
      if (id in COLOURED_MARKS) {
        expect(svg).not.toContain("currentColor");
        expect(svg.match(/<path fill="#[0-9A-Fa-f]{6}" d="/g)?.length, id).toBe(COLOURED_MARKS[id]!.parts.length);
      } else {
        expect(svg).toContain('fill="currentColor"');
        expect(svg).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
      }
    }
  });

  test("a brand with artwork of its own is found by its name or its address", () => {
    expect(serviceIconOf({ name: "x", url: "https://mcp.monday.com/mcp" })).toBe("monday");
    expect(serviceIconOf({ name: "x", url: "https://huggingface.co/mcp" })).toBe("huggingface");
    expect(serviceIconOf({ name: "x", url: "https://mcp.webflow.com/mcp" })).toBe("webflow");
    // The owner's own connector, named as Claude's connectors name it (2026-11-10).
    expect(serviceIconOf({ name: "Mobbin MCP" })).toBe("mobbin");
    expect(hasLogo("mobbin")).toBe(true);
  });

  test("plain words that are also a brand do not pick a picture for a program of the user's own", () => {
    for (const name of ["close", "ramp", "jam", "gamma", "exa"]) expect(serviceIconOf({ name })).toBeNull();
  });

  test("marks keep their owners' official colours, whatever the surface", () => {
    expect(BRAND_COLORS).toMatchObject({
      linear: "#5E6AD2", discord: "#5865F2", spotify: "#1ED760", telegram: "#26A5E4", atlassian: "#0052CC",
      cloudflare: "#F38020", obsidian: "#7C3AED", netlify: "#00C7B7", neon: "#00E599", postman: "#FF6C37",
      sanity: "#F03E2F", searxng: "#3050FF", todoist: "#E44332", stripe: "#635BFF", zapier: "#FF4F00",
    });
    // the many-coloured logos carry their colours in their parts, not one brand colour
    for (const id of ["slack", "gmail", "googledrive", "googlecalendar", "figma", "airtable"] as const) {
      expect(COLOURED_MARKS[id], id).toBeDefined();
      expect(BRAND_COLORS[id], id).toBeUndefined();
    }
    // black in their official form: black on the light theme, their official white on the dark one
    for (const id of ["notion", "github", "openrouter", "posthog"] as const) expect(brandStyle(id)).toBe("");
  });

  test("the brand colour is given to the wrapper as a variable, and only for the marks that have one", () => {
    expect(brandStyle("linear")).toBe(' style="--brand:#5E6AD2"');
    expect(brandStyle("notion")).toBe("");
    expect(brandStyle("slack")).toBe("");
  });

  test("a mark that is near black in its colour turns to the colour of the text on the dark theme", () => {
    expect(brandStyle("sentry")).toBe(' style="--brand:light-dark(#362D59,var(--text))"');
    expect(brandStyle("paypal")).toBe(' style="--brand:light-dark(#002991,var(--text))"');
    expect(brandStyle("prisma")).toBe(' style="--brand:light-dark(#2D3748,var(--text))"');
  });

  test("Slack draws its supplied Simple Icons path in its four official colours, two pieces each", () => {
    expect(createHash("sha256").update(SERVICE_ICONS.slack.path).digest("hex")).toBe("69c3650cc9632f4edcf00bb5fd02792d5cb46d8af58f8db5001ba64cdd40da4b");
    const parts = COLOURED_MARKS.slack!.parts;
    expect(parts.map(([fill]) => fill)).toEqual(["#E01E5A", "#E01E5A", "#36C5F0", "#36C5F0", "#2EB67D", "#2EB67D", "#ECB22E", "#ECB22E"]);
    expect(parts.map(([, d]) => d).join("")).toBe(SERVICE_ICONS.slack.path);
  });

  test("a paired person's avatar can keep an escaped initial", () => {
    expect(monogram("filesystem")).toBe("F");
    expect(monogram("  筆記")).toBe("筆");
    expect(monogram("<b>")).toBe("&lt;");
    expect(monogram("")).toBe("?");
  });

  test("an official full-colour logo is a picture file of its own, with the brand's own colours and no tile of ours", () => {
    expect(hasLogo("monday")).toBe(true);
    expect(hasLogo("notion")).toBe(false);
    const html = serviceLogoHTML("monday");
    expect(html).toMatch(/^<img class="logo lg-l" src="data:image\/png;base64,/);
    expect(html).toContain('alt=""');
    expect(html).not.toContain("lg-d");
  });

  test("a logo that is dark in its official form has its own light version, shown on the dark theme", () => {
    const html = serviceLogoHTML("attio");
    expect(html).toMatch(/class="logo lg-l" src="data:image\/svg\+xml/);
    expect(html).toMatch(/class="logo lg-d" src="data:image\/svg\+xml/);
  });

  test("release credits name all the added service marks and their source groups", () => {
    const notice = readFileSync("scripts/release-licenses/brand-logos-NOTICE.txt", "utf8");
    const manifest = JSON.parse(readFileSync("scripts/release-licenses/manifest.json", "utf8"));
    const icons = manifest.components.find((entry: { name: string }) => entry.name === "Simple Icons");
    const logos = manifest.components.find((entry: { name: string }) => entry.name === "Brand logos");
    for (const name of ["OpenRouter", "Brave", "SearXNG", "Slack"]) {
      expect(notice).toContain(name);
      expect(icons.usage).toContain(name);
    }
    for (const name of ["Tavily", "Jina", "Firecrawl"]) {
      expect(notice).toContain(name);
      expect(logos.usage).toContain(name);
    }
  });

  test("the logo files and the list of ids are the same, and each has its source written down", () => {
    const files = readdirSync("src/main/service-logos");
    const ids = new Set(files.filter((f) => /\.(svg|png)$/.test(f)).map((f) => f.replace(/\.dark\.(svg|png)$|\.(svg|png)$/, "")));
    const installed = LOGO_IDS.filter(hasLogo);
    expect([...ids].sort()).toEqual([...installed].sort());
    const sources = JSON.parse(readFileSync("src/main/service-logos/sources.json", "utf8")) as Record<string, { file: string; url: string }>;
    expect(Object.keys(sources).sort()).toEqual([...installed].sort());
    for (const [id, source] of Object.entries(sources)) {
      expect(source.url, id).toMatch(/^https:\/\//);
      expect(files, id).toContain(source.file);
    }
  });

  test("a logo file is plain drawing: no script, no outside address, nothing that runs", () => {
    for (const file of readdirSync("src/main/service-logos").filter((f) => f.endsWith(".svg"))) {
      const svg = readFileSync(`src/main/service-logos/${file}`, "utf8");
      expect(svg, file).toMatch(/^\s*(<\?xml[^>]*>\s*)?<svg\b/);
      expect(svg, file).toContain("viewBox");
      expect(svg, file).not.toMatch(/<script|<foreignObject|<image|href=|\son\w+=|@import|url\(\s*["']?https?:/i);
    }
  });
});
