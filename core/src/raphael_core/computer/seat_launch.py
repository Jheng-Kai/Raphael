"""Which new windows a program launched at one seat of a shared computer opened.

The window manager opens a new window on the screen the pointer is on, whichever member's that is. Neither where a
window opens nor its process says whose launch it was: a program that keeps one copy running (xfce4-terminal, a
browser) opens the window of a second launch in the first copy's process, and the window often maps after the driver
has answered. So a launch is tagged the way a desktop's own launcher tags one (the freedesktop startup-notification
protocol): the program starts with DESKTOP_STARTUP_ID, which GTK writes as _NET_STARTUP_ID on its client leader window
and xfce4-terminal hands to the copy already running, which writes it on the new window itself; and with
RAPHAEL_LAUNCH, which every process the program starts inherits and which /proc shows. The tags are random, so one
launch's tag never names another's window.
"""

import re
import secrets
import shlex

PREFIX = "raphael-launch-"
# What tagged() sends. A member that copies the driver's "Launched ..." line into its next launch would otherwise wrap
# an older tag inside the new one, and the window would carry the older tag.
WRAPPED = re.compile(r"env DESKTOP_STARTUP_ID=(raphael-launch-[0-9a-f]{16}) RAPHAEL_LAUNCH=\1 sh -c (.+)", re.S)

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


def tagged(args, tag, path=None):
    """The driver's arguments for a launch that carries `tag`, or None when it cannot carry one.

    launch_path is run by the driver's shell, so the tag goes in front of it, the member's command run whole by `sh -c`
    (a compound command stays one) with its additional arguments after it. A name is tagged only when the computer's
    shell finds it as a program (`path`): any other name is a desktop entry the driver matches and starts itself. URLs
    are handed to xdg-open by the driver, which nothing here can tag."""
    if args.get("urls"):
        return None
    if args.get("launch_path"):
        command = args["launch_path"]
        while match := WRAPPED.fullmatch(command):
            try:
                inner = shlex.split(match[2])
            except ValueError:
                break
            if len(inner) != 1:
                break
            command = inner[0]
    elif path:
        command = shlex.quote(path)
    else:
        return None
    command = " ".join([command, *map(shlex.quote, args.get("additional_arguments") or [])])
    sent = {key: value for key, value in args.items() if key not in ("launch_path", "name", "additional_arguments", "bundle_id")}
    sent["launch_path"] = f"env DESKTOP_STARTUP_ID={tag} RAPHAEL_LAUNCH={tag} sh -c {shlex.quote(command)}"
    return sent


def as_asked(reply, sent, args):
    """The driver's reply with the member's own command where the driver repeats the tagged one."""
    from copy import deepcopy
    wrapped = sent["launch_path"]
    asked = " ".join([args.get("launch_path") or args.get("name") or "", *(args.get("additional_arguments") or [])]).strip()
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
