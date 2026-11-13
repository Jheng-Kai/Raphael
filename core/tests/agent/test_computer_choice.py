"""Which machine a turn can reach: its own computer when it has one, never that and the owner's desktop together."""
from types import SimpleNamespace

from raphael_core.agent.persona import _SHARED_CONTRACT
from raphael_core.agent.policy import Tier
from raphael_core.background.snapshot import take_snapshot
from raphael_core.computer.vm_tools import EXEC


class Plugins:
    def __init__(self, *granted):
        self.granted = granted

    def offered_for(self, member_id):
        return []

    def has_own_computer(self, member_id):
        return member_id in self.granted


def speaker(member_id):
    return SimpleNamespace(id=member_id, is_chief=member_id == 0, depth=0, has_no_job=False, uses_plugin=lambda key: True, uses=lambda name: True)


def offered(member_id, plugins, **more):
    """What the turn can reach: listed, or found with find_tools (the desktop is seldom called, so it is found)."""
    snapshot = take_snapshot(plugins, memory=False, speaker=speaker(member_id), max_tier=Tier.T3, interactive=True, **more)
    return set(snapshot.refs) | set(snapshot.work)


def test_a_speaker_with_a_computer_of_its_own_is_not_also_offered_the_owners_desktop():
    assert "computer" not in offered(1, Plugins(1), owner_pc=True)
    assert "computer" not in offered(0, Plugins(0), owner_pc=True)


def test_only_a_quick_question_keeps_the_guarded_desktop():
    # R-PC-01: a conversation that has no computer of its own has none, it is not handed the owner's.
    assert "computer" in offered(1, Plugins(), owner_pc=True)
    assert "computer" in offered(0, Plugins(), owner_pc=True)
    for member, plugins in ((1, Plugins()), (0, Plugins()), (1, Plugins(2)), (1, Plugins(1))):
        assert "computer" not in offered(member, plugins)


def test_a_model_is_told_to_work_where_the_owner_can_see():
    assert "browser_navigate" in _SHARED_CONTRACT and "shows them nothing" in _SHARED_CONTRACT
    # What the driver refuses without them, and what keeps a sign-in.
    assert "isolated_named" in _SHARED_CONTRACT and "get_browser_state" in _SHARED_CONTRACT and "http.server" in _SHARED_CONTRACT
    assert "already has their yes" in _SHARED_CONTRACT
    assert "never to fetch a page" in EXEC["description"]
