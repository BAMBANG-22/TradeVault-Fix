import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Trade,
  TradeFilter,
  TradeLifecycleStatus,
  TradeCloseType,
} from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  computeRealizedRMultiple,
  extractTradeLocalDateKey,
  formatCurrency,
  formatRMultiple,
  normalizeTradeDateTimeLocal,
} from '../../utils/calculations';
import {
  computeLifecycleSummaryCounts,
  getTradeLifecycleStatus,
  groupTradesByDate,
  resolveTradeLifecycle,
  transitionPlannedTradeToOpen,
  transitionPlannedTradeToCancelled,
  transitionOpenTradeToClosed,
} from '../../utils/tradeLifecycle';
import {
  getCachedUsdIdrRate,
  getCurrentUsdIdrSnapshot,
  useGlobalCurrency,
} from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { calculateLotBasedOrderMetrics } from '../../utils/riskCalculator';
import {
  Search,
  Filter,
  Edit2,
  Trash2,
  Image,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Cloud,
  AlertTriangle,
  Menu,
  HardDrive,
  CheckCircle2,
  XCircle,
  Lock,
  X,
  ScanLine,
  BookOpen,
} from 'lucide-react';
import { Mt5HistoryScanModal } from './Mt5HistoryScanModal';

interface DateGroupCardProps {
  section: {
    dateKey: string;
    headerLabel: string;
    trades: Trade[];
  };
  settings: AppSettings;
  onViewDetail: (trade: Trade) => void;
  onUpdateTradeLifecycle?: (
    updatedTrade: Trade,
    originalId?: string
  ) => Promise<{ success: boolean; error?: string } | void>;
  openPlannedTransitionModal: (trade: Trade, mode?: 'OPEN' | 'CANCEL') => void;
  openClosePositionModal: (trade: Trade) => void;
  onViewScreenshot: (url: string, title: string) => void;
  onEditTrade: (trade: Trade) => void;
  onDeleteTrade: (trade: Trade) => void;
  onDeleteDateGroup?: () => void;
  dateGroupTotalCount?: number;
}

const DateGroupCard: React.FC<DateGroupCardProps> = ({
  section,
  settings,
  onViewDetail,
  onUpdateTradeLifecycle,
  openPlannedTransitionModal,
  openClosePositionModal,
  onViewScreenshot,
  onEditTrade,
  onDeleteTrade,
  onDeleteDateGroup,
  dateGroupTotalCount,
}) => {
  const { preferredCurrency, formatTradeFinancial } = useGlobalCurrency();
  const { tr } = useLanguage();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [currentVisibleIndex, setCurrentVisibleIndex] = useState(1);
  const [isExpanded, setIsExpanded] = useState(false);
  const count = section.trades.length;
  const hasMoreThanTwo = count > 2;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const ratio = Math.min(1, Math.max(0, el.scrollTop / scrollable));
    const idx = Math.min(count, Math.max(1, 1 + Math.round(ratio * (count - 1))));
    setCurrentVisibleIndex(idx);
  };

  const handleScrollStep = (direction: 'up' | 'down') => {
    if (!scrollRef.current) return;
    const step = 74;
    scrollRef.current.scrollBy({
      top: direction === 'up' ? -step : step,
      behavior: 'smooth',
    });
  };

  const localizedHeaderLabel =
    section.headerLabel === 'TODAY'
      ? tr('HARI INI', 'TODAY')
      : section.headerLabel === 'YESTERDAY'
      ? tr('KEMARIN', 'YESTERDAY')
      : section.headerLabel;

  return (
    <div
      data-testid={`trade-log-date-group-${section.dateKey}`}
      className="tv-smoked-glass-card rounded-[16px] border border-[#E4E4E7] dark:border-white/[0.09] overflow-hidden transition-all duration-200"
    >
      {/* Date Group Header */}
      <div className="px-4 py-2.5 bg-[#FAFAFA] dark:bg-white/[0.03] border-b border-[#E4E4E7] dark:border-white/[0.08] flex items-center justify-between gap-2 select-none">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
          {localizedHeaderLabel}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
            {count} {tr('Transaksi', 'Trades')}
          </span>
          {onDeleteDateGroup && (dateGroupTotalCount ?? count) > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteDateGroup();
              }}
              data-testid={`delete-date-group-${section.dateKey}`}
              title={tr('Hapus semua transaksi tanggal ini', 'Delete all trades for this date')}
              aria-label={tr(
                `Hapus ${dateGroupTotalCount ?? count} transaksi pada ${localizedHeaderLabel}`,
                `Delete ${dateGroupTotalCount ?? count} trades on ${localizedHeaderLabel}`
              )}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#697586] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-[#E11D48]/10 dark:hover:bg-[#E05260]/15 transition-colors cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
              <span className="hidden sm:inline">{tr('Hapus', 'Delete')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Trades Rows */}
      <div
        ref={scrollRef}
        onScroll={hasMoreThanTwo && !isExpanded ? handleScroll : undefined}
        className={`divide-y divide-black/5 dark:divide-white/[0.06] ${
          hasMoreThanTwo && !isExpanded
            ? 'max-h-[212px] sm:max-h-[224px] overflow-y-auto overscroll-y-auto'
            : ''
        }`}
        style={
          hasMoreThanTwo && !isExpanded
            ? {
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255, 255, 255, 0.15) transparent',
              }
            : undefined
        }
      >
        {section.trades.map((t) => {
          const status = getTradeLifecycleStatus(t);
          const resolved = resolveTradeLifecycle(t);
          const timePart = (t.dateTime || '').slice(11, 16) || '00:00';
          const displayLot =
            status === 'OPEN' || status === 'CLOSED'
              ? resolved.actualLot ?? t.lotSize
              : resolved.plannedLot ?? t.lotSize;
          const isProfit = t.netProfit >= 0.01;
          const isLoss = t.netProfit <= -0.01;
          const realizedR = status === 'CLOSED' ? computeRealizedRMultiple(t) : null;

          return (
            <div
              key={t.id}
              onClick={() => onViewDetail(t)}
              data-testid={`trade-row-${t.id}`}
              className="px-4 py-3.5 hover:bg-black/5 dark:hover:bg-white/[0.04] transition-colors cursor-pointer flex items-center justify-between gap-3"
            >
              {/* Left: Symbol, BUY/SELL, Lot, Time */}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                    {t.instrument}
                  </span>
                  <span
                    className={`text-xs font-bold uppercase ${
                      t.position === 'BUY'
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : 'text-[#E11D48] dark:text-[#E05260]'
                    }`}
                  >
                    {t.position}
                  </span>
                  <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                    {displayLot.toFixed(2)} Lot
                  </span>
                  {t.isDemo && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/[0.06] text-amber-600 dark:text-amber-400 border border-black/10 dark:border-white/[0.08] font-semibold">
                      DEMO
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums flex-wrap">
                  <span>{timePart}</span>
                  <span>•</span>
                  <span className="font-sans truncate max-w-[200px] sm:max-w-xs">
                    {t.strategy || tr('Umum', 'General')}
                  </span>
                  {t.session && (
                    <>
                      <span>•</span>
                      <span className="font-sans">{t.session}</span>
                    </>
                  )}
                  <span className="hidden sm:inline">•</span>
                  <span className="hidden sm:inline">
                    Entry {(resolved.actualEntry ?? resolved.plannedEntry).toFixed(2)}
                  </span>
                  {realizedR !== null && (
                    <>
                      <span className="hidden md:inline">•</span>
                      <span className="hidden md:inline font-semibold">
                        {formatRMultiple(realizedR)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Right: Status or Realized Result + Quick Lifecycle / Row Actions */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  {status === 'CLOSED' && (
                    <>
                      <div
                        className={`text-sm font-bold font-mono-numbers tabular-nums ${
                          isProfit
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : isLoss
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : 'text-[#151D2A] dark:text-[#F2F5F9]'
                        }`}
                      >
                        {preferredCurrency === 'IDR'
                          ? formatTradeFinancial(t, 'netProfit', false, true)
                          : `${isProfit ? '+' : ''}${formatCurrency(t.netProfit, settings)}`}
                      </div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                        {tr('SELESAI', 'CLOSED')}
                      </div>
                    </>
                  )}

                  {status === 'PLANNED' && (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F5F9]">
                        {tr('RENCANA', 'LIMIT')}
                      </span>
                      {onUpdateTradeLifecycle && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPlannedTransitionModal(t, 'OPEN');
                          }}
                          className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full border border-[#E4E4E7] dark:border-white/[0.09] bg-[#FAFAFA] dark:bg-white/[0.04] text-[#151D2A] dark:text-[#F2F5F9] hover:border-black/30 dark:hover:border-white/30 transition-colors cursor-pointer"
                        >
                          {tr('Eksekusi / Batal', 'Execute / Cancel')}
                        </button>
                      )}
                    </div>
                  )}

                  {status === 'OPEN' && (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        {tr('AKTIF', 'OPEN')}
                      </span>
                      {onUpdateTradeLifecycle && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openClosePositionModal(t);
                          }}
                          className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full border border-[#E4E4E7] dark:border-white/[0.09] bg-[#FAFAFA] dark:bg-white/[0.04] text-[#151D2A] dark:text-[#F2F5F9] hover:border-black/30 dark:hover:border-white/30 transition-colors cursor-pointer"
                        >
                          {tr('Tutup Posisi', 'Close Position')}
                        </button>
                      )}
                    </div>
                  )}

                  {status === 'CANCELLED' && (
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#697586] dark:text-[#929BA9]">
                        {tr('BATAL', 'CANCELLED')}
                      </span>
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9]">
                        {tr('Dibatalkan', 'Cancelled')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Secondary Row Actions on Desktop */}
                <div
                  className="hidden sm:flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.screenshotUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        onViewScreenshot(
                          t.screenshotUrl!,
                          `${t.instrument} - ${t.strategy}`
                        )
                      }
                      className="p-1.5 rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-black/5 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                      title={tr('Lihat Screenshot', 'View Screenshot')}
                      aria-label={tr(`Lihat screenshot ${t.id}`, `View screenshot ${t.id}`)}
                    >
                      <Image className="h-3.5 w-3.5 stroke-[1.75]" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onEditTrade(t)}
                    className="p-1.5 rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-black/5 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                    title={tr('Edit Transaksi', 'Edit Trade')}
                    aria-label={tr(`Edit transaksi ${t.id}`, `Edit trade ${t.id}`)}
                  >
                    <Edit2 className="h-3.5 w-3.5 stroke-[1.75]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteTrade(t)}
                    className="p-1.5 rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-black/5 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                    title={tr('Hapus Transaksi', 'Delete Trade')}
                    aria-label={tr(`Hapus transaksi ${t.id}`, `Delete trade ${t.id}`)}
                  >
                    <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Minimalist Scroll & Expand Indicator: ONLY shown if trades.length > 2 */}
      {hasMoreThanTwo && (
        <div
          data-testid={`trade-log-scroll-indicator-${section.dateKey}`}
          className="px-4 py-1.5 border-t border-black/10 dark:border-white/[0.06] bg-black/5 dark:bg-black/30 flex items-center justify-between gap-2 text-[11px] text-[#697586] dark:text-[#929BA9] font-mono-numbers select-none"
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-wider uppercase font-sans">
              {count} {tr('TRANSAKSI', 'TRADES')}
            </span>
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="text-[10px] font-sans font-semibold px-2.5 py-0.5 rounded-full border border-black/10 dark:border-white/[0.08] bg-white/60 dark:bg-white/[0.04] text-[#151D2A] dark:text-[#F2F5F9] hover:border-black/25 dark:hover:border-white/25 transition-colors cursor-pointer"
            >
              {isExpanded
                ? tr('Ringkas', 'Collapse')
                : tr(`Tampilkan Semua (${count})`, `Show All (${count})`)}
            </button>
          </div>
          {!isExpanded && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleScrollStep('up')}
                className="p-1 rounded-full text-xs leading-none hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                title={tr('Scroll ke atas', 'Scroll up')}
                aria-label={tr('Scroll ke atas', 'Scroll up')}
              >
                ↑
              </button>
              <span className="font-semibold text-xs tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                {currentVisibleIndex}/{count}
              </span>
              <button
                type="button"
                onClick={() => handleScrollStep('down')}
                className="p-1 rounded-full text-xs leading-none hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                title={tr('Scroll ke bawah', 'Scroll down')}
                aria-label={tr('Scroll ke bawah', 'Scroll down')}
              >
                ↓
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TradeTableProps {
  trades: Trade[];
  settings: AppSettings;
  onAddTrade: () => void;
  onEditTrade: (trade: Trade) => void;
  onDeleteTrade: (trade: Trade) => void;
  onViewDetail: (trade: Trade) => void;
  onViewScreenshot: (url: string, title: string) => void;
  onClearDemoTrades: () => void;
  onUpdateTradeLifecycle?: (
    updatedTrade: Trade,
    originalId?: string
  ) => Promise<{ success: boolean; error?: string } | void>;
  onOpenMobileMenu?: () => void;
  currentUser?: any | null;
  dataSource?: 'cloud' | 'local_fallback' | 'local';
  isCloudSyncing?: boolean;
  cloudLoadError?: string | null;
  onReloadFromCloud?: () => void;
  onSyncLocalToCloud?: () => void;
  onImportBatchTrades?: (
    newTrades: Trade[]
  ) => Promise<{ success: boolean; error?: string; importedCount?: number }>;
  onOpenPlaybook?: () => void;
  onDeleteTradesByDate?: (payload: {
    dateKey: string;
    headerLabel?: string;
    trades: Trade[];
    source: 'journal';
    isFilteredSubset?: boolean;
    totalTradesOnDate?: number;
  }) => void;
}

export const TradeTable: React.FC<TradeTableProps> = ({
  trades,
  settings,
  onAddTrade,
  onEditTrade,
  onDeleteTrade,
  onViewDetail,
  onViewScreenshot,
  onClearDemoTrades,
  onUpdateTradeLifecycle,
  onOpenMobileMenu,
  currentUser,
  dataSource = 'local',
  isCloudSyncing = false,
  onReloadFromCloud,
  onImportBatchTrades,
  onOpenPlaybook,
  onDeleteTradesByDate,
}) => {
  const { tr } = useLanguage();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleFocusSearch = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('vlo:focus-trade-search', handleFocusSearch);
    return () => window.removeEventListener('vlo:focus-trade-search', handleFocusSearch);
  }, []);
  const [filters, setFilters] = useState<TradeFilter>({
    search: '',
    lifecycleStatus: 'ALL',
    outcome: 'ALL',
    position: 'ALL',
    strategy: 'ALL',
    instrument: 'ALL',
    session: 'ALL',
    startDate: '',
    endDate: '',
    sortBy: 'date-desc',
  });

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isMt5ScanModalOpen, setIsMt5ScanModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Lifecycle transition dialog state
  const [plannedModalTrade, setPlannedModalTrade] = useState<Trade | null>(null);
  const [plannedActionMode, setPlannedActionMode] = useState<'OPEN' | 'CANCEL'>('OPEN');
  const [mt5Confirmed, setMt5Confirmed] = useState<boolean>(true);
  const [actualEntryInput, setActualEntryInput] = useState<string>('');
  const [actualLotInput, setActualLotInput] = useState<string>('');
  const [openDateInput, setOpenDateInput] = useState<string>('');
  const [openTimeInput, setOpenTimeInput] = useState<string>('');
  const [cancelReasonInput, setCancelReasonInput] = useState<string>('');
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [isTransitionSubmitting, setIsTransitionSubmitting] = useState<boolean>(false);

  const [closeModalTrade, setCloseModalTrade] = useState<Trade | null>(null);
  const [closeTypeInput, setCloseTypeInput] = useState<TradeCloseType>('TP');
  const [actualExitInput, setActualExitInput] = useState<string>('');
  const [closeDateInput, setCloseDateInput] = useState<string>('');
  const [closeTimeInput, setCloseTimeInput] = useState<string>('');
  const [closeCommInput, setCloseCommInput] = useState<string>('0');
  const [closeSwapInput, setCloseSwapInput] = useState<string>('0');
  const [closeNetOverrideInput, setCloseNetOverrideInput] = useState<string>('');

  // Summary counts for the 4 lifecycle categories
  const summaryCounts = useMemo(() => computeLifecycleSummaryCounts(trades), [trades]);

  const activeStatusIndex = useMemo(() => {
    switch (filters.lifecycleStatus) {
      case 'PLANNED':
        return 0;
      case 'OPEN':
        return 1;
      case 'CLOSED':
        return 2;
      case 'CANCELLED':
        return 3;
      default:
        return -1;
    }
  }, [filters.lifecycleStatus]);

  // Unique filter values
  const uniqueStrategies = useMemo(() => {
    const set = new Set<string>();
    trades.forEach((t) => {
      if (t.strategy) set.add(t.strategy);
    });
    return Array.from(set).sort();
  }, [trades]);

  const uniqueInstruments = useMemo(() => {
    const set = new Set<string>();
    trades.forEach((t) => {
      if (t.instrument) set.add(t.instrument.toUpperCase());
    });
    return Array.from(set).sort();
  }, [trades]);

  const uniqueSessions = useMemo(() => {
    const set = new Set<string>();
    trades.forEach((t) => {
      if (t.session) set.add(t.session);
    });
    return Array.from(set).sort();
  }, [trades]);

  const hasDemoTrades = useMemo(() => trades.some((t) => t.isDemo), [trades]);

  // Filtered and sorted trades (never mutates original timestamps)
  const filteredTrades = useMemo(() => {
    return trades
      .filter((t) => {
        const status = getTradeLifecycleStatus(t);

        if (
          filters.lifecycleStatus &&
          filters.lifecycleStatus !== 'ALL' &&
          status !== filters.lifecycleStatus
        ) {
          return false;
        }

        if (filters.search) {
          const q = filters.search.toLowerCase();
          const matchId = t.id.toLowerCase().includes(q);
          const matchStrat = t.strategy?.toLowerCase().includes(q);
          const matchNotes = t.notes?.toLowerCase().includes(q);
          const matchReason = t.entryReason?.toLowerCase().includes(q);
          const matchEval = t.postTradeEvaluation?.toLowerCase().includes(q);
          const matchPair = t.instrument?.toLowerCase().includes(q);
          const matchSession = t.session?.toLowerCase().includes(q);
          if (
            !matchId &&
            !matchStrat &&
            !matchNotes &&
            !matchReason &&
            !matchEval &&
            !matchPair &&
            !matchSession
          ) {
            return false;
          }
        }

        if (filters.outcome !== 'ALL') {
          if (status !== 'CLOSED' || t.outcome !== filters.outcome) {
            return false;
          }
        }

        if (filters.position !== 'ALL' && t.position !== filters.position) {
          return false;
        }

        if (filters.strategy !== 'ALL' && t.strategy !== filters.strategy) {
          return false;
        }

        if (filters.instrument !== 'ALL' && t.instrument.toUpperCase() !== filters.instrument) {
          return false;
        }

        if (filters.session !== 'ALL' && t.session !== filters.session) {
          return false;
        }

        if (filters.startDate) {
          if (t.dateTime.slice(0, 10) < filters.startDate) return false;
        }
        if (filters.endDate) {
          if (t.dateTime.slice(0, 10) > filters.endDate) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (filters.sortBy === 'date-desc') {
          const diff = new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime();
          return diff !== 0 ? diff : b.id.localeCompare(a.id);
        }
        if (filters.sortBy === 'date-asc') {
          const diff = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        }
        if (filters.sortBy === 'profit-desc') {
          return b.netProfit - a.netProfit;
        }
        if (filters.sortBy === 'profit-asc') {
          return a.netProfit - b.netProfit;
        }
        if (filters.sortBy === 'lot-desc') {
          return b.lotSize - a.lotSize;
        }
        return 0;
      });
  }, [trades, filters]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [filters, pageSize]);

  // Pagination
  const totalItems = filteredTrades.length;
  const isAll = pageSize === 0;
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = isAll ? 0 : (safePage - 1) * pageSize;
  const endIndex = isAll ? totalItems : Math.min(startIndex + pageSize, totalItems);
  const paginatedTrades = filteredTrades.slice(startIndex, endIndex);

  // Date-grouped sections
  const dateGroupedSections = useMemo(
    () => groupTradesByDate(paginatedTrades),
    [paginatedTrades]
  );

  // Full date maps (unpaginated) so deleting a date deletes all matching trades on that date, not just current page rows
  const filteredTradesByDateKey = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filteredTrades) {
      const k = extractTradeLocalDateKey(t.dateTime || '') || 'UNKNOWN';
      const arr = map.get(k);
      if (arr) arr.push(t);
      else map.set(k, [t]);
    }
    return map;
  }, [filteredTrades]);

  const allTradesCountByDateKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades) {
      const k = extractTradeLocalDateKey(t.dateTime || '') || 'UNKNOWN';
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }, [trades]);

  const applyQuickDate = (type: 'ALL' | 'TODAY' | '7D' | 'MONTH') => {
    const now = new Date();
    if (type === 'ALL') {
      setFilters((prev) => ({ ...prev, startDate: '', endDate: '' }));
    } else if (type === 'TODAY') {
      const todayStr = now.toISOString().slice(0, 10);
      setFilters((prev) => ({ ...prev, startDate: todayStr, endDate: todayStr }));
    } else if (type === '7D') {
      const past = new Date();
      past.setDate(now.getDate() - 7);
      setFilters((prev) => ({
        ...prev,
        startDate: past.toISOString().slice(0, 10),
        endDate: now.toISOString().slice(0, 10),
      }));
    } else if (type === 'MONTH') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setFilters((prev) => ({
        ...prev,
        startDate: firstDay.toISOString().slice(0, 10),
        endDate: now.toISOString().slice(0, 10),
      }));
    }
  };

  const resetFilters = () => {
    setFilters({
      search: '',
      lifecycleStatus: 'ALL',
      outcome: 'ALL',
      position: 'ALL',
      strategy: 'ALL',
      instrument: 'ALL',
      session: 'ALL',
      startDate: '',
      endDate: '',
      sortBy: 'date-desc',
    });
  };

  const toggleStatusFilter = (targetStatus: TradeLifecycleStatus) => {
    setFilters((prev) => ({
      ...prev,
      lifecycleStatus: prev.lifecycleStatus === targetStatus ? 'ALL' : targetStatus,
    }));
  };

  const openPlannedTransitionModal = (trade: Trade, mode: 'OPEN' | 'CANCEL' = 'OPEN') => {
    const resolved = resolveTradeLifecycle(trade);
    const nowLocal = normalizeTradeDateTimeLocal(new Date());
    setPlannedModalTrade(trade);
    setPlannedActionMode(mode);
    setMt5Confirmed(true);
    setActualEntryInput(String(resolved.plannedEntry || trade.entryPrice || ''));
    setActualLotInput(String(resolved.plannedLot || trade.lotSize || '0.01'));
    setOpenDateInput(nowLocal.slice(0, 10));
    setOpenTimeInput(nowLocal.slice(11, 16));
    setCancelReasonInput('');
    setLifecycleError(null);
  };

  const openClosePositionModal = (trade: Trade) => {
    const nowLocal = normalizeTradeDateTimeLocal(new Date());
    setCloseModalTrade(trade);
    const defaultCloseType: TradeCloseType =
      trade.takeProfit && trade.takeProfit > 0
        ? 'TP'
        : trade.stopLoss && trade.stopLoss > 0
        ? 'SL'
        : 'Manual';
    setCloseTypeInput(defaultCloseType);
    const defaultExit =
      defaultCloseType === 'TP' && trade.takeProfit
        ? String(trade.takeProfit)
        : defaultCloseType === 'SL' && trade.stopLoss
        ? String(trade.stopLoss)
        : trade.exitPrice
        ? String(trade.exitPrice)
        : String(trade.entryPrice || '');
    setActualExitInput(defaultExit);
    setCloseDateInput(nowLocal.slice(0, 10));
    setCloseTimeInput(nowLocal.slice(11, 16));
    setCloseCommInput(String(trade.commission || 0));
    setCloseSwapInput(String(trade.swap || 0));
    setCloseNetOverrideInput('');
    setLifecycleError(null);
  };

  const handleCloseTypeSelect = (nextType: TradeCloseType) => {
    setCloseTypeInput(nextType);
    if (!closeModalTrade) return;
    if (nextType === 'TP' && closeModalTrade.takeProfit && closeModalTrade.takeProfit > 0) {
      setActualExitInput(String(closeModalTrade.takeProfit));
      setCloseNetOverrideInput('');
    } else if (nextType === 'SL' && closeModalTrade.stopLoss && closeModalTrade.stopLoss > 0) {
      setActualExitInput(String(closeModalTrade.stopLoss));
      setCloseNetOverrideInput('');
    }
  };

  const handleConfirmPlannedTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plannedModalTrade || !onUpdateTradeLifecycle || isTransitionSubmitting) return;
    setLifecycleError(null);

    try {
      let updatedTrade: Trade;
      if (plannedActionMode === 'OPEN') {
        if (!mt5Confirmed) {
          setLifecycleError(
            tr(
              'Harap centang konfirmasi bahwa order telah tereksekusi di MT5.',
              'Please check the confirmation box that the order has been executed on MT5.'
            )
          );
          return;
        }
        const entryNum = parseFloat(actualEntryInput);
        const lotNum = parseFloat(actualLotInput);
        if (isNaN(entryNum) || entryNum <= 0) {
          setLifecycleError(
            tr(
              'Harga Actual Entry wajib diisi dengan angka positif.',
              'Actual Entry price must be a positive number.'
            )
          );
          return;
        }
        if (isNaN(lotNum) || lotNum <= 0) {
          setLifecycleError(
            tr(
              'Actual Lot wajib diisi dengan angka lebih dari 0.',
              'Actual Lot must be a number greater than 0.'
            )
          );
          return;
        }
        const combinedEntryTime =
          openDateInput && openTimeInput
            ? `${openDateInput}T${openTimeInput}`
            : new Date().toISOString();

        updatedTrade = transitionPlannedTradeToOpen(plannedModalTrade, {
          actualEntryPrice: entryNum,
          actualLotSize: lotNum,
          entryTime: combinedEntryTime,
          settings,
        });
      } else {
        updatedTrade = transitionPlannedTradeToCancelled(
          plannedModalTrade,
          cancelReasonInput
        );
      }

      setIsTransitionSubmitting(true);
      const res = await onUpdateTradeLifecycle(updatedTrade, plannedModalTrade.id);
      if (!res || res.success !== false) {
        setPlannedModalTrade(null);
      } else {
        setLifecycleError(
          res.error || tr('Gagal memperbarui status transaksi.', 'Failed to update trade status.')
        );
      }
    } catch (err: any) {
      setLifecycleError(
        err?.message || tr('Gagal memproses perubahan status.', 'Failed to process status change.')
      );
    } finally {
      setIsTransitionSubmitting(false);
    }
  };

  const handleConfirmClosePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closeModalTrade || !onUpdateTradeLifecycle || isTransitionSubmitting) return;
    setLifecycleError(null);

    try {
      const exitNum = parseFloat(actualExitInput);
      if (isNaN(exitNum) || exitNum <= 0) {
        setLifecycleError(
          tr(
            'Harga Actual Exit wajib diisi dengan angka positif.',
            'Actual Exit price must be a positive number.'
          )
        );
        return;
      }
      const combinedExitTime =
        closeDateInput && closeTimeInput
          ? `${closeDateInput}T${closeTimeInput}`
          : new Date().toISOString();
      const commNum = Math.abs(parseFloat(closeCommInput) || 0);
      const swapNum = parseFloat(closeSwapInput) || 0;
      const overrideNet =
        closeNetOverrideInput.trim() !== '' ? parseFloat(closeNetOverrideInput) : undefined;

      const updatedTrade = transitionOpenTradeToClosed(closeModalTrade, {
        closeType: closeTypeInput,
        actualExitPrice: exitNum,
        exitTime: combinedExitTime,
        commission: commNum,
        swap: swapNum,
        overrideNetProfit: overrideNet !== undefined && !isNaN(overrideNet) ? overrideNet : undefined,
        closeExchangeRate: getCurrentUsdIdrSnapshot(getCachedUsdIdrRate()),
        settings,
      });

      setIsTransitionSubmitting(true);
      const res = await onUpdateTradeLifecycle(updatedTrade, closeModalTrade.id);
      if (!res || res.success !== false) {
        setCloseModalTrade(null);
      } else {
        setLifecycleError(
          res.error || tr('Gagal menutup posisi transaksi.', 'Failed to close trade position.')
        );
      }
    } catch (err: any) {
      setLifecycleError(err?.message || tr('Gagal menutup posisi.', 'Failed to close position.'));
    } finally {
      setIsTransitionSubmitting(false);
    }
  };

  // Live preview of P/L inside Close Position modal
  const closePreviewMetrics = useMemo(() => {
    if (!closeModalTrade) return null;
    const exitNum = parseFloat(actualExitInput);
    if (isNaN(exitNum) || exitNum <= 0) return null;
    const resolved = resolveTradeLifecycle(closeModalTrade);
    const activeEntry = resolved.actualEntry || closeModalTrade.entryPrice;
    const activeLot = resolved.actualLot || closeModalTrade.lotSize;
    const metrics = calculateLotBasedOrderMetrics(
      {
        symbol: closeModalTrade.instrument,
        position: closeModalTrade.position,
        lotSize: activeLot,
        entryPrice: activeEntry,
        stopLossPrice: closeModalTrade.stopLoss,
        takeProfitPrice: closeModalTrade.takeProfit,
        exitPrice: exitNum,
        capitalBasis: settings.startingBalance,
      },
      settings
    );
    const comm = Math.abs(parseFloat(closeCommInput) || 0);
    const swp = parseFloat(closeSwapInput) || 0;
    const gross = metrics.estimatedExitGrossProfit ?? 0;
    const net = Number((gross - comm + swp).toFixed(2));
    return { gross, net };
  }, [closeModalTrade, actualExitInput, closeCommInput, closeSwapInput, settings]);

  return (
    <div className="space-y-4 font-sans" data-testid="trade-log-view">
      {/* 1. HEADER: Title, Subtitle & Clean Cloud Sync Status Icon */}
      <div className="flex items-center justify-between gap-3 pb-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#151D2A] dark:text-[#F2F5F9]">
            {tr('Jurnal Trade', 'Trade Log')}
          </h1>
          <p className="text-xs text-[#697586] dark:text-[#929BA9]">
            {tr('Kelola seluruh aktivitas trading', 'Manage all your trading activities')}
          </p>
        </div>

        {/* Clean Sync Status Icon */}
        <div className="flex items-center gap-2">
          {currentUser ? (
            dataSource === 'cloud' ? (
              <div
                data-testid="trade-log-sync-indicator"
                className="flex items-center justify-center p-1.5 text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] transition-colors"
                title={
                  isCloudSyncing
                    ? tr('Menyinkronkan dengan Cloud...', 'Syncing with Cloud...')
                    : tr(
                        'Cloud Synced — Data tersimpan aman di Supabase',
                        'Cloud Synced — Data safely stored in Supabase'
                      )
                }
              >
                <Cloud
                  className={`h-4 w-4 stroke-[1.75] ${isCloudSyncing ? 'animate-spin' : ''}`}
                />
              </div>
            ) : (
              <div
                data-testid="trade-log-sync-indicator"
                className="flex items-center justify-center p-1.5 text-[#D97706] dark:text-amber-400/90 transition-colors"
                title={tr(
                  'Cache Offline — Gagal tersambung ke cloud, menggunakan data lokal',
                  'Offline Cache — Could not connect to cloud, using local data'
                )}
              >
                <AlertTriangle className="h-4 w-4 stroke-[1.75]" />
              </div>
            )
          ) : (
            <div
              data-testid="trade-log-sync-indicator"
              className="flex items-center justify-center p-1.5 text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] transition-colors"
              title={tr(
                `Penyimpanan Lokal (${trades.length} transaksi)`,
                `Local Storage (${trades.length} trades)`
              )}
            >
              <HardDrive className="h-4 w-4 stroke-[1.75]" />
            </div>
          )}
        </div>
      </div>

      {/* Demo Data Notice Banner */}
      {hasDemoTrades && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-white dark:bg-[#11151B] border border-[#E4E4E7] dark:border-[#252B34] text-xs text-[#151D2A] dark:text-[#F2F5F9] gap-2.5">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-bold bg-[#FAFAFA] dark:bg-[#171D26] text-amber-600 dark:text-amber-400 border border-[#E4E4E7] dark:border-[#252B34] text-[10px]">
              {tr('DATA DEMO AKTIF', 'DEMO DATA ACTIVE')}
            </span>
            <span className="text-[#697586] dark:text-[#929BA9]">
              {tr(
                'Jurnal saat ini memuat data contoh transaksi XAUUSD untuk demonstrasi analitik.',
                'The journal currently contains sample XAUUSD trade data for analytics demonstration.'
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={onClearDemoTrades}
            className="self-start sm:self-auto px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#171D26] hover:border-black/30 dark:hover:border-white/30 border border-[#E4E4E7] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] font-semibold text-xs transition-colors shrink-0 cursor-pointer"
          >
            {tr('Hapus Data Demo', 'Clear Demo Data')}
          </button>
        </div>
      )}

      {/* 2. RINGKASAN TRANSAKSI */}
      <div
        data-testid="trade-log-summary-panel"
        className="space-y-3 pb-1"
      >
        {/* Top: Total Transaksi */}
        <div className="flex items-center justify-between">
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9]">
              {tr('TOTAL TRANSAKSI', 'TOTAL TRADES')}
            </span>
            <div className="mt-0.5 text-2xl sm:text-3xl font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
              {summaryCounts.total}
            </div>
          </div>
          {filters.lifecycleStatus !== 'ALL' && (
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, lifecycleStatus: 'ALL' }))}
              className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] hover:underline cursor-pointer"
            >
              {tr(`Tampilkan Semua (${summaryCounts.total})`, `Show All (${summaryCounts.total})`)}
            </button>
          )}
        </div>

        {/* Thin Divider */}
        <div className="border-t border-[#E4E4E7] dark:border-white/[0.08]" />

        {/* Bottom: 4 Statuses with smooth animated sliding indicator */}
        <div
          data-testid="trade-log-summary-grid"
          className="relative grid grid-cols-4 divide-x divide-[#E4E4E7] dark:divide-white/[0.08] text-center p-0.5 rounded-full select-none"
        >
          <div
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 rounded-full bg-black/10 dark:bg-white/[0.10] pointer-events-none transition-all duration-200 ease-out"
            style={{
              width: 'calc(25% - 4px)',
              left:
                activeStatusIndex === 0
                  ? '2px'
                  : activeStatusIndex === 1
                  ? 'calc(25% + 2px)'
                  : activeStatusIndex === 2
                  ? 'calc(50% + 2px)'
                  : activeStatusIndex === 3
                  ? 'calc(75% + 2px)'
                  : '2px',
              opacity: activeStatusIndex >= 0 ? 1 : 0,
              transform: activeStatusIndex >= 0 ? 'scale(1)' : 'scale(0.95)',
            }}
          />

          {(
            [
              { key: 'PLANNED' as const, label: tr('Rencana', 'Limit'), count: summaryCounts.planned },
              { key: 'OPEN' as const, label: tr('Aktif', 'Open'), count: summaryCounts.open },
              { key: 'CLOSED' as const, label: tr('Selesai', 'Closed'), count: summaryCounts.closed },
              { key: 'CANCELLED' as const, label: tr('Batal', 'Cancelled'), count: summaryCounts.cancelled },
            ] as const
          ).map((item) => {
            const isSelected = filters.lifecycleStatus === item.key;
            const formattedCount = String(item.count).padStart(2, '0');
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleStatusFilter(item.key)}
                data-testid={`summary-card-${item.key.toLowerCase()}`}
                className="relative z-10 px-2 py-1.5 transition-colors cursor-pointer rounded-full mx-0.5"
              >
                <span
                  className={`block text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider transition-colors duration-200 ${
                    isSelected
                      ? 'text-[#151D2A] dark:text-[#F2F5F9]'
                      : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                  }`}
                >
                  {item.label}
                </span>
                <span
                  className={`mt-0.5 block text-base sm:text-xl font-bold font-mono-numbers tabular-nums transition-colors duration-200 ${
                    isSelected
                      ? 'text-[#151D2A] dark:text-[#F2F5F9]'
                      : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                  }`}
                >
                  {formattedCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. SEARCH, FILTER & SCAN MT5 TOOLBAR */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={tr('Cari transaksi... (/)', 'Search trades... (/)')}
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none pl-9 pr-3.5 py-2 text-xs text-[#0F172A] dark:text-[#F2F5F9] placeholder-[#526071] dark:placeholder-[#929BA9] focus:border-[#0F172A]/35 dark:focus:border-white/30 focus:outline-none transition-colors"
            />
          </div>

          {/* A+ Setup Playbook Library Button */}
          {onOpenPlaybook && (
            <button
              type="button"
              onClick={onOpenPlaybook}
              title={tr('Playbook Setup A+', 'A+ Setup Playbook')}
              aria-label={tr('Playbook Setup A+', 'A+ Setup Playbook')}
              className="flex items-center justify-center h-9 w-9 rounded-full bg-white dark:bg-[#101318] text-[#526071] dark:text-[#929BA9] border border-[#E4E4E7] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/25 dark:hover:border-white/20 hover:text-[#0F172A] dark:hover:text-[#F2F5F9] transition-colors cursor-pointer shrink-0"
            >
              <BookOpen className="h-4 w-4 stroke-[1.75]" />
            </button>
          )}

          {/* Scan Kilat Riwayat MT5 Button (Icon-Only Circle — Jurnal Trade Toolbar) */}
          {onImportBatchTrades && (
            <button
              type="button"
              onClick={() => setIsMt5ScanModalOpen(true)}
              data-testid="scan-mt5-history-btn"
              title={tr(
                'Scan Kilat Riwayat MT5 (Auto Log Trade Close)',
                'Quick Scan MT5 History (Auto Log Closed Trades)'
              )}
              aria-label={tr('Scan Kilat Riwayat MT5', 'Quick Scan MT5 History')}
              className="flex items-center justify-center h-9 w-9 rounded-full bg-[#151D2A] hover:bg-[#1E293B] dark:bg-[#F2F4F7] dark:hover:bg-white text-white dark:text-[#050607] transition-colors cursor-pointer shrink-0"
            >
              <ScanLine className="h-4 w-4 stroke-[1.85]" />
            </button>
          )}

          {/* Filter Button: Circle Icon Only */}
          <button
            type="button"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            title={tr('Filter & Urutan Transaksi', 'Filter & Sort Trades')}
            aria-label={tr('Filter & Urutan Transaksi', 'Filter & Sort Trades')}
            className={`flex items-center justify-center h-9 w-9 rounded-full border text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              showAdvancedFilters ||
              filters.lifecycleStatus !== 'ALL' ||
              filters.outcome !== 'ALL' ||
              filters.position !== 'ALL' ||
              filters.instrument !== 'ALL' ||
              filters.session !== 'ALL' ||
              filters.strategy !== 'ALL' ||
              Boolean(filters.startDate || filters.endDate)
                ? 'bg-white dark:bg-white/[0.12] text-[#0F172A] dark:text-[#F2F5F9] border-[#0F172A]/40 dark:border-white/30 shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                : 'bg-white dark:bg-[#101318] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none hover:border-[#0F172A]/25 dark:hover:border-white/20 hover:text-[#0F172A] dark:hover:text-[#F2F5F9]'
            }`}
          >
            <Filter className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Collapsible Filter & Sort Panel */}
        {showAdvancedFilters && (
          <div className="p-3.5 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_4px_20px_rgba(15,23,42,0.06)] dark:shadow-none space-y-3 animate-in fade-in duration-150 text-xs">
            {/* Quick Date Chips */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[#526071] dark:text-[#929BA9] font-medium mr-1">
                {tr('Periode Cepat:', 'Quick Period:')}
              </span>
              <button
                type="button"
                onClick={() => applyQuickDate('ALL')}
                className={`px-3 py-1 rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                  !filters.startDate && !filters.endDate
                    ? 'bg-[#0F172A] dark:bg-white text-white dark:text-[#080A0E] border-[#0F172A] dark:border-white font-semibold'
                    : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D]'
                }`}
              >
                {tr('Semua', 'All')}
              </button>
              <button
                type="button"
                onClick={() => applyQuickDate('TODAY')}
                className="px-3 py-1 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {tr('Hari Ini', 'Today')}
              </button>
              <button
                type="button"
                onClick={() => applyQuickDate('7D')}
                className="px-3 py-1 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {tr('7 Hari', '7 Days')}
              </button>
              <button
                type="button"
                onClick={() => applyQuickDate('MONTH')}
                className="px-3 py-1 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {tr('Bulan Ini', 'This Month')}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
              {/* Lifecycle Status Filter */}
              <div>
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Status Transaksi', 'Trade Status')}
                </label>
                <select
                  value={filters.lifecycleStatus || 'ALL'}
                  onChange={(e) =>
                    setFilters({ ...filters, lifecycleStatus: e.target.value as any })
                  }
                  className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#080A0E] border border-[#E4E4E7] dark:border-[#252B34] px-2.5 py-1.5 text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none"
                >
                  <option value="ALL">{tr('Semua Status', 'All Statuses')}</option>
                  <option value="PLANNED">{tr('RENCANA (LIMIT)', 'LIMIT')}</option>
                  <option value="OPEN">{tr('AKTIF (OPEN)', 'OPEN')}</option>
                  <option value="CLOSED">{tr('SELESAI (CLOSED)', 'CLOSED')}</option>
                  <option value="CANCELLED">{tr('BATAL (CANCELLED)', 'CANCELLED')}</option>
                </select>
              </div>

              {/* Outcome Filter */}
              <div>
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Hasil Selesai', 'Closed Outcome')}
                </label>
                <select
                  value={filters.outcome}
                  onChange={(e) => setFilters({ ...filters, outcome: e.target.value as any })}
                  className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#080A0E] border border-[#E4E4E7] dark:border-[#252B34] px-2.5 py-1.5 text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none"
                >
                  <option value="ALL">{tr('Semua Hasil', 'All Outcomes')}</option>
                  <option value="WIN">{tr('MENANG (Profit)', 'WIN (Profit)')}</option>
                  <option value="LOSS">{tr('KALAH (Rugi)', 'LOSS')}</option>
                  <option value="BREAKEVEN">{tr('IMPAS (BE)', 'BREAKEVEN (BE)')}</option>
                </select>
              </div>

              {/* Position Filter */}
              <div>
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Arah (Buy/Sell)', 'Direction (Buy/Sell)')}
                </label>
                <select
                  value={filters.position}
                  onChange={(e) => setFilters({ ...filters, position: e.target.value as any })}
                  className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#080A0E] border border-[#E4E4E7] dark:border-[#252B34] px-2.5 py-1.5 text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none"
                >
                  <option value="ALL">{tr('Semua Arah', 'All Directions')}</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>

              {/* Instrument Filter */}
              <div>
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Simbol', 'Symbol')}
                </label>
                <select
                  value={filters.instrument}
                  onChange={(e) => setFilters({ ...filters, instrument: e.target.value })}
                  className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#080A0E] border border-[#E4E4E7] dark:border-[#252B34] px-2.5 py-1.5 text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none"
                >
                  <option value="ALL">{tr('Semua Simbol', 'All Symbols')}</option>
                  {uniqueInstruments.map((inst) => (
                    <option key={inst} value={inst}>
                      {inst}
                    </option>
                  ))}
                </select>
              </div>

              {/* Session Filter */}
              <div>
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Sesi Trading', 'Trading Session')}
                </label>
                <select
                  value={filters.session}
                  onChange={(e) => setFilters({ ...filters, session: e.target.value })}
                  className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#080A0E] border border-[#E4E4E7] dark:border-[#252B34] px-2.5 py-1.5 text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none"
                >
                  <option value="ALL">{tr('Semua Sesi', 'All Sessions')}</option>
                  {uniqueSessions.map((sess) => (
                    <option key={sess} value={sess}>
                      {sess}
                    </option>
                  ))}
                </select>
              </div>

              {/* Setup Strategy Filter */}
              <div>
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Setup / Strategi', 'Setup / Strategy')}
                </label>
                <select
                  value={filters.strategy}
                  onChange={(e) => setFilters({ ...filters, strategy: e.target.value })}
                  className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#080A0E] border border-[#E4E4E7] dark:border-[#252B34] px-2.5 py-1.5 text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none"
                >
                  <option value="ALL">{tr('Semua Setup', 'All Setups')}</option>
                  {uniqueStrategies.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sorting */}
              <div>
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Urutan', 'Sort By')}
                </label>
                <div className="flex items-center gap-1">
                  <select
                    value={filters.sortBy}
                    onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as any })}
                    className="flex-1 rounded-lg bg-[#FAFAFA] dark:bg-[#080A0E] border border-[#E4E4E7] dark:border-[#252B34] px-2.5 py-1.5 text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none text-[11px]"
                  >
                    <option value="date-desc">{tr('Terbaru', 'Newest')}</option>
                    <option value="date-asc">{tr('Terlama', 'Oldest')}</option>
                    <option value="profit-desc">{tr('P/L Tertinggi', 'Highest P/L')}</option>
                    <option value="profit-asc">{tr('P/L Terendah', 'Lowest P/L')}</option>
                    <option value="lot-desc">{tr('Lot Terbesar', 'Largest Lot')}</option>
                  </select>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="p-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#171D26] hover:border-black/30 dark:hover:border-white/30 border border-[#E4E4E7] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] transition-colors cursor-pointer"
                    title={tr('Reset Filter', 'Reset Filters')}
                    aria-label={tr('Reset semua filter', 'Reset all filters')}
                  >
                    <RotateCcw className="h-3.5 w-3.5 stroke-[1.75]" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. DAFTAR TRANSAKSI BERKELOMPOK TANGGAL */}
      {paginatedTrades.length === 0 ? (
        <div className="rounded-xl border border-[#E4E4E7] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-8 text-center text-xs text-[#697586] dark:text-[#929BA9] space-y-3">
          <p className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
            {trades.length === 0
              ? tr('Belum Ada Transaksi Tercatat', 'No Trades Recorded Yet')
              : tr('Tidak Ada Transaksi yang Sesuai Filter', 'No Trades Match Current Filters')}
          </p>
          <p className="text-[11px] max-w-sm mx-auto">
            {trades.length === 0
              ? tr(
                  'Belum ada transaksi. Gunakan tombol Catat Trade Baru untuk mencatat transaksi baru.',
                  'No trades yet. Use the Record New Trade button to add a new trade.'
                )
              : tr(
                  'Ubah kata kunci pencarian atau reset filter untuk melihat seluruh transaksi.',
                  'Change your search query or reset filters to view all trades.'
                )}
          </p>
          {trades.length > 0 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={resetFilters}
                className="px-4 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#171D26] border border-[#E4E4E7] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] font-semibold text-xs cursor-pointer"
              >
                {tr('Reset Filter', 'Reset Filters')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4" data-testid="trade-log-date-groups">
          {dateGroupedSections.map((section) => {
            const matchingForDate =
              filteredTradesByDateKey.get(section.dateKey) || section.trades;
            const totalForDate =
              allTradesCountByDateKey.get(section.dateKey) || matchingForDate.length;
            const localizedLabel =
              section.headerLabel === 'TODAY'
                ? tr('HARI INI', 'TODAY')
                : section.headerLabel === 'YESTERDAY'
                ? tr('KEMARIN', 'YESTERDAY')
                : section.headerLabel;

            return (
              <DateGroupCard
                key={section.dateKey}
                section={section}
                settings={settings}
                onViewDetail={onViewDetail}
                onUpdateTradeLifecycle={onUpdateTradeLifecycle}
                openPlannedTransitionModal={openPlannedTransitionModal}
                openClosePositionModal={openClosePositionModal}
                onViewScreenshot={onViewScreenshot}
                onEditTrade={onEditTrade}
                onDeleteTrade={onDeleteTrade}
                dateGroupTotalCount={matchingForDate.length}
                onDeleteDateGroup={
                  onDeleteTradesByDate
                    ? () =>
                        onDeleteTradesByDate({
                          dateKey: section.dateKey,
                          headerLabel: localizedLabel,
                          trades: matchingForDate,
                          source: 'journal',
                          isFilteredSubset: matchingForDate.length < totalForDate,
                          totalTradesOnDate: totalForDate,
                        })
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      {/* 5. PAGINATION & ADD TRADE FOOTER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 text-xs text-[#697586] dark:text-[#929BA9]">
        <div className="flex items-center gap-2">
          <span>
            {tr('Menampilkan', 'Showing')}{' '}
            <strong className="font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
              {totalItems === 0 ? 0 : startIndex + 1}-{endIndex}
            </strong>{' '}
            {tr('dari', 'of')}{' '}
            <strong className="font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
              {totalItems}
            </strong>
          </span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-lg bg-white dark:bg-[#11151B] border border-[#E4E4E7] dark:border-[#252B34] px-2 py-1 text-xs text-[#151D2A] dark:text-[#F2F5F9] focus:border-black/30 dark:focus:border-white/30 focus:outline-none"
          >
            <option value={15}>{tr('15 / hal', '15 / page')}</option>
            <option value={25}>{tr('25 / hal', '25 / page')}</option>
            <option value={50}>{tr('50 / hal', '50 / page')}</option>
            <option value={0}>{tr('Semua', 'All')}</option>
          </select>
        </div>

        {!isAll && totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-full border border-[#E4E4E7] dark:border-[#252B34] bg-white dark:bg-[#11151B] text-[#151D2A] dark:text-[#F2F5F9] disabled:opacity-40 cursor-pointer"
              aria-label={tr('Halaman Sebelumnya', 'Previous Page')}
            >
              <ChevronLeft className="h-4 w-4 stroke-[1.75]" />
            </button>
            <span className="px-2 font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9] font-semibold">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-full border border-[#E4E4E7] dark:border-[#252B34] bg-white dark:bg-[#11151B] text-[#151D2A] dark:text-[#F2F5F9] disabled:opacity-40 cursor-pointer"
              aria-label={tr('Halaman Berikutnya', 'Next Page')}
            >
              <ChevronRight className="h-4 w-4 stroke-[1.75]" />
            </button>
          </div>
        )}
      </div>

      {/* MODAL 1: PLANNED -> OPEN / CANCELLED */}
      {plannedModalTrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 p-4 animate-in fade-in duration-150"
          onClick={() => !isTransitionSubmitting && setPlannedModalTrade(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tr('Status Rencana Transaksi', 'Planned Trade Status')}
            className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-5 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] text-[#0F172A] dark:text-[#F2F4F7]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
              <div>
                <h3 className="text-sm font-bold">
                  {tr('Status Rencana:', 'Planned Status:')} {plannedModalTrade.instrument} (
                  {plannedModalTrade.position})
                </h3>
                <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                  ID: {plannedModalTrade.id} • {tr('Status saat ini: RENCANA', 'Current status: LIMIT')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlannedModalTrade(null)}
                aria-label={tr('Tutup modal', 'Close modal')}
                className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                <X className="h-4 w-4 stroke-[1.75]" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setPlannedActionMode('OPEN');
                  setLifecycleError(null);
                }}
                className={`py-2 px-3 rounded-full text-xs font-bold border transition-colors cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                  plannedActionMode === 'OPEN'
                    ? 'bg-[#0F172A] dark:bg-white text-white dark:text-[#080A0E] border-[#0F172A] dark:border-white'
                    : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D]'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 stroke-[1.75]" />
                <span>{tr('Posisi Dibuka (OPEN)', 'Open Position (OPEN)')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlannedActionMode('CANCEL');
                  setLifecycleError(null);
                }}
                className={`py-2 px-3 rounded-full text-xs font-bold border transition-colors cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                  plannedActionMode === 'CANCEL'
                    ? 'bg-[#0F172A] dark:bg-white text-white dark:text-[#080A0E] border-[#0F172A] dark:border-white'
                    : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D]'
                }`}
              >
                <XCircle className="h-3.5 w-3.5 stroke-[1.75]" />
                <span>{tr('Batalkan (CANCELLED)', 'Cancel (CANCELLED)')}</span>
              </button>
            </div>

            {lifecycleError && (
              <div className="mt-3 p-2.5 rounded-lg bg-[#E11D48]/10 border border-[#E11D48]/25 text-xs text-[#E11D48] dark:text-[#E05260]">
                {lifecycleError}
              </div>
            )}

            <form onSubmit={handleConfirmPlannedTransition} className="mt-4 space-y-3 text-xs">
              {plannedActionMode === 'OPEN' ? (
                <>
                  <label className="flex items-start gap-2 p-2.5 rounded-lg bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mt5Confirmed}
                      onChange={(e) => setMt5Confirmed(e.target.checked)}
                      className="mt-0.5 rounded border-[#E4E4E7] dark:border-[#20252D]"
                    />
                    <span className="text-[11px] leading-relaxed">
                      {tr(
                        'Saya mengonfirmasi bahwa posisi ini benar-benar telah tereksekusi di MT5.',
                        'I confirm that this position has actually been executed on MT5.'
                      )}
                    </span>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Harga Entry Aktual', 'Actual Entry Price')}
                      </label>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={actualEntryInput}
                        onChange={(e) => setActualEntryInput(e.target.value)}
                        className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums font-semibold focus:border-[#0F172A] dark:focus:border-white focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Lot Aktual', 'Actual Lot')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        inputMode="decimal"
                        value={actualLotInput}
                        onChange={(e) => setActualLotInput(e.target.value)}
                        className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums font-semibold focus:border-[#0F172A] dark:focus:border-white focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Tanggal Entry', 'Entry Date')}
                      </label>
                      <input
                        type="date"
                        value={openDateInput}
                        onChange={(e) => setOpenDateInput(e.target.value)}
                        className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums focus:border-[#0F172A] dark:focus:border-white focus:outline-none dark:[color-scheme:dark]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Jam Entry', 'Entry Time')}
                      </label>
                      <input
                        type="time"
                        value={openTimeInput}
                        onChange={(e) => setOpenTimeInput(e.target.value)}
                        className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums focus:border-[#0F172A] dark:focus:border-white focus:outline-none dark:[color-scheme:dark]"
                        required
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Alasan Pembatalan (Opsional)', 'Cancellation Reason (Optional)')}
                  </label>
                  <textarea
                    rows={2}
                    value={cancelReasonInput}
                    onChange={(e) => setCancelReasonInput(e.target.value)}
                    placeholder={tr(
                      'Contoh: Harga sudah menyentuh target sebelum mengenai limit order...',
                      'Example: Price already hit the target before reaching the limit order...'
                    )}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-2.5 text-xs focus:border-[#0F172A] dark:focus:border-white focus:outline-none"
                  />
                  <p className="mt-1.5 text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr(
                      'Catatan: Transaksi CANCELLED tidak dihitung sebagai LOSS dan tidak memengaruhi Win Rate.',
                      'Note: CANCELLED trades are not counted as LOSS and do not affect your Win Rate.'
                    )}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
                <button
                  type="button"
                  onClick={() => setPlannedModalTrade(null)}
                  disabled={isTransitionSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isTransitionSubmitting}
                  className="px-4 py-2 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#080A0E] hover:bg-[#1E293B] dark:hover:bg-white/90 font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                >
                  {plannedActionMode === 'OPEN'
                    ? tr('Konfirmasi OPEN', 'Confirm OPEN')
                    : tr('Batalkan Trade', 'Cancel Trade')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: OPEN -> CLOSED */}
      {closeModalTrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 p-4 animate-in fade-in duration-150"
          onClick={() => !isTransitionSubmitting && setCloseModalTrade(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tr('Tutup Posisi Transaksi', 'Close Trade Position')}
            className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-5 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] text-[#0F172A] dark:text-[#F2F4F7]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
              <div>
                <h3 className="text-sm font-bold">
                  {tr('Tutup Posisi:', 'Close Position:')} {closeModalTrade.instrument} (
                  {closeModalTrade.position})
                </h3>
                <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                  ID: {closeModalTrade.id} • {tr('Status saat ini: AKTIF', 'Current status: OPEN')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCloseModalTrade(null)}
                aria-label={tr('Tutup modal', 'Close modal')}
                className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                <X className="h-4 w-4 stroke-[1.75]" />
              </button>
            </div>

            {lifecycleError && (
              <div className="mt-3 p-2.5 rounded-lg bg-[#E11D48]/10 border border-[#E11D48]/25 text-xs text-[#E11D48] dark:text-[#E05260]">
                {lifecycleError}
              </div>
            )}

            <form onSubmit={handleConfirmClosePosition} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                  {tr('Jenis Penutupan Posisi', 'Position Close Type')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['TP', 'SL', 'Manual'] as const).map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => handleCloseTypeSelect(ct)}
                      className={`py-2 rounded-full font-bold border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                        closeTypeInput === ct
                          ? 'bg-[#0F172A] dark:bg-white text-white dark:text-[#080A0E] border-[#0F172A] dark:border-white'
                          : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D]'
                      }`}
                    >
                      {ct === 'TP' ? 'Take Profit' : ct === 'SL' ? 'Stop Loss' : 'Manual'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Harga Exit Aktual', 'Actual Exit Price')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={actualExitInput}
                    onChange={(e) => setActualExitInput(e.target.value)}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums font-semibold focus:border-[#0F172A] dark:focus:border-white focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Realisasi P/L Bersih', 'Realized Net P/L')} ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={
                      closeNetOverrideInput !== ''
                        ? closeNetOverrideInput
                        : closePreviewMetrics
                        ? String(closePreviewMetrics.net)
                        : ''
                    }
                    onChange={(e) => setCloseNetOverrideInput(e.target.value)}
                    placeholder={tr('Otomatis dari Exit', 'Auto from Exit')}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums font-bold focus:border-[#0F172A] dark:focus:border-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Tanggal Tutup', 'Close Date')}
                  </label>
                  <input
                    type="date"
                    value={closeDateInput}
                    onChange={(e) => setCloseDateInput(e.target.value)}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums focus:border-[#0F172A] dark:focus:border-white focus:outline-none dark:[color-scheme:dark]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Jam Tutup', 'Close Time')}
                  </label>
                  <input
                    type="time"
                    value={closeTimeInput}
                    onChange={(e) => setCloseTimeInput(e.target.value)}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 font-mono-numbers tabular-nums focus:border-[#0F172A] dark:focus:border-white focus:outline-none dark:[color-scheme:dark]"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
                <button
                  type="button"
                  onClick={() => setCloseModalTrade(null)}
                  disabled={isTransitionSubmitting}
                  className="px-4 py-2 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isTransitionSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#080A0E] hover:bg-[#1E293B] dark:hover:bg-white/90 font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                >
                  <Lock className="h-3.5 w-3.5 stroke-[1.75]" />
                  <span>{tr('Konfirmasi SELESAI', 'Confirm CLOSED')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch MT5 History Scanner Modal */}
      {onImportBatchTrades && (
        <Mt5HistoryScanModal
          isOpen={isMt5ScanModalOpen}
          onClose={() => setIsMt5ScanModalOpen(false)}
          existingTrades={trades}
          settings={settings}
          onImportBatchTrades={onImportBatchTrades}
        />
      )}
    </div>
  );
};
