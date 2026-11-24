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
    assert {"tool": "vision", "missing": "model", "where": "Settings > Tools > Services > Images"} in gaps
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
    assert gaps["search"] == {"tool": "search", "missing": "service", "where": "Settings > Tools > Services > Web search"}
    assert gaps["read"] == {"tool": "read", "missing": "key", "where": "Settings > Tools > Services > Read web pages"}
    rig.keys.set("brave", "b-key")
    rig.keys.set("firecrawl", "f-key")
    assert {gap["tool"] for gap in rig.hub.setup_gaps()} & {"search", "read"} == set()


def test_vision_is_ready_only_with_a_model_that_is_not_known_to_be_blind(rig):
    from raphael_core.services.vision import Vision
    assert Vision(object(), lambda: ("", None)).ready() is False
    assert Vision(object(), lambda: ("some/model", False)).ready() is False
    assert Vision(object(), lambda: ("some/model", None)).ready() is True


def test_a_chosen_search_service_whose_key_is_not_stored_is_a_setup_gap(rig):
    rig.hub._openrouter_ready = lambda: False
    rig.settings.set("web_search_service", "brave")
    gap = {"tool": "search", "missing": "key", "where": "Settings > Tools > Services > Web search"}
    assert gap in rig.hub.setup_gaps()
    # The key is stored: no gap. The key is cleared again: the gap is back, the same as the search's own `missing_secret`.
    rig.keys.set("brave", "b-key")
    assert all(entry["tool"] != "search" for entry in rig.hub.setup_gaps())
    rig.keys.clear("brave")
    assert gap in rig.hub.setup_gaps()
    # A search that is off, or a service that needs no key, is no gap.
    rig.settings.set("web_search_enabled", False)
    assert all(entry["tool"] != "search" for entry in rig.hub.setup_gaps())
    rig.settings.set("web_search_enabled", True)
    rig.settings.set("web_search_service", "searxng")
    assert gap not in rig.hub.setup_gaps()
    # The chosen OpenRouter search with no OpenRouter key is a gap as well.
    rig.settings.set("web_search_service", "openrouter")
    assert gap in rig.hub.setup_gaps()
