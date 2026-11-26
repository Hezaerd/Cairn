use rune::{Color, Cx, El, Family, TextStyle, Titlebar, Tx, el, row, text};
use rune_kit::Kit;

use crate::{app::State, i18n::t};

pub const HEIGHT: f32 = 32.0;

pub fn load_font() -> Option<&'static str> {
    const FAMILY: &str = "Segoe Fluent Icons";
    let windows = std::env::var_os("WINDIR")?;
    let bytes = std::fs::read(std::path::Path::new(&windows).join("Fonts/SegoeIcons.ttf")).ok()?;
    rune::text::add_font(bytes)
        .iter()
        .any(|family| family.eq_ignore_ascii_case(FAMILY))
        .then_some(FAMILY)
}

pub fn glyph(value: &'static str, family: &'static str, size: f32, ink: Color) -> El {
    text(value)
        .font(TextStyle::new(size, 400.0).family(Family::Named(family)))
        .color(ink)
        .a11y_hidden()
}

pub fn view(state: &State, cx: &mut Cx<State>, kit: &Kit) -> El {
    let ink = kit.c.text_base;
    cx.caption_color(ink);
    let chrome = cx.chrome_insets();
    let bar = row()
        .key("title-bar")
        .w_full()
        .h(HEIGHT)
        .pl(chrome.leading + 12.0)
        .pr(chrome.trailing)
        .center_y()
        .window_drag()
        .child(
            text(t!("app.name"))
                .font(TextStyle::new(12.0, 500.0))
                .color(ink),
        )
        .child(el().grow(1.0));
    let Some(font) = state.caption_font else {
        return bar;
    };
    let (maximize, symbol) = if cx.is_maximized() {
        (t!("window.restore"), "\u{e923}")
    } else {
        (t!("window.maximize"), "\u{e922}")
    };
    let controls = [
        (
            t!("window.minimize"),
            "\u{e921}",
            Tx::minimize as fn(&mut Tx),
        ),
        (maximize, symbol, Tx::toggle_maximized),
        (t!("window.close"), "\u{e8bb}", Tx::close_window),
    ];
    bar.children(
        controls
            .into_iter()
            .enumerate()
            .map(|(index, (name, symbol, action))| {
                let close = index == 2;
                let hover = if close {
                    rune::color::hex("#c42b1c").unwrap()
                } else {
                    kit.c.hover
                };
                let mut face = glyph(symbol, font, 10.0, ink);
                if close {
                    face = face.group_color(Color::WHITE);
                }
                el().key(["caption-minimize", "caption-maximize", "caption-close"][index])
                    .w(Titlebar::CAPTION_BUTTON_WIDTH)
                    .h_full()
                    .center()
                    .hover(hover)
                    .hover_group()
                    .role("button")
                    .label(name)
                    .on_press_tx(move |_: &mut State, tx| action(tx))
                    .child(face)
            }),
    )
}
