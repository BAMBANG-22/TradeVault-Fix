import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Download,
  Upload,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  X,
  FileSpreadsheet,
  ShieldAlert,
  ArrowRight,
  Database,
  Layers,
  Cloud,
  FileArchive,
  Image,
  Loader2,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Check,
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
  MAX_SAFE_TOTAL_SIZE_BYTES,
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

  // Restore ZIP Progress & Execution States (Tahap 2)
  const [restoreZipPhase, setRestoreZipPhase] = useState<'idle' | 'uploading' | 'completed' | 'failed'>('idle');
  const [restoreZipProgress, setRestoreZipProgress] = useState<RestoreZipProgress | null>(null);
  const [restoreZipFailedItems, setRestoreZipFailedItems] = useState<
    Array<{ tradeId: string; archivePath: string; error: string }>
  >([]);
  const [restoreZipSuccessSummary, setRestoreZipSuccessSummary] = useState<RestoreZipResult | null>(null);
  const restoreAbortControllerRef = useRef<AbortController | null>(null);

  // Upload cache: prevents re-uploading already succeeded files when user clicks Retry
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

  // Memoized screenshot breakdown for Export
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

  // Conflict preview for Merge Mode
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

  // Handle Standard JSON Export (Tahap 1 & Lama)
  const handleDownloadBackup = async () => {
    if (isExportingJson) return;
    setIsExportingJson(true);
    setExportStatusMsg(null);
    try {
      const exportReadyTrades = await prepareTradesForJsonBackup(trades, currentUser?.id || null);
      const jsonStr = generateBackupJson(exportReadyTrades, settings);
      const fileName = `TradeVault_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      const result = await exportFile({
        data: jsonStr,
        fileName,
        mimeType: 'application/json',
      });
      if (result.status === 'saved') {
        setExportStatusMsg({
          text: tr(
            `File cadangan JSON (${result.fileName}) berhasil disimpan.`,
            `JSON backup file (${result.fileName}) saved successfully.`
          ),
          type: 'success',
        });
      } else {
        setExportStatusMsg({
          text: tr(
            'Penyimpanan cadangan JSON dibatalkan oleh pengguna.',
            'JSON backup save cancelled by user.'
          ),
          type: 'info',
        });
      }
    } catch (err: any) {
      setExportStatusMsg({
        text: err?.message || tr('Gagal menyimpan file cadangan JSON.', 'Failed to save JSON backup file.'),
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
        text: tr('Belum ada transaksi untuk diekspor ke CSV.', 'No trades available to export to CSV.'),
        type: 'error',
      });
      return;
    }
    setIsExportingCsv(true);
    setExportStatusMsg(null);
    try {
      const csvStr = exportTradesToCsv(trades);
      const fileName = `TradeVault_Export_${new Date().toISOString().slice(0, 10)}.csv`;
      const res = await downloadCsvFile(csvStr, fileName);
      if (res.status === 'saved') {
        setExportStatusMsg({
          text: tr(`Berkas CSV (${fileName}) berhasil disimpan.`, `CSV file (${fileName}) saved successfully.`),
          type: 'success',
        });
      } else {
        setExportStatusMsg({
          text: tr('Penyimpanan berkas CSV dibatalkan oleh pengguna.', 'CSV file save cancelled by user.'),
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

  // Handle Full ZIP Backup Export (Tahap 1)
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
      message: tr('Mempersiapkan proses cadangan arsip...', 'Preparing archive backup process...'),
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
          message: tr('Menyimpan arsip ZIP ke perangkat...', 'Saving ZIP archive to device...'),
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
            text: tr(
              `Cadangan lengkap ZIP (${saveRes.fileName}) berhasil disimpan.`,
              `Full ZIP backup (${saveRes.fileName}) saved successfully.`
            ),
            type: 'success',
          });
        } else {
          setExportStatusMsg({
            text: tr(
              'Penyimpanan ZIP dibatalkan. Anda dapat menekan "Unduh Ulang ZIP" tanpa membuat ulang arsip.',
              'ZIP save cancelled. You can press "Redownload ZIP" without rebuilding the archive.'
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
        console.error('Error in zip backup:', err);
        setZipFailedItems([
          {
            tradeId: 'GLOBAL',
            sourceType: 'storage',
            pathOrRef: tr('Arsip Cadangan', 'Backup Archive'),
            error:
              err?.message ||
              tr('Gagal memproses atau menyimpan arsip ZIP.', 'Failed to process or save ZIP archive.'),
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
          text: tr(
            `Cadangan lengkap ZIP (${saveRes.fileName}) berhasil disimpan.`,
            `Full ZIP backup (${saveRes.fileName}) saved successfully.`
          ),
          type: 'success',
        });
      } else {
        setExportStatusMsg({
          text: tr('Penyimpanan ulang ZIP dibatalkan oleh pengguna.', 'ZIP redownload cancelled by user.'),
          type: 'info',
        });
      }
    } catch (err: any) {
      setExportStatusMsg({
        text: err?.message || tr('Gagal menyimpan ulang arsip ZIP.', 'Failed to redownload ZIP archive.'),
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

  // ==========================================================================
  // RESTORE / IMPORT LOGIC (Tahap 1 JSON & Tahap 2 ZIP)
  // ==========================================================================

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

  // Validate ZIP Archive (Tahap 2)
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
            `Gagal memvalidasi arsip ZIP: ${err.message || 'Format tidak dikenali'}`,
            `Failed to validate ZIP archive: ${err.message || 'Unrecognized format'}`
          ),
        ],
      });
    } finally {
      setIsAnalyzingFile(false);
    }
  };

  // Validate JSON File with Fail-Closed Sanitizer and Active Owner Scope
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
              ? [tr('Tidak ada transaksi yang valid dalam file JSON.', 'No valid trades found in JSON file.')]
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
          errors: [
            tr(
              `File tidak dapat dibaca sebagai format JSON valid: ${err.message}`,
              `File could not be read as valid JSON: ${err.message}`
            ),
          ],
        });
      }
    };
    reader.readAsText(file);
  };

  // Execute Restore: Branch to JSON or ZIP
  const handleExecuteRestore = async () => {
    if (isRestoringJson) return;
    if (!validationReport || !validationReport.isValid || !validationReport.backupTrades) {
      setErrorMessage(
        tr('Pilih berkas cadangan yang valid terlebih dahulu.', 'Please select a valid backup file first.')
      );
      return;
    }

    if (importMode === 'replace' && !confirmOverwrite) {
      setErrorMessage(
        tr(
          'Anda harus mencentang kotak konfirmasi sebelum menimpa seluruh data.',
          'You must check the confirmation box before overwriting all data.'
        )
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
        setErrorMessage(
          err?.message || tr('Gagal memulihkan file cadangan JSON.', 'Failed to restore JSON backup file.')
        );
      } finally {
        setIsRestoringJson(false);
      }
    }
  };

  // Execute ZIP Restore (Tahap 2)
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
      message: tr(
        'Mempersiapkan pengunggahan tangkapan layar dan pemulihan data...',
        'Preparing screenshot uploads and data restoration...'
      ),
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
              tr(
                'Gagal menyimpan data pemulihan ke penyimpanan lokal browser.',
                'Failed to save restored data to local browser storage.'
              )
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
        console.error('Error during zip restore:', err);
        setRestoreZipFailedItems([
          {
            tradeId: 'GLOBAL',
            archivePath: tr('Arsip ZIP', 'ZIP Archive'),
            error:
              err.message ||
              tr('Kesalahan sistem saat memulihkan arsip.', 'System error while restoring archive.'),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-[#151D2A] dark:text-[#F2F5F9]">
        {/* Close Button */}
        <button
          onClick={() => {
            if (!isBackupOrRestoreBusy) {
              onClose();
            }
          }}
          disabled={isBackupOrRestoreBusy}
          className="absolute right-4 top-4 p-1.5 rounded-lg text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] transition-colors disabled:opacity-50"
          aria-label={tr('Tutup menu cadangan data', 'Close data backup menu')}
        >
          <X className="h-5 w-5 stroke-[1.75]" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] flex items-center justify-center text-[#697586] dark:text-[#929BA9] shrink-0">
            <Database className="h-6 w-6 stroke-[1.75]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#151D2A] dark:text-[#F2F5F9]">
              {tr('Cadangan Data (Ekspor & Impor)', 'Data Backup (Export & Import)')}
            </h3>
            <p className="text-xs text-[#697586] dark:text-[#929BA9]">
              {tr(
                'Mendukung Cadangan Lengkap Arsip ZIP (Data & Tangkapan Layar) dan Cadangan Ringkas JSON',
                'Supports Full ZIP Archive Backup (Data & Screenshots) and Compact JSON Backup'
              )}
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] p-1 border border-[#DDE3EA] dark:border-[#252B34]">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'export'
                ? 'bg-[#1769E8] text-white font-bold'
                : 'text-[#697586] hover:text-[#151D2A] dark:text-[#929BA9] dark:hover:text-[#F2F5F9]'
            }`}
          >
            <Download className="h-4 w-4 stroke-[1.75]" />
            <span>{tr('Ekspor Cadangan', 'Export Backup')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'import'
                ? 'bg-[#1769E8] text-white font-bold'
                : 'text-[#697586] hover:text-[#151D2A] dark:text-[#929BA9] dark:hover:text-[#F2F5F9]'
            }`}
          >
            <Upload className="h-4 w-4 stroke-[1.75]" />
            <span>{tr('Impor Cadangan', 'Import Backup')}</span>
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: EXPORT (Tahap 1) */}
        {/* ================================================================= */}
        {activeTab === 'export' && (
          <div className="space-y-4">
            {/* Format Selection Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setExportFormat('zip');
                  if (zipPhase === 'completed') handleResetZipState();
                }}
                className={`p-3.5 rounded-xl border text-left transition-colors relative flex flex-col justify-between ${
                  exportFormat === 'zip'
                    ? 'bg-[#1769E8]/10 dark:bg-[#1769E8]/15 border-[#1769E8]'
                    : 'bg-[#F5F7FA] dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#252B34] hover:border-[#697586] text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9]">
                      <FileArchive className="h-4 w-4 stroke-[1.75]" />
                    </div>
                    <div>
                      <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9] block">
                        {tr('Cadangan Lengkap (ZIP)', 'Full Backup (ZIP)')}
                      </span>
                      <span className="text-[10px] text-[#1769E8] dark:text-[#60A5FA] font-medium">
                        {tr('Disarankan', 'Recommended')}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono-numbers px-1.5 py-0.5 rounded bg-[#1769E8]/15 text-[#1769E8] dark:text-[#60A5FA] border border-[#1769E8]/30">
                    {tr('Arsip', 'Archive')}
                  </span>
                </div>
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed mt-1">
                  {tr(
                    'Mencakup manifest.json, trades.json, serta folder screenshots/ dengan berkas gambar asli.',
                    'Includes manifest.json, trades.json, and the screenshots/ folder with original image files.'
                  )}
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setExportFormat('json');
                  setExportStatusMsg(null);
                }}
                className={`p-3.5 rounded-xl border text-left transition-colors flex flex-col justify-between ${
                  exportFormat === 'json'
                    ? 'bg-[#1769E8]/10 dark:bg-[#1769E8]/15 border-[#1769E8]'
                    : 'bg-[#F5F7FA] dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#252B34] hover:border-[#697586] text-[#697586] dark:text-[#929BA9]'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9]">
                      <FileJson className="h-4 w-4 stroke-[1.75]" />
                    </div>
                    <div>
                      <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9] block">
                        {tr('Cadangan Ringkas (JSON)', 'Compact Backup (JSON)')}
                      </span>
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9]">
                        {tr('Format Standar', 'Standard Format')}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed mt-1">
                  {tr(
                    'Berkas JSON ringan berisi seluruh riwayat transaksi dan pengaturan akun.',
                    'Lightweight JSON file containing all trade history and account settings.'
                  )}
                </p>
              </button>
            </div>

            {exportStatusMsg && (
              <div
                className={`p-3 rounded-xl border bg-[#F5F7FA] dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#252B34] text-xs flex items-center gap-2 ${
                  exportStatusMsg.type === 'success'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : exportStatusMsg.type === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-[#697586] dark:text-[#929BA9]'
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

            {/* FORMAT A: FULL ZIP BACKUP (TAHAP 1) */}
            {exportFormat === 'zip' && (
              <div className="space-y-3.5">
                <div className="rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] flex items-center gap-1.5">
                      <Image className="h-3.5 w-3.5 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
                      <span>{tr('Inventaris Tangkapan Layar & Gambar', 'Screenshot & Image Inventory')}</span>
                    </span>
                    <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                      {tr('Total', 'Total')}{' '}
                      <strong className="text-[#1769E8] dark:text-[#60A5FA]">{screenshotStats.totalScreenshots}</strong>{' '}
                      {tr('gambar ditemukan', 'images found')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Total Transaksi', 'Total Trades')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9]">
                        {trades.length}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Storage Privat', 'Private Storage')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-[#1769E8] dark:text-[#60A5FA]">
                        {screenshotStats.storageCount}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Base64 Lokal', 'Local Base64')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-emerald-600 dark:text-emerald-400">
                        {screenshotStats.base64Count}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Tautan Eksternal', 'External Links')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-amber-600 dark:text-amber-400">
                        {screenshotStats.externalCount}
                      </span>
                    </div>
                  </div>

                  {screenshotStats.storageCount > 0 && !currentUser?.id && (
                    <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[11px] text-[#151D2A] dark:text-[#F2F5F9] flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400 stroke-[1.75]" />
                      <div>
                        <strong className="text-amber-600 dark:text-amber-400">
                          {tr('Perhatian Autentikasi:', 'Authentication Notice:')}
                        </strong>{' '}
                        {tr(
                          `Terdapat ${screenshotStats.storageCount} gambar tersimpan di Supabase Storage privat. Anda belum masuk akun. Silakan masuk ke akun Supabase terlebih dahulu agar sistem memiliki izin mengunduh berkas gambar tersebut.`,
                          `There are ${screenshotStats.storageCount} images stored in private Supabase Storage. You are not signed in. Please sign in to your Supabase account first so the system has permission to download those image files.`
                        )}
                      </div>
                    </div>
                  )}

                  {screenshotStats.totalScreenshots > 80 && (
                    <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[10px] text-[#697586] dark:text-[#929BA9]">
                      {tr(
                        `Terdapat ${screenshotStats.totalScreenshots} gambar. Pengunduhan dan kompresi akan diproses secara bertahap agar konsumsi memori browser tetap stabil.`,
                        `There are ${screenshotStats.totalScreenshots} images. Downloading and compression will be processed in batches to keep browser memory usage stable.`
                      )}
                    </div>
                  )}
                </div>

                {/* State: RUNNING PROGRESS */}
                {zipPhase === 'running' && (
                  <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#1769E8] dark:text-[#60A5FA] flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-[#1769E8] stroke-[1.75]" />
                        <span>
                          {zipProgress?.message ||
                            tr('Membuat arsip cadangan...', 'Building backup archive...')}
                        </span>
                      </span>
                      <span className="font-mono-numbers font-bold text-[#1769E8] dark:text-[#60A5FA]">
                        {zipProgress?.percent || 0}%
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-white dark:bg-[#11151B] overflow-hidden border border-[#DDE3EA] dark:border-[#252B34]">
                      <div
                        className="h-full bg-[#1769E8] transition-all duration-200"
                        style={{ width: `${zipProgress?.percent || 0}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#697586] dark:text-[#929BA9] pt-1">
                      <span>
                        {tr(
                          `Langkah ${zipProgress?.currentStep || 0} dari ${zipProgress?.totalSteps || 0}`,
                          `Step ${zipProgress?.currentStep || 0} of ${zipProgress?.totalSteps || 0}`
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelZipBackup}
                        className="text-rose-600 dark:text-rose-400 hover:underline font-medium"
                      >
                        {tr('Batalkan', 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* State: COMPLETED SUCCESS */}
                {zipPhase === 'completed' && zipResult && (
                  <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                    <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                      <span>{tr('Cadangan Lengkap ZIP Siap!', 'Full ZIP Backup Ready!')}</span>
                    </div>
                    <div className="text-[11px] text-[#151D2A] dark:text-[#F2F5F9] space-y-1">
                      <p>
                        {tr('Berkas arsip:', 'Archive file:')}{' '}
                        <strong className="font-mono-numbers text-[#1769E8] dark:text-[#60A5FA]">
                          {zipResult.fileName}
                        </strong>
                      </p>
                      <p>
                        {tr(
                          `Total ${zipResult.manifest.summary.archivedScreenshots} berkas gambar berhasil dikemas ke dalam folder screenshots/ tanpa kegagalan.`,
                          `A total of ${zipResult.manifest.summary.archivedScreenshots} image files were packaged into the screenshots/ folder without errors.`
                        )}
                      </p>
                      {zipResult.blob && (
                        <p className="text-[#697586] dark:text-[#929BA9] text-[10px]">
                          {tr('Ukuran berkas ZIP:', 'ZIP file size:')}{' '}
                          {(zipResult.blob.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {zipResult.blob && zipResult.fileName && (
                        <button
                          type="button"
                          onClick={handleRedownloadZip}
                          disabled={isRedownloadingZip}
                          className="py-2 px-3 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5 stroke-[1.75]" />
                          <span>
                            {isRedownloadingZip
                              ? tr('Menyimpan ZIP...', 'Saving ZIP...')
                              : tr('Unduh Ulang ZIP', 'Redownload ZIP')}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleResetZipState}
                        disabled={isRedownloadingZip}
                        className="py-2 px-3 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] disabled:opacity-50 text-[#151D2A] dark:text-[#F2F5F9] text-xs transition-colors"
                      >
                        {tr('Selesai', 'Done')}
                      </button>
                    </div>
                  </div>
                )}

                {/* State: FAILED DOWNLOADS */}
                {zipPhase === 'failed' && (
                  <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                    <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 font-bold">
                      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 stroke-[1.75]" />
                      <span>
                        {tr('Cadangan Lengkap Belum Berhasil Dibuat', 'Full Backup Could Not Be Completed')}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
                      {tr(
                        `Terdapat ${zipFailedItems.length} berkas tangkapan layar yang gagal diunduh dari Supabase Storage. Sistem menolak membuang gambar secara diam-diam demi menjaga kelengkapan catatan transaksi Anda.`,
                        `There were ${zipFailedItems.length} screenshot files that failed to download from Supabase Storage. The system refuses to silently drop images to preserve your trade records.`
                      )}
                    </p>

                    <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 rounded-lg bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-[11px]">
                      {zipFailedItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-start justify-between gap-2 p-1.5 rounded bg-[#F5F7FA] dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]"
                        >
                          <div className="truncate">
                            <span className="font-mono-numbers text-[#1769E8] dark:text-[#60A5FA] font-semibold">
                              {item.tradeId}
                            </span>
                            <span className="text-[#697586] dark:text-[#929BA9] text-[10px] block truncate">
                              {item.pathOrRef}
                            </span>
                          </div>
                          <span className="text-[10px] text-rose-600 dark:text-rose-400 shrink-0 font-medium">
                            {item.error}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleStartZipBackup(false)}
                        className="py-2 px-3.5 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] text-white font-bold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <RefreshCw className="h-3.5 w-3.5 stroke-[1.75]" />
                        <span>{tr('Coba Lagi', 'Retry')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStartZipBackup(true)}
                        className="py-2 px-3.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 stroke-[1.75]" />
                        <span>{tr('Unduh Sebagai Cadangan Parsial', 'Download as Partial Backup')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleResetZipState}
                        className="py-2 px-3 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] text-xs transition-colors"
                      >
                        {tr('Batalkan', 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* State: IDLE */}
                {zipPhase === 'idle' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-[11px] text-[#697586] dark:text-[#929BA9] space-y-1">
                      <p className="flex items-center gap-1.5 text-[#151D2A] dark:text-[#F2F5F9] font-medium">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                        <span>{tr('Prinsip Keamanan Ekspor Cadangan:', 'Backup Export Security Principles:')}</span>
                      </p>
                      <p>
                        •{' '}
                        {tr(
                          'Berkas tangkapan layar dari bucket privat diunduh menggunakan sesi login Supabase Anda secara terautentikasi.',
                          'Screenshot files from private buckets are downloaded securely using your authenticated Supabase session.'
                        )}
                      </p>
                      <p>
                        •{' '}
                        {tr(
                          'Path folder dan ID rahasia internal disanitasi menjadi nama berkas aman di dalam arsip ZIP.',
                          'Folder paths and internal IDs are sanitized into safe filenames inside the ZIP archive.'
                        )}
                      </p>
                      <p>
                        •{' '}
                        {tr(
                          'Token autentikasi maupun kredensial sensitif tidak pernah disertakan ke dalam berkas arsip.',
                          'Authentication tokens and sensitive credentials are never included in the archive file.'
                        )}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleStartZipBackup(false)}
                      disabled={screenshotStats.storageCount > 0 && !currentUser?.id}
                      className="w-full py-3 px-4 rounded-xl bg-[#1769E8] hover:bg-[#1458C4] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors flex items-center justify-center gap-2"
                    >
                      <FileArchive className="h-4 w-4 stroke-[1.75]" />
                      <span>
                        {tr(
                          `Mulai Buat Cadangan ZIP Lengkap (${trades.length} Transaksi & ${screenshotStats.totalScreenshots} Gambar)`,
                          `Create Full ZIP Backup (${trades.length} Trades & ${screenshotStats.totalScreenshots} Screenshots)`
                        )}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* FORMAT B: STANDARD JSON BACKUP (PRESERVED 100%) */}
            {exportFormat === 'json' && (
              <div className="space-y-3">
                <div className="rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] p-4 space-y-3">
                  <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                    {tr('Ringkasan Data yang Akan Diekspor (JSON):', 'Summary of Data to Export (JSON):')}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Total Transaksi', 'Total Trades')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-[#1769E8] dark:text-[#60A5FA]">
                        {trades.length}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Transaksi Asli', 'Real Trades')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-emerald-600 dark:text-emerald-400">
                        {trades.filter((t) => !t.isDemo).length}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Transaksi Demo', 'Demo Trades')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-amber-600 dark:text-amber-400">
                        {trades.filter((t) => t.isDemo).length}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                      <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                        {tr('Mata Uang', 'Currency')}
                      </span>
                      <span className="text-sm font-bold font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9]">
                        {settings.currency} ({settings.currencySymbol})
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[11px] text-[#697586] dark:text-[#929BA9] space-y-1">
                    <p>
                      •{' '}
                      {tr(
                        'Berkas JSON mencakup seluruh riwayat transaksi, evaluasi psikologi, catatan eksekusi, tangkapan layar lokal, serta parameter akun.',
                        'The JSON file includes all trade history, psychology evaluations, execution notes, local screenshots, and account parameters.'
                      )}
                    </p>
                    <p>
                      •{' '}
                      {tr(
                        'Berkas ini dapat disimpan di perangkat, penyimpanan cloud pribadi, atau dipindahkan ke ponsel/laptop lain.',
                        'This file can be saved on your device, personal cloud storage, or transferred to another phone/laptop.'
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  disabled={isExportingJson}
                  className="w-full py-3 px-4 rounded-xl bg-[#1769E8] hover:bg-[#1458C4] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors flex items-center justify-center gap-2"
                >
                  <Download className="h-4 w-4 stroke-[1.75]" />
                  <span>
                    {isExportingJson
                      ? tr('Menyiapkan Cadangan JSON & Gambar...', 'Preparing JSON Backup & Screenshots...')
                      : tr(
                          `Unduh Berkas Cadangan JSON (${trades.length} Transaksi)`,
                          `Download JSON Backup File (${trades.length} Trades)`
                        )}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: IMPORT WITH DUAL-FORMAT (JSON & ZIP - Tahap 2) */}
        {/* ================================================================= */}
        {activeTab === 'import' && (
          <div className="space-y-4">
            {/* File Picker Box */}
            <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-dashed border-[#DDE3EA] dark:border-[#252B34] hover:border-[#1769E8] transition-colors text-center space-y-2">
              <input
                type="file"
                id="backup-file-input"
                accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="backup-file-input"
                className="cursor-pointer flex flex-col items-center justify-center gap-2"
              >
                <div className="h-10 w-10 rounded-xl bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] flex items-center justify-center text-[#1769E8] dark:text-[#60A5FA]">
                  {isAnalyzingFile ? (
                    <Loader2 className="h-5 w-5 animate-spin stroke-[1.75]" />
                  ) : (
                    <Upload className="h-5 w-5 stroke-[1.75]" />
                  )}
                </div>
                <div className="text-xs">
                  <span className="font-semibold text-[#1769E8] dark:text-[#60A5FA] hover:underline">
                    {tr('Pilih Berkas Cadangan (.ZIP atau .JSON)', 'Select Backup File (.ZIP or .JSON)')}
                  </span>{' '}
                  <span className="text-[#697586] dark:text-[#929BA9]">
                    {tr('atau tarik berkas ke sini', 'or drag file here')}
                  </span>
                </div>
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    'Mendukung arsip lengkap .zip atau berkas ringkas .json',
                    'Supports full .zip archives or compact .json files'
                  )}
                </span>
              </label>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* In-Progress ZIP Restore UI */}
            {restoreZipPhase === 'uploading' && (
              <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#1769E8] dark:text-[#60A5FA] flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[#1769E8] stroke-[1.75]" />
                    <span>
                      {restoreZipProgress?.message ||
                        tr('Memulihkan data dan tangkapan layar...', 'Restoring data and screenshots...')}
                    </span>
                  </span>
                  <span className="font-mono-numbers font-bold text-[#1769E8] dark:text-[#60A5FA]">
                    {restoreZipProgress?.percent || 0}%
                  </span>
                </div>

                <div className="w-full h-2 rounded-full bg-white dark:bg-[#11151B] overflow-hidden border border-[#DDE3EA] dark:border-[#252B34]">
                  <div
                    className="h-full bg-[#1769E8] transition-all duration-200"
                    style={{ width: `${restoreZipProgress?.percent || 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#697586] dark:text-[#929BA9] pt-1">
                  <span>
                    {tr(
                      `Proses ${restoreZipProgress?.currentStep || 0} dari ${restoreZipProgress?.totalSteps || 0}`,
                      `Step ${restoreZipProgress?.currentStep || 0} of ${restoreZipProgress?.totalSteps || 0}`
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={handleCancelRestore}
                    className="text-rose-600 dark:text-rose-400 hover:underline font-medium"
                  >
                    {tr('Batalkan Pemulihan', 'Cancel Restore')}
                  </button>
                </div>
              </div>
            )}

            {/* Succeeded ZIP Restore Summary */}
            {restoreZipPhase === 'completed' && restoreZipSuccessSummary && (
              <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                  <span>{tr('Pemulihan Arsip ZIP Selesai!', 'ZIP Archive Restore Completed!')}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                    <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                      {tr('Total Dipulihkan', 'Total Restored')}
                    </span>
                    <span className="text-sm font-bold font-mono-numbers text-[#1769E8] dark:text-[#60A5FA]">
                      {restoreZipSuccessSummary.restoredTrades.length} {tr('Transaksi', 'Trades')}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                    <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                      {tr('Gambar Diunggah', 'Screenshots Uploaded')}
                    </span>
                    <span className="text-sm font-bold font-mono-numbers text-emerald-600 dark:text-emerald-400">
                      {restoreZipSuccessSummary.uploadedScreenshotsCount} {tr('Berkas', 'Files')}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                    <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                      {tr('Baru / Diperbarui', 'New / Updated')}
                    </span>
                    <span className="text-sm font-bold font-mono-numbers text-[#151D2A] dark:text-[#F2F5F9]">
                      +{restoreZipSuccessSummary.newTradesAdded} / ↻{restoreZipSuccessSummary.duplicateTradesUpdated}
                    </span>
                  </div>
                </div>

                {restoreZipSuccessSummary.unchangedTradesKept > 0 && (
                  <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                    •{' '}
                    {tr(
                      `${restoreZipSuccessSummary.unchangedTradesKept} transaksi lokal Anda yang tidak ada dalam arsip tetap dipertahankan.`,
                      `${restoreZipSuccessSummary.unchangedTradesKept} of your local trades not in the archive were kept intact.`
                    )}
                  </p>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#1769E8] hover:bg-[#1458C4] text-white font-bold text-xs transition-colors"
                >
                  {tr('Selesai & Tutup Jendela', 'Done & Close Window')}
                </button>
              </div>
            )}

            {/* Failed Screenshot Uploads in ZIP Restore */}
            {restoreZipPhase === 'failed' && (
              <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 font-bold">
                  <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 stroke-[1.75]" />
                  <span>
                    {tr(
                      'Pemulihan Arsip Belum Berhasil Sempurna',
                      'Archive Restore Could Not Complete Fully'
                    )}
                  </span>
                </div>

                <p className="text-[11px] text-[#697586] dark:text-[#929BA9] leading-relaxed">
                  {tr(
                    `Terdapat ${restoreZipFailedItems.length} berkas tangkapan layar yang gagal diunggah ke Supabase Storage. Sistem tidak membuang data transaksi atau membiarkan path rusak tanpa persetujuan Anda.`,
                    `There were ${restoreZipFailedItems.length} screenshot files that failed to upload to Supabase Storage. The system does not discard trade data or leave broken paths without your confirmation.`
                  )}
                </p>

                <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 rounded-lg bg-white dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-[11px]">
                  {restoreZipFailedItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-2 p-1.5 rounded bg-[#F5F7FA] dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]"
                    >
                      <div className="truncate">
                        <span className="font-mono-numbers text-[#1769E8] dark:text-[#60A5FA] font-semibold">
                          {item.tradeId}
                        </span>
                        <span className="text-[#697586] dark:text-[#929BA9] text-[10px] block truncate">
                          {item.archivePath}
                        </span>
                      </div>
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 shrink-0 font-medium">
                        {item.error}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleExecuteZipRestore(false)}
                    className="py-2 px-3.5 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] text-white font-bold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5 stroke-[1.75]" />
                    <span>{tr('Coba Lagi Gambar yang Gagal', 'Retry Failed Screenshots')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExecuteZipRestore(true)}
                    className="py-2 px-3.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 stroke-[1.75]" />
                    <span>{tr('Lanjutkan Tanpa Gambar yang Gagal', 'Continue Without Failed Images')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRestoreZipPhase('idle')}
                    className="py-2 px-3 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] text-xs transition-colors"
                  >
                    {tr('Batalkan', 'Cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* Validation Report & Preview */}
            {validationReport && restoreZipPhase === 'idle' && (
              <div className="space-y-3">
                <div className="p-4 rounded-xl border bg-[#F5F7FA] dark:bg-[#080A0E] border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] flex items-center gap-1.5">
                      {validationReport.isValid ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {validationReport.fileFormat === 'zip'
                              ? tr('Arsip ZIP Valid & Terverifikasi', 'Valid & Verified ZIP Archive')
                              : tr('Berkas JSON Valid & Terverifikasi', 'Valid & Verified JSON File')}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 stroke-[1.75]" />
                          <span className="text-rose-600 dark:text-rose-400">
                            {tr('Berkas Cadangan Tidak Memenuhi Syarat', 'Backup File Does Not Meet Requirements')}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="text-[11px] font-mono-numbers px-2 py-0.5 rounded bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] truncate max-w-[180px]">
                      {validationReport.fileName}
                    </span>
                  </div>

                  {/* Valid stats preview */}
                  {validationReport.isValid && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                      <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                          {tr('Transaksi Valid', 'Valid Trades')}
                        </span>
                        <span className="text-sm font-bold font-mono-numbers text-[#1769E8] dark:text-[#60A5FA]">
                          {validationReport.validTradesCount} {tr('Transaksi', 'Trades')}
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                          {tr('Total P/L', 'Total P/L')}
                        </span>
                        <span
                          className={`text-sm font-bold font-mono-numbers ${
                            (validationReport.backupTotalProfit || 0) >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatCurrency(validationReport.backupTotalProfit || 0, settings)}
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                          {tr('Pengaturan', 'Settings')}
                        </span>
                        <span className="text-sm font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                          {validationReport.hasSettings
                            ? tr('Tersedia', 'Included')
                            : tr('Pakai Saat Ini', 'Keep Current')}
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34]">
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] block">
                          {validationReport.fileFormat === 'zip'
                            ? tr('Gambar ZIP', 'ZIP Images')
                            : tr('Format', 'Format')}
                        </span>
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono-numbers">
                          {validationReport.fileFormat === 'zip'
                            ? `${validationReport.archivedImagesCount || 0} ${tr('Berkas', 'Files')}`
                            : tr('JSON Teks', 'Text JSON')}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Warnings if any */}
                  {validationReport.warnings && validationReport.warnings.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[11px] text-[#151D2A] dark:text-[#F2F5F9] space-y-1">
                      <span className="font-semibold block flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 stroke-[1.75]" />
                        <span>{tr('Catatan Arsip:', 'Archive Notes:')}</span>
                      </span>
                      {validationReport.warnings.map((warn, idx) => (
                        <p key={idx} className="text-[10px] text-[#697586] dark:text-[#929BA9]">
                          • {warn}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Errors listing if any */}
                  {validationReport.errors.length > 0 && (
                    <div className="p-3 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-xs text-rose-600 dark:text-rose-400 space-y-1">
                      <span className="font-semibold block">
                        {tr('Catatan Validasi:', 'Validation Notes:')}
                      </span>
                      {validationReport.errors.map((err, idx) => (
                        <p key={idx} className="text-[11px]">
                          • {err}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Import Mode Selection */}
                {validationReport.isValid && (
                  <div className="p-4 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-3">
                    <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                      {tr('Pilih Metode Pemulihan:', 'Select Restore Method:')}
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {/* MERGE OPTION */}
                      <label
                        className={`p-3 rounded-xl border cursor-pointer transition-colors flex flex-col justify-between ${
                          importMode === 'merge'
                            ? 'bg-[#1769E8]/10 dark:bg-[#1769E8]/15 border-[#1769E8] text-[#151D2A] dark:text-[#F2F5F9]'
                            : 'bg-white dark:bg-[#11151B] border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="radio"
                            name="importMode"
                            checked={importMode === 'merge'}
                            onChange={() => setImportMode('merge')}
                            className="text-[#1769E8]"
                          />
                          <span className="font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                            {tr('Gabungkan Data', 'Merge Data')}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] leading-tight">
                          {tr(
                            'Menambahkan transaksi dari cadangan tanpa menghapus data yang ada. Jika ada ID yang sama, data diperbarui.',
                            'Adds trades from backup without deleting existing records. Matching IDs will be updated.'
                          )}
                        </span>
                      </label>

                      {/* REPLACE OPTION */}
                      <label
                        className={`p-3 rounded-xl border cursor-pointer transition-colors flex flex-col justify-between ${
                          importMode === 'replace'
                            ? 'bg-white dark:bg-[#171D26] border-[#1769E8] text-[#151D2A] dark:text-[#F2F5F9]'
                            : 'bg-white dark:bg-[#11151B] border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="radio"
                            name="importMode"
                            checked={importMode === 'replace'}
                            onChange={() => setImportMode('replace')}
                            className="text-[#1769E8]"
                          />
                          <span className="font-bold text-rose-600 dark:text-rose-400">
                            {tr('Ganti Seluruh Data', 'Replace All Data')}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#697586] dark:text-[#929BA9] leading-tight">
                          {tr(
                            'Mengganti seluruh transaksi di browser lokal dengan data cadangan ini.',
                            'Replaces all trades in your local browser with this backup dataset.'
                          )}
                        </span>
                      </label>
                    </div>

                    {/* Conflict Explanation Details for Merge */}
                    {importMode === 'merge' && mergeStats && (
                      <div className="p-3 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] text-[11px] text-[#697586] dark:text-[#929BA9] space-y-1">
                        <span className="font-semibold block text-[#151D2A] dark:text-[#F2F5F9]">
                          {tr('Rincian Penggabungan Data:', 'Merge Breakdown:')}
                        </span>
                        <p>
                          •{' '}
                          <strong className="text-[#151D2A] dark:text-[#F2F5F9]">{mergeStats.newItems}</strong>{' '}
                          {tr(
                            'transaksi baru akan ditambahkan ke riwayat Anda.',
                            'new trades will be added to your history.'
                          )}
                        </p>
                        {mergeStats.duplicates > 0 && (
                          <p>
                            •{' '}
                            <strong className="text-[#151D2A] dark:text-[#F2F5F9]">{mergeStats.duplicates}</strong>{' '}
                            {tr(
                              'transaksi yang sudah ada (ID cocok) akan diperbarui nilainya dari cadangan.',
                              'existing trades (matching IDs) will be updated from the backup.'
                            )}
                          </p>
                        )}
                        <p>
                          •{' '}
                          <strong className="text-[#151D2A] dark:text-[#F2F5F9]">{mergeStats.unchanged}</strong>{' '}
                          {tr(
                            'transaksi lama di browser Anda yang tidak ada dalam cadangan tetap aman dan utuh.',
                            'existing trades in your browser not in the backup will remain safe and intact.'
                          )}
                        </p>
                      </div>
                    )}

                    {/* Explicit Confirmation Checkbox for Overwrite */}
                    {importMode === 'replace' && (
                      <div className="p-3 rounded-lg bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] space-y-2">
                        <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#151D2A] dark:text-[#F2F5F9]">
                          <input
                            type="checkbox"
                            checked={confirmOverwrite}
                            onChange={(e) => setConfirmOverwrite(e.target.checked)}
                            className="mt-0.5 rounded border-[#DDE3EA] dark:border-[#252B34] text-[#1769E8] focus:ring-0"
                          />
                          <span className="text-[11px] leading-relaxed">
                            <strong className="text-amber-600 dark:text-amber-400">
                              {tr('Konfirmasi Penggantian:', 'Replacement Confirmation:')}
                            </strong>{' '}
                            {tr(
                              `Saya memahami bahwa ${trades.length} transaksi yang ada saat ini di browser akan digantikan seluruhnya oleh ${validationReport.validTradesCount} transaksi dari berkas cadangan ini.`,
                              `I understand that all ${trades.length} existing trades in the browser will be completely replaced by ${validationReport.validTradesCount} trades from this backup file.`
                            )}
                          </span>
                        </label>
                        <p className="text-[10px] text-[#697586] dark:text-[#929BA9] pl-6 leading-tight">
                          {tr(
                            'Pemberitahuan Cloud: Penggantian ini hanya berlaku untuk tampilan dan cache browser lokal Anda kecuali sinkronisasi cloud diaktifkan.',
                            'Cloud Notice: This replacement applies to your local browser cache unless cloud sync is enabled.'
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Cloud Sync Option when authenticated */}
                {validationReport.isValid && currentUser && (
                  <div className="p-3.5 rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] flex items-center gap-1.5">
                        <Cloud className="h-3.5 w-3.5 text-[#1769E8] dark:text-[#60A5FA] stroke-[1.75]" />
                        <span>{tr('Sinkronisasi Cloud Supabase', 'Supabase Cloud Sync')}</span>
                      </span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium px-2 py-0.5 rounded bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] truncate max-w-[200px]">
                        {currentUser.email || tr('Akun Terhubung', 'Connected Account')}
                      </span>
                    </div>
                    <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#151D2A] dark:text-[#F2F5F9]">
                      <input
                        type="checkbox"
                        checked={syncToCloud}
                        onChange={(e) => setSyncToCloud(e.target.checked)}
                        className="mt-0.5 rounded border-[#DDE3EA] dark:border-[#252B34] text-[#1769E8] focus:ring-0"
                      />
                      <div className="text-[11px] leading-relaxed">
                        <span className="font-semibold text-[#151D2A] dark:text-[#F2F5F9]">
                          {tr(
                            'Unggah & sinkronkan langsung ke database Supabase setelah pemulihan',
                            'Upload & sync directly to Supabase database after restore'
                          )}
                        </span>
                        <p className="text-[10px] text-[#697586] dark:text-[#929BA9] mt-0.5">
                          {syncToCloud
                            ? validationReport.fileFormat === 'zip'
                              ? tr(
                                  'Transaksi baru disimpan, tangkapan layar diunggah ke folder Storage Anda, dan transaksi yang ada diperbarui secara aman.',
                                  'New trades are saved, screenshots are uploaded to your Storage folder, and existing trades are safely updated.'
                                )
                              : tr(
                                  'Transaksi baru akan disimpan dan transaksi yang sudah ada diperbarui secara aman tanpa duplikasi.',
                                  'New trades will be saved and existing trades safely updated without duplication.'
                                )
                            : tr(
                                'Peringatan: Jika tidak dicentang, data hanya dimuat ke browser dan BELUM tersimpan di server cloud Supabase.',
                                'Warning: If unchecked, data is only loaded into the browser and NOT YET saved to the Supabase cloud server.'
                              )}
                        </p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Confirm Action Button */}
                {validationReport.isValid && (
                  <button
                    type="button"
                    onClick={handleExecuteRestore}
                    disabled={(importMode === 'replace' && !confirmOverwrite) || isRestoringJson}
                    className="w-full py-3 px-4 rounded-xl bg-[#1769E8] hover:bg-[#1458C4] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4 stroke-[1.75]" />
                    <span>
                      {isRestoringJson
                        ? tr(
                            'Memulihkan & Menyinkronkan Gambar ke Cloud...',
                            'Restoring & Syncing Screenshots to Cloud...'
                          )
                        : importMode === 'replace'
                        ? tr(
                            `Ganti Seluruh Data (${validationReport.validTradesCount} Transaksi)${
                              currentUser && syncToCloud ? ' & Simpan ke Cloud' : ''
                            }`,
                            `Replace All Data (${validationReport.validTradesCount} Trades)${
                              currentUser && syncToCloud ? ' & Save to Cloud' : ''
                            }`
                          )
                        : tr(
                            `Gabungkan ${validationReport.validTradesCount} Transaksi${
                              currentUser && syncToCloud ? ' & Simpan ke Cloud' : ''
                            }`,
                            `Merge ${validationReport.validTradesCount} Trades${
                              currentUser && syncToCloud ? ' & Save to Cloud' : ''
                            }`
                          )}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
