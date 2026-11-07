"""Validate one unambiguous structured result without treating quoted examples as replies."""

import json
import jsonschema


def structured_object(text, schema):
    decoder = json.JSONDecoder()
    candidates = []
    cursor = 0
    while (start := text.find("{", cursor)) >= 0:
        try:
            value, end = decoder.raw_decode(text, start)
        except ValueError:
            cursor = start + 1
            continue
        cursor = end
        if isinstance(value, dict):
            try:
                jsonschema.validate(value, schema)
            except jsonschema.ValidationError:
                continue
            candidates.append(value)
    if len(candidates) != 1:
        raise ValueError("Expected one schema-valid result")
    return candidates[0]
