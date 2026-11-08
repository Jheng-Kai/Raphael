"""One naming contract for newly written or imported member skill documents."""

import re


SKILL_NAME_RULE = (
    "name must be a short English slug such as taichung-weather "
    "(2-48 lowercase ASCII letters/digits and single hyphens, starting with a letter); "
    "put the title and purpose in the owner's language in description"
)
_SLUG = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*")


def validate_skill_name(name, *, previous_name=None):
    """Keep an existing command usable; never normalize a new or changed name."""
    if previous_name is not None and name == previous_name:
        return
    if not isinstance(name, str) or not 2 <= len(name) <= 48 or not _SLUG.fullmatch(name):
        from .store import MemberError
        raise MemberError("name", SKILL_NAME_RULE)
