//! Signed desktop updates. The background task checks and downloads; only an owner request
//! can install. If members are busy, the in-memory request waits and can be cancelled.
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
impl Pending {
    fn cancel(&mut self) {
        if self.view.state == "waiting" {
            self.view.state = "ready";
        }
    }
}
/// Managed on the builder before any window (`early_state` in lib.rs): a page asks for it at once.
#[derive(Default)]
pub(crate) struct Updates {
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

async fn safe_to_install(app: &AppHandle) -> bool {
    let Some(core) = app.try_state::<Arc<CoreProcess>>() else {
        return false;
    };
    // A core that rejected newer data has no running members. Other RPC failures do
    // not establish safety. The roster includes Raphael, queued work and waiting cards.
    match core
        .call_within("members.list", json!({}), Duration::from_secs(2))
        .await
    {
        Ok(value) => members_idle(&value),
        Err(error) => error.code == 1007 && error.message == "newer_database",
    }
}

#[derive(Debug, PartialEq)]
enum InstallDecision {
    None,
    Wait,
    Install,
}

fn install_decision(waiting: bool, pressed: bool, ready: bool, idle: bool) -> InstallDecision {
    match (waiting, pressed, ready, idle) {
        (false, false, _, _) | (_, _, false, _) => InstallDecision::None,
        (_, _, true, true) => InstallDecision::Install,
        _ => InstallDecision::Wait,
    }
}

// The caller holds the operation lock across the decision and installation.
async fn install(app: &AppHandle, state: &Updates) -> Result<(), String> {
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
    // On Windows the installer takes over. On macOS the plugin replaces the .app in place
    // and returns; let Tauri's event loop relaunch it after releasing the state locks.
    if let Err(error) = update.install(bytes) {
        settings.update_receipt.clear();
        let _ = settings.save(store.path());
        return Err(error_kind(&error).into());
    }
    pending.view.state = "installing";
    drop(settings);
    drop(pending);
    app.request_restart();
    Ok(())
}

async fn consider_install(app: &AppHandle, state: &Updates, pressed: bool) -> Result<(), String> {
    let (waiting, ready) = {
        let mut pending = state.pending.lock().await;
        if pending.view.state == "installing" {
            return Ok(());
        }
        if pressed {
            pending.view.error.clear();
        }
        (pending.view.state == "waiting", pending.bytes.is_some())
    };
    let idle = (waiting || pressed) && ready && safe_to_install(app).await;
    let mut pending = state.pending.lock().await;
    // Cancel can arrive while the roster is being read. It wins until installation starts.
    let waiting = pending.view.state == "waiting";
    let decision = install_decision(waiting, pressed, ready, idle);
    match decision {
        InstallDecision::Install => {
            pending.view.state = "installing";
            drop(pending);
            install(app, state).await
        }
        InstallDecision::Wait => {
            pending.view.state = "waiting";
            Ok(())
        }
        InstallDecision::None => Ok(()),
    }
}

async fn record_error(state: &Updates, result: Result<(), String>) {
    if let Err(error) = result {
        let mut pending = state.pending.lock().await;
        pending.view.state = "error";
        pending.view.error = error;
    }
}

async fn operate(app: &AppHandle, action: &str) -> View {
    let state = app.state::<Updates>();
    if action == "status" {
        return state.pending.lock().await.view.clone();
    }
    if action == "cancel" {
        let mut pending = state.pending.lock().await;
        pending.cancel();
        return pending.view.clone();
    }
    if action == "receipt" {
        let mut view = state.pending.lock().await.view.clone();
        if let Some(store) = app.try_state::<DeviceStore>() {
            let mut settings = store.lock().await;
            if settings.update_receipt == app.package_info().version.to_string() {
                let version = std::mem::take(&mut settings.update_receipt);
                if settings.save(store.path()).is_ok() {
                    view.installed = version;
                } else {
                    settings.update_receipt = version;
                }
            }
        }
        return view;
    }
    let _operation = state.operation.lock().await;
    let result = async {
        if state.pending.lock().await.view.state == "installing" {
            return Ok(());
        }
        match action {
            "check" => {
                check(app, &state).await?;
                if auto(app).await {
                    download(&state).await?;
                }
            }
            "install" => {
                let needs_check = {
                    let pending = state.pending.lock().await;
                    pending.bytes.is_none() && pending.update.is_none()
                };
                if needs_check {
                    check(app, &state).await?;
                }
                download(&state).await?;
                consider_install(app, &state, true).await?;
            }
            _ => unreachable!("validated update action"),
        }
        Ok(())
    }
    .await;
    record_error(&state, result).await;
    state.pending.lock().await.view.clone()
}

#[tauri::command]
pub async fn update_control(
    app: AppHandle,
    webview: Webview,
    action: String,
) -> Result<View, String> {
    if webview.label() != "main"
        || !matches!(
            action.as_str(),
            "status" | "receipt" | "check" | "install" | "cancel"
        )
    {
        return Err("not allowed".into());
    }
    Ok(operate(&app, &action).await)
}

pub fn start(app: &AppHandle) {
    if crate::native_journey() {
        return;
    }
    let background = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_check = None;
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            if !auto(&background).await {
                last_check = None;
                continue;
            }
            if last_check
                .is_none_or(|time: std::time::Instant| time.elapsed() >= Duration::from_secs(3600))
            {
                operate(&background, "check").await;
                last_check = Some(std::time::Instant::now());
            }
        }
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let state = app.state::<Updates>();
            if let Ok(_operation) = state.operation.try_lock() {
                let waiting = state.pending.lock().await.view.state == "waiting";
                if !waiting {
                    continue;
                }
                let result = consider_install(&app, &state, false).await;
                record_error(&state, result).await;
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
        for (target, case) in [
            ("windows-x86_64", "valid"),
            ("darwin-aarch64", "valid"),
            ("darwin-aarch64", "tampered"),
            ("windows-x86_64", "unsigned"),
            ("darwin-aarch64", "replay"),
            ("windows-x86_64", "old"),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/latest.json", listener.local_addr().unwrap());
            let version = match case {
                "old" => "0.0.1",
                "replay" => "9.9.9",
                _ => "2.0.0",
            };
            let entry = |platform: &str| {
                json!({
                    "url": endpoint.replace("latest.json", platform),
                    "signature": if case == "unsigned" { "" } else { signature.trim() },
                })
            };
            let manifest = json!({"version":version,"platforms":{
                "windows-x86_64":entry("windows-x86_64"),
                "darwin-aarch64":entry("darwin-aarch64"),
            }})
            .to_string();
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
                        } else if case == "tampered"
                            || !String::from_utf8_lossy(&request[..length])
                                .starts_with(&format!("GET /{target} "))
                        {
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
                .target(target)
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
    fn download_and_idle_members_are_not_consent() {
        assert_eq!(
            install_decision(false, false, true, true),
            InstallDecision::None
        );
    }

    #[test]
    fn pressing_installs_when_idle_or_waits_until_members_finish() {
        assert_eq!(
            install_decision(false, true, true, true),
            InstallDecision::Install
        );
        assert_eq!(
            install_decision(false, true, true, false),
            InstallDecision::Wait
        );
        assert_eq!(
            install_decision(true, false, true, false),
            InstallDecision::Wait
        );
        assert_eq!(
            install_decision(true, false, true, true),
            InstallDecision::Install
        );
        assert_eq!(
            install_decision(false, true, false, true),
            InstallDecision::None
        );
    }

    #[test]
    fn cancelling_clears_consent_before_a_later_idle_poll() {
        let mut pending = Pending::default();
        pending.view.state = "waiting";
        pending.cancel();
        assert_eq!(pending.view.state, "ready");
        assert_eq!(
            install_decision(pending.view.state == "waiting", false, true, true),
            InstallDecision::None
        );
    }

    #[test]
    fn only_a_complete_idle_roster_allows_installation() {
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
