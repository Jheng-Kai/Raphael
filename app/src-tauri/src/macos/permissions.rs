//! The privacy permissions of macOS that Raphael's features need, and asking for them.
//!
//! - Microphone: dictation and voice questions. The core opens the microphone, and macOS asks the
//!   person on behalf of the app that started it; the shell asks first, so that the question names
//!   Raphael and comes before the first recording rather than in the middle of it.
//! - Accessibility: the hotkeys (an event tap that can swallow keys), pasting (posting ⌘V),
//!   learning from corrections and operating the desktop (reading other apps' windows).
//! - Input monitoring: the watch on the owner's input during a run on the desktop.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::autoreleasepool;
use objc2::runtime::{AnyClass, Bool};
use objc2::{class, msg_send};
use objc2_foundation::NSString;

use super::ax;
use super::ffi::*;

/// `AVAuthorizationStatus`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Microphone {
    NotDetermined,
    Restricted,
    Denied,
    Authorized,
}

/// `AVMediaTypeAudio`.
const AUDIO: &str = "soun";

/// What the person decided about the microphone for this app.
pub fn microphone() -> Microphone {
    autoreleasepool(|_| {
        let class: &AnyClass = class!(AVCaptureDevice);
        let media = NSString::from_str(AUDIO);
        // SAFETY: a class method taking a media type.
        let status: isize = unsafe { msg_send![class, authorizationStatusForMediaType: &*media] };
        match status {
            1 => Microphone::Restricted,
            2 => Microphone::Denied,
            3 => Microphone::Authorized,
            _ => Microphone::NotDetermined,
        }
    })
}

/// Asks the person for the microphone if it has not been decided, and waits up to `wait` for the
/// answer. Whether the microphone may be used.
pub fn request_microphone(wait: Duration) -> bool {
    match microphone() {
        Microphone::Authorized => return true,
        Microphone::Denied | Microphone::Restricted => return false,
        Microphone::NotDetermined => {}
    }
    let (send, receive) = mpsc::channel();
    autoreleasepool(|_| {
        let class: &AnyClass = class!(AVCaptureDevice);
        let media = NSString::from_str(AUDIO);
        let block = RcBlock::new(move |granted: Bool| {
            let _ = send.send(granted.as_bool());
        });
        // SAFETY: a class method taking a media type and a completion block, which it copies.
        unsafe {
            let () = msg_send![
                class,
                requestAccessForMediaType: &*media,
                completionHandler: &*block
            ];
        }
    });
    receive.recv_timeout(wait).unwrap_or(false)
}

/// Whether the app may use the accessibility API; with `prompt`, macOS shows its own question
/// once if it has not been decided.
pub fn accessibility(prompt: bool) -> bool {
    ax::trusted(prompt)
}

/// Whether the app may watch keyboard and mouse input (Input Monitoring); with `prompt`, macOS
/// asks once.
pub fn input_monitoring(prompt: bool) -> bool {
    // SAFETY: plain queries.
    unsafe {
        if CGPreflightListenEventAccess() {
            return true;
        }
        prompt && CGRequestListenEventAccess()
    }
}
