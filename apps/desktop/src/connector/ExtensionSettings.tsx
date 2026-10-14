import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Effect } from "effect";
import { FolderOpen } from "lucide-react";
import { toast } from "@cairn/ui/components/sonner";
import { Button } from "@cairn/ui/components/button";
import { CardDescription, CardHeader, CardTitle } from "@cairn/ui/components/card";
import { useT } from "@/i18n/I18nProvider";
import { extensionFolder, openExtensionFolder, type ExtensionFolder } from "./connector";

type Folder = ExtensionFolder | { readonly state: "loading" };

export function ExtensionSettings({ labelledBy }: { labelledBy: string }) {
  const t = useT();
  const [folder, setFolder] = useState<Folder>({ state: "loading" });

  useEffect(() => {
    if (!isTauri()) return;

    void Effect.runPromise(
      extensionFolder.pipe(
        Effect.match({ onSuccess: setFolder, onFailure: () => setFolder({ state: "missing" }) }),
      ),
    );
  }, []);

  function open() {
    void Effect.runPromise(
      openExtensionFolder.pipe(
        Effect.catch(() => Effect.sync(() => toast.error(t.extension.notOpened))),
      ),
    );
  }

  if (folder.state === "loading") return null;

  if (folder.state !== "installed")
    return (
      <CardDescription>
        {folder.state === "dev" ? t.extension.dev : t.extension.missing}
      </CardDescription>
    );

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <CardHeader>
          <CardTitle id={labelledBy}>{t.extension.folder}</CardTitle>
          <code className="truncate text-xs text-muted-foreground select-text" title={folder.path}>
            {folder.path}
          </code>
        </CardHeader>
        <Button size="sm" variant="outline" onClick={open}>
          <FolderOpen />
          {t.extension.open}
        </Button>
      </div>
      <ol className="grid list-decimal gap-1 pl-5 text-sm">
        {t.extension.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{t.extension.once}</p>
    </div>
  );
}
