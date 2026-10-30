import { scene, click, wait, check, scroll, page, key, hover } from "./steps.mjs";

const ready = [wait(".page-home:not([hidden]) .ho-hero"), check("home-overview"), check("home-redesign")];
export default [
  scene("home", "Home briefing with reports, pending items, calendar and usage", ready),
  scene("home-empty", "Home without pending work, reports, events or usage", ready, { homeEmpty: true }),
  scene("home-sparse", "Four stable summaries with no events/reports, some spend, one CLI with windows and one without", ready, { homeSparse: true }),
  scene("home-720", "Home responsive layout, scrolled to the charts", [...ready, scroll(".ho-dictation"), check("home-overview")]),
  scene("home-report", "A member report opens its conversation at the reported turn", [...ready, click('.ho-row[data-home-item="report:2"]'), wait('.page-agent:not([hidden]) .tn[data-id="2"]'), check("home-report")]),
  scene("home-routine", "A marked calendar day opens the full calendar", [...ready, click('.ho-calendar > .ho-target'), wait('.au-page:not([hidden]) .au-occurrence'), check("calendar-shell")]),
  scene("home-calendar", "The mini calendar opens the full calendar", [...ready, click('.ho-calendar [data-home-go="calendar"]'), wait('.au-page:not([hidden]) .au-occurrence'), check("calendar-shell")]),
  scene("home-hover", "Hovering a Home block keeps its content visible; only the block background changes", [...ready, hover(".ho-spend"), check("home-hover-content")]),
  scene("home-many", "Many pending questions stay within their card", ready, { homeManyQuestions: true }),
  scene("home-block-navigation", "Every Home block navigates from both distant corners, preserving inner report controls", [
    ...ready,
    ...[
      ['.ho-inbox', '.page-agent:not([hidden]) .composer', false],
      ['.ho-spend', '.modal-scrim #models-tab-usage[aria-selected="true"]', true],
      ['.ho-allowance', '.modal-scrim #models-tab-usage[aria-selected="true"]', true],
      ['.ho-dictation', '.page-dictation:not([hidden])', false],
      ['.ho-calendar', '.au-page:not([hidden]) .au-day-col', false],
    ].flatMap(([selector, expect, modal]) => [[.02, .98], [.98, .02]].flatMap(([x, y]) => [
      { action: 'click-position', selector, expect, x, y }, ...(modal ? [key('Escape')] : [page('home')]), ...ready,
    ])),
    click('.ho-row[data-home-item="report:2"]'), wait('.page-agent:not([hidden]) .tn[data-id="2"]'), check('home-report'),
  ]),
  scene("home-block-interactions", "Whole Home blocks show hover, pressed and keyboard-only focus states", [
    ...ready, ...['.ho-inbox', '.ho-spend', '.ho-allowance', '.ho-dictation', '.ho-calendar'].map(selector => ({ action: 'surface-interactions', selector: `${selector} > .ho-target` })),
  ]),
  { ...scene("home-motion", "Raphael's emblem turns on Home when motion is allowed: the loop plays, and the hero has no ask icon", [wait(".page-home:not([hidden]) .ho-hero"), { action: "freeze-motion", at: 600 }, check("home-emblem-motion"), check("home-overview")]), motion: true },
];
