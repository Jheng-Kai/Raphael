"""A model's reasoning never becomes its reply. Every provider path is exercised through httpx.MockTransport, so no test
touches the network and none leaves a request running."""

import json

import httpx
import pytest

from raphael_core.agent.failure import AgentFailure
from raphael_core.agent.ledger import Ledger
from raphael_core.agent.narration import NarratedLoop
from raphael_core.brain.openrouter import OpenRouterClient, OpenRouterError
from raphael_core.brain.providers.bedrock import BedrockProvider
from raphael_core.brain.providers.clients import AnthropicProvider, CompatibleProvider
from raphael_core.brain.reasoning import split_reasoning
from raphael_core.brain.spend import SpendTracker

MESSAGES = [{"role": "system", "content": "Work."}, {"role": "user", "content": "AAPL?"}]
THOUGHT = "The user asks about a ticker, so I should check the price first."


@pytest.mark.parametrize("text, answer, reasoning", [
    ("Plain answer.", "Plain answer.", ""),
    ("<think>plan it</think>The answer.", "The answer.", "plan it"),
    ("\n<think>one</think>\n<think>two</think>\nDone.", "Done.", "one\ntwo"),
    ("<thinking>plan</thinking>Done.", "Done.", "plan"),
    ("<THINK>plan</THINK>Done.", "Done.", "plan"),
    ("<think>it never stopped thinking", "", "it never stopped thinking"),
    ("plan it all</think>The answer.", "The answer.", "plan it all"),
    # Only what leads the text is reasoning: the model's own mention of the tag is its words.
    ("Wrap it in <think>…</think> tags.", "Wrap it in <think>…</think> tags.", ""),
    ("Use `</think>` to close it.", "Use `</think>` to close it.", ""),
    ("Answer first.\n<think>later</think>", "Answer first.\n<think>later</think>", ""),
    ("```\n<think>code</think>\n```", "```\n<think>code</think>\n```", ""),
    ("<|channel|>analysis<|message|>weigh it<|end|><|start|>assistant<|channel|>final<|message|>AAPL is 190.",
     "AAPL is 190.", "weigh it"),
    ("<|channel|>analysis<|message|>only weighing", "", "only weighing"),
])
def test_what_leads_a_reply_as_reasoning_is_told_apart_from_the_answer(text, answer, reasoning):
    assert split_reasoning(text) == (answer, reasoning)


def test_a_ticker_or_order_number_is_never_taken_for_reasoning():
    for text in ("AAPL 190.2, order #4471, stage S2-03 </b>", "reasoning: AAPL", "<b>think</b> twice"):
        assert split_reasoning(text) == (text, "")


def whole(content, **message):
    return {"model": "vendor/model", "choices": [{"message": {"role": "assistant", "content": content, **message}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 5, "cost": 0.001}}


def chunk(delta=None, finish=None):
    return {"id": "g", "model": "vendor/model", "choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}]}


def stream(*deltas):
    events = [chunk(delta) for delta in deltas] + [chunk({}, "stop")]
    body = "".join(f"data: {json.dumps(e)}\n\n" for e in events) + "data: [DONE]\n\n"
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())


async def ask(handler, *, method="chat_tools", make=None, **overrides):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = make(http) if make else OpenRouterClient(lambda: "sk-or-v1-test", http=http)
        args = {"model": "vendor/model", "timeout_s": 5, "max_tokens": 100}
        if method == "chat_tools":
            args.update(fallbacks=[], messages=MESSAGES, tools=[])
        elif method == "chat_text":
            args.update(system="Work.", user="AAPL?")
        else:
            args.update(system="Work.", user="AAPL?", schema={"type": "object"}, schema_name="answer", fallbacks=[])
        return await getattr(client, method)(**{**args, **overrides})


def compatible(http):
    return CompatibleProvider("openai", "https://api.openai.com/v1", lambda: "sk-test", http=http)


# --- a reasoning block inside the content, whole or streamed ----------------------------------------------------


@pytest.mark.parametrize("make", [None, compatible], ids=["openrouter", "compatible"])
async def test_a_think_block_in_the_whole_reply_is_thinking_and_not_the_answer(make):
    turn = await ask(lambda request: httpx.Response(200, json=whole(f"<think>{THOUGHT}</think>AAPL is 190.")), make=make)
    assert turn.content == "AAPL is 190." and turn.reasoning == THOUGHT


@pytest.mark.parametrize("make", [None, compatible], ids=["openrouter", "compatible"])
async def test_a_think_block_in_the_streamed_reply_is_thinking_however_the_pieces_fall(make):
    deltas = [{"content": "<thi"}, {"content": "nk>"}, {"content": THOUGHT}, {"content": "</think"}, {"content": ">AAPL is "}, {"content": "190."}]
    turn = await ask(lambda request: stream(*deltas), make=make)
    assert turn.content == "AAPL is 190." and turn.reasoning == THOUGHT


async def test_a_reply_that_is_only_reasoning_has_no_answer():
    turn = await ask(lambda request: stream({"content": f"<think>{THOUGHT}"}))
    assert turn.content == "" and turn.reasoning == THOUGHT
    with pytest.raises(OpenRouterError) as error:
        await ask(lambda request: httpx.Response(200, json=whole(f"<think>{THOUGHT}</think>")), method="chat_text")
    assert error.value.kind == "bad_response"


async def test_structured_replies_and_text_replies_lose_their_reasoning_too():
    text = await ask(lambda request: httpx.Response(200, json=whole(f"<think>{THOUGHT}</think>Hello.")), method="chat_text")
    assert text.text == "Hello."
    data = await ask(lambda request: httpx.Response(200, json=whole(f'<think>{{"draft": 1}}</think>{{"ok": true}}')), method="complete_json")
    assert data.data == {"ok": True}


async def test_the_parts_of_a_content_list_that_are_reasoning_are_not_words():
    content = [{"type": "thinking", "thinking": THOUGHT}, {"type": "reasoning", "text": "second thought"},
               {"type": "text", "text": "AAPL is "}, {"type": "output_text", "text": "190."}]
    turn = await ask(lambda request: httpx.Response(200, json=whole(content)))
    assert turn.content == "AAPL is 190." and turn.reasoning == f"{THOUGHT}\nsecond thought"


@pytest.mark.parametrize("field", [
    {"reasoning": THOUGHT}, {"reasoning_content": THOUGHT},
    {"reasoning_details": [{"type": "reasoning.text", "text": THOUGHT}, {"type": "reasoning.encrypted", "data": "x"}]},
], ids=["reasoning", "reasoning_content", "reasoning_details"])
async def test_reasoning_beside_the_content_never_reaches_it(field):
    turn = await ask(lambda request: httpx.Response(200, json=whole("AAPL is 190.", **field)))
    assert turn.content == "AAPL is 190."
    streamed = await ask(lambda request: stream(field, {"content": "AAPL is 190."}))
    assert streamed.content == "AAPL is 190."


# --- the native providers ---------------------------------------------------------------------------------------


async def test_anthropic_thinking_blocks_are_not_the_reply():
    body = {"model": "claude-test", "stop_reason": "end_turn", "usage": {"input_tokens": 3, "output_tokens": 3},
            "content": [{"type": "thinking", "thinking": THOUGHT, "signature": "s"}, {"type": "redacted_thinking", "data": "x"},
                        {"type": "text", "text": "<think>again</think>AAPL is 190."}]}
    turn = await ask(lambda request: httpx.Response(200, json=body), model="claude-test",
                     make=lambda http: AnthropicProvider("anthropic", "https://api.anthropic.com", lambda: "sk-test", http=http))
    assert turn.content == "AAPL is 190." and turn.reasoning == "again"


async def test_bedrock_reasoning_blocks_are_not_the_reply():
    body = {"stopReason": "end_turn", "usage": {"inputTokens": 3, "outputTokens": 3}, "output": {"message": {"content": [
        {"reasoningContent": {"reasoningText": {"text": THOUGHT}}}, {"text": "<think>again</think>AAPL is 190."}]}}}
    credentials = json.dumps({"key_id": "access", "secret": "secret"})
    turn = await ask(lambda request: httpx.Response(200, json=body), model="anthropic.claude-test-v1:0",
                     make=lambda http: BedrockProvider("bedrock", "https://bedrock-runtime.us-east-1.amazonaws.com", lambda: credentials,
                                                       region="us-east-1", http=http))
    assert turn.content == "AAPL is 190." and turn.reasoning == "again"


# --- the turn: the thinking part gets the reasoning, the reply never does -------------------------------------


class Scripted:
    def __init__(self, *answers):
        self.answers = list(answers)

    async def chat_tools(self, **kwargs):
        return self.answers.pop(0)


def turn_of(content, reasoning=""):
    from raphael_core.brain.openrouter import ChatTurn
    return ChatTurn(content, [], "vendor/model", 0.0, 1, 1, 1, reasoning=reasoning)


def narrated(conn, *answers, thoughts):
    async def execute(call_id, name, arguments):
        raise AssertionError("no tool was called")
    return NarratedLoop(client=Scripted(*answers), model="vendor/model", ledger=Ledger(SpendTracker(conn)), language="zh-TW",
                        plain=True, system="Answer.", user="AAPL?", tools=[], progress=lambda text: None, execute=execute,
                        thinking=thoughts.append)


async def test_the_reasoning_of_a_turn_is_its_thinking_and_the_reply_is_the_answer(conn):
    thoughts = []
    loop = narrated(conn, turn_of("AAPL 190。", THOUGHT), thoughts=thoughts)
    outcome = await loop.run()
    assert loop.reply(outcome).text == "AAPL 190。" and thoughts == [THOUGHT]


async def test_a_turn_whose_model_only_reasoned_says_that_no_answer_came(conn):
    thoughts = []
    loop = narrated(conn, turn_of("", THOUGHT), turn_of("", THOUGHT), thoughts=thoughts)
    outcome = await loop.run()
    with pytest.raises(AgentFailure) as failure:
        loop.reply(outcome)
    assert failure.value.kind == "no_answer"
    assert THOUGHT in thoughts


def test_no_answer_is_said_in_every_language():
    from raphael_core.agent.persona import phrase
    from raphael_core.ui_languages import LANGUAGES
    assert "沒有給出回答" in phrase("zh-TW", "no_answer")
    assert phrase("en", "no_answer").startswith("The model gave no answer")
    assert all(phrase(code, "no_answer").strip() for code in LANGUAGES)
