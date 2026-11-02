import runpy
import ast
from pathlib import Path

import pytest


DESKTOP = Path(__file__).parents[2] / "src/raphael_core/computer/image/desktop"


@pytest.mark.parametrize("hour,expected", [(0, "night"), (5, "night"), (6, "morning"), (10, "morning"), (11, "noon"), (15, "noon"), (16, "dusk"), (18, "dusk"), (19, "evening"), (21, "evening"), (22, "night"), (23, "night")])
def test_wallpaper_follows_the_guest_local_hour(hour, expected):
    choose = runpy.run_path(str(DESKTOP / "wallpaper.py"))["wallpaper_for_hour"]
    assert choose(hour) == f"{expected}.svg"


def test_wallpaper_assets_are_deterministic_and_shared_with_the_panel():
    generate = runpy.run_path(str(DESKTOP / "wallpaper.py"))["wallpapers"]
    assets = generate()
    assert len(assets) == 5
    for name, content in assets.items():
        assert (DESKTOP / "wallpapers" / name).read_text(encoding="utf-8") == content
        assert (DESKTOP.parents[5] / "app/public/wallpapers" / name).read_text(encoding="utf-8") == content
        assert len(content.encode()) < 3000


def test_startup_sets_the_wallpaper_even_before_xfce_has_a_last_image(monkeypatch):
    apply = runpy.run_path(str(DESKTOP / "wallpaper.py"))["apply_wallpaper"]
    process = apply.__globals__["subprocess"]
    calls = []
    monkeypatch.setattr(process, "check_output", lambda *a, **kw: "/backdrop/screen0/monitor0/workspace0/image-style\n")
    monkeypatch.setattr(process, "run", lambda argv, **kw: calls.append(argv))
    apply(Path("/opt/raphael-desktop/wallpapers/night.svg"))
    assert any("/backdrop/screen0/monitor0/workspace0/last-image" in argv and argv[-1] == str(Path("/opt/raphael-desktop/wallpapers/night.svg")) and "string" in argv for argv in calls)
    assert any("/backdrop/screen0/monitor0/workspace0/image-style" in argv and argv[-1] == "5" for argv in calls)


def test_startup_retries_when_the_desktop_channel_is_not_ready(monkeypatch):
    apply = runpy.run_path(str(DESKTOP / "wallpaper.py"))["apply_wallpaper"]
    process = apply.__globals__["subprocess"]
    monkeypatch.setattr(process, "check_output", lambda *a, **kw: "")
    with pytest.raises(process.SubprocessError):
        apply(Path("/opt/raphael-desktop/wallpapers/night.svg"))


def test_timer_leaves_unchanged_workspaces_alone_and_paints_a_late_monitor(monkeypatch):
    apply = runpy.run_path(str(DESKTOP / "wallpaper.py"))["apply_wallpaper"]
    process = apply.__globals__["subprocess"]
    properties = ["/backdrop/screen0/monitor0/workspace0/image-style"]
    calls = []
    monkeypatch.setattr(process, "check_output", lambda *a, **kw: "\n".join(properties))
    monkeypatch.setattr(process, "run", lambda argv, **kw: calls.append(argv))
    path = Path("/opt/raphael-desktop/wallpapers/night.svg")
    applied = apply(path, {})
    assert len(calls) == 2
    applied = apply(path, applied)
    assert len(calls) == 2
    properties.append("/backdrop/screen0/monitor1/workspace0/image-style")
    applied = apply(path, applied)
    assert len(calls) == 4
    assert all("/monitor1/" in argv[4] for argv in calls[2:])
    apply(path.with_name("morning.svg"), applied)
    assert len(calls) == 8


def test_packaging_collects_the_python_watcher_and_nested_wallpapers():
    spec = ast.parse((Path(__file__).parents[2] / 'packaging/raphael-core.spec').read_text(encoding='utf-8'))
    collect = next(node for node in ast.walk(spec) if isinstance(node, ast.Call)
                   and isinstance(node.func, ast.Name) and node.func.id == 'collect_data_files'
                   and node.args and ast.literal_eval(node.args[0]) == 'raphael_core.computer')
    options = {keyword.arg: ast.literal_eval(keyword.value) for keyword in collect.keywords}
    assert options.get('include_py_files') is True
    assert options['includes'] == ['image/**/*']


def test_startup_creates_the_image_style_when_only_last_image_exists(monkeypatch):
    apply = runpy.run_path(str(DESKTOP / 'wallpaper.py'))['apply_wallpaper']
    process = apply.__globals__['subprocess']
    calls = []
    monkeypatch.setattr(process, 'check_output', lambda *a, **kw: '/backdrop/screen0/monitor0/workspace0/last-image\n')
    monkeypatch.setattr(process, 'run', lambda argv, **kw: calls.append(argv))
    apply(Path('/opt/raphael-desktop/wallpapers/night.svg'))
    style = next(argv for argv in calls if argv[4].endswith('/image-style'))
    assert style[-1] == '5' and style[5:9] == ['-n', '-t', 'int', '-s']
