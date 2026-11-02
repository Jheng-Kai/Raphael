"""Original monochrome curves, shared by the guest and the conversation panel."""
import argparse
from datetime import datetime
from pathlib import Path
import subprocess
import time


def wallpaper_for_hour(hour):
    if 6 <= hour < 11:
        period = "morning"
    elif 11 <= hour < 16:
        period = "noon"
    elif 16 <= hour < 19:
        period = "dusk"
    elif 19 <= hour < 22:
        period = "evening"
    else:
        period = "night"
    return f"{period}.svg"


def wallpapers():
    palettes = {
        "morning": ("#f5f5f5", "#aaaaaa", "#ffffff"),
        "noon": ("#ffffff", "#cccccc", "#eeeeee"),
        "dusk": ("#969696", "#464646", "#cccccc"),
        "evening": ("#3c3c3c", "#181818", "#777777"),
        "night": ("#151515", "#050505", "#444444"),
    }
    return {f"{name}.svg": f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900">
<defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="{light}"/><stop offset="1" stop-color="{dark}"/></linearGradient><linearGradient id="wave" x2="0.8" y2="1"><stop stop-color="{glow}" stop-opacity=".8"/><stop offset="1" stop-color="{dark}" stop-opacity=".15"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="24"/></filter></defs>
<path fill="url(#sky)" d="M0 0h1280v900H0z"/>
<g filter="url(#soft)"><path fill="url(#wave)" d="M-120 840C120 170 540 850 790 130S1200-70 1430 190V1000H-120z"/><path fill="none" stroke="{glow}" stroke-opacity=".45" stroke-width="18" d="M-80 730C210 80 490 890 850 180S1190 20 1370 100"/></g>
</svg>
''' for name, (light, dark, glow) in palettes.items()}


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
        subprocess.run(["xfconf-query", "-c", "xfce4-desktop", "-p", style, *create, "-s", "5"], check=True)
        applied[workspace] = path
    return applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", type=Path, nargs="+")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--hour", type=int)
    args = parser.parse_args()
    if args.generate:
        for directory in args.generate:
            directory.mkdir(parents=True, exist_ok=True)
            for name, content in wallpapers().items():
                (directory / name).write_text(content, encoding="utf-8", newline="\n")
        return
    if args.hour is not None:
        print(wallpaper_for_hour(args.hour))
        return
    applied = {}
    while True:
        # vm.refresh_timezone supplies TZ when creating/reconciling the guest.
        selected = Path(__file__).parent / "wallpapers" / wallpaper_for_hour(datetime.now().hour)
        try:
            applied = apply_wallpaper(selected, applied)
        except subprocess.SubprocessError:
            pass  # XFCE can still be starting; the next tick retries.
        if not args.watch:
            return
        time.sleep(30)


if __name__ == "__main__":
    main()
