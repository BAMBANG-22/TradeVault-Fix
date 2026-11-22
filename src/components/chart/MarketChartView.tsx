/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type Logical,
} from 'lightweight-charts';
import {
  RefreshCw,
  X,
  Maximize2,
  Minimize2,
  Smartphone,
  LayoutTemplate,
  Check,
  Pencil,
  Scissors,
  Activity,
  MoreHorizontal,
  Undo2,
  Redo2,
  Play,
  Pause,
  SkipForward,
  Trash2,
  MousePointer,
  RotateCcw,
  Cloud,
  UserCheck,
  CloudOff,
  LogIn,
  Star,
  Lock,
  Unlock,
  GripVertical,
  Magnet,
  PlusCircle,
  Eye,
  EyeOff,
  Layers,
  ChevronLeft,
  ChevronRight,
  Settings,
  Ruler,
  ChevronsRight,
} from 'lucide-react';
import { getSupabase } from '../../utils/supabaseClient';
import type { Trade } from '../../types/trade';
import type { AppSettings } from '../../types/settings';
import { getTradeLifecycleStatus, resolveTradeLifecycle } from '../../utils/tradeLifecycle';
import { useLanguage } from '../../utils/language';
import { useTheme } from '../../utils/theme';

interface MarketChartViewProps {
  isActive?: boolean;
  currentUser?: any;
  trades?: Trade[];
  settings?: AppSettings;
  currentEquity?: number;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onCreateTradeFromPosition?: (tradeData: {
    pair?: string;
    position?: 'BUY' | 'SELL';
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    notes?: string;
    plannedRiskReward?: number;
    lotSize?: number;
    riskAmount?: number;
    riskPercentage?: number;
  }) => void;
}

export type ChartDisplayMode = 'normal' | 'full' | 'landscape';
export type CandleColorStyle = 'monochrome' | 'classic';
export type DrawingToolType =
  | 'cursor'
  | 'ruler'
  | 'trendline'
  | 'ray'
  | 'horizontal_line'
  | 'vertical_line'
  | 'fib_extension'
  | 'fib_retracement'
  | 'short_position'
  | 'long_position'
  | 'rectangle'
  | 'price_note'
  // Legacy aliases kept for backward compatibility
  | 'rect'
  | 'long'
  | 'short';

export type ActiveDrawingToolId =
  | 'trendline'
  | 'ray'
  | 'horizontal_line'
  | 'vertical_line'
  | 'fib_extension'
  | 'fib_retracement'
  | 'short_position'
  | 'long_position'
  | 'rectangle'
  | 'price_note';

export type DrawingPlacementState =
  | 'idle'
  | 'tool_selected'
  | 'placing'
  | 'awaiting_confirmation'
  | 'completed'
  | 'cancelled';

export type PositionStatus = 'PENDING' | 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'AMBIGUOUS';

export interface PositionOhlcEvaluation {
  status: PositionStatus;
  label: 'Pending' | 'Active' | 'TP Hit' | 'SL Hit' | 'Ambiguous';
  entryTouched?: boolean;
  boxStartLogical?: number;
  entryHitLogical?: number;
  entryHitTime?: number;
  hitLogical?: number;
  hitTime?: number;
  hitPrice?: number;
  lastActiveLogical?: number;
  lastActiveTime?: number;
  lastActiveClose?: number;
}

export type DrawingSheetTabId =
  | 'Favorit'
  | 'Peralatan'
  | 'Peralatan Tren'
  | 'Gann dan Fibonacci'
  | 'Bentuk-Bentuk Geometris'
  | 'Anotasi';

export const DRAWING_SHEET_TABS: DrawingSheetTabId[] = [
  'Favorit',
  'Peralatan',
  'Peralatan Tren',
  'Gann dan Fibonacci',
  'Bentuk-Bentuk Geometris',
  'Anotasi',
];

export interface DrawingToolDefinition {
  id: ActiveDrawingToolId;
  name: string;
  section:
    | 'PERALATAN TREN'
    | 'GANN DAN FIBONACCI'
    | 'PROYEKSI DAN PENGUKURAN'
    | 'BENTUK-BENTUK GEOMETRIS'
    | 'ANOTASI';
  tabCategory: Exclude<DrawingSheetTabId, 'Favorit' | 'Peralatan'>;
  pointsCount: 1 | 2 | 3;
}

export const DRAWING_TOOLS_CATALOG: DrawingToolDefinition[] = [
  // a) Seksi PERALATAN TREN
  {
    id: 'trendline',
    name: 'Garis Tren',
    section: 'PERALATAN TREN',
    tabCategory: 'Peralatan Tren',
    pointsCount: 2,
  },
  {
    id: 'ray',
    name: 'Sinar Tren (Ray)',
    section: 'PERALATAN TREN',
    tabCategory: 'Peralatan Tren',
    pointsCount: 2,
  },
  {
    id: 'horizontal_line',
    name: 'Garis Horizontal',
    section: 'PERALATAN TREN',
    tabCategory: 'Peralatan Tren',
    pointsCount: 1,
  },
  {
    id: 'vertical_line',
    name: 'Garis Vertikal',
    section: 'PERALATAN TREN',
    tabCategory: 'Peralatan Tren',
    pointsCount: 1,
  },
  // b) Seksi GANN DAN FIBONACCI
  {
    id: 'fib_extension',
    name: 'Fib Ekstensi Berbasis Tren',
    section: 'GANN DAN FIBONACCI',
    tabCategory: 'Gann dan Fibonacci',
    pointsCount: 3,
  },
  {
    id: 'fib_retracement',
    name: 'Fib Retracement',
    section: 'GANN DAN FIBONACCI',
    tabCategory: 'Gann dan Fibonacci',
    pointsCount: 2,
  },
  // c) Seksi PROYEKSI DAN PENGUKURAN
  {
    id: 'short_position',
    name: 'Posisi Penjualan',
    section: 'PROYEKSI DAN PENGUKURAN',
    tabCategory: 'Peralatan Tren',
    pointsCount: 1,
  },
  {
    id: 'long_position',
    name: 'Posisi Pembelian',
    section: 'PROYEKSI DAN PENGUKURAN',
    tabCategory: 'Peralatan Tren',
    pointsCount: 1,
  },
  // d) Seksi BENTUK-BENTUK GEOMETRIS
  {
    id: 'rectangle',
    name: 'Persegi',
    section: 'BENTUK-BENTUK GEOMETRIS',
    tabCategory: 'Bentuk-Bentuk Geometris',
    pointsCount: 2,
  },
  // e) Seksi ANOTASI
  {
    id: 'price_note',
    name: 'Catatan Harga',
    section: 'ANOTASI',
    tabCategory: 'Anotasi',
    pointsCount: 1,
  },
];

export const DRAWING_SECTIONS_ORDER: Array<DrawingToolDefinition['section']> = [
  'PERALATAN TREN',
  'GANN DAN FIBONACCI',
  'PROYEKSI DAN PENGUKURAN',
  'BENTUK-BENTUK GEOMETRIS',
  'ANOTASI',
];

export const DEFAULT_FAVORITE_DRAWING_TOOLS: ActiveDrawingToolId[] = [
  'trendline',
  'horizontal_line',
  'vertical_line',
  'fib_retracement',
  'long_position',
  'short_position',
  'rectangle',
  'price_note',
];

export const DRAWING_COLOR_SWATCHES = [
  '#D1D4DC',
  '#2962FF',
  '#089981',
  '#F23645',
  '#F59E0B',
  '#9598A1',
  '#7E57C2',
];

/**
 * Institutional TradingView-grade uniform 1.75px outline SVG icons for all drawing tools (Zero text characters/emojis)
 */
export function renderTradingViewDrawingIcon(
  toolId: ActiveDrawingToolId | 'ruler',
  className = 'w-7 h-7'
): React.ReactNode {
  switch (toolId) {
    case 'ruler':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <rect
            x="4.5"
            y="9.5"
            width="19"
            height="9"
            rx="1.5"
            transform="rotate(-35 14 14)"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <line x1="9.5" y1="14.5" x2="11.5" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="13" y1="12" x2="15.5" y2="15.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="16.5" y1="9.5" x2="18.5" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'trendline':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <line x1="6.5" y1="21.5" x2="21.5" y2="6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="6" cy="22" r="2.25" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="22" cy="6" r="2.25" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
    case 'ray':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <line x1="6" y1="22" x2="24" y2="4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <polyline points="18.5,4 24,4 24,9.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6" cy="22" r="2.25" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="15" cy="13" r="2" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
    case 'horizontal_line':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <line x1="3.5" y1="14" x2="24.5" y2="14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="14" cy="14" r="2.4" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
    case 'vertical_line':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <line x1="14" y1="3.5" x2="14" y2="24.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="14" cy="14" r="2.4" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
    case 'fib_extension':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <polyline
            points="4.5,21.5 10.5,8.5 15.5,16.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="14" y1="6.5" x2="24.5" y2="6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="15.5" y1="11.5" x2="24.5" y2="11.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="15.5" y1="16.5" x2="24.5" y2="16.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="12" y1="21.5" x2="24.5" y2="21.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="4.5" cy="21.5" r="2" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="10.5" cy="8.5" r="2" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="15.5" cy="16.5" r="2" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
    case 'fib_retracement':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <line x1="4" y1="6.5" x2="24" y2="6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="4" y1="11.5" x2="24" y2="11.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="4" y1="16.5" x2="24" y2="16.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="4" y1="21.5" x2="24" y2="21.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line
            x1="6.5"
            y1="21.5"
            x2="21.5"
            y2="6.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="2 2"
          />
          <circle cx="6.5" cy="21.5" r="2.2" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="21.5" cy="6.5" r="2.2" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
    case 'short_position':
      // Posisi Penjualan: SL di atas (garis putus-putus), Entry di tengah, TP di bawah dengan panah turun
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <rect x="5" y="6" width="18" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2" />
          <line x1="4" y1="12.5" x2="24" y2="12.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <rect x="5" y="12.5" width="18" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.75" />
          <path d="M14 15V19.5M14 19.5L11.8 17.5M14 19.5L16.2 17.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'long_position':
      // Posisi Pembelian: TP di atas dengan panah naik, Entry di tengah, SL di bawah (garis putus-putus)
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <rect x="5" y="6" width="18" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.75" />
          <line x1="4" y1="15.5" x2="24" y2="15.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <rect x="5" y="15.5" width="18" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2" />
          <path d="M14 13V8.5M14 8.5L11.8 10.5M14 8.5L16.2 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'rectangle':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <rect x="6" y="7.5" width="16" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="6" cy="7.5" r="2.1" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="22" cy="7.5" r="2.1" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="6" cy="20.5" r="2.1" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="22" cy="20.5" r="2.1" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
    case 'price_note':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className}>
          <rect x="9" y="5.5" width="14" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <line x1="12.5" y1="9.2" x2="19.5" y2="9.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="12.5" y1="12.5" x2="17" y2="12.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="9" y1="16" x2="6.2" y2="21.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="5.8" cy="22" r="2.1" fill="#101318" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
  }
}

declare global {
  interface Window {
    TradeVaultSystemBars?: {
      setTheme?: (theme: string) => void;
      setScreenOrientation?: (mode: 'portrait' | 'landscape') => void;
    };
  }
}

export interface OhlcCandle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DrawingAnchor {
  logical: number;
  price: number;
  time?: number;
}

export interface ChartDrawingObject {
  id: string;
  pair: string;
  type: Exclude<DrawingToolType, 'cursor'>;
  p1: DrawingAnchor;
  p2: DrawingAnchor;
  /** Third anchor point for 3-point tools (Fib Ekstensi Berbasis Tren) */
  p3?: DrawingAnchor;
  /** For long/short position tools: stop-loss price */
  slPrice?: number;
  /** For long/short position tools: take-profit price */
  tpPrice?: number;
  /** Timestamp (unix seconds) when the position/drawing was opened */
  createdAtTime?: number;
  /** Custom stroke/accent color */
  color?: string;
  /** Line thickness in px (1, 2, or 3) */
  lineWidth?: 1 | 2 | 3;
  /** Dashed line style */
  dashed?: boolean;
  /** Lock drawing position */
  locked?: boolean;
  /** Resolved lifecycle/hit status for position drawings across all timeframes */
  hitStatus?: 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'PENDING' | 'AMBIGUOUS';
  /** Exact unix timestamp when entry price was touched */
  entryHitTime?: number;
  /** Exact unix timestamp when TP or SL was hit */
  hitTime?: number;
  /** Exact price where hit occurred (tpPrice or slPrice) */
  hitPrice?: number;
}

/**
 * BAGIAN A1: Enforce valid Buy/Sell domain price ordering so Risk and Profit zones never invert.
 * - BUY (isLong = true): tpPrice > entryPrice > slPrice
 * - SELL (isLong = false): slPrice > entryPrice > tpPrice
 */
export function normalizePositionPrices(
  isLong: boolean,
  entryPrice: number,
  rawSlPrice: number | undefined,
  rawTpPrice: number | undefined,
  volatility: number,
  decimals: number
): { entryPrice: number; slPrice: number; tpPrice: number; rrRatio: string } {
  const minStep = Math.max(Math.pow(10, -decimals), volatility * 0.15);
  const defaultRisk = Math.max(minStep * 2, volatility * 2.5);
  const defaultReward = defaultRisk * 2.5;

  let slPrice: number;
  let tpPrice: number;

  if (isLong) {
    const candidateSl = rawSlPrice ?? entryPrice - defaultRisk;
    const candidateTp = rawTpPrice ?? entryPrice + defaultReward;
    slPrice = Math.min(entryPrice - minStep, candidateSl);
    tpPrice = Math.max(entryPrice + minStep, candidateTp);
  } else {
    const candidateSl = rawSlPrice ?? entryPrice + defaultRisk;
    const candidateTp = rawTpPrice ?? entryPrice - defaultReward;
    slPrice = Math.max(entryPrice + minStep, candidateSl);
    tpPrice = Math.min(entryPrice - minStep, candidateTp);
  }

  slPrice = Number(slPrice.toFixed(decimals));
  tpPrice = Number(tpPrice.toFixed(decimals));
  const cleanEntry = Number(entryPrice.toFixed(decimals));

  const risk = Math.max(1e-8, Math.abs(cleanEntry - slPrice));
  const reward = Math.abs(tpPrice - cleanEntry);
  const rrRatio = (reward / risk).toFixed(2);

  return {
    entryPrice: cleanEntry,
    slPrice,
    tpPrice,
    rrRatio,
  };
}

/**
 * Menghitung jarak pips antara harga Entry dan harga SL/TP pada Buy/Sell Position Tool.
 * Mengikuti standar pips pada aplikasi (misal XAUUSD: Entry 4000, SL 3995 => selisih 5.00 / 0.10 = 50 pips).
 */
export function computePositionPips(
  entryPrice: number,
  targetPrice: number,
  pairLabel = 'XAUUSD',
  xauusdPipSize = 0.1
): {
  pips: number;
  formattedPips: string;
  pipSize: number;
} {
  const activeXauPipSize =
    typeof xauusdPipSize === 'number' && Number.isFinite(xauusdPipSize) && xauusdPipSize > 0
      ? xauusdPipSize
      : 0.1;

  if (!Number.isFinite(entryPrice) || !Number.isFinite(targetPrice)) {
    return { pips: 0, formattedPips: '0 pips', pipSize: activeXauPipSize };
  }

  const cleanPair = (pairLabel || 'XAUUSD').trim().toUpperCase();
  let pipSize = activeXauPipSize; // Standar XAUUSD: 1 pip = 0.10 harga (Contoh: 4000 -> 3995 = 50 pips)

  if (cleanPair.includes('XAU') || cleanPair.includes('GOLD')) {
    pipSize = activeXauPipSize;
  } else if (
    cleanPair.includes('EURUSD') ||
    cleanPair.includes('GBPUSD') ||
    cleanPair.includes('AUDUSD') ||
    cleanPair.includes('NZDUSD') ||
    cleanPair.includes('USDCAD') ||
    cleanPair.includes('USDCHF')
  ) {
    pipSize = 0.0001;
  } else if (cleanPair.includes('JPY')) {
    pipSize = 0.01;
  } else if (
    cleanPair.includes('BTC') ||
    cleanPair.includes('IDR') ||
    cleanPair.includes('US30') ||
    cleanPair.includes('NAS')
  ) {
    pipSize = 1.0;
  }

  const rawDiff = Math.abs(targetPrice - entryPrice);
  const rawPips = rawDiff / pipSize;
  const roundedPips = Number(rawPips.toFixed(1));
  const formattedNumber = Number.isInteger(roundedPips)
    ? String(roundedPips)
    : roundedPips.toFixed(1);

  return {
    pips: roundedPips,
    formattedPips: `${formattedNumber} pips`,
    pipSize,
  };
}

/**
 * FEATURE 1: Pure deterministic Bar Countdown formatter (`MM:SS` or `HH:MM:SS`)
 */
export function formatBarCountdown(
  intervalSeconds: number,
  nowUnixSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const safeInterval = Math.max(60, Math.floor(Number(intervalSeconds) || 60));
  const nextClose = Math.floor(nowUnixSeconds / safeInterval) * safeInterval + safeInterval;
  const remaining = Math.max(0, nextClose - nowUnixSeconds);
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Isolated 1-second countdown badge component so 1s timer ticks NEVER re-render the parent chart!
 */
const CandleCountdownBadge: React.FC<{
  intervalSeconds: number;
  isMarketOpen: boolean;
  isReplayActive: boolean;
}> = React.memo(({ intervalSeconds, isMarketOpen, isReplayActive }) => {
  const [countdownText, setCountdownText] = useState<string>(() =>
    formatBarCountdown(intervalSeconds)
  );

  useEffect(() => {
    if (!isMarketOpen || isReplayActive) return;
    setCountdownText(formatBarCountdown(intervalSeconds));
    const timer = window.setInterval(() => {
      setCountdownText(formatBarCountdown(intervalSeconds));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [intervalSeconds, isMarketOpen, isReplayActive]);

  if (!isMarketOpen || isReplayActive) return null;

  return (
    <span
      data-testid="chart-bar-countdown-badge"
      title="Sisa waktu hingga penutupan candle aktif"
      className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#F4F4F5] dark:bg-[#1E222D] border border-[#E4E4E7] dark:border-white/[0.07] text-[9px] font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#D1D4DC] shrink-0"
    >
      {countdownText}
    </span>
  );
});
CandleCountdownBadge.displayName = 'CandleCountdownBadge';

/**
 * FEATURE 2: Pure calculation for Transient 2-Touch Measure / Ruler Tool (Pips Mode B, %, & Bar Count)
 */
export interface RulerMeasurementMetrics {
  priceDelta: number;
  formattedPriceDelta: string;
  pips: number;
  formattedPips: string;
  pctChange: number;
  formattedPct: string;
  barCount: number;
  durationLabel: string;
  isPositive: boolean;
}

export function computeRulerMetrics(
  p1: DrawingAnchor,
  p2: DrawingAnchor,
  pair: string,
  decimals: number,
  tfSeconds: number,
  xauusdPipSize: number = 0.1
): RulerMeasurementMetrics {
  const priceDelta = p2.price - p1.price;
  const isPositive = priceDelta >= 0;
  const sign = isPositive ? '+' : '-';
  const formattedPriceDelta = `${sign}${Math.abs(priceDelta).toFixed(decimals)}`;
  const pipsInfo = computePositionPips(p1.price, p2.price, pair, xauusdPipSize);
  const signedPipsText = `${sign}${pipsInfo.formattedPips}`;
  const pctChange = p1.price !== 0 ? ((p2.price - p1.price) / p1.price) * 100 : 0;
  const formattedPct = `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%`;
  const barCount = Math.max(0, Math.abs(Math.round(p2.logical - p1.logical)));
  const totalSec = barCount * Math.max(60, tfSeconds || 60);
  let durationLabel = `${ Math.round(totalSec / 60)}m`;
  if (totalSec >= 86400) {
    const d = Math.floor(totalSec / 86400);
    const h = Math.round((totalSec % 86400) / 3600);
    durationLabel = h > 0 ? `${d}h ${h}j` : `${d}h`;
  } else if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.round((totalSec % 3600) / 60);
    durationLabel = m > 0 ? `${h}j ${m}m` : `${h}j`;
  }

  return {
    priceDelta,
    formattedPriceDelta,
    pips: pipsInfo.pips,
    formattedPips: signedPipsText,
    pctChange,
    formattedPct,
    barCount,
    durationLabel,
    isPositive,
  };
}

/**
 * FEATURE 4: Extract Active Journal Positions (OPEN & PLANNED) for Chart Overlay Lines
 */
export interface JournalOverlayTradeLine {
  tradeId: string;
  status: 'OPEN' | 'PLANNED';
  position: 'BUY' | 'SELL';
  lotSize: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
}

export function extractActiveJournalOverlayLines(
  trades: Trade[] | undefined,
  pairLabel: string
): JournalOverlayTradeLine[] {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  const normPair = (pairLabel || 'XAUUSD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const matched: JournalOverlayTradeLine[] = [];

  for (const t of trades) {
    if (!t || typeof t !== 'object') continue;
    const tradePair = String(t.instrument || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (tradePair !== normPair) continue;

    const status = getTradeLifecycleStatus(t);
    if (status !== 'OPEN' && status !== 'PLANNED') continue;

    const resolved = resolveTradeLifecycle(t);
    const entryPrice =
      status === 'OPEN'
        ? Number(resolved.actualEntry || t.entryPrice || 0)
        : Number(resolved.plannedEntry || t.entryPrice || 0);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

    const lotSize =
      status === 'OPEN'
        ? Number(resolved.actualLot || t.lotSize || 0.01)
        : Number(resolved.plannedLot || t.lotSize || 0.01);
    const stopLoss =
      resolved.plannedStopLoss !== undefined && resolved.plannedStopLoss > 0
        ? resolved.plannedStopLoss
        : t.stopLoss !== undefined && t.stopLoss > 0
          ? t.stopLoss
          : undefined;
    const takeProfit =
      resolved.plannedTakeProfit !== undefined && resolved.plannedTakeProfit > 0
        ? resolved.plannedTakeProfit
        : t.takeProfit !== undefined && t.takeProfit > 0
          ? t.takeProfit
          : undefined;

    matched.push({
      tradeId: t.id,
      status,
      position: t.position === 'SELL' ? 'SELL' : 'BUY',
      lotSize: Number.isFinite(lotSize) && lotSize > 0 ? lotSize : 0.01,
      entryPrice,
      stopLoss,
      takeProfit,
    });
    if (matched.length >= 5) break;
  }

  return matched;
}

/**
 * FEATURE 5: Pure Auto Lot Size & Dollar Risk ($) Recommendation for Selected Buy/Sell Position Tool
 */
export interface PositionSizingRecommendation {
  recommendedLot: number;
  riskAmountUsd: number;
  riskPercent: number;
  slPips: number;
}

export function computeRecommendedPositionSizing(
  entryPrice: number,
  slPrice: number,
  pair: string,
  equity: number = 10000,
  riskPercent: number = 1,
  xauusdPipValuePer001Lot: number = 0.1,
  xauusdPipSize: number = 0.1
): PositionSizingRecommendation {
  const safeEquity = Number.isFinite(equity) && equity > 0 ? equity : 10000;
  const safeRiskPct = Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : 1;
  const riskAmountUsd = safeEquity * (safeRiskPct / 100);
  const pipsInfo = computePositionPips(entryPrice, slPrice, pair, xauusdPipSize);
  const slPips = pipsInfo.pips;

  const cleanPair = (pair || 'XAUUSD').toUpperCase();
  const pipVal001 =
    cleanPair.includes('XAU') || cleanPair.includes('GOLD')
      ? Number.isFinite(xauusdPipValuePer001Lot) && xauusdPipValuePer001Lot > 0
        ? xauusdPipValuePer001Lot
        : 0.1
      : 0.1;
  const pipValuePerStandardLot = pipVal001 * 100; // $10 per 1.00 lot (100 oz * $0.10/pip)

  const rawLots =
    slPips > 0 && pipValuePerStandardLot > 0
      ? riskAmountUsd / (slPips * pipValuePerStandardLot)
      : 0.01;
  const recommendedLot = Math.max(0.01, Math.min(100, Number(rawLots.toFixed(2))));

  return {
    recommendedLot,
    riskAmountUsd: Number(riskAmountUsd.toFixed(2)),
    riskPercent: Number(safeRiskPct.toFixed(2)),
    slPips,
  };
}

export interface PositionBoxGeometry {
  isLong: boolean;
  leftX: number;
  rightEdgeX: number;
  boxWidth: number;
  entryY: number;
  tpY: number;
  slY: number;
  profitTopY: number;
  profitBottomY: number;
  profitHeight: number;
  riskTopY: number;
  riskBottomY: number;
  riskHeight: number;
  rrRatio: string;
  /** TradingView 2-Layer Fill: Base zone opacity + Dynamic Hit/Floating Progress fill */
  profitBaseFill: string;
  riskBaseFill: string;
  activeFillLeftX: number;
  activeFillRightX: number;
  activeFillWidth: number;
  activeFillTopY: number | null;
  activeFillHeight: number;
  activeFillColor: string | null;
  targetEndY: number;
}

/**
 * BAGIAN A1: Pure geometry calculation for Buy and Sell Position drawings (TradingView Authentic 2-Layer Fill).
 * - Layer 1 (Base Zones): Spans the full tool width (`leftX` to `rightEdgeX`) and 100% vertically between
 *   Entry <-> TP (Profit Zone) and Entry <-> SL (Risk Zone) with a subtle translucent tint so unfilled areas remain un-filled.
 * - Layer 2 (Dynamic Candle Hit / Progress Fill):
 *   * Horizontally bounded strictly from the Entry-hit candle (`fillStartX`) to the TP/SL-hit candle or last active candle (`fillEndX`).
 *   * Candles before Entry touch or after TP/SL hit inside a wide Buy/Sell box are NOT filled.
 */
export function computePositionGeometry(params: {
  isLong: boolean;
  p1X: number;
  p2X: number;
  entryY: number;
  tpY: number;
  slY: number;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  status?: PositionStatus;
  currentPrice?: number;
  currentPriceY?: number;
  fillStartX?: number;
  fillEndX?: number;
  minFillWidth?: number;
}): PositionBoxGeometry {
  const {
    isLong,
    p1X,
    p2X,
    entryY,
    tpY,
    slY,
    entryPrice,
    tpPrice,
    slPrice,
    status = 'ACTIVE',
    currentPrice,
    currentPriceY,
    fillStartX,
    fillEndX,
    minFillWidth,
  } = params;
  const leftX = Math.min(p1X, p2X);
  const rawWidth = Math.abs(p2X - p1X);
  const boxWidth = Math.max(6, rawWidth);
  const rightEdgeX = leftX + boxWidth;

  // Profit Zone ALWAYS spans 100% vertically between Entry line (entryY) and Take Profit line (tpY)
  const profitTopY = Math.min(entryY, tpY);
  const profitBottomY = Math.max(entryY, tpY);
  const profitHeight = Math.max(2, profitBottomY - profitTopY);

  // Risk Zone ALWAYS spans 100% vertically between Entry line (entryY) and Stop Loss line (slY)
  const riskTopY = Math.min(entryY, slY);
  const riskBottomY = Math.max(entryY, slY);
  const riskHeight = Math.max(2, riskBottomY - riskTopY);

  const risk = Math.max(1e-8, Math.abs(entryPrice - slPrice));
  const reward = Math.abs(tpPrice - entryPrice);
  const rrRatio = (reward / risk).toFixed(2);

  // Layer 1: Subtle translucent base tint across the full tool width so unfilled candles stay un-filled
  const profitBaseFill =
    status === 'SL_HIT' ? 'rgba(8, 153, 129, 0.10)' : 'rgba(8, 153, 129, 0.14)';

  const riskBaseFill =
    status === 'TP_HIT' ? 'rgba(242, 54, 69, 0.10)' : 'rgba(242, 54, 69, 0.14)';

  // Compute Horizontal Span of Layer 2 (strictly from Entry-hit candle to TP/SL-hit or last active candle)
  let activeFillLeftX = leftX;
  let activeFillRightX = leftX;
  let activeFillWidth = 0;

  if (status !== 'PENDING') {
    const rawStartX = fillStartX !== undefined && Number.isFinite(fillStartX) ? fillStartX : leftX;
    const rawEndX = fillEndX !== undefined && Number.isFinite(fillEndX) ? fillEndX : rightEdgeX;
    let clampedLeft = Math.max(leftX, Math.min(rightEdgeX, Math.min(rawStartX, rawEndX)));
    let clampedRight = Math.max(clampedLeft, Math.min(rightEdgeX, Math.max(rawStartX, rawEndX)));
    const minW = Math.min(boxWidth, Math.max(4, minFillWidth ?? 8));
    if (clampedRight - clampedLeft < minW) {
      if (clampedLeft + minW <= rightEdgeX) {
        clampedRight = clampedLeft + minW;
      } else {
        clampedRight = rightEdgeX;
        clampedLeft = Math.max(leftX, rightEdgeX - minW);
      }
    }
    activeFillLeftX = clampedLeft;
    activeFillRightX = clampedRight;
    activeFillWidth = Math.max(0, activeFillRightX - activeFillLeftX);
  }

  // Layer 2: Dynamic Hit / Floating Progress Fill
  let activeFillTopY: number | null = null;
  let activeFillHeight = 0;
  let activeFillColor: string | null = null;
  let targetEndY = entryY;

  if (status === 'TP_HIT') {
    activeFillTopY = profitTopY;
    activeFillHeight = profitHeight;
    activeFillColor = 'rgba(8, 153, 129, 0.36)';
    targetEndY = tpY;
  } else if (status === 'SL_HIT') {
    activeFillTopY = riskTopY;
    activeFillHeight = riskHeight;
    activeFillColor = 'rgba(242, 54, 69, 0.36)';
    targetEndY = slY;
  } else if (
    status === 'ACTIVE' &&
    currentPrice !== undefined &&
    currentPriceY !== undefined &&
    Number.isFinite(currentPrice) &&
    Number.isFinite(currentPriceY)
  ) {
    const isFloatingProfit = isLong ? currentPrice > entryPrice : currentPrice < entryPrice;
    const isFloatingLoss = isLong ? currentPrice < entryPrice : currentPrice > entryPrice;

    if (isFloatingProfit) {
      const clampedY = Math.max(profitTopY, Math.min(profitBottomY, currentPriceY));
      activeFillTopY = Math.min(entryY, clampedY);
      activeFillHeight = Math.max(0, Math.abs(entryY - clampedY));
      activeFillColor = 'rgba(8, 153, 129, 0.28)';
      targetEndY = clampedY;
    } else if (isFloatingLoss) {
      const clampedY = Math.max(riskTopY, Math.min(riskBottomY, currentPriceY));
      activeFillTopY = Math.min(entryY, clampedY);
      activeFillHeight = Math.max(0, Math.abs(entryY - clampedY));
      activeFillColor = 'rgba(242, 54, 69, 0.28)';
      targetEndY = clampedY;
    }
  }

  return {
    isLong,
    leftX,
    rightEdgeX,
    boxWidth,
    entryY,
    tpY,
    slY,
    profitTopY,
    profitBottomY,
    profitHeight,
    riskTopY,
    riskBottomY,
    riskHeight,
    rrRatio,
    profitBaseFill,
    riskBaseFill,
    activeFillLeftX,
    activeFillRightX,
    activeFillWidth,
    activeFillTopY,
    activeFillHeight,
    activeFillColor,
    targetEndY,
  };
}

/**
 * BAGIAN A2: Chronological OHLC evaluation for Buy and Sell Positions.
 * Evaluates candles strictly within the horizontal span of the Buy/Sell box (`p1` to `p2`).
 * - RULE 1 (Strict Box Horizontal Bounds): Only candles inside `[leftAnchor .. rightAnchor]` are evaluated.
 *   If candles pass the right edge of the Buy/Sell box without touching `entryPrice`, any later candle outside
 *   the box that hits Entry/TP/SL is ignored and the box remains 'PENDING' (unfilled).
 * - RULE 2 (Entry-Triggered Fill): A position starts as 'PENDING' and is ONLY triggered ('ACTIVE')
 *   when a candle inside the box touches `entryPrice` (`candle.low <= entryPrice && candle.high >= entryPrice`).
 * - RULE 3 (Stop Fill at TP/SL Hit Candle): As soon as a candle at/after Entry touch hits TP or SL, evaluation
 *   terminates at `hitLogical` so subsequent candles inside a wide box are NOT filled.
 */
export function evaluatePositionOhlcStatus(
  drawing: Pick<ChartDrawingObject, 'type' | 'p1' | 'slPrice' | 'tpPrice' | 'createdAtTime'> & {
    p2?: DrawingAnchor;
    hitStatus?: 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'PENDING' | 'AMBIGUOUS';
    entryHitTime?: number;
    hitTime?: number;
    hitPrice?: number;
  },
  candles: OhlcCandle[],
  lowerTfCandles?: OhlcCandle[],
  tfSeconds = 3600
): PositionOhlcEvaluation {
  if (!candles || candles.length === 0) {
    return { status: 'PENDING', label: 'Pending', entryTouched: false };
  }

  const isLong = drawing.type === 'long_position' || drawing.type === 'long';
  const entryPrice = drawing.p1.price;
  const tpPrice = drawing.tpPrice;
  const slPrice = drawing.slPrice;

  if (tpPrice === undefined || slPrice === undefined || !Number.isFinite(tpPrice) || !Number.isFinite(slPrice)) {
    return { status: 'PENDING', label: 'Pending', entryTouched: false };
  }

  const hasP2 = drawing.p2 !== undefined;
  const leftAnchor =
    hasP2 && drawing.p2!.logical < drawing.p1.logical ? drawing.p2! : drawing.p1;
  const rightAnchor =
    hasP2 && drawing.p2!.logical < drawing.p1.logical ? drawing.p1 : drawing.p2;

  // Multi-Timeframe Invariance (TradingView Match): If this position has already hit TP or SL
  // at an exact timestamp in history, preserve that exact outcome across all timeframes (M5, M15, H1, 4H, etc.)
  // and resolve its entry and hit bar logical coordinates on the current timeframe's candles.
  if (
    (drawing.hitStatus === 'TP_HIT' || drawing.hitStatus === 'SL_HIT') &&
    drawing.hitTime !== undefined &&
    Number.isFinite(drawing.hitTime)
  ) {
    const boxStartLogical = resolveContainingBarLogical(leftAnchor, candles, tfSeconds);
    const entryTime = drawing.entryHitTime ?? (leftAnchor.time ?? drawing.createdAtTime);
    const entryHitLogical =
      entryTime !== undefined
        ? resolveContainingBarLogical({ logical: 0, price: 0, time: entryTime }, candles, tfSeconds)
        : boxStartLogical;
    const hitLogical = resolveContainingBarLogical(
      { logical: 0, price: 0, time: drawing.hitTime },
      candles,
      tfSeconds
    );
    const label = drawing.hitStatus === 'TP_HIT' ? 'TP Hit' : 'SL Hit';
    const hitPrice =
      drawing.hitPrice ?? (drawing.hitStatus === 'TP_HIT' ? tpPrice : slPrice);

    return {
      status: drawing.hitStatus,
      label,
      entryTouched: true,
      boxStartLogical,
      entryHitLogical,
      entryHitTime: entryTime,
      hitLogical,
      hitTime: drawing.hitTime,
      hitPrice,
    };
  }

  // Determine the horizontal start and end boundaries of the position box
  const startTime =
    leftAnchor.time !== undefined && Number.isFinite(leftAnchor.time)
      ? leftAnchor.time
      : drawing.createdAtTime;
  const startLogicalIdx = Math.max(0, Math.round(leftAnchor.logical));

  const endTime =
    rightAnchor &&
    rightAnchor.time !== undefined &&
    Number.isFinite(rightAnchor.time) &&
    (startTime === undefined || rightAnchor.time >= startTime)
      ? rightAnchor.time
      : undefined;

  const resolvedLeftLogical = resolveContainingBarLogical(leftAnchor, candles, tfSeconds);
  const widthBars = rightAnchor
    ? Math.max(0, Math.round(Math.abs(rightAnchor.logical - leftAnchor.logical)))
    : Infinity;
  const endLogicalIdx = rightAnchor
    ? Math.round(resolvedLeftLogical) + widthBars
    : Infinity;

  let boxStartLogical: number | undefined;
  let entryTouched = false;
  let entryHitLogical: number | undefined;
  let entryHitTime: number | undefined;
  let lastActiveLogical: number | undefined;
  let lastActiveTime: number | undefined;
  let lastActiveClose: number | undefined;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const cTime = Number(c.time);

    // Ignore candles strictly before the left edge of the position box.
    // A candle `i` covers `[cTime, candleEndTime)`, where `candleEndTime` is bounded by `cTime + tfSeconds`
    // and the next candle's open timestamp `candles[i + 1].time`.
    if (startTime !== undefined && Number.isFinite(startTime)) {
      const candleEndTime =
        i + 1 < candles.length
          ? Math.min(cTime + tfSeconds, Number(candles[i + 1].time))
          : cTime + tfSeconds;
      if (tfSeconds > 0 ? candleEndTime <= startTime : cTime < startTime) continue;
    } else {
      if (i < startLogicalIdx) continue;
    }

    // Stop evaluating once candles pass the right edge of the position box
    if (rightAnchor) {
      if (endTime !== undefined && Number.isFinite(endTime)) {
        if (cTime > endTime) break;
      } else {
        if (i > endLogicalIdx) break;
      }
    }

    if (boxStartLogical === undefined) {
      boxStartLogical = i;
    }

    // Step 1: Entry price is the trigger gate. Position cannot fill until a candle inside the box touches entryPrice.
    if (!entryTouched) {
      const touchesEntry = c.low <= entryPrice && c.high >= entryPrice;
      if (!touchesEntry) {
        continue;
      }
      entryTouched = true;
      entryHitLogical = i;
      entryHitTime = cTime;
    }

    lastActiveLogical = i;
    lastActiveTime = cTime;
    lastActiveClose = c.close;

    // Step 2: Once entry has been touched inside the box, evaluate TP and SL hits
    const tpTouched = isLong ? c.high >= tpPrice : c.low <= tpPrice;
    const slTouched = isLong ? c.low <= slPrice : c.high >= slPrice;

    if (tpTouched && slTouched) {
      // Both TP and SL touched within the same candle!
      // Attempt to resolve chronologically using lower timeframe candles if available
      if (lowerTfCandles && lowerTfCandles.length > 0) {
        const subCandles = lowerTfCandles
          .filter((sub) => {
            const subTime = Number(sub.time);
            return subTime >= cTime && subTime < cTime + tfSeconds;
          })
          .sort((a, b) => Number(a.time) - Number(b.time));

        for (const sub of subCandles) {
          const subTp = isLong ? sub.high >= tpPrice : sub.low <= tpPrice;
          const subSl = isLong ? sub.low <= slPrice : sub.high >= slPrice;
          if (subTp && !subSl) {
            return {
              status: 'TP_HIT',
              label: 'TP Hit',
              entryTouched: true,
              boxStartLogical,
              entryHitLogical,
              entryHitTime,
              hitLogical: i,
              hitTime: Number(sub.time),
              hitPrice: tpPrice,
            };
          }
          if (subSl && !subTp) {
            return {
              status: 'SL_HIT',
              label: 'SL Hit',
              entryTouched: true,
              boxStartLogical,
              entryHitLogical,
              entryHitTime,
              hitLogical: i,
              hitTime: Number(sub.time),
              hitPrice: slPrice,
            };
          }
          if (subTp && subSl) {
            return {
              status: 'AMBIGUOUS',
              label: 'Ambiguous',
              entryTouched: true,
              boxStartLogical,
              entryHitLogical,
              entryHitTime,
              hitLogical: i,
              hitTime: Number(sub.time),
              hitPrice: entryPrice,
            };
          }
        }
      }

      return {
        status: 'AMBIGUOUS',
        label: 'Ambiguous',
        entryTouched: true,
        boxStartLogical,
        entryHitLogical,
        entryHitTime,
        hitLogical: i,
        hitTime: cTime,
        hitPrice: entryPrice,
      };
    }

    if (tpTouched) {
      return {
        status: 'TP_HIT',
        label: 'TP Hit',
        entryTouched: true,
        boxStartLogical,
        entryHitLogical,
        entryHitTime,
        hitLogical: i,
        hitTime: cTime,
        hitPrice: tpPrice,
      };
    }

    if (slTouched) {
      return {
        status: 'SL_HIT',
        label: 'SL Hit',
        entryTouched: true,
        boxStartLogical,
        entryHitLogical,
        entryHitTime,
        hitLogical: i,
        hitTime: cTime,
        hitPrice: slPrice,
      };
    }
  }

  if (!entryTouched) {
    return { status: 'PENDING', label: 'Pending', entryTouched: false, boxStartLogical };
  }

  return {
    status: 'ACTIVE',
    label: 'Active',
    entryTouched: true,
    boxStartLogical,
    entryHitLogical,
    entryHitTime,
    lastActiveLogical,
    lastActiveTime,
    lastActiveClose,
  };
}

/**
 * BAGIAN A3 & B3: Centralized Coordinate Mapping Functions
 * 1) screenToPlotCoordinates: converts screen clientX/clientY into clamped plot area coordinates
 * 2) plotToChartCoordinates: converts plot (x, y) into domain { logical, price, time }
 * 3) chartToScreenCoordinates: converts domain { logical, price, time } into screen (x, y) across timeframe/replay changes
 */
export function screenToPlotCoordinates(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number },
  priceScaleWidth = 56,
  timeScaleHeight = 26
): { plotX: number; plotY: number; isWithinPlot: boolean; minX: number; maxX: number; minY: number; maxY: number } {
  const rawX = clientX - containerRect.left;
  const rawY = clientY - containerRect.top;

  const minX = 6;
  const maxX = Math.max(minX + 20, containerRect.width - priceScaleWidth);
  const minY = 6;
  const maxY = Math.max(minY + 20, containerRect.height - timeScaleHeight);

  const plotX = Math.max(minX, Math.min(maxX, Math.round(rawX)));
  const plotY = Math.max(minY, Math.min(maxY, Math.round(rawY)));
  const isWithinPlot = rawX >= 0 && rawX <= maxX + 8 && rawY >= 0 && rawY <= maxY + 8;

  return { plotX, plotY, isWithinPlot, minX, maxX, minY, maxY };
}

export function resolveLogicalFromTime(
  anchor: DrawingAnchor,
  candles: OhlcCandle[],
  tfSeconds = 3600
): number {
  if (!candles || candles.length === 0 || anchor.time === undefined || !Number.isFinite(anchor.time)) {
    return anchor.logical;
  }

  const targetTime = Number(anchor.time);
  const firstTime = Number(candles[0].time);
  const lastIdx = candles.length - 1;
  const lastTime = Number(candles[lastIdx].time);

  if (targetTime <= firstTime) {
    if (tfSeconds > 0 && targetTime < firstTime) {
      return (targetTime - firstTime) / tfSeconds;
    }
    return 0;
  }

  if (targetTime >= lastTime) {
    if (tfSeconds > 0) {
      return lastIdx + (targetTime - lastTime) / tfSeconds;
    }
    return lastIdx;
  }

  // Binary search for closest candle timestamp <= targetTime
  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midTime = Number(candles[mid].time);
    if (midTime === targetTime) return mid;
    if (midTime < targetTime) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const idxBefore = Math.max(0, hi);
  const idxAfter = Math.min(lastIdx, idxBefore + 1);
  const tBefore = Number(candles[idxBefore].time);
  const tAfter = Number(candles[idxAfter].time);
  if (tAfter > tBefore && targetTime > tBefore && targetTime < tAfter) {
    return idxBefore + (targetTime - tBefore) / (tAfter - tBefore);
  }
  if (Math.abs(targetTime - tBefore) <= Math.abs(tAfter - targetTime)) {
    return idxBefore;
  }
  return idxAfter;
}

/**
 * Multi-timeframe bar-containment resolver:
 * Maps any domain timestamp `anchor.time` to the exact integer logical index of the candle
 * on the active timeframe whose `[candle.time, candle.time + tfSeconds)` interval contains `anchor.time`.
 * - Lower-timeframe timestamps (e.g., M5 at 10:15, 10:45, or 11:55) snap cleanly to the center of their
 *   containing M15 (10:15, 10:45, 11:45) or H1 (10:00, 10:00, 11:00) candle instead of drifting between bars.
 * - Future timestamps beyond `[lastTime, lastTime + tfSeconds)` project proportionally by bar count.
 * - Timestamps older than `candles[0].time` clamp to a safe left offset so drawings never get stuck or broken off-canvas.
 */
export function resolveContainingBarLogical(
  anchor: DrawingAnchor,
  candles: OhlcCandle[],
  tfSeconds = 3600
): number {
  if (!candles || candles.length === 0 || anchor.time === undefined || !Number.isFinite(anchor.time)) {
    return Math.max(0, Math.round(anchor.logical));
  }

  const targetTime = Number(anchor.time);
  const firstTime = Number(candles[0].time);
  const lastIdx = candles.length - 1;
  const lastTime = Number(candles[lastIdx].time);

  if (targetTime <= firstTime) {
    return 0;
  }

  if (targetTime >= lastTime) {
    if (tfSeconds > 0 && targetTime >= lastTime + tfSeconds) {
      return lastIdx + Math.round((targetTime - lastTime) / tfSeconds);
    }
    return lastIdx;
  }

  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midTime = Number(candles[mid].time);
    if (midTime === targetTime) return mid;
    if (midTime < targetTime) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const idxBefore = Math.max(0, hi);
  const idxAfter = Math.min(lastIdx, idxBefore + 1);
  const tBefore = Number(candles[idxBefore].time);
  const tAfter = Number(candles[idxAfter].time);

  // If targetTime falls within candle[idxBefore]'s timeframe bar [tBefore, tBefore + tfSeconds),
  // lock directly onto idxBefore (the containing candle on this timeframe).
  if (tfSeconds > 0 && targetTime >= tBefore && targetTime < tBefore + tfSeconds) {
    return idxBefore;
  }

  if (Math.abs(targetTime - tBefore) <= Math.abs(tAfter - targetTime)) {
    return idxBefore;
  }
  return idxAfter;
}

export function resolveTimeFromLogical(
  logical: number,
  candles: OhlcCandle[],
  tfSeconds = 3600,
  referenceAnchor?: { logical: number; time?: number }
): number | undefined {
  if (candles && candles.length > 0 && Number.isFinite(logical)) {
    const lastIdx = candles.length - 1;
    if (logical <= 0) {
      return Math.round(Number(candles[0].time) + logical * tfSeconds);
    }
    if (logical >= lastIdx) {
      return Math.round(Number(candles[lastIdx].time) + (logical - lastIdx) * tfSeconds);
    }
    const idxBefore = Math.floor(logical);
    const idxAfter = Math.min(lastIdx, idxBefore + 1);
    const frac = logical - idxBefore;
    const tBefore = Number(candles[idxBefore].time);
    const tAfter = Number(candles[idxAfter].time);
    const stepSec = tAfter > tBefore ? tAfter - tBefore : tfSeconds;
    return Math.round(tBefore + frac * stepSec);
  }
  if (
    referenceAnchor &&
    referenceAnchor.time !== undefined &&
    Number.isFinite(referenceAnchor.time) &&
    Number.isFinite(logical)
  ) {
    return Math.round(referenceAnchor.time + (logical - referenceAnchor.logical) * tfSeconds);
  }
  return undefined;
}

export interface TwoTouchPlacementMachineState {
  placementState: DrawingPlacementState;
  activeTool: DrawingToolType;
  crosshairPos: { x: number; y: number };
  crosshairAnchor: DrawingAnchor;
  draftDrawing: ChartDrawingObject | null;
  draftStep: number;
  committedDrawings: ChartDrawingObject[];
}

/**
 * BAGIAN B2–B4: Pure deterministic Two-Touch Placement & Crosshair Positioning state machine.
 * Guarantees that the second touch (confirmation tap) ALWAYS uses `state.crosshairAnchor` (the crosshair's
 * domain coordinate) and NEVER overwrites it with the physical screen location of the confirmation tap.
 */
export function advancePlacementStateMachine(
  state: TwoTouchPlacementMachineState,
  action:
    | { type: 'SELECT_TOOL'; tool: ActiveDrawingToolId; initialPos: { x: number; y: number }; initialAnchor: DrawingAnchor }
    | { type: 'MOVE_CROSSHAIR'; pos: { x: number; y: number }; anchor: DrawingAnchor; volatility: number; decimals: number }
    | { type: 'END_CROSSHAIR_DRAG' }
    | {
        type: 'CONFIRM_SECOND_TOUCH';
        /** Physical screen coordinates of the second tap (must be ignored for anchor placement!) */
        secondTouchScreenPos?: { x: number; y: number };
        pair: string;
        volatility: number;
        decimals: number;
        stayInDrawingMode?: boolean;
        tfSeconds?: number;
      }
    | { type: 'CANCEL' }
): TwoTouchPlacementMachineState {
  if (action.type === 'CANCEL') {
    return {
      ...state,
      placementState: 'cancelled',
      activeTool: 'cursor',
      draftDrawing: null,
      draftStep: 0,
    };
  }

  if (action.type === 'SELECT_TOOL') {
    return {
      ...state,
      placementState: 'tool_selected',
      activeTool: action.tool,
      crosshairPos: { ...action.initialPos },
      crosshairAnchor: { ...action.initialAnchor },
      draftDrawing: null,
      draftStep: 0,
    };
  }

  if (action.type === 'MOVE_CROSSHAIR') {
    if (state.activeTool === 'cursor') return state;
    const nextAnchor: DrawingAnchor = { ...action.anchor };
    let nextDraft = state.draftDrawing;

    if (nextDraft) {
      if (nextDraft.type === 'fib_extension') {
        if (state.draftStep === 1) {
          nextDraft = {
            ...nextDraft,
            p2: nextAnchor,
            p3: {
              logical: nextAnchor.logical + 6,
              price: Number(((nextDraft.p1.price + nextAnchor.price) / 2).toFixed(action.decimals)),
              time: nextAnchor.time !== undefined ? nextAnchor.time + 6 * 3600 : undefined,
            },
          };
        } else if (state.draftStep === 2) {
          nextDraft = {
            ...nextDraft,
            p3: nextAnchor,
          };
        }
      } else {
        nextDraft = {
          ...nextDraft,
          p2: nextAnchor,
        };
      }
    }

    return {
      ...state,
      placementState: 'placing',
      crosshairPos: { ...action.pos },
      crosshairAnchor: nextAnchor,
      draftDrawing: nextDraft,
    };
  }

  if (action.type === 'END_CROSSHAIR_DRAG') {
    if (state.activeTool === 'cursor') return state;
    return {
      ...state,
      placementState: 'awaiting_confirmation',
    };
  }

  if (action.type === 'CONFIRM_SECOND_TOUCH') {
    if (state.activeTool === 'cursor') return state;
    // CRITICAL RULE (BAGIAN B2 & B3): Always use the crosshair's domain coordinate snapshot (`state.crosshairAnchor`).
    // Never replace `state.crosshairPos` or `state.crosshairAnchor` with `action.secondTouchScreenPos`!
    const anchor: DrawingAnchor = { ...state.crosshairAnchor };
    const tool = state.activeTool;
    const stepSec = action.tfSeconds ?? 3600;
    const id = `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const finishCommit = (newObj: ChartDrawingObject): TwoTouchPlacementMachineState => ({
      ...state,
      placementState: action.stayInDrawingMode ? 'tool_selected' : 'completed',
      activeTool: action.stayInDrawingMode ? state.activeTool : 'cursor',
      // Crosshair position remains untouched by secondTouchScreenPos
      crosshairPos: { ...state.crosshairPos },
      crosshairAnchor: { ...state.crosshairAnchor },
      draftDrawing: null,
      draftStep: 0,
      committedDrawings: [...state.committedDrawings, newObj],
    });

    // 1-Point Tools: horizontal_line, vertical_line, price_note, long_position, short_position
    if (tool === 'horizontal_line') {
      return finishCommit({
        id,
        pair: action.pair,
        type: 'horizontal_line',
        p1: anchor,
        p2: {
          logical: anchor.logical + 25,
          price: anchor.price,
          time: anchor.time !== undefined ? Math.round(anchor.time + 25 * stepSec) : undefined,
        },
        createdAtTime: anchor.time,
        color: '#2962FF',
        lineWidth: 2,
      });
    }

    if (tool === 'vertical_line') {
      return finishCommit({
        id,
        pair: action.pair,
        type: 'vertical_line',
        p1: anchor,
        p2: { logical: anchor.logical, price: anchor.price + action.volatility * 2, time: anchor.time },
        createdAtTime: anchor.time,
        color: '#2962FF',
        lineWidth: 2,
      });
    }

    if (tool === 'price_note') {
      const noteOffsetPrice = action.volatility * 1.8;
      return finishCommit({
        id,
        pair: action.pair,
        type: 'price_note',
        p1: anchor,
        p2: {
          logical: anchor.logical + 7,
          price: Number((anchor.price + noteOffsetPrice).toFixed(action.decimals)),
          time: anchor.time !== undefined ? Math.round(anchor.time + 7 * stepSec) : undefined,
        },
        createdAtTime: anchor.time,
        color: '#2962FF',
        lineWidth: 2,
      });
    }

    if (tool === 'long_position' || tool === 'long' || tool === 'short_position' || tool === 'short') {
      const isLong = tool === 'long_position' || tool === 'long';
      const defaultOffsetBars = 22;
      const normalized = normalizePositionPrices(
        isLong,
        anchor.price,
        undefined,
        undefined,
        action.volatility,
        action.decimals
      );
      const effectiveAnchorTime =
        anchor.time !== undefined && Number.isFinite(anchor.time)
          ? anchor.time
          : Math.round(Date.now() / 1000);
      const p2Time = Math.round(effectiveAnchorTime + defaultOffsetBars * stepSec);
      return finishCommit({
        id,
        pair: action.pair,
        type: isLong ? 'long_position' : 'short_position',
        p1: { ...anchor, price: normalized.entryPrice, time: effectiveAnchorTime },
        p2: {
          logical: anchor.logical + defaultOffsetBars,
          price: normalized.entryPrice,
          time: p2Time,
        },
        createdAtTime: effectiveAnchorTime,
        color: '#2962FF',
        lineWidth: 2,
        slPrice: normalized.slPrice,
        tpPrice: normalized.tpPrice,
      });
    }

    // 3-Point Tool: fib_extension
    if (tool === 'fib_extension') {
      if (!state.draftDrawing) {
        return {
          ...state,
          placementState: 'awaiting_confirmation',
          draftDrawing: {
            id,
            pair: action.pair,
            type: 'fib_extension',
            p1: anchor,
            p2: {
              logical: anchor.logical + 8,
              price: Number((anchor.price + action.volatility * 3).toFixed(action.decimals)),
              time: anchor.time !== undefined ? Math.round(anchor.time + 8 * stepSec) : undefined,
            },
            p3: {
              logical: anchor.logical + 14,
              price: Number((anchor.price + action.volatility * 1.2).toFixed(action.decimals)),
              time: anchor.time !== undefined ? Math.round(anchor.time + 14 * stepSec) : undefined,
            },
            createdAtTime: anchor.time,
            color: '#2962FF',
            lineWidth: 2,
          },
          draftStep: 1,
        };
      }
      if (state.draftStep === 1) {
        return {
          ...state,
          placementState: 'awaiting_confirmation',
          draftDrawing: {
            ...state.draftDrawing,
            p2: anchor,
            p3: {
              logical: anchor.logical + 6,
              price: Number(((state.draftDrawing.p1.price + anchor.price) / 2).toFixed(action.decimals)),
              time: anchor.time !== undefined ? Math.round(anchor.time + 6 * stepSec) : undefined,
            },
          },
          draftStep: 2,
        };
      }
      return finishCommit({
        ...state.draftDrawing,
        p3: anchor,
      });
    }

    // 2-Point Tools: trendline, ray, fib_retracement, rectangle
    if (!state.draftDrawing) {
      return {
        ...state,
        placementState: 'awaiting_confirmation',
        draftDrawing: {
          id,
          pair: action.pair,
          type: tool,
          p1: anchor,
          p2: {
            logical: anchor.logical + 12,
            price: Number((anchor.price + action.volatility * 2).toFixed(action.decimals)),
            time: anchor.time !== undefined ? Math.round(anchor.time + 12 * stepSec) : undefined,
          },
          createdAtTime: anchor.time,
          color: '#2962FF',
          lineWidth: 2,
        },
        draftStep: 1,
      };
    }

    return finishCommit({
      ...state.draftDrawing,
      p2: anchor,
    });
  }

  return state;
}

export interface MarketChartPreferences {
  symbol: string;
  interval: string;
  studies: string[];
  tradingViewChartUrl: string;
  theme: 'dark' | 'light';
  backgroundColor: string;
  gridColorHex: string;
  gridOpacity: number;
  hideTopToolbar: boolean;
  hideSideToolbar: boolean;
  hideVolume: boolean;
  withDateRanges: boolean;
  hideLegend: boolean;
  candleColorStyle?: CandleColorStyle;
  updatedAt?: string;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface WorkspaceBounds {
  top: number;
  bottom: number;
  left: number;
}

export interface ComputedChartWorkspaceLayout {
  mode: ChartDisplayMode;
  top: string;
  left: string;
  width: number;
  height: number;
  zIndex: number;
  isImmersive: boolean;
}

export const CHART_PREFS_STORAGE_KEY = 'tradevault_market_chart_prefs_v1';
export const CHART_DISPLAY_MODE_STORAGE_KEY = 'tradevault_market_chart_display_mode_v2';
export const CHART_DRAWINGS_STORAGE_KEY = 'tradevault_lw_chart_drawings_v1';
export const CHART_FAVORITE_TOOLS_STORAGE_KEY = 'tradevault_lw_chart_fav_tools_v1';
export const CHART_SHOW_FAV_TOOLBAR_STORAGE_KEY = 'tradevault_lw_chart_show_fav_bar_v1';
export const CHART_ENGINE_MODE_STORAGE_KEY = 'tradevault_chart_engine_mode_v2';
export const TWELVE_DATA_API_KEY_STORAGE_KEY = 'tradevault_twelve_data_api_key_v1';

export type ChartEngineMode = 'live_oanda' | 'replay_studio';

export const DEFAULT_TWELVE_DATA_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TWELVE_DATA_API_KEY) ||
  'cb5797ff73ff4ab79260ef8202a66739';

export function getStoredTwelveDataApiKey(): string {
  if (typeof window === 'undefined') return DEFAULT_TWELVE_DATA_API_KEY;
  try {
    const stored = window.localStorage.getItem(TWELVE_DATA_API_KEY_STORAGE_KEY);
    return stored && stored.trim().length > 5 ? stored.trim() : DEFAULT_TWELVE_DATA_API_KEY;
  } catch {
    return DEFAULT_TWELVE_DATA_API_KEY;
  }
}

export function saveStoredTwelveDataApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!key || !key.trim()) {
      window.localStorage.removeItem(TWELVE_DATA_API_KEY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(TWELVE_DATA_API_KEY_STORAGE_KEY, key.trim());
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadStoredChartEngineMode(): ChartEngineMode {
  if (typeof window === 'undefined') return 'replay_studio';
  try {
    const raw = window.localStorage.getItem(CHART_ENGINE_MODE_STORAGE_KEY);
    if (raw === 'live_oanda' || raw === 'replay_studio') return raw;
    return 'replay_studio';
  } catch {
    return 'replay_studio';
  }
}

export function saveStoredChartEngineMode(mode: ChartEngineMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_ENGINE_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota errors
  }
}

export function getTwelveDataInterval(value: string): string {
  switch (value) {
    case '1':
      return '1min';
    case '3':
      return '5min';
    case '5':
      return '5min';
    case '15':
      return '15min';
    case '60':
      return '1h';
    case '240':
      return '4h';
    case 'D':
    case '1d':
      return '1day';
    default:
      return '15min';
  }
}

export const DEFAULT_CHART_PREFS: MarketChartPreferences = {
  symbol: 'OANDA:XAUUSD',
  interval: '15',
  studies: ['EMA20', 'JOURNAL_LINES'],
  tradingViewChartUrl: '',
  theme: 'dark',
  backgroundColor: '#000000',
  gridColorHex: '#000000',
  gridOpacity: 0,
  hideTopToolbar: true,
  hideSideToolbar: true,
  hideVolume: true,
  withDateRanges: false,
  hideLegend: false,
  candleColorStyle: 'monochrome',
};

/**
 * 2 Vertical 3D Wheel Pickers on the Left of the Bottom Control Bar:
 * - Pair: XAUUSD, BTCUSD, EURUSD, GBPUSD, USDIDR
 * - Timeframe: 1m, 3m, 5m, 15m, 1h, 4h, 1D
 */
export const WHEEL_PAIRS: Array<{
  label: string;
  symbol: string;
  binanceSymbol: string | null;
  twelveDataSymbol: string | null;
  decimals: number;
  basePrice: number;
  volatility: number;
  sourceLabel: string;
}> = [
  {
    label: 'XAUUSD',
    symbol: 'OANDA:XAUUSD',
    binanceSymbol: 'PAXGUSDT',
    twelveDataSymbol: 'XAU/USD',
    decimals: 2,
    basePrice: 4065.0,
    volatility: 3.5,
    sourceLabel: 'SPOT GOLD (XAU/USD)',
  },
  {
    label: 'BTCUSD',
    symbol: 'BINANCE:BTCUSDT',
    binanceSymbol: 'BTCUSDT',
    twelveDataSymbol: 'BTC/USD',
    decimals: 2,
    basePrice: 88500.0,
    volatility: 95.0,
    sourceLabel: 'BINANCE SPOT',
  },
  {
    label: 'EURUSD',
    symbol: 'OANDA:EURUSD',
    binanceSymbol: 'EURUSDT',
    twelveDataSymbol: 'EUR/USD',
    decimals: 5,
    basePrice: 1.1143,
    volatility: 0.0006,
    sourceLabel: 'FOREX SPOT',
  },
  {
    label: 'GBPUSD',
    symbol: 'OANDA:GBPUSD',
    binanceSymbol: 'GBPUSDT',
    twelveDataSymbol: 'GBP/USD',
    decimals: 5,
    basePrice: 1.1805,
    volatility: 0.0008,
    sourceLabel: 'FOREX SPOT',
  },
  {
    label: 'USDIDR',
    symbol: 'FX_IDC:USDIDR',
    binanceSymbol: null,
    twelveDataSymbol: 'USD/IDR',
    decimals: 0,
    basePrice: 18100,
    volatility: 25,
    sourceLabel: 'BANK SPOT',
  },
];

export const WHEEL_TIMEFRAMES: Array<{
  label: string;
  value: string;
  binanceInterval: string;
  seconds: number;
}> = [
  { label: '1m', value: '1', binanceInterval: '1m', seconds: 60 },
  { label: '3m', value: '3', binanceInterval: '3m', seconds: 180 },
  { label: '5m', value: '5', binanceInterval: '5m', seconds: 300 },
  { label: '15m', value: '15', binanceInterval: '15m', seconds: 900 },
  { label: '1h', value: '60', binanceInterval: '1h', seconds: 3600 },
  { label: '4h', value: '240', binanceInterval: '4h', seconds: 14400 },
  { label: '1D', value: 'D', binanceInterval: '1d', seconds: 86400 },
];

export const SYMBOL_PRESETS = WHEEL_PAIRS.map((p) => ({
  label: p.label,
  shortName: p.label,
  broker: p.symbol.split(':')[0] || 'SPOT',
  symbol: p.symbol,
}));

export const INTERVAL_PRESETS = WHEEL_TIMEFRAMES.map((tf) => ({
  label: tf.label,
  value: tf.value,
}));

export const STUDY_PRESETS: Array<{ label: string; shortLabel: string; id: string; color: string }> =
  [
    { label: 'EMA 20 (Exponential MA)', shortLabel: 'EMA 20', id: 'EMA20', color: '#38BDF8' },
    { label: 'EMA 50 (Exponential MA)', shortLabel: 'EMA 50', id: 'EMA50', color: '#F59E0B' },
    { label: 'SMA 200 (Simple MA)', shortLabel: 'SMA 200', id: 'SMA200', id2: 'SMA200', color: '#A855F7' } as any,
    { label: 'Sesi Pasar (Asia, London, NY)', shortLabel: 'Sesi Pasar', id: 'SESSION_BOX', color: '#38BDF8' },
    { label: 'Garis Posisi Jurnal Aktif (Open / Plan)', shortLabel: 'Jurnal Aktif', id: 'JOURNAL_LINES', color: '#2962FF' },
  ];

const DISPLAY_MODE_OPTIONS: Array<{
  id: ChartDisplayMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'normal',
    label: 'Tampilan App',
    shortLabel: 'App',
    description:
      'Tampilan standar di dalam aplikasi VLO dengan navbar atas dan navigasi bawah tetap terlihat.',
  },
  {
    id: 'full',
    label: 'Tampilan Penuh',
    shortLabel: 'Penuh',
    description:
      'Chart memenuhi seluruh area layar. Navbar atas dan navigasi bawah VLO disembunyikan.',
  },
  {
    id: 'landscape',
    label: 'Mode Landscape',
    shortLabel: 'Landscape',
    description:
      'Tampilan layar penuh horizontal (mengunci orientasi landscape otomatis pada perangkat yang mendukung).',
  },
];

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

export function hexToRgba(hex: string, opacityPercent: number): string {
  const cleanHex = isValidHexColor(hex) ? hex.trim().slice(1) : 'FFFFFF';
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  const clampedAlpha = Math.min(100, Math.max(0, Number(opacityPercent) || 0)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${Number(clampedAlpha.toFixed(2))})`;
}

export function isValidDisplayMode(value: unknown): value is ChartDisplayMode {
  return value === 'normal' || value === 'full' || value === 'landscape';
}

export function loadStoredDisplayMode(): ChartDisplayMode {
  if (typeof window === 'undefined') return 'normal';
  try {
    const raw = window.localStorage.getItem(CHART_DISPLAY_MODE_STORAGE_KEY);
    return isValidDisplayMode(raw) ? raw : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveStoredDisplayMode(mode: ChartDisplayMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_DISPLAY_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota errors safely
  }
}

export function getScopedChartPrefsKey(userId?: string | null): string {
  const cleanId = typeof userId === 'string' ? userId.trim() : '';
  return cleanId ? `${CHART_PREFS_STORAGE_KEY}_user_${cleanId}` : CHART_PREFS_STORAGE_KEY;
}

export function sanitizeChartPreferences(raw: unknown): MarketChartPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CHART_PREFS };
  const parsed = raw as Record<string, unknown>;

  const cleanSymbol =
    typeof parsed.symbol === 'string' && /^[A-Za-z0-9_.:-]{2,40}$/.test(parsed.symbol.trim())
      ? parsed.symbol.trim().toUpperCase()
      : DEFAULT_CHART_PREFS.symbol;

  const validIntervals = new Set(['1', '3', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M']);
  const cleanInterval =
    typeof parsed.interval === 'string' && validIntervals.has(parsed.interval.trim())
      ? parsed.interval.trim()
      : DEFAULT_CHART_PREFS.interval;

  const cleanStudies = Array.isArray(parsed.studies)
    ? parsed.studies
        .filter(
          (s): s is string =>
            typeof s === 'string' &&
            s.trim().length > 0 &&
            !/volume/i.test(s)
        )
        .slice(0, 8)
    : DEFAULT_CHART_PREFS.studies;

  return {
    symbol: cleanSymbol,
    interval: cleanInterval,
    studies: cleanStudies,
    tradingViewChartUrl: '',
    theme: 'dark',
    backgroundColor: '#000000',
    gridColorHex: '#000000',
    gridOpacity: 0,
    hideTopToolbar: true,
    hideSideToolbar:
      typeof parsed.hideSideToolbar === 'boolean'
        ? parsed.hideSideToolbar
        : DEFAULT_CHART_PREFS.hideSideToolbar,
    hideVolume: true,
    withDateRanges: false,
    hideLegend: false,
    candleColorStyle: parsed.candleColorStyle === 'classic' && parsed.updatedAt ? 'classic' : 'monochrome',
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
  };
}

export function loadStoredChartPreferences(userId?: string | null): MarketChartPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_CHART_PREFS };
  try {
    const scopedKey = getScopedChartPrefsKey(userId);
    const raw =
      window.localStorage.getItem(scopedKey) ||
      window.localStorage.getItem(CHART_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHART_PREFS };
    return sanitizeChartPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHART_PREFS };
  }
}

export function saveStoredChartPreferences(
  prefs: MarketChartPreferences,
  userId?: string | null
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify(prefs);
    window.localStorage.setItem(getScopedChartPrefsKey(userId), payload);
    window.localStorage.setItem(CHART_PREFS_STORAGE_KEY, payload);
  } catch {
    // Ignore storage quota errors safely
  }
}

function loadStoredDrawings(): ChartDrawingObject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHART_DRAWINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredDrawings(drawings: ChartDrawingObject[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_DRAWINGS_STORAGE_KEY, JSON.stringify(drawings));
  } catch {
    // Ignore storage quota errors safely
  }
}

function loadStoredFavoriteTools(): ActiveDrawingToolId[] {
  if (typeof window === 'undefined') return [...DEFAULT_FAVORITE_DRAWING_TOOLS];
  try {
    const raw = window.localStorage.getItem(CHART_FAVORITE_TOOLS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_FAVORITE_DRAWING_TOOLS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_FAVORITE_DRAWING_TOOLS];
    const validSet = new Set<string>(DRAWING_TOOLS_CATALOG.map((t) => t.id));
    const filtered = parsed.filter(
      (id): id is ActiveDrawingToolId => typeof id === 'string' && validSet.has(id)
    );
    return filtered.length > 0 ? filtered : [...DEFAULT_FAVORITE_DRAWING_TOOLS];
  } catch {
    return [...DEFAULT_FAVORITE_DRAWING_TOOLS];
  }
}

function saveStoredFavoriteTools(favs: ActiveDrawingToolId[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_FAVORITE_TOOLS_STORAGE_KEY, JSON.stringify(favs));
  } catch {
    // Ignore storage quota errors safely
  }
}

function loadStoredShowFavoritesToolbar(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(CHART_SHOW_FAV_TOOLBAR_STORAGE_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

function saveStoredShowFavoritesToolbar(val: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_SHOW_FAV_TOOLBAR_STORAGE_KEY, val ? 'true' : 'false');
  } catch {
    // Ignore storage quota errors safely
  }
}

export function readActualViewportSize(): ViewportSize {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { width: 390, height: 844 };
  }
  const width = Math.round(
    window.innerWidth ||
      document.documentElement.clientWidth ||
      window.visualViewport?.width ||
      390
  );
  const height = Math.round(
    window.innerHeight ||
      document.documentElement.clientHeight ||
      window.visualViewport?.height ||
      844
  );
  return { width, height };
}

export function computeChartWorkspaceLayout(
  mode: ChartDisplayMode,
  viewport: ViewportSize,
  bounds: WorkspaceBounds
): ComputedChartWorkspaceLayout {
  const vw = Math.max(240, Math.round(viewport.width));
  const vh = Math.max(240, Math.round(viewport.height));

  if (mode === 'full' || mode === 'landscape') {
    return {
      mode,
      top: '0px',
      left: '0px',
      width: vw,
      height: vh,
      zIndex: 55,
      isImmersive: true,
    };
  }

  const safeTop = Math.max(0, Math.round(bounds.top));
  const safeBottom = Math.max(0, Math.round(bounds.bottom));
  const safeLeft = Math.max(0, Math.round(bounds.left));

  return {
    mode: 'normal',
    top: `${safeTop}px`,
    left: `${safeLeft}px`,
    width: Math.max(200, vw - safeLeft),
    height: Math.max(180, vh - safeTop - safeBottom),
    zIndex: 20,
    isImmersive: false,
  };
}

function resolvePairWheelIndex(symbol: string): number {
  const clean = (symbol || '').trim().toUpperCase();
  const idx = WHEEL_PAIRS.findIndex((p) => p.symbol.toUpperCase() === clean);
  if (idx !== -1) return idx;
  const ticker = clean.replace(/^.*:/, '');
  const fallbackIdx = WHEEL_PAIRS.findIndex(
    (p) => p.label.toUpperCase() === ticker || p.symbol.endsWith(`:${ticker}`)
  );
  return fallbackIdx !== -1 ? fallbackIdx : 0;
}

function resolveTfWheelIndex(interval: string): number {
  const clean = (interval || '').trim();
  const idx = WHEEL_TIMEFRAMES.findIndex((tf) => tf.value === clean);
  return idx !== -1 ? idx : 3;
}

/**
 * Check if the traditional market is open or closed for a given pair.
 * Crypto (BTC, ETH, SOL) trades 24/7/365.
 * Traditional Markets (Gold/XAUUSD, Forex EURUSD, GBPUSD, USDIDR) close for the weekend
 * from Friday 22:00 UTC until Sunday 22:00 UTC (identical to MT5 & TradingView OANDA/FXCM).
 */
export function isMarketOpenForPair(
  pairLabel: string,
  date = new Date()
): { isOpen: boolean; statusText: string } {
  const clean = pairLabel.toUpperCase();
  // Crypto is open 24/7
  if (clean.includes('BTC') || clean.includes('ETH') || clean.includes('SOL') || clean.includes('CRYPTO')) {
    return { isOpen: true, statusText: 'LIVE' };
  }

  // Traditional Markets: Gold (XAUUSD) & Forex — Strictly Monday to Friday (Senin - Jumat)
  const utcDay = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const utcHour = date.getUTCHours();

  // Saturday (6) & Sunday (0): Strictly closed all day
  if (utcDay === 6 || utcDay === 0) {
    return { isOpen: false, statusText: 'PASAR TUTUP (Sabtu–Minggu)' };
  }

  // Friday after 22:00 UTC (17:00 NY time): Closed for the weekend
  if (utcDay === 5 && utcHour >= 22) {
    return { isOpen: false, statusText: 'PASAR TUTUP (Sabtu–Minggu)' };
  }

  return { isOpen: true, statusText: 'LIVE (Senin–Jumat)' };
}

/**
 * Get the exact UTC timestamp for the most recent Friday market close (22:00 UTC).
 * Used to cap traditional market candles when the market is closed so weekend crypto activity isn't displayed.
 */
export function getMostRecentFridayCloseTimestamp(now = new Date()): number {
  const date = new Date(now.getTime());
  const utcDay = date.getUTCDay();
  const utcHour = date.getUTCHours();

  let daysBack = 0;
  if (utcDay === 6) {
    daysBack = 1;
  } else if (utcDay === 0) {
    daysBack = 2;
  } else if (utcDay === 5 && utcHour >= 22) {
    daysBack = 0;
  } else {
    return Math.floor(now.getTime() / 1000);
  }

  const friday = new Date(date.getTime() - daysBack * 86400000);
  friday.setUTCHours(22, 0, 0, 0);
  return Math.floor(friday.getTime() / 1000);
}

/**
 * Deterministic multi-timeframe coherent historical candle generator for Forex/Gold/Crypto pairs.
 * Evaluates a continuous multi-octave price curve `priceAtTimestamp(t)` at exact UTC timestamps `t`,
 * guaranteeing that 1m, 3m, 5m, 15m, 1h, 4h, and 1D candles have 100% identical price levels at every
 * point in time and always produce `count` valid trading candles after weekend filtering.
 */
export function generateRealisticCandles(
  pairLabel: string,
  basePrice: number,
  volatility: number,
  decimals: number,
  intervalSeconds: number,
  count = 500
): OhlcCandle[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const marketStatus = isMarketOpenForPair(pairLabel);
  const effectiveEndSec = !marketStatus.isOpen
    ? Math.min(nowSec, getMostRecentFridayCloseTimestamp())
    : nowSec;
  const currentBarTime = Math.floor(effectiveEndSec / intervalSeconds) * intervalSeconds;

  const cleanPair = (pairLabel || '').toUpperCase();
  const isCrypto =
    cleanPair.includes('BTC') ||
    cleanPair.includes('ETH') ||
    cleanPair.includes('SOL') ||
    cleanPair.includes('CRYPTO');

  let pairHash = 2166136261;
  for (let i = 0; i < cleanPair.length; i++) {
    pairHash ^= cleanPair.charCodeAt(i);
    pairHash = Math.imul(pairHash, 16777619) >>> 0;
  }
  const phase1 = (pairHash & 0xffff) / 0xffff * Math.PI * 2;
  const phase2 = ((pairHash >>> 8) & 0xffff) / 0xffff * Math.PI * 2;
  const phase3 = ((pairHash >>> 16) & 0xffff) / 0xffff * Math.PI * 2;

  // Deterministic continuous price function of Unix timestamp `sec`
  // Uses fixed multi-scale waves centered around `basePrice` so all timeframes match at identical timestamps.
  const priceAtSec = (sec: number): number => {
    const tHours = sec / 3600;
    const slowWave = Math.sin(tHours * 0.045 + phase1) * volatility * 2.4;
    const medWave = Math.cos(tHours * 0.21 + phase2) * volatility * 1.15;
    const fastWave = Math.sin(tHours * 0.85 + phase3) * volatility * 0.55;
    const microWave = Math.cos(sec / 300 * 0.63 + phase1) * volatility * 0.22;
    return Math.max(basePrice * 0.2, basePrice + slowWave + medWave + fastWave + microWave);
  };

  const isTradingTimestamp = (sec: number): boolean => {
    if (isCrypto) return true;
    const d = new Date(sec * 1000);
    const utcDay = d.getUTCDay();
    const utcHour = d.getUTCHours();
    if (utcDay === 6) return false;
    if (utcDay === 0 && utcHour < 21) return false;
    if (utcDay === 5 && utcHour >= 22) return false;
    return true;
  };

  const timestamps: number[] = [];
  let cursor = currentBarTime;
  let guard = 0;
  const maxSteps = count * 6;
  while (timestamps.length < count && guard < maxSteps) {
    if (isTradingTimestamp(cursor)) {
      timestamps.push(cursor);
    }
    cursor -= intervalSeconds;
    guard++;
  }
  timestamps.reverse();

  const minTick = Number((1 / Math.pow(10, decimals)).toFixed(decimals));
  const candles: OhlcCandle[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const barTime = timestamps[i];
    const openRaw = priceAtSec(barTime);
    const closeRaw = priceAtSec(barTime + intervalSeconds);
    const sample1 = priceAtSec(barTime + Math.floor(intervalSeconds * 0.25));
    const sample2 = priceAtSec(barTime + Math.floor(intervalSeconds * 0.5));
    const sample3 = priceAtSec(barTime + Math.floor(intervalSeconds * 0.75));

    const open = Number(openRaw.toFixed(decimals));
    let close = Number(closeRaw.toFixed(decimals));
    if (close === open) {
      close = Number((open + (i % 2 === 0 ? minTick : -minTick)).toFixed(decimals));
    }

    const wickPad = Math.max(minTick * 2, volatility * 0.14);
    const maxSample = Math.max(open, close, sample1, sample2, sample3);
    const minSample = Math.min(open, close, sample1, sample2, sample3);
    const high = Number((maxSample + wickPad).toFixed(decimals));
    const low = Number(Math.max(minTick, minSample - wickPad).toFixed(decimals));

    candles.push({
      time: barTime as UTCTimestamp,
      open,
      high,
      low,
      close,
    });
  }

  return candles;
}

const CANDLE_CACHE_PREFIX = 'tradevault_candle_cache_v5_';

function getCandleCacheKey(symbol: string, interval: string): string {
  return `${CANDLE_CACHE_PREFIX}${symbol.toUpperCase()}_${interval}`;
}

/**
 * BAGIAN 1: Filter Anti-Flatline & Weekend (Hapus Garis Lurus Putus-Putus)
 * a) Buang semua candle flat/mati di mana open === high && high === low && low === close.
 * b) Buang candle pada jam pasar Forex libur akhir pekan (Sabtu sepanjang hari, Minggu sebelum jam 21:00 UTC / Senin 04:00 WIB, dan Jumat >= 22:00 UTC).
 * c) Urutkan array secara kronologis (sort((a, b) => a.time - b.time)) dan pastikan tidak ada duplikat waktu.
 */
export function sanitizeAndFilterCandles(candles: OhlcCandle[], pairLabel: string): OhlcCandle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const cleanPair = (pairLabel || '').toUpperCase();
  const isCrypto =
    cleanPair.includes('BTC') ||
    cleanPair.includes('ETH') ||
    cleanPair.includes('SOL') ||
    cleanPair.includes('CRYPTO');

  const valid = candles.filter((c) => {
    if (
      !c ||
      isNaN(Number(c.time)) ||
      isNaN(Number(c.open)) ||
      isNaN(Number(c.high)) ||
      isNaN(Number(c.low)) ||
      isNaN(Number(c.close))
    ) {
      return false;
    }

    // a) Buang semua candle flat/mati (open === high && high === low && low === close)
    if (c.open === c.high && c.high === c.low && c.low === c.close) {
      return false;
    }

    // b) Buang candle pada jam pasar Forex/Emas libur akhir pekan (Hanya hari kerja Senin–Jumat)
    if (!isCrypto) {
      const d = new Date(Number(c.time) * 1000);
      const utcDay = d.getUTCDay(); // 0 = Minggu, 1..5 = Senin..Jumat, 6 = Sabtu
      const utcHour = d.getUTCHours();

      // Sabtu (6) & Minggu (0) sepanjang hari: buang (hanya hari kerja Senin–Jumat)
      if (utcDay === 6 || utcDay === 0) return false;
      // Jumat mulai jam 22:00 UTC: buang
      if (utcDay === 5 && utcHour >= 22) return false;
    }

    return true;
  });

  // c) Urutkan secara kronologis & hapus duplikat waktu
  valid.sort((a, b) => Number(a.time) - Number(b.time));

  const deduped: OhlcCandle[] = [];
  const seenTimes = new Set<number>();
  for (const item of valid) {
    const t = Number(item.time);
    if (!seenTimes.has(t)) {
      seenTimes.add(t);
      deduped.push(item);
    }
  }

  return deduped;
}

export function loadCachedCandles(symbol: string, interval: string, pairLabel = 'XAUUSD'): OhlcCandle[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getCandleCacheKey(symbol, interval));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const cleaned = sanitizeAndFilterCandles(parsed, pairLabel);
      return cleaned.length > 0 ? cleaned : null;
    }
  } catch {
    // Ignore parse error
  }
  return null;
}

function saveCachedCandles(symbol: string, interval: string, candles: OhlcCandle[]) {
  if (typeof window === 'undefined' || !candles || candles.length === 0) return;
  try {
    const slice = candles.slice(-1000);
    localStorage.setItem(getCandleCacheKey(symbol, interval), JSON.stringify(slice));
  } catch {
    // Ignore storage quota error gracefully
  }
}

/**
 * Fetch up to 1000 historical klines with strict cross-timeframe price coherence:
 * - For pairs with `binanceSymbol` (XAUUSD via PAXGUSDT, BTCUSD via BTCUSDT), fetches from Binance first
 *   (`limit=1000`) so all 7 timeframes (`1m`, `3m`, `5m`, `15m`, `1h`, `4h`, `1D`) share the exact same
 *   exchange feed and live WebSocket price without Twelve Data rate-limit fallbacks shifting prices by $10+ across timeframes.
 * - For pure Forex pairs (`EURUSD`, `GBPUSD`, `USDIDR`), uses Twelve Data (`outputsize=1000`) with coherent fallback.
 */
async function fetchHistoricalCandles(
  pairMeta: (typeof WHEEL_PAIRS)[number],
  tfMeta: (typeof WHEEL_TIMEFRAMES)[number],
  signal?: AbortSignal
): Promise<{ candles: OhlcCandle[]; source: 'twelvedata' | 'binance' | 'cached' | 'synthetic' }> {
  const marketStatus = isMarketOpenForPair(pairMeta.label);

  // 1. Prioritize Binance REST API (`limit=1000`) when `binanceSymbol` is available so all timeframes
  // (`1m`, `3m`, `5m`, `15m`, `1h`, `4h`, `1d`) have 100% identical prices and zero rate-limit divergence.
  if (pairMeta.binanceSymbol) {
    const endpoints = [
      `https://data-api.binance.vision/api/v3/klines?symbol=${pairMeta.binanceSymbol}&interval=${tfMeta.binanceInterval}&limit=1000`,
      `https://api.binance.com/api/v3/klines?symbol=${pairMeta.binanceSymbol}&interval=${tfMeta.binanceInterval}&limit=1000`,
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) continue;
        const raw = await res.json();
        if (Array.isArray(raw) && raw.length > 0) {
          const rawMapped: OhlcCandle[] = raw.map((row: any[]) => ({
            time: Math.floor(Number(row[0]) / 1000) as UTCTimestamp,
            open: Number(parseFloat(row[1]).toFixed(pairMeta.decimals)),
            high: Number(parseFloat(row[2]).toFixed(pairMeta.decimals)),
            low: Number(parseFloat(row[3]).toFixed(pairMeta.decimals)),
            close: Number(parseFloat(row[4]).toFixed(pairMeta.decimals)),
          }));

          let parsed = sanitizeAndFilterCandles(rawMapped, pairMeta.label);

          if (!marketStatus.isOpen) {
            const fridayClose = getMostRecentFridayCloseTimestamp();
            parsed = parsed.filter((c) => c.time <= fridayClose);
          }

          if (parsed.length > 0) {
            saveCachedCandles(pairMeta.symbol, tfMeta.value, parsed);
            return { candles: parsed, source: 'binance' };
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
      }
    }
  }

  // 2. Try Twelve Data (`outputsize=1000`) for Forex pairs or if Binance was unreachable
  if (pairMeta.twelveDataSymbol) {
    const apiKey = getStoredTwelveDataApiKey();
    if (apiKey && apiKey.trim().length > 5) {
      const twelveInterval = getTwelveDataInterval(tfMeta.value);
      const twelveUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
        pairMeta.twelveDataSymbol
      )}&interval=${twelveInterval}&outputsize=1000&timezone=UTC&apikey=${encodeURIComponent(
        apiKey.trim()
      )}`;

      try {
        const res = await fetch(twelveUrl, { signal });
        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'ok' && Array.isArray(data.values) && data.values.length > 0) {
            const rawMapped: OhlcCandle[] = data.values
              .slice()
              .reverse()
              .map((row: any) => {
                const rawDt: string = String(row.datetime || '');
                const iso = rawDt.includes(' ')
                  ? rawDt.replace(' ', 'T') + 'Z'
                  : rawDt.length === 10
                    ? rawDt + 'T00:00:00Z'
                    : rawDt;
                const timeSec = Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
                return {
                  time: timeSec,
                  open: Number(parseFloat(row.open).toFixed(pairMeta.decimals)),
                  high: Number(parseFloat(row.high).toFixed(pairMeta.decimals)),
                  low: Number(parseFloat(row.low).toFixed(pairMeta.decimals)),
                  close: Number(parseFloat(row.close).toFixed(pairMeta.decimals)),
                };
              });

            let parsed = sanitizeAndFilterCandles(rawMapped, pairMeta.label);

            if (!marketStatus.isOpen) {
              const fridayClose = getMostRecentFridayCloseTimestamp();
              parsed = parsed.filter((c) => c.time <= fridayClose);
            }

            if (parsed.length > 0) {
              saveCachedCandles(pairMeta.symbol, tfMeta.value, parsed);
              return { candles: parsed, source: 'twelvedata' };
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        console.warn('Twelve Data fetch fallback:', err);
      }
    }
  }

  // 3. Check cached candles before synthetic fallback
  const cached = loadCachedCandles(pairMeta.symbol, tfMeta.value, pairMeta.label);
  if (cached && cached.length > 0) {
    let result = cached;
    if (!marketStatus.isOpen) {
      const fridayClose = getMostRecentFridayCloseTimestamp();
      result = cached.filter((c) => c.time <= fridayClose);
    }
    if (result.length > 0) {
      return { candles: result, source: 'cached' };
    }
  }

  // 4. Deterministic multi-timeframe coherent fallback
  const fallbackCandles = sanitizeAndFilterCandles(
    generateRealisticCandles(
      pairMeta.label,
      pairMeta.basePrice,
      pairMeta.volatility,
      pairMeta.decimals,
      tfMeta.seconds,
      600
    ),
    pairMeta.label
  );
  return {
    candles: fallbackCandles,
    source: 'synthetic',
  };
}

function calculateEMA(candles: OhlcCandle[], period: number): Array<{ time: UTCTimestamp; value: number }> {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  let ema = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    ema = i === 0 ? close : close * k + ema * (1 - k);
    result.push({ time: candles[i].time, value: ema });
  }
  return result;
}

function calculateSMA(
  candles: OhlcCandle[],
  period: number
): Array<{ time: UTCTimestamp; value: number } | { time: UTCTimestamp }> {
  if (candles.length === 0) return [];
  const result: Array<{ time: UTCTimestamp; value: number } | { time: UTCTimestamp }> = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      result.push({ time: candles[i].time, value: sum / period });
    } else {
      result.push({ time: candles[i].time });
    }
  }
  return result;
}

/**
 * Converts candles after `cutIndex` into pure Whitespace objects `{ time: candle.time }`
 * (without open, high, low, close) using `.map()` so the array length remains 100% constant.
 */
function buildReplayCandlestickData(
  allCandles: OhlcCandle[],
  cutIndex: number
): Array<OhlcCandle | { time: UTCTimestamp }> {
  return allCandles.map((candle, idx) => {
    if (idx <= cutIndex) {
      return candle; // Data candle utuh { time, open, high, low, close }
    }
    return { time: candle.time }; // Whitespace object (HANYA time, tanpa open/high/low/close)
  });
}

function buildReplayIndicatorData(
  computedLine: Array<{ time: UTCTimestamp; value: number } | { time: UTCTimestamp }>,
  allCandles: OhlcCandle[],
  cutIdx?: number
): Array<{ time: UTCTimestamp; value: number } | { time: UTCTimestamp }> {
  if (cutIdx === undefined) return computedLine;
  return allCandles.map((candle, idx) => {
    if (idx <= cutIdx && idx < computedLine.length) {
      return computedLine[idx];
    }
    return { time: candle.time };
  });
}

const WIB_DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const WIB_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * Format timestamp (seconds) into UTC+7 (Asia/Bangkok / Asia/Jakarta) Indonesian label:
 * e.g. "Sab 07 Nov '26 02:20"
 */
export function formatWibDateTimeLabel(unixSec: number): string {
  const safeSec = Number.isFinite(unixSec) ? unixSec : Math.floor(Date.now() / 1000);
  const wibMs = safeSec * 1000 + 7 * 3600 * 1000;
  const d = new Date(wibMs);
  const dayName = WIB_DAYS[d.getUTCDay()] || 'Sab';
  const dateNum = String(d.getUTCDate()).padStart(2, '0');
  const monthName = WIB_MONTHS[d.getUTCMonth()] || 'Nov';
  const yearShort = String(d.getUTCFullYear()).slice(-2);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dayName} ${dateNum} ${monthName} '${yearShort} ${hours}:${mins}`;
}

export interface TradingViewOandaWidgetProps {
  symbol: string;
  interval: string;
  theme?: 'dark' | 'light';
  locale?: 'id' | 'en';
  candleColorStyle?: CandleColorStyle;
  showLiveDrawingTools?: boolean;
  isLiveCleanView?: boolean;
  isActive?: boolean;
}

export const TradingViewOandaWidget: React.FC<TradingViewOandaWidgetProps> = React.memo(
  ({
    symbol,
    interval,
    theme = 'dark',
    locale = 'id',
    candleColorStyle = 'monochrome',
    showLiveDrawingTools = false,
    isLiveCleanView = false,
    isActive = true,
  }) => {
    const tvWidgetContainerRef = useRef<HTMLDivElement | null>(null);
    const mountedConfigKeyRef = useRef<string | null>(null);
    const lastSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
    const resizeRafRef = useRef<number | null>(null);
    const initRafRef = useRef<number | null>(null);

    const tvInterval = useMemo(() => {
      if (interval === '1' || interval === '3' || interval === '5' || interval === '15') return interval;
      if (interval === '60') return '60';
      if (interval === '240') return '240';
      if (interval === 'D' || interval === '1d') return 'D';
      return '15';
    }, [interval]);

    // Section A.5 & B: Single Persistent iframe lifecycle + Default Volume Removed (hide_volume: true)
    // Wait until MarketChartView is active and container has non-zero dimensions so iframe never initializes at 0x0
    useEffect(() => {
      const container = tvWidgetContainerRef.current;
      if (!isActive) {
        // Pause & free WebView GPU/RAM when user switches to Light Chart or leaves Market Chart
        if (container && container.innerHTML !== '') {
          container.innerHTML = '';
        }
        mountedConfigKeyRef.current = null;
        return;
      }
      if (!container) return;

      const nextConfigKey = `${symbol}|${tvInterval}|${theme}|${locale}|${candleColorStyle}|${
        showLiveDrawingTools ? '1' : '0'
      }|${isLiveCleanView ? '1' : '0'}|tvtouch_v3`;

      if (
        mountedConfigKeyRef.current === nextConfigKey &&
        container.querySelector('iframe') !== null
      ) {
        return;
      }

      const mountTradingViewWidget = () => {
        const host = tvWidgetContainerRef.current;
        if (!host) return;

        // If already mounted with this exact config, do not recreate
        if (
          mountedConfigKeyRef.current === nextConfigKey &&
          host.querySelector('iframe') !== null
        ) {
          return;
        }

        mountedConfigKeyRef.current = nextConfigKey;
        host.innerHTML = '';

        const widgetContainer = document.createElement('div');
        widgetContainer.className = 'tradingview-widget-container__widget';
        widgetContainer.style.position = 'absolute';
        widgetContainer.style.inset = '0';
        widgetContainer.style.width = '100%';
        widgetContainer.style.height = '100%';
        widgetContainer.style.minHeight = '0';
        widgetContainer.style.minWidth = '0';
        widgetContainer.style.touchAction = 'none';
        widgetContainer.style.pointerEvents = 'none';
        host.appendChild(widgetContainer);

        const isMono = candleColorStyle !== 'classic';
        const isLightTheme = theme === 'light';
        const chartBg = isLightTheme ? '#FFFFFF' : '#000000';
        const scaleTextColor = isLightTheme ? '#475569' : '#B2B5BE';
        const scaleLineColor = isLightTheme ? '#E4E4E7' : 'rgba(0, 0, 0, 0)';
        const monoUpColor = '#FFFFFF';
        const monoDownColor = isLightTheme ? '#0F172A' : '#000000';
        const monoBorderColor = isLightTheme ? '#0F172A' : '#FFFFFF';

        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.type = 'text/javascript';
        script.async = true;
        script.innerHTML = JSON.stringify({
          autosize: true,
          symbol: symbol,
          interval: tvInterval,
          timezone: 'Asia/Bangkok',
          theme: isLightTheme ? 'light' : 'dark',
          style: '1',
          locale: locale,
          allow_symbol_change: false,
          calendar: false,
          hide_top_toolbar: Boolean(isLiveCleanView),
          hide_legend: false,
          hide_side_toolbar: !showLiveDrawingTools,
          hide_volume: true,
          horztouchdrag: true,
          verttouchdrag: true,
          studies: [],
          save_image: true,
          backgroundColor: chartBg,
          gridColor: 'rgba(0, 0, 0, 0)',
          overrides: {
            'paneProperties.background': chartBg,
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': 'rgba(0, 0, 0, 0)',
            'paneProperties.horzGridProperties.color': 'rgba(0, 0, 0, 0)',
            'paneProperties.topMargin': 10,
            'paneProperties.bottomMargin': 8,
            'symbolWatermarkProperties.visibility': false,
            'symbolWatermarkProperties.color': 'rgba(0, 0, 0, 0)',
            'scalesProperties.textColor': scaleTextColor,
            'scalesProperties.fontSize': 10,
            'scalesProperties.lineColor': scaleLineColor,
            'volumePaneSize': 'tiny',
            'create_volume_indicator_by_default': false,
            'mainSeriesProperties.candleStyle.upColor': isMono ? monoUpColor : '#089981',
            'mainSeriesProperties.candleStyle.downColor': isMono ? monoDownColor : '#F23645',
            'mainSeriesProperties.candleStyle.drawBorder': true,
            'mainSeriesProperties.candleStyle.borderColor': monoBorderColor,
            'mainSeriesProperties.candleStyle.borderUpColor': isMono ? monoBorderColor : '#089981',
            'mainSeriesProperties.candleStyle.borderDownColor': isMono ? monoBorderColor : '#F23645',
            'mainSeriesProperties.candleStyle.wickUpColor': isMono ? monoBorderColor : '#089981',
            'mainSeriesProperties.candleStyle.wickDownColor': isMono ? monoBorderColor : '#F23645',
          },
          support_host: 'https://www.tradingview.com',
        });

        host.appendChild(script);
      };

      if (container.clientWidth > 0 && container.clientHeight > 0) {
        mountTradingViewWidget();
      } else {
        if (initRafRef.current !== null) {
          window.cancelAnimationFrame(initRafRef.current);
        }
        initRafRef.current = window.requestAnimationFrame(() => {
          initRafRef.current = null;
          mountTradingViewWidget();
        });
      }

      return () => {
        if (initRafRef.current !== null) {
          window.cancelAnimationFrame(initRafRef.current);
          initRafRef.current = null;
        }
      };
    }, [isActive, symbol, tvInterval, theme, locale, candleColorStyle, showLiveDrawingTools, isLiveCleanView]);

    // Clean up container only when component truly unmounts from the tree
    useEffect(() => {
      const container = tvWidgetContainerRef.current;
      return () => {
        if (initRafRef.current !== null) {
          window.cancelAnimationFrame(initRafRef.current);
          initRafRef.current = null;
        }
        if (resizeRafRef.current !== null) {
          window.cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
        mountedConfigKeyRef.current = null;
        if (container) {
          container.innerHTML = '';
        }
      };
    }, []);

    // Section A.5: rAF-throttled ResizeObserver + MutationObserver to immediately enforce 100% bounds & touch-action on injected iframe
    useEffect(() => {
      const container = tvWidgetContainerRef.current;
      if (!container || typeof ResizeObserver === 'undefined') return;

      const enforceIframeTouchStyles = (): boolean => {
        const widgetHost = container.querySelector<HTMLElement>(
          '.tradingview-widget-container__widget'
        );
        if (widgetHost) {
          widgetHost.style.position = 'absolute';
          widgetHost.style.inset = '0';
          widgetHost.style.width = '100%';
          widgetHost.style.height = '100%';
          widgetHost.style.pointerEvents = 'none';
          widgetHost.style.touchAction = 'none';
        }

        const iframeEl = container.querySelector<HTMLIFrameElement>('iframe');
        if (iframeEl) {
          iframeEl.style.position = 'absolute';
          iframeEl.style.inset = '0';
          iframeEl.style.display = 'block';
          iframeEl.style.width = '100%';
          iframeEl.style.height = '100%';
          iframeEl.style.border = '0';
          iframeEl.style.zIndex = '20';
          iframeEl.style.pointerEvents = 'auto';
          iframeEl.style.touchAction = 'none';
          return true;
        }
        return false;
      };

      const syncDimensions = () => {
        const nextWidth = Math.round(container.clientWidth);
        const nextHeight = Math.round(container.clientHeight);
        if (nextWidth <= 0 || nextHeight <= 0) return;

        enforceIframeTouchStyles();

        if (
          nextWidth === lastSizeRef.current.width &&
          nextHeight === lastSizeRef.current.height
        ) {
          return;
        }

        lastSizeRef.current = { width: nextWidth, height: nextHeight };
        container.dataset.widgetWidth = String(nextWidth);
        container.dataset.widgetHeight = String(nextHeight);
      };

      syncDimensions();

      const observer = new ResizeObserver(() => {
        if (resizeRafRef.current !== null) {
          window.cancelAnimationFrame(resizeRafRef.current);
        }
        resizeRafRef.current = window.requestAnimationFrame(() => {
          resizeRafRef.current = null;
          syncDimensions();
        });
      });

      observer.observe(container);

      const mutationObserver =
        typeof MutationObserver !== 'undefined'
          ? new MutationObserver(() => {
              enforceIframeTouchStyles();
            })
          : null;

      mutationObserver?.observe(container, { childList: true, subtree: false });

      return () => {
        observer.disconnect();
        mutationObserver?.disconnect();
        if (resizeRafRef.current !== null) {
          window.cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
      };
    }, []);

    return (
      <div
        ref={tvWidgetContainerRef}
        data-testid="tradingview-oanda-widget-container"
        className="tradingview-widget-container absolute inset-0 w-full h-full min-h-0 min-w-0 z-10 bg-white dark:bg-[#000000] overflow-hidden overscroll-none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          touchAction: 'none',
          pointerEvents: 'auto',
        }}
      />
    );
  }
);
TradingViewOandaWidget.displayName = 'TradingViewOandaWidget';

export const MarketChartView: React.FC<MarketChartViewProps> = ({
  isActive = true,
  currentUser,
  trades,
  settings,
  currentEquity,
  onOpenAuth,
  onOpenAccount,
  onCreateTradeFromPosition,
}) => {
  const { isEn, tr } = useLanguage();
  const { isDark } = useTheme();
  const isDarkRef = useRef<boolean>(isDark);
  isDarkRef.current = isDark;
  const activeUserId: string | null = currentUser?.id || null;

  const translateToolName = useCallback(
    (name: string) => {
      switch (name) {
        case 'Garis Tren':
          return tr('Garis Tren', 'Trend Line');
        case 'Sinar Tren (Ray)':
          return tr('Sinar Tren (Ray)', 'Trend Ray');
        case 'Garis Horizontal':
          return tr('Garis Horizontal', 'Horizontal Line');
        case 'Garis Vertikal':
          return tr('Garis Vertikal', 'Vertical Line');
        case 'Fib Ekstensi Berbasis Tren':
          return tr('Fib Ekstensi Berbasis Tren', 'Trend-Based Fib Extension');
        case 'Fib Retracement':
          return tr('Fib Retracement', 'Fib Retracement');
        case 'Posisi Penjualan':
          return tr('Posisi Penjualan', 'Short Position');
        case 'Posisi Pembelian':
          return tr('Posisi Pembelian', 'Long Position');
        case 'Persegi':
          return tr('Persegi', 'Rectangle');
        case 'Catatan Harga':
          return tr('Catatan Harga', 'Price Note');
        default:
          return name;
      }
    },
    [tr]
  );

  const translateSectionName = useCallback(
    (section: string) => {
      switch (section) {
        case 'PERALATAN TREN':
          return tr('PERALATAN TREN', 'TREND TOOLS');
        case 'GANN DAN FIBONACCI':
          return tr('GANN DAN FIBONACCI', 'GANN & FIBONACCI');
        case 'PROYEKSI DAN PENGUKURAN':
          return tr('PROYEKSI DAN PENGUKURAN', 'PROJECTION & MEASUREMENT');
        case 'BENTUK-BENTUK GEOMETRIS':
          return tr('BENTUK-BENTUK GEOMETRIS', 'GEOMETRIC SHAPES');
        case 'ANOTASI':
          return tr('ANOTASI', 'ANNOTATIONS');
        default:
          return section;
      }
    },
    [tr]
  );

  const translateTabName = useCallback(
    (tab: string) => {
      switch (tab) {
        case 'Favorit':
          return tr('Favorit', 'Favorites');
        case 'Peralatan':
          return tr('Peralatan', 'All Tools');
        case 'Peralatan Tren':
          return tr('Peralatan Tren', 'Trend Tools');
        case 'Gann dan Fibonacci':
          return tr('Gann dan Fibonacci', 'Gann & Fibonacci');
        case 'Bentuk-Bentuk Geometris':
          return tr('Bentuk-Bentuk Geometris', 'Geometric Shapes');
        case 'Anotasi':
          return tr('Anotasi', 'Annotations');
        default:
          return tab;
      }
    },
    [tr]
  );

  const [prefs, setPrefs] = useState<MarketChartPreferences>(() =>
    loadStoredChartPreferences(activeUserId)
  );

  // Dual Mode: 'live_oanda' (TradingView Widget Embed) vs 'replay_studio' (Lightweight Charts + Twelve Data)
  const [chartEngineMode, setChartEngineMode] = useState<ChartEngineMode>(() =>
    loadStoredChartEngineMode()
  );
  const [candleSource, setCandleSource] = useState<
    'twelvedata' | 'binance' | 'cached' | 'synthetic'
  >('twelvedata');
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => getStoredTwelveDataApiKey());
  const [apiKeySavedToast, setApiKeySavedToast] = useState<boolean>(false);

  // Magnet Mode state (snap drawing coordinates to OHLC High/Low/Open/Close)
  const [isMagnetActive, setIsMagnetActive] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('tradevault_chart_magnet');
    return stored === null ? true : stored === 'true';
  });

  const toggleMagnetMode = useCallback(() => {
    setIsMagnetActive((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tradevault_chart_magnet', String(next));
      } catch {
        // Ignore storage quota error
      }
      return next;
    });
  }, []);

  // 2 3D Wheel Picker indices (Pair & Timeframe) with 300ms debounce
  const [wheelPairIndex, setWheelPairIndex] = useState<number>(() =>
    resolvePairWheelIndex(prefs.symbol)
  );
  const [wheelTfIndex, setWheelTfIndex] = useState<number>(() =>
    resolveTfWheelIndex(prefs.interval)
  );

  // Active Pair & Timeframe metadata
  const activePairMeta = WHEEL_PAIRS[wheelPairIndex] || WHEEL_PAIRS[0];
  const activeTfMeta = WHEEL_TIMEFRAMES[wheelTfIndex] || WHEEL_TIMEFRAMES[3];

  // Live streaming & OHLC header state
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(() =>
    isMarketOpenForPair(activePairMeta.label).isOpen
  );
  const [marketStatusText, setMarketStatusText] = useState<string>(() =>
    isMarketOpenForPair(activePairMeta.label).statusText
  );
  const [latestCandle, setLatestCandle] = useState<OhlcCandle | null>(null);
  const [hoveredCandle, setHoveredCandle] = useState<OhlcCandle | null>(null);

  // TRUE BAR REPLAY STATE (2-stage flow: 'selecting_cut' -> 'active')
  const [replayPhase, setReplayPhase] = useState<'off' | 'selecting_cut' | 'active'>('off');
  const [replayCutIndex, setReplayCutIndex] = useState<number>(0);
  const [totalCandlesCount, setTotalCandlesCount] = useState<number>(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 5>(1);
  const [replayGuideX, setReplayGuideX] = useState<number | null>(null);
  const [isDraggingCutter, setIsDraggingCutter] = useState<boolean>(false);

  const isSelectingCutPoint = replayPhase === 'selecting_cut';
  const isReplayActive = replayPhase === 'active';

  // BAGIAN 1 & 2: Explicit separation between Live Mode (TradingView Advance) & Replay Mode (Lightweight Charts)
  const isLiveMode = chartEngineMode === 'live_oanda' && replayPhase === 'off';
  const isReplayMode = !isLiveMode;
  const [showLiveDrawingTools, setShowLiveDrawingTools] = useState<boolean>(false);
  const [isLiveCleanView, setIsLiveCleanView] = useState<boolean>(false);
  const [hideTopSubBar, setHideTopSubBar] = useState<boolean>(false);

  // DRAWING TOOLS STATE (Anchored to logical bar index & price coordinates)
  const [showDrawingToolbar, setShowDrawingToolbar] = useState<boolean>(false);
  const [drawingSheetTab, setDrawingSheetTab] = useState<DrawingSheetTabId>('Favorit');
  const [favoriteTools, setFavoriteTools] = useState<ActiveDrawingToolId[]>(() =>
    loadStoredFavoriteTools()
  );
  const [showFavoritesOnChart, setShowFavoritesOnChart] = useState<boolean>(() =>
    loadStoredShowFavoritesToolbar()
  );
  const [isFavToolbarCollapsed, setIsFavToolbarCollapsed] = useState<boolean>(false);
  const [favToolbarPos, setFavToolbarPos] = useState<{ x: number; y: number }>({ x: 10, y: 10 });
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingToolType>('cursor');
  const [placementState, setPlacementState] = useState<DrawingPlacementState>('idle');
  const [aimCursorPos, setAimCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [crosshairAnchor, setCrosshairAnchor] = useState<DrawingAnchor | null>(null);
  const crosshairAnchorRef = useRef<DrawingAnchor | null>(null);
  const [stayInDrawingMode, setStayInDrawingMode] = useState<boolean>(false);
  const [hideAllDrawings, setHideAllDrawings] = useState<boolean>(false);
  const [isLayerModalOpen, setIsLayerModalOpen] = useState<boolean>(false);
  const [drawings, setDrawings] = useState<ChartDrawingObject[]>(() => loadStoredDrawings());
  const [transientRulerDrawing, setTransientRulerDrawing] = useState<ChartDrawingObject | null>(
    null
  );
  const [isScrolledBack, setIsScrolledBack] = useState<boolean>(false);
  const isScrolledBackRef = useRef<boolean>(false);
  const [drawingUndoStack, setDrawingUndoStack] = useState<ChartDrawingObject[][]>([]);
  const [drawingRedoStack, setDrawingRedoStack] = useState<ChartDrawingObject[][]>([]);
  const [draftDrawing, setDraftDrawing] = useState<ChartDrawingObject | null>(null);
  const [draftStep, setDraftStep] = useState<number>(0);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const selectedDrawingIdRef = useRef<string | null>(null);
  selectedDrawingIdRef.current = selectedDrawingId;

  const activeDrawingToolRef = useRef<DrawingToolType>(activeDrawingTool);
  activeDrawingToolRef.current = activeDrawingTool;

  const [styleBarPos, setStyleBarPos] = useState<{ x: number; y: number } | null>(null);
  const styleBarDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const chartTapStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    target: EventTarget | null;
  } | null>(null);

  const [isDrawingSettingsOpen, setIsDrawingSettingsOpen] = useState<boolean>(false);
  const isDrawingSettingsOpenRef = useRef<boolean>(false);
  isDrawingSettingsOpenRef.current = isDrawingSettingsOpen;
  const [draggingHandle, setDraggingHandle] = useState<{
    drawingId: string;
    handle: 'p1' | 'p2' | 'p3' | 'tp' | 'sl' | 'rect_tr' | 'rect_bl' | 'body';
    startAnchor: DrawingAnchor;
    initialDrawing: ChartDrawingObject;
  } | null>(null);
  const [svgRenderTick, setSvgRenderTick] = useState<number>(0);
  const svgTickRafRef = useRef<number | null>(null);

  const aimDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origAimX: number;
    origAimY: number;
    moved: boolean;
  } | null>(null);

  // High-performance rAF-throttled SVG overlay synchronizer (prevents frame drops on Android)
  const lastProjectionSigRef = useRef<string>('');
  const ohlcEvaluationCacheRef = useRef<
    Map<string, { sig: string; status: PositionOhlcEvaluation }>
  >(new Map());

  const syncProjectionIfChanged = useCallback((force = false): boolean => {
    const chart = chartApiRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) {
      if (force) setSvgRenderTick((t) => (t + 1) % 1000000);
      return false;
    }
    const x0 = chart.timeScale().logicalToCoordinate(0 as Logical);
    const x100 = chart.timeScale().logicalToCoordinate(100 as Logical);
    const candles = fullCandlesRef.current;
    const refPrice = candles.length > 0 ? candles[candles.length - 1].close : 2000;
    const y0 = series.priceToCoordinate(refPrice);
    const y1 = series.priceToCoordinate(refPrice * 1.01);
    const sig = `${x0 !== null ? Number(x0).toFixed(2) : 'n'}_${x100 !== null ? Number(x100).toFixed(2) : 'n'}_${y0 !== null ? Number(y0).toFixed(2) : 'n'}_${y1 !== null ? Number(y1).toFixed(2) : 'n'}`;
    if (force || sig !== lastProjectionSigRef.current) {
      lastProjectionSigRef.current = sig;
      setSvgRenderTick((t) => (t + 1) % 1000000);
      return true;
    }
    return false;
  }, []);

  const triggerSvgOverlaySync = useCallback(() => {
    if (svgTickRafRef.current !== null) return;
    svgTickRafRef.current = window.requestAnimationFrame(() => {
      svgTickRafRef.current = null;
      syncProjectionIfChanged(true);
    });
  }, [syncProjectionIfChanged]);

  // Frame-rate continuous sync loop while user interacts with chart (drag, pinch, price scale drag, kinetic inertia)
  const isInteractingWithChartRef = useRef<boolean>(false);
  const activeInteractionRafRef = useRef<number | null>(null);

  const startContinuousSync = useCallback(() => {
    isInteractingWithChartRef.current = true;
    if (activeInteractionRafRef.current !== null) return;
    let framesRemaining = 60; // Keep monitoring until kinetic scroll / price-scale glide stops completely

    const tick = () => {
      const moved = syncProjectionIfChanged(false);
      if (isInteractingWithChartRef.current || moved) {
        framesRemaining = 45;
        activeInteractionRafRef.current = window.requestAnimationFrame(tick);
      } else if (framesRemaining > 0) {
        framesRemaining--;
        activeInteractionRafRef.current = window.requestAnimationFrame(tick);
      } else {
        activeInteractionRafRef.current = null;
      }
    };
    activeInteractionRafRef.current = window.requestAnimationFrame(tick);
  }, [syncProjectionIfChanged]);

  const stopContinuousSync = useCallback(() => {
    isInteractingWithChartRef.current = false;
  }, []);

  // TradingView Style/Settings Floating Bar Drag Handlers
  const handleStyleBarDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const barEl = e.currentTarget.closest(
        '[data-testid="drawing-object-style-bar"]'
      ) as HTMLElement | null;
      const container = chartContainerRef.current;
      const barRect = barEl?.getBoundingClientRect();
      const containerRect = container?.getBoundingClientRect();

      const curX = styleBarPos
        ? styleBarPos.x
        : barRect && containerRect
          ? Math.round(barRect.left - containerRect.left)
          : Math.round(((container?.clientWidth || 360) - 240) / 2);
      const curY = styleBarPos
        ? styleBarPos.y
        : barRect && containerRect
          ? Math.round(barRect.top - containerRect.top)
          : 44;

      styleBarDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: curX,
        origY: curY,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture error
      }
    },
    [styleBarPos]
  );

  const handleStyleBarDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = styleBarDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const container = chartContainerRef.current;
    const containerW = container?.clientWidth || 360;
    const containerH = container?.clientHeight || 480;
    const maxW = Math.max(10, containerW - 100);
    const maxH = Math.max(10, containerH - 44);
    const nextX = Math.max(4, Math.min(maxW, drag.origX + (e.clientX - drag.startClientX)));
    const nextY = Math.max(4, Math.min(maxH, drag.origY + (e.clientY - drag.startClientY)));
    setStyleBarPos({ x: Math.round(nextX), y: Math.round(nextY) });
  }, []);

  const handleStyleBarDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (styleBarDragRef.current?.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release error
      }
      styleBarDragRef.current = null;
    }
  }, []);

  // TradingView-Style Tap Empty Space to Deselect / Close Active Drawing Tools
  const handleEmptyChartTapOrClick = useCallback((targetEl: HTMLElement | null) => {
    // If setting is open, do not deselect on 1x tap on chart canvas (user is actively configuring tools)
    if (isDrawingSettingsOpenRef.current) {
      return;
    }
    if (selectedDrawingIdRef.current === null || activeDrawingToolRef.current !== 'cursor') {
      return;
    }
    if (
      !targetEl?.closest('[data-testid="drawing-object-style-bar"]') &&
      !targetEl?.closest('[data-testid^="drawing-handle-"]') &&
      !targetEl?.closest('[data-testid="chart-floating-favorites-toolbar"]') &&
      !targetEl?.closest('[data-testid^="rendered-drawing-"]')
    ) {
      setSelectedDrawingId(null);
      setIsDrawingSettingsOpen(false);
      setTransientRulerDrawing(null);
    }
  }, []);

  // BAGIAN 1.2: Tampilkan sekitar 75 candle terakhir dengan barSpacing: 7 & rightOffset: 40 (tanpa fitContent gepeng)
  const applyDefaultVisibleRange = useCallback((chart: IChartApi | null, totalCandles: number) => {
    if (!chart || totalCandles <= 0) return;
    chart.timeScale().applyOptions({
      barSpacing: 7,
      minBarSpacing: 2,
      rightOffset: 40,
    });
    chart.priceScale('right').applyOptions({
      autoScale: true,
    });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, totalCandles - 75),
      to: totalCandles + 15,
    });
    if (isScrolledBackRef.current) {
      isScrolledBackRef.current = false;
      setIsScrolledBack(false);
    }
  }, []);

  const handleScrollToRealtime = useCallback(() => {
    const targetLen =
      replayPhaseRef.current === 'active'
        ? replayCutIndexRef.current + 1
        : fullCandlesRef.current.length;
    applyDefaultVisibleRange(chartApiRef.current, targetLen);
    triggerSvgOverlaySync();
  }, [applyDefaultVisibleRange, triggerSvgOverlaySync]);

  const handleSetChartEngineMode = useCallback(
    (mode: ChartEngineMode) => {
      setChartEngineMode(mode);
      saveStoredChartEngineMode(mode);
      if (mode === 'replay_studio') {
        window.requestAnimationFrame(() => {
          const container = chartContainerRef.current;
          if (container && chartApiRef.current) {
            chartApiRef.current.applyOptions({
              width: container.clientWidth || 360,
              height: container.clientHeight || 500,
            });
            applyDefaultVisibleRange(chartApiRef.current, fullCandlesRef.current.length);
            triggerSvgOverlaySync();
          }
        });
      }
    },
    [applyDefaultVisibleRange, triggerSvgOverlaySync]
  );

  // High-performance rAF-throttled latest candle updater (prevents re-render thrashing from WS ticks on Android)
  const pendingLatestCandleRef = useRef<OhlcCandle | null>(null);
  const latestCandleRafRef = useRef<number | null>(null);

  const scheduleLatestCandleUpdate = useCallback((candle: OhlcCandle) => {
    pendingLatestCandleRef.current = candle;
    if (latestCandleRafRef.current === null) {
      latestCandleRafRef.current = window.requestAnimationFrame(() => {
        latestCandleRafRef.current = null;
        if (pendingLatestCandleRef.current) {
          setLatestCandle(pendingLatestCandleRef.current);
        }
      });
    }
  }, []);

  const cutterRafRef = useRef<number | null>(null);
  const pendingCutterXRef = useRef<number | null>(null);
  const draftRafRef = useRef<number | null>(null);
  const pendingDraftPosRef = useRef<{ localX: number; localY: number } | null>(null);

  const favDragStartRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Modals & Popovers
  const [displayMode, setDisplayMode] = useState<ChartDisplayMode>(() => loadStoredDisplayMode());
  const [isIndicatorsOpen, setIsIndicatorsOpen] = useState<boolean>(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>(
    'idle'
  );

  const [viewport, setViewport] = useState<ViewportSize>(() => readActualViewportSize());
  const [bounds, setBounds] = useState<WorkspaceBounds>({
    top: 56,
    bottom: 58,
    left: 0,
  });

  // Core Refs
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const timeScaleAnchorSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Full 500+ candles store for True Bar Replay & Live Streaming
  const fullCandlesRef = useRef<OhlcCandle[]>([]);
  const replayDataRef = useRef<Array<OhlcCandle | { time: UTCTimestamp }>>([]);
  const replayPhaseRef = useRef<'off' | 'selecting_cut' | 'active'>('off');
  const replayCutIndexRef = useRef<number>(0);
  const isDraggingCutterRef = useRef<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const syntheticTickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wheelDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touch drag tracking refs for the 2 vertical wheel pickers
  const pairTouchStartYRef = useRef<number | null>(null);
  const pairTouchMovedRef = useRef<boolean>(false);
  const tfTouchStartYRef = useRef<number | null>(null);
  const tfTouchMovedRef = useRef<boolean>(false);

  useEffect(() => {
    replayPhaseRef.current = replayPhase;
  }, [replayPhase]);

  useEffect(() => {
    replayCutIndexRef.current = replayCutIndex;
  }, [replayCutIndex]);

  // Sync wheel indices when prefs change
  useEffect(() => {
    setWheelPairIndex(resolvePairWheelIndex(prefs.symbol));
  }, [prefs.symbol]);

  useEffect(() => {
    setWheelTfIndex(resolveTfWheelIndex(prefs.interval));
  }, [prefs.interval]);

  // Load account-synced chart preferences when user logs in
  useEffect(() => {
    const localForUser = loadStoredChartPreferences(activeUserId);
    const cloudRaw = currentUser?.user_metadata?.tradevault_chart_prefs;

    if (cloudRaw && typeof cloudRaw === 'object') {
      const cloudPrefs = sanitizeChartPreferences(cloudRaw);
      const merged =
        !localForUser.updatedAt ||
        (cloudPrefs.updatedAt && cloudPrefs.updatedAt >= localForUser.updatedAt)
          ? cloudPrefs
          : localForUser;

      setPrefs(merged);
      saveStoredChartPreferences(merged, activeUserId);
      setCloudSyncStatus('synced');
    } else {
      setPrefs(localForUser);
      setCloudSyncStatus(activeUserId ? 'synced' : 'idle');
    }
  }, [activeUserId, currentUser?.user_metadata?.tradevault_chart_prefs]);

  const syncPrefsToCloudAccount = useCallback(
    async (nextPrefs: MarketChartPreferences) => {
      if (!activeUserId) return;
      const client = getSupabase();
      if (!client) return;

      setCloudSyncStatus('syncing');
      try {
        const { error } = await client.auth.updateUser({
          data: {
            tradevault_chart_prefs: nextPrefs,
          },
        });
        setCloudSyncStatus(error ? 'error' : 'synced');
      } catch {
        setCloudSyncStatus('error');
      }
    },
    [activeUserId]
  );

  const updatePrefs = useCallback(
    (updater: (prev: MarketChartPreferences) => MarketChartPreferences) => {
      setPrefs((prev) => {
        const next: MarketChartPreferences = {
          ...updater(prev),
          backgroundColor: '#000000',
          hideTopToolbar: true,
          updatedAt: new Date().toISOString(),
        };
        saveStoredChartPreferences(next, activeUserId);
        if (activeUserId) {
          if (cloudSyncTimeoutRef.current) clearTimeout(cloudSyncTimeoutRef.current);
          cloudSyncTimeoutRef.current = setTimeout(() => {
            void syncPrefsToCloudAccount(next);
          }, 600);
        }
        return next;
      });
    },
    [activeUserId, syncPrefsToCloudAccount]
  );

  // 300ms Debounce when scrolling the 3D Wheel Pickers
  const scheduleWheelCommit = useCallback(
    (nextPairIdx: number, nextTfIdx: number) => {
      if (wheelDebounceRef.current) {
        clearTimeout(wheelDebounceRef.current);
      }
      wheelDebounceRef.current = setTimeout(() => {
        const selectedPair = WHEEL_PAIRS[nextPairIdx] || WHEEL_PAIRS[0];
        const selectedTf = WHEEL_TIMEFRAMES[nextTfIdx] || WHEEL_TIMEFRAMES[3];
        updatePrefs((prev) => {
          if (prev.symbol === selectedPair.symbol && prev.interval === selectedTf.value) {
            return prev;
          }
          return {
            ...prev,
            symbol: selectedPair.symbol,
            interval: selectedTf.value,
          };
        });
      }, 300);
    },
    [updatePrefs]
  );

  const stepPairWheel = useCallback(
    (delta: number) => {
      setWheelPairIndex((prevIdx) => {
        const len = WHEEL_PAIRS.length;
        const nextIdx = (prevIdx + delta + len) % len;
        scheduleWheelCommit(nextIdx, wheelTfIndex);
        return nextIdx;
      });
    },
    [scheduleWheelCommit, wheelTfIndex]
  );

  const stepTfWheel = useCallback(
    (delta: number) => {
      setWheelTfIndex((prevIdx) => {
        const len = WHEEL_TIMEFRAMES.length;
        const nextIdx = (prevIdx + delta + len) % len;
        scheduleWheelCommit(wheelPairIndex, nextIdx);
        return nextIdx;
      });
    },
    [scheduleWheelCommit, wheelPairIndex]
  );

  const handlePairTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      pairTouchStartYRef.current = e.touches[0].clientY;
      pairTouchMovedRef.current = false;
    }
  };

  const handlePairTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pairTouchStartYRef.current === null || e.touches.length === 0) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - pairTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      pairTouchMovedRef.current = true;
      pairTouchStartYRef.current = currentY;
      stepPairWheel(deltaY < 0 ? 1 : -1);
    }
  };

  const handlePairPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pairTouchStartYRef.current = e.clientY;
    pairTouchMovedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture fallback
    }
  };

  const handlePairPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pairTouchStartYRef.current === null) return;
    const currentY = e.clientY;
    const deltaY = currentY - pairTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      pairTouchMovedRef.current = true;
      pairTouchStartYRef.current = currentY;
      stepPairWheel(deltaY < 0 ? 1 : -1);
    }
  };

  const handlePairPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pairTouchStartYRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release fallback
    }
  };

  const handleTfTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      tfTouchStartYRef.current = e.touches[0].clientY;
      tfTouchMovedRef.current = false;
    }
  };

  const handleTfTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (tfTouchStartYRef.current === null || e.touches.length === 0) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - tfTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      tfTouchMovedRef.current = true;
      tfTouchStartYRef.current = currentY;
      stepTfWheel(deltaY < 0 ? 1 : -1);
    }
  };

  const handleTfPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    tfTouchStartYRef.current = e.clientY;
    tfTouchMovedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture fallback
    }
  };

  const handleTfPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tfTouchStartYRef.current === null) return;
    const currentY = e.clientY;
    const deltaY = currentY - tfTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      tfTouchMovedRef.current = true;
      tfTouchStartYRef.current = currentY;
      stepTfWheel(deltaY < 0 ? 1 : -1);
    }
  };

  const handleTfPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    tfTouchStartYRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release fallback
    }
  };

  // Prevent host page scrolling, rubber-banding, and browser page pinch-zoom while Market Chart is active
  useEffect(() => {
    if (!isActive || typeof document === 'undefined') return;

    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    const prevHtmlOverflow = htmlEl.style.overflow;
    const prevHtmlOverscroll = htmlEl.style.overscrollBehavior;
    const prevHtmlTouchAction = htmlEl.style.touchAction;
    const prevBodyOverflow = bodyEl.style.overflow;
    const prevBodyOverscroll = bodyEl.style.overscrollBehavior;
    const prevBodyTouchAction = bodyEl.style.touchAction;

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    htmlEl.style.overflow = 'hidden';
    htmlEl.style.overscrollBehavior = 'none';
    htmlEl.style.touchAction = 'none';
    bodyEl.style.overflow = 'hidden';
    bodyEl.style.overscrollBehavior = 'none';
    bodyEl.style.touchAction = 'none';

    const preventHostPagePinchZoom = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 1 && e.cancelable) {
        e.preventDefault();
      }
    };

    const preventHostGestureZoom = (e: Event) => {
      if (e.cancelable) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', preventHostPagePinchZoom, { passive: false });
    document.addEventListener('gesturestart', preventHostGestureZoom, { passive: false });
    document.addEventListener('gesturechange', preventHostGestureZoom, { passive: false });
    document.addEventListener('gestureend', preventHostGestureZoom, { passive: false });

    return () => {
      document.removeEventListener('touchmove', preventHostPagePinchZoom);
      document.removeEventListener('gesturestart', preventHostGestureZoom);
      document.removeEventListener('gesturechange', preventHostGestureZoom);
      document.removeEventListener('gestureend', preventHostGestureZoom);
      htmlEl.style.overflow = prevHtmlOverflow;
      htmlEl.style.overscrollBehavior = prevHtmlOverscroll;
      htmlEl.style.touchAction = prevHtmlTouchAction;
      bodyEl.style.overflow = prevBodyOverflow;
      bodyEl.style.overscrollBehavior = prevBodyOverscroll;
      bodyEl.style.touchAction = prevBodyTouchAction;
    };
  }, [isActive]);

  // Hide TradeVault Navbar, Sidebar, and Bottom Navigation ONLY in 'full' or 'landscape' modes
  // Section A.3: Use native screen orientation lock for 'landscape' without any CSS rotate() transform on the iframe
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (isActive && displayMode === 'landscape') {
      try {
        window.TradeVaultSystemBars?.setScreenOrientation?.('landscape');
        const screenAny = window.screen as any;
        if (screenAny?.orientation?.lock) {
          void screenAny.orientation.lock('landscape').catch(() => {});
        }
      } catch {
        // Ignore on desktop/browsers that do not support orientation lock
      }
    } else if (isActive) {
      try {
        window.TradeVaultSystemBars?.setScreenOrientation?.('portrait');
        const screenAny = window.screen as any;
        if (screenAny?.orientation?.unlock) {
          screenAny.orientation.unlock();
        }
      } catch {
        // Ignore unlock error
      }
    }

    const isImmersiveActive = Boolean(isActive && displayMode !== 'normal');
    if (!isImmersiveActive) return;

    const headerEl = document.querySelector<HTMLElement>('[data-testid="app-header"]');
    const sidebarEl = document.querySelector<HTMLElement>('[data-testid="desktop-sidebar"]');
    const mobileNavEl = document.querySelector<HTMLElement>('nav[aria-label="Navigasi Utama Bawah"]');

    const elements = [headerEl, sidebarEl, mobileNavEl].filter(
      (el): el is HTMLElement => el !== null
    );
    const savedStyles = elements.map((el) => ({
      el,
      visibility: el.style.visibility,
      pointerEvents: el.style.pointerEvents,
    }));

    for (const { el } of savedStyles) {
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
    }

    return () => {
      for (const { el, visibility, pointerEvents } of savedStyles) {
        el.style.visibility = visibility;
        el.style.pointerEvents = pointerEvents;
      }
    };
  }, [isActive, displayMode]);

  // Measure exact bounds between Header atas (TRADEVAULT) and Bottom Navigation Bar
  const measureViewportAndBounds = useCallback((): ViewportSize => {
    const actualViewport = readActualViewportSize();

    setViewport((prev) => {
      if (prev.width === actualViewport.width && prev.height === actualViewport.height) {
        return prev;
      }
      return actualViewport;
    });

    if (typeof document !== 'undefined' && typeof window !== 'undefined' && displayMode === 'normal') {
      const vh = actualViewport.height;
      const headerEl = document.querySelector<HTMLElement>('[data-testid="app-header"]');
      const sidebarEl = document.querySelector<HTMLElement>('[data-testid="desktop-sidebar"]');
      const mobileNavEl = document.querySelector<HTMLElement>(
        'nav[aria-label="Navigasi Utama Bawah"]'
      );

      const top = headerEl ? Math.max(0, Math.floor(headerEl.getBoundingClientRect().bottom)) : 56;

      let left = 0;
      if (sidebarEl) {
        const sidebarRect = sidebarEl.getBoundingClientRect();
        if (sidebarRect.width > 0 && window.getComputedStyle(sidebarEl).display !== 'none') {
          left = Math.max(0, Math.floor(sidebarRect.right));
        }
      }

      let bottom = 0;
      if (mobileNavEl) {
        const navRect = mobileNavEl.getBoundingClientRect();
        if (navRect.height > 0 && window.getComputedStyle(mobileNavEl).display !== 'none') {
          bottom = Math.max(Math.ceil(navRect.height), Math.ceil(vh - navRect.top));
        }
      }

      setBounds((prev) => {
        if (prev.top === top && prev.bottom === bottom && prev.left === left) {
          return prev;
        }
        return { top, bottom, left };
      });
    }

    return actualViewport;
  }, [displayMode]);

  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return;

    measureViewportAndBounds();
    const rafId = window.requestAnimationFrame(() => {
      measureViewportAndBounds();
    });

    const handleViewportChange = () => {
      measureViewportAndBounds();
    };

    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('orientationchange', handleViewportChange, { passive: true });

    let navResizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      navResizeObserver = new ResizeObserver(() => {
        measureViewportAndBounds();
      });
      const headerEl = document.querySelector('[data-testid="app-header"]');
      const sidebarEl = document.querySelector('[data-testid="desktop-sidebar"]');
      const mobileNavEl = document.querySelector('nav[aria-label="Navigasi Utama Bawah"]');
      if (headerEl) navResizeObserver.observe(headerEl);
      if (sidebarEl) navResizeObserver.observe(sidebarEl);
      if (mobileNavEl) navResizeObserver.observe(mobileNavEl);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      if (navResizeObserver) navResizeObserver.disconnect();
    };
  }, [isActive, measureViewportAndBounds]);

  const workspaceLayout = computeChartWorkspaceLayout(displayMode, viewport, bounds);

  // Sync technical indicator series (EMA 20, EMA 50, SMA 200) with Whitespace padding after cutIdx
  const syncIndicatorsWithCandles = useCallback(
    (allCandles: OhlcCandle[], activeStudies: string[], cutIdx?: number) => {
      const visibleCandles =
        cutIdx !== undefined ? allCandles.slice(0, cutIdx + 1) : allCandles;

      if (ema20SeriesRef.current) {
        ema20SeriesRef.current.setData(
          activeStudies.includes('EMA20')
            ? buildReplayIndicatorData(calculateEMA(visibleCandles, 20), allCandles, cutIdx)
            : []
        );
      }
      if (ema50SeriesRef.current) {
        ema50SeriesRef.current.setData(
          activeStudies.includes('EMA50')
            ? buildReplayIndicatorData(calculateEMA(visibleCandles, 50), allCandles, cutIdx)
            : []
        );
      }
      if (sma200SeriesRef.current) {
        sma200SeriesRef.current.setData(
          activeStudies.includes('SMA200')
            ? buildReplayIndicatorData(calculateSMA(visibleCandles, 200), allCandles, cutIdx)
            : []
        );
      }
    },
    []
  );

  /**
   * Rule 3: Lock VisibleLogicalRange & PriceScale before and after `candleSeries.setData(newData)`
   * so the chart camera never shifts, jumps, or auto-rescales by even 1 pixel.
   */
  const updateSeriesWithoutJumping = useCallback(
    (newData: Array<OhlcCandle | { time: UTCTimestamp }>, cutIdx?: number) => {
      const chart = chartApiRef.current;
      const candleSeries = candleSeriesRef.current;
      if (!chart || !candleSeries) return;

      const savedLogicalRange = chart.timeScale().getVisibleLogicalRange();
      chart.priceScale('right').applyOptions({ autoScale: false });

      candleSeries.setData(newData);
      syncIndicatorsWithCandles(fullCandlesRef.current, prefs.studies, cutIdx);

      if (savedLogicalRange !== null) {
        chart.timeScale().setVisibleLogicalRange(savedLogicalRange);
      }
    },
    [prefs.studies, syncIndicatorsWithCandles]
  );

  // Rule 1 & BAGIAN 1-2: Initialize TradingView Lightweight Charts instance ONCE on mount
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const initialDark = isDarkRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 360,
      height: container.clientHeight || 480,
      layout: {
        background: { type: ColorType.Solid, color: initialDark ? '#000000' : '#FFFFFF' },
        textColor: initialDark ? '#B2B5BE' : '#475569',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif',
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false, color: 'rgba(0, 0, 0, 0)' },
        horzLines: { visible: false, color: 'rgba(0, 0, 0, 0)' },
      },
      localization: {
        timeFormatter: (time: number) => formatWibDateTimeLabel(Number(time)),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: initialDark ? 'rgba(178, 181, 190, 0.45)' : 'rgba(71, 85, 105, 0.45)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2962FF',
        },
        horzLine: {
          color: initialDark ? 'rgba(178, 181, 190, 0.45)' : 'rgba(71, 85, 105, 0.45)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2962FF',
        },
      },
      rightPriceScale: {
        borderVisible: !initialDark,
        borderColor: initialDark ? 'rgba(0, 0, 0, 0)' : '#E4E4E7',
        autoScale: true,
        scaleMargins: {
          top: 0.25,
          bottom: 0.25,
        },
      },
      timeScale: {
        borderVisible: !initialDark,
        borderColor: initialDark ? 'rgba(0, 0, 0, 0)' : '#E4E4E7',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 40,
        barSpacing: 7,
        minBarSpacing: 2,
        shiftVisibleRangeOnNewBar: false,
        allowShiftVisibleRangeOnWhitespaceReplacement: false,
        tickMarkFormatter: (time: number) => {
          const wibDate = new Date((Number(time) + 7 * 3600) * 1000);
          const hh = String(wibDate.getUTCHours()).padStart(2, '0');
          const mm = String(wibDate.getUTCMinutes()).padStart(2, '0');
          return `${hh}:${mm}`;
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: {
        touch: true,
        mouse: false,
      },
    });

    // Invisible TimeScale Anchor Series on default 'right' price scale with autoscaleInfoProvider: () => null
    // so DataLayer._getBaseIndex() stays anchored at fullCandlesRef length without creating a null-range PriceScale.
    const timeScaleAnchorSeries = chart.addLineSeries({
      color: 'rgba(0, 0, 0, 0)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => null,
    });

    const isMonochrome = prefs.candleColorStyle !== 'classic';
    const candleSeries = chart.addCandlestickSeries({
      upColor: isMonochrome ? '#FFFFFF' : '#089981',
      downColor: isMonochrome ? '#000000' : '#F23645',
      borderVisible: true,
      borderUpColor: isMonochrome ? '#FFFFFF' : '#089981',
      borderDownColor: isMonochrome ? '#FFFFFF' : '#F23645',
      wickUpColor: isMonochrome ? '#FFFFFF' : '#089981',
      wickDownColor: isMonochrome ? '#FFFFFF' : '#F23645',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    // Seed initial candles immediately so PriceScale('right').priceRange() is never null on early touch drag
    const initialPairMeta =
      WHEEL_PAIRS.find((p) => p.symbol.toUpperCase() === prefs.symbol.toUpperCase()) ||
      WHEEL_PAIRS[0];
    const initialTfMeta =
      WHEEL_TIMEFRAMES.find((t) => t.value === prefs.interval) || WHEEL_TIMEFRAMES[3];
    const initialSeedCandles =
      loadCachedCandles(initialPairMeta.symbol, initialTfMeta.value, initialPairMeta.label) ||
      sanitizeAndFilterCandles(
        generateRealisticCandles(
          initialPairMeta.label,
          initialPairMeta.basePrice,
          initialPairMeta.volatility,
          initialPairMeta.decimals,
          initialTfMeta.seconds,
          120
        ),
        initialPairMeta.label
      );
    if (initialSeedCandles.length > 0) {
      fullCandlesRef.current = initialSeedCandles;
      candleSeries.setData(initialSeedCandles);
      timeScaleAnchorSeries.setData(
        initialSeedCandles.map((c) => ({ time: c.time, value: c.close }))
      );
    }

    const ema20Series = chart.addLineSeries({
      color: '#38BDF8',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const ema50Series = chart.addLineSeries({
      color: '#F59E0B',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const sma200Series = chart.addLineSeries({
      color: '#A855F7',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;
    timeScaleAnchorSeriesRef.current = timeScaleAnchorSeries;
    ema20SeriesRef.current = ema20Series;
    ema50SeriesRef.current = ema50Series;
    sma200SeriesRef.current = sma200Series;

    // Re-sync SVG overlay coordinates immediately whenever visible logical range changes
    const handleRangeChange = (logicalRange: { from: number; to: number } | null) => {
      syncProjectionIfChanged(false);
      triggerSvgOverlaySync();
      const targetTotal =
        replayPhaseRef.current === 'active'
          ? replayCutIndexRef.current + 1
          : fullCandlesRef.current.length;
      const scrolled = Boolean(logicalRange && targetTotal > 15 && logicalRange.to < targetTotal - 6);
      if (scrolled !== isScrolledBackRef.current) {
        isScrolledBackRef.current = scrolled;
        setIsScrolledBack(scrolled);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    // Track crosshair hover for OHLC legend (throttled & skipped during active touch pan/pinch to prevent frame drops on Android)
    let lastHoverUpdate = 0;
    let lastHoveredSig = '';
    chart.subscribeCrosshairMove((param) => {
      if (isInteractingWithChartRef.current) return;
      const now = performance.now();
      if (now - lastHoverUpdate < 48) return; // ~20fps cap for crosshair OHLC text
      lastHoverUpdate = now;

      if (param.time && candleSeriesRef.current) {
        const data = param.seriesData.get(candleSeriesRef.current) as OhlcCandle | undefined;
        if (data && typeof data.open === 'number') {
          const nextSig = `${Number(data.time)}_${data.close}`;
          if (nextSig !== lastHoveredSig) {
            lastHoveredSig = nextSig;
            setHoveredCandle(data);
          }
        } else if (lastHoveredSig !== '') {
          lastHoveredSig = '';
          setHoveredCandle((prev) => (prev !== null ? null : prev));
        }
      } else if (lastHoveredSig !== '') {
        lastHoveredSig = '';
        setHoveredCandle((prev) => (prev !== null ? null : prev));
      }
    });

    // ResizeObserver so chart canvas always fills its flex-1 container accurately
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
            triggerSvgOverlaySync();
          }
        }
      });
      ro.observe(container);
    }

    // TradingView-style click/tap on empty chart canvas to deselect active drawing tools
    const onChartClick = () => {
      if (isDrawingSettingsOpenRef.current) return;
      if (selectedDrawingIdRef.current !== null && activeDrawingToolRef.current === 'cursor') {
        setSelectedDrawingId(null);
        setIsDrawingSettingsOpen(false);
        setTransientRulerDrawing(null);
      }
    };
    chart.subscribeClick(onChartClick);

    // Continuous zero-lag frame sync for all chart pan, drag, pinch, and right-axis price scrolling
    const onContainerPointerDown = (e: Event) => {
      startContinuousSync();
      const pe = e as PointerEvent | TouchEvent;
      const clientX = 'clientX' in pe ? pe.clientX : (pe as TouchEvent).touches?.[0]?.clientX || 0;
      const clientY = 'clientY' in pe ? pe.clientY : (pe as TouchEvent).touches?.[0]?.clientY || 0;
      chartTapStartRef.current = {
        x: clientX,
        y: clientY,
        time: performance.now(),
        target: e.target,
      };
    };
    const onContainerPointerUp = (e: Event) => {
      stopContinuousSync();
      const start = chartTapStartRef.current;
      chartTapStartRef.current = null;
      if (!start) return;

      const pe = e as PointerEvent | TouchEvent;
      const clientX = 'clientX' in pe ? pe.clientX : (pe as TouchEvent).changedTouches?.[0]?.clientX || 0;
      const clientY = 'clientY' in pe ? pe.clientY : (pe as TouchEvent).changedTouches?.[0]?.clientY || 0;
      const dist = Math.hypot(clientX - start.x, clientY - start.y);
      const elapsed = performance.now() - start.time;

      // Quick tap on empty chart space without drag or pan motion
      if (dist < 8 && elapsed < 400) {
        handleEmptyChartTapOrClick((e.target || start.target) as HTMLElement | null);
      }
    };
    const onContainerWheel = () => {
      startContinuousSync();
      // stop after wheel burst
      window.setTimeout(stopContinuousSync, 300);
    };

    container.addEventListener('pointerdown', onContainerPointerDown, { passive: true });
    window.addEventListener('pointerup', onContainerPointerUp, { passive: true });
    window.addEventListener('pointercancel', onContainerPointerUp, { passive: true });
    container.addEventListener('wheel', onContainerWheel, { passive: true });
    container.addEventListener('touchstart', onContainerPointerDown, { passive: true });
    window.addEventListener('touchend', onContainerPointerUp, { passive: true });

    return () => {
      chart.unsubscribeClick(onChartClick);
      container.removeEventListener('pointerdown', onContainerPointerDown);
      window.removeEventListener('pointerup', onContainerPointerUp);
      window.removeEventListener('pointercancel', onContainerPointerUp);
      container.removeEventListener('wheel', onContainerWheel);
      container.removeEventListener('touchstart', onContainerPointerDown);
      window.removeEventListener('touchend', onContainerPointerUp);

      if (ro) ro.disconnect();
      if (svgTickRafRef.current !== null) {
        window.cancelAnimationFrame(svgTickRafRef.current);
        svgTickRafRef.current = null;
      }
      if (activeInteractionRafRef.current !== null) {
        window.cancelAnimationFrame(activeInteractionRafRef.current);
        activeInteractionRafRef.current = null;
      }
      if (latestCandleRafRef.current !== null) {
        window.cancelAnimationFrame(latestCandleRafRef.current);
        latestCandleRafRef.current = null;
      }
      if (cutterRafRef.current !== null) {
        window.cancelAnimationFrame(cutterRafRef.current);
        cutterRafRef.current = null;
      }
      if (draftRafRef.current !== null) {
        window.cancelAnimationFrame(draftRafRef.current);
        draftRafRef.current = null;
      }
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      timeScaleAnchorSeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
      sma200SeriesRef.current = null;
    };
  }, [triggerSvgOverlaySync, startContinuousSync, stopContinuousSync, handleEmptyChartTapOrClick]);

  // Synchronize Lightweight Charts surface, axes & crosshair whenever Light/Dark theme changes
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#000000' : '#FFFFFF' },
        textColor: isDark ? '#B2B5BE' : '#475569',
      },
      crosshair: {
        vertLine: {
          color: isDark ? 'rgba(178, 181, 190, 0.45)' : 'rgba(71, 85, 105, 0.45)',
        },
        horzLine: {
          color: isDark ? 'rgba(178, 181, 190, 0.45)' : 'rgba(71, 85, 105, 0.45)',
        },
      },
      rightPriceScale: {
        borderVisible: !isDark,
        borderColor: isDark ? 'rgba(0, 0, 0, 0)' : '#E4E4E7',
      },
      timeScale: {
        borderVisible: !isDark,
        borderColor: isDark ? 'rgba(0, 0, 0, 0)' : '#E4E4E7',
      },
    });
  }, [isDark]);

  // Update Candlestick colors dynamically when user toggles Monochrome vs Classic Green/Red or Light/Dark theme
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const isMonochrome = prefs.candleColorStyle !== 'classic';
    const monoBorder = isDark ? '#FFFFFF' : '#0F172A';
    const monoDown = isDark ? '#000000' : '#0F172A';
    candleSeries.applyOptions({
      upColor: isMonochrome ? '#FFFFFF' : '#089981',
      downColor: isMonochrome ? monoDown : '#F23645',
      borderVisible: true,
      borderUpColor: isMonochrome ? monoBorder : '#089981',
      borderDownColor: isMonochrome ? monoBorder : '#F23645',
      wickUpColor: isMonochrome ? monoBorder : '#089981',
      wickDownColor: isMonochrome ? monoBorder : '#F23645',
    });
  }, [prefs.candleColorStyle, isDark]);

  // Update priceFormat precision when switching Pair
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const pairMeta =
      WHEEL_PAIRS.find((p) => p.symbol.toUpperCase() === prefs.symbol.toUpperCase()) ||
      WHEEL_PAIRS[0];
    const minMove = Number((1 / Math.pow(10, pairMeta.decimals)).toFixed(pairMeta.decimals));
    candleSeries.applyOptions({
      priceFormat: {
        type: 'price',
        precision: pairMeta.decimals,
        minMove,
      },
    });
  }, [prefs.symbol]);

  // Disable chart pan/scroll only while actively drawing or dragging an anchor handle
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const isDrawingOrDraggingAnchor = activeDrawingTool !== 'cursor' || draggingHandle !== null;
    chart.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: !isDrawingOrDraggingAnchor,
        horzTouchDrag: !isDrawingOrDraggingAnchor,
        vertTouchDrag: !isDrawingOrDraggingAnchor,
      },
    });
  }, [activeDrawingTool, draggingHandle]);

  // Update indicator series ONLY when `prefs.studies` changes (NEVER on replayPhase or replayCutIndex!)
  useEffect(() => {
    if (fullCandlesRef.current.length === 0) return;
    const chart = chartApiRef.current;
    const savedLogicalRange = chart?.timeScale().getVisibleLogicalRange() ?? null;
    syncIndicatorsWithCandles(
      fullCandlesRef.current,
      prefs.studies,
      replayPhaseRef.current === 'active' ? replayCutIndexRef.current : undefined
    );
    if (chart && savedLogicalRange !== null) {
      chart.timeScale().setVisibleLogicalRange(savedLogicalRange);
    }
    setSvgRenderTick((t) => (t + 1) % 1000000);
  }, [prefs.studies, syncIndicatorsWithCandles]);

  // Fetch 500 historical candles + Open Real-Time WebSocket Live Stream ONLY on Pair/Timeframe change
  useEffect(() => {
    const abortController = new AbortController();
    const pairIdx = resolvePairWheelIndex(prefs.symbol);
    const tfIdx = resolveTfWheelIndex(prefs.interval);
    const pairMeta = WHEEL_PAIRS[pairIdx] || WHEEL_PAIRS[0];
    const tfMeta = WHEEL_TIMEFRAMES[tfIdx] || WHEEL_TIMEFRAMES[3];

    // Exit replay when pair or timeframe changes
    replayPhaseRef.current = 'off';
    setReplayPhase('off');
    setIsReplayPlaying(false);
    setReplayGuideX(null);
    setIsDraggingCutter(false);
    isDraggingCutterRef.current = false;
    setIsLiveConnected(false);

    // Helper to heal any legacy drawings in localStorage that lack valid timestamps or have out-of-epoch timestamps
    // so they never resolve to index 0 (stuck at pojok kiri) when switching timeframes.
    const healDrawingsForCandles = (loadedCandles: OhlcCandle[], tfSec: number, pairLabel: string) => {
      if (!loadedCandles || loadedCandles.length < 10) return;
      const firstT = Number(loadedCandles[0].time);
      const lastIdx = loadedCandles.length - 1;
      const lastT = Number(loadedCandles[lastIdx].time);

      setDrawings((prev) => {
        let changed = false;
        const next = prev.map((d) => {
          if (d.pair !== pairLabel) return d;
          const p1Time = d.p1?.time;
          const needsHeal =
            p1Time === undefined ||
            !Number.isFinite(p1Time) ||
            p1Time <= 0;
          if (!needsHeal) return d;

          changed = true;
          const barSpan = Math.max(
            4,
            Math.min(60, Math.round(Math.abs((d.p2?.logical ?? d.p1.logical + 22) - d.p1.logical)) || 22)
          );
          const safeP1Idx = Math.max(
            Math.max(5, lastIdx - 45),
            Math.min(lastIdx - 8, Math.round(d.p1.logical))
          );
          const healedP1Time = Number(loadedCandles[safeP1Idx]?.time ?? lastT);
          const healedP2Idx = safeP1Idx + barSpan;
          const healedP2Time =
            healedP2Idx <= lastIdx
              ? Number(loadedCandles[healedP2Idx].time)
              : healedP1Time + barSpan * tfSec;

          return {
            ...d,
            p1: {
              ...d.p1,
              logical: safeP1Idx,
              time: healedP1Time,
            },
            p2: {
              ...d.p2,
              logical: healedP2Idx,
              time: healedP2Time,
            },
            createdAtTime: healedP1Time,
          };
        });
        if (changed) {
          saveStoredDrawings(next);
          return next;
        }
        return prev;
      });
    };

    // 0ms Instant Load from Local Cache if available
    const cached = loadCachedCandles(pairMeta.symbol, tfMeta.value, pairMeta.label);
    if (cached && cached.length > 0 && candleSeriesRef.current) {
      setCandleSource('cached');
      fullCandlesRef.current = cached;
      replayDataRef.current = [...cached];
      setTotalCandlesCount(cached.length);
      setLatestCandle(cached[cached.length - 1]);
      setIsLoadingData(false);
      healDrawingsForCandles(cached, tfMeta.seconds, pairMeta.label);
      timeScaleAnchorSeriesRef.current?.setData(
        cached.map((c) => ({ time: c.time, value: c.close }))
      );
      candleSeriesRef.current.setData(cached);
      syncIndicatorsWithCandles(cached, prefs.studies);
      applyDefaultVisibleRange(chartApiRef.current, cached.length);
      triggerSvgOverlaySync();
    } else {
      setIsLoadingData(true);
    }

    const marketStatus = isMarketOpenForPair(pairMeta.label);
    setIsMarketOpen(marketStatus.isOpen);
    setMarketStatusText(marketStatus.statusText);

    // Clean up previous WebSocket connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore close error
      }
      wsRef.current = null;
    }
    if (syntheticTickTimerRef.current) {
      clearInterval(syntheticTickTimerRef.current);
      syntheticTickTimerRef.current = null;
    }

    const connectBinanceWebSocket = (wsUrl: string, allowFallbackMirror: boolean) => {
      if (abortController.signal.aborted) return;
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!abortController.signal.aborted) {
            setIsLiveConnected(true);
          }
        };

        ws.onmessage = (event) => {
          if (abortController.signal.aborted) return;
          try {
            const payload = JSON.parse(event.data);
            const k = payload?.k;
            if (!k) return;

            const barTime = Math.floor(Number(k.t) / 1000) as UTCTimestamp;
            const updatedCandle: OhlcCandle = {
              time: barTime,
              open: Number(parseFloat(k.o).toFixed(pairMeta.decimals)),
              high: Number(parseFloat(k.h).toFixed(pairMeta.decimals)),
              low: Number(parseFloat(k.l).toFixed(pairMeta.decimals)),
              close: Number(parseFloat(k.c).toFixed(pairMeta.decimals)),
            };

            const list = fullCandlesRef.current;
            const isNewBar = list.length === 0 || barTime > list[list.length - 1].time;
            if (list.length > 0 && list[list.length - 1].time === barTime) {
              list[list.length - 1] = updatedCandle;
            } else if (isNewBar) {
              fullCandlesRef.current = [...list, updatedCandle];
              setTotalCandlesCount(fullCandlesRef.current.length);
            }

            // Only push live updates to the visual chart when NOT in Replay Mode
            if (replayPhaseRef.current === 'off' && candleSeriesRef.current) {
              timeScaleAnchorSeriesRef.current?.update({
                time: updatedCandle.time,
                value: updatedCandle.close,
              });
              candleSeriesRef.current.update(updatedCandle);
              scheduleLatestCandleUpdate(updatedCandle);
              triggerSvgOverlaySync();
            }
          } catch {
            // Ignore malformed WS frame
          }
        };

        ws.onerror = () => {
          ws.close();
        };

        ws.onclose = () => {
          if (abortController.signal.aborted) return;
          setIsLiveConnected(false);
          // Only retry real connection during market open hours without generating fake synthetic ticks
          if (allowFallbackMirror && pairMeta.binanceSymbol) {
            connectBinanceWebSocket(
              `wss://data-stream.binance.vision/ws/${pairMeta.binanceSymbol.toLowerCase()}@kline_${tfMeta.binanceInterval}`,
              false
            );
          }
        };
      } catch {
        setIsLiveConnected(false);
      }
    };

    void (async () => {
      try {
        const { candles, source } = await fetchHistoricalCandles(
          pairMeta,
          tfMeta,
          abortController.signal
        );
        if (abortController.signal.aborted) return;

        setCandleSource(source);
        saveCachedCandles(pairMeta.symbol, tfMeta.value, candles);
        fullCandlesRef.current = candles;
        replayDataRef.current = [...candles];
        setTotalCandlesCount(candles.length);
        setReplayCutIndex(Math.max(0, candles.length - 1));
        healDrawingsForCandles(candles, tfMeta.seconds, pairMeta.label);

        if (candleSeriesRef.current) {
          chartApiRef.current?.priceScale('right').applyOptions({ autoScale: true });
          timeScaleAnchorSeriesRef.current?.setData(
            candles.map((c) => ({ time: c.time, value: c.close }))
          );
          candleSeriesRef.current.setData(candles);
          syncIndicatorsWithCandles(candles, prefs.studies);
          applyDefaultVisibleRange(chartApiRef.current, candles.length);
        }

        if (candles.length > 0) {
          setLatestCandle(candles[candles.length - 1]);
        }
        setIsLoadingData(false);
        setSvgRenderTick((t) => (t + 1) % 1000000);

        // Section A.5: Only stream background WebSocket ticks when in Replay Studio mode.
        // In Live Advanced Chart mode (live_oanda), TradingView handles its own live feed inside the iframe,
        // so keeping the host React component 100% idle prevents state-update layout jitter during touch drag.
        if (
          chartEngineMode === 'replay_studio' &&
          marketStatus.isOpen &&
          source === 'binance' &&
          pairMeta.binanceSymbol
        ) {
          connectBinanceWebSocket(
            `wss://stream.binance.com:9443/ws/${pairMeta.binanceSymbol.toLowerCase()}@kline_${tfMeta.binanceInterval}`,
            true
          );
        } else {
          setIsLiveConnected(marketStatus.isOpen && (source === 'twelvedata' || source === 'cached'));
        }
      } catch {
        // Ignore abort error
      }
    })();

    return () => {
      abortController.abort();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore close error
        }
        wsRef.current = null;
      }
      if (syntheticTickTimerRef.current) {
        clearInterval(syntheticTickTimerRef.current);
        syntheticTickTimerRef.current = null;
      }
    };
  }, [prefs.symbol, prefs.interval, chartEngineMode, applyDefaultVisibleRange]);

  // =========================================================================
  // TRUE BAR REPLAY ENGINE (100% Static Camera Position + Whitespace Pad)
  // =========================================================================

  const updateCutterXFromClientX = useCallback((clientX: number) => {
    const container = chartContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const maxRight = Math.max(24, rect.width - 52);
    const localX = Math.max(12, Math.min(maxRight, Math.round(clientX - rect.left)));
    pendingCutterXRef.current = localX;
    if (cutterRafRef.current === null) {
      cutterRafRef.current = window.requestAnimationFrame(() => {
        cutterRafRef.current = null;
        if (pendingCutterXRef.current !== null) {
          setReplayGuideX(pendingCutterXRef.current);
        }
      });
    }
  }, []);

  // Rule 4: Close / Exit Replay (X) -> restore fullCandlesRef.current, scrollToRealTime(), and resume live stream
  const handleExitReplayMode = useCallback(() => {
    if (cutterRafRef.current !== null) {
      window.cancelAnimationFrame(cutterRafRef.current);
      cutterRafRef.current = null;
    }
    pendingCutterXRef.current = null;
    setIsReplayPlaying(false);
    replayPhaseRef.current = 'off';
    setReplayPhase('off');
    setReplayGuideX(null);
    setIsDraggingCutter(false);
    isDraggingCutterRef.current = false;

    const chart = chartApiRef.current;
    const candleSeries = candleSeriesRef.current;
    const allCandles = fullCandlesRef.current;
    if (chart && candleSeries && allCandles.length > 0) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      timeScaleAnchorSeriesRef.current?.setData(
        allCandles.map((c) => ({ time: c.time, value: c.close }))
      );
      candleSeries.setData(allCandles);
      syncIndicatorsWithCandles(allCandles, prefs.studies);
      chart.timeScale().scrollToRealTime();
      setLatestCandle(allCandles[allCandles.length - 1]);
    }
    setSvgRenderTick((t) => (t + 1) % 1000000);
  }, [prefs.studies, syncIndicatorsWithCandles]);

  // Cancel cutter selection ("Batal (X)" in Stage 1) -> just hide the cutter UI without moving the chart
  const handleCancelCutSelection = useCallback(() => {
    if (cutterRafRef.current !== null) {
      window.cancelAnimationFrame(cutterRafRef.current);
      cutterRafRef.current = null;
    }
    pendingCutterXRef.current = null;
    setIsReplayPlaying(false);
    replayPhaseRef.current = 'off';
    setReplayPhase('off');
    setReplayGuideX(null);
    setIsDraggingCutter(false);
    isDraggingCutterRef.current = false;
  }, []);

  // Rule 1: Pressing Replay (Scissors) ONLY shows the blue cutter line UI on top of the static chart
  // (NEVER calls setData, fitContent, or scrollToRealTime when opening the cutter!)
  const handleToggleReplayMode = useCallback(() => {
    if (chartEngineMode !== 'replay_studio') {
      handleSetChartEngineMode('replay_studio');
    }
    if (replayPhaseRef.current === 'active') {
      handleExitReplayMode();
    } else if (replayPhaseRef.current === 'selecting_cut') {
      handleCancelCutSelection();
    } else {
      setShowDrawingToolbar(false);
      setActiveDrawingTool('cursor');
      setIsReplayPlaying(false);
      replayPhaseRef.current = 'selecting_cut';
      setReplayPhase('selecting_cut');
      const containerWidth = chartContainerRef.current?.clientWidth || 360;
      setReplayGuideX(Math.round(containerWidth / 2));
    }
  }, [chartEngineMode, handleCancelCutSelection, handleExitReplayMode, handleSetChartEngineMode]);

  // Rule 2 & Rule 3: Execute Cut at Draggable Cutter Line X using `.map()` Whitespace Pad + `updateSeriesWithoutJumping`
  const handleConfirmReplayCut = useCallback(() => {
    const chart = chartApiRef.current;
    const container = chartContainerRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !container || !candleSeries) return;

    const allCandles = fullCandlesRef.current;
    if (allCandles.length < 5) return;

    const curtainX =
      replayGuideX !== null ? replayGuideX : Math.round((container.clientWidth || 360) / 2);

    const logical = chart.timeScale().coordinateToLogical(curtainX);
    const timeAtX = chart.timeScale().coordinateToTime(curtainX);

    let resolvedIdx: number | null = null;
    if (logical !== null && Number.isFinite(Number(logical))) {
      resolvedIdx = Math.round(Number(logical));
    } else if (timeAtX !== null) {
      const targetTime = Number(timeAtX);
      const foundIdx = allCandles.findIndex((c) => Number(c.time) >= targetTime);
      if (foundIdx !== -1) {
        resolvedIdx = foundIdx;
      }
    }

    const fallbackIdx = Math.floor(allCandles.length * 0.7);
    const cutIndex = Math.max(
      1,
      Math.min(allCandles.length - 2, resolvedIdx !== null ? resolvedIdx : fallbackIdx)
    );

    // Ensure timeScaleAnchorSeries keeps all 500 time points anchored
    timeScaleAnchorSeriesRef.current?.setData(
      allCandles.map((c) => ({ time: c.time, value: c.close }))
    );

    // Rule 2: Map fullCandlesRef.current so array length stays 100% constant (Whitespace after cutIndex)
    const replayData = fullCandlesRef.current.map((candle, idx) => {
      if (idx <= cutIndex) {
        return candle; // Data candle utuh { time, open, high, low, close }
      }
      return { time: candle.time }; // Whitespace object (HANYA time, tanpa open/high/low/close)
    });

    replayDataRef.current = replayData;

    // Rule 3: Update series without jumping (locks savedLogicalRange & priceScale)
    updateSeriesWithoutJumping(replayData, cutIndex);

    replayCutIndexRef.current = cutIndex;
    setReplayCutIndex(cutIndex);
    setLatestCandle(allCandles[cutIndex]);
    replayPhaseRef.current = 'active';
    setReplayPhase('active');
    setIsReplayPlaying(false);
    if (cutterRafRef.current !== null) {
      window.cancelAnimationFrame(cutterRafRef.current);
      cutterRafRef.current = null;
    }
    pendingCutterXRef.current = null;
    setReplayGuideX(null);
    setIsDraggingCutter(false);
    isDraggingCutterRef.current = false;
    setSvgRenderTick((t) => (t + 1) % 1000000);
  }, [replayGuideX, updateSeriesWithoutJumping]);

  // Rule 3: Step Forward (+1 Candle) & Play while keeping savedLogicalRange & PriceScale 100% static
  const handleStepForwardOneCandle = useCallback(() => {
    const chart = chartApiRef.current;
    const candleSeries = candleSeriesRef.current;
    const allCandles = fullCandlesRef.current;
    const currentIdx = replayCutIndexRef.current;
    if (!chart || !candleSeries || currentIdx >= allCandles.length - 1) {
      setIsReplayPlaying(false);
      return;
    }

    const nextIndex = currentIdx + 1;
    const nextCandle = allCandles[nextIndex];
    if (nextCandle) {
      const savedLogicalRange = chart.timeScale().getVisibleLogicalRange();
      chart.priceScale('right').applyOptions({ autoScale: false });

      if (replayDataRef.current.length === allCandles.length) {
        replayDataRef.current[nextIndex] = nextCandle;
      } else {
        replayDataRef.current = buildReplayCandlestickData(allCandles, nextIndex);
      }

      try {
        candleSeries.update(nextCandle);
      } catch {
        candleSeries.setData(replayDataRef.current);
      }

      syncIndicatorsWithCandles(allCandles, prefs.studies, nextIndex);

      if (savedLogicalRange !== null) {
        chart.timeScale().setVisibleLogicalRange(savedLogicalRange);
      }

      replayCutIndexRef.current = nextIndex;
      setLatestCandle(nextCandle);
      setReplayCutIndex(nextIndex);
      setSvgRenderTick((t) => (t + 1) % 1000000);
    }

    if (nextIndex >= allCandles.length - 1) {
      setIsReplayPlaying(false);
    }
  }, [prefs.studies, syncIndicatorsWithCandles]);

  // Replay Auto-Play Timer (1x = 750ms, 2x = 375ms, 5x = 150ms)
  useEffect(() => {
    if (replayPhase !== 'active' || !isReplayPlaying) return;
    const delayMs = replaySpeed === 5 ? 150 : replaySpeed === 2 ? 375 : 750;
    const timer = setInterval(() => {
      handleStepForwardOneCandle();
    }, delayMs);
    return () => clearInterval(timer);
  }, [replayPhase, isReplayPlaying, replaySpeed, handleStepForwardOneCandle]);

  // Global mouse move / up tracking while dragging the Cutter Line with mouse
  useEffect(() => {
    if (!isSelectingCutPoint || !isDraggingCutter || typeof window === 'undefined') return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isDraggingCutterRef.current) return;
      updateCutterXFromClientX(e.clientX);
    };

    const handleWindowMouseUp = () => {
      isDraggingCutterRef.current = false;
      setIsDraggingCutter(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove, { passive: true });
    window.addEventListener('mouseup', handleWindowMouseUp, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isSelectingCutPoint, isDraggingCutter, updateCutterXFromClientX]);

  const handleCutterPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    isDraggingCutterRef.current = true;
    setIsDraggingCutter(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
    updateCutterXFromClientX(e.clientX);
  };

  const handleCutterPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!isDraggingCutterRef.current) return;
    e.stopPropagation();
    updateCutterXFromClientX(e.clientX);
  };

  const handleCutterPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    isDraggingCutterRef.current = false;
    setIsDraggingCutter(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release pointer capture errors
    }
  };

  const handleCutterTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    e.stopPropagation();
    isDraggingCutterRef.current = true;
    setIsDraggingCutter(true);
    if (e.touches.length > 0) {
      updateCutterXFromClientX(e.touches[0].clientX);
    }
  };

  const handleCutterTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!isDraggingCutterRef.current) return;
    e.stopPropagation();
    if (e.touches.length > 0) {
      updateCutterXFromClientX(e.touches[0].clientX);
    }
  };

  const handleCutterTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    e.stopPropagation();
    isDraggingCutterRef.current = false;
    setIsDraggingCutter(false);
  };

  const handleCutterMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingCutterRef.current = true;
    setIsDraggingCutter(true);
    updateCutterXFromClientX(e.clientX);
  };

  const handleCutterMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!isDraggingCutterRef.current) return;
    e.stopPropagation();
    updateCutterXFromClientX(e.clientX);
  };

  // =========================================================================
  // COORDINATE-ANCHORED DRAWING TOOLS ENGINE ({ logical, price, time })
  // =========================================================================

  const activeTimeframeSeconds = useMemo(() => {
    const tf = WHEEL_TIMEFRAMES.find(
      (item) => item.value === prefs.interval || item.binanceInterval === prefs.interval
    );
    return tf ? tf.seconds : 3600;
  }, [prefs.interval]);

  const convertPixelToAnchor = useCallback(
    (localX: number, localY: number): DrawingAnchor | null => {
      const chart = chartApiRef.current;
      const series = candleSeriesRef.current;
      if (!chart || !series) return null;

      const container = chartContainerRef.current;
      const w = container?.clientWidth || 360;
      const h = container?.clientHeight || 420;
      const clampedX = Math.max(6, Math.min(Math.max(26, w - 56), localX));
      const clampedY = Math.max(6, Math.min(Math.max(26, h - 26), localY));

      const logical = chart.timeScale().coordinateToLogical(clampedX);
      const rawPrice = series.coordinateToPrice(clampedY);
      if (logical === null || rawPrice === null) return null;

      const candles = fullCandlesRef.current;
      const idx = Math.round(Number(logical));
      const candleAtIdx = idx >= 0 && idx < candles.length ? candles[idx] : undefined;

      let finalPrice = Number(Number(rawPrice).toFixed(activePairMeta.decimals));
      // Always snap horizontal logical index to the nearest candle bar center so domain timestamps
      // match exact candle open times and never drift into weekend gaps or adjacent bars across timeframes.
      let finalLogical = Math.round(Number(logical));

      // Magnet Mode: Snap to closest OHLC point (High, Low, Open, Close) within 24px radius
      if (isMagnetActive && candleAtIdx) {
        const candidates = [candleAtIdx.high, candleAtIdx.low, candleAtIdx.open, candleAtIdx.close];
        let bestCandidate = finalPrice;
        let minPixelDist = 24;

        for (const cand of candidates) {
          const candY = series.priceToCoordinate(cand);
          if (candY !== null) {
            const dist = Math.abs(candY - clampedY);
            if (dist < minPixelDist) {
              minPixelDist = dist;
              bestCandidate = cand;
            }
          }
        }

        if (minPixelDist < 24) {
          finalPrice = Number(bestCandidate.toFixed(activePairMeta.decimals));
          finalLogical = idx;
        }
      }

      // Compute exact domain timestamp from the snapped candle index
      const resolvedTime = resolveTimeFromLogical(
        finalLogical,
        candles,
        activeTimeframeSeconds
      );

      return {
        logical: finalLogical,
        price: finalPrice,
        time: resolvedTime,
      };
    },
    [isMagnetActive, activePairMeta.decimals, activeTimeframeSeconds]
  );

  const convertAnchorToPixel = useCallback(
    (anchor: DrawingAnchor, referenceAnchor?: DrawingAnchor): { x: number; y: number } | null => {
      const chart = chartApiRef.current;
      const series = candleSeriesRef.current;
      if (!chart || !series) return null;

      const candles = fullCandlesRef.current;
      let effectiveLogical: number;
      if (
        (anchor.time === undefined || !Number.isFinite(anchor.time)) &&
        referenceAnchor &&
        referenceAnchor.time !== undefined &&
        Number.isFinite(referenceAnchor.time)
      ) {
        const refLogical = resolveLogicalFromTime(
          referenceAnchor,
          candles,
          activeTimeframeSeconds
        );
        effectiveLogical = refLogical + (anchor.logical - referenceAnchor.logical);
      } else if (anchor.time !== undefined && Number.isFinite(anchor.time)) {
        effectiveLogical = resolveLogicalFromTime(
          anchor,
          candles,
          activeTimeframeSeconds
        );
      } else {
        effectiveLogical = anchor.logical;
      }

      const x = chart.timeScale().logicalToCoordinate(effectiveLogical as Logical);
      const y = series.priceToCoordinate(anchor.price);
      if (x === null || y === null) return null;
      return { x: Number(x), y: Number(y) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [svgRenderTick, activeTimeframeSeconds]
  );

  const syncCrosshairAtPlotPixel = useCallback(
    (plotX: number, plotY: number): DrawingAnchor | null => {
      setAimCursorPos({ x: plotX, y: plotY });
      const anchor = convertPixelToAnchor(plotX, plotY);
      if (anchor) {
        crosshairAnchorRef.current = anchor;
        setCrosshairAnchor(anchor);
      }
      return anchor;
    },
    [convertPixelToAnchor]
  );

  const cancelActiveDrawingPlacement = useCallback(() => {
    if (draftRafRef.current !== null) {
      window.cancelAnimationFrame(draftRafRef.current);
      draftRafRef.current = null;
    }
    pendingDraftPosRef.current = null;
    aimDragRef.current = null;
    setDraftDrawing(null);
    setDraftStep(0);
    setPlacementState('cancelled');
    setActiveDrawingTool('cursor');
    setAimCursorPos(null);
    crosshairAnchorRef.current = null;
    setCrosshairAnchor(null);
  }, []);

  // BAGIAN B8: Escape key cancels active drawing placement or deselects selected drawing cleanly
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeDrawingTool !== 'cursor') {
          e.preventDefault();
          cancelActiveDrawingPlacement();
        } else if (selectedDrawingId) {
          e.preventDefault();
          setSelectedDrawingId(null);
          setIsDrawingSettingsOpen(false);
          setTransientRulerDrawing(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDrawingTool, selectedDrawingId, cancelActiveDrawingPlacement]);

  // Initialize Crosshair at the center of the chart plot area whenever a drawing tool is selected
  useEffect(() => {
    if (activeDrawingTool === 'cursor') {
      setAimCursorPos(null);
      crosshairAnchorRef.current = null;
      setCrosshairAnchor(null);
      aimDragRef.current = null;
      setPlacementState((prev) => (prev === 'cancelled' || prev === 'completed' ? prev : 'idle'));
      return;
    }
    const container = chartContainerRef.current;
    const w = container?.clientWidth || 360;
    const h = container?.clientHeight || 420;
    const defaultX = Math.max(24, Math.min(w - 68, Math.round((w - 56) / 2)));
    const defaultY = Math.max(24, Math.min(h - 36, Math.round((h - 26) / 2)));
    const targetPos = aimCursorPos ?? { x: defaultX, y: defaultY };
    setAimCursorPos(targetPos);
    const resolved = convertPixelToAnchor(targetPos.x, targetPos.y);
    if (resolved) {
      crosshairAnchorRef.current = resolved;
      setCrosshairAnchor(resolved);
    }
    setPlacementState('tool_selected');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawingTool]);

  // Keep crosshair domain anchor synchronized if chart pans/zooms or candle data finishes loading
  useEffect(() => {
    if (activeDrawingTool === 'cursor' || !aimCursorPos) return;
    const resolved = convertPixelToAnchor(aimCursorPos.x, aimCursorPos.y);
    if (resolved) {
      crosshairAnchorRef.current = resolved;
      setCrosshairAnchor(resolved);
    }
  }, [activeDrawingTool, aimCursorPos, convertPixelToAnchor, svgRenderTick]);

  const commitNewDrawing = useCallback(
    (newObj: ChartDrawingObject) => {
      if (newObj.type === 'ruler') {
        setTransientRulerDrawing(newObj);
        setSelectedDrawingId(newObj.id);
        setIsDrawingSettingsOpen(false);
        setDraftDrawing(null);
        setDraftStep(0);
        if (!stayInDrawingMode) {
          setPlacementState('completed');
          setActiveDrawingTool('cursor');
        } else {
          setPlacementState('tool_selected');
        }
        return;
      }
      setDrawings((prev) => {
        setDrawingUndoStack((u) => [...u.slice(-29), prev]);
        setDrawingRedoStack([]);
        const next = [...prev, newObj];
        saveStoredDrawings(next);
        return next;
      });
      setSelectedDrawingId(newObj.id);
      setIsDrawingSettingsOpen(false);
      setDraftDrawing(null);
      setDraftStep(0);
      if (!stayInDrawingMode) {
        setPlacementState('completed');
        setActiveDrawingTool('cursor');
      } else {
        setPlacementState('tool_selected');
      }
    },
    [stayInDrawingMode]
  );

  const updateExistingDrawing = useCallback(
    (drawingId: string, updater: (prev: ChartDrawingObject) => ChartDrawingObject, pushUndo = true) => {
      setTransientRulerDrawing((prevRuler) => {
        if (prevRuler && prevRuler.id === drawingId) {
          return updater(prevRuler);
        }
        return prevRuler;
      });
      setDrawings((prev) => {
        const idx = prev.findIndex((d) => d.id === drawingId);
        if (idx === -1) return prev;
        if (pushUndo) {
          setDrawingUndoStack((u) => [...u.slice(-29), prev]);
          setDrawingRedoStack([]);
        }
        const next = [...prev];
        next[idx] = updater(prev[idx]);
        saveStoredDrawings(next);
        return next;
      });
    },
    []
  );

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    setTransientRulerDrawing((prev) => (prev && prev.id === selectedDrawingId ? null : prev));
    setDrawings((prev) => {
      if (!prev.some((d) => d.id === selectedDrawingId)) return prev;
      setDrawingUndoStack((u) => [...u.slice(-29), prev]);
      setDrawingRedoStack([]);
      const next = prev.filter((d) => d.id !== selectedDrawingId);
      saveStoredDrawings(next);
      return next;
    });
    setSelectedDrawingId(null);
  }, [selectedDrawingId]);

  const handleCreateTradeFromSelectedPosition = useCallback(
    (drawing: ChartDrawingObject) => {
      const isShort =
        drawing.type === 'short_position' || drawing.type === 'short';
      const position = isShort ? 'SELL' : 'BUY';
      const entryPrice = drawing.p1.price;
      const stopLoss = drawing.slPrice;
      const takeProfit = drawing.tpPrice;
      const pairName = drawing.pair || activePairMeta.label;

      let plannedRiskReward: number | undefined = undefined;
      if (stopLoss !== undefined && takeProfit !== undefined) {
        const riskDist = Math.abs(entryPrice - stopLoss);
        const rewardDist = Math.abs(takeProfit - entryPrice);
        if (riskDist > 0) {
          plannedRiskReward = Number((rewardDist / riskDist).toFixed(2));
        }
      }

      const sizing = computeRecommendedPositionSizing(
        entryPrice,
        stopLoss ?? entryPrice,
        pairName,
        currentEquity ?? settings?.startingBalance ?? 10000,
        settings?.defaultRiskPercent ?? 1,
        settings?.xauusdPipValuePer001Lot ?? 0.1,
        settings?.xauusdPipSize ?? 0.1
      );

      if (onCreateTradeFromPosition) {
        onCreateTradeFromPosition({
          pair: pairName,
          position,
          entryPrice,
          stopLoss,
          takeProfit,
          plannedRiskReward,
          lotSize: sizing.recommendedLot,
          riskAmount: sizing.riskAmountUsd,
          riskPercentage: sizing.riskPercent,
          notes: `Analisis Chart ${pairName} (${WHEEL_TIMEFRAMES.find((tf) => tf.value === prefs.interval || tf.binanceInterval === prefs.interval)?.label || prefs.interval.toUpperCase()}) · R:R 1:${plannedRiskReward || '0'} · Lot Ideal ${sizing.recommendedLot.toFixed(2)}`,
        });
      }
    },
    [
      activePairMeta.label,
      prefs.interval,
      onCreateTradeFromPosition,
      currentEquity,
      settings?.startingBalance,
      settings?.defaultRiskPercent,
      settings?.xauusdPipValuePer001Lot,
      settings?.xauusdPipSize,
    ]
  );

  const handleToggleFavoriteTool = useCallback((toolId: ActiveDrawingToolId) => {
    setFavoriteTools((prev) => {
      const exists = prev.includes(toolId);
      const next = exists ? prev.filter((id) => id !== toolId) : [...prev, toolId];
      saveStoredFavoriteTools(next);
      return next;
    });
  }, []);

  const handleToggleShowFavoritesOnChart = useCallback(() => {
    setShowFavoritesOnChart((prev) => {
      const next = !prev;
      saveStoredShowFavoritesToolbar(next);
      return next;
    });
  }, []);

  const handleSelectToolFromMenu = useCallback(
    (toolId: ActiveDrawingToolId | 'ruler') => {
      setShowDrawingToolbar(false);
      setActiveDrawingTool(toolId);
      setDraftDrawing(null);
      setDraftStep(0);
      setSelectedDrawingId(null);
      setTransientRulerDrawing(null);
      setIsDrawingSettingsOpen(false);
      setPlacementState('tool_selected');
      const container = chartContainerRef.current;
      const w = container?.clientWidth || 360;
      const h = container?.clientHeight || 420;
      const centerPos = {
        x: Math.max(24, Math.min(w - 68, Math.round((w - 56) / 2))),
        y: Math.max(24, Math.min(h - 36, Math.round((h - 26) / 2))),
      };
      syncCrosshairAtPlotPixel(centerPos.x, centerPos.y);
    },
    [syncCrosshairAtPlotPixel]
  );

  const handleUndoDrawing = useCallback(() => {
    setDrawingUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const previousState = prevUndo[prevUndo.length - 1];
      const remainingUndo = prevUndo.slice(0, -1);

      setDrawings((current) => {
        setDrawingRedoStack((prevRedo) => [current, ...prevRedo.slice(0, 29)]);
        saveStoredDrawings(previousState);
        return previousState;
      });
      return remainingUndo;
    });
  }, []);

  const handleRedoDrawing = useCallback(() => {
    setDrawingRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const nextState = prevRedo[0];
      const remainingRedo = prevRedo.slice(1);

      setDrawings((current) => {
        setDrawingUndoStack((prevUndo) => [...prevUndo.slice(-29), current]);
        saveStoredDrawings(nextState);
        return nextState;
      });
      return remainingRedo;
    });
  }, []);

  const handleClearAllDrawingsForPair = useCallback(() => {
    setDrawings((prev) => {
      const hasAnyForPair = prev.some((d) => d.pair === activePairMeta.label);
      if (!hasAnyForPair) return prev;
      setDrawingUndoStack((u) => [...u.slice(-29), prev]);
      setDrawingRedoStack([]);
      const next = prev.filter((d) => d.pair !== activePairMeta.label);
      saveStoredDrawings(next);
      return next;
    });
    setDraftDrawing(null);
    setDraftStep(0);
    setSelectedDrawingId(null);
  }, [activePairMeta.label]);

  const startHandleDrag = (
    e: React.PointerEvent<SVGElement>,
    drawing: ChartDrawingObject,
    handle: 'p1' | 'p2' | 'p3' | 'tp' | 'sl' | 'rect_tr' | 'rect_bl' | 'body'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedDrawingId(drawing.id);
    if (drawing.locked) return;

    const container = chartContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const anchor = convertPixelToAnchor(e.clientX - rect.left, e.clientY - rect.top);
    if (!anchor) return;

    const candles = fullCandlesRef.current;
    const isPosition =
      drawing.type === 'long_position' ||
      drawing.type === 'short_position' ||
      drawing.type === 'long' ||
      drawing.type === 'short';
    if (isPosition) {
      ohlcEvaluationCacheRef.current.delete(drawing.id);
    }

    const resolvedP1Logical =
      isPosition && drawing.p1.time !== undefined && Number.isFinite(drawing.p1.time)
        ? resolveLogicalFromTime(drawing.p1, candles, activeTimeframeSeconds)
        : resolveContainingBarLogical(drawing.p1, candles, activeTimeframeSeconds);
    const isOnePointSpanTool =
      drawing.type === 'price_note' ||
      drawing.type === 'horizontal_line';
    const onePointBarSpan = Math.max(
      4,
      Math.min(80, Math.round(Math.abs(drawing.p2.logical - drawing.p1.logical)) || 22)
    );
    const rawResolvedP2Logical =
      drawing.p2.time !== undefined && Number.isFinite(drawing.p2.time)
        ? (isPosition
            ? resolveLogicalFromTime(drawing.p2, candles, activeTimeframeSeconds)
            : resolveContainingBarLogical(drawing.p2, candles, activeTimeframeSeconds))
        : isOnePointSpanTool
          ? resolvedP1Logical + onePointBarSpan
          : resolvedP1Logical + (drawing.p2.logical - drawing.p1.logical);
    const resolvedP2Logical =
      !isOnePointSpanTool &&
      !isPosition &&
      drawing.type !== 'vertical_line' &&
      Math.abs(drawing.p2.logical - drawing.p1.logical) >= 2 &&
      Math.abs(rawResolvedP2Logical - resolvedP1Logical) < 3
        ? resolvedP1Logical + (drawing.p2.logical >= drawing.p1.logical ? 3 : -3)
        : rawResolvedP2Logical;
    const resolvedP3Logical = drawing.p3
      ? drawing.p3.time !== undefined && Number.isFinite(drawing.p3.time)
        ? resolveContainingBarLogical(drawing.p3, candles, activeTimeframeSeconds)
        : resolvedP2Logical + (drawing.p3.logical - drawing.p2.logical)
      : undefined;

    setDrawingUndoStack((u) => [...u.slice(-29), drawings]);
    setDrawingRedoStack([]);
    setDraggingHandle({
      drawingId: drawing.id,
      handle,
      startAnchor: anchor,
      initialDrawing: {
        ...drawing,
        hitStatus: isPosition ? undefined : drawing.hitStatus,
        hitTime: isPosition ? undefined : drawing.hitTime,
        hitPrice: isPosition ? undefined : drawing.hitPrice,
        entryHitTime: isPosition ? undefined : drawing.entryHitTime,
        p1: {
          ...drawing.p1,
          logical: resolvedP1Logical,
          time:
            drawing.p1.time ??
            resolveTimeFromLogical(resolvedP1Logical, candles, activeTimeframeSeconds),
        },
        p2: {
          ...drawing.p2,
          logical: resolvedP2Logical,
          time: isOnePointSpanTool
            ? resolveTimeFromLogical(resolvedP2Logical, candles, activeTimeframeSeconds, drawing.p1)
            : (drawing.p2.time ??
              resolveTimeFromLogical(resolvedP2Logical, candles, activeTimeframeSeconds, drawing.p1)),
        },
        p3:
          drawing.p3 && resolvedP3Logical !== undefined
            ? {
                ...drawing.p3,
                logical: resolvedP3Logical,
                time:
                  drawing.p3.time ??
                  resolveTimeFromLogical(
                    resolvedP3Logical,
                    candles,
                    activeTimeframeSeconds,
                    drawing.p2
                  ),
              }
            : undefined,
      },
    });
  };

  // Global pointer move/up listeners while dragging an anchor handle or body of a selected drawing
  useEffect(() => {
    if (!draggingHandle || typeof window === 'undefined') return;

    let dragMoveRaf: number | null = null;
    let pendingPos: { clientX: number; clientY: number } | null = null;

    const processPointerMove = () => {
      dragMoveRaf = null;
      if (!pendingPos) return;
      const { clientX, clientY } = pendingPos;
      const container = chartContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const anchor = convertPixelToAnchor(clientX - rect.left, clientY - rect.top);
      if (!anchor) return;

      const { drawingId, handle, startAnchor, initialDrawing } = draggingHandle;
      const deltaLogical = anchor.logical - startAnchor.logical;
      const deltaPrice = anchor.price - startAnchor.price;
      const candles = fullCandlesRef.current;

      updateExistingDrawing(
        drawingId,
        (prev) => {
          if (prev.locked) return prev;
          const isLongPos = prev.type === 'long_position' || prev.type === 'long';
          const isPositionTool =
            isLongPos || prev.type === 'short_position' || prev.type === 'short';

          if (handle === 'p1') {
            if (prev.type === 'horizontal_line') {
              const nextP2Logical = anchor.logical + 25;
              return {
                ...prev,
                p1: anchor,
                p2: {
                  logical: nextP2Logical,
                  price: anchor.price,
                  time: resolveTimeFromLogical(
                    nextP2Logical,
                    candles,
                    activeTimeframeSeconds,
                    anchor
                  ),
                },
              };
            }
            if (prev.type === 'vertical_line') {
              return {
                ...prev,
                p1: anchor,
                p2: { logical: anchor.logical, price: prev.p2.price, time: anchor.time },
              };
            }
            if (prev.type === 'price_note') {
              const offsetL = initialDrawing.p2.logical - initialDrawing.p1.logical;
              const offsetP = initialDrawing.p2.price - initialDrawing.p1.price;
              const nextP2Logical = anchor.logical + offsetL;
              return {
                ...prev,
                p1: anchor,
                p2: {
                  logical: nextP2Logical,
                  price: Number((anchor.price + offsetP).toFixed(activePairMeta.decimals)),
                  time: resolveTimeFromLogical(
                    nextP2Logical,
                    candles,
                    activeTimeframeSeconds,
                    anchor
                  ),
                },
              };
            }
            if (isPositionTool) {
              const normalized = normalizePositionPrices(
                isLongPos,
                anchor.price,
                prev.slPrice,
                prev.tpPrice,
                activePairMeta.volatility,
                activePairMeta.decimals
              );
              const durationSec =
                initialDrawing.p2.time !== undefined && initialDrawing.p1.time !== undefined
                  ? Math.max(60, initialDrawing.p2.time - initialDrawing.p1.time)
                  : Math.max(60, (initialDrawing.p2.logical - initialDrawing.p1.logical) * activeTimeframeSeconds);
              const anchorTime =
                anchor.time !== undefined
                  ? anchor.time
                  : resolveTimeFromLogical(anchor.logical, candles, activeTimeframeSeconds) ?? (initialDrawing.p1.time ?? 0);
              const nextP2Time = anchorTime + durationSec;
              const nextP2Logical = resolveLogicalFromTime(
                { logical: 0, price: 0, time: nextP2Time },
                candles,
                activeTimeframeSeconds
              );
              return {
                ...prev,
                p1: { ...anchor, price: normalized.entryPrice, time: anchorTime },
                p2: {
                  logical: nextP2Logical,
                  price: normalized.entryPrice,
                  time: nextP2Time,
                },
                createdAtTime: anchorTime,
                slPrice: normalized.slPrice,
                tpPrice: normalized.tpPrice,
                hitStatus: undefined,
                hitTime: undefined,
                hitPrice: undefined,
                entryHitTime: undefined,
              };
            }
            return { ...prev, p1: anchor };
          }
          if (handle === 'p2') {
            if (isPositionTool) {
              const prevP1Logical =
                prev.p1.time !== undefined && Number.isFinite(prev.p1.time)
                  ? resolveLogicalFromTime(prev.p1, candles, activeTimeframeSeconds)
                  : resolveContainingBarLogical(prev.p1, candles, activeTimeframeSeconds);
              const nextP2Logical = Math.max(prevP1Logical + 0.1, anchor.logical);
              const nextP2Time =
                anchor.time !== undefined
                  ? anchor.time
                  : resolveTimeFromLogical(nextP2Logical, candles, activeTimeframeSeconds, prev.p1);
              return {
                ...prev,
                p1: {
                  ...prev.p1,
                  logical: prevP1Logical,
                },
                p2: {
                  logical: nextP2Logical,
                  price: prev.p1.price,
                  time: nextP2Time,
                },
                hitStatus: undefined,
                hitTime: undefined,
                hitPrice: undefined,
                entryHitTime: undefined,
              };
            }
            return { ...prev, p2: anchor };
          }
          if (handle === 'p3') {
            return { ...prev, p3: anchor };
          }
          if (handle === 'tp') {
            const normalized = normalizePositionPrices(
              isLongPos,
              prev.p1.price,
              prev.slPrice,
              anchor.price,
              activePairMeta.volatility,
              activePairMeta.decimals
            );
            return {
              ...prev,
              tpPrice: normalized.tpPrice,
              hitStatus: undefined,
              hitTime: undefined,
              hitPrice: undefined,
              entryHitTime: undefined,
            };
          }
          if (handle === 'sl') {
            const normalized = normalizePositionPrices(
              isLongPos,
              prev.p1.price,
              anchor.price,
              prev.tpPrice,
              activePairMeta.volatility,
              activePairMeta.decimals
            );
            return {
              ...prev,
              slPrice: normalized.slPrice,
              hitStatus: undefined,
              hitTime: undefined,
              hitPrice: undefined,
              entryHitTime: undefined,
            };
          }
          if (handle === 'rect_tr') {
            return {
              ...prev,
              p1: { ...prev.p1, price: anchor.price },
              p2: { ...prev.p2, logical: anchor.logical, time: anchor.time },
            };
          }
          if (handle === 'rect_bl') {
            return {
              ...prev,
              p1: { ...prev.p1, logical: anchor.logical, time: anchor.time },
              p2: { ...prev.p2, price: anchor.price },
            };
          }
          if (handle === 'body') {
            const nextP1Logical = initialDrawing.p1.logical + deltaLogical;
            const nextP2Logical = initialDrawing.p2.logical + deltaLogical;
            const nextP1Time = resolveTimeFromLogical(
              nextP1Logical,
              candles,
              activeTimeframeSeconds,
              initialDrawing.p1
            );
            const nextP2Time = resolveTimeFromLogical(
              nextP2Logical,
              candles,
              activeTimeframeSeconds,
              initialDrawing.p2.time !== undefined ? initialDrawing.p2 : initialDrawing.p1
            );

            const nextP3Logical = initialDrawing.p3
              ? initialDrawing.p3.logical + deltaLogical
              : undefined;
            const nextP3Time =
              initialDrawing.p3 && nextP3Logical !== undefined
                ? resolveTimeFromLogical(
                    nextP3Logical,
                    candles,
                    activeTimeframeSeconds,
                    initialDrawing.p3.time !== undefined ? initialDrawing.p3 : initialDrawing.p2
                  )
                : undefined;

            return {
              ...prev,
              p1: {
                logical: nextP1Logical,
                price: Number((initialDrawing.p1.price + deltaPrice).toFixed(activePairMeta.decimals)),
                time: nextP1Time,
              },
              p2: {
                logical: nextP2Logical,
                price: Number((initialDrawing.p2.price + deltaPrice).toFixed(activePairMeta.decimals)),
                time: nextP2Time,
              },
              p3:
                initialDrawing.p3 && nextP3Logical !== undefined
                  ? {
                      logical: nextP3Logical,
                      price: Number(
                        (initialDrawing.p3.price + deltaPrice).toFixed(activePairMeta.decimals)
                      ),
                      time: nextP3Time,
                    }
                  : undefined,
              createdAtTime: isPositionTool ? nextP1Time : prev.createdAtTime,
              tpPrice:
                initialDrawing.tpPrice !== undefined
                  ? Number((initialDrawing.tpPrice + deltaPrice).toFixed(activePairMeta.decimals))
                  : undefined,
              slPrice:
                initialDrawing.slPrice !== undefined
                  ? Number((initialDrawing.slPrice + deltaPrice).toFixed(activePairMeta.decimals))
                  : undefined,
              hitStatus: isPositionTool ? undefined : prev.hitStatus,
              hitTime: isPositionTool ? undefined : prev.hitTime,
              hitPrice: isPositionTool ? undefined : prev.hitPrice,
              entryHitTime: isPositionTool ? undefined : prev.entryHitTime,
            };
          }
          return prev;
        },
        false
      );
    };

    const handleWindowPointerMove = (e: PointerEvent) => {
      pendingPos = { clientX: e.clientX, clientY: e.clientY };
      if (dragMoveRaf === null) {
        dragMoveRaf = window.requestAnimationFrame(processPointerMove);
      }
    };

    const handleWindowPointerUp = () => {
      if (dragMoveRaf !== null) {
        window.cancelAnimationFrame(dragMoveRaf);
        dragMoveRaf = null;
      }
      if (draggingHandle) {
        ohlcEvaluationCacheRef.current.delete(draggingHandle.drawingId);
      }
      pendingPos = null;
      setDraggingHandle(null);
    };

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', handleWindowPointerUp, { passive: true });
    window.addEventListener('pointercancel', handleWindowPointerUp, { passive: true });
    return () => {
      if (dragMoveRaf !== null) {
        window.cancelAnimationFrame(dragMoveRaf);
        dragMoveRaf = null;
      }
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [
    draggingHandle,
    convertPixelToAnchor,
    updateExistingDrawing,
    activePairMeta.decimals,
    activePairMeta.volatility,
    activeTimeframeSeconds,
  ]);

  /**
   * BAGIAN B2 & B3: Confirm drawing point strictly from the Crosshair's domain coordinate (`crosshairAnchor`).
   * Never uses the physical location of the second touch (`confirmTap`).
   */
  const confirmDrawingPointWithAnchor = useCallback(
    (explicitAnchor?: DrawingAnchor | null) => {
      if (activeDrawingTool === 'cursor') return;

      const container = chartContainerRef.current;
      const w = container?.clientWidth || 360;
      const h = container?.clientHeight || 420;
      const currentPos = aimCursorPos ?? {
        x: Math.round((w - 56) / 2),
        y: Math.round((h - 26) / 2),
      };

      const anchorSnapshot =
        explicitAnchor ??
        crosshairAnchorRef.current ??
        crosshairAnchor ??
        convertPixelToAnchor(currentPos.x, currentPos.y);

      if (!anchorSnapshot) return;

      const nextMachine = advancePlacementStateMachine(
        {
          placementState,
          activeTool: activeDrawingTool,
          crosshairPos: currentPos,
          crosshairAnchor: anchorSnapshot,
          draftDrawing,
          draftStep,
          committedDrawings: [],
        },
        {
          type: 'CONFIRM_SECOND_TOUCH',
          pair: activePairMeta.label,
          volatility: activePairMeta.volatility,
          decimals: activePairMeta.decimals,
          stayInDrawingMode,
          tfSeconds: activeTimeframeSeconds,
        }
      );

      if (nextMachine.committedDrawings.length > 0) {
        commitNewDrawing(nextMachine.committedDrawings[0]);
      } else {
        setDraftDrawing(nextMachine.draftDrawing);
        setDraftStep(nextMachine.draftStep);
        setPlacementState(nextMachine.placementState);
      }
    },
    [
      activeDrawingTool,
      activePairMeta.decimals,
      activePairMeta.label,
      activePairMeta.volatility,
      activeTimeframeSeconds,
      aimCursorPos,
      commitNewDrawing,
      convertPixelToAnchor,
      crosshairAnchor,
      draftDrawing,
      draftStep,
      placementState,
      stayInDrawingMode,
    ]
  );

  const handleLockAimedPoint = useCallback(() => {
    confirmDrawingPointWithAnchor(crosshairAnchorRef.current);
  }, [confirmDrawingPointWithAnchor]);

  const handleOverlayPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const container = chartContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (activeDrawingTool === 'cursor') {
      setSelectedDrawingId(null);
      setTransientRulerDrawing(null);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const w = container.clientWidth || 360;
    const h = container.clientHeight || 420;
    const currentAim = aimCursorPos ?? {
      x: Math.round((w - 56) / 2),
      y: Math.round((h - 26) / 2),
    };

    // Ensure crosshairAnchorRef has the current crosshair domain coordinate before any drag/confirm begins
    if (!crosshairAnchorRef.current) {
      const initAnchor = convertPixelToAnchor(currentAim.x, currentAim.y);
      if (initAnchor) {
        crosshairAnchorRef.current = initAnchor;
        setCrosshairAnchor(initAnchor);
      }
    }

    aimDragRef.current = {
      pointerId: e.pointerId,
      startX: localX,
      startY: localY,
      origAimX: currentAim.x,
      origAimY: currentAim.y,
      moved: false,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const container = chartContainerRef.current;
    if (!container || activeDrawingTool === 'cursor') return;
    const drag = aimDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const rect = container.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const dx = localX - drag.startX;
    const dy = localY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      setPlacementState('placing');
    }

    // Only move the crosshair when the user is dragging (> 5px threshold)
    if (!drag.moved) return;

    const maxW = Math.max(40, (container.clientWidth || 360) - 56);
    const maxH = Math.max(40, (container.clientHeight || 420) - 26);
    const nextAimX = Math.max(6, Math.min(maxW, Math.round(drag.origAimX + dx)));
    const nextAimY = Math.max(6, Math.min(maxH, Math.round(drag.origAimY + dy)));

    const liveAnchor = syncCrosshairAtPlotPixel(nextAimX, nextAimY);

    if (!draftDrawing || !liveAnchor) return;
    pendingDraftPosRef.current = {
      localX: nextAimX,
      localY: nextAimY,
    };

    if (draftRafRef.current === null) {
      draftRafRef.current = window.requestAnimationFrame(() => {
        draftRafRef.current = null;
        if (!pendingDraftPosRef.current) return;
        const { localX: ax, localY: ay } = pendingDraftPosRef.current;
        const anchor = convertPixelToAnchor(ax, ay);
        if (!anchor) return;

        setDraftDrawing((prev) => {
          if (!prev) return null;
          if (prev.type === 'fib_extension') {
            if (draftStep === 1) {
              return {
                ...prev,
                p2: anchor,
                p3: {
                  logical: anchor.logical + 6,
                  price: Number(((prev.p1.price + anchor.price) / 2).toFixed(activePairMeta.decimals)),
                },
              };
            }
            return {
              ...prev,
              p3: anchor,
            };
          }
          return {
            ...prev,
            p2: anchor,
          };
        });
      });
    }
  };

  const handleOverlayPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draftRafRef.current !== null) {
      window.cancelAnimationFrame(draftRafRef.current);
      draftRafRef.current = null;
    }
    pendingDraftPosRef.current = null;

    const drag = aimDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    aimDragRef.current = null;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore releasePointerCapture errors
    }

    if (activeDrawingTool === 'cursor') return;

    if (drag.moved) {
      // First touch finished positioning the crosshair -> transition to awaiting_confirmation
      setPlacementState('awaiting_confirmation');
      return;
    }

    // BAGIAN B1–B4: Second touch (confirmation tap anywhere on the chart area, `!drag.moved`)
    // MUST lock the drawing at the current crosshair domain coordinate (`crosshairAnchorRef.current`),
    // NEVER replacing the crosshair position with `drag.startX` / `drag.startY`!
    confirmDrawingPointWithAnchor(crosshairAnchorRef.current);
  };

  // Compute 3-row items (previous, active, next) for Pair Wheel & Timeframe Wheel
  const pairLen = WHEEL_PAIRS.length;
  const prevPairItem = WHEEL_PAIRS[(wheelPairIndex - 1 + pairLen) % pairLen];
  const activePairItem = WHEEL_PAIRS[wheelPairIndex] || WHEEL_PAIRS[0];
  const nextPairItem = WHEEL_PAIRS[(wheelPairIndex + 1) % pairLen];

  const tfLen = WHEEL_TIMEFRAMES.length;
  const prevTfItem = WHEEL_TIMEFRAMES[(wheelTfIndex - 1 + tfLen) % tfLen];
  const activeTfItem = WHEEL_TIMEFRAMES[wheelTfIndex] || WHEEL_TIMEFRAMES[3];
  const nextTfItem = WHEEL_TIMEFRAMES[(wheelTfIndex + 1) % tfLen];

  const displayedCandle = hoveredCandle || latestCandle;
  const isBullishCandle = displayedCandle ? displayedCandle.close >= displayedCandle.open : true;

  const pairDrawings = drawings.filter((d) => d.pair === activePairMeta.label);
  const pairDrawingsWithRuler =
    transientRulerDrawing && transientRulerDrawing.pair === activePairMeta.label
      ? [...pairDrawings, transientRulerDrawing]
      : pairDrawings;
  const allRenderedDrawings = draftDrawing
    ? [...pairDrawingsWithRuler, draftDrawing]
    : pairDrawingsWithRuler;
  const selectedDrawingObj =
    pairDrawingsWithRuler.find((d) => d.id === selectedDrawingId) || null;
  const activeToolDef: {
    id: ActiveDrawingToolId | 'ruler';
    name: string;
    pointsCount: 1 | 2 | 3;
  } | null =
    activeDrawingTool === 'ruler'
      ? { id: 'ruler', name: 'Penggaris (Pips & Bar)', pointsCount: 2 }
      : activeDrawingTool !== 'cursor'
        ? DRAWING_TOOLS_CATALOG.find((t) => t.id === activeDrawingTool) || null
        : null;

  // FEATURE 4: Active Journal Trade Lines (OPEN & PLANNED positions for current pair)
  const activeJournalOverlayLines = useMemo((): JournalOverlayTradeLine[] => {
    if (!prefs.studies.includes('JOURNAL_LINES')) return [];
    return extractActiveJournalOverlayLines(trades, activePairMeta.label);
  }, [prefs.studies, trades, activePairMeta.label]);

  interface MarketSessionBox {
    id: string;
    name: 'ASIA' | 'LONDON' | 'NEW YORK';
    subLabel: string;
    color: string;
    bgColor: string;
    borderColor: string;
    x: number;
    y: number;
    width: number;
    height: number;
    high: number;
    low: number;
  }

  interface MarketSessionSegment {
    id: string;
    name: 'ASIA' | 'LONDON' | 'NEW YORK';
    subLabel: string;
    color: string;
    bgColor: string;
    borderColor: string;
    startLogical: number;
    endLogical: number;
    high: number;
    low: number;
  }

  // Stage 1: Precompute static logical/price session segments ONLY when candle data or studies change (never on 60fps pan/zoom!)
  const marketSessionSegments = useMemo((): MarketSessionSegment[] => {
    if (!prefs.studies.includes('SESSION_BOX')) return [];
    const list =
      replayPhase === 'active'
        ? fullCandlesRef.current.slice(0, replayCutIndex + 1)
        : fullCandlesRef.current;
    if (list.length < 8) return [];

    const sampleStartIndex = Math.max(0, list.length - 180);
    const sample = list.slice(sampleStartIndex);

    type SessionDef = {
      name: 'ASIA' | 'LONDON' | 'NEW YORK';
      startHour: number;
      endHour: number;
      color: string;
      bgColor: string;
      borderColor: string;
      label: string;
    };

    const SESSIONS: SessionDef[] = [
      {
        name: 'ASIA',
        startHour: 0,
        endHour: 8,
        color: '#C084FC',
        bgColor: 'rgba(168, 85, 247, 0.08)',
        borderColor: 'rgba(168, 85, 247, 0.45)',
        label: '00:00 - 08:00 UTC',
      },
      {
        name: 'LONDON',
        startHour: 7,
        endHour: 16,
        color: '#38BDF8',
        bgColor: 'rgba(56, 189, 248, 0.08)',
        borderColor: 'rgba(56, 189, 248, 0.45)',
        label: '07:00 - 16:00 UTC',
      },
      {
        name: 'NEW YORK',
        startHour: 12,
        endHour: 21,
        color: '#F59E0B',
        bgColor: 'rgba(245, 158, 11, 0.08)',
        borderColor: 'rgba(245, 158, 11, 0.45)',
        label: '12:00 - 21:00 UTC',
      },
    ];

    const segments: MarketSessionSegment[] = [];

    for (const session of SESSIONS) {
      let currentSegStart: number | null = null;
      let currentHigh = -Infinity;
      let currentLow = Infinity;
      let currentDayKey = '';

      for (let i = 0; i < sample.length; i++) {
        const c = sample[i];
        const date = new Date(Number(c.time) * 1000);
        const utcHour = date.getUTCHours();
        const dayKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;

        const inSession = utcHour >= session.startHour && utcHour < session.endHour;

        if (inSession) {
          if (currentSegStart === null || currentDayKey !== dayKey) {
            if (currentSegStart !== null) {
              segments.push({
                id: `${session.name}_${currentDayKey}_${currentSegStart}`,
                name: session.name,
                subLabel: session.label,
                color: session.color,
                bgColor: session.bgColor,
                borderColor: session.borderColor,
                startLogical: sampleStartIndex + currentSegStart,
                endLogical: sampleStartIndex + i - 1,
                high: currentHigh,
                low: currentLow,
              });
            }
            currentSegStart = i;
            currentHigh = c.high;
            currentLow = c.low;
            currentDayKey = dayKey;
          } else {
            if (c.high > currentHigh) currentHigh = c.high;
            if (c.low < currentLow) currentLow = c.low;
          }
        } else if (currentSegStart !== null) {
          segments.push({
            id: `${session.name}_${currentDayKey}_${currentSegStart}`,
            name: session.name,
            subLabel: session.label,
            color: session.color,
            bgColor: session.bgColor,
            borderColor: session.borderColor,
            startLogical: sampleStartIndex + currentSegStart,
            endLogical: sampleStartIndex + i - 1,
            high: currentHigh,
            low: currentLow,
          });
          currentSegStart = null;
          currentHigh = -Infinity;
          currentLow = Infinity;
        }
      }

      if (currentSegStart !== null) {
        segments.push({
          id: `${session.name}_${currentDayKey}_${currentSegStart}`,
          name: session.name,
          subLabel: session.label,
          color: session.color,
          bgColor: session.bgColor,
          borderColor: session.borderColor,
          startLogical: sampleStartIndex + currentSegStart,
          endLogical: sampleStartIndex + sample.length - 1,
          high: currentHigh,
          low: currentLow,
        });
      }
    }

    return segments;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    prefs.studies,
    replayPhase,
    replayCutIndex,
    latestCandle,
    activeTfMeta.value,
    activePairMeta.symbol,
  ]);

  // Stage 2: Fast O(1) pixel projection of precomputed session segments on pan/zoom
  const marketSessionBoxes = useMemo((): MarketSessionBox[] => {
    if (marketSessionSegments.length === 0) return [];
    const boxes: MarketSessionBox[] = [];
    for (const seg of marketSessionSegments) {
      const p1 = convertAnchorToPixel({ logical: seg.startLogical, price: seg.high });
      const p2 = convertAnchorToPixel({ logical: seg.endLogical, price: seg.low });
      if (p1 && p2) {
        boxes.push({
          id: seg.id,
          name: seg.name,
          subLabel: seg.subLabel,
          color: seg.color,
          bgColor: seg.bgColor,
          borderColor: seg.borderColor,
          x: Math.min(p1.x, p2.x),
          y: Math.min(p1.y, p2.y),
          width: Math.max(12, Math.abs(p2.x - p1.x)),
          height: Math.max(6, Math.abs(p2.y - p1.y)),
          high: seg.high,
          low: seg.low,
        });
      }
    }
    return boxes;
  }, [marketSessionSegments, convertAnchorToPixel, svgRenderTick]);

  // Rule 4: When NOT actively drawing and NOT dragging an anchor handle, `<svg>` has `pointer-events-none`
  // (and `pointer-events-auto` only on rendered drawing lines/boxes/handles) so chart touch pan/zoom works freely!
  const isOverlayInteractive = activeDrawingTool !== 'cursor';

  const curtainX =
    replayGuideX !== null
      ? replayGuideX
      : Math.round((chartContainerRef.current?.clientWidth || 360) / 2);

  const safeAreaStyle: React.CSSProperties =
    displayMode === 'full' || displayMode === 'landscape'
      ? {
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }
      : {};

  // Filter tools for Bottom Sheet Menu "Gambar" based on active category tab
  const filteredSheetTools = DRAWING_TOOLS_CATALOG.filter((tool) => {
    if (drawingSheetTab === 'Favorit') {
      return favoriteTools.includes(tool.id);
    }
    if (drawingSheetTab === 'Peralatan') {
      return true;
    }
    return tool.tabCategory === drawingSheetTab;
  });

  // Compute Crosshair (Aiming Crosshair) anchor, price & WIB date/time labels from the authoritative domain anchor
  const aimAnchor =
    activeDrawingTool !== 'cursor'
      ? crosshairAnchor ??
        (aimCursorPos ? convertPixelToAnchor(aimCursorPos.x, aimCursorPos.y) : null)
      : null;
  const aimPriceText = aimAnchor
    ? aimAnchor.price.toFixed(activePairMeta.decimals)
    : latestCandle
      ? latestCandle.close.toFixed(activePairMeta.decimals)
      : '0.00';
  const aimTimeUnix =
    aimAnchor?.time ??
    (latestCandle ? Number(latestCandle.time) : Math.floor(Date.now() / 1000));
  const aimDateTimeText = formatWibDateTimeLabel(aimTimeUnix);

  // Visible candles for OHLC TP/SL evaluation (respects Bar Replay cut index when active)
  const visibleOhlcCandles = useMemo(() => {
    return replayPhase === 'active'
      ? fullCandlesRef.current.slice(0, replayCutIndex + 1)
      : fullCandlesRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayPhase, replayCutIndex, svgRenderTick, latestCandle]);

  // Build live ghost preview for 1-point tools while aiming so user sees exact line/box at Crosshair before confirming
  const singlePointPreviewDrawing = useMemo((): ChartDrawingObject | null => {
    if (activeDrawingTool === 'cursor' || draftDrawing || !aimAnchor) return null;
    if (activeDrawingTool === 'horizontal_line') {
      return {
        id: '__preview_single__',
        pair: activePairMeta.label,
        type: 'horizontal_line',
        p1: aimAnchor,
        p2: { logical: aimAnchor.logical + 25, price: aimAnchor.price, time: aimAnchor.time },
        color: '#2962FF',
        lineWidth: 2,
        dashed: true,
      };
    }
    if (activeDrawingTool === 'vertical_line') {
      return {
        id: '__preview_single__',
        pair: activePairMeta.label,
        type: 'vertical_line',
        p1: aimAnchor,
        p2: { logical: aimAnchor.logical, price: aimAnchor.price + activePairMeta.volatility * 2, time: aimAnchor.time },
        color: '#2962FF',
        lineWidth: 2,
        dashed: true,
      };
    }
    // Note: Buy/Sell tools ('long_position' & 'short_position') intentionally do NOT render a preview box during Touch 1.
    // Touch 1 only positions the aiming crosshair; Touch 2 places the Buy/Sell box centered on the Touch 1 crosshair coordinate.
    return null;
  }, [
    activeDrawingTool,
    draftDrawing,
    aimAnchor,
    activePairMeta.label,
    activePairMeta.volatility,
    activePairMeta.decimals,
  ]);

  // Compute session price change & percentage for Focused Trading Workspace header (Section C.1)
  const priceChangeMetrics = useMemo(() => {
    if (!displayedCandle) {
      return {
        changeAbs: 0,
        changePct: 0,
        formattedAbs: '+0.00',
        formattedPct: '+0.00%',
        isPositive: true,
      };
    }
    const candlesList = fullCandlesRef.current;
    const refIndex = Math.max(0, candlesList.length - 24);
    const refOpen =
      candlesList.length > 1 && candlesList[refIndex]
        ? candlesList[refIndex].open
        : displayedCandle.open;
    const baseOpen = refOpen > 0 ? refOpen : displayedCandle.open || 1;
    const rawDiff = displayedCandle.close - baseOpen;
    const rawPct = (rawDiff / baseOpen) * 100;
    const isPositive = rawDiff >= 0;
    const sign = isPositive ? '+' : '';
    return {
      changeAbs: rawDiff,
      changePct: rawPct,
      formattedAbs: `${sign}${rawDiff.toFixed(activePairMeta.decimals)}`,
      formattedPct: `${sign}${rawPct.toFixed(2)}%`,
      isPositive,
    };
  }, [displayedCandle, activePairMeta.decimals]);

  return (
    <section
      ref={viewportRef}
      data-testid="market-chart-view"
      data-display-mode={displayMode}
      aria-label="Market Chart TradingView"
      style={{
        position: 'fixed',
        top: workspaceLayout.top,
        left: workspaceLayout.left,
        width: `${workspaceLayout.width}px`,
        height: `${workspaceLayout.height}px`,
        zIndex: workspaceLayout.zIndex,
        backgroundColor: isDark ? '#000000' : '#FFFFFF',
        ...safeAreaStyle,
      }}
      className="fixed flex flex-col min-h-0 min-w-0 overflow-hidden overscroll-none bg-white dark:bg-black"
    >
      {/* =====================================================================
          FOCUSED TRADING WORKSPACE HEADER (TradingView Institutional Style)
          - Clean charcoal surface (#131722), zero neon glow, tabular metrics
          ===================================================================== */}
      {!hideTopSubBar && (
        <div
          data-testid="chart-top-sub-bar"
          className={`${
            isLiveMode ? 'h-9 sm:h-10' : 'h-10'
          } shrink-0 w-full bg-[#131722] border-b border-white/[0.07] px-2.5 sm:px-3.5 flex items-center justify-between gap-2 z-30 select-none`}
        >
          {/* Left Cluster: Status Dot + Symbol & Instrument Name + Last Price + Change (%) + Status */}
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <div className="flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                {/* Clean Solid Status Dot (Zero Neon Glow) */}
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    isMarketOpen ? 'bg-[#089981]' : 'bg-[#787B86]'
                  }`}
                />

                {/* Active Symbol & Timeframe */}
                <span
                  data-testid="chart-header-symbol-label"
                  className="text-xs font-bold text-[#F8FAFC] tracking-tight whitespace-nowrap"
                >
                  {activePairItem.label} · {activeTfItem.label}
                </span>

                {/* Instrument Name (Visible on Tablet & Desktop) */}
                <span
                  data-testid="chart-header-instrument-name"
                  className="hidden md:inline text-[10px] font-medium text-[#787B86] truncate max-w-[150px] lg:max-w-[220px]"
                >
                  {activePairItem.sourceLabel}
                </span>

                {/* Last Price + Change & Percentage (TradingView #089981 / #F23645) */}
                {displayedCandle && (
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span
                      data-testid="chart-header-last-price"
                      className={`text-xs font-bold font-mono-numbers tabular-nums ${
                        displayedCandle.close >= displayedCandle.open
                          ? 'text-[#089981]'
                          : 'text-[#F23645]'
                      }`}
                    >
                      {displayedCandle.close.toFixed(activePairMeta.decimals)}
                    </span>

                    <span
                      data-testid="chart-header-price-change"
                      className={`text-[10px] font-semibold font-mono-numbers tabular-nums ${
                        priceChangeMetrics.isPositive
                          ? 'text-[#089981]'
                          : 'text-[#F23645]'
                      }`}
                    >
                      <span className="hidden sm:inline">{priceChangeMetrics.formattedAbs} </span>
                      <span>({priceChangeMetrics.formattedPct})</span>
                    </span>
                  </div>
                )}

                {/* Status Label (REPLAY / LIVE / TUTUP — Clean Institutional Badge) + Real-Time Bar Countdown */}
                {replayPhase !== 'off' ? (
                  <span
                    data-testid="chart-replay-status-badge"
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#2A2E39] text-[8px] font-bold tracking-wider text-[#D1D4DC] shrink-0"
                  >
                    REPLAY
                  </span>
                ) : isMarketOpen ? (
                  <>
                    <span
                      data-testid="chart-live-status-badge"
                      className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#1E222D] text-[8px] font-semibold tracking-wider text-[#868993] shrink-0"
                    >
                      LIVE
                    </span>
                    <CandleCountdownBadge
                      intervalSeconds={activeTfMeta.seconds}
                      isMarketOpen={isMarketOpen}
                      isReplayActive={replayPhase !== 'off'}
                    />
                  </>
                ) : (
                  <span
                    data-testid="chart-closed-status-badge"
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#1E222D] text-[8px] font-semibold tracking-wider text-[#868993] shrink-0"
                    title={tr(
                      'Pasar Forex & Emas tutup pada akhir pekan (Sabtu-Minggu). Data candle membeku di penutupan Jumat.',
                      'Forex & Gold markets are closed on weekends (Sat-Sun). Candle data is frozen at Friday close.'
                    )}
                  >
                    {tr('TUTUP', 'CLOSED')}
                  </span>
                )}

                {/* Active Study Short Labels (Only in Replay Mode) */}
                {isReplayMode &&
                  prefs.studies.map((studyId) => {
                    const meta = STUDY_PRESETS.find((s) => s.id === studyId);
                    if (!meta) return null;
                    return (
                      <span
                        key={studyId}
                        style={{ color: meta.color }}
                        className="hidden sm:inline text-[9px] font-semibold tracking-tight"
                      >
                        {meta.shortLabel}
                      </span>
                    );
                  })}
              </div>

              {/* Micro O · H · L · C row — shown in Replay Mode */}
              {isReplayMode && displayedCandle && (
                <div className="flex items-center gap-1.5 text-[9px] text-[#787B86] font-mono-numbers tabular-nums truncate leading-tight">
                  <span>
                    O <strong className="text-[#D1D4DC] font-medium">{displayedCandle.open.toFixed(activePairMeta.decimals)}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    H <strong className="text-[#D1D4DC] font-medium">{displayedCandle.high.toFixed(activePairMeta.decimals)}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    L <strong className="text-[#D1D4DC] font-medium">{displayedCandle.low.toFixed(activePairMeta.decimals)}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    C <strong className="text-[#F8FAFC] font-semibold">{displayedCandle.close.toFixed(activePairMeta.decimals)}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right Cluster: Focus Exit Button + Clean Segmented Mode Switcher (Live vs Replay) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {displayMode !== 'normal' && (
              <button
                type="button"
                data-testid="header-exit-focus-btn"
                onClick={() => {
                  setDisplayMode('normal');
                  saveStoredDisplayMode('normal');
                  setHideTopSubBar(false);
                  measureViewportAndBounds();
                }}
                title={tr('Keluar dari Mode Fokus / Layar Penuh', 'Exit Focus / Fullscreen Mode')}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-[#2A2E39] hover:bg-[#363A45] border border-white/10 text-[10px] font-semibold text-white transition-colors cursor-pointer touch-manipulation"
              >
                <Minimize2 className="h-3 w-3 text-[#D1D4DC]" />
                <span className="hidden xs:inline sm:inline">{tr('Keluar Fokus', 'Exit Focus')}</span>
              </button>
            )}

            <div
              data-testid="chart-engine-mode-switcher"
              className="bg-[#0B0E14] p-0.5 rounded-md border border-white/[0.08] flex items-center shrink-0"
            >
              <button
                type="button"
                data-testid="engine-mode-live-oanda-btn"
                onClick={() => {
                  if (replayPhase !== 'off') {
                    handleExitReplayMode();
                  }
                  setShowDrawingToolbar(false);
                  setIsIndicatorsOpen(false);
                  setActiveDrawingTool('cursor');
                  handleSetChartEngineMode('live_oanda');
                }}
                title="Live Advanced Chart (TradingView Resmi)"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold tracking-tight transition-colors cursor-pointer touch-manipulation ${
                  isLiveMode
                    ? 'bg-[#2A2E39] text-white'
                    : 'text-[#787B86] hover:text-[#D1D4DC]'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isLiveMode ? 'bg-[#089981]' : 'bg-[#787B86]'
                  }`}
                />
                <span>Live</span>
              </button>

              <button
                type="button"
                data-testid="engine-mode-replay-studio-btn"
                onClick={() => handleSetChartEngineMode('replay_studio')}
                title="Light Chart & Replay Studio (Data Candle Twelve Data)"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-semibold tracking-tight transition-colors cursor-pointer touch-manipulation ${
                  isReplayMode
                    ? 'bg-[#2A2E39] text-white'
                    : 'text-[#787B86] hover:text-[#D1D4DC]'
                }`}
              >
                <Scissors className="h-3 w-3" />
                <span>Replay</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flex-1 Chart Viewport Container — Maximum Candlestick Area (flex-1 min-h-0 min-w-0) */}
      <div
        data-testid="market-chart-viewport"
        onMouseMove={isReplayMode && isSelectingCutPoint ? handleCutterMouseMove : undefined}
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          minWidth: 0,
          touchAction: 'none',
          WebkitOverflowScrolling: 'touch',
          pointerEvents: 'auto',
        }}
        className="relative flex-1 flex flex-col w-full h-full min-h-0 min-w-0 overflow-hidden bg-white dark:bg-black touch-none"
      >
        {/* SECTION A.1 & A.5: Persistent Single-Iframe Live Advanced Chart Container
            Pinned to 100% absolute bounds of market-chart-viewport. Never collapsed to 0x0 on mode switch. */}
        <div
          data-testid="live-oanda-widget-overlay"
          aria-hidden={!isLiveMode}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            visibility: isLiveMode ? 'visible' : 'hidden',
            opacity: isLiveMode ? 1 : 0,
            zIndex: isLiveMode ? 10 : -1,
            touchAction: 'none',
            pointerEvents: isLiveMode ? 'auto' : 'none',
          }}
          className={
            isLiveMode
              ? 'absolute inset-0 w-full h-full z-10 bg-white dark:bg-black overflow-hidden overscroll-none touch-none'
              : 'absolute inset-0 w-full h-full -z-10 opacity-0 invisible pointer-events-none overflow-hidden touch-none'
          }
        >
          <TradingViewOandaWidget
            symbol={prefs.symbol}
            interval={prefs.interval}
            theme={isDark ? 'dark' : 'light'}
            locale={isEn ? 'en' : 'id'}
            candleColorStyle={prefs.candleColorStyle}
            showLiveDrawingTools={showLiveDrawingTools}
            isLiveCleanView={isLiveCleanView}
            isActive={isActive && isLiveMode}
          />
        </div>

        {/* Lightweight Charts Mount Host (Hidden & isolated from DOM layout when in Live Mode) */}
        <div
          ref={chartContainerRef}
          data-testid="tradingview-widget-host"
          onClick={(e) => handleEmptyChartTapOrClick(e.target as HTMLElement | null)}
          className={
            isLiveMode
              ? 'hidden pointer-events-none'
              : 'relative flex-1 w-full h-full min-h-0 min-w-0 overflow-hidden bg-white dark:bg-black overscroll-none transform-gpu'
          }
        />

        {/* BAGIAN 2.1: Tanda Air (Watermark) Disembunyikan (visible: false) */}
        <div
          data-testid="tradingview-watermark"
          aria-hidden="true"
          className="hidden opacity-0 pointer-events-none select-none"
        />

        {/* =====================================================================
            BAGIAN 1: REPLAY MODE EXCLUSIVE OVERLAYS & TOOLS (Unmounted in Live Mode)
            ===================================================================== */}
        {isReplayMode && (
          <>
            {/* FLOATING REPLAY CONTROL BAR (Clean TradingView Charcoal Surface #131722) */}
            {replayPhase !== 'off' && (
              <div
                data-testid="chart-replay-floating-bar"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 h-8 bg-[#131722]/95 border border-white/10 rounded-lg px-2.5 shadow-xl flex items-center gap-1 text-[#D1D4DC] select-none"
              >
                {isSelectingCutPoint ? (
                  <>
                    <button
                      type="button"
                      data-testid="replay-confirm-cut-btn"
                      onClick={handleConfirmReplayCut}
                      className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded bg-[#2A2E39] hover:bg-[#363A45] border border-white/15 text-white text-[10px] font-semibold transition-colors cursor-pointer touch-manipulation"
                    >
                      <Scissors className="h-3 w-3 stroke-[2]" />
                      <span>{tr('Potong di Sini', 'Cut Here')}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="replay-cancel-cut-btn"
                      onClick={handleCancelCutSelection}
                      aria-label={tr('Batal Replay', 'Cancel Replay')}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[#1E222D] hover:bg-[#2A2E39] text-[10px] font-medium text-[#868993] hover:text-white transition-colors cursor-pointer touch-manipulation"
                    >
                      <span>{tr('Batal', 'Cancel')}</span>
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  isReplayActive && (
                    <>
                      {/* Re-Pick Cut Point Button */}
                      <button
                        type="button"
                        data-testid="replay-repick-cut-btn"
                        onClick={() => {
                          setIsReplayPlaying(false);
                          const chart = chartApiRef.current;
                          const allCandles = fullCandlesRef.current;
                          if (chart && allCandles.length > 0) {
                            const cutX = chart
                              .timeScale()
                              .logicalToCoordinate(replayCutIndex as Logical);
                            updateSeriesWithoutJumping(allCandles, allCandles.length - 1);
                            const containerWidth = chartContainerRef.current?.clientWidth || 360;
                            setReplayGuideX(
                              cutX !== null
                                ? Math.max(16, Math.min(containerWidth - 52, Math.round(Number(cutX))))
                                : Math.round(containerWidth / 2)
                            );
                          }
                          setReplayPhase('selecting_cut');
                        }}
                        title="Pilih ulang titik potong"
                        className="inline-flex items-center justify-center h-6 w-6 rounded text-[#868993] hover:text-white hover:bg-[#1E222D] cursor-pointer"
                      >
                        <Scissors className="h-3.5 w-3.5" />
                      </button>

                      {/* Play / Pause Button */}
                      <button
                        type="button"
                        data-testid="replay-play-pause-btn"
                        onClick={() => setIsReplayPlaying((prev) => !prev)}
                        aria-label={isReplayPlaying ? 'Pause Replay' : 'Play Replay'}
                        title={isReplayPlaying ? 'Pause Replay' : 'Play Replay'}
                        className="inline-flex items-center justify-center h-6 w-6 rounded bg-[#2A2E39] hover:bg-[#363A45] border border-white/10 text-white cursor-pointer"
                      >
                        {isReplayPlaying ? (
                          <Pause className="h-3 w-3 fill-current" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                      </button>

                      {/* Step Forward (+1 Candle) Button */}
                      <button
                        type="button"
                        data-testid="replay-step-forward-btn"
                        onClick={() => {
                          setIsReplayPlaying(false);
                          handleStepForwardOneCandle();
                        }}
                        disabled={replayCutIndex >= totalCandlesCount - 1}
                        title="Step Forward (+1 Candle)"
                        className="inline-flex items-center gap-0.5 h-6 px-2 rounded bg-[#1E222D] hover:bg-[#2A2E39] border border-white/10 text-[10px] font-semibold text-[#D1D4DC] hover:text-white disabled:opacity-35 cursor-pointer"
                      >
                        <SkipForward className="h-3 w-3" />
                        <span>+1</span>
                      </button>

                      {/* Speed Selector (1x, 2x, 5x) */}
                      {([1, 2, 5] as const).map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          data-testid={`replay-speed-${spd}x`}
                          onClick={() => setReplaySpeed(spd)}
                          className={`h-6 px-1.5 rounded text-[10px] font-semibold font-mono-numbers tabular-nums transition-colors cursor-pointer ${
                            replaySpeed === spd
                              ? 'bg-[#2A2E39] text-white border border-white/15'
                              : 'text-[#868993] hover:text-white hover:bg-[#1E222D]'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}

                      {/* Exit Replay Button */}
                      <button
                        type="button"
                        data-testid="replay-exit-btn"
                        onClick={handleExitReplayMode}
                        aria-label="Keluar Replay"
                        title="Keluar Replay & Kembali ke Live"
                        className="inline-flex items-center justify-center h-6 w-6 rounded text-[#868993] hover:text-[#F23645] hover:bg-[#1E222D] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )
                )}
              </div>
            )}

            {/* ACTIVE DRAWING TOOL INSTRUCTION BANNER (Minimalist Institutional Bar) */}
            {activeToolDef && (
              <div
                data-testid="active-drawing-tool-banner"
                data-placement-state={placementState}
                className="absolute top-11 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#131722]/95 border border-white/10 text-[#D1D4DC] shadow-xl select-none"
              >
                <span className="text-white">{renderTradingViewDrawingIcon(activeToolDef.id, 'w-4 h-4')}</span>
                <span className="text-[11px] font-medium tracking-tight text-[#D1D4DC]">
                  {translateToolName(activeToolDef.name)}
                  {activeToolDef.pointsCount === 1
                    ? tr(
                        ' · Geser crosshair lalu ketuk konfirmasi',
                        ' · Move crosshair then tap confirm'
                      )
                    : ` · ${tr('Titik', 'Point')} ${draftStep + 1}/${activeToolDef.pointsCount}`}
                </span>
                <button
                  type="button"
                  data-testid="drawing-banner-magnet-btn"
                  onClick={toggleMagnetMode}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors cursor-pointer ${
                    isMagnetActive
                      ? 'bg-[#2A2E39] text-white border border-white/15'
                      : 'bg-[#1E222D] text-[#868993] hover:text-white border border-white/5'
                  }`}
                  title={tr(
                    'Snap ke Titik OHLC Candle (High, Low, Open, Close)',
                    'Snap to Candle OHLC (High, Low, Open, Close)'
                  )}
                >
                  <Magnet className="h-3 w-3" />
                  <span>{isMagnetActive ? tr('Magnet Aktif', 'Magnet ON') : tr('Magnet Mati', 'Magnet OFF')}</span>
                </button>
                <button
                  type="button"
                  data-testid="drawing-banner-cancel-btn"
                  onClick={cancelActiveDrawingPlacement}
                  className="ml-0.5 inline-flex items-center justify-center h-5 w-5 rounded bg-[#1E222D] hover:bg-[#2A2E39] text-[#868993] hover:text-white border border-white/10 cursor-pointer"
                  title={tr('Batal menggambar (Esc)', 'Cancel drawing (Esc)')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* CONTEXTUAL FLOATING BAR FOR SELECTED DRAWING OBJECT (Draggable TradingView Style & Setting Bar) */}
            {selectedDrawingObj && activeDrawingTool === 'cursor' && (
              <div
                data-testid="drawing-object-style-bar"
                data-settings-open={isDrawingSettingsOpen ? 'true' : 'false'}
                style={
                  styleBarPos
                    ? { left: `${styleBarPos.x}px`, top: `${styleBarPos.y}px`, transform: 'none' }
                    : { top: '44px', left: '50%', transform: 'translateX(-50%)' }
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="absolute z-30 flex flex-col gap-1.5 px-2 py-1 rounded-lg bg-[#131722]/95 border border-white/10 text-[#D1D4DC] shadow-xl select-none max-w-[96vw]"
              >
                <div className="flex items-center gap-1 flex-wrap">
                  {/* Draggable Grip Handle */}
                  <div
                    data-testid="drawing-style-bar-drag-handle"
                    onPointerDown={handleStyleBarDragStart}
                    onPointerMove={handleStyleBarDragMove}
                    onPointerUp={handleStyleBarDragEnd}
                    onPointerCancel={handleStyleBarDragEnd}
                    title="Geser Bar Pengaturan"
                    className="flex items-center justify-center h-6 w-4 text-[#787B86] hover:text-[#D1D4DC] cursor-grab active:cursor-grabbing touch-none select-none"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </div>

                  {/* TradingView-Style Toggle Setting Button (Opens/Closes Full Settings & Position Inputs) */}
                  <button
                    type="button"
                    data-testid="drawing-settings-toggle-btn"
                    onClick={() => setIsDrawingSettingsOpen((prev) => !prev)}
                    title={isDrawingSettingsOpen ? 'Tutup Pengaturan Objek' : 'Buka Pengaturan Objek'}
                    className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                      isDrawingSettingsOpen
                        ? 'bg-[#2A2E39] text-white border border-white/20'
                        : 'bg-[#1E222D] text-[#D1D4DC] hover:text-white border border-white/10'
                    }`}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    <span>Setting</span>
                  </button>

                  {isDrawingSettingsOpen && (
                    <>
                      {/* Color Swatches */}
                      <div className="flex items-center gap-1 pl-1 pr-1.5 border-l border-r border-white/10">
                        {DRAWING_COLOR_SWATCHES.map((hex) => {
                          const currentHex = selectedDrawingObj.color || '#2962FF';
                          const isSelectedColor = currentHex.toUpperCase() === hex.toUpperCase();
                          return (
                            <button
                              key={hex}
                              type="button"
                              data-testid={`drawing-color-${hex.slice(1)}`}
                              onClick={() =>
                                updateExistingDrawing(selectedDrawingObj.id, (prev) => ({
                                  ...prev,
                                  color: hex,
                                }))
                              }
                              className={`h-4 w-4 rounded-full transition-transform cursor-pointer ${
                                isSelectedColor ? 'scale-115 ring-1.5 ring-white' : 'opacity-80 hover:opacity-100'
                              }`}
                              style={{ backgroundColor: hex }}
                              title={`Warna ${hex}`}
                            />
                          );
                        })}
                      </div>

                      {/* Line Width Selector (1px, 2px, 3px) */}
                      <div className="flex items-center gap-0.5 pr-1.5 border-r border-white/10">
                        {([1, 2, 3] as const).map((wVal) => {
                          const curW = selectedDrawingObj.lineWidth ?? 2;
                          return (
                            <button
                              key={wVal}
                              type="button"
                              data-testid={`drawing-linewidth-${wVal}`}
                              onClick={() =>
                                updateExistingDrawing(selectedDrawingObj.id, (prev) => ({
                                  ...prev,
                                  lineWidth: wVal,
                                }))
                              }
                              title={`Ketebalan Garis ${wVal}px`}
                              className={`h-6 px-1.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                                curW === wVal
                                  ? 'bg-[#2A2E39] text-white border border-white/15'
                                  : 'bg-[#1E222D] text-[#868993] hover:text-white'
                              }`}
                            >
                              {wVal}px
                            </button>
                          );
                        })}
                      </div>

                      {/* Toggle Dashed / Solid Line */}
                      <button
                        type="button"
                        data-testid="drawing-style-dashed-btn"
                        onClick={() =>
                          updateExistingDrawing(selectedDrawingObj.id, (prev) => ({
                            ...prev,
                            dashed: !prev.dashed,
                          }))
                        }
                        title={selectedDrawingObj.dashed ? 'Garis Sambung (Solid)' : 'Garis Putus-Putus (Dashed)'}
                        className={`h-6 px-2 rounded text-[10px] font-semibold tracking-wider transition-colors cursor-pointer ${
                          selectedDrawingObj.dashed
                            ? 'bg-[#2A2E39] text-white border border-white/15'
                            : 'bg-[#1E222D] text-[#868993] hover:text-white'
                        }`}
                      >
                        - - -
                      </button>

                      {/* Sync Position Drawing to Trade Log Form or Direct Order Submission */}
                      {(selectedDrawingObj.type === 'long_position' ||
                        selectedDrawingObj.type === 'long' ||
                        selectedDrawingObj.type === 'short_position' ||
                        selectedDrawingObj.type === 'short') && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            data-testid="drawing-sync-to-tradelog-btn"
                            onClick={() => handleCreateTradeFromSelectedPosition(selectedDrawingObj)}
                            title={tr(
                              'Buka Form Catat Trade dengan data Entry, SL, dan TP ini',
                              'Open Log Trade Form with this Entry, SL, and TP data'
                            )}
                            className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[#2A2E39] hover:bg-[#363A45] border border-white/15 text-white text-[10px] font-semibold transition-colors cursor-pointer"
                          >
                            <PlusCircle className="h-3 w-3" />
                            <span>{tr('Catat Trade', 'Log Trade')}</span>
                          </button>
                          <button
                            type="button"
                            data-testid="drawing-open-position-direct-btn"
                            onClick={() => handleCreateTradeFromSelectedPosition(selectedDrawingObj)}
                            title={tr(
                              'Eksekusi Posisi Baru langsung ke Jurnal VLO',
                              'Execute New Position directly to VLO Journal'
                            )}
                            className={`inline-flex items-center gap-1 h-6 px-2 rounded text-white text-[10px] font-bold transition-colors cursor-pointer shadow-sm ${
                              selectedDrawingObj.type === 'long_position' || selectedDrawingObj.type === 'long'
                                ? 'bg-[#089981] hover:bg-[#077f6c]'
                                : 'bg-[#F23645] hover:bg-[#d92837]'
                            }`}
                          >
                            <span>
                              {selectedDrawingObj.type === 'long_position' || selectedDrawingObj.type === 'long'
                                ? tr('Buka Buy', 'Open Buy')
                                : tr('Buka Sell', 'Open Sell')}
                            </span>
                          </button>
                        </div>
                      )}

                      {/* Lock / Unlock Position */}
                      <button
                        type="button"
                        data-testid="drawing-style-lock-btn"
                        onClick={() =>
                          updateExistingDrawing(selectedDrawingObj.id, (prev) => ({
                            ...prev,
                            locked: !prev.locked,
                          }))
                        }
                        title={selectedDrawingObj.locked ? 'Buka Kunci Posisi' : 'Kunci Posisi Gambar'}
                        className={`inline-flex items-center justify-center h-6 w-6 rounded transition-colors cursor-pointer ${
                          selectedDrawingObj.locked
                            ? 'bg-[#2A2E39] text-white border border-white/20'
                            : 'bg-[#1E222D] text-[#868993] hover:text-white'
                        }`}
                      >
                        {selectedDrawingObj.locked ? (
                          <Lock className="h-3.5 w-3.5" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </>
                  )}

                  {/* Delete Selected Drawing */}
                  <button
                    type="button"
                    data-testid="drawing-style-delete-btn"
                    onClick={handleDeleteSelectedDrawing}
                    title="Hapus Gambar Ini"
                    className="inline-flex items-center justify-center h-6 w-6 rounded bg-[#1E222D] hover:bg-[#F23645]/20 text-[#868993] hover:text-[#F23645] transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  {/* Deselect (X) */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDrawingId(null);
                      setIsDrawingSettingsOpen(false);
                    }}
                    title="Tutup"
                    className="inline-flex items-center justify-center h-6 w-6 rounded text-[#868993] hover:text-white cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* BAGIAN A4: Contextual Position Inspector (Shown only when Toggle Setting is opened) */}
                {isDrawingSettingsOpen &&
                  (selectedDrawingObj.type === 'long_position' ||
                    selectedDrawingObj.type === 'long' ||
                    selectedDrawingObj.type === 'short_position' ||
                    selectedDrawingObj.type === 'short') && (() => {
                  const isLongSelected =
                    selectedDrawingObj.type === 'long_position' || selectedDrawingObj.type === 'long';
                  const norm = normalizePositionPrices(
                    isLongSelected,
                    selectedDrawingObj.p1.price,
                    selectedDrawingObj.slPrice,
                    selectedDrawingObj.tpPrice,
                    activePairMeta.volatility,
                    activePairMeta.decimals
                  );
                  const ohlcEval = evaluatePositionOhlcStatus(
                    {
                      ...selectedDrawingObj,
                      p1: { ...selectedDrawingObj.p1, price: norm.entryPrice },
                      slPrice: norm.slPrice,
                      tpPrice: norm.tpPrice,
                    },
                    visibleOhlcCandles,
                    undefined,
                    activeTimeframeSeconds
                  );
                  const statusBadgeStyle =
                    ohlcEval.status === 'TP_HIT'
                      ? 'bg-[#089981]/20 text-[#089981] border-[#089981]/40'
                      : ohlcEval.status === 'SL_HIT'
                        ? 'bg-[#F23645]/20 text-[#F23645] border-[#F23645]/40'
                        : ohlcEval.status === 'AMBIGUOUS'
                          ? 'bg-[#2A2E39] text-[#F59E0B] border-white/15'
                          : 'bg-[#1E222D] text-[#D1D4DC] border-white/10';
                  const inspectorPair = selectedDrawingObj.pair || activePairMeta.label;
                  const xauPipSz = settings?.xauusdPipSize ?? 0.1;
                  const slPipsInfo = computePositionPips(norm.entryPrice, norm.slPrice, inspectorPair, xauPipSz);
                  const tpPipsInfo = computePositionPips(norm.entryPrice, norm.tpPrice, inspectorPair, xauPipSz);
                  const sizingInfo = computeRecommendedPositionSizing(
                    norm.entryPrice,
                    norm.slPrice,
                    inspectorPair,
                    currentEquity ?? settings?.startingBalance ?? 10000,
                    settings?.defaultRiskPercent ?? 1,
                    settings?.xauusdPipValuePer001Lot ?? 0.1,
                    xauPipSz
                  );

                  return (
                    <div
                      data-testid="selected-position-inspector"
                      className="flex items-center gap-1.5 pt-1 border-t border-white/10 text-[10px] font-mono-numbers tabular-nums flex-wrap"
                    >
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          isLongSelected
                            ? 'bg-[#089981]/20 text-[#089981]'
                            : 'bg-[#F23645]/20 text-[#F23645]'
                        }`}
                      >
                        {isLongSelected ? 'BUY' : 'SELL'}
                      </span>

                      <label className="flex items-center gap-1 text-[#868993]">
                        <span>Entry</span>
                        <input
                          type="number"
                          step="any"
                          disabled={selectedDrawingObj.locked}
                          data-testid="position-input-entry"
                          value={norm.entryPrice}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!Number.isFinite(val)) return;
                            updateExistingDrawing(selectedDrawingObj.id, (prev) => {
                              const nextNorm = normalizePositionPrices(
                                isLongSelected,
                                val,
                                prev.slPrice,
                                prev.tpPrice,
                                activePairMeta.volatility,
                                activePairMeta.decimals
                              );
                              return {
                                ...prev,
                                p1: { ...prev.p1, price: nextNorm.entryPrice },
                                p2: { ...prev.p2, price: nextNorm.entryPrice },
                                slPrice: nextNorm.slPrice,
                                tpPrice: nextNorm.tpPrice,
                                hitStatus: undefined,
                                hitTime: undefined,
                                hitPrice: undefined,
                                entryHitTime: undefined,
                              };
                            });
                          }}
                          className="w-16 px-1 py-0.5 rounded bg-[#1E222D] border border-white/10 text-white text-[10px]"
                        />
                      </label>

                      <label className="flex items-center gap-1 text-[#F23645]">
                        <span>SL</span>
                        <input
                          type="number"
                          step="any"
                          disabled={selectedDrawingObj.locked}
                          data-testid="position-input-sl"
                          value={norm.slPrice}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!Number.isFinite(val)) return;
                            updateExistingDrawing(selectedDrawingObj.id, (prev) => {
                              const nextNorm = normalizePositionPrices(
                                isLongSelected,
                                prev.p1.price,
                                val,
                                prev.tpPrice,
                                activePairMeta.volatility,
                                activePairMeta.decimals
                              );
                              return {
                                ...prev,
                                slPrice: nextNorm.slPrice,
                                hitStatus: undefined,
                                hitTime: undefined,
                                hitPrice: undefined,
                              };
                            });
                          }}
                          className="w-16 px-1 py-0.5 rounded bg-[#1E222D] border border-white/10 text-white text-[10px]"
                        />
                        <span
                          data-testid="position-inspector-sl-pips"
                          className="text-[9.5px] font-semibold text-[#F23645] whitespace-nowrap"
                        >
                          ({slPipsInfo.formattedPips})
                        </span>
                      </label>

                      <label className="flex items-center gap-1 text-[#089981]">
                        <span>TP</span>
                        <input
                          type="number"
                          step="any"
                          disabled={selectedDrawingObj.locked}
                          data-testid="position-input-tp"
                          value={norm.tpPrice}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!Number.isFinite(val)) return;
                            updateExistingDrawing(selectedDrawingObj.id, (prev) => {
                              const nextNorm = normalizePositionPrices(
                                isLongSelected,
                                prev.p1.price,
                                prev.slPrice,
                                val,
                                activePairMeta.volatility,
                                activePairMeta.decimals
                              );
                              return {
                                ...prev,
                                tpPrice: nextNorm.tpPrice,
                                hitStatus: undefined,
                                hitTime: undefined,
                                hitPrice: undefined,
                              };
                            });
                          }}
                          className="w-16 px-1 py-0.5 rounded bg-[#1E222D] border border-white/10 text-white text-[10px]"
                        />
                        <span
                          data-testid="position-inspector-tp-pips"
                          className="text-[9.5px] font-semibold text-[#089981] whitespace-nowrap"
                        >
                          ({tpPipsInfo.formattedPips})
                        </span>
                      </label>

                      <span
                        data-testid="position-inspector-rr"
                        className="px-1.5 py-0.5 rounded bg-[#1E222D] border border-white/10 text-[#D1D4DC] font-semibold"
                      >
                        R:R 1:{norm.rrRatio}
                      </span>

                      <span
                        data-testid="position-inspector-lot-recommendation"
                        title="Rekomendasi Lot Ideal sesuai Equity & Risiko Jurnal VLO"
                        className="px-1.5 py-0.5 rounded bg-[#2962FF]/15 border border-[#2962FF]/35 text-[#60A5FA] font-semibold whitespace-nowrap"
                      >
                        Lot Ideal: {sizingInfo.recommendedLot.toFixed(2)} Lot (${sizingInfo.riskAmountUsd.toFixed(0)} · {sizingInfo.riskPercent}%)
                      </span>

                      <span
                        data-testid="position-inspector-status"
                        data-status-code={ohlcEval.status}
                        className={`px-1.5 py-0.5 rounded border font-bold ${statusBadgeStyle}`}
                      >
                        {ohlcEval.label}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* COMPACT CONTEXTUAL FLOATING FAVORITES TOOLBAR (TradingView Charcoal #131722, Zero Neon) */}
            {showFavoritesOnChart && favoriteTools.length > 0 && (
              <div
                data-testid="chart-floating-favorites-toolbar"
                style={{
                  left: `${favToolbarPos.x}px`,
                  top: `${favToolbarPos.y}px`,
                }}
                className="absolute z-20 flex items-center gap-0.5 bg-[#131722]/95 border border-white/10 rounded-lg px-1.5 py-1 text-[#D1D4DC] shadow-xl select-none touch-none"
              >
                {/* 6-Dot Drag Handle (GripVertical) */}
                <div
                  data-testid="floating-favorites-drag-handle"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    favDragStartRef.current = {
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: favToolbarPos.x,
                      origY: favToolbarPos.y,
                    };
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      // Ignore capture error
                    }
                  }}
                  onPointerMove={(e) => {
                    const drag = favDragStartRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const container = chartContainerRef.current;
                    const maxW = (container?.clientWidth || 360) - 80;
                    const maxH = (container?.clientHeight || 480) - 44;
                    const nextX = Math.max(4, Math.min(maxW, drag.origX + (e.clientX - drag.startClientX)));
                    const nextY = Math.max(4, Math.min(maxH, drag.origY + (e.clientY - drag.startClientY)));
                    setFavToolbarPos({ x: Math.round(nextX), y: Math.round(nextY) });
                  }}
                  onPointerUp={(e) => {
                    if (favDragStartRef.current?.pointerId === e.pointerId) {
                      favDragStartRef.current = null;
                    }
                  }}
                  title="Geser Toolbar Favorit"
                  className="flex items-center justify-center h-6 w-4 text-[#787B86] hover:text-[#D1D4DC] cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </div>

                {!isFavToolbarCollapsed && (
                  <>
                    {/* Cursor / Pan Mode Button */}
                    <button
                      type="button"
                      data-testid="fav-toolbar-cursor-btn"
                      onClick={cancelActiveDrawingPlacement}
                      title="Mode Geser Chart"
                      className={`inline-flex items-center justify-center h-6 w-6 rounded transition-colors cursor-pointer ${
                        activeDrawingTool === 'cursor'
                          ? 'bg-[#2A2E39] text-white border border-white/15'
                          : 'text-[#868993] hover:text-white hover:bg-[#1E222D]'
                      }`}
                    >
                      <MousePointer className="h-3.5 w-3.5" />
                    </button>

                    {/* Magnet Mode Toggle Button */}
                    <button
                      type="button"
                      data-testid="fav-toolbar-magnet-btn"
                      onClick={toggleMagnetMode}
                      title={isMagnetActive ? 'Magnet Aktif (Snap ke OHLC)' : 'Magnet Mati'}
                      className={`inline-flex items-center justify-center h-6 w-6 rounded transition-colors cursor-pointer ${
                        isMagnetActive
                          ? 'bg-[#2A2E39] text-white border border-white/15'
                          : 'text-[#868993] hover:text-white hover:bg-[#1E222D]'
                      }`}
                    >
                      <Magnet className="h-3.5 w-3.5" />
                    </button>

                    {/* Quick Ruler / Measure Tool Button (Pips, %, & Bar Count) */}
                    <button
                      type="button"
                      data-testid="fav-toolbar-ruler-btn"
                      onClick={() => {
                        if (activeDrawingTool === 'ruler') {
                          cancelActiveDrawingPlacement();
                        } else {
                          handleSelectToolFromMenu('ruler');
                        }
                      }}
                      title="Penggaris Cepat (Ukur Pips, %, & Jumlah Bar)"
                      className={`inline-flex items-center justify-center h-6 w-6 rounded transition-colors cursor-pointer ${
                        activeDrawingTool === 'ruler'
                          ? 'bg-[#2A2E39] text-white border border-white/15'
                          : 'text-[#868993] hover:text-white hover:bg-[#1E222D]'
                      }`}
                    >
                      <Ruler className="h-3.5 w-3.5" />
                    </button>

                    {/* Starred Favorite Tool Buttons */}
                    {DRAWING_TOOLS_CATALOG.filter((t) => favoriteTools.includes(t.id)).map((tool) => {
                      const isSelected = activeDrawingTool === tool.id;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          data-testid={`fav-toolbar-tool-${tool.id}`}
                          onClick={() => {
                            if (activeDrawingTool === tool.id) {
                              cancelActiveDrawingPlacement();
                            } else {
                              handleSelectToolFromMenu(tool.id);
                            }
                          }}
                          title={translateToolName(tool.name)}
                          className={`inline-flex items-center justify-center h-6 w-6 rounded transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#2A2E39] text-white border border-white/15'
                              : 'text-[#D1D4DC] hover:text-white hover:bg-[#1E222D]'
                          }`}
                        >
                          {renderTradingViewDrawingIcon(tool.id, 'w-3.5 h-3.5')}
                        </button>
                      );
                    })}

                    {/* Lainnya (Open Full Tools Menu) */}
                    <button
                      type="button"
                      data-testid="fav-toolbar-more-tools-btn"
                      onClick={() => setShowDrawingToolbar(true)}
                      title={tr('Menu Alat Gambar Lainnya', 'More Drawing Tools Menu')}
                      className="inline-flex items-center justify-center h-6 px-1.5 rounded text-[9px] font-semibold text-[#868993] hover:text-white hover:bg-[#1E222D] transition-colors cursor-pointer"
                    >
                      {tr('Lainnya', 'More')}
                    </button>

                    {/* Quick Hide Favorites Bar Button */}
                    <button
                      type="button"
                      data-testid="fav-toolbar-hide-btn"
                      onClick={handleToggleShowFavoritesOnChart}
                      title={tr('Sembunyikan Toolbar Favorit', 'Hide Favorites Toolbar')}
                      className="inline-flex items-center justify-center h-6 w-5 rounded text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#1E222D] transition-colors cursor-pointer"
                    >
                      <EyeOff className="h-3 w-3" />
                    </button>
                  </>
                )}

                {/* Collapse / Expand Favorites Bar Button */}
                <button
                  type="button"
                  data-testid="fav-toolbar-collapse-btn"
                  onClick={() => setIsFavToolbarCollapsed((prev) => !prev)}
                  title={
                    isFavToolbarCollapsed
                      ? tr('Bentangkan Toolbar Favorit', 'Expand Favorites Toolbar')
                      : tr('Ciutkan Toolbar Favorit', 'Collapse Favorites Toolbar')
                  }
                  className="inline-flex items-center justify-center h-6 w-5 rounded text-[#787B86] hover:text-white hover:bg-[#1E222D] transition-colors cursor-pointer"
                >
                  {isFavToolbarCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronLeft className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )}

            {/* FEATURE 3: FLOATING "KEMBALI KE CANDLE TERAKHIR (>>)" BUTTON WHEN SCROLLED BACK IN HISTORY */}
            {isReplayMode && isScrolledBack && !isSelectingCutPoint && (
              <button
                type="button"
                data-testid="chart-scroll-to-realtime-btn"
                onClick={handleScrollToRealtime}
                title={tr(
                  'Kembali ke Candle Terakhir (Reset Tampilan & Skala Otomatis)',
                  'Jump to Latest Candle (Reset View & Auto-Scale)'
                )}
                className="absolute bottom-3 right-16 z-20 inline-flex items-center gap-1 h-7 px-2 rounded-md bg-[#131722]/95 hover:bg-[#2A2E39] border border-white/15 text-[#D1D4DC] hover:text-white text-[10px] font-semibold shadow-lg transition-colors cursor-pointer select-none touch-manipulation"
              >
                <ChevronsRight className="h-3.5 w-3.5 text-[#2962FF]" />
                <span className="hidden sm:inline">{tr('Candle Terakhir', 'Latest Candle')}</span>
              </button>
            )}

            {/* Loading Indicator */}
            {isLoadingData && (
              <div
                data-testid="market-chart-loading"
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/85 dark:bg-black/75 pointer-events-none"
              >
                <RefreshCw className="h-5 w-5 text-[#0F172A] dark:text-white animate-spin mb-2 stroke-[1.75]" />
                <span className="text-xs font-medium text-[#526071] dark:text-neutral-300">
                  {tr(
                    `Memuat 500 Candle ${activePairItem.label} (${activeTfItem.label})...`,
                    `Loading 500 Candles ${activePairItem.label} (${activeTfItem.label})...`
                  )}
                </span>
              </div>
            )}

            {/* TAHAP 1: DRAGGABLE CUTTER LINE OVERLAY (Clean TradingView Style — Zero Neon Glow) */}
            {isSelectingCutPoint && (
              <div
                data-testid="replay-cutter-overlay"
                className="absolute inset-0 z-20 pointer-events-none overflow-hidden select-none"
              >
                {/* Semi-transparent preview shade to the right of the Cutter Line */}
                <div
                  data-testid="replay-cutter-preview-shade"
                  style={{ left: `${curtainX}px` }}
                  className="absolute inset-y-0 right-0 bg-[#0F172A]/15 dark:bg-black/45 pointer-events-none"
                />

                {/* Draggable Vertical Line (1.5px) + Clean Handle in Center */}
                <div
                  data-testid="replay-draggable-cutter-line"
                  role="slider"
                  aria-label="Garis Potong Bar Replay"
                  aria-valuenow={curtainX}
                  tabIndex={0}
                  style={{ left: `${curtainX}px` }}
                  onTouchStart={handleCutterTouchStart}
                  onTouchMove={handleCutterTouchMove}
                  onTouchEnd={handleCutterTouchEnd}
                  onTouchCancel={handleCutterTouchEnd}
                  onPointerDown={handleCutterPointerDown}
                  onPointerMove={handleCutterPointerMove}
                  onPointerUp={handleCutterPointerUp}
                  onPointerCancel={handleCutterPointerUp}
                  onMouseDown={handleCutterMouseDown}
                  onMouseMove={handleCutterMouseMove}
                  className="absolute inset-y-0 -translate-x-1/2 w-11 flex items-center justify-center pointer-events-auto touch-none cursor-ew-resize group"
                >
                  <div className="h-full w-[1.5px] bg-[#2962FF]" />

                  <div
                    data-testid="replay-cutter-handle"
                    className="absolute top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-[#131722] border border-[#D1D4DC] text-white shadow-md flex items-center justify-center transition-transform group-active:scale-105"
                  >
                    <Scissors className="h-3.5 w-3.5 stroke-[2]" />
                  </div>
                </div>
              </div>
            )}

            {/* BAGIAN B: TRADINGVIEW-GRADE TWO-TOUCH PLACEMENT & CROSSHAIR POSITIONING OVERLAY (Silver-Gray Crosshair, Zero Neon) */}
            {activeDrawingTool !== 'cursor' && aimCursorPos && (
              <div
                data-testid="aiming-crosshair-overlay"
                data-placement-state={placementState}
                data-anchor-price={aimAnchor?.price ?? ''}
                data-anchor-logical={aimAnchor?.logical ?? ''}
                data-anchor-time={aimAnchor?.time ?? ''}
                className="absolute inset-0 z-20 pointer-events-none overflow-hidden select-none"
              >
                {/* Full Horizontal Crosshair Line (TradingView Silver-Gray #9598A1 Dashed) */}
                <div
                  style={{ top: `${aimCursorPos.y}px` }}
                  className="absolute inset-x-0 h-0 border-t border-dashed border-[#9598A1]/85"
                />
                {/* Full Vertical Crosshair Line (TradingView Silver-Gray #9598A1 Dashed) */}
                <div
                  style={{ left: `${aimCursorPos.x}px` }}
                  className="absolute inset-y-0 w-0 border-l border-dashed border-[#9598A1]/85"
                />
                {/* Pure 2-line intersection (Zero center circle or dot as requested) */}
                {/* Right Scale Price Label (TradingView Axis Tag #2A2E39) */}
                <div
                  data-testid="aiming-crosshair-price-label"
                  style={{ top: `${Math.max(8, aimCursorPos.y - 10)}px` }}
                  className="absolute right-0.5 px-1.5 py-0.5 rounded-xs bg-[#2A2E39] border border-white/15 text-[#F8FAFC] text-[9px] font-bold font-mono-numbers tabular-nums shadow-sm"
                >
                  {aimPriceText}
                </div>
                {/* Bottom Scale Date/Time Label (TradingView Axis Tag #2A2E39) */}
                <div
                  data-testid="aiming-crosshair-time-label"
                  style={{
                    left: `${Math.max(48, Math.min((chartContainerRef.current?.clientWidth || 360) - 65, aimCursorPos.x))}px`,
                  }}
                  className="absolute bottom-0.5 -translate-x-1/2 px-2 py-0.5 rounded-xs bg-[#2A2E39] border border-white/15 text-[#F8FAFC] text-[9px] font-bold whitespace-nowrap shadow-sm"
                >
                  {aimDateTimeText}
                </div>
              </div>
            )}

            {/* BAGIAN A4 & B8: DRAWING ACTION BAR (Clean Charcoal Controls #131722) */}
            {activeDrawingTool !== 'cursor' && activeToolDef && (
              <div
                data-testid="drawing-action-bar"
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-2 py-1 rounded-lg bg-[#131722]/95 border border-white/10 text-[#D1D4DC] shadow-xl select-none"
              >
                {/* Active Tool Icon Box + Tap to Confirm Crosshair Point Button */}
                <button
                  type="button"
                  data-testid="drawing-action-lock-point-btn"
                  onClick={handleLockAimedPoint}
                  title={tr('Konfirmasi Titik pada Koordinat Crosshair', 'Confirm Point at Crosshair Coordinate')}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-[#2A2E39] hover:bg-[#363A45] border border-white/15 text-white text-[11px] font-semibold cursor-pointer touch-manipulation"
                >
                  {renderTradingViewDrawingIcon(activeToolDef.id, 'w-3.5 h-3.5')}
                  <span>
                    {activeToolDef.pointsCount === 1
                      ? tr('Pasang', 'Place')
                      : `${tr('Titik', 'Point')} ${draftStep + 1}/${activeToolDef.pointsCount}`}
                  </span>
                </button>

                {/* Magnet (Snap to OHLC) */}
                <button
                  type="button"
                  data-testid="drawing-action-magnet-btn"
                  onClick={toggleMagnetMode}
                  title={isMagnetActive ? tr('Magnet OHLC Aktif', 'OHLC Magnet ON') : tr('Magnet OHLC Mati', 'OHLC Magnet OFF')}
                  className={`inline-flex items-center justify-center h-7 w-7 rounded transition-colors cursor-pointer ${
                    isMagnetActive
                      ? 'bg-[#2A2E39] text-white border border-white/15'
                      : 'bg-[#1E222D] text-[#868993] hover:text-white'
                  }`}
                >
                  <Magnet className="h-3.5 w-3.5" />
                </button>

                {/* Pensil + Gembok (Stay in Drawing Mode) */}
                <button
                  type="button"
                  data-testid="drawing-action-stay-mode-btn"
                  onClick={() => setStayInDrawingMode((prev) => !prev)}
                  title={tr('Tetap di Mode Gambar', 'Stay in Drawing Mode')}
                  className={`relative inline-flex items-center justify-center h-7 w-7 rounded transition-colors cursor-pointer ${
                    stayInDrawingMode
                      ? 'bg-[#2A2E39] text-white border border-white/15'
                      : 'bg-[#1E222D] text-[#868993] hover:text-white'
                  }`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <Lock className="h-2.5 w-2.5 absolute bottom-1 right-1" />
                </button>

                {/* Mata (Hide / Show All Drawings) */}
                <button
                  type="button"
                  data-testid="drawing-action-hide-drawings-btn"
                  onClick={() => setHideAllDrawings((prev) => !prev)}
                  title={hideAllDrawings ? tr('Tampilkan Semua Gambar', 'Show All Drawings') : tr('Sembunyikan Semua Gambar', 'Hide All Drawings')}
                  className={`inline-flex items-center justify-center h-7 w-7 rounded transition-colors cursor-pointer ${
                    hideAllDrawings
                      ? 'bg-[#2A2E39] text-white border border-white/15'
                      : 'bg-[#1E222D] text-[#868993] hover:text-white'
                  }`}
                >
                  {hideAllDrawings ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>

                {/* Layer (Manage Drawings List) */}
                <button
                  type="button"
                  data-testid="drawing-action-layer-btn"
                  onClick={() => setIsLayerModalOpen((prev) => !prev)}
                  title={tr('Layer Objek Gambar', 'Drawing Object Layers')}
                  className={`inline-flex items-center justify-center h-7 w-7 rounded transition-colors cursor-pointer ${
                    isLayerModalOpen
                      ? 'bg-[#2A2E39] text-white border border-white/15'
                      : 'bg-[#1E222D] text-[#868993] hover:text-white'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                </button>

                {/* Tombol Batal / Selesai */}
                <button
                  type="button"
                  data-testid="drawing-action-done-btn"
                  onClick={cancelActiveDrawingPlacement}
                  title={tr('Batal / Keluar Mode Gambar (Esc)', 'Cancel / Exit Drawing Mode (Esc)')}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded bg-[#1E222D] hover:bg-[#2A2E39] border border-white/10 text-[11px] font-medium text-[#D1D4DC] hover:text-white cursor-pointer"
                >
                  <span>{tr('Batal', 'Cancel')}</span>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Layer Popover Modal (Daftar Objek Gambar) */}
            {isLayerModalOpen && (
              <div
                data-testid="drawing-layer-modal"
                className="absolute bottom-14 left-1/2 -translate-x-1/2 z-40 w-64 rounded-lg bg-[#131722] border border-white/10 p-3 text-[#D1D4DC] shadow-2xl select-none"
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-white">
                    {tr('Layer Gambar', 'Drawing Layers')} ({pairDrawings.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsLayerModalOpen(false)}
                    className="text-[#868993] hover:text-white cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {pairDrawings.length === 0 ? (
                  <p className="text-[11px] text-[#868993] py-2 text-center">
                    {tr('Belum ada objek gambar.', 'No drawing objects yet.')}
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {pairDrawings.map((d, idx) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between px-2 py-1.5 rounded bg-[#1E222D] text-[11px]"
                      >
                        <span className="truncate font-medium">
                          #{idx + 1} · {translateToolName(DRAWING_TOOLS_CATALOG.find((t) => t.id === d.type)?.name || d.type)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setDrawings((prev) => {
                              const next = prev.filter((item) => item.id !== d.id);
                              saveStoredDrawings(next);
                              return next;
                            });
                          }}
                          className="text-[#868993] hover:text-[#F23645] cursor-pointer ml-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TRANSPARENT COORDINATE-SYNCED SVG OVERLAY FOR ALL DRAWINGS (pointer-events-none when idle so chart pan/zoom works 100%) */}
            <svg
              data-testid="chart-drawings-svg-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  handleEmptyChartTapOrClick(e.target as HTMLElement | null);
                }
              }}
              onPointerDown={isOverlayInteractive ? handleOverlayPointerDown : undefined}
              onPointerMove={isOverlayInteractive ? handleOverlayPointerMove : undefined}
              onPointerUp={isOverlayInteractive ? handleOverlayPointerUp : undefined}
              onPointerCancel={isOverlayInteractive ? handleOverlayPointerUp : undefined}
              style={{
                pointerEvents: isOverlayInteractive ? 'auto' : 'none',
                touchAction: isOverlayInteractive ? 'none' : 'auto',
              }}
              className={`absolute inset-0 w-full h-full z-10 select-none transform-gpu ${
                isOverlayInteractive
                  ? 'pointer-events-auto cursor-crosshair touch-none'
                  : 'pointer-events-none'
              }`}
            >
          {/* Multi-Zone Market Sessions Indicator (Asia, London, New York) */}
          {marketSessionBoxes.map((box) => (
            <g key={box.id} className="pointer-events-none">
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={3}
                fill={box.bgColor}
                stroke={box.borderColor}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <g transform={`translate(${box.x + 4}, ${Math.max(14, box.y - 4)})`}>
                <text
                  x={0}
                  y={0}
                  fill={box.color}
                  fontSize="9"
                  fontWeight="700"
                  letterSpacing="0.05em"
                >
                  {box.name}
                </text>
              </g>
            </g>
          ))}

          {/* FEATURE 4: Active Journal Trade Lines (OPEN & PLANNED positions from TradeVault Journal) */}
          {(chartEngineMode === 'replay_studio' || replayPhase !== 'off') &&
            activeJournalOverlayLines.length > 0 &&
            activeJournalOverlayLines.map((jLine) => {
              const series = candleSeriesRef.current;
              if (!series) return null;
              const svgW = chartContainerRef.current?.clientWidth || 1000;
              const rightLabelX = Math.max(8, svgW - 142);
              const entryY = series.priceToCoordinate(jLine.entryPrice);
              const slY =
                jLine.stopLoss !== undefined ? series.priceToCoordinate(jLine.stopLoss) : null;
              const tpY =
                jLine.takeProfit !== undefined ? series.priceToCoordinate(jLine.takeProfit) : null;
              const entryColor = jLine.position === 'BUY' ? '#2962FF' : '#F59E0B';
              const entryLabel = `${jLine.status === 'OPEN' ? 'OPEN' : 'PLAN'} ${jLine.position} ${jLine.lotSize} · ${jLine.entryPrice.toFixed(activePairMeta.decimals)}`;

              return (
                <g
                  key={`journal_line_${jLine.tradeId}`}
                  data-testid="journal-trade-overlay-group"
                  className="pointer-events-none"
                >
                  {entryY !== null && (
                    <g>
                      <line
                        x1={0}
                        y1={Number(entryY)}
                        x2={svgW}
                        y2={Number(entryY)}
                        stroke={entryColor}
                        strokeWidth={1.25}
                        strokeDasharray="5 3"
                        opacity={0.85}
                      />
                      <g transform={`translate(${rightLabelX}, ${Number(entryY) - 8})`}>
                        <rect
                          x={0}
                          y={0}
                          width={136}
                          height={16}
                          rx={2}
                          fill="#131722"
                          stroke={entryColor}
                          strokeWidth={1}
                        />
                        <text
                          x={68}
                          y={11}
                          textAnchor="middle"
                          fill="#F8FAFC"
                          fontSize="8.5"
                          fontWeight="700"
                        >
                          {entryLabel}
                        </text>
                      </g>
                    </g>
                  )}

                  {tpY !== null && jLine.takeProfit !== undefined && (
                    <g>
                      <line
                        x1={0}
                        y1={Number(tpY)}
                        x2={svgW}
                        y2={Number(tpY)}
                        stroke="#089981"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.75}
                      />
                      <g transform={`translate(${Math.max(8, svgW - 92)}, ${Number(tpY) - 7.5})`}>
                        <rect
                          x={0}
                          y={0}
                          width={86}
                          height={15}
                          rx={2}
                          fill="#131722"
                          stroke="#089981"
                          strokeWidth={1}
                        />
                        <text
                          x={43}
                          y={10.5}
                          textAnchor="middle"
                          fill="#089981"
                          fontSize="8"
                          fontWeight="700"
                        >
                          {`TP ${jLine.takeProfit.toFixed(activePairMeta.decimals)}`}
                        </text>
                      </g>
                    </g>
                  )}

                  {slY !== null && jLine.stopLoss !== undefined && (
                    <g>
                      <line
                        x1={0}
                        y1={Number(slY)}
                        x2={svgW}
                        y2={Number(slY)}
                        stroke="#F23645"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.75}
                      />
                      <g transform={`translate(${Math.max(8, svgW - 92)}, ${Number(slY) - 7.5})`}>
                        <rect
                          x={0}
                          y={0}
                          width={86}
                          height={15}
                          rx={2}
                          fill="#131722"
                          stroke="#F23645"
                          strokeWidth={1}
                        />
                        <text
                          x={43}
                          y={10.5}
                          textAnchor="middle"
                          fill="#F23645"
                          fontSize="8"
                          fontWeight="700"
                        >
                          {`SL ${jLine.stopLoss.toFixed(activePairMeta.decimals)}`}
                        </text>
                      </g>
                    </g>
                  )}
                </g>
              );
            })}

          {/* Render Coordinate-Anchored Drawings ({ logical, price, time } -> pixel (x, y)) */}
          {!hideAllDrawings &&
            (chartEngineMode === 'replay_studio' || replayPhase !== 'off') &&
            (singlePointPreviewDrawing
              ? [...allRenderedDrawings, singlePointPreviewDrawing]
              : allRenderedDrawings
            ).map((item) => {
              const isGhostPreview = item.id === '__preview_single__';
              const isPositionTool =
                item.type === 'long_position' ||
                item.type === 'short_position' ||
                item.type === 'long' ||
                item.type === 'short';
              const isOnePointSpanTool =
                item.type === 'price_note' ||
                item.type === 'horizontal_line';
              const resolvedP1Logical =
                item.p1.time !== undefined && Number.isFinite(item.p1.time)
                  ? resolveLogicalFromTime(item.p1, fullCandlesRef.current, activeTimeframeSeconds)
                  : resolveContainingBarLogical(item.p1, fullCandlesRef.current, activeTimeframeSeconds);
              const barSpan = Math.max(
                4,
                Math.min(80, Math.round(Math.abs(item.p2.logical - item.p1.logical)) || 22)
              );
              const rawP2Logical =
                item.p2.time !== undefined && Number.isFinite(item.p2.time)
                  ? resolveLogicalFromTime(item.p2, fullCandlesRef.current, activeTimeframeSeconds)
                  : isPositionTool
                    ? (item.p1.time !== undefined
                        ? resolveLogicalFromTime({ logical: 0, price: 0, time: item.p1.time + 6600 }, fullCandlesRef.current, activeTimeframeSeconds)
                        : resolvedP1Logical + Math.max(0.1, (item.p2.logical - item.p1.logical) * (300 / activeTimeframeSeconds)))
                    : isOnePointSpanTool
                      ? resolvedP1Logical + barSpan
                      : resolvedP1Logical + (item.p2.logical - item.p1.logical);
              const effectiveP2Logical = isPositionTool
                ? rawP2Logical
                : !isOnePointSpanTool &&
                  item.type !== 'vertical_line' &&
                  Math.abs(item.p2.logical - item.p1.logical) >= 2 &&
                  Math.abs(rawP2Logical - resolvedP1Logical) < 1
                  ? resolvedP1Logical + (item.p2.logical >= item.p1.logical ? 1 : -1)
                  : rawP2Logical;

              const p1 = convertAnchorToPixel(item.p1);
              const p2 = convertAnchorToPixel({
                logical: effectiveP2Logical,
                price: item.p2.price,
                time: item.p2.time,
              });
              if (!p1) return null;

              const isSelected = !isGhostPreview && selectedDrawingId === item.id;
              const strokeColor = item.color || '#2962FF';
              const baseLineWidth = item.lineWidth ?? 2;
              const dashPattern = item.dashed ? '6 4' : undefined;
              const svgWidth = chartContainerRef.current?.clientWidth || 1000;
              const svgHeight = chartContainerRef.current?.clientHeight || 600;

              const renderAnchorHandle = (
                pt: { x: number; y: number },
                handleKey: 'p1' | 'p2' | 'p3' | 'tp' | 'sl' | 'rect_tr' | 'rect_bl'
              ) => (
                <g
                  key={`${item.id}_handle_${handleKey}`}
                  data-testid={`drawing-handle-${handleKey}`}
                  className="pointer-events-auto cursor-grab active:cursor-grabbing touch-none"
                  onPointerDown={(e) => startHandleDrag(e, item, handleKey)}
                >
                  <circle cx={pt.x} cy={pt.y} r={13} fill="transparent" />
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={4.25}
                    fill="#131722"
                    stroke="#D1D4DC"
                    strokeWidth={1.5}
                  />
                </g>
              );

              // 1. GARIS HORIZONTAL ('horizontal_line')
              if (item.type === 'horizontal_line') {
                return (
                  <g
                    key={item.id}
                    data-testid={`rendered-drawing-${item.type}`}
                    opacity={isGhostPreview ? 0.65 : 1}
                    className={isGhostPreview ? 'pointer-events-none' : undefined}
                  >
                    {!isGhostPreview && (
                      <line
                        x1={0}
                        y1={p1.y}
                        x2={svgWidth}
                        y2={p1.y}
                        stroke="transparent"
                        strokeWidth={16}
                        className="pointer-events-auto cursor-pointer touch-none"
                        onPointerDown={(e) => startHandleDrag(e, item, 'p1')}
                      />
                    )}
                    <line
                      x1={0}
                      y1={p1.y}
                      x2={svgWidth}
                      y2={p1.y}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? baseLineWidth + 0.5 : baseLineWidth}
                      strokeDasharray={dashPattern}
                    />
                    <g transform={`translate(${Math.max(8, svgWidth - 56)}, ${p1.y - 9})`}>
                      <rect
                        x={0}
                        y={0}
                        width={54}
                        height={18}
                        rx={2}
                        fill="#131722"
                        stroke={strokeColor}
                        strokeWidth={1}
                      />
                      <text
                        x={27}
                        y={12}
                        textAnchor="middle"
                        fill="#F8FAFC"
                        fontSize="9"
                        fontWeight="700"
                      >
                        {item.p1.price.toFixed(activePairMeta.decimals)}
                      </text>
                    </g>
                    {isSelected && renderAnchorHandle(p1, 'p1')}
                  </g>
                );
              }

              // 2. GARIS VERTIKAL ('vertical_line')
              if (item.type === 'vertical_line') {
                return (
                  <g
                    key={item.id}
                    data-testid="rendered-drawing-vertical_line"
                    opacity={isGhostPreview ? 0.65 : 1}
                    className={isGhostPreview ? 'pointer-events-none' : undefined}
                  >
                    {!isGhostPreview && (
                      <line
                        x1={p1.x}
                        y1={0}
                        x2={p1.x}
                        y2={svgHeight}
                        stroke="transparent"
                        strokeWidth={16}
                        className="pointer-events-auto cursor-pointer touch-none"
                        onPointerDown={(e) => startHandleDrag(e, item, 'p1')}
                      />
                    )}
                    <line
                      x1={p1.x}
                      y1={0}
                      x2={p1.x}
                      y2={svgHeight}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? baseLineWidth + 0.5 : baseLineWidth}
                      strokeDasharray={dashPattern}
                    />
                    {isSelected && renderAnchorHandle(p1, 'p1')}
                  </g>
                );
              }

              if (!p2) return null;

              // 3. GARIS TREN ('trendline') & SINAR TREN ('ray')
              if (item.type === 'trendline' || item.type === 'ray') {
                let endX = p2.x;
                let endY = p2.y;
                if (item.type === 'ray') {
                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const len = Math.hypot(dx, dy);
                  if (len > 0.5) {
                    const scale = (Math.max(svgWidth, svgHeight) * 2) / len;
                    endX = p1.x + dx * scale;
                    endY = p1.y + dy * scale;
                  }
                }
                return (
                  <g key={item.id} data-testid={`rendered-drawing-${item.type}`}>
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={endX}
                      y2={endY}
                      stroke="transparent"
                      strokeWidth={18}
                      className="pointer-events-auto cursor-move touch-none"
                      onPointerDown={(e) => startHandleDrag(e, item, 'body')}
                    />
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={endX}
                      y2={endY}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? baseLineWidth + 0.5 : baseLineWidth}
                      strokeDasharray={dashPattern}
                    />
                    {!isSelected && (
                      <>
                        <circle cx={p1.x} cy={p1.y} r={2.75} fill="#131722" stroke={strokeColor} strokeWidth={1.5} />
                        <circle cx={p2.x} cy={p2.y} r={2.75} fill="#131722" stroke={strokeColor} strokeWidth={1.5} />
                      </>
                    )}
                    {isSelected && (
                      <>
                        {renderAnchorHandle(p1, 'p1')}
                        {renderAnchorHandle(p2, 'p2')}
                      </>
                    )}
                  </g>
                );
              }

              // 4. FIB RETRACEMENT ('fib_retracement')
              if (item.type === 'fib_retracement') {
                const levels = [
                  { ratio: 0, color: '#787B86' },
                  { ratio: 0.236, color: '#F23645' },
                  { ratio: 0.382, color: '#F59E0B' },
                  { ratio: 0.5, color: '#089981' },
                  { ratio: 0.618, color: '#2962FF' },
                  { ratio: 0.786, color: '#7E57C2' },
                  { ratio: 1, color: '#787B86' },
                ];
                const leftX = Math.min(p1.x, p2.x);
                const rightX = Math.max(leftX + 45, Math.max(p1.x, p2.x));
                const diffPrice = item.p1.price - item.p2.price;

                const computedLevels = levels
                  .map((lvl) => {
                    const lvlPrice = item.p2.price + diffPrice * lvl.ratio;
                    const coord = convertAnchorToPixel({ logical: item.p1.logical, price: lvlPrice });
                    return coord ? { ...lvl, price: lvlPrice, y: coord.y } : null;
                  })
                  .filter((x): x is NonNullable<typeof x> => x !== null);

                return (
                  <g key={item.id} data-testid="rendered-drawing-fib_retracement">
                    {computedLevels.slice(0, -1).map((curr, idx) => {
                      const next = computedLevels[idx + 1];
                      const topY = Math.min(curr.y, next.y);
                      const h = Math.max(1, Math.abs(next.y - curr.y));
                      return (
                        <rect
                          key={`fib_fill_${curr.ratio}`}
                          x={leftX}
                          y={topY}
                          width={rightX - leftX}
                          height={h}
                          fill={next.color}
                          fillOpacity={0.08}
                          className="pointer-events-auto cursor-move touch-none"
                          onPointerDown={(e) => startHandleDrag(e, item, 'body')}
                        />
                      );
                    })}

                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="#787B86"
                      strokeWidth={1.1}
                      strokeDasharray="4 4"
                    />

                    {computedLevels.map((lvl) => (
                      <g key={`fib_line_${lvl.ratio}`}>
                        <line
                          x1={leftX}
                          y1={lvl.y}
                          x2={rightX}
                          y2={lvl.y}
                          stroke={lvl.color}
                          strokeWidth={isSelected ? 1.4 : 1.1}
                          strokeDasharray={dashPattern}
                        />
                        <text
                          x={leftX + 4}
                          y={lvl.y - 3}
                          fill={lvl.color}
                          fontSize="9"
                          fontWeight="600"
                        >
                          {lvl.ratio} ({lvl.price.toFixed(activePairMeta.decimals)})
                        </text>
                      </g>
                    ))}

                    {isSelected && (
                      <>
                        {renderAnchorHandle(p1, 'p1')}
                        {renderAnchorHandle(p2, 'p2')}
                      </>
                    )}
                  </g>
                );
              }

              // 5. FIB EKSTENSI BERBASIS TREN ('fib_extension' — 3 Points: p1, p2, p3)
              if (item.type === 'fib_extension') {
                const p3Anchor = item.p3 || {
                  logical: item.p2.logical + 6,
                  price: (item.p1.price + item.p2.price) / 2,
                };
                const p3 = convertAnchorToPixel(p3Anchor, item.p2);
                if (!p3) return null;

                const extLevels = [
                  { ratio: 0, color: '#787B86' },
                  { ratio: 0.5, color: '#F59E0B' },
                  { ratio: 0.618, color: '#089981' },
                  { ratio: 1, color: '#2962FF' },
                  { ratio: 1.272, color: '#7E57C2' },
                  { ratio: 1.618, color: '#F23645' },
                ];
                const trendWave = item.p2.price - item.p1.price;
                const startX = p3.x;
                const endX = Math.max(startX + 95, Math.max(p1.x, p2.x, p3.x) + 75);

                const computedExt = extLevels
                  .map((lvl) => {
                    const lvlPrice = p3Anchor.price + trendWave * lvl.ratio;
                    const coord = convertAnchorToPixel({ logical: p3Anchor.logical, price: lvlPrice });
                    return coord ? { ...lvl, price: lvlPrice, y: coord.y } : null;
                  })
                  .filter((x): x is NonNullable<typeof x> => x !== null);

                return (
                  <g key={item.id} data-testid="rendered-drawing-fib_extension">
                    {computedExt.slice(0, -1).map((curr, idx) => {
                      const next = computedExt[idx + 1];
                      const topY = Math.min(curr.y, next.y);
                      const h = Math.max(1, Math.abs(next.y - curr.y));
                      return (
                        <rect
                          key={`fib_ext_fill_${curr.ratio}`}
                          x={startX}
                          y={topY}
                          width={endX - startX}
                          height={h}
                          fill={next.color}
                          fillOpacity={0.08}
                          className="pointer-events-auto cursor-move touch-none"
                          onPointerDown={(e) => startHandleDrag(e, item, 'body')}
                        />
                      );
                    })}

                    <polyline
                      points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
                      fill="none"
                      stroke="#787B86"
                      strokeWidth={1.3}
                      strokeDasharray="4 3"
                      className="pointer-events-auto cursor-move touch-none"
                      onPointerDown={(e) => startHandleDrag(e, item, 'body')}
                    />

                    {computedExt.map((lvl) => (
                      <g key={`fib_ext_line_${lvl.ratio}`}>
                        <line
                          x1={startX}
                          y1={lvl.y}
                          x2={endX}
                          y2={lvl.y}
                          stroke={lvl.color}
                          strokeWidth={isSelected ? 1.4 : 1.1}
                          strokeDasharray={dashPattern}
                        />
                        <text
                          x={startX + 4}
                          y={lvl.y - 3}
                          fill={lvl.color}
                          fontSize="9"
                          fontWeight="600"
                        >
                          {lvl.ratio} ({lvl.price.toFixed(activePairMeta.decimals)})
                        </text>
                      </g>
                    ))}

                    {isSelected && (
                      <>
                        {renderAnchorHandle(p1, 'p1')}
                        {renderAnchorHandle(p2, 'p2')}
                        {renderAnchorHandle(p3, 'p3')}
                      </>
                    )}
                  </g>
                );
              }

              // 6. PERSEGI ('rectangle' | 'rect')
              if (item.type === 'rectangle' || item.type === 'rect') {
                const rx = Math.min(p1.x, p2.x);
                const ry = Math.min(p1.y, p2.y);
                const rw = Math.max(6, Math.abs(p2.x - p1.x));
                const rh = Math.max(6, Math.abs(p2.y - p1.y));
                const trPt = { x: p2.x, y: p1.y };
                const blPt = { x: p1.x, y: p2.y };

                return (
                  <g key={item.id} data-testid="rendered-drawing-rectangle">
                    <rect
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      fill={strokeColor}
                      fillOpacity={0.14}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? baseLineWidth + 0.4 : baseLineWidth}
                      strokeDasharray={dashPattern}
                      className="pointer-events-auto cursor-move touch-none"
                      onPointerDown={(e) => startHandleDrag(e, item, 'body')}
                    />
                    {isSelected && (
                      <>
                        {renderAnchorHandle(p1, 'p1')}
                        {renderAnchorHandle(p2, 'p2')}
                        {renderAnchorHandle(trPt, 'rect_tr')}
                        {renderAnchorHandle(blPt, 'rect_bl')}
                      </>
                    )}
                  </g>
                );
              }

              // 7 & 8. TRADINGVIEW-AUTHENTIC LONG POSITION ('long_position') & SHORT POSITION ('short_position')
              // - Layer 1 (Base Zones): 100% Entry-to-TP (#089981 tint) and 100% Entry-to-SL (#F23645 tint) always visible
              // - Layer 2 (Dynamic Candle Hit / Progress Fill):
              //   * When TP is hit by a candle (`TP_HIT`), Profit Zone fills 100% with active TradingView green (`rgba(8, 153, 129, 0.36)`)
              //   * When SL is hit by a candle (`SL_HIT`), Risk Zone fills 100% with active TradingView red (`rgba(242, 54, 69, 0.36)`)
              //   * When `ACTIVE`, active progress fill tracks current candle price from Entry line
              if (
                item.type === 'long_position' ||
                item.type === 'short_position' ||
                item.type === 'long' ||
                item.type === 'short'
              ) {
                const isLongPos = item.type === 'long_position' || item.type === 'long';
                const norm = normalizePositionPrices(
                  isLongPos,
                  item.p1.price,
                  item.slPrice,
                  item.tpPrice,
                  activePairMeta.volatility,
                  activePairMeta.decimals
                );

                const series = candleSeriesRef.current;
                const tpRawY = series ? series.priceToCoordinate(norm.tpPrice) : null;
                const slRawY = series ? series.priceToCoordinate(norm.slPrice) : null;
                if (tpRawY === null || slRawY === null) return null;
                const tpCoord = { x: p1.x, y: Number(tpRawY) };
                const slCoord = { x: p1.x, y: Number(slRawY) };

                const effectiveP2Time = resolveTimeFromLogical(
                  effectiveP2Logical,
                  visibleOhlcCandles,
                  activeTimeframeSeconds,
                  item.p1
                );

                // Cache OHLC evaluation across 60fps pan/zoom frames when neither candle data nor drawing coordinates changed
                const isCurrentlyDragging = draggingHandle?.drawingId === item.id;
                const firstC = visibleOhlcCandles[0];
                const lastC = visibleOhlcCandles[visibleOhlcCandles.length - 1];
                const ohlcCacheSig = `${visibleOhlcCandles.length}_${firstC ? Number(firstC.time) : 0}_${lastC ? `${Number(lastC.time)}:${lastC.open}:${lastC.high}:${lastC.low}:${lastC.close}` : 0}_${activeTimeframeSeconds}_${item.type}_${resolvedP1Logical}_${effectiveP2Logical}_${item.p1.time ?? 0}_${effectiveP2Time ?? 0}_${norm.entryPrice}_${norm.slPrice}_${norm.tpPrice}_${item.createdAtTime ?? 0}_${item.hitStatus ?? ''}_${item.hitTime ?? 0}_${isCurrentlyDragging}`;
                const cachedEval = isCurrentlyDragging ? undefined : ohlcEvaluationCacheRef.current.get(item.id);
                const ohlcStatus =
                  cachedEval && cachedEval.sig === ohlcCacheSig
                    ? cachedEval.status
                    : (() => {
                        const computed = evaluatePositionOhlcStatus(
                          {
                            ...item,
                            p1: {
                              ...item.p1,
                              logical: resolvedP1Logical,
                              price: norm.entryPrice,
                            },
                            p2: {
                              ...item.p2,
                              logical: effectiveP2Logical,
                              price: norm.entryPrice,
                              time: effectiveP2Time,
                            },
                            slPrice: norm.slPrice,
                            tpPrice: norm.tpPrice,
                          },
                          visibleOhlcCandles,
                          undefined,
                          activeTimeframeSeconds
                        );
                        if (!isCurrentlyDragging) {
                          ohlcEvaluationCacheRef.current.set(item.id, {
                            sig: ohlcCacheSig,
                            status: computed,
                          });
                        }
                        if (
                          !isCurrentlyDragging &&
                          (computed.status === 'TP_HIT' || computed.status === 'SL_HIT') &&
                          (!item.hitStatus || item.hitStatus !== computed.status || item.hitTime !== computed.hitTime)
                        ) {
                          window.queueMicrotask(() => {
                            updateExistingDrawing(item.id, (prev) => ({
                              ...prev,
                              hitStatus: computed.status,
                              hitTime: computed.hitTime,
                              hitPrice: computed.hitPrice,
                              entryHitTime: computed.entryHitTime,
                            }));
                          });
                        }
                        return computed;
                      })();

                const currentClosePrice = ohlcStatus.lastActiveClose ?? displayedCandle?.close;
                const closeRawY =
                  currentClosePrice !== undefined && series
                    ? series.priceToCoordinate(currentClosePrice)
                    : null;
                const currentCloseCoord =
                  closeRawY !== null ? { x: p1.x, y: Number(closeRawY) } : null;

                // Resolve horizontal pixel span of the filled candles (from Entry-hit candle to TP/SL-hit or last active candle inside the box)
                const timeScale = chartApiRef.current?.timeScale();
                const coord0 = timeScale ? timeScale.logicalToCoordinate(0 as Logical) : null;
                const coord1 = timeScale ? timeScale.logicalToCoordinate(1 as Logical) : null;
                const barStepPx =
                  coord0 !== null && coord0 !== undefined && coord1 !== null && coord1 !== undefined
                    ? Math.max(4, Math.abs(Number(coord1) - Number(coord0)))
                    : 8;

                let fillStartX: number | undefined;
                let fillEndX: number | undefined;

                if (ohlcStatus.entryTouched && ohlcStatus.entryHitLogical !== undefined && timeScale) {
                  const entryLogical =
                    ohlcStatus.entryHitTime !== undefined && visibleOhlcCandles.length > 0
                      ? resolveLogicalFromTime(
                          { logical: 0, price: 0, time: ohlcStatus.entryHitTime },
                          visibleOhlcCandles,
                          activeTimeframeSeconds
                        )
                      : ohlcStatus.entryHitLogical;
                  const entryCenterCoord = timeScale.logicalToCoordinate(
                    entryLogical as Logical
                  );
                  if (entryCenterCoord !== null && entryCenterCoord !== undefined) {
                    const isFirstCandleInBox =
                      ohlcStatus.boxStartLogical !== undefined &&
                      ohlcStatus.entryHitLogical <= ohlcStatus.boxStartLogical;
                    fillStartX = isFirstCandleInBox
                      ? Math.min(p1.x, p2.x)
                      : Number(entryCenterCoord) - barStepPx * 0.5;
                  }

                  const targetEndLogical =
                    ohlcStatus.status === 'TP_HIT' ||
                    ohlcStatus.status === 'SL_HIT' ||
                    ohlcStatus.status === 'AMBIGUOUS'
                      ? (ohlcStatus.hitTime !== undefined && visibleOhlcCandles.length > 0
                          ? resolveLogicalFromTime(
                              { logical: 0, price: 0, time: ohlcStatus.hitTime },
                              visibleOhlcCandles,
                              activeTimeframeSeconds
                            )
                          : (ohlcStatus.hitLogical ?? ohlcStatus.entryHitLogical))
                      : (ohlcStatus.lastActiveLogical ?? ohlcStatus.entryHitLogical);

                  const endCenterCoord = timeScale.logicalToCoordinate(targetEndLogical as Logical);
                  if (endCenterCoord !== null && endCenterCoord !== undefined) {
                    fillEndX = Number(endCenterCoord) + barStepPx * 0.5;
                  }
                }

                const geom = computePositionGeometry({
                  isLong: isLongPos,
                  p1X: p1.x,
                  p2X: p2.x,
                  entryY: p1.y,
                  tpY: tpCoord.y,
                  slY: slCoord.y,
                  entryPrice: norm.entryPrice,
                  tpPrice: norm.tpPrice,
                  slPrice: norm.slPrice,
                  status: ohlcStatus.status,
                  currentPrice: currentClosePrice,
                  currentPriceY: currentCloseCoord?.y,
                  fillStartX,
                  fillEndX,
                  minFillWidth: barStepPx,
                });

                const rightBadgeX = Math.max(8, svgWidth - 54);
                const pairForPips = item.pair || activePairMeta.label;
                const activeChartXauPipSize = settings?.xauusdPipSize ?? 0.1;
                const tpPipsInfo = computePositionPips(norm.entryPrice, norm.tpPrice, pairForPips, activeChartXauPipSize);
                const slPipsInfo = computePositionPips(norm.entryPrice, norm.slPrice, pairForPips, activeChartXauPipSize);
                const tpBannerText = `TP ${norm.tpPrice.toFixed(activePairMeta.decimals)} (${tpPipsInfo.formattedPips}) · 1:${geom.rrRatio}${
                  ohlcStatus.status === 'TP_HIT' ? ' · HIT' : ''
                }`;
                const slBannerText = `SL ${norm.slPrice.toFixed(activePairMeta.decimals)} (${slPipsInfo.formattedPips}) · ${ohlcStatus.label}`;
                const tpBannerWidth = Math.max(134, Math.min(228, Math.round(tpBannerText.length * 5.05 + 14)));
                const slBannerWidth = Math.max(134, Math.min(228, Math.round(slBannerText.length * 5.05 + 14)));
                const tpBannerY = isLongPos
                  ? Math.max(4, geom.profitTopY - 19)
                  : Math.min(svgHeight - 22, geom.profitBottomY + 3);
                const slBannerY = isLongPos
                  ? Math.min(svgHeight - 22, geom.riskBottomY + 3)
                  : Math.max(4, geom.riskTopY - 19);

                return (
                  <g
                    key={item.id}
                    data-testid={`rendered-drawing-${isLongPos ? 'long_position' : 'short_position'}`}
                    data-position-status={ohlcStatus.status}
                    data-entry-price={norm.entryPrice}
                    data-tp-price={norm.tpPrice}
                    data-sl-price={norm.slPrice}
                    data-tp-pips={tpPipsInfo.pips}
                    data-sl-pips={slPipsInfo.pips}
                    data-profit-height={geom.profitHeight}
                    data-risk-height={geom.riskHeight}
                    data-active-fill-height={geom.activeFillHeight}
                    data-active-fill-width={geom.activeFillWidth}
                    opacity={isGhostPreview ? 0.72 : 1}
                    className={isGhostPreview ? 'pointer-events-none' : undefined}
                  >
                    {/* LAYER 1A: BASE PROFIT ZONE (100% Entry <-> TP, TradingView Teal #089981) */}
                    <rect
                      data-testid="position-profit-zone"
                      x={geom.leftX}
                      y={geom.profitTopY}
                      width={geom.boxWidth}
                      height={geom.profitHeight}
                      fill={geom.profitBaseFill}
                      stroke="#089981"
                      strokeOpacity={ohlcStatus.status === 'TP_HIT' ? 0.95 : 0.55}
                      strokeWidth={1}
                      className={isGhostPreview ? 'pointer-events-none' : 'pointer-events-auto cursor-move touch-none'}
                      onPointerDown={isGhostPreview ? undefined : (e) => startHandleDrag(e, item, 'body')}
                    />

                    {/* LAYER 1B: BASE RISK ZONE (100% Entry <-> SL, TradingView Crimson #F23645) */}
                    <rect
                      data-testid="position-risk-zone"
                      x={geom.leftX}
                      y={geom.riskTopY}
                      width={geom.boxWidth}
                      height={geom.riskHeight}
                      fill={geom.riskBaseFill}
                      stroke="#F23645"
                      strokeOpacity={ohlcStatus.status === 'SL_HIT' ? 0.95 : 0.55}
                      strokeWidth={1}
                      className={isGhostPreview ? 'pointer-events-none' : 'pointer-events-auto cursor-move touch-none'}
                      onPointerDown={isGhostPreview ? undefined : (e) => startHandleDrag(e, item, 'body')}
                    />

                    {/* LAYER 2: DYNAMIC CANDLE HIT / FLOATING PROGRESS FILL (TradingView Style - Bounded strictly to Entry..Hit/Active Candles) */}
                    {geom.activeFillTopY !== null &&
                      geom.activeFillHeight > 0.5 &&
                      geom.activeFillWidth > 0.5 &&
                      geom.activeFillColor && (
                        <rect
                          data-testid="position-active-fill-zone"
                          data-fill-mode={ohlcStatus.status}
                          x={geom.activeFillLeftX}
                          y={geom.activeFillTopY}
                          width={geom.activeFillWidth}
                          height={geom.activeFillHeight}
                          fill={geom.activeFillColor}
                          className="pointer-events-none"
                        />
                      )}

                    {/* Diagonal Dashed Connector Line from Entry Candle Start to Hit/Active Candle End (Hidden when PENDING) */}
                    <line
                      data-testid="position-progress-connector"
                      x1={geom.activeFillLeftX}
                      y1={geom.entryY}
                      x2={geom.activeFillRightX}
                      y2={geom.targetEndY}
                      stroke="#9598A1"
                      strokeOpacity={ohlcStatus.status === 'PENDING' ? 0 : 0.65}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      className="pointer-events-none"
                    />

                    {/* Take Profit (TP) Boundary Line (#089981) */}
                    <line
                      data-testid="position-tp-line"
                      x1={geom.leftX}
                      y1={geom.tpY}
                      x2={geom.rightEdgeX}
                      y2={geom.tpY}
                      stroke="#089981"
                      strokeWidth={ohlcStatus.status === 'TP_HIT' || isSelected ? 1.75 : 1.25}
                    />

                    {/* Stop Loss (SL) Boundary Line (#F23645) */}
                    <line
                      data-testid="position-sl-line"
                      x1={geom.leftX}
                      y1={geom.slY}
                      x2={geom.rightEdgeX}
                      y2={geom.slY}
                      stroke="#F23645"
                      strokeWidth={ohlcStatus.status === 'SL_HIT' || isSelected ? 1.75 : 1.25}
                    />

                    {/* Middle Entry Dividing Line (TradingView Neutral Gray #787B86 / #D1D4DC) */}
                    <line
                      data-testid="position-entry-line"
                      x1={geom.leftX}
                      y1={geom.entryY}
                      x2={geom.rightEdgeX}
                      y2={geom.entryY}
                      stroke={isSelected ? '#D1D4DC' : '#787B86'}
                      strokeWidth={isSelected ? 1.6 : 1.25}
                      strokeDasharray={dashPattern}
                    />

                    {/* TradingView-Style Target (TP) & Stop (SL) Info Banners with Pips (Shown ONLY when tool is selected/clicked) */}
                    {isSelected && (
                      <>
                        <g
                          data-testid="position-tp-banner"
                          transform={`translate(${geom.leftX}, ${tpBannerY})`}
                          className="pointer-events-none"
                        >
                          <rect
                            x={0}
                            y={0}
                            width={tpBannerWidth}
                            height={16}
                            rx={2}
                            fill={ohlcStatus.status === 'TP_HIT' ? '#089981' : '#131722'}
                            fillOpacity={0.94}
                            stroke="#089981"
                            strokeWidth={1}
                          />
                          <text
                            x={6}
                            y={11}
                            fill="#FFFFFF"
                            fontSize="8.5"
                            fontWeight="600"
                          >
                            {tpBannerText}
                          </text>
                        </g>

                        <g
                          data-testid="position-sl-banner"
                          transform={`translate(${geom.leftX}, ${slBannerY})`}
                          className="pointer-events-none"
                        >
                          <rect
                            x={0}
                            y={0}
                            width={slBannerWidth}
                            height={16}
                            rx={2}
                            fill={ohlcStatus.status === 'SL_HIT' ? '#F23645' : '#131722'}
                            fillOpacity={0.94}
                            stroke="#F23645"
                            strokeWidth={1}
                          />
                          <text
                            x={6}
                            y={11}
                            fill="#FFFFFF"
                            fontSize="8.5"
                            fontWeight="600"
                          >
                            {slBannerText}
                          </text>
                        </g>
                      </>
                    )}

                    {/* Right Price Axis Labels for TP (#089981), Entry (#363A45), and SL (#F23645) */}
                    <g transform={`translate(${rightBadgeX}, ${geom.tpY - 8})`}>
                      <rect x={0} y={0} width={52} height={16} rx={2} fill="#089981" />
                      <text
                        x={26}
                        y={11}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="9"
                        fontWeight="700"
                      >
                        {norm.tpPrice.toFixed(activePairMeta.decimals)}
                      </text>
                    </g>
                    <g transform={`translate(${rightBadgeX}, ${geom.entryY - 8})`}>
                      <rect x={0} y={0} width={52} height={16} rx={2} fill="#363A45" />
                      <text
                        x={26}
                        y={11}
                        textAnchor="middle"
                        fill="#F8FAFC"
                        fontSize="9"
                        fontWeight="700"
                      >
                        {norm.entryPrice.toFixed(activePairMeta.decimals)}
                      </text>
                    </g>
                    <g transform={`translate(${rightBadgeX}, ${geom.slY - 8})`}>
                      <rect x={0} y={0} width={52} height={16} rx={2} fill="#F23645" />
                      <text
                        x={26}
                        y={11}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="9"
                        fontWeight="700"
                      >
                        {norm.slPrice.toFixed(activePairMeta.decimals)}
                      </text>
                    </g>

                    {/* Clean TradingView Anchor Handles when selected */}
                    {isSelected && (
                      <>
                        {renderAnchorHandle(p1, 'p1')}
                        {renderAnchorHandle({ x: geom.rightEdgeX, y: geom.entryY }, 'p2')}
                        {renderAnchorHandle({ x: geom.leftX + geom.boxWidth / 2, y: geom.tpY }, 'tp')}
                        {renderAnchorHandle({ x: geom.leftX + geom.boxWidth / 2, y: geom.slY }, 'sl')}
                      </>
                    )}
                  </g>
                );
              }

              // 9. CATATAN HARGA ('price_note')
              if (item.type === 'price_note') {
                const priceText = item.p1.price.toFixed(activePairMeta.decimals);
                const boxW = Math.max(58, priceText.length * 7.2 + 18);
                const boxH = 22;

                return (
                  <g key={item.id} data-testid="rendered-drawing-price_note">
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={strokeColor}
                      strokeWidth={baseLineWidth}
                    />
                    <circle
                      cx={p1.x}
                      cy={p1.y}
                      r={3}
                      fill="#131722"
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                    <g
                      transform={`translate(${p2.x}, ${p2.y - boxH / 2})`}
                      className="pointer-events-auto cursor-move touch-none"
                      onPointerDown={(e) => startHandleDrag(e, item, 'body')}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={boxW}
                        height={boxH}
                        rx={3}
                        fill="#131722"
                        stroke={strokeColor}
                        strokeWidth={isSelected ? 1.6 : 1.2}
                      />
                      <text
                        x={boxW / 2}
                        y={14.5}
                        textAnchor="middle"
                        fill="#F8FAFC"
                        fontSize="10"
                        fontWeight="700"
                      >
                        {priceText}
                      </text>
                    </g>

                    {isSelected && (
                      <>
                        {renderAnchorHandle(p1, 'p1')}
                        {renderAnchorHandle(p2, 'p2')}
                      </>
                    )}
                  </g>
                );
              }

              // 10. PENGGARIS PENGUKUR CEPAT ('ruler' — Transient Measure Box: Pips, %, & Bar Count)
              if (item.type === 'ruler' && p2) {
                const rulerMetrics = computeRulerMetrics(
                  { ...item.p1, logical: resolvedP1Logical },
                  { ...item.p2, logical: effectiveP2Logical },
                  item.pair || activePairMeta.label,
                  activePairMeta.decimals,
                  activeTimeframeSeconds,
                  settings?.xauusdPipSize ?? 0.1
                );
                const rx = Math.min(p1.x, p2.x);
                const ry = Math.min(p1.y, p2.y);
                const rw = Math.max(4, Math.abs(p2.x - p1.x));
                const rh = Math.max(4, Math.abs(p2.y - p1.y));
                const accentHex = rulerMetrics.isPositive ? '#2962FF' : '#F23645';
                const fillRgba = rulerMetrics.isPositive
                  ? 'rgba(41, 98, 255, 0.16)'
                  : 'rgba(242, 54, 69, 0.16)';
                const midX = rx + rw / 2;
                const midY = ry + rh / 2;
                const line1Text = `${rulerMetrics.formattedPriceDelta} (${rulerMetrics.formattedPips}) · ${rulerMetrics.formattedPct}`;
                const line2Text = `${rulerMetrics.barCount} bar (${rulerMetrics.durationLabel})`;
                const badgeW = Math.max(146, Math.round(line1Text.length * 5.8 + 18));
                const badgeH = 32;
                const badgeX = Math.max(6, Math.min(svgWidth - badgeW - 60, midX - badgeW / 2));
                const badgeY = p2.y <= p1.y ? Math.max(8, ry - badgeH - 6) : Math.min(svgHeight - badgeH - 28, ry + rh + 6);

                return (
                  <g
                    key={item.id}
                    data-testid="rendered-drawing-ruler"
                    data-pips={rulerMetrics.pips}
                    data-bars={rulerMetrics.barCount}
                  >
                    <rect
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      fill={fillRgba}
                      stroke={accentHex}
                      strokeWidth={1.25}
                      strokeDasharray="4 3"
                      className="pointer-events-auto cursor-move touch-none"
                      onPointerDown={(e) => startHandleDrag(e, item, 'body')}
                    />
                    {/* Cross-measurement guide lines inside box */}
                    <line
                      x1={midX}
                      y1={ry}
                      x2={midX}
                      y2={ry + rh}
                      stroke={accentHex}
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                    <line
                      x1={rx}
                      y1={midY}
                      x2={rx + rw}
                      y2={midY}
                      stroke={accentHex}
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                    {/* TradingView Ruler Metrics Callout Pill */}
                    <g transform={`translate(${badgeX}, ${badgeY})`} className="pointer-events-none">
                      <rect
                        x={0}
                        y={0}
                        width={badgeW}
                        height={badgeH}
                        rx={4}
                        fill="#131722"
                        stroke={accentHex}
                        strokeWidth={1.2}
                      />
                      <text
                        x={badgeW / 2}
                        y={13}
                        textAnchor="middle"
                        fill="#F8FAFC"
                        fontSize="9.5"
                        fontWeight="700"
                      >
                        {line1Text}
                      </text>
                      <text
                        x={badgeW / 2}
                        y={25}
                        textAnchor="middle"
                        fill="#D1D4DC"
                        fontSize="8.5"
                        fontWeight="600"
                      >
                        {line2Text}
                      </text>
                    </g>
                    {renderAnchorHandle(p1, 'p1')}
                    {renderAnchorHandle(p2, 'p2')}
                  </g>
                );
              }

              return null;
            })}
        </svg>

        {/* =====================================================================
            BAGIAN 3.1: BOTTOM SHEET DRAWER "GAMBAR" (#18181b, rounded-t-2xl)
            ===================================================================== */}
        {showDrawingToolbar && (
          <div
            data-testid="drawing-tools-bottom-sheet-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Menu Gambar TradingView"
            className="absolute inset-0 z-50 flex flex-col justify-end bg-black/60 select-none"
            onClick={() => setShowDrawingToolbar(false)}
          >
            <div
              data-testid="drawing-tools-bottom-sheet"
              onClick={(e) => e.stopPropagation()}
              className="w-full h-[85%] max-h-[85%] bg-[#131722] rounded-t-xl z-50 flex flex-col overflow-hidden border-t border-white/[0.08] shadow-2xl"
            >
              {/* Bagian Paling Atas: Garis handle horizontal kecil abu-abu di tengah atas */}
              <div className="w-10 h-1 bg-[#363A45] rounded-full mx-auto my-3 shrink-0" />

              {/* Judul: Teks "Gambar" berukuran besar dan tebal */}
              <div className="flex items-center justify-between px-4 mb-3 shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-[#F8FAFC] tracking-tight">
                    {tr('Gambar', 'Drawings')}
                  </h2>
                  <button
                    type="button"
                    data-testid="drawing-sheet-magnet-btn"
                    onClick={toggleMagnetMode}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      isMagnetActive
                        ? 'bg-[#2A2E39] text-white border border-white/15'
                        : 'bg-[#1E222D] text-[#868993] hover:text-white border border-white/[0.06]'
                    }`}
                    title={tr('Snap gambar ke titik OHLC candle terdekat', 'Snap drawing to nearest candle OHLC')}
                  >
                    <Magnet className="h-3.5 w-3.5" />
                    <span>{isMagnetActive ? tr('Magnet Aktif', 'Magnet ON') : tr('Magnet Mati', 'Magnet OFF')}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="drawing-sheet-ruler-btn"
                    onClick={() => handleSelectToolFromMenu('ruler')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      activeDrawingTool === 'ruler'
                        ? 'bg-[#2A2E39] text-white border border-white/15'
                        : 'bg-[#1E222D] text-[#D1D4DC] hover:text-white border border-white/[0.06]'
                    }`}
                    title={tr(
                      'Penggaris Cepat (Ukur Pips, %, & Jumlah Bar tanpa memenuhi penyimpanan)',
                      'Quick Ruler (Measure Pips, %, & Bar Count without cluttering storage)'
                    )}
                  >
                    <Ruler className="h-3.5 w-3.5" />
                    <span>{tr('Penggaris', 'Ruler')}</span>
                  </button>
                </div>
                {pairDrawings.length > 0 && (
                  <button
                    type="button"
                    data-testid="drawing-tool-clear-all"
                    onClick={handleClearAllDrawingsForPair}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1E222D] hover:bg-[#F23645]/15 border border-white/[0.06] text-[11px] font-medium text-[#868993] hover:text-[#F23645] transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{tr('Hapus Semua', 'Clear All')}</span>
                  </button>
                )}
              </div>

              {/* Tab Kategori Horizontal (Scrollable Tabs) */}
              <div
                data-testid="drawing-sheet-tabs"
                className="flex items-center gap-1.5 px-4 pb-2.5 overflow-x-auto no-scrollbar shrink-0"
              >
                {DRAWING_SHEET_TABS.map((tab) => {
                  const isActiveTab = drawingSheetTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      data-testid={`drawing-sheet-tab-${tab}`}
                      onClick={() => setDrawingSheetTab(tab)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        isActiveTab
                          ? 'bg-[#2A2E39] text-white border border-white/15'
                          : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
                      }`}
                    >
                      {translateTabName(tab)}
                    </button>
                  );
                })}
              </div>

              {/* Daftar Kategori & Grid Kartu (2 Kolom grid-cols-2 gap-2.5 px-4 overflow-y-auto) */}
              <div
                className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 pb-6"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {filteredSheetTools.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#868993]">
                    {tr(
                      'Belum ada alat gambar favorit. Ketuk ikon bintang pada tab Peralatan untuk menambahkan.',
                      'No favorite drawing tools yet. Tap the star icon in the All Tools tab to add.'
                    )}
                  </div>
                ) : (
                  DRAWING_SECTIONS_ORDER.map((sectionName) => {
                    const toolsInSection = filteredSheetTools.filter(
                      (t) => t.section === sectionName
                    );
                    if (toolsInSection.length === 0) return null;

                    return (
                      <div key={sectionName} data-testid={`drawing-section-${sectionName}`}>
                        <h3 className="text-[11px] font-semibold text-[#868993] uppercase tracking-wider mt-4 mb-2">
                          {translateSectionName(sectionName)}
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {toolsInSection.map((tool) => {
                            const isFav = favoriteTools.includes(tool.id);
                            const isActiveTool = activeDrawingTool === tool.id;
                            return (
                              <div
                                key={tool.id}
                                role="button"
                                tabIndex={0}
                                data-testid={`drawing-tool-card-${tool.id}`}
                                onClick={() => handleSelectToolFromMenu(tool.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleSelectToolFromMenu(tool.id);
                                  }
                                }}
                                className={`rounded-lg p-3.5 flex flex-col items-center justify-center relative cursor-pointer transition-colors min-h-[88px] border ${
                                  isActiveTool
                                    ? 'bg-[#2A2E39] border-white/25 text-white'
                                    : 'bg-[#1E222D] hover:bg-[#2A2E39] border-white/[0.06] text-[#D1D4DC]'
                                }`}
                              >
                                {/* Ikon Bintang di Pojok Kanan Atas Kartu */}
                                <button
                                  type="button"
                                  data-testid={`drawing-tool-star-${tool.id}`}
                                  aria-label={tr(`Favorit ${tool.name}`, `Favorite ${translateToolName(tool.name)}`)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleFavoriteTool(tool.id);
                                  }}
                                  className="absolute top-2 right-2 p-1 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                                >
                                  <Star
                                    className="h-3.5 w-3.5"
                                    style={{
                                      color: isFav ? '#F59E0B' : '#6B7280',
                                      fill: isFav ? '#F59E0B' : 'none',
                                    }}
                                  />
                                </button>

                                {/* Ikon Garis Khas TradingView di Tengah */}
                                <div className="text-[#F8FAFC] my-0.5">
                                  {renderTradingViewDrawingIcon(tool.id, 'w-7 h-7')}
                                </div>

                                {/* Nama Alat di Bawahnya */}
                                <span className="text-xs text-[#D1D4DC] mt-2 text-center font-medium leading-tight">
                                  {translateToolName(tool.name)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bagian Footer Bawah Drawer (Sticky Bottom) */}
              <div
                data-testid="drawing-sheet-footer"
                className="border-t border-white/[0.08] px-4 py-3 flex items-center justify-between bg-[#131722] shrink-0"
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative inline-flex items-center justify-center text-[#D1D4DC]">
                    <Pencil className="h-4 w-4 stroke-[1.8]" />
                    <Star className="h-2.5 w-2.5 text-[#F59E0B] fill-[#F59E0B] -ml-1 -mt-2" />
                  </div>
                  <span className="text-xs text-[#D1D4DC] font-medium">
                    {tr('Tampilkan favorit pada Chart', 'Show favorites on Chart')}
                  </span>
                </div>

                {/* Toggle Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={showFavoritesOnChart}
                  aria-label="Tampilkan favorit pada Chart"
                  data-testid="toggle-favorites-on-chart"
                  onClick={handleToggleShowFavoritesOnChart}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    showFavoritesOnChart ? 'bg-[#2962FF]' : 'bg-[#2A2E39]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      showFavoritesOnChart ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Indicators Popover (Opened by Activity icon in Bottom Control Bar) */}
        {isIndicatorsOpen && (
          <div
            data-testid="market-chart-indicators-modal"
            role="dialog"
            aria-modal="true"
            aria-label={tr('Indikator Teknis', 'Technical Indicators')}
            className="absolute inset-0 z-30 flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/65"
            onClick={() => setIsIndicatorsOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-lg bg-[#131722] border border-white/[0.08] p-4 text-white shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.08]">
                <div>
                  <h2 className="text-sm font-bold tracking-tight text-[#F8FAFC]">
                    {tr('Indikator Teknikal', 'Technical Indicators')}
                  </h2>
                  <p className="text-[11px] text-[#868993]">
                    EMA 20/50, SMA 200, &amp; Session Box ({prefs.studies.length}{' '}
                    {tr('aktif', 'active')})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsIndicatorsOpen(false)}
                  aria-label={tr('Tutup panel indikator', 'Close indicators panel')}
                  className="p-1.5 rounded-md text-[#868993] hover:text-white hover:bg-[#2A2E39] cursor-pointer"
                >
                  <X className="h-4 w-4 stroke-[1.75]" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-1.5">
                {STUDY_PRESETS.map((study) => {
                  const active = prefs.studies.includes(study.id);
                  return (
                    <button
                      key={study.id}
                      type="button"
                      onClick={() =>
                        updatePrefs((prev) => ({
                          ...prev,
                          studies: active
                            ? prev.studies.filter((id) => id !== study.id)
                            : [...prev.studies, study.id],
                        }))
                      }
                      className={`px-3 py-2.5 rounded-md text-xs border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#2A2E39] text-white border-white/20 font-semibold'
                          : 'bg-[#1E222D] text-[#868993] border-white/[0.06] hover:border-white/15 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: study.color }}
                        />
                        <span className="truncate">{study.label}</span>
                      </div>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 stroke-[2.25] text-white" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Close isReplayMode fragment after Bottom Sheet Drawer "Gambar" and Indicators Modal */}
          </>
        )}

        {/* MoreHorizontal ('...') Menu Popover: Live Clean/Full View Controls, Candle Color Toggle, & Display Modes */}
        {isMoreMenuOpen && (
          <div
            data-testid="market-chart-mode-menu"
            role="dialog"
            aria-modal="true"
            aria-label={tr('Menu Pengaturan Chart', 'Chart Settings Menu')}
            className="absolute inset-0 z-30 flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/65"
            onClick={() => setIsMoreMenuOpen(false)}
          >
            <div
              className="w-full max-w-sm max-h-[86%] overflow-y-auto overscroll-contain rounded-lg bg-[#131722] border border-white/[0.08] p-4 text-white shadow-2xl space-y-3.5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <div>
                  <h2 className="text-sm font-bold tracking-tight text-[#F8FAFC]">
                    {isLiveMode
                      ? tr('Pengaturan Live Advance Chart', 'Live Advance Chart Settings')
                      : tr('Pengaturan Replay Chart', 'Replay Chart Settings')}
                  </h2>
                  <p className="text-[11px] text-[#868993]">
                    {isLiveMode
                      ? tr(
                          'Tampilan penuh bersih, toolbar TradingView, dan warna candle',
                          'Clean full view, TradingView toolbar, and candle colors'
                        )
                      : tr(
                          'Warna candlestick, mode layar, dan reset skala',
                          'Candlestick colors, screen mode, and scale reset'
                        )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMoreMenuOpen(false)}
                  aria-label={tr('Tutup menu opsi chart', 'Close chart options menu')}
                  data-testid="market-chart-mode-menu-close"
                  className="p-1.5 rounded-md text-[#868993] hover:text-white hover:bg-[#2A2E39] cursor-pointer"
                >
                  <X className="h-4 w-4 stroke-[1.75]" />
                </button>
              </div>

              {/* BAGIAN 2.3: OPSI TAMPILAN PENUH / CLEAN MODE DI MODE LIVE ADVANCE */}
              {isLiveMode && (
                <div className="space-y-2 pb-2.5 border-b border-white/[0.08]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#868993] block">
                    {tr(
                      'Opsi Tampilan Penuh / Bersih (Live Advance)',
                      'Full / Clean View Options (Live Advance)'
                    )}
                  </span>

                  {/* Tombol Sekali Klik: Tampilan Penuh / Sembunyikan Toolbar Samping & Atas */}
                  <button
                    type="button"
                    data-testid="live-clean-full-view-btn"
                    onClick={() => {
                      const nextClean = !(isLiveCleanView && !showLiveDrawingTools);
                      if (nextClean) {
                        setShowLiveDrawingTools(false);
                        setIsLiveCleanView(true);
                      } else {
                        setIsLiveCleanView(false);
                      }
                      setIsMoreMenuOpen(false);
                    }}
                    className={`w-full py-2.5 px-3 rounded-md text-xs border flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isLiveCleanView && !showLiveDrawingTools
                        ? 'bg-[#2A2E39] text-white border-white/20 font-semibold'
                        : 'bg-[#1E222D] text-[#D1D4DC] border-white/[0.06] hover:border-white/15 font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Maximize2 className="h-3.5 w-3.5 text-[#D1D4DC]" />
                      <span>
                        {tr(
                          'Sembunyikan Toolbar Samping & Atas (Bersih)',
                          'Hide Side & Top Toolbars (Clean View)'
                        )}
                      </span>
                    </div>
                    {isLiveCleanView && !showLiveDrawingTools && (
                      <Check className="h-4 w-4 text-white shrink-0" />
                    )}
                  </button>

                  {/* Granular Toggles for Live Widget Toolbars & Sub-Header */}
                  <div className="grid grid-cols-1 gap-1.5 pt-1">
                    <button
                      type="button"
                      data-testid="toggle-live-side-toolbar"
                      onClick={() => setShowLiveDrawingTools((prev) => !prev)}
                      className="px-3 py-2 rounded-md bg-[#1E222D] border border-white/[0.06] text-xs flex items-center justify-between text-[#D1D4DC] hover:text-white cursor-pointer"
                    >
                      <span>{tr('Alat Gambar Samping (TradingView)', 'Side Drawing Tools (TradingView)')}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          showLiveDrawingTools
                            ? 'bg-[#2A2E39] text-white border border-white/15'
                            : 'bg-[#131722] text-[#868993]'
                        }`}
                      >
                        {showLiveDrawingTools ? tr('MUNCUL', 'VISIBLE') : tr('SEMBUNYI', 'HIDDEN')}
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid="toggle-live-clean-view"
                      onClick={() => setIsLiveCleanView((prev) => !prev)}
                      className="px-3 py-2 rounded-md bg-[#1E222D] border border-white/[0.06] text-xs flex items-center justify-between text-[#D1D4DC] hover:text-white cursor-pointer"
                    >
                      <span>{tr('Sembunyikan Bar Atas Widget', 'Hide Widget Top Bar')}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          isLiveCleanView
                            ? 'bg-[#2A2E39] text-white border border-white/15'
                            : 'bg-[#131722] text-[#868993]'
                        }`}
                      >
                        {isLiveCleanView ? tr('AKTIF', 'ON') : tr('MATI', 'OFF')}
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid="toggle-hide-top-subbar"
                      onClick={() => setHideTopSubBar((prev) => !prev)}
                      className="px-3 py-2 rounded-md bg-[#1E222D] border border-white/[0.06] text-xs flex items-center justify-between text-[#D1D4DC] hover:text-white cursor-pointer"
                    >
                      <span>{tr('Sembunyikan Sub-Header Atas (Imersif)', 'Hide Top Sub-Header (Immersive)')}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          hideTopSubBar
                            ? 'bg-[#2A2E39] text-white border border-white/15'
                            : 'bg-[#131722] text-[#868993]'
                        }`}
                      >
                        {hideTopSubBar ? tr('SEMBUNYI', 'HIDDEN') : tr('TAMPIL', 'VISIBLE')}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* 1. Pilihan Warna Candlestick: Monokrom Pro (Putih/Hitam) vs Klasik (Hijau/Merah) */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#868993] block">
                  {tr('Gaya Warna Candlestick', 'Candlestick Color Style')}
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    data-testid="candle-style-monochrome-btn"
                    onClick={() =>
                      updatePrefs((prev) => ({ ...prev, candleColorStyle: 'monochrome' }))
                    }
                    className={`py-2 px-2.5 rounded-md text-xs border flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      prefs.candleColorStyle !== 'classic'
                        ? 'bg-[#2A2E39] text-white border-white/20 font-semibold'
                        : 'bg-[#1E222D] text-[#868993] border-white/[0.06] hover:border-white/15 hover:text-white'
                    }`}
                  >
                    <span className="h-3 w-3 rounded-xs bg-white border border-neutral-400" />
                    <span>{tr('Monokrom Pro', 'Monochrome Pro')}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="candle-style-classic-btn"
                    onClick={() =>
                      updatePrefs((prev) => ({ ...prev, candleColorStyle: 'classic' }))
                    }
                    className={`py-2 px-2.5 rounded-md text-xs border flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      prefs.candleColorStyle === 'classic'
                        ? 'bg-[#2A2E39] text-white border-white/20 font-semibold'
                        : 'bg-[#1E222D] text-[#868993] border-white/[0.06] hover:border-white/15 hover:text-white'
                    }`}
                  >
                    <span className="h-3 w-3 rounded-xs bg-[#089981]" />
                    <span>{tr('Hijau / Merah', 'Green / Red')}</span>
                  </button>
                </div>
              </div>

              {/* 2. Mode Tampilan Layar */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#868993] block">
                  {tr('Mode Layar', 'Screen Mode')}
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {DISPLAY_MODE_OPTIONS.map((option) => {
                    const isSelected = displayMode === option.id;
                    const ModeIcon =
                      option.id === 'normal'
                        ? LayoutTemplate
                        : option.id === 'full'
                          ? Maximize2
                          : Smartphone;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        data-testid={`chart-mode-option-${option.id}`}
                        onClick={() => {
                          setDisplayMode(option.id);
                          saveStoredDisplayMode(option.id);
                          if (option.id === 'normal') {
                            setHideTopSubBar(false);
                          }
                          setIsMoreMenuOpen(false);
                          measureViewportAndBounds();
                        }}
                        className={`p-2 rounded-md border text-center flex flex-col items-center gap-1 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#2A2E39] text-white border-white/20 font-semibold'
                            : 'bg-[#1E222D] text-[#868993] border-white/[0.06] hover:border-white/15 hover:text-white'
                        }`}
                      >
                        <ModeIcon
                          className={`h-3.5 w-3.5 ${option.id === 'landscape' ? 'rotate-90' : ''}`}
                        />
                        <span className="text-[11px]">{option.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Twelve Data API Key Configuration (Only shown in Replay Mode) */}
              {isReplayMode && (
                <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#868993]">
                      Twelve Data API Key (Candle OANDA/Forex)
                    </span>
                    <span className="text-[10px] font-semibold text-[#089981]">
                      {candleSource === 'twelvedata'
                        ? tr('● Terhubung', '● Connected')
                        : tr('● Siap', '● Ready')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={tr(
                        'Masukkan API Key Twelve Data...',
                        'Enter Twelve Data API Key...'
                      )}
                      data-testid="twelve-data-api-key-input"
                      className="flex-1 h-8 px-2.5 rounded-md bg-[#1E222D] border border-white/[0.08] text-[11px] font-mono text-white focus:outline-none focus:border-white/25"
                    />
                    <button
                      type="button"
                      data-testid="twelve-data-api-key-save-btn"
                      onClick={() => {
                        saveStoredTwelveDataApiKey(apiKeyInput);
                        setApiKeySavedToast(true);
                        window.setTimeout(() => setApiKeySavedToast(false), 2000);
                        updatePrefs((prev) => ({ ...prev, updatedAt: new Date().toISOString() }));
                      }}
                      className="h-8 px-2.5 rounded-md bg-[#2A2E39] hover:bg-[#363A45] border border-white/15 text-white text-[11px] font-semibold cursor-pointer shrink-0 transition-colors"
                    >
                      {apiKeySavedToast ? tr('Tersimpan!', 'Saved!') : tr('Simpan', 'Save')}
                    </button>
                  </div>
                  <p className="text-[10px] text-[#868993] leading-tight">
                    {tr(
                      'Digunakan pada mode Replay Studio agar struktur candle XAUUSD & Forex identik dengan pasar spot OANDA.',
                      'Used in Replay Studio mode so XAUUSD & Forex candle structures match OANDA spot market data.'
                    )}
                  </p>
                </div>
              )}

              {/* 4. Quick Actions: Reset Zoom Chart & Sinkron Akun */}
              <div
                className={`pt-2 border-t border-white/[0.08] grid ${
                  isReplayMode ? 'grid-cols-2' : 'grid-cols-1'
                } gap-1.5`}
              >
                {isReplayMode && (
                  <button
                    type="button"
                    data-testid="chart-reset-default-btn"
                    onClick={() => {
                      applyDefaultVisibleRange(chartApiRef.current, fullCandlesRef.current.length);
                      setIsMoreMenuOpen(false);
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md bg-[#1E222D] hover:bg-[#2A2E39] border border-white/[0.08] text-xs font-semibold text-[#D1D4DC] hover:text-white cursor-pointer transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>{tr('Reset Skala Chart', 'Reset Chart Scale')}</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="market-chart-sync-button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    setIsSyncModalOpen(true);
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md bg-[#1E222D] hover:bg-[#2A2E39] border border-white/[0.08] text-xs font-semibold text-[#D1D4DC] hover:text-white cursor-pointer transition-colors"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  <span>{tr('Sinkron Akun', 'Sync Account')}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Account Sync Modal */}
        {isSyncModalOpen && (
          <div
            data-testid="market-chart-sync-modal"
            role="dialog"
            aria-modal="true"
            aria-label={tr('Sinkronisasi Akun', 'Account Sync')}
            className="absolute inset-0 z-30 flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/65"
            onClick={() => setIsSyncModalOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-lg bg-[#131722] border border-white/[0.08] p-4 text-white shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <h2 className="text-sm font-bold text-[#F8FAFC]">
                  {tr('Sinkronisasi Akun Cloud', 'Cloud Account Sync')}
                </h2>
                <button
                  type="button"
                  onClick={() => setIsSyncModalOpen(false)}
                  data-testid="market-chart-sync-close"
                  className="p-1 rounded-md text-[#868993] hover:text-white hover:bg-[#2A2E39] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-3 rounded-md bg-[#1E222D] border border-white/[0.06] flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-md bg-[#131722] border border-white/[0.08] flex items-center justify-center text-white shrink-0">
                    {currentUser ? (
                      <UserCheck className="h-4 w-4" />
                    ) : (
                      <CloudOff className="h-4 w-4 text-[#868993]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-semibold block truncate text-[#F8FAFC]">
                      {currentUser
                        ? currentUser.email
                        : tr('Mode Lokal (Belum Masuk Akun)', 'Local Mode (Not Signed In)')}
                    </span>
                    <span className="text-[11px] text-[#868993] block">
                      {currentUser
                        ? cloudSyncStatus === 'syncing'
                          ? tr('Menyinkronkan ke cloud...', 'Syncing to cloud...')
                          : tr(
                              'Setelan chart tersinkron ke akun Anda',
                              'Chart settings synced to your account'
                            )
                        : tr(
                            'Masuk akun untuk sinkronisasi otomatis',
                            'Sign in for automatic synchronization'
                          )}
                    </span>
                  </div>
                </div>
                {currentUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSyncModalOpen(false);
                      onOpenAccount?.();
                    }}
                    className="px-2.5 py-1.5 rounded-md bg-[#2A2E39] hover:bg-[#363A45] border border-white/15 text-[11px] font-semibold shrink-0 cursor-pointer"
                  >
                    {tr('Akun', 'Account')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSyncModalOpen(false);
                      onOpenAuth?.();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white text-black text-[11px] font-semibold shrink-0 cursor-pointer"
                  >
                    <LogIn className="h-3 w-3" />
                    <span>{tr('Masuk', 'Sign In')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          FOCUSED TRADING WORKSPACE BOTTOM CONTROL BAR (Sections C.2, C.4, D, G)
          - Left: 2 Vertical 3D Wheel Pickers (Pair & Timeframe) + Tablet/Desktop Quick Pills
          - Right:
            * In LIVE Mode: Drawing Tools toggle (Pencil), Focus / Full View toggle, More Menu ('...')
            * In REPLAY Mode: Full Replay & Drawing Studio controls (Pencil, Scissors, Activity, More, Undo, Redo)
          ===================================================================== */}
      <div
        data-testid="market-chart-footer-bar"
        className={`${
          isLiveMode ? 'h-12' : 'h-13'
        } shrink-0 w-full px-2.5 sm:px-3.5 bg-[#131722] border-t border-white/[0.08] flex items-center justify-between gap-2 select-none`}
      >
        {/* LEFT & CENTER: 2 3D Wheel Pickers + Responsive Tablet/Desktop Quick Timeframe & Symbol Access */}
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 overflow-hidden">
          {/* a) Roda Gulir Pair: XAUUSD, BTCUSD, EURUSD, GBPUSD, USDIDR */}
          <div
            data-testid="wheel-picker-pair"
            role="spinbutton"
            aria-label="Roda Pilihan Pair"
            aria-valuetext={activePairItem.label}
            tabIndex={0}
            onTouchStart={handlePairTouchStart}
            onTouchMove={handlePairTouchMove}
            onPointerDown={handlePairPointerDown}
            onPointerMove={handlePairPointerMove}
            onPointerUp={handlePairPointerUp}
            onPointerCancel={handlePairPointerUp}
            onWheel={(e) => {
              stepPairWheel(e.deltaY > 0 ? 1 : -1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                stepPairWheel(-1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                stepPairWheel(1);
              }
            }}
            className={`relative ${
              isLiveMode ? 'h-10' : 'h-11'
            } min-w-[66px] px-1.5 flex flex-col items-center justify-between py-0.5 touch-none cursor-pointer select-none overflow-hidden shrink-0`}
          >
            {/* 3D Wheel Top & Bottom Gradient Shading */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-2.5 bg-gradient-to-b from-[#131722]/90 to-transparent z-10"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-t from-[#131722]/90 to-transparent z-10"
            />

            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!pairTouchMovedRef.current) stepPairWheel(-1);
                pairTouchMovedRef.current = false;
              }}
              className="text-[10px] text-[#5D606B] leading-none tracking-tight transition-all duration-150"
            >
              {prevPairItem.label}
            </span>

            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!pairTouchMovedRef.current) stepPairWheel(1);
                pairTouchMovedRef.current = false;
              }}
              className="text-[14px] sm:text-[15px] font-bold text-[#F8FAFC] leading-none tracking-tight transition-all duration-150"
            >
              {activePairItem.label}
            </span>

            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!pairTouchMovedRef.current) stepPairWheel(1);
                pairTouchMovedRef.current = false;
              }}
              className="text-[10px] text-[#5D606B] leading-none tracking-tight transition-all duration-150"
            >
              {nextPairItem.label}
            </span>
          </div>

          {/* b) Roda Gulir Timeframe: 1m, 3m, 5m, 15m, 1h, 4h, 1D */}
          <div
            data-testid="wheel-picker-timeframe"
            role="spinbutton"
            aria-label="Roda Pilihan Timeframe"
            aria-valuetext={activeTfItem.label}
            tabIndex={0}
            onTouchStart={handleTfTouchStart}
            onTouchMove={handleTfTouchMove}
            onPointerDown={handleTfPointerDown}
            onPointerMove={handleTfPointerMove}
            onPointerUp={handleTfPointerUp}
            onPointerCancel={handleTfPointerUp}
            onWheel={(e) => {
              stepTfWheel(e.deltaY > 0 ? 1 : -1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                stepTfWheel(-1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                stepTfWheel(1);
              }
            }}
            className={`relative ${
              isLiveMode ? 'h-10' : 'h-11'
            } min-w-[42px] px-1.5 flex flex-col items-center justify-between py-0.5 touch-none cursor-pointer select-none overflow-hidden shrink-0`}
          >
            {/* 3D Wheel Top & Bottom Gradient Shading */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-2.5 bg-gradient-to-b from-[#131722]/90 to-transparent z-10"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-t from-[#131722]/90 to-transparent z-10"
            />

            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!tfTouchMovedRef.current) stepTfWheel(-1);
                tfTouchMovedRef.current = false;
              }}
              className="text-[10px] text-[#5D606B] leading-none font-mono-numbers tabular-nums transition-all duration-150"
            >
              {prevTfItem.label}
            </span>

            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!tfTouchMovedRef.current) stepTfWheel(1);
                tfTouchMovedRef.current = false;
              }}
              className="text-[14px] sm:text-[15px] font-bold text-[#F8FAFC] leading-none font-mono-numbers tabular-nums transition-all duration-150"
            >
              {activeTfItem.label}
            </span>

            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!tfTouchMovedRef.current) stepTfWheel(1);
                tfTouchMovedRef.current = false;
              }}
              className="text-[10px] text-[#5D606B] leading-none font-mono-numbers tabular-nums transition-all duration-150"
            >
              {nextTfItem.label}
            </span>
          </div>

          {/* c) Responsive Tablet & Desktop Quick Timeframe Bar (Section C.2 & D.2/D.3) */}
          <div
            data-testid="responsive-timeframe-bar"
            className="hidden md:flex items-center gap-1 pl-2.5 ml-0.5 border-l border-white/[0.08] overflow-x-auto"
          >
            {WHEEL_TIMEFRAMES.map((tf, idx) => {
              const isSelectedTf = prefs.interval === tf.value;
              return (
                <button
                  key={tf.value}
                  type="button"
                  data-testid={`quick-tf-btn-${tf.label}`}
                  onClick={() => {
                    setWheelTfIndex(idx);
                    updatePrefs((prev) =>
                      prev.interval === tf.value ? prev : { ...prev, interval: tf.value }
                    );
                  }}
                  className={`h-7 px-2 rounded-md text-[11px] font-mono-numbers tabular-nums font-semibold transition-colors cursor-pointer shrink-0 ${
                    isSelectedTf
                      ? 'bg-[#2A2E39] text-white border border-white/15'
                      : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
                  }`}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>

          {/* d) Responsive Desktop Quick Symbol Bar (Section D.3: > 1024px) */}
          <div
            data-testid="responsive-symbol-bar"
            className="hidden lg:flex items-center gap-1 pl-2.5 ml-0.5 border-l border-white/[0.08] overflow-x-auto"
          >
            {WHEEL_PAIRS.map((pair, idx) => {
              const isSelectedPair = prefs.symbol.toUpperCase() === pair.symbol.toUpperCase();
              return (
                <button
                  key={pair.symbol}
                  type="button"
                  data-testid={`quick-pair-btn-${pair.label}`}
                  onClick={() => {
                    setWheelPairIndex(idx);
                    updatePrefs((prev) =>
                      prev.symbol === pair.symbol ? prev : { ...prev, symbol: pair.symbol }
                    );
                  }}
                  className={`h-7 px-2 rounded-md text-[11px] font-bold tracking-tight transition-colors cursor-pointer shrink-0 ${
                    isSelectedPair
                      ? 'bg-[#2A2E39] text-white border border-white/15'
                      : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
                  }`}
                >
                  {pair.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* SISI KANAN: Tombol Kontrol Sesuai Mode (Live vs Replay) */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* 1. Ikon Pencil:
              - Di Mode LIVE: Toggle Drawing Tools Bawaan TradingView di sisi kiri layar (setShowLiveDrawingTools)
              - Di Mode REPLAY: Buka/Tutup Bottom Sheet Menu "Gambar" */}
          <button
            type="button"
            onClick={() => {
              setIsIndicatorsOpen(false);
              setIsMoreMenuOpen(false);
              setIsSyncModalOpen(false);
              if (isLiveMode) {
                setShowLiveDrawingTools((prev) => !prev);
              } else {
                setShowDrawingToolbar((prev) => !prev);
              }
            }}
            data-testid="chart-toggle-drawing-tools-button"
            aria-label="Toggle Drawing Tools"
            aria-pressed={
              isLiveMode
                ? showLiveDrawingTools
                : showDrawingToolbar || activeDrawingTool !== 'cursor'
            }
            title={
              isLiveMode
                ? showLiveDrawingTools
                  ? 'Sembunyikan Drawing Tools Kiri TradingView'
                  : 'Tampilkan Drawing Tools Kiri TradingView'
                : 'Menu Gambar (Garis Tren, Fib Retracement, Posisi Pembelian/Penjualan, Persegi, Catatan Harga)'
            }
            className={`inline-flex items-center justify-center h-8.5 w-8.5 rounded-md transition-colors cursor-pointer touch-manipulation ${
              (
                isLiveMode
                  ? showLiveDrawingTools
                  : showDrawingToolbar || activeDrawingTool !== 'cursor'
              )
                ? 'bg-[#2A2E39] text-white border border-white/15'
                : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
            }`}
          >
            <Pencil className="h-4 w-4 stroke-[1.75]" />
          </button>

          {/* 2. Tombol Mode Fokus / Tampilan Penuh Langsung (Section C.4 & C.5) — Tanpa Re-Mount Iframe */}
          {isLiveMode && (
            <button
              type="button"
              onClick={() => {
                const nextMode: ChartDisplayMode = displayMode === 'normal' ? 'full' : 'normal';
                setDisplayMode(nextMode);
                saveStoredDisplayMode(nextMode);
                if (nextMode === 'normal') {
                  setHideTopSubBar(false);
                }
                measureViewportAndBounds();
              }}
              data-testid="chart-focus-mode-button"
              aria-label={displayMode === 'normal' ? 'Mode Fokus / Tampilan Penuh' : 'Keluar Mode Fokus'}
              aria-pressed={displayMode !== 'normal'}
              title={
                displayMode === 'normal'
                  ? 'Mode Fokus / Tampilan Penuh (Maksimalkan Area Chart)'
                  : 'Keluar dari Mode Fokus'
              }
              className={`inline-flex items-center justify-center h-8.5 w-8.5 rounded-md transition-colors cursor-pointer touch-manipulation ${
                displayMode !== 'normal'
                  ? 'bg-[#2A2E39] text-white border border-white/15'
                  : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
              }`}
            >
              {displayMode === 'normal' ? (
                <Maximize2 className="h-4 w-4 stroke-[1.75]" />
              ) : (
                <Minimize2 className="h-4 w-4 stroke-[1.75]" />
              )}
            </button>
          )}

          {/* 3. Ikon Scissors & Activity: HANYA MUNCUL DI MODE REPLAY */}
          {isReplayMode && (
            <>
              {/* Ikon Scissors: Toggle Mode True Bar Replay */}
              <button
                type="button"
                onClick={handleToggleReplayMode}
                data-testid="chart-toggle-replay-button"
                aria-label="Toggle True Bar Replay"
                aria-pressed={replayPhase !== 'off'}
                title="True Bar Replay (Potong Candle & Putar Ulang)"
                className={`inline-flex items-center justify-center h-8.5 w-8.5 rounded-md transition-colors cursor-pointer touch-manipulation ${
                  replayPhase !== 'off'
                    ? 'bg-[#2A2E39] text-white border border-white/15'
                    : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
                }`}
              >
                <Scissors className="h-4 w-4 stroke-[1.75]" />
              </button>

              {/* Ikon Activity: Toggle Indikator Teknikal (EMA 20/50, SMA 200, Session Box) */}
              <button
                type="button"
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  setIsSyncModalOpen(false);
                  setIsIndicatorsOpen((prev) => !prev);
                }}
                data-testid="chart-bottom-indicators-button"
                aria-label="Indikator Teknikal"
                aria-expanded={isIndicatorsOpen}
                title="Indikator Teknikal (EMA 20/50, SMA 200, Session Box)"
                className={`relative inline-flex items-center justify-center h-8.5 w-8.5 rounded-md transition-colors cursor-pointer touch-manipulation ${
                  isIndicatorsOpen || prefs.studies.length > 0
                    ? 'bg-[#2A2E39] text-white border border-white/15'
                    : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
                }`}
              >
                <Activity className="h-4 w-4 stroke-[1.75]" />
                {prefs.studies.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-white" />
                )}
              </button>
            </>
          )}

          {/* 4. Ikon MoreHorizontal: Menu titik tiga (Tampilan Penuh/Bersih, Warna Candle, Mode Layar) */}
          <button
            type="button"
            onClick={() => {
              setIsIndicatorsOpen(false);
              setIsSyncModalOpen(false);
              setIsMoreMenuOpen((prev) => !prev);
            }}
            data-testid="market-chart-mode-selector-button"
            aria-label="Menu Pengaturan Chart"
            aria-expanded={isMoreMenuOpen}
            title="Opsi Tampilan Penuh / Bersih & Pengaturan Chart"
            className={`inline-flex items-center justify-center h-8.5 w-8.5 rounded-md transition-colors cursor-pointer touch-manipulation ${
              isMoreMenuOpen || displayMode !== 'normal' || (isLiveMode && isLiveCleanView)
                ? 'bg-[#2A2E39] text-white border border-white/15'
                : 'text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
            }`}
          >
            <MoreHorizontal className="h-4 w-4 stroke-[1.75]" />
          </button>

          {/* 5. Divider, Undo2 & Redo2: HANYA MUNCUL DI MODE REPLAY */}
          {isReplayMode && (
            <>
              <div aria-hidden="true" className="h-5 w-[1px] bg-white/[0.08] mx-0.5 shrink-0" />

              <button
                type="button"
                onClick={handleUndoDrawing}
                disabled={drawingUndoStack.length === 0}
                data-testid="chart-bottom-undo-button"
                aria-label="Undo gambar terakhir"
                title="Undo Gambar"
                className="inline-flex items-center justify-center h-8.5 w-8.5 rounded-md text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D] disabled:opacity-30 transition-colors cursor-pointer touch-manipulation"
              >
                <Undo2 className="h-4 w-4 stroke-[1.75]" />
              </button>

              <button
                type="button"
                onClick={handleRedoDrawing}
                disabled={drawingRedoStack.length === 0}
                data-testid="chart-bottom-redo-button"
                aria-label="Redo gambar"
                title="Redo Gambar"
                className="inline-flex items-center justify-center h-8.5 w-8.5 rounded-md text-[#868993] hover:text-[#D1D4DC] hover:bg-[#1E222D] disabled:opacity-30 transition-colors cursor-pointer touch-manipulation"
              >
                <Redo2 className="h-4 w-4 stroke-[1.75]" />
              </button>
            </>
          )}

          {/* Exit Immersive Mode / Restore Sub-Header Button */}
          {(displayMode !== 'normal' || hideTopSubBar) && (
            <button
              type="button"
              onClick={() => {
                setDisplayMode('normal');
                saveStoredDisplayMode('normal');
                setHideTopSubBar(false);
                measureViewportAndBounds();
              }}
              data-testid="chart-exit-mode-button"
              aria-label="Keluar ke Tampilan App"
              title="Kembalikan Sub-Header & Tampilan Normal"
              className="inline-flex items-center justify-center h-8.5 px-2 rounded-md bg-[#2A2E39] hover:bg-[#363A45] border border-white/15 text-white text-[11px] font-semibold transition-colors cursor-pointer touch-manipulation"
            >
              <Minimize2 className="h-3.5 w-3.5 stroke-[2]" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
