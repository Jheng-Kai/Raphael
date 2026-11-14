"""The desktop's picture in a computer: the owner's own when there is one, else the default picture for the hour.

The default is two original abstract pictures (owner, 2026-11-14), the light one by day (06:00 to 17:59) and the dark
one by night (18:00 to 05:59), by the computer's own clock: it runs with TZ set to the owner's zone
(vm.refresh_timezone). The app's preview shows the same picture at the same hours (desktop-viewer.ts).

The core copies this script and wallpapers/ into the computer at every start (LocalVm._wallpaper) and runs it there as
the one watcher, with the standard library only. They live outside image/ on purpose: a change to anything the
image's build copies (image/desktop/ above all) makes the next image build download Chrome and its packages again.
"""
import argparse
from datetime import datetime
from pathlib import Path
import subprocess
import time

DAY, NIGHT = "day.jpg", "night.jpg"


def wallpaper_for_hour(hour):
    return DAY if 6 <= hour < 18 else NIGHT


def apply_wallpaper(path, applied=None):
    properties = subprocess.check_output(["xfconf-query", "-c", "xfce4-desktop", "-l"], text=True).splitlines()
    workspaces = {prop.rsplit("/", 1)[0] for prop in properties if prop.startswith("/backdrop/") and prop.endswith(("/last-image", "/image-style"))}
    if not workspaces:
        raise subprocess.SubprocessError("XFCE desktop workspaces are not ready")
    applied = {workspace: selected for workspace, selected in (applied or {}).items() if workspace in workspaces}
    for workspace in sorted(workspaces):
        if applied.get(workspace) == path:
            continue
        image = workspace + "/last-image"
        create = ["-n", "-t", "string"] if image not in properties else []
        subprocess.run(["xfconf-query", "-c", "xfce4-desktop", "-p", image, *create, "-s", str(path)], check=True)
        style = workspace + "/image-style"
        create = ["-n", "-t", "int"] if style not in properties else []
        # 5 is zoomed: the picture fills the screen from its centre, as the app's preview shows it.
        subprocess.run(["xfconf-query", "-c", "xfce4-desktop", "-p", style, *create, "-s", "5"], check=True)
        applied[workspace] = path
    return applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--hour", type=int)
    parser.add_argument("--image", type=Path)
    args = parser.parse_args()
    if args.hour is not None:
        print(wallpaper_for_hour(args.hour))
        return
    applied = {}
    while True:
        # vm.refresh_timezone supplies TZ when creating/reconciling the guest.
        selected = args.image or Path(__file__).parent / "wallpapers" / wallpaper_for_hour(datetime.now().hour)
        try:
            applied = apply_wallpaper(selected, applied)
        except subprocess.SubprocessError:
            pass  # XFCE can still be starting; the next tick retries.
        if not args.watch:
            return
        time.sleep(30)


if __name__ == "__main__":
    main()
