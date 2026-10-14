import { cn } from "@/lib/utils";

type Scheme = "light" | "dark";

const clips = {
  left: "polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)",
  right: "polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)",
};

/** A line of placeholder text. */
function Line({ className }: { className: string }) {
  return <span className={cn("absolute h-[4%] rounded-full bg-foreground/15", className)} />;
}

/**
 * A miniature of the unlocked vault: the header, the login list with its
 * selected row, and the details of that login. The `light` and `dark` classes
 * scope the real color tokens, so the preview always matches the app.
 */
function WireframePane({ scheme, clip }: { scheme: Scheme; clip?: keyof typeof clips }) {
  return (
    <span
      className={cn("absolute inset-0 bg-background", scheme)}
      style={clip && { clipPath: clips[clip] }}
    >
      {/* Header: title, then Add login and Lock */}
      <span className="absolute inset-x-0 top-0 h-[17%] border-b">
        <span className="absolute top-[38%] left-[4%] aspect-square h-[28%] rounded-xs bg-foreground/40" />
        <Line className="top-[42%] left-[9%] h-[20%] w-[14%] bg-foreground/30" />
        <span className="absolute top-[26%] right-[19%] h-[48%] w-[15%] rounded-sm bg-primary" />
        <span className="absolute top-[26%] right-[4%] h-[48%] w-[13%] rounded-sm border bg-background" />
      </span>

      {/* Login list */}
      <span className="absolute bottom-0 left-0 top-[17%] w-[31%] border-r bg-muted">
        <span className="absolute top-[7%] inset-x-[8%] h-[12%] rounded-sm border bg-background" />
        {[0, 1, 2, 3].map((row) => (
          <span
            key={row}
            className={cn("absolute inset-x-[4%] h-[14%] rounded-sm", row === 0 && "bg-selection")}
            style={{ top: `${27 + row * 17}%` }}
          >
            {row === 0 && (
              <span className="absolute top-[25%] left-0 h-1/2 w-[3%] rounded-xs bg-primary" />
            )}
            <span className="absolute top-[22%] left-[9%] aspect-square h-[56%] rounded-xs bg-foreground/25" />
            <span className="absolute top-[38%] left-[30%] h-[24%] w-[50%] rounded-full bg-foreground/20" />
          </span>
        ))}
      </span>

      {/* Details of the selected login */}
      <span className="absolute right-0 bottom-0 left-[31%] top-[17%]">
        <span className="absolute top-[9%] left-[8%] aspect-square h-[15%] rounded-sm bg-foreground/25" />
        <Line className="top-[10%] left-[22%] h-[6%] w-[30%] bg-foreground/30" />
        <Line className="top-[19%] left-[22%] w-[20%]" />
        {[0, 1].map((field) => (
          <span
            key={field}
            className="absolute inset-x-[8%] h-[26%] border-t"
            style={{ top: `${36 + field * 30}%` }}
          >
            <Line className="top-[24%] left-0 h-[14%] w-[16%]" />
            <Line className="top-[54%] left-0 h-[16%] w-[38%] bg-foreground/25" />
          </span>
        ))}
      </span>
    </span>
  );
}

/** System shows light and dark side by side, split down the middle. */
export function ThemeWireframe({ theme }: { theme: Scheme | "system" }) {
  return (
    <span
      aria-hidden
      className="relative block aspect-[16/9] w-full overflow-hidden rounded-lg border"
    >
      {theme === "system" ? (
        <>
          <WireframePane scheme="light" clip="left" />
          <WireframePane scheme="dark" clip="right" />
        </>
      ) : (
        <WireframePane scheme={theme} />
      )}
    </span>
  );
}
