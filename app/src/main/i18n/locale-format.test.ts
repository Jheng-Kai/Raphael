import { afterEach, expect, test } from "vitest";
import { LOCALES, setLocale, t } from "./index";
import { dayLabel, formatClock, formatDate, formatLimit, formatSeconds, formatShortDateTime, formatUsd } from "../format";

afterEach(() => setLocale("zh-TW"));

test("new locales format dates and numbers with Intl while today remains translated", () => {
  const date = new Date(2026, 10, 8, 14, 5);
  const now = new Date(2026, 10, 10, 14, 5);
  for (const { id } of LOCALES.filter(item => !["zh-TW", "en", "ja"].includes(item.id))) {
    setLocale(id);
    expect(formatDate("2026-11-08")).toBe(new Intl.DateTimeFormat(id, { calendar: "gregory", year: "numeric", month: "short", day: "numeric" }).format(new Date(2026, 10, 8)));
    expect(dayLabel(date.getTime(), now.getTime())).toBe(new Intl.DateTimeFormat(id, { calendar: "gregory", month: "short", day: "numeric" }).format(date));
    expect(dayLabel(date.getTime(), date.getTime())).toBe(t("format.001"));
    expect(formatShortDateTime(date.getTime(), now.getTime())).toContain(formatClock(date.getTime()));
    expect(formatLimit(7.5)).toBe(new Intl.NumberFormat(id, { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(7.5));
    expect(formatSeconds(1340)).toContain(new Intl.NumberFormat(id, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1.34));
    expect(formatUsd(0.0037)).toBe(new Intl.NumberFormat(id, { style: "currency", currency: "USD", currencyDisplay: "code", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(0.0037));
  }
});
