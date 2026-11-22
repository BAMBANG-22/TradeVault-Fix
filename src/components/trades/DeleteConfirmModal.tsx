import React, { useEffect } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Trade } from '../../types/trade';
import { useLanguage } from '../../utils/language';

interface DeleteConfirmModalProps {
  trade: Trade | null;
  isOpen: boolean;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  trade,
  isOpen,
  isDeleting = false,
  onConfirm,
  onCancel,
}) => {
  const { tr } = useLanguage();

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

  if (!isOpen || !trade) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 p-4 animate-in fade-in duration-150"
      onClick={() => !isDeleting && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Konfirmasi Hapus Trade', 'Confirm Delete Trade')}
        className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-6 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/15 p-2.5 text-[#E11D48] dark:text-[#E05260] border border-[#E11D48]/20 dark:border-[#E05260]/25">
            <AlertTriangle className="h-5 w-5 stroke-[1.75]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
              {tr('Konfirmasi Hapus Trade', 'Confirm Delete Trade')}
            </h3>
            <p className="text-xs text-[#526071] dark:text-[#929BA9]">
              {tr('Tindakan ini tidak dapat dibatalkan', 'This action cannot be undone')}
            </p>
          </div>
        </div>

        <div className="my-3 divide-y divide-[#E4E4E7] dark:divide-[#20252D] text-xs font-mono-numbers tabular-nums">
          <div className="py-2.5 flex justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9]">{tr('ID Trade', 'Trade ID')}</span>
            <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">{trade.id}</span>
          </div>
          <div className="py-2.5 flex justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9]">
              {tr('Instrumen & Posisi', 'Instrument & Position')}
            </span>
            <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
              {trade.instrument} ({trade.position})
            </span>
          </div>
          <div className="py-2.5 flex justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9]">Setup</span>
            <span className="text-[#0F172A] dark:text-[#F2F4F7] font-sans font-medium">{trade.strategy}</span>
          </div>
          <div className="py-2.5 flex justify-between gap-3">
            <span className="font-sans text-[#526071] dark:text-[#929BA9]">{tr('Profit Bersih', 'Net P/L')}</span>
            <span
              className={`font-bold ${
                trade.netProfit >= 0
                  ? 'text-[#059669] dark:text-[#00A878]'
                  : 'text-[#E11D48] dark:text-[#E05260]'
              }`}
            >
              {trade.netProfit >= 0 ? '+' : '-'}${Math.abs(trade.netProfit).toFixed(2)}
            </span>
          </div>
        </div>

        <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed">
          {tr(
            'Apakah Anda yakin ingin menghapus data trade ini dari jurnal? Metrik performa dan kurva ekuitas akan dihitung ulang secara otomatis.',
            'Are you sure you want to delete this trade from your journal? Performance metrics and the equity curve will be recalculated automatically.'
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
            onClick={onConfirm}
            disabled={isDeleting}
            className="min-h-[40px] flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E11D48] hover:bg-[#BE123C] dark:bg-[#E05260] dark:hover:bg-[#E11D48] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]/50 transition-colors cursor-pointer"
          >
            <Trash2 className="h-4 w-4 stroke-[1.75]" />
            <span>
              {isDeleting
                ? tr('Menghapus dari Cloud...', 'Deleting from Cloud...')
                : tr('Ya, Hapus Trade', 'Yes, Delete Trade')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
