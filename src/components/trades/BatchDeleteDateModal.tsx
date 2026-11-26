import React, { useEffect, useMemo } from 'react';
import { AlertTriangle, Calendar, Trash2 } from 'lucide-react';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import { computeTradeNetProfit, formatCurrency } from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';

export interface BatchDeleteDateRequest {
  dateKey: string;
  headerLabel?: string;
  trades: Trade[];
  source: 'journal' | 'calendar';
  isFilteredSubset?: boolean;
  totalTradesOnDate?: number;
}

interface BatchDeleteDateModalProps {
  request: BatchDeleteDateRequest | null;
  settings: AppSettings;
  isOpen: boolean;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const BatchDeleteDateModal: React.FC<BatchDeleteDateModalProps> = ({
  request,
  settings,
  isOpen,
  isDeleting = false,
  onConfirm,
  onCancel,
}) => {
  const { tr } = useLanguage();
  const { preferredCurrency, formatDynamic } = useGlobalCurrency();

  useEffect(() => {
    if (!isOpen || isDeleting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onCancel]);

  const summary = useMemo(() => {
    if (!request || !Array.isArray(request.trades)) {
      return {
        count: 0,
        netProfit: 0,
        instrumentSummary: '-',
      };
    }

    let netProfit = 0;
    const countsByInstrument = new Map<string, number>();

    for (const t of request.trades) {
      netProfit += computeTradeNetProfit(t);
      const inst = (t.instrument || 'OTHER').toUpperCase();
      countsByInstrument.set(inst, (countsByInstrument.get(inst) || 0) + 1);
    }

    const parts = Array.from(countsByInstrument.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([inst, cnt]) => `${inst} (${cnt})`);
    if (countsByInstrument.size > 4) {
      parts.push(`+${countsByInstrument.size - 4}`);
    }

    return {
      count: request.trades.length,
      netProfit: Number(netProfit.toFixed(2)),
      instrumentSummary: parts.length > 0 ? parts.join(', ') : '-',
    };
  }, [request]);

  if (!isOpen || !request || summary.count === 0) return null;

  const displayDateLabel =
    request.headerLabel && request.headerLabel !== request.dateKey
      ? `${request.headerLabel} (${request.dateKey})`
      : request.dateKey;

  const formattedNetPl =
    preferredCurrency === 'IDR'
      ? `${summary.netProfit > 0 ? '+' : ''}${formatDynamic(summary.netProfit, false)}`
      : `${summary.netProfit > 0 ? '+' : summary.netProfit < 0 ? '-' : ''}${formatCurrency(
          Math.abs(summary.netProfit),
          settings,
          false
        )}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 p-4 animate-in fade-in duration-150"
      onClick={() => !isDeleting && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Konfirmasi Hapus Transaksi per Tanggal', 'Confirm Delete Trades by Date')}
        className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-6 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/15 p-2.5 text-[#E11D48] dark:text-[#E05260] border border-[#E11D48]/20 dark:border-[#E05260]/25 shrink-0">
            <AlertTriangle className="h-5 w-5 stroke-[1.75]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
              {tr('Hapus Transaksi per Tanggal', 'Delete Trades by Date')}
            </h3>
            <p className="text-xs text-[#526071] dark:text-[#929BA9]">
              {tr('Tindakan ini tidak dapat dibatalkan', 'This action cannot be undone')}
            </p>
          </div>
        </div>

        <div className="my-3 divide-y divide-[#E4E4E7] dark:divide-[#20252D] text-xs font-mono-numbers tabular-nums">
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9] inline-flex items-center gap-1.5 shrink-0">
              <Calendar className="h-3.5 w-3.5 stroke-[1.75]" />
              {tr('Tanggal', 'Date')}
            </span>
            <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7] text-right truncate">
              {displayDateLabel}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9]">
              {tr('Jumlah Dihapus', 'Trades to Delete')}
            </span>
            <span className="font-bold text-[#E11D48] dark:text-[#E05260]">
              {summary.count} {tr('Transaksi', 'Trades')}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9]">
              {tr('Instrumen', 'Instruments')}
            </span>
            <span className="font-medium text-[#0F172A] dark:text-[#F2F4F7] text-right">
              {summary.instrumentSummary}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9]">
              {tr('Total Profit / Loss', 'Total Net P/L')}
            </span>
            <span
              className={`font-bold ${
                summary.netProfit > 0
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : summary.netProfit < 0
                  ? 'text-[#E11D48] dark:text-[#E05260]'
                  : 'text-[#0F172A] dark:text-[#F2F4F7]'
              }`}
            >
              {formattedNetPl}
            </span>
          </div>
        </div>

        {request.isFilteredSubset && typeof request.totalTradesOnDate === 'number' && (
          <div className="mb-3 rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
            {tr(
              `Hanya ${summary.count} dari ${request.totalTradesOnDate} transaksi pada tanggal ini yang sesuai filter/tampilan aktif dan akan dihapus. Transaksi lainnya pada tanggal tersebut tetap aman.`,
              `Only ${summary.count} of ${request.totalTradesOnDate} trades on this date match the active filter/view and will be deleted. Remaining trades on this date stay untouched.`
            )}
          </div>
        )}

        <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed">
          {tr(
            `Apakah Anda yakin ingin menghapus ${summary.count} transaksi pada tanggal ini? Data lokal, Cloud, kalender, dan kurva ekuitas akan diperbarui otomatis.`,
            `Are you sure you want to delete ${summary.count} trades on this date? Local storage, Cloud, calendar, and equity curve will recalculate automatically.`
          )}
        </p>

        <div className="mt-5 flex items-center justify-end gap-2.5 pt-3.5 border-t border-[#E4E4E7] dark:border-[#20252D]">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="min-h-[40px] px-4 py-2 rounded-full bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
          >
            {tr('Batal', 'Cancel')}
          </button>
          <button
            type="button"
            data-testid="confirm-batch-delete-date-btn"
            onClick={onConfirm}
            disabled={isDeleting}
            className="min-h-[40px] flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E11D48] hover:bg-[#BE123C] dark:bg-[#E05260] dark:hover:bg-[#E11D48] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]/50 transition-colors cursor-pointer"
          >
            <Trash2 className="h-4 w-4 stroke-[1.75]" />
            <span>
              {isDeleting
                ? tr('Menghapus dari Cloud...', 'Deleting from Cloud...')
                : tr(`Ya, Hapus ${summary.count} Trade`, `Yes, Delete ${summary.count} Trades`)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
