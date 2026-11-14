//! A passive window has no title bar in its window style, not only on screen.
//!
//! tao (under Tauri) gives every window `WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX |
//! WS_MAXIMIZEBOX` in its real style, also one made with `.decorations(false)`: it hides that
//! frame by answering `WM_NCCALCSIZE` with "the whole window is client", and it writes the whole
//! style again from its own flags whenever one of them changes. A passive window (the overlay and
//! the learned-word pill) flips one of those flags each time the pointer enters or leaves one of
//! its buttons (`set_ignore_cursor_events`), so its style is rebuilt with a title bar in it over
//! and over, and what is on screen depends on Windows never painting the frame from the style.
//! If it ever does, the window is transparent and empty, so what the person sees is a bare
//! Windows title bar (with the window's title and a close button) on a window with nothing in it.
//!
//! Neither window needs a frame, so [`keep_bare`] takes the frame bits out of the style, and
//! guards the window so that no rebuild can put them back, not even for a moment: a subclass
//! removes them from every style Windows is about to give the window (`WM_STYLECHANGING`).

/// The bits of a window style that make a title bar, a sizing border or a system menu.
#[cfg(windows)]
fn frame_bits() -> u32 {
    use windows::Win32::UI::WindowsAndMessaging::{
        WS_CAPTION, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };
    (WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX).0
}

/// `style` without a title bar, a border, a sizing frame or a system menu. Everything else
/// (visible, popup, clip siblings, ...) is left as it is.
#[cfg(windows)]
pub(crate) fn bare_style(style: u32) -> u32 {
    style & !frame_bits()
}

#[cfg(windows)]
const GUARD_ID: usize = 0x5241_5048; // "RAPH"

/// Takes the window's own frame away for good: its style loses the frame bits now, and every
/// style it is given later loses them too. Safe to call again and again.
///
/// # Safety
///
/// `hwnd` must be a window that the calling thread owns: a window can only be subclassed, and
/// its style changed without waiting for another thread, from the thread that created it.
#[cfg(windows)]
pub(crate) unsafe fn keep_bare(hwnd: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::{
        Shell::SetWindowSubclass,
        WindowsAndMessaging::{
            GWL_STYLE, GetWindowLongPtrW, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos,
        },
    };

    // SAFETY: the caller owns `hwnd` (see above); `guard` is a plain function that lives as long
    // as the program, and the subclass is dropped by Windows with the window.
    unsafe {
        // The same (procedure, id) pair is installed once, whatever the number of calls.
        if !SetWindowSubclass(hwnd, Some(guard), GUARD_ID, 0).as_bool() {
            log::warn!("could not guard a passive window against a title bar");
        }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let bare = bare_style(style as u32);
        if style as u32 == bare {
            return false;
        }
        // The guard sees this change too; the frame is then worked out again, with nothing to draw.
        SetWindowLongPtrW(hwnd, GWL_STYLE, bare as i32 as isize);
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
    true
}

/// The subclass: a style that is about to be set loses its frame bits first.
#[cfg(windows)]
unsafe extern "system" fn guard(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::{
        Shell::DefSubclassProc,
        WindowsAndMessaging::{GWL_STYLE, STYLESTRUCT, WM_STYLECHANGING},
    };

    if message == WM_STYLECHANGING && wparam.0 as i32 == GWL_STYLE.0 && lparam.0 != 0 {
        // SAFETY: for `WM_STYLECHANGING`, `lparam` points to the `STYLESTRUCT` that Windows
        // lets the window change before the new style is applied.
        let styles = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
        styles.styleNew = bare_style(styles.styleNew);
    }
    // SAFETY: the arguments are the ones this procedure was called with.
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::{
        Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, GWL_STYLE, GetWindowLongPtrW, SetWindowLongPtrW,
                WINDOW_EX_STYLE, WS_CAPTION, WS_CLIPSIBLINGS, WS_OVERLAPPEDWINDOW, WS_POPUP,
                WS_SYSMENU, WS_VISIBLE,
            },
        },
        core::w,
    };

    /// A window of the system's own `STATIC` class that nobody sees: no message loop is needed
    /// to change its style from the thread that made it.
    fn window() -> HWND {
        // SAFETY: the arguments are valid; the class is a system class and the window is hidden.
        unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("Raphael frame test"),
                WS_OVERLAPPEDWINDOW | WS_CLIPSIBLINGS,
                0,
                0,
                120,
                80,
                None,
                None,
                None,
                None,
            )
        }
        .expect("a test window")
    }

    fn style(hwnd: HWND) -> u32 {
        // SAFETY: `hwnd` is a live window of this thread.
        unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 }
    }

    #[test]
    fn the_frame_bits_go_and_the_rest_of_the_style_stays() {
        let full = (WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPSIBLINGS | WS_POPUP).0;
        let bare = bare_style(full);
        assert_eq!(bare, (WS_VISIBLE | WS_CLIPSIBLINGS | WS_POPUP).0);
        assert_eq!(bare & (WS_CAPTION | WS_SYSMENU).0, 0);
        assert_eq!(bare_style(bare), bare, "it is done once");
        assert_eq!(bare_style(0), 0);
    }

    #[test]
    fn a_style_tao_writes_again_never_brings_the_title_bar_back() {
        let hwnd = window();
        assert_ne!(
            style(hwnd) & WS_CAPTION.0,
            0,
            "the test window starts with a title bar"
        );
        // SAFETY: this thread made the window.
        assert!(
            unsafe { keep_bare(hwnd) },
            "the first call changes the style"
        );
        assert_eq!(style(hwnd) & (WS_CAPTION | WS_SYSMENU).0, 0);
        assert!(
            !unsafe { keep_bare(hwnd) },
            "the second call has nothing to do"
        );
        // What tao does when a flag changes (the pointer enters a button): the whole style again,
        // with the title bar in it.
        // SAFETY: this thread made the window.
        unsafe {
            SetWindowLongPtrW(
                hwnd,
                GWL_STYLE,
                (WS_OVERLAPPEDWINDOW | WS_CLIPSIBLINGS).0 as isize,
            )
        };
        let after = style(hwnd);
        assert_eq!(after & (WS_CAPTION | WS_SYSMENU | WS_OVERLAPPEDWINDOW).0, 0);
        assert_ne!(
            after & WS_CLIPSIBLINGS.0,
            0,
            "the rest of what was written is kept"
        );
        // SAFETY: this thread made the window.
        unsafe { DestroyWindow(hwnd) }.expect("the test window goes");
    }
}
