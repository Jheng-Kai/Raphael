"""Validated public catalog apps and the provider used by their inline connection cards."""

from dataclasses import dataclass

from .google import READ_TOOLS, TOOLS


@dataclass(frozen=True)
class App:
    id: str
    name: str
    prefix: str
    composio: str
    provider: str = "composio"
    logo: str = ""

    @property
    def google_tools(self) -> tuple[str, ...]:
        return tuple(name for name in TOOLS if self.prefix and name.startswith(self.prefix))

    @property
    def reads(self) -> tuple[str, ...]:
        return tuple(name for name in self.google_tools if name in READ_TOOLS)


APPS: dict[str, App] = {app.id: app for app in (
    App("gmail", "Gmail", "gmail_", "gmail", "google"),
    App("googlecalendar", "Google Calendar", "calendar_", "googlecalendar", "google"),
)}

# The owner's own Google authorization (a Desktop client of their Google Cloud project, signed in with PKCE on a loopback
# address): Gmail and Calendar through `connectors/google.py`, not through Composio. Its card is chosen by id, never by
# the app that needs Gmail, so that an owner who has only a Composio key is not sent to Google Cloud.
OWN_GOOGLE = App("google", "Google", "", "google", "own_google")

# Per-owner addresses cannot live in the fixed-address integrations catalog.
SERVER_APPS = {"n8n": App("n8n", "n8n", "", "n8n", "own_server"), OWN_GOOGLE.id: OWN_GOOGLE}


async def catalog_apps(connectors):
    """The same deduplicated public catalog as the store; built-in services win."""
    from ..integrations.catalog import SERVICES
    from .composio import KEY
    from .finder import search_text
    import re
    catalog = (await connectors.catalog({}))["items"] if connectors.vault.get(KEY) else []
    before = getattr(connectors, "_finder_index", None)
    if before is not None and before[0] is catalog:
        return before[1]
    identity = lambda value: re.sub(r"[^a-z0-9]", "", value.lower())
    apps = [(App(s.id, s.name, "", s.id, "builtin"), search_text(s.id, s.name, " ".join([*s.summary.values(), *s.about.values()]))) for s in SERVICES]
    identities = {identity(s.id) for s in SERVICES} | {identity(s.name) for s in SERVICES}
    descriptions = {row["slug"]: row["description"] for row in catalog}
    local_apps = [*APPS.values(), *SERVER_APPS.values()]
    apps += [(app, search_text(app.id, app.name, descriptions.get(app.id, ""))) for app in local_apps]
    identities.update(identity(app.id) for app in local_apps)
    for row in catalog:
        if identity(row["slug"]) not in identities and identity(row["name"]) not in identities:
            apps.append((App(row["slug"], row["name"], "", row["slug"], logo=row.get("logo", "")), search_text(row["slug"], row["name"], row["description"])))
            identities.add(identity(row["slug"]))
    connectors._finder_index = (catalog, apps)
    return apps
