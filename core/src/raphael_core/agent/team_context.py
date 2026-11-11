"""One secret-free, content-addressed team inventory for prompts and mention menus.

The apps in it, their states and `connected` (how many of them can be called now) are the owner's
inventory as `integrations.inventory` lists it for the window: one definition of connected
(`integrations.inventory`), so a model, the sidebar and the connections page give the same number.

`primary_id` is the owner's primary contact (the member store's own: Raphael, 0, until the owner chooses
another) and `chief_id` the same role holder, also the room coordinator. Both are in the
content the `revision` is made of, so choosing another primary is a new revision, and each prompt reads
them here, fresh, on every turn: no brain is told the primary from anywhere else.
"""

import hashlib
import json
from dataclasses import asdict, dataclass, field

from ..integrations.inventory import read_inventory
from .speaker import RAPHAEL_NAMES


@dataclass(frozen=True)
class TeamContextSnapshot:
    schema_version: int
    revision: str
    self_id: int
    count: int
    primary_id: int
    chief_id: int
    members: list
    apps: list
    inventory_state: str
    room_member_ids: list | None
    # The apps whose tools can be called now; None while the inventory is not complete (never a guess).
    connected: int | None = None
    meetings: list = field(default_factory=list)

    def wire(self):
        return asdict(self)


def snapshot(team, self_id, language, room_member_ids=None):
    members = [{"id": s.id, "name": RAPHAEL_NAMES[language] if s.id == 0 else s.name,
                "role": s.role, "coordination_duty": "primary_contact" if s.is_chief else "", "blurb": s.blurb}
               for s in team.roster()]
    # Only public metadata of each app is copied, never provider configuration or credentials.
    inventory = read_inventory(team._connections)
    primary_id = team.primary_id()
    rooms = getattr(team, 'rooms', None)
    meetings = []
    if rooms is not None:
        for room in rooms.member_rooms(self_id)['rooms']:
            exchange = rooms._exchanges.latest(room['id'])
            if exchange and exchange['meeting']:
                meetings.append({'room_id':room['id'], 'origin_message_id':exchange['origin_message_id'],
                                 'state':exchange['state'], 'turns_taken':exchange['turns_taken'], 'reason':exchange['reason']})
    content = {"members": members, "apps": inventory.apps, "inventory_state": inventory.state,
               "connected": inventory.count, "primary_id": primary_id, "chief_id": primary_id, "meetings":meetings}
    revision = hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return TeamContextSnapshot(1, revision, self_id, len(members), primary_id, primary_id, members, inventory.apps,
                               inventory.state, room_member_ids, inventory.count, meetings)
