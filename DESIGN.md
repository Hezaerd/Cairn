---
name: cairn-design
description: "Design, build, or change any screen in Cairn: the desktop app, the extension popup, the picker under a login field, or the save banner. Covers the Windows 11 look, the tokens and components in packages/ui, how secrets appear on screen, and the copy."
---

# Design Cairn

Cairn is a password manager that lives on one Windows 11 computer. It should look like a utility Windows ships: the same font, the same quiet surfaces, the same selection indicator, one accent color. Nobody opens Cairn to look at it. They open it to find a login, copy a code, or approve a browser, and then close it. Design for that.

Trust comes from restraint and predictability. A password manager that looks busy or playful makes people wonder what else it does. Keep every screen calm, and make every state obvious: locked or unlocked, hidden or revealed, paired or not.

This file is for anyone who changes the UI, people and agents alike. The tokens and components live in [`packages/ui`](packages/ui/src), and `pnpm lint` enforces most of what follows. When this file and the code disagree, fix one of them.

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

The desktop window draws its own title bar ([`TitleBar`](apps/desktop/src/window/TitleBar.tsx)) with Segoe Fluent Icons glyphs, so it matches the system caption buttons. Under it, each view has a toolbar, then a list on the left and details on the right. Below 680 px the window is compact. Use the `max-compact:` variant to narrow the panes and reduce padding there. Don't add other breakpoints.

The picker and the save banner sit in frames on someone else's page. Keep them small. Each one shows one decision. They size themselves to their content, so don't give them fixed heights. Escape closes both.

## Composition

**List and details.** A view that holds entries uses the `sidebar` grid: a 270 px list (210 px when compact) with a search field, a quiet heading, and `ListItem` rows, then a details pane capped at `max-w-180`. The details pane opens with the entry's icon, its name in `text-xl`, and a line saying what kind of entry it is. Its fields follow as `DetailField` rows separated by borders. When nothing is selected, show an `Empty` state that says why and what to do.

**Toolbar.** `Toolbar` holds the view switcher on the left, then the view's own commands, then settings and Lock. The view's main command, such as Add login, is the one `default` button. Everything else is `outline` or `ghost`.

**Settings.** The settings route has a navigation pane of `ListItem size="sm"` links and a single column capped at `max-w-190`. Group settings in a `Section` with a `SectionTitle`, and put each setting in a `Card`. Use `layout="row"` for a label and one control. It stacks in a compact window. Use `ChoiceCard` for two or three choices that are easier to pick when you can see them, such as a theme or an update channel.

**Dialogs.** Use a dialog for a short task that interrupts the view: adding or editing a login, confirming a delete, approving a browser. The title is a question or a short task name. The footer puts Cancel first and the action last. A destructive action uses the `destructive` button and names what it deletes.

**Locked and first-run screens.** Center one narrow column (`w-80`) with an icon, a `text-title` heading, one sentence, and the form. Nothing else.

**Popup and frames.** Start with the answer. The popup's first content is the logins for the site, or one sentence explaining why there are none and a single button. Keep the connection state in the header and the version in the footer, both in muted text.

## Visual system

### Typography

Cairn uses Segoe UI Variable (`font-sans`) for everything people read, Consolas (`font-mono`) for secrets, codes, and paths, and Segoe Fluent Icons (`font-icons`) only for caption buttons. The type scale is closed. `styles.css` removes Tailwind's own sizes, so any size missing from this table doesn't generate and `pnpm lint` reports it.

| Class           | Size  | Use it for                                                                         |
| --------------- | ----- | ---------------------------------------------------------------------------------- |
| `text-glyph`    | 10 px | Caption button glyphs                                                              |
| `text-2xs`      | 11 px | The second line of a list item, section titles, hints under fields, footers        |
| `text-xs`       | 12 px | List item names, field and detail labels, descriptions, most copy in the extension |
| `text-body`     | 13 px | Running text. The body default                                                     |
| `text-sm`       | 14 px | Buttons, inputs, menus, card titles                                                |
| `text-subtitle` | 15 px | Empty state titles, the popup's status heading                                     |
| `text-xl`       | 20 px | Dialog titles, the selected entry's name, one-time codes                           |
| `text-title`    | 22 px | The locked and first-run headings                                                  |
| `text-display`  | 28 px | Pairing codes the user compares between two windows                                |

There are three weights: `font-normal`, `font-medium` for button labels, and `font-semibold` for headings, names, and the current tab. Peers share a size and a weight. Don't make one list item bigger because its name is longer.

Use sentence case everywhere. Don't use all caps, letter-spaced labels, or decorative numbering. The only tracking is `tracking-wider` or `tracking-widest` on codes, which makes their digits easier to compare.

### Color

Design in neutrals. The accent marks what the user can act on or has selected, and red marks what destroys data. Nothing else gets color. Every color is a semantic token. `styles.css` removes Tailwind's palette, so `bg-blue-500` doesn't exist.

| Token                            | Light                 | Dark                  | Use it for                                                 |
| -------------------------------- | --------------------- | --------------------- | ---------------------------------------------------------- |
| `background` / `foreground`      | `#fafafa` / `#202020` | `#202020` / `#f0f0f0` | The window and its text                                    |
| `muted` / `muted-foreground`     | `#f3f3f3` / `#656565` | `#272727` / `#aaa`    | Side panes, cards, and secondary text                      |
| `popover`                        | `#fff`                | `#282828`             | Menus, popovers, the picker and banner frames              |
| `primary` / `primary-foreground` | `#0067c0` / `#fff`    | `#80c4ff` / `#002d51` | The main button, the selection indicator, links            |
| `secondary`                      | `#f0f0f0`             | `#303030`             | Secondary buttons                                          |
| `accent`                         | `#ebebeb`             | `#353535`             | Hover and keyboard focus on rows and ghost buttons         |
| `selection`                      | `#e5eff9`             | `#293e50`             | The selected row, the chosen card, selected text           |
| `destructive`                    | `#b42318`             | `#ffaaa4`             | Delete buttons, errors                                     |
| `border` / `input`               | `#e2e2e2` / `#d1d1d1` | `#383838` / `#515151` | Dividers, and the edges of fields                          |
| `ring`                           | `#0067c0`             | `#80c4ff`             | Focus outlines                                             |
| `caption-close`                  | `#c42b1c`             | `#c42b1c`             | The title bar's close button on hover, as Windows draws it |

`black` and `white` remain for the caption buttons' hover tints and text on red. Opacity modifiers such as `bg-muted/50` are fine.

Both themes follow Windows until the user picks one in Settings. Check every change in both. The extension always follows Windows. A `.light` class keeps a subtree, such as a theme preview, in the light palette inside a dark window.

Never pair color with meaning alone. An error has text, a selected row has the indicator as well as the fill, and a chosen card has a heavier title as well as the ring.

### Surfaces and depth

The window is one flat `background`. Side panes are `bg-muted` with a border on their edge. Cards are `bg-muted/50` with a border and `rounded-lg`. That's two levels, and it's enough. Don't nest cards.

Shadows belong only to things that float over the window: dialogs, popovers, menus, toasts. Inputs and outline buttons keep their `shadow-xs`. Nothing else casts one.

The radius scale is `rounded-sm` (3 px), `rounded-md` (4 px), `rounded-lg` (6 px), and `rounded-xl` (8 px). Use `md` for controls and rows, `lg` for cards, site icons, and dialogs, and `xl` only for `ChoiceCard`. `rounded-full` is for the slider and nothing else.

### Spacing

Use Tailwind's spacing scale. Arbitrary values fail `pnpm lint`. Let the parent own the gap. A list is `grid gap-0.5`, a form is `grid gap-4`, and a stack of settings sections is `grid gap-4`. Children don't add their own margins to space themselves out.

Keep related things close and unrelated things apart. A label sits close to its field, a field sits further from the next field, and a section sits further still. Panes use `p-8` for details and `px-6 py-6` for settings, less when compact.

### Icons

Use [Lucide](https://lucide.dev) icons. Inside buttons and rows they're 16 px, which `Button` and `ListItem` set for you. Empty states and the lock screen use a 28 px icon with a stroke width of 1.25 to 1.3, in `muted-foreground`. The Cairn mark appears only in the title bar and the popup header, through the `mask-mark` utility so it takes the text color.

An icon-only button needs an `aria-label` and a matching `title`. Don't put icons in colored tiles, and don't add an icon to a button whose label is already clear unless its neighbors have one.

### Motion

Default to stillness. Dialogs and menus fade and zoom in through `tw-animate-css`, a choice card's fill transitions, and spinners spin while something is loading. That's all. `styles.css` turns animations off for people who ask for reduced motion.

## Components

Everything below is in `packages/ui/src/components`. Import from `@cairn/ui/components/<name>`.

| Component                                                                       | Use it for                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                        | Actions. Variants: `default` for the one main action, `outline` for the others, `ghost` for toolbar and row actions, `destructive` for deleting, `link` for inline links. Sizes: `sm` in toolbars, frames, and cards, `default` in dialogs and forms, `icon-sm` for icon-only buttons |
| `Input`, `Textarea`, `Select`, `Checkbox`, `Slider`                             | Form controls. `Input variant="search"` leaves room for a search icon                                                                                                                                                                                                                 |
| `Field`, `FieldLabel`, `FieldDescription`, `FieldError`                         | A labelled control with its hint and error                                                                                                                                                                                                                                            |
| `ListItem`, `ListItemContent`, `ListItemTitle`, `ListItemDescription`           | A row you pick. Mark the selected one with `aria-current`. `size="sm"` is for navigation panes and the extension                                                                                                                                                                      |
| `Toolbar`                                                                       | The bar under the title bar                                                                                                                                                                                                                                                           |
| `Section`, `SectionTitle`, `Card`, `CardHeader`, `CardTitle`, `CardDescription` | Settings and other grouped content. `Card layout="row"` puts a header beside one control                                                                                                                                                                                              |
| `ChoiceCard`, `ChoiceCardTitle`, `ChoiceCardDescription`                        | Two or three side-by-side choices in a `role="group"`. Mark the chosen one with `aria-pressed`. `size="media"` puts a preview above a short label                                                                                                                                     |
| `Dialog`                                                                        | Short interrupting tasks. `DialogContent` needs a translated `closeLabel`                                                                                                                                                                                                             |
| `Popover`, `DropdownMenu`                                                       | Small panels and menus anchored to a button                                                                                                                                                                                                                                           |
| `Empty`                                                                         | What a pane shows when it has nothing to show                                                                                                                                                                                                                                         |
| `Separator`                                                                     | A divider inside a card. Between panes, use a border                                                                                                                                                                                                                                  |
| `Toaster`, `toast`                                                              | Confirming something finished, or reporting a failure that has no field to attach to                                                                                                                                                                                                  |

Selection and pressed states come from attributes, not from conditional classes. `aria-current` drives the `current:` variant, which gives the selection fill and the 3 × 18 px accent indicator. `aria-pressed` drives a choice card's ring. Focus is a 2 px `ring` outline, drawn inside the element.

Components own their look. Pass layout classes such as `w-56`, `mt-0.5`, or `justify-self-start`, but not color, padding, or type. `shadcn/no-restyle` reports the rest. When a screen needs a treatment the components don't have, add a variant or a token in `packages/ui`.

## Secrets on screen

- A password shows as twelve dots in `font-mono` until the user presses the eye button. The reveal hides itself after 30 seconds, and the hint under the field says so.
- Notes stay hidden with the password and appear only with it.
- One-time codes are `font-mono text-xl tabular-nums`, split in two halves, with a ring that counts down to the next code. The copy button beside it shows a toast when the code is on the clipboard.
- A pairing code is `font-mono text-display font-semibold tracking-widest`. Both the popup and the app show it at that size so the user can compare them.
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
2. If none does, add a variant to the component, or a token to [`styles.css`](packages/ui/src/styles.css). Give it a comment that says what it's for, and add it to this file.
3. A repeated pattern across two screens belongs in `packages/ui`. A pattern that knows about vaults, translations, or Tauri stays in its app.
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
