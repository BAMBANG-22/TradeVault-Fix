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

function getTileStyleClasses(isSelected: boolean): string {
  return isSelected
    ? 'bg-[#F4F4F5] dark:bg-[#161A22]'
    : 'bg-white dark:bg-[#101318] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]';
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

        {/* Hairline 2x4 (mobile) / 4x2 (desktop) Matrix — Neutral Surfaces + Text-Only Semantic Color */}
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
            const metricSubText = isEn && tile.metricSubEn ? tile.metricSubEn : tile.metricSub;

            return (
              <button
                key={tile.id}
                type="button"
                data-testid={`smart-heatmap-tile-${tile.id}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedTileId((prev) => (prev === tile.id ? null : tile.id))}
                className={`text-left p-3.5 sm:px-4 sm:py-3.5 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 flex flex-col justify-between gap-2 min-h-[104px] ${getTileStyleClasses(
                  isSelected
                )}`}
              >
                {/* Row 1: Factor Label + Directional Arrow */}
                <div className="flex items-start justify-between gap-2 w-full">
                  <span className="text-[11px] font-semibold text-[#526071] dark:text-[#929BA9] leading-snug break-words min-w-0">
                    {isEn ? tile.labelEn : tile.labelId}
                  </span>
                  <span className={`shrink-0 mt-0.5 ${effectTextClass}`} aria-hidden="true">
                    {tile.xauEffect === 'BULLISH' ? (
                      <ArrowUpRight className="w-3.5 h-3.5 stroke-[2]" />
                    ) : tile.xauEffect === 'BEARISH' ? (
                      <ArrowDownRight className="w-3.5 h-3.5 stroke-[2]" />
                    ) : (
                      <Minus className="w-3.5 h-3.5 stroke-[2]" />
                    )}
                  </span>
                </div>

                {/* Row 2: Primary Metric Value + Contextual Sub-Metric */}
                <div className="space-y-0.5 min-w-0">
                  <div className="text-base sm:text-lg font-bold font-mono-numbers tabular-nums tracking-tight text-[#0F172A] dark:text-[#F2F4F7] leading-tight break-words">
                    {tile.metricValue}
                  </div>
                  {metricSubText && (
                    <div className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] leading-snug break-words">
                      {metricSubText}
                    </div>
                  )}
                </div>

                {/* Row 3: Text-Only Semantic XAU Impact + Quiet Affordance */}
                <div className="flex items-baseline justify-between gap-2 pt-0.5 w-full">
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider leading-snug break-words min-w-0 ${effectTextClass}`}
                  >
                    {isEn ? tile.impactShortEn : tile.impactShortId}
                  </span>
                  <span
                    className={`text-[10px] font-sans font-medium shrink-0 ${
                      isSelected
                        ? 'text-[#0F172A] dark:text-[#F2F4F7] font-semibold'
                        : 'text-[#526071] dark:text-[#929BA9]'
                    }`}
                  >
                    {isSelected ? tr('Tutup', 'Close') : tr('Detail', 'Detail')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Interactive Detail Note (Clean Hairline Divider, zero colored left border) */}
        {selectedTile && (
          <div
            data-testid="smart-heatmap-detail-tray"
            className="pt-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-1.5 animate-in fade-in duration-150"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                <span className="text-xs font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                  {isEn ? selectedTile.labelEn : selectedTile.labelId}
                </span>
                <span className="text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                  {selectedTile.metricValue}
                  {isEn && selectedTile.metricSubEn
                    ? ` (${selectedTile.metricSubEn})`
                    : selectedTile.metricSub
                    ? ` (${selectedTile.metricSub})`
                    : ''}
                </span>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    selectedTile.xauEffect === 'BULLISH'
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : selectedTile.xauEffect === 'BEARISH'
                      ? 'text-[#E11D48] dark:text-[#E05260]'
                      : 'text-[#526071] dark:text-[#929BA9]'
                  }`}
                >
                  {isEn ? selectedTile.impactShortEn : selectedTile.impactShortId}
                </span>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9] shrink-0">
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
