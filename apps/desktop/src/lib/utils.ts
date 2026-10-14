import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The font sizes added in App.css, so `text-title` isn't merged away as a text color.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ["glyph", "2xs", "body", "subtitle", "title", "display"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
