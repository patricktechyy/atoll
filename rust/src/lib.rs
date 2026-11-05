mod clipboard;
mod desktop;
mod helper;
mod metrics;
mod network;
mod platform;
mod rpc;
mod state;
mod updates;
mod windows;
use serde_json::json;
use tauri::{Emitter, Manager};
pub fn run() {
    let builder = tauri::Builder::default();
    let builder = if std::env::var_os("ATOLL_RUST_TEST_DATA").is_none() {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.emit("open-tab", "now");
            }
        }))
    } else {
        builder
    };
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![rpc::rpc, rpc::capture_session])
        .on_menu_event(|app, event| desktop::action_for(app, event.id.as_ref()))
        .register_uri_scheme_protocol("atoll", |context, request| {
            let uri = request.uri().to_string();
            let name = uri.split('/').next_back().unwrap_or("");
            let valid = !name.is_empty()
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
                && (name.ends_with(".png") || name.ends_with(".thumb.jpg"));
            let state = context.app_handle().state::<state::State>();
            let bytes = if valid {
                std::fs::read(state.root.join("clipboard").join(name)).ok()
            } else {
                None
            };
            tauri::http::Response::builder()
                .status(if bytes.is_some() { 200 } else { 404 })
                .header(
                    "Content-Type",
                    if name.ends_with(".png") {
                        "image/png"
                    } else {
                        "image/jpeg"
                    },
                )
                .body(bytes.unwrap_or_default())
                .unwrap()
        })
        .setup(|app| {
            let root = if let Some(path) = std::env::var_os("ATOLL_RUST_TEST_DATA") {
                std::path::PathBuf::from(path)
            } else {
                app.path().data_dir()?.join("Atoll")
            };
            let state = state::State::new(root).map_err(std::io::Error::other)?;
            app.manage(state);
            if std::env::var_os("ATOLL_RUST_TEST_DATA").is_none() {
                use tauri_plugin_autostart::ManagerExt;
                let auto = app.autolaunch();
                if app.state::<state::State>().settings()["startWithWindows"] == true {
                    let _ = auto.enable();
                } else {
                    let _ = auto.disable();
                }
            }
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            windows::create(app.handle(), "main", "index.html", 800.0, 480.0)
                .map_err(std::io::Error::other)?;
            desktop::tray(app.handle()).map_err(std::io::Error::other)?;
            desktop::shortcuts(app.handle());
            desktop::start_poll(app.handle());
            desktop::notification_server(app.handle());
            clipboard::start_poll(app.handle());
            if let Err(error) = helper::start(app.handle()) {
                app.state::<state::State>().helper_status.lock().unwrap()["messages"] =
                    json!([{"where":"start","msg":error}]);
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = network::calendar(&handle, false).await;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                    if handle
                        .state::<state::State>()
                        .closing
                        .load(std::sync::atomic::Ordering::Relaxed)
                    {
                        break;
                    }
                    let _ = network::calendar(&handle, false).await;
                }
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                loop {
                    if handle.state::<state::State>().settings()["autoUpdate"] != false {
                        let _ = updates::check(&handle).await;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(21600)).await;
                }
            });
            if app.state::<state::State>().store.lock().unwrap()["setupSeen"]
                .as_u64()
                .unwrap_or(0)
                < 1
                && std::env::var_os("ATOLL_RUST_TEST_DATA").is_none()
            {
                windows::create(app.handle(), "setup", "setup.html", 640.0, 640.0)
                    .map_err(std::io::Error::other)?;
            }
            Ok(())
        });
    let app = builder
        .build(tauri::generate_context!())
        .expect("Build Atoll Rust host");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if cfg!(target_os = "windows")
                && app.state::<state::State>().update.lock().unwrap()["state"] == "ready"
            {
                let _ = updates::install(app, false);
            }
            app.state::<state::State>().stop();
        }
    });
}
