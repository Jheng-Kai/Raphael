//! The PATH of the person's login shell, for a Raphael opened from Finder, the Dock or at login.
//!
//! macOS starts such an app with launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), without what
//! the person's shell adds: Homebrew, npm, Volta, nvm. The core runs the Claude Code, Codex and
//! Antigravity CLIs and Docker from that PATH, so the shell is asked for it once, at start, with a
//! time limit, and the app's environment (which the core inherits) gets it.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long the login shell may take to say its PATH.
const SHELL_TIMEOUT: Duration = Duration::from_secs(15);
/// launchd's PATH: an app started from a terminal already has a longer one.
const LAUNCHD_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// Puts the login shell's PATH in this process's environment, if the process has only
/// launchd's.
///
/// # Safety
///
/// It changes the environment of the process, so no other thread may be running.
pub unsafe fn adopt_login_path() {
    let current = std::env::var("PATH").unwrap_or_default();
    if !current.is_empty() && current != LAUNCHD_PATH {
        return;
    }
    let Some(path) = login_path() else {
        return;
    };
    // SAFETY: the caller promises that no other thread runs.
    unsafe { std::env::set_var("PATH", path) };
}

fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|shell| shell.starts_with('/'))
        .unwrap_or_else(|| "/bin/zsh".to_owned());
    // A marker around the value keeps whatever the shell's start-up files print out of it.
    let mut child = Command::new(shell)
        .args([
            "-ilc",
            "printf '__RAPHAEL_PATH__%s__RAPHAEL_PATH__' \"$PATH\"",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + SHELL_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                log::warn!("the login shell did not say its PATH in time");
                return None;
            }
        }
    }
    let mut out = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
    let value = out.split("__RAPHAEL_PATH__").nth(1)?.trim();
    (!value.is_empty() && value.contains('/')).then(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_login_shell_says_a_path_with_the_system_folders() {
        if let Some(path) = login_path() {
            assert!(path.split(':').any(|part| part == "/usr/bin"), "{path}");
        }
    }
}
