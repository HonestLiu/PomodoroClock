fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        for file in ["../macos/Widgets/WidgetData.swift", "../macos/Bridge/WidgetBridge.swift", "../scripts/build-widget-bridge.sh"] {
            println!("cargo:rerun-if-changed={file}");
        }
        let out = std::env::var("OUT_DIR").unwrap();
        let target = std::env::var("TARGET").unwrap();
        let status = std::process::Command::new("bash")
            .args(["../scripts/build-widget-bridge.sh", &out, &target]).status().expect("Swift toolchain required for WidgetKit bridge");
        assert!(status.success(), "WidgetKit bridge compilation failed");
        println!("cargo:rustc-link-search=native={out}");
        println!("cargo:rustc-link-lib=static=focus_widget_bridge");
        println!("cargo:rustc-link-search=native=/usr/lib/swift");
        let info = std::process::Command::new("xcrun").args(["swiftc", "-print-target-info"]).output().unwrap();
        let info: serde_json::Value = serde_json::from_slice(&info.stdout).unwrap();
        for path in info["paths"]["runtimeLibraryPaths"].as_array().unwrap() {
            println!("cargo:rustc-link-search=native={}", path.as_str().unwrap());
        }
        println!("cargo:rustc-link-lib=framework=WidgetKit");
        println!("cargo:rustc-link-lib=framework=SwiftUI");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    // 托盘图片由宏解码进二进制，修改图片后也必须重新编译。
    println!("cargo:rerun-if-changed=icons/tray-focus.png");
    println!("cargo:rerun-if-changed=icons/tray-break.png");
    tauri_build::build()
}
