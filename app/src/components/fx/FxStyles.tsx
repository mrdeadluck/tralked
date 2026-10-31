/**
 * Keyframes and effects for the level-up overlay and toasts (source: preview/index.html).
 * A hoisted, deduplicated <style> (React 19) keeps them out of the shared globals.css.
 * Reduced motion: animations are disabled outright.
 */
const CSS = `
.gl-lu-box { animation: gl-lu-in 0.5s cubic-bezier(0.2, 1.4, 0.4, 1); }
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
.gl-toast { animation: gl-toast-in 0.3s ease; }
@keyframes gl-lu-in { from { transform: scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes gl-lu-spin { to { rotate: 360deg; } }
@keyframes gl-toast-in { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .gl-lu-box, .gl-lu-box::before, .gl-toast { animation: none; }
}
`;

export function FxStyles() {
  return (
    <style href="gamelog-fx" precedence="default">
      {CSS}
    </style>
  );
}
