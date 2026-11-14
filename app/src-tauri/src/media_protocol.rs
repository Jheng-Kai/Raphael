//! `raphael-media://`: the window's way to a stored attachment (a picture, a video, a sound).
//!
//! A stored copy is written once under an opaque id and never rewritten, so the id alone names its
//! bytes for good. The protocol serves it under that one stable URL (`/<id>`) with a year-long
//! `immutable` cache lifetime and an ETag, instead of a disk path through Tauri's asset protocol
//! (no cache headers, a different URL per machine) or base64 over IPC on every open. Video and
//! audio get byte ranges, so a player seeks without the whole file.
//!
//! The core stays the authority over what a stored id is. `attachment_source` asks it for the
//! file, and only then records a grant here: one exact file and one servable type per id. The
//! protocol never reads a path the core did not hand to the main window in this run, and only the
//! main window may ask.

use std::collections::{HashMap, VecDeque};
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use tauri::http::header::{
    ACCEPT_RANGES, ALLOW, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
    HeaderMap, HeaderValue, IF_NONE_MATCH, RANGE, X_CONTENT_TYPE_OPTIONS,
};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

/// The URI scheme the window loads attachments from (`convertFileSrc(id, "raphael-media")`).
pub const SCHEME: &str = "raphael-media";

/// The most bytes one response carries. A player asks for the rest with its next range request, so
/// a long video is never held in memory whole.
const MAX_BODY: u64 = 2 * 1024 * 1024;
/// The most grants kept. A conversation shows far fewer attachments than this at once; past it the
/// oldest grant is dropped, and the window asks `attachment_source` again for what it still shows.
const MAX_GRANTS: usize = 4096;
/// A stored copy never changes, so a year is as good as forever.
const CACHE: &str = "private, max-age=31536000, immutable";

/// What one id may serve: the exact file the core named for it and its checked type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Grant {
    path: PathBuf,
    mime: String,
}

#[derive(Default)]
struct Granted {
    by_id: HashMap<String, Grant>,
    /// Oldest first, so a full table drops the grant that was recorded longest ago.
    order: VecDeque<String>,
}

/// The attachments the main window may load in this run. Managed state of the app.
#[derive(Default)]
pub struct MediaGrants {
    inner: Mutex<Granted>,
}

impl MediaGrants {
    /// Records `path` for `id` when the id and the type are servable; returns whether it did. The
    /// type is the core's own when it gave one, else the file extension's. Nothing that a webview
    /// would run (SVG, HTML) or hand to a plug-in (PDF) is ever granted.
    pub fn allow(&self, id: &str, path: &str, mime: Option<&str>) -> bool {
        if !valid_id(id) || path.is_empty() {
            return false;
        }
        let Some(mime) = mime
            .and_then(normalize_mime)
            .or_else(|| mime_for_path(path).map(str::to_owned))
            .filter(|mime| servable(mime))
        else {
            return false;
        };
        let grant = Grant {
            path: PathBuf::from(path),
            mime,
        };
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        if inner.by_id.insert(id.to_owned(), grant).is_some() {
            inner.order.retain(|known| known != id);
        } else if inner.by_id.len() > MAX_GRANTS
            && let Some(oldest) = inner.order.pop_front()
        {
            inner.by_id.remove(&oldest);
        }
        inner.order.push_back(id.to_owned());
        true
    }

    fn get(&self, id: &str) -> Option<Grant> {
        let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.by_id.get(id).cloned()
    }
}

/// `<32 lowercase hex>.<1 to 12 of a-z0-9>`: the shape of a stored attachment id.
fn valid_id(id: &str) -> bool {
    let Some((stem, extension)) = id.split_once('.') else {
        return false;
    };
    stem.len() == 32
        && stem.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        && (1..=12).contains(&extension.len())
        && extension
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'z'))
}

/// A bare lowercase `type/subtype` without parameters, or nothing when it is not one.
fn normalize_mime(mime: &str) -> Option<String> {
    let bare = mime.split(';').next()?.trim().to_ascii_lowercase();
    let (kind, subtype) = bare.split_once('/')?;
    let token = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'-' | b'_'))
    };
    (token(kind) && token(subtype)).then_some(bare)
}

/// Pictures a window draws, and any video or audio. Not SVG (it runs script), HTML or PDF.
fn servable(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif" | "image/bmp"
    ) || mime.starts_with("video/")
        || mime.starts_with("audio/")
}

/// The type of a stored file by its extension, for a core that names none.
fn mime_for_path(path: &str) -> Option<&'static str> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        _ => return None,
    })
}

/// The handler of [`SCHEME`]. Only the main window's webview is answered; the file work runs off
/// the UI thread and the answer goes back through the responder.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if ctx.webview_label() != crate::MAIN_WINDOW {
        responder.respond(refusal(StatusCode::FORBIDDEN));
        return;
    }
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let (parts, _) = request.into_parts();
        let answer =
            tauri::async_runtime::spawn_blocking(move || match app.try_state::<MediaGrants>() {
                Some(grants) => serve(&grants, &parts.method, parts.uri.path(), &parts.headers),
                None => refusal(StatusCode::NOT_FOUND),
            })
            .await
            .unwrap_or_else(|_| refusal(StatusCode::INTERNAL_SERVER_ERROR));
        responder.respond(answer);
    });
}

/// One request to an answer. Blocking file IO, and no Tauri runtime, so it is tested alone.
fn serve(
    grants: &MediaGrants,
    method: &Method,
    path: &str,
    headers: &HeaderMap,
) -> Response<Vec<u8>> {
    let head = method == Method::HEAD;
    if !head && method != Method::GET {
        let mut answer = refusal(StatusCode::METHOD_NOT_ALLOWED);
        answer
            .headers_mut()
            .insert(ALLOW, HeaderValue::from_static("GET, HEAD"));
        return answer;
    }
    let Some(id) = path.strip_prefix('/').filter(|id| valid_id(id)) else {
        return refusal(StatusCode::NOT_FOUND);
    };
    let Some(grant) = grants.get(id) else {
        return refusal(StatusCode::NOT_FOUND);
    };
    let len = match fs::metadata(&grant.path) {
        Ok(meta) if meta.is_file() => meta.len(),
        Ok(_) => return refusal(StatusCode::NOT_FOUND),
        Err(err) => {
            log::warn!("a granted attachment could not be read ({:?})", err.kind());
            return refusal(StatusCode::NOT_FOUND);
        }
    };

    if etag_matches(headers, id) {
        return cached(StatusCode::NOT_MODIFIED, &grant.mime, id)
            .body(Vec::new())
            .unwrap_or_default();
    }

    let (status, start, count) = match headers.get(RANGE) {
        None => (StatusCode::OK, 0, len),
        Some(value) => match value.to_str().ok().and_then(|raw| range(raw, len)) {
            Some((start, end)) => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
            None => return unsatisfiable(len),
        },
    };
    let body = if head {
        Vec::new()
    } else {
        match read_range(&grant.path, start, count) {
            Ok(body) => body,
            Err(err) => {
                log::warn!("a granted attachment could not be read ({:?})", err.kind());
                return refusal(StatusCode::NOT_FOUND);
            }
        }
    };
    // What is sent is what was read: a file that shrank under the read must not promise more.
    let sent = if head { count } else { body.len() as u64 };
    let mut builder = cached(status, &grant.mime, id).header(CONTENT_LENGTH, sent);
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            CONTENT_RANGE,
            format!("bytes {start}-{}/{len}", start + sent.max(1) - 1),
        );
    }
    builder.body(body).unwrap_or_default()
}

/// 416 with the length the client may ask inside.
fn unsatisfiable(len: u64) -> Response<Vec<u8>> {
    let mut answer = refusal(StatusCode::RANGE_NOT_SATISFIABLE);
    if let Ok(value) = HeaderValue::from_str(&format!("bytes */{len}")) {
        answer.headers_mut().insert(CONTENT_RANGE, value);
    }
    answer
}

/// A response with the headers every answer about a stored copy carries.
fn cached(status: StatusCode, mime: &str, id: &str) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, mime)
        .header(CACHE_CONTROL, CACHE)
        .header(ETAG, format!("\"{id}\""))
        .header(ACCEPT_RANGES, "bytes")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
}

/// An empty refusal. Never cached, so an id that is granted a moment later is not remembered as
/// missing, and never says where a file is.
fn refusal(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CACHE_CONTROL, "no-store")
        .header(X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Vec::new())
        .unwrap_or_default()
}

/// Whether the browser already holds this copy: its `If-None-Match` names the id's ETag, or `*`.
fn etag_matches(headers: &HeaderMap, id: &str) -> bool {
    let Some(raw) = headers.get(IF_NONE_MATCH).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let ours = format!("\"{id}\"");
    raw.split(',').map(str::trim).any(|tag| {
        tag == "*" || tag == ours || tag.strip_prefix("W/").is_some_and(|rest| rest == ours)
    })
}

/// The first byte range of a `Range` header as inclusive `(start, end)` inside a file of `len`
/// bytes, the end cut to what one response carries. `None` when it cannot be satisfied.
fn range(raw: &str, len: u64) -> Option<(u64, u64)> {
    let spec = raw.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (first, last) = spec.split_once('-')?;
    let (first, last) = (first.trim(), last.trim());
    let digits = |text: &str| {
        (!text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()))
            .then(|| text.parse::<u64>().ok())
            .flatten()
    };
    let (start, end) = if first.is_empty() {
        // `-n`: the last n bytes.
        let n = digits(last)?;
        if n == 0 || len == 0 {
            return None;
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start = digits(first)?;
        let end = if last.is_empty() {
            len.checked_sub(1)?
        } else {
            digits(last)?.min(len.checked_sub(1)?)
        };
        (start, end)
    };
    if start >= len || end < start {
        return None;
    }
    Some((start, end.min(start + MAX_BODY - 1)))
}

fn read_range(path: &Path, start: u64, count: u64) -> io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut body = Vec::with_capacity(usize::try_from(count.min(16 << 20)).unwrap_or(0));
    file.take(count).read_to_end(&mut body)?;
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    const ID: &str = "0123456789abcdef0123456789abcdef.png";
    const OTHER: &str = "fedcba9876543210fedcba9876543210.mp4";

    /// A temp file removed when the test ends.
    struct Temp(PathBuf);

    impl Temp {
        fn new(bytes: &[u8]) -> Self {
            static COUNT: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!(
                "raphael-media-test-{}-{}.bin",
                std::process::id(),
                COUNT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::write(&path, bytes).unwrap();
            Self(path)
        }

        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    fn granted(file: &Temp, id: &str, mime: Option<&str>) -> MediaGrants {
        let grants = MediaGrants::default();
        assert!(grants.allow(id, file.path(), mime));
        grants
    }

    fn get(grants: &MediaGrants, path: &str, extra: &[(&str, &str)]) -> Response<Vec<u8>> {
        let mut headers = HeaderMap::new();
        for (name, value) in extra {
            headers.insert(
                tauri::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        serve(grants, &Method::GET, path, &headers)
    }

    fn header<'a>(response: &'a Response<Vec<u8>>, name: &str) -> &'a str {
        response
            .headers()
            .get(name)
            .unwrap_or_else(|| panic!("no {name} header"))
            .to_str()
            .unwrap()
    }

    const BYTES: &[u8] = b"0123456789abcdef";

    #[test]
    fn a_whole_file_comes_with_the_cache_headers_and_exact_bytes() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, ID, Some("image/png"));
        let response = get(&grants, &format!("/{ID}"), &[]);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), BYTES);
        assert_eq!(header(&response, "content-type"), "image/png");
        assert_eq!(
            header(&response, "cache-control"),
            "private, max-age=31536000, immutable"
        );
        assert_eq!(header(&response, "etag"), format!("\"{ID}\""));
        assert_eq!(header(&response, "accept-ranges"), "bytes");
        assert_eq!(header(&response, "x-content-type-options"), "nosniff");
        assert_eq!(header(&response, "content-length"), "16");
        assert!(
            response
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
    }

    #[test]
    fn a_copy_the_browser_holds_is_not_sent_again() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, ID, Some("image/png"));
        for tag in [
            format!("\"{ID}\""),
            "*".to_owned(),
            format!("\"x\", W/\"{ID}\""),
        ] {
            let response = get(&grants, &format!("/{ID}"), &[("if-none-match", &tag)]);
            assert_eq!(response.status(), StatusCode::NOT_MODIFIED, "{tag}");
            assert!(response.body().is_empty());
            assert_eq!(header(&response, "etag"), format!("\"{ID}\""));
            assert_eq!(
                header(&response, "cache-control"),
                "private, max-age=31536000, immutable"
            );
            assert_eq!(header(&response, "content-type"), "image/png");
        }
        let other = get(&grants, &format!("/{ID}"), &[("if-none-match", "\"nope\"")]);
        assert_eq!(other.status(), StatusCode::OK);
    }

    #[test]
    fn byte_ranges_answer_206_with_their_content_range() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, OTHER, Some("video/mp4"));
        for (asked, want, from_to) in [
            ("bytes=2-5", &BYTES[2..6], "2-5"),
            ("bytes=3-", &BYTES[3..], "3-15"),
            ("bytes=-4", &BYTES[12..], "12-15"),
            ("bytes=14-99", &BYTES[14..], "14-15"),
            ("bytes=1-2, 5-6", &BYTES[1..3], "1-2"),
        ] {
            let response = get(&grants, &format!("/{OTHER}"), &[("range", asked)]);
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT, "{asked}");
            assert_eq!(response.body(), want, "{asked}");
            assert_eq!(
                header(&response, "content-range"),
                format!("bytes {from_to}/16")
            );
            assert_eq!(header(&response, "content-length"), want.len().to_string());
            assert_eq!(header(&response, "content-type"), "video/mp4");
            assert_eq!(
                header(&response, "cache-control"),
                "private, max-age=31536000, immutable"
            );
        }
    }

    #[test]
    fn one_response_carries_at_most_two_mebibytes() {
        let size = MAX_BODY as usize + 10;
        let file = Temp::new(&vec![7u8; size]);
        let grants = granted(&file, OTHER, Some("video/mp4"));
        let response = get(&grants, &format!("/{OTHER}"), &[("range", "bytes=0-")]);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body().len(), MAX_BODY as usize);
        assert_eq!(
            header(&response, "content-range"),
            format!("bytes 0-{}/{size}", MAX_BODY - 1)
        );
        let tail = get(
            &grants,
            &format!("/{OTHER}"),
            &[("range", &format!("bytes={MAX_BODY}-"))],
        );
        assert_eq!(tail.body().len(), 10);
    }

    #[test]
    fn a_range_that_cannot_be_met_answers_416() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, OTHER, Some("video/mp4"));
        for asked in [
            "bytes=16-",
            "bytes=99-120",
            "bytes=5-2",
            "bytes=-0",
            "bytes=x-y",
            "bytes=",
            "lines=1-2",
            "bytes",
        ] {
            let response = get(&grants, &format!("/{OTHER}"), &[("range", asked)]);
            assert_eq!(
                response.status(),
                StatusCode::RANGE_NOT_SATISFIABLE,
                "{asked}"
            );
            assert_eq!(header(&response, "content-range"), "bytes */16", "{asked}");
            assert!(response.body().is_empty());
        }
    }

    #[test]
    fn what_was_not_granted_or_is_not_an_id_is_not_found() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, ID, Some("image/png"));
        for path in [
            "/ffffffffffffffffffffffffffffffff.png",
            ID,
            "/",
            "",
            &format!("/{ID}/more"),
            &format!("//{ID}"),
            "/..%2f..%2fsecret.png",
            "/0123456789ABCDEF0123456789abcdef.png",
            "/0123456789abcdef.png",
        ] {
            let response = get(&grants, path, &[]);
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path:?}");
            assert!(response.body().is_empty());
        }
    }

    #[test]
    fn a_granted_file_that_is_gone_is_not_found_without_naming_it() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, ID, Some("image/png"));
        let path = file.path().to_owned();
        drop(file);
        let response = get(&grants, &format!("/{ID}"), &[]);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(response.body().is_empty());
        assert!(!format!("{:?}", response.headers()).contains(&path));
    }

    #[test]
    fn only_get_and_head_are_served() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, ID, Some("image/png"));
        let uri = format!("/{ID}");
        for method in [Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS] {
            let response = serve(&grants, &method, &uri, &HeaderMap::new());
            assert_eq!(
                response.status(),
                StatusCode::METHOD_NOT_ALLOWED,
                "{method}"
            );
            assert_eq!(header(&response, "allow"), "GET, HEAD");
        }
    }

    #[test]
    fn head_has_the_headers_of_a_get_and_no_body() {
        let file = Temp::new(BYTES);
        let grants = granted(&file, OTHER, Some("video/mp4"));
        let uri = format!("/{OTHER}");
        let whole = serve(&grants, &Method::HEAD, &uri, &HeaderMap::new());
        assert_eq!(whole.status(), StatusCode::OK);
        assert!(whole.body().is_empty());
        assert_eq!(header(&whole, "content-length"), "16");
        assert_eq!(header(&whole, "content-type"), "video/mp4");
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, HeaderValue::from_static("bytes=2-5"));
        let part = serve(&grants, &Method::HEAD, &uri, &headers);
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert!(part.body().is_empty());
        assert_eq!(header(&part, "content-length"), "4");
        assert_eq!(header(&part, "content-range"), "bytes 2-5/16");
    }

    #[test]
    fn an_empty_file_is_served_but_has_no_range() {
        let file = Temp::new(b"");
        let grants = granted(&file, ID, Some("image/png"));
        let uri = format!("/{ID}");
        let whole = get(&grants, &uri, &[]);
        assert_eq!(whole.status(), StatusCode::OK);
        assert!(whole.body().is_empty());
        let ranged = get(&grants, &uri, &[("range", "bytes=0-")]);
        assert_eq!(ranged.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(header(&ranged, "content-range"), "bytes */0");
    }

    #[test]
    fn only_pictures_video_and_sound_are_granted() {
        let grants = MediaGrants::default();
        for mime in [
            "image/svg+xml",
            "text/html",
            "application/pdf",
            "application/octet-stream",
            "text/plain",
            "image/",
            "video",
        ] {
            assert!(!grants.allow(ID, "C:\\a\\b.bin", Some(mime)), "{mime}");
        }
        for mime in [
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "image/avif",
            "image/bmp",
            "video/mp4",
            "video/x-matroska",
            "audio/mpeg",
            "IMAGE/PNG; charset=binary",
        ] {
            assert!(grants.allow(ID, "C:\\a\\b.bin", Some(mime)), "{mime}");
        }
        // Whatever the extension says, a type the core named and that is not servable wins.
        assert!(!grants.allow(ID, "C:\\a\\b.png", Some("text/html")));
        assert!(!grants.allow("not-an-id", "C:\\a\\b.png", Some("image/png")));
        assert!(!grants.allow(ID, "", Some("image/png")));
    }

    #[test]
    fn the_type_falls_back_to_the_extension() {
        for (name, mime) in [
            ("a.png", "image/png"),
            ("a.JPG", "image/jpeg"),
            ("a.jpeg", "image/jpeg"),
            ("a.webp", "image/webp"),
            ("a.gif", "image/gif"),
            ("a.avif", "image/avif"),
            ("a.bmp", "image/bmp"),
            ("a.mp4", "video/mp4"),
            ("a.m4v", "video/mp4"),
            ("a.webm", "video/webm"),
            ("a.mov", "video/quicktime"),
            ("a.mkv", "video/x-matroska"),
            ("a.ogv", "video/ogg"),
            ("a.mp3", "audio/mpeg"),
            ("a.wav", "audio/wav"),
            ("a.m4a", "audio/mp4"),
            ("a.aac", "audio/aac"),
            ("a.ogg", "audio/ogg"),
            ("a.oga", "audio/ogg"),
            ("a.opus", "audio/opus"),
            ("a.flac", "audio/flac"),
        ] {
            assert_eq!(mime_for_path(name), Some(mime), "{name}");
            let grants = MediaGrants::default();
            assert!(
                grants.allow(ID, &format!("C:\\store\\{name}"), None),
                "{name}"
            );
            assert_eq!(grants.get(ID).unwrap().mime, mime);
        }
        for name in ["a.svg", "a.html", "a.pdf", "a", "a.txt"] {
            let grants = MediaGrants::default();
            assert!(
                !grants.allow(ID, &format!("C:\\store\\{name}"), None),
                "{name}"
            );
        }
    }

    #[test]
    fn the_grant_table_is_bounded_and_drops_the_oldest() {
        let grants = MediaGrants::default();
        let id = |n: usize| format!("{n:032x}.png");
        for n in 0..=MAX_GRANTS {
            assert!(grants.allow(&id(n), "C:\\a.png", None));
        }
        assert!(grants.get(&id(0)).is_none());
        assert!(grants.get(&id(1)).is_some());
        assert!(grants.get(&id(MAX_GRANTS)).is_some());
        // A grant recorded again counts as the newest.
        assert!(grants.allow(&id(1), "C:\\a.png", None));
        assert!(grants.allow(&id(MAX_GRANTS + 1), "C:\\a.png", None));
        assert!(grants.get(&id(1)).is_some());
        assert!(grants.get(&id(2)).is_none());
        let inner = grants.inner.lock().unwrap();
        assert_eq!(inner.by_id.len(), MAX_GRANTS);
        assert_eq!(inner.order.len(), MAX_GRANTS);
    }

    #[test]
    fn the_scheme_is_the_one_the_window_builds_its_urls_with() {
        assert_eq!(SCHEME, "raphael-media");
    }
}
