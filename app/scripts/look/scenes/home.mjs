import { scene, click, wait, check, hover } from "./steps.mjs";

// Home: Raphael's live emblem beside the greeting and his line, four figures, today's hours as a band
// over today's schedule as a table, and the last two weeks as a chart. No members, open items, yesterday or health check.
const ready = [wait(".page-home:not([hidden]) .ho-hero"), check("home-hero"), check("home-overview")];
export default [
  scene("home", "Raphael greets the owner with his line, then four figures, today's band and table, and the last two weeks as a chart", [...ready, check("home-figures"), check("home-band"), check("home-trend")]),
  scene("home-trend-tip", "A day's bar shows its figures under the pointer, beside the bar and inside the window", [...ready, hover(".ho-col.is-today"), check("home-trend-tip")]),
  scene("home-empty", "Nothing scheduled or finished yet: zeros said plainly, 建立 for today, and the chart's quiet note", [...ready, check("home-empty-day")], { homeEmpty: true }),
  scene("home-many", "Many waiting questions are all counted, the newest named", [...ready, check("home-questions")], { homeManyQuestions: true }),
  scene("home-problem", "A report that needs fixing speaks under his line with its one fix", [...ready, check("home-problem")], { problem: true }),
  scene("home-calendar-rhythm", "Today's rhythm keeps its title and whose routine it is, and a failed run is marked", [...ready, check("home-calendar-rhythm"), check("home-band")], { calendarRhythm: true }),
  scene("home-own-events", "Today's own event reads in the calendar's ink and time", [...ready, check("home-calendar-language")], { homeOwnEvents: true }),
  scene("home-calendar", "The schedule's calendar icon opens the full calendar", [...ready, click('.ho-schedule header [data-home-go="calendar"]'), wait('.au-page:not([hidden]) .au-day-col'), check("calendar-shell")]),
  scene("home-more", "A day of more than eight items: every row shows, with nothing to press for more", [...ready, check("home-all-rows")], { homeMore: true }),
  scene("home-event-chip", "A schedule row opens and focuses its event on Calendar", [...ready, click('.ho-schedule [data-home-event^="event:"]'), wait('.au-page:not([hidden]) .au-day-col'), wait('.is-home-focus, .au-occurrence[aria-current="true"]'), check('calendar-shell')]),
  scene("home-create", "An empty day offers 建立, which opens the Calendar's form on today", [...ready, click('[data-home-create]'), wait(".au-pop-editor"), check("calendar-editor")], { homeEmpty: true, routines: [] }),
  scene("home-google-off", "Google not connected: one quiet line with the place to connect it", [...ready, check("home-google-off")], { calendarGoogle: "not_connected" }),
  scene("home-google-closed", "Closed, it stays closed", [...ready, click("[data-home-dismiss]"), check("home-google-closed")], { calendarGoogle: "not_connected" }),
  scene("home-google-failed", "Google could not be read: said, with where to check", [...ready, check("home-google-failed")], { calendarGoogle: "unreadable" }),
  scene("home-row-hover", "A row lights its own background under the pointer, with no frame", [...ready, hover(".ho-schedule .ho-event"), check("home-row-hover")]),
  // With motion allowed he appears, then turns and speaks his line.
  { ...scene("home-motion", "With motion allowed the emblem is the desktop's own, drawn alive on a canvas", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 2000 }, check("home-emblem-live"), check("home-overview")]), motion: true },
];
