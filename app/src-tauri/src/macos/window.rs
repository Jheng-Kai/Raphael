//! Raphael's passive windows on macOS (the overlay and the learned-word pill): windows that float
//! above every app, on every Space and over full-screen apps, and that never make Raphael the
//! active app, not even when one of their buttons is clicked.
//!
//! A click on an ordinary window of an app that is not active activates that app, which would take
//! the keyboard focus from the field the person types in, and the next paste would go to the wrong
//! place. Only a panel with the non-activating style takes clicks without that, so the window that
//! tao made is turned into one: its class is changed at run time to a subclass of `NSPanel` that
//! can never become the key or main window ([`PANEL_CLASS`]), and it is given the non-activating
//! style. This is what the window's `WS_EX_NOACTIVATE` and `WS_EX_TOOLWINDOW` are on Windows.
//!
//! Changing an object's class is sound only while the new class lays out the object's memory as
//! the old one did. tao's window class adds one ivar, `focusable` (a `BOOL`), to `NSWindow`, and
//! `NSPanel` adds none (both are 520 bytes on macOS 15), so the panel class declares the same ivar
//! and it falls at the same offset: tao still finds it by name if it reads it again.

use std::ffi::c_void;
use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{class, msg_send, sel};
use tauri::WebviewWindow;

/// The name of the panel class.
const PANEL_CLASS: &std::ffi::CStr = c"RaphaelPassivePanel";

/// `NSWindowStyleMaskNonactivatingPanel`.
const NONACTIVATING_PANEL: usize = 1 << 7;
/// `NSWindowCollectionBehaviorCanJoinAllSpaces | Stationary | IgnoresCycle | FullScreenAuxiliary`.
const COLLECTION_BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);
/// `NSStatusWindowLevel`: above ordinary and floating windows, as a menu bar extra is.
const STATUS_WINDOW_LEVEL: isize = 25;

unsafe extern "C" {
    fn object_setClass(object: *mut AnyObject, class: *const AnyClass) -> *const AnyClass;
}

extern "C-unwind" fn never(_this: &AnyObject, _cmd: Sel) -> Bool {
    Bool::NO
}

fn panel_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        if let Some(class) = AnyClass::get(PANEL_CLASS) {
            return class;
        }
        let mut builder = ClassBuilder::new(PANEL_CLASS, class!(NSPanel))
            .expect("the passive panel class is registered once");
        // tao's ivar, at the offset tao's class gives it (see the module documentation).
        builder.add_ivar::<Bool>(c"focusable");
        // SAFETY: both selectors take no argument and answer a BOOL, as the function does.
        unsafe {
            builder.add_method(
                sel!(canBecomeKeyWindow),
                never as extern "C-unwind" fn(_, _) -> _,
            );
            builder.add_method(
                sel!(canBecomeMainWindow),
                never as extern "C-unwind" fn(_, _) -> _,
            );
        }
        builder.register()
    })
}

/// Makes `window` passive (see the module documentation). It is done on the main thread, which
/// owns the window, and doing it again changes nothing.
pub fn make_passive(window: &WebviewWindow) {
    let ns_window = match window.ns_window() {
        Ok(pointer) => pointer as usize,
        Err(err) => {
            log::warn!("no native window for a passive window: {err}");
            return;
        }
    };
    let change = window.run_on_main_thread(move || {
        // SAFETY: the window lives as long as the app, and this runs on the main thread.
        unsafe { passive(ns_window as *mut c_void) };
    });
    if let Err(err) = change {
        log::warn!("could not make a window passive: {err}");
    }
}

/// # Safety
///
/// `ns_window` must be a live `NSWindow`, and the caller must be on the main thread.
unsafe fn passive(ns_window: *mut c_void) {
    let window = ns_window.cast::<AnyObject>();
    let panel = panel_class();
    // SAFETY: a live window, per the caller.
    unsafe {
        let current: &AnyClass = (*window).class();
        if !std::ptr::eq(current, panel) {
            if current.instance_size() != panel.instance_size() {
                log::warn!(
                    "a passive window stays an ordinary window: its class {} is {} bytes, the panel {}",
                    current.name().to_string_lossy(),
                    current.instance_size(),
                    panel.instance_size()
                );
                return;
            }
            object_setClass(window, panel);
        }
        let style: usize = msg_send![&*window, styleMask];
        if style & NONACTIVATING_PANEL == 0 {
            let () = msg_send![&*window, setStyleMask: style | NONACTIVATING_PANEL];
        }
        let () = msg_send![&*window, setCollectionBehavior: COLLECTION_BEHAVIOR];
        // A floating panel takes the floating level (3) when it is made one, so the level is set
        // after it.
        let () = msg_send![&*window, setFloatingPanel: Bool::YES];
        let () = msg_send![&*window, setLevel: STATUS_WINDOW_LEVEL];
        let () = msg_send![&*window, setHidesOnDeactivate: Bool::NO];
        let () = msg_send![&*window, setBecomesKeyOnlyIfNeeded: Bool::YES];
        let () = msg_send![&*window, setWorksWhenModal: Bool::YES];
        let () = msg_send![&*window, setHasShadow: Bool::NO];
        let () = msg_send![&*window, setOpaque: Bool::NO];
    }
}

/// Puts a passive window in front again if something ordered it out, without activating
/// anything: the counterpart of the Windows overlay's sight check. Whether it had to.
pub fn keep_in_front(window: &WebviewWindow) {
    let ns_window = match window.ns_window() {
        Ok(pointer) => pointer as usize,
        Err(_) => return,
    };
    let _ = window.run_on_main_thread(move || {
        let window = ns_window as *mut AnyObject;
        // SAFETY: the window lives as long as the app, and this runs on the main thread.
        unsafe {
            let visible: Bool = msg_send![&*window, isVisible];
            let on_space: Bool = msg_send![&*window, isOnActiveSpace];
            if !visible.as_bool() || !on_space.as_bool() {
                log::info!(
                    "overlay sight: visible {}, on the active Space {}; brought to the front",
                    visible.as_bool(),
                    on_space.as_bool()
                );
                let () = msg_send![&*window, orderFrontRegardless];
            }
        }
    });
}

/// Rounds a passive window's corners (the learned-word pill), which Windows does with a region.
pub fn round_corners(window: &WebviewWindow, radius: f64) {
    let ns_window = match window.ns_window() {
        Ok(pointer) => pointer as usize,
        Err(_) => return,
    };
    let _ = window.run_on_main_thread(move || {
        let window = ns_window as *mut AnyObject;
        // SAFETY: the window and its content view live as long as the app; main thread.
        unsafe {
            let view: Option<objc2::rc::Retained<AnyObject>> = msg_send![&*window, contentView];
            let Some(view) = view else { return };
            let () = msg_send![&*view, setWantsLayer: Bool::YES];
            let layer: Option<objc2::rc::Retained<AnyObject>> = msg_send![&*view, layer];
            if let Some(layer) = layer {
                let () = msg_send![&*layer, setCornerRadius: radius];
                let () = msg_send![&*layer, setMasksToBounds: Bool::YES];
            }
        }
    });
}
