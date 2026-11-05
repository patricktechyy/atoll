use crate::{
    platform,
    state::{now, State},
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

pub fn stats(app: &AppHandle) -> Value {
    let state = app.state::<State>();
    // Keep the previous CPU sample. A fresh System on every request reports an invalid baseline.
    let mut sys = state.metrics.lock().unwrap();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let pid = sysinfo::Pid::from_u32(std::process::id());
    let host = sys.process(pid).map(|p| p.memory()).unwrap_or(0);
    let native = state.helper_status.lock().unwrap()["mem"]
        .as_object()
        .map(|m| m.values().filter_map(Value::as_u64).sum::<u64>())
        .unwrap_or(0);
    let helper = state.helper_status.lock().unwrap().clone();
    json!({"cpu":sys.global_cpu_usage().round(),"memUsed":sys.used_memory(),"memTotal":sys.total_memory(),"cores":sys.cpus().len(),"uptime":sysinfo::System::uptime(),"down":helper["rates"]["down"].as_f64().unwrap_or(0.0),"up":helper["rates"]["up"].as_f64().unwrap_or(0.0),"atollMem":host+native,"atollReserved":0,"atollParts":{"Rust host":host,"Native companion":native},"atollReservedParts":{},"memoryScope":"Host and companion only; excludes OS-managed WebView processes","atollProcs":1+state.helpers.lock().unwrap().len(),"gpuOn":state.settings()["gpu"]!=false,"lastTrim":state.last_trim.load(Ordering::Relaxed),"helperKind":helper["kind"]})
}
pub fn trim(app: &AppHandle) {
    let state = app.state::<State>();
    let mut pids = vec![std::process::id()];
    pids.extend(state.helpers.lock().unwrap().values().map(|p| p.id()));
    state.native(json!({"cmd":"trim","pids":pids}));
    let _ = platform::native(json!({"op":"trim"}));
    state.last_trim.store(now(), Ordering::Relaxed);
}
