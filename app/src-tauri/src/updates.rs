//! Signed desktop updates. No update network traffic unless About is opened or auto update is on.
use crate::{
    core_process::{CoreApi, CoreProcess},
    device_settings::DeviceStore,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
pub struct View {
    state: &'static str,
    version: String,
    notes: String,
    error: String,
    installed: String,
}
impl Default for View {
    fn default() -> Self {
        Self {
            state: "idle",
            version: String::new(),
            notes: String::new(),
            error: String::new(),
            installed: String::new(),
        }
    }
}
#[derive(Default)]
struct Pending {
    view: View,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
#[derive(Default)]
struct Updates {
    pending: Mutex<Pending>,
    operation: Mutex<()>,
}

fn error_kind(error: &tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error;
    match error {
        Error::MissingSignedVersion | Error::SignedVersionMismatch { .. } => "version",
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => "verification",
        _ => "feed",
    }
}

async fn auto(app: &AppHandle) -> bool {
    match app.try_state::<DeviceStore>() {
        Some(store) => store.get().await.auto_update,
        None => false,
    }
}

async fn check(app: &AppHandle, state: &Updates) -> Result<(), String> {
    if state.pending.lock().await.bytes.is_some() {
        return Ok(());
    }
    let key = option_env!("RAPHAEL_UPDATER_PUBLIC_KEY")
        .filter(|key| !key.trim().is_empty())
        .ok_or("not_configured")?;
    state.pending.lock().await.view.state = "checking";
    let updater = app
        .updater_builder()
        .pubkey(key)
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "not_configured")?;
    let mut found = updater.check().await.map_err(|error| error_kind(&error))?;
    if let Some(update) = found.as_mut() {
        update.timeout = Some(Duration::from_secs(120));
    }
    let mut pending = state.pending.lock().await;
    pending.view = View {
        state: "idle",
        ..Default::default()
    };
    pending.update = found;
    if let Some(update) = pending.update.as_ref() {
        let version = update.version.clone();
        let notes = update.body.clone().unwrap_or_default();
        pending.view = View {
            state: "found",
            version,
            notes,
            ..Default::default()
        };
    }
    Ok(())
}

async fn download(state: &Updates) -> Result<(), String> {
    let update = {
        let mut pending = state.pending.lock().await;
        if pending.bytes.is_some() {
            return Ok(());
        }
        let Some(update) = pending.update.clone() else {
            return Ok(());
        };
        pending.view.state = "downloading";
        update
    };
    // The official plugin checks the signature AND its signed version before returning bytes.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error_kind(&error))?;
    let mut pending = state.pending.lock().await;
    pending.bytes = Some(bytes);
    pending.view.state = "ready";
    Ok(())
}

fn members_idle(value: &Value) -> bool {
    value
        .get("members")
        .and_then(Value::as_array)
        .is_some_and(|members| {
            !members.is_empty()
                && members.iter().all(|member| {
                    matches!(
                        member.get("activity").and_then(Value::as_str),
                        Some("idle" | "sleeping")
                    ) && member.get("waiting").and_then(Value::as_bool) == Some(false)
                })
        })
}

#[cfg(windows)]
fn idle_seconds() -> u64 {
    use windows::Win32::{
        System::SystemInformation::GetTickCount,
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };
    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: the initialized structure has the required size and remains valid for the call.
    unsafe {
        if GetLastInputInfo(&mut input).as_bool() {
            GetTickCount().wrapping_sub(input.dwTime) as u64 / 1000
        } else {
            0
        }
    }
}
#[cfg(not(windows))]
fn idle_seconds() -> u64 {
    0
}

async fn safe_to_install(app: &AppHandle, automatic: bool) -> bool {
    if !idle_window(automatic, auto(app).await, idle_seconds()) {
        return false;
    }
    let Some(core) = app.try_state::<Arc<CoreProcess>>() else {
        return false;
    };
    // The roster includes Raphael, foreground turns, queued work and waiting cards.
    core.call("members.list", json!({}))
        .await
        .is_ok_and(|value| members_idle(&value))
}

fn idle_window(automatic: bool, enabled: bool, idle: u64) -> bool {
    !automatic || (enabled && idle >= 600)
}

async fn install(app: &AppHandle, state: &Updates, automatic: bool) -> Result<(), String> {
    if !safe_to_install(app, automatic).await {
        return Err("busy".into());
    }
    let mut pending = state.pending.lock().await;
    let Some(update) = pending.update.as_ref() else {
        return Err("unavailable".into());
    };
    let Some(bytes) = pending.bytes.as_ref() else {
        return Err("unavailable".into());
    };
    update.verify(bytes).map_err(|error| error_kind(&error))?;
    let store = app.state::<DeviceStore>();
    let mut settings = store.lock().await;
    settings.update_receipt = update.version.clone();
    settings.save(store.path()).map_err(|_| "storage")?;
    if let Err(error) = update.install(bytes) {
        settings.update_receipt.clear();
        let _ = settings.save(store.path());
        return Err(error_kind(&error).into());
    }
    pending.view.state = "installing";
    app.restart();
}

async fn operate(app: &AppHandle, action: &str, automatic: bool) -> View {
    let state = app.state::<Updates>();
    let _operation = state.operation.lock().await;
    let result = match action {
        "check" => {
            let checked = check(app, &state).await;
            if checked.is_ok() && auto(app).await {
                download(&state).await
            } else {
                checked
            }
        }
        "install" => match download(&state).await {
            Ok(()) => install(app, &state, automatic).await,
            Err(error) => Err(error),
        },
        _ => Ok(()),
    };
    let mut pending = state.pending.lock().await;
    if let Err(error) = result {
        pending.view.state = "error";
        pending.view.error = error;
    }
    if action == "status"
        && let Some(store) = app.try_state::<DeviceStore>()
    {
        let mut settings = store.lock().await;
        if settings.update_receipt == app.package_info().version.to_string() {
            let version = std::mem::take(&mut settings.update_receipt);
            if settings.save(store.path()).is_ok() {
                pending.view.installed = version;
            } else {
                settings.update_receipt = version;
            }
        }
    }
    let view = pending.view.clone();
    pending.view.installed.clear();
    view
}

#[tauri::command]
pub async fn update_control(
    app: AppHandle,
    webview: Webview,
    action: String,
) -> Result<View, String> {
    if webview.label() != "main" || !matches!(action.as_str(), "status" | "check" | "install") {
        return Err("not allowed".into());
    }
    Ok(operate(&app, &action, false).await)
}

pub fn start(app: &AppHandle) {
    app.manage(Updates::default());
    if crate::native_journey() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_check = None;
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            if !auto(&app).await {
                last_check = None;
                continue;
            }
            if last_check
                .is_none_or(|time: std::time::Instant| time.elapsed() >= Duration::from_secs(3600))
            {
                operate(&app, "check", true).await;
                last_check = Some(std::time::Instant::now());
            }
            if app.state::<Updates>().pending.lock().await.bytes.is_some()
                && safe_to_install(&app, true).await
            {
                operate(&app, "install", true).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fake_feed_refuses_tampering_unsigned_bytes_and_replayed_versions() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            process::Command,
        };
        let directory = tempfile::tempdir().unwrap();
        let key = directory.path().join("test.key");
        let payload = directory.path().join("test.exe");
        std::fs::write(&payload, b"synthetic installer; never executed").unwrap();
        let cli = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../node_modules/@tauri-apps/cli/tauri.js");
        // Private test keys exist only in the temporary directory, never in source or logs.
        assert!(
            Command::new("node")
                .arg(&cli)
                .args(["signer", "generate", "--ci", "-p", "", "-w"])
                .arg(&key)
                .output()
                .unwrap()
                .status
                .success()
        );
        assert!(
            Command::new("node")
                .arg(&cli)
                .args(["signer", "sign", "--app-version", "2.0.0", "-p", "", "-f"])
                .arg(&key)
                .arg(&payload)
                .output()
                .unwrap()
                .status
                .success()
        );
        let public = std::fs::read_to_string(key.with_extension("key.pub")).unwrap();
        let signature = std::fs::read_to_string(payload.with_extension("exe.sig")).unwrap();
        for case in ["valid", "tampered", "unsigned", "replay", "old"] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/latest.json", listener.local_addr().unwrap());
            let version = match case {
                "old" => "0.0.1",
                "replay" => "9.9.9",
                _ => "2.0.0",
            };
            let manifest = json!({"version":version,"platforms":{"windows-x86_64":{"url":endpoint.replace("latest.json", "payload"),"signature":if case == "unsigned" { "" } else { signature.trim() }}}}).to_string();
            let server = std::thread::spawn(move || {
                for _ in 0..if case == "old" { 1 } else { 2 } {
                    let (mut socket, _) = listener.accept().unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    let mut request = [0; 4096];
                    let length = socket.read(&mut request).unwrap();
                    let bytes: &[u8] =
                        if String::from_utf8_lossy(&request[..length]).contains("/latest.json") {
                            manifest.as_bytes()
                        } else if case == "tampered" {
                            b"changed installer"
                        } else {
                            b"synthetic installer; never executed"
                        };
                    write!(
                        socket,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        bytes.len()
                    )
                    .unwrap();
                    socket.write_all(bytes).unwrap();
                }
            });
            let mut context = tauri::test::mock_context(tauri::test::noop_assets());
            context.config_mut().plugins.0.insert(
                "updater".into(),
                json!({"pubkey":"","requireSignedVersion":true}),
            );
            let app = tauri::test::mock_builder()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .build(context)
                .unwrap();
            let updater = app
                .updater_builder()
                .pubkey(public.trim())
                .no_proxy()
                .target("windows-x86_64")
                .endpoints(vec![endpoint.parse().unwrap()])
                .unwrap()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap();
            let update = updater.check().await.unwrap();
            if case == "old" {
                assert!(update.is_none());
            } else {
                let result = update.unwrap().download(|_, _| {}, || {}).await;
                assert_eq!(result.is_ok(), case == "valid", "{case}");
                if let Err(error) = result {
                    assert_eq!(
                        error_kind(&error),
                        if case == "replay" {
                            "version"
                        } else {
                            "verification"
                        },
                        "{case}: refusals must come from signature validation"
                    );
                }
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn only_a_complete_idle_roster_allows_installation() {
        assert!(!idle_window(true, false, 600));
        assert!(!idle_window(true, true, 599));
        assert!(idle_window(true, true, 600));
        assert!(idle_window(false, false, 0));
        assert!(members_idle(
            &json!({"members":[{"activity":"idle","waiting":false}]})
        ));
        for state in ["working", "thinking", "blocked", "waiting"] {
            assert!(!members_idle(
                &json!({"members":[{"activity":state,"waiting":false}]})
            ));
        }
        assert!(!members_idle(
            &json!({"members":[{"activity":"idle","waiting":true}]})
        ));
        assert!(!members_idle(&json!({"members":[]})));
        assert!(!members_idle(&json!({})));
    }
}
