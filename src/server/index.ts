// Public surface of the server-side data layer. Import ONLY from server code (route handlers, scripts):
// it depends on node:sqlite and must never be bundled into client components.
export { DatabaseUnavailableError, getReadDb, closeReadDb, resolveDbPath } from "./db/connect";
export { searchProducts, getProduct, type ProductSummary, type ProductDetail, type SearchResult } from "./repositories/products";
export { listOffersForProduct, type OfferView } from "./repositories/offers";
export { getShop, shopsNear, evaluateDeclaredHours, type NearbyShop } from "./repositories/shops";
export { getFlags, getImportInfo, LIMITS, type FlagView, type ImportInfo } from "./repositories/shared";
