import type { DatabaseSync } from "node:sqlite";
import { DatabaseUnavailableError, getReadDb } from "./connect";

/** For Server Components: a missing database renders an honest "data unavailable" state instead of a crash. */
export function getReadDbOrNull(): DatabaseSync | null {
  try {
    return getReadDb();
  } catch (e) {
    if (e instanceof DatabaseUnavailableError) return null;
    throw e;
  }
}
