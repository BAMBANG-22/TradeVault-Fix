import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  computeTradeNetProfit,
  resolveTradeOutcome,
  formatCurrency,
  extractTradeLocalDateKey,
  isClosedLifecycleTrade,
} from '../../utils/calculations';
import {
  UsdIdrRateRecord,
  useGlobalCurrency,
  formatTradeFinancialValue,
  computeCumulativeProfitInDisplayCurrency,
} from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { ChevronDown, X, ArrowUpRight, Check, Trash2 } from 'lucide-react';

interface DashboardCalendarProps {
  trades: Trade[];
  settings: AppSettings;
  isPrivacyMode?: boolean;
  onViewTrade?: (trade: Trade) => void;
  onDeleteTradesByDate?: (payload: {
    dateKey: string;
    headerLabel?: string;
    trades: Trade[];
    source: 'calendar';
    isFilteredSubset?: boolean;
    totalTradesOnDate?: number;
  }) => void;
  preferredCurrency?: 'USD' | 'IDR';
  rateRecord?: UsdIdrRateRecord | null;
}

const DAYS_OF_WEEK_ID = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];
const DAYS_OF_WEEK_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const DashboardCalendar: React.FC<DashboardCalendarProps> = ({
  trades,
  settings,
  isPrivacyMode = false,
  onViewTrade,
  onDeleteTradesByDate,
  preferredCurrency,
  rateRecord,
}) => {
  const { isEn, tr, locale } = useLanguage();
  const globalCur = useGlobalCurrency();
  const activeCurrency = preferredCurrency || globalCur.preferredCurrency;
  const activeRateRecord = rateRecord || globalCur.rateRecord;

  const closedTrades = useMemo(() => {
    return (trades || []).filter((t) => {
      if (!isClosedLifecycleTrade(t)) return false;
      const outcome = resolveTradeOutcome(t);
      return outcome === 'WIN' || outcome === 'LOSS' || outcome === 'BREAKEVEN';
    });
  }, [trades]);

  const initialMonthKey = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }, []);

  const [activeMonth, setActiveMonth] = useState<string>(initialMonthKey);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const monthDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMonthDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(e.target as Node)) {
        setIsMonthDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMonthDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMonthDropdownOpen]);

  const todayDateKey = useMemo(() => {
    return extractTradeLocalDateKey(new Date().toISOString());
  }, []);

  const { year, month } = useMemo(() => {
    const [yStr, mStr] = activeMonth.split('-');
    return {
      year: parseInt(yStr, 10) || new Date().getFullYear(),
      month: parseInt(mStr, 10) || new Date().getMonth() + 1,
    };
  }, [activeMonth]);

  const monthDisplayLabel = useMemo(() => {
    const d = new Date(year, month - 1, 1);
    const raw = d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [year, month, locale]);

  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    closedTrades.forEach((t) => {
      const key = extractTradeLocalDateKey(t.dateTime);
      if (key) {
        monthSet.add(key.slice(0, 7));
      }
    });

    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthSet.add(curKey);
    if (activeMonth) {
      monthSet.add(activeMonth);
    }
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return Array.from(monthSet).sort().reverse();
  }, [closedTrades, activeMonth]);

  const tradesByDateMap = useMemo(() => {
    const map = new Map<string, Trade[]>();
    closedTrades.forEach((t) => {
      const dateKey = extractTradeLocalDateKey(t.dateTime);
      if (dateKey) {
        const list = map.get(dateKey) || [];
        list.push(t);
        map.set(dateKey, list);
      }
    });
    return map;
  }, [closedTrades]);

  const { cells, summary } = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayIndexRaw = new Date(year, month - 1, 1).getDay();
    const firstDayIndex = (firstDayIndexRaw + 6) % 7;

    const cellList: Array<{
      dayNum: number;
      dateKey: string;
      isCurrentMonth: boolean;
      netProfit: number;
      tradesCount: number;
      status: 'PROFIT' | 'LOSS' | 'BREAKEVEN' | 'NO_TRADE';
    }> = [];

    if (firstDayIndex > 0) {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
      const prevMonthStr = String(prevMonth).padStart(2, '0');

      for (let i = firstDayIndex - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const dateKey = `${prevYear}-${prevMonthStr}-${String(day).padStart(2, '0')}`;
        const dayTrades = tradesByDateMap.get(dateKey) || [];
        let status: 'PROFIT' | 'LOSS' | 'BREAKEVEN' | 'NO_TRADE' = 'NO_TRADE';
        let netProfit = 0;

        if (dayTrades.length > 0) {
          netProfit = dayTrades.reduce((sum, t) => sum + computeTradeNetProfit(t), 0);
          status = netProfit > 0 ? 'PROFIT' : netProfit < 0 ? 'LOSS' : 'BREAKEVEN';
        }

        cellList.push({
          dayNum: day,
          dateKey,
          isCurrentMonth: false,
          netProfit,
          tradesCount: dayTrades.length,
          status,
        });
      }
    }

    let profitDays = 0;
    let lossDays = 0;
    let noTradeDays = 0;
    const curMonthStr = String(month).padStart(2, '0');

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${curMonthStr}-${String(day).padStart(2, '0')}`;
      const dayTrades = tradesByDateMap.get(dateKey) || [];

      if (dayTrades.length > 0) {
        const netProfit = dayTrades.reduce((sum, t) => sum + computeTradeNetProfit(t), 0);
        let status: 'PROFIT' | 'LOSS' | 'BREAKEVEN' | 'NO_TRADE' = 'NO_TRADE';

        if (netProfit > 0) {
          profitDays++;
          status = 'PROFIT';
        } else if (netProfit < 0) {
          lossDays++;
          status = 'LOSS';
        } else {
          status = 'BREAKEVEN';
          noTradeDays++;
        }

        cellList.push({
          dayNum: day,
          dateKey,
          isCurrentMonth: true,
          netProfit,
          tradesCount: dayTrades.length,
          status,
        });
      } else {
        noTradeDays++;
        cellList.push({
          dayNum: day,
          dateKey,
          isCurrentMonth: true,
          netProfit: 0,
          tradesCount: 0,
          status: 'NO_TRADE',
        });
      }
    }

    const remainder = (7 - (cellList.length % 7)) % 7;
    if (remainder > 0) {
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextMonthStr = String(nextMonth).padStart(2, '0');

      for (let day = 1; day <= remainder; day++) {
        const dateKey = `${nextYear}-${nextMonthStr}-${String(day).padStart(2, '0')}`;
        const dayTrades = tradesByDateMap.get(dateKey) || [];
        let status: 'PROFIT' | 'LOSS' | 'BREAKEVEN' | 'NO_TRADE' = 'NO_TRADE';
        let netProfit = 0;

        if (dayTrades.length > 0) {
          netProfit = dayTrades.reduce((sum, t) => sum + computeTradeNetProfit(t), 0);
          status = netProfit > 0 ? 'PROFIT' : netProfit < 0 ? 'LOSS' : 'BREAKEVEN';
        }

        cellList.push({
          dayNum: day,
          dateKey,
          isCurrentMonth: false,
          netProfit,
          tradesCount: dayTrades.length,
          status,
        });
      }
    }

    return {
      cells: cellList,
      summary: {
        profitDays,
        lossDays,
        noTradeDays,
      },
    };
  }, [year, month, tradesByDateMap]);

  const selectedTrades = useMemo(() => {
    if (!selectedDate) return [];
    return tradesByDateMap.get(selectedDate) || [];
  }, [selectedDate, tradesByDateMap]);

  const selectedDateNetProfit = useMemo(() => {
    return selectedTrades.reduce((sum, t) => sum + computeTradeNetProfit(t), 0);
  }, [selectedTrades]);

  const selectedDateFormatted = useMemo(() => {
    if (!selectedDate) return '';
    try {
      const [y, m, d] = selectedDate.split('-');
      const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
      return dateObj.toLocaleDateString(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate, locale]);

  const daysOfWeek = isEn ? DAYS_OF_WEEK_EN : DAYS_OF_WEEK_ID;

  return (
    <div
      aria-label={tr('Kalender Performa', 'Performance Calendar')}
      className="space-y-4 font-sans select-none"
    >
      {/* 4.A Header: Title + Dropdown Bulan */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9]">
          {tr('KALENDER PERFORMA', 'PERFORMANCE CALENDAR')}
        </h2>

        <div ref={monthDropdownRef} className="relative">
          <button
            type="button"
            data-testid="calendar-month-dropdown-button"
            onClick={() => setIsMonthDropdownOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={isMonthDropdownOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] hover:border-[#0F172A]/40 dark:hover:border-white/40 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            <span>{monthDisplayLabel}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 stroke-[2] text-[#526071] dark:text-[#929BA9] transition-transform duration-150 ${
                isMonthDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isMonthDropdownOpen && (
            <div
              role="listbox"
              aria-label={tr('Pilih Bulan Kalender', 'Select Calendar Month')}
              data-testid="calendar-month-dropdown-menu"
              className="absolute right-0 top-full mt-1.5 z-30 w-48 max-h-64 overflow-y-auto rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] py-1 shadow-xl"
            >
              {availableMonths.map((mKey) => {
                const [yS, mS] = mKey.split('-');
                const yN = parseInt(yS, 10);
                const mN = parseInt(mS, 10);
                const d = new Date(yN, mN - 1, 1);
                const rawLabel = d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
                const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
                const isSelected = activeMonth === mKey;

                return (
                  <button
                    key={mKey}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setActiveMonth(mKey);
                      setSelectedDate(null);
                      setIsMonthDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-white font-semibold'
                        : 'text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]'
                    }`}
                  >
                    <span>{label}</span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 stroke-[2] text-[#0F172A] dark:text-white" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 4.B Ringkasan Statistik */}
      <div className="grid grid-cols-3 gap-2 py-1 text-center font-mono-numbers tabular-nums">
        <div>
          <div className="text-[10px] sm:text-[11px] font-sans font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
            {tr('HARI PROFIT', 'PROFIT DAYS')}
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#059669] dark:text-[#00A878] mt-0.5">
            {summary.profitDays}
          </div>
        </div>

        <div>
          <div className="text-[10px] sm:text-[11px] font-sans font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
            {tr('HARI LOSS', 'LOSS DAYS')}
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#E11D48] dark:text-[#E05260] mt-0.5">
            {summary.lossDays}
          </div>
        </div>

        <div>
          <div className="text-[10px] sm:text-[11px] font-sans font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
            {tr('TANPA TRADE', 'NO TRADE')}
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
            {summary.noTradeDays}
          </div>
        </div>
      </div>

      {/* 4.C Days of Week Header */}
      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] sm:text-[11px] font-semibold text-[#526071] dark:text-[#929BA9] py-1.5">
          {daysOfWeek.map((dayName) => (
            <div key={dayName}>{dayName}</div>
          ))}
        </div>
        <div className="border-b border-[#E4E4E7] dark:border-[#20252D] my-1" />
      </div>

      {/* 4.C Calendar Grid */}
      <div className="grid grid-cols-7 gap-y-3 sm:gap-y-4 font-mono-numbers tabular-nums">
        {cells.map((cell, idx) => {
          const isSelected = selectedDate === cell.dateKey;
          const isToday = todayDateKey === cell.dateKey;
          const isProfit = cell.status === 'PROFIT';
          const isLoss = cell.status === 'LOSS';
          const isBreakeven = cell.status === 'BREAKEVEN';

          return (
            <button
              key={`${cell.dateKey}-${idx}`}
              type="button"
              onClick={() => setSelectedDate(isSelected ? null : cell.dateKey)}
              className="group flex flex-col items-center justify-center py-1 transition-colors cursor-pointer relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              title={`${cell.dateKey}${
                cell.tradesCount > 0
                  ? `: ${cell.tradesCount} ${tr('Trade Selesai', 'Closed Trades')}`
                  : ''
              }`}
            >
              <span
                className={`text-xs sm:text-sm leading-tight transition-colors ${
                  isSelected
                    ? 'text-[#0F172A] dark:text-white font-bold'
                    : isToday
                    ? 'text-[#0F172A] dark:text-white font-bold'
                    : cell.isCurrentMonth
                    ? 'text-[#0F172A] dark:text-[#F2F4F7] font-medium group-hover:text-[#0F172A] dark:group-hover:text-white'
                    : 'text-[#526071]/40 dark:text-[#929BA9]/35 font-normal'
                }`}
              >
                {cell.dayNum}
              </span>

              <div className="h-3 flex items-center justify-center mt-0.5">
                {isProfit ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#059669] dark:bg-[#00A878]" />
                ) : isLoss ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E11D48] dark:bg-[#E05260]" />
                ) : isBreakeven ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#526071] dark:bg-[#929BA9]" />
                ) : (
                  <span className="w-1.5 h-1.5 opacity-0" />
                )}
              </div>

              {isSelected && (
                <span className="absolute bottom-0 w-3 h-0.5 rounded-full bg-[#0F172A] dark:bg-white" />
              )}
            </button>
          );
        })}
      </div>

      {/* 4.D DAILY PERFORMANCE DETAIL CARD */}
      {selectedDate && (
        <div
          data-testid="daily-performance-smoked-card"
          role="region"
          aria-label={tr('Detail Performa Harian', 'Daily Performance Detail')}
          className="mt-5 p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_4px_20px_rgba(15,23,42,0.06)] dark:shadow-none transition-all duration-200 select-none animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
            <div className="space-y-0.5 min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#526071] dark:text-[#929BA9]">
                {tr('PERFORMA HARIAN', 'DAILY PERFORMANCE')}
              </span>
              <h3 className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                {selectedDateFormatted}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onDeleteTradesByDate && selectedTrades.length > 0 && (
                <button
                  type="button"
                  data-testid="dashboard-calendar-delete-day-btn"
                  onClick={() => {
                    const totalOnDate = (trades || []).filter(
                      (t) => extractTradeLocalDateKey(t.dateTime) === selectedDate
                    ).length;
                    onDeleteTradesByDate({
                      dateKey: selectedDate,
                      headerLabel: selectedDateFormatted,
                      trades: selectedTrades,
                      source: 'calendar',
                      isFilteredSubset: selectedTrades.length < totalOnDate,
                      totalTradesOnDate: totalOnDate,
                    });
                  }}
                  title={tr('Hapus semua transaksi tanggal ini', 'Delete all trades for this date')}
                  aria-label={tr(
                    `Hapus ${selectedTrades.length} transaksi pada ${selectedDateFormatted}`,
                    `Delete ${selectedTrades.length} trades on ${selectedDateFormatted}`
                  )}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-[#E11D48] dark:text-[#E05260] bg-[#E11D48]/10 hover:bg-[#E11D48]/15 dark:bg-[#E05260]/12 dark:hover:bg-[#E05260]/20 border border-[#E11D48]/20 dark:border-[#E05260]/25 transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
                  <span>{tr('Hapus Semua', 'Delete All')}</span>
                </button>
              )}
              <button
                type="button"
                data-testid="daily-card-close-button"
                onClick={() => setSelectedDate(null)}
                className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                title={tr('Tutup Detail Harian', 'Close Daily Detail')}
                aria-label={tr('Tutup Detail Harian', 'Close Daily Detail')}
              >
                <X className="h-4 w-4 stroke-[2]" />
              </button>
            </div>
          </div>

          <div className="py-3.5 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 font-mono-numbers tabular-nums">
            <div className="space-y-0.5">
              <div
                data-testid="daily-card-net-pnl"
                className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                  selectedDateNetProfit > 0
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : selectedDateNetProfit < 0
                    ? 'text-[#E11D48] dark:text-[#E05260]'
                    : 'text-[#0F172A] dark:text-[#F2F4F7]'
                }`}
              >
                {isPrivacyMode
                  ? '******'
                  : activeCurrency === 'IDR'
                  ? (() => {
                      const idrVal = computeCumulativeProfitInDisplayCurrency(
                        selectedTrades,
                        'IDR',
                        activeRateRecord
                      );
                      const sign = idrVal > 0 ? '+' : idrVal < 0 ? '-' : '';
                      const formatted = new Intl.NumberFormat('id-ID', {
                        style: 'currency',
                        currency: 'IDR',
                        maximumFractionDigits: 0,
                      }).format(Math.abs(idrVal));
                      return `${sign}${formatted}`;
                    })()
                  : `${selectedDateNetProfit > 0 ? '+' : selectedDateNetProfit < 0 ? '-' : ''}${formatCurrency(
                      Math.abs(selectedDateNetProfit),
                      settings,
                      false
                    )}`}
              </div>
              <div
                className={`text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase font-sans ${
                  selectedDateNetProfit > 0
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : selectedDateNetProfit < 0
                    ? 'text-[#E11D48] dark:text-[#E05260]'
                    : 'text-[#526071] dark:text-[#929BA9]'
                }`}
              >
                {selectedDateNetProfit > 0
                  ? tr('PROFIT BERSIH HARIAN', 'DAILY NET PROFIT')
                  : selectedDateNetProfit < 0
                  ? tr('LOSS BERSIH HARIAN', 'DAILY NET LOSS')
                  : selectedTrades.length > 0
                  ? tr('IMPAS HARIAN', 'DAILY BREAKEVEN')
                  : tr('TIDAK ADA TRADE', 'NO TRADES')}
              </div>
            </div>

            <div className="text-xs text-[#526071] dark:text-[#929BA9] font-sans">
              {selectedTrades.length}{' '}
              {selectedTrades.length === 1
                ? tr('Trade Selesai', 'Closed Trade')
                : tr('Trade Selesai', 'Closed Trades')}
            </div>
          </div>

          <div className="pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
            {selectedTrades.length === 0 ? (
              <div className="py-4 text-center text-xs text-[#526071] dark:text-[#929BA9]">
                {tr('Tidak ada transaksi pada tanggal ini', 'No trades on this date')}
              </div>
            ) : (
              <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] max-h-60 overflow-y-auto pr-0.5">
                {selectedTrades.map((t) => {
                  const pnl = computeTradeNetProfit(t);
                  const isBuy = t.position === 'BUY';
                  const isWin = pnl > 0;
                  const isLoss = pnl < 0;

                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onViewTrade?.(t)}
                      className="w-full py-2.5 px-2 flex items-center justify-between text-left cursor-pointer text-xs font-mono-numbers tabular-nums group transition-colors hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7] group-hover:text-black dark:group-hover:text-white transition-colors truncate">
                          {t.instrument}
                        </span>
                        <span
                          className={`text-xs font-bold uppercase ${
                            isBuy
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : 'text-[#E11D48] dark:text-[#E05260]'
                          }`}
                        >
                          {t.position}
                        </span>
                        <span className="text-[#526071] dark:text-[#929BA9] text-[11px] truncate">
                          {Number(t.lotSize || 0).toFixed(2)} Lot
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`font-bold ${
                            isWin
                              ? 'text-[#059669] dark:text-[#00A878]'
                              : isLoss
                              ? 'text-[#E11D48] dark:text-[#E05260]'
                              : 'text-[#526071] dark:text-[#929BA9]'
                          }`}
                        >
                          {isPrivacyMode
                            ? '******'
                            : formatTradeFinancialValue(
                                t,
                                'netProfit',
                                activeCurrency,
                                activeRateRecord,
                                false,
                                true
                              )}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] group-hover:text-[#0F172A] dark:group-hover:text-white transition-colors" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
