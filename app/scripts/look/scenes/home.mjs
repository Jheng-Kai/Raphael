import { scene, click, wait, check, page, hover } from "./steps.mjs";

// Home as Raphael the secretary (owner, 2026-11-07): emblem and greeting, a health line, today's schedule, what is open and the team.
const ready = [wait(".page-home:not([hidden]) .ho-hero"), check("home-hero"), check("home-overview")];
export default [
  scene("home", "Raphael greets the owner, reports the team's health, and shows today's schedule, what is open and the team", ready),
  scene("home-empty", "Nothing scheduled, nothing open: calm lines and 建立 for today", ready, { homeEmpty: true }),
  scene("home-team", "Every member state at once, waiting first, and more members than Home shows", [...ready, check("home-team")], { homeTeam: true }),
  scene("home-many", "Many open questions are counted below the rows Home shows", ready, { homeManyQuestions: true }),
  scene("home-problem", "A report that needs fixing speaks under the health line with its one fix", [...ready, check("home-problem")], { problem: true }),
  scene("home-calendar-rhythm", "Today's rhythm keeps its face and title, and a failed run is marked", [...ready, check("home-calendar-rhythm")], { calendarRhythm: true }),
  scene("home-own-events", "Today's own event reads in the calendar's colour and time", [...ready, check("home-calendar-language")], { homeOwnEvents: true }),
  scene("home-report", "A member report opens its conversation at the reported turn", [...ready, click('.ho-row[data-home-item="report:2"]'), wait('.page-agent:not([hidden]) .tn[data-id="2"]'), check("home-report")]),
  scene("home-member", "A member row opens that member's conversation", [...ready, click('.ho-member[data-home-member="1"]'), wait('.page-agent:not([hidden]) .composer'), check("home-member")]),
  scene("home-calendar", "The schedule's calendar icon opens the full calendar", [...ready, click('.ho-schedule header [data-home-go="calendar"]'), wait('.au-page:not([hidden]) .au-day-col'), check("calendar-shell")]),
  scene("home-more", "The count under today's rows opens today on the calendar", [...ready, click('.ho-schedule .ho-more'), wait('.au-page:not([hidden]) .au-day-col'), check("calendar-shell")]),
  scene("home-event-chip", "A schedule row opens and focuses its event on Calendar", [...ready, click('.ho-schedule [data-home-event^="event:"]'), wait('.au-page:not([hidden]) .au-day-col'), wait('.is-home-focus, .au-occurrence[aria-current="true"]'), check('calendar-shell')]),
  scene("home-create", "An empty day offers 建立, which opens the Calendar's form on today", [...ready, click('[data-home-create]'), wait(".au-pop-editor"), check("calendar-editor")], { homeEmpty: true, routines: [] }),
  scene("home-google-off", "Google not connected: one quiet line with the place to connect it", [...ready, check("home-google-off")], { calendarGoogle: "not_connected" }),
  scene("home-google-closed", "Closed, it stays closed", [...ready, click("[data-home-dismiss]"), check("home-google-closed")], { calendarGoogle: "not_connected" }),
  scene("home-google-failed", "Google could not be read: said, with where to check", [...ready, check("home-google-failed")], { calendarGoogle: "unreadable" }),
  scene("home-row-hover", "A row lights its own background under the pointer, with no frame", [...ready, hover('.ho-member[data-home-member="2"]'), check("home-row-hover")]),
  // Held 700 ms into each part: the emblem settling from its flight, the rings going out, the read line and risen sections readable.
  { ...scene("home-arrival", "Once a day Raphael flies in from his corner, rings out and reads the health line", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 700 }, { action: "home-arrive-again" }, check("home-arrival")]), motion: true },
  { ...scene("home-motion", "After his arrival the emblem turns while motion is allowed, and the hero has no ask icon", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 2000 }, check("home-emblem-motion"), check("home-overview")]), motion: true },
];
