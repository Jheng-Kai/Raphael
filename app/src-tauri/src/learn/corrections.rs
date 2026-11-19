//! What the user changed in a pasted dictation.
//!
//! [`Tracker`] anchors the pasted dictation inside the field and follows scalar-character origins
//! across snapshots, including selection, deletion and later retyping. Only the dictated span is
//! reported: neighboring typing never becomes dictionary evidence.
//!
//! [`Tracker::revision`] gives the dictated span as it was pasted and as it is now. Which of its
//! changes teach the dictionary is judged by the core (`dictionary.learn`), with the model, in
//! whatever language was spoken: no rule of spelling or script decides it here.

use std::ops::Range;

/// The dictated span of a field as it was pasted (`pasted`) and as the user left it (`sent`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Revision {
    pub pasted: String,
    pub sent: String,
}

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
    #[cfg_attr(not(windows), allow(dead_code))]
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
    #[cfg_attr(not(windows), allow(dead_code))]
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

    /// The dictated span as pasted and as it is now; `None` when it is unchanged, or when an
    /// edit reaches across either of its edges (that edit cannot be told apart from typing
    /// around the dictation).
    pub fn revision(&self) -> Option<Revision> {
        let edits = self.edits();
        if edits.iter().any(|edit| {
            edit.old.start < self.span.end
                && edit.old.end > self.span.start
                && (edit.old.start < self.span.start || edit.old.end > self.span.end)
        }) {
            return None;
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
        let start = positions.into_iter().min()?;
        let pasted: String = self.before[self.span.clone()].iter().collect();
        let sent: String = self.current[start..end.max(start)].iter().collect();
        (pasted != sent).then_some(Revision { pasted, sent })
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

/// For tests of where a revision comes from: the stretches that differ between its two texts, as
/// `(pasted, sent)`, with Latin words whole and every other character on its own, whitespace
/// left out of the comparison. Only stretches that replace something with something count.
#[cfg(test)]
pub(crate) fn changed_words(revision: &Revision) -> Vec<(String, String)> {
    fn tokens(text: &str) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        let mut start = None;
        for (at, c) in text.char_indices() {
            let latin = c.is_alphanumeric() && !is_cjk(c);
            if latin {
                start.get_or_insert(at);
                continue;
            }
            if let Some(from) = start.take() {
                out.push((from, at));
            }
            if !c.is_whitespace() {
                out.push((at, at + c.len_utf8()));
            }
        }
        if let Some(from) = start {
            out.push((from, text.len()));
        }
        out
    }
    let (old_text, new_text) = (&revision.pasted, &revision.sent);
    let (old, new) = (tokens(old_text), tokens(new_text));
    let word = |text: &str, (a, b): (usize, usize)| text[a..b].to_owned();
    let (old_words, new_words): (Vec<String>, Vec<String>) = (
        old.iter().map(|t| word(old_text, *t)).collect(),
        new.iter().map(|t| word(new_text, *t)).collect(),
    );
    let mut lcs = vec![vec![0usize; new.len() + 1]; old.len() + 1];
    for i in (0..old.len()).rev() {
        for j in (0..new.len()).rev() {
            lcs[i][j] = if old_words[i] == new_words[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut runs = Vec::new();
    type Span = Option<(usize, usize)>;
    let (mut from, mut to): (Span, Span) = (None, None);
    let widen = |span: &mut Span, (a, b): (usize, usize)| {
        *span = Some(span.map_or((a, b), |(start, _)| (start, b)));
    };
    loop {
        let same = i < old.len() && j < new.len() && old_words[i] == new_words[j];
        if same || (i == old.len() && j == new.len()) {
            if let (Some((a, b)), Some((c, d))) = (from.take(), to.take()) {
                runs.push((old_text[a..b].to_owned(), new_text[c..d].to_owned()));
            }
            if !same {
                break;
            }
            i += 1;
            j += 1;
        } else if j < new.len() && (i == old.len() || lcs[i][j + 1] >= lcs[i + 1][j]) {
            widen(&mut to, new[j]);
            j += 1;
        } else {
            widen(&mut from, old[i]);
            i += 1;
        }
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The revision from the field right after the paste, through each later snapshot, as
    /// `(pasted, sent)`.
    fn learned(pasted: &str, snapshots: &[&str]) -> Option<(String, String)> {
        let mut tracker = Tracker::new(snapshots[0], pasted).expect("the pasted text is found");
        for text in &snapshots[1..] {
            tracker = tracker.advanced(text);
        }
        tracker.revision().map(|r| (r.pasted, r.sent))
    }

    /// The revision when `pasted` is edited with each `(from, to)` in turn, one snapshot each.
    fn learned_after(pasted: &str, replacements: &[(&str, &str)]) -> Option<(String, String)> {
        let mut snapshots = vec![pasted.to_owned()];
        for (from, to) in replacements {
            let last = snapshots.last().unwrap();
            assert!(last.contains(from), "{from} is in {last}");
            snapshots.push(last.replacen(from, to, 1));
        }
        let snapshots: Vec<&str> = snapshots.iter().map(String::as_str).collect();
        learned(pasted, &snapshots)
    }

    fn pair(pasted: &str, sent: &str) -> Option<(String, String)> {
        Some((pasted.to_owned(), sent.to_owned()))
    }

    const NONE: Option<(String, String)> = None;

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
        let field = "Wornote is here and Wornote again";
        // `new` takes the last occurrence; the caller knows it is the first.
        assert_eq!(Tracker::new(field, "Wornote").unwrap().span, 20..27);
        let tracker = Tracker::with_span(field, 0..7).unwrap();
        let tracker = tracker.advanced("Wordnote is here and Wornote again");
        let revision = tracker.revision().unwrap();
        assert_eq!(revision.pasted, "Wornote");
        assert_eq!(revision.sent, "Wordnote");
    }

    #[test]
    fn only_a_change_inside_the_pasted_text_counts_as_an_edit() {
        let pasted = "Use Wornote for this";
        let field = format!("PS> {pasted} and more");
        let tracker = Tracker::new(&field, pasted).unwrap();
        assert!(!tracker.edited());
        // The prompt, and the text after the paste, are not the paste.
        assert!(
            !tracker
                .advanced("PS2> Use Wornote for this and more")
                .edited()
        );
        assert!(
            !tracker
                .advanced("PS> Use Wornote for this and more more")
                .edited()
        );
        // A letter typed inside it, a word deleted from it, and a replaced word are.
        assert!(
            tracker
                .advanced("PS> Use Wordnote for this and more")
                .edited()
        );
        assert!(tracker.advanced("PS> Use Wornote this and more").edited());
        assert!(
            tracker
                .advanced("PS> Use Wornote for that and more")
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

    // ---------- the revision ----------

    #[test]
    fn no_edit_is_no_revision() {
        assert_eq!(learned(PASTED, &[PASTED, PASTED]), NONE);
    }

    #[test]
    fn a_word_typed_over_gives_the_whole_dictated_span() {
        let fixed = PASTED.replacen("首機", "手機", 1);
        assert_eq!(
            learned_after(PASTED, &[("首機", "手機")]),
            pair(PASTED, &fixed)
        );
        let pasted = "Please ask Allice to confirm the meeting tomorrow.";
        assert_eq!(
            learned_after(pasted, &[("Allice", "Alice")]),
            pair(pasted, "Please ask Alice to confirm the meeting tomorrow.")
        );
    }

    #[test]
    fn a_word_selected_and_retyped_the_same_is_no_revision() {
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
    fn deletions_and_insertions_are_revisions_too() {
        // Which of them teach a word is the core's judgement, not the tracker's.
        assert!(learned_after(PASTED, &[("新的首機", "新的")]).is_some());
        assert!(learned_after(PASTED, &[("拍照", "拍照和錄影")]).is_some());
    }

    #[test]
    fn several_edits_are_one_revision() {
        let pasted = "Ask Jon and Mery about Zentrova today";
        assert_eq!(
            learned_after(
                pasted,
                &[("Jon", "John"), ("Mery", "Mary"), ("Zentrova", "Zentrovo")]
            ),
            pair(pasted, "Ask John and Mary about Zentrovo today")
        );
    }

    #[test]
    fn edits_outside_the_pasted_text_do_not_count() {
        let before = format!("舊的首機。{PASTED}");
        let fixed = format!("舊的手提電話。{PASTED}");
        let added = format!("{fixed}你覺得呢");
        assert_eq!(learned(PASTED, &[&before, &fixed, &added]), NONE);
    }

    #[test]
    fn an_edit_across_an_edge_of_the_pasted_text_is_no_revision() {
        let field = format!("前面{PASTED}");
        let crossing = field.replacen("前面我", "你", 1);
        assert_eq!(learned(PASTED, &[&field, &crossing]), NONE);
    }

    #[test]
    fn text_typed_after_the_dictation_is_left_out() {
        let fixed = PASTED.replacen("首機", "手機", 1);
        assert_eq!(
            learned(PASTED, &[PASTED, &fixed, &format!("{fixed} 謝謝")]),
            pair(PASTED, &fixed)
        );
    }

    #[test]
    fn the_changed_words_of_a_revision_name_each_replaced_stretch() {
        let revision = Revision {
            pasted: "Use Wornote and Open Router for 首機".into(),
            sent: "Use Wordnote and OpenRouter for 電話 now".into(),
        };
        assert_eq!(
            changed_words(&revision),
            [
                ("Wornote".to_owned(), "Wordnote".to_owned()),
                ("Open Router".to_owned(), "OpenRouter".to_owned()),
                ("首機".to_owned(), "電話 now".to_owned()),
            ]
        );
    }

    #[test]
    fn kept_drops_when_the_field_is_cleared() {
        let tracker = Tracker::new(PASTED, PASTED).unwrap();
        assert_eq!(tracker.kept(), 1.0);
        assert_eq!(tracker.advanced("").kept(), 0.0);
        let fixed = PASTED.replacen("首機", "手機", 1);
        assert!(tracker.advanced(&fixed).kept() > MIN_KEPT_SHARE);
    }
}
