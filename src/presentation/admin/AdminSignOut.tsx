"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { adminAuthClient } from "../../infrastructure/admin-auth-client";
import styles from "./AdminSignOut.module.css";

/** Revokes the server session through a same-origin POST, with retry on failure. */
export function AdminSignOut() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.root}>
      <button
        type="button"
        disabled={busy}
        aria-label="Выйти из аккаунта"
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            const result = await adminAuthClient.signOut();
            if (result.error) throw new Error("Sign out failed");
            window.location.assign("/admin");
          } catch {
            setFailed(true);
            setBusy(false);
          }
        }}
      >
        <LogOut size={17} />
        <span>{busy ? "Выходим…" : "Выйти"}</span>
      </button>
      {failed && <span role="alert">Не удалось выйти. Повторите попытку.</span>}
    </div>
  );
}
