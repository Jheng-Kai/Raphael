"""Reduce a measured tools/list to the validation contract of the offered tools.

From core/: PYTHONPATH=src python tests/computer/fixtures/generate_driver_tools.py <live-tools.json>
"""

import json
from pathlib import Path
import sys

from raphael_core.computer.vm_catalog import DRIVER_TOOLS


def reduce_schema(schema):
    result = {key: value for key, value in schema.items()
              if key in ("type", "enum", "required", "additionalProperties", "const")}
    if "properties" in schema:
        result["properties"] = {key: reduce_schema(value) for key, value in schema["properties"].items()}
    if "items" in schema:
        result["items"] = reduce_schema(schema["items"])
    for key in ("anyOf", "oneOf", "allOf"):
        if key in schema:
            result[key] = [reduce_schema(value) for value in schema[key]]
    return result


def generate(source):
    tools = {tool["name"]: tool for tool in json.loads(source.read_text(encoding="utf-8"))}
    return {name: reduce_schema(tools[name]["inputSchema"]) for name in DRIVER_TOOLS}


if __name__ == "__main__":
    Path(__file__).with_name("driver_tools_0.37.0.json").write_text(
        json.dumps(generate(Path(sys.argv[1])), indent=2) + "\n", encoding="utf-8")
