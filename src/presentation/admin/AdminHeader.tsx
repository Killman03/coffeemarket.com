import { Coffee, LogOut, ChartNoAxesCombined, Settings2 } from "lucide-react";
import styles from "./AdminHeader.module.css";

/** Shares owner identity and navigation across protected administration pages.
 *
 * Args:
 *   userDisplayName: Server-authenticated name, rendered as plain text.
 *   active: Current protected section.
 *
 * Returns:
 *   Accessible navigation with a standard top-level sign-out link.
 */
export function AdminHeader({
  userDisplayName,
  active,
}: {
  userDisplayName: string;
  active: "settings" | "analytics";
}) {
  return (
    <header className={styles.header}>
      <a className={styles.brand} href="/">
        <Coffee size={24} />
        <span>
          COFFEE MARKET<small>Панель управления</small>
        </span>
      </a>
      <nav aria-label="Управление сайтом">
        <a
          href="/admin"
          aria-current={active === "settings" ? "page" : undefined}
        >
          <Settings2 size={16} />
          Настройки
        </a>
        <a
          href="/admin/analytics"
          aria-current={active === "analytics" ? "page" : undefined}
        >
          <ChartNoAxesCombined size={17} />
          Аналитика
        </a>
      </nav>
      <div className={styles.account}>
        <span>{userDisplayName}</span>
        <a
          href="/signout-with-chatgpt?return_to=%2Fadmin"
          target="_top"
          aria-label="Выйти из аккаунта"
        >
          <LogOut size={17} />
          <span>Выйти</span>
        </a>
      </div>
    </header>
  );
}
