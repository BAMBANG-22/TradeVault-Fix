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
}

export const PerformanceCalendar: React.FC<PerformanceCalendarProps> = ({
  dailyPerformance,
  monthlyPerformance,
  settings,
  isPrivacyMode = false,
  trades = [],
  onViewTrade,
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

  // Build calendar matrix for activeMonth
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
      const foundPerf = dailyPerformance.find((d) => d.date === dateKey) || null;
      cells.push({ dayNum: day, dateStr: dateKey, perf: foundPerf });
    }

    return cells;
  }, [activeMonth, dailyPerformance]);

  const maxDailyProfit = Math.max(
    ...dailyPerformance.map((d) => Math.abs(d.netProfit)),
    100
  );

  const selectedDayPerf = useMemo(() => {
    if (!selectedDate) return null;
    return dailyPerformance.find((d) => d.date === selectedDate) || null;
  }, [selectedDate, dailyPerformance]);

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
    <div className="space-y-4 font-['Arial',Helvetica,sans-serif]">
      {/* Top Subheader & Compact Pill Mode Control */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
        {/* Daily Summary Strip (Cardless, Hairline-separated) */}
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1.5 text-xs tabular-nums">
          <div className="flex items-center gap-1.5">
            <span className="text-[#697586] dark:text-[#7D8796]">{tr('Hari Aktif', 'Active Days')}</span>
            <strong className="text-[#151D2A] dark:text-[#F2F5F9] font-bold">{dailySummary.totalDays}</strong>
          </div>
          <span className="text-[#DDE3EA] dark:text-white/10">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#697586] dark:text-[#7D8796]">{tr('Profit', 'Profit')}</span>
            <strong className="text-[#00A878] font-bold">{dailySummary.profitDays}</strong>
          </div>
          <span className="text-[#DDE3EA] dark:text-white/10">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#697586] dark:text-[#7D8796]">{tr('Rugi', 'Loss')}</span>
            <strong className="text-[#E05260] font-bold">{dailySummary.lossDays}</strong>
          </div>
          <span className="text-[#DDE3EA] dark:text-white/10">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#697586] dark:text-[#7D8796]">{tr('Rasio Menang Harian', 'Daily Win Rate')}</span>
            <strong className="text-[#151D2A] dark:text-[#F2F5F9] font-bold">{dailySummary.dayWinRate}%</strong>
          </div>
        </div>

        {/* Compact Pill Dropdown for Calendar View Mode */}
        <div className="relative self-start sm:self-auto" ref={modeMenuRef}>
          <button
            type="button"
            onClick={() => setShowModeMenu((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-black/[0.03] dark:bg-white/[0.04] border border-[#DDE3EA] dark:border-white/[0.08] text-[#151D2A] dark:text-[#F2F5F9] hover:border-[#3B82F6]/50 transition-colors cursor-pointer select-none whitespace-nowrap"
          >
            <span>{modeLabels[activeTab]}</span>
            <ChevronDown className="h-3.5 w-3.5 text-[#697586] dark:text-[#8E98A8]" />
          </button>

          {showModeMenu && (
            <div className="absolute left-0 sm:left-auto sm:right-0 top-9 z-30 w-44 max-w-[calc(100vw-2rem)] rounded-xl border border-[#DDE3EA] dark:border-white/10 bg-white dark:bg-[#0E1217] p-1 shadow-xl text-xs">
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
                      ? 'bg-black/[0.05] dark:bg-white/[0.07] text-[#151D2A] dark:text-[#F2F5F9] font-bold'
                      : 'text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                  }`}
                >
                  <span>{modeLabels[tabKey]}</span>
                  {activeTab === tabKey && <span className="h-1.5 w-1.5 rounded-full bg-[#3B82F6]" />}
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
          <div className="flex items-center justify-between py-2 border-y border-[#DDE3EA] dark:border-white/[0.06] text-xs">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-full text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-pointer transition-colors"
              title={tr('Bulan sebelumnya', 'Previous month')}
              aria-label={tr('Bulan sebelumnya', 'Previous month')}
            >
              <ChevronLeft className="h-4 w-4 stroke-[1.75]" />
            </button>
            <div className="font-bold text-xs sm:text-sm text-[#151D2A] dark:text-[#F2F5F9] tabular-nums tracking-wide">
              <span>{activeMonth}</span>
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-full text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-pointer transition-colors"
              title={tr('Bulan berikutnya', 'Next month')}
              aria-label={tr('Bulan berikutnya', 'Next month')}
            >
              <ChevronRight className="h-4 w-4 stroke-[1.75]" />
            </button>
          </div>

          {/* Breathable Seamless 7-Column Calendar Grid */}
          <div className="w-full">
            {/* Days of Week Header */}
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#6E7785] pb-1.5">
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
                    className={`min-h-[64px] sm:min-h-[76px] py-2 px-1 rounded-xl flex flex-col justify-between items-center text-center transition-all cursor-pointer relative ${
                      isSelected
                        ? 'bg-black/[0.06] dark:bg-white/[0.07] ring-1 ring-[#3B82F6]/60'
                        : hasTrade
                        ? 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                        : 'opacity-55 hover:opacity-90 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* 1. Angka Tanggal */}
                    <span
                      className={`text-[11px] sm:text-xs leading-none tabular-nums ${
                        isSelected
                          ? 'font-bold text-[#151D2A] dark:text-[#F2F5F9]'
                          : hasTrade
                          ? 'font-semibold text-[#151D2A] dark:text-[#D5DCE6]'
                          : 'font-normal text-[#697586] dark:text-[#6E7785]'
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
                              ? 'text-[#00A878]'
                              : isLoss
                              ? 'text-[#E05260]'
                              : 'text-[#697586] dark:text-[#8E98A8]'
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
                      <span className="text-[9px] sm:text-[10px] font-normal leading-none text-[#697586] dark:text-[#6E7785] tabular-nums">
                        {cell.perf!.tradesCount}T
                      </span>
                    ) : (
                      <span className="h-2.5" />
                    )}

                    {/* Subtle bottom active bar on selected date */}
                    {isSelected && (
                      <span className="absolute bottom-1 h-0.5 w-4 rounded-full bg-[#3B82F6]" />
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
            <p className="py-8 text-center text-xs text-[#697586] dark:text-[#7D8796]">
              {tr('Belum ada catatan trade harian pada periode ini.', 'No daily trade records in this period.')}
            </p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto divide-y divide-[#DDE3EA] dark:divide-white/[0.06] border-y border-[#DDE3EA] dark:border-white/[0.06]">
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
                        ? 'bg-black/[0.04] dark:bg-white/[0.05]'
                        : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="tabular-nums text-xs font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                        {day.date}
                      </div>
                      <div className="text-[11px] text-[#697586] dark:text-[#7D8796] tabular-nums mt-0.5">
                        {day.tradesCount} {tr('Trade', 'Trades')} ({day.winningTrades}W · {day.losingTrades}L · {day.breakevenTrades}BE) · {tr('Rasio Menang', 'Win Rate')} {day.winRate}%
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="hidden sm:block w-20 h-1.5 bg-[#DDE3EA] dark:bg-white/[0.07] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isProfit ? 'bg-[#00A878]' : isLoss ? 'bg-[#E05260]' : 'bg-[#7D8796]'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>

                      <div className="tabular-nums text-xs sm:text-sm font-bold text-right">
                        <span
                          className={
                            isProfit
                              ? 'text-[#00A878]'
                              : isLoss
                              ? 'text-[#E05260]'
                              : 'text-[#697586] dark:text-[#8E98A8]'
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
            <p className="py-8 text-center text-xs text-[#697586] dark:text-[#7D8796]">
              {tr('Belum ada data bulanan pada periode ini.', 'No monthly data in this period.')}
            </p>
          ) : (
            <div className="divide-y divide-[#DDE3EA] dark:divide-white/[0.06] border-y border-[#DDE3EA] dark:border-white/[0.06]">
              {monthlyPerformance.slice().reverse().map((m) => {
                const isProfit = m.netProfit > 0;
                const isLoss = m.netProfit < 0;
                return (
                  <div
                    key={m.monthKey}
                    className="py-3 px-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs tabular-nums"
                  >
                    <div>
                      <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9] block">
                        {m.label}
                      </span>
                      <span className="text-[11px] text-[#697586] dark:text-[#7D8796]">
                        {m.tradesCount} {tr('Trade', 'Trades')} · {tr('Rasio Menang', 'Win Rate')} {m.winRate}%
                      </span>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6">
                      <div className="text-left sm:text-right">
                        <span className="text-[10px] text-[#697586] dark:text-[#7D8796] block">
                          {tr('Imbal Hasil', 'Return')}
                        </span>
                        <span
                          className={`font-semibold ${
                            settings.startingBalance <= 0
                              ? 'text-[#697586] dark:text-[#7D8796]'
                              : isProfit
                              ? 'text-[#00A878]'
                              : isLoss
                              ? 'text-[#E05260]'
                              : 'text-[#151D2A] dark:text-[#F2F5F9]'
                          }`}
                        >
                          {settings.startingBalance <= 0
                            ? 'N/A'
                            : `${isProfit ? '+' : ''}${m.gainPercent}%`}
                        </span>
                      </div>

                      <div className="text-right min-w-[96px]">
                        <span className="text-[10px] text-[#697586] dark:text-[#7D8796] block">
                          {tr('P/L Bersih', 'Net P/L')}
                        </span>
                        <span
                          className={`font-bold text-xs sm:text-sm ${
                            isProfit
                              ? 'text-[#00A878]'
                              : isLoss
                              ? 'text-[#E05260]'
                              : 'text-[#151D2A] dark:text-[#F2F5F9]'
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

      {/* INLINE BLACK SMOKED GLASS DAILY DETAIL PANEL (APPEARS WHEN A DATE IS CLICKED) */}
      {selectedDate !== null && (
        <div
          className="rounded-2xl border border-[#DDE3EA] dark:border-white/[0.08] bg-white/95 dark:bg-[#0D1015]/90 backdrop-blur-md p-4 space-y-3.5 transition-all duration-200 animate-in fade-in slide-in-from-top-2"
          role="region"
          aria-label={tr(`Rincian tanggal ${selectedDate}`, `Details for ${selectedDate}`)}
        >
          {/* Detail Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[#DDE3EA] dark:border-white/[0.06]">
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F5F9] tabular-nums">
                {tr('Detail Performa Harian', 'Daily Performance Detail')} — {selectedDate}
              </h4>
              <p className="text-[11px] text-[#697586] dark:text-[#7D8796]">
                {selectedDateTrades.length > 0
                  ? tr(`${selectedDateTrades.length} transaksi tercatat`, `${selectedDateTrades.length} trades recorded`)
                  : tr('Tidak ada transaksi pada tanggal ini', 'No trades on this date')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="p-1.5 rounded-full text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
              aria-label={tr('Tutup rincian tanggal', 'Close date details')}
            >
              <X className="h-4 w-4 stroke-[1.75]" />
            </button>
          </div>

          {/* 4 Required Daily Metrics: Tanggal, Net Profit/Loss, Jumlah Transaksi, Win Rate */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b border-[#DDE3EA] dark:border-white/[0.06] text-xs tabular-nums">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#697586] dark:text-[#7D8796]">
                {tr('Tanggal', 'Date')}
              </span>
              <strong className="mt-0.5 block text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {selectedDate}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#697586] dark:text-[#7D8796]">
                {tr('Profit / Loss Bersih', 'Net Profit / Loss')}
              </span>
              <strong
                className={`mt-0.5 block text-xs sm:text-sm font-bold ${
                  selectedDayPerf && selectedDayPerf.netProfit > 0
                    ? 'text-[#00A878]'
                    : selectedDayPerf && selectedDayPerf.netProfit < 0
                    ? 'text-[#E05260]'
                    : 'text-[#151D2A] dark:text-[#F2F5F9]'
                }`}
              >
                {selectedDayPerf
                  ? `${selectedDayPerf.netProfit > 0 ? '+' : ''}${fmtMoney(selectedDayPerf.netProfit)}`
                  : fmtMoney(0)}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#697586] dark:text-[#7D8796]">
                {tr('Jumlah Transaksi', 'Total Trades')}
              </span>
              <strong className="mt-0.5 block text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {selectedDayPerf
                  ? `${selectedDayPerf.tradesCount} ${tr('Trade', 'Trades')}`
                  : `${selectedDateTrades.length} ${tr('Trade', 'Trades')}`}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#697586] dark:text-[#7D8796]">
                {tr('Rasio Menang Hari Ini', 'Win Rate Today')}
              </span>
              <strong className="mt-0.5 block text-xs sm:text-sm font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {selectedDayPerf ? `${selectedDayPerf.winRate}%` : '0%'}
              </strong>
            </div>
          </div>

          {/* Concise Trade List for Selected Date */}
          {selectedDateTrades.length === 0 ? (
            <p className="py-3 text-center text-xs text-[#697586] dark:text-[#7D8796]">
              {tr(
                'Hari tanpa transaksi tidak memengaruhi perhitungan rasio menang maupun drawdown.',
                'Days without trades do not affect win rate or drawdown calculations.'
              )}
            </p>
          ) : (
            <div className="divide-y divide-[#DDE3EA] dark:divide-white/[0.06] max-h-60 overflow-y-auto">
              {selectedDateTrades.map((trade) => {
                const netPl = computeTradeNetProfit(trade);
                const outcome = resolveTradeOutcome(trade);
                const rMultiple = computeRealizedRMultiple(trade);
                const timePart = (trade.dateTime || '').slice(11, 16) || '--:--';
                const isBuy = trade.position === 'BUY';

                return (
                  <div
                    key={trade.id}
                    onClick={() => onViewTrade && onViewTrade(trade)}
                    className={`py-2.5 px-1 flex items-center justify-between gap-3 text-xs tabular-nums transition-colors ${
                      onViewTrade
                        ? 'cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                        : ''
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                          {trade.instrument || 'XAUUSD'}
                        </span>
                        <span
                          className={`text-[11px] font-bold ${
                            isBuy ? 'text-[#00A878]' : 'text-[#E05260]'
                          }`}
                        >
                          {trade.position}
                        </span>
                        <span className="text-[11px] text-[#697586] dark:text-[#8E98A8]">
                          {trade.lotSize} Lot
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#697586] dark:text-[#7D8796]">
                          <Clock className="h-3 w-3 stroke-[1.75]" />
                          {timePart}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#697586] dark:text-[#7D8796]">
                        {trade.session ? `${trade.session} · ` : ''}
                        Realized R: {rMultiple !== null ? formatRMultiple(rMultiple, true) : 'N/A'} · {outcome}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div
                        className={`text-xs sm:text-sm font-bold text-right ${
                          netPl > 0
                            ? 'text-[#00A878]'
                            : netPl < 0
                            ? 'text-[#E05260]'
                            : 'text-[#151D2A] dark:text-[#F2F5F9]'
                        }`}
                      >
                        {preferredCurrency === 'IDR'
                          ? formatTradeFinancial(trade, 'netProfit', isPrivacyMode, true)
                          : `${netPl > 0 ? '+' : ''}${formatCurrency(netPl, settings, isPrivacyMode)}`}
                      </div>
                      {onViewTrade && (
                        <Eye className="h-3.5 w-3.5 text-[#697586] dark:text-[#8E98A8]" />
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
};
