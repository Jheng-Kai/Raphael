// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ settingsGet: vi.fn(), settingsSet: vi.fn(), desktopHostCheck: vi.fn() }));
vi.mock("./api", () => api);
import { computerLocationHTML, mountComputerLocation, validComputerAlias } from "./computer-location";
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

test("the explicit host check keeps its existing owner RPC and copyable repair in the popover", async () => {
  await mount("studio-mini");
  api.desktopHostCheck.mockResolvedValue({host:"studio-mini",ok:false,checks:[{kind:"docker_path",ok:false}]});
  click('[data-act="computer-host-check"]'); await flush();
  expect(api.desktopHostCheck).toHaveBeenCalledExactlyOnceWith("studio-mini");
  expect(document.querySelector('[data-computer-host-health]')!.textContent).toContain("遠端登入時找不到 Docker");
  expect(document.querySelector('[data-computer-host-repair]')!.textContent).toContain("那台 Mac 的終端機");
  expect(document.querySelector('[data-act="copy-code"]')).not.toBeNull();
  expect(document.querySelector('code')!.textContent).toContain("~/.zshenv");
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
