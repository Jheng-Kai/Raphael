"""Owner script preferences apply to prose without translating authored speech or code."""

import pytest

from raphael_core.agent.answers import Reply, owner_script
from raphael_core.brain.textnorm import authored_chinese


@pytest.mark.parametrize(("variant", "expected"), [
    ("zh-TW", "這個軟體已檢查。"),
    ("zh-HK", "這個軟件已檢查。"),
    ("yue-HK", "這個軟件已檢查。"),
    ("zh-CN", "这个软件已检查。"),
    (None, "这个软件已检查。"),
])
def test_owner_variant_changes_only_chinese_prose(variant, expected):
    protected = '\n日本の学校へ行きます。\n学校へ。\nガクセイ 学校\nｶﾀｶﾅ 学校\nEnglish stays here.\n`软件`\n```python\nlabel = "软件"\n```\n~~~text\n软件\n~~~\n'
    text = "这个软件已检查。" + protected
    assert authored_chinese(text, variant) == expected + protected
    assert authored_chinese(authored_chinese(text, variant), variant) == expected + protected


def test_simplified_owner_receives_simplified_without_touching_code_or_kana():
    assert authored_chinese("這是資料。`資料`\n資料を読みます。", "zh-CN") == "这是资料。`資料`\n資料を読みます。"


def test_inline_code_and_multiline_spans_keep_their_original_bytes():
    text = "软件 `软件` 和 ``软件 `检查`\n软件`` 资料。\n只要沒有干擾。"
    expected = "軟體 `软件` 和 ``软件 `检查`\n软件`` 資料。\n只要沒有干擾。"
    assert authored_chinese(text, "zh-TW") == expected


def test_indented_markdown_code_keeps_chinese_literals():
    text = '软件资料\n\n    label = "软件资料"\n\tlabel = "软件资料"\n'
    assert authored_chinese(text, "zh-TW") == text.replace("软件资料", "軟體資料", 1)


def test_reply_script_does_not_rewrite_memory_or_japanese():
    original = Reply("Answer", "软件", "资料", messages=["软件", "資料を読みます。"])
    converted = owner_script(original, "zh-TW")
    assert (converted.text, converted.detail, converted.messages) == ("軟體", "資料", ["軟體", "資料を読みます。"])
    assert converted.memory is original.memory
    assert original.text == "软件" and original.messages[0] == "软件"
