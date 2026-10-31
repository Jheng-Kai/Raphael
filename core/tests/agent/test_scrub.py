import time

import pytest

from raphael_core.failures import scrub


def test_a_long_tool_result_does_not_block_context_compaction():
    text = "m" * 20_000
    started = time.monotonic()
    assert scrub(text) == text
    assert time.monotonic() - started < 1


@pytest.mark.parametrize("name", ["api_key", "access-token", "clientSecret", "password", "authorization", "cookie"])
def test_credential_names_still_redact_the_value(name):
    assert scrub(f'{name}="private-value"') == f'{name}=[redacted]'
