# Dictation

## Cleanup v3 production decision and calibrated comparison (2026-11-05)

Follow-up 5 explicitly adopts v3 for the owner's short-prompt, clear-structure goal.
`core/src/raphael_core/brain/prompts/cleanup_system.md` is now the exact 3026-character
v3 text, SHA-256 a67e50307492e25343ec7e0a8fe5670665e4f1a75ef92fcc8c726ea44947c82b
on LF-normalized UTF-8 (3294 bytes), replacing the 6783-character/8119-byte prompt.
`cleanup_candidate.md` equals production. V3 preserves final intent, scope, names,
numbers, conditions, negation, original languages, dictionary and JSON boundaries;
it emphasizes an opening point, topic paragraphs and numbered enumerations.
V4 was rejected and archived with v3 under `.fold/prompts/`; the previous production
prompt is `.fold/prompts/cleanup_system_before_v3.md`. The repository change does not
claim a packaged/installed release. No model settings or judge rubric changed.

All three integrator runs scored 91/91. Columns below are old/new, including the
arbitrary two identical sides in the control; spreads always use absolute differences.

| Run | Prompt characters | Kept | Missing | Additions | Clarity old/new (ties) | All/factual case failures |
| --- | --- | --- | --- | --- | --- | --- |
| noise, identical old prompt | 6783/6783 | 569/572 | 11/8 | 3/1 | 11/12 (68) | 16/2 |
| v3 | 6783/3026 | 606/610 | 11/7 | 3/1 | 7/17 (67) | 11/2 |
| v4 | 6783/3364 | 586/591 | 19/14 | 4/9 | 14/22 (55) | 15/8 |

| Run | Language kept | Long clarity old/new (ties) | Long structure checks | All long enumerations formatted | Long topics separated |
| --- | --- | --- | --- | --- | --- |
| noise | 91/91 | 8/6 (1) | 8/10 | 5/6 | 13/14 |
| v3 | 91/91 | 3/12 (0) | 8/14 | 4/13 | 15/13 |
| v4 | 87/89 | 5/10 (0) | 11/14 | 5/10 | 14/15 |

Sources are ignored `eval/data/cleanup-compare-noise-20261105/`,
`cleanup-compare-followup-3-20261105/` and `cleanup-compare-followup-4-20261105/`.
Private text/facts never enter tracked fixtures or handoff prose. The identical-prompt
control invalidates a zero-case-failure requirement as a useful acceptance rule.
The integrator's explicit adoption of v3 is distinct from the new automatic gate.

The comparer accepts optional `--noise <report.json>`. Without it, results are still
reported but `ship_candidate=false` (complete report exits 1). Before any write or CLI
call, a supplied control must be complete with every case scored, identical prompts
matching the comparison's old prompt, the same full ordered input fingerprints,
models, seed and judge-instructions hash. Counts are recomputed from scored rows;
only safe calibration hashes, spreads and counts are retained in the target report.

Policy `noise-v1-strict` requires directional improvement STRICTLY GREATER THAN the
control's absolute old/new spread for every metric: kept facts; missing facts and
wrong additions (lower is better); language kept; overall clarity wins; list cases;
long-case clarity; lead sentence, topic separation, enumeration formatting and
structural checks on annotated long cases. Factual case failures (lost_facts OR
wrong_additions) count each case once and cannot exceed the control count. Per-case
diagnostics remain visible, but do not impose the obsolete zero-failure veto.
Every comparison case must be scored and long-case evidence must exist. No ceiling
or equality exception is inferred. Summaries list gains, spreads and failure reasons.

Consequently, strict recalculation still rejects this historical v3: additions gain
2 equals spread 2; language and lead sentence gain 0 equals spread 0; topic separation
gain -2 fails spread 1. Factual count 2 meets the control ceiling 2. V4 fails additions
and topic thresholds and its factual count 8 exceeds 2. Do not present the explicit
production decision as an automatic gate pass. Fake CLI tests prove both refusal and
a positive comparison that exceeds every spread, equality rejection and the case cap.

The runner never installs prompts. It uses serial subscription-only Codex cleanup
and tool-less Claude judgments; no OpenRouter or API credentials. One invalid judgment
gets one identical-request retry, then judge_failed; cleanup calls never retry. Failed
judgments have no wins/scores. Four judge failures or any cleanup failure stop with
exit 2; setup/control/preflight errors also exit 2. Complete non-recommendations,
including up to three failed judgments, exit 1; a calibrated passing run exits 0.

Each cleanup checkpoints immediately. Matching reports resume scored rows intact,
reuse cached cleanup outputs and finish an interrupted retry's remaining attempt.
Changed prompt/model/seed/rubric/ordered-case fingerprints refuse resume. Legacy v2
reports lack full input fingerprints; compatibility resume records that limitation.
A fully scored matching report can recompute its gate with --noise without CLI calls;
omitting --noise on a later invocation removes the recommendation, never reuses it.

The 15 versioned, self-authored long scripts are the third --cases input after the
76 private cases. Each has three topics, semantic fact floors and structure checks;
estimated speech duration is 2.8-3.3 minutes, not measured audio. Optional cached
local tokenization only; unavailable token counts remain null. CLI framing/latency
is not app latency. See `core/tests/evaluate/data/README.md` for provenance.

Required follow-up 5 offline checks: `tests/brain/test_cleanup.py`,
`tests/evaluate/test_cleanup_compare.py` and `tests/architecture` from core/.
Run targeted tests without the waiter. Full verify/core suites belong to the integrator
at merge under the resource override. No UI boundary changed, so no look/native matrix.
No new real model, provider, microphone/paste or release acceptance is claimed.

## Private member voice chat (2026-11-05)

An empty member composer keeps both gestures in its existing right-hand slot:
a pointer held for 300 ms records a voice message through the existing down/up
path, while a shorter click starts voice chat. The destination is captured at press
time and retained across navigation. Enter/Space starts voice chat; the existing
dictation hotkey is unchanged. The tooltip explains both gestures in one localized
line. Typed words/files retain Send, Raphael retains dictation, and rooms retain
their existing recording path without offering calls. The background questions
slot stays directly above the composer; transient call failures live inside the
composer and durable failures keep their existing receipt repair entry.
Not released yet (owner, 2026-11-06, R-UI-106); its scenes return with it.
One call owns the microphone across navigation. Another start opens the shared
confirmation dialog; only End and start ends the previous call. The panel replaces
the composer and exposes Mute, Hang up, a transcript disclosure and shared Voice /
Speed / Language dropdowns (Auto-detect by default). The existing character's
working and waiting motion projects speaking and listening without a second mascot.
During a call the empty-thread hero yields to that single panel character.

The same dictation recorder, device, selected engine and VAD cut a call turn after
0.8 seconds of pause. Ordinary dictation still waits for its key. VAD speech onset
sets the existing speaker stop event synchronously; PCM playback checks it before
each audio block. AgentService keeps the owner question and member reply as ordinary
private turns. The call uses the member voice and existing streamed PCM service;
speed changes its playback sample rate. No new speech vendor/model loop is added.

Hang-up writes one durable voice-call receipt, with duration, expandable literal
transcript and local Good/Bad feedback. Call message rows fold under that receipt
to preserve R-UI-101. Owner questions and pending permission/setup/draft cards remain
actionable through the ordinary turn renderer until settled; folding never removes
a required decision. Microphone/model/voice failures use the existing Settings repair
entry; network failure ends the call and retains its already admitted turns.
Migration 67 stores call metadata and links to existing turns, with scoped cascading
deletion. Restart closes interrupted calls and retains their transcript.

Voice chat is not released yet (owner, 2026-11-06, R-UI-106): the voice button records voice messages only, and the call scenes come back with the feature.

Inspect every contact sheet and each new scene at light 720 and dark 1120. Compare
the busy dialog with dialog-caption-confirm, the settings controls with details-voice, the
receipt shell with card-mcp-done, transcript disclosure with voice-memo, and the
repair note with the existing missing-service note. A call receipt is a standalone
history card; an ordinary voice memo stays attached to its existing answer.
The call confirmation uses the shared compact `mb-confirm` shell because it has one
decision, rather than the member chooser's list. Settings put the existing `sel`
controls in shared menu rows because these choices apply only to the current call;
the member's persistent voice remains in Details. The receipt's disclosure includes
the duration and both speakers, so its summary adds a time and uses a trailing
chevron. A failed call keeps its shared missing-service note inside the durable
receipt instead of the transient read-aloud toast; there is only one repair action.
Fake recognizer / streamed TTS / player tests are in tests/services/test_voice_chat.py;
the VAD test uses the real DictationService with fake recorder/segmenter/engine.
The existing native runner's `npm run native -- voice-call` journey checks the real
shell admission, empty-member/draft guard and missing-voice Settings repair with an
isolated profile and no paid speech. It does not exercise a successful audio call.
Rendered fixtures establish UI/IPC behavior only. Native microphone permissions,
headset echo isolation, installed STT/model/device, actual audio-chunk interruption,
live model/provider/network and native restart persistence require separate acceptance.


## Owner round 10 contracts (supersedes round 9 message previews)

Only owner messages use eight-line faded previews with a quiet expand action inside
the bubble. Assistant messages render fully; authored reply envelopes retain separate
bubbles and complete Markdown blocks in private and room conversations. Chief,
member and room scrollers hide their scrollbar, retain normal scrolling and expose
an accessible jump-to-latest action only when away from the bottom. New messages do
not move an owner reading older messages. Recording/STT cancels on one Escape;
in-flight in-app answers require two. Menus, dialogs and ordinary overlay keep their
existing Escape handling.

`dictionary.correct` carries bounded dictation snapshots to the same Rust Tracker
used for external editor corrections. Core owns final term acceptance and opaque,
single-use batch Undo, including prior evidence restoration. A separate passive
`learned.html` native window shows the learned batch and localized Undo at the active
monitor's horizontal center, 16 px above its taskbar. It expires after five seconds
without hover. The ordinary overlay remains click-through. Fixture pill evidence
does not establish native hit-testing, positioning, paste or persistence.

`stable-click` records the clicked view control and persistent content above it,
then rejects position/size changes over 1px after settling. Normal look clicks on
tabs, switches, pressed filters, Settings panes and view controls automatically use
it (sidebar/Home excluded for the parallel redesign). Explicit scenes cover
Connections tabs/categories, Dictionary filters and Models/Settings tabs. Existing
Calendar, member and Plugins scene clicks inherit this check. Connections search is
below the fixed Installed/Store switch in both states. A selected look report is
required to establish the actual covered controls and any remaining movements.

Round 10 scenes: `long-owner`, `long-owner-expanded`, `long-member-reply`,
`long-room-messages`, `reply-split-bubbles`, `conversation-chief-up`,
`conversation-chief-bottom`, `conversation-member-up`, `conversation-member-bottom`,
`conversation-room-up`, `conversation-room-bottom`, `overlay-learned-pill`,
`stable-connections-switch`, `stable-dictionary-controls`, `stable-settings-controls`.
Run both themes at 1120,720,1920x1080. One heavy
process at a time, Vitest --maxWorkers=2, CARGO_BUILD_JOBS=2 and the shared native
CARGO_TARGET_DIR apply.


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

## Keys with the app in front (owner reports 2026-10-31)

The global hook does not always hear the keyboard while the app's own window is in front, so everything the
keys do must work through `window-hotkeys.ts` too (`source=Window` in the log). One Esc ends a recording or a
dictation's transcription from there (R-VC-01). A question said into a conversation leaves the voice slot once
its words are in (`hand_over`), so the dictation key works during the answer (R-VC-02). `npm run native --
voice-keys` proves both with the real worker, the recognising light and a slow brain at high depth. A turn said
into a conversation has the time a typed one has; only the overlay's quick question has `VOICE_TURN_TIMEOUT_S`.

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
`app/src-tauri/src/dictation.rs`.

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
npm run look -- esc-recording-cancel overlay-confirm-short-120 overlay-confirm-long-120 overlay-confirm-short-150 overlay-confirm-long-150 overlay-confirm-short-194 overlay-confirm-long-194 overlay-confirm-expanded overlay-transcribing overlay-cleaning overlay-step overlay-long-answer --theme both --width 1120,720,1920x1080
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
these scenes. A desktop question shows no Stop beside it (2026-11-03: stopping is done
in the app); `overlay-confirm-without-stop` checks Stop is hidden and the answers are
compact buttons rather than halves of the card. The card leaves the moment an answer is
pressed and comes back only if the answer could not be sent. Two Escapes still cancel
the task through the shared gesture.

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

## Executable round 10 matrix

```powershell
npm run look -- conversation-chief-up conversation-chief-bottom conversation-member-up conversation-member-bottom conversation-room-up conversation-room-bottom reply-split-bubbles overlay-learned-pill stable-connections-switch stable-dictionary-controls stable-settings-controls --theme both --width 1120,720,1920x1080
```

## Native round 10 regression journey

```powershell
npm.cmd run native -- owner-round10 voice-conversation locale-sweep delete-conversation
```

`owner-round10` uses the bundled debug shell, real Rust correction Tracker, core
acceptance and SQLite evidence. It checks owner expansion, conversation scrolling,
two Escape presses for a pending fake answer, a complete learned batch, five-second
hover retention, exact batch/evidence Undo and expiry. Read-only Win32 inspection
checks the learned window's NOACTIVATE style, rounded click region, click-through
expiry, active-monitor placement and foreground continuity. The passive learned
window starts independently of the ordinary overlay, including native isolation.
`voice-conversation` additionally verifies one Escape cancels a new native recording.
Its speech path still requires installed local Qwen3 ASR and VAD; missing models
are BLOCKED. The pending-answer marker is inert outside isolated fake native runs.
No real provider, owner data, Gmail, Composio or OpenRouter is used.

Dictation navigation reserves the selected label width even before selection, so
English variable-font weight changes cannot shift the right-aligned tab group.
The stable-dictionary-controls scene visits Overview, History and Dictionary in
both directions. Repeat its six-cell matrix with --locale en and --locale ja in
addition to the default Traditional Chinese; native locale-sweep checks all three.

History and Dictionary filter labels also reserve their selected weight through
the shared segmented component. The same scene clicks every filter in both pages
before returning to Dictionary; locale changes update both visible and reserve labels.

## Dictation intent cleanup (2026-10-31)

Cleanup preserves every intended fact and qualification while removing abandoned drafting,
resolving self-corrections and regrouping ideas. Short clear sentences retain the existing
conservative normalization fast path. The dictionary, language variants and target-app inputs
still apply. Commands and questions stay the speaker's text, never instructions to the cleaner.

Every long cleanup request is split at sentence boundaries (1500 characters, with clause/space
and hard-cut recovery for unpunctuated speech). Bounded neighboring context (600 characters
on either side) resolves local boundary references/corrections. Successful list continuations
keep item lines and numbering; explicit paragraph boundaries retain separate lists. One failed
piece makes the whole dictation unsuccessful, with recovery text and its reason retained in
history. The words are still pasted, so nothing is lost, and the NOT_CLEANED notice says so every time.

## Passive control hit regions (2026-11-01)

R-UI-70: the desktop overlay and learned notice start click-through. The real pages
report visible physical client rectangles over the shell-only floating_controls IPC,
allowlisted only for the calling overlay/learned window. The overlay reports the
question card, question buttons, expansion button and Stop; the learned page reports
its body and Undo. A 30 ms Tauri cursor-position poll exists only while bounds remain.
Scene changes/notice completion clear holds and invalidate late geometry by revision.
UI-thread setters also reject obsolete queued changes, so a worker enable cannot
run after an immediate hide and restore interception.
NOACTIVATE and keyboard/confirmation behavior remain unchanged.

Selected existing scenes: overlay-confirm-short-120, overlay-confirm-long-150,
overlay-confirm-expanded, overlay-working-cancel, overlay-transcribing,
overlay-cleaning, overlay-step, overlay-long-answer and overlay-learned-pill, both
themes at 1120,720,1920x1080. The actual desktop viewport remains native-sized.
Frontend regressions: app/src/overlay/mouse-regions.test.ts; Rust geometry, hold,
hide, scale and caller gates: overlay/mouse.rs, overlay.rs and commands.rs tests.
Fixture evidence proves rendered controls and geometry reporting, not OS hit-testing,
focus continuity, cross-app clicks or mixed-monitor DPI. Cargo test and native
click-through/focus/DPI acceptance are separate checks.
