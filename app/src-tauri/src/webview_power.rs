//! WebView2 resource policy follows native window activity, independently of page timers.

use tauri::{Runtime, WebviewWindow};

use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
static MAIN_ACTIVE: AtomicBool = AtomicBool::new(true);
static MAIN_SHOWN: AtomicBool = AtomicBool::new(false);

/// Debug native journeys only: refuse one named step the way WebView2 can (0x8007139F).
#[cfg(windows)]
fn refused(step: &str) -> bool {
    crate::native_journey()
        && std::env::var("RAPHAEL_TEST_NATIVE_POWER_REFUSE").is_ok_and(|value| value == step)
}

fn main_power_allowed(shown: bool, active: bool, manual_launch: bool) -> bool {
    active || shown || !manual_launch
}

pub(crate) fn startup_trace(event: &str) {
    if crate::startup_journey() {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        log::info!(
            "native startup: {}",
            serde_json::json!({"event": event, "at": at})
        );
    }
}

pub(crate) fn main_shown() {
    if !MAIN_SHOWN.swap(true, Ordering::SeqCst) {
        startup_trace("first_show");
    }
}

pub(crate) fn main_active<R: Runtime>(window: &WebviewWindow<R>, active: bool) {
    startup_trace(if active {
        "active_request"
    } else {
        "inactive_request"
    });
    let manual_launch = crate::first_run::opens_at_start(&std::env::args().collect::<Vec<_>>());
    if !main_power_allowed(MAIN_SHOWN.load(Ordering::SeqCst), active, manual_launch) {
        startup_trace("pre_show_suspend_skipped");
        return;
    }
    #[cfg(windows)]
    {
        MAIN_ACTIVE.store(active, Ordering::SeqCst);
        let posted = window.with_webview(move |webview| {
            use webview2_com::{Microsoft::Web::WebView2::Win32::*, TrySuspendCompletedHandler};
            use windows_core::Interface;
            // SAFETY: with_webview runs on the controller's owning thread.
            let result = unsafe {
                (|| -> windows_core::Result<()> {
                    let controller = webview.controller();
                    let core = controller.CoreWebView2()?;
                    let suspend: ICoreWebView2_3 = core.cast()?;
                    let memory: ICoreWebView2_19 = core.cast()?;
                    let active = MAIN_ACTIVE.load(Ordering::SeqCst);
                    // Each step stands alone. WebView2 can refuse one (0x8007139F while a suspension
                    // is still settling); aborting the rest left a returning window hidden and frozen.
                    let step = |name: &str, result: windows_core::Result<()>| {
                        if let Err(error) = result {
                            log::warn!("main webview {name} failed: {error}");
                        }
                    };
                    let mut suspended = windows_core::BOOL::default();
                    let is_suspended =
                        suspend.IsSuspended(&mut suspended).is_ok() && suspended.as_bool();
                    if active {
                        if is_suspended {
                            step("resume", suspend.Resume());
                        }
                        step(
                            "normal memory",
                            if refused("normal memory") {
                                Err(windows_core::Error::from(windows_core::HRESULT(
                                    0x8007139Fu32 as i32,
                                )))
                            } else {
                                memory.SetMemoryUsageTargetLevel(
                                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
                                )
                            },
                        );
                        step("show", controller.SetIsVisible(true));
                    } else {
                        step("hide", controller.SetIsVisible(false));
                        if is_suspended {
                            return Ok(());
                        }
                        step(
                            "low memory",
                            memory.SetMemoryUsageTargetLevel(
                                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                            ),
                        );
                        let resume = suspend.clone();
                        let done = TrySuspendCompletedHandler::create(Box::new(
                            move |error, suspended| {
                                if let Err(error) = error {
                                    log::warn!("main webview suspension failed: {error}");
                                    return Ok(());
                                }
                                // Showing can race asynchronous suspension. A late completion must not freeze a visible page.
                                startup_trace(if suspended {
                                    "suspend_completed"
                                } else {
                                    "suspend_declined"
                                });
                                if suspended && MAIN_ACTIVE.load(Ordering::SeqCst) {
                                    resume.Resume()?;
                                } else if !suspended && !MAIN_ACTIVE.load(Ordering::SeqCst) {
                                    log::warn!("main webview declined suspension");
                                }
                                Ok(())
                            },
                        ));
                        startup_trace("suspend_requested");
                        step("suspend", suspend.TrySuspend(&done));
                    }
                    Ok(())
                })()
            };
            if let Err(error) = result {
                log::warn!("could not update main webview power state: {error}");
            }
        });
        if let Err(error) = posted {
            log::warn!("could not dispatch main webview power state: {error}");
        }
    }
    #[cfg(not(windows))]
    let _ = (window, active);
}

pub(crate) fn low_memory<R: Runtime>(window: &WebviewWindow<R>, low: bool) {
    #[cfg(windows)]
    {
        let posted = window.with_webview(move |webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::Interface;
            // SAFETY: this closure owns the controller thread; passive windows are never suspended.
            let result = unsafe {
                (|| -> windows_core::Result<()> {
                    let memory: ICoreWebView2_19 = webview.controller().CoreWebView2()?.cast()?;
                    memory.SetMemoryUsageTargetLevel(if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    })
                })()
            };
            if let Err(error) = result {
                log::warn!("could not update passive webview memory target: {error}");
            }
        });
        if let Err(error) = posted {
            log::warn!("could not dispatch passive webview memory target: {error}");
        }
    }
    #[cfg(not(windows))]
    let _ = (window, low);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_startup_never_suspends_before_the_first_successful_show() {
        assert!(!main_power_allowed(false, false, true));
        assert!(main_power_allowed(false, true, true));
        assert!(main_power_allowed(true, false, true));
        assert!(main_power_allowed(true, true, true));
    }

    #[test]
    fn explicit_autostart_can_sleep_after_the_page_subscribes_without_a_show() {
        assert!(main_power_allowed(false, false, false));
    }
}
