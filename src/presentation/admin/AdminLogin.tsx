"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import type { z } from "zod";
import {
  adminSignInSchema,
  adminReturnPath,
  adminPasswordPolicy,
} from "../../domain/admin-auth";
import { adminAuthClient } from "../../infrastructure/admin-auth-client";
import styles from "./AdminLogin.module.css";

/** Renders an accessible password-manager-compatible owner sign-in form. */
export function AdminLogin({ returnTo }: { returnTo: string }) {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof adminSignInSchema>>({
    resolver: zodResolver(adminSignInSchema),
  });
  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit(async (values) => {
        setError("");
        try {
          const result = await adminAuthClient.signIn.email({
            ...values,
            rememberMe: true,
          });
          if (result.error) {
            setError(
              result.error.status === 429
                ? "Слишком много попыток. Подождите минуту и повторите вход."
                : result.error.status >= 500
                  ? "Вход временно недоступен. Попробуйте позже."
                  : "Не удалось войти. Проверьте email и пароль.",
            );
            return;
          }
          window.location.assign(adminReturnPath(returnTo));
        } catch {
          setError(
            "Не удалось связаться с сервером. Проверьте соединение и повторите вход.",
          );
        }
      })}
    >
      <label htmlFor="admin-email">Email владельца</label>
      <input
        id="admin-email"
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={254}
        aria-invalid={Boolean(errors.email)}
        aria-describedby={errors.email ? "admin-email-error" : undefined}
        {...register("email")}
      />
      {errors.email && (
        <span id="admin-email-error" className={styles.error}>
          Введите корректный email.
        </span>
      )}
      <label htmlFor="admin-password">Пароль</label>
      <div className={styles.password}>
        <input
          id="admin-password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          required
          maxLength={adminPasswordPolicy.maxLength}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={
            errors.password ? "admin-password-error" : undefined
          }
          {...register("password")}
        />
        <button
          type="button"
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>
      {errors.password && (
        <span id="admin-password-error" className={styles.error}>
          Введите пароль.
        </span>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button className={styles.submit} type="submit" disabled={isSubmitting}>
        {isSubmitting && <LoaderCircle size={18} className={styles.spinner} />}
        {isSubmitting ? "Проверяем данные…" : "Войти в панель"}
      </button>
      <p className={styles.help}>
        Доступ выдаёт владелец сервера. Для восстановления пароля обратитесь к
        нему.
      </p>
    </form>
  );
}
