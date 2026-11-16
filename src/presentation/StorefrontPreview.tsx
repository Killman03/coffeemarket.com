import { ArrowRight, Coffee, ExternalLink } from "lucide-react";
import { Calculator } from "./Calculator";
import type { Catalog } from "../domain/catalog";
import type { PublicSettings } from "../domain/site-settings";
import styles from "./StorefrontPreview.module.css";

/** Shows store context separately from the embeddable calculator.
 *
 * Args:
 *   catalog: Public product data supplied by the composition root.
 *   settings: Optional public defaults and text from the site's settings.
 *
 * Returns:
 *   A standalone preview page. Host pages import Calculator directly.
 */
export function StorefrontPreview({
  catalog,
  settings,
}: {
  catalog: Catalog;
  settings?: PublicSettings;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="https://coffeemarket.kg/">
            COFFEE MARKET<span>ЭКОНОМИКА ВАШЕГО КОФЕЙНОГО БИЗНЕСА</span>
          </a>
          <nav aria-label="Навигация калькулятора">
            <a href="#calculator">Калькулятор</a>
            <a href="#pnl">P&amp;L на 3 месяца</a>
            <a href="https://coffeemarket.kg/">
              Coffee Market <ExternalLink size={12} />
            </a>
          </nav>
        </div>
      </header>
      <main className={styles.main}>
        <div id="calculator">
          <Calculator catalog={catalog} pnlAnchorId="pnl" settings={settings} />
        </div>
        <section className={styles.nextStep}>
          <div className={styles.nextIcon}>
            <Coffee size={25} />
          </div>
          <div>
            <h2>От хорошего расчёта — к хорошему кофе</h2>
            <p>
              Кофе и оборудование Coffee Market — для бизнеса в Кыргызстане.
            </p>
          </div>
          <a href="https://coffeemarket.kg/catalog/?category=coffee">
            Выбрать кофе <ArrowRight size={16} />
          </a>
        </section>
        <footer className={styles.footer}>
          <span>© Coffee Market · Бесплатный калькулятор</span>
          <a href="https://coffeemarket.kg/contact/">
            Помощь с выбором оборудования <ArrowRight size={13} />
          </a>
          <a href="/admin">Управление сайтом</a>
        </footer>
      </main>
    </div>
  );
}
