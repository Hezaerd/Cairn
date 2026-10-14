import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Effect } from "effect";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import { Separator } from "@cairn/ui/components/separator";
import { CardDescription, CardHeader, CardTitle } from "@cairn/ui/components/card";
import {
  ChoiceCard,
  ChoiceCardDescription,
  ChoiceCardTitle,
} from "@cairn/ui/components/choice-card";
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
        <CardTitle id={labelledBy}>{t.update.channel}</CardTitle>
        <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-3">
          {channels.map((channel) => (
            <ChoiceCard
              key={channel}
              aria-pressed={status?.channel === channel}
              disabled={!status || busy}
              onClick={() => choose(channel)}
            >
              <ChoiceCardTitle>{t.update[channel]}</ChoiceCardTitle>
              <ChoiceCardDescription>{t.update.hints[channel]}</ChoiceCardDescription>
            </ChoiceCard>
          ))}
        </div>
        {leavingNightly && <CardDescription>{t.update.leaveNightly}</CardDescription>}
      </div>
      <Separator />
      <div className="flex items-center justify-between gap-3">
        <CardHeader>
          <CardTitle>{status && t.update.current(status.version)}</CardTitle>
          <CardDescription role="status">{status && describe(status, check)}</CardDescription>
        </CardHeader>
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
