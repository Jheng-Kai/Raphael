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
