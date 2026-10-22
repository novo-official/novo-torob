/**
 * Contract-level error codes shared by all future tools (design only in Phase 1).
 * Every tool returns `Result<T>`; no tool throws for expected conditions.
 */
export const TOOL_ERROR_CODES = [
  "NOT_CONNECTED", // data source not wired yet (Phase 1 default)
  "INVALID_INPUT",
  "NOT_FOUND",
  "AMBIGUOUS_QUERY", // needs clarifying question(s)
  "NO_RESULTS",
  "VARIANT_MISMATCH", // offer does not match chosen variant
  "UNIT_MISMATCH", // incomparable price units (piece / metre / roll)
  "OUT_OF_COVERAGE",
  "NO_VERIFIED_CHANNEL", // no verified contact channel exists
  "LOCATION_DENIED",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export interface ToolError {
  code: ToolErrorCode;
  /** Persian, user-presentable explanation. */
  message: string;
  /** Machine-readable detail for tests / logs. Never contains precise coordinates. */
  detail?: Record<string, string | number | boolean | null>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(code: ToolErrorCode, message: string, detail?: ToolError["detail"]): Result<T> => ({
  ok: false,
  error: { code, message, detail },
});
