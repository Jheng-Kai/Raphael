"""Independent Sign in with ChatGPT registrations and vault-only rotating credentials."""

import asyncio
import base64
import hashlib
import json
import logging
import math
import os
import re
import secrets
import time
import uuid
import webbrowser
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt

from ...protocol import INTERNAL_ERROR, INVALID_PARAMS, RpcError
from ...sign_in_page import chatgpt_page, http_response, language_of
from ..openrouter import OpenRouterError
from ..settings import SettingsStore

ISSUER = "https://auth.openai.com"
AUTHORIZE = ISSUER + "/api/accounts/authorize"
TOKEN = ISSUER + "/api/accounts/oauth/token"
RESOURCE = "https://api.openai.com/v1"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
SCOPE = "openid profile email offline_access resource.invoke " + PLAN_SCOPE
SETTINGS_KEY = "chatgpt.registrations.v1"
TERMINAL_REFRESH = frozenset(("invalid_grant", "invalid_refresh_token", "token_expired",
    "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"))
# The identity server's clock and this computer's differ (3 s on the owner's PC, seen live), so a token
# can look issued in the future. The signature, the audience and the nonce prove it; its times need only be sane.
CLOCK_LEEWAY_S = 300
# How long the browser's page waits for the outcome of the exchange it started.
OUTCOME_WAIT_S = 30
logger = logging.getLogger(__name__)


def failure(status, body, request_id=None, retry_after=None):
    """Allowlist error codes, never carry remote messages or credentials into diagnostics. `retry_after` is the wait the
    response asked for; a plan's own `resets_in_seconds` is a number, so it may be kept too."""
    error = body.get("error", {}) if isinstance(body, dict) else {}
    code = error.get("code") if isinstance(error, dict) else error
    if code is None and isinstance(body, dict):  # a stream's `error` event has it at the top
        code = body.get("code")
    kinds = {
        "subscription_sharing_usage_limit_exceeded": "usage_limit",
        "subscription_sharing_usage_unavailable": "chatgpt_unavailable",
        "subscription_sharing_user_unavailable": "chatgpt_unavailable",
        "subscription_sharing_user_not_eligible": "chatgpt_plan_unavailable",
        "subscription_sharing_unsupported_capability": "invalid_request",
        "subscription_sharing_route_not_supported": "invalid_request",
        "chatpass_v2_scope_not_authorized": "chatgpt_scope",
        "chatpass_v2_invalid_authorization_context": "chatgpt_scope",
        "subscription_sharing_invalid_user": "auth_expired",
        "usage_limit_reached": "usage_limit",
        "context_length_exceeded": "context_overflow",
        "insufficient_quota": "credits",
        "content_policy_violation": "content_policy",
    }
    # The plan endpoint names its usage limit as the error's type.
    kind = next((kinds[word] for word in (code, error.get("type") if isinstance(error, dict) else None)
                 if isinstance(word, str) and word in kinds), None)
    kind = kind or ("auth_expired" if (isinstance(code, str) and code in TERMINAL_REFRESH) or status == 401 else
        "permission_denied" if status == 403 else "payload_too_large" if status == 413 else
        "rate_limit" if status == 429 else
        "chatgpt_unavailable" if status == 503 else "server" if status >= 500 else "invalid_request")
    result = OpenRouterError(status, kind, "ChatGPT request failed: " + kind)
    resets = error.get("resets_in_seconds") if isinstance(error, dict) else None
    result.retry_after = next((float(wait) for wait in (retry_after, resets) if type(wait) in (int, float) and wait > 0), None)
    # Preserve useful protocol metadata without carrying arbitrary remote text.
    result.details = {"kind": kind, "http_status": status,
        "code": code if isinstance(code, str) and code in (*kinds, *TERMINAL_REFRESH, "invalid_client", "context_length_exceeded") else None,
        "body_shape": "error_object" if isinstance(error, dict) and error else
                      "error_string" if isinstance(error, str) else "detail" if isinstance(body, dict) and "detail" in body else "unknown",
        "request_id": request_id if isinstance(request_id, str) and re.fullmatch(r"req_[A-Za-z0-9_-]{1,128}", request_id) else None}
    if isinstance(error, dict) and error.get("param") in ("model", "tools", "input", "service_tier", "instructions"):
        result.details["param"] = error["param"]
    return result


class ChatGPTAuth:
    def __init__(self, conn, credential, *, http=None, browser=webbrowser.open):
        self.settings = SettingsStore(conn)
        self._credential, self._http, self._browser = credential, http, browser
        self._owns_http = http is None
        self._lock = asyncio.Lock()
        self._pending = None
        self._sign_in_task = None
        self._cancel_requested = False
        self._notify = lambda method, params: None
        self.model_rows = []
        self.revision = 0

    @asynccontextmanager
    async def session_lock(self):
        """Serialize rotation across tasks and Windows sidecars on the same host."""
        async with self._lock:
            handle = None
            acquired = False
            if os.name == "nt":
                import ctypes
                from ctypes import wintypes

                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
                kernel.CreateMutexW.restype = wintypes.HANDLE
                kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
                kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
                kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                host = self._state().get("host_id", "unregistered")
                name = "Local\\RaphaelChatGPT-" + hashlib.sha256(host.encode()).hexdigest()
                handle = kernel.CreateMutexW(None, False, name)
                if not handle:
                    raise OpenRouterError(0, "tool_broken", "ChatGPT session lock could not be opened")
            try:
                if handle:
                    deadline = time.monotonic() + 60
                    while True:
                        result = kernel.WaitForSingleObject(handle, 0)
                        if result in (0, 0x80):
                            acquired = True
                            break
                        if result != 0x102 or time.monotonic() >= deadline:
                            raise OpenRouterError(0, "timeout", "ChatGPT session is busy; try again later")
                        await asyncio.sleep(0.05)
                yield
            finally:
                if handle:
                    if acquired:
                        kernel.ReleaseMutex(handle)
                    kernel.CloseHandle(handle)

    def session(self):
        return self._state().get("active", ""), self.revision

    def check_session(self, session):
        if session != self.session():
            raise OpenRouterError(0, "auth_expired", "ChatGPT account changed or signed out during the request")

    def _state(self):
        return self.settings.get(SETTINGS_KEY)

    def _save(self, state):
        self.settings.set(SETTINGS_KEY, state)

    def _vault(self, account_id):
        return self._credential("chatgpt:" + account_id)

    def _tokens(self, account_id):
        try:
            return json.loads(self._vault(account_id).get() or "{}")
        except Exception:
            raise OpenRouterError(0, "auth_expired", "ChatGPT credentials could not be read") from None

    def _store(self, account_id, tokens):
        try:
            self._vault(account_id).set(json.dumps(tokens, allow_nan=False))
        except Exception:
            raise OpenRouterError(0, "tool_broken", "ChatGPT credentials could not be saved") from None

    def http(self):
        if self._http is None:
            self._http = httpx.AsyncClient(follow_redirects=False)
        return self._http

    async def request(self, method, url, **kwargs):
        try:
            response = await self.http().request(method, url, follow_redirects=False, timeout=20, **kwargs)
        except httpx.TimeoutException:
            raise OpenRouterError(0, "timeout", "ChatGPT request timed out") from None
        except httpx.TransportError:
            raise OpenRouterError(0, "network", "ChatGPT could not connect") from None
        try:
            body = response.json()
        except ValueError:
            body = {}
        if not response.is_success:
            raise failure(response.status_code, body, response.headers.get("x-request-id"))
        if not isinstance(body, dict):
            raise OpenRouterError(response.status_code, "invalid_request", "Invalid ChatGPT response")
        return body

    async def _discovery(self):
        body = await self.request("GET", ISSUER + "/.well-known/openid-configuration")
        if body.get("issuer") != ISSUER:
            raise OpenRouterError(0, "auth_expired", "Invalid ChatGPT issuer")
        return body

    @staticmethod
    def _endpoint(value):
        parsed = urlsplit(value if isinstance(value, str) else "")
        if parsed.scheme != "https" or parsed.netloc != "auth.openai.com" or parsed.fragment:
            raise OpenRouterError(0, "auth_expired", "Invalid ChatGPT identity endpoint")
        return value

    async def _identity(self, token, client_id, nonce=None):
        discovery = await self._discovery()
        jwks = await self.request("GET", self._endpoint(discovery.get("jwks_uri")))
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256":
                raise ValueError
            keys = [key for key in jwks["keys"] if key.get("kid") == header.get("kid")
                    and key.get("kty") == "RSA" and key.get("use", "sig") == "sig"]
            if len(keys) != 1:
                raise ValueError
            key = jwt.PyJWK.from_dict(keys[0], algorithm="RS256").key
            claims = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER, audience=client_id,
                leeway=CLOCK_LEEWAY_S, options={"require": ["iss", "aud", "exp", "sub", "iat"]})
            if not isinstance(claims["sub"], str) or not claims["sub"]:
                raise ValueError
            if nonce is not None and not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
                raise ValueError
            if isinstance(claims["aud"], list) and len(claims["aud"]) > 1 and claims.get("azp") != client_id:
                raise ValueError
            return {"subject": claims["sub"], "issuer": claims["iss"],
                    "email": claims.get("email", "") if isinstance(claims.get("email", ""), str) else ""}
        except (jwt.PyJWTError, ValueError, KeyError, TypeError):
            raise OpenRouterError(0, "auth_expired", "ChatGPT identity validation failed") from None

    @staticmethod
    def _token_set(body, previous=None):
        previous = previous or {}
        try:
            expiry = float(body["expires_in"])
            if not math.isfinite(expiry) or expiry <= 0 or body.get("token_type", "").lower() != "bearer":
                raise ValueError
            for field in ("access_token", "refresh_token"):
                if not isinstance(body.get(field), str) or not re.fullmatch(r"[!-~]+", body[field]):
                    raise ValueError
            scope = body.get("scope", previous.get("scope", ""))
            if not isinstance(scope, str):
                raise ValueError
            return {"access_token": body["access_token"], "refresh_token": body["refresh_token"],
                    "id_token": body.get("id_token", previous.get("id_token", "")),
                    "expires_at": time.time() + expiry, "scope": scope}
        except (ValueError, TypeError, KeyError):
            raise OpenRouterError(0, "auth_expired", "Invalid ChatGPT token response") from None

    async def status(self, params):
        state = self._state()
        account_id = state.get("active", "")
        account = state.get("accounts", {}).get(account_id, {})
        tokens = self._tokens(account_id) if account else {}
        return {"signed_in": bool(tokens.get("refresh_token")), "account_id": account_id,
                "email": account.get("email", ""), "plan_scope_granted": PLAN_SCOPE in tokens.get("scope", "").split(),
                "models": list(self.model_rows) if tokens else [], "signing_in": self._pending is not None,
                "accounts": [{"id": key, **value} for key, value in state.get("accounts", {}).items()]}

    async def sign_in(self, params):
        timeout = params.get("timeout_s", 180)
        if type(timeout) not in (int, float) or not 0 < timeout <= 540:
            raise ValueError("Invalid timeout")
        if self._sign_in_task is not None:
            raise OpenRouterError(0, "invalid_request", "ChatGPT sign-in is already running")
        self._sign_in_task = asyncio.current_task()
        self._cancel_requested = False
        try:
            async with asyncio.timeout(timeout):
                return await self._sign_in(params)
        except TimeoutError:
            raise OpenRouterError(0, "timeout", "ChatGPT sign-in timed out; try signing in again") from None
        except asyncio.CancelledError:
            if self._cancel_requested:
                raise OpenRouterError(0, "cancelled", "ChatGPT sign-in cancelled") from None
            raise
        finally:
            self._sign_in_task = None

    async def _sign_in(self, params):
        if self._pending is not None:
            raise OpenRouterError(0, "invalid_request", "ChatGPT sign-in is already running")
        timeout = params.get("timeout_s", 180)
        if type(timeout) not in (int, float) or not 0 < timeout <= 540:
            raise ValueError("Invalid timeout")
        state = self._state()
        selected = params.get("account_id", state.get("active", ""))
        if selected and selected not in state.get("accounts", {}):
            raise ValueError("Unknown ChatGPT account")
        account = state.get("accounts", {}).get(selected, {})
        if not state.get("host_id"):
            state["host_id"] = "urn:uuid:" + str(uuid.uuid4())
            self._save(state)
        nonce, expected_state, verifier = (secrets.token_urlsafe(48) for _ in range(3))
        future = asyncio.get_running_loop().create_future()
        outcome = asyncio.get_running_loop().create_future()
        self._pending = future
        server = None
        handlers = set()
        port = 0
        step = "listener"

        async def callback(reader, writer):
            task = asyncio.current_task()
            handlers.add(task)
            try:
                request = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
                lines = request.decode("latin-1").split("\r\n")
                method, target, _ = lines[0].split(" ")
                headers = {name.strip().lower(): value.strip() for name, _, value in (line.partition(":") for line in lines[1:])}
                language = language_of(params.get("language") or headers.get("accept-language", ""))
                url = urlsplit(target)
                pairs = parse_qs(url.query, keep_blank_values=True)
                # A page on the web cannot reach this listener through a name it controls, nor guess the state.
                valid = (method == "GET" and url.path == "/auth/callback" and headers.get("host") == f"127.0.0.1:{port}" and
                    all(len(values) == 1 for values in pairs.values()) and
                    secrets.compare_digest(pairs.get("state", [""])[0].encode(), expected_state.encode()))
                if valid and not future.done():
                    future.set_result({key: values[0] for key, values in pairs.items()})
                    # The page says what really became of the sign-in, so it waits for the exchange.
                    try:
                        kind, who = await asyncio.wait_for(asyncio.shield(outcome), OUTCOME_WAIT_S)
                    except TimeoutError:
                        kind, who = "finishing", ""
                    writer.write(http_response("200 OK", chatgpt_page(language, kind, who)))
                elif url.path == "/auth/callback":
                    writer.write(http_response("400 Bad Request", chatgpt_page(language, "expired")))
                else:
                    writer.write(http_response("404 Not Found", None))
                await writer.drain()
            except (ValueError, OSError, TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
                pass
            finally:
                writer.close()
                handlers.discard(task)

        try:
            # The first registration uses the documented port, unless something on this computer holds it
            # (another app signing in). Only the port may differ, and reauthorization varies it anyway.
            try:
                server = await asyncio.start_server(callback, "127.0.0.1", 0 if account else 1455, limit=16384)
            except OSError:
                if account:
                    raise
                server = await asyncio.start_server(callback, "127.0.0.1", 0, limit=16384)
            port = server.sockets[0].getsockname()[1]
            redirect = f"http://127.0.0.1:{port}/auth/callback"
            query = {"client_id": account.get("client_id", "dynamic_agent_client"), "response_type": "code",
                "redirect_uri": redirect, "scope": SCOPE, "resource": RESOURCE, "state": expected_state,
                "nonce": nonce, "code_challenge_method": "S256", "ext_agent_host_id": state["host_id"],
                "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()}
            if not account:
                query["agent_name_hint"] = "Raphael"
            else:
                # Unreadable credentials are what signing in again is for: they never stand in its way.
                try:
                    tokens = self._tokens(selected)
                except OpenRouterError:
                    tokens = {}
                if tokens.get("id_token"):
                    query["id_token_hint"] = tokens["id_token"]
                if account.get("email"):
                    query["login_hint"] = account["email"]
                # Only an account that did not allow the plan is asked again; a first registration always sees OpenAI's page.
                if tokens.get("refresh_token") and PLAN_SCOPE not in tokens.get("scope", "").split():
                    query["prompt"] = "consent"
            step = "browser"
            if not self._browser(AUTHORIZE + "?" + urlencode(query)):
                raise OpenRouterError(0, "tool_broken", "ChatGPT sign-in browser could not open")
            step = "callback"
            result = await asyncio.wait_for(asyncio.shield(future), timeout)
            if result.get("error"):
                raise OpenRouterError(0, "permission_denied", "ChatGPT sign-in was declined")
            client_id = result.get("client_id", account.get("client_id", ""))
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", client_id) or client_id == "dynamic_agent_client" or (
                    account and client_id != account["client_id"]) or not result.get("code"):
                raise OpenRouterError(0, "auth_expired", "Invalid ChatGPT registration callback")
            async with self.session_lock():
                step = "token"
                body = await self.request("POST", TOKEN, data={"grant_type": "authorization_code",
                    "client_id": client_id, "code": result["code"], "code_verifier": verifier,
                    "redirect_uri": redirect, "resource": RESOURCE})
                step = "identity"
                identity = await self._identity(body.get("id_token"), client_id, nonce)
                if account and (identity["subject"], identity["issuer"]) != (account["subject"], account["issuer"]):
                    raise OpenRouterError(0, "auth_expired", "ChatGPT account identity changed")
                tokens = self._token_set(body)
                account_id = selected or uuid.uuid4().hex
                step = "vault"
                self._store(account_id, tokens)
                state = self._state()
                state.setdefault("accounts", {})[account_id] = {**identity, "client_id": client_id}
                state["active"] = account_id
                self._save(state)
                self.model_rows = []
                self.revision += 1
            self._notify("providers.changed", {})
            status = await self.status({})
            outcome.set_result(("ok" if status["plan_scope_granted"] else "no_plan", status["email"]))
            return {**status, "first_sign_in": not account}
        except TimeoutError:
            logger.warning("ChatGPT sign-in stopped at %s: timeout", step)
            outcome.set_result(("timeout", ""))
            raise OpenRouterError(0, "timeout", "ChatGPT sign-in timed out; try signing in again") from None
        except OpenRouterError as error:
            # The step and the kind, which is all anyone needs to find it: nothing the server or the owner sent.
            logger.warning("ChatGPT sign-in stopped at %s: %s", step, error.kind)
            outcome.set_result((error.kind, ""))
            raise
        except asyncio.CancelledError:
            outcome.set_result(("cancelled", ""))
            raise
        finally:
            self._pending = None
            if not future.done():
                future.cancel()
            if not outcome.done():
                outcome.set_result(("failed", ""))
            if server is not None:
                server.close()
            # A page that waits for the outcome gets it; a socket the browser only opened in advance does not hold anything up.
            if handlers:
                await asyncio.wait(handlers, timeout=2)
            for task in list(handlers):
                task.cancel()
            await asyncio.gather(*handlers, return_exceptions=True)
            if server is not None:
                await server.wait_closed()

    async def cancel(self, params):
        if self._sign_in_task is not None and self._sign_in_task is not asyncio.current_task():
            self._cancel_requested = True
            self._sign_in_task.cancel()
        return {"cancelled": True}

    async def access_token(self):
        # One sidecar owns this vault session; serialize all refresh/sign-out/replacement writes.
        async with self.session_lock():
            state = self._state()
            account_id = state.get("active", "")
            account = state.get("accounts", {}).get(account_id)
            tokens = self._tokens(account_id) if account else {}
            if not tokens.get("refresh_token"):
                raise OpenRouterError(0, "auth_expired", "Sign in with ChatGPT again")
            if PLAN_SCOPE not in tokens.get("scope", "").split():
                raise OpenRouterError(0, "chatgpt_scope", "Enable ChatGPT plan usage by signing in again")
            if tokens.get("expires_at", 0) <= time.time() + 60:
                # A refresh token is spent the moment OpenAI answers: its successor is saved even when
                # whoever asked has stopped waiting, or the next request finds the account signed out.
                renewal = asyncio.ensure_future(self._renew(account_id, account, tokens))
                try:
                    tokens = await asyncio.shield(renewal)
                except asyncio.CancelledError:
                    await asyncio.wait({renewal}, timeout=25)
                    raise
            if tokens.get("identity_pending"):
                # A check that fails is not a revocation: the tokens stay, unused, and the next request checks again.
                identity = await self._identity(tokens["id_token"], account["client_id"])
                if (identity["subject"], identity["issuer"]) != (account["subject"], account["issuer"]):
                    self._vault(account_id).clear()
                    raise OpenRouterError(0, "auth_expired", "ChatGPT account identity changed")
                tokens.pop("identity_pending")
                self._store(account_id, tokens)
            if PLAN_SCOPE not in tokens.get("scope", "").split():
                raise OpenRouterError(0, "chatgpt_scope", "Enable ChatGPT plan usage by signing in again")
            return tokens["access_token"]

    async def _renew(self, account_id, account, tokens):
        try:
            body = await self.request("POST", TOKEN, data={"grant_type": "refresh_token",
                "client_id": account["client_id"], "refresh_token": tokens["refresh_token"], "resource": RESOURCE})
        except OpenRouterError as error:
            # Only a token OpenAI says is spent is forgotten; a bad moment leaves the account signed in.
            if getattr(error, "details", {}).get("code") in TERMINAL_REFRESH:
                self._vault(account_id).clear()
                self.model_rows = []
            raise
        renewed = self._token_set(body, tokens)
        if body.get("id_token"):
            renewed["identity_pending"] = True
        # Save the rotated token before validating optional identity or using new access.
        self._store(account_id, renewed)
        return renewed

    async def sign_out(self, params):
        await self.cancel({})
        self.revision += 1
        async with self.session_lock():
            state = self._state()
            account_id = state.get("active", "")
            account = state.get("accounts", {}).get(account_id, {})
            tokens = self._tokens(account_id) if account else {}
            revoked = False
            try:
                if tokens.get("refresh_token"):
                    for attempt in range(2):
                        try:
                            discovery = await self._discovery()
                            await self.request("POST", self._endpoint(discovery.get("revocation_endpoint")), data={
                                "client_id": account["client_id"], "token": tokens["refresh_token"],
                                "token_type_hint": "refresh_token"})
                            revoked = True
                            break
                        except OpenRouterError as error:
                            if attempt or error.kind not in ("network", "timeout", "server", "chatgpt_unavailable"):
                                break
                            await asyncio.sleep(1)
            finally:
                if account:
                    self._vault(account_id).clear()
                self.model_rows = []
                self._notify("providers.changed", {})
            return {"signed_out": True, "remote_revocation_confirmed": revoked,
                "warning": "" if revoked or not tokens else "Remote sign-out was not confirmed. Disconnect Raphael in ChatGPT Settings."}

    def register(self, router, models):
        self._notify = router.notify
        for name, handler in {"status": self.status, "sign_in": self.sign_in, "cancel": self.cancel,
                              "sign_out": self.sign_out, "models": models}.items():
            async def safe(params, handler=handler):
                try:
                    return await handler(params)
                except (ValueError, TypeError, KeyError):
                    raise RpcError(INVALID_PARAMS, "Invalid ChatGPT parameters") from None
                except OpenRouterError as error:
                    raise RpcError(INTERNAL_ERROR, str(error), getattr(error, "details", {"kind": error.kind})) from None
                except Exception:
                    raise RpcError(INTERNAL_ERROR, "ChatGPT operation failed") from None
            router.register("chatgpt." + name, safe)

    async def aclose(self):
        await self.cancel({})
        if self._owns_http and self._http is not None:
            await self._http.aclose()
