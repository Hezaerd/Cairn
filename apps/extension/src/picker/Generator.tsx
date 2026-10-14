import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
  MIN_PASSWORD_LENGTH,
  type PasswordOptions,
  type PickerRequest,
  type PickerResult,
} from "@cairn/contracts";
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
    <section className="generator">
      <h2>{t("generatorFor", host)}</h2>
      <output className="password" aria-label={t("generatorPreview")} aria-live="polite">
        {password}
      </output>
      <label className="length">
        <span>
          {t("generatorLength")} <strong>{options.length}</strong>
        </span>
        <input
          type="range"
          min={MIN_PASSWORD_LENGTH}
          max={maxLength}
          value={options.length}
          onChange={(event) => change({ ...options, length: Number(event.target.value) })}
        />
      </label>
      <div className="sets">
        {characterSets.map(([set, label]) => (
          <label key={set}>
            <input
              type="checkbox"
              checked={options[set]}
              // At least one set stays on; the generator refuses an empty selection anyway.
              disabled={options[set] && enabled === 1}
              onChange={(event) => change({ ...options, [set]: event.target.checked })}
            />
            {t(label)}
          </label>
        ))}
        <label className="wide">
          <input
            type="checkbox"
            checked={options.avoidAmbiguous}
            onChange={(event) => change({ ...options, avoidAmbiguous: event.target.checked })}
          />
          {t("generatorAvoidAmbiguous")}
        </label>
      </div>
      {notice && (
        <p className="detail" role="alert">
          {notice}
        </p>
      )}
      <div className="actions">
        <button className="secondary" onClick={() => generate(options, true)}>
          {t("generatorRegenerate")}
        </button>
        <button disabled={password === null} onClick={use}>
          {t("generatorUse")}
        </button>
      </div>
    </section>
  );
}
