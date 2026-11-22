import React, { useEffect } from 'react';
import {
  HardDrive,
  Download,
  X,
  Database,
  CloudOff,
  ArrowRight,
} from 'lucide-react';
import { useLanguage } from '../../utils/language';

interface LocalPrototypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBackupModal?: () => void;
  tradesCount: number;
}

export const LocalPrototypeModal: React.FC<LocalPrototypeModalProps> = ({
  isOpen,
  onClose,
  onOpenBackupModal,
  tradesCount,
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Penyimpanan Lokal Perangkat', 'Device Local Storage')}
        className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#526071] dark:text-[#929BA9] shrink-0">
              <HardDrive className="h-4 w-4 stroke-[1.75]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Penyimpanan Lokal Perangkat', 'Device Local Storage')}
              </h3>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5">
                {tr('Data tersimpan privat di browser ini', 'Data stored privately in this browser')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer shrink-0"
            aria-label={tr('Tutup informasi penyimpanan lokal', 'Close local storage modal')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Summary Strip (clean divided columns, no double nested cards) */}
          <div className="grid grid-cols-2 divide-x divide-[#E4E4E7] dark:divide-[#20252D] py-1">
            <div className="pr-4">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                {tr('Tersimpan Lokal', 'Saved Locally')}
              </span>
              <span className="text-base font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] mt-0.5 block">
                {tradesCount} {tr('Transaksi', 'Trades')}
              </span>
            </div>

            <div className="pl-4">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                {tr('Status Operasi', 'Operation Status')}
              </span>
              <span className="text-sm font-bold text-[#059669] dark:text-[#00A878] mt-1 block">
                {tr('Offline Mandiri', 'Offline Ready')}
              </span>
            </div>
          </div>

          {/* Key Details List */}
          <div className="border-y border-[#E4E4E7] dark:border-[#20252D] divide-y divide-[#E4E4E7] dark:divide-[#20252D]">
            <div className="py-3 flex items-start gap-3">
              <Database className="h-4 w-4 text-[#526071] dark:text-[#929BA9] shrink-0 mt-0.5 stroke-[1.75]" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Persistensi Browser', 'Browser Persistence')}
                </span>
                <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5 leading-relaxed">
                  {tr(
                    'Transaksi, kalkulasi risiko, dan pengaturan tetap aman saat halaman dimuat ulang.',
                    'Trades, risk metrics, and settings persist across page reloads.'
                  )}
                </p>
              </div>
            </div>

            <div className="py-3 flex items-start gap-3">
              <CloudOff className="h-4 w-4 text-[#D97706] dark:text-[#F59E0B] shrink-0 mt-0.5 stroke-[1.75]" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Tanpa Sinkronisasi Otomatis', 'No Auto Cross-Device Sync')}
                </span>
                <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5 leading-relaxed">
                  {tr(
                    'Data lokal hanya berada di perangkat ini kecuali Anda masuk ke akun Cloud Supabase.',
                    'Local data stays on this device unless you sign in to a Supabase Cloud account.'
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Transfer Guide */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9] block">
              {tr('Pindah Perangkat Manual', 'Manual Device Transfer')}
            </span>
            <div className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
              <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('1. Ekspor ZIP/JSON', '1. Export ZIP/JSON')}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] shrink-0 stroke-[1.75]" />
              <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('2. Kirim File', '2. Send File')}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] shrink-0 stroke-[1.75]" />
              <span className="font-semibold text-[#0F172A] dark:text-white">
                {tr('3. Impor', '3. Import')}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13]/60 flex items-center justify-between gap-2">
          {onOpenBackupModal ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenBackupModal();
              }}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 stroke-[1.75]" />
              <span>{tr('Buka Cadangan Data', 'Open Data Backup')}</span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 py-2 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
          >
            {tr('Tutup', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
