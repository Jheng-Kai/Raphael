"""Fixed UI translations of the lines about a member's computer: that a member woke it (computer/vm_tools.py,
R-COMP-WAKE-01), and that a member's answer does not count because it never read its last change back (R-COMP-PERF-09).

Each English source maps to its twelve translations, in the order of `ui_words.NEW_LANGUAGES`; the catalogue test in
tests/agent/test_ui_languages.py holds them to the same format fields as their source. The app keeps no copy of them: the
line is written into the conversation by the core alone.
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
    # A member answered after a change on its screen without reading the result back, once told to (R-COMP-PERF-09).
    "The screen was not checked after the last change on it, so this does not count as done.": (
        "最后一次操作画面后没有再确认结果，这次不算完成。", "화면을 마지막으로 조작한 뒤 결과를 확인하지 않아 완료로 처리할 수 없습니다.",
        "No se comprobó la pantalla después del último cambio, así que esto no cuenta como terminado.",
        "L’écran n’a pas été vérifié après la dernière modification ; ce n’est donc pas compté comme terminé.",
        "Der Bildschirm wurde nach der letzten Änderung nicht geprüft; dies zählt daher nicht als erledigt.",
        "A tela não foi conferida depois da última alteração, então isto não conta como concluído.",
        "Lo schermo non è stato controllato dopo l’ultima modifica, quindi non conta come completato.",
        "После последнего действия на экране результат не проверен, поэтому это не считается завершённым.",
        "Chưa kiểm tra lại màn hình sau thao tác cuối cùng nên việc này chưa được tính là hoàn tất.",
        "ไม่ได้ตรวจหน้าจออีกครั้งหลังการเปลี่ยนแปลงล่าสุด จึงไม่นับว่าเสร็จ",
        "Layar tidak diperiksa lagi setelah perubahan terakhir, jadi ini belum dianggap selesai.",
        "Ekran son değişiklikten sonra kontrol edilmedi; bu yüzden bu tamamlanmış sayılmaz."),
}

COMPUTER_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
