//! The card that stands under System Settings while the owner gives Raphael a privacy permission whose
//! list takes apps (R-PRIV-AX-02). The Accessibility note's button opens the pane and this card: the
//! app's own icon on it, dragged into the list, adds the very app that runs, and the card says to turn
//! its switch on. Without it the owner looks for Raphael in a long list, or adds it with + from
//! Applications.
//!
//! - It follows System Settings' window: under its bottom edge at the right, or inside the window's
//!   bottom where the screen ends first. It is shown only while System Settings (or the password
//!   prompt it asks for) is in front, and hidden while its window is not on screen.
//! - It goes when the permission is on, when System Settings quits or never opens, when its × is
//!   pressed, after ten minutes, and when a new guide replaces it. Its window is hidden then and kept
//!   for the next guide, and every change of that window is made on the main thread, checked against
//!   the guide still there ([`on_main`]).
//! - It is a non-activating panel (`overlay::apply_passive_style`): a press on it never brings Raphael
//!   forward, and System Settings stays in front for the drop. The drag itself is AppKit's
//!   (`macos::guide`), from the tile the page reports.
//! - A Raphael run outside an app bundle (a development run) opens the pane alone: it has no app to
//!   drag.

// Windows and Linux have no System Settings: there the module is its commands' refusals alone.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Webview, ipc::Channel};

const LABEL: &str = "permission-guide";
/// How often the card looks at System Settings and the permission.
const POLL: Duration = Duration::from_millis(250);
/// The card goes after this long, whatever happened.
const LIFETIME: Duration = Duration::from_secs(10 * 60);
/// System Settings has this long to open after the pane was asked for.
const LAUNCH: Duration = Duration::from_secs(15);
/// The card stands this far under System Settings' window, in points.
const GAP: f64 = 8.0;
/// The card keeps this far from the window's right edge, and from its bottom when it is inside it.
const INSET: f64 = 16.0;

/// The panes of System Settings whose lists take an app dragged into them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pane {
    Accessibility,
}

impl Pane {
    pub fn named(name: &str) -> Option<Self> {
        match name {
            "accessibility" => Some(Self::Accessibility),
            _ => None,
        }
    }

    /// The pane's address, one of the links the main window may open (`commands::OPENABLE_LINKS`).
    pub fn link(self) -> &'static str {
        match self {
            Self::Accessibility => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
        }
    }

    /// Whether the app has the permission now, read without asking.
    #[cfg(target_os = "macos")]
    fn allowed(self) -> bool {
        match self {
            Self::Accessibility => crate::macos::permissions::accessibility(false),
        }
    }
}

/// A rectangle in points (logical pixels).
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// What the page draws: the app's name as System Settings lists it, in the owner's language and theme.
#[derive(Clone, Debug, Serialize)]
pub struct Shown {
    revision: u64,
    name: String,
    language: String,
    theme: String,
}

struct Guide {
    shown: Shown,
    pane: Pane,
    since: Instant,
    /// The card's size, once the page measured it.
    size: Option<(f64, f64)>,
    /// Where the card was put last, while it is shown.
    placed: Option<(f64, f64)>,
    /// Where the app tile is in the card, once the page measured it. Kept here, not only in the drag's
    /// target: the page's one measure may come before the drags are watched, and must not be lost.
    tile: Option<Rect>,
}

struct State {
    guide: Option<Guide>,
    channel: Option<Channel<Shown>>,
    revision: u64,
    watching: bool,
}

static STATE: Mutex<State> = Mutex::new(State {
    guide: None,
    channel: None,
    revision: 0,
    watching: false,
});

fn state() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What the card saw of System Settings while it runs.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Present {
    /// Its front window on screen.
    window: Option<Rect>,
    /// Whether it (or the password prompt it asked for) is in front.
    in_front: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Seen {
    allowed: bool,
    elapsed: Duration,
    settings: Option<Present>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Step {
    Finish,
    Hide,
    Place { x: f64, y: f64 },
}

/// What the card does after one look: go, hide, or stand at a place.
fn step(seen: &Seen, size: Option<(f64, f64)>, works: &[Rect]) -> Step {
    if seen.allowed || seen.elapsed >= LIFETIME {
        return Step::Finish;
    }
    let Some(settings) = seen.settings else {
        return if seen.elapsed >= LAUNCH {
            Step::Finish
        } else {
            Step::Hide
        };
    };
    match (settings.window, size) {
        (Some(window), Some(size)) if settings.in_front => {
            let (x, y) = place(window, works, size);
            Step::Place { x, y }
        }
        _ => Step::Hide,
    }
}

/// Where a card of `size` stands for System Settings' `window`: under its bottom edge at the right
/// (where the list is), or inside its bottom where the screen's work area ends first; centred under a
/// window narrower than the card; never off the work area the window is on.
fn place(window: Rect, works: &[Rect], (width, height): (f64, f64)) -> (f64, f64) {
    let (cx, cy) = (
        window.x + window.width / 2.0,
        window.y + window.height / 2.0,
    );
    let work = works
        .iter()
        .find(|work| work.contains(cx, cy))
        .or_else(|| works.first())
        .copied()
        .unwrap_or(Rect {
            height: window.height + GAP + height,
            ..window
        });
    let x = if width + 2.0 * INSET <= window.width {
        window.x + window.width - INSET - width
    } else {
        window.x + (window.width - width) / 2.0
    };
    let below = window.y + window.height + GAP;
    let y = if below + height <= work.y + work.height {
        below
    } else {
        window.y + window.height - INSET - height
    };
    (
        x.clamp(work.x, (work.x + work.width - width).max(work.x)),
        y.clamp(work.y, (work.y + work.height - height).max(work.y)),
    )
}

/// The main window's theme, which the card wears.
fn theme(app: &AppHandle) -> String {
    let dark = app
        .get_webview_window(crate::MAIN_WINDOW)
        .and_then(|window| window.theme().ok())
        .is_some_and(|theme| theme == tauri::Theme::Dark);
    if dark { "dark" } else { "light" }.to_owned()
}

/// Opens `pane` of System Settings and, on a Mac running from an app bundle, puts the card under it.
/// Whether the card is there (`false`: the pane alone).
#[tauri::command]
pub async fn permission_guide_open(
    app: AppHandle,
    webview: Webview,
    pane: String,
    language: String,
) -> Result<bool, String> {
    crate::commands::require_main(&webview)?;
    let pane = Pane::named(&pane).ok_or("that pane has no guide")?;
    #[cfg(target_os = "macos")]
    {
        crate::commands::launch_link(pane.link())?;
        Ok(show(&app, pane, &language))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, pane, language);
        Err("System Settings is a Mac's".to_owned())
    }
}

#[cfg(target_os = "macos")]
fn show(app: &AppHandle, pane: Pane, language: &str) -> bool {
    let Some(bundle) = crate::macos::guide::app_bundle() else {
        log::info!("permission guide: not running from an app bundle, the pane is opened alone");
        return false;
    };
    // Read before the state is held: the theme is asked of the main thread, which may be waiting for the state (a
    // press on the card's ×).
    let name = crate::macos::guide::display_name(&bundle);
    let theme = theme(app);
    let window = {
        let _one = BUILDING.lock().unwrap_or_else(PoisonError::into_inner);
        match app.get_webview_window(LABEL) {
            Some(window) => window,
            None => match build(app) {
                Ok(window) => window,
                Err(err) => {
                    log::warn!("permission guide: the card could not be made: {err}");
                    return false;
                }
            },
        }
    };
    let ns_window = match window.ns_window() {
        Ok(ns_window) => Some(ns_window as usize),
        Err(err) => {
            log::warn!("permission guide: no native window to drag from: {err}");
            None
        }
    };
    let (revision, heard) = {
        let mut state = state();
        state.revision += 1;
        let revision = state.revision;
        state.guide = Some(Guide {
            shown: Shown {
                revision,
                name,
                language: language.to_owned(),
                theme,
            },
            pane,
            since: Instant::now(),
            size: None,
            placed: None,
            tile: None,
        });
        (revision, current(&state))
    };
    tell(heard);
    // The tile is read when this runs, on the main thread, as the layout's is: whichever comes first, the drag
    // has the tile the page measured.
    on_main(app, Some(revision), move |_, guide| {
        if let Some(ns_window) = ns_window {
            let tile = guide.and_then(|guide| guide.tile).map(native);
            crate::macos::guide::watch_drags(ns_window as *mut std::ffi::c_void, bundle, tile);
        }
    });
    watch(app);
    true
}

/// One card window is made at a time: two guides asked for at once share it.
static BUILDING: Mutex<()> = Mutex::new(());

/// Runs `change` on the main thread while the guide of `revision` is still the one there (`None`: while no guide
/// is), with the card's window and that guide. Every change of the window goes through here, in the order asked
/// and checked when it runs, so a card closed and a new one opened at once never undo each other. The window is
/// kept for the next guide, hidden, never destroyed: a window destroyed late took the next guide's card with it.
/// Nothing calls this while holding the state: on the main thread it runs at once, and would wait for itself.
fn on_main(
    app: &AppHandle,
    revision: Option<u64>,
    change: impl FnOnce(&tauri::WebviewWindow, Option<&mut Guide>) + Send + 'static,
) {
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(LABEL) else {
            return;
        };
        let mut state = state();
        if state.guide.as_ref().map(|guide| guide.shown.revision) != revision {
            return;
        }
        change(&window, state.guide.as_mut());
    });
    if let Err(err) = queued {
        log::warn!("permission guide: the card's window could not be changed: {err}");
    }
}

#[cfg(target_os = "macos")]
fn build(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    // Its title is empty, as the other passive windows' are: a system that painted it would paint a
    // word the owner never chose.
    let window = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App("permission-guide.html".into()),
    )
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
    .inner_size(420.0, 120.0)
    .data_directory(crate::webview_data_dir(app)?)
    .build()?;
    crate::webview_power::low_memory(&window, true);
    crate::overlay::apply_passive_style(&window);
    Ok(window)
}

/// The guide there is and the page's channel, once it listens.
fn current(state: &State) -> Option<(Channel<Shown>, Shown)> {
    Some((state.channel.clone()?, state.guide.as_ref()?.shown.clone()))
}

/// Sends the page its guide, with the state no longer held.
fn tell(heard: Option<(Channel<Shown>, Shown)>) {
    if let Some((channel, shown)) = heard
        && let Err(err) = channel.send(shown)
    {
        log::warn!("permission guide: the card did not hear its guide: {err}");
    }
}

#[tauri::command]
pub fn permission_guide_subscribe(webview: Webview, channel: Channel<Shown>) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    let heard = {
        let mut state = state();
        state.channel = Some(channel);
        current(&state)
    };
    tell(heard);
    Ok(())
}

/// The page's measure of the card, and where its app tile is in it (points from its top left).
#[tauri::command]
pub fn permission_guide_layout(
    app: AppHandle,
    webview: Webview,
    revision: u64,
    width: f64,
    height: f64,
    tile: Rect,
) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    let finite = [width, height, tile.x, tile.y, tile.width, tile.height]
        .iter()
        .all(|value| value.is_finite());
    if !finite
        || !(200.0..=640.0).contains(&width)
        || !(48.0..=320.0).contains(&height)
        || tile.x < 0.0
        || tile.y < 0.0
        || tile.width <= 0.0
        || tile.height <= 0.0
        || tile.x + tile.width > width
        || tile.y + tile.height > height
    {
        return Err("invalid permission guide bounds".to_owned());
    }
    {
        let mut state = state();
        let Some(guide) = state
            .guide
            .as_mut()
            .filter(|guide| guide.shown.revision == revision)
        else {
            return Ok(());
        };
        guide.size = Some((width, height));
        guide.placed = None;
        guide.tile = Some(tile);
    }
    let window = app
        .get_webview_window(LABEL)
        .ok_or("the permission guide's window is missing")?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|err| err.to_string())?;
    #[cfg(target_os = "macos")]
    on_main(&app, Some(revision), |_, guide| {
        if let Some(tile) = guide.and_then(|guide| guide.tile) {
            crate::macos::guide::set_tile(native(tile));
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn native(rect: Rect) -> crate::macos::ffi::CGRect {
    use crate::macos::ffi::{CGPoint, CGRect, CGSize};
    CGRect {
        origin: CGPoint {
            x: rect.x,
            y: rect.y,
        },
        size: CGSize {
            width: rect.width,
            height: rect.height,
        },
    }
}

/// The card's ×.
#[tauri::command]
pub fn permission_guide_close(
    app: AppHandle,
    webview: Webview,
    revision: u64,
) -> Result<(), String> {
    crate::commands::ensure_caller(webview.label(), LABEL)?;
    finish(&app, Some(revision));
    Ok(())
}

/// Takes the card away: the guide of `revision`, or whatever guide there is. The window is hidden, and kept.
fn finish(app: &AppHandle, revision: Option<u64>) {
    {
        let mut state = state();
        let current = state.guide.as_ref().map(|guide| guide.shown.revision);
        if current.is_none() || revision.is_some_and(|revision| current != Some(revision)) {
            return;
        }
        state.guide = None;
    }
    // Only while no guide is there: one opened meanwhile has the window now.
    on_main(app, None, |window, _| {
        #[cfg(target_os = "macos")]
        crate::macos::guide::stop_drags();
        let _ = window.hide();
    });
}

/// Looks at System Settings and the permission while a guide is there, and puts the card where it goes.
#[cfg(target_os = "macos")]
fn watch(app: &AppHandle) {
    {
        let mut state = state();
        if state.watching {
            return;
        }
        state.watching = true;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(POLL);
            let (revision, pane, since, size) = {
                let mut state = state();
                let Some(guide) = state.guide.as_ref() else {
                    state.watching = false;
                    return;
                };
                (guide.shown.revision, guide.pane, guide.since, guide.size)
            };
            let seen = look(pane, since);
            match step(&seen, size, &work_areas(&app)) {
                Step::Finish => finish(&app, Some(revision)),
                Step::Hide => on_main(&app, Some(revision), |window, guide| {
                    if let Some(guide) = guide {
                        guide.placed = None;
                    }
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }),
                Step::Place { x, y } => on_main(&app, Some(revision), move |window, guide| {
                    let Some(guide) = guide else { return };
                    // Looked at again each time: a window hidden behind the card's back is shown again.
                    let visible = window.is_visible().unwrap_or(false);
                    if guide.placed == Some((x, y)) && visible {
                        return;
                    }
                    if let Err(err) = window.set_position(tauri::LogicalPosition::new(x, y)) {
                        log::warn!("permission guide: the card could not be moved: {err}");
                        return;
                    }
                    if !visible {
                        let _ = window.show();
                    }
                    guide.placed = Some((x, y));
                }),
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn look(pane: Pane, since: Instant) -> Seen {
    use crate::macos::guide;
    Seen {
        allowed: pane.allowed(),
        elapsed: since.elapsed(),
        settings: guide::settings_pid().map(|pid| Present {
            window: guide::front_window(pid).map(|frame| Rect {
                x: frame.origin.x,
                y: frame.origin.y,
                width: frame.size.width,
                height: frame.size.height,
            }),
            in_front: guide::in_front(pid),
        }),
    }
}

/// The screens' work areas (without the menu bar and the Dock), in points.
#[cfg(target_os = "macos")]
fn work_areas(app: &AppHandle) -> Vec<Rect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let position = area.position.to_logical::<f64>(scale);
            let size = area.size.to_logical::<f64>(scale);
            Rect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect {
        x: 0.0,
        y: 25.0,
        width: 1440.0,
        height: 850.0,
    };
    const SETTINGS: Rect = Rect {
        x: 300.0,
        y: 100.0,
        width: 720.0,
        height: 600.0,
    };
    const CARD: (f64, f64) = (420.0, 100.0);

    fn seen(settings: Option<Present>) -> Seen {
        Seen {
            allowed: false,
            elapsed: Duration::from_secs(2),
            settings,
        }
    }

    const FRONT: Present = Present {
        window: Some(SETTINGS),
        in_front: true,
    };

    #[test]
    fn the_card_stands_under_system_settings_at_the_right() {
        assert_eq!(
            place(SETTINGS, &[SCREEN], CARD),
            (300.0 + 720.0 - INSET - 420.0, 100.0 + 600.0 + GAP)
        );
    }

    #[test]
    fn where_the_screen_ends_first_the_card_stands_inside_the_windows_bottom() {
        // The window ends 75 points above the work area's bottom: too little for the card under it.
        let low = Rect {
            y: 200.0,
            ..SETTINGS
        };
        let (_, y) = place(low, &[SCREEN], CARD);
        assert_eq!(y, 200.0 + 600.0 - INSET - 100.0);
        assert!(y + CARD.1 <= SCREEN.y + SCREEN.height);
    }

    #[test]
    fn a_window_narrower_than_the_card_has_it_centred_and_never_off_the_screen() {
        let narrow = Rect {
            x: 100.0,
            width: 300.0,
            ..SETTINGS
        };
        assert_eq!(
            place(narrow, &[SCREEN], CARD).0,
            100.0 + (300.0 - 420.0) / 2.0
        );
        let left = Rect {
            x: -10.0,
            width: 300.0,
            ..SETTINGS
        };
        assert_eq!(place(left, &[SCREEN], CARD).0, 0.0);
    }

    #[test]
    fn the_card_goes_on_the_screen_system_settings_is_on() {
        let second = Rect {
            x: 1440.0,
            y: 0.0,
            width: 1920.0,
            height: 1050.0,
        };
        let there = Rect {
            x: 1600.0,
            ..SETTINGS
        };
        let (x, y) = place(there, &[SCREEN, second], CARD);
        assert!(second.contains(x, y));
        assert_eq!(y, 100.0 + 600.0 + GAP);
    }

    #[test]
    fn the_card_stands_only_while_system_settings_is_in_front_with_its_window_on_screen() {
        assert!(matches!(
            step(&seen(Some(FRONT)), Some(CARD), &[SCREEN]),
            Step::Place { .. }
        ));
        let behind = Present {
            in_front: false,
            ..FRONT
        };
        assert_eq!(step(&seen(Some(behind)), Some(CARD), &[SCREEN]), Step::Hide);
        let closed = Present {
            window: None,
            ..FRONT
        };
        assert_eq!(step(&seen(Some(closed)), Some(CARD), &[SCREEN]), Step::Hide);
        // Not measured yet: nowhere to put it.
        assert_eq!(step(&seen(Some(FRONT)), None, &[SCREEN]), Step::Hide);
    }

    #[test]
    fn the_card_goes_once_the_permission_is_on_system_settings_quits_or_time_is_up() {
        let allowed = Seen {
            allowed: true,
            ..seen(Some(FRONT))
        };
        assert_eq!(step(&allowed, Some(CARD), &[SCREEN]), Step::Finish);
        // System Settings is still opening.
        assert_eq!(step(&seen(None), Some(CARD), &[SCREEN]), Step::Hide);
        let gone = Seen {
            elapsed: LAUNCH,
            ..seen(None)
        };
        assert_eq!(step(&gone, Some(CARD), &[SCREEN]), Step::Finish);
        let old = Seen {
            elapsed: LIFETIME,
            ..seen(Some(FRONT))
        };
        assert_eq!(step(&old, Some(CARD), &[SCREEN]), Step::Finish);
    }

    #[test]
    fn each_pane_with_a_guide_is_a_link_the_main_window_may_open() {
        let commands = include_str!("commands.rs");
        let pane = Pane::named("accessibility").unwrap();
        assert!(commands.contains(&format!("\"{}\"", pane.link())));
        assert_eq!(Pane::named("microphone"), None);
    }

    #[test]
    fn the_cards_window_is_kept_and_changed_only_on_the_main_thread_for_the_guide_still_there() {
        // A late destroy took the next guide's card with it, and the theme read while the state was held could wait
        // forever for a main thread that waited for the state (a press on the ×).
        let source = include_str!("permission_guide.rs").replace("\r\n", "\n");
        let production = source.split("#[cfg(test)]\nmod tests").next().unwrap();
        let body = |name: &str| {
            production
                .split(&format!("fn {name}("))
                .nth(1)
                .and_then(|rest| rest.split("\n}\n").next())
                .unwrap()
                .to_owned()
        };
        assert!(!production.contains(".destroy()"));
        let show = body("show");
        assert!(show.find("theme(app)").unwrap() < show.find("state()").unwrap());
        assert!(
            show.find("tell(heard)").unwrap() > show.find("(revision, current(&state))").unwrap()
        );
        assert!(body("finish").contains("on_main(app, None,"));
        let watch = body("watch");
        assert!(!watch.contains("get_webview_window"));
        assert_eq!(watch.matches("on_main(&app, Some(revision)").count(), 2);
        let on_main = body("on_main");
        assert!(on_main.contains("!= revision"));
        // The page's one measure of the tile may come before the drags are watched: both read the guide's tile on the
        // main thread, so neither loses it.
        assert!(body("permission_guide_layout").contains("guide.tile = Some(tile);"));
        assert!(body("permission_guide_layout").contains("on_main(&app, Some(revision)"));
        assert!(show.contains("guide.and_then(|guide| guide.tile)"));
    }

    #[test]
    fn each_command_checks_its_caller() {
        let source = include_str!("permission_guide.rs").replace("\r\n", "\n");
        let production = source.split("#[cfg(test)]\nmod tests").next().unwrap();
        let commands: Vec<&str> = production.split("#[tauri::command]").skip(1).collect();
        assert_eq!(commands.len(), 4);
        for command in commands {
            let body = command.split("\n}\n").next().unwrap();
            if body.contains("fn permission_guide_open(") {
                assert!(body.contains("crate::commands::require_main(&webview)?"));
            } else {
                assert!(body.contains("crate::commands::ensure_caller(webview.label(), LABEL)?"));
            }
        }
    }
}
