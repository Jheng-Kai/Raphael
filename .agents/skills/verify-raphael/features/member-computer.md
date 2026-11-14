# Member computer (Phases A and B)

## A member's files, as Claude Code works on them (owner, 2026-11-14)

R-TOOL-03, R-FILE-01 to R-FILE-05. The owner: 「所有的 harness 都要統一 就是跟 claude 設計的一樣 或是參考 hermes agent」. A member read, searched
and changed the files of its computer through `vm_exec` (`cat`, `sed`, heredocs): the head of the output only, no numbers, no
paging, nothing that checked the text it replaced, and whole files under the 16,000-character argument cap. Its computer now
offers Claude Code's file tools beside `vm_exec`, with Claude Code's parameters and words:

| Tool | Copies | What it does here |
| --- | --- | --- |
| `read_file {path, offset?, limit?, pages?}` | Read | `cat -n` lines, 2000 from `offset`, a line over 2000 characters cut, 60,000 characters a read, the offset to go on from; a picture as an image (or what the owner's vision service sees in it, for a model that reads no pictures); a PDF as the text of its pages, 20 a call |
| `edit_file {path, old_string, new_string, replace_all?}` | Edit | exact text, unique unless `replace_all`; read in this run first, refused if changed since; keeps BOM and CRLF; returns the edited lines numbered |
| `write_file {path, content}` | Write | a whole file; over an existing one only after a read in this run and if unchanged since; folders made |
| `glob {pattern, path?}` | Glob | `rg --files`, newest first, 100 at most |
| `grep {pattern, path?, glob?, type?, output_mode?, -i, -n, -A, -B, -C, context, multiline, head_limit, offset}` | Grep | ripgrep; files_with_matches (default, newest first), content or count; 250 entries a page by default |

Where they live: `computer/file_tools.py` (definitions, the run's read state `FileReads`, edit and read logic, ripgrep's
command line and output), `computer/files_guest.py` (the guest's reads and compare-and-rename writes, standard library only,
sent like `checkpoints.py`), `services/lines.py` (the line reader, shared), `LocalVm.file_request` and `Docker.__call__`'s
`input` (the request and the file over `docker exec -i` stdin), `VmTools._call` (dispatch, the checkpoint before a write, not
screen work), `worker.guards.argument_limit` (200,000 characters for `write_file` and `edit_file` only). A run is a turn (its
id) or a task; what it read is the file's sha256. Paths are absolute or taken from `/home/cua/workspace`; in the workspace and
the team folder the guest opens each component without following a link. Searches skip `.git`, `.browser-profiles`,
`.raphael-checkpoints` and `.raphael-jobs` and honour `.gitignore`; they search hidden files. Results pass the same login
redaction as every computer tool. No card asks for any of these in the member's own computer; the CLI vendors' own Read,
Write, Edit, Glob, Grep and shell stay off (R-PC-01): a CLI brain gets these through the `computer` MCP server.

Offline evidence (fake docker `Runtime`; the guest helper itself runs on a folder of the test; ripgrep's answers are scripted):
`core/tests/computer/test_file_read.py`, `test_file_tools.py`, `test_file_search.py`, and `test_catalog_stays.py` (the
catalog's descriptions: 17,756 characters per member before R-TOOL-03, 11,132 after it, 13,446 with the five tools; at a
seat 18,364, 11,740 and 14,054; ceiling 14,500).
No UI changes, so no look run. Not run: a real computer (`verify -- --computer` was not run: no image change), ripgrep's
own flags against the image's ripgrep, a live turn of each brain (`verify -- --live`), the providers' acceptance of the
dashed parameter names (`-i`, `-A`) that Claude Code's Grep uses.

## The first call after a wake is waited for; "your computer" is the member's (owner, 2026-11-14)

R-COMP-FIRST-01, R-COMP-OWN-01. From the owner's own conversations: a member's first computer action after a sleep failed with
`docker_stopped`, `driver_configuration_failed` or `task_stopped` nine times, and he had to say 「再試一次」; and 「用你的電腦開…」,
said into the overlay, opened the page on his own PC with an empty reply.

- Start: `VmTools._call` waits through `_awake` (the start, again after a pause while it fails with `TRANSIENT_START`; at most
  `start_attempts` tries and `start_budget_s` seconds), then `_configured` (the driver's refusal of its first set-up calls,
  `TRANSIENT_CONNECT`), and the lost-connection repair is a retry of the same kind with the right to bring Docker Desktop back.
  A real failure (Docker absent, Docker Desktop not launched or not up in two minutes, no image, no room, the owner's hold or Stop)
  is the answer at once. `ComputerWork.begin` revives a work item whose stop was only inferred from a cancelled first call.
  Offline: core/tests/computer/test_first_call.py (fakes for each transient kind, the bound, each real failure, the cut-short call
  and the owner's own stop).
- Whose computer: `agent/whose_computer.py` reads a quick request (member, owner, unsure). The member's goes to the member's turn
  with the owner's PC out of reach; the owner's keeps the router and the shortcut; an unsure open request is asked once
  (`which_computer`); the shortcut says `opened`. Offline: core/tests/agent/test_whose_computer.py. The quick overlay's own look
  scenes are unchanged (no UI change), so no look run.

## The computer wakes by a decision, waits for a loaded PC, keeps its panels whole (owner, 2026-11-14)

R-COMP-WAKE-01, R-COMP-LOAD-01, R-COMP-PANEL-01, R-COMP-TYPE-01 (image `driver-0.37.0-v11`). The owner: 「電腦的部分你可能要再改好一下…
你就一次把所有東西都修復吧」, with the wake policy asked for in his words: the computer wakes when a member decides a task needs it (its
own computer tool) or when he starts it, never merely by opening a conversation or a panel, and not silently.

Wake policy (read first, then changed). Read in the code: a member's computer tool starts a sleeping computer without any question
(`vm_tools.py::VmTools.call`, `vm.start`), which is the member's decision and stays; opening a conversation or a panel starts
nothing (`desktop-viewer.ts` streams only a computer that already runs; only a press starts one, `viewer.py::_open` with
`vm.launch`); but `web_read` (`agent/tools.py`) fell back to the member's browser whenever a page read under 600 characters, came
back bad, or asked for scripts or cookies, and that fallback went through `rendered_read` and `VmTools.call`, which woke the
computer for a page read; and nothing counted the owner's open stream as activity, so the idle bound (15 minutes,
`vm.py::sweep`) could put a computer to sleep under his eyes.
- `web_read` no longer wakes it. `VmTools.rendered_read` looks first (`_awake`: a status read, never a start); asleep it returns
  `computer_asleep`, and the page comes back as read with `READ_NEEDS_BROWSER` ("your computer is asleep and reading a page does
  not wake it; call browser_open with its address yourself"), or, for a page that did not read at all, the failure with that
  instruction. An awake computer is still used for a short page: nothing is started, the gate, the audit, the owner hold and the
  cookie rule are the same, so there is nothing to decide against.
- A start by a member's own tool is never silent. `LocalVm._start` calls `wake_notice` once when a computer that was asleep (or
  never made) has been started; `VmTools._wake_notice` writes one quiet line in that member's conversation (an event `computer_woke`, drawn like a rename and
  never a reply, R-TEXT-08; the progress line where a task has no conversation), naming the member and why in the member's language: a page (any browser tool), a
  command (`vm_exec`) or using the computer (anything else): 「小晴為了開網頁喚醒了電腦」. No toast, no card. The same record
  (`vm.woken`: member, name, reason) is in the viewer's status as `woken` while the computer runs (the member's panel showed it in its
  computer row until 2026-11-14; the app no longer reads it, and the line in the conversation is the one notice). It is dropped when
  the computer sleeps or when the owner starts it (a press, maintenance), so his own start leaves no line. Routines and background tasks run through the same call, so they follow the same
  rules (their line goes to their own conversation or progress). All fifteen interface languages: `_computer_words_data.py` for
  the core (the app keeps no copy since 2026-11-14).
- The owner watching counts. `DesktopViewer._monitor` marks the computer active every second while a view of it has a connected
  socket (a preview included: an open panel with the screen showing is watching), so the idle bound does not apply to it; an
  unwatched, quiet computer still sleeps at the bound.
Evidence: `tests/computer/test_wake.py`, `test_viewer.py::test_a_computer_the_owner_is_watching_is_not_idle_and_one_nobody_watches_sleeps`,
`tests/agent/test_web_read_hint.py` (each was red before its change), and the look scenes below.

```powershell
npm run look -- computer-wake-line member-panel-details-no-computer-running member-panel-computer-live computer-low-disk --theme both --width 1120,720,1920x1080
```

`computer-wake-line` is the conversation's line (one quiet centred line, no member message, no toast, no alert); `member-panel-details-no-computer-running`
asserts Details carries no second copy of it. Native, not run: a member's real browser_open on a
sleeping computer, and a real routine waking one.

Layer 11 (a loaded PC, a panel that stays empty, shifted keys). Two scripts of the image are replaced by the copies in
`image/layer11/` in a step after the last heavy one; `image/desktop/` is untouched (the stale copies there are what this step writes
over), so a PC that built layer 10 reruns two steps (3.0 s measured, everything before cached).
- Window waits. Measured on a real six-screen computer with the browser's first window 45 s late: the layer 10 script ended "no
  browser window appeared" after 17.7 s, layer 11 opened it in 46.3 s. The script's deadlines are wall clock (60 s, 30 s), not
  counts of looks. Every bound outside it is longer, and a member's call still says it is reading after 10 s and reports its elapsed
  time (the same waiting words as before; a member is never told a wait is a failure).
- Panels. Not reproduced in six boots (two starved, two with browsers opening). Measured: a panel is 12 px until its launchers are
  loaded; the running panel does not read `/panels` until `xfce4-panel -r`, so the write order was not what emptied it. The helper
  still writes in the order of dependence, verifies after its restart, and watches (10 s tick, 30 s tolerance, five restarts at
  most): a panel emptied behind its back (plugin ids removed, restart) was whole again after 41.9 s. Not proven: the original
  cause; the acceptance now waits for a whole panel per screen and fails naming what each holds.
- Keys. A seat's view server drops Shift-needing keysyms sent bare (22 of 22 arrived with Shift_L held). Only scripts send bare
  keysyms (the acceptance's typing); `Rfb.type_text` holds Shift for a US keyboard and refuses other layouts. Members type through
  the driver, a person through the browser, both unaffected.

Not run: `verify --computer` on the final tree is listed in the report that handed this over; item 2 under real memory starvation
(stood in by a delayed browser start).

## The owner can always take the computer; a hold never outlives its use (owner, 2026-11-14)

R-COMP-TAKE-01, R-COMP-HOLD-01 (main e13ff592, image layer 9, members sharing one computer). The owner's picture: the larger
view showing a page in Chrome, the pill reading only 觀看中 and no 接手控制 (「為什麼我沒辦法接手啊 ? 理論上不管甚麼時候我都應該要可以接手 ?」).
A member then told him that four attempts had failed together and a retry succeeded with nothing changed, and that his hold
on the computer "could not be fully confirmed" as the cause.

What is known and what is not. Verified in the code and reproduced by tests that were red first: the pill and the button
did not agree (`desktop-viewer.ts` drew 觀看中 whenever the view only watched, and hid 接手控制 when the core said the lease was
the owner's), a take-over the screen never confirms is given back by a call that may fail while the view goes back to
watching (`takeFailed`), a second view's Take control was refused for as long as a first view's hold stood, a hold whose
view failed to close stayed for good, and the monitor that closes expired views ended at the first view it could not close.
Not proven: which of these happened on his PC (no log of the lease exists: the core keeps no record of holds, and
`raphael.db` was not opened). The member's four failures are unexplained; the refusal it saw was the bare identifier
`owner_holds_control`, so what it said about a cause was a guess it admitted to.

What the app does now.
- A pill that reads 觀看中 always offers 接手控制 (the larger view is open, the computer runs, no recording). One press is
  `computer.viewer_control {held: true}`; the pill reads 正在接手… until the screen confirms (R-PANEL-09).
- The core gives the lease to the owner's press (`viewer.py::_control`): another view of his own that holds it, or a hold no
  view keeps and no sign-in request waits on, is replaced (the old view's policy revoked, its pressed keys released, its
  sockets closed). A recording in the old holder's view still refuses.
- A press that lands while a member's action is under way (`vm.input_busy` / `native_busy`) used to be answered "desktop
  busy" on the spot, after which the view, having left watching, hid 接手控制 for good: pressing while a member works failed about
  as often as the member's actions were in flight. Now the press takes the hold first (the member's next action is refused from
  then on), waits up to `TAKE_WAIT_S` = 10 s for what is under way, and takes; an action that outlasts it is answered "desktop
  busy" with the hold given back as it was. While the core decides the pill reads 正在接手…; a refusal returns 觀看中 with 接手控制.
- A lease the core no longer gives the view (handed back by the idle bound, replaced, expired) makes its screen view-only on
  the next renewal (`update()` in `desktop-viewer.ts`), the pill says 觀看中 and 接手控制 returns. 釋放 / 我完成了 is shown only
  while the view holds the lease or a request waits.
- How long a lease lives: it ends at 釋放, when the view closes (released at once) or when the app is gone (15 s after the
  last renewal, by the core's monitor); and, new, `OWNER_IDLE_S` = 300 s after his last click or key (the relay's count of
  forwarded input) while nothing waits on him. A sign-in or payment request waiting for him and a recording are held until
  he says so.
- A hold whose view fails to close is released anyway (`finally` in `viewer.py::_close`), and the monitor carries on past a
  view it cannot close.
- A member turned away by the hold is told what is true in one sentence (`vm.py::owner_note`, in the 240 characters a
  failure keeps): the owner has had the screen's mouse and keyboard for N seconds, nothing was done, it comes back at his press
  or after 5 minutes without input, do not guess another cause; a waiting sign-in request says that instead. The CLI bridge
  says the same instead of the bare identifier.

```powershell
npm run look -- desktop-watch-retake desktop-watch desktop-watch-owner desktop-watch-collapse desktop-owner takeover-bar takeover-handback desktop-takeover-owner desktop-viewer --theme both --width 1120,720,1920x1080
```

`desktop-watch-retake` is the owner's picture: take control, the screen never confirms (the look's `desktopUnconfirmed`),
the give-back fails (`releaseFails`), 6 s later the view watches with the failure line under the screen, the core still
holds the lease (`data-desktop-state="owner"`) and 接手控制 is shown and enabled. The check `desktop-watch` no longer skips
the button when the lease is the owner's. Native, not run: the owner's own real take-over of a seat after a failed one.

## Ending control is not ending watching; a running computer's preview is never a black frame (owner, 2026-11-14)

R-COMP-RELEASE-01, R-COMP-PREVIEW-01. The owner's picture: the Computer tab's preview, 執行中 above it, a black screen with only
the 開啟 pill. His words: 「有時候畫面會變成這樣子，你可能要確定一下為什麼。就是我結束的時候，而且結束控制不代表我要結束觀看，
所以不要跳掉。你這邊哪裡邏輯怪怪的」. (His build predates #99, which removed the Details computer row; the preview never
depended on that row's background stream, so the fix is the same on main.)

Two causes, both in `desktop-viewer.ts`, none in the core (`viewer.py::_control` keeps the session on release).
- The pill's 停止 (after 接手控制) called `handback()`, the path of a sign-in request's 我完成了: it asked the core to release,
  folded the larger view, closed the stream and, in a window under 1440 px or when the panel had been closed, closed the panel.
  Now `release()` asks the core to release and does nothing else: the view stays, the stream stays, the screen is view-only,
  the pill reads 觀看中 and 接手控制 is offered. A refused stop leaves the pill on 你正在控制 and gives the screen his input
  again. 我完成了 (a request a member waits on) still goes back to the conversation through `handback()` (R-COMP-3-03).
- `handback()` also set `suspended` (so a returned request's card does not reopen its stream) and never cleared it for a
  panel that stays visible: in a wide window the panel stayed open on the third tab with a running computer, no stream and no
  picture until he pressed the screen, which clears `suspended` (the press that enlarges it). A handback that leaves the panel
  visible now streams again at once (the discarded demonstration and the returned sign-in request take that path).
Reproduced before the fix: `computer-release-keeps-watching` red at 1920 and 720 (the view left), `computer-preview-running`
red at 1920 (no iframe in the tab after the handback), and the vitest cases listed in the rules.

```powershell
npm run look -- computer-release-keeps-watching computer-preview-running takeover-handback desktop-handback desktop-takeover-done desktop-teach-discard desktop-watch desktop-watch-collapse --theme both --width 1120,720,1920x1080
```

`computer-release-keeps-watching`: take control, press 停止, the larger view is open, the pill reads 觀看中, 接手控制 is
offered and enabled, the frame is visible and connected (one `viewer_open`, no `viewer_close`, one release).
`computer-preview-running`: a demonstration is discarded (a handback that leaves a wide panel open), the Computer tab shows the
live stream or the last picture (the check fails on a black frame with only 開啟). `takeover-handback` and `desktop-handback`
now end by folding back, not by the stop. Native, not run: the owner's own real take, stop and fold on his seat.

## The disk notice names the disk that is full (owner, 2026-11-14)

R-COMP-DISK-01. A member told the owner 電腦磁碟快滿了 and named `.browser-profiles` (326 MiB), `.raphael-checkpoints` (12 MiB)
and a member folder (0 MiB). `docker exec ... df -Pk / /home/cua/workspace` on the running shared computer (read only):
`/` is Docker's overlay at 2 percent; `/home/cua/workspace` and `/home/cua/team` are the bind mount of this PC's `C:\` at 94
percent (463 602 684 KiB, 29 528 756 KiB free). The reading took the larger of the two, so the notice was about C:, and the
folders it listed were measured in the workspace only. `lifecycle.py::disk_pressure` now returns a `DiskPressure` (which
disk, its name, percent, free, the folders, the workspace total); `vm_tools.py::_disk_notice` says the disk and its free space
and, when the computer's own folders are under 1 GiB, that they are only that much and that cleaning them would not help;
with 1 GiB or more, or when the computer's own disk is the full one, the notice with its largest folders and the question.
The new sentence has its translations in all fifteen interface languages (`_ui_words_data.py`). The 90 percent line, the
once-per-episode rule and the read-only, ask-before-delete behaviour are unchanged. The `computer-low-disk` scene's sample
reply still shows the folder-listing sentence.

## One foot under the larger view's screen (owner, 2026-11-13)

R-PANEL-08. The owner's picture after a failed demonstration: the red line began at the window's edge
over the screen and was cut, 丟棄示範 and 審閱示範 floated in the far corner, and the file changes ran
along the top-left. In the larger view (`desktop-viewer.ts`, `.desktop-shell`) the screen, the skill
review (`.desktop-review`), the file changes (`.desktop-checkpoints`) and one foot (`.desktop-foot`)
share one width: `min(100cqw, (100cqh - --desktop-foot) * 1280 / 900)` of the shell, a size container.
The foot holds `.desktop-notes` (request, failure, privacy line, missing-computer note, the trial input),
centred and wrapping, then `.desktop-bar`: three columns with the pill (`.desktop-dock`) in the middle on
the screen's centre line and the demonstration's pill (`.desktop-actions`: Discard quiet, review or Stop
recording filled) right beside it. The review and the file changes take the screen's place in a box of its
size that scrolls on its own; file changes opened from a result card (`data-files-only`) show no pill.
While the draft is written the teach button is hidden and the line alone says so. The small preview keeps
only a notice under its screen (the foot is `display: contents` there).

How to get to it: open a member's computer tab, enlarge the screen, take control, then ⋯ → 教他做一次
(press it again to stop; `teachFails` in the mock makes the draft fail) or ⋯ → 檔案變更. A result card's
檔案變更 opens the files-only view.

`computer-foot-layout` (checks.mjs) asserts on every listed scene: the screen or its box keeps the
proportions and is centred; every line, the pill and the actions lie inside its horizontal span, below it,
inside the window and uncut; none overlap; the foot starts within 24 px of the screen; the pill is on the
screen's centre line; lines are centred.

```powershell
npm run look -- desktop-teach-failed desktop-teach-recording desktop-teach-draft desktop-teach-saved desktop-teach-shared desktop-teach-discard desktop-teach-try computer-file-changes card-task-files takeover-bar takeover-menu desktop-watch desktop-viewer desktop-owner desktop-panel desktop-unavailable --theme both --width 1120,720,1920x1080
```

Gotchas: `--desktop-foot` is a fixed reserve (88 px: one line and the pill; a second line borrows the
shell's bottom padding); a foot taller than that aligns the block to the top (`align-content: safe center`)
rather than overlap, so a new kind of line under the screen needs the reserve rechecked at 1920x1080 and
720. `level-takeover` wants the screen at least the window's height less 160 px at 1920x1080 (932 px now). Long languages wrap the action pill
inside its half instead of moving the pill. The real failure that the owner saw (the draft step after a
recording) is a core question; this section covers only where it is said.

### The sign-in card and an honest pill (R-PANEL-09, owner, 2026-11-13)

The owner could not read a sign-in page in the card (480 px, a 16:9 frame around a 1280 x 900 screen), and the
pill said 你正在控制 while his input reached nothing. A card that hands the computer over (`desktop-timeline.ts`
waiting_control, `computer-card.ts` control) is now as wide as the conversation with a screen at the computer's
proportions (CSS in `desktop-viewer.css`, the one exception to R-CARD-01). Its screen and 接手 call `acquire()`:
the larger view opens with the same frame and takes control; the pill offers 我完成了 (`desktop.done` while a
request waits), which returns the nonce once. The pill reads 正在接手… (`desktop.taking`) until the frame answers
`interactive` with held, then 你正在控制; with no answer in 6 s (`TAKE_MS`) the lease is given back without the
request id, `desktop.takeFailed` stands under the screen and the view watches again. Watching always reads 觀看中 and, since 2026-11-14, always offers 接手控制 (the first section).
Whether the shared computer's seat page sends `held` is the core's question (the shared-computer session).

```powershell
npm run look -- desktop-takeover desktop-takeover-owner desktop-takeover-done desktop-boot-card desktop-boot-inline desktop-own-wallpaper-card desktop-watch desktop-watch-owner takeover-bar desktop-owner desktop-teach-recording desktop-teach-failed --theme both --width 1120,720,1920x1080
```

`computer-takeover` asserts the card fills its column, its screen is 1280 / 900 and the stream fills it;
`computer-takeover-owner` asserts the larger view holds the frame, the pill reads 你正在控制 with 我完成了 and
synthetic keys reach the RFB surface; `card-shell` exempts only the handoff card from 480 px.

## Image layer 6: the desktop's picture, its keys, a lost X server (2026-11-12)

R-COMP-PICTURE-01, R-COMP-KEYS-01, R-COMP-XLOSS-01, R-COMP-LAYER-01 cover image
`driver-0.37.0-v6`. Everything here was first seen on a real layer 5 computer and is
checked on real computers by `npm run verify -- --computer`; the offline tests name the
exact scripts and commands and prove no container.

The picture. The owner saw a desktop of one flat dark blue (2026-11-12). Two causes,
both reproduced: the session's `prepare-desktop` started `wallpaper.py --watch` without
the owner's picture and the core's `_wallpaper`, finding a watcher, exited, so `own.jpg`
was in the computer and nothing showed it; and gdk-pixbuf had no SVG loader
(`librsvg2-2` without `librsvg2-common`), so the town was never drawn and xfdesktop fell
back to its colour. Setting `last-image` to the JPEG by hand showed it at once, and every
monitor of a six-screen computer had its `/backdrop/screen0/monitorVNC-N` properties, so
neither the property paths nor multi-screen was the cause. Now the core's start is the
one place a watcher starts (`pkill -f` the old one, then `exec` the new, with
`--image /opt/raphael-desktop/wallpapers/own.jpg` when the owner has a picture), keyed by
the picture's time and size so a new, removed or restored picture is put up at the next
start of a running computer. A start confirmed within the last 45 seconds is answered
from memory and looks at nothing, the picture included (R-COMP-PERF-01). With the loader
installed the desktop's own default drawing renders too, so "many colours" alone does
not prove the town: the acceptance also reads `last-image` and requires one of the five
town files.

The keys. `xfconf-query -c xfce4-keyboard-shortcuts -l -v` on layer 5 listed every XFCE
default under `/xfwm4/custom` and `/commands/custom`, with four workspaces. The session
copies its defaults into those branches when it starts, so the helper waits (20 s at
most) for both `override` properties before it takes keys away. With multiple screens it attempts all removals, then rereads bindings and workspace_count; remaining forbidden bindings, a count other than 1 or a required-query failure invokes the existing retry before writing a new ready mark. One screen keeps best-effort behavior. The original layer-6 measurements found that its ready mark follows the session by a few seconds (measured 4.5 s after start for one screen, 8.1 s
for six; 3.4 s and 9.6 s on layer 5). The acceptance opens a terminal, presses ctrl+F2,
ctrl+F4 and ctrl+alt+d through the screen's own view and requires the window still
mapped on workspace 0.

A lost X server. `pkill -x Xtigervnc` on a one-screen layer 5 computer: no X server, no
window manager and no panel for 76 s, `status` `running, ready=True` throughout, the
driver answering `list_windows` "Found 0 windows:" without an error. On layer 6 the mark
went in 1.3 s (one screen) and 1.8 s (six), status turned not ready, and the product's
next `start` restarted the computer after its 20 polls: ready again in about 85 s with
an X server, the mark and the panel. The acceptance does this for the one-screen and the
largest computer; its "boot mark" check therefore counts only the repairs of the
computer it looks at.

Previous layers. The acceptance makes its fixtures from the released images themselves
(`driver-0.37.0-v4`, `-v5`) when they are on this PC, under the run's own owner label,
and only reads those images. Layer 5 start, update and erase: incompatible, then ready
on the new image with the workspace file preserved, or absent with the workspace
removed.

The guard. The acceptance's Docker guard allows one host file besides the image folder
into a computer: the run's own `computer-wallpaper.jpg`, into its own computers. Without
that the product's copy was refused, swallowed (decoration never fails a start), and the
first run of the picture check showed the desktop's default drawing.

Real run of 2026-11-12 (`python -m raphael_core.evaluate.computer_acceptance --screens 1,6`,
Docker Desktop, Linux engine): 44 ok, 0 failed, 0 skipped in 650.718 s.

Not proven: a remote (SSH) host; the native app's own panel around the stream; a
member's real turn at the desktop.
## Shared seats, stages B2 and C (2026-11-12)

R-COMP-SEAT-01 replaces shared mode's old one-screen rotation with one six-screen
container and durable first-use seats. Per-bot remains the default. target() does
not assign; screen 0 status describes the unit, viewer_url is empty and the relay
refuses its view with 403. VmTools.prepare and a real viewer open assign a seat;
previews and status do not. The seventh member evicts an idle least-recently-used
seat, disconnects its driver and closes its viewer tokens. The old route returns
computer_changed. All busy seats return the existing computer_busy notice with
"every screen of the computer is in use". close_displaced_seat_windows gently closes the windows touching the screen except the desktop's own (panel and the canvas-wide xfdesktop window, measured on a real computer: counting that window left every screen occupied for ever) and confirms emptiness within LocalVm.seat_clean_seconds. Every new holder, on either a displaced or free screen, requires a successful empty-screen list or proof that the unit is absent/stopped. Failed displacement restores the exact old screen; dirty free screens are skipped; existing holders are never cleaned. Deletion
holds seat_lock until cleanup finishes before releasing the seat; every close rechecks the holder. Displacement also holds seat_lock: revoke the old holder first, clean its driver/viewers/windows, then publish the new holder. The cached-route reproducer verifies that a returning member cannot launch during pending cleanup. Viewer opens and request/renew/control/peer entry points
recheck member/Target/holder after awaits and revoke stale sessions.

Physical lifecycle, locks, preparation, caches, capacity and idle time use the
unit on its host. Every seat must be idle and unheld for maintenance and restore.
Each seat retains its own tools, catalog, leases, driver connection/session,
viewer sessions, work and hold. Native input and every foreground driver call are serialized per unit, including
composite native substeps, browser_click/pointer and dialog accept/dismiss. Other
seats' background page calls, dialog inspection and reads continue during an owner
hold; foreground page/native input waits then reports computer_busy. Explicit
foreground always locks, including DOM routes; inspect has no implicit foreground. The held seat refuses all calls. Handback releases only that seat.
Shared kind uses six screens, 6 GiB and 4 CPUs; recognized one-screen layer 3/4/5
shared containers rebuild while keeping home and team mounts. Deletion releases
all hosts' seats without erasing shared storage and retains historic per-bot cleanup.
Dataset and teaching are available in shared mode: datasets use .raphael-data/members/<core member key>/ with a common venv/install lock, and teaching records only the member's current seat through core input/tick, the member window projection and a clipped RFB capture. Private-page marks and PRIVATE titles withhold text and images. Historical homes are carried before the shared browser starts by the read-only Linux helper and the core's record, sign-ins first, as a background task the browser waits for only within a budget, with busy-source deferral, next-start retry and three attempts. Offline evidence: computer/test_shared_datasets.py, computer/test_shared_teaching.py and computer/test_carry.py; the shared --computer block checks namespaces, a seat-2 recording (with what a press waits for) and persistent-cookie/file/dataset carry on this run's own homes.

Stage C2: SHARED_ARGUMENTS classifies every offered driver's top-level and nested
property. Unreviewed parameters, target/from_zoom/capture_id/screenshot_out_file,
caller desktop scope and desktop coordinate_frame are refused. Fresh same-session
canvas rows check every window/pid and every page target's recorded native window,
including private-picture and vault helper reads. A moved target is revoked. A
centre-owned straddling or oversized window must be fitted and freshly confirmed
wholly inside its seat before reading or input; otherwise it is refused. All native
window-relative points and the straight drag path stay inside the seat, allowing
menus outside the window but inside the screen. move_cursor checks and offsets
seat coordinates. verify_state translates input bounds to canvas and observed_json
placements back. Driver tree/element_token prose stays intact; page replies append
one JSON line. Pointer prose and move summary use seat coordinates; click canvas
trailers are removed. Desktop pictures still use authenticated clipped screen-N
RFB, 1280x900 RGB PNG. AX/screenshot nodes remain window-local. launch_app moves
new windows matching reply pid/launcher_pid; only when no such window appeared and exactly one other new window appeared does it use that helper fallback. Multiple unmatched windows stay put. A lone concurrent peer window or same-process peer window remains a possible attribution error. windows[] is filtered/projected after movement.

The browser belongs to the computer. Layer 7 adds the existing-profile grant and
installs raphael-seat-browser. The launcher uses now-minus-before plus a unique
title-only data page marker and the main browser pid to identify this launch's
window, excluding disappeared windows and concurrent same-pid peer popups. It
places/maximizes the window and waits for settled geometry (up to thirty seconds since layer 11, R-COMP-LOAD-01)
(the measured panel height is 49 pixels). Each seat attaches with existing_profile,
binds, then browser_open navigates to the requested URL. Shared browser_prepare
normalizes profile/strategy to existing_profile and preserves delivery_mode.
Per-bot launch stays unchanged. In both modes, successful snapshots and active-tab binds remember the exact tab per target until disconnect; fill and private-picture reads use target_id plus that tab, and unknown tabs fail closed. Offline tests cover both reply shapes, ambiguous/unseen targets, per-field typing and disconnect. run_steps accepts live expect observations and rejects empty/legacy-only predicates before any action. Takeover checks the seat's non-command activity
and unit input lock; other seats' background page/read/command work continues.
Foreground page input waits/busy during the hold and resumes after handback.

Offline scope: tests/computer plus every agent, member and background test file that imports or drives computer/, members/service.py or teaching.py, including fixture consumers, and tests/evaluate/test_computer_acceptance.py. Run each file separately with the repository Python; list every result and any file not run. C3 also checks tests/evaluate/test_teaching.py. Use
worktree PYTHONPATH=core/src, RAPHAEL_TEST_MODELS=0, PYTHONUTF8=1,
PYTHONDONTWRITEBYTECODE=1, -q -W error -p no:cacheprovider. New seat-wall tests are in
test_seat_tools.py; RFB fake-server PNG round trips are in test_rfb_view.py. The
acceptance offline fake exercises every named shared check through real product tools,
using separate measured window-bind and tab-snapshot shapes. All driver doubles
validate the reduced measured fixture, with unknown top-level arguments refused
even where the live page schema allows extras. Classification coverage includes
nested properties; driver upgrades require fixture/table review. Vault fill calls
include the current tab_id resolved from the existing page read.

The maintainer runs npm run verify -- --computer on the final tree. Each per-count
block compares every DRIVER_TOOLS live parameter-name set to the pinned 0.37.0
fixture directly after driver connection. The shared block retains the two-member
lists/terminal/typing/browser/picture/control/disconnect/displacement journey and
adds: out-of-seat click refusal before dispatch with the real pointer unchanged;
desktop coordinate_frame and target refusal; seat-2 tree/token prose, one page JSON
line and pointer seat coordinates; satisfied seat-local verify_state bounds; one
workspace, peer mapped windows and own-seat focus after ctrl+F2, ctrl+alt+d and
alt+Tab; foreground browser_click blocked/busy during a peer hold while browser
navigation continues. Unrun dependent checks are explicit skips; successful detail
claims only observed behavior, and an inner shared failure fails the outer block.
--no-shared remains an explicit skip and IsolatedDocker guards guest/bridge calls.
The shortcut image changes and one-screen X-loss changes are maintained separately.

Clipboard, files and sign-ins are shared. Shell/browser still run as cua, but shared
foreground/background vm_exec removes DISPLAY: the shell has no screen here; use
launch_app for a window. Deliberate shell access restoration is outside this
accidental-input boundary. Offline
success proves no real image, driver, XFCE geometry, native timing, remote host or
native app panel behavior. The measured launcher panel height and result shapes,
window mapping delay, profile attachment/lifetime and frame strip thresholds must
be settled by the maintainer's real-container acceptance on this final tree.

## Image screen plumbing, stage A (2026-11-11)

R-COMP-SCREEN-01 covers image `driver-0.37.0-v5` (layer 5). RAPHAEL_SCREENS
selects 1..6 real VNC outputs in 1280x900 cells, with one panel per output.
The standalone stdlib helper owns RFB 3.8/VNC DES authentication, layout, panels,
atomic 0600 token publication and readiness, plus clipped-server supervision.
The helper is standard library only: Debian Python runs it without anything from
`/opt/venv`. Main VNC listens on 5901; multi-screen clipped views use the foreground
binary `/usr/bin/X0tigervnc` (not Debian's detaching wrapper) on loopback 5911..5916.
Before starting views for any count, the helper ends leftovers with
`pkill -x X0tigervnc` and waits up to five seconds for all six view ports to clear.
Listener readiness parses `/proc/net/tcp`, never opening unauthenticated VNC
connections that could blacklist viewers. Only 6901 is published, using TokenFile
routing: `/websockify?token=screen-N`. A single screen
routes directly to 5901; no multi-screen canvas token is exposed. noVNC's static
`/vnc.html` remains available for the existing SSH tunnel check. The viewer relay
receives the session target's captured screen. Readiness checks both the driver
and `/dev/shm/raphael-screens.ready` with the existing two execs; this tmpfs is fresh
on each container start. Tokens stay at `/run/user/1000/raphael-vnc-tokens`.
The mark says this boot's screens are set up. It stays while a view or the helper
restarts (the members' work needs the screens, and a viewer reports a refused
connection itself as `viewer_unreachable`) and goes only when the layout is lost: a
view exits and the monitors no longer match, or the X server does not answer; the
helper then sets everything up again. Supervisor never gives up on the helper
(`startretries`), and a running computer whose driver is healthy but whose mark is
still absent after 20 start polls is restarted once under the repair guards.
A computer of a previous layer is this owner's own for stop, restart, update, repair,
reset and member-data deletion before it has ever been upgraded. A `Target` refuses a
screen outside 1..screens..6; the layout request has one 15 s deadline.
Supervisor lacks CAP_KILL, so it only restarts what exits and cannot stop programs;
the helper ends its own children. Nothing may call `supervisorctl stop` or `restart`
in a computer. A newly set layout requests only a 1x1 update and, after status 0,
sends one pointer event to screen 1's centre on the same RFB connection. A matching
layout sends neither request nor pointer event. For multiple screens, xfwm4
`/general/show_dock_shadow` is false (created as bool if absent), written only when
different with no panel restart; window frame shadows stay unchanged.
Known layer 3/4 rebuilds preserve workspace and keep all compatibility, owner-hold
and active-use guards.

Existing per-bot/shared targets keep screen/screens=1/1. Member assignment,
leases, browser changes and default-mode changes are deferred. Offline scope is
`tests/computer` (including `tests/computer/test_screens.py`), using the
repository interpreter, PYTHONPATH=core/src, RAPHAEL_TEST_MODELS=0, PYTHONUTF8=1,
`-q -W error -p no:cacheprovider`. Offline tests establish contracts only: the
first tree passed 939 of them and failed in a real container seven ways (the
detaching wrapper, the mark outliving a restart, orphaned servers, supervisor
unable to stop programs, the neighbour's panel shadow, the tooltip on screen 5,
the connect probe). A change to `computer/image/`, the container's shape in
`vm.py` or the view path is not done until it has run in real containers.

Container acceptance of 2026-11-12 (the owner's Docker Desktop, a throwaway image
tag and data folder, production capabilities, through the real `LocalVm`; by hand,
now encoded in the opt-in `verify -- --computer` command described below):
- 1, 2, 3, 4, 5 and 6 screens start ready in 24 to 33 s with no helper retry:
  outputs `VNC-0..N-1` at the grid's rectangles, the token file, the mark in
  `/dev/shm`, N clipped servers as children of the helper on loopback only, one
  panel per output, no "Displays" dialog, no tooltip window (5 and 6 screens).
- Through noVNC on the published port every `screen-K` connects at 1280x900 and
  shows only its screen; no token, `bogus`, `screen-0` and `screen-N+1` are refused;
  the hash-form `viewer_url` connects; `/vnc.html` is 200.
- A click at (688,165) through screen 4's view maximised screen 4's window to
  1280x827 at +1280+924; the other screens' windows did not move.
- Pixel difference from the plain wallpaper is 0 along the top of the screen below
  a panel (was 4862 with dock shadows) and 0 at the top of screen 5 of six.
- `docker stop` / start: no mark from the previous boot is ever visible. A real layer 4
  computer (3 GiB, no `RAPHAEL_SCREENS`) reports `incompatible`, is rebuilt on layer 5
  and keeps its workspace and browser profile.
- Six idle screens with no viewer: about 0 % CPU, 425 MiB.

Measured again on the round 3 tree (same day, same way, after `origin/main` 704d3d74
was merged in), because the mark's meaning changed:
- 1 to 6 screens start with no helper retry and no repair restart (the one-pixel
  payload limit holds against the real server). The mark is written 10.5 s (four
  screens) and 15.2 s (six) after the container starts; the driver's socket at 6.5 s.
  The start poll's grace before its one repair restart is 20 polls.
- One clipped server killed: the mark stays, the view is back in 1.3 s. Helper
  `kill -9`: the mark stays, the new helper replaces the views at once. Helper
  SIGTERM: the mark stays, views back in 2.2 s. The X server killed: the mark is gone
  within 1 s ("The screen layout was lost"), the core reports not ready. After
  `docker stop` / start the mark appears about 10 s in and the start is ready.
- The core's own `DesktopViewer` and relay in front of a four-screen computer whose
  seat was set to screen 3: the viewer URL the app loads opened in a headless browser,
  its WebSocket through the relay answered 101 and the canvas showed screen 3 at
  1280x900.
- A layer 4 computer never started since the update: `maintain(update)` goes from
  `incompatible` to ready on layer 5 with its workspace file kept; `LocalVm.erase`
  removes its container and its folder.
Not covered: the app's own window around that viewer page, a remote (SSH) host, a
viewer that stays connected while its clipped server dies, and everything about
members sharing one container (later stages).
`wmctrl` is in the image for those stages: Chromium opens every new window beside
its first and the driver has no tool that moves one.

Round 2 offline evidence:
`core/tests/computer/test_screens.py::test_clipped_server_runs_the_foreground_binary_with_real_parameter_names`,
`core/tests/computer/test_screens.py::test_tcp_listener_parser_requires_the_loopback_port_and_listen_state`,
`core/tests/computer/test_screens.py::test_leftover_cleanup_kills_exact_binary_and_waits_for_every_view_port`,
`core/tests/computer/test_screens.py::test_leftover_cleanup_timeout_is_bounded_and_prevents_starting_views`,
`core/tests/computer/test_screens.py::test_views_preserve_boot_mark_during_restart_and_stop`,
`core/tests/computer/test_screens.py::test_rfb_handshake_authenticates_and_waits_for_its_own_layout_reply`,
`core/tests/computer/test_screens.py::test_helper_start_preserves_boot_mark_and_skips_matching_layout`,
`core/tests/computer/test_screens.py::test_multiple_screens_disable_only_dock_shadows_when_different`,
`core/tests/computer/test_screens.py::test_host_and_helper_share_the_fresh_tmpfs_readiness_path`,
`core/tests/computer/test_screens.py::test_image_installs_screen_views_and_preserves_the_single_token_port`,
`core/tests/computer/test_screens.py::test_image_build_context_has_no_bytecode`.

Round 3 (an independent review of the first commit proved six defects the offline
tests and the container run had both missed; each has a test that was red first):
`core/tests/computer/test_lifecycle.py::test_previous_computer_maintenance_rebuilds_without_starting_old_image`,
`core/tests/computer/test_lifecycle.py::test_previous_member_data_deletion_needs_no_new_image_or_start`,
`core/tests/computer/test_remote_viewer.py::test_old_remote_computer_of_a_previous_layer_still_upgrades`,
`core/tests/computer/test_lifecycle.py::test_missing_screen_setup_repairs_once_after_twenty_polls`,
`core/tests/computer/test_viewer.py::test_viewer_reports_its_connection_failure_independently_of_boot_mark`,
`core/tests/computer/test_screens.py::test_simultaneous_view_exits_keep_boot_mark_unless_layout_is_lost`,
`core/tests/computer/test_screens.py::test_target_rejects_invalid_screen_numbers_at_construction`,
`core/tests/computer/test_screens.py::test_rfb_layout_has_one_deadline_for_trickling_reads`,
`core/tests/computer/test_screens.py::test_rfb_rejects_oversized_skipped_payload_before_reading_it`,
`core/tests/computer/test_screens.py::test_supervisor_keeps_retrying_screen_setup_instead_of_entering_fatal`.

## Scripted container acceptance (2026-11-12)

R-COMP-SCREEN-01: from `app/`, `npm run verify -- --computer` requires an already
running Linux Docker engine. It never starts Docker, never runs implicitly with
`--core` or in CI, and builds only `raphael-acceptance/cua-local-vm:<run id>`.
Every container belongs to a fresh temporary data-directory owner. Cleanup checks
that exact owner label, then removes only this run's containers, image tag and data,
including after failure/interruption. Direct module `--keep` retains them for inspection.
The JSON check report is `computer-acceptance.json` in the verify run's folder.

The default counts 1,3,6 cover a single view, a grid with an empty cell and the
largest layout. Direct module `--screens 1,4,6` selects other distinct counts in 1..6.
Checks drive production start/status/stop/viewer, the image helper's grid/token/DES,
monitor/panel geometry, parented loopback view processes, token refusals, launcher
clicks with isolated framebuffer pixels, boot-mark timing, restart freshness,
clipped-server/helper recovery and X loss. The largest multi-screen target also
opens the real DesktopViewer last-screen relay and rejects an unknown session path.
A locally available layer 4 image additionally exercises start, maintain(update),
and erase with workspace files; its absence is a named skip. Engine absence exits
2, any failed check exits 1. Each check prints expected/observed evidence on failure.

Run this when computer/image/, vm.py's container shape or the view path changes.
Offline framing, authentication, parser and isolation tests live in
`core/tests/evaluate/test_computer_acceptance.py`; no Docker or network is used by
those tests. They establish contracts only. This command exercises the core relay;
the native app's own panel, remote SSH host, a viewer retained across a clipped
server death, and member seat/lease stages remain outside its acceptance scope.

The form check (round 5, per-bot and shared, through product calls and the common fill helper): a
main-document Name field that starts with a value, a same-origin frame holding a field of the same name,
and a second loopback origin. It proves replacement, refusal of the frame's field, window and desktop
pictures withheld after a private fill and after same-origin navigation, the another-origin read timing,
and a closed tab (a real ctrl+w with a spare tab open) retiring its mark so pictures return. The shared
block also moves the marked window onto the peer's screen (the peer's desktop and window pictures come
back empty), refuses a hand-over when one window list fails at the IsolatedDocker boundary (exact holder
restored, `computer_busy`), and shows a free screen's leftover window gone before its new holder.
Offline fakes do not prove driver or X11 behaviour: round 5 passed 1205 offline tests and thirteen
rule-removal mutations and still could not seat anyone on a real computer (the desktop window spans every
screen), knew only one of the driver's two closed-tab replies, and displaced the wrong member on a retry.
Regressions: `test_login_vault.py::test_saved_field_selection_and_replacement`,
`test_login_visibility.py::test_private_marks_follow_windows_on_the_same_shared_computer`,
`::test_only_the_measured_closed_tab_error_retires_a_mark`,
`::test_a_launched_browsers_closed_tab_retires_a_mark_only_as_measured`,
`test_seat_tools.py::test_a_moved_private_window_withholds_peer_product_pictures`,
`test_seat_wiring.py::test_a_new_holder_requires_proof_of_an_empty_screen`,
`::test_the_desktops_own_windows_never_keep_a_screen_from_a_new_holder`,
`::test_a_failed_hand_over_leaves_the_idle_member_first_in_line`,
`::test_cleanup_has_a_total_bound_even_when_the_window_list_never_answers`,
`::test_failed_restore_cannot_give_leftover_windows_to_the_next_holder`,
`test_seat_view.py::test_cleanup_window_lists_retain_unknown_classes_and_reject_incomplete_geometry`.

The shared block's three stage D checks (all through product tools, on this run's own homes): two seats
import a dataset of the same name and each answers and lists only its own; a recording started on seat 2
holds no window of seat 1, a 1280x900 picture and no canvas-wide driver call, and says what an owner's
press waits for; a per-bot computer of the run makes a persistent cookie (kept 40 s so the browser writes
it), a file and a dataset and stops, and after the shared computer's first browser the cookie is sent, the
file is in the member's folder, the dataset answers on that member's seat, and a second start runs no copy
helper. `IsolatedDocker` allows exactly the carry helper's `docker run` on homes registered from this
run's own container creations.
Measured on the first real run: a press waited 1.03 s for the seat picture against per-bot's 0.23 s,
because the picture was built one Python step per pixel; `Rfb.frame()` and `png_frame()` make the same
bytes in 0.20 s, and the check now fails a press that waits more than 0.7 s. No offline test could have
said so: 113 test files were green. Regressions:
`test_rfb_view.py::test_the_whole_frame_path_makes_the_same_picture_as_the_per_pixel_path`,
`test_carry.py::test_large_home_keeps_only_its_files_in_place_and_an_unknown_folder_is_never_merged`,
`::test_a_copy_that_keeps_failing_is_paid_for_three_times_and_then_left_in_place`,
`::test_the_browser_waits_only_its_budget_and_a_slow_copy_keeps_the_old_homes_guard`.
An independent review of stage D (0 blockers, 3 major, 2 minor) found what neither the tests nor the real run had: the helper's ownership pass walked `.browser-profiles` even when a member had made it a link; the budget ended the carry's task and with it the old home's guard while the copy's container went on; a recording that could not be written kept its event in memory and could end the viewer's monitor; a framebuffer update's rectangles were all held at once. All four are fixed with regressions (`test_carry.py::test_a_copy_without_a_profile_hands_over_nothing_a_member_prepared`, `::test_a_hung_helper_is_killed_by_name_before_its_error_is_raised`, `members/test_teaching.py::test_a_recording_that_cannot_be_written_ends_as_full_and_keeps_no_unwritten_event`, `test_rfb_view.py::test_one_rectangle_is_held_at_a_time_and_a_picture_is_whole_only_at_an_updates_end`); the fifth, a member swapping its own dataset folder for a link mid-call, is stated in R-COMP-SEAT-01 as outside what the folders are for. A second review of those fixes (0 blockers, 2 major, 4 minor) found that a failed or unfinished profile copy left `.browser-profiles/driver` root-owned, so on a host with real ownership the launcher could not make its profile (`::test_folders_made_on_the_way_are_handed_over_before_a_copy_that_may_fail`); that a kill whose answer was not awaited, or a helper left by a core that died, still released a home being read (`::test_a_closing_core_leaves_its_copy_to_finish_but_sees_a_kill_through`, `::test_a_helper_an_earlier_core_left_running_is_waited_for_and_then_asked_once_more`); that the write at a recording's end could still raise into the viewer's close (`members/test_teaching.py::test_a_recording_that_ends_on_a_full_disk_still_lets_go_of_the_computer`); and that the carry's lock was held for the whole wait (`::test_every_browser_of_a_computer_waits_until_the_same_moment_and_another_computer_does_not_queue`). A third, narrow check found one more: a kill that failed was taken for an ended helper (`::test_a_hung_helper_that_cannot_be_seen_to_end_keeps_its_home_closed_to_its_old_computer`). Stated in R-COMP-SEAT-01, not changed: the helper's staging names can be swapped by a member, inside a throwaway container whose one writable mount is the members' own workspace; POSIX rename puts the carried profile in place of a folder the launcher has only just made. The same hand-over had two failures only this machine's whole run showed, in files the author could not run (loopback sockets), and one only the contract showed (a rule naming a renamed test).
Not covered by the run: a profile after weeks of use (its size and copy time), a remote host's named
volumes, the app's own viewer during a shared recording.

First real runs (2026-11-12, this PC's Docker Desktop): the first found three defects of the
command itself that 179 offline tests had passed (guest paths built with the host's path type
on Windows; a terminal counted as two windows and placed by its frame-relative corner; a
picture check that compared a black terminal with the wallpaper, which is the night picture
at 03:00); the second found that a one-screen computer's panel names no output. The third,
through `npm run verify -- --computer`, is the result recorded in the pull request.

## Deleting a member removes its computer (2026-11-11)

Owner, after deleting a member in the app: the dialog asked whether to delete the member's computer too, and
ticking it hung. The app should know and do it, show nothing when there is no computer, and keep such things
out of the front end (R-COMP-PERF-12, R-UI-27).

What blocked: the old `members.delete` awaited `LocalVm.delete_member_data` before deleting anything. That
stopped the computer through the per-computer lock that `_prepare_start` holds while it waits for Docker
Desktop to launch (120 s) or pulls and builds the image (1800 s each), then ran up to five Docker calls of
15-30 s each, with no bound over the whole and a dialog that had already closed over an unchanged window.
With the engine off the same call raised `unavailable` and the member stayed. The core test
`test_a_computer_still_starting_for_the_deleted_member_does_not_hold_the_deletion` is that case.

The shape now: the dialog is the title, one sentence, Cancel and Delete (`members.deleteForever`), the same
component as every compact delete question; `members.delete {id}` takes no computer parameter. In the core
`MembersService._delete` reads the member's computers (`ComputerData.claim`: a record in `computer_data` or its
folder here; nothing is contacted), deletes the member and writes the removal as owed in the same
transaction, answers, and starts `ComputerData.settle` in the background (`computer/removals.py`).
`LocalVm.erase` stops the container only if it carries this app's owner and target labels, removes it, then the
folder or the host's volume; missing is success; the shared computer and foreign containers are refused. A pass
is paid at the first answer of an engine (`LocalVm.available` tells `ComputerData.engine_up`), on the monitor's
30 s tick and at the core's start, never starting Docker. Limits: 20 s to learn whether an engine answers,
120 s per computer, six counted failures from the timer, a host that does not answer at most every 10
minutes. Computers made before the record existed are found on a host by `LocalVm.recover` (its list of
owned containers) the next time that host answers; a remote volume left with no container is not.

Selected scenes (both themes, 1120,720,1920x1080): member-delete-ask (a member without a computer),
member-delete-ask-computer (one with a computer on a host), member-delete (the result), press-through-delete-dialog,
room-delete and quick-clear-confirm (the shared dialog). `member-delete-ask` asserts the member's name, one
sentence, two buttons, no row, switch or field, and no word about a computer; `member-delete` asserts the call
carries exactly `{"id":2}`. A real Docker engine and host are unverified: the tests use a fake engine.

```powershell
npm run look -- member-delete-ask member-delete-ask-computer member-delete press-through-delete-dialog room-delete quick-clear-confirm --theme both --width 1120,720,1920x1080
```

## Viewer transport isolation, phase 1 (2026-11-09)

`computer/viewer_relay.py` owns the loopback HTTP listener, both WebSocket pumps,
RFB gate, socket writers and teaching observation subprocesses on one dedicated
event-loop thread. Core retains sessions, VM/SSH resolution, SQLite, recording
files and ownership. Immutable revision/monotonic-deadline/control/teaching policies
cross a short threading lock; authorization and each write share that lock.
Session socket sets contain opaque IDs, never writers from another loop.
Close/revoke/revision changes publish denial before awaiting worker cancellation;
the relay independently expires connections even while core is blocked. Revoke
closes that member's viewer sessions but does not stop running commands or containers.
This supersedes the earlier exception for owner viewers under grant revocation.

Per-bot teaching captures privacy context before input on a read-only, relay-owned CuaBridge using an immutable command resolved by core at recording start. Shared teaching has no relay observer: accepted inputs await core Teaching.input before forwarding, while the existing monitor uses Teaching.tick. Core reads current private-page state, reuses the seat driver connection and the viewer credentials resolved at start, and records only seat-local text, pixels and coordinates. For per-bot relay observations, only the existing accessibility/desktop pair is admitted. Shared owner observations admit only exact seat-session setup and list_windows; get_accessibility_tree and get_desktop_state are forbidden. Per-bot relay observations queue privacy-checked immutable JSON back for core-owned, ordered persistence without awaiting core on the byte path. Shared recordings await core observation and persistence on the input path, so their responsiveness under core load is what the real acceptance measures, not what the fake relay proves. The queue is bounded (64 pending payloads / 4 MiB, with a small
full-state notification per overflowing recording); Stop disables new captures and
flushes prior captures/persistence before drafting. Owner/revision/expiry checks
run again before forwarding and before recording; close cancels outstanding capture.
The accepted-input counter increments only for actual forwarded input messages.

BOOTSTRAP snapshots default off. Only parent messages
`{type:'raphael-desktop-frames', on:true}` take one immediate picture and schedule
the existing three-second cadence; `on:false` clears it. `pagehide` takes one final
picture and clears the timer. All pictures require a view-only RFB canvas, retain
JPEG quality 0.6 and a maximum width of 480 pixels, and use the unchanged
`{type:'raphael-desktop', state:'frame', image}` response. The separate app consumer
owns requesting these pictures; this core-only phase changes no app TypeScript.

Offline checks: `tests/computer`, `tests/members/test_teaching.py`,
`tests/evaluate/test_teaching.py` and `tests/architecture/test_boundaries.py`.
The fake VNC and client run independently of core; a synthetic 300 ms main-loop block must leave framebuffer, owner input, per-bot teaching input and relay expiry below 200 ms. Shared teaching input awaits the core and does not inherit that responsiveness guarantee.
Tests also cover both socket ends closing, preview/watch input denial, stale
handshakes, privacy and the 8-session/64-connection caps. Evidence and exact exits:
`app/.look/briefs/viewer-path-report.md`. `npm run verify -- --computer` now covers
local container layout/readiness, authenticated clipped noVNC transport, screen-local
input/raw pixels, recovery/restart, available layer 4 migration/deletion, and the
core's own `DesktopViewer` connection/relay path. The native app's panel around that
relay, remote SSH hosts, native frame pacing and browser canvas performance still
need separate acceptance.

## Library: only what the member delivered, drawn as Grok Bot's (owner, 2026-11-07 night; redrawn 2026-11-12)

This supersedes the Library notes below (team-file chips, the workspace/team scan, This week / Earlier, the three-to-a-row
picture grid, the time on each row, day-by-day groups). The owner found the Library a wall of working screenshots; it lists
only deliverables, read from `members.library` (core brief 10: media cards and files or links its replies handed over, pages
it published with their first day, verified receipts in the owner's output folder; never owner uploads, scratch files or
undelivered screenshots). On 2026-11-12 he showed three pictures of Grok Bot's Library (「它右邊這邊真的做得還蠻不錯的，所以它會分
all 就是所有的，然後 pages 就是內建的頁面，medias 的話就是可能一些圖片之類的……然後 files 的話就是可能一些 zip 檔等等」) and
member-panel-work.ts now draws the same:

- A row of chips under the tabs, always 全部 / 頁面 / 媒體 / 檔案 in that order, as Grok Bot always shows its four tabs (owner,
  2026-11-13, on the build of 045adbb1: 「它檔案不是我不是跟你說要像是Grokbot這樣子區分開來嗎」; before, a member with one kind
  alone, or none yet, showed no chips): pages; pictures, videos and audio; documents, archives and other files. A chip of a kind
  the member has not delivered shows one quiet line in the cards' place (還沒有頁面 / 還沒有媒體 / 還沒有檔案; 全部 keeps 還沒有檔案或頁面,
  loading and failed keep theirs), under the group labels' inset. The pressed chip is the light one (the accent fill with dark
  words in the dark theme, inverted in the light), the others soft. Links are never listed (a link is no deliverable: owner,
  2026-11-08), so there is no link chip. The kind is set by the core (`members/library.py::_kind`): the mime type decides media,
  and when the host's mime table does not know a type (Windows has none for .webp, an upload can arrive as
  application/octet-stream) the extension does, so a picture, a recording, an archive (.tgz, .zst) or a document is never filed
  under 檔案 by mistake.
- A quiet label per recency group, newest first: 今天, 昨天, 過去一週, 更早 (a group with nothing in it is not drawn); the label
  starts where a row's mark does. Each group's items are one rounded card (the second surface, a hairline edge, 12 px radius,
  8 px inside).
- Each item is one 36 px row: a 20 px mark and the title (ellipsis), nothing else. A delivered picture's mark is its own rounded
  20 px thumbnail (loaded through `attachments.get` like a chat's; one with no stored copy keeps the picture icon); every other
  kind has its own icon (page: the document with bars, document, archive, video, audio, file). Delivered file names are data
  for the look audit's language check (`.lib-title`).
- Everything at once up to the core's bound of 100, scrolling inside the panel; there is no 「顯示更多」 (owner, 2026-11-08).
  The empty and failed sentences are unchanged, and now stand under the four chips.
- A press opens a picture in the lightbox, a page itself, whole, in the area beside the sidebar (R-PAGE-08, 2026-11-14: it was the reply that published the page, where the card still had to be pressed; see Conversation), an attachment with `open_attachment`, and a
  delivered file with the `open_library_file` command, which hands the member id and the Library handle to
  `members.library_file` (never a path, never `computer.team_file`).

Scenes: `member-panel-library` (全部), one per chip (`-pages`, `-media`, `-files`), `-single` (the `single` fixture: a member whose
deliverables are all media; the four chips still show, 全部 lists the five) and `-single-pages` (its 頁面 chip: one quiet line),
`-long` (the `long` fixture: 98 items of every kind), `-open` and `-empty` (four chips and the one sentence); the checks in
scripts/look/checks.mjs read the chips, groups, card, row, mark and empty-line geometry.

```powershell
npm run look -- member-panel-library member-panel-library-pages member-panel-library-media member-panel-library-files member-panel-library-single member-panel-library-single-pages member-panel-library-long member-panel-library-open member-panel-library-empty page-library-open page-library-report page-library-back page-library-older details --theme both --width 1120,720,1920x1080
```

## Bare screen while the computer is not showing its screen (owner, 2026-11-07)

This supersedes every earlier note below that describes words, the member face, preparation progress, a state sentence,
recovery buttons (Start Docker, Use remote, Download, Retry), the Open pill, the caption under the screen or the header
state word for an offline computer. While a computer is not showing its live screen (sleeping, starting, waking, updating,
repairing, stopped Docker, missing installation, remote failure, missing image) the panel draws only the wallpaper: no text,
face, button, pill or caption inside the screen, and the header state label (computer-lifecycle-state) is hidden until the
computer runs. The state stays in `data-desktop-state`. The location menu and the overflow menu remain.

One press anywhere on the screen (the `[data-desktop="enlarge"]` cover, visible in every state except while it is getting
ready) starts it: asleep wakes it, a stopped engine starts Docker through `computer.viewer_status {start_docker:true}`, a
stalled or unreachable stream reopens, and a running screen opens the larger view as before. Rendered checks use the shared
`requireBareScreen` helper in scripts/look/checks.mjs. desktop-install and member-panel-remote-location keep their names but
now cover the absent computer's bare screen and the header location control; no scene was retired.

## Three-tab member panel and local engine recovery (2026-11-05)

Owner request of 2026-11-05: use Grok Bot's clear Details / Library / Computer hierarchy and explain the actual unavailable-computer reason. This section supersedes earlier landing-panel and first-build-caption guidance for this panel.

R-PANEL-01 through R-PANEL-04 govern the header, shared tabs, live controls and all offline states. Enter from the conversation title for Details; use the monitor for Computer. Gear retains identity, memory, skills, commands and voice. The panel reads the existing private worker-task lane (including delegated private work), newest first. Tasks open their existing results and stop/rerun through the row menu. Library uses the shared team-file chip; file handles are scoped to the selected member's local workspace/team folder, with recorded artifacts/pages retained even without a running computer. Remote volumes are never scanned as local paths. The current scan is capped at 500 entries, depth 3, 100 visible files and 100 task/page/artifact records; ordinary Show more advances by 12.

Owner follow-up of 2026-11-05: say each thing once. Sleeping, starting, waking, updating, repairing, stopped Docker Desktop, missing installation, named remote failure and missing image show the full sentence only inside the screen. The header keeps a matching short state word beside location and overflow, without another face or explanation. Buttons sit after the sentence in normal flow; every offline state has the existing member slime. Only a live screen offers Enlarge and Take control underneath, with no repeated name caption. Details keeps the outer conversation heading and suppresses the list's internal heading. Owner engine recovery starts only the installed local app and reports readiness without implicitly creating a computer (since 2026-11-11 a member's own tool call also starts the installed Docker Desktop and waits up to 120 s, see R-PANEL-04; reads and the viewer still never do); selecting the location recovery opens the existing control. No administrator/app-update advice is shown for a stopped engine.

Consistency comparisons use the existing ui.tabs plain variant, shared fileChipHTML, btn and openMenu. The three member tabs fill the panel to keep equal navigation targets; Connections retains its compact counted tabs within Settings. Work menus have only the applicable action, while maintenance retains its wider descriptive rows and takeover retains its icons. These contextual differences reuse the existing components and tokens. Engine readiness uses the existing viewer notice with role=status and neutral text; failures retain role=alert. Offline recovery buttons retain the screen's existing dark contrast treatment over the wallpaper, while Enlarge and Take control use ordinary panel buttons below it.

```powershell
npm run look -- member-panel-details member-panel-details-empty member-panel-library member-panel-library-empty member-panel-computer-live member-panel-computer-asleep member-panel-computer-starting member-panel-computer-waking member-panel-computer-updating member-panel-computer-repairing member-panel-computer-docker-stopped member-panel-computer-docker-missing member-panel-computer-remote member-panel-computer-image-missing member-panel-docker-start member-panel-remote-location member-panel-location-hover computer-state-sleeping desktop-absent desktop-watch desktop-watch-collapse computer-maintenance-menu takeover-menu connections team-file-reply --theme both --width 1120,720,1920x1080
```

Use synthetic zh-TW fixtures, both themes and 1120/720/1920x1080. panel-state-layout checks sentence/button containment, pairwise nonintersection, ordering, visible face, exactly one visible full sentence and the short header word's agreement with the fixture state. Member-panel checks reject duplicate conversation headings and offline Enlarge/Take control. The task-stop/task-rerun scenes open their shared contextual menus without mutations, and team-file-reply is the shared chip comparison consumer. The library scene exercises ArrowRight, Show more and shared chips; the empty-library scene covers ArrowRight/ArrowLeft; live uses the real chat monitor. Keep the pre-fix desktop-absent overlap failure as red evidence; sleeping did not overlap at the captured baseline widths.

Inspect every contact sheet and full-size computer state at light 720/dark 1120 and Details/Library at 1920x1080. Compare with Grok frames f000442/f000457/f001037, shared Connections tabs, work overflow with maintenance/takeover menus and Library chips with the existing chat file chip. Judge the same selected run with those external reference frames and RAPHAEL_STAGED_DOCS=.fold. Native Windows/macOS launch, remote SSH/container operation and live brain/provider behavior remain unverified; tests never start real Docker. The initial brief overrides generic full-suite guidance: targeted tests only, one heavy waiter before look, no full verify/core suite. Follow-up 1 requires the 18 member-panel scenes above in one both-theme/three-width run, targeted tests plus ui-rules/i18n/architecture, no waiter, and inspection of every sheet, computer states at light 720/dark 1120 and Details at 1920. Exact evidence and omissions live in .fold/report.md.

## Settings and lifecycle merge (2026-11-05)

The member header reads state, shared location, maintenance overflow, settings,
close. A sleeping state gets a full-width line before the controls in the narrow
panel. The same location control moves into takeover without a second copy.
Empty computers retain location and installation guidance. Existing maintenance,
sleep choices, watch-only enlargement, leases and render caching remain intact.
The explicit remote host check and copyable repairs move from the retired settings
pane into the location popover using the existing viewer_status owner RPC.

```powershell
npm run look -- settings-owner safety desktop-host-local desktop-host-remote desktop-panel computer-maintenance-menu computer-state-sleeping owner-output-folder --theme both --width 1120,720,1920x1080
```

## Computer lifecycle in words (2026-11-05)

R-COMP-PERF-01/07/10/11/12 remain authoritative. The member panel header's
overflow offers Wait, Restart, Update, Repair and Reset, in that order. Shared
openMenu descriptions explain preservation/removal. Reset uses the existing
mb-confirm dialog and sends confirmed=true only after the owner's explicit yes;
changing members before confirmation performs no maintenance. Host and target
identity are captured and checked again in the main-window-only computer.lifecycle
RPC. The location control remains owned by the separate header unit.

Restart stops/starts the exact compatible owned container. Update rebuilds the
container on the currently installed image, without pulling or building a shared
image. Repair recovers the exact owned container by rebuilding it. Both retain
workspace mounts and browser profiles; changes outside workspace are ephemeral.
Reset removes only its validated workspace after confirmation, never team/shared
storage. Shared mode is explicitly named. Foreign/weakened, busy and owner-held
computers refuse maintenance. Other members cannot start the target while its
maintenance is running. No broad recovery/removal scan is used.

The header names sleeping, waking, updating and repairing using existing slime
sleeping/working states only. The menu's shared dropdown saves 5/15/60/0 idle
minutes through SettingsStore; zero means never. Shared/per-member mode is
read-only. Both local and SSH computers use the existing idle-stop contract.

VmTools reads bounded fake-testable df/du results at most every five minutes.
At 90 percent use of the computer's own disk or of the disk its workspace is kept on, the current member's ordinary
persisted conversation reply names the disk that is full (since 2026-11-14, R-COMP-DISK-01; the first sections) and, when the
computer's folders can help, its three largest workspace/cache folders, and asks before deletion. One
notice is emitted per pressure episode in the running core; below-threshold
readings admit a future episode. It never deletes, buys a service or calls a model.

Before dispatch, a failed driver connection receives one targeted reconnect or
missing-socket restart. Stopped computers follow existing start. A failed viewer
tunnel is closed and retried once. Repairs preserve workspaces and emit one
localized progress line when a member turn is active. An uncertain action gets
connection repair without replay; its result requires a fresh window/page read.
Grants and holds remain checked, and a second failure is returned to the caller.
Freshly started computers wait for driver readiness without a premature restart;
an already admitted repair also keeps its normal bounded readiness wait.

Synthetic zh-TW matrix, both themes and 1120/720/1920x1080:

```powershell
npm run look -- computer-maintenance-menu computer-maintenance-restart computer-maintenance-update computer-maintenance-repair computer-maintenance-reset computer-maintenance-reset-done computer-sleep-menu computer-state-sleeping computer-state-waking computer-state-updating computer-state-repairing computer-low-disk desktop-panel takeover-menu computer-file-confirm --theme both --width 1120,720,1920x1080
```

Compare maintenance/idle menus to takeover-menu, reset to computer-file-confirm,
and sleeping/working faces and header icon controls to desktop-panel at matching
theme/size. Maintenance descriptions use the shared mdesc rows, so their content
requires a wider/taller menu; reset adds a scope paragraph to the shared dialog.
The header face uses 28px to fit beside the existing icon buttons; its art and
states are unchanged. Tests: test_lifecycle.py, test_vm.py, test_latency.py, test_viewer.py,
test_smooth_computer.py, test_settings.py, desktop-viewer.test.ts and
member-details.test.ts. Only fakes are authorized; never operate real Docker.
The brief defers full verify/core suites and native/live acceptance to integration.
See .fold/report.md for exact exits, visual inspection and judge prerequisites.

The existing read-only SSH repair consumer also remains mapped separately; it is
not part of this brief's selected lifecycle capture:

```powershell
npm run look -- desktop-host-repair --theme both --width 1120,720,1920x1080
```


## Smooth computer work and private inline sign-in (2026-11-05)

The details screen has a separate Enlarge icon. It carries the existing iframe
into the window area beside the sidebar, retains no member-specific expansion,
preserves the guest aspect ratio through noVNC scaleViewport and never acquires
input. Its thin bar reuses the current public action words, Stop and collapse;
Esc collapses with the connection intact. Explicit takeover/teaching/files keep
their earlier behavior. The private request_takeover card now acquires input
inside its own iframe instead of opening full-window takeover (superseded on 2026-11-13 by R-PANEL-09: the card
is as wide as the conversation and its 接手 opens the larger view with control; see the first section). Its Done action
returns the current nonce once; Stop/cancel/disconnect never count as Done.
Owner input travels over RFB only. Held-control screenshots are not forwarded
to the parent thumbnail cache. Existing private work scope and post-handback
fresh-read requirements remain authoritative.

run_steps is a Raphael composite, not a forwarded driver batch. It accepts up
to ten curated driver actions and one targeted observation. Each subcall passes
ToolGate.call_plugin and the existing current tool/schema, grant, action-lock,
owner hold and audit boundary. Stop on the first error/lease notice; identify the
one-based failed step and count completed steps without returning intermediate
screen contents. Never reuse the outer approval for another action. Shell,
takeover, secrets and nested composites are excluded. Shared API/worker and CLI completion guards require a post-action window/page read or verify_state expect containing a meaningful window exists/bounds predicate or an element with a nonempty selector. Historical predicates records remain counted only by the tracker. run_steps validates its observation schema and meaningful expect before dispatching its first action; one correction is allowed, then completion fails.

Thin/empty/consent-wall web_read results escalate through the current member's
member's own browser only while that computer is already awake; a sleeping one is not woken for a page read (R-COMP-WAKE-01). Exact Reject all / necessary-only semantic buttons may be
clicked; ambiguous controls never imply consent. Every browser subcall retains
the normal gate and owner-hold checks. No fallback reader/provider is purchased.

Settings checks remote SSH key access, noninteractive Docker PATH, daemon and
installed image architecture through read-only SSH commands. Fixed localized
words replace raw diagnostics. Since 2026-11-11 (R-COMP-HOST-01) each failure class
(`ssh_unreachable`, `ssh_alias_unknown`, `ssh_hostkey`, `ssh_hostkey_changed`, `ssh_key`, `docker_missing`,
`docker_path`, `docker_stopped`, `docker_access`, `architecture`) carries the one command or snippet that
fixes it, built by `remote_host.repair_command` and shown as the core sent it; a host with Docker running and
no image is healthy (`image_pending`, a note that the first start prepares it in roughly 5 to 15 minutes).
The look checks desktop-host-health and desktop-host-repair assert a command that starts with `ssh <alias>`
and no build from the app's project sources. Docker operations share an owned SSH
session forwarding the remote Unix socket to an owner-only local socket; the viewer
uses SSH -W pipes. Unsupported forwarding falls back to ssh:// with bounded backoff.
No Windows ControlMaster or remote install/start is required.

Idle/eviction and app shutdown only stop compatible owned computers; workspace
mounts and browser profiles survive. A recognized v3/v4-to-v5 rebuild announces its
workspace/sign-in preservation before removal, never removes a volume and refuses
foreign or weakened containers. Files/installs outside workspace are explicitly
ephemeral in tool/persona text. Deleting a member removes its computer data too (see
[Deleting a member removes its computer](#deleting-a-member-removes-its-computer-2026-11-11)):
the 2026-11-05 unchecked option that named the host is gone.

Selected future look matrix (both themes, 1120,720,1920x1080): desktop-panel,
desktop-watch, desktop-watch-collapse,
desktop-watch-owner, desktop-takeover, desktop-takeover-owner,
desktop-takeover-done, desktop-owner, desktop-host-remote, desktop-host-invalid,
desktop-host-health, member-delete-ask-computer. Compare Enlarge/collapse/Stop with
the existing icon buttons and card Done/Skip with computer-card controls at the
same theme/size. The owner-typing scene uses synthetic RFB input only.

```powershell
npm run look -- desktop-panel desktop-watch desktop-watch-collapse desktop-watch-owner desktop-takeover desktop-takeover-owner desktop-takeover-done desktop-owner desktop-host-remote desktop-host-invalid desktop-host-health desktop-host-repair member-delete-ask-computer --theme both --width 1120,720,1920x1080
```

Native journeys: member-computer (its data folder saves `computer_vm_mode=per-bot`: the smoke's tool forms are
that kind's); shared-computer (a new data folder as it comes, so the shared default itself: the real Codex CLI,
two members made in the app, each at its own screen of one real computer, the second reads the first's file,
the Computer tab shows each a 1280x900 screen, the owner takes one and hands it back; needs Docker running and
the Codex login); computer-speed (explicit opt-in, never --all or
verify).
What the first real turns at a seat showed (2026-11-12, nine runs of shared-computer on the real Codex, effort
low), none of it visible to the acceptance run, which drives the tools as a careful caller would: after
browser_prepare a member reads the page with the browser's pid alone, or with nothing, and a CLI turn that is
started again when the computer's catalog changes names ids it never had; each was told its own window was not
on its screen and gave up (now that one read finds the member's own browser window,
`test_seat_tools.py::test_a_page_read_that_names_the_browser_or_nothing_reads_the_seats_own_browser_window`).
A member's browser was gone from its screen after a colleague was seated beside it: seating closed whatever
touched the free screen (`test_seat_wiring.py::test_a_seated_members_window_is_never_a_leftover_of_the_screen_beside_it`;
the acceptance run now seats a third member beside a window that reaches over the edge). The shell tool did not
say Linux and got PowerShell twice. A model's own judgement still decides a run (one took "run a command" for
the owner's PC): the journey's words name the member's own Linux computer, and one pass is not a proof. computer-speed creates its own random-root/name container, uses an
already running Docker engine and prepared image, serves its own form inside
that computer, measures five warm first observations, browser_open and five
browser_type actions via run_steps, and removes only that exact owned container.
It reports median/worst; every first observation must be <8s and page open <6s.
No unrequested batch budget is invented. Missing refs/results fail measurement.

```powershell
npm.cmd run native -- computer-speed
```

Offline evidence: test_smooth_computer.py, test_web_read_hint.py, existing VM,
takeover and persona tests, desktop-viewer.test.ts and member-dialogs.test.ts.
This brief prohibits look, native, judge, live, network/provider and real Docker
acceptance. These remain SKIP; fake connection counts establish sharing, not real
SSH/macOS/driver compatibility or latency. Check the task report for exact exits.

## What a computer has from its first start, and the owner at a seat (2026-11-13)

Image layer 8 (R-COMP-READY-01, R-COMP-SIGNIN-01, R-COMP-OWNER-INPUT-01). Owner: 「他們會有 chrome 等等之類的 我們一開始
就要把環境架設好了 不會只有 cua」, and, signing in to Google for his members: "This browser or app may not be secure".

- The members' browser is Google Chrome on amd64 (from Google's repository when the image is built), Chromium on
  arm64. It is started without the automation mark a page can read, with no warning bar and no "Restore pages?".
- The image adds git, wget, zip, unzip, jq, ripgrep, npm, sqlite3, poppler-utils, build-essential, less, nano, tree,
  file, and the Noto CJK and colour emoji fonts. Nothing in a computer is root: what is missing is added here.
- The shared computer has one browser. Its Browser icon opens a window of the members' own.
- The members' browser keeps no password, card or address (the profile is every member's); sign-ins stay as
  cookies. By its managed policy it is never signed in to as a browser and never syncs, so an owner's own
  passwords and history cannot come down into it. Chrome says "Managed by your organization" in its menu.
- Layer 7 computers, the shared six-screen one among them, are made again on layer 8 at their next start.
- An owner's own click and keys reach the seat it holds: the acceptance sends them through the app's relay path, and
  the `shared-computer` native journey takes a seat from the conversation's card after a member asks for a sign-in.
- A page a member opened with browser_open is read by that call: no second read is asked before its answer, and a
  turn that is started again shows no line twice (R-COMP-PERF-09).

Stated limits: no test signs in to Google (the owner's own sign-in is the proof); a seat's screen does not add a
Shift that was not sent (a script's "@", capitals from a Caps Lock that was on before the view opened); Chrome's own
sandbox stays off in a computer (every capability is dropped and the container is the sandbox); the image is 4.2 GB where
layer 7 was 2.7 GB (measured), and its first build downloads Chrome and the packages.

## The desktop names its browser (2026-11-13)

Image layer 9 (R-COMP-READY-02). Owner, of the panel on layer 8: 「但看起來底下不是顯示 Chrome ㄟ?」.

- The panel's launcher on every screen, and the menu's one browser entry, are named Google Chrome under Chrome's
  mark on amd64 (Chromium under its own on arm64). Until then a globe named "Browser" opened Chrome.
- XFCE's "Web Browser", the menu's Chrome and Chromium entries and `x-www-browser` start the computer's browser.
  On layer 8 the first asked which application to prefer, and the menu's Chrome entry could not start at all.
- Firefox stayed installed and left the menu (layer 10 removes it, below).
- Layer 8 computers, the shared six-screen one among them, are made again on layer 9 at their next start. A PC
  that built layer 8 builds layer 9 from what it kept (measured: 15 s for the new step).
- Check: `N screens browser mark` in `npm run verify -- --computer`, and the shared block's six launchers.

Stated limit: a member that starts `/usr/bin/chromium` by its own path still gets that browser.

## Firefox is removed (2026-11-14)

Image layer 10 (R-COMP-READY-03). Owner: 「Firefox 應該是沒有用了，你可以幫我把它從印象檔中移除，沒有關係。」

- Firefox ESR is purged from the image: the package, its `x-www-browser` alternative, its menu entry and mime
  registrations, `/etc/firefox-esr`, `/usr/lib/mozilla`, XFCE's own Firefox entry in its list of preferred applications. `which firefox firefox-esr` finds nothing.
- Google Chrome (the members' browser on amd64) and Chromium (the driver's, and the members' on arm64) stay. The
  launcher, the menu, XFCE's Web Browser and `x-www-browser` still open the members' own browser; the last fallback
  of `raphael-browser` is now an error line and not Firefox.
- Layer 9 computers, the shared six-screen one among them, are made again on layer 10 at their next start, workspace
  kept. A PC that built layer 9 builds layer 10 from what it kept (measured: 14 s, nothing downloaded).
- The image is no smaller (4.17 GB before and after): the base image's own layer still holds Firefox's files and a
  later layer cannot take them out. The browser is gone, the bytes are not.
- Check: `N screens browser mark` in `npm run verify -- --computer` reads the computer for any Firefox ESR package,
  program, entry, configuration or mention; the `previous layer 9` blocks start a layer 9 computer of each shape on
  layer 10 when a layer 9 image is on the PC.

Stated limit: a `.browser-profiles/mozilla` folder that an existing workspace already has stays in it.

## Responsive computer tools (2026-11-04)

R-COMP-PERF-01 through R-COMP-PERF-06 supersede the earlier full-screen bootstrap,
mandatory desktop re-check, 2 GiB memory cap and on-call discovery notes.
This unit changes core only; its brief forbids Docker operations, network, paid
models, look and native runs. All current evidence uses fake Docker/driver
boundaries. No measured improvement in a real member computer is claimed.

LocalVm remembers a successfully prepared Target for 45 seconds, including its
transport, lifecycle generation, enable state and timezone signature. Hot calls
skip capacity_lock and all Docker preflight launches. Bridge/VM failures, observed
stopped/unavailable/incompatible status and timezone refresh invalidate that
confidence. The next call performs full preparation; an uncertain action is not
replayed. Existing grant, screen lease and owner-control checks remain authoritative.

The routine first look is list_windows then a targeted get_window_state, bounded
to 200 elements and include_screenshot false by default, with query forwarded.
Screenshots are explicit; get_desktop_state remains available for whole-screen
pixels. Fresh window/browser reads clear takeover and stale-screen requirements;
list_windows alone never clears them. The shared member persona prescribes the
same contract and verification after meaningful changes.

browser_open(url, query?, scope_ref?) performs browser_prepare with the lasting
isolated_named/main profile, chooses one Chromium window, binds its active tab,
navigates and returns semantic_v2 page references without screenshot blocks. Its
subcalls reuse one owned session and check the grant/hold between stages. Window
mapping may lag browser preparation, so missing windows are polled for at most
five seconds inside that same tool call. It
refuses ambiguous windows, missing targets/tabs and non-http/https URLs, and stops
after any failed stage. Browser follow-up tools remain individually available.

The v5 image retains v4's --no-overlay only when serve --help advertises it; every
member driver connection also disables its exact session cursor_id and sets
max_image_dimension 1456. New computers use a 3 GiB
memory/swap cap (not a reservation) and two CPUs, with two local running computers.
Two members can work side by side; a third start evicts the least recently used
idle computer without interrupting active or owner-held computers. Old images/limits fail compatibility;
offline verification never migrates or touches any existing container.

CuaBridge matches replies by request ID with a single reader and a write-only
lock. Screen reads allow 120 seconds; actions allow 60 seconds. Cancelling or
timing out abandons the owned bridge process, fails its pending requests and
invalidates preflight confidence. Member reads emit one localized progress line
at ten seconds. Elapsed time is included in page JSON when present, otherwise in
text; lease notices retain their existing JSON contract.

All 30 curated driver tools and Raphael-owned browser_open, vm_exec, attach_file, request_takeover, fill_login and dataset are offered offline to every member in both computer modes.
Every member sees the catalog from turn one. The first actual driver
operation schedules a bounded background listing on a separate bridge, retaining
the action session. For the pinned driver that listing changes nothing a member was
offered (R-COMP-DRIVER-02): a CLI brain reads its tool list once, and a list that
changed started the turn again and lost the first call's result. A driver that
lists something else has its missing tools removed and its schemas taken in
the existing API/CLI/worker snapshot. Preparing a turn never starts or probes Docker.

Schema provenance: driver_schemas.json holds the offered tools' schemas from the
tools/list of cua-driver 0.37.0 in Raphael's computer image, captured from a running
computer on 2026-11-12 (MIT, see NOTICES). Until 2026-11-13 it was a compatibility
offer adapted from older macOS schemas with reconstructed Linux definitions, and
every one of its 30 tools differed from the driver. `npm run verify -- --computer`
compares a running driver's list with it, words and order included, and writes the
list it found to driver-tools.json in its run folder;
core/tests/computer/fixtures/generate_driver_tools.py writes both kept files (this
one and the doubles' driver_tools_0.37.0.json) from such a list. Packaging
explicitly includes this JSON and audits its presence.

What a model reads of a computer tool: Raphael's line on what the tool is for
(vm_catalog.DRIVER_TOOLS, or the tool's own definition), then the approval rule,
whole. The driver's own description is not offered; its parameters' words are.
Measured 2026-11-13: 40 tools, descriptions 17.8 thousand characters (18.4 on a
shared computer), parameters 55.6 thousand. The parameters are the driver's
verbatim text and are the same size a member's list already had after its first
use of the computer; before that use the list was 9 thousand characters of
parameters that the driver did not accept.

Offline scope: tests/computer, tests/agent/test_persona.py,
tests/agent/test_member_computer_use.py, tests/background/test_computer_lazy.py and
packaging tests, followed by the whole core suite once after wait-heavy.ps1.
The task report records exact commands, exits and counts.

Authorized acceptance still needed (audit section 2.5): time cold/warm desktop
capture with XFCE alone and with Chromium, bounded window reads with/without PNG,
docker stats with the 3 GiB/no-overlay image, and host docker info/inspect/exec true.
Also count Docker launches for a warm no-op tool, measure browser_open click-to-page
and ten-second progress/Stop latency, and compare the static/live Linux schemas.
Record elapsed distributions, failures, CPU/memory, image dimensions/bytes and
model steps. Do not claim fake test results as latency or native evidence.

Deferred consumer scenes: desktop-panel, desktop-viewer, desktop-owner,
desktop-takeover, desktop-takeover-owner, desktop-takeover-done and
chat-computer-takeover, both themes at 1120,720,1920x1080. Native member-computer
and vm-smoke should exercise the same tool/lease/browser path on an explicitly
authorized test container. Look, judge, native and live-provider checks are SKIP
in this offline-only brief, with no UI consistency comparison implied.

## Slime town and computer preparation (2026-11-03)

R-UI-92/93/94 replace the monochrome artwork and preparation stage-list assertions
only. The existing hour boundaries, five filenames, XFCE watcher, start/repair
controls, leases and single carried iframe remain authoritative. The approved
original town drawing uses paths, groups, ellipses, circles, rounded rectangles
and SVG 1.1 gradients. A fixed 32-bit LCG replaces Python random; generate both
asset folders through wallpaper.py --generate. The byte ceiling is 20,000, with
the largest current SVG approximately 15,000 bytes. No embedded/external images,
text, scripts, CSS or modern SVG features are shipped.

Preparation keeps the running preview's aspect ratio and bottom-aligned picture.
The member's shared face has local working motion at 64px (96px expanded), with
Raphael's emblem retained. The frame-token translucent pill holds only the
current localized stage, a real percent when supplied and the first-build line
while building. Existing stopped/error/install words and controls stay on small
legible surfaces. The retained wallpaper remains behind the connected iframe;
CSS fades the stream for 240ms only without reduced motion. patchHTML retains
the working face and unchanged renewals touch nothing.

The existing desktop-starting/building/preparing scenes retain the no-blank-stream
and content-containment checks, replacing three numbered steps/indeterminate
progress with the current stage and real-percent assertions. desktopHour fixes
the local fixture date independently of the host time zone. The synthetic RFB
uses that same parent date for its wallpaper. Desktop-viewer tests cover both
data-card-desktop-screen and data-card-screen consumers.

The shared card-shell look check retains its no-face contract everywhere except
the computer screen's explicit desktop-preparation > desktop-boot-face (R-UI-93).
The ordinary card.test.ts shell fixtures remain unchanged and face-free. The first
capture caught first-build pill overflow at 1120/720; shorter three-language build
and first-build words plus tighter pill spacing retain the 64px face and ratio.
desktop-boot-card covers the tool-card data-card-screen consumer; desktop-boot-inline
covers the timeline data-card-desktop-screen consumer. desktop-boot-connect changes
only the mock native readiness, then waits for the real poll/iframe connection. It
compares screen dimensions and period before/after, verifies no reduced-motion
animation, and samples the actual CSS fade at 0/120/240ms under normal motion.

Selected matrix, both themes at 1120,720,1920x1080:

```powershell
npm run look -- desktop-starting desktop-building desktop-preparing desktop-wallpaper-morning desktop-wallpaper-noon desktop-wallpaper-dusk desktop-wallpaper-evening desktop-wallpaper-night desktop-boot-inline desktop-boot-card desktop-boot-connect desktop-boot-raphael desktop-own-wallpaper desktop-own-wallpaper-card desktop-stopped desktop-unavailable desktop-absent desktop-panel desktop-viewer --theme both --width 1120,720,1920x1080
```

Compare the full-size preparation and town-period images and the preview/emblem
with the shared member-header face. Offline look evidence does not prove the
XFCE loader or guest timezone.

## Three computer levels (2026-11-02)

The monitor is always an icon entry and turns purple only for a running computer.
Details opens on the screen/caption, direct routine rows and conversations. The
gear leads to existing identity, fields and resources; Back returns through that
hierarchy. Skills and slash-command templates retain their distinct editors.
File changes opened from a result card offer only Back, which returns to the conversation;
nothing was taken over, so handback and the menu are absent there.
Routine pausing is saved inside the ordinary editor, never on the landing row.
An unprovisioned computer is omitted; unavailable/install/preparation
states retain their existing localized words and repair/start actions.

Screen and conversation-card takeover carry the existing iframe into a full-window
view. Its thin bar uses the member face/name, explicit handback and shared action
menu for files and teaching. Existing restore confirmation/review token and
teaching privacy/draft/save/discard/try flows remain authoritative. Handback closes
the owned stream, releases its current nonce once and retains the conversation
position. Refreshes with unchanged data preserve nodes, animation, focus, menus
and scroll (R-UI-71); action menus use ui.ts dismissal/anchor behavior (R-UI-73).

The original generated monochrome wallpapers are shared by the guest, off preview
and fixture RFB transport. wallpaper.py proves each hour's selection and generated
asset bytes. Since layer 6 the 30-second timer is the one watcher the core starts when
the computer is ready (`LocalVm._wallpaper`), under the existing guest TZ; the session's
`prepare-desktop` starts none (R-COMP-PICTURE-01).
Unchanged workspaces get no writes; late monitors are initialized on the next tick.

desktop-return-stopped leaves through the calendar and returns through the real member
entry: the unchanged off screen and Start action must remain visible. Failed opens
clear takeover intent; only a new request nonce resumes watching after handback.
Packaged data includes the Python watcher. Existing computers receive the same
script/art once per start through local/remote transport, with a three-second
best-effort bound and a detached XFCE/DBus watcher guard. Image labels stay fixed.

The handback scene also reopens a fresh stream and takes control only after it
connects. The draft scene returns to the screen and reopens the same unsaved
editor. Stopped renewals after a running stream preserve the no-write contract.
Additional consumers cover context-menu-routine, automation-event-pick,
automation-webhook, routine-event-missing/profile, missing-routines,
polish-caption-member.

Selected scene matrix, both themes at 1120,720,1920x1080:

```powershell
npm run look -- computer-status-active computer-status-idle panel-screen-routines panel-off desktop-start desktop-return-stopped panel-no-computer panel-gear panel-routine-row panel-raphael takeover-bar takeover-menu takeover-handback --theme both --width 1120,720,1920x1080
```

- computer-status-active, computer-status-idle, panel-screen-routines, panel-off,
  panel-no-computer, panel-gear, panel-routine-row, panel-raphael, takeover-bar,
  takeover-menu, takeover-handback.
- Every desktop-*, computer-*, details*, member-edit* and member-avatar scene;
  chat-computer-takeover, chat-human-control, chat-handback and card-computer-*.
- Representative changed consumers: routine-event-row, routine-event-edit,
  routine-event-saved, menu-hide-control and menu-move-hover.

Existing desktop-collapse now closes the preview; desktop-entry explicitly opens
the landing preview; desktop-viewer/owner and card-computer takeover use its screen
press and thin bar. desktop-handback now checks closed transport. Teaching enters
through the shared menu. File scenes enter the same menu and retain all restore
assertions. details-routines keeps its name as the landing routine regression,
without a routines subpage. details-resource, member-edit and member-avatar scenes
enter through the gear. The earlier collapse/separate-computer-page and inline
owner-control assertions are superseded; single-stream and nonce assertions stay.

Compare menu controls to existing shared menus and routine controls to automation editors
at the same theme/width.

## Named datasets (2026-11-01)

Both computer modes offer dataset import/query/list/chart; per-bot paths stay unchanged, while shared databases, locks, attachment imports and charts use .raphael-data/members/<core member key>/ and share only the venv and install lock. A dataset name
selects a persistent workspace DuckDB file; table defaults to data. CSV, Excel
(.xlsx) and Parquet paths resolve inside that workspace. Stored attachment ids can
be imported with attachment:<id>; the existing vm_exec gate copies bounded chunks.
Multiple sources union by column name; importing a table replaces that table in
one transaction. Queries can save CREATE TABLE/VIEW AS SELECT results and otherwise
return bounded rows. External file/network access and extension loading are disabled
for queries. Charts require label/value columns and return an escaped SVG file.

The first use creates a locked workspace venv and installs duckdb==1.4.1 and
openpyxl==3.1.5. No Dockerfile or image layer changes: owners do not rebuild their
computers for this feature. Installation requires the member computer's package
access, and failure is returned through the ordinary tool result. A stopped task
cancels existing vm_exec, leaving the durable database available for a later turn.

Core evidence includes production API/CLI/routine calls with a fake VM returning
its real output shape. Real DuckDB import/reopen integration is explicitly skipped
when its offline dependencies/Linux lock module are absent. No real installation,
Docker start, host kernel or provider call is exercised.
Selected UI consumers: dataset-table and dataset-chart, both themes and all three
standard sizes; compare with the existing rich table and stored file controls.

Dataset work reaches the ordinary owner-rule screen. In bypass mode it asks no
permission question, but explicit denial still forbids it (R-AG-35).
Every nested exec/file call retains the member grant, target and owner-control checks.

## Teach by demonstration (2026-11-01)

The member computer has one Teach a task / Stop recording button. Starting uses
the existing input lease and shows a persistent privacy line and one-press discard.
The member's own available computer can record in either mode. Shared recordings use only the current seat's window list and clipped RFB picture, never canvas-wide accessibility or desktop calls. Docker absent,
stopped computers and previews retain their existing prerequisite controls.
Shared mode satisfies the teaching prerequisite; previews, changed targets, pending work and unavailable computers retain their existing prerequisite checks.
Repair buttons inside the fixed dark desktop frame use that frame's resting, hover and pressed fills,
so the same light text stays readable in either application theme (R-UI-52).

Recording saves ordered clicks, keys, nonprivate text and changed screenshots in
the member's home. Password/sign-in titles, unavailable observations and shared private-page marks omit both text and images and turn typed keys into private_input. Clipboard values are omitted. The cap is 4 MiB (including
reserved draft space), 2000 events and ten minutes. Disconnect interrupts recording;
restart can review/discard its data but never resumes control. Discard cancels a
pending draft and removes its recording.

Stop releases control and asks the selected member brain for a tool-less draft.
It reads ordered actions and safe observation text (per-bot accessibility or shared seat-window text); retained screenshots are evidence, not model attachments.
The draft treats captured data as untrusted and uses the ordinary skill format
plus Inputs, semantic goals and final Verification. The existing resource editor
holds this unsaved document; only Save publishes it. Afterwards, the owner types
a fresh input and presses Try once in that same conversation. The skill remains
an ordinary private member skill on API, CLI and scheduled routine paths.

Selected local UI matrix:

```powershell
npm run look -- desktop-teach-recording desktop-teach-failed desktop-teach-draft desktop-teach-saved desktop-teach-try desktop-teach-discard desktop-teach-shared desktop-owner desktop-absent details-skills --theme both --width 1120,720,1920x1080
```

The teach-* rendered checks assert lease actions, visible privacy/repair, the
editable draft before Save, explicit publication, discard without publication,
and the ordinary conversation call with skill name and fresh input. Compare the
draft editor with details-skills, and teaching controls with
desktop-owner. Offline proof: members/test_teaching.py, evaluate/test_teaching.py
(API and CLI plus routines), computer/test_rfb_input.py and desktop-viewer.test.ts.
Real Docker/cua accessibility, screenshot privacy across third-party applications,
native shell, live model quality and judge remain separately unverified.

## The owner's PC is for a quick question alone (2026-11-13, R-PC-01)

Owner: 「正常對話的時候，不會有操控我電腦的邏輯…操控我電腦的邏輯只會在快速問答的部分，就是我按下 Alt+Space 的時候才會有這個權限」.
One switch decides it, `take_snapshot(owner_pc=...)` (`ask.quick`, never nested): without it a turn is offered, finds and
refreshes into none of `mcp:local/local_exec`, `mcp:local/local_job`, the harness `computer` tool (the guarded run on the
owner's desktop) or the fixed commands (open, volume, media, lock_screen, copy_text). That is every typed or spoken
conversation, Raphael's or a member's, rooms, exchanges, Telegram/Slack/Discord, background tasks, routines and event
runs, on API and CLI brains, in every permission mode. The fast router (Jev) is asked about a quick question alone, so a
conversation never routes to a command or a desktop run. The prompt of such a turn carries no owner's-PC words
(`persona._OWNER_PC_RULES` and the owner-context output-folder sentence are added to a quick question only); it says
that anything needing a computer is done on the member's own computer and, when that is not available, to say so.
`LocalTools.call` refuses a call whose context is not a quick question (`presence_required`, even under 全部允許), and
the harness `computer`, command and CLI native-command paths repeat the check (`AgentService._owner_pc`). A quick
question is unchanged, including that it can show no card, so a local command runs there only where nothing waits for a
yes. The consent card, the Settings mode and the background approvals below are kept in the code, with no door
until the owner decides whether a quick question asks at the overlay.

Offline: core/tests/agent/test_owner_pc_reach.py (lists, prompts, API and CLI, every mode, a quick question, the member's
own computer), computer/test_local_commands.py (the context), background/test_local_commands.py,
members/test_local_commands.py and brain/test_owner.py. No look scene changes: nothing rendered changed.

## Owner-PC commands (2026-11-01; now a quick question's alone, see above)

Owner-PC diagnostics and CLI work use local__local_exec rather than the Linux
sandbox or guarded real-desktop mouse/keyboard tool. A quick question sees the
pinned local_exec/local_job definitions on API and CLI MCP paths, no other turn does.
Settings has no control for the mode (removed 2026-11-14 at the owner's word: 「本機指定我覺得應該可以先拿掉」),
and the setting itself stays: ask (default), always and never, one value for a quick question. First consent names the
requesting member and asks for all members, with four real answers. Later command cards show Allow/Skip
and no way into a setting. Exact multiline commands and cwd appear on the shared
permission card; no command arguments or results appear in public steps. The
background renderer uses the same card. Chat has no timer (also in CLI/shell);
background questions expire after 30 minutes. Esc denies once. Phone/Telegram
answers never approve. Always still asks after outside content or for dangerous,
opaque and subscription CLI commands; the secret-store deny list always refuses.

`local_host.py` uses PowerShell -NoProfile -NonInteractive, UTF-8, hidden windows,
closed stdin, home cwd, worker secret filtering, bounded head/tail stdout/stderr,
model-selected timeout, nonzero exit results and the existing Child tree cleanup.
Background IDs expose output/stop only to the same member conversation or task.
Stop/app close cancels the tree. These regexes are a best effort, not a sandbox;
the owner card remains the permission boundary. cua-driver session is removed
from both schema variants and rejected if injected at execution.

```powershell
npm run look -- local-command-consent local-command-later local-command-background local-command-once local-command-always local-command-never local-command-deny local-command-settings-gone local-permission-card --theme both --width 1120,720,1920x1080
```

Inspect every contact sheet, all pending/settled/background cards and settings at
both themes and all widths. Compare the existing Gmail permission card with local
cards and the shared dropdown with its settings neighbors. Checks verify exact
command wrapping, four/two functional buttons, no gold duplicate, no timeline echo,
saved modes and card containment. Core tests: agent/test_local_commands.py,
computer/test_local_commands.py and background/test_local_commands.py. Frontend:
permission-card.test.ts, pages/settings-view.test.ts, pages/agent-cards.test.ts,
background-questions.test.ts. Full handoff core scope:
tests/agent tests/background tests/members tests/computer tests/worker.

Acceptance still requires the owner's real CPU question to member 13 on both API
and installed CLI brains, harmless process inspection, explicit approval/dismissal,
tree cleanup on Stop/app close, and the Docker path after schema discovery.
Offline fakes and rendered fixture success do not prove Docker, cargo, native
journeys, network, judge or real subscription commands. Rule IDs: R-PC-01/02/03 and R-AG-13.

The optional Docker desktop defaults to one shared computer on this PC (a seat per member, section
"Shared computer seats" above; 6 GiB and four CPUs) and, on a remote host or when `computer_vm_mode=per-bot`
is saved, to a durable workspace, container and browser profile per member (3 GiB and two CPUs each), plus
a shared team folder at `/home/cua/team`. `LocalVm.mode` decides; what follows describes the per-bot kind. Host paths use pathlib and Docker CSV bind
mounts; no host shell or alternate runtime is used. The core starts an installed Docker Desktop through the host adapter on the first actual
computer operation. A turn's tool preparation never invokes Docker. When Docker is absent,
no computer tools are offered; the existing Settings computer area has one requirement line and an official download button.

`computer/vm_catalog.py` curates 30 driver tools plus Raphael's `vm_exec` and
`attach_file` (32 total). Each selection has a one-line reason. Screenshot/window
state, input, application/window discovery, clipboard, verification and the Linux
CDP browser helpers are offered together offline from the first turn.
The checked-in compatibility schemas and Raphael-owned tools are refreshed on use
by a background driver listing; exact pinned Linux schema capture remains pending
as described above. Missing tools are removed, and changed schemas are validated
before forwarding when the refreshed definition is available. The real catalog
stays in memory for later turns in this process. Core-owned
`PluginTool.pinned` metadata excludes them from the 40-plugin budget, keyword
shortlists, model refinement and the foreground planner's selection. Other plugins
keep their existing cap and discovery. Driver updates/installs, configuration,
recording/replay, escalation, lifecycle and redundant script runners are excluded;
unknown future driver names are excluded too. No backend-supplied flag can pin a
normal plugin tool. The gate and owner-control lease still apply on every call.

The recorded names fixture is `core/tests/computer/fixtures/cua-driver-0.37.0.json`.
It lists 68 unique names (including the two Raphael
tools) and the fixture preserves all 68. The pinned Linux wheel was unavailable
offline, so test schemas are explicitly synthetic objects, not captured schemas.
Browser selection follows Cua's documented Linux CDP support; real image/browser
operation remains pending the owner's native run. The native assertions are intact,
and their fake-runtime test now replays the complete supplied catalog.

The existing `AgentService`, background snapshots, ToolGate, approval cards and
metadata-only audit remain authoritative. Cua MCP runs through `docker exec -i`
as `cua`. The same authenticated `RaphaelMcp` implementation exposes a `computer`
endpoint to Claude/Codex/Antigravity, while API brains receive the same tool
definitions through the production snapshot. Screenshots, clicks, typing, scrolling,
app launches and `vm_exec` are T0 and run without per-action approval, including in
global Ask mode (`agent/gate.py`: the registry asks only above T0 in that mode).
The foreground and background harness skip per-action safety classification for
these sandbox tools. `attach_file` retains its existing T0/workspace contract.
Owner control refuses every call immediately, including screenshots, clicks and
exec. Members share the one screen by turns: a member whose turn comes while another
has the screen waits up to a minute with one progress line (「正在等 <成員> 用完電腦」),
then gets a result, not a failure, that names who holds it and for how long
(`computer_busy`, no evidence of work) so it can do other work or ask again. After
waiting, or after another used the screen, its first action returns `screen_changed`
until it has made a fresh targeted window/browser read (or explicit whole-screen read) again. Commands (`vm_exec`, `attach_file`) never
take or wait for anyone's turn at the screen.

Before sending a message or email, publishing or posting, deleting anything outside
the workspace, paying or buying, the member must first call `approve` on CLI brains
or request the equivalent owner approval through the API harness and wait for the
owner's yes for the exact action and target. If that approval is unavailable, denied
or expired, it must stop without acting. Sandbox success is never outward approval.
This contract is in every driver/exec tool description (within the shared offer's
400-character cap) and the shared doctrine in `agent/persona.py`; no click classifier
is used. Contract tests check the actual snapshot and every CLI/API/worker persona.

`vm_exec` defaults to 60 seconds, caps at 1800 seconds and 20,000 combined output
characters, and times out in the guest as well as the host. With `background` it starts
detached and returns a job, its log and its `.exit` file under `.raphael-jobs/` in the
workspace (at most six hours); the member reads them with later commands. `attach_file` only
copies regular files under `/home/cua/workspace` into the existing attachment
store. Guest directory traversal and symlinks are refused with openat/no-follow.
Screenshot blocks reach CLI and API brains, are treated as untrusted screen
data, and are omitted from saved background continuations and public steps.

New containers reuse the last validated IANA zone sent by the UI to `home.overview`
as `TZ`, falling back to UTC until one is known. The zone stays in memory; no
setting or platform-specific lookup is added. Existing containers are not recreated.

Container reuse checks ownership, image ID/labels, bind mount, loopback publishing
and resource/security limits. Idle shutdown defaults to 15 minutes (5-1440),
preserves the workspace and skips owner-held or active desktops. Startup recovers
only containers owned by this data directory and verifies compatibility before use.

From `app/`, with the installed Python selected via `RAPHAEL_CORE_PYTHON`:

```powershell
npm.cmd run verify -- --contract
npm.cmd run native -- member-computer
```

The native journey starts installed Docker Desktop and builds the pinned image
through the shared lifecycle when needed. It requires explicit authorization and
an idle machine before running. It uses an isolated
journey database and a deterministic fake brain through the real worker loop,
snapshot, gate and Cua tool transport. It checks the shared VM, a valid screenshot,
a click and guest exec without approval, attachment bytes, owner-control refusal
of every call and connected noVNC canvas. It never synthesizes an owner's yes;
`without_approval` and `owner_held_refused` name the asserted calls in the report.
The runner captures the real tool screenshot and the in-app noVNC viewer, then stops only its
own container. It makes no provider requests. Keep and inspect its report and
contact sheets; a missing engine/image is a blocker, never native acceptance.

Phase A adds no application UI. Phase B extends the existing member details side panel with the live desktop. The own-PC cua driver remains Phase C.

Tests: `core/tests/computer/test_vm.py`, existing agent CLI/MCP, background and
worker suites. Attribution: `core/packaging/licenses/NOTICES.md` and `core/packaging/licenses/Apache-2.0.txt`.


## Live desktop (Phase B, 2026-10-30)

Phase B uses the container's noVNC RFB library in a UI-free loopback shell. The
standalone noVNC stylesheet, controls and disconnected curve are omitted. Native
scaleViewport/resizeSession/clipViewport options keep the framebuffer undistorted.
Passwords reach RFB memory only through no-store responses, never HTML, URLs,
status, reports or logs. Host/origin checks, a sandboxed no-referrer iframe and an
unpredictable session capability guard the loopback bridge. No new RFB dependency
or upstream source is bundled. The production shell/bootstrap runs in look with
only the remote RFB class replaced by the synthetic transport fixture.

The desktop-frame check measures the limiting axis, aspect ratio, clipping,
standalone controls and unobscured canvas corners. Browser fixtures cannot prove
Docker, WebSocket/VNC authentication or native CSP. Native member-computer needs
a fresh debug build, real Docker and its isolated local sign-in page. The journey
checks the VM timezone against the host, real screenshot/MCP/exec/attachment paths,
the owner lease, no member call while held and exactly one nonce continuation.
No screens, owner input or credentials are persisted in the continuation or chat.
External commits, payments and messages still require the separate approval path.

```powershell
npm run look -- desktop-entry desktop-viewer desktop-owner desktop-handback desktop-stopped desktop-unavailable desktop-starting desktop-building desktop-preparing desktop-absent desktop-install --theme both --width 1120,720,1920x1080
npm run look -- desktop-panel desktop-takeover desktop-takeover-owner desktop-takeover-done chat-computer-takeover --theme both --width 1120,720,1920x1080
```

## Side-panel computer (owner, 2026-10-30; supersedes inline viewer/card UI)

The existing member details drawer owns one Computer section, including at 720px.
Opening a conversation with active computer work or a new takeover nonce opens that
drawer automatically. The timeline retains one centered metadata-only event for the
private turn; it never mounts screen cards or preview sessions. Help text sits above
the screen, including sign-in/password/2FA/CAPTCHA/payment.

Click the screen to acquire the core lease in place. The iframe, session and noVNC
connection survive acquisition, handback and expansion. A small edge status says
You are in control. One handback action says I'm done for the current pending nonce,
otherwise Hand back. Expansion changes the same section's layout, without a dialog.
Closing the drawer, leaving, disconnecting, timeout or Stop never completes a nonce.
Only explicit I'm done resumes the same suspended call once.

The loopback RFB input gate parses bounded masked WebSocket/RFB messages, forwards
framebuffer negotiation/requests continuously, and permits keyboard/pointer/clipboard
only for the current unexpired session owner. Unknown protocols/messages fail closed.
Control changes retain the owning stream while closing other target sessions. Stale
handshakes remain invalidated. Payloads are transient protocol buffers, never persisted.
The bridge confirms the first accepted pointer after click through an input counter;
native member-computer records click-to-interactive and click-to-accepted-input timings.

Affected scenes: desktop-panel, desktop-takeover, desktop-takeover-owner,
desktop-takeover-done, desktop-entry, desktop-viewer, desktop-owner, desktop-handback,
desktop-stopped, desktop-unavailable, desktop-starting, desktop-building,
desktop-preparing, desktop-absent, desktop-install and chat-computer-takeover.
Capture both themes at 1120,720,1920x1080 and inspect every contact/full-size image.
Native member-computer signs in only to the disposable local page via the real
side-panel noVNC stream, verifies no member calls while held, then one continuation.
Docker runs only in an exclusive heavy slot. Stop only the journey-created container by exact name afterward; never stop Docker Desktop or another member computer.

## A member's computer needs no permission (owner, 2026-11-11; supersedes On-demand member permission of 2026-10-31)

Owner: 「每個 bot 配一台電腦的功能要一模一樣」 (as Grok Bot, where nothing asks and no grant exists) and
「要盡量減少顯示在前端的事情 不要讓使用者需要思考太多不是他們該思考的東西」. Rule: R-COMP-ACCESS-01.

A member uses its computer when its work needs it, as it uses any tool, under the permission mode the owner chose.
Removed: `computer/grants.py`, the pinned `computer__request_computer` T2 request and its 「允許 {member} 使用電腦」
card, the grant written by the owner's open of the viewer and by the maintenance CLI, the member-made-by-a-member
inheritance, the refusal text of a routine without a grant, the panel's take-back button, the `computer.revoke` RPC
(also in the Rust allowlist and `management.py`), `granted` in the status and session answers, and
`computer_permission_required` (a changed target now answers `computer_changed`, an unknown member `blocked`).
The table `computer_grants` (migration 45) and its member-delete trigger stay in the schema, unread and unwritten:
dropping it would need a migration for nothing the owner sees.

`VmTools.offered_for(member)` gives every member (routines and room speakers too) the tools of its own computer
whenever computer tools are on and Docker Desktop is installed (or a remote host is chosen): the offer is offline,
`prepare` probes nothing and a turn that never calls a computer tool never starts Docker. A PC without Docker offers
no VM tool and leaves the owner's own desktop tool on offer (`has_own_computer` is false there). The first real call
may start Docker Desktop on this PC for any member; a remote host never does.

The computer is not a connection (owner, 2026-11-14: 紫苑's `members.tools` was `["web_search","web_read","weather","local_time","50a816b0b31c"]`;
it said it would use its own computer to read a page and could not). A computer tool's key is `mcp:computer-<id>/<tool>`, and
`Speaker.uses_plugin` read that as a connection the owner had not chosen. It now lets every computer tool through, so a member's
list of tools, set or empty, never takes its computer: `core/tests/computer/test_member_computer_access.py`
(`test_a_member_with_a_list_of_chosen_tools_keeps_its_own_computer`, `test_the_tools_a_member_with_a_list_sees_are_the_tools_it_can_call`).
There is no per-member off switch to migrate (the list had no place for the computer), so nothing is migrated. A member on a PC
with no computer is offered none, and its prompt says that with no computer tool listed it says so plainly and promises none
(`test_a_member_without_a_computer_is_offered_none_and_told_not_to_promise_one`).

What stays exactly as it was: sandbox gestures pass the screening and need the lease; `fill_login`, `fill_contact`,
`fill_card` and `dataset` still obey the safety rules and the mode (`fill_card` is T3); the worker still cannot
drive the owner's own desktop (`ToolGate.check(worker=True)`); payment holds, takeover, the owner's hold and a
changed target still refuse a call; checkpoint restore still asks for the owner's confirmation unless the mode is
全部允許 (`LocalVm.full_permission()`). In 先詢問 and 計畫 sandbox gestures were never asked after the first yes and
are not now (the one question that is gone was the grant itself).

An explicit non-preview `computer.viewer_open` (the owner's press on the screen) launches a stopped computer;
preview opens and status reads never do. Looking at the panel never starts a computer.

Offline regressions: `core/tests/computer/test_member_computer_access.py` and
`core/tests/agent/test_member_computer_use.py`, plus the existing computer, agent and background suites.
The UI side is R-PANEL-06 (the computer is the third tab only; Details has no computer row) and R-COMP-QUIET-01 (nothing but handoff cards in the conversation).

## The computer is the third tab only, and the quiet thread (owner, 2026-11-14; the thread 2026-11-11, after Grok Bot)

Grok Bot's panel has a computer row that reads Asleep, then Connecting, then a live picture about eight seconds later and
Awake, and Asleep again a few minutes after the last use; a press opens a full-window view whose pill reads
Watching / Take control and then You're in control / Stop; in the thread the Bot's computer use is two short bubbles
and a quiet label naming the step; nothing asks for permission to have a computer.

Raphael followed with the same row in Details on 2026-11-11, and removed it on 2026-11-14 (R-PANEL-06). The owner sent a
picture of Raphael's Details (the routine, 對話, a row 「拉斐爾的電腦 休眠中」 with a small screen, 訊息平台): 「右邊這邊詳細資料裡面不用有電腦，
不用跟 grokbot 一樣，因為我們電腦已經在上面的 tab 了，我們就固定在第三個 tab 裡面，有電腦就好了，其他地方可以不用」. So the computer
lives in the third tab (電腦) only. Details holds the routines, for Raphael his conversations, and the chat platforms, for every
member and in every state of the computer; no row, heading, state word, small screen or press for the computer. What went with
it: `computer-row.ts` (the model the viewer published and the row drew), `rowShown` (the stream the viewer opened unseen while
Details was open, so the row had a live picture), the `member-computer-open` event and the row's 下載 / 啟動 words, the `woken`
note in the state's place and the `computer.row.*`, `computer.woke.*` and `desktop.event` words. A PC that cannot give a
computer says so inside the Computer tab's screen as before (R-PANEL-03, R-PANEL-04); a member's own tool waking the computer
is told by its one line in the conversation (R-COMP-WAKE-01). The core still reports `woken` in the viewer's status and the app
no longer reads it. Not touched, because none of them is the panel's row: the conversation's computer cards
(`computer-card.ts`, `desktop-timeline.ts`), the green dot on the header's conversation button while a computer is active, and
Settings' list of always-allowed apps (`settings-view.ts::computerRows`). The Computer tab, its host control and its maintenance
menu stay as they were.

The larger view's pill: watching offers Take control; in control reads 你正在控制 with a quiet 停止 that hands the
computer back through the same takeover (the sign-in request's button stays 我完成了). The pill is the only place that
says it: the screen has no badge of its own (owner, 2026-11-13: 「明明下方就有顯示我正在控制的，為什麼左邊還要再顯示一次？」;
`desktop-owner` asserts 你正在控制 shows once).

The conversation shows no line or card for a running, finished or stopped computer task any more
(`desktop-timeline.ts`); only a handoff the owner must act on is a card.

```
npm run look -- member-panel-details member-panel-details-no-computer-running member-panel-details-no-computer-asleep member-panel-details-no-computer-docker-stopped member-panel-details-no-computer-raphael member-panel-library-raphael member-panel-computer-live member-panel-computer-live-raphael member-panel-computer-asleep member-panel-computer-docker-stopped desktop-watch desktop-watch-owner takeover-bar desktop-panel chat-computer-takeover --theme both --width 1120,720,1920x1080
```

Not built, needs a real engine: one computer with a screen per member (see the unit report and
`bots/research/shared-computer-2026-11-09.md`); the engine start on a PC with Docker Desktop stopped.

## Quiet, lazy startup

The Windows host prefers PATH `docker.exe`, then
`%ProgramFiles%/Docker/Docker/resources/bin/docker.exe`. A hidden, read-only
`docker desktop start --help` probe checks the installed CLI. A supported CLI starts
with `docker desktop start --detach`, with no shell and discarded standard streams.
The GUI launcher is a legacy fallback only when the CLI is absent or the probe
fails with an explicit diagnostic that `desktop` is not a Docker command. Other
probe failures do not open the GUI. LocalVm retains its engine readiness polling,
preparation progress, errors, owner holds and leases.

Offline coverage: `tests/computer/test_desktop_host.py`, `test_vm.py`,
`test_member_computer_access.py`, `test_takeover.py`, `tests/agent/test_member_computer_use.py`,
`tests/background/test_computer_lazy.py`, and the snapshot/CLI/worker consumers.
All startup tests fake processes and Docker.

Owner acceptance: from `app/`, run `npm.cmd run native -- member-computer`
in the authorized native environment. Its pre-launch smoke asserts zero Docker
commands while preparing a turn, starts on the first actual screen call,
refreshes controls, and asserts zero Docker commands for the following prepare.
Also run an API and CLI greeting with Docker Desktop initially stopped,
then request a screen operation: greetings must leave it stopped, the screen
operation must complete without a Docker Desktop window appearing or taking focus,
and a following greeting must not start anything. Inspect the report and captures;
CLI fakes cannot establish real Windows window/focus behavior.

## Per-member hosts (2026-11-01, supersedes earlier local/shared assumptions)

The existing Settings > Raphael computer area uses the shared dropdown for This
computer / Another computer and shows an SSH alias input for the latter. It explains
separate sign-ins and the team folder. The remote choice never offers a local Docker
requirement. Invalid aliases stay in the field with an inline error that wraps
inside the settings column at narrow widths and never reaches storage. With local
Docker absent, installation remains in that same area; all other capabilities work.
Alias changes take effect for new targets without restarting the app; captured old
targets retain their original engine. Nothing reads SSH keys or starts a remote host.
Remote workspace/team volumes belong to that Docker engine; attachments use the
guest reader. The viewer uses an ephemeral loopback SSH forward, no remote published
port. Remote computers stay awake; local idle-stop and a two-computer capacity bound
apply only locally. Busy/held machines cannot be evicted; old running owned
containers count toward capacity but are never stopped automatically. Real Docker/SSH acceptance,
image startup and resource measurements are pending the owner's build/setup.

The frame adds the member's name and bare collapse action in a dark shell, in both
themes. Collapse retains the stream and never completes a takeover request. Compare
Settings dropdown/input with existing city and language fields, and frame controls
with the member details header at the same width/theme. References were supplied
outside git; trademarks and task teaching are excluded. The noVNC fixture proves
only the frame and real app interaction, not pixels from the unbuilt desktop image.

Selected scenes: desktop-host-remote, desktop-host-invalid, desktop-collapse,
desktop-panel, desktop-viewer, desktop-owner, desktop-handback, desktop-takeover,
desktop-takeover-owner, desktop-takeover-done, desktop-stopped, desktop-unavailable,
desktop-starting, desktop-building, desktop-preparing, desktop-absent, desktop-install.
Run both themes at 1120,720,1920x1080. Core: tests/computer/test_hosts.py plus
computer, grant/choice, lazy background, settings, native cleanup and architecture
consumers. Native cleanup recovers and removes every container owned by the isolated
journey data directory, retaining its workspaces. Each test member gets its own
sign-in fixture; native frame checks still run inside the cross-origin viewer.
Cleanup never stops Docker Desktop.

```powershell
npm run look -- desktop-host-remote desktop-host-invalid desktop-collapse desktop-panel desktop-viewer desktop-owner desktop-handback desktop-takeover desktop-takeover-owner desktop-takeover-done desktop-stopped desktop-unavailable desktop-starting desktop-building desktop-preparing desktop-absent desktop-install --theme both --width 1120,720,1920x1080
```


## Work channels, file restore and private page login (2026-11-01)

Slack and Discord join Telegram in Settings > Messaging, using the same rows,
separate Credential Manager tokens and the existing local pairing allowlist.
Only direct messages enter a conversation. Incoming captions and bounded files
reach the same assistant together; stored reply files return to the paired chat.
No remote message can approve pairing or execution. Slack uses paginated polling;
Discord uses the bounded TLS gateway and direct-message intent.

Before a turn's first non-read vm_exec, the computer takes one independent bounded
snapshot. Commands retain their original bytes and executor; gestures take none.
The pure Python guest archive stores SHA256 objects and manifests; unchanged size
and mtime avoid rereading a file, and identical manifests add no checkpoint.
Failures/timeouts never fail the command. Files above 20 MiB and partial walks are
named as uncovered in the panel. The archive retains 20 checkpoints per member
within approximately 500 MiB of objects per computer, pruning unreferenced objects.
Changes are compared on request against the next manifest or live folder. Restore
checks the reviewed after-state digest/mode and names later edits it leaves alone.
There is no pending/finish state. Full permission skips the additional confirmation;
grants/revocation still apply. Caches, repositories and browser profiles are excluded.
The existing panel uses relative folder words, compact time and signed added/removed
lines without diff headers; incomplete coverage never promises a complete restore.

request_secret(site) extends the existing secure card with username/password.
Credential Manager holds the values; SQLite holds only member/origin/reference
metadata, independently of the requesting turn. fill_login, fill_contact and fill_card share _type_page_fields: before internal reads, resolve unique remembered main-document meanings; match one typeable main frame/role/name row per fresh exact-tab snapshot; retain per-field HTTPS/grant/label/amount checks; always set replace=true and require exact delivered_count without effect=refused. Fill reads make the member picture stale through stale/screen_changed and require a fresh read before another action. It never submits. Takeover remains available. Driver results and untrusted fill exceptions yield only filled true/false; trusted frame and ambiguity refusals also include fixed value-free request_takeover guidance. Later page text/errors redact plain
and JSON-escaped values on computer results before model/history/events. Delegate
results pass through untouched. Filled-page pictures stay hidden while any exact target/tab mark remains. A complete read of that same tab showing another HTTP(S) origin and no filled refs, or the driver's reply during its private-picture probe that the tab is gone (two measured forms: an error for a browser the seat attached to, a non-error browser_tab_not_found refusal for one the driver launched; the first version knew only the first and per-bot pictures never came back), lifts the mark; same-origin navigation, lost fields, timeout, disconnect, other-tab reads and rebinding never do. Shared peer pictures also follow the mark's original native window whenever it overlaps their screen, with fresh-list failure withholding pictures. Probes leave the current member tab unchanged. Saving a login alone hides nothing.
Vault read failures log only the exception type and never fail prepare. Login fields
are full-width labelled rows, with Save below. Explicit safety denials still win over
full permission on the API and shared CLI/background gate. Slack uses the supplied
Simple Icons 13.21.0 path through the shared icon renderer, with its brand purple in
the light theme and the text colour in the dark theme. Never use a letter substitute.

Selected matrix, from app/:

```powershell
npm run look -- work-messaging-setup work-messaging-pairing computer-file-changes computer-file-partial computer-file-confirm computer-file-restored computer-file-bypass computer-login-card computer-login-saved chat-secret-masked delete desktop-owner --theme both --width 1120,720,1920x1080
```

Compare login with chat-secret-masked, restore confirmation with delete, and panel
controls with desktop-owner at the same theme/width. Inspect every contact sheet
and full-size changed controls. Extend scripts/look rather than adding a harness.
Focused tests: messaging/test_work_channels.py, computer/test_checkpoints.py,
computer/test_checkpoint_revision.py, computer/test_login_visibility.py,
computer/test_login_vault.py, agent/test_private_login.py, brain/test_db.py,
work-channels.test.ts and scripts/look/audit.test.mjs. The review follow-up runs
computer, messaging, agent and background in full once, then targets any fixes.
Report explicitly if that full run preceded the last change. Frontend verify uses
two Vitest workers.


## Computer location moves to its panel (2026-11-05)

The former Settings > Raphael location and Docker installation area is superseded
by [Settings by purpose](settings-appearance.md#settings-by-purpose-2026-11-05).
The compact header/empty-state location popover is shared by all members. See that
entry for scenes, existing setting/RPC contracts and offline acceptance limits.


## Offline root and dispatch security (2026-11-05)

R-SEC-FILES-01/02: core/tests/computer/test_security_boundaries.py uses real temporary
Windows junctions (symlinks on other systems) and a fake Docker runner. It verifies
workspace/shared/parent redirection, both team-file handle forms, library root rejection,
and grant revocation, target change or owner hold during preparation/checkpointing.
The same checks apply to cached starts. Existing test_vm.py/test_takeover.py assertions
include vault_entries/fill_contact and the firm T3 fill_card exception, without weakening
owner-hold or single-use approval tests. No UI markup, scene or navigation changes.
Follow-up 1 resolves the Docker forwarding and screenshot-lifetime decisions;
see the approved hardening entry below and .fold/report.md. Do not call offline fake tests authorized SSH or native acceptance.

R-SEC-FILES-04 additionally checks artifact receipt roots and bounds bytes before
hashing. Include background/test_tasks.py, test_handoff.py and test_team_flow.py
alongside the security regressions and architecture suite for that consumer boundary.

## Private SSH and filled-page lifetime (2026-11-05 follow-up 1)

R-SEC-SSH-01 and R-SEC-PRIVATE-01 supersede the pending D01/D02 decision above.
Run tests/computer/test_followup_security.py, test_smooth_computer.py,
test_login_visibility.py and test_vault_entries.py with tests/computer,
tests/services and tests/architecture. Fake SSH covers socket success, unsupported
transport fallback, directory protection/cleanup and absence of TCP/SOCKS forwarding.
Fake browser states cover time, same-origin URL changes, other tabs, filled refs,
complete cross-origin clearance and incomplete/unknown/error observations. Only a
complete safe observation restores screenshots; payment holds remain independent.
No UI markup/navigation changes; real Windows OpenSSH/Docker AF_UNIX compatibility
and live browser behavior require separate native acceptance.

The private-picture capture race also requires test_navigation_after_capture_cannot_release_the_captured_private_picture:
a safe observation authorizes the next read, never earlier captured pixels. Recheck
grant/target before and after the final observation; revoked reads return no tree.
