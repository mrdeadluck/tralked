import type { HTMLAttributes } from "react";

export function Card({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[4px] border border-line bg-surface p-[22px] ${className}`}
      {...rest}
    />
  );
}
