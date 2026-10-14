//! Authenticator codes: the current code of an entry, and adding keys from
//! `otpauth://` links, Google Authenticator exports, or a picture of their
//! QR codes. Keys stay in Rust; the window gets codes and account names.
use crate::vault::{Store, run};
use cairn_vault::{OtpPreview, TotpCode, Vault, VaultError, parse_accounts};
use tauri::{State, WebviewWindow, ipc::InvokeBody};
use zeroize::{Zeroize, Zeroizing};

const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_IMAGE_SIDE: u32 = 8192;

/// Reading a code doesn't count as activity, so a selected entry can't keep
/// the vault open.
#[tauri::command]
pub async fn totp_code(
    window: WebviewWindow,
    store: State<'_, Store>,
    id: String,
) -> Result<TotpCode, VaultError> {
    run(window, &store, move |vault| vault.totp_code(&id)).await
}

/// The accounts in `text`, without their keys, so you can choose where each goes.
#[tauri::command]
pub fn read_otp(window: WebviewWindow, text: String) -> Result<Vec<OtpPreview>, VaultError> {
    if window.label() != "main" {
        return Err(VaultError::Locked);
    }
    let text = Zeroizing::new(text);
    Ok(parse_accounts(&text)?
        .iter()
        .map(|account| account.preview())
        .collect())
}

/// Adds the accounts in `text`: `targets[i]` names the entry that gets the
/// i-th account's key, or is `None` for a new entry.
#[tauri::command]
pub async fn import_otp(
    window: WebviewWindow,
    store: State<'_, Store>,
    text: String,
    targets: Vec<Option<String>>,
) -> Result<(), VaultError> {
    let text = Zeroizing::new(text);
    run(window, &store, move |vault: &mut Vault| {
        let accounts = parse_accounts(&text)?;
        if accounts.len() != targets.len() {
            return Err(VaultError::InvalidInput);
        }
        let result = vault.import_totp(accounts.into_iter().zip(targets).collect());
        // As for other changes, a failure other than invalid input reloads from disk.
        if result.is_err_and(|error| error != VaultError::InvalidInput) {
            vault.lock();
        }
        result
    })
    .await
}

/// Reads the authenticator links in the QR codes of a picture, such as a
/// screenshot of a site's setup page or of Google Authenticator's export.
/// The window sends the image as the raw request body.
#[tauri::command]
pub async fn scan_qr(
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<String, VaultError> {
    if window.label() != "main" {
        return Err(VaultError::Locked);
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(VaultError::InvalidInput);
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(VaultError::InvalidInput);
    }
    let bytes = Zeroizing::new(bytes.clone());
    tauri::async_runtime::spawn_blocking(move || scan(&bytes))
        .await
        .map_err(|_| VaultError::Storage)?
}

fn scan(bytes: &[u8]) -> Result<String, VaultError> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| VaultError::InvalidInput)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| VaultError::InvalidInput)?;
    let mut luma = image.to_luma8();
    drop(image);
    let (width, height) = (luma.width() as usize, luma.height() as usize);
    let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(width, height, |x, y| {
        luma[(x as u32, y as u32)].0[0]
    });
    luma.zeroize();
    let mut links = vec![];
    for grid in prepared.detect_grids() {
        if let Ok((_, content)) = grid.decode() {
            let content = Zeroizing::new(content);
            if content.trim().to_ascii_lowercase().starts_with("otpauth") {
                links.push(content.trim().to_owned());
            }
        }
    }
    if links.is_empty() {
        return Err(VaultError::InvalidInput);
    }
    Ok(links.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PNG of `text` as a QR code, four pixels per module, with a quiet zone.
    fn qr_png(text: &str) -> Vec<u8> {
        let code = qrcode::QrCode::new(text).unwrap();
        let (modules, colors) = (code.width() as u32, code.to_colors());
        let side = (modules + 8) * 4;
        let picture = image::GrayImage::from_fn(side, side, |x, y| {
            let (column, row) = ((x / 4).wrapping_sub(4), (y / 4).wrapping_sub(4));
            let dark = column < modules
                && row < modules
                && colors[(row * modules + column) as usize] == qrcode::Color::Dark;
            image::Luma([if dark { 0 } else { 255 }])
        });
        let mut png = vec![];
        picture
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        png
    }

    #[test]
    fn pictures_of_authenticator_codes_give_their_links() {
        let link = "otpauth://totp/Example:me?secret=GEZDGNBVGY3TQOJQ&issuer=Example";
        assert_eq!(scan(&qr_png(link)).unwrap(), link);
        assert_eq!(
            scan(&qr_png("https://example.com")),
            Err(VaultError::InvalidInput)
        );
    }

    #[test]
    fn pictures_without_an_authenticator_code_are_refused() {
        assert_eq!(scan(b"not an image"), Err(VaultError::InvalidInput));
        let mut png = vec![];
        image::DynamicImage::new_luma8(64, 64)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        assert_eq!(scan(&png), Err(VaultError::InvalidInput));
    }
}
