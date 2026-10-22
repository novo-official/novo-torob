import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Entrance animation in pure CSS: content is part of the server HTML and is never stuck at
 * opacity 0 waiting for JavaScript. Disabled globally under prefers-reduced-motion (globals.css).
 */
export function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={cn("rise", className)} style={{ ["--rise-delay" as string]: `${delay}s` }}>
      {children}
    </div>
  );
}
