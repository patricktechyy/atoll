use serde_json::{json, Value};
#[cfg(target_os = "macos")]
extern "C" {
    fn atoll_platform_json(input: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn atoll_free(p: *mut std::ffi::c_char);
    fn atoll_configure_window(p: *mut std::ffi::c_void);
}
pub fn native(value: Value) -> Value {
    #[cfg(target_os = "macos")]
    {
        let input = std::ffi::CString::new(value.to_string()).unwrap();
        unsafe {
            let raw = atoll_platform_json(input.as_ptr());
            if raw.is_null() {
                return Value::Null;
            }
            let value =
                serde_json::from_str(std::ffi::CStr::from_ptr(raw).to_str().unwrap_or("null"))
                    .unwrap_or(Value::Null);
            atoll_free(raw);
            value
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = value;
        Value::Null
    }
}
pub fn configure(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(p) = window.ns_window() {
        unsafe {
            atoll_configure_window(p);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}
pub fn caps() -> Value {
    let mac = cfg!(target_os = "macos");
    json!({"platform":if mac{"darwin"}else{"win32"},"appleCalendar":mac,"icsCalendar":true,"screenPermission":mac,"displaySafeArea":mac,"nativeMediaPlayers":if mac{vec!["Music","Spotify"]}else{vec!["Apple Music","Spotify","any Windows media session"]},"runtime":"rust","graphicsControl":!mac,"updateMechanism":"rust","installsOnQuit":!mac})
}
pub fn position(window: &tauri::WebviewWindow, x: f64, y: f64, w: f64, h: f64, scale: f64) {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn atoll_position_window(p: *mut std::ffi::c_void, x: f64, y: f64, w: f64, h: f64);
        }
        if let Ok(p) = window.ns_window() {
            unsafe {
                atoll_position_window(p, x, y, w, h);
            }
        }
        let _ = scale;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_size(tauri::PhysicalSize::new(
            (w * scale) as u32,
            (h * scale) as u32,
        ));
        let _ = window.set_position(tauri::PhysicalPosition::new(
            (x * scale) as i32,
            (y * scale) as i32,
        ));
    }
}

pub fn battery() -> Value {
    #[cfg(target_os = "macos")]
    {
        native(json!({"op":"battery"}))
    }
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut status: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut status) != 0 {
            return json!({"present":status.BatteryFlag!=128,"charging":status.ACLineStatus!=0,"level":if status.BatteryLifePercent<=100{status.BatteryLifePercent as f64/100.0}else{1.0}});
        }
        json!({"present":false,"charging":true,"level":1.0})
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        json!({"present":false,"charging":true,"level":1.0})
    }
}

pub fn file_icon(path: &str) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(native(json!({"op":"icon","path":path}))["data"].clone())
    }
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::{
            Graphics::Gdi::*,
            UI::{
                Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON},
                WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL},
            },
        };
        let name: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut info: SHFILEINFOW = std::mem::zeroed();
        if SHGetFileInfoW(
            name.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_SMALLICON,
        ) == 0
        {
            return Ok(Value::Null);
        }
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        let mut bitmap: BITMAPINFO = std::mem::zeroed();
        bitmap.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bitmap.bmiHeader.biWidth = 32;
        bitmap.bmiHeader.biHeight = -32;
        bitmap.bmiHeader.biPlanes = 1;
        bitmap.bmiHeader.biBitCount = 32;
        bitmap.bmiHeader.biCompression = BI_RGB;
        let mut pixels = std::ptr::null_mut();
        let handle = CreateDIBSection(
            dc,
            &bitmap,
            DIB_RGB_COLORS,
            &mut pixels,
            std::ptr::null_mut(),
            0,
        );
        if handle.is_null() || dc.is_null() {
            DestroyIcon(info.hIcon);
            if !dc.is_null() {
                DeleteDC(dc);
            }
            return Err("Unable to create file icon".into());
        }
        let old = SelectObject(dc, handle);
        std::ptr::write_bytes(pixels as *mut u8, 0, 4096);
        DrawIconEx(
            dc,
            0,
            0,
            info.hIcon,
            32,
            32,
            0,
            std::ptr::null_mut(),
            DI_NORMAL,
        );
        let mut bytes = std::slice::from_raw_parts(pixels as *const u8, 4096).to_vec();
        for p in bytes.chunks_exact_mut(4) {
            p.swap(0, 2);
        }
        SelectObject(dc, old);
        DeleteObject(handle);
        DeleteDC(dc);
        DestroyIcon(info.hIcon);
        let image = image::RgbaImage::from_raw(32, 32, bytes).ok_or("Invalid file icon")?;
        crate::clipboard::data_uri(&image::DynamicImage::ImageRgba8(image)).map(Value::String)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        Ok(Value::Null)
    }
}
