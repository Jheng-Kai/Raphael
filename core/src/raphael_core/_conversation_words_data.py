"""Fixed UI translations of lines the core writes into a conversation: the quiet line of a CLI's file change
(agent/cli/loop.py), the lines of a question card written for a chat and the words that stand in a chat for a link
its phone cannot open (messaging/words.py).

Each English source maps to its twelve translations, in the order of `ui_words.NEW_LANGUAGES`; the catalogue test in
tests/agent/test_ui_languages.py holds them to the same format fields as their source.
"""

_ORDER = ("zh-CN", "ko", "es", "fr", "de", "pt-BR", "it", "ru", "vi", "th", "id", "tr")

_ROWS = {
    "{name} (couldn't be sent here; open it on the computer)": (
        "{name}（无法发送到这里，请在电脑上打开）", "{name}(여기로 보낼 수 없습니다. 컴퓨터에서 여세요)",
        "{name} (no se pudo enviar aquí; ábrelo en el ordenador)", "{name} (impossible de l'envoyer ici ; ouvrez-le sur l'ordinateur)",
        "{name} (konnte nicht hierher gesendet werden; öffnen Sie es am Computer)", "{name} (não foi possível enviar aqui; abra no computador)",
        "{name} (non è stato possibile inviarlo qui; aprilo sul computer)", "{name} (не удалось отправить сюда; откройте на компьютере)",
        "{name} (không thể gửi tới đây; hãy mở trên máy tính)", "{name} (ส่งมาที่นี่ไม่ได้ เปิดได้ที่คอมพิวเตอร์)",
        "{name} (tidak bisa dikirim ke sini; buka di komputer)", "{name} (buraya gönderilemedi; bilgisayarda açın)"),
    "(a link that opens only on the computer)": (
        "（这个链接只能在电脑上打开）", "(컴퓨터에서만 열리는 링크입니다)", "(un enlace que solo se abre en el ordenador)",
        "(un lien qui ne s'ouvre que sur l'ordinateur)", "(ein Link, der sich nur am Computer öffnen lässt)",
        "(um link que só abre no computador)", "(un link che si apre solo sul computer)",
        "(ссылка, которая открывается только на компьютере)", "(liên kết chỉ mở được trên máy tính)",
        "(ลิงก์นี้เปิดได้เฉพาะในคอมพิวเตอร์)", "(tautan yang hanya bisa dibuka di komputer)",
        "(yalnızca bilgisayarda açılan bir bağlantı)"),
    "CLI reported a file change": (
        "CLI 报告文件已更改", "CLI가 파일 변경을 보고했습니다", "La CLI informó de un cambio en un archivo",
        "La CLI a signalé une modification de fichier", "Die CLI hat eine Dateiänderung gemeldet",
        "A CLI informou uma alteração em um arquivo", "La CLI ha segnalato una modifica a un file",
        "CLI сообщил об изменении файла", "CLI báo đã thay đổi một tệp", "CLI รายงานว่าไฟล์มีการเปลี่ยนแปลง",
        "CLI melaporkan perubahan pada sebuah berkas", "CLI bir dosya değişikliği bildirdi"),
    "Reply with a letter, for example A.": (
        "回复选项字母（例如 A）。", "선택지 글자로 답해 주세요(예: A).", "Responde con una letra, por ejemplo A.",
        "Répondez par une lettre, par exemple A.", "Antworten Sie mit einem Buchstaben, zum Beispiel A.",
        "Responda com uma letra, por exemplo A.", "Rispondi con una lettera, ad esempio A.",
        "Ответьте буквой, например A.", "Trả lời bằng một chữ cái, ví dụ A.", "ตอบด้วยตัวอักษร เช่น A",
        "Balas dengan satu huruf, misalnya A.", "Bir harfle yanıtlayın, örneğin A."),
    "Choose all that apply: reply with letters, for example A, C.": (
        "可多选。回复选项字母（例如 A、C）。", "해당하는 것을 모두 고르세요. 글자로 답해 주세요(예: A, C).",
        "Elige todas las que correspondan: responde con letras, por ejemplo A, C.",
        "Choisissez tout ce qui convient : répondez par des lettres, par exemple A, C.",
        "Wählen Sie alles Zutreffende: Antworten Sie mit Buchstaben, zum Beispiel A, C.",
        "Escolha todas as que se aplicam: responda com letras, por exemplo A, C.",
        "Scegli tutte quelle che valgono: rispondi con le lettere, ad esempio A, C.",
        "Выберите все подходящие: ответьте буквами, например A, C.",
        "Chọn tất cả những mục phù hợp: trả lời bằng các chữ cái, ví dụ A, C.",
        "เลือกได้หลายข้อ ตอบด้วยตัวอักษร เช่น A, C", "Pilih semua yang sesuai: balas dengan huruf, misalnya A, C.",
        "Uygun olanların hepsini seçin: harflerle yanıtlayın, örneğin A, C."),
    'Reply "skip" to skip it.': (
        "回复“略过”可以略过。", "\"건너뛰기\"라고 답하면 넘어갑니다.", "Responde «omitir» para omitirla.",
        "Répondez « passer » pour la passer.", "Antworten Sie „überspringen“, um sie zu überspringen.",
        "Responda \"pular\" para pulá-la.", "Rispondi «salta» per saltarla.",
        "Ответьте «пропустить», чтобы пропустить вопрос.", "Trả lời \"bỏ qua\" để bỏ qua.",
        "ตอบ \"ข้าม\" เพื่อข้ามคำถามนี้", "Balas \"lewati\" untuk melewatinya.", "Atlamak için \"atla\" yazın."),
    "Or write your own answer.": (
        "也可以直接写下你的答案。", "직접 답을 적어도 됩니다.", "O escribe tu propia respuesta.",
        "Ou écrivez votre propre réponse.", "Oder schreiben Sie Ihre eigene Antwort.", "Ou escreva sua própria resposta.",
        "Oppure scrivi la tua risposta.", "Или напишите свой ответ.", "Hoặc tự viết câu trả lời của bạn.",
        "หรือเขียนคำตอบของคุณเอง", "Atau tulis jawabanmu sendiri.", "Ya da kendi yanıtınızı yazın."),
}

CONVERSATION_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
