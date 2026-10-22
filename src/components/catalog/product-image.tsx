"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Product photo from the dataset's image host (https://image.torob.com only — enforced server-side).
 * Loading it contacts that host; no referrer is sent. Falls back to an icon when absent or failing.
 */
export function ProductImage({ src, alt = "", className }: { src: string | null; alt?: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div role={alt ? "img" : undefined} aria-label={alt ? `${alt}؛ تصویر در دسترس نیست` : undefined} aria-hidden={!alt || undefined} className={cn("flex flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 p-2 text-center text-ink-2", className)}>
        <ImageOff size={22} strokeWidth={1.5} />
        <span className="text-[0.625rem] leading-4">بدون تصویر</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external CDN, intentionally not proxied through next/image
    <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} className={cn("rounded-xl bg-surface-2 object-contain", className)} />
  );
}
