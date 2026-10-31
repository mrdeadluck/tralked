import type { ReactNode, SVGProps } from "react";
import type { AttributeId } from "@/lib/engine/attributes";

const PATHS: Record<AttributeId, ReactNode> = {
  vigor: <path d="M2 12h5l2-5 4 10 2-5h7" />,
  precisao: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  gloria: <path d="M3 19h18M4 16 3 7l5 4 4-7 4 7 5-4-1 9z" />,
  colecao: (
    <>
      <rect x="3" y="3" width="18" height="5" />
      <rect x="3" y="10" width="18" height="5" />
      <path d="M3 17h18v4H3z" />
    </>
  ),
  exploracao: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  constancia: (
    <>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 3v4M16 3v4M8 15h3" />
    </>
  ),
  sabedoria: (
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
  ),
};

type AttributeIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { name: AttributeId };

/** Decorative line icons for the attributes, drawn like SkillIcon (the label sits next to them). */
export function AttributeIcon({ name, ...rest }: AttributeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
