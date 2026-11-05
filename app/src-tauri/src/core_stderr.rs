//! The untrusted native stderr boundary. Keep this independent of the app runtime.

use std::io::{self, BufRead};

pub(super) fn read_lines(mut reader: impl BufRead, mut emit: impl FnMut(&str)) -> io::Result<()> {
    const LIMIT: usize = 16 * 1024;
    let mut line = Vec::new();
    let mut oversized = false;
    loop {
        let chunk = reader.fill_buf()?;
        let eof = chunk.is_empty();
        let end = chunk.iter().position(|byte| *byte == b'\n');
        let used = end.map_or(chunk.len(), |index| index + 1);
        if line.len() + used > LIMIT {
            oversized = true;
            line.clear();
        } else if !oversized {
            line.extend_from_slice(&chunk[..used]);
        }
        reader.consume(used);
        if end.is_some() || eof {
            if oversized {
                emit("[core stderr line omitted: exceeds limit]");
            } else if !line.is_empty() {
                emit(&scrub(String::from_utf8_lossy(&line).trim_end()));
            }
            line.clear();
            oversized = false;
        }
        if eof {
            break;
        }
    }
    Ok(())
}

fn word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}
fn token_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

// Port of failures.scrub: HTTP auth, complete quoted assignments, credential prefixes and labels.
// The scanner also discards an unterminated quoted value through end of line.
fn scrub(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut auth = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let start = index;
        let matched = ["bearer", "basic"].iter().find(|kind| {
            bytes
                .get(index..index + kind.len())
                .is_some_and(|slice| slice.eq_ignore_ascii_case(kind.as_bytes()))
                && (index == 0 || !token_word(bytes[index - 1]))
                && bytes
                    .get(index + kind.len())
                    .is_some_and(u8::is_ascii_whitespace)
        });
        if let Some(kind) = matched {
            index += kind.len();
            while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
                index += 1;
            }
            while bytes
                .get(index)
                .is_some_and(|byte| !byte.is_ascii_whitespace() && !b",;\"'".contains(byte))
            {
                index += 1;
            }
            auth.push_str("[redacted]");
        } else {
            let character = text[start..].chars().next().unwrap();
            auth.push(character);
            index += character.len_utf8();
        }
    }
    let text = auth;
    let bytes = text.as_bytes();
    let mut output = String::new();
    index = 0;
    while index < bytes.len() {
        let mut key_end = index;
        if index == 0 || !word(bytes[index - 1]) {
            while bytes.get(key_end).is_some_and(|byte| word(*byte)) {
                key_end += 1;
            }
        }
        let key = text[index..key_end].to_ascii_lowercase();
        let sensitive = [
            "key",
            "token",
            "secret",
            "password",
            "authorization",
            "cookie",
        ]
        .iter()
        .any(|suffix| key.ends_with(suffix));
        let mut value = key_end;
        if bytes.get(value).is_some_and(|byte| b"\"'".contains(byte)) {
            value += 1;
        }
        while bytes.get(value).is_some_and(u8::is_ascii_whitespace) {
            value += 1;
        }
        if sensitive
            && (index == 0 || !word(bytes[index - 1]))
            && bytes.get(value).is_some_and(|byte| b":=".contains(byte))
        {
            value += 1;
            while bytes.get(value).is_some_and(u8::is_ascii_whitespace) {
                value += 1;
            }
            output.push_str(&text[index..value]);
            let mut end = value;
            if let Some(quote @ (b'\'' | b'"')) = bytes.get(end) {
                let quote = *quote;
                end += 1;
                while end < bytes.len() {
                    if bytes[end] == b'\\' {
                        end = (end + 2).min(bytes.len());
                    } else if bytes[end] == quote {
                        end += 1;
                        break;
                    } else {
                        end += 1;
                    }
                }
            } else {
                while bytes
                    .get(end)
                    .is_some_and(|byte| !byte.is_ascii_whitespace() && !b",;}".contains(byte))
                {
                    end += 1;
                }
            }
            output.push_str("[redacted]");
            index = end;
            continue;
        }
        let prefix = [
            "sk-", "sk_", "ak_", "lt_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "eyJ",
        ]
        .iter()
        .any(|prefix| {
            bytes
                .get(index..index + prefix.len())
                .is_some_and(|slice| slice.eq_ignore_ascii_case(prefix.as_bytes()))
        });
        if prefix && (index == 0 || !token_word(bytes[index - 1])) {
            while bytes
                .get(index)
                .is_some_and(|byte| word(*byte) || *byte == b'.')
            {
                index += 1;
            }
            output.push_str("[redacted]");
        } else {
            let character = text[index..].chars().next().unwrap();
            output.push(character);
            index += character.len_utf8();
        }
    }
    for label in ["refresh_token", "access_token", "id_token"] {
        // Assignment values have already gone; labels themselves carry no useful diagnostics.
        let mut start = 0;
        while let Some(found) = output[start..].to_ascii_lowercase().find(label) {
            let at = start + found;
            output.replace_range(at..at + label.len(), "[credential]");
            start = at + "[credential]".len();
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor};

    fn lines(input: &[u8]) -> Vec<String> {
        let mut output = Vec::new();
        read_lines(BufReader::with_capacity(7, Cursor::new(input)), |line| {
            output.push(line.to_owned())
        })
        .unwrap();
        output
    }

    #[test]
    fn credentials_are_redacted_before_logging() {
        for input in [
            "Authorization: Basic dXNlcjpwYXNz",
            "Bearer private-token",
            r#"password="private \"suffix with spaces" public=ok"#,
            r#"{"api_key":"private \\ suffix", "status":"ok"}"#,
            "cookie='private with spaces' other=ok",
            "password=\"private unterminated suffix",
            "key=private secret=private token=private",
            "sk-private ghp_private eyJprivate",
            "prefix-sk-private prefix-Basic dXNlcjpwYXNz",
        ] {
            let output = lines(input.as_bytes()).join("\n");
            assert!(
                !output.contains("private")
                    && !output.contains("suffix")
                    && !output.contains("dXNlcjpwYXNz"),
                "{output}"
            );
            assert!(output.contains("[redacted]"));
        }
    }

    #[test]
    fn oversized_lines_are_discarded_as_a_whole_and_reading_resumes() {
        let input = format!(
            "password=\"{} private suffix\"\nnext safe line\n",
            "x".repeat(100_000)
        );
        let output = lines(input.as_bytes());
        assert_eq!(output.len(), 2);
        assert_eq!(output[0], "[core stderr line omitted: exceeds limit]");
        assert_eq!(output[1], "next safe line");
    }

    #[test]
    fn invalid_utf8_and_final_lines_are_safe() {
        let output = lines(b"bad \xff password='private value'\nsafe eof");
        assert_eq!(output.len(), 2);
        assert!(!output[0].contains("private"));
        assert_eq!(output[1], "safe eof");
    }

    #[test]
    fn benign_diagnostics_keep_paths_and_identifiers() {
        assert_eq!(
            lines(b"INFO startup C:/app/main.py job=1234567890\n"),
            ["INFO startup C:/app/main.py job=1234567890"]
        );
    }
}
