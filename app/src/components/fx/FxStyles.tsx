/**
 * Keyframes and effects for the level-up overlay and the reward toasts.
 * A hoisted, deduplicated <style> (React 19) keeps them out of the shared globals.css.
 *
 * Motion thesis: a reward lands like a cartridge clicking in. The toast slides in from the edge
 * with a clip reveal (exponential ease-out), the "+XP" figure stamps in with a brief lime glow
 * that fades to plain text, and a thin fuse along the bottom burns down the toast's lifetime.
 * Reduced motion: no travel, no stamp; the toast fades and the fuse is hidden.
 */
const CSS = `
.gl-lu-box { animation: gl-lu-in 0.55s cubic-bezier(0.16, 1, 0.3, 1); }
.gl-lu-box::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 45%;
  width: 560px;
  height: 560px;
  max-width: 120vw;
  translate: -50% -50%;
  z-index: -1;
  background: repeating-conic-gradient(from 0deg, rgba(198, 244, 50, 0.16) 0 4deg, transparent 4deg 22deg);
  mask: radial-gradient(circle, #000 15%, transparent 68%);
  animation: gl-lu-spin 14s linear infinite;
}
.gl-toast { animation: gl-toast-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both; }
.gl-toast[data-leaving] { animation: gl-toast-out 0.2s cubic-bezier(0.7, 0, 0.84, 0) both; }
.gl-xp-stamp { display: inline-block; animation: gl-xp-stamp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
.gl-fuse {
  position: absolute;
  inset: auto 0 0 0;
  height: 2px;
  background: var(--c);
  opacity: 0.7;
  transform-origin: left;
  animation: gl-fuse var(--life, 4200ms) linear both;
}
@keyframes gl-lu-in { from { transform: scale(0.82); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes gl-lu-spin { to { rotate: 360deg; } }
@keyframes gl-toast-in {
  from { transform: translateX(32px); opacity: 0; clip-path: inset(0 0 0 60%); }
  to { transform: none; opacity: 1; clip-path: inset(0); }
}
@keyframes gl-toast-out { to { transform: translateX(18px); opacity: 0; } }
@keyframes gl-xp-stamp {
  from { transform: scale(1.35); text-shadow: 0 0 18px rgba(198, 244, 50, 0.75); }
  55% { text-shadow: 0 0 10px rgba(198, 244, 50, 0.35); }
  to { transform: none; text-shadow: 0 0 0 rgba(198, 244, 50, 0); }
}
@keyframes gl-fuse { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) {
  .gl-lu-box, .gl-lu-box::before, .gl-xp-stamp { animation: none; }
  .gl-toast { animation-name: gl-fade-in; }
  .gl-toast[data-leaving] { animation-name: gl-fade-out; }
  .gl-fuse { display: none; }
  @keyframes gl-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes gl-fade-out { to { opacity: 0; } }
}
`;

export function FxStyles() {
  return (
    <style href="tralked-fx" precedence="default">
      {CSS}
    </style>
  );
}
