import { useContext, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { VaultRuntime } from "../vault/runtime";
import { FaviconService } from "./FaviconService";
import { cn } from "@cairn/ui/lib/utils";

export function SiteIcon({
  id,
  name,
  large = false,
}: {
  id: string;
  name: string;
  large?: boolean;
}) {
  const runtime = useContext(VaultRuntime);
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ id: string; image: string | null } | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );

    if (element.current) observer.observe(element.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!runtime || !visible) return;
    const controller = new AbortController();

    const load = Effect.gen(function* () {
      const service = yield* FaviconService;
      const cached = yield* service.cached(id);

      if (controller.signal.aborted) return;
      setResult({ id, image: cached?.image ?? null });

      if (cached?.stale) {
        const image = yield* service.refresh(id, cached.session);

        if (!controller.signal.aborted) setResult({ id, image });
      }
    }).pipe(Effect.catch(() => Effect.void));

    // Unmounting on lock interrupts the UI work; Rust cancels the network by session ticket.
    void runtime.runPromise(load, { signal: controller.signal }).catch(() => {});

    return () => controller.abort();
  }, [id, runtime, visible]);

  const image = result?.id === id ? result.image : null;

  return (
    <span
      ref={element}
      data-slot="site-icon"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-sm font-semibold",
        large && "size-11 bg-muted text-xl",
      )}
      aria-hidden="true"
    >
      {image ? (
        <img
          src={image}
          alt=""
          draggable={false}
          className={cn("size-5 object-contain", large && "size-7")}
          onError={() => setResult(null)}
        />
      ) : (
        name.slice(0, 1).toLocaleUpperCase()
      )}
    </span>
  );
}
