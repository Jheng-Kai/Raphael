const MAX_BODY_BYTES = 512 * 1024;
const MAX_NAME_LENGTH = 80;
const DAILY_SHARES_PER_CLIENT = 30;
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;
const ID_LENGTH = 10;
const ID_ATTEMPTS = 5;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RELEASES_URL = "https://github.com/Jheng-Kai/Raphael/releases/latest";
const ID_PATTERN = new RegExp(`^[0-9A-Za-z]{${ID_LENGTH}}$`);

const SHARED_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

const TEXT = {
  en: {
    htmlLang: "en",
    kind: "A member for Raphael",
    skills: n => (n === 1 ? "1 skill" : `${n} skills`),
    routines: n => (n === 1 ? "1 routine" : `${n} routines`),
    apps: "Asks to connect these apps",
    note: "Adding it copies only this recipe. Its routines start paused, and no memory or keys come with it.",
    add: "Add to Raphael",
    open: "Double-click the downloaded file on a computer with Raphael installed to open it.",
    get: "No Raphael yet?",
    getLink: "Get the latest release",
    fallbackDescription: "A member recipe for Raphael.",
    goneTitle: "This link is gone",
    gone: "The person who shared it may have removed it, or the link is mistyped.",
  },
  zh: {
    htmlLang: "zh-Hant",
    kind: "Raphael 的成員",
    skills: n => `${n} 個技能`,
    routines: n => `${n} 個例行工作`,
    apps: "需要連接這些 App",
    note: "加入時只會複製這份配方：例行工作會先暫停，不含記憶，也不含任何金鑰。",
    add: "加入 Raphael",
    open: "在已安裝 Raphael 的電腦上，連按兩下下載的檔案即可開啟。",
    get: "還沒有 Raphael？",
    getLink: "下載最新版本",
    fallbackDescription: "Raphael 的成員配方。",
    goneTitle: "這個連結已經失效",
    gone: "分享的人可能已經移除它，或是連結輸入有誤。",
  },
};

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #111; --muted: #5c5c5c; --line: #d9d9d9; --button-bg: #111; --button-fg: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #000; --fg: #f2f2f2; --muted: #a3a3a3; --line: #2e2e2e; --button-bg: #f2f2f2; --button-fg: #000; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", "Noto Sans TC", sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 48px 16px 64px; }
.kind { margin: 0 0 8px; color: var(--muted); font-size: 14px; }
h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.25; overflow-wrap: anywhere; }
.about { margin: 0 0 20px; overflow-wrap: anywhere; }
ul { margin: 0 0 20px; padding: 0; list-style: none; border-top: 1px solid var(--line); }
li { padding: 10px 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.label { display: block; color: var(--muted); font-size: 14px; }
.note, .help { color: var(--muted); font-size: 14px; margin: 0 0 16px; }
.add { display: block; width: 100%; min-height: 48px; padding: 12px 16px; margin: 0 0 12px; border-radius: 10px; background: var(--button-bg); color: var(--button-fg); font-weight: 600; text-align: center; text-decoration: none; }
.add:focus-visible, a:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
a { color: var(--fg); }
`;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch {
      return json({ error: "Something went wrong." }, 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  if (path === "/v1/slimes") {
    if (method !== "POST") return methodNotAllowed("POST");
    return createSlime(request, env, url.origin);
  }

  const api = /^\/v1\/slimes\/([^/]+)$/.exec(path);
  if (api) {
    if (method !== "GET" && method !== "DELETE") return methodNotAllowed("GET, DELETE");
    if (!ID_PATTERN.test(api[1])) return json({ error: "Not found." }, 404);
    return method === "GET" ? readSlime(env, api[1]) : deleteSlime(request, env, api[1]);
  }

  const page = /^\/s\/([^/]+)$/.exec(path);
  const file = /^\/s\/([^/]+)\/member\.raphael-member$/.exec(path);
  if (page || file) {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed("GET, HEAD");
    const id = (page || file)[1];
    const response = file ? await memberFile(env, id) : await memberPage(request, env, id);
    return method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }

  return json({ error: "Not found." }, 404);
}

async function createSlime(request, env, origin) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: "The recipe is too large." }, 413);
  const bytes = await readLimited(request, MAX_BODY_BYTES);
  if (bytes === null) return json({ error: "The recipe is too large." }, 413);

  const ip = (request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 64);
  const counterKey = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const shared = Number(await env.SLIMES.get(counterKey)) || 0;
  if (shared >= DAILY_SHARES_PER_CLIENT) return json({ error: "Too many shares today. Try again tomorrow." }, 429);

  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return json({ error: "The body is not JSON." }, 400);
  }
  if (!isObject(body)) return json({ error: "The body must be a JSON object." }, 400);
  if (Object.keys(body).some(key => key !== "template")) return json({ error: "The body holds only a template." }, 400);
  const problem = templateProblem(body.template);
  if (problem) return json({ error: problem }, 400);

  const id = await freshId(env);
  if (id === null) return json({ error: "Could not make a link. Try again." }, 503);
  const token = randomHex(32);
  const record = { template: body.template, created: new Date().toISOString(), token_sha256: await sha256Hex(token) };
  await env.SLIMES.put(`slime:${id}`, JSON.stringify(record));
  await env.SLIMES.put(counterKey, String(shared + 1), { expirationTtl: COUNTER_TTL_SECONDS });
  return json({ id, url: `${origin}/s/${id}`, token }, 201);
}

async function readSlime(env, id) {
  const record = await loadRecord(env, id);
  return record ? json({ template: record.template }, 200) : json({ error: "Not found." }, 404);
}

async function deleteSlime(request, env, id) {
  const record = await loadRecord(env, id);
  if (!record) return json({ error: "Not found." }, 404);
  const presented = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") || "");
  const matches = presented !== null && sameText(await sha256Hex(presented[1]), String(record.token_sha256));
  if (!matches) return json({ error: "The token does not match." }, 403);
  await env.SLIMES.delete(`slime:${id}`);
  return new Response(null, { status: 204, headers: SHARED_HEADERS });
}

async function memberFile(env, id) {
  const record = ID_PATTERN.test(id) ? await loadRecord(env, id) : null;
  if (!record) return json({ error: "Not found." }, 404);
  const name = cleanName(record.template.name);
  const ascii = name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "member";
  const disposition = `attachment; filename="${ascii}.raphael-member"; filename*=UTF-8''${rfc5987(name)}.raphael-member`;
  return new Response(`${JSON.stringify(record.template, null, 2)}\n`, {
    status: 200,
    headers: { ...SHARED_HEADERS, "Content-Type": "application/json", "Content-Disposition": disposition },
  });
}

async function memberPage(request, env, id) {
  const lang = pickLanguage(request.headers.get("Accept-Language"));
  const record = ID_PATTERN.test(id) ? await loadRecord(env, id) : null;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  if (!record) {
    const t = TEXT[lang];
    const body = `<main><h1>${escapeHtml(t.goneTitle)}</h1><p class="about">${escapeHtml(t.gone)}</p></main>`;
    return htmlResponse(documentHtml({ lang, nonce, title: t.goneTitle, description: t.gone, body, origin: null }), 404, nonce);
  }
  const shareUrl = `${new URL(request.url).origin}/s/${id}`;
  return htmlResponse(memberHtml(record.template, lang, nonce, id, shareUrl), 200, nonce);
}

function memberHtml(template, lang, nonce, id, shareUrl) {
  const t = TEXT[lang];
  const name = cleanName(template.name);
  const about = line(template.description, 400) || line(template.role, 80);
  const apps = (Array.isArray(template.connections) ? template.connections : [])
    .filter(app => typeof app === "string")
    .map(app => line(app, 40))
    .filter(Boolean)
    .slice(0, 20);
  const rows = [
    `<li>${escapeHtml(t.skills(count(template.skills)))}</li>`,
    `<li>${escapeHtml(t.routines(count(template.routines)))}</li>`,
  ];
  if (apps.length) rows.push(`<li><span class="label">${escapeHtml(t.apps)}</span>${apps.map(escapeHtml).join(", ")}</li>`);
  const body = [
    "<main>",
    `<p class="kind">${escapeHtml(t.kind)}</p>`,
    `<h1>${escapeHtml(name)}</h1>`,
    about ? `<p class="about">${escapeHtml(about)}</p>` : "",
    `<ul>${rows.join("")}</ul>`,
    `<p class="note">${escapeHtml(t.note)}</p>`,
    `<a class="add" href="/s/${id}/member.raphael-member" download>${escapeHtml(t.add)}</a>`,
    `<p class="help">${escapeHtml(t.open)}</p>`,
    `<p class="help">${escapeHtml(t.get)} <a href="${RELEASES_URL}">${escapeHtml(t.getLink)}</a></p>`,
    "</main>",
  ].join("");
  return documentHtml({ lang, nonce, title: name, description: about || t.fallbackDescription, body, origin: shareUrl });
}

function documentHtml({ lang, nonce, title, description, body, origin }) {
  const t = TEXT[lang];
  const summary = escapeHtml(line(description, 200));
  const heading = escapeHtml(title);
  const meta = [
    `<meta name="robots" content="noindex">`,
    `<meta name="description" content="${summary}">`,
    `<meta property="og:site_name" content="Raphael">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${heading}">`,
    `<meta property="og:description" content="${summary}">`,
    origin ? `<meta property="og:url" content="${escapeHtml(origin)}">` : "",
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${heading}">`,
    `<meta name="twitter:description" content="${summary}">`,
  ].filter(Boolean);
  return [
    "<!doctype html>",
    `<html lang="${t.htmlLang}">`,
    "<head>",
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${heading}</title>`,
    ...meta,
    `<style nonce="${nonce}">${STYLE}</style>`,
    "</head>",
    `<body>${body}</body>`,
    "</html>",
    "",
  ].join("\n");
}

function htmlResponse(html, status, nonce) {
  return new Response(html, {
    status,
    headers: {
      ...SHARED_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      Vary: "Accept-Language",
    },
  });
}

function pickLanguage(header) {
  const ranked = String(header || "")
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.trim().split(";");
      const weight = params.map(p => /^\s*q=([0-9.]+)\s*$/i.exec(p)).find(Boolean);
      return { tag: tag.trim().toLowerCase(), q: weight ? Number(weight[1]) : 1, order };
    })
    .filter(entry => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  const top = ranked[0]?.tag ?? "";
  return /^zh-(tw|hk|mo|hant)(-|$)/.test(top) ? "zh" : "en";
}

function templateProblem(template) {
  if (!isObject(template)) return "The template must be an object.";
  const name = typeof template.name === "string" ? template.name.trim() : "";
  if (!name) return "The template needs a name.";
  if (Array.from(name).length > MAX_NAME_LENGTH) return `The name is longer than ${MAX_NAME_LENGTH} characters.`;
  if (!Array.isArray(template.skills)) return "The template needs a skills list.";
  if (!Array.isArray(template.routines)) return "The template needs a routines list.";
  return "";
}

async function loadRecord(env, id) {
  const stored = await env.SLIMES.get(`slime:${id}`);
  if (stored === null || stored === undefined) return null;
  try {
    const record = JSON.parse(stored);
    return isObject(record) && isObject(record.template) ? record : null;
  } catch {
    return null;
  }
}

async function freshId(env) {
  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
    const id = randomBase62(ID_LENGTH);
    if ((await env.SLIMES.get(`slime:${id}`)) === null) return id;
  }
  return null;
}

async function readLimited(request, limit) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function randomBase62(length) {
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      // 248 is the largest multiple of 62 that fits in a byte; larger values would favour the first characters.
      if (byte < 248 && out.length < length) out += BASE62[byte % 62];
    }
  }
  return out;
}

function randomHex(byteCount) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteCount)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function line(value, limit) {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/\s+/g, " ").trim()).slice(0, limit).join("");
}

function cleanName(value) {
  return line(value, MAX_NAME_LENGTH) || "member";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

function rfc5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { ...SHARED_HEADERS, "Content-Type": "application/json" } });
}

function methodNotAllowed(allow) {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { ...SHARED_HEADERS, "Content-Type": "application/json", Allow: allow },
  });
}
