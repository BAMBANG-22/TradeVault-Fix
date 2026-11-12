import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Trade,
  TradeOutcome,
  TradePosition,
  TradingSession,
  TradeLifecycleStatus,
  TradeOrderType,
  TradeCloseType,
} from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  calculateXauusdLot,
  buildUnifiedXauusdLotInput,
  POSITION_SIZING_RISK_PRESETS,
  XAUUSD_PIP_SIZE,
  calculateLotBasedOrderMetrics,
  validateSlTpDirection,
  RiskCapitalBasis,
} from '../../utils/riskCalculator';
import {
  classifyNetProfitOutcome,
  computeGrossFromNet,
  computeNetFromGross,
  computePlannedRiskReward,
  computeRealizedRMultiple,
  formatCurrency,
  formatPlannedRR,
} from '../../utils/calculations';
import {
  evaluateTradeCompliance,
  parseExecutionAdherenceTag,
  encodeExecutionAdherenceNotes,
  ExecutionAdherenceTag,
} from '../../utils/complianceRating';
import {
  isStoragePath,
  createScreenshotSignedUrl,
  normalizeTradeDateTimeLocal,
} from '../../utils/supabaseSync';
import {
  resolveTradeLifecycle,
  encodeLifecycleMetaIntoExecutionNotes,
  createActivityEvent,
  TradeLifecycleMeta,
} from '../../utils/tradeLifecycle';
import {
  getCachedUsdIdrRate,
  getCurrentUsdIdrSnapshot,
  useGlobalCurrency,
} from '../../utils/currencyRate';
import {
  scanTradeScreenshotOrUrl,
  resolveTradingViewSnapshotUrl,
} from '../../utils/tradeScreenshotScanner';
import { useLanguage } from '../../utils/language';
import {
  X,
  Upload,
  AlertCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Check,
  Search,
  Sparkles,
} from 'lucide-react';

export interface TradeSaveResult {
  success: boolean;
  error?: string;
  ignored?: boolean;
  uploadedScreenshotPath?: string;
}

interface TradeFormProps {
  initialTrade?: Trade | null;
  settings: AppSettings;
  currentEquity: number;
  existingTrades?: Trade[];
  onSave: (
    trade: Trade,
    originalId?: string
  ) => Promise<TradeSaveResult | void> | TradeSaveResult | void;
  onCancel: () => void;
  isPopupModal?: boolean;
}

const COMMON_INSTRUMENTS = [
  'XAUUSD',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'BTCUSD',
  'US30',
  'NAS100',
  'ETHUSD',
];

const COMMON_STRATEGIES = [
  'London Open Liquidity Sweep',
  'NY Session FVG Fill + CHoCH',
  'Order Block Retest M15',
  'Asian Range Breakout & Retest',
  'Daily Support & Demand Bounce',
  'Break of Structure (BOS) Momentum',
  'Trend Continuation Pullback',
  'Overbought / Oversold Mean Reversion',
  'News Retest & Continuation',
];

const PRIMARY_SESSIONS: { key: TradingSession; labelId: string; labelEn: string; descId: string; descEn: string }[] = [
  { key: 'Asian', labelId: 'Asia', labelEn: 'Asian', descId: 'Tokyo / Sydney', descEn: 'Tokyo / Sydney' },
  { key: 'London', labelId: 'London', labelEn: 'London', descId: 'Sesi Eropa', descEn: 'European Session' },
  { key: 'New York', labelId: 'New York', labelEn: 'New York', descId: 'Pasar AS', descEn: 'US Market' },
  { key: 'Overlap', labelId: 'Overlap', labelEn: 'Overlap', descId: 'London / NY', descEn: 'London / NY' },
];

const EXECUTION_ADHERENCE_OPTIONS: { value: ExecutionAdherenceTag; labelId: string; labelEn: string }[] = [
  {
    value: 'AUTO',
    labelId: 'Deteksi Otomatis dari Harga Entry, SL, TP & Exit',
    labelEn: 'Auto-Detect from Entry, SL, TP & Exit Prices',
  },
  {
    value: 'PLAN_FOLLOWED',
    labelId: 'Patuh Rencana — Penutupan Terukur Sesuai Sistem',
    labelEn: 'Plan Followed — Measured Close According to System',
  },
  {
    value: 'SL_MOVED_VIOLATION',
    labelId: 'Pelanggaran — SL Digeser / Diperlebar Saat Floating Loss',
    labelEn: 'Violation — SL Moved / Widened During Floating Loss',
  },
  {
    value: 'TP_MODIFIED_VIOLATION',
    labelId: 'Deviasi — TP Diubah / Ditutup Prematur Tanpa Aturan',
    labelEn: 'Deviation — TP Modified / Premature Close Without Rule',
  },
];

/**
 * Smart client-side image downscaling and WebP/JPEG compression (~45-90KB) to save ~75% Supabase Storage
 * and localStorage quota while keeping MT4/MT5/TradingView SL/TP price numbers razor-sharp.
 */
export const compressAndResizeImage = (
  file: File | Blob,
  maxWidth = 1920,
  maxHeight = 1920,
  quality = 0.9
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
          canvas.width = 0;
          canvas.height = 0;
          resolve(jpegDataUrl);
        } else {
          resolve(event.target?.result as string);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

export const TradeForm: React.FC<TradeFormProps> = ({
  initialTrade,
  settings,
  currentEquity,
  existingTrades = [],
  onSave,
  onCancel,
  isPopupModal = true,
}) => {
  const { tr } = useLanguage();
  const { preferredCurrency, formatDynamic } = useGlobalCurrency();
  const fmtMoney = (val: number) =>
    preferredCurrency === 'IDR' ? formatDynamic(val) : formatCurrency(val, settings);

  const generateUniqueId = () => {
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    return `TRD-${randomSuffix}`;
  };

  const initialResolved = initialTrade ? resolveTradeLifecycle(initialTrade) : null;
  const initialLocalDateTime = initialTrade?.dateTime
    ? normalizeTradeDateTimeLocal(initialTrade.dateTime)
    : normalizeTradeDateTimeLocal(new Date());

  // View State: Main View vs Slide-Up Detail View
  const [isDetailViewOpen, setIsDetailViewOpen] = useState<boolean>(false);

  // Core Form State
  const [id, setId] = useState(initialTrade?.id || generateUniqueId());
  const [tradeDate, setTradeDate] = useState<string>(initialLocalDateTime.slice(0, 10));
  const [tradeTime, setTradeTime] = useState<string>(initialLocalDateTime.slice(11, 16) || '14:00');
  const [instrument, setInstrument] = useState(initialTrade?.instrument || 'XAUUSD');
  const [isInstrumentDropdownOpen, setIsInstrumentDropdownOpen] = useState<boolean>(false);
  const [instrumentSearch, setInstrumentSearch] = useState<string>('');

  const [position, setPosition] = useState<TradePosition>(initialTrade?.position || 'BUY');
  const [orderType, setOrderType] = useState<TradeOrderType>(
    initialResolved?.orderType || 'Market'
  );
  const [lifecycleStatus, setLifecycleStatus] = useState<TradeLifecycleStatus>(
    initialResolved ? initialResolved.status : 'PLANNED'
  );
  const [closeType, setCloseType] = useState<TradeCloseType>(
    initialResolved?.closeType || 'TP'
  );

  const [strategy, setStrategy] = useState(initialTrade?.strategy || '');
  const [isStrategyPickerOpen, setIsStrategyPickerOpen] = useState<boolean>(false);
  const [customStrategyInput, setCustomStrategyInput] = useState<string>('');

  const [session, setSession] = useState<string>(initialTrade?.session || 'London');
  const [isSessionDropdownOpen, setIsSessionDropdownOpen] = useState<boolean>(false);

  const [lotSize, setLotSize] = useState<string>(
    initialTrade?.lotSize !== undefined ? String(initialTrade.lotSize) : '0.01'
  );
  const [entryPrice, setEntryPrice] = useState<string>(
    initialTrade?.entryPrice !== undefined ? String(initialTrade.entryPrice) : ''
  );
  const [stopLoss, setStopLoss] = useState<string>(
    initialTrade?.stopLoss !== undefined && initialTrade.stopLoss > 0
      ? String(initialTrade.stopLoss)
      : ''
  );
  const [takeProfit, setTakeProfit] = useState<string>(
    initialTrade?.takeProfit !== undefined && initialTrade.takeProfit > 0
      ? String(initialTrade.takeProfit)
      : ''
  );
  const [exitPrice, setExitPrice] = useState<string>(
    initialTrade?.exitPrice !== undefined && initialTrade.exitPrice > 0
      ? String(initialTrade.exitPrice)
      : ''
  );

  const capitalBasisType: RiskCapitalBasis = settings.riskCapitalBasis || 'EQUITY';
  const [selectedRiskPercent, setSelectedRiskPercent] = useState<number>(
    initialTrade?.riskPercentage && initialTrade.riskPercentage > 0
      ? initialTrade.riskPercentage
      : settings.defaultRiskPercent || 1.0
  );
  const [isAutoLotActive, setIsAutoLotActive] = useState<boolean>(!initialTrade);
  const [riskAmount, setRiskAmount] = useState<string>(
    initialTrade?.riskAmount !== undefined ? String(initialTrade.riskAmount) : '0'
  );
  const [riskPercentage, setRiskPercentage] = useState<string>(
    initialTrade?.riskPercentage !== undefined ? String(initialTrade.riskPercentage) : '0'
  );

  const [outcome, setOutcome] = useState<TradeOutcome>(initialTrade?.outcome || 'WIN');
  const [grossProfit, setGrossProfit] = useState<string>(
    initialTrade?.grossProfit !== undefined ? String(initialTrade.grossProfit) : ''
  );
  const [commission, setCommission] = useState<string>(
    initialTrade?.commission !== undefined ? String(initialTrade.commission) : '0'
  );
  const [swap, setSwap] = useState<string>(
    initialTrade?.swap !== undefined ? String(initialTrade.swap) : '0'
  );
  const [netProfit, setNetProfit] = useState<string>(
    initialTrade?.netProfit !== undefined ? String(initialTrade.netProfit) : ''
  );
  const [screenshotUrl, setScreenshotUrl] = useState<string>(initialTrade?.screenshotUrl || '');
  const [afterScreenshotUrl, setAfterScreenshotUrl] = useState<string>(
    initialResolved?.afterScreenshotUrl || ''
  );
  const [notes, setNotes] = useState<string>(initialTrade?.notes || '');
  const [entryReason, setEntryReason] = useState<string>(initialTrade?.entryReason || '');
  const [postTradeEvaluation, setPostTradeEvaluation] = useState<string>(
    initialTrade?.postTradeEvaluation || ''
  );

  const initialParsedAdherence = parseExecutionAdherenceTag(initialTrade?.executionNotes);
  const [adherenceTag, setAdherenceTag] = useState<ExecutionAdherenceTag>(
    initialParsedAdherence.tag
  );
  const [cleanExecutionNotes, setCleanExecutionNotes] = useState<string>(
    initialParsedAdherence.cleanNotes
  );

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const pnlInputModeRef = useRef<'gross' | 'net'>('gross');
  const preserveInitialRiskRef = useRef<boolean>(Boolean(initialTrade));

  const dateTime = `${tradeDate}T${tradeTime || '00:00'}`;

  const activeCapitalBasisValue =
    capitalBasisType === 'BALANCE'
      ? settings.startingBalance
      : currentEquity > 0
      ? currentEquity
      : settings.startingBalance;

  // Escape key dismissal for popup modal
  useEffect(() => {
    if (!isPopupModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmittingRef.current) {
        if (isDetailViewOpen) {
          setIsDetailViewOpen(false);
        } else {
          onCancel();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPopupModal, onCancel, isDetailViewOpen]);

  const triggerValidationError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => {
      try {
        if (errorRef.current) {
          errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch {
        // ignore
      }
    }, 50);
  };

  // Storage path preview resolution state
  const [previewDisplayUrl, setPreviewDisplayUrl] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!screenshotUrl) {
      setPreviewDisplayUrl('');
      setIsPreviewLoading(false);
      return;
    }

    const trimmed = screenshotUrl.trim();
    if (trimmed.startsWith('data:image/')) {
      setPreviewDisplayUrl(trimmed);
      setIsPreviewLoading(false);
      return;
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const resolvedTv = resolveTradingViewSnapshotUrl(trimmed);
      setPreviewDisplayUrl(resolvedTv.directImageUrl || trimmed);
      setIsPreviewLoading(false);
      return;
    }

    if (isStoragePath(trimmed)) {
      let isMounted = true;
      setIsPreviewLoading(true);
      createScreenshotSignedUrl(trimmed, 3600)
        .then((url) => {
          if (!isMounted) return;
          setIsPreviewLoading(false);
          setPreviewDisplayUrl((prev) => url || (prev.startsWith('data:image/') ? prev : ''));
        })
        .catch(() => {
          if (!isMounted) return;
          setIsPreviewLoading(false);
          setPreviewDisplayUrl((prev) => (prev.startsWith('data:image/') ? prev : ''));
        });
      return () => {
        isMounted = false;
      };
    }

    setPreviewDisplayUrl(trimmed);
    setIsPreviewLoading(false);
  }, [screenshotUrl]);

  // AI Vision Screenshot Scanner State
  const [isScanningScreenshot, setIsScanningScreenshot] = useState<boolean>(false);
  const handleScanScreenshotAIRef = useRef<((src?: string) => Promise<void>) | null>(null);
  const [scanResultFeedback, setScanResultFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: {
      source?: 'MT5' | 'TRADINGVIEW' | 'CHART';
      instrument: string;
      position: TradePosition;
      lotSize?: number | null;
      entryPrice: number | null;
      stopLoss: number | null;
      takeProfit: number | null;
      exitPrice?: number | null;
      profit?: number | null;
      status?: 'PLANNED' | 'ACTIVE' | 'CLOSED';
      plannedRiskReward: number | null;
    };
  } | null>(null);

  // Support pasting screenshot directly from clipboard (Ctrl+V / Cmd+V) with instant compression & auto-scan
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
        (activeEl as HTMLInputElement).type !== 'file'
      ) {
        if (!e.clipboardData?.files || e.clipboardData.files.length === 0) {
          return;
        }
      }

      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          compressAndResizeImage(file)
            .then((compressedB64) => {
              setScreenshotUrl(compressedB64);
              setScanResultFeedback(null);
              // Auto-trigger ultra-fast scan immediately upon paste
              if (handleScanScreenshotAIRef.current) {
                handleScanScreenshotAIRef.current(compressedB64);
              }
            })
            .catch(() => {
              triggerValidationError(
                tr('Gagal memproses gambar dari clipboard.', 'Failed to process image from clipboard.')
              );
            });
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Synchronize form when initialTrade changes
  useEffect(() => {
    if (initialTrade) {
      preserveInitialRiskRef.current = true;
      const resolved = resolveTradeLifecycle(initialTrade);
      const normDt = initialTrade.dateTime
        ? normalizeTradeDateTimeLocal(initialTrade.dateTime)
        : normalizeTradeDateTimeLocal(new Date());
      setId(initialTrade.id);
      setTradeDate(normDt.slice(0, 10));
      setTradeTime(normDt.slice(11, 16) || '14:00');
      setInstrument(initialTrade.instrument || 'XAUUSD');
      setPosition(initialTrade.position || 'BUY');
      setOrderType(resolved.orderType);
      setLifecycleStatus(resolved.status);
      setCloseType(resolved.closeType || 'TP');
      setStrategy(initialTrade.strategy || '');
      setSession(initialTrade.session || 'London');
      setLotSize(initialTrade.lotSize !== undefined ? String(initialTrade.lotSize) : '0.01');
      setEntryPrice(initialTrade.entryPrice !== undefined ? String(initialTrade.entryPrice) : '');
      setStopLoss(
        initialTrade.stopLoss !== undefined && initialTrade.stopLoss > 0
          ? String(initialTrade.stopLoss)
          : ''
      );
      setTakeProfit(
        initialTrade.takeProfit !== undefined && initialTrade.takeProfit > 0
          ? String(initialTrade.takeProfit)
          : ''
      );
      setExitPrice(
        initialTrade.exitPrice !== undefined && initialTrade.exitPrice > 0
          ? String(initialTrade.exitPrice)
          : ''
      );
      setRiskAmount(
        initialTrade.riskAmount !== undefined ? String(initialTrade.riskAmount) : '0'
      );
      setRiskPercentage(
        initialTrade.riskPercentage !== undefined ? String(initialTrade.riskPercentage) : '0'
      );
      setSelectedRiskPercent(
        initialTrade.riskPercentage && initialTrade.riskPercentage > 0
          ? initialTrade.riskPercentage
          : settings.defaultRiskPercent || 1.0
      );
      setIsAutoLotActive(false);
      setOutcome(initialTrade.outcome || 'WIN');
      setGrossProfit(
        initialTrade.grossProfit !== undefined ? String(initialTrade.grossProfit) : ''
      );
      setCommission(
        initialTrade.commission !== undefined ? String(initialTrade.commission) : '0'
      );
      setSwap(initialTrade.swap !== undefined ? String(initialTrade.swap) : '0');
      setNetProfit(initialTrade.netProfit !== undefined ? String(initialTrade.netProfit) : '');
      setScreenshotUrl(initialTrade.screenshotUrl || '');
      setAfterScreenshotUrl(resolved.afterScreenshotUrl || '');
      setNotes(initialTrade.notes || '');
      setEntryReason(initialTrade.entryReason || '');
      setPostTradeEvaluation(initialTrade.postTradeEvaluation || '');
      const parsedAdherence = parseExecutionAdherenceTag(initialTrade.executionNotes);
      setAdherenceTag(parsedAdherence.tag);
      setCleanExecutionNotes(parsedAdherence.cleanNotes);
      setErrorMsg(null);
      setIsDetailViewOpen(false);
    } else {
      preserveInitialRiskRef.current = false;
      const normDt = normalizeTradeDateTimeLocal(new Date());
      setId(generateUniqueId());
      setTradeDate(normDt.slice(0, 10));
      setTradeTime(normDt.slice(11, 16) || '14:00');
      setInstrument('XAUUSD');
      setPosition('BUY');
      setOrderType('Market');
      setLifecycleStatus('PLANNED');
      setCloseType('TP');
      setStrategy('');
      setSession('London');
      setLotSize('0.01');
      setEntryPrice('');
      setStopLoss('');
      setTakeProfit('');
      setExitPrice('');
      setRiskAmount('0');
      setRiskPercentage('0');
      setSelectedRiskPercent(settings.defaultRiskPercent || 1.0);
      setIsAutoLotActive(true);
      setOutcome('WIN');
      setGrossProfit('');
      setCommission('0');
      setSwap('0');
      setNetProfit('');
      setScreenshotUrl('');
      setAfterScreenshotUrl('');
      setNotes('');
      setEntryReason('');
      setPostTradeEvaluation('');
      setAdherenceTag('AUTO');
      setCleanExecutionNotes('');
      setErrorMsg(null);
      setIsDetailViewOpen(false);
    }
    pnlInputModeRef.current = 'gross';
  }, [initialTrade, settings.defaultRiskPercent]);

  // Internal Lot-based Pip Value, SL/TP Distance, Risk Amount, Potential Profit & Dynamic RR Engine
  const numEntry = parseFloat(entryPrice);
  const numSL = stopLoss.trim() !== '' ? parseFloat(stopLoss) : undefined;
  const numTP = takeProfit.trim() !== '' ? parseFloat(takeProfit) : undefined;
  const numExit = exitPrice.trim() !== '' ? parseFloat(exitPrice) : undefined;
  const numLot = parseFloat(lotSize);

  const isXauInstrument = useMemo(() => {
    const clean = (instrument || 'XAUUSD').trim().toUpperCase();
    return clean.includes('XAU') || clean.includes('GOLD');
  }, [instrument]);

  const xauBrokerSpecOverride = useMemo(() => {
    if (!isXauInstrument) return undefined;
    const cSize = settings.xauusdContractSize || 100;
    const resolvedPipSize =
      typeof settings.xauusdPipSize === 'number' &&
      Number.isFinite(settings.xauusdPipSize) &&
      settings.xauusdPipSize > 0
        ? settings.xauusdPipSize
        : XAUUSD_PIP_SIZE;
    const basePip001 =
      typeof settings.xauusdPipValuePer001Lot === 'number' &&
      Number.isFinite(settings.xauusdPipValuePer001Lot) &&
      settings.xauusdPipValuePer001Lot > 0
        ? settings.xauusdPipValuePer001Lot
        : 0.1;
    const stdLotPipVal = Number((basePip001 * cSize).toFixed(4));
    return {
      pipSize: resolvedPipSize,
      contractSize: cSize,
      pipValuePerStandardLot: stdLotPipVal,
      pipValuePer001Lot: Number((stdLotPipVal / 100).toFixed(4)),
      minLot: settings.xauusdMinLot || 0.01,
      lotStep: settings.xauusdLotStep || 0.01,
    };
  }, [
    isXauInstrument,
    settings.xauusdPipSize,
    settings.xauusdContractSize,
    settings.xauusdPipValuePer001Lot,
    settings.xauusdMinLot,
    settings.xauusdLotStep,
  ]);

  // Shared Multi-Instrument Lot Calculation Engine (identical to Risk Calculator -> Position Sizing)
  const xauLotCalcResult = useMemo(() => {
    return calculateXauusdLot(
      buildUnifiedXauusdLotInput(
        {
          symbol: instrument,
          equity: activeCapitalBasisValue,
          riskPercent: selectedRiskPercent,
          entryPrice: !isNaN(numEntry) && numEntry > 0 ? numEntry : 0,
          stopLossPrice: numSL !== undefined && !isNaN(numSL) && numSL > 0 ? numSL : 0,
          takeProfitPrice: numTP !== undefined && !isNaN(numTP) && numTP > 0 ? numTP : undefined,
          position,
          leverage: settings.defaultLeverage || 500,
          accountCurrency: settings.currency,
        },
        settings
      ),
      settings
    );
  }, [
    instrument,
    activeCapitalBasisValue,
    selectedRiskPercent,
    numEntry,
    numSL,
    numTP,
    position,
    settings,
  ]);

  // Auto-synchronize Lot Size in Trade Log when Auto-Lot is active and Entry & SL are valid
  useEffect(() => {
    if (!isAutoLotActive || preserveInitialRiskRef.current) {
      return;
    }
    if (xauLotCalcResult.isValid && xauLotCalcResult.recommendedLot > 0) {
      setLotSize(String(xauLotCalcResult.recommendedLot));
    }
  }, [
    isAutoLotActive,
    xauLotCalcResult.isValid,
    xauLotCalcResult.recommendedLot,
  ]);

  const lotOrderMetrics = calculateLotBasedOrderMetrics(
    {
      symbol: instrument,
      position,
      lotSize: !isNaN(numLot) && numLot > 0 ? numLot : 0,
      entryPrice: !isNaN(numEntry) && numEntry > 0 ? numEntry : 0,
      stopLossPrice: numSL !== undefined && !isNaN(numSL) && numSL > 0 ? numSL : undefined,
      takeProfitPrice: numTP !== undefined && !isNaN(numTP) && numTP > 0 ? numTP : undefined,
      exitPrice: numExit !== undefined && !isNaN(numExit) && numExit > 0 ? numExit : undefined,
      capitalBasis: activeCapitalBasisValue,
      capitalBasisType,
      customSpecOverride: xauBrokerSpecOverride,
    },
    settings
  );

  const plannedRR = computePlannedRiskReward(
    !isNaN(numEntry) ? numEntry : undefined,
    numSL,
    numTP,
    position
  );

  // Synchronize internal Risk Amount & Risk % automatically whenever Lot, Entry, SL, Position, or Instrument changes
  useEffect(() => {
    if (preserveInitialRiskRef.current) {
      return;
    }
    if (
      lotOrderMetrics.isSlValid &&
      lotOrderMetrics.riskAmount !== null &&
      lotOrderMetrics.riskPercent !== null
    ) {
      setRiskAmount(String(lotOrderMetrics.riskAmount));
      setRiskPercentage(String(lotOrderMetrics.riskPercent));
    } else if (stopLoss.trim() === '') {
      setRiskAmount('0');
      setRiskPercentage('0');
    }
  }, [
    lotOrderMetrics.isSlValid,
    lotOrderMetrics.riskAmount,
    lotOrderMetrics.riskPercent,
    stopLoss,
  ]);

  const handleExitPriceChange = (val: string) => {
    setExitPrice(val);
    const parsedEx = parseFloat(val);
    if (
      !isNaN(parsedEx) &&
      parsedEx > 0 &&
      !isNaN(numEntry) &&
      numEntry > 0 &&
      !isNaN(numLot) &&
      numLot > 0
    ) {
      const liveEstimatedMetrics = calculateLotBasedOrderMetrics(
        {
          symbol: instrument,
          position,
          lotSize: numLot,
          entryPrice: numEntry,
          exitPrice: parsedEx,
          capitalBasis: activeCapitalBasisValue,
          capitalBasisType,
          customSpecOverride: xauBrokerSpecOverride,
        },
        settings
      );
      if (liveEstimatedMetrics.estimatedExitGrossProfit !== null) {
        pnlInputModeRef.current = 'gross';
        const estGross = liveEstimatedMetrics.estimatedExitGrossProfit;
        setGrossProfit(estGross.toFixed(2));
        const comm = Math.abs(parseFloat(commission) || 0);
        const swp = parseFloat(swap) || 0;
        const autoNet = computeNetFromGross(estGross, comm, swp);
        setNetProfit(autoNet.toFixed(2));
        setOutcome(classifyNetProfitOutcome(autoNet));
      }
    }
  };

  const handleGrossProfitChange = (val: string) => {
    pnlInputModeRef.current = 'gross';
    setGrossProfit(val);
    const numGross = parseFloat(val);
    if (!isNaN(numGross)) {
      const comm = Math.abs(parseFloat(commission) || 0);
      const swp = parseFloat(swap) || 0;
      const syncedNet = computeNetFromGross(numGross, comm, swp);
      setNetProfit(syncedNet.toFixed(2));
      setOutcome(classifyNetProfitOutcome(syncedNet));
    }
  };

  const handleNetProfitChange = (val: string) => {
    pnlInputModeRef.current = 'net';
    setNetProfit(val);
    const numNet = parseFloat(val);
    if (!isNaN(numNet)) {
      const comm = Math.abs(parseFloat(commission) || 0);
      const swp = parseFloat(swap) || 0;
      const syncedGross = computeGrossFromNet(numNet, comm, swp);
      setGrossProfit(syncedGross.toFixed(2));
      setOutcome(classifyNetProfitOutcome(numNet));
    }
  };

  const handleCommissionChange = (val: string) => {
    setCommission(val);
    const comm = Math.abs(parseFloat(val) || 0);
    const swp = parseFloat(swap) || 0;
    if (pnlInputModeRef.current === 'net') {
      const numNet = parseFloat(netProfit);
      if (!isNaN(numNet)) {
        setGrossProfit(computeGrossFromNet(numNet, comm, swp).toFixed(2));
      }
    } else {
      const numGross = parseFloat(grossProfit);
      if (!isNaN(numGross)) {
        const syncedNet = computeNetFromGross(numGross, comm, swp);
        setNetProfit(syncedNet.toFixed(2));
        setOutcome(classifyNetProfitOutcome(syncedNet));
      }
    }
  };

  const handleSwapChange = (val: string) => {
    setSwap(val);
    const comm = Math.abs(parseFloat(commission) || 0);
    const swp = parseFloat(val) || 0;
    if (pnlInputModeRef.current === 'net') {
      const numNet = parseFloat(netProfit);
      if (!isNaN(numNet)) {
        setGrossProfit(computeGrossFromNet(numNet, comm, swp).toFixed(2));
      }
    } else {
      const numGross = parseFloat(grossProfit);
      if (!isNaN(numGross)) {
        const syncedNet = computeNetFromGross(numGross, comm, swp);
        setNetProfit(syncedNet.toFixed(2));
        setOutcome(classifyNetProfitOutcome(syncedNet));
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      triggerValidationError(
        tr('Ukuran file gambar maksimal 10 MB.', 'Maximum image file size is 10 MB.')
      );
      return;
    }

    try {
      const compressedDataUrl = await compressAndResizeImage(file);
      setScreenshotUrl(compressedDataUrl);
      setScanResultFeedback(null);
      // Auto-trigger ultra-fast AI scan immediately
      handleScanScreenshotAIRef.current
        ? handleScanScreenshotAIRef.current(compressedDataUrl)
        : handleScanScreenshotAI(compressedDataUrl);
    } catch {
      triggerValidationError(
        tr('Gagal memproses file gambar.', 'Failed to process image file.')
      );
    }
  };

  const handleScanScreenshotAI = async (sourceUrlOverride?: string) => {
    if (isScanningScreenshot) return;
    const targetSource = (sourceUrlOverride || screenshotUrl || '').trim();
    if (!targetSource) {
      triggerValidationError(
        tr(
          'Unggah gambar atau masukkan tautan screenshot terlebih dahulu.',
          'Please upload an image or enter a screenshot link first.'
        )
      );
      return;
    }

    setIsScanningScreenshot(true);
    setScanResultFeedback(null);
    setErrorMsg(null);

    try {
      const data = await scanTradeScreenshotOrUrl(targetSource);
      if (!data) {
        throw new Error(
          tr(
            'Tidak ada data setup yang terbaca pada gambar.',
            'No setup data could be read from the image.'
          )
        );
      }

      if (data.resolvedImageUrl && !targetSource.startsWith('data:image/')) {
        setScreenshotUrl(data.resolvedImageUrl);
      }

      // Re-enable real-time calculation sync
      preserveInitialRiskRef.current = false;

      const extractedInfoSummary: string[] = [];

      const targetInstrument = data.instrument || instrument;
      const targetPosition: TradePosition =
        data.position === 'SELL' ? 'SELL' : data.position === 'BUY' ? 'BUY' : position;

      if (data.instrument) {
        setInstrument(data.instrument);
        extractedInfoSummary.push(`Pair: ${data.instrument}`);
      }
      if (data.position === 'BUY' || data.position === 'SELL') {
        setPosition(data.position);
        extractedInfoSummary.push(`Posisi: ${data.position}`);
      }
      if (data.status === 'PLANNED') {
        setLifecycleStatus('PLANNED');
        if (data.source === 'MT5') {
          setOrderType('Pending');
        }
        extractedInfoSummary.push('Status: PLANNED');
      } else if (data.status === 'ACTIVE' || data.status === 'CLOSED') {
        setLifecycleStatus(data.status === 'ACTIVE' ? 'OPEN' : 'CLOSED');
        if (data.status === 'ACTIVE') {
          setOrderType('Market');
        }
        extractedInfoSummary.push(`Status: ${data.status}`);
      }
      if (data.entryPrice !== null && data.entryPrice !== undefined) {
        setEntryPrice(String(data.entryPrice));
        extractedInfoSummary.push(`Entry: ${data.entryPrice}`);
      } else {
        setEntryPrice('');
      }
      if (data.stopLoss !== null && data.stopLoss !== undefined) {
        setStopLoss(String(data.stopLoss));
        extractedInfoSummary.push(`SL: ${data.stopLoss}`);
      } else {
        setStopLoss('');
      }
      if (data.takeProfit !== null && data.takeProfit !== undefined) {
        setTakeProfit(String(data.takeProfit));
        extractedInfoSummary.push(`TP: ${data.takeProfit}`);
      } else {
        setTakeProfit('');
      }

      // Lot Size Policy:
      // - MT5: Directly input the lot size identified on MT5 and lock manual lot mode
      // - TradingView / Chart: Keep Auto-Lot active so Lot Size follows standard Equity & Risk % calculation
      if (
        data.source === 'MT5' &&
        data.lotSize !== null &&
        data.lotSize !== undefined &&
        data.lotSize > 0
      ) {
        setLotSize(String(data.lotSize));
        setIsAutoLotActive(false);
        extractedInfoSummary.push(`Lot MT5: ${data.lotSize}`);
      } else {
        setIsAutoLotActive(true);
        if (
          data.entryPrice !== null &&
          data.entryPrice !== undefined &&
          data.entryPrice > 0 &&
          data.stopLoss !== null &&
          data.stopLoss !== undefined &&
          data.stopLoss > 0
        ) {
          const autoEquityLotCalc = calculateXauusdLot(
            buildUnifiedXauusdLotInput(
              {
                symbol: targetInstrument,
                equity: activeCapitalBasisValue,
                riskPercent: selectedRiskPercent,
                entryPrice: data.entryPrice,
                stopLossPrice: data.stopLoss,
                takeProfitPrice:
                  data.takeProfit !== null && data.takeProfit !== undefined
                    ? data.takeProfit
                    : undefined,
                position: targetPosition,
                leverage: settings.defaultLeverage || 500,
                accountCurrency: settings.currency,
              },
              settings
            ),
            settings
          );
          if (autoEquityLotCalc.isValid && autoEquityLotCalc.recommendedLot > 0) {
            setLotSize(String(autoEquityLotCalc.recommendedLot));
            extractedInfoSummary.push(`Lot Auto Equity: ${autoEquityLotCalc.recommendedLot}`);
          }
        }
      }

      if (data.exitPrice !== null && data.exitPrice !== undefined && data.exitPrice > 0) {
        setExitPrice(String(data.exitPrice));
        extractedInfoSummary.push(`Exit: ${data.exitPrice}`);
      }
      if (data.profit !== null && data.profit !== undefined) {
        const p = Number(data.profit);
        setGrossProfit(p.toFixed(2));
        setNetProfit(p.toFixed(2));
        setOutcome(classifyNetProfitOutcome(p));
        extractedInfoSummary.push(`P/L: ${p >= 0 ? '+' : ''}${p.toFixed(2)}`);
      }

      if (data.notes) {
        setNotes((prev) => {
          const noteText = `[AI Screenshot Scan]: ${data.notes}`;
          if (!prev) return noteText;
          if (!prev.includes(data.notes)) return `${prev}\n${noteText}`;
          return prev;
        });
      }

      const sourceLabel = data.source === 'MT5' ? 'MetaTrader 5 (MT5)' : 'TradingView / Chart';
      setScanResultFeedback({
        type: 'success',
        message: tr(
          `Berhasil mendeteksi dari ${sourceLabel}: ${data.instrument} ${data.position}!`,
          `Successfully detected from ${sourceLabel}: ${data.instrument} ${data.position}!`
        ),
        details: {
          source: data.source,
          instrument: data.instrument,
          position: data.position,
          lotSize: data.source === 'MT5' ? data.lotSize : null,
          entryPrice: data.entryPrice,
          stopLoss: data.stopLoss,
          takeProfit: data.takeProfit,
          exitPrice: data.exitPrice,
          profit: data.profit,
          status: data.status,
          plannedRiskReward: data.plannedRiskReward,
        },
      });
    } catch (err: any) {
      setScanResultFeedback({
        type: 'error',
        message:
          err.message ||
          tr('Gagal memproses screenshot chart.', 'Failed to process chart screenshot.'),
      });
    } finally {
      setIsScanningScreenshot(false);
    }
  };

  useEffect(() => {
    handleScanScreenshotAIRef.current = handleScanScreenshotAI;
  });

  const handleOutcomeChange = (newOutcome: TradeOutcome) => {
    pnlInputModeRef.current = 'gross';
    setLifecycleStatus('CLOSED');
    setOutcome(newOutcome);
    const currentRiskVal =
      lotOrderMetrics.riskAmount !== null && lotOrderMetrics.riskAmount > 0
        ? lotOrderMetrics.riskAmount
        : parseFloat(riskAmount) || 0;

    if (newOutcome === 'LOSS') {
      if (
        lotOrderMetrics.estimatedExitGrossProfit !== null &&
        lotOrderMetrics.estimatedExitGrossProfit < 0
      ) {
        const g = lotOrderMetrics.estimatedExitGrossProfit;
        setGrossProfit(g.toFixed(2));
        const syncedNet = computeNetFromGross(
          g,
          Math.abs(parseFloat(commission) || 0),
          parseFloat(swap) || 0
        );
        setNetProfit(syncedNet.toFixed(2));
      } else if (currentRiskVal > 0) {
        const g = -currentRiskVal;
        setGrossProfit(g.toFixed(2));
        const syncedNet = computeNetFromGross(
          g,
          Math.abs(parseFloat(commission) || 0),
          parseFloat(swap) || 0
        );
        setNetProfit(syncedNet.toFixed(2));
      }
    } else if (newOutcome === 'BREAKEVEN') {
      setGrossProfit('0.00');
      const syncedNet = computeNetFromGross(
        0,
        Math.abs(parseFloat(commission) || 0),
        parseFloat(swap) || 0
      );
      setNetProfit(syncedNet.toFixed(2));
    } else if (newOutcome === 'WIN') {
      if (
        lotOrderMetrics.estimatedExitGrossProfit !== null &&
        lotOrderMetrics.estimatedExitGrossProfit > 0
      ) {
        const g = lotOrderMetrics.estimatedExitGrossProfit;
        setGrossProfit(g.toFixed(2));
        const syncedNet = computeNetFromGross(
          g,
          Math.abs(parseFloat(commission) || 0),
          parseFloat(swap) || 0
        );
        setNetProfit(syncedNet.toFixed(2));
      } else if (
        lotOrderMetrics.potentialProfit !== null &&
        lotOrderMetrics.potentialProfit > 0
      ) {
        const g = lotOrderMetrics.potentialProfit;
        setGrossProfit(g.toFixed(2));
        const syncedNet = computeNetFromGross(
          g,
          Math.abs(parseFloat(commission) || 0),
          parseFloat(swap) || 0
        );
        setNetProfit(syncedNet.toFixed(2));
      }
    }
  };

  const handleRegenerateId = () => {
    if (isSubmittingRef.current || isSubmitting) return;
    setId(generateUniqueId());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) {
      return;
    }
    setErrorMsg(null);

    const cleanId = id.trim();
    if (!cleanId) {
      triggerValidationError(
        tr('ID Transaksi tidak boleh kosong.', 'Trade ID cannot be empty.')
      );
      return;
    }

    const isNewTrade = !initialTrade || initialTrade.id !== cleanId;
    if (isNewTrade) {
      const duplicateExists = existingTrades.some(
        (t) => t.id.toLowerCase() === cleanId.toLowerCase() && t.id !== initialTrade?.id
      );
      if (duplicateExists) {
        triggerValidationError(
          tr(
            `ID Transaksi "${cleanId}" sudah digunakan oleh trade lain. Gunakan ID unik.`,
            `Trade ID "${cleanId}" is already used by another trade. Use a unique ID.`
          )
        );
        return;
      }
    }

    if (!tradeDate || !tradeTime) {
      triggerValidationError(
        tr('Tanggal dan jam transaksi wajib diisi.', 'Trade date and time are required.')
      );
      return;
    }

    const cleanInstrument = instrument.trim().toUpperCase();
    if (!cleanInstrument) {
      triggerValidationError(
        tr(
          'Simbol instrumen harus diisi (contoh: XAUUSD).',
          'Instrument symbol is required (example: XAUUSD).'
        )
      );
      return;
    }

    if (!position || (position !== 'BUY' && position !== 'SELL')) {
      triggerValidationError(
        tr('Arah transaksi (BUY / SELL) wajib dipilih.', 'Trade direction (BUY / SELL) is required.')
      );
      return;
    }

    const parsedLot = parseFloat(lotSize);
    if (isNaN(parsedLot) || parsedLot <= 0) {
      triggerValidationError(
        tr(
          'Lot harus berupa angka positif lebih dari 0.',
          'Lot size must be a positive number greater than 0.'
        )
      );
      return;
    }

    const parsedEntry = parseFloat(entryPrice);
    if (isNaN(parsedEntry) || parsedEntry <= 0) {
      triggerValidationError(
        tr(
          'Harga entry harus berupa angka positif yang valid.',
          'Entry price must be a valid positive number.'
        )
      );
      return;
    }

    let parsedSL: number | undefined = undefined;
    if (stopLoss.trim() !== '') {
      const num = parseFloat(stopLoss);
      if (isNaN(num) || num <= 0) {
        triggerValidationError(
          tr(
            'Stop Loss harus berupa angka positif jika diisi.',
            'Stop Loss must be a positive number if provided.'
          )
        );
        return;
      }
      parsedSL = num;
    }

    let parsedTP: number | undefined = undefined;
    if (takeProfit.trim() !== '') {
      const num = parseFloat(takeProfit);
      if (isNaN(num) || num <= 0) {
        triggerValidationError(
          tr(
            'Take Profit harus berupa angka positif jika diisi.',
            'Take Profit must be a positive number if provided.'
          )
        );
        return;
      }
      parsedTP = num;
    }

    const directionCheck = validateSlTpDirection(position, parsedEntry, parsedSL, parsedTP);
    if (!directionCheck.isValid) {
      triggerValidationError(
        directionCheck.errorMessage ||
          tr(
            'Arah Stop Loss / Take Profit tidak sesuai posisi order.',
            'Stop Loss / Take Profit direction does not match order position.'
          )
      );
      return;
    }

    let parsedExit: number | undefined = undefined;
    if (exitPrice.trim() !== '') {
      const num = parseFloat(exitPrice);
      if (isNaN(num) || num <= 0) {
        triggerValidationError(
          tr(
            'Harga Exit harus berupa angka positif jika diisi.',
            'Exit Price must be a positive number if provided.'
          )
        );
        return;
      }
      parsedExit = num;
    }

    const effectiveStatus: TradeLifecycleStatus =
      parsedExit !== undefined && lifecycleStatus === 'PLANNED'
        ? 'CLOSED'
        : lifecycleStatus;

    const normalizedComm = Math.abs(parseFloat(commission) || 0);
    const parsedSwp = parseFloat(swap) || 0;
    const parsedRiskAmt = parseFloat(riskAmount) || 0;
    const parsedRiskPct = parseFloat(riskPercentage) || 0;

    let normalizedNet = 0;
    let synchronizedGross = 0;

    if (effectiveStatus === 'CLOSED') {
      const rawNet =
        netProfit.trim() !== ''
          ? parseFloat(netProfit)
          : lotOrderMetrics.estimatedExitGrossProfit !== null
          ? computeNetFromGross(
              lotOrderMetrics.estimatedExitGrossProfit,
              normalizedComm,
              parsedSwp
            )
          : 0;
      if (isNaN(rawNet)) {
        triggerValidationError(
          tr(
            'Hasil bersih (Net Profit) harus berupa angka yang valid.',
            'Net Profit must be a valid number.'
          )
        );
        return;
      }
      normalizedNet = Number(rawNet.toFixed(2));
      const parsedGross = parseFloat(grossProfit);
      synchronizedGross =
        isNaN(parsedGross) ||
        pnlInputModeRef.current === 'net' ||
        Math.abs(computeNetFromGross(parsedGross, normalizedComm, parsedSwp) - normalizedNet) >
          0.005
          ? computeGrossFromNet(normalizedNet, normalizedComm, parsedSwp)
          : Number(parsedGross.toFixed(2));
    }

    const computedR =
      effectiveStatus === 'CLOSED'
        ? computeRealizedRMultiple({
            netProfit: normalizedNet,
            riskAmount: parsedRiskAmt,
          })
        : null;
    const rMultiple: number | undefined = computedR !== null ? computedR : undefined;
    const finalOutcome: TradeOutcome =
      effectiveStatus === 'CLOSED' ? classifyNetProfitOutcome(normalizedNet) : 'BREAKEVEN';

    const baseExecutionNotes = encodeExecutionAdherenceNotes(adherenceTag, cleanExecutionNotes);
    const finalCompliance = evaluateTradeCompliance(
      {
        instrument: cleanInstrument,
        position,
        lotSize: parsedLot,
        entryPrice: parsedEntry,
        stopLoss: parsedSL,
        takeProfit: parsedTP,
        exitPrice: effectiveStatus === 'CLOSED' ? parsedExit : undefined,
        riskAmount: parsedRiskAmt,
        netProfit: normalizedNet,
        executionNotes: baseExecutionNotes || undefined,
      },
      settings
    );

    // Build genuine Activity Log & preserve initial Trade Plan on edits
    const nowIso = new Date().toISOString();
    const existingResolved = initialTrade ? resolveTradeLifecycle(initialTrade) : null;
    const nextActivityLog = existingResolved ? [...existingResolved.activityLog] : [];

    if (!initialTrade) {
      nextActivityLog.push(
        createActivityEvent('TRADE_CREATED', `Trade Created (${orderType} • ${effectiveStatus})`, {
          timestamp: nowIso,
          newValue: `${cleanInstrument} ${position} ${parsedLot.toFixed(2)} Lot @ ${parsedEntry.toFixed(2)}`,
        })
      );
      if (effectiveStatus === 'OPEN' || effectiveStatus === 'CLOSED') {
        nextActivityLog.push(
          createActivityEvent('POSITION_OPENED', 'Position Opened', {
            timestamp: dateTime,
            newValue: `Entry: ${parsedEntry.toFixed(2)} (${parsedLot.toFixed(2)} Lot)`,
          })
        );
      }
      if (effectiveStatus === 'CLOSED') {
        nextActivityLog.push(
          createActivityEvent('POSITION_CLOSED', `Position Closed (${closeType})`, {
            timestamp: nowIso,
            newValue: `Net P/L: ${normalizedNet >= 0 ? '+' : ''}${normalizedNet.toFixed(2)}`,
          })
        );
      }
      if (postTradeEvaluation.trim()) {
        nextActivityLog.push(
          createActivityEvent('EVALUATION_ADDED', 'Evaluation Added', {
            timestamp: nowIso,
          })
        );
      }
    } else {
      if (initialTrade.stopLoss !== parsedSL) {
        nextActivityLog.push(
          createActivityEvent('SL_CHANGED', 'Stop Loss Changed', {
            timestamp: nowIso,
            previousValue:
              initialTrade.stopLoss !== undefined ? initialTrade.stopLoss.toFixed(2) : 'Kosong',
            newValue: parsedSL !== undefined ? parsedSL.toFixed(2) : 'Kosong',
          })
        );
      }
      if (initialTrade.takeProfit !== parsedTP) {
        nextActivityLog.push(
          createActivityEvent('TP_CHANGED', 'Take Profit Changed', {
            timestamp: nowIso,
            previousValue:
              initialTrade.takeProfit !== undefined
                ? initialTrade.takeProfit.toFixed(2)
                : 'Kosong',
            newValue: parsedTP !== undefined ? parsedTP.toFixed(2) : 'Kosong',
          })
        );
      }
      if (
        postTradeEvaluation.trim() &&
        postTradeEvaluation.trim() !== (initialTrade.postTradeEvaluation || '').trim()
      ) {
        nextActivityLog.push(
          createActivityEvent('EVALUATION_ADDED', 'Evaluation Added / Updated', {
            timestamp: nowIso,
          })
        );
      }
    }

    const preservePlanFromExisting =
      existingResolved && existingResolved.status !== 'PLANNED';

    const existingSnapshot =
      initialTrade?.closeExchangeRate || existingResolved?.closeExchangeRate;
    const finalCloseSnapshot =
      effectiveStatus === 'CLOSED'
        ? existingSnapshot &&
          Number.isFinite(existingSnapshot.rate) &&
          existingSnapshot.rate > 0
          ? existingSnapshot
          : getCurrentUsdIdrSnapshot(getCachedUsdIdrRate())
        : undefined;

    const lifecycleMeta: TradeLifecycleMeta = {
      status: effectiveStatus,
      orderType,
      plannedEntry: preservePlanFromExisting
        ? existingResolved.plannedEntry
        : parsedEntry,
      plannedLot: preservePlanFromExisting
        ? existingResolved.plannedLot
        : parsedLot,
      plannedStopLoss: preservePlanFromExisting
        ? existingResolved.plannedStopLoss ?? parsedSL
        : parsedSL,
      plannedTakeProfit: preservePlanFromExisting
        ? existingResolved.plannedTakeProfit ?? parsedTP
        : parsedTP,
      plannedDateTime: preservePlanFromExisting
        ? existingResolved.plannedDateTime
        : dateTime,
      actualEntry:
        effectiveStatus === 'OPEN' || effectiveStatus === 'CLOSED'
          ? parsedEntry
          : undefined,
      actualLot:
        effectiveStatus === 'OPEN' || effectiveStatus === 'CLOSED'
          ? parsedLot
          : undefined,
      actualExit: effectiveStatus === 'CLOSED' ? parsedExit : undefined,
      entryTime:
        effectiveStatus === 'OPEN' || effectiveStatus === 'CLOSED'
          ? existingResolved?.entryTime || dateTime
          : undefined,
      exitTime:
        effectiveStatus === 'CLOSED'
          ? existingResolved?.exitTime || nowIso
          : undefined,
      closeType: effectiveStatus === 'CLOSED' ? closeType : undefined,
      // Omit beforeScreenshotUrl when stored in main trade.screenshotUrl so Base64/paths are never duplicated in [TV_META]
      beforeScreenshotUrl: undefined,
      afterScreenshotUrl: afterScreenshotUrl.trim() || undefined,
      cancellationReason: existingResolved?.cancellationReason,
      cancelledAt: existingResolved?.cancelledAt,
      closeExchangeRate: finalCloseSnapshot,
      activityLog: nextActivityLog,
    };

    const finalExecutionNotes = encodeLifecycleMetaIntoExecutionNotes(
      baseExecutionNotes,
      lifecycleMeta
    );

    const tradeData: Trade = {
      id: cleanId,
      dateTime,
      instrument: cleanInstrument,
      position,
      strategy: strategy.trim() || 'Umum',
      session: session.trim() || 'London',
      entryPrice: parsedEntry,
      stopLoss: parsedSL,
      takeProfit: parsedTP,
      exitPrice: effectiveStatus === 'CLOSED' ? parsedExit : undefined,
      lotSize: parsedLot,
      riskAmount: parsedRiskAmt,
      riskPercentage: parsedRiskPct,
      outcome: finalOutcome,
      grossProfit: synchronizedGross,
      commission: normalizedComm,
      swap: parsedSwp,
      netProfit: normalizedNet,
      rMultiple,
      screenshotUrl: screenshotUrl.trim() || undefined,
      notes: notes.trim() || undefined,
      entryReason: entryReason.trim() || undefined,
      postTradeEvaluation: postTradeEvaluation.trim() || undefined,
      disciplineRating:
        effectiveStatus === 'CLOSED' && finalCompliance.rating !== null
          ? finalCompliance.rating
          : undefined,
      executionNotes: finalExecutionNotes || undefined,
      closeExchangeRate: finalCloseSnapshot,
      isDemo: initialTrade?.isDemo || false,
      createdAt: initialTrade?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const saveResult = await onSave(tradeData, initialTrade?.id);
      if (saveResult && typeof saveResult === 'object') {
        if (saveResult.uploadedScreenshotPath) {
          setScreenshotUrl(saveResult.uploadedScreenshotPath);
        }
        if (!saveResult.success && !saveResult.ignored) {
          triggerValidationError(
            saveResult.error ||
              tr(
                'Gagal menyimpan transaksi. Data formulir Anda tetap tersimpan.',
                'Failed to save trade. Your form data remains intact.'
              )
          );
        }
      }
    } catch (err: any) {
      triggerValidationError(
        err?.message ||
          tr(
            'Gagal menyimpan transaksi. Silakan periksa koneksi Anda dan coba lagi.',
            'Failed to save trade. Please check your connection and try again.'
          )
      );
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const filteredInstruments = COMMON_INSTRUMENTS.filter((sym) =>
    sym.toLowerCase().includes(instrumentSearch.toLowerCase().trim())
  );

  const displayedRiskAmount =
    lotOrderMetrics.isSlValid && lotOrderMetrics.riskAmount !== null
      ? lotOrderMetrics.riskAmount
      : parseFloat(riskAmount) || 0;

  const displayedRiskPercent =
    lotOrderMetrics.isSlValid && lotOrderMetrics.riskPercent !== null
      ? lotOrderMetrics.riskPercent
      : parseFloat(riskPercentage) || 0;

  const activeSessionObj =
    PRIMARY_SESSIONS.find((s) => s.key === session) || PRIMARY_SESSIONS[1];

  const formCardContent = (
    <form
      onSubmit={handleSubmit}
      data-testid="add-trade-popup-form"
      className="relative w-[92vw] sm:w-full max-w-[420px] max-h-[calc(100vh-1.5rem)] supports-[height:100dvh]:max-h-[calc(100dvh-1.5rem)] my-auto shrink-0 flex flex-col rounded-[28px] border border-[#DDE3EA] dark:border-[#1E232B] bg-white dark:bg-[#0B0D11] text-[#151D2A] dark:text-[#F2F4F7] font-['Arial',Helvetica,sans-serif] shadow-[0_24px_64px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.85)] overflow-hidden select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* =================================================================== */}
      {/* MAIN VIEW — COMPACT TRANSACTION INPUTS (Single Seamless Panel)      */}
      {/* =================================================================== */}
      <div
        className={`flex flex-col w-full h-full min-h-0 transition-opacity duration-200 ${
          isDetailViewOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        aria-hidden={isDetailViewOpen}
      >
        {/* 1. Header "Tambah Transaksi" & Close Button */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#DDE3EA] dark:border-[#1E232B] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-[15px] font-bold tracking-tight text-[#151D2A] dark:text-[#F2F4F7] truncate">
              {initialTrade
                ? tr('Edit Transaksi', 'Edit Trade')
                : tr('Tambah Transaksi', 'Add Trade')}
            </h2>
            {lifecycleStatus === 'CLOSED' && (
              <span className="text-[10px] font-semibold tracking-wider uppercase text-[#697586] dark:text-[#929BA9]">
                · {tr('SELESAI', 'CLOSED')}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-full p-1.5 text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-[#F5F7FA] dark:hover:bg-[#151921] active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            title={tr('Tutup Formulir', 'Close Form')}
            aria-label={tr('Tutup formulir transaksi', 'Close trade form')}
          >
            <X className="h-4 w-4 stroke-[2]" />
          </button>
        </div>

        {/* Main Body (Compact, fits standard mobile screens without scroll, safe overflow-y-auto fallback for tiny screens/keyboard) */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#DDE3EA] dark:divide-[#1E232B] min-h-0">
          {/* Error Banner (if any) */}
          {errorMsg && !isDetailViewOpen && (
            <div ref={errorRef} tabIndex={-1} className="px-5 py-2.5 bg-[#E05260]/10 outline-none">
              <div className="flex items-center gap-2 text-[11px] text-[#E05260]">
                <AlertCircle className="h-3.5 w-3.5 stroke-[2] shrink-0" />
                <span className="leading-snug">{errorMsg}</span>
              </div>
            </div>
          )}

          {/* 2 & 3. Pair / Instrument Dropdown + Order Status Label (LIMIT / MARKET) */}
          <div className="px-5 py-2.5 flex items-center justify-between gap-3">
            {/* 2. Pair / Instrument Dropdown */}
            <div className="relative flex-1 min-w-0">
              <span className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                {tr('Pasangan / Instrumen', 'Pair / Instrument')}
              </span>
              <button
                type="button"
                onClick={() => setIsInstrumentDropdownOpen(!isInstrumentDropdownOpen)}
                className="inline-flex items-center gap-1.5 text-left text-sm font-bold tracking-wide text-[#151D2A] dark:text-[#F2F4F7] hover:text-black dark:hover:text-white active:scale-[0.99] transition-all cursor-pointer"
              >
                <span>{instrument || 'XAUUSD'}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[#697586] dark:text-[#929BA9] transition-transform duration-200 ${
                    isInstrumentDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isInstrumentDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-56 z-30 p-2 rounded-2xl bg-white dark:bg-[#12161D] border border-[#DDE3EA] dark:border-[#242A35] shadow-2xl space-y-1.5">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#F5F7FA] dark:bg-[#0B0D11] border border-[#DDE3EA] dark:border-[#1E232B]">
                    <Search className="h-3.5 w-3.5 text-[#697586] dark:text-[#929BA9] shrink-0" />
                    <input
                      type="text"
                      value={instrumentSearch}
                      onChange={(e) => setInstrumentSearch(e.target.value.toUpperCase())}
                      placeholder={tr('Cari simbol...', 'Search symbol...')}
                      className="w-full bg-transparent text-xs font-bold uppercase tracking-wider text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#606875] focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && instrumentSearch.trim()) {
                          e.preventDefault();
                          preserveInitialRiskRef.current = false;
                          setInstrument(instrumentSearch.trim());
                          setInstrumentSearch('');
                          setIsInstrumentDropdownOpen(false);
                        }
                      }}
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-0.5 pr-0.5">
                    {filteredInstruments.map((sym) => {
                      const isSelected = instrument === sym;
                      return (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => {
                            preserveInitialRiskRef.current = false;
                            setInstrument(sym);
                            setInstrumentSearch('');
                            setIsInstrumentDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#151D2A] text-white dark:bg-[#F2F4F7] dark:text-[#050607]'
                              : 'text-[#151D2A] dark:text-[#F2F4F7] hover:bg-[#F5F7FA] dark:hover:bg-[#1A202A]'
                          }`}
                        >
                          <span>{sym}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-white dark:text-[#050607]" />}
                        </button>
                      );
                    })}
                    {filteredInstruments.length === 0 && instrumentSearch.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          preserveInitialRiskRef.current = false;
                          setInstrument(instrumentSearch.trim());
                          setInstrumentSearch('');
                          setIsInstrumentDropdownOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-bold text-[#151D2A] dark:text-[#F2F4F7] hover:bg-[#F5F7FA] dark:hover:bg-[#1A202A] cursor-pointer"
                      >
                        {tr('Gunakan', 'Use')} &quot;{instrumentSearch.trim()}&quot;
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Small Order Status Label (MARKET / LIMIT + Pending Order info) */}
            <div className="text-right shrink-0">
              <div className="inline-flex items-center gap-1 rounded-full bg-[#F5F7FA] dark:bg-[#12161D] p-0.5 border border-[#DDE3EA] dark:border-[#1E232B]">
                <button
                  type="button"
                  onClick={() => setOrderType('Market')}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all cursor-pointer ${
                    orderType === 'Market'
                      ? 'bg-white dark:bg-[#202631] text-[#151D2A] dark:text-[#F2F4F7] shadow-2xs dark:shadow-none'
                      : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  MARKET
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOrderType('Pending');
                    if (!initialTrade) {
                      setLifecycleStatus('PLANNED');
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all cursor-pointer ${
                    orderType === 'Pending'
                      ? 'bg-white dark:bg-[#202631] text-[#151D2A] dark:text-[#F2F4F7] shadow-2xs dark:shadow-none'
                      : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  LIMIT
                </button>
              </div>
              {orderType === 'Pending' && (
                <div className="text-[9px] text-[#697586] dark:text-[#929BA9] mt-0.5">
                  {tr('Order Tertunda', 'Pending Order')}
                </div>
              )}
            </div>
          </div>

          {/* 4. BUY and SELL Selector (Monochrome active indicator, smooth sliding animation) */}
          <div className="px-5 py-2.5">
            <div className="relative grid grid-cols-2 rounded-full bg-[#F5F7FA] dark:bg-[#12161D] p-1 border border-[#DDE3EA] dark:border-[#1E232B]">
              {/* Smooth Sliding Active Indicator */}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-[#151D2A] dark:bg-[#F2F4F7] shadow-sm transition-transform duration-200 ease-out ${
                  position === 'SELL' ? 'translate-x-full' : 'translate-x-0'
                }`}
              />
              <button
                type="button"
                onClick={() => {
                  preserveInitialRiskRef.current = false;
                  setPosition('BUY');
                }}
                className={`relative z-10 py-1.5 rounded-full text-xs font-bold tracking-wider text-center transition-colors duration-200 cursor-pointer ${
                  position === 'BUY'
                    ? 'text-white dark:text-[#050607]'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => {
                  preserveInitialRiskRef.current = false;
                  setPosition('SELL');
                }}
                className={`relative z-10 py-1.5 rounded-full text-xs font-bold tracking-wider text-center transition-colors duration-200 cursor-pointer ${
                  position === 'SELL'
                    ? 'text-white dark:text-[#050607]'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                }`}
              >
                SELL
              </button>
            </div>
          </div>

          {/* 5. Entry Price */}
          <div className="px-5 py-2.5 flex items-center justify-between gap-3">
            <label
              htmlFor="trade-entry-price-input"
              className="text-xs text-[#697586] dark:text-[#929BA9] shrink-0"
            >
              {tr('Harga Entry', 'Entry Price')}
            </label>
            <input
              id="trade-entry-price-input"
              type="number"
              step="any"
              inputMode="decimal"
              value={entryPrice}
              onChange={(e) => {
                preserveInitialRiskRef.current = false;
                setEntryPrice(e.target.value);
              }}
              placeholder="0.00"
              className="w-40 bg-transparent text-right text-sm font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-b focus:border-[#697586] dark:focus:border-[#929BA9]"
              required
            />
          </div>

          {/* 6. Stop Loss and Take Profit in One Row */}
          <div className="grid grid-cols-2 divide-x divide-[#DDE3EA] dark:divide-[#1E232B]">
            <div className="px-5 py-2.5">
              <div className="flex items-center justify-between mb-0.5">
                <label
                  htmlFor="trade-sl-input"
                  className="text-[11px] text-[#697586] dark:text-[#929BA9]"
                >
                  Stop Loss
                </label>
                {lotOrderMetrics.isSlValid && lotOrderMetrics.slDistancePips !== null && (
                  <span className="text-[10px] tabular-nums text-[#E11D48] dark:text-[#E05260]">
                    {lotOrderMetrics.slDistancePips}p
                  </span>
                )}
              </div>
              <input
                id="trade-sl-input"
                type="number"
                step="any"
                inputMode="decimal"
                value={stopLoss}
                onChange={(e) => {
                  preserveInitialRiskRef.current = false;
                  setStopLoss(e.target.value);
                }}
                placeholder="0.00"
                className="w-full bg-transparent text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none"
              />
            </div>

            <div className="px-5 py-2.5">
              <div className="flex items-center justify-between mb-0.5">
                <label
                  htmlFor="trade-tp-input"
                  className="text-[11px] text-[#697586] dark:text-[#929BA9]"
                >
                  Take Profit
                </label>
                {lotOrderMetrics.isTpValid && lotOrderMetrics.tpDistancePips !== null && (
                  <span className="text-[10px] tabular-nums text-[#059669] dark:text-[#00A878]">
                    {lotOrderMetrics.tpDistancePips}p
                  </span>
                )}
              </div>
              <input
                id="trade-tp-input"
                type="number"
                step="any"
                inputMode="decimal"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none"
              />
            </div>
          </div>

          {/* Inline SL/TP Validation Feedback (only when invalid) */}
          {(!lotOrderMetrics.isSlValid || !lotOrderMetrics.isTpValid) && (
            <div className="px-5 py-1.5 bg-[#E05260]/10 text-[11px] text-[#E11D48] dark:text-[#E05260] flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {lotOrderMetrics.slErrorMessage || lotOrderMetrics.tpErrorMessage}
              </span>
            </div>
          )}

          {/* 7. Lot Size and Risk in One Row (Lot Size is primary input, Risk is automatic from lot) */}
          <div className="grid grid-cols-2 divide-x divide-[#DDE3EA] dark:divide-[#1E232B]">
            <div className="px-5 py-2.5">
              <div className="flex items-center justify-between mb-0.5">
                <label
                  htmlFor="trade-lot-input"
                  className="text-[11px] text-[#697586] dark:text-[#929BA9]"
                >
                  {tr('Ukuran Lot', 'Lot Size')}
                </label>
                {xauLotCalcResult.isValid && xauLotCalcResult.recommendedLot > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      preserveInitialRiskRef.current = false;
                      setIsAutoLotActive(true);
                      setLotSize(String(xauLotCalcResult.recommendedLot));
                    }}
                    className="text-[9px] font-semibold text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] underline cursor-pointer"
                    title={tr(
                      'Gunakan rekomendasi lot otomatis sesuai Ekuitas',
                      'Use automatic recommended lot based on Equity'
                    )}
                  >
                    {tr('Rek', 'Rec')} {xauLotCalcResult.recommendedLot}
                  </button>
                )}
              </div>
              <input
                id="trade-lot-input"
                type="number"
                step="0.01"
                min="0.01"
                inputMode="decimal"
                value={lotSize}
                onChange={(e) => {
                  preserveInitialRiskRef.current = false;
                  setIsAutoLotActive(false);
                  setLotSize(e.target.value);
                }}
                placeholder="0.01"
                className="w-full bg-transparent text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none"
                required
              />
            </div>

            <div className="px-5 py-2.5">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr('Risiko', 'Risk')}
                </span>
                <span className="text-[9px] text-[#94A3B8] dark:text-[#606875]">
                  {tr('Otomatis dari lot', 'Auto from lot')}
                </span>
              </div>
              <div className="text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] truncate">
                {displayedRiskAmount > 0
                  ? `${fmtMoney(displayedRiskAmount)} (${displayedRiskPercent.toFixed(2)}%)`
                  : '-'}
              </div>
            </div>
          </div>

          {/* 8 & 9. Potential Loss, Potential Profit in One Row + Risk / Reward Compact Row */}
          <div className="px-5 py-2.5 space-y-1.5">
            {/* 8. Potential Loss & Potential Profit */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr('Potensi Rugi', 'Potential Loss')}
                </span>
                <span className="text-xs font-bold tabular-nums text-[#E11D48] dark:text-[#E05260]">
                  {lotOrderMetrics.riskAmount !== null && lotOrderMetrics.riskAmount > 0
                    ? `-${fmtMoney(lotOrderMetrics.riskAmount)}`
                    : '-'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr('Potensi Profit', 'Potential Profit')}
                </span>
                <span className="text-xs font-bold tabular-nums text-[#059669] dark:text-[#00A878]">
                  {lotOrderMetrics.potentialProfit !== null && lotOrderMetrics.potentialProfit > 0
                    ? `+${fmtMoney(lotOrderMetrics.potentialProfit)}`
                    : '-'}
                </span>
              </div>
            </div>

            {/* 9. Risk / Reward */}
            <div className="flex items-center justify-between pt-1 border-t border-[#DDE3EA]/70 dark:border-[#1E232B]/60">
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr('Risiko / Imbalan (R:R)', 'Risk / Reward')}
              </span>
              <span className="text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7]">
                {formatPlannedRR(plannedRR)}
              </span>
            </div>
          </div>

          {/* 10. Button "Detail lainnya" */}
          <div className="px-5 py-2.5">
            <button
              type="button"
              onClick={() => setIsDetailViewOpen(true)}
              data-testid="open-detail-view-button"
              className="w-full flex items-center justify-between py-1 text-xs font-semibold text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] active:scale-[0.99] transition-all cursor-pointer"
            >
              <span>{tr('Detail lainnya', 'More details')}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[#151D2A] dark:text-[#F2F4F7]">
                <span className="truncate max-w-[170px] text-[#697586] dark:text-[#929BA9] font-normal">
                  {strategy || tr(activeSessionObj.labelId, activeSessionObj.labelEn)} ·{' '}
                  {lifecycleStatus === 'PLANNED'
                    ? tr('DIRENCANAKAN', 'PLANNED')
                    : lifecycleStatus === 'OPEN'
                    ? tr('AKTIF', 'OPEN')
                    : tr('SELESAI', 'CLOSED')}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-[#697586] dark:text-[#929BA9]" />
              </span>
            </button>
          </div>
        </div>

        {/* 11. Footer Buttons: Batal & Simpan */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[#DDE3EA] dark:border-[#1E232B] bg-white dark:bg-[#0B0D11] shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 py-2.5 rounded-full bg-[#F5F7FA] dark:bg-[#151921] hover:bg-[#EEF2F6] dark:hover:bg-[#1C222D] active:scale-[0.98] text-xs font-semibold text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] transition-all disabled:opacity-50 cursor-pointer"
          >
            {tr('Batal', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            data-testid="save-trade-submit-button"
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-[#151D2A] hover:bg-[#1E293B] text-white dark:bg-[#F2F4F7] dark:hover:bg-white active:scale-[0.98] dark:text-[#050607] text-xs font-bold transition-all disabled:opacity-60 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{tr('Menyimpan...', 'Saving...')}</span>
              </>
            ) : (
              <span>{tr('Simpan', 'Save')}</span>
            )}
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* DETAIL VIEW — SLIDE-UP PANEL (Same Bubble Dimensions)               */}
      {/* =================================================================== */}
      <div
        data-testid="trade-detail-slide-panel"
        aria-hidden={!isDetailViewOpen}
        className={`absolute inset-0 z-20 flex flex-col bg-white dark:bg-[#0B0D11] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isDetailViewOpen
            ? 'translate-y-0 pointer-events-auto'
            : 'translate-y-full pointer-events-none'
        }`}
      >
        {/* Detail View Header: "Detail Transaksi" & Close Button */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#DDE3EA] dark:border-[#1E232B] shrink-0">
          <h2 className="text-[15px] font-bold tracking-tight text-[#151D2A] dark:text-[#F2F4F7]">
            {tr('Detail Transaksi', 'Trade Details')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-full p-1.5 text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] hover:bg-[#F5F7FA] dark:hover:bg-[#151921] active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            title={tr('Tutup Formulir', 'Close Form')}
            aria-label={tr('Tutup formulir transaksi', 'Close trade form')}
          >
            <X className="h-4 w-4 stroke-[2]" />
          </button>
        </div>

        {/* Detail View Scrollable Body (Hairline dividers, zero cards) */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#DDE3EA] dark:divide-[#1E232B] min-h-0">
          {/* Error Banner in Detail View */}
          {errorMsg && isDetailViewOpen && (
            <div className="px-5 py-2.5 bg-[#E05260]/10">
              <div className="flex items-center gap-2 text-[11px] text-[#E11D48] dark:text-[#E05260]">
                <AlertCircle className="h-3.5 w-3.5 stroke-[2] shrink-0" />
                <span className="leading-snug">{errorMsg}</span>
              </div>
            </div>
          )}

          {/* Status Transaksi (PLANNED / OPEN / CLOSED) & Preset Risiko */}
          <div className="px-5 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr('Status Transaksi', 'Trade Status')}
              </span>
              <div className="inline-flex items-center rounded-full bg-[#F5F7FA] dark:bg-[#12161D] p-0.5 border border-[#DDE3EA] dark:border-[#1E232B]">
                {(
                  [
                    { key: 'PLANNED', labelId: 'Rencana', labelEn: 'Planned' },
                    { key: 'OPEN', labelId: 'Aktif', labelEn: 'Open' },
                    { key: 'CLOSED', labelId: 'Selesai', labelEn: 'Closed' },
                  ] as const
                ).map((st) => {
                  const isActive = lifecycleStatus === st.key;
                  return (
                    <button
                      key={st.key}
                      type="button"
                      onClick={() => setLifecycleStatus(st.key)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#151D2A] text-white dark:bg-[#F2F4F7] dark:text-[#050607]'
                          : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {tr(st.labelId, st.labelEn)}
                    </button>
                  );
                })}
              </div>
            </div>

            {isXauInstrument && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[10px] text-[#697586] dark:text-[#929BA9]">
                  {tr('Preset Risiko Lot', 'Lot Risk Preset')}
                </span>
                <div className="flex items-center gap-1">
                  {POSITION_SIZING_RISK_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        preserveInitialRiskRef.current = false;
                        setSelectedRiskPercent(pct);
                        setIsAutoLotActive(true);
                      }}
                      className={`px-2 py-0.5 rounded-full text-[10px] tabular-nums transition-colors cursor-pointer ${
                        isAutoLotActive && selectedRiskPercent === pct
                          ? 'bg-[#151D2A] text-white dark:bg-[#F2F4F7] dark:text-[#050607] font-bold'
                          : 'bg-[#F5F7FA] dark:bg-[#12161D] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 1. Strategy Dropdown */}
          <div className="px-5 py-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                {tr('Strategi', 'Strategy')}
              </span>
              {strategy && (
                <button
                  type="button"
                  onClick={() => setStrategy('')}
                  className="text-[10px] text-[#697586] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] cursor-pointer"
                >
                  {tr('Atur Ulang', 'Reset')}
                </button>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsStrategyPickerOpen(!isStrategyPickerOpen)}
                className="w-full flex items-center justify-between py-1 text-xs font-semibold text-left text-[#151D2A] dark:text-[#F2F4F7] cursor-pointer"
              >
                <span className={strategy ? 'text-[#151D2A] dark:text-[#F2F4F7]' : 'text-[#94A3B8] dark:text-[#606875]'}>
                  {strategy || tr('Pilih atau ketik strategi...', 'Select or type strategy...')}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[#697586] dark:text-[#929BA9] transition-transform duration-200 ${
                    isStrategyPickerOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isStrategyPickerOpen && (
                <div className="mt-2 p-2.5 rounded-2xl bg-[#F5F7FA] dark:bg-[#12161D] border border-[#DDE3EA] dark:border-[#242A35] space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customStrategyInput}
                      onChange={(e) => setCustomStrategyInput(e.target.value)}
                      placeholder={tr('Ketik strategi kustom...', 'Type custom strategy...')}
                      className="flex-1 rounded-xl bg-white dark:bg-[#0B0D11] border border-[#DDE3EA] dark:border-[#1E232B] px-2.5 py-1.5 text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#606875] focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customStrategyInput.trim()) {
                          e.preventDefault();
                          setStrategy(customStrategyInput.trim());
                          setCustomStrategyInput('');
                          setIsStrategyPickerOpen(false);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customStrategyInput.trim()) {
                          setStrategy(customStrategyInput.trim());
                          setCustomStrategyInput('');
                          setIsStrategyPickerOpen(false);
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[#151D2A] text-white dark:bg-[#F2F4F7] dark:text-[#050607] text-xs font-bold cursor-pointer"
                    >
                      {tr('Pilih', 'Select')}
                    </button>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
                    {COMMON_STRATEGIES.map((strat) => {
                      const isSelected = strategy === strat;
                      return (
                        <button
                          key={strat}
                          type="button"
                          onClick={() => {
                            setStrategy(strat);
                            setIsStrategyPickerOpen(false);
                          }}
                          className={`w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-xl text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#151D2A] text-white dark:bg-[#F2F4F7] dark:text-[#050607] font-bold'
                              : 'text-[#151D2A] dark:text-[#F2F4F7] hover:bg-white dark:hover:bg-[#1A202A]'
                          }`}
                        >
                          <span className="truncate">{strat}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-white dark:text-[#050607] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 2. Trading Session Dropdown */}
          <div className="px-5 py-2.5">
            <span className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
              {tr('Sesi Trading', 'Trading Session')}
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSessionDropdownOpen(!isSessionDropdownOpen)}
                className="w-full flex items-center justify-between py-1 text-xs font-semibold text-left text-[#151D2A] dark:text-[#F2F4F7] cursor-pointer"
              >
                <span>
                  {tr(activeSessionObj.labelId, activeSessionObj.labelEn)}{' '}
                  <span className="text-[#697586] dark:text-[#929BA9] font-normal">
                    ({tr(activeSessionObj.descId, activeSessionObj.descEn)})
                  </span>
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[#697586] dark:text-[#929BA9] transition-transform duration-200 ${
                    isSessionDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isSessionDropdownOpen && (
                <div className="mt-1.5 p-1.5 rounded-2xl bg-[#F5F7FA] dark:bg-[#12161D] border border-[#DDE3EA] dark:border-[#242A35] space-y-0.5">
                  {PRIMARY_SESSIONS.map((s) => {
                    const isSelected = session === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => {
                          setSession(s.key);
                          setIsSessionDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#151D2A] text-white dark:bg-[#F2F4F7] dark:text-[#050607] font-bold'
                            : 'text-[#151D2A] dark:text-[#F2F4F7] hover:bg-white dark:hover:bg-[#1A202A]'
                        }`}
                      >
                        <span>
                          {tr(s.labelId, s.labelEn)} ·{' '}
                          <span className="opacity-75">{tr(s.descId, s.descEn)}</span>
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-white dark:text-[#050607]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 3 & 4. Date and Time */}
          <div className="grid grid-cols-2 divide-x divide-[#DDE3EA] dark:divide-[#1E232B]">
            <div className="px-5 py-2.5">
              <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                {tr('Tanggal', 'Date')}
              </label>
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="w-full bg-transparent text-xs font-semibold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none dark:[color-scheme:dark]"
                required
              />
            </div>
            <div className="px-5 py-2.5">
              <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                {tr('Waktu', 'Time')}
              </label>
              <input
                type="time"
                value={tradeTime}
                onChange={(e) => setTradeTime(e.target.value)}
                className="w-full bg-transparent text-xs font-semibold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none dark:[color-scheme:dark]"
                required
              />
            </div>
          </div>

          {/* 9. CLOSED Status Fields: Outcome, Exit Price, Gross P/L, Commission, Swap, Net P/L */}
          {lifecycleStatus === 'CLOSED' && (
            <div className="px-5 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr('Hasil', 'Outcome')}
                </span>
                <div className="inline-flex items-center gap-1 rounded-full bg-[#F5F7FA] dark:bg-[#12161D] p-0.5 border border-[#DDE3EA] dark:border-[#1E232B]">
                  {(['WIN', 'LOSS', 'BREAKEVEN'] as const).map((oc) => (
                    <button
                      key={oc}
                      type="button"
                      onClick={() => handleOutcomeChange(oc)}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors cursor-pointer ${
                        outcome === oc
                          ? 'bg-[#151D2A] text-white dark:bg-[#F2F4F7] dark:text-[#050607]'
                          : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {oc}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#DDE3EA]/70 dark:border-[#1E232B]/60">
                <div>
                  <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                    {tr('Harga Exit', 'Exit Price')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={exitPrice}
                    onChange={(e) => handleExitPriceChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                    {tr('L/R Kotor', 'Gross P/L')} ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={grossProfit}
                    onChange={(e) => handleGrossProfitChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                    {tr('Komisi', 'Commission')} ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={commission}
                    onChange={(e) => handleCommissionChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                    {tr('L/R Bersih', 'Net P/L')} ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={netProfit}
                    onChange={(e) => handleNetProfitChange(e.target.value)}
                    placeholder="0.00"
                    className={`w-full bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9] ${
                      parseFloat(netProfit) > 0
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : parseFloat(netProfit) < 0
                        ? 'text-[#E11D48] dark:text-[#E05260]'
                        : 'text-[#151D2A] dark:text-[#F2F4F7]'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                    Swap ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={swap}
                    onChange={(e) => handleSwapChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#4B525E] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                    {tr('Tipe Penutupan', 'Close Type')}
                  </label>
                  <select
                    value={closeType}
                    onChange={(e) => setCloseType(e.target.value as TradeCloseType)}
                    className="w-full bg-white dark:bg-[#0B0D11] border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none"
                  >
                    <option value="TP">Take Profit (TP)</option>
                    <option value="SL">Stop Loss (SL)</option>
                    <option value="Manual">{tr('Penutupan Manual', 'Manual Close')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-[#697586] dark:text-[#929BA9] mb-0.5">
                  {tr('Kepatuhan Eksekusi', 'Execution Adherence')}
                </label>
                <select
                  value={adherenceTag}
                  onChange={(e) => setAdherenceTag(e.target.value as ExecutionAdherenceTag)}
                  className="w-full bg-white dark:bg-[#0B0D11] border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-[11px] text-[#151D2A] dark:text-[#F2F4F7] focus:outline-none"
                >
                  {EXECUTION_ADHERENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {tr(opt.labelId, opt.labelEn)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* 5 & 6. Screenshot & Trade ID */}
          <div className="px-5 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">Screenshot</span>
              <div className="flex items-center gap-1.5 text-[10px] text-[#697586] dark:text-[#929BA9]">
                <span>ID:</span>
                <span className="tabular-nums font-bold text-[#151D2A] dark:text-[#F2F4F7]">{id}</span>
                <button
                  type="button"
                  onClick={handleRegenerateId}
                  className="text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F4F7] inline-flex items-center cursor-pointer"
                  title={tr('Acak ID Transaksi', 'Regenerate Trade ID')}
                >
                  <RefreshCw className="h-3 w-3 stroke-[1.75]" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F5F7FA] dark:bg-[#12161D] border border-[#DDE3EA] dark:border-[#1E232B] text-[11px] font-semibold text-[#151D2A] dark:text-[#F2F4F7] shrink-0 ${
                  isScanningScreenshot
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:border-[#697586] dark:hover:border-[#929BA9] cursor-pointer'
                }`}
              >
                <Upload className="h-3 w-3 stroke-[2]" />
                <span>{tr('Unggah', 'Upload')}</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={isScanningScreenshot}
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={() => handleScanScreenshotAI()}
                disabled={isScanningScreenshot || !screenshotUrl.trim()}
                aria-busy={isScanningScreenshot}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
                  isScanningScreenshot
                    ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40 cursor-wait'
                    : screenshotUrl.trim()
                    ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-xs'
                    : 'bg-[#F5F7FA] dark:bg-[#12161D] border border-[#DDE3EA] dark:border-[#1E232B] text-[#94A3B8] dark:text-[#606875] opacity-50 cursor-not-allowed'
                }`}
                title={tr(
                  'Ekstrak data posisi (Pair, BUY/SELL, Entry, SL, TP) otomatis dalam 1-2 detik',
                  'Extract position data (Pair, BUY/SELL, Entry, SL, TP) automatically in 1-2 seconds'
                )}
              >
                {isScanningScreenshot ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                    <span>{tr('Memindai...', 'Scanning...')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 text-amber-500" />
                    <span>{tr('Scan Cepat', 'Quick Scan')}</span>
                  </>
                )}
              </button>

              <input
                type="text"
                value={screenshotUrl}
                disabled={isScanningScreenshot}
                onChange={(e) => {
                  setScreenshotUrl(e.target.value);
                  setScanResultFeedback(null);
                }}
                placeholder={tr(
                  'Tempel URL snapshot TradingView / tekan Ctrl+V gambar...',
                  'Paste TradingView snapshot URL / press Ctrl+V image...'
                )}
                className="flex-1 bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] py-1 text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#606875] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9] disabled:opacity-50"
              />
            </div>

            {lifecycleStatus === 'CLOSED' && (
              <div className="pt-1">
                <input
                  type="text"
                  value={afterScreenshotUrl}
                  onChange={(e) => setAfterScreenshotUrl(e.target.value)}
                  placeholder={tr(
                    'URL Screenshot Sesudah-Trade (opsional)...',
                    'After-Trade Screenshot URL (optional)...'
                  )}
                  className="w-full bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] py-1 text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#606875] focus:outline-none focus:border-[#697586] dark:focus:border-[#929BA9]"
                />
              </div>
            )}

            {screenshotUrl && (
              <div className="space-y-2">
                <div className="relative rounded-2xl overflow-hidden border border-[#DDE3EA] dark:border-[#1E232B] h-28 bg-[#F5F7FA] dark:bg-[#12161D] flex items-center justify-center">
                  {isPreviewLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#697586] dark:text-[#929BA9]" />
                  ) : previewDisplayUrl ? (
                    <img
                      src={previewDisplayUrl}
                      alt="Chart Preview"
                      className="w-full h-28 object-cover"
                    />
                  ) : (
                    <span className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                      {tr('Pratinjau tersimpan', 'Saved preview')}
                    </span>
                  )}
                  {isScanningScreenshot && (
                    <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1.5 text-white px-3 text-center">
                      <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                      <span className="text-[11px] font-semibold tracking-tight">
                        {tr('Memindai Entry, SL, TP & Lot...', 'Scanning Entry, SL, TP & Lot...')}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={isScanningScreenshot}
                    onClick={() => {
                      setScreenshotUrl('');
                      setPreviewDisplayUrl('');
                      setScanResultFeedback(null);
                    }}
                    className="absolute top-1.5 right-1.5 rounded-full bg-white/90 dark:bg-[#0B0D11]/90 border border-[#DDE3EA] dark:border-[#1E232B] p-1 text-[#151D2A] dark:text-[#F2F4F7] cursor-pointer hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <X className="h-3 w-3 stroke-[2]" />
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isScanningScreenshot}
                  onClick={() => handleScanScreenshotAI()}
                  className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                    isScanningScreenshot
                      ? 'bg-amber-500/15 border-amber-500/35 text-amber-600 dark:text-amber-300 cursor-wait'
                      : 'bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/25 text-amber-700 dark:text-amber-300 cursor-pointer'
                  }`}
                >
                  {isScanningScreenshot ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
                      <span>{tr('Sedang Memindai Screenshot...', 'Scanning Screenshot...')}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span>
                        {tr(
                          '⚡ Scan Kilat & Isi Otomatis (AI Flash Lite)',
                          '⚡ Instant Scan & Auto-Fill (AI Flash Lite)'
                        )}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {scanResultFeedback && (
              <div
                className={`p-2.5 rounded-xl border text-xs flex items-start justify-between gap-2 ${
                  scanResultFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                    : 'bg-red-500/10 border-red-500/20 text-red-800 dark:text-red-300'
                }`}
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    {scanResultFeedback.type === 'success' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    )}
                    <span>{scanResultFeedback.message}</span>
                  </div>

                  {scanResultFeedback.type === 'error' && (
                    <div className="pl-5 pt-0.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleScanScreenshotAI()}
                        disabled={isScanningScreenshot}
                        className="px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-700 dark:text-red-300 font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <RefreshCw className={`h-3 w-3 ${isScanningScreenshot ? 'animate-spin' : ''}`} />
                        <span>{tr('Coba Scan Lagi', 'Try Scan Again')}</span>
                      </button>
                    </div>
                  )}

                  {scanResultFeedback.details && (
                    <div className="text-[11px] opacity-90 pl-5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {scanResultFeedback.details.source && (
                        <span className={`px-1.5 py-0.2 rounded font-bold text-[10px] ${
                          scanResultFeedback.details.source === 'MT5'
                            ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                            : 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
                        }`}>
                          {scanResultFeedback.details.source === 'MT5' ? 'MetaTrader 5' : 'TradingView'}
                        </span>
                      )}
                      <span>
                        {tr('Instrumen:', 'Instrument:')}{' '}
                        <b>{scanResultFeedback.details.instrument}</b>
                      </span>
                      <span>
                        {tr('Arah:', 'Direction:')} <b>{scanResultFeedback.details.position}</b>
                      </span>
                      {scanResultFeedback.details.lotSize !== null && scanResultFeedback.details.lotSize !== undefined && (
                        <span>Lot: <b>{scanResultFeedback.details.lotSize}</b></span>
                      )}
                      {scanResultFeedback.details.entryPrice !== null && (
                        <span>Entry: <b>{scanResultFeedback.details.entryPrice}</b></span>
                      )}
                      {scanResultFeedback.details.stopLoss !== null && (
                        <span>SL: <b>{scanResultFeedback.details.stopLoss}</b></span>
                      )}
                      {scanResultFeedback.details.takeProfit !== null && (
                        <span>TP: <b>{scanResultFeedback.details.takeProfit}</b></span>
                      )}
                      {scanResultFeedback.details.exitPrice !== null && scanResultFeedback.details.exitPrice !== undefined && (
                        <span>Exit: <b>{scanResultFeedback.details.exitPrice}</b></span>
                      )}
                      {scanResultFeedback.details.profit !== null && scanResultFeedback.details.profit !== undefined && (
                        <span>P/L: <b>{scanResultFeedback.details.profit >= 0 ? '+' : ''}{scanResultFeedback.details.profit}</b></span>
                      )}
                      {scanResultFeedback.details.status && (
                        <span>Status: <b>{scanResultFeedback.details.status}</b></span>
                      )}
                      {scanResultFeedback.details.plannedRiskReward !== null && (
                        <span>R:R: <b>1:{scanResultFeedback.details.plannedRiskReward}</b></span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setScanResultFeedback(null)}
                  className="text-current opacity-60 hover:opacity-100 p-0.5 cursor-pointer shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Panduan Screenshot MetaTrader 5 & TradingView */}
            <div className="text-[11px] text-[#697586] dark:text-[#929BA9] bg-[#F5F7FA] dark:bg-[#12161D] rounded-xl p-2.5 border border-[#DDE3EA] dark:border-[#1E232B] space-y-1.5">
              <div className="font-semibold text-[#151D2A] dark:text-[#F2F4F7] flex items-center gap-1.5">
                <span>💡</span>
                <span>
                  {tr(
                    'Mendukung Screenshot MetaTrader 5 (MT5) & TradingView:',
                    'Supports MetaTrader 5 (MT5) & TradingView Screenshots:'
                  )}
                </span>
              </div>
              <p className="leading-relaxed">
                <b>• MetaTrader 5 (MT5 Mobile / PC):</b>{' '}
                {tr(
                  'Ambil screenshot pada tab Trade (posisi berjalan), tab History (riwayat selesai), atau Chart MT5 dengan garis order. AI otomatis membaca Pair, Buy/Sell, Ukuran Lot, Entry, SL, TP, hingga Profit!',
                  'Take a screenshot on the Trade tab (active positions), History tab (closed trades), or MT5 Chart with order lines. AI automatically reads Pair, Buy/Sell, Lot Size, Entry, SL, TP, and Profit!'
                )}
              </p>
              <p className="leading-relaxed">
                <b>• TradingView / Advance Chart:</b>{' '}
                {tr(
                  'Tekan Win + Shift + S (Windows) atau Cmd + Shift + 4 (Mac), lalu langsung tekan Ctrl + V di sini untuk memindai instan!',
                  'Press Win + Shift + S (Windows) or Cmd + Shift + 4 (Mac), then press Ctrl + V directly here to scan instantly!'
                )}
              </p>
            </div>
          </div>

          {/* 7 & 8. Notes / Reflection & Additional Fields */}
          <div className="px-5 py-2.5 space-y-2">
            <div>
              <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                {tr('Catatan / Refleksi', 'Notes / Reflection')}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={tr(
                  'Catatan analisis teknikal, setup, atau alasan entry...',
                  'Technical analysis notes, setup, or entry reason...'
                )}
                className="w-full bg-transparent text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#606875] focus:outline-none resize-none"
              />
            </div>

            <div className="pt-1.5 border-t border-[#DDE3EA]/70 dark:border-[#1E232B]/60">
              <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                {tr('Alasan Entry (Opsional)', 'Entry Reason (Optional)')}
              </label>
              <input
                type="text"
                value={entryReason}
                onChange={(e) => setEntryReason(e.target.value)}
                placeholder={tr(
                  'Konfirmasi teknikal / konteks pasar...',
                  'Technical confirmation / market context...'
                )}
                className="w-full bg-transparent text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#606875] focus:outline-none"
              />
            </div>

            {lifecycleStatus === 'CLOSED' && (
              <div className="pt-1.5 border-t border-[#DDE3EA]/70 dark:border-[#1E232B]/60">
                <label className="block text-[11px] text-[#697586] dark:text-[#929BA9] mb-1">
                  {tr('Evaluasi Pasca-Trade', 'Post-Trade Evaluation')}
                </label>
                <textarea
                  rows={2}
                  value={postTradeEvaluation}
                  onChange={(e) => setPostTradeEvaluation(e.target.value)}
                  placeholder={tr(
                    'Evaluasi eksekusi, psikologi, dan kedisiplinan...',
                    'Execution, psychology, and discipline evaluation...'
                  )}
                  className="w-full bg-transparent text-xs text-[#151D2A] dark:text-[#F2F4F7] placeholder-[#94A3B8] dark:placeholder-[#606875] focus:outline-none resize-none"
                />
              </div>
            )}
          </div>
        </div>

        {/* Detail View Footer: KEMBALI & SIMPAN */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[#DDE3EA] dark:border-[#1E232B] bg-white dark:bg-[#0B0D11] shrink-0">
          <button
            type="button"
            onClick={() => setIsDetailViewOpen(false)}
            disabled={isSubmitting}
            data-testid="detail-view-back-button"
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-[#F5F7FA] dark:bg-[#151921] hover:bg-[#EEF2F6] dark:hover:bg-[#1C222D] active:scale-[0.98] text-xs font-semibold text-[#151D2A] dark:text-[#F2F4F7] transition-all disabled:opacity-50 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{tr('Kembali', 'Back')}</span>
          </button>
          <button
            type="submit"
            disabled={isSubmitting || isScanningScreenshot}
            aria-busy={isSubmitting || isScanningScreenshot}
            data-testid="detail-view-save-button"
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-[#151D2A] hover:bg-[#1E293B] text-white dark:bg-[#F2F4F7] dark:hover:bg-white active:scale-[0.98] dark:text-[#050607] text-xs font-bold transition-all disabled:opacity-60 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{tr('Menyimpan...', 'Saving...')}</span>
              </>
            ) : isScanningScreenshot ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{tr('Memindai...', 'Scanning...')}</span>
              </>
            ) : (
              <span>{tr('Simpan', 'Save')}</span>
            )}
          </button>
        </div>
      </div>
    </form>
  );

  if (!isPopupModal) {
    return formCardContent;
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] animate-in fade-in duration-150"
      onClick={() => !isSubmitting && onCancel()}
    >
      {formCardContent}
    </div>
  );
};
