# Commands, routine limits and owner output

## Sub-features

- R-NAV-01: Ctrl+K opens a searchable command/member palette using the shared
  popover. Ctrl+Shift+F searches all conversations; Ctrl+F opens the existing
  finder for the current chief/member/room conversation; Ctrl+B toggles the
  responsive sidebar. Ctrl+1..9 selects the displayed member order. Alt+Up/Down
  selects the previous/next conversation of the current member, without wrapping.
  IME and repeated keys suppress every shortcut. Visible modals own keyboard
  input; mounted hidden settings do not block shortcuts. Editable fields only
  permit Ctrl+K outside another modal. The existing Ctrl+N also respects fields.
- R-ROUTINE-01: A member, including Raphael, has at most 50 routines, enabled or
  paused. Every trigger shares admission: 300 runs per rolling hour across the
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
- R-OUTPUT-01: Settings > General owns the optional absolute owner output folder.
  Blank keeps the task destination. The existing shared owner_context supplies
  its escaped path and default delivery instruction to API, CLI and background
  speakers. This grants no tool/OS permission. VM paths are not owner-PC paths;
  unavailable authorized delivery uses export/attachment and reports the limit.
  Saving/changing the preference never creates, moves or rewrites existing files.

## How to get to it (user POV)

Press Ctrl+K, type a command/member name or shortcut and press Enter, or use the
shared arrow-key menu controls. Escape restores the originating control. Open
Settings > General for Output folder. A paused routine's reason appears in the
member's existing details list; review it and enable through the existing editor.
The keyboard palette opens near the top center because it has no clicked
trigger. Cross-conversation search stays anchored to the sidebar picker. Both
use the same shared popover surface and search field. The output folder uses
the settings text-field helper, matching the SSH-host and city rows.
The output-folder scene checks the field height against General's owner-name
field, its text inset and the rendered saved path.

## Driving it with look

Follow-up 1 authorizes the following selected rendered matrix, contact-sheet and
full-size review. Run after the shared heavy waiter says clear, or after its
timeout under the follow-up's explicit exception. Native/live remain deferred.

```powershell
npm run look -- command-palette command-palette-filter command-palette-member shortcut-find-chief shortcut-find-member shortcut-find-room shortcut-search owner-output-folder routine-guard-reason chat sidebar-rail sidebar-drawer automation-edit --theme both --width 1120,720,1920x1080
```

Inspect every contact sheet and full-size palette, compact search/finder,
General setting and paused reason. Compare palette rows to the member picker and
cross-conversation search at matching theme/width; compare the folder field with
the owner profile and SSH-host field, and reasons with existing event errors.
Run judge on that same selected run only after network/subscription and external
reference prerequisites are authorized. The original no-network/no-paid-API
restriction still defers judge; do not infer design acceptance from look alone.

Existing deferred native journeys: readable-layout, locale-sweep and
delete-conversation. Additional native acceptance steps still need a journey in
the existing native runner: actual Ctrl/Alt routing, editable/IME suppression,
sidebar drawer/rail, private and room find, per-member conversation movement,
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
