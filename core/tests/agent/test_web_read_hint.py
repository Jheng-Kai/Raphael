"""A page read without a browser says so, so a member with a computer opens a page whose text stops short."""

from raphael_core.agent.tools import READ_NEEDS_BROWSER, READ_WITHOUT_BROWSER, Tools
from raphael_core.agent.plugins import PluginResult


class _Services:
    def enabled(self, name):
        return name == "read"

    def read_service(self):
        return "builtin"

    async def read(self, url):
        return "builtin", {"title": "News", "text": "Only the lead paragraph.", "truncated": False}


async def test_a_page_read_without_a_browser_says_to_open_it_when_its_text_stops_short():
    result = await Tools(object(), services=_Services()).web_read("https://news.example/item")
    assert result.ok and result.untrusted
    assert result.data["text"] == "Only the lead paragraph."
    assert result.data["if_incomplete"] == READ_WITHOUT_BROWSER
    assert "open the page in its browser" in READ_WITHOUT_BROWSER


async def test_thin_page_escalates_to_the_member_browser_without_a_paid_reader():
    seen = []
    async def rendered(url):
        seen.append(url)
        return PluginResult(True, text='Rendered article after rejecting nonessential cookies')
    result = await Tools(object(), services=_Services(), rendered_read=rendered).web_read('https://news.example/item')
    assert result.ok and result.untrusted and result.detail == 'member_browser'
    assert result.data['rendered'] and result.data['cookie_policy'] == 'reject_nonessential'
    assert seen == ['https://news.example/item']


async def test_owner_hold_never_becomes_a_rendered_read_success():
    async def held(url): return PluginResult(False, 'owner_holds_control')
    result = await Tools(object(), services=_Services(), rendered_read=held).web_read('https://news.example/item')
    assert result.data['rendered_error'] == 'owner_holds_control'
    assert 'rendered' not in result.data


async def test_a_sleeping_computer_is_not_woken_to_read_a_page_and_the_member_is_told_to_choose():
    async def asleep(url): return PluginResult(False, 'computer_asleep')
    result = await Tools(object(), services=_Services(), rendered_read=asleep).web_read('https://news.example/item')
    assert result.ok and result.data['text'] == 'Only the lead paragraph.'
    assert result.data['rendered_error'] == 'computer_asleep' and 'rendered' not in result.data
    assert result.data['if_incomplete'] == READ_NEEDS_BROWSER != READ_WITHOUT_BROWSER
    assert 'browser_open' in READ_NEEDS_BROWSER and 'asleep' in READ_NEEDS_BROWSER and 'wakes the computer' in READ_NEEDS_BROWSER


async def test_an_unreadable_page_of_a_sleeping_computer_tells_the_member_the_same():
    from raphael_core.services.common import ServiceError
    class Unreadable(_Services):
        async def read(self, url): raise ServiceError('bad_response')
    async def asleep(url): return PluginResult(False, 'computer_asleep')
    result = await Tools(object(), services=Unreadable(), rendered_read=asleep).web_read('https://news.example/item')
    assert not result.ok and result.error == 'bad_response' and result.instruction == READ_NEEDS_BROWSER
