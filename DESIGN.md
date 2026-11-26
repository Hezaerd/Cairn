---
name: cairn-design
description: "Design, build, or change any screen in Cairn: the desktop app, the extension popup, the picker under a login field, or the save banner. Covers the Windows 11 look, the Rune Kit and extension components, how secrets appear on screen, and the copy."
---

# Design Cairn

Cairn is a password manager that lives on one Windows 11 computer. It should look like a utility Windows ships: the same font, the same quiet surfaces, the same selection indicator, one accent color. Nobody opens Cairn to look at it. They open it to find a login, copy a code, or approve a browser, and then close it. Design for that.

Trust comes from restraint and predictability. A password manager that looks busy or playful makes people wonder what else it does. Keep every screen calm, and make every state obvious: locked or unlocked, hidden or revealed, paired or not.

This file is for anyone who changes the UI, people and agents alike. The desktop uses a Rune `Kit`. The extension uses [`packages/ui`](packages/ui/src), and `pnpm lint` checks its components and tokens. When this file and the code disagree, fix one of them.

## When rules compete

Protect them in this order:

1. The [security rules](AGENTS.md#security-rules). A secret appears only after an explicit reveal, and the extension shows only what its surface needs. No visual idea is worth breaking this.
2. Accessibility and Windows conventions: keyboard access, visible focus, labels, contrast in both themes, and controls that behave the way Windows users expect.
3. The existing components and tokens. Reuse before you add.
4. The task on the screen. Make the next action obvious.
5. Density and polish.

## The surfaces

| Surface        | Size                                     | What it's for                                                                       |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Desktop window | 920 × 640 by default, at least 600 × 480 | Creating and unlocking the vault, managing logins and authenticator codes, settings |
| Popup          | 320 px wide (`w-80`)                     | The logins for the current site, pairing, and turning suggestions on                |
| Picker         | 300 px wide, at most 320 px tall         | The logins under a login field, or the generator under a new-password field         |
| Save banner    | 320 px wide                              | Offering to save or update the login the user just submitted                        |

The desktop window draws its own [title bar](apps/desktop/src/title_bar.rs) with Segoe Fluent Icons and falls back to Rune's caption controls. The desktop switches to compact spacing below 680 px.

The picker and the save banner sit in frames on someone else's page. Keep them small. Each one shows one decision. They size themselves to their content, so don't give them fixed heights. Escape closes both.

## Desktop

Reuse the Rune `Kit` in [`theme.rs`](apps/desktop/src/theme.rs). Its palette pairs the extension's light and dark colors for the background, foreground, accent, selection, input borders, and errors. Use the Kit's semantic colors and its 3, 4, 6, and 8 px radii. The theme follows Windows until the user chooses one in **Settings → Appearance**. Check changes in both themes.

The window uses Segoe UI Variable with Segoe UI as a fallback. Use Consolas for secrets, codes, and paths. Keep labels and hints at 11 to 12 px, body text at 13 px, entry and dialog headings at 20 px, and the lock heading at 22 px.

- **List and details.** Give the searchable list 270 px, or 210 px in a compact window. Cap the details pane at 720 px. Separate fields with borders and mark the selected row with a fill and an accent indicator. Show an empty state when there is no selection.
- **Toolbar.** Put the view switcher on the left, the current view's main action beside it, and Settings and Lock on the right. Use the Kit's submit variant for the main action and quieter controls for secondary actions.
- **Settings.** Keep navigation beside one column capped at 760 px. Group related controls in bordered cards and use the existing selection treatment for theme and update channel choices.
- **Dialogs.** Use a dialog for short tasks such as editing a login, confirming deletion, or approving pairing. Put Cancel first and the action last. Use the danger colors for destructive actions and name what the action deletes.
- **Locked and first-run screens.** Center a narrow column with an icon, a heading, one sentence, and the form. Use a secure `TextInput` for master passwords.

## Extension

**Popup and frames.** Start with the answer. The popup's first content is the logins for the site, or one sentence explaining why there are none and a single button. Keep the connection state in the header and the version in the footer, both in muted text.

### Typography

The extension uses Segoe UI Variable (`font-sans`) for UI text and Consolas (`font-mono`) for codes and generated passwords. The type scale is closed. `styles.css` removes Tailwind's own sizes, so any size missing from this table doesn't generate and `pnpm lint` reports it.

| Class           | Size  | Use it for                                                                         |
| --------------- | ----- | ---------------------------------------------------------------------------------- |
| `text-2xs`      | 11 px | The second line of a list item, section titles, hints under fields, footers        |
| `text-xs`       | 12 px | List item names, field and detail labels, descriptions, most copy in the extension |
| `text-body`     | 13 px | Running text. The body default                                                     |
| `text-sm`       | 14 px | Buttons, inputs, menus, card titles                                                |
| `text-subtitle` | 15 px | Empty state titles, the popup's status heading                                     |
| `text-display`  | 28 px | Pairing codes the user compares between two windows                                |

There are three weights: `font-normal`, `font-medium` for button labels, and `font-semibold` for headings, names, and the current tab. Peers share a size and a weight. Don't make one list item bigger because its name is longer.

Use sentence case everywhere. Don't use all caps, letter-spaced labels, or decorative numbering. The only tracking is `tracking-wider` or `tracking-widest` on codes, which makes their digits easier to compare.

### Color

Design in neutrals. The accent marks what the user can act on or has selected, and red marks what destroys data. Nothing else gets color. Every color is a semantic token. `styles.css` removes Tailwind's palette, so `bg-blue-500` doesn't exist.

| Token                            | Light                 | Dark                  | Use it for                                         |
| -------------------------------- | --------------------- | --------------------- | -------------------------------------------------- |
| `background` / `foreground`      | `#fafafa` / `#202020` | `#202020` / `#f0f0f0` | The window and its text                            |
| `muted` / `muted-foreground`     | `#f3f3f3` / `#656565` | `#272727` / `#aaa`    | Side panes, cards, and secondary text              |
| `popover`                        | `#fff`                | `#282828`             | Menus, popovers, the picker and banner frames      |
| `primary` / `primary-foreground` | `#0067c0` / `#fff`    | `#80c4ff` / `#002d51` | The main button, the selection indicator, links    |
| `secondary`                      | `#f0f0f0`             | `#303030`             | Secondary buttons                                  |
| `accent`                         | `#ebebeb`             | `#353535`             | Hover and keyboard focus on rows and ghost buttons |
| `selection`                      | `#e5eff9`             | `#293e50`             | The selected row, the chosen card, selected text   |
| `destructive`                    | `#b42318`             | `#ffaaa4`             | Delete buttons, errors                             |
| `border` / `input`               | `#e2e2e2` / `#d1d1d1` | `#383838` / `#515151` | Dividers, and the edges of fields                  |
| `ring`                           | `#0067c0`             | `#80c4ff`             | Focus outlines                                     |

The extension follows the Windows theme. Check every change in both themes.

Never pair color with meaning alone. An error has text, a selected row has the indicator as well as the fill, and a selected control has a visible state.

### Spacing and depth

Use Tailwind's spacing scale. Arbitrary values fail `pnpm lint`. Let the parent own the gap. Keep a label close to its field and use more space between groups.

Keep the popup and frames flat. Use the existing radius tokens and reserve shadows for controls or frames that need an edge against their background.

### Icons

Use [Lucide](https://lucide.dev) icons. Inside buttons and rows they're 16 px, which `Button` and `ListItem` set for you. The popup header uses the `mask-mark` utility so the Cairn mark takes the text color.

An icon-only button needs an `aria-label` and a matching `title`. Don't put icons in colored tiles, and don't add an icon to a button whose label is already clear unless its neighbors have one.

### Motion

Default to stillness. `styles.css` turns animations off for people who ask for reduced motion.

### Components

Everything below is in `packages/ui/src/components`. Import from `@cairn/ui/components/<name>`.

| Component                                                                       | Use it for                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                        | Actions. Variants: `default` for the one main action, `outline` for the others, `ghost` for toolbar and row actions, `destructive` for deleting, `link` for inline links. Sizes: `sm` in toolbars, frames, and cards, `default` in dialogs and forms, `icon-sm` for icon-only buttons |
| `Input`, `Checkbox`, `Slider`                                                   | Form controls. `Input variant="search"` leaves room for a search icon                                                                                                                                                                                                                 |
| `Field`, `FieldLabel`, `FieldDescription`, `FieldError`                         | A labelled control with its hint and error                                                                                                                                                                                                                                            |
| `ListItem`, `ListItemContent`, `ListItemTitle`, `ListItemDescription`           | A row you pick. Mark the selected one with `aria-current`. `size="sm"` is for navigation panes and the extension                                                                                                                                                                      |
| `Section`, `SectionTitle`, `Card`, `CardHeader`, `CardTitle`, `CardDescription` | Settings and other grouped content. `Card layout="row"` puts a header beside one control                                                                                                                                                                                              |
| `ChoiceCard`, `ChoiceCardTitle`, `ChoiceCardDescription`                        | Two or three side-by-side choices in a `role="group"`. Mark the chosen one with `aria-pressed`. `size="media"` puts a preview above a short label                                                                                                                                     |
| `Popover`, `DropdownMenu`                                                       | Small panels and menus anchored to a button                                                                                                                                                                                                                                           |
| `Separator`                                                                     | A divider inside a card. Between panes, use a border                                                                                                                                                                                                                                  |
| `Toaster`, `toast`                                                              | Confirming something finished, or reporting a failure that has no field to attach to                                                                                                                                                                                                  |

Selection comes from attributes. `aria-current` drives the `current:` variant, which gives the selection fill and the 3 × 18 px accent indicator. Focus is a 2 px `ring` outline, drawn inside the element.

Components own their look. Pass layout classes such as `w-56`, `mt-0.5`, or `justify-self-start`, but not color, padding, or type. `shadcn/no-restyle` reports the rest. When a screen needs a treatment the components don't have, add a variant or a token in `packages/ui`.

## Secrets on screen

- A password shows as twelve dots in Consolas until the user presses the eye button. The reveal hides itself after 30 seconds, and the hint under the field says so.
- Notes stay hidden with the password and appear only with it.
- One-time codes use 20 px Consolas, split in two halves, with a ring that counts down to the next code. The copy button beside it shows a toast when the code is on the clipboard.
- A pairing code uses 28 px semibold Consolas with extra space between digits. The popup and desktop use the same size so the user can compare them.
- The extension shows login names and usernames, never passwords. The save banner shows the site and the username, never the password it's about to save.
- Generated passwords appear in a `font-mono text-body/snug` box with `wrap-anywhere`, so a long password wraps instead of overflowing.

## Writing

Cairn ships in English and French. Every string lives in [`apps/desktop/src/i18n`](apps/desktop/src/i18n) or [`apps/extension/public/_locales`](apps/extension/public/_locales), never in a component. French strings run longer, so labels must wrap or truncate cleanly.

- Write in sentence case, in plain words, to the person using Cairn.
- Buttons say what they do: "Add login", "Lock", "Approve". Not "OK", and not "Submit".
- A description says what will happen and what it affects: "The login leaves the vault. The backup of the previous version keeps it until the next change."
- An error says what went wrong and what to do next: "The vault changed on disk. Lock it and unlock it again before continuing."
- An empty state says why the pane is empty and how to fill it: "No logins. Add a login to find it here."
- Name things the same way everywhere. A saved credential is a "login", the second factor is an "authenticator code", and its secret is an "authenticator key".
- Don't use exclamation marks, jokes, em dashes, or "please".

## Changing the system

1. Look for a component, variant, or token that already does the job.
2. If none does, add a variant to the component or a token to the app's theme. The desktop theme is in `theme.rs`. The extension theme is in [`styles.css`](packages/ui/src/styles.css).
3. Share patterns between extension pages through `packages/ui`. Keep patterns that know about vaults or translations in their app.
4. Don't silence a lint rule to get a design through. If a rule blocks something the design genuinely needs, change the system.

## Before you call a screen done

- Look at it in light and dark, at the default size and in a compact window. For the extension, check the popup, the picker, and the banner at their real widths.
- Tab through it. Every control is reachable, its focus is visible, and Escape closes what it should.
- Read it in French.
- Squint at it. One thing should stand out: the selected entry, the main action, or the code to compare. If everything has the same weight, remove something rather than adding emphasis.
- Check that no secret appears before the user asks for it.
- Run `pnpm check`.

## Don't

- Gradients, glows, glass, textures, or decorative shadows.
- Cards inside cards, or borders added to fix a weak hierarchy.
- A second accent color, or color used to mean "important".
- Badges or pills for ordinary metadata.
- All-caps or letter-spaced labels.
- Arbitrary sizes, colors, or spacing, or inline styles.
- Hand-rolled list rows, toolbars, or setting cards. Use the components.
- Illustrations, mascots, celebration, or confetti.
- Motion that only decorates.
- A secret on screen without an explicit reveal.
