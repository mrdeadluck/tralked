"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { LevelUpOverlay } from "@/components/fx/LevelUpOverlay";

const STEP_MS = 380;
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  const media = window.matchMedia(REDUCE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const readReduce = () => window.matchMedia(REDUCE_QUERY).matches;

type DespertarOverlayProps = {
  /** Levels to climb through, in order (from `despertarSteps`); the last one is the real level. */
  steps: number[];
  onClose: () => void;
  /** Called on every level reached (e.g. a sound). */
  onStep?: (level: number) => void;
};

/**
 * "Despertar": the level-up overlay climbing from level 1 to the character's real level, one
 * step at a time. With reduced motion it shows the final level at once.
 */
export function DespertarOverlay({ steps, onClose, onStep }: DespertarOverlayProps) {
  const reduce = useSyncExternalStore(subscribeReduce, readReduce, () => false);
  const last = steps.length - 1;
  const [climbed, setClimbed] = useState(0);
  const index = reduce ? last : climbed;

  useEffect(() => {
    onStep?.(steps[index]);
    if (index >= last) return;
    const timer = setTimeout(() => setClimbed((i) => Math.min(last, i + 1)), STEP_MS);
    return () => clearTimeout(timer);
    // onStep only notifies; depending on its identity would replay the current step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, last, steps]);

  return (
    <LevelUpOverlay
      from={1}
      to={steps[index]}
      onClose={onClose}
      label="Despertar"
      message={`Seu histórico de conquistas despertou o personagem: nível ${steps[last]}.`}
    />
  );
}
