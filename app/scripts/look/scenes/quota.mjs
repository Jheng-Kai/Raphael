import { scene, check, member, page, wait } from "./steps.mjs";

// A subscription window nine-tenths used (R-QUOTA-01). Only the shell's event is synthetic; the toast is the main
// window's own. The fixture clock is 2026-10-24 10:00 in Taipei (1792807200 s).
const NOW_S = 1792807200;
const warn = event => ({ action: "main-event", event: { type: "QuotaWarning", ...event } });

export default [
  scene("quota-warning", "A subscription window nine-tenths used is said once, in a toast above the conversation's composer: which one, what is left, when it resets",
    [member(1), check("quota-warning-before"), warn({ provider: "codex", period: "fiveHour", remaining_percent: 8, resets_at: NOW_S + 3 * 3600 + 900 }),
      wait(".toast .quota-warning"), check("quota-warning"), check("toast-clearance")]),
  scene("quota-warning-weekly", "A weekly window that resets days later names its day as well as its time, here over Home",
    [page("home"), wait(".page-home:not([hidden]) .ho-hero"), check("quota-warning-before"),
      warn({ provider: "claude", period: "weeklyOpus", remaining_percent: 7.5, resets_at: NOW_S + 3 * 86400 - 7200 }),
      wait(".toast .quota-warning"), check("quota-warning-weekly")]),
];
