import type { ReactNode, SVGProps } from "react";
import { DuoFill } from "./AttributeIcon";

/** Duotone icons: `f` is the soft fill layer (optional), `s` the stroke drawn over it. */
const PATHS: Record<string, { f?: ReactNode; s: ReactNode }> = {
  fps: {
    f: <circle cx="12" cy="12" r="6.5" />,
    s: (
      <>
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
      </>
    ),
  },
  horror: {
    f: <path d="M12 3a8 8 0 0 0-8 8c0 2.8 1.4 4.4 3 5.4V20h10v-3.6c1.6-1 3-2.6 3-5.4a8 8 0 0 0-8-8z" />,
    s: (
      <>
        <path d="M12 3a8 8 0 0 0-8 8c0 2.8 1.4 4.4 3 5.4V20h10v-3.6c1.6-1 3-2.6 3-5.4a8 8 0 0 0-8-8zM10 20v-2.5M14 20v-2.5" />
        <circle cx="8.8" cy="11.5" r="1.7" fill="currentColor" />
        <circle cx="15.2" cy="11.5" r="1.7" fill="currentColor" />
      </>
    ),
  },
  soulslike: {
    f: <path d="M12 21.5c-3 0-5-2-5-4.5 0-2.4 2-3.6 2.6-5.6.8 1.2 1.6 1.7 2.4 1.9-.4-2.2.5-4 2-5.3.3 2.6 3 4.4 3 8.8 0 2.7-2 4.7-5 4.7z" />,
    s: <path d="M12 21.5c-3 0-5-2-5-4.5 0-2.4 2-3.6 2.6-5.6.8 1.2 1.6 1.7 2.4 1.9-.4-2.2.5-4 2-5.3.3 2.6 3 4.4 3 8.8 0 2.7-2 4.7-5 4.7zM12 2.5v6M10 4.5h4" />,
  },
  rpg: {
    f: <path d="M12 2.5l8 3v6c0 5-3.5 8.8-8 10.5-4.5-1.7-8-5.5-8-10.5v-6z" />,
    s: <path d="M12 2.5l8 3v6c0 5-3.5 8.8-8 10.5-4.5-1.7-8-5.5-8-10.5v-6zM12 7v9M9 10h6" />,
  },
  roguelike: {
    f: <path d="M3.5 3.5h17v17h-17z" />,
    s: (
      <>
        <path d="M3.5 3.5h17v17h-17z" />
        <g fill="currentColor" stroke="none">
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="16" cy="16" r="1.4" />
          <circle cx="16" cy="8" r="1.4" />
          <circle cx="8" cy="16" r="1.4" />
        </g>
      </>
    ),
  },
  plataforma: {
    f: <path d="M3 21v-5h5v-5h5V6h5v15z" />,
    s: <path d="M3 21v-5h5v-5h5V6h5v15H3zM18 6V2.5h3" />,
  },
  estrategia: {
    f: <path d="M8 18l1-8h6l1 8z" />,
    s: <path d="M6 21.5h12l-1-3.5H7zM8 18l1-8h6l1 8M7 10V4.5h2.3v2h1.6v-2h2.2v2h1.6v-2H17V10z" />,
  },
  simulacao: {
    f: <path d="M3 14h18l-2 5H5z" />,
    s: (
      <>
        <path d="M3 14h18l-2 5H5zM6 14V9.5h12V14M9 9.5 10.5 5h3L15 9.5" />
        <circle cx="7.5" cy="19" r="1.5" />
        <circle cx="16.5" cy="19" r="1.5" />
      </>
    ),
  },
  puzzle: {
    f: <path d="M4 4h6a2 2 0 1 1 4 0h6v6a2 2 0 1 0 0 4v6h-6a2 2 0 1 0-4 0H4v-6a2 2 0 1 1 0-4z" />,
    s: <path d="M4 4h6a2 2 0 1 1 4 0h6v6a2 2 0 1 0 0 4v6h-6a2 2 0 1 0-4 0H4v-6a2 2 0 1 1 0-4z" />,
  },
  coop: {
    f: (
      <>
        <circle cx="8.5" cy="8" r="3.2" />
        <circle cx="16.5" cy="9" r="2.6" />
      </>
    ),
    s: (
      <>
        <circle cx="8.5" cy="8" r="3.2" />
        <circle cx="16.5" cy="9" r="2.6" />
        <path d="M2.5 20c0-3.6 2.8-6 6-6s6 2.4 6 6M14.5 14.6c.8-.7 1.8-1 2.8-1 2.5 0 4.2 2 4.2 5.4" />
      </>
    ),
  },
  sabio: {
    f: <path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" />,
    s: <path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-4a2 2 0 0 0-2 2M20 4v14h-6" />,
  },
  trophy: {
    f: <path d="M8 4h8v5a4 4 0 0 1-8 0z" />,
    s: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 5 4 5M16 6h4c0 3-2 5-4 5M12 13v4M8 21h8M10 17h4" />,
  },
  // Reward-loop marks (toasts, bell, "Como funciona o XP"): same stroke and caps as the skills.
  like: {
    f: <path d="M7 11v10H3V11z" />,
    s: <path d="M7 11v10H3V11zM7 11l4-8c1.4 0 2.5 1.1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.3 7.4A2.8 2.8 0 0 1 17 21H7" />,
  },
  photo: {
    f: <circle cx="12" cy="13" r="3.5" />,
    s: (
      <>
        <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  },
  mission: {
    f: <path d="M3 3h18v18H3z" />,
    s: <path d="M3 3h18v18H3zM7.5 12.5l3 3 6-7" />,
  },
  level: { s: <path d="M5 13l7-7 7 7M5 20l7-7 7 7" /> },
  streak: {
    f: <path d="M12 22c4.1 0 7-2.9 7-6.8 0-3.7-2.6-6-4.3-8.4-.4 2.1-1.4 3.4-2.9 4C12 7.2 10.9 4.4 9 2c0 4.2-4 6.6-4 11.4C5 19.2 8 22 12 22z" />,
    s: <path d="M12 22c4.1 0 7-2.9 7-6.8 0-3.7-2.6-6-4.3-8.4-.4 2.1-1.4 3.4-2.9 4C12 7.2 10.9 4.4 9 2c0 4.2-4 6.6-4 11.4C5 19.2 8 22 12 22z" />,
  },
  rank: {
    f: <path d="M9 21V8h6v13z" />,
    s: <path d="M3 21v-7h6v7M9 21V8h6v13M15 21v-5h6v5M2 21h20" />,
  },
  sync: { s: <path d="M20 12a8 8 0 0 1-14.2 5M4 12a8 8 0 0 1 14.2-5M18 3v4h-4M6 21v-4h4" /> },
  comment: {
    f: <path d="M3 4h18v13H9l-5 4v-4H3z" />,
    s: <path d="M3 4h18v13H9l-5 4v-4H3z" />,
  },
  info: {
    s: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
  },
};

type SkillIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** A SkillId, "trophy" or a reward mark (like, photo, mission, level, streak, rank, sync, comment). */
  name: string;
};

/** Decorative duotone icons (aria-hidden; the label always sits next to them). */
export function SkillIcon({ name, ...rest }: SkillIconProps) {
  const icon = PATHS[name] ?? PATHS.trophy;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...rest}
    >
      {icon.f ? <DuoFill>{icon.f}</DuoFill> : null}
      {icon.s}
    </svg>
  );
}
