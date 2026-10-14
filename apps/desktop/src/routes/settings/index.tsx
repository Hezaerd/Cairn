import { createFileRoute, redirect } from "@tanstack/react-router";

// General is the page settings open on.
export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/general", replace: true });
  },
});
