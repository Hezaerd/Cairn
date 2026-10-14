import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Effect } from "effect";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useT } from "../i18n/I18nProvider";
import {
  checkForUpdate,
  installUpdate,
  setUpdateChannel,
  updateStatus,
  type UpdateChannel,
  type UpdateError,
  type UpdateStatus,
} from "./updates";

const channels = ["stable", "nightly"] as const satisfies ReadonlyArray<UpdateChannel>;

type Check =
  | {
      readonly state:
        | "idle"
        | "checking"
        | "upToDate"
        | "installing"
        | "unreachable"
        | "notSaved"
        | "failed";
    }
  | { readonly state: "available"; readonly version: string };

function run<A>(
  effect: Effect.Effect<A, UpdateError>,
  done: (value: A) => void,
  failed: () => void,
) {
  void Effect.runPromise(effect.pipe(Effect.match({ onSuccess: done, onFailure: failed })));
}

export function UpdateSettings({ labelledBy }: { labelledBy: string }) {
  const t = useT();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle" });

  useEffect(() => {
    if (!isTauri()) return;

    run(
      updateStatus,
      (next) => {
        setStatus(next);

        if (next.available) setCheck({ state: "available", version: next.available });
      },
      () => setCheck({ state: "unreachable" }),
    );
  }, []);

  function look() {
    setCheck({ state: "checking" });
    run(
      checkForUpdate,
      (version) => setCheck(version ? { state: "available", version } : { state: "upToDate" }),
      () => setCheck({ state: "unreachable" }),
    );
  }

  function choose(channel: UpdateChannel) {
    if (!status || channel === status.channel) return;

    setCheck({ state: "checking" });
    run(
      setUpdateChannel(channel),
      () => {
        setStatus({ ...status, channel, available: null });

        if (status.enabled) look();
        else setCheck({ state: "idle" });
      },
      () => setCheck({ state: "notSaved" }),
    );
  }

  function install() {
    setCheck({ state: "installing" });
    // On success the installer closes Cairn, so only a failure comes back.
    run(
      installUpdate,
      () => {},
      () => setCheck({ state: "failed" }),
    );
  }

  function describe(status: UpdateStatus, check: Check) {
    if (!status.enabled) return t.update.disabled;

    switch (check.state) {
      case "idle":
        return "";
      case "checking":
        return t.update.checking;
      case "upToDate":
        return t.update.upToDate;
      case "available":
        return t.update.available(check.version);
      case "installing":
        return t.update.downloading;
      case "unreachable":
        return t.update.unreachable;
      case "notSaved":
        return t.update.notSaved;
      case "failed":
        return t.update.failed;
    }
  }

  const busy = check.state === "checking" || check.state === "installing";
  // Updates never go back in version, so leaving nightly waits for a newer stable release.
  const leavingNightly = status?.channel === "stable" && status.version.includes("-");

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <h3 id={labelledBy} className="text-sm">
          {t.update.channel}
        </h3>
        <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-3">
          {channels.map((channel) => {
            const active = status?.channel === channel;

            return (
              <button
                key={channel}
                type="button"
                aria-pressed={active}
                disabled={!status || busy}
                className={cn(
                  "grid content-start gap-1 rounded-xl border p-3 text-left transition-colors disabled:cursor-default",
                  active ? "border-ring bg-selection/60" : "hover:bg-accent/60",
                )}
                style={active ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
                onClick={() => choose(channel)}
              >
                <span
                  className={cn(
                    "text-sm",
                    active ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t.update[channel]}
                </span>
                <span className="text-xs text-muted-foreground">{t.update.hints[channel]}</span>
              </button>
            );
          })}
        </div>
        {leavingNightly && <p className="text-xs text-muted-foreground">{t.update.leaveNightly}</p>}
      </div>
      <Separator />
      <div className="flex items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-sm font-medium">{status && t.update.current(status.version)}</span>
          <span role="status" className="text-xs text-muted-foreground">
            {status && describe(status, check)}
          </span>
        </div>
        {check.state === "available" || check.state === "installing" ? (
          <Button size="sm" disabled={busy} onClick={install}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            {t.update.install}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!status?.enabled || busy} onClick={look}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t.update.check}
          </Button>
        )}
      </div>
    </div>
  );
}
