import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <main className="grid min-h-50 content-center justify-items-center gap-3 p-6">
      <h1 className="text-subtitle font-semibold">Page introuvable</h1>
      <Link to="/" className="text-xs text-primary underline-offset-4 hover:underline">
        Retour à l'accueil
      </Link>
    </main>
  ),
});
