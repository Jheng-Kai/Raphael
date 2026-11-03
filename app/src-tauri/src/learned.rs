//! A content-sized, passive notification window. The ordinary overlay stays click-through.
use crate::core_process::{CoreApi, CoreProcess};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::{Mutex, PoisonError};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Webview, WebviewUrl, WebviewWindowBuilder,
    ipc::Channel,
};

const LABEL: &str = "learned";
#[derive(Clone, Serialize)]
pub struct Notice {
    words: Vec<String>,
    token: String,
    language: String,
    theme: String,
    revision: u64,
}
#[derive(Default)]
struct State {
    current: Mutex<Option<Notice>>,
    channel: Mutex<Option<Channel<Notice>>>,
}

pub fn start(app: &AppHandle) -> tauri::Result<()> {
    app.manage(State::default());
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("learned.html".into()))
        .title("Raphael learned word")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .resizable(false)
        .inner_size(500.0, 64.0)
        .data_directory(crate::webview_data_dir(app)?)
        .build()?;
    window.set_ignore_cursor_events(true)?;
    crate::webview_power::low_memory(&window, true);
    crate::overlay::apply_passive_style(&window);
    app.state::<crate::overlay::mouse::Windows>()
        .register(&window);
    Ok(())
}

pub fn publish(app: &AppHandle, words: &[String], undo: Option<&str>, language: &str) {
    if words.is_empty() {
        return;
    }
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    let Some(mouse) = app.state::<crate::overlay::mouse::Windows>().get(LABEL) else {
        return;
    };
    let theme = app
        .get_webview_window(crate::MAIN_WINDOW)
        .and_then(|w| w.theme().ok())
        .map(|theme| {
            if theme == tauri::Theme::Dark {
                "dark"
            } else {
                "light"
            }
            .to_owned()
        })
        .unwrap_or_else(|| "light".to_owned());
    let mut current = state.current.lock().unwrap_or_else(PoisonError::into_inner);
    let revision = mouse.clear();
    let notice = Notice {
        revision,
        words: words.to_vec(),
        token: undo.unwrap_or_default().to_owned(),
        language: language.to_owned(),
        theme,
    };
    *current = Some(notice.clone());
    drop(current);
    let delivered = state
        .channel
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .is_some_and(|channel| channel.send(notice).is_ok());
    if !delivered {
        crate::commands::tell_main_window(crate::commands::MainEvent::SetupMissing {
            missing: json!({"resource": "dictionary", "requirement": "learned", "state": "broken", "repair": null}),
        });
    }
}

/// Only dictation evidence enters the same Tracker as external-app learning.
pub fn composer_params(params: Value) -> Result<Value, String> {
    let edits = params
        .get("edits")
        .and_then(Value::as_array)
        .filter(|edits| !edits.is_empty() && edits.len() <= 128)
        .ok_or("dictionary.correct needs bounded consecutive dictation edits")?;
    let first = edits[0]
        .get("before")
        .and_then(Value::as_str)
        .ok_or("missing before text")?;
    let mut tracker = crate::learn::corrections::Tracker::new(first, first);
    let mut previous = first;
    let mut total = 0;
    for edit in edits {
        let before = edit
            .get("before")
            .and_then(Value::as_str)
            .ok_or("missing before text")?;
        let after = edit
            .get("after")
            .and_then(Value::as_str)
            .ok_or("missing after text")?;
        total += before.chars().count() + after.chars().count();
        if before != previous
            || before.chars().count() > 20_000
            || after.chars().count() > 20_000
            || total > 256_000
        {
            return Err("dictation edits must be consecutive and bounded".into());
        }
        tracker = tracker.map(|tracker| tracker.advanced(after));
        previous = after;
    }
    let corrections = tracker
        .map(|tracker| tracker.corrections())
        .unwrap_or_default();
    Ok(
        json!({"undoable": true, "corrections": corrections.iter().map(|c| json!({"word": c.word, "misheard": c.misheard})).collect::<Vec<_>>()}),
    )
}

#[tauri::command]
pub fn learned_subscribe(
    app: AppHandle,
    webview: Webview,
    channel: Channel<Notice>,
) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    let state = app.state::<State>();
    let mut subscriber = state.channel.lock().unwrap_or_else(PoisonError::into_inner);
    *subscriber = Some(channel.clone());
    if let Some(notice) = state
        .current
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
    {
        channel.send(notice.clone()).map_err(|e| {
            crate::commands::tell_main_window(crate::commands::MainEvent::SetupMissing {
                missing: json!({"resource": "dictionary", "requirement": "learned", "state": "broken", "repair": null}),
            });
            e.to_string()
        })?;
    }
    Ok(())
}

/// The pill stands this far above the taskbar, in logical pixels.
const BOTTOM_GAP: f64 = 16.0;

/// Where the pill goes, in physical pixels: centred across the work area (the screen without the
/// taskbar) and `BOTTOM_GAP` above its bottom edge, so it sits just above the middle of the taskbar.
fn place(work: crate::overlay::Rect, w: u32, h: u32, scale: f64) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        work.x + (work.w - w as i32) / 2,
        work.y + work.h - h as i32 - (BOTTOM_GAP * scale).round() as i32,
    )
}

#[tauri::command]
pub fn learned_layout(
    app: AppHandle,
    webview: Webview,
    token: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    if !width.is_finite()
        || !height.is_finite()
        || !(40.0..=680.0).contains(&width)
        || !(32.0..=160.0).contains(&height)
    {
        return Err("invalid learned pill bounds".into());
    }
    let state = app.state::<State>();
    if !state
        .current
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .is_some_and(|n| n.token == token)
    {
        return Ok(());
    }
    let window = app
        .get_webview_window(LABEL)
        .ok_or("learned window is missing")?;
    let monitor = foreground_monitor(&app)
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or("no monitor")?;
    let work = crate::overlay::Rect::from(monitor.work_area());
    let scale = monitor.scale_factor();
    let bounds = crate::overlay::mouse::ControlRect {
        x: 0.0,
        y: 0.0,
        width,
        height,
    }
    .scaled(scale);
    let w = bounds.width.round().min(f64::from(work.w)) as u32;
    let h = bounds.height.round() as u32;
    window
        .set_size(PhysicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(place(work, w, h, scale))
        .map_err(|e| e.to_string())?;
    crate::overlay::apply_passive_style(&window);
    round_region(&window, w, h);
    Ok(())
}

#[tauri::command]
pub async fn learned_finish(
    app: AppHandle,
    webview: Webview,
    token: String,
    undo: bool,
) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    {
        let state = app.state::<State>();
        let current = state.current.lock().unwrap_or_else(PoisonError::into_inner);
        if !current.as_ref().is_some_and(|n| n.token == token) {
            return Ok(());
        }
    }
    if undo && !token.is_empty() {
        let core = app.state::<std::sync::Arc<CoreProcess>>();
        core.call("dictionary.undo", json!({"token": token}))
            .await
            .map_err(|e| e.to_string())?;
    }
    let state = app.state::<State>();
    let mut current = state.current.lock().unwrap_or_else(PoisonError::into_inner);
    if current.as_ref().is_some_and(|n| n.token == token) {
        *current = None;
        if let Some(mouse) = app.state::<crate::overlay::mouse::Windows>().get(LABEL) {
            mouse.clear();
        }
    }
    Ok(())
}

fn foreground_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::RECT,
            UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect},
        };
        let mut rect = RECT::default();
        // SAFETY: a short-lived foreground HWND and a writable stack rectangle.
        unsafe { GetWindowRect(GetForegroundWindow(), &mut rect) }.ok()?;
        let (x, y) = ((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
        app.available_monitors().ok()?.into_iter().find(|monitor| {
            let p = monitor.position();
            let s = monitor.size();
            x >= p.x && y >= p.y && x < p.x + s.width as i32 && y < p.y + s.height as i32
        })
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

fn round_region(window: &tauri::WebviewWindow, width: u32, height: u32) {
    #[cfg(windows)]
    {
        use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn};
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || unsafe {
            // SAFETY: this runs on the owning window thread. Windows owns a successfully set region.
            let region = CreateRoundRectRgn(
                0,
                0,
                width as i32 + 1,
                height as i32 + 1,
                height as i32,
                height as i32,
            );
            if SetWindowRgn(
                windows::Win32::Foundation::HWND(hwnd as *mut _),
                Some(region),
                true,
            ) == 0
            {
                let _ = DeleteObject(region.into());
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (window, width, height);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay::Rect;
    #[test]
    fn the_pill_sits_centred_just_above_the_taskbar_of_its_screen() {
        let work = Rect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1032,
        };
        assert_eq!(place(work, 300, 48, 1.0), PhysicalPosition::new(810, 968));
        let scaled = Rect {
            x: 0,
            y: 0,
            w: 2880,
            h: 1548,
        };
        assert_eq!(
            place(scaled, 450, 72, 1.5),
            PhysicalPosition::new(1215, 1452)
        );
        let left = Rect {
            x: -1920,
            y: 120,
            w: 1920,
            h: 1032,
        };
        assert_eq!(
            place(left, 300, 48, 1.0),
            PhysicalPosition::new(-1110, 1088)
        );
    }
    #[test]
    fn composer_uses_the_external_dictation_tracker() {
        let before = "Please ask Allice to review the next release notes carefully.";
        let after = before.replace("Allice", "Alice");
        assert_eq!(
            composer_params(json!({"edits": [{"before": before, "after": after}]})).unwrap(),
            json!({"undoable": true, "corrections": [{"word": "Alice", "misheard": "Allice"}]})
        );
        let before = "Please ask Allice and Cloude to review the next release notes carefully.";
        let middle = before.replace("Allice", "Alice");
        let after = middle.replace("Cloude", "Claude");
        assert_eq!(composer_params(json!({"edits": [{"before": before, "after": middle}, {"before": middle, "after": after}]})).unwrap(),
            json!({"undoable": true, "corrections": [{"word": "Alice", "misheard": "Allice"}, {"word": "Claude", "misheard": "Cloude"}]}));
        assert!(composer_params(json!({"edits": [{"before": before, "after": middle}, {"before": before, "after": after}]})).is_err());
        assert!(composer_params(json!({"edits": []})).is_err());
        assert!(
            composer_params(json!({"edits": [{"before": "x", "after": "x".repeat(20_001)}]}))
                .is_err()
        );
    }
}
