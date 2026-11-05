use crate::{
    clipboard, platform,
    state::{now, num, text, State},
    windows,
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
pub fn shortcuts(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
    let settings = app.state::<State>().settings();
    let mut statuses = json!({});
    if let Some(keys) = settings["shortcuts"].as_object() {
        for (name, key) in keys {
            let shortcut = key.as_str().unwrap_or("");
            if shortcut.is_empty() {
                statuses[name] = json!("off");
                continue;
            }
            let name = name.clone();
            let action = name.clone();
            let status = app
                .global_shortcut()
                .on_shortcut(shortcut, move |app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        action_for(app, &action);
                    }
                });
            statuses[name] = json!(if status.is_ok() { "ok" } else { "taken" });
        }
    }
    *app.state::<State>().shortcuts.lock().unwrap() = statuses.clone();
    windows::emit(app, "shortcuts", statuses);
}
pub fn action_for(app: &AppHandle, action: &str) {
    let state = app.state::<State>();
    match action {
        "settings" => {
            let _ = windows::open_settings(app, "general");
        }
        "setup" => {
            let _ = windows::create(app, "setup", "setup.html", 640.0, 640.0);
        }
        "open" => windows::emit(app, "open-tab", json!("now")),
        "clipboard" => {
            windows::hide(app, false);
            windows::emit(app, "open-tab", json!("clipboard"));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }
        "hide" => windows::hide(app, !state.hidden.load(Ordering::Relaxed)),
        "reset" => windows::reset(app),
        "move" => {
            windows::hide(app, false);
            windows::emit(app, "move-mode", json!(true));
        }
        "romanization" | "minimal" | "light" => {
            let mut s = state.settings();
            let key = if action == "romanization" {
                "showRomanization"
            } else if action == "light" {
                "theme"
            } else {
                "minimal"
            };
            s[key] = if key == "theme" {
                json!(if s[key] == "light" { "dark" } else { "light" })
            } else {
                json!(s[key] != true)
            };
            let _ = state.set("settings", s);
            state.broadcast(app);
        }
        "s" | "m" | "l" => {
            let mut s = state.settings();
            s["size"] = json!(action);
            let _ = state.set("settings", s);
            let _ = windows::place(app);
            state.broadcast(app);
        }
        "layout" => {
            let mut s = state.settings();
            let old = s["position"].clone();
            let key = if old["mode"] == "side" {
                text(&old, "side")
            } else {
                "top"
            };
            s["positionPresets"][key] = old.clone();
            let next = match key {
                "top" => "right",
                "right" => "left",
                _ => "top",
            };
            let mut pos = s["positionPresets"][next].clone();
            if pos.is_null() {
                pos = if next == "top" {
                    json!({"mode":"top","top":0,"frac":0.5})
                } else {
                    json!({"mode":"side","side":next,"cy":num(&windows::selected(app),"height",982.0)/2.0})
                };
            }
            pos["display"] = old["display"].clone();
            s["position"] = pos;
            let _ = state.set("settings", s);
            let _ = windows::place(app);
            state.broadcast(app);
        }
        "area" | "full" => {
            let handle = app.clone();
            let mode = action.to_string();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = screenshot(&handle, &mode).await {
                    windows::emit(&handle, "shot-saved", json!({"error":e}));
                }
            });
        }
        "autostart" => {
            use tauri_plugin_autostart::ManagerExt;
            let manager = app.autolaunch();
            let on = !manager.is_enabled().unwrap_or(false);
            let result = if on {
                manager.enable()
            } else {
                manager.disable()
            };
            if result.is_ok() {
                let mut s = state.settings();
                s["startWithWindows"] = json!(on);
                let _ = state.set("settings", s);
                state.broadcast(app);
            }
        }
        "copy-example" => {
            let s = state.settings();
            let example=format!("curl -X POST http://127.0.0.1:{}/notify -H 'X-Atoll-Token: {}' -H 'Content-Type: application/json' -d '{{\"title\":\"Hello\"}}'",s["notifyPort"],text(&s,"notifyToken"));
            let _ = arboard::Clipboard::new().and_then(|mut cb| cb.set_text(example));
        }
        "restart" => app.restart(),
        "quit" => {
            if cfg!(target_os = "windows") && state.update.lock().unwrap()["state"] == "ready" {
                let _ = crate::updates::install(app, false);
            }
            state.stop();
            app.exit(0);
        }
        _ => {
            if let Some(id) = action.strip_prefix("display:") {
                let mut s = state.settings();
                s["position"]["display"] = json!(id);
                if let Some(presets) = s["positionPresets"].as_object_mut() {
                    for p in presets.values_mut() {
                        p["display"] = json!(id);
                    }
                }
                let _ = state.set("settings", s);
                let _ = windows::place(app);
                state.broadcast(app);
            }
        }
    }
}
pub fn menu(app: &AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let menu = Menu::new(app).map_err(|e| e.to_string())?;
    for (id, label) in [
        ("open", "Open Atoll"),
        ("autostart", "Toggle open at login"),
        ("copy-example", "Copy notification API example"),
        ("settings", "Settings…"),
        ("setup", "Setup guide…"),
        ("minimal", "Toggle minimal notch"),
        ("light", "Toggle white notch"),
        ("hide", "Hide / show Atoll"),
        ("area", "Screenshot an area"),
        ("clipboard", "Clipboard history"),
        ("layout", "Cycle layout"),
        ("move", "Move the notch…"),
        ("reset", "Back to top centre"),
    ] {
        let item =
            MenuItem::with_id(app, id, label, true, None::<&str>).map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }
    let sizes = Submenu::new(app, "Size", true).map_err(|e| e.to_string())?;
    for (id, label) in [("s", "Small"), ("m", "Medium"), ("l", "Large")] {
        let item =
            MenuItem::with_id(app, id, label, true, None::<&str>).map_err(|e| e.to_string())?;
        sizes.append(&item).map_err(|e| e.to_string())?;
    }
    menu.append(&sizes).map_err(|e| e.to_string())?;
    let displays = Submenu::new(app, "Show notch on screen", true).map_err(|e| e.to_string())?;
    for d in windows::screens(app) {
        let id = if d["primary"] == true {
            "primary".to_string()
        } else {
            d["id"].to_string().trim_matches('"').to_string()
        };
        let item = MenuItem::with_id(
            app,
            format!("display:{id}"),
            text(&d, "name"),
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        displays.append(&item).map_err(|e| e.to_string())?;
    }
    menu.append(&displays).map_err(|e| e.to_string())?;
    menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for (id, label) in [("restart", "Restart Atoll"), ("quit", "Quit Atoll")] {
        menu.append(
            &MenuItem::with_id(app, id, label, true, None::<&str>).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(menu)
}
pub fn tray(app: &AppHandle) -> Result<(), String> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../app/assets/tray-dark.png"))
        .map_err(|e| e.to_string())?;
    tauri::tray::TrayIconBuilder::with_id("atoll")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Atoll")
        .menu(&menu(app)?)
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn start_poll(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut hovering = false;
        let mut tick = 0u64;
        let mut old_displays = String::new();
        while !app.state::<State>().closing.load(Ordering::Relaxed) {
            let state = app.state::<State>();
            if let Some(w) = app.get_webview_window("main") {
                let scale = w.scale_factor().unwrap_or(1.0);
                if let (Ok(p), Ok(b)) = (w.cursor_position(), w.outer_position()) {
                    let x = (p.x - b.x as f64) / scale;
                    let y = (p.y - b.y as f64) / scale;
                    let z = state.zoom();
                    let rect = state.hit.lock().unwrap().clone();
                    let margin = if hovering { 14.0 } else { 4.0 };
                    if now() - state.held_at.load(Ordering::Relaxed) > 20000 {
                        state.held.store(false, Ordering::Relaxed);
                    }
                    let inside = state.held.load(Ordering::Relaxed)
                        || state.dragging.load(Ordering::Relaxed)
                        || (x >= num(&rect, "x", 0.0) * z - margin
                            && x <= (num(&rect, "x", 0.0) + num(&rect, "w", 196.0)) * z + margin
                            && y >= num(&rect, "y", 0.0) * z - margin
                            && y <= (num(&rect, "y", 0.0) + num(&rect, "h", 32.0)) * z + margin);
                    if inside != hovering {
                        hovering = inside;
                        let _ = w.set_ignore_cursor_events(!inside);
                        windows::emit(&app, "hover", json!(inside));
                    }
                    if state.dragging.load(Ordering::Relaxed) {
                        let all = windows::screens(&app);
                        if let Some(d) = all.iter().find(|d| {
                            let k = if cfg!(target_os = "macos") {
                                scale
                            } else {
                                num(d, "scaleFactor", 1.0)
                            };
                            p.x >= num(d, "x", 0.0) * k
                                && p.x < (num(d, "x", 0.0) + num(d, "width", 0.0)) * k
                                && p.y >= num(d, "y", 0.0) * k
                                && p.y < (num(d, "y", 0.0) + num(d, "height", 0.0)) * k
                        }) {
                            let k = if cfg!(target_os = "macos") {
                                scale
                            } else {
                                num(d, "scaleFactor", 1.0)
                            };
                            let px = p.x / k;
                            let py = p.y / k;
                            let grab = state.grab.lock().unwrap().clone();
                            let dx = px - num(d, "x", 0.0);
                            let dy = py - num(d, "y", 0.0);
                            let dw = num(d, "width", 1512.0);
                            let display = if d["primary"] == true {
                                json!("primary")
                            } else {
                                json!(d["id"].to_string().trim_matches('"'))
                            };
                            let pos = if dy > 30.0 && (dx < 40.0 || dw - dx < 40.0) {
                                json!({"mode":"side","side":if dx<40.0{"left"}else{"right"},"cy":dy,"display":display})
                            } else {
                                let mut fraction =
                                    ((dx - num(&grab, "x", 0.0) * z) / dw).clamp(0.0, 1.0);
                                let mut top = (dy - num(&grab, "y", 0.0) * z).max(0.0);
                                if state.settings()["snapGuides"] != false {
                                    if top < 24.0 * z {
                                        top = 0.0;
                                    }
                                    for snap in [0.25, 0.5, 0.75] {
                                        if (fraction - snap).abs() * dw < 14.0 {
                                            fraction = snap;
                                            windows::emit(
                                                &app,
                                                "snap-guide",
                                                json!({"axis":"x","at":(snap*dw+num(d,"x",0.0)-b.x as f64/scale)/z,"matched":true}),
                                            );
                                        }
                                    }
                                }
                                json!({"mode":"top","frac":fraction,"top":top,"display":display})
                            };
                            state.store.lock().unwrap()["settings"]["position"] = pos;
                            let _ = windows::place(&app);
                        }
                    }
                }
                tick += 1;
                if tick % 15 == 0 {
                    windows::emit(&app, "battery", platform::battery());
                    let displays = windows::screens(&app);
                    let key = json!(displays).to_string();
                    if key != old_displays {
                        old_displays = key;
                        let _ = windows::place(&app);
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(
                if hovering || state.dragging.load(Ordering::Relaxed) {
                    40
                } else {
                    120
                },
            ));
        }
    });
}
pub async fn screenshot(app: &AppHandle, mode: &str) -> Result<(), String> {
    let state = app.state::<State>();
    if state.shot.lock().unwrap()["capture"].is_object() {
        return Ok(());
    }
    let display = windows::under_cursor(app);
    let id = format!("{}", now());
    let file = state.root.join(format!("capture-{id}.png"));
    state.shot.lock().unwrap()["capture"] = json!({"file":file,"display":display});
    let mut guard = CaptureGuard {
        app: app.clone(),
        retain: false,
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.captures.lock().unwrap().insert(id.clone(), tx);
    let factor = if cfg!(target_os = "windows") {
        num(&display, "scaleFactor", 1.0)
    } else {
        1.0
    };
    state.native(json!({"cmd":"capture","id":id,"file":file,"x":num(&display,"x",0.0)*factor,"y":num(&display,"y",0.0)*factor,"w":num(&display,"width",0.0)*factor,"h":num(&display,"height",0.0)*factor}));
    let result = tokio::time::timeout(std::time::Duration::from_secs(8), rx).await;
    state.captures.lock().unwrap().remove(&id);
    let result = result
        .map_err(|_| "Screen capture timed out. Check Screen Recording permission.")?
        .map_err(|e| e.to_string())?;
    if result["ok"] != true {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
        }
        return Err(result["error"]
            .as_str()
            .unwrap_or("Screen capture failed")
            .into());
    }
    state.shot.lock().unwrap()["capture"] = json!({"file":file,"display":display});
    if mode == "area" {
        let w = windows::create(
            app,
            "snip",
            "snip.html",
            num(&display, "width", 1512.0),
            num(&display, "height", 982.0),
        )?;
        platform::position(
            &w,
            num(&display, "x", 0.0),
            num(&display, "y", 0.0),
            num(&display, "width", 1512.0),
            num(&display, "height", 982.0),
            num(&display, "scaleFactor", 1.0),
        );
    } else {
        finish_shot(app, Some(json!({})))?;
    }
    guard.retain = mode == "area";
    Ok(())
}
struct CaptureGuard {
    app: AppHandle,
    retain: bool,
}
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        if !self.retain {
            cancel_shot(&self.app);
        }
    }
}
fn cancel_shot(app: &AppHandle) {
    let state = app.state::<State>();
    let capture = state.shot.lock().unwrap()["capture"].take();
    if let Some(w) = app.get_webview_window("snip") {
        let _ = w.destroy();
    }
    let _ = std::fs::remove_file(text(&capture, "file"));
    windows::refresh_visibility(app);
}
pub fn finish_shot(app: &AppHandle, rect: Option<Value>) -> Result<(), String> {
    let _guard = CaptureGuard {
        app: app.clone(),
        retain: false,
    };
    let state = app.state::<State>();
    let capture = state.shot.lock().unwrap()["capture"].clone();
    if let Some(w) = app.get_webview_window("snip") {
        let _ = w.destroy();
    }
    if let Some(rect) = rect {
        let mut image = image::open(text(&capture, "file")).map_err(|e| e.to_string())?;
        if num(&rect, "w", 0.0) > 2.0 {
            let k = image.width() as f64 / num(&capture["display"], "width", 1512.0);
            let x = (num(&rect, "x", 0.0) * k).max(0.0) as u32;
            let y = (num(&rect, "y", 0.0) * k).max(0.0) as u32;
            let width = (num(&rect, "w", 0.0) * k).max(1.0) as u32;
            let height = (num(&rect, "h", 0.0) * k).max(1.0) as u32;
            if x + width > image.width() || y + height > image.height() {
                return Err("Selection is outside the captured screen".into());
            }
            image = image.crop_imm(x, y, width, height);
        }
        let settings = state.settings();
        let folder = if text(&settings, "screenshotDir").is_empty() {
            app.path()
                .picture_dir()
                .map_err(|e| e.to_string())?
                .join("Screenshots/Atoll")
        } else {
            std::path::PathBuf::from(text(&settings, "screenshotDir"))
        };
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let file = folder.join(format!(
            "Atoll {}.png",
            chrono::Local::now().format("%Y-%m-%d %H.%M.%S")
        ));
        image.save(&file).map_err(|e| e.to_string())?;
        let rgba = image.to_rgba8();
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_image(arboard::ImageData {
            width: rgba.width() as usize,
            height: rgba.height() as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        })
        .map_err(|e| e.to_string())?;
        windows::emit(
            app,
            "shot-saved",
            json!({"file":file,"width":image.width(),"height":image.height(),"thumb":clipboard::data_uri(&image.thumbnail(160,160))?}),
        );
    }
    std::fs::remove_file(text(&capture, "file")).ok();
    state.shot.lock().unwrap()["capture"] = Value::Null;
    if !state.hidden.load(Ordering::Relaxed) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
        }
    }
    Ok(())
}
pub fn notification_server(app: &AppHandle) {
    use std::io::{Read, Write};
    let settings = app.state::<State>().settings();
    let port = num(&settings, "notifyPort", 0.0) as u16;
    if port == 0 {
        return;
    }
    let token = text(&settings, "notifyToken").to_string();
    let app = app.clone();
    std::thread::spawn(move || {
        let Ok(server) = std::net::TcpListener::bind(("127.0.0.1", port)) else {
            return;
        };
        let _ = server.set_nonblocking(true);
        while !app.state::<State>().closing.load(Ordering::Relaxed) {
            let Ok((mut stream, _)) = server.accept() else {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            };
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let mut bytes = Vec::new();
            let mut chunk = [0; 1024];
            let mut header_end = None;
            let mut content_length = 0;
            loop {
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => bytes.extend_from_slice(&chunk[..n]),
                }
                if bytes.len() > 12288 {
                    break;
                }
                if header_end.is_none() {
                    if let Some(p) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                        header_end = Some(p + 4);
                        let headers = String::from_utf8_lossy(&bytes[..p]);
                        content_length = headers
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|s| s.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                    }
                }
                if header_end.is_some_and(|p| bytes.len() >= p + content_length) {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&bytes);
            let header = request.split("\r\n\r\n").next().unwrap_or("");
            let method = header.split_whitespace().next().unwrap_or("");
            let target = header.split_whitespace().nth(1).unwrap_or("");
            let query = url::Url::parse(&format!("http://localhost{target}")).ok();
            let query_token = query.as_ref().and_then(|u| {
                u.query_pairs()
                    .find(|(k, _)| k == "token")
                    .map(|(_, v)| v.into_owned())
            });
            let supplied = header
                .lines()
                .find_map(|l| {
                    l.split_once(':')
                        .filter(|(k, _)| k.eq_ignore_ascii_case("x-atoll-token"))
                        .map(|(_, v)| v.trim().to_string())
                })
                .or(query_token);
            let mut status = "200 OK";
            let mut answer = json!({"ok":true});
            if header.lines().any(|line| {
                line.split_once(':')
                    .is_some_and(|(key, _)| key.eq_ignore_ascii_case("origin"))
            }) {
                status = "403 Forbidden";
                answer = json!({"error":"browser requests not allowed"});
            } else if content_length > 8192 || bytes.len() > 12288 {
                status = "413 Payload Too Large";
                answer = json!({"error":"notification too large"});
            } else if supplied.as_deref() != Some(&token) {
                status = "401 Unauthorized";
                answer = json!({"error":"bad token"});
            } else if !matches!(method, "GET" | "POST")
                || query.as_ref().is_none_or(|u| u.path() != "/notify")
            {
                status = "405 Method Not Allowed";
                answer = json!({"error":"use GET or POST /notify"});
            } else {
                let mut payload = if method == "GET" {
                    query
                        .map(|u| {
                            u.query_pairs()
                                .map(|(k, v)| (k.into_owned(), json!(v)))
                                .collect::<serde_json::Map<_, _>>()
                        })
                        .map(Value::Object)
                        .unwrap_or(json!({}))
                } else {
                    serde_json::from_slice::<Value>(&bytes[header_end.unwrap_or(bytes.len())..])
                        .unwrap_or(json!({"body":request.split("\r\n\r\n").nth(1).unwrap_or("")}))
                };
                if let Some(object) = payload.as_object_mut() {
                    object.remove("token");
                }
                let short = |key: &str, len: usize, default: &str| {
                    payload[key]
                        .as_str()
                        .unwrap_or(default)
                        .chars()
                        .take(len)
                        .collect::<String>()
                };
                let url = text(&payload, "url");
                let url = url::Url::parse(url)
                    .ok()
                    .filter(|u| matches!(u.scheme(), "http" | "https"));
                let notification = json!({"title":short("title",80,"Notification"),"body":short("body",240,""),"app":short("app",40,""),"icon":short("icon",4,""),"url":url.map(|u|u.to_string()),"duration":num(&payload,"duration",6000.0).clamp(2000.0,30000.0)});
                windows::emit(&app, "notify", notification);
            }
            let body = answer.to_string();
            let _=write!(stream,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        }
    });
}
