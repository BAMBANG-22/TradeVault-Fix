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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-6 shadow-2xl text-[#151D2A] dark:text-[#F2F5F9]">
        <div className="flex items-center gap-3 pb-3 border-b border-[#DDE3EA] dark:border-[#252B34]">
          <div className="rounded-xl bg-[#F5F7FA] dark:bg-[#171D26] p-2.5 text-rose-600 dark:text-rose-400 border border-[#DDE3EA] dark:border-[#252B34]">
            <AlertTriangle className="h-5 w-5 stroke-[1.75]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F5F9]">
              {tr('Konfirmasi Hapus Trade', 'Confirm Delete Trade')}
            </h3>
            <p className="text-xs text-[#697586] dark:text-[#929BA9]">
              {tr('Tindakan ini tidak dapat dibatalkan', 'This action cannot be undone')}
            </p>
          </div>
        </div>

        <div className="my-4 rounded-xl bg-[#F5F7FA] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] p-3.5 text-xs space-y-1.5 font-mono-numbers tabular-nums">
          <div className="flex justify-between">
            <span className="text-[#697586] dark:text-[#929BA9]">{tr('ID Trade:', 'Trade ID:')}</span>
            <span className="font-semibold text-[#151D2A] dark:text-[#F2F5F9]">{trade.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#697586] dark:text-[#929BA9]">
              {tr('Instrumen & Posisi:', 'Instrument & Position:')}
            </span>
            <span className="font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
              {trade.instrument} ({trade.position})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#697586] dark:text-[#929BA9]">Setup:</span>
            <span className="text-[#151D2A] dark:text-[#F2F5F9] font-sans">{trade.strategy}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#697586] dark:text-[#929BA9]">{tr('Profit Bersih:', 'Net P/L:')}</span>
            <span
              className={`font-bold ${
                trade.netProfit >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {trade.netProfit >= 0 ? '+' : ''}${trade.netProfit.toFixed(2)}
            </span>
          </div>
        </div>

        <p className="text-xs text-[#697586] dark:text-[#929BA9]">
          {tr(
            'Apakah Anda yakin ingin menghapus data trade ini dari jurnal? Metrik performa dan kurva ekuitas akan dihitung ulang secara otomatis.',
            'Are you sure you want to delete this trade from your journal? Performance metrics and the equity curve will be recalculated automatically.'
          )}
        </p>

        <div className="mt-5 flex items-center justify-end gap-3 pt-3 border-t border-[#DDE3EA] dark:border-[#252B34]">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg bg-[#EEF2F6] hover:bg-[#DDE3EA] dark:bg-[#171D26] dark:hover:bg-[#252B34] border border-[#DDE3EA] dark:border-[#252B34] text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] disabled:opacity-50 transition-colors cursor-pointer"
          >
            {tr('Batal', 'Cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold text-white transition-colors cursor-pointer"
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
