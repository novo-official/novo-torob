"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Product photo from the dataset's image host (https://image.torob.com only — enforced server-side).
 * Loading it contacts that host; no referrer is sent. Falls back to an icon when absent or failing.
 */
export function ProductImage({ src, alt = "", className }: { src: string | null; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div aria-hidden className={cn("grid place-items-center rounded-xl bg-surface-2 text-ink-2", className)}>
        <ImageOff size={22} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external CDN, intentionally not proxied through next/image
    <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn("rounded-xl bg-surface-2 object-contain", className)} />
  );
}
