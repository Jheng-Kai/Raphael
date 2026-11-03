use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{PhysicalPosition, WebviewWindow};

fn client_point(cursor: PhysicalPosition<f64>, origin: PhysicalPosition<i32>) -> (f64, f64) {
    (
        cursor.x - f64::from(origin.x),
        cursor.y - f64::from(origin.y),
    )
}

#[derive(Clone, Debug, Deserialize)]
pub struct ControlRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ControlRect {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|n| n.is_finite() && n.abs() <= 1_000_000.0)
            && self.width > 0.0
            && self.height > 0.0
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        self.valid()
            && x >= self.x
            && y >= self.y
            && x < self.x + self.width
            && y < self.y + self.height
    }

    pub(crate) fn scaled(&self, scale: f64) -> Self {
        Self {
            x: self.x * scale,
            y: self.y * scale,
            width: self.width * scale,
            height: self.height * scale,
        }
    }
}

#[derive(Default)]
struct Regions {
    revision: u64,
    rects: Vec<ControlRect>,
    held: bool,
    clicks: bool,
    running: bool,
}

impl Regions {
    fn takes(&self, point: Option<(f64, f64)>) -> bool {
        !self.rects.is_empty()
            && (self.held
                || point.is_some_and(|(x, y)| self.rects.iter().any(|r| r.contains(x, y))))
    }

    fn report(&mut self, revision: u64, rects: Vec<ControlRect>, held: bool) -> bool {
        if revision != self.revision {
            return false;
        }
        self.rects = rects;
        self.held = held && !self.rects.is_empty();
        true
    }

    fn clear(&mut self) -> u64 {
        self.revision += 1;
        self.rects.clear();
        self.held = false;
        self.revision
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

struct ClickChange {
    serial: Arc<AtomicU64>,
    value: u64,
    on: bool,
}

impl ClickChange {
    fn new(serial: &Arc<AtomicU64>, on: bool) -> Self {
        Self {
            serial: serial.clone(),
            value: serial.fetch_add(1, Ordering::SeqCst) + 1,
            on,
        }
    }

    fn current(&self) -> Option<bool> {
        (self.serial.load(Ordering::SeqCst) == self.value).then_some(self.on)
    }
}

#[derive(Default)]
pub(crate) struct Windows(Mutex<HashMap<String, Arc<Mouse>>>);

impl Windows {
    pub(crate) fn register(&self, window: &WebviewWindow) -> Arc<Mouse> {
        let mouse = Arc::new(Mouse {
            window: window.clone(),
            state: Mutex::new(Regions::default()),
            changes: Arc::new(AtomicU64::new(0)),
            origin: Mutex::new(window.inner_position().ok()),
        });
        let weak = Arc::downgrade(&mouse);
        window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) && let Some(mouse) = weak.upgrade()
            {
                let origin = mouse.window.inner_position().ok();
                *lock(&mouse.origin) = origin;
            }
        });
        lock(&self.0).insert(window.label().to_owned(), mouse.clone());
        mouse
    }

    pub(crate) fn get(&self, label: &str) -> Option<Arc<Mouse>> {
        lock(&self.0).get(label).cloned()
    }
}

/// No worker exists while there are no controls. A worker only reads the cursor, never hooks it.
pub(crate) struct Mouse {
    window: WebviewWindow,
    state: Mutex<Regions>,
    changes: Arc<AtomicU64>,
    origin: Mutex<Option<PhysicalPosition<i32>>>,
}

impl Mouse {
    pub(crate) fn clear(&self) -> u64 {
        let mut state = lock(&self.state);
        let revision = state.clear();
        self.set_clicks(&mut state, false);
        revision
    }

    pub(crate) fn report(
        self: &Arc<Self>,
        revision: u64,
        rects: Vec<ControlRect>,
        held: bool,
    ) -> Result<(), String> {
        if rects.len() > 64 || rects.iter().any(|r| !r.valid()) {
            return Err("invalid floating control bounds".into());
        }
        let mut state = lock(&self.state);
        if !state.report(revision, rects, held) {
            return Ok(());
        }
        if state.rects.is_empty() {
            self.set_clicks(&mut state, false);
        } else if !state.running {
            state.running = true;
            let weak = Arc::downgrade(self);
            if let Err(error) = std::thread::Builder::new()
                .name("floating-mouse".into())
                .spawn(move || {
                    while let Some(mouse) = weak.upgrade() {
                        if !mouse.tick() {
                            break;
                        }
                        drop(mouse);
                        std::thread::sleep(Duration::from_millis(30));
                    }
                })
            {
                state.running = false;
                state.clear();
                self.set_clicks(&mut state, false);
                return Err(error.to_string());
            }
        }
        Ok(())
    }

    fn tick(&self) -> bool {
        {
            let mut state = lock(&self.state);
            if state.rects.is_empty() {
                state.running = false;
                return false;
            }
        }
        let point = cursor_position(&self.window)
            .zip(*lock(&self.origin))
            .map(|(cursor, origin)| client_point(cursor, origin));
        let mut state = lock(&self.state);
        if state.rects.is_empty() {
            state.running = false;
            self.set_clicks(&mut state, false);
            return false;
        }
        let on = state.takes(point);
        self.set_clicks(&mut state, on);
        true
    }

    fn set_clicks(&self, state: &mut Regions, on: bool) {
        if state.clicks == on {
            return;
        }
        let change = ClickChange::new(&self.changes, on);
        let window = self.window.clone();
        // A UI-thread hide may run before an older worker task reaches that thread.
        match self.window.run_on_main_thread(move || {
            if let Some(on) = change.current() {
                match window.set_ignore_cursor_events(!on) {
                    Ok(()) => super::apply_passive_style(&window),
                    Err(error) => {
                        log::warn!("could not change floating window mouse handling: {error}")
                    }
                }
            }
        }) {
            Ok(()) => state.clicks = on,
            Err(error) => log::warn!("could not dispatch floating window mouse handling: {error}"),
        }
    }
}

fn cursor_position(window: &WebviewWindow) -> Option<PhysicalPosition<f64>> {
    #[cfg(windows)]
    {
        use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
        let _ = window;
        let mut point = POINT::default();
        // SAFETY: GetCursorPos writes one live POINT and can run off the window thread.
        unsafe { GetCursorPos(&mut point) }.ok()?;
        Some(PhysicalPosition::new(f64::from(point.x), f64::from(point.y)))
    }
    #[cfg(not(windows))]
    window.cursor_position().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_enable_cannot_overtake_a_hide_on_the_ui_thread() {
        let serial = Arc::new(AtomicU64::new(0));
        let enter = ClickChange::new(&serial, true);
        let hide = ClickChange::new(&serial, false);
        // An IPC handler can run the hide before an older queued UI task is dispatched.
        assert_eq!(hide.current(), Some(false));
        assert_eq!(enter.current(), None);
        let next_button = ClickChange::new(&serial, true);
        assert_eq!(hide.current(), None);
        assert_eq!(next_button.current(), Some(true));
    }

    fn button() -> ControlRect {
        ControlRect {
            x: 10.0,
            y: 20.0,
            width: 60.0,
            height: 24.0,
        }
    }

    #[test]
    fn only_control_pixels_take_the_mouse_and_edges_are_half_open() {
        let state = Regions {
            rects: vec![
                button(),
                ControlRect {
                    x: 100.0,
                    ..button()
                },
            ],
            ..Regions::default()
        };
        for (point, expected) in [
            ((10.0, 20.0), true),
            ((69.9, 43.9), true),
            ((70.0, 30.0), false),
            ((20.0, 44.0), false),
            ((9.9, 20.0), false),
            ((99.9, 30.0), false),
            ((100.0, 30.0), true),
        ] {
            assert_eq!(state.takes(Some(point)), expected);
        }
        assert!(!state.takes(None));
        assert!(!Regions::default().takes(Some((20.0, 30.0))));
    }

    #[test]
    fn holding_survives_leaving_but_hide_and_stale_reports_cannot_keep_it() {
        let mut state = Regions::default();
        assert!(state.report(0, vec![button()], true));
        assert!(state.takes(Some((500.0, 500.0))));
        assert!(state.report(0, vec![button()], false));
        assert!(!state.takes(Some((500.0, 500.0))));
        state.report(0, vec![button()], true);
        assert_eq!(state.clear(), 1);
        assert!(!state.held);
        assert!(!state.takes(Some((20.0, 30.0))));
        assert!(!state.report(0, vec![button()], true));
        state.report(1, Vec::new(), true);
        assert!(!state.takes(Some((20.0, 30.0))));
    }

    #[test]
    fn physical_bounds_follow_scale_and_negative_monitor_origins() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let rect = button().scaled(scale);
            assert!(rect.contains(10.0 * scale, 20.0 * scale));
            assert!(!rect.contains(70.0 * scale, 30.0 * scale));
        }
        let rect = button().scaled(1.5);
        assert!(rect.contains(15.0, 30.0));
        assert!(!rect.contains(105.0, 30.0));
        let state = Regions {
            rects: vec![rect],
            ..Regions::default()
        };
        assert!(state.takes(Some(client_point(
            PhysicalPosition::new(-1900.0, 150.0),
            PhysicalPosition::new(-1920, 120),
        ))));
        assert!(
            !ControlRect {
                width: f64::NAN,
                ..button()
            }
            .valid()
        );
        assert!(
            !ControlRect {
                height: -1.0,
                ..button()
            }
            .valid()
        );
    }
}
