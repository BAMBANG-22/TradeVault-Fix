/**
 * VLO — Mechanical Orbital Assembly (single file: component + CSS)
 *
 * Usage:   <VloMech theme="auto" />          // "auto" | "light" | "dark"
 *          <VloMech theme="dark" size={160} slowMo={2} />
 * Timeline (ms): body 0–850 · arc 300–1100 · core 650–1250 · sync 1000–1450 · idle 1500+
 * Animated: transform, opacity, stroke-dashoffset only. Honors prefers-reduced-motion.
 * No dependencies besides React 18+ (useId).
 */
import { useId } from "react";


/* ── Styles (injected inside the <svg>, scoped by the .vm class) ── */
const CSS = `
/* ───────────────────────────────────────────────────────────────
   VLO — Mechanical Orbital Assembly
   body 0–850 · arc 300–1100 · core 650–1250 · sync 1000–1450 · idle 1500+
   Animated: transform, opacity, stroke-dashoffset (mask reveal) only.
   Every animation ends on the original, untouched geometry.
   ─────────────────────────────────────────────────────────────── */
.vm {
  --vm-t: 1;                           /* time-scale: 2 = twice as slow */
  --vm-tile: #FFFFFF;
  --vm-tile-stroke: #DDE3EA;
  --vm-body: #151D2A;
  --vm-pulse: #1769E8;
  --vm-core: #059669;
  --vm-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --vm-soft: cubic-bezier(0.45, 0, 0.3, 1);
  display: block;
}
@media (prefers-color-scheme: dark) {
  .vm[data-theme="auto"] {
    --vm-tile: #11151B; --vm-tile-stroke: #252B34;
    --vm-body: #F2F5F9; --vm-core: #10B981;
  }
}
.vm[data-theme="dark"] {
  --vm-tile: #11151B; --vm-tile-stroke: #252B34;
  --vm-body: #F2F5F9; --vm-core: #10B981;
}

.vm .tile-bg    { fill: var(--vm-tile); stroke: var(--vm-tile-stroke); }
.vm .body-path  { fill: var(--vm-body); }
.vm .pulse-path { fill: var(--vm-pulse); }
.vm .core-dot   { fill: var(--vm-core); }

/* Every pivot is a bbox centre; invisible anchor circles in the markup
   pin them all to the orbit centre (138,150). */
.vm .tile-bg, .vm .vm__all, .vm .vm__lever, .vm .vm__orbit,
.vm .core-dot, .vm .vm__ripple, .vm .vm__sheen {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}

.vm .tile-bg { animation: vm-tile calc(420ms * var(--vm-t)) var(--vm-expo) both; }
@keyframes vm-tile { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }

/* Phase 1 — the V-arm is a lever swung about the bowl: released at +24°,
   it slams past home (−3.2°), counter-swings (+1°) and locks at 0°. */
.vm .vm__lever {
  will-change: transform;
  animation: vm-lever calc(850ms * var(--vm-t)) linear both;
}
@keyframes vm-lever {
  0%   { transform: translate(5px, -6px) rotate(24deg)   scale(0.93);  animation-timing-function: cubic-bezier(0.32, 0.72, 0.12, 1); }
  52%  { transform: translate(0, 0)      rotate(-3.2deg) scale(1.014); animation-timing-function: var(--vm-soft); }
  76%  { transform: translate(0, 0)      rotate(1deg)    scale(0.997); animation-timing-function: var(--vm-soft); }
  100% { transform: translate(0, 0)      rotate(0deg)    scale(1); }
}
/* contour reveal rides on the lever so the body is built, not faded */
.vm__trace {
  fill: none; stroke: #fff; stroke-width: 52;
  stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1 1; stroke-dashoffset: 1;
  animation: vm-reveal calc(560ms * var(--vm-t)) var(--vm-expo) both;
}
@keyframes vm-reveal { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }

/* Phase 2 — arc on its orbit: −65° → 0°, accelerates out of rest, brakes,
   ticks 2.6° past and settles back. Radial expansion 0.9 → 1. */
.vm .vm__orbit {
  will-change: transform, opacity;
  animation:
    vm-orbit calc(800ms * var(--vm-t)) linear calc(300ms * var(--vm-t)) both,
    vm-fade  calc(220ms * var(--vm-t)) ease-out calc(300ms * var(--vm-t)) both;
}
@keyframes vm-orbit {
  0%   { transform: rotate(-65deg) scale(0.9);    animation-timing-function: cubic-bezier(0.55, 0.05, 0.12, 1); }
  72%  { transform: rotate(2.6deg) scale(1.012);  animation-timing-function: var(--vm-soft); }
  88%  { transform: rotate(-0.7deg) scale(0.998); animation-timing-function: var(--vm-soft); }
  100% { transform: rotate(0deg) scale(1); }
}
@keyframes vm-fade { from { opacity: 0; } to { opacity: 1; } }

/* Phase 3 — core is pulled in from the arc side, snaps to centre, then
   0 → 1.16 → 0.97 → 1. Idle breath (4 s) takes over at 1500 ms. */
.vm .core-dot {
  will-change: transform;
  animation:
    vm-core    calc(600ms  * var(--vm-t)) linear      calc(650ms  * var(--vm-t)) both,
    vm-breathe calc(4000ms * var(--vm-t)) ease-in-out calc(1500ms * var(--vm-t)) infinite;
}
@keyframes vm-core {
  0%   { transform: translate(24px, -16px) scale(0);   animation-timing-function: cubic-bezier(0.5, 0, 0.75, 0.4); }
  40%  { transform: translate(0, 0) scale(1.16);       animation-timing-function: var(--vm-soft); }
  70%  { transform: translate(0, 0) scale(0.97);       animation-timing-function: var(--vm-soft); }
  100% { transform: translate(0, 0) scale(1); }
}
@keyframes vm-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }

.vm .vm__ripple {
  fill: none; stroke: var(--vm-core); stroke-width: 1.5;
  vector-effect: non-scaling-stroke; opacity: 0; will-change: transform, opacity;
  animation: vm-ripple calc(560ms * var(--vm-t)) cubic-bezier(0.2, 0.7, 0.25, 1) calc(880ms * var(--vm-t)) both;
}
@keyframes vm-ripple {
  0%   { transform: scale(0.9); opacity: 0; }
  16%  { opacity: 0.3; }
  100% { transform: scale(2.6); opacity: 0; }
}

/* Phase 4 — synchronisation: one small "click" of the whole assembly */
.vm .vm__all {
  will-change: transform;
  animation: vm-sync calc(450ms * var(--vm-t)) linear calc(1000ms * var(--vm-t)) both;
}
@keyframes vm-sync {
  0%   { transform: rotate(0deg)     scale(1);     animation-timing-function: cubic-bezier(0.2, 0.8, 0.3, 1); }
  25%  { transform: rotate(0.6deg)   scale(1.01);  animation-timing-function: var(--vm-soft); }
  55%  { transform: rotate(-0.35deg) scale(0.996); animation-timing-function: var(--vm-soft); }
  80%  { transform: rotate(0.1deg)   scale(1.001); animation-timing-function: var(--vm-soft); }
  100% { transform: rotate(0deg)     scale(1); }
}

/* Phase 5 — a narrow, crisp glint crosses the sapphire every 4 s */
.vm .vm__sheen {
  opacity: 0; will-change: transform, opacity;
  animation: vm-sheen calc(4000ms * var(--vm-t)) cubic-bezier(0.4, 0, 0.2, 1) calc(1800ms * var(--vm-t)) infinite;
}
@keyframes vm-sheen {
  0%        { transform: rotate(-82deg); opacity: 0; }
  6%        { opacity: 1; }
  26%       { transform: rotate(4deg);   opacity: 1; }
  32%, 100% { transform: rotate(4deg);   opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .vm, .vm * { animation: none !important; }
  .vm__trace { stroke-dashoffset: 0; }
  .vm .vm__ripple, .vm .vm__sheen { display: none; }
}
`;

type VloMechProps = {
  /** "auto" follows prefers-color-scheme */
  theme?: "auto" | "light" | "dark";
  size?: number | string;
  /** 1 = real time · 2 = twice as slow */
  slowMo?: number;
  className?: string;
};

// Exact source paths — do not edit.
const BODY =
  "M 34.21 74.65 A 18.00 18.00 0 0 1 65.79 57.35 C 79.24 81.91, 97.88 100.71, 122.99 93.98 A 58.00 58.00 0 1 1 80.00 150.00 C 80.00 120.50, 49.58 102.72, 34.21 74.65 Z M 138.00 125.00 A 25.00 25.00 0 1 0 138.10 125.00 Z";
const PULSE =
  "M 169.65 71.65 C 195.85 80.01, 216.99 101.01, 225.81 128.11 A 10.50 10.50 0 0 1 205.44 133.19 C 201.93 110.46, 187.25 90.60, 166.28 80.00 A 4.50 4.50 0 0 1 169.65 71.65 Z";
const CORE = "M 138.00 136.00 A 14.00 14.00 0 1 1 137.90 136.00 Z";

// Reveal guide (mask only — never painted): V-arm tip → bend → once round the bowl.
// Starts off-shape so the round cap can't flash the artwork on frame 1.
const TRACE = "M 20 22 L 50 66 C 66.5 91, 107.5 112.3, 99 135.8 A 41.5 41.5 0 1 0 120.5 112.4";

export function VloMech({ theme = "auto", size = 256, slowMo = 1, className }: VloMechProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskId = `vm-mask-${uid}`;
  const clipId = `vm-clip-${uid}`;
  const gradId = `vm-sheen-${uid}`;

  return (
    <svg
      className={className ? `vm ${className}` : "vm"}
      data-theme={theme}
      viewBox="16 16 224 224"
      width={size}
      height={size}
      role="img"
      aria-label="VLO"
      style={{ "--vm-t": slowMo } as React.CSSProperties}
    >
      <title>VLO — Orbit-Pulse Bowl</title>
      <style>{CSS}</style>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="16" y="16" width="224" height="224">
          <path className="vm__trace" pathLength={1} d={TRACE} />
        </mask>
        <clipPath id={clipId}>
          <path d={PULSE} />
        </clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect className="tile-bg" x="19" y="19" width="218" height="218" rx="56" strokeWidth="3" />

      {/* Sync wrapper (ends at identity). Invisible circles centre each bbox on the pivot (138,150). */}
      <g className="vm__all">
        <circle cx="138" cy="150" r="125" fill="none" />

        {/* Arc sits under the body, so the swinging lever passes over it, never through it. */}
        <g className="vm__orbit">
          <circle cx="138" cy="150" r="100" fill="none" />
          <path className="pulse-path" d={PULSE} />
        </g>

        <g className="vm__lever">
          <circle cx="138" cy="150" r="125" fill="none" />
          <path className="body-path" fillRule="evenodd" d={BODY} mask={`url(#${maskId})`} />
        </g>

        <circle className="vm__ripple" cx="138" cy="150" r="14" />
        <path className="core-dot" d={CORE} />
      </g>

      {/* Sheen, clipped to the sapphire arc */}
      <g clipPath={`url(#${clipId})`}>
        <g className="vm__sheen">
          <circle cx="138" cy="150" r="100" fill="none" />
          <rect x="198" y="146" width="40" height="8" fill={`url(#${gradId})`} />
        </g>
      </g>
    </svg>
  );
}
