"""Fixed UI translations of the line a quick request to open something says (agent/whose_computer.py, R-COMP-OWN-01).

Each English source maps to its twelve translations, in the order of `ui_words.NEW_LANGUAGES`; the catalogue test in
tests/agent/test_ui_languages.py holds them to the same format fields as their source. The app keeps no copy of them:
the lines are written into the quick conversation by the core alone.
"""

_ORDER = ("zh-CN", "ko", "es", "fr", "de", "pt-BR", "it", "ru", "vi", "th", "id", "tr")

_ROWS = {
    "Opened {target} on your computer.": (
        "已在你的电脑打开“{target}”。", "당신의 컴퓨터에서 {target}을(를) 열었습니다.",
        "Se abrió {target} en tu ordenador.", "{target} a été ouvert sur votre ordinateur.",
        "{target} wurde auf Ihrem Computer geöffnet.", "{target} foi aberto no seu computador.",
        "{target} è stato aperto sul tuo computer.", "{target} открыт на вашем компьютере.",
        "Đã mở {target} trên máy tính của bạn.", "เปิด {target} บนคอมพิวเตอร์ของคุณแล้ว",
        "{target} dibuka di komputer Anda.", "{target} bilgisayarınızda açıldı."),
}

WHOSE_COMPUTER_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
