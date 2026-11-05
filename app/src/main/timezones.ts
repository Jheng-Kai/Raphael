import { getLocale, t } from "./i18n";
import { closeMenu, esc, openPopover } from "./ui";

export const detectedTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function zonedParts(at: number, zone?: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (key: string): string => parts.find(item => item.type === key)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}
/** Resolve a wall time, choosing the earlier fold and skipping nonexistent DST times. */
export function zonedTime(date: string, time: string, zone?: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  if (!zone) return new Date(`${date}T${time}`).getTime();
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall)) return NaN;
  const candidates = new Set<number>();
  for (const offset of [-86400000, 0, 86400000]) {
    const sample = wall + offset, parts = zonedParts(sample, zone);
    const difference = Date.parse(`${parts.date}T${parts.time}:00Z`) - sample;
    const at = wall - difference, actual = zonedParts(at, zone);
    if (actual.date === date && actual.time === time) candidates.add(at);
  }
  return candidates.size ? Math.min(...candidates) : NaN;
}
export function zoneLabel(zone: string): string {
  return zone === "Asia/Taipei" && getLocale() === "zh-TW" ? t("zone.taipei") : zone;
}
export function openTimezoneMenu(anchor: HTMLElement, current: string, pick: (value: string) => void): void {
  const zones = [...new Set(["UTC", detectedTimezone(), current, ...Intl.supportedValuesOf("timeZone")])].filter(Boolean);
  const panel = openPopover(anchor, `<div class="conversation-tools"><input type="search" aria-label="${esc(t("zone.search"))}" placeholder="${esc(t("zone.search"))}"></div><div class="conversation-rows" data-timezones></div>`, {
    className: "menu conversation-search", role: "dialog", label: t("zone.title"),
    onKey: event => { if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return false; panel.querySelector<HTMLButtonElement>("[data-zone]")?.click(); return true; },
  });
  const input = panel.querySelector<HTMLInputElement>("input")!;
  const draw = (): void => {
    const choices = [{ value: "", label: t("zone.auto") }, ...zones.map(value => ({ value, label: zoneLabel(value) === value ? value : `${zoneLabel(value)} · ${value}` }))];
    const found = choices.filter(choice => `${choice.label} ${choice.value}`.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));
    panel.querySelector("[data-timezones]")!.innerHTML = found.map(choice => `<button type="button" data-zone="${esc(choice.value)}" aria-current="${current === choice.value}"><span class="mt">${esc(choice.label)}</span></button>`).join("") || `<p class="note">${esc(t("zone.empty"))}</p>`;
  };
  input.addEventListener("input", draw);
  panel.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-zone]");
    if (button) { closeMenu(); anchor.focus(); pick(button.dataset.zone!); }
  });
  draw(); input.focus();
}
