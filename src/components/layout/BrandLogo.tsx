/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface BrandLogoProps {
  /**
   * 'symbol': square mark (viewBox 0 0 256 256)
   * 'wordmark': vector wordmark "TradeVault" only (viewBox 270 64 715 128)
   * 'lockup': horizontal mark with vector wordmark (viewBox 0 0 1019 256)
   */
  variant?: 'symbol' | 'wordmark' | 'lockup';
  className?: string;
  title?: string;
}

/**
 * TradeVault Active Brand Logo Component (CV3-R2 Version A — "Dual Embrace")
 *
 * Strict vector path preservation:
 * - Symbol: 2 paths (U-Cradle base + Inverted-L keystone)
 * - Wordmark: 2 paths ("Trade" + "Vault")
 * - Lockup: 4 paths (Symbol base + Symbol keystone + "Trade" wordmark + "Vault" wordmark)
 *
 * Theme color adaptation:
 * - Light surface: Navy (#172033) + Primary Blue (#1458C4)
 * - Dark surface: Light Surface (#F8FAFC) + Sky Blue Accent (#38BDF8)
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'lockup',
  className = 'h-8 w-auto',
  title = 'TradeVault',
}) => {
  if (variant === 'symbol') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        fill="none"
        aria-label={title}
        role="img"
        className={`shrink-0 ${className}`}
      >
        <title>{title}</title>
        {/* Base U-cradle: Navy on light, Off-white on dark */}
        <path
          className="fill-[#172033] dark:fill-[#F8FAFC] transition-colors duration-150"
          d="M 28 54 A 26 26 0 0 1 80 54 V 162 A 14 14 0 0 0 94 176 H 162 A 14 14 0 0 0 176 162 V 128 A 26 26 0 0 1 228 128 V 176 A 52 52 0 0 1 176 228 H 80 A 52 52 0 0 1 28 176 Z"
        />
        {/* Keystone inverted-L: Blue on light, Sky blue on dark */}
        <path
          className="fill-[#1458C4] dark:fill-[#38BDF8] transition-colors duration-150"
          d="M 128 28 H 194 A 34 34 0 0 1 228 62 A 18 18 0 0 1 210 80 H 168 A 14 14 0 0 0 154 94 V 128 A 26 26 0 0 1 102 128 V 54 A 26 26 0 0 1 128 28 Z"
        />
      </svg>
    );
  }

  if (variant === 'wordmark') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="275 72 705 112"
        fill="none"
        aria-label={title}
        role="img"
        className={`shrink-0 ${className}`}
      >
        <title>{title}</title>
        {/* Vector Wordmark "Trade" */}
        <path
          className="fill-[#172033] dark:fill-[#F8FAFC] transition-colors duration-150"
          fillRule="evenodd"
          d="M 280 80 H 346 V 98 H 322 V 176 H 304 V 98 H 280 Z M 358 104 H 402 V 122 H 384 A 8 8 0 0 0 376 130 V 176 H 358 Z M 438 104 H 458 A 20 20 0 0 1 478 124 V 176 H 460 V 170 H 438 A 24 24 0 0 1 414 146 V 128 A 24 24 0 0 1 438 104 Z M 432 136 V 144 A 14 14 0 0 0 460 144 V 136 A 14 14 0 0 0 432 136 Z M 538 80 H 556 V 176 H 516 A 24 24 0 0 1 492 152 V 128 A 24 24 0 0 1 516 104 H 538 V 80 Z M 510 136 V 144 A 14 14 0 0 0 538 144 V 136 A 14 14 0 0 0 510 136 Z M 594 104 H 614 A 20 20 0 0 1 634 124 V 146 H 588 V 160 H 632 V 176 H 594 A 24 24 0 0 1 570 152 V 128 A 24 24 0 0 1 594 104 Z M 588 120 V 132 H 616 V 120 Z"
        />
        {/* Vector Wordmark "Vault" */}
        <path
          className="fill-[#1458C4] dark:fill-[#38BDF8] transition-colors duration-150"
          fillRule="evenodd"
          d="M 652 80 H 670.43 L 689.72 152 L 689.72 152 L 709.01 80 H 727.44 L 701.72 176 H 677.72 Z M 763.44 104 H 783.44 A 20 20 0 0 1 803.44 124 V 176 H 785.44 V 170 H 763.44 A 24 24 0 0 1 739.44 146 V 128 A 24 24 0 0 1 763.44 104 Z M 757.44 136 V 144 A 14 14 0 0 0 785.44 144 V 136 A 14 14 0 0 0 757.44 136 Z M 817.44 104 H 835.44 V 154 A 6 6 0 0 0 841.44 160 H 855.44 A 6 6 0 0 0 861.44 154 V 104 H 879.44 V 154 A 22 22 0 0 1 857.44 176 H 839.44 A 22 22 0 0 1 817.44 154 Z M 893.44 80 H 911.44 V 176 H 893.44 Z M 935.44 84 H 953.44 V 104 H 971.44 V 120 H 953.44 V 160 H 971.44 V 176 H 951.44 A 16 16 0 0 1 935.44 160 V 120 H 925.44 V 104 H 935.44 Z"
        />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1019 256"
      fill="none"
      aria-label={title}
      role="img"
      className={`shrink-0 ${className}`}
    >
      <title>{title}</title>
      {/* Symbol Base U-cradle */}
      <path
        className="fill-[#172033] dark:fill-[#F8FAFC] transition-colors duration-150"
        d="M 48 54 A 26 26 0 0 1 100 54 V 162 A 14 14 0 0 0 114 176 H 182 A 14 14 0 0 0 196 162 V 128 A 26 26 0 0 1 248 128 V 176 A 52 52 0 0 1 196 228 H 100 A 52 52 0 0 1 48 176 Z"
      />
      {/* Symbol Keystone inverted-L */}
      <path
        className="fill-[#1458C4] dark:fill-[#38BDF8] transition-colors duration-150"
        d="M 148 28 H 214 A 34 34 0 0 1 248 62 A 18 18 0 0 1 230 80 H 188 A 14 14 0 0 0 174 94 V 128 A 26 26 0 0 1 122 128 V 54 A 26 26 0 0 1 148 28 Z"
      />
      {/* Vector Wordmark "Trade" */}
      <path
        className="fill-[#172033] dark:fill-[#F8FAFC] transition-colors duration-150"
        fillRule="evenodd"
        d="M 280 80 H 346 V 98 H 322 V 176 H 304 V 98 H 280 Z M 358 104 H 402 V 122 H 384 A 8 8 0 0 0 376 130 V 176 H 358 Z M 438 104 H 458 A 20 20 0 0 1 478 124 V 176 H 460 V 170 H 438 A 24 24 0 0 1 414 146 V 128 A 24 24 0 0 1 438 104 Z M 432 136 V 144 A 14 14 0 0 0 460 144 V 136 A 14 14 0 0 0 432 136 Z M 538 80 H 556 V 176 H 516 A 24 24 0 0 1 492 152 V 128 A 24 24 0 0 1 516 104 H 538 V 80 Z M 510 136 V 144 A 14 14 0 0 0 538 144 V 136 A 14 14 0 0 0 510 136 Z M 594 104 H 614 A 20 20 0 0 1 634 124 V 146 H 588 V 160 H 632 V 176 H 594 A 24 24 0 0 1 570 152 V 128 A 24 24 0 0 1 594 104 Z M 588 120 V 132 H 616 V 120 Z"
      />
      {/* Vector Wordmark "Vault" */}
      <path
        className="fill-[#1458C4] dark:fill-[#38BDF8] transition-colors duration-150"
        fillRule="evenodd"
        d="M 652 80 H 670.43 L 689.72 152 L 689.72 152 L 709.01 80 H 727.44 L 701.72 176 H 677.72 Z M 763.44 104 H 783.44 A 20 20 0 0 1 803.44 124 V 176 H 785.44 V 170 H 763.44 A 24 24 0 0 1 739.44 146 V 128 A 24 24 0 0 1 763.44 104 Z M 757.44 136 V 144 A 14 14 0 0 0 785.44 144 V 136 A 14 14 0 0 0 757.44 136 Z M 817.44 104 H 835.44 V 154 A 6 6 0 0 0 841.44 160 H 855.44 A 6 6 0 0 0 861.44 154 V 104 H 879.44 V 154 A 22 22 0 0 1 857.44 176 H 839.44 A 22 22 0 0 1 817.44 154 Z M 893.44 80 H 911.44 V 176 H 893.44 Z M 935.44 84 H 953.44 V 104 H 971.44 V 120 H 953.44 V 160 H 971.44 V 176 H 951.44 A 16 16 0 0 1 935.44 160 V 120 H 925.44 V 104 H 935.44 Z"
      />
    </svg>
  );
};
