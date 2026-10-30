"""Offline OAuth, rotating credentials and public Responses through the production loop."""

import asyncio
import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from raphael_core.agent.failure import AgentFailure, failure_kind
from raphael_core.agent.ledger import Ledger
from raphael_core.agent.narration import NarratedLoop
from raphael_core.brain.openrouter import OpenRouterClient, OpenRouterError
from raphael_core.brain.providers.chatgpt_auth import ISSUER, PLAN_SCOPE, RESOURCE, SCOPE, SETTINGS_KEY
from raphael_core.brain.providers.registry import ProviderRegistry, ProviderRouter
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.brain.spend import SpendTracker
from raphael_core.failures import classify
from raphael_core.router import Router
from raphael_core.worker.loop import ToolOutcome


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class Rig:
    def __init__(self, conn, signing_key):
        self.conn, self.key = conn, signing_key
        self.vault, self.requests, self.urls, self.callbacks = {}, [], [], []
        self.client_id, self.subject = "oaiapp_test", "synthetic-subject"
        self.scope, self.callback_changes, self.claim_changes = SCOPE, {}, {}
        self.token_error, self.model_error = None, None
        self.responses, self.body_checks = [], []
        self.revocation_status = 200
        self.http = httpx.AsyncClient(transport=httpx.MockTransport(self.handle))
        self.legacy = OpenRouterClient(lambda: None, http=self.http)
        self.registry = ProviderRegistry(conn, self.legacy, MemoryKeyStore(), credential=self.credential, http=self.http)
        self.auth = self.registry.chatgpt.auth
        self.auth._browser = self.browser
        self.router = Router()
        self.registry.register(self.router)
        self.client = ProviderRouter(self.registry, self.legacy)

    def credential(self, account_id):
        return self.vault.setdefault(account_id, MemoryKeyStore())

    def identity(self):
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": self.client_id, "sub": self.subject, "email": "synthetic@example.test",
                  "exp": now + 3600, "iat": now, "nonce": self.query["nonce"][0], **self.claim_changes}
        return jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "test-key"})

    def browser(self, url):
        self.urls.append(url)
        self.query = parse_qs(urlsplit(url).query)

        async def callback():
            parsed = urlsplit(self.query["redirect_uri"][0])
            reader, writer = await asyncio.open_connection(parsed.hostname, parsed.port)
            fields = {"state": self.query["state"][0], "code": "synthetic-code", "client_id": self.client_id,
                      "scope": SCOPE, **self.callback_changes}
            fields = {key: value for key, value in fields.items() if value is not None}
            writer.write(("GET /auth/callback?" + urlencode(fields) + " HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").encode())
            await writer.drain()
            result = await reader.read()
            writer.close()
            await writer.wait_closed()
            return result

        self.callbacks.append(asyncio.create_task(callback()))
        return True

    def handle(self, request):
        self.requests.append(request)
        assert request.url.host in ("auth.openai.com", "api.openai.com"), "Unexpected provider request"
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(200, json={"issuer": ISSUER, "jwks_uri": ISSUER + "/jwks",
                                           "revocation_endpoint": ISSUER + "/revoke"})
        if path == "/jwks":
            key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
            return httpx.Response(200, json={"keys": [{**key, "kid": "test-key", "use": "sig"}]})
        if path.endswith("/oauth/token"):
            form = parse_qs(request.content.decode())
            assert form["resource"] == [RESOURCE] and "client_secret" not in form
            if self.token_error:
                return httpx.Response(400, json={"error": self.token_error, "error_description": "secret-provider-text"})
            refresh = form["grant_type"] == ["refresh_token"]
            if not refresh:
                assert form["client_id"] == [self.client_id]
                assert form["redirect_uri"] == self.query["redirect_uri"]
                digest = hashlib.sha256(form["code_verifier"][0].encode()).digest()
                assert base64.urlsafe_b64encode(digest).rstrip(b"=").decode() == self.query["code_challenge"][0]
            return httpx.Response(200, json={"access_token": "rotated-access" if refresh else "synthetic-access",
                "refresh_token": "rotated-refresh" if refresh else "synthetic-refresh", "token_type": "Bearer",
                "expires_in": 3600, "scope": self.scope, **({} if refresh else {"id_token": self.identity()})})
        if path == "/revoke":
            return httpx.Response(self.revocation_status)
        if path == "/v1/models":
            if self.model_error:
                return httpx.Response(self.model_error[0], json=self.model_error[1], headers={"x-request-id": "req_synthetic"})
            return httpx.Response(200, json={"models": [
                {"slug": "chosen-model", "display_name": "Chosen Model", "visibility": "list"},
                {"slug": "hidden-model", "display_name": "Hidden", "visibility": "hide"}]})
        if path == "/v1/responses":
            body = json.loads(request.content)
            self.body_checks.append(body)
            assert body["store"] is False and body["stream"] is True
            assert body["include"] == ["reasoning.encrypted_content"]
            assert not set(body) & {"max_output_tokens", "max_tokens", "temperature", "previous_response_id", "provider"}
            assert all(item.get("role") != "system" for item in body["input"])
            if request.headers["Authorization"] == "Bearer rotated-access":
                assert self.auth._tokens(self.auth._state()["active"])["refresh_token"] == "rotated-refresh"
            return self.responses.pop(0)
        raise AssertionError("Unexpected endpoint: " + path)

    async def sign_in(self, **params):
        return await self.auth.sign_in({"timeout_s": 2, **params})

    def expire(self):
        account_id = self.auth._state()["active"]
        tokens = self.auth._tokens(account_id)
        tokens["expires_at"] = 0
        self.auth._store(account_id, tokens)


@pytest.fixture
async def rig(conn, signing_key):
    value = Rig(conn, signing_key)
    yield value
    await asyncio.gather(*value.callbacks, return_exceptions=True)
    await value.registry.aclose()
    await value.http.aclose()


def sse(output=(), *, event="response.completed", code=None):
    response = {"status": "completed", "model": "chosen-model", "output": list(output),
                "usage": {"input_tokens": 10, "output_tokens": 3}}
    if code:
        response["error"] = {"code": code, "message": "secret-provider-text"}
    packets = [{"type": "response.output_text.delta", "delta": "Unconfirmed text"},
               {"type": event, "response": response}]
    return httpx.Response(200, headers={"content-type": "text/event-stream"},
        text="".join("data: " + json.dumps(packet) + "\n\n" for packet in packets))


def message(text):
    return {"type": "message", "id": "msg", "role": "assistant", "status": "completed",
            "content": [{"type": "output_text", "text": text}]}


def loop(rig, execute, *, tools=None):
    return NarratedLoop(client=rig.client, model="@chatgpt:chosen-model", ledger=Ledger(SpendTracker(rig.conn)),
        language="en", plain=True, system="Answer safely.", user="Check my calendar.",
        tools=tools or [], progress=lambda text: None, execute=execute)


async def test_full_sign_in_rpc_models_and_vault_only_storage(rig, caplog):
    status = await rig.router.call("chatgpt.sign_in", {"timeout_s": 2})
    assert status["signed_in"] and status["plan_scope_granted"]
    assert status["email"] == "synthetic@example.test"
    assert rig.query["client_id"] == ["dynamic_agent_client"] and rig.query["agent_name_hint"] == ["Raphael"]
    assert rig.query["redirect_uri"] == ["http://127.0.0.1:1455/auth/callback"]
    assert rig.query["ext_agent_host_id"][0].startswith("urn:uuid:")
    assert (await rig.router.call("chatgpt.models", {}))["models"][0]["slug"] == "chosen-model"
    assert len((await rig.router.call("chatgpt.status", {}))["models"]) == 1
    assert rig.registry.available("@chatgpt:chosen-model")
    assert rig.registry.catalog_entries()[0].id == "@chatgpt:chosen-model"
    rows = " ".join(row[0] for row in rig.conn.execute("SELECT value FROM settings"))
    for secret in ("synthetic-access", "synthetic-refresh", rig.identity()):
        assert secret not in rows and secret not in caplog.text and secret not in json.dumps(status)


@pytest.mark.parametrize("claims", [{"iss": "https://wrong.test"}, {"aud": "other-client"},
    {"exp": 1}, {"nonce": "wrong"}, {"sub": ""}])
async def test_identity_validation_rejects_invalid_claims(rig, claims):
    rig.claim_changes = claims
    with pytest.raises(OpenRouterError, match="identity validation"):
        await rig.sign_in()
    assert not (await rig.auth.status({}))["signed_in"]


async def test_signature_is_validated(rig, monkeypatch):
    original = rig.identity
    monkeypatch.setattr(rig, "identity", lambda: original()[:-12] + "AAAAAAAAAAAA")
    with pytest.raises(OpenRouterError, match="identity validation"):
        await rig.sign_in()


async def test_returning_registration_reuses_client_and_host_and_checks_subject(rig):
    await rig.sign_in()
    first = rig.query
    rig.callback_changes = {"client_id": None}
    await rig.sign_in()
    assert rig.query["client_id"] == [rig.client_id] and "agent_name_hint" not in rig.query
    assert rig.query["ext_agent_host_id"] == first["ext_agent_host_id"]
    assert rig.query["state"] != first["state"] and rig.query["nonce"] != first["nonce"]
    assert "id_token_hint" in rig.query
    rig.subject = "different-subject"
    with pytest.raises(OpenRouterError, match="identity changed"):
        await rig.sign_in()
    assert (await rig.auth.status({}))["signed_in"]


async def test_accounts_with_the_same_email_keep_separate_registration_and_vault(rig):
    first = await rig.sign_in()
    rig.client_id, rig.subject = "oaiapp_second", "second-subject"
    second = await rig.sign_in(account_id="")
    assert first["account_id"] != second["account_id"] and len(second["accounts"]) == 2
    assert len(rig.vault) == 2
    assert rig.query["client_id"] == ["dynamic_agent_client"]


@pytest.mark.parametrize("change,kind", [({"state": "wrong"}, "timeout"),
    ({"error": "access_denied"}, "permission_denied"), ({"client_id": None}, "auth_expired")])
async def test_callback_rejection_never_exchanges_a_code(rig, change, kind):
    rig.callback_changes = change
    with pytest.raises(OpenRouterError) as error:
        await rig.auth.sign_in({"timeout_s": 0.1})
    assert error.value.kind == kind
    assert not rig.requests


async def test_cancel_and_timeout_close_the_listener(rig):
    rig.auth._browser = lambda url: rig.urls.append(url) or True
    task = asyncio.create_task(rig.auth.sign_in({"timeout_s": 5}))
    for _ in range(100):
        if rig.urls:
            break
        await asyncio.sleep(0.01)
    assert (await rig.router.call("chatgpt.cancel", {}))["cancelled"]
    with pytest.raises(OpenRouterError) as error:
        await task
    assert error.value.kind == "cancelled" and rig.auth._pending is None
    with pytest.raises(OSError):
        await asyncio.open_connection("127.0.0.1", 1455)


async def test_refresh_rotation_is_saved_before_use_and_serialized(rig):
    await rig.sign_in()
    rig.expire()
    assert await asyncio.gather(*(rig.auth.access_token() for _ in range(4))) == ["rotated-access"] * 4
    assert len([r for r in rig.requests if b"grant_type=refresh_token" in r.content]) == 1
    rig.responses = [sse([message("Done")])]
    result = await rig.client.chat_tools(model="@chatgpt:chosen-model", messages=[], tools=[], timeout_s=2, max_tokens=50)
    assert result.model == "@chatgpt:chosen-model" and result.cost_usd == 0


async def test_failed_vault_rotation_never_uses_new_access(rig, monkeypatch):
    await rig.sign_in()
    rig.expire()
    vault = rig.auth._vault(rig.auth._state()["active"])
    monkeypatch.setattr(vault, "set", lambda value: (_ for _ in ()).throw(RuntimeError("secret-provider-text")))
    with pytest.raises(OpenRouterError) as error:
        await rig.auth.access_token()
    assert error.value.kind == "tool_broken"
    assert not [r for r in rig.requests if r.url.path == "/v1/responses"]


async def test_invalid_grant_clears_only_unusable_tokens_and_keeps_registration(rig, caplog):
    await rig.sign_in()
    before = rig.auth._state()
    rig.expire()
    rig.token_error = "invalid_grant"
    with pytest.raises(OpenRouterError) as error:
        await rig.auth.access_token()
    assert classify(error.value).kind == "auth_expired"
    assert not (await rig.auth.status({}))["signed_in"] and rig.auth._state() == before
    assert "secret-provider-text" not in caplog.text


async def test_missing_plan_scope_keeps_identity_but_blocks_requests(rig):
    rig.scope = "openid profile email offline_access"
    status = await rig.sign_in()
    assert status["signed_in"] and not status["plan_scope_granted"]
    with pytest.raises(OpenRouterError) as error:
        await rig.registry.chatgpt.models()
    assert error.value.kind == "chatgpt_scope"
    assert not [r for r in rig.requests if r.url.host == "api.openai.com"]


async def test_streamed_tool_round_trip_through_real_narrated_loop(rig):
    await rig.sign_in()
    reasoning = {"type": "reasoning", "id": "rs", "summary": [], "encrypted_content": "encrypted-reasoning"}
    call = {"type": "function_call", "call_id": "call-1", "name": "calendar_read", "namespace": "raphael", "arguments": "{}"}
    rig.responses = [sse([reasoning, call]), sse([message('{"text":"Dentist at ten.","detail":""}')])]
    executed = []
    async def execute(call_id, name, arguments):
        executed.append((call_id, name, arguments))
        return ToolOutcome(True, content="Dentist at ten")
    tools = [{"type": "function", "function": {"name": "calendar_read", "parameters": {"type": "object"}}}]
    turn = loop(rig, execute, tools=tools)
    outcome = await turn.run()
    assert outcome.status == "done" and turn.reply(outcome).text == "Dentist at ten."
    assert executed == [("call-1", "calendar_read", {})] and outcome.tool_calls == 1
    assert reasoning in rig.body_checks[1]["input"] and call in rig.body_checks[1]["input"]
    assert any(item.get("type") == "function_call_output" and item["call_id"] == "call-1"
               for item in rig.body_checks[1]["input"])
    assert rig.body_checks[0]["tools"][0]["type"] == "namespace"
    assert turn.ledger.model == "@chatgpt:chosen-model" and turn.ledger.total == 0


async def test_unknown_tool_stays_behind_the_shared_gate(rig):
    await rig.sign_in()
    rig.responses = [sse([{"type": "function_call", "call_id": "blocked", "name": "not_offered", "arguments": "{}"}]),
                     sse([message("Cannot do that.")])]
    async def forbidden(*args):
        pytest.fail("Unknown tool reached execution")
    outcome = await loop(rig, forbidden).run()
    assert outcome.tool_calls == 0 and outcome.status == "done"


@pytest.mark.parametrize("code,kind", [("subscription_sharing_usage_limit_exceeded", "usage_limit"),
    ("subscription_sharing_usage_unavailable", "chatgpt_unavailable"),
    ("subscription_sharing_user_not_eligible", "chatgpt_plan_unavailable"),
    ("chatpass_v2_scope_not_authorized", "chatgpt_scope")])
@pytest.mark.parametrize("streamed", [False, True])
async def test_failure_kind_reaches_turn_without_fallback_or_secret_text(rig, caplog, code, kind, streamed):
    await rig.sign_in()
    rig.registry.settings.set("agent_fallbacks", ["unapproved-model"])
    rig.responses = [sse(event="response.failed", code=code) if streamed else
                     httpx.Response(429, json={"error": {"code": code, "message": "secret-provider-text"}})]
    async def forbidden(*args):
        pytest.fail("Failure reached execution")
    turn = loop(rig, forbidden)
    outcome = await turn.run()
    with pytest.raises(AgentFailure) as error:
        turn.reply(outcome)
    assert error.value.kind == kind and error.value.model == "@chatgpt:chosen-model"
    assert failure_kind(OpenRouterError(0, kind, "Classified failure")) == kind
    assert "chosen-model" in error.value.diagnostic.sentence(error.value.model)
    assert len(rig.body_checks) == 1 and (await rig.auth.status({}))["signed_in"]
    assert "secret-provider-text" not in caplog.text


@pytest.mark.parametrize("response", [httpx.Response(200, text="data: [DONE]\n\n"),
    sse(event="response.incomplete"), httpx.Response(200, text="data: malformed\n\n")])
async def test_unfinished_or_malformed_stream_is_never_success(rig, response):
    await rig.sign_in()
    rig.responses = [response]
    with pytest.raises(OpenRouterError):
        await rig.registry.chatgpt.chat_tools(model="chosen-model", messages=[], tools=[], timeout_s=2, max_tokens=50)


async def test_sign_out_revokes_and_keeps_client_host_mapping(rig):
    await rig.sign_in()
    state = rig.auth._state()
    result = await rig.router.call("chatgpt.sign_out", {})
    assert result["remote_revocation_confirmed"] and rig.auth._state() == state
    assert not (await rig.auth.status({}))["signed_in"]
    revoke = next(r for r in rig.requests if r.url.path == "/revoke")
    assert parse_qs(revoke.content.decode())["token"] == ["synthetic-refresh"]


async def test_failed_remote_revocation_reports_local_only_sign_out(rig, monkeypatch):
    await rig.sign_in()
    rig.revocation_status = 503
    async def no_sleep(seconds):
        pass
    monkeypatch.setattr("raphael_core.brain.providers.chatgpt_auth.asyncio.sleep", no_sleep)
    result = await rig.auth.sign_out({})
    assert result["signed_out"] and not result["remote_revocation_confirmed"] and result["warning"]
    assert not (await rig.auth.status({}))["signed_in"]


@pytest.mark.parametrize("cancel", [False, True])
async def test_timeout_and_cancel_cover_the_token_exchange_too(rig, monkeypatch, cancel):
    original = rig.auth.request
    exchanging = asyncio.Event()
    async def delayed(method, url, **kwargs):
        if url.endswith("/oauth/token"):
            exchanging.set()
            await asyncio.Event().wait()
        return await original(method, url, **kwargs)
    monkeypatch.setattr(rig.auth, "request", delayed)
    task = asyncio.create_task(rig.auth.sign_in({"timeout_s": 0.2}))
    await asyncio.wait_for(exchanging.wait(), 1)
    if cancel:
        await rig.auth.cancel({})
    with pytest.raises(OpenRouterError) as error:
        await task
    assert error.value.kind == ("cancelled" if cancel else "timeout")
    assert not rig.vault and rig.auth._pending is None


async def test_refresh_network_failure_preserves_credentials(rig):
    await rig.sign_in()
    rig.expire()
    rig.token_error = {"code": "subscription_sharing_usage_unavailable"}
    with pytest.raises(OpenRouterError) as error:
        await rig.auth.access_token()
    assert error.value.kind == "chatgpt_unavailable" and (await rig.auth.status({}))["signed_in"]
    rig.token_error = None
    assert await rig.auth.access_token() == "rotated-access"


async def test_a_revoked_session_cannot_publish_a_late_response(rig, monkeypatch):
    await rig.sign_in()
    original = rig.handle
    def late(request):
        if request.url.path == "/v1/responses":
            rig.auth.revision += 1
            return sse([message("Late answer")])
        return original(request)
    async with httpx.AsyncClient(transport=httpx.MockTransport(late)) as http:
        monkeypatch.setattr(rig.auth, "_http", http)
        with pytest.raises(OpenRouterError, match="signed out"):
            await rig.registry.chatgpt.chat_tools(model="chosen-model", messages=[], tools=[], timeout_s=2, max_tokens=50)


async def test_model_provider_text_json_and_planning_use_responses(rig):
    await rig.sign_in()
    rig.responses = [sse([message("Text")]), sse([message('{"answer":"JSON"}')]),
        sse([{"type": "function_call", "call_id": "planned", "name": "calendar_read", "arguments": "{}"}])]
    provider = rig.registry.chatgpt
    args = {"model": "chosen-model", "system": "System", "user": "User", "timeout_s": 2, "max_tokens": 50}
    assert (await provider.chat_text(**args)).text == "Text"
    assert (await provider.complete_json(**args, schema={"type": "object"}, schema_name="reply")).data == {"answer": "JSON"}
    assert (await provider.plan_tools(**args, tools=[])).calls[0].name == "calendar_read"


@pytest.mark.parametrize("scope,kind", [(None, "auth_expired"), ("openid", "chatgpt_scope")])
async def test_missing_sign_in_and_scope_report_the_selected_model(rig, scope, kind):
    if scope is not None:
        rig.scope = scope
        await rig.sign_in()
    assert rig.client.available("@chatgpt:chosen-model")
    assert not rig.registry.available("@chatgpt:chosen-model")
    async def forbidden(*args):
        pytest.fail("Credential failure reached execution")
    turn = loop(rig, forbidden)
    outcome = await turn.run()
    with pytest.raises(AgentFailure) as error:
        turn.reply(outcome)
    assert error.value.kind == kind and error.value.model == "@chatgpt:chosen-model"
    assert not [r for r in rig.requests if r.url.host == "api.openai.com"]


@pytest.mark.parametrize("status,body,kind,shape", [(503, {"detail": "secret-provider-text"}, "chatgpt_unavailable", "detail"),
    (403, {"error": {"code": "subscription_sharing_user_not_eligible", "message": "secret-provider-text"}},
     "chatgpt_plan_unavailable", "error_object")])
async def test_rpc_errors_preserve_safe_protocol_metadata_and_credentials(rig, caplog, status, body, kind, shape):
    from raphael_core.protocol import RpcError

    await rig.sign_in()
    rig.model_error = (status, body)
    with pytest.raises(RpcError) as error:
        await rig.router.call("chatgpt.models", {})
    assert error.value.data["kind"] == kind and error.value.data["http_status"] == status
    assert error.value.data["body_shape"] == shape and error.value.data["request_id"] == "req_synthetic"
    assert "secret-provider-text" not in str(error.value) + caplog.text + json.dumps(error.value.data)
    assert (await rig.auth.status({}))["signed_in"]
