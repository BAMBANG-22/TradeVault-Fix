import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Download,
  Upload,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  X,
  FileSpreadsheet,
  Database,
  Cloud,
  FileArchive,
  Loader2,
  RefreshCw,
  AlertCircle,
  Info,
} from 'lucide-react';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import { generateBackupJson, parseAndRestoreBackup } from '../../utils/storage';
import { exportTradesToCsv, downloadCsvFile } from '../../utils/csv';
import { formatCurrency } from '../../utils/calculations';
import {
  generateFullZipBackup,
  ZipBackupProgress,
  ZipBackupFailedItem,
  GenerateZipResult,
  ParsedZipArchive,
  RestoreZipProgress,
  RestoreZipResult,
  parseAndValidateZipArchive,
  executeZipRestore,
} from '../../utils/backupZip';
import { isStoragePath, prepareTradesForJsonBackup } from '../../utils/supabaseSync';
import { exportFile } from '../../utils/fileExport';
import { useLanguage } from '../../utils/language';

interface JsonBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  trades: Trade[];
  settings: AppSettings;
  currentUser?: any | null;
  onRestoreSuccess: (
    trades: Trade[],
    settings?: AppSettings,
    mode?: 'replace' | 'merge',
    syncToCloud?: boolean
  ) => Promise<any> | void;
}

interface ValidationReport {
  isValid: boolean;
  fileFormat: 'json' | 'zip';
  fileName: string;
  fileSize: number;
  totalParsedTrades: number;
  validTradesCount: number;
  invalidTradesCount: number;
  hasSettings: boolean;
  backupSettings?: AppSettings;
  backupTrades?: Trade[];
  backupTotalProfit?: number;
  errors: string[];
  warnings?: string[];
  archivedImagesCount?: number;
  storageScreenshotsCount?: number;
  base64ScreenshotsCount?: number;
  externalScreenshotsCount?: number;
}

export const JsonBackupModal: React.FC<JsonBackupModalProps> = ({
  isOpen,
  onClose,
  trades,
  settings,
  currentUser,
  onRestoreSuccess,
}) => {
  const { tr } = useLanguage();
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [parsedZipArchive, setParsedZipArchive] = useState<ParsedZipArchive | null>(null);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState<boolean>(false);

  // Restore Execution Settings
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [syncToCloud, setSyncToCloud] = useState<boolean>(true);
  const [confirmOverwrite, setConfirmOverwrite] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExportingJson, setIsExportingJson] = useState<boolean>(false);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [isRestoringJson, setIsRestoringJson] = useState<boolean>(false);

  // Restore ZIP Progress & Execution States
  const [restoreZipPhase, setRestoreZipPhase] = useState<'idle' | 'uploading' | 'completed' | 'failed'>('idle');
  const [restoreZipProgress, setRestoreZipProgress] = useState<RestoreZipProgress | null>(null);
  const [restoreZipFailedItems, setRestoreZipFailedItems] = useState<
    Array<{ tradeId: string; archivePath: string; error: string }>
  >([]);
  const [restoreZipSuccessSummary, setRestoreZipSuccessSummary] = useState<RestoreZipResult | null>(null);
  const restoreAbortControllerRef = useRef<AbortController | null>(null);

  // Upload cache for retries
  const uploadCacheRef = useRef<Map<string, string>>(new Map());

  // Export States
  const [exportFormat, setExportFormat] = useState<'zip' | 'json' | 'csv'>('zip');
  const [zipPhase, setZipPhase] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [zipProgress, setZipProgress] = useState<ZipBackupProgress | null>(null);
  const [zipResult, setZipResult] = useState<GenerateZipResult | null>(null);
  const [zipFailedItems, setZipFailedItems] = useState<ZipBackupFailedItem[]>([]);
  const [isRedownloadingZip, setIsRedownloadingZip] = useState<boolean>(false);
  const [exportStatusMsg, setExportStatusMsg] = useState<{
    text: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);
  const exportAbortControllerRef = useRef<AbortController | null>(null);

  const isBackupOrRestoreBusy =
    isAnalyzingFile ||
    isExportingJson ||
    isExportingCsv ||
    isRedownloadingZip ||
    isRestoringJson ||
    zipPhase === 'running' ||
    restoreZipPhase === 'uploading';

  useEffect(() => {
    if (!isOpen || isBackupOrRestoreBusy) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isBackupOrRestoreBusy, onClose]);

  const screenshotStats = useMemo(() => {
    let storageCount = 0;
    let base64Count = 0;
    let externalCount = 0;
    for (const t of trades) {
      const url = t.screenshotUrl ? String(t.screenshotUrl).trim() : '';
      if (!url) continue;
      if (url.startsWith('data:image/')) base64Count++;
      else if (url.startsWith('http://') || url.startsWith('https://')) externalCount++;
      else if (isStoragePath(url)) storageCount++;
    }
    return {
      totalScreenshots: storageCount + base64Count + externalCount,
      storageCount,
      base64Count,
      externalCount,
    };
  }, [trades]);

  const mergeStats = useMemo(() => {
    if (!validationReport?.backupTrades) return null;
    const incomingIds = new Set(validationReport.backupTrades.map((t) => t.id));
    let duplicates = 0;
    let newItems = 0;
    for (const t of validationReport.backupTrades) {
      if (trades.some((ex) => ex.id === t.id)) {
        duplicates++;
      } else {
        newItems++;
      }
    }
    const unchanged = trades.filter((ex) => !incomingIds.has(ex.id)).length;
    return { duplicates, newItems, unchanged };
  }, [validationReport, trades]);

  if (!isOpen) return null;

  // Handle Standard JSON Export
  const handleDownloadBackup = async () => {
    if (isExportingJson) return;
    setIsExportingJson(true);
    setExportStatusMsg(null);
    try {
      const exportReadyTrades = await prepareTradesForJsonBackup(trades, currentUser?.id || null);
      const jsonStr = generateBackupJson(exportReadyTrades, settings);
      const fileName = `VLO_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      const result = await exportFile({
        data: jsonStr,
        fileName,
        mimeType: 'application/json',
      });
      if (result.status === 'saved') {
        setExportStatusMsg({
          text: tr(`File ${result.fileName} berhasil disimpan.`, `File ${result.fileName} saved.`),
          type: 'success',
        });
      } else {
        setExportStatusMsg({
          text: tr('Penyimpanan JSON dibatalkan.', 'JSON backup cancelled.'),
          type: 'info',
        });
      }
    } catch (err: any) {
      setExportStatusMsg({
        text: err?.message || tr('Gagal menyimpan cadangan JSON.', 'Failed to save JSON backup.'),
        type: 'error',
      });
    } finally {
      setIsExportingJson(false);
    }
  };

  // Handle CSV Spreadsheet Export
  const handleDownloadCsv = async () => {
    if (isExportingCsv) return;
    if (trades.length === 0) {
      setExportStatusMsg({
        text: tr('Belum ada transaksi untuk diekspor.', 'No trades available to export.'),
        type: 'error',
      });
      return;
    }
    setIsExportingCsv(true);
    setExportStatusMsg(null);
    try {
      const csvStr = exportTradesToCsv(trades);
      const fileName = `VLO_Export_${new Date().toISOString().slice(0, 10)}.csv`;
      const res = await downloadCsvFile(csvStr, fileName);
      if (res.status === 'saved') {
        setExportStatusMsg({
          text: tr(`Berkas ${fileName} berhasil disimpan.`, `File ${fileName} saved.`),
          type: 'success',
        });
      } else {
        setExportStatusMsg({
          text: tr('Penyimpanan CSV dibatalkan.', 'CSV export cancelled.'),
          type: 'info',
        });
      }
    } catch (err: any) {
      setExportStatusMsg({
        text: err?.message || tr('Gagal menyimpan berkas CSV.', 'Failed to save CSV file.'),
        type: 'error',
      });
    } finally {
      setIsExportingCsv(false);
    }
  };

  // Handle Full ZIP Backup Export
  const handleStartZipBackup = async (allowPartial = false) => {
    if (zipPhase === 'running' || isRedownloadingZip) return;
    const controller = new AbortController();
    exportAbortControllerRef.current = controller;
    setExportStatusMsg(null);
    setZipPhase('running');
    setZipProgress({
      phase: 'scanning',
      currentStep: 0,
      totalSteps: trades.length,
      message: tr('Menyiapkan arsip...', 'Preparing archive...'),
      percent: 5,
    });
    setZipFailedItems([]);

    try {
      const res = await generateFullZipBackup(
        trades,
        settings,
        currentUser ? { id: currentUser.id, email: currentUser.email } : null,
        (progress) => {
          setZipProgress(progress);
        },
        {
          allowPartial,
          abortSignal: controller.signal,
        }
      );

      setZipResult(res);

      if (res.success && res.blob && res.fileName) {
        setZipProgress({
          phase: 'packaging',
          currentStep: trades.length,
          totalSteps: trades.length,
          message: tr('Menyimpan arsip ZIP...', 'Saving ZIP archive...'),
          percent: 99,
        });
        const saveRes = await exportFile({
          data: res.blob,
          fileName: res.fileName,
          mimeType: 'application/zip',
        });
        setZipPhase('completed');
        if (saveRes.status === 'saved') {
          setExportStatusMsg({
            text: tr(`Arsip ${saveRes.fileName} berhasil disimpan.`, `Archive ${saveRes.fileName} saved.`),
            type: 'success',
          });
        } else {
          setExportStatusMsg({
            text: tr(
              'Penyimpanan dibatalkan. Gunakan "Unduh Ulang ZIP" untuk menyimpan file.',
              'Save cancelled. Use "Redownload ZIP" to save the archive.'
            ),
            type: 'info',
          });
        }
      } else {
        setZipFailedItems(res.failedItems || []);
        setZipPhase('failed');
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        setZipPhase('idle');
        setZipProgress(null);
      } else {
        setZipFailedItems([
          {
            tradeId: 'GLOBAL',
            sourceType: 'storage',
            pathOrRef: tr('Arsip Cadangan', 'Backup Archive'),
            error: err?.message || tr('Gagal membuat arsip ZIP.', 'Failed to create ZIP archive.'),
          },
        ]);
        setZipPhase('failed');
      }
    } finally {
      exportAbortControllerRef.current = null;
    }
  };

  const handleRedownloadZip = async () => {
    if (!zipResult?.blob || !zipResult?.fileName || isRedownloadingZip) return;
    setIsRedownloadingZip(true);
    setExportStatusMsg(null);
    try {
      const saveRes = await exportFile({
        data: zipResult.blob,
        fileName: zipResult.fileName,
        mimeType: 'application/zip',
      });
      if (saveRes.status === 'saved') {
        setExportStatusMsg({
          text: tr(`Arsip ${saveRes.fileName} berhasil disimpan.`, `Archive ${saveRes.fileName} saved.`),
          type: 'success',
        });
      } else {
        setExportStatusMsg({
          text: tr('Penyimpanan ulang dibatalkan.', 'Redownload cancelled.'),
          type: 'info',
        });
      }
    } catch (err: any) {
      setExportStatusMsg({
        text: err?.message || tr('Gagal menyimpan ulang ZIP.', 'Failed to redownload ZIP.'),
        type: 'error',
      });
    } finally {
      setIsRedownloadingZip(false);
    }
  };

  const handleCancelZipBackup = () => {
    if (exportAbortControllerRef.current) {
      exportAbortControllerRef.current.abort();
    }
    setZipPhase('idle');
    setZipProgress(null);
  };

  const handleResetZipState = () => {
    setZipPhase('idle');
    setZipProgress(null);
    setZipFailedItems([]);
    setExportStatusMsg(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setErrorMessage(null);
    setConfirmOverwrite(false);
    setRestoreZipPhase('idle');
    setRestoreZipFailedItems([]);
    setRestoreZipSuccessSummary(null);
    uploadCacheRef.current.clear();

    const isZip =
      file.name.toLowerCase().endsWith('.zip') ||
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed';

    if (isZip) {
      await validateSelectedZipFile(file);
    } else {
      validateSelectedJsonFile(file);
    }
  };

  const validateSelectedZipFile = async (file: File) => {
    setIsAnalyzingFile(true);
    try {
      const zipRes = await parseAndValidateZipArchive(file);
      setParsedZipArchive(zipRes);

      const totalProfit = zipRes.trades.reduce((acc, t) => acc + (t.netProfit || 0), 0);

      setValidationReport({
        isValid: zipRes.isValid,
        fileFormat: 'zip',
        fileName: file.name,
        fileSize: file.size,
        totalParsedTrades: zipRes.totalParsedTrades,
        validTradesCount: zipRes.validTradesCount,
        invalidTradesCount: zipRes.invalidTradesCount,
        hasSettings: Boolean(zipRes.settings),
        backupSettings: zipRes.settings,
        backupTrades: zipRes.trades,
        backupTotalProfit: totalProfit,
        errors: zipRes.errors,
        warnings: zipRes.warnings,
        archivedImagesCount: zipRes.archivedImagesCount,
        storageScreenshotsCount: zipRes.storageScreenshotsCount,
        base64ScreenshotsCount: zipRes.base64ScreenshotsCount,
        externalScreenshotsCount: zipRes.externalScreenshotsCount,
      });
    } catch (err: any) {
      setParsedZipArchive(null);
      setValidationReport({
        isValid: false,
        fileFormat: 'zip',
        fileName: file.name,
        fileSize: file.size,
        totalParsedTrades: 0,
        validTradesCount: 0,
        invalidTradesCount: 0,
        hasSettings: false,
        errors: [
          tr(
            `Arsip ZIP tidak valid: ${err.message || 'Format tidak dikenali'}`,
            `Invalid ZIP archive: ${err.message || 'Unrecognized format'}`
          ),
        ],
      });
    } finally {
      setIsAnalyzingFile(false);
    }
  };

  const validateSelectedJsonFile = (file: File) => {
    setParsedZipArchive(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const activeScope = currentUser?.id || 'GUEST';
        const restoreParsed = parseAndRestoreBackup(content, settings, activeScope);

        if (!restoreParsed.success || !restoreParsed.trades) {
          setValidationReport({
            isValid: false,
            fileFormat: 'json',
            fileName: file.name,
            fileSize: file.size,
            totalParsedTrades: 0,
            validTradesCount: 0,
            invalidTradesCount: 0,
            hasSettings: false,
            errors: [restoreParsed.message || tr('File JSON tidak valid.', 'Invalid JSON file.')],
          });
          return;
        }

        const validTrades = restoreParsed.trades;
        const totalProfit = validTrades.reduce((acc, t) => acc + (t.netProfit || 0), 0);

        setValidationReport({
          isValid: validTrades.length > 0,
          fileFormat: 'json',
          fileName: file.name,
          fileSize: file.size,
          totalParsedTrades: validTrades.length,
          validTradesCount: validTrades.length,
          invalidTradesCount: 0,
          hasSettings: Boolean(restoreParsed.settings),
          backupSettings: restoreParsed.settings,
          backupTrades: validTrades,
          backupTotalProfit: totalProfit,
          errors:
            validTrades.length === 0
              ? [tr('Tidak ada transaksi valid dalam file JSON.', 'No valid trades in JSON file.')]
              : [],
        });
      } catch (err: any) {
        setValidationReport({
          isValid: false,
          fileFormat: 'json',
          fileName: file.name,
          fileSize: file.size,
          totalParsedTrades: 0,
          validTradesCount: 0,
          invalidTradesCount: 0,
          hasSettings: false,
          errors: [tr(`Format JSON gagal dibaca: ${err.message}`, `Failed to read JSON: ${err.message}`)],
        });
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteRestore = async () => {
    if (isRestoringJson) return;
    if (!validationReport || !validationReport.isValid || !validationReport.backupTrades) {
      setErrorMessage(tr('Pilih file cadangan yang valid terlebih dahulu.', 'Select a valid backup file first.'));
      return;
    }

    if (importMode === 'replace' && !confirmOverwrite) {
      setErrorMessage(
        tr('Centang kotak konfirmasi sebelum mengganti seluruh data.', 'Check confirmation box before replacing all data.')
      );
      return;
    }

    if (validationReport.fileFormat === 'zip' && parsedZipArchive) {
      handleExecuteZipRestore(false);
    } else {
      setIsRestoringJson(true);
      setErrorMessage(null);
      try {
        await onRestoreSuccess(
          validationReport.backupTrades,
          validationReport.backupSettings,
          importMode,
          Boolean(currentUser && syncToCloud)
        );
        onClose();
      } catch (err: any) {
        setErrorMessage(err?.message || tr('Gagal memulihkan file JSON.', 'Failed to restore JSON file.'));
      } finally {
        setIsRestoringJson(false);
      }
    }
  };

  const handleExecuteZipRestore = async (allowPartialScreenshots = false) => {
    if (!parsedZipArchive || !validationReport?.backupTrades) return;

    const controller = new AbortController();
    restoreAbortControllerRef.current = controller;

    setRestoreZipPhase('uploading');
    setRestoreZipFailedItems([]);
    setErrorMessage(null);

    setRestoreZipProgress({
      phase: 'uploading_images',
      currentStep: 0,
      totalSteps: parsedZipArchive.archivedImagesCount,
      message: tr('Mengunggah gambar dan memulihkan data...', 'Uploading images and restoring data...'),
      percent: 5,
    });

    try {
      const res = await executeZipRestore({
        archive: parsedZipArchive,
        existingTrades: trades,
        currentUser: currentUser ? { id: currentUser.id, email: currentUser.email } : null,
        activeOwnerScope: currentUser?.id || 'GUEST',
        mode: importMode,
        syncToCloud: Boolean(currentUser && syncToCloud),
        uploadCache: uploadCacheRef.current,
        allowPartialScreenshots,
        onProgress: (p) => setRestoreZipProgress(p),
        abortSignal: controller.signal,
      });

      if (res.success) {
        setRestoreZipSuccessSummary(res);
        setRestoreZipPhase('completed');

        const saveRes = (await onRestoreSuccess(
          res.restoredTrades,
          res.restoredSettings,
          importMode,
          Boolean(currentUser && syncToCloud)
        )) as { success?: boolean; error?: string } | undefined;
        if (saveRes && saveRes.success === false) {
          setErrorMessage(
            saveRes.error ||
              tr('Gagal menyimpan hasil pemulihan ke browser.', 'Failed to save restored data locally.')
          );
        }
      } else {
        setRestoreZipFailedItems(res.failedScreenshots || []);
        setRestoreZipPhase('failed');
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        setRestoreZipPhase('idle');
        setRestoreZipProgress(null);
      } else {
        setRestoreZipFailedItems([
          {
            tradeId: 'GLOBAL',
            archivePath: tr('Arsip ZIP', 'ZIP Archive'),
            error: err.message || tr('Kesalahan sistem saat memulihkan arsip.', 'System error restoring archive.'),
          },
        ]);
        setRestoreZipPhase('failed');
      }
    } finally {
      restoreAbortControllerRef.current = null;
    }
  };

  const handleCancelRestore = () => {
    if (restoreAbortControllerRef.current) {
      restoreAbortControllerRef.current.abort();
    }
    setRestoreZipPhase('idle');
    setRestoreZipProgress(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={() => {
        if (!isBackupOrRestoreBusy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Cadangan & Pemulihan Data', 'Backup & Restore Data')}
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#526071] dark:text-[#929BA9] shrink-0">
              <Database className="h-4 w-4 stroke-[1.75]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Cadangan & Pemulihan Data', 'Backup & Restore Data')}
              </h3>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5">
                {tr('Ekspor atau pulihkan jurnal dalam format ZIP, JSON, atau CSV', 'Export or restore journal in ZIP, JSON, or CSV format')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isBackupOrRestoreBusy) onClose();
            }}
            disabled={isBackupOrRestoreBusy}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors disabled:opacity-50 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            aria-label={tr('Tutup menu cadangan data', 'Close data backup menu')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Segmented Tab Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
            <button
              type="button"
              onClick={() => setActiveTab('export')}
              className={`min-h-[34px] py-1.5 text-xs rounded-full transition-colors flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                activeTab === 'export'
                  ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
              }`}
            >
              <Download className="h-3.5 w-3.5 stroke-[1.75]" />
              <span>{tr('Ekspor Data', 'Export Data')}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('import')}
              className={`min-h-[34px] py-1.5 text-xs rounded-full transition-colors flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                activeTab === 'import'
                  ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
              }`}
            >
              <Upload className="h-3.5 w-3.5 stroke-[1.75]" />
              <span>{tr('Pulihkan Data', 'Restore Data')}</span>
            </button>
          </div>

          {/* ================================================================= */}
          {/* TAB 1: EXPORT                                                     */}
          {/* ================================================================= */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              {/* Format Selector */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  {
                    id: 'zip' as const,
                    icon: FileArchive,
                    title: 'ZIP',
                    desc: tr('Lengkap + gambar', 'Full + images'),
                  },
                  {
                    id: 'json' as const,
                    icon: FileJson,
                    title: 'JSON',
                    desc: tr('Data & pengaturan', 'Data & settings'),
                  },
                  {
                    id: 'csv' as const,
                    icon: FileSpreadsheet,
                    title: 'CSV',
                    desc: tr('Tabel spreadsheet', 'Spreadsheet table'),
                  },
                ].map((fmt) => {
                  const Icon = fmt.icon;
                  const active = exportFormat === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => {
                        setExportFormat(fmt.id);
                        setExportStatusMsg(null);
                        if (fmt.id === 'zip' && zipPhase === 'completed') handleResetZipState();
                      }}
                      className={`p-3 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                        active
                          ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#161A22]'
                          : 'border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0B0E13] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/70'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon
                          className={`h-3.5 w-3.5 stroke-[1.75] ${
                            active
                              ? 'text-[#0F172A] dark:text-white'
                              : 'text-[#526071] dark:text-[#929BA9]'
                          }`}
                        />
                        <span
                          className={`font-bold ${
                            active
                              ? 'text-[#0F172A] dark:text-white'
                              : 'text-[#0F172A] dark:text-[#F2F4F7]'
                          }`}
                        >
                          {fmt.title}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-1">
                        {fmt.desc}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Status Feedback */}
              {exportStatusMsg && (
                <div
                  className={`p-3 rounded-xl border bg-[#FAFAFA] dark:bg-[#0B0E13] border-[#E4E4E7] dark:border-[#20252D] text-xs flex items-center gap-2 ${
                    exportStatusMsg.type === 'success'
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : exportStatusMsg.type === 'error'
                      ? 'text-[#E11D48] dark:text-[#E05260]'
                      : 'text-[#526071] dark:text-[#929BA9]'
                  }`}
                >
                  {exportStatusMsg.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 stroke-[1.75]" />
                  ) : exportStatusMsg.type === 'error' ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
                  ) : (
                    <Info className="h-4 w-4 shrink-0 stroke-[1.75]" />
                  )}
                  <span>{exportStatusMsg.text}</span>
                </div>
              )}

              {/* FORMAT A: ZIP */}
              {exportFormat === 'zip' && (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] divide-y sm:divide-y-0 sm:divide-x divide-[#E4E4E7] dark:divide-[#20252D]">
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Transaksi', 'Trades')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                        {trades.length}
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Total Gambar', 'Total Images')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                        {screenshotStats.totalScreenshots}
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Cloud Storage', 'Cloud Storage')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                        {screenshotStats.storageCount}
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Lokal / Tautan', 'Local / Links')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                        {screenshotStats.base64Count + screenshotStats.externalCount}
                      </span>
                    </div>
                  </div>

                  {screenshotStats.storageCount > 0 && !currentUser?.id && (
                    <div className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] text-[#D97706] dark:text-[#F59E0B] flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 stroke-[1.75]" />
                      <span>
                        {tr(
                          `Masuk akun Supabase terlebih dahulu untuk mengunduh ${screenshotStats.storageCount} gambar storage privat.`,
                          `Sign in to Supabase first to download ${screenshotStats.storageCount} private storage images.`
                        )}
                      </span>
                    </div>
                  )}

                  {zipPhase === 'running' && (
                    <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#0F172A] dark:text-white flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin stroke-[1.75]" />
                          <span>{zipProgress?.message || tr('Membuat arsip...', 'Creating archive...')}</span>
                        </span>
                        <span className="font-mono-numbers tabular-nums font-bold text-[#0F172A] dark:text-white">
                          {zipProgress?.percent || 0}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white dark:bg-[#101318] overflow-hidden border border-[#E4E4E7] dark:border-[#20252D]">
                        <div
                          className="h-full bg-[#0F172A] dark:bg-white transition-all duration-200"
                          style={{ width: `${zipProgress?.percent || 0}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-[#526071] dark:text-[#929BA9]">
                        <span className="font-mono-numbers tabular-nums">
                          {zipProgress?.currentStep || 0} / {zipProgress?.totalSteps || 0}
                        </span>
                        <button
                          type="button"
                          onClick={handleCancelZipBackup}
                          className="text-[#E11D48] dark:text-[#E05260] hover:underline font-medium cursor-pointer"
                        >
                          {tr('Batalkan', 'Cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {zipPhase === 'completed' && zipResult && (
                    <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#059669] dark:text-[#00A878] flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 stroke-[1.75]" />
                          <span>{tr('Arsip ZIP Siap', 'ZIP Archive Ready')}</span>
                        </span>
                        {zipResult.blob && (
                          <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                            {(zipResult.blob.size / (1024 * 1024)).toFixed(2)} MB
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#526071] dark:text-[#929BA9] font-mono-numbers truncate">
                        {zipResult.fileName} · {zipResult.manifest.summary.archivedScreenshots}{' '}
                        {tr('gambar', 'images')}
                      </p>
                      <div className="flex items-center gap-2">
                        {zipResult.blob && zipResult.fileName && (
                          <button
                            type="button"
                            onClick={handleRedownloadZip}
                            disabled={isRedownloadingZip}
                            className="px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                          >
                            <Download className="h-3.5 w-3.5 stroke-[1.75]" />
                            <span>{isRedownloadingZip ? tr('Menyimpan...', 'Saving...') : tr('Unduh Ulang', 'Redownload')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleResetZipState}
                          disabled={isRedownloadingZip}
                          className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                        >
                          {tr('Selesai', 'Done')}
                        </button>
                      </div>
                    </div>
                  )}

                  {zipPhase === 'failed' && (
                    <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-3">
                      <div className="flex items-center gap-2 text-xs text-[#E11D48] dark:text-[#E05260] font-semibold">
                        <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
                        <span>
                          {tr(
                            `${zipFailedItems.length} gambar gagal diunduh`,
                            `${zipFailedItems.length} images failed to download`
                          )}
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-t border-b border-[#E4E4E7] dark:border-[#20252D] text-[11px]">
                        {zipFailedItems.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-2 py-2"
                          >
                            <span className="font-mono-numbers text-[#0F172A] dark:text-[#F2F4F7] truncate">
                              {item.tradeId} · {item.pathOrRef}
                            </span>
                            <span className="text-[10px] text-[#E11D48] dark:text-[#E05260] shrink-0">
                              {item.error}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleStartZipBackup(false)}
                          className="px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw className="h-3.5 w-3.5 stroke-[1.75]" />
                          <span>{tr('Coba Lagi', 'Retry')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartZipBackup(true)}
                          className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#D97706] dark:text-[#F59E0B] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <AlertCircle className="h-3.5 w-3.5 stroke-[1.75]" />
                          <span>{tr('Unduh Parsial', 'Partial Backup')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleResetZipState}
                          className="px-3.5 py-1.5 rounded-full text-xs text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer"
                        >
                          {tr('Batal', 'Cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {zipPhase === 'idle' && (
                    <div className="space-y-3">
                      <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                        {tr(
                          'Arsip ZIP berisi data transaksi, pengaturan, serta seluruh screenshot. Token login tidak disertakan.',
                          'ZIP archive includes trades, settings, and all screenshots. Login tokens are excluded.'
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleStartZipBackup(false)}
                        disabled={screenshotStats.storageCount > 0 && !currentUser?.id}
                        className="w-full min-h-[42px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] disabled:opacity-45 disabled:cursor-not-allowed font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                      >
                        <FileArchive className="h-4 w-4 stroke-[1.75]" />
                        <span>{tr('Unduh Arsip ZIP', 'Download ZIP Archive')}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* FORMAT B: JSON */}
              {exportFormat === 'json' && (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] divide-y sm:divide-y-0 sm:divide-x divide-[#E4E4E7] dark:divide-[#20252D]">
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Total', 'Total')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                        {trades.length}
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Asli', 'Real')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                        {trades.filter((t) => !t.isDemo).length}
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Demo', 'Demo')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#D97706] dark:text-[#F59E0B]">
                        {trades.filter((t) => t.isDemo).length}
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Mata Uang', 'Currency')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-[#0F172A] dark:text-[#F2F4F7]">
                        {settings.currency}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr(
                      'File JSON ringan mencakup riwayat transaksi, catatan, evaluasi, dan parameter akun.',
                      'Lightweight JSON includes trade history, notes, evaluations, and account settings.'
                    )}
                  </p>

                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    disabled={isExportingJson}
                    className="w-full min-h-[42px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] disabled:opacity-45 font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  >
                    <Download className="h-4 w-4 stroke-[1.75]" />
                    <span>
                      {isExportingJson
                        ? tr('Menyiapkan JSON...', 'Preparing JSON...')
                        : tr(`Unduh File JSON (${trades.length})`, `Download JSON (${trades.length})`)}
                    </span>
                  </button>
                </div>
              )}

              {/* FORMAT C: CSV */}
              {exportFormat === 'csv' && (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] divide-x divide-[#E4E4E7] dark:divide-[#20252D]">
                    <div className="px-3.5 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Baris Transaksi', 'Trade Rows')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                        {trades.length}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Kompatibilitas', 'Compatibility')}
                      </span>
                      <span className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                        Excel / Sheets
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr(
                      'Mengekspor daftar transaksi ke format tabel CSV standar tanpa gambar screenshot.',
                      'Exports trade list to standard CSV spreadsheet format without screenshots.'
                    )}
                  </p>

                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    disabled={isExportingCsv || trades.length === 0}
                    className="w-full min-h-[42px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] disabled:opacity-45 font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  >
                    <FileSpreadsheet className="h-4 w-4 stroke-[1.75]" />
                    <span>
                      {isExportingCsv
                        ? tr('Menyiapkan CSV...', 'Preparing CSV...')
                        : tr(`Unduh File CSV (${trades.length})`, `Download CSV (${trades.length})`)}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: IMPORT                                                     */}
          {/* ================================================================= */}
          {activeTab === 'import' && (
            <div className="space-y-4">
              {/* File Picker */}
              <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-dashed border-[#E4E4E7] dark:border-[#20252D] hover:border-[#0F172A] dark:hover:border-white transition-colors text-center">
                <input
                  type="file"
                  id="backup-file-input"
                  accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="backup-file-input"
                  className="cursor-pointer flex flex-col items-center justify-center gap-1.5"
                >
                  {isAnalyzingFile ? (
                    <Loader2 className="h-5 w-5 animate-spin text-[#0F172A] dark:text-white stroke-[1.75]" />
                  ) : (
                    <Upload className="h-5 w-5 text-[#0F172A] dark:text-white stroke-[1.75]" />
                  )}
                  <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {selectedFile
                      ? selectedFile.name
                      : tr('Pilih File Cadangan (.ZIP atau .JSON)', 'Select Backup File (.ZIP or .JSON)')}
                  </span>
                  <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Klik untuk memilih arsip dari perangkat', 'Click to browse archive from device')}
                  </span>
                </label>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs text-[#E11D48] dark:text-[#E05260] flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Restore ZIP Progress */}
              {restoreZipPhase === 'uploading' && (
                <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#0F172A] dark:text-white flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin stroke-[1.75]" />
                      <span>{restoreZipProgress?.message || tr('Memulihkan...', 'Restoring...')}</span>
                    </span>
                    <span className="font-mono-numbers tabular-nums font-bold text-[#0F172A] dark:text-white">
                      {restoreZipProgress?.percent || 0}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white dark:bg-[#101318] overflow-hidden border border-[#E4E4E7] dark:border-[#20252D]">
                    <div
                      className="h-full bg-[#0F172A] dark:bg-white transition-all duration-200"
                      style={{ width: `${restoreZipProgress?.percent || 0}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#526071] dark:text-[#929BA9]">
                    <span className="font-mono-numbers tabular-nums">
                      {restoreZipProgress?.currentStep || 0} / {restoreZipProgress?.totalSteps || 0}
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelRestore}
                      className="text-[#E11D48] dark:text-[#E05260] hover:underline font-medium cursor-pointer"
                    >
                      {tr('Batalkan', 'Cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Restore ZIP Completed */}
              {restoreZipPhase === 'completed' && restoreZipSuccessSummary && (
                <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-3">
                  <div className="flex items-center gap-2 text-xs text-[#059669] dark:text-[#00A878] font-semibold">
                    <CheckCircle2 className="h-4 w-4 stroke-[1.75]" />
                    <span>{tr('Pemulihan Arsip Selesai', 'Archive Restore Complete')}</span>
                  </div>

                  <div className="grid grid-cols-3 border-t border-b border-[#E4E4E7] dark:border-[#20252D] divide-x divide-[#E4E4E7] dark:divide-[#20252D] text-xs">
                    <div className="py-2.5 pr-3">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Dipulihkan', 'Restored')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                        {restoreZipSuccessSummary.restoredTrades.length}
                      </span>
                    </div>
                    <div className="py-2.5 px-3">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Gambar', 'Images')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                        {restoreZipSuccessSummary.uploadedScreenshotsCount}
                      </span>
                    </div>
                    <div className="py-2.5 pl-3">
                      <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                        {tr('Baru / Update', 'New / Updated')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                        +{restoreZipSuccessSummary.newTradesAdded} / {restoreZipSuccessSummary.duplicateTradesUpdated}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full min-h-[42px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] font-semibold text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  >
                    {tr('Selesai', 'Done')}
                  </button>
                </div>
              )}

              {/* Restore ZIP Failed */}
              {restoreZipPhase === 'failed' && (
                <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-3">
                  <div className="flex items-center gap-2 text-xs text-[#E11D48] dark:text-[#E05260] font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
                    <span>
                      {tr(
                        `${restoreZipFailedItems.length} gambar gagal diunggah`,
                        `${restoreZipFailedItems.length} images failed to upload`
                      )}
                    </span>
                  </div>
                  <div className="max-h-32 overflow-y-auto divide-y divide-[#E4E4E7] dark:divide-[#20252D] border-t border-b border-[#E4E4E7] dark:border-[#20252D] text-[11px]">
                    {restoreZipFailedItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 py-2"
                      >
                        <span className="font-mono-numbers text-[#0F172A] dark:text-[#F2F4F7] truncate">
                          {item.tradeId} · {item.archivePath}
                        </span>
                        <span className="text-[10px] text-[#E11D48] dark:text-[#E05260] shrink-0">
                          {item.error}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExecuteZipRestore(false)}
                      className="px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5 stroke-[1.75]" />
                      <span>{tr('Coba Lagi', 'Retry')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExecuteZipRestore(true)}
                      className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#D97706] dark:text-[#F59E0B] text-xs font-semibold cursor-pointer"
                    >
                      {tr('Lanjut Tanpa Gambar Gagal', 'Continue Without Failed Images')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestoreZipPhase('idle')}
                      className="px-3.5 py-1.5 rounded-full text-xs text-[#526071] dark:text-[#929BA9] cursor-pointer"
                    >
                      {tr('Batal', 'Cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Validation Report */}
              {validationReport && restoreZipPhase === 'idle' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`font-semibold flex items-center gap-1.5 ${
                          validationReport.isValid
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {validationReport.isValid ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 stroke-[1.75]" />
                            <span>{tr('File Terverifikasi', 'File Verified')}</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-4 w-4 stroke-[1.75]" />
                            <span>{tr('File Tidak Valid', 'Invalid File')}</span>
                          </>
                        )}
                      </span>
                      <span className="text-[11px] font-mono-numbers text-[#526071] dark:text-[#929BA9] truncate max-w-[180px]">
                        {validationReport.fileName}
                      </span>
                    </div>

                    {validationReport.isValid && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-[#E4E4E7] dark:border-[#20252D] pt-2.5 gap-y-2 sm:gap-y-0 sm:divide-x divide-[#E4E4E7] dark:divide-[#20252D]">
                        <div className="sm:pr-3">
                          <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                            {tr('Transaksi', 'Trades')}
                          </span>
                          <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                            {validationReport.validTradesCount}
                          </span>
                        </div>
                        <div className="sm:px-3">
                          <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                            Total P/L
                          </span>
                          <span
                            className={`text-sm font-bold font-mono-numbers tabular-nums ${
                              (validationReport.backupTotalProfit || 0) >= 0
                                ? 'text-[#059669] dark:text-[#00A878]'
                                : 'text-[#E11D48] dark:text-[#E05260]'
                            }`}
                          >
                            {formatCurrency(validationReport.backupTotalProfit || 0, settings)}
                          </span>
                        </div>
                        <div className="sm:px-3">
                          <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                            {tr('Pengaturan', 'Settings')}
                          </span>
                          <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block mt-0.5">
                            {validationReport.hasSettings ? tr('Tersedia', 'Included') : tr('Lokal', 'Keep')}
                          </span>
                        </div>
                        <div className="sm:pl-3">
                          <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block">
                            {validationReport.fileFormat === 'zip' ? tr('Gambar', 'Images') : tr('Format', 'Format')}
                          </span>
                          <span className="text-sm font-bold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                            {validationReport.fileFormat === 'zip'
                              ? validationReport.archivedImagesCount || 0
                              : 'JSON'}
                          </span>
                        </div>
                      </div>
                    )}

                    {validationReport.warnings && validationReport.warnings.length > 0 && (
                      <div className="text-[11px] text-[#D97706] dark:text-[#F59E0B] space-y-0.5">
                        {validationReport.warnings.map((warn, idx) => (
                          <p key={idx}>• {warn}</p>
                        ))}
                      </div>
                    )}

                    {validationReport.errors.length > 0 && (
                      <div className="text-[11px] text-[#E11D48] dark:text-[#E05260] space-y-0.5">
                        {validationReport.errors.map((err, idx) => (
                          <p key={idx}>• {err}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Restore Method */}
                  {validationReport.isValid && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setImportMode('merge')}
                          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                            importMode === 'merge'
                              ? 'border-[#0F172A] dark:border-white bg-[#F4F4F5] dark:bg-[#161A22]'
                              : 'border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0B0E13]'
                          }`}
                        >
                          <span
                            className={`font-bold block ${
                              importMode === 'merge'
                                ? 'text-[#0F172A] dark:text-white'
                                : 'text-[#0F172A] dark:text-[#F2F4F7]'
                            }`}
                          >
                            {tr('Gabungkan Data', 'Merge Data')}
                          </span>
                          <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                            {tr('Tambah baru & perbarui ID sama', 'Add new & update matching IDs')}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setImportMode('replace')}
                          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]/50 ${
                            importMode === 'replace'
                              ? 'border-[#E11D48] dark:border-[#E05260] bg-[#F4F4F5] dark:bg-[#161A22]'
                              : 'border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0B0E13]'
                          }`}
                        >
                          <span className="font-bold text-[#E11D48] dark:text-[#E05260] block">
                            {tr('Ganti Semua', 'Replace All')}
                          </span>
                          <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                            {tr('Timpa seluruh data saat ini', 'Overwrite all current trades')}
                          </span>
                        </button>
                      </div>

                      {importMode === 'merge' && mergeStats && (
                        <div className="px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] flex flex-wrap gap-3">
                          <span>
                            <strong className="text-[#059669] dark:text-[#00A878]">+{mergeStats.newItems}</strong>{' '}
                            {tr('baru', 'new')}
                          </span>
                          <span>
                            <strong className="text-[#0F172A] dark:text-white">{mergeStats.duplicates}</strong>{' '}
                            {tr('diperbarui', 'updated')}
                          </span>
                          <span>
                            <strong className="text-[#0F172A] dark:text-[#F2F4F7]">{mergeStats.unchanged}</strong>{' '}
                            {tr('tetap aman', 'kept')}
                          </span>
                        </div>
                      )}

                      {importMode === 'replace' && (
                        <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] cursor-pointer text-[11px] text-[#0F172A] dark:text-[#F2F4F7]">
                          <input
                            type="checkbox"
                            checked={confirmOverwrite}
                            onChange={(e) => setConfirmOverwrite(e.target.checked)}
                            className="mt-0.5 rounded border-[#E4E4E7] dark:border-[#20252D] accent-[#0F172A] dark:accent-white focus:ring-0"
                          />
                          <span>
                            {tr(
                              `Konfirmasi mengganti ${trades.length} transaksi saat ini dengan ${validationReport.validTradesCount} transaksi dari cadangan.`,
                              `Confirm replacing ${trades.length} current trades with ${validationReport.validTradesCount} backup trades.`
                            )}
                          </span>
                        </label>
                      )}

                      {currentUser && (
                        <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] cursor-pointer text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <Cloud className="h-4 w-4 text-[#0F172A] dark:text-white shrink-0 stroke-[1.75]" />
                            <div className="min-w-0">
                              <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                                {tr('Sinkronkan ke Cloud Supabase', 'Sync to Supabase Cloud')}
                              </span>
                              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] truncate block">
                                {currentUser.email || tr('Akun terhubung', 'Connected')}
                              </span>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={syncToCloud}
                            onChange={(e) => setSyncToCloud(e.target.checked)}
                            className="rounded border-[#E4E4E7] dark:border-[#20252D] accent-[#0F172A] dark:accent-white focus:ring-0 shrink-0"
                          />
                        </label>
                      )}

                      <button
                        type="button"
                        onClick={handleExecuteRestore}
                        disabled={(importMode === 'replace' && !confirmOverwrite) || isRestoringJson}
                        className="w-full min-h-[42px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] disabled:opacity-45 disabled:cursor-not-allowed font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                      >
                        <CheckCircle2 className="h-4 w-4 stroke-[1.75]" />
                        <span>
                          {isRestoringJson
                            ? tr('Memulihkan Data...', 'Restoring Data...')
                            : importMode === 'replace'
                            ? tr(`Ganti Semua (${validationReport.validTradesCount})`, `Replace All (${validationReport.validTradesCount})`)
                            : tr(`Gabungkan (${validationReport.validTradesCount})`, `Merge (${validationReport.validTradesCount})`)}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
