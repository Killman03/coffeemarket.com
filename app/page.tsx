import { StorefrontPreview } from "../src/presentation/StorefrontPreview";
import { catalogRepository } from "../src/infrastructure/catalog-repository";

export default function Home() {
  return <StorefrontPreview catalog={catalogRepository.getCatalog()} />;
}
