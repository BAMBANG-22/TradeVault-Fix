/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  EquityPoint,
  formatCurrency,
  formatGrowthPercent,
  computeEquityChartSeries,
  computeEquityChartAxis,
} from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { AppSettings } from '../../types/settings';
import { TrendingUp, Layers } from 'lucide-react';

interface EquityChartProps {
  equityCurve: EquityPoint[];
  settings: AppSettings;
  startingBalance?: number;
  height?: number;
  isPrivacyMode?: boolean;
  embedded?: boolean;
  periodControl?: React.ReactNode;
  externalViewMode?: 'equity' | 'growth';
  hideInternalControls?: boolean;
}

/**
 * Resolves the nearest EquityPoint on the curve for a given horizontal clientX coordinate.
 * Returns null if there are no executed trades in the period or the bounding width is invalid.
 */
export function resolveEquityCurvePointAtClientX(
  clientX: number,
  rect: { left: number; width: number },
  safeCurve: ReadonlyArray<EquityPoint>,
  svgWidth = 760,
  paddingLeft = 62,
  paddingRight = 16
): EquityPoint | null {
  if (safeCurve.length <= 1 || rect.width <= 0) return null;
  const innerWidth = svgWidth - paddingLeft - paddingRight;
  const svgX = ((clientX - rect.left) / rect.width) * svgWidth;
  const clampedX = Math.max(paddingLeft, Math.min(svgWidth - paddingRight, svgX));
  const ratio = (clampedX - paddingLeft) / (innerWidth || 1);
  const nearestIndex = Math.round(ratio * (safeCurve.length - 1));
  const boundedIndex = Math.max(0, Math.min(safeCurve.length - 1, nearestIndex));
  return safeCurve[boundedIndex] ?? null;
}

export interface DynamicTooltipPlacement {
  side: 'left' | 'right';
  leftPx: number;
  pointPx: number;
  touchPx: number;
  plotRatio: number;
}

/**
 * Shared dynamic horizontal tooltip positioning engine for EquityChart and DrawdownChart.
 * - Uses the active touch/point position relative to the chart plot area width.
 * - Left half of chart (plotRatio < 0.5) -> places tooltip to the RIGHT of the active point/finger.
 * - Right half of chart (plotRatio >= 0.5) -> places tooltip to the LEFT of the active point/finger.
 * - Clamps strictly within [edgeMarginPx, containerWidthPx - tooltipWidthPx - edgeMarginPx]
 *   so the tooltip never overflows the chart container or covers the active point/finger.
 */
export function computeDynamicChartTooltipPlacement(params: {
  pointIndex: number;
  totalPoints: number;
  containerWidthPx: number;
  touchClientX?: number | null;
  containerLeftPx?: number;
  tooltipWidthPx?: number;
  svgWidth?: number;
  paddingLeft?: number;
  paddingRight?: number;
  gapPx?: number;
  edgeMarginPx?: number;
}): DynamicTooltipPlacement {
  const {
    pointIndex,
    totalPoints,
    containerWidthPx,
    touchClientX = null,
    containerLeftPx = 0,
    tooltipWidthPx = 148,
    svgWidth = 760,
    paddingLeft = 62,
    paddingRight = 16,
    gapPx = 16,
    edgeMarginPx = 8,
  } = params;

  const safeContainerWidth =
    Number.isFinite(containerWidthPx) && containerWidthPx > 0 ? containerWidthPx : 360;
  const safeTooltipWidth =
    Number.isFinite(tooltipWidthPx) && tooltipWidthPx > 0
      ? Math.min(tooltipWidthPx, Math.max(80, safeContainerWidth - edgeMarginPx * 2))
      : 148;

  const innerSvgWidth = svgWidth - paddingLeft - paddingRight;
  const clampedIndex = Math.max(0, Math.min(Math.max(0, totalPoints - 1), pointIndex));
  const pointPlotRatio = totalPoints > 1 ? clampedIndex / (totalPoints - 1) : 0;

  const pointSvgX = paddingLeft + pointPlotRatio * innerSvgWidth;
  const pointPx = (pointSvgX / svgWidth) * safeContainerWidth;

  const plotLeftPx = (paddingLeft / svgWidth) * safeContainerWidth;
  const plotRightPx = ((svgWidth - paddingRight) / svgWidth) * safeContainerWidth;
  const plotWidthPx = Math.max(1, plotRightPx - plotLeftPx);

  const hasValidTouchX =
    touchClientX !== null &&
    touchClientX !== undefined &&
    Number.isFinite(touchClientX) &&
    Number.isFinite(containerLeftPx);

  const touchPx = hasValidTouchX
    ? Math.max(plotLeftPx, Math.min(plotRightPx, touchClientX - containerLeftPx))
    : pointPx;

  const touchPlotRatio = Math.max(0, Math.min(1, (touchPx - plotLeftPx) / plotWidthPx));
  const effectiveRatio = hasValidTouchX ? touchPlotRatio : pointPlotRatio;

  const minLeftPx = edgeMarginPx;
  const maxLeftPx = Math.max(minLeftPx, safeContainerWidth - safeTooltipWidth - edgeMarginPx);
  const minSafeGapPx = Math.min(gapPx, 10);

  // Core rule: left half (< 0.5) -> tooltip on right; right half (>= 0.5) -> tooltip on left
  let side: 'left' | 'right' = effectiveRatio < 0.5 ? 'right' : 'left';

  const rightAnchorPx = Math.max(pointPx, touchPx);
  const leftAnchorPx = Math.min(pointPx, touchPx);

  const fitsRightOfPoint =
    pointPx + minSafeGapPx + safeTooltipWidth <= safeContainerWidth - edgeMarginPx;
  const fitsLeftOfPoint = pointPx - minSafeGapPx - safeTooltipWidth >= edgeMarginPx;

  if (side === 'right' && !fitsRightOfPoint && fitsLeftOfPoint) {
    side = 'left';
  } else if (side === 'left' && !fitsLeftOfPoint && fitsRightOfPoint) {
    side = 'right';
  }

  let rawLeftPx: number;
  if (side === 'right') {
    const preferredRight = rightAnchorPx + gapPx;
    rawLeftPx =
      preferredRight + safeTooltipWidth <= safeContainerWidth - edgeMarginPx
        ? preferredRight
        : pointPx + gapPx;
  } else {
    const preferredLeft = leftAnchorPx - safeTooltipWidth - gapPx;
    rawLeftPx =
      preferredLeft >= edgeMarginPx ? preferredLeft : pointPx - safeTooltipWidth - gapPx;
  }

  const leftPx = Math.round(Math.max(minLeftPx, Math.min(maxLeftPx, rawLeftPx)));

  return {
    side,
    leftPx,
    pointPx: Number(pointPx.toFixed(2)),
    touchPx: Number(touchPx.toFixed(2)),
    plotRatio: Number(effectiveRatio.toFixed(4)),
  };
}

/**
 * Builds a monotone cubic Hermite spline SVG path through the given points.
 * Guarantees smooth visual curves that pass through every exact data point
 * without overshooting local minima or maxima.
 */
export function buildSmoothSvgPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dxi = points[i + 1].x - points[i].x;
    const dyi = points[i + 1].y - points[i].y;
    dx.push(dxi);
    dy.push(dyi);
    m.push(dxi !== 0 ? dyi / dxi : 0);
  }

  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = m[0];
  tangents[n - 1] = m[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangents[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const step = dx[i] / 3;
    const cp1x = p0.x + step;
    const cp1y = p0.y + tangents[i] * step;
    const cp2x = p1.x - step;
    const cp2y = p1.y - tangents[i + 1] * step;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  }

  return d;
}

function formatCompactAxisCurrency(
  val: number,
  settings: AppSettings,
  isPrivacyMode: boolean,
  preferredCurrency: 'USD' | 'IDR' = 'USD',
  effectiveRate = 16250
): string {
  if (isPrivacyMode) {
    return '******';
  }
  const isIdr = preferredCurrency === 'IDR' || settings?.currency === 'IDR';
  const convertedVal =
    preferredCurrency === 'IDR' && settings?.currency !== 'IDR'
      ? Math.round(val * effectiveRate)
      : val;
  const symbol = isIdr ? 'Rp' : settings?.currency === 'EUR' ? '€' : '$';
  const abs = Math.abs(convertedVal);
  const sign = convertedVal < 0 ? '-' : '';
  if (isIdr) {
    if (abs >= 1_000_000_000) {
      return `${sign}${symbol}${(abs / 1_000_000_000).toFixed(1)}M`;
    }
    if (abs >= 1_000_000) {
      return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}jt`;
    }
    return `${sign}Rp ${Math.round(abs).toLocaleString('id-ID')}`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${symbol}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 10_000) {
    return `${sign}${symbol}${Math.round(abs).toLocaleString('en-US')}`;
  }
  return formatCurrency(val, settings, false);
}

export const EquityChart: React.FC<EquityChartProps> = ({
  equityCurve,
  settings,
  startingBalance,
  height = 240,
  isPrivacyMode = false,
  embedded = false,
  periodControl,
  externalViewMode,
  hideInternalControls = false,
}) => {
  const { preferredCurrency, effectiveRate, formatDynamic } = useGlobalCurrency();
  const { tr } = useLanguage();
  const [hoveredPoint, setHoveredPoint] = useState<EquityPoint | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<DynamicTooltipPlacement | null>(null);
  const [internalViewMode, setInternalViewMode] = useState<'equity' | 'growth'>('equity');
  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = setInternalViewMode;
  const [showPeakLine, setShowPeakLine] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const lastClientXRef = useRef<number | null>(null);
  // Suppress synthetic mouse events emitted by mobile browsers right after touch release/cancel
  const lastTouchEndTimeRef = useRef<number>(0);

  const safeCurve: EquityPoint[] =
    equityCurve && equityCurve.length > 0
      ? equityCurve
      : [
          {
            index: 0,
            date: new Date().toISOString(),
            tradeId: 'START',
            netProfit: 0,
            equity: startingBalance ?? settings.startingBalance ?? 0,
            peak: startingBalance ?? settings.startingBalance ?? 0,
            drawdownAmount: 0,
            drawdownPercent: 0,
            growthPercent: 0,
            peakGrowthPercent: 0,
            hasValidGrowthPercent: (startingBalance ?? settings.startingBalance ?? 0) > 0,
            outcome: 'START',
          },
        ];

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

  const hasExecutedTrades = safeCurve.length > 1;

  const padding = { top: 18, right: 16, bottom: 26, left: 62 };
  const width = 760;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // Single authoritative series for Equity Curve & High Watermark (shared with Analytics)
  const { chartStartingBalance, hasValidGrowth, values, peakValues } = computeEquityChartSeries(
    renderCurve,
    settings,
    viewMode,
    startingBalance
  );

  const { minValue, maxValue, tickValues } = computeEquityChartAxis(values, peakValues, viewMode);

  const getX = useCallback(
    (index: number) => {
      if (renderCurve.length <= 1) return padding.left + innerWidth / 2;
      return padding.left + (index / (renderCurve.length - 1)) * innerWidth;
    },
    [renderCurve.length, padding.left, innerWidth]
  );

  const getY = useCallback(
    (val: number) => {
      const denom = maxValue - minValue || 1;
      return padding.top + innerHeight - ((val - minValue) / denom) * innerHeight;
    },
    [maxValue, minValue, padding.top, innerHeight]
  );

  const points = values.map((val, idx) => ({
    x: getX(idx),
    y: getY(val),
  }));

  const pathD = buildSmoothSvgPath(points);
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${(
    padding.top + innerHeight
  ).toFixed(2)} L ${points[0].x.toFixed(2)} ${(padding.top + innerHeight).toFixed(2)} Z`;

  const peakPoints = peakValues.map((val, idx) => ({
    x: getX(idx),
    y: getY(val),
  }));
  const peakPathD = buildSmoothSvgPath(peakPoints);

  // Use 3 clean horizontal gridlines (bottom, middle, top) to avoid visual clutter
  const selectedTickIndices =
    tickValues.length >= 5 ? [0, 2, 4] : tickValues.map((_, idx) => idx);

  const yTicks = selectedTickIndices.map((idx) => {
    const val = tickValues[idx];
    const yPos = getY(val);
    return {
      value: val,
      yPos,
      label:
        viewMode === 'equity'
          ? formatCompactAxisCurrency(val, settings, isPrivacyMode, preferredCurrency, effectiveRate)
          : hasValidGrowth
          ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`
          : 'N/A',
    };
  });

  const clearInteraction = useCallback(() => {
    lastClientXRef.current = null;
    setHoveredPoint(null);
    setTooltipPlacement(null);
  }, []);

  // Reset active interaction immediately when dataset (period) or view mode (Saldo/Persen) changes
  useEffect(() => {
    lastClientXRef.current = null;
    setHoveredPoint(null);
    setTooltipPlacement(null);
  }, [equityCurve, viewMode]);

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

  // Pointer/Touch scrubbing handler across the SVG plot area
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
            : 148;
        const placement = computeDynamicChartTooltipPlacement({
          pointIndex: point.index,
          totalPoints: renderCurve.length,
          containerWidthPx: rect.width,
          touchClientX: clientX,
          containerLeftPx: rect.left,
          tooltipWidthPx: measuredTooltipWidth,
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

  // Refine placement with exact DOM offsetWidth on first mount of tooltip
  useEffect(() => {
    if (!hoveredPoint || !svgRef.current || !tooltipRef.current) return;
    const actualWidth = tooltipRef.current.offsetWidth;
    if (actualWidth <= 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const updated = computeDynamicChartTooltipPlacement({
      pointIndex: hoveredPoint.index,
      totalPoints: renderCurve.length,
      containerWidthPx: rect.width,
      touchClientX: lastClientXRef.current,
      containerLeftPx: rect.left,
      tooltipWidthPx: actualWidth,
      svgWidth: width,
      paddingLeft: padding.left,
      paddingRight: padding.right,
    });
    setTooltipPlacement((prev) =>
      !prev || prev.leftPx !== updated.leftPx || prev.side !== updated.side ? updated : prev
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

  const modeSelector = (
    <div
      data-testid="equity-mode-toggle"
      className="relative inline-flex items-center rounded-full bg-[#F5F7FA] dark:bg-[#101318] p-1 border border-[#DDE3EA] dark:border-[#20252D] text-xs select-none"
    >
      {/* Smooth animated sliding pill indicator */}
      <span
        className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-white dark:bg-[#1F2633] transition-all duration-200 ease-out shadow-xs pointer-events-none ${
          viewMode === 'equity' ? 'left-1' : 'left-[calc(50%)]'
        }`}
        aria-hidden="true"
      />
      <button
        type="button"
        data-testid="equity-mode-saldo"
        onClick={() => {
          clearInteraction();
          setViewMode('equity');
        }}
        className={`relative z-10 px-3.5 py-1 rounded-full font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap ${
          viewMode === 'equity'
            ? 'text-[#151D2A] dark:text-[#F2F4F7]'
            : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
        }`}
      >
        {tr('Saldo', 'Balance')}
      </button>
      <button
        type="button"
        data-testid="equity-mode-persen"
        onClick={() => {
          clearInteraction();
          setViewMode('growth');
        }}
        className={`relative z-10 px-3.5 py-1 rounded-full font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap ${
          viewMode === 'growth'
            ? 'text-[#151D2A] dark:text-[#F2F4F7]'
            : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
        }`}
      >
        {tr('Persen', 'Percent')}
      </button>
    </div>
  );

  const chartBody = (
    <>
      {embedded && !hideInternalControls && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          {modeSelector}
          {periodControl}
        </div>
      )}
      <div className="relative w-full overflow-hidden select-none">
        {viewMode === 'growth' && !hasValidGrowth && (
          <div className="mb-2.5 rounded-xl bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400 flex items-center justify-between gap-2">
            <span>
              {tr(
                'Persentase pertumbuhan (N/A) tidak dapat dihitung karena saldo awal periode bernilai nol atau negatif.',
                'Growth percentage (N/A) cannot be calculated because the period starting balance is zero or negative.'
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                clearInteraction();
                setViewMode('equity');
              }}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#0B0D10] border border-[#DDE3EA] dark:border-[#20252D] text-[#151D2A] dark:text-[#F2F4F7] font-semibold shrink-0 cursor-pointer"
            >
              {tr('Saldo', 'Balance')}
            </button>
          </div>
        )}

        <svg
          ref={svgRef}
          data-testid="equity-chart-svg"
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
            <linearGradient id="tvEquityAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3478DC" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#3478DC" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Subtle horizontal gridlines & compact Y-axis labels */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                y1={tick.yPos}
                x2={width - padding.right}
                y2={tick.yPos}
                stroke="currentColor"
                className="text-[#DDE3EA]/80 dark:text-[#20252D]"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={tick.yPos + 3.5}
                textAnchor="end"
                className="fill-[#697586] dark:fill-[#929BA9] font-mono-numbers tabular-nums text-[10px]"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Subtle area fill under curve */}
          <path d={areaD} fill="url(#tvEquityAreaGradient)" />

          {/* Optional High Watermark line (Analytics mode) */}
          {!embedded && showPeakLine && (
            <path
              d={peakPathD}
              fill="none"
              stroke="#697586"
              strokeWidth="1.25"
              strokeDasharray="4 4"
              opacity="0.45"
            />
          )}

          {/* Smooth Equity Curve Line with Obsidian Blue Accent */}
          <path
            d={pathD}
            fill="none"
            stroke="#3478DC"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Active Hovered / Touched Point & Crosshair */}
          {hoveredPoint && hasExecutedTrades && (
            <g data-testid="equity-chart-active-marker">
              <line
                data-testid="equity-chart-crosshair"
                x1={getX(hoveredPoint.index)}
                y1={padding.top}
                x2={getX(hoveredPoint.index)}
                y2={padding.top + innerHeight}
                stroke="#3478DC"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.7"
              />
              <circle
                data-testid="equity-chart-point-marker"
                cx={getX(hoveredPoint.index)}
                cy={getY(values[hoveredPoint.index] ?? values[0])}
                r="4.5"
                fill="#3478DC"
                stroke="currentColor"
                className="text-white dark:text-[#0B0D10]"
                strokeWidth="2"
              />
            </g>
          )}

          {/* Minimalist X-Axis start and end labels */}
          <g>
            <text
              x={padding.left}
              y={padding.top + innerHeight + 18}
              className="fill-[#697586] dark:fill-[#929BA9] font-mono-numbers tabular-nums text-[10px]"
              textAnchor="start"
            >
              {startLabel}
            </text>
            <text
              x={width - padding.right}
              y={padding.top + innerHeight + 18}
              className="fill-[#697586] dark:fill-[#929BA9] font-mono-numbers tabular-nums text-[10px]"
              textAnchor="end"
            >
              {endLabel}
            </text>
          </g>
        </svg>

        {/* Empty Period Notice Overlay */}
        {!hasExecutedTrades && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="px-3.5 py-1.5 rounded-full bg-white/90 dark:bg-[#101318]/90 border border-[#DDE3EA] dark:border-[#20252D] text-[11px] text-[#697586] dark:text-[#929BA9] shadow-xs">
              {tr('Belum ada transaksi pada periode ini', 'No trades in this period yet')}
            </span>
          </div>
        )}

        {/* Compact Tooltip Overlay on Hover / Touch */}
        {hoveredPoint &&
          hasExecutedTrades &&
          (() => {
            const hoveredGrowthPct = !hasValidGrowth
              ? 0
              : hoveredPoint.index === 0 &&
                Math.abs(hoveredPoint.equity - chartStartingBalance) < 0.01
              ? 0
              : Number(
                  (
                    ((hoveredPoint.equity - chartStartingBalance) / chartStartingBalance) *
                    100
                  ).toFixed(2)
                );

            const fmtMoney = (val: number) =>
              preferredCurrency === 'IDR' ? formatDynamic(val, false) : formatCurrency(val, settings, false);

            const displayValue =
              viewMode === 'growth'
                ? formatGrowthPercent(hoveredGrowthPct, hasValidGrowth, 2)
                : isPrivacyMode
                ? '******'
                : fmtMoney(hoveredPoint.equity);

            const displayPnl =
              hoveredPoint.index > 0
                ? isPrivacyMode
                ? '******'
                : `${hoveredPoint.netProfit >= 0 ? '+' : ''}${fmtMoney(hoveredPoint.netProfit)}`
                : null;

            return (
              <div
                ref={tooltipRef}
                data-testid="equity-chart-tooltip"
                data-tooltip-side={tooltipPlacement?.side ?? 'right'}
                style={{ left: `${tooltipPlacement?.leftPx ?? 8}px` }}
                className="absolute top-2 z-10 rounded-xl bg-white/95 dark:bg-[#101318]/95 border border-[#DDE3EA] dark:border-[#20252D] px-3 py-1.5 shadow-lg text-xs pointer-events-none font-mono-numbers tabular-nums whitespace-nowrap"
              >
                <div className="flex items-center justify-between gap-4 text-[10px] text-[#697586] dark:text-[#929BA9] font-sans mb-0.5">
                  <span>
                    {hoveredPoint.index === 0
                      ? tr('Modal Awal', 'Initial Capital')
                      : `Trade #${hoveredPoint.index}`}
                  </span>
                  <span className="font-mono-numbers">{hoveredPoint.date.slice(0, 10)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                    {displayValue}
                  </span>
                  {viewMode === 'equity' && displayPnl && (
                    <span
                      className={`text-[11px] font-semibold ${
                        hoveredPoint.netProfit >= 0
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }`}
                    >
                      {displayPnl}
                    </span>
                  )}
                  {viewMode === 'growth' && (
                    <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                      {isPrivacyMode
                        ? '******'
                        : fmtMoney(hoveredPoint.equity)}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
      </div>

    </>
  );

  if (embedded) {
    return <div className="space-y-2">{chartBody}</div>;
  }

  return (
    <div className="relative rounded-2xl border border-[#DDE3EA] dark:border-[#20252D] bg-white dark:bg-[#0B0D10] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-2 border-b border-[#DDE3EA] dark:border-[#20252D]">
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-4 w-4 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
          <div>
            <h3 className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
              {viewMode === 'equity'
                ? tr('Kurva Ekuitas (Saldo Kumulatif)', 'Equity Curve (Cumulative Balance)')
                : tr('Kurva Pertumbuhan (Pertumbuhan %)', 'Growth Curve (Growth %)')}
            </h3>
            <p className="text-xs text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
              {Math.max(0, safeCurve.length - 1)} trade • {tr('Modal awal:', 'Initial capital:')}{' '}
              {isPrivacyMode
                ? '******'
                : preferredCurrency === 'IDR'
                ? formatDynamic(chartStartingBalance, false)
                : formatCurrency(chartStartingBalance, settings, false)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {modeSelector}
          <button
            type="button"
            onClick={() => setShowPeakLine(!showPeakLine)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer ${
              showPeakLine
                ? 'bg-[#EEF2F6] dark:bg-[#101318] text-[#1769E8] dark:text-[#3478DC] border-[#DDE3EA] dark:border-[#20252D]'
                : 'bg-[#F5F7FA] dark:bg-[#101318] text-[#697586] dark:text-[#929BA9] border-[#DDE3EA] dark:border-[#20252D] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
            }`}
            title={tr(
              'Tampilkan / sembunyikan garis High Watermark (Puncak Saldo)',
              'Show / hide High Watermark (Peak Balance) line'
            )}
          >
            <Layers className="h-3.5 w-3.5 stroke-[1.75]" />
            <span className="hidden sm:inline">{tr('Puncak Saldo', 'High Watermark')}</span>
          </button>
        </div>
      </div>

      {chartBody}
    </div>
  );
};
