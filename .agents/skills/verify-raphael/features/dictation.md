# Dictation

## macOS

The same controller runs on a Mac (`dictation.rs` `app::spawn`, no longer Windows-only). The dictation key is Right
Option (the `AltRight` binding: one key code, named by `keys.ts` and `mac-catalogs.ts`). What differs:

- Hotkeys: the event tap of `vendor/handy-keys/src/platform/macos/listener.rs`, with the four Raphael patches of the
  Windows hook (swallowed modifier releases, injected input ignored, Esc and other input reported to the cancel gesture,
  Space before its modifier). Without Accessibility the service waits (`hotkey.rs` `late`) and starts when it is given.
- Paste: `paste/macos.rs` puts the text on the pasteboard with nspasteboard.org's transient markers, sends ⌘V (the key
  that types "v" on the layout), and puts the clipboard back after `pasteboard::READ_WAIT`. A target is the focused
  window's window-server number, its process and its app's bundle identifier (lowercased).
- The layout is read on the main thread only: `keys.rs` `on_main` hands `key_for` and
  `layout_needs_option` to the main queue, and `layout()` gives nothing anywhere else. On macOS 26 the paste and copy
  threads' own reading stopped the app (a libdispatch assertion in `TSMGetInputSourceProperty`) after every dictation
  and every tidy. A main thread that does not answer within 500 ms means the ANSI V and C keys.
- Permissions follow the app's signature: a rebuilt or updated ad hoc app is another app to macOS, whose old entry
  under Accessibility no longer counts. When the hotkeys start without Accessibility, macOS asks with its own question
  (`permissions::accessibility(true)`; macOS 26 asks again for an entry of another signature) and the window adds no
  note beside it (R-PRIV-AX-01). The app never clears its own entry: cleared while that question was up, Raphael was
  missing from the list the question opened. Raphael missing from the list, or on without effect, is added from
  Applications with + (the listed one removed with − first), which the note says. Another version or signature
  of the app (a build folder, an older disk image) may not match the entry allowed, and opening the app again can bring
  forward a copy still running: quit every copy before allowing the one in Applications. A local build signed with
  one Apple Development identity keeps its permissions across rebuilds.
- The microphone on macOS (R-PRIV-MIC-01): a recording starts only once macOS lets the app use it, read without waiting
  before anything shows 聆聽中 (`dictation.rs` `macos_microphone_gate`). Not decided yet, macOS's question comes up and
  the overlay says `MIC_ASKED` (allow Raphael, then press the key again); refused, it says `MIC_DENIED` with the pane.
  Nothing is recorded meanwhile: a recording that waited for the question showed 聆聽中 before it could hear, and a key
  let go meanwhile stopped it the moment it started. Settings > 聽寫 listens to the microphone for its meter only once it
  is allowed (`microphone_permission`, read without asking, again when the window comes to the front; the shell also
  refuses `audio.monitor` on until then); not decided, 測試麥克風 (`microphone_ask`) asks macOS once; refused, the
  `missing.microphone` note opens the Microphone pane.
- Without Accessibility macOS drops a posted key unseen: `paste` keeps
  the text on the pasteboard and says `NO_PASTE_PERMISSION` (press ⌘V), the tidy key says `NO_TIDY_PERMISSION`, and
  both tell the main window (`missing.accessibility`, `hotkey.rs` `tell_accessibility_missing`, at most once a minute),
  whose button opens the Accessibility pane. Without Accessibility no global key is heard at all, so Settings > 聽寫 shows
  the same note above the shortcuts while `accessibility_access` (read without asking) says false, read again when the
  window comes back to the front: the place an owner who pressed Deny finds the pane again.
- Learning from corrections: `learn/ax.rs` reads the focused text element through the accessibility API; terminals are
  not watched on macOS.
- Media: `media/macos.rs`, MediaRemote where macOS answers, else Music, Spotify, TV and VLC through `osascript`.
- The tidy key is Right Option+T: `paste/macos.rs` `copy` sends ⌘C (every app copies with it, terminals included), waits
  for the pasteboard's change count as Windows waits for the clipboard's sequence number, reads the text and puts the
  person's pasteboard back. The posted chord carries ⌘ alone, so the Right Option still held is not seen with it.
- Microphone choice: `mic_choice.py` knows a Mac's own microphone (and a nearby iPhone's) as built in and BlackHole,
  Soundflower and the meeting apps' virtual devices as loopbacks.
- Verify on a Mac by hand in `npm run tauri -- dev` (the terminal is the app macOS asks permissions for); `npm run
  native` is Windows-only.

## The spoken languages: one row each, written forms beside the picker; cleanup in no one language

Settings > Dictation > 你說的語言 opens one picker with every language on one row (checked or not, up to five). A chosen
language with several written forms (中文: 台灣、香港、簡體、粵語; English; Español) ends its row with a chip naming the form in
use (`data-variant-menu`); the chip, or Right on it, opens the forms in a submenu beside the picker (`placement: "beside"`,
`variantMenuHTML`), so the list never grows or jumps. A pick closes only the submenu (`closeSubmenus`) and keeps the picker open.
The core rules are unchanged: one form per language, the order is the priority.

The chip's accessible name is one translated string (`languages.variantsOf`, the language and the form in use) and it has
no `title`: the form is on the chip already. A language's own name ("English", "日本語", "English (United States)") carries
its `lang`, so it is read in that language; the Chinese names, which the window translates, carry none. The look audit
does not take text marked with another language's `lang` for English interface copy (R-UI-14), which "English" in this
list otherwise was in a zh-TW window.

Cleanup is in no one language (R-DICT-CLEAN-01). The cleanup prompt (`prompts/cleanup_system.md`) names fillers, correction
cues and particles by kind; the semantic calls are the model's and only hard limits are rules (never add a word, particle,
question or question mark; never reorder, merge or drop a sentence). Every dictation goes to the model, however short: no
length or mark test can tell, in every language, that "Um I think so." holds a filler, so there is no shortcut past it. The
first three chosen languages add their worked examples (`prompts/cleanup_examples.<subtag>.md`, one for every language of the
settings; mainland Chinese gets the Chinese ones in Simplified, character by character, so they use words both regions write
alike). A missing file of examples fails the tests and the bundle's audit (`core/packaging/build.py prompt_files`); the
prompt before the dictionary stays under 5,000 characters for every choice of languages. After the model only the whole
text's last full stop goes, and only one that ends nothing but a sentence (。 and the like, R-DICT-STOP-01,
`drop_final_full_stop`); a Latin dot may close "3 p.m." or "etc.", so it is the model's to leave out. Nothing checks after
the model that it invented no question: the prompt says so, and how well models follow the new prompt on real dictation is
unmeasured (the paid comparison `cleanup_compare` has not been run on it).

What proves it: `tests/brain/test_cleanup.py`, `test_dictation_finish.py`, `test_service.py`, `tests/test_dictation_latency.py`
and `tests/test_packaging.py` from core/.

```powershell
npm run look -- dictation-languages dictation-language-variants dictation-language-variants-toggle --theme both --width 1120,720,1920x1080
```

## The tidy key: Right Alt+T tidies the text that is selected

In any app, select text and press Right Alt+T; the
dictation cleanup tidies it and it replaces the selection, the clipboard is what it was, and Ctrl+Z in that app undoes it as
for any paste. R-TIDY-01. It is a dictation feature and nothing else was added to the app: one key, stored in the device
settings as `tidy_keys` beside `paste_last_keys` (empty allowed: then there is no key), one row in Settings > 聽寫 (`settings-tidy-key`:
named 整理選取文字, with its key caps and a pencil, between 貼上上一次 and 取消) and one line in the 聽寫 overview's shortcut card. No first-run lesson.

How it runs. The hook reports `HotkeyEvent::Tidy` for the chord exactly as it reports `PasteLast` for Right Alt+V: the Right Alt
went down first and started a dictation, and `DictationController::tidy_at` drops a recording that is less than a second old
as quietly as paste-last does (the release of the Right Alt then does nothing and the next press is a start, in both modes), and
does nothing while a longer dictation, a processing one or a YES/NO question is there. The work is a processing session of its own
(the window's Stop ends it, the dictation key waits for it, Esc stays the app's, the overlay shows the dictation's own thinking state and its percentage, then the
completion). `Paster::copy_selection` snapshots every format of the clipboard, lets go of the held modifiers, sends the program's
copy chord (Ctrl+C; Ctrl+Shift+C for a terminal, whose Ctrl+C is an interrupt; Ctrl+Insert for mintty), waits at most 400 ms for
the clipboard's sequence number to change, reads the text and puts the snapshot back. Nothing new on the clipboard is "nothing
selected": nothing is pasted and the overlay says 《告。未選取任何文字。》. The text goes to the core's `dictation.tidy` (Brain: the
cleanup's model, dictionary, languages, target-app tone, chunking, guards and spend, plus `brain/tidy.py`'s addendum that the text
was typed, not spoken, so the prompt template is untouched), and the reply is pasted through the dictation's own paster into the
same window; if the focus moved meanwhile it stays on the clipboard with the dictation's notice. A failure (no key or model, no
connection, a reply that is no tidying, a window that cannot be copied from, a selection of more than 30,000 characters) pastes
nothing, keeps the selection and the clipboard, and says 《否。這次沒有整理成功，原文未更動。》: the raw text is never pasted as
if it were tidied, and the answer of the core carries no `text` unless it was tidied.

```powershell
npm run look -- settings-tidy-key settings-mic-undecided settings-mic-denied settings-accessibility-off dictation-overview dictation --theme both --width 1120,720,1920x1080
```

The other layers, each from its own folder (the core's tests, the shell's):

```powershell
cd core; $env:PYTHONPATH="$PWD\src"; .\.venv\Scripts\python.exe -m pytest tests/brain -q
cd app\src-tauri; cargo test --lib -- hotkey:: dictation:: commands:: device_settings:: paste:: notices:: core_process::
```

`settings-tidy-key` opens Settings > 聽寫 and checks that the row is there after the dictation shortcuts and before Esc, shows
右 Alt and T, has its pencil where the question key's is, is as high and as wide as that row, has a whole name and does not make
the page scroll sideways, and that no Accessibility note shows where that permission is not missing;
`settings-accessibility-off` is a Mac without Accessibility (the look mock's `accessibility_access` answers false): 聽寫
shows the `missing.accessibility` note above the shortcuts, saying to add Raphael with +, no wider than them, with the one
button that opens the Accessibility pane (R-PRIV-AX-01);
`settings-mic-undecided` and `settings-mic-denied` are a Mac whose microphone macOS has not asked
about, or refused (the look mock's `microphone_permission`): 聽寫 shows the note above the shortcuts, no wider than them,
the meter never sends `audio.monitor` on, 測試麥克風 calls `microphone_ask` once, and a refused one has the button that
opens the Microphone pane and no 測試麥克風 (R-PRIV-MIC-01), run as on a Mac whatever the host (the scene's `mac`), since
only a Mac has that pane; `dictation-overview` also requires the shortcut card to list five shortcuts. Not proved here: a real
selection in a real app. A test cannot press keys or use the clipboard, so the owner tries it in a chat box, a document and
a terminal: the selection is replaced, Ctrl+Z undoes it, what they had copied is still on the clipboard, Win+V shows their copied
text once (the program's own copy is the one thing that cannot be kept out of clipboard history), nothing selected shows the
short line, and no recording is left running behind Right Alt+T.

## Automatic microphone picks the headset and stays on it

With a wireless headset on, automatic must not jump between it and the laptop's array (the microphone menu lists
自動偵測（目前：…）, the headset as 麥克風 (3- …), 立體聲混音 and 麥克風排列).
The risk is in `core/src/raphael_core/device/audio.py`: automatic opens PortAudio's default, the Sound Mapper
(whichever device Windows calls the default), and when its first 0.3 s was digitally silent `_find_live_input` took the
first live input of PortAudio's own order, Stereo Mix included (it is live whenever anything plays), with the "last good"
microphone remembered by a name whose 「3- 」 Windows renumbers. Which of the headset, Stereo Mix and the array won
depended on what was playing and what was listed first. R-MIC-AUTO-01 and R-MIC-AUTO-02: the order and its memory are
`device/mic_choice.py` (an attached microphone before a built-in array, never a loopback, the same one while it is plugged
in, a new attached one takes over; nothing at a recording's start moves it, and only two whole silent recordings of one
never heard pass it over), used by `audio.py`'s `_pick_device`, `MicRecorder.stop` (which tells it what the recording was)
and `automatic_device_name` (the menu's 「目前」 label). Nothing is probed at a start: a quiet headset would lose to the
array at every one.

```powershell
cd core; $env:PYTHONPATH="$PWD\src"; .\.venv\Scripts\python.exe -m pytest tests/device -q
```

No scene changes: the menu's words are the same. Not proved here: a real headset (no audio device is opened in a
test); check that automatic shows and stays on 麥克風 (… HyperX …) with the headset on, and moves to 麥克風排列 only
when it is unplugged.

## Raphael stays in front of an open page while the owner is heard

With an HTML page such as 每日總覽 open in Raphael's conversation, pressing the app's own voice button must show that the
app is listening, so the indicator is never behind the page. The indicator is the voice
mode's flyer (`voice-mode.ts`, `.ra-flyer`), a child of the conversation's stage; `page-view.css` sets every stage child but
the thread, the page and the composer to `display: none` while a page stands (`.ra-stage.is-page`), so the flyer must be
exempt, because the thread's own "hearing" line is hidden with the thread. R-VC-04: the flyer is the child that stays, in front of the
page and above the composer, takes no pointer over a page while the owner speaks, and flies back into the composer when the
recording ends, over a page as anywhere (it does not stay held over the page until the words come back, nor after the
send). `voice-over-page-answered` speaks over a page, sends, and has the words come back as a voice turn.

```powershell
npm run look -- voice-over-page-listening voice-over-page-hearing voice-over-page-gone voice-over-page-answered voice-flyer-emblem page-inplace --theme both --width 1120,720,1920x1080
```

The three `voice-over-page-*` scenes open the news page in a member's conversation (`ownerVoice: "pending"`: the mock core
says listening, then processing, and no turn comes) and check, at the listening and the hearing step, that the flyer is
drawn at 132 px, centred in the stage, inside it and over the page, clear of the composer, that with the flyer made
hit-testable for a moment `document.elementFromPoint` at its centre and four points of its ring is the flyer, that it takes
no pointer (the page's frame is what a pointer over it reaches), that the thread and its hearing line are hidden under the
page, and that the composer says recording, then ack; the last scene ends the dictation and requires the flyer gone, the
button its own again and the page still open. The page's own scrolling is `page-collapsed-press` and `page-inplace`'s.
Not proved here: the real microphone, the real recognizer and the owner's page.

## The dictionary on every dictation, and learning that fires

Dictionary words must correct what is heard, and the automatic saving of corrections to the dictionary must fire.
Where the dictionary could be lost, and what carries it (R-DICT-STT-01, R-DICT-SPELL-01, R-DICT-PROMPT-01):

1. Speech-to-text. MAI-Transcribe 2 gets the dictionary as an Azure phrase list
   (`openrouter.transcription_body`, `provider.options.azure.phraseList.phrases`; `keyterms` is a 400). Words the
   owner chose come first, learned ones after, 50 at most. Local Qwen3-ASR keeps its hotwords; the other cloud models
   still get none (their fields are undocumented, and Azure refuses unknown ones).
2. Cleanup prompt. Beside each word the transcript may hold misheard, the prompt names those parts (「這次可能是」,
   `mishearing.misheard_spans`: same first letter, one edit in six letters and two in more, no plural, not another
   dictionary word, or the word split apart); rule 10 says text listed under an entry is that entry misheard. The
   short-sentence shortcut runs only when no such part is found (`BrainService._needs_no_model`).
3. Final text. The cleanup model often ignores the named word, so the paste is respelled by rule inside
   Chinese or Japanese text (`textnorm.respell_dictionary_words`): other letter case, a split, or a name misspelt with a
   capital or split ("Pinebox", "Pine Bus" → 「pinebot」, "Kelver" → 「kelvr」). English text, lower-case
   ordinary words and dictionary words of four letters or fewer are left alone. A dictionary entry's case wins in
   Chinese text: an owner's 「alt」 and 「Bots」 come out as typed.

Learning (R-LEARN-UIA-01, R-LEARN-TERM-01, R-LEARN-SHOW-01): in a member's conversation the composer learned only
when `agent_ask_text` returned, which is when the whole answer ended, so a long turn hid the pill for minutes; it now
learns as the message goes (a group composer still learns on delivery). Outside the app, a paste into Claude's desktop composer never started a
watch (`probe stopped (stage: focused_ancestry)` in `%LOCALAPPDATA%\Raphael Dev\logs`): the composer is
36 levels deep and the walk stopped at 32. The walk now allows 128 and every `Chrome_WidgetWin_*` window is Chromium
(retries). A lower-case name corrected from a plausible mishearing is learned; rewording never is. The first correction
makes the word a term and the pair a hint: in the phrase list and the prompt from the next dictation, shown under
常被聽成 in the Dictionary row (`dictionary.list` `heard`), and a replacement rule when the same pair is seen again.

Follow-up from the owner's 113 dictations of the same day (R-DICT-SPELL-02, R-DICT-HINT-01, R-LEARN-FORM-01,
R-DICT-KANA-01), all core text steps proved by pytest, none by the app:

- The respelling never turns 「SpaceX」 into 「Space」 (a longer word that holds a dictionary word is right), keeps a
  plural's ending (「pinebots」), and respells a real word such as 「Cloud」 only where a rule or a correction's form is
  on record. A form seen once is evidence for it, though it is no rule yet: the Dictionary row still shows it under
  常被聽成, and `dictionary.misheard` stays empty until the pair is seen twice.
- The cleanup prompt lists a dictionary word with Chinese characters for a Chinese transcript only when a form it is
  heard as is in it, so 「讀寫」 and 「本地端」 are not offered words one character away. The phrase list is unchanged.
- A Chinese text with one or two stray kana is converted to the chosen script, in the transcript and after cleanup;
  Japanese (a tenth hiragana, three at least) stays as it is.

Proof, in this order:

```powershell
npm run look -- dictation-dictionary stable-dictionary-controls --theme both --width 1120,720,1920x1080
```

`npm.cmd run native -- dictation-dictionary` (an OpenRouter key, about US$0.002 a run) synthesizes mixed speech
(Hanhan for the Chinese, David for 「kelver」 and 「pine bot」), plays it as the microphone through
`RAPHAEL_FAKE_AUDIO`, and drives the real dictation key, MAI-Transcribe 2, the cleanup model and the paste into the
composer: 「pinebot」 comes out as spelled; the owner's edit of "Kelver" to 「kelvr」 is learned with its pill and
Dictionary row; the next dictation writes 「kelvr」. The sample is a remark, never a request, the journey's agent may only
plan (`action_mode` plan), and two Escapes stop the corrected message's turn once the pill is up. The journey brings its own window to the front before a recording
stops and cancels the dictation if another window takes it, so no words are pasted anywhere else.

The learning watch in a Chromium window has no journey (no external window is driven): the ignored
`learn::uia::tests::native_read_only_foreground_probe` runs against a throwaway Edge window (`--app`, its own empty
profile) whose composer is 40 groups deep, brought to the front without a key press. With the old 32-level walk it
logs `focused_ancestry`; with the fix it reads the field (`field probe (sources: 2)`, `fixture_found=true`).

## Cleanup v3 production decision and calibrated comparison

The production prompt has since been rewritten in no one language, with worked examples per
language (R-DICT-CLEAN-01, the section on spoken languages above); it has not been through this
comparison. What follows records the v3 decision and how the comparison works.

Follow-up 5 explicitly adopts v3 for the owner's short-prompt, clear-structure goal.
`core/src/raphael_core/brain/prompts/cleanup_system.md` was then the exact 3026-character
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

## No voice output

Dictation is unchanged, but nothing speaks: no voice calls, no spoken Alt+Space answer and no voice service (see
[Conversation](conversation.md#no-voice)). The composer's voice button records a voice message
on a click, a hold or a key (R-UI-106).


## Message previews and reply bubbles

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
without hover. Its window never has a title bar, not even in its style, whatever tao rewrites
(R-LEARN-WIN-01, `overlay/frame.rs`). The window is there only while a notice is: it is made hidden and with an empty
title, shown without activation once the notice is sized, placed and shaped, and hidden again 220 ms after the notice ends
(Undo, expiry or a click) unless a new one came; no pale bar and no English title stays on a Chinese interface
(R-LEARN-WIN-02, `learned.rs`). The ordinary overlay remains click-through. Fixture pill evidence
does not establish native hit-testing, positioning, paste or persistence.

`stable-click` records the clicked view control and persistent content above it,
then rejects position/size changes over 1px after settling. Normal look clicks on
tabs, switches, pressed filters, Settings panes and view controls automatically use
it (sidebar/Home excluded for the parallel redesign). Explicit scenes cover
Connections tabs/categories, Dictionary filters and Models/Settings tabs. Existing
Calendar, member and Plugins scene clicks inherit this check. Connections search is
below the fixed Installed/Store switch in both states. A selected look report is
required to establish the actual covered controls and any remaining movements.

Scenes: `long-owner`, `long-owner-expanded`, `long-member-reply`,
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
Native acceptance must check stale-session rejection, foreground suppression and
hotkey/transcript timing.

```powershell
npm run look -- overlay-step overlay-long-answer --theme both --width 1120,720,1920x1080
```

The corner never writes an address and never more than about two lines at a time (it needs no URL,
and the text is cut into parts). `overlay/caption.ts` takes
addresses and link syntax out and cuts a long line into pages at sentence ends and before
each item of a numbered list; each page runs on its own time. `overlay-long-answer` replays the answer
the owner saw run out of the window and checks that the first page is up to two lines, has
no address and stays inside the real window (the canvas and 40 px, `overlay.rs` `place`).

Offline latency plumbing: `uv run python -m raphael_core.tools.quick_latency --fake --count 9` from core/.
Fake timings do not establish live speed. The owner runs without `--fake` for model
timings using recording execution, then compares real hotkey/STT logs. Only native logs
prove actual transcription speed.

## Keys with the app in front

The global hook does not always hear the keyboard while the app's own window is in front, so everything the
keys do must work through `window-hotkeys.ts` too (`source=Window` in the log). One Esc ends a recording or a
dictation's transcription from there (R-VC-01). A question said into a conversation leaves the voice slot once
its words are in (`hand_over`), so the dictation key works during the answer (R-VC-02). `npm run native --
voice-keys` proves both with the real worker, the recognising light and a slow brain at high depth. A turn said
into a conversation has the time a typed one has; only the overlay's quick question has `VOICE_TURN_TIMEOUT_S`.

A question said to the overlay (Alt+Space) leaves the slot the same way, and the dictation key always wins (R-VC-03):
pressed while the answer is worked on, asked a yes or no, or on the overlay, it dictates at once. The answer is held while
a recording has the overlay and told again once the words are typed, for its ordinary time; a newer quick question
replaces it. The shell's timing is proved by the `dictation.rs` tests named in R-VC-03; the one thing the corner shows
is the answer arriving behind the dictation's 100 %, which `overlay-held-answer` replays on the real overlay page:

```powershell
npm run look -- overlay-held-answer --theme both --width 1120,720,1920x1080
```

Only a real key press proves the rest: Alt+Space, a question that takes a while, Right Alt during the answer and the
answer appearing after the pasted words (`npm run native -- voice-keys` covers the conversation case only).

## Sub-features

Four separate totals, activity/shortcuts, horizontal tabs, dated history, dictionary and connection notices (a notice's sentence wraps in balanced lines, CJK text breaking at its punctuation, instead of hanging 3 px past its box when the line only fits by trimming its CJK punctuation; `conversation-notice` at 720 px); native
recording, recognition, cleanup, paste and correction learning. Conversation voice
and Alt+Space agent questions share cleanup and cleanup spend accounting, including
the short-clean-sentence shortcut, without a target paste. They are kept
in the history as `kind="ask"` with the recipient's name in `target_app` (Rust sends `member_id` with
`dictation.stop`, 0 for Raphael); the row says 「傳給 拉斐爾」 (`history-sent-to` in dictation-history).
Paste-last, the lifetime totals and dictionary learning still use dictations only.

## The closing full stop and the guards after the model

Every result (cleaned, cleaned in pieces, the raw fallback) loses only the whole text's last full stop, and only one that
ends nothing but a sentence (`textnorm.drop_final_full_stop`, R-DICT-STOP-01): 。 goes in Chinese and Japanese alike, a
Latin dot stays for the model to judge, and full stops inside the text, code and inline code stay. No rule after the model
edits a word in any one language: the remover of an unspoken 嗎 is gone with the other Chinese-only steps, and the prompt
says in terms that the model adds no particle, question or question mark (unmeasured on real dictation). Tests:
core/tests/brain/test_dictation_finish.py. Before that, `textnorm.guard_cleanup_text` drops a first or last
paragraph (or outer line) the transcript mostly does not have (below half of its characters/words, dictionary
words counting as present), so a model's note, answer or preface never reaches the paste; a result with nothing
left falls back to the normalized raw text as `suspicious` (core/tests/brain/test_cleanup_guard.py). MAI-Transcribe
is called with automatic language detection (no hint): a forced zh would bend English names.

## How to get to it (user POV)

Choose Dictation, then use the compact horizontal Overview/History/Dictionary tabs beside the title: the app's shared plain tabs (ui.ts `tabs`, the same as Connect apps), never a look of their own. Every return to Dictation opens on Overview, whichever tab was last chosen; nothing is kept between visits. Left/Right/Home/End change the selected tab while retaining keyboard focus; legacy history/dictionary deep links remain available. The overview's small words (card labels, the activity sum, the heatmap axis and legend, shortcut names) are medium weight in the secondary ink rather than thin grey. Four separate stat cards form a 2 by 2 left grid; shortcuts stand beside them in the right column, end with them and share the header tabs' right edge, and the activity heatmap runs under both. At 720 the order is totals, shortcuts, activity. A heatmap day says its words only in its title under the pointer;
pressing it does nothing, and no history opens from the grid. Settings > Dictation configures recognition/shortcuts. Actual dictation
begins with the configured global key while a target field has focus.

## Driving it with look

```powershell
npm run look -- dictation-overview dictation-history dictation-heat-press dictation-dictionary dictation-keyboard dictation-notice dictation --theme both --width 1120,720,1920x1080
npm run look -- overlay-transcribing overlay-cleaning overlay-emblem-gold overlay-emblem-angry --theme both --width 1120,720,1920x1080
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
boundary, correct "Sample Too" to "SampleToolX", and send through the real composer.
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
native event boundary, visits that member, then returns to Raphael and requires its original
approval card. Window cards retain independent ids across members and conversations.

Controller regressions live beside the existing fake-core/overlay Rust tests in
`app/src-tauri/src/dictation.rs`.

The fixture's populated history day is 24 October 2026; the first heatmap cell may have no
history. Mock devices/status do not prove permissions, STT or global hotkeys. Silence
must not close recording; only explicit stop/cancel or genuine microphone/STT failure
may stop it. Preserve password/elevated-window/field-scope/60-second learning safeguards.

## UI audit regression coverage

The rendered audit requires capped auto-fill Dictionary cards and aligned
shortcut labels/keys at every matrix width. Short entries add columns as space allows;
they are not the two-column long choices of R-UI-30. Keyboard navigation retains its selected
button; focus rings remain reserved for Tab navigation.

## Shared content measures

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Desktop cancellation and confirmation

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
these scenes. A desktop question shows no Stop beside it (stopping is done
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

## Overview layout and microphone locale

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

## The shortcut button in the overview

Dictation removes the spoken-languages helper while retaining the setting. dictation-overview uses the shared pencil icon button for changing shortcuts, with an accessible localized name and matching tooltip. compact-action checks this alongside Usage export at the same widths/themes.

## The orb's Stop and two-Escape cancellation

Ordinary listening/working orb states show no Stop button.
Focused two-Escape cancellation uses the orb as its gesture target and still sends
the existing cancellation IPC. Alt hotkeys remain in the existing Rust controller.
Permission/question cards keep their current actions and expansion. This supersedes
any earlier ordinary-orb Stop wording; composer and permission Stop controls remain.

```powershell
npm run look -- overlay-working-cancel --theme both --width 1120,720,1920x1080,1280x800
```

## Executable look matrix

```powershell
npm run look -- conversation-chief-up conversation-chief-bottom conversation-member-up conversation-member-bottom conversation-room-up conversation-room-bottom reply-split-bubbles overlay-learned-pill stable-connections-switch stable-dictionary-controls stable-settings-controls --theme both --width 1120,720,1920x1080
```

## Native regression journey

```powershell
npm.cmd run native -- conversation-and-learned-pill voice-conversation locale-sweep delete-conversation
```

`conversation-and-learned-pill` uses the bundled debug shell, real Rust correction Tracker, core
acceptance and SQLite evidence. It checks owner expansion, conversation scrolling,
two Escape presses for a pending fake answer, a complete learned batch, five-second
hover retention, exact batch/evidence Undo and expiry. Read-only Win32 inspection
checks the learned window's NOACTIVATE style, that its window style has no title bar
(R-LEARN-WIN-01: while shown, after Undo and after expiry), rounded click region, click-through
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

## Dictation intent cleanup

Cleanup preserves every intended fact and qualification while removing abandoned drafting,
resolving self-corrections and regrouping ideas. A short clear sentence is cleaned like any other
(R-DICT-CLEAN-01). The dictionary, language variants and target-app inputs
still apply. Commands and questions stay the speaker's text, never instructions to the cleaner.

Every long cleanup request is split at sentence boundaries (1500 characters, with clause/space
and hard-cut recovery for unpunctuated speech). Bounded neighboring context (600 characters
on either side) resolves local boundary references/corrections. Successful list continuations
keep item lines and numbering; explicit paragraph boundaries retain separate lists. One failed
piece makes the whole dictation unsuccessful, with recovery text and its reason retained in
history. The words are still pasted, so nothing is lost, and the NOT_CLEANED notice says so every time.

## Passive control hit regions

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
