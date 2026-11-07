//! What the user corrected in a pasted dictation, with pure rules over character origins.
//!
//! [`Tracker`] anchors the pasted dictation inside the field and follows scalar-character origins
//! across snapshots, including selection, deletion and later retyping. Only the dictated span
//! reaches the shared pure term rule; neighboring typing never becomes dictionary evidence.
//!
//! [`Tracker::corrections`] applies the shared pure term rule to the final dictated span.

use std::ops::Range;

pub(crate) use super::terms::term_corrections;

/// The user replaced `misheard` with `word` in the pasted text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Correction {
    pub word: String,
    pub misheard: String,
}

/// The most corrections taken from one dictation.
pub const MAX_CORRECTIONS: usize = 2;
/// Below this share of the pasted text still in the field, the field was cleared (the message
/// was sent) or replaced.
pub const MIN_KEPT_SHARE: f64 = 0.5;

/// A field's text as the tracker compares it: line breaks as `\n` (edit controls report `\r\n`,
/// Word reports `\r`).
fn chars_of(text: &str) -> Vec<char> {
    let mut out = Vec::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

/// Where `needle` is in `hay`, the last occurrence (a dictation is mostly pasted at the end).
fn rfind(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    (0..=hay.len() - needle.len())
        .rev()
        .find(|&at| hay[at..at + needle.len()] == *needle)
}

/// Where `needle` is in `hay` when whitespace is left out of both (rich text editors turn line
/// breaks into paragraphs, and some report them as nothing at all): the span from the first to
/// the last character matched.
fn rfind_ignoring_whitespace(hay: &[char], needle: &[char]) -> Option<Range<usize>> {
    let (squeezed, at): (Vec<char>, Vec<usize>) = hay
        .iter()
        .enumerate()
        .filter(|(_, c)| !c.is_whitespace())
        .map(|(i, &c)| (c, i))
        .unzip();
    let needle: Vec<char> = needle
        .iter()
        .copied()
        .filter(|c| !c.is_whitespace())
        .collect();
    let start = rfind(&squeezed, &needle)?;
    Some(at[start]..at[start + needle.len() - 1] + 1)
}

/// Follows a text field from right after the paste to the user's last edit.
#[derive(Clone, Debug)]
pub struct Tracker {
    /// The field's text right after the paste.
    before: Vec<char>,
    /// Where the pasted text is in `before`.
    span: Range<usize>,
    /// The field's text now.
    current: Vec<char>,
    /// For each character of `current`: the index in `before` of the character it still is, or
    /// `None` if it was typed since. The indexes only go up.
    origin: Vec<Option<usize>>,
}

/// One edit between `before` and `current`: `old` (indexes into `before`) became `new` (indexes
/// into `current`).
#[derive(Clone, Debug, PartialEq, Eq)]
struct Edit {
    old: Range<usize>,
    new: Range<usize>,
}

impl Tracker {
    /// Starts from the field's text right after the paste. `None` if the pasted text (without its
    /// leading and trailing whitespace) is not in it.
    pub fn new(field: &str, pasted: &str) -> Option<Self> {
        let before = chars_of(field);
        let pasted = chars_of(pasted.trim());
        let span = match rfind(&before, &pasted) {
            Some(at) => at..at + pasted.len(),
            None => rfind_ignoring_whitespace(&before, &pasted)?,
        };
        Some(Self {
            origin: (0..before.len()).map(Some).collect(),
            current: before.clone(),
            before,
            span,
        })
    }

    /// Starts from the field's text when the caller already knows where the pasted text is, as
    /// `span` in characters of `field` (line breaks counted as `\n`). `None` if the span is empty
    /// or reaches past the text. [`Tracker::new`] would take the last occurrence, which is not
    /// always the one that was found.
    pub(super) fn with_span(field: &str, span: Range<usize>) -> Option<Self> {
        let before = chars_of(field);
        if span.start >= span.end || span.end > before.len() {
            return None;
        }
        Some(Self {
            origin: (0..before.len()).map(Some).collect(),
            current: before.clone(),
            before,
            span,
        })
    }

    /// The tracker after the field changed to `text`.
    pub fn advanced(&self, text: &str) -> Self {
        let next = chars_of(text);
        let prefix = self
            .current
            .iter()
            .zip(&next)
            .take_while(|(a, b)| a == b)
            .count();
        let room = self.current.len().min(next.len()) - prefix;
        let suffix = self
            .current
            .iter()
            .rev()
            .zip(next.iter().rev())
            .take(room)
            .take_while(|(a, b)| a == b)
            .count();
        let mut origin = Vec::with_capacity(next.len());
        origin.extend_from_slice(&self.origin[..prefix]);
        origin.resize(next.len() - suffix, None);
        origin.extend_from_slice(&self.origin[self.current.len() - suffix..]);
        Self {
            before: self.before.clone(),
            span: self.span.clone(),
            current: next,
            origin,
        }
    }

    /// The share of the pasted text that is still in the field, unchanged.
    pub fn kept(&self) -> f64 {
        let kept = self
            .origin
            .iter()
            .flatten()
            .filter(|&&i| self.span.contains(&i))
            .count();
        kept as f64 / self.span.len().max(1) as f64
    }

    /// Whether anything inside the pasted text was changed since the paste: not what stands
    /// before or after it, and not the typing of more text after its last character.
    pub(super) fn edited(&self) -> bool {
        !self.edits_in_span().is_empty()
    }

    /// Every stretch where `before` and `current` differ, in order.
    fn edits(&self) -> Vec<Edit> {
        let mut edits = Vec::new();
        // Just past the last character that is still the original one, in both texts.
        let (mut old_at, mut new_at) = (0, 0);
        for (pos, origin) in self.origin.iter().enumerate() {
            let Some(i) = *origin else { continue };
            if i > old_at || pos > new_at {
                edits.push(Edit {
                    old: old_at..i,
                    new: new_at..pos,
                });
            }
            (old_at, new_at) = (i + 1, pos + 1);
        }
        if self.before.len() > old_at || self.current.len() > new_at {
            edits.push(Edit {
                old: old_at..self.before.len(),
                new: new_at..self.current.len(),
            });
        }
        edits
    }

    /// The edits inside the pasted text: those whose original part lies in it (an insertion
    /// counts when it is strictly inside). Any other edit (typing after the dictation, before it,
    /// or across its ends) is not about the dictation.
    fn edits_in_span(&self) -> Vec<Edit> {
        self.edits()
            .into_iter()
            .filter(|edit| {
                if edit.old.is_empty() {
                    self.span.start < edit.old.start && edit.old.start < self.span.end
                } else {
                    self.span.start <= edit.old.start && edit.old.end <= self.span.end
                }
            })
            .collect()
    }

    /// Apply the same pure term rule to the dictated span in every capture surface.
    pub fn corrections(&self) -> Vec<Correction> {
        let edits = self.edits();
        // A replacement across either pasted edge cannot be attributed to dictation alone.
        if edits.iter().any(|edit| {
            edit.old.start < self.span.end
                && edit.old.end > self.span.start
                && (edit.old.start < self.span.start || edit.old.end > self.span.end)
        }) {
            return Vec::new();
        }
        let mut positions: Vec<usize> = self
            .origin
            .iter()
            .enumerate()
            .filter_map(|(at, origin)| origin.filter(|i| self.span.contains(i)).map(|_| at))
            .collect();
        let mut end = positions.last().map_or(0, |at| at + 1);
        for edit in self.edits_in_span() {
            positions.push(edit.new.start);
            end = end.max(edit.new.end);
        }
        let Some(start) = positions.into_iter().min() else {
            return Vec::new();
        };
        let before: String = self.before[self.span.clone()].iter().collect();
        let after: String = self.current[start..end.max(start)].iter().collect();
        term_corrections(&before, &after)
    }
}

/// Kanji, kana and hangul: scripts written without spaces between words.
pub fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{3040}'..='\u{30FF}'   // hiragana, katakana
        | '\u{3400}'..='\u{4DBF}' // CJK extension A
        | '\u{4E00}'..='\u{9FFF}' // CJK unified ideographs
        | '\u{AC00}'..='\u{D7AF}' // hangul syllables
        | '\u{F900}'..='\u{FAFF}' // CJK compatibility ideographs
        | '\u{20000}'..='\u{2FFFF}')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The corrections from the field right after the paste, through each later snapshot.
    fn learned(pasted: &str, snapshots: &[&str]) -> Vec<(String, String)> {
        let mut tracker = Tracker::new(snapshots[0], pasted).expect("the pasted text is found");
        for text in &snapshots[1..] {
            tracker = tracker.advanced(text);
        }
        tracker
            .corrections()
            .into_iter()
            .map(|c| (c.misheard, c.word))
            .collect()
    }

    /// The corrections when `pasted` is edited with each `(from, to)` in turn, one snapshot each.
    fn learned_after(pasted: &str, replacements: &[(&str, &str)]) -> Vec<(String, String)> {
        let mut snapshots = vec![pasted.to_owned()];
        for (from, to) in replacements {
            let last = snapshots.last().unwrap();
            assert!(last.contains(from), "{from} is in {last}");
            snapshots.push(last.replacen(from, to, 1));
        }
        let snapshots: Vec<&str> = snapshots.iter().map(String::as_str).collect();
        learned(pasted, &snapshots)
    }

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter()
            .map(|(misheard, word)| ((*misheard).to_owned(), (*word).to_owned()))
            .collect()
    }

    const NONE: Vec<(String, String)> = Vec::new();

    const PASTED: &str = "我昨天買了一支新的首機，拍照很漂亮，電池也很耐用，整體來說我很滿意";

    // ---------- finding the pasted text ----------

    #[test]
    fn the_pasted_text_is_found_after_what_was_there() {
        let tracker = Tracker::new(&format!("哈囉\r\n{PASTED}"), PASTED).unwrap();
        assert_eq!(tracker.span, 3..3 + PASTED.chars().count());
    }

    #[test]
    fn line_breaks_match_whatever_the_field_uses() {
        let pasted = "第一行\r\n第二行";
        assert!(Tracker::new("第一行\n第二行", pasted).is_some());
        assert!(Tracker::new("第一行\r第二行", pasted).is_some());
    }

    #[test]
    fn whitespace_the_editor_dropped_does_not_hide_the_pasted_text() {
        let tracker = Tracker::new("前面 第一行第二行", "第一行\n第二行").unwrap();
        assert_eq!(tracker.span, 3..9);
    }

    #[test]
    fn the_last_occurrence_is_taken() {
        let tracker = Tracker::new("好的。好的。", "好的。").unwrap();
        assert_eq!(tracker.span, 3..6);
    }

    #[test]
    fn a_known_span_is_followed_even_when_the_text_occurs_again_after_it() {
        let field = "Tyeless is here and Tyeless again";
        // `new` takes the last occurrence; the caller knows it is the first.
        assert_eq!(Tracker::new(field, "Tyeless").unwrap().span, 20..27);
        let tracker = Tracker::with_span(field, 0..7).unwrap();
        let tracker = tracker.advanced("Typeless is here and Tyeless again");
        let learned: Vec<_> = tracker
            .corrections()
            .into_iter()
            .map(|c| (c.misheard, c.word))
            .collect();
        assert_eq!(learned, [("Tyeless".to_owned(), "Typeless".to_owned())]);
    }

    #[test]
    fn only_a_change_inside_the_pasted_text_counts_as_an_edit() {
        let pasted = "Use Tyeless for this";
        let field = format!("PS> {pasted} and more");
        let tracker = Tracker::new(&field, pasted).unwrap();
        assert!(!tracker.edited());
        // The prompt, and the text after the paste, are not the paste.
        assert!(
            !tracker
                .advanced("PS2> Use Tyeless for this and more")
                .edited()
        );
        assert!(
            !tracker
                .advanced("PS> Use Tyeless for this and more more")
                .edited()
        );
        // A letter typed inside it, a word deleted from it, and a replaced word are.
        assert!(
            tracker
                .advanced("PS> Use Typeless for this and more")
                .edited()
        );
        assert!(tracker.advanced("PS> Use Tyeless this and more").edited());
        assert!(
            tracker
                .advanced("PS> Use Tyeless for that and more")
                .edited()
        );
    }

    #[test]
    #[allow(
        clippy::reversed_empty_ranges,
        reason = "a reversed span is one of the cases"
    )]
    fn a_span_that_is_empty_or_outside_the_text_starts_nothing() {
        assert!(Tracker::with_span("abc", 1..1).is_none());
        assert!(Tracker::with_span("abc", 2..1).is_none());
        assert!(Tracker::with_span("abc", 0..4).is_none());
        assert!(Tracker::with_span("abc", 0..3).is_some());
        assert!(Tracker::with_span("", 0..0).is_none());
    }

    #[test]
    fn a_field_without_the_pasted_text_is_not_tracked() {
        assert!(Tracker::new("別的東西", PASTED).is_none());
        assert!(Tracker::new("", PASTED).is_none());
        assert!(Tracker::new("什麼", "   ").is_none());
    }

    // ---------- CJK ----------

    #[test]
    fn a_common_word_is_not_learned_even_when_selected_and_retyped() {
        // select 首機 and delete it, type 手機 (the IME's composition shows in between)
        assert_eq!(
            learned_after(
                PASTED,
                &[("首機", ""), ("新的，", "新的shou，"), ("shou", "手機")]
            ),
            NONE
        );
    }

    #[test]
    fn a_word_selected_and_retyped_the_same_is_no_correction() {
        // speech-to-text had it right: deleting 電池 and typing 電池 again teaches nothing
        assert_eq!(
            learned_after(PASTED, &[("電池", ""), ("漂亮，也", "漂亮，電池也")]),
            NONE
        );
        assert_eq!(
            learned_after(
                "Please ask Alice about the release plan today.",
                &[("ask Alice", "ask "), ("ask ", "ask Alice")]
            ),
            NONE
        );
    }

    #[test]
    fn a_word_typed_over_in_one_go() {
        // straight from the wrong word to the right one: only 首 differs, too short for a term
        assert_eq!(learned_after(PASTED, &[("首機", "手機")]), NONE);
        assert_eq!(
            learned_after(PASTED, &[("首機", "手提電話")]),
            pairs(&[("首機", "手提電話")])
        );
    }

    #[test]
    fn no_edit_learns_nothing() {
        assert_eq!(learned(PASTED, &[PASTED, PASTED]), NONE);
    }

    #[test]
    fn a_deletion_alone_is_no_correction() {
        assert_eq!(learned_after(PASTED, &[("新的首機", "新的")]), NONE);
    }

    #[test]
    fn an_insertion_alone_is_no_correction() {
        assert_eq!(learned_after(PASTED, &[("拍照很", "拍照真的很")]), NONE);
    }

    #[test]
    fn a_long_cjk_run_is_no_term() {
        assert_eq!(
            learned_after(
                PASTED,
                &[("電池也很耐用", "電池也是非常非常非常非常非常非常的耐用")]
            ),
            NONE
        );
    }

    #[test]
    fn punctuation_decorated_cjk_text_is_not_a_term() {
        assert_eq!(learned_after(PASTED, &[("首機", "「手提電話」")]), NONE);
    }

    #[test]
    fn digits_or_punctuation_alone_are_not_learned() {
        let pasted = "會議改到下午三點，大家準時到場喔，記得帶筆電和充電器過來";
        assert_eq!(learned_after(pasted, &[("三點", "15:00")]), NONE);
        assert_eq!(learned_after(pasted, &[("三點，", "三點！！")]), NONE);
    }

    // ---------- Latin ----------

    const EN: &str = "I tried type less yesterday and it works really well for long emails";

    #[test]
    fn latin_words_replaced_by_a_term_are_learned() {
        assert_eq!(
            learned_after(EN, &[("type less", "Typeless")]),
            pairs(&[("type less", "Typeless")])
        );
    }

    #[test]
    fn a_word_fixed_from_inside_is_learned_whole() {
        let pasted = "We moved the servers to tailscail last week and it just works";
        assert_eq!(
            learned_after(pasted, &[("tailscail", "Tailscale")]),
            pairs(&[("tailscail", "Tailscale")])
        );
        // one letter typed into the word
        let pasted = "I tried Tyeless yesterday and it works really well for long emails";
        assert_eq!(
            learned_after(pasted, &[("Tyeless", "Typeless")]),
            pairs(&[("Tyeless", "Typeless")])
        );
    }

    #[test]
    fn capitalized_terms_are_candidates_for_the_dictionary() {
        assert_eq!(
            learned_after(EN, &[("type less", "Type Less")]),
            pairs(&[("type less", "Type Less")])
        );
    }

    #[test]
    fn short_words_are_not_terms() {
        assert_eq!(learned_after(EN, &[("it works", "it is")]), NONE);
    }

    #[test]
    fn more_than_three_words_are_no_term() {
        let pasted = "Please send the report to the whole team before the meeting on Friday morning ok thanks";
        assert_eq!(
            learned_after(pasted, &[("the whole team", "every single person here")]),
            NONE
        );
    }

    // ---------- mixed ----------

    #[test]
    fn a_cross_script_replacement_must_have_comparable_lengths() {
        let pasted = "我們用泰斯克連回家裡的電腦，速度還不錯，設定也很簡單";
        assert_eq!(learned_after(pasted, &[("泰斯克", "Tailscale")]), NONE);
    }

    #[test]
    fn latin_words_joined_in_chinese_text_are_learned_whole() {
        let pasted = "我今天試了 Open Router 的新模型，感覺回答比較快一點點";
        assert_eq!(
            learned_after(pasted, &[("Open Router", "OpenRouter")]),
            pairs(&[("Open Router", "OpenRouter")])
        );
    }

    #[test]
    fn katakana_counts_as_cjk() {
        let pasted = "明日はラファエロ先生に会いに行きますので、よろしくお願いします";
        assert_eq!(
            learned_after(
                pasted,
                &[("ラファエロ", ""), ("は先生", "はラファエル先生")]
            ),
            pairs(&[("ラファエロ", "ラファエル")])
        );
    }

    // ---------- the whole dictation ----------

    #[test]
    fn a_rewrite_of_most_of_the_text_learns_nothing() {
        let pasted = "明天下午三點開會，記得帶筆電";
        assert_eq!(learned_after(pasted, &[("明天下午三", "後天早上十")]), NONE);
    }

    #[test]
    fn edits_outside_the_pasted_text_do_not_count() {
        let before = format!("舊的首機。{PASTED}");
        let fixed = format!("舊的手提電話。{PASTED}");
        let added = format!("{fixed}你覺得呢");
        assert_eq!(learned(PASTED, &[&before, &fixed, &added]), NONE);
    }

    #[test]
    fn more_than_two_changed_spans_reject_the_whole_dictation() {
        let pasted = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天干地支，這是一段很長的文字用來測試最多兩個修正的規則是不是有效";
        assert_eq!(
            learned_after(
                pasted,
                &[
                    ("甲乙", "一二"),
                    ("戊己", "三四"),
                    ("子丑", "五六"),
                    ("辰巳", "七八")
                ]
            ),
            NONE
        );
    }

    #[test]
    fn two_corrections_in_one_dictation() {
        let pasted =
            "我用泰斯刻爾連回家，再用歐噴肉特叫模型，整體來說還算順利，大概花了十分鐘左右就弄好了";
        assert_eq!(
            learned_after(
                pasted,
                &[("泰斯刻爾", "Tailscale"), ("歐噴肉特", "OpenRouter")]
            ),
            pairs(&[("泰斯刻爾", "Tailscale"), ("歐噴肉特", "OpenRouter")])
        );
    }

    #[test]
    fn a_change_across_a_line_break_is_not_learned() {
        let pasted = "第一點是首機\n第二點是電腦，還有其他的東西要說明一下";
        assert_eq!(learned_after(pasted, &[("首機\n第二點是", "手機")]), NONE);
    }

    // ---------- the field emptied ----------

    #[test]
    fn kept_drops_when_the_field_is_cleared() {
        let tracker = Tracker::new(PASTED, PASTED).unwrap();
        assert_eq!(tracker.kept(), 1.0);
        assert_eq!(tracker.advanced("").kept(), 0.0);
        let fixed = PASTED.replacen("首機", "手機", 1);
        assert!(tracker.advanced(&fixed).kept() > MIN_KEPT_SHARE);
    }
}
