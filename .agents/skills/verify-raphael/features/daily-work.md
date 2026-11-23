# Commands, routine limits and owner output

## Work and files in the member panel

Details places newest member work before the existing routines and conversation list in Details (R-PANEL-01/02). A row opens its existing result and keeps stop/rerun in the shared contextual menu. Library lists recorded artifacts/pages and a bounded local workspace/team snapshot through shared file chips, grouped This week / Earlier with Show more. Empty sections use one sentence. New files remain at their existing location; browsing creates no task, computer or filesystem content. Output-folder preferences and delivery permissions remain governed by R-OUTPUT-01. See [Member computer](member-computer.md#three-tab-member-panel-and-local-engine-recovery) for the selected two-theme/three-size matrix and evidence scope.

## Calm conversations

See [Conversation](conversation.md#calm-conversations) for R-UI-101/R-CLI-07 and the selected matrix. Routine origins now name the routine inside its reply, with the existing editor target. Failures appear once; rerun shares reply/copy actions. Public work receipts collapse into reply detail; calendars and owner cards retain their behavior. This supersedes older transcript trigger-chip and between-message receipt descriptions.


## Sub-features

- R-NAV-01: Ctrl+K opens a searchable command/member palette using the shared
  popover. Ctrl+Shift+F searches all conversations; Ctrl+F opens the existing
  finder for the current chief/member/room conversation; Ctrl+B toggles the
  responsive sidebar. Ctrl+1..9 selects the displayed member order. Alt+Up/Down
  selects the previous/next conversation of the current member, without wrapping.
  IME and repeated keys suppress every shortcut. Visible modals own keyboard
  input; mounted hidden settings do not block shortcuts. The
  Ctrl combinations (K, F, Shift+F, B, N, 1..9) also work while a text field,
  such as the composer, has the focus, because none of them types anything;
  Alt+Up/Down stay with the text and the combinations a field uses itself
  (Ctrl+A, C, V, X, Z, Y, Enter, arrows) are never taken.
- R-ROUTINE-01: A member, including Raphael, can keep any number of routines.
  Every trigger shares admission: 300 runs per rolling hour across the
  team, 200 for one member. Persisted bounded admission receipts survive deletion
  and restart; historical run rows also count. A limited scheduled slot retries
  after one minute without changing last_run. Event receipts remain pending and
  authenticated webhooks return 429. Recent history returns the newest 20 with
  the full total, preserving older rows for calendars, accounting and max_runs.
- R-ROUTINE-02: 30 days without owner interaction pauses enabled routines with a
  localized explanation. Existing installations begin observation on upgrade.
  The returning owner's first viewing report pauses before updating activity;
  it never resumes work automatically. Explicit enable clears the reason.
  Pointer/key interaction reports through members.viewing at most once a minute;
  scheduler and background list refreshes are not presence.
- R-OUTPUT-01: Members save files to their selected project or their own shared folder. Owner context supplies
  the work, team and remaining project paths as the member sees them. Report export falls back to Downloads.

## How to get to it (user POV)

Press Ctrl+K, type a command/member name or shortcut and press Enter, or use the
shared arrow-key menu controls. Escape restores the originating control. Open
Settings › General for Project folders. A paused routine's reason appears in the
member's existing details list; review it and enable through the existing editor.
The keyboard palette opens near the top center because it has no clicked
trigger. Cross-conversation search stays anchored to the sidebar picker. Both
use the same shared popover surface and search field.

## Driving it with look

Follow-up 1 authorizes the following selected rendered matrix, contact-sheet and
full-size review. Run after the shared heavy waiter says clear, or after its
timeout under the follow-up's explicit exception. Native/live remain deferred.

```powershell
npm run look -- shortcut-new-in-composer shortcut-sidebar-in-composer shortcut-member-in-composer command-palette command-palette-filter command-palette-member shortcut-find-chief shortcut-find-member shortcut-find-room shortcut-search project-folders-settings routine-guard-reason chat sidebar-rail sidebar-drawer --theme both --width 1120,720,1920x1080
```

Inspect every contact sheet and full-size palette, compact search/finder,
General setting and paused reason. Compare palette rows to the member picker and
cross-conversation search at matching theme/width; compare the project rows with nearby General settings, and reasons with existing event errors.
Run judge on that same selected run only after network/subscription and external
reference prerequisites are authorized. The original no-network/no-paid-API
restriction still defers judge; do not infer design acceptance from look alone.

Existing deferred native journeys: readable-layout, locale-sweep and
delete-conversation. Additional native acceptance steps still need a journey in
the existing native runner: actual Ctrl/Alt routing, editable/IME suppression,
sidebar rail, private and room find, per-member conversation movement,
folder persistence/restart and authorized delivery to an isolated temporary
folder. Confirm an existing file stays in its old folder after a preference
change. No live brain or real owner file is authorized here.

## Gotchas

Offline tests prove admission and prompt contracts, not a live model's filesystem
delivery or native keyboard behavior. Whole run history is retained; only the
visible recent list is capped. Owner activity is app interaction, not OS presence.
Rate limits count accepted attempts, including later refused/failed execution;
uncertain work is never replayed. Polling checks are not routine runs. Scheduled
work retries the limited slot without advancing max_runs accounting. The current
member's Alt navigation does not switch between group rooms.


## Routine tests and timezone preference

General adds a searchable IANA timezone preference; blank means auto-detect.
Changing it affects new schedules. Each saved routine keeps its original zone.
The setting uses the existing settings.set boundary; owner activity reports the
browser-detected zone through members.viewing, never through Home reads or model tools.
See automations.md for the selected routine-zone, routine-zone-search and
routine-zone-saved journeys, fake-only evidence, DST policy and full matrix.

Explicit Test once in the shared editor/row menu uses the same 300 team/200 member
rolling-hour admission receipts, worker cost limits and member conversation history.
A paused test never resumes scheduled work. R-ROUTINE-02 owner-presence pausing and
explicit re-enable remain authoritative. Rate or worker refusal has readable words.
All provider payloads and Slack messages in this brief are synthetic; external
HTTPS forwarding, real authentication and native subscription delivery remain
separate acceptance.


## Native project folder choice

R-COLLEAGUE-06 uses the native picker from General or the member composer. General lists remembered projects
and forgets each from its own menu. Removal resets the selected work folders and leaves project files in place.

```powershell
npm run look -- project-folders-settings project-folder-picker project-folder-picker-cancel project-folder-remove --theme both --width 1120,720,1920x1080
```

The browser fixture proves the visible list, picker result, cancellation and removal. Verify the native dialog,
file manager and matching host and Docker files separately.
