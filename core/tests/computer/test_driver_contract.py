"""A driver upgrade must be reviewed in the single shared-argument table."""

from pathlib import Path

from jsonschema import Draft202012Validator
import pytest

from raphael_core.computer.vm_catalog import DRIVER_TOOLS, SHARED_ARGUMENTS, shared_native_input
from .fixtures.driver_contract import SCHEMAS, validate_call
from .fixtures.generate_driver_tools import generate


def test_every_live_parameter_has_one_reviewed_shared_disposition():
    def paths(schema, prefix=""):
        for key, child in schema.get("properties", {}).items():
            yield prefix + key
            yield from paths(child, prefix + key + ".")
            if "items" in child:
                yield from paths(child["items"], prefix + key + "[].")
    assert SCHEMAS.keys() == SHARED_ARGUMENTS.keys() == DRIVER_TOOLS.keys()
    for name, schema in SCHEMAS.items():
        Draft202012Validator.check_schema(schema)
        assert isinstance(schema["additionalProperties"], bool)
        assert set(paths(schema)) == SHARED_ARGUMENTS[name].keys(), name
        assert set(SHARED_ARGUMENTS[name].values()) <= {"pass", "check", "translate", "refuse"}


def test_generator_reproduces_the_measured_fixture_when_source_is_present():
    root = Path(__file__).resolve().parents[3]
    source = root / "research/shared-computer/live-tools-0.37.0.json"
    if not source.exists():
        source = root.parent.parent / "research/shared-computer/live-tools-0.37.0.json"
    if not source.exists():
        pytest.skip("Measured research source is outside this checkout")
    assert generate(source) == SCHEMAS


@pytest.mark.parametrize("args", [dict(target_id="own", ref="field", text="value"),
    dict(target_id="own", tab_id="tab", ref="field", text="value", cursor_id="extra"),
    dict(target_id="own", tab_id="tab", ref="field", text="value", mode="unknown")])
def test_fake_rejects_real_driver_required_unknown_and_enum_errors(args):
    with pytest.raises(pytest.fail.Exception, match="Real driver would refuse"):
        validate_call("tools/call", dict(name="browser_type", arguments=args))


async def test_catalog_bridge_subclass_cannot_bypass_validation_by_overriding_request():
    from .test_vm import CatalogBridge
    class Override(CatalogBridge):
        async def request(self, method, params=None):
            return {}
    client = Override(None, None)
    with pytest.raises(pytest.fail.Exception, match="Real driver would refuse browser_type"):
        await client.request("tools/call", dict(name="browser_type", arguments=dict(ref="field", text="private")))


@pytest.mark.parametrize("name,args,expected", [
    ("browser_click", {"input_route": "trusted", "delivery_mode": "foreground"}, True),
    ("browser_click", {"input_route": "dom_event", "delivery_mode": "foreground"}, True),
    ("browser_click", {"input_route": "dom_event", "delivery_mode": "background"}, False),
    ("browser_pointer", {"action": "drag", "delivery_mode": "foreground"}, True),
    ("browser_dialog", {"action": "accept", "delivery_mode": "foreground"}, True),
    ("browser_dialog", {"action": "dismiss", "delivery_mode": "foreground"}, True),
    ("browser_dialog", {"action": "inspect"}, False),
    ("browser_navigate", {}, False), ("browser_type", {}, False),
])
def test_input_posture_includes_foreground_page_routes_and_dialog_resolution(name, args, expected):
    assert shared_native_input(name, args) is expected


@pytest.mark.parametrize("name,args", [
    ("scroll", dict(pid=1, window_id=1, direction="down", amount=51)),
    ("get_window_state", dict(pid=1, window_id=1, max_elements=0)),
    ("click", dict(pid=1, window_id=1, element_token="wrong")),
])
def test_full_measured_schema_and_fixture_both_refuse_invalid_constraints(name, args):
    import json
    # The fixture must still reject these calls even on a checkout without the research source.
    with pytest.raises(pytest.fail.Exception, match="Real driver would refuse"):
        validate_call("tools/call", dict(name=name, arguments=args))
    root = Path(__file__).resolve().parents[3]
    source = root.parent.parent / "research/shared-computer/live-tools-0.37.0.json"
    if not source.exists():
        source = root / "research/shared-computer/live-tools-0.37.0.json"
    if not source.exists():
        pytest.skip("Measured research source is outside this checkout")
    live = {tool["name"]: tool["inputSchema"] for tool in json.loads(source.read_text(encoding="utf-8"))}
    assert not Draft202012Validator(live[name]).is_valid(args)


def test_reducer_preserves_validation_keywords_boolean_schemas_and_literal_data():
    from .fixtures.generate_driver_tools import reduce_schema
    schema = dict(description="Remove prose", properties={"description": {"minLength": 2, "description": "Remove"}},
        additionalProperties=False, const={"description": "literal"}, enum=[{"title": "literal"}],
        **{"$defs": {"title": {"pattern": "^x$"}}, "not": {"required": ["blocked"]},
           "prefixItems": [False, {"maximum": 3}], "dependentRequired": {"title": ["description"]}})
    reduced = reduce_schema(schema)
    assert "description" not in reduced
    assert reduced["properties"] == {"description": {"minLength": 2}}
    for key in schema.keys() - {"description", "properties"}:
        assert reduced[key] == schema[key]


@pytest.mark.parametrize("name,args,message", [
    ("get_browser_state", {"target_id": "own"}, "confirmation provider failed: the browser operation requires an exact tab_id"),
    ("browser_navigate", {"target_id": "own", "tab_id": "tab", "url": "data:text/html,hi"}, "only accepts http/https/about URLs"),
])
async def test_browser_fakes_return_measured_semantic_refusals(name, args, message):
    from .test_vm import CatalogBridge
    reply = await CatalogBridge(None, None).request("tools/call", dict(name=name, arguments=args))
    assert reply["isError"] and reply["content"][0]["text"] == message
    if name == "get_browser_state":
        assert reply["structuredContent"]["refusal"]["code"] == "authorization_host_failed"
