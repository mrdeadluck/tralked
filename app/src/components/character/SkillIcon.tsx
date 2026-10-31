import type { ReactNode, SVGProps } from "react";

const PATHS: Record<string, ReactNode> = {
  fps: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </>
  ),
  horror: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  soulslike: <path d="M19 3l-9 9M14 3h5v5M7 13l4 4M5 19l3-3M4 15l5 5" />,
  rpg: <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" />,
  roguelike: (
    <>
      <rect x="3" y="3" width="18" height="18" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="16" cy="16" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  plataforma: <path d="M3 20h5v-5h5v-5h5V5h3" />,
  estrategia: <path d="M5 21V3M5 4h12l-3 4 3 4H5" />,
  simulacao: (
    <path d="M12 21v-9M12 12C12 7 8 5 4 5c0 5 3 7 8 7zM12 14c0-4 3-6 8-6 0 4-3 6-8 6z" />
  ),
  puzzle: (
    <>
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" />
      <rect x="3" y="13" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
    </>
  ),
  coop: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2 20c0-3.5 3-6 6-6s6 2.5 6 6M14 15c1-1 2-1.5 3-1.5 2.5 0 5 2 5 5.5" />
    </>
  ),
  sabio: (
    <>
      <path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-4a2 2 0 0 0-2 2" />
      <path d="M20 4v14h-6" />
    </>
  ),
  trophy: (
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 5 4 5M16 6h4c0 3-2 5-4 5M12 13v4M8 21h8M10 17h4" />
  ),
};

type SkillIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** A SkillId or "trophy". */
  name: string;
};

/** Decorative line icons from the preview (aria-hidden; the label always sits next to them). */
export function SkillIcon({ name, ...rest }: SkillIconProps) {
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
      {PATHS[name] ?? PATHS.trophy}
    </svg>
  );
}
