import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Toaster } from "@cairn/ui/components/sonner";
import { useT } from "@/i18n/I18nProvider";
import { TitleBar } from "@/window/TitleBar";
import "../App.css";

export const Route = createRootRoute({
  component: () => (
    <div className="flex h-dvh flex-col">
      <TitleBar />
      <Outlet />
      <Toaster />
    </div>
  ),
  notFoundComponent: NotFound,
});

function NotFound() {
  const t = useT();

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1>{t.app.notFound}</h1>
      <Link to="/">{t.app.home}</Link>
    </main>
  );
}
