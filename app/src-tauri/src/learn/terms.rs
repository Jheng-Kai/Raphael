//! Deterministic term extraction. No model, OS word breaker or persistent state is involved.

use std::ops::Range;

use super::corrections::{Correction, MAX_CORRECTIONS, is_cjk};

// Function words and very common vocabulary are boundaries, never dictionary terms.
const COMMON: &[&str] = &[
    "我",
    "你",
    "他",
    "她",
    "它",
    "的",
    "了",
    "是",
    "在",
    "和",
    "與",
    "也",
    "很",
    "有",
    "要",
    "就",
    "都",
    "不",
    "把",
    "被",
    "讓",
    "給",
    "再",
    "又",
    "嗎",
    "呢",
    "啊",
    "喔",
    "請",
    "用",
    "說",
    "到",
    "買",
    "支",
    "改",
    "找",
    "今天",
    "昨天",
    "明天",
    "這個",
    "那個",
    "我們",
    "你們",
    "他們",
    "但是",
    "因為",
    "所以",
    "可以",
    "請問",
    "知道",
    "覺得",
    "真的",
    "謝謝",
    "幫忙",
    "手機",
    "電腦",
    "好的",
    "很好",
    "非常",
    "一下",
    "新的",
    "們",
    "去",
    "想",
    "來",
    "先生",
    "後天",
    "早上",
    "下午",
    "拍照",
    "點",
    "開會",
    "は",
    "が",
    "を",
    "に",
    "の",
    "と",
    "で",
    "へ",
    "も",
    "です",
    "ます",
    "でした",
    "ません",
    "する",
    "した",
    "して",
    "ください",
    "ありがとう",
    "こんにちは",
    "これ",
    "それ",
    "あれ",
    "今日",
    "明日",
    "昨日",
    "私",
    "あなた",
    "本当",
    "とても",
    "お願い",
    "します",
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "of",
    "to",
    "in",
    "on",
    "at",
    "for",
    "with",
    "from",
    "is",
    "am",
    "are",
    "was",
    "were",
    "be",
    "been",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "this",
    "that",
    "these",
    "those",
    "please",
    "thanks",
    "thank",
    "yes",
    "no",
    "not",
    "do",
    "does",
    "did",
    "can",
    "could",
    "would",
    "should",
    "will",
    "really",
    "very",
    "good",
    "great",
    "just",
    "now",
    "then",
    "today",
    "tomorrow",
    "yesterday",
    "send",
    "me",
    "my",
    "your",
    "our",
];

#[derive(Clone, Debug)]
struct Edit {
    old: Range<usize>,
    new: Range<usize>,
}

/// Find local replacements in the final dictation, keeping only short term-like words.
/// Persistence owns the dictionary's existing-pair/dismissal checks and batch Undo.
pub fn term_corrections(before: &str, after: &str) -> Vec<Correction> {
    let old: Vec<char> = before.chars().collect();
    let new: Vec<char> = after.chars().collect();
    if old.is_empty() || old.len() > 20_000 || new.len() > 20_000 || old == new {
        return Vec::new();
    }
    let Some(raw_edits) = changed_spans(&old, &new) else {
        return Vec::new();
    };
    let mut edits: Vec<Edit> = Vec::new();
    for edit in raw_edits {
        if let Some(last) = edits.last_mut()
            && old[last.old.end..edit.old.start]
                .iter()
                .all(|c| c.is_whitespace())
            && new[last.new.end..edit.new.start]
                .iter()
                .all(|c| c.is_whitespace())
        {
            last.old.end = edit.old.end;
            last.new.end = edit.new.end;
            continue;
        }
        edits.push(edit);
    }
    if edits.len() > MAX_CORRECTIONS {
        return Vec::new();
    }
    let mut spans: Vec<Edit> = Vec::new();
    for mut edit in edits {
        // CJK is diffed by character. Restore the surrounding term on both sides;
        // function words bound it without a platform-dependent word breaker.
        if !edit.old.is_empty()
            && !edit.new.is_empty()
            && old[edit.old.clone()].iter().copied().any(is_cjk)
            && new[edit.new.clone()].iter().copied().any(is_cjk)
        {
            edit.old = term_bounds(&old, &edit.old);
            edit.new = term_bounds(&new, &edit.new);
        }
        if let Some(last) = spans.last_mut() {
            let overlaps = edit.old.start <= last.old.end && edit.new.start <= last.new.end;
            let whitespace_gap = edit.old.start >= last.old.end
                && edit.new.start >= last.new.end
                && old[last.old.end..edit.old.start]
                    .iter()
                    .all(|c| c.is_whitespace())
                && new[last.new.end..edit.new.start]
                    .iter()
                    .all(|c| c.is_whitespace());
            if overlaps || whitespace_gap {
                last.old.start = last.old.start.min(edit.old.start);
                last.new.start = last.new.start.min(edit.new.start);
                last.old.end = last.old.end.max(edit.old.end);
                last.new.end = last.new.end.max(edit.new.end);
                continue;
            }
        }
        spans.push(edit);
    }
    // Count every edit, including insertions, deletions and punctuation changes, before
    // filtering candidates. A broad rewrite must not donate its remaining plausible name.
    if spans.len() > MAX_CORRECTIONS {
        return Vec::new();
    }
    let mut corrections = Vec::new();
    for edit in spans {
        let wrong: String = old[edit.old].iter().collect();
        let right: String = new[edit.new].iter().collect();
        let boundary_break = wrong
            .chars()
            .chain(right.chars())
            .any(|c| matches!(c, '\r' | '\n' | '\u{2028}' | '\u{2029}'));
        let wrong = wrong.trim();
        let right = right.trim();
        let (wrong_len, right_len) = (wrong.chars().count(), right.chars().count());
        let latin_words = right
            .split(|c: char| !c.is_alphanumeric() || is_cjk(c))
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>();
        let all_common = !right.chars().any(is_cjk)
            && !latin_words.is_empty()
            && latin_words.iter().all(|word| common(word));
        let common_edge = latin_words.len() > 1
            && [latin_words.first(), latin_words.last()]
                .into_iter()
                .flatten()
                .any(|word| common(word) && word.chars().all(|c| !c.is_uppercase()));
        let cjk = right.chars().any(is_cjk);
        let term = right.chars().any(|c| c.is_uppercase() || c.is_numeric())
            || (cjk && right.chars().any(|c| c.is_ascii_alphabetic()))
            || ((2..=8).contains(&right_len) && right.chars().all(is_cjk));
        let forbidden = |text: &str| {
            text.chars().any(|c| {
                matches!(
                    c,
                    '\r' | '\n'
                        | '\u{2028}'
                        | '\u{2029}'
                        | '，'
                        | '。'
                        | '！'
                        | '？'
                        | '、'
                        | '；'
                        | '：'
                        | ','
                        | '.'
                        | '!'
                        | '?'
                        | ';'
                        | ':'
                )
            })
        };
        if boundary_break
            || wrong_len == 0
            || right_len == 0
            || right_len > 24
            || latin_words.len() > 3
            || wrong_len * 5 < right_len * 2
            || wrong_len * 2 > right_len * 5
            || forbidden(wrong)
            || forbidden(right)
            || !right.chars().any(|c| c.is_alphabetic() && !c.is_numeric())
            || !term
            || common(right)
            || all_common
            || common_edge
            || wrong == right
        {
            continue;
        }
        let correction = Correction {
            word: right.to_owned(),
            misheard: wrong.to_owned(),
        };
        if !corrections.contains(&correction) {
            corrections.push(correction);
        }
    }
    corrections
}

fn common(text: &str) -> bool {
    let lower = text.to_lowercase();
    if COMMON.contains(&lower.as_str()) {
        return true;
    }
    if !text.chars().all(is_cjk) {
        return false;
    }
    let mut remaining = text;
    while !remaining.is_empty() {
        let longest = COMMON
            .iter()
            .filter(|word| remaining.starts_with(**word))
            .max_by_key(|word| word.len());
        if let Some(word) = longest {
            remaining = &remaining[word.len()..];
        } else if let Some(c) = remaining
            .chars()
            .next()
            .filter(|c| "零一二三四五六七八九十百千萬".contains(*c))
        {
            remaining = &remaining[c.len_utf8()..];
        } else {
            return false;
        }
    }
    true
}

fn term_bounds(chars: &[char], edit: &Range<usize>) -> Range<usize> {
    let mut start = edit.start;
    let mut end = edit.end;
    while start > 0 && (chars[start - 1].is_alphanumeric() || is_cjk(chars[start - 1])) {
        start -= 1;
    }
    while end < chars.len() && (chars[end].is_alphanumeric() || is_cjk(chars[end])) {
        end += 1;
    }
    // A change inside a known common word must not turn its suffix into a learned term.
    for word in COMMON
        .iter()
        .filter(|word| word.chars().count() > 1 && word.chars().any(is_cjk))
    {
        let word: Vec<char> = word.chars().collect();
        for at in start..end {
            if at <= edit.start
                && edit.end <= at + word.len()
                && at + word.len() <= end
                && chars[at..at + word.len()] == word
            {
                return at..at + word.len();
            }
        }
    }
    for word in COMMON.iter().filter(|word| word.chars().any(is_cjk)) {
        let word: Vec<char> = word.chars().collect();
        let scan = start..end;
        for at in scan {
            if at + word.len() <= end && chars[at..at + word.len()] == word {
                if at + word.len() <= edit.start {
                    start = start.max(at + word.len());
                } else if at >= edit.end {
                    end = end.min(at);
                }
            }
        }
    }
    start..end
}

/// Latin words are indivisible tokens; CJK and separators are scalar-character tokens.
fn tokens(chars: &[char]) -> Vec<Range<usize>> {
    let mut tokens = Vec::new();
    let mut at = 0;
    while at < chars.len() {
        let start = at;
        let latin = chars[at].is_alphanumeric() && !is_cjk(chars[at]);
        at += 1;
        if latin {
            while at < chars.len() && chars[at].is_alphanumeric() && !is_cjk(chars[at]) {
                at += 1;
            }
        }
        tokens.push(start..at);
    }
    tokens
}

/// Bounded Myers alignment avoids a quadratic table for long, sparsely edited dictations.
fn changed_spans(old: &[char], new: &[char]) -> Option<Vec<Edit>> {
    let (a, b) = (tokens(old), tokens(new));
    let limit = (a.len() + b.len()).min(256);
    let offset = limit as isize + 1;
    let index = |k: isize| (k + offset) as usize;
    let mut frontier = vec![0isize; 2 * limit + 3];
    let mut trace = Vec::new();
    let mut work = 0;
    for distance in 0..=limit {
        trace.push(frontier.clone());
        let d = distance as isize;
        for k in (-d..=d).step_by(2) {
            let mut x = if k == -d || (k != d && frontier[index(k - 1)] < frontier[index(k + 1)]) {
                frontier[index(k + 1)]
            } else {
                frontier[index(k - 1)] + 1
            };
            let mut y = x - k;
            while x < a.len() as isize
                && y < b.len() as isize
                && old[a[x as usize].clone()] == new[b[y as usize].clone()]
            {
                x += 1;
                y += 1;
                work += 1;
            }
            work += 1;
            if work > 1_000_000 {
                return None;
            }
            frontier[index(k)] = x;
            if x == a.len() as isize && y == b.len() as isize {
                let mut equal = Vec::new();
                for distance in (0..=distance).rev() {
                    let v = &trace[distance];
                    let d = distance as isize;
                    let k = x - y;
                    let previous_k = if k == -d || (k != d && v[index(k - 1)] < v[index(k + 1)]) {
                        k + 1
                    } else {
                        k - 1
                    };
                    let previous_x = v[index(previous_k)];
                    let previous_y = previous_x - previous_k;
                    while x > previous_x && y > previous_y {
                        x -= 1;
                        y -= 1;
                        equal.push((x as usize, y as usize));
                    }
                    x = previous_x;
                    y = previous_y;
                }
                equal.reverse();
                equal.push((a.len(), b.len()));
                let mut edits = Vec::new();
                let (mut old_at, mut new_at) = (0, 0);
                let position = |tokens: &[Range<usize>], at: usize, end: usize| {
                    tokens.get(at).map_or(end, |t| t.start)
                };
                for (old_end, new_end) in equal {
                    if old_at < old_end || new_at < new_end {
                        edits.push(Edit {
                            old: position(&a, old_at, old.len())..position(&a, old_end, old.len()),
                            new: position(&b, new_at, new.len())..position(&b, new_end, new.len()),
                        });
                    }
                    old_at = old_end + 1;
                    new_at = new_end + 1;
                }
                return Some(edits);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    type TermCase<'a> = (&'a str, &'a str, &'a [(&'a str, &'a str)]);

    #[test]
    fn term_rules_in_three_languages() {
        let cases: &[TermCase<'_>] = &[
            ("拉菲爾", "拉斐爾", &[("拉菲爾", "拉斐爾")]),
            ("請找拉菲爾幫忙", "請找拉斐爾幫忙", &[("拉菲爾", "拉斐爾")]),
            ("台機電", "台積電", &[("台機電", "台積電")]),
            ("台北", "臺北", &[("台北", "臺北")]),
            (
                "open router",
                "OpenRouter",
                &[("open router", "OpenRouter")],
            ),
            (
                "cloud code",
                "Claude Code",
                &[("cloud code", "Claude Code")],
            ),
            ("Allice", "Alice", &[("Allice", "Alice")]),
            ("Tyeless", "Typeless", &[("Tyeless", "Typeless")]),
            ("openrouter", "OpenRouter", &[("openrouter", "OpenRouter")]),
            ("kubernets", "Kubernetes", &[("kubernets", "Kubernetes")]),
            ("gpt four", "GPT4", &[("gpt four", "GPT4")]),
            ("k eight s", "K8s", &[]), // Outside the comparable-length range.
            ("A三模型", "A四模型", &[("A三模型", "A四模型")]),
            ("ラファエロ", "ラファエル", &[("ラファエロ", "ラファエル")]),
            (
                "明日はラファエロです",
                "明日はラファエルです",
                &[("ラファエロ", "ラファエル")],
            ),
            ("トキオ", "トーキョー", &[("トキオ", "トーキョー")]),
            ("山本太朗", "山本太郎", &[("山本太朗", "山本太郎")]),
            ("みそ", "味噌", &[("みそ", "味噌")]),
            ("very good", "really great", &[]),
            ("Cloude", "Claude tomorrow", &[]),
            ("beatles", "The Beatles", &[("beatles", "The Beatles")]),
            (
                "bank uv amerika",
                "Bank of America",
                &[("bank uv amerika", "Bank of America")],
            ),
            ("send it", "Please send it", &[]),
            ("could you", "Please do", &[]),
            ("不錯", "真的很好", &[]),
            ("我想明天去", "我們今天去", &[]),
            ("首機", "手機", &[]),
            ("こんにちわ", "こんにちは", &[]),
            ("そうです", "本当です", &[]),
            ("ありがとう", "ありがとうございます", &[]),
            ("hello", "hello Alice", &[]),
            ("", "Alice", &[]),
            ("Alice", "", &[]),
            ("hello!", "hello?", &[]),
            ("Allice, Cloude", "Alice; Claude", &[]),
            ("old", "A Long Product Name", &[]),
            (
                "a similarly sized phrase",
                "AnExtremelyLongProductName",
                &[],
            ),
            ("abcdef", "A", &[]),
            ("ab", "ABCDEFG", &[]),
            ("twelve", "123456", &[]),
            ("twelve", "１２３", &[]),
            ("twelve", "ⅫⅫⅫ", &[]),
            ("twelve", "!!!", &[]),
            ("twelve", "   ", &[]),
            ("hello\nworld", "Hello World", &[]),
            ("Allice\n", "Alice", &[]),
            ("你好\r\n世界", "拉斐爾", &[]),
            ("很長的原始術語文字", "更長的新術語文字串", &[]),
            (
                "ask Allice and Cloude",
                "ask Alice and Claude",
                &[("Allice", "Alice"), ("Cloude", "Claude")],
            ),
            (
                "Allice and Cloude and Bobb",
                "Alice and Claude and Bob",
                &[],
            ),
            (
                "Allice and Allice",
                "Alice and Alice",
                &[("Allice", "Alice")],
            ),
            ("please use FOO2", "please use foo2", &[("FOO2", "foo2")]),
            ("foo", "bar", &[]),
            ("明天下午三點開會", "後天早上十點開會", &[]),
            ("four", "ABCDEFGHIJ", &[("four", "ABCDEFGHIJ")]),
            ("abcdefghij", "Name", &[("abcdefghij", "Name")]),
            (
                "alpha beta gamma",
                "Alpha Beta Gamma",
                &[("alpha beta gamma", "Alpha Beta Gamma")],
            ),
            (
                "abcdefghijklmnopqrstuvwx",
                "ABCDEFGHIJKLMNOPQRSTUVWX",
                &[("abcdefghijklmnopqrstuvwx", "ABCDEFGHIJKLMNOPQRSTUVWX")],
            ),
            (
                "abcdefghijklmnopqrstuvwxy",
                "ABCDEFGHIJKLMNOPQRSTUVWXY",
                &[],
            ),
            ("v one", "v２", &[("v one", "v２")]),
        ];
        assert!(
            cases.len() >= 20,
            "cover all three languages with a substantial table"
        );
        let mut failures = Vec::new();
        for &(before, after, expected) in cases {
            let actual = term_corrections(before, after);
            let expected: Vec<_> = expected
                .iter()
                .map(|(wrong, right)| Correction {
                    misheard: (*wrong).to_owned(),
                    word: (*right).to_owned(),
                })
                .collect();
            if actual != expected {
                failures.push(format!(
                    "{before:?} -> {after:?}: {actual:?}, expected {expected:?}"
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn long_sparse_edits_are_bounded_without_losing_local_terms() {
        let context = " unchanged".repeat(1_500);
        let before = format!("Allice{context} Cloude");
        let after = format!("Alice{context} Claude");
        assert_eq!(term_corrections(&before, &after).len(), 2);
        assert!(term_corrections(&"x".repeat(20_001), "Alice").is_empty());
        assert!(term_corrections(&"甲".repeat(500), &"乙".repeat(500)).is_empty());
    }
}
