use crate::{
    clipboard, desktop, helper, network, platform,
    state::{now, num, text, State, VERSION},
    updates, windows,
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
fn local(window: &WebviewWindow) -> bool {
    matches!(
        window.label(),
        "main" | "settings" | "setup" | "toast" | "snip"
    ) && window
        .url()
        .ok()
        .is_some_and(|u| u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost"))
}
#[tauri::command]
pub async fn rpc(
    app: AppHandle,
    window: WebviewWindow,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    if !local(&window) {
        return Err("Desktop commands are restricted to Atoll's bundled interface".into());
    }
    dispatch(app, window, channel, args).await
}
pub async fn dispatch(
    app: AppHandle,
    window: WebviewWindow,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let state = app.state::<State>();
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    let string = |i: usize| args.get(i).and_then(Value::as_str).unwrap_or("");
    let yes = |i: usize| args.get(i).and_then(Value::as_bool).unwrap_or(false);
    if let Some(operation) = channel.strip_prefix("todo:") {
        return match network::todo(&app, operation, &args).await {
            Ok(value) if matches!(operation, "info" | "logout") => Ok(value),
            Ok(value) => Ok(json!({
            "ok":true,
            "data":value}
            )),
            Err(error) => Ok(json!({
            "ok":false,
            "error":error,
            "code":0}
            )),
        };
    }
    match channel.as_str() {
        "store:all" => Ok(state.public()),
        "store:set" => {
            let key = string(0);
            if !matches!(
                key,
                "settings" | "todos" | "water" | "shelf" | "focus" | "remoteNotified"
            ) {
                return Err("This store key is private".into());
            }
            let before = state.settings();
            let mut value = arg(1);
            if key == "settings" {
                let pos = value["position"].clone();
                let name = if pos["mode"] == "side" {
                    text(&pos, "side")
                } else {
                    "top"
                };
                value["positionPresets"][name] = pos.clone();
            }
            state.set(key, value)?;
            state.broadcast(&app);
            if key == "settings" {
                let after = state.settings();
                windows::place(&app)?;
                helper::sync(&app);
                if before["shortcuts"] != after["shortcuts"] {
                    desktop::shortcuts(&app);
                }
                if before["startWithWindows"] != after["startWithWindows"] {
                    use tauri_plugin_autostart::ManagerExt;
                    let auto = app.autolaunch();
                    if after["startWithWindows"] == true {
                        auto.enable().map_err(|e| e.to_string())?;
                    } else {
                        auto.disable().map_err(|e| e.to_string())?;
                    }
                }
                if before["icsUrl"] != after["icsUrl"]
                    || before["calendarSource"] != after["calendarSource"]
                    || before["appleCalendarIds"] != after["appleCalendarIds"]
                {
                    network::calendar(&app, false).await?;
                }
            }
            Ok(json!(true))
        }
        "system:snapshot" => Ok(state.system.lock().unwrap().clone()),
        "fullscreen:state" => Ok(
            json!({"on":state.helper_status.lock().unwrap()["fullscreen"],"mode":state.settings()["fullscreenMode"]}),
        ),
        "media:snapshot" => Ok(helper::snapshot(&state)),
        "media" => {
            let request = arg(0);
            let command = if request.is_object() {
                text(&request, "cmd")
            } else {
                string(0)
            };
            let pos = if request.is_object() {
                num(&request, "pos", 0.0)
            } else {
                arg(1).as_f64().unwrap_or(0.0)
            };
            if !matches!(command, "toggle" | "next" | "prev" | "seek") {
                return Err("Unknown media action".into());
            }
            let media = state.media.lock().unwrap().clone();
            let apple = state.helper_status.lock().unwrap()["apple"].clone();
            if cfg!(target_os = "windows")
                && helper::apple(text(&media, "app"))
                && apple["key"] == media["key"]
                && command == "seek"
            {
                if let Some(scale) = helper::slider_scale(
                    num(&apple, "min", 0.0),
                    num(&apple, "max", 0.0),
                    num(&media, "duration", 0.0),
                ) {
                    state.native(json!({
                    "cmd":"amseek",
                    "pos":num(&apple,
                    "min",
                    0.0)+pos/scale}
                    ));
                    return Ok(Value::Null);
                }
            }
            state.native(json!({
            "cmd":if cfg!(target_os="windows")&&helper::apple(text(&media,
            "app"))&&command=="prev"{
            "amprev"}
            else{
            command}
            ,
            "pos":pos}
            ));
            Ok(Value::Null)
        }
        "hit-rect" => {
            let r = arg(0);
            if ["x", "y", "w", "h"]
                .iter()
                .all(|k| r[*k].as_f64().is_some_and(f64::is_finite))
            {
                *state.hit.lock().unwrap() = r;
            }
            Ok(Value::Null)
        }
        "hold-pointer" => {
            state.held_at.store(now(), Ordering::Relaxed);
            state.held.store(yes(0), Ordering::Relaxed);
            Ok(Value::Null)
        }
        "repaint" => Ok(json!(true)),
        "trim-now" => {
            crate::metrics::trim(&app);
            Ok(json!(true))
        }
        "battery" => Ok(platform::battery()),
        "stats-active" => {
            state.native(json!({
            "cmd":"net",
            "on":yes(0)}
            ));
            Ok(Value::Null)
        }
        "art:download" => network::art(&state, string(0)).await,
        "art:publish" => {
            let v = arg(0);
            if v["key"] == state.media.lock().unwrap()["key"] {
                state.media.lock().unwrap()["cover"] = v.clone();
                windows::emit(&app, "art", v);
            }
            Ok(Value::Null)
        }
        "http" => network::http(&state, string(0), &arg(1)).await,
        "lyrics:service" => Ok(json!(network::service(&state))),
        "cache:get" => network::cache(&state, string(0), None),
        "cache:set" => network::cache(&state, string(0), Some(arg(1))),
        "player:request" => network::player(&app, string(0), string(1), &arg(2)).await,
        "lyric-sources:status" => Ok(windows::source_status(&app)),
        "lyric-sources:connect" => {
            windows::auth(&app, string(0), true)?;
            Ok(windows::source_status(&app))
        }
        "lyric-sources:disconnect" => {
            if !matches!(string(0), "apple" | "spotify") {
                return Err("Unknown player".into());
            }
            state.set_secret(string(0), None)?;
            state.helper_status.lock().unwrap()[format!("auth-{}", string(0))] = json!(false);
            windows::clear_session(&app, string(0))?;
            if let Some(w) = app.get_webview_window(&format!("auth-{}", string(0))) {
                let _ = w.clear_all_browsing_data();
                let _ = w.destroy();
            }
            let status = windows::source_status(&app);
            windows::emit(&app, "lyrics-sources", status.clone());
            Ok(status)
        }
        "updater:state" => {
            let mut v = state.update.lock().unwrap().clone();
            v.as_object_mut().unwrap().remove("staged");
            Ok(v)
        }
        "updater:check" => updates::check(&app).await,
        "updater:install" => updates::install(&app, true),
        "updater:open-page" => {
            app.opener()
                .open_url(
                    "https://github.com/patricktechyy/atoll/releases",
                    None::<String>,
                )
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "calendar:get" => Ok(state.calendar.lock().unwrap().clone()),
        "calendar:refresh" => network::calendar(&app, false).await,
        "calendar:connect-apple" => {
            if window.label() != "settings" || !cfg!(target_os = "macos") {
                return Err("Open Calendar settings on macOS to connect Apple Calendar".into());
            }
            let mut settings = state.settings();
            settings["calendarSource"] = json!("apple");
            state.set("settings", settings)?;
            state.broadcast(&app);
            network::calendar(&app, true).await
        }
        "mac:permissions" => Ok(platform::native(json!({
        "op":"permissions"}
        ))),
        "mac:request" | "mac:fix" => {
            if window.label() != "settings" || !cfg!(target_os = "macos") {
                return Err("Permissions can only be changed in Mac Settings".into());
            }
            let kind = string(0);
            if !matches!(kind, "calendar" | "automation" | "screen" | "accessibility") {
                return Err("Unknown permission".into());
            }
            let testing = std::env::var_os("ATOLL_RUST_TEST_DATA").is_some();
            if channel == "mac:fix" && !testing {
                let service = match kind {
                    "calendar" => "Calendar",
                    "automation" => "AppleEvents",
                    "screen" => "ScreenCapture",
                    _ => "Accessibility",
                };
                let status = std::process::Command::new("/usr/bin/tccutil")
                    .args(["reset", service, "app.atoll.notch"])
                    .status()
                    .map_err(|e| e.to_string())?;
                if !status.success() {
                    return Err("macOS could not reset Atoll's permission".into());
                }
            }
            if testing {
                return Ok(json!({
                "ok":true,
                "allowed":false,
                "test":true}
                ));
            }
            if kind == "calendar" {
                let c = network::calendar(&app, true).await?;
                return Ok(json!({
                "ok":true,
                "allowed":c["authorized"]}
                ));
            }
            if kind == "automation" {
                state.inputs.lock().unwrap().remove("main");
                if let Some(mut child) = state.helpers.lock().unwrap().remove("main") {
                    let _ = child.kill();
                }
                return Ok(json!({
                "ok":true,
                "allowed":null,
                "note":"Play a song in Music or Spotify and allow Atoll to control it."}
                ));
            }
            let kind = kind.to_string();
            let v = tauri::async_runtime::spawn_blocking(move || {
                platform::native(json!({
                "op":"request",
                "kind":kind}
                ))
            })
            .await
            .map_err(|e| e.to_string())?;
            if channel == "mac:fix" {
                Ok(json!({
                "ok":true,
                "allowed":v["allowed"],
                "restart":string(0)=="screen"}
                ))
            } else {
                Ok(v["allowed"].clone())
            }
        }
        "setup:info" => {
            let all = state.store.lock().unwrap();
            Ok(json!({
            "seen":all["setupSeen"],
            "version":1,
            "isUpdate":all["setupSeen"].as_u64().unwrap_or(0)>0||all["firstVersion"].is_null(),
            "toasts":state.helper_status.lock().unwrap()["toasts"]}
            ))
        }
        "setup:open" => {
            desktop::action_for(&app, "setup");
            Ok(Value::Null)
        }
        "setup:done" => {
            state.set("setupSeen", arg(0))?;
            Ok(Value::Null)
        }
        "setup:clip-test" => {
            if state.settings()["clipboardPaused"] == true {
                return Ok(json!({
                "ok":false,
                "reason":"paused"}
                ));
            }
            let sample = format!("Atoll clipboard check {0}", now());
            arboard::Clipboard::new()
                .and_then(|mut c| c.set_text(&sample))
                .map_err(|e| e.to_string())?;
            clipboard::capture(&app, &json!({}))?;
            let found = clipboard::list(&state)
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .find(|i| i["text"] == sample)
                .map(|i| text(i, "id").to_string());
            if let Some(id) = found {
                clipboard::edit(&app, "remove", &id, false)?;
                Ok(json!({
                "ok":true,
                "via":"native"}
                ))
            } else {
                Ok(json!({
                "ok":false,
                "reason":"not seen"}
                ))
            }
        }
        "clip:list" => {
            let _ = clipboard::capture(&app, &json!({}));
            Ok(clipboard::list(&state))
        }
        "clip:status" => {
            let mut v = state.clipboard.lock().unwrap().clone();
            v["paused"] = state.settings()["clipboardPaused"].clone();
            Ok(v)
        }
        "clip:use" => {
            let ok = clipboard::use_item(&app, string(0))?;
            if ok && yes(1) && state.settings()["pasteOnPick"] != false {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
                tokio::time::sleep(std::time::Duration::from_millis(140)).await;
                state.native(json!({
                "cmd":"paste"}
                ));
                tokio::time::sleep(std::time::Duration::from_millis(360)).await;
                windows::refresh_visibility(&app);
            }
            Ok(json!(ok))
        }
        "clip:pin" | "clip:remove" | "clip:clear" => {
            clipboard::edit(&app, channel.trim_start_matches("clip:"), string(0), yes(1))?;
            Ok(Value::Null)
        }
        "clip:file" => {
            let items = clipboard::list(&state);
            let item = items
                .as_array()
                .and_then(|a| a.iter().find(|i| i["id"] == string(0)))
                .ok_or("Clipboard item not found")?;
            let name = text(item, "file");
            if name.contains(['/', '\\']) {
                return Err("Invalid clipboard image path".into());
            }
            let path = state.root.join("clipboard").join(name);
            if text(item, "file").is_empty() {
                return Err("This clipboard item is text".into());
            }
            Ok(json!(path))
        }
        "copy" => {
            arboard::Clipboard::new()
                .and_then(|mut c| c.set_text(string(0)))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "file-icon" => platform::file_icon(string(0)),
        "open-path" => {
            app.opener()
                .open_path(string(0), None::<String>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "show-in-folder" => {
            app.opener()
                .reveal_item_in_dir(string(0))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "open-url" => {
            let url = url::Url::parse(string(0)).map_err(|e| e.to_string())?;
            if !matches!(url.scheme(), "http" | "https") {
                return Err("Only web URLs may be opened".into());
            }
            app.opener()
                .open_url(url.to_string(), None::<String>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "open-ms-settings" => {
            if !matches!(
                string(0),
                "notifications" | "privacy-notifications" | "display"
            ) {
                return Err("Unknown Settings page".into());
            }
            app.opener()
                .open_url(format!("ms-settings:{}", string(0)), None::<String>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "open-settings" => {
            windows::open_settings(&app, string(0))?;
            Ok(Value::Null)
        }
        "open-clipboard" => {
            desktop::action_for(&app, "clipboard");
            Ok(Value::Null)
        }
        "focus-window" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            Ok(Value::Null)
        }
        "close-window" => {
            if window.label() != "main" {
                window.close().map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "notch-menu" => {
            window
                .popup_menu(&desktop::menu(&app)?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "restart" | "quit" => {
            desktop::action_for(&app, &channel);
            Ok(Value::Null)
        }
        "set-volume" => {
            state.native(json!({
            "cmd":"setvol",
            "v":arg(0).as_f64().unwrap_or(0.0).clamp(0.0,
            100.0)}
            ));
            Ok(Value::Null)
        }
        "open-player" => {
            let id = string(0);
            if cfg!(target_os = "macos") {
                let id = if id.to_lowercase().contains("spotify") {
                    "com.spotify.client"
                } else {
                    "com.apple.Music"
                };
                std::process::Command::new("/usr/bin/open")
                    .args(["-b", id])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            } else if id.to_lowercase().contains("spotify") {
                app.opener()
                    .open_url("spotify:", None::<String>)
                    .map_err(|e| e.to_string())?;
            } else if id.to_lowercase().contains("zune")
                || id.to_lowercase().contains("microsoft.media")
            {
                app.opener()
                    .open_url("mswindowsmusic:", None::<String>)
                    .map_err(|e| e.to_string())?;
            } else if id.contains('!')
                && id.contains('_')
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '!' | '.' | '-'))
            {
                std::process::Command::new("explorer.exe")
                    .arg(format!("shell:AppsFolder\\{id}"))
                    .spawn()
                    .map_err(|e| e.to_string())?;
            } else if helper::apple(id) {
                app.opener()
                    .open_url("music:", None::<String>)
                    .map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "notify-test" => {
            let mut n = json!({
            "title":"Hello from Atoll",
            "body":"This is where notifications appear.",
            "app":"Atoll",
            "icon":"bell",
            "force":true}
            );
            if let Some(v) = arg(0).as_object() {
                for (k, v) in v {
                    n[k] = v.clone();
                }
            }
            windows::emit(&app, "notify", n);
            Ok(Value::Null)
        }
        "notify-info" => {
            let s = state.settings();
            Ok(json!({
            "port":s["notifyPort"],
            "token":s["notifyToken"],
            "curl":format!("curl -X POST http://127.0.0.1:{}/notify -H 'X-Atoll-Token: {}' -H 'Content-Type: application/json' -d '{{\"title\":\"Hello\"}}'",
            s["notifyPort"],
            text(&s,
            "notifyToken"))}
            ))
        }
        "displays" => Ok(json!(windows::screens(&app)
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let id = if d["primary"] == true {
                    "primary".to_string()
                } else {
                    d["id"].to_string().trim_matches('"').to_string()
                };
                json!({
                "id":id,
                "primary":d["primary"],
                "width":d["width"],
                "height":d["height"],
                "name":d["name"],
                "label":format!("{} · {}×{}",
                d["name"].as_str().unwrap_or(&format!("Screen {}",
                i+1)),
                d["width"],
                d["height"])}
                )
            })
            .collect::<Vec<_>>())),
        "move-to-display" => {
            desktop::action_for(&app, &format!("display:{}", string(0)));
            Ok(Value::Null)
        }
        "drag-notch" => {
            state.dragging.store(yes(0), Ordering::Relaxed);
            if yes(0) {
                *state.grab.lock().unwrap() = arg(1);
            } else {
                state.save()?;
                state.broadcast(&app);
                windows::emit(&app, "snap-guide", Value::Null);
            }
            Ok(Value::Null)
        }
        "move-mode" => {
            if yes(0) {
                desktop::action_for(&app, "move");
            }
            Ok(Value::Null)
        }
        "reset-position" => {
            windows::reset(&app);
            Ok(Value::Null)
        }
        "place?" => {
            windows::place(&app)?;
            Ok(Value::Null)
        }
        "nudge" => {
            let delta = arg(0);
            let dx = delta[0].as_f64().unwrap_or(0.0);
            let dy = delta[1].as_f64().unwrap_or(0.0);
            let mut s = state.settings();
            let pos = &mut s["position"];
            if pos["mode"] == "side" {
                pos["cy"] = json!((num(pos, "cy", 400.0) + dy).max(0.0));
                pos["inset"] = json!((num(pos, "inset", 0.0)
                    + if pos["side"] == "left" { dx } else { -dx })
                .clamp(0.0, 300.0));
            } else {
                pos["frac"] = json!((num(pos, "frac", 0.5)
                    + dx / num(&windows::selected(&app), "width", 1512.0))
                .clamp(0.0, 1.0));
                pos["top"] = json!((num(pos, "top", 0.0) + dy).max(0.0));
            }
            state.set("settings", s)?;
            windows::place(&app)?;
            state.broadcast(&app);
            Ok(Value::Null)
        }
        "toast:show" => {
            windows::toast(&app, arg(0))?;
            Ok(Value::Null)
        }
        "toast:ready" => {
            let message = state.shot.lock().unwrap()["toast"].clone();
            if !message.is_null() {
                window.emit("toast", message).map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "toast:interactive" => {
            window
                .set_ignore_cursor_events(!yes(0))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "toast:event" => {
            let value = arg(0);
            windows::emit(&app, "toast-event", value.clone());
            if value["type"] == "done" {
                let _ = window.hide();
                state.shot.lock().unwrap()["toast"] = Value::Null;
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    if !handle.state::<State>().closing.load(Ordering::Relaxed)
                        && handle.state::<State>().shot.lock().unwrap()["toast"].is_null()
                    {
                        if let Some(w) = handle.get_webview_window("toast") {
                            let _ = w.destroy();
                        }
                    }
                });
            }
            Ok(Value::Null)
        }
        "shot" => {
            let handle = app.clone();
            let mode = string(0).to_string();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = desktop::screenshot(&handle, &mode).await {
                    windows::emit(
                        &handle,
                        "shot-saved",
                        json!({
                        "error":error}
                        ),
                    );
                }
            });
            Ok(Value::Null)
        }
        "snip:request" => {
            let capture = state.shot.lock().unwrap()["capture"].clone();
            let image = image::open(text(&capture, "file")).map_err(|e| e.to_string())?;
            let mut data = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut data, 90)
                .encode_image(&image)
                .map_err(|e| e.to_string())?;
            window
                .emit(
                    "snip:image",
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data),
                )
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "snip:ready" => {
            let _ = window.show();
            let _ = window.set_focus();
            Ok(Value::Null)
        }
        "snip:done" => {
            desktop::finish_shot(
                &app,
                if arg(0).is_object() {
                    Some(arg(0))
                } else {
                    None
                },
            )?;
            Ok(Value::Null)
        }
        "stats" => Ok(crate::metrics::stats(&app)),
        "shortcuts:status" => Ok(state.shortcuts.lock().unwrap().clone()),
        "toasts:status" => Ok(state.helper_status.lock().unwrap()["toasts"].clone()),
        "diagnostics" => Ok(json!({
        "version":VERSION,
        "runtime":"Rust/Tauri",
        "electron":"Rust/Tauri",
        "windows":std::env::consts::OS,
        "lite":state.settings()["lite"],
        "helper":state.helper_status.lock().unwrap().clone(),
        "clipboard":state.clipboard.lock().unwrap().clone(),
        "appleMusic":{
        "usable":true}
        ,
        "lyrics":{
        "spotify":windows::source_status(&app)["spotify"],
        "apple":windows::source_status(&app)["apple"],
        "recent":[]}
        ,
        "mediaLog":[],
        "screenshot":"",
        "shortcuts":state.shortcuts.lock().unwrap().clone()}
        )),
        "test:window" => {
            if std::env::var_os("ATOLL_RUST_TEST_DATA").is_none() {
                return Err("Test commands are disabled".into());
            }
            let name = window.label().to_string();
            state.helper_status.lock().unwrap()["qa"][&name] = arg(0);
            Ok(Value::Null)
        }
        "test:windows" => {
            if std::env::var_os("ATOLL_RUST_TEST_DATA").is_none() {
                return Err("Test commands are disabled".into());
            }
            Ok(state.helper_status.lock().unwrap()["qa"].clone())
        }
        "test:report" => {
            if std::env::var_os("ATOLL_RUST_TEST_DATA").is_none() {
                return Err("Test commands are disabled".into());
            }
            std::fs::write(state.root.join("test-result.json"), arg(0).to_string())
                .map_err(|e| e.to_string())?;
            state.stop();
            app.exit(0);
            Ok(Value::Null)
        }
        "test:emit" => {
            if std::env::var_os("ATOLL_RUST_TEST_DATA").is_none() {
                return Err("Test commands are disabled".into());
            }
            windows::emit(&app, string(0), arg(1));
            Ok(Value::Null)
        }
        _ => Err(format!("Unknown Atoll command: {channel}")),
    }
}
#[tauri::command]
pub async fn capture_session(
    app: AppHandle,
    window: WebviewWindow,
    mut value: Value,
) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let name = match (window.label(), url.host_str()) {
        ("auth-apple", Some("music.apple.com")) => "apple",
        ("auth-spotify", Some("open.spotify.com")) => "spotify",
        _ => return Err("Session capture is restricted to the player's own account page".into()),
    };
    if app.state::<State>().helper_status.lock().unwrap()[window.label()] != true {
        return Err("This sign-in was cancelled".into());
    }
    if url.scheme() != "https" {
        return Err("HTTPS is required".into());
    }
    if name == "apple" && (text(&value, "dev").is_empty() || text(&value, "user").is_empty())
        || name == "spotify" && text(&value, "token").len() < 40
    {
        return Err("Invalid player session".into());
    }
    if value.to_string().len() > 32768 {
        return Err("Invalid player session size".into());
    }
    value["_capturedAt"] = json!(now());
    app.state::<State>().set_secret(name, Some(value))?;
    windows::emit(&app, "lyrics-sources", windows::source_status(&app));
    let _ = window.destroy();
    Ok(())
}
