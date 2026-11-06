# Home

## Sub-features

### Product contract (owner, 2026-11-07, R-UI-114)

Home is Raphael as a secretary. The owner asked for today's plans and the team's state,
not quotas, tokens or dictation counts; no boxes; no scroll on a small screen.

- **Hero.** His emblem stands in the middle (128px, 96px when the main area is 760px or
  narrower), then a greeting by the time of day (早安／午安／晚上好，主人) at --fs-h1, the date,
  and one health line in plain words: all members are well, or who waits for the owner. A
  report that needs fixing (no key, OpenRouter offline, budget used up) adds its own line and
  one fix icon; a well budget says nothing. The main window never shows the 《告。…》 caption
  wrapper (R-UI-42), so the report's words are unwrapped with `plainReplies`. No ask-Raphael icon (R-UI-43). The emblem turns
  while motion is allowed, stands still under reduced motion, and stays the same DOM node
  through refreshes.
- **Three sections** side by side (one column when the main area is 640px or narrower):
  今天的行程, 還沒解決的事 and 成員, the last narrower as it holds only names and states. In a
  narrow main area an open item drops its time to keep its words. Each is a heading over a hairline and at most four rows;
  the rest is counted below them. Rows are plain buttons that light their own background
  under the pointer; nothing is framed.
- **Today's schedule** lists today's items from the month projection, all-day first, then by
  time: the time, the calendar's colour as a short tick (own events ink, routines the
  member's slime colour, Google outline grey), the title, a failed or waiting run's mark and
  the face or Google's mark. A rhythm shows its repeat mark, face and title, never a time
  (R-CAL-03). What is over is dimmed, never a run that failed. The heading's calendar icon
  resumes Calendar (R-CAL-04); a row opens its event; the count opens today. Empty, it says
  今天沒有行程 and offers 建立. The Google line (not connected, once and closable; could not be
  read, until it reads) sits under the rows (R-UI-66).
- **What is still open** lists questions and reports, never routines; a row opens the
  conversation at its turn.
- **成員** lists every member the owner sees except Raphael, the ones who wait for the owner
  first (in the warning colour), then the ones at work (the core's activity words), unread,
  and standing by. A row opens that member's conversation. A `MemberActivity` event redraws
  the row and the health line without a read.
- **Arrival.** On Home's first showing of a day (`raphael.home.arrived` in guarded
  localStorage), he flies in from his bottom-right corner, two gold rings go out around him,
  the health line is read out left to right and the sections rise. The page drops
  `data-arrive` when the outer ring, the last part, has gone (a held animation keeps it). Under reduced motion he is simply there and
  the day still counts as seen.

## How to get to it (user POV)

The square Home button at the sidebar's foot. At narrow widths, open the sidebar drawer
first.

## Driving it with look

```powershell
npm run look -- home home-empty home-team home-many home-problem home-calendar-rhythm home-own-events home-report home-member home-calendar home-more home-event-chip home-create home-google-off home-google-closed home-google-failed home-row-hover home-arrival home-motion --theme both --width 1120,720,1920x1080
```

home-hero measures the centred emblem, greeting and health line; home-overview requires no
main-area scroll, three unboxed sections, at most four plain rows each, no money or
percentages and the turning emblem. home-team checks the order, the count and the warning
colour; home-arrival holds each part of the arrival 700 ms in (the `home-arrive-again` action forgets the
day and returns to Home) and checks the flight, the gold ring and the read-out line;
home-motion holds it at 2000 ms, after the arrival. The calendar scenes prove each way into
Calendar. Inspect every sheet and the full-size images in both themes.

Native readable-layout inspects Home at 720, 1920x1080 and 1280x800 and opens Calendar from
the schedule's icon; the calendar journey opens a member's event from today's schedule;
home-timing proves Home paints before the core's live allowance read finishes.

## Gotchas

### Data and refresh boundaries

home.overview remains the projection of the schedule and what is open; `members.list` gives
the team, read through the same coalesced event read as the sidebar. home.overview reads the
app's own events (`own_calendar.py`, `calendar_events`) beside routine occurrences and Google
events, and says what Google is in `calendar_google`. It still carries usage, allowances and
dictation for other callers; Home draws none of them.
refresh=false reads local records and cached events/allowances without a CLI or provider
request. Home paints it before the coalesced refresh=true read (at most one per five
minutes). Member, question, conversation, routine, calendar, settings and connection changes
refresh Home. Locale changes redraw cached Home even behind Settings without an RPC or
replacing the emblem.

At most the three earliest items per local date are projected, with full daily counts;
Home counts what it does not draw. Preview limits remain 12 today items, eight reports and
24 events.

Google Calendar uses connectors.status(refresh=false) and the existing private
calendar_list_events tool only when ACTIVE/enabled; the `composio:googlecalendar` toolkit
also supplies it through the fixed core read path, and the direct Google sign-in wins when
readable. Unavailable, disabled or expired connections yield no connected events, and
`calendar_google` says which it was; own events and local routines remain available.

Offline pytest covers the projection and HTTP doubles. Browser fixtures prove the UI;
isolated fake-brain native journeys prove the desktop path. Neither proves live
calendar/OAuth/provider scheduling.
Follow the shared [content-width contract](README.md#content-width).
