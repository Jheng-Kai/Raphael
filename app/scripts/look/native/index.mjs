import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile, readFile, copyFile, rm, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";
import { parseOptions } from "../options.mjs";
import { saveReport } from "../report.mjs";
import { contactSheets } from "../contact-sheet.mjs";
import { BROWSER_ARGS, browserPath } from "../runner.mjs";
import { launch, stopOwned, connectWebView, freePort } from "./process.mjs";
import { collectErrors, paidRequests, toastError } from "./errors.mjs";
import { prepareVoiceSample, requireVoiceModels } from "./audio.mjs";
import { drive, journeys, pause, nativeLaunches, startupEvidence } from "./journeys.mjs";
import { decodeVisibleImages, settleMotion } from "../driver.mjs";

const execute = promisify(execFile);
const app = resolve(import.meta.dirname, "../../.."), root = resolve(app, "..");
const raw = process.argv.slice(2), keep = raw.includes("--keep");
try {
  const args = raw.filter(arg => arg !== "--keep");
  const options = parseOptions(args, journeys);
  if (options.help) console.log("npm run native -- <journey...> [--keep] [--list] [--out directory]\nRequires an offline debug build; see scripts/look/README.md. --keep retains the CDP profile; all started processes still close.");
  else if (options.list) for (const journey of journeys) console.log(`${journey.name.padEnd(24)}${journey.description}`);
  else {
    if (!options.names.length || options.all) throw new Error("Select explicit native journeys; gmail-connect is owner-only and is never implicit");
    process.exitCode = await run({ ...options, out: args.includes("--out") ? options.out : join(app, ".native"), keep });
  }
} catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }

async function run(options) {
  const selected = nativeLaunches(options.selected);
  await mkdir(options.out, { recursive: true });
  const directory = await mkdtemp(join(options.out, "run-"));
  const report = { mode: "native", startedAt: new Date().toISOString(), directory, keep: options.keep, status: "running", errors: [], results: [], captures: [] };
  if (process.env.RAPHAEL_NATIVE_LOAD) report.hostLoad = JSON.parse(process.env.RAPHAEL_NATIVE_LOAD);
  const save = () => saveReport(directory, report);
  const python = process.env.RAPHAEL_CORE_PYTHON || join(root, "core/.venv/Scripts/python.exe");
  const target = process.env.CARGO_TARGET_DIR || resolve(root, "../.target");
  const executable = process.env.RAPHAEL_NATIVE_BINARY || join(target, "debug/app.exe");
  let owned, browser, interrupted = false;
  const interrupt = () => { interrupted = true; void stopOwned(owned).catch(error => report.errors.push(error.message)); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try {
    report.executable = executable;
    if (process.platform !== "win32") throw new Error("Native journeys require Windows WebView2");
    if (!existsSync(executable)) throw new Error(`Missing debug app: ${executable}; build offline with CARGO_BUILD_JOBS=2`);
    if (!existsSync(python)) throw new Error(`Missing core Python: ${python}; set RAPHAEL_CORE_PYTHON to an installed interpreter`);
    const phrases = await translationPhrases();
    for (const journey of selected) {
      if (interrupted) break;
      const scene = journey.id ?? journey.name;
      const journeyDir = join(directory, scene), data = join(journeyDir, "data");
      await mkdir(data, { recursive: true });
      let log = "";
      const result = { scene, theme: "native", width: 1120, height: 900, failed: true, failures: [], runtimeErrors: [], image: null, data, ...(journey.startup ? { startup: { ...journey.startup } } : {}) };
      report.results.push(result);
      let activePage;
      const env = { ...process.env, RAPHAEL_DATA_DIR: data, RAPHAEL_FAKE_LLM: "1", RAPHAEL_TEST_NATIVE: "1", RAPHAEL_CORE_PYTHON: python, PYTHONPATH: join(root, "core/src"), PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", CARGO_BUILD_JOBS: "2" };
      delete env.RAPHAEL_TEST_NATIVE_GMAIL;
      delete env.RAPHAEL_TEST_NATIVE_HOMES;
      delete env.RAPHAEL_TEST_NATIVE_HOME;
      delete env.RAPHAEL_TEST_NATIVE_WINDOW_LIFECYCLE;
      delete env.RAPHAEL_TEST_NATIVE_STARTUP;
      delete env.RAPHAEL_TEST_NATIVE_CORE_DELAY_MS;
      delete env.RAPHAEL_TEST_NATIVE_ROOMS_FAIL_FIRST;
      if (journey.startup) {
        env.RAPHAEL_TEST_NATIVE_STARTUP = "1";
        env.RAPHAEL_TEST_NATIVE_CORE_DELAY_MS = String(journey.startup.delayMs);
        if (journey.startup.variant === "slow") env.RAPHAEL_TEST_NATIVE_ROOMS_FAIL_FIRST = "1";
      }
      if (journey.name === "hidden-window") {
        env.RAPHAEL_TEST_NATIVE_WINDOW_LIFECYCLE = "1";
        env.RAPHAEL_NATIVE_THINK_S = "4";
      }
      if (journey.name === "home-timing") env.RAPHAEL_TEST_NATIVE_HOME = "1";
      if (journey.name === "openrouter-turn") delete env.RAPHAEL_FAKE_LLM;
      if (journey.name === "owner-words") env.RAPHAEL_TEST_NATIVE_LOCAL = "1";
      if (journey.name === "long-think") env.RAPHAEL_NATIVE_THINK_S = "75";
      if (journey.name === "typing") env.RAPHAEL_NATIVE_THINK_S = "35";
      if (journey.name === "gmail-connect") env.RAPHAEL_TEST_NATIVE_GMAIL = "1";
      if (journey.name === "bot-homes") env.RAPHAEL_TEST_NATIVE_HOMES = "1";
      delete env.RAPHAEL_TEST_NATIVE_CATALOG;
      delete env.RAPHAEL_TEST_NATIVE_COMPUTER;
      delete env.RAPHAEL_TEST_NATIVE_MODEL_PICKER;
      if (journey.name === "model-picker") {
        if (!process.env.RAPHAEL_NATIVE_MODEL_CATALOG) throw new Error("Set RAPHAEL_NATIVE_MODEL_CATALOG to a recorded public GET /api/v1/models response");
        env.RAPHAEL_TEST_NATIVE_MODEL_PICKER = "1";
      }
      if (["member-computer", "office-mission"].includes(journey.name)) env.RAPHAEL_TEST_NATIVE_COMPUTER = "1";
      if (["store-finder", "catalog-connect"].includes(journey.name)) env.RAPHAEL_TEST_NATIVE_CATALOG = "1";
      const database = async (...args) => JSON.parse((await execute(python, [join(import.meta.dirname, "database.py"), data, ...args], { cwd: root, env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout);
      try {
        if (journey.name === "upgrade") {
          if (!process.env.RAPHAEL_NATIVE_UPGRADE_FROM) throw new Error("Set RAPHAEL_NATIVE_UPGRADE_FROM to a copy of an older data folder");
          await cp(process.env.RAPHAEL_NATIVE_UPGRADE_FROM, data, { recursive: true });
        } else await database("init", journey.name);
        if (journey.name === "computer-speed") result.computer = await database("computer-speed");
        if (journey.name === "member-computer") {
          result.computer = await database("vm-smoke");
          const image = "member-computer-tool.png";
          await copyFile(join(journeyDir, "vm-tool-screenshot.png"), join(directory, image));
          const png = await readFile(join(directory, image));
          report.captures.push({ scene: "member-computer/tool", theme: "native", width: png.readUInt32BE(16), height: png.readUInt32BE(20), image, failed: false });
        }
        await writeFile(join(data, "device.json"), JSON.stringify({ onboarded: true, ui_language: "zh-TW", appearance: "light", autostart: false }));
        let audioMs = 0;
        delete env.RAPHAEL_FAKE_AUDIO;
        if (journey.name === "voice-conversation" || journey.name === "voice-keys") {
          const sample = await prepareVoiceSample(journeyDir);
          env.RAPHAEL_FAKE_AUDIO = sample.file;
          env.RAPHAEL_MODELS_DIR = process.env.RAPHAEL_MODELS_DIR || join(process.env.APPDATA, "Raphael/models");
          const { stdout } = await execute(python, ["-c", "import sys,wave; w=wave.open(sys.argv[1]); print(round(w.getnframes()/w.getframerate()*1000))", sample.file], { windowsHide: true });
          audioMs = Number(stdout.trim()); result.audio = { ...sample, milliseconds: audioMs, engine: "local qwen3-asr" };
          // Use the core's registry, before launching the app or attempting speech capture.
          result.modelReadiness = await database("voice-models", env.RAPHAEL_MODELS_DIR);
          requireVoiceModels(result.modelReadiness);
        } else {
          env.RAPHAEL_MODELS_DIR = join(data, "models");
          // VAD is a startup prerequisite even when no speech journey is selected.
          const installed = process.env.RAPHAEL_MODELS_DIR || join(process.env.APPDATA, "Raphael/models");
          await cp(join(installed, "silero-vad"), join(env.RAPHAEL_MODELS_DIR, "silero-vad"), { recursive: true });
        }
        const port = await freePort();
        env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [...BROWSER_ARGS, `--remote-debugging-port=${port}`, "--enable-logging", `--log-file=${join(journeyDir, "webview.log")}`].join(" ");
        result.port = port;
        owned = launch(executable, [], { cwd: app, env, log: value => { log += value.toString(); } });
        result.pid = owned.pid;
        await save();
        browser = await connectWebView(puppeteer, port, owned, 90000, journey.name === "typing" ? 30000 : 5000);
        let page;
        for (let i = 0; i < 100; i++) {
          result.targets = browser.targets().map(target => ({ type: target.type(), url: target.url() }));
          page = (await browser.pages()).find(page => /tauri\.localhost|tauri:\/\/localhost|localhost:1420/.test(page.url()) && !/\/(?:learned|overlay)\.html/.test(page.url()));
          if (page) break;
          await pause(200);
        }
        if (!page) throw new Error(`CDP has no main application target: ${JSON.stringify(result.targets)}`);
        activePage = page;
        result.url = page.url();
        if (!journey.startup) await page.setViewport({ width: 1120, height: 900 });
        await collectErrors(page, result.runtimeErrors);
        if (journey.name === "home-timing") await page.evaluateOnNewDocument(() => {
          window.__homeTiming = { firstPaintMs: null, firstAllowance: null };
          const observer = new MutationObserver(() => {
            const hero = document.querySelector('.page-home:not([hidden]) .ho-hero');
            if (!hero || window.__homeTiming.firstPaintMs !== null) return;
            observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => {
              window.__homeTiming.firstPaintMs = performance.now();
              window.__homeTiming.firstAllowance = document.querySelector('.ho-allowance')?.textContent;
            }));
          });
          observer.observe(document, { childList: true, subtree: true, attributes: true });
        });
        if (!journey.startup) {
          await page.reload({ waitUntil: "domcontentloaded" });
          // Keep every CDP call bounded while the real core imports and starts its workers.
          const readyBy = Date.now() + 90000;
          for (;;) {
            if (await page.$eval("body", body => !!body.querySelector(".page-home:not([hidden]) .ho-hero"))) break;
            if (Date.now() >= readyBy) throw new Error("Native Home did not become ready within 90000ms");
            await pause(200);
          }
        }
        const capture = async (label, target = page) => {
          try { await settleMotion(target); }
          catch (error) { throw new Error(`${journey.name}/${label}: ${error.message}`, { cause: error }); }
          await target.evaluate(decodeVisibleImages);
          const image = `${scene}-${label}.png`;
          await target.screenshot({ path: join(directory, image) });
          result.image = image;
          const viewport = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
          report.captures.push({ scene: `${scene}/${label}`, theme: "native", ...viewport, image, failed: !!(result.runtimeErrors.length || result.failures.length) });
        };
        const rpc = (method, params) => page.evaluate(({ method, params }) => window.__TAURI_INTERNALS__.invoke("core_call", { method, params }), { method, params });
        await drive(journey.name, { page, result, capture, artifacts: journeyDir, learnedPage: async () => (await browser.pages()).find(page => /\/learned\.html/.test(page.url())), windows: () => database("windows", String(owned.pid)), computerOffset: () => database("vm-offset"), computerSignin: member => database("vm-signin", String(member)), snapshot: () => database("snapshot"), nativeLog: () => readFile(join(data, "logs/raphael.log"), "utf8").catch(() => ""), homes: () => database("homes"), memoryHome: member => database("memory-home", String(member)), threadQuery: (member, conversation) => database("thread", String(member), String(conversation)), rpc, audioMs, phrases, catalogApp: process.env.RAPHAEL_NATIVE_APP || "slack",
          typingBaseline: process.env.RAPHAEL_NATIVE_TYPING_BASELINE === "1",
          windowAction: action => database("window-action", String(owned.pid), action),
          modelRequests: async () => (await readFile(join(data, "model-requests.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) });
        await capture("final");
      } catch (error) {
        if (error.code === "NATIVE_MODEL_MISSING") result.blocked = { reason: error.message, models: error.models };
        result.failures.push(error.message);
        if (browser) {
          try {
            const page = (await browser.pages()).find(page => !/devtools|about:blank/.test(page.url()));
            const image = `${scene}-failure.png`;
            if (page) { await page.screenshot({ path: join(directory, image) }); result.image = image; report.captures.push({ scene, theme: "native", width: 1120, image, failed: true }); }
          } catch (error) { result.failures.push(`Failure screenshot: ${error.message}`); }
        }
      } finally {
        // The lifecycle journey keeps CloseRequested's real hide path; terminate only its owned PID below.
        if (activePage && journey.name !== "hidden-window") {
          try {
            await activePage.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
            await Promise.race([owned.closed, pause(2000)]);
          } catch { /* A closing webview can disconnect before its close reply. */ }
        }
        try { await browser?.disconnect(); } catch (error) { result.failures.push(`CDP cleanup: ${error.message}`); }
        browser = null;
        try { await stopOwned(owned); result.cleanup = owned ? "Owned app/core/WebView2 process tree closed by PID" : "No app process was launched"; } catch (error) { result.failures.push(`Process cleanup: ${error.message}`); }
        owned = null;
        if (["member-computer", "office-mission"].includes(journey.name)) {
          try { await database("vm-stop"); result.vmCleanup = "Journey-owned containers removed; workspaces retained"; }
          catch (error) { result.failures.push(`VM cleanup: ${error.message}`); }
        }
        const persistedLog = join(data, "logs/raphael.log");
        if (existsSync(persistedLog)) {
          await copyFile(persistedLog, join(journeyDir, "native.log"));
          log += `\n${await readFile(persistedLog, "utf8")}`;
        }
        await writeFile(join(journeyDir, "app.log"), log);
        if (journey.startup) {
          result.startup.evidence = startupEvidence(log, result.startup.probe);
          for (const message of result.startup.probe?.alerts ?? []) {
            if (toastError(message)) result.runtimeErrors.push({ kind: "toast", message });
          }
        }
        result.cliDiagnosticLog = log.split(/\r?\n/).filter(line => line.includes("Native CLI diagnostic "));
        const costs = paidRequests(log, ["gmail-connect", "store-finder", "catalog-connect"].includes(journey.name), journey.name === "openrouter-turn" ? ["openrouter.ai"] : []);
        if (costs.length) result.failures.push(`Undeclared paid/Composio requests: ${JSON.stringify(costs)}`);
        if (journey.name === "gmail-connect") result.connectorLog = log.split(/\r?\n/).flatMap((line, index, lines) => /connect|composio|card/i.test(line) ? lines.slice(Math.max(0, index - 2), index + 3) : []);
        result.failed = !!(result.failures.length || result.runtimeErrors.length);
        result.status = result.blocked ? "blocked" : result.failed ? "failed" : "passed";
        console.log(`${result.blocked ? "BLOCKED" : result.failed ? "FAIL" : "PASS"} ${scene}: ${result.failures[0] || result.runtimeErrors[0]?.message || "assertions passed"}`);
        await save();
      }
    }
    // The app is closed before the contact-sheet renderer starts (one heavy process at a time).
    if (report.captures.length) {
      browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, userDataDir: join(directory, "contact-profile"), args: BROWSER_ARGS });
      report.contactSheets = await contactSheets(browser, report.captures, directory);
      await browser.close(); browser = null;
      if (!options.keep) await rm(join(directory, "contact-profile"), { recursive: true, force: true });
    }
  } catch (error) { report.errors.push(error.message); }
  finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    if (owned) { try { await stopOwned(owned); } catch (error) { report.errors.push(error.message); } }
    if (browser) { try { await browser.close(); } catch (error) { report.errors.push(error.message); } }
    report.finishedAt = new Date().toISOString();
    report.startupCounts = Object.fromEntries(["normal", "slow"].map(variant => [variant, { expected: selected.filter(journey => journey.startup?.variant === variant).length, passed: report.results.filter(result => result.startup?.variant === variant && !result.failed).length, failed: report.results.filter(result => result.startup?.variant === variant && result.failed).length }]));
    report.status = report.errors.length || report.results.length !== selected.length || report.results.some(result => result.failed) ? "failed" : "passed";
    await save(); console.log(`Report: ${join(directory, "report.json")}`);
  }
  return report.status === "passed" ? 0 : 1;
}

async function translationPhrases() {
  const catalogs = {};
  for (const locale of ["en", "ja", "zh-TW"]) {
    const source = await readFile(join(app, `src/main/i18n/${locale}.ts`), "utf8");
    catalogs[locale] = Object.fromEntries([...source.matchAll(/^  "([^"\n]+)": "((?:\\.|[^"\\])*)",?$/gm)].map(match => [match[1], JSON.parse(`"${match[2]}"`)]));
  }
  return Object.fromEntries(Object.keys(catalogs).map(locale => [locale, [...new Set(Object.entries(catalogs).filter(([other]) => other !== locale).flatMap(([, catalog]) => Object.entries(catalog).filter(([key, value]) => value.length > 3 && !/[<{}]/.test(value) && value !== catalogs[locale][key] && Object.values(catalogs[locale]).every(target => target !== value)).map(([, value]) => value)))]]));
}
