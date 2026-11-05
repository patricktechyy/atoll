use crate::{
    platform,
    state::{now, text, State},
};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::{borrow::Cow, io::Cursor};
use tauri::{AppHandle, Emitter, Manager};
pub fn list(state: &State) -> Value {
    state.store.lock().unwrap()["clips"].clone()
}
fn excluded() -> bool {
    if cfg!(target_os = "macos") {
        return platform::native(json!({"op":"private-clipboard"}))["private"] == true;
    }
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::System::DataExchange::{
            IsClipboardFormatAvailable, RegisterClipboardFormatW,
        };
        for name in [
            "ExcludeClipboardContentFromMonitorProcessing",
            "Clipboard Viewer Ignore",
        ] {
            let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
            let format = RegisterClipboardFormatW(name.as_ptr());
            if format != 0 && IsClipboardFormatAvailable(format) != 0 {
                return true;
            }
        }
    }
    false
}
pub fn capture(app: &AppHandle, hint: &Value) -> Result<bool, String> {
    let s = app.state::<State>();
    let _lock = s.clip_lock.lock().unwrap();
    if s.settings()["clipboardPaused"] == true {
        return Ok(false);
    }
    if hint["private"] == true || excluded() {
        s.clipboard.lock().unwrap()["skip"] = json!({"reason":"private","at":now()});
        return Ok(false);
    }
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let id = format!("{:x}{:x}", now(), rand::random::<u32>());
    let dir = s.root.join("clipboard");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (mut item, bytes) = if let Ok(image) = cb.get_image() {
        let rgba = image::RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.to_vec(),
        )
        .ok_or("Invalid clipboard image")?;
        let img = image::DynamicImage::ImageRgba8(rgba);
        let mut png = Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        let thumb = img.thumbnail(240, 240).to_rgb8();
        let mut jpg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 72)
            .encode_image(&thumb)
            .map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{id}.png")), png.get_ref()).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{id}.thumb.jpg")), jpg).map_err(|e| e.to_string())?;
        (
            json!({"type":"image","file":format!("{id}.png"),"thumb":format!("atoll://clip/{id}.thumb.jpg"),"w":image.width,"h":image.height}),
            png.into_inner(),
        )
    } else {
        let value = cb
            .get_text()
            .unwrap_or_else(|_| text(hint, "text").to_string());
        if value.trim().is_empty() {
            return Ok(false);
        }
        let value = value.chars().take(20000).collect::<String>();
        (json!({"type":"text","text":value}), value.into_bytes())
    };
    let hash = format!("{:x}", Sha1::digest(bytes));
    let ignored = {
        let mut status = s.clipboard.lock().unwrap();
        let ignored = status["ignoreHash"] == hash;
        status["ignoreHash"] = Value::Null;
        ignored
    };
    if ignored {
        drop_files(&s, &json!({"id":id,"file":item["file"]}));
        return Ok(false);
    }
    let mut items = list(&s).as_array().cloned().unwrap_or_default();
    if items.first().is_some_and(|i| i["hash"] == hash) {
        drop_files(&s, &json!({"id":id,"file":item["file"]}));
        return Ok(false);
    }
    if let Some(index) = items.iter().position(|i| i["hash"] == hash) {
        drop_files(&s, &json!({"id":id,"file":item["file"]}));
        item = items.remove(index);
    } else {
        item["id"] = json!(id);
        item["hash"] = json!(hash);
        item["pinned"] = json!(false);
    }
    item["at"] = json!(now());
    items.insert(0, item);
    let mut unpinned = 0;
    items.retain(|i| {
        if i["pinned"] == true {
            return true;
        }
        unpinned += 1;
        if unpinned > 60 {
            drop_files(&s, i);
            false
        } else {
            true
        }
    });
    s.set("clips", json!(items))?;
    let mut status = s.clipboard.lock().unwrap();
    status["count"] = json!(status["count"].as_u64().unwrap_or(0) + 1);
    status["last"] = json!(now());
    drop(status);
    let _ = app.emit("clips", list(&s));
    Ok(true)
}
pub fn drop_files(state: &State, item: &Value) {
    for name in [
        text(item, "file").to_string(),
        format!("{}.thumb.jpg", text(item, "id")),
    ] {
        if !name.is_empty() && !name.contains(['/', '\\']) {
            let _ = std::fs::remove_file(state.root.join("clipboard").join(name));
        }
    }
}
pub fn use_item(app: &AppHandle, id: &str) -> Result<bool, String> {
    let state = app.state::<State>();
    let _lock = state.clip_lock.lock().unwrap();
    let mut items = list(&state).as_array().cloned().unwrap_or_default();
    let Some(index) = items.iter().position(|i| i["id"] == id) else {
        return Ok(false);
    };
    let item = items.remove(index);
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    if text(&item, "type") == "text" {
        cb.set_text(text(&item, "text"))
            .map_err(|e| e.to_string())?;
    } else {
        let file = text(&item, "file");
        if file.is_empty() || file.contains(['/', '\\']) {
            return Err("Invalid clipboard image path".into());
        }
        let image = image::open(state.root.join("clipboard").join(file))
            .map_err(|e| e.to_string())?
            .to_rgba8();
        cb.set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: Cow::Owned(image.into_raw()),
        })
        .map_err(|e| e.to_string())?;
    }
    state.clipboard.lock().unwrap()["ignoreHash"] = item["hash"].clone();
    items.insert(0, item);
    state.set("clips", json!(items))?;
    let _ = app.emit("clips", list(&state));
    Ok(true)
}
pub fn edit(app: &AppHandle, op: &str, id: &str, on: bool) -> Result<(), String> {
    let state = app.state::<State>();
    let _lock = state.clip_lock.lock().unwrap();
    let mut items = list(&state).as_array().cloned().unwrap_or_default();
    for item in &mut items {
        if item["id"] == id && op == "pin" {
            item["pinned"] = json!(on);
        }
    }
    items.retain(|i| {
        let remove = op == "remove" && i["id"] == id || op == "clear" && i["pinned"] != true;
        if remove {
            drop_files(&state, i);
        }
        !remove
    });
    state.set("clips", json!(items))?;
    let _ = app.emit("clips", list(&state));
    Ok(())
}
pub fn data_uri(image: &image::DynamicImage) -> Result<String, String> {
    use base64::Engine;
    let mut data = Cursor::new(Vec::new());
    image
        .write_to(&mut data, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data.into_inner())
    ))
}

pub fn start_poll(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        use std::sync::atomic::Ordering;
        let mut previous = None;
        while !app.state::<State>().closing.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let state = app.state::<State>();
            if state.settings()["clipboardPaused"] == true
                || cfg!(target_os = "macos") && state.helper_status.lock().unwrap()["alive"] == true
            {
                continue;
            }
            #[cfg(target_os = "windows")]
            let sequence = unsafe {
                windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() as i64
            };
            #[cfg(not(target_os = "windows"))]
            let sequence = platform::native(json!({"op":"private-clipboard"}))["sequence"]
                .as_i64()
                .unwrap_or(0);
            if previous.is_some_and(|v| v != sequence) {
                if let Err(error) = capture(&app, &json!({})) {
                    state.clipboard.lock().unwrap()["error"] = json!(error);
                    let _ = app.emit("clip-status", state.clipboard.lock().unwrap().clone());
                }
            }
            previous = Some(sequence);
        }
    });
}
