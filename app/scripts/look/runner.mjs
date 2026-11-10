import { existsSync } from "node:fs";
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

/** Product, model, unit, key names and external menu paths that stay in Latin letters in every language. */
// Docker and the supported tunnel services keep their product names in every locale.
export const LATIN_NAMES = ["Raphael", "Docker", "Docker Desktop", "Rimuru", "Google", "Gmail", "Calendar", "Composio", "OpenRouter", "OpenAI", "ChatGPT", "Anthropic", "Claude", "Codex", "Gemini", "GPT", "Grok", "Telegram", "Slack", "Discord", "Notion", "GitHub", "Mobbin", "MCP", "API", "URL", "CLI", "SSH", "STT", "PDF", "WAV", "CSV", "JSON", "US", "KB", "MB", "GB", "GMT", "AM", "PM", "Alt", "AltGr", "Ctrl", "Shift", "Space", "Esc", "Enter", "Tab", "Win", "Windows", "Fn", "Edge", "Chrome", "macOS", "Whisper", "Typeless", "Tailscale", "Funnel", "Cloudflare", "Tunnel", "ngrok", "Webhook", "HMAC", "SHA", "Signature", "Hermes", "Simple", "Icons", "Bearer", "mcpServers", "Ollama", "Linear", "BotFather", "newbot", "English", "MIT", "JPG", "WebP", "GIF", "UTF", "Big", "txt", "px", "token", "Claude Code", "Opus", "Sonnet", "Antigravity", "KEY=value", "Settings → Project Settings → API Keys"];

LATIN_NAMES.push("1Password");
// The shell a host repair is pasted into on Windows is named as Windows names it.
LATIN_NAMES.push("PowerShell");

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
export const REQUIRED_PUPPETEER = "puppeteer-core@25.13.0";

export const needsDesktopFixture = selected => selected.some(scene => scene.fixture?.desktop || scene.fixture?.cardDeck || scene.name.startsWith("desktop-") || scene.name === "chat-computer-takeover");

export function browserPath() {
  const candidates = [process.env.LOOK_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) throw new Error("Installed Edge/Chrome not found; set LOOK_BROWSER to its executable path.");
  return found;
}

export async function run(options) {
  const cpuSlowdown = Number(process.env.LOOK_CPU_SLOWDOWN ?? 1);
  if (!Number.isFinite(cpuSlowdown) || cpuSlowdown < 1) throw new Error("LOOK_CPU_SLOWDOWN must be a finite number >= 1");
  await mkdir(options.out, { recursive: true });
  // Keep each invocation separate: a blocked run must never inherit old green screenshots.
  const directory = await mkdtemp(join(options.out, "run-"));
  const report = { status: "running", startedAt: new Date().toISOString(), options: { scenes: options.selected.map(scene => scene.name), themes: options.themes, widths: options.widths, heights: options.heights, locale: options.locale }, results: [], contactSheets: [], errors: [] };
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
    let desktopResponses = {};
    if (needsDesktopFixture(options.selected)) {
      // Render the production bridge shell/bootstrap, replacing only remote RFB.
      const python = process.env.RAPHAEL_CORE_PYTHON || join(app, "../core/.venv/Scripts/python.exe");
      const source = join(import.meta.dirname, "fixtures/desktop-upstream.html.txt");
      const { stdout } = await promisify(execFile)(python, ["-c", "import json,sys; from pathlib import Path; from raphael_core.computer.viewer import embedded_page,BOOTSTRAP; print(json.dumps({'page':embedded_page(Path(sys.argv[1]).read_text(encoding='utf-8')).decode(),'bootstrap':BOOTSTRAP.decode()}))", source], { windowsHide: true, env: { ...process.env, PYTHONPATH: join(app, "../core/src"), PYTHONDONTWRITEBYTECODE: "1" } });
      const bridge = JSON.parse(stdout), base = "/scripts/look/fixtures/";
      desktopResponses = {
        [base + "desktop.html"]: { contentType: "text/html", body: bridge.page },
        [base + "bridge.js"]: { contentType: "text/javascript", body: bridge.bootstrap },
        [base + "control"]: { contentType: "application/json", body: JSON.stringify({ held: true }) },
        [base + "connection"]: { contentType: "application/json", body: JSON.stringify({ held: false, path: "/synthetic-rfb" }) },
        [base + "core/rfb.js"]: { contentType: "text/javascript", body: await readFile(join(import.meta.dirname, "fixtures/desktop-rfb.js"), "utf8") },
      };
    }
    // Match avatar_get's data URL contract using the full-resolution public fixture artwork.
    if (fixture.avatar?.url?.startsWith('/brand/')) fixture.avatar.url = `data:image/png;base64,${(await readFile(join(app, 'public', fixture.avatar.url))).toString('base64')}`;
    // Recorded public artwork keeps catalog URLs realistic while the look run stays offline.
    const imageResponses = Object.fromEntries(await Promise.all(Object.entries(fixture.imageResponses ?? {}).map(async ([url, file]) =>
      [url, await readFile(join(import.meta.dirname, file))])));
    const translations = await readFile(join(app, "src/main/i18n/zh-TW.ts"), "utf8");
    // Words a Chinese window may show in Latin letters: the synthetic data's own, and names of products and keys.
    const latinFor = (scene, locale) => sceneLatinNames(scene, locale, fixture);
    const namespaces = [...new Set([...translations.matchAll(/"([a-z][A-Za-z0-9]*)\.[^"\n]+"\s*:/g)].map(match => match[1]))];
    server = await createServer({ configFile: false, root: app, cacheDir: join(directory, "vite-cache"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [app] } } });
    await server.listen();
    await warmupEntries(server, options.selected.map(scene => scene.entry || "index.html"), entry => readFile(join(app, entry), "utf8"));
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: join(directory, "browser-profile"), args: BROWSER_ARGS, timeout: 60000 });
    report.browser = await browser.version();
    for (const scene of options.selected) for (const theme of options.themes) for (const width of options.widths) {
      const page = await browser.newPage();
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
        await page.setViewport({ width, height: options.heights[width] ?? 900, deviceScaleFactor: 1 });
        await page.emulateTimezone("Asia/Taipei");
        // Still frames by default; a scene about something that moves turns motion on and holds it with `freeze-motion`.
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: scene.motion ? "no-preference" : "reduce" }, { name: "prefers-color-scheme", value: theme }]);
        await page.setRequestInterception(true);
        page.on("request", request => {
          const url = request.url();
          if (url.startsWith("https://images.example.test/")) {
            (result.consentedImages ??= []).push({ url, referrer: request.headers().referer ?? null });
            if (request.headers().referer) error("privacy", "Markdown image sent a referrer");
          }
          const disposition = requestDisposition(url, origin);
          const desktopResponse = url.startsWith(origin + "/") && desktopResponses[new URL(url).pathname];
          if (desktopResponse && new URL(url).pathname.endsWith('/control')) {
            void request.frame().evaluate(() => window.__desktopAcceptedInputs ?? 0).then(input_sequence => request.respond({ status:200, contentType:'application/json', body:JSON.stringify({held:true,input_sequence}) })).catch(() => {});
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
        await page.waitForSelector(scene.ready ?? (scene.entry === "overlay.html" ? "#progress:not([hidden])" : scene.fixture.onboarding ? '#ob:not([hidden]) [data-ob="next"]' : '.page-home:not([hidden]) .ho-hero'), { visible: true, timeout: 10000 });
        // Existing conversation journeys enter through the real rail after the home is ready.
        if (!scene.entry && !scene.fixture.onboarding && !scene.name.startsWith("home")) {
          await perform(page, { action: "click", selector: '.mb-chief' });
          await page.waitForSelector('.page-agent:not([hidden]) .conversation-trigger', { visible: true, timeout: 10000 });
        }
        for (const step of scene.steps) {
          const trace = process.env.LOOK_TRACE === "1" && step.measure
            ? `${scene.name}-${theme}-${width}-${step.measure.name}.trace.json` : null;
          if (trace) await page.tracing.start({ path: join(directory, trace), categories: ["toplevel", "devtools.timeline", "blink.user_timing", "blink_gc", "v8", "v8.execute", "disabled-by-default-v8.cpu_profiler"] });
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
        if (!scene.entry && !scene.file && await page.evaluate(() => [...document.querySelectorAll('.conversation-card')].some(card => !card.closest('[hidden]')))) {
          try { (result.assertions ??= []).push(await page.evaluate(checkRendered, "card-shell")); }
          catch (value) { error("layout", value.message); }
        }
        const mockErrors = scene.file ? [] : await page.evaluate(() => window.__look?.errors ?? ["Mock boundary was not installed"]);
        for (const message of mockErrors) error("ipc", message);
        const image = `${scene.name}-${theme}-${width}.png`;
        await page.screenshot({ path: join(directory, image), type: "png" });
        result.image = image;
        if (scene.captureColumn) {
          const height = await page.evaluate(() => Math.min(6000, Math.ceil(document.querySelector('.thread')?.scrollHeight ?? document.querySelector('.ra-body')?.closest('.thread')?.scrollHeight ?? document.querySelector('.mb-chat')?.scrollHeight ?? 4000) + 300));
          await page.setViewport({width, height: Math.max(height, 4000)});
          const columnImage = `${scene.name}-${theme}-${width}-column.png`;
          await page.screenshot({path: join(directory, columnImage), type: "png"});
          result.columnImage = columnImage;
        }
        const failures = requestFailures();
        result.navigationAborts = failures.filter(failure => failure.superseded);
        for (const failure of failures) if (!failure.superseded && !favicon(failure.url)) error("request", failure.message);
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
