import Link from "next/link";
import type { ReactNode } from "react";

const BASE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[2px] border px-[18px] font-mono text-xs font-bold tracking-[0.1em] uppercase";

const VARIANT = {
  primary: "border-acc bg-acc text-bg hover:brightness-[1.08]",
  ghost: "border-line-2 bg-transparent text-text hover:border-text",
} as const;

/** Same look as `Button`, but a link (the primitive only renders <button>). */
export function LinkButton({
  href,
  variant,
  children,
}: {
  href: string;
  variant: keyof typeof VARIANT;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BASE} ${VARIANT[variant]}`}>
      {children}
    </Link>
  );
}
