import { useRef, useState } from "react";
import { Effect } from "effect";
import { RefreshCw, WandSparkles } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import { Checkbox } from "@cairn/ui/components/checkbox";
import { Label } from "@cairn/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@cairn/ui/components/popover";
import { Slider } from "@cairn/ui/components/slider";
import { VaultClient, type ErrorCode, type PasswordOptions } from "../vault/VaultClient";
import { useRuntime } from "../vault/useVault";
import { useT } from "../i18n/I18nProvider";
import { setPasswordOptions, usePreferences } from "../store/preferences";

type CharacterSet = "lowercase" | "uppercase" | "digits" | "symbols";

const characterSets: ReadonlyArray<CharacterSet> = ["lowercase", "uppercase", "digits", "symbols"];

/** Generates a password in Rust and hands it to `onUse`. Nothing is kept once it closes. */
export function PasswordGenerator({ onUse }: { onUse: (password: string) => void }) {
  const t = useT();
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const options = usePreferences((state) => state.passwordOptions);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const request = useRef(0);

  function generate(next: PasswordOptions) {
    // Only the latest request may show its password, so a slow answer can't replace a newer one.
    const current = ++request.current;

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const vault = yield* VaultClient;

          return yield* vault.generate(next);
        }).pipe(
          Effect.match({
            onSuccess: (value) => {
              if (request.current !== current) return;
              setPassword(value);
              setError(null);
            },
            onFailure: (failure) => {
              if (request.current !== current) return;
              setPassword(null);
              setError(failure.code);
            },
          }),
        ),
      )
      .catch(() => {
        if (request.current === current) setError("Unavailable");
      });
  }

  function change(next: PasswordOptions) {
    setPasswordOptions(next);
    generate(next);
  }

  function toggle(isOpen: boolean) {
    setOpen(isOpen);
    request.current++;
    setPassword(null);
    setError(null);

    if (isOpen) generate(options);
  }

  const enabled = characterSets.filter((set) => options[set]);

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8.5 shrink-0"
          aria-label={t.generator.open}
          title={t.generator.open}
        >
          <WandSparkles />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <h3 className="text-xs font-semibold">{t.generator.title}</h3>
        <output
          aria-label={t.generator.preview}
          aria-live="polite"
          className="min-h-13 rounded-md border bg-muted px-2.5 py-2 font-mono text-body/snug wrap-anywhere"
        >
          {error ? (
            <span className="font-sans text-xs text-destructive">{t.errors[error]}</span>
          ) : (
            password
          )}
        </output>
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs">
            <span>{t.generator.length}</span>
            <span className="tabular-nums">{options.length}</span>
          </div>
          <Slider
            thumbLabel={t.generator.length}
            min={8}
            max={128}
            step={1}
            value={[options.length]}
            onValueChange={([length]) => {
              if (length !== undefined) change({ ...options, length });
            }}
          />
        </div>
        <div className="grid gap-2">
          {characterSets.map((set) => (
            <GeneratorOption
              key={set}
              id={`generator-${set}`}
              label={t.generator[set]}
              checked={options[set]}
              // At least one set stays on; Rust refuses an empty selection anyway.
              disabled={options[set] && enabled.length === 1}
              onChange={(checked) => change({ ...options, [set]: checked })}
            />
          ))}
          <GeneratorOption
            id="generator-avoid-ambiguous"
            label={t.generator.avoidAmbiguous}
            checked={options.avoidAmbiguous}
            onChange={(avoidAmbiguous) => change({ ...options, avoidAmbiguous })}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => generate(options)}>
            <RefreshCw />
            {t.generator.regenerate}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={password === null}
            onClick={() => {
              if (password === null) return;
              onUse(password);
              toggle(false);
            }}
          >
            {t.generator.use}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GeneratorOption({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(state) => onChange(state === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
