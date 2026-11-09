"""Adding an app of the store that asks for more than a sign-in: the owner's own key, or a developer app of
their own. Every request stops at an HTTP double of Composio; the keys below are made up for the tests."""

import json
import logging

import httpx
import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.connectors.apps import catalog_apps
from raphael_core.connectors.cards import ConnectorCards
from raphael_core.connectors.service import ConnectorsService
from raphael_core.failures import Failure
from raphael_core.integrations.service import IntegrationsService
from raphael_core.integrations.vault import MemoryVault
from raphael_core.router import Router

from test_connectors import Platform

KEY = "zk-test-0123456789"
SECRET = "zs-test-9876543210"


def _fields(required=(), optional=()):
    return {"required": [dict(name=n, displayName=d, description=f"the {d}", required=True, is_secret=s)
                         for n, d, s in required],
            "optional": [dict(name=n, displayName=d, description=f"the {d}", required=False, is_secret=False, default=v)
                         for n, d, v in optional]}


def _detail(slug, name, details, *, guide=None, home="https://home.example", managed=()):
    return {"slug": slug, "name": name, "no_auth": False, "composio_managed_auth_schemes": list(managed),
            "auth_guide_url": guide, "meta": {"app_url": home, "description": f"{name} things", "logo": ""},
            "auth_schemes": [d["mode"] for d in details], "auth_config_details": details}


TOOLKITS = {
    "gmail": _detail("gmail", "Gmail", [], managed=["OAUTH2"]),
    "acme": _detail("acme", "Acme", [{"mode": "API_KEY", "auth_hint_url": "https://docs.acme.example/keys", "fields": {
        "auth_config_creation": _fields(), "connected_account_initiation": _fields([("generic_api_key", "API Key", True)])}}]),
    "bare": _detail("bare", "Bare", [{"mode": "API_KEY", "fields": {
        "auth_config_creation": _fields(), "connected_account_initiation": _fields([("generic_api_key", "API Key", True)])}}], home="https://bare.example"),
    "bigco": _detail("bigco", "BigCo", [{"mode": "OAUTH2", "auth_hint_url": "https://developers.bigco.example/apps", "fields": {
        "auth_config_creation": _fields([("client_id", "Client ID", False), ("client_secret", "Client Secret", True)],
                                        [("oauth_redirect_uri", "Redirect URI", "https://backend.composio.dev/api/v1/auth-apps/add")]),
        "connected_account_initiation": _fields()}}]),
    "dcr": _detail("dcr", "Dcr", [{"mode": "DCR_OAUTH", "fields": {
        "auth_config_creation": _fields(), "connected_account_initiation": _fields()}}]),
}


class Store(Platform):
    """Composio with a store of several kinds of app, and the key and developer-app paths of adding one."""

    def __init__(self, *, reject=False):
        super().__init__(["ACTIVE"])
        self.reject, self.auth_configs, self.accounts, self.deleted, self.linked = reject, {}, {}, [], ""

    def body(self, request):
        return json.loads(request.content) if request.content else {}

    def __call__(self, request):
        path, method = request.url.path.removeprefix("/api/v3.1"), request.method
        if path == "/toolkits" and method == "GET":
            self.requests.append(request)
            return httpx.Response(200, json={"items": [
                {"slug": slug, "name": item["name"], "no_auth": False, "meta": item["meta"],
                 "composio_managed_auth_schemes": item["composio_managed_auth_schemes"],
                 "auth_schemes": item["auth_schemes"]} for slug, item in TOOLKITS.items()]})
        if path == "/toolkits/categories":
            return httpx.Response(200, json={"items": [{"id": "productivity", "name": "Productivity"}]})
        if path.startswith("/toolkits/") and method == "GET":
            self.requests.append(request)
            return httpx.Response(200, json=TOOLKITS[path.rsplit("/", 1)[1]])
        if path == "/auth_configs" and method == "POST":
            self.requests.append(request)
            body = self.body(request)
            if self.reject and body["auth_config"].get("credentials", {}).get("client_secret") == "refused":
                return httpx.Response(400, json={"error": {"message": f"bad credential {SECRET}"}})
            ident = f"ac_{len(self.auth_configs) + 1}"
            self.auth_configs[ident] = body
            return httpx.Response(201, json={"auth_config": {"id": ident, "toolkit": body["toolkit"]}})
        if path.startswith("/auth_configs/") and method == "DELETE":
            self.requests.append(request)
            self.deleted.append(path)
            self.auth_configs.pop(path.rsplit("/", 1)[1], None)
            return httpx.Response(200, json={"success": True})
        if path == "/connected_accounts" and method == "POST":
            self.requests.append(request)
            body = self.body(request)
            if self.reject:
                return httpx.Response(400, json={"error": {"slug": "ConnectedAccount_CredentialValidationRejected",
                                                           "message": f"rejected {KEY} {json.dumps(body)}"}})
            ident = f"ca_{len(self.accounts) + 1}"
            self.accounts[ident] = body
            return httpx.Response(201, json={"id": ident, "status": "ACTIVE"})
        if path.startswith("/connected_accounts/ca_") and path != "/connected_accounts/ca_test":
            self.requests.append(request)
            ident = path.rsplit("/", 1)[1]
            if method == "DELETE":
                self.deleted.append(path)
                self.accounts.pop(ident, None)
                return httpx.Response(200, json={"success": True})
            slug = self.accounts[ident]["auth_config"]["id"] if ident in self.accounts else "acme"
            toolkit = self.auth_configs.get(slug, {}).get("toolkit", {}).get("slug", "acme")
            return httpx.Response(200, json={"id": ident, "status": "ACTIVE", "toolkit": {"slug": toolkit}})
        if path.endswith("/link"):
            self.linked = self.body(request)["toolkit"]
            self.requests.append(request)
            return httpx.Response(201, json={"connected_account_id": "ca_test",
                                             "redirect_url": "https://connect.composio.dev/link/lt_private"})
        if path == "/connected_accounts/ca_test":
            self.requests.append(request)
            return httpx.Response(200, json={"id": "ca_test", "status": "ACTIVE", "toolkit": {"slug": self.linked}})
        return super().__call__(request)


class Rig:
    def __init__(self, tmp_path, conn, store=None, *, with_key=True):
        self.store = store or Store()
        self.vault = MemoryVault()
        self.hub = IntegrationsService(conn, tmp_path, self.vault)
        self.router = Router()
        self.hub.register(self.router)
        self.opened = []

        async def browser(url):
            self.opened.append(url)

        async def wait(seconds):
            pass
        self.connectors = ConnectorsService(tmp_path, self.vault, self.hub, transport=httpx.MockTransport(self.store),
                                            open_browser=browser, sleep=wait)
        self.connectors.register(self.router)
        self.events, self.resumed, self.failures = [], [], []
        self.cards = ConnectorCards(conn, self.router, self.connectors, notify=lambda m, p: self.events.append((m, p)))
        self.cards.register(self.router)

        async def resume(turn_id):
            self.resumed.append(turn_id)

        async def failure(turn_id, found):
            self.failures.append(found)
        self.cards.resume, self.cards.failure = resume, failure
        self.history = AgentHistory(conn)
        self.turn = self.new_turn()
        if with_key:
            self.vault.set("connectors:composio:key", "ak_private")

    def new_turn(self):
        return self.history.add(session_id="s", question="請整理", route="answer", prefix="", text="",
                                status="running", source="app", member_id=0)

    async def catalog(self):
        return {row["slug"]: row for row in (await self.router.call("connectors.catalog"))["items"]}

    async def card(self, slug, turn=None):
        app = await self.cards.resolve(slug)
        return self.cards.show(turn_id=turn or self.turn, member_id=0, conversation_id=None, app=app, language="zh-TW")

    async def press(self, card, fields=None):
        params = {"id": card.id, **({"fields": fields} if fields is not None else {})}
        result = await self.router.call("integrations.card_connect", params)
        await self.cards.idle()
        return result, self.cards.store.get(card.id)

    def seen(self, tmp_path, conn, caplog):
        """Everything a key could have been written to."""
        return json.dumps(self.events) + caplog.text + json.dumps([list(row) for row in conn.execute("SELECT * FROM connect_cards")]) + \
            "".join(p.read_text() for p in tmp_path.glob("*.json"))


async def test_every_app_of_the_store_can_be_added_and_says_what_it_needs(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    rows = await rig.catalog()
    assert {slug: row["needs"] for slug, row in rows.items()} == {
        "gmail": "sign_in", "acme": "key", "bare": "key", "bigco": "own_app", "dcr": "sign_in"}
    assert not any("can_connect" in row for row in rows.values())  # nothing is a dead end any more


async def test_the_toolkit_says_what_is_asked_and_where_to_get_it(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    acme = await rig.router.call("connectors.toolkit", {"toolkit": "acme"})
    assert acme["needs"] == "key" and acme["guide_url"] == "https://docs.acme.example/keys"
    assert [(f["name"], f["label"], f["secret"], f["required"]) for f in acme["fields"]] == [("generic_api_key", "API Key", True, True)]
    # No guide of its own: the provider's home page is offered, and the dialog says there is no guide.
    bare = await rig.router.call("connectors.toolkit", {"toolkit": "bare"})
    assert bare["guide_url"] is None and bare["app_url"] == "https://bare.example"
    bigco = await rig.router.call("connectors.toolkit", {"toolkit": "bigco"})
    assert bigco["needs"] == "own_app" and bigco["guide_url"] == "https://developers.bigco.example/apps"
    assert bigco["redirect_url"] == "https://backend.composio.dev/api/v1/auth-apps/add"
    assert [f["name"] for f in bigco["fields"]] == ["client_id", "client_secret"]
    assert (await rig.router.call("connectors.toolkit", {"toolkit": "gmail"}))["needs"] == "sign_in"


async def test_the_member_gets_the_public_developer_setup_guide_without_field_values(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    await rig.catalog()
    app = await rig.cards.resolve("bigco")
    guide = await rig.cards.setup_guide(app)
    assert guide["guide_url"] == "https://developers.bigco.example/apps"
    assert guide["redirect_url"]
    assert [field["name"] for field in guide["fields"]] == ["client_id", "client_secret"]
    assert all("default" not in field and "value" not in field for field in guide["fields"])
    assert SECRET not in json.dumps(guide)


async def test_a_key_is_given_to_composio_and_the_apps_tools_come_through(tmp_path, conn, caplog):
    caplog.set_level(logging.DEBUG)
    rig = Rig(tmp_path, conn)
    result = await rig.router.call("connectors.connect", {"toolkit": "acme", "fields": {"generic_api_key": KEY}})
    assert result["connected"] and result["connector"]["status"] == "ACTIVE"
    assert "auth_config_id" not in result["connector"]
    # The auth config is made first, empty of the key (an API key lives in the account), then the account.
    config = rig.store.auth_configs["ac_1"]
    assert config["toolkit"] == {"slug": "acme"}
    assert config["auth_config"]["type"] == "use_custom_auth" and config["auth_config"]["authScheme"] == "API_KEY"
    assert config["auth_config"]["credentials"] == {}
    account = rig.store.accounts["ca_1"]
    assert account["auth_config"] == {"id": "ac_1"}
    assert account["connection"]["user_id"] == rig.connectors.store.user_id
    assert account["connection"]["state"] == {"authScheme": "API_KEY", "val": {"generic_api_key": KEY, "status": "ACTIVE"}}
    # The session is told which auth config the app uses, so that its tools are really there.
    assert rig.store.config["auth_configs"] == {"acme": "ac_1"}
    assert rig.store.config["toolkits"]["enable"] == ["acme"]
    assert {tool.name for tool in rig.hub.offered()} >= {"COMPOSIO_MULTI_EXECUTE_TOOL"}
    assert rig.opened == []  # no browser: a key needs none
    assert KEY not in rig.seen(tmp_path, conn, caplog) + json.dumps(result)
    assert rig.connectors.store.connectors["composio:acme"].auth_config_id == "ac_1"
    # Taking the app away gives the account and the auth config back to Composio, and the session forgets the auth config
    # (a session update only adds to the auth configs it holds, so it is started again).
    await rig.router.call("connectors.disconnect", {"id": "composio:acme"})
    assert "/connected_accounts/ca_1" in "".join(rig.store.deleted) and "/auth_configs/ac_1" in "".join(rig.store.deleted)
    assert not rig.store.accounts and not rig.store.auth_configs
    sessions = [r for r in rig.store.requests if r.method == "POST" and r.url.path.endswith("/tool_router/session")]
    assert len(sessions) == 2 and "auth_configs" not in rig.store.config


async def test_without_the_key_nothing_is_asked_of_composio(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    for fields in (None, {}, {"generic_api_key": "  "}):
        sent = {"toolkit": "acme", **({"fields": fields} if fields is not None else {})}
        assert (await rig.router.call("connectors.connect", sent))["error"] == "needs_key"
    assert (await rig.router.call("connectors.connect", {"toolkit": "bigco", "fields": {"client_id": "x"}}))["error"] == "needs_own_app"
    with pytest.raises(Exception):
        await rig.router.call("connectors.connect", {"toolkit": "acme", "fields": {"generic_api_key": KEY, "extra": "1"}})
    assert not rig.store.auth_configs and not rig.store.accounts and not rig.connectors.store.connectors


async def test_a_key_composio_refuses_is_not_added_and_leaves_nothing_behind(tmp_path, conn, caplog):
    caplog.set_level(logging.DEBUG)
    rig = Rig(tmp_path, conn, Store(reject=True))
    result = await rig.router.call("connectors.connect", {"toolkit": "acme", "fields": {"generic_api_key": KEY}})
    assert result["ok"] is False and result["error"] == "key_rejected"
    assert KEY not in json.dumps(result) + rig.seen(tmp_path, conn, caplog)
    assert not rig.store.auth_configs and not rig.store.accounts  # the auth config made for it was given back
    assert "composio:acme" not in rig.connectors.store.connectors


async def test_an_app_of_the_owners_own_is_registered_then_signed_in_in_the_browser(tmp_path, conn, caplog):
    caplog.set_level(logging.DEBUG)
    rig = Rig(tmp_path, conn)
    fields = {"client_id": "cid-test", "client_secret": SECRET}
    result = await rig.router.call("connectors.connect", {"toolkit": "bigco", "fields": fields})
    assert result["connected"]
    config = rig.store.auth_configs["ac_1"]["auth_config"]
    assert config["authScheme"] == "OAUTH2"
    assert config["credentials"] == {"client_id": "cid-test", "client_secret": SECRET,
                                     "oauth_redirect_uri": "https://backend.composio.dev/api/v1/auth-apps/add"}
    assert rig.opened == ["https://connect.composio.dev/link/lt_private"]
    assert rig.store.config["auth_configs"] == {"bigco": "ac_1"}
    assert SECRET not in rig.seen(tmp_path, conn, caplog) + json.dumps(result)


async def test_a_dynamic_client_app_asks_the_owner_for_nothing(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    assert (await rig.router.call("connectors.connect", {"toolkit": "dcr"}))["connected"]
    config = rig.store.auth_configs["ac_1"]["auth_config"]
    assert (config["authScheme"], config["credentials"]) == ("DCR_OAUTH", {})
    assert rig.store.config["auth_configs"] == {"dcr": "ac_1"} and rig.opened


async def test_a_sign_in_that_composio_manages_asks_for_nothing(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    assert (await rig.router.call("connectors.connect", {"toolkit": "gmail"}))["connected"]
    assert not rig.store.auth_configs and "auth_configs" not in rig.store.config


async def test_a_card_for_an_app_with_a_key_takes_the_key_from_its_form_and_never_keeps_it(tmp_path, conn, caplog):
    caplog.set_level(logging.DEBUG)
    rig = Rig(tmp_path, conn)
    await rig.catalog()
    card = await rig.card("acme")
    view = rig.cards.views([rig.turn])[rig.turn][0]
    assert view["needs"] == "key" and view["toolkit"] == "acme"
    _, card = await rig.press(card, {"generic_api_key": KEY})
    assert (card.state, card.error, card.resumed) == ("connected", "", True)
    assert rig.resumed == [rig.turn] and rig.opened == []
    assert KEY not in rig.seen(tmp_path, conn, caplog) + json.dumps(rig.cards.views([rig.turn]))


async def test_a_card_pressed_without_what_the_app_needs_says_what_and_where(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    await rig.catalog()
    _, card = await rig.press(await rig.card("acme"))
    assert (card.state, card.error) == ("failed", "needs_key")
    said = rig.failures[-1]
    assert isinstance(said, Failure) and said.kind == "auth_expired"
    for part in ("Acme", "API Key", "Settings > Connections > Store", "https://docs.acme.example/keys"):
        assert part in said.reason
    assert not rig.store.auth_configs
    bigco = await rig.card("bigco", rig.new_turn())  # a failure is told once for a turn
    _, bigco = await rig.press(bigco)
    assert bigco.error == "needs_own_app"
    assert "developer app of their own" in rig.failures[-1].reason and "Client ID" in rig.failures[-1].reason
    assert "card in this conversation" in rig.failures[-1].reason and "Settings" not in rig.failures[-1].reason


async def test_a_card_whose_key_was_refused_says_so(tmp_path, conn):
    rig = Rig(tmp_path, conn, Store(reject=True))
    await rig.catalog()
    _, card = await rig.press(await rig.card("acme"), {"generic_api_key": KEY})
    assert (card.state, card.error) == ("failed", "key_rejected")
    assert "did not accept the key" in rig.failures[-1].reason and KEY not in rig.failures[-1].reason


async def test_with_no_composio_key_the_card_says_to_add_it_and_not_that_it_is_not_configured(tmp_path, conn):
    rig = Rig(tmp_path, conn, with_key=False)
    app = await rig.cards.resolve("gmail")
    card = rig.cards.show(turn_id=rig.turn, member_id=0, conversation_id=None, app=app, language="zh-TW")
    _, card = await rig.press(card)
    assert (card.state, card.error) == ("failed", "needs_composio_key")
    assert "Composio's API key is missing" in rig.failures[-1].reason and "Settings > Connections" in rig.failures[-1].reason


async def test_the_member_is_told_what_each_app_needs_before_the_card(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    await rig.catalog()
    found = {row["id"]: row for row in (await rig.cards.find("acme"))["apps"]}
    assert found["acme"]["needs"] == "key"
    big = {row["id"]: row for row in (await rig.cards.find("bigco"))["apps"]}
    assert big["bigco"]["needs"] == "own_app"
    assert "needs" not in {row["id"]: row for row in (await rig.cards.find("dcr"))["apps"]}["dcr"]


async def test_the_card_form_gives_fields_only_as_text(tmp_path, conn):
    rig = Rig(tmp_path, conn)
    await rig.catalog()
    card = await rig.card("acme")
    for bad in ("text", ["a"], {"generic_api_key": 5}, {str(i): "x" for i in range(13)}):
        with pytest.raises(Exception):
            await rig.router.call("integrations.card_connect", {"id": card.id, "fields": bad})
    assert rig.cards.store.get(card.id).state == "pending"
    assert not rig.store.auth_configs
