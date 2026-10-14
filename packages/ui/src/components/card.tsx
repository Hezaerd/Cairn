import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@cairn/ui/lib/utils";

/** A labelled group of cards, such as one part of the settings. */
function Section({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="section" className={cn("grid gap-3", className)} {...props} />;
}

function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="section-title"
      className={cn("text-2xs text-muted-foreground", className)}
      {...props}
    />
  );
}

/** One setting, or a few that belong together, on a raised surface. */
const cardVariants = cva("rounded-lg border bg-muted/50 p-4", {
  variants: {
    layout: {
      // The card lays out its own content.
      block: "",
      stack: "grid gap-3",
      // Its header on the left and a control on the right, stacked in a compact window.
      row: "flex items-center justify-between gap-6 max-compact:flex-col max-compact:items-stretch max-compact:gap-3",
    },
  },
  defaultVariants: {
    layout: "block",
  },
});

function Card({
  className,
  layout = "block",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-layout={layout}
      className={cn(cardVariants({ layout, className }))}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("grid min-w-0 gap-1", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 data-slot="card-title" className={cn("text-sm", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Card, CardDescription, CardHeader, CardTitle, Section, SectionTitle, cardVariants };
