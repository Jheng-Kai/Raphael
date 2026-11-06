import type { DeviceSettings } from "./types";

/**
 * Settings the owner asked to keep simple, so Settings no longer offers them (owner, 2026-11-06): the desktop emblem is
 * always small, its subtitles always on, and Raphael starts with Windows (Windows' own Startup apps turn that off). A
 * computer that kept another choice is brought to these once at start; null when nothing needs to change.
 */
export function fixedDevicePatch(device: DeviceSettings): Partial<DeviceSettings> | null {
  const patch: Partial<DeviceSettings> = {};
  if (device.emblem_size !== 120) patch.emblem_size = 120;
  if (device.subtitles !== "on") patch.subtitles = "on";
  if (!device.autostart) patch.autostart = true;
  return Object.keys(patch).length ? patch : null;
}
