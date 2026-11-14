/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface XauUsdSeasonalityDataset {
  instrument: 'XAU/USD';
  /** October 2026 monthly close used as baseline for live November 2026 MoM % */
  prevMonthClose: number;
  currentTargetYear: number;
  /** 0-indexed month (10 = November) */
  currentTargetMonthIndex: number;
  /** Monthly Percentage Change (MoM %) keyed by year, index 0 = Jan .. 11 = Dec */
  monthlyPct: Record<number, number[]>;
  /** Major historical XAU/USD swing inflection dates (YYYY-MM-DD) for Monthly Fib Time Zones */
  majorSwingDates: string[];
}

export const MONTH_LABELS_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

export const MONTH_FULL_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

export const XAUUSD_SEASONALITY: XauUsdSeasonalityDataset = {
  instrument: 'XAU/USD',
  prevMonthClose: 3874.40,
  currentTargetYear: 2026,
  currentTargetMonthIndex: 10, // November 2026
  monthlyPct: {
    2018: [3.14, -1.72, 0.27, -0.58, -0.97, -4.06, -2.51, -1.01, -1.93, 2.89, 0.23, 5.01],
    2019: [3.19, 0.22, -2.59, -0.46, 0.84, 9.04, 1.23, 6.71, -2.55, 1.26, -3.32, 4.58],
    2020: [3.80, 2.88, -1.33, 6.99, 0.52, 2.61, 11.35, -0.06, -3.89, -0.74, -5.32, 6.47],
    2021: [-2.40, -6.54, -0.78, 3.06, 7.75, -6.99, 2.40, 0.09, -3.26, 1.55, -0.45, 2.97],
    2022: [-1.78, 5.82, 2.75, -2.12, -3.37, -1.61, -2.81, -3.28, -2.79, -1.72, 8.35, 3.15],
    2023: [5.69, -5.26, 7.82, 1.07, -1.28, -2.32, 2.33, -1.25, -4.71, 7.33, 3.07, 0.88],
    2024: [-1.15, 0.25, 9.17, 2.44, 1.81, -0.02, 3.57, 3.89, 6.43, 3.09, -3.48, -1.01],
    2025: [6.61, 2.79, 7.31, 6.06, 0.49, -0.70, 0.59, 3.96, 12.31, 4.34, 5.36, 2.49],
    2026: [12.56, 8.48, -11.51, -0.87, -1.89, -11.78, 0.87, 10.10, -6.60, -6.78, 0.24],
  },
  majorSwingDates: [
    '2020-03-01',
    '2020-08-01',
    '2022-10-01',
    '2023-10-01',
    '2026-02-01',
    '2026-06-01',
  ],
};

export interface MonthlySeasonalityStats {
  monthIndex: number;
  monthLabel: string;
  monthFullName: string;
  sampleYears: number;
  greenCount: number;
  redCount: number;
  winRatePct: number;
  avgReturnPct: number;
  bestReturnPct: number;
  worstReturnPct: number;
  liveMomPct: number;
  isOverextended: boolean;
  overextensionDirection: 'OVERBOUGHT' | 'OVERSOLD' | 'NONE';
}

/**
 * Computes real-time MoM % change against prevMonthClose (October 2026 close = 3874.40).
 * Falls back to the static dataset value for the target month if livePrice is unavailable.
 */
export function computeLiveMonthlyReturnPct(
  livePrice?: number | null,
  dataset: XauUsdSeasonalityDataset = XAUUSD_SEASONALITY
): number {
  if (typeof livePrice === 'number' && Number.isFinite(livePrice) && livePrice > 0 && dataset.prevMonthClose > 0) {
    return Number((((livePrice - dataset.prevMonthClose) / dataset.prevMonthClose) * 100).toFixed(2));
  }
  const arr = dataset.monthlyPct[dataset.currentTargetYear] || [];
  const fallback = arr[dataset.currentTargetMonthIndex];
  return typeof fallback === 'number' ? fallback : 0;
}

/**
 * Computes historical win-rate and return stats for a given month index (0 = Jan, 11 = Dec),
 * integrating livePrice into the active target month when available.
 */
export function computeMonthlySeasonalityStats(
  monthIndex: number = XAUUSD_SEASONALITY.currentTargetMonthIndex,
  livePrice?: number | null,
  dataset: XauUsdSeasonalityDataset = XAUUSD_SEASONALITY
): MonthlySeasonalityStats {
  const safeMonthIdx = Math.max(0, Math.min(11, Math.floor(monthIndex)));
  const years = Object.keys(dataset.monthlyPct)
    .map(Number)
    .sort((a, b) => a - b);

  const liveMomPct = computeLiveMonthlyReturnPct(livePrice, dataset);
  const values: number[] = [];

  for (const year of years) {
    const row = dataset.monthlyPct[year];
    if (!row) continue;
    if (year === dataset.currentTargetYear && safeMonthIdx === dataset.currentTargetMonthIndex) {
      values.push(liveMomPct);
    } else if (typeof row[safeMonthIdx] === 'number' && Number.isFinite(row[safeMonthIdx])) {
      values.push(row[safeMonthIdx]);
    }
  }

  const sampleYears = values.length;
  const greenCount = values.filter((v) => v > 0).length;
  const redCount = values.filter((v) => v < 0).length;
  const winRatePct = sampleYears > 0 ? Number(((greenCount / sampleYears) * 100).toFixed(1)) : 50;
  const avgReturnPct =
    sampleYears > 0
      ? Number((values.reduce((acc, v) => acc + v, 0) / sampleYears).toFixed(2))
      : 0;
  const bestReturnPct = sampleYears > 0 ? Math.max(...values) : 0;
  const worstReturnPct = sampleYears > 0 ? Math.min(...values) : 0;

  const isOverextended = Math.abs(liveMomPct) > 8.0;
  const overextensionDirection: MonthlySeasonalityStats['overextensionDirection'] = !isOverextended
    ? 'NONE'
    : liveMomPct > 8.0
    ? 'OVERBOUGHT'
    : 'OVERSOLD';

  return {
    monthIndex: safeMonthIdx,
    monthLabel: MONTH_LABELS_ID[safeMonthIdx] || 'Nov',
    monthFullName: MONTH_FULL_NAMES_ID[safeMonthIdx] || 'November',
    sampleYears,
    greenCount,
    redCount,
    winRatePct,
    avgReturnPct,
    bestReturnPct,
    worstReturnPct,
    liveMomPct,
    isOverextended,
    overextensionDirection,
  };
}
