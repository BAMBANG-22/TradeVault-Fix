/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  accentColor?: 'cyan' | 'emerald' | 'rose' | 'amber' | 'blue';
  info?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  info,
}) => {
  const trendColor =
    trend === 'up'
      ? 'text-[#059669] dark:text-[#00A878]'
      : trend === 'down'
      ? 'text-[#E11D48] dark:text-[#E05260]'
      : 'text-[#526071] dark:text-[#929BA9]';

  return (
    <div className="relative rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none p-4 transition-colors duration-150 flex flex-col justify-between">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <p
              className="text-[11px] font-medium uppercase tracking-wider text-[#526071] dark:text-[#929BA9] leading-snug break-words"
              title={info}
            >
              {title}
            </p>
          </div>

          <Icon
            className="h-4 w-4 stroke-[1.75] text-[#526071] dark:text-[#929BA9] shrink-0 mt-0.5"
            aria-hidden="true"
          />
        </div>

        <div className="text-lg sm:text-xl font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] tracking-tight leading-snug break-words">
          {value}
        </div>
      </div>

      {(subtitle || trendValue) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 text-xs pt-2.5 border-t border-[#E4E4E7] dark:border-[#20252D]">
          {subtitle && (
            <span className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-snug break-words">
              {subtitle}
            </span>
          )}
          {trendValue && (
            <span
              className={`inline-flex items-center font-mono-numbers tabular-nums text-[11px] font-semibold shrink-0 ${trendColor}`}
            >
              {trendValue}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
