//! WebView key events and the Win32 system menu have separate default handlers.

use std::sync::{Arc, RwLock};

use handy_keys::{Hotkey, Key, Modifiers};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Input::KeyboardAndMouse::{
            GetKeyState, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_RCONTROL, VK_RMENU,
            VK_RSHIFT, VK_RWIN,
        },
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{SC_KEYMENU, WM_NCDESTROY, WM_SYSCOMMAND},
    },
};

const SUBCLASS_ID: usize = 0x5241_4B4D;

/// A snapshot of the worker's accepted agent bindings for the UI thread.
pub(super) struct Guard(RwLock<Vec<Hotkey>>);

impl Guard {
    pub(super) fn new(agent: &[Hotkey]) -> Self {
        Self(RwLock::new(agent.to_vec()))
    }

    pub(super) fn update(&self, agent: &[Hotkey]) {
        if let Ok(mut current) = self.0.write() {
            current.clear();
            current.extend_from_slice(agent);
        }
    }

    /// Called once on the thread that created the window, during app setup.
    pub(super) fn install(self: &Arc<Self>, window: &tauri::WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else {
            log::warn!("could not get the window handle for the quick-ask system menu guard");
            return;
        };
        // SAFETY: setup runs on the thread that owns the live window.
        if !unsafe { self.attach(hwnd) } {
            log::warn!(
                "could not guard the system menu for window {}",
                window.label()
            );
        }
    }

    /// The caller owns the live window and installs this subclass once.
    unsafe fn attach(self: &Arc<Self>, hwnd: HWND) -> bool {
        let data = Arc::into_raw(Arc::clone(self));
        // SAFETY: the raw Arc is owned by this subclass until WM_NCDESTROY, or taken back here
        // if the install fails.
        unsafe {
            if SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, data as usize).as_bool() {
                return true;
            }
            drop(Arc::from_raw(data));
        }
        false
    }

    fn blocks_menu(
        &self,
        command: WPARAM,
        key: LPARAM,
        modifiers: impl FnOnce() -> Modifiers,
    ) -> bool {
        if command.0 & 0xFFF0 != SC_KEYMENU as usize || key.0 != b' ' as isize {
            return false;
        }
        let held = modifiers();
        held.intersects(Modifiers::OPT)
            && self.0.read().is_ok_and(|agent| {
                agent.iter().any(|binding| {
                    binding.key == Some(Key::Space) && binding.modifiers.matches(held)
                })
            })
    }
}

fn held_modifiers() -> Modifiers {
    [
        (VK_LMENU, Modifiers::OPT_LEFT),
        (VK_RMENU, Modifiers::OPT_RIGHT),
        (VK_LCONTROL, Modifiers::CTRL_LEFT),
        (VK_RCONTROL, Modifiers::CTRL_RIGHT),
        (VK_LSHIFT, Modifiers::SHIFT_LEFT),
        (VK_RSHIFT, Modifiers::SHIFT_RIGHT),
        (VK_LWIN, Modifiers::CMD_LEFT),
        (VK_RWIN, Modifiers::CMD_RIGHT),
    ]
    .into_iter()
    .filter_map(|(key, modifier)| {
        // SAFETY: each value is a Win32 virtual-key code. GetKeyState reads the UI thread's
        // keyboard queue at this message, so key releases still in the queue do not change it.
        (unsafe { GetKeyState(i32::from(key.0)) } < 0).then_some(modifier)
    })
    .fold(Modifiers::empty(), |held, modifier| held | modifier)
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    command: WPARAM,
    key: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    let guard = data as *const Guard;
    if message == WM_NCDESTROY {
        // SAFETY: this is the last message on the owning thread. Release the install's Arc.
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(window_proc), id);
            drop(Arc::from_raw(guard));
        }
    } else if message == WM_SYSCOMMAND {
        // SAFETY: the subclass still owns the Arc. The read ends before calling DefSubclassProc.
        if unsafe { &*guard }.blocks_menu(command, key, held_modifiers) {
            log::debug!("quick ask: suppressed the Alt+Space system menu");
            return LRESULT(0);
        }
    }
    // SAFETY: these arguments came from Windows for this subclass call.
    unsafe { DefSubclassProc(hwnd, message, command, key) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hotkey::parse_binding;
    use windows::{
        Win32::UI::{
            Input::KeyboardAndMouse::{GetKeyboardState, SetKeyboardState, VK_MENU},
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, SC_CLOSE, SC_MOUSEMENU,
                WINDOW_EX_STYLE, WM_SYSCHAR, WS_OVERLAPPEDWINDOW,
            },
        },
        core::w,
    };

    #[test]
    fn only_the_space_system_menu_for_a_bound_agent_chord_is_blocked() {
        let menu = SC_KEYMENU as usize;
        let space = b' ' as isize;
        let right = Modifiers::OPT_RIGHT;
        let left = Modifiers::OPT_LEFT;
        let shift = Modifiers::SHIFT_LEFT;
        let guard = Guard::new(&[parse_binding("AltRight+Space").unwrap()]);
        let blocks = |command, key, held| guard.blocks_menu(WPARAM(command), LPARAM(key), || held);

        assert!(blocks(menu | 1, space, right));
        assert!(!blocks(menu, space, left));
        assert!(!blocks(menu, space, right | shift));
        assert!(!blocks(menu, space, Modifiers::CTRL_LEFT | right));
        assert!(!blocks(menu, space, Modifiers::empty()));
        assert!(!blocks(menu, b'f' as isize, right));
        assert!(!blocks(menu, 0, right));
        assert!(!blocks(SC_MOUSEMENU as usize, space, right));
        assert!(!blocks(SC_CLOSE as usize, space, right));

        guard.update(&[parse_binding("F9").unwrap()]);
        assert!(!blocks(menu, space, right));
        guard.update(&[parse_binding("Space+AltLeft").unwrap()]);
        assert!(blocks(menu, space, left));
        assert!(!blocks(menu, space, right));
        guard.update(&[parse_binding("Alt+Space").unwrap()]);
        assert!(blocks(menu, space, left));
        assert!(blocks(menu, space, right));
    }

    #[test]
    fn win32_routes_the_space_menu_through_the_guard_and_restores_it_after_rebinding() {
        use std::cell::Cell;

        unsafe extern "system" fn observe(
            hwnd: HWND,
            message: u32,
            command: WPARAM,
            key: LPARAM,
            _id: usize,
            count: usize,
        ) -> LRESULT {
            if message == WM_SYSCOMMAND && command.0 == SC_KEYMENU as usize && key.0 == 0x20 {
                // SAFETY: the Cell outlives the test window and is only used on this thread.
                let count = unsafe { &*(count as *const Cell<u32>) };
                count.set(count.get() + 1);
                return LRESULT(0); // No menu is opened on the test desktop.
            }
            // SAFETY: pass the original message to the rest of the subclass chain.
            unsafe { DefSubclassProc(hwnd, message, command, key) }
        }

        let count = Cell::new(0_u32);
        let guard = Arc::new(Guard::new(&[parse_binding("AltRight+Space").unwrap()]));
        // SAFETY: the test owns this hidden window and its keyboard queue. The observer's
        // reference stays valid through DestroyWindow.
        let observed = unsafe {
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("Raphael system menu test"),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                120,
                80,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            assert!(
                SetWindowSubclass(hwnd, Some(observe), 1, &count as *const _ as usize).as_bool()
            );
            let mut previous = [0; 256];
            GetKeyboardState(&mut previous).unwrap();
            let mut right_alt = [0; 256];
            right_alt[usize::from(VK_MENU.0)] = 0x80;
            right_alt[usize::from(VK_RMENU.0)] = 0x80;
            SetKeyboardState(&right_alt).unwrap();

            let open_space_menu = || {
                // One press, Space scan code, and Alt context. Win32 sends SC_KEYMENU itself.
                DefWindowProcW(hwnd, WM_SYSCHAR, WPARAM(0x20), LPARAM(0x2039_0001));
                count.get()
            };
            let before = open_space_menu();
            assert!(guard.attach(hwnd));
            let bound = open_space_menu();
            guard.update(&[parse_binding("F9").unwrap()]);
            let rebound = open_space_menu();

            let restored = SetKeyboardState(&previous);
            DestroyWindow(hwnd).unwrap();
            restored.unwrap();
            (before, bound, rebound)
        };
        assert_eq!(observed, (1, 1, 2));
        assert_eq!(Arc::strong_count(&guard), 1);
    }
}
