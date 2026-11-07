import { expect, test } from "vitest";
import { fixedDevicePatch } from "./device-fixed";
import type { DeviceSettings } from "./types";

const device = (patch: Partial<DeviceSettings> = {}): DeviceSettings => ({
  dictation_keys: ["AltRight"], dictation_mode: "toggle", paste_last_keys: ["AltRight+V"], agent_keys: ["AltRight+Space"],
  microphone: null, emblem_size: 120, subtitles: "on", appearance: "system", ui_language: "zh-TW", autostart: true,
  auto_update: false, onboarded: true, computer_apps: [], ...patch,
});

test("the small emblem, its subtitles and starting with Windows are kept, and a computer that chose otherwise is brought back once", () => {
  expect(fixedDevicePatch(device())).toBeNull();
  expect(fixedDevicePatch(device({ emblem_size: 194, subtitles: "off", autostart: false }))).toEqual({ emblem_size: 120, subtitles: "on", autostart: true });
  expect(fixedDevicePatch(device({ emblem_size: 150 }))).toEqual({ emblem_size: 120 });
});
