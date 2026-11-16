"""Which machine a turn can show things on: its own computer, and in a quick question the owner's desktop beside it."""
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


def test_a_quick_question_offers_the_owners_desktop_beside_a_computer_of_the_speakers_own():
    # The owner's PC is a quick question's default; the owner's words name the member's own computer when it is meant, and
    # the model picks (R-PC-01): nothing takes the desktop away because the member has a computer too.
    assert "computer" in offered(1, Plugins(1), owner_screen=True)
    assert "computer" in offered(0, Plugins(0), owner_screen=True)


def test_only_a_quick_question_keeps_the_guarded_desktop():
    # R-PC-01: a conversation that has no computer of its own has none, it is not handed the owner's.
    assert "computer" in offered(1, Plugins(), owner_screen=True)
    assert "computer" in offered(0, Plugins(), owner_screen=True)
    for member, plugins in ((1, Plugins()), (0, Plugins()), (1, Plugins(2)), (1, Plugins(1))):
        assert "computer" not in offered(member, plugins)


def test_a_model_is_told_to_work_where_the_owner_can_see():
    assert "browser_navigate" in _SHARED_CONTRACT and "shows them nothing" in _SHARED_CONTRACT
    # What the driver refuses without them, and what keeps a sign-in.
    assert "isolated_named" in _SHARED_CONTRACT and "get_browser_state" in _SHARED_CONTRACT and "http.server" in _SHARED_CONTRACT
    assert "already has their yes" in _SHARED_CONTRACT
    assert "never to fetch a page" in EXEC["description"]
