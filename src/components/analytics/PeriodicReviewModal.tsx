import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trade, PeriodicReview } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  loadPeriodicReviews,
  savePeriodicReviews,
  getIsoWeekKey,
  getMonthKey,
  filterTradesForReviewPeriod,
  computeReviewSnapshotStats,
  getMistakeLabel,
} from '../../utils/journalExtras';
import { formatCurrency, formatProfitFactor, formatRMultiple } from '../../utils/calculations';
import { useLanguage } from '../../utils/language';
import { CalendarCheck2, X, Save, Star, History, Trash2 } from 'lucide-react';

interface PeriodicReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  trades: Trade[];
  settings: AppSettings;
  userId?: string | null;
}

export const PeriodicReviewModal: React.FC<PeriodicReviewModalProps> = React.memo(({
  isOpen,
  onClose,
  trades,
  settings,
  userId,
}) => {
  const { tr, isEn } = useLanguage();
  const [periodType, setPeriodType] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const initialWeekKey = useMemo(() => getIsoWeekKey(new Date()), []);
  const [periodKey, setPeriodKey] = useState<string>(initialWeekKey);
  const [reviews, setReviews] = useState<PeriodicReview[]>(() => loadPeriodicReviews(userId));
  const [viewMode, setViewMode] = useState<'EDITOR' | 'HISTORY'>('EDITOR');

  const initialMatched = useMemo(
    () => reviews.find((r) => r.periodType === 'WEEKLY' && r.periodKey === initialWeekKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [whatWorked, setWhatWorked] = useState(() => initialMatched?.whatWorked || '');
  const [recurringMistakes, setRecurringMistakes] = useState(
    () => initialMatched?.recurringMistakes || ''
  );
  const [nextPeriodFocus, setNextPeriodFocus] = useState(
    () => initialMatched?.nextPeriodFocus || ''
  );
  const [rating, setRating] = useState<number>(() => initialMatched?.rating || 4);
  const [savedNotice, setSavedNotice] = useState(false);

  const prevUserIdRef = useRef(userId);

  // Sync reviews ONLY if userId actually changes while mounted (avoids redundant frame-1 re-render on open)
  useEffect(() => {
    if (!isOpen || prevUserIdRef.current === userId) return;
    prevUserIdRef.current = userId;
    const reloaded = loadPeriodicReviews(userId);
    setReviews(reloaded);
    const existing = reloaded.find(
      (r) => r.periodType === periodType && r.periodKey === periodKey
    );
    setWhatWorked(existing?.whatWorked || '');
    setRecurringMistakes(existing?.recurringMistakes || '');
    setNextPeriodFocus(existing?.nextPeriodFocus || '');
    setRating(existing?.rating || 4);
    setSavedNotice(false);
  }, [userId, isOpen, periodType, periodKey]);

  // Escape key to close cleanly
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Build available period options (current + past 7 weeks or past 7 months) with a single DateTimeFormat instance
  const periodOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [];
    const now = new Date();
    if (periodType === 'WEEKLY') {
      const thisWeekLabel = isEn ? 'This Week' : 'Minggu Ini';
      for (let i = 0; i < 8; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i * 7);
        const key = getIsoWeekKey(d);
        if (!opts.some((o) => o.key === key)) {
          opts.push({
            key,
            label: i === 0 ? `${key} (${thisWeekLabel})` : key,
          });
        }
      }
    } else {
      const monthFormatter = new Intl.DateTimeFormat(isEn ? 'en-US' : 'id-ID', {
        month: 'long',
        year: 'numeric',
      });
      for (let i = 0; i < 8; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
        const key = getMonthKey(d);
        opts.push({ key, label: monthFormatter.format(d) });
      }
    }
    return opts;
  }, [periodType, isEn]);

  const syncFormForPeriod = (
    nextType: 'WEEKLY' | 'MONTHLY',
    nextKey: string,
    sourceReviews: PeriodicReview[]
  ) => {
    const existing = sourceReviews.find(
      (r) => r.periodType === nextType && r.periodKey === nextKey
    );
    setWhatWorked(existing?.whatWorked || '');
    setRecurringMistakes(existing?.recurringMistakes || '');
    setNextPeriodFocus(existing?.nextPeriodFocus || '');
    setRating(existing?.rating || 4);
    setSavedNotice(false);
  };

  const handleChangePeriodType = (nextType: 'WEEKLY' | 'MONTHLY') => {
    if (nextType === periodType) return;
    const now = new Date();
    const defaultKey = nextType === 'WEEKLY' ? getIsoWeekKey(now) : getMonthKey(now);
    setPeriodType(nextType);
    setPeriodKey(defaultKey);
    syncFormForPeriod(nextType, defaultKey, reviews);
  };

  const handleChangePeriodKey = (nextKey: string) => {
    setPeriodKey(nextKey);
    syncFormForPeriod(periodType, nextKey, reviews);
  };

  const periodTrades = useMemo(
    () => (isOpen ? filterTradesForReviewPeriod(trades, periodType, periodKey) : []),
    [isOpen, trades, periodType, periodKey]
  );

  const snapshotStats = useMemo(
    () => computeReviewSnapshotStats(periodTrades, settings),
    [periodTrades, settings]
  );

  if (!isOpen) return null;

  const activeLabel =
    periodOptions.find((o) => o.key === periodKey)?.label || periodKey;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const reviewId = `${periodType}-${periodKey}`;
    const entry: PeriodicReview = {
      id: reviewId,
      periodType,
      periodKey,
      periodLabel: activeLabel,
      accountId: settings.activeAccountId,
      whatWorked: whatWorked.trim(),
      recurringMistakes: recurringMistakes.trim(),
      nextPeriodFocus: nextPeriodFocus.trim(),
      rating,
      snapshotStats,
      updatedAt: new Date().toISOString(),
    };

    const next = [entry, ...reviews.filter((r) => r.id !== reviewId)];
    setReviews(next);
    savePeriodicReviews(next, userId);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2400);
  };

  const handleDeleteReview = (id: string) => {
    const next = reviews.filter((r) => r.id !== id);
    setReviews(next);
    savePeriodicReviews(next, userId);
  };

  const modalNode = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Evaluasi Berkala (Mingguan & Bulanan)', 'Periodic Trading Review')}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ contain: 'layout style' }}
        className="w-full sm:max-w-2xl max-h-[88vh] flex flex-col rounded-t-[20px] sm:rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_20px_48px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78)] overflow-hidden animate-in slide-in-from-bottom-3 sm:zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-xl bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center shrink-0">
              <CalendarCheck2 className="h-4 w-4 text-[#0F172A] dark:text-[#F2F4F7]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold tracking-tight truncate">
                {tr('Review Mingguan & Bulanan', 'Weekly & Monthly Review')}
              </h2>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] truncate">
                {tr('Ritual evaluasi performa otomatis + catatan disiplin terstruktur.', 'Automated performance recap + structured discipline reflection.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'EDITOR' ? 'HISTORY' : 'EDITOR')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-xs font-semibold cursor-pointer"
            >
              <History className="h-3.5 w-3.5" />
              <span>
                {viewMode === 'EDITOR'
                  ? tr(`Riwayat (${reviews.length})`, `History (${reviews.length})`)
                  : tr('Tulis Review', 'Write Review')}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('Tutup', 'Close')}
              className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-5">
          {viewMode === 'HISTORY' ? (
            reviews.length === 0 ? (
              <div className="py-12 text-center space-y-1.5">
                <p className="text-sm font-semibold">{tr('Belum ada arsip review.', 'No saved reviews yet.')}</p>
                <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                  {tr('Simpan evaluasi mingguan atau bulanan pertama Anda untuk membangun jejak perbaikan.', 'Save your first weekly or monthly review to build an improvement log.')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-4 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                          {rev.periodType === 'WEEKLY' ? tr('MINGGUAN', 'WEEKLY') : tr('BULANAN', 'MONTHLY')} · {rev.periodLabel}
                        </span>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-xs font-mono-numbers tabular-nums">
                          <span
                            className={`font-bold ${
                              rev.snapshotStats.netProfit >= 0
                                ? 'text-[#059669] dark:text-[#00A878]'
                                : 'text-[#E11D48] dark:text-[#E05260]'
                            }`}
                          >
                            {rev.snapshotStats.netProfit >= 0 ? '+' : ''}
                            {formatCurrency(rev.snapshotStats.netProfit, settings)}
                          </span>
                          <span>WR {rev.snapshotStats.winRate}%</span>
                          <span>{rev.snapshotStats.totalTrades} Trade</span>
                          <span>★ {rev.rating}/5</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setPeriodType(rev.periodType);
                            setPeriodKey(rev.periodKey);
                            syncFormForPeriod(rev.periodType, rev.periodKey, reviews);
                            setViewMode('EDITOR');
                          }}
                          className="px-2.5 py-1 rounded-full bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-semibold cursor-pointer"
                        >
                          {tr('Buka', 'Open')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteReview(rev.id)}
                          aria-label={tr('Hapus', 'Delete')}
                          className="p-1.5 rounded-full text-[#526071] hover:text-[#E11D48] cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {rev.nextPeriodFocus && (
                      <p className="text-xs text-[#0F172A] dark:text-[#E2E8F0] pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
                        <span className="font-semibold">{tr('Fokus Berikutnya:', 'Next Focus:')}</span>{' '}
                        {rev.nextPeriodFocus}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <form onSubmit={handleSave} className="space-y-5">
              {/* Period Picker */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative inline-grid grid-cols-2 p-0.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-[#0F172A] dark:bg-white transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      periodType === 'MONTHLY' ? 'translate-x-full' : 'translate-x-0'
                    }`}
                  />
                  {(['WEEKLY', 'MONTHLY'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleChangePeriodType(mode)}
                      className={`relative z-10 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-150 cursor-pointer ${
                        periodType === mode
                          ? 'text-white dark:text-[#0F172A]'
                          : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {mode === 'WEEKLY' ? tr('Mingguan', 'Weekly') : tr('Bulanan', 'Monthly')}
                    </button>
                  ))}
                </div>

                <select
                  value={periodKey}
                  onChange={(e) => handleChangePeriodKey(e.target.value)}
                  className="px-3 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold focus:outline-none"
                >
                  {periodOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Automated Period Snapshot */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] font-mono-numbers tabular-nums">
                <div>
                  <span className="block text-[10px] font-sans uppercase text-[#526071] dark:text-[#929BA9]">
                    Net P/L
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      snapshotStats.netProfit >= 0
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : 'text-[#E11D48] dark:text-[#E05260]'
                    }`}
                  >
                    {snapshotStats.netProfit >= 0 ? '+' : ''}
                    {formatCurrency(snapshotStats.netProfit, settings)}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-sans uppercase text-[#526071] dark:text-[#929BA9]">
                    Winrate
                  </span>
                  <span className="text-sm font-bold">{snapshotStats.winRate}%</span>
                </div>
                <div>
                  <span className="block text-[10px] font-sans uppercase text-[#526071] dark:text-[#929BA9]">
                    Profit Factor
                  </span>
                  <span className="text-sm font-bold">{formatProfitFactor(snapshotStats.profitFactor)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-sans uppercase text-[#526071] dark:text-[#929BA9]">
                    Avg R
                  </span>
                  <span className="text-sm font-bold">{formatRMultiple(snapshotStats.avgR)}</span>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <span className="block text-[10px] font-sans uppercase text-[#526071] dark:text-[#929BA9]">
                    {tr('Mistake Utama', 'Top Mistake')}
                  </span>
                  <span className="text-xs font-sans font-semibold truncate block">
                    {snapshotStats.topMistake
                      ? getMistakeLabel(snapshotStats.topMistake, isEn)
                      : tr('Nihil', 'None')}
                  </span>
                </div>
              </div>

              {/* 3 Structured Reflection Prompts */}
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    {tr('1. Apa yang berjalan sangat baik pada periode ini?', '1. What worked well this period?')}
                  </label>
                  <textarea
                    rows={2}
                    value={whatWorked}
                    onChange={(e) => setWhatWorked(e.target.value)}
                    placeholder={tr(
                      'Contoh: Sabar menunggu sapuan likuiditas sesi London dan disiplin tidak overtrade...',
                      'e.g. Waited patiently for London liquidity sweep and stayed strictly within risk...'
                    )}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs leading-relaxed focus:outline-none focus:border-[#0F172A] dark:focus:border-white resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">
                    {tr('2. Kesalahan berulang atau kebocoran disiplin apa yang terjadi?', '2. What recurring mistakes or discipline leaks happened?')}
                  </label>
                  <textarea
                    rows={2}
                    value={recurringMistakes}
                    onChange={(e) => setRecurringMistakes(e.target.value)}
                    placeholder={tr(
                      'Contoh: Terlalu cepat close posisi sebelum menyentuh TP saat sesi NY...',
                      'e.g. Closed winners prematurely before TP during NY volatility...'
                    )}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs leading-relaxed focus:outline-none focus:border-[#0F172A] dark:focus:border-white resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">
                    {tr('3. Satu fokus perbaikan utama untuk periode berikutnya:', '3. Main improvement focus for next period:')}
                  </label>
                  <textarea
                    rows={2}
                    value={nextPeriodFocus}
                    onChange={(e) => setNextPeriodFocus(e.target.value)}
                    placeholder={tr(
                      'Contoh: Maksimal 2 entry/hari, wajib checklist sebelum tekan tombol eksekusi.',
                      'e.g. Max 2 entries/day, complete pre-trade checklist before every execution.'
                    )}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs leading-relaxed focus:outline-none focus:border-[#0F172A] dark:focus:border-white resize-none"
                  />
                </div>

                {/* Self Discipline Rating */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-semibold">
                    {tr('Skor Disiplin Periode Ini', 'Period Discipline Rating')}
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="p-1 cursor-pointer"
                        aria-label={`${star} / 5`}
                      >
                        <Star
                          className={`h-4 w-4 ${
                            star <= rating
                              ? 'fill-[#D97706] text-[#D97706] dark:fill-[#F59E0B] dark:text-[#F59E0B]'
                              : 'text-[#D4D4D8] dark:text-[#3A4250]'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
                <span className="text-xs text-[#059669] dark:text-[#00A878] font-semibold">
                  {savedNotice ? tr('Review tersimpan ke jurnal.', 'Review saved to journal.') : ''}
                </span>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-bold cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{tr('Simpan Review', 'Save Review')}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
});
