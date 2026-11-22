import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Trade, TradeCloseType, TradingSession } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import { useLanguage } from '../../utils/language';
import { formatCurrency } from '../../utils/calculations';
import { useGlobalCurrency } from '../../utils/currencyRate';
import {
  auditMt5HistoryCandidate,
  buildClosedTradeFromMt5Candidate,
  deduplicateBatchMt5Candidates,
  Mt5AuditIssue,
  Mt5CandidateAuditResult,
  Mt5HistoryTradeCandidate,
  Mt5ScanExecutionMode,
  parseSignedMt5Number,
  prepareCrispMt5Screenshot,
  recheckDuplicateMt5Candidate,
  scanBatchMt5HistoryScreenshots,
  scanSingleMt5HistoryScreenshot,
} from '../../utils/tradeScreenshotScanner';

const MT5_SCAN_MODE_STORAGE_KEY = 'tradevault_mt5_scan_mode';

function readStoredScanMode(): Mt5ScanExecutionMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    return window.localStorage.getItem(MT5_SCAN_MODE_STORAGE_KEY) === 'offline'
      ? 'offline'
      : 'auto';
  } catch {
    return 'auto';
  }
}

interface UploadedScreenshotItem {
  id: string;
  sourceImageIndex: number;
  name: string;
  dataUrl: string;
  status: 'pending' | 'scanning' | 'done' | 'error';
  foundCount: number;
  fromCache?: boolean;
  scanEngine?: 'gemini' | 'offline-ocr' | 'cache' | 'error';
  error?: string;
}

interface Mt5HistoryScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingTrades: Trade[];
  settings: AppSettings;
  onImportBatchTrades: (
    newTrades: Trade[]
  ) => Promise<{ success: boolean; error?: string; importedCount?: number }>;
}

const SESSION_OPTIONS: TradingSession[] = ['Asian', 'London', 'Overlap', 'New York', 'Other'];
const CLOSE_TYPE_OPTIONS: TradeCloseType[] = ['TP', 'SL', 'Manual'];

interface NumericDraftInputProps {
  value: number | null;
  allowEmpty?: boolean;
  allowNegative?: boolean;
  min?: number;
  absValue?: boolean;
  fallbackOnBlur?: number | null;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  onCommit: (next: number | null) => void;
}

/**
 * Controlled decimal input that preserves intermediate states like "-", "-45.", or ""
 * while editing, preventing cursor jumps or premature zeroing on mobile keyboards.
 */
const NumericDraftInput: React.FC<NumericDraftInputProps> = ({
  value,
  allowEmpty = false,
  allowNegative = false,
  min,
  absValue = false,
  fallbackOnBlur = 0,
  placeholder,
  ariaLabel,
  className,
  onCommit,
}) => {
  const formatDisplay = (v: number | null): string =>
    v === null || v === undefined || !Number.isFinite(v) ? '' : String(v);

  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => formatDisplay(value));

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatDisplay(value));
    }
  }, [value, isFocused]);

  const parseDraft = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.') {
      return null;
    }
    const parsed = parseSignedMt5Number(trimmed, false, 'EURUSD');
    if (parsed === null || !Number.isFinite(parsed)) return null;
    let finalVal = absValue ? Math.abs(parsed) : parsed;
    if (!allowNegative && finalVal < 0) finalVal = Math.abs(finalVal);
    if (min !== undefined && finalVal < min) finalVal = min;
    return finalVal;
  };

  return (
    <input
      type="text"
      inputMode={allowNegative ? 'text' : 'decimal'}
      value={isFocused ? draft : formatDisplay(value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={() => {
        setIsFocused(true);
        setDraft(formatDisplay(value));
      }}
      onChange={(e) => {
        const nextRaw = e.target.value;
        setDraft(nextRaw);
        if (allowEmpty && nextRaw.trim() === '') {
          onCommit(null);
          return;
        }
        // Only commit live when it ends cleanly in a digit (don't snap while typing '-' or '12.')
        if (/\d$/.test(nextRaw.trim())) {
          const parsed = parseDraft(nextRaw);
          if (parsed !== null) {
            onCommit(parsed);
          }
        }
      }}
      onBlur={() => {
        setIsFocused(false);
        if (allowEmpty && draft.trim() === '') {
          onCommit(null);
          setDraft('');
          return;
        }
        const parsed = parseDraft(draft);
        if (parsed !== null) {
          onCommit(parsed);
          setDraft(String(parsed));
        } else {
          const fallback = allowEmpty ? null : fallbackOnBlur;
          onCommit(fallback);
          setDraft(formatDisplay(fallback));
        }
      }}
      className={className}
    />
  );
};

export const Mt5HistoryScanModal: React.FC<Mt5HistoryScanModalProps> = ({
  isOpen,
  onClose,
  existingTrades,
  settings,
  onImportBatchTrades,
}) => {
  const { tr } = useLanguage();
  const { preferredCurrency, formatDynamic } = useGlobalCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextImageSeqRef = useRef<number>(0);

  const [screenshots, setScreenshots] = useState<UploadedScreenshotItem[]>([]);
  const [candidates, setCandidates] = useState<Mt5HistoryTradeCandidate[]>([]);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});
  const [defaultStrategy, setDefaultStrategy] = useState<string>('MT5 History Scan');
  const [scanMode, setScanMode] = useState<Mt5ScanExecutionMode>(() => readStoredScanMode());
  const [isDeviceOnline, setIsDeviceOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSelectScanMode = (nextMode: Mt5ScanExecutionMode) => {
    setScanMode(nextMode);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MT5_SCAN_MODE_STORAGE_KEY, nextMode);
      } catch {
        // Ignore storage errors in private mode
      }
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncOnlineStatus = () => {
      setIsDeviceOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    };
    syncOnlineStatus();
    window.addEventListener('online', syncOnlineStatus);
    window.addEventListener('offline', syncOnlineStatus);
    return () => {
      window.removeEventListener('online', syncOnlineStatus);
      window.removeEventListener('offline', syncOnlineStatus);
    };
  }, []);

  const availableStrategies = useMemo(() => {
    const set = new Set<string>(['MT5 History Scan']);
    for (const t of existingTrades) {
      if (t.strategy && t.strategy.trim()) {
        set.add(t.strategy.trim());
      }
    }
    return Array.from(set);
  }, [existingTrades]);

  const fmtMoney = (val: number) =>
    preferredCurrency === 'IDR' ? formatDynamic(val) : formatCurrency(val, settings);

  // Reset modal state cleanly when closed
  useEffect(() => {
    if (!isOpen) {
      nextImageSeqRef.current = 0;
      setScreenshots([]);
      setCandidates([]);
      setExpandedRowIds({});
      setIsScanning(false);
      setIsSaving(false);
      setIsDragging(false);
      setErrorMsg(null);
    }
  }, [isOpen]);

  // Escape key dismissal matching TradeForm
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving && !isScanning) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, isScanning, onClose]);

  const processAndScanFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setErrorMsg(
        tr(
          'Format file tidak valid. Pilih screenshot gambar PNG/JPG/WEBP dari riwayat MT5.',
          'Invalid file format. Please select PNG/JPG/WEBP screenshot images from MT5 history.'
        )
      );
      return;
    }

    setErrorMsg(null);
    setIsScanning(true);

    try {
      const prepared = await Promise.all(
        imageFiles.map(async (file, i) => {
          const seqIndex = nextImageSeqRef.current++;
          const dataUrl = await prepareCrispMt5Screenshot(file, 1600, 3200, 0.92);
          return {
            id: `ss_${Date.now()}_${seqIndex}_${i}_${Math.random().toString(36).slice(2, 6)}`,
            sourceImageIndex: seqIndex,
            name: file.name || `Screenshot ${seqIndex + 1}`,
            dataUrl,
            status: 'scanning' as const,
            foundCount: 0,
          };
        })
      );

      setScreenshots((prev) => [...prev, ...prepared]);

      const batchResult = await scanBatchMt5HistoryScreenshots(
        prepared.map((item) => ({
          imageDataUrl: item.dataUrl,
          sourceImageIndex: item.sourceImageIndex,
        })),
        {
          existingTrades,
          defaultStrategy,
          mode: scanMode,
        }
      );

      const outcomeByIndex = new Map(
        batchResult.perImageOutcomes.map((o) => [o.sourceImageIndex, o])
      );

      let firstFailureMsg: string | null = null;
      setScreenshots((prev) =>
        prev.map((s) => {
          const outcome = outcomeByIndex.get(s.sourceImageIndex);
          if (!outcome) return s;
          if (outcome.status === 'error') {
            if (!firstFailureMsg && outcome.error) {
              firstFailureMsg = outcome.error;
            }
            return {
              ...s,
              status: 'error',
              foundCount: 0,
              fromCache: false,
              scanEngine: 'error',
              error: outcome.error || tr('Gagal memindai gambar', 'Failed to scan image'),
            };
          }
          return {
            ...s,
            status: 'done',
            foundCount: outcome.trades.length,
            fromCache: outcome.fromCache,
            scanEngine: outcome.scanEngine,
            error: undefined,
          };
        })
      );

      if (batchResult.trades.length > 0) {
        setCandidates((prev) => deduplicateBatchMt5Candidates([...prev, ...batchResult.trades]));
      } else if (firstFailureMsg) {
        setErrorMsg(firstFailureMsg);
      } else {
        setErrorMsg(
          tr(
            'Tidak ada baris transaksi close MT5/MT4 yang terdeteksi pada screenshot. Pastikan kolom History Positions/Deals terlihat jelas.',
            'No closed MT5/MT4 trade rows were detected in the screenshot. Make sure the History Positions/Deals rows are clearly visible.'
          )
        );
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          tr('Terjadi kesalahan saat memproses screenshot.', 'Error processing screenshot.')
      );
    } finally {
      setIsScanning(false);
    }
  };

  // Support Ctrl+V / Cmd+V clipboard screenshot paste while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      if (isSaving || isScanning) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        void processAndScanFiles(pastedFiles);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (list.length > 0) {
      void processAndScanFiles(list);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isScanning || isSaving) return;
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) {
      void processAndScanFiles(files);
    }
  };

  const handleRescanItem = async (item: UploadedScreenshotItem) => {
    if (isScanning || isSaving) return;
    setErrorMsg(null);
    setIsScanning(true);
    setScreenshots((prev) =>
      prev.map((s) =>
        s.id === item.id ? { ...s, status: 'scanning', fromCache: false, error: undefined } : s
      )
    );
    try {
      const result = await scanSingleMt5HistoryScreenshot(item.dataUrl, {
        existingTrades,
        sourceImageIndex: item.sourceImageIndex,
        defaultStrategy,
        forceRefresh: true,
        mode: scanMode,
      });
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === item.id
            ? {
                ...s,
                status: 'done',
                foundCount: result.trades.length,
                fromCache: Boolean(result.fromCache),
                scanEngine: result.scanEngine,
              }
            : s
        )
      );
      if (result.trades.length === 0) {
        setErrorMsg(
          tr(
            'Tidak ada baris transaksi close MT5/MT4 yang terdeteksi pada screenshot. Pastikan kolom History Positions/Deals terlihat jelas.',
            'No closed MT5/MT4 trade rows were detected in the screenshot. Make sure the History Positions/Deals rows are clearly visible.'
          )
        );
      } else {
        setCandidates((prev) => {
          const withoutOldForImage = prev.filter(
            (c) => c.sourceImageIndex !== item.sourceImageIndex
          );
          return deduplicateBatchMt5Candidates([...withoutOldForImage, ...result.trades]);
        });
      }
    } catch (err: any) {
      const errMessage = err?.message || tr('Gagal memindai ulang', 'Rescan failed');
      setErrorMsg(errMessage);
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === item.id ? { ...s, status: 'error', scanEngine: 'error', error: errMessage } : s
        )
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveScreenshot = (item: UploadedScreenshotItem) => {
    setScreenshots((prev) => prev.filter((s) => s.id !== item.id));
    setCandidates((prev) => prev.filter((c) => c.sourceImageIndex !== item.sourceImageIndex));
  };

  const patchCandidate = (
    tempId: string,
    patch: Partial<Mt5HistoryTradeCandidate>
  ) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.tempId !== tempId) return c;
        const updated: Mt5HistoryTradeCandidate = { ...c, ...patch };
        if (
          'instrument' in patch ||
          'position' in patch ||
          'lotSize' in patch ||
          'entryPrice' in patch ||
          'exitPrice' in patch ||
          'netProfit' in patch ||
          'closeDateTime' in patch ||
          'ticketId' in patch
        ) {
          return recheckDuplicateMt5Candidate(updated, existingTrades);
        }
        return updated;
      })
    );
  };

  const updateCandidate = <K extends keyof Mt5HistoryTradeCandidate>(
    tempId: string,
    field: K,
    value: Mt5HistoryTradeCandidate[K]
  ) => {
    patchCandidate(tempId, { [field]: value } as Partial<Mt5HistoryTradeCandidate>);
  };

  const applyAuditQuickFix = (cand: Mt5HistoryTradeCandidate, issue: Mt5AuditIssue) => {
    if (issue.code === 'SIGN_MISMATCH' && issue.suggestedNetProfit !== undefined) {
      patchCandidate(cand.tempId, {
        netProfit: issue.suggestedNetProfit,
        ocrSignRecovered: false,
      });
    } else if (issue.code === 'CLOSE_TYPE_PROFIT_CONFLICT') {
      patchCandidate(cand.tempId, { closeType: 'SL' });
    }
  };

  const removeCandidate = (tempId: string) => {
    setCandidates((prev) => prev.filter((c) => c.tempId !== tempId));
  };

  const applyStrategyToAll = (nextStrategy: string) => {
    setDefaultStrategy(nextStrategy);
    setCandidates((prev) => prev.map((c) => ({ ...c, strategy: nextStrategy })));
  };

  const toggleSelectAll = (selectNonDuplicatesOnly: boolean) => {
    setCandidates((prev) =>
      prev.map((c) => ({
        ...c,
        selected: selectNonDuplicatesOnly ? !c.isDuplicate : true,
      }))
    );
  };

  const auditMap = useMemo(() => {
    const map = new Map<string, Mt5CandidateAuditResult>();
    for (const c of candidates) {
      map.set(c.tempId, auditMt5HistoryCandidate(c, settings));
    }
    return map;
  }, [candidates, settings]);

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => c.selected),
    [candidates]
  );

  const selectedNetTotal = useMemo(
    () => selectedCandidates.reduce((acc, c) => acc + (Number(c.netProfit) || 0), 0),
    [selectedCandidates]
  );

  const duplicateCount = useMemo(
    () => candidates.filter((c) => c.isDuplicate).length,
    [candidates]
  );

  const auditIssueCount = useMemo(
    () =>
      candidates.filter((c) => {
        const res = auditMap.get(c.tempId);
        return res && (res.status === 'ERROR' || res.status === 'WARNING');
      }).length,
    [candidates, auditMap]
  );

  const selectedErrorCount = useMemo(
    () =>
      selectedCandidates.filter((c) => auditMap.get(c.tempId)?.status === 'ERROR').length,
    [selectedCandidates, auditMap]
  );

  const handleSaveSelected = async () => {
    if (isSaving || isScanning || selectedCandidates.length === 0) return;
    setErrorMsg(null);

    for (const item of selectedCandidates) {
      if (!item.instrument.trim()) {
        setErrorMsg(tr('Simbol pair tidak boleh kosong.', 'Instrument symbol cannot be empty.'));
        return;
      }
      if (!Number.isFinite(item.lotSize) || item.lotSize <= 0) {
        setErrorMsg(
          tr(
            `Lot pada ${item.instrument} harus lebih dari 0.`,
            `Lot size on ${item.instrument} must be greater than 0.`
          )
        );
        return;
      }
      if (!Number.isFinite(item.entryPrice) || item.entryPrice <= 0) {
        setErrorMsg(
          tr(
            `Harga Entry pada ${item.instrument} harus valid (> 0).`,
            `Entry price on ${item.instrument} must be valid (> 0).`
          )
        );
        return;
      }
      if (!Number.isFinite(item.exitPrice) || item.exitPrice <= 0) {
        setErrorMsg(
          tr(
            `Harga Exit pada ${item.instrument} harus valid (> 0).`,
            `Exit price on ${item.instrument} must be valid (> 0).`
          )
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      const usedIds = new Set<string>(existingTrades.map((t) => t.id.toLowerCase()));
      const newTrades = selectedCandidates.map((cand) =>
        buildClosedTradeFromMt5Candidate(cand, usedIds, settings)
      );

      const res = await onImportBatchTrades(newTrades);
      if (res.success) {
        onClose();
      } else {
        setErrorMsg(
          res.error ||
            tr(
              'Gagal menyimpan transaksi ke Jurnal.',
              'Failed to save trades to Journal.'
            )
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || tr('Terjadi kesalahan saat menyimpan.', 'Error saving trades.'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const modalNode = (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain flex flex-col items-center justify-center bg-black/60 dark:bg-black/75 p-3 sm:p-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mt5-scan-modal-title"
      onClick={() => {
        if (!isSaving && !isScanning) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDragging(false);
        }}
        onDrop={handleDrop}
        className="relative w-[92vw] sm:w-full max-w-[460px] sm:max-w-[540px] max-h-[calc(100vh-1.5rem)] supports-[height:100dvh]:max-h-[calc(100dvh-1.5rem)] my-auto shrink-0 flex flex-col rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] font-sans shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden select-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#E4E4E7] dark:border-[#20252D] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2
              id="mt5-scan-modal-title"
              className="text-[15px] font-bold tracking-tight text-[#0F172A] dark:text-[#F2F4F7] truncate"
            >
              {tr('Catat dari Riwayat MT5', 'Import MT5 History')}
            </h2>
            {candidates.length > 0 && (
              <span className="text-[10px] font-semibold tracking-wider uppercase text-[#526071] dark:text-[#929BA9] tabular-nums whitespace-nowrap shrink-0">
                · {selectedCandidates.length}/{candidates.length} {tr('SIAP', 'READY')}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label={tr('Tutup', 'Close')}
            title={tr('Tutup Formulir', 'Close Form')}
            className="rounded-full p-1.5 text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] active:scale-95 transition-all disabled:opacity-50 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            <X className="h-4 w-4 stroke-[2]" />
          </button>
        </div>

        {/* Seamless Hairline-Divided Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#E4E4E7] dark:divide-[#20252D] min-h-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Error Banner — Exact TradeForm pattern */}
          {errorMsg && (
            <div className="px-5 py-2.5 bg-[#E11D48]/10 dark:bg-[#E05260]/10">
              <div className="flex items-start gap-2 text-[11px] text-[#E11D48] dark:text-[#E05260]">
                <AlertCircle className="h-3.5 w-3.5 stroke-[2] shrink-0 mt-0.5" />
                <span className="leading-snug">{errorMsg}</span>
              </div>
            </div>
          )}

          {/* Section 1: Screenshot MT5 Upload & Queue */}
          <div
            className={`px-5 py-3 space-y-2.5 transition-colors ${
              isDragging ? 'bg-[#FAFAFA] dark:bg-[#12161D]' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr('Screenshot Riwayat MT5 / MT4', 'MT5 / MT4 History Screenshot')}
                </span>
                <span className="block text-[10px] text-[#94A3B8] dark:text-[#606875] truncate">
                  {tr(
                    'Unggah banyak gambar, seret ke sini, atau tekan Ctrl+V',
                    'Upload multiple images, drag here, or press Ctrl+V'
                  )}
                </span>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning || isSaving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#12161D] border border-[#E4E4E7] dark:border-[#1E232B] text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7] hover:border-[#697586] dark:hover:border-[#929BA9] active:scale-[0.98] transition-all cursor-pointer shrink-0 whitespace-nowrap disabled:opacity-50"
              >
                {isScanning ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : screenshots.length > 0 ? (
                  <Plus className="h-3 w-3 stroke-[2]" />
                ) : (
                  <Upload className="h-3 w-3 stroke-[2]" />
                )}
                <span>
                  {isScanning
                    ? tr('Memindai...', 'Scanning...')
                    : screenshots.length > 0
                    ? tr('Tambah', 'Add')
                    : tr('Unggah', 'Upload')}
                </span>
              </button>
            </div>

            {/* Mode Scan Row — Canonical Segmented Toggle (DESIGN.md compliant) */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#E4E4E7]/70 dark:border-[#1E232B]/60">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] text-[#697586] dark:text-[#929BA9]">
                  <span>{tr('Mode Scan', 'Scan Mode')}</span>
                  {!isDeviceOnline && (
                    <span className="font-semibold text-[#D97706] dark:text-[#F59E0B]">
                      · {tr('Offline', 'Offline')}
                    </span>
                  )}
                </div>
                <span className="block text-[10px] text-[#94A3B8] dark:text-[#606875] truncate">
                  {!isDeviceOnline
                    ? tr(
                        'Koneksi offline — otomatis memakai OCR lokal di perangkat',
                        'Device offline — automatically using on-device local OCR'
                      )
                    : scanMode === 'offline'
                    ? tr(
                        '100% lokal di perangkat tanpa kuota & internet',
                        '100% on-device local OCR with zero quota & internet'
                      )
                    : tr(
                        'Gemini AI saat online, fallback otomatis OCR lokal',
                        'Gemini AI online with automatic local OCR fallback'
                      )}
                </span>
              </div>

              <div
                role="group"
                aria-label={tr('Pilih mode pemindaian', 'Choose scan mode')}
                className="inline-flex items-center gap-0.5 rounded-full bg-[#FAFAFA] dark:bg-[#12161D] p-0.5 border border-[#E4E4E7] dark:border-[#1E232B] shrink-0"
              >
                {(
                  [
                    { id: 'auto', labelId: 'Otomatis', labelEn: 'Auto' },
                    { id: 'offline', labelId: 'Offline', labelEn: 'Offline' },
                  ] as const
                ).map((opt) => {
                  const active = scanMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isScanning || isSaving}
                      onClick={() => handleSelectScanMode(opt.id)}
                      aria-pressed={active}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1769E8]/50 ${
                        active
                          ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                          : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {tr(opt.labelId, opt.labelEn)}
                    </button>
                  );
                })}
              </div>
            </div>

            {screenshots.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning || isSaving}
                className="w-full rounded-2xl bg-[#FAFAFA] dark:bg-[#12161D] border border-[#E4E4E7] dark:border-[#1E232B] hover:border-[#697586] dark:hover:border-[#929BA9] px-4 py-5 flex flex-col items-center justify-center gap-1.5 text-center transition-colors cursor-pointer disabled:opacity-50"
              >
                <ImageIcon className="h-4 w-4 stroke-[1.75] text-[#697586] dark:text-[#929BA9]" />
                <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                  {tr(
                    'Pilih screenshot riwayat posisi close',
                    'Choose closed position history screenshots'
                  )}
                </span>
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    'Otomatis membaca TP, SL, dan tutup manual beserta harga & profit',
                    'Automatically extracts TP, SL, and manual closes with price & profit'
                  )}
                </span>
              </button>
            ) : (
              <div className="rounded-2xl bg-[#FAFAFA] dark:bg-[#12161D] border border-[#E4E4E7] dark:border-[#1E232B] divide-y divide-[#E4E4E7] dark:divide-[#1E232B] overflow-hidden">
                {screenshots.map((ss, idx) => (
                  <div
                    key={ss.id}
                    className="flex items-center justify-between gap-2.5 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={ss.dataUrl}
                        alt={ss.name}
                        className="h-8 w-8 rounded-lg object-cover border border-[#E4E4E7] dark:border-[#1E232B] shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] truncate">
                          {ss.name}
                        </div>
                        <div className="text-[11px] text-[#697586] dark:text-[#929BA9] tabular-nums flex items-center gap-1.5 flex-wrap">
                          <span>#{idx + 1}</span>
                          <span aria-hidden="true">·</span>
                          {ss.status === 'scanning' && (
                            <span className="inline-flex items-center gap-1 text-[#151D2A] dark:text-[#F2F4F7]">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              {scanMode === 'offline' || !isDeviceOnline
                                ? tr('Memindai Offline OCR...', 'Scanning Offline OCR...')
                                : tr('Memindai...', 'Scanning...')}
                            </span>
                          )}
                          {ss.status === 'done' && (
                            <span className="inline-flex items-center gap-1.5">
                              <span>
                                {ss.foundCount} {tr('transaksi terbaca', 'trades found')}
                              </span>
                              {ss.fromCache ? (
                                <span className="text-[10px] font-semibold text-[#059669] dark:text-[#00A878]">
                                  · {tr('Instan', 'Cached')}
                                </span>
                              ) : ss.scanEngine === 'offline-ocr' ? (
                                <span className="text-[10px] font-semibold text-[#697586] dark:text-[#929BA9]">
                                  · {tr('Offline OCR', 'Offline OCR')}
                                </span>
                              ) : ss.scanEngine === 'gemini' ? (
                                <span className="text-[10px] font-semibold text-[#1769E8] dark:text-[#60A5FA]">
                                  · {tr('AI', 'AI')}
                                </span>
                              ) : null}
                            </span>
                          )}
                          {ss.status === 'error' && (
                            <span className="text-[#E11D48] dark:text-[#E05260] truncate">
                              {tr('Gagal dipindai', 'Scan failed')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {(ss.status === 'error' ||
                        (ss.status === 'done' &&
                          (ss.foundCount === 0 || ss.scanEngine === 'offline-ocr'))) && (
                        <button
                          type="button"
                          onClick={() => handleRescanItem(ss)}
                          disabled={isScanning || isSaving}
                          title={tr('Pindai Ulang', 'Rescan')}
                          className="p-1.5 rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-black/5 dark:hover:bg-white/[0.06] cursor-pointer disabled:opacity-40"
                        >
                          <RefreshCw className="h-3.5 w-3.5 stroke-[1.75]" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveScreenshot(ss)}
                        disabled={isScanning || isSaving}
                        title={tr('Hapus gambar', 'Remove image')}
                        className="p-1.5 rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-black/5 dark:hover:bg-white/[0.06] cursor-pointer disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5 stroke-[1.75]" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Ringkasan & Strategi Default (Clean TradeForm Row) */}
          {candidates.length > 0 && (
            <div className="px-5 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] text-[#697586] dark:text-[#929BA9] tabular-nums flex flex-wrap items-center gap-x-1">
                  <span>
                    {candidates.length} {tr('Terdeteksi', 'Detected')}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-semibold text-[#151D2A] dark:text-[#F2F4F7]">
                    {selectedCandidates.length} {tr('Dipilih', 'Selected')}
                  </span>
                  {duplicateCount > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-[#D97706] dark:text-[#F59E0B] font-semibold">
                        {duplicateCount} {tr('duplikat', 'duplicates')}
                      </span>
                    </>
                  )}
                  {auditIssueCount > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-[#E11D48] dark:text-[#E05260] font-semibold">
                        {auditIssueCount} {tr('perlu cek', 'needs check')}
                      </span>
                    </>
                  )}
                </div>

                <span
                  className={`text-xs font-bold tabular-nums ${
                    selectedNetTotal >= 0.01
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : selectedNetTotal <= -0.01
                      ? 'text-[#E11D48] dark:text-[#E05260]'
                      : 'text-[#151D2A] dark:text-[#F2F4F7]'
                  }`}
                >
                  {selectedNetTotal >= 0 ? '+' : ''}
                  {fmtMoney(selectedNetTotal)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-[#E4E4E7]/70 dark:border-[#1E232B]/60">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <label
                    htmlFor="mt5-default-strategy"
                    className="text-[11px] text-[#697586] dark:text-[#929BA9] shrink-0"
                  >
                    {tr('Strategi', 'Strategy')}
                  </label>
                  <select
                    id="mt5-default-strategy"
                    value={defaultStrategy}
                    onChange={(e) => applyStrategyToAll(e.target.value)}
                    className="min-w-0 max-w-[190px] bg-white dark:bg-[#0B0D11] border-b border-[#E4E4E7] dark:border-[#1E232B] pb-0.5 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none truncate"
                  >
                    {availableStrategies.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3 text-[11px] font-semibold shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(true)}
                    className="text-[#151D2A] dark:text-[#F2F4F7] hover:underline cursor-pointer whitespace-nowrap"
                  >
                    {tr('Pilih Baru', 'Select New')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCandidates((prev) => prev.map((c) => ({ ...c, selected: false })))
                    }
                    className="text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] cursor-pointer whitespace-nowrap"
                  >
                    {tr('Kosongkan', 'Clear')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Section 3+: Seamless Candidate Rows (Hairline Divided, Zero Card-in-Card) */}
          {candidates.map((cand) => {
            const isExpanded = Boolean(expandedRowIds[cand.tempId]);
            const isWin = cand.netProfit >= 0.01;
            const isLoss = cand.netProfit <= -0.01;
            const audit = auditMap.get(cand.tempId);

            return (
              <div
                key={cand.tempId}
                className={`px-5 py-3 transition-opacity ${
                  cand.selected ? 'opacity-100' : 'opacity-50'
                }`}
              >
                {/* Row Line 1: Check, Pair, BUY/SELL, Lot, Close Type, +/- Sign & Net P/L, Expand/Delete */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => updateCandidate(cand.tempId, 'selected', !cand.selected)}
                      aria-label={tr('Pilih transaksi', 'Select trade')}
                      className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                        cand.selected
                          ? 'bg-[#151D2A] dark:bg-[#F2F4F7] border-[#151D2A] dark:border-[#F2F4F7] text-white dark:text-[#050607]'
                          : 'bg-transparent border-[#E4E4E7] dark:border-[#2A313D] text-transparent'
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[2.5]" />
                    </button>

                    <input
                      type="text"
                      value={cand.instrument}
                      onChange={(e) =>
                        updateCandidate(cand.tempId, 'instrument', e.target.value.toUpperCase())
                      }
                      aria-label={tr('Instrumen', 'Instrument')}
                      className="w-20 bg-transparent text-sm font-bold tracking-wide uppercase text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none focus:border-b focus:border-[#697586] dark:focus:border-[#929BA9]"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        updateCandidate(
                          cand.tempId,
                          'position',
                          cand.position === 'BUY' ? 'SELL' : 'BUY'
                        )
                      }
                      className={`text-xs font-bold uppercase tracking-wide cursor-pointer shrink-0 ${
                        cand.position === 'BUY'
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }`}
                    >
                      {cand.position}
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <NumericDraftInput
                        value={cand.lotSize}
                        min={0.01}
                        fallbackOnBlur={0.01}
                        onCommit={(val) =>
                          updateCandidate(cand.tempId, 'lotSize', val ?? 0.01)
                        }
                        ariaLabel="Lot"
                        className="w-12 bg-transparent text-right text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none focus:border-b focus:border-[#697586] dark:focus:border-[#929BA9]"
                      />
                      <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">Lot</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-auto shrink-0">
                    {/* Close Type Segmented Control */}
                    <div className="inline-flex items-center gap-0.5 rounded-full bg-[#F4F4F5] dark:bg-[#12161D] p-0.5 border border-[#E4E4E7] dark:border-[#1E232B]">
                      {CLOSE_TYPE_OPTIONS.map((ct) => {
                        const active = cand.closeType === ct;
                        return (
                          <button
                            key={ct}
                            type="button"
                            onClick={() => updateCandidate(cand.tempId, 'closeType', ct)}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                              active
                                ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                                : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                            }`}
                          >
                            {ct}
                          </button>
                        );
                      })}
                    </div>

                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          patchCandidate(cand.tempId, {
                            netProfit: Number((-cand.netProfit).toFixed(2)),
                            ocrSignRecovered: false,
                          })
                        }
                        title={tr('Ubah tanda +/- Profit', 'Flip +/- Profit sign')}
                        aria-label={tr('Ubah tanda +/- Profit', 'Flip +/- Profit sign')}
                        className="px-1.5 py-0.5 rounded border border-[#E4E4E7] dark:border-[#242A35] text-[10px] font-bold text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] cursor-pointer"
                      >
                        ±
                      </button>
                      <NumericDraftInput
                        value={cand.netProfit}
                        allowNegative
                        fallbackOnBlur={0}
                        onCommit={(val) =>
                          patchCandidate(cand.tempId, {
                            netProfit: val ?? 0,
                            ocrSignRecovered: false,
                          })
                        }
                        ariaLabel="Net Profit"
                        className={`w-20 bg-transparent text-right text-sm font-bold tabular-nums focus:outline-none focus:border-b focus:border-[#697586] dark:focus:border-[#929BA9] ${
                          isWin
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : isLoss
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : 'text-[#151D2A] dark:text-[#F2F4F7]'
                        }`}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRowIds((prev) => ({
                          ...prev,
                          [cand.tempId]: !prev[cand.tempId],
                        }))
                      }
                      title={tr('Detail lanjutan', 'More details')}
                      aria-label={tr('Detail lanjutan', 'More details')}
                      className="p-1 rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#151921] cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => removeCandidate(cand.tempId)}
                      title={tr('Hapus baris', 'Remove row')}
                      aria-label={tr('Hapus baris', 'Remove row')}
                      className="p-1 rounded-full text-[#697586] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-[#F4F4F5] dark:hover:bg-[#151921] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
                    </button>
                  </div>
                </div>

                {/* Row Line 2: Entry -> Exit, Date/Time, Session & Unboxed Metadata */}
                <div className="mt-1.5 pl-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#697586] dark:text-[#929BA9] tabular-nums">
                  <div className="inline-flex items-center gap-1">
                    <NumericDraftInput
                      value={cand.entryPrice}
                      min={0}
                      fallbackOnBlur={0}
                      onCommit={(val) =>
                        updateCandidate(cand.tempId, 'entryPrice', val ?? 0)
                      }
                      ariaLabel="Entry"
                      className="w-[68px] bg-transparent border-b border-transparent hover:border-[#E4E4E7] focus:border-[#697586] dark:hover:border-[#1E232B] text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none"
                    />
                    <span aria-hidden="true">→</span>
                    <NumericDraftInput
                      value={cand.exitPrice}
                      min={0}
                      fallbackOnBlur={0}
                      onCommit={(val) =>
                        updateCandidate(cand.tempId, 'exitPrice', val ?? 0)
                      }
                      ariaLabel="Exit"
                      className="w-[68px] bg-transparent border-b border-transparent hover:border-[#E4E4E7] focus:border-[#697586] dark:hover:border-[#1E232B] text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none"
                    />
                  </div>

                  <span aria-hidden="true">·</span>

                  <input
                    type="datetime-local"
                    value={cand.closeDateTime}
                    onChange={(e) =>
                      updateCandidate(cand.tempId, 'closeDateTime', e.target.value)
                    }
                    className="bg-transparent text-[11px] text-[#697586] dark:text-[#929BA9] focus:outline-none dark:[color-scheme:dark]"
                  />

                  <span aria-hidden="true">·</span>

                  <select
                    value={cand.session}
                    onChange={(e) =>
                      updateCandidate(
                        cand.tempId,
                        'session',
                        e.target.value as TradingSession
                      )
                    }
                    className="bg-transparent text-[11px] text-[#697586] dark:text-[#929BA9] focus:outline-none"
                  >
                    {SESSION_OPTIONS.map((ses) => (
                      <option key={ses} value={ses} className="bg-white dark:bg-[#0B0D11]">
                        {ses}
                      </option>
                    ))}
                  </select>

                  {cand.ticketId && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[10px] text-[#94A3B8] dark:text-[#606875]">
                        #{cand.ticketId}
                      </span>
                    </>
                  )}

                  {cand.isDuplicate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[10px] font-semibold text-[#D97706] dark:text-[#F59E0B]">
                        {tr(
                          `Sudah ada (${cand.duplicateMatchId || 'Jurnal'})`,
                          `Already logged (${cand.duplicateMatchId || 'Journal'})`
                        )}
                      </span>
                    </>
                  )}
                </div>

                {/* Deterministic Math Audit Alerts & 1-Tap Quick Fixes */}
                {audit && audit.issues.length > 0 && (
                  <div className="mt-2 pl-7 space-y-1.5">
                    {audit.issues.map((issue, issueIdx) => {
                      const isErr = issue.severity === 'error';
                      const isWarn = issue.severity === 'warning';
                      return (
                        <div
                          key={`${issue.code}_${issueIdx}`}
                          className={`rounded-lg px-2.5 py-1.5 text-[10px] leading-snug border ${
                            isErr
                              ? 'bg-[#E11D48]/10 border-[#E11D48]/25 text-[#BE123C] dark:bg-[#E05260]/10 dark:border-[#E05260]/30 dark:text-[#FDA4AF]'
                              : isWarn
                              ? 'bg-[#D97706]/10 border-[#D97706]/25 text-[#B45309] dark:bg-[#F59E0B]/10 dark:border-[#F59E0B]/30 dark:text-[#FCD34D]'
                              : 'bg-[#059669]/10 border-[#059669]/25 text-[#047857] dark:bg-[#00A878]/10 dark:border-[#00A878]/30 dark:text-[#6EE7B7]'
                          }`}
                        >
                          <div className="flex items-start gap-1.5">
                            {isErr ? (
                              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                            ) : isWarn ? (
                              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                            ) : (
                              <Info className="h-3 w-3 shrink-0 mt-0.5" />
                            )}
                            <span className="flex-1">
                              {tr(issue.messageId, issue.messageEn)}
                            </span>
                          </div>

                          {(issue.code === 'SIGN_MISMATCH' ||
                            issue.code === 'CLOSE_TYPE_PROFIT_CONFLICT') && (
                            <div className="mt-1.5 pl-4 flex flex-wrap items-center gap-1.5">
                              {issue.suggestedNetProfit !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => applyAuditQuickFix(cand, issue)}
                                  className="px-2 py-0.5 rounded-md bg-white/80 dark:bg-[#101318] border border-current/25 font-semibold hover:opacity-85 cursor-pointer"
                                >
                                  {tr(
                                    `Ubah Profit ke ${issue.suggestedNetProfit > 0 ? '+' : ''}${issue.suggestedNetProfit.toFixed(2)}`,
                                    `Set Profit to ${issue.suggestedNetProfit > 0 ? '+' : ''}${issue.suggestedNetProfit.toFixed(2)}`
                                  )}
                                </button>
                              )}
                              {issue.suggestedPosition && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    patchCandidate(cand.tempId, {
                                      position: issue.suggestedPosition!,
                                    })
                                  }
                                  className="px-2 py-0.5 rounded-md bg-white/80 dark:bg-[#101318] border border-current/25 font-semibold hover:opacity-85 cursor-pointer"
                                >
                                  {tr(
                                    `Ubah ke ${issue.suggestedPosition}`,
                                    `Switch to ${issue.suggestedPosition}`
                                  )}
                                </button>
                              )}
                              {issue.canSwapEntryExit && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    patchCandidate(cand.tempId, {
                                      entryPrice: cand.exitPrice,
                                      exitPrice: cand.entryPrice,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 dark:bg-[#101318] border border-current/25 font-semibold hover:opacity-85 cursor-pointer"
                                >
                                  <ArrowLeftRight className="h-2.5 w-2.5" />
                                  <span>{tr('Tukar Entry↔Exit', 'Swap Entry↔Exit')}</span>
                                </button>
                              )}
                              {issue.code === 'CLOSE_TYPE_PROFIT_CONFLICT' && (
                                <button
                                  type="button"
                                  onClick={() => applyAuditQuickFix(cand, issue)}
                                  className="px-2 py-0.5 rounded-md bg-white/80 dark:bg-[#101318] border border-current/25 font-semibold hover:opacity-85 cursor-pointer"
                                >
                                  {tr('Ubah Close ke SL', 'Set Close to SL')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Expanded Detail Grid — Exact TradeForm underline inputs */}
                {isExpanded && (
                  <div className="mt-2.5 pt-2.5 pl-7 border-t border-[#E4E4E7]/70 dark:border-[#1E232B]/60 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                        Stop Loss
                      </label>
                      <NumericDraftInput
                        value={cand.stopLoss}
                        allowEmpty
                        placeholder="0.00"
                        onCommit={(val) => updateCandidate(cand.tempId, 'stopLoss', val)}
                        className="w-full bg-transparent border-b border-[#E4E4E7] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                        Take Profit
                      </label>
                      <NumericDraftInput
                        value={cand.takeProfit}
                        allowEmpty
                        placeholder="0.00"
                        onCommit={(val) => updateCandidate(cand.tempId, 'takeProfit', val)}
                        className="w-full bg-transparent border-b border-[#E4E4E7] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                        {tr('Komisi', 'Commission')} ({settings.currencySymbol})
                      </label>
                      <NumericDraftInput
                        value={cand.commission}
                        absValue
                        fallbackOnBlur={0}
                        onCommit={(val) =>
                          updateCandidate(cand.tempId, 'commission', val ?? 0)
                        }
                        className="w-full bg-transparent border-b border-[#E4E4E7] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                        Swap ({settings.currencySymbol})
                      </label>
                      <NumericDraftInput
                        value={cand.swap}
                        allowNegative
                        fallbackOnBlur={0}
                        onCommit={(val) => updateCandidate(cand.tempId, 'swap', val ?? 0)}
                        className="w-full bg-transparent border-b border-[#E4E4E7] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                        {tr('Strategi', 'Strategy')}
                      </label>
                      <input
                        type="text"
                        value={cand.strategy}
                        onChange={(e) =>
                          updateCandidate(cand.tempId, 'strategy', e.target.value)
                        }
                        className="w-full bg-transparent border-b border-[#E4E4E7] dark:border-[#1E232B] pb-1 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                        {tr('Catatan', 'Notes')}
                      </label>
                      <input
                        type="text"
                        value={cand.notes}
                        onChange={(e) =>
                          updateCandidate(cand.tempId, 'notes', e.target.value)
                        }
                        placeholder={tr('Opsional...', 'Optional...')}
                        className="w-full bg-transparent border-b border-[#E4E4E7] dark:border-[#1E232B] pb-1 text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedErrorCount > 0 && (
          <div className="px-5 py-2 border-t border-[#E11D48]/20 bg-[#E11D48]/10 dark:bg-[#E05260]/10 text-[11px] text-[#BE123C] dark:text-[#FDA4AF] flex items-center gap-2 shrink-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {tr(
                `${selectedErrorCount} transaksi terpilih memiliki ketidakcocokan tanda/harga. Perbaiki cepat di atas sebelum menyimpan.`,
                `${selectedErrorCount} selected trade(s) have sign/price mismatches. Use quick-fix above before saving.`
              )}
            </span>
          </div>
        )}

        {/* Footer — Standardized 2-button Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 py-2.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] hover:bg-[#F4F4F5] dark:hover:bg-[#1E2430] active:scale-[0.98] text-xs font-semibold text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-all disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            {tr('Batal', 'Cancel')}
          </button>

          <button
            type="button"
            onClick={handleSaveSelected}
            disabled={isSaving || isScanning || selectedCandidates.length === 0}
            aria-busy={isSaving}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-[#F2F4F7] dark:hover:bg-white active:scale-[0.98] dark:text-[#050607] text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{tr('Menyimpan...', 'Saving...')}</span>
              </>
            ) : selectedCandidates.length > 0 ? (
              <span>
                {tr(
                  `Simpan ${selectedCandidates.length} Trade`,
                  `Save ${selectedCandidates.length} Trades`
                )}
              </span>
            ) : (
              <span>{tr('Simpan', 'Save')}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
};
