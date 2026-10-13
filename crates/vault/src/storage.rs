use super::{MAX_FILE_BYTES, Result, VaultError};
use atomic_write_file::AtomicWriteFile;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

pub(super) fn lock(directory: &Path) -> Result<File> {
    fs::create_dir_all(directory.join("backups")).map_err(|_| VaultError::Storage)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("vault.lock"))
        .map_err(|_| VaultError::Storage)?;
    file.try_lock().map_err(|_| VaultError::InUse)?;
    Ok(file)
}

pub(super) fn read(path: &Path) -> Result<Vec<u8>> {
    let file = File::open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            VaultError::Missing
        } else {
            VaultError::Storage
        }
    })?;
    let mut bytes = Vec::new();
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| VaultError::Storage)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(VaultError::InvalidVault);
    }
    Ok(bytes)
}

pub(super) fn replace(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = AtomicWriteFile::open(path).map_err(|_| VaultError::Storage)?;
    file.write_all(bytes).map_err(|_| VaultError::Storage)?;
    file.commit().map_err(|_| VaultError::Storage)
}

pub(super) fn create(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or(VaultError::Storage)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| VaultError::Storage)?;
    file.write_all(bytes).map_err(|_| VaultError::Storage)?;
    file.as_file().sync_all().map_err(|_| VaultError::Storage)?;
    file.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            VaultError::AlreadyExists
        } else {
            VaultError::Storage
        }
    })?;
    Ok(())
}
