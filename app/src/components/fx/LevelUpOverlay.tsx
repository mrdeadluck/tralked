"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { FxStyles } from "./FxStyles";

type LevelUpOverlayProps = {
  from: number;
  to: number;
  onClose: () => void;
  /** Rótulo acima do número (padrão "Level up"). */
  label?: string;
  /** Frase lida pelo leitor de tela (padrão: "Você avançou do nível X para o nível Y."). */
  message?: string;
};

/** Modal de level up. Renderize só enquanto estiver aberto. */
export function LevelUpOverlay({ from, to, onClose, label = "Level up", message }: LevelUpOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const button = dialogRef.current?.querySelector("button");
    button?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      // O único elemento focável é o botão: mantém o foco dentro do diálogo.
      if (event.key === "Tab") {
        event.preventDefault();
        button?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="level-up-title"
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(6,6,8,0.82)] p-5 backdrop-blur-[4px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <FxStyles />
      <div className="gl-lu-box relative px-6 py-10 text-center">
        <span className="font-mono text-xs tracking-[0.14em] text-acc uppercase">
          {label}
        </span>
        <strong
          aria-hidden="true"
          className="my-2.5 block text-[clamp(96px,20vw,180px)] leading-[0.9] font-black font-stretch-[125%] tracking-[-0.05em] text-acc [text-shadow:0_0_60px_rgba(198,244,50,0.45)]"
        >
          {to}
        </strong>
        <p
          id="level-up-title"
          className="mb-6 text-xl font-extrabold font-stretch-[112%] tracking-[-0.01em]"
        >
          {message ?? `Você avançou do nível ${from} para o nível ${to}.`}
        </p>
        <Button variant="primary" onClick={onClose}>
          Continuar caçando
        </Button>
      </div>
    </div>
  );
}
