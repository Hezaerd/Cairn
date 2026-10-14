import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Option, Schema } from "effect";
import { storedField } from "./stored";

export const View = Schema.Literals(["logins", "authenticator"]);

export type View = typeof View.Type;

/**
 * Where the vault window is. The view and each view's selected entry survive a
 * restart; searches last until Cairn closes, so typed text never reaches storage.
 */
export interface Navigation {
  view: View;
  selected: Record<View, string | null>;
  query: Record<View, string>;
}

const initial: Navigation = {
  view: "logins",
  selected: { logins: null, authenticator: null },
  query: { logins: "", authenticator: "" },
};

const decodeStored = Schema.decodeUnknownOption(
  Schema.Struct({
    view: storedField(View, initial.view),
    selected: storedField(
      Schema.Struct({
        logins: Schema.NullOr(Schema.String),
        authenticator: Schema.NullOr(Schema.String),
      }),
      initial.selected,
    ),
  }),
);

export const useNavigation = create<Navigation>()(
  persist(() => initial, {
    name: "cairn-navigation",
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: ({ view, selected }) => ({ view, selected }),
    merge: (stored, current) =>
      Option.match(decodeStored(stored), {
        onNone: () => current,
        onSome: (navigation) => ({ ...current, ...navigation }),
      }),
  }),
);

export const showView = (view: View) => useNavigation.setState({ view });

export const selectEntry = (view: View, id: string) =>
  useNavigation.setState((state) => ({ selected: { ...state.selected, [view]: id } }));

export const searchEntries = (view: View, query: string) =>
  useNavigation.setState((state) => ({ query: { ...state.query, [view]: query } }));

/** Locking forgets the searches, as it did when the views unmounted. */
export const clearSearches = () => useNavigation.setState({ query: initial.query });
