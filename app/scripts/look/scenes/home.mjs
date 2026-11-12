import { scene, click, wait, check, hover } from "./steps.mjs";

// Home: Raphael's live emblem beside the greeting and his line, then what to do now and what must not be missed today:
// the timed things now and next, what waits for his decision, today's tasks, what is overdue and the routines in one
// line (owner, 2026-11-12). Each part is absent when it has nothing to say. No figures, chart, table or tooltip.
const ready = [wait(".page-home:not([hidden]) .ho-hero"), check("home-hero"), check("home-overview")];
const day = [...ready, check("home-day"), check("home-fit")];
export default [
  scene("home", "Raphael greets the owner with his line, then the parts of the day: now and next, what waits, today's tasks, the overdue and the routines", [...ready, check("home-day")]),
  // His real day (25 items from his task board: 12 overdue, 8 due today, the Notion summary and 4 timed, 12 routine runs, nothing waiting):
  // the whole page fits one screen at a desk-sized window and scrolls as a page at a narrow one.
  scene("home-day-real", "His real day: 3 timed rows, 5 of today's tasks and 4 to follow, 3 of 12 overdue, one routine line, all on one screen", [...day], { homeDay: "real" }),
  scene("home-day-quiet", "A quiet day: two timed things and nothing else, with no heading and no gap for what is absent", [...day], { homeDay: "quiet" }),
  scene("home-day-heavy", "A heavy day: 40 overdue stay one block of one size, today's tasks stay five, what waits is counted", [...ready, check("home-day")], { homeDay: "heavy" }),
  // Start-up reads (owner, 2026-11-11): the first view's reads are answered before any optional read starts, and the optional ones run one at a time.
  scene("home-startup-order", "At start-up the Home overview and the roster are answered before the model, app and settings reads start, and those never overlap", [...ready, { action: "startup-order",
    firstView: ["home.overview", "members.list", "rooms.list"], heavy: ["models.catalog", "brains.cli"] }], { coreLatencyMs: 60 }),
  scene("home-empty", "Nothing scheduled, waiting or owed: his line says so, and 建立 for today stands alone", [...ready, check("home-empty-day")], { homeEmpty: true }),
  scene("home-many", "Many waiting questions are all counted: five rows and one for the rest, each opening its conversation", [...ready, check("home-questions")], { homeManyQuestions: true }),
  scene("home-problem", "A report that needs fixing speaks under his line with its one fix", [...ready, check("home-problem")], { problem: true }),
  scene("home-calendar-rhythm", "A routine due many times is one line with its face, done of due, the failed run named and the next", [...ready, check("home-calendar-rhythm")], { calendarRhythm: true }),
  scene("home-own-events", "The owner's own event on now leads now and next, in the calendar's time", [...ready, check("home-calendar-language")], { homeOwnEvents: true }),
  scene("home-calendar", "The calendar's icon beside the date opens the full calendar", [...ready, click('.ho-date [data-home-go="calendar"]'), wait('.au-page:not([hidden]) .au-day-col'), check("calendar-shell")]),
  scene("home-more", "A day of many timed things: only the one on now and the next two are shown", [...ready, check("home-day")], { homeMore: true }),
  scene("home-event-chip", "A row of now and next opens and focuses its event on Calendar", [...ready, click('.ho-next [data-home-event^="event:"]'), wait('.au-page:not([hidden]) .au-day-col'), wait('.is-home-focus, .au-occurrence[aria-current="true"]'), check('calendar-shell')]),
  scene("home-create", "An empty day offers 建立, which opens the Calendar's form on today", [...ready, click('[data-home-create]'), wait(".au-pop-editor"), check("calendar-editor")], { homeEmpty: true, routines: [] }),
  scene("home-google-off", "Google not connected: one quiet line with the place to connect it", [...ready, check("home-google-off")], { calendarGoogle: "not_connected" }),
  scene("home-google-closed", "Closed, it stays closed", [...ready, click("[data-home-dismiss]"), check("home-google-closed")], { calendarGoogle: "not_connected" }),
  scene("home-google-failed", "Google could not be read: said, with where to check", [...ready, check("home-google-failed")], { calendarGoogle: "unreadable" }),
  scene("home-row-hover", "A row lights its own background under the pointer, with no frame", [...ready, hover(".ho-next .ho-event"), check("home-row-hover")]),
  // With motion allowed he appears, then turns and speaks his line.
  { ...scene("home-motion", "With motion allowed the emblem is the desktop's own, drawn alive on a canvas", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 2000 }, check("home-emblem-live"), check("home-overview")]), motion: true },
];
