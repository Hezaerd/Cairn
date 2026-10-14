import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
  MIN_PASSWORD_LENGTH,
  type PasswordOptions,
  type PickerRequest,
  type PickerResult,
} from "@cairn/contracts";
import { RefreshCw } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import { Checkbox } from "@cairn/ui/components/checkbox";
import { Label } from "@cairn/ui/components/label";
import { Slider } from "@cairn/ui/components/slider";
import { cn } from "@cairn/ui/lib/utils";
import { t, type Message } from "../popup/i18n";

type CharacterSet = "lowercase" | "uppercase" | "digits" | "symbols";

const characterSets: ReadonlyArray<readonly [CharacterSet, Message]> = [
  ["lowercase", "generatorLowercase"],
  ["uppercase", "generatorUppercase"],
  ["digits", "generatorDigits"],
  ["symbols", "generatorSymbols"],
];

const defaults: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

interface Props {
  readonly host: string;
  readonly maxLength: number;
  readonly send: (request: PickerRequest) => Effect.Effect<PickerResult>;
  /** Whether Chromium has shown the picker long enough to accept a click. */
  readonly trusted: () => boolean;
  /** Shows another state, such as an error, instead of the generator. */
  readonly onResult: (result: PickerResult) => void;
}

/**
 * Generates a password for a sign-up form. The service worker generates it
 * and keeps it, so **Use password** fills what the worker holds, not what
 * this frame sends.
 */
export function Generator({ host, maxLength, send, trusted, onResult }: Props) {
  const [options, setOptions] = useState<PasswordOptions>({
    ...defaults,
    length: Math.min(defaults.length, maxLength),
  });

  const [password, setPassword] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const request = useRef(0);

  function generate(next: PasswordOptions, fresh: boolean) {
    // Only the latest request may show its password.
    const current = ++request.current;

    void Effect.runPromise(send({ type: "Generate", options: next, fresh })).then((result) => {
      if (request.current !== current) return;

      if (result.type === "Generated") {
        setPassword(result.password);
        setOptions(result.options);
      } else onResult(result);
    });
  }

  // Reopening the picker shows the password generated last for this site.
  useEffect(() => generate(options, false), []);

  function change(next: PasswordOptions) {
    setOptions(next);
    setNotice(null);
    generate(next, true);
  }

  function use() {
    if (!trusted() || password === null) return;

    setNotice(null);

    void Effect.runPromise(send({ type: "UseGenerated" })).then((result) => {
      if (result.type === "NoForm") setNotice(t("noSignUpForm"));
      else if (result.type !== "Filled") onResult(result);
    });
  }

  const enabled = characterSets.filter(([set]) => options[set]).length;

  return (
    <section className="grid gap-3 p-2">
      <h2 className="truncate text-xs font-semibold">{t("generatorFor", host)}</h2>
      <output
        aria-label={t("generatorPreview")}
        aria-live="polite"
        className="min-h-13 rounded-md border bg-muted px-2.5 py-2 font-mono text-body/snug wrap-anywhere select-all"
      >
        {password}
      </output>
      <div className="grid gap-2">
        <div className="flex items-center justify-between text-xs">
          <span>{t("generatorLength")}</span>
          <span className="tabular-nums">{options.length}</span>
        </div>
        <Slider
          thumbLabel={t("generatorLength")}
          min={MIN_PASSWORD_LENGTH}
          max={maxLength}
          step={1}
          value={[options.length]}
          onValueChange={([length]) => {
            if (length !== undefined) change({ ...options, length });
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {characterSets.map(([set, label]) => (
          <Option
            key={set}
            id={`generator-${set}`}
            label={t(label)}
            checked={options[set]}
            // At least one set stays on; the generator refuses an empty selection anyway.
            disabled={options[set] && enabled === 1}
            onChange={(checked) => change({ ...options, [set]: checked })}
          />
        ))}
        <Option
          id="generator-avoid-ambiguous"
          className="col-span-2"
          label={t("generatorAvoidAmbiguous")}
          checked={options.avoidAmbiguous}
          onChange={(avoidAmbiguous) => change({ ...options, avoidAmbiguous })}
        />
      </div>
      {notice && (
        <p className="text-xs text-destructive" role="alert">
          {notice}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => generate(options, true)}>
          <RefreshCw />
          {t("generatorRegenerate")}
        </Button>
        <Button size="sm" disabled={password === null} onClick={use}>
          {t("generatorUse")}
        </Button>
      </div>
    </section>
  );
}

function Option({
  id,
  label,
  checked,
  disabled,
  className,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
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
