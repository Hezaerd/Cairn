use rune::{Color, Shadow, color::hex};
use rune_kit::{Elevation, Kit, PaletteSeed};

pub fn kit(dark: bool) -> Kit {
    let token = |light, dark_value| hex(if dark { dark_value } else { light }).unwrap();
    let bg = token("#fafafa", "#202020");
    let fg = token("#202020", "#f0f0f0");
    let primary = token("#0067c0", "#80c4ff");
    let border = token("#e2e2e2", "#383838");
    let input = token("#d1d1d1", "#515151");

    let mut kit = Kit::from_palette(PaletteSeed {
        bg,
        fg,
        accent: primary,
    });
    kit.c.layer_01 = token("#f3f3f3", "#272727");
    kit.c.bg_accent = token("#e5eff9", "#293e50");
    kit.c.text_muted = token("#656565", "#aaaaaa");
    kit.c.bg_button_neutral = token("#f0f0f0", "#303030");
    kit.c.bg_icon_button_contrast = primary;
    kit.c.submit_fg = token("#ffffff", "#002d51");
    kit.c.submit_highlight = Color::TRANSPARENT;
    kit.c.border_base = input;
    kit.c.border_muted = border;
    kit.c.border_focus = primary;
    kit.c.hover = token("#ebebeb", "#353535");
    kit.c.danger.fg = token("#b42318", "#ffaaa4");
    kit.c.danger.border = kit.c.danger.fg;
    kit.radius.sm = 3.0;
    kit.radius.md = 4.0;
    kit.radius.lg = 6.0;
    kit.radius.xl = 8.0;
    kit.elevation = Elevation::default().with_input(vec![Shadow {
        spread: 1.0,
        color: input,
        ..Shadow::default()
    }]);
    kit
}
