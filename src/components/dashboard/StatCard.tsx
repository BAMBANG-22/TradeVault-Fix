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
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend === 'down'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-[#697586] dark:text-[#929BA9]';

  return (
    <div className="relative rounded-xl bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] p-4 transition-colors duration-150 flex flex-col justify-between">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <p
              className="text-[11px] font-medium uppercase tracking-wider text-[#697586] dark:text-[#929BA9] leading-snug break-words"
              title={info}
            >
              {title}
            </p>
          </div>

          <Icon
            className="h-4 w-4 stroke-[1.75] text-[#697586] dark:text-[#929BA9] shrink-0 mt-0.5"
            aria-hidden="true"
          />
        </div>

        <div className="text-lg sm:text-xl font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] tracking-tight leading-snug break-words">
          {value}
        </div>
      </div>

      {(subtitle || trendValue) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 text-xs pt-2.5 border-t border-[#DDE3EA] dark:border-[#252B34]">
          {subtitle && (
            <span className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-snug break-words">
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
