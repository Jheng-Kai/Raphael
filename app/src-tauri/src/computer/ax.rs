//! The desktop on macOS: the accessibility API to read windows and act on their elements, posted
//! keys and clicks where an element offers nothing for what is wanted. The counterpart of
//! `uia.rs`, with the same order of means and the same checks.
//!
//! Every accessibility call goes to the app that owns the element, so the desktop's work runs on
//! one thread of its own ([`AxDesktop`]), each element with a short messaging timeout
//! (`macos::ax::TIMEOUT_S`); the rest of the app hands it jobs and waits for each, for a bounded
//! time.
//!
//! - The listing asks every ordinary app (`NSApplicationActivationPolicyRegular`) for its windows
//!   (`AXWindows`), keeps the standard windows and dialogs that have a title, and puts the ones on
//!   screen first in the window server's order (`CGWindowListCopyWindowInfo`, front first); the
//!   minimized and hidden ones follow, as Windows lists iconic windows too. A window's id is its
//!   window server number. An app is known by its bundle identifier in lower case
//!   (`com.apple.textedit`), as the always-allowed list keeps it, and goes by its localized name.
//!   Raphael's own windows are never asked about (its own main thread answers them), and the
//!   system's own processes (the Dock, the menu bar, Control Center) are not apps.
//! - A look walks the window's `AXChildren` breadth first ([`tree::build`]), reading each element's
//!   attributes in one call (`AXUIElementCopyMultipleAttributeValues`) and only as many children as
//!   there is room for (`AXUIElementCopyAttributeValues` with a count), within the caps and four
//!   seconds. Roles are given as the UI Automation control types the core reads ([`control_type`]),
//!   rectangles in physical pixels of the screen.
//! - A step checks the element again first (a password field, a secure text field, is refused
//!   whatever the look said, and so is a click on or text for an element now called like a
//!   sign-in, a payment field or a code; a click on one now called like Send, Delete or Buy goes
//!   only with the owner's yes; one that closes a window, a tab or the app, by its name or by being
//!   a title bar button (`AXCloseButton`, `AXMinimizeButton`, `AXZoomButton`,
//!   `AXFullScreenButton`), never), brings the window to the front and uses the element's own
//!   actions (`AXPress`, `AXSelected`, `AXExpanded`, `AXShowMenu`, a scroll bar's `AXIncrement`);
//!   a click at the element's centre only when there is none, and only when the point is the
//!   window's (no other window, the overlay least of all, covers it). Typing into a text field
//!   sets its value; elsewhere the text is typed at the caret as Unicode, in batches, each after
//!   the element with the focus is read once more; a line break is Return, typed only in a step
//!   the owner said yes to. Keys go the same way, and the live focus is held to what the core
//!   judged ([`policy::may_reach`]).
//! - Keys are written as Windows chords (the core's allowlist); on macOS a shortcut held with
//!   Ctrl is held with ⌘ ([`mac_chord`]): Ctrl+S is ⌘S, Ctrl+Enter ⌘Return, Ctrl+Home ⌘↑. Ctrl
//!   with an arrow moves by word as Option does on macOS (Control with an arrow is Mission
//!   Control's), Ctrl+Tab stays Control+Tab. What has no meaning or is the system's on macOS is
//!   not pressed (`keys_not_allowed`): Alt chords (Option types characters, there are no menu
//!   accelerators), Ctrl+Space (the input source), Ctrl with an F key, Insert, and ⌘H and ⌘M,
//!   which hide the app and minimize the window.
//! - The window is in front only when the app in front is the step's and its focused window is
//!   the step's own, or a modal dialog of that app; another window of the same app (a second
//!   Chrome window) is not, and the step brings its own to the front first.
//! - Every job is for a run ([`Ticket`]): one whose run is over by the time it comes up does
//!   nothing, and one under way checks again just before each change it makes.
//!
//! Every event posted carries Raphael's marker (`handy_keys::RAPHAEL_INPUT_MARKER`), so the watch
//! on the owner's input and the hotkeys never take it for the owner's. Nothing here logs a title,
//! a name, a value or what is typed.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock, mpsc};
use std::time::{Duration, Instant};

use super::keys::{Chord, Key, Typed};
use super::policy::{self, Press, Reach};
use super::tree::{self, Caps, Entry, Props, UiNode};
use super::{Action, Desktop, Direction, Failure, Step, Ticket, WindowInfo, breaks_lines};
use crate::macos::cf::{self, Cf};
use crate::macos::ffi::*;
use crate::macos::keys::{self as input, Modifier, code};
use crate::macos::{ax, workspace};

/// How long one job of the desktop's thread may take before its caller gives up on it.
const JOB_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a look may walk the tree.
const LOOK_BUDGET: Duration = Duration::from_secs(4);
/// The most windows a listing gives.
const MAX_WINDOWS: usize = 40;
/// How long a window is given to come to the front, and an app to take a step in.
const SETTLE: Duration = Duration::from_millis(120);
/// The most ancestors looked through for a scroll area.
const SCROLL_ANCESTORS: usize = 6;
/// The most ancestors of the element with the focus looked through for the combo box or stepper
/// the step named, which gives its focus to a part of it.
const FOCUS_HOLDER_ANCESTORS: usize = 3;
/// How many lines a wheel scroll moves.
const WHEEL_LINES: i32 = 10;

/// The system's own processes, which show windows but are not apps.
const SHELL_APPS: &[&str] = &[
    "com.apple.dock",
    "com.apple.systemuiserver",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.loginwindow",
    "com.apple.windowmanager",
    "com.apple.spotlight",
    "com.apple.wallpaper.agent",
    "com.apple.windowserver",
];

/// The window subroles a listing keeps: an app's ordinary windows and its dialogs. Floating
/// palettes and the system's floating windows are the tool windows of macOS.
const WINDOW_SUBROLES: &[&str] = &["AXStandardWindow", "AXDialog", "AXSystemDialog", ""];

/// The UI Automation control type ids the core reads (`tree::role_name`).
mod control {
    pub const BUTTON: i32 = 50_000;
    pub const CHECK_BOX: i32 = 50_002;
    pub const COMBO_BOX: i32 = 50_003;
    pub const EDIT: i32 = 50_004;
    pub const HYPERLINK: i32 = 50_005;
    pub const IMAGE: i32 = 50_006;
    pub const LIST_ITEM: i32 = 50_007;
    pub const LIST: i32 = 50_008;
    pub const MENU: i32 = 50_009;
    pub const MENU_BAR: i32 = 50_010;
    pub const MENU_ITEM: i32 = 50_011;
    pub const PROGRESS_BAR: i32 = 50_012;
    pub const RADIO_BUTTON: i32 = 50_013;
    pub const SCROLL_BAR: i32 = 50_014;
    pub const SLIDER: i32 = 50_015;
    pub const SPINNER: i32 = 50_016;
    pub const TAB: i32 = 50_018;
    pub const TAB_ITEM: i32 = 50_019;
    pub const TEXT: i32 = 50_020;
    pub const TOOL_BAR: i32 = 50_021;
    pub const TOOL_TIP: i32 = 50_022;
    pub const TREE: i32 = 50_023;
    pub const TREE_ITEM: i32 = 50_024;
    pub const CUSTOM: i32 = 50_025;
    pub const GROUP: i32 = 50_026;
    pub const THUMB: i32 = 50_027;
    pub const DATA_GRID: i32 = 50_028;
    pub const DATA_ITEM: i32 = 50_029;
    pub const DOCUMENT: i32 = 50_030;
    pub const WINDOW: i32 = 50_032;
    pub const PANE: i32 = 50_033;
    pub const HEADER_ITEM: i32 = 50_035;
    pub const TABLE: i32 = 50_036;
    pub const SEPARATOR: i32 = 50_038;
}

/// The control type of an element of accessibility role `role` and subrole `subrole`.
pub(crate) fn control_type(role: &str, subrole: &str) -> i32 {
    use control::*;
    match role {
        "AXButton" | "AXMenuButton" | "AXColorWell" | "AXDisclosureTriangle" => BUTTON,
        "AXCheckBox" => CHECK_BOX,
        "AXRadioButton" if subrole == "AXTabButton" => TAB_ITEM,
        "AXRadioButton" => RADIO_BUTTON,
        "AXTextField" | "AXSecureTextField" | "AXTextArea" | "AXSearchField" | "AXDateField"
        | "AXTimeField" => EDIT,
        "AXWebArea" => DOCUMENT,
        "AXStaticText" | "AXHeading" => TEXT,
        "AXLink" => HYPERLINK,
        "AXPopUpButton" | "AXComboBox" => COMBO_BOX,
        "AXMenu" => MENU,
        "AXMenuBar" => MENU_BAR,
        "AXMenuItem" | "AXMenuBarItem" => MENU_ITEM,
        "AXProgressIndicator" | "AXBusyIndicator" | "AXLevelIndicator" | "AXRelevanceIndicator" => {
            PROGRESS_BAR
        }
        "AXScrollBar" => SCROLL_BAR,
        "AXSlider" => SLIDER,
        "AXIncrementor" | "AXStepper" => SPINNER,
        "AXTabGroup" => TAB,
        "AXToolbar" => TOOL_BAR,
        "AXHelpTag" => TOOL_TIP,
        "AXOutline" | "AXBrowser" => TREE,
        "AXRow" if subrole == "AXOutlineRow" => TREE_ITEM,
        "AXRow" | "AXCell" => DATA_ITEM,
        "AXList" => LIST,
        "AXTable" => TABLE,
        "AXGrid" => DATA_GRID,
        "AXColumn" => HEADER_ITEM,
        "AXGroup" | "AXRadioGroup" => GROUP,
        "AXSplitGroup" | "AXScrollArea" | "AXLayoutArea" | "AXDrawer" | "AXMatte" => PANE,
        "AXLayoutItem" => LIST_ITEM,
        "AXSplitter" => SEPARATOR,
        "AXValueIndicator" => THUMB,
        "AXImage" => IMAGE,
        "AXWindow" | "AXSheet" => WINDOW,
        _ => CUSTOM,
    }
}

/// Whether an element of `role`/`subrole` is a password field.
fn is_secure(role: &str, subrole: &str) -> bool {
    role == "AXSecureTextField" || subrole == "AXSecureTextField"
}

/// Whether an element of `subrole` is a button of a window's title bar.
fn in_title_bar(subrole: &str) -> bool {
    matches!(
        subrole,
        "AXCloseButton" | "AXMinimizeButton" | "AXZoomButton" | "AXFullScreenButton"
    )
}

type Job = Box<dyn FnOnce(&mut State) + Send>;

/// The desktop's thread, reached through jobs.
pub struct AxDesktop {
    jobs: Mutex<mpsc::Sender<Job>>,
}

impl AxDesktop {
    /// Starts the desktop's thread. The accessibility permission is asked for by each job, so that
    /// one granted while Raphael runs counts from the next request.
    pub fn start() -> Option<Self> {
        let (jobs, inbox) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("raphael-computer".into())
            .spawn(move || {
                let mut state = State::new();
                while let Ok(job) = inbox.recv() {
                    job(&mut state);
                }
            })
            .ok()?;
        Some(Self {
            jobs: Mutex::new(jobs),
        })
    }

    /// Runs `work` on the desktop's thread and waits for what it returns, for a bounded time.
    fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut State) -> T + Send + 'static,
    ) -> Option<T> {
        let (done, result) = mpsc::channel();
        let job: Job = Box::new(move |state| {
            let _ = done.send(work(state));
        });
        crate::rpc::lock(&self.jobs).send(job).ok()?;
        let outcome = result.recv_timeout(JOB_TIMEOUT).ok();
        if outcome.is_none() {
            log::warn!("computer: a job of the desktop's thread did not finish in time");
        }
        outcome
    }
}

impl Desktop for AxDesktop {
    fn windows(&self) -> Vec<WindowInfo> {
        self.run(|state| state.windows()).unwrap_or_default()
    }

    fn window(&self, id: i64) -> Option<WindowInfo> {
        self.run(move |state| state.window(id)).flatten()
    }

    fn look(&self, id: i64, ticket: &Ticket) -> Result<(Vec<Entry>, bool), Failure> {
        let ticket = ticket.clone();
        self.run(move |state| state.look(id, &ticket))
            .unwrap_or(Err(Failure::Failed))
    }

    fn act(&self, step: &Step, ticket: &Ticket) -> Result<&'static str, Failure> {
        let (step, ticket) = (step.clone(), ticket.clone());
        self.run(move |state| state.act(&step, &ticket))
            .unwrap_or(Err(Failure::Failed))
    }

    fn focus(&self, id: i64, ticket: &Ticket) -> Result<(), Failure> {
        let ticket = ticket.clone();
        self.run(move |state| {
            ticket.check()?;
            let (pid, window) = state.window_element(id)?;
            bring_to_front(pid, id, &window, &ticket)
        })
        .unwrap_or(Err(Failure::Failed))
    }

    fn forget(&self) {
        let _ = self.run(|state| {
            state.looks.clear();
            state.apps.clear();
        });
    }
}

/// What the desktop's thread holds.
struct State {
    own_pid: i32,
    /// Each window of the latest listing: its app's process and its element.
    windows: HashMap<i64, (i32, ax::Element)>,
    /// The elements of the latest look at each window, in the order of their ids.
    looks: HashMap<i64, Vec<ax::Element>>,
    /// Each process's app: identifier, name, elevated.
    apps: HashMap<i32, (String, String, bool)>,
    /// Whether the missing permission was logged already.
    told_untrusted: bool,
}

impl State {
    fn new() -> Self {
        Self {
            own_pid: workspace::own_pid(),
            windows: HashMap::new(),
            looks: HashMap::new(),
            apps: HashMap::new(),
            told_untrusted: false,
        }
    }

    /// Whether the accessibility API may be used; logged once when it may not.
    fn trusted(&mut self) -> bool {
        let trusted = ax::trusted(false);
        if !trusted && !self.told_untrusted {
            self.told_untrusted = true;
            log::warn!("computer: no accessibility permission: the desktop cannot be operated");
        }
        trusted
    }

    /// The window `id` of the latest listing (listed again when it is not in it), if it is still
    /// there.
    fn window_element(&mut self, id: i64) -> Result<(i32, ax::Element), Failure> {
        if !self.trusted() {
            return Err(Failure::Failed);
        }
        if !self.windows.contains_key(&id) {
            let _ = self.windows();
        }
        let (pid, element) = self.windows.get(&id).cloned().ok_or(Failure::Gone)?;
        match element.attribute_result("AXRole") {
            Err(error) if error == kAXErrorInvalidUIElement => {
                self.windows.remove(&id);
                Err(Failure::Gone)
            }
            _ => Ok((pid, element)),
        }
    }

    fn windows(&mut self) -> Vec<WindowInfo> {
        if !self.trusted() {
            return Vec::new();
        }
        let order: HashMap<u32, usize> = on_screen_windows()
            .into_iter()
            .enumerate()
            .filter(|(_, window)| window.layer == 0 && window.alpha > 0.0)
            .map(|(index, window)| (window.id, index))
            .collect();
        let front = workspace::frontmost_pid();
        let mut found: Vec<(usize, WindowInfo)> = Vec::new();
        self.windows.clear();
        for pid in workspace::regular_apps() {
            if pid == self.own_pid {
                continue;
            }
            let (exe, _, _) = self.app_of(pid);
            if exe.is_empty() || SHELL_APPS.contains(&exe.as_str()) {
                continue;
            }
            let Some(app) = ax::Element::application(pid) else {
                continue;
            };
            let focused = app.element("AXFocusedWindow").and_then(|w| w.window_id());
            for element in app.elements("AXWindows") {
                let Some(info) = self.describe(pid, &element, front == Some(pid), focused) else {
                    continue;
                };
                let place = u32::try_from(info.id)
                    .ok()
                    .and_then(|id| order.get(&id).copied())
                    .unwrap_or(usize::MAX);
                self.windows.insert(info.id, (pid, element));
                found.push((place, info));
            }
        }
        // On screen in the window server's order; the others (minimized, hidden) after, in the
        // order their apps run.
        found.sort_by_key(|(place, _)| *place);
        let mut windows: Vec<WindowInfo> = found
            .into_iter()
            .map(|(_, info)| info)
            .take(MAX_WINDOWS)
            .collect();
        windows.sort_by_key(|window| !window.foreground);
        windows
    }

    fn window(&mut self, id: i64) -> Option<WindowInfo> {
        let (pid, element) = self.window_element(id).ok()?;
        let front = workspace::frontmost_pid() == Some(pid);
        let focused = ax::Element::application(pid)
            .and_then(|app| app.element("AXFocusedWindow"))
            .and_then(|w| w.window_id());
        self.describe(pid, &element, front, focused)
    }

    /// A window as the listing gives it, if it is one an app shows.
    fn describe(
        &mut self,
        pid: i32,
        element: &ax::Element,
        app_in_front: bool,
        focused: Option<CGWindowID>,
    ) -> Option<WindowInfo> {
        if element.role() != "AXWindow" {
            return None;
        }
        let subrole = element.subrole();
        if !WINDOW_SUBROLES.contains(&subrole.as_str()) {
            return None;
        }
        let title = policy::clean(&element.string("AXTitle").unwrap_or_default(), 200);
        if title.is_empty() {
            return None;
        }
        let id = element.window_id()?;
        let (exe, name, elevated) = self.app_of(pid);
        Some(WindowInfo {
            id: i64::from(id),
            pid: pid as u32,
            exe,
            name,
            title,
            class: subrole,
            foreground: app_in_front && focused == Some(id),
            elevated,
        })
    }

    fn app_of(&mut self, pid: i32) -> (String, String, bool) {
        self.apps
            .entry(pid)
            .or_insert_with(|| match workspace::app(pid) {
                Some(app) => {
                    let name = policy::clean(&app.name, 60);
                    let name = if name.is_empty() {
                        policy::fallback_name(&app.id)
                    } else {
                        name
                    };
                    (app.id, name, false)
                }
                None => (String::new(), String::new(), false),
            })
            .clone()
    }

    fn look(&mut self, id: i64, ticket: &Ticket) -> Result<(Vec<Entry>, bool), Failure> {
        let (_, window) = self.window_element(id)?;
        let window_frame = window.frame();
        let scale = window_frame.map_or(1.0, |frame| {
            scale_at(CGPoint {
                x: frame.origin.x + frame.size.width / 2.0,
                y: frame.origin.y + frame.size.height / 2.0,
            })
        });
        let look = Look {
            window_frame,
            scale,
        };
        let began = Instant::now();
        let shot = tree::build(
            AxNode {
                element: window,
                look: &look,
            },
            Caps::default(),
            // out of time, or the run is over: the walk stops where it is, between two elements
            || began.elapsed() > LOOK_BUDGET || !ticket.is_live(),
        );
        // A run that ended while the look walked the tree keeps nothing.
        ticket.check()?;
        let elements = shot.nodes.into_iter().map(|node| node.element).collect();
        self.looks.insert(id, elements);
        log::debug!(
            "computer: a look of {} elements (cut: {})",
            shot.entries.len(),
            shot.truncated
        );
        Ok((shot.entries, shot.truncated))
    }

    fn element(&self, step: &Step) -> Result<Option<ax::Element>, Failure> {
        let Some(id) = step.element else {
            return Ok(None);
        };
        let elements = self.looks.get(&step.window).ok_or(Failure::Stale)?;
        let index = usize::try_from(id).map_err(|_| Failure::Stale)?;
        let element = elements
            .get(index.wrapping_sub(1))
            .ok_or(Failure::Stale)?
            .clone();
        // Asked again, now: the look may be old, and the element gone or changed.
        let role = element
            .attribute_result("AXRole")
            .map_err(|_| Failure::Stale)?
            .string()
            .unwrap_or_default();
        if is_secure(&role, &element.subrole()) {
            return Err(Failure::Password);
        }
        // A click on it or text for it: the element is the step's target. Keys are checked on
        // the element with the focus, which they reach (`check_focus`).
        if matches!(step.action, Action::Click | Action::Type(_))
            && policy::is_handoff_name(&name_of(&element))
        {
            return Err(Failure::Handoff);
        }
        Ok(Some(element))
    }

    fn act(&mut self, step: &Step, ticket: &Ticket) -> Result<&'static str, Failure> {
        // A job that waited behind another (a slow look) for a run that ended meanwhile.
        ticket.check()?;
        // Keys that mean nothing on macOS, or the system's there, are refused before anything is
        // done.
        let pressed = match &step.action {
            Action::Keys(chord) => Some(mac_chord(*chord).ok_or(Failure::KeysNotAllowed)?),
            _ => None,
        };
        let (pid, window) = self.window_element(step.window)?;
        let element = self.element(step)?;
        bring_to_front(pid, step.window, &window, ticket)?;
        match (&step.action, element) {
            (Action::Click, Some(element)) => {
                // The element now, not the look's: a page may have renamed the same button.
                let (name, identifier) = (name_of(&element), identifier_of(&element));
                policy::may_click(closer(&element, &name, &identifier), step.confirmed)?;
                click(&element, step.window, ticket)
            }
            (Action::Focus, Some(element)) => {
                ticket.check()?;
                element
                    .set_bool("AXFocused", true)
                    .map(|()| "focus")
                    .map_err(|_| Failure::Failed)
            }
            (Action::Scroll(direction), Some(element)) => {
                scroll(&element, *direction, step.window, ticket)
            }
            (Action::Type(text), element) => type_text(
                pid,
                step.window,
                element.as_ref(),
                text,
                step.confirmed,
                ticket,
            ),
            (Action::Keys(chord), element) => {
                let (modifiers, key) = pressed.ok_or(Failure::KeysNotAllowed)?;
                if let Some(element) = &element {
                    give_focus(element, ticket)?;
                }
                check_focus(
                    pid,
                    step.window,
                    element.as_ref(),
                    Press::Keys(*chord),
                    step.confirmed,
                )?;
                ticket.check()?;
                if !input::chord(&modifiers, key, || {}) {
                    return Err(Failure::Failed);
                }
                std::thread::sleep(SETTLE);
                Ok("keyboard")
            }
            _ => Err(Failure::BadRequest),
        }
    }
}

// ---------- reading elements ----------

/// What every node of one look shares: the window's frame and the screen's scale.
struct Look {
    window_frame: Option<CGRect>,
    scale: f64,
}

struct AxNode<'a> {
    element: ax::Element,
    look: &'a Look,
}

/// The attributes a look reads of each element, in one call, in this order.
const FIELDS: [&str; 13] = [
    "AXRole",
    "AXSubrole",
    "AXTitle",
    "AXDescription",
    "AXValue",
    "AXEnabled",
    "AXFocused",
    "AXPosition",
    "AXSize",
    "AXSelected",
    "AXExpanded",
    "AXPlaceholderValue",
    "AXDisclosing",
];
const ROLE: usize = 0;
const SUBROLE: usize = 1;
const TITLE: usize = 2;
const DESCRIPTION: usize = 3;
const VALUE: usize = 4;
const ENABLED: usize = 5;
const FOCUSED: usize = 6;
const POSITION: usize = 7;
const SIZE: usize = 8;
const SELECTED: usize = 9;
const EXPANDED: usize = 10;
const PLACEHOLDER: usize = 11;
const DISCLOSING: usize = 12;

fn field_names() -> &'static Cf {
    static NAMES: OnceLock<Cf> = OnceLock::new();
    NAMES.get_or_init(|| {
        let strings: Vec<Cf> = FIELDS.iter().map(|name| cf::string(name)).collect();
        let pointers: Vec<CFTypeRef> = strings.iter().map(Cf::as_ptr).collect();
        // SAFETY: the array retains each string (CoreFoundation's own callbacks for CF types).
        unsafe {
            Cf::owned(CFArrayCreate(
                kCFAllocatorDefault,
                pointers.as_ptr(),
                pointers.len() as CFIndex,
                (&raw const kCFTypeArrayCallBacks).cast(),
            ))
        }
        .expect("CFArrayCreate failed")
    })
}

fn children_name() -> &'static Cf {
    static NAME: OnceLock<Cf> = OnceLock::new();
    NAME.get_or_init(|| cf::string("AXChildren"))
}

/// Whether a value is the placeholder of an attribute that could not be read.
fn is_ax_error(value: &Cf) -> bool {
    // SAFETY: plain queries of a valid object.
    unsafe {
        value.type_id() == AXValueGetTypeID()
            && AXValueGetType(value.as_ptr()) == kAXValueTypeAXError
    }
}

/// The [`FIELDS`] of `element`, each `None` when it could not be read.
fn read_fields(element: &ax::Element) -> Vec<Option<Cf>> {
    let mut values: CFArrayRef = std::ptr::null();
    // SAFETY: a valid element and array of names; the result is owned when the call succeeds.
    let error = unsafe {
        AXUIElementCopyMultipleAttributeValues(
            element.as_ptr(),
            field_names().as_ptr(),
            0,
            &mut values,
        )
    };
    if error != kAXErrorSuccess {
        return FIELDS.iter().map(|name| element.attribute(name)).collect();
    }
    // SAFETY: a Copy function's result.
    let array = unsafe { Cf::owned(values) }
        .and_then(|array| array.array())
        .unwrap_or_default();
    (0..FIELDS.len())
        .map(|index| {
            array
                .get(index)
                .cloned()
                .filter(|value| !is_ax_error(value))
        })
        .collect()
}

/// An `AXValue` holding a `T` of the accessibility value type `kind`.
fn ax_struct<T: Default>(value: &Cf, kind: u32) -> Option<T> {
    // SAFETY: plain queries, then a read into a value of the type `kind` names.
    unsafe {
        if value.type_id() != AXValueGetTypeID() || AXValueGetType(value.as_ptr()) != kind {
            return None;
        }
        let mut out = T::default();
        AXValueGetValue(value.as_ptr(), kind, (&raw mut out).cast()).then_some(out)
    }
}

/// A value as text: a string, or a number written out.
fn value_text(value: &Cf) -> Option<String> {
    if let Some(text) = value.string() {
        return Some(text);
    }
    if let Some(real) = cf::f64_of(value.as_ptr()) {
        return Some(if real.fract() == 0.0 && real.abs() < 1e15 {
            format!("{}", real as i64)
        } else {
            format!("{real}")
        });
    }
    None
}

/// The name an element goes by: its title, its description, a text field's placeholder, a
/// text's value.
fn element_name(
    role: &str,
    title: Option<String>,
    description: Option<String>,
    placeholder: Option<String>,
    value: Option<String>,
) -> String {
    let filled = |text: &Option<String>| text.as_ref().is_some_and(|t| !t.trim().is_empty());
    if filled(&title) {
        return title.unwrap_or_default();
    }
    if filled(&description) {
        return description.unwrap_or_default();
    }
    if control_type(role, "") == control::EDIT && filled(&placeholder) {
        return placeholder.unwrap_or_default();
    }
    if matches!(role, "AXStaticText" | "AXHeading") && filled(&value) {
        return value.unwrap_or_default();
    }
    String::new()
}

/// The live element's name, read now.
fn name_of(element: &ax::Element) -> String {
    let role = element.role();
    let value = if matches!(role.as_str(), "AXStaticText" | "AXHeading") {
        element.string("AXValue")
    } else {
        None
    };
    element_name(
        &role,
        element.string("AXTitle"),
        element.string("AXDescription"),
        element.string("AXPlaceholderValue"),
        value,
    )
}

/// The live element's identifier (the app's own name for it), or none.
fn identifier_of(element: &ax::Element) -> String {
    element.string("AXIdentifier").unwrap_or_default()
}

/// What tells whether the live `element` closes a window, a tab or the app.
fn closer<'a>(element: &ax::Element, name: &'a str, identifier: &'a str) -> policy::Closer<'a> {
    policy::Closer {
        name,
        automation_id: identifier,
        in_title_bar: in_title_bar(&element.subrole()),
    }
}

/// `frame` in physical pixels of the screen, if it has an area.
fn physical(frame: CGRect, scale: f64) -> Option<[i32; 4]> {
    let (w, h) = (frame.size.width * scale, frame.size.height * scale);
    (w >= 1.0 && h >= 1.0).then(|| {
        [
            (frame.origin.x * scale).round() as i32,
            (frame.origin.y * scale).round() as i32,
            w.round() as i32,
            h.round() as i32,
        ]
    })
}

/// Whether two frames overlap.
fn overlaps(a: CGRect, b: CGRect) -> bool {
    a.origin.x < b.origin.x + b.size.width
        && b.origin.x < a.origin.x + a.size.width
        && a.origin.y < b.origin.y + b.size.height
        && b.origin.y < a.origin.y + a.size.height
}

/// Pixels per point of the screen at `point`.
fn scale_at(point: CGPoint) -> f64 {
    let mut display: CGDirectDisplayID = 0;
    let mut count = 0u32;
    // SAFETY: plain queries with out pointers; the mode is released here.
    unsafe {
        if CGGetDisplaysWithPoint(point, 1, &mut display, &mut count) != 0 || count == 0 {
            display = CGMainDisplayID();
        }
        let mode = CGDisplayCopyDisplayMode(display);
        if mode.is_null() {
            return 1.0;
        }
        let (width, pixels) = (
            CGDisplayModeGetWidth(mode),
            CGDisplayModeGetPixelWidth(mode),
        );
        CGDisplayModeRelease(mode);
        if width == 0 || pixels == 0 {
            1.0
        } else {
            pixels as f64 / width as f64
        }
    }
}

impl UiNode for AxNode<'_> {
    fn props(&self) -> Props {
        let element = &self.element;
        let fields = read_fields(element);
        let text = |index: usize| fields[index].as_ref().and_then(Cf::string);
        let flag = |index: usize| fields[index].as_ref().and_then(Cf::boolean);
        let role = text(ROLE).unwrap_or_default();
        let subrole = text(SUBROLE).unwrap_or_default();
        let control_type = control_type(&role, &subrole);
        let password = is_secure(&role, &subrole);
        let raw_value = fields[VALUE].as_ref();
        let number = raw_value.and_then(Cf::int);

        let mut actions = Vec::new();
        let mut state = None;
        let element_actions = element.actions();
        let has = |action: &str| element_actions.iter().any(|a| a == action);
        match control_type {
            control::CHECK_BOX => {
                if has("AXPress") {
                    actions.push("toggle");
                }
                state = match number {
                    Some(0) => Some("off"),
                    Some(1) => Some("on"),
                    Some(2) => Some("mixed"),
                    _ => None,
                };
            }
            control::RADIO_BUTTON | control::TAB_ITEM => {
                if has("AXPress") {
                    actions.push("select");
                }
                if number == Some(1) {
                    state = Some("selected");
                }
            }
            _ => {
                if has("AXPress") {
                    actions.push("invoke");
                }
            }
        }
        if matches!(
            control_type,
            control::DATA_ITEM | control::TREE_ITEM | control::LIST_ITEM
        ) && element.is_settable("AXSelected")
        {
            actions.push("select");
        }
        if flag(SELECTED) == Some(true) {
            state = Some("selected");
        }
        let expanded = flag(EXPANDED)
            .or_else(|| flag(DISCLOSING))
            .or_else(|| (role == "AXDisclosureTriangle").then(|| number == Some(1)));
        if let Some(expanded) = expanded {
            actions.push("expand");
            state = Some(if expanded { "expanded" } else { "collapsed" });
        } else if control_type == control::COMBO_BOX && (has("AXShowMenu") || has("AXPress")) {
            actions.push("expand");
            state = Some("collapsed");
        }
        let value_role = matches!(
            control_type,
            control::EDIT
                | control::COMBO_BOX
                | control::SLIDER
                | control::SPINNER
                | control::PROGRESS_BAR
                | control::SCROLL_BAR
        );
        if matches!(
            control_type,
            control::EDIT | control::COMBO_BOX | control::SLIDER | control::SPINNER
        ) && element.is_settable("AXValue")
        {
            actions.push("value");
        }
        if role == "AXScrollArea" {
            actions.push("scroll");
        }
        // A password field's value is never read.
        let value = if password || !value_role {
            None
        } else {
            raw_value.and_then(value_text)
        };
        let static_value = if matches!(role.as_str(), "AXStaticText" | "AXHeading") {
            raw_value.and_then(Cf::string)
        } else {
            None
        };
        let name = element_name(
            &role,
            text(TITLE),
            text(DESCRIPTION),
            text(PLACEHOLDER),
            static_value,
        );
        let frame = match (
            fields[POSITION]
                .as_ref()
                .and_then(|v| ax_struct::<CGPoint>(v, kAXValueTypeCGPoint)),
            fields[SIZE]
                .as_ref()
                .and_then(|v| ax_struct::<CGSize>(v, kAXValueTypeCGSize)),
        ) {
            (Some(origin), Some(size)) => Some(CGRect { origin, size }),
            _ => None,
        };
        let offscreen = frame.is_some_and(|frame| {
            frame.size.width <= 0.0
                || frame.size.height <= 0.0
                || self
                    .look
                    .window_frame
                    .is_some_and(|window| !overlaps(frame, window))
        });
        Props {
            control_type,
            name,
            value,
            // An element that says nothing of it (a group, a text) is not disabled.
            enabled: flag(ENABLED).unwrap_or(true),
            focused: flag(FOCUSED).unwrap_or(false),
            password,
            offscreen,
            state,
            actions,
            rect: frame.and_then(|frame| physical(frame, self.look.scale)),
        }
    }

    /// Only as many children as there is room for, in one call: a list of a hundred thousand
    /// rows costs no more than the room left.
    fn children(&self, room: usize, stop: &dyn Fn() -> bool) -> (Vec<Self>, bool) {
        let name = children_name();
        let mut count: CFIndex = 0;
        // SAFETY: a valid element and name, and an out pointer.
        let counted = unsafe {
            AXUIElementGetAttributeValueCount(self.element.as_ptr(), name.as_ptr(), &mut count)
        } == kAXErrorSuccess;
        if counted && count <= 0 {
            return (Vec::new(), false);
        }
        if room == 0 || stop() {
            return (Vec::new(), true);
        }
        let elements: Vec<ax::Element> = if counted {
            let wanted = room.min(count as usize) as CFIndex;
            let mut values: CFArrayRef = std::ptr::null();
            // SAFETY: a valid element and name; the array is owned when the call succeeds.
            let error = unsafe {
                AXUIElementCopyAttributeValues(
                    self.element.as_ptr(),
                    name.as_ptr(),
                    0,
                    wanted,
                    &mut values,
                )
            };
            if error != kAXErrorSuccess {
                // Children that cannot be read are none.
                return (Vec::new(), false);
            }
            // SAFETY: a Copy function's result.
            unsafe { Cf::owned(values) }
                .and_then(|array| array.array())
                .unwrap_or_default()
                .into_iter()
                .filter_map(ax::Element::from_cf)
                .collect()
        } else {
            self.element.elements("AXChildren")
        };
        let total = if counted {
            count as usize
        } else {
            elements.len()
        };
        let mut found = Vec::new();
        for element in elements {
            if found.len() >= room || stop() {
                return (found, true);
            }
            found.push(AxNode {
                element,
                look: self.look,
            });
        }
        let more = total > found.len();
        (found, more)
    }
}

// ---------- acting ----------

/// A window of the window server's list: its number, its frame (points), its layer and its
/// opacity.
struct ScreenWindow {
    id: CGWindowID,
    bounds: CGRect,
    layer: i64,
    alpha: f64,
}

/// The windows on screen, front first.
fn on_screen_windows() -> Vec<ScreenWindow> {
    // SAFETY: a Copy function's result is owned; the dictionary keys are framework constants.
    unsafe {
        let Some(list) = Cf::owned(CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        )) else {
            return Vec::new();
        };
        list.array()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|window| {
                let dict = window.as_ptr();
                let id = cf::int_of(cf::dict_get(dict, kCGWindowNumber))?;
                let layer = cf::int_of(cf::dict_get(dict, kCGWindowLayer)).unwrap_or(0);
                let alpha = cf::f64_of(cf::dict_get(dict, kCGWindowAlpha)).unwrap_or(1.0);
                let mut bounds = CGRect::default();
                let bounds_dict = cf::dict_get(dict, kCGWindowBounds);
                if bounds_dict.is_null()
                    || !CGRectMakeWithDictionaryRepresentation(bounds_dict, &mut bounds)
                {
                    return None;
                }
                Some(ScreenWindow {
                    id: u32::try_from(id).ok()?,
                    bounds,
                    layer,
                    alpha,
                })
            })
            .collect()
    }
}

/// The window a click at `point` lands in: the first window, front first, that is drawn there.
fn window_at(windows: &[ScreenWindow], point: CGPoint) -> Option<CGWindowID> {
    windows
        .iter()
        .find(|window| {
            window.alpha > 0.0
                && point.x >= window.bounds.origin.x
                && point.y >= window.bounds.origin.y
                && point.x < window.bounds.origin.x + window.bounds.size.width
                && point.y < window.bounds.origin.y + window.bounds.size.height
        })
        .map(|window| window.id)
}

/// Whether a click at `point` lands in the window `id`: no other window (the overlay least of
/// all) is over it there.
fn point_is_windows(point: CGPoint, id: i64) -> bool {
    window_at(&on_screen_windows(), point).map(i64::from) == Some(id)
}

/// The centre of an element on the screen, in points.
fn centre(element: &ax::Element) -> Result<CGPoint, Failure> {
    let frame = element.frame().ok_or(Failure::Stale)?;
    if frame.size.width <= 0.0 || frame.size.height <= 0.0 {
        return Err(Failure::Failed);
    }
    Ok(CGPoint {
        x: frame.origin.x + frame.size.width / 2.0,
        y: frame.origin.y + frame.size.height / 2.0,
    })
}

/// The window in front, as far as a step goes.
struct Front {
    pid: i32,
    window: Option<CGWindowID>,
    /// The focused window is a modal dialog of the app.
    modal_dialog: bool,
}

fn front() -> Option<Front> {
    let pid = workspace::frontmost_pid()?;
    let window = ax::focused_window(pid);
    let modal_dialog = window.as_ref().is_some_and(|window| {
        matches!(window.subrole().as_str(), "AXDialog" | "AXSystemDialog")
            && window.boolean("AXModal") == Some(true)
    });
    Some(Front {
        pid,
        window: window.and_then(|window| window.window_id()),
        modal_dialog,
    })
}

/// Whether the window in front is the target window itself, or a modal dialog of the target's
/// app. Another window of the same app (a second Chrome window) is not the target's.
fn fronts(front: &Front, target_pid: i32, target_window: i64) -> bool {
    target_window > 0
        && front.pid == target_pid
        && (front.window.map(i64::from) == Some(target_window) || front.modal_dialog)
}

/// Whether the window in front is the step's.
fn in_front(pid: i32, window: i64) -> bool {
    front().is_some_and(|front| fronts(&front, pid, window))
}

/// Brings the window to the front, restored if it was minimized. `Stopped`, with nothing done,
/// once the run is over. macOS may refuse all the same; the step then finds out (`in_front`).
fn bring_to_front(pid: i32, id: i64, window: &ax::Element, ticket: &Ticket) -> Result<(), Failure> {
    if in_front(pid, id) {
        return Ok(());
    }
    ticket.check()?;
    if window.boolean("AXMinimized") == Some(true) {
        let _ = window.set_bool("AXMinimized", false);
    }
    workspace::activate(pid);
    let _ = window.perform("AXRaise");
    let _ = window.set_bool("AXMain", true);
    std::thread::sleep(SETTLE);
    Ok(())
}

/// Whether an action call was made: it succeeded, or the app is busy with it (a button that opens
/// a modal dialog does not return until the dialog closes, and the call then runs out of time).
fn made(result: Result<(), AXError>) -> bool {
    result.is_ok() || result == Err(kAXErrorCannotComplete)
}

/// A click: the element's own action for it if it has one, else the mouse at its centre. The
/// run's ticket is checked before each action.
fn click(element: &ax::Element, window: i64, ticket: &Ticket) -> Result<&'static str, Failure> {
    let control_type = control_type(&element.role(), &element.subrole());
    let actions = element.actions();
    let has = |action: &str| actions.iter().any(|a| a == action);
    if has("AXPress") {
        ticket.check()?;
        if made(element.perform("AXPress")) {
            return Ok(match control_type {
                control::CHECK_BOX => "toggle",
                control::RADIO_BUTTON | control::TAB_ITEM => "select",
                _ => "invoke",
            });
        }
    }
    if matches!(
        control_type,
        control::DATA_ITEM | control::TREE_ITEM | control::LIST_ITEM
    ) && element.is_settable("AXSelected")
    {
        ticket.check()?;
        if made(element.set_bool("AXSelected", true)) {
            return Ok("select");
        }
    }
    if element.is_settable("AXExpanded") {
        let expanded = element.boolean("AXExpanded").unwrap_or(false);
        ticket.check()?;
        if made(element.set_bool("AXExpanded", !expanded)) {
            return Ok(if expanded { "collapse" } else { "expand" });
        }
    } else if has("AXShowMenu") {
        ticket.check()?;
        if made(element.perform("AXShowMenu")) {
            return Ok("expand");
        }
    }
    let point = centre(element)?;
    if !point_is_windows(point, window) {
        return Err(Failure::Failed);
    }
    ticket.check()?;
    if !input::click(point) {
        return Err(Failure::Failed);
    }
    std::thread::sleep(SETTLE);
    Ok("mouse")
}

/// Gives `element` the keyboard focus for keys or typed text, and the app a moment to move it
/// there. `Focus` when the element cannot take it: nothing is then sent.
fn give_focus(element: &ax::Element, ticket: &Ticket) -> Result<(), Failure> {
    ticket.check()?;
    element
        .set_bool("AXFocused", true)
        .map_err(|_| Failure::Focus)?;
    std::thread::sleep(SETTLE);
    Ok(())
}

/// Whether `focused`, the element with the focus, is `target`, or a part of a combo box or a
/// stepper `target` is. Any other element that holds the focus inside `target` is not it.
fn holds_focus(target: &ax::Element, focused: &ax::Element) -> bool {
    if target == focused {
        return true;
    }
    let role = control_type(&target.role(), &target.subrole());
    if role != control::COMBO_BOX && role != control::SPINNER {
        return false;
    }
    let mut current = focused.element("AXParent");
    for _ in 0..FOCUS_HOLDER_ANCESTORS {
        let Some(here) = current.take() else { break };
        if &here == target {
            return true;
        }
        current = here.element("AXParent");
    }
    false
}

/// What keys or typed text would reach, read live, just before they are sent (see
/// `uia.rs`'s `check_focus`).
fn check_focus(
    pid: i32,
    window: i64,
    target: Option<&ax::Element>,
    press: Press,
    confirmed: bool,
) -> Result<(), Failure> {
    if !in_front(pid, window) {
        return Err(Failure::Failed);
    }
    let focused = ax::Element::application(pid)
        .and_then(|app| app.element("AXFocusedUIElement"))
        .ok_or(Failure::Failed)?;
    let role = focused
        .attribute_result("AXRole")
        .map_err(|_| Failure::Failed)?
        .string()
        .unwrap_or_default();
    let subrole = focused.subrole();
    let name = name_of(&focused);
    let identifier = identifier_of(&focused);
    let kind = control_type(&role, &subrole);
    let text_role = kind == control::EDIT || kind == control::DOCUMENT;
    let reach = Reach {
        password: is_secure(&role, &subrole),
        handoff: policy::is_handoff_name(&name),
        on_target: target.is_none_or(|target| holds_focus(target, &focused)),
        edits_text: text_role && focused.is_settable("AXValue"),
        sends: policy::is_confirm_name(&name),
        message_box: text_role && policy::is_message_name(&name),
        closes: policy::closes(closer(&focused, &name, &identifier)),
    };
    policy::may_reach(reach, press, confirmed)
}

fn type_text(
    pid: i32,
    window: i64,
    element: Option<&ax::Element>,
    text: &str,
    confirmed: bool,
    ticket: &Ticket,
) -> Result<&'static str, Failure> {
    if let Some(element) = element {
        let kind = control_type(&element.role(), &element.subrole());
        // A text field takes the text as its value (a line break in it is no Return).
        if (kind == control::EDIT || kind == control::COMBO_BOX) && element.is_settable("AXValue") {
            ticket.check()?;
            if element.set("AXValue", &cf::string(text)).is_ok() {
                return Ok("value");
            }
        }
    }
    // Typed keys press Return for a line break, which may send a message or a form: only in a
    // step the owner said yes to.
    if breaks_lines(text) && !confirmed {
        return Err(Failure::Unconfirmed);
    }
    if let Some(element) = element {
        give_focus(element, ticket)?;
    }
    let press = Press::Text {
        line_breaks: breaks_lines(text),
    };
    for batch in super::keys::typing(text) {
        check_focus(pid, window, element, press, confirmed)?;
        match batch {
            Typed::Units(units) => {
                ticket.check()?;
                let piece = String::from_utf16_lossy(&units);
                if !input::type_text(&piece, || ticket.is_live()) {
                    ticket.check()?;
                    return Err(Failure::Failed);
                }
            }
            Typed::Enter => {
                ticket.check()?;
                if !input::chord(&[], code::RETURN, || {}) {
                    return Err(Failure::Failed);
                }
                std::thread::sleep(SETTLE);
            }
        }
    }
    std::thread::sleep(SETTLE);
    Ok("keyboard")
}

fn scroll(
    element: &ax::Element,
    direction: Direction,
    window: i64,
    ticket: &Ticket,
) -> Result<&'static str, Failure> {
    let (bar, action) = match direction {
        Direction::Up => ("AXVerticalScrollBar", "AXDecrement"),
        Direction::Down => ("AXVerticalScrollBar", "AXIncrement"),
        Direction::Left => ("AXHorizontalScrollBar", "AXDecrement"),
        Direction::Right => ("AXHorizontalScrollBar", "AXIncrement"),
    };
    let mut current = Some(element.clone());
    for _ in 0..=SCROLL_ANCESTORS {
        let Some(here) = current.take() else { break };
        if here.role() == "AXScrollArea"
            && let Some(bar) = here.element(bar)
            && bar.actions().iter().any(|a| a == action)
        {
            ticket.check()?;
            if bar.perform(action).is_ok() {
                std::thread::sleep(SETTLE);
                return Ok("scroll");
            }
        }
        current = here.element("AXParent");
    }
    let point = centre(element)?;
    if !point_is_windows(point, window) {
        return Err(Failure::Failed);
    }
    let (vertical, horizontal) = match direction {
        Direction::Up => (WHEEL_LINES, 0),
        Direction::Down => (-WHEEL_LINES, 0),
        Direction::Left => (0, WHEEL_LINES),
        Direction::Right => (0, -WHEEL_LINES),
    };
    ticket.check()?;
    // A wheel event goes to the window under the pointer: the pointer is put on the element first
    // (a warp posts no mouse event, so the watch does not take it for the owner's).
    // SAFETY: a plain call.
    unsafe { CGWarpMouseCursorPosition(point) };
    if !input::scroll(vertical, horizontal) {
        return Err(Failure::Failed);
    }
    std::thread::sleep(SETTLE);
    Ok("wheel")
}

// ---------- keys ----------

/// Letters that, with ⌘, hide the app (H) or minimize the window (M): window management, which a
/// step never does. Ctrl+W and Ctrl+Q (⌘W, ⌘Q) are refused by the allowlist already.
const SYSTEM_LETTERS: &[char] = &['h', 'm'];

/// The ANSI keyboard's key for a letter or a digit, when the layout cannot be read.
fn ansi_key(c: char) -> Option<u16> {
    let key = match c {
        'a' => 0x00,
        's' => 0x01,
        'd' => 0x02,
        'f' => 0x03,
        'h' => 0x04,
        'g' => 0x05,
        'z' => 0x06,
        'x' => 0x07,
        'c' => 0x08,
        'v' => 0x09,
        'b' => 0x0B,
        'q' => 0x0C,
        'w' => 0x0D,
        'e' => 0x0E,
        'r' => 0x0F,
        'y' => 0x10,
        't' => 0x11,
        '1' => 0x12,
        '2' => 0x13,
        '3' => 0x14,
        '4' => 0x15,
        '6' => 0x16,
        '5' => 0x17,
        '9' => 0x19,
        '7' => 0x1A,
        '8' => 0x1C,
        '0' => 0x1D,
        'o' => 0x1F,
        'u' => 0x20,
        'i' => 0x22,
        'p' => 0x23,
        'l' => 0x25,
        'j' => 0x26,
        'k' => 0x28,
        'n' => 0x2D,
        'm' => 0x2E,
        _ => return None,
    };
    Some(key)
}

/// The key a chord ends in, pressed with no Ctrl.
fn plain_key(key: Key) -> Option<u16> {
    let code = match key {
        Key::Enter => code::RETURN,
        Key::Tab => code::TAB,
        Key::Escape => code::ESCAPE,
        Key::Backspace => code::DELETE,
        Key::Delete => code::FORWARD_DELETE,
        Key::Space => code::SPACE,
        Key::Up => code::UP,
        Key::Down => code::DOWN,
        Key::Left => code::LEFT,
        Key::Right => code::RIGHT,
        Key::Home => code::HOME,
        Key::End => code::END,
        Key::PageUp => code::PAGE_UP,
        Key::PageDown => code::PAGE_DOWN,
        Key::F(n) => *[
            code::F1,
            code::F2,
            code::F3,
            code::F4,
            code::F5,
            code::F6,
            code::F7,
            code::F8,
            code::F9,
            code::F10,
            code::F11,
            code::F12,
        ]
        .get(usize::from(n).checked_sub(1)?)?,
        // There is no Insert key on a Mac; a letter alone is typing.
        Key::Insert | Key::Char(_) => return None,
    };
    Some(code)
}

/// A chord of the allowlist (written for Windows) as macOS keys: the modifiers and the key, with
/// `letter` giving the key that types a letter or a digit on the current layout. `None` for what
/// means nothing or is the system's on macOS (see the module documentation).
fn mac_chord_with(
    chord: Chord,
    letter: impl Fn(char) -> Option<u16>,
) -> Option<(Vec<Modifier>, u16)> {
    if chord.alt {
        return None;
    }
    let mut modifiers = Vec::new();
    let key = if chord.ctrl {
        let (modifier, key) = match chord.key {
            Key::Char(c) if SYSTEM_LETTERS.contains(&c) => return None,
            Key::Char(c) => (Modifier::Command, letter(c).or_else(|| ansi_key(c))?),
            Key::Enter => (Modifier::Command, code::RETURN),
            Key::Tab => (Modifier::Control, code::TAB),
            Key::Left => (Modifier::Option, code::LEFT),
            Key::Right => (Modifier::Option, code::RIGHT),
            Key::Up => (Modifier::Option, code::UP),
            Key::Down => (Modifier::Option, code::DOWN),
            Key::Home => (Modifier::Command, code::UP),
            Key::End => (Modifier::Command, code::DOWN),
            Key::Backspace => (Modifier::Option, code::DELETE),
            Key::Delete => (Modifier::Option, code::FORWARD_DELETE),
            Key::PageUp => (Modifier::Control, code::PAGE_UP),
            Key::PageDown => (Modifier::Control, code::PAGE_DOWN),
            // Ctrl+Space switches the input source, Ctrl with an F key is the system's.
            Key::Space | Key::F(_) | Key::Insert | Key::Escape => return None,
        };
        modifiers.push(modifier);
        key
    } else {
        plain_key(chord.key)?
    };
    if chord.shift {
        modifiers.push(Modifier::Shift);
    }
    Some((modifiers, key))
}

/// [`mac_chord_with`] on the current keyboard layout.
fn mac_chord(chord: Chord) -> Option<(Vec<Modifier>, u16)> {
    mac_chord_with(chord, input::key_for)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::computer::keys::parse_chord;
    use crate::computer::tree::role_name;

    fn chord(text: &str) -> Option<(Vec<Modifier>, u16)> {
        mac_chord_with(parse_chord(text).unwrap(), |_| None)
    }

    #[test]
    fn roles_are_given_as_the_control_types_the_core_reads() {
        for (role, subrole, name) in [
            ("AXButton", "", "Button"),
            ("AXButton", "AXCloseButton", "Button"),
            ("AXCheckBox", "AXSwitch", "CheckBox"),
            ("AXRadioButton", "", "RadioButton"),
            ("AXRadioButton", "AXTabButton", "TabItem"),
            ("AXTextField", "", "Edit"),
            ("AXTextField", "AXSearchField", "Edit"),
            ("AXSecureTextField", "", "Edit"),
            ("AXTextArea", "", "Edit"),
            ("AXWebArea", "", "Document"),
            ("AXStaticText", "", "Text"),
            ("AXLink", "", "Hyperlink"),
            ("AXPopUpButton", "", "ComboBox"),
            ("AXComboBox", "", "ComboBox"),
            ("AXMenuItem", "", "MenuItem"),
            ("AXMenuBarItem", "", "MenuItem"),
            ("AXTabGroup", "", "Tab"),
            ("AXList", "", "List"),
            ("AXTable", "", "Table"),
            ("AXOutline", "", "Tree"),
            ("AXRow", "AXOutlineRow", "TreeItem"),
            ("AXRow", "AXTableRow", "DataItem"),
            ("AXSlider", "", "Slider"),
            ("AXScrollArea", "", "Pane"),
            ("AXGroup", "", "Group"),
            ("AXImage", "", "Image"),
            ("AXWindow", "AXStandardWindow", "Window"),
            ("AXToolbar", "", "ToolBar"),
            ("AXSomethingNew", "", "Custom"),
        ] {
            assert_eq!(
                role_name(control_type(role, subrole)),
                name,
                "{role}/{subrole}"
            );
        }
    }

    #[test]
    fn a_secure_text_field_is_a_password_field_and_title_bar_buttons_are_known() {
        assert!(is_secure("AXSecureTextField", ""));
        assert!(is_secure("AXTextField", "AXSecureTextField"));
        assert!(!is_secure("AXTextField", "AXSearchField"));
        for subrole in [
            "AXCloseButton",
            "AXMinimizeButton",
            "AXZoomButton",
            "AXFullScreenButton",
        ] {
            assert!(in_title_bar(subrole), "{subrole}");
        }
        assert!(!in_title_bar("AXToolbarButton"));
    }

    #[test]
    fn an_element_goes_by_its_title_then_its_description_then_its_placeholder() {
        let some = |s: &str| Some(s.to_owned());
        assert_eq!(
            element_name("AXButton", some("OK"), some("d"), None, None),
            "OK"
        );
        assert_eq!(
            element_name("AXButton", some(" "), some("Send"), None, None),
            "Send"
        );
        assert_eq!(
            element_name("AXTextField", None, None, some("Search"), some("typed")),
            "Search"
        );
        // a field's typed value is never its name
        assert_eq!(
            element_name("AXTextField", None, None, None, some("typed")),
            ""
        );
        assert_eq!(
            element_name("AXStaticText", None, None, None, some("Hello")),
            "Hello"
        );
        assert_eq!(element_name("AXButton", None, None, some("x"), None), "");
    }

    #[test]
    fn windows_shortcuts_are_pressed_with_command_on_macos() {
        assert_eq!(chord("Ctrl+S"), Some((vec![Modifier::Command], 0x01)));
        assert_eq!(
            chord("Ctrl+Shift+Z"),
            Some((vec![Modifier::Command, Modifier::Shift], 0x06))
        );
        assert_eq!(chord("Ctrl+1"), Some((vec![Modifier::Command], 0x12)));
        assert_eq!(
            chord("Ctrl+Enter"),
            Some((vec![Modifier::Command], code::RETURN))
        );
        assert_eq!(
            chord("Ctrl+Home"),
            Some((vec![Modifier::Command], code::UP))
        );
        assert_eq!(
            chord("Ctrl+End"),
            Some((vec![Modifier::Command], code::DOWN))
        );
        // tabs keep Control; words move with Option
        assert_eq!(
            chord("Ctrl+Tab"),
            Some((vec![Modifier::Control], code::TAB))
        );
        assert_eq!(
            chord("Ctrl+Shift+Tab"),
            Some((vec![Modifier::Control, Modifier::Shift], code::TAB))
        );
        assert_eq!(
            chord("Ctrl+Left"),
            Some((vec![Modifier::Option], code::LEFT))
        );
        assert_eq!(
            chord("Ctrl+Backspace"),
            Some((vec![Modifier::Option], code::DELETE))
        );
        // the layout's own key for the letter comes first
        assert_eq!(
            mac_chord_with(parse_chord("Ctrl+V").unwrap(), |c| (c == 'v')
                .then_some(0x2F)),
            Some((vec![Modifier::Command], 0x2F))
        );
    }

    #[test]
    fn plain_keys_keep_their_meaning() {
        assert_eq!(chord("Enter"), Some((vec![], code::RETURN)));
        assert_eq!(chord("Shift+Tab"), Some((vec![Modifier::Shift], code::TAB)));
        assert_eq!(chord("Escape"), Some((vec![], code::ESCAPE)));
        assert_eq!(chord("Backspace"), Some((vec![], code::DELETE)));
        assert_eq!(chord("Delete"), Some((vec![], code::FORWARD_DELETE)));
        assert_eq!(
            chord("Shift+Delete"),
            Some((vec![Modifier::Shift], code::FORWARD_DELETE))
        );
        assert_eq!(chord("PageDown"), Some((vec![], code::PAGE_DOWN)));
        assert_eq!(chord("F5"), Some((vec![], code::F5)));
        assert_eq!(chord("F12"), Some((vec![], code::F12)));
    }

    #[test]
    fn what_means_nothing_or_is_the_systems_on_macos_is_not_pressed() {
        for text in [
            "Alt+F",
            "Alt+S",
            "Alt+Down",
            "Alt+Enter",
            "Ctrl+Space",
            "Ctrl+F5",
            "Ctrl+H",
            "Ctrl+M",
            "Insert",
            "Shift+Insert",
        ] {
            assert_eq!(chord(text), None, "{text}");
        }
    }

    #[test]
    fn a_rectangle_is_given_in_physical_pixels_and_needs_an_area() {
        let frame = CGRect {
            origin: CGPoint { x: 10.0, y: 20.5 },
            size: CGSize {
                width: 100.0,
                height: 30.0,
            },
        };
        assert_eq!(physical(frame, 2.0), Some([20, 41, 200, 60]));
        assert_eq!(physical(frame, 1.0), Some([10, 21, 100, 30]));
        let flat = CGRect {
            size: CGSize {
                width: 100.0,
                height: 0.0,
            },
            ..frame
        };
        assert_eq!(physical(flat, 2.0), None);
    }

    fn screen(id: CGWindowID, x: f64, y: f64, w: f64, h: f64, alpha: f64) -> ScreenWindow {
        ScreenWindow {
            id,
            bounds: CGRect {
                origin: CGPoint { x, y },
                size: CGSize {
                    width: w,
                    height: h,
                },
            },
            layer: 0,
            alpha,
        }
    }

    #[test]
    fn a_click_lands_in_the_front_window_drawn_at_its_point() {
        let windows = [
            // the overlay in the corner, then a transparent window, then the target, then another
            screen(9, 900.0, 700.0, 100.0, 100.0, 1.0),
            screen(8, 0.0, 0.0, 2000.0, 2000.0, 0.0),
            screen(5, 0.0, 0.0, 1000.0, 800.0, 1.0),
            screen(6, 0.0, 0.0, 1500.0, 1000.0, 1.0),
        ];
        assert_eq!(window_at(&windows, CGPoint { x: 100.0, y: 100.0 }), Some(5));
        assert_eq!(window_at(&windows, CGPoint { x: 950.0, y: 750.0 }), Some(9));
        assert_eq!(
            window_at(
                &windows,
                CGPoint {
                    x: 1200.0,
                    y: 900.0
                }
            ),
            Some(6)
        );
        assert_eq!(
            window_at(
                &windows,
                CGPoint {
                    x: 1800.0,
                    y: 1800.0
                }
            ),
            None
        );
    }

    #[test]
    fn another_window_of_the_same_app_in_front_is_not_the_steps() {
        let front = |pid, window, modal_dialog| Front {
            pid,
            window,
            modal_dialog,
        };
        assert!(fronts(&front(7, Some(100), false), 7, 100));
        // a modal dialog of the app, in front of its window
        assert!(fronts(&front(7, Some(300), true), 7, 100));
        // a second window of the same browser
        assert!(!fronts(&front(7, Some(200), false), 7, 100));
        // another app, even with a modal dialog
        assert!(!fronts(&front(8, Some(100), true), 7, 100));
        // nothing focused, or no target
        assert!(!fronts(&front(7, None, false), 7, 100));
        assert!(!fronts(&front(7, Some(100), false), 7, 0));
    }

    #[test]
    fn numbers_are_written_as_a_value() {
        assert_eq!(value_text(&cf::number(42)).as_deref(), Some("42"));
        assert_eq!(value_text(&cf::string("abc")).as_deref(), Some("abc"));
    }
}
