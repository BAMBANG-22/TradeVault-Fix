/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  EquityPoint,
  formatCurrency,
  computeDrawdownCurveSeries,
} from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { AppSettings } from '../../types/settings';
import {
  resolveEquityCurvePointAtClientX,
  buildSmoothSvgPath,
  computeDynamicChartTooltipPlacement,
  DynamicTooltipPlacement,
} from './EquityChart';

interface DrawdownChartProps {
  equityCurve: EquityPoint[];
  settings: AppSettings;
  height?: number;
  isPrivacyMode?: boolean;
  viewMode?: 'percent' | 'nominal';
}

export type DrawdownInteractionEventType =
  | 'touchstart'
  | 'touchmove'
  | 'touchend'
  | 'touchcancel'
  | 'mousedown'
  | 'mousemove'
  | 'mouseup'
  | 'mouseleave'
  | 'pointercancel'
  | 'blur';

/**
 * Pure interaction state transition helper shared with unit/integration tests.
 * Guarantees that touchstart/touchmove/mousedown/mousemove resolve the active point on the curve,
 * while touchend/touchcancel/mouseup/mouseleave/pointercancel/blur immediately clear the active point to null.
 */
export function resolveDrawdownInteractionState(
  eventType: DrawdownInteractionEventType,
  clientX: number | null,
  rect: { left: number; width: number },
  safeCurve: ReadonlyArray<EquityPoint>,
  svgWidth = 760,
  paddingLeft = 62,
  paddingRight = 16
): EquityPoint | null {
  if (
    eventType === 'touchend' ||
    eventType === 'touchcancel' ||
    eventType === 'mouseup' ||
    eventType === 'mouseleave' ||
    eventType === 'pointercancel' ||
    eventType === 'blur'
  ) {
    return null;
  }
  if (clientX === null || !Number.isFinite(clientX)) {
    return null;
  }
  return resolveEquityCurvePointAtClientX(
    clientX,
    rect,
    safeCurve,
    svgWidth,
    paddingLeft,
    paddingRight
  );
}

export const DrawdownChart: React.FC<DrawdownChartProps> = React.memo(({
  equityCurve,
  settings,
  height = 200,
  isPrivacyMode = false,
  viewMode = 'percent',
}) => {
  const { preferredCurrency, effectiveRate, formatDynamic } = useGlobalCurrency();
  const { tr } = useLanguage();
  const fmtMoney = (val: number, privacy = false) =>
    preferredCurrency === 'IDR' ? formatDynamic(val, privacy) : formatCurrency(val, settings, privacy);

  const fmtCompactAxis = (valUsd: number): string => {
    if (isPrivacyMode) return '******';
    const isIdr = preferredCurrency === 'IDR' || settings?.currency === 'IDR';
    const converted =
      preferredCurrency === 'IDR' && settings?.currency !== 'IDR'
        ? Math.round(valUsd * (effectiveRate || 16250))
        : valUsd;
    const abs = Math.abs(converted);
    if (isIdr) {
      if (abs >= 1_000_000_000) return `Rp${(abs / 1_000_000_000).toFixed(1)}M`;
      if (abs >= 1_000_000) return `Rp${(abs / 1_000_000).toFixed(1)}jt`;
      if (abs >= 1_000) return `Rp${Math.round(abs / 1_000)}rb`;
      return `Rp${Math.round(abs)}`;
    }
    const sym = settings?.currency === 'EUR' ? '€' : '$';
    if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${sym}${Math.round(abs / 1_000)}k`;
    return formatCurrency(valUsd, settings, false);
  };
  // Ephemeral interaction state ONLY — never persists a selected point after touch/mouse release
  const [hoveredPoint, setHoveredPoint] = useState<EquityPoint | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<DynamicTooltipPlacement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const lastClientXRef = useRef<number | null>(null);
  // Suppress synthetic mouse events emitted by mobile browsers right after touch release/cancel
  const lastTouchEndTimeRef = useRef<number>(0);

  const {
    safeCurve,
    hasExecutedTrades,
    hasValidStartingBalance,
    maxDrawdownAmount,
    yMax,
    tickValues,
  } = computeDrawdownCurveSeries(equityCurve, settings);

  // Ensure at least 2 points so baseline renders cleanly even when 0 trades in selected period
  const renderCurve: EquityPoint[] =
    safeCurve.length === 1
      ? [
          safeCurve[0],
          {
            ...safeCurve[0],
            index: 1,
            tradeId: 'CURRENT',
          },
        ]
      : safeCurve;

  const padding = { top: 18, right: 16, bottom: 26, left: 62 };
  const width = 760;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const getX = useCallback(
    (index: number) => {
      if (renderCurve.length <= 1) return padding.left + innerWidth / 2;
      return padding.left + (index / (renderCurve.length - 1)) * innerWidth;
    },
    [renderCurve.length, padding.left, innerWidth]
  );

  // Drawdown 0% is anchored at the top baseline (padding.top); deeper drawdown moves downward
  const getY = useCallback(
    (ddPercent: number) => {
      const safeDd = Number.isFinite(ddPercent) ? Math.max(0, ddPercent) : 0;
      const denom = yMax > 0 ? yMax : 5;
      return padding.top + (Math.min(safeDd, denom) / denom) * innerHeight;
    },
    [yMax, padding.top, innerHeight]
  );

  const points = renderCurve.map((pt, idx) => ({
    x: getX(idx),
    y: getY(pt.drawdownPercent),
  }));

  const pathD = buildSmoothSvgPath(points);
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${padding.top.toFixed(
    2
  )} L ${points[0].x.toFixed(2)} ${padding.top.toFixed(2)} Z`;

  const clearInteraction = useCallback(() => {
    lastClientXRef.current = null;
    setHoveredPoint(null);
    setTooltipPlacement(null);
  }, []);

  // Reset active interaction immediately when dataset (period) changes
  useEffect(() => {
    lastClientXRef.current = null;
    setHoveredPoint(null);
    setTooltipPlacement(null);
  }, [equityCurve]);

  // Global release/cancel/blur safety listeners while a point is active
  // Guarantees cleanup even if the user drags their finger/pointer outside the SVG and releases there
  useEffect(() => {
    if (!hoveredPoint || typeof window === 'undefined') return;

    const handleGlobalTouchEnd = () => {
      lastTouchEndTimeRef.current = Date.now();
      lastClientXRef.current = null;
      setHoveredPoint(null);
      setTooltipPlacement(null);
    };
    const handleGlobalRelease = () => {
      lastClientXRef.current = null;
      setHoveredPoint(null);
      setTooltipPlacement(null);
    };

    window.addEventListener('touchend', handleGlobalTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleGlobalTouchEnd, { passive: true });
    window.addEventListener('mouseup', handleGlobalRelease, { passive: true });
    window.addEventListener('pointercancel', handleGlobalRelease, { passive: true });
    window.addEventListener('blur', handleGlobalRelease);

    return () => {
      window.removeEventListener('touchend', handleGlobalTouchEnd);
      window.removeEventListener('touchcancel', handleGlobalTouchEnd);
      window.removeEventListener('mouseup', handleGlobalRelease);
      window.removeEventListener('pointercancel', handleGlobalRelease);
      window.removeEventListener('blur', handleGlobalRelease);
    };
  }, [hoveredPoint]);

  // Pointer/Touch scrubbing handler across the SVG plot area (identical to EquityChart)
  const resolvePointFromClientX = useCallback(
    (clientX: number) => {
      if (!hasExecutedTrades || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const point = resolveEquityCurvePointAtClientX(
        clientX,
        rect,
        safeCurve,
        width,
        padding.left,
        padding.right
      );
      if (point) {
        lastClientXRef.current = clientX;
        const measuredTooltipWidth =
          tooltipRef.current && tooltipRef.current.offsetWidth > 0
            ? tooltipRef.current.offsetWidth
            : 184;
        const measuredTooltipHeight =
          tooltipRef.current && tooltipRef.current.offsetHeight > 0
            ? tooltipRef.current.offsetHeight
            : 64;
        const placement = computeDynamicChartTooltipPlacement({
          pointIndex: point.index,
          totalPoints: renderCurve.length,
          containerWidthPx: rect.width,
          containerTopPx: rect.top,
          touchClientX: clientX,
          containerLeftPx: rect.left,
          tooltipWidthPx: measuredTooltipWidth,
          tooltipHeightPx: measuredTooltipHeight,
          svgWidth: width,
          paddingLeft: padding.left,
          paddingRight: padding.right,
        });
        setHoveredPoint(point);
        setTooltipPlacement(placement);
      }
    },
    [hasExecutedTrades, safeCurve, renderCurve.length, width, padding.left, padding.right]
  );

  // Refine placement with exact DOM offsetWidth & offsetHeight on first mount of tooltip
  useEffect(() => {
    if (!hoveredPoint || !svgRef.current || !tooltipRef.current) return;
    const actualWidth = tooltipRef.current.offsetWidth;
    const actualHeight = tooltipRef.current.offsetHeight;
    if (actualWidth <= 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const updated = computeDynamicChartTooltipPlacement({
      pointIndex: hoveredPoint.index,
      totalPoints: renderCurve.length,
      containerWidthPx: rect.width,
      containerTopPx: rect.top,
      touchClientX: lastClientXRef.current,
      containerLeftPx: rect.left,
      tooltipWidthPx: actualWidth,
      tooltipHeightPx: actualHeight > 0 ? actualHeight : 64,
      svgWidth: width,
      paddingLeft: padding.left,
      paddingRight: padding.right,
    });
    setTooltipPlacement((prev) =>
      !prev ||
      prev.leftPx !== updated.leftPx ||
      prev.vertical !== updated.vertical ||
      prev.caretOffsetPx !== updated.caretOffsetPx ||
      prev.side !== updated.side
        ? updated
        : prev
    );
  }, [hoveredPoint, renderCurve.length, width, padding.left, padding.right]);

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (Date.now() - lastTouchEndTimeRef.current < 500) return;
    resolvePointFromClientX(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (Date.now() - lastTouchEndTimeRef.current < 500) return;
    resolvePointFromClientX(e.clientX);
  };

  const handleMouseUp = () => {
    clearInteraction();
  };

  const handleMouseLeave = () => {
    clearInteraction();
  };

  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches && e.touches.length > 0) {
      resolvePointFromClientX(e.touches[0].clientX);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches && e.touches.length > 0) {
      resolvePointFromClientX(e.touches[0].clientX);
    }
  };

  const handleTouchEnd = () => {
    lastTouchEndTimeRef.current = Date.now();
    clearInteraction();
  };

  const handleTouchCancel = () => {
    lastTouchEndTimeRef.current = Date.now();
    clearInteraction();
  };

  const startLabel = hasExecutedTrades ? safeCurve[0].date.slice(0, 10) : tr('Awal', 'Start');
  const endLabel = hasExecutedTrades
    ? safeCurve[safeCurve.length - 1].date.slice(0, 10)
    : tr('Terbaru', 'Latest');

  return (
    <div className="w-full select-none">
      {!hasValidStartingBalance && hasExecutedTrades && (
        <div className="mb-2.5 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 text-[11px] text-[#D97706] dark:text-[#F59E0B]">
          {tr(
            'Saldo awal periode bernilai nol atau negatif. Persentase drawdown ditampilkan secara aman pada batas 0.00%.',
            'Period starting balance is zero or negative. Drawdown percentage is safely displayed at 0.00%.'
          )}
        </div>
      )}

      <div className="relative w-full overflow-visible">
      <svg
        ref={svgRef}
        data-testid="drawdown-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block touch-pan-y"
        style={{ maxHeight: `${height}px` }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onPointerCancel={clearInteraction}
        onLostPointerCapture={clearInteraction}
      >
        <defs>
          <linearGradient id="tvDrawdownAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E11D48" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#E11D48" stopOpacity="0.10" />
          </linearGradient>
        </defs>

        {/* Subtle horizontal gridlines & compact Y-axis labels */}
        {tickValues.map((val, i) => {
          const yPos = getY(val);
          const nominalMax = Math.max(maxDrawdownAmount, 50);
          const nominalTick = yMax > 0 ? (val / yMax) * nominalMax : 0;
          const label =
            viewMode === 'nominal'
              ? isPrivacyMode
                ? '******'
                : val <= 0.001
                ? fmtCompactAxis(0)
                : `-${fmtCompactAxis(nominalTick)}`
              : val <= 0.001
              ? '0.0%'
              : `-${val.toFixed(1)}%`;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={yPos}
                x2={width - padding.right}
                y2={yPos}
                stroke="currentColor"
                className="text-[#E4E4E7]/80 dark:text-[#20252D]"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={yPos + 3.5}
                textAnchor="end"
                className="fill-[#526071] dark:fill-[#929BA9] font-mono-numbers tabular-nums text-[10px]"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Subtle area fill between 0% baseline and drawdown curve */}
        <path d={areaD} fill="url(#tvDrawdownAreaGradient)" />

        {/* Smooth Drawdown Curve Line in soft red */}
        <path
          d={pathD}
          fill="none"
          stroke="#E11D48"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Active Hovered / Touched Point & Crosshair (ONLY rendered during active interaction) */}
        {hoveredPoint && hasExecutedTrades && (
          <g data-testid="drawdown-chart-active-marker">
            <line
              data-testid="drawdown-chart-crosshair"
              x1={getX(hoveredPoint.index)}
              y1={tooltipPlacement?.vertical === 'below' ? padding.top : 2}
              x2={getX(hoveredPoint.index)}
              y2={tooltipPlacement?.vertical === 'below' ? height - 2 : padding.top + innerHeight}
              stroke="#E11D48"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.7"
            />
            <circle
              cx={getX(hoveredPoint.index)}
              cy={getY(hoveredPoint.drawdownPercent)}
              r="8.5"
              fill="#E11D48"
              fillOpacity="0.16"
            />
            <circle
              data-testid="drawdown-chart-point-marker"
              cx={getX(hoveredPoint.index)}
              cy={getY(hoveredPoint.drawdownPercent)}
              r="4.5"
              fill="#E11D48"
              stroke="currentColor"
              className="text-white dark:text-[#101318]"
              strokeWidth="2"
            />
          </g>
        )}

        {/* Minimalist X-Axis start and end labels */}
        <g>
          <text
            x={padding.left}
            y={padding.top + innerHeight + 18}
            className="fill-[#526071] dark:fill-[#929BA9] font-mono-numbers tabular-nums text-[10px]"
            textAnchor="start"
          >
            {startLabel}
          </text>
          <text
            x={width - padding.right}
            y={padding.top + innerHeight + 18}
            className="fill-[#526071] dark:fill-[#929BA9] font-mono-numbers tabular-nums text-[10px]"
            textAnchor="end"
          >
            {endLabel}
          </text>
        </g>
      </svg>

      {/* Empty Period Notice Overlay */}
      {!hasExecutedTrades && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-3 py-1 rounded-lg bg-white/95 dark:bg-[#101318]/95 border border-[#E4E4E7] dark:border-[#20252D] text-[11px] text-[#526071] dark:text-[#929BA9]">
            {tr('Belum ada transaksi pada periode ini', 'No trades in this period')}
          </span>
        </div>
      )}

      {/* Compact Tooltip Overlay floating cleanly outside the SVG plot area (Immediately dismissed on touchend / mouseup / mouseleave) */}
      {hoveredPoint && hasExecutedTrades && (() => {
        const isBelow = tooltipPlacement?.vertical === 'below';
        const caretLeftPx = tooltipPlacement?.caretOffsetPx ?? 24;
        return (
          <div
            ref={tooltipRef}
            data-testid="drawdown-chart-tooltip"
            data-tooltip-side={tooltipPlacement?.side ?? 'right'}
            data-tooltip-vertical={tooltipPlacement?.vertical ?? 'above'}
            style={{
              transform: `translate3d(${tooltipPlacement?.leftPx ?? 6}px, 0, 0)`,
            }}
            className={`absolute left-0 z-20 max-w-[calc(100%-12px)] rounded-xl bg-white/98 dark:bg-[#101318]/98 border border-[#E4E4E7] dark:border-[#20252D] px-2.5 py-1.5 shadow-[0_10px_28px_-6px_rgba(15,23,42,0.16)] dark:shadow-[0_14px_32px_-6px_rgba(0,0,0,0.75)] text-xs pointer-events-none font-mono-numbers tabular-nums whitespace-nowrap will-change-transform ${
              isBelow ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'
            }`}
          >
            <span
              aria-hidden="true"
              style={{ left: `${caretLeftPx}px` }}
              className={`absolute h-2 w-2 -translate-x-1/2 rotate-45 bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] ${
                isBelow
                  ? '-top-[5px] border-l border-t'
                  : '-bottom-[5px] border-r border-b'
              }`}
            />
            <div className="flex items-center justify-between gap-4 text-[10px] text-[#526071] dark:text-[#929BA9] font-sans mb-0.5">
              <span>
                {hoveredPoint.index === 0 ? tr('Modal Awal', 'Initial Balance') : `Trade #${hoveredPoint.index}`}
              </span>
              <span className="font-mono-numbers">{hoveredPoint.date.slice(0, 10)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-bold text-[#E11D48] dark:text-[#E05260]">
                {hoveredPoint.drawdownPercent > 0
                  ? `-${hoveredPoint.drawdownPercent.toFixed(2)}%`
                  : '0.00%'}
              </span>
              <span className="text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {isPrivacyMode
                  ? '******'
                  : hoveredPoint.drawdownAmount > 0
                  ? `-${fmtMoney(hoveredPoint.drawdownAmount, false)}`
                  : fmtMoney(0, false)}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-[#526071] dark:text-[#929BA9] truncate">
              {tr('Puncak:', 'Peak:')}{' '}
              {isPrivacyMode
                ? '******'
                : fmtMoney(hoveredPoint.peak, false)}{' '}
              • {tr('Saldo:', 'Balance:')}{' '}
              {isPrivacyMode
                ? '******'
                : fmtMoney(hoveredPoint.equity, false)}
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
});

