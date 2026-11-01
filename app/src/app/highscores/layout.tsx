import type { ReactNode } from "react";

/** Shared by every board, so switching tabs only swaps the board below. */
export default function HighscoresLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-text pb-4">
        <h1 className="text-[28px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
          Highscores
        </h1>
        <p className="text-sm text-dim">Quem mais joga, conquista e coleciona no Tralked.</p>
      </header>
      {children}
    </div>
  );
}
