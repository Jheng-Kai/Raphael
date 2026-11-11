// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ settingsGet: vi.fn(), settingsSet: vi.fn(), desktopHostCheck: vi.fn() }));
vi.mock("./api", () => api);
import { computerHostHealthHTML, computerLocationHTML, mountComputerLocation, validComputerAlias } from "./computer-location";
import { closeMenu } from "./ui";
import { setLocale, t } from "./i18n";

const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.resetAllMocks(); setLocale("zh-TW");
  api.settingsGet.mockResolvedValue({ settings: { computer_ssh_alias: "" } });
  api.settingsSet.mockImplementation(async (_key, value) => ({ settings: { computer_ssh_alias: value } }));
});
afterEach(() => { closeMenu(); document.body.replaceChildren(); });
async function mount(alias = "") {
  api.settingsGet.mockResolvedValue({ settings: { computer_ssh_alias: alias } });
  const host = document.createElement("header"); document.body.append(host);
  const changed = vi.fn(), mounted = mountComputerLocation(host, changed);
  await mounted.refresh(); host.querySelector<HTMLButtonElement>("button")!.click();
  return { host, mounted, changed };
}
const click = (selector: string): void => document.querySelector<HTMLButtonElement>(selector)!.click();
const change = async (value: string): Promise<void> => {
  const field = document.querySelector<HTMLInputElement>("#computer-ssh-alias")!;
  field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true })); await flush();
};

test.each(["zh-TW", "en", "ja"] as const)("the %s popover keeps one scope line and only contextual errors", locale => {
  setLocale(locale);
  document.body.innerHTML = computerLocationHTML(true, "studio-mini");
  expect([...document.querySelectorAll("p")].map(note => note.textContent)).toEqual([t("desktop.sharedLocation")]);
  expect(document.querySelector('[role="status"]')).toBeNull();
  document.body.innerHTML = computerLocationHTML(true, "studio-mini", false, false, t("desktop.locationHostError"));
  expect(document.querySelectorAll("p")).toHaveLength(2);
  expect(document.querySelector('[role="alert"]')!.textContent).toBe(t("desktop.locationHostError"));
});

test("local to remote saves only the existing shared alias setting, and local clears it", async () => {
  const { changed } = await mount();
  click('[data-k="computer-host"]'); click('#app-submenu [data-value="remote"]');
  await change("studio-mini");
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("computer_ssh_alias", "studio-mini");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-computer-location]')!.textContent).toContain("studio-mini");
  click('[data-k="computer-host"]'); click('#app-submenu [data-value="local"]'); await flush();
  expect(api.settingsSet).toHaveBeenLastCalledWith("computer_ssh_alias", "");
});

test("invalid remote aliases remain editable and never reach storage", async () => {
  await mount("studio-mini"); await change("-oBad");
  expect(document.querySelector<HTMLInputElement>("#computer-ssh-alias")!.value).toBe("-oBad");
  expect(document.querySelector("[data-computer-host-error]")).not.toBeNull();
  expect(api.settingsSet).not.toHaveBeenCalled();
  for (const alias of ["", "a b", "host;cmd", "a".repeat(129)]) expect(validComputerAlias(alias)).toBe(false);
});

test("a save refusal keeps the last saved host and shows a value-free inline error", async () => {
  await mount("studio-mini"); api.settingsSet.mockRejectedValue(new Error("synthetic private failure"));
  await change("workstation");
  expect(document.querySelector('[data-computer-location]')!.textContent).toContain("studio-mini");
  expect(document.querySelector('[role="alert"]')!.textContent).toContain("無法儲存");
  expect(document.body.textContent).not.toContain("synthetic private failure");
  api.settingsSet.mockResolvedValue({ settings: { computer_ssh_alias: "workstation" } });
  document.querySelector("#computer-ssh-alias")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flush();
  expect(document.querySelector('[data-computer-location]')!.textContent).toContain("workstation");
});

test("a host status error is current state only and opening the popover starts no host check", async () => {
  const { mounted } = await mount("studio-mini"); mounted.status(true);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(api.settingsSet).not.toHaveBeenCalled();
  expect(api.desktopHostCheck).not.toHaveBeenCalled();
  mounted.hide(); expect(document.querySelector('.computer-location-popover')).toBeNull();
});

test("the explicit host check keeps its existing owner RPC and shows the core's command, copyable, as it came", async () => {
  await mount("studio-mini");
  const command = `ssh studio-mini "echo 'export PATH=/usr/local/bin:/usr/bin' >> ~/.zshenv"`;
  api.desktopHostCheck.mockResolvedValue({host:"studio-mini",ok:false,checks:[{kind:"docker_path",ok:false,command}]});
  click('[data-act="computer-host-check"]'); await flush();
  expect(api.desktopHostCheck).toHaveBeenCalledExactlyOnceWith("studio-mini");
  expect(document.querySelector('[data-computer-host-health]')!.textContent).toContain(t("desktop.health.docker_path"));
  expect(document.querySelector('[data-computer-host-repair]')!.textContent).toContain(t("desktop.health.runHere"));
  expect(document.querySelector('[data-act="copy-code"]')).not.toBeNull();
  expect(document.querySelector('code')!.textContent).toBe(command);
  expect(api.settingsSet).not.toHaveBeenCalled();
});

test("a late host check cannot replace the result for a changed alias", async () => {
  await mount("studio-mini");
  let finish!: (value: unknown) => void;
  api.desktopHostCheck.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  click('[data-act="computer-host-check"]');
  await change("workstation");
  finish({host:"studio-mini",ok:false,checks:[{kind:"docker_path",ok:false}]}); await flush();
  expect(document.querySelector('[data-computer-host-health]')).toBeNull();
});

test("the local host label follows the window language and the shared popover reopens in it", async () => {
  const { host } = await mount();
  setLocale("en");
  expect(host.querySelector('[data-computer-location]')!.textContent).toContain(t("desktop.locationLocal"));
  expect(document.querySelector('.computer-location-popover')).toBeNull();
  host.querySelector<HTMLButtonElement>('[data-computer-location]')!.click();
  expect(document.querySelector('.computer-location-popover')!.textContent).toContain(t("desktop.sharedLocation"));
});

test("a refused key login names the user ssh tried, so a wrong account is the first thing to check", () => {
  setLocale("zh-TW");
  const html = computerHostHealthHTML({ host: "192.0.2.178", ok: false, checks: [{ kind: "ssh_key", ok: false, user: "tester" }] });
  expect(html).toContain("以 tester 登入被拒");
  expect(computerHostHealthHTML({ host: "studio-mini", ok: false, checks: [{ kind: "ssh_key", ok: false }] })).toContain(t("desktop.health.ssh_key"));
});

const checks = (...list: { kind: string; ok: boolean; user?: string; command?: string }[]) => computerHostHealthHTML({ host: "studio-mini", ok: list.every(check => check.ok), checks: list });

test.each([
  ["ssh_hostkey", "desktop.health.ssh_hostkey", "desktop.health.runHere", "ssh studio-mini"],
  ["ssh_hostkey_changed", "desktop.health.ssh_hostkey_changed", "desktop.health.runHere", "ssh-keygen -R 192.168.8.178"],
  ["ssh_alias_unknown", "desktop.health.ssh_alias_unknown", "desktop.health.editConfig", "Host studio-mini\n  HostName HOST_ADDRESS"],
  ["ssh_key", "desktop.health.ssh_key", "desktop.health.runHere", "ssh-keygen -t ed25519\nssh-copy-id studio-mini"],
  ["ssh_unreachable", "desktop.health.ssh_unreachable", "desktop.health.localTerminal", "ssh studio-mini"],
  ["docker_missing", "desktop.health.docker_missing", "desktop.health.runHere", 'ssh -t studio-mini "curl -fsSL https://get.docker.com | sh"'],
  ["docker_stopped", "desktop.health.docker_stopped", "desktop.health.runHere", 'ssh studio-mini "open -a Docker"'],
  ["docker_access", "desktop.health.docker_access", "desktop.health.runHere", 'ssh -t studio-mini "sudo usermod -aG docker jack2"'],
  ["architecture", "desktop.health.architecture", "desktop.health.runHere", 'ssh studio-mini "docker image rm raphael/cua-local-vm:driver-0.37.0-v4"'],
] as const)("a %s failure says what is missing and shows the one command that fixes it", (kind, said, lead, command) => {
  for (const locale of ["zh-TW", "en", "ja"] as const) {
    setLocale(locale);
    document.body.innerHTML = checks({ kind: "ssh", ok: true }, { kind, ok: false, command });
    const row = document.querySelector(`[data-computer-host-health="${kind}"]`)!;
    expect(row.textContent).toContain(t(said));
    const repair = document.querySelector("[data-computer-host-repair]")!;
    expect(repair.querySelector("p")!.textContent).toBe(t(lead));
    expect(repair.querySelector("code")!.textContent).toBe(command);
    expect(repair.querySelector('[data-act="copy-code"]')).not.toBeNull();
  }
});

test("the host key, key login and unreachable texts are different sentences in every language", () => {
  for (const locale of ["zh-TW", "en", "ja", "de", "ko"] as const) {
    setLocale(locale);
    const words = ["ssh_hostkey", "ssh_hostkey_changed", "ssh_alias_unknown", "ssh_key", "ssh_unreachable", "docker_stopped", "docker_access", "docker_missing", "docker_path"].map(kind => t(`desktop.health.${kind}` as "desktop.health.ssh_key"));
    expect(new Set(words).size).toBe(words.length);
  }
});

test("a reachable host with no image yet is healthy, says its first start prepares one, and shows no command", () => {
  for (const locale of ["zh-TW", "en", "ja"] as const) {
    setLocale(locale);
    document.body.innerHTML = checks({ kind: "ssh", ok: true }, { kind: "docker", ok: true }, { kind: "image_pending", ok: true });
    expect(document.querySelector('[data-computer-host-health="image_pending"]')!.textContent).toContain(t("desktop.health.image_pending"));
    expect(document.querySelector("[data-computer-host-repair]")).toBeNull();
    expect(document.querySelector('[data-computer-host-health] .st-err, [data-computer-host-health] [data-st="err"]')).toBeNull();
  }
  expect(t("desktop.health.image_pending")).toMatch(/5.*15/);
});

test("no host failure offers a build from this app's sources or a command without the host", () => {
  const shown = ["ssh_unreachable", "ssh_hostkey", "ssh_key", "docker_path", "docker_stopped", "architecture"].map(kind => checks({ kind, ok: false, command: kind === "ssh_key" ? "ssh-copy-id studio-mini" : "ssh studio-mini" })).join("");
  expect(shown).not.toMatch(/core\/src|docker build|project folder/);
});
