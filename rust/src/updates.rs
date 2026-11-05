use crate::{
    state::{now, num, text, State, VERSION},
    windows,
};
use base64::Engine;
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256, Sha512};
use std::{io::Write, path::PathBuf, process::Command};
use tauri::{AppHandle, Manager};
fn newer(next: &str, current: &str) -> bool {
    fn parse(s: &str) -> Option<(u64, u64, u64)> {
        let p = s
            .trim_start_matches('v')
            .split('.')
            .map(|v| v.parse::<u64>())
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        if p.len() != 3 {
            return None;
        }
        Some((p[0], p[1], p[2]))
    }
    match (parse(next), parse(current)) {
        (Some(n), Some(c)) => n > c,
        _ => false,
    }
}
fn supports_os(required: &str, current: &str) -> Result<bool, String> {
    fn parts(value: &str) -> Result<Vec<u64>, String> {
        let mut out = value
            .split('.')
            .map(|s| s.parse::<u64>())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Invalid macOS version")?;
        if out.is_empty() || out.len() > 3 {
            return Err("Invalid macOS version".into());
        }
        out.resize(3, 0);
        Ok(out)
    }
    Ok(parts(current)? >= parts(required)?)
}
fn set(app: &AppHandle, patch: Value) {
    let s = app.state::<State>();
    let mut value = s.update.lock().unwrap();
    for (k, v) in patch.as_object().unwrap() {
        value[k] = v.clone();
    }
    let mut public = value.clone();
    public.as_object_mut().unwrap().remove("staged");
    drop(value);
    windows::emit(app, "updater", public);
}
fn base() -> String {
    if std::env::var_os("ATOLL_RUST_TEST_DATA").is_some() {
        if let Ok(feed) = std::env::var("ATOLL_UPDATE_FEED") {
            return feed.trim_end_matches('/').into();
        }
    }
    "https://github.com/patricktechyy/atoll/releases/latest/download".into()
}
fn safe_asset(name: &str, extension: &str) -> bool {
    !name.is_empty()
        && name.ends_with(extension)
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}
pub async fn check(app: &AppHandle) -> Result<Value, String> {
    let state = app.state::<State>();
    {
        let mut value = state.update.lock().unwrap();
        if matches!(text(&value, "state"), "checking" | "downloading" | "ready") {
            return Ok(value.clone());
        }
        value["state"] = json!("checking");
        value["error"] = json!("");
    }
    set(app, json!({"state":"checking"}));
    match download(app).await {
        Ok(()) => {}
        Err(e) => set(app, json!({"state":"error","error":e,"checkedAt":now()})),
    };
    let mut result = state.update.lock().unwrap().clone();
    result.as_object_mut().unwrap().remove("staged");
    Ok(result)
}
async fn download(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<State>();
    if std::env::var_os("ATOLL_RUST_TEST_DATA").is_some()
        && std::env::var_os("ATOLL_UPDATE_FEED").is_none()
    {
        set(
            app,
            json!({"state":"unavailable","error":"Live updates are disabled in test profiles"}),
        );
        return Ok(());
    }
    let base = base();
    let mac = cfg!(target_os = "macos");
    let response = state
        .client
        .get(format!(
            "{base}/{}",
            if mac { "latest-mac.json" } else { "latest.yml" }
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let feed: Value = if mac {
        response.json().await.map_err(|e| e.to_string())?
    } else {
        serde_yaml::from_str(&response.text().await.map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?
    };
    let version = text(&feed, "version").trim_start_matches('v');
    if !newer(version, VERSION) {
        set(
            app,
            json!({"state":"uptodate","version":null,"checkedAt":now()}),
        );
        return Ok(());
    }
    if mac {
        let required = text(&feed, "minMacOS");
        if !required.is_empty() {
            let current = run("/usr/bin/sw_vers", &["-productVersion"])?;
            if !supports_os(required, current.trim())? {
                set(
                    app,
                    json!({"state":"unavailable","canInstall":false,"version":version,"error":format!("This update requires macOS {required} or later.")}),
                );
                return Ok(());
            }
        }
    }
    let name = if mac {
        text(&feed, "file")
    } else {
        feed["files"][0]["url"]
            .as_str()
            .or_else(|| feed["path"].as_str())
            .unwrap_or("")
    };
    if !safe_asset(name, if mac { ".zip" } else { ".exe" }) {
        return Err("Update feed has an invalid asset name".into());
    }
    let expected = if mac {
        text(&feed, "sha256")
    } else {
        feed["files"][0]["sha512"]
            .as_str()
            .or_else(|| feed["sha512"].as_str())
            .unwrap_or("")
    };
    if expected.is_empty() {
        return Err("Update checksum is missing".into());
    }
    let dir = state.root.join("updates-rust");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let part = dir.join(format!("{name}.part"));
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    set(
        app,
        json!({"state":"downloading","version":version,"progress":0,"notes":feed["notes"].as_str().or_else(||feed["releaseNotes"].as_str()).unwrap_or("")}),
    );
    let response = state
        .client
        .get(format!("{base}/{name}"))
        .timeout(std::time::Duration::from_secs(900))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let size = response
        .content_length()
        .unwrap_or(num(&feed, "size", 0.0) as u64);
    let mut downloaded = 0u64;
    let mut a = Sha256::new();
    let mut b = Sha512::new();
    let mut last_progress = std::time::Instant::now();
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded > 1024 * 1024 * 1024 {
            return Err("Update exceeds the maximum download size".into());
        }
        a.update(&chunk);
        b.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        if size > 0 && last_progress.elapsed().as_millis() >= 200 {
            last_progress = std::time::Instant::now();
            set(
                app,
                json!({"progress":(downloaded as f64/size as f64).min(0.99)}),
            );
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    let actual = if mac {
        format!("{:x}", a.finalize())
    } else {
        base64::engine::general_purpose::STANDARD.encode(b.finalize())
    };
    if actual != expected {
        std::fs::remove_file(&part).ok();
        return Err("The update failed its checksum check and was discarded".into());
    }
    let final_path = dir.join(name);
    std::fs::rename(&part, &final_path).map_err(|e| e.to_string())?;
    let staged = if mac {
        let out = dir.join(format!("Atoll-{version}"));
        std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        run(
            "/usr/bin/ditto",
            &[
                "-x",
                "-k",
                final_path.to_str().ok_or("Invalid update path")?,
                out.to_str().ok_or("Invalid stage path")?,
            ],
        )?;
        let bundle = out.join("Atoll.app");
        run(
            "/usr/bin/codesign",
            &[
                "--verify",
                "--deep",
                "--strict",
                bundle.to_str().ok_or("Invalid bundle path")?,
            ],
        )?;
        let plist = bundle.join("Contents/Info.plist");
        let plist = plist.to_str().ok_or("Invalid plist")?;
        let id = run(
            "/usr/libexec/PlistBuddy",
            &["-c", "Print :CFBundleIdentifier", plist],
        )?;
        let ver = run(
            "/usr/libexec/PlistBuddy",
            &["-c", "Print :CFBundleShortVersionString", plist],
        )?;
        if id.trim() != "app.atoll.notch" || ver.trim() != version {
            return Err("Downloaded app identity/version does not match the update feed".into());
        }
        bundle
    } else {
        final_path
    };
    set(
        app,
        json!({"state":"ready","progress":1,"staged":staged,"checkedAt":now()}),
    );
    windows::emit(
        app,
        "notify",
        json!({"title":format!("Atoll {version} is ready"),"body":"Open Settings → About and choose Restart to update.","icon":"bell"}),
    );
    Ok(())
}
fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
pub fn install(app: &AppHandle, relaunch: bool) -> Result<Value, String> {
    if std::env::var_os("ATOLL_RUST_TEST_DATA").is_some() {
        return Ok(json!({"ok":false,"error":"Installers never run in test profiles"}));
    }
    let state = app.state::<State>();
    let value = state.update.lock().unwrap().clone();
    if value["state"] != "ready" {
        return Ok(json!({"ok":false,"error":"No update is ready"}));
    }
    let path = PathBuf::from(text(&value, "staged"));
    if !path.exists() {
        return Err("Staged update is missing".into());
    }
    if cfg!(target_os = "macos") {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dest = exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .ok_or("Not running from an application bundle")?;
        if dest.extension().and_then(|x| x.to_str()) != Some("app") {
            return Ok(
                json!({"ok":false,"error":"Install Atoll in Applications first","openPage":"https://github.com/patricktechyy/atoll/releases"}),
            );
        }
        if ![Some(dest), dest.parent()].into_iter().flatten().all(|p| {
            Command::new("/usr/bin/test")
                .arg("-w")
                .arg(p)
                .status()
                .is_ok_and(|s| s.success())
        }) {
            return Ok(
                json!({"ok":false,"error":"Atoll cannot replace this read-only installation. Install the download manually.","openPage":"https://github.com/patricktechyy/atoll/releases"}),
            );
        }
        let dir = state.root.join("updates-rust");
        let script = dir.join("install.sh");
        std::fs::write(&script, include_str!("../../.cache/rust-ui/install.sh"))
            .map_err(|e| e.to_string())?;
        Command::new("/bin/sh")
            .arg(script)
            .arg(std::process::id().to_string())
            .arg(path)
            .arg(dest)
            .arg(dir.join(format!("Atoll-previous-{}.app", now())))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        let mut command = Command::new(path);
        command.args(["/S", "/UPDATE"]);
        if relaunch {
            command.arg("/R");
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command.spawn().map_err(|e| e.to_string())?;
    }
    state.update.lock().unwrap()["state"] = json!("installing");
    state.stop();
    app.exit(0);
    Ok(json!({"ok":true}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feed_safety() {
        assert!(newer("1.0.0", "0.12.0"));
        assert!(!newer("0.1.0", "0.12.0"));
        assert!(!newer("bad", "0.12.0"));
        assert!(safe_asset("Atoll-macOS-arm64.zip", ".zip"));
        assert!(!safe_asset("../outside.zip", ".zip"));
        assert!(!safe_asset("https://evil/file.exe", ".exe"));
        assert!(supports_os("13.0", "14.1.2").unwrap());
        assert!(!supports_os("14.0", "13.6.1").unwrap());
        assert!(supports_os("invalid", "14.0").is_err());
    }
}
