"""R-PROV-TEST-01: a provider's connection is tested on the values typed in its form, saved or not."""

import json
import logging

import httpx
import pytest

from raphael_core.brain.db import connect
from raphael_core.brain.openrouter import OpenRouterClient
from raphael_core.brain.providers.registry import ProviderRegistry
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.protocol import INVALID_PARAMS, RpcError
from raphael_core.router import Router

TYPED = "typed-draft-key-7f3a"
SAVED = "saved-key-91c2"


class Harness:
    def __init__(self, handler):
        self.conn, self.keys, self.vault, self.requests, self.notices = connect(":memory:"), MemoryKeyStore(), {}, [], []
        self.handler = handler

    def credential(self, pid):
        return self.vault.setdefault(pid, MemoryKeyStore())

    async def __aenter__(self):
        def seen(request):
            self.requests.append(request)
            return self.handler(request)
        self.http = httpx.AsyncClient(transport=httpx.MockTransport(seen))
        legacy = OpenRouterClient(self.keys.get, http=self.http)
        self.registry = ProviderRegistry(self.conn, legacy, self.keys, credential=self.credential, http=self.http)
        self.router = Router()
        self.router.set_notifier(lambda method, params: self.notices.append(method))
        self.registry.register(self.router)
        return self

    async def __aexit__(self, *exc):
        await self.registry.aclose()
        await self.http.aclose()
        self.conn.close()

    def stored(self):
        return [tuple(row) for row in self.conn.execute("SELECT key, value FROM settings ORDER BY key")]


def models(request):
    return httpx.Response(200, json={"data": [{"id": "qwen3:8b"}, {"id": "llama3.1:8b"}]})


async def test_an_unsaved_form_is_tested_on_its_typed_fields_and_nothing_is_stored():
    async with Harness(models) as h:
        before = h.stored()
        result = await h.router.call("providers.test", {"kind": "openai", "name": "Mine", "key": TYPED})
        assert result["ok"] is True and result["models"] == 2
        assert [m["id"] for m in result["found"]] == ["qwen3:8b", "llama3.1:8b"]
        assert h.requests[-1].headers["Authorization"] == f"Bearer {TYPED}"
        # Nothing: no provider, no list of models, no status, no secret, no notice.
        assert h.stored() == before
        assert (await h.router.call("providers.list"))["providers"] == []
        assert all(store.get() is None for store in h.vault.values())
        assert "providers.changed" not in h.notices


async def test_a_local_server_is_tested_with_no_key_at_all():
    async with Harness(models) as h:
        result = await h.router.call("providers.test", {"kind": "lmstudio", "base_url": "http://localhost:1234/v1"})
        assert result["ok"] is True and result["models"] == 2
        assert "Authorization" not in h.requests[-1].headers
        assert h.requests[-1].url.host == "localhost" and h.requests[-1].url.port == 1234


async def test_a_refused_key_answers_auth_and_a_dead_address_never_changes_the_saved_status():
    def handler(request):
        if request.url.host == "down.example":
            raise httpx.ConnectError("refused")
        return httpx.Response(401, json={"error": "wrong key"})
    async with Harness(handler) as h:
        assert await h.router.call("providers.test", {"kind": "openai", "key": TYPED}) == {"ok": False, "kind": "auth", "models": 0}
        down = await h.router.call("providers.test", {"kind": "openai_compatible", "base_url": "https://down.example/v1"})
        assert down["ok"] is False and down["kind"] in ("offline", "auth")
        pid = (await h.router.call("providers.add", {"kind": "ollama", "base_url": "http://localhost:11434/v1"}))["provider"]["id"]
        before = h.stored()
        await h.router.call("providers.test", {"id": pid, "base_url": "https://down.example/v1"})
        assert h.stored() == before


async def test_a_saved_provider_is_tested_on_the_typed_values_over_the_saved_ones_and_stays_as_it_was():
    async with Harness(models) as h:
        pid = (await h.router.call("providers.add", {"kind": "openai", "key": SAVED}))["provider"]["id"]
        before, notices = h.stored(), list(h.notices)
        # A changed name alone is tested with the saved key.
        await h.router.call("providers.test", {"id": pid, "name": "Renamed"})
        assert h.requests[-1].headers["Authorization"] == f"Bearer {SAVED}"
        # A typed replacement key is the one tested, and the saved one is not touched.
        await h.router.call("providers.test", {"id": pid, "key": TYPED})
        assert h.requests[-1].headers["Authorization"] == f"Bearer {TYPED}"
        assert h.credential(pid).get() == SAVED
        assert h.stored() == before and h.notices == notices
        assert (await h.router.call("providers.list"))["providers"][-1]["name"] == "OpenAI"


async def test_a_saved_test_by_id_alone_still_records_its_result():
    async with Harness(models) as h:
        pid = (await h.router.call("providers.add", {"kind": "ollama"}))["provider"]["id"]
        assert await h.router.call("providers.test", {"id": pid}) == {"ok": True, "models": 2}
        assert (await h.router.call("providers.list"))["providers"][-1]["status"] == "ok"


async def test_a_draft_is_checked_by_the_same_rules_as_saving():
    async with Harness(models) as h:
        for params in ({"kind": "openai", "base_url": "file:///tmp/x"}, {"kind": "openai", "bogus": 1},
                       {"kind": "bedrock", "region": "Not A Region", "key_id": "a", "secret": "b"},
                       {"kind": "vertex", "project": "p", "location": "us-central1", "service_account": "{}"},
                       {"kind": "openai", "key": "has a space"}, {"id": "chatgpt", "name": "x"}, {"kind": "nope"}):
            with pytest.raises(RpcError) as raised:
                await h.router.call("providers.test", params)
            assert raised.value.code == INVALID_PARAMS, params
        assert h.requests == []


async def test_no_typed_secret_reaches_a_log_a_result_or_an_error(caplog):
    caplog.set_level(logging.DEBUG)
    secret = "log-canary-key-5d1e"
    async with Harness(lambda request: httpx.Response(401, text=f"bad key {secret}")) as h:
        result = await h.router.call("providers.test", {"kind": "openai", "key": secret})
        assert secret not in json.dumps(result)
        with pytest.raises(RpcError) as raised:
            await h.router.call("providers.test", {"kind": "openai", "key": secret, "base_url": "ftp://x"})
        assert secret not in str(raised.value) and secret not in repr(raised.value.__dict__)
    assert secret not in caplog.text
