import { TILE_CONFIG, tileImgSources } from "./map-config";

/**
 * Per-request Content-Security-Policy (Phase 9.1). Scripts are allowed ONLY with the request's nonce (+ `strict-dynamic` for the chunks Next loads);
 * there is no `'unsafe-inline'` / `'unsafe-eval'` for scripts in production. Styles keep `'unsafe-inline'`: React/Leaflet set inline style attributes and the risk of
 * style injection is far lower than script injection (documented residual risk). Map tiles come ONLY from the configured provider (map-config.ts).
 */
export function buildCsp(nonce: string, isDev: boolean, strictStyles = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // default: inline styles allowed (measured on Chromium only). CSP_STRICT_STYLES=1 → <style> elements need the nonce, only style ATTRIBUTES stay inline (Leaflet positioning).
    // The strict variant passed the full Chromium suite (docs/phase-10a-release-gate.md); it is NOT measured on Firefox/WebKit, and engines without
    // style-src-attr support would drop inline style attributes — hence opt-in.
    ...(strictStyles ? [`style-src 'self' 'nonce-${nonce}'`, "style-src-attr 'unsafe-inline'"] : ["style-src 'self' 'unsafe-inline'"]),
    ["img-src 'self' data: blob: https://image.torob.com", ...tileImgSources(TILE_CONFIG)].join(" "),
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export const newNonce = (): string => Buffer.from(crypto.randomUUID()).toString("base64");
