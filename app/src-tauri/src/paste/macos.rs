//! [`MacPaster`]: finds the focused window, and pastes into it on macOS.
//!
//! Each paste runs on a thread of its own: snapshot the person's pasteboard, offer the text, check
//! the focus once more, send ⌘V (the key that types "v" on the current layout, so that Dvorak and
//! AZERTY get ⌘V too), then wait for the target to read the text and put the person's pasteboard
//! back. If the focus check says not to paste, the text stays on the pasteboard.
//!
//! A target is the window that has the keyboard focus: its window server number (`hwnd`), the
//! process that owns it and the app's bundle identifier (`process_name`). Every app on macOS
//! pastes with ⌘V, terminals included, so the chord does not depend on the app. There is no
//! elevated window on macOS; an app that the accessibility API cannot see (no permission yet) gives
//! no target, and the text is then left on the pasteboard.

use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use super::{
    COPY_POLL, COPY_WAIT, Decision, PasteDelivery, PasteOutcome, PasteReceipt, Paster, Selection,
    Target, changed_within, decide,
};
use crate::macos::pasteboard::{self, Session};
use crate::macos::{ax, keys, workspace};

/// How long ⌘ stays down after the V click.
const CHORD_HOLD: Duration = Duration::from_millis(40);

/// One paste at a time: a second paste while the first waits would snapshot the first one's
/// text as the person's clipboard.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// The [`Paster`] for macOS.
#[derive(Default)]
pub struct MacPaster;

impl MacPaster {
    pub fn new() -> Self {
        Self
    }
}

impl Paster for MacPaster {
    fn foreground(&self) -> Option<Target> {
        foreground_target()
    }

    fn deliver(&self, text: &str, at_stop: Option<&Target>) -> PasteOutcome {
        self.deliver_with_receipt(text, at_stop).outcome
    }

    fn deliver_with_receipt(&self, text: &str, at_stop: Option<&Target>) -> PasteDelivery {
        let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(PoisonError::into_inner);
        let (text, target) = (text.to_owned(), at_stop.cloned());
        let worker = thread::Builder::new()
            .name("raphael-paste".to_owned())
            .spawn(move || paste(&text, target.as_ref()));
        let failure = match worker.map(thread::JoinHandle::join) {
            Ok(Ok(delivery)) => return delivery,
            Ok(Err(_)) => "the paste thread panicked".to_owned(),
            Err(e) => format!("could not start the paste thread: {e}"),
        };
        log::error!("paste: {failure}");
        PasteDelivery {
            outcome: outcome_of(decide(at_stop, foreground_target().as_ref(), false)),
            receipt: None,
        }
    }

    fn copy_selection(&self, at_key: Option<&Target>) -> Selection {
        let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(PoisonError::into_inner);
        let target = at_key.cloned();
        let worker = thread::Builder::new()
            .name("raphael-copy".to_owned())
            .spawn(move || copy(target.as_ref()));
        match worker.map(thread::JoinHandle::join) {
            Ok(Ok(selection)) => selection,
            Ok(Err(_)) => {
                log::error!("copy: the copy thread panicked");
                Selection::Failed
            }
            Err(e) => {
                log::error!("copy: could not start the copy thread: {e}");
                Selection::Failed
            }
        }
    }

    fn refocus(&self, target: &Target) -> bool {
        let activated = workspace::activate(target.pid as i32);
        // Raise the very window, not only the app's front one.
        if let Some(window) = window_of(target) {
            let _ = window.perform("AXRaise");
            let _ = window.set_bool("AXMain", true);
        }
        activated
    }
}

/// One paste, on the current thread.
fn paste(text: &str, at_stop: Option<&Target>) -> PasteDelivery {
    let session =
        Session::begin().and_then(|mut session| session.publish_text(text).map(|()| session));
    // Decided once the text is on the pasteboard: as late as possible before the chord.
    let decision = decide(at_stop, foreground_target().as_ref(), false);
    let session = match session {
        Ok(session) => session,
        Err(e) => {
            log::error!("paste: could not use the clipboard: {e}");
            return PasteDelivery {
                outcome: outcome_of(decision),
                receipt: None,
            };
        }
    };
    let receipt = match decision {
        Decision::Paste(_) => {
            let program = at_stop.map_or("", |target| target.process_name.as_str());
            log::info!("paste: ⌘V into {program}");
            let receipt = PasteReceipt::new();
            let v = keys::key_for('v').unwrap_or(keys::code::ANSI_V);
            let chord_sent = keys::chord(&[keys::Modifier::Command], v, || {
                thread::sleep(CHORD_HOLD);
            });
            session.wait_and_restore(chord_sent);
            chord_sent.then_some(receipt)
        }
        Decision::CopyOnly(reason) => {
            log::info!("paste: not pasting ({reason:?}); the text stays on the clipboard");
            session.keep();
            None
        }
    };
    PasteDelivery {
        outcome: outcome_of(decision),
        receipt,
    }
}

/// One copy of the selection, on the current thread: snapshot the person's pasteboard, send ⌘C
/// (the key that types "c" on the layout; every app copies with it on macOS, terminals included),
/// read the text that appears, and put the snapshot back. Nothing is sent to a window that no
/// longer has the focus. The posted chord carries ⌘ alone, so the Right Option still held for the
/// tidy key does not reach the app as ⌥⌘C.
fn copy(at_key: Option<&Target>) -> Selection {
    if let Decision::CopyOnly(reason) = decide(at_key, foreground_target().as_ref(), false) {
        log::info!("copy: not copying ({reason:?})");
        return Selection::Refused(reason);
    }
    let session = match Session::begin() {
        Ok(session) => session,
        Err(e) => {
            log::error!("copy: could not use the clipboard: {e}");
            return Selection::Failed;
        }
    };
    let count = || pasteboard::current_change_count() as u32;
    let before = count();
    let program = at_key.map_or("", |target| target.process_name.as_str());
    log::info!("copy: ⌘C in {program}");
    let c = keys::key_for('c').unwrap_or(keys::code::ANSI_C);
    if !keys::chord(&[keys::Modifier::Command], c, || thread::sleep(CHORD_HOLD)) {
        return Selection::Failed;
    }
    if !changed_within(before, COPY_WAIT, COPY_POLL, count, thread::sleep) {
        // Nothing was selected: the app wrote nothing, so the clipboard is as it was.
        log::info!("copy: the clipboard did not change; nothing is selected");
        return Selection::Nothing;
    }
    let text = pasteboard::text();
    // Whatever the app put there is replaced by what was there before.
    session.restore();
    match text {
        Some(text) if !text.trim().is_empty() => {
            Selection::Text(text.replace("\r\n", "\n").replace('\r', "\n"))
        }
        _ => {
            log::info!("copy: the program copied no text");
            Selection::Nothing
        }
    }
}

fn outcome_of(decision: Decision) -> PasteOutcome {
    match decision {
        Decision::Paste(_) => PasteOutcome::Pasted,
        Decision::CopyOnly(reason) => PasteOutcome::CopiedOnly(reason),
    }
}

/// The accessibility element of the target's window.
fn window_of(target: &Target) -> Option<ax::Element> {
    let app = ax::Element::application(target.pid as i32)?;
    app.elements("AXWindows")
        .into_iter()
        .find(|window| window.window_id().map(i64::from) == Some(target.hwnd as i64))
}

/// The window that has the keyboard focus now, with its app.
pub(crate) fn foreground_target() -> Option<Target> {
    let pid = workspace::frontmost_pid()?;
    if pid <= 0 {
        return None;
    }
    // The window server number of the focused window; an app without one (or whose windows the
    // accessibility API cannot see) is named by its process, so that a later focus check still
    // compares like with like.
    let hwnd = ax::focused_window(pid)
        .and_then(|window| window.window_id())
        .map_or(-(pid as isize), |id| id as isize);
    let process_name = describe_process(pid as u32).0;
    Some(Target {
        hwnd,
        pid: pid as u32,
        process_name,
        is_elevated: false,
    })
}

/// A process's app identifier (its bundle identifier, lowercased) and whether it is out of reach
/// (never on macOS: there are no elevated windows).
pub(crate) fn describe_process(pid: u32) -> (String, bool) {
    let id = workspace::app(pid as i32)
        .map(|app| app.id)
        .unwrap_or_default();
    (id, false)
}
