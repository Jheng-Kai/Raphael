# Group chats and folders

Owner decision 2026-10-30 removes the Team page, route and spatial canvas.
The global sidebar owns folder creation, rename, collapse, member moves and order.
Member brain display remains in the details panel. The plus offers new members
and group chats. Everyone is the existing all-member `is_team` room in the room list.
Opening an uncreated Everyone entry creates it once through production rooms.create.
Composite room avatars use two or three participants' own faces consistently.
Each 40px composite contains complete round faces with their own avatar background
and a 2px ring matching the normal, hovered or selected row, or the header surface.
Keep header and sidebar geometry identical; never crop the composite as one circle.

Keep the existing room composer, mentions, roles, Stop, reply references, source
events and durable handoffs. The same AgentService owns member work.

Everyone in a room reads each message and decides for themselves, on their own model, through
one small question (`room_listener`); a CLI or local brain reads an owner's message in a real turn
and may pass. An address is always answered. Nothing hands out the floor or sums up unasked, and no
turn is given a template: a meeting closes and finished work reports back in plain words (R-AG-02).
A member's question waits above the room's composer, the room's row says so, and
`question-reminder.ts` says it once when the owner is elsewhere (R-AG-34).

```powershell
npm run look -- room-question-card question-reminder --theme both --width 1120,720,1920x1080
```

Pin/hide and read position persist in SQLite migration 44. Hidden rooms appear in
search and can be restored through their menu. Reading marks only the open room.
Room previews ignore hidden pass replies and unresolved worker status.
The look IPC boundary derives preview, timestamp and unread from room messages,
matching the production rooms.list projection. Reading preserves preview and time.
Home selects only the brand; only a visible conversation selects its member or room.

Run `sidebar-group-avatar`, room-text, room-mentions and the
affected room action scenes. Native readable-layout, locale-sweep and
delete-conversation use the shared sidebar. Keep fake brain, isolated data and one
heavy process at a time. No judge or paid/live requests are authorized for this brief.

Owner review regression scenes: sidebar-group-avatar-hover, sidebar-group-avatar-pair,
sidebar-room-home and sidebar-unread. Run every sidebar-prefixed scene plus home,
home-hover and chat in both themes at 1120, 720 and 1920x1080. The native
readable-layout journey checks two- and three-face rooms, production RPC summaries,
and selection after leaving each room for Home. Inspect contact sheets and full-size
images separately from automated assertions.
Keep a requested room ID separate from the complete loaded Room while opening.
An update can supersede that first refresh: never render an incomplete placeholder,
leak the previous room's content, or lose the destination of a message sent during
loading. The deferred-refresh regression test covers the native notification race.

## Sub-features

Global folders, Everyone, group avatars, persistent room actions, mentions and work.

## How to get to it (user POV)

Open a room in the global sidebar; use the menu button in a compact window.

## Driving it with look

```powershell
npm run look -- sidebar-folders sidebar-folded sidebar-group-avatar sidebar-chief-pinned sidebar-rail room-text room-mentions --theme both --width 1120,720,1920x1080,1280x800
npm run look -- sidebar-group-avatar-hover sidebar-group-avatar-pair sidebar-group-avatar-four sidebar-room-home --theme both --width 1120,720,1920x1080
```

The following retained room and sidebar journeys cover their shared consumers:

```powershell
npm run look -- sidebar sidebar-many sidebar-unread sidebar-drawer sidebar-search sidebar-plus sidebar-owner room --theme both --width 1120,720,1920x1080
npm run look -- room-composer-empty room-composer-hover room-workflow-blocked room-final-owner room-progress-status-only room-no-dangling-mention room-short-wrapup room-handoff-queued --theme both --width 1120,720,1920x1080
npm run look -- room-handoff-running room-handoff-result room-handoff-failed room-immediate-work room-source-dates-not-schedule handoff-centred-line mentions-bots-apps plus-create-room --theme both --width 1120,720,1920x1080
npm run look -- room-routing-fallback room-role-assignment room-round-typing room-mention-after-hop-limit room-mention-after-turn-limit room-mention-blocked room-wrapup-after-replies compact-rooms --theme both --width 1120,720,1920x1080
npm run look -- new-room room-group-menu room-draft room-menu room-replies room-discussion room-wrapup new-room-responder --theme both --width 1120,720,1920x1080
npm run look -- room-required-chief room-generated-name room-private-isolation room-reply-owner room-reply-peer room-reply-source-missing room-reply-send room-thinking --theme both --width 1120,720,1920x1080
npm run look -- room-stop room-row-menu room-rename room-members room-delete room-hover esc-room-armed --theme both --width 1120,720,1920x1080
```

The following retained room and sidebar journeys cover their shared consumers:

```powershell
npm run look -- sidebar-owner-upload --theme both --width 1120,720,1920x1080
```

## Gotchas

Synthetic IPC does not establish native persistence, provider or design acceptance.

## Folded room receipts (2026-11-02)

R-UI-72 groups consecutive handoff rows using the same renderer as private turns. handoff-group-room places a message between two receipt runs and requires two groups; handoff-group-open verifies disclosure identity during WorkerChanged delivery and arriving data. See conversation.md for the selected shared matrix. Individual receipt and room workflow checks retain their request/result/artifact protections.
