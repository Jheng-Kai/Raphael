# Owner polish

## Sub-features

The six behaviors use existing Settings, shared dialogs, private and group conversations.
No new page, setting, RPC or migration is introduced. Data's direct Delete all controls
supersede its old one-action overflow menus. The count includes conversations with saved
turns and excludes blank default conversations. History pagination uses timestamp plus id.
Data uses the shared small Settings group heading beside Delete all. Record timestamps
use local M/D HH:mm, adding YYYY/ only outside the current year.

## How to get to it (user POV)

Open Settings > Models or Data; reopen a scrolled dialog. Open a private/member/group
conversation and use its search or voice button. Caption controls remain available through
Settings, member and confirmation dialogs.

## Driving it with look

Selected look scenes: polish-effort-composer, polish-effort, polish-scroll,
polish-caption-settings, polish-caption-member, polish-caption-confirm,
polish-search-chief, polish-search-member, polish-search-room, polish-room-recording,
composer-voice-recording, quick-effort-menu and member-edit-memory. Use both themes and
1120,720,1920x1080. checks.mjs compares effort geometry, record order/pagination/counts,
scroll reset, caption hit tests and exactly-once native-boundary calls, search position,
word highlights (dotted for ordinary matches, solid and outlined for the current match) and recording glyph/labels. The driver checks search wrapping and closure.
conversation-find.test.ts also checks typing while the initial history load is pending:
the first completed result starts at the newest word, and stale replies cannot reposition it.

```powershell
npm run look -- polish-effort-composer polish-effort polish-scroll polish-caption-settings polish-caption-member polish-caption-confirm polish-search-chief polish-search-member polish-search-room polish-room-recording composer-voice-recording quick-effort-menu member-edit-memory --theme both --width 1120,720,1920x1080
```

Run npm run verify for the frontend and the focused brain/messaging tests.
Vitest uses maxWorkers=2. Inspect all sheets and relevant full-size images,
including ruler pairs and the member/group recording buttons at equal widths/themes.

## Gotchas

The group retains its browser capture boundary because native hotkey voice routing captures
a private member/conversation destination and its shell/overlay event lifecycle. Reusing it
for a group would require a separate destination and delivery/cancellation protocol. Both
paths use brain.finalize_dictation with purpose=agent; group retries retain composer
correction evidence until successful delivery. No native permission or microphone is used
in look: audio input is fake at its browser boundary.
