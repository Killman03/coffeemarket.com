import { createRoot } from "react-dom/client";
import { Calculator } from "../presentation/Calculator";
import { catalogSchema } from "../domain/catalog";
import { catalogRepository } from "../infrastructure/catalog-repository";
import { publicSettingsSchema } from "../domain/site-settings";

export type MountOptions = {
  catalog?: unknown;
  showIntro?: boolean;
  headingLevel?: 1 | 2;
  settings?: unknown;
};

let instanceCount = 0;

/** Mounts the same calculator into a regular HTML template.
 *
 * Args:
 *   element: Empty host element controlled by the calling page.
 *   options: Optional public catalog, settings and heading presentation.
 *
 * Returns:
 *   A cleanup function for page navigation or removal of the host element.
 */
export function mountCoffeeCalculator(
  element: HTMLElement,
  options: MountOptions = {},
) {
  const catalog =
    options.catalog === undefined
      ? catalogRepository.getCatalog()
      : catalogSchema.parse(options.catalog);
  const settings =
    options.settings === undefined
      ? undefined
      : publicSettingsSchema.parse(options.settings);
  const root = createRoot(element, {
    identifierPrefix: `cmc-widget-${++instanceCount}-`,
  });
  root.render(
    <Calculator
      catalog={catalog}
      showIntro={options.showIntro}
      headingLevel={options.headingLevel ?? 2}
      settings={settings}
    />,
  );
  return () => root.unmount();
}
