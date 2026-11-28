//! The native half of the permission guide (`permission_guide.rs`, R-PRIV-AX-02): the app bundle that
//! is dragged into a list of System Settings, where System Settings' window is, and the drag itself.
//!
//! The drag starts in AppKit, never in the page: a local event monitor sees the press on the card's
//! app tile and the first drag after it, and starts a dragging session with that very event. The
//! card is a non-activating panel, so the press never brings Raphael forward, and System Settings
//! stays the app in front, ready for the drop.

use std::cell::RefCell;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};

use block2::RcBlock;
use objc2::encode::{Encode, Encoding};
use objc2::rc::{Allocated, Retained, autoreleasepool};
use objc2::runtime::{AnyClass, AnyObject, AnyProtocol, ClassBuilder, MessageReceiver, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::NSString;

use super::cf::{self, Cf};
use super::ffi::*;

/// System Settings (System Preferences before macOS 13).
const SETTINGS: &str = "com.apple.systempreferences";

/// `NSEventTypeLeftMouseDown`, `…LeftMouseUp`, `…LeftMouseDragged`.
const LEFT_DOWN: usize = 1;
const LEFT_UP: usize = 2;
const LEFT_DRAGGED: usize = 6;
/// The masks of those three events.
const MASK: u64 = (1 << LEFT_DOWN) | (1 << LEFT_UP) | (1 << LEFT_DRAGGED);
/// `NSDragOperationCopy | NSDragOperationLink | NSDragOperationGeneric`: what a file dragged from
/// Finder offers a list that takes apps.
const OPERATIONS: usize = 1 | 2 | 4;
/// The side of the icon that follows the pointer, in points.
const ICON: f64 = 48.0;
/// `NSApplicationActivationPolicyRegular`.
const REGULAR: isize = 0;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct NsPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct NsSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct NsRect {
    origin: NsPoint,
    size: NsSize,
}

// SAFETY: the layouts of CGPoint, CGSize and CGRect on a 64-bit Mac, which NSPoint, NSSize and NSRect are.
unsafe impl Encode for NsPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
// SAFETY: as above.
unsafe impl Encode for NsSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
// SAFETY: as above.
unsafe impl Encode for NsRect {
    const ENCODING: Encoding = Encoding::Struct("CGRect", &[NsPoint::ENCODING, NsSize::ENCODING]);
}

/// The app bundle Raphael runs from (`/Applications/Raphael.app`), or `None` for a binary run outside
/// a bundle (a development run), which has no app to drag.
pub fn app_bundle() -> Option<PathBuf> {
    autoreleasepool(|_| {
        // SAFETY: class and instance methods that answer an object or nil.
        let path: Option<Retained<NSString>> = unsafe {
            let bundle: Option<Retained<AnyObject>> = msg_send![class!(NSBundle), mainBundle];
            msg_send![&*bundle?, bundlePath]
        };
        let path = PathBuf::from(path?.to_string());
        path.extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
            .then_some(path)
    })
}

/// The name Finder and System Settings show for `bundle` (`Raphael`).
pub fn display_name(bundle: &Path) -> String {
    let shown = autoreleasepool(|_| {
        let path = NSString::from_str(&bundle.to_string_lossy());
        // SAFETY: a class method answering the shared manager, and a method answering a string.
        let name: Option<Retained<NSString>> = unsafe {
            let manager: Retained<AnyObject> = msg_send![class!(NSFileManager), defaultManager];
            msg_send![&*manager, displayNameAtPath: &*path]
        };
        name.map(|name| name.to_string())
    });
    let shown = shown.unwrap_or_default();
    let shown = shown.strip_suffix(".app").unwrap_or(&shown).trim();
    if shown.is_empty() {
        bundle
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Raphael".to_owned())
    } else {
        shown.to_owned()
    }
}

/// The process of System Settings, while it runs.
pub fn settings_pid() -> Option<i32> {
    autoreleasepool(|_| {
        let bundle = NSString::from_str(SETTINGS);
        // SAFETY: a class method answering an array, which may be empty, and its first app.
        unsafe {
            let list: Retained<AnyObject> = msg_send![
                class!(NSRunningApplication),
                runningApplicationsWithBundleIdentifier: &*bundle
            ];
            let count: usize = msg_send![&*list, count];
            if count == 0 {
                return None;
            }
            let running: Retained<AnyObject> = msg_send![&*list, objectAtIndex: 0usize];
            let pid: i32 = msg_send![&*running, processIdentifier];
            Some(pid)
        }
    })
}

/// The frame of `pid`'s front window on screen, in points from the top left of the main display
/// (the window server's own coordinates, which Tauri's logical positions are). The window list
/// gives frames without Screen Recording; only window titles need it.
pub fn front_window(pid: i32) -> Option<CGRect> {
    // SAFETY: a Copy function's result is owned; the dictionary keys are framework constants.
    unsafe {
        let list = Cf::owned(CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        ))?;
        list.array()?.into_iter().find_map(|window| {
            let dict = window.as_ptr();
            if cf::int_of(cf::dict_get(dict, kCGWindowOwnerPID))? != i64::from(pid)
                || cf::int_of(cf::dict_get(dict, kCGWindowLayer)).unwrap_or(0) != 0
                || cf::f64_of(cf::dict_get(dict, kCGWindowAlpha)).unwrap_or(1.0) <= 0.0
            {
                return None;
            }
            let bounds = cf::dict_get(dict, kCGWindowBounds);
            let mut frame = CGRect::default();
            if bounds.is_null() || !CGRectMakeWithDictionaryRepresentation(bounds, &mut frame) {
                return None;
            }
            // A sheet or a small helper window is not the window whose list the app goes into.
            (frame.size.width >= 240.0 && frame.size.height >= 160.0).then_some(frame)
        })
    }
}

/// Whether the app in front is `pid`, or an agent with no Dock icon (the password prompt that
/// System Settings asks for comes from one): the card stays only while the owner is there.
pub fn in_front(pid: i32) -> bool {
    autoreleasepool(|_| {
        // SAFETY: the shared workspace, its front app (or nil), and that app's properties.
        unsafe {
            let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
            let front: Option<Retained<AnyObject>> = msg_send![&*workspace, frontmostApplication];
            let Some(front) = front else { return false };
            let front_pid: i32 = msg_send![&*front, processIdentifier];
            let policy: isize = msg_send![&*front, activationPolicy];
            front_pid == pid || policy != REGULAR
        }
    })
}

/// What a press may drag: the card's window, its app tile (points from the top left of the
/// window's content), and the bundle.
struct Target {
    window: usize,
    tile: CGRect,
    bundle: PathBuf,
    pressed: bool,
}

static TARGET: Mutex<Option<Target>> = Mutex::new(None);

thread_local! {
    /// The local event monitor, on the main thread that installed it.
    static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

/// Lets a press on `tile` of the card in `window` drag `bundle`. A tile not measured yet (`None`)
/// drags nothing until [`set_tile`]. Main thread only, as the monitor is.
pub fn watch_drags(window: *mut c_void, bundle: PathBuf, tile: Option<CGRect>) {
    *TARGET.lock().unwrap_or_else(PoisonError::into_inner) = Some(Target {
        window: window as usize,
        tile: tile.unwrap_or_default(),
        bundle,
        pressed: false,
    });
    MONITOR.with(|monitor| {
        let mut monitor = monitor.borrow_mut();
        if monitor.is_some() {
            return;
        }
        let handler = RcBlock::new(|event: *mut AnyObject| -> *mut AnyObject {
            if !event.is_null() {
                // SAFETY: AppKit hands the monitor a live event, on the main thread.
                unsafe { seen(&*event) };
            }
            event
        });
        // SAFETY: a class method taking a mask and a block, which it copies; it answers the monitor.
        *monitor = unsafe {
            msg_send![
                class!(NSEvent),
                addLocalMonitorForEventsMatchingMask: MASK,
                handler: &*handler
            ]
        };
        if monitor.is_none() {
            log::warn!("permission guide: no event monitor, the app tile cannot be dragged");
        }
    });
}

/// Where the app tile is now, in points from the top left of the card's content.
pub fn set_tile(tile: CGRect) {
    if let Some(target) = TARGET
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        target.tile = tile;
    }
}

/// Ends the drags of the card. Main thread only.
pub fn stop_drags() {
    *TARGET.lock().unwrap_or_else(PoisonError::into_inner) = None;
    MONITOR.with(|monitor| {
        if let Some(monitor) = monitor.borrow_mut().take() {
            // SAFETY: the monitor this thread installed, removed once.
            unsafe {
                let () = msg_send![class!(NSEvent), removeMonitor: &*monitor];
            }
        }
    });
}

/// Whether `point` (points from the top left of a content `height` tall, where AppKit's
/// `locationInWindow` counts from the bottom left) falls on `tile`.
fn on_tile(tile: CGRect, location: CGPoint, height: f64) -> bool {
    let y = height - location.y;
    location.x >= tile.origin.x
        && location.x < tile.origin.x + tile.size.width
        && y >= tile.origin.y
        && y < tile.origin.y + tile.size.height
}

/// # Safety
///
/// `event` is a live event, and this runs on the main thread.
unsafe fn seen(event: &AnyObject) {
    // SAFETY: NSEvent's properties; the window may be nil. `type` is a Rust keyword, so its selector
    // is sent by name.
    let (kind, window): (usize, *mut AnyObject) = unsafe {
        (
            event.send_message(Sel::register(c"type"), ()),
            msg_send![event, window],
        )
    };
    let mut target = TARGET.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(current) = target.as_mut() else {
        return;
    };
    match kind {
        LEFT_DOWN => {
            current.pressed = !window.is_null() && window as usize == current.window && {
                // SAFETY: the card's live window and its content view.
                let (location, frame): (NsPoint, NsRect) = unsafe {
                    let view: *mut AnyObject = msg_send![window, contentView];
                    (
                        msg_send![event, locationInWindow],
                        if view.is_null() {
                            NsRect::default()
                        } else {
                            msg_send![view, frame]
                        },
                    )
                };
                on_tile(
                    current.tile,
                    CGPoint {
                        x: location.x,
                        y: location.y,
                    },
                    frame.size.height,
                )
            };
        }
        LEFT_UP => current.pressed = false,
        LEFT_DRAGGED if current.pressed && window as usize == current.window => {
            current.pressed = false;
            let bundle = current.bundle.clone();
            drop(target);
            // SAFETY: the card's live window, the drag that is going on, the main thread.
            unsafe { drag(window, event, &bundle) };
        }
        _ => {}
    }
}

/// Starts dragging `bundle` from `window` with the drag `event`, the app's own icon under the
/// pointer, as Finder drags an app.
///
/// # Safety
///
/// `window` is live, `event` is the current drag, and this runs on the main thread.
unsafe fn drag(window: *mut AnyObject, event: &AnyObject, bundle: &Path) {
    autoreleasepool(|_| {
        let path = NSString::from_str(&bundle.to_string_lossy());
        // SAFETY: AppKit and Foundation calls on the main thread, with live objects.
        unsafe {
            let view: Option<Retained<AnyObject>> = msg_send![window, contentView];
            let Some(view) = view else { return };
            let url: Option<Retained<AnyObject>> =
                msg_send![class!(NSURL), fileURLWithPath: &*path];
            let Some(url) = url else { return };
            let allocated: Allocated<AnyObject> = msg_send![class!(NSDraggingItem), alloc];
            let item: Option<Retained<AnyObject>> =
                msg_send![allocated, initWithPasteboardWriter: &*url];
            let Some(item) = item else { return };
            let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
            let image: Retained<AnyObject> = msg_send![&*workspace, iconForFile: &*path];
            let () = msg_send![&*image, setSize: NsSize { width: ICON, height: ICON }];
            let location: NsPoint = msg_send![event, locationInWindow];
            let point: NsPoint =
                msg_send![&*view, convertPoint: location, fromView: Option::<&AnyObject>::None];
            let frame = NsRect {
                origin: NsPoint {
                    x: point.x - ICON / 2.0,
                    y: point.y - ICON / 2.0,
                },
                size: NsSize {
                    width: ICON,
                    height: ICON,
                },
            };
            let () = msg_send![&*item, setDraggingFrame: frame, contents: &*image];
            let items: Retained<AnyObject> = msg_send![class!(NSArray), arrayWithObject: &*item];
            let session: Option<Retained<AnyObject>> = msg_send![
                &*view,
                beginDraggingSessionWithItems: &*items,
                event: event,
                source: drag_source()
            ];
            if session.is_none() {
                log::warn!("permission guide: the app tile's drag did not start");
            }
        }
    });
}

extern "C-unwind" fn operations(
    _this: &AnyObject,
    _cmd: Sel,
    _session: *mut AnyObject,
    _context: isize,
) -> usize {
    OPERATIONS
}

/// The dragging source of the card's drags: one object for the life of the app.
fn drag_source() -> &'static AnyObject {
    static SOURCE: OnceLock<usize> = OnceLock::new();
    let pointer = *SOURCE.get_or_init(|| {
        let name = c"RaphaelPermissionGuideDragSource";
        let class: &AnyClass = AnyClass::get(name).unwrap_or_else(|| {
            let mut builder = ClassBuilder::new(name, class!(NSObject))
                .expect("the drag source class is registered once");
            if let Some(protocol) = AnyProtocol::get(c"NSDraggingSource") {
                builder.add_protocol(protocol);
            }
            // SAFETY: the selector takes a session and a context and answers an operation mask, as
            // the function does.
            unsafe {
                builder.add_method(
                    sel!(draggingSession:sourceOperationMaskForDraggingContext:),
                    operations as extern "C-unwind" fn(_, _, _, _) -> _,
                );
            }
            builder.register()
        });
        // SAFETY: `new` answers an owned instance, kept for the life of the app.
        let source: Retained<AnyObject> = unsafe { msg_send![class, new] };
        Retained::into_raw(source) as usize
    });
    // SAFETY: the instance above is never released.
    unsafe { &*(pointer as *const AnyObject) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> CGRect {
        CGRect {
            origin: CGPoint { x, y },
            size: CGSize { width, height },
        }
    }

    #[test]
    fn a_press_is_on_the_tile_counted_from_the_top_of_the_card() {
        // A card 100 points tall with its tile 40 points down: AppKit counts the press from the bottom.
        let tile = rect(16.0, 40.0, 200.0, 44.0);
        assert!(on_tile(
            tile,
            CGPoint {
                x: 20.0,
                y: 100.0 - 50.0
            },
            100.0
        ));
        assert!(!on_tile(
            tile,
            CGPoint {
                x: 20.0,
                y: 100.0 - 20.0
            },
            100.0
        ));
        assert!(!on_tile(
            tile,
            CGPoint {
                x: 230.0,
                y: 100.0 - 50.0
            },
            100.0
        ));
        assert!(!on_tile(
            CGRect::default(),
            CGPoint { x: 0.0, y: 100.0 },
            100.0
        ));
    }

    #[test]
    fn the_geometry_structs_are_appkits() {
        assert_eq!(size_of::<NsRect>(), size_of::<CGRect>());
        assert!(matches!(NsRect::ENCODING, Encoding::Struct("CGRect", _)));
    }
}
