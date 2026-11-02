import type { SVGProps } from "react";

/** Same grid and stroke as ./icons (24px, 1.75, square caps). */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type FillableProps = SVGProps<SVGSVGElement> & { filled?: boolean };

export function ThumbUpIcon({ filled = false, ...props }: FillableProps) {
  return (
    <Icon {...props}>
      <path d="M4 10h3v10H4ZM7 10l4-7c1.3 0 2 .9 2 2v4h6.5l-1.6 11H7Z" fill={filled ? "currentColor" : "none"} />
    </Icon>
  );
}

/** The thumb turned upside down (mirrored vertically, so the cuff stays on the left). */
export function ThumbDownIcon({ filled = false, ...props }: FillableProps) {
  return (
    <Icon {...props}>
      <path
        d="M4 14h3V4H4ZM7 14l4 7c1.3 0 2-.9 2-2v-4h6.5L17.9 4H7Z"
        fill={filled ? "currentColor" : "none"}
      />
    </Icon>
  );
}

export function ReplyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 5 4 11l6 6M4 11h10a6 6 0 0 1 6 6v2" />
    </Icon>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <path d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
    </Icon>
  );
}
