import React, { useEffect } from 'react';
import { Trash2, ShieldCheck, X } from 'lucide-react';
import { Trade } from '../../types/trade';
import { isDemoTrade } from '../../utils/demoData';
import { useLanguage } from '../../utils/language';

interface ClearDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  trades: Trade[];
}

export const ClearDemoModal: React.FC<ClearDemoModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  trades,
}) => {
  const { tr } = useLanguage();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const demoTrades = trades.filter((t) => isDemoTrade(t));
  const realTrades = trades.filter((t) => !isDemoTrade(t));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Hapus Dataset Demo', 'Delete Demo Dataset')}
        className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-[#D97706]/10 dark:bg-[#F59E0B]/15 border border-[#D97706]/20 dark:border-[#F59E0B]/25 flex items-center justify-center text-[#D97706] dark:text-[#F59E0B] shrink-0">
              <Trash2 className="h-4 w-4 stroke-[1.75]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Hapus Dataset Demo', 'Delete Demo Dataset')}
              </h3>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5">
                {tr('Bersihkan transaksi contoh bawaan VLO', 'Remove built-in VLO sample trades')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer shrink-0"
            aria-label={tr('Tutup konfirmasi hapus data demo', 'Close clear demo data confirmation')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Breakdown Metrics (clean divided columns) */}
          <div className="grid grid-cols-2 divide-x divide-[#E4E4E7] dark:divide-[#20252D] py-1">
            <div className="pr-4">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                {tr('Akan Dihapus', 'Will Be Deleted')}
              </span>
              <span className="text-xl font-bold font-mono-numbers tabular-nums text-[#D97706] dark:text-[#F59E0B] mt-0.5 block">
                {demoTrades.length}
              </span>
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                {tr('Transaksi DEMO', 'DEMO Trades')}
              </span>
            </div>

            <div className="pl-4">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                {tr('Tetap Aman', 'Kept Safe')}
              </span>
              <span className="text-xl font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878] mt-0.5 block">
                {realTrades.length}
              </span>
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                {tr('Transaksi Asli', 'Real Trades')}
              </span>
            </div>
          </div>

          {/* Protection Notice */}
          <div className="pt-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-[#059669] dark:text-[#00A878] shrink-0 mt-0.5 stroke-[1.75]" />
            <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
              {tr(
                'Hanya transaksi berlabel DEMO yang dihapus. Catatan trading pribadi Anda tidak tersentuh.',
                'Only trades tagged DEMO are removed. Your personal trade logs remain untouched.'
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13]/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 py-2 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
          >
            {tr('Batal', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={demoTrades.length === 0}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E11D48] hover:bg-[#BE123C] dark:bg-[#E05260] dark:hover:bg-[#E11D48] disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]/50 transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
            <span>{tr(`Hapus ${demoTrades.length} Demo`, `Delete ${demoTrades.length} Demo`)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
