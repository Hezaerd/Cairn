import * as React from "react";
import { cn } from "@cairn/ui/lib/utils";

/** The bar under the title bar that holds a view's navigation and commands. */
function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        "flex min-h-14.25 shrink-0 items-center gap-2 border-b px-4 py-2.5 max-compact:px-3",
        className,
      )}
      {...props}
    />
  );
}

export { Toolbar };
