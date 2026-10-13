import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import "../App.css";

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <main className="welcome">
      <h1>Page introuvable</h1>
      <Link to="/">Retour à l'accueil</Link>
    </main>
  ),
});
