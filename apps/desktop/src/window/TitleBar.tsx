import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "../i18n/I18nProvider";

// Glyphs from Segoe Fluent Icons, the font Windows 11 draws its own caption buttons with.
const glyphs = { minimize: "\uE921", maximize: "\uE922", restore: "\uE923", close: "\uE8BB" };

const appWindow = getCurrentWindow();

const captionButton = "flex h-full w-11.5 items-center justify-center font-icons text-glyph";

/** Replaces the system title bar, which the window turns off with `decorations: false`. */
export function TitleBar() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    const syncMaximized = () => void appWindow.isMaximized().then(setMaximized);

    const listeners = [
      appWindow.onResized(syncMaximized),
      appWindow.onFocusChanged(({ payload }) => setFocused(payload)),
    ];

    syncMaximized();
    void appWindow.isFocused().then(setFocused);

    return () => {
      for (const listener of listeners) void listener.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <header
      data-titlebar
      data-tauri-drag-region="deep"
      data-focused={focused}
      className="group pointer-events-auto relative z-60 flex h-8 shrink-0 items-center bg-background text-xs select-none data-[focused=false]:text-muted-foreground"
    >
      {/* A mask paints the mark in the text color, so it follows the theme. */}
      <span
        aria-hidden
        className="mr-2 ml-3 size-4 bg-current mask-mark mask-contain mask-center mask-no-repeat"
      />
      <span className="mr-auto truncate">Cairn</span>
      <div className="flex h-full" data-tauri-drag-region="false">
        <button
          type="button"
          tabIndex={-1}
          className={`${captionButton} hover:bg-black/4 active:bg-black/2 dark:hover:bg-white/6 dark:active:bg-white/4`}
          aria-label={t.window.minimize}
          title={t.window.minimize}
          onClick={() => void appWindow.minimize()}
        >
          {glyphs.minimize}
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={`${captionButton} hover:bg-black/4 active:bg-black/2 dark:hover:bg-white/6 dark:active:bg-white/4`}
          aria-label={maximized ? t.window.restore : t.window.maximize}
          title={maximized ? t.window.restore : t.window.maximize}
          onClick={() => void appWindow.toggleMaximize()}
        >
          {maximized ? glyphs.restore : glyphs.maximize}
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={`${captionButton} hover:bg-caption-close hover:text-white active:bg-caption-close/90 active:text-white/80`}
          aria-label={t.window.close}
          title={t.window.close}
          onClick={() => void appWindow.close()}
        >
          {glyphs.close}
        </button>
      </div>
    </header>
  );
}
