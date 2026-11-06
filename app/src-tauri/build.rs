fn main() {
    println!("cargo:rerun-if-env-changed=RAPHAEL_UPDATER_PUBLIC_KEY");
    let mut attributes = tauri_build::Attributes::new();
    // Tests that start the app on Tauri's mock runtime link the menu code, which imports
    // `TaskDialogIndirect` from version 6 of the common controls. Windows finds that version only
    // through a manifest, and Tauri gives one to the app alone: without it a test executable
    // cannot even start. Common linker args also reach library unit-test executables.
    // Let the linker embed the shared manifest once, preserving Tauri's icon and version
    // resources without embedding a duplicate manifest through those resources.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("common-controls.manifest");
        println!("cargo:rerun-if-changed=tests/common-controls.manifest");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("failed to build Tauri resources");
}
