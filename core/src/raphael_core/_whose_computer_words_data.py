"""Fixed UI translations of the two lines of a quick request to open something (agent/whose_computer.py, R-COMP-OWN-01).

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
    "Open it on this PC, or on {who}'s own computer?": (
        "要在你现在用的这台电脑上打开，还是在{who}自己的电脑上打开？", "이 PC에서 열까요, 아니면 {who}의 컴퓨터에서 열까요?",
        "¿Lo abro en este PC o en el ordenador propio de {who}?", "Dois-je l’ouvrir sur ce PC ou sur l’ordinateur de {who} ?",
        "Soll es auf diesem PC oder auf dem eigenen Computer von {who} geöffnet werden?", "Abro neste PC ou no computador próprio de {who}?",
        "Lo apro su questo PC o sul computer di {who}?", "Открыть на этом компьютере или на собственном компьютере {who}?",
        "Mở trên PC này hay trên máy tính riêng của {who}?", "จะเปิดบนพีซีเครื่องนี้ หรือบนคอมพิวเตอร์ของ {who} เอง?",
        "Buka di PC ini, atau di komputer milik {who} sendiri?", "Bu bilgisayarda mı, yoksa {who} adlı üyenin kendi bilgisayarında mı açılsın?"),
}

WHOSE_COMPUTER_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
