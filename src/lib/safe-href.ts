/** Agent output may only link to OUR routes; anything else (absolute URLs, javascript:, protocol-relative) is dropped. */
const OK = /^\/(?:products\/product_[0-9a-f]{8,40}|shops\/shop_[0-9a-f]{8,40}|sellers|compare|missions(?:\/new|\/start|\/msn_[0-9a-f]{32})?|discover|search|assistant)(?:[?#][^\s"'<>]{0,1500})?$/;
export function safeInternalHref(href: string | null | undefined): string | null {
  if (!href || href.length > 1700 || /[\u0000-\u001f\\]/.test(href) || href.startsWith("//")) return null;
  return OK.test(href) ? href : null;
}
/** external links from evidence (https only; host shown to the user; opened by their click) */
export function safeExternalHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try { const u = new URL(href); return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.toString() : null; } catch { return null; }
}
