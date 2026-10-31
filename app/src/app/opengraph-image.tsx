import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { EMBLEM, WORDMARK } from "@/components/brand/marks";
import { SLOGAN } from "@/components/brand/slogan";

// Default social card of every page that has no image of its own.
export const alt = `${SLOGAN}: notícias de games, guias de conquistas 100% e progressão de quem joga`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand tokens (globals.css): satori renders outside the page, so the values are repeated here.
const BG = "#0b0c0f";
const TEXT = "#ecece6";
const MUTED = "#9ea1a9";
const ACC = "#c6f432";
const BRAND_2 = "#a368fa";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function Image() {
  const [black, medium] = await Promise.all([font("ArchivoExpanded-Black.ttf"), font("ArchivoExpanded-Medium.ttf")]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: "72px 80px",
          fontFamily: "Archivo",
          color: TEXT,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <svg width={Math.round((170 * EMBLEM.width) / EMBLEM.height)} height="170" viewBox={`0 0 ${EMBLEM.width} ${EMBLEM.height}`}>
            <path d={EMBLEM.d} fill={ACC} />
            <path d={EMBLEM.chevron} fill={BRAND_2} />
          </svg>
          <svg width={Math.round((96 * WORDMARK.width) / WORDMARK.height)} height="96" viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}>
            <path d={WORDMARK.d} fill={TEXT} fillRule="evenodd" />
            <path d={WORDMARK.k} fill={ACC} />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.1, maxWidth: 980 }}>
            Notícias de games, guias 100% e a sua ficha de personagem.
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color: MUTED, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {SLOGAN}
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 12, background: ACC }} />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Archivo", data: black, style: "normal", weight: 900 },
        { name: "Archivo", data: medium, style: "normal", weight: 500 },
      ],
    },
  );
}
