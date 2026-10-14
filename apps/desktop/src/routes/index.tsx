import { createFileRoute } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import App from "../App";

/** Logins by default; `?view=authenticator` shows the authenticator codes. */
const Search = Schema.Struct({ view: Schema.optional(Schema.Literal("authenticator")) });

const decodeSearch = Schema.decodeUnknownOption(Search);

export const Route = createFileRoute("/")({
  component: App,
  validateSearch: (search): typeof Search.Type =>
    Option.getOrElse(decodeSearch(search), () => ({})),
});
