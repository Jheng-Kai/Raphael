//! Manual launches reveal the existing main window; explicit autostart launches stay in the tray.
//! Window-state restores remembered bounds independently of this visibility decision.

use tauri::AppHandle;

/// Used by initial setup and single-instance handover, regardless of onboarding state.
pub fn opens_at_start(args: &[String]) -> bool {
    !args.iter().any(|arg| arg == "--autostart")
}

pub fn start(app: &AppHandle) {
    if !opens_at_start(&std::env::args().collect::<Vec<_>>()) {
        return;
    }
    let app = app.clone();
    // Wait for the event loop; the main window and its restored bounds already exist.
    tauri::async_runtime::spawn(async move {
        crate::show_main_window(&app);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manual_launch_after_the_guide_shows_the_window() {
        assert!(opens_at_start(&["Raphael.exe".into()]));
    }

    #[test]
    fn a_manual_second_launch_uses_the_same_reveal_policy() {
        assert!(opens_at_start(&["Raphael.exe".into(), "--manual".into()]));
    }

    #[test]
    fn initial_and_second_autostart_launches_stay_hidden() {
        assert!(!opens_at_start(&[
            "Raphael.exe".into(),
            "--autostart".into()
        ]));
        assert!(!opens_at_start(&["--autostart".into()]));
    }

    #[test]
    fn only_the_explicit_autostart_argument_changes_visibility() {
        assert!(opens_at_start(&[]));
        assert!(opens_at_start(&["C:/--autostart/Raphael.exe".into()]));
    }
}
