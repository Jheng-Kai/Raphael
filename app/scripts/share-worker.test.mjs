import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../share-template/worker.mjs";

const ORIGIN = "https://share.example.test";
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../core/tests/fixtures/member-template/full.raphael-member"), "utf8"));

function fakeKv() {
  const entries = new Map();
  return {
    entries,
    puts: [],
    async get(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    async put(key, value, options = {}) {
      this.puts.push({ key, options });
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}

let kv;
let env;

beforeEach(() => {
  kv = fakeKv();
  env = { SLIMES: kv };
});

const send = (path, init = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, { waitUntil() {} });
const share = (body, headers = {}) =>
  send("/v1/slimes", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const sharedFixture = async (headers) => (await share({ template: fixture }, headers)).json();

describe("sharing a recipe", () => {
  it("stores a recipe and reads, shows, downloads and deletes it", async () => {
    const response = await share({ template: fixture });
    expect(response.status).toBe(201);
    const made = await response.json();
    expect(made.id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(made.url).toBe(`${ORIGIN}/s/${made.id}`);
    expect(made.token).toMatch(/^[0-9a-f]{64}$/);

    const read = await send(`/v1/slimes/${made.id}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ template: fixture });

    const page = await send(`/s/${made.id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("Guide editor");
    expect(html).toContain("Checks a public guide for clarity and plain words.");
    expect(html).toContain("1 skill");
    expect(html).toContain("2 routines");
    expect(html).toContain("gmail, github");
    expect(html).toContain("Add to Raphael");
    expect(html).toContain(`href="/s/${made.id}/member.raphael-member"`);
    expect(html).toContain("https://github.com/Jheng-Kai/Raphael/releases/latest");

    const file = await send(`/s/${made.id}/member.raphael-member`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/json");
    const text = await file.text();
    expect(text).toBe(`${JSON.stringify(fixture, null, 2)}\n`);

    const refused = await send(`/v1/slimes/${made.id}`, { method: "DELETE", headers: { authorization: "Bearer nope" } });
    expect(refused.status).toBe(403);
    expect((await send(`/v1/slimes/${made.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await send(`/v1/slimes/${made.id}`)).status).toBe(200);

    const removed = await send(`/v1/slimes/${made.id}`, { method: "DELETE", headers: { authorization: `Bearer ${made.token}` } });
    expect(removed.status).toBe(204);
    expect((await send(`/v1/slimes/${made.id}`)).status).toBe(404);
    expect((await send(`/s/${made.id}`)).status).toBe(404);
    expect((await send(`/s/${made.id}/member.raphael-member`)).status).toBe(404);
    expect((await send(`/v1/slimes/${made.id}`, { method: "DELETE", headers: { authorization: `Bearer ${made.token}` } })).status).toBe(404);
  });

  it("keeps only the hash of the token", async () => {
    const made = await sharedFixture();
    const stored = kv.entries.get(`slime:${made.id}`);
    const record = JSON.parse(stored);
    expect(Object.keys(record).sort()).toEqual(["created", "template", "token_sha256"]);
    expect(record.token_sha256).toBe(createHash("sha256").update(made.token).digest("hex"));
    expect(stored).not.toContain(made.token);
    expect(new Date(record.created).toISOString()).toBe(record.created);
    expect(record.template).toEqual(fixture);
  });

  it("gives every share its own id and token", async () => {
    const first = await sharedFixture();
    const second = await sharedFixture();
    expect(first.id).not.toBe(second.id);
    expect(first.token).not.toBe(second.token);
  });

  it("tries another id when one is taken", async () => {
    const taken = new Set();
    const original = kv.get.bind(kv);
    let asked = 0;
    kv.get = async (key) => {
      if (key.startsWith("slime:") && asked++ < 2) {
        taken.add(key);
        return "{}";
      }
      return original(key);
    };
    const made = await sharedFixture();
    expect(taken.size).toBe(2);
    expect(taken.has(`slime:${made.id}`)).toBe(false);
  });

  it("refuses a body over 512 KiB", async () => {
    const template = { name: "Big", skills: [], routines: [], instructions: "x".repeat(512 * 1024) };
    const response = await share({ template });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBeTruthy();
    const declared = await share({ template: fixture }, { "content-length": String(600 * 1024) });
    expect(declared.status).toBe(413);
    expect(kv.entries.size).toBe(0);
  });

  it.each([
    ["not JSON", "{nope"],
    ["an empty body", ""],
    ["an array", "[]"],
    ["a string", '"x"'],
    ["no template", "{}"],
    ["a template that is not an object", { template: "x" }],
    ["a template that is an array", { template: [] }],
    ["no name", { template: { skills: [], routines: [] } }],
    ["an empty name", { template: { name: "", skills: [], routines: [] } }],
    ["a blank name", { template: { name: "   ", skills: [], routines: [] } }],
    ["a name that is not text", { template: { name: 7, skills: [], routines: [] } }],
    ["a name over 80 characters", { template: { name: "a".repeat(81), skills: [], routines: [] } }],
    ["no skills list", { template: { name: "A", routines: [] } }],
    ["skills that are not a list", { template: { name: "A", skills: {}, routines: [] } }],
    ["no routines list", { template: { name: "A", skills: [] } }],
    ["routines that are not a list", { template: { name: "A", skills: [], routines: "x" } }],
    ["an extra key beside the template", { template: fixture, note: "hi" }],
  ])("refuses %s with a JSON error", async (_label, body) => {
    const response = await share(body);
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(typeof (await response.json()).error).toBe("string");
    expect(kv.entries.size).toBe(0);
  });

  it("accepts a name of exactly 80 characters", async () => {
    const response = await share({ template: { name: "a".repeat(80), skills: [], routines: [] } });
    expect(response.status).toBe(201);
  });

  it("allows 30 shares a day per client and then answers 429", async () => {
    const mine = { "cf-connecting-ip": "203.0.113.7" };
    for (let index = 0; index < 30; index++) expect((await share({ template: fixture }, mine)).status).toBe(201);
    const refused = await share({ template: fixture }, mine);
    expect(refused.status).toBe(429);
    expect(typeof (await refused.json()).error).toBe("string");
    expect((await share({ template: fixture }, { "cf-connecting-ip": "203.0.113.8" })).status).toBe(201);

    const counters = kv.puts.filter(put => put.key.startsWith("rate:"));
    expect(counters.length).toBeGreaterThan(30);
    expect(counters[0].key).toContain("203.0.113.7");
    expect(counters[0].key).toContain(new Date().toISOString().slice(0, 10));
    expect(counters[0].options.expirationTtl).toBe(2 * 24 * 60 * 60);
  });

  it("does not count a refused share against the client", async () => {
    const mine = { "cf-connecting-ip": "203.0.113.9" };
    for (let index = 0; index < 40; index++) await share("{nope", mine);
    expect((await share({ template: fixture }, mine)).status).toBe(201);
  });
});

describe("the preview page", () => {
  const hostile = {
    name: `<script>alert("x")</script> & 'Bob'`,
    role: "<b>role</b>",
    description: `"><img src=x onerror=alert(1)> it's <script>steal()</script>`,
    skills: [],
    routines: [],
    connections: ["<svg onload=alert(1)>", "gmail"],
  };

  it("escapes every value of an untrusted recipe", async () => {
    const made = await (await share({ template: hostile })).json();
    const response = await send(`/s/${made.id}`);
    const html = await response.text();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("onerror=alert(1)>");
    expect(html).toContain("&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; &#39;Bob&#39;");
    expect(html).toContain("&#60;svg onload=alert(1)&#62;");
    const values = [...html.matchAll(/<meta [^>]*content="([^"]*)"/g)].map(match => match[1]);
    expect(values.length).toBeGreaterThan(5);
    for (const value of values) expect(value).not.toMatch(/['"<>]/);
  });

  it("ignores values of the wrong type", async () => {
    const made = await (await share({ template: { name: "Odd", description: 5, role: [], skills: [], routines: [], connections: "gmail" } })).json();
    const response = await send(`/s/${made.id}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Odd");
    expect(html).not.toContain("Asks to connect");
  });

  it("falls back to the role when there is no description", async () => {
    const made = await (await share({ template: { name: "Ann", role: "Planner", skills: [], routines: [] } })).json();
    const html = await (await send(`/s/${made.id}`)).text();
    expect(html).toContain(`<p class="about">Planner</p>`);
    expect(html).toContain(`<meta property="og:description" content="Planner">`);
  });

  it("sends preview-card tags, no scripts and strict headers", async () => {
    const made = await sharedFixture();
    const response = await send(`/s/${made.id}`);
    const html = await response.text();
    expect(html).toContain(`<meta property="og:title" content="Guide editor">`);
    expect(html).toContain(`<meta property="og:description" content="Checks a public guide for clarity and plain words.">`);
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/s/${made.id}">`);
    expect(html).toContain(`<meta name="twitter:card" content="summary">`);
    expect(html).toContain(`<meta name="twitter:title" content="Guide editor">`);
    expect(html).toContain(`<meta name="twitter:description" content="Checks a public guide for clarity and plain words.">`);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('name="viewport"');
    expect(html).not.toMatch(/<script|<img|<iframe|<link /i);

    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("unsafe-inline");
    const nonce = /style-src 'nonce-([^']+)'/.exec(csp)[1];
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    ["zh-TW,zh;q=0.9,en;q=0.8", "zh-Hant", "加入 Raphael"],
    ["zh-Hant", "zh-Hant", "加入 Raphael"],
    ["zh-HK", "zh-Hant", "加入 Raphael"],
    ["en-US,en;q=0.9,zh-TW;q=0.5", "en", "Add to Raphael"],
    ["zh-CN", "en", "Add to Raphael"],
    ["fr", "en", "Add to Raphael"],
    ["", "en", "Add to Raphael"],
  ])("picks the language from Accept-Language %j", async (header, lang, button) => {
    const made = await sharedFixture();
    const html = await (await send(`/s/${made.id}`, header ? { headers: { "accept-language": header } } : {})).text();
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain(button);
  });

  it("tells the recipient that only the recipe is copied", async () => {
    const made = await sharedFixture();
    const english = await (await send(`/s/${made.id}`)).text();
    expect(english).toContain("only this recipe");
    expect(english).toContain("routines start paused");
    expect(english).toContain("no memory or keys");
    const chinese = await (await send(`/s/${made.id}`, { headers: { "accept-language": "zh-TW" } })).text();
    expect(chinese).toContain("例行工作會先暫停");
    expect(chinese).toContain("不含記憶");
  });

  it("answers an unknown or mistyped link with a page, not a stack", async () => {
    for (const path of ["/s/AAAAAAAAAA", "/s/short", "/s/AAAAAAAAAA/member.raphael-member"]) {
      const response = await send(path);
      expect(response.status).toBe(404);
    }
    const page = await send("/s/AAAAAAAAAA", { headers: { "accept-language": "zh-TW" } });
    expect(await page.text()).toContain("這個連結已經失效");
  });
});

describe("the recipe file", () => {
  const attachment = async (name) => {
    const made = await (await share({ template: { name, skills: [], routines: [] } })).json();
    return send(`/s/${made.id}/member.raphael-member`);
  };

  it("names an ASCII file after a Latin name", async () => {
    const response = await attachment("Guide editor");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Guide-editor.raphael-member"; filename*=UTF-8''Guide%20editor.raphael-member`,
    );
  });

  it("names the file after a Chinese name with a safe ASCII fallback", async () => {
    const response = await attachment("小幫手");
    const disposition = response.headers.get("content-disposition");
    expect(disposition).toBe(`attachment; filename="member.raphael-member"; filename*=UTF-8''%E5%B0%8F%E5%B9%AB%E6%89%8B.raphael-member`);
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe("小幫手.raphael-member");
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
  });

  it("never lets a hostile name break out of the header", async () => {
    const response = await attachment(`a"b/../c\r\nSet-Cookie: x='1'*(2)`);
    const disposition = response.headers.get("content-disposition");
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9-]+\.raphael-member"; filename\*=UTF-8''[A-Za-z0-9%._-]+\.raphael-member$/);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("routing", () => {
  it("answers 405 for a known address with the wrong method", async () => {
    const made = await sharedFixture();
    expect((await send("/v1/slimes")).status).toBe(405);
    expect((await send(`/v1/slimes/${made.id}`, { method: "POST" })).status).toBe(405);
    expect((await send(`/v1/slimes/${made.id}`, { method: "PUT" })).status).toBe(405);
    expect((await send(`/s/${made.id}`, { method: "POST" })).status).toBe(405);
    expect((await send(`/s/${made.id}/member.raphael-member`, { method: "DELETE" })).status).toBe(405);
    const refused = await send("/v1/slimes", { method: "DELETE" });
    expect(refused.headers.get("allow")).toBe("POST");
  });

  it("answers 404 for anything else", async () => {
    for (const path of ["/", "/v1", "/v1/slimes/", "/v1/slimes/short", "/v1/slimes/AAAAAAAAAA/extra", "/s", "/s/", "/robots.txt", "/admin"]) {
      expect((await send(path)).status, path).toBe(404);
    }
  });

  it("sends no CORS headers and the shared safety headers on every kind of answer", async () => {
    const made = await sharedFixture();
    const answers = [
      await send(`/v1/slimes/${made.id}`),
      await send(`/s/${made.id}/member.raphael-member`),
      await send("/nothing"),
      await send("/v1/slimes"),
      await send(`/v1/slimes/${made.id}`, { method: "DELETE", headers: { authorization: `Bearer ${made.token}` } }),
    ];
    for (const answer of answers) {
      expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
      expect(answer.headers.get("referrer-policy")).toBe("no-referrer");
      expect([...answer.headers.keys()].some(key => key.startsWith("access-control-"))).toBe(false);
    }
  });

  it("answers a page preview request without a body", async () => {
    const made = await sharedFixture();
    const head = await send(`/s/${made.id}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});
