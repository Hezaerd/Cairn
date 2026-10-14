// Plain values and types only: the content script imports this module, and
// it runs on every page, so it must not pull in Effect.

export const MAX_PICKER_HEIGHT = 320;

/** The lengths a generated password may have, in the desktop app and the extension. */
export const MIN_PASSWORD_LENGTH = 8;

export const MAX_PASSWORD_LENGTH = 128;

/** Messages from the service worker to the content script. */
export type PageCommand =
  | {
      readonly type: "Fill";
      readonly origin: string;
      readonly username: string;
      readonly password: string;
    }
  /** A generated password for the sign-up form's password fields. */
  | { readonly type: "FillNewPassword"; readonly origin: string; readonly password: string }
  | { readonly type: "ClosePicker"; readonly refocus: boolean }
  | { readonly type: "ResizePicker"; readonly height: number }
  | { readonly type: "CloseSave" }
  | { readonly type: "ResizeSave"; readonly height: number };
