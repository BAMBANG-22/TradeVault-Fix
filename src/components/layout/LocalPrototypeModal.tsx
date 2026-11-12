import React, { useEffect } from 'react';
import {
  HardDrive,
  AlertTriangle,
  Download,
  RefreshCw,
  X,
  Smartphone,
  Laptop,
  CheckCircle2,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-6 shadow-2xl space-y-5 text-[#151D2A] dark:text-[#F2F5F9]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 rounded-lg text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] transition-colors"
          aria-label={tr('Tutup informasi penyimpanan prototipe', 'Close storage information modal')}
        >
          <X className="h-5 w-5 stroke-[1.75]" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] flex items-center justify-center text-[#697586] dark:text-[#929BA9] shrink-0">
            <HardDrive className="h-5 w-5 stroke-[1.75]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#EEF2F6] dark:bg-[#171D26] text-amber-600 dark:text-amber-400 border border-[#DDE3EA] dark:border-[#252B34]">
                {tr('Mode Lokal', 'Local Mode')}
              </span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {tr('100% Offline & Mandiri', '100% Offline & Self-Contained')}
              </span>
            </div>
            <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F5F9] mt-0.5">
              {tr('Informasi Penyimpanan Lokal', 'Local Storage Information')}
            </h3>
          </div>
        </div>

        {/* Summary Card */}
        <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] space-y-3 text-xs">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 stroke-[1.75]" />
            <div>
              <span className="font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Penyimpanan Browser (localStorage)', 'Browser Storage (localStorage)')}
              </span>
              <p className="text-[#697586] dark:text-[#929BA9] text-[11px] leading-relaxed mt-0.5">
                {tr(
                  `Semua catatan transaksi, kalkulasi risiko, formula analitik, dan pengaturan tersimpan secara privat di peramban web Anda saat ini (${tradesCount} trade tersimpan). Data tetap ada setelah browser di-refresh.`,
                  `All trade records, risk calculations, analytics formulas, and settings are privately stored in your current browser (${tradesCount} trades saved). Data persists across browser refreshes.`
                )}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-[#DDE3EA] dark:border-[#252B34] flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 stroke-[1.75]" />
            <div>
              <span className="font-semibold text-amber-700 dark:text-amber-400 block">
                {tr('Sinkronisasi Antarperangkat', 'Cross-Device Synchronization')}
              </span>
              <p className="text-[#697586] dark:text-[#929BA9] text-[11px] leading-relaxed mt-0.5">
                {tr(
                  'Tanpa login ke akun cloud Supabase, data di perangkat ini tidak otomatis muncul di perangkat lain (misalnya antara laptop dan ponsel).',
                  'Without signing into a Supabase cloud account, data on this device will not automatically appear on other devices (e.g., between laptop and phone).'
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Device Sync / Backup Explainer Diagram */}
        <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
            <span>
              {tr('Cara Memindahkan Data Manual Antarperangkat:', 'How to Transfer Data Manually Between Devices:')}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] flex flex-col items-center gap-1.5">
              <Laptop className="h-4 w-4 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
              <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {tr('1. Perangkat A', '1. Device A')}
              </span>
              <span className="text-[#697586] dark:text-[#929BA9]">Export Backup (.zip/.json)</span>
            </div>

            <div className="p-2.5 rounded-lg bg-[#1769E8]/10 border border-[#1769E8]/30 flex flex-col items-center justify-center gap-1">
              <RefreshCw className="h-4 w-4 stroke-[1.75] text-[#1769E8]" />
              <span className="font-semibold text-[#1769E8]">
                {tr('File Cadangan', 'Backup File')}
              </span>
              <span className="text-[#697586] dark:text-[#929BA9]">
                {tr('Kirim file backup', 'Send backup file')}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] flex flex-col items-center gap-1.5">
              <Smartphone className="h-4 w-4 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
              <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {tr('2. Perangkat B', '2. Device B')}
              </span>
              <span className="text-[#697586] dark:text-[#929BA9]">Import Backup</span>
            </div>
          </div>

          <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
            {tr(
              'Gunakan fitur Backup JSON & ZIP untuk mengunduh seluruh transaksi dan screenshot ke file, lalu pulihkan di perangkat lain kapan saja.',
              'Use the JSON & ZIP Backup feature to download all trades and screenshots to a file, then restore them on another device anytime.'
            )}
          </p>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2">
          {onOpenBackupModal ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenBackupModal();
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] text-white text-xs font-semibold transition-colors"
            >
              <Download className="h-3.5 w-3.5 stroke-[1.75]" />
              <span>{tr('Buka Menu Backup', 'Open Backup Menu')}</span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#EEF2F6] hover:bg-[#DDE3EA] dark:bg-[#171D26] dark:hover:bg-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] text-xs font-semibold transition-colors"
          >
            {tr('Mengerti & Tutup', 'Got It & Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
