import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: ButtonVariant;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border-acc bg-acc text-bg hover:border-acc hover:brightness-[1.08]",
  ghost: "border-line-2 bg-transparent text-text hover:border-text",
};

export function Button({
  variant,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[2px] border px-[18px] font-mono text-xs font-bold tracking-[0.1em] uppercase disabled:cursor-not-allowed disabled:opacity-45 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
