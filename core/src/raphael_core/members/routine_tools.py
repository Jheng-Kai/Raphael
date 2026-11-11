"""The tools a routine's instructions name, checked against the tools its run will have.

A routine runs without the owner at the keyboard (`background.snapshot.take_snapshot`): the commands for
this computer, the desktop and a few of the conversation's tools do not exist there. An instruction that
tells the run to call one of them (owner, 2026-11-11: `team_overview` and `team_work` in a health check,
`unknown_tool` four times) can never be followed, so it is refused when it is written, with the tools that
exist, and the member rewrites it.
"""

import re

# A tool's name: lowercase words joined by underscores. A plugin's tool (`Server__tool`) has capitals or a
# double underscore and is judged by the pool a run is offered, never here.
_NAME = re.compile(r"(?<![\w.:/-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w.:/-])")
# A word in the same line that says the name is a tool: the model is told to call it.
_TOOL_WORD = re.compile(r"\b(?:tools?|call(?:s|ed)?|use|uses|invoke|run|calling)\b|工具|呼叫|調用|使用|用|ツール|呼び出", re.I)
LISTED = 80


def known_names() -> frozenset[str]:
    """Every tool of Raphael's own that any path has, whether a routine's run has it or not."""
    from ..agent.harness_tools import DEFINITIONS as HARNESS
    from ..agent.team import TEAM_TOOLS
    from ..background.snapshot import TAKEN
    from ..computer.tools import PRESENCE_TOOLS
    from ..management import MANAGEMENT_TOOLS

    return frozenset({*HARNESS, *TEAM_TOOLS, *TAKEN, *PRESENCE_TOOLS, *MANAGEMENT_TOOLS})


def unknown_in(prompt: str, available: set[str] | frozenset[str], known: frozenset[str] | None = None) -> list[str]:
    """The names in `prompt` that a routine's run does not have: a tool Raphael has that a routine does not, and a
    name written as a tool (in backticks or with parentheses, in a line that speaks of tools) that is none."""
    known = known_names() if known is None else known
    found: list[str] = []
    for line in prompt.splitlines():
        for match in _NAME.finditer(line):
            name = match.group(1)
            if name in available or name in found:
                continue
            quoted = line[match.start() - 1:match.start()] == "`" or line[match.end():match.end() + 1] in ("(", "`")
            if name in known or (quoted and _TOOL_WORD.search(line)):
                found.append(name)
    return found


def refusal(unknown: list[str], available: set[str] | frozenset[str]) -> str:
    """What the model is told when it writes a routine around tools a run will not have."""
    names = sorted(available)
    listed = ", ".join(names[:LISTED]) + (", ..." if len(names) > LISTED else "")
    return (f"The routine's instructions name {', '.join(unknown)}, which a routine's run does not have, so it could "
            "never follow them. Rewrite them with only the tools a routine has, or without naming a tool "
            "(find_tools finds the rest, and self_check reads the app's own state and recent failures). "
            f"The tools a routine's run has: {listed}.")
