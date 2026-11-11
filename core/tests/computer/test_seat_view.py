"""Measured window shapes and seat coordinates, without driver or container I/O."""

from copy import deepcopy

import pytest

from raphael_core.computer.seat_view import holder, mine, rectangle, to_canvas, to_seat, windows, windows_text


@pytest.mark.parametrize("screens,origins", [
    (1, [(0, 0)]),
    (2, [(0, 0), (1280, 0)]),
    (3, [(0, 0), (1280, 0), (0, 900)]),
    (4, [(0, 0), (1280, 0), (0, 900), (1280, 900)]),
    (5, [(0, 0), (1280, 0), (2560, 0), (0, 900), (1280, 900)]),
    (6, [(0, 0), (1280, 0), (2560, 0), (0, 900), (1280, 900), (2560, 900)]),
])
def test_rectangles_and_window_centres_follow_the_real_screen_grid(screens, origins):
    for screen, (x, y) in enumerate(origins, 1):
        assert rectangle(screen, screens) == (x, y, 1280, 900)
        assert holder((x, y, 1280, 900), screens) == screen
        assert holder({"x": x + 10, "y": y + 20, "width": 100, "height": 80}, screens) == screen


@pytest.mark.parametrize("screen,screens", [(0, 1), (2, 1), (-1, 6), (7, 6), (1, 0), (1, 7), (1, -1),
                                          (True, 1), (1, True), (1.0, 2), (1, 2.0)])
def test_rectangle_rejects_invalid_screens(screen, screens):
    with pytest.raises(ValueError):
        rectangle(screen, screens)


@pytest.mark.parametrize("bounds,screens,expected", [
    ((1278, 10, 2, 2), 6, 1),
    ((1279, 10, 2, 2), 6, 2),
    ((2559, 10, 2, 2), 6, 3),
    ((10, 898, 2, 2), 6, 1),
    ((10, 899, 2, 2), 6, 4),
    ((1279, 899, 2, 2), 6, 5),
    ((2559, 899, 2, 2), 6, 6),
    ((-1, -1, 2, 2), 6, 1),
    ((-2, 10, 2, 2), 6, None),
    ((10, -2, 2, 2), 6, None),
    ((3839, 10, 2, 2), 6, None),
    ((10, 1799, 2, 2), 6, None),
    ((1279, 899, 2, 2), 3, None),
    ((2559, 899, 2, 2), 5, None),
    ((1500, 1000, 100, 100), 3, None),
    ((2700, 1000, 100, 100), 5, None),
])
def test_holder_uses_half_open_edges_and_excludes_empty_cells_and_off_canvas(bounds, screens, expected):
    assert holder(bounds, screens) == expected


@pytest.mark.parametrize("screens", [0, 7, True, 1.5])
def test_holder_rejects_invalid_screen_counts(screens):
    with pytest.raises(ValueError):
        holder((0, 0, 10, 10), screens)


@pytest.mark.parametrize("screens", range(1, 7))
def test_coordinate_round_trip_and_half_open_pointer_boundaries(screens):
    for screen in range(1, screens + 1):
        left, top, _, _ = rectangle(screen, screens)
        for point in ((0, 0), (1279, 899), (12.5, 20.5)):
            canvas = to_canvas(screen, screens, *point)
            assert canvas == (left + point[0], top + point[1])
            assert to_seat(screen, screens, *canvas) == point
        for x, y in ((-1, 0), (0, -1), (1280, 0), (0, 900)):
            assert to_seat(screen, screens, left + x, top + y) is None


def test_coordinate_conversion_does_not_clamp_seat_coordinates():
    assert to_canvas(5, 6, -80, 950) == (1200, 1850)
    assert to_seat(5, 6, 1200, 1850) is None
    for convert in (to_canvas, to_seat):
        with pytest.raises(ValueError):
            convert(7, 6, 0, 0)


def window(ident, x, y, width, height, *, title="about:blank - Chromium", app="Chromium-browser", pid=695, z=9):
    return {"app_name": app, "bounds": {"x": x, "y": y, "width": width, "height": height},
            "x": x, "y": y, "width": width, "height": height, "is_on_screen": True,
            "pid": pid, "title": title, "window_id": ident, "z_index": z, "extra": {"kept": [ident]}}


@pytest.fixture
def canvas():
    panels = [window(100 + screen, x + 567, y + 851, 146, 49, title="xfce4-panel", app="Xfce4-panel", pid=600)
              for screen, (x, y) in enumerate(((0, 0), (1280, 0), (2560, 0), (0, 900), (1280, 900), (2560, 900)), 1)]
    return {"windows": [window(1, 0, 0, 3840, 1800, title="Desktop", app="Xfdesktop"),
                        *panels, window(27262979, 10, 10, 1050, 831),
                        window(22, 2700, 1000, 1050, 831, pid=700),
                        window(23, 1200, 50, 200, 400)],
            "metadata": {"source": "measured shape"}}


def test_six_screen_windows_keep_only_their_panel_and_owned_windows_in_order(canvas):
    expected = {1: [101, 27262979], 2: [102, 23], 3: [103], 4: [104], 5: [105], 6: [106, 22]}
    for screen, ids in expected.items():
        local = windows(canvas, screen, 6)
        assert [item["window_id"] for item in local["windows"]] == ids
        assert [item["z_index"] for item in local["windows"]] == list(range(len(ids)))
        assert local["metadata"] == canvas["metadata"]
        left, top, _, _ = rectangle(screen, 6)
        for actual in local["windows"]:
            original = next(item for item in canvas["windows"] if item["window_id"] == actual["window_id"])
            expected_window = deepcopy(original)
            expected_window["bounds"]["x"] -= left
            expected_window["bounds"]["y"] -= top
            expected_window["x"] -= left
            expected_window["y"] -= top
            expected_window["z_index"] = actual["z_index"]
            assert actual == expected_window


def test_straddling_window_keeps_negative_or_overflowing_coordinates(canvas):
    local = windows(canvas, 2, 6)["windows"][-1]
    assert local["x"] == local["bounds"]["x"] == -80
    assert local["width"] == 200
    result = {"windows": [window(8, 1200, 850, 100, 140)]}
    local = windows(result, 4, 6)["windows"][0]
    assert (local["x"], local["y"]) == (1200, -50)
    assert local["x"] + local["width"] > 1280


def test_projection_does_not_mutate_the_input_or_share_mutable_output_fields(canvas):
    before = deepcopy(canvas)
    local = windows(canvas, 1, 6)
    assert canvas == before
    local["metadata"]["source"] = "changed"
    local["windows"][0]["bounds"]["x"] = 999
    local["windows"][0]["extra"]["kept"].clear()
    assert canvas == before


@pytest.mark.parametrize("screens,width,empty_x", [(3, 2560, 1500), (5, 3840, 2700)])
def test_empty_grid_cells_and_the_whole_canvas_root_belong_to_no_seat(screens, width, empty_x):
    result = {"windows": [window(1, 0, 0, width, 1800, app="Any-root-app"),
                          window(2, empty_x, 1000, 100, 100), window(3, -200, 10, 100, 100)]}
    for screen in range(1, screens + 1):
        assert windows(result, screen, screens) == {"windows": []}
        assert not mine(1, result, screen, screens)
        assert not mine(2, result, screen, screens)


def test_single_screen_root_is_excluded_even_though_its_centre_is_in_the_seat():
    result = {"windows": [window(1, 0, 0, 1280, 900, title="Desktop", app="Xfdesktop"), window(2, 10, 10, 40, 40)]}
    assert [item["window_id"] for item in windows(result, 1, 1)["windows"]] == [2]


def test_window_text_matches_the_measured_driver_line_and_signed_coordinates(canvas):
    assert windows_text({"windows": [canvas["windows"][7]]}) == (
        'Found 1 windows:\n  window_id=27262979 pid=695 "about:blank - Chromium" '
        '1050x831+10+10 app=Chromium-browser')
    assert windows_text(windows(canvas, 2, 6)) == (
        'Found 2 windows:\n  window_id=102 pid=600 "xfce4-panel" 146x49+567+851 app=Xfce4-panel\n'
        '  window_id=23 pid=695 "about:blank - Chromium" 200x400-80+50 app=Chromium-browser')
    assert windows_text({"windows": []}) == "Found 0 windows:"


def test_mine_refuses_other_seats_the_root_and_unknown_ids(canvas):
    assert mine(27262979, canvas, 1, 6)
    assert not mine(27262979, canvas, 2, 6)
    assert mine(23, canvas, 2, 6)
    assert not mine(23, canvas, 1, 6)
    assert mine(106, canvas, 6, 6)
    assert not mine(106, canvas, 5, 6)
    assert not mine(1, canvas, 5, 6)
    assert not mine(999, canvas, 1, 6)


def test_windows_and_mine_validate_the_seat_even_for_empty_results():
    for operation in (lambda: windows({"windows": []}, 7, 6), lambda: mine(1, {"windows": []}, 0, 6)):
        with pytest.raises(ValueError):
            operation()
