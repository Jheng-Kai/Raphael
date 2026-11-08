// Fixed native notices authored for the additional interface locales.

pub(super) fn text(source: &str, language: &str) -> Option<&'static str> {
    match source {
        "《Notice. This window has higher privileges and refuses the paste. The text is copied. Press Ctrl+V.》" => {
            match language {
                "zh-CN" => Some("《告。此窗口权限较高，无法粘贴。文字已拷贝，请按 Ctrl+V。》"),
                "ko" => Some(
                    "《알림. 이 창의 권한이 높아 붙여넣을 수 없습니다. 텍스트를 복사했습니다. Ctrl+V를 눌러 주세요.》",
                ),
                "es" => Some(
                    "《Aviso. Esta ventana tiene privilegios elevados y no permite pegar. El texto está copiado. Pulsa Ctrl+V.》",
                ),
                "fr" => Some(
                    "《Avis. Cette fenêtre dispose de droits élevés et refuse le collage. Le texte est copié. Appuyez sur Ctrl+V.》",
                ),
                "de" => Some(
                    "《Hinweis. Dieses Fenster hat höhere Rechte und verweigert das Einfügen. Der Text wurde kopiert. Drücke Strg+V.》",
                ),
                "pt-BR" => Some(
                    "《Aviso. Esta janela tem privilégios elevados e não permite colar. O texto foi copiado. Pressione Ctrl+V.》",
                ),
                "it" => Some(
                    "《Avviso. Questa finestra ha privilegi elevati e non consente di incollare. Il testo è copiato. Premi Ctrl+V.》",
                ),
                "ru" => Some(
                    "《Уведомление. У окна повышенные права, вставка запрещена. Текст скопирован. Нажмите Ctrl+V.》",
                ),
                "vi" => Some(
                    "《Thông báo. Cửa sổ này có quyền cao hơn nên không cho dán. Đã sao chép văn bản. Nhấn Ctrl+V.》",
                ),
                "th" => {
                    Some("《แจ้งให้ทราบ. หน้าต่างนี้มีสิทธิ์สูงกว่าและไม่อนุญาตให้วาง คัดลอกข้อความแล้ว กด Ctrl+V》")
                }
                "id" => Some(
                    "《Pemberitahuan. Jendela ini memiliki hak lebih tinggi dan menolak penempelan. Teks telah disalin. Tekan Ctrl+V.》",
                ),
                "tr" => Some(
                    "《Bildirim. Bu pencere daha yüksek yetkilere sahip ve yapıştırmayı reddediyor. Metin kopyalandı. Ctrl+V’ye basın.》",
                ),
                _ => None,
            }
        }
        "《Notice. The focus moved to another window. The text is copied. Press Ctrl+V.》" => {
            match language {
                "zh-CN" => Some("《告。侦测到窗口切换。文字已拷贝，请按 Ctrl+V。》"),
                "ko" => Some(
                    "《알림. 다른 창으로 전환되었습니다. 텍스트를 복사했습니다. Ctrl+V를 눌러 주세요.》",
                ),
                "es" => Some(
                    "《Aviso. El foco cambió a otra ventana. El texto está copiado. Pulsa Ctrl+V.》",
                ),
                "fr" => Some(
                    "《Avis. Le focus est passé à une autre fenêtre. Le texte est copié. Appuyez sur Ctrl+V.》",
                ),
                "de" => Some(
                    "《Hinweis. Der Fokus ist zu einem anderen Fenster gewechselt. Der Text wurde kopiert. Drücke Strg+V.》",
                ),
                "pt-BR" => Some(
                    "《Aviso. O foco mudou para outra janela. O texto foi copiado. Pressione Ctrl+V.》",
                ),
                "it" => Some(
                    "《Avviso. Il focus è passato a un’altra finestra. Il testo è copiato. Premi Ctrl+V.》",
                ),
                "ru" => Some(
                    "《Уведомление. Фокус перешёл в другое окно. Текст скопирован. Нажмите Ctrl+V.》",
                ),
                "vi" => Some(
                    "《Thông báo. Tiêu điểm đã chuyển sang cửa sổ khác. Đã sao chép văn bản. Nhấn Ctrl+V.》",
                ),
                "th" => Some("《แจ้งให้ทราบ. โฟกัสย้ายไปหน้าต่างอื่นแล้ว คัดลอกข้อความแล้ว กด Ctrl+V》"),
                "id" => Some(
                    "《Pemberitahuan. Fokus berpindah ke jendela lain. Teks telah disalin. Tekan Ctrl+V.》",
                ),
                "tr" => Some(
                    "《Bildirim. Odak başka pencereye geçti. Metin kopyalandı. Ctrl+V’ye basın.》",
                ),
                _ => None,
            }
        }
        "《Notice. This month's budget is exhausted. Dictation is pasted without cleanup.》" => {
            match language {
                "zh-CN" => Some("《告。本月额度已用尽。听写暂不整理，直接粘贴原文。》"),
                "ko" => Some(
                    "《알림. 이번 달 예산을 모두 사용했습니다. 받아쓰기를 정리하지 않고 붙여넣습니다.》",
                ),
                "es" => Some(
                    "《Aviso. Se agotó el presupuesto de este mes. El dictado se pega sin limpiar.》",
                ),
                "fr" => Some(
                    "《Avis. Le budget du mois est épuisé. La dictée est collée sans correction.》",
                ),
                "de" => Some(
                    "《Hinweis. Das Monatsbudget ist aufgebraucht. Das Diktat wird unbearbeitet eingefügt.》",
                ),
                "pt-BR" => {
                    Some("《Aviso. O orçamento deste mês acabou. O ditado é colado sem revisão.》")
                }
                "it" => Some(
                    "《Avviso. Il budget del mese è esaurito. La dettatura viene incollata senza revisione.》",
                ),
                "ru" => Some(
                    "《Уведомление. Месячный бюджет исчерпан. Диктовка вставляется без обработки.》",
                ),
                "vi" => Some(
                    "《Thông báo. Đã hết ngân sách tháng này. Dán bản đọc chính tả chưa chỉnh sửa.》",
                ),
                "th" => Some("《แจ้งให้ทราบ. งบประมาณเดือนนี้หมดแล้ว วางข้อความตามคำบอกโดยไม่ปรับแก้》"),
                "id" => Some(
                    "《Pemberitahuan. Anggaran bulan ini habis. Dikte ditempel tanpa perapian.》",
                ),
                "tr" => Some(
                    "《Bildirim. Bu ayın bütçesi tükendi. Dikte düzenlenmeden yapıştırılıyor.》",
                ),
                _ => None,
            }
        }
        "《Notice. OpenRouter is unreachable. The text is pasted without cleanup.》" => {
            match language {
                "zh-CN" => Some("《告。无法连接至 OpenRouter。改为粘贴未整理的原文。》"),
                "ko" => Some(
                    "《알림. OpenRouter에 연결할 수 없습니다. 정리하지 않은 텍스트를 붙여넣습니다.》",
                ),
                "es" => Some(
                    "《Aviso. No se puede acceder a OpenRouter. El texto se pega sin limpiar.》",
                ),
                "fr" => Some(
                    "《Avis. OpenRouter est inaccessible. Le texte est collé sans correction.》",
                ),
                "de" => Some(
                    "《Hinweis. OpenRouter ist nicht erreichbar. Der Text wird unbearbeitet eingefügt.》",
                ),
                "pt-BR" => {
                    Some("《Aviso. OpenRouter está inacessível. O texto é colado sem revisão.》")
                }
                "it" => Some(
                    "《Avviso. OpenRouter non è raggiungibile. Il testo viene incollato senza revisione.》",
                ),
                "ru" => {
                    Some("《Уведомление. OpenRouter недоступен. Текст вставляется без обработки.》")
                }
                "vi" => Some(
                    "《Thông báo. Không kết nối được OpenRouter. Dán văn bản chưa chỉnh sửa.》",
                ),
                "th" => Some("《แจ้งให้ทราบ. ติดต่อ OpenRouter ไม่ได้ วางข้อความโดยไม่ปรับแก้》"),
                "id" => Some(
                    "《Pemberitahuan. OpenRouter tidak dapat dijangkau. Teks ditempel tanpa perapian.》",
                ),
                "tr" => Some(
                    "《Bildirim. OpenRouter’a ulaşılamıyor. Metin düzenlenmeden yapıştırılıyor.》",
                ),
                _ => None,
            }
        }
        "《Notice. Cleanup did not finish this time. The text is pasted as you said it.》" => {
            match language {
                "zh-CN" => Some("《告。这次没有整理成功，已粘贴原文。》"),
                "ko" => Some(
                    "《알림. 이번에는 정리가 완료되지 않았습니다. 말한 그대로 텍스트를 붙여넣었습니다.》",
                ),
                "es" => Some(
                    "《Aviso. La limpieza no terminó esta vez. El texto se pega tal como lo dijiste.》",
                ),
                "fr" => Some(
                    "《Avis. La correction n’a pas abouti cette fois. Le texte est collé tel que vous l’avez dicté.》",
                ),
                "de" => Some(
                    "《Hinweis. Die Überarbeitung wurde diesmal nicht abgeschlossen. Der Text wird wie gesprochen eingefügt.》",
                ),
                "pt-BR" => Some(
                    "《Aviso. A revisão não foi concluída desta vez. O texto é colado como você ditou.》",
                ),
                "it" => Some(
                    "《Avviso. Questa volta la revisione non è terminata. Il testo viene incollato come dettato.》",
                ),
                "ru" => Some(
                    "《Уведомление. Обработка не завершилась. Текст вставлен так, как вы его произнесли.》",
                ),
                "vi" => Some(
                    "《Thông báo. Lần này chưa chỉnh sửa xong. Đã dán nguyên văn lời bạn nói.》",
                ),
                "th" => Some("《แจ้งให้ทราบ. ครั้งนี้ปรับแก้ไม่สำเร็จ วางข้อความตามที่คุณพูดแล้ว》"),
                "id" => Some(
                    "《Pemberitahuan. Perapian kali ini tidak selesai. Teks ditempel sebagaimana Anda mengucapkannya.》",
                ),
                "tr" => Some(
                    "《Bildirim. Düzenleme bu kez tamamlanmadı. Metin söylediğiniz gibi yapıştırıldı.》",
                ),
                _ => None,
            }
        }
        "《Notice. No OpenRouter key is set. The text is pasted without cleanup.》" => {
            match language {
                "zh-CN" => Some("《告。未设置 OpenRouter 密钥。改为粘贴未整理的原文。》"),
                "ko" => Some(
                    "《알림. OpenRouter 키가 설정되지 않았습니다. 정리하지 않은 텍스트를 붙여넣습니다.》",
                ),
                "es" => Some(
                    "《Aviso. No se ha configurado una clave de OpenRouter. El texto se pega sin limpiar.》",
                ),
                "fr" => Some(
                    "《Avis. Aucune clé OpenRouter n’est définie. Le texte est collé sans correction.》",
                ),
                "de" => Some(
                    "《Hinweis. Es ist kein OpenRouter-Schlüssel hinterlegt. Der Text wird unbearbeitet eingefügt.》",
                ),
                "pt-BR" => Some(
                    "《Aviso. Nenhuma chave OpenRouter foi configurada. O texto é colado sem revisão.》",
                ),
                "it" => Some(
                    "《Avviso. Nessuna chiave OpenRouter impostata. Il testo viene incollato senza revisione.》",
                ),
                "ru" => Some(
                    "《Уведомление. Ключ OpenRouter не задан. Текст вставляется без обработки.》",
                ),
                "vi" => {
                    Some("《Thông báo. Chưa đặt khóa OpenRouter. Dán văn bản chưa chỉnh sửa.》")
                }
                "th" => Some("《แจ้งให้ทราบ. ยังไม่ได้ตั้งค่าคีย์ OpenRouter วางข้อความโดยไม่ปรับแก้》"),
                "id" => Some(
                    "《Pemberitahuan. Kunci OpenRouter belum diatur. Teks ditempel tanpa perapian.》",
                ),
                "tr" => Some(
                    "《Bildirim. OpenRouter anahtarı ayarlanmamış. Metin düzenlenmeden yapıştırılıyor.》",
                ),
                _ => None,
            }
        }
        "《Negative. No microphone is available. Connect one and select it in Settings > Dictation > Microphone.》" => {
            match language {
                "zh-CN" => {
                    Some("《否。未侦测到麦克风。请接上设备，再到「设置 › 听写 › 麦克风」选择。》")
                }
                "ko" => Some(
                    "《거절. 마이크를 사용할 수 없습니다. 연결한 뒤 설정 > 받아쓰기 > 마이크에서 선택해 주세요.》",
                ),
                "es" => Some(
                    "《No. No hay micrófono disponible. Conecta uno y selecciónalo en Ajustes > Dictado > Micrófono.》",
                ),
                "fr" => Some(
                    "《Non. Aucun microphone disponible. Branchez-en un et sélectionnez-le dans Paramètres > Dictée > Microphone.》",
                ),
                "de" => Some(
                    "《Nein. Kein Mikrofon verfügbar. Schließe eines an und wähle es unter Einstellungen > Diktat > Mikrofon.》",
                ),
                "pt-BR" => Some(
                    "《Não. Nenhum microfone disponível. Conecte um e selecione em Configurações > Ditado > Microfone.》",
                ),
                "it" => Some(
                    "《No. Nessun microfono disponibile. Collegane uno e selezionalo in Impostazioni > Dettatura > Microfono.》",
                ),
                "ru" => Some(
                    "《Нет. Микрофон недоступен. Подключите его и выберите в Настройки > Диктовка > Микрофон.》",
                ),
                "vi" => Some(
                    "《Không. Không có micrô. Kết nối và chọn tại Cài đặt > Đọc chính tả > Micrô.》",
                ),
                "th" => Some(
                    "《ไม่. ไม่มีไมโครโฟนให้ใช้ เชื่อมต่อแล้วเลือกที่ การตั้งค่า > การเขียนตามคำบอก > ไมโครโฟน》",
                ),
                "id" => Some(
                    "《Tidak. Mikrofon tidak tersedia. Hubungkan dan pilih di Pengaturan > Dikte > Mikrofon.》",
                ),
                "tr" => Some(
                    "《Hayır. Mikrofon kullanılamıyor. Bağlayıp Ayarlar > Dikte > Mikrofon’dan seçin.》",
                ),
                _ => None,
            }
        }
        "《Negative. No sound was received. Unmute the microphone and allow desktop apps in Windows microphone privacy settings.》" => {
            match language {
                "zh-CN" => Some(
                    "《否。未收到声音。请取消麦克风静音，并在 Windows 的麦克风隐私设置允许桌面应用程序。》",
                ),
                "ko" => Some(
                    "《거절. 소리가 수신되지 않았습니다. 마이크 음소거를 해제하고 Windows 마이크 개인 정보 설정에서 데스크톱 앱을 허용해 주세요.》",
                ),
                "es" => Some(
                    "《No. No se recibió sonido. Activa el micrófono y permite aplicaciones de escritorio en la privacidad del micrófono de Windows.》",
                ),
                "fr" => Some(
                    "《Non. Aucun son reçu. Réactivez le microphone et autorisez les applications de bureau dans les paramètres de confidentialité du microphone Windows.》",
                ),
                "de" => Some(
                    "《Nein. Kein Ton empfangen. Hebe die Stummschaltung auf und erlaube Desktop-Apps in den Windows-Mikrofon-Datenschutzeinstellungen.》",
                ),
                "pt-BR" => Some(
                    "《Não. Nenhum som recebido. Ative o microfone e permita apps de desktop nas configurações de privacidade do microfone do Windows.》",
                ),
                "it" => Some(
                    "《No. Nessun suono ricevuto. Riattiva il microfono e consenti le app desktop nelle impostazioni di privacy del microfono Windows.》",
                ),
                "ru" => Some(
                    "《Нет. Звук не получен. Включите микрофон и разрешите классические приложения в настройках конфиденциальности микрофона Windows.》",
                ),
                "vi" => Some(
                    "《Không. Không nhận được âm thanh. Bỏ tắt micrô và cho phép ứng dụng máy tính trong cài đặt quyền riêng tư micrô Windows.》",
                ),
                "th" => Some(
                    "《ไม่. ไม่ได้รับเสียง เปิดเสียงไมโครโฟนและอนุญาตแอปเดสก์ท็อปในการตั้งค่าความเป็นส่วนตัวของไมโครโฟน Windows》",
                ),
                "id" => Some(
                    "《Tidak. Tidak ada suara diterima. Aktifkan mikrofon dan izinkan aplikasi desktop di pengaturan privasi mikrofon Windows.》",
                ),
                "tr" => Some(
                    "《Hayır. Ses alınmadı. Mikrofonun sesini açın ve Windows mikrofon gizlilik ayarlarında masaüstü uygulamalarına izin verin.》",
                ),
                _ => None,
            }
        }
        "《Negative. Cloud recognition is not connected. Set the OpenRouter key in Settings > Models & usage > Usage, or download a local model in Settings > Dictation.》" => {
            match language {
                "zh-CN" => Some(
                    "《否。云端语音辨识尚未连接。请到「设置 › 模型与用量 › 用量」设置 OpenRouter 密钥，或到「设置 › 听写」下载本机模型。》",
                ),
                "ko" => Some(
                    "《거절. 클라우드 음성 인식이 연결되지 않았습니다. 설정 > 모델 및 사용량 > 사용량에서 OpenRouter 키를 설정하거나 설정 > 받아쓰기에서 로컬 모델을 다운로드해 주세요.》",
                ),
                "es" => Some(
                    "《No. El reconocimiento en la nube no está conectado. Configura la clave OpenRouter en Ajustes > Modelos y uso > Uso o descarga un modelo local en Ajustes > Dictado.》",
                ),
                "fr" => Some(
                    "《Non. La reconnaissance cloud n’est pas connectée. Définissez la clé OpenRouter dans Paramètres > Modèles et utilisation > Utilisation ou téléchargez un modèle local dans Paramètres > Dictée.》",
                ),
                "de" => Some(
                    "《Nein. Cloud-Spracherkennung ist nicht verbunden. Hinterlege den OpenRouter-Schlüssel unter Einstellungen > Modelle und Nutzung > Nutzung oder lade unter Einstellungen > Diktat ein lokales Modell herunter.》",
                ),
                "pt-BR" => Some(
                    "《Não. O reconhecimento na nuvem não está conectado. Configure a chave OpenRouter em Configurações > Modelos e uso > Uso ou baixe um modelo local em Configurações > Ditado.》",
                ),
                "it" => Some(
                    "《No. Il riconoscimento cloud non è collegato. Imposta la chiave OpenRouter in Impostazioni > Modelli e utilizzo > Utilizzo o scarica un modello locale in Impostazioni > Dettatura.》",
                ),
                "ru" => Some(
                    "《Нет. Облачное распознавание не подключено. Задайте ключ OpenRouter в Настройки > Модели и использование > Использование или скачайте локальную модель в Настройки > Диктовка.》",
                ),
                "vi" => Some(
                    "《Không. Chưa kết nối nhận dạng đám mây. Đặt khóa OpenRouter tại Cài đặt > Mô hình và mức dùng > Mức dùng hoặc tải mô hình cục bộ tại Cài đặt > Đọc chính tả.》",
                ),
                "th" => Some(
                    "《ไม่. ยังไม่เชื่อมต่อการรู้จำบนคลาวด์ ตั้งคีย์ OpenRouter ที่ การตั้งค่า > โมเดลและการใช้งาน > การใช้งาน หรือดาวน์โหลดโมเดลในเครื่องที่ การตั้งค่า > การเขียนตามคำบอก》",
                ),
                "id" => Some(
                    "《Tidak. Pengenalan cloud belum terhubung. Atur kunci OpenRouter di Pengaturan > Model dan penggunaan > Penggunaan atau unduh model lokal di Pengaturan > Dikte.》",
                ),
                "tr" => Some(
                    "《Hayır. Bulut tanıma bağlı değil. Ayarlar > Modeller ve kullanım > Kullanım’da OpenRouter anahtarını ayarlayın veya Ayarlar > Dikte’den yerel model indirin.》",
                ),
                _ => None,
            }
        }
        "《Negative. The local speech model is not downloaded. Download it in Settings > Dictation before recording.》" => {
            match language {
                "zh-CN" => Some("《否。尚未下载本机语音模型。请到「设置 › 听写」下载后再录音。》"),
                "ko" => Some(
                    "《거절. 로컬 음성 모델이 다운로드되지 않았습니다. 녹음 전에 설정 > 받아쓰기에서 다운로드해 주세요.》",
                ),
                "es" => Some(
                    "《No. El modelo de voz local no está descargado. Descárgalo en Ajustes > Dictado antes de grabar.》",
                ),
                "fr" => Some(
                    "《Non. Le modèle vocal local n’est pas téléchargé. Téléchargez-le dans Paramètres > Dictée avant d’enregistrer.》",
                ),
                "de" => Some(
                    "《Nein. Das lokale Sprachmodell wurde nicht heruntergeladen. Lade es vor der Aufnahme unter Einstellungen > Diktat herunter.》",
                ),
                "pt-BR" => Some(
                    "《Não. O modelo de fala local não foi baixado. Baixe em Configurações > Ditado antes de gravar.》",
                ),
                "it" => Some(
                    "《No. Il modello vocale locale non è scaricato. Scaricalo in Impostazioni > Dettatura prima di registrare.》",
                ),
                "ru" => Some(
                    "《Нет. Локальная речевая модель не скачана. Скачайте её в Настройки > Диктовка перед записью.》",
                ),
                "vi" => Some(
                    "《Không. Chưa tải mô hình giọng nói cục bộ. Tải tại Cài đặt > Đọc chính tả trước khi ghi âm.》",
                ),
                "th" => Some(
                    "《ไม่. ยังไม่ได้ดาวน์โหลดโมเดลเสียงในเครื่อง ดาวน์โหลดที่ การตั้งค่า > การเขียนตามคำบอก ก่อนบันทึกเสียง》",
                ),
                "id" => Some(
                    "《Tidak. Model suara lokal belum diunduh. Unduh di Pengaturan > Dikte sebelum merekam.》",
                ),
                "tr" => Some(
                    "《Hayır. Yerel konuşma modeli indirilmemiş. Kayıttan önce Ayarlar > Dikte’den indirin.》",
                ),
                _ => None,
            }
        }
        "《Negative. Speech recognition is not ready. Download a local model in Settings > Dictation; for cloud recognition check the connection in Settings > Models & usage.》" => {
            match language {
                "zh-CN" => Some(
                    "《否。语音辨识尚未就绪。请到「设置 › 听写」下载本机模型；使用云端辨识时，请在「设置 › 模型与用量」确认连接。》",
                ),
                "ko" => Some(
                    "《거절. 음성 인식이 준비되지 않았습니다. 설정 > 받아쓰기에서 로컬 모델을 다운로드해 주세요. 클라우드 인식은 설정 > 모델 및 사용량에서 연결을 확인해 주세요.》",
                ),
                "es" => Some(
                    "《No. El reconocimiento de voz no está listo. Descarga un modelo local en Ajustes > Dictado; para la nube comprueba la conexión en Ajustes > Modelos y uso.》",
                ),
                "fr" => Some(
                    "《Non. La reconnaissance vocale n’est pas prête. Téléchargez un modèle local dans Paramètres > Dictée ; pour le cloud, vérifiez la connexion dans Paramètres > Modèles et utilisation.》",
                ),
                "de" => Some(
                    "《Nein. Die Spracherkennung ist nicht bereit. Lade unter Einstellungen > Diktat ein lokales Modell herunter; prüfe für Cloud-Erkennung die Verbindung unter Einstellungen > Modelle und Nutzung.》",
                ),
                "pt-BR" => Some(
                    "《Não. O reconhecimento de fala não está pronto. Baixe um modelo local em Configurações > Ditado; para a nuvem, confira a conexão em Configurações > Modelos e uso.》",
                ),
                "it" => Some(
                    "《No. Il riconoscimento vocale non è pronto. Scarica un modello locale in Impostazioni > Dettatura; per il cloud controlla la connessione in Impostazioni > Modelli e utilizzo.》",
                ),
                "ru" => Some(
                    "《Нет. Распознавание речи не готово. Скачайте локальную модель в Настройки > Диктовка; для облака проверьте подключение в Настройки > Модели и использование.》",
                ),
                "vi" => Some(
                    "《Không. Nhận dạng giọng nói chưa sẵn sàng. Tải mô hình cục bộ tại Cài đặt > Đọc chính tả; với đám mây, kiểm tra kết nối tại Cài đặt > Mô hình và mức dùng.》",
                ),
                "th" => Some(
                    "《ไม่. การรู้จำเสียงยังไม่พร้อม ดาวน์โหลดโมเดลในเครื่องที่ การตั้งค่า > การเขียนตามคำบอก สำหรับคลาวด์ตรวจสอบการเชื่อมต่อที่ การตั้งค่า > โมเดลและการใช้งาน》",
                ),
                "id" => Some(
                    "《Tidak. Pengenalan suara belum siap. Unduh model lokal di Pengaturan > Dikte; untuk cloud periksa koneksi di Pengaturan > Model dan penggunaan.》",
                ),
                "tr" => Some(
                    "《Hayır. Konuşma tanıma hazır değil. Ayarlar > Dikte’den yerel model indirin; bulut tanıma için Ayarlar > Modeller ve kullanım’da bağlantıyı kontrol edin.》",
                ),
                _ => None,
            }
        }
        "《Negative. Cloud transcription failed and there is no local model. Download one in Settings > Dictation, then try again.》" => {
            match language {
                "zh-CN" => {
                    Some("《否。云端辨识失败，且没有本机模型。请到「设置 › 听写」下载后再试。》")
                }
                "ko" => Some(
                    "《거절. 클라우드 전사에 실패했고 로컬 모델도 없습니다. 설정 > 받아쓰기에서 다운로드한 뒤 다시 시도해 주세요.》",
                ),
                "es" => Some(
                    "《No. La transcripción en la nube falló y no hay modelo local. Descarga uno en Ajustes > Dictado y reintenta.》",
                ),
                "fr" => Some(
                    "《Non. La transcription cloud a échoué et aucun modèle local n’est disponible. Téléchargez-en un dans Paramètres > Dictée, puis réessayez.》",
                ),
                "de" => Some(
                    "《Nein. Die Cloud-Transkription ist fehlgeschlagen und es gibt kein lokales Modell. Lade eines unter Einstellungen > Diktat herunter und versuche es erneut.》",
                ),
                "pt-BR" => Some(
                    "《Não. A transcrição na nuvem falhou e não há modelo local. Baixe um em Configurações > Ditado e tente novamente.》",
                ),
                "it" => Some(
                    "《No. La trascrizione cloud non è riuscita e manca un modello locale. Scaricane uno in Impostazioni > Dettatura e riprova.》",
                ),
                "ru" => Some(
                    "《Нет. Облачная расшифровка не удалась, локальной модели нет. Скачайте её в Настройки > Диктовка и повторите попытку.》",
                ),
                "vi" => Some(
                    "《Không. Chép lời đám mây thất bại và không có mô hình cục bộ. Tải một mô hình tại Cài đặt > Đọc chính tả rồi thử lại.》",
                ),
                "th" => Some(
                    "《ไม่. ถอดเสียงบนคลาวด์ล้มเหลวและไม่มีโมเดลในเครื่อง ดาวน์โหลดที่ การตั้งค่า > การเขียนตามคำบอก แล้วลองอีกครั้ง》",
                ),
                "id" => Some(
                    "《Tidak. Transkripsi cloud gagal dan tidak ada model lokal. Unduh di Pengaturan > Dikte lalu coba lagi.》",
                ),
                "tr" => Some(
                    "《Hayır. Bulut dökümü başarısız ve yerel model yok. Ayarlar > Dikte’den bir model indirip yeniden deneyin.》",
                ),
                _ => None,
            }
        }
        "《Negative. Some speech could not be transcribed. Gaps are marked in the text.》" => {
            match language {
                "zh-CN" => Some("《否。部分语音无法辨识，文字已标示缺漏。》"),
                "ko" => Some(
                    "《거절. 일부 음성을 전사하지 못했습니다. 텍스트에 누락 부분을 표시했습니다.》",
                ),
                "es" => Some(
                    "《No. Parte del audio no pudo transcribirse. Los huecos están marcados en el texto.》",
                ),
                "fr" => Some(
                    "《Non. Une partie de la parole n’a pas pu être transcrite. Les passages manquants sont signalés dans le texte.》",
                ),
                "de" => Some(
                    "《Nein. Ein Teil der Sprache konnte nicht transkribiert werden. Lücken sind im Text markiert.》",
                ),
                "pt-BR" => Some(
                    "《Não. Parte da fala não pôde ser transcrita. As lacunas estão marcadas no texto.》",
                ),
                "it" => Some(
                    "《No. Parte del parlato non è stata trascritta. Le lacune sono indicate nel testo.》",
                ),
                "ru" => {
                    Some("《Нет. Часть речи не удалось распознать. Пропуски отмечены в тексте.》")
                }
                "vi" => Some(
                    "《Không. Không chép được một phần lời nói. Đã đánh dấu chỗ thiếu trong văn bản.》",
                ),
                "th" => Some("《ไม่. ถอดเสียงบางส่วนไม่ได้ ทำเครื่องหมายส่วนที่ขาดในข้อความแล้ว》"),
                "id" => Some(
                    "《Tidak. Sebagian ucapan tidak dapat ditranskripsikan. Bagian kosong ditandai dalam teks.》",
                ),
                "tr" => Some(
                    "《Hayır. Konuşmanın bir kısmı yazıya dökülemedi. Eksikler metinde işaretlendi.》",
                ),
                _ => None,
            }
        }
        "《Negative. The core is not running. Restart Raphael.》" => match language {
            "zh-CN" => Some("《否。内核未在运作。请重新启动拉斐尔。》"),
            "ko" => Some("《거절. 코어가 실행 중이 아닙니다. Raphael을 다시 시작해 주세요.》"),
            "es" => Some("《No. El núcleo no está en ejecución. Reinicia Raphael.》"),
            "fr" => Some("《Non. Le noyau n’est pas en cours d’exécution. Redémarrez Raphael.》"),
            "de" => Some("《Nein. Der Kern läuft nicht. Starte Raphael neu.》"),
            "pt-BR" => Some("《Não. O núcleo não está em execução. Reinicie o Raphael.》"),
            "it" => Some("《No. Il nucleo non è in esecuzione. Riavvia Raphael.》"),
            "ru" => Some("《Нет. Ядро не запущено. Перезапустите Рафаэля.》"),
            "vi" => Some("《Không. Lõi không chạy. Khởi động lại Raphael.》"),
            "th" => Some("《ไม่. คอร์ไม่ทำงาน เริ่ม Raphael ใหม่》"),
            "id" => Some("《Tidak. Inti tidak berjalan. Mulai ulang Raphael.》"),
            "tr" => Some("《Hayır. Çekirdek çalışmıyor. Raphael’i yeniden başlatın.》"),
            _ => None,
        },
        "《Notice. The service stopped unexpectedly and has restarted. Please repeat your last request.》" => {
            match language {
                "zh-CN" => Some("《告。服务刚才意外中断，已重新启动。请重新提出刚才的请求。》"),
                "ko" => Some(
                    "《알림. 서비스가 예기치 않게 중지되어 다시 시작되었습니다. 마지막 요청을 다시 해 주세요.》",
                ),
                "es" => Some(
                    "《Aviso. El servicio se detuvo inesperadamente y se ha reiniciado. Repite tu última solicitud.》",
                ),
                "fr" => Some(
                    "《Avis. Le service s’est arrêté inopinément puis a redémarré. Répétez votre dernière demande.》",
                ),
                "de" => Some(
                    "《Hinweis. Der Dienst wurde unerwartet beendet und neu gestartet. Wiederhole deine letzte Anfrage.》",
                ),
                "pt-BR" => Some(
                    "《Aviso. O serviço parou inesperadamente e foi reiniciado. Repita sua última solicitação.》",
                ),
                "it" => Some(
                    "《Avviso. Il servizio si è arrestato inaspettatamente ed è stato riavviato. Ripeti l’ultima richiesta.》",
                ),
                "ru" => Some(
                    "《Уведомление. Сервис неожиданно остановился и был перезапущен. Повторите последний запрос.》",
                ),
                "vi" => Some(
                    "《Thông báo. Dịch vụ dừng bất ngờ và đã khởi động lại. Hãy lặp lại yêu cầu cuối.》",
                ),
                "th" => Some("《แจ้งให้ทราบ. บริการหยุดโดยไม่คาดคิดและเริ่มใหม่แล้ว โปรดส่งคำขอล่าสุดอีกครั้ง》"),
                "id" => Some(
                    "《Pemberitahuan. Layanan berhenti tiba-tiba dan telah dimulai ulang. Ulangi permintaan terakhir Anda.》",
                ),
                "tr" => Some(
                    "《Bildirim. Hizmet beklenmedik biçimde durdu ve yeniden başlatıldı. Son isteğinizi tekrarlayın.》",
                ),
                _ => None,
            }
        }
        "《Negative. No answer can be given at this time.》" => match language {
            "zh-CN" => Some("《否。目前无法回答。》"),
            "ko" => Some("《거절. 현재는 답변할 수 없습니다.》"),
            "es" => Some("《No. No se puede responder en este momento.》"),
            "fr" => Some("《Non. Impossible de répondre pour le moment.》"),
            "de" => Some("《Nein. Zurzeit ist keine Antwort möglich.》"),
            "pt-BR" => Some("《Não. Não é possível responder agora.》"),
            "it" => Some("《No. Al momento non è possibile rispondere.》"),
            "ru" => Some("《Нет. Сейчас невозможно ответить.》"),
            "vi" => Some("《Không. Hiện không thể trả lời.》"),
            "th" => Some("《ไม่. ขณะนี้ยังตอบไม่ได้》"),
            "id" => Some("《Tidak. Saat ini tidak dapat menjawab.》"),
            "tr" => Some("《Hayır. Şu anda yanıt verilemiyor.》"),
            _ => None,
        },
        "《Understood. Noted.》" => match language {
            "zh-CN" => Some("《了。已记下。》"),
            "ko" => Some("《확인. 기록했습니다.》"),
            "es" => Some("《Entendido. Anotado.》"),
            "fr" => Some("《Compris. Noté.》"),
            "de" => Some("《Verstanden. Notiert.》"),
            "pt-BR" => Some("《Entendido. Anotado.》"),
            "it" => Some("《Capito. Annotato.》"),
            "ru" => Some("《Понятно. Записано.》"),
            "vi" => Some("《Đã hiểu. Đã ghi lại.》"),
            "th" => Some("《เข้าใจแล้ว. จดไว้แล้ว》"),
            "id" => Some("《Dipahami. Dicatat.》"),
            "tr" => Some("《Anlaşıldı. Not edildi.》"),
            _ => None,
        },
        "《Notice. Standing by, Master.》" => match language {
            "zh-CN" => Some("《告。主人，请下达指示。》"),
            "ko" => Some("《알림. 지시를 기다리고 있습니다.》"),
            "es" => Some("《Aviso. A la espera de tus instrucciones.》"),
            "fr" => Some("《Avis. En attente de vos instructions.》"),
            "de" => Some("《Hinweis. Bereit für deine Anweisung.》"),
            "pt-BR" => Some("《Aviso. Aguardando suas instruções.》"),
            "it" => Some("《Avviso. In attesa delle tue istruzioni.》"),
            "ru" => Some("《Уведомление. Ожидаю ваших указаний.》"),
            "vi" => Some("《Thông báo. Đang chờ chỉ dẫn của bạn.》"),
            "th" => Some("《แจ้งให้ทราบ. พร้อมรับคำสั่งจากคุณ》"),
            "id" => Some("《Pemberitahuan. Menunggu instruksi Anda.》"),
            "tr" => Some("《Bildirim. Talimatlarınız bekleniyor.》"),
            _ => None,
        },
        "Open Raphael Home" => match language {
            "zh-CN" => Some("打开 Raphael 首页"),
            "ko" => Some("Raphael 홈 열기"),
            "es" => Some("Abrir inicio de Raphael"),
            "fr" => Some("Ouvrir l’accueil de Raphael"),
            "de" => Some("Raphael-Startseite öffnen"),
            "pt-BR" => Some("Abrir início do Raphael"),
            "it" => Some("Apri la home di Raphael"),
            "ru" => Some("Открыть главную Raphael"),
            "vi" => Some("Mở trang chủ Raphael"),
            "th" => Some("เปิดหน้าหลัก Raphael"),
            "id" => Some("Buka beranda Raphael"),
            "tr" => Some("Raphael ana sayfasını aç"),
            _ => None,
        },
        "Show History" => match language {
            "zh-CN" => Some("显示历史纪录"),
            "ko" => Some("기록 보기"),
            "es" => Some("Mostrar historial"),
            "fr" => Some("Afficher l’historique"),
            "de" => Some("Verlauf anzeigen"),
            "pt-BR" => Some("Mostrar histórico"),
            "it" => Some("Mostra cronologia"),
            "ru" => Some("Показать историю"),
            "vi" => Some("Hiện lịch sử"),
            "th" => Some("แสดงประวัติ"),
            "id" => Some("Tampilkan riwayat"),
            "tr" => Some("Geçmişi göster"),
            _ => None,
        },
        "Add Word to Dictionary" => match language {
            "zh-CN" => Some("将单字加入字典"),
            "ko" => Some("사전에 단어 추가"),
            "es" => Some("Añadir palabra al diccionario"),
            "fr" => Some("Ajouter un mot au dictionnaire"),
            "de" => Some("Wort zum Wörterbuch hinzufügen"),
            "pt-BR" => Some("Adicionar palavra ao dicionário"),
            "it" => Some("Aggiungi parola al dizionario"),
            "ru" => Some("Добавить слово в словарь"),
            "vi" => Some("Thêm từ vào từ điển"),
            "th" => Some("เพิ่มคำในพจนานุกรม"),
            "id" => Some("Tambahkan kata ke kamus"),
            "tr" => Some("Sözlüğe kelime ekle"),
            _ => None,
        },
        "Stop Background Task" => match language {
            "zh-CN" => Some("中止背景任务"),
            "ko" => Some("백그라운드 작업 중지"),
            "es" => Some("Detener tarea en segundo plano"),
            "fr" => Some("Arrêter la tâche en arrière-plan"),
            "de" => Some("Hintergrundaufgabe stoppen"),
            "pt-BR" => Some("Parar tarefa em segundo plano"),
            "it" => Some("Interrompi attività in background"),
            "ru" => Some("Остановить фоновую задачу"),
            "vi" => Some("Dừng tác vụ nền"),
            "th" => Some("หยุดงานเบื้องหลัง"),
            "id" => Some("Hentikan tugas latar belakang"),
            "tr" => Some("Arka plan görevini durdur"),
            _ => None,
        },
        "Settings…" => match language {
            "zh-CN" => Some("设置…"),
            "ko" => Some("설정…"),
            "es" => Some("Ajustes…"),
            "fr" => Some("Paramètres…"),
            "de" => Some("Einstellungen…"),
            "pt-BR" => Some("Configurações…"),
            "it" => Some("Impostazioni…"),
            "ru" => Some("Настройки…"),
            "vi" => Some("Cài đặt…"),
            "th" => Some("การตั้งค่า…"),
            "id" => Some("Pengaturan…"),
            "tr" => Some("Ayarlar…"),
            _ => None,
        },
        "Choose Microphone" => match language {
            "zh-CN" => Some("选择麦克风"),
            "ko" => Some("마이크 선택"),
            "es" => Some("Elegir micrófono"),
            "fr" => Some("Choisir le microphone"),
            "de" => Some("Mikrofon auswählen"),
            "pt-BR" => Some("Escolher microfone"),
            "it" => Some("Scegli microfono"),
            "ru" => Some("Выбрать микрофон"),
            "vi" => Some("Chọn micrô"),
            "th" => Some("เลือกไมโครโฟน"),
            "id" => Some("Pilih mikrofon"),
            "tr" => Some("Mikrofon seç"),
            _ => None,
        },
        "Auto-detect" => match language {
            "zh-CN" => Some("自动侦测"),
            "ko" => Some("자동 감지"),
            "es" => Some("Detectar automáticamente"),
            "fr" => Some("Détection automatique"),
            "de" => Some("Automatisch erkennen"),
            "pt-BR" => Some("Detectar automaticamente"),
            "it" => Some("Rilevamento automatico"),
            "ru" => Some("Определять автоматически"),
            "vi" => Some("Tự động phát hiện"),
            "th" => Some("ตรวจหาอัตโนมัติ"),
            "id" => Some("Deteksi otomatis"),
            "tr" => Some("Otomatik algıla"),
            _ => None,
        },
        "{name} (disconnected)" => match language {
            "zh-CN" => Some("{name}（未连接）"),
            "ko" => Some("{name} (연결 안 됨)"),
            "es" => Some("{name} (desconectado)"),
            "fr" => Some("{name} (déconnecté)"),
            "de" => Some("{name} (nicht verbunden)"),
            "pt-BR" => Some("{name} (desconectado)"),
            "it" => Some("{name} (scollegato)"),
            "ru" => Some("{name} (не подключён)"),
            "vi" => Some("{name} (đã ngắt kết nối)"),
            "th" => Some("{name} (ไม่ได้เชื่อมต่อ)"),
            "id" => Some("{name} (terputus)"),
            "tr" => Some("{name} (bağlı değil)"),
            _ => None,
        },
        "Version {version}" => match language {
            "zh-CN" => Some("版本 {version}"),
            "ko" => Some("버전 {version}"),
            "es" => Some("Versión {version}"),
            "fr" => Some("Version {version}"),
            "de" => Some("Version {version}"),
            "pt-BR" => Some("Versão {version}"),
            "it" => Some("Versione {version}"),
            "ru" => Some("Версия {version}"),
            "vi" => Some("Phiên bản {version}"),
            "th" => Some("เวอร์ชัน {version}"),
            "id" => Some("Versi {version}"),
            "tr" => Some("Sürüm {version}"),
            _ => None,
        },
        "Quit Raphael" => match language {
            "zh-CN" => Some("结束 Raphael"),
            "ko" => Some("Raphael 종료"),
            "es" => Some("Salir de Raphael"),
            "fr" => Some("Quitter Raphael"),
            "de" => Some("Raphael beenden"),
            "pt-BR" => Some("Sair do Raphael"),
            "it" => Some("Esci da Raphael"),
            "ru" => Some("Выйти из Raphael"),
            "vi" => Some("Thoát Raphael"),
            "th" => Some("ออกจาก Raphael"),
            "id" => Some("Keluar dari Raphael"),
            "tr" => Some("Raphael’den çık"),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn learned(language: &str) -> Option<&'static str> {
    match language {
        "zh-CN" => Some("《了。{words}已加入词典。》"),
        "ko" => Some("《확인. {words}을(를) 사전에 추가했습니다.》"),
        "es" => Some("《Entendido. Se añadió {words} al diccionario.》"),
        "fr" => Some("《Compris. {words} ajouté au dictionnaire.》"),
        "de" => Some("《Verstanden. {words} zum Wörterbuch hinzugefügt.》"),
        "pt-BR" => Some("《Entendido. {words} adicionado ao dicionário.》"),
        "it" => Some("《Capito. {words} aggiunto al dizionario.》"),
        "ru" => Some("《Понятно. {words} добавлено в словарь.》"),
        "vi" => Some("《Đã hiểu. Đã thêm {words} vào từ điển.》"),
        "th" => Some("《เข้าใจแล้ว. เพิ่ม {words} ในพจนานุกรมแล้ว》"),
        "id" => Some("《Dipahami. {words} ditambahkan ke kamus.》"),
        "tr" => Some("《Anlaşıldı. {words} sözlüğe eklendi.》"),
        _ => None,
    }
}
