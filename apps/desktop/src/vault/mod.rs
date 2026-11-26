mod dialogs;
mod workspace;

use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use cairn_app::App;
use cairn_vault::{EntrySecret, EntrySummary, VaultError};
use rune::{El, TextEdit, Tx};
use rune_kit::Kit;
use tokio::{runtime::Handle, sync::oneshot};
use zeroize::Zeroizing;

use crate::{generator::Preferences, i18n::t, site_icon::SiteIcons};

const SECRET_LIFETIME: Duration = Duration::from_secs(30);
const JOB_POLL: Duration = Duration::from_millis(16);

pub use workspace::add_button;

pub struct Vault {
    pub preferences: Preferences,
    selection_path: PathBuf,
    discarded_input: TextEdit,
    session: Session,
}

#[derive(Default)]
struct Session {
    search: TextEdit,
    entries: Vec<Login>,
    code_count: usize,
    matches: Vec<usize>,
    selected: Option<String>,
    revealed: Option<Reveal>,
    dialog: Option<dialogs::Active>,
    error: Option<&'static str>,
    notice: Option<(&'static str, f64)>,
    icons: SiteIcons,
    pending: Option<Pending>,
    refresh: bool,
    clock: f64,
}

struct Login {
    entry: EntrySummary,
    terms: [String; 3],
}

impl From<EntrySummary> for Login {
    fn from(entry: EntrySummary) -> Self {
        let terms = [&entry.name, &entry.username, &entry.site].map(|term| term.to_lowercase());
        Self { entry, terms }
    }
}

struct Reveal {
    id: String,
    secret: EntrySecret,
    until: f64,
}

struct Pending {
    work: Work,
    result: oneshot::Receiver<Result<Outcome, VaultError>>,
}

enum Work {
    Refresh,
    Save,
    Reveal,
    Copy,
}

enum Outcome {
    Entries(Vec<EntrySummary>),
    Secret(String, EntrySecret),
    Copied(Zeroizing<String>),
}

impl Session {
    fn filter(&mut self) {
        let query = self.search.text.to_lowercase();
        self.matches.clear();
        self.matches.extend(
            self.entries
                .iter()
                .enumerate()
                .filter(|(_, login)| login.terms.iter().any(|term| term.contains(&query)))
                .map(|(index, _)| index),
        );
    }

    fn replace(&mut self, entries: Vec<EntrySummary>) {
        if !self.refresh {
            self.icons.retain(&entries);
        }
        self.code_count = entries.iter().filter(|entry| entry.has_totp).count();
        self.entries = entries
            .into_iter()
            .filter(|entry| entry.has_password)
            .map(Login::from)
            .collect();
        self.entries.sort_by(|a, b| a.terms.cmp(&b.terms));
        self.filter();
        if self.revealed.as_ref().map(|reveal| reveal.id.as_str())
            != self.selected().map(|entry| entry.id.as_str())
        {
            self.revealed = None;
        }
    }

    fn entry(&self, index: usize) -> &EntrySummary {
        &self.entries[self.matches[index]].entry
    }

    fn selected(&self) -> Option<&EntrySummary> {
        self.selected
            .as_ref()
            .and_then(|selected| {
                self.matches
                    .iter()
                    .map(|&index| &self.entries[index].entry)
                    .find(|entry| &entry.id == selected)
            })
            .or_else(|| self.matches.first().map(|_| self.entry(0)))
    }

    fn clear_reveal(&mut self) {
        self.revealed = None;
        if self
            .pending
            .as_ref()
            .is_some_and(|job| matches!(job.work, Work::Reveal))
        {
            self.pending = None;
        }
    }

    fn toggle_reveal(&mut self) -> bool {
        if self.revealed.is_some()
            || self
                .pending
                .as_ref()
                .is_some_and(|job| matches!(job.work, Work::Reveal))
        {
            self.clear_reveal();
            false
        } else {
            true
        }
    }

    fn expire(&mut self) -> bool {
        let mut changed = false;
        if self
            .revealed
            .as_ref()
            .is_some_and(|reveal| self.clock >= reveal.until)
        {
            self.revealed = None;
            changed = true;
        }
        if self.notice.is_some_and(|(_, until)| self.clock >= until) {
            self.notice = None;
            changed = true;
        }
        changed
    }
}

impl Vault {
    pub fn new(directory: &Path) -> Self {
        let selection_path = directory.join("selected-login");
        let selected = fs::read_to_string(&selection_path).ok();
        Self {
            preferences: Preferences::load(directory),
            selection_path,
            discarded_input: TextEdit::new("").secure(),
            session: Session {
                selected,
                ..Session::default()
            },
        }
    }

    pub fn clear(&mut self) {
        self.discarded_input.clear();
        let selected = self.session.selected.take();
        self.session = Session {
            selected,
            ..Session::default()
        };
    }

    fn select_login(&mut self, id: &str) {
        self.session.clear_reveal();
        if self.session.selected.as_deref() != Some(id) {
            self.session.selected = Some(id.to_owned());
            let _ = fs::write(&self.selection_path, id);
        }
    }

    pub fn counts(&self) -> (usize, usize) {
        (self.session.entries.len(), self.session.code_count)
    }

    pub fn clear_reveal(&mut self) {
        self.session.clear_reveal();
    }

    pub fn icons(&self) -> &SiteIcons {
        &self.session.icons
    }

    pub fn refresh(&mut self) {
        self.session.refresh = true;
    }

    fn start(
        &mut self,
        runtime: &Handle,
        tx: &mut Tx,
        work: Work,
        operation: impl Future<Output = Result<Outcome, VaultError>> + Send + 'static,
    ) {
        let (sender, result) = oneshot::channel();
        runtime.spawn(async move {
            let _ = sender.send(operation.await);
        });
        self.session.error = None;
        self.session.pending = Some(Pending { work, result });
        tx.wake_after(JOB_POLL);
    }

    pub fn poll(
        &mut self,
        core: &App,
        runtime: &Handle,
        clock: f64,
        tx: &mut Tx,
    ) -> Result<bool, VaultError> {
        let session = &mut self.session;
        session.clock = clock;
        let mut changed = session.expire() | session.icons.poll();
        if let Some(pending) = &mut session.pending {
            use oneshot::error::TryRecvError;
            match pending.result.try_recv() {
                Err(TryRecvError::Empty) => tx.wake_after(JOB_POLL),
                result => {
                    let work = session.pending.take().unwrap().work;
                    match result.unwrap_or(Err(VaultError::Storage)) {
                        Ok(Outcome::Entries(entries)) => {
                            session.replace(entries);
                            if matches!(work, Work::Save) {
                                session.dialog = None;
                            }
                        }
                        Ok(Outcome::Secret(id, secret)) => {
                            if session.selected().is_some_and(|entry| entry.id == id) {
                                session.revealed = Some(Reveal {
                                    id,
                                    secret,
                                    until: session.clock + SECRET_LIFETIME.as_secs_f64(),
                                });
                                tx.wake_after(SECRET_LIFETIME);
                            }
                        }
                        Ok(Outcome::Copied(mut password)) => {
                            tx.copy_secret(std::mem::take(&mut *password), SECRET_LIFETIME);
                            session.notice =
                                Some((t!("credentials.passwordCopied"), session.clock + 3.0));
                        }
                        Err(VaultError::InvalidInput) if matches!(work, Work::Save) => {
                            session.error = Some(t!("entry.invalid"));
                        }
                        Err(error)
                            if matches!(work, Work::Save)
                                || matches!(error, VaultError::Locked | VaultError::Storage) =>
                        {
                            return Err(error);
                        }
                        Err(error) => session.error = Some(crate::i18n::vault_error(error)),
                    }
                    changed = true;
                }
            }
        }
        if session.refresh && session.pending.is_none() {
            session.refresh = false;
            let core = core.clone();
            self.start(runtime, tx, Work::Refresh, async move {
                core.list_entries().await.map(Outcome::Entries)
            });
            changed = true;
        }
        Ok(changed)
    }
}

pub fn view(state: &crate::app::State, kit: &Kit, compact: bool) -> El {
    workspace::view(state, kit, compact)
}

impl Vault {
    pub fn load_icon(&mut self, core: App, id: String, site: String, runtime: &Handle) {
        self.session.icons.load(core, runtime, id, site);
    }

    fn editor_mut(&mut self) -> Option<&mut dialogs::Editor> {
        match &mut self.session.dialog {
            Some(dialogs::Active::Editor(editor)) => Some(editor),
            _ => None,
        }
    }

    fn edit_field(
        &mut self,
        edit: impl FnOnce(&mut dialogs::Editor) -> Option<&mut TextEdit>,
    ) -> &mut TextEdit {
        if let Some(dialogs::Active::Editor(editor)) = &mut self.session.dialog
            && let Some(field) = edit(editor)
        {
            return field;
        }
        self.discarded_input.clear();
        &mut self.discarded_input
    }

    fn open_editor(&mut self, editing: bool, tx: &mut Tx) {
        let session = &mut self.session;
        let reveal = session.revealed.take();
        let entry = if editing {
            let Some(entry) = session.selected() else {
                return;
            };
            Some(entry)
        } else {
            None
        };
        let notes = reveal.filter(|reveal| entry.is_some_and(|entry| entry.id == reveal.id));
        let editor = dialogs::Editor::new(entry, notes.map(|reveal| reveal.secret));
        session.clear_reveal();
        session.error = None;
        session.dialog = Some(dialogs::Active::Editor(Box::new(editor)));
        tx.focus("entry-name", false);
    }

    fn open_delete(&mut self, tx: &mut Tx) {
        let session = &mut self.session;
        let Some(entry) = session.selected() else {
            return;
        };
        let dialog = dialogs::Active::Delete {
            id: entry.id.clone(),
            name: entry.name.clone(),
        };
        session.clear_reveal();
        session.error = None;
        session.dialog = Some(dialog);
        tx.focus("entry-cancel", false);
    }

    fn close_dialog(&mut self) {
        self.session.dialog = None;
        self.session.error = None;
    }

    fn open_generator(&mut self, tx: &mut Tx) {
        self.regenerate();
        tx.focus("generator-length", false);
    }

    pub fn regenerate(&mut self) {
        let preview = self.preferences.generate();
        self.set_preview(preview);
    }

    pub fn set_preview(&mut self, preview: crate::generator::Preview) {
        if let Some(editor) = self.editor_mut() {
            editor.generator = Some(preview);
        }
    }

    fn close_generator(&mut self) {
        if let Some(editor) = self.editor_mut() {
            editor.generator = None;
        }
    }

    pub fn use_generated(&mut self, tx: &mut Tx) {
        let Some(editor) = self.editor_mut() else {
            return;
        };
        if let Some(Ok(mut password)) = editor.generator.take() {
            editor.password.replace_text(std::mem::take(&mut *password));
            tx.focus("entry-password", false);
        }
    }

    fn submit(
        &mut self,
        change: dialogs::Change,
        core: Option<App>,
        runtime: &Handle,
        tx: &mut Tx,
    ) {
        let Some(core) = core else {
            return;
        };
        if self.session.pending.is_some() {
            return;
        }
        self.start(runtime, tx, Work::Save, async move {
            match change {
                dialogs::Change::Add(entry) => core.save_entry(entry).await?,
                dialogs::Change::Update(id, entry) => core.update_entry(id, entry).await?,
                dialogs::Change::Delete(id) => core.delete_entry(id).await?,
            }
            core.list_entries().await.map(Outcome::Entries)
        });
    }

    fn reveal(&mut self, core: Option<App>, runtime: &Handle, copy: bool, tx: &mut Tx) {
        let Some(core) = core else {
            return;
        };
        let Some(id) = self.session.selected().map(|entry| entry.id.clone()) else {
            return;
        };
        if self.session.pending.is_some() || (!copy && !self.session.toggle_reveal()) {
            return;
        }
        let work = if copy { Work::Copy } else { Work::Reveal };
        self.start(runtime, tx, work, async move {
            let mut secret = core.reveal_password(id.clone()).await?;
            Ok(if copy {
                Outcome::Copied(Zeroizing::new(std::mem::take(&mut secret.password)))
            } else {
                Outcome::Secret(id, secret)
            })
        });
    }
}

#[cfg(test)]
mod verify;
