import runpy
import ast
from datetime import datetime
from pathlib import Path

import pytest

from raphael_core.computer import vm


WALLPAPER = vm.WALLPAPER_FOLDER
IMAGE = Path(vm.__file__).parent / "image"
PUBLIC = Path(__file__).parents[3] / "app/public/wallpapers"


class Clock:
    """`datetime` as the watcher reads it, stopped at one moment of the computer's own (TZ) clock."""

    def __init__(self, moment):
        self.moment = moment

    def now(self):
        return self.moment


def painted(monkeypatch, *argv, moment=None):
    """What one pass of the watcher sets as the picture of the one workspace a computer has."""
    main = runpy.run_path(str(WALLPAPER / "wallpaper.py"))["main"]
    process = main.__globals__["subprocess"]
    calls = []
    if moment is not None:
        main.__globals__["datetime"] = Clock(moment)
    monkeypatch.setattr("sys.argv", ["wallpaper.py", *argv])
    monkeypatch.setattr(process, "check_output", lambda *a, **kw: "/backdrop/screen0/monitor0/workspace0/last-image\n")
    monkeypatch.setattr(process, "run", lambda argv, **kw: calls.append(argv))
    main()
    return [argv[-1] for argv in calls if "/backdrop/screen0/monitor0/workspace0/last-image" in argv]


@pytest.mark.parametrize("time,expected", [("05:59", "night.jpg"), ("06:00", "day.jpg"), ("17:59", "day.jpg"), ("18:00", "night.jpg")])
def test_the_default_picture_turns_at_six_and_at_eighteen_by_the_computers_clock(monkeypatch, time, expected):
    hour, minute = map(int, time.split(":"))
    assert painted(monkeypatch, moment=datetime(2026, 11, 14, hour, minute)) == [str(WALLPAPER / "wallpapers" / expected)]
    choose = runpy.run_path(str(WALLPAPER / "wallpaper.py"))["wallpaper_for_hour"]
    assert [choose(hour) for hour in range(24)] == ["night.jpg"] * 6 + ["day.jpg"] * 12 + ["night.jpg"] * 6


def jpeg_size(data):
    """Width and height from a JPEG's frame header."""
    index = 2
    while index < len(data):
        marker, length = data[index + 1], int.from_bytes(data[index + 2:index + 4], "big")
        if marker in (0xC0, 0xC1, 0xC2):
            return int.from_bytes(data[index + 7:index + 9], "big"), int.from_bytes(data[index + 5:index + 7], "big")
        index += 2 + length
    raise AssertionError("no frame header")


def test_the_two_default_pictures_are_screen_shaped_jpegs_the_preview_shows_byte_for_byte():
    assert sorted(path.name for path in (WALLPAPER / "wallpapers").iterdir()) == ["day.jpg", "night.jpg"]
    assert sorted(path.name for path in PUBLIC.iterdir()) == ["day.jpg", "night.jpg"]
    for name in ("day.jpg", "night.jpg"):
        data = (WALLPAPER / "wallpapers" / name).read_bytes()
        assert data[:3] == b"\xff\xd8\xff" and len(data) < 200_000
        width, height = jpeg_size(data)
        # The computer zooms it to fill each 1280x900 screen from its centre: at this shape nothing is cut off.
        assert width >= 1280 and height >= 900 and abs(width / height - 1280 / 900) < .005
        assert (PUBLIC / name).read_bytes() == data


def test_the_watcher_and_its_pictures_stay_out_of_what_the_image_build_copies():
    # Any change to a file the image's build copies makes a PC that built the layer before download Chrome again.
    assert not WALLPAPER.resolve().is_relative_to(IMAGE.resolve())
    assert (WALLPAPER / "wallpaper.py").is_file()


def test_an_owner_picture_replaces_the_hourly_choice(monkeypatch):
    picture = Path("/opt/raphael-desktop/wallpapers/own.jpg")
    for hour in (5, 12):
        assert painted(monkeypatch, "--image", str(picture), moment=datetime(2026, 11, 14, hour)) == [str(picture)]


def test_the_session_starts_no_watcher_of_its_own():
    # A watcher started with the session ran beside the core's and put the default picture back over the owner's; one
    # that was already running made the core leave it. The core is the one place a watcher starts.
    script = (IMAGE / "desktop/prepare-desktop").read_text(encoding="utf-8")
    commands = [line for line in script.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    assert commands == ["set -eu", "xfconf-query -c xfce4-session -p /general/SaveOnExit -n -t bool -s false"]
    assert script.startswith("#!/bin/sh\n") and "\r" not in script


def test_startup_sets_the_wallpaper_even_before_xfce_has_a_last_image(monkeypatch):
    apply = runpy.run_path(str(WALLPAPER / "wallpaper.py"))["apply_wallpaper"]
    process = apply.__globals__["subprocess"]
    calls = []
    monkeypatch.setattr(process, "check_output", lambda *a, **kw: "/backdrop/screen0/monitor0/workspace0/image-style\n")
    monkeypatch.setattr(process, "run", lambda argv, **kw: calls.append(argv))
    apply(Path("/opt/raphael-desktop/wallpapers/night.jpg"))
    assert any("/backdrop/screen0/monitor0/workspace0/last-image" in argv and argv[-1] == str(Path("/opt/raphael-desktop/wallpapers/night.jpg")) and "string" in argv for argv in calls)
    assert any("/backdrop/screen0/monitor0/workspace0/image-style" in argv and argv[-1] == "5" for argv in calls)


def test_startup_retries_when_the_desktop_channel_is_not_ready(monkeypatch):
    apply = runpy.run_path(str(WALLPAPER / "wallpaper.py"))["apply_wallpaper"]
    process = apply.__globals__["subprocess"]
    monkeypatch.setattr(process, "check_output", lambda *a, **kw: "")
    with pytest.raises(process.SubprocessError):
        apply(Path("/opt/raphael-desktop/wallpapers/night.jpg"))


def test_timer_leaves_unchanged_workspaces_alone_and_paints_a_late_monitor(monkeypatch):
    apply = runpy.run_path(str(WALLPAPER / "wallpaper.py"))["apply_wallpaper"]
    process = apply.__globals__["subprocess"]
    properties = ["/backdrop/screen0/monitor0/workspace0/image-style"]
    calls = []
    monkeypatch.setattr(process, "check_output", lambda *a, **kw: "\n".join(properties))
    monkeypatch.setattr(process, "run", lambda argv, **kw: calls.append(argv))
    path = Path("/opt/raphael-desktop/wallpapers/night.jpg")
    applied = apply(path, {})
    assert len(calls) == 2
    applied = apply(path, applied)
    assert len(calls) == 2
    properties.append("/backdrop/screen0/monitor1/workspace0/image-style")
    applied = apply(path, applied)
    assert len(calls) == 4
    assert all("/monitor1/" in argv[4] for argv in calls[2:])
    apply(path.with_name("day.jpg"), applied)
    assert len(calls) == 8


def test_packaging_collects_the_python_watcher_and_nested_wallpapers():
    spec = ast.parse((Path(__file__).parents[2] / 'packaging/raphael-core.spec').read_text(encoding='utf-8'))
    collect = next(node for node in ast.walk(spec) if isinstance(node, ast.Call)
                   and isinstance(node.func, ast.Name) and node.func.id == 'collect_data_files'
                   and node.args and ast.literal_eval(node.args[0]) == 'raphael_core.computer')
    options = {keyword.arg: ast.literal_eval(keyword.value) for keyword in collect.keywords}
    assert options.get('include_py_files') is True
    assert {'image/**/*', 'wallpaper/**/*', 'driver_schemas.json'} <= set(options['includes'])


def test_startup_creates_the_image_style_when_only_last_image_exists(monkeypatch):
    apply = runpy.run_path(str(WALLPAPER / 'wallpaper.py'))['apply_wallpaper']
    process = apply.__globals__['subprocess']
    calls = []
    monkeypatch.setattr(process, 'check_output', lambda *a, **kw: '/backdrop/screen0/monitor0/workspace0/last-image\n')
    monkeypatch.setattr(process, 'run', lambda argv, **kw: calls.append(argv))
    apply(Path('/opt/raphael-desktop/wallpapers/night.jpg'))
    style = next(argv for argv in calls if argv[4].endswith('/image-style'))
    assert style[-1] == '5' and style[5:9] == ['-n', '-t', 'int', '-s']
