import { MAX_PICKER_HEIGHT } from "@cairn/contracts/picker";
import markSvg from "../../../../brand/cairn.svg?raw";

/** The path of Cairn's mark. The build inlines its SVG as text. */
const MARK = /\sd="([^"]+)"/.exec(markSvg)?.[1] ?? "";

const ICON_SIZE = 18;

const GAP = 4;

const PICKER_WIDTH = 300;

const BANNER_WIDTH = 320;

const BANNER_MARGIN = 12;

const style = `
button {
  all: initial;
  position: fixed;
  display: grid;
  place-items: center;
  width: ${ICON_SIZE}px;
  height: ${ICON_SIZE}px;
  border-radius: 4px;
  cursor: pointer;
}
button:hover, button:focus-visible { background: rgb(117 117 117 / 0.2); }
iframe {
  position: fixed;
  width: ${PICKER_WIDTH}px;
  height: 0;
  border: 0;
  border-radius: 8px;
  color-scheme: normal;
  /* The popover tokens in packages/ui, so the frame's edge matches its page while it loads. */
  background: #fff;
  box-shadow: 0 0 0 1px #e2e2e2, 0 8px 24px rgb(0 0 0 / 0.18);
}
@media (prefers-color-scheme: dark) {
  iframe {
    background: #282828;
    box-shadow: 0 0 0 1px #383838, 0 8px 24px rgb(0 0 0 / 0.4);
  }
}
iframe.banner {
  top: ${BANNER_MARGIN}px;
  right: ${BANNER_MARGIN}px;
  width: min(${BANNER_WIDTH}px, calc(100vw - ${2 * BANNER_MARGIN}px));
}
[hidden] { display: none; }
`;

const svg = (tag: string, attributes: Record<string, string>) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);

  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);

  return element;
};

/** Cairn's mark, drawn with DOM calls so no markup is parsed in the page. */
function icon() {
  const image = svg("svg", {
    viewBox: "0 0 1254 1254",
    width: "14",
    height: "14",
    "aria-hidden": "true",
  });

  image.append(svg("path", { d: MARK, fill: "#757575" }));

  return image;
}

/** A frame for one of the extension's pages. The page can't read its contents. */
function extensionFrame(page: string) {
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL(page);
  frame.title = "Cairn";
  frame.setAttribute("allow", "");

  return frame;
}

/**
 * The icon in a login or sign-up field, the picker frame under it, and the banner that
 * offers to save a login. They live in a closed shadow root, so page scripts
 * can't reach them, though the page still controls the host element's box.
 * The frames check their own visibility.
 */
export class Overlay {
  readonly #host = document.createElement("div");
  readonly #root: ShadowRoot;
  readonly #button = document.createElement("button");
  readonly #resized = new ResizeObserver(() => this.#schedule());
  #frame: HTMLIFrameElement | null = null;
  #banner: HTMLIFrameElement | null = null;
  #anchor: HTMLInputElement | null = null;
  #height = 0;
  #scheduled = false;

  constructor(onIcon: (event: MouseEvent) => void) {
    for (const [property, value] of [
      ["all", "initial"],
      ["position", "fixed"],
      ["top", "0"],
      ["left", "0"],
      ["width", "0"],
      ["height", "0"],
      ["z-index", "2147483647"],
    ])
      this.#host.style.setProperty(property, value, "important");

    this.#root = this.#host.attachShadow({ mode: "closed" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#button.type = "button";
    this.#button.hidden = true;
    this.#button.append(icon());
    this.#button.addEventListener("click", onIcon);
    // Keep focus in the field when the icon is clicked.
    this.#button.addEventListener("mousedown", (event) => event.preventDefault());
    this.#root.append(sheet, this.#button);

    const schedule = () => this.#schedule();
    addEventListener("scroll", schedule, { capture: true, passive: true });
    addEventListener("resize", schedule, { passive: true });
  }

  get anchor() {
    return this.#anchor;
  }

  get isOpen() {
    return this.#frame !== null;
  }

  /** Whether an event's target is part of the overlay. */
  contains(target: EventTarget | null) {
    return target === this.#host;
  }

  /** Shows the icon in `anchor`, which offers to generate a password if `generator`. */
  showIcon(anchor: HTMLInputElement, generator: boolean) {
    this.#button.title = chrome.i18n.getMessage(generator ? "generatorIcon" : "pickerIcon");
    this.#button.setAttribute("aria-label", this.#button.title);

    if (this.#anchor !== anchor) {
      this.#resized.disconnect();
      this.#resized.observe(anchor);
    }

    this.#anchor = anchor;
    this.#button.hidden = false;
    this.#attach();
    this.#place();
  }

  hide() {
    this.close();
    this.#resized.disconnect();
    this.#anchor = null;
    this.#button.hidden = true;
    this.#detach();
  }

  open() {
    if (this.#frame || !this.#anchor) return;

    const frame = extensionFrame("picker.html");
    this.#height = 0;
    this.#frame = frame;
    this.#root.append(frame);
    this.#place();
  }

  get isOffering() {
    return this.#banner !== null;
  }

  /** Opens the banner that offers to save the login just submitted. */
  offerSave() {
    if (this.#banner) return;

    const banner = extensionFrame("save.html");
    banner.className = "banner";
    this.#banner = banner;
    this.#root.append(banner);
    this.#attach();
  }

  closeSave() {
    this.#banner?.remove();
    this.#banner = null;

    if (!this.#anchor) this.#detach();
  }

  resizeSave(height: number) {
    if (this.#banner)
      this.#banner.style.height = `${Math.min(Math.max(height, 0), MAX_PICKER_HEIGHT)}px`;
  }

  close() {
    this.#frame?.remove();
    this.#frame = null;
  }

  resize(height: number) {
    this.#height = Math.min(Math.max(height, 0), MAX_PICKER_HEIGHT);
    this.#place();
  }

  /** Moves keyboard focus into the picker. */
  focusPicker() {
    this.#frame?.focus();
  }

  #attach() {
    if (!this.#host.isConnected) document.documentElement.append(this.#host);
  }

  /** Takes the overlay out of the page, unless the banner is still open. */
  #detach() {
    if (!this.#banner) this.#host.remove();
  }

  #schedule() {
    if (this.#scheduled || !this.#anchor) return;
    this.#scheduled = true;

    requestAnimationFrame(() => {
      this.#scheduled = false;
      this.#place();
    });
  }

  #place() {
    const anchor = this.#anchor;

    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();

    if (!anchor.isConnected || rect.width === 0 || rect.height === 0) {
      this.#button.hidden = true;
      this.close();

      return;
    }

    this.#button.hidden = false;
    this.#button.style.left = `${rect.right - ICON_SIZE - 6}px`;
    this.#button.style.top = `${rect.top + (rect.height - ICON_SIZE) / 2}px`;

    const frame = this.#frame;

    if (!frame) return;

    const width = Math.min(PICKER_WIDTH, innerWidth - 2 * GAP);
    const below = rect.bottom + GAP;
    const fitsBelow = below + this.#height <= innerHeight || rect.top - GAP - this.#height < 0;
    frame.style.width = `${width}px`;
    frame.style.height = `${this.#height}px`;
    frame.style.left = `${Math.max(GAP, Math.min(rect.left, innerWidth - width - GAP))}px`;
    frame.style.top = `${fitsBelow ? below : rect.top - GAP - this.#height}px`;
  }
}
