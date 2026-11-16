//! The C functions of the macOS frameworks that the shell calls, declared as their headers declare
//! them (CoreFoundation, CoreGraphics, ApplicationServices' accessibility API, IOKit's power
//! management and the HIToolbox keyboard layouts). Only what is used is here.

#![allow(non_upper_case_globals, non_snake_case, dead_code)]

use std::ffi::c_void;

pub type CFTypeRef = *const c_void;
pub type CFStringRef = *const c_void;
pub type CFArrayRef = *const c_void;
pub type CFDictionaryRef = *const c_void;
pub type CFDataRef = *const c_void;
pub type CFNumberRef = *const c_void;
pub type CFBooleanRef = *const c_void;
pub type CFAllocatorRef = *const c_void;
pub type CFRunLoopRef = *mut c_void;
pub type CFRunLoopSourceRef = *mut c_void;
pub type CFMachPortRef = *mut c_void;
pub type CFTypeID = usize;
pub type CFIndex = isize;
pub type CFStringEncoding = u32;
pub type Boolean = u8;

pub const kCFStringEncodingUTF8: CFStringEncoding = 0x0800_0100;
pub const kCFNumberSInt64Type: CFIndex = 4;
pub const kCFNumberSInt32Type: CFIndex = 3;
pub const kCFNumberDoubleType: CFIndex = 13;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CGSize {
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CGRect {
    pub origin: CGPoint,
    pub size: CGSize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CFRange {
    pub location: CFIndex,
    pub length: CFIndex,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    pub static kCFAllocatorDefault: CFAllocatorRef;
    pub static kCFBooleanTrue: CFBooleanRef;
    pub static kCFBooleanFalse: CFBooleanRef;
    pub static kCFRunLoopCommonModes: CFStringRef;
    pub static kCFRunLoopDefaultMode: CFStringRef;
    /// `CFDictionaryKeyCallBacks`: version and five function pointers.
    pub static kCFTypeDictionaryKeyCallBacks: [usize; 6];
    /// `CFDictionaryValueCallBacks`: version and four function pointers.
    pub static kCFTypeDictionaryValueCallBacks: [usize; 5];

    pub fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    pub fn CFRelease(cf: CFTypeRef);
    pub fn CFGetTypeID(cf: CFTypeRef) -> CFTypeID;
    pub fn CFEqual(a: CFTypeRef, b: CFTypeRef) -> Boolean;

    pub fn CFStringGetTypeID() -> CFTypeID;
    pub fn CFStringCreateWithBytes(
        alloc: CFAllocatorRef,
        bytes: *const u8,
        num_bytes: CFIndex,
        encoding: CFStringEncoding,
        is_external_representation: Boolean,
    ) -> CFStringRef;
    pub fn CFStringGetLength(string: CFStringRef) -> CFIndex;
    pub fn CFStringGetBytes(
        string: CFStringRef,
        range: CFRange,
        encoding: CFStringEncoding,
        loss_byte: u8,
        is_external_representation: Boolean,
        buffer: *mut u8,
        max_buf_len: CFIndex,
        used_buf_len: *mut CFIndex,
    ) -> CFIndex;

    pub fn CFBooleanGetTypeID() -> CFTypeID;
    pub fn CFBooleanGetValue(boolean: CFBooleanRef) -> Boolean;

    pub fn CFNumberGetTypeID() -> CFTypeID;
    pub fn CFNumberGetValue(
        number: CFNumberRef,
        the_type: CFIndex,
        value_ptr: *mut c_void,
    ) -> Boolean;
    pub fn CFNumberCreate(
        alloc: CFAllocatorRef,
        the_type: CFIndex,
        value_ptr: *const c_void,
    ) -> CFNumberRef;

    pub fn CFArrayGetTypeID() -> CFTypeID;
    pub fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    pub fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> CFTypeRef;

    pub fn CFDictionaryGetTypeID() -> CFTypeID;
    pub fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
    pub fn CFDictionaryCreate(
        alloc: CFAllocatorRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        num_values: CFIndex,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFDictionaryRef;

    pub fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
    pub fn CFDataGetLength(data: CFDataRef) -> CFIndex;

    pub fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    pub fn CFRunLoopGetMain() -> CFRunLoopRef;
    pub fn CFRunLoopRun();
    pub fn CFRunLoopRunInMode(
        mode: CFStringRef,
        seconds: f64,
        return_after_source_handled: Boolean,
    ) -> i32;
    pub fn CFRunLoopStop(rl: CFRunLoopRef);
    pub fn CFRunLoopWakeUp(rl: CFRunLoopRef);
    pub fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
    pub fn CFRunLoopRemoveSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
    pub fn CFMachPortCreateRunLoopSource(
        alloc: CFAllocatorRef,
        port: CFMachPortRef,
        order: CFIndex,
    ) -> CFRunLoopSourceRef;
    pub fn CFMachPortInvalidate(port: CFMachPortRef);
}

// ---------- CoreGraphics ----------

pub type CGEventRef = *mut c_void;
pub type CGEventSourceRef = *mut c_void;
pub type CGEventTapProxy = *mut c_void;
pub type CGEventFlags = u64;
pub type CGEventType = u32;
pub type CGEventField = u32;
pub type CGKeyCode = u16;
pub type CGWindowID = u32;
pub type CGDirectDisplayID = u32;
pub type CGEventMask = u64;

pub const kCGEventSourceStateCombinedSessionState: i32 = 0;
pub const kCGEventSourceStateHIDSystemState: i32 = 1;
pub const kCGEventSourceStatePrivate: i32 = -1;

pub const kCGHIDEventTap: u32 = 0;
pub const kCGSessionEventTap: u32 = 1;
pub const kCGAnnotatedSessionEventTap: u32 = 2;

pub const kCGHeadInsertEventTap: u32 = 0;
pub const kCGTailAppendEventTap: u32 = 1;

pub const kCGEventTapOptionDefault: u32 = 0;
pub const kCGEventTapOptionListenOnly: u32 = 1;

pub const kCGEventNull: CGEventType = 0;
pub const kCGEventLeftMouseDown: CGEventType = 1;
pub const kCGEventLeftMouseUp: CGEventType = 2;
pub const kCGEventRightMouseDown: CGEventType = 3;
pub const kCGEventRightMouseUp: CGEventType = 4;
pub const kCGEventMouseMoved: CGEventType = 5;
pub const kCGEventLeftMouseDragged: CGEventType = 6;
pub const kCGEventRightMouseDragged: CGEventType = 7;
pub const kCGEventKeyDown: CGEventType = 10;
pub const kCGEventKeyUp: CGEventType = 11;
pub const kCGEventFlagsChanged: CGEventType = 12;
pub const kCGEventScrollWheel: CGEventType = 22;
pub const kCGEventOtherMouseDown: CGEventType = 25;
pub const kCGEventOtherMouseUp: CGEventType = 26;
pub const kCGEventOtherMouseDragged: CGEventType = 27;
pub const kCGEventTapDisabledByTimeout: CGEventType = 0xFFFF_FFFE;
pub const kCGEventTapDisabledByUserInput: CGEventType = 0xFFFF_FFFF;
/// `kCGAnyInputEventType`: any kind of input, for the idle time.
pub const kCGAnyInputEventType: CGEventType = 0xFFFF_FFFF;

pub const kCGMouseButtonLeft: u32 = 0;

pub const kCGEventFlagMaskAlphaShift: CGEventFlags = 0x0001_0000;
pub const kCGEventFlagMaskShift: CGEventFlags = 0x0002_0000;
pub const kCGEventFlagMaskControl: CGEventFlags = 0x0004_0000;
pub const kCGEventFlagMaskAlternate: CGEventFlags = 0x0008_0000;
pub const kCGEventFlagMaskCommand: CGEventFlags = 0x0010_0000;
pub const kCGEventFlagMaskSecondaryFn: CGEventFlags = 0x0080_0000;
pub const kCGEventFlagMaskNonCoalesced: CGEventFlags = 0x0000_0100;

pub const kCGKeyboardEventAutorepeat: CGEventField = 8;
pub const kCGKeyboardEventKeycode: CGEventField = 9;
/// `kCGEventSourceUserData`: a number the poster may put on an event, which Raphael uses to mark
/// the events it sends itself.
pub const kCGEventSourceUserData: CGEventField = 42;
pub const kCGEventSourceUnixProcessID: CGEventField = 41;
pub const kCGEventTargetUnixProcessID: CGEventField = 40;

pub const kCGWindowListOptionAll: u32 = 0;
pub const kCGWindowListOptionOnScreenOnly: u32 = 1 << 0;
pub const kCGWindowListOptionOnScreenAboveWindow: u32 = 1 << 1;
pub const kCGWindowListOptionOnScreenBelowWindow: u32 = 1 << 2;
pub const kCGWindowListOptionIncludingWindow: u32 = 1 << 3;
pub const kCGWindowListExcludeDesktopElements: u32 = 1 << 4;
pub const kCGNullWindowID: CGWindowID = 0;

pub type CGEventTapCallBack = unsafe extern "C" fn(
    proxy: CGEventTapProxy,
    event_type: CGEventType,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    pub static kCGWindowNumber: CFStringRef;
    pub static kCGWindowOwnerPID: CFStringRef;
    pub static kCGWindowOwnerName: CFStringRef;
    pub static kCGWindowName: CFStringRef;
    pub static kCGWindowLayer: CFStringRef;
    pub static kCGWindowBounds: CFStringRef;
    pub static kCGWindowAlpha: CFStringRef;
    pub static kCGWindowIsOnscreen: CFStringRef;

    pub fn CGEventSourceCreate(state_id: i32) -> CGEventSourceRef;
    pub fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: CGEventType) -> f64;
    pub fn CGEventSourceFlagsState(state_id: i32) -> CGEventFlags;
    pub fn CGEventSourceKeyState(state_id: i32, key: CGKeyCode) -> bool;
    pub fn CGEventSourceSetUserData(source: CGEventSourceRef, user_data: i64);
    pub fn CGEventSourceSetLocalEventsSuppressionInterval(source: CGEventSourceRef, seconds: f64);

    pub fn CGEventCreate(source: CGEventSourceRef) -> CGEventRef;
    pub fn CGEventCreateKeyboardEvent(
        source: CGEventSourceRef,
        virtual_key: CGKeyCode,
        key_down: bool,
    ) -> CGEventRef;
    pub fn CGEventCreateMouseEvent(
        source: CGEventSourceRef,
        mouse_type: CGEventType,
        mouse_cursor_position: CGPoint,
        mouse_button: u32,
    ) -> CGEventRef;
    pub fn CGEventCreateScrollWheelEvent2(
        source: CGEventSourceRef,
        units: u32,
        wheel_count: u32,
        wheel1: i32,
        wheel2: i32,
        wheel3: i32,
    ) -> CGEventRef;
    pub fn CGEventKeyboardSetUnicodeString(
        event: CGEventRef,
        string_length: usize,
        unicode_string: *const u16,
    );
    pub fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    pub fn CGEventGetFlags(event: CGEventRef) -> CGEventFlags;
    pub fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
    pub fn CGEventGetType(event: CGEventRef) -> CGEventType;
    pub fn CGEventSetType(event: CGEventRef, event_type: CGEventType);
    pub fn CGEventGetIntegerValueField(event: CGEventRef, field: CGEventField) -> i64;
    pub fn CGEventSetIntegerValueField(event: CGEventRef, field: CGEventField, value: i64);
    pub fn CGEventPost(tap: u32, event: CGEventRef);
    pub fn CGEventPostToPid(pid: i32, event: CGEventRef);

    pub fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: CGEventMask,
        callback: CGEventTapCallBack,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    pub fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    pub fn CGEventTapIsEnabled(tap: CFMachPortRef) -> bool;

    pub fn CGPreflightListenEventAccess() -> bool;
    pub fn CGRequestListenEventAccess() -> bool;
    pub fn CGPreflightPostEventAccess() -> bool;
    pub fn CGRequestPostEventAccess() -> bool;
    pub fn CGPreflightScreenCaptureAccess() -> bool;
    pub fn CGRequestScreenCaptureAccess() -> bool;

    pub fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: CGWindowID) -> CFArrayRef;
    pub fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect)
    -> bool;

    pub fn CGMainDisplayID() -> CGDirectDisplayID;
    pub fn CGDisplayBounds(display: CGDirectDisplayID) -> CGRect;
    pub fn CGDisplayIsAsleep(display: CGDirectDisplayID) -> u32;
    pub fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut CGDirectDisplayID,
        display_count: *mut u32,
    ) -> i32;
    pub fn CGWarpMouseCursorPosition(new_cursor_position: CGPoint) -> i32;
}

/// `CGEventMaskBit(type)`.
pub const fn event_mask(event_type: CGEventType) -> CGEventMask {
    1u64 << event_type
}

// ---------- the accessibility API (ApplicationServices / HIServices) ----------

pub type AXUIElementRef = *const c_void;
pub type AXValueRef = *const c_void;
pub type AXError = i32;
pub type AXObserverRef = *mut c_void;

pub const kAXErrorSuccess: AXError = 0;
pub const kAXErrorFailure: AXError = -25200;
pub const kAXErrorIllegalArgument: AXError = -25201;
pub const kAXErrorInvalidUIElement: AXError = -25202;
pub const kAXErrorCannotComplete: AXError = -25204;
pub const kAXErrorAttributeUnsupported: AXError = -25205;
pub const kAXErrorActionUnsupported: AXError = -25206;
pub const kAXErrorNoValue: AXError = -25212;
pub const kAXErrorAPIDisabled: AXError = -25211;

pub const kAXValueTypeCGPoint: u32 = 1;
pub const kAXValueTypeCGSize: u32 = 2;
pub const kAXValueTypeCGRect: u32 = 3;
pub const kAXValueTypeCFRange: u32 = 4;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    pub static kAXTrustedCheckOptionPrompt: CFStringRef;

    pub fn AXIsProcessTrusted() -> bool;
    pub fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    pub fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    pub fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    pub fn AXUIElementGetTypeID() -> CFTypeID;
    pub fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    pub fn AXUIElementCopyAttributeValues(
        element: AXUIElementRef,
        attribute: CFStringRef,
        index: CFIndex,
        max_values: CFIndex,
        values: *mut CFArrayRef,
    ) -> AXError;
    pub fn AXUIElementCopyAttributeNames(
        element: AXUIElementRef,
        names: *mut CFArrayRef,
    ) -> AXError;
    pub fn AXUIElementCopyActionNames(element: AXUIElementRef, names: *mut CFArrayRef) -> AXError;
    pub fn AXUIElementIsAttributeSettable(
        element: AXUIElementRef,
        attribute: CFStringRef,
        settable: *mut Boolean,
    ) -> AXError;
    pub fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    pub fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    pub fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> AXError;
    pub fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> AXError;
    pub fn AXUIElementCopyElementAtPosition(
        application: AXUIElementRef,
        x: f32,
        y: f32,
        element: *mut AXUIElementRef,
    ) -> AXError;
    pub fn AXUIElementCopyParameterizedAttributeValue(
        element: AXUIElementRef,
        parameterized_attribute: CFStringRef,
        parameter: CFTypeRef,
        result: *mut CFTypeRef,
    ) -> AXError;
    pub fn AXValueGetTypeID() -> CFTypeID;
    pub fn AXValueGetType(value: AXValueRef) -> u32;
    pub fn AXValueGetValue(value: AXValueRef, the_type: u32, value_ptr: *mut c_void) -> bool;
    pub fn AXValueCreate(the_type: u32, value_ptr: *const c_void) -> AXValueRef;

    /// Private, but stable since macOS 10.5 and what every window manager uses: the window
    /// server's number of an accessibility window.
    pub fn _AXUIElementGetWindow(element: AXUIElementRef, window: *mut CGWindowID) -> AXError;
}

// ---------- IOKit power management ----------

pub type IOPMAssertionID = u32;
pub type IOReturn = i32;
pub const kIOPMAssertionLevelOn: u32 = 255;
pub const kIOReturnSuccess: IOReturn = 0;

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    pub fn IOPMAssertionCreateWithName(
        assertion_type: CFStringRef,
        level: u32,
        name: CFStringRef,
        assertion_id: *mut IOPMAssertionID,
    ) -> IOReturn;
    pub fn IOPMAssertionRelease(assertion_id: IOPMAssertionID) -> IOReturn;
}

// ---------- HIToolbox: keyboard layouts and secure input ----------

pub type TISInputSourceRef = *const c_void;
pub type UniChar = u16;
pub type UniCharCount = usize;
pub type OSStatus = i32;

pub const kUCKeyActionDown: u16 = 0;
pub const kUCKeyTranslateNoDeadKeysBit: u32 = 0;
/// `optionKey >> 8`: the Option modifier as `UCKeyTranslate` takes it.
pub const kUCOptionModifier: u32 = 0x08;
/// `shiftKey >> 8`.
pub const kUCShiftModifier: u32 = 0x02;

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    pub static kTISPropertyUnicodeKeyLayoutData: CFStringRef;

    pub fn TISCopyCurrentKeyboardLayoutInputSource() -> TISInputSourceRef;
    pub fn TISCopyCurrentKeyboardInputSource() -> TISInputSourceRef;
    pub fn TISGetInputSourceProperty(source: TISInputSourceRef, key: CFStringRef) -> *const c_void;
    pub fn LMGetKbdType() -> u8;
    pub fn UCKeyTranslate(
        key_layout_ptr: *const c_void,
        virtual_key_code: u16,
        key_action: u16,
        modifier_key_state: u32,
        keyboard_type: u32,
        key_translate_options: u32,
        dead_key_state: *mut u32,
        max_string_length: UniCharCount,
        actual_string_length: *mut UniCharCount,
        unicode_string: *mut UniChar,
    ) -> OSStatus;
    pub fn IsSecureEventInputEnabled() -> Boolean;
}

// ---------- libdispatch and pthread (libSystem) ----------

/// A dispatch queue, opaque.
#[repr(C)]
pub struct DispatchQueue {
    _private: [u8; 0],
}

unsafe extern "C" {
    /// The main queue (`dispatch_get_main_queue()` is this symbol's address).
    pub static _dispatch_main_q: DispatchQueue;

    pub fn dispatch_async_f(
        queue: *const DispatchQueue,
        context: *mut c_void,
        work: unsafe extern "C" fn(*mut c_void),
    );
    pub fn pthread_main_np() -> i32;
}

// ---------- AVFoundation (only its classes are used, through the Objective-C runtime) ----------

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {}

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}

// ---------- libproc ----------

pub const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;

unsafe extern "C" {
    pub fn proc_pidpath(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
}

// ---------- for operating the desktop (computer/ax.rs, computer/watch.rs) ----------

/// `kCGEventSourceStateID`: which event source state an event came from; `1` is the keyboard and
/// the mouse themselves (`kCGEventSourceStateHIDSystemState`).
pub const kCGEventSourceStateID: CGEventField = 45;
/// `kAXValueTypeAXError`: the placeholder `AXUIElementCopyMultipleAttributeValues` puts for an
/// attribute that could not be read.
pub const kAXValueTypeAXError: u32 = 5;

pub type CGDisplayModeRef = *mut c_void;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    /// `CFArrayCallBacks`: version and four function pointers.
    pub static kCFTypeArrayCallBacks: [usize; 5];

    pub fn CFArrayCreate(
        alloc: CFAllocatorRef,
        values: *const CFTypeRef,
        num_values: CFIndex,
        callbacks: *const c_void,
    ) -> CFArrayRef;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    pub fn AXUIElementGetAttributeValueCount(
        element: AXUIElementRef,
        attribute: CFStringRef,
        count: *mut CFIndex,
    ) -> AXError;
    pub fn AXUIElementCopyMultipleAttributeValues(
        element: AXUIElementRef,
        attributes: CFArrayRef,
        options: u32,
        values: *mut CFArrayRef,
    ) -> AXError;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    pub fn CGGetDisplaysWithPoint(
        point: CGPoint,
        max_displays: u32,
        displays: *mut CGDirectDisplayID,
        matching_display_count: *mut u32,
    ) -> i32;
    pub fn CGDisplayCopyDisplayMode(display: CGDirectDisplayID) -> CGDisplayModeRef;
    pub fn CGDisplayModeGetWidth(mode: CGDisplayModeRef) -> usize;
    pub fn CGDisplayModeGetPixelWidth(mode: CGDisplayModeRef) -> usize;
    pub fn CGDisplayModeRelease(mode: CGDisplayModeRef);
}
