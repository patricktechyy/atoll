fn main() {
    println!("cargo:rerun-if-changed=../app/package.json");
    println!("cargo:rerun-if-changed=../native/mac/rust-platform.m");
    let pkg: serde_json::Value =
        serde_json::from_slice(&std::fs::read("../app/package.json").unwrap()).unwrap();
    println!(
        "cargo:rustc-env=ATOLL_VERSION={}",
        pkg["version"].as_str().unwrap()
    );
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
        cc::Build::new()
            .file("../native/mac/rust-platform.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=13.0")
            .compile("atoll_platform");
        for f in [
            "AppKit",
            "EventKit",
            "CoreGraphics",
            "ApplicationServices",
            "Security",
            "WebKit",
            "IOKit",
        ] {
            println!("cargo:rustc-link-lib=framework={f}");
        }
    }
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["rpc", "capture_session"])),
    )
    .unwrap();
}
