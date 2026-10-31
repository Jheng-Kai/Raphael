import { scene, click, wait, check, scroll, page, key, hover } from "./steps.mjs";

const ready = [wait(".page-home:not([hidden]) .ho-hero"), check("home-hero"), check("home-overview"), check("home-redesign"), check("home-month")];
export default [
  scene("home", "Home briefing with reports, pending items, calendar and usage", ready),
  scene("home-empty", "Home without pending work, reports, events or usage", ready, { homeEmpty: true }),
  scene("home-sparse", "Four stable summaries with no events/reports, some spend, one CLI with windows and one without", ready, { homeSparse: true }),
  scene("home-720", "Home responsive layout, scrolled to the charts", [...ready, scroll(".ho-dictation"), check("home-overview")]),
  scene("home-report", "A member report opens its conversation at the reported turn", [...ready, click('.ho-row[data-home-item="report:2"]'), wait('.page-agent:not([hidden]) .tn[data-id="2"]'), check("home-report")]),
  scene("home-routine", "A marked calendar day opens the full calendar", [...ready, {action:'home-day',date:'2026-10-24',open:true}, wait('.au-page:not([hidden]) .au-day-col'), check("calendar-shell")]),
  scene("home-calendar", "The mini calendar opens the full calendar", [...ready, {action:'home-day',date:'2026-10-30',open:true}, wait('.au-page:not([hidden]) .au-day-col'), check("calendar-shell"), check("home-calendar-day")]),
  scene("home-adaptive-calendar", "Available width and height choose compact agenda or full event grid", [...ready, scroll('.ho-calendar'), check('home-month')]),
  scene("home-selected-day", "A date opens that day on the Calendar page, in every layout", [...ready, {action:'home-day',date:'2026-10-30'}]),
  scene("home-own-events", "Home's calendar is a small view of the same calendar: its chip, time and today mark", [...ready, scroll('.ho-calendar'), check("home-calendar-language")], { homeOwnEvents: true }),
  scene("home-create", "An empty day offers 建立, which opens the Calendar's form on that day", [...ready, click('[data-home-create]'), wait(".au-pop-editor"), check("calendar-editor")], { homeEmpty: true, routines: [] }),
  scene("home-google-off", "Google not connected: one quiet line with the place to connect it", [...ready, check("home-google-off")], { calendarGoogle: "not_connected" }),
  scene("home-google-closed", "Closed, it stays closed", [...ready, click("[data-home-dismiss]"), check("home-google-closed")], { calendarGoogle: "not_connected" }),
  scene("home-google-failed", "Google could not be read: said, with where to check", [...ready, check("home-google-failed")], { calendarGoogle: "unreadable" }),
  scene("home-event-chip", "A day event opens and receives focus on Calendar", [...ready, click('[data-home-event^="event:"]'), wait('.au-page:not([hidden]) .au-day-col'), wait('.is-home-focus, .au-occurrence[aria-current="true"]'), check('calendar-shell')]),
  scene("home-month", "The whole month fits without an inner scroll", [...ready, scroll('.ho-calendar'), check('home-month')]),
  { ...scene("home-month-navigation", "Arrows and Today change month without moving the controls", [...ready, click('[data-home-month="1"]'), wait('.ho-calendar[data-month="2026-11"]'), check('home-month'), click('[data-home-month="-1"]'), wait('.ho-calendar[data-month="2026-10"]'), check('home-month'), click('[data-home-month="1"]'), click('[data-home-today]'), wait('.ho-calendar[data-month="2026-10"]'), scroll('.ho-calendar'), check('home-month')]), motion: true },
  scene("home-month-swipe", "Horizontal trackpad and touch swipes change month without navigating away", [...ready, {action:'wheel',selector:'.ho-calendar',deltaX:100,deltaY:0}, wait('.ho-calendar[data-month="2026-11"]'), {action:'touch-swipe',selector:'.ho-calendar',dx:120}, wait('.ho-calendar[data-month="2026-10"]'), check('home-month')]),
  scene("home-calendar-background", "A click outside the dates still opens the full calendar", [...ready, {action:'click-position',selector:'.ho-calendar',x:.02,y:.02,expect:'.au-page:not([hidden]) .au-day-col'}, check('calendar-shell')]),
  scene("home-many", "Many pending questions stay within their card", ready, { homeManyQuestions: true }),
  scene("home-block-navigation", "Every Home block navigates from both distant corners, preserving inner report controls", [
    ...ready,
    ...[
      ['.ho-inbox', '.page-agent:not([hidden]) .composer', false],
      ['.ho-spend', '.modal-scrim #models-tab-usage[aria-selected="true"]', true],
      ['.ho-allowance', '.modal-scrim #models-tab-usage[aria-selected="true"]', true],
      ['.ho-dictation', '.page-dictation:not([hidden])', false],
    ].flatMap(([selector, expect, modal]) => [[.02, .98], [.98, .02]].flatMap(([x, y]) => [
      { action: 'click-position', selector, expect, x, y }, ...(modal ? [key('Escape')] : [page('home')]), ...ready,
    ])),
    click('.ho-row[data-home-item="report:2"]'), wait('.page-agent:not([hidden]) .tn[data-id="2"]'), check('home-report'),
  ]),
  scene("home-block-interactions", "Whole Home blocks show edge-only hover and keyboard-only focus states", [
    ...ready, ...['.ho-inbox', '.ho-spend', '.ho-allowance', '.ho-dictation', '.ho-calendar'].map(selector => ({ action: 'surface-interactions', selector: `${selector} > .ho-target` })),
  ]),
  scene("home-hover", "Hover lights only the edge, preserving the background and every inner element", [...ready, ...[".ho-inbox", ".ho-spend", ".ho-allowance", ".ho-dictation", ".ho-calendar"].map(selector => ({ action: "surface-interactions", selector: `${selector} > .ho-target`, hoverOnly: true }))]),
  { ...scene("home-motion", "Raphael's emblem turns on Home when motion is allowed: the loop plays, and the hero has no ask icon", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 600 }, check("home-emblem-motion"), check("home-overview")]), motion: true },
];
