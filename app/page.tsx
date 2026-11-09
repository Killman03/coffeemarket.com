import { Calculator } from "../src/presentation/Calculator";
import { catalogRepository } from "../src/infrastructure/catalog-repository";

export default function Home() {
  return <Calculator catalog={catalogRepository.getCatalog()} />;
}
