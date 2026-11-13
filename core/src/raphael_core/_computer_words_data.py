"""Fixed UI translations of the line that says a member woke the computer (computer/vm_tools.py, R-COMP-WAKE-01).

Each English source maps to its twelve translations, in the order of `ui_words.NEW_LANGUAGES`; the catalogue test in
tests/agent/test_ui_languages.py holds them to the same format fields as their source. The app's own copy of the same
three sentences is `computer.woke.*` in app/src/main/i18n.
"""

_ORDER = ("zh-CN", "ko", "es", "fr", "de", "pt-BR", "it", "ru", "vi", "th", "id", "tr")

_ROWS = {
    "{who} woke the computer to open a web page": (
        "{who}为了打开网页唤醒了电脑", "{who}님이 웹페이지를 열기 위해 컴퓨터를 깨웠습니다",
        "{who} despertó el ordenador para abrir una página web", "{who} a réveillé l’ordinateur pour ouvrir une page web",
        "{who} hat den Computer geweckt, um eine Webseite zu öffnen", "{who} acordou o computador para abrir uma página da web",
        "{who} ha riattivato il computer per aprire una pagina web", "Компьютер разбужен: {who} открывает веб-страницу",
        "{who} đã đánh thức máy tính để mở một trang web", "{who} ปลุกคอมพิวเตอร์เพื่อเปิดเว็บเพจ",
        "{who} membangunkan komputer untuk membuka halaman web", "{who} bilgisayarı bir web sayfasını açmak için uyandırdı"),
    "{who} woke the computer to run a command": (
        "{who}为了运行命令唤醒了电脑", "{who}님이 명령을 실행하기 위해 컴퓨터를 깨웠습니다",
        "{who} despertó el ordenador para ejecutar un comando", "{who} a réveillé l’ordinateur pour exécuter une commande",
        "{who} hat den Computer geweckt, um einen Befehl auszuführen", "{who} acordou o computador para executar um comando",
        "{who} ha riattivato il computer per eseguire un comando", "Компьютер разбужен: {who} выполняет команду",
        "{who} đã đánh thức máy tính để chạy một lệnh", "{who} ปลุกคอมพิวเตอร์เพื่อรันคำสั่ง",
        "{who} membangunkan komputer untuk menjalankan perintah", "{who} bilgisayarı bir komut çalıştırmak için uyandırdı"),
    "{who} woke the computer to use it": (
        "{who}为了使用电脑而将它唤醒", "{who}님이 컴퓨터를 사용하기 위해 깨웠습니다",
        "{who} despertó el ordenador para usarlo", "{who} a réveillé l’ordinateur pour s’en servir",
        "{who} hat den Computer geweckt, um ihn zu benutzen", "{who} acordou o computador para usá-lo",
        "{who} ha riattivato il computer per usarlo", "Компьютер разбужен: {who} пользуется им",
        "{who} đã đánh thức máy tính để sử dụng", "{who} ปลุกคอมพิวเตอร์เพื่อใช้งาน",
        "{who} membangunkan komputer untuk menggunakannya", "{who} bilgisayarı kullanmak için uyandırdı"),
}

COMPUTER_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
