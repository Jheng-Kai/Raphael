//! What the shell asks of macOS: the counterparts of the Win32 calls the Windows build makes.
//!
//! - [`ffi`]: the C functions of the frameworks, as their headers declare them.
//! - [`cf`]: owned CoreFoundation objects and their conversions.
//! - [`ax`]: the accessibility API, which reads and operates other apps' windows.
//! - [`guide`]: the permission guide's drag of the app and System Settings' window.
//! - [`workspace`]: the running apps, the one in front, bringing one forward.
//! - [`keys`]: posting keys and clicks (marked as Raphael's own), and the keyboard layout.
//! - [`open_panel`]: the open panel that takes a file or a folder.
//! - [`pasteboard`]: the clipboard half of pasting.
//! - [`power`]: keeping the computer awake, and the time since the last input.
//! - [`permissions`]: the privacy permissions the features need.
//! - [`shell_path`]: the login shell's PATH, for an app opened from Finder.
//! - [`window`]: Raphael's passive windows (the overlay, the learned-word pill).

pub mod ax;
pub mod cf;
pub mod ffi;
pub mod guide;
pub mod keys;
pub mod open_panel;
pub mod pasteboard;
pub mod permissions;
pub mod power;
pub mod shell_path;
pub mod window;
pub mod workspace;
