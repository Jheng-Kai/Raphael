//! The running apps of macOS: which one is in front, what it is called, and bringing one to the
//! front. The counterpart of the foreground window and process queries on Windows.

use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{class, msg_send};
use objc2_foundation::NSString;

use super::ax;
use super::ffi::*;

/// An app the person uses, as the shell names it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct App {
    pub pid: i32,
    /// The bundle identifier, lowercased (`com.apple.textedit`), or the executable's file name
    /// for a process that has no bundle. It is what the shell's lists of apps are written in.
    pub id: String,
    /// The name the app goes by (`TextEdit`).
    pub name: String,
}

fn running_application(pid: i32) -> Option<Retained<AnyObject>> {
    let class: &AnyClass = class!(NSRunningApplication);
    // SAFETY: a class method that returns an autoreleased object or nil.
    unsafe { msg_send![class, runningApplicationWithProcessIdentifier: pid] }
}

fn ns_string(object: Option<Retained<NSString>>) -> Option<String> {
    object
        .map(|text| text.to_string())
        .filter(|text| !text.is_empty())
}

/// The app with process id `pid`, if it runs.
pub fn app(pid: i32) -> Option<App> {
    autoreleasepool(|_| {
        let running = running_application(pid)?;
        // SAFETY: NSRunningApplication's properties; each may be nil.
        let (bundle, name): (Option<Retained<NSString>>, Option<Retained<NSString>>) = unsafe {
            (
                msg_send![&*running, bundleIdentifier],
                msg_send![&*running, localizedName],
            )
        };
        let executable = executable_name(pid);
        let id = ns_string(bundle)
            .map(|bundle| bundle.to_lowercase())
            .or_else(|| executable.clone())?;
        let name = ns_string(name).or(executable).unwrap_or_else(|| id.clone());
        Some(App { pid, id, name })
    })
}

/// The file name of the process's executable.
pub fn executable_name(pid: i32) -> Option<String> {
    let mut buffer = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
    // SAFETY: the buffer is as long as said.
    let length = unsafe { proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if length <= 0 {
        return None;
    }
    buffer.truncate(length as usize);
    let path = String::from_utf8_lossy(&buffer).into_owned();
    path.rsplit('/').next().map(str::to_owned)
}

/// The app in front: the one with the keyboard focus, as the accessibility API says (it is
/// answered from any thread), else as the workspace says.
pub fn frontmost_pid() -> Option<i32> {
    if let Some(pid) = ax::Element::system_wide()
        .and_then(|system| system.element("AXFocusedApplication"))
        .and_then(|app| app.pid())
    {
        return Some(pid);
    }
    autoreleasepool(|_| {
        let class: &AnyClass = class!(NSWorkspace);
        // SAFETY: the shared workspace and its front app, which may be nil.
        unsafe {
            let workspace: Retained<AnyObject> = msg_send![class, sharedWorkspace];
            let front: Option<Retained<AnyObject>> = msg_send![&*workspace, frontmostApplication];
            front.map(|front| msg_send![&*front, processIdentifier])
        }
    })
}

/// Brings the app with `pid` to the front. Whether macOS took it.
pub fn activate(pid: i32) -> bool {
    autoreleasepool(|_| {
        let Some(running) = running_application(pid) else {
            return false;
        };
        // NSApplicationActivateIgnoringOtherApps (1 << 1) | NSApplicationActivateAllWindows (1 << 0).
        let options: usize = 0b11;
        // SAFETY: an instance method taking an options bit mask.
        unsafe { msg_send![&*running, activateWithOptions: options] }
    })
}

/// This process's id.
pub fn own_pid() -> i32 {
    std::process::id() as i32
}

/// The process ids of the apps that run as ordinary apps (a Dock icon, windows of their own:
/// `NSApplicationActivationPolicyRegular`), in the workspace's order.
pub fn regular_apps() -> Vec<i32> {
    autoreleasepool(|_| {
        let class: &AnyClass = class!(NSWorkspace);
        let mut pids = Vec::new();
        // SAFETY: the shared workspace, its array of running apps and their properties.
        unsafe {
            let workspace: Retained<AnyObject> = msg_send![class, sharedWorkspace];
            let list: Retained<AnyObject> = msg_send![&*workspace, runningApplications];
            let count: usize = msg_send![&*list, count];
            for index in 0..count {
                let running: Retained<AnyObject> = msg_send![&*list, objectAtIndex: index];
                let policy: isize = msg_send![&*running, activationPolicy];
                if policy == 0 {
                    let pid: i32 = msg_send![&*running, processIdentifier];
                    if pid > 0 {
                        pids.push(pid);
                    }
                }
            }
        }
        pids
    })
}
