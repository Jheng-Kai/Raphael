"""A page the chosen reader could not read is read once more by the next reader the owner set up (R-PERSIST-06, after
Hermes Agent's rescue of a failed extract). A reader is a service: the model never changes. No request leaves the test."""

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.services import hub as hub_module
from raphael_core.services.common import ServiceError
from raphael_core.services.hub import ServiceHub, offline_transport
from raphael_core.services.keys import memory_keys


class Readers:
    """Plays the readers: each service either fails with a kind or returns a page, and every call is recorded."""

    def __init__(self, **outcomes):
        self.outcomes, self.calls = outcomes, []

    async def read(self, service, url, **kwargs):
        self.calls.append(service)
        outcome = self.outcomes.get(service, "ok")
        if outcome != "ok":
            raise ServiceError(outcome)
        return {"title": "News", "text": f"read by {service}", "truncated": False}


@pytest.fixture
def setup(conn, monkeypatch):
    def make(**outcomes):
        readers = Readers(**outcomes)
        monkeypatch.setattr(hub_module.web, "read", readers.read)
        keys = memory_keys()
        hub = ServiceHub(conn, object(), keys, transport=offline_transport())
        return hub, keys, readers
    return make


async def test_the_built_in_reader_that_fails_is_followed_once_by_the_reader_the_owner_has_a_key_for(setup):
    hub, keys, readers = setup(builtin="timeout")
    keys.set("jina", "jina-the-owners-key-0123456789")
    service, page = await hub.read("https://news.example/a")
    assert (service, page["text"]) == ("jina", "read by jina")
    assert page["reader_fallback"] == {"chosen": "builtin", "failed": "timeout"}
    assert readers.calls == ["builtin", "jina"]
    readers.outcomes["builtin"] = "ok"
    assert (await hub.read("https://news.example/b"))[0] == "builtin"  # the next read goes to the chosen reader again


async def test_with_no_other_reader_set_up_the_url_goes_to_no_service_and_the_first_failure_stands(setup):
    hub, _, readers = setup(builtin="http_error")
    with pytest.raises(ServiceError) as failed:
        await hub.read("https://news.example/a")
    assert failed.value.kind == "http_error" and readers.calls == ["builtin"]


async def test_a_reading_service_that_fails_is_followed_by_the_built_in_reader(setup, conn):
    hub, keys, readers = setup(firecrawl="credits")
    keys.set("firecrawl", "fc-the-owners-key-0123456789")
    SettingsStore(conn).set("web_read_service", "firecrawl")
    service, page = await hub.read("https://news.example/a")
    assert service == "builtin" and page["reader_fallback"] == {"chosen": "firecrawl", "failed": "credits"}


async def test_when_both_fail_the_first_readers_failure_is_what_is_told(setup):
    hub, keys, readers = setup(builtin="timeout", jina="rate_limit")
    keys.set("jina", "jina-the-owners-key-0123456789")
    with pytest.raises(ServiceError) as failed:
        await hub.read("https://news.example/a")
    assert failed.value.kind == "timeout" and readers.calls == ["builtin", "jina"]


@pytest.mark.parametrize("kind", ["bad_url", "blocked_address", "too_large", "unsupported_type"])
async def test_an_address_that_is_wrong_forbidden_or_too_big_is_not_sent_to_another_reader(setup, kind):
    hub, keys, readers = setup(builtin=kind)
    keys.set("jina", "jina-the-owners-key-0123456789")
    with pytest.raises(ServiceError):
        await hub.read("https://news.example/a")
    assert readers.calls == ["builtin"]
