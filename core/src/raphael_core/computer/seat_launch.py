"""Which new windows a program launched at one seat of a shared computer opened.

The window manager opens a new window on the screen the pointer is on, whichever member's that is. Neither where a
window opens nor its process says whose launch it was: a program that keeps one copy running (xfce4-terminal, a
browser) opens the window of a second launch in the first copy's process, and a slow program's window maps after the
driver has answered. So a launch is tagged the way a desktop's own launcher tags one (the freedesktop startup-notification
protocol): the program starts with DESKTOP_STARTUP_ID, which GTK writes as _NET_STARTUP_ID on its client leader window
and xfce4-terminal hands to the copy already running, which writes it on the new window itself; and with
RAPHAEL_LAUNCH, which every process the program starts inherits and which /proc shows. The tags are random, so one
launch's tag never names another's window.

The driver runs launch_path without a shell (cua-driver 0.37.0 `spawn_launch_command`, whatever its definition says): it
splits it on white space, runs the first word with the rest and then additional_arguments as its arguments, and when the
process it started exits with no new window of the launch within 8 s it refuses the launch (`launch_handoff_timeout`).
A shell's quoting in launch_path reaches the program as literal quotes.
"""

import re
import secrets

PREFIX = "raphael-launch-"
# The words tagged() puts in front of a launch's own. A member that copies them back into a launch is unwrapped, so
# that the window carries this launch's tag and not an older one.
TAG_WORD = re.compile(r"DESKTOP_STARTUP_ID=(raphael-launch-[0-9a-f]{16})")
# What the driver adds to a Chromium-family program it runs itself (cua-driver 0.37.0 `chromium_family_program`): run
# through `env`, the program it sees is env, so tagged() adds it.
ACCESSIBILITY = "--force-renderer-accessibility"
CHROMIUM_FAMILY = ("chrome", "chromium", "electron", "brave", "edge")

# For each window given as `id:pid`: the startup id on the window and on its client leader, and the launch tag in the
# environment its process started with. xprop takes a decimal window id. Every line is optional; what is missing ties nothing.
MARKS = r'''for row in "$@"; do
  id=${row%:*} pid=${row#*:}
  echo "window $id"
  xprop -id "$id" _NET_STARTUP_ID 2>/dev/null
  leader=$(xprop -id "$id" WM_CLIENT_LEADER 2>/dev/null | sed -n 's/.*window id # \(0x[0-9a-fA-F]*\).*/\1/p')
  [ -n "$leader" ] && xprop -id "$leader" _NET_STARTUP_ID 2>/dev/null | sed 's/^/leader /'
  [ "$pid" -gt 0 ] 2>/dev/null && tr '\0' '\n' 2>/dev/null < "/proc/$pid/environ" | grep '^RAPHAEL_LAUNCH=' | sed 's/^/environ /'
done
true'''


def token():
    return PREFIX + secrets.token_hex(8)


def words(args):
    """A launch's words as the driver reads them: launch_path, else name, split on white space, without the tag of an
    earlier launch in front. None for URLs, which the driver hands to xdg-open."""
    command = None if args.get("urls") else args.get("launch_path") or args.get("name")
    if not isinstance(command, str):
        return None
    found = command.split()
    while len(found) > 3 and found[0] == "env" and (match := TAG_WORD.fullmatch(found[1])) \
            and found[2] == f"RAPHAEL_LAUNCH={match[1]}":
        found = found[3:]
    return found or None


def program(args):
    """The program a launch runs, for the computer's shell to find (LocalVm.command_path), or None."""
    return (words(args) or [None])[0]


def tagged(args, tag, path=None):
    """The driver's arguments for a launch that carries `tag`, or None when it cannot carry one.

    `env` sets the tag and runs the program by `path`, where the computer's shell found it, with the launch's other words
    after it in launch_path and its additional arguments left as they are: the program gets the arguments the driver
    would have given it untagged. The path is absolute, so the driver's match of a window handed to a copy already
    running (its class against the command after its last '/') reads what it would read untagged. A program the shell
    does not find is left to the driver (a desktop entry it matches, a file for xdg-open), untagged; so are URLs."""
    found = words(args)
    if not found or not isinstance(path, str) or not path.startswith("/") or "=" in path or any(char.isspace() for char in path):
        return None
    extra = list(args.get("additional_arguments") or [])
    if any(family in path.rsplit("/", 1)[-1].lower() for family in CHROMIUM_FAMILY) and ACCESSIBILITY not in found + extra:
        extra.append(ACCESSIBILITY)
    sent = {key: value for key, value in args.items() if key not in ("launch_path", "name", "additional_arguments", "bundle_id")}
    sent["launch_path"] = " ".join(["env", f"DESKTOP_STARTUP_ID={tag}", f"RAPHAEL_LAUNCH={tag}", path, *found[1:]])
    if extra:
        sent["additional_arguments"] = extra
    return sent


def as_asked(reply, sent, args):
    """The driver's reply, or its refusal, with the member's own command where the driver repeats the tagged one."""
    from copy import deepcopy
    wrapped = sent["launch_path"]
    asked = args.get("launch_path") or args.get("name") or ""
    reply = deepcopy(reply)
    for block in reply.get("content", []):
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            block["text"] = block["text"].replace(wrapped, asked)
    state = reply.get("structuredContent")
    if isinstance(state, dict):
        for key, value in state.items():
            if isinstance(value, str):
                state[key] = value.replace(wrapped, asked)
    return reply


def marks(text):
    """MARKS' answer: window id -> its own startup id, its client leader's, and its process's launch tag."""
    found, mark = {}, None
    for line in text.splitlines():
        if match := re.fullmatch(r"window (\d+)", line):
            mark = found[int(match[1])] = {"own": None, "leader": None, "environ": None}
        elif mark is None:
            continue
        elif match := re.fullmatch(r'(leader )?_NET_STARTUP_ID\((?:UTF8_)?STRING\) = "(.*)"', line):
            mark["leader" if match[1] else "own"] = match[2]
        elif line.startswith("environ RAPHAEL_LAUNCH="):
            mark["environ"] = line.removeprefix("environ RAPHAEL_LAUNCH=")
    return found


def tied(mark, tag, pid, pids):
    """Whether a new window is this launch's.

    A startup id names the launch a window was opened for: the window's own, else its client leader's (the protocol's
    order). A window whose id names anything else is not this launch's, whatever its process: a copy already running
    opens other launches' windows. A window with none is this launch's when its process carries the launch's tag or is
    the process the driver started (`pids`)."""
    mark = mark or {}
    named = mark.get("own") or mark.get("leader")
    if named:
        return tag is not None and named == tag
    return (tag is not None and mark.get("environ") == tag) or pid in pids
