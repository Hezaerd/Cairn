import { MAX_PICKER_HEIGHT } from "@cairn/contracts/picker";

const ICON_SIZE = 18;

const GAP = 4;

const PICKER_WIDTH = 300;

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
button:hover, button:focus-visible { background: rgb(137 148 129 / 0.25); }
iframe {
  position: fixed;
  width: ${PICKER_WIDTH}px;
  height: 0;
  border: 0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
  color-scheme: normal;
  background: #202520;
}
[hidden] { display: none; }
`;

const svg = (tag: string, attributes: Record<string, string>) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);

  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);

  return element;
};

/** Three stacked stones, drawn with DOM calls so no markup is parsed in the page. */
function icon() {
  const image = svg("svg", {
    viewBox: "0 0 16 16",
    width: "14",
    height: "14",
    "aria-hidden": "true",
  });

  for (const [cx, cy, rx, ry] of [
    [8, 13, 6, 2.2],
    [8, 8.6, 4.4, 1.9],
    [8, 4.6, 2.8, 1.6],
  ])
    image.append(
      svg("ellipse", {
        cx: String(cx),
        cy: String(cy),
        rx: String(rx),
        ry: String(ry),
        fill: "#899481",
        stroke: "#202520",
        "stroke-width": "0.8",
      }),
    );

  return image;
}

/**
 * The icon in a login field and the picker frame under it. Both live in a
 * closed shadow root, so page scripts can't reach them, though the page still
 * controls the host element's box. The picker checks its own visibility.
 */
export class Overlay {
  readonly #host = document.createElement("div");
  readonly #root: ShadowRoot;
  readonly #button = document.createElement("button");
  readonly #resized = new ResizeObserver(() => this.#schedule());
  #frame: HTMLIFrameElement | null = null;
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
    this.#button.title = chrome.i18n.getMessage("pickerIcon");
    this.#button.setAttribute("aria-label", this.#button.title);
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

  showIcon(anchor: HTMLInputElement) {
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
    this.#host.remove();
  }

  open() {
    if (this.#frame || !this.#anchor) return;

    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("picker.html");
    frame.title = "Cairn";
    frame.setAttribute("allow", "");
    this.#height = 0;
    this.#frame = frame;
    this.#root.append(frame);
    this.#place();
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
