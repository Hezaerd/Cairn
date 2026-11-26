use std::{env, fs, path::Path};

use cairn_vault::{NewEntry, Vault};
use zeroize::Zeroizing;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let directory = args.next().ok_or("expected fixture directory")?;
    let origin = args.next().ok_or("expected fixture origin")?;
    let local = fs::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.local"))?;
    let directory = Path::new(&directory);
    let parent = fs::canonicalize(directory.parent().ok_or("expected fixture parent")?)?;
    if !parent.starts_with(local) || directory.exists() {
        return Err("expected a new vault directory inside .local".into());
    }

    let mut vault = Vault::open(directory)?;
    vault.create(Zeroizing::new("synthetic master password".into()))?;
    for (name, site, username) in [
        ("Site de test", origin.as_str(), "synthetic@example.com"),
        ("Autre site", "https://example.com", "other@example.com"),
    ] {
        vault.save(NewEntry {
            name: name.into(),
            site: site.into(),
            username: username.into(),
            password: "synthetic-credential-81!".into(),
            notes: String::new(),
            totp: String::new(),
        })?;
    }
    let entries = vault.list()?;
    let other = entries
        .iter()
        .find(|entry| entry.name == "Autre site")
        .unwrap();
    println!("{}", other.id);
    Ok(())
}
