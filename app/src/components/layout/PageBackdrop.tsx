/*
 * Page backdrop: circuit traces in two opposite side gutters of the viewport (top right, and the
 * same drawing turned 180° at the bottom left), so the empty dark areas around the content are not
 * a flat black. 45° turns echo the chamfers of the Tralked logo; accent squares and dot grids are
 * the "nodes". Fixed behind everything, decorative only (aria-hidden, no pointer events, static).
 */

/*
 * Each corner lives only in the side gutter, outside the 1320 px page shell, clipped to the gutter's
 * width (none below 1320 px): it never runs behind headings, links or numbers. The top one starts
 * under the header.
 */
const GUTTER = "w-[max(0px,calc((100vw-1320px)/2))]";

function Corner({ id, className, svgClassName }: { id: string; className: string; svgClassName: string }) {
  return (
    <div className={`absolute h-[372px] overflow-hidden ${GUTTER} ${className}`}>
      <CornerArt id={id} className={svgClassName} />
    </div>
  );
}

function CornerArt({ id, className }: { id: string; className: string }) {
  return (
    <svg viewBox="0 0 520 440" className={`absolute w-[440px] max-w-none ${className}`} fill="none" aria-hidden="true">
      <defs>
        <pattern id={id} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.1" fill="var(--text)" />
        </pattern>
      </defs>
      {/* Long diagonals running off the corner. */}
      <path d="M300 0 L520 220" stroke="var(--acc)" strokeOpacity=".42" />
      <path d="M368 0 L520 152" stroke="var(--text)" strokeOpacity=".08" />
      <path d="M262 0 L520 258" stroke="var(--text)" strokeOpacity=".05" />
      {/* Traces with 45° turns. */}
      <path d="M0 46 H232 L292 106 H372" stroke="var(--acc)" strokeOpacity=".4" />
      <path d="M150 80 H226 L272 126 H352 L412 186 V262 L444 294 V312" stroke="var(--text)" strokeOpacity=".16" />
      <path d="M412 150 V246" stroke="var(--acc)" strokeOpacity=".55" />
      <path d="M470 296 V432" stroke="var(--acc)" strokeOpacity=".3" />
      <path d="M330 24 H372" stroke="var(--text)" strokeOpacity=".14" strokeDasharray="3 4" />
      {/* Nodes. */}
      <rect x="222" y="40" width="12" height="12" fill="var(--acc)" />
      <rect x="196" y="41" width="9" height="9" fill="var(--acc)" fillOpacity=".25" />
      <rect x="406" y="150" width="12" height="12" fill="var(--acc)" />
      <rect x="406.5" y="226.5" width="11" height="11" stroke="var(--acc)" strokeWidth="2" />
      <rect x="410" y="230" width="4" height="4" fill="var(--acc)" fillOpacity=".7" />
      <rect x="467" y="346" width="6" height="12" fill="var(--acc)" />
      {/* Dot grids. */}
      <rect x="300" y="168" width="98" height="70" fill={`url(#${id})`} opacity=".16" />
      <rect x="432" y="58" width="44" height="56" fill={`url(#${id})`} opacity=".2" />
    </svg>
  );
}

export function PageBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Corner id="tk-dots-tr" className="top-[73px] right-0" svgClassName="top-0 right-0" />
      <Corner id="tk-dots-bl" className="bottom-0 left-0" svgClassName="bottom-0 left-0 rotate-180" />
    </div>
  );
}
