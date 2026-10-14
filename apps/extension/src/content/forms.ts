export interface LoginFields {
  readonly username: HTMLInputElement | undefined;
  readonly password: HTMLInputElement | undefined;
}

const usernameTypes = ["text", "email", "tel", ""];

export const usable = (input: HTMLInputElement) =>
  !input.disabled && !input.readOnly && input.getClientRects().length > 0;

const isUsernameType = (input: HTMLInputElement) =>
  usernameTypes.includes(input.getAttribute("type")?.toLowerCase() ?? "");

/**
 * The login fields among the inputs of one form, or of the inputs outside any
 * form. Null when there are none, or when the form looks like a sign-up or a
 * password change: two password fields, or one that asks for a new password.
 */
function loginIn(inputs: ReadonlyArray<HTMLInputElement>): LoginFields | null {
  const passwords = inputs.filter((input) => input.type === "password");

  if (passwords.length > 1 || passwords[0]?.autocomplete === "new-password") return null;

  const password = passwords[0];

  const candidates = inputs.filter(
    (input) =>
      isUsernameType(input) &&
      (!password || input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING),
  );

  // Without a password field, only a field that says it wants a username counts.
  const username =
    candidates.find((input) => /username|email/i.test(input.autocomplete)) ??
    (password ? candidates.at(-1) : candidates.find((input) => input.type === "email"));

  return password || username ? { username, password } : null;
}

/** Visible inputs grouped by form, with the ones outside any form last. */
function groups() {
  const byForm = new Map<HTMLFormElement | null, HTMLInputElement[]>();

  for (const input of document.querySelectorAll("input")) {
    if (!usable(input)) continue;
    const group = byForm.get(input.form) ?? [];
    group.push(input);
    byForm.set(input.form, group);
  }

  const formless = byForm.get(null);
  byForm.delete(null);

  return formless ? [...byForm.values(), formless] : [...byForm.values()];
}

/**
 * The login fields that `anchor` belongs to, or null if it isn't one. Without
 * an anchor, the page's first form with a password field, or else its first
 * form that asks for a username alone.
 */
export function loginFields(anchor?: HTMLInputElement): LoginFields | null {
  if (anchor) {
    const fields = loginIn(groups().find((group) => group.includes(anchor)) ?? []);

    return fields && (fields.username === anchor || fields.password === anchor) ? fields : null;
  }

  const found = groups().flatMap((group) => loginIn(group) ?? []);

  return found.find((fields) => fields.password) ?? found[0] ?? null;
}

// Assigning through the prototype setter, then dispatching events, lets
// frameworks that track the value notice the change.
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

function fillField(input: HTMLInputElement, value: string) {
  input.focus();
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Fills `fields`. Returns whether anything was filled. */
export function fill(fields: LoginFields, username: string, password: string) {
  if (fields.username && username) fillField(fields.username, username);

  if (fields.password) fillField(fields.password, password);

  return Boolean(fields.password || (fields.username && username));
}
