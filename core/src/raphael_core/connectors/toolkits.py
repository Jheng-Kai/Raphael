"""What a Composio toolkit asks of the owner before it can be added, read from what Composio says of it.

Three things, and only three: a `sign_in` (Composio signs the app in for everyone, or it needs nothing), a
`key` (the owner's own API key, token or password for that service: Composio keeps it) or an `own_app`
(an OAuth service whose provider gives Composio no shared login: the owner registers a developer app of
their own and gives its id and secret). Nothing here holds a value the owner typed.
"""

import re

SIGN_IN, KEY, OWN_APP = "sign_in", "key", "own_app"
OAUTH = {"OAUTH2", "OAUTH1", "DCR_OAUTH"}
# Where a service that registers an OAuth app sends the browser back, when its own field does not say.
REDIRECT = "https://backend.composio.dev/api/v3/toolkits/auth/callback"
_SECRET = re.compile(r"key|secret|token|password", re.I)
_REDIRECT_FIELD = "oauth_redirect_uri"
MAX_FIELDS = 12


def needs_of_row(item: dict) -> str:
    """What a toolkit of the catalog list needs, from the list alone (no request for each of 1700).
    The toolkit's own page says exactly what (`plan_of`)."""
    if item.get("no_auth") or item.get("composio_managed_auth_schemes"):
        return SIGN_IN
    schemes = {str(scheme).upper() for scheme in item.get("auth_schemes") or []}
    if schemes - OAUTH - {"NO_AUTH"}:
        return KEY
    return SIGN_IN if "DCR_OAUTH" in schemes else OWN_APP


def _fields(section, stage: str, required: bool) -> list[dict]:
    found = (section or {}).get("required" if required else "optional") if isinstance(section, dict) else None
    result = []
    for raw in found if isinstance(found, list) else []:
        if not isinstance(raw, dict) or not isinstance(raw.get("name"), str) or not raw["name"]:
            continue
        name = raw["name"]
        label = raw.get("displayName") if isinstance(raw.get("displayName"), str) and raw["displayName"].strip() else name
        description = raw.get("description") if isinstance(raw.get("description"), str) else ""
        default = raw.get("default") if isinstance(raw.get("default"), str) else None
        result.append({"name": name, "label": label[:80], "description": description[:600], "required": required,
                       "secret": bool(raw.get("is_secret")) or bool(_SECRET.search(name)), "default": default, "stage": stage})
    return result


def _text(value) -> str | None:
    """A web address Composio gave, kept only when the window may offer it to the owner to open."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if re.fullmatch(r"https?://[^\s\"'<>]{1,490}", value) else None


def plan_of(data: dict) -> dict:
    """What `GET /toolkits/<slug>` says the toolkit needs: the one way to add it that asks the owner for least,
    the fields that way asks for (`stage` "app": the OAuth app's, "account": the account's), and where the owner
    finds what is asked (`guide_url`, else the service's own page `app_url`)."""
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    home = _text(meta.get("app_url"))
    guide = _text(data.get("auth_guide_url"))
    if data.get("no_auth") or data.get("composio_managed_auth_schemes"):
        return {"needs": SIGN_IN, "scheme": "", "managed": bool(data.get("composio_managed_auth_schemes")), "fields": [],
                "redirect_url": None, "guide_url": guide, "app_url": home}
    options = []
    for detail in data.get("auth_config_details") or []:
        if not isinstance(detail, dict):
            continue
        sections = detail.get("fields") if isinstance(detail.get("fields"), dict) else {}
        creation, account = sections.get("auth_config_creation"), sections.get("connected_account_initiation")
        app_required, app_optional = _fields(creation, "app", True), _fields(creation, "app", False)
        account_required, account_optional = _fields(account, "account", True), _fields(account, "account", False)
        redirect = next((f for f in app_optional if f["name"] == _REDIRECT_FIELD), None)
        app_optional = [f for f in app_optional if f["name"] != _REDIRECT_FIELD]
        needs = KEY if account_required else OWN_APP if app_required else SIGN_IN
        rank = {KEY: 0, SIGN_IN: 1, OWN_APP: 2}[needs]
        fields = [*app_required, *account_required, *account_optional, *(app_optional if needs == OWN_APP else [])][:MAX_FIELDS]
        options.append((rank, len(options), {
            "needs": needs, "scheme": str(detail.get("mode") or "").upper(), "managed": False, "fields": fields,
            "redirect_url": (_text((redirect or {}).get("default")) or REDIRECT) if needs == OWN_APP else None,
            "guide_url": _text(detail.get("auth_hint_url")) or guide, "app_url": home}))
    if not options:
        # Composio does not say how it signs in: what the catalog list says of it, with the usual fields.
        needs = needs_of_row(data)
        usual = {
            KEY: [("generic_api_key", "API key", "account")],
            OWN_APP: [("client_id", "Client ID", "app"), ("client_secret", "Client secret", "app")],
            SIGN_IN: [],
        }[needs]
        return {"needs": needs, "scheme": "", "managed": False, "redirect_url": REDIRECT if needs == OWN_APP else None,
                "fields": [{"name": name, "label": label, "description": "", "required": True, "secret": True,
                            "default": None, "stage": stage} for name, label, stage in usual],
                "guide_url": guide, "app_url": home}
    return min(options, key=lambda option: option[:2])[2]


def credentials_of(plan: dict, values: dict, stage: str) -> dict[str, str]:
    """The values of the fields of `stage` the owner gave, by name, as Composio takes them. A field left empty
    is left out (an optional one is Composio's to default); a default the owner kept is sent as it is."""
    given = {}
    for field in plan["fields"]:
        if field["stage"] != stage:
            continue
        value = values.get(field["name"])
        value = value.strip() if isinstance(value, str) else ""
        if value or field["required"]:
            given[field["name"]] = value
    if stage == "app" and plan["needs"] == OWN_APP:
        given[_REDIRECT_FIELD] = plan["redirect_url"] or REDIRECT
    return given


def check_values(plan: dict, values) -> str | None:
    """None when `values` answers the plan: only fields it lists, each text, every required one filled."""
    if not isinstance(values, dict) or len(values) > MAX_FIELDS:
        return "bad_fields"
    names = {field["name"] for field in plan["fields"]}
    if set(values) - names:
        return "bad_fields"
    for field in plan["fields"]:
        value = values.get(field["name"])
        if value is not None and (not isinstance(value, str) or len(value) > 8192 or any(ord(c) < 32 and c not in "\t" for c in value)):
            return "bad_fields"
        if field["required"] and not (isinstance(value, str) and value.strip()):
            return "missing_fields"
    return None


def view_of(slug: str, name: str, plan: dict) -> dict:
    """The plan as the window draws it: what is asked and where to get it, never a value."""
    return {"slug": slug, "name": name, "needs": plan["needs"], "scheme": plan["scheme"],
            "fields": [{k: field[k] for k in ("name", "label", "description", "required", "secret", "default")} for field in plan["fields"]],
            "redirect_url": plan["redirect_url"], "guide_url": plan["guide_url"], "app_url": plan["app_url"]}
