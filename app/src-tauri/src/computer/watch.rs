//! The watch on the owner's own mouse and keyboard while Raphael operates: the owner wins.
//!
//! While a run is under way (armed by `computer.state` `begin` and `step`, off for `pause` and
//! `end`), any input of the owner's stops it at once: a key, a click, the wheel, or the mouse
//! moved more than a little. Raphael's own input never counts: everything it sends goes through
//! `SendInput`, which Windows marks as injected (`LLKHF_INJECTED`, `LLMHF_INJECTED`), and UI
//! Automation's patterns send no input at all.
//!
//! Two keys are left to others: Esc, which the hotkey service turns into the controller's cancel
//! (it hides the overlay and stops the run itself, and the shell then says 《了。已停止。》), and
//! the release of a key, so that a key the owner was holding when the run began does not stop it.
//! The mouse has a short grace after the watch is armed: the owner who just clicked 「是」 on the
//! overlay is still moving the hand away from it.
//!
//! [`Judge`] is the decision, a pure function of the events and the clock; [`hook`] holds the
//! low-level hooks of Windows (a listen-only event tap on macOS) that feed it, installed only
//! while a run is under way. Nothing here logs a key.
//!
//! On macOS Raphael's own input is told apart the same way: everything it posts carries its marker
//! in `kCGEventSourceUserData`, and an event that did not come from the keyboard or the mouse
//! themselves (its source state is not the HID system's) counts as injected. Esc is macOS's key
//! code 0x35, given to the judge as Windows' 0x1B; every other key code is given out of the range
//! of Windows' virtual keys, so that none of them is ever taken for Esc.

use std::time::{Duration, Instant};

/// The virtual-key code of Esc.
const VK_ESCAPE: u32 = 0x1B;
/// How far the mouse may move, in pixels added up, before it counts.
pub const MOVE_THRESHOLD_PX: i64 = 24;
/// How long after the watch is armed the mouse may move freely.
pub const MOVE_GRACE: Duration = Duration::from_millis(1500);

/// An input event, as the hooks see it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Input {
    Key { vk: u32, down: bool, injected: bool },
    Move { x: i32, y: i32, injected: bool },
    Button { injected: bool },
    Wheel { injected: bool },
}

/// Whether an input is the owner's, so that the run stops.
#[derive(Debug)]
pub struct Judge {
    armed_at: Option<Instant>,
    last: Option<(i32, i32)>,
    travelled: i64,
}

impl Default for Judge {
    fn default() -> Self {
        Self::new()
    }
}

impl Judge {
    pub fn new() -> Self {
        Self {
            armed_at: None,
            last: None,
            travelled: 0,
        }
    }

    /// The watch is on from `now`.
    pub fn arm(&mut self, now: Instant) {
        self.armed_at = Some(now);
        self.last = None;
        self.travelled = 0;
    }

    /// The watch is off.
    pub fn disarm(&mut self) {
        self.armed_at = None;
    }

    #[cfg(test)]
    pub fn armed(&self) -> bool {
        self.armed_at.is_some()
    }

    /// Whether `input`, at `now`, is the owner's own and stops the run. Once it has said so, the
    /// watch is off: the run is stopping.
    pub fn owners(&mut self, input: Input, now: Instant) -> bool {
        let Some(armed_at) = self.armed_at else {
            return false;
        };
        let theirs = match input {
            Input::Key { injected: true, .. }
            | Input::Move { injected: true, .. }
            | Input::Button { injected: true }
            | Input::Wheel { injected: true } => false,
            Input::Key { vk, down, .. } => down && vk != VK_ESCAPE,
            Input::Button { .. } | Input::Wheel { .. } => true,
            Input::Move { x, y, .. } => {
                let last = self.last.replace((x, y));
                if now.saturating_duration_since(armed_at) < MOVE_GRACE {
                    false
                } else if let Some((lx, ly)) = last {
                    self.travelled += i64::from((x - lx).abs()) + i64::from((y - ly).abs());
                    self.travelled > MOVE_THRESHOLD_PX
                } else {
                    false
                }
            }
        };
        if theirs {
            self.disarm();
        }
        theirs
    }
}

#[cfg(windows)]
pub mod hook {
    //! The low-level keyboard and mouse hooks of Windows, on a thread of their own with its
    //! message loop, installed by [`Watch::start`] and taken out by [`Watch::stop`] (or when it is
    //! dropped). A hook only reads: every event is passed on, whatever the judge says.

    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Instant;

    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
        LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, PostThreadMessageW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN,
        WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_QUIT,
        WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_XBUTTONDOWN,
    };

    use super::{Input, Judge};
    use crate::rpc::lock;

    /// What the hooks report to: the judge, and who is told when the owner's input stops the run.
    struct Watching {
        judge: Judge,
        told: Option<Box<dyn Fn() + Send>>,
    }

    /// One watch at a time: the hooks are plain functions and find it here.
    static WATCHING: Mutex<Option<Watching>> = Mutex::new(None);

    fn judge(input: Input) {
        let mut watching = lock(&WATCHING);
        let Some(watch) = watching.as_mut() else {
            return;
        };
        if watch.judge.owners(input, Instant::now())
            && let Some(told) = &watch.told
        {
            told();
        }
    }

    unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            // SAFETY: for WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT.
            let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let message = wparam.0 as u32;
            judge(Input::Key {
                vk: event.vkCode,
                down: message == WM_KEYDOWN || message == WM_SYSKEYDOWN,
                injected: event.flags.0 & LLKHF_INJECTED.0 != 0,
            });
        }
        // SAFETY: passing the event on, as every hook must.
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    unsafe extern "system" fn mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            // SAFETY: for WH_MOUSE_LL, lparam points to an MSLLHOOKSTRUCT.
            let event = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            let injected = event.flags & LLMHF_INJECTED != 0;
            let input = match wparam.0 as u32 {
                WM_MOUSEMOVE => Some(Input::Move {
                    x: event.pt.x,
                    y: event.pt.y,
                    injected,
                }),
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN => {
                    Some(Input::Button { injected })
                }
                WM_MOUSEWHEEL | WM_MOUSEHWHEEL => Some(Input::Wheel { injected }),
                _ => None,
            };
            if let Some(input) = input {
                judge(input);
            }
        }
        // SAFETY: passing the event on, as every hook must.
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// The hooks' thread, while they are in.
    pub struct Watch {
        thread_id: u32,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Watch {
        /// Puts the hooks in, unarmed; `told` is called (on the hooks' thread, so it must be
        /// quick) when the owner's input stops the run.
        pub fn start(told: Box<dyn Fn() + Send>) -> Option<Watch> {
            *lock(&WATCHING) = Some(Watching {
                judge: Judge::new(),
                told: Some(told),
            });
            let (ready, started) = mpsc::channel();
            let thread = std::thread::Builder::new()
                .name("raphael-computer-watch".into())
                .spawn(move || {
                    // SAFETY: the hooks are this thread's, and taken out before it ends.
                    let hooks = unsafe {
                        (
                            SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), None, 0),
                            SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), None, 0),
                        )
                    };
                    let id = unsafe { GetCurrentThreadId() };
                    let ok = hooks.0.is_ok() && hooks.1.is_ok();
                    let _ = ready.send(ok.then_some(id));
                    if ok {
                        let mut message = MSG::default();
                        // SAFETY: a plain message loop, ended by WM_QUIT.
                        while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
                            unsafe {
                                let _ = TranslateMessage(&message);
                                DispatchMessageW(&message);
                            }
                        }
                    }
                    for hook in [hooks.0, hooks.1].into_iter().flatten() {
                        // SAFETY: a hook this thread put in.
                        let _ = unsafe { UnhookWindowsHookEx(hook) };
                    }
                })
                .ok()?;
            match started.recv().ok().flatten() {
                Some(thread_id) => Some(Watch {
                    thread_id,
                    thread: Some(thread),
                }),
                None => {
                    log::warn!("computer: the watch on the owner's input could not start");
                    let _ = thread.join();
                    *lock(&WATCHING) = None;
                    None
                }
            }
        }

        /// The watch counts the owner's input from now (with the mouse's grace).
        pub fn arm(&self) {
            if let Some(watch) = lock(&WATCHING).as_mut() {
                watch.judge.arm(Instant::now());
            }
        }

        /// The owner's input does not count (a question is on screen).
        pub fn disarm(&self) {
            if let Some(watch) = lock(&WATCHING).as_mut() {
                watch.judge.disarm();
            }
        }

        /// Takes the hooks out and ends their thread.
        pub fn stop(mut self) {
            self.end();
        }

        fn end(&mut self) {
            *lock(&WATCHING) = None;
            if let Some(thread) = self.thread.take() {
                // SAFETY: a message to a thread of this process.
                let _ =
                    unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
                let _ = thread.join();
            }
        }
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            self.end();
        }
    }
}

#[cfg(target_os = "macos")]
pub mod hook {
    //! The owner's keyboard and mouse on macOS: a listen-only event tap on a thread of its own with
    //! its run loop, put in by [`Watch::start`] and taken out by [`Watch::stop`] (or when it is
    //! dropped). The tap only reads: every event goes on, whatever the judge says. It needs the
    //! Input Monitoring permission (or Accessibility) for the keys: macOS takes the events it does
    //! not allow out of a tap's mask and refuses only a tap left with none, so a tap of keys and mouse
    //! together is made without it and sees the mouse alone. The keys are tried first, in a tap of
    //! their own ([`keys_delivered`]); without them the watch does not start and the run is refused
    //! (`watch`), as on Windows.

    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use std::sync::{Arc, Mutex, mpsc};
    use std::time::Instant;

    use super::{Input, Judge, VK_ESCAPE};
    use crate::macos::ffi::*;
    use crate::rpc::lock;

    /// macOS's key code of Esc (`kVK_Escape`).
    const MAC_ESCAPE: i64 = 0x35;
    /// How often the tap's thread looks whether it is to end, in seconds.
    const STOP_CHECK_S: f64 = 0.25;

    /// What the tap reports to: the judge, and who is told when the owner's input stops the run.
    struct Watching {
        judge: Judge,
        told: Option<Box<dyn Fn() + Send>>,
    }

    /// One watch at a time: the tap's callback is a plain function and finds it here.
    static WATCHING: Mutex<Option<Watching>> = Mutex::new(None);
    /// The tap, so that the callback can turn it on again when macOS turned it off.
    static TAP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

    fn judge(input: Input) {
        let mut watching = lock(&WATCHING);
        let Some(watch) = watching.as_mut() else {
            return;
        };
        if watch.judge.owners(input, Instant::now())
            && let Some(told) = &watch.told
        {
            told();
        }
    }

    /// The key code as the judge reads it: Esc as Windows' Esc, every other key out of the range of
    /// Windows' virtual keys.
    pub(crate) fn judged_key(code: i64) -> u32 {
        if code == MAC_ESCAPE {
            VK_ESCAPE
        } else {
            0x1_0000 | (code as u32 & 0xFFFF)
        }
    }

    /// The flag of a modifier key, which says whether a `FlagsChanged` event pressed or released
    /// it.
    pub(crate) fn modifier_flag(code: i64) -> Option<CGEventFlags> {
        match code {
            0x37 | 0x36 => Some(kCGEventFlagMaskCommand),
            0x38 | 0x3C => Some(kCGEventFlagMaskShift),
            0x3A | 0x3D => Some(kCGEventFlagMaskAlternate),
            0x3B | 0x3E => Some(kCGEventFlagMaskControl),
            0x39 => Some(kCGEventFlagMaskAlphaShift),
            0x3F => Some(kCGEventFlagMaskSecondaryFn),
            _ => None,
        }
    }

    /// Whether Raphael posted the event, or any program did: only the keyboard and the mouse
    /// themselves are the owner's.
    pub(crate) fn injected(marker: i64, source_state: i64) -> bool {
        marker == handy_keys::RAPHAEL_INPUT_MARKER as i64
            || source_state != i64::from(kCGEventSourceStateHIDSystemState)
    }

    // The event types are the framework's constants, under the framework's own names.
    #[allow(non_upper_case_globals)]
    unsafe extern "C" fn callback(
        _proxy: CGEventTapProxy,
        event_type: CGEventType,
        event: CGEventRef,
        _user_info: *mut c_void,
    ) -> CGEventRef {
        if matches!(
            event_type,
            kCGEventTapDisabledByTimeout | kCGEventTapDisabledByUserInput
        ) {
            let tap = TAP.load(Ordering::SeqCst);
            if !tap.is_null() {
                // SAFETY: the tap lives until its thread ends, which clears TAP first.
                unsafe { CGEventTapEnable(tap, true) };
            }
            return event;
        }
        if event.is_null() {
            return event;
        }
        // SAFETY: a valid event, for the duration of the callback.
        let input = unsafe {
            let injected = injected(
                CGEventGetIntegerValueField(event, kCGEventSourceUserData),
                CGEventGetIntegerValueField(event, kCGEventSourceStateID),
            );
            let code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
            match event_type {
                kCGEventKeyDown | kCGEventKeyUp => Some(Input::Key {
                    vk: judged_key(code),
                    down: event_type == kCGEventKeyDown,
                    injected,
                }),
                kCGEventFlagsChanged => Some(Input::Key {
                    vk: judged_key(code),
                    down: modifier_flag(code)
                        .is_some_and(|flag| CGEventGetFlags(event) & flag != 0),
                    injected,
                }),
                kCGEventMouseMoved
                | kCGEventLeftMouseDragged
                | kCGEventRightMouseDragged
                | kCGEventOtherMouseDragged => {
                    let point = CGEventGetLocation(event);
                    Some(Input::Move {
                        x: point.x.round() as i32,
                        y: point.y.round() as i32,
                        injected,
                    })
                }
                kCGEventLeftMouseDown | kCGEventRightMouseDown | kCGEventOtherMouseDown => {
                    Some(Input::Button { injected })
                }
                kCGEventScrollWheel => Some(Input::Wheel { injected }),
                _ => None,
            }
        };
        if let Some(input) = input {
            judge(input);
        }
        event
    }

    /// The events the tap reads.
    fn mask() -> CGEventMask {
        [
            kCGEventKeyDown,
            kCGEventKeyUp,
            kCGEventFlagsChanged,
            kCGEventMouseMoved,
            kCGEventLeftMouseDragged,
            kCGEventRightMouseDragged,
            kCGEventOtherMouseDragged,
            kCGEventLeftMouseDown,
            kCGEventRightMouseDown,
            kCGEventOtherMouseDown,
            kCGEventScrollWheel,
        ]
        .into_iter()
        .fold(0, |mask, kind| mask | event_mask(kind))
    }

    /// The keys alone, which the owner presses to stop a run. A modifier's change is left out: were
    /// it delivered without Input Monitoring, a tap of it alone would still be made.
    fn key_mask() -> CGEventMask {
        [kCGEventKeyDown, kCGEventKeyUp]
            .into_iter()
            .fold(0, |mask, kind| mask | event_mask(kind))
    }

    /// Whether macOS delivers the keyboard to a listening tap: a tap of the keys alone is made only
    /// then. Made and taken out at once, on the thread that then makes the watch's tap.
    ///
    /// # Safety
    ///
    /// The caller is the thread that would own the tap.
    unsafe fn keys_delivered() -> bool {
        // SAFETY: the probe is this thread's, released here and never put on a run loop.
        unsafe {
            let probe = CGEventTapCreate(
                kCGSessionEventTap,
                kCGHeadInsertEventTap,
                kCGEventTapOptionListenOnly,
                key_mask(),
                callback,
                std::ptr::null_mut(),
            );
            if probe.is_null() {
                return false;
            }
            CFMachPortInvalidate(probe);
            CFRelease(probe.cast_const());
            true
        }
    }

    /// The tap's thread, while it is in.
    pub struct Watch {
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Watch {
        /// Puts the tap in, unarmed; `told` is called (on the tap's thread, so it must be quick)
        /// when the owner's input stops the run.
        pub fn start(told: Box<dyn Fn() + Send>) -> Option<Watch> {
            // macOS asks the owner once, the first time; until the keys are allowed no run is watched.
            crate::macos::permissions::input_monitoring(true);
            *lock(&WATCHING) = Some(Watching {
                judge: Judge::new(),
                told: Some(told),
            });
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let (ready, started) = mpsc::channel();
            let thread = std::thread::Builder::new()
                .name("raphael-computer-watch".into())
                .spawn(move || {
                    // SAFETY: the tap, its source and the run loop are this thread's; everything
                    // made here is released here, the tap last.
                    unsafe {
                        // A tap of the mouse alone would leave the owner's keys unable to stop it.
                        if !keys_delivered() {
                            let _ = ready.send(false);
                            return;
                        }
                        let tap = CGEventTapCreate(
                            kCGSessionEventTap,
                            kCGHeadInsertEventTap,
                            kCGEventTapOptionListenOnly,
                            mask(),
                            callback,
                            std::ptr::null_mut(),
                        );
                        if tap.is_null() {
                            let _ = ready.send(false);
                            return;
                        }
                        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
                        if source.is_null() {
                            CFMachPortInvalidate(tap);
                            CFRelease(tap.cast_const());
                            let _ = ready.send(false);
                            return;
                        }
                        let run_loop = CFRunLoopGetCurrent();
                        CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
                        TAP.store(tap, Ordering::SeqCst);
                        CGEventTapEnable(tap, true);
                        let _ = ready.send(true);
                        while !stopping.load(Ordering::SeqCst) {
                            CFRunLoopRunInMode(kCFRunLoopDefaultMode, STOP_CHECK_S, 0);
                        }
                        TAP.store(std::ptr::null_mut(), Ordering::SeqCst);
                        CGEventTapEnable(tap, false);
                        CFRunLoopRemoveSource(run_loop, source, kCFRunLoopCommonModes);
                        CFMachPortInvalidate(tap);
                        CFRelease(source.cast_const());
                        CFRelease(tap.cast_const());
                    }
                })
                .ok()?;
            if started.recv().unwrap_or(false) {
                Some(Watch {
                    stop,
                    thread: Some(thread),
                })
            } else {
                log::warn!(
                    "computer: the watch on the owner's input could not start \
                     (no Input Monitoring permission: the keys are not delivered)"
                );
                let _ = thread.join();
                *lock(&WATCHING) = None;
                None
            }
        }

        /// The watch counts the owner's input from now (with the mouse's grace).
        pub fn arm(&self) {
            if let Some(watch) = lock(&WATCHING).as_mut() {
                watch.judge.arm(Instant::now());
            }
        }

        /// The owner's input does not count (a question is on screen).
        pub fn disarm(&self) {
            if let Some(watch) = lock(&WATCHING).as_mut() {
                watch.judge.disarm();
            }
        }

        /// Takes the tap out and ends its thread.
        pub fn stop(mut self) {
            self.end();
        }

        fn end(&mut self) {
            *lock(&WATCHING) = None;
            if let Some(thread) = self.thread.take() {
                self.stop.store(true, Ordering::SeqCst);
                let _ = thread.join();
            }
        }
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            self.end();
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_run_is_watched_only_once_the_keys_alone_are_delivered() {
            // A tap of keys and mouse is made without Input Monitoring and sees the mouse alone.
            assert_eq!(mask() & key_mask(), key_mask());
            assert_eq!(key_mask() & event_mask(kCGEventMouseMoved), 0);
            assert_eq!(key_mask() & event_mask(kCGEventLeftMouseDown), 0);
            assert_eq!(key_mask() & event_mask(kCGEventFlagsChanged), 0);
            let source = include_str!("watch.rs");
            let start = &source[source.find("pub fn start(told").unwrap()..];
            let tried = start.find("if !keys_delivered()").unwrap();
            let made = start.find("let tap = CGEventTapCreate(").unwrap();
            assert!(
                tried < made,
                "the keys are tried before the watch's tap is made"
            );
        }

        #[test]
        fn esc_is_the_judges_esc_and_no_other_key_ever_is() {
            assert_eq!(judged_key(MAC_ESCAPE), VK_ESCAPE);
            // kVK_ANSI_Minus is 0x1B, Windows' Esc: it must not read as Esc
            assert_ne!(judged_key(0x1B), VK_ESCAPE);
            for code in 0..=0x7F {
                if code != MAC_ESCAPE {
                    assert_ne!(judged_key(code), VK_ESCAPE, "{code:#x}");
                }
            }
        }

        #[test]
        fn a_modifier_key_is_down_while_its_flag_is_set() {
            assert_eq!(modifier_flag(0x3D), Some(kCGEventFlagMaskAlternate)); // Right Option
            assert_eq!(modifier_flag(0x37), Some(kCGEventFlagMaskCommand));
            assert_eq!(modifier_flag(0x00), None);
        }

        #[test]
        fn only_the_keyboard_and_the_mouse_themselves_are_the_owners() {
            let hid = i64::from(kCGEventSourceStateHIDSystemState);
            assert!(!injected(0, hid));
            assert!(injected(handy_keys::RAPHAEL_INPUT_MARKER as i64, hid));
            assert!(injected(0, i64::from(kCGEventSourceStatePrivate)));
            assert!(injected(
                0,
                i64::from(kCGEventSourceStateCombinedSessionState)
            ));
        }

        #[test]
        fn the_tap_reads_keys_buttons_wheel_and_moves() {
            let mask = mask();
            for kind in [
                kCGEventKeyDown,
                kCGEventFlagsChanged,
                kCGEventMouseMoved,
                kCGEventLeftMouseDown,
                kCGEventScrollWheel,
            ] {
                assert_ne!(mask & event_mask(kind), 0, "{kind}");
            }
            assert_eq!(mask & event_mask(kCGEventLeftMouseUp), 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(vk: u32, down: bool, injected: bool) -> Input {
        Input::Key { vk, down, injected }
    }

    fn mv(x: i32, y: i32, injected: bool) -> Input {
        Input::Move { x, y, injected }
    }

    #[test]
    fn nothing_counts_while_the_watch_is_off() {
        let mut judge = Judge::new();
        let now = Instant::now();
        assert!(!judge.owners(key(0x41, true, false), now));
        assert!(!judge.owners(Input::Button { injected: false }, now));
    }

    #[test]
    fn a_key_click_or_wheel_of_the_owners_stops_the_run_and_the_watch_goes_off() {
        for input in [
            key(0x41, true, false),
            key(0xA5, true, false), // Right Alt
            Input::Button { injected: false },
            Input::Wheel { injected: false },
        ] {
            let mut judge = Judge::new();
            let now = Instant::now();
            judge.arm(now);
            assert!(judge.owners(input, now), "{input:?}");
            assert!(!judge.armed());
            assert!(!judge.owners(input, now), "it said so once");
        }
    }

    #[test]
    fn raphaels_own_input_never_counts() {
        let mut judge = Judge::new();
        let now = Instant::now();
        judge.arm(now);
        let later = now + MOVE_GRACE * 2;
        for input in [
            key(0x41, true, true),
            Input::Button { injected: true },
            Input::Wheel { injected: true },
            mv(0, 0, true),
            mv(500, 500, true),
        ] {
            assert!(!judge.owners(input, later), "{input:?}");
        }
        assert!(judge.armed());
    }

    #[test]
    fn esc_and_a_released_key_are_left_to_the_controller() {
        let mut judge = Judge::new();
        let now = Instant::now();
        judge.arm(now);
        assert!(!judge.owners(key(VK_ESCAPE, true, false), now));
        assert!(!judge.owners(key(0x41, false, false), now));
        assert!(judge.armed());
    }

    #[test]
    fn the_mouse_counts_after_its_grace_and_beyond_a_little_way() {
        let mut judge = Judge::new();
        let now = Instant::now();
        judge.arm(now);
        // within the grace: the hand leaving the overlay's button
        assert!(!judge.owners(mv(0, 0, false), now));
        assert!(!judge.owners(mv(300, 300, false), now + Duration::from_millis(500)));
        let later = now + MOVE_GRACE + Duration::from_millis(10);
        assert!(!judge.owners(mv(300, 300, false), later));
        assert!(!judge.owners(mv(310, 305, false), later)); // 15 px: a jolt of the desk
        assert!(judge.owners(mv(320, 310, false), later)); // 30 px in all
    }

    #[test]
    fn arming_again_starts_the_count_again() {
        let mut judge = Judge::new();
        let now = Instant::now();
        judge.arm(now);
        let later = now + MOVE_GRACE * 2;
        assert!(!judge.owners(mv(0, 0, false), later));
        assert!(!judge.owners(mv(20, 0, false), later));
        judge.arm(later);
        let after = later + MOVE_GRACE * 2;
        assert!(!judge.owners(mv(20, 0, false), after));
        assert!(!judge.owners(mv(40, 0, false), after));
        judge.disarm();
        assert!(!judge.owners(Input::Button { injected: false }, after));
    }
}
