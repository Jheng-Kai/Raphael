//! The field a dictation went into, read through the accessibility API of macOS: the
//! counterpart of the UI Automation probe on Windows.
//!
//! Only the element with the keyboard focus in the target's window is read, and only while it
//! keeps the focus: a password field (a secure text field) is never read, an element of another
//! window or app is not the field, and a field longer than [`MAX_CHARS`] is left alone. Chromium
//! browsers and Electron apps build their accessibility tree when a client first asks for it, so
//! they are asked to (`AXManualAccessibility`), and the focused element is looked for again a few
//! times within [`DISCOVERY_WINDOW`] while the tree stands up.
//!
//! A terminal's text is its whole screen and scrollback, which says nothing reliable about a
//! command line that was corrected or sent, so a terminal is not watched on macOS. A code editor
//! whose accessibility support is off shows an empty text area; the main window is told once, as
//! on Windows.
//!
//! Nothing here logs text: only stages and counts.

use std::thread;
use std::time::{Duration, Instant};

use super::apps::{AppKind, classify, editor_id};
use super::{FieldProbe, LimitReason, Snapshot, WatchScope, WatchedField, report_limited};
use crate::macos::{ax, workspace};
use crate::paste::Target;

/// The longest field that is watched, in characters.
const MAX_CHARS: usize = 20_000;
/// How long the focused element may take to be found after the paste.
const DISCOVERY_WINDOW: Duration = Duration::from_secs(1);
/// The pauses before the second, third and fourth attempt.
const DISCOVERY_PAUSES: [Duration; 3] = [
    Duration::from_millis(150),
    Duration::from_millis(250),
    Duration::from_millis(350),
];
/// The roles of the elements that hold editable text.
const TEXT_ROLES: [&str; 4] = ["AXTextArea", "AXTextField", "AXComboBox", "AXSearchField"];

/// The [`FieldProbe`] for macOS.
pub struct AxProbe;

impl FieldProbe for AxProbe {
    fn focused(&self, target: &Target) -> Option<Box<dyn WatchedField>> {
        discover(target, None).map(|field| Box::new(field) as Box<dyn WatchedField>)
    }

    fn after_paste(
        &self,
        target: &Target,
        _pasted: &str,
        scope: WatchScope,
    ) -> Option<Box<dyn WatchedField>> {
        if !scope.active() {
            return None;
        }
        discover(target, Some(&scope)).map(|field| Box::new(field) as Box<dyn WatchedField>)
    }
}

/// Why a discovery gave up, for the log.
fn stop<T>(stage: &'static str) -> Option<T> {
    log::info!("learn: no field to watch (stage: {stage})");
    None
}

fn discover(target: &Target, scope: Option<&WatchScope>) -> Option<AxField> {
    if !ax::trusted(false) {
        return stop("accessibility_not_allowed");
    }
    let kind = classify(&target.process_name);
    if kind == AppKind::Terminal {
        return stop("terminal");
    }
    let pid = target.pid as i32;
    let app = ax::Element::application(pid)?;
    if matches!(kind, AppKind::Chromium | AppKind::CodeEditor) {
        // Electron and Chromium build their tree for an assistive client that asks for it.
        let _ = app.set_bool("AXManualAccessibility", true);
    }
    let started = Instant::now();
    let mut pauses = DISCOVERY_PAUSES.iter();
    loop {
        if scope.is_some_and(|scope| !scope.active()) {
            return stop("watch_cancelled");
        }
        if workspace::frontmost_pid() != Some(pid) {
            return stop("target_changed_before_discovery");
        }
        match attempt(&app, target) {
            Ok(field) => {
                log::info!("learn: field probe (sources: 1, keyboard: false, terminal: false)");
                return Some(field);
            }
            Err(Attempt::Refused(stage)) => return stop(stage),
            Err(Attempt::NotYet(stage)) => {
                let Some(&pause) = pauses.next() else {
                    if stage == "empty_text"
                        && kind == AppKind::CodeEditor
                        && let Some(editor) = editor_id(&target.process_name)
                    {
                        report_limited(editor, LimitReason::AccessibilityOff);
                    }
                    return stop(stage);
                };
                if started.elapsed() + pause > DISCOVERY_WINDOW {
                    return stop(stage);
                }
                thread::sleep(pause);
            }
        }
    }
}

enum Attempt {
    /// Never tried again: a password field, another window, a field too long.
    Refused(&'static str),
    /// The tree may not stand yet.
    NotYet(&'static str),
}

fn attempt(app: &ax::Element, target: &Target) -> Result<AxField, Attempt> {
    let element = app
        .element("AXFocusedUIElement")
        .ok_or(Attempt::NotYet("no_focused_element"))?;
    if element.is_secure() {
        return Err(Attempt::Refused("password_field"));
    }
    if target.hwnd > 0 {
        let window = element
            .window()
            .and_then(|window| window.window_id())
            .ok_or(Attempt::NotYet("no_window"))?;
        if i64::from(window) != target.hwnd as i64 {
            return Err(Attempt::Refused("other_window"));
        }
    }
    let role = element.role();
    if !TEXT_ROLES.contains(&role.as_str()) && !element.is_settable("AXValue") {
        return Err(Attempt::NotYet("not_a_text_field"));
    }
    let text = element.text().ok_or(Attempt::NotYet("no_text"))?;
    if text.chars().count() > MAX_CHARS {
        return Err(Attempt::Refused("too_long"));
    }
    if text.is_empty() {
        return Err(Attempt::NotYet("empty_text"));
    }
    Ok(AxField {
        app: app.clone(),
        element,
        pid: target.pid as i32,
    })
}

/// The watched field: the element, in its app.
struct AxField {
    app: ax::Element,
    element: ax::Element,
    pid: i32,
}

impl WatchedField for AxField {
    fn read(&mut self) -> Snapshot {
        if workspace::frontmost_pid() != Some(self.pid) {
            return Snapshot::Left;
        }
        // The field must still have the focus: an element of the same text elsewhere is not it.
        let focused = self.app.element("AXFocusedUIElement");
        if focused.as_ref() != Some(&self.element) {
            return Snapshot::Left;
        }
        match self.element.text() {
            Some(text) if text.chars().count() <= MAX_CHARS => Snapshot::Text(text),
            _ => Snapshot::Left,
        }
    }
}
