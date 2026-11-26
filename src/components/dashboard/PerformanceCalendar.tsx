/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  DailyPerformance,
  MonthlyPerformance,
  formatCurrency,
  resolveActiveCalendarMonth,
  formatLocalDateKey,
  computeTradeNetProfit,
  computeRealizedRMultiple,
  formatRMultiple,
  resolveTradeOutcome,
  formatCalendarAdaptivePnl,
} from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { AppSettings } from '../../types/settings';
import { Trade } from '../../types/trade';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Eye,
  Clock,
  Check,
  Trash2,
} from 'lucide-react';

/**
 * Pure helper that filters and chronologically sorts trades matching a calendar date key ('YYYY-MM-DD').
 * Guaranteed not to mutate the input trades array and matches dailyPerformance grouping in calculations.ts.
 */
export const getTradesForCalendarDate = (
  trades: Trade[] | undefined | null,
  dateKey: string
): Trade[] => {
  if (!Array.isArray(trades) || !dateKey) return [];
  return trades
    .filter((t) => (t.dateTime || '').slice(0, 10) === dateKey)
    .slice()
    .sort((a, b) => {
      const timeDiff = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
      if (!Number.isNaN(timeDiff) && timeDiff !== 0) return timeDiff;
      return (a.id || '').localeCompare(b.id || '');
    });
};

interface PerformanceCalendarProps {
  dailyPerformance: DailyPerformance[];
  monthlyPerformance: MonthlyPerformance[];
  settings: AppSettings;
  isPrivacyMode?: boolean;
  trades?: Trade[];
  onViewTrade?: (trade: Trade) => void;
  onDeleteTradesByDate?: (payload: {
    dateKey: string;
    headerLabel?: string;
    trades: Trade[];
    source: 'calendar';
    isFilteredSubset?: boolean;
    totalTradesOnDate?: number;
  }) => void;
}

export const PerformanceCalendar: React.FC<PerformanceCalendarProps> = React.memo(({
  dailyPerformance,
  monthlyPerformance,
  settings,
  isPrivacyMode = false,
  trades = [],
  onViewTrade,
  onDeleteTradesByDate,
}) => {
  const { preferredCurrency, formatDynamic, formatTradeFinancial } = useGlobalCurrency();
  const { tr } = useLanguage();
  const fmtMoney = (val: number, privacy = isPrivacyMode) =>
    preferredCurrency === 'IDR' ? formatDynamic(val, privacy) : formatCurrency(val, settings, privacy);

  const [activeTab, setActiveTab] = useState<'daily' | 'calendar' | 'monthly'>('calendar');
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showModeMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showModeMenu]);

  // Close daily trades detail on Escape key
  useEffect(() => {
    if (!selectedDate) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedDate(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDate]);

  // Summary statistics of daily performance
  const dailySummary = useMemo(() => {
    const totalDays = dailyPerformance.length;
    const profitDays = dailyPerformance.filter((d) => d.netProfit > 0).length;
    const lossDays = dailyPerformance.filter((d) => d.netProfit < 0).length;
    const breakevenDays = dailyPerformance.filter((d) => d.netProfit === 0).length;
    const dayWinRate = totalDays > 0 ? ((profitDays / totalDays) * 100).toFixed(1) : '0.0';

    return {
      totalDays,
      profitDays,
      lossDays,
      breakevenDays,
      dayWinRate,
    };
  }, [dailyPerformance]);

  // Always default to the current runtime local month (e.g. '2026-11') when opened or refreshed,
  // even if there are no trades in the current month or the last trade was in an earlier month.
  const currentRuntimeMonthKey = useMemo(() => {
    return formatLocalDateKey(new Date()).slice(0, 7);
  }, []);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return formatLocalDateKey(new Date()).slice(0, 7);
  });

  // Calendar Grid Month Selector State: includes current runtime month, past 12 months, next 3 months,
  // any months with trade data, and the user's manually navigated selectedMonth.
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    monthsSet.add(currentRuntimeMonthKey);
    if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) {
      monthsSet.add(selectedMonth);
    }
    const now = new Date();
    for (let i = -12; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      monthsSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    dailyPerformance.forEach((d) => {
      if (d.date && d.date.length >= 7) {
        monthsSet.add(d.date.slice(0, 7));
      }
    });
    return Array.from(monthsSet).sort();
  }, [dailyPerformance, currentRuntimeMonthKey, selectedMonth]);

  const activeMonth = resolveActiveCalendarMonth(selectedMonth, availableMonths);

  const shiftMonthKey = (monthKey: string, deltaMonths: number): string => {
    const [yStr, mStr] = monthKey.split('-');
    const y = parseInt(yStr, 10) || new Date().getFullYear();
    const m = parseInt(mStr, 10) || new Date().getMonth() + 1;
    const shifted = new Date(y, m - 1 + deltaMonths, 1);
    return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
  };

  const handlePrevMonth = () => {
    setSelectedMonth(shiftMonthKey(activeMonth, -1));
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    setSelectedMonth(shiftMonthKey(activeMonth, 1));
    setSelectedDate(null);
  };

  const dailyPerfMap = useMemo(() => {
    const map = new Map<string, DailyPerformance>();
    for (let i = 0; i < dailyPerformance.length; i++) {
      map.set(dailyPerformance[i].date, dailyPerformance[i]);
    }
    return map;
  }, [dailyPerformance]);

  // Build calendar matrix for activeMonth using O(1) Map lookup
  const calendarCells = useMemo(() => {
    const [yearStr, monthStr] = activeMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // 0-indexed

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDaysInMonth = lastDay.getDate();

    // Monday = 0, Sunday = 6
    const firstDayIndex = (firstDay.getDay() + 6) % 7;

    const cells: {
      dayNum: number | null;
      dateStr: string;
      perf: DailyPerformance | null;
    }[] = [];

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({ dayNum: null, dateStr: `empty-pre-${i}`, perf: null });
    }

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateKey = `${yearStr}-${monthStr}-${dayStr}`;
      cells.push({ dayNum: day, dateStr: dateKey, perf: dailyPerfMap.get(dateKey) ?? null });
    }

    return cells;
  }, [activeMonth, dailyPerfMap]);

  const maxDailyProfit = useMemo(() => {
    let maxVal = 100;
    for (let i = 0; i < dailyPerformance.length; i++) {
      const absVal = Math.abs(dailyPerformance[i].netProfit);
      if (absVal > maxVal) maxVal = absVal;
    }
    return maxVal;
  }, [dailyPerformance]);

  const selectedDayPerf = useMemo(() => {
    if (!selectedDate) return null;
    return dailyPerfMap.get(selectedDate) ?? null;
  }, [selectedDate, dailyPerfMap]);

  const selectedDateTrades = useMemo(() => {
    if (!selectedDate) return [];
    return getTradesForCalendarDate(trades, selectedDate);
  }, [selectedDate, trades]);

  const modeLabels: Record<'calendar' | 'daily' | 'monthly', string> = {
    calendar: tr('Kalender Grid', 'Grid Calendar'),
    daily: `${tr('Daftar Harian', 'Daily List')} (${dailyPerformance.length})`,
    monthly: `${tr('Bulanan', 'Monthly')} (${monthlyPerformance.length})`,
  };

  const handleDateClick = (dateStr: string) => {
    setSelectedDate((prev) => (prev === dateStr ? null : dateStr));
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Top Subheader & Compact Pill Mode Control */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
        {/* Daily Summary Strip (Cardless, Hairline-separated) */}
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1.5 text-xs tabular-nums">
          <div className="flex items-center gap-1.5">
            <span className="text-[#526071] dark:text-[#929BA9]">{tr('Hari Aktif', 'Active Days')}</span>
            <strong className="text-[#0F172A] dark:text-[#F2F4F7] font-bold">{dailySummary.totalDays}</strong>
          </div>
          <span className="text-[#E4E4E7] dark:text-[#20252D]">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#526071] dark:text-[#929BA9]">{tr('Profit', 'Profit')}</span>
            <strong className="text-[#059669] dark:text-[#00A878] font-bold">{dailySummary.profitDays}</strong>
          </div>
          <span className="text-[#E4E4E7] dark:text-[#20252D]">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#526071] dark:text-[#929BA9]">{tr('Rugi', 'Loss')}</span>
            <strong className="text-[#E11D48] dark:text-[#E05260] font-bold">{dailySummary.lossDays}</strong>
          </div>
          <span className="text-[#E4E4E7] dark:text-[#20252D]">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#526071] dark:text-[#929BA9]">{tr('Rasio Menang Harian', 'Daily Win Rate')}</span>
            <strong className="text-[#0F172A] dark:text-[#F2F4F7] font-bold">{dailySummary.dayWinRate}%</strong>
          </div>
        </div>

        {/* Compact Dropdown for Calendar View Mode */}
        <div className="relative self-start sm:self-auto" ref={modeMenuRef}>
          <button
            type="button"
            onClick={() => setShowModeMenu((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] hover:border-[#0F172A]/40 dark:hover:border-white/40 transition-colors cursor-pointer select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            <span>{modeLabels[activeTab]}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] transition-transform duration-150 ${
                showModeMenu ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showModeMenu && (
            <div
              style={{ contain: 'layout style' }}
              className="absolute left-0 sm:left-auto sm:right-0 top-9 z-30 w-44 max-w-[calc(100vw-2rem)] rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-1 shadow-[0_12px_28px_-6px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.75)] text-xs animate-in fade-in slide-in-from-top-1 duration-150"
            >
              {(['calendar', 'daily', 'monthly'] as const).map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => {
                    setActiveTab(tabKey);
                    setShowModeMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer flex items-center justify-between ${
                    activeTab === tabKey
                      ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]'
                  }`}
                >
                  <span>{modeLabels[tabKey]}</span>
                  {activeTab === tabKey && <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TAB 1: SEAMLESS CALENDAR GRID VIEW */}
      {activeTab === 'calendar' && (
        <div className="space-y-3">
          {/* Month Navigator Toolbar */}
          <div className="flex items-center justify-between py-2 border-y border-[#E4E4E7] dark:border-[#20252D] text-xs">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              title={tr('Bulan sebelumnya', 'Previous month')}
              aria-label={tr('Bulan sebelumnya', 'Previous month')}
            >
              <ChevronLeft className="h-4 w-4 stroke-[1.75]" />
            </button>
            <div className="font-bold text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] tabular-nums tracking-wide">
              <span>{activeMonth}</span>
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              title={tr('Bulan berikutnya', 'Next month')}
              aria-label={tr('Bulan berikutnya', 'Next month')}
            >
              <ChevronRight className="h-4 w-4 stroke-[1.75]" />
            </button>
          </div>

          {/* Breathable Seamless 7-Column Calendar Grid */}
          <div className="w-full">
            {/* Days of Week Header */}
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9] pb-1.5">
              {(
                tr('Sen,Sel,Rab,Kam,Jum,Sab,Min', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun').split(',')
              ).map((d, i) => (
                <div key={i} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar Day Cells (No heavy boxes, clean hairline/hover) */}
            <div className="grid grid-cols-7 gap-1 select-none">
              {calendarCells.map((cell, idx) => {
                if (cell.dayNum === null) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      className="min-h-[64px] sm:min-h-[76px]"
                    />
                  );
                }

                const hasTrade = cell.perf !== null;
                const isProfit = hasTrade && cell.perf!.netProfit > 0;
                const isLoss = hasTrade && cell.perf!.netProfit < 0;
                const isSelected = selectedDate === cell.dateStr;
                const formattedCellPl = hasTrade
                  ? `${isProfit ? '+' : ''}${fmtMoney(cell.perf!.netProfit)}`
                  : '';

                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    onClick={() => handleDateClick(cell.dateStr)}
                    aria-label={
                      hasTrade
                        ? tr(
                            `Tanggal ${cell.dateStr}, ${cell.perf!.tradesCount} transaksi, Net P/L ${formattedCellPl}, Win Rate ${cell.perf!.winRate}%`,
                            `Date ${cell.dateStr}, ${cell.perf!.tradesCount} trades, Net P/L ${formattedCellPl}, Win Rate ${cell.perf!.winRate}%`
                          )
                        : tr(`Tanggal ${cell.dateStr}, tanpa transaksi`, `Date ${cell.dateStr}, no trades`)
                    }
                    className={`min-h-[64px] sm:min-h-[76px] py-2 px-1 rounded-xl flex flex-col justify-between items-center text-center transition-colors duration-150 cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                      isSelected
                        ? 'bg-[#F4F4F5] dark:bg-[#161A22] ring-1 ring-[#0F172A]/60 dark:ring-white/60'
                        : hasTrade
                        ? 'hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/60'
                        : 'opacity-55 hover:opacity-90 hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/40'
                    }`}
                  >
                    {/* 1. Angka Tanggal */}
                    <span
                      className={`text-[11px] sm:text-xs leading-none tabular-nums ${
                        isSelected
                          ? 'font-bold text-[#0F172A] dark:text-[#F2F4F7]'
                          : hasTrade
                          ? 'font-semibold text-[#0F172A] dark:text-[#F2F4F7]'
                          : 'font-normal text-[#526071] dark:text-[#929BA9]'
                      }`}
                    >
                      {cell.dayNum}
                    </span>

                    {/* 2. Nominal Net Profit / Loss */}
                    {hasTrade ? (
                      <div className="w-full my-auto flex flex-col items-center justify-center px-0.5">
                        <span
                          className={`block text-[10px] sm:text-[11px] font-bold leading-tight tabular-nums whitespace-nowrap overflow-hidden text-ellipsis max-w-full ${
                            isProfit
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : isLoss
                              ? 'text-[#E11D48] dark:text-[#E05260]'
                              : 'text-[#526071] dark:text-[#929BA9]'
                          }`}
                        >
                          {preferredCurrency === 'IDR'
                            ? formatCalendarAdaptivePnl(cell.perf!.netProfit, settings, isPrivacyMode, 'compact')
                            : formatCalendarAdaptivePnl(cell.perf!.netProfit, settings, isPrivacyMode, 'adaptive')}
                        </span>
                      </div>
                    ) : (
                      <div className="flex-1" />
                    )}

                    {/* 3. Jumlah Closed Trades (Secondary Info) */}
                    {hasTrade ? (
                      <span className="text-[9px] sm:text-[10px] font-normal leading-none text-[#526071] dark:text-[#929BA9] tabular-nums">
                        {cell.perf!.tradesCount}T
                      </span>
                    ) : (
                      <span className="h-2.5" />
                    )}

                    {/* Subtle bottom active bar on selected date */}
                    {isSelected && (
                      <span className="absolute bottom-1 h-0.5 w-4 rounded-full bg-[#0F172A] dark:bg-white" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DETAILED DAILY LIST VIEW (HAIRLINE DIVIDED ROWS) */}
      {activeTab === 'daily' && (
        <div>
          {dailyPerformance.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#526071] dark:text-[#929BA9]">
              {tr('Belum ada catatan trade harian pada periode ini.', 'No daily trade records in this period.')}
            </p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D]">
              {dailyPerformance.slice().reverse().map((day) => {
                const isProfit = day.netProfit > 0;
                const isLoss = day.netProfit < 0;
                const barWidth = Math.min(100, (Math.abs(day.netProfit) / maxDailyProfit) * 100);
                const isSelected = selectedDate === day.date;

                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => handleDateClick(day.date)}
                    className={`w-full text-left flex items-center justify-between py-3 px-2 transition-colors gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-[#F4F4F5] dark:bg-[#161A22]'
                        : 'hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="tabular-nums text-xs font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                        {day.date}
                      </div>
                      <div className="text-[11px] text-[#526071] dark:text-[#929BA9] tabular-nums mt-0.5">
                        {day.tradesCount} {tr('Trade', 'Trades')} ({day.winningTrades}W · {day.losingTrades}L · {day.breakevenTrades}BE) · {tr('Rasio Menang', 'Win Rate')} {day.winRate}%
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="hidden sm:block w-20 h-1.5 bg-[#E4E4E7] dark:bg-[#20252D] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isProfit ? 'bg-[#059669] dark:bg-[#00A878]' : isLoss ? 'bg-[#E11D48] dark:bg-[#E05260]' : 'bg-[#526071] dark:bg-[#929BA9]'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>

                      <div className="tabular-nums text-xs sm:text-sm font-bold text-right">
                        <span
                          className={
                            isProfit
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : isLoss
                              ? 'text-[#E11D48] dark:text-[#E05260]'
                              : 'text-[#526071] dark:text-[#929BA9]'
                          }
                        >
                          {isProfit ? '+' : ''}
                          {fmtMoney(day.netProfit)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MONTHLY PERFORMANCE SUMMARY (HAIRLINE DIVIDED LIST) */}
      {activeTab === 'monthly' && (
        <div>
          {monthlyPerformance.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#526071] dark:text-[#929BA9]">
              {tr('Belum ada data bulanan pada periode ini.', 'No monthly data in this period.')}
            </p>
          ) : (
            <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-y border-[#E4E4E7] dark:border-[#20252D]">
              {monthlyPerformance.slice().reverse().map((m) => {
                const isProfit = m.netProfit > 0;
                const isLoss = m.netProfit < 0;
                return (
                  <div
                    key={m.monthKey}
                    className="py-3 px-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs tabular-nums"
                  >
                    <div>
                      <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7] block">
                        {m.label}
                      </span>
                      <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                        {m.tradesCount} {tr('Trade', 'Trades')} · {tr('Rasio Menang', 'Win Rate')} {m.winRate}%
                      </span>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6">
                      <div className="text-left sm:text-right">
                        <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                          {tr('Imbal Hasil', 'Return')}
                        </span>
                        <span
                          className={`font-semibold ${
                            settings.startingBalance <= 0
                              ? 'text-[#526071] dark:text-[#929BA9]'
                              : isProfit
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : isLoss
                              ? 'text-[#E11D48] dark:text-[#E05260]'
                              : 'text-[#0F172A] dark:text-[#F2F4F7]'
                          }`}
                        >
                          {settings.startingBalance <= 0
                            ? 'N/A'
                            : `${isProfit ? '+' : ''}${m.gainPercent}%`}
                        </span>
                      </div>

                      <div className="text-right min-w-[96px]">
                        <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                          {tr('P/L Bersih', 'Net P/L')}
                        </span>
                        <span
                          className={`font-bold text-xs sm:text-sm ${
                            isProfit
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : isLoss
                              ? 'text-[#E11D48] dark:text-[#E05260]'
                              : 'text-[#0F172A] dark:text-[#F2F4F7]'
                          }`}
                        >
                          {isProfit ? '+' : ''}
                          {fmtMoney(m.netProfit)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* INLINE DAILY DETAIL PANEL (APPEARS WHEN A DATE IS CLICKED) */}
      {selectedDate !== null && (
        <div
          className="rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_4px_20px_rgba(15,23,42,0.06)] dark:shadow-none p-4 space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-150"
          role="region"
          aria-label={tr(`Rincian tanggal ${selectedDate}`, `Details for ${selectedDate}`)}
        >
          {/* Detail Header */}
          <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7] tabular-nums">
                {tr('Detail Performa Harian', 'Daily Performance Detail')} — {selectedDate}
              </h4>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                {selectedDateTrades.length > 0
                  ? tr(`${selectedDateTrades.length} transaksi tercatat`, `${selectedDateTrades.length} trades recorded`)
                  : tr('Tidak ada transaksi pada tanggal ini', 'No trades on this date')}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onDeleteTradesByDate && selectedDateTrades.length > 0 && (
                <button
                  type="button"
                  data-testid="analytics-calendar-delete-day-btn"
                  onClick={() =>
                    onDeleteTradesByDate({
                      dateKey: selectedDate,
                      headerLabel: selectedDate,
                      trades: selectedDateTrades,
                      source: 'calendar',
                    })
                  }
                  title={tr('Hapus semua transaksi tanggal ini', 'Delete all trades for this date')}
                  aria-label={tr(
                    `Hapus ${selectedDateTrades.length} transaksi pada ${selectedDate}`,
                    `Delete ${selectedDateTrades.length} trades on ${selectedDate}`
                  )}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-[#E11D48] dark:text-[#E05260] bg-[#E11D48]/10 hover:bg-[#E11D48]/15 dark:bg-[#E05260]/12 dark:hover:bg-[#E05260]/20 border border-[#E11D48]/20 dark:border-[#E05260]/25 transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
                  <span>{tr('Hapus Semua', 'Delete All')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                aria-label={tr('Tutup rincian tanggal', 'Close date details')}
              >
                <X className="h-4 w-4 stroke-[1.75]" />
              </button>
            </div>
          </div>

          {/* 4 Required Daily Metrics: Tanggal, Net Profit/Loss, Jumlah Transaksi, Win Rate */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D] text-xs tabular-nums">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                {tr('Tanggal', 'Date')}
              </span>
              <strong className="mt-0.5 block text-xs sm:text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {selectedDate}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                {tr('Profit / Loss Bersih', 'Net Profit / Loss')}
              </span>
              <strong
                className={`mt-0.5 block text-xs sm:text-sm font-bold ${
                  selectedDayPerf && selectedDayPerf.netProfit > 0
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : selectedDayPerf && selectedDayPerf.netProfit < 0
                    ? 'text-[#E11D48] dark:text-[#E05260]'
                    : 'text-[#0F172A] dark:text-[#F2F4F7]'
                }`}
              >
                {selectedDayPerf
                  ? `${selectedDayPerf.netProfit > 0 ? '+' : ''}${fmtMoney(selectedDayPerf.netProfit)}`
                  : fmtMoney(0)}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                {tr('Jumlah Transaksi', 'Total Trades')}
              </span>
              <strong className="mt-0.5 block text-xs sm:text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {selectedDayPerf
                  ? `${selectedDayPerf.tradesCount} ${tr('Trade', 'Trades')}`
                  : `${selectedDateTrades.length} ${tr('Trade', 'Trades')}`}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                {tr('Rasio Menang Hari Ini', 'Win Rate Today')}
              </span>
              <strong className="mt-0.5 block text-xs sm:text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {selectedDayPerf ? `${selectedDayPerf.winRate}%` : '0%'}
              </strong>
            </div>
          </div>

          {/* Concise Trade List for Selected Date */}
          {selectedDateTrades.length === 0 ? (
            <p className="py-3 text-center text-xs text-[#526071] dark:text-[#929BA9]">
              {tr(
                'Hari tanpa transaksi tidak memengaruhi perhitungan rasio menang maupun drawdown.',
                'Days without trades do not affect win rate or drawdown calculations.'
              )}
            </p>
          ) : (
            <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] max-h-60 overflow-y-auto">
              {selectedDateTrades.map((trade) => {
                const netPl = computeTradeNetProfit(trade);
                const outcome = resolveTradeOutcome(trade);
                const rMultiple = computeRealizedRMultiple(trade, settings);
                const timePart = (trade.dateTime || '').slice(11, 16) || '--:--';
                const isBuy = trade.position === 'BUY';

                return (
                  <div
                    key={trade.id}
                    onClick={() => onViewTrade && onViewTrade(trade)}
                    className={`py-2.5 px-1 flex items-center justify-between gap-3 text-xs tabular-nums transition-colors ${
                      onViewTrade
                        ? 'cursor-pointer hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]'
                        : ''
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                          {trade.instrument || 'XAUUSD'}
                        </span>
                        <span
                          className={`text-[11px] font-bold ${
                            isBuy ? 'text-[#059669] dark:text-[#00A878]' : 'text-[#E11D48] dark:text-[#E05260]'
                          }`}
                        >
                          {trade.position}
                        </span>
                        <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                          {trade.lotSize} Lot
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#526071] dark:text-[#929BA9]">
                          <Clock className="h-3 w-3 stroke-[1.75]" />
                          {timePart}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                        {trade.session ? `${trade.session} · ` : ''}
                        Realized R: {rMultiple !== null ? formatRMultiple(rMultiple, true) : 'N/A'} · {outcome}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div
                        className={`text-xs sm:text-sm font-bold text-right ${
                          netPl > 0
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : netPl < 0
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : 'text-[#0F172A] dark:text-[#F2F4F7]'
                        }`}
                      >
                        {preferredCurrency === 'IDR'
                          ? formatTradeFinancial(trade, 'netProfit', isPrivacyMode, true)
                          : `${netPl > 0 ? '+' : ''}${formatCurrency(netPl, settings, isPrivacyMode)}`}
                      </div>
                      {onViewTrade && (
                        <Eye className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9]" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
