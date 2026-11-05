import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInfo, checksums, collectTools, main, prepareReleaseAssets } from "./prepare-release-assets.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = join(scripts, "..", ".test-cache", "release-assets-tests");
const temporaryRoots = [];
const env = {
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567", GITHUB_REF: "refs/heads/fix/release-licensing",
  GITHUB_REPOSITORY: "Jheng-Kai/Raphael", GITHUB_WORKFLOW: "Build Windows release", GITHUB_RUN_ID: "4242",
  GITHUB_RUN_ATTEMPT: "2", GITHUB_SERVER_URL: "https://github.com", ImageOS: "win25", ImageVersion: "20260901.1",
};
// Fixed tools, so that no test starts npm, rustc, cargo or uv: a busy runner took 26 s to start them.
const tools = { node: "v22.17.0", npm: "10.9.2", "tauri cli": "2.12.3", nsis: "v3.13" };
const workflow = readFileSync(join(scripts, "..", "..", ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
const workflowStep = name => workflow.split(`      - name: ${name}\n`)[1]?.split(/\n      (?:- name:|#)/)[0];
const workflowRun = name => workflowStep(name).split("        run: |\n")[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (relative(fixtureDirectory, root).startsWith("..")) throw new Error("Fixture escaped its cache directory");
    rmSync(root, { recursive: true, force: true });
  }
});

function inputs() {
  mkdirSync(fixtureDirectory, { recursive: true });
  const root = mkdtempSync(join(fixtureDirectory, "case-"));
  temporaryRoots.push(root);
  writeFileSync(join(root, "app_0.1.0_x64-setup.exe"), Buffer.from([0x4d, 0x5a, 0x00, 0x0d, 0x0a, 0xff]));
  writeFileSync(join(root, "notices.txt"), "Notices\r\nwith CRLF\r\n");
  return { root, installer: join(root, "app_0.1.0_x64-setup.exe"), notices: join(root, "notices.txt"), output: join(root, "release-assets") };
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// These tests start Windows PowerShell and the Tauri signer; a cold CI runner needs more than 5 s.
describe("release assets", { timeout: 30_000 }, () => {
  it("pins updater configuration and publication to the current repository", () => {
    const native = join(scripts, "..", "src-tauri");
    const workflow = readFileSync(join(scripts, "..", "..", ".github", "workflows", "release.yml"), "utf8");
    const configurations = readdirSync(native).filter(name => /^tauri.*\.json$/.test(name))
      .map(name => readFileSync(join(native, name), "utf8"));
    configurations.push(readFileSync(join(native, "src", "updates.rs"), "utf8"));
    configurations.push(readFileSync(join(scripts, "prepare-release-assets.mjs"), "utf8"));
    const config = JSON.parse(readFileSync(join(native, "tauri.conf.json"), "utf8"));
    expect(config.plugins.updater.endpoints).toEqual(["https://github.com/Jheng-Kai/Raphael/releases/latest/download/latest.json"]);
    for (const configuration of [...configurations, workflow]) expect(configuration.toLowerCase()).not.toContain(["Jack", "hehe"].join("-").toLowerCase());
    expect(workflow).toContain("GH_REPO: Jheng-Kai/Raphael");
    expect(workflow).toContain("$env:GITHUB_REPOSITORY -ne 'Jheng-Kai/Raphael'");
  });

  it("publishes a version-bound feed from an ephemeral signing key and refuses a replayed version", () => {
    const { root, installer, notices, output } = inputs();
    const cli = join(scripts, "..", "node_modules", "@tauri-apps", "cli", "tauri.js");
    const key = join(root, "test.key");
    const run = args => {
      const result = spawnSync(process.execPath, [cli, "signer", ...args], { windowsHide: true, encoding: "utf8" });
      if (result.status !== 0) throw new Error("The ephemeral test signer failed.");
    };
    run(["generate", "--ci", "-p", "", "-w", key]);
    run(["sign", "--app-version", "0.1.0", "-p", "", "-f", key, installer]);
    prepareReleaseAssets({ installer, notices, signature: installer + ".sig", version:"0.1.0", output, env:{...env,RELEASE_NOTES:"Synthetic release notes"}, tools });
    const manifest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    expect(manifest.notes).toBe("Synthetic release notes");
    expect(manifest.platforms["windows-x86_64"].url).toBe("https://github.com/Jheng-Kai/Raphael/releases/download/v0.1.0/Raphael-0.1.0-windows-x64-setup.exe");
    expect(manifest.platforms["windows-x86_64"].signature).toBe(readFileSync(installer + ".sig", "utf8").trim());
    expect(readFileSync(join(output, "SHA256SUMS.txt"), "utf8")).toContain("latest.json");
    expect(readFileSync(join(output, "SHA256SUMS.txt"), "utf8")).toContain("Raphael-0.1.0-windows-x64-setup.exe.sig");
    expect(readFileSync(join(output, "BUILD-INFO.txt"), "utf8")).not.toContain("updater feed: skipped");
    expect(() => prepareReleaseAssets({ installer, notices, signature:installer+".sig",version:"9.9.9",output:join(root,"replay"),env,tools })).toThrow("bind this release version");
  });

  it("fails closed when signed mode has no signature", () => {
    const { installer, notices, output } = inputs();
    const signedEnv = { ...env, TAURI_SIGNING_PRIVATE_KEY: "synthetic private key", RAPHAEL_UPDATER_PUBLIC_KEY: "synthetic public key" };
    expect(() => prepareReleaseAssets({ installer, notices, version: "0.1.0", output, env: signedEnv, tools })).toThrow("requires --signature");
    expect(existsSync(output)).toBe(false);
  });

  it.each(["missing", "empty", "malformed", "wrong-version"])("fails closed on a %s signature in signed mode", kind => {
    const { installer, notices, output } = inputs();
    const signature = installer + ".sig";
    if (kind !== "missing") writeFileSync(signature, kind === "empty" ? "" : kind === "malformed" ? "not a signature" : Buffer.from("trusted comment: timestamp:1\tversion:9.9.9").toString("base64"));
    const signedEnv = { ...env, TAURI_SIGNING_PRIVATE_KEY: "synthetic private key", RAPHAEL_UPDATER_PUBLIC_KEY: "synthetic public key" };
    expect(() => prepareReleaseAssets({ installer, notices, signature, version: "0.1.0", output, env: signedEnv, tools })).toThrow(kind === "missing" ? /ENOENT/ : /bind this release version/);
    expect(existsSync(join(output, "latest.json"))).toBe(false);
    expect(readdirSync(output).some(name => name.endsWith(".sig"))).toBe(false);
  });

  it("requires an explicit valid disabled mode and refuses a signature in that mode", () => {
    const { installer, notices, output } = inputs();
    expect(() => prepareReleaseAssets({ installer, notices, updater: "typo", version: "0.1.0", output, env, tools })).toThrow("must be signed or disabled");
    expect(() => prepareReleaseAssets({ installer, notices, updater: "disabled", signature: installer + ".sig", version: "0.1.0", output, env, tools })).toThrow("must not include --signature");
    expect(existsSync(output)).toBe(false);
  });

  it("keeps installer verification and publishes either mode without depending on the feed", () => {
    const native = join(scripts, "..", "src-tauri");
    expect(JSON.parse(readFileSync(join(native, "tauri.release.conf.json"), "utf8")).bundle.createUpdaterArtifacts).toBe(true);
    expect(JSON.parse(readFileSync(join(native, "tauri.release-no-updater.conf.json"), "utf8"))).toEqual({ bundle: { createUpdaterArtifacts: false } });
    expect(workflowStep("Sign updater artifact with its version")).toContain("if: steps.build.outputs.updater == 'signed'");
    expect(workflowRun("Sign updater artifact with its version")).toContain("signer sign --app-version $env:RELEASE_VERSION");
    expect(workflowStep("Verify installed application")).not.toContain("if:");
    expect(workflowStep("Verify installed application")).toContain("verify-windows-install.ps1");
    expect(workflowStep("Prepare release assets and checksums")).toContain("UPDATER_MODE: ${{ steps.build.outputs.updater }}");
    expect(workflow).toContain("version: ${{ steps.version.outputs.version }}");
    expect(workflow).toContain('"version=$version" >> $env:GITHUB_OUTPUT');
    expect(workflow).toContain("RELEASE_VERSION: ${{ needs.windows-release.outputs.version }}");
    expect(workflowRun("Publish verified release assets")).toContain('version="$RELEASE_VERSION"');
    expect(workflowRun("Publish verified release assets")).not.toContain("latest.json");
    expect(workflowRun("Publish verified release assets")).toContain('gh release create "v$version" ./*');
    expect(workflow.match(/::warning::/g)).toHaveLength(1);
    expect(workflowRun("Build Windows installer")).toContain("node scripts/tauri.mjs build @config --bundles nsis --ci -- --locked");
  });

  it.runIf(process.platform === "win32").each([
    ["both keys", "test-private", "test-public", "signed"],
    ["no keys", "", "", "disabled"],
    ["private key only", "test-private", "", "disabled"],
    ["public key only", "", "test-public", "disabled"],
  ])("executes the Windows workflow with %s", (_, privateKey, publicKey, mode) => {
    const { root, installer } = inputs();
    const script = `$ErrorActionPreference = 'Stop'
function node {
  Write-Output ('CALL:' + (@{ argv = @($args); privateKey = [bool]$env:TAURI_SIGNING_PRIVATE_KEY; publicKey = [bool]$env:RAPHAEL_UPDATER_PUBLIC_KEY } | ConvertTo-Json -Compress))
  $global:LASTEXITCODE = 0
}
function Get-ChildItem { [pscustomobject]@{ FullName = $env:TEST_INSTALLER } }
${workflowRun("Build Windows installer")}
$env:UPDATER_MODE = (Get-Content $env:GITHUB_OUTPUT | Select-Object -Last 1).Split('=')[1]
if ($env:UPDATER_MODE -eq 'signed') {
${workflowRun("Sign updater artifact with its version")}
}
${workflowRun("Prepare release assets and checksums")}
`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", windowsHide: true, env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: privateKey, RAPHAEL_UPDATER_PUBLIC_KEY: publicKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "test-password", GITHUB_OUTPUT: join(root, "output.txt"), TEST_INSTALLER: installer, RELEASE_VERSION: "0.1.0" },
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = result.stdout.split(/\r?\n/).filter(line => line.startsWith("CALL:")).map(line => JSON.parse(line.slice(5)));
    const signed = mode === "signed";
    expect(calls).toHaveLength(signed ? 3 : 2);
    // PowerShell consumes the standalone -- for a function; the native command retains it.
    expect(calls[0].argv).toEqual(["scripts/tauri.mjs", "build", "--config", "src-tauri/tauri.release.conf.json", ...(!signed ? ["--config", "src-tauri/tauri.release-no-updater.conf.json"] : []), "--bundles", "nsis", "--ci", "--locked"]);
    expect(calls[0]).toMatchObject({ privateKey: signed, publicKey: signed });
    if (signed) expect(calls[1].argv).toEqual(["scripts/tauri.mjs", "signer", "sign", "--app-version", "0.1.0", installer]);
    const assets = calls.at(-1).argv;
    expect(assets.slice(0, 5)).toEqual(["app/scripts/prepare-release-assets.mjs", "--installer", installer, "--updater", mode]);
    expect(assets.includes("--signature")).toBe(signed);
    if (signed) expect(assets[assets.indexOf("--signature") + 1]).toBe(installer + ".sig");
    expect((result.stdout.match(/::warning::/g) ?? [])).toHaveLength(signed ? 0 : 1);
  });

  it("names the installer after the version and writes notices, build info and checksums", () => {
    const { installer, notices, output } = inputs();
    writeFileSync(installer + ".sig", "A stale signature must never be published in disabled mode.");

    const names = prepareReleaseAssets({ installer, notices, updater: "disabled", version: "0.1.0", output, env, tools });

    expect(names).toEqual(["BUILD-INFO.txt", "Raphael-0.1.0-windows-x64-setup.exe", "SHA256SUMS.txt", "THIRD_PARTY_NOTICES.txt"]);
    expect(readFileSync(join(output, "Raphael-0.1.0-windows-x64-setup.exe"))).toEqual(readFileSync(installer));
    expect(readFileSync(join(output, "THIRD_PARTY_NOTICES.txt"), "utf8")).toBe("Notices\r\nwith CRLF\r\n");
    expect(readFileSync(join(output, "BUILD-INFO.txt"), "utf8")).toContain("updater feed: skipped because the owner's signing keys are not set");
  });

  it("writes SHA256SUMS.txt for sha256sum -c: LF line endings, two spaces, every file but itself", () => {
    const { installer, notices, output } = inputs();
    prepareReleaseAssets({ installer, notices, updater: "disabled", version: "0.1.0", output, env, tools });

    const bytes = readFileSync(join(output, "SHA256SUMS.txt"));
    const text = bytes.toString("utf8");

    // With CRLF, `sha256sum -c` looks for "file\r" and fails.
    expect(bytes.includes(0x0d)).toBe(false);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.trimEnd().split("\n");
    expect(lines.map((line) => line.slice(66))).toEqual(["BUILD-INFO.txt", "Raphael-0.1.0-windows-x64-setup.exe", "THIRD_PARTY_NOTICES.txt"]);
    for (const line of lines) {
      expect(line).toMatch(/^[0-9a-f]{64} {2}\S+$/);
      expect(line.slice(0, 64)).toBe(sha256(join(output, line.slice(66))));
    }
  });

  it("covers BUILD-INFO.txt, which says which commit, ref and run built the files and with what", () => {
    const { installer, notices, output } = inputs();
    prepareReleaseAssets({ installer, notices, updater: "disabled", version: "0.1.0", output, env, tools });

    const info = readFileSync(join(output, "BUILD-INFO.txt"), "utf8");

    expect(info).toBe(`Raphael Windows x64 release build

version: 0.1.0
commit: 0123456789abcdef0123456789abcdef01234567
ref: refs/heads/fix/release-licensing
repository: Jheng-Kai/Raphael
workflow: Build Windows release
run id: 4242
run attempt: 2
run url: https://github.com/Jheng-Kai/Raphael/actions/runs/4242/attempts/2
runner image: win25 20260901.1
updater feed: skipped because the owner's signing keys are not set

tools:
  node: v22.17.0
  npm: 10.9.2
  tauri cli: 2.12.3
  nsis: v3.13
`);
    expect(checksums(output)).toContain(`${sha256(join(output, "BUILD-INFO.txt"))}  BUILD-INFO.txt\n`);
  });

  it("says so, instead of inventing values, when it does not run on GitHub Actions", () => {
    const info = buildInfo({ version: "0.1.0", env: {}, tools: { node: "v22.0.0" } });
    expect(info).toContain("commit: unknown");
    expect(info).toContain("run url: not a GitHub Actions run");
    expect(info).toContain("runner image: unknown");
    expect(info).not.toContain("\r");
  });

  it("does not write into an existing directory", () => {
    const { installer, notices, output } = inputs();
    mkdirSync(output);
    expect(() => prepareReleaseAssets({ installer, notices, updater: "disabled", version: "0.1.0", output, env, tools })).toThrow("already exists");
    expect(readdirSync(output)).toEqual([]);
  });

  it("collects tool versions without failing when a tool is missing", () => {
    // spawnSync as the tools would answer it: a version on the first line, an exit code, or no such program.
    const started = [];
    const run = (command, args, options = {}) => {
      started.push([command, ...args, ...(options.shell ? ["(in a shell)"] : [])].join(" "));
      if (command === "npm --version") return { status: 0, stdout: "10.9.2\r\n" };
      if (command === "rustc") return { status: 0, stdout: "rustc 1.98.0 (88d9e12ae 2026-08-18)\r\nbinary: rustc\r\n" };
      if (command === "cargo") return { status: 101, stdout: "", stderr: "error: no default toolchain" };
      if (command.endsWith("makensis.exe")) return { status: 0, stdout: "v3.13\r\n" };
      return { status: null, stdout: null, error: Object.assign(new Error(`spawnSync ${command} ENOENT`), { code: "ENOENT" }) };
    };

    const found = collectTools({ LOCALAPPDATA: join(fixtureDirectory, "nowhere") }, run);

    expect(Object.keys(found)).toEqual(["node", "npm", "rustc", "cargo", "uv", "python in the frozen core", "pyinstaller", "tauri cli", "nsis"]);
    expect(found).toMatchObject({
      node: process.version, npm: "10.9.2", rustc: "rustc 1.98.0 (88d9e12ae 2026-08-18)", cargo: "unavailable", uv: "unavailable", nsis: "unavailable",
    });
    // npm is npm.cmd on Windows, which only a shell starts; NSIS is asked only when Tauri downloaded it.
    expect(started).toEqual(["npm --version (in a shell)", "rustc --version", "cargo --version", "uv --version"]);

    const { root } = inputs();
    const makensis = join(root, "tauri", "NSIS", "makensis.exe");
    mkdirSync(dirname(makensis), { recursive: true });
    writeFileSync(makensis, "");
    expect(collectTools({ LOCALAPPDATA: root }, run).nsis).toBe("v3.13");
    expect(started.at(-1)).toBe(`${makensis} /VERSION`);
  });

  it("works from the command line and rejects unknown or missing arguments", () => {
    const { installer, notices, output } = inputs();

    // One real start of the script: a bad argument fails before any tool is asked for its version.
    const bad = spawnSync(process.execPath, [join(scripts, "prepare-release-assets.mjs"), "--installer", installer, "--bogus", "x"], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("Usage:");

    expect(() => main(["--installer", installer, "--notices", notices, "--version", "0.1.0"], { env, tools })).toThrow("Missing --output");
    expect(existsSync(output)).toBe(false);

    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      main(["--installer", installer, "--notices", notices, "--updater", "disabled", "--version", "0.1.0", "--output", output], { env, tools });
      expect(printed).toHaveBeenCalledWith(["BUILD-INFO.txt", "Raphael-0.1.0-windows-x64-setup.exe", "SHA256SUMS.txt", "THIRD_PARTY_NOTICES.txt"].join("\n"));
    } finally {
      printed.mockRestore();
    }
    expect(readFileSync(join(output, "BUILD-INFO.txt"), "utf8")).toContain("commit: 0123456789abcdef0123456789abcdef01234567");
  });
});
