"""Measured input validation for every computer-driver double, including subclass overrides."""

from copy import deepcopy
from functools import wraps
import json
from pathlib import Path

from jsonschema import Draft202012Validator
import pytest

from raphael_core.computer import vm_catalog

SCHEMAS = json.loads(Path(__file__).with_name("driver_tools_0.37.0.json").read_text(encoding="utf-8"))
# The same capture as the driver gives it: what a member is offered before a driver is asked is read from this.
KEPT = json.loads(Path(vm_catalog.__file__).with_name("driver_schemas.json").read_text(encoding="utf-8"))["tools"]
# Several measured page schemas allow extras. Keep that evidence intact in the fixture,
# but make doubles fail on any unreviewed argument, as the acceptance contract requires.
VALIDATORS = {name: Draft202012Validator({**schema, "additionalProperties": False}) for name, schema in SCHEMAS.items()}


def validate_call(method, params):
    if method != "tools/call" or params["name"] not in VALIDATORS:
        return
    error = next(VALIDATORS[params["name"]].iter_errors(params["arguments"]), None)
    if error:
        # pytest failure must not be swallowed by product transport/vault exception handling.
        pytest.fail(f"Real driver would refuse {params['name']}: {error.message}")


def runtime_refusal(method, params):
    """Measured semantic refusals that JSON Schema alone does not express."""
    if method != "tools/call":
        return None
    name, args = params["name"], params["arguments"]
    if name == "get_browser_state" and args.get("target_id") and not args.get("tab_id"):
        message = "confirmation provider failed: the browser operation requires an exact tab_id"
        return {"isError": True, "content": [{"type": "text", "text": message}],
                "structuredContent": {"status": "refused", "refusal": {"code": "authorization_host_failed"}}}
    if name == "browser_navigate":
        from urllib.parse import urlsplit
        if urlsplit(args["url"]).scheme.lower() not in ("http", "https", "about"):
            return {"isError": True, "content": [{"type": "text", "text": "only accepts http/https/about URLs"}]}
    return None


def checked_request(request):
    @wraps(request)
    async def checked(self, method, params=None, *args, **kwargs):
        validate_call(method, params)
        refusal = runtime_refusal(method, params)
        if refusal:
            return refusal
        return await request(self, method, params, *args, **kwargs)
    return checked


def catalog(names=None):
    """The bridge's answer to tools/list for the offered tools, as the pinned driver gives them: the driver's own
    words for each, the session parameter, the schema it checks a call against and the bridge's reading of it. In
    the driver's order, which is not the order they are kept in."""
    from raphael_core.computer.vm_bridge import normalize_schema
    return {"tools": [{"name": name, "description": f"The driver's own words about {name}.",
                       "inputSchema": normalize_schema(deepcopy(schema)), "originalInputSchema": deepcopy(schema)}
                      for name, schema in reversed(KEPT.items()) if names is None or name in names]}


async def bind_page(hub, target, *, pid=1, window_id=1):
    """Establish a real core binding in shared fake-browser journeys before using target-only calls."""
    client, session = await hub._connection(target)
    reply = await hub._driver_call(target, client, "get_browser_state", dict(pid=pid, window_id=window_id, session=session))
    assert not reply.get("isError"), reply
    assert reply["structuredContent"]["target_id"]


def window_reply(target):
    from raphael_core.computer.vm import screen_grid
    state = {"windows": [dict(window_id=number, pid=number, title="Terminal", app_name="Xfce4-terminal",
                bounds=dict(x=x + 20, y=y + 20, width=600, height=400))
                for number, (x, y, _, _) in enumerate(screen_grid(target.screens)[0], 1)]}
    return {"structuredContent": state, "content": [{"type": "text", "text": json.dumps(state)}]}
