"""Who answers: Raphael, or one of the members of the owner's team (raphael_core.members).

A member is not a second assistant with paths of its own. It is a parameter of the one assistant:
the same router, the same answer, the same gate and tiers, the same background worker, given a
`Speaker` that says whose persona speaks (`name`, `role`, `personality` and work `instructions`),
which model answers (`model`, "" for the answer model) and whose conversation and memory are read
(`id`). Every speaker shares work capabilities under the same safety gate; owner management
uses approved management tools. An owner-set `tools` list restricts connected tools;
built-in harness abilities remain shared. Raphael is the speaker with id 0.

`depth` is how the speaker was reached, and `chain` who asked on the way. 0 is the owner (a message
in its thread, a routine, a task handed to the background); 1 is another assistant asking it
something through `ask_member`, 2 one that the asked one asked in turn. A chain is at most MAX_DEPTH
deep (A asks B, B asks C, and C asks nobody), and has no cycle: nobody already in it, the speaker
itself included, can be asked again (`can_ask`).

Nothing here logs a name, a role, a personality or an instruction.
"""

from dataclasses import dataclass, replace

from .policy import PLUGIN_PREFIX

RAPHAEL_ID = 0
# Raphael's name in each language: what `ask_member` takes for him, and what the member column shows.
RAPHAEL_NAMES = {"zh-TW": "拉斐爾", "en": "Raphael", "ja": "ラファエル",
                 "zh-CN": "拉斐尔", "ko": "라파엘", "es": "Raphael", "fr": "Raphael",
                 "de": "Raphael", "pt-BR": "Raphael", "it": "Raphael", "ru": "Рафаэль",
                 "vi": "Raphael", "th": "ราฟาเอล", "id": "Raphael", "tr": "Raphael"}
# Legacy tool ids retained for the stored member settings API.
BUILTIN_TOOL_IDS = ("web_search", "web_read", "weather", "local_time")
# How deep a chain of `ask_member` may go: the owner's assistant asks one (1), which may ask one
# more (2), which asks nobody.
MAX_DEPTH = 2


def is_raphael_name(name: str) -> bool:
    """Whether `name` is one of Raphael's names, whatever the case and the spaces around it."""
    folded = " ".join(name.split()).casefold()
    return any(folded == known.casefold() for known in RAPHAEL_NAMES.values())


def plugin_server(key: str) -> str | None:
    """The id of the connection a plugin tool's key (`mcp:<server>/<tool>`) belongs to."""
    if not key.startswith(PLUGIN_PREFIX):
        return None
    server, sep, _tool = key.removeprefix(PLUGIN_PREFIX).partition("/")
    return server if sep and server else None


@dataclass(frozen=True)
class Speaker:
    """Who answers a request, and with what (see the module). The default is Raphael."""

    id: int = RAPHAEL_ID
    name: str = ""
    role: str = ""
    instructions: str = ""
    model: str = ""
    # Allowed connections; None means all, an empty set means no connected tools.
    tools: frozenset[str] | None = None
    depth: int = 0
    # The ids of the assistants that asked on the way to this one (not this one itself).
    chain: frozenset[int] = frozenset()
    personality: str = ""
    blurb: str = ""
    reply_style: str = "full"
    ask_before_members: bool = False
    # Whether this speaker writes mail as a draft for the owner to edit and send (`agent.drafts`) rather
    # than sending it: on unless the owner turned it off. It never takes the owner's rules away.
    draft_first: bool = True
    capabilities: frozenset[str] = frozenset()

    @property
    def is_chief(self) -> bool:
        return "chief" in self.capabilities

    @property
    def has_no_job(self) -> bool:
        """A member just made: the owner has not said yet what it is for."""
        return not self.is_raphael and not self.is_chief and not self.role and not self.instructions

    @property
    def is_raphael(self) -> bool:
        return self.id == RAPHAEL_ID

    def uses(self, tool: str) -> bool:
        """All speakers share the built-in tools; authorization belongs to the safety gate."""
        return True  # Built-in harness tools are not connection grants.

    def uses_plugin(self, key: str) -> bool:
        """Respect owner-selected connections without restricting built-in harness tools. A member's own computer is
        not a connection: its tools are keyed `mcp:computer-<computer>/<tool>`, so the owner's list of connections
        never names them, and a member with a list must not lose its computer for that (owner, 2026-11-14: a member
        with four chosen tools said it would use its own computer and could not). Every member has its computer
        (R-COMP-ACCESS-01); whether one is on offer at all is the computer's own state, never this list's."""
        server = plugin_server(key)
        if self.tools is None or server is None or server in {"local", "computer", "media"} or server.startswith("computer-"):
            return True
        allowed = {(plugin_server(item) or item).casefold() for item in self.tools}
        return server.casefold() in allowed

    @property
    def may_ask(self) -> bool:
        """Whether it may ask another assistant something (`ask_member`): not at the end of a
        chain that is as deep as it may be."""
        return self.depth < MAX_DEPTH

    def can_ask(self, other: "Speaker") -> bool:
        """Whether it may ask `other`: it may ask at all, `other` is not itself, and `other` is not
        already in the chain that reached it (no cycle)."""
        return self.may_ask and other.id != self.id and other.id not in self.chain

    def asked_by(self, asker: "Speaker") -> "Speaker":
        """The same speaker, asked something by `asker` through `ask_member`: one step deeper in
        the chain, with `asker` and those before it in it."""
        return replace(self, depth=asker.depth + 1, chain=asker.chain | {asker.id})


# Live callers recheck member existence, owner-private scope and approvals.
# The chief capability is a coordination duty, not a management permission level.
RAPHAEL = Speaker()
