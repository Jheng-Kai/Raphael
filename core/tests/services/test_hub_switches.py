"""The switches of the capabilities in `services.status`: each capability says whether it is on, and
the status follows the settings."""

from .test_hub import Rig, rig  # noqa: F401

CAPABILITIES = {
    "search": "web_search_enabled",
    "read": "web_read_enabled",
    "pdf": "pdf_enabled",
    "vision": "vision_enabled",
}


async def test_the_status_says_which_capabilities_are_on(rig):
    status = await rig.call("services.status")
    assert {name: status[name]["enabled"] for name in CAPABILITIES} == {
        "search": True, "read": True, "pdf": True, "vision": True,
    }  # fmt: skip


async def test_the_status_follows_each_switch(rig):
    for name, key in CAPABILITIES.items():
        before = (await rig.call("services.status"))[name]["enabled"]
        rig.settings.set(key, not before)
        assert (await rig.call("services.status"))[name]["enabled"] is (not before)
        assert rig.hub.enabled(name) is (not before)


# --- what self_check's setup says (#316) ----------------------------------------------------------


def test_a_vision_tool_that_is_on_but_cannot_see_is_a_setup_gap(rig):
    rig.hub.vision.ready = lambda: False
    gaps = rig.hub.setup_gaps()
    assert {"tool": "vision", "missing": "model", "where": "Settings > Tools > See images"} in gaps
    # Once it can see, or once the owner turns it off, it is no gap.
    rig.hub.vision.ready = lambda: True
    assert all(gap["tool"] != "vision" for gap in rig.hub.setup_gaps())
    rig.hub.vision.ready = lambda: False
    rig.settings.set("vision_enabled", False)
    assert all(gap["tool"] != "vision" for gap in rig.hub.setup_gaps())


def test_a_search_with_no_service_and_a_reader_without_its_key_are_setup_gaps(rig):
    rig.hub._openrouter_ready = lambda: False
    rig.settings.set("web_read_service", "firecrawl")
    gaps = {gap["tool"]: gap for gap in rig.hub.setup_gaps()}
    assert gaps["search"]["missing"] == "service"
    assert gaps["read"] == {"tool": "read", "missing": "key", "where": "Settings > Tools > Read web pages"}
    rig.keys.set("brave", "b-key")
    rig.keys.set("firecrawl", "f-key")
    assert {gap["tool"] for gap in rig.hub.setup_gaps()} & {"search", "read"} == set()


def test_vision_is_ready_only_with_a_model_that_is_not_known_to_be_blind(rig):
    from raphael_core.services.vision import Vision
    assert Vision(object(), lambda: ("", None)).ready() is False
    assert Vision(object(), lambda: ("some/model", False)).ready() is False
    assert Vision(object(), lambda: ("some/model", None)).ready() is True
