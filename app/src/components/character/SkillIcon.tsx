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
  // Reward-loop marks (toasts, bell, "Como funciona o XP"): same stroke and caps as the skills.
  like: <path d="M7 11v10H3V11zM7 11l4-8c1.4 0 2.5 1.1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.3 7.4A2.8 2.8 0 0 1 17 21H7" />,
  photo: (
    <>
      <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  mission: (
    <>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M7.5 12.5l3 3 6-7" />
    </>
  ),
  level: <path d="M5 13l7-7 7 7M5 20l7-7 7 7" />,
  streak: <path d="M12 22c4.1 0 7-2.9 7-6.8 0-3.7-2.6-6-4.3-8.4-.4 2.1-1.4 3.4-2.9 4C12 7.2 10.9 4.4 9 2c0 4.2-4 6.6-4 11.4C5 19.2 8 22 12 22z" />,
  rank: <path d="M3 21v-7h6v7M9 21V8h6v13M15 21v-5h6v5M2 21h20" />,
  sync: <path d="M20 12a8 8 0 0 1-14.2 5M4 12a8 8 0 0 1 14.2-5M18 3v4h-4M6 21v-4h4" />,
  comment: <path d="M3 4h18v13H9l-5 4v-4H3z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7v1" />
    </>
  ),
};

type SkillIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** A SkillId, "trophy" or a reward mark (like, photo, mission, level, streak, rank, sync, comment). */
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
