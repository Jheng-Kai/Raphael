"""Tests for the tools: the weather from Open-Meteo, a web search, and the local time.

Open-Meteo is an httpx.MockTransport and OpenRouter a fake, so no test touches the network.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from raphael_core.agent import tools as tools_module
from raphael_core.agent.ledger import Ledger
from raphael_core.agent.tools import (
    SEARCH_PLUGINS,
    SKIES,
    ToolResult,
    Tools,
    sky_of,
)
from raphael_core.brain.openrouter import OpenRouterError, TextCompletion
from raphael_core.brain.spend import SpendTracker

GEOCODING = {
    "results": [
        {
            "id": 1668341,
            "name": "Taipei",
            "latitude": 25.04776,
            "longitude": 121.53185,
            "country": "Taiwan",
            "admin1": "Taipei City",
            "timezone": "Asia/Taipei",
        }
    ],
    "generationtime_ms": 0.5,
}
FORECAST = {
    "latitude": 25.05,
    "longitude": 121.5,
    "timezone": "Asia/Taipei",
    "current": {"time": "2026-10-20T14:00", "interval": 900, "temperature_2m": 24.1,
                "weather_code": 2, "apparent_temperature": 25.4, "relative_humidity_2m": 74,
                "wind_speed_10m": 18.3},
    "hourly": {
        "time": ["2026-10-20T14:00", "2026-10-20T15:00", "2026-10-20T16:00"],
        "temperature_2m": [24.1, 23.5, None],
        "precipitation_probability": [30, 40, None],
        "weather_code": [2, 61, 3],
    },
    "daily": {
        "time": ["2026-10-20", "2026-10-21", "2026-10-22"],
        "temperature_2m_max": [27.3, 26.0, 25.0],
        "temperature_2m_min": [21.0, 20.5, 19.0],
        "precipitation_probability_max": [40, 70, 10],
        "weather_code": [3, 61, 0],
    },
}  # fmt: skip
# What Open-Meteo sends when it has none of the extras: the same forecast as before they were asked for.
PLAIN_FORECAST = {
    "current": {"time": "2026-10-20T14:00", "temperature_2m": 24.1, "weather_code": 2},
    "daily": {
        "time": ["2026-10-20", "2026-10-21"],
        "temperature_2m_max": [27.3, 26.0],
        "temperature_2m_min": [21.0, 20.5],
        "precipitation_probability_max": [40, 70],
        "weather_code": [3, 61],
    },
}  # fmt: skip


class OpenMeteo:
    """An httpx client whose server is Open-Meteo, as the test scripts it."""

    def __init__(self, geocoding=GEOCODING, forecast=FORECAST):
        self.geocoding = geocoding
        self.forecast = forecast
        self.requests: list[httpx.Request] = []
        self.http = httpx.AsyncClient(transport=httpx.MockTransport(self._handle))

    async def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host = request.url.host
        reply = self.geocoding if host == "geocoding-api.open-meteo.com" else self.forecast
        if isinstance(reply, httpx.Response):
            return reply
        if callable(reply):
            return await reply(request)
        return httpx.Response(200, json=reply)


@pytest.fixture
async def meteo():
    server = OpenMeteo()
    yield server
    await server.http.aclose()


@pytest.fixture
def tools(client, meteo):
    return Tools(client, http=meteo.http, now=lambda: NOW)


NOW = datetime(2026, 10, 20, 14, 5, 9, tzinfo=timezone(timedelta(hours=8)))


# --- the weather ---------------------------------------------------------------------------------


async def test_the_weather_is_looked_up_by_city_then_by_place(tools, meteo):
    result = await tools.weather("Reykjavik", "zh-TW")
    geocoding, forecast = meteo.requests
    assert (geocoding.method, geocoding.url.host, geocoding.url.path) == (
        "GET",
        "geocoding-api.open-meteo.com",
        "/v1/search",
    )
    assert dict(geocoding.url.params) == {"name": "Reykjavik", "count": "1", "language": "zh"}
    assert (forecast.url.host, forecast.url.path) == ("api.open-meteo.com", "/v1/forecast")
    assert dict(forecast.url.params) == {
        "latitude": "25.04776",
        "longitude": "121.53185",
        "current": "temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m",
        "hourly": "temperature_2m,precipitation_probability,weather_code",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
        "timezone": "auto",
        "forecast_hours": "12",
        "forecast_days": "7",
    }
    assert isinstance(result, ToolResult) and result.name == "weather" and result.ok


async def test_the_weather_asks_which_city_when_none_is_known_and_looks_nothing_up(tools, meteo):
    # R-DEFAULT-01: nobody's city is a default. No city is no request to Open-Meteo, and the answer is told to ask.
    for blank in ("", "  \n"):
        result = await tools.weather(blank, "zh-TW")
        assert not result.ok and result.error == "needs_city"
        assert "Ask the user which city" in result.instruction
    assert meteo.requests == []


async def test_the_weather_is_the_place_now_today_and_tomorrow(tools, meteo):
    meteo.forecast = PLAIN_FORECAST
    result = await tools.weather("Taipei", "zh-TW")
    assert result.data == {
        "city": "Taipei",
        "now": {"temperature_c": 24.1, "sky": "partly cloudy"},
        "today": {
            "low_c": 21.0,
            "high_c": 27.3,
            "rain_chance_percent": 40,
            "sky": "overcast",
        },
        "tomorrow": {
            "low_c": 20.5,
            "high_c": 26.0,
            "rain_chance_percent": 70,
            "sky": "slight rain",
        },
        "days": [
            {"date": "2026-10-20", "low_c": 21.0, "high_c": 27.3, "rain_chance_percent": 40, "sky": "overcast"},
            {"date": "2026-10-21", "low_c": 20.5, "high_c": 26.0, "rain_chance_percent": 70, "sky": "slight rain"},
        ],
        "source": "Open-Meteo",
        "updated": "14:00",
    }
    assert result.error is None


async def test_the_weather_adds_feels_like_humidity_wind_hours_days_source_and_time(tools):
    data = (await tools.weather("Taipei", "zh-TW")).data
    assert data["now"] == {"temperature_c": 24.1, "sky": "partly cloudy", "feels_like_c": 25.4,
                           "humidity_percent": 74, "wind_kmh": 18.3}
    assert data["hours"] == [
        {"time": "14:00", "temperature_c": 24.1, "rain_chance_percent": 30, "sky": "partly cloudy"},
        {"time": "15:00", "temperature_c": 23.5, "rain_chance_percent": 40, "sky": "slight rain"},
        {"time": "16:00", "sky": "overcast"},  # what an hour lacks is left out
    ]
    assert [day["date"] for day in data["days"]] == ["2026-10-20", "2026-10-21", "2026-10-22"]
    assert data["days"][2] == {"date": "2026-10-22", "low_c": 19.0, "high_c": 25.0, "rain_chance_percent": 10, "sky": "clear sky"}
    assert (data["today"], data["tomorrow"]) == (
        {"low_c": 21.0, "high_c": 27.3, "rain_chance_percent": 40, "sky": "overcast"},
        {"low_c": 20.5, "high_c": 26.0, "rain_chance_percent": 70, "sky": "slight rain"})
    assert (data["source"], data["updated"]) == ("Open-Meteo", "14:00")


async def test_the_hours_and_days_are_capped_and_a_malformed_one_is_left_out(tools, meteo):
    times = [f"2026-10-20T{hour:02d}:00" for hour in range(24)]
    meteo.forecast = {
        "current": {"time": "soon", "temperature_2m": 18.0},
        "hourly": {"time": ["tomorrow", *times], "temperature_2m": list(range(25))},
        "daily": {"time": ["x", *[f"2026-10-{20 + n}" for n in range(9)]], "temperature_2m_max": list(range(10))},
    }
    data = (await tools.weather("Taipei", "en")).data
    assert len(data["hours"]) == 12 and data["hours"][0] == {"time": "00:00", "temperature_c": 1}
    assert len(data["days"]) == 7 and data["days"][0] == {"date": "2026-10-20", "high_c": 1}
    assert "updated" not in data  # a time that is not one is not said


@pytest.mark.parametrize("extras", [{"hourly": "soon"}, {"hourly": {"time": 5}}, {"hourly": {}}, {"daily": {"time": "x"}}])
async def test_a_forecast_whose_hours_or_days_are_unusable_still_answers_with_the_rest(tools, meteo, extras):
    meteo.forecast = {**PLAIN_FORECAST, **extras}
    data = (await tools.weather("Taipei", "en")).data
    assert data["now"] == {"temperature_c": 24.1, "sky": "partly cloudy"} and "hours" not in data
    assert data["source"] == "Open-Meteo"
    if "daily" not in extras:
        assert data["days"] and data["today"]


@pytest.mark.parametrize(("language", "code"), [("zh-TW", "zh"), ("en", "en"), ("ja", "ja")])
async def test_the_place_is_named_in_the_language_of_the_user(tools, meteo, language, code):
    await tools.weather("Reykjavik", language)
    assert meteo.requests[0].url.params["language"] == code


async def test_what_the_user_called_the_place_is_kept_when_the_geocoder_names_it_otherwise(tools):
    assert (await tools.weather("台北", "zh-TW")).data["asked_for"] == "台北"
    assert "asked_for" not in (await tools.weather("taipei ", "en")).data  # the same name


@pytest.mark.parametrize(
    ("city", "english"),
    [
        ("台北", "Taipei"),  # the default city: the geocoder finds nothing for it as written
        ("  台北 ", "Taipei"),
        ("臺北市", "Taipei"),
        ("台　北", "Taipei"),  # a full-width space
        ("高雄", "Kaohsiung"),  # which as written is a place in China
        ("台中", "Taichung"),
        ("東京", "Tokyo"),
        ("東京都", "Tokyo"),
        ("とうきょう", "Tokyo"),
        ("大阪", "Osaka"),
        ("紐約", "New York"),
        ("ニューヨーク", "New York"),
    ],
)
async def test_a_known_city_is_asked_for_by_its_english_name_in_english(
    tools, meteo, city, english
):
    for language in ("zh-TW", "en", "ja"):
        meteo.requests.clear()
        await tools.weather(city, language)
        assert dict(meteo.requests[0].url.params) == {
            "name": english,
            "count": "1",
            "language": "en",
        }
        assert len(meteo.requests) == 2  # the place, then the forecast


async def test_a_chinese_city_not_in_the_table_is_asked_for_as_it_is_then_as_a_city(
    client, meteo
):
    async def geocoder(request):
        name = request.url.params["name"]
        return httpx.Response(200, json=GEOCODING if name == "羅東市" else {})

    meteo.geocoding = geocoder
    result = await Tools(client, http=meteo.http, now=lambda: NOW).weather("羅東", "zh-TW")
    assert result.ok
    asked = [dict(r.url.params) for r in meteo.requests if "geocoding" in r.url.host]
    assert asked == [
        {"name": "羅東", "count": "1", "language": "zh"},
        {"name": "羅東市", "count": "1", "language": "zh"},
    ]


async def test_a_name_that_is_a_place_already_or_not_chinese_is_asked_for_once(client, meteo):
    meteo.geocoding = {}
    tools = Tools(client, http=meteo.http, now=lambda: NOW)
    for city in ("羅東市", "宜蘭縣", "Reykjavik", "Åre"):
        meteo.requests.clear()
        result = await tools.weather(city, "en")
        assert (result.ok, result.error) == (False, "not_found")
        assert len(meteo.requests) == 1, city


async def test_a_city_that_is_not_found_is_said_so_and_the_forecast_is_not_asked(tools, meteo):
    meteo.geocoding = {"generationtime_ms": 0.4}  # no "results"
    result = await tools.weather("Atlantis", "en")
    assert (result.ok, result.error, result.data) == (False, "not_found", None)
    assert len(meteo.requests) == 1
    assert all(r.url.host != "api.open-meteo.com" for r in meteo.requests)  # no forecast


async def test_what_the_forecast_lacks_is_left_out(tools, meteo):
    meteo.forecast = {
        "current": {"temperature_2m": 18.0, "weather_code": 0},
        "daily": {
            "temperature_2m_max": [20.0, None],
            "temperature_2m_min": [None, 12.0],
            "precipitation_probability_max": [None, None],
            "weather_code": [1, None],
        },
    }
    result = await tools.weather("台北", "zh-TW")
    assert result.ok
    assert result.data["now"] == {"temperature_c": 18.0, "sky": "clear sky"}
    assert result.data["today"] == {"high_c": 20.0, "sky": "mainly clear"}
    assert result.data["tomorrow"] == {"low_c": 12.0}


async def test_a_forecast_without_anything_to_say_is_a_bad_response(tools, meteo):
    meteo.forecast = {"latitude": 1.0}
    result = await tools.weather("台北", "zh-TW")
    assert (result.ok, result.error) == (False, "bad_response")


@pytest.mark.parametrize("forecast", [[], "text", {"current": "warm", "daily": 5}])
async def test_a_forecast_of_the_wrong_shape_is_a_bad_response(tools, meteo, forecast):
    meteo.forecast = forecast
    result = await tools.weather("台北", "zh-TW")
    assert (result.ok, result.error) == (False, "bad_response")


@pytest.mark.parametrize(
    "geocoding",
    [{"results": []}, {"results": [{"name": "x"}]}, {"results": [5]}, {"results": "x"}, []],
)
async def test_a_place_without_coordinates_is_not_found_or_a_bad_response(tools, meteo, geocoding):
    meteo.geocoding = geocoding
    result = await tools.weather("台北", "zh-TW")
    assert result.ok is False and result.error in ("not_found", "bad_response")
    assert len(meteo.requests) == 1


@pytest.mark.parametrize(
    ("which", "kind"),
    [("geocoding", "http_error"), ("forecast", "http_error")],
)
async def test_a_server_error_is_an_http_error(tools, meteo, which, kind):
    setattr(meteo, which, httpx.Response(503, text="down"))
    result = await tools.weather("台北", "zh-TW")
    assert (result.ok, result.error) == (False, kind)


async def test_a_page_that_is_not_json_is_a_bad_response(tools, meteo):
    meteo.forecast = httpx.Response(200, text="<html>captive portal</html>")
    result = await tools.weather("台北", "zh-TW")
    assert (result.ok, result.error) == (False, "bad_response")


async def test_no_connection_is_a_network_error(client):
    def refuse(request):
        raise httpx.ConnectError("no route")

    http = httpx.AsyncClient(transport=httpx.MockTransport(refuse))
    try:
        result = await Tools(client, http=http, now=lambda: NOW).weather("台北", "zh-TW")
    finally:
        await http.aclose()
    assert (result.ok, result.error) == (False, "network")


async def test_a_server_that_does_not_answer_in_time_is_a_timeout(client, meteo, monkeypatch):
    async def never(request):
        await asyncio.sleep(30)

    meteo.geocoding = never
    monkeypatch.setattr(tools_module, "WEATHER_TIMEOUT_S", 0.1)
    started = asyncio.get_running_loop().time()
    result = await Tools(client, http=meteo.http, now=lambda: NOW).weather("台北", "zh-TW")
    assert (result.ok, result.error) == (False, "timeout")
    assert asyncio.get_running_loop().time() - started < 5


@pytest.mark.parametrize("which", ["geocoding", "forecast"])
async def test_a_request_whose_try_timed_out_is_asked_once_more_and_answers(client, meteo, which, caplog):
    # Five lookups failed after 6.4 s each: one try waited out its five seconds and the eight left no time for another.
    answer = getattr(meteo, which)
    tries = []

    async def slow_once(request):
        tries.append(request)
        if len(tries) == 1:
            raise httpx.ReadTimeout("no answer", request=request)
        return httpx.Response(200, json=answer)

    setattr(meteo, which, slow_once)
    with caplog.at_level(logging.INFO, logger=tools_module.logger.name):
        result = await Tools(client, http=meteo.http, now=lambda: NOW).weather("台北", "zh-TW")
    assert result.ok and result.data["now"]["temperature_c"] == 24.1
    assert len(tries) == 2 and len(meteo.requests) == 3
    stage = "place" if which == "geocoding" else "forecast"
    assert f"{stage} request failed on try 1 of 2" in caplog.text and "ReadTimeout" in caplog.text
    assert "台北" not in caplog.text and "Taipei" not in caplog.text


async def test_a_try_that_hangs_is_cut_short_so_a_second_fits_the_budget(client, meteo, monkeypatch):
    hung = []

    async def hangs_once(request):
        hung.append(request.extensions["timeout"]["read"])
        if len(hung) == 1:
            await asyncio.sleep(30)
        return httpx.Response(200, json=GEOCODING)

    meteo.geocoding = hangs_once
    monkeypatch.setattr(tools_module, "WEATHER_TRY_S", 0.2)
    monkeypatch.setattr(tools_module, "WEATHER_TIMEOUT_S", 3.0)
    started = asyncio.get_running_loop().time()
    result = await Tools(client, http=meteo.http, now=lambda: NOW).weather("台北", "zh-TW")
    assert result.ok and len(hung) == 2
    assert asyncio.get_running_loop().time() - started < 2.5
    assert all(wait <= 0.2 for wait in hung), "each try asks httpx for no more than its own share"


async def test_a_request_that_never_answers_is_tried_twice_and_is_a_timeout(client, meteo, monkeypatch):
    tried = []

    async def never(request):
        tried.append(request)
        await asyncio.sleep(30)

    meteo.geocoding = never
    monkeypatch.setattr(tools_module, "WEATHER_TRY_S", 0.05)
    monkeypatch.setattr(tools_module, "WEATHER_TIMEOUT_S", 2.0)
    result = await Tools(client, http=meteo.http, now=lambda: NOW).weather("台北", "zh-TW")
    assert (result.ok, result.error) == (False, "timeout") and len(tried) == 2


async def test_an_error_page_is_not_asked_for_again(tools, meteo):
    meteo.forecast = httpx.Response(503, text="down")
    result = await tools.weather("台北", "zh-TW")
    assert (result.ok, result.error) == (False, "http_error") and len(meteo.requests) == 2


async def test_the_weather_never_logs_the_city_or_the_place(tools, meteo, caplog):
    meteo.forecast = httpx.Response(500, text="down")
    with caplog.at_level(logging.DEBUG, logger=tools_module.logger.name):
        await tools.weather("我家那條秘密巷子", "zh-TW")
    assert "秘密" not in caplog.text and "台北" not in caplog.text


async def test_the_weather_does_not_ask_openrouter_or_cost_anything(tools, client):
    await tools.weather("台北", "zh-TW")
    assert client.calls == 0


async def test_without_an_http_client_of_its_own_one_is_made_and_closed(client):
    own = Tools(client, now=lambda: NOW)
    assert own._http is None
    http = own._http_client()
    assert own._http_client() is http  # once
    await own.aclose()
    assert http.is_closed
    await own.aclose()  # again: nothing to do


async def test_a_client_that_was_given_is_not_closed_with_the_tools(client, meteo):
    await Tools(client, http=meteo.http).aclose()
    assert not meteo.http.is_closed


@pytest.mark.parametrize(
    ("code", "sky"),
    [
        (0, "clear sky"),
        (1, "mainly clear"),
        (2, "partly cloudy"),
        (3, "overcast"),
        (45, "fog"),
        (51, "light drizzle"),
        (61, "slight rain"),
        (63, "moderate rain"),
        (65, "heavy rain"),
        (71, "slight snow"),
        (80, "slight rain showers"),
        (95, "thunderstorm"),
        (99, "thunderstorm with heavy hail"),
    ],
)
def test_a_weather_code_is_a_sky(code, sky):
    assert sky_of(code) == sky


@pytest.mark.parametrize("code", [None, "3", 3.5, 4, 100, -1, True, [3]])
def test_a_code_that_is_none_of_them_is_no_sky(code):
    assert sky_of(code) is None


def test_a_code_written_as_a_whole_float_is_the_same_code():
    assert sky_of(3.0) == "overcast"


def test_every_wmo_code_open_meteo_documents_has_a_sky():
    documented = {0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80,
                  81, 82, 85, 86, 95, 96, 99}  # fmt: skip
    assert set(SKIES) == documented


# --- the web ---------------------------------------------------------------------------------------


def found(text="Rain is likely tomorrow in Taipei.", cost=0.012, sources=None):
    return TextCompletion(
        text=text,
        model="openai/gpt-6-luna",
        cost_usd=cost,
        prompt_tokens=900,
        completion_tokens=40,
        latency_ms=2100,
        sources=[{"title": "CWA", "url": "https://www.cwa.gov.tw/"}] if sources is None else sources,
    )


@pytest.fixture
def ledger(conn):
    return Ledger(SpendTracker(conn, now_ms=lambda: 1_000))


async def test_a_search_asks_the_model_with_the_web_plugin_and_returns_what_it_found(
    tools, client, ledger
):
    client.texts.append(found())
    result = await tools.web_search("明天台北會下雨嗎", "openai/gpt-6-luna", ledger)
    call = client.text_calls[0]
    assert call["model"] == "openai/gpt-6-luna"
    assert call["user"] == "明天台北會下雨嗎"  # the question, as it was asked
    assert call["plugins"] == SEARCH_PLUGINS == [{"id": "web"}]
    assert call["reasoning_effort"] == "none"
    assert call["timeout_s"] > 0 and call["max_tokens"] > 0
    assert "web results" in call["system"] and "three" in call["system"]
    assert (result.name, result.ok, result.error) == ("web_search", True, None)
    assert result.data == {
        "answer": "Rain is likely tomorrow in Taipei.",
        "sources": [{"title": "CWA", "url": "https://www.cwa.gov.tw/"}],
    }


async def test_a_search_is_paid_for_and_written_in_the_spend(tools, client, ledger, conn):
    client.texts.append(found(cost=0.0123))
    result = await tools.web_search("q", "openai/gpt-6-luna", ledger)
    assert result.ok and ledger.total == pytest.approx(0.0123)
    assert [tuple(r) for r in conn.execute("SELECT purpose, model, cost_usd FROM spend")] == [
        ("agent", "openai/gpt-6-luna", 0.0123)
    ]


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (OpenRouterError(0, "timeout", "slow"), "timeout"),
        (OpenRouterError(0, "network", "offline"), "network"),
        (OpenRouterError(503, "server", "down"), "server"),
        (OpenRouterError(401, "auth", "no"), "auth"),
        (OpenRouterError(402, "credits", "broke"), "credits"),
    ],
)
async def test_a_search_that_fails_says_which_way_and_costs_nothing(
    tools, client, ledger, error, kind
):
    client.texts.append(error)
    result = await tools.web_search("q", "m", ledger)
    assert (result.ok, result.error, result.data) == (False, kind, None)
    assert ledger.total == 0.0


async def test_a_search_that_takes_too_long_is_a_timeout(tools, client, ledger, monkeypatch):
    client.delay = 30
    client.texts.append(found())
    monkeypatch.setattr(tools_module, "SEARCH_TIMEOUT_S", 0.1)
    result = await tools.web_search("q", "m", ledger)
    assert (result.ok, result.error) == (False, "timeout")


async def test_a_search_never_logs_the_question_or_the_answer(tools, client, ledger, caplog):
    client.texts.append(OpenRouterError(503, "server", "秘密 message"))
    with caplog.at_level(logging.DEBUG, logger=tools_module.logger.name):
        await tools.web_search("我的秘密問題", "m", ledger)
    assert "秘密" not in caplog.text


# --- the time --------------------------------------------------------------------------------------


def test_the_local_time_is_the_date_the_weekday_the_time_and_the_offset(tools):
    result = tools.local_time()
    assert (result.name, result.ok, result.error) == ("local_time", True, None)
    assert result.data == {
        "iso": "2026-10-20T14:05:09+08:00",
        "date": "2026-10-20",
        "weekday": "Tuesday",
        "time": "14:05",
        "utc_offset": "UTC+08:00",
    }


@pytest.mark.parametrize(
    ("offset", "text"),
    [(0, "UTC+00:00"), (-5, "UTC-05:00"), (5.5, "UTC+05:30"), (-3.5, "UTC-03:30")],
)
def test_the_offset_is_written_with_its_sign_and_minutes(client, offset, text):
    zone = timezone(timedelta(hours=offset))
    tools = Tools(client, now=lambda: datetime(2026, 1, 1, 12, tzinfo=zone))
    assert tools.local_time().data["utc_offset"] == text


def test_the_weekday_is_english_whatever_the_locale_of_the_machine(client):
    names = []
    for day in range(7):
        tools = Tools(client, now=lambda day=day: datetime(2026, 10, 19 + day, 9, tzinfo=timezone.utc))
        names.append(tools.local_time().data["weekday"])
    assert names == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def test_the_default_clock_is_the_local_time(client):
    data = Tools(client).local_time().data
    assert datetime.fromisoformat(data["iso"]).tzinfo is not None


# --- the log -----------------------------------------------------------------------------------------


def test_the_address_of_an_open_meteo_request_is_kept_out_of_the_log_and_others_are_not(caplog):
    httpx_log = logging.getLogger("httpx")
    with caplog.at_level(logging.INFO, logger="httpx"):
        httpx_log.info(
            'HTTP Request: GET https://geocoding-api.open-meteo.com/v1/search?name=%E5%8F%B0 "200 OK"'
        )
        httpx_log.info('HTTP Request: POST https://openrouter.ai/api/v1/chat/completions "200 OK"')
    assert "open-meteo" not in caplog.text
    assert "openrouter.ai" in caplog.text


def test_the_web_search_may_correct_a_term_speech_recognition_misheard():
    system = tools_module._SEARCH_SYSTEM
    assert "misheard" in system and "speech" in system
    assert "say which" in system  # the correction is named, not silent
