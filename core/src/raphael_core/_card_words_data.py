"""Fixed UI translations of the owner's confirmation card for management changes (management_words.py).

Each English source maps to its twelve translations, in the order of `ui_words.NEW_LANGUAGES`; the catalogue test in
tests/agent/test_ui_languages.py holds them to the same format fields as their source.
"""

_ORDER = ("zh-CN", "ko", "es", "fr", "de", "pt-BR", "it", "ru", "vi", "th", "id", "tr")

_ROWS = {
    "Make this member the primary contact and give it management": (
        "将此成员设为主要联系人并授予管理权", "이 멤버를 주 담당자로 지정하고 관리 권한을 부여",
        "Convertir a este miembro en contacto principal y darle la administración",
        "Faire de ce membre le contact principal et lui donner la gestion",
        "Dieses Mitglied zum Hauptkontakt machen und ihm die Verwaltung übertragen",
        "Tornar este membro o contato principal e dar a ele a administração",
        "Rendere questo membro il contatto principale e affidargli la gestione",
        "Назначить этого участника основным контактом и передать ему управление",
        "Đặt thành viên này làm đầu mối chính và trao quyền quản lý",
        "ตั้งสมาชิกนี้เป็นผู้ติดต่อหลักและมอบสิทธิ์การจัดการ",
        "Jadikan anggota ini kontak utama dan beri akses pengelolaan",
        "Bu üyeyi ana kişi yap ve yönetim yetkisini ver"),
    "Clear all of this member's conversation records": (
        "清除此成员的全部对话记录", "이 멤버의 모든 대화 기록 지우기",
        "Borrar todos los registros de conversación de este miembro",
        "Effacer tous les enregistrements de conversation de ce membre",
        "Alle Gesprächsaufzeichnungen dieses Mitglieds löschen",
        "Apagar todos os registros de conversa deste membro",
        "Cancellare tutte le registrazioni delle conversazioni di questo membro",
        "Удалить все записи разговоров этого участника",
        "Xóa toàn bộ bản ghi hội thoại của thành viên này",
        "ล้างบันทึกการสนทนาทั้งหมดของสมาชิกนี้",
        "Hapus semua catatan percakapan anggota ini",
        "Bu üyenin tüm konuşma kayıtlarını sil"),
    "Delete one conversation record": (
        "删除这条对话记录", "대화 기록 한 건 삭제", "Eliminar un registro de conversación",
        "Supprimer un enregistrement de conversation", "Eine Gesprächsaufzeichnung löschen",
        "Excluir um registro de conversa", "Eliminare una registrazione di conversazione",
        "Удалить одну запись разговора", "Xóa một bản ghi hội thoại", "ลบบันทึกการสนทนาหนึ่งรายการ",
        "Hapus satu catatan percakapan", "Bir konuşma kaydını sil"),
    "Delete the folder (its members stay, ungrouped)": (
        "删除文件夹；成员保留并移至未分组", "폴더 삭제(멤버는 그대로 두고 그룹 해제)",
        "Eliminar la carpeta (sus miembros se quedan, sin carpeta)",
        "Supprimer le dossier (ses membres restent, sans dossier)",
        "Den Ordner löschen (die Mitglieder bleiben, ohne Ordner)",
        "Excluir a pasta (os membros ficam, sem pasta)",
        "Eliminare la cartella (i membri restano, senza cartella)",
        "Удалить папку (участники остаются без папки)",
        "Xóa thư mục (thành viên được giữ lại, không thuộc thư mục)",
        "ลบโฟลเดอร์ (สมาชิกยังอยู่ แต่ไม่อยู่ในโฟลเดอร์)",
        "Hapus folder (anggotanya tetap ada, tanpa folder)",
        "Klasörü sil (üyeler kalır, klasörsüz olur)"),
    "Replace the group chat's members": (
        "替换群聊成员", "그룹 채팅 멤버 교체", "Reemplazar a los miembros del chat grupal",
        "Remplacer les membres du chat de groupe", "Die Mitglieder des Gruppenchats ersetzen",
        "Substituir os membros do chat em grupo", "Sostituire i membri della chat di gruppo",
        "Заменить участников группового чата", "Thay thế thành viên của cuộc trò chuyện nhóm",
        "เปลี่ยนสมาชิกของแชทกลุ่ม", "Ganti anggota obrolan grup", "Grup sohbetinin üyelerini değiştir"),
    "Delete the group chat and all its messages": (
        "删除群聊及全部消息", "그룹 채팅과 모든 메시지 삭제", "Eliminar el chat grupal y todos sus mensajes",
        "Supprimer le chat de groupe et tous ses messages", "Den Gruppenchat und alle seine Nachrichten löschen",
        "Excluir o chat em grupo e todas as mensagens", "Eliminare la chat di gruppo e tutti i suoi messaggi",
        "Удалить групповой чат и все его сообщения", "Xóa cuộc trò chuyện nhóm và toàn bộ tin nhắn",
        "ลบแชทกลุ่มและข้อความทั้งหมด", "Hapus obrolan grup beserta semua pesannya",
        "Grup sohbetini ve tüm iletilerini sil"),
    "Clear all records of this conversation": (
        "清除此对话的全部记录", "이 대화의 모든 기록 지우기", "Borrar todos los registros de esta conversación",
        "Effacer tous les enregistrements de cette conversation", "Alle Aufzeichnungen dieses Gesprächs löschen",
        "Apagar todos os registros desta conversa", "Cancellare tutte le registrazioni di questa conversazione",
        "Удалить все записи этого разговора", "Xóa toàn bộ bản ghi của cuộc hội thoại này",
        "ล้างบันทึกทั้งหมดของการสนทนานี้", "Hapus semua catatan percakapan ini",
        "Bu konuşmanın tüm kayıtlarını sil"),
    "Undo the last change to a skill": (
        "撤销技能的上一次修改", "스킬의 마지막 변경 되돌리기", "Deshacer el último cambio de una habilidad",
        "Annuler la dernière modification d'une compétence", "Die letzte Änderung an einer Fähigkeit rückgängig machen",
        "Desfazer a última alteração de uma habilidade", "Annullare l'ultima modifica di una competenza",
        "Отменить последнее изменение навыка", "Hoàn tác thay đổi gần nhất của một kỹ năng",
        "ยกเลิกการเปลี่ยนแปลงล่าสุดของทักษะ", "Batalkan perubahan terakhir pada sebuah keahlian",
        "Bir becerideki son değişikliği geri al"),
    "Delete the skill and its permissions": (
        "删除技能及其授权", "스킬과 권한 삭제", "Eliminar la habilidad y sus permisos",
        "Supprimer la compétence et ses autorisations", "Die Fähigkeit und ihre Berechtigungen löschen",
        "Excluir a habilidade e suas permissões", "Eliminare la competenza e le sue autorizzazioni",
        "Удалить навык и его разрешения", "Xóa kỹ năng và các quyền của nó", "ลบทักษะและสิทธิ์ของทักษะ",
        "Hapus keahlian beserta izinnya", "Beceriyi ve izinlerini sil"),
    "Delete the member's command": (
        "删除成员指令", "멤버의 명령 삭제", "Eliminar el comando del miembro", "Supprimer la commande du membre",
        "Den Befehl des Mitglieds löschen", "Excluir o comando do membro", "Eliminare il comando del membro",
        "Удалить команду участника", "Xóa lệnh của thành viên", "ลบคำสั่งของสมาชิก", "Hapus perintah anggota",
        "Üyenin komutunu sil"),
    "Delete the routine and its schedule": (
        "删除例行任务及其计划", "루틴과 일정 삭제", "Eliminar la rutina y su programación",
        "Supprimer la routine et son planning", "Die Routine und ihren Zeitplan löschen",
        "Excluir a rotina e seu agendamento", "Eliminare la routine e la sua pianificazione",
        "Удалить регулярную задачу и её расписание", "Xóa tác vụ định kỳ và lịch của nó", "ลบงานประจำและกำหนดเวลา",
        "Hapus rutinitas beserta jadwalnya", "Rutini ve zamanlamasını sil"),
    "Disconnect and revoke its authorization": (
        "断开连接并撤销授权", "연결을 끊고 인증 취소", "Desconectar y revocar su autorización",
        "Déconnecter et révoquer son autorisation", "Trennen und die Autorisierung widerrufen",
        "Desconectar e revogar a autorização", "Disconnettere e revocare l'autorizzazione",
        "Отключить и отозвать авторизацию", "Ngắt kết nối và thu hồi ủy quyền", "ตัดการเชื่อมต่อและเพิกถอนการอนุญาต",
        "Putuskan sambungan dan cabut otorisasinya", "Bağlantıyı kes ve yetkisini iptal et"),
    "Disconnect the app and revoke its authorization": (
        "断开应用连接并撤销授权", "앱 연결을 끊고 인증 취소", "Desconectar la app y revocar su autorización",
        "Déconnecter l'application et révoquer son autorisation", "Die App trennen und die Autorisierung widerrufen",
        "Desconectar o app e revogar a autorização", "Disconnettere l'app e revocare l'autorizzazione",
        "Отключить приложение и отозвать авторизацию", "Ngắt kết nối ứng dụng và thu hồi ủy quyền",
        "ตัดการเชื่อมต่อแอปและเพิกถอนการอนุญาต", "Putuskan sambungan aplikasi dan cabut otorisasinya",
        "Uygulama bağlantısını kes ve yetkisini iptal et"),
    "Change the connection (disconnecting revokes its authorization)": (
        "变更连接；断开连接会撤销授权", "연결 변경(연결을 끊으면 인증이 취소됨)",
        "Cambiar la conexión (desconectar revoca su autorización)",
        "Modifier la connexion (la déconnexion révoque son autorisation)",
        "Die Verbindung ändern (Trennen widerruft die Autorisierung)",
        "Alterar a conexão (desconectar revoga a autorização)",
        "Modificare la connessione (disconnettere revoca l'autorizzazione)",
        "Изменить подключение (отключение отзывает авторизацию)",
        "Thay đổi kết nối (ngắt kết nối sẽ thu hồi ủy quyền)",
        "เปลี่ยนการเชื่อมต่อ (การตัดการเชื่อมต่อจะเพิกถอนการอนุญาต)",
        "Ubah sambungan (memutuskan sambungan mencabut otorisasinya)",
        "Bağlantıyı değiştir (bağlantıyı kesmek yetkiyi iptal eder)"),
    "Delete the dictionary word": (
        "删除词典词条", "사전 단어 삭제", "Eliminar la palabra del diccionario", "Supprimer le mot du dictionnaire",
        "Das Wörterbuchwort löschen", "Excluir a palavra do dicionário", "Eliminare la parola del dizionario",
        "Удалить слово из словаря", "Xóa từ trong từ điển", "ลบคำในพจนานุกรม", "Hapus kata dari kamus",
        "Sözlükteki sözcüğü sil"),
    "Delete this dictation record": (
        "删除这条听写记录", "이 받아쓰기 기록 삭제", "Eliminar este registro de dictado",
        "Supprimer cet enregistrement de dictée", "Diese Diktataufzeichnung löschen",
        "Excluir este registro de ditado", "Eliminare questa registrazione di dettatura",
        "Удалить эту запись диктовки", "Xóa bản ghi đọc chính tả này", "ลบบันทึกการพิมพ์ตามคำบอกนี้",
        "Hapus catatan dikte ini", "Bu dikte kaydını sil"),
    "Delete all dictation records": (
        "删除全部听写记录", "모든 받아쓰기 기록 삭제", "Eliminar todos los registros de dictado",
        "Supprimer tous les enregistrements de dictée", "Alle Diktataufzeichnungen löschen",
        "Excluir todos os registros de ditado", "Eliminare tutte le registrazioni di dettatura",
        "Удалить все записи диктовки", "Xóa toàn bộ bản ghi đọc chính tả", "ลบบันทึกการพิมพ์ตามคำบอกทั้งหมด",
        "Hapus semua catatan dikte", "Tüm dikte kayıtlarını sil"),
    "Clear the memory documents": (
        "清除记忆文档", "메모리 문서 지우기", "Borrar los documentos de memoria", "Effacer les documents de mémoire",
        "Die Gedächtnisdokumente löschen", "Apagar os documentos de memória", "Cancellare i documenti di memoria",
        "Очистить документы памяти", "Xóa các tài liệu bộ nhớ", "ล้างเอกสารความจำ", "Hapus dokumen memori",
        "Bellek belgelerini temizle"),
    "Clear the conversation summaries": (
        "清除对话摘要", "대화 요약 지우기", "Borrar los resúmenes de conversación",
        "Effacer les résumés de conversation", "Die Gesprächszusammenfassungen löschen",
        "Apagar os resumos de conversa", "Cancellare i riepiloghi delle conversazioni",
        "Очистить сводки разговоров", "Xóa các bản tóm tắt hội thoại", "ล้างสรุปการสนทนา",
        "Hapus ringkasan percakapan", "Konuşma özetlerini temizle"),
    "Change how long records are kept (older records are deleted for good)": (
        "变更保留天数；较旧记录将被永久删除", "기록 보관 기간 변경(오래된 기록은 영구 삭제됨)",
        "Cambiar cuánto tiempo se guardan los registros (los más antiguos se eliminan para siempre)",
        "Modifier la durée de conservation des enregistrements (les plus anciens sont supprimés définitivement)",
        "Ändern, wie lange Aufzeichnungen aufbewahrt werden (ältere werden endgültig gelöscht)",
        "Alterar por quanto tempo os registros são mantidos (os mais antigos são excluídos de vez)",
        "Cambiare per quanto tempo si conservano le registrazioni (quelle più vecchie vengono eliminate per sempre)",
        "Изменить срок хранения записей (более старые записи удаляются навсегда)",
        "Thay đổi thời gian lưu bản ghi (bản ghi cũ hơn bị xóa vĩnh viễn)",
        "เปลี่ยนระยะเวลาเก็บบันทึก (บันทึกที่เก่ากว่าจะถูกลบถาวร)",
        "Ubah berapa lama catatan disimpan (catatan yang lebih lama dihapus permanen)",
        "Kayıtların ne kadar saklanacağını değiştir (daha eski kayıtlar kalıcı olarak silinir)"),
    "Apply this management change": (
        "应用以下管理变更", "다음 관리 변경 적용", "Aplicar este cambio de administración",
        "Appliquer cette modification de gestion", "Diese Verwaltungsänderung anwenden",
        "Aplicar esta alteração de administração", "Applicare questa modifica di gestione",
        "Применить это изменение управления", "Áp dụng thay đổi quản lý này", "ใช้การเปลี่ยนแปลงการจัดการนี้",
        "Terapkan perubahan pengelolaan ini", "Bu yönetim değişikliğini uygula"),
    "{count} changes need your approval": (
        "有 {count} 项变更需要你同意", "승인이 필요한 변경 {count}건", "{count} cambios necesitan su aprobación",
        "{count} modifications attendent votre accord", "{count} Änderungen warten auf Ihre Zustimmung",
        "{count} alterações precisam da sua aprovação", "{count} modifiche richiedono la sua approvazione",
        "{count} изменений ждут вашего согласия", "{count} thay đổi cần bạn đồng ý",
        "มี {count} การเปลี่ยนแปลงที่รอการอนุมัติจากคุณ", "{count} perubahan membutuhkan persetujuan Anda",
        "{count} değişiklik onayınızı bekliyor"),
    "Removed members": (
        "移除的成员", "제거되는 멤버", "Miembros eliminados", "Membres retirés", "Entfernte Mitglieder",
        "Membros removidos", "Membri rimossi", "Удаляемые участники", "Thành viên bị gỡ",
        "สมาชิกที่ถูกนำออก", "Anggota yang dikeluarkan", "Çıkarılan üyeler"),
    "{days} days": (
        "{days} 天", "{days}일", "{days} días", "{days} jours", "{days} Tage", "{days} dias", "{days} giorni",
        "{days} дн.", "{days} ngày", "{days} วัน", "{days} hari", "{days} gün"),
    "forever": (
        "永久保留", "영구 보관", "para siempre", "pour toujours", "für immer", "para sempre", "per sempre",
        "бессрочно", "mãi mãi", "ตลอดไป", "selamanya", "süresiz"),
    "Model": (
        "模型", "모델", "Modelo", "Modèle", "Modell", "Modelo", "Modello", "Модель", "Mô hình", "โมเดล", "Model", "Model"),
    "Effort": (
        "思考强度", "사고 강도", "Esfuerzo", "Effort de réflexion", "Denkaufwand", "Esforço", "Impegno",
        "Усилие", "Mức suy luận", "ระดับการคิด", "Tingkat penalaran", "Çaba"),
    "Tools": (
        "工具", "도구", "Herramientas", "Outils", "Werkzeuge", "Ferramentas", "Strumenti", "Инструменты",
        "Công cụ", "เครื่องมือ", "Alat", "Araçlar"),
    "Done: {change}": (
        "已完成：{change}", "완료: {change}", "Hecho: {change}", "Fait : {change}", "Erledigt: {change}",
        "Concluído: {change}", "Fatto: {change}", "Выполнено: {change}", "Đã xong: {change}",
        "เสร็จแล้ว: {change}", "Selesai: {change}", "Tamamlandı: {change}"),
    "Not done: {change}": (
        "未完成：{change}", "완료하지 못함: {change}", "No realizado: {change}", "Non effectué : {change}",
        "Nicht ausgeführt: {change}", "Não realizado: {change}", "Non eseguito: {change}",
        "Не выполнено: {change}", "Chưa thực hiện: {change}", "ไม่สำเร็จ: {change}", "Gagal: {change}",
        "Yapılamadı: {change}"),
    "Not done: {change} (it no longer exists)": (
        "未完成：{change}（它已不存在）", "완료하지 못함: {change}(이미 없음)", "No realizado: {change} (ya no existe)",
        "Non effectué : {change} (n'existe plus)", "Nicht ausgeführt: {change} (existiert nicht mehr)",
        "Não realizado: {change} (não existe mais)", "Non eseguito: {change} (non esiste più)",
        "Не выполнено: {change} (его больше нет)", "Chưa thực hiện: {change} (không còn tồn tại)",
        "ไม่สำเร็จ: {change} (ไม่มีอยู่แล้ว)", "Gagal: {change} (sudah tidak ada)", "Yapılamadı: {change} (artık yok)"),
    "Timed out before you answered, so nothing was changed": (
        "你还没回答就超时了，所以没有做任何变更", "답하기 전에 시간이 지나 아무것도 변경되지 않았습니다",
        "Se agotó el tiempo antes de su respuesta, así que no se cambió nada",
        "Le délai a expiré avant votre réponse, rien n'a été modifié",
        "Die Zeit ist abgelaufen, bevor Sie geantwortet haben; es wurde nichts geändert",
        "O tempo acabou antes da sua resposta, então nada foi alterado",
        "Il tempo è scaduto prima della sua risposta, quindi non è stato modificato nulla",
        "Время истекло до вашего ответа, ничего не изменено",
        "Đã hết thời gian trước khi bạn trả lời nên không có gì bị thay đổi",
        "หมดเวลาก่อนที่คุณจะตอบ จึงไม่มีอะไรถูกเปลี่ยน",
        "Waktu habis sebelum Anda menjawab, jadi tidak ada yang diubah",
        "Siz yanıtlamadan süre doldu, bu yüzden hiçbir şey değiştirilmedi"),
}

CARD_WORDS = {source: dict(zip(_ORDER, row, strict=True)) for source, row in _ROWS.items()}
