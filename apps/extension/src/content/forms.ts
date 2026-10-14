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
 * The username field for `password` among `inputs`: one before it that says
 * it wants a username, or else the last text field before it. Without a
 * password field, only a field that says it wants a username counts.
 */
function usernameIn(inputs: ReadonlyArray<HTMLInputElement>, password?: HTMLInputElement) {
  const candidates = inputs.filter(
    (input) =>
      isUsernameType(input) &&
      (!password || input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING),
  );

  return (
    candidates.find((input) => /username|email/i.test(input.autocomplete)) ??
    (password ? candidates.at(-1) : candidates.find((input) => input.type === "email"))
  );
}

/**
 * The login fields among the inputs of one form, or of the inputs outside any
 * form. Null when there are none, or when the form looks like a sign-up or a
 * password change: two password fields, or one that asks for a new password.
 */
function loginIn(inputs: ReadonlyArray<HTMLInputElement>): LoginFields | null {
  const passwords = inputs.filter((input) => input.type === "password");

  if (passwords.length > 1 || passwords[0]?.autocomplete === "new-password") return null;

  const password = passwords[0];
  const username = usernameIn(inputs, password);

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

export interface Submission {
  readonly username: HTMLInputElement | undefined;
  readonly password: HTMLInputElement;
}

/**
 * The credentials in the form that `target` submits: a login form, or a
 * sign-up form whose two password fields match. Null for a password change,
 * where they differ, and for a form without a filled password field.
 */
export function submission(target: Element): Submission | null {
  const form =
    target instanceof HTMLFormElement
      ? target
      : target instanceof HTMLInputElement || target instanceof HTMLButtonElement
        ? target.form
        : target.closest("form");

  const inputs = groups().find((group) => group[0]?.form === form) ?? [];
  const passwords = inputs.filter((input) => input.type === "password" && input.value);
  const [password, confirm] = passwords;

  if (!password || passwords.length > 2 || (confirm && confirm.value !== password.value))
    return null;

  return { username: usernameIn(inputs, password), password };
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
