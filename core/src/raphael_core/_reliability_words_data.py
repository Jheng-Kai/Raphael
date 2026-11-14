"""Fixed UI translations of the line that says a task stopped because one tool failed again and again with the same error
(agent/persona.py `worker_tool_error_loop`, R-TOOL-02).

Each English source maps to its twelve translations, in the order of `ui_words.NEW_LANGUAGES`; the catalogue test in
tests/agent/test_ui_languages.py holds them to the same format fields as their source.
"""

_ORDER = ("zh-CN", "ko", "es", "fr", "de", "pt-BR", "it", "ru", "vi", "th", "id", "tr")

_ROWS = {
    "{tool} failed three times in a row with the same error, so the task stopped instead of using up more of its allowance. "
    "Check what {tool} needs, then run the task again.": (
        "{tool} 连续三次因同样的错误失败，任务已停止，没有继续消耗额度。请确认 {tool} 需要的设置后再运行一次。",
        "{tool}이(가) 같은 오류로 세 번 연속 실패하여 더 이상 사용량을 소모하지 않도록 작업을 중단했습니다. "
        "{tool}에 필요한 것을 확인한 뒤 작업을 다시 실행해 주세요.",
        "{tool} falló tres veces seguidas con el mismo error, así que la tarea se detuvo para no gastar más de su cuota. "
        "Revisa qué necesita {tool} y vuelve a ejecutar la tarea.",
        "{tool} a échoué trois fois de suite avec la même erreur ; la tâche s'est arrêtée pour ne pas consommer davantage "
        "de quota. Vérifiez ce dont {tool} a besoin, puis relancez la tâche.",
        "{tool} ist dreimal hintereinander mit demselben Fehler fehlgeschlagen, deshalb wurde die Aufgabe gestoppt, statt "
        "weiteres Kontingent zu verbrauchen. Prüfe, was {tool} braucht, und starte die Aufgabe dann erneut.",
        "{tool} falhou três vezes seguidas com o mesmo erro, então a tarefa foi interrompida para não gastar mais da cota. "
        "Verifique o que {tool} precisa e execute a tarefa novamente.",
        "{tool} ha fallito tre volte di fila con lo stesso errore, quindi l'attività è stata fermata per non consumare altra "
        "quota. Controlla di cosa ha bisogno {tool} e riavvia l'attività.",
        "{tool} три раза подряд завершился с одной и той же ошибкой, поэтому задача остановлена и не расходует лимит дальше. "
        "Проверьте, что нужно для {tool}, и запустите задачу снова.",
        "{tool} đã thất bại ba lần liên tiếp với cùng một lỗi nên tác vụ đã dừng để không dùng thêm hạn mức. "
        "Hãy kiểm tra {tool} cần gì rồi chạy lại tác vụ.",
        "{tool} ล้มเหลวติดต่อกันสามครั้งด้วยข้อผิดพลาดเดียวกัน งานจึงหยุดเพื่อไม่ใช้โควตาเพิ่ม "
        "โปรดตรวจสอบสิ่งที่ {tool} ต้องการ แล้วเรียกใช้งานอีกครั้ง",
        "{tool} gagal tiga kali berturut-turut dengan kesalahan yang sama, jadi tugas dihentikan agar tidak menghabiskan "
        "kuota lagi. Periksa apa yang dibutuhkan {tool}, lalu jalankan tugas lagi.",
        "{tool} aynı hatayla üç kez art arda başarısız oldu; bu yüzden görev, kotayı daha fazla harcamamak için durduruldu. "
        "{tool} için gerekenleri kontrol edip görevi yeniden çalıştırın."),
}

RELIABILITY_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
