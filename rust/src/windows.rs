use crate::{
    platform,
    state::{num, text, State},
};
use serde_json::{json, Value};
use sha1::Digest;
use std::sync::atomic::Ordering;
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
pub fn emit(app: &AppHandle, event: &str, value: Value) {
    let _ = app.emit(event, value);
}
pub fn screens(app: &AppHandle) -> Vec<Value> {
    if cfg!(target_os = "macos") {
        if let Some(all) = platform::native(json!({"op":"screens"})).as_array() {
            return all
                .iter()
                .enumerate()
                .map(|(i, d)| {
                    let mut d = d.clone();
                    d["primary"] = json!(i == 0);
                    d
                })
                .collect();
        }
    }
    let primary = app.primary_monitor().ok().flatten();
    app.available_monitors().unwrap_or_default().iter().enumerate().map(|(i,m)|{let scale=m.scale_factor();json!({"id":m.name().cloned().unwrap_or(format!("screen-{i}")),"name":m.name().cloned().unwrap_or(format!("Screen {}",i+1)),"x":m.position().x as f64/scale,"y":m.position().y as f64/scale,"width":m.size().width as f64/scale,"height":m.size().height as f64/scale,"scaleFactor":scale,"primary":primary.as_ref().is_some_and(|p|p.position()==m.position()),"camera":null})}).collect()
}
pub fn selected(app: &AppHandle) -> Value {
    let pos = app.state::<State>().settings()["position"].clone();
    let all = screens(app);
    all.iter()
        .find(|d| {
            d["id"].to_string().trim_matches('"') == text(&pos, "display")
                || text(&pos, "display") == "primary" && d["primary"] == true
        })
        .or_else(|| all.iter().find(|d| d["primary"] == true))
        .or_else(|| all.first())
        .cloned()
        .unwrap_or(json!({"x":0,"y":0,"width":1512,"height":982,"scaleFactor":1}))
}
pub fn create(
    app: &AppHandle,
    label: &str,
    page: &str,
    width: f64,
    height: f64,
) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(w);
    }
    let transparent = matches!(label, "main" | "toast" | "snip");
    let bootstrap = json!({"platform":if cfg!(target_os="macos"){"darwin"}else{"win32"},"caps":platform::caps(),"windowLabel":label,"testFeed":if std::env::var_os("ATOLL_RUST_TEST_DATA").is_some(){std::env::var("ATOLL_UPDATE_FEED").ok()}else{None},"version":crate::state::VERSION,"dragIcon":format!("data:image/png;base64,{}",base64::Engine::encode(&base64::engine::general_purpose::STANDARD,include_bytes!("../../app/assets/drag.png")))});
    let qa = if std::env::var_os("ATOLL_RUST_TEST_DATA").is_some() {
        std::env::var("ATOLL_RUST_TEST_SCRIPT")
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
    } else {
        None
    };
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .title(if label == "settings" {
            "Atoll Settings"
        } else {
            "Atoll"
        })
        .inner_size(width, height)
        .min_inner_size(
            if label == "settings" { 720.0 } else { 1.0 },
            if label == "settings" { 480.0 } else { 1.0 },
        )
        .resizable(label == "settings")
        .decorations(!transparent)
        .transparent(transparent)
        .shadow(!transparent)
        .skip_taskbar(transparent)
        .always_on_top(transparent)
        .visible(false)
        .initialization_script(format!("window.__ATOLL_RUNTIME__={bootstrap};"))
        .on_navigation(|url| {
            matches!(url.scheme(), "tauri" | "about") || url.host_str() == Some("tauri.localhost")
        })
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if window.label() == "main" {
                    let _ = place(window.app_handle());
                }
                if let Some(script) = &qa {
                    let _ = window.eval(script);
                }
            }
        });
    #[cfg(target_os = "windows")]
    let builder = builder.additional_browser_args(&app.state::<State>().web_args);
    let w = builder.build().map_err(|e| e.to_string())?;
    if transparent {
        let _ = w.set_visible_on_all_workspaces(true);
        platform::configure(&w);
    }
    if label == "main" {
        let _ = w.set_ignore_cursor_events(true);
        place(app)?;
    } else {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(w)
}
pub fn place(app: &AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    let state = app.state::<State>();
    let settings = state.settings();
    let pos = &settings["position"];
    let d = selected(app);
    let z = state.zoom();
    let dx = num(&d, "x", 0.0);
    let dy = num(&d, "y", 0.0);
    let dw = num(&d, "width", 1512.0);
    let dh = num(&d, "height", 982.0);
    let sf = num(&d, "scaleFactor", 1.0);
    let (x, y, ww, wh, placement) = if text(pos, "mode") == "side" {
        let ww = 600.0 * z;
        let wh = 660.0 * z;
        let inset = num(pos, "inset", 0.0).clamp(0.0, 300.0);
        let left = text(pos, "side") == "left";
        let x = if left {
            dx + inset
        } else {
            dx + dw - ww - inset
        };
        let cy = dy + num(pos, "cy", dh / 2.0).clamp(90.0 * z, dh - 90.0 * z);
        let y = (cy - wh / 2.0).clamp(dy, (dy + dh - wh).max(dy));
        (
            x,
            y,
            ww,
            wh,
            json!({"mode":"side","side":if left{"left"}else{"right"},"center":(cy-y)/z,"inset":inset}),
        )
    } else {
        let ww = 800.0 * z;
        let wh = 480.0 * z;
        let cx = (dx + num(pos, "frac", 0.5).clamp(0.0, 1.0) * dw)
            .clamp(dx + 125.0 * z, dx + dw - 125.0 * z);
        let top = num(pos, "top", 0.0).clamp(0.0, dh - 50.0 * z);
        let x = (cx - ww / 2.0).clamp(dx, (dx + dw - ww).max(dx));
        let y = (dy + top).clamp(dy, (dy + dh - wh).max(dy));
        let camera = &d["camera"];
        let cutout = if num(camera, "height", 0.0) > 0.0 {
            json!({"x":(dx+num(camera,"x",0.0)-x)/z,"y":(dy-y)/z,"width":num(camera,"width",0.0)/z,"height":num(camera,"height",0.0)/z})
        } else {
            Value::Null
        };
        (
            x,
            y,
            ww,
            wh,
            json!({"mode":"top","offset":(cx-x-ww/2.0)/z,"top":(dy+top-y)/z,"floating":top>0.0,"cutout":cutout}),
        )
    };
    platform::position(&w, x, y, ww, wh, sf);
    let _ = w.set_zoom(z);
    let _ = w.emit("place", placement);
    refresh_visibility(app);
    reposition_toast(app);

    Ok(())
}
pub fn open_settings(app: &AppHandle, section: &str) -> Result<(), String> {
    let w = create(
        app,
        "settings",
        &format!("settings.html#{section}"),
        880.0,
        620.0,
    )?;
    let _ = w.emit("settings-section", section);
    Ok(())
}
pub fn reset(app: &AppHandle) {
    let state = app.state::<State>();
    let mut settings = state.settings();
    settings["position"] = json!({"mode":"top","frac":0.5,"top":0,"display":"primary"});
    let _ = state.set("settings", settings);
    let _ = place(app);
    state.broadcast(app);
}
pub fn hide(app: &AppHandle, on: bool) {
    app.state::<State>().hidden.store(on, Ordering::Relaxed);
    refresh_visibility(app);
}
pub fn refresh_visibility(app: &AppHandle) {
    let s = app.state::<State>();
    let h = s.helper_status.lock().unwrap();
    let hidden = s.hidden.load(Ordering::Relaxed)
        || h["captureHidden"] == true
        || h["fullscreenHidden"] == true
        || s.shot.lock().unwrap()["capture"].is_object();
    drop(h);
    if let Some(w) = app.get_webview_window("main") {
        if hidden {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}
pub fn toast(app: &AppHandle, mut message: Value) -> Result<(), String> {
    let state = app.state::<State>();
    let hidden = state.hidden.load(Ordering::Relaxed)
        || state.helper_status.lock().unwrap()["captureHidden"] == true
        || state.shot.lock().unwrap()["capture"].is_object();
    if hidden {
        emit(
            app,
            "toast-event",
            json!({"id":message["id"],"type":"done"}),
        );
        return Ok(());
    }
    let w = create(app, "toast", "toast.html", 520.0, 150.0)?;
    place_toast(app, &w, &mut message);
    app.state::<State>().shot.lock().unwrap()["toast"] = message;
    let _ = w.emit(
        "toast",
        app.state::<State>().shot.lock().unwrap()["toast"].clone(),
    );
    Ok(())
}
fn place_toast(app: &AppHandle, w: &WebviewWindow, message: &mut Value) {
    let d = selected(app);
    let z = app.state::<State>().zoom();
    let pos = text(message, "pos");
    let width = 520.0 * z;
    let height = 150.0 * z;
    let x = num(&d, "x", 0.0);
    let y = num(&d, "y", 0.0);
    let dw = num(&d, "width", 1512.0);
    let dh = num(&d, "height", 982.0);
    let camera = num(&d["camera"], "height", 0.0);
    let px = if pos.ends_with("left") {
        x
    } else if pos.ends_with("right") {
        x + dw - width
    } else {
        x + (dw - width) / 2.0
    };
    let py = if pos.starts_with("bottom") {
        y + dh - height
    } else if pos == "top-center" {
        y
    } else {
        y + camera.max(24.0)
    };
    platform::position(w, px, py, width, height, num(&d, "scaleFactor", 1.0));
    let _ = w.set_zoom(z);
    message["cameraInset"] = json!(if pos == "top-center" && camera > 0.0 {
        (camera / z).ceil() + 6.0
    } else {
        0.0
    });
}
pub fn reposition_toast(app: &AppHandle) {
    let Some(w) = app.get_webview_window("toast") else {
        return;
    };
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    let mut message = app.state::<State>().shot.lock().unwrap()["toast"].clone();
    if !message.is_object() {
        return;
    }
    place_toast(app, &w, &mut message);
    let _ = w.emit("toast-place", message);
}
pub fn source_status(app: &AppHandle) -> Value {
    let s = app.state::<State>();
    let entry = |name: &str| json!({"connected":s.secret(name).is_some(),"error":"","lastOk":0});
    json!({"spotify":entry("spotify"),"apple":entry("apple")})
}
pub fn auth(app: &AppHandle, name: &str, visible: bool) -> Result<(), String> {
    if !matches!(name, "apple" | "spotify") {
        return Err("Unknown player".into());
    }
    app.state::<State>().helper_status.lock().unwrap()[format!("auth-{name}")] = json!(true);
    let label = format!("auth-{name}");
    if let Some(w) = app.get_webview_window(&label) {
        if visible {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return Ok(());
    }
    let url = if name == "apple" {
        "https://music.apple.com/"
    } else {
        "https://open.spotify.com/"
    };
    let digest =
        sha1::Sha1::digest(format!("{}:{name}", app.state::<State>().root.display()).as_bytes());
    let mut data_store = [0u8; 16];
    data_store.copy_from_slice(&digest[..16]);
    let handle = app.clone();
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.parse().unwrap()))
        .title(format!("Sign in to {name} – Atoll"))
        .inner_size(520.0, 760.0)
        .visible(visible)
        .data_directory(
            app.state::<State>()
                .root
                .join(format!("rust-session-{name}")),
        )
        .data_store_identifier(data_store)
        .initialization_script(include_str!("../../app/renderer/rust-auth.js"))
        .on_navigation(|url| url.scheme() == "https")
        .on_new_window(move |url, features| {
            let label = format!("oauth-{}", crate::state::now());
            let w = WebviewWindowBuilder::new(&handle, label, WebviewUrl::External(url))
                .window_features(features)
                .build();
            match w {
                Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                Err(_) => tauri::webview::NewWindowResponse::Deny,
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    if visible {
        let _ = w.set_focus();
    }
    Ok(())
}

pub fn under_cursor(app: &AppHandle) -> Value {
    let Some(w) = app.get_webview_window("main") else {
        return selected(app);
    };
    let Ok(p) = w.cursor_position() else {
        return selected(app);
    };
    let window_scale = w.scale_factor().unwrap_or(1.0);
    screens(app)
        .into_iter()
        .find(|d| {
            let k = if cfg!(target_os = "macos") {
                window_scale
            } else {
                num(d, "scaleFactor", 1.0)
            };
            let x = num(d, "x", 0.0) * k;
            let y = num(d, "y", 0.0) * k;
            p.x >= x
                && p.x < x + num(d, "width", 0.0) * k
                && p.y >= y
                && p.y < y + num(d, "height", 0.0) * k
        })
        .unwrap_or_else(|| selected(app))
}
pub fn clear_session(app: &AppHandle, name: &str) -> Result<(), String> {
    let label = format!("auth-{name}");
    if app.get_webview_window(&label).is_none() {
        auth(app, name, false)?;
    }
    app.state::<State>().helper_status.lock().unwrap()[&label] = json!(false);
    if let Some(w) = app.get_webview_window(&label) {
        w.clear_all_browsing_data().map_err(|e| e.to_string())?;
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}
