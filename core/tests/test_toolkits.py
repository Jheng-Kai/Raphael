"""What a Composio toolkit asks of the owner, read from what Composio says of it (connectors/toolkits.py). Shapes are the
ones the real catalog has: they were read from it, with no value in them."""

import pytest

from raphael_core.connectors.toolkits import OWN_APP, REDIRECT, SIGN_IN, KEY, check_values, credentials_of, needs_of_row, plan_of, view_of


def field(name, label=None, *, secret=False, default=None):
    return {"name": name, "displayName": label or name, "description": f"the {name}", "required": True, "is_secret": secret, "default": default}


def detail(mode, creation=(), account=(), *, optional_creation=(), hint=None):
    return {"mode": mode, "auth_hint_url": hint, "fields": {
        "auth_config_creation": {"required": list(creation), "optional": list(optional_creation)},
        "connected_account_initiation": {"required": list(account), "optional": []}}}


@pytest.mark.parametrize("row,needs", [
    ({"no_auth": True}, SIGN_IN),
    ({"composio_managed_auth_schemes": ["OAUTH2"], "auth_schemes": ["OAUTH2"]}, SIGN_IN),
    ({"auth_schemes": ["API_KEY"]}, KEY),
    ({"auth_schemes": ["BASIC"]}, KEY),
    ({"auth_schemes": ["BEARER_TOKEN"]}, KEY),
    ({"auth_schemes": ["API_KEY", "OAUTH2"]}, KEY),
    ({"auth_schemes": ["S2S_OAUTH2"]}, KEY),
    ({"auth_schemes": ["DCR_OAUTH"]}, SIGN_IN),
    ({"auth_schemes": ["OAUTH2"]}, OWN_APP),
    ({"auth_schemes": ["oauth1"]}, OWN_APP),
])
def test_the_list_alone_says_what_an_app_needs(row, needs):
    assert needs_of_row(row) == needs


def test_a_key_is_the_account_fields_the_toolkit_asks_for_in_its_own_words():
    plan = plan_of({"name": "Acme", "meta": {"app_url": "https://acme.example"}, "auth_config_details": [
        detail("API_KEY", account=[field("generic_api_key", "API Key", secret=True)], hint="https://docs.acme.example/keys")]})
    assert (plan["needs"], plan["scheme"], plan["guide_url"], plan["app_url"]) == (KEY, "API_KEY", "https://docs.acme.example/keys", "https://acme.example")
    assert [(f["name"], f["label"], f["secret"], f["stage"]) for f in plan["fields"]] == [("generic_api_key", "API Key", True, "account")]
    assert credentials_of(plan, {"generic_api_key": "  v  "}, "account") == {"generic_api_key": "v"}
    assert credentials_of(plan, {"generic_api_key": "v"}, "app") == {}


def test_basic_asks_for_a_name_and_a_password_and_leaves_optional_ones_out_when_empty():
    plan = plan_of({"auth_config_details": [{"mode": "BASIC", "fields": {
        "auth_config_creation": {"required": [], "optional": []},
        "connected_account_initiation": {"required": [field("username"), field("password", secret=True)],
                                         "optional": [{**field("region"), "required": False}]}}}]})
    assert plan["needs"] == KEY and [f["name"] for f in plan["fields"]] == ["username", "password", "region"]
    assert [f["secret"] for f in plan["fields"]] == [False, True, False]  # a password is secret by its name as well
    assert credentials_of(plan, {"username": "u", "password": "p", "region": ""}, "account") == {"username": "u", "password": "p"}
    assert check_values(plan, {"username": "u"}) == "missing_fields"
    assert check_values(plan, {"username": "u", "password": "p"}) is None


def test_an_app_of_the_owners_own_has_its_id_secret_and_the_address_to_register():
    plan = plan_of({"auth_guide_url": "https://guide.example/x", "meta": {"app_url": "https://x.example"}, "auth_config_details": [
        detail("OAUTH2", creation=[field("client_id"), field("client_secret", secret=True), field("generic_id", "App Bearer Token")],
               optional_creation=[{**field("oauth_redirect_uri", "Redirect URI", default="https://backend.composio.dev/api/v1/auth-apps/add"), "required": False},
                                  {**field("scopes"), "required": False}])]})
    assert (plan["needs"], plan["scheme"], plan["redirect_url"], plan["guide_url"]) == (OWN_APP, "OAUTH2", "https://backend.composio.dev/api/v1/auth-apps/add", "https://guide.example/x")
    assert [f["name"] for f in plan["fields"]] == ["client_id", "client_secret", "generic_id", "scopes"]  # the redirect is shown, not asked for
    sent = credentials_of(plan, {"client_id": "i", "client_secret": "s", "generic_id": "g"}, "app")
    assert sent == {"client_id": "i", "client_secret": "s", "generic_id": "g", "oauth_redirect_uri": "https://backend.composio.dev/api/v1/auth-apps/add"}
    assert credentials_of(plan, {"client_id": "i"}, "account") == {}


def test_a_toolkit_with_a_key_and_a_sign_in_asks_for_the_key_and_one_with_two_stages_asks_for_both():
    plan = plan_of({"auth_config_details": [
        detail("OAUTH2", creation=[field("client_id"), field("client_secret", secret=True)]),
        detail("API_KEY", creation=[field("full", "Instance URL")], account=[field("generic_api_key", secret=True)])]})
    assert plan["needs"] == KEY and plan["scheme"] == "API_KEY"
    assert [(f["name"], f["stage"]) for f in plan["fields"]] == [("full", "app"), ("generic_api_key", "account")]
    assert credentials_of(plan, {"full": "https://x.example", "generic_api_key": "k"}, "app") == {"full": "https://x.example"}
    assert credentials_of(plan, {"full": "https://x.example", "generic_api_key": "k"}, "account") == {"generic_api_key": "k"}


def test_dynamic_clients_and_managed_sign_ins_ask_for_nothing():
    dcr = plan_of({"auth_config_details": [detail("DCR_OAUTH")]})
    assert (dcr["needs"], dcr["fields"], dcr["scheme"]) == (SIGN_IN, [], "DCR_OAUTH")
    managed = plan_of({"composio_managed_auth_schemes": ["OAUTH2"], "auth_config_details": [detail("OAUTH2", creation=[field("client_id")])]})
    assert (managed["needs"], managed["fields"]) == (SIGN_IN, [])


def test_without_details_the_list_decides_and_the_usual_fields_are_asked():
    key = plan_of({"auth_schemes": ["API_KEY"]})
    assert key["needs"] == KEY and [(f["name"], f["stage"]) for f in key["fields"]] == [("generic_api_key", "account")]
    own = plan_of({"auth_schemes": ["OAUTH2"]})
    assert own["needs"] == OWN_APP and own["redirect_url"] == REDIRECT
    assert [(f["name"], f["stage"]) for f in own["fields"]] == [("client_id", "app"), ("client_secret", "app")]


def test_only_web_addresses_are_offered_to_open():
    plan = plan_of({"auth_guide_url": "javascript:alert(1)", "meta": {"app_url": "file:///c:/x"}, "auth_config_details": [
        detail("API_KEY", account=[field("generic_api_key", secret=True)], hint="https://ok.example/a b")]})
    assert (plan["guide_url"], plan["app_url"]) == (None, None)
    assert plan_of({"auth_guide_url": " https://ok.example/guide ", "auth_config_details": [detail("API_KEY", account=[field("k", secret=True)])]})["guide_url"] == "https://ok.example/guide"


@pytest.mark.parametrize("values,problem", [
    ({"generic_api_key": "v"}, None), ({}, "missing_fields"), ({"generic_api_key": "  "}, "missing_fields"),
    ({"generic_api_key": "v", "other": "x"}, "bad_fields"), ({"generic_api_key": 5}, "bad_fields"), ("text", "bad_fields"), (None, "bad_fields"),
    ({"generic_api_key": "a\nb"}, "bad_fields"), ({"generic_api_key": "x" * 9000}, "bad_fields"),
])
def test_the_values_given_must_answer_the_plan(values, problem):
    plan = plan_of({"auth_config_details": [detail("API_KEY", account=[field("generic_api_key", secret=True)])]})
    assert check_values(plan, values) == problem


def test_the_view_has_no_value_and_no_stage():
    plan = plan_of({"name": "Acme", "auth_config_details": [detail("API_KEY", account=[field("generic_api_key", secret=True)])]})
    view = view_of("acme", "Acme", plan)
    assert set(view) == {"slug", "name", "needs", "scheme", "fields", "redirect_url", "guide_url", "app_url"}
    assert all("stage" not in item and "value" not in item for item in view["fields"])
