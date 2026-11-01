"""Decode the single-read Composio envelope and retain its original result path."""

import json


def unwrap_read(result):
    data = (result.mcp_result or {}).get("structuredContent")
    if data is None:
        data = json.loads(result.text)
    return unwrap_envelope(data)


def unwrap_envelope(value):
    def checked(data):
        if (not isinstance(data, (dict, list)) or isinstance(data, dict) and (
                data.get("successful") is False or data.get("error") or data.get("error_count", 0) > 0)):
            raise ValueError("response")
        return data

    outer = checked(value)
    data = checked(outer["data"])
    results = data["results"]
    if not isinstance(results, list) or len(results) != 1:
        raise ValueError("response")
    response = checked(results[0]["response"])
    payload = checked(response["data"])
    path = "data.results.0.response.data"
    if isinstance(payload, dict) and "response_data" in payload:
        payload = checked(payload["response_data"])
        path += ".response_data"
    return payload, path
