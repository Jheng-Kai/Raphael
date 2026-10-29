"""Public catalog search vocabulary shared with the store; no credentials or app data."""
import json
import unicodedata
from pathlib import Path

DATA = json.loads(Path(__file__).with_name("finder-data.json").read_text(encoding="utf-8"))


def normalize(value):
    return unicodedata.normalize("NFKC", value).lower().strip()


def search_text(ident, name, description):
    return normalize(" ".join([ident, name, description, DATA["aliases"].get(ident, "")]))


def group_of(categories):
    text = normalize(" ".join(str(category) for category in categories))
    return next((group for group, terms in DATA["groups"].items() if any(term in text for term in terms)), "other")
