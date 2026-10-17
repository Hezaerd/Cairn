import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Effect } from "effect";
import { Card, CardDescription, CardHeader, CardTitle } from "@cairn/ui/components/card";
import { Checkbox } from "@cairn/ui/components/checkbox";
import { useT } from "../i18n/I18nProvider";
import { setStartup, startupStatus, type StartupStatus } from "./startup";

/** Reads the setting each time, since Task Manager can turn the entry off too. */
export function StartupSetting() {
  const t = useT();
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    void Effect.runPromise(
      startupStatus.pipe(Effect.match({ onSuccess: setStatus, onFailure: () => setFailed(true) })),
    );
  }, []);

  function toggle(enabled: boolean) {
    if (!status) return;

    setFailed(false);
    void Effect.runPromise(
      setStartup(enabled).pipe(
        Effect.match({
          onSuccess: () => setStatus({ ...status, enabled }),
          onFailure: () => setFailed(true),
        }),
      ),
    );
  }

  function describe() {
    if (failed) return t.startup.failed;

    if (status && !status.available) return t.startup.disabled;

    return t.startup.hint;
  }

  return (
    <Card layout="row">
      <CardHeader>
        <CardTitle id="startup">{t.startup.title}</CardTitle>
        <CardDescription id="startup-hint" role="status">
          {describe()}
        </CardDescription>
      </CardHeader>
      <Checkbox
        aria-labelledby="startup"
        aria-describedby="startup-hint"
        checked={status?.enabled ?? false}
        disabled={!status?.available}
        onCheckedChange={(checked) => toggle(checked === true)}
      />
    </Card>
  );
}
