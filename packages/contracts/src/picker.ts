// Plain values and types only: the content script imports this module, and
// it runs on every page, so it must not pull in Effect.

export const MAX_PICKER_HEIGHT = 320;

/** Messages from the service worker to the content script. */
export type PageCommand =
  | {
      readonly type: "Fill";
      readonly origin: string;
      readonly username: string;
      readonly password: string;
    }
  | { readonly type: "ClosePicker"; readonly refocus: boolean }
  | { readonly type: "ResizePicker"; readonly height: number };
