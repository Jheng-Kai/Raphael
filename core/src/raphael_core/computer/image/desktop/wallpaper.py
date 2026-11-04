"""Original slime town through five periods, shared by the guest and conversation panel."""
import argparse
import math
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


class Scatter:
    """A fixed 32-bit LCG keeps the shipped scatter independent of Python's random API."""

    def __init__(self, seed):
        self.state = seed & 0xFFFFFFFF

    def random(self):
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state / 4294967296

    def randint(self, low, high):
        return low + int(self.random() * (high - low + 1))

    def choice(self, values):
        return values[self.randint(0, len(values) - 1)]

    def uniform(self, low, high):
        return low + self.random() * (high - low)


BODY = "M 8 70 C 8 51 24 28 48 28 C 73 27 91 49 92 69 C 94 81 77 86 50 86 C 24 86 7 82 8 70 Z"
OPEN_EYES = "M 42.5 44.5 Q 43 48 43.5 51.5 M 55.5 44.5 Q 56 48 56.5 51.5"
SHUT_EYES = "M 38 50.4 Q 42 49.6 46 50.2 M 54 50.2 Q 58 49.6 62 50.4"
CROWN = "M 35 31 L 31 13 L 42 22 L 50 8 L 58 22 L 69 13 L 65 31 Q 50 26 35 31 Z"
TWO_HORNS = "M 32 36 C 30 28 30 20 34 14 C 37 20 40 27 41 33 Q 36 33 32 36 Z M 68 36 C 70 28 70 20 66 14 C 63 20 60 27 59 33 Q 64 33 68 36 Z"
SMALL_HORNS = "M 35 34 C 34 28 35 23 38 19 C 40 23 42 27 42 31 Q 38 31 35 34 Z M 65 34 C 66 28 65 23 62 19 C 60 23 58 27 58 31 Q 62 31 65 34 Z"
ONE_HORN = "M 44 34 C 45 25 49 16 53 12 L 54 33 Q 50 37 44 34 Z"
AHOGE = "M 50 30 C 47 21 53 13 61 15 C 55 17 52 23 54 30 Z"

PERIODS = {
    "morning": dict(sky=["#A9DCF4", "#D7EEF7", "#FCE9D3"], far="#A6CFC4", mid="#8CC69A", near="#6CB27C", front="#4F9A66", sun=(250, 250, 74, "#FFF3C4", "#FFD98A"), stars=0, lights=0, dim=0, asleep=False, cloud="#FFFFFF", cloud_alpha=.8, town="#7FA9A0"),
    "noon": dict(sky=["#5DB7EC", "#8FD0F3", "#D2EDFA"], far="#8FC7BE", mid="#79C181", near="#58AD64", front="#3F944F", sun=(980, 130, 70, "#FFFBE0", "#FFE9A0"), stars=0, lights=0, dim=0, asleep=False, cloud="#FFFFFF", cloud_alpha=.92, town="#6E9E93"),
    "dusk": dict(sky=["#4A5096", "#C8688A", "#F99E62", "#FCD08F"], far="#7C5F8E", mid="#5F4F80", near="#493F6E", front="#352F58", sun=(1040, 455, 86, "#FFE6A8", "#FF9E5C"), stars=6, lights=.9, dim=.16, asleep=False, cloud="#FFC9A8", cloud_alpha=.6, town="#54477A"),
    "evening": dict(sky=["#141D49", "#2D2F6E", "#6A4287"], far="#2F3468", mid="#262B5A", near="#1E234C", front="#161A3C", sun=(250, 170, 46, "#F4F1D8", "#8A8FD0"), stars=46, lights=1, dim=.3, asleep=False, cloud="#4B4C8C", cloud_alpha=.4, town="#232857"),
    "night": dict(sky=["#050919", "#0C1330", "#182348"], far="#141C3D", mid="#101733", near="#0C1228", front="#080C1E", sun=(960, 150, 52, "#F7F4DE", "#5C68B0"), stars=120, lights=.75, dim=.46, asleep=True, cloud="#1E2850", cloud_alpha=.32, town="#0F1630"),
}


def mix(hex_a, hex_b, amount):
    a, b = [[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in (hex_a, hex_b)]
    return "#" + "".join(f"{round(x + (y - x) * amount):02x}" for x, y in zip(a, b))


def slime(x, y, size, color, marks="", asleep=False, crown=False, dim=0.0, shadow="#000000"):
    """A slime sitting on the ground at (x, y), `size` wide. Flat fill, two white eyes, as everywhere in the app."""
    scale = size / 84
    tint = mix(color, "#0A1030", dim)
    eyes = SHUT_EYES if asleep else OPEN_EYES
    crown_mark = f'<path d="{CROWN}" fill="{mix("#F4C542", "#0A1030", dim)}"/>' if crown else ""
    return (f'<g transform="translate({x - 50 * scale:.1f} {y - 86 * scale:.1f}) scale({scale:.3f})">'
            f'<ellipse cx="50" cy="86" rx="44" ry="5" fill="{shadow}" opacity=".18"/>'
            f'{crown_mark}<path d="{BODY}" fill="{tint}"/>{marks.replace("TINT", "")}'
            f'<g transform="translate(49.5 48) scale(1.25) translate(-49.5 -48)"><path d="{eyes}" fill="none" stroke="#fff" stroke-width="{3.2 if asleep else 5}" stroke-linecap="round"/></g></g>')


def wave(y, amplitude, length, phase, color):
    points = [f"M -20 {y + amplitude * math.sin(phase):.1f}"]
    for x in range(40, 1341, 60):
        points.append(f"L {x} {y + amplitude * math.sin(x / length + phase) + amplitude * .35 * math.sin(x / (length * .37) + phase * 2):.1f}")
    points.append("L 1340 920 L -20 920 Z")
    return f'<path d="{" ".join(points)}" fill="{color}"/>'


def cloud(x, y, scale, color, alpha):
    return (f'<g transform="translate({x} {y}) scale({scale})" fill="{color}" opacity="{alpha}">'
            '<ellipse cx="0" cy="0" rx="62" ry="20"/><ellipse cx="-30" cy="-10" rx="30" ry="20"/><ellipse cx="14" cy="-18" rx="36" ry="26"/><ellipse cx="46" cy="-6" rx="24" ry="15"/></g>')


def town(base, color, lights):
    """The little town: rounded houses far off, with windows that light up as it gets dark."""
    rng = Scatter(7)
    out = []
    x = 110
    while x < 640:
        wide = rng.randint(30, 52)
        high = rng.randint(30, 62)
        y = base - high
        out.append(f'<path d="M {x} {base} V {y + 12} Q {x + wide / 2} {y - 12} {x + wide} {y + 12} V {base} Z" fill="{color}"/>')
        if lights:
            for row in range(rng.randint(1, 2)):
                if rng.random() < .8:
                    out.append(f'<rect x="{x + wide / 2 - 4}" y="{y + 18 + row * 15}" width="8" height="9" rx="2" fill="#FFD27A" opacity="{lights}"/>')
        x += wide + rng.randint(3, 16)
    return "".join(out)


def drawing(name):
    p = PERIODS[name]
    stops = "".join(f'<stop offset="{i / (len(p["sky"]) - 1):.2f}" stop-color="{c}"/>' for i, c in enumerate(p["sky"]))
    sx, sy, sr, core, glow = p["sun"]
    rng = Scatter(11)
    stars = "".join(f'<circle cx="{rng.randint(0, 1280)}" cy="{rng.randint(0, 500)}" r="{rng.choice([1, 1, 1.4, 2])}" fill="#fff" opacity="{rng.uniform(.35, .95):.2f}"/>' for _ in range(p["stars"]))
    moon = name in ("evening", "night")
    disc = (f'<path d="M {sx} {sy - sr} A {sr} {sr} 0 1 0 {sx} {sy + sr} A {sr * 1.28:.0f} {sr * 1.28:.0f} 0 0 1 {sx} {sy - sr} Z" fill="{core}" transform="rotate(-24 {sx} {sy})"/>'
            if moon else f'<circle cx="{sx}" cy="{sy}" r="{sr}" fill="{core}"/>')
    dim, asleep = p["dim"], p["asleep"]
    friends = [
        (120, 800, 120, "#C8413F", f'<path d="{TWO_HORNS}" fill="#2B2430"/>'),
        (262, 826, 104, "#E58CB4", f'<path d="{SMALL_HORNS}" fill="#FBEFE3"/>'),
        (388, 808, 112, "#9270CB", f'<path d="{ONE_HORN}" fill="#363140"/>'),
        (512, 836, 92, "#6BAA4C", ""),
        (1130, 846, 96, "#F07F9C", f'<path d="{AHOGE}" fill="#F07F9C"/>'),
    ]
    crew = "".join(slime(x, y, size, color, marks, asleep=asleep, dim=dim) for x, y, size, color, marks in friends)
    bubble = f'<circle cx="990" cy="600" r="9" fill="#5AB4E8" opacity=".75"/><circle cx="1014" cy="566" r="5.5" fill="#5AB4E8" opacity=".55"/>' if asleep else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900">
<defs><linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">{stops}</linearGradient>
<radialGradient id="glow"><stop stop-color="{glow}" stop-opacity=".75"/><stop offset="1" stop-color="{glow}" stop-opacity="0"/></radialGradient></defs>
<path fill="url(#sky)" d="M0 0h1280v900H0z"/>{stars}
<circle cx="{sx}" cy="{sy}" r="{sr * (2.6 if moon else 3.6):.0f}" fill="url(#glow)" opacity="{.45 if moon else 1}"/>{disc}
{cloud(420, 150, 1.5, p["cloud"], p["cloud_alpha"])}{cloud(1010, 250, 1.1, p["cloud"], p["cloud_alpha"] * .8)}{cloud(120, 330, .9, p["cloud"], p["cloud_alpha"] * .7)}
{wave(555, 24, 170, .6, p["far"])}{town(612, p["town"], p["lights"])}{wave(612, 20, 140, 2.2, p["mid"])}{wave(688, 16, 210, 4.1, p["near"])}
{wave(752, 10, 260, 1.1, p["front"])}{slime(830, 792, 300, "#5AB4E8", asleep=asleep, crown=True, dim=dim * .6)}{bubble}{crew}
</svg>
'''


def wallpapers():
    return {f"{name}.svg": drawing(name) for name in PERIODS}


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
    parser.add_argument("--image", type=Path)
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
