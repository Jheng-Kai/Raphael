# Dictation

Global questions use Raphael's persistent quick conversation. Public progress/thinking
comes from the same stored turn stream as the conversation, newest line only, in the
existing 14px caption position. No rotating placeholder status is sent. The API fast
router remains available; CLI quick questions skip auxiliary routing and native session
resume, consuming only the recent quick context and that conversation's own summary.
Native acceptance must check stale-session rejection, foreground suppression,
hotkey/transcript timing and actual first audio.

```powershell
npm run look -- overlay-step overlay-long-answer --theme both --width 1120,720,1920x1080
```

The corner never writes an address and never more than about two lines at a time (owner,
2026-10-27: 「右下角的時候並不需要有 URL」, 「要記得要做一些切分」). `overlay/caption.ts` takes
addresses and link syntax out and cuts a long line into pages at sentence ends and before
each item of a numbered list; a voiced answer holds only its last page, and pages still
waiting when the voice ends run on their own time. `overlay-long-answer` replays the answer
the owner saw run out of the window and checks that the first page is up to two lines, has
no address and stays inside the real window (the canvas and 40 px, `overlay.rs` `place`).
The voice is apart: it reads the Japanese rendering, already without addresses
(`speaker.speakable`).

Offline latency plumbing: `uv run python -m raphael_core.tools.quick_latency --fake --count 9` from core/.
Fake timings do not establish live speed. The owner runs without `--fake` for model
timings using recording execution and silent first-audio simulation, then compares
real hotkey/STT/audio logs. Only native logs prove actual transcription/playback speed.

## Sub-features

Four separate totals, activity/shortcuts, horizontal tabs, dated history, dictionary and connection notices; native
recording, recognition, cleanup, paste and correction learning. Conversation voice
and Alt+Space agent questions share cleanup and cleanup spend accounting, including
the short-clean-sentence shortcut, without a history row or target paste.

## How to get to it (user POV)

Choose Dictation, then use the compact horizontal Overview/History/Dictionary tabs beside the title. Left/Right/Home/End change the selected tab while retaining keyboard focus; selection and legacy history/dictionary deep links remain available. Four separate stat cards form a 2 by 2 left grid above activity; shortcuts start in the right column. At 720 the order is totals, shortcuts, activity. An active heatmap day opens its
history. Settings > Dictation configures recognition/shortcuts. Actual dictation
begins with the configured global key while a target field has focus.

## Driving it with look

```powershell
npm run look -- dictation-overview dictation-history dictation-history-day dictation-dictionary dictation-keyboard dictation-notice dictation --theme both --width 1120,720,1920x1080
npm run look -- overlay-transcribing overlay-cleaning --theme both --width 1120,720,1920x1080
npm run look -- composer-learn member-composer-learn room-composer-learn --theme both --width 1120,720,1920x1080
```

Keep tab/heatmap/day-filter/dictionary/settings PNGs and report; check the filter
matches fixture history. The navigation assertion checks horizontal geometry, one
selected tab, its visible panel and content overflow; the keyboard scene exercises both arrows and Home/End, ending on Dictionary. Overlay scenes drive the real overlay.html entry through synthetic native events;
check the original percentage caption during transcription and cleanup. Browser
scenes cannot record/paste. For an authorized
native test focus a disposable field, press the configured key, speak a known
harmless sentence, include a pause, and stop explicitly with the configured key or two Escapes. Observe
overlay lifetime, recognized/cleaned text, target paste and matching history. Test
cancellation separately. For agent voice, check polished composer text / Alt+Space
question delivery, cleanup spend, no dictation history and no target paste. Keep metadata and consented synthetic text only; never log
private field contents, keystrokes, pasted text or passwords for correction learning.

The four composer-learning scenes seed synthetic dictation through the existing native event
boundary, correct Open Mouse Bot to OpenMausBot, and send through the real composer.
They assert exactly one dictionary.learn call with the complete correction, exactly one
localized notice clear of the composer, and the unchanged single gold-emblem / bare-plane slot before and after send.
Only dictation seeds learning; ordinary typing and clipboard paste do not. Native microphone,
external-editor correction tracking and persistence still require isolated native acceptance.

History and dictionary rows put deletion in the overflow menu (R-UI-11). The dictionary
scene opens that menu and dismisses it before capture; the real-entry DOM test also
deletes a word through it and restores it with Undo.

## Gotchas

Typed main-window turns have independent request states and never hold the microphone or
voice session slot. Dictation and Right Alt+Space must work while any member, including
Raphael, replies; typing must also work during dictation. Voice owns the overlay first:
typed YES/NO cards remain answerable in the window and move to the overlay with their
remaining timeout once voice ends. Two Escapes during dictation cancel only that recording.
The existing `admin-approval` look scene now opens a second member question through the
native event boundary, visits that member, then returns to Raphael and requires his original
approval card. Window cards retain independent ids across members and conversations.

Controller regressions live beside the existing fake-core/overlay Rust tests in
`app/src-tauri/src/dictation.rs`. Native steps and evidence are in `DICTATION-NOTES.md`.

The fixture's populated history day is 2026-10-24; the first heatmap cell may have no
history. Mock devices/status do not prove permissions, STT or global hotkeys. Silence
must not close recording; only explicit stop/cancel or genuine microphone/STT failure
may stop it. Preserve password/elevated-window/field-scope/60-second learning safeguards.

## UI audit regression coverage

The rendered audit requires capped auto-fill Dictionary cards and aligned
shortcut labels/keys at every matrix width. Short entries add columns as space allows;
they are not the two-column long choices of R-UI-30. Keyboard navigation retains its selected
button; focus rings remain reserved for Tab navigation.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Desktop cancellation and confirmation (owner round 3)

R-UI-46 / R-AG-16: the shared 1500ms two-Escape gesture also targets the visible
recording, question or processing Stop. First Escape arms its localized hint;
second cancels once. The configured dictation/question keys continue to stop or
release recording normally. Raw global Escape exists only during active recording,
not processing, replies, jobs or speech. Recording release disables it under the
controller lock. Typed requests never enable it. A focused Raphael window may
still cancel its visible task through the shared gesture. Confirmed Stop IPC is
separate from the raw global-key stream. Native interruption markers preserve
Escape/key/click ordering without retaining typed text or pointer positions.

```powershell
npm run look -- esc-recording-armed overlay-confirm-short-120 overlay-confirm-long-120 overlay-confirm-short-150 overlay-confirm-long-150 overlay-confirm-short-194 overlay-confirm-long-194 overlay-confirm-expanded overlay-transcribing overlay-cleaning overlay-step overlay-long-answer --theme both --width 1120,720,1920x1080
```

R-UI-48: desktop YES/NO is an opaque shared `--panel` card, with an intent title,
wrapped five-line details and a localized See all/Show less control. Expanded
details scroll within nine lines. Actions occupy a separate flex row and never
cover text. It reuses app `.btn`/`.pri`, spacing, type, edge and radius tokens in
both themes. This confirmation is a card with plain intent, an explicit exception
to the ordinary overlay's 14px caption and reply-prefix treatment (R-UI-40/42).

The title and details partition the original text without copying the title back
into details. Long fixtures use distinct paragraphs, not repeated title/body blocks.
`overlay-confirmation-content` rejects duplicate intent or details paragraphs in
these scenes. Desktop Stop includes a visible localized label alongside the shared
icon; `overlay-stop-content` rejects an ambiguous lone outline square. Arming Escape
temporarily replaces both children with Esc and retains the shared cancellation hint.
Unlike the icon-only composer action, this labeled task-action variant uses the
shared text-button frame/surface required by R-UI-18, keeping its Send/Stop palette.

The native overlay remains 540px wide. Its ordinary canvas + 40px geometry is
unchanged; a question temporarily uses canvas + 300px, growing upward without
moving the emblem's bottom/right anchor. Scenes exercise emblem sizes 120/150/194,
short/long details and expansion. Each requested matrix size is recorded alongside
the actual native viewport in `report.json`; desktop evidence is intentionally
540px wide, not a stretched 1920px webpage. Native physical keys, focus switching,
DPI, click-through and microphone/paste still require manual acceptance.

The consistency comparison uses ordinary app dialogs (`delete`) for the neutral
opaque surface and `.btn`/`.pri` tokens. The in-app administration approval retains
its existing gold identity; the desktop uses a neutral surface for reading over
arbitrary desktop content. Its actions fill a separate row within the narrow 540px
window rather than a wide dialog's right-aligned pill actions. These size/layout
differences are intentional; the shared button height, palette and type remain.

## Owner round 4 layout and microphone locale

Overview totals always use a 2 by 2 grid. At the 760px dictation-container threshold,
shortcuts occupy the right column starting beside the first total; activity follows
the totals in the left column. Narrow order is totals, shortcuts, activity. History
and dictionary CSS are unchanged. Locale sweep excludes known OS microphone device
names (full or the displayed prefix before a parenthesized driver) only within
[data-k=mic], [data-ob=mic] or .mic-ctl controls. Automatic and surrounding app copy
remain checked. Names outside those controls remain checked.

The left desktop track is capped at two short-card measures plus the existing
12px grid gap, so Activity and the two stats columns share their right edge
without stretching a stat beyond 384px. dictation-layout asserts those edges.

## Owner round 6 contracts

Owner round 6: dictation removes the spoken-languages helper while retaining the setting. dictation-overview uses the shared pencil icon button for changing shortcuts, with an accessible localized name and matching tooltip. compact-action checks this alongside Usage export at the same widths/themes.

## Owner round 9 regression coverage

Ordinary listening/working orb states show no Stop button (owner, 2026-10-30).
Focused two-Escape cancellation uses the orb as its gesture target and still sends
the existing cancellation IPC. Alt hotkeys remain in the existing Rust controller.
Permission/question cards keep their current actions and expansion. This supersedes
any earlier ordinary-orb Stop wording; composer and permission Stop controls remain.

```powershell
npm run look -- overlay-working-cancel --theme both --width 1120,720,1920x1080,1280x800
```
