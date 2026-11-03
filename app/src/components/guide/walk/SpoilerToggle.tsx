"use client";

import { useSpoilers } from "./spoilers";

/** "Spoilers" switch of the journey bars: turns every spoiler of the page on or off (off by default). */
export function SpoilerToggle() {
  const { on, setOn } = useSpoilers();
  return (
    <button type="button" className="wk-sp" aria-pressed={on} onClick={() => setOn(!on)}>
      Spoilers <span className="tg" aria-hidden="true" />
    </button>
  );
}
