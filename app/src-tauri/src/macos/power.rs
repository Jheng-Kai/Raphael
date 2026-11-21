//! Keeping the computer awake for the scheduler.

use super::cf;
use super::ffi::*;

/// A power assertion that keeps the system from idle sleep while it is held. The display may
/// still sleep, as with Windows' `ES_SYSTEM_REQUIRED` without `ES_DISPLAY_REQUIRED`.
#[derive(Debug)]
pub struct Awake(IOPMAssertionID);

impl Awake {
    pub fn take(reason: &str) -> Result<Self, String> {
        let kind = cf::string("PreventUserIdleSystemSleep");
        let name = cf::string(reason);
        let mut id: IOPMAssertionID = 0;
        // SAFETY: valid strings and an out pointer.
        let status = unsafe {
            IOPMAssertionCreateWithName(
                kind.as_ptr(),
                kIOPMAssertionLevelOn,
                name.as_ptr(),
                &mut id,
            )
        };
        if status == kIOReturnSuccess {
            Ok(Self(id))
        } else {
            Err(format!(
                "macOS refused the power assertion (0x{status:08X})"
            ))
        }
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        // SAFETY: the assertion is ours and released only here.
        unsafe { IOPMAssertionRelease(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_assertion_is_taken_and_released() {
        let awake = Awake::take("Raphael test").unwrap();
        drop(awake);
    }
}
