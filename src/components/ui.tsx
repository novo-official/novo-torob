import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonStyles = cva(
  "ui-button inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-2 text-[0.95rem] font-semibold disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-ink shadow-sm hover:bg-brand-hover",
        secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
        ghost: "text-brand hover:bg-brand-soft",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

type ButtonVariant = VariantProps<typeof buttonStyles>;

export function Button({ variant, className, type = "button", ...props }: ComponentProps<"button"> & ButtonVariant) {
  return <button type={type} className={cn(buttonStyles({ variant }), className)} {...props} />;
}

export function ButtonLink({ variant, className, ...props }: ComponentProps<typeof Link> & ButtonVariant) {
  return <Link className={cn(buttonStyles({ variant }), className)} {...props} />;
}

export function Chip({
  selected,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
        selected ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]", className)} {...props} />;
}

const badgeStyles = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      neutral: "bg-surface-2 text-ink-2",
      brand: "bg-brand-soft text-brand-soft-ink",
      warn: "bg-warn-bg text-warn-ink",
      ok: "bg-ok-bg text-ok-ink",
      danger: "bg-danger-bg text-danger-ink",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}

/** Isolates Latin model names / numbers inside RTL text so they never reorder surrounding words. */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("font-mono text-[0.92em]", className)}>
      {children}
    </bdi>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-10 text-center">
      <div aria-hidden className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand-soft-ink">
        {icon}
      </div>
      <h2 className="text-lg font-bold">{title}</h2>
      {children ? <div className="max-w-prose text-sm leading-7 text-ink-2">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-7 space-y-3">
      {eyebrow ? <p className="text-xs font-bold leading-6 text-brand sm:text-sm">{eyebrow}</p> : null}
      <h1 className="text-balance text-2xl font-extrabold leading-[1.55] sm:text-3xl">{title}</h1>
      {children ? <p className="max-w-prose text-[0.95rem] leading-8 text-ink-2">{children}</p> : null}
    </header>
  );
}

export const inputStyles =
  "ui-input min-h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink placeholder:text-ink-2 disabled:cursor-not-allowed disabled:opacity-60";
