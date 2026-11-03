import type { ComponentPropsWithRef } from "react";

export type ButtonVariant = "primary" | "ghost";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant: ButtonVariant;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border-acc bg-acc text-acc-ink tk-cut-b hover:border-acc hover:brightness-[1.08]",
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
      className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 border px-[18px] text-[13.5px] font-extrabold font-stretch-[80%] tracking-[0.06em] uppercase transition-[filter,border-color] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
