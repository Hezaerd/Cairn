import { createCn } from "cn/config";

// The font sizes added in App.css, so `text-title` isn't merged away as a text color.
export const cn = createCn({
  extend: {
    theme: { text: ["glyph", "2xs", "body", "subtitle", "title", "display"] },
  },
});
