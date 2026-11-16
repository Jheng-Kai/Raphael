//! The accessibility API of macOS (`AXUIElement`), as the shell reads and operates windows with
//! it: the counterpart of UI Automation on Windows.
//!
//! Every call goes to the app that owns the element and may wait for it, so each element made here
//! is given a short messaging timeout ([`TIMEOUT_S`]); a hung app makes a call fail instead of
//! holding the caller.

use std::ffi::c_void;

use super::cf::{self, Cf};
use super::ffi::*;

/// How long one accessibility call may wait for the app that answers it, in seconds.
pub const TIMEOUT_S: f32 = 0.8;

/// An accessibility element.
#[derive(Clone, Debug)]
pub struct Element(Cf);

impl PartialEq for Element {
    fn eq(&self, other: &Self) -> bool {
        // SAFETY: two valid objects.
        unsafe { CFEqual(self.0.as_ptr(), other.0.as_ptr()) != 0 }
    }
}

impl Element {
    /// The element of the whole system, which knows the focused app and element.
    pub fn system_wide() -> Option<Self> {
        // SAFETY: a Create function; the result is owned.
        unsafe { Cf::owned(AXUIElementCreateSystemWide()) }.map(Self::with_timeout)
    }

    /// The element of the app with process id `pid`.
    pub fn application(pid: i32) -> Option<Self> {
        // SAFETY: a Create function; the result is owned.
        unsafe { Cf::owned(AXUIElementCreateApplication(pid)) }.map(Self::with_timeout)
    }

    /// An element from a value an attribute returned, if it is one.
    pub fn from_cf(value: Cf) -> Option<Self> {
        // SAFETY: a plain query.
        (value.type_id() == unsafe { AXUIElementGetTypeID() }).then(|| Self::with_timeout(value))
    }

    fn with_timeout(value: Cf) -> Self {
        // SAFETY: a valid element.
        unsafe { AXUIElementSetMessagingTimeout(value.as_ptr(), TIMEOUT_S) };
        Self(value)
    }

    pub fn as_ptr(&self) -> AXUIElementRef {
        self.0.as_ptr()
    }

    /// The value of `attribute`, or the error the app gave.
    pub fn attribute_result(&self, attribute: &str) -> Result<Cf, AXError> {
        let name = cf::string(attribute);
        let mut value: CFTypeRef = std::ptr::null();
        // SAFETY: a valid element and name; the value is owned when the call succeeds.
        let error =
            unsafe { AXUIElementCopyAttributeValue(self.as_ptr(), name.as_ptr(), &mut value) };
        if error != kAXErrorSuccess {
            return Err(error);
        }
        // SAFETY: a Copy function's result.
        unsafe { Cf::owned(value) }.ok_or(kAXErrorNoValue)
    }

    pub fn attribute(&self, attribute: &str) -> Option<Cf> {
        self.attribute_result(attribute).ok()
    }

    pub fn string(&self, attribute: &str) -> Option<String> {
        self.attribute(attribute)?.string()
    }

    pub fn boolean(&self, attribute: &str) -> Option<bool> {
        self.attribute(attribute)?.boolean()
    }

    pub fn element(&self, attribute: &str) -> Option<Element> {
        Element::from_cf(self.attribute(attribute)?)
    }

    pub fn elements(&self, attribute: &str) -> Vec<Element> {
        self.attribute(attribute)
            .and_then(|value| value.array())
            .unwrap_or_default()
            .into_iter()
            .filter_map(Element::from_cf)
            .collect()
    }

    pub fn role(&self) -> String {
        self.string("AXRole").unwrap_or_default()
    }

    pub fn subrole(&self) -> String {
        self.string("AXSubrole").unwrap_or_default()
    }

    /// The process that owns the element.
    pub fn pid(&self) -> Option<i32> {
        let mut pid = 0;
        // SAFETY: a valid element and an out pointer.
        (unsafe { AXUIElementGetPid(self.as_ptr(), &mut pid) } == kAXErrorSuccess).then_some(pid)
    }

    /// The window server's number of a window element.
    pub fn window_id(&self) -> Option<CGWindowID> {
        let mut id: CGWindowID = 0;
        // SAFETY: a valid element and an out pointer.
        let error = unsafe { _AXUIElementGetWindow(self.as_ptr(), &mut id) };
        (error == kAXErrorSuccess && id != 0).then_some(id)
    }

    /// The element's frame on screen, in points with the origin at the top left of the main
    /// display.
    pub fn frame(&self) -> Option<CGRect> {
        let origin: CGPoint = self.ax_value("AXPosition", kAXValueTypeCGPoint)?;
        let size: CGSize = self.ax_value("AXSize", kAXValueTypeCGSize)?;
        Some(CGRect { origin, size })
    }

    fn ax_value<T: Default>(&self, attribute: &str, kind: u32) -> Option<T> {
        let value = self.attribute(attribute)?;
        // SAFETY: a plain query, then a read into a value of the type `kind` names.
        unsafe {
            if value.type_id() != AXValueGetTypeID() || AXValueGetType(value.as_ptr()) != kind {
                return None;
            }
            let mut out = T::default();
            AXValueGetValue(value.as_ptr(), kind, (&raw mut out).cast::<c_void>()).then_some(out)
        }
    }

    pub fn is_settable(&self, attribute: &str) -> bool {
        let name = cf::string(attribute);
        let mut settable: Boolean = 0;
        // SAFETY: a valid element and name, and an out pointer.
        let error =
            unsafe { AXUIElementIsAttributeSettable(self.as_ptr(), name.as_ptr(), &mut settable) };
        error == kAXErrorSuccess && settable != 0
    }

    pub fn set(&self, attribute: &str, value: &Cf) -> Result<(), AXError> {
        let name = cf::string(attribute);
        // SAFETY: a valid element, name and value.
        let error =
            unsafe { AXUIElementSetAttributeValue(self.as_ptr(), name.as_ptr(), value.as_ptr()) };
        if error == kAXErrorSuccess {
            Ok(())
        } else {
            Err(error)
        }
    }

    pub fn set_bool(&self, attribute: &str, value: bool) -> Result<(), AXError> {
        let name = cf::string(attribute);
        // SAFETY: a valid element and name, and one of the two static booleans.
        let error = unsafe {
            AXUIElementSetAttributeValue(
                self.as_ptr(),
                name.as_ptr(),
                if value {
                    kCFBooleanTrue
                } else {
                    kCFBooleanFalse
                },
            )
        };
        if error == kAXErrorSuccess {
            Ok(())
        } else {
            Err(error)
        }
    }

    pub fn actions(&self) -> Vec<String> {
        let mut names: CFArrayRef = std::ptr::null();
        // SAFETY: a valid element; the array is owned when the call succeeds.
        if unsafe { AXUIElementCopyActionNames(self.as_ptr(), &mut names) } != kAXErrorSuccess {
            return Vec::new();
        }
        // SAFETY: a Copy function's result.
        unsafe { Cf::owned(names) }
            .and_then(|names| names.array())
            .unwrap_or_default()
            .iter()
            .filter_map(Cf::string)
            .collect()
    }

    pub fn perform(&self, action: &str) -> Result<(), AXError> {
        let name = cf::string(action);
        // SAFETY: a valid element and name.
        let error = unsafe { AXUIElementPerformAction(self.as_ptr(), name.as_ptr()) };
        if error == kAXErrorSuccess {
            Ok(())
        } else {
            Err(error)
        }
    }

    /// The text of a text element (its `AXValue` when that is a string).
    pub fn text(&self) -> Option<String> {
        self.attribute("AXValue")?.string()
    }

    /// Whether the element is a password field (a secure text field), whose value is never read.
    pub fn is_secure(&self) -> bool {
        self.subrole() == "AXSecureTextField" || self.role() == "AXSecureTextField"
    }

    /// The window the element is in.
    pub fn window(&self) -> Option<Element> {
        if self.role() == "AXWindow" {
            return Some(self.clone());
        }
        self.element("AXWindow")
    }
}

/// Whether this process may use the accessibility API (System Settings › Privacy & Security ›
/// Accessibility). With `prompt`, macOS asks the person once if it has not been decided.
pub fn trusted(prompt: bool) -> bool {
    if !prompt {
        // SAFETY: a plain query.
        return unsafe { AXIsProcessTrusted() };
    }
    // SAFETY: the option key is a framework constant; the dictionary lives across the call.
    unsafe {
        match cf::dict_true(kAXTrustedCheckOptionPrompt) {
            Some(options) => AXIsProcessTrustedWithOptions(options.as_ptr()),
            None => AXIsProcessTrusted(),
        }
    }
}

/// The focused window of the app with `pid`.
pub fn focused_window(pid: i32) -> Option<Element> {
    let app = Element::application(pid)?;
    app.element("AXFocusedWindow")
        .or_else(|| app.element("AXMainWindow"))
}
