"use client";

import { useState } from "react";
import { Coffee, ShieldCheck, ArrowLeft, LockKeyhole } from "lucide-react";
import type { AdminAccess } from "../server/admin";
import styles from "./AdminEntry.module.css";
import { AdminLogin } from "./admin/AdminLogin";
import { AdminSignOut } from "./admin/AdminSignOut";

/** Presents authentication and the explicit one-time owner activation. */
export function AdminEntry({
  access,
  signInPath,
  signOutPath,
  authMode = "sites",
  returnTo = "/admin",
}: {
  access: Exclude<AdminAccess, "authorized">;
  signInPath: string;
  signOutPath: string;
  authMode?: "sites" | "password";
  returnTo?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function activate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/claim", {
        method: "POST",
        headers: { "X-CoffeeMarket-Admin": "1" },
      });
      if (!response.ok)
        throw new Error(
          "Не удалось открыть панель. Обновите страницу и попробуйте снова.",
        );
      window.location.reload();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось открыть панель.",
      );
      setBusy(false);
    }
  }
  const title = {
    anonymous: "Управление вашим калькулятором",
    bootstrap: "Подтвердите владельца сайта",
    forbidden: "Доступ только владельцу",
    unconfigured: "Панель временно недоступна",
  }[access];
  return (
    <main className={styles.page}>
      <a className={styles.brand} href="/">
        <Coffee size={22} />
        COFFEE MARKET
      </a>
      <section className={styles.card}>
        <div className={styles.icon}>
          <LockKeyhole size={28} />
        </div>
        <p className={styles.eyebrow}>ПАНЕЛЬ УПРАВЛЕНИЯ</p>
        <h1>{title}</h1>
        {access === "anonymous" &&
          (authMode === "password" ? (
            <>
              <p>
                Войдите под аккаунтом владельца, чтобы менять настройки и
                смотреть аналитику.
              </p>
              <AdminLogin returnTo={returnTo} />
            </>
          ) : (
            <>
              <p>
                Войдите через ChatGPT под аккаунтом владельца этого сайта. Здесь
                вы сможете менять Telegram, стартовые значения и тексты.
              </p>
              <a className={styles.primary} href={signInPath} target="_top">
                Войти через ChatGPT
              </a>
            </>
          ))}
        {access === "bootstrap" && (
          <>
            <p>
              Ваш аккаунт подтверждён. При первом входе панель будет закреплена
              за ним. После этого управлять настройками сможет только этот
              аккаунт.
            </p>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={activate}
            >
              {busy ? "Открываем панель…" : "Открыть панель управления"}
            </button>
          </>
        )}
        {access === "forbidden" && (
          <>
            <p>
              Этот аккаунт не имеет прав на изменение настроек Coffee Market.
              Войдите под аккаунтом владельца сайта.
            </p>
            {authMode === "password" ? (
              <AdminSignOut />
            ) : (
              <a className={styles.primary} href={signOutPath} target="_top">
                Выйти и сменить аккаунт
              </a>
            )}
          </>
        )}
        {access === "unconfigured" && (
          <p>
            Сервис настроек сейчас недоступен. Попробуйте позже или проверьте
            конфигурацию сервера.
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.safe}>
          <ShieldCheck size={17} />
          Настройки защищены серверной проверкой доступа
        </div>
      </section>
      <a className={styles.back} href="/">
        <ArrowLeft size={16} />
        Вернуться к калькулятору
      </a>
    </main>
  );
}
