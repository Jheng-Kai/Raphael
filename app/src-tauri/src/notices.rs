//! Raphael's notices: the short reports the overlay shows as subtitles when a dictation could not
//! go the usual way, the word list after learning from the user's corrections, the line that says he
//! wrote down what he was told to remember, his greeting when a question to him begins, and the
//! announcements beside the emblem while he thinks about it. Each one is wrapped in 《》 and starts
//! with its prefix: 告 (report) or 否 (refusal) in Chinese and Japanese, 了 for the learned words and
//! for a memory, and `Notice.`, `Negative.` or `Understood.` in English.
//!
//! They are written in his manner: calm, exact and brief. A report states what happened and what
//! was done about it, a refusal states why, and neither apologises, jokes or exclaims. He calls the
//! person 主人, マスター or Master only where he addresses them, which here is the greeting alone.
//!
//! A notice exists in every interface language, and the overlay is sent only the one for the
//! language the person chose ([`Notice::text`]): never a Chinese and a Japanese line side by side.

use std::sync::{Arc, Mutex};

use crate::rpc::lock;
#[path = "notice_words.rs"]
mod notice_words;

/// The interface language of the device settings that Raphael's notices and answers follow.
pub const DEFAULT_LANGUAGE: &str = "zh-TW";

/// The interface language (`ui_language` of the device settings), one of fifteen supported locales. The
/// device settings write it (at start, and when the person changes it) and the controller reads it
/// each time it has something to say. Clones share the value.
#[derive(Clone, Debug)]
pub struct LanguageCell(Arc<Mutex<String>>);

impl Default for LanguageCell {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(DEFAULT_LANGUAGE.to_owned())))
    }
}

impl LanguageCell {
    pub fn get(&self) -> String {
        lock(&self.0).clone()
    }

    pub fn set(&self, language: &str) {
        language.clone_into(&mut lock(&self.0));
    }
}

/// Source notice copy, extended by the fixed catalog for the additional interface locales.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Notice {
    pub zh: &'static str,
    pub en: &'static str,
    pub ja: &'static str,
}

impl Notice {
    /// Every supported locale has fixed copy; unknown locales use English.
    pub fn text(&self, language: &str) -> &'static str {
        match language {
            "zh-TW" => self.zh,
            "en" => self.en,
            "ja" => self.ja,
            _ => notice_words::text(self.en, language).unwrap_or(self.en),
        }
    }
}

/// The target window runs elevated, so the text was only copied.
pub const ELEVATED: Notice = Notice {
    zh: "《告。此視窗權限較高，無法貼上。文字已複製，請按 Ctrl+V。》",
    en: "《Notice. This window has higher privileges and refuses the paste. The text is copied. Press Ctrl+V.》",
    ja: "《告。権限の高いウィンドウには貼り付けできません。コピー済みです。Ctrl+V で貼り付けてください。》",
};

/// Focus moved to another window after the key was released, so the text was only copied.
pub const FOCUS_CHANGED: Notice = Notice {
    zh: "《告。偵測到視窗切換。文字已複製，請按 Ctrl+V。》",
    en: "《Notice. The focus moved to another window. The text is copied. Press Ctrl+V.》",
    ja: "《告。ウィンドウの切り替えを検知しました。コピー済みです。Ctrl+V で貼り付けてください。》",
};

/// The monthly limit is reached: the raw text is pasted without cleanup.
pub const BUDGET: Notice = Notice {
    zh: "《告。本月額度已用盡。聽寫暫不整理，直接貼上原文。》",
    en: "《Notice. This month's budget is exhausted. Dictation is pasted without cleanup.》",
    ja: "《告。今月の予算が上限に達しました。整形を省略して貼り付けます。》",
};

/// OpenRouter could not be reached: the raw text is pasted.
pub const OFFLINE: Notice = Notice {
    zh: "《告。無法連線至 OpenRouter。改為貼上未整理的原文。》",
    en: "《Notice. OpenRouter is unreachable. The text is pasted without cleanup.》",
    ja: "《告。OpenRouter に接続できません。整形前のテキストを貼り付けます。》",
};

/// Cleanup failed for any other reason: the words are not lost, and the owner is told every time.
pub const NOT_CLEANED: Notice = Notice {
    zh: "《告。這次沒有整理成功，已貼上原文。》",
    en: "《Notice. Cleanup did not finish this time. The text is pasted as you said it.》",
    ja: "《告。今回は整形できませんでした。話した内容をそのまま貼り付けます。》",
};

/// No OpenRouter key is stored: the raw text is pasted.
pub const NO_KEY: Notice = Notice {
    zh: "《告。未設定 OpenRouter 金鑰。改為貼上未整理的原文。》",
    en: "《Notice. No OpenRouter key is set. The text is pasted without cleanup.》",
    ja: "《告。OpenRouter のキーが未設定です。整形前のテキストを貼り付けます。》",
};

/// The core found no microphone to record from.
pub const NO_MIC: Notice = Notice {
    zh: "《否。未偵測到麥克風。請接上裝置，再到「設定 › 聽寫 › 麥克風」選擇。》",
    en: "《Negative. No microphone is available. Connect one and select it in Settings > Dictation > Microphone.》",
    ja: "《否。マイクを検出できません。接続し、「設定 › ディクテーション › マイク」で選んでください。》",
};

/// The microphone is there but delivered no sound (muted, or a wireless headset asleep), and
/// nothing came of the recording (`silent` in the result of `dictation.stop`).
pub const NO_SOUND: Notice = Notice {
    zh: "《否。未收到聲音。請取消麥克風靜音，並在 Windows 的麥克風隱私設定允許桌面應用程式。》",
    en: "《Negative. No sound was received. Unmute the microphone and allow desktop apps in Windows microphone privacy settings.》",
    ja: "《否。音声を受信できません。ミュートを解除し、Windows のマイク設定でデスクトップアプリを許可してください。》",
};

/// The cloud speech model's credentials are missing.
pub const CLOUD_STT_MISSING: Notice = Notice {
    zh: "《否。雲端語音辨識尚未連接。請到「設定 › 模型與用量 › 用量」設定 OpenRouter 金鑰，或到「設定 › 聽寫」下載本機模型。》",
    en: "《Negative. Cloud recognition is not connected. Set the OpenRouter key in Settings > Models & usage > Usage, or download a local model in Settings > Dictation.》",
    ja: "《否。クラウド認識は未接続です。「設定 › モデルと使用量 › 使用量」で OpenRouter キーを設定するか、「設定 › ディクテーション」でモデルをダウンロードしてください。》",
};

/// The selected local speech model has not been downloaded.
pub const LOCAL_MODEL_MISSING: Notice = Notice {
    zh: "《否。尚未下載本機語音模型。請到「設定 › 聽寫」下載後再錄音。》",
    en: "《Negative. The local speech model is not downloaded. Download it in Settings > Dictation before recording.》",
    ja: "《否。ローカル音声モデルがありません。「設定 › ディクテーション」でダウンロードしてから録音してください。》",
};

/// The core cannot dictate yet: the speech model is not ready (`NOT_CONFIGURED`).
pub const NOT_READY: Notice = Notice {
    zh: "《否。語音辨識尚未就緒。請到「設定 › 聽寫」下載本機模型；使用雲端辨識時，請在「設定 › 模型與用量」確認連線。》",
    en: "《Negative. Speech recognition is not ready. Download a local model in Settings > Dictation; for cloud recognition check the connection in Settings > Models & usage.》",
    ja: "《否。音声認識の準備ができていません。「設定 › ディクテーション」でモデルをダウンロードし、クラウド認識の場合は「設定 › モデルと使用量」で接続を確認してください。》",
};

/// The cloud could not transcribe the speech and no local model is left to take over
/// (`NO_LOCAL_MODEL`).
pub const NO_LOCAL_MODEL: Notice = Notice {
    zh: "《否。雲端辨識失敗，且沒有本機模型。請到「設定 › 聽寫」下載後再試。》",
    en: "《Negative. Cloud transcription failed and there is no local model. Download one in Settings > Dictation, then try again.》",
    ja: "《否。クラウド認識に失敗し、ローカルモデルもありません。「設定 › ディクテーション」でダウンロードして再試行してください。》",
};

/// Some segments still failed after the final retry; the pasted text marks each gap.
pub const INCOMPLETE: Notice = Notice {
    zh: "《否。部分語音無法辨識，文字已標示缺漏。》",
    en: "《Negative. Some speech could not be transcribed. Gaps are marked in the text.》",
    ja: "《否。一部の音声を認識できませんでした。欠落箇所を表示しました。》",
};

/// The core is not running, so nothing can be dictated.
pub const CORE_DOWN: Notice = Notice {
    zh: "《否。核心未在運作。請重新啟動拉斐爾。》",
    en: "《Negative. The core is not running. Restart Raphael.》",
    ja: "《否。コアが動作していません。ラファエルを再起動してください。》",
};

/// The supervisor recovered the core; the interrupted work must be requested again.
pub const CORE_RECOVERED: Notice = Notice {
    zh: "《告。服務剛才意外中斷，已重新啟動。請重新提出剛才的請求。》",
    en: "《Notice. The service stopped unexpectedly and has restarted. Please repeat your last request.》",
    ja: "《告。サービスが予期せず停止しましたが、再起動しました。直前のリクエストをもう一度送ってください。》",
};

/// The agent could not answer a question (it did not reply in time, or its reply cannot be shown).
/// The core's own refusals (no key, over budget, offline) arrive as answers and are shown as such.
pub const ASK_FAILED: Notice = Notice {
    zh: "《否。目前無法回答。》",
    en: "《Negative. No answer can be given at this time.》",
    ja: "《否。現在は回答できません。》",
};

/// Raphael wrote down what he was told to remember, in the same turn as his answer, which said
/// something else (`"notice": "remembered"` in the reply of `agent.ask`). It follows the answer.
pub const REMEMBERED: Notice = Notice {
    zh: "《了。已記下。》",
    en: "《Understood. Noted.》",
    ja: "《了。記憶しました。》",
};

/// A question to Raphael has begun: his greeting beside the emblem while he listens. A dictation
/// shows the emblem alone, so the two are never mistaken for each other. He stands by for an
/// order, as a report rather than a question (問 is for what takes a yes or a no), and it is the
/// one notice that addresses the person.
pub const GREETING: Notice = Notice {
    zh: "《告。主人，請下達指示。》",
    en: "《Notice. Standing by, Master.》",
    ja: "《告。マスター、ご指示をどうぞ。》",
};

/// Words learned from the user's corrections after a paste, in one notice, in `language`:
/// 《了。「手機」、「Typeless」已加入詞典。》, `《Understood. “Typeless” added to the dictionary.》`
/// or 《了。「手機」を辞書に追加しました。》.
pub fn learned(words: &[String], language: &str) -> String {
    let quoted = |open: &str, close: &str, separator: &str| {
        words
            .iter()
            .map(|word| format!("{open}{word}{close}"))
            .collect::<Vec<_>>()
            .join(separator)
    };
    if let Some(template) = notice_words::learned(language) {
        let (open, close) = match language {
            "de" => ("„", "“"),
            "fr" => ("« ", " »"),
            "es" | "it" | "ru" => ("«", "»"),
            "ko" => ("‘", "’"),
            _ => ("“", "”"),
        };
        return template.replace("{words}", &quoted(open, close, ", "));
    }
    match language {
        "en" => format!(
            "《Understood. {} added to the dictionary.》",
            quoted("\u{201c}", "\u{201d}", ", ")
        ),
        "ja" => format!("《了。{}を辞書に追加しました。》", quoted("「", "」", "、")),
        "zh-TW" => format!("《了。{}已加入詞典。》", quoted("「", "」", "、")),
        _ => learned(words, "en"),
    }
}

/// The notice for the `fallback_reason` of a `dictation.stop` result, if it gets one. Nothing was
/// said (`"empty"`) needs none, and incomplete speech has a notice of its own.
pub fn notice_for_fallback(reason: Option<&str>) -> Option<Notice> {
    match reason? {
        "budget" => Some(BUDGET),
        "no_key" => Some(NO_KEY),
        "error:network" | "error:timeout" | "error:server" => Some(OFFLINE),
        "empty" | "incomplete_stt" => None,
        _ => Some(NOT_CLEANED),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [Notice; 15] = [
        NOT_CLEANED,
        CORE_RECOVERED,
        ELEVATED,
        FOCUS_CHANGED,
        BUDGET,
        OFFLINE,
        NO_KEY,
        NO_MIC,
        NO_SOUND,
        NOT_READY,
        NO_LOCAL_MODEL,
        INCOMPLETE,
        CORE_DOWN,
        ASK_FAILED,
        GREETING,
    ];

    #[test]
    fn fallback_reasons_map_to_notices() {
        assert_eq!(notice_for_fallback(Some("budget")).unwrap().zh, BUDGET.zh);
        assert_eq!(notice_for_fallback(Some("suspicious")), Some(NOT_CLEANED));
        assert_eq!(notice_for_fallback(Some("timeout")), Some(NOT_CLEANED));
        assert!(notice_for_fallback(Some("empty")).is_none());
        assert!(notice_for_fallback(None).is_none());
    }

    #[test]
    fn every_fallback_reason_has_its_notice() {
        assert_eq!(notice_for_fallback(Some("no_key")), Some(NO_KEY));
        for reason in ["error:network", "error:timeout", "error:server"] {
            assert_eq!(notice_for_fallback(Some(reason)), Some(OFFLINE), "{reason}");
        }
        for reason in ["timeout", "error:other", ""] {
            assert_eq!(
                notice_for_fallback(Some(reason)),
                Some(NOT_CLEANED),
                "{reason}"
            );
        }
    }

    #[test]
    fn the_learned_notice_names_every_word_once_in_each_language() {
        let one = ["手機".to_owned()];
        assert_eq!(learned(&one, "zh-TW"), "《了。「手機」已加入詞典。》");
        assert_eq!(
            learned(&one, "ja"),
            "《了。「手機」を辞書に追加しました。》"
        );
        assert_eq!(
            learned(&one, "en"),
            "《Understood. \u{201c}手機\u{201d} added to the dictionary.》"
        );
        let two = ["手機".to_owned(), "Typeless".to_owned()];
        assert_eq!(
            learned(&two, "zh-TW"),
            "《了。「手機」、「Typeless」已加入詞典。》"
        );
        assert_eq!(
            learned(&two, "ja"),
            "《了。「手機」、「Typeless」を辞書に追加しました。》"
        );
        assert_eq!(
            learned(&two, "en"),
            "《Understood. \u{201c}手機\u{201d}, \u{201c}Typeless\u{201d} added to the dictionary.》"
        );
    }

    #[test]
    fn the_learned_notice_in_an_unknown_language_is_english() {
        let words = ["手機".to_owned()];
        for language in ["", "unknown", "EN"] {
            assert_eq!(learned(&words, language), learned(&words, "en"));
        }
    }

    #[test]
    fn a_notice_is_sent_in_one_language_only() {
        for notice in ALL {
            assert_eq!(notice.text("zh-TW"), notice.zh);
            assert_eq!(notice.text("en"), notice.en);
            assert_eq!(notice.text("ja"), notice.ja);
            // A language nobody chose uses English, never a pair.
            for other in ["", "unknown", "EN", "zh"] {
                assert_eq!(notice.text(other), notice.en, "{other:?}");
            }
        }
    }

    #[test]
    fn every_new_locale_has_translated_native_notices_and_learned_words() {
        for language in [
            "zh-CN", "ko", "es", "fr", "de", "pt-BR", "it", "ru", "vi", "th", "id", "tr",
        ] {
            for notice in ALL
                .iter()
                .chain([&CLOUD_STT_MISSING, &LOCAL_MODEL_MISSING, &REMEMBERED])
            {
                let text = notice.text(language);
                assert_ne!(text, notice.en, "{language}: {}", notice.en);
                assert!(
                    text.starts_with('《') && text.ends_with('》'),
                    "{language}: {text}"
                );
                assert!(!text.contains(['!', '！', '?', '？']), "{language}: {text}");
            }
            let words = ["Test".to_owned(), "Example".to_owned()];
            let text = learned(&words, language);
            assert!(
                text.contains("Test") && text.contains("Example"),
                "{language}: {text}"
            );
            assert_ne!(text, learned(&words, "en"), "{language}");
        }
    }

    fn has_kana(text: &str) -> bool {
        text.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c))
    }

    /// The room beside the largest emblem that one line of the caption may take at 14 px, in px.
    /// The window is 540 px wide and leaves about 300 beside an emblem of 194; this keeps a margin
    /// for the estimate below. overlay-style.test.ts checks that overlay.css leaves at least this.
    const CAPTION_ROOM_PX: usize = 280;

    /// About how wide `line` is at 14 px: a Chinese or Japanese character (the brackets and the
    /// ellipsis among them) fills a square, the rest is about half as wide.
    fn width_at_14px(line: &str) -> usize {
        line.chars()
            .map(|c| if c.is_ascii() { 8 } else { 14 })
            .sum()
    }

    /// How Raphael addresses the person: 主人 in Chinese, マスター in Japanese, Master in English.
    const ADDRESS: [&str; 3] = ["主人", "マスター", "Master"];

    #[test]
    fn notices_are_raphael_lines() {
        for notice in ALL {
            for line in [notice.zh, notice.ja] {
                assert!(
                    line.starts_with("《告。") || line.starts_with("《否。"),
                    "{line}"
                );
                assert!(line.ends_with('》'), "{line}");
            }
            assert!(
                notice.en.starts_with("《Notice. ") || notice.en.starts_with("《Negative. "),
                "{}",
                notice.en
            );
            assert!(notice.en.ends_with('》'), "{}", notice.en);
            // The same kind of report in every language: 告 is Notice, 否 is Negative.
            let report = notice.zh.starts_with("《告。");
            assert_eq!(notice.ja.starts_with("《告。"), report, "{}", notice.ja);
            assert_eq!(notice.en.starts_with("《Notice. "), report, "{}", notice.en);
        }
    }

    #[test]
    fn each_language_stays_in_its_own_script() {
        for notice in ALL {
            assert!(!has_kana(notice.zh), "{}", notice.zh);
            assert!(has_kana(notice.ja), "{}", notice.ja);
            // English has the 《》 of the style and nothing else outside ASCII.
            assert!(
                notice
                    .en
                    .chars()
                    .all(|c| c.is_ascii() || c == '《' || c == '》'),
                "{}",
                notice.en
            );
        }
    }

    #[test]
    fn raphael_never_exclaims_and_never_asks_in_a_notice() {
        // A report or a refusal states; only 問 asks, and none of these is one.
        for notice in ALL {
            for line in [notice.zh, notice.en, notice.ja] {
                assert!(!line.contains(['!', '！', '?', '？']), "{line}");
            }
        }
    }

    #[test]
    fn only_the_greeting_addresses_the_person_and_in_the_word_of_its_language() {
        // 主人 in Chinese, マスター in Japanese, Master in English: sparingly, as he does.
        for (line, address) in [
            (GREETING.zh, "主人"),
            (GREETING.ja, "マスター"),
            (GREETING.en, "Master"),
        ] {
            assert!(line.contains(address), "{line}");
            for other in ADDRESS.iter().filter(|other| **other != address) {
                assert!(!line.contains(other), "{line}");
            }
        }
        for notice in ALL.iter().filter(|notice| **notice != GREETING) {
            for line in [notice.zh, notice.en, notice.ja] {
                assert!(!ADDRESS.iter().any(|word| line.contains(word)), "{line}");
            }
        }
    }

    #[test]
    fn the_greeting_is_one_line_beside_the_largest_emblem() {
        for line in [GREETING.zh, GREETING.en, GREETING.ja] {
            let width = width_at_14px(line);
            assert!(width <= CAPTION_ROOM_PX, "{line}: about {width} px");
        }
    }

    #[test]
    fn the_memory_notice_is_an_acknowledgement_in_each_language_on_one_line() {
        assert_eq!(REMEMBERED.text("zh-TW"), "《了。已記下。》");
        assert_eq!(REMEMBERED.text("en"), "《Understood. Noted.》");
        assert_eq!(REMEMBERED.text("ja"), "《了。記憶しました。》");
        assert_eq!(REMEMBERED.text("fr"), "《Compris. Noté.》");
        assert_eq!(REMEMBERED.text("unknown"), REMEMBERED.en);
        assert!(!has_kana(REMEMBERED.zh) && has_kana(REMEMBERED.ja));
        for line in [REMEMBERED.zh, REMEMBERED.en, REMEMBERED.ja] {
            assert!(
                line.ends_with('》') && !line.contains(['!', '！', '?', '？']),
                "{line}"
            );
            assert!(width_at_14px(line) <= CAPTION_ROOM_PX, "{line}");
            assert!(!ADDRESS.iter().any(|word| line.contains(word)), "{line}");
        }
    }

    #[test]
    fn the_language_cell_starts_in_chinese_like_the_settings() {
        assert_eq!(LanguageCell::default().get(), "zh-TW");
        assert_eq!(
            LanguageCell::default().get(),
            crate::device_settings::DeviceSettings::default().ui_language
        );
    }

    #[test]
    fn the_language_cell_is_shared_between_clones() {
        let cell = LanguageCell::default();
        let other = cell.clone();
        other.set("ja");
        assert_eq!(cell.get(), "ja");
        cell.set("en");
        assert_eq!(other.get(), "en");
    }
}
