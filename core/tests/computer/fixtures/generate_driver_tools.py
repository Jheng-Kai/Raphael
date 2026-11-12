"""Turn a measured tools/list into the two files kept with the code.

`core/src/raphael_core/computer/driver_schemas.json`: the offered tools' schemas as the driver gives them, from
which a member is offered its tools before a driver has been asked. `driver_tools_0.37.0.json` here: the same
schemas as the bridge reads them, reduced to what a call is checked against, for the doubles.

From core/: PYTHONPATH=src python tests/computer/fixtures/generate_driver_tools.py <live-tools.json>
The computer acceptance writes a list to feed it (driver-tools.json in its --out folder).
"""

import json
from pathlib import Path
import sys

from raphael_core.computer.vm_bridge import normalize_schema
from raphael_core.computer.vm_catalog import DRIVER_TOOLS


def reduce_schema(schema):
    if isinstance(schema, list):
        return [reduce_schema(value) for value in schema]
    if not isinstance(schema, dict):
        return schema
    # Recurse only into schemas: names and literal values must keep annotation-like keys.
    mappings = {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas"}
    arrays = {"allOf", "anyOf", "oneOf", "prefixItems"}
    singles = {"items", "additionalItems", "additionalProperties", "unevaluatedItems", "unevaluatedProperties",
               "contains", "not", "if", "then", "else", "propertyNames", "contentSchema"}
    result = {}
    for key, value in schema.items():
        if key in ("description", "title", "$comment", "examples"):
            continue
        if key in mappings:
            value = {name: reduce_schema(child) for name, child in value.items()}
        elif key in arrays or key in singles:
            value = reduce_schema(value)
        elif key == "dependencies":
            value = {name: reduce_schema(child) if isinstance(child, dict) else child for name, child in value.items()}
        result[key] = value
    # Keep the existing fixture's ordering so added constraints remain a small diff.
    nested = ("properties", "items", "anyOf", "oneOf", "allOf")
    return {**{key: value for key, value in result.items() if key not in nested},
            **{key: result[key] for key in nested if key in result}}


def listed(source):
    """Each offered tool's schema as the driver gives it. A list taken through the bridge carries that beside the
    bridge's own reading of it (originalInputSchema, inputSchema); one taken from the driver has it alone."""
    tools = {tool["name"]: tool for tool in json.loads(source.read_text(encoding="utf-8"))}
    return {name: tools[name].get("originalInputSchema", tools[name]["inputSchema"]) for name in DRIVER_TOOLS}


def generate(source):
    return {name: reduce_schema(normalize_schema(schema)) for name, schema in listed(source).items()}


def snapshot(source):
    """The offered tools' schemas exactly as given, key order included: what is offered before a driver is asked
    has to be what the driver then lists, or a member's tool list changes at its first use of the computer."""
    return {"driver": "cua-driver 0.37.0 (Linux)",
            "source": "tools/list of the driver in Raphael's computer image, captured from a running computer.",
            "verification": "The computer acceptance compares a running driver's list with this file (driver schema).",
            "tools": listed(source)}


if __name__ == "__main__":
    source = Path(sys.argv[1])
    Path(__file__).with_name("driver_tools_0.37.0.json").write_text(
        json.dumps(generate(source), indent=2) + "\n", encoding="utf-8")
    (Path(__file__).resolve().parents[3] / "src/raphael_core/computer/driver_schemas.json").write_text(
        json.dumps(snapshot(source), indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
