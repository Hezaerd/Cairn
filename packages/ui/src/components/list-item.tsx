import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@cairn/ui/lib/utils";

/**
 * A row you pick from a list or a navigation pane. `aria-current` marks the
 * selected one with the selection fill and the accent indicator on its left.
 */
const listItemVariants = cva(
  "relative flex w-full items-center gap-2.5 rounded-md text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring current:bg-selection current:before:absolute current:before:left-0 current:before:h-4.5 current:before:w-0.75 current:before:rounded-xs current:before:bg-primary [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
  {
    variants: {
      size: {
        // A list of entries, each with an icon and two lines.
        default: "p-2.5",
        // A navigation pane, or a list in the extension's small frames.
        sm: "px-2.5 py-2 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function ListItem({
  className,
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof listItemVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="list-item"
      data-size={size}
      className={cn(listItemVariants({ size, className }))}
      {...props}
    />
  );
}

/** The name and the detail under it, each cut to one line. */
function ListItemContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="list-item-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5 *:truncate", className)}
      {...props}
    />
  );
}

function ListItemTitle({ className, ...props }: React.ComponentProps<"strong">) {
  return (
    <strong
      data-slot="list-item-title"
      className={cn("text-xs font-semibold", className)}
      {...props}
    />
  );
}

function ListItemDescription({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="list-item-description"
      className={cn("text-2xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export { ListItem, ListItemContent, ListItemDescription, ListItemTitle, listItemVariants };
