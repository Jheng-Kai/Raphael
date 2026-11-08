import { scene, click, wait, check, page, hover } from "./steps.mjs";

// Home as Raphael the secretary (owner, 2026-11-07 night): his still emblem beside the greeting and his word on today, then
// today's schedule, what is open, the team, yesterday and the health check.
const ready = [wait(".page-home:not([hidden]) .ho-hero"), check("home-hero"), check("home-overview")];
export default [
  scene("home", "Raphael greets the owner with his word on today, then today, what is open, the team, yesterday and the health check", [...ready, check("home-digest")]),
  scene("home-empty", "Nothing scheduled, nothing open, no model for the summaries: calm lines, 建立 for today and 選模型", [...ready, check("home-empty-digest")], { homeEmpty: true }),
  scene("home-team", "Every member state at once, waiting first, each with its last work or its job and its next routine", [...ready, check("home-team")], { homeTeam: true }),
  scene("home-many", "Many open questions all show as rows, none hidden behind a count", [...ready, check("home-all-rows")], { homeManyQuestions: true }),
  scene("home-problem", "A report that needs fixing speaks under the health line with its one fix", [...ready, check("home-problem")], { problem: true }),
  scene("home-calendar-rhythm", "Today's rhythm keeps its face and title, and a failed run is marked", [...ready, check("home-calendar-rhythm")], { calendarRhythm: true }),
  scene("home-own-events", "Today's own event reads in the calendar's colour and time", [...ready, check("home-calendar-language")], { homeOwnEvents: true }),
  scene("home-report", "A member report opens its conversation at the reported turn", [...ready, click('.ho-row[data-home-item="report:2"]'), wait('.page-agent:not([hidden]) .tn[data-id="2"]'), check("home-report")]),
  scene("home-member", "A member row opens that member's conversation", [...ready, click('.ho-member[data-home-member="1"]'), wait('.page-agent:not([hidden]) .composer'), check("home-member")]),
  scene("home-calendar", "The schedule's calendar icon opens the full calendar", [...ready, click('.ho-schedule header [data-home-go="calendar"]'), wait('.au-page:not([hidden]) .au-day-col'), check("calendar-shell")]),
  scene("home-more", "A day of more than eight items: every row shows, with nothing to press for more (owner, 2026-11-08)", [...ready, check("home-all-rows")], { homeMore: true }),
  scene("home-event-chip", "A schedule row opens and focuses its event on Calendar", [...ready, click('.ho-schedule [data-home-event^="event:"]'), wait('.au-page:not([hidden]) .au-day-col'), wait('.is-home-focus, .au-occurrence[aria-current="true"]'), check('calendar-shell')]),
  scene("home-create", "An empty day offers 建立, which opens the Calendar's form on today", [...ready, click('[data-home-create]'), wait(".au-pop-editor"), check("calendar-editor")], { homeEmpty: true, routines: [] }),
  scene("home-google-off", "Google not connected: one quiet line with the place to connect it", [...ready, check("home-google-off")], { calendarGoogle: "not_connected" }),
  scene("home-google-closed", "Closed, it stays closed", [...ready, click("[data-home-dismiss]"), check("home-google-closed")], { calendarGoogle: "not_connected" }),
  scene("home-google-failed", "Google could not be read: said, with where to check", [...ready, check("home-google-failed")], { calendarGoogle: "unreadable" }),
  scene("home-row-hover", "A row lights its own background under the pointer, with no frame", [...ready, hover('.ho-member[data-home-member="2"]'), check("home-row-hover")]),
  // With motion allowed, the first Home of a day no longer flies him in (owner, 2026-11-07 night): he is simply there, still.
  { ...scene("home-arrival", "The first Home of a day shows Raphael's emblem standing still, with no flight, rings or rising sections", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 700 }, { action: "home-show-again" }, check("home-arrival")]), motion: true },
  { ...scene("home-motion", "With motion allowed the emblem still stands still, drawn crisp at its size, and the hero has no ask icon", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 2000 }, check("home-emblem-motion"), check("home-overview")]), motion: true },
];
