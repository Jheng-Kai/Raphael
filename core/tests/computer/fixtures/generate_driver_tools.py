"""Reduce a measured tools/list to the validation contract of the offered tools.

From core/: PYTHONPATH=src python tests/computer/fixtures/generate_driver_tools.py <live-tools.json>
"""

import json
from pathlib import Path
import sys

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


def generate(source):
    tools = {tool["name"]: tool for tool in json.loads(source.read_text(encoding="utf-8"))}
    return {name: reduce_schema(tools[name]["inputSchema"]) for name in DRIVER_TOOLS}


if __name__ == "__main__":
    Path(__file__).with_name("driver_tools_0.37.0.json").write_text(
        json.dumps(generate(Path(sys.argv[1])), indent=2) + "\n", encoding="utf-8")
