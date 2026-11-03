import type { HTMLAttributes } from "react";

/**
 * Graphite card: square corners and a 2px rail on top (the panels of the character sheet add the
 * 45° cut; a generic card does not clip, so menus and outlines inside it are never cut off).
 */
export function Card({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`border-t-2 border-line-2 bg-surface p-[22px] ${className}`}
      {...rest}
    />
  );
}
