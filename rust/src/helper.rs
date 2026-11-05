use crate::{
    clipboard,
    state::{now, num, text, State},
    windows,
};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::atomic::Ordering,
};
use tauri::{AppHandle, Manager};
pub fn apple(value: &str) -> bool {
    let s = value.to_lowercase();
    s == "com.apple.music" || s.contains("applemusic") || s.contains("itunes")
}
pub fn slider_scale(min: f64, max: f64, duration: f64) -> Option<f64> {
    let span = max - min;
    if ![min, max, duration].iter().all(|n| n.is_finite()) || span <= 0.0 || duration <= 0.0 {
        return None;
    }
    let near = |a: f64, b: f64| (a - b).abs() <= 0.02_f64.max(b.abs() * 0.02);
    if ![duration, 1.0, 100.0, duration * 1000.0]
        .iter()
        .any(|v| near(span, *v))
    {
        return None;
    }
    Some(duration / span)
}
pub fn snapshot(state: &State) -> Value {
    let mut media = state.media.lock().unwrap().clone();
    if media["active"] != true {
        return media;
    }
    let ahead = if media["playing"] == true {
        (now() - media["positionAt"].as_i64().unwrap_or(now())).max(0) as f64 / 1000.0
    } else {
        0.0
    };
    let duration = num(&media, "duration", 0.0);
    media["position"] = json!(
        (num(&media, "position", 0.0) + ahead).min(if duration > 0.0 {
            duration
        } else {
            f64::MAX
        })
    );
    media["positionAt"] = json!(now());
    let a = state.helper_status.lock().unwrap()["apple"].clone();
    if apple(text(&media, "app"))
        && a["key"] == media["key"]
        && now() - a["at"].as_i64().unwrap_or(0) < 2000
    {
        if let Some(scale) = slider_scale(
            num(&a, "min", 0.0),
            num(&a, "max", 0.0),
            num(&media, "duration", 0.0),
        ) {
            let ahead = if media["playing"] == true {
                (now() - a["at"].as_i64().unwrap_or(now())) as f64 / 1000.0
            } else {
                0.0
            };
            media["position"] = json!(((num(&a, "pos", 0.0) - num(&a, "min", 0.0)) * scale
                + ahead)
                .min(num(&media, "duration", f64::MAX)));
            media["posSource"] = json!("app");
            media["canSeek"] = json!(true);
        }
    }
    media
}
fn directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("helper");
    Ok(if dir.exists() {
        dir
    } else {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/rust-helper")
    })
}
pub fn start(app: &AppHandle) -> Result<(), String> {
    let dir = directory(app)?;
    let mac = cfg!(target_os = "macos");
    let full = dir.join(if mac { "atoll-mac" } else { "atoll-helper.exe" });
    let core = dir.join("atoll-helper-core.exe");
    let kind = if full.exists() {
        "native"
    } else if !mac && core.exists() {
        "native-core+powershell"
    } else if !mac {
        "powershell"
    } else {
        return Err("Mac native companion is missing".into());
    };
    app.state::<State>().helper_status.lock().unwrap()["kind"] = json!(kind);
    spawn(
        app,
        "main",
        if kind == "powershell" {
            None
        } else {
            Some(if kind == "native" { full } else { core })
        },
        false,
        0,
    )?;
    if kind == "native-core+powershell" {
        spawn(app, "media", None, true, 0)?;
    }
    sync(app);
    Ok(())
}
fn spawn(
    app: &AppHandle,
    role: &str,
    path: Option<std::path::PathBuf>,
    media_only: bool,
    crashes: u32,
) -> Result<(), String> {
    let mut command = if let Some(path) = &path {
        Command::new(path)
    } else {
        let mut c = Command::new("powershell.exe");
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(directory(app)?.join("native.ps1"));
        if media_only {
            c.arg("-MediaOnly");
        }
        c
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Companion stdout unavailable")?;
    let state = app.state::<State>();
    let role = role.to_string();
    if let Some(input) = child.stdin.take() {
        state.inputs.lock().unwrap().insert(role.clone(), input);
    }
    state.helpers.lock().unwrap().insert(role.clone(), child);
    state.helper_status.lock().unwrap()["exe"] = json!(path);
    let handle = app.clone();
    let started = std::time::Instant::now();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                let state = handle.state::<State>();
                if value["type"] == "mem" {
                    state.helper_status.lock().unwrap()["mem"][&role] = value["ws"].clone();
                    continue;
                }
                if role == "main"
                    && state.helper_status.lock().unwrap()["kind"] == "native-core+powershell"
                    && matches!(text(&value, "type"), "media" | "art")
                {
                    continue;
                }
                event(&handle, value);
            }
        }
        let state = handle.state::<State>();
        state.inputs.lock().unwrap().remove(&role);
        if let Some(mut child) = state.helpers.lock().unwrap().remove(&role) {
            let _ = child.wait();
        }
        if role == "main" {
            state.helper_status.lock().unwrap()["alive"] = json!(false);
        }
        if !state.closing.load(Ordering::Relaxed) {
            let early = started.elapsed().as_secs() < 5;
            std::thread::sleep(std::time::Duration::from_secs(2));
            if cfg!(target_os = "windows") && path.is_some() && early && crashes >= 1 {
                // Native dependencies unavailable: retain media, volume and clipboard via the existing fallback.
                state.helper_status.lock().unwrap()["kind"] = json!("powershell");
                if let Some(mut child) = state.helpers.lock().unwrap().remove("media") {
                    let _ = child.kill();
                }
                let _ = spawn(&handle, "main", None, false, 0);
            } else if !state.closing.load(Ordering::Relaxed)
                && (role == "main"
                    || state.helper_status.lock().unwrap()["kind"] == "native-core+powershell")
            {
                let _ = spawn(
                    &handle,
                    &role,
                    path,
                    media_only,
                    if early { crashes + 1 } else { 0 },
                );
            }
        }
    });
    Ok(())
}
pub fn sync(app: &AppHandle) {
    let s = app.state::<State>();
    let settings = s.settings();
    s.native(json!({"cmd":"toasts","on":settings["notifications"]!=false&&settings["windowsNotifications"]!=false}));
    let on = s.helper_status.lock().unwrap()["fullscreen"].clone();
    if on.is_boolean() {
        event(app, json!({"type":"fullscreen","on":on}));
    }
}
pub fn event(app: &AppHandle, mut value: Value) {
    let state = app.state::<State>();
    let kind = text(&value, "type").to_string();
    match kind.as_str() {
        "ready" => {
            state.helper_status.lock().unwrap()["alive"] = json!(true);
            sync(app);
        }
        "mem" => {
            state.helper_status.lock().unwrap()["mem"]["main"] = value["ws"].clone();
        }
        "media" => {
            value["positionAt"] = json!(now());
            if apple(text(&value, "app")) && text(&value, "album").is_empty() {
                let artist = text(&value, "artist").to_string();
                for separator in [" — ", " – ", " - "] {
                    if let Some((artist, album)) = artist.split_once(separator) {
                        value["artist"] = json!(artist.trim());
                        value["album"] = json!(album.trim());
                        break;
                    }
                }
            }
            let old = state.media.lock().unwrap().clone();
            if value["key"] != old["key"] {
                state.helper_status.lock().unwrap()["apple"] = Value::Null;
            }
            if cfg!(target_os = "windows") && value["key"] != old["key"] {
                state.native(
                    json!({"cmd":"amwatch","on":apple(text(&value,"app")),"key":value["key"]}),
                );
            }
            if value["key"] == old["key"] {
                value["cover"] = old["cover"].clone();
            }
            *state.media.lock().unwrap() = value;
            windows::emit(app, "media", snapshot(&state));
        }
        "ampos" => {
            let media = state.media.lock().unwrap().clone();
            if value["key"] != media["key"] || !apple(text(&media, "app")) {
                return;
            }
            if value["ok"] == true
                && slider_scale(
                    num(&value, "min", 0.0),
                    num(&value, "max", 0.0),
                    num(&media, "duration", 0.0),
                )
                .is_some()
            {
                let old = state.helper_status.lock().unwrap()["apple"].clone();
                let at = if old["pos"] == value["pos"]
                    && old["key"] == value["key"]
                    && old["playing"] == media["playing"]
                {
                    old["at"].clone()
                } else {
                    json!(now())
                };
                value["at"] = at;
                value["playing"] = media["playing"].clone();
                state.helper_status.lock().unwrap()["apple"] = value;
            }
            windows::emit(app, "media", snapshot(&state));
        }
        "amdone" => {
            if value["ok"] != true {
                if matches!(text(&value, "cmd"), "prev" | "amprev") {
                    state.native(json!({"cmd":"prev"}));
                } else {
                    windows::emit(app, "media-note", json!({"kind":"noseek"}));
                }
            }
        }
        "art" => {
            if state.media.lock().unwrap()["key"] == value["key"] {
                state.media.lock().unwrap()["cover"] = value.clone();
                windows::emit(app, "art", value);
            }
        }
        "system" => {
            *state.system.lock().unwrap() = value.clone();
            windows::emit(app, "system", value);
        }
        "clip" => {
            state.clipboard.lock().unwrap()["helperSeen"] = json!(true);
            let handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                std::thread::sleep(std::time::Duration::from_millis(120));
                let _ = clipboard::capture(&handle, &value);
            });
        }
        "captured" => {
            let id = text(&value, "id").to_string();
            if let Some(sender) = state.captures.lock().unwrap().remove(&id) {
                let _ = sender.send(value);
            }
        }
        "toasts-status" => {
            state.helper_status.lock().unwrap()["toasts"] = value.clone();
            windows::emit(app, "toasts-status", value);
        }
        "toast" => {
            if state.settings()["notifications"] != false {
                value["source"] = json!("windows");
                windows::emit(app, "notify", value);
            }
        }
        "fg" => {
            let capture = matches!(
                text(&value, "proc").to_lowercase().as_str(),
                "screenclippinghost"
                    | "snippingtool"
                    | "screensketch"
                    | "sharex"
                    | "greenshot"
                    | "lightshot"
                    | "snagit32"
                    | "snagitcapture"
                    | "picpick"
                    | "flameshot"
                    | "gyazo"
            );
            state.helper_status.lock().unwrap()["captureHidden"] = json!(capture);
            windows::refresh_visibility(app);
        }
        "fullscreen" => {
            state.helper_status.lock().unwrap()["fullscreen"] = value["on"].clone();
            let settings = state.settings();
            let mode = text(&settings, "fullscreenMode");
            windows::emit(app, "fullscreen", json!({"on":value["on"],"mode":mode}));
            state.helper_status.lock().unwrap()["fullscreenHidden"] =
                json!(mode == "hide" && value["on"] == true);
            windows::refresh_visibility(app);
        }
        "net" => {
            let mut status = state.helper_status.lock().unwrap();
            let prior = status["net"].clone();
            let elapsed = (num(&value, "t", 0.0) - num(&prior, "t", 0.0)) / 1000.0;
            if elapsed > 0.0 {
                status["rates"] = json!({"down":((num(&value,"rx",0.0)-num(&prior,"rx",0.0))/elapsed).max(0.0),"up":((num(&value,"tx",0.0)-num(&prior,"tx",0.0))/elapsed).max(0.0)});
            }
            status["net"] = value;
        }
        "diag" | "error" => {
            let mut h = state.helper_status.lock().unwrap();
            if let Some(messages) = h["messages"].as_array_mut() {
                messages.push(json!({"where":"native","at":now(),"msg":value["msg"]}));
                if messages.len() > 12 {
                    messages.remove(0);
                }
            }
        }
        _ => {}
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slider_units_match_electron() {
        assert_eq!(slider_scale(0.0, 100.0, 240.0), Some(2.4));
        assert_eq!(slider_scale(0.0, 1.0, 240.0), Some(240.0));
        assert_eq!(slider_scale(0.0, 333.0, 240.0), None);
    }
}
