/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId } from 'react';
import { VLO_BODY_PATH, VLO_CORE_PATH, VLO_PULSE_PATH } from './BrandLogo';

type DotRole = 'body' | 'pulse' | 'core';
type DotPoint = readonly [number, number, DotRole];

/**
 * 118-point micro-dot lattice sampled from the BD-D Orbit-Pulse Bowl geometry,
 * partitioned into 8 left-to-right GPU-composited wave groups for locked 60fps animation.
 */
const VLO_DOT_WAVES: ReadonlyArray<ReadonlyArray<DotPoint>> = [
  [
    [43.5, 52.6, 'body'], [59.1, 52.6, 'body'], [47.4, 59.5, 'body'], [35.7, 66.3, 'body'],
    [51.3, 66.3, 'body'], [47.4, 73.2, 'body'], [43.5, 80.0, 'body'], [59.1, 80.0, 'body'],
    [55.2, 86.9, 'body'], [51.3, 93.8, 'body'], [59.1, 107.5, 'body'],
  ],
  [
    [66.9, 66.3, 'body'], [70.8, 73.2, 'body'], [74.7, 80.0, 'body'], [78.6, 86.9, 'body'],
    [66.9, 93.8, 'body'], [82.5, 93.8, 'body'], [63.0, 100.6, 'body'], [74.7, 107.5, 'body'],
    [70.8, 114.4, 'body'], [66.9, 121.2, 'body'], [82.5, 121.2, 'body'], [70.8, 128.1, 'body'],
    [66.9, 135.0, 'body'], [82.5, 135.0, 'body'], [78.6, 141.8, 'body'], [74.7, 148.7, 'body'],
    [82.5, 162.4, 'body'],
  ],
  [
    [86.4, 100.6, 'body'], [90.3, 107.5, 'body'], [94.2, 114.4, 'body'], [98.1, 121.2, 'body'],
    [94.2, 128.1, 'body'], [98.1, 135.0, 'body'], [102.0, 141.8, 'body'], [90.3, 148.7, 'body'],
    [105.9, 148.7, 'body'], [86.4, 155.6, 'body'], [98.1, 162.4, 'body'], [94.2, 169.3, 'body'],
    [90.3, 176.1, 'body'], [105.9, 176.1, 'body'], [102.0, 183.0, 'body'], [98.1, 189.9, 'body'],
  ],
  [
    [125.4, 100.6, 'body'], [113.7, 107.5, 'body'], [129.3, 107.5, 'body'], [117.6, 114.4, 'body'],
    [113.7, 121.2, 'body'], [129.3, 121.2, 'body'], [117.6, 128.1, 'body'], [113.7, 135.0, 'body'],
    [109.8, 155.6, 'body'], [113.7, 162.4, 'body'], [117.6, 169.3, 'body'], [121.5, 176.1, 'body'],
    [125.4, 183.0, 'body'], [113.7, 189.9, 'body'], [129.3, 189.9, 'body'], [117.6, 196.7, 'body'],
    [121.5, 203.6, 'body'],
  ],
  [
    [137.1, 93.8, 'body'], [148.8, 100.6, 'body'], [144.9, 107.5, 'body'], [141.0, 114.4, 'body'],
    [144.9, 121.2, 'body'], [133.2, 141.8, 'core'], [148.8, 141.8, 'core'], [137.1, 148.7, 'core'],
    [133.2, 155.6, 'core'], [148.8, 155.6, 'core'], [137.1, 176.1, 'body'], [152.7, 176.1, 'body'],
    [148.8, 183.0, 'body'], [144.9, 189.9, 'body'], [141.0, 196.7, 'body'], [137.1, 203.6, 'body'],
    [152.7, 203.6, 'body'],
  ],
  [
    [172.2, 73.2, 'pulse'], [176.1, 80.0, 'pulse'], [160.5, 107.5, 'body'], [176.1, 107.5, 'body'],
    [164.4, 114.4, 'body'], [160.5, 121.2, 'body'], [176.1, 121.2, 'body'], [164.4, 128.1, 'body'],
    [168.3, 135.0, 'body'], [172.2, 141.8, 'body'], [168.3, 148.7, 'body'], [172.2, 155.6, 'body'],
    [160.5, 162.4, 'body'], [176.1, 162.4, 'body'], [172.2, 169.3, 'body'], [168.3, 176.1, 'body'],
    [172.2, 183.0, 'body'], [160.5, 189.9, 'body'], [176.1, 189.9, 'body'], [164.4, 196.7, 'body'],
  ],
  [
    [191.7, 80.0, 'pulse'], [180.0, 86.9, 'pulse'], [195.6, 86.9, 'pulse'], [183.9, 93.8, 'pulse'],
    [199.5, 93.8, 'pulse'], [195.6, 100.6, 'pulse'], [187.8, 128.1, 'body'], [183.9, 135.0, 'body'],
    [183.9, 148.7, 'body'], [195.6, 155.6, 'body'], [191.7, 162.4, 'body'], [183.9, 176.1, 'body'],
  ],
  [
    [211.2, 100.6, 'pulse'], [207.3, 107.5, 'pulse'], [203.4, 114.4, 'pulse'], [219.0, 114.4, 'pulse'],
    [207.3, 121.2, 'pulse'], [222.9, 121.2, 'pulse'], [211.2, 128.1, 'pulse'], [215.1, 135.0, 'pulse'],
  ],
];

interface VloDotRevealLogoProps {
  /** Pixel dimensions of the square icon tile */
  size?: number;
  /** 'normal' for app splash launch (~1.6s graceful 60fps), 'fast' for modal headers (~1.0s) */
  speed?: 'normal' | 'fast';
  /** Border radius class override */
  roundedClassName?: string;
  className?: string;
  title?: string;
}

const ROLE_CLASS: Record<DotRole, string> = {
  body: 'fill-[#151D2A] dark:fill-[#F2F5F9]',
  pulse: 'fill-[#1769E8]',
  core: 'fill-[#059669] dark:fill-[#10B981]',
};

/**
 * VLO BD-D Liquid Dot-to-Solid Reveal Logo (60fps GPU-composited)
 * Combines a liquid-coalesce dot wave with an orbital Flow Pulse sweep
 * and spring-settled Emerald Core.
 */
export const VloDotRevealLogo: React.FC<VloDotRevealLogoProps> = ({
  size = 128,
  speed = 'normal',
  roundedClassName = 'rounded-[26%]',
  className = '',
  title = 'VLO',
}) => {
  const rawId = useId();
  const filterId = `vlo-liquid-${rawId.replace(/[:]/g, '')}`;
  const speedClass = speed === 'fast' ? 'vlo-reveal-fast' : 'vlo-reveal-normal';

  return (
    <div
      role="img"
      aria-label={title}
      style={{
        width: size,
        height: size,
        contain: 'layout style paint',
        transform: 'translateZ(0)',
      }}
      className={`relative shrink-0 overflow-hidden bg-white/95 dark:bg-[#11151B]/95 border border-black/[0.06] dark:border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_32px_-8px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_36px_-10px_rgba(0,0,0,0.45)] ${roundedClassName} ${speedClass} ${className}`}
    >
      {/* Phase 1: 8-wave GPU-composited dot matrix with subtle liquid-coalesce filter */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="14 14 228 228"
        fill="none"
        aria-hidden="true"
        className="vlo-dots-layer absolute inset-0 h-full w-full block"
      >
        <defs>
          <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.45" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -4.5"
              result="liquid"
            />
            <feComposite in="SourceGraphic" in2="liquid" operator="over" />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          {VLO_DOT_WAVES.map((points, waveIndex) => (
            <g key={waveIndex} className={`vlo-dot-wave vlo-dot-wave-${waveIndex}`}>
              {points.map(([cx, cy, role], idx) => (
                <circle
                  key={idx}
                  cx={cx}
                  cy={cy}
                  r={4.1}
                  className={ROLE_CLASS[role]}
                />
              ))}
            </g>
          ))}
        </g>
      </svg>

      {/* Phase 2: Solid crisp BD-D continuous-curve vector mark with orbital pulse & core spring */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="14 14 228 228"
        fill="none"
        aria-hidden="true"
        className="vlo-solid-layer absolute inset-0 h-full w-full block"
      >
        <path
          className="vlo-solid-body fill-[#151D2A] dark:fill-[#F2F5F9]"
          fillRule="evenodd"
          d={VLO_BODY_PATH}
        />
        <path
          className="vlo-solid-pulse fill-[#1769E8]"
          d={VLO_PULSE_PATH}
        />
        <path
          className="vlo-solid-core fill-[#059669] dark:fill-[#10B981]"
          d={VLO_CORE_PATH}
        />
      </svg>
    </div>
  );
};
