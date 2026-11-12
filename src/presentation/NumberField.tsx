"use client";
import styles from "./Calculator.module.css";
import { useId } from "react";
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
  const id = useId();
  const error = errors[name]?.message;
  return (
    <div className={styles["field"]}>
      <label htmlFor={id}>{label}</label>
      <div
        className={[styles["input-wrap"], error ? styles.invalid : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <input
          id={id}
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          min="0"
          step={integer ? "1" : "any"}
          {...register(name, { valueAsNumber: true })}
          aria-invalid={Boolean(error)}
          aria-describedby={[
            `${id}-unit`,
            error ? `${id}-error` : hint ? `${id}-hint` : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <span id={`${id}-unit`}>{unit}</span>
      </div>
      {error ? (
        <span className={styles["field-error"]} id={`${id}-error`}>
          {error}
        </span>
      ) : (
        hint && (
          <span className={styles["field-hint"]} id={`${id}-hint`}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
