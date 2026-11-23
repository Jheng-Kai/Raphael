# Member computer (Phases A and B)

## Assigning a computer to a member

R-COMP-CHOICE-01 through R-COMP-CHOICE-03 and R-COMP-HOST-02 through R-COMP-HOST-06.
The owner assigns the member's computer in the Computer tab. Its one dropdown
saves the choice without posting in chat, with the local and SSH Docker locations
in the same menu. New members use Raphael Chrome. The member receives its assigned
computer's tools and a read-only status tool. A failed startup is reported in the
conversation. Switching the preference leaves an idle VM asleep. Only the owner's
Alt+Space quick ask can operate the owner's actual desktop.

Chrome can open web pages and use workspace files. When a private request needs
a shell, installation, a desktop app or a long-running process, the member says
why and offers a virtual machine once. The card's full-width action switches the
member and continues the original request. When Docker is missing, the action
asks Raphael for setup in its conversation. The decision stays with the owner.
Background work reports that it needs a VM and stops. Task installs use the VM.
Local commands keep their existing approval flow for other owner-PC work.

Raphael runs headed Google Chrome with one shared profile in the machine-local data folder.
On Windows Chrome lives on a separate desktop with no Explorer taskbar and never takes
focus on the owner's desktop. Every member owns its tabs across turns and tasks,
including tabs the owner opens with Add and popups. Every tab has its own action
lock. The member checks browser_tabs before opening another copy and uses the tab
shown in the Computer panel by default.
Local Docker and Chrome share the member workspace and team folder while retaining
separate site sign-ins. Docker on another host uses its own volumes.

Opening a page opens the Computer tab on that same page. The page fills the frame
under the [host browser toolbar](#host-browser-toolbar). A takeover card appears only while a member waits for the owner for
an owner-only step. The reason stays on the card, while the thread shows the member's own words.
Done releases input and resumes the original call on the requested tab, its related
popup or its live opener.
Done, Skip and other request endings remove the card from the conversation.
A visible Computer tab reconnects when a stream or lease ends or the active target changes.
Returning from Details by click, Home/End or Forward shows the live Chrome page or
VM seat again within a second. Chrome can close the old watching lease concurrently
with its replacement. The VM can reuse its still-connected preview.

```powershell
npm run look -- member-panel-computer-return-host member-panel-computer-return-docker --theme both --width 1120,720,1920x1080
```

The Chrome scene delays the old close reply and verifies that the live page returns
within the same limit as the VM. Both scenes check the right-aligned computer control.
An idle browser and an unavailable VM with no live target keep their wallpaper without panel errors.
An unexpected failure reaches the active member as an internal note. Missing Docker
keeps the action to ask Raphael for setup.
The last watcher leaving stops the screencast. Tabs remain open through idle time
and after member work ends. Closing the last member tab leaves Chrome running.
A crash is recovered on the next use. App shutdown closes relay connections and
Chrome's profile process tree. The VM keeps its own idle setting.

Run from `app/`:
```sh
npm run look -- member-settings desktop-computer-choice desktop-computer-choice-missing desktop-computer-choice-docker desktop-computer-suggestion-installed desktop-computer-suggestion-missing desktop-panel desktop-host-no-card desktop-host-panel desktop-host-takeover desktop-host-handback desktop-host-skip-idle desktop-quiet-vm --theme both --width 1120,720,1920x1080
```

Inspect the local and SSH choices, saved switching, both suggestion actions, normal Chrome
work opening the Computer tab without a card, the full-frame page, takeover and Done, and
the idle panels after a skipped Chrome request or unavailable VM.
Look uses the production canvas with fixture frames. Run `test_host_computer.py` and
`test_host_viewer.py` locally with CI unset. Their native tests use Google Chrome,
isolated profiles and local pages. They check the ordinary browser UA, `navigator.webdriver`
being false, changing 1280 × 900 frames away from the input desktop, private input,
handback of the same tab, downloads and shutdown. The coordinate journey reads
a page from the previous turn, checks a 1280×900 screenshot and acts on a control
that is replaced every animation frame. The production-turn scenario reuses the
owner's tab after listing it. The owner checks actual Google
sign-in. Native Chrome and OS prompts, including certificate pickers, sit outside the
page screencast.

## Owner control in the enlarged view

R-COMP-OWNER-INPUT-01, R-COMP-PREVIEW-01, R-PANEL-03 and R-NAV-04. The Computer
panel has an Open cover and a view-only page. In the enlarged view, Take control
or a takeover card acquires page input. Collapse, Escape and Back fold the screen
and release control. A takeover card stays pending until the owner chooses Done.
The member gets a regular waiting result while the owner holds input and can act
again after release. The wallpaper remains visible until the Chrome canvas or VM
framebuffer is painted. Chrome primes a quiet screencast with one screenshot per
attachment when needed, including tab switches and reconnections.

From app:

```powershell
npm run look -- desktop-owner-panel desktop-owner-shrink desktop-host-owner-panel desktop-host-owner-shrink desktop-wallpaper-before-frame desktop-host-tabs-panel desktop-host-handback --theme both --width 1120,720,1920x1080
```

Compare the Chrome and VM previews and the enlarged handback controls at the
same width and theme. Look checks view-only page input, a toolbar navigation
while watching, release on folding, a still-pending card and wallpaper after
connection but before the first picture. The evaluate scenario checks the
member's waiting reply with a fake brain. The real Chrome journey measures a
first 1280×900 picture within one second on a static local page before and after
reconnection, and changes that page through the toolbar without holding input.
VM engine and native Chrome use their own gates.

## Host browser toolbar

R-COMP-HOST-07 and R-UI-180. The Computer panel and enlarged view share an
editable address field and the same tab, close, new, back, forward and reload
controls. They act on the member's Chrome while watching and during takeover.
The member recovers to a current tab or opens a new one and reads it before
retrying an action aimed at a closed tab. The member's Chrome viewport stays
at 1280×900 during watch, takeover and handback. The page
keeps that aspect edge to edge below the toolbar and in the sign-in card preview.
The enlarged view fits the entire frame, including the toolbar, in the window.

A Chrome target with a member-owned opener belongs to that same member. The view follows the new
tab or popup, including a small sign-in window, and returns to the live opener on
close. The same viewer lease stays in place. Input names the tab whose frame it came
from. An active handback remains answerable after an OAuth popup closes if its work
still has a live opener. The member can use stable refs or the 1280×900 page PNG
with coordinate click, double-click and scroll, and type or press keys in the
focused control. A stale ref is refreshed once and retried only for a unique role
and name. Sign-in, verification and payment still use the owner's takeover.

Run from `app/`:

```sh
npm run look -- desktop-host-tabs-panel desktop-host-tabs-expanded desktop-host-tabs-control desktop-host-tabs-popup desktop-host-no-card desktop-host-panel desktop-host-card desktop-host-takeover desktop-host-handback desktop-viewer --theme both --width 1120,720,1920x1080
```

Inspect the compact favicon strip, the horizontally scrolled strip, the selected tab,
the address in both modes, the popup, the card preview and the outer edges of the
canvas. The frame checks allow 1% deviation from the 1280:900 page aspect. Compare the
round controls against the other Computer viewer's controls at the same theme and
width. The look fixture exercises the app's real toolbar and canvas.

Run `test_host_computer.py` and `test_host_viewer.py` locally with CI unset. The
native popup test opens a small window and a blank-target link from a loopback page,
checks the fixed 1280×900 frames and owner input, and returns to the opener after each close.
The native handback test verifies Done and the resumed member tool. Provider sign-in
requires the owner's own Google or Notion session.

## Recovering the seat browser after an unreadable stale lock

R-PC-LOCK-01. The guest checks process arguments before clearing old Chromium startup entries. If a local workspace mount
refuses to remove one, the host unlinks only the reported entry from that computer's profile and retries the seat launch once.
The core tests use a simulated permission error and a temporary host workspace. The original Windows Docker mount is a
separate native acceptance check.

## A launch opens on its member's screen

R-COMP-SEAT-02. Seen on the owner's shared computer: a member at seat 5 launched `xfce4-terminal --title=PR-progress ...`
with `launch_app`; the driver answered with a pid, the member's own `list_windows` and `get_desktop_state` showed only its
panel, `bring_to_front` by pid was refused, and the terminal stood on seat 1's screen. The window manager (xfwm4) opens a
new window on the monitor the pointer is on, which is any member's. The core moved a new window only when its pid was the
launch's (or the one other new window) and looked once: xfce4-terminal opens a later launch's window in the copy already
running (another pid), and a window often maps after that one look.

Now (`computer/seat_launch.py`, `VmTools._seat_launch`, `LocalVm.command_path` and `launch_marks`):
- Each launch at a seat is tagged as a desktop launcher tags one (freedesktop startup notification): the driver gets
  `launch_path = env DESKTOP_STARTUP_ID=<tag> RAPHAEL_LAUNCH=<tag> <the program's path> <the launch's other words>` and the
  member's `additional_arguments` as they were. The program is the first word of `launch_path` (else `name`), tagged only
  when the computer's shell finds it (`command -v`, an absolute path); any other (a desktop-entry name, a shell builtin such
  as `cd`) and `urls` stay the driver's own and are untagged. The reply, and the driver's refusal, show the member's own
  command, never the tag. A Chromium-family program gets `--force-renderer-accessibility`, which the driver adds only to a
  program it runs itself.
- The driver runs `launch_path` without a shell (cua-driver 0.37.0's source, `spawn_launch_command` in
  `platform-linux/src/tools/impl_.rs`, tag `cua-driver-rs-v0.37.0`): it splits it on white space and runs the first word
  with the rest and then `additional_arguments`, though its definition says "spawned directly via the system shell". It
  then waits for a new window of the process it started (20 s while the process runs), else a new window whose class
  matches the command (`window_matches_launch_key`: the class against the command after its last `/`), which is how a
  window handed to a copy already running is found; when the process has ended and no such window appeared within 8 s
  it refuses: `launch_handoff_timeout`, "handed off for D-Bus activation but no new window appeared within 8s". It reads
  every window on the canvas (`list_windows_dispatch(None)`), never a seat's, so a window outside the seat never fails a
  launch. The program goes by its absolute path so that this match reads what it reads untagged (`env ... xfce4-terminal
  --title=a.b` would not match: its first word is `env`).
- The first real-engine run (72 ok, 3 failed): the tag was sent as `env ... sh -c '<command>'`; the driver split the quoted
  command apart, sh got `'/usr/bin/xfce4-terminal` (an unterminated quote) and exited, nothing opened, and both seat
  checks got that refusal. The unit tests and the acceptance's offline world had answered every launch themselves; they
  now run each launch through a model of the driver's own code (`test_seat_tools.driver_runs`, `driver_matches`,
  `driver_refusal`, `driver_launched`), which refuses that form as the real driver did.
- The windows are waited for up to `launch_window_wait_s` (10 s, under the unit native lock; it ends at the first tied
  window). Each new window is judged once by one `docker exec` (`seat_launch.MARKS`: xprop of `_NET_STARTUP_ID` on the window
  and on its `WM_CLIENT_LEADER`, and `RAPHAEL_LAUNCH` in `/proc/<pid>/environ`): the window's own startup id, else its
  leader's, decides (another launch's id is never this launch's, whatever the process); without one, the launch's tag in its
  process's environment or the launch's pid ties it. Tied windows are moved to the seat; the reply names them
  (`This launch's window on your screen:` and the window rows). An untied window is left where it opened, and when it stands
  outside the seat the reply says so and how to start a separate copy (`xfce4-terminal --disable-server`, `browser_open` for pages);
  a launch with no window says so after the wait.
- What this relies on: xfce4-terminal (1.0.4 `main.c`) reads `DESKTOP_STARTUP_ID` before `gtk_init`, removes it from its
  environment and passes it on as `--startup-id` (to the copy already running, or to itself), and `terminal_app_open_window`
  calls `gtk_window_set_startup_id`, which writes `_NET_STARTUP_ID` on the new window. Measured on the image by the
  acceptance check below: each of the three windows carried its own launch's id on the window itself, three different ids,
  and their one leader carried one too, so the window's own id has to decide.
- `browser_window_missing` (a member's `browser_open` at seat 1, three times, in the same evening) is not this defect: a seat's
  browser window is found by `raphael-seat-browser`'s per-launch title marker, never by the launch's pid or a lone new
  window. The code is one for both of its waits (60 s for the window, 30 s to settle); `LocalVm.seat_browser` now logs the
  launcher's own line, which tells them apart next time.

Offline (`core/tests/computer/test_seat_tools.py`, launches through the driver model): `test_launch_moves_only_the_windows_tied_to_it`,
`test_a_launch_handed_to_the_copy_already_running_brings_its_window_to_the_members_screen`,
`test_a_launch_that_runs_its_own_copy_brings_its_window_to_the_members_screen` (the terminal wall's launch),
`test_two_members_launching_at_once_each_get_their_own_window`,
`test_a_window_that_maps_after_the_driver_answered_is_waited_for_and_brought`,
`test_a_launch_that_opens_nothing_is_the_drivers_refusal_in_the_members_words`,
`test_a_window_nothing_ties_to_the_launch_stays_where_it_opened_and_the_reply_says_so`,
`test_a_launch_with_no_window_says_so_after_its_bounded_wait`, `test_a_launch_is_tagged_so_that_its_windows_can_be_told_from_every_other_launchs`,
`test_the_driver_reads_a_tagged_launch_as_it_reads_the_launch_untagged`,
`test_a_window_is_a_launchs_by_its_startup_id_first_then_its_process`, `test_the_marks_command_reads_the_window_its_leader_and_its_process`
(runs the shipped script with an `xprop` double; needs a POSIX `sh`), `test_the_computer_answers_where_a_name_is_a_program_and_what_ties_windows_in_one_command`;
`tests/evaluate/test_computer_acceptance.py::test_shared_acceptance_drives_real_tools_through_every_numbered_check` (a world
whose driver runs and answers launches as the real one; `launch_failure="unrunnable"` sends that first form and fails the
terminal wall and the launch check with the driver's refusal, `"untied"` ties nothing and fails both by place).

Real computer: "shared launches land on their own screens" in `npm run verify -- --computer` (Docker already running; it
never starts Docker). The pointer is put on screen 6 (nobody's); seats 1 and 2 launch `xfce4-terminal --title=lands-<member>-<hex>`
together through `launch_app`, then seat 2 launches a second one; each launch's reply must name its window, the window must be
wholly inside its seat in that member's `list_windows`, on its seat's screen on the canvas, absent from the other member's list
and desktop, with no other new window on either seat. Its detail says whether the windows were opened by another process than
their launch's (the copy), whether the second seat's second window is in the copy that holds the first seat's window, and on
how many windows a startup id stood (on the window itself, on its leader). The terminal wall before it launches
`xfce4-terminal` by name with `--disable-server` at each seat. From `core/`, Docker already running:
`python -m raphael_core.evaluate.computer_acceptance --out <folder>` (about 15 minutes; it makes and removes its own
`raphael-acceptance*` image and containers). With this change: 85 ok, 0 failed, 9 skipped (the previous-layer images this
PC does not hold); the terminal wall passed, and "shared launches land" passed with the first seat's launch the copy (its
own process) and both of the second seat's windows opened in it, each wholly inside its own screen, startup ids on 3 of 3
windows (3 different); every check behind the terminal wall ran and passed.

## Where the app's data lives

R-COMP-PLACE-01, R-CLI-12, R-MEM-15. Every kind of data the app writes, where it goes, and what bounds it. `<F>` is the
identity's folder name: `Raphael` for the installed edition and debug builds compiled with `RAPHAEL_IDENTITY=release`,
`Raphael Dev` for other debug builds (`app/src-tauri/src/identity.rs`). The selected identity sets the single-instance
lock, webview folders and startup entry. The shell sets `RAPHAEL_DATA_DIR` for the development identity when the caller
has not supplied one. On macOS `%APPDATA%\<F>`
and `%LOCALAPPDATA%\<F>` are both `~/Library/Application Support/<F>`, so `paths.machine_dir(base)` is the data folder
itself and nothing moves. Sizes are the ones read on the owner's PC when the layout changed (folder listings only).

R-START-08: an owner test build and the installed edition open the same data and only one can run at a time. A newer
committed SQLite schema, including one in the WAL, is refused before the original database or its sidecars are changed.
The `start-newer-data` look scene opens the main window with a core returning the schema error. It checks
the centered notice and its single primary action, presses Update, and checks that the result stays in the
window. Window tests cover checking, downloading and an unavailable updater.

```powershell
npm run look -- start-newer-data --theme both --width 1120,720,1920x1080
```
The image tag and Windows credential targets are shared. Docker container ownership hashes the roaming data root; on a
one-time folder move, replace stale containers while preserving the moved bind-mounted workspaces.

| Data | Where | Chosen in code | Size then | How it grows | What bounds it |
| --- | --- | --- | --- | --- | --- |
| Database `raphael.db` (+ WAL) | `%APPDATA%\<F>` | core `paths.data_dir`/`db_path`; shell `device_settings::data_dir` | 155 MB + 37 MB WAL (dev); release about 3 MB | turns, messages, steps, tool events, room messages, tasks | turns, messages and room messages: nothing (recall, search and history read them all); dictation history 30 days; `tool_audit` 2,000 rows |
| Small settings (`device.json`, `integrations.json`, `connectors.json`, `messaging.json`, `schedule-awake.json`, `.window-state.json`) | `%APPDATA%\<F>` | shell `device_settings.rs`, `schedule_awake.rs`; core `IntegrationsService`, `MessagingStore` (data folder) | under 1 MB | rewritten | fixed shape |
| `connectors-catalog.json` (a downloaded catalogue) | `%APPDATA%\<F>` | `connectors/service.py` `CATALOG_FILE` | 3.8 MB | replaced | one file |
| Attachments | `%APPDATA%\<F>\attachments` | `services/attachment_store.py` (`root / "attachments"`) | 988 MB, 262 files | each attached file | nothing |
| Members' memory: `bots/<id>` (SOUL.md, MEMORY.md, skills, `memory/log/<day>.md`), `shared/USER.md`, `bot-state` (journals, mirrors, locks, backups) | `%LOCALAPPDATA%\<F>` | `paths.memory_dir`, whose parent `memory/service.py` gives `BotHomes` | bots 3.0 MB, bot-state 0.8 MB | each memory write; a log line | MEMORY.md and USER.md each use a 100,000-character prompt budget, 128 KB a file, unused entries 90 days; daily logs: nothing; journal pruned daily, independent of consolidation, keeping 30 days and each skill's latest applied revision before the cutoff (R-MEM-15) |
| Conversation folding | database (`conversation_summaries`, `conversation_context_summaries`, `room_thread_summaries`) | `memory/conversation.py`, `members/room_summary.py` | in the database | one row per conversation or thread | `SUMMARY_MAX_TOKENS`; goes with its conversation |
| Vault, keys, sign-ins | Windows Credential Manager, macOS Keychain (never a file) | `keychain.py`, through `brain/secrets.py` `CredentialKeyStore` and `integrations/vault.py` `CredentialVault` | none on disk | per secret | none needed |
| Logs | `%LOCALAPPDATA%\<F>\logs` | shell `lib.rs` `log_plugin`, `identity.rs` | 3.5 MB | per line | 1 MB files, three kept |
| Speech models | `%LOCALAPPDATA%\Raphael\models` (both builds) | `paths.models_dir`; `identity.rs` `data_env` | 956 MB | per model fetched | a fixed set; deleted from Settings |
| Webview data | `%LOCALAPPDATA%\<F>\WebView2` | shell `data_layout.rs` `WEBVIEW_DIR` | 211 MB dev, 82 MB release | the webview's cache | WebView2's own |
| Members' computer homes `members/<key>` and the team folder `team` | `%LOCALAPPDATA%\<F>` (were `%APPDATA%\<F>`; an earlier install moves them at a start, or as soon as a computer stops if that start found one running, R-COMP-PLACE-01) | `computer/vm.py` `placed`, `target_for`, `relocate` | 3,776 MB (the shared computer's home 3,021 MB) and 3,507 MB (projects 2,055 MB, bot-office 1,312 MB) | members' files, browser profiles, checkpoints | nothing on this PC: the 90% disk notice, a reset, a member's deletion; inside a computer `/tmp` and job logs (`scratch_args`), with failed cleanup retried on the next preparation |
| The owner's desktop picture for the computers | `%APPDATA%\<F>\computer-wallpaper.jpg` | `vm.py` `OWN_WALLPAPER` | none (a `wallpaper-own-kept` folder of 0.2 MB that no code writes) | one file | 8 MB |
| Pictures of members | `%LOCALAPPDATA%\<F>\avatars`, `avatar` | shell `avatar.rs`; `MembersService` | 7.2 MB | one per member | replaced |
| Exported templates | `%LOCALAPPDATA%\<F>\template-exports` | `members/member_catalog.py` | 4 folders, under 1 MB | per export | nothing |
| CLI workspaces | `~\.raphael\cli-workspaces\<member>\claude`, `<member>\<conversation>\codex` and `\gemini` (Gemini's private home inside) | `agent/cli/records.py` `workspace_root` | 140 MB, 38 member folders | a folder per conversation for Codex and Gemini | nothing |
| Members' Codex homes (their own `CODEX_HOME`, with Codex's records) | `~\.raphael\codex-brains\<sha256 of the workspace>` | `agent/cli/drivers.py` `codex_home` | 1,945 MB, 192 homes | one per conversation workspace | nothing |
| Claude Code's records of the members' runs | `~\.claude\projects\<folder named after the working folder>` | Claude Code; the names come from `workspace_root` and `process.PRIVATE_PREFIX` | 1,225 folders: 336 of member workspaces (1,000 sessions), 822 of the model listing's temporary folders (an empty `memory` each), the rest the owner's own; none older than 19 days | a folder per working folder, a file per session | R-CLI-12, with cleanup deferred until both builds' databases can be read |
| The CLIs' own homes `~\.codex`, `~\.gemini` | the owner's | the CLIs | not measured | | not Raphael's |
| Swap backups `backup-<time>` | `%APPDATA%\Raphael` | the owner's swap script, outside the repository | 3 x 190 MB | per swap | three kept |
| Look and judge output | `app\.look` in the checkout, never in a user's data | `app/scripts/look` | | per run | git-ignored |

Layout. Roaming (`%APPDATA%\<F>`) keeps the database and the small settings. Everything large or belonging to this PC
is in `%LOCALAPPDATA%\<F>`: the memory, the logs, the webview, the pictures, the exported templates and now the computer
folders; the speech models stay in the release's local folder for both builds. Proposed next, each the owner's call:
the attachments (988 MB) and the downloaded catalogue to `%LOCALAPPDATA%\<F>` (turns name an attachment by id, but the
data floor and the shell know the folder, so both move together); the swap backups out of Roaming; and `~\.raphael` to
`%LOCALAPPDATA%\<F>\cli`, one per build. Today the release and a development build run members of the same id in the
same `~\.raphael\cli-workspaces\<id>` and Codex homes, so their native sessions share folders. Moving it is not free:
Claude Code finds a session to `--resume` in the records folder named after the working folder (`drivers.py` passes
`--resume`, `loop.py` the workspace as `cwd`), and a Codex home is named by a hash of the workspace's path
(`codex_home`), so every conversation's native session would be lost once. The loop survives that (a session not found
is forgotten and a fresh one starts with a bounded record of the turns, `loop.py` `missing_session`), but it costs each
conversation its native context; it is left until the owner decides.

Checks: `core/tests/computer/test_relocation.py`, `core/tests/test_paths.py`, `core/tests/agent/cli/test_records.py`,
`core/tests/agent/test_cli_models.py`, `core/tests/members/test_bot_homes.py`. On a real engine, with Docker already
running, from `core/`: `python -m raphael_core.evaluate.computer_acceptance --relocation-only` (a throwaway image, data
folder and owner label; `ok folders move: ...` then the cleanup lines). No scene changes: look does not apply.

## Housekeeping: size, scratch, locale

A member inspected the shared computer and reported measured faults, which these rules fix (R-COMP-SIZE-01,
R-COMP-SCRATCH-01, R-COMP-LOCALE-01). Image layer 13 (`IMAGE_LABELS`, tag `v13`): the container's shape changed (the UTF-8
locale), no file of the image did, so only the final `LABEL` step should rerun on a PC that built v12 (on the owner's PC
it did not: steps 12 to 21 ran again, see "A new image layer" below). The owner's layer-12
computer is made again once, when idle; its workspace and sign-ins are kept; hand-installed packages and `/tmp` go.
`vm.py`: `resources`, `sized`, `machine_size`, `fit_limits`, `run_args` (locale), `scratch_args`; `carry_runtime.py` (staging
ownership).

Machine-only volumes (the browser's profiles and `~/.cache` in named volumes over their folders) were tried and taken out:
on Docker Desktop for Windows the engine makes the mountpoint `.browser-profiles` inside the bind-mounted workspace as
another account with a closed access list, so the host could not erase a computer's folder and an older layer's container
could not write under it (`mkdir: cannot create directory '/home/cua/workspace/.browser-profiles/driver': Permission denied`).
A later design is a volume at a path outside the bind mount. Until then the profiles and caches
stay in the workspace, as every earlier layer kept them. `npm run verify -- --computer` without them: 95 ok,
4 failed, 6 skipped; the four ("previous layer 9/11/12 erase" and "cleanup") are the access-denied `.browser-profiles` folders
that a container of an older layer leaves in the run's temporary data folder on the PC that ran it (see the note on the denied folders
under the layer 12 run below); no check named a volume.

```powershell
cd core; $env:PYTHONPATH="$PWD\src"; ..\..\..\core\.venv\Scripts\python.exe -m pytest tests/computer/test_housekeeping.py tests/computer/test_carry.py tests/computer/test_vm.py -q
```

Not proved by the offline tests: `docker update` on a live computer and the v13 build; `npm run verify -- --computer` with
Docker running is that check.

## A new image layer: its cache source, the old images, the update line

R-COMP-IMAGE-01, R-COMP-IMAGE-02, R-COMP-UPDATE-01. Measured on the owner's PC at the switch to layer 13: Docker Desktop
started by the app (51 s), then the image built in 4 min 31 s, its package step (`[12/21]`, 186 s) and Chrome (37 s) run
again although layer 13 changed only comments and the last `LABEL`; the steps before were CACHED. Inferred, not proved:
the engine's build cache had dropped those records, and the build named no cache source. A restart pressed meanwhile
answered `busy`, the panel said nothing, and the images of layers 9, 11 and 12 all stayed.

What is true now (`vm.py`, `lifecycle.py`, `viewer.py`, `computer-state.ts`, `desktop-viewer.ts`):
- The build (`build_args`) writes BuildKit's inline cache record into the image and names the newest earlier image of
  ours as `--cache-from` (`cache_source`, from `owned_images`: tags of `raphael/cua-local-vm` that carry
  `org.raphael.computer=1` and a lower layer). Relied on: Docker's documentation of the inline cache
  (docs.docker.com/build/cache/backends/inline/: `BUILDKIT_INLINE_CACHE=1` instead of `--cache-to type=inline`, imported
  with `--cache-from`) and of the `docker` driver (Docker Desktop's default builder), which exports the inline cache; and
  that the daemon's BuildKit reads `--cache-from` from a local image before any registry (moby's local inline-cache
  importer), which was not checked against this PC's Docker. Images built before carry no record: on the owner's PC the
  first build to gain is layer 14 built from a layer 13 that this code built, so at the earliest the layer after next.
- Once a computer is ready on the current image, `clean_soon` looks (first ready start of the core, then once a day per
  engine) and `remove_old_images` removes the older tags of ours that no container references, under the build lock,
  never forced. The acceptance's and the tests' injected runners never remove (`clean_images`). The acceptance's
  previous-layer checks need those old images: once the app has removed them they are skipped.
- A preparation that builds with an earlier image, or makes a computer of an earlier layer again, is marked `update`
  (`LocalVm.updating`, `_progress`); `computer.viewer_status` passes it on and the Computer tab shows
  `desktop.updateLine` in `.desktop-caption` under the bare screen (`data-desktop-update` on the panel). A restart,
  update or repair pressed during any preparation (`preparing_now`) returns its state instead of `busy`; reset still
  waits.

```powershell
cd core; $env:PYTHONPATH="$PWD\src"; ..\..\..\core\.venv\Scripts\python.exe -m pytest tests/computer/test_image_workflow.py tests/computer/test_lifecycle.py tests/computer/test_viewer.py tests/evaluate/test_computer_acceptance.py -q
cd app; node node_modules/vitest/vitest.mjs run src/main/desktop-viewer.test.ts src/main/i18n/i18n.test.ts
```

The look scene of the update line (not yet run when it was added):

```powershell
npm run look -- desktop-updating desktop-building desktop-preparing computer-state-updating --theme both --width 1120,720,1920x1080
```

On a real engine, with Docker already running and the owner's say (it never starts Docker): `npm run verify -- --computer`
runs `image update` after the previous-layer checks, with throwaway images of two files (`tiny_dockerfile`) in a repository
of the run's own; the computer's own image is never built twice for it. Expected lines, in order:

```text
ok image update fixtures: Built layers 11, 12, 14 and an unlabelled tag in raphael-acceptance-<token>/cua-local-vm with the product's build command; a stopped container uses layer 11
ok image update record: Layer 12, built by the product's command, carries BuildKit's inline cache record
ok image update cache source: The product names raphael-acceptance-<token>/cua-local-vm:driver-0.37.0-v12 as the cache source, over the older, the newer and the unlabelled tags
ok image update press during the build: A restart pressed while the engine built answered building with update; the panel said the same; the preparation ended ready
ok image update cached steps: The unchanged step was CACHED and the changed one built; the log names the import from ... (the engine's own cache also held that step)
ok image update old tags: Removed ...-v12; kept layer 11 (a stopped container uses it), the current, the newer and the unlabelled tags; every other image on the engine is as it was
ok image update cleanup: Removed raphael-acceptance-<token>/cua-local-vm and its container
```

"as the build began" instead of "while the engine built", or "does not name the import", is still a pass and says what
was seen. Not proved anywhere: that a cache source alone gives the unchanged heavy steps once the engine has lost its
own cache (that would mean clearing the owner's build cache), and how much faster the next real layer builds.

## A member's files

R-TOOL-03, R-FILE-01 to R-FILE-05. Every brain has the same file tools. A member read, searched
and changed the files of its computer through `vm_exec` (`cat`, `sed`, heredocs): the head of the output only, no numbers, no
paging, nothing that checked the text it replaced, and whole files under the 16,000-character argument cap. Its computer now
offers file tools beside `vm_exec`, with the parameters and words of the familiar read, edit, write, glob and grep tools:

| Tool | Copies | What it does here |
| --- | --- | --- |
| `read_file {path, offset?, limit?, pages?}` | Read | `cat -n` lines, 2000 from `offset`, a line over 2000 characters cut, 60,000 characters a read, the offset to go on from; a picture as an image (or what the owner's vision service sees in it, for a model that reads no pictures); a PDF as the text of its pages, 20 a call |
| `edit_file {path, old_string, new_string, replace_all?}` | Edit | exact text, unique unless `replace_all`; read in this run first, refused if changed since; keeps BOM and CRLF; returns the edited lines numbered |
| `write_file {path, content}` | Write | a whole file; over an existing one only after a read in this run and if unchanged since; folders made |
| `glob {pattern, path?}` | Glob | `rg --files`, newest first, 100 at most |
| `grep {pattern, path?, glob?, type?, output_mode?, ignore_case, line_numbers, after, before, context, multiline, head_limit, offset}` | Grep | ripgrep; files_with_matches (default, newest first), content or count; 250 entries a page by default |

Where they live: `computer/file_tools.py` (definitions, the run's read state `FileReads`, edit and read logic, ripgrep's
command line and output), `computer/files_guest.py` (the guest's reads and compare-and-rename writes, standard library only,
sent like `checkpoints.py`), `services/lines.py` (the line reader, shared), `LocalVm.file_request` and `Docker.__call__`'s
`input` (the request and the file over `docker exec -i` stdin), `VmTools._call` (dispatch, the checkpoint before a write, not
screen work), `worker.guards.argument_limit` (200,000 characters for `write_file` and `edit_file` only). A run is a turn (its
id) or a task; what it read is the file's sha256. Paths are absolute or taken from `/home/cua/workspace`; in the workspace and
the team folder the guest opens each component without following a link. Searches skip `.git`, `.browser-profiles`,
`.raphael-checkpoints` and `.raphael-jobs` and honour `.gitignore`; they search hidden files. Results pass the same login
redaction as every computer tool. No card asks for any of these in the member's own computer; the CLI vendors' own Read,
Write, Edit, Glob, Grep and shell stay off (they would act on the owner's PC outside Raphael's card, R-PC-02): a CLI brain
gets these through the `computer` MCP server.

Offline evidence (fake docker `Runtime`; the guest helper itself runs on a folder of the test; ripgrep's answers are scripted):
`core/tests/computer/test_file_read.py`, `test_file_tools.py`, `test_file_search.py`, and `test_catalog_stays.py` (the
catalog's descriptions: 17,756 characters per member before R-TOOL-03, 11,132 after it, 13,446 with the five tools; at a
seat 18,364, 11,740 and 14,054; ceiling 14,500).
No UI changes, so no look run. Not run: a real computer (`verify -- --computer` was not run: no image change), ripgrep's
own flags against the image's ripgrep, a live turn of each brain (`verify -- --live`), the providers' acceptance of the
dashed parameter names (`-i`, `-A`) that the Grep tool takes.

## A seat is a desktop a person can use

R-COMP-SEATWIN-01, R-COMP-MARKER-01, R-COMP-TABS-01, R-COMP-FIT-01 (image `driver-0.37.0-v12`). Watching a member's screen and
holding it showed three faults: the members never open tabs; after a minimize, Chrome could not find the original page; and the
full-screen view showed a Chrome window larger than the seat, cut on the left, top and right, with the panel over its page.

What was measured on layer 11 (a throwaway shared computer, the worktree's real `LocalVm` and `VmTools`):
- Minimize: the window stays in `wmctrl` and in the driver's list (`is_on_screen: false`, same geometry). A member's
  `browser_open` went on in it unseen, replacing its page. The panel had no window list; its Browser icon made a second window
  showing `data:text/html,<title>raphael-seat-...</title>`, and the core kept the older, minimized one (lowest id).
- Tabs: the driver opens and brings forward no tab, and says `active: null` for new tab pages; `browser_open` navigated the
  driver's shown tab or else the first one.
- Geometry: with the compositor on, the browser's 16/16/10/32 px shadow and the window manager's maximize race; the seat's
  window was 1312x893 at 16 px left and 10 px above its screen in 8 launches of 8 on one screen, and `wmctrl` could neither
  unmaximize nor maximize it again. The launcher's "maximized and centred counts as settled" let it through.

Layer 12 (`image/layer12/`, one Dockerfile step after layer 11's, so a PC that built 11 reruns only that step, about a second):
- `screens.py`: a window list (plugin 18 + the panel's number, `show-labels false`, this monitor only, never grouped) after each
  panel's three launchers; no compositor (`/general/use_compositing false`); a window watch every second that puts back a
  window whose seen part has stood outside its screen above the panel for two looks (maximized again, by the browser through
  `raphael-browser-tabs fit` for a browser, or moved inside).
- `xfce4-panel.xml`: the first panel's window list (a one-screen computer's only panel; the helper writes the others).
- `raphael-browser`: the Browser icon brings the screen's browser window back with a new tab, or makes one when there is none.
- `raphael-seat-browser`: the browser places and maximizes the found window (`fit`), then shows the new tab page in its marker
  tab and clears its history (`settle`).
- On layer 14, the core runs the installed launcher as `cua` with startup recovery. It removes stale `Singleton*` and
  `DevToolsActivePort` entries only when no process uses the shared profile. The core logs early browser exits with a
  bounded stderr tail, and a missing window gives the member retry and owner-escalation guidance.
- `raphael-browser-tabs` (standard library, the browser's own DevTools port): `settle`, `list`, `new`, `show`, `fit`.
  A window of the browser is found by its screen, then its title, then (two alike) by which tab has the focus once it is
  brought forward. A new tab opens in the window brought to the front last, so it is checked and, when it landed in another
  window, closed and opened again.
- Core: `vm_tools.py` (`browser_open` `new_tab`, the shown tab, a new `browser_tabs` tool, a minimized seat window brought back),
  `browser_tabs.py` (the tools' words and the pure reading of tabs), `vm.py` (`restore_window`, `browser_tabs`, layer 11 in
  `known_previous`, image v12), the acceptance (`OLD_IMAGES` with 11, panels with their window list, "shared seat windows").

Offline: `core/tests/computer/test_seat_windows.py` (scripts read and run without Docker, the tools against fakes), plus the
updated layer tests in `test_seat_tools.py`, `test_screens.py`, `tests/evaluate/test_computer_acceptance.py`.

Real computer (throwaway tag `raphael-probe/seat-windows:l12`, own data folder and owner label): pictures of seat 1 looked at one by one.
- Layer 11, before: an empty page, with the marker in the tab and the address.
- Layer 12: the first window shows Google's new tab page, Back greyed; `browser_open` with `new_tab` gives two tabs, "Owner page
  A" and "Task page B", B shown; `browser_tabs` `show` brings A back; minimized, the screen shows the town and the panel's
  faded window button, and a click on it through the screen's view brings the window back on page A; the Browser icon with the
  window open adds a New Tab and no window (also when the window was minimized); x.com's login page in a new tab fills the
  screen above the panel with its tab strip, back button and window buttons whole; restored and maximized by the browser
  (twice) and by the window manager it is 0,0 1280x851 at once; dragged to 700,100 (half on screen 2) it was back at 284,100 in
  3 s. A stuck 1312x893 window made by hand was put right by the watch within about 1.5 s. A terminal pushed to 1900,500 (half
  over screen 3 and under the panel) was back with its frame at 1733,334, exactly inside screen 2 above the panel, in 3 s.
- `wmctrl -lG` lists a decorated window at its frame's corner plus twice its decoration (frame at 0,0 with 5, 5, 29, 5 is listed
  at 10,58; `xwininfo` gives the client at 5,29) and `wmctrl -e` places the frame. The first acceptance run of layer 12 failed
  "shared seat displacement" because the watch had mixed the two and left a seat's terminal 5 px over the free screen.

```powershell
$env:RAPHAEL_CORE_PYTHON = "D:\Documentation\github_repos\Raphael\core\.venv\Scripts\python.exe"
$env:PYTHONPATH = "<worktree>\core\src"
npm.cmd run verify -- --computer
```

`npm run verify -- --computer` on the final tree (26 min, another shared computer running beside it): 88 ok,
3 failed, 6 skipped (no images of layers 4 to 8 and 10). "shared seat windows", "shared seat displacement", "shared browser is a
person's" and "previous layer 11 start/update" (layer 11 made again on 12, workspace kept) passed. The three failures are one
thing: removing the run's temporary data folder, `vm-homes/<key>/.browser-profiles` is access denied to the host on the PC that ran it
(`previous layer 9 erase`, `previous layer 11 erase`, `cleanup`). The home of a throwaway layer 11 computer made before any of
this change has the same denied folders, so it is that PC's Docker file sharing, not layer 12; the folders were removed through a
throwaway root container. Not run: a member's real turn with a model, and a computer of a member's own on a remote host.

Stated limits: two tabs with the same address and title cannot be told apart, so which of them `show` brings forward, or which
is shown, is not claimed (`shown: null`); the watch does not fight a drag, so a window held still half across for a second is
put back; a member's typed tools still act on a background tab without bringing it forward (the driver's own design).

## The first call after a wake is waited for; "your computer" is the member's

R-COMP-FIRST-01, R-COMP-OWN-01. Seen in real conversations: a member's first computer action after a sleep failed with
`docker_stopped`, `driver_configuration_failed` or `task_stopped` nine times, and the owner had to ask again; and 「用你的電腦開…」,
said into the overlay, opened the page on the owner's own PC with an empty reply.

- Start: `VmTools._call` waits through `_awake` (the start, again after a pause while it fails with `TRANSIENT_START`; at most
  `start_attempts` tries and `start_budget_s` seconds), then `_configured` (the driver's refusal of its first set-up calls,
  `TRANSIENT_CONNECT`), and the lost-connection repair is a retry of the same kind with the right to bring Docker Desktop back.
  A real failure (Docker absent, Docker Desktop not launched or not up in two minutes, no image, no room, the owner's hold or Stop)
  is the answer at once. `ComputerWork.begin` revives a work item whose stop was only inferred from a cancelled first call.
  Offline: core/tests/computer/test_first_call.py (fakes for each transient kind, the bound, each real failure, the cut-short call
  and the owner's own stop).
- Whose computer: `agent/whose_computer.py` reads a quick request (member, owner, unsure). The member's skips the fast
  router's shortcut (which can only use the owner's PC) and goes to the member's turn of the quick question, which holds both
  computers: the model reads the owner's words and picks (R-PC-01); the owner's, and a request that names no one's computer
  (the owner's PC is the default), keep the router and the shortcut, and nothing asks which computer; the shortcut says
  `opened`. Offline: core/tests/agent/test_whose_computer.py.
  The quick overlay's own look scenes are unchanged (no UI change), so no look run.

## The computer wakes by a decision, waits for a loaded PC, keeps its panels whole

R-COMP-WAKE-01, R-COMP-LOAD-01, R-COMP-PANEL-01, R-COMP-TYPE-01 (image `driver-0.37.0-v11`). The wake policy: the computer wakes when a member decides a task needs it (its
own computer tool) or when the owner starts it, never merely by opening a conversation or a panel, and not silently.

Wake policy (read first, then changed). Read in the code: a member's computer tool starts a sleeping computer without any question
(`vm_tools.py::VmTools.call`, `vm.start`), which is the member's decision and stays; opening a conversation or a panel starts
nothing (`desktop-viewer.ts` streams only a computer that already runs; only a press starts one, `viewer.py::_open` with
`vm.launch`); but `web_read` (`agent/tools.py`) fell back to the member's browser whenever a page read under 600 characters, came
back bad, or asked for scripts or cookies, and that fallback went through `rendered_read` and `VmTools.call`, which woke the
computer for a page read; and nothing counted the owner's open stream as activity, so the idle bound (15 minutes,
`vm.py::sweep`) could put a computer to sleep under their eyes.
- `web_read` no longer wakes it. `VmTools.rendered_read` looks first (`_awake`: a status read, never a start); asleep it returns
  `computer_asleep`, and the page comes back as read with `READ_NEEDS_BROWSER` ("your computer is asleep and reading a page does
  not wake it; call browser_open with its address yourself"), or, for a page that did not read at all, the failure with that
  instruction. An awake computer is still used for a short page: nothing is started, the gate, the audit, the owner hold and the
  cookie rule are the same, so there is nothing to decide against.
- A start by a member's own tool is never silent. `LocalVm._start` calls `wake_notice` once when a computer that was asleep (or
  never made) has been started; `VmTools._wake_notice` writes one quiet line in that member's conversation (an event `computer_woke`, drawn like a rename and
  never a reply, R-TEXT-08; the progress line where a task has no conversation), naming the member and why in the member's language: a page (any browser tool), a
  command (`vm_exec`) or using the computer (anything else): 「小晴為了開網頁喚醒了電腦」. No toast, no card. The same record
  (`vm.woken`: member, name, reason) is in the viewer's status as `woken` while the computer runs (the app does not read it; the line in
  the conversation is the one notice). It is dropped when
  the computer sleeps or when the owner starts it (a press, maintenance), so their own start leaves no line. Routines and background tasks run through the same call, so they follow the same
  rules (their line goes to their own conversation or progress). All fifteen interface languages: `_computer_words_data.py` for
  the core (the app keeps no copy).
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

Not run: `verify --computer` on the final tree; item 2 under real memory starvation
(stood in by a delayed browser start).

## The owner can always take the computer; a hold never outlives its use

R-COMP-TAKE-01, R-COMP-HOLD-01 (image layer 9, members sharing one computer). The fault: the larger view showed a page in
Chrome and the pill read only 觀看中 with no 接手控制, although the owner must be able to take the computer at any time.
A member also reported that four attempts had failed together and a retry succeeded with nothing changed, naming the
owner's hold on the computer as a cause it "could not fully confirm".

What is known and what is not. Verified in the code and reproduced by tests that were red first: the pill and the button
did not agree (`desktop-viewer.ts` drew 觀看中 whenever the view only watched, and hid 接手控制 when the core said the lease was
the owner's), a take-over the screen never confirms is given back by a call that may fail while the view goes back to
watching (`takeFailed`), a second view's Take control was refused for as long as a first view's hold stood, a hold whose
view failed to close stayed for good, and the monitor that closes expired views ended at the first view it could not close.
Not proven: which of these happened on the reporting PC (the core keeps no record of holds). The member's four failures are
unexplained; the refusal it saw was the bare identifier `owner_holds_control`, so its statement about a cause was a guess.

What the app does now.
- A pill that reads 觀看中 always offers 接手控制 (the larger view is open, the computer runs, no recording). One press is
  `computer.viewer_control {held: true}`; the pill reads 正在接手… until the screen confirms (R-PANEL-09).
- The core gives the lease to the owner's press (`viewer.py::_control`): another view of their own that holds it, or a hold no
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
  last renewal, by the core's monitor); and `OWNER_IDLE_S` = 300 s after their last click or key (the relay's count of
  forwarded input) while nothing waits on them. A sign-in or payment request waiting for them and a recording are held until
  they say so.
- A hold whose view fails to close is released anyway (`finally` in `viewer.py::_close`), and the monitor carries on past a
  view it cannot close.
- A member turned away by the hold is told what is true in one sentence (`vm.py::owner_note`, in the 240 characters a
  failure keeps): the owner has had the screen's mouse and keyboard for N seconds, nothing was done, it comes back at their press
  or after 5 minutes without input, do not guess another cause; a waiting sign-in request says that instead. The CLI bridge
  says the same instead of the bare identifier.

```powershell
npm run look -- desktop-watch-retake desktop-watch desktop-watch-owner desktop-watch-collapse desktop-owner takeover-bar takeover-handback desktop-takeover-owner desktop-viewer --theme both --width 1120,720,1920x1080
```

`desktop-watch-retake` reproduces the fault: take control, the screen never confirms (the look's `desktopUnconfirmed`),
the give-back fails (`releaseFails`), 6 s later the view watches with the failure line under the screen, the core still
holds the lease (`data-desktop-state="owner"`) and 接手控制 is shown and enabled. The check `desktop-watch` no longer skips
the button when the lease is the owner's. Native, not run: the owner's own real take-over of a seat after a failed one.

## Ending control is not ending watching; a running computer's preview is never a black frame

R-COMP-RELEASE-01, R-COMP-PREVIEW-01. The fault: after the owner ended control, the Computer tab's preview, with 執行中 above
it, was a black screen with only the 開啟 pill. Ending control is not ending watching, so the view must stay.

Two causes, both in `desktop-viewer.ts`, none in the core (`viewer.py::_control` keeps the session on release).
- The pill's 停止 (after 接手控制) called `handback()`, the path of a sign-in request's 我完成了: it asked the core to release,
  folded the larger view, closed the stream and, in a window under 1440 px or when the panel had been closed, closed the panel.
  Now `release()` asks the core to release and does nothing else: the view stays, the stream stays, the screen is view-only,
  the pill reads 觀看中 and 接手控制 is offered. A refused stop leaves the pill on 你正在控制 and gives the screen the owner's input
  again. 我完成了 (a request a member waits on) still goes back to the conversation through `handback()` (R-COMP-3-03).
- `handback()` also set `suspended` (so a returned request's card does not reopen its stream) and never cleared it for a
  panel that stays visible: in a wide window the panel stayed open on the third tab with a running computer, no stream and no
  picture until the owner pressed the screen, which clears `suspended` (the press that enlarges it). A handback that leaves the panel
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
now end by folding back, not by the stop. Native, not run: the owner's own real take, stop and fold on a seat.

## Every member's screen is its own, after a switch of members

R-COMP-SWITCH-01. The fault: opening a different member showed the previous member's screen; every member's screen must be
its own. Cause, in `desktop-viewer.ts` and not in the core: the sidebar's `onSelect` runs `switchThread()` before `app.go("agent")`,
and `switchThread()` calls `desktop.refresh()` only for a page that is on screen. Coming back from another page, the viewer
still held member 1's lingering stream (`session`), so `show()` polled `desktopRenew(member 1's session)`: its answer passed
the `id === member()` guard (read at poll time, after the switch) and member 1's state and frame were drawn for member 2.
Fix: `stateMember` (whom `state` was read for) and `streamMember` (whom the stream was opened for) are compared with
`member()` in `show()` and `sync()`, and a mismatch runs the same reset as `refresh()` first.
Reproduced before the fix: the two vitest cases named in the rule, red on `desktopRenew('one')` for member 2.

```powershell
npm run look -- computer-member-switch desktop-panel desktop-return-stopped panel-screen-routines desktop-takeover --theme both --width 1120,720,1920x1080
```

`computer-member-switch`: member 1's computer streams (the look mock now gives each session `?seat=<member>` and, with
`seatMarks`, the fixture paints that seat's colour band), the owner goes to the calendar, opens member 2 in the sidebar, and
the Computer tab streams seat 2: one iframe, seat 2's page and colour, no frame of seat 1 anywhere, member 1's session
closed and never renewed after member 2 opened, member 2's own status read. Native, not run: two real running seats.

The enlarged view keeps its own connected frame and lease while the owner visits a different member or page.
Returning restores that conversation's view and input ownership. The Vitest checks drive the drawer's scrim,
conversation, sidebar and header, then verify member switching, background renewal, lease loss and target replacement.
`desktop-host-takeover` presses the title bar while Chrome is under the owner's control and checks
that the same document, open count and close count are preserved.

## The disk notice names the disk that is full

R-COMP-DISK-01. A member told the owner 電腦磁碟快滿了 and named `.browser-profiles` (326 MiB), `.raphael-checkpoints` (12 MiB)
and a member folder (0 MiB). `docker exec ... df -Pk / /home/cua/workspace` on the running shared computer (read only):
`/` is Docker's overlay at 2 percent; `/home/cua/workspace` and `/home/cua/team` are the bind mount of the host's `C:\` at 94
percent (463 602 684 KiB, 29 528 756 KiB free). The reading took the larger of the two, so the notice was about C:, and the
folders it listed were measured in the workspace only. `lifecycle.py::disk_pressure` now returns a `DiskPressure` (which
disk, its name, percent, free, the folders, the workspace total); `vm_tools.py::_disk_notice` says the disk and its free space
and, when the computer's own folders are under 1 GiB, that they are only that much and that cleaning them would not help;
with 1 GiB or more, or when the computer's own disk is the full one, the notice with its largest folders and the question.
The new sentence has its translations in all fifteen interface languages (`_ui_words_data.py`). The 90 percent line, the
once-per-episode rule and the read-only, ask-before-delete behaviour are unchanged. The `computer-low-disk` scene's sample
reply still shows the folder-listing sentence.

## The default picture: light by day, dark by night

R-UI-92 (rewritten), R-UI-95, R-COMP-PICTURE-01, R-COMP-3-04. The slime town of five periods is gone. The default
picture of a computer and of every preview is one of two original abstract pictures drawn for Raphael (no characters):
`day.jpg`, the light one, from 06:00 to 17:59 and `night.jpg`, the dark one, from 18:00 to 05:59. Both are 1495x1052
JPEGs (quality 92, about 70 KB each), the screen's shape within half a percent, so the computer's zoom (xfdesktop
`image-style` 5) and the preview's `object-fit: cover; object-position: center` fill a 1280x900 screen and cut off at
most a pixel.

One clock. The computer's watcher (`wallpaper.py --watch`, every 30 s) reads the computer's own clock, and the computer
runs with `TZ` set to the owner's zone: the zone the window sends with `members.viewing` (its `Intl` zone), which
`HomeOverview.note_timezone` keeps and `vm.refresh_timezone` / `_reconcile_timezone` give the container. The preview
(`defaultWallpaper` in `desktop-viewer.ts`) reads the window's own clock, whose zone is that same `Intl` zone. The
picture is part of the draw signature, so an open panel turns at 18:00 on its next poll without being opened again.
Until the window has said a zone the core's computers run in UTC (`timezone_name(None)`); it says one as soon as a
conversation is open.

Where the files are. `core/src/raphael_core/computer/wallpaper/` holds `wallpaper.py` and `wallpapers/day.jpg` and
`wallpapers/night.jpg`. `LocalVm._wallpaper` copies the script and the folder into `/opt/raphael-desktop/` at every start
(each copy within 2 s, all of it within 5 s), so a new picture needs no image layer; `app/public/wallpapers/` holds the
same bytes for the preview and the look transport, and PyInstaller collects `wallpaper/**/*`. The folder is outside
`image/` on purpose. Every file the image's build copies is part of its cache key: a change to `image/desktop/` would make
a PC that built layer 11 (or 12, whose step says `desktop/` stays byte for byte) download Chrome and every package again.
So `image/desktop/wallpaper.py` and its five SVGs stay as layer 11 built them and nothing reads them (the core writes the
new script over the image's copy at every start); they can go when a layer rebuilds from the base anyway. And `image/**`
is `text eol=lf` in `.gitattributes`, which would rewrite a JPEG's bytes.

The owner's own picture (`computer-wallpaper.jpg`, R-UI-95) is untouched and still wins at every hour.

Tests: `core/tests/computer/test_wallpaper.py` runs the watcher's own pass with its clock stopped at 05:59, 06:00, 17:59
and 18:00, checks every hour, the two JPEGs' shape, that the preview's bytes are the same, and that the folder is outside
`image/`; `test_vm.py::test_start_installs_the_decorative_wallpaper_once_per_start_and_target` checks that the copy carries
both pictures; `desktop-viewer.test.ts` checks the same four minutes on the panel (Asia/Taipei, as `vitest.config.ts`
sets) and an open panel turning at 18:00. `npm run verify -- --computer` reads `last-image` for `day.jpg` or `night.jpg`
once its own picture is put aside (measured colours across the middle at 1280x900: 95 by day, 28 by night; it asks 12).

```powershell
npm run look -- desktop-wallpaper-day desktop-wallpaper-night desktop-viewer desktop-viewer-night desktop-starting desktop-boot-inline desktop-boot-card desktop-own-wallpaper desktop-own-wallpaper-card panel-off --theme both --width 1120,720,1920x1080
```

`desktop-wallpaper-day` and `-night` fix 06:00 and 18:00, the first minute of each, and check the source and the
centred zoom; `desktop-viewer-night` opens the larger view at 22:00 over the synthetic stream, which draws the same
picture. Offline look evidence does not prove the picture in a real computer.

## One foot under the larger view's screen

R-PANEL-08. After a failed demonstration the red line began at the window's edge
over the screen and was cut, 丟棄示範 and 審閱示範 floated in the far corner, and the file changes ran
along the top-left (that view was removed, R-COMP-UNDO-01). In the larger view (`desktop-viewer.ts`, `.desktop-shell`) the screen, the skill
review (`.desktop-review`) and one foot (`.desktop-foot`)
share one width: `min(100cqw, (100cqh - --desktop-foot) * 1280 / 900)` of the shell, a size container.
The foot holds `.desktop-notes` (request, failure, privacy line, missing-computer note, the trial input),
centred and wrapping, then `.desktop-bar`: three columns with the pill (`.desktop-dock`) in the middle on
the screen's centre line and the demonstration's pill (`.desktop-actions`: Discard quiet, review or Stop
recording filled) right beside it. The review takes the screen's place in a box of its
size that scrolls on its own.
While the draft is written the teach button is hidden and the line alone says so. The small preview keeps
only a notice under its screen (the foot is `display: contents` there).

How to get to it: open a member's computer tab, enlarge the screen, take control, then ⋯ → 教他做一次
(press it again to stop; `teachFails` in the mock makes the draft fail). The ⋯ menu lists that one entry only:
the 檔案變更 entry and its view are gone (R-COMP-UNDO-01); a member undoes its file changes when asked in chat
with its tool `file_history`. `computer-menu-teach-only` opens the menu in the larger view and asserts exactly 教他做一次 and 傳送檔案到電腦 (R-COMP-FILE-01), and no 檔案變更.

`computer-foot-layout` (checks.mjs) asserts on every listed scene: the screen or its box keeps the
proportions and is centred; every line, the pill and the actions lie inside its horizontal span, below it,
inside the window and uncut; none overlap; the foot starts within 24 px of the screen; the pill is on the
screen's centre line; lines are centred.

```powershell
npm run look -- desktop-teach-failed desktop-teach-recording desktop-teach-draft desktop-teach-saved desktop-teach-shared desktop-teach-discard desktop-teach-try computer-menu-teach-only takeover-bar takeover-menu desktop-watch desktop-viewer desktop-owner desktop-panel desktop-unavailable --theme both --width 1120,720,1920x1080
```

Gotchas: `--desktop-foot` is a fixed reserve (88 px: one line and the pill; a second line borrows the
shell's bottom padding); a foot taller than that aligns the block to the top (`align-content: safe center`)
rather than overlap, so a new kind of line under the screen needs the reserve rechecked at 1920x1080 and
720. `level-takeover` wants the screen at least the window's height less 160 px at 1920x1080 (932 px now). Long languages wrap the action pill
inside its half instead of moving the pill. The real failure behind it (the draft step after a
recording) is a core question; this section covers only where it is said.

### The sign-in card and an honest pill (R-PANEL-09)

A sign-in page could not be read in the card (480 px, a 16:9 frame around a 1280 x 900 screen), and the
pill said 你正在控制 while the owner's input reached nothing. A card that hands the computer over (`desktop-timeline.ts`
waiting_control, `computer-card.ts` control) is now as wide as the conversation with a screen at the computer's
proportions (CSS in `desktop-viewer.css`, the one exception to R-CARD-01). Its screen and 接手 call `acquire()`:
the larger view opens with the same frame and takes control; the pill offers 我完成了 (`desktop.done` while a
request waits), which returns the nonce once. The pill reads 正在接手… (`desktop.taking`) until the frame answers
`interactive` with held, then 你正在控制; with no answer in 6 s (`TAKE_MS`) the lease is given back without the
request id, `desktop.takeFailed` stands under the screen and the view watches again. Watching always reads 觀看中 and always offers 接手控制 (the first section).
Whether the shared computer's seat page sends `held` is the core's question (the shared-computer session).

```powershell
npm run look -- desktop-takeover desktop-takeover-owner desktop-takeover-done desktop-boot-card desktop-boot-inline desktop-own-wallpaper-card desktop-watch desktop-watch-owner takeover-bar desktop-owner desktop-teach-recording desktop-teach-failed --theme both --width 1120,720,1920x1080
```

`computer-takeover` asserts the card fills its column, its screen is 1280 / 900 and the stream fills it;
`computer-takeover-owner` asserts the larger view holds the frame, the pill reads 你正在控制 with 我完成了 and
synthetic keys reach the RFB surface; `card-shell` exempts only the handoff card from 480 px.

## Image layer 6: the desktop's picture, its keys, a lost X server

R-COMP-PICTURE-01, R-COMP-KEYS-01, R-COMP-XLOSS-01, R-COMP-LAYER-01 cover image
`driver-0.37.0-v6`. Everything here was first seen on a real layer 5 computer and is
checked on real computers by `npm run verify -- --computer`; the offline tests name the
exact scripts and commands and prove no container.

The picture. A desktop showed one flat dark blue. Two causes,
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
not prove the picture: the acceptance also reads `last-image` and requires one of the
default pictures, `day.jpg` or `night.jpg` (the default picture section).

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
(`driver-0.37.0-v4`, `-v5`) when they are on the PC, under the run's own owner label,
and only reads those images. Layer 5 start, update and erase: incompatible, then ready
on the new image with the workspace file preserved, or absent with the workspace
removed.

The guard. The acceptance's Docker guard allows one host file besides the image folder
into a computer: the run's own `computer-wallpaper.jpg`, into its own computers. Without
that the product's copy was refused, swallowed (decoration never fails a start), and the
first run of the picture check showed the desktop's default drawing.

Real run (`python -m raphael_core.evaluate.computer_acceptance --screens 1,6`,
Docker Desktop, Linux engine): 44 ok, 0 failed, 0 skipped in 650.718 s.

Not proven: a remote (SSH) host; the native app's own panel around the stream; a
member's real turn at the desktop.
## Shared seats

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

SHARED_ARGUMENTS classifies every offered driver's top-level and nested
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
only the new windows tied to the launch by its startup id, its tag in a process's environment or its pid (R-COMP-SEAT-02,
"A launch opens on its member's screen" above); the old single-unmatched-window fallback is gone. windows[] is filtered/projected after movement.

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

`npm run verify -- --computer` runs on the final tree. Each per-count
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
be settled by real-container acceptance on the final tree.

## Image screen plumbing

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

Container acceptance (Docker Desktop, a throwaway image
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

Measured again, the same way, after the mark's meaning changed:
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
members sharing one container (the seat sections below).
`wmctrl` is in the image for the seat work: Chromium opens every new window beside
its first and the driver has no tool that moves one.

Offline evidence for the screen helper and the view processes:
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

Offline evidence for six defects that neither the first offline tests nor the container run had
shown (each has a test that was red first):
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

## Scripted container acceptance

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
server death, and the member seat and lease paths remain outside its acceptance scope.

The form check (per-bot and shared, through product calls and the common fill helper): a
main-document Name field that starts with a value, a same-origin frame holding a field of the same name,
and a second loopback origin. It proves replacement, refusal of the frame's field, window and desktop
pictures withheld after a private fill and after same-origin navigation, the another-origin read timing,
and a closed tab (a real ctrl+w with a spare tab open) retiring its mark so pictures return. The shared
block also moves the marked window onto the peer's screen (the peer's desktop and window pictures come
back empty), refuses a hand-over when one window list fails at the IsolatedDocker boundary (exact holder
restored, `computer_busy`), and shows a free screen's leftover window gone before its new holder.
Offline fakes do not prove driver or X11 behaviour: the whole offline suite and thirteen
rule-removal mutations passed and still could not seat anyone on a real computer (the desktop window spans every
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

The shared block's three checks of datasets, recording and carry-over (all through product tools, on this run's own homes): two seats
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
Reading the shared block against the paths it touches found what neither the tests nor the real run had: the helper's ownership pass walked `.browser-profiles` even when a member had made it a link; the budget ended the carry's task and with it the old home's guard while the copy's container went on; a recording that could not be written kept its event in memory and could end the viewer's monitor; a framebuffer update's rectangles were all held at once. All four are fixed with regressions (`test_carry.py::test_a_copy_without_a_profile_hands_over_nothing_a_member_prepared`, `::test_a_hung_helper_is_killed_by_name_before_its_error_is_raised`, `members/test_teaching.py::test_a_recording_that_cannot_be_written_ends_as_full_and_keeps_no_unwritten_event`, `test_rfb_view.py::test_one_rectangle_is_held_at_a_time_and_a_picture_is_whole_only_at_an_updates_end`); the fifth, a member swapping its own dataset folder for a link mid-call, is stated in R-COMP-SEAT-01 as outside what the folders are for. Reading those fixes again found that a failed or unfinished profile copy left `.browser-profiles/driver` root-owned, so on a host with real ownership the launcher could not make its profile (`::test_folders_made_on_the_way_are_handed_over_before_a_copy_that_may_fail`); that a kill whose answer was not awaited, or a helper left by a core that died, still released a home being read (`::test_a_closing_core_leaves_its_copy_to_finish_but_sees_a_kill_through`, `::test_a_helper_an_earlier_core_left_running_is_waited_for_and_then_asked_once_more`); that the write at a recording's end could still raise into the viewer's close (`members/test_teaching.py::test_a_recording_that_ends_on_a_full_disk_still_lets_go_of_the_computer`); and that the carry's lock was held for the whole wait (`::test_every_browser_of_a_computer_waits_until_the_same_moment_and_another_computer_does_not_queue`). A third, narrow read found one more: a kill that failed was taken for an ended helper (`::test_a_hung_helper_that_cannot_be_seen_to_end_keeps_its_home_closed_to_its_old_computer`). Stated in R-COMP-SEAT-01, not changed: the helper's staging names can be swapped by a member, inside a throwaway container whose one writable mount is the members' own workspace; POSIX rename puts the carried profile in place of a folder the launcher has only just made. The same hand-over had two failures only this machine's whole run showed, in files the author could not run (loopback sockets), and one only the contract showed (a rule naming a renamed test).
Not covered by the run: a profile after weeks of use (its size and copy time), a remote host's named
volumes, the app's own viewer during a shared recording.

First real runs (Docker Desktop): the first found three defects of the
command itself that 179 offline tests had passed (guest paths built with the host's path type
on Windows; a terminal counted as two windows and placed by its frame-relative corner; a
picture check that compared a black terminal with the wallpaper, which is the night picture
at 03:00); the second found that a one-screen computer's panel names no output. The third
ran through `npm run verify -- --computer`.

## Deleting a member removes its computer

Deleting a member used to ask whether to delete the member's computer too, and ticking it hung. The app now
knows and does it, shows nothing when there is no computer, and keeps such things out of the front end
(R-COMP-PERF-12, R-UI-27).

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

## Viewer transport isolation, phase 1

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
handshakes, privacy and the 8-session/64-connection caps. `npm run verify -- --computer` now covers
local container layout/readiness, authenticated clipped noVNC transport, screen-local
input/raw pixels, recovery/restart, available layer 4 migration/deletion, and the
core's own `DesktopViewer` connection/relay path. The native app's panel around that
relay, remote SSH hosts, native frame pacing and browser canvas performance still
need separate acceptance.

## Library: only what the member delivered

This supersedes the Library notes below (team-file chips, the workspace/team scan, This week / Earlier, the three-to-a-row
picture grid, the time on each row, day-by-day groups). A Library of working screenshots is noise, so it lists
only deliverables, read from `members.library` (media cards and files or links its replies handed over, pages
it published with their first day, verified receipts in the member's work folder; never owner uploads, scratch files or
undelivered screenshots), split into all, pages, media and files. member-panel-work.ts draws it:

- A row of chips under the tabs, always 全部 / 頁面 / 媒體 / 檔案 in that order, also for a member with one kind
  alone, or none yet: pages; pictures, videos and audio; documents, archives and other files. A chip of a kind
  the member has not delivered shows one quiet line in the cards' place (還沒有頁面 / 還沒有媒體 / 還沒有檔案; 全部 keeps 還沒有檔案或頁面,
  loading and failed keep theirs), under the group labels' inset. The pressed chip is the light one (the accent fill with dark
  words in the dark theme, inverted in the light), the others soft. Links are never listed (a link is no deliverable), so there is no link chip. The kind is set by the core (`members/library.py::_kind`): the mime type decides media,
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
- Everything at once up to the core's bound of 100, scrolling inside the panel; there is no 「顯示更多」.
  The empty and failed sentences are unchanged, and now stand under the four chips.
- A press opens a picture in the lightbox, a page itself, whole, in the area beside the sidebar (R-PAGE-08: not the reply that published the page, where the card still had to be pressed; see Conversation), an attachment with `open_attachment`, and a
  delivered file with the `open_library_file` command, which hands the member id and the Library handle to
  `members.library_file` (never a path, never `computer.team_file`).

Scenes: `member-panel-library` (全部), one per chip (`-pages`, `-media`, `-files`), `-single` (the `single` fixture: a member whose
deliverables are all media; the four chips still show, 全部 lists the five) and `-single-pages` (its 頁面 chip: one quiet line),
`-long` (the `long` fixture: 98 items of every kind), `-open` and `-empty` (four chips and the one sentence); the checks in
scripts/look/checks.mjs read the chips, groups, card, row, mark and empty-line geometry.
`-background-video` (R-PANEL-10: videos a member attached at the end of its background work were missing): the
core's own `snapshot` of a synthetic database (`scripts/look/core_fixtures.py`, runner.mjs `coreFixtures`) lists the background work's video and
page (a turn naming the member itself as `peer_id`) and a sent script, not a colleague's hand-off; 媒體 holds the video under 今天.

```powershell
npm run look -- member-panel-library member-panel-library-pages member-panel-library-media member-panel-library-files member-panel-library-background-video member-panel-library-single member-panel-library-single-pages member-panel-library-long member-panel-library-open member-panel-library-empty page-library-open page-library-report page-library-back page-library-older details --theme both --width 1120,720,1920x1080
```

## Bare screen while the computer is not showing its screen

This supersedes every earlier note below that describes words, the member face, preparation progress, a state sentence,
recovery buttons (Start Docker, Use remote, Download, Retry), the Open pill, the caption under the screen or the header
state word for an offline computer. While a computer is not showing its live screen (sleeping, starting, waking, updating,
repairing, stopped Docker, missing installation, remote failure, missing image) the panel draws only the wallpaper: no text,
face, button, pill or caption inside the screen. The state stays in `data-desktop-state`. The current computer selection
may have a short word in the header beside the dropdown. Docker's locations are part of that menu.

One press anywhere on the screen (the `[data-desktop="enlarge"]` cover, visible in every state except while it is getting
ready) starts it: asleep wakes it, a stopped engine starts Docker through `computer.viewer_status {start_docker:true}`, a
stalled or unreachable stream reopens, and a running screen opens the larger view as before. Rendered checks use the shared
`requireBareScreen` helper in scripts/look/checks.mjs. desktop-install and member-panel-remote-location keep their names but
cover the absent computer's bare screen and the SSH editor opened from the computer dropdown.

## Three-tab member panel and local engine recovery

A clear Details / Library / Computer hierarchy that explains the actual unavailable-computer reason. This section supersedes earlier landing-panel and first-build-caption guidance for this panel.

R-PANEL-01 through R-PANEL-04 govern the header, shared tabs, live controls and all offline states. Enter from the conversation title for Details; use the monitor for Computer. Gear retains identity, memory, skills, commands and voice. The panel reads the existing private worker-task lane (including delegated private work), newest first. Tasks open their existing results and stop/rerun through the row menu. Library uses the shared team-file chip; file handles are scoped to the selected member's local workspace/team folder, with recorded artifacts/pages retained even without a running computer. Remote volumes are never scanned as local paths. The current scan is capped at 500 entries, depth 3, 100 visible files and 100 task/page/artifact records; ordinary Show more advances by 12.

Each thing is said once. Sleeping, starting, waking, updating, repairing, stopped Docker Desktop, missing installation, named remote failure and missing image show the full sentence only inside the screen. The header keeps the existing short preparation and maintenance words. A normally running computer shows no status word in the header. Buttons sit after the sentence in normal flow; every offline state has the existing member slime. Only a live screen offers Enlarge and Take control underneath, with no repeated name caption. Details keeps the outer conversation heading and suppresses the list's internal heading. Owner engine recovery starts only the installed local app and reports readiness without implicitly creating a computer (a member's own tool call also starts the installed Docker Desktop and waits up to 120 s, see R-PANEL-04; reads and the viewer still never do); selecting the location recovery opens the existing control. No administrator/app-update advice is shown for a stopped engine.

Consistency comparisons use the existing ui.tabs plain variant, shared fileChipHTML, btn and openMenu. The three member tabs fill the panel to keep equal navigation targets; Connections retains its compact counted tabs within Settings. Work menus have only the applicable action, while maintenance retains its wider descriptive rows and takeover retains its icons. These contextual differences reuse the existing components and tokens. Engine readiness uses the existing viewer notice with role=status and neutral text; failures retain role=alert. Offline recovery buttons retain the screen's existing dark contrast treatment over the wallpaper, while Enlarge and Take control use ordinary panel buttons below it.

```powershell
npm run look -- member-panel-details member-panel-details-empty member-panel-library member-panel-library-empty member-panel-computer-live member-panel-computer-asleep member-panel-computer-starting member-panel-computer-waking member-panel-computer-updating member-panel-computer-repairing member-panel-computer-docker-stopped member-panel-computer-docker-missing member-panel-computer-remote member-panel-computer-image-missing member-panel-docker-start member-panel-remote-location member-panel-location-hover computer-state-sleeping desktop-absent desktop-watch desktop-watch-collapse computer-maintenance-menu takeover-menu connections team-file-reply --theme both --width 1120,720,1920x1080
```

Use synthetic zh-TW fixtures, both themes and 1120/720/1920x1080. panel-state-layout checks sentence/button containment, pairwise nonintersection, ordering, visible face, exactly one visible full sentence and the short header word's agreement with the fixture state. Member-panel checks reject duplicate conversation headings and offline Enlarge/Take control. The task-stop/task-rerun scenes open their shared contextual menus without mutations, and team-file-reply is the shared chip comparison consumer. The library scene exercises ArrowRight, Show more and shared chips; the empty-library scene covers ArrowRight/ArrowLeft; live uses the real chat monitor. Keep the pre-fix desktop-absent overlap failure as red evidence; sleeping did not overlap at the captured baseline widths.

Inspect every contact sheet and full-size computer state at light 720/dark 1120 and Details/Library at 1920x1080. Compare with shared Connections tabs, work overflow with maintenance/takeover menus and Library chips with the existing chat file chip. Judge the same selected run. Native Windows/macOS launch, remote SSH/container operation and live brain/provider behavior remain unverified; tests never start real Docker. Run the 18 member-panel scenes above in one both-theme/three-width run with targeted tests plus ui-rules/i18n/architecture, not the full verify or core suite, and inspect every sheet, computer states at light 720/dark 1120 and Details at 1920.

## Settings and lifecycle merge

The computer tab header right-aligns the dropdown with the screen. When available,
maintenance sits to its left. The dropdown opens the SSH editor with its explicit host check and copyable
repairs from the existing viewer_status owner RPC.

```powershell
npm run look -- settings-owner safety desktop-host-local desktop-host-remote desktop-panel computer-maintenance-menu computer-state-sleeping owner-output-folder --theme both --width 1120,720,1920x1080
```

## Computer lifecycle in words

R-COMP-PERF-01/07/10/11/12 remain authoritative. The maintenance overflow
offers Wait, Restart, Update, Repair and Reset, in that order. Shared
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
persisted conversation reply names the disk that is full (R-COMP-DISK-01; the first sections) and, when the
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
npm run look -- computer-maintenance-menu computer-maintenance-restart computer-maintenance-update computer-maintenance-repair computer-maintenance-reset computer-maintenance-reset-done computer-sleep-menu computer-state-sleeping computer-state-waking computer-state-updating computer-state-repairing computer-low-disk desktop-panel takeover-menu --theme both --width 1120,720,1920x1080
```

Compare maintenance/idle menus to takeover-menu and computer-menu-teach-only, reset to quick-clear-confirm,
and sleeping/working faces and header icon controls to desktop-panel at matching
theme/size. Maintenance descriptions use the shared mdesc rows, so their content
requires a wider/taller menu; reset adds a scope paragraph to the shared dialog.
The header face uses 28px to fit beside the existing icon buttons; its art and
states are unchanged. Tests: test_lifecycle.py, test_vm.py, test_latency.py, test_viewer.py,
test_smooth_computer.py, test_settings.py, desktop-viewer.test.ts and
member-details.test.ts. Only fakes are used; never operate real Docker.
Full verify/core suites and native/live acceptance belong to integration.

The existing read-only SSH repair consumer also remains mapped separately; it is
not part of the selected lifecycle capture:

```powershell
npm run look -- desktop-host-repair --theme both --width 1120,720,1920x1080
```


## Smooth computer work and private inline sign-in

The details screen has a separate Enlarge icon. It carries the existing iframe
into the window area beside the sidebar, retains no member-specific expansion,
preserves the guest aspect ratio through noVNC scaleViewport and never acquires
input. Its thin bar reuses the current public action words, Stop and collapse;
Esc collapses with the connection intact. Explicit takeover/teaching/files keep
their earlier behavior. The private request_takeover card now acquires input
inside its own iframe instead of opening full-window takeover (R-PANEL-09 supersedes this: the card
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
words replace raw diagnostics. Each failure class (R-COMP-HOST-01)
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
[Deleting a member removes its computer](#deleting-a-member-removes-its-computer)):
the unchecked option that named the host is gone.

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
What the first real turns at a seat showed (nine runs of shared-computer on the real Codex, effort
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
These checks run no look, native, judge, live, network/provider or real Docker
acceptance, which remain SKIP; fake connection counts establish sharing, not real
SSH/macOS/driver compatibility or latency.

## What a computer has from its first start, and the owner at a seat

Image layer 8 (R-COMP-READY-01, R-COMP-SIGNIN-01, R-COMP-OWNER-INPUT-01). A member's computer has Chrome and the usual tools from its first start, not only the driver's browser; and signing in to
Google for a member failed with "This browser or app may not be secure".

- The members' browser is Google Chrome (from Google's repository when the image is built): on amd64 from layer 8, on
  arm64 from layer 14 (Chromium before, "Google's Chrome on arm64 too" below). It is started without the automation mark
  a page can read, with no warning bar and no "Restore pages?".
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

## The desktop names its browser

Image layer 9 (R-COMP-READY-02). On layer 8 the panel did not show Chrome as the browser.

- The panel's launcher on every screen, and the menu's one browser entry, are named Google Chrome under Chrome's
  mark (on arm64 Chromium under its own until layer 14). Until then a globe named "Browser" opened Chrome.
- XFCE's "Web Browser", the menu's Chrome and Chromium entries and `x-www-browser` start the computer's browser.
  On layer 8 the first asked which application to prefer, and the menu's Chrome entry could not start at all.
- Firefox stayed installed and left the menu (layer 10 removes it, below).
- Layer 8 computers, the shared six-screen one among them, are made again on layer 9 at their next start. A PC
  that built layer 8 builds layer 9 from what it kept (measured: 15 s for the new step).
- Check: `N screens browser mark` in `npm run verify -- --computer`, and the shared block's six launchers.

Stated limit: a member that starts `/usr/bin/chromium` by its own path still gets that browser.

## Firefox is removed

Image layer 10 (R-COMP-READY-03). Firefox is of no use in a computer, so the image drops it.

- Firefox ESR is purged from the image: the package, its `x-www-browser` alternative, its menu entry and mime
  registrations, `/etc/firefox-esr`, `/usr/lib/mozilla`, XFCE's own Firefox entry in its list of preferred applications. `which firefox firefox-esr` finds nothing.
- Google Chrome (the members' browser; on arm64 from layer 14) and Chromium (the driver's where there is no Chrome, and
  the members' on arm64 until layer 14) stay. The
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

## Google's Chrome on arm64 too

Image layer 14 (R-COMP-READY-04). On an Apple-silicon Mac (arm64 Docker) the members' browser was Debian's Chromium:
Chromium's blue mark and Debian's build of it (measured in a layer 13 profile: DuckDuckGo is the first of its search
engines; in Chrome's own profile it is Google), where an amd64 computer has Google's own Chrome. Google's repository now
lists arm64 beside amd64 (`dists/stable/Release`, `binary-arm64/Packages` has `google-chrome-stable`). Debian's Chromium
also writes its own command line with spaces where Chrome keeps each word apart, so `raphael-browser-tabs` could not
find its profile on arm64 ("process ... names no profile", and a seat's window kept its marker page); with Chrome it can.

- The members' browser is Google's own Chrome on every computer, taken as on amd64: from Google's repository, under
  Google's key, at the version current when the image is built. Layer 14 is one step after layer 12's (`COPY layer14/`);
  every step before it, `desktop/`, `layer11/` and `layer12/` are as they were, so a PC that built layer 13 builds only
  this step. On amd64, where Chrome is there already, the step changes nothing and only checks. Measured on an arm64
  Mac: a layer 13 image built from the same steps came wholly from the build cache, the step took 15 s (140 MB from
  Google's repository), and the image is 4.06 GB where layer 12 was 3.38 GB. Editing a comment above a step re-ran none.
- Where it installs Chrome it names the desktop for it as layer 9's step does: every screen's launcher and the menu's one
  browser are Google Chrome under Chrome's mark; XFCE's Web Browser, the menu's Chrome and Chromium entries and
  `x-www-browser` start `raphael-browser`. `raphael-browser`, `raphael-seat-browser` and `raphael-browser-tabs` (layer 12)
  take Chrome wherever it is installed, with the flags they give it on amd64 (`--no-sandbox --test-type`, the seat
  browser's own list). The managed policy (no browser sign-in, no sync, nothing typed kept) was already written for
  Chrome's folder as for Chromium's; the step checks the two are the same file.
- Debian's Chromium stays installed. The driver takes the first root-owned of `/opt/google/chrome/google-chrome`,
  `/usr/lib/chromium/chromium`, ... for a browser it starts itself (cua-driver 0.37.0, `isolated_browser_candidates` in
  `platform-linux/src/browser_platform.rs`), so on a computer of a member's own its browser is Chrome on arm64 as on
  amd64, and Chromium is what it would take where there is no Chrome. The driver's own data is not a profile of its own:
  `CUA_DRIVER_BROWSER_PROFILE_ROOT` is `.browser-profiles/driver`, and its browser's profile is `driver/main`.
- Chromium's profiles are not carried into Chrome. The members' own profile is `.browser-profiles/driver/main`: the
  shared computer's browser is started on it by `raphael-seat-browser` and the driver attaches to it; on a computer of a
  member's own it is the driver's browser (`browser_prepare`, profile `main`). `.browser-profiles/chromium` is what
  Chromium kept when it was started without a profile (the desktop's browser on a computer of a member's own);
  `.browser-profiles/google-chrome` is Chrome's. On arm64, the workspace's preparation that layer 14 installs
  (`layer14/prepare-raphael-workspace.sh`, run before the driver starts) removes `driver/main` and `chromium` once in each
  workspace, before any browser starts: the members sign in again. Its mark, the folder
  `.browser-profiles/.raphael-chromium-dropped`, is made before anything is removed, so a removal that stops halfway is
  never tried again over what Chrome made since, a workspace where the mark cannot be made loses nothing, and the mark
  never follows a link out of the workspace. The rest of `driver/` (the driver's other profiles, carry-over staging), `google-chrome`, every other file of the
  workspace and the team folder stay; a `.browser-profiles` or `driver` that is a link is left as it is. The driver makes
  `driver/main` again, with its own mark, the next time it starts its browser; the shared computer's launcher makes it as
  before. On amd64 that copy of the script is not installed and nothing is removed.
- Layer 13 computers, a member's own and the shared one (whose size is the engine's), are named in `vm.known_previous`
  in the shape they have, which is layer 14's, and are made again on layer 14 at their next start, workspace kept. The
  layer 13 image is then removed as any older layer's is (R-COMP-IMAGE-02).
- Check: `npm run verify -- --computer` requires Google Chrome on every architecture ("N screens browser mark", "shared
  browser is a person's", which also runs Chromium for its version); its previous-layer blocks write an earlier layer's
  browsers' profiles into that layer's workspace and, once it is made again, require on arm64 that `driver/main` and
  `chromium` are gone, the rest kept and the mark there, and on amd64 that everything is kept.

```powershell
cd core; .\.venv\Scripts\python.exe -m pytest tests/computer/test_seat_tools.py tests/computer/test_housekeeping.py tests/computer/test_seat_windows.py tests/computer/test_image_workflow.py tests/evaluate/test_computer_acceptance.py -q
```

Stated limits: the carry-over of a historical home (R-COMP-SEAT-01) still copies a home's `driver/main` into a shared
home that has none, so a member's own home of an arm64 PC that the carry record does not yet call handled would bring
its Chromium profile along (a home carried before is handled and is never carried again). Whether Google lets a
sign-in through stays Google's decision; no test signs in.

## Smaller computer image (layer 15)

The desktop and cua-driver 0.37.0 use Google Chrome on amd64 and arm64. The driver already prefers the root-owned
Chrome launcher, and both launch paths still use the container's isolation and their existing no-sandbox flags.
The Chrome policy, launchers, XFCE, TigerVNC, websockify/noVNC, Python, Git, Node/npm and CJK fonts stay.

The Dockerfile checks the layer 14 filesystem, purges Chromium and the unused build and FFmpeg tools, then copies
the merged filesystem into a scratch image. Firefox's files therefore disappear from the delivered image layers.
Apt retains dependencies still in use, and Make is kept for members' projects. The final image restores the
environment defaults in its image config and starts supervisord directly. The old steps remain usable as
the layer14 target. The first measured v15 build was 2,497,161,306 bytes, versus 4,174,853,886 for v14.

At next start, layer 14 per-member and shared computers are recreated with their existing workspace and team mounts.
Layer 14 Chrome profiles stay in the workspace. The existing one-time Chromium migration still applies to older
arm64 workspaces. Real computer verification checks the built image's `Config.Env` before starting any computer.
Panel and wallpaper checks use plain guest commands, and the migration runs when a layer 14 image is present.
There are no Look scene changes.

## Responsive computer tools

R-COMP-PERF-01 through R-COMP-PERF-06 supersede the earlier full-screen bootstrap,
mandatory desktop re-check, 2 GiB memory cap and on-call discovery notes.
This change is core only: it needs no Docker operation, network, paid
model, look or native run. All current evidence uses fake Docker/driver
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
computer (MIT, see NOTICES). It replaces a compatibility
offer adapted from older macOS schemas with reconstructed Linux definitions, every
one of whose 30 tools differed from the driver. `npm run verify -- --computer`
compares a running driver's list with it, words and order included, and writes the
list it found to driver-tools.json in its run folder;
core/tests/computer/fixtures/generate_driver_tools.py writes both kept files (this
one and the doubles' driver_tools_0.37.0.json) from such a list. Packaging
explicitly includes this JSON and audits its presence.

What a model reads of a computer tool: Raphael's line on what the tool is for
(vm_catalog.DRIVER_TOOLS, or the tool's own definition), then the approval rule,
whole. The driver's own description is not offered; its parameters' words are.
Measured: 40 tools, descriptions 17.8 thousand characters (18.4 on a
shared computer), parameters 55.6 thousand. The parameters are the driver's
verbatim text and are the same size a member's list already had after its first
use of the computer; before that use the list was 9 thousand characters of
parameters that the driver did not accept.

Offline scope: tests/computer, tests/agent/test_persona.py,
tests/agent/test_member_computer_use.py, tests/background/test_computer_lazy.py and
packaging tests, followed by the whole core suite once.

Acceptance still needed: time cold/warm desktop
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
in this offline-only scope, with no UI consistency comparison implied.

## Slime town and computer preparation

The town was replaced by two pictures (the default picture section); what follows on preparation holds.
R-UI-92/93/94 replace the monochrome artwork and preparation stage-list assertions
only. The existing hour boundaries, five filenames, XFCE watcher, start/repair
controls, leases and single carried iframe remain authoritative. The approved
original town drawing uses paths, groups, ellipses, circles, rounded rectangles
and SVG 1.1 gradients. A fixed 32-bit LCG replaces Python random; generate both
asset folders through wallpaper.py --generate. The byte ceiling is 20,000, with
the largest current SVG approximately 15,000 bytes. No embedded/external images,
text, scripts, CSS or modern SVG features are shipped.

Preparation keeps the running preview's aspect ratio and its picture (centred).
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
npm run look -- desktop-starting desktop-building desktop-preparing desktop-wallpaper-day desktop-wallpaper-night desktop-boot-inline desktop-boot-card desktop-boot-connect desktop-boot-raphael desktop-own-wallpaper desktop-own-wallpaper-card desktop-stopped desktop-unavailable desktop-absent desktop-panel desktop-viewer --theme both --width 1120,720,1920x1080
```

Compare the full-size preparation and day and night images and the preview/emblem
with the shared member-header face. Offline look evidence does not prove the
XFCE loader or guest timezone.

## Three computer levels

The monitor is always an icon entry and turns purple only for a running computer.
Details opens on the screen/caption, direct routine rows and conversations. The
gear leads to existing identity, fields and resources; Back returns through that
hierarchy. Skills and slash-command templates retain their distinct editors.
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

The default pictures (two, R-UI-92) are shared by the guest, off preview
and fixture RFB transport. The wallpaper tests prove each hour's selection and that the
guest and the preview carry the same bytes. Since layer 6 the 30-second timer is the one watcher the core starts when
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
npm run look -- computer-status-active computer-status-member computer-status-idle panel-screen-routines panel-off desktop-start desktop-return-stopped panel-no-computer panel-gear panel-routine-row panel-raphael takeover-bar takeover-menu takeover-handback --theme both --width 1120,720,1920x1080
```

- computer-status-active, computer-status-member, computer-status-idle, panel-screen-routines, panel-off,
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

## Named datasets

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

## Teach by demonstration

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

## The owner's screen is a quick question's; hidden commands are every turn's (R-PC-01, R-PC-02, R-PC-06)

What shows on the owner's screen is driven only from a quick question (Alt+Space). One switch decides it,
`take_snapshot(owner_screen=...)` (`permissions.owner_screen`: a quick question asked at this computer, never nested):
without it a turn is offered and finds none of the harness `computer` tool (the guarded run on the owner's desktop) or the
fixed commands (open, volume, media, lock_screen, copy_text). That is every typed or spoken conversation, Raphael's or a
member's, rooms, exchanges, Telegram/Slack/Discord, background tasks, routines and event runs, on API and CLI brains, in
every permission mode. The fast router (Jev) is asked about a quick question alone. What such a turn shows on a screen
(a website, YouTube, a program, clicks, typing) it shows on the member's own computer; with none it says so.

The local commands (`mcp:local/local_exec`, `mcp:local/local_job`, its background jobs, and a CLI brain's own command)
run hidden on the owner's PC from every turn and task again, through the approval machinery they always had: the
first-consent card and the chat approvals without a timer in a private conversation at this computer, the 30-minute
background approvals of a task or a routine, in the stored mode (ask, always, never; 全部允許 runs without a card).
Settings has no control for the mode. Where no card can be shown (a phone, an exchange, a quick question) a command runs
only under 全部允許; a room's speaking turn has its speaking tools alone, as before. Every prompt says commands may run hidden on the owner's PC with the owner's approval and that work to be
seen is done on the member's own computer (`agent/capabilities.py`, `persona._SHARED_CONTRACT`).

On Windows and macOS, a local command finishes when its shell exits (R-PC-07). Its bounded
stdout and stderr buffers drain for up to one second, even if a descendant still holds a pipe open. The command
returns the shell's exit code and leaves surviving descendants running. A timeout or stop terminates the process
tree. A timed-out command has a null exit code and retains partial output. A background job follows the same
rules because it uses the same host executor. The real-shell cases in `core/tests/computer/test_local_commands.py`
exercise both paths with a descendant that inherits the output handles.

The safety net (R-PC-06): outside a quick question a command whose purpose is to show something on the owner's screen
(Start-Process, saps, start, cmd /c start, explorer, Invoke-Item, ii, rundll32 url.dll, Process.Start, a URL, a shortcut
or a document typed as the command, a windowed program, `open` on a Mac) is refused in every mode without a card, and the
member is told to open it on its own computer (`computer/on_screen.py`, checked in `LocalTools.tier_for_call` and `call`,
`AgentService._cli_permission` and the background CLI loop). It stops a model that picked the wrong computer; it is no
defence against someone set on getting round it.
PowerShell string expressions, format strings and assignments do not open anything. Explicit invocations such as
`& "C:\Tools\app.exe"` still take the screen route.

A quick question keeps the owner's PC as its default for everything, commands and what is seen alike, and also holds the
member's own computer for a request whose words name it (`persona._OWNER_PC_RULES` says which is the default and how the
owner names the other; the desktop `computer` stays beside the member's computer tools). The model picks; no word matched in
code takes either computer away. A quick question can show no card, so a local command runs there only under 全部允許.

Offline: core/tests/agent/test_owner_pc_reach.py (lists, prompts, API and CLI, every mode, a quick question beside the
member's own computer), computer/test_local_commands.py (contexts, the table of commands that show something and of those
that do not, every mode), agent/test_local_commands.py and agent/test_local_command_flow.py (cards in a conversation, the
CLI's own command), background/test_local_commands.py (30-minute approvals, a task's refused opener),
members/test_local_commands.py, members/test_cli_brains.py, members/test_connection_floor.py, agent/test_computer_choice.py
and agent/test_whose_computer.py. No look scene changes: nothing rendered changed (the cards are the existing ones).

## The owner's files: read everywhere, write in the owner's folders (R-PC-04, R-PC-05)

Members read every file of the owner's computer from every turn, task and source, and write only in folders the owner chose; its screen stays a quick question's. Modelled on Claude Code (its file tools read the whole computer; Write and Edit only the
working and added directories). `computer/owner_files.py` adds five pinned plugin tools under the `owner_files` server,
offered by `LocalTools.offered_for` beside the local commands but not keyed `mcp:local/`, so `take_snapshot` never drops them:
every turn and task, every source and brain (API, and CLI through its MCP list) and every permission mode has them.

- Reads (T0, kind read, no card): `read_file` (Claude Code's Read through `file_tools.Files` and the guest helper
  `files_guest.handle` run on this computer: numbered lines, pictures as images, PDFs by pages), `glob` and `grep` (Python
  walks, as ripgrep is not on the owner's computer; newest first, Claude Code's output modes and paging, 30 s bound).
- Kept from every read and write, through links too (`owner_files.kept`): SSH, GPG and cloud keys, the keychain and
  Windows' credential stores, browsers' profiles, password managers, `.env` files (not `.env.example`) and private keys.
  Raphael's own data keeps the data floor. Walks skip `Library`, `AppData`, caches, `.git` and `node_modules` unless they
  start inside them (each app's container on a Mac would ask the owner). A denied file on a Mac names System Settings ›
  Privacy & Security › Files and Folders or Full Disk Access.
- Writes (T2, kind write) reach a member's own shared folder, the team folder and each remembered project. Kept
  paths, the data floor and read-before-edit still apply. The composer lists the member's own folder first and
  projects in added order. The checked row sets the working location. Add folder is the native picker. In member
  settings, the member's own folder is one row that opens it in the file manager.
- Git branches are visible beside the project and on the separate branch button. Its card checks the current ref
  and lists local branches. If Git is unavailable, a branch read from HEAD has no switch choices. Git's refusal
  appears in the toast. Core Git calls disable hooks and fsmonitor. Repositories with their own filters
  must be switched in the owner's terminal. Migration 99 keeps the valid old paths within the project limit.
- Local Docker bind-mounts existing local projects under /home/cua/projects. It skips UNC paths and, if launching
  with project mounts fails, tries once with only the workspace and team mounts. The prompt uses the available
  mounts. Names with a collision keep their assigned suffix when another project is removed. An existing container
  can still be viewed and stopped after a mount change. It is rebuilt on its next idle start, preserving the
  workspace. The member's default folder maps to /home/cua/workspace in a per-member
  container and to its own subfolder there on the shared desktop. Hosts reached over SSH retain their own volumes.

Offline checks cover the migration, permissions, prompts, temporary Git repositories and simulated mount changes.
See [General](settings-appearance.md#project-folders-in-general) for adding, cancelling and removing projects.

```powershell
npm run look -- member-own-folder composer-folder composer-folder-menu composer-folder-added composer-folder-many composer-branch composer-row-narrow composer-row-language composer-row-owner --theme both --width 1120,720,1920x1080
```

Compare the composer controls with the permission control and the member's folder row with other tool rows.
Native picker, file-manager opening and the Linux bind mounts require real acceptance.


## Owner-PC commands (hidden, every turn's, with the card; see above)

Owner-PC diagnostics and CLI work use local__local_exec rather than the Linux
sandbox or guarded real-desktop mouse/keyboard tool. A quick question sees the
pinned local_exec/local_job definitions on API and CLI MCP paths, no other turn does.
Settings has no control for the mode,
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

Acceptance still requires the owner's real CPU question to a member on both API
and installed CLI brains, harmless process inspection, explicit approval/dismissal,
tree cleanup on Stop/app close, and the Docker path after schema discovery.
Offline fakes and rendered fixture success do not prove Docker, cargo, native
journeys, network, judge or real subscription commands. Rule IDs: R-PC-01/02/03/06 and R-AG-13.

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
workspace (at most six hours); the log keeps the first 256 KiB of combined output. The member reads the log and actual job exit code with later commands. `attach_file` only
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


## Live desktop (Phase B)

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

## Side-panel computer (supersedes inline viewer/card UI)

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

## A member's computer needs no permission (supersedes On-demand member permission)

Every member's computer works the same way: nothing asks and no grant exists, and as little as possible is shown in the front
end. Rule: R-COMP-ACCESS-01.

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

The computer is not a connection (a member whose `members.tools` was `["web_search","web_read","weather","local_time","50a816b0b31c"]`
said it would use its own computer to read a page and could not). A computer tool's key is `mcp:computer-<id>/<tool>`, and
`Speaker.uses_plugin` read that as a connection the owner had not chosen. It now lets every computer tool through, so a member's
list of tools, set or empty, never takes its computer: `core/tests/computer/test_member_computer_access.py`
(`test_a_member_with_a_list_of_chosen_tools_keeps_its_own_computer`, `test_the_tools_a_member_with_a_list_sees_are_the_tools_it_can_call`).
There is no per-member off switch to migrate (the list had no place for the computer), so nothing is migrated. A member on a PC
with no computer is offered none, and its prompt says that with no computer tool listed it says so plainly and promises none
(`test_a_member_without_a_computer_is_offered_none_and_told_not_to_promise_one`).

What stays exactly as it was: sandbox gestures pass the screening and need the lease; `fill_login`, `fill_contact`,
`fill_card` and `dataset` still obey the safety rules and the mode (`fill_card` is T3); the worker still cannot
drive the owner's own desktop (`ToolGate.check(worker=True)`); payment holds, takeover, the owner's hold and a
changed target still refuse a call; a checkpoint restore is the member's own `file_history` tool, which asks for no
confirmation (R-COMP-UNDO-01). In 先詢問 and 計畫 sandbox gestures were never asked after the first yes and
are not now (the one question that is gone was the grant itself).

An explicit non-preview `computer.viewer_open` (the owner's press on the screen) launches a stopped computer;
preview opens and status reads never do. Looking at the panel never starts a computer.

Offline regressions: `core/tests/computer/test_member_computer_access.py` and
`core/tests/agent/test_member_computer_use.py`, plus the existing computer, agent and background suites.
The UI side is R-PANEL-06 (the computer is the third tab only; Details has no computer row) and R-COMP-QUIET-01 (nothing but handoff cards in the conversation).

## The computer is the third tab only, and the quiet thread

R-PANEL-06. Details once had a computer row (「拉斐爾的電腦 休眠中」 with a small screen) beside the routine, 對話 and 訊息平台;
the computer is already a tab above, so it lives in the third tab (電腦) only. Details holds the routines, for Raphael its conversations, and the chat platforms, for every
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
says it: the screen has no badge of its own
(`desktop-owner` asserts 你正在控制 shows once).

The conversation shows no line or card for a running, finished or stopped computer task any more
(`desktop-timeline.ts`); only a handoff the owner must act on is a card.

```
npm run look -- member-panel-details member-panel-details-no-computer-running member-panel-details-no-computer-asleep member-panel-details-no-computer-docker-stopped member-panel-details-no-computer-raphael member-panel-library-raphael member-panel-computer-live member-panel-computer-live-raphael member-panel-computer-asleep member-panel-computer-docker-stopped desktop-watch desktop-watch-owner takeover-bar desktop-panel chat-computer-takeover --theme both --width 1120,720,1920x1080
```

Not covered, needs a real engine: the engine start on a PC with Docker Desktop stopped.

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

## Per-member hosts

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
with the member details header at the same width/theme. Trademarks and task
teaching are excluded. The noVNC fixture proves
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


## Work channels, file restore and private page login

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
named as uncovered when the member lists a turn's changes. The archive retains 20 checkpoints per member
within approximately 500 MiB of objects per computer, pruning unreferenced objects.
Changes are compared on request against the next manifest or live folder. Restore is
the member's tool `file_history` (R-COMP-UNDO-01): it takes the run's own checkpoint first, names later
edits it leaves alone and asks the owner for nothing. There is no pending/finish state;
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
npm run look -- work-messaging-setup work-messaging-pairing computer-login-card computer-login-saved chat-secret-masked delete desktop-owner --theme both --width 1120,720,1920x1080
```

Compare login with chat-secret-masked and panel
controls with desktop-owner at the same theme/width. Inspect every contact sheet
and full-size changed controls. Extend scripts/look rather than adding a harness.
Focused tests: messaging/test_work_channels.py, computer/test_checkpoints.py,
computer/test_checkpoint_revision.py, computer/test_login_visibility.py,
computer/test_login_vault.py, agent/test_private_login.py, brain/test_db.py,
work-channels.test.ts and scripts/look/audit.test.mjs. After a change here run the
computer, messaging, agent and background folders in full once (each through the place-keeper on a
shared PC), then only the files a later fix touches.
Report explicitly if that full run preceded the last change. Frontend verify uses
two Vitest workers.


## Computer location moves to its panel

The former Settings > Raphael location and Docker installation area is superseded
by [Settings by purpose](settings-appearance.md#settings-by-purpose).
The compact header/empty-state location popover is shared by all members. See that
entry for scenes, existing setting/RPC contracts and offline acceptance limits.


## Offline root and dispatch security

R-SEC-FILES-01/02: core/tests/computer/test_security_boundaries.py uses real temporary
Windows junctions (symlinks on other systems) and a fake Docker runner. It verifies
workspace/shared/parent redirection, both team-file handle forms, library root rejection,
and grant revocation, target change or owner hold during preparation/checkpointing.
The same checks apply to cached starts. Existing test_vm.py/test_takeover.py assertions
include vault_entries/fill_contact and the firm T3 fill_card exception, without weakening
owner-hold or single-use approval tests. No UI markup, scene or navigation changes.
The Docker forwarding and screenshot-lifetime decisions are settled in the private SSH
entry below. Do not call offline fake tests authorized SSH or native acceptance.

R-SEC-FILES-04 additionally checks artifact receipt roots and bounds bytes before
hashing. Include background/test_tasks.py, test_handoff.py and test_team_flow.py
alongside the security regressions and architecture suite for that consumer boundary.

## Private SSH and filled-page lifetime

R-SEC-SSH-01 and R-SEC-PRIVATE-01 settle the Docker forwarding and screenshot-lifetime decisions left open above.
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


## A key for a program in a member's computer, and paste into the computer (R-KEY-01, R-KEY-02, R-KEY-03, R-PASTE-01)

A member that needs the owner's key for a script in its computer calls `request_secret` with `key` (an environment
variable name) and `purpose`; the secure card (`secret-card.ts`, `keyCardHTML`) is titled 「儲存金鑰」, with the quiet waiting dot and its words beside the title, the variable in monospace and its purpose below. It takes the value in one masked field beside Save, with a vault hint; its way out is the × at its top right and nothing of it stands under the card (R-CARD-21): on the owner's own message the × takes the message back, on work the member handed itself it answers that work's waiting question
(Credential Manager, a `vault_entries` row of kind `key`, never the conversation, a row or a log). The member then
is told by `request_secret` to ask in the conversation for a value that is no secret (a user name, an e-mail, a site: no key card; any non-empty key is accepted, including one character, R-KEY-05), renews an expired key under the same name with `request_secret` `replace: true` (one entry per name and scope is kept, the newest, R-KEY-04) and may propose deleting its own private key with `remove_key`, which the owner approves on a card. It runs `vm_exec` with `keys: [NAME]`: the core hands the values to that one process's environment (`docker exec -e NAME`,
the value in the docker process's own environment, never an argument) and replaces them in everything returned,
including a background job's log read later. The Keys tab of the safety pane's saved-entries list (`vault.ts`) shows
and removes them; it offers no way to add one. In the live view (`BOOTSTRAP` in `computer/viewer.py` and
`desktop-viewer.ts`) the owner's Ctrl+V, while they hold the screen, puts their clipboard into the computer first
(`owner_clipboard_text`, `paste/clipboard.rs`) and then sends the keys; watching or a member's work never reads it.

Selected matrix, from app/:

```powershell
npm run look -- computer-key-card computer-key-card-work computer-key-saved computer-login-card chat-secret-masked desktop-owner --theme both --width 1120,720,1920x1080
```

Compare the key card with the login card and chat-secret-masked at the same theme/width: the same shell, one masked
field, and no value in the markup, text or recorded calls. The variable key uses a horizontal field and Save row and a quiet status dot beside the title. The × withdraws its own request and restores the original message to the composer; computer-key-card-work shows the same card on work the member handed itself, whose × answers the waiting question and where no 取消 stands outside the card. Core: `tests/computer/test_computer_keys.py`,
`tests/evaluate/test_card_tools.py`, `tests/brain/test_db.py`. App: `secret-card.test.ts`, `vault.test.ts`,
`desktop-viewer.test.ts`, `desktop-paste-page.test.ts`; Rust: `cargo test paste::clipboard`. Not proved offline: a paste
into a real container and a real Credential Manager write.

## Copy and paste with the computer, and files handed to it (R-PASTE-01, R-PASTE-02, R-COMP-FILE-01, R-COMP-FILE-02)

A shared computer's screens are x0vncserver, which carries no clipboard before TigerVNC 1.15, so the screen's cut text
never reached it: the owner's paste pasted the computer's own old clipboard. Now the app hands the paste's text to the
computer's clipboard through the core (`computer.viewer_clipboard` `put`, the driver's `clipboard_write`) before the page
sends the keys, and only when the PC's clipboard changed since it last matched the computer's (`owner_clipboard_sequence`),
so a copy made inside the computer still pastes there. The owner's own Ctrl+C, Ctrl+X or Ctrl+Shift+C in the screen they
hold (Command on a Mac, told as Ctrl) tells the app 250 ms later, and the core brings the computer's clipboard text to the
PC's clipboard (`take`, the driver's `clipboard_read`, the device's clipboard write), unless the computer's clipboard is
what this view last knew. Code: `computer/owner_transfer.py`, `DesktopViewer.clipboard`, `answerPaste` and `bringCopy` in
`desktop-viewer.ts`, `owner_clipboard_sequence` in `commands.rs`.

A file dropped on the computer's screen (watching or holding it) or chosen with 傳送檔案到電腦 in the held computer's ⋯ goes
to the upload store a megabyte at a time and `computer.viewer_put_file` copies it into `/home/cua/team` under its own
name, ` (2)` added when the name is taken; one quiet line under the screen says where it went. A remote computer gets it
over the engine, at most 32 MB. The guest publishes to a free name atomically and retries with a number when a file,
folder or concurrent transfer takes that name.

A member does the same itself with `copy_from_owner {path}`, one of its computer's tools (R-COMP-FILE-02): a file of
the owner's computer, by an absolute path or one from `~`, goes into `/home/cua/team` through the same placing
(`owner_transfer.hand_over`). Where keys are kept, Raphael's own data, a folder and a file over the limit are refused.

```powershell
npm run look -- desktop-owner desktop-send-file-menu desktop-file-dropped --theme both --width 1120,720,1920x1080
```

Core: `tests/computer/test_owner_transfer.py`, `tests/computer/test_viewer.py`. App: `desktop-viewer.test.ts`,
`desktop-paste-page.test.ts`. Not proved offline: the driver's clipboard in a real container (what `clipboard_read`
answers, and that a paste lands); `npm run verify -- --computer` with Docker running proves it ("shared owner paste",
"shared owner copy", "shared owner files", "shared member copy" in `evaluate/computer_acceptance.py`; the offline world fakes the driver and
the guest's programs, so only a real run shows what the driver's clipboard does).

A computer that cannot start for its setup (R-SETUP-01): self_check's `setup.computer` says `docker_missing` (with Docker Desktop's download page), `docker_stopped`, `running` or a remote host `unreachable`, read without starting anything; raphael_help says how a member helps the owner install or open Docker Desktop in the conversation, and each engine failure (`absent`, `image_missing`, `pull_failed`, `build_failed`, `local_capacity`, `incompatible`, `start_failed`) tells the member what to do. Nothing is drawn over the screen. Core-only: `core/tests/test_setup_facts.py`.
