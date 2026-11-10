"""The tools a task may use: a snapshot taken when the task starts.

The worker is offered the tools by an alias and a schema and nothing else; the table that says which
tool an alias is stays here in the core.

The tools a member uses in most turns are listed, sorted by name, and the list stays the same, byte
for byte, while the task runs and from one turn of a conversation to the next (owner, 2026-11-09,
decision 2): it is the first block of every prompt, so a list that followed the request's words, the
tools a search showed or a connection that came or went started the provider's cache again. Which
tools are listed depends on the member and the kind of work (`take_snapshot`), never on what the task
says. Every other tool of the task is found with `find_tools`, which returns its name, description
and input schema, and called with `use_tool` (`Snapshot.use`), which goes down the same path as a
direct call: the same gate, the same questions, the same limits. Neither adds to the list.

The task may use:

- the tools of the plugins the user connected that are on (`PluginHub.offered`), whether they read or
  change something there: the user turned off what a task must not use, and a tool that is on runs
  without asking, for a task as for the assistant, unless one of the owner's safety rules asks
  first. A tool at T2 is offered too: its call pauses the task and asks the owner in the app (the
  waiting question, `service`), and goes on only after a yes there. A tool at T3 is left out unless
  the owner allowed everything (R-AG-35). A connection's tools are found, not listed; the core's own
  (`PluginTool.pinned`: the commands for this PC, the member's computer, the media models and
  Composio's router, whose executing tool shares no word with any request) are listed.
- Raphael's own lookups on the web: the weather, a web search (by the search service the owner
  chose), the time, and the reading of a page (`web_read`, by the reader chosen). A page is read
  only at an address the task has seen: in its request, or in what one of its tools returned
  (`run.TaskRun`, which refuses any other with "url_not_seen"), so a task cannot be made to send
  what it knows to an address of someone's making;
- `read_attachment`, which reads a file the task came with (an image, a PDF the owner handed over) by
  its number: never a path. A task without files is refused the call;
- and, when there is a memory, `history_search`, which only reads: a task may look up what was said
  before; what it writes after reading what services return goes in marked (`memory.store`).
- shared team work tools (`agent.team`), including `ask_member` when there is someone to ask.
  Every member has the same management catalog in an interactive owner-private chat.
  Private background member management requires an explicit owner approval card.

A task of a member has the same built-in abilities; connection tools follow its current
owner-selected allowlist (`Speaker.uses_plugin`).

Not the commands for this computer (open a site, the volume, lock the screen, copy) in the background:
those stay with the fast tier, which the user speaks to, and a task in the background must not open a
page or lock the screen while the user is typing; the owner's own chat finds them. Nor the tools that
operate the owner's desktop (`computer.tools.PRESENCE_TOOLS`, which `needs_presence`): no task is
offered them, no plugin's tool takes one of their names, and the gate refuses them to the worker in
any case.

A snapshot is the offer, not the permission. Every call is judged again by the gate when it is made
(`agent.gate`), against the tier the tool has then, so a tool whose tier was raised, taken away or
changed since the snapshot is refused, listed or not.
"""

import json
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from typing import Any

from ..agent.commands import COMMANDS
from ..agent.gate import ATTACHMENT_TOOLS, MEMORY_READ_TOOLS, WEB_TOOLS
from ..agent.plugins import Offer, PluginHub, PluginTool, make_offer
from ..agent.policy import Tier
from ..agent.speaker import RAPHAEL, Speaker
from ..agent.team import TEAM_TIER, TEAM_TOOLS, worker_definition
from ..agent.harness_tools import CALENDAR_TOOLS, DEFINITIONS as HARNESS_DEFINITIONS, definitions_for, tool as harness_tool
from ..memory.growth import DEFINITIONS as MEMORY_DEFINITIONS
from ..agent.owner_questions import BACKGROUND_TOOLS
from ..agent.harness_tools import ROUTINE_TOOLS
from ..computer.tools import PRESENCE_TOOLS
from ..agent.toolpick import first_sentence, scored

# The highest tier a task is offered: T2, whose calls ask the owner through the waiting question
# (and so only after a yes in the app). A tool that cannot be undone at all (T3) is offered only
# when the owner allowed everything (R-AG-35).
SNAPSHOT_MAX_TIER = Tier.T2

BUILTIN = "builtin"
MCP = "mcp"
FIND = "find"  # find_tools: finds a tool of the task that is not listed
USE = "use"  # use_tool: calls a tool by its name, listed or found
BUILTIN_SERVER = "Raphael"
FIND_TOOLS = "find_tools"
USE_TOOL = "use_tool"

# Raphael's own tools a member seldom calls: none of these was called in the owner's 2,600 private and
# background tool calls up to 2026-11-10. They are found, like a connection's tools, not listed. `open`
# stays listed: live, a model asked to open an address showed it with `show` instead of looking for it
# (Guardian's "open" cell, 2026-11-10); `update_page` stays beside `show_page`, whose description names it.
SELDOM = frozenset({*COMMANDS, "computer", "generate_audio"}) - {"open"}

_DEFINITIONS: dict[str, dict[str, Any]] = {
    "generate_audio": {
        "description": "Generate a downloadable WAV audio file from the owner's script using the configured voice service. Returns an attachment shown in the conversation. Never claim MP3 output. An optional voice selects a voice on that same service.",
        "parameters": {"type": "object", "properties": {"text": {"type": "string", "maxLength": 1000}, "voice": {"type": "string"}}, "required": ["text"]},
    },
    "weather": {
        "description": (
            "The weather now, today and tomorrow in a city. Leave the city out for the "
            "user's own city. Present the known days in a forecast fenced block using the shared schema."
        ),
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "The name of the city."}},
        },
    },
    "web_search": {
        "description": (
            "Search the web and get a short answer with the pages it drew on. Use it "
            "for current or specific facts; the weather and the time have tools of their own."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "What to look up."}},
            "required": ["query"],
        },
    },
    "web_read": {
        "description": (
            "Read a web page as text. Only an address you have seen in the task or in "
            "what a tool of this task returned (a search result, a page read) can be read."
        ),
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "The page's address."}},
            "required": ["url"],
        },
    },
    "read_attachment": {
        "description": (
            "Read a file the user handed over with the task, by its number (1 for "
            "the first): images, PDF/text/Office documents, or transcribed audio/video. Unsupported "
            "formats return metadata and a reading limitation. Ask a question about it to "
            "say what to look for."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "index": {"type": "integer", "description": "The file's number, from 1."},
                "question": {"type": "string", "description": "What to look for in it."},
            },
            "required": ["index"],
        },
    },
    FIND_TOOLS: {
        "description": (
            "Find a tool that is not in your list, by what it should do or by its name (for example: "
            "search pages, delete a folder, set the volume). Returns each match's name, description and "
            "input schema; call it with use_tool. Every member has the same management tools in the "
            "owner's private chat, subject to owner approvals."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What you want a tool to do."}
            },
            "required": ["query"],
        },
    },
    USE_TOOL: {
        "description": (
            "Call a tool that find_tools found: its exact name, and arguments that fit the input schema "
            "find_tools returned. It runs exactly as a direct call would, with the same approvals and limits."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "The tool's exact name."},
                "arguments": {"type": "object", "description": "The tool's arguments, as its input schema says."},
            },
            "required": ["name", "arguments"],
        },
    },
    "local_time": {
        "description": "The date and the time on the user's computer.",
        "parameters": {"type": "object", "properties": {}},
    },
    "history_search": {
        "description": (
            "Search what the user and you said in this speaker's earlier conversations, by a few "
            "words. Returns the matching turns with their dates."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "A few words."}},
            "required": ["query"],
        },
    },
}
_OWN_TIERS = {"generate_audio": Tier.T1}

# The names that are Raphael's own: a plugin's tool never takes one of them.
TAKEN = frozenset({*WEB_TOOLS, *MEMORY_READ_TOOLS, *ATTACHMENT_TOOLS, *TEAM_TOOLS, *_DEFINITIONS,
                   *PRESENCE_TOOLS, *HARNESS_DEFINITIONS})

# The most tools one find_tools call returns, and the most names it lists when none fits.
FIND_MAX = 6
FIND_NAMES = 80
FOUND = ("Found these tools. Call one with use_tool, its name and arguments that fit its parameters: "
         '{"name": "<name>", "arguments": {...}}.')
NOTHING_FITS = "No tool fits those words."
USE_REFUSALS = {
    "bad_arguments": 'Give use_tool the tool\'s exact name and its arguments as an object: {"name": "<name>", "arguments": {...}}.',
    "unknown_tool": ("That is not a tool of this task. Find the tool with find_tools and give its exact name; "
                     "a tool the owner turned off or disconnected cannot be called."),
    "unavailable": ("This tool is no longer enabled or connected. Read connections_list for current access; "
                    "do not retry its old alias."),
}


@dataclass(frozen=True)
class ToolRef:
    """What an alias stands for. `key` is the name the gate knows the tool by."""

    kind: str  # MCP, BUILTIN, FIND or USE
    key: str
    server: str
    name: str
    tier: Tier  # at the moment of the snapshot; the gate asks again at the call


def _native_tool(name: str) -> PluginTool:
    """One of Raphael's own tools, as the finder compares it with a query."""
    if name in _DEFINITIONS:
        item = _DEFINITIONS[name]
        return PluginTool(name, BUILTIN_SERVER, name, item["description"], item["parameters"], _OWN_TIERS.get(name, Tier.T0))
    return harness_tool(name)


@dataclass
class Snapshot:
    """The tools of a task. `definitions` are the listed tools, fixed when the snapshot is taken.
    `refs` are the tools the worker may call now: the listed ones, and any it called by name
    through use_tool since. `pool` is every tool of the plugins that could be offered, by alias;
    `management` holds the speaker's eligible native actions and `work` the other native tools that
    are found rather than listed. A tool of the pool, `management` or `work` that is not listed is
    found (`find`) and called (`use`); neither changes `definitions`."""

    refs: dict[str, ToolRef]
    definitions: list[dict[str, Any]]
    pool: Offer | None = None
    max_tier: Tier = Tier.T3
    _aliases: dict[str, str] = field(default_factory=dict, repr=False)
    sealed: bool = False
    management: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)
    tool_allowed: Any = field(default=lambda _key: True, repr=False)
    work: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)

    def listed(self) -> set[str]:
        return {item["function"]["name"] for item in self.definitions}

    def _list(self, aliases: Sequence[str]) -> None:
        """List these tools of the pool: only while the snapshot is taken, and for the member's computer."""
        listed = self.listed()
        for alias in aliases:
            tool = self.pool.by_alias.get(alias) if self.pool else None
            if tool is None or alias in listed:
                continue
            self.refs[alias] = ToolRef(MCP, tool.key, tool.server, tool.name, tool.tier)
            self.definitions.append(self.pool.definition(alias))
            listed.add(alias)

    def catalog(self) -> dict[str, dict[str, Any]]:
        """Every tool the task may call, by name, in the chat format: the listed ones first, then the
        ones find_tools finds."""
        found = {item["function"]["name"]: item for item in self.definitions}
        for source in (self.management, self.work):
            for name, item in source.items():
                found.setdefault(name, {"type": "function", "function": {"name": name, **item}})
        if self.pool is not None and not self.sealed:
            for alias in self.pool.by_alias:
                found.setdefault(alias, self.pool.definition(alias))
        return found

    def hidden(self) -> list[str]:
        """The aliases of the pool that are not listed: the task finds them."""
        listed = self.listed()
        return [alias for alias in (self.pool.by_alias if self.pool else {}) if alias not in listed]

    def reveal(self, name: str) -> ToolRef | None:
        """The tool of the task called `name`, callable from now on: a listed one, or one find_tools
        finds (it stays out of the list). None for a name that is no tool of the task."""
        if name in (FIND_TOOLS, USE_TOOL):
            return None
        if name in self.refs:
            return self.refs[name]
        if self.sealed:
            return None
        if name in self.management or name in self.work:
            ref = ToolRef(BUILTIN, name, BUILTIN_SERVER, name, _native_tool(name).tier)
        elif self.pool is not None and name in self.pool.by_alias:
            tool = self.pool.by_alias[name]
            ref = ToolRef(MCP, tool.key, tool.server, tool.name, tool.tier)
        else:
            return None
        self.refs[name] = ref
        return ref

    def ref(self, name: str) -> ToolRef | None:
        """The tool called `name` that the task may call now. The worker and the CLI's MCP server offer
        the model only the listed tools; a call that reaches the core by a found tool's own name is the
        call use_tool would make."""
        return self.refs.get(name) or self.reveal(name)

    def use(self, arguments: Any) -> tuple[str, dict[str, Any]] | str:
        """The tool a use_tool call names and the arguments it gives that tool, the tool callable from
        now on; or why the call cannot be made (`USE_REFUSALS`): "bad_arguments", "unavailable" for the
        alias of a tool the owner turned off or disconnected since, "unknown_tool" for anything else."""
        if not isinstance(arguments, dict) or not isinstance(arguments.get("name"), str):
            return "bad_arguments"
        given = arguments.get("arguments", {})
        if not isinstance(given, dict):
            return "bad_arguments"
        if self.reveal(arguments["name"]) is None:
            return "unavailable" if arguments["name"] in self._aliases else "unknown_tool"
        return arguments["name"], given

    def refresh_plugins(self, plugins, member_id):
        """Read the plugins' tools again before the next call: a tool turned off or disconnected since
        can no longer be called, listed or not, and one connected since can be found. The list stays as
        it is (decision 2, above); a grant a snapshot holds is never more than the plugins hold now."""
        if self.sealed or plugins is None:
            return
        for alias, tool in self.pool.by_alias.items() if self.pool else ():
            self._aliases.setdefault(alias, tool.key)
        try:
            tools = [tool for tool in getattr(plugins, "offered_for", lambda _: plugins.offered())(member_id)
                     if self.tool_allowed(tool.key) and (tool.tier <= self.max_tier or getattr(plugins, "is_computer_tool", lambda _: False)(tool.key))]
        except Exception:
            tools = []
        native = TAKEN | self.management.keys() | self.work.keys() | {name for name, ref in self.refs.items() if ref.kind != MCP}
        by_key = {key: alias for alias, key in self._aliases.items()}
        offered = {}
        for base, tool in make_offer(tools).by_alias.items():
            alias, suffix = by_key.get(tool.key, base), 1
            while alias in native or alias in self._aliases and self._aliases[alias] != tool.key:
                suffix += 1
                alias = f"{base[:56]}_{suffix}"
            self._aliases[alias] = tool.key
            offered[alias] = tool
        self.pool = Offer(tools=list(offered.values()), by_alias=offered)
        for alias, ref in list(self.refs.items()):
            if ref.kind == MCP:
                tool = offered.get(alias)
                if tool is None:
                    del self.refs[alias]
                else:
                    self.refs[alias] = ToolRef(MCP, tool.key, tool.server, tool.name, tool.tier)

    def refresh_computer(self, plugins, member_id):
        """Refresh this member's computer offer after a grant or driver discovery: the one change the
        list takes while a task runs, since the computer's tools are the member's own machine (for a CLI
        brain, a separate MCP server). Returns whether the listed tools changed."""
        if self.sealed:
            return False
        before = {item["function"]["name"]: item for item in self.definitions
                  if item["function"]["name"].startswith("computer__")}
        old = {alias for alias, ref in self.refs.items() if ref.server == "computer"}
        listed = old & self.listed()
        for alias in old:
            self.refs.pop(alias)
        self.definitions[:] = [item for item in self.definitions if item["function"]["name"] not in listed]
        kept = [tool for tool in (self.pool.by_alias.values() if self.pool else []) if tool.server != "computer"]
        computer = [tool for tool in plugins.offered_for(member_id) if tool.server == "computer"]
        self.pool = make_offer([*kept, *computer])
        self._list([alias for alias, tool in self.pool.by_alias.items()
                    if tool.server == "computer" and (alias in listed or not tool.deferred)])
        for alias in old - listed:  # found and called through use_tool: callable still, and still not listed
            if self.pool is not None and alias in self.pool.by_alias:
                self.reveal(alias)
        self.definitions.sort(key=lambda item: item["function"]["name"])
        after = {item["function"]["name"]: item for item in self.definitions
                 if item["function"]["name"].startswith("computer__")}
        return after != before

    def find(self, query: str) -> tuple[list[dict[str, Any]], list[str]]:
        """The tools of the task that are not listed and fit `query` best, by their words: their
        definitions, and the lines the model reads (each tool's name, description and input schema).
        Nothing is listed: a found tool is called with use_tool. The calendar is listed already, but a
        model that looks for one by the owner's words is told it is there, not sent to connect another."""
        query = query.strip()
        listed = self.listed()
        if query in listed:
            return [], [f"{query} is in your list already: call it directly."]
        hidden = {name: item for name, item in self.catalog().items() if name not in listed}
        own = scored([harness_tool(name) for name in CALENDAR_TOOLS if name in listed], query)
        lines = [f"{tool.name} is in your list already: {first_sentence(tool.description, 90)}" for score, tool in own if score > 0]
        from ..management import MANAGEMENT_TOOLS, tools_for_request
        matching = tools_for_request(query)
        if (matching or query in MANAGEMENT_TOOLS) and not self.management:
            lines.append("member management is not offered in this chat")
        if query in hidden:
            chosen = [query]
        else:
            tools = {name: _native_tool(name) for name in hidden if name in self.work
                     or name in self.management and (not matching or name in matching)}
            tools.update({alias: self.pool.by_alias[alias] for alias in (self.pool.by_alias if self.pool else ())
                          if alias in hidden})
            # One ranking for Raphael's own tools and the connections': a weak match of one never crowds out a
            # strong match of the other (searching is the only way to a connection's tools).
            name_of = {id(tool): name for name, tool in tools.items()}
            chosen = [name_of[id(tool)] for score, tool in scored(list(tools.values()), query)
                      if score > 0 or name_of[id(tool)] in matching][:FIND_MAX]
        found = [hidden[name] for name in chosen]
        if found:
            lines += [FOUND, *(json.dumps(item["function"], ensure_ascii=False) for item in found)]
        elif hidden:
            names = list(hidden)
            lines.append(f"{NOTHING_FITS} The tools you can find, by name: " + ", ".join(names[:FIND_NAMES])
                         + (", …" if len(names) > FIND_NAMES else "."))
        return found, lines


def take_snapshot(
    plugins: PluginHub | None,
    *,
    memory: bool = False,
    history: bool = True,
    speaker: Speaker = RAPHAEL,
    team: Sequence[str] = (),
    max_tier: Tier = SNAPSHOT_MAX_TIER,
    interactive: bool = False,
    turned_off: Collection[str] = (),
    owner_management: bool = True,
    background_management: bool = False,
) -> Snapshot:
    """The tools a task starting now may use. What is listed follows the member and the kind of work,
    never the request (decision 2, above): with `memory`, the memory's tools that read too (the
    conversation search only with `history`: a room's turn has no conversation of its own); in the
    owner's own chat (`interactive`) the harness's tools for the owner at the PC, with the owner's
    management found (`owner_management`); in the background the owner's questions, routines and the
    memory's own tools, with member management found when the work is private
    (`background_management`). A plugin that fails to list its tools is left out. Every speaker shares
    the enabled tools and connections; `team` are the team tools allowed by the request's depth and
    cycle guards (`agent.team`: asking another member, adding one), T1 like the plugins' tools that are
    on. `turned_off` are the tools of Raphael's own that the owner switched off (`Tools.turned_off`):
    they are not offered, whatever the task or the speaker."""
    snapshot = Snapshot({}, [], max_tier=max_tier, tool_allowed=speaker.uses_plugin)

    def own(name: str, tier: Tier, item: dict[str, Any], kind: str = BUILTIN) -> None:
        snapshot.refs[name] = ToolRef(kind, name, BUILTIN_SERVER, name, tier)
        snapshot.definitions.append({"type": "function", "function": {"name": name, **item}})

    def native(name: str, item: dict[str, Any]) -> None:
        tool = harness_tool(name)
        if tool.deferred or name in SELDOM:
            snapshot.work[name] = item
        else:
            own(name, tool.tier, item)

    for name in WEB_TOOLS:
        if speaker.uses(name) and name not in turned_off:
            own(name, Tier.T0, _DEFINITIONS[name])
    for name in MEMORY_READ_TOOLS if memory and history else ():
        own(name, Tier.T0, _DEFINITIONS[name])
    for name in ATTACHMENT_TOOLS:
        if name not in turned_off:
            own(name, Tier.T0, _DEFINITIONS[name])
    snapshot.work["generate_audio"] = _DEFINITIONS["generate_audio"]
    for name in team:
        if name == "create_member":
            # The management catalog offers member_create to every owner-private chat.
            # Its legacy team alias must not consume a second native tool slot.
            continue
        if name in TEAM_TOOLS:
            snapshot.refs[name] = ToolRef(BUILTIN, name, BUILTIN_SERVER, name, TEAM_TIER)
            snapshot.definitions.append(worker_definition(name))
    # What every path has, a task that runs by itself too: the owner's daily routine adds what it finds to today.
    everywhere = ("self_check", "raphael_help", *CALENDAR_TOOLS, "connections_list",
                  *((*sorted(BACKGROUND_TOOLS), *sorted(ROUTINE_TOOLS)) if not interactive else ()))
    for name in everywhere:
        native(name, HARNESS_DEFINITIONS[name])
    if interactive:
        from ..management import MANAGEMENT_TOOLS
        for name, item in definitions_for(speaker):
            if name in everywhere:
                continue
            if name in MANAGEMENT_TOOLS:
                if owner_management:
                    snapshot.management[name] = item
                continue
            # This tool drives the owner's own desktop. Beside a computer of the speaker's own, two tools
            # called the computer would leave the choice of machine to the model.
            if name == "computer" and getattr(plugins, "has_own_computer", lambda member: False)(speaker.id):
                continue
            native(name, item)
    elif memory and history:
        for name, item in MEMORY_DEFINITIONS.items():
            own(name, harness_tool(name).tier, item)
    if background_management:
        from ..management import BACKGROUND_MEMBER_TOOLS, DEFINITIONS as management_definitions
        snapshot.management.update({name: item for name, item in management_definitions.items() if name in BACKGROUND_MEMBER_TOOLS})
    if plugins is not None:
        try:
            tools = [
                tool
                for tool in getattr(plugins, "offered_for", lambda member: plugins.offered())(speaker.id)
                if (tool.tier <= max_tier or getattr(plugins, "is_computer_tool", lambda key: False)(tool.key))
                and speaker.uses_plugin(tool.key)
            ]
        except Exception:  # a plugin that breaks leaves its tools out, not the task
            tools = []
        pool = make_offer(tools)
        clash = set(pool.by_alias) & TAKEN
        if clash:  # a plugin's tool never takes the name of one of Raphael's own
            pool = make_offer([tool for alias, tool in pool.by_alias.items() if alias not in clash])
        snapshot.pool = pool
        snapshot._list([alias for alias, tool in pool.by_alias.items() if tool.pinned and not tool.deferred])
    own(FIND_TOOLS, Tier.T0, _DEFINITIONS[FIND_TOOLS], FIND)
    own(USE_TOOL, Tier.T0, _DEFINITIONS[USE_TOOL], USE)
    snapshot.definitions.sort(key=lambda item: item["function"]["name"])
    return snapshot
