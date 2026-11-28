import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installMock } from "./mock-ipc.js";
import { auditDocument, failedChecks } from "./audit.mjs";
import { decodeVisibleImages, perform } from "./driver.mjs";
import { checkRendered } from "./checks.mjs";
import { contactSheets } from "./contact-sheet.mjs";
import { requestDisposition } from "./requests.mjs";
import { saveReport } from "./report.mjs";
import { navigationRequests, warmupEntries } from "./navigation.mjs";
import { coveredByTrafficLights, drawTrafficLights, trafficLights } from "./traffic-lights.mjs";

/** Product, model, unit, key names and external menu paths that stay in Latin letters in every language. */
// Integrated model and service names, and bundled license attributions, stay in Latin letters.
/** Where the installed packages really are: a worktree's `node_modules` may be a junction to another checkout's, and the dev server serves a package's own files (KaTeX's fonts) from there. */
const modulesRoot = app => { try { return realpathSync(join(app, "node_modules")); } catch { return app; } };

export const LATIN_NAMES = ["Raphael", "Docker", "Docker Desktop", "Google", "Gmail", "Calendar", "Composio", "OpenRouter", "OpenAI", "ChatGPT", "Anthropic", "Claude", "Codex", "Gemini", "GPT", "Telegram", "Slack", "Discord", "Notion", "GitHub", "Mobbin", "MCP", "API", "URL", "CLI", "SSH", "STT", "PDF", "WAV", "CSV", "JSON", "US", "KB", "MB", "GB", "GMT", "AM", "PM", "Alt", "AltGr", "Ctrl", "Shift", "Space", "Esc", "Enter", "Tab", "Win", "Windows", "Fn", "Edge", "Chrome", "macOS", "Whisper", "Tailscale", "Funnel", "Cloudflare", "Tunnel", "ngrok", "Webhook", "HMAC", "SHA", "Signature", "Simple", "Icons", "Bearer", "mcpServers", "Ollama", "Linear", "BotFather", "newbot", "English", "MIT", "JPG", "WebP", "GIF", "UTF", "Big", "txt", "px", "token", "Claude Code", "Opus", "Sonnet", "Antigravity", "KEY=value", "Settings → Project Settings → API Keys"];

LATIN_NAMES.push("1Password");
// A project's branches are Git's, named as Git names itself (the branch card's notices).
LATIN_NAMES.push("Git");
// The shell a host repair is pasted into on Windows is named as Windows names it.
LATIN_NAMES.push("PowerShell");
// The app's own slash commands (app-commands.ts) are typed as they are in every language, as Claude Code's are.
LATIN_NAMES.push("usage");
// The keys as a Mac names them (keys.ts on macOS): 右 Option, Control, Command, Return; and the Mac itself.
LATIN_NAMES.push("Option", "Control", "Command", "Return", "Mac");

/** Typed owner values are synthetic data, just like the initial fixture's values. */
export function sceneLatinNames(scene, locale, fixture) {
  if (locale !== "zh-TW") return null;
  const words = value => typeof value === "string" ? value.match(/[A-Za-z]{2,}/g) ?? [] : Array.isArray(value) ? value.flatMap(words) : value && typeof value === "object" ? Object.values(value).flatMap(words) : [];
  const typed = scene.steps.filter(step => step.action === "type").map(step => step.text);
  return [...new Set([...words(fixture), ...words(scene.fixture), ...words(typed), ...LATIN_NAMES].map(word => word.toLowerCase()))];
}

// Agents run inside their own sandbox, where the browser cannot start a second one; the page is our
// own app on loopback only.
export const BROWSER_ARGS = ["--no-sandbox", "--disable-gpu", "--disable-crash-reporter", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update"];

const app = resolve(import.meta.dirname, "../..");
const requireFromApp = createRequire(join(app, "package.json"));
// The version package.json pins, read from it: an update of the dependency cannot leave this name behind (it said 25.13.0
// while 25.16.0 was installed).
export const REQUIRED_PUPPETEER = `puppeteer-core@${requireFromApp("./package.json").devDependencies["puppeteer-core"]}`;

/**
 * What the core serves of an HTML page that writes no style of its own, for each theme (core agent/pages.py `document`, R-PAGE-06): the
 * page with the app's base style in front of it. The core makes it, so a scene sees the style the owner's page gets, never a copy.
 */
/** The core's development interpreter: `Scripts/python.exe` of its venv on Windows, `bin/python` elsewhere. */
export function corePython() {
  return process.env.RAPHAEL_CORE_PYTHON || join(app, "../core/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
}

export async function pageBaseDocuments(html, python = corePython(), state = null) {
  // `state`: what the owner left on the page (R-PAGE-14), which the core serves back with it.
  const code = "import json,sys; from raphael_core.agent.pages import document; page={'title':'page','html':sys.argv[1],'source':'html'}; state=json.loads(sys.argv[2]); print(json.dumps({theme: document(page, theme, state) for theme in ('light', 'dark')}))";
  const { stdout } = await promisify(execFile)(python, ["-c", code, html, JSON.stringify(state)], { windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: join(app, "../core/src"), PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" } });
  return JSON.parse(stdout);
}

/**
 * What the core itself sends for the member Library (`members.library`) of a synthetic database (core_fixtures.py, R-PANEL-10):
 * a scene shows the list the core's rules make, never a copy of them.
 */
export async function coreFixtures(now = Date.now(), python = corePython()) {
  const { stdout } = await promisify(execFile)(python, [join(import.meta.dirname, "core_fixtures.py"), String(now)], { windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: join(app, "../core/src"), PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" } });
  return JSON.parse(stdout);
}

export const needsDesktopFixture =selected => selected.some(scene => scene.fixture?.desktop || scene.fixture?.cardDeck || scene.name.startsWith("desktop-") || scene.name === "chat-computer-takeover");

export function browserPath() {
  const candidates = [process.env.LOOK_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) throw new Error("Installed Edge/Chrome not found; set LOOK_BROWSER to its executable path.");
  return found;
}

function writeHostFrame(host, images) {
  const target = host.model.shown, image = images[target === "popup" ? 1 : 0];
  const frame = JSON.stringify({ target, image, width: 1280, height: 900 }) + "\n";
  for (const response of host.responses) response.write(frame);
}

export async function run(options) {
  const cpuSlowdown = Number(process.env.LOOK_CPU_SLOWDOWN ?? 1);
  if (!Number.isFinite(cpuSlowdown) || cpuSlowdown < 1) throw new Error("LOOK_CPU_SLOWDOWN must be a finite number >= 1");
  await mkdir(options.out, { recursive: true });
  // Keep each invocation separate: a blocked run must never inherit old green screenshots.
  const directory = await mkdtemp(join(options.out, "run-"));
  const report = { status: "running", startedAt: new Date().toISOString(), options: { scenes: options.selected.map(scene => scene.name), themes: options.themes, widths: options.widths, heights: options.heights, scale: options.scale ?? 1, locale: options.locale }, results: [], contactSheets: [], errors: [] };
  report.cpuSlowdown = cpuSlowdown;
  let server, browser;
  const save = () => saveReport(directory, report);
  try {
    let puppeteer;
    try { puppeteer = (await import(pathToFileURL(requireFromApp.resolve("puppeteer-core")).href)).default; }
    catch (error) {
      if (error.code !== "MODULE_NOT_FOUND" && error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      report.status = "blocked";
      throw new Error(`Missing ${REQUIRED_PUPPETEER} in app/node_modules. Offline browser verification stopped. Provide that devDependency before retrying; no download was attempted.`);
    }
    const executablePath = browserPath();
    report.executablePath = executablePath;
    const { createServer } = await import(pathToFileURL(requireFromApp.resolve("vite")).href);
    const fixture = JSON.parse(await readFile(join(import.meta.dirname, "fixture.json"), "utf8"));
    let desktopResponses = {}, hostFeed, hostFixture, hostImages;
    if (needsDesktopFixture(options.selected)) {
      // Render the production bridge shell/bootstrap, replacing only remote RFB.
      const python = corePython();
      const source = join(import.meta.dirname, "fixtures/desktop-upstream.html.txt");
      const { stdout } = await promisify(execFile)(python, ["-c", "import json,sys; from pathlib import Path; from raphael_core.computer.viewer import embedded_page,BOOTSTRAP,HOST_PAGE,HOST_SCRIPT; print(json.dumps({'page':embedded_page(Path(sys.argv[1]).read_text(encoding='utf-8')).decode(),'bootstrap':BOOTSTRAP.decode(),'host':HOST_PAGE.decode(),'host_script':HOST_SCRIPT.decode()}))", source], { windowsHide: true, env: { ...process.env, PYTHONPATH: join(app, "../core/src"), PYTHONDONTWRITEBYTECODE: "1" } });
      const bridge = JSON.parse(stdout), base = "/scripts/look/fixtures/";
      desktopResponses = {
        [base + "desktop.html"]: { contentType: "text/html", body: bridge.page },
        [base + "bridge.js"]: { contentType: "text/javascript", body: bridge.bootstrap },
        [base + "host.html"]: { contentType: "text/html", body: bridge.host },
        [base + "host.js"]: { contentType: "text/javascript", body: bridge.host_script },
        [base + "control"]: { contentType: "application/json", body: JSON.stringify({ held: true }) },
        [base + "connection"]: { contentType: "application/json", body: JSON.stringify({ held: false, path: "/synthetic-rfb" }) },
        [base + "core/rfb.js"]: { contentType: "text/javascript", body: await readFile(join(import.meta.dirname, "fixtures/desktop-rfb.js"), "utf8") },
      };
    }
    // LOOK_PAGE_FILE shows any page (one a member wrote, read from elsewhere) in the base page's place, wrapped by the real
    // core, to see it in the app's frame at every width and theme; a page of the owner's never becomes a fixture.
    if (options.selected.some(scene => scene.fixture?.pageBase)) fixture.pageBaseDocs = await pageBaseDocuments(process.env.LOOK_PAGE_FILE ? await readFile(process.env.LOOK_PAGE_FILE, "utf8") : fixture.pageBaseHtml);
    if (options.selected.some(scene => scene.fixture?.pageWindow)) fixture.pageWindowDocs = await pageBaseDocuments(fixture.pageWindowHtml);
    // A two-column page whose rail is one window tall and sticky, its buttons at the rail's foot (R-PAGE-10).
    if (options.selected.some(scene => scene.fixture?.pageRail)) fixture.pageRailDocs = await pageBaseDocuments(fixture.pageRailHtml);
    // A checklist page as the core serves it, with nothing left on it and with what the owner left on it (R-PAGE-14).
    if (options.selected.some(scene => scene.fixture?.pageState)) {
      const { html, saved } = JSON.parse(await readFile(join(import.meta.dirname, "fixtures/page-state.json"), "utf8"));
      fixture.pageStateDocs = { fresh: await pageBaseDocuments(html), saved: await pageBaseDocuments(html, undefined, saved) };
    }
    if (options.selected.some(scene => scene.fixture?.coreFixtures)) Object.assign(fixture, await coreFixtures());
    // Match avatar_get's data URL contract using the full-resolution public fixture artwork.
    if (fixture.avatar?.url?.startsWith('/brand/')) fixture.avatar.url = `data:image/png;base64,${(await readFile(join(app, 'public', fixture.avatar.url))).toString('base64')}`;
    // Recorded public artwork keeps catalog URLs realistic while the look run stays offline.
    const imageResponses = Object.fromEntries(await Promise.all(Object.entries(fixture.imageResponses ?? {}).map(async ([url, file]) =>
      [url, await readFile(join(import.meta.dirname, file))])));
    const translations = await readFile(join(app, "src/main/i18n/zh-TW.ts"), "utf8");
    // Words a Chinese window may show in Latin letters: the synthetic data's own, and names of products and keys.
    const latinFor = (scene, locale) => sceneLatinNames(scene, locale, fixture);
    const namespaces = [...new Set([...translations.matchAll(/"([a-z][A-Za-z0-9]*)\.[^"\n]+"\s*:/g)].map(match => match[1]))];
    if (options.selected.some(scene => scene.fixture?.desktop?.transport === "host")) {
      const images = await Promise.all(["host-page.jpg", "host-popup.jpg"].map(name => readFile(join(import.meta.dirname, "fixtures", name))));
      hostImages = images.map(image => image.toString("base64"));
      hostFeed = { name: "look-host-frames", configureServer(server) {
        server.middlewares.use("/scripts/look/fixtures/host-frames", (_request, response) => {
          response.writeHead(200, { "Content-Type": "application/x-ndjson" });
          // The real canvas keeps reading until its viewer closes.
          const current = hostFixture;
          current.responses.add(response);
          response.on("close", () => current.responses.delete(response));
          writeHostFrame(current, hostImages);
        });
      } };
    }
    server = await createServer({ configFile: false, root: app, cacheDir: join(directory, "vite-cache"), plugins: hostFeed ? [hostFeed] : [], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [app, modulesRoot(app)] } } });
    await server.listen();
    await warmupEntries(server, options.selected.map(scene => scene.entry || "index.html"), entry => readFile(join(app, entry), "utf8"));
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    // Another pixel ratio is the browser's own, as a screen at 125% gives it: an emulated one places pictures on whole CSS
    // pixels and resamples them in between, which a real one does not (measured), so it would show blur the app does not have.
    const scaled = (options.scale ?? 1) !== 1;
    browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: join(directory, "browser-profile"), args: scaled ? [...BROWSER_ARGS, `--force-device-scale-factor=${options.scale}`] : BROWSER_ARGS, timeout: 60000 });
    report.browser = await browser.version();
    for (const scene of options.selected) for (const theme of options.themes) for (const width of options.widths) {
      const page = await browser.newPage();
      const hostTabs = scene.fixture?.hostTabs;
      const host = hostFixture = {
        model: { shown: hostTabs === "popup" ? "popup" : "library", back: hostTabs === "popup", forward: false,
          tabs: fixture.hostBrowserTabs.filter(tab => hostTabs === "many" ? tab.id !== "popup" : tab.id === "library" ||
            tab.id === "agenda" || hostTabs === "popup" && tab.id === "popup"),
          // A page's JavaScript dialog, which a headless Chrome never draws (#336).
          ...(scene.fixture?.hostDialog ? { dialog: { dialog_id: "look-dialog", type: scene.fixture.hostDialog,
            ...(scene.fixture.hostDialog === "prompt" ? { message: "請輸入寄到手機的 6 位數驗證碼，完成後頁面會繼續。", default_prompt: "" }
              // Past 2000 characters the core keeps the first and last thousand and says how many are left out.
              : { message: `${"以下是這筆訂單的條款與退貨說明，請閱讀後再繼續。".repeat(50).slice(0, 1000)}\n…\n${
                (("退貨須在七天內提出申請，運費由買方負擔。").repeat(60) + "確定要付款 NT$1,200 嗎？").slice(-1000)}`, omitted: 1712 }) } } : {}),
          // The site's sign-in prompt and the page's file chooser, which Chrome hands over instead of drawing them.
          ...(scene.fixture?.hostAuth ? { auth: { auth_id: "look-auth", origin: "https://intranet.example.invalid", realm: "員工入口網站", scheme: "basic" } } : {}),
          ...(scene.fixture?.hostChooser ? { chooser: { chooser_id: "look-chooser", mode: scene.fixture.hostChooser } } : {}) },
        responses: new Set(),
      };
      const runtimeErrors = [];
      let profiler;
      const result = { scene: scene.name, theme, width, height: options.heights[width] ?? 900, locale: options.locale, runtimeErrors, image: null, failed: true };
      report.results.push(result);
      const error = (kind, message) => runtimeErrors.push({ kind, message });
      page.on("pageerror", value => error("exception", value.message));
      const favicon = url => url && requestDisposition(url, origin) === "empty";
      page.on("console", message => { if ((message.type() === "error" || (message.type() === "warn" && message.text().includes("A locale listener could not refresh"))) && !favicon(message.location().url)) error("console", message.text()); });
      const requestFailures = navigationRequests(page);
      page.on("response", response => { if (response.status() >= 400 && !favicon(response.url())) error("http", `${response.status()} ${response.url()}`); });
      try {
        await page.setViewport({ width, height: options.heights[width] ?? 900, deviceScaleFactor: scaled ? 0 : 1 });
        await page.emulateTimezone("Asia/Taipei");
        // A scene about a Mac (`mac`) runs as on one whatever the host: the page tells its platform from the user agent.
        if (scene.fixture?.mac) await page.setUserAgent((await browser.userAgent()).replace(/\([^)]*\)/, "(Macintosh; Intel Mac OS X 10_15_7)"));
        // Still frames by default; a scene about something that moves turns motion on and holds it with `freeze-motion`.
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: scene.motion ? "no-preference" : "reduce" }, { name: "prefers-color-scheme", value: theme }]);
        await page.setRequestInterception(true);
        // The window's own media protocol (media_protocol.rs): a stored id the shell granted, answered with the bytes the mock holds
        // and the native headers (a year-long immutable cache lifetime, the id as ETag, byte ranges). Each request is counted.
        if (scene.fixture?.browserCache) await page.setCacheEnabled(true);
        page.on("request", request => {
          const url = request.url();
          if (url.startsWith("http://raphael-media.localhost/")) {
            const id = decodeURIComponent(new URL(url).pathname.slice(1)), range = request.headers().range ?? null;
            (result.mediaRequests ??= []).push({ id, range, type: request.resourceType() });
            void (request.frame() ?? page.mainFrame()).evaluate(stored => window.__lookMedia?.(stored) ?? null, id).then(file => {
              if (!file) return request.respond({ status: 404, headers: { "Cache-Control": "no-store" }, body: "" });
              const bytes = Buffer.from(file.data, "base64"), length = bytes.length;
              const headers = { "Content-Type": file.mime, "Cache-Control": "private, max-age=31536000, immutable", ETag: `"${id}"`, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Timing-Allow-Origin": "*" };
              const match = range && /^bytes=(\d*)-(\d*)/.exec(range);
              if (!match) return request.respond({ status: 200, headers, body: bytes });
              let start = match[1] === "" ? Math.max(0, length - Number(match[2])) : Number(match[1]);
              let end = match[1] === "" || match[2] === "" ? length - 1 : Math.min(Number(match[2]), length - 1);
              if (start >= length || end < start) return request.respond({ status: 416, headers: { "Content-Range": `bytes */${length}` }, body: "" });
              end = Math.min(end, start + 2 * 1024 * 1024 - 1);
              return request.respond({ status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${length}` }, body: bytes.subarray(start, end + 1) });
            }).catch(() => request.abort().catch(() => {}));
            return;
          }
          if (url.startsWith("https://images.example.test/")) {
            (result.consentedImages ??= []).push({ url, referrer: request.headers().referer ?? null });
            if (request.headers().referer) error("privacy", "Markdown image sent a referrer");
          }
          const disposition = requestDisposition(url, origin);
          const desktopResponse = url.startsWith(origin + "/") && desktopResponses[new URL(url).pathname];
          if (url === origin + "/scripts/look/fixtures/host-browser") {
            if (request.method() === "POST") {
              const { action, tab, url: address } = JSON.parse(request.postData());
              if (action === "select" || action === "navigate") host.model.shown = tab;
              if (action === "dialog") delete host.model.dialog;
              if (action === "auth") delete host.model.auth;
              if (action === "upload" || action === "chooser") delete host.model.chooser;
              if (action === "navigate") host.model.tabs = host.model.tabs.map(row => row.id === tab ? { ...row, url: address } : row);
              if (action === "close") {
                host.model.tabs = host.model.tabs.filter(row => row.id !== tab);
                if (host.model.shown === tab) host.model.shown = host.model.tabs[0]?.id;
              }
              (result.hostActions ??= []).push({ action, tab });
              writeHostFrame(host, hostImages);
              void request.respond({ status: 204 }).catch(() => {});
            } else void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(host.model) }).catch(() => {});
          } else if (url === origin + "/scripts/look/fixtures/host-input") {
            const { type } = JSON.parse(request.postData());
            void request.frame().evaluate(kind => {
              if (kind === 'mousePressed' || kind === 'mouseReleased') (window.__desktopPointerEvents ??= []).push(kind);
              if (kind === 'keyDown') window.__desktopAcceptedKeys = (window.__desktopAcceptedKeys ?? 0) + 1;
            }, type)
              .then(() => request.respond({ status:204 })).catch(() => {});
          } else if (desktopResponse && new URL(url).pathname.endsWith('/control')) {
            void request.frame().evaluate(() => window.__desktopAcceptedInputs ?? 0).then(input_sequence => request.respond({ status:200, contentType:'application/json', body:JSON.stringify({held:!scene.fixture?.desktopUnconfirmed,input_sequence}) })).catch(() => {});
          } else if (desktopResponse) void request.respond({ status: 200, ...desktopResponse }).catch(() => {});
          else if (imageResponses[url] && request.resourceType() === "image") void request.respond({ status: 200, contentType: "image/svg+xml", body: imageResponses[url] }).catch(() => {});
          else if (disposition === "empty") void request.respond({ status: 204 }).catch(() => {});
          else if (disposition === "continue") void request.continue().catch(() => {});
          else { error("network", `External request blocked: ${url}`); void request.abort().catch(() => {}); }
        });
        await page.evaluateOnNewDocument(installMock, fixture, { fixture: scene.fixture, theme, locale: options.locale });
        await page.evaluateOnNewDocument(now => {
          const NativeDate = Date;
          window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return window.__look.now ?? now; }
          };
          window.addEventListener("unhandledrejection", event => { window.__look.errors.push(`Unhandled rejection: ${String(event.reason)}`); });
        }, scene.fixture?.desktopHour === undefined ? fixture.now : Date.UTC(2026, 10, 3, scene.fixture.desktopHour - 8));
        // One browser profile serves the whole run: a scene starts from the storage its own steps make, never from
        // what an earlier scene left there (a collapsed member column hid the rooms of the scene after it).
        const storage = await page.createCDPSession();
        await storage.send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,session_storage" });
        if (cpuSlowdown > 1) await storage.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
        // Keep the emulation session attached until page.close() ends the stress run.
        if (cpuSlowdown === 1) await storage.detach();
        // A scene that measures a pane's resize counts every ResizeObserver callback of the page (`window.__resizeRuns`, resize-probe.mjs).
        if (scene.steps.some(step => step.action === "resize-probe")) {
          await page.evaluateOnNewDocument(() => {
            const Real = window.ResizeObserver;
            window.__resizeRuns = 0;
            window.ResizeObserver = class extends Real { constructor(callback) { super((entries, observer) => { window.__resizeRuns++; callback(entries, observer); }); } };
          });
        }
        if (scene.steps.some(step => step.measure)) {
          await page.evaluateOnNewDocument(() => {
            window.__lookLongTasks = [];
            const record = entries => window.__lookLongTasks.push(...entries.map(task => task.toJSON()));
            window.__lookLongTaskObserver = new PerformanceObserver(list => record(list.getEntries()));
            window.__lookLongTaskObserver.observe({ type: "longtask", buffered: true });
          });
          if (process.env.LOOK_PROFILE === "1") {
            profiler = await page.createCDPSession();
            await profiler.send("Performance.enable");
            await profiler.send("Profiler.enable");
            await profiler.send("Profiler.setSamplingInterval", { interval: 100 });
            await profiler.send("Profiler.start");
          }
        }
        // App readiness and decoded images gate capture. Network-idle also waits
        // for unrelated polling and reloads, which do not establish readiness.
        await page.goto(`${origin}/${scene.entry ?? ""}`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForSelector(scene.ready ?? (scene.entry === "overlay.html" ? "#progress:not([hidden])" : scene.fixture.onboarding ? '#ob:not([hidden]) [data-ob="next"]' : '.page-agent:not([hidden]) .conversation-trigger'), { visible: true, timeout: 10000 });
        // The app opens on its chief of staff's conversation (Raphael's own when no slime exists yet). Scenes begin in Raphael's
        // space, where the fixture's conversation and its quick questions are, reached as the owner reaches it: the account menu's
        // entry. A scene that must see the app's own start says `start: "app"` in its fixture.
        if (!scene.entry && !scene.fixture.onboarding && scene.fixture.start !== "app") {
          await perform(page, { action: "account-menu", item: "raphael" }, directory);
          await page.waitForFunction(() => !document.querySelector('.mb-col [aria-current="true"]'), { timeout: 10000 });
        }
        for (const step of scene.steps) {
          const trace = process.env.LOOK_TRACE === "1" && step.measure
            ? `${scene.name}-${theme}-${width}-${step.measure.name}.trace.json` : null;
          if (trace) await page.tracing.start({ path: join(directory, trace), categories: ["toplevel", "devtools.timeline", "blink.user_timing", "blink_gc", "v8", "v8.execute", "disabled-by-default-v8.cpu_profiler", ...(step.action === "typing-probe" ? ["disabled-by-default-devtools.timeline.invalidationTracking", "disabled-by-default-devtools.timeline.stack"] : [])] });
          let assertion;
          try { assertion = await perform(page, step, directory); }
          catch (error) {
            if (error.assertion) (result.assertions ??= []).push(error.assertion);
            throw error;
          }
          finally {
            if (trace) {
              await page.tracing.stop();
              (result.traces ??= []).push(trace);
            }
          }
          if (assertion?.check === 'desktop-host-toolbar-navigation' &&
              !result.hostActions?.some(action => action.action === 'navigate')) {
            throw new Error('The Chrome toolbar never sent its navigation request');
          }
          if (assertion?.check) (result.assertions ??= []).push(assertion);
        }
        await page.evaluate(decodeVisibleImages);
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (value) {
        error("scene", value.message);
        result.diagnostics = await page.evaluate(() => ({ messages: [...document.querySelectorAll('.message-text, .ans, .ra')].map(el => ({ tag: el.tagName, class: el.className, parent: el.parentElement?.outerHTML.slice(0, 500) })) })).catch(() => null);
      }
      try {
        if (profiler) {
          const { metrics } = await profiler.send("Performance.getMetrics");
          result.profileNavigationStart = metrics.find(metric => metric.name === "NavigationStart")?.value;
          const { profile } = await profiler.send("Profiler.stop");
          result.profile = `${scene.name}-${theme}-${width}.cpuprofile`;
          await writeFile(join(directory, result.profile), JSON.stringify(profile));
          await profiler.detach();
          profiler = null;
        }
        if (scene.steps.some(step => step.measure)) result.longTasks = await page.evaluate(() => {
          const pending = window.__lookLongTaskObserver?.takeRecords() ?? [];
          window.__lookLongTaskObserver?.disconnect();
          return [...(window.__lookLongTasks ?? []), ...pending.map(task => task.toJSON())];
        });
        const actualLocale = await page.evaluate(() => document.documentElement.lang || "zh-TW");
        result.locale = actualLocale;
        // A scene marked `file` ends on a file the app saved, opened on its own (the `saved-file` step): none of the
        // app's own checks reach into it, and its boundary was read before it was left.
        const englishUI = actualLocale === "zh-TW" && !scene.name.startsWith("overlay-") && !scene.file ? await page.evaluate(async () => {
          const [{ en }, { zhTW }] = await Promise.all([import('/src/main/i18n/en.ts'), import('/src/main/i18n/zh-TW.ts')]);
          // Brand/key names and deliberately shared CTA decisions have identical values.
          return [...new Set(Object.entries(en).filter(([key, value]) => typeof value === 'string' && /[A-Za-z]/.test(value) && !/[<{}]/.test(value) && /[\u3400-\u9fff]/.test(zhTW[key] ?? '') && value !== zhTW[key]).map(([, value]) => value.trim()))];
        }) : [];
        // The ⋯ buttons that no row of the app's own table (context-menu.ts) reaches with a right click: R-UI-44.
        const unreached = scene.entry || scene.file ? [] : await page.evaluate(async () => {
          const { uncoveredOverflows } = await import('/src/main/context-menu.ts');
          return uncoveredOverflows(document).map(button => ({ tag: "button", id: button.id, class: button.className, text: button.getAttribute("aria-label") ?? "" }));
        });
        result.viewport=page.viewport();
        Object.assign(result, await page.evaluate(auditDocument, undefined, result.viewport, namespaces, latinFor(scene, actualLocale), englishUI, unreached));
        if (!scene.entry && !scene.file) {
          for (const name of ["content-width", "thread-edges", "message-no-inner-scroll", "message-no-raw-envelope"]) {
            try { (result.assertions ??= []).push(await page.evaluate(checkRendered, name)); }
            catch (value) { error("layout", value.message); }
          }
        }
        // On a Mac the main window's page lies under macOS's own traffic lights: they are drawn where macOS puts them,
        // and a control, face or word under them fails the scene (traffic-lights.mjs).
        if (!scene.entry && !scene.file && await page.evaluate(() => document.documentElement.dataset.platform === "macos")) {
          const lights = trafficLights(app);
          const covered = await page.evaluate(coveredByTrafficLights, lights);
          if (covered.length) error("layout", `under the macOS traffic lights: ${covered.join(", ")}`);
          await page.evaluate(drawTrafficLights, lights);
        }
        if (!scene.entry && !scene.file && await page.evaluate(() => [...document.querySelectorAll('.conversation-card')].some(card => !card.closest('[hidden]')))) {
          try { (result.assertions ??= []).push(await page.evaluate(checkRendered, "card-shell")); }
          catch (value) { error("layout", value.message); }
        }
        const mockErrors = scene.file ? [] : await page.evaluate(() => window.__look?.errors ?? ["Mock boundary was not installed"]);
        for (const message of mockErrors) error("ipc", message);
        const image = `${scene.name}-${theme}-${width}.png`;
        await page.screenshot({ path: join(directory, image), type: "png" });
        result.image = image;
        if (scene.afterCapture && !result.runtimeErrors?.some(error => error.kind === "scene")) {
          try {
            for (const step of scene.afterCapture) {
              const assertion = await perform(page, step, directory);
              if (assertion?.check) (result.assertions ??= []).push(assertion);
            }
          } catch (value) {
            if (value.assertion) (result.assertions ??= []).push(value.assertion);
            error("scene", value.message);
          }
          const errors = await page.evaluate(() => window.__look.errors);
          for (const message of errors.slice(mockErrors.length)) error("ipc", message);
        }
        if (scene.captureColumn) {
          const height = await page.evaluate(() => Math.min(6000, Math.ceil(document.querySelector('.thread')?.scrollHeight ?? document.querySelector('.ra-body')?.closest('.thread')?.scrollHeight ?? document.querySelector('.mb-chat')?.scrollHeight ?? 4000) + 300));
          await page.setViewport({width, height: Math.max(height, 4000)});
          const columnImage = `${scene.name}-${theme}-${width}-column.png`;
          await page.screenshot({path: join(directory, columnImage), type: "png"});
          result.columnImage = columnImage;
        }
        const failures = requestFailures();
        result.navigationAborts = failures.filter(failure => failure.superseded);
        for (const failure of failures) {
          // Closing a watched Chrome tab cancels its open frame response.
          const viewerClosed = failure.url === origin + "/scripts/look/fixtures/host-frames" && failure.message.endsWith("net::ERR_ABORTED");
          if (!failure.superseded && !favicon(failure.url) && !viewerClosed) error("request", failure.message);
        }
        result.failed = failedChecks(result);
      } catch (value) { error("capture", value.message); }
      finally { await page.close(); }
      console.log(`${result.failed ? "FAIL" : "PASS"} ${scene.name} ${theme} ${width}`);
      await save();
    }
    report.contactSheets = await contactSheets(browser, report.results, directory);
    report.status = report.results.some(result => result.failed) ? "failed" : "passed";
  } catch (value) {
    if (report.status !== "blocked") report.status = "failed";
    report.errors.push(value.message);
    console.error(value.message);
  } finally {
    try { await browser?.close(); } catch (error) { report.status = "failed"; report.errors.push(`Browser cleanup: ${error.message}`); }
    try { await server?.close(); } catch (error) { report.status = "failed"; report.errors.push(`Vite cleanup: ${error.message}`); }
    report.finishedAt = new Date().toISOString();
    await save();
    console.log(`Report: ${join(directory, "report.json")}`);
  }
  return report.status === "passed" ? 0 : 1;
}
