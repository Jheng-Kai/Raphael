//! A member template opened from outside the app. The Windows installer gives `.raphael-member` files to Raphael
//! (`bundle.fileAssociations` of tauri.conf.json), so a double-click starts the app with the file's path as an argument,
//! or hands it to the copy that already runs (the single-instance path of lib.rs).
//!
//! The shell reads the file itself, bounded and only by that extension, and keeps its text until the window asks for it
//! (`member_template_pending`): the page never names a path, and it only shows the import review. Nothing is added to the
//! team before the owner presses 加入 there.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// The extension of a template file, without its dot.
pub const EXTENSION: &str = "raphael-member";

/// The largest template file, as the core's `MAX_BYTES` of members/templates.py.
pub const MAX_BYTES: usize = 512 * 1024;

/// The text of the file that was opened, until the window takes it.
static PENDING: Mutex<Option<String>> = Mutex::new(None);

fn is_template(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(EXTENSION))
}

/// The template file a launch was given: the first argument after the program's own that names a `.raphael-member` file.
/// Options (`--autostart`) and every other argument are not it.
pub fn path_in(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with("--"))
        .map(PathBuf::from)
        .find(|path| is_template(path))
}

/// A template's text with any byte-order mark gone. Notepad writes UTF-8 with one, and older versions of it write
/// UTF-16; both are the same file to the owner.
pub fn decode(bytes: &[u8]) -> Result<String, String> {
    let utf16 = |rest: &[u8], unit: fn([u8; 2]) -> u16| -> Result<String, String> {
        let (pairs, odd) = rest.as_chunks::<2>();
        if !odd.is_empty() {
            return Err("member template must be text".to_owned());
        }
        let units: Vec<u16> = pairs.iter().map(|pair| unit(*pair)).collect();
        String::from_utf16(&units).map_err(|_| "member template must be text".to_owned())
    };
    match bytes {
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8(rest.to_vec()),
        [0xFF, 0xFE, rest @ ..] => return utf16(rest, u16::from_le_bytes),
        [0xFE, 0xFF, rest @ ..] => return utf16(rest, u16::from_be_bytes),
        _ => String::from_utf8(bytes.to_vec()),
    }
    .map_err(|_| "member template must be text".to_owned())
}

/// The text of a template file: at most [`MAX_BYTES`], decoded by [`decode`].
pub fn read(path: &Path) -> Result<String, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "could not open member template".to_owned())?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "could not read member template".to_owned())?;
    if bytes.len() > MAX_BYTES {
        return Err("member template is too large".to_owned());
    }
    decode(&bytes)
}

/// Keeps the text of the template file a launch was given, for the window to take. False when it was given none, or the
/// file cannot be read (the window is then not told of a file it could not show; it is logged).
pub fn offer(args: &[String]) -> bool {
    let Some(path) = path_in(args) else {
        return false;
    };
    match read(&path) {
        Ok(text) => {
            *PENDING.lock().unwrap_or_else(PoisonError::into_inner) = Some(text);
            true
        }
        Err(error) => {
            log::warn!("a member template file was not opened: {error}");
            false
        }
    }
}

/// The text of the file that was opened, once.
pub fn take() -> Option<String> {
    PENDING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn a_launch_with_a_template_file_names_it_and_nothing_else_does() {
        assert_eq!(
            path_in(&args(&[
                "Raphael.exe",
                r"C:\Users\me\Downloads\editor.raphael-member"
            ])),
            Some(PathBuf::from(
                r"C:\Users\me\Downloads\editor.raphael-member"
            ))
        );
        // the extension is the Windows kind: any case
        assert!(path_in(&args(&["Raphael.exe", "Editor.RAPHAEL-MEMBER"])).is_some());
        assert_eq!(path_in(&args(&["Raphael.exe"])), None);
        assert_eq!(path_in(&args(&[])), None);
        assert_eq!(path_in(&args(&["Raphael.exe", "--autostart"])), None);
        assert_eq!(
            path_in(&args(&["Raphael.exe", r"C:\notes.txt", "template.json"])),
            None
        );
        assert_eq!(path_in(&args(&["Raphael.exe", "raphael-member"])), None);
        assert_eq!(
            path_in(&args(&["Raphael.exe", "--open=editor.raphael-member"])),
            None
        );
    }

    #[test]
    fn the_program_itself_is_never_taken_for_the_file() {
        assert_eq!(path_in(&args(&["editor.raphael-member"])), None);
    }

    #[test]
    fn the_first_template_file_wins_beside_other_arguments() {
        assert_eq!(
            path_in(&args(&[
                "Raphael.exe",
                "--autostart",
                "a.raphael-member",
                "b.raphael-member"
            ])),
            Some(PathBuf::from("a.raphael-member"))
        );
    }

    #[test]
    fn a_byte_order_mark_does_not_reach_the_window() {
        let json = "{\"name\":\"編輯\"}";
        assert_eq!(decode(json.as_bytes()).unwrap(), json);
        let mut with_mark = vec![0xEF, 0xBB, 0xBF];
        with_mark.extend_from_slice(json.as_bytes());
        assert_eq!(decode(&with_mark).unwrap(), json);
    }

    #[test]
    fn a_template_saved_as_utf16_is_read_in_either_byte_order() {
        let json = "{\"name\":\"編輯\"}";
        let mut little = vec![0xFF, 0xFE];
        let mut big = vec![0xFE, 0xFF];
        for unit in json.encode_utf16() {
            little.extend_from_slice(&unit.to_le_bytes());
            big.extend_from_slice(&unit.to_be_bytes());
        }
        assert_eq!(decode(&little).unwrap(), json);
        assert_eq!(decode(&big).unwrap(), json);
        assert!(decode(&[0xFF, 0xFE, 0x41]).is_err());
    }

    #[test]
    fn bytes_that_are_not_text_are_refused() {
        assert!(decode(&[0x80, 0x81, 0x82]).is_err());
        assert!(decode(&[0xEF, 0xBB, 0xBF, 0xC0]).is_err());
    }

    #[test]
    fn a_file_is_read_whole_up_to_the_size_the_core_accepts() {
        let folder =
            std::env::temp_dir().join(format!("raphael-template-file-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let small = folder.join("small.raphael-member");
        std::fs::write(&small, b"\xEF\xBB\xBF{}").unwrap();
        assert_eq!(read(&small).unwrap(), "{}");
        let large = folder.join("large.raphael-member");
        std::fs::write(&large, vec![b' '; MAX_BYTES + 1]).unwrap();
        assert_eq!(read(&large).unwrap_err(), "member template is too large");
        assert_eq!(
            read(&folder.join("missing.raphael-member")).unwrap_err(),
            "could not open member template"
        );
        std::fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn an_opened_file_waits_for_the_window_and_is_taken_once() {
        let folder =
            std::env::temp_dir().join(format!("raphael-template-offer-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("editor.raphael-member");
        std::fs::write(&file, "{\"format\":\"raphael-member\"}").unwrap();
        let launch = args(&["Raphael.exe", file.to_str().unwrap()]);
        // a launch without a file, or with one that cannot be read, leaves nothing to take
        assert!(!offer(&args(&["Raphael.exe"])));
        assert!(!offer(&args(&[
            "Raphael.exe",
            folder.join("gone.raphael-member").to_str().unwrap()
        ])));
        assert_eq!(take(), None);
        assert!(offer(&launch));
        assert_eq!(take().as_deref(), Some("{\"format\":\"raphael-member\"}"));
        assert_eq!(take(), None);
        std::fs::remove_dir_all(&folder).ok();
    }
}
