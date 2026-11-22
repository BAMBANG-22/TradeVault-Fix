/**
 * VLO — Mechanical Orbital Assembly (GPU-composited SVG + global CSS)
 *
 * Usage:   <VloMech theme="auto" />          // "auto" | "light" | "dark"
 *          <VloMech theme="dark" size={160} slowMo={2} />
 * Timeline (ms): body 0–820 · arc 260–1040 · core 620–1200 · sync 980–1400 · idle 1450+
 * Animated: GPU transform (translate3d/rotate/scale3d) & opacity only. Honors prefers-reduced-motion.
 */
import React, { useId } from 'react';
import { VLO_BODY_PATH, VLO_CORE_PATH, VLO_PULSE_PATH } from './BrandLogo';

export type VloMechProps = {
  /** "auto" follows html.dark/html.light or prefers-color-scheme */
  theme?: 'auto' | 'light' | 'dark';
  size?: number | string;
  /** 1 = real time · 2 = twice as slow */
  slowMo?: number;
  className?: string;
};

export function VloMech({
  theme = 'auto',
  size = 256,
  slowMo = 1,
  className,
}: VloMechProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const clipId = `vm-clip-${uid}`;
  const gradId = `vm-sheen-${uid}`;

  return (
    <svg
      className={className ? `vm ${className}` : 'vm'}
      data-theme={theme}
      viewBox="16 16 224 224"
      width={size}
      height={size}
      role="img"
      aria-label="VLO"
      style={{ '--vm-t': slowMo, transform: 'translateZ(0)' } as React.CSSProperties}
    >
      <title>VLO — Orbit-Pulse Bowl</title>
      <defs>
        <clipPath id={clipId}>
          <path d={VLO_PULSE_PATH} />
        </clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect className="tile-bg" x="19" y="19" width="218" height="218" rx="56" strokeWidth="3" />

      {/* GPU-composited assembly wrapper pivoted around (138, 150) */}
      <g className="vm__all">
        <g className="vm__orbit">
          <path className="pulse-path" d={VLO_PULSE_PATH} />
        </g>

        <g className="vm__lever">
          <path className="body-path" fillRule="evenodd" d={VLO_BODY_PATH} />
        </g>

        <circle className="vm__ripple" cx="138" cy="150" r="14" />
        <path className="core-dot" d={VLO_CORE_PATH} />
      </g>

      {/* Sheen, clipped to the sapphire arc */}
      <g clipPath={`url(#${clipId})`}>
        <g className="vm__sheen">
          <rect x="198" y="146" width="40" height="8" fill={`url(#${gradId})`} />
        </g>
      </g>
    </svg>
  );
}
