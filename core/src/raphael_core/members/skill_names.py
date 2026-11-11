"""One naming contract for newly written or imported member skill documents."""

import re


SKILL_NAME_RULE = (
    "name must be a short English slug such as taichung-weather "
    "(2-48 lowercase ASCII letters/digits and single hyphens, starting with a letter); "
    "put the title and purpose in the owner's language in description"
)
_SLUG = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*")


# Words that say nothing about which class of work a skill is for.
_GENERIC_NAME = frozenset({"skill", "skills", "guide", "how", "to", "the", "a", "an", "for", "and", "of", "with", "in", "on",
                           "tips", "notes", "workflow", "procedure", "process", "basics", "basic", "general", "using", "use"})
_STOP_WORDS = frozenset({"use", "when", "the", "and", "for", "with", "this", "that", "from", "into", "your", "you", "are", "can",
                         "skill", "task", "tasks", "how", "then", "them", "their", "using", "used"})
NEAR_NAME = 0.5  # shared share of the significant words of two names
NEAR_DESCRIPTION = 0.6  # shared share of the words (and Chinese or Japanese letter pairs) of two descriptions


def _stem(word):
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("sses", "shes", "ches", "xes", "zes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    for suffix in ("ing", "ed"):
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            return word[:-len(suffix)]
    return word


def name_words(name):
    """The significant, lightly stemmed words of a skill slug: `taichung-weather-reports` is {taichung, weather, report}."""
    words = (word for word in re.split(r"[^a-z0-9]+", str(name).casefold()) if word and word not in _GENERIC_NAME)
    return frozenset(_stem(word) for word in words)


def description_words(text):
    """English words and the letter pairs of Chinese or Japanese runs: enough to tell two descriptions of one thing."""
    text = str(text).casefold()
    words = {word for word in re.findall(r"[a-z0-9]{3,}", text) if word not in _STOP_WORDS}
    for run in re.findall(r"[\u3040-\u30ff\u3400-\u9fff]+", text):
        words.update(run[index:index + 2] for index in range(len(run) - 1))
    return frozenset(words)


def _share(left, right):
    return len(left & right) / len(left | right) if left and right else 0.0


def similar_skill(name, description, skills):
    """The first of `skills` (dicts with name and description) that `name` and `description` are near to, or None. Plain
    word overlap, no model: a new skill that is near an existing one is a change to that one."""
    wanted_name, wanted_description = name_words(name), description_words(description)
    for skill in skills:
        if str(skill.get("name", "")).casefold() == str(name).casefold():
            return skill
        if _share(wanted_name, name_words(skill.get("name", ""))) >= NEAR_NAME:
            return skill
        if _share(wanted_description, description_words(skill.get("description", ""))) >= NEAR_DESCRIPTION:
            return skill
    return None


def validate_skill_name(name, *, previous_name=None):
    """Keep an existing command usable; never normalize a new or changed name."""
    if previous_name is not None and name == previous_name:
        return
    if not isinstance(name, str) or not 2 <= len(name) <= 48 or not _SLUG.fullmatch(name):
        from .store import MemberError
        raise MemberError("name", SKILL_NAME_RULE)
