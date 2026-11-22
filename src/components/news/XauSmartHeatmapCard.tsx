/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, Layers } from 'lucide-react';
import { useLanguage } from '../../utils/language';
import {
  FundamentalGoldSnapshot,
  MacroNewsSnapshot,
} from '../../utils/macroNewsEngine';
import {
  buildXauSmartHeatmap,
  SmartHeatmapTile,
  SmartHeatmapVerdict,
} from '../../utils/xauSmartHeatmap';

interface XauSmartHeatmapCardProps {
  snapshot: FundamentalGoldSnapshot;
  macroSnapshot?: MacroNewsSnapshot | null;
  syncVersion?: number;
}

function getTileStyleClasses(tile: SmartHeatmapTile, isSelected: boolean): string {
  const selectedBg = isSelected
    ? 'bg-[#F4F4F5]/90 dark:bg-[#161A22] ring-1 ring-inset ring-[#0F172A]/25 dark:ring-white/25'
    : 'bg-white dark:bg-[#0B0E13] hover:bg-[#FAFAFA] dark:hover:bg-[#101318]';

  if (!tile.isAvailable || tile.xauEffect === 'NEUTRAL') {
    return `${selectedBg} border-l-2 border-l-transparent`;
  }

  if (tile.xauEffect === 'BULLISH') {
    const bgTint =
      tile.intensity === 3
        ? 'bg-[#059669]/[0.05] dark:bg-[#00A878]/[0.08]'
        : tile.intensity === 2
        ? 'bg-[#059669]/[0.03] dark:bg-[#00A878]/[0.05]'
        : 'bg-white dark:bg-[#0B0E13]';
    const selectedOverride = isSelected
      ? 'bg-[#059669]/[0.07] dark:bg-[#00A878]/[0.11] ring-1 ring-inset ring-[#059669]/35 dark:ring-[#00A878]/40'
      : `${bgTint} hover:bg-[#059669]/[0.06] dark:hover:bg-[#00A878]/[0.09]`;
    return `${selectedOverride} border-l-2 border-l-[#059669] dark:border-l-[#00A878]`;
  }

  const bgTint =
    tile.intensity === 3
      ? 'bg-[#E11D48]/[0.05] dark:bg-[#E05260]/[0.08]'
      : tile.intensity === 2
      ? 'bg-[#E11D48]/[0.03] dark:bg-[#E05260]/[0.05]'
      : 'bg-white dark:bg-[#0B0E13]';
  const selectedOverride = isSelected
    ? 'bg-[#E11D48]/[0.07] dark:bg-[#E05260]/[0.11] ring-1 ring-inset ring-[#E11D48]/35 dark:ring-[#E05260]/40'
    : `${bgTint} hover:bg-[#E11D48]/[0.06] dark:hover:bg-[#E05260]/[0.09]`;
  return `${selectedOverride} border-l-2 border-l-[#E11D48] dark:border-l-[#E05260]`;
}

function getVerdictColorClass(verdict: SmartHeatmapVerdict): string {
  if (verdict === 'STRONG_BULLISH' || verdict === 'BULLISH') {
    return 'text-[#059669] dark:text-[#00A878]';
  }
  if (verdict === 'STRONG_BEARISH' || verdict === 'BEARISH') {
    return 'text-[#E11D48] dark:text-[#E05260]';
  }
  return 'text-[#526071] dark:text-[#929BA9]';
}

export const XauSmartHeatmapCard: React.FC<XauSmartHeatmapCardProps> = React.memo(
  ({ snapshot, macroSnapshot, syncVersion = 0 }) => {
    const { isEn, tr } = useLanguage();
    const [selectedTileId, setSelectedTileId] = useState<string | null>(null);

    const model = useMemo(
      () => buildXauSmartHeatmap(snapshot, macroSnapshot),
      [snapshot, macroSnapshot, syncVersion]
    );

    const selectedTile = useMemo(
      () => model.tiles.find((t) => t.id === selectedTileId) || null,
      [model.tiles, selectedTileId]
    );

    const verdictColor = getVerdictColorClass(model.verdict);

    return (
      <section
        data-testid="xau-smart-heatmap"
        aria-label={tr('Smart Heatmap XAU/USD', 'XAU/USD Smart Heatmap')}
        className="space-y-4 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]"
      >
        {/* Section Eyebrow + Compact Verdict Row */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2.5">
          <div className="space-y-1 min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
              {tr('02 / SMART HEATMAP · DAMPAK KE XAU/USD', '02 / SMART HEATMAP · IMPACT ON XAU/USD')}
            </span>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <h2
                data-testid="smart-heatmap-verdict"
                className={`text-base sm:text-lg font-bold tracking-tight ${verdictColor}`}
              >
                {isEn ? model.verdictTitleEn : model.verdictTitleId}
              </h2>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                {model.bullishCount} Bullish · {model.bearishCount} Bearish · {model.neutralCount}{' '}
                {tr('Netral', 'Neutral')}
              </span>
            </div>
          </div>

          {/* Quiet Monochrome Legend with semantic dots */}
          <div className="flex items-center gap-3.5 text-[11px] text-[#526071] dark:text-[#929BA9] shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#059669] dark:bg-[#00A878]" />
              <span>{tr('Dukung XAU', 'Bullish XAU')}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E11D48] dark:bg-[#E05260]" />
              <span>{tr('Tekan XAU', 'Bearish XAU')}</span>
            </span>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
          {isEn ? model.verdictSummaryEn : model.verdictSummaryId}
        </p>

        {/* Hairline 2x4 (mobile) / 4x2 (desktop) Matrix — Open Canvas, zero heavy outer card */}
        <div
          data-testid="smart-heatmap-grid"
          className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#E4E4E7] dark:bg-[#20252D] border border-[#E4E4E7] dark:border-[#20252D] rounded-xl overflow-hidden"
        >
          {model.tiles.map((tile) => {
            const isSelected = selectedTileId === tile.id;
            const effectTextClass =
              tile.xauEffect === 'BULLISH'
                ? 'text-[#059669] dark:text-[#00A878]'
                : tile.xauEffect === 'BEARISH'
                ? 'text-[#E11D48] dark:text-[#E05260]'
                : 'text-[#526071] dark:text-[#929BA9]';

            return (
              <button
                key={tile.id}
                type="button"
                data-testid={`smart-heatmap-tile-${tile.id}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedTileId((prev) => (prev === tile.id ? null : tile.id))}
                className={`text-left px-3.5 py-3 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 flex flex-col justify-between min-h-[82px] ${getTileStyleClasses(
                  tile,
                  isSelected
                )}`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <span className="text-[11px] font-semibold text-[#526071] dark:text-[#929BA9] leading-tight truncate">
                    {isEn ? tile.labelEn : tile.labelId}
                  </span>
                  <span className={`shrink-0 ${effectTextClass}`}>
                    {tile.xauEffect === 'BULLISH' ? (
                      <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.2]" />
                    ) : tile.xauEffect === 'BEARISH' ? (
                      <ArrowDownRight className="w-3.5 h-3.5 stroke-[2.2]" />
                    ) : (
                      <Minus className="w-3.5 h-3.5 stroke-[2]" />
                    )}
                  </span>
                </div>

                <div className="mt-2 space-y-0.5">
                  <div className="flex items-baseline justify-between gap-1.5">
                    <span className="text-xs sm:text-[13px] font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] truncate">
                      {tile.metricValue}
                    </span>
                    <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] truncate">
                      {isEn && tile.metricSubEn ? tile.metricSubEn : tile.metricSub}
                    </span>
                  </div>
                  <div className={`text-[10px] font-semibold truncate ${effectTextClass}`}>
                    {isEn ? tile.impactShortEn : tile.impactShortId}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Interactive Detail Note (Hairline left-accent callout, no boxed card clutter) */}
        {selectedTile && (
          <div
            data-testid="smart-heatmap-detail-tray"
            className={`pl-3.5 py-1 border-l-2 space-y-1 animate-in fade-in duration-150 ${
              selectedTile.xauEffect === 'BULLISH'
                ? 'border-[#059669] dark:border-[#00A878]'
                : selectedTile.xauEffect === 'BEARISH'
                ? 'border-[#E11D48] dark:border-[#E05260]'
                : 'border-[#526071] dark:border-[#929BA9]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {isEn ? selectedTile.labelEn : selectedTile.labelId} ·{' '}
                <span className="font-mono-numbers tabular-nums font-semibold text-[#526071] dark:text-[#929BA9]">
                  {selectedTile.metricValue} (
                  {isEn && selectedTile.metricSubEn ? selectedTile.metricSubEn : selectedTile.metricSub})
                </span>
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] shrink-0">
                {isEn ? selectedTile.sourceTagEn : selectedTile.sourceTagId}
              </span>
            </div>
            <p className="text-xs text-[#334155] dark:text-[#CBD5E1] leading-relaxed text-editorial-justify">
              {isEn ? selectedTile.detailEn : selectedTile.detailId}
            </p>
          </div>
        )}

        {/* Quiet Sync Meta Line */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#526071] dark:text-[#929BA9]">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>
              {tr('Sinkron:', 'Synced:')} {isEn ? model.syncedSourcesEn : model.syncedSourcesId}
            </span>
          </span>
          <span>
            {tr('Ketuk sel untuk detail dampak XAU/USD', 'Tap any cell for XAU/USD impact')}
          </span>
        </div>
      </section>
    );
  }
);

XauSmartHeatmapCard.displayName = 'XauSmartHeatmapCard';
