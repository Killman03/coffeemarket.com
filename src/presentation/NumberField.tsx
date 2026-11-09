"use client";
import { useFormContext } from "react-hook-form";
import type { CalculatorInput } from "../domain/calculator";
type Props = {
  name: keyof CalculatorInput;
  label: string;
  unit: string;
  hint?: string;
  integer?: boolean;
};

/** Accessible numeric field registered with the shared validated form. */
export function NumberField({
  name,
  label,
  unit,
  hint,
  integer = false,
}: Props) {
  const {
    register,
    formState: { errors },
  } = useFormContext<CalculatorInput>();
  const error = errors[name]?.message;
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <div className={`input-wrap${error ? " invalid" : ""}`}>
        <input
          id={name}
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          min="0"
          step={integer ? "1" : "0.01"}
          {...register(name, { valueAsNumber: true })}
          aria-invalid={Boolean(error)}
          aria-describedby={[
            `${name}-unit`,
            error ? `${name}-error` : hint ? `${name}-hint` : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <span id={`${name}-unit`}>{unit}</span>
      </div>
      {error ? (
        <span className="field-error" id={`${name}-error`}>
          {error}
        </span>
      ) : (
        hint && (
          <span className="field-hint" id={`${name}-hint`}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
