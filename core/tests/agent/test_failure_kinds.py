"""What kind of failure a model call was: a context that does not fit is never a refusal, a spent quota is never a
throttle, and a throttle says how long to wait. The error words are the ones providers send."""

import re
import time

import httpx
import pytest

from raphael_core.agent.failure import AgentFailure
from raphael_core.brain.openrouter import OpenRouterClient, OpenRouterError
from raphael_core.failures import KINDS, TRANSIENT, Failure, _OWNER_MESSAGES, classify, is_context_overflow

OVERFLOW = [
    "This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens. Please reduce the length of the messages.",
    "prompt is too long: 215000 tokens > 200000 maximum",
    "The input token count (1200000) exceeds the maximum number of tokens allowed (1048575).",
    "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
    "the request exceeds the available context size, try increasing it",
    "Requested tokens (9000) exceed context window of 8192",
    "The input (516368 tokens) is longer than the model's context length (262144 tokens).",
    '{"error": {"code": "1210", "message": "tokens in request more than max tokens allowed"}}',
    "超過最大長度的上下文長度",
]


async def failing(status, body, headers=None):
    transport = httpx.MockTransport(lambda request: httpx.Response(status, json=body, headers=headers))
    async with httpx.AsyncClient(transport=transport) as http:
        client = OpenRouterClient(lambda: "sk-or-v1-test", http=http)
        with pytest.raises(OpenRouterError) as error:
            await client.chat_tools(model="m", fallbacks=[], messages=[{"role": "user", "content": "x"}], tools=[],
                                    timeout_s=5, max_tokens=10)
    return error.value


@pytest.mark.parametrize("message", OVERFLOW)
async def test_a_context_that_does_not_fit_is_neither_a_bad_request_nor_a_refusal(message):
    error = await failing(400, {"error": {"message": message}})
    assert error.kind == "context_overflow"
    assert classify(error).kind == "context_overflow" and is_context_overflow(error)
    assert not classify(error).transient


async def test_the_code_a_provider_gives_is_enough():
    assert classify({"error": {"code": "context_length_exceeded", "message": "x"}}).kind == "context_overflow"
    assert is_context_overflow({"error": {"code": "context_length_exceeded"}})


@pytest.mark.parametrize(
    "value",
    [
        "Rate limit reached for gpt-6 on tokens per minute (TPM): Limit 30000, Used 29000, Requested 4000. Try again in 6s.",
        "Throttling error: Too many tokens, please wait before trying again.",
        "Invalid parameter: max_tokens must be a positive integer",
        "The server had an error while processing your request",
    ],
)
def test_other_failures_that_name_tokens_are_not_an_overflow(value):
    assert not is_context_overflow(value) and not is_context_overflow(OpenRouterError(429, "rate_limit", value))


async def test_a_request_too_big_to_send_is_its_own_kind():
    error = await failing(413, {"error": {"message": "Request Entity Too Large"}})
    assert error.kind == "payload_too_large" and classify(error).kind == "payload_too_large"
    assert classify("request_too_large: Request exceeds the maximum size").kind == "payload_too_large"


async def test_a_prompt_the_provider_will_not_serve_is_a_content_policy_failure_not_a_refusal_of_the_owner():
    error = await failing(400, {"error": {"message": "Your request was flagged by our content filter."}})
    assert error.kind == "content_policy" and classify(error).kind == "content_policy"
    assert classify({"error": {"code": "content_policy_violation", "message": "x"}}).kind == "content_policy"
    # What the owner said no to stays a refusal.
    assert classify(OpenRouterError(0, "refused", "the owner said no to this")).kind == "refused"
    assert classify(OpenRouterError(400, "bad_request", "unknown field")).kind == "refused"


@pytest.mark.parametrize(
    ("message", "kind"),
    [
        ("You exceeded your current quota, please check your plan and billing details.", "credits"),
        ("Your credit balance is too low to access the API. Top up your credits.", "credits"),
        ("The usage limit has been reached", "usage_limit"),
        ("You have hit your weekly limit; it resets in 20hr", "usage_limit"),
        ("Resource has been exhausted (e.g. check quota).", "usage_limit"),
        ("Rate limit reached for requests per minute. Try again in 6s.", "rate_limit"),
        ("Quota exceeded for metric generate_content_requests. Please retry in 12s.", "rate_limit"),
        ("Too many requests", "rate_limit"),
    ],
)
async def test_a_429_that_is_a_spent_quota_is_not_a_throttle(message, kind):
    error = await failing(429, {"error": {"message": message}})
    assert classify(error).kind == kind
    assert (kind in TRANSIENT) == classify(error).transient


async def test_what_the_provider_says_of_the_wait_is_kept_with_the_failure():
    error = await failing(429, {"error": {"message": "slow down"}}, headers={"Retry-After": "45"})
    failure = classify(error)
    assert failure.kind == "rate_limit" and 44 <= failure.retry_after <= 45
    outage = classify(await failing(429, {"error": {"message": "Your weekly usage limit has been reached. It resets in 4hr 5min"}}))
    assert outage.kind == "usage_limit" and 14690 <= outage.retry_after <= 14700
    assert classify(await failing(503, {"error": {"message": "busy"}}, headers={"Retry-After": "7"})).retry_after <= 7
    assert classify(await failing(500, {"error": {"message": "oops"}})).retry_after is None


def test_a_reset_that_is_given_as_a_time_comes_through_a_wire_dict():
    failure = classify({"kind": "usage_limit", "message": "limit", "resets_at": time.time() + 3600})
    assert 3590 <= failure.retry_after <= 3600
    assert 3590 <= classify(failure.wire()).retry_after <= 3600
    assert classify({"kind": "usage_limit", "message": "limit"}).wire().keys() == {"kind", "reason"}


@pytest.mark.parametrize("language", ["en", "zh-TW", "ja"])
@pytest.mark.parametrize("kind", ["context_overflow", "payload_too_large", "content_policy"])
def test_the_owner_is_told_in_plain_words_of_each_new_kind(kind, language):
    assert kind in KINDS
    text = Failure(kind, "provider words").sentence("Raphael", language)
    assert "Raphael" in text and "provider words" not in text and not re.search(r"[a-z]+_[a-z_]+", text)


@pytest.mark.parametrize(
    ("language", "needle"),
    [("en", "at {clock}"), ("zh-TW", "{clock}"), ("ja", "{clock}")],
)
def test_a_limit_that_resets_hours_from_now_names_the_time_of_day(language, needle):
    now = time.time()
    failure = Failure("usage_limit", "limit", now + 5 * 3600)
    clock = time.strftime("%H:%M", time.localtime(now + 5 * 3600))
    assert needle.format(clock=clock) in failure.sentence("Raphael", language, now=now)
    # A limit with no time given says what it always did.
    assert Failure("usage_limit", "limit").sentence("Raphael", language) == _OWNER_MESSAGES[language]["usage_limit"].format(name="Raphael")


@pytest.mark.parametrize(("language", "needle"), [("en", "about 20 min"), ("zh-TW", "約 20 分鐘"), ("ja", "約20分")])
def test_a_limit_that_resets_soon_says_how_long(language, needle):
    now = time.time()
    assert needle in Failure("usage_limit", "limit", now + 20 * 60).sentence("Raphael", language, now=now)


@pytest.mark.parametrize("kind", ["rate_limit", "overloaded", "server", "timeout", "network"])
@pytest.mark.parametrize(("language", "needle"), [("en", "try again in about 2 min"), ("zh-TW", "約 2 分鐘後再試"), ("ja", "約2分後再試行します")])
def test_the_line_while_it_waits_says_what_is_wrong_that_the_work_is_intact_and_when_it_asks_again(kind, language, needle):
    text = Failure(kind, "x").waiting("gpt-6-sol", language, 120)
    assert "gpt-6-sol" in text and needle in text
    assert Failure("rate_limit", "x").waiting("m", language, 120) != Failure("timeout", "x").waiting("m", language, 120)


@pytest.mark.parametrize(("reference", "name"), [("@chatgpt:gpt-6-sol?effort=max", "gpt-6-sol"), ("openai/gpt-6-luna", "gpt-6-luna"), ("fake/model", "model")])
def test_a_model_is_named_in_a_sentence_by_its_short_name(reference, name):
    from raphael_core.brain.model_ref import short_name
    assert short_name(reference) == name


def test_the_kind_survives_to_the_turn_instead_of_becoming_a_refusal():
    failure = classify(OpenRouterError(400, "context_overflow", "maximum context length"))
    assert AgentFailure(failure.kind, diagnostic=failure).kind == "context_overflow"
