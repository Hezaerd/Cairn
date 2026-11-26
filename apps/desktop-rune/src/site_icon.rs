use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::STANDARD};
use cairn_app::App;
use cairn_vault::EntrySummary;
use rune::{El, Pixels, TextStyle, el, text};
use rune_kit::Kit;
use tokio::{runtime::Handle, sync::mpsc, task::JoinHandle};

#[derive(Default)]
pub struct SiteIcons(HashMap<String, SiteIcon>);

struct SiteIcon {
    site: String,
    pixels: Option<Pixels>,
    updates: mpsc::UnboundedReceiver<Option<Pixels>>,
    task: JoinHandle<()>,
}

impl Drop for SiteIcon {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl SiteIcons {
    pub fn load(&mut self, core: App, runtime: &Handle, id: String, site: String) {
        if site.is_empty() || self.0.contains_key(&id) {
            return;
        }
        let (send, updates) = mpsc::unbounded_channel();
        let task = runtime.spawn({
            let id = id.clone();
            async move {
                let Ok(Some(cached)) = core.favicon_cached(id.clone()).await else {
                    return;
                };
                if let Some(image) = cached.image {
                    let _ = send.send(decode(&image));
                }
                if cached.stale
                    && let Ok(image) = core.favicon_refresh(id, cached.session).await
                {
                    let _ = send.send(image.as_deref().and_then(decode));
                }
            }
        });
        self.0.insert(
            id,
            SiteIcon {
                site,
                pixels: None,
                updates,
                task,
            },
        );
    }

    pub fn retain(&mut self, entries: &[EntrySummary]) {
        let sites: HashMap<_, _> = entries
            .iter()
            .map(|entry| (&entry.id, &entry.site))
            .collect();
        self.0.retain(|id, icon| sites.get(id) == Some(&&icon.site));
    }

    pub fn poll(&mut self) -> bool {
        let mut changed = false;
        for icon in self.0.values_mut() {
            while let Ok(pixels) = icon.updates.try_recv() {
                icon.pixels = pixels;
                changed = true;
            }
        }
        changed
    }

    pub fn view(&self, entry: &EntrySummary, large: bool, kit: &Kit) -> El {
        let (size, image_size, font) = if large {
            (44.0, 28.0, 20.0)
        } else {
            (16.0, 14.0, 11.0)
        };
        let face = match self.0.get(&entry.id).and_then(|icon| icon.pixels.as_ref()) {
            Some(pixels) => el()
                .key("cached-site-icon")
                .size(image_size, image_size)
                .pixels(pixels),
            None => text(
                entry
                    .name
                    .chars()
                    .take(1)
                    .flat_map(char::to_uppercase)
                    .collect::<String>(),
            )
            .font(TextStyle::new(font, 600.0))
            .color(kit.c.text_base),
        };
        let id = entry.id.clone();
        let site = entry.site.clone();
        el().key(format!("site-icon-{size}-{id}-{site}"))
            .size(size, size)
            .center()
            .radius(kit.radius.lg)
            .fill(if large { kit.c.layer_01 } else { kit.c.page })
            .border(1.0, kit.c.border_muted)
            .a11y_hidden()
            .child(face)
            .on_mount(move |state: &mut crate::app::State, _| {
                if let Some(core) = state.core().cloned() {
                    state
                        .vault
                        .load_icon(core, id.clone(), site.clone(), &state.runtime);
                }
            })
    }
}

fn decode(uri: &str) -> Option<Pixels> {
    let bytes = STANDARD
        .decode(uri.strip_prefix("data:image/png;base64,")?)
        .ok()?;
    let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .ok()?
        .into_rgba8();
    let pixels = Pixels::new();
    pixels.set(image.width(), image.height(), image.into_raw());
    Some(pixels)
}
