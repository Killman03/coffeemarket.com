import data from "./catalog.snapshot.json";
import { catalogSchema, type CatalogRepository } from "../domain/catalog";

/** Validates the public catalog snapshot at the data adapter boundary. */
export class SnapshotCatalogRepository implements CatalogRepository {
  getCatalog() {
    return catalogSchema.parse(data);
  }
}

export const catalogRepository: CatalogRepository =
  new SnapshotCatalogRepository();
