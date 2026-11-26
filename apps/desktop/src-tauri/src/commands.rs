use cairn_app::{
    App, PairingRequest, authenticator,
    connector::{self, ExtensionFolder},
    locale::{Language, LanguageError, Locale},
    startup::{self, StartupStatus},
};
use cairn_vault::{
    BrowserSummary, EntrySecret, EntrySummary, EntryUpdate, FaviconLookup, NewEntry, OtpPreview,
    PasswordOptions, TotpCode, VaultError, VaultStatus,
};
use tauri::{AppHandle, Manager, State, WebviewWindow, ipc::InvokeBody};
use zeroize::Zeroizing;

fn main_window<E>(window: &WebviewWindow, refused: E) -> Result<(), E> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(refused)
    }
}

#[tauri::command]
pub async fn vault_status(
    window: WebviewWindow,
    app: State<'_, App>,
) -> Result<VaultStatus, VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.vault_status().await
}

#[tauri::command]
pub async fn create_vault(
    window: WebviewWindow,
    app: State<'_, App>,
    password: String,
) -> Result<(), VaultError> {
    let password = Zeroizing::new(password);
    main_window(&window, VaultError::Locked)?;
    app.create_vault(password).await
}

#[tauri::command]
pub async fn unlock_vault(
    window: WebviewWindow,
    app: State<'_, App>,
    password: String,
) -> Result<(), VaultError> {
    let password = Zeroizing::new(password);
    main_window(&window, VaultError::Locked)?;
    app.unlock_vault(password).await
}

#[tauri::command]
pub async fn lock_vault(window: WebviewWindow, app: State<'_, App>) -> Result<(), VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.lock_vault().await
}

#[tauri::command]
pub async fn list_entries(
    window: WebviewWindow,
    app: State<'_, App>,
) -> Result<Vec<EntrySummary>, VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.list_entries().await
}

#[tauri::command]
pub async fn save_entry(
    window: WebviewWindow,
    app: State<'_, App>,
    entry: NewEntry,
) -> Result<(), VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.save_entry(entry).await
}

#[tauri::command]
pub async fn update_entry(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
    entry: EntryUpdate,
) -> Result<(), VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.update_entry(id, entry).await
}

#[tauri::command]
pub async fn delete_entry(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
) -> Result<(), VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.delete_entry(id).await
}

#[tauri::command]
pub async fn reveal_password(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
) -> Result<EntrySecret, VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.reveal_password(id).await
}

#[tauri::command]
pub fn generate_password(
    window: WebviewWindow,
    options: PasswordOptions,
) -> Result<String, VaultError> {
    main_window(&window, VaultError::Locked)?;
    cairn_vault::generate_password(&options).map(|password| String::clone(&password))
}

#[tauri::command]
pub async fn totp_code(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
) -> Result<TotpCode, VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.totp_code(id).await
}

#[tauri::command]
pub fn read_otp(window: WebviewWindow, text: String) -> Result<Vec<OtpPreview>, VaultError> {
    main_window(&window, VaultError::Locked)?;
    authenticator::read_otp(text)
}

#[tauri::command]
pub async fn import_otp(
    window: WebviewWindow,
    app: State<'_, App>,
    text: String,
    targets: Vec<Option<String>>,
) -> Result<(), VaultError> {
    let text = Zeroizing::new(text);
    main_window(&window, VaultError::Locked)?;
    app.import_otp(text, targets).await
}

#[tauri::command]
pub async fn scan_qr(
    window: WebviewWindow,
    app: State<'_, App>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, VaultError> {
    main_window(&window, VaultError::Locked)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(VaultError::InvalidInput);
    };
    app.scan_qr(bytes).await
}

#[tauri::command]
pub fn pairing_request(app: State<'_, App>) -> Option<PairingRequest> {
    app.pairing_request()
}

#[tauri::command]
pub async fn answer_pairing(
    window: WebviewWindow,
    app: State<'_, App>,
    code: String,
    accept: bool,
) -> Result<(), VaultError> {
    let access = main_window(&window, VaultError::Locked);
    app.answer_pairing(code, accept && access.is_ok()).await?;
    if accept { access } else { Ok(()) }
}

#[tauri::command]
pub async fn list_browsers(
    window: WebviewWindow,
    app: State<'_, App>,
) -> Result<Vec<BrowserSummary>, VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.list_browsers().await
}

#[tauri::command]
pub async fn rename_browser(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
    label: String,
) -> Result<(), VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.rename_browser(id, label).await
}

#[tauri::command]
pub async fn remove_browser(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
) -> Result<(), VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.remove_browser(id).await
}

#[tauri::command]
pub async fn favicon_cached(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
) -> Result<Option<FaviconLookup>, VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.favicon_cached(id).await
}

#[tauri::command]
pub async fn favicon_refresh(
    window: WebviewWindow,
    app: State<'_, App>,
    id: String,
    session: String,
) -> Result<Option<String>, VaultError> {
    main_window(&window, VaultError::Locked)?;
    app.favicon_refresh(id, session).await
}

#[tauri::command]
pub fn locale(app: State<'_, App>) -> Language {
    app.language()
}

#[tauri::command]
pub fn set_language(
    handle: AppHandle,
    app: State<'_, App>,
    chosen: Option<Locale>,
) -> Result<Language, LanguageError> {
    let language = app.set_language(chosen)?;
    crate::tray::translate(&handle, language.locale);
    Ok(language)
}

#[tauri::command]
pub fn connector_extension_folder(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ExtensionFolder, String> {
    main_window(&window, "connector refused".to_owned())?;
    Ok(connector::extension_folder(
        app.path().resource_dir().ok().as_deref(),
    ))
}

#[tauri::command]
pub fn connector_open_extension_folder(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    main_window(&window, "connector refused".to_owned())?;
    connector::open_extension_folder(app.path().resource_dir().ok().as_deref())
}

#[tauri::command]
pub fn startup_status(window: WebviewWindow) -> Result<StartupStatus, String> {
    main_window(&window, "startup refused".to_owned())?;
    Ok(startup::startup_status())
}

#[tauri::command]
pub fn startup_set(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    main_window(&window, "startup refused".to_owned())?;
    startup::startup_set(enabled)
}
