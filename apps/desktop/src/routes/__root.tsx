import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { useT } from "@/i18n/I18nProvider";
import "../App.css";

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: NotFound,
});

function NotFound() {
  const t = useT();

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 p-8">
      <h1>{t.app.notFound}</h1>
      <Link to="/">{t.app.home}</Link>
    </main>
  );
}
