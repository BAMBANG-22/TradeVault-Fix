import React, { useState, useEffect } from 'react';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import { generateBackupJson } from '../../utils/storage';
import { migrateLocalTradesToSupabase, prepareTradesForJsonBackup } from '../../utils/supabaseSync';
import { exportFile } from '../../utils/fileExport';
import { formatCurrency } from '../../utils/calculations';
import {
  X,
  UploadCloud,
  Download,
  CheckCircle,
  AlertTriangle,
  ShieldCheck,
  FileJson,
} from 'lucide-react';

interface MigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  localTrades: Trade[];
  settings: AppSettings;
  userId: string;
  onMigrationComplete: () => void;
}

export const MigrationModal: React.FC<MigrationModalProps> = ({
  isOpen,
  onClose,
  localTrades,
  settings,
  userId,
  onMigrationComplete,
}) => {
  const [excludeDemo, setExcludeDemo] = useState(true);
  const [hasBackedUp, setHasBackedUp] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [migrationDone, setMigrationDone] = useState(false);

  useEffect(() => {
    if (!isOpen || isMigrating || isExportingBackup) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMigrating, isExportingBackup, onClose]);

  if (!isOpen) return null;

  const tradesToMigrate = excludeDemo
    ? localTrades.filter((t) => !t.isDemo)
    : localTrades;

  const handleDownloadBackup = async () => {
    if (isExportingBackup || isMigrating) return;
    setIsExportingBackup(true);
    setStatusMessage(null);
    try {
      const portableTrades = await prepareTradesForJsonBackup(localTrades, userId || null);
      const jsonStr = generateBackupJson(portableTrades, settings);
      const fileName = `Pre_Migration_TradeVault_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      const result = await exportFile({
        data: jsonStr,
        fileName,
        mimeType: 'application/json',
      });
      if (result.status === 'saved') {
        setHasBackedUp(true);
      } else {
        setStatusMessage('Penyimpanan cadangan dibatalkan. Silakan simpan cadangan terlebih dahulu.');
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'Gagal menyimpan file cadangan pra-migrasi.');
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleStartMigration = async () => {
    if (tradesToMigrate.length === 0) {
      setStatusMessage('Tidak ada transaksi lokal yang perlu dimigrasi.');
      return;
    }

    setIsMigrating(true);
    setStatusMessage(null);
    setProgress({ done: 0, total: tradesToMigrate.length });

    const result = await migrateLocalTradesToSupabase(
      tradesToMigrate,
      userId,
      (done, total) => {
        setProgress({ done, total });
      }
    );

    setIsMigrating(false);

    if (result.success) {
      setMigrationDone(true);
      setStatusMessage(`Berhasil memigrasikan ${result.count} transaksi ke Supabase!`);
      onMigrationComplete();
    } else {
      setStatusMessage(`Migrasi selesai sebagian (${result.count}/${tradesToMigrate.length}). Error: ${result.error}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (!isMigrating) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-6 shadow-2xl text-[#151D2A] dark:text-[#F2F5F9]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#DDE3EA] dark:border-[#252B34]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#EEF2F6] dark:bg-[#171D26] text-[#697586] dark:text-[#929BA9] border border-[#DDE3EA] dark:border-[#252B34]">
              <UploadCloud className="h-5 w-5 stroke-[1.75]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                Migrasi Transaksi Lokal ke Database Supabase
              </h3>
              <p className="text-xs text-[#697586] dark:text-[#929BA9]">
                Unggah catatan transaksi yang ada di browser ke akun cloud Anda dengan aman
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isMigrating}
            aria-label="Tutup modal migrasi"
            className="p-1.5 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] disabled:opacity-50"
          >
            <X className="h-5 w-5 stroke-[1.75]" />
          </button>
        </div>

        {/* Step 1: Backup First Guarantee */}
        <div className="my-4 p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
              <FileJson className="h-4 w-4 text-[#697586] dark:text-[#929BA9] stroke-[1.75]" />
              <span>Langkah 1: Unduh Cadangan Data Lokal (Wajib untuk Keamanan)</span>
            </div>
            {hasBackedUp && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
                <CheckCircle className="h-3.5 w-3.5 stroke-[1.75]" />
                <span>Cadangan Siap</span>
              </span>
            )}
          </div>
          <p className="text-xs text-[#697586] dark:text-[#929BA9]">
            Sebelum memulai migrasi ke cloud, simpan salinan lengkap transaksi lokal Anda dalam bentuk file JSON. Data lokal Anda tidak akan dihapus.
          </p>
          <button
            type="button"
            onClick={handleDownloadBackup}
            disabled={isExportingBackup || isMigrating}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#EEF2F6] hover:bg-[#DDE3EA] dark:bg-[#171D26] dark:hover:bg-[#252B34] disabled:opacity-50 disabled:cursor-not-allowed border border-[#DDE3EA] dark:border-[#252B34] text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] transition-colors"
          >
            <Download className="h-4 w-4 text-[#1769E8] dark:text-[#60A5FA] stroke-[1.75]" />
            <span>
              {isExportingBackup
                ? 'Menyimpan Backup JSON...'
                : `Download Backup JSON (${localTrades.length} Trade)`}
            </span>
          </button>
        </div>

        {/* Step 2: Options & Preview */}
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
              Langkah 2: Pratinjau Transaksi yang Akan Dimigrasikan ({tradesToMigrate.length} Transaksi)
            </span>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={excludeDemo}
                onChange={(e) => setExcludeDemo(e.target.checked)}
                className="rounded border-[#DDE3EA] dark:border-[#252B34] bg-[#F5F7FA] dark:bg-[#080A0E] text-[#1769E8] focus:ring-0"
              />
              <span className="text-[#697586] dark:text-[#929BA9]">Kecualikan data DEMO contoh</span>
            </label>
          </div>

          {/* Preview Table */}
          <div className="max-h-48 overflow-y-auto rounded-xl border border-[#DDE3EA] dark:border-[#252B34] bg-[#F5F7FA] dark:bg-[#080A0E]">
            <table className="w-full text-left text-[11px] font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9]">
              <thead className="bg-white dark:bg-[#11151B] text-[#697586] dark:text-[#929BA9] border-b border-[#DDE3EA] dark:border-[#252B34] sticky top-0">
                <tr>
                  <th className="p-2">ID</th>
                  <th className="p-2">Tanggal</th>
                  <th className="p-2">Instrumen & Posisi</th>
                  <th className="p-2">Setup</th>
                  <th className="p-2">Lot</th>
                  <th className="p-2 text-right">Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE3EA] dark:divide-[#252B34]">
                {tradesToMigrate.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-[#697586] dark:text-[#929BA9] font-sans">
                      Tidak ada transaksi lokal untuk dimigrasikan.
                    </td>
                  </tr>
                ) : (
                  tradesToMigrate.map((t) => (
                    <tr key={t.id} className="hover:bg-[#EEF2F6]/60 dark:hover:bg-[#171D26]/40">
                      <td className="p-2 font-semibold text-[#151D2A] dark:text-[#F2F5F9]">{t.id}</td>
                      <td className="p-2 text-[#697586] dark:text-[#929BA9]">{t.dateTime.slice(0, 10)}</td>
                      <td className="p-2">
                        <span className={t.position === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {t.position}
                        </span>{' '}
                        {t.instrument}
                      </td>
                      <td className="p-2 font-sans truncate max-w-[150px]">{t.strategy}</td>
                      <td className="p-2 font-bold text-[#1769E8] dark:text-[#60A5FA]">{t.lotSize.toFixed(2)}</td>
                      <td
                        className={`p-2 text-right font-bold ${
                          t.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(t.netProfit, settings)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Progress bar if migrating */}
          {isMigrating && (
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between text-xs text-[#697586] dark:text-[#929BA9]">
                <span>Mengunggah transaksi ke Supabase...</span>
                <span className="font-mono-numbers">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-[#EEF2F6] dark:bg-[#171D26] h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#1769E8] h-full transition-all duration-150"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border bg-[#F5F7FA] dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#252B34] text-xs flex items-center gap-2 ${
                migrationDone
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {migrationDone ? (
                <CheckCircle className="h-4 w-4 shrink-0 stroke-[1.75]" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
              )}
              <span>{statusMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-between pt-4 border-t border-[#DDE3EA] dark:border-[#252B34]">
          <div className="text-[11px] text-[#697586] dark:text-[#929BA9] flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
            <span>Terlindungi Row Level Security (RLS)</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isMigrating}
              className="px-4 py-2 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] hover:bg-[#DDE3EA] dark:hover:bg-[#252B34] disabled:opacity-50"
            >
              {migrationDone ? 'Tutup' : 'Batal'}
            </button>

            {!migrationDone && (
              <button
                type="button"
                disabled={isMigrating || tradesToMigrate.length === 0}
                onClick={handleStartMigration}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] text-white font-bold text-xs transition-colors disabled:opacity-50"
              >
                <UploadCloud className="h-4 w-4 stroke-[1.75]" />
                <span>{isMigrating ? 'Sedang Migrasi...' : 'Mulai Migrasi ke Cloud'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
