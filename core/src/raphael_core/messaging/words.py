"""What Raphael says in a messaging app, in the three languages of the app."""

import re
from collections.abc import Sequence

# The longest stretch of a transcript that is echoed back to show what was heard.
HEARD_CHARS = 80

_WORDS: dict[str, dict[str, str]] = {
    "zh-TW": {
        "queued": "已排隊，會依序回答。",
        "intro": "我是拉斐爾。直接傳訊息給我，我會像在電腦前一樣回答你。傳 /stop 可以中斷正在跑的背景任務。",
        "pair": "這個機器人是私人的。請主人在電腦上與這個機器人所屬成員的對話中，核准配對卡的 {code}（10 分鐘內有效）。",
        "paired": "已連接。現在可以傳訊息給我了。",
        "unsupported": "目前只能處理文字、語音訊息、圖片和 PDF。",
        "file_large": "這個檔案太大了（上限 {mb} MB）。",
        "files_first": "（只看了前 {count} 個檔案。）",
        "stopped": "已中斷。",
        "nothing": "目前沒有在跑的任務。",
        "confirm": "（這需要你的確認，請到電腦上回答。）",
        "failed": "這次工作未完成，請在電腦的拉斐爾開啟原對話，確認「設定 › 模型與用量 › 模型」的登入、「設定 › 聽寫」的語音模型或「設定 › 連接」的連接狀態後再試。",
        "heard": "聽到：「{text}」",
        "voice_empty": "沒有聽到內容。",
        "voice_large": "這則語音太大了（上限 {mb} MB）。",
    },
    "en": {
        "queued": "Queued. I'll answer in order.",
        "intro": "I'm Raphael. Send me a message and I'll answer as I would at your computer. Send /stop to interrupt a background task.",
        "pair": "This bot is private. Ask the owner to approve code {code} on the pairing card in this bot's member conversation in Raphael on the computer (valid for 10 minutes).",
        "paired": "Connected. You can message me now.",
        "unsupported": "I can only read text, voice messages, images and PDFs for now.",
        "file_large": "That file is too large (the limit is {mb} MB).",
        "files_first": "(I looked at the first {count} files only.)",
        "stopped": "Stopped.",
        "nothing": "Nothing is running.",
        "confirm": "(This needs your confirmation. Please answer at the computer.)",
        "failed": "This task did not finish. Open the original conversation on your computer and check Settings > Models & usage > Models for sign-in, Settings > Dictation for speech models, or Settings > Connections for connected apps before retrying.",
        "heard": "Heard: “{text}”",
        "voice_empty": "I didn't hear anything.",
        "voice_large": "That voice message is too large (the limit is {mb} MB).",
    },
    "ja": {
        "queued": "順番にお答えします。",
        "intro": "ラファエルです。メッセージを送ってください。パソコンの前と同じように答えます。/stop でバックグラウンドの作業を止められます。",
        "pair": "このボットは非公開です。パソコンのラファエルで、このボットのメンバーとの会話に届くペアリングカードのコード {code} を承認してください（10 分間有効）。",
        "paired": "接続しました。メッセージを送ってください。",
        "unsupported": "今はテキスト、音声メッセージ、画像、PDF だけ読めます。",
        "file_large": "このファイルは大きすぎます（上限 {mb} MB）。",
        "files_first": "（最初の {count} 個のファイルだけ見ました。）",
        "stopped": "止めました。",
        "nothing": "実行中の作業はありません。",
        "confirm": "（確認が必要です。パソコンで答えてください。）",
        "failed": "作業が完了しませんでした。PC の元の会話を開き、「設定 › モデルと使用量 › モデル」のログイン、「設定 › ディクテーション」の音声モデル、「設定 › 接続」の状態を確認してから再試行してください。",
        "heard": "聞き取り：「{text}」",
        "voice_empty": "何も聞こえませんでした。",
        "voice_large": "この音声メッセージは大きすぎます（上限 {mb} MB）。",
    },
}


def words(language: str, key: str, **values: str) -> str:
    table = _WORDS.get(language, _WORDS["en"])
    return table[key].format(**values)


def heard(language: str, transcript: str) -> str:
    """The line that says what was understood from a voice message."""
    text = " ".join(transcript.split())
    if len(text) > HEARD_CHARS:
        text = text[:HEARD_CHARS].rstrip() + "…"
    return words(language, "heard", text=text)


def plain_replies(texts: Sequence[str]) -> list[str]:
    """The stored messages of one reply without the 《prefix。…》 frame the app strips (the same
    rule as `plainReplies` in app/src/shared/anime.ts): the first message of a line opens with
    《prefix。 and the last one before the next opening ends with 》. Anything else, a 》 that closes
    a book's title included, stays."""
    from ..agent.persona import PREFIXES

    names = "|".join(re.escape(p) for prefixes in PREFIXES.values() for p in prefixes)
    opening = re.compile(rf"^《(?:{names})[。.：:]\s*", re.I)
    plain = list(texts)
    open_at = -1

    def close(end: int) -> None:
        if open_at >= 0 and end >= open_at and plain[end].rstrip().endswith("》"):
            plain[end] = plain[end].rstrip()[:-1]

    for index, text in enumerate(texts):
        found = opening.match(text.lstrip())
        if found is None:
            continue
        close(index - 1)
        open_at = index
        plain[index] = text.lstrip()[found.end():]
    close(len(texts) - 1)
    return plain


def compose(prefix: str, text: str, detail: str | None) -> str:
    """The answer as one message: the line as the overlay and the app show it, 《prefix。text》, and,
    when there is more, the longer text. The prefix of the English persona is a word ("Answer"),
    the others one character (答), each followed by the stop of its script. With no prefix (a
    member, who speaks plainly) the text goes as it is."""
    mark = prefix.strip().strip("《》").rstrip("。.").strip()
    body = text.strip()
    if mark:
        stop = ". " if mark.isascii() else "。"
        line = f"《{mark}{stop}{body}》"
    else:
        line = body
    if detail and detail.strip() and detail.strip() != text.strip():
        return f"{line}\n\n{detail.strip()}" if line else detail.strip()
    return line
