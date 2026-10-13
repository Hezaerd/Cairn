/**
 * Runs in the page through `chrome.scripting.executeScript`, so it must not
 * use anything outside its own body. Fills the first visible password field
 * and the username field before it. On a page that asks for the username
 * first, fills that field alone.
 */
export function fillLogin(origin: string, username: string, password: string) {
  if (location.origin !== origin) return false;

  const usable = (input: HTMLInputElement) =>
    !input.disabled && !input.readOnly && input.getClientRects().length > 0;

  const inputs = Array.from(document.querySelectorAll("input")).filter(usable);
  const passwordField = inputs.find((input) => input.type === "password");

  const usernameTypes = ["text", "email", "tel", ""];

  const candidates = inputs.filter(
    (input) =>
      usernameTypes.includes(input.getAttribute("type")?.toLowerCase() ?? "") &&
      (!passwordField ||
        ((!passwordField.form || input.form === passwordField.form) &&
          input.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING)),
  );

  // Without a password field, only a field that says it wants a username counts.
  const usernameField =
    candidates.find((input) => /username|email/i.test(input.autocomplete)) ??
    (passwordField ? candidates.at(-1) : candidates.find((input) => input.type === "email"));

  // Assigning through the prototype setter, then dispatching events, lets
  // frameworks that track the value notice the change.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  const fill = (input: HTMLInputElement, value: string) => {
    input.focus();
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  if (usernameField && username) fill(usernameField, username);

  if (passwordField) fill(passwordField, password);

  return Boolean(passwordField || (usernameField && username));
}
