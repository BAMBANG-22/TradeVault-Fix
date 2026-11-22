import React, { useEffect } from 'react';
import {
  X,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Search,
  Check,
  Clock,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  IntermarketAssetPulse,
  PillarArgumentItem,
  MacroEventGroup,
  MacroNewsSnapshot,
  PreNewsScenarioMatrix,
  MacroCalendarEvent,
  formatTimestampWib,
} from '../../utils/macroNewsEngine';
import { useLanguage } from '../../utils/language';

const QUICK_SEARCH_FILTERS = ['ALL', 'PPI', 'CPI', 'NFP', 'PCE', 'FOMC', 'GDP', 'ISM', 'RETAIL'] as const;

function useEscapeClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
}

interface IntermarketDetailSheetProps {
  asset: IntermarketAssetPulse | null;
  onClose: () => void;
}

export const IntermarketDetailSheet: React.FC<IntermarketDetailSheetProps> = ({
  asset,
  onClose,
}) => {
  const { isEn, tr } = useLanguage();
  useEscapeClose(Boolean(asset), onClose);

  if (!asset) return null;

  const isAvailable = asset.isAvailable !== false && Number.isFinite(asset.price) && asset.price > 0;
  const formattedPrice = !isAvailable
    ? '—'
    : asset.symbol === 'US02Y' || asset.symbol === 'US10Y'
    ? `${asset.price.toFixed(3)}%`
    : asset.symbol === 'USOIL'
    ? `$${asset.price.toFixed(2)}`
    : asset.price.toFixed(3);

  const formattedPrevClose =
    !isAvailable || !Number.isFinite(asset.previousClose) || asset.previousClose <= 0
      ? '—'
      : asset.symbol === 'US02Y' || asset.symbol === 'US10Y'
      ? `${asset.previousClose.toFixed(3)}%`
      : asset.symbol === 'USOIL'
      ? `$${asset.previousClose.toFixed(2)}`
      : asset.previousClose.toFixed(3);

  const isUp = isAvailable && asset.direction === 'UP';
  const isDown = isAvailable && asset.direction === 'DOWN';

  const changePercentText = !isAvailable
    ? '0.00%'
    : `${asset.changePercent > 0 ? '+' : ''}${asset.changePercent.toFixed(2)}%`;

  const changeNominalText = !isAvailable
    ? '—'
    : `${asset.change > 0 ? '+' : ''}${asset.change.toFixed(3)}`;

  const goldEffectLabel =
    asset.goldCorrelationEffect === 'BULLISH_GOLD'
      ? tr('Mendukung BUY XAU/USD (Bullish Gold)', 'Supports BUY XAU/USD (Bullish Gold)')
      : asset.goldCorrelationEffect === 'BEARISH_GOLD'
      ? tr('Menekan XAU/USD (Bearish Gold)', 'Pressures XAU/USD (Bearish Gold)')
      : tr('Netral terhadap XAU/USD', 'Neutral for XAU/USD');

  const goldEffectColor =
    asset.goldCorrelationEffect === 'BULLISH_GOLD'
      ? 'text-[#059669] dark:text-[#00A878]'
      : asset.goldCorrelationEffect === 'BEARISH_GOLD'
      ? 'text-[#E11D48] dark:text-[#E05260]'
      : 'text-[#526071] dark:text-[#929BA9]';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={asset.name}
      data-testid="intermarket-detail-panel"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-[20px] sm:rounded-2xl bg-white dark:bg-[#101318] border-t sm:border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] max-h-[85vh] overflow-y-auto px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:p-6 space-y-5"
      >
        <div className="w-10 h-1 rounded-full bg-[#E4E4E7] dark:bg-[#20252D] mx-auto sm:hidden" />

        <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9] block">
              {asset.symbol} · {asset.yahooTicker}
            </span>
            <h3 className="text-base font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
              {asset.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup Detail Indikator', 'Close Indicator Detail')}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <div>
            <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
              {tr('Nilai Terkini', 'Current Value')}
            </span>
            <span className="text-3xl font-bold font-mono-numbers tabular-nums tracking-tight text-[#0F172A] dark:text-[#F2F4F7]">
              {formattedPrice}
            </span>
          </div>
          <div className="text-right font-mono-numbers tabular-nums">
            <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] block">
              {tr('Perubahan', 'Change')}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-base font-bold ${
                isUp
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : isDown
                  ? 'text-[#E11D48] dark:text-[#E05260]'
                  : 'text-[#526071] dark:text-[#929BA9]'
              }`}
            >
              {isUp ? (
                <ArrowUpRight className="w-4 h-4 stroke-[2]" />
              ) : isDown ? (
                <ArrowDownRight className="w-4 h-4 stroke-[2]" />
              ) : (
                <Minus className="w-4 h-4 stroke-[2]" />
              )}
              <span>{changePercentText}</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 py-3 border-y border-[#E4E4E7] dark:border-[#20252D] font-mono-numbers tabular-nums">
          <div>
            <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] block">
              {tr('Penutupan Lalu', 'Prev Close')}
            </span>
            <span className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
              {formattedPrevClose}
            </span>
          </div>
          <div>
            <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] block">
              {tr('Selisih', 'Delta')}
            </span>
            <span className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
              {changeNominalText}
            </span>
          </div>
          <div>
            <span className="text-[11px] font-sans text-[#526071] dark:text-[#929BA9] block">
              {tr('Arah', 'Direction')}
            </span>
            <span className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
              {asset.direction}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] block">
              {tr('Efek Korelasi XAU/USD', 'XAU/USD Correlation Impact')}
            </span>
            <p className={`text-sm font-semibold mt-0.5 ${goldEffectColor}`}>
              {goldEffectLabel}
            </p>
          </div>

          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] block">
              {tr('Ringkasan Kondisi', 'Condition Summary')}
            </span>
            <p className="text-sm text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed mt-0.5 text-editorial-justify">
              {isEn ? asset.summaryEn : asset.summaryId}
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between text-xs text-[#526071] dark:text-[#929BA9]">
          <span>
            {isAvailable
              ? tr('Status: Feed Live Aktif', 'Status: Live Feed Active')
              : tr('Status: Feed Tidak Tersedia', 'Status: Feed Unavailable')}
          </span>
          <span className="font-mono-numbers tabular-nums">
            {formatTimestampWib(asset.updatedAt, isEn ? 'en' : 'id')}
          </span>
        </div>
      </div>
    </div>
  );
};

interface ArgumentDetailSheetProps {
  selected: { side: 'BUY' | 'SELL'; item: PillarArgumentItem } | null;
  matrix: PreNewsScenarioMatrix;
  snapshot: MacroNewsSnapshot;
  pillarLabel: (pillar: string) => string;
  onClose: () => void;
}

export const ArgumentDetailSheet: React.FC<ArgumentDetailSheetProps> = ({
  selected,
  matrix,
  snapshot,
  pillarLabel,
  onClose,
}) => {
  const { isEn, tr } = useLanguage();
  useEscapeClose(Boolean(selected), onClose);

  if (!selected) return null;

  const { side, item } = selected;
  const isBuy = side === 'BUY';

  const recapText =
    item.pillar === 'INFLATION'
      ? isEn
        ? matrix.fomcPillarRecap?.inflationPillarSummaryEn
        : matrix.fomcPillarRecap?.inflationPillarSummaryId
      : item.pillar === 'LABOR'
      ? isEn
        ? matrix.fomcPillarRecap?.laborPillarSummaryEn
        : matrix.fomcPillarRecap?.laborPillarSummaryId
      : item.pillar === 'GROWTH'
      ? isEn
        ? matrix.fomcPillarRecap?.growthPillarSummaryEn
        : matrix.fomcPillarRecap?.growthPillarSummaryId
      : undefined;

  const relatedEvents: MacroCalendarEvent[] = snapshot.calendarEvents
    .filter((ev) => ev.pillar === item.pillar)
    .slice(0, 4);

  const relatedNews =
    item.pillar === 'GEOPOLITICS' || item.pillar === 'POLICY'
      ? snapshot.breakingNews.slice(0, 3)
      : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.tag}
      data-testid="argument-detail-panel"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-[20px] sm:rounded-2xl bg-white dark:bg-[#101318] border-t sm:border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] max-h-[85vh] overflow-y-auto px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:p-6 space-y-4"
      >
        <div className="w-10 h-1 rounded-full bg-[#E4E4E7] dark:bg-[#20252D] mx-auto sm:hidden" />

        <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span
                className={`inline-flex items-center gap-1 ${
                  isBuy ? 'text-[#059669] dark:text-[#00A878]' : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {isBuy ? (
                  <TrendingUp className="w-3.5 h-3.5 stroke-[2]" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 stroke-[2]" />
                )}
                {isBuy ? tr('BULLISH · BUY XAU/USD', 'BULLISH · BUY XAU/USD') : tr('BEARISH · SELL XAU/USD', 'BEARISH · SELL XAU/USD')}
              </span>
              <span className="text-[#526071] dark:text-[#929BA9]" aria-hidden="true">
                ·
              </span>
              <span className="text-[#526071] dark:text-[#929BA9]">{pillarLabel(item.pillar)}</span>
            </div>
            <h3 className="text-sm sm:text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
              {item.tag}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup Detail Argumen', 'Close Argument Detail')}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] block">
            {tr('Penjelasan Fundamental', 'Fundamental Explanation')}
          </span>
          <p className="text-sm text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed text-editorial-justify">
            {isEn ? item.textEn : item.textId}
          </p>
        </div>

        {recapText && (
          <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0F172A] dark:text-[#F2F4F7] block">
              {tr('Konteks Pilar Terkait', 'Related Pillar Context')}
            </span>
            <p className="text-xs sm:text-[13px] text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
              {recapText}
            </p>
          </div>
        )}

        {relatedEvents.length > 0 && (
          <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] block">
              {tr('Indikator Pendukung pada Pilar Ini', 'Supporting Calendar Indicators')}
            </span>
            <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D]">
              {relatedEvents.map((ev) => (
                <div key={ev.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                      {ev.title}
                    </p>
                    <p className="text-[11px] text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                      {formatTimestampWib(ev.date, isEn ? 'en' : 'id')}
                    </p>
                  </div>
                  <div className="text-right font-mono-numbers tabular-nums shrink-0 text-[11px] text-[#0F172A] dark:text-[#F2F4F7]">
                    <span>Prev {ev.previous || '-'}</span>
                    <span className="mx-1 text-[#526071] dark:text-[#929BA9]">·</span>
                    <span>Fcst {ev.forecast || '-'}</span>
                    {ev.actual && ev.actual.trim() !== '-' && (
                      <>
                        <span className="mx-1 text-[#526071] dark:text-[#929BA9]">·</span>
                        <span
                          className={
                            ev.eventBiasForGold === 'SELL'
                              ? 'font-bold text-[#059669] dark:text-[#00A878]'
                              : ev.eventBiasForGold === 'BUY'
                              ? 'font-bold text-[#E11D48] dark:text-[#E05260]'
                              : 'font-bold text-[#0F172A] dark:text-[#F2F4F7]'
                          }
                        >
                          Act {ev.actual}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {relatedNews.length > 0 && (
          <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] block">
              {tr('Headline Pendukung Terkini', 'Related Supporting Headlines')}
            </span>
            <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D]">
              {relatedNews.map((hl) => (
                <div key={hl.id} className="py-2 space-y-0.5">
                  <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {hl.source} · {hl.sentimentForGold}
                  </span>
                  <p className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {hl.title}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface TargetReleaseSheetProps {
  isOpen: boolean;
  onClose: () => void;
  explorerEventGroups: MacroEventGroup[];
  activeGroupId: string | undefined;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  eventWindowFilter: 'ALL' | 'UPCOMING' | 'RELEASED';
  onWindowFilterChange: (w: 'ALL' | 'UPCOMING' | 'RELEASED') => void;
  onSelectGroup: (groupId: string) => void;
}

export const TargetReleaseSheet: React.FC<TargetReleaseSheetProps> = ({
  isOpen,
  onClose,
  explorerEventGroups,
  activeGroupId,
  searchQuery,
  onSearchChange,
  eventWindowFilter,
  onWindowFilterChange,
  onSelectGroup,
}) => {
  const { isEn, tr } = useLanguage();
  useEscapeClose(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Pilih Target Rilis 14 Hari', 'Select 14-Day Target Release')}
      data-testid="macro-upcoming-event-explorer"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl rounded-t-[20px] sm:rounded-2xl bg-white dark:bg-[#101318] border-t sm:border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] max-h-[85vh] flex flex-col"
      >
        <div className="px-5 pt-3 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D] space-y-3 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#E4E4E7] dark:bg-[#20252D] mx-auto sm:hidden" />

          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9] block">
                {tr('TARGET ANALISIS (14 HARI)', 'ANALYSIS TARGET (14 DAYS)')}
              </span>
              <h3 className="text-sm sm:text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Pilih Jadwal Rilis USD', 'Select USD Release Schedule')}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('Tutup Pemilih Target', 'Close Target Selector')}
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              <X className="w-4 h-4 stroke-[2]" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center p-1 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
              {(
                [
                  { key: 'ALL', labelId: 'Semua', labelEn: 'All' },
                  { key: 'UPCOMING', labelId: 'Mendatang', labelEn: 'Upcoming' },
                  { key: 'RELEASED', labelId: 'Sudah Rilis', labelEn: 'Released' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onWindowFilterChange(opt.key)}
                  className={`min-h-[32px] px-3.5 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    eventWindowFilter === opt.key
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {tr(opt.labelId, opt.labelEn)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-[#526071] dark:text-[#929BA9] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="macro-upcoming-search-input"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={tr('Cari rilis USD (PPI, CPI, NFP, FOMC)...', 'Search USD release (PPI, CPI, NFP, FOMC)...')}
              className="w-full min-h-[42px] pl-10 pr-4 py-2 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-sm text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#526071] dark:placeholder-[#929BA9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 focus:border-[#0F172A] dark:focus:border-white"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {QUICK_SEARCH_FILTERS.map((tag) => {
              const isSelected = (tag === 'ALL' && !searchQuery) || searchQuery.toUpperCase() === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onSearchChange(tag === 'ALL' ? '' : tag)}
                  className={`min-h-[32px] px-3.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    isSelected
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                      : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {tag === 'ALL' ? tr('Semua', 'All') : tag}
                </button>
              );
            })}
          </div>
        </div>

        <div
          data-testid="macro-upcoming-event-groups"
          className="overflow-y-auto px-5 py-2 divide-y divide-[#E4E4E7] dark:divide-[#20252D] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
        >
          {explorerEventGroups.length === 0 ? (
            <div data-testid="macro-empty-search-info-card" className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Tidak ada jadwal High-Impact pada filter ini.', 'No High-Impact releases match this filter.')}
              </p>
              <button
                type="button"
                onClick={() => {
                  onSearchChange('');
                  onWindowFilterChange('ALL');
                }}
                className="min-h-[36px] px-4 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                {tr('Reset Filter', 'Reset Filter')}
              </button>
            </div>
          ) : (
            explorerEventGroups.map((group) => {
              const isActive = group.groupId === activeGroupId;
              const isPast = !group.isUpcoming;
              const actualSummary = group.events
                .filter((e) => Boolean(e.actual && e.actual.trim()))
                .map((e) => `${e.title}: Act ${e.actual} / Fcst ${e.forecast || '-'}`)
                .join(' · ');

              return (
                <button
                  key={group.groupId}
                  type="button"
                  onClick={() => {
                    onSelectGroup(group.groupId);
                    onClose();
                  }}
                  className={`w-full py-3.5 px-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    isActive
                      ? 'bg-[#F4F4F5] dark:bg-[#0B0E13]'
                      : 'hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{formatTimestampWib(group.releaseDateIso, isEn ? 'en' : 'id')}</span>
                      <span aria-hidden="true">·</span>
                      <span>{group.events.length} {tr('Data', 'Items')}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold font-sans ${
                          isPast
                            ? 'text-[#0F172A] dark:text-[#F2F4F7]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {isPast ? tr('Sudah Rilis', 'Released') : tr('Pre-News', 'Pre-News')}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                      {group.combinedTitle}
                    </p>
                    {actualSummary && (
                      <p className="text-xs font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                        {actualSummary}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#0F172A] dark:text-white">
                        <Check className="w-3.5 h-3.5 stroke-[2.2]" />
                        {tr('Aktif', 'Active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs font-medium text-[#526071] dark:text-[#929BA9]">
                        {tr('Pilih', 'Select')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

interface PlaybookSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PlaybookSheet: React.FC<PlaybookSheetProps> = ({ isOpen, onClose }) => {
  const { tr } = useLanguage();
  useEscapeClose(isOpen, onClose);

  if (!isOpen) return null;

  const sections = [
    {
      badge: '01 · BIAS & ANTI-SWEEP',
      title: tr(
        'Bias Dominan Bukan Perintah Instant Entry di Detik 00:00',
        'Dominant Bias Is Not a 00:00 Instant Entry Signal'
      ),
      body: tr(
        'Persentase BUY/SELL menunjukkan proyeksi arah sesi setelah volatilitas rilis mereda. Pada menit ke-0 hingga ke-3 pasca-rilis, algoritma likuiditas sering menyapu batas atas dan bawah (whipsaw) sebelum bergerak ke arah asli.',
        'The BUY/SELL percentage projects the session direction after initial release volatility settles. During minutes 0–3 post-release, liquidity algorithms frequently sweep both sides (whipsaw) before establishing the real trend.'
      ),
    },
    {
      badge: '02 · DUA HORIZON WAKTU',
      title: tr(
        'Reaksi Awal (15–60 Menit) vs Arah Sesi Utama',
        'Initial Reaction (15–60 Min) vs Primary Session Trend'
      ),
      body: tr(
        'Reaksi awal membaca kejutan spontan angka rilis terhadap ekspektasi pasar, sedangkan Arah Sesi Utama menggabungkan struktur likuiditas AMD, posisi harga 6 jam terakhir (Priced-In 6H), dan keseimbangan 3 pilar FOMC.',
        'Initial Reaction captures the knee-jerk surprise against market consensus, while Primary Session Trend integrates AMD liquidity structure, 6-hour pre-release positioning (Priced-In 6H), and the 3-pillar FOMC balance.'
      ),
    },
    {
      badge: '03 · SKENARIO & ANGKA ACTUAL',
      title: tr(
        'Cara Membaca Matriks Skenario & Warna Kalender',
        'Reading the Scenario Matrix & Calendar Colors'
      ),
      body: tr(
        'Gunakan Matriks Skenario (Bullish / Base / Bearish Gold) untuk mengetahui syarat angka Actual yang membatalkan atau memperkuat bias. Pada tabel kalender, angka Actual Hijau berarti menguatkan USD (tekanan jual XAU/USD), sedangkan Merah berarti melemahkan USD (dorongan beli XAU/USD).',
        'Use the Scenario Matrix (Bullish / Base / Bearish Gold) to see which Actual figures validate or invalidate the bias. In the calendar table, a Green Actual figure indicates USD strength (bearish pressure on XAU/USD), while Red indicates USD weakness (bullish support for XAU/USD).'
      ),
    },
    {
      badge: '04 · KONFIRMASI LINTAS ASET',
      title: tr(
        'Validasi 4 Instrumen Intermarket & Aturan Pindah Haluan',
        '4-Asset Intermarket Validation & Dynamic Pivot Rules'
      ),
      body: tr(
        'Peluang BUY XAU/USD paling valid ketika DXY serta imbal hasil obligasi AS (US02Y & US10Y) melemah bersamaan. Jika angka Actual meleset ekstrem dari Forecast hingga memicu badge PINDAH HALUAN, ikuti arah skenario pasca-rilis yang baru.',
        'XAU/USD BUY setups are strongest when DXY and US Treasury yields (US02Y & US10Y) weaken together. If Actual figures deviate sharply from Forecast and trigger a PIVOT OVERRIDE badge, follow the updated post-release scenario.'
      ),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Panduan Pre-News & 12 Hukum Makro', 'Pre-News & 12 Macro Rules Playbook')}
      data-testid="macro-playbook-sheet"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-[20px] sm:rounded-2xl bg-white dark:bg-[#101318] border-t sm:border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] max-h-[85vh] overflow-y-auto px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:p-6 space-y-4"
      >
        <div className="w-10 h-1 rounded-full bg-[#E4E4E7] dark:bg-[#20252D] mx-auto sm:hidden" />

        <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9] block">
              {tr('PLAYBOOK EKSEKUSI MAKRO · XAU/USD', 'MACRO EXECUTION PLAYBOOK · XAU/USD')}
            </span>
            <h3 className="text-base font-bold text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">
              {tr('Panduan Pre-News & 12 Hukum Makro', 'Pre-News & 12 Macro Rules Playbook')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup Playbook', 'Close Playbook')}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D]">
          {sections.map((sec) => (
            <div key={sec.badge} className="py-3 first:pt-0 last:pb-0 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] font-mono-numbers text-[#526071] dark:text-[#929BA9] block">
                {sec.badge}
              </span>
              <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {sec.title}
              </h4>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
                {sec.body}
              </p>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
            {tr(
              'Standar Risiko: Maksimal 0.5%–1.0% ekuitas saat rilis High-Impact.',
              'Risk Standard: Cap risk at 0.5%–1.0% equity during High-Impact releases.'
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-5 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] dark:bg-white dark:hover:bg-[#E2E8F0] text-white dark:text-[#0F172A] text-xs font-semibold transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            {tr('Mengerti', 'Got It')}
          </button>
        </div>
      </div>
    </div>
  );
};
