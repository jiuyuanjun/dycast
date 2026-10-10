const _: &str = include_str!("tauri.conf.json");

fn main() {
    tauri_build::build()
}
