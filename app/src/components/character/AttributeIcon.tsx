import type { ReactNode, SVGProps } from "react";
import type { AttributeId } from "@/lib/engine/attributes";

/** Soft fill under the stroke (the duotone look): the same color at low opacity. */
export function DuoFill({ children }: { children: ReactNode }) {
  return (
    <g fill="currentColor" fillOpacity={0.22} stroke="none">
      {children}
    </g>
  );
}

/** Duotone paths: `f` is the soft fill layer, `s` the stroke drawn over it. */
const PATHS: Record<AttributeId, { f: ReactNode; s: ReactNode }> = {
  vigor: {
    f: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
    s: (
      <>
        <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
        <path d="M5 12.5h3.5l1.5-3 3 6 1.5-3H19" />
      </>
    ),
  },
  precisao: {
    f: <circle cx="12" cy="12" r="5" />,
    s: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </>
    ),
  },
  gloria: {
    f: <path d="M4 17 3 7l5 4 4-7 4 7 5-4-1 10z" />,
    s: <path d="M4 17 3 7l5 4 4-7 4 7 5-4-1 10zM4 20.5h16" />,
  },
  colecao: {
    f: <path d="M4 13h16v8H4z" />,
    s: <path d="M4 13h16v8H4zM5.5 8.5h13V13M7 4h10v4.5M9 17l2 2 4-4" />,
  },
  exploracao: {
    f: <path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3z" />,
    s: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3zM12 3v2M12 19v2M3 12h2M19 12h2" />
      </>
    ),
  },
  constancia: {
    f: <path d="M3.5 5h17v5h-17z" />,
    s: <path d="M3.5 5h17v15.5h-17zM3.5 10h17M8 2.5v4M16 2.5v4M8.5 15l2.5 2.5 4.5-4.5" />,
  },
  sabedoria: {
    f: <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />,
    s: <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3zM9 19h6M10.5 21.5h3M12 7v3" />,
  },
  // Hourglass: hours endured.
  resistencia: {
    f: <path d="M8 6h8l-4 5zM7.5 19.5h9l-4.5-4z" />,
    s: <path d="M5.5 2.5h13M5.5 21.5h13M7 2.5c0 5 10 5 10 9.5s-10 4.5-10 9.5M17 2.5c0 5-10 5-10 9.5s10 4.5 10 9.5" />,
  },
  // Shelf of game cases.
  acervo: {
    f: <path d="M5 7h4v13H5z" />,
    s: <path d="M2.5 20.5h19M5 7h4v13H5zM10.5 4h4v16h-4zM16 8.5l3.2-.9 3.3 12-3.2.9z" />,
  },
};

type AttributeIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { name: AttributeId };

/** Decorative duotone icons for the attributes, drawn like SkillIcon (the label sits next to them). */
export function AttributeIcon({ name, ...rest }: AttributeIconProps) {
  const icon = PATHS[name];
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
      <DuoFill>{icon.f}</DuoFill>
      {icon.s}
    </svg>
  );
}
