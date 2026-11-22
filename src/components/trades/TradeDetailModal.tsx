import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Trade,
  TradeCloseType,
  TradeActivityEvent,
} from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  computePlannedRiskReward,
  computeRealizedRMultiple,
  formatCurrency,
  formatPlannedRR,
  formatRMultiple,
  normalizeTradeDateTimeLocal,
} from '../../utils/calculations';
import { calculateLotBasedOrderMetrics } from '../../utils/riskCalculator';
import {
  evaluateTradeCompliance,
  parseExecutionAdherenceTag,
} from '../../utils/complianceRating';
import {
  isStoragePath,
  createScreenshotSignedUrl,
} from '../../utils/supabaseSync';
import {
  resolveTradeLifecycle,
  encodeLifecycleMetaIntoExecutionNotes,
  createActivityEvent,
  transitionPlannedTradeToOpen,
  transitionPlannedTradeToCancelled,
  transitionOpenTradeToClosed,
  TradeLifecycleMeta,
} from '../../utils/tradeLifecycle';
import {
  getCachedUsdIdrRate,
  getCurrentUsdIdrSnapshot,
  useGlobalCurrency,
} from '../../utils/currencyRate';
import { useLanguage } from '../../utils/language';
import { resolveTradingViewSnapshotUrl } from '../../utils/tradeScreenshotScanner';
import {
  findNearbyMacroEventsForTrade,
  resolveTradeBehavior,
  getMistakeLabel,
  getEmotionLabel,
} from '../../utils/journalExtras';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Image as ImageIcon,
  Loader2,
  Upload,
  ZoomIn,
  Lock,
  CheckCircle2,
  XCircle,
  Clock,
  Save,
  MoreHorizontal,
  Plus,
  Activity,
  Check,
  AlertCircle,
  Maximize2,
  Newspaper,
} from 'lucide-react';

interface TradeDetailModalProps {
  trade: Trade | null;
  allTrades?: Trade[];
  settings: AppSettings;
  isOpen: boolean;
  isFullPage?: boolean;
  isChildModalOpen?: boolean;
  onClose: () => void;
  onSelectTrade?: (trade: Trade) => void;
  onEdit: (trade: Trade) => void;
  onDelete: (trade: Trade) => void;
  onViewScreenshot: (url: string, title: string) => void;
  onSaveTradeUpdate?: (
    updatedTrade: Trade,
    originalId?: string
  ) => Promise<{ success: boolean; error?: string; uploadedScreenshotPath?: string } | void>;
  onOpenMobileMenu?: () => void;
}

export type DetailSectionTab =
  | 'plan'
  | 'execution'
  | 'screenshots'
  | 'evaluation'
  | 'activity';

interface StructuredEvaluationFields {
  entryQuality: string;
  emotionalControl: string;
  wentWell: string;
  needsImprovement: string;
  lessonsLearned: string;
}

const EVAL_STRUCT_HEADER = '[TV_EVAL_V1]';

/**
 * Parses postTradeEvaluation string into structured reflection sections if formatted,
 * or maps legacy plain-text postTradeEvaluation into `lessonsLearned` without losing any text.
 */
function parseStructuredEvaluation(rawPostEval?: string): StructuredEvaluationFields {
  const empty: StructuredEvaluationFields = {
    entryQuality: '',
    emotionalControl: '',
    wentWell: '',
    needsImprovement: '',
    lessonsLearned: '',
  };
  if (!rawPostEval || typeof rawPostEval !== 'string') return empty;
  const trimmed = rawPostEval.trim();
  if (!trimmed) return empty;

  if (trimmed.startsWith(EVAL_STRUCT_HEADER)) {
    const body = trimmed.slice(EVAL_STRUCT_HEADER.length).trim();
    const extractField = (key: string): string => {
      const regex = new RegExp(`##\\s*${key}\\s*\\n([\\s\\S]*?)(?=\\n##\\s*[A-Z_]+|$)`, 'i');
      const m = body.match(regex);
      return m ? m[1].trim() : '';
    };
    return {
      entryQuality: extractField('ENTRY_QUALITY'),
      emotionalControl: extractField('EMOTIONAL_CONTROL'),
      wentWell: extractField('WENT_WELL'),
      needsImprovement: extractField('NEEDS_IMPROVEMENT'),
      lessonsLearned: extractField('LESSONS_LEARNED'),
    };
  }

  return {
    ...empty,
    lessonsLearned: trimmed,
  };
}

function serializeStructuredEvaluation(fields: StructuredEvaluationFields): string | undefined {
  const eq = fields.entryQuality.trim();
  const ec = fields.emotionalControl.trim();
  const ww = fields.wentWell.trim();
  const ni = fields.needsImprovement.trim();
  const ll = fields.lessonsLearned.trim();

  if (!eq && !ec && !ww && !ni && !ll) return undefined;

  // If only lessonsLearned is filled, store as clean plain text for full backward compatibility
  if (!eq && !ec && !ww && !ni && ll) {
    return ll;
  }

  const sections: string[] = [EVAL_STRUCT_HEADER];
  if (eq) sections.push(`## ENTRY_QUALITY\n${eq}`);
  if (ec) sections.push(`## EMOTIONAL_CONTROL\n${ec}`);
  if (ww) sections.push(`## WENT_WELL\n${ww}`);
  if (ni) sections.push(`## NEEDS_IMPROVEMENT\n${ni}`);
  if (ll) sections.push(`## LESSONS_LEARNED\n${ll}`);
  return sections.join('\n\n');
}

/**
 * Formats a price number using its natural recorded precision (minimum 2 decimals, up to 5 for forex pairs)
 * without fabricating values when undefined/null.
 */
function formatActualPrice(price?: number | null, instrument = 'XAUUSD'): string {
  if (price === undefined || price === null || !Number.isFinite(price) || price <= 0) {
    return '—';
  }
  const str = String(price);
  const dotIdx = str.indexOf('.');
  if (dotIdx !== -1) {
    const decLen = str.length - dotIdx - 1;
    if (decLen >= 3) {
      return price.toFixed(Math.min(5, decLen));
    }
  }
  const upper = (instrument || '').toUpperCase();
  if (
    upper.includes('EUR') ||
    upper.includes('GBP') ||
    upper.includes('AUD') ||
    upper.includes('NZD') ||
    upper.includes('CAD') ||
    upper.includes('CHF')
  ) {
    if (!upper.includes('JPY')) {
      return price.toFixed(5);
    }
  }
  return price.toFixed(2);
}

/**
 * Extracts a timeframe token (e.g. M5, M15, H1, H4, D1) from trade notes/reason/strategy if present.
 * Never invents a fake timeframe if none is recorded.
 */
function extractRecordedTimeframe(trade: Trade): string | null {
  const combined = `${trade.strategy || ''} ${trade.entryReason || ''} ${trade.notes || ''}`;
  const m = combined.match(/\b(?:TF\s*)?(M1|M3|M5|M15|M30|H1|H4|D1|W1|1m|5m|15m|30m|1h|4h|1d)\b/i);
  if (!m || !m[1]) return null;
  const token = m[1].toUpperCase();
  if (token === '1M') return 'M1';
  if (token === '5M') return 'M5';
  if (token === '15M') return 'M15';
  if (token === '30M') return 'M30';
  if (token === '1H') return 'H1';
  if (token === '4H') return 'H4';
  if (token === '1D') return 'D1';
  return token;
}

export const TradeDetailModal: React.FC<TradeDetailModalProps> = ({
  trade,
  allTrades = [],
  settings,
  isOpen,
  isFullPage = true,
  isChildModalOpen = false,
  onClose,
  onSelectTrade,
  onEdit,
  onDelete,
  onViewScreenshot,
  onSaveTradeUpdate,
}) => {
  const { preferredCurrency, formatDynamic, formatTradeFinancial } = useGlobalCurrency();
  const { tr, language } = useLanguage();

  // Horizontal 5-Section Active Tab State
  const [activeSectionTab, setActiveSectionTab] = useState<DetailSectionTab>('plan');

  // Overflow Menu State ([⋯])
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  // Resolved image URLs for BEFORE TRADE and AFTER TRADE
  const [beforeDisplayUrl, setBeforeDisplayUrl] = useState<string | null>(null);
  const [isBeforeLoading, setIsBeforeLoading] = useState<boolean>(false);
  const [afterDisplayUrl, setAfterDisplayUrl] = useState<string | null>(null);
  const [isAfterLoading, setIsAfterLoading] = useState<boolean>(false);
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);
  const [activePrimarySlot, setActivePrimarySlot] = useState<'BEFORE' | 'AFTER'>('BEFORE');

  // Plan inline edit state (persisted across tab switches)
  const [isEditingPlanNotes, setIsEditingPlanNotes] = useState<boolean>(false);
  const [planStrategyInput, setPlanStrategyInput] = useState<string>('');
  const [planSessionInput, setPlanSessionInput] = useState<string>('');
  const [planEntryReasonInput, setPlanEntryReasonInput] = useState<string>('');
  const [planNotesInput, setPlanNotesInput] = useState<string>('');
  const [isSavingPlanNotes, setIsSavingPlanNotes] = useState<boolean>(false);

  // Evaluation inline edit state (persisted across tab switches)
  const [isEditingEval, setIsEditingEval] = useState<boolean>(false);
  const [evalEntryQualityInput, setEvalEntryQualityInput] = useState<string>('');
  const [evalEmotionalControlInput, setEvalEmotionalControlInput] = useState<string>('');
  const [evalWentWellInput, setEvalWentWellInput] = useState<string>('');
  const [evalNeedsImprovementInput, setEvalNeedsImprovementInput] = useState<string>('');
  const [evalReflectionInput, setEvalReflectionInput] = useState<string>('');
  const [evalNotesInput, setEvalNotesInput] = useState<string>('');
  const [evalDisciplineRatingInput, setEvalDisciplineRatingInput] = useState<number | null>(null);
  const [isSavingEval, setIsSavingEval] = useState<boolean>(false);

  // Feedback Banner State
  const [saveFeedback, setSaveFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Lifecycle transition state inside Detail page
  const [activeTransitionPanel, setActiveTransitionPanel] = useState<
    null | 'OPEN' | 'CANCEL' | 'CLOSE'
  >(null);
  const [mt5Confirmed, setMt5Confirmed] = useState<boolean>(true);
  const [actualEntryInput, setActualEntryInput] = useState<string>('');
  const [actualLotInput, setActualLotInput] = useState<string>('');
  const [entryDateInput, setEntryDateInput] = useState<string>('');
  const [entryTimeInput, setEntryTimeInput] = useState<string>('');
  const [cancelReasonInput, setCancelReasonInput] = useState<string>('');

  const [closeTypeInput, setCloseTypeInput] = useState<TradeCloseType>('TP');
  const [actualExitInput, setActualExitInput] = useState<string>('');
  const [exitDateInput, setExitDateInput] = useState<string>('');
  const [exitTimeInput, setExitTimeInput] = useState<string>('');
  const [closeNetOverrideInput, setCloseNetOverrideInput] = useState<string>('');
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [isTransitionSaving, setIsTransitionSaving] = useState<boolean>(false);

  const resolved = useMemo(
    () => (trade ? resolveTradeLifecycle(trade) : null),
    [trade]
  );

  // Genuine Activity Timeline Items (declared unconditionally before any early returns)
  const timelineEvents = useMemo((): TradeActivityEvent[] => {
    if (!trade || !resolved) return [];
    if (resolved.activityLog.length > 0) {
      return resolved.activityLog;
    }
    const fallbackEvents: TradeActivityEvent[] = [
      {
        id: 'legacy-created',
        type: 'TRADE_CREATED',
        timestamp: trade.createdAt || trade.dateTime,
        label: tr('Trade dibuat', 'Trade created'),
        newValue: `${trade.instrument} ${trade.position} ${trade.lotSize.toFixed(2)} Lot @ ${formatActualPrice(
          trade.entryPrice,
          trade.instrument
        )}`,
        note: tr('Catatan awal disimpan', 'Initial record saved'),
      },
    ];
    if (resolved.status === 'OPEN' || resolved.status === 'CLOSED') {
      fallbackEvents.push({
        id: 'legacy-entry',
        type: 'POSITION_OPENED',
        timestamp: resolved.entryTime || trade.dateTime,
        label: tr('Entry dicatat', 'Entry recorded'),
        newValue: `${trade.position} ${(resolved.actualLot ?? trade.lotSize).toFixed(2)} Lot @ ${formatActualPrice(
          resolved.actualEntry ?? trade.entryPrice,
          trade.instrument
        )}`,
        note: tr('Posisi dibuka', 'Position opened'),
      });
    }
    if (resolved.beforeScreenshotUrl || trade.screenshotUrl || resolved.afterScreenshotUrl) {
      fallbackEvents.push({
        id: 'legacy-screenshot',
        type: 'TRADE_CREATED',
        timestamp: trade.updatedAt || trade.dateTime,
        label: tr('Screenshot ditambahkan', 'Screenshot added'),
        note: tr('Gambar chart disimpan', 'Chart image saved'),
      });
    }
    if (resolved.status === 'CLOSED') {
      fallbackEvents.push({
        id: 'legacy-closed',
        type: 'POSITION_CLOSED',
        timestamp: resolved.exitTime || trade.updatedAt || trade.dateTime,
        label: tr('Trade ditutup', 'Trade closed'),
        newValue: `${tr('Hasil:', 'Outcome:')} ${trade.outcome} · Net P/L: ${
          preferredCurrency === 'IDR'
            ? formatTradeFinancial(trade, 'netProfit', false, true)
            : formatCurrency(trade.netProfit, settings)
        }`,
        note: tr('Status trade diperbarui', 'Trade status updated'),
      });
    }
    if (trade.postTradeEvaluation) {
      fallbackEvents.push({
        id: 'legacy-eval',
        type: 'EVALUATION_ADDED',
        timestamp: trade.updatedAt || trade.dateTime,
        label: tr('Evaluasi disimpan', 'Evaluation saved'),
        note: tr('Tinjauan selesai', 'Review completed'),
      });
    }
    return fallbackEvents;
  }, [resolved, trade, settings, preferredCurrency, formatTradeFinancial, tr]);

  // Synchronize form inputs only when switching to a different trade ID or when external trade updates
  useEffect(() => {
    if (!trade || !resolved) return;
    const parsedEval = parseStructuredEvaluation(trade.postTradeEvaluation);
    setEvalEntryQualityInput(parsedEval.entryQuality);
    setEvalEmotionalControlInput(parsedEval.emotionalControl);
    setEvalWentWellInput(parsedEval.wentWell);
    setEvalNeedsImprovementInput(parsedEval.needsImprovement);
    setEvalReflectionInput(parsedEval.lessonsLearned);
    setEvalNotesInput(trade.notes || '');
    setEvalDisciplineRatingInput(
      typeof trade.disciplineRating === 'number' && trade.disciplineRating >= 1 && trade.disciplineRating <= 5
        ? trade.disciplineRating
        : null
    );

    setPlanStrategyInput(trade.strategy || '');
    setPlanSessionInput(trade.session || 'London');
    setPlanEntryReasonInput(trade.entryReason || '');
    setPlanNotesInput(trade.notes || '');

    setIsEditingEval(false);
    setIsEditingPlanNotes(false);
    setActiveTransitionPanel(null);
    setTransitionError(null);
    setSaveFeedback(null);

    const nowLocal = normalizeTradeDateTimeLocal(new Date());
    setActualEntryInput(String(resolved.plannedEntry || trade.entryPrice || ''));
    setActualLotInput(String(resolved.plannedLot || trade.lotSize || '0.01'));
    setEntryDateInput(nowLocal.slice(0, 10));
    setEntryTimeInput(nowLocal.slice(11, 16));
    setCancelReasonInput('');

    const defaultCloseType: TradeCloseType =
      trade.takeProfit && trade.takeProfit > 0
        ? 'TP'
        : trade.stopLoss && trade.stopLoss > 0
        ? 'SL'
        : 'Manual';
    setCloseTypeInput(defaultCloseType);
    setActualExitInput(
      defaultCloseType === 'TP' && trade.takeProfit
        ? String(trade.takeProfit)
        : defaultCloseType === 'SL' && trade.stopLoss
        ? String(trade.stopLoss)
        : trade.exitPrice
        ? String(trade.exitPrice)
        : String(trade.entryPrice || '')
    );
    setExitDateInput(nowLocal.slice(0, 10));
    setExitTimeInput(nowLocal.slice(11, 16));
    setCloseNetOverrideInput('');
  }, [trade?.id, trade?.updatedAt]);

  // Close overflow menu when clicking outside
  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isMoreMenuOpen]);

  useEffect(() => {
    if (!isOpen || isChildModalOpen || isFullPage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isChildModalOpen, isFullPage, onClose]);

  // Auto-dismiss save feedback banner
  useEffect(() => {
    if (!saveFeedback) return;
    const timer = setTimeout(() => setSaveFeedback(null), 3500);
    return () => clearTimeout(timer);
  }, [saveFeedback]);

  // Resolve BEFORE screenshot URL
  useEffect(() => {
    const rawBefore = resolved?.beforeScreenshotUrl || trade?.screenshotUrl || '';
    if (!isOpen || !rawBefore) {
      setBeforeDisplayUrl(null);
      setIsBeforeLoading(false);
      return;
    }

    const trimmed = rawBefore.trim();
    if (trimmed.startsWith('data:image/')) {
      setBeforeDisplayUrl(trimmed);
      setIsBeforeLoading(false);
      return;
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const resolvedTv = resolveTradingViewSnapshotUrl(trimmed);
      setBeforeDisplayUrl(resolvedTv.directImageUrl || trimmed);
      setIsBeforeLoading(false);
      return;
    }

    if (isStoragePath(trimmed)) {
      let isMounted = true;
      setIsBeforeLoading(true);
      createScreenshotSignedUrl(trimmed, 3600)
        .then((url) => {
          if (!isMounted) return;
          setIsBeforeLoading(false);
          setBeforeDisplayUrl(url);
        })
        .catch(() => {
          if (!isMounted) return;
          setIsBeforeLoading(false);
          setBeforeDisplayUrl(null);
        });
      return () => {
        isMounted = false;
      };
    }

    setBeforeDisplayUrl(trimmed);
    setIsBeforeLoading(false);
  }, [isOpen, resolved?.beforeScreenshotUrl, trade?.screenshotUrl]);

  // Resolve AFTER screenshot URL
  useEffect(() => {
    const rawAfter = resolved?.afterScreenshotUrl || '';
    if (!isOpen || !rawAfter) {
      setAfterDisplayUrl(null);
      setIsAfterLoading(false);
      return;
    }

    const trimmed = rawAfter.trim();
    if (trimmed.startsWith('data:image/')) {
      setAfterDisplayUrl(trimmed);
      setIsAfterLoading(false);
      return;
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const resolvedTv = resolveTradingViewSnapshotUrl(trimmed);
      setAfterDisplayUrl(resolvedTv.directImageUrl || trimmed);
      setIsAfterLoading(false);
      return;
    }

    if (isStoragePath(trimmed)) {
      let isMounted = true;
      setIsAfterLoading(true);
      createScreenshotSignedUrl(trimmed, 3600)
        .then((url) => {
          if (!isMounted) return;
          setIsAfterLoading(false);
          setAfterDisplayUrl(url);
        })
        .catch(() => {
          if (!isMounted) return;
          setIsAfterLoading(false);
          setAfterDisplayUrl(null);
        });
      return () => {
        isMounted = false;
      };
    }

    setAfterDisplayUrl(trimmed);
    setIsAfterLoading(false);
  }, [isOpen, resolved?.afterScreenshotUrl]);

  // Default primary image slot selection based on availability
  useEffect(() => {
    if (beforeDisplayUrl) {
      setActivePrimarySlot('BEFORE');
    } else if (afterDisplayUrl) {
      setActivePrimarySlot('AFTER');
    } else {
      setActivePrimarySlot('BEFORE');
    }
  }, [beforeDisplayUrl, afterDisplayUrl]);

  if (!isOpen) return null;

  if (!trade || !resolved) {
    return (
      <div
        data-testid="trade-detail-empty-state"
        className="rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none p-8 text-center space-y-3 max-w-2xl mx-auto"
      >
        <h2 className="text-base font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
          {tr('Belum Ada Transaksi Dipilih', 'No Trade Selected')}
        </h2>
        <p className="text-xs text-[#526071] dark:text-[#929BA9] max-w-md mx-auto leading-relaxed">
          {tr(
            'Pilih salah satu transaksi dari halaman Jurnal Trade untuk melihat detail rencana, eksekusi, chart screenshot, evaluasi, dan riwayat aktivitas.',
            'Select a trade from the Trade Log page to view its plan, execution, chart screenshots, evaluation, and activity history.'
          )}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#050607] text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
        >
          <ArrowLeft className="h-3.5 w-3.5 stroke-[1.75]" />
          <span>{tr('Kembali ke Jurnal Trade', 'Back to Trade Log')}</span>
        </button>
      </div>
    );
  }

  // Plan metrics strictly calculated from Planned values
  const planLotMetrics = calculateLotBasedOrderMetrics(
    {
      symbol: trade.instrument,
      position: trade.position,
      lotSize: resolved.plannedLot,
      entryPrice: resolved.plannedEntry,
      stopLossPrice: resolved.plannedStopLoss,
      takeProfitPrice: resolved.plannedTakeProfit,
      capitalBasis: settings.startingBalance,
    },
    settings
  );

  const plannedRR = computePlannedRiskReward(
    resolved.plannedEntry,
    resolved.plannedStopLoss,
    resolved.plannedTakeProfit,
    trade.position
  );

  const isClosed = resolved.status === 'CLOSED';
  const isPlanned = resolved.status === 'PLANNED';
  const isOpenPos = resolved.status === 'OPEN';
  const isCancelled = resolved.status === 'CANCELLED';

  const isProfit = isClosed && trade.netProfit >= 0.01;
  const isLoss = isClosed && trade.netProfit <= -0.01;
  const realizedR = isClosed ? computeRealizedRMultiple(trade) : null;
  const compliance = evaluateTradeCompliance(trade, settings);
  const { cleanNotes: cleanExecutionNotes } = parseExecutionAdherenceTag(trade.executionNotes);
  const parsedEvalView = parseStructuredEvaluation(trade.postTradeEvaluation);
  const recordedTimeframe = extractRecordedTimeframe(trade);

  // Derive concise semantic status label for Header ("TP HIT", "SL HIT", "ACTIVE", "PLANNED", "CLOSED", "CANCELLED")
  const headerStatusLabel = (() => {
    if (isPlanned) return tr('RENCANA', 'PLANNED');
    if (isOpenPos) return tr('AKTIF', 'ACTIVE');
    if (isCancelled) return tr('DIBATALKAN', 'CANCELLED');
    if (
      resolved.closeType === 'TP' ||
      compliance.status === 'COMPLIANT_TP' ||
      (isProfit &&
        trade.takeProfit &&
        trade.exitPrice &&
        Math.abs(trade.exitPrice - trade.takeProfit) <=
          Math.abs(trade.takeProfit - trade.entryPrice) * 0.15)
    ) {
      return 'TP HIT';
    }
    if (
      resolved.closeType === 'SL' ||
      compliance.status === 'COMPLIANT_SL' ||
      compliance.status === 'VIOLATION_SL' ||
      (isLoss &&
        trade.stopLoss &&
        trade.exitPrice &&
        Math.abs(trade.exitPrice - trade.stopLoss) <=
          Math.abs(trade.entryPrice - trade.stopLoss) * 0.2)
    ) {
      return 'SL HIT';
    }
    if (isProfit) return tr('SELESAI · MENANG', 'CLOSED · WIN');
    if (isLoss) return tr('SELESAI · RUGI', 'CLOSED · LOSS');
    return tr('SELESAI · IMPAS', 'CLOSED · BE');
  })();

  // Header summary primary metric (R-Multiple or Planned R:R or Net P/L)
  const headerPrimaryMetric = (() => {
    if (isClosed) {
      if (realizedR !== null) {
        return formatRMultiple(realizedR);
      }
      return preferredCurrency === 'IDR'
        ? formatTradeFinancial(trade, 'netProfit', false, true)
        : `${isProfit ? '+' : ''}${formatCurrency(trade.netProfit, settings)}`;
    }
    if (isCancelled) {
      return '0.00R';
    }
    return formatPlannedRR(plannedRR);
  })();

  const headerSecondaryMetric = (() => {
    if (isClosed) {
      return preferredCurrency === 'IDR'
        ? formatTradeFinancial(trade, 'netProfit', false, true)
        : `${isProfit ? '+' : ''}${formatCurrency(trade.netProfit, settings)}`;
    }
    if (isCancelled) {
      return tr('Order Dibatalkan', 'Order Cancelled');
    }
    return isPlanned ? tr('Target R:R Rencana', 'Planned R:R Target') : tr('Target R:R Aktif', 'Active R:R Target');
  })();

  const summaryEntryPrice =
    isOpenPos || isClosed
      ? resolved.actualEntry ?? resolved.plannedEntry ?? trade.entryPrice
      : resolved.plannedEntry ?? trade.entryPrice;
  const summaryStopLoss = resolved.plannedStopLoss ?? trade.stopLoss;
  const summaryTakeProfit = resolved.plannedTakeProfit ?? trade.takeProfit;

  const screenshotCount =
    (resolved.beforeScreenshotUrl || trade.screenshotUrl ? 1 : 0) +
    (resolved.afterScreenshotUrl ? 1 : 0);

  // Compress and persist BEFORE or AFTER screenshot (Universal JPEG for 100% Supabase Storage compatibility)
  const handleScreenshotSlotUpload = (
    slot: 'BEFORE' | 'AFTER',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !onSaveTradeUpdate) return;
    if (file.size > 10 * 1024 * 1024) {
      setSaveFeedback({
        type: 'error',
        message: tr('Ukuran file gambar maksimal 10 MB.', 'Maximum image file size is 10 MB.'),
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 1280;
        let width = img.width;
        let height = img.height;
        if (width > height && width > MAX_DIM) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else if (height >= width && height > MAX_DIM) {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        let compressedDataUrl = event.target?.result as string;
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          canvas.width = 0;
          canvas.height = 0;
        }

        setIsUploadingImage(true);
        try {
          const nowIso = new Date().toISOString();
          const nextMainScreenshot =
            slot === 'BEFORE' ? compressedDataUrl : trade.screenshotUrl;
          const nextBeforeMeta =
            slot === 'BEFORE'
              ? undefined
              : resolved.beforeScreenshotUrl &&
                  resolved.beforeScreenshotUrl !== nextMainScreenshot
                ? resolved.beforeScreenshotUrl
                : undefined;

          const nextLog = [
            ...resolved.activityLog,
            createActivityEvent('TRADE_CREATED', tr('Screenshot ditambahkan', 'Screenshot added'), {
              timestamp: nowIso,
              newValue: slot === 'BEFORE' ? 'Before Trade Chart' : 'After Trade Chart',
              note: tr('Gambar chart disimpan', 'Chart image saved'),
            }),
          ];

          const nextMeta: TradeLifecycleMeta = {
            status: resolved.status,
            orderType: resolved.orderType,
            plannedEntry: resolved.plannedEntry,
            plannedLot: resolved.plannedLot,
            plannedStopLoss: resolved.plannedStopLoss,
            plannedTakeProfit: resolved.plannedTakeProfit,
            plannedDateTime: resolved.plannedDateTime,
            actualEntry: resolved.actualEntry,
            actualLot: resolved.actualLot,
            actualExit: resolved.actualExit,
            entryTime: resolved.entryTime,
            exitTime: resolved.exitTime,
            closeType: resolved.closeType,
            beforeScreenshotUrl: nextBeforeMeta,
            afterScreenshotUrl:
              slot === 'AFTER' ? compressedDataUrl : resolved.afterScreenshotUrl,
            cancellationReason: resolved.cancellationReason,
            cancelledAt: resolved.cancelledAt,
            activityLog: nextLog,
          };

          const updatedTrade: Trade = {
            ...trade,
            screenshotUrl: nextMainScreenshot,
            executionNotes: encodeLifecycleMetaIntoExecutionNotes(
              trade.executionNotes,
              nextMeta
            ),
            updatedAt: nowIso,
          };
          const res = await onSaveTradeUpdate(updatedTrade, trade.id);
          if (!res || res.success !== false) {
            setActivePrimarySlot(slot);
            setSaveFeedback({
              type: 'success',
              message: tr(
                `Screenshot ${slot === 'BEFORE' ? 'Before' : 'After'} Trade berhasil disimpan.`,
                `${slot === 'BEFORE' ? 'Before' : 'After'} Trade screenshot saved successfully.`
              ),
            });
          } else {
            setSaveFeedback({
              type: 'error',
              message: res.error || tr('Gagal mengunggah screenshot.', 'Failed to upload screenshot.'),
            });
          }
        } finally {
          setIsUploadingImage(false);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteScreenshotSlot = async (slot: 'BEFORE' | 'AFTER') => {
    if (!onSaveTradeUpdate) return;
    setIsUploadingImage(true);
    try {
      const nextMainScreenshot = slot === 'BEFORE' ? undefined : trade.screenshotUrl;
      const nextBeforeMeta =
        slot === 'BEFORE'
          ? undefined
          : resolved.beforeScreenshotUrl && resolved.beforeScreenshotUrl !== nextMainScreenshot
            ? resolved.beforeScreenshotUrl
            : undefined;

      const nextMeta: TradeLifecycleMeta = {
        status: resolved.status,
        orderType: resolved.orderType,
        plannedEntry: resolved.plannedEntry,
        plannedLot: resolved.plannedLot,
        plannedStopLoss: resolved.plannedStopLoss,
        plannedTakeProfit: resolved.plannedTakeProfit,
        plannedDateTime: resolved.plannedDateTime,
        actualEntry: resolved.actualEntry,
        actualLot: resolved.actualLot,
        actualExit: resolved.actualExit,
        entryTime: resolved.entryTime,
        exitTime: resolved.exitTime,
        closeType: resolved.closeType,
        beforeScreenshotUrl: nextBeforeMeta,
        afterScreenshotUrl:
          slot === 'AFTER' ? undefined : resolved.afterScreenshotUrl,
        cancellationReason: resolved.cancellationReason,
        cancelledAt: resolved.cancelledAt,
        activityLog: resolved.activityLog,
      };

      const updatedTrade: Trade = {
        ...trade,
        screenshotUrl: nextMainScreenshot,
        executionNotes: encodeLifecycleMetaIntoExecutionNotes(
          trade.executionNotes,
          nextMeta
        ),
        updatedAt: new Date().toISOString(),
      };
      const res = await onSaveTradeUpdate(updatedTrade, trade.id);
      if (!res || res.success !== false) {
        setSaveFeedback({
          type: 'success',
          message: tr(
            `Screenshot ${slot === 'BEFORE' ? 'Before' : 'After'} Trade dihapus.`,
            `${slot === 'BEFORE' ? 'Before' : 'After'} Trade screenshot removed.`
          ),
        });
      }
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSavePlanDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveTradeUpdate || isSavingPlanNotes) return;
    setIsSavingPlanNotes(true);
    try {
      const nowIso = new Date().toISOString();
      const updatedTrade: Trade = {
        ...trade,
        strategy: planStrategyInput.trim() || trade.strategy,
        session: planSessionInput.trim() || trade.session,
        entryReason: planEntryReasonInput.trim() || undefined,
        notes: planNotesInput.trim() || undefined,
        updatedAt: nowIso,
      };
      const res = await onSaveTradeUpdate(updatedTrade, trade.id);
      if (!res || res.success !== false) {
        setEvalNotesInput(planNotesInput.trim());
        setIsEditingPlanNotes(false);
        setSaveFeedback({
          type: 'success',
          message: tr('Catatan rencana trading berhasil diperbarui.', 'Trading plan notes updated successfully.'),
        });
      } else {
        setSaveFeedback({
          type: 'error',
          message: res.error || tr('Gagal menyimpan perubahan rencana.', 'Failed to save plan changes.'),
        });
      }
    } finally {
      setIsSavingPlanNotes(false);
    }
  };

  const handleSaveEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveTradeUpdate || isSavingEval) return;
    setIsSavingEval(true);
    try {
      const nowIso = new Date().toISOString();
      const serializedPostEval = serializeStructuredEvaluation({
        entryQuality: evalEntryQualityInput,
        emotionalControl: evalEmotionalControlInput,
        wentWell: evalWentWellInput,
        needsImprovement: evalNeedsImprovementInput,
        lessonsLearned: evalReflectionInput,
      });

      const nextLog = [
        ...resolved.activityLog,
        createActivityEvent('EVALUATION_ADDED', tr('Evaluasi disimpan', 'Evaluation saved'), {
          timestamp: nowIso,
          note: serializedPostEval
            ? tr('Review dan refleksi pasca-trade diperbarui', 'Post-trade review and reflection updated')
            : tr('Catatan evaluasi diperbarui', 'Evaluation notes updated'),
        }),
      ];
      const nextMeta: TradeLifecycleMeta = {
        status: resolved.status,
        orderType: resolved.orderType,
        plannedEntry: resolved.plannedEntry,
        plannedLot: resolved.plannedLot,
        plannedStopLoss: resolved.plannedStopLoss,
        plannedTakeProfit: resolved.plannedTakeProfit,
        plannedDateTime: resolved.plannedDateTime,
        actualEntry: resolved.actualEntry,
        actualLot: resolved.actualLot,
        actualExit: resolved.actualExit,
        entryTime: resolved.entryTime,
        exitTime: resolved.exitTime,
        closeType: resolved.closeType,
        beforeScreenshotUrl: resolved.beforeScreenshotUrl,
        afterScreenshotUrl: resolved.afterScreenshotUrl,
        cancellationReason: resolved.cancellationReason,
        cancelledAt: resolved.cancelledAt,
        activityLog: nextLog,
      };

      const updatedTrade: Trade = {
        ...trade,
        postTradeEvaluation: serializedPostEval,
        notes: evalNotesInput.trim() || undefined,
        disciplineRating: evalDisciplineRatingInput ?? trade.disciplineRating,
        executionNotes: encodeLifecycleMetaIntoExecutionNotes(
          trade.executionNotes,
          nextMeta
        ),
        updatedAt: nowIso,
      };
      const res = await onSaveTradeUpdate(updatedTrade, trade.id);
      if (!res || res.success !== false) {
        setPlanNotesInput(evalNotesInput.trim());
        setIsEditingEval(false);
        setSaveFeedback({
          type: 'success',
          message: tr('Evaluasi trade berhasil disimpan.', 'Trade evaluation saved successfully.'),
        });
      } else {
        setSaveFeedback({
          type: 'error',
          message: res.error || tr('Gagal menyimpan evaluasi.', 'Failed to save evaluation.'),
        });
      }
    } finally {
      setIsSavingEval(false);
    }
  };

  const handleExecuteTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveTradeUpdate || !activeTransitionPanel || isTransitionSaving) return;
    setTransitionError(null);

    try {
      let updatedTrade: Trade;
      if (activeTransitionPanel === 'OPEN') {
        if (!mt5Confirmed) {
          setTransitionError(
            tr(
              'Harap centang konfirmasi bahwa order telah tereksekusi di MT5.',
              'Please check the confirmation that the order was executed in MT5.'
            )
          );
          return;
        }
        const entryNum = parseFloat(actualEntryInput);
        const lotNum = parseFloat(actualLotInput);
        if (isNaN(entryNum) || entryNum <= 0) {
          setTransitionError(
            tr('Entry Aktual wajib berupa angka positif.', 'Actual Entry must be a positive number.')
          );
          return;
        }
        if (isNaN(lotNum) || lotNum <= 0) {
          setTransitionError(
            tr('Lot Aktual wajib berupa angka lebih dari 0.', 'Actual Lot must be greater than 0.')
          );
          return;
        }
        updatedTrade = transitionPlannedTradeToOpen(trade, {
          actualEntryPrice: entryNum,
          actualLotSize: lotNum,
          entryTime:
            entryDateInput && entryTimeInput
              ? `${entryDateInput}T${entryTimeInput}`
              : new Date().toISOString(),
          settings,
        });
      } else if (activeTransitionPanel === 'CANCEL') {
        updatedTrade = transitionPlannedTradeToCancelled(trade, cancelReasonInput);
      } else {
        const exitNum = parseFloat(actualExitInput);
        if (isNaN(exitNum) || exitNum <= 0) {
          setTransitionError(
            tr('Exit Aktual wajib berupa angka positif.', 'Actual Exit must be a positive number.')
          );
          return;
        }
        const overrideNet =
          closeNetOverrideInput.trim() !== '' ? parseFloat(closeNetOverrideInput) : undefined;
        updatedTrade = transitionOpenTradeToClosed(trade, {
          closeType: closeTypeInput,
          actualExitPrice: exitNum,
          exitTime:
            exitDateInput && exitTimeInput
              ? `${exitDateInput}T${exitTimeInput}`
              : new Date().toISOString(),
          overrideNetProfit:
            overrideNet !== undefined && !isNaN(overrideNet) ? overrideNet : undefined,
          closeExchangeRate: getCurrentUsdIdrSnapshot(getCachedUsdIdrRate()),
          settings,
        });
      }

      setIsTransitionSaving(true);
      const res = await onSaveTradeUpdate(updatedTrade, trade.id);
      if (!res || res.success !== false) {
        setActiveTransitionPanel(null);
        setSaveFeedback({
          type: 'success',
          message: tr('Status eksekusi trade berhasil diperbarui.', 'Trade execution status updated successfully.'),
        });
      } else {
        setTransitionError(
          res.error || tr('Gagal memperbarui status transaksi.', 'Failed to update trade status.')
        );
      }
    } catch (err: any) {
      setTransitionError(err?.message || tr('Gagal memperbarui status.', 'Failed to update status.'));
    } finally {
      setIsTransitionSaving(false);
    }
  };

  const sectionTabs: Array<{
    id: DetailSectionTab;
    label: string;
    testId: string;
    badge?: string | number;
  }> = [
    { id: 'plan', label: tr('Rencana', 'Plan'), testId: 'tab-trade-plan' },
    { id: 'execution', label: tr('Eksekusi', 'Execution'), testId: 'tab-execution' },
    {
      id: 'screenshots',
      label: tr('Chart', 'Chart'),
      testId: 'tab-screenshots',
      badge: screenshotCount > 0 ? screenshotCount : undefined,
    },
    { id: 'evaluation', label: tr('Evaluasi', 'Evaluation'), testId: 'tab-evaluation' },
    {
      id: 'activity',
      label: tr('Aktivitas', 'Activity'),
      testId: 'tab-activity-history',
      badge: timelineEvents.length > 0 ? timelineEvents.length : undefined,
    },
  ];

  const hasEntryDeviation =
    resolved.actualEntry !== undefined &&
    resolved.plannedEntry > 0 &&
    Math.abs(resolved.actualEntry - resolved.plannedEntry) > 0.00001;

  const hasLotDeviation =
    resolved.actualLot !== undefined &&
    resolved.plannedLot > 0 &&
    Math.abs(resolved.actualLot - resolved.plannedLot) > 0.001;

  return (
    <div
      data-testid="trade-detail-full-page"
      className="max-w-4xl mx-auto space-y-5 font-sans text-[#0F172A] dark:text-[#F2F4F7] pb-8"
    >
      {/* Save / Upload Feedback Banner */}
      {saveFeedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
            saveFeedback.type === 'success'
              ? 'bg-[#FAFAFA] dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#059669] dark:text-[#00A878]'
              : 'bg-[#FAFAFA] dark:bg-[#101318] border-[#E11D48]/30 dark:border-[#E05260]/30 text-[#E11D48] dark:text-[#E05260]'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveFeedback.type === 'success' ? (
              <Check className="h-3.5 w-3.5 shrink-0 stroke-[2]" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 stroke-[2]" />
            )}
            <span>{saveFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveFeedback(null)}
            className="text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] text-[11px] rounded-full px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
          >
            {tr('Tutup', 'Close')}
          </button>
        </div>
      )}

      {/* BAGIAN 2 — HEADER DAN RINGKASAN TRADE */}
      <div className="rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none transition-colors duration-150">
        {/* Top Action Bar: Back Button · Title · [Edit] [⋯] */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('Kembali ke Jurnal Trade', 'Back to Trade Log')}
              className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
            >
              <ArrowLeft className="h-4 w-4 stroke-[1.75]" />
            </button>
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#0F172A] dark:text-[#F2F4F7] truncate">
              {tr('DETAIL TRADE', 'TRADE DETAIL')}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {allTrades.length > 1 && onSelectTrade && (
              <select
                value={trade.id}
                onChange={(e) => {
                  const found = allTrades.find((item) => item.id === e.target.value);
                  if (found) onSelectTrade(found);
                }}
                aria-label={tr('Pilih transaksi lain', 'Select another trade')}
                className="hidden sm:block rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] hover:border-[#526071] dark:hover:border-[#2A313C] px-3 py-1.5 text-xs text-[#0F172A] dark:text-[#F2F4F7] font-mono-numbers tabular-nums focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 max-w-[190px] truncate"
              >
                {allTrades.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.instrument} · {item.position} · {(item.dateTime || '').slice(0, 10)}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => onEdit(trade)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              title={tr('Edit Transaksi', 'Edit Trade')}
            >
              <Edit2 className="h-3.5 w-3.5 stroke-[1.75]" />
              <span>{tr('Edit', 'Edit')}</span>
            </button>

            {/* Menu Tambahan [⋯] */}
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setIsMoreMenuOpen((prev) => !prev)}
                aria-label={tr('Menu tambahan', 'More actions')}
                aria-expanded={isMoreMenuOpen}
                className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                <MoreHorizontal className="h-4 w-4 stroke-[1.75]" />
              </button>

              {isMoreMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-lg dark:shadow-none py-1.5 z-30 text-xs">
                  {allTrades.length > 1 && onSelectTrade && (
                    <div className="px-3 py-1.5 border-b border-[#E4E4E7] dark:border-[#20252D] sm:hidden">
                      <label className="block text-[10px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Pindah Catatan Trade', 'Switch Trade Record')}
                      </label>
                      <select
                        value={trade.id}
                        onChange={(e) => {
                          const found = allTrades.find((item) => item.id === e.target.value);
                          if (found) {
                            onSelectTrade(found);
                            setIsMoreMenuOpen(false);
                          }
                        }}
                        className="w-full rounded-md bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-2 py-1 text-xs font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      >
                        {allTrades.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.instrument} ({item.position}) · {(item.dateTime || '').slice(0, 10)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {onSaveTradeUpdate && isPlanned && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setActiveTransitionPanel('OPEN');
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 stroke-[1.75] text-[#0F172A] dark:text-[#F2F4F7]" />
                        <span>{tr('Konfirmasi Posisi Dibuka', 'Confirm Position Opened')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setActiveTransitionPanel('CANCEL');
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#526071] dark:text-[#929BA9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      >
                        <XCircle className="h-3.5 w-3.5 stroke-[1.75]" />
                        <span>{tr('Batalkan Rencana Order', 'Cancel Planned Order')}</span>
                      </button>
                    </>
                  )}

                  {onSaveTradeUpdate && isOpenPos && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        setActiveTransitionPanel('CLOSE');
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      <Lock className="h-3.5 w-3.5 stroke-[1.75] text-[#0F172A] dark:text-[#F2F4F7]" />
                      <span>{tr('Tutup Posisi', 'Close Position')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onDelete(trade);
                    }}
                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-[#E11D48] dark:text-[#E05260] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  >
                    <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
                    <span>{tr('Hapus Catatan Trade', 'Delete Trade Record')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Core Trade Summary Area */}
        <div className="px-4 sm:px-6 py-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            {/* Left: Instrument + Direction + Timeframe & Date */}
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-[#F2F4F7]">
                  {trade.instrument}
                </h1>
                {recordedTimeframe && (
                  <span className="text-xs font-medium text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                    {recordedTimeframe}
                  </span>
                )}
              </div>

              {/* Short Dashboard-style tertiary accent line */}
              <div className="w-8 h-0.5 bg-[#0F172A] dark:bg-[#F2F4F7] rounded-full" />

              <div className="flex items-center gap-2 flex-wrap text-xs pt-0.5">
                <span
                  className={`font-bold uppercase tracking-wide ${
                    trade.position === 'BUY'
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : 'text-[#E11D48] dark:text-[#E05260]'
                  }`}
                >
                  {trade.position}
                </span>
                <span className="text-[#E4E4E7] dark:text-[#20252D]" aria-hidden="true">
                  ·
                </span>
                <span className="text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                  {(resolved.entryTime || trade.dateTime || '').slice(0, 16).replace('T', ' ')}
                </span>
                {trade.id && (
                  <>
                    <span className="text-[#E4E4E7] dark:text-[#20252D]" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums truncate max-w-[140px]">
                      {trade.id}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Status & Result / R:R */}
            <div className="text-right shrink-0 space-y-0.5">
              <div
                data-testid="trade-detail-status-badge"
                className={`text-xs font-bold uppercase tracking-[0.06em] ${
                  isClosed && isProfit
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : isClosed && isLoss
                    ? 'text-[#E11D48] dark:text-[#E05260]'
                    : isOpenPos
                    ? 'text-[#D97706] dark:text-[#F59E0B]'
                    : isPlanned
                    ? 'text-[#0F172A] dark:text-[#F2F4F7]'
                    : 'text-[#526071] dark:text-[#929BA9]'
                }`}
              >
                {headerStatusLabel}
              </div>

              <div
                className={`text-2xl sm:text-3xl font-bold font-mono-numbers tabular-nums tracking-tight ${
                  isClosed
                    ? isProfit
                      ? 'text-[#059669] dark:text-[#00A878]'
                      : isLoss
                      ? 'text-[#E11D48] dark:text-[#E05260]'
                      : 'text-[#0F172A] dark:text-[#F2F4F7]'
                    : 'text-[#0F172A] dark:text-[#F2F4F7]'
                }`}
              >
                {headerPrimaryMetric}
              </div>

              <div className="text-[11px] text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                {headerSecondaryMetric}
              </div>
            </div>
          </div>

          {/* Price Strip: Entry | Stop Loss | Take Profit */}
          <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] grid grid-cols-3 gap-4 sm:gap-6">
            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                Entry
              </span>
              <span className="mt-0.5 block text-sm sm:text-base font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {formatActualPrice(summaryEntryPrice, trade.instrument)}
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                Stop Loss
              </span>
              <span className="mt-0.5 block text-sm sm:text-base font-semibold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                {formatActualPrice(summaryStopLoss, trade.instrument)}
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                Take Profit
              </span>
              <span className="mt-0.5 block text-sm sm:text-base font-semibold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                {formatActualPrice(summaryTakeProfit, trade.instrument)}
              </span>
            </div>
          </div>

          {/* Quick Lifecycle Bar for PLANNED or OPEN trades */}
          {onSaveTradeUpdate && (isPlanned || isOpenPos) && (
            <div className="pt-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] flex flex-wrap items-center justify-between gap-2.5">
              <span className="text-xs text-[#526071] dark:text-[#929BA9]">
                {isPlanned
                  ? tr('Order masih berstatus rencana.', 'Order is still in planned status.')
                  : tr('Posisi sedang aktif berjalan di pasar.', 'Position is currently active in the market.')}
              </span>
              <div className="flex items-center gap-2">
                {isPlanned && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTransitionPanel(
                          activeTransitionPanel === 'OPEN' ? null : 'OPEN'
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#050607] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 stroke-[1.75]" />
                      <span>{tr('Konfirmasi Entry', 'Confirm Entry')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTransitionPanel(
                          activeTransitionPanel === 'CANCEL' ? null : 'CANCEL'
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-medium text-[#526071] dark:text-[#929BA9] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      <XCircle className="h-3.5 w-3.5 stroke-[1.75]" />
                      <span>{tr('Batalkan', 'Cancel')}</span>
                    </button>
                  </>
                )}

                {isOpenPos && (
                  <button
                    type="button"
                    onClick={() =>
                      setActiveTransitionPanel(
                        activeTransitionPanel === 'CLOSE' ? null : 'CLOSE'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#050607] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  >
                    <Lock className="h-3.5 w-3.5 stroke-[1.75]" />
                    <span>{tr('Tutup Posisi', 'Close Position')}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Inline Transition Form when triggered */}
          {activeTransitionPanel && (
            <form
              onSubmit={handleExecuteTransition}
              className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-3.5 text-xs"
            >
              {transitionError && (
                <div className="p-2.5 rounded-lg bg-white dark:bg-[#101318] border border-[#E11D48]/30 dark:border-[#E05260]/30 text-[#E11D48] dark:text-[#E05260]">
                  {transitionError}
                </div>
              )}

              {activeTransitionPanel === 'OPEN' && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer text-[#0F172A] dark:text-[#F2F4F7]">
                    <input
                      type="checkbox"
                      checked={mt5Confirmed}
                      onChange={(e) => setMt5Confirmed(e.target.checked)}
                      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                    <span>
                      {tr(
                        'Konfirmasi posisi benar-benar telah dibuka di pasar / MT5',
                        'Confirm the position has actually been opened in the market / MT5'
                      )}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Entry Aktual', 'Actual Entry')}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={actualEntryInput}
                        onChange={(e) => setActualEntryInput(e.target.value)}
                        className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Lot Aktual', 'Actual Lot')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={actualLotInput}
                        onChange={(e) => setActualLotInput(e.target.value)}
                        className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Tanggal Entry', 'Entry Date')}
                      </label>
                      <input
                        type="date"
                        value={entryDateInput}
                        onChange={(e) => setEntryDateInput(e.target.value)}
                        className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                        {tr('Jam Entry', 'Entry Time')}
                      </label>
                      <input
                        type="time"
                        value={entryTimeInput}
                        onChange={(e) => setEntryTimeInput(e.target.value)}
                        className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        required
                      />
                    </div>
                  </div>
                </>
              )}

              {activeTransitionPanel === 'CANCEL' && (
                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Alasan Pembatalan (Opsional)', 'Cancellation Reason (Optional)')}
                  </label>
                  <input
                    type="text"
                    value={cancelReasonInput}
                    onChange={(e) => setCancelReasonInput(e.target.value)}
                    placeholder={tr(
                      'Contoh: Setup tidak valid / harga melewati zona entry...',
                      'E.g., Setup invalidated / price missed entry zone...'
                    )}
                    className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>
              )}

              {activeTransitionPanel === 'CLOSE' && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('Jenis Penutupan', 'Close Type')}
                    </label>
                    <select
                      value={closeTypeInput}
                      onChange={(e) => {
                        const ct = e.target.value as TradeCloseType;
                        setCloseTypeInput(ct);
                        if (ct === 'TP' && trade.takeProfit) setActualExitInput(String(trade.takeProfit));
                        if (ct === 'SL' && trade.stopLoss) setActualExitInput(String(trade.stopLoss));
                      }}
                      className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-2.5 py-1.5 font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      <option value="TP">TP (Take Profit)</option>
                      <option value="SL">SL (Stop Loss)</option>
                      <option value="Manual">{tr('Tutup Manual', 'Manual Close')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('Exit Aktual', 'Actual Exit')}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={actualExitInput}
                      onChange={(e) => setActualExitInput(e.target.value)}
                      className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('Tanggal Exit', 'Exit Date')}
                    </label>
                    <input
                      type="date"
                      value={exitDateInput}
                      onChange={(e) => setExitDateInput(e.target.value)}
                      className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('Jam Exit', 'Exit Time')}
                    </label>
                    <input
                      type="time"
                      value={exitTimeInput}
                      onChange={(e) => setExitTimeInput(e.target.value)}
                      className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('P/L Bersih (Opsional)', 'Net P/L (Optional)')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={closeNetOverrideInput}
                      onChange={(e) => setCloseNetOverrideInput(e.target.value)}
                      placeholder={tr('Otomatis', 'Auto')}
                      className="w-full rounded-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-1.5 font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTransitionPanel(null)}
                  className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] font-medium text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isTransitionSaving}
                  className="px-4 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#050607] font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                >
                  {isTransitionSaving ? tr('Menyimpan...', 'Saving...') : tr('Simpan Status', 'Save Status')}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* BAGIAN 3 — NAVIGASI LIMA BAGIAN (Monochrome / Subtle White Underline Indicator) */}
        <div
          role="tablist"
          aria-label={tr('Bagian Detail Trade', 'Trade Detail Sections')}
          className="flex items-center gap-1 sm:gap-2 px-4 sm:px-6 border-t border-[#E4E4E7] dark:border-[#20252D] overflow-x-auto"
        >
          {sectionTabs.map((tab) => {
            const isActive = activeSectionTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-testid={tab.testId}
                aria-selected={isActive}
                onClick={() => setActiveSectionTab(tab.id)}
                className={`relative py-3 px-3 sm:px-4 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                  isActive
                    ? 'border-[#0F172A] dark:border-[#F2F4F7] text-[#0F172A] dark:text-[#F2F4F7] font-bold'
                    : 'border-transparent text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className="ml-1.5 text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                    ({tab.badge})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* BAGIAN 4 — KONTEN BAGIAN AKTIF (SATU AREA KONTEN TERFOKUS) */}

      {/* A. RENCANA */}
      {activeSectionTab === 'plan' && (
        <div
          data-testid="accordion-trade-plan"
          role="tabpanel"
          className="rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none p-5 sm:p-6 space-y-6 transition-colors duration-150"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Rencana Trading', 'Trading Plan')}
              </h2>
              <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                {tr(
                  'Tesis analisis, parameter order rencana, dan konteks pasar sebelum posisi dibuka',
                  'Analysis thesis, planned order parameters, and market context before opening position'
                )}
              </p>
            </div>
            {onSaveTradeUpdate && !isEditingPlanNotes && (
              <button
                type="button"
                onClick={() => setIsEditingPlanNotes(true)}
                className="px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {tr('Ubah Rencana', 'Edit Plan')}
              </button>
            )}
          </div>

          {/* 1. Market Bias & Setup / Strategi */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 gap-x-6 pt-4 border-t border-[#E4E4E7] dark:border-[#20252D]">
            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Bias Pasar', 'Market Bias')}
              </span>
              <span
                className={`mt-1 block text-sm font-semibold ${
                  trade.position === 'BUY'
                    ? 'text-[#059669] dark:text-[#00A878]'
                    : 'text-[#E11D48] dark:text-[#E05260]'
                }`}
              >
                {trade.position === 'BUY'
                  ? tr('Bullish (Beli)', 'Bullish (Buy)')
                  : tr('Bearish (Jual)', 'Bearish (Sell)')}
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Setup / Strategi', 'Setup / Strategy')}
              </span>
              <span className="mt-1 block text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {trade.strategy || '—'}
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Kondisi Pasar / Sesi', 'Market Condition / Session')}
              </span>
              <span className="mt-1 block text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {trade.session || 'London'}
                {recordedTimeframe ? ` · ${recordedTimeframe}` : ''}
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Tipe & Jadwal Rencana', 'Order Type & Planned Schedule')}
              </span>
              <span className="mt-1 block text-sm font-medium font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {resolved.orderType} · {(resolved.plannedDateTime || '').slice(0, 16).replace('T', ' ')}
              </span>
            </div>
          </div>

          {/* Macro News Context & Behavioral Metadata Row (rendered only when relevant) */}
          {(() => {
            const nearbyNews = findNearbyMacroEventsForTrade(trade);
            const behavior = resolveTradeBehavior(trade);
            const hasMeta =
              nearbyNews.length > 0 ||
              behavior.mistakeTags.length > 0 ||
              Boolean(behavior.emotionTag) ||
              typeof behavior.ruleCompliant === 'boolean' ||
              typeof behavior.checklistPassed === 'boolean';
            if (!hasMeta) return null;
            return (
              <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2.5">
                {nearbyNews.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#D97706] dark:text-[#F59E0B]">
                      <Newspaper className="h-3.5 w-3.5" />
                      {tr('Konteks Berita USD:', 'USD News Context:')}
                    </span>
                    {nearbyNews.map((ev) => {
                      const deltaText =
                        ev.proximity === 'IMMEDIATE'
                          ? ev.minutesDelta >= 0
                            ? tr(`${ev.minutesDelta} mnt sebelum rilis`, `${ev.minutesDelta}m before release`)
                            : tr(`${Math.abs(ev.minutesDelta)} mnt sesudah rilis`, `${Math.abs(ev.minutesDelta)}m after release`)
                          : tr('Hari yang sama', 'Same day');
                      return (
                        <span
                          key={ev.eventId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#D97706]/35 dark:border-[#F59E0B]/35 text-[11px] font-medium text-[#0F172A] dark:text-[#F2F4F7]"
                        >
                          <span className="font-bold text-[#D97706] dark:text-[#F59E0B]">{ev.impact}</span>
                          <span>{ev.title}</span>
                          <span className="text-[#526071] dark:text-[#929BA9] font-mono-numbers">({deltaText})</span>
                        </span>
                      );
                    })}
                  </div>
                )}

                {(behavior.mistakeTags.length > 0 ||
                  behavior.emotionTag ||
                  typeof behavior.ruleCompliant === 'boolean' ||
                  typeof behavior.checklistPassed === 'boolean') && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {typeof behavior.ruleCompliant === 'boolean' && (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                          behavior.ruleCompliant
                            ? 'bg-[#059669]/10 text-[#059669] border-[#059669]/25 dark:bg-[#00A878]/15 dark:text-[#00A878]'
                            : 'bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/25 dark:bg-[#E05260]/15 dark:text-[#E05260]'
                        }`}
                      >
                        {behavior.ruleCompliant
                          ? tr('Patuh Guardrail', 'Rule Compliant')
                          : tr('Langgar Guardrail', 'Rule Breached')}
                      </span>
                    )}
                    {typeof behavior.checklistPassed === 'boolean' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9]">
                        {behavior.checklistPassed
                          ? tr('Checklist SOP ✓', 'SOP Checklist ✓')
                          : tr('Checklist SOP Parsial', 'Partial SOP Checklist')}
                      </span>
                    )}
                    {behavior.emotionTag && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7]">
                        {tr('Emosi:', 'Emotion:')} {getEmotionLabel(behavior.emotionTag, language === 'en')}
                      </span>
                    )}
                    {behavior.mistakeTags.map((tagId) => (
                      <span
                        key={tagId}
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                          tagId === 'A_PLUS_SETUP'
                            ? 'bg-[#059669]/10 text-[#059669] border-[#059669]/25 dark:bg-[#00A878]/15 dark:text-[#00A878]'
                            : 'bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/25 dark:bg-[#E05260]/15 dark:text-[#E05260]'
                        }`}
                      >
                        {getMistakeLabel(tagId, language === 'en')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* 2. Parameter Harga Rencana & Risk:Reward */}
          <div className="pt-5 border-t border-[#E4E4E7] dark:border-[#20252D] grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-6">
            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Rencana Entry', 'Entry Plan')}
              </span>
              <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {formatActualPrice(resolved.plannedEntry, trade.instrument)}
              </span>
              <span className="mt-0.5 block text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                {tr('Ukuran:', 'Size:')} {resolved.plannedLot.toFixed(2)} Lot
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Rencana Stop Loss', 'Stop Loss Plan')}
              </span>
              <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                {formatActualPrice(resolved.plannedStopLoss, trade.instrument)}
              </span>
              {planLotMetrics.slDistancePips !== null && (
                <span className="mt-0.5 block text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                  {tr('Jarak:', 'Distance:')} {planLotMetrics.slDistancePips} pips
                </span>
              )}
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Rencana Take Profit', 'Take Profit Plan')}
              </span>
              <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                {formatActualPrice(resolved.plannedTakeProfit, trade.instrument)}
              </span>
              {planLotMetrics.tpDistancePips !== null && (
                <span className="mt-0.5 block text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                  {tr('Target:', 'Target:')} {planLotMetrics.tpDistancePips} pips
                </span>
              )}
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Rasio Risiko:Imbalan (R:R)', 'Risk:Reward')}
              </span>
              <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {formatPlannedRR(plannedRR)}
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Estimasi Risiko', 'Estimated Risk')}
              </span>
              <span className="mt-1 block text-sm font-semibold font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                {planLotMetrics.riskAmount !== null
                  ? preferredCurrency === 'IDR'
                    ? formatDynamic(planLotMetrics.riskAmount)
                    : formatCurrency(planLotMetrics.riskAmount, settings)
                  : preferredCurrency === 'IDR'
                  ? formatDynamic(trade.riskAmount)
                  : formatCurrency(trade.riskAmount, settings)}
                {trade.riskPercentage > 0 ? ` (${trade.riskPercentage.toFixed(2)}%)` : ''}
              </span>
            </div>

            <div>
              <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Potensi Target Profit', 'Potential Target Profit')}
              </span>
              <span className="mt-1 block text-sm font-semibold font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                {planLotMetrics.potentialProfit !== null
                  ? preferredCurrency === 'IDR'
                    ? formatDynamic(planLotMetrics.potentialProfit)
                    : formatCurrency(planLotMetrics.potentialProfit, settings)
                  : '—'}
              </span>
            </div>
          </div>

          {/* 3. Alasan Entry, Kondisi Market & Catatan Tambahan */}
          <div className="pt-5 border-t border-[#E4E4E7] dark:border-[#20252D]">
            {isEditingPlanNotes ? (
              <form onSubmit={handleSavePlanDetails} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('Setup / Strategi', 'Setup / Strategy')}
                    </label>
                    <input
                      type="text"
                      value={planStrategyInput}
                      onChange={(e) => setPlanStrategyInput(e.target.value)}
                      placeholder={tr('Contoh: Order Block + FVG', 'Example: Order Block + FVG')}
                      className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 text-xs text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('Sesi / Kondisi Pasar', 'Session / Market Condition')}
                    </label>
                    <select
                      value={planSessionInput}
                      onChange={(e) => setPlanSessionInput(e.target.value)}
                      className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 text-xs text-[#0F172A] dark:text-[#F2F4F7] focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      <option value="Asian">{tr('Sesi Asia', 'Asian Session')}</option>
                      <option value="London">{tr('Sesi London', 'London Session')}</option>
                      <option value="New York">{tr('Sesi New York', 'New York Session')}</option>
                      <option value="Overlap">{tr('Overlap London / NY', 'London / NY Overlap')}</option>
                      <option value="Other">{tr('Lainnya', 'Other')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Alasan Entry & Tesis Analisis', 'Entry Reason & Analysis Thesis')}
                  </label>
                  <textarea
                    rows={3}
                    value={planEntryReasonInput}
                    onChange={(e) => setPlanEntryReasonInput(e.target.value)}
                    placeholder={tr(
                      'Jelaskan konfluensi teknikal, struktur pasar, dan alasan mengambil setup ini...',
                      'Explain technical confluences, market structure, and why you took this setup...'
                    )}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-3 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Catatan Tambahan', 'Additional Notes')}
                  </label>
                  <textarea
                    rows={2}
                    value={planNotesInput}
                    onChange={(e) => setPlanNotesInput(e.target.value)}
                    placeholder={tr(
                      'Catatan manajemen posisi atau kondisi berita makro...',
                      'Position management notes or macro news conditions...'
                    )}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-3 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingPlanNotes(false)}
                    className="px-4 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-xs font-medium text-[#526071] dark:text-[#929BA9] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  >
                    {tr('Batal', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingPlanNotes}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#050607] text-xs font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  >
                    <Save className="h-3.5 w-3.5 stroke-[1.75]" />
                    <span>
                      {isSavingPlanNotes
                        ? tr('Menyimpan...', 'Saving...')
                        : tr('Simpan Rencana', 'Save Plan')}
                    </span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Alasan Entry', 'Entry Reason')}
                  </span>
                  {trade.entryReason ? (
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed max-w-3xl text-editorial-justify">
                      {trade.entryReason}
                    </p>
                  ) : (
                    <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                      {tr('Belum ada alasan entry yang dicatat.', 'No entry reason recorded yet.')}
                    </p>
                  )}
                </div>

                <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D]">
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Catatan Tambahan', 'Additional Notes')}
                  </span>
                  {trade.notes ? (
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed max-w-3xl text-editorial-justify">
                      {trade.notes}
                    </p>
                  ) : (
                    <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                      {tr(
                        'Tidak ada catatan tambahan pada rencana ini.',
                        'No additional notes for this plan.'
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* B. EKSEKUSI */}
      {activeSectionTab === 'execution' && (
        <div
          data-testid="accordion-execution"
          role="tabpanel"
          className="rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none p-5 sm:p-6 space-y-6 transition-colors duration-150"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Realisasi Eksekusi', 'Execution Realization')}
              </h2>
              <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                {tr(
                  'Data aktual pembukaan posisi, penutupan, biaya transaksi, dan hasil bersih',
                  'Actual position entry, exit, transaction costs, and net result data'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onEdit(trade)}
              className="px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
            >
              {tr('Edit Data Eksekusi', 'Edit Execution Data')}
            </button>
          </div>

          {isPlanned ? (
            <div className="py-6 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2">
              <p className="text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                {tr(
                  'Posisi Belum Dieksekusi (Status: DIRENCANAKAN)',
                  'Position Not Yet Executed (Status: PLANNED)'
                )}
              </p>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] max-w-xl leading-relaxed text-editorial-justify">
                {tr('Catatan ini masih berupa rencana order (', 'This entry is still a planned order (')}
                {resolved.orderType} @{' '}
                <span className="font-mono-numbers tabular-nums font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                  {formatActualPrice(resolved.plannedEntry, trade.instrument)}
                </span>
                {tr(
                  '). Gunakan tombol Konfirmasi Entry di bagian atas saat order tereksekusi di pasar.',
                  '). Use the Confirm Entry button at the top once the order is executed in the market.'
                )}
              </p>
            </div>
          ) : isCancelled ? (
            <div className="py-6 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2">
              <p className="text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Rencana Order Dibatalkan (DIBATALKAN)', 'Planned Order Cancelled (CANCELLED)')}
              </p>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] max-w-xl leading-relaxed text-editorial-justify">
                {tr(
                  'Order dibatalkan sebelum tereksekusi di pasar dan tidak memengaruhi perhitungan Win Rate maupun kerugian akun.',
                  'The order was cancelled before execution in the market and does not affect Win Rate or account drawdown calculations.'
                )}
              </p>
              {resolved.cancellationReason && (
                <p className="text-xs text-[#0F172A] dark:text-[#F2F4F7] pt-1">
                  {tr('Alasan Pembatalan:', 'Cancellation Reason:')} {resolved.cancellationReason}
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Primary Execution Numeric Grid (2 Columns on Mobile, 4 on Desktop) */}
              <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] grid grid-cols-2 sm:grid-cols-4 gap-y-5 gap-x-6">
                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Harga Entry Aktual', 'Actual Entry')}
                  </span>
                  <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                    {formatActualPrice(resolved.actualEntry, trade.instrument)}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Harga Exit Aktual', 'Actual Exit')}
                  </span>
                  <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                    {isClosed ? formatActualPrice(resolved.actualExit, trade.instrument) : '—'}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Ukuran Posisi (Lot)', 'Position Size (Lot)')}
                  </span>
                  <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                    {resolved.actualLot !== undefined
                      ? `${resolved.actualLot.toFixed(2)} Lot`
                      : `${trade.lotSize.toFixed(2)} Lot`}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Risiko Aktual', 'Actual Risk')}
                  </span>
                  <span className="mt-1 block text-base font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                    {preferredCurrency === 'IDR'
                      ? formatDynamic(trade.riskAmount)
                      : formatCurrency(trade.riskAmount, settings)}
                    {trade.riskPercentage > 0 ? ` (${trade.riskPercentage.toFixed(2)}%)` : ''}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Waktu Entry', 'Entry Time')}
                  </span>
                  <span className="mt-1 block text-xs sm:text-sm font-medium font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                    {(resolved.entryTime || trade.dateTime || '').slice(0, 16).replace('T', ' ')}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Waktu Exit', 'Exit Time')}
                  </span>
                  <span className="mt-1 block text-xs sm:text-sm font-medium font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                    {isClosed && resolved.exitTime
                      ? resolved.exitTime.slice(0, 16).replace('T', ' ')
                      : '—'}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Metode Penutupan', 'Close Method')}
                  </span>
                  <span className="mt-1 block text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {isClosed
                      ? resolved.closeType ||
                        (trade.outcome === 'WIN'
                          ? 'Take Profit (TP)'
                          : trade.outcome === 'LOSS'
                          ? 'Stop Loss (SL)'
                          : 'Manual / BE')
                      : tr('Masih Terbuka (Aktif)', 'Still Open (Active)')}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Hasil Aktual (L/R Bersih)', 'Actual Result (Net P/L)')}
                  </span>
                  {isClosed ? (
                    <span
                      className={`mt-1 block text-base font-bold font-mono-numbers tabular-nums ${
                        isProfit
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : isLoss
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {preferredCurrency === 'IDR'
                        ? formatTradeFinancial(trade, 'netProfit', false, true)
                        : `${isProfit ? '+' : ''}${formatCurrency(trade.netProfit, settings)}`}
                      {realizedR !== null ? ` (${formatRMultiple(realizedR)})` : ''}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs font-medium text-[#D97706] dark:text-[#F59E0B]">
                      {tr('Posisi Sedang Berjalan', 'Position Running')}
                    </span>
                  )}
                </div>
              </div>

              {/* Financial Breakdown (Gross Profit, Commission, Swap) when Closed */}
              {isClosed && (
                <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {tr('L/R Kotor', 'Gross P/L')}
                    </span>
                    <span className="mt-0.5 block font-mono-numbers tabular-nums font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                      {preferredCurrency === 'IDR'
                        ? formatTradeFinancial(trade, 'grossProfit', false, true)
                        : formatCurrency(trade.grossProfit, settings)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {tr('Komisi Broker', 'Broker Commission')}
                    </span>
                    <span className="mt-0.5 block font-mono-numbers tabular-nums font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                      {preferredCurrency === 'IDR'
                        ? formatDynamic(trade.commission || 0)
                        : formatCurrency(trade.commission || 0, settings)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                      {tr('Biaya Swap', 'Swap Fee')}
                    </span>
                    <span className="mt-0.5 block font-mono-numbers tabular-nums font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                      {preferredCurrency === 'IDR'
                        ? formatDynamic(trade.swap || 0)
                        : formatCurrency(trade.swap || 0, settings)}
                    </span>
                  </div>
                </div>
              )}

              {/* Explicit Planned vs Actual Comparison if Deviation Exists */}
              {(hasEntryDeviation || hasLotDeviation) && (
                <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9]">
                    {tr('Perbandingan Rencana vs Aktual', 'Planned vs Actual Comparison')}
                  </span>
                  <div className="grid grid-cols-2 gap-4 text-xs font-mono-numbers tabular-nums">
                    <div>
                      <span className="block text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                        {tr('Rencana Entry vs Entry Aktual', 'Planned Entry vs Actual Entry')}
                      </span>
                      <span className="mt-0.5 block font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                        {formatActualPrice(resolved.plannedEntry, trade.instrument)} →{' '}
                        {formatActualPrice(resolved.actualEntry, trade.instrument)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-[#526071] dark:text-[#929BA9] font-sans">
                        {tr('Rencana Lot vs Lot Aktual', 'Planned Lot vs Actual Lot')}
                      </span>
                      <span className="mt-0.5 block font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                        {resolved.plannedLot.toFixed(2)} Lot →{' '}
                        {resolved.actualLot !== undefined
                          ? `${resolved.actualLot.toFixed(2)} Lot`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Execution Notes separated cleanly from numeric metrics */}
              <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D]">
                <span className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                  {tr('Catatan Eksekusi', 'Execution Notes')}
                </span>
                {cleanExecutionNotes ? (
                  <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed max-w-3xl text-editorial-justify">
                    {cleanExecutionNotes}
                  </p>
                ) : (
                  <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                    {compliance.label} — {compliance.reason}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* C. CHART & SCREENSHOT */}
      {activeSectionTab === 'screenshots' && (
        <div
          data-testid="accordion-screenshots"
          role="tabpanel"
          className="rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none p-5 sm:p-6 space-y-5 transition-colors duration-150"
        >
          {/* Header: Title + File Count + Add Screenshot Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                  {tr('Chart & Screenshot', 'Chart & Screenshots')}
                </h2>
                <span className="text-xs text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                  · {screenshotCount} {tr('file', screenshotCount === 1 ? 'file' : 'files')}
                </span>
              </div>
              <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                {tr(
                  'Dokumentasi chart sebelum entry (Sebelum Trade) dan sesudah posisi selesai (Sesudah Trade)',
                  'Chart documentation before entry (Before Trade) and after position closure (After Trade)'
                )}
              </p>
            </div>

            {onSaveTradeUpdate && (
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-[#0F172A]/40 dark:focus-within:ring-white/40">
                  <Plus className="h-3.5 w-3.5 stroke-[2] text-[#526071] dark:text-[#929BA9]" />
                  <span>
                    {beforeDisplayUrl
                      ? tr('Ganti Sebelum', 'Replace Before')
                      : tr('Tambah Sebelum', 'Add Before')}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleScreenshotSlotUpload('BEFORE', e)}
                    className="sr-only"
                  />
                </label>

                <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-[#0F172A]/40 dark:focus-within:ring-white/40">
                  <Upload className="h-3.5 w-3.5 stroke-[1.75] text-[#526071] dark:text-[#929BA9]" />
                  <span>
                    {afterDisplayUrl
                      ? tr('Ganti Sesudah', 'Replace After')
                      : tr('Tambah Sesudah', 'Add After')}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleScreenshotSlotUpload('AFTER', e)}
                    className="sr-only"
                  />
                </label>
              </div>
            )}
          </div>

          {isBeforeLoading || isAfterLoading || isUploadingImage ? (
            <div className="py-16 border-t border-[#E4E4E7] dark:border-[#20252D] flex flex-col items-center justify-center gap-2 text-xs text-[#526071] dark:text-[#929BA9]">
              <Loader2 className="h-5 w-5 animate-spin text-[#0F172A] dark:text-[#F2F4F7]" />
              <span>{tr('Memproses gambar chart...', 'Processing chart image...')}</span>
            </div>
          ) : screenshotCount === 0 ? (
            /* Minimalist Empty State when no screenshot is attached */
            <div className="py-12 px-4 border-t border-[#E4E4E7] dark:border-[#20252D] text-center space-y-3">
              <ImageIcon className="h-6 w-6 mx-auto stroke-[1.5] text-[#526071] dark:text-[#929BA9]" />
              <div className="space-y-1 max-w-sm mx-auto">
                <p className="text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                  {tr(
                    'Belum ada dokumentasi chart pada transaksi ini',
                    'No chart documentation attached to this trade yet'
                  )}
                </p>
                <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
                  {tr(
                    'Tambahkan screenshot chart Sebelum Trade atau Sesudah Trade untuk menyimpan bukti visual setup dan eksekusi.',
                    'Add a Before Trade or After Trade chart screenshot to keep visual proof of your setup and execution.'
                  )}
                </p>
              </div>
              {onSaveTradeUpdate && (
                <div className="pt-1 flex items-center justify-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#050607] text-xs font-semibold transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-[#0F172A]/40 dark:focus-within:ring-white/40">
                    <Upload className="h-3.5 w-3.5 stroke-[1.75]" />
                    <span>{tr('Unggah Screenshot Chart', 'Upload Chart Screenshot')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleScreenshotSlotUpload('BEFORE', e)}
                      className="sr-only"
                    />
                  </label>
                </div>
              )}
            </div>
          ) : (
            <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-4">
              {/* Primary Proportional Chart Stage (object-contain so no price levels or axes are cut off) */}
              {(() => {
                const activeUrl =
                  activePrimarySlot === 'AFTER' && afterDisplayUrl
                    ? afterDisplayUrl
                    : beforeDisplayUrl || afterDisplayUrl;
                const activeRawRef =
                  activePrimarySlot === 'AFTER' && resolved.afterScreenshotUrl
                    ? resolved.afterScreenshotUrl
                    : resolved.beforeScreenshotUrl || trade.screenshotUrl || resolved.afterScreenshotUrl;
                const activeTitle =
                  activePrimarySlot === 'AFTER' && afterDisplayUrl
                    ? `${tr('Sesudah Trade', 'After Trade')} — ${trade.instrument}`
                    : `${tr('Sebelum Trade', 'Before Trade')} — ${trade.instrument}`;

                if (!activeUrl || !activeRawRef) return null;

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                        {activePrimarySlot === 'AFTER' && afterDisplayUrl
                          ? tr('Chart Utama · Sesudah Trade', 'Primary Chart · After Trade')
                          : tr('Chart Utama · Sebelum Trade', 'Primary Chart · Before Trade')}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onViewScreenshot(activeRawRef, activeTitle)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        >
                          <Maximize2 className="h-3.5 w-3.5 stroke-[1.75]" />
                          <span>{tr('Layar Penuh', 'Fullscreen')}</span>
                        </button>
                      </div>
                    </div>

                    <div
                      onClick={() => onViewScreenshot(activeRawRef, activeTitle)}
                      className="relative rounded-xl overflow-hidden border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] aspect-[16/10] sm:aspect-[16/9] flex items-center justify-center cursor-pointer group"
                    >
                      <img
                        src={activeUrl}
                        alt={activeTitle}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#101318]/95 border border-[#2A313C] text-[#F2F4F7] text-xs font-medium">
                          <ZoomIn className="h-3.5 w-3.5 stroke-[1.75]" />
                          <span>{tr('Buka Layar Penuh', 'Open Fullscreen')}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Responsive Thumbnail Grid for Before & After Slots */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                {/* Slot 1: Before Trade */}
                <div
                  className={`p-3.5 rounded-xl border transition-colors ${
                    activePrimarySlot === 'BEFORE' && beforeDisplayUrl
                      ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#0B0E13]'
                      : 'border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA]/60 dark:bg-[#0B0E13]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (beforeDisplayUrl) setActivePrimarySlot('BEFORE');
                      }}
                      className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] text-left cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      {tr('Sebelum Trade (Setup Awal)', 'Before Trade (Initial Setup)')}
                    </button>
                    <div className="flex items-center gap-2 text-[11px]">
                      {beforeDisplayUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            onViewScreenshot(
                              resolved.beforeScreenshotUrl || trade.screenshotUrl!,
                              `${tr('SEBELUM TRADE', 'BEFORE TRADE')} — ${trade.instrument}`
                            )
                          }
                          className="text-[#0F172A] dark:text-[#F2F4F7] hover:underline font-medium cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        >
                          {tr('Perbesar', 'Enlarge')}
                        </button>
                      )}
                      {onSaveTradeUpdate && (resolved.beforeScreenshotUrl || trade.screenshotUrl) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteScreenshotSlot('BEFORE')}
                          className="text-[#E11D48] dark:text-[#E05260] hover:underline font-medium cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        >
                          {tr('Hapus', 'Delete')}
                        </button>
                      )}
                    </div>
                  </div>

                  {beforeDisplayUrl ? (
                    <div
                      onClick={() => setActivePrimarySlot('BEFORE')}
                      className="rounded-lg overflow-hidden border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] aspect-[16/9] cursor-pointer"
                    >
                      <img
                        src={beforeDisplayUrl}
                        alt="Before Trade Thumbnail"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[#E4E4E7] dark:border-[#20252D] aspect-[16/9] flex flex-col items-center justify-center gap-1.5 text-xs text-[#526071] dark:text-[#929BA9]">
                      <span>{tr('Belum ada gambar Sebelum Trade', 'No Before Trade image yet')}</span>
                      {onSaveTradeUpdate && (
                        <label className="text-[#0F172A] dark:text-[#F2F4F7] font-semibold hover:underline cursor-pointer rounded-full focus-within:ring-2 focus-within:ring-[#0F172A]/40 dark:focus-within:ring-white/40">
                          {tr('+ Unggah Sebelum Trade', '+ Upload Before Trade')}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleScreenshotSlotUpload('BEFORE', e)}
                            className="sr-only"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>

                {/* Slot 2: After Trade */}
                <div
                  className={`p-3.5 rounded-xl border transition-colors ${
                    activePrimarySlot === 'AFTER' && afterDisplayUrl
                      ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#0B0E13]'
                      : 'border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA]/60 dark:bg-[#0B0E13]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (afterDisplayUrl) setActivePrimarySlot('AFTER');
                      }}
                      className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] text-left cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    >
                      {tr('Sesudah Trade (Hasil Akhir)', 'After Trade (Final Outcome)')}
                    </button>
                    <div className="flex items-center gap-2 text-[11px]">
                      {afterDisplayUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            onViewScreenshot(
                              resolved.afterScreenshotUrl!,
                              `${tr('SESUDAH TRADE', 'AFTER TRADE')} — ${trade.instrument}`
                            )
                          }
                          className="text-[#0F172A] dark:text-[#F2F4F7] hover:underline font-medium cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        >
                          {tr('Perbesar', 'Enlarge')}
                        </button>
                      )}
                      {onSaveTradeUpdate && resolved.afterScreenshotUrl && (
                        <button
                          type="button"
                          onClick={() => handleDeleteScreenshotSlot('AFTER')}
                          className="text-[#E11D48] dark:text-[#E05260] hover:underline font-medium cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                        >
                          {tr('Hapus', 'Delete')}
                        </button>
                      )}
                    </div>
                  </div>

                  {afterDisplayUrl ? (
                    <div
                      onClick={() => setActivePrimarySlot('AFTER')}
                      className="rounded-lg overflow-hidden border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] aspect-[16/9] cursor-pointer"
                    >
                      <img
                        src={afterDisplayUrl}
                        alt="After Trade Thumbnail"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[#E4E4E7] dark:border-[#20252D] aspect-[16/9] flex flex-col items-center justify-center gap-1.5 text-xs text-[#526071] dark:text-[#929BA9]">
                      <span>{tr('Belum ada gambar Sesudah Trade', 'No After Trade image yet')}</span>
                      {onSaveTradeUpdate && (
                        <label className="text-[#0F172A] dark:text-[#F2F4F7] font-semibold hover:underline cursor-pointer rounded-full focus-within:ring-2 focus-within:ring-[#0F172A]/40 dark:focus-within:ring-white/40">
                          {tr('+ Unggah Sesudah Trade', '+ Upload After Trade')}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleScreenshotSlotUpload('AFTER', e)}
                            className="sr-only"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* D. EVALUASI */}
      {activeSectionTab === 'evaluation' && (
        <div
          data-testid="accordion-evaluation"
          role="tabpanel"
          className="rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none p-5 sm:p-6 space-y-6 transition-colors duration-150"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Evaluasi & Refleksi Trade', 'Trade Evaluation & Reflection')}
              </h2>
              <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                {tr(
                  'Tinjauan objektif hasil, kepatuhan rencana, psikologi, dan pembelajaran pasca-trade',
                  'Objective review of outcome, plan compliance, psychology, and post-trade lessons'
                )}
              </p>
            </div>
            {onSaveTradeUpdate && !isEditingEval && (
              <button
                type="button"
                onClick={() => setIsEditingEval(true)}
                className="px-3.5 py-1.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
              >
                {trade.postTradeEvaluation || trade.notes
                  ? tr('Ubah Evaluasi', 'Edit Evaluation')
                  : tr('+ Tulis Evaluasi', '+ Write Evaluation')}
              </button>
            )}
          </div>

          {/* 1. Hasil Trade & 2. Disiplin terhadap Rencana */}
          <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D] grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Group 1: Hasil Trade */}
            <div className="space-y-3">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9]">
                {tr('1. Hasil Trade', '1. Trade Outcome')}
              </span>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Status & Hasil', 'Status & Outcome')}
                  </span>
                  <span
                    className={`mt-0.5 block text-sm font-semibold ${
                      isClosed
                        ? isProfit
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : isLoss
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                        : 'text-[#0F172A] dark:text-[#F2F4F7]'
                    }`}
                  >
                    {headerStatusLabel}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Realisasi R / L/R Bersih', 'Realized R / Net P/L')}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                    {isClosed
                      ? `${realizedR !== null ? `${formatRMultiple(realizedR)} · ` : ''}${
                          preferredCurrency === 'IDR'
                            ? formatTradeFinancial(trade, 'netProfit', false, true)
                            : `${isProfit ? '+' : ''}${formatCurrency(trade.netProfit, settings)}`
                        }`
                      : tr('Belum Ditutup', 'Not Closed Yet')}
                  </span>
                </div>
              </div>
              <div className="pt-2 grid grid-cols-3 gap-2 text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                <div>
                  <span className="block font-sans">
                    {tr('Rencana vs Entry Aktual', 'Plan vs Actual Entry')}
                  </span>
                  <span className="font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                    {formatActualPrice(resolved.plannedEntry, trade.instrument)} /{' '}
                    {formatActualPrice(resolved.actualEntry, trade.instrument)}
                  </span>
                </div>
                <div>
                  <span className="block font-sans">
                    {tr('Rencana vs Lot Aktual', 'Plan vs Actual Lot')}
                  </span>
                  <span className="font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                    {resolved.plannedLot.toFixed(2)} /{' '}
                    {resolved.actualLot !== undefined ? resolved.actualLot.toFixed(2) : '—'}
                  </span>
                </div>
                <div>
                  <span className="block font-sans">
                    {tr('Rencana vs R:R Aktual', 'Plan vs Actual R:R')}
                  </span>
                  <span className="font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                    {formatPlannedRR(plannedRR)} / {formatRMultiple(realizedR)}
                  </span>
                </div>
              </div>
            </div>

            {/* Group 2: Disiplin terhadap Rencana */}
            <div className="space-y-2.5 sm:border-l sm:border-[#E4E4E7] sm:dark:border-[#20252D] sm:pl-6">
              <div className="flex items-center justify-between gap-2">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9]">
                  {tr('2. Disiplin terhadap Rencana', '2. Plan Discipline')}
                </span>
                <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                  {trade.disciplineRating
                    ? `${tr('Skor Manual:', 'Manual Score:')} ${trade.disciplineRating}/5`
                    : compliance.rating !== null
                    ? `${tr('Audit Sistem:', 'System Audit:')} ${compliance.rating}/5`
                    : tr('Belum Dinilai', 'Not Rated')}
                </span>
              </div>
              <p className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {compliance.label}
              </p>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed">
                {compliance.reason}
              </p>
            </div>
          </div>

          {/* Qualitative Reflection Sections (3..7) or Inline Editor */}
          <div className="pt-5 border-t border-[#E4E4E7] dark:border-[#20252D]">
            {isEditingEval ? (
              <form onSubmit={handleSaveEvaluation} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr(
                      'Skor Disiplin Pribadi (Opsional — Jangan pilih jika belum ingin memberi skor)',
                      'Personal Discipline Score (Optional — Leave unselected if not rating yet)'
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        type="button"
                        onClick={() =>
                          setEvalDisciplineRatingInput((prev) => (prev === score ? null : score))
                        }
                        className={`px-3.5 py-1.5 rounded-full border font-mono-numbers tabular-nums font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40 ${
                          evalDisciplineRatingInput === score
                            ? 'border-[#0F172A] dark:border-white bg-[#0F172A] text-white dark:bg-white dark:text-[#050607]'
                            : 'border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22]'
                        }`}
                      >
                        {score} / 5
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('3. Kualitas Entry', '3. Entry Quality')}
                    </label>
                    <textarea
                      rows={2}
                      value={evalEntryQualityInput}
                      onChange={(e) => setEvalEntryQualityInput(e.target.value)}
                      placeholder={tr(
                        'Apakah timing dan level harga entry sesuai konfirmasi setup?',
                        'Did entry timing and price level match your setup confirmation?'
                      )}
                      className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-2.5 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('4. Kontrol Emosi', '4. Emotional Control')}
                    </label>
                    <textarea
                      rows={2}
                      value={evalEmotionalControlInput}
                      onChange={(e) => setEvalEmotionalControlInput(e.target.value)}
                      placeholder={tr(
                        'Bagaimana kondisi psikologis saat floating profit/loss?',
                        'How was your psychological state during floating profit/loss?'
                      )}
                      className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-2.5 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('5. Hal yang Berjalan Baik', '5. What Went Well')}
                    </label>
                    <textarea
                      rows={2}
                      value={evalWentWellInput}
                      onChange={(e) => setEvalWentWellInput(e.target.value)}
                      placeholder={tr(
                        'Apa langkah disiplin yang sudah tepat pada transaksi ini?',
                        'What disciplined actions went well in this trade?'
                      )}
                      className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-2.5 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('6. Hal yang Perlu Diperbaiki', '6. Needs Improvement')}
                    </label>
                    <textarea
                      rows={2}
                      value={evalNeedsImprovementInput}
                      onChange={(e) => setEvalNeedsImprovementInput(e.target.value)}
                      placeholder={tr(
                        'Apa kesalahan atau celah eksekusi yang perlu dihindari ke depan?',
                        'What mistakes or execution gaps should be avoided next time?'
                      )}
                      className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-2.5 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('7. Pelajaran dari Trade (Refleksi Utama)', '7. Lessons Learned (Core Reflection)')}
                  </label>
                  <textarea
                    rows={3}
                    value={evalReflectionInput}
                    onChange={(e) => setEvalReflectionInput(e.target.value)}
                    placeholder={tr(
                      'Tuliskan kesimpulan utama dan pelajaran dari transaksi ini...',
                      'Write the main conclusion and key lessons from this trade...'
                    )}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-3 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-[#526071] dark:text-[#929BA9] mb-1">
                    {tr('Catatan Evaluasi & Konfluensi Tambahan', 'Evaluation & Additional Confluence Notes')}
                  </label>
                  <textarea
                    rows={2}
                    value={evalNotesInput}
                    onChange={(e) => setEvalNotesInput(e.target.value)}
                    placeholder={tr('Catatan tambahan...', 'Additional notes...')}
                    className="w-full rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] p-3 text-xs text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed focus:border-[#0F172A] dark:focus:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingEval(false)}
                    className="px-4 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] font-medium text-[#526071] dark:text-[#929BA9] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  >
                    {tr('Batal', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEval}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#050607] font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/40 dark:focus-visible:ring-white/40"
                  >
                    <Save className="h-3.5 w-3.5 stroke-[1.75]" />
                    <span>
                      {isSavingEval
                        ? tr('Menyimpan...', 'Saving...')
                        : tr('Simpan Evaluasi', 'Save Evaluation')}
                    </span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('3. Kualitas Entry', '3. Entry Quality')}
                    </span>
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed text-editorial-justify">
                      {parsedEvalView.entryQuality ||
                        (hasEntryDeviation
                          ? tr(
                              `Entry Aktual (${formatActualPrice(
                                resolved.actualEntry,
                                trade.instrument
                              )}) memiliki selisih terhadap Rencana Entry (${formatActualPrice(
                                resolved.plannedEntry,
                                trade.instrument
                              )}).`,
                              `Actual Entry (${formatActualPrice(
                                resolved.actualEntry,
                                trade.instrument
                              )}) deviated from Planned Entry (${formatActualPrice(
                                resolved.plannedEntry,
                                trade.instrument
                              )}).`
                            )
                          : tr(
                              'Belum ada catatan evaluasi kualitas entry.',
                              'No entry quality evaluation notes yet.'
                            ))}
                    </p>
                  </div>

                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('4. Kontrol Emosi', '4. Emotional Control')}
                    </span>
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed text-editorial-justify">
                      {parsedEvalView.emotionalControl ||
                        tr(
                          'Belum ada catatan evaluasi kontrol emosi.',
                          'No emotional control evaluation notes yet.'
                        )}
                    </p>
                  </div>

                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('5. Hal yang Berjalan Baik', '5. What Went Well')}
                    </span>
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed text-editorial-justify">
                      {parsedEvalView.wentWell || tr('Belum diisi.', 'Not filled yet.')}
                    </p>
                  </div>

                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] mb-1">
                      {tr('6. Hal yang Perlu Diperbaiki', '6. Needs Improvement')}
                    </span>
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed text-editorial-justify">
                      {parsedEvalView.needsImprovement || tr('Belum diisi.', 'Not filled yet.')}
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D]">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] mb-1.5">
                    {tr('7. Pelajaran dari Trade', '7. Lessons Learned')}
                  </span>
                  {parsedEvalView.lessonsLearned ? (
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed max-w-3xl text-editorial-justify">
                      {parsedEvalView.lessonsLearned}
                    </p>
                  ) : (
                    <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                      {tr(
                        'Belum ada refleksi atau pelajaran pasca-trade yang ditulis untuk transaksi ini.',
                        'No post-trade reflection or lessons learned written for this trade yet.'
                      )}
                    </p>
                  )}
                </div>

                {(trade.notes || trade.entryReason) && (
                  <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D]">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#526071] dark:text-[#929BA9] mb-1.5">
                      {tr('Catatan Konfluensi & Jurnal', 'Confluence & Journal Notes')}
                    </span>
                    <p className="text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F4F7] whitespace-pre-line leading-relaxed max-w-3xl text-editorial-justify">
                      {trade.notes || trade.entryReason}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* E. RIWAYAT AKTIVITAS */}
      {activeSectionTab === 'activity' && (
        <div
          data-testid="accordion-activity-history"
          role="tabpanel"
          className="rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none p-5 sm:p-6 space-y-5 transition-colors duration-150"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Riwayat Aktivitas', 'Activity History')}
              </h2>
              <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                {tr(
                  'Jejak kronologis pembuatan rencana, eksekusi posisi, dokumentasi chart, dan evaluasi',
                  'Chronological trail of plan creation, position execution, chart documentation, and evaluation'
                )}
              </p>
            </div>
            <span className="text-xs text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums">
              {timelineEvents.length}{' '}
              {tr('aktivitas', timelineEvents.length === 1 ? 'activity' : 'activities')}
            </span>
          </div>

          {timelineEvents.length === 0 ? (
            <div className="py-10 border-t border-[#E4E4E7] dark:border-[#20252D] text-center space-y-1.5">
              <Activity className="h-5 w-5 mx-auto stroke-[1.5] text-[#526071] dark:text-[#929BA9]" />
              <p className="text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Belum ada riwayat aktivitas tercatat', 'No activity history recorded yet')}
              </p>
            </div>
          ) : (
            <div className="pt-4 border-t border-[#E4E4E7] dark:border-[#20252D]">
              <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-[#E4E4E7] dark:before:bg-[#20252D]">
                {timelineEvents.map((ev) => (
                  <div key={ev.id} className="relative text-xs">
                    {/* Minimalist timeline node */}
                    <span
                      className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#0F172A] dark:bg-[#F2F4F7] ring-4 ring-white dark:ring-[#101318]"
                      aria-hidden="true"
                    />
                    <div className="space-y-1">
                      <div className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                        {ev.label}
                      </div>
                      <div className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] flex items-center gap-1.5">
                        <Clock className="h-3 w-3 stroke-[1.75] shrink-0" />
                        <span>{(ev.timestamp || '').slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      {(ev.previousValue || ev.newValue) && (
                        <div className="text-xs font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] pt-0.5">
                          {ev.previousValue ? (
                            <span className="text-[#526071] dark:text-[#929BA9]">
                              {ev.previousValue} →{' '}
                            </span>
                          ) : null}
                          <span>{ev.newValue}</span>
                        </div>
                      )}
                      {ev.note && (
                        <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
                          {ev.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
