import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import "../App.css";

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: () => (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 p-8">
      <h1>Page introuvable</h1>
      <Link to="/">Retour à l'accueil</Link>
    </main>
  ),
});
