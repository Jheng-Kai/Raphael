"""Which machine a turn can reach: a member only its own, and the owner's desktop only through Raphael."""
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
    return SimpleNamespace(id=member_id, is_chief=member_id == 0, uses_plugin=lambda key: True, uses=lambda name: True)


def offered(member_id, plugins):
    snapshot = take_snapshot(plugins, "x", memory=False, attachments=False, speaker=speaker(member_id), max_tier=Tier.T3, interactive=True)
    return set(snapshot.refs)


def test_a_member_is_never_offered_the_owners_desktop():
    assert "computer" not in offered(1, Plugins())
    assert "computer" not in offered(1, Plugins(1))


def test_raphael_reaches_the_owners_desktop_until_he_has_a_computer_of_his_own():
    assert "computer" in offered(0, Plugins())
    assert "computer" not in offered(0, Plugins(0))


def test_a_model_is_told_to_work_where_the_owner_can_see():
    assert "browser_navigate" in _SHARED_CONTRACT and "shows them nothing" in _SHARED_CONTRACT
    assert "already has their yes" in _SHARED_CONTRACT
    assert "never to fetch a page" in EXEC["description"]
