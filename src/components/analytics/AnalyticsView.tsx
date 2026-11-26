/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  calculatePerformance,
  formatCurrency,
  formatProfitFactor,
  formatRMultiple,
  formatGrowthPercent,
  computePeriodTradesAndStartingBalance,
  extractTradeLocalDateKey,
  EquityPoint,
} from '../../utils/calculations';
import {
  useGlobalCurrency,
  computeCumulativeProfitInDisplayCurrency,
} from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { EquityChart } from '../dashboard/EquityChart';
import { DrawdownChart } from '../dashboard/DrawdownChart';
import { RadarChart } from '../dashboard/RadarChart';
import { PerformanceCalendar } from '../dashboard/PerformanceCalendar';
import {
  BarChart,
  RotateCcw,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  X,
  ChevronDown,
  Check,
  CalendarCheck2,
  Share2,
} from 'lucide-react';
import {
  computeBehavioralAnalytics,
  getMistakeLabel,
  getEmotionLabel,
} from '../../utils/journalExtras';
import { PeriodicReviewModal } from './PeriodicReviewModal';
import { PerformanceExportModal } from './PerformanceExportModal';

interface AnalyticsViewProps {
  trades: Trade[];
  settings: AppSettings;
  onViewTrade?: (trade: Trade) => void;
  onDeleteTradesByDate?: (payload: {
    dateKey: string;
    headerLabel?: string;
    trades: Trade[];
    source: 'calendar';
    isFilteredSubset?: boolean;
    totalTradesOnDate?: number;
  }) => void;
  userId?: string | null;
}

type PeriodPreset = 'ALL' | 'TODAY' | 'THIS_MONTH' | 'LAST_MONTH' | '7D' | '30D' | 'YTD' | 'CUSTOM';
type ChartRangeOption = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';
type BreakdownCategory = 'day' | 'session' | 'instrument';

/**
 * Filters an equityCurve by a relative chart timeframe ('1D', '1W', '1M', '3M', '6M', '1Y', 'ALL')
 * anchored to the latest trade date in the curve so historical journals work accurately.
 */
const filterEquityCurveByRange = (
  curve: EquityPoint[],
  range: ChartRangeOption
): EquityPoint[] => {
  if (!curve || curve.length <= 1 || range === 'ALL') return curve;

  const tradePoints = curve.filter((pt) => pt.index > 0);
  if (tradePoints.length === 0) return curve;

  const lastPoint = tradePoints[tradePoints.length - 1];
  const anchorKey = extractTradeLocalDateKey(lastPoint.date);
  if (!anchorKey) return curve;

  const anchorDate = new Date(anchorKey + 'T23:59:59');
  if (Number.isNaN(anchorDate.getTime())) return curve;

  const cutoff = new Date(anchorDate);
  if (range === '1D') cutoff.setDate(cutoff.getDate() - 1);
  else if (range === '1W') cutoff.setDate(cutoff.getDate() - 7);
  else if (range === '1M') cutoff.setMonth(cutoff.getMonth() - 1);
  else if (range === '3M') cutoff.setMonth(cutoff.getMonth() - 3);
  else if (range === '6M') cutoff.setMonth(cutoff.getMonth() - 6);
  else if (range === '1Y') cutoff.setFullYear(cutoff.getFullYear() - 1);

  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(
    cutoff.getDate()
  ).padStart(2, '0')}`;

  const matchingIndices: number[] = [];
  curve.forEach((pt, idx) => {
    if (pt.index === 0) return;
    const dKey = extractTradeLocalDateKey(pt.date);
    if (dKey && dKey >= cutoffKey) {
      matchingIndices.push(idx);
    }
  });

  if (matchingIndices.length === 0) {
    // Fallback to the baseline point right before the last trade
    return curve.slice(Math.max(0, curve.length - 2));
  }

  const firstIdx = matchingIndices[0];
  const baselineIdx = Math.max(0, firstIdx - 1);
  return curve.slice(baselineIdx);
};

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  trades,
  settings,
  onViewTrade,
  onDeleteTradesByDate,
  userId,
}) => {
  const { preferredCurrency, rateRecord, formatDynamic } = useGlobalCurrency();
  const { tr, isEn } = useLanguage();
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleCloseReviewModal = useCallback(() => setIsReviewModalOpen(false), []);
  const handleCloseExportModal = useCallback(() => setIsExportModalOpen(false), []);

  const chartRangeOptions: { id: ChartRangeOption; label: string }[] = useMemo(
    () => [
      { id: '1D', label: '1D' },
      { id: '1W', label: '1W' },
      { id: '1M', label: '1M' },
      { id: '3M', label: '3M' },
      { id: '6M', label: '6M' },
      { id: '1Y', label: '1Y' },
      { id: 'ALL', label: tr('Semua Waktu', 'All Time') },
    ],
    [tr]
  );

  // Global Analytics Period filter state
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodPreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [showPeriodDropdown, setShowPeriodDropdown] = useState<boolean>(false);

  // Section 02: Equity Curve independent pill dropdown states
  const [equityMode, setEquityMode] = useState<'equity' | 'growth'>('equity');
  const [equityRange, setEquityRange] = useState<ChartRangeOption>('ALL');
  const [openEquityDropdown, setOpenEquityDropdown] = useState<'mode' | 'range' | null>(null);

  // Section 02: Drawdown Curve independent pill dropdown states
  const [drawdownMode, setDrawdownMode] = useState<'percent' | 'nominal'>('percent');
  const [drawdownRange, setDrawdownRange] = useState<ChartRangeOption>('ALL');
  const [openDrawdownDropdown, setOpenDrawdownDropdown] = useState<'mode' | 'range' | null>(null);

  // Section 05: Performance Breakdown unified category selector
  const [breakdownCategory, setBreakdownCategory] = useState<BreakdownCategory>('day');
  const [showBreakdownDropdown, setShowBreakdownDropdown] = useState<boolean>(false);

  const periodMenuRef = useRef<HTMLDivElement | null>(null);
  const equityControlsRef = useRef<HTMLDivElement | null>(null);
  const drawdownControlsRef = useRef<HTMLDivElement | null>(null);
  const breakdownMenuRef = useRef<HTMLDivElement | null>(null);

  const anyDropdownOpen =
    showPeriodDropdown ||
    openEquityDropdown !== null ||
    openDrawdownDropdown !== null ||
    showBreakdownDropdown;

  useEffect(() => {
    if (!anyDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showPeriodDropdown && periodMenuRef.current && !periodMenuRef.current.contains(target)) {
        setShowPeriodDropdown(false);
      }
      if (openEquityDropdown !== null && equityControlsRef.current && !equityControlsRef.current.contains(target)) {
        setOpenEquityDropdown(null);
      }
      if (openDrawdownDropdown !== null && drawdownControlsRef.current && !drawdownControlsRef.current.contains(target)) {
        setOpenDrawdownDropdown(null);
      }
      if (showBreakdownDropdown && breakdownMenuRef.current && !breakdownMenuRef.current.contains(target)) {
        setShowBreakdownDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [anyDropdownOpen, showPeriodDropdown, openEquityDropdown, openDrawdownDropdown, showBreakdownDropdown]);

  // Privacy Mode state persisted in localStorage
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tradevault_privacy_mode') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const syncPrivacy = () => {
      try {
        setIsPrivacyMode(localStorage.getItem('tradevault_privacy_mode') === 'true');
      } catch {
        // Ignore storage read errors
      }
    };
    window.addEventListener('tradevault-privacy-change', syncPrivacy);
    window.addEventListener('storage', syncPrivacy);
    return () => {
      window.removeEventListener('tradevault-privacy-change', syncPrivacy);
      window.removeEventListener('storage', syncPrivacy);
    };
  }, []);

  const fmtMoney = useCallback(
    (valUsd: number, privacy: boolean = isPrivacyMode) =>
      preferredCurrency === 'IDR'
        ? formatDynamic(valUsd, privacy)
        : formatCurrency(valUsd, settings, privacy),
    [preferredCurrency, formatDynamic, settings, isPrivacyMode]
  );

  const togglePrivacyMode = () => {
    const next = !isPrivacyMode;
    setIsPrivacyMode(next);
    try {
      localStorage.setItem('tradevault_privacy_mode', String(next));
      window.dispatchEvent(new Event('tradevault-privacy-change'));
    } catch (err) {
      console.error('Failed to save privacy mode state:', err);
    }
  };

  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Handle preset period changes using local calendar dates
  const handlePeriodChange = (period: PeriodPreset) => {
    setSelectedPeriod(period);
    const now = new Date();

    if (period === 'ALL') {
      setStartDate('');
      setEndDate('');
    } else if (period === 'TODAY') {
      const todayStr = formatLocalDate(now);
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (period === '7D') {
      const past7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      setStartDate(formatLocalDate(past7));
      setEndDate(formatLocalDate(now));
    } else if (period === '30D') {
      const past30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      setStartDate(formatLocalDate(past30));
      setEndDate(formatLocalDate(now));
    } else if (period === 'THIS_MONTH') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(formatLocalDate(firstDay));
      setEndDate(formatLocalDate(now));
    } else if (period === 'LAST_MONTH') {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(formatLocalDate(firstDayLastMonth));
      setEndDate(formatLocalDate(lastDayLastMonth));
    } else if (period === 'YTD') {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      setStartDate(formatLocalDate(startOfYear));
      setEndDate(formatLocalDate(now));
    }
  };

  const handleCustomDateChange = (start: string, end: string) => {
    setSelectedPeriod('CUSTOM');
    setStartDate(start);
    setEndDate(end);
  };

  const handleResetFilters = () => {
    setSelectedPeriod('ALL');
    setStartDate('');
    setEndDate('');
  };

  const getPeriodLabel = (): string => {
    if (selectedPeriod === 'THIS_MONTH') return tr('Bulan Ini', 'This Month');
    if (selectedPeriod === 'LAST_MONTH') return tr('Bulan Lalu', 'Last Month');
    if (selectedPeriod === '7D') return tr('7 Hari Terakhir', 'Last 7 Days');
    if (selectedPeriod === '30D') return tr('30 Hari Terakhir', 'Last 30 Days');
    if (selectedPeriod === 'TODAY') return tr('Hari Ini', 'Today');
    if (selectedPeriod === 'YTD') return tr('Tahun Ini', 'This Year');
    if (startDate || endDate) return `${startDate || '...'} ${tr('s/d', 'to')} ${endDate || '...'}`;
    return tr('Semua Waktu', 'All Time');
  };

  // Filter trades based on active date range and compute true period starting balance
  const { filteredTrades, periodStartingBalance } = useMemo(() => {
    return computePeriodTradesAndStartingBalance(trades, settings, startDate, endDate);
  }, [trades, settings, startDate, endDate]);

  const periodSettings = useMemo(
    () => ({
      ...settings,
      startingBalance: periodStartingBalance,
    }),
    [settings, periodStartingBalance]
  );

  // Compute performance metrics strictly based on filtered trades
  const { metrics, equityCurve, dailyPerformance, monthlyPerformance, radarIndicators } =
    useMemo(() => {
      return calculatePerformance(filteredTrades, periodSettings);
    }, [filteredTrades, periodSettings]);

  const behavioral = useMemo(
    () => computeBehavioralAnalytics(filteredTrades),
    [filteredTrades]
  );

  const isNetProfitPositive = metrics.totalNetProfit >= 0.01;
  const isNetProfitNegative = metrics.totalNetProfit <= -0.01;
  const isJournalCompletelyEmpty = !trades || trades.length === 0;
  const hasClosedTradesInPeriod = metrics.totalTrades > 0;

  // Section 02A: Filtered Equity Curve & Dynamic Summary
  const rangedEquityCurve = useMemo(() => {
    return filterEquityCurveByRange(equityCurve, equityRange);
  }, [equityCurve, equityRange]);

  const equityRangeSummary = useMemo(() => {
    const label = chartRangeOptions.find((o) => o.id === equityRange)?.label || tr('Semua Waktu', 'All Time');
    if (!rangedEquityCurve || rangedEquityCurve.length <= 1) {
      return {
        label,
        tradesCount: 0,
        netDelta: 0,
        growthDelta: 0,
      };
    }
    const firstPt = rangedEquityCurve[0];
    const lastPt = rangedEquityCurve[rangedEquityCurve.length - 1];
    const tradesCount = Math.max(0, rangedEquityCurve.length - 1);
    const netDelta = Number((lastPt.equity - firstPt.equity).toFixed(2));
    const baseEq = firstPt.equity > 0 ? firstPt.equity : periodStartingBalance;
    const growthDelta = baseEq > 0 ? Number(((netDelta / baseEq) * 100).toFixed(2)) : 0;
    return {
      label,
      tradesCount,
      netDelta,
      growthDelta,
    };
  }, [rangedEquityCurve, equityRange, periodStartingBalance, chartRangeOptions, tr]);

  // Section 02B: Filtered Drawdown Curve & Dynamic Summary (Current DD, Max DD, Recovery %)
  const rangedDrawdownCurve = useMemo(() => {
    return filterEquityCurveByRange(equityCurve, drawdownRange);
  }, [equityCurve, drawdownRange]);

  const drawdownSummary = useMemo(() => {
    const label = chartRangeOptions.find((o) => o.id === drawdownRange)?.label || tr('Semua Waktu', 'All Time');
    if (!rangedDrawdownCurve || rangedDrawdownCurve.length <= 1) {
      return {
        label,
        currentDdPct: 0,
        currentDdAmt: 0,
        maxDdPct: 0,
        maxDdAmt: 0,
        recoveryPct: 100,
      };
    }
    const lastPt = rangedDrawdownCurve[rangedDrawdownCurve.length - 1];
    const currentDdPct = Number((lastPt.drawdownPercent || 0).toFixed(2));
    const currentDdAmt = Number((lastPt.drawdownAmount || 0).toFixed(2));
    const maxDdPct = Number(
      Math.max(...rangedDrawdownCurve.map((d) => d.drawdownPercent || 0), 0).toFixed(2)
    );
    const maxDdAmt = Number(
      Math.max(...rangedDrawdownCurve.map((d) => d.drawdownAmount || 0), 0).toFixed(2)
    );
    // Recovery %: 100% if back at peak (currentDD == 0); else (1 - currentDD / maxDD) * 100
    const recoveryPct =
      maxDdPct <= 0.0001
        ? 100
        : Math.max(0, Math.min(100, Math.round((1 - currentDdPct / maxDdPct) * 100)));

    return {
      label,
      currentDdPct,
      currentDdAmt,
      maxDdPct,
      maxDdAmt,
      recoveryPct,
    };
  }, [rangedDrawdownCurve, drawdownRange, chartRangeOptions, tr]);

  // Section 05: Day of Week Performance (Senin - Jumat / Monday - Friday)
  const dayOfWeekStats = useMemo(() => {
    const dayNames = [
      tr('Minggu', 'Sunday'),
      tr('Senin', 'Monday'),
      tr('Selasa', 'Tuesday'),
      tr('Rabu', 'Wednesday'),
      tr('Kamis', 'Thursday'),
      tr('Jumat', 'Friday'),
      tr('Sabtu', 'Saturday'),
    ];
    const map: Record<
      number,
      { dayName: string; trades: Trade[]; netProfit: number; winCount: number; lossCount: number }
    > = {};
    for (let i = 1; i <= 5; i++) {
      map[i] = { dayName: dayNames[i], trades: [], netProfit: 0, winCount: 0, lossCount: 0 };
    }

    filteredTrades.forEach((t) => {
      const dateKey = extractTradeLocalDateKey(t.dateTime);
      if (!dateKey) return;
      const d = new Date(dateKey + 'T00:00:00');
      const day = d.getDay();
      if (day >= 1 && day <= 5) {
        map[day].trades.push(t);
        map[day].netProfit += t.netProfit || 0;
        if ((t.netProfit || 0) > 0.01) map[day].winCount++;
        else if ((t.netProfit || 0) < -0.01) map[day].lossCount++;
      }
    });

    return Object.values(map).map((item) => {
      const total = item.trades.length;
      const winRate = total > 0 ? Math.round((item.winCount / total) * 100) : 0;
      return {
        ...item,
        total,
        winRate,
        netProfit: Number(item.netProfit.toFixed(2)),
      };
    });
  }, [filteredTrades, tr]);

  // Section 05: Session Performance (Asian, London, New York)
  const sessionStats = useMemo(() => {
    const sessions = [
      { id: 'Asian', label: tr('Asia', 'Asian'), desc: 'Tokyo & Sydney' },
      { id: 'London', label: 'London', desc: tr('Eropa / UK', 'Europe / UK') },
      { id: 'New York', label: 'New York', desc: tr('Amerika / US', 'America / US') },
    ];

    return sessions.map((sess) => {
      const matchingTrades = filteredTrades.filter((t) => {
        const s = (t.session || '').toLowerCase();
        if (sess.id === 'Asian') return s.includes('asia') || s.includes('tokyo') || s.includes('sydney');
        if (sess.id === 'London') return s.includes('london') || s.includes('eropa') || s.includes('europe');
        if (sess.id === 'New York') return s.includes('new york') || s.includes('ny') || s.includes('us');
        return false;
      });

      const total = matchingTrades.length;
      let grossWin = 0;
      let grossLoss = 0;
      let winCount = 0;
      let lossCount = 0;
      let netProfit = 0;

      matchingTrades.forEach((t) => {
        netProfit += t.netProfit || 0;
        if ((t.netProfit || 0) > 0.01) {
          winCount++;
          grossWin += t.grossProfit || t.netProfit || 0;
        } else if ((t.netProfit || 0) < -0.01) {
          lossCount++;
          grossLoss += Math.abs(t.grossProfit || t.netProfit || 0);
        }
      });

      const winRate = total > 0 ? Math.round((winCount / total) * 100) : 0;
      const profitFactor =
        grossLoss > 0
          ? Number((grossWin / grossLoss).toFixed(2))
          : grossWin > 0
          ? Infinity
          : 0;

      return {
        id: sess.id,
        label: sess.label,
        desc: sess.desc,
        total,
        winCount,
        lossCount,
        winRate,
        netProfit: Number(netProfit.toFixed(2)),
        profitFactor,
      };
    });
  }, [filteredTrades, tr]);

  // Section 05: Symbol / Instrument Performance
  const symbolStats = useMemo(() => {
    const map: Record<
      string,
      { symbol: string; trades: Trade[]; netProfit: number; winCount: number; lossCount: number }
    > = {};

    filteredTrades.forEach((t) => {
      const sym = (t.instrument || 'XAUUSD').toUpperCase();
      if (!map[sym]) {
        map[sym] = { symbol: sym, trades: [], netProfit: 0, winCount: 0, lossCount: 0 };
      }
      map[sym].trades.push(t);
      map[sym].netProfit += t.netProfit || 0;
      if ((t.netProfit || 0) > 0.01) map[sym].winCount++;
      else if ((t.netProfit || 0) < -0.01) map[sym].lossCount++;
    });

    return Object.values(map)
      .map((item) => {
        const total = item.trades.length;
        const winRate = total > 0 ? Math.round((item.winCount / total) * 100) : 0;
        const avgProfit = total > 0 ? Number((item.netProfit / total).toFixed(2)) : 0;
        return {
          symbol: item.symbol,
          total,
          winRate,
          winCount: item.winCount,
          lossCount: item.lossCount,
          netProfit: Number(item.netProfit.toFixed(2)),
          avgProfit,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [filteredTrades]);

  // Section 03: 6 Pillars Indicator List for Performance Profile
  const pillarList = useMemo(() => {
    const isSufficient = radarIndicators.isDataSufficient;
    return [
      {
        name: tr('Rasio Menang', 'Win Rate'),
        score: isSufficient ? radarIndicators.winRateScore : 0,
        isAvailable: isSufficient,
        displayVal: isSufficient ? `${metrics.winRate}%` : '-',
        target: tr('Target: ≥ 50%', 'Target: ≥ 50%'),
      },
      {
        name: tr('Faktor Profit', 'Profit Factor'),
        score: isSufficient ? radarIndicators.profitFactorScore : 0,
        isAvailable: isSufficient,
        displayVal: isSufficient
          ? formatProfitFactor(metrics.profitFactor, metrics.isProfitFactorInfinite)
          : '-',
        target: tr('Target: ≥ 1.50', 'Target: ≥ 1.50'),
      },
      {
        name: tr('Rata-rata RR', 'Average RR'),
        score: isSufficient && metrics.hasValidRiskReward ? radarIndicators.rewardRiskScore : 0,
        isAvailable: isSufficient && metrics.hasValidRiskReward,
        displayVal: isSufficient
          ? formatRMultiple(metrics.averageRiskReward, metrics.hasValidRiskReward)
          : '-',
        target: tr('Target: ≥ 1.00R', 'Target: ≥ 1.00R'),
      },
      {
        name: tr('Ekspektansi', 'Expectancy'),
        score: isSufficient ? radarIndicators.expectancyScore : 0,
        isAvailable: isSufficient,
        displayVal: isSufficient
          ? fmtMoney(metrics.expectancy, isPrivacyMode)
          : '-',
        target: preferredCurrency === 'IDR' ? 'Target: > Rp0' : 'Target: > $0',
      },
      {
        name: tr('Kontrol Risiko', 'Risk Control'),
        score: isSufficient
          ? radarIndicators.riskControlScore ?? radarIndicators.drawdownControlScore
          : 0,
        isAvailable: isSufficient,
        displayVal: isSufficient
          ? `${metrics.maxDrawdownPercent > 0 ? '-' : ''}${metrics.maxDrawdownPercent.toFixed(1)}% DD`
          : '-',
        target: tr('Target: DD ≤ 10%', 'Target: DD ≤ 10%'),
      },
      {
        name: tr('Konsistensi', 'Consistency'),
        score: isSufficient ? radarIndicators.consistencyScore : 0,
        isAvailable: isSufficient,
        displayVal: isSufficient ? `${radarIndicators.consistencyScore}%` : '-',
        target: tr('Target: ≥ 60% Hari Menang', 'Target: ≥ 60% Win Days'),
      },
    ];
  }, [radarIndicators, metrics, settings, isPrivacyMode, preferredCurrency, fmtMoney, tr]);

  const breakdownLabels: Record<BreakdownCategory, string> = {
    day: tr('Hari & Bulanan', 'Day & Monthly'),
    session: tr('Sesi Trading (Asia / London / NY)', 'Trading Session (Asia / London / NY)'),
    instrument: `${tr('Instrumen', 'Instruments')} (${symbolStats.length})`,
  };

  return (
    <div className="space-y-10 pb-8 font-sans">
      {/* Complete Empty State when Journal has 0 trades */}
      {isJournalCompletelyEmpty ? (
        <div className="py-16 px-4 flex flex-col items-center justify-center text-center space-y-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="p-3.5 rounded-2xl bg-[#FAFAFA] dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9]">
            <BarChart className="h-7 w-7 stroke-[1.75]" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7]">
            {tr('Belum Ada Data Transaksi untuk Dianalisis', 'No Trade Data Available for Analysis')}
          </h3>
          <p className="text-xs text-[#526071] dark:text-[#929BA9] max-w-md leading-relaxed">
            {tr(
              'Jurnal trading Anda masih kosong. Tambahkan transaksi melalui tombol ',
              'Your trading journal is still empty. Add a trade using the '
            )}
            <strong className="text-[#0F172A] dark:text-[#F2F4F7] font-semibold">
              {tr('(+) Tambah Transaksi', '(+) Add Trade')}
            </strong>
            {tr(
              ' di navigasi bawah untuk membuka statistik performa, kurva ekuitas, dan profil risiko.',
              ' button in the navigation bar to unlock performance statistics, equity curves, and risk profiles.'
            )}
          </p>
        </div>
      ) : (
        <>
          {/* =========================================================================
              SECTION 01 — PERFORMANCE OVERVIEW (SEAMLESS HERO & 6 METRICS)
             ========================================================================= */}
          <section className="space-y-6 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]">
            {/* Top Header & Global Filter Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                  {tr('01 / RINGKASAN PERFORMA', '01 / PERFORMANCE OVERVIEW')}
                </span>
                <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
                  {tr('Ringkasan Performa Utama', 'Key Performance Overview')}
                </h2>
              </div>

              {/* Global Period Dropdown + Reset + Privacy Toggle */}
              <div className="relative flex flex-wrap items-center gap-2 self-start sm:self-auto max-w-full" ref={periodMenuRef}>
                {(selectedPeriod !== 'ALL' || startDate || endDate) && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="h-8 w-8 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    title={tr('Reset Filter Tanggal', 'Reset Date Filter')}
                    aria-label={tr('Reset Filter Tanggal', 'Reset Date Filter')}
                  >
                    <RotateCcw className="h-3.5 w-3.5 stroke-[1.75]" />
                  </button>
                )}

                {/* Period Selector Dropdown */}
                <div className="max-w-full min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowPeriodDropdown((prev) => !prev)}
                    aria-label={tr('Filter Periode Analisis', 'Filter Analytics Period')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer select-none max-w-full shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                      showPeriodDropdown || selectedPeriod !== 'ALL' || Boolean(startDate || endDate)
                        ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] border-[#0F172A]/55 dark:border-white/55'
                        : 'bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] border-[#E4E4E7] dark:border-[#20252D] hover:border-[#0F172A]/40 dark:hover:border-white/40'
                    }`}
                  >
                    <span className="text-[#526071] dark:text-[#929BA9] shrink-0">
                      {tr('Periode:', 'Period:')}
                    </span>
                    <strong className="font-bold truncate max-w-[165px] sm:max-w-none">{getPeriodLabel()}</strong>
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] shrink-0 transition-transform duration-150 ${
                        showPeriodDropdown ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {showPeriodDropdown && (
                    <div
                      style={{ contain: 'layout style' }}
                      className="absolute left-0 sm:left-auto sm:right-0 top-10 z-30 w-[min(288px,calc(100vw-2rem))] sm:w-80 rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-3.5 shadow-[0_12px_30px_-6px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_-8px_rgba(0,0,0,0.75)] space-y-3 text-xs animate-in fade-in slide-in-from-top-1 duration-150"
                    >
                      <div className="flex items-center justify-between pb-2 border-b border-[#E4E4E7] dark:border-[#20252D]">
                        <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                          {tr('Filter Periode Analitik', 'Filter Analytics Period')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowPeriodDropdown(false)}
                          className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        {[
                          { id: 'ALL', label: tr('Semua Waktu', 'All Time') },
                          { id: 'TODAY', label: tr('Hari Ini', 'Today') },
                          { id: '7D', label: tr('7 Hari Terakhir', 'Last 7 Days') },
                          { id: '30D', label: tr('30 Hari Terakhir', 'Last 30 Days') },
                          { id: 'THIS_MONTH', label: tr('Bulan Ini', 'This Month') },
                          { id: 'LAST_MONTH', label: tr('Bulan Lalu', 'Last Month') },
                          { id: 'YTD', label: tr('Tahun Ini', 'This Year') },
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              handlePeriodChange(p.id as PeriodPreset);
                              setShowPeriodDropdown(false);
                            }}
                            className={`px-3 py-1.5 rounded-full text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                              selectedPeriod === p.id && !startDate && !endDate
                                ? 'bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] font-semibold'
                                : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {/* Custom Date Range Inputs */}
                      <div className="pt-2 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2">
                        <span className="block text-[11px] text-[#526071] dark:text-[#929BA9] font-medium">
                          {tr('Rentang Tanggal Kustom', 'Custom Date Range')}
                        </span>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <label className="block text-[10px] text-[#526071] dark:text-[#929BA9] mb-0.5">
                              {tr('Dari', 'From')}
                            </label>
                            <input
                              type="date"
                              value={startDate}
                              onChange={(e) => handleCustomDateChange(e.target.value, endDate)}
                              className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-2 py-1 text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#0F172A] dark:focus:border-white font-mono-numbers tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-[#526071] dark:text-[#929BA9] mb-0.5">
                              {tr('Sampai', 'To')}
                            </label>
                            <input
                              type="date"
                              value={endDate}
                              onChange={(e) => handleCustomDateChange(startDate, e.target.value)}
                              className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-2 py-1 text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#0F172A] dark:focus:border-white font-mono-numbers tabular-nums"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
                        <button
                          type="button"
                          onClick={() => {
                            handleResetFilters();
                            setShowPeriodDropdown(false);
                          }}
                          className="px-3 py-1 rounded-full text-[11px] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                        >
                          {tr('Reset', 'Reset')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowPeriodDropdown(false)}
                          className="px-3.5 py-1 text-[11px] font-semibold rounded-full bg-[#0F172A] hover:bg-[#1E293B] dark:bg-white dark:hover:bg-[#E2E8F0] text-white dark:text-[#0F172A] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                        >
                          {tr('Selesai', 'Done')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Periodic Review Ritual Button */}
                <button
                  type="button"
                  onClick={() => setIsReviewModalOpen(true)}
                  className="flex items-center justify-center h-8 w-8 rounded-full border bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  title={tr('Review Mingguan & Bulanan', 'Weekly & Monthly Review')}
                  aria-label={tr('Buka Review Mingguan & Bulanan', 'Open Weekly & Monthly Review')}
                >
                  <CalendarCheck2 className="h-3.5 w-3.5 stroke-[1.75]" />
                </button>

                {/* Export PDF & Shareable PNG Card Button */}
                <button
                  type="button"
                  onClick={() => setIsExportModalOpen(true)}
                  className="flex items-center justify-center h-8 w-8 rounded-full border bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  title={tr('Export Laporan PDF & Kartu PNG', 'Export PDF Report & PNG Card')}
                  aria-label={tr('Export Laporan Performa', 'Export Performance Report')}
                >
                  <Share2 className="h-3.5 w-3.5 stroke-[1.75]" />
                </button>

                {/* Privacy Mode Toggle */}
                <button
                  type="button"
                  onClick={togglePrivacyMode}
                  className={`flex items-center justify-center h-8 w-8 rounded-full border transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    isPrivacyMode
                      ? 'bg-white dark:bg-[#161A22] text-[#D97706] dark:text-[#F59E0B] border-[#D97706]/40 dark:border-[#F59E0B]/40 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none'
                      : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none'
                  }`}
                  title={tr('Sembunyikan nominal saldo agar aman dibagikan', 'Hide balance figures for safe sharing')}
                  aria-label={tr('Ubah Mode Privasi', 'Toggle Privacy Mode')}
                >
                  {isPrivacyMode ? (
                    <EyeOff className="h-3.5 w-3.5 stroke-[1.75]" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 stroke-[1.75]" />
                  )}
                </button>
              </div>
            </div>

            {/* Honest Empty Period State when filter yields 0 closed trades */}
            {!hasClosedTradesInPeriod ? (
              <div className="py-8 px-4 rounded-2xl bg-[#FAFAFA] dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-center space-y-1.5">
                <p className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                  {tr(
                    `Belum Ada Transaksi Tertutup pada Periode Ini (${getPeriodLabel()})`,
                    `No Closed Trades in This Period (${getPeriodLabel()})`
                  )}
                </p>
                <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                  {tr(
                    'Pilih periode lain atau reset filter tanggal untuk melihat kembali analisis performa historis Anda.',
                    'Select another period or reset the date filter to view your historical performance analytics.'
                  )}
                </p>
              </div>
            ) : (
              <>
                {/* Dominant Figure: Total Net Profit / Loss + Companion Growth */}
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
                    {tr('Total Profit / Loss Bersih', 'Total Net Profit / Loss')}
                  </span>
                  <div
                    className={`text-3xl sm:text-4xl font-bold font-mono-numbers tabular-nums tracking-tight ${
                      isNetProfitPositive
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : isNetProfitNegative
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#0F172A] dark:text-[#F2F4F7]'
                    }`}
                  >
                    {isPrivacyMode
                      ? '******'
                      : preferredCurrency === 'IDR'
                      ? (() => {
                          const idrVal = computeCumulativeProfitInDisplayCurrency(
                            filteredTrades,
                            'IDR',
                            rateRecord
                          );
                          const sign = idrVal > 0 ? '+' : idrVal < 0 ? '-' : '';
                          const formatted = new Intl.NumberFormat('id-ID', {
                            style: 'currency',
                            currency: 'IDR',
                            maximumFractionDigits: 0,
                          }).format(Math.abs(idrVal));
                          return `${sign}${formatted}`;
                        })()
                      : `${isNetProfitPositive ? '+' : ''}${formatCurrency(
                          metrics.totalNetProfit,
                          settings,
                          false
                        )}`}
                  </div>

                  {/* Growth right below Net Profit as companion info */}
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                    <span
                      className={`inline-flex items-center gap-1 font-bold ${
                        metrics.totalGainPercent > 0
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : metrics.totalGainPercent < 0
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {metrics.totalGainPercent >= 0 ? (
                        <TrendingUp className="h-3.5 w-3.5" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5" />
                      )}
                      {tr('Pertumbuhan', 'Growth')} {formatGrowthPercent(metrics.totalGainPercent, metrics.hasValidGrowthPercent, 2)}
                    </span>
                    <span className="text-[#E4E4E7] dark:text-[#20252D]">·</span>
                    <span>
                      {tr('Modal Awal Periode:', 'Period Starting Balance:')} {fmtMoney(periodStartingBalance, isPrivacyMode)}
                    </span>
                  </div>
                </div>

                {/* 6 Core Metrics in 2-Column Mobile / 6-Column Desktop Grid (Cardless) */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-y-5 gap-x-4 pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] font-mono-numbers tabular-nums">
                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Rasio Menang', 'Win Rate')}
                    </span>
                    <span className="mt-1 block text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                      {metrics.winRate}%
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {metrics.winningTrades}W / {metrics.losingTrades}L
                    </span>
                  </div>

                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Faktor Profit', 'Profit Factor')}
                    </span>
                    <span
                      className={`mt-1 block text-base sm:text-lg font-bold ${
                        metrics.profitFactor >= 1.5 || metrics.isProfitFactorInfinite
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {formatProfitFactor(metrics.profitFactor, metrics.isProfitFactorInfinite)}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Profit / Rugi Kotor', 'Gross Profit / Loss')}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Rata-rata RR', 'Average RR')}
                    </span>
                    <span className="mt-1 block text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                      {formatRMultiple(metrics.averageRiskReward, metrics.hasValidRiskReward)}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('R-Multiple Aktual', 'Realized R-Multiple')}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Ekspektansi', 'Expectancy')}
                    </span>
                    <span
                      className={`mt-1 block text-base sm:text-lg font-bold ${
                        metrics.expectancy > 0
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : metrics.expectancy < 0
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {fmtMoney(metrics.expectancy, isPrivacyMode)}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Harapan / Trade', 'Expected / Trade')}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Total Trade', 'Total Trades')}
                    </span>
                    <span className="mt-1 block text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                      {metrics.totalTrades}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {metrics.breakevenTrades} {tr('Impas', 'Breakeven')}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                      {tr('Drawdown Maksimum', 'Maximum Drawdown')}
                    </span>
                    <span
                      className={`mt-1 block text-base sm:text-lg font-bold ${
                        metrics.maxDrawdownPercent > 0
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {metrics.maxDrawdownPercent > 0
                        ? `-${metrics.maxDrawdownPercent.toFixed(2)}%`
                        : '0.00%'}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {metrics.maxDrawdownAmount > 0
                        ? `-${fmtMoney(metrics.maxDrawdownAmount, isPrivacyMode)}`
                        : fmtMoney(0, isPrivacyMode)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Critical Drawdown Alert Banner if applicable */}
            {metrics.isAccountInCriticalDrawdown && (
              <div className="p-3.5 rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/10 border border-[#E11D48]/30 dark:border-[#E05260]/30 text-xs flex items-center gap-2.5">
                <ShieldAlert className="h-4 w-4 stroke-[1.75] text-[#E11D48] dark:text-[#E05260] shrink-0" />
                <div className="text-[#0F172A] dark:text-[#F2F4F7]">
                  <strong className="font-bold text-[#E11D48] dark:text-[#E05260]">
                    {tr('Peringatan Risiko Kritis:', 'Critical Risk Warning:')}
                  </strong>{' '}
                  {tr(
                    'Penurunan modal telah menyentuh batas risiko akun (Drawdown ≥ 100%). Evaluasi ukuran lot dan manajemen risiko.',
                    'Account drawdown has reached the critical risk limit (Drawdown ≥ 100%). Evaluate lot sizing and risk management.'
                  )}
                </div>
              </div>
            )}
          </section>

          {/* =========================================================================
              SECTION 02 — CAPITAL PERFORMANCE (EQUITY CURVE + DRAWDOWN CURVE)
             ========================================================================= */}
          <section className="space-y-8 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                {tr('02 / PERFORMA MODAL', '02 / CAPITAL PERFORMANCE')}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
                {tr('Pertumbuhan Ekuitas & Risiko Penurunan Modal', 'Equity Growth & Drawdown Risk')}
              </h2>
            </div>

            {/* SUB-SECTION 2A: EQUITY CURVE */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr('Kurva Ekuitas', 'Equity Curve')}
                  </h3>
                  {/* Dynamic Period Summary Line */}
                  <p className="text-xs text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums mt-0.5">
                    <span className="font-semibold text-[#0F172A] dark:text-[#E2E8F0]">
                      {equityRangeSummary.label}
                    </span>
                    {' · '}
                    <span>{equityRangeSummary.tradesCount} {tr('Trade', 'Trades')}</span>
                    {' · '}
                    <span
                      className={`font-bold ${
                        equityRangeSummary.netDelta > 0
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : equityRangeSummary.netDelta < 0
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {equityMode === 'growth'
                        ? `${equityRangeSummary.growthDelta > 0 ? '+' : ''}${equityRangeSummary.growthDelta.toFixed(2)}%`
                        : `${equityRangeSummary.netDelta > 0 ? '+' : ''}${fmtMoney(
                            equityRangeSummary.netDelta,
                            isPrivacyMode
                          )}`}
                    </span>
                  </p>
                </div>

                {/* Two Compact Dropdowns: 1. Mode (Nominal/Percent), 2. Period (1D..All Time) */}
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto" ref={equityControlsRef}>
                  {/* Dropdown 1: Mode */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenEquityDropdown((prev) => (prev === 'mode' ? null : 'mode'))
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/40 dark:hover:border-white/40 transition-colors cursor-pointer select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      <span>{equityMode === 'equity' ? tr('Nominal', 'Nominal') : tr('Persen', 'Percent')}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9]" />
                    </button>

                    {openEquityDropdown === 'mode' && (
                      <div className="absolute left-0 top-9 z-30 w-36 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-1 shadow-[0_10px_28px_rgba(15,23,42,0.12)] dark:shadow-xl text-xs">
                        {[
                          { id: 'equity', label: tr('Nominal', 'Nominal') },
                          { id: 'growth', label: tr('Persen (%)', 'Percent (%)') },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setEquityMode(opt.id as 'equity' | 'growth');
                              setOpenEquityDropdown(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                              equityMode === opt.id
                                ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                            }`}
                          >
                            <span>{opt.label}</span>
                            {equityMode === opt.id && (
                              <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dropdown 2: Period */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenEquityDropdown((prev) => (prev === 'range' ? null : 'range'))
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/40 dark:hover:border-white/40 transition-colors cursor-pointer select-none font-mono-numbers tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      <span>{equityRangeSummary.label}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9]" />
                    </button>

                    {openEquityDropdown === 'range' && (
                      <div className="absolute right-0 top-9 z-30 w-36 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-1 shadow-[0_10px_28px_rgba(15,23,42,0.12)] dark:shadow-xl text-xs font-mono-numbers tabular-nums">
                        {chartRangeOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setEquityRange(opt.id);
                              setOpenEquityDropdown(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                              equityRange === opt.id
                                ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                            }`}
                          >
                            <span>{opt.label}</span>
                            {equityRange === opt.id && (
                              <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <EquityChart
                equityCurve={rangedEquityCurve}
                settings={periodSettings}
                startingBalance={
                  rangedEquityCurve.length > 0 ? rangedEquityCurve[0].equity : periodStartingBalance
                }
                height={290}
                isPrivacyMode={isPrivacyMode}
                embedded={true}
                externalViewMode={equityMode}
                hideInternalControls={true}
              />
            </div>

            {/* Subtle Divider between Equity Curve and Drawdown Curve */}
            <div className="border-t border-[#E4E4E7] dark:border-[#20252D] pt-6 space-y-4">
              {/* SUB-SECTION 2B: DRAWDOWN CURVE */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr('Kurva Drawdown', 'Drawdown Curve')}
                  </h3>
                  {/* Dynamic Period Summary Line for Drawdown */}
                  <p className="text-xs text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums mt-0.5">
                    <span className="font-semibold text-[#0F172A] dark:text-[#E2E8F0]">
                      {drawdownSummary.label}
                    </span>
                    {' · '}
                    <span>
                      Max DD{' '}
                      <strong className="text-[#E11D48] dark:text-[#E05260]">
                        {drawdownMode === 'percent'
                          ? drawdownSummary.maxDdPct > 0
                            ? `-${drawdownSummary.maxDdPct.toFixed(2)}%`
                            : '0.00%'
                          : drawdownSummary.maxDdAmt > 0
                          ? `-${fmtMoney(drawdownSummary.maxDdAmt, isPrivacyMode)}`
                          : fmtMoney(0, isPrivacyMode)}
                      </strong>
                    </span>
                    {' · '}
                    <span>
                      {tr('Pemulihan', 'Recovery')}{' '}
                      <strong className="text-[#0F172A] dark:text-[#F2F4F7]">
                        {drawdownSummary.recoveryPct}%
                      </strong>
                    </span>
                  </p>
                </div>

                {/* Two Compact Dropdowns for Drawdown: 1. Mode (Percent/Nominal), 2. Period */}
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto" ref={drawdownControlsRef}>
                  {/* Dropdown 1: Mode */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDrawdownDropdown((prev) => (prev === 'mode' ? null : 'mode'))
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/40 dark:hover:border-white/40 transition-colors cursor-pointer select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      <span>{drawdownMode === 'percent' ? tr('Persen', 'Percent') : tr('Nominal', 'Nominal')}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9]" />
                    </button>

                    {openDrawdownDropdown === 'mode' && (
                      <div className="absolute left-0 top-9 z-30 w-36 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-1 shadow-[0_10px_28px_rgba(15,23,42,0.12)] dark:shadow-xl text-xs">
                        {[
                          { id: 'percent', label: tr('Persen (%)', 'Percent (%)') },
                          { id: 'nominal', label: tr('Nominal', 'Nominal') },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setDrawdownMode(opt.id as 'percent' | 'nominal');
                              setOpenDrawdownDropdown(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                              drawdownMode === opt.id
                                ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                            }`}
                          >
                            <span>{opt.label}</span>
                            {drawdownMode === opt.id && (
                              <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dropdown 2: Period */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDrawdownDropdown((prev) => (prev === 'range' ? null : 'range'))
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/40 dark:hover:border-white/40 transition-colors cursor-pointer select-none font-mono-numbers tabular-nums whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      <span>{drawdownSummary.label}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9]" />
                    </button>

                    {openDrawdownDropdown === 'range' && (
                      <div className="absolute right-0 top-9 z-30 w-36 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-1 shadow-[0_10px_28px_rgba(15,23,42,0.12)] dark:shadow-xl text-xs font-mono-numbers tabular-nums">
                        {chartRangeOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setDrawdownRange(opt.id);
                              setOpenDrawdownDropdown(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                              drawdownRange === opt.id
                                ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                            }`}
                          >
                            <span>{opt.label}</span>
                            {drawdownRange === opt.id && (
                              <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 3 Required Drawdown Indicators: Current Drawdown, Maximum Drawdown, Recovery */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4 py-2.5 border-y border-[#E4E4E7] dark:border-[#20252D] text-xs font-mono-numbers tabular-nums">
                <div className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                    {tr('Drawdown Saat Ini', 'Current Drawdown')}
                  </span>
                  <strong
                    className={`mt-0.5 block text-sm sm:text-base font-bold ${
                      drawdownSummary.currentDdPct > 0
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#059669] dark:text-[#00A878]'
                    }`}
                  >
                    {drawdownMode === 'percent'
                      ? drawdownSummary.currentDdPct > 0
                        ? `-${drawdownSummary.currentDdPct.toFixed(2)}%`
                        : '0.00%'
                      : drawdownSummary.currentDdAmt > 0
                      ? `-${fmtMoney(drawdownSummary.currentDdAmt, isPrivacyMode)}`
                      : fmtMoney(0, isPrivacyMode)}
                  </strong>
                </div>

                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                    {tr('Drawdown Maksimum', 'Maximum Drawdown')}
                  </span>
                  <strong
                    className={`mt-0.5 block text-sm sm:text-base font-bold ${
                      drawdownSummary.maxDdPct > 0
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#0F172A] dark:text-[#F2F4F7]'
                    }`}
                  >
                    {drawdownMode === 'percent'
                      ? drawdownSummary.maxDdPct > 0
                        ? `-${drawdownSummary.maxDdPct.toFixed(2)}%`
                        : '0.00%'
                      : drawdownSummary.maxDdAmt > 0
                      ? `-${fmtMoney(drawdownSummary.maxDdAmt, isPrivacyMode)}`
                      : fmtMoney(0, isPrivacyMode)}
                  </strong>
                </div>

                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                    {tr('Pemulihan', 'Recovery')}
                  </span>
                  <strong
                    className={`mt-0.5 block text-sm sm:text-base font-bold ${
                      drawdownSummary.recoveryPct >= 100
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : 'text-[#0F172A] dark:text-[#F2F4F7]'
                    }`}
                  >
                    {drawdownSummary.recoveryPct}%
                  </strong>
                </div>
              </div>

              <DrawdownChart
                equityCurve={rangedDrawdownCurve}
                settings={periodSettings}
                height={185}
                isPrivacyMode={isPrivacyMode}
                viewMode={drawdownMode}
              />
            </div>
          </section>

          {/* =========================================================================
              SECTION 03 — PERFORMANCE PROFILE (6 PILLARS RADAR & SCORE)
             ========================================================================= */}
          <section className="space-y-5 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                  {tr('03 / PROFIL PERFORMA', '03 / PERFORMANCE PROFILE')}
                </span>
                <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
                  {tr('Profil Performa 6 Pilar', '6-Pillar Performance Profile')}
                </h2>
              </div>

              {/* Overall Performance Score (Clean inline readout, zero pill) */}
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                  {tr('Skor Keseluruhan:', 'Overall Score:')}
                </span>
                <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                  {radarIndicators.isDataSufficient
                    ? `${Math.round(
                        (radarIndicators.winRateScore +
                          radarIndicators.profitFactorScore +
                          radarIndicators.rewardRiskScore +
                          radarIndicators.expectancyScore +
                          (radarIndicators.riskControlScore ?? radarIndicators.drawdownControlScore) +
                          radarIndicators.consistencyScore) /
                          6
                      )}/100`
                    : tr('Data Belum Cukup', 'Insufficient Data')}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Left / Top: Compact Seamless Radar Chart */}
              <div className="lg:col-span-5 flex justify-center">
                <div className="w-full max-w-[300px]">
                  <RadarChart indicators={radarIndicators} size={280} />
                </div>
              </div>

              {/* Right / Bottom: Clean 6-Pillar List without Boxed Mini-Cards */}
              <div className="lg:col-span-7">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                  {pillarList.map((p, idx) => (
                    <div
                      key={idx}
                      className="py-2.5 border-b border-[#E4E4E7] dark:border-[#20252D] space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                          {p.name}
                        </span>
                        <span className="font-mono-numbers tabular-nums font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                          {p.displayVal}
                        </span>
                      </div>

                      {/* Slim Progress Bar */}
                      <div className="h-1 w-full bg-[#F4F4F5] dark:bg-[#161A22] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            !p.isAvailable
                              ? 'bg-transparent'
                              : p.score >= 70
                              ? 'bg-[#059669] dark:bg-[#00A878]'
                              : p.score >= 50
                              ? 'bg-[#0F172A] dark:bg-[#F2F4F7]'
                              : 'bg-[#D97706] dark:bg-[#F59E0B]'
                          }`}
                          style={{ width: p.isAvailable ? `${Math.max(4, p.score)}%` : '0%' }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-[#526071] dark:text-[#929BA9]">
                        <span>{p.target}</span>
                        <span className="font-mono-numbers tabular-nums font-semibold">
                          {p.isAvailable
                            ? `${tr('Skor', 'Score')} ${p.score}/100`
                            : tr('Data Belum Cukup', 'Insufficient Data')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* =========================================================================
              SECTION 04 — PERFORMANCE CALENDAR
             ========================================================================= */}
          <section className="space-y-4 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                {tr('04 / KALENDER PERFORMA', '04 / PERFORMANCE CALENDAR')}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
                {tr('Kalender Performa & Aktivitas Harian', 'Performance Calendar & Daily Activity')}
              </h2>
            </div>

            <PerformanceCalendar
              dailyPerformance={dailyPerformance}
              monthlyPerformance={monthlyPerformance}
              settings={periodSettings}
              isPrivacyMode={isPrivacyMode}
              trades={filteredTrades}
              onViewTrade={onViewTrade}
              onDeleteTradesByDate={
                onDeleteTradesByDate
                  ? (payload) => {
                      const totalOnDate = (trades || []).filter(
                        (t) => (t.dateTime || '').slice(0, 10) === payload.dateKey
                      ).length;
                      onDeleteTradesByDate({
                        ...payload,
                        isFilteredSubset: payload.trades.length < totalOnDate,
                        totalTradesOnDate: totalOnDate,
                      });
                    }
                  : undefined
              }
            />
          </section>

          {/* =========================================================================
              SECTION 05 — PERFORMANCE BREAKDOWN (HARI, SESI, INSTRUMEN)
             ========================================================================= */}
          <section className="space-y-5 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                  {tr('05 / RINCIAN PERFORMA', '05 / PERFORMANCE BREAKDOWN')}
                </span>
                <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
                  {tr('Rincian Performa Berdasarkan Dimensi', 'Performance Breakdown by Dimension')}
                </h2>
              </div>

              {/* Compact Dropdown to switch between Hari, Sesi, and Instrumen */}
              <div className="relative self-start sm:self-auto max-w-full" ref={breakdownMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowBreakdownDropdown((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/40 dark:hover:border-white/40 transition-colors cursor-pointer select-none max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  <span className="text-[#526071] dark:text-[#929BA9] shrink-0">
                    {tr('Dimensi:', 'Dimension:')}
                  </span>
                  <strong className="font-bold truncate">{breakdownLabels[breakdownCategory]}</strong>
                  <ChevronDown className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] shrink-0" />
                </button>

                {showBreakdownDropdown && (
                  <div className="absolute left-0 sm:left-auto sm:right-0 top-9 z-30 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-1 shadow-[0_10px_28px_rgba(15,23,42,0.12)] dark:shadow-xl text-xs">
                    {(['day', 'session', 'instrument'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setBreakdownCategory(cat);
                          setShowBreakdownDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                          breakdownCategory === cat
                            ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                            : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                        }`}
                      >
                        <span>{breakdownLabels[cat]}</span>
                        {breakdownCategory === cat && (
                          <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* DIMENSION 1: HARI DALAM SEMINGGU & REKAP BULANAN */}
            {breakdownCategory === 'day' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Senin - Jumat */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block">
                    {tr('Hari dalam Seminggu (Senin – Jumat)', 'Day of the Week (Monday – Friday)')}
                  </span>
                  <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D]">
                    {dayOfWeekStats.map((item) => (
                      <div
                        key={item.dayName}
                        className="py-3 px-1 flex items-center justify-between gap-3 text-xs font-mono-numbers tabular-nums"
                      >
                        <div>
                          <span className="font-bold font-sans text-[#0F172A] dark:text-[#F2F4F7] block">
                            {item.dayName}
                          </span>
                          <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                            {item.total} {tr('Trade', 'Trades')} · {tr('Rasio Menang', 'Win Rate')} {item.winRate}%
                          </span>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`font-bold text-xs sm:text-sm ${
                              item.netProfit > 0.01
                                ? 'text-[#059669] dark:text-[#00A878]'
                                : item.netProfit < -0.01
                                ? 'text-[#E11D48] dark:text-[#E05260]'
                                : 'text-[#526071] dark:text-[#929BA9]'
                            }`}
                          >
                            {item.netProfit > 0 ? '+' : ''}
                            {fmtMoney(item.netProfit, isPrivacyMode)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rekapitulasi Bulanan */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block">
                    {tr('Rekapitulasi Bulanan', 'Monthly Summary')}
                  </span>
                  {monthlyPerformance.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#526071] dark:text-[#929BA9] border-y border-[#E4E4E7] dark:border-[#20252D]">
                      {tr('Belum ada data bulanan.', 'No monthly data yet.')}
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D] max-h-72 overflow-y-auto">
                      {monthlyPerformance.map((m) => (
                        <div
                          key={m.monthKey}
                          className="py-3 px-1 flex items-center justify-between gap-3 text-xs font-mono-numbers tabular-nums"
                        >
                          <div>
                            <span className="font-bold font-sans text-[#0F172A] dark:text-[#F2F4F7] block">
                              {m.label}
                            </span>
                            <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                              {m.tradesCount} {tr('Trade', 'Trades')} · {tr('Rasio Menang', 'Win Rate')} {m.winRate}%
                            </span>
                          </div>

                          <div className="text-right shrink-0">
                            <span
                              className={`font-bold text-xs sm:text-sm ${
                                m.netProfit > 0.01
                                  ? 'text-[#059669] dark:text-[#00A878]'
                                  : m.netProfit < -0.01
                                  ? 'text-[#E11D48] dark:text-[#E05260]'
                                  : 'text-[#526071] dark:text-[#929BA9]'
                              }`}
                            >
                              {m.netProfit > 0 ? '+' : ''}
                              {fmtMoney(m.netProfit, isPrivacyMode)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* DIMENSION 2: SESI TRADING (ASIA, LONDON, NEW YORK) */}
            {breakdownCategory === 'session' && (
              <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D]">
                {sessionStats.map((sess) => (
                  <div
                    key={sess.id}
                    className="py-3.5 px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono-numbers tabular-nums"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-sans">
                        <span className="font-bold text-sm text-[#0F172A] dark:text-[#F2F4F7]">
                          {sess.label}
                        </span>
                        <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                          ({sess.desc})
                        </span>
                      </div>
                      <span className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5 block">
                        {sess.total} {tr('Trade', 'Trades')} ({sess.winCount}W · {sess.lossCount}L)
                      </span>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-6">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block font-sans">
                          {tr('Rasio Menang', 'Win Rate')}
                        </span>
                        <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                          {sess.winRate}%
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block font-sans">
                          {tr('Faktor Profit', 'Profit Factor')}
                        </span>
                        <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                          {sess.profitFactor === Infinity ? '∞' : sess.profitFactor.toFixed(2)}
                        </span>
                      </div>

                      <div className="text-right min-w-[96px]">
                        <span className="text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block font-sans">
                          {tr('P/L Bersih', 'Net P/L')}
                        </span>
                        <span
                          className={`font-bold text-xs sm:text-sm ${
                            sess.netProfit > 0.01
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : sess.netProfit < -0.01
                              ? 'text-[#E11D48] dark:text-[#E05260]'
                              : 'text-[#526071] dark:text-[#929BA9]'
                          }`}
                        >
                          {sess.netProfit > 0 ? '+' : ''}
                          {fmtMoney(sess.netProfit, isPrivacyMode)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* DIMENSION 3: INSTRUMEN / SIMBOL */}
            {breakdownCategory === 'instrument' && (
              <div>
                {symbolStats.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[#526071] dark:text-[#929BA9]">
                    {tr('Belum ada data instrumen pada periode ini.', 'No instrument data in this period.')}
                  </p>
                ) : (
                  <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D]">
                    {symbolStats.map((item) => (
                      <div
                        key={item.symbol}
                        className="py-3.5 px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono-numbers tabular-nums"
                      >
                        <div>
                          <span className="font-bold font-sans text-sm text-[#0F172A] dark:text-[#F2F4F7] block">
                            {item.symbol}
                          </span>
                          <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                            {item.total} {tr('Trade', 'Trades')} ({item.winCount}W · {item.lossCount}L)
                          </span>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-6">
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block font-sans">
                              {tr('Rasio Menang', 'Win Rate')}
                            </span>
                            <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                              {item.winRate}%
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block font-sans">
                              {tr('Rata-rata / Trade', 'Avg / Trade')}
                            </span>
                            <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                              {fmtMoney(item.avgProfit, isPrivacyMode)}
                            </span>
                          </div>

                          <div className="text-right min-w-[96px]">
                            <span className="text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block font-sans">
                              {tr('P/L Bersih', 'Net P/L')}
                            </span>
                            <span
                              className={`font-bold text-xs sm:text-sm ${
                                item.netProfit > 0.01
                                  ? 'text-[#059669] dark:text-[#00A878]'
                                  : item.netProfit < -0.01
                                  ? 'text-[#E11D48] dark:text-[#E05260]'
                                  : 'text-[#526071] dark:text-[#929BA9]'
                              }`}
                            >
                              {item.netProfit > 0 ? '+' : ''}
                              {fmtMoney(item.netProfit, isPrivacyMode)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* =========================================================================
              SECTION 06 — TRADING BEHAVIOR (STREAKS, AVERAGES & DISTRIBUTION)
             ========================================================================= */}
          <section className="space-y-5 pb-8 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                {tr('06 / PERILAKU TRADING', '06 / TRADING BEHAVIOR')}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
                {tr('Perilaku Eksekusi, Beruntun & Distribusi Hasil', 'Execution Behavior, Streaks & Outcome Distribution')}
              </h2>
            </div>

            {/* 5 Behavioral Metrics in Cardless Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-5 gap-x-4 py-4 border-y border-[#E4E4E7] dark:border-[#20252D] font-mono-numbers tabular-nums">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Menang Beruntun', 'Win Streak')}
                </span>
                <span className="mt-1 block text-base sm:text-lg font-bold text-[#059669] dark:text-[#00A878]">
                  {metrics.consecutiveWinsMax} {tr('Trade', 'Trades')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Saat ini:', 'Current:')} {metrics.currentStreak.count}{' '}
                  {metrics.currentStreak.type === 'WIN'
                    ? tr('Menang', 'Win')
                    : metrics.currentStreak.type === 'LOSS'
                    ? tr('Rugi', 'Loss')
                    : '-'}
                </span>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Rugi Beruntun', 'Loss Streak')}
                </span>
                <span className="mt-1 block text-base sm:text-lg font-bold text-[#E11D48] dark:text-[#E05260]">
                  {metrics.consecutiveLossesMax} {tr('Trade', 'Trades')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Maksimal beruntun', 'Max consecutive')}
                </span>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Rata-rata Menang', 'Average Win')}
                </span>
                <span className="mt-1 block text-base sm:text-lg font-bold text-[#059669] dark:text-[#00A878]">
                  {metrics.averageWin > 0 ? `+${fmtMoney(metrics.averageWin, isPrivacyMode)}` : fmtMoney(0, isPrivacyMode)}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Rata-rata profit / menang', 'Avg profit / win')}
                </span>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Rata-rata Rugi', 'Average Loss')}
                </span>
                <span className="mt-1 block text-base sm:text-lg font-bold text-[#E11D48] dark:text-[#E05260]">
                  {metrics.averageLoss > 0 ? `-${fmtMoney(metrics.averageLoss, isPrivacyMode)}` : fmtMoney(0, isPrivacyMode)}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Rata-rata rugi / loss', 'Avg loss / losing trade')}
                </span>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Rasio Menang / Rugi', 'Win / Loss Ratio')}
                </span>
                <span className="mt-1 block text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                  {metrics.averageLoss > 0
                    ? `${(metrics.averageWin / metrics.averageLoss).toFixed(2)}x`
                    : metrics.averageWin > 0
                    ? '∞'
                    : '0.00x'}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                  {tr('Rasio Hasil (Payoff)', 'Payoff Ratio')}
                </span>
              </div>
            </div>

            {/* Win / Loss / Breakeven Distribution Bar */}
            <div className="space-y-2 pt-1 font-mono-numbers tabular-nums">
              <div className="flex items-center justify-between text-xs text-[#526071] dark:text-[#929BA9]">
                <span className="font-semibold font-sans text-[#0F172A] dark:text-[#F2F4F7]">
                  {tr(
                    `Distribusi Menang / Rugi / Impas (${metrics.totalTrades} Trade)`,
                    `Win / Loss / Breakeven Distribution (${metrics.totalTrades} Trades)`
                  )}
                </span>
                <span>
                  {metrics.winningTrades}W · {metrics.losingTrades}L · {metrics.breakevenTrades}BE
                </span>
              </div>

              <div className="h-2 w-full bg-[#F4F4F5] dark:bg-[#161A22] rounded-full overflow-hidden flex">
                {metrics.totalTrades > 0 && (
                  <>
                    <div
                      className="h-full bg-[#059669] dark:bg-[#00A878] transition-all"
                      style={{ width: `${(metrics.winningTrades / metrics.totalTrades) * 100}%` }}
                      title={`${tr('Menang', 'Winning')}: ${metrics.winningTrades} (${metrics.winRate}%)`}
                    />
                    <div
                      className="h-full bg-[#E11D48] dark:bg-[#E05260] transition-all"
                      style={{ width: `${(metrics.losingTrades / metrics.totalTrades) * 100}%` }}
                      title={`${tr('Rugi', 'Losing')}: ${metrics.losingTrades} (${metrics.lossRate}%)`}
                    />
                    <div
                      className="h-full bg-[#526071] dark:bg-[#929BA9] transition-all"
                      style={{ width: `${(metrics.breakevenTrades / metrics.totalTrades) * 100}%` }}
                      title={`${tr('Impas', 'Breakeven')}: ${metrics.breakevenTrades} (${metrics.breakevenRate}%)`}
                    />
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#526071] dark:text-[#929BA9] pt-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#059669] dark:bg-[#00A878]" />
                  {tr('Menang', 'Win')} ({metrics.winRate}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#E11D48] dark:bg-[#E05260]" />
                  {tr('Rugi', 'Loss')} ({metrics.lossRate}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#526071] dark:bg-[#929BA9]" />
                  {tr('Impas', 'Breakeven')} ({metrics.breakevenRate}%)
                </span>
              </div>
            </div>
          </section>

          {/* =========================================================================
              SECTION 07 — BEHAVIORAL & COST OF MISTAKES ANALYTICS
             ========================================================================= */}
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2.5 sm:gap-3">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#526071] dark:text-[#929BA9]">
                  {tr('07 / ANALITIK PSIKOLOGI & DISIPLIN', '07 / BEHAVIORAL & DISCIPLINE ANALYTICS')}
                </span>
                <h2 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
                  {tr('Biaya Kesalahan & Dampak Disiplin', 'Cost of Mistakes & Discipline Impact')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(true)}
                className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/40 dark:hover:border-white/40 transition-colors cursor-pointer select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                <CalendarCheck2 className="h-3.5 w-3.5 stroke-[1.75] text-[#526071] dark:text-[#929BA9]" />
                <span>{tr('Tulis Review Periode', 'Write Period Review')}</span>
              </button>
            </div>

            {/* 4 Behavioral Metrics in Cardless Open-Canvas Strip (Matches Section 06) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-5 gap-x-6 py-4 border-y border-[#E4E4E7] dark:border-[#20252D] font-mono-numbers tabular-nums">
              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans leading-snug break-words">
                  {tr('Biaya Pelanggaran', 'Cost of Mistakes')}
                </span>
                <span
                  className={`mt-1 block text-base sm:text-lg font-bold break-words ${
                    behavioral.costOfMistakes > 0
                      ? 'text-[#E11D48] dark:text-[#E05260]'
                      : 'text-[#0F172A] dark:text-[#F2F4F7]'
                  }`}
                >
                  {isPrivacyMode
                    ? '••••'
                    : behavioral.costOfMistakes > 0
                    ? `-${fmtMoney(behavioral.costOfMistakes, isPrivacyMode)}`
                    : fmtMoney(0, isPrivacyMode)}
                </span>
                <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] leading-snug break-words">
                  {tr(
                    `${behavioral.mistakeTradesCount} trade melanggar`,
                    `${behavioral.mistakeTradesCount} mistake trades`
                  )}
                </span>
              </div>

              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans leading-snug break-words">
                  {tr('Winrate Tanpa Mistake', 'Clean Discipline Winrate')}
                </span>
                <span
                  className={`mt-1 block text-base sm:text-lg font-bold break-words ${
                    behavioral.cleanWinRate >= 50
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : 'text-[#0F172A] dark:text-[#F2F4F7]'
                  }`}
                >
                  {behavioral.cleanWinRate}%
                </span>
                <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] leading-snug break-words">
                  {tr(
                    `vs ${behavioral.overallWinRate}% keseluruhan`,
                    `vs ${behavioral.overallWinRate}% overall`
                  )}
                </span>
              </div>

              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans leading-snug break-words">
                  {tr('Winrate Saat Mistake', 'Mistake-Trade Winrate')}
                </span>
                <span className="mt-1 block text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] break-words">
                  {behavioral.mistakeWinRate}%
                </span>
                <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] leading-snug break-words">
                  {tr(
                    `${behavioral.ruleBrokenCount} langgar guardrail`,
                    `${behavioral.ruleBrokenCount} guardrail breaches`
                  )}
                </span>
              </div>

              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] font-sans leading-snug break-words">
                  {tr('Trade Berlabel Psikologi', 'Tagged Behavior Trades')}
                </span>
                <span className="mt-1 block text-base sm:text-lg font-bold text-[#0F172A] dark:text-[#F2F4F7] break-words">
                  {behavioral.taggedTradesCount}
                </span>
                <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] leading-snug break-words">
                  {tr(
                    `${behavioral.checklistPassedCount} lulus checklist SOP`,
                    `${behavioral.checklistPassedCount} passed SOP checklist`
                  )}
                </span>
              </div>
            </div>

            {behavioral.mistakeBreakdown.length > 0 || behavioral.emotionBreakdown.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {behavioral.mistakeBreakdown.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block">
                      {tr('Rincian Kesalahan & Dampak P/L', 'Mistake Breakdown & P/L Impact')}
                    </h3>
                    <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D]">
                      {behavioral.mistakeBreakdown.map((row) => (
                        <div
                          key={row.tagId}
                          className="py-3 px-1 flex items-center justify-between gap-3 text-xs font-mono-numbers tabular-nums"
                        >
                          <div className="min-w-0">
                            <span className="font-bold font-sans text-[#0F172A] dark:text-[#F2F4F7] block break-words">
                              {getMistakeLabel(row.tagId, isEn)}
                            </span>
                            <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                              {row.count}x · WR {row.winRate}%
                            </span>
                          </div>
                          <span
                            className={`font-bold text-xs sm:text-sm shrink-0 ${
                              row.netProfit > 0.01
                                ? 'text-[#059669] dark:text-[#00A878]'
                                : row.netProfit < -0.01
                                ? 'text-[#E11D48] dark:text-[#E05260]'
                                : 'text-[#526071] dark:text-[#929BA9]'
                            }`}
                          >
                            {isPrivacyMode
                              ? '••••'
                              : `${row.netProfit > 0.01 ? '+' : ''}${fmtMoney(row.netProfit, isPrivacyMode)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {behavioral.emotionBreakdown.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] block">
                      {tr('Performa Berdasarkan Kondisi Emosi', 'Performance by Emotional State')}
                    </h3>
                    <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D]">
                      {behavioral.emotionBreakdown.map((row) => (
                        <div
                          key={row.emotionId}
                          className="py-3 px-1 flex items-center justify-between gap-3 text-xs font-mono-numbers tabular-nums"
                        >
                          <div className="min-w-0">
                            <span className="font-bold font-sans text-[#0F172A] dark:text-[#F2F4F7] block break-words">
                              {getEmotionLabel(row.emotionId, isEn)}
                            </span>
                            <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                              {row.count}x · WR {row.winRate}%
                            </span>
                          </div>
                          <span
                            className={`font-bold text-xs sm:text-sm shrink-0 ${
                              row.netProfit > 0.01
                                ? 'text-[#059669] dark:text-[#00A878]'
                                : row.netProfit < -0.01
                                ? 'text-[#E11D48] dark:text-[#E05260]'
                                : 'text-[#526071] dark:text-[#929BA9]'
                            }`}
                          >
                            {isPrivacyMode
                              ? '••••'
                              : `${row.netProfit > 0.01 ? '+' : ''}${fmtMoney(row.netProfit, isPrivacyMode)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="py-6 border-y border-[#E4E4E7] dark:border-[#20252D] text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed">
                {tr(
                  'Tambahkan tag Mistake (FOMO, Revenge, Overlot, A+ Setup) dan kondisi Emosi pada Detail Transaksi untuk memetakan biaya kesalahan trading Anda secara otomatis.',
                  'Tag Mistakes (FOMO, Revenge, Overlot, A+ Setup) and Emotion inside Trade Details to automatically measure your Cost of Mistakes.'
                )}
              </p>
            )}
          </section>
        </>
      )}

      {isReviewModalOpen && (
        <PeriodicReviewModal
          isOpen={isReviewModalOpen}
          onClose={handleCloseReviewModal}
          trades={trades}
          settings={settings}
          userId={userId}
        />
      )}

      {isExportModalOpen && (
        <PerformanceExportModal
          isOpen={isExportModalOpen}
          onClose={handleCloseExportModal}
          metrics={metrics}
          equityCurve={equityCurve}
          behavioral={behavioral}
          trades={filteredTrades}
          settings={periodSettings}
          periodLabel={getPeriodLabel()}
          initialPrivacyMode={isPrivacyMode}
        />
      )}
    </div>
  );
};
