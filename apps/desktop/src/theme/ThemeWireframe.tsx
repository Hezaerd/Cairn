import { useId } from "react";
import { cn } from "@cairn/ui/lib/utils";

type Scheme = "light" | "dark";

type Box = { x: number; y: number; width: number; height: number };

/** A line of placeholder text. */
function Line({ className, ...box }: Box & { className?: string }) {
  return <rect {...box} rx={box.height / 2} className={cn("fill-foreground/15", className)} />;
}

/** A 1px rule, the width of a border at any size. */
function Rule(props: { x1: number; y1: number; x2: number; y2: number }) {
  return <line {...props} vectorEffect="non-scaling-stroke" className="stroke-border" />;
}

/**
 * A miniature of the unlocked vault on a 160×90 grid: the header, the login
 * list with its selected row, and the details of that login. The `light` and
 * `dark` classes scope the real color tokens, so the preview always matches
 * the app.
 */
function WireframePane({ scheme, clipPath }: { scheme: Scheme; clipPath?: string }) {
  return (
    <g className={scheme} clipPath={clipPath}>
      <rect width={160} height={90} className="fill-background" />

      {/* Header: title, then Add login and Lock */}
      <rect x={6.4} y={5.8} width={4.3} height={4.3} rx={1.5} className="fill-foreground/40" />
      <Line x={14.4} y={6.4} width={22.4} height={3.1} className="fill-foreground/30" />
      <rect x={105.6} y={4} width={24} height={7.3} rx={2} className="fill-primary" />
      <rect
        x={132.8}
        y={4}
        width={20.8}
        height={7.3}
        rx={2}
        vectorEffect="non-scaling-stroke"
        className="fill-background stroke-border"
      />
      <Rule x1={0} y1={15.3} x2={160} y2={15.3} />

      {/* Login list */}
      <rect y={15.3} width={49.6} height={74.7} className="fill-muted" />
      <Rule x1={49.6} y1={15.3} x2={49.6} y2={90} />
      <rect
        x={4}
        y={20.5}
        width={41.7}
        height={9}
        rx={2}
        vectorEffect="non-scaling-stroke"
        className="fill-background stroke-border"
      />
      {[0, 1, 2, 3].map((row) => {
        const y = 35.5 + row * 12.7;

        return (
          <g key={row}>
            {row === 0 && (
              <>
                <rect x={2} y={y} width={45.6} height={10.5} rx={2} className="fill-selection" />
                <rect
                  x={2}
                  y={y + 2.6}
                  width={1.4}
                  height={5.2}
                  rx={0.7}
                  className="fill-primary"
                />
              </>
            )}
            <rect
              x={6.1}
              y={y + 2.3}
              width={5.9}
              height={5.9}
              rx={1.5}
              className="fill-foreground/25"
            />
            <Line x={15.7} y={y + 3.9} width={22.8} height={2.5} className="fill-foreground/20" />
          </g>
        );
      })}

      {/* Details of the selected login */}
      <rect x={58.4} y={22} width={11.2} height={11.2} rx={2} className="fill-foreground/25" />
      <Line x={73.9} y={22.8} width={33.1} height={4.5} className="fill-foreground/30" />
      <Line x={73.9} y={29.5} width={22.1} height={3} />
      {[0, 1].map((field) => {
        const y = 42.2 + field * 22.4;

        return (
          <g key={field}>
            <Rule x1={58.4} y1={y} x2={151.1} y2={y} />
            <Line x={58.4} y={y + 4.7} width={14.8} height={2.7} />
            <Line x={58.4} y={y + 10.5} width={35.2} height={3.1} className="fill-foreground/25" />
          </g>
        );
      })}
    </g>
  );
}

/** System shows light and dark side by side, split down the middle. */
export function ThemeWireframe({ theme }: { theme: Scheme | "system" }) {
  const id = useId();

  return (
    <svg
      aria-hidden
      viewBox="0 0 160 90"
      className="block aspect-video w-full overflow-hidden rounded-lg border"
    >
      {theme === "system" ? (
        <>
          <defs>
            <clipPath id={`${id}-left`}>
              <rect width={79.3} height={90} />
            </clipPath>
            <clipPath id={`${id}-right`}>
              <rect x={80.7} width={79.3} height={90} />
            </clipPath>
          </defs>
          <WireframePane scheme="light" clipPath={`url(#${id}-left)`} />
          <WireframePane scheme="dark" clipPath={`url(#${id}-right)`} />
        </>
      ) : (
        <WireframePane scheme={theme} />
      )}
    </svg>
  );
}
