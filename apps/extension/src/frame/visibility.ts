import { useEffect, useRef, type RefObject } from "react";

// The picker and the save banner run in frames the page can't read. A page
// can still hide or cover a frame to trick a click, so a click only counts
// once the frame has been fully visible for a moment.

const MIN_VISIBLE_MS = 400;

// Intersection Observer v2, which TypeScript's DOM types don't declare yet.
interface VisibilityInit extends IntersectionObserverInit {
  readonly trackVisibility: boolean;
  readonly delay: number;
}

interface VisibilityEntry extends IntersectionObserverEntry {
  readonly isVisible?: boolean;
}

/**
 * Whether the element has been visible long enough to accept a click. Chromium
 * reports it hidden when anything covers it, or when it or the page around it
 * is transparent, filtered, or transformed.
 */
export function useTrustedVisibility(ref: RefObject<HTMLElement | null>) {
  const since = useRef<number | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    const init: VisibilityInit = { threshold: [0, 1], trackVisibility: true, delay: 100 };

    const observer = new IntersectionObserver((entries) => {
      // SAFETY: Chromium adds `isVisible` when `trackVisibility` is set.
      const visible = (entries.at(-1) as VisibilityEntry | undefined)?.isVisible === true;

      if (!visible) since.current = null;
      else since.current ??= performance.now();
    }, init);

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return () => since.current !== null && performance.now() - since.current >= MIN_VISIBLE_MS;
}
