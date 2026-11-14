"""The models Claude Code itself knows, read from the CLI's own program file.

Its `initialize` answer (models.py) names only the few models it offers the account now. The program also carries
the table it maps every model it knows to (the id the API takes, the name and version it shows, what depth of
thought the model has) and the table of the models that are retired or about to be. This reads both from the file.
It starts no CLI and no turn, reads nothing but the program and spends nothing.

This is not a public interface of the CLI, so a reader of it trusts nothing: a file that cannot be read, a table that
is not found or one that has changed its shape gives nothing, and a model is listed only when the retirement table was
read and does not name it, so that a model that no longer answers is never offered because a table was missing."""

import mmap
import re
from datetime import date
from pathlib import Path

PROGRAM_SUFFIXES = (".js", ".mjs", ".cjs")
MODEL_HEAD = re.compile(rb'\{id:"claude-[a-z0-9.-]+",family:"[a-z]+",display_name:"')
MODEL_START = re.compile(rb'(?=\{id:"claude-[a-z0-9.-]+",family:"[a-z]+",display_name:")')
MODEL = re.compile(rb'\{id:"(?P<id>claude-[a-z0-9.-]+)",family:"(?P<family>[a-z]+)",display_name:"(?P<name>[^"]{1,60})"')
FIRST_PARTY = re.compile(rb'provider_ids:\{first_party:(?:"(?P<model>[\w./-]{1,200})"|null)')
CAPABILITIES = re.compile(rb'capabilities:\[([^\]]{0,2000})\]')
DEFAULT_EFFORT = re.compile(rb'default_effort:"(\w{1,10})"')
RETIREMENT = re.compile(rb'\{family:"[^"]{1,60}",name:"[^"]{1,80}",ids:\[(?P<ids>[^\]]{1,600})\],'
                        rb'status:"(?P<status>retired|deprecated)",date:"(?P<date>\d{4}-\d{2}-\d{2})"')
# What is read of a file is kept, by the file's size and time: the program is large and is the same until it is updated.
_READ = {}


def claude_program(command):
    """The file that holds the CLI's code: the script an npm install runs, else the executable itself."""
    if not command:
        return None
    last = Path(command[-1])
    return last if last.suffix.lower() in PROGRAM_SUFFIXES and last.is_file() else Path(command[0])


def parse_models(data):
    """Every model of the registry table with an id the API takes: its id, family, name ("Opus 4.5"), the id to run,
    the depths of thought it has and its own default. Empty when the table is not there."""
    at = 0
    while True:
        at = data.find(b'{id:"claude-', at)
        if at < 0:
            return []
        if MODEL_HEAD.match(data[at:at + 160]):
            break
        at += 1
    block = data[at:at + 300_000]
    end = block.find(b"}]")
    models = []
    for chunk in MODEL_START.split(block if end < 0 else block[:end]):
        head, party = MODEL.match(chunk), FIRST_PARTY.search(chunk)
        if not head or not party or not party["model"]:
            continue
        capabilities = CAPABILITIES.search(chunk)
        flags = set(re.findall(rb'"([a-z0-9_]+)"', capabilities[1])) if capabilities else set()
        depths = [] if b"effort" not in flags else ["low", "medium", "high"] + (["xhigh"] if b"xhigh_effort" in flags else []) + \
            (["max"] if b"max_effort" in flags else [])
        default = DEFAULT_EFFORT.search(chunk)
        models.append({"id": head["id"].decode(), "family": head["family"].decode(), "name": head["name"].decode(),
                       "model": party["model"].decode(), "efforts": depths,
                       "default_effort": default[1].decode() if default else None})
    return models


def parse_retirements(data):
    """{id: (status, date)} of the models the CLI knows to be retired or to be: None when the table is not found."""
    at = 0
    while (at := data.find(b'status:"retired"', at)) >= 0:
        start = data.rfind(b'[{family:"', max(0, at - 8000), at)
        if start >= 0:
            block = data[start:start + 20_000]
            end = block.find(b"}]")
            found = {}
            for entry in RETIREMENT.finditer(block if end < 0 else block[:end]):
                for identifier in re.findall(rb'"([^"]+)"', entry["ids"]):
                    found[identifier.decode()] = (entry["status"].decode(), date.fromisoformat(entry["date"].decode()))
            if found:
                return found
        at += 1
    return None


def running(models, retirements, today):
    """The models of the registry that still run, each with `retires` (the day it stops, or None). None of them when
    the retirement table was not found: nothing can be said of what runs."""
    if retirements is None:
        return []
    kept = []
    for model in models:
        marks = [retirements[name] for name in (model["id"], model["model"]) if name in retirements]
        if any(status == "retired" or when <= today for status, when in marks):
            continue
        kept.append({**model, "retires": min((when for _, when in marks), default=None)})
    return kept


def claude_registry(command, today=None):
    """What the CLI's program says still runs; [] when it cannot be read or understood, for whatever reason: the
    list is then the CLI's own answer alone."""
    try:
        program = claude_program(command)
        stat = program.stat()
        key = (str(program), stat.st_size, stat.st_mtime_ns)
        if key not in _READ:
            with open(program, "rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
                found = (parse_models(data), parse_retirements(data))
            _READ.clear()
            _READ[key] = found
        return running(*_READ[key], today or date.today())
    except Exception:  # noqa: BLE001 - someone else's file: whatever it trips on, the list stays the CLI's own answer
        return []
