//! The system's open panel when the person may choose a file or a folder in the same panel.
//!
//! The dialog plugin's pickers choose either files or folders (the panel of a folder will not take a file, and a
//! ZIP is a file), but NSOpenPanel allows both at once, which is what an importer of "anything" wants.

use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_foundation::NSString;

/// `NSModalResponseOK`.
const OK: isize = 1;

/// Shows the panel and returns the file or folder the person chose, `None` when it was cancelled. It is modal and runs
/// the main thread's event loop, so it must be called on the main thread.
pub fn pick_file_or_folder() -> Option<String> {
    autoreleasepool(|_| {
        let class: &AnyClass = class!(NSOpenPanel);
        // SAFETY: NSOpenPanel's class constructor and its plain setters, on the main thread; `runModal` answers the
        // button pressed, `URL` the one chosen (nil when none) and `path` its file system path.
        unsafe {
            let panel: Retained<AnyObject> = msg_send![class, openPanel];
            let () = msg_send![&*panel, setCanChooseFiles: Bool::YES];
            let () = msg_send![&*panel, setCanChooseDirectories: Bool::YES];
            let () = msg_send![&*panel, setAllowsMultipleSelection: Bool::NO];
            let () = msg_send![&*panel, setResolvesAliases: Bool::YES];
            let response: isize = msg_send![&*panel, runModal];
            if response != OK {
                return None;
            }
            let url: Option<Retained<AnyObject>> = msg_send![&*panel, URL];
            let path: Option<Retained<NSString>> = msg_send![&*url?, path];
            path.map(|path| path.to_string())
        }
    })
}
