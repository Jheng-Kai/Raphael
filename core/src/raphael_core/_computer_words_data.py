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
    "The screen was not checked after the last change; this does not count as done.": (
        "最后一次操作画面后没有再确认结果，这次不算完成。", "화면을 마지막으로 조작한 뒤 결과를 확인하지 않아 완료로 처리할 수 없습니다.",
        "No se comprobó la pantalla tras el último cambio; esto no cuenta como terminado.",
        "Écran non vérifié après la dernière modification : cela ne compte pas comme terminé.",
        "Der Bildschirm wurde nach der letzten Änderung nicht geprüft; dies zählt daher nicht als erledigt.",
        "A tela não foi conferida depois da última alteração, então isto não conta como concluído.",
        "Lo schermo non è stato controllato dopo l’ultima modifica, quindi non conta come completato.",
        "После последнего действия на экране результат не проверен, поэтому это не считается завершённым.",
        "Chưa kiểm tra lại màn hình sau thao tác cuối cùng nên việc này chưa được tính là hoàn tất.",
        "ไม่ได้ตรวจหน้าจออีกครั้งหลังการเปลี่ยนแปลงล่าสุด จึงไม่นับว่าเสร็จ",
        "Layar tidak diperiksa lagi setelah perubahan terakhir, jadi ini belum dianggap selesai.",
        "Ekran son değişiklikten sonra kontrol edilmedi; bu yüzden bu tamamlanmış sayılmaz."),
    "Please sign in on this page in the Computer panel.": (
        "请在「电脑」侧栏的页面登录。", "컴퓨터 패널의 이 페이지에서 로그인해 주세요.",
        "Inicia sesión en esta página desde el panel Ordenador.", "Connectez-vous sur cette page dans le panneau Ordinateur.",
        "Melde dich auf dieser Seite im Computerbereich an.", "Entre nesta página pelo painel Computador.",
        "Accedi a questa pagina nel pannello Computer.", "Войдите на этой странице в панели «Компьютер».",
        "Hãy đăng nhập trên trang này trong bảng Máy tính.", "โปรดลงชื่อเข้าใช้ในหน้านี้บนแผงคอมพิวเตอร์",
        "Silakan masuk di halaman ini pada panel Komputer.", "Bilgisayar panelindeki bu sayfada oturum açın."),
    "Please enter your password on the page in the Computer panel.": (
        "请在「电脑」侧栏的页面输入密码。", "컴퓨터 패널의 페이지에서 비밀번호를 입력해 주세요.",
        "Introduce tu contraseña en la página del panel Ordenador.", "Saisissez votre mot de passe sur la page dans le panneau Ordinateur.",
        "Gib dein Passwort auf der Seite im Computerbereich ein.", "Digite sua senha na página do painel Computador.",
        "Inserisci la password nella pagina del pannello Computer.", "Введите пароль на странице в панели «Компьютер».",
        "Hãy nhập mật khẩu trên trang trong bảng Máy tính.", "โปรดป้อนรหัสผ่านในหน้าบนแผงคอมพิวเตอร์",
        "Masukkan kata sandi di halaman pada panel Komputer.", "Bilgisayar panelindeki sayfada parolanızı girin."),
    "Please complete the verification in the Computer panel.": (
        "请在「电脑」侧栏完成验证。", "컴퓨터 패널에서 인증을 완료해 주세요.",
        "Completa la verificación en el panel Ordenador.", "Terminez la vérification dans le panneau Ordinateur.",
        "Schließe die Bestätigung im Computerbereich ab.", "Conclua a verificação no painel Computador.",
        "Completa la verifica nel pannello Computer.", "Завершите проверку в панели «Компьютер».",
        "Hãy hoàn tất xác minh trong bảng Máy tính.", "โปรดยืนยันตัวตนให้เสร็จในแผงคอมพิวเตอร์",
        "Selesaikan verifikasi di panel Komputer.", "Bilgisayar panelinde doğrulamayı tamamlayın."),
    "Please complete the human verification in the Computer panel.": (
        "请在「电脑」侧栏完成人机验证。", "컴퓨터 패널에서 로봇이 아님을 확인해 주세요.",
        "Confirma que no eres un robot en el panel Ordenador.", "Confirmez que vous n’êtes pas un robot dans le panneau Ordinateur.",
        "Bestätige im Computerbereich, dass du kein Roboter bist.", "Confirme que você não é um robô no painel Computador.",
        "Conferma di non essere un robot nel pannello Computer.", "Подтвердите, что вы не робот, в панели «Компьютер».",
        "Hãy xác nhận bạn không phải rô-bốt trong bảng Máy tính.", "โปรดยืนยันว่าคุณไม่ใช่หุ่นยนต์ในแผงคอมพิวเตอร์",
        "Konfirmasikan bahwa Anda bukan robot di panel Komputer.", "Bilgisayar panelinde robot olmadığınızı doğrulayın."),
    "Please review and complete the payment in the Computer panel.": (
        "请在「电脑」侧栏确认并完成付款。", "컴퓨터 패널에서 결제 내용을 확인하고 결제를 완료해 주세요.",
        "Revisa y completa el pago en el panel Ordenador.", "Vérifiez et effectuez le paiement dans le panneau Ordinateur.",
        "Prüfe und bestätige die Zahlung im Computerbereich.", "Revise e conclua o pagamento no painel Computador.",
        "Controlla e completa il pagamento nel pannello Computer.", "Проверьте данные и завершите оплату в панели «Компьютер».",
        "Hãy kiểm tra và hoàn tất thanh toán trong bảng Máy tính.", "โปรดตรวจสอบและชำระเงินในแผงคอมพิวเตอร์",
        "Periksa dan selesaikan pembayaran di panel Komputer.", "Bilgisayar panelinde ödemeyi inceleyip tamamlayın."),
    "Please select your certificate in the Computer panel.": (
        "请在「电脑」侧栏选择证书。", "컴퓨터 패널에서 인증서를 선택해 주세요.",
        "Selecciona tu certificado en el panel Ordenador.", "Sélectionnez votre certificat dans le panneau Ordinateur.",
        "Wähle dein Zertifikat im Computerbereich aus.", "Selecione seu certificado no painel Computador.",
        "Seleziona il tuo certificato nel pannello Computer.", "Выберите сертификат в панели «Компьютер».",
        "Hãy chọn chứng chỉ của bạn trong bảng Máy tính.", "โปรดเลือกใบรับรองของคุณในแผงคอมพิวเตอร์",
        "Pilih sertifikat Anda di panel Komputer.", "Bilgisayar panelinde sertifikanızı seçin."),
}

COMPUTER_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
