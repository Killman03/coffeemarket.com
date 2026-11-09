import { ArrowRight, Coffee, ExternalLink } from "lucide-react";
import { Calculator } from "./Calculator";
import type { Catalog } from "../domain/catalog";
import styles from "./StorefrontPreview.module.css";

/** Shows store context separately from the embeddable calculator.
 *
 * Args:
 *   catalog: Public product data supplied by the composition root.
 *
 * Returns:
 *   A standalone preview page. Host pages import Calculator directly.
 */
export function StorefrontPreview({ catalog }: { catalog: Catalog }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="https://coffeemarket.kg/">
            COFFEEMARKET.KG<span>КОФЕ · ОБОРУДОВАНИЕ · ПОДДЕРЖКА</span>
          </a>
          <nav aria-label="Магазин Coffee Market">
            <a href="https://coffeemarket.kg/catalog/?category=coffee">Кофе</a>
            <a href="https://coffeemarket.kg/rent/">Аренда</a>
            <a href="https://coffeemarket.kg/support/">
              Поддержка <ExternalLink size={12} />
            </a>
          </nav>
        </div>
      </header>
      <main className={styles.main}>
        <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
          <a href="https://coffeemarket.kg/">Главная</a>
          <span>/</span>
          <span aria-current="page">Калькулятор кофе</span>
        </nav>
        <Calculator catalog={catalog} />
        <section className={styles.nextStep}>
          <div className={styles.nextIcon}>
            <Coffee size={25} />
          </div>
          <div>
            <h2>От хорошего расчёта — к хорошему кофе</h2>
            <p>Подберите кофе и оборудование под задачи вашего бизнеса.</p>
          </div>
          <a href="https://coffeemarket.kg/catalog/?category=coffee">
            Выбрать кофе <ArrowRight size={16} />
          </a>
        </section>
        <footer className={styles.footer}>
          <span>© CoffeeMarket.kg</span>
          <a href="https://coffeemarket.kg/contact/">
            Помощь с выбором оборудования <ArrowRight size={13} />
          </a>
        </footer>
      </main>
    </div>
  );
}
