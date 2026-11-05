"""Diagnostic text cannot retain quoted or Basic-auth credentials."""

import pytest

from raphael_core import failures
from raphael_core.agent.cli import native_diagnostics


@pytest.mark.parametrize("redact", [failures.redact, native_diagnostics.redact])
@pytest.mark.parametrize("text,private", [
    ('permission denied; Authorization: Basic dTpw', "dTpw"),
    ('permission denied; password="first second third"', "second"),
    ('permission denied; {"password":"first\\\"second"}', "second"),
    ("permission denied; password='first\\'second'", "second"),
])
def test_diagnostic_credentials_are_removed_as_complete_values(redact, text, private):
    result = redact(text)
    assert "permission denied" in result
    assert private not in result


@pytest.mark.parametrize("redact", [failures.redact, native_diagnostics.redact])
def test_known_secrets_are_redacted_in_json_escaped_diagnostics(redact):
    import json
    secret = 'synthetic-"private\\value'
    result = redact(json.dumps({"message": secret}), secrets=[secret])
    assert "private" not in result


def test_overlapping_known_secrets_never_leave_a_suffix():
    assert "suffix" not in failures.redact("shared-prefix-suffix", secrets=["shared-prefix", "shared-prefix-suffix"])
