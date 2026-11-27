"""One naming contract for newly written or imported member skill documents."""

import re
import unicodedata


SKILL_NAME_RULE = (
    "prefer an English slug such as taichung-weather; other names are normalized when saved; "
    "put the title and purpose in the owner's language in description"
)
# No length of its own: a third-party skill keeps its name whole. This is only what a stored name holds.
NAME_MAX = 100


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


# Words that begin many names without naming what the skills are about: a prefix of these is no family.
_GENERIC_FAMILY = _GENERIC_NAME | {"my", "new", "test", "demo", "example", "sample", "custom", "default"}


def family(name):
    """The word a skill's name begins with, which others may begin with too (`pdf` for `pdf-read` and `pdf-fill`), or an empty
    string when its name has no such word: a name of one word, a first word of under three letters or a generic one. Skills
    of one family are one plugin (R-SKILL-20)."""
    parts = str(name).rsplit(":", 1)[-1].casefold().split("-")
    first = parts[0]
    return first if len(parts) > 1 and len(first) >= 3 and re.fullmatch(r"[a-z][a-z0-9]*", first) and first not in _GENERIC_FAMILY else ""


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


def with_name(text, slug):
    """`text` with the `name:` of its front matter set to `slug` (added when the front matter has none)."""
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return f"---\nname: {slug}\n---\n" + text
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            break
        key, sep, _ = lines[index].partition(":")
        if sep and key == "name":
            lines[index] = f"name: {slug}" + lines[index][len(lines[index].rstrip("\r\n")):]
            return "".join(lines)
    lines.insert(1, f"name: {slug}" + (lines[0][len(lines[0].rstrip("\r\n")):] or "\n"))
    return "".join(lines)


def normalize_skill_name(name: str) -> str:
    """Make a stored slash name from a skill's display name."""
    ascii_name = unicodedata.normalize("NFKD", name).casefold().encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")
    if not slug:
        return "skill"
    if not slug[0].isalpha() or len(slug) == 1:
        slug = "skill-" + slug
    return slug[:NAME_MAX].rstrip("-")


def unique_skill_name(name: str, taken: set[str]) -> str:
    """Choose the first free slug, fitting any numeric suffix in the stored name."""
    candidate, number = name, 2
    while candidate.casefold() in taken:
        suffix = f"-{number}"
        candidate = name[:NAME_MAX - len(suffix)].rstrip("-") + suffix
        number += 1
    return candidate
