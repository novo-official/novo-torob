"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Global provider: honours the OS "reduce motion" setting for every Motion animation. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
