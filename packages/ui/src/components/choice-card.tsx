import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@cairn/ui/lib/utils";

/**
 * One of a few choices shown side by side, such as a theme or an update
 * channel. Put them in a `role="group"` and mark the chosen one with
 * `aria-pressed`.
 */
const choiceCardVariants = cva(
  "group/choice grid content-start rounded-xl border text-left transition-colors not-aria-pressed:hover:bg-accent/60 aria-pressed:border-ring aria-pressed:bg-selection/60 aria-pressed:inset-ring aria-pressed:inset-ring-ring",
  {
    variants: {
      size: {
        // A title and a line that explains it.
        default: "gap-1 p-3 text-sm",
        // A preview above a short label.
        media: "gap-2 p-2 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function ChoiceCard({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof choiceCardVariants>) {
  return (
    <button
      type="button"
      data-slot="choice-card"
      data-size={size}
      className={cn(choiceCardVariants({ size, className }))}
      {...props}
    />
  );
}

function ChoiceCardTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="choice-card-title"
      className={cn(
        "text-muted-foreground group-aria-pressed/choice:font-semibold group-aria-pressed/choice:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ChoiceCardDescription({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="choice-card-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export { ChoiceCard, ChoiceCardDescription, ChoiceCardTitle, choiceCardVariants };
