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
      : 'text-[#697586] dark:text-[#929BA9]';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={asset.name}
      data-testid="intermarket-detail-panel"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-[20px] sm:rounded-[18px] bg-white dark:bg-[#0A0C10] border-t sm:border border-[#DDE3EA] dark:border-[#20252D] max-h-[85vh] overflow-y-auto px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:p-6 space-y-5"
      >
        <div className="w-10 h-1 rounded-full bg-[#DDE3EA] dark:bg-[#20252D] mx-auto sm:hidden" />

        <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#DDE3EA] dark:border-[#20252D]">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block">
              {asset.symbol} · {asset.yahooTicker}
            </span>
            <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F4F7] mt-0.5">
              {asset.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup Detail Indikator', 'Close Indicator Detail')}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <div>
            <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block">
              {tr('Nilai Terkini', 'Current Value')}
            </span>
            <span className="text-3xl font-bold font-mono-numbers tabular-nums tracking-tight text-[#151D2A] dark:text-[#F2F4F7]">
              {formattedPrice}
            </span>
          </div>
          <div className="text-right font-mono-numbers tabular-nums">
            <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block">
              {tr('Perubahan', 'Change')}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-base font-bold ${
                isUp
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : isDown
                  ? 'text-[#E11D48] dark:text-[#E05260]'
                  : 'text-[#697586] dark:text-[#929BA9]'
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

        <div className="grid grid-cols-3 gap-3 py-3 border-y border-[#DDE3EA] dark:border-[#20252D] font-mono-numbers tabular-nums">
          <div>
            <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block">
              {tr('Penutupan Lalu', 'Prev Close')}
            </span>
            <span className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
              {formattedPrevClose}
            </span>
          </div>
          <div>
            <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block">
              {tr('Selisih', 'Delta')}
            </span>
            <span className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
              {changeNominalText}
            </span>
          </div>
          <div>
            <span className="text-[11px] font-sans text-[#697586] dark:text-[#929BA9] block">
              {tr('Arah', 'Direction')}
            </span>
            <span className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
              {asset.direction}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9] block">
              {tr('Efek Korelasi XAU/USD', 'XAU/USD Correlation Impact')}
            </span>
            <p className={`text-sm font-semibold mt-0.5 ${goldEffectColor}`}>
              {goldEffectLabel}
            </p>
          </div>

          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9] block">
              {tr('Ringkasan Kondisi', 'Condition Summary')}
            </span>
            <p className="text-sm text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed mt-0.5">
              {isEn ? asset.summaryEn : asset.summaryId}
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-[#DDE3EA] dark:border-[#20252D] flex items-center justify-between text-xs text-[#697586] dark:text-[#929BA9]">
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
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-[20px] sm:rounded-[18px] bg-white dark:bg-[#0A0C10] border-t sm:border border-[#DDE3EA] dark:border-[#20252D] max-h-[85vh] overflow-y-auto px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:p-6 space-y-4"
      >
        <div className="w-10 h-1 rounded-full bg-[#DDE3EA] dark:bg-[#20252D] mx-auto sm:hidden" />

        <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#DDE3EA] dark:border-[#20252D]">
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
              <span className="text-[#697586] dark:text-[#929BA9]" aria-hidden="true">
                ·
              </span>
              <span className="text-[#697586] dark:text-[#929BA9]">{pillarLabel(item.pillar)}</span>
            </div>
            <h3 className="text-sm sm:text-base font-bold text-[#151D2A] dark:text-[#F2F4F7]">
              {item.tag}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup Detail Argumen', 'Close Argument Detail')}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9] block">
            {tr('Penjelasan Fundamental', 'Fundamental Explanation')}
          </span>
          <p className="text-sm text-[#151D2A] dark:text-[#F2F4F7] leading-relaxed">
            {isEn ? item.textEn : item.textId}
          </p>
        </div>

        {recapText && (
          <div className="pt-3 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#151D2A] dark:text-[#F2F4F7] block">
              {tr('Konteks Pilar Terkait', 'Related Pillar Context')}
            </span>
            <p className="text-xs sm:text-[13px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
              {recapText}
            </p>
          </div>
        )}

        {relatedEvents.length > 0 && (
          <div className="pt-3 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9] block">
              {tr('Indikator Pendukung pada Pilar Ini', 'Supporting Calendar Indicators')}
            </span>
            <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
              {relatedEvents.map((ev) => (
                <div key={ev.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#151D2A] dark:text-[#F2F4F7] truncate">
                      {ev.title}
                    </p>
                    <p className="text-[11px] text-[#697586] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                      {formatTimestampWib(ev.date, isEn ? 'en' : 'id')}
                    </p>
                  </div>
                  <div className="text-right font-mono-numbers tabular-nums shrink-0 text-[11px] text-[#151D2A] dark:text-[#F2F4F7]">
                    <span>Prev {ev.previous || '-'}</span>
                    <span className="mx-1 text-[#697586] dark:text-[#929BA9]">·</span>
                    <span>Fcst {ev.forecast || '-'}</span>
                    {ev.actual && ev.actual.trim() !== '-' && (
                      <>
                        <span className="mx-1 text-[#697586] dark:text-[#929BA9]">·</span>
                        <span
                          className={
                            ev.eventBiasForGold === 'SELL'
                              ? 'font-bold text-[#059669] dark:text-[#00A878]'
                              : ev.eventBiasForGold === 'BUY'
                              ? 'font-bold text-[#E11D48] dark:text-[#E05260]'
                              : 'font-bold text-[#151D2A] dark:text-[#F2F4F7]'
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
          <div className="pt-3 border-t border-[#DDE3EA] dark:border-[#20252D] space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#697586] dark:text-[#929BA9] block">
              {tr('Headline Pendukung Terkini', 'Related Supporting Headlines')}
            </span>
            <div className="divide-y divide-[#DDE3EA] dark:divide-[#20252D]">
              {relatedNews.map((hl) => (
                <div key={hl.id} className="py-2 space-y-0.5">
                  <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                    {hl.source} · {hl.sentimentForGold}
                  </span>
                  <p className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
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
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl rounded-t-[20px] sm:rounded-[18px] bg-white dark:bg-[#0A0C10] border-t sm:border border-[#DDE3EA] dark:border-[#20252D] max-h-[85vh] flex flex-col"
      >
        <div className="px-5 pt-3 pb-3 border-b border-[#DDE3EA] dark:border-[#20252D] space-y-3 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#DDE3EA] dark:bg-[#20252D] mx-auto sm:hidden" />

          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block">
                {tr('TARGET ANALISIS (14 HARI)', 'ANALYSIS TARGET (14 DAYS)')}
              </span>
              <h3 className="text-sm sm:text-base font-bold text-[#151D2A] dark:text-[#F2F4F7]">
                {tr('Pilih Jadwal Rilis USD', 'Select USD Release Schedule')}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('Tutup Pemilih Target', 'Close Target Selector')}
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] cursor-pointer"
            >
              <X className="w-4 h-4 stroke-[2]" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center p-1 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D]">
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
                  className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    eventWindowFilter === opt.key
                      ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                      : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {tr(opt.labelId, opt.labelEn)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-[#697586] dark:text-[#929BA9] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="macro-upcoming-search-input"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={tr('Cari rilis USD (PPI, CPI, NFP, FOMC)...', 'Search USD release (PPI, CPI, NFP, FOMC)...')}
              className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-sm text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#697586] dark:placeholder-[#929BA9] focus:outline-none focus:border-black/40 dark:focus:border-white/40"
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
                  className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#151D2A] text-white dark:bg-white dark:text-[#050607]'
                      : 'bg-[#F5F7FA] dark:bg-[#101318] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#20252D] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
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
          className="overflow-y-auto px-5 py-2 divide-y divide-[#DDE3EA] dark:divide-[#20252D] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
        >
          {explorerEventGroups.length === 0 ? (
            <div data-testid="macro-empty-search-info-card" className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-[#151D2A] dark:text-[#F2F4F7]">
                {tr('Tidak ada jadwal High-Impact pada filter ini.', 'No High-Impact releases match this filter.')}
              </p>
              <button
                type="button"
                onClick={() => {
                  onSearchChange('');
                  onWindowFilterChange('ALL');
                }}
                className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#F5F7FA] dark:bg-[#101318] border border-[#DDE3EA] dark:border-[#20252D] text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] cursor-pointer"
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
                  className={`w-full py-3.5 px-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer rounded-lg ${
                    isActive
                      ? 'bg-[#F5F7FA] dark:bg-[#101318]'
                      : 'hover:bg-[#F5F7FA]/70 dark:hover:bg-[#101318]/70'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{formatTimestampWib(group.releaseDateIso, isEn ? 'en' : 'id')}</span>
                      <span aria-hidden="true">·</span>
                      <span>{group.events.length} {tr('Data', 'Items')}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold font-sans ${
                          isPast
                            ? 'text-[#1769E8] dark:text-[#3478DC]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {isPast ? tr('Sudah Rilis', 'Released') : tr('Pre-News', 'Pre-News')}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                      {group.combinedTitle}
                    </p>
                    {actualSummary && (
                      <p className="text-xs font-mono-numbers tabular-nums text-[#697586] dark:text-[#929BA9]">
                        {actualSummary}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#151D2A] dark:text-white">
                        <Check className="w-4 h-4 stroke-[2.2]" />
                        {tr('Aktif', 'Active')}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-[#697586] dark:text-[#929BA9]">
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Panduan Pre-News & 12 Hukum Makro', 'Pre-News & 12 Macro Rules Playbook')}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-[20px] sm:rounded-[18px] bg-white dark:bg-[#0A0C10] border-t sm:border border-[#DDE3EA] dark:border-[#20252D] px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:p-6 space-y-4"
      >
        <div className="w-10 h-1 rounded-full bg-[#DDE3EA] dark:bg-[#20252D] mx-auto sm:hidden" />

        <div className="flex items-center justify-between pb-3 border-b border-[#DDE3EA] dark:border-[#20252D]">
          <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F4F7]">
            {tr('Panduan Pre-News & 12 Hukum Makro', 'Pre-News & 12 Macro Rules Playbook')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup Playbook', 'Close Playbook')}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] cursor-pointer"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        <ul className="space-y-3 text-sm text-[#697586] dark:text-[#929BA9] leading-relaxed list-disc pl-5">
          <li>
            {tr(
              'Gunakan bias dominan sebagai peta arah makro, lalu tunggu konfirmasi struktur M1/M5 saat detik rilis berita.',
              'Use the dominant bias as your directional map, then wait for M1/M5 structure confirmation at release.'
            )}
          </li>
          <li>
            {tr(
              'Verifikasi keselarasan 4 instrumen Intermarket (DXY, US02Y, US10Y, US Oil) sebelum mengeksekusi posisi XAU/USD.',
              'Verify 4-asset Intermarket alignment (DXY, US02Y, US10Y, US Oil) before entering XAU/USD positions.'
            )}
          </li>
          <li>
            {tr(
              'Waspadai Aturan Pindah Haluan jika angka aktual meleset tajam atau komentar pejabat The Fed berbalik arah.',
              'Watch for Dynamic Pivot overrides if actual figures miss sharply or Fed commentary reverses tone.'
            )}
          </li>
          <li>
            {tr(
              'Pada kalender ekonomi, angka Actual berwarna Hijau berarti kuat bagi USD (Good for USD), sedangkan Merah berarti lemah bagi USD (Bad for USD).',
              'In the economic calendar, Green Actual numbers indicate USD strength (Good for USD), while Red indicates USD weakness (Bad for USD).'
            )}
          </li>
        </ul>
      </div>
    </div>
  );
};
