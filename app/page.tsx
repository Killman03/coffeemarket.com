import { StorefrontPreview } from "../src/presentation/StorefrontPreview";
import { catalogRepository } from "../src/infrastructure/catalog-repository";
import { getSiteSettings } from "../src/server/runtime";
import { toPublicSettings } from "../src/domain/site-settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <StorefrontPreview
      catalog={catalogRepository.getCatalog()}
      settings={toPublicSettings(await getSiteSettings())}
    />
  );
}
