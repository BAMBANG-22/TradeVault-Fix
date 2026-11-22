/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface BrandLogoProps {
  /**
   * 'symbol': BD-D Orbit-Pulse Bowl mark (viewBox 0 0 256 256)
   * 'wordmark': vector wordmark "VLO" only (viewBox 255 72 308 112)
   * 'lockup': horizontal mark with vector wordmark (viewBox 0 0 584 256)
   */
  variant?: 'symbol' | 'wordmark' | 'lockup';
  /** Wraps symbol in soft squircle app-icon tile */
  withTile?: boolean;
  /** Enables fluid GPU-composited orbit & core micro-motion on hover/active */
  interactive?: boolean;
  className?: string;
  title?: string;
}

/**
 * Refined G1-continuous Vault Body path (smooth liquid scoop transition from V-arm into bowl)
 */
export const VLO_BODY_PATH =
  'M 34.21 74.65 A 18.00 18.00 0 0 1 65.79 57.35 C 79.24 81.91, 97.88 100.71, 122.99 93.98 A 58.00 58.00 0 1 1 80.00 150.00 C 80.00 120.50, 49.58 102.72, 34.21 74.65 Z M 138.00 125.00 A 25.00 25.00 0 1 0 138.10 125.00 Z';

/**
 * Tapered aerodynamic Sapphire Flow Pulse arc (swells smoothly from -68deg tail to -14deg head)
 */
export const VLO_PULSE_PATH =
  'M 169.65 71.65 C 195.85 80.01, 216.99 101.01, 225.81 128.11 A 10.50 10.50 0 0 1 205.44 133.19 C 201.93 110.46, 187.25 90.60, 166.28 80.00 A 4.50 4.50 0 0 1 169.65 71.65 Z';

/**
 * Emerald Core Focus dot centered at (138, 150)
 */
export const VLO_CORE_PATH =
  'M 138.00 136.00 A 14.00 14.00 0 1 1 137.90 136.00 Z';

const VLO_WORDMARK_PATH =
  'M 262 80 H 285 L 304 148 L 323 80 H 346 L 316.5 176 H 291.5 Z M 366 80 H 387 V 150 A 6 6 0 0 0 393 156 H 434 V 176 H 389 A 23 23 0 0 1 366 153 Z M 504 78 A 50 50 0 1 1 503.9 78 Z M 504 99 A 29 29 0 1 0 504.1 99 Z';

/**
 * VLO Official Brand Logo Component (BD-D — "Orbit-Pulse Bowl" · Carbon + Emerald)
 *
 * Geometry:
 * - Symbol: Continuous-curve Vault body + Tapered Sapphire Flow Pulse arc + Emerald Core Focus dot
 * - Wordmark: Rounded-geometric "VLO"
 *
 * Theme color adaptation (DESIGN.md):
 * - Light surface: #151D2A Vault Ink + #1769E8 Flow Pulse + #059669 Core Focus Dot
 * - Dark surface:  #F2F5F9 Vault Ink + #1769E8 Flow Pulse + #10B981 Core Focus Dot
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'lockup',
  withTile = false,
  interactive = true,
  className = 'h-8 w-auto',
  title = 'VLO',
}) => {
  const interactiveClass = interactive ? 'vlo-logo-interactive' : '';

  if (variant === 'symbol') {
    const svg = (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={withTile ? '14 14 228 228' : '0 0 256 256'}
        fill="none"
        aria-label={title}
        role="img"
        className={
          withTile
            ? `h-full w-full block ${interactiveClass}`
            : `shrink-0 ${interactiveClass} ${className}`
        }
      >
        <title>{title}</title>
        <path
          className="vlo-mark-body fill-[#151D2A] dark:fill-[#F2F5F9]"
          fillRule="evenodd"
          d={VLO_BODY_PATH}
        />
        <path
          className="vlo-mark-pulse fill-[#1769E8]"
          d={VLO_PULSE_PATH}
        />
        <path
          className="vlo-mark-core fill-[#059669] dark:fill-[#10B981]"
          d={VLO_CORE_PATH}
        />
      </svg>
    );

    if (withTile) {
      return (
        <span
          className={`vlo-tile-surface inline-flex items-center justify-center shrink-0 overflow-hidden rounded-[26%] bg-[#FAFAFA] dark:bg-white/[0.045] border border-black/[0.06] dark:border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`}
        >
          {svg}
        </span>
      );
    }

    return svg;
  }

  if (variant === 'wordmark') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="255 72 308 112"
        fill="none"
        aria-label={title}
        role="img"
        className={`shrink-0 ${interactive ? 'vlo-wordmark-interactive' : ''} ${className}`}
      >
        <title>{title}</title>
        <path
          className="fill-[#151D2A] dark:fill-[#F2F5F9] transition-colors duration-200"
          fillRule="evenodd"
          d={VLO_WORDMARK_PATH}
        />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 584 256"
      fill="none"
      aria-label={title}
      role="img"
      className={`shrink-0 ${interactiveClass} ${className}`}
    >
      <title>{title}</title>
      <path
        className="vlo-mark-body fill-[#151D2A] dark:fill-[#F2F5F9]"
        fillRule="evenodd"
        d={VLO_BODY_PATH}
      />
      <path
        className="vlo-mark-pulse fill-[#1769E8]"
        d={VLO_PULSE_PATH}
      />
      <path
        className="vlo-mark-core fill-[#059669] dark:fill-[#10B981]"
        d={VLO_CORE_PATH}
      />
      <path
        className="fill-[#151D2A] dark:fill-[#F2F5F9] transition-colors duration-200"
        fillRule="evenodd"
        d={VLO_WORDMARK_PATH}
      />
    </svg>
  );
};
