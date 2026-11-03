"""A page read without a browser says so, so a member with a computer opens a page whose text stops short."""

from raphael_core.agent.tools import READ_WITHOUT_BROWSER, Tools


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
