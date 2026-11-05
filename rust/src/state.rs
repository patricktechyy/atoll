use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    process::{Child, ChildStdin},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter};

pub const VERSION: &str = env!("ATOLL_VERSION");
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
pub fn num(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().filter(|v| v.is_finite()).unwrap_or(default)
}
pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn merge(base: &mut Value, extra: Value) {
    if let (Some(a), Some(b)) = (base.as_object_mut(), extra.as_object()) {
        for (k, v) in b {
            if a.get(k).is_some_and(|x| x.is_object()) && v.is_object() {
                merge(a.get_mut(k).unwrap(), v.clone());
            } else {
                a.insert(k.clone(), v.clone());
            }
        }
    }
}
pub struct State {
    pub root: PathBuf,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub web_args: String,
    pub store: Mutex<Value>,
    pub save_lock: Mutex<()>,
    pub metrics: Mutex<sysinfo::System>,
    pub last_trim: std::sync::atomic::AtomicI64,
    pub media: Mutex<Value>,
    pub system: Mutex<Value>,
    pub calendar: Mutex<Value>,
    pub update: Mutex<Value>,
    pub clipboard: Mutex<Value>,
    pub clip_lock: Mutex<()>,
    pub held_at: std::sync::atomic::AtomicI64,
    pub hit: Mutex<Value>,
    pub grab: Mutex<Value>,
    pub dragging: AtomicBool,
    pub held: AtomicBool,
    pub hidden: AtomicBool,
    pub helpers: Mutex<HashMap<String, Child>>,
    pub inputs: Mutex<HashMap<String, ChildStdin>>,
    pub helper_status: Mutex<Value>,
    pub captures: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>,
    pub secrets: Mutex<HashMap<String, Value>>,
    pub client: reqwest::Client,
    pub closing: AtomicBool,
    pub shot: Mutex<Value>,
    pub shortcuts: Mutex<Value>,
}
impl State {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let file = root.join("atoll.json");
        let mut data: Value =
            serde_json::from_str(include_str!("../../.cache/rust-ui/defaults.json")).unwrap();
        if file.exists() {
            let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
            let existing: Value = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Existing settings are invalid; left untouched: {e}"))?;
            if !existing.is_object() || !existing.get("settings").is_none_or(Value::is_object) {
                return Err("Existing settings have an invalid shape; left untouched".into());
            }
            if !root.join("atoll.pre-rust.json").exists() {
                std::fs::write(root.join("atoll.pre-rust.json"), &bytes)
                    .map_err(|e| e.to_string())?;
            }
            merge(&mut data, existing);
        }
        if data["settings"]["hideInFullscreen"] == false {
            data["settings"]["fullscreenMode"] = json!("show");
        }
        data["settings"]
            .as_object_mut()
            .unwrap()
            .remove("hideInFullscreen");
        if file.exists() && data["settings"]["designV2"] != true {
            data["settings"]["mascot"] = json!(false);
        }
        if data["settings"]["shortcuts"]["layout"] == "Control+Shift+P" {
            data["settings"]["shortcuts"]["layout"] = json!("Control+Alt+P");
        }
        let position = data["settings"]["position"].clone();
        let preset = if position["mode"] == "side" {
            text(&position, "side")
        } else {
            "top"
        };
        if matches!(preset, "top" | "left" | "right") {
            data["settings"]["positionPresets"][preset] = position.clone();
        }
        if !file.exists() {
            data["firstVersion"] = json!(VERSION);
        }
        if text(&data["settings"], "notifyToken").is_empty() {
            data["settings"]["notifyToken"] = json!(format!("{:032x}", rand::random::<u128>()));
        }
        let mut web_args =
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string();
        if data["settings"]["gpu"] == false {
            web_args.push_str(" --disable-gpu");
        }
        if data["settings"]["lite"] != false {
            web_args.push_str(" --js-flags=\"--max-old-space-size=64 --max-semi-space-size=2\"");
        }
        Ok(Self {
            root,
            web_args,
            store: Mutex::new(data),
            save_lock: Mutex::new(()),
            metrics: Mutex::new(sysinfo::System::new()),
            last_trim: std::sync::atomic::AtomicI64::new(0),
            media: Mutex::new(json!({"active":false})),
            system: Mutex::new(json!({})),
            calendar: Mutex::new(json!({"events":[],"error":null})),
            update: Mutex::new(
                json!({"state":"idle","current":VERSION,"version":null,"progress":0,"canInstall":true,"releasesPage":"https://github.com/patricktechyy/atoll/releases","mechanism":"rust"}),
            ),
            clipboard: Mutex::new(
                json!({"count":0,"last":0,"via":"native","helperSeen":false,"error":""}),
            ),
            clip_lock: Mutex::new(()),
            held_at: std::sync::atomic::AtomicI64::new(0),
            hit: Mutex::new(json!({"x":302,"y":0,"w":196,"h":32})),
            grab: Mutex::new(json!({})),
            dragging: AtomicBool::new(false),
            held: AtomicBool::new(false),
            hidden: AtomicBool::new(false),
            helpers: Mutex::new(HashMap::new()),
            inputs: Mutex::new(HashMap::new()),
            helper_status: Mutex::new(
                json!({"alive":false,"kind":"native","messages":[],"mem":{}}),
            ),
            captures: Mutex::new(HashMap::new()),
            secrets: Mutex::new(HashMap::new()),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .user_agent(format!("Atoll/{VERSION}"))
                .build()
                .map_err(|e| e.to_string())?,
            closing: AtomicBool::new(false),
            shot: Mutex::new(Value::Null),
            shortcuts: Mutex::new(json!({})),
        })
    }
    pub fn settings(&self) -> Value {
        self.store.lock().unwrap()["settings"].clone()
    }
    pub fn save(&self) -> Result<(), String> {
        let _lock = self.save_lock.lock().unwrap();
        let value = self.store.lock().unwrap().clone();
        let tmp = self.root.join("atoll.json.rust-tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&value).unwrap())
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let from: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = self
                .root
                .join("atoll.json")
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } != 0
            {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error().to_string())
            }
        }
        #[cfg(not(target_os = "windows"))]
        std::fs::rename(tmp, self.root.join("atoll.json")).map_err(|e| e.to_string())
    }
    pub fn set(&self, key: &str, value: Value) -> Result<(), String> {
        self.store.lock().unwrap()[key] = value;
        self.save()
    }
    pub fn public(&self) -> Value {
        let mut value = self.store.lock().unwrap().clone();
        for key in ["clips", "appleTokens", "rustSecrets"] {
            value.as_object_mut().unwrap().remove(key);
        }
        value["todolist"] = self.todo_info();
        value
    }
    pub fn todo_info(&self) -> Value {
        let conf = self.store.lock().unwrap()["todolist"].clone();
        let url = text(&conf, "url");
        let prefix = text(&conf, "prefix");
        json!({"url":url,"user":conf["user"],"name":conf["name"],"connected":!url.is_empty()&&self.secret("todo").is_some(),"kind":if prefix=="/todo"{"whatsup"}else{"standalone"},"webUrl":format!("{url}{prefix}/")})
    }
    pub fn broadcast(&self, app: &AppHandle) {
        let _ = app.emit("store", self.public());
    }
    pub fn native(&self, value: Value) {
        let media = self.helper_status.lock().unwrap()["kind"] == "native-core+powershell"
            && matches!(text(&value, "cmd"), "toggle" | "next" | "prev" | "seek");
        if let Some(input) =
            self.inputs
                .lock()
                .unwrap()
                .get_mut(if media { "media" } else { "main" })
        {
            let _ = writeln!(input, "{value}");
            let _ = input.flush();
        }
    }
    pub fn secret(&self, name: &str) -> Option<Value> {
        if let Some(v) = self.secrets.lock().unwrap().get(name).cloned() {
            return Some(v);
        }
        if std::env::var_os("ATOLL_RUST_TEST_DATA").is_some() {
            return None;
        }
        let raw = keyring::Entry::new("app.atoll.notch.rust", name)
            .ok()?
            .get_password()
            .ok()?;
        let value = serde_json::from_str(&raw).ok()?;
        self.secrets.lock().unwrap().insert(name.into(), value);
        self.secrets.lock().unwrap().get(name).cloned()
    }
    pub fn set_secret(&self, name: &str, value: Option<Value>) -> Result<(), String> {
        if std::env::var_os("ATOLL_RUST_TEST_DATA").is_none() {
            let entry =
                keyring::Entry::new("app.atoll.notch.rust", name).map_err(|e| e.to_string())?;
            if let Some(v) = &value {
                entry
                    .set_password(&v.to_string())
                    .map_err(|e| e.to_string())?;
            } else {
                match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => (),
                    Err(error) => return Err(error.to_string()),
                }
            }
        }
        let mut secrets = self.secrets.lock().unwrap();
        if let Some(v) = value {
            secrets.insert(name.into(), v);
        } else {
            secrets.remove(name);
        }
        Ok(())
    }
    pub fn zoom(&self) -> f64 {
        match text(&self.settings(), "size") {
            "s" => 0.85,
            "l" => 1.2,
            _ => 1.0,
        }
    }
    pub fn stop(&self) {
        self.closing.store(true, Ordering::Relaxed);
        self.inputs.lock().unwrap().clear();
        for (_, mut child) in self.helpers.lock().unwrap().drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = self.save();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn merging_preserves_unknown_settings() {
        let mut value = json!({"settings":{"size":"m","extra":4}});
        merge(&mut value, json!({"settings":{"size":"l"}}));
        assert_eq!(value["settings"]["extra"], 4);
        assert_eq!(value["settings"]["size"], "l");
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!("atoll-store-test-{:x}", rand::random::<u128>()))
    }
    #[test]
    fn migrates_without_losing_legacy_data_and_keeps_original_backup() {
        let root = temp();
        std::fs::create_dir_all(&root).unwrap();
        let original = json!({"settings":{"size":"l","futureSetting":42},"todos":[{"id":"t1","text":"Keep me"}],"clips":[{"id":"c1","text":"private"}],"appleTokens":{"user":"private"},"futureData":[1,2,3]});
        let bytes = original.to_string();
        std::fs::write(root.join("atoll.json"), &bytes).unwrap();
        let s = State::new(root.clone()).unwrap();
        assert_eq!(s.settings()["size"], "l");
        assert_eq!(s.settings()["futureSetting"], 42);
        let public = s.public();
        assert!(public.get("clips").is_none());
        assert!(public.get("appleTokens").is_none());
        assert_eq!(public["todos"][0]["text"], "Keep me");
        s.set("focus", json!({"minutes":25})).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("atoll.pre-rust.json")).unwrap(),
            bytes
        );
        let s = State::new(root.clone()).unwrap();
        assert_eq!(s.public()["futureData"], json!([1, 2, 3]));
        assert_eq!(
            std::fs::read_to_string(root.join("atoll.pre-rust.json")).unwrap(),
            bytes
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_legacy_file_is_never_overwritten() {
        let root = temp();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("atoll.json"), "broken json").unwrap();
        assert!(State::new(root.clone()).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("atoll.json")).unwrap(),
            "broken json"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn serialized_concurrent_saves_leave_valid_json() {
        let root = temp();
        let s = std::sync::Arc::new(State::new(root.clone()).unwrap());
        std::thread::scope(|scope| {
            for i in 0..8 {
                let s = s.clone();
                scope.spawn(move || s.set(&format!("test{i}"), json!(i)).unwrap());
            }
        });
        let data: Value =
            serde_json::from_slice(&std::fs::read(root.join("atoll.json")).unwrap()).unwrap();
        for i in 0..8 {
            assert_eq!(data[format!("test{i}")], i);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
