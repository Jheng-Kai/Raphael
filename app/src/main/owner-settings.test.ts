// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ settingsSet: vi.fn() }));
vi.mock("./api", () => api);
import { applySkin, createOwnerControls, ownerProfileHTML, SKINS, skinOf } from "./owner-settings";
import type { BrainSettings } from "./types";

afterEach(() => document.body.replaceChildren());
it("keeps name and about beside the shared owner avatar picker", () => {
  const settings = { owner_name: "<Jack>", owner_about: "Brief & kind" } as BrainSettings;
  expect(ownerProfileHTML(settings)).toContain("&lt;Jack&gt;");
  expect(ownerProfileHTML(settings)).toContain("Brief &amp; kind");
  expect(ownerProfileHTML(settings)).not.toContain('type="file"');
  expect(ownerProfileHTML(settings)).toContain("data-owner-photo");
});
it("resolves black to dark and respects the default appearance preference", () => {
  for (const skin of SKINS) {
    for (const systemDark of [false, true]) {
      for (const appearance of ["system", "light", "dark"] as const) {
        applySkin(skin, appearance, systemDark);
        expect(document.documentElement.dataset.skin).toBe(skin);
        expect(document.documentElement.dataset.theme).toBe(skin === "black" ? "dark" : appearance === "system" ? systemDark ? "dark" : "light" : appearance);
      }
    }
  }
  expect(SKINS).toEqual(["default", "black"]);
});
it("silently falls back for retired and unknown saved skins", () => {
  for (const value of ["paper", "graphite", "lagoon", "dusk", "midnight", "meadow", "ink", "catppuccin", "unknown", null]) {
    expect(skinOf(value)).toBe("default");
    applySkin(value, "light", true);
    expect(document.documentElement.dataset.skin).toBe("default");
    expect(document.documentElement.dataset.theme).toBe("light");
  }
});
it("persists profile edits in order through the core", async () => {
  const host = document.createElement("div"); host.innerHTML = ownerProfileHTML({} as BrainSettings); document.body.append(host);
  api.settingsSet.mockImplementation(async (key, value) => ({ settings: { [key]: value } }));
  const saved = vi.fn(), controls = createOwnerControls(saved);
  const input = host.querySelector<HTMLInputElement>("[data-owner=owner_name]")!; input.value = "Jack";
  await controls.change(input);
  const about = host.querySelector<HTMLTextAreaElement>("[data-owner=owner_about]")!; about.value = "Brief";
  await controls.change(about);
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(api.settingsSet.mock.calls.map(call => call.slice(0, 2))).toEqual([["owner_name", "Jack"], ["owner_about", "Brief"]]);
});
