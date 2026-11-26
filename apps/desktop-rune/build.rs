use std::path::Path;

fn main() -> std::io::Result<()> {
    let out = std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR");
    rune_i18n::codegen::generate(Path::new("src/i18n"), Path::new(&out))
}
