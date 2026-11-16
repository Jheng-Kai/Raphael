//! Posting keys and mouse clicks, and reading the keyboard layout.
//!
//! Every event the shell posts comes from a private event source and carries
//! `handy_keys::RAPHAEL_INPUT_MARKER` in `kCGEventSourceUserData`, so that Raphael's own hotkey tap
//! and the watch on the owner's input both know it for Raphael's and let it pass.

use std::thread;
use std::time::Duration;

use super::cf::Cf;
use super::ffi::*;

/// The pause between two posted events: some apps read the keyboard's state while they handle a
/// key, and a chord sent all at once can reach them before its modifier.
const BETWEEN_EVENTS: Duration = Duration::from_millis(8);

/// Virtual key codes (kVK_* in HIToolbox's Events.h) of the keys that do not depend on the layout.
pub mod code {
    pub const RETURN: u16 = 0x24;
    pub const TAB: u16 = 0x30;
    pub const SPACE: u16 = 0x31;
    pub const DELETE: u16 = 0x33;
    pub const ESCAPE: u16 = 0x35;
    pub const COMMAND: u16 = 0x37;
    pub const SHIFT: u16 = 0x38;
    pub const OPTION: u16 = 0x3A;
    pub const CONTROL: u16 = 0x3B;
    pub const FORWARD_DELETE: u16 = 0x75;
    pub const HOME: u16 = 0x73;
    pub const END: u16 = 0x77;
    pub const PAGE_UP: u16 = 0x74;
    pub const PAGE_DOWN: u16 = 0x79;
    pub const LEFT: u16 = 0x7B;
    pub const RIGHT: u16 = 0x7C;
    pub const DOWN: u16 = 0x7D;
    pub const UP: u16 = 0x7E;
    pub const F1: u16 = 0x7A;
    pub const F2: u16 = 0x78;
    pub const F3: u16 = 0x63;
    pub const F4: u16 = 0x76;
    pub const F5: u16 = 0x60;
    pub const F6: u16 = 0x61;
    pub const F7: u16 = 0x62;
    pub const F8: u16 = 0x64;
    pub const F9: u16 = 0x65;
    pub const F10: u16 = 0x6D;
    pub const F11: u16 = 0x67;
    pub const F12: u16 = 0x6F;
    /// The ANSI positions of the letters, used when the layout cannot be read.
    pub const ANSI_V: u16 = 0x09;
    pub const ANSI_C: u16 = 0x08;
}

/// The keys of the ANSI layout's letters, digits and punctuation, by position: the keys whose
/// character the layout decides.
const CHARACTER_KEYS: [u16; 50] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10,
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20,
    0x21, 0x22, 0x23, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x32, 0x0A,
    0x5D, 0x5E,
];

/// A modifier of a posted chord.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Modifier {
    Command,
    Shift,
    Option,
    Control,
}

impl Modifier {
    fn code(self) -> u16 {
        match self {
            Modifier::Command => code::COMMAND,
            Modifier::Shift => code::SHIFT,
            Modifier::Option => code::OPTION,
            Modifier::Control => code::CONTROL,
        }
    }

    fn flag(self) -> CGEventFlags {
        match self {
            Modifier::Command => kCGEventFlagMaskCommand,
            Modifier::Shift => kCGEventFlagMaskShift,
            Modifier::Option => kCGEventFlagMaskAlternate,
            Modifier::Control => kCGEventFlagMaskControl,
        }
    }
}

fn source() -> Option<Cf> {
    // SAFETY: a Create function; the result is owned.
    let source =
        unsafe { Cf::owned(CGEventSourceCreate(kCGEventSourceStatePrivate).cast_const()) }?;
    // SAFETY: a valid source.
    unsafe {
        CGEventSourceSetUserData(
            source.as_ptr().cast_mut(),
            handy_keys::RAPHAEL_INPUT_MARKER as i64,
        );
    }
    Some(source)
}

fn mark(event: CGEventRef) {
    // SAFETY: a valid event.
    unsafe {
        CGEventSetIntegerValueField(
            event,
            kCGEventSourceUserData,
            handy_keys::RAPHAEL_INPUT_MARKER as i64,
        );
    }
}

fn post_key(source: &Cf, key: u16, down: bool, flags: CGEventFlags) -> bool {
    // SAFETY: a valid source; the event is owned and released after it is posted.
    unsafe {
        let Some(event) = Cf::owned(
            CGEventCreateKeyboardEvent(source.as_ptr().cast_mut(), key, down).cast_const(),
        ) else {
            return false;
        };
        let event_ref = event.as_ptr().cast_mut();
        CGEventSetFlags(event_ref, flags | kCGEventFlagMaskNonCoalesced);
        mark(event_ref);
        CGEventPost(kCGHIDEventTap, event_ref);
    }
    true
}

/// Presses `modifiers`, clicks `key`, calls `hold` with the modifiers still down, then releases
/// them. Whether the key click went out.
pub fn chord(modifiers: &[Modifier], key: u16, hold: impl FnOnce()) -> bool {
    let Some(source) = source() else {
        log::error!("keys: could not create an event source");
        return false;
    };
    let mut flags: CGEventFlags = 0;
    let mut pressed = 0;
    for modifier in modifiers {
        flags |= modifier.flag();
        if !post_key(&source, modifier.code(), true, flags) {
            break;
        }
        pressed += 1;
        thread::sleep(BETWEEN_EVENTS);
    }
    let mut clicked = false;
    if pressed == modifiers.len() {
        clicked = post_key(&source, key, true, flags);
        thread::sleep(BETWEEN_EVENTS);
        clicked &= post_key(&source, key, false, flags);
        if clicked {
            hold();
        }
    }
    for modifier in modifiers[..pressed].iter().rev() {
        flags &= !modifier.flag();
        post_key(&source, modifier.code(), false, flags);
        thread::sleep(BETWEEN_EVENTS);
    }
    clicked
}

/// Types `text` as Unicode, a few characters per event, whatever the layout.
pub fn type_text(text: &str, mut before_each: impl FnMut() -> bool) -> bool {
    let Some(source) = source() else {
        return false;
    };
    let units: Vec<u16> = text.encode_utf16().collect();
    // Twenty UTF-16 units per event is what the window server takes at once; a surrogate pair is
    // never split.
    let mut start = 0;
    while start < units.len() {
        let mut end = (start + 20).min(units.len());
        if end < units.len() && (0xD800..0xDC00).contains(&units[end - 1]) {
            end -= 1;
        }
        if !before_each() {
            return false;
        }
        for down in [true, false] {
            // SAFETY: a valid source; the event is owned; the units are as long as said.
            unsafe {
                let Some(event) = Cf::owned(
                    CGEventCreateKeyboardEvent(source.as_ptr().cast_mut(), 0, down).cast_const(),
                ) else {
                    return false;
                };
                let event_ref = event.as_ptr().cast_mut();
                CGEventKeyboardSetUnicodeString(event_ref, end - start, units[start..end].as_ptr());
                CGEventSetFlags(event_ref, kCGEventFlagMaskNonCoalesced);
                mark(event_ref);
                CGEventPost(kCGHIDEventTap, event_ref);
            }
        }
        thread::sleep(BETWEEN_EVENTS);
        start = end;
    }
    true
}

/// A mouse click with the left button at `point` (screen points, top-left origin).
pub fn click(point: CGPoint) -> bool {
    let Some(source) = source() else {
        return false;
    };
    for kind in [kCGEventLeftMouseDown, kCGEventLeftMouseUp] {
        // SAFETY: a valid source; the event is owned.
        unsafe {
            let Some(event) = Cf::owned(
                CGEventCreateMouseEvent(
                    source.as_ptr().cast_mut(),
                    kind,
                    point,
                    kCGMouseButtonLeft,
                )
                .cast_const(),
            ) else {
                return false;
            };
            let event_ref = event.as_ptr().cast_mut();
            mark(event_ref);
            CGEventPost(kCGHIDEventTap, event_ref);
        }
        thread::sleep(Duration::from_millis(30));
    }
    true
}

/// A scroll of `lines` lines (positive is up, as the wheel turns away from the person).
pub fn scroll(vertical: i32, horizontal: i32) -> bool {
    let Some(source) = source() else {
        return false;
    };
    // SAFETY: a valid source; the event is owned. Unit 1 is kCGScrollEventUnitLine.
    unsafe {
        let Some(event) = Cf::owned(
            CGEventCreateScrollWheelEvent2(
                source.as_ptr().cast_mut(),
                1,
                2,
                vertical,
                horizontal,
                0,
            )
            .cast_const(),
        ) else {
            return false;
        };
        let event_ref = event.as_ptr().cast_mut();
        mark(event_ref);
        CGEventPost(kCGHIDEventTap, event_ref);
    }
    true
}

/// The current keyboard layout's `uchr` data, kept alive by the input source it came from.
struct Layout {
    _source: Cf,
    data: CFDataRef,
}

fn layout() -> Option<Layout> {
    // SAFETY: a Copy function's result is owned; the property is valid while the source is.
    unsafe {
        let source = Cf::owned(TISCopyCurrentKeyboardLayoutInputSource())?;
        let data = TISGetInputSourceProperty(source.as_ptr(), kTISPropertyUnicodeKeyLayoutData);
        (!data.is_null()).then_some(Layout {
            _source: source,
            data,
        })
    }
}

/// What `key` types on the layout with `modifiers` held (UCKeyTranslate's modifier bits).
fn translate(layout: &Layout, key: u16, modifiers: u32) -> Option<String> {
    let mut dead_keys: u32 = 0;
    let mut length: UniCharCount = 0;
    let mut buffer = [0u16; 8];
    // SAFETY: the layout data is a valid `uchr` while `layout` lives; the buffer is as long as
    // said.
    let status = unsafe {
        UCKeyTranslate(
            CFDataGetBytePtr(layout.data).cast(),
            key,
            kUCKeyActionDown,
            modifiers,
            u32::from(LMGetKbdType()),
            1 << kUCKeyTranslateNoDeadKeysBit,
            &mut dead_keys,
            buffer.len(),
            &mut length,
            buffer.as_mut_ptr(),
        )
    };
    (status == 0 && length > 0).then(|| String::from_utf16_lossy(&buffer[..length.min(8)]))
}

/// The key that types `character` (lowercase, no modifier) on the current layout. The shortcut
/// ⌘V means the key that types "v", which is another key on Dvorak or AZERTY.
pub fn key_for(character: char) -> Option<u16> {
    let layout = layout()?;
    let wanted = character.to_string();
    CHARACTER_KEYS
        .into_iter()
        .find(|&key| translate(&layout, key, 0).is_some_and(|typed| typed == wanted))
}

/// Whether the current layout types plain ASCII characters with Option that it has on no key
/// without it (`@` on a German keyboard, `[` on a Swedish one): Option is then needed for typing,
/// as AltGr is on Windows, and a hotkey that holds Right Option gets in its way.
pub fn layout_needs_option() -> bool {
    let Some(layout) = layout() else {
        return false;
    };
    let mut plain = std::collections::HashSet::new();
    for key in CHARACTER_KEYS {
        for modifiers in [0, kUCShiftModifier] {
            if let Some(typed) = translate(&layout, key, modifiers) {
                plain.extend(typed.chars());
            }
        }
    }
    CHARACTER_KEYS.into_iter().any(|key| {
        [kUCOptionModifier, kUCOptionModifier | kUCShiftModifier]
            .into_iter()
            .filter_map(|modifiers| translate(&layout, key, modifiers))
            .flat_map(|typed| typed.chars().collect::<Vec<_>>())
            .any(|c| c.is_ascii_graphic() && !plain.contains(&c))
    })
}
