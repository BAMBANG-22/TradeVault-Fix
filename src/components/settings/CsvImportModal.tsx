import React, { useState, useEffect } from 'react';
import { Trade } from '../../types/trade';
import { parseCsvToTrades, CsvImportResult } from '../../utils/csv';
import { useLanguage } from '../../utils/language';
import { X, Upload, AlertCircle, CheckCircle } from 'lucide-react';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmImport: (trades: Trade[], mode: 'merge' | 'replace') => void;
}

/**
 * Stabilizes CSV trade IDs deterministically (F-28) using a composite signature of:
 * dateTime + instrument + position + entryPrice + lotSize + netProfit + occurrenceIndex.
 * Ensures re-importing the same CSV yields identical IDs on retries (idempotency).
 */
function stabilizeCsvTradesDeterministically(trades: Trade[]): Trade[] {
  const occurrenceCountMap = new Map<string, number>();
  return trades.map((t) => {
    if (!t.id || t.id.startsWith('CSV-')) {
      const sig = `${t.dateTime}|${(t.instrument || 'XAUUSD').toUpperCase()}|${t.position}|${t.entryPrice}|${t.lotSize}|${t.netProfit}`;
      const occurrenceIndex = occurrenceCountMap.get(sig) || 0;
      occurrenceCountMap.set(sig, occurrenceIndex + 1);

      let h1 = 0x811c9dc5;
      let h2 = 0x9e3779b9;
      const seed = `${sig}|occ:${occurrenceIndex}`;
      for (let i = 0; i < seed.length; i++) {
        const c = seed.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
      }
      const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
      const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
      const stableId = `TRD-CSV-${hex1.slice(0, 4)}-${hex2.slice(0, 4)}`.toUpperCase();
      return {
        ...t,
        id: stableId,
      };
    }
    return t;
  });
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onConfirmImport,
}) => {
  const { tr } = useLanguage();
  const [csvText, setCsvText] = useState<string>('');
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [confirmReplace, setConfirmReplace] = useState<boolean>(false);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setCsvText(text);
        const result = parseCsvToTrades(text);
        const stabilizedTrades = stabilizeCsvTradesDeterministically(result.validTrades);
        setImportResult({
          ...result,
          validTrades: stabilizedTrades,
        });
      }
    };
    reader.readAsText(file);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setCsvText(text);
    if (text.trim().length > 0) {
      const result = parseCsvToTrades(text);
      const stabilizedTrades = stabilizeCsvTradesDeterministically(result.validTrades);
      setImportResult({
        ...result,
        validTrades: stabilizedTrades,
      });
    } else {
      setImportResult(null);
    }
  };

  const handleCommit = () => {
    if (importResult && importResult.validTrades.length > 0) {
      if (importMode === 'replace' && !confirmReplace) {
        return;
      }
      onConfirmImport(importResult.validTrades, importMode);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-6 shadow-2xl text-[#151D2A] dark:text-[#F2F5F9]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#DDE3EA] dark:border-[#252B34]">
          <div>
            <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F5F9] flex items-center gap-2">
              <Upload className="h-5 w-5 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
              {tr('Import Data Trade dari CSV', 'Import Trade Data from CSV')}
            </h3>
            <p className="text-xs text-[#697586] dark:text-[#929BA9]">
              {tr(
                'Validasi otomatis kolom dan pratinjau data sebelum disimpan ke jurnal',
                'Automatically validate columns and preview data before saving to your journal'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#697586] dark:text-[#929BA9] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]"
            aria-label={tr('Tutup modal impor CSV', 'Close CSV import modal')}
          >
            <X className="h-5 w-5 stroke-[1.75]" />
          </button>
        </div>

        {/* Upload or Paste */}
        <div className="mt-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <label className="flex-1 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[#DDE3EA] dark:border-[#252B34] bg-[#F5F7FA] dark:bg-[#080A0E] hover:border-[#1769E8] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] cursor-pointer transition-colors text-xs text-[#151D2A] dark:text-[#F2F5F9]">
              <Upload className="h-4 w-4 stroke-[1.75] text-[#1769E8] dark:text-[#60A5FA]" />
              <span>{tr('Pilih File .CSV dari Komputer / HP', 'Select .CSV File from Device')}</span>
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
            <span className="text-xs text-[#697586] dark:text-[#929BA9]">
              {tr('atau tempel teks CSV di bawah:', 'or paste CSV text below:')}
            </span>
          </div>

          <textarea
            rows={4}
            value={csvText}
            onChange={handleTextChange}
            placeholder={`ID,Tanggal,Instrumen,Posisi,Setup,Entry,SL,TP,Lot,Risk,Hasil,Net Profit,Catatan\nTRD-01,2026-10-25T14:00,XAUUSD,BUY,Liquidity Sweep,2720.00,2715.00,2735.00,0.50,250,WIN,750,Target hit`}
            className="w-full rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] p-3 text-xs font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9] placeholder-[#697586] dark:placeholder-[#929BA9] focus:border-[#1769E8] focus:outline-none"
          />

          {/* Validation & Preview Output */}
          {importResult && (
            <div className="space-y-3 pt-2">
              {/* Summary Stats */}
              <div className="flex flex-wrap items-center justify-between p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-xs gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                    <span>
                      {tr('Diterima:', 'Accepted:')}{' '}
                      <strong className="text-emerald-600 dark:text-emerald-400 font-mono-numbers">
                        {importResult.acceptedRowsCount ?? importResult.validTrades.length}
                      </strong>{' '}
                      {tr('dari', 'of')} <span className="font-mono-numbers">{importResult.totalRows}</span>{' '}
                      {tr('baris', 'rows')}
                    </span>
                  </div>
                  {(importResult.rejectedRowsCount > 0 || importResult.errors.length > 0) && (
                    <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                      <AlertCircle className="h-4 w-4 stroke-[1.75]" />
                      <span>
                        {tr('Ditolak:', 'Rejected:')}{' '}
                        <strong className="font-mono-numbers">
                          {importResult.rejectedRowsCount || importResult.errors.length}
                        </strong>{' '}
                        {tr('baris tidak valid', 'invalid rows')}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-[#697586] dark:text-[#929BA9]">{tr('Mode Simpan:', 'Save Mode:')}</span>
                  <select
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as any)}
                    className="rounded bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] px-2 py-1 text-[#151D2A] dark:text-[#F2F5F9] text-xs"
                  >
                    <option value="merge">
                      {tr('Gabungkan dengan data yang ada', 'Merge with existing data')}
                    </option>
                    <option value="replace">
                      {tr('Gantikan seluruh data jurnal', 'Replace all journal data')}
                    </option>
                  </select>
                </div>
              </div>

              {/* Replace Mode Safety Warning */}
              {importMode === 'replace' && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-400 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>{tr('Perhatian:', 'Warning:')}</strong>{' '}
                      {tr(
                        'Mode Gantikan Seluruh Data akan menghapus transaksi yang tidak ada di dalam file CSV ini dari jurnal (dan dari database Supabase jika login).',
                        'Replace All Data mode will delete any trades not included in this CSV file from your journal (and from Supabase if signed in).'
                      )}
                    </span>
                  </div>
                  <label className="flex items-center gap-2 font-semibold cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={confirmReplace}
                      onChange={(e) => setConfirmReplace(e.target.checked)}
                      className="rounded border-[#DDE3EA] dark:border-[#252B34] text-[#1769E8] focus:ring-[#1769E8]"
                    />
                    <span>
                      {tr(
                        'Saya memahami risiko dan mengonfirmasi penggantian seluruh data',
                        'I understand the risk and confirm replacing all data'
                      )}
                    </span>
                  </label>
                </div>
              )}

              {/* Errors List if any */}
              {(importResult.rowErrors?.length > 0 || importResult.errors.length > 0) && (
                <div className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-xs text-rose-600 dark:text-rose-400 space-y-1 max-h-28 overflow-y-auto">
                  {importResult.rowErrors && importResult.rowErrors.length > 0
                    ? importResult.rowErrors.map((rowErr, i) => (
                        <div key={i} className="font-mono-numbers">
                          • {tr('Baris', 'Row')} {rowErr.rowNumber}
                          {rowErr.tradeId ? ` [${rowErr.tradeId}]` : ''} — Field{' '}
                          <strong>{rowErr.field}</strong>: {rowErr.reason} ({tr('nilai', 'value')}:{' '}
                          <code>{rowErr.rawValue || tr('kosong', 'empty')}</code>)
                        </div>
                      ))
                    : importResult.errors.map((err, i) => <div key={i}>• {err}</div>)}
                </div>
              )}

              {/* Preview Table */}
              {importResult.validTrades.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                    {tr(
                      `Pratinjau ${Math.min(5, importResult.validTrades.length)} Trade Pertama:`,
                      `Preview of First ${Math.min(5, importResult.validTrades.length)} Trades:`
                    )}
                  </span>
                  <div className="max-h-48 overflow-auto rounded-xl border border-[#DDE3EA] dark:border-[#252B34] bg-[#F5F7FA] dark:bg-[#080A0E]">
                    <table className="w-full text-left text-[11px] font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9]">
                      <thead className="bg-white dark:bg-[#11151B] text-[#697586] dark:text-[#929BA9] border-b border-[#DDE3EA] dark:border-[#252B34]">
                        <tr>
                          <th className="p-2">ID</th>
                          <th className="p-2">{tr('Tanggal', 'Date')}</th>
                          <th className="p-2">{tr('Posisi', 'Position')}</th>
                          <th className="p-2">Entry</th>
                          <th className="p-2">SL</th>
                          <th className="p-2">Lot</th>
                          <th className="p-2">{tr('Hasil', 'Outcome')}</th>
                          <th className="p-2 text-right">{tr('Profit Bersih', 'Net Profit')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#DDE3EA] dark:divide-[#252B34]">
                        {importResult.validTrades.slice(0, 5).map((t, i) => (
                          <tr key={i}>
                            <td className="p-2 font-semibold text-[#151D2A] dark:text-[#F2F5F9]">{t.id}</td>
                            <td className="p-2 text-[#697586] dark:text-[#929BA9]">{t.dateTime.slice(0, 10)}</td>
                            <td className="p-2">{t.position} {t.instrument}</td>
                            <td className="p-2">{t.entryPrice}</td>
                            <td className="p-2">{t.stopLoss}</td>
                            <td className="p-2 text-[#1769E8] dark:text-[#60A5FA] font-bold">{t.lotSize}</td>
                            <td className="p-2">{t.outcome}</td>
                            <td className={`p-2 text-right font-bold ${t.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              ${t.netProfit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-[#DDE3EA] dark:border-[#252B34]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] hover:bg-[#DDE3EA] dark:hover:bg-[#252B34]"
          >
            {tr('Batal', 'Cancel')}
          </button>
          <button
            onClick={handleCommit}
            disabled={
              !importResult ||
              importResult.validTrades.length === 0 ||
              (importMode === 'replace' && !confirmReplace)
            }
            className={`flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-bold transition-colors ${
              importResult &&
              importResult.validTrades.length > 0 &&
              (importMode !== 'replace' || confirmReplace)
                ? 'bg-[#1769E8] hover:bg-[#1458C4] text-white cursor-pointer'
                : 'bg-[#EEF2F6] dark:bg-[#171D26] text-[#697586] dark:text-[#929BA9] cursor-not-allowed'
            }`}
          >
            <CheckCircle className="h-4 w-4 stroke-[1.75]" />
            <span>{tr('Konfirmasi & Simpan ke Jurnal', 'Confirm & Save to Journal')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
