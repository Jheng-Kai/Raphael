//! A content-sized, passive notification window. The ordinary overlay stays click-through.
use crate::core_process::{CoreApi, CoreProcess};
use crate::overlay::mouse::{ControlRect, Windows, cursor_position};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Webview, WebviewUrl, WebviewWindowBuilder,
    ipc::Channel,
};

const LABEL: &str = "learned";
/// The page fades its pill out in this long (`learned.css`, a little over it); the window goes after that, never before.
const FADE: Duration = Duration::from_millis(220);
const CURSOR_POLL: Duration = Duration::from_millis(30);

fn display_time(word_count: usize) -> Duration {
    Duration::from_secs(10 + 2 * word_count.saturating_sub(1) as u64)
}

struct Countdown {
    remaining: Duration,
    running_since: Option<Instant>,
}

impl Countdown {
    fn new(word_count: usize, now: Instant) -> Self {
        Self {
            remaining: display_time(word_count),
            running_since: Some(now),
        }
    }

    fn update(&mut self, now: Instant, paused: bool) -> bool {
        if let Some(since) = self.running_since {
            self.remaining = self.remaining.saturating_sub(now - since);
        }
        self.running_since = (!paused).then_some(now);
        self.remaining.is_zero() && !paused
    }
}

struct Batch {
    words: Vec<String>,
    token: Option<String>,
    language: String,
    theme: String,
}

struct Active {
    batch: Batch,
    revision: u64,
    countdown: Option<Countdown>,
    hover_bounds: Option<ControlRect>,
    undoing: bool,
    leaving: bool,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Show {
        revision: u64,
        words: Vec<String>,
        can_undo: bool,
        language: String,
        theme: String,
    },
    Dismiss {
        revision: u64,
    },
}

impl Active {
    fn event(&self) -> Event {
        if self.leaving {
            return Event::Dismiss {
                revision: self.revision,
            };
        }
        Event::Show {
            revision: self.revision,
            words: self.batch.words.clone(),
            can_undo: self.batch.token.is_some(),
            language: self.batch.language.clone(),
            theme: self.batch.theme.clone(),
        }
    }
}

#[derive(Default)]
struct Queue {
    pending: VecDeque<Batch>,
    current: Option<Active>,
    channel: Option<Channel<Event>>,
}

impl Queue {
    fn advance(&mut self, next_revision: impl FnOnce() -> u64) -> bool {
        if self.channel.is_none() || self.current.is_some() {
            return false;
        }
        let Some(batch) = self.pending.pop_front() else {
            return false;
        };
        self.current = Some(Active {
            batch,
            revision: next_revision(),
            countdown: None,
            hover_bounds: None,
            undoing: false,
            leaving: false,
        });
        true
    }

    fn active(&mut self, revision: u64) -> Option<&mut Active> {
        self.current
            .as_mut()
            .filter(|active| active.revision == revision && !active.leaving)
    }

    fn send_current(&mut self) -> Result<(), String> {
        if let (Some(channel), Some(active)) = (&self.channel, &self.current)
            && let Err(error) = channel.send(active.event())
        {
            self.channel = None;
            return Err(error.to_string());
        }
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct State(Mutex<Queue>);

fn queue(app: &AppHandle) -> MutexGuard<'_, Queue> {
    app.state::<State>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn send_current(queue: &mut Queue) -> Result<(), String> {
    queue.send_current().inspect_err(|error| {
        log::warn!("could not send learned pill event: {error}");
        crate::commands::tell_main_window(crate::commands::MainEvent::SetupMissing {
            missing: json!({"resource": "dictionary", "requirement": "learned", "state": "broken", "repair": null}),
        });
    })
}

/// Keep a saved batch until both the window and its subscriber are ready.
fn advance(app: &AppHandle, queue: &mut Queue) -> Result<(), String> {
    if let Some(mouse) = app.state::<Windows>().get(LABEL)
        && queue.advance(|| mouse.clear())
    {
        send_current(queue)?;
    }
    Ok(())
}

pub fn start(app: &AppHandle) -> tauri::Result<()> {
    // The window is there only while a notice is: it is made hidden and shown by the layout of a notice, and it goes
    // when the notice does (R-LEARN-WIN-02). Its title is empty: whatever a system painted of it would be a word the
    // owner never chose, in English under a Chinese interface.
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("learned.html".into()))
        .title("")
        .visible(false)
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
    app.state::<Windows>().register(&window);
    let _ = advance(app, &mut queue(app));
    Ok(())
}

pub fn publish(app: &AppHandle, words: &[String], undo: Option<&str>, language: &str) {
    if words.is_empty() {
        return;
    }
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
    let mut queue = queue(app);
    queue.pending.push_back(Batch {
        words: words.to_vec(),
        token: undo.filter(|token| !token.is_empty()).map(str::to_owned),
        language: language.to_owned(),
        theme,
    });
    let _ = advance(app, &mut queue);
}

/// Only bounded dictation evidence reaches the core, as the same revision external-app learning sends.
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
        previous = after;
    }
    Ok(
        json!({"undoable": true, "hold_undo": true, "revision": {"pasted": first, "sent": previous}}),
    )
}

#[tauri::command]
pub fn learned_subscribe(
    app: AppHandle,
    webview: Webview,
    channel: Channel<Event>,
) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    let mut queue = queue(&app);
    queue.channel = Some(channel);
    if queue.current.is_some() {
        send_current(&mut queue)
    } else {
        advance(&app, &mut queue)
    }
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
    revision: u64,
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
    if queue(&app).active(revision).is_none() {
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
    let bounds = ControlRect {
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
    let position = place(work, w, h, scale);
    window.set_position(position).map_err(|e| e.to_string())?;
    crate::overlay::apply_passive_style(&window);
    round_region(&window, w, h);

    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            let mut queue = queue(&app);
            let Some(active) = queue.active(revision) else {
                return;
            };
            active.hover_bounds = Some(ControlRect {
                x: f64::from(position.x),
                y: f64::from(position.y),
                width: f64::from(w),
                height: f64::from(h),
            });
            reveal(&handle);
            if active.countdown.is_none() {
                active.countdown = Some(Countdown::new(active.batch.words.len(), Instant::now()));
                drop(queue);
                watch_pointer(app, handle, revision);
            }
        })
        .map_err(|e| e.to_string())
}

/// Show the window on its owning thread without activating it.
fn reveal(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{SW_SHOWNOACTIVATE, ShowWindow};
        if let Ok(hwnd) = window.hwnd() {
            // SAFETY: this runs on the owning thread with a live window handle.
            unsafe {
                let _ = ShowWindow(windows::Win32::Foundation::HWND(hwnd.0), SW_SHOWNOACTIVATE);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window.show();
    }
}

/// Read the cursor independently of hit testing so the caption stays click-through.
fn watch_pointer(app: AppHandle, window: tauri::WebviewWindow, revision: u64) {
    tauri::async_runtime::spawn(async move {
        loop {
            let point = cursor_position(&window);
            {
                let mut queue = queue(&app);
                let Some(active) = queue.active(revision) else {
                    return;
                };
                let over_pill = point.is_some_and(|point| {
                    active
                        .hover_bounds
                        .as_ref()
                        .is_some_and(|rect| rect.contains(point.x, point.y))
                });
                let expired = active.countdown.as_mut().is_some_and(|countdown| {
                    countdown.update(Instant::now(), over_pill || active.undoing)
                });
                if expired {
                    dismiss(&app, &mut queue, revision, false);
                    return;
                }
            }
            tokio::time::sleep(CURSOR_POLL).await;
        }
    });
}

/// Clear hit testing immediately, then hide and advance only after the page has faded out.
fn dismiss(app: &AppHandle, state: &mut Queue, revision: u64, undone: bool) {
    let Some(active) = state.active(revision) else {
        return;
    };
    active.leaving = true;
    let discard = if undone {
        None
    } else {
        active.batch.token.take()
    };
    if let Some(mouse) = app.state::<Windows>().get(LABEL) {
        mouse.clear();
    }
    let _ = send_current(state);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FADE).await;
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let mut queue = queue(&handle);
            if let Some(window) = handle.get_webview_window(LABEL) {
                let _ = window.hide();
            }
            queue.current = None;
            let _ = advance(&handle, &mut queue);
        });
        if let Some(token) = discard {
            let core = app.state::<Arc<CoreProcess>>();
            if let Err(error) = core
                .call("dictionary.undo", json!({"token": token, "discard": true}))
                .await
            {
                log::warn!("could not release learned Undo: {error}");
            }
        }
    });
}

#[tauri::command]
pub async fn learned_finish(app: AppHandle, webview: Webview, revision: u64) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    let token = {
        let mut queue = queue(&app);
        let Some(active) = queue.active(revision).filter(|active| !active.undoing) else {
            return Ok(());
        };
        let Some(token) = active.batch.token.clone() else {
            return Ok(());
        };
        active.undoing = true;
        token
    };
    let core = app.state::<Arc<CoreProcess>>();
    let result = core.call("dictionary.undo", json!({"token": token})).await;
    let mut queue = queue(&app);
    match result {
        Ok(_) => {
            dismiss(&app, &mut queue, revision, true);
            Ok(())
        }
        Err(error) => {
            if let Some(active) = queue.active(revision) {
                active.undoing = false;
            }
            Err(error.to_string())
        }
    }
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
    #[cfg(target_os = "macos")]
    {
        // The focused window's frame from the accessibility API is in points from the top left
        // of the main display; each monitor is compared in its own points.
        let pid = crate::macos::workspace::frontmost_pid()?;
        let frame = crate::macos::ax::focused_window(pid)?.frame()?;
        let (x, y) = (
            frame.origin.x + frame.size.width / 2.0,
            frame.origin.y + frame.size.height / 2.0,
        );
        app.available_monitors().ok()?.into_iter().find(|monitor| {
            let scale = monitor.scale_factor();
            let p = monitor.position().to_logical::<f64>(scale);
            let s = monitor.size().to_logical::<f64>(scale);
            x >= p.x && y >= p.y && x < p.x + s.width && y < p.y + s.height
        })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
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
    #[cfg(target_os = "macos")]
    {
        // The panel has no shadow and a transparent background, so only the page's pill is
        // seen; its corners are rounded all the same, so that nothing square ever shows.
        let scale = window.scale_factor().unwrap_or(1.0);
        let _ = width;
        crate::macos::window::round_corners(window, f64::from(height) / scale / 2.0);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
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
    fn the_window_is_there_only_while_a_notice_is_and_has_no_title() {
        // R-LEARN-WIN-02: after Undo a pale bar with the English title stayed on the screen. The
        // window is made hidden and without a title, shown once a notice is placed, and taken away after its fade.
        let source = include_str!("learned.rs").replace("\r\n", "\n");
        let production = source.split("#[cfg(test)]").next().unwrap();
        let start = production.split("pub fn start(").nth(1).unwrap();
        let start = start.split("\npub fn ").next().unwrap();
        assert!(
            start.contains(".title(\"\")"),
            "no word of any language is its title"
        );
        assert!(
            start.contains(".visible(false)"),
            "it is hidden until a notice is placed"
        );
        assert!(!production.contains("Raphael learned word"));
        let layout = production.split("pub fn learned_layout(").nth(1).unwrap();
        let layout = layout.split("\n}\n").next().unwrap();
        assert!(
            layout.find("round_region(").unwrap() < layout.find("reveal(&handle)").unwrap(),
            "it is shown only after it is sized, placed and shaped"
        );
        let dismiss = production.split("fn dismiss(").nth(1).unwrap();
        let dismiss = dismiss.split("\n}\n").next().unwrap();
        assert!(
            dismiss.find("sleep(FADE)").unwrap() < dismiss.find(".hide()").unwrap()
                && dismiss.find(".hide()").unwrap() < dismiss.find("advance(").unwrap(),
            "the window hides after the fade and before the next notice"
        );
    }

    #[test]
    fn more_words_get_more_time_and_hover_preserves_the_remainder() {
        assert_eq!(display_time(1), Duration::from_secs(10));
        assert_eq!(display_time(2), Duration::from_secs(12));
        assert_eq!(display_time(3), Duration::from_secs(14));
        let start = Instant::now();
        let at = |seconds| start + Duration::from_secs(seconds);
        let mut countdown = Countdown::new(1, start);
        assert!(!countdown.update(at(3), true));
        assert!(!countdown.update(at(30), true));
        assert!(!countdown.update(at(31), false));
        assert!(!countdown.update(at(37), false));
        assert!(countdown.update(at(38), false));
    }

    #[test]
    fn batches_wait_for_a_subscriber_and_keep_their_own_full_time() {
        let batch = |word: &str| Batch {
            words: vec![word.to_owned()],
            token: Some(word.to_owned()),
            language: "en".to_owned(),
            theme: "dark".to_owned(),
        };
        let mut queue = Queue::default();
        queue.pending.push_back(batch("first"));
        assert!(!queue.advance(|| panic!("no subscriber")));
        let events = Arc::new(Mutex::new(Vec::new()));
        let received = events.clone();
        queue.channel = Some(Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                received
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str::<Value>(&json).unwrap());
            }
            Ok(())
        }));
        assert!(queue.advance(|| 1));
        queue.send_current().unwrap();
        queue.pending.push_back(batch("second"));
        assert!(!queue.advance(|| panic!("the first batch is still showing")));
        let now = Instant::now();
        let first = queue.active(1).unwrap();
        first.countdown = Some(Countdown::new(1, now));
        let countdown = first.countdown.as_mut().unwrap();
        assert!(!countdown.update(now + Duration::from_millis(9_999), false));
        assert!(countdown.update(now + Duration::from_secs(10), false));
        first.leaving = true;
        queue.send_current().unwrap();
        assert!(!queue.advance(|| panic!("the first batch is still fading")));
        queue.current = None;
        assert!(queue.advance(|| 2));
        queue.send_current().unwrap();
        assert!(queue.active(1).is_none());
        assert!(
            queue.active(2).unwrap().countdown.is_none(),
            "no time has elapsed before layout"
        );
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0]["words"], json!(["first"]));
        assert_eq!(events[1], json!({"type": "dismiss", "revision": 1}));
        assert_eq!(events[2]["words"], json!(["second"]));
    }

    #[test]
    fn a_failed_delivery_keeps_the_saved_notice_for_the_next_subscriber() {
        let mut queue = Queue {
            channel: Some(Channel::new(|_| {
                Err(tauri::Error::AssetNotFound("learned.html".into()))
            })),
            ..Queue::default()
        };
        queue.pending.push_back(Batch {
            words: vec!["Composio".to_owned()],
            token: Some("batch".to_owned()),
            language: "en".to_owned(),
            theme: "light".to_owned(),
        });
        assert!(queue.advance(|| 1));
        assert!(queue.send_current().is_err());
        assert!(queue.channel.is_none());
        let delivered = Arc::new(Mutex::new(Vec::new()));
        let received = delivered.clone();
        queue.channel = Some(Channel::new(move |body| {
            received.lock().unwrap().push(body);
            Ok(())
        }));
        queue.send_current().unwrap();
        assert_eq!(delivered.lock().unwrap().len(), 1);
        let notice = queue.active(1).unwrap();
        assert_eq!(notice.batch.words, ["Composio"]);
        assert!(notice.countdown.is_none());
    }

    #[test]
    fn composer_sends_the_dictated_text_as_first_dictated_and_as_last_edited() {
        let before = "Please ask Allice and Cloude to review the next release notes carefully.";
        let middle = before.replace("Allice", "Alice");
        let after = middle.replace("Cloude", "Claude");
        assert_eq!(
            composer_params(json!({"edits": [{"before": before, "after": middle}]})).unwrap(),
            json!({"undoable": true, "hold_undo": true, "revision": {"pasted": before, "sent": middle}})
        );
        assert_eq!(
            composer_params(json!({"edits": [{"before": before, "after": middle}, {"before": middle, "after": after}]})).unwrap(),
            json!({"undoable": true, "hold_undo": true, "revision": {"pasted": before, "sent": after}})
        );
        assert!(composer_params(json!({"edits": [{"before": before, "after": middle}, {"before": before, "after": after}]})).is_err());
        assert!(composer_params(json!({"edits": []})).is_err());
        assert!(
            composer_params(json!({"edits": [{"before": "x", "after": "x".repeat(20_001)}]}))
                .is_err()
        );
    }
}
