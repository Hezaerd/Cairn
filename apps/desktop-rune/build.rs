use std::path::Path;

fn main() -> std::io::Result<()> {
    println!("cargo:rerun-if-env-changed=CAIRN_BUILD_VERSION");
    let version =
        std::env::var("CAIRN_BUILD_VERSION").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").into());
    println!("cargo:rustc-env=CAIRN_VERSION={version}");
    let out = std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR");
    rune_i18n::codegen::generate(Path::new("src/i18n"), Path::new(&out))
}
