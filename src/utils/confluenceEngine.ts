/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  XAUUSD_SEASONALITY,
  computeMonthlySeasonalityStats,
  type MonthlySeasonalityStats,
} from '../data/xauusdSeasonality';

export type TradingConfluenceMode = 'SWING' | 'SCALP';
export type ConfluenceViewMode = 'BASIC' | 'FULL';
export type MacroBiasDirection = 'BUY' | 'SELL' | 'MIXED';
export type AmdPhase =
  | 'ACCUMULATION'
  | 'DOUBLE_ACCUMULATION'
  | 'MANIPULATION'
  | 'POST_SWEEP_CONSOLIDATION'
  | 'EARLY_DISTRIBUTION'
  | 'DISTRIBUTION'
  | 'RE-ACCUMULATION';
export type GatekeeperStatus = 'LOCKED' | 'PREPARE' | 'ACTIVE';
export type TradingSessionName = 'ASIA' | 'LONDON' | 'NEW_YORK';

export type AdaptiveAmdRegime =
  | 'NORMAL_AMD_CYCLE'
  | 'SKIP_MANIPULATION_EARLY_DIST'
  | 'DOUBLE_ACCUMULATION'
  | 'POST_SWEEP_CONSOLIDATION'
  | 'NY_REACCUMULATION';

export type ManualAmdOverrideMode =
  | 'AUTO'
  | 'ACCUMULATION'
  | 'MANIPULATION'
  | 'DISTRIBUTION'
  | 'POST_SWEEP_RANGING';

export type PoiReactionStatus =
  | 'FVG_VALID_REVERSAL'
  | 'TARGET_EXTREME_OB'
  | 'AWAITING_POI_TEST';

export interface ConfluenceCandle {
  time: number; // Unix timestamp (seconds, UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FibTimeHit {
  swingDate: string;
  monthsElapsed: number;
}

export interface AstronacciCycleResult {
  lunarAgeDays: number;
  lunarPhase: 'NEW_MOON_WINDOW' | 'WAXING' | 'FULL_MOON_WINDOW' | 'WANING';
  lunarPhaseLabelId: string;
  nextLunarEvent: 'New Moon' | 'Full Moon';
  daysUntilNextLunarEvent: number;
  illuminationPct: number;
  isSolarCardinalMonth: boolean;
  solarCardinalLabelId: string;
  fibTimeHits: FibTimeHit[];
  isFibTimeCluster: boolean;
  astroScore: number; // 0..100
  summaryId: string;
}

export interface InducementSignal {
  detected: boolean;
  swept: boolean;
  price: number | null;
  type: 'BULLISH_TRAP' | 'BEARISH_TRAP' | null;
  isInternalPullback: boolean; // Pullback < 50% Equilibrium
  noteId: string;
}

export interface PoiZoneLayer {
  low: number;
  high: number;
  midpoint: number;
  hasFvgImbalance?: boolean;
  unmitigatedFutureLiquidity?: boolean;
  labelId: string;
}

export interface PoiHierarchyAnalysis {
  layer1DecisionalFvgOte: PoiZoneLayer; // FVG + Fibo OTE 0.57 - 0.70
  layer2ExtremeOb: PoiZoneLayer;        // Extreme Order Block at origin of impulse
  reactionStatus: PoiReactionStatus;
  activeTargetLayer: 'LAYER_1_FVG_OTE' | 'LAYER_2_EXTREME_OB';
  statusBadgeId: string;
  reactionEvidenceId: string;
}

export interface HealthyOrderBlockAudit {
  detected: boolean;
  direction: 'BULLISH' | 'BEARISH';
  obLow: number;
  obHigh: number;
  fvgLow: number;
  fvgHigh: number;
  hasFvgAfter: boolean;
  notSweptByImpulsiveCandle: boolean;
  isImpulsiveDisplacement: boolean;
  isUnmitigated: boolean;
  isHealthySmcOb: boolean;
  candleTime: number;
  diagnosticNoteId: string;
  diagnosticNoteEn: string;
}

export interface StructuralLockContext {
  protectedSwingPrice: number;
  protectedSwingType: 'HL' | 'LH' | 'RANGE_BOUND';
  opposingTargetPrice: number;
  internalBounceFiltered: boolean;
  internalBounceNoteId: string | null;
}

export interface TimeframeSmcAnalysis {
  timeframe: string;
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  oteLow: number;
  oteHigh: number;
  inOteZone: boolean;
  positionPct: number;
  pdZone: 'PREMIUM' | 'EQUILIBRIUM' | 'DISCOUNT';
  structureSignal: 'BOS_BULL' | 'CHOCH_BULL' | 'BOS_BEAR' | 'CHOCH_BEAR' | 'RANGE';
  structureBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volumeRatio: number;
  hasVolumeSpike: boolean;
  hasRealVolume: boolean;
  inducement: InducementSignal;
  poiHierarchy: PoiHierarchyAnalysis;
  structuralLock: StructuralLockContext;
  healthyOb?: HealthyOrderBlockAudit;
  pdPenaltyApplied: boolean;
  score: number; // 0..100 (higher = more bullish)
  summaryId: string;
}

export interface AmdBox {
  high: number;
  low: number;
  session: TradingSessionName;
  startTime: number;
  endTime: number;
  isCompressed: boolean;
}

export interface AmdStateMachineResult {
  phase: AmdPhase;
  adaptiveRegime: AdaptiveAmdRegime;
  adaptiveRegimeBadgeId: string;
  gatekeeperStatus: GatekeeperStatus;
  transitionModel: 'MODEL_A_JUDAS_REVERSAL' | 'MODEL_B_ONE_WAY' | 'CONSOLIDATING';
  currentSession: TradingSessionName;
  activeBox: AmdBox;
  atr14: number;
  tokyoRangeAtrRatio: number;
  londonRangeAtrRatio: number;
  sessionAnomalyDetected: boolean;
  manipulationWatchSession: TradingSessionName;
  distributionProjectionSession: TradingSessionName;
  nextSessionProjectionId: string;
  nearestBslPrice: number;
  nearestSslPrice: number;
  dampeningFactor: number; // 0.0..0.35 (LOCKED), 0.50..0.65 (PREPARE), 1.0 (ACTIVE)
  headlineId: string;
  detailId: string;
  manualOverrideMode: ManualAmdOverrideMode;
  isManualOverride: boolean;
}

export interface SmcProDeskRead {
  structureContextTitleId: string;
  structureContextBodyId: string;
  structureLockBadgeId: string;
  activePoiTitleId: string;
  activePoiBodyId: string;
  activePoiBadgeId: string;
  nextProjectionTitleId: string;
  nextProjectionBodyId: string;
  nextProjectionBadgeId: string;
  nearestBsl: number;
  nearestSsl: number;
  entryTriggerChecklistId: string;
}

export interface RawMacroConfluenceContext {
  fundamentalBias: MacroBiasDirection;
  fundamentalSpeechHeadline: string;
  fundamentalNoteId?: string;
  intermarketBias?: MacroBiasDirection;
  dxyPrice: number | null;
  dxyChangePct: number | null;
  oilPrice: number | null;
  oilChangePct: number | null;
  us10yPrice: number | null;
  us10yChangePct: number | null;
  us02yPrice: number | null;
  us02yChangePct: number | null;
  intermarketEffectOnGold: 'BULLISH_GOLD' | 'BEARISH_GOLD' | 'NEUTRAL';
  rawMacroBias: MacroBiasDirection;
  combinedRawBias?: MacroBiasDirection;
  rawMacroScore: number;
  rawMacroSummaryId: string;
  rawMacroSummaryEn: string;
  summaryId?: string;
  macroSourceSystem?: 'SYSTEM_1_PRE_NEWS' | 'SYSTEM_2_POST_NEWS' | 'SYSTEM_3_LIVE_PULSE';
  macroSourceLabelId?: string;
  macroSourceLabelEn?: string;
}

export interface TwoStageStructureValidation {
  tradingMode: TradingConfluenceMode;
  structureAnchorTf: 'M15' | '1H';
  structureAnchorTfLabel: 'M15' | '1H';
  narrowTriggerTf: 'M5' | '1H';
  narrowTriggerTfLabel: 'M5' | '1H';
  anchorTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  referenceLhPrice: number;
  referenceHlPrice: number;
  anchorLhBrokenByBody: boolean;
  anchorHlBrokenByBody: boolean;
  candidateHhPrice: number | null;
  candidateLlPrice: number | null;
  stage:
    | 'STAGE_2_CHOCH_BULLISH'
    | 'STAGE_2_CHOCH_BEARISH'
    | 'STAGE_1_MSS_BULLISH'
    | 'STAGE_1_MSS_BEARISH'
    | 'IMPULSIVE_WAIT_CHOCH'
    | 'TREND_CONTINUATION';
  stage2ChochBullConfirmed: boolean;
  stage2ChochBearConfirmed: boolean;
  stage2ChochConfirmed: boolean;
  narrowPullbackHighToBreak: number;
  narrowPullbackLowToBreak: number;
  narrowPullbackBreakPrice: number | null;
  narrowBullishChochValid: boolean;
  narrowBearishChochValid: boolean;
  narrowPullbackChochConfirmed: boolean;
  isImpulsiveDropWithoutChoch: boolean;
  isImpulsiveRallyWithoutChoch: boolean;
  isImpulsiveMomentumWithoutChoch: boolean;
  rawMacroValidatedByChart: boolean;
  statusBadgeId: string;
  statusBadgeEn: string;
  summaryId: string;
  summaryEn: string;
  detailNarrativeId: string;
  detailNarrativeEn: string;
}

export interface ConfluenceMasterResult {
  viewMode: ConfluenceViewMode;
  tradingMode: TradingConfluenceMode;
  uptrendPct: number;
  downtrendPct: number;
  dominantDirection: 'BULLISH' | 'BEARISH' | 'NETRAL';
  rawScoreBeforeGatekeeper: number;
  seasonality: MonthlySeasonalityStats;
  astronacci: AstronacciCycleResult;
  smcByTimeframe: Record<string, TimeframeSmcAnalysis>;
  htfAnalysis: TimeframeSmcAnalysis | null;
  mtfAnalysis: TimeframeSmcAnalysis | null;
  ltfAnalysis: TimeframeSmcAnalysis | null;
  smcCompositeScore: number;
  macroNewsScore: number;
  amdState: AmdStateMachineResult | null;
  proDeskRead: SmcProDeskRead;
  rawMacroContext: RawMacroConfluenceContext;
  twoStageValidation: TwoStageStructureValidation;
  weightsBreakdown: {
    labelId: string;
    pct: number;
    score: number;
  }[];
  guidanceId: string;
}

const REF_NEW_MOON_UTC_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
const SYNODIC_MONTH_DAYS = 29.53058867;
const FIB_TIME_SEQUENCE = [1, 2, 3, 5, 8, 13, 21, 34];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface SessionWindowWib {
  startHour: number; // 0..23 WIB (UTC+7)
  endHour: number;   // 0..23 WIB (UTC+7)
}

export interface SessionHoursWibConfig {
  ASIA: SessionWindowWib;
  LONDON: SessionWindowWib;
  NEW_YORK: SessionWindowWib;
}

export const SESSION_HOURS_WIB_STORAGE_KEY = 'tradevault_cycle_session_wib_v1';
export const SESSION_HOURS_WIB_CHANGE_EVENT = 'tradevault:session-hours-wib-change';
export const MANUAL_AMD_OVERRIDE_STORAGE_KEY = 'tradevault_manual_amd_override_v1';
export const MANUAL_AMD_OVERRIDE_CHANGE_EVENT = 'tradevault:manual-amd-override-change';

export const MANUAL_AMD_OVERRIDE_OPTIONS: Array<{
  id: ManualAmdOverrideMode;
  labelId: string;
  labelEn: string;
}> = [
  { id: 'AUTO', labelId: 'Auto (Engine)', labelEn: 'Auto (Engine)' },
  { id: 'ACCUMULATION', labelId: 'Akumulasi', labelEn: 'Accumulation' },
  { id: 'MANIPULATION', labelId: 'Manipulasi', labelEn: 'Manipulation' },
  { id: 'DISTRIBUTION', labelId: 'Distribusi', labelEn: 'Distribution' },
  { id: 'POST_SWEEP_RANGING', labelId: 'Ranging Pasca-Sweep', labelEn: 'Post-Sweep Ranging' },
];

export function isValidManualAmdOverride(val: unknown): val is ManualAmdOverrideMode {
  return (
    val === 'AUTO' ||
    val === 'ACCUMULATION' ||
    val === 'MANIPULATION' ||
    val === 'DISTRIBUTION' ||
    val === 'POST_SWEEP_RANGING'
  );
}

export function loadStoredManualAmdOverride(): ManualAmdOverrideMode {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return 'AUTO';
  }
  try {
    const raw = window.localStorage.getItem(MANUAL_AMD_OVERRIDE_STORAGE_KEY)?.trim();
    return isValidManualAmdOverride(raw) ? raw : 'AUTO';
  } catch {
    return 'AUTO';
  }
}

export function saveStoredManualAmdOverride(mode: ManualAmdOverrideMode): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  const safeMode: ManualAmdOverrideMode = isValidManualAmdOverride(mode) ? mode : 'AUTO';
  try {
    window.localStorage.setItem(MANUAL_AMD_OVERRIDE_STORAGE_KEY, safeMode);
    window.dispatchEvent(
      new CustomEvent<ManualAmdOverrideMode>(MANUAL_AMD_OVERRIDE_CHANGE_EVENT, {
        detail: safeMode,
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export const TRADING_CONFLUENCE_MODE_STORAGE_KEY = 'tradevault_trading_confluence_mode_v1';
export const TRADING_CONFLUENCE_MODE_CHANGE_EVENT = 'tradevault:trading-confluence-mode-change';

export function loadStoredTradingConfluenceMode(
  fallback: TradingConfluenceMode = 'SCALP'
): TradingConfluenceMode {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(TRADING_CONFLUENCE_MODE_STORAGE_KEY)?.trim();
    if (raw === 'SCALP' || raw === 'SWING') {
      return raw;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveStoredTradingConfluenceMode(mode: TradingConfluenceMode): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  const safeMode: TradingConfluenceMode = mode === 'SWING' ? 'SWING' : 'SCALP';
  try {
    window.localStorage.setItem(TRADING_CONFLUENCE_MODE_STORAGE_KEY, safeMode);
    window.dispatchEvent(
      new CustomEvent<TradingConfluenceMode>(TRADING_CONFLUENCE_MODE_CHANGE_EVENT, {
        detail: safeMode,
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export const DEFAULT_SESSION_HOURS_WIB: SessionHoursWibConfig = {
  ASIA: { startHour: 4, endHour: 13 },      // 21:00 - 06:00 UTC = 04:00 - 13:00 WIB (Tokyo / Asia)
  LONDON: { startHour: 13, endHour: 18 },   // 06:00 - 11:00 UTC = 13:00 - 18:00 WIB (London)
  NEW_YORK: { startHour: 18, endHour: 4 },  // 11:00 - 21:00 UTC = 18:00 - 04:00 WIB (New York)
};

function sanitizeWibHour(val: unknown, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return ((Math.floor(num) % 24) + 24) % 24;
}

export function normalizeSessionHoursWibConfig(
  raw?: Partial<SessionHoursWibConfig> | null
): SessionHoursWibConfig {
  return {
    ASIA: {
      startHour: sanitizeWibHour(raw?.ASIA?.startHour, DEFAULT_SESSION_HOURS_WIB.ASIA.startHour),
      endHour: sanitizeWibHour(raw?.ASIA?.endHour, DEFAULT_SESSION_HOURS_WIB.ASIA.endHour),
    },
    LONDON: {
      startHour: sanitizeWibHour(raw?.LONDON?.startHour, DEFAULT_SESSION_HOURS_WIB.LONDON.startHour),
      endHour: sanitizeWibHour(raw?.LONDON?.endHour, DEFAULT_SESSION_HOURS_WIB.LONDON.endHour),
    },
    NEW_YORK: {
      startHour: sanitizeWibHour(raw?.NEW_YORK?.startHour, DEFAULT_SESSION_HOURS_WIB.NEW_YORK.startHour),
      endHour: sanitizeWibHour(raw?.NEW_YORK?.endHour, DEFAULT_SESSION_HOURS_WIB.NEW_YORK.endHour),
    },
  };
}

export function loadStoredSessionHoursWib(): SessionHoursWibConfig {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return DEFAULT_SESSION_HOURS_WIB;
  }
  try {
    const raw = window.localStorage.getItem(SESSION_HOURS_WIB_STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION_HOURS_WIB;
    return normalizeSessionHoursWibConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_SESSION_HOURS_WIB;
  }
}

export function saveStoredSessionHoursWib(config: SessionHoursWibConfig): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    const normalized = normalizeSessionHoursWibConfig(config);
    window.localStorage.setItem(SESSION_HOURS_WIB_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(
      new CustomEvent<SessionHoursWibConfig>(SESSION_HOURS_WIB_CHANGE_EVENT, {
        detail: normalized,
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function formatWibHour(hour: number): string {
  const h = sanitizeWibHour(hour, 0);
  return `${String(h).padStart(2, '0')}:00`;
}

export function formatSessionWindowWib(
  session: TradingSessionName,
  config: SessionHoursWibConfig = DEFAULT_SESSION_HOURS_WIB
): string {
  const win = config[session] || DEFAULT_SESSION_HOURS_WIB[session];
  return `${formatWibHour(win.startHour)}–${formatWibHour(win.endHour)} WIB`;
}

function isHourInWibWindow(wibHour: number, win: SessionWindowWib): boolean {
  const start = sanitizeWibHour(win.startHour, 0);
  const end = sanitizeWibHour(win.endHour, 0);
  if (start === end) return false;
  if (start < end) {
    return wibHour >= start && wibHour < end;
  }
  return wibHour >= start || wibHour < end;
}

export function getSessionWIB(
  unixSec: number,
  config: SessionHoursWibConfig = DEFAULT_SESSION_HOURS_WIB
): TradingSessionName {
  const utcHour = new Date(unixSec * 1000).getUTCHours();
  const wibHour = (utcHour + 7) % 24;
  if (isHourInWibWindow(wibHour, config.ASIA)) return 'ASIA';
  if (isHourInWibWindow(wibHour, config.LONDON)) return 'LONDON';
  if (isHourInWibWindow(wibHour, config.NEW_YORK)) return 'NEW_YORK';

  if (isHourInWibWindow(wibHour, DEFAULT_SESSION_HOURS_WIB.ASIA)) return 'ASIA';
  if (isHourInWibWindow(wibHour, DEFAULT_SESSION_HOURS_WIB.LONDON)) return 'LONDON';
  return 'NEW_YORK';
}

export function getTradingSessionUtc(
  unixSec: number,
  config: SessionHoursWibConfig = DEFAULT_SESSION_HOURS_WIB
): TradingSessionName {
  return getSessionWIB(unixSec, config);
}

export function getSessionLabelId(session: TradingSessionName): string {
  switch (session) {
    case 'ASIA':
      return 'Tokyo (Asia)';
    case 'LONDON':
      return 'London';
    case 'NEW_YORK':
      return 'New York';
  }
}

/**
 * 1. Astronacci Cycle Calculator
 */
export function calculateAstronacciCycle(
  referenceDate: Date = new Date(),
  majorSwingDates: string[] = XAUUSD_SEASONALITY.majorSwingDates
): AstronacciCycleResult {
  const ms = referenceDate.getTime();
  const daysSinceRef = (ms - REF_NEW_MOON_UTC_MS) / 86_400_000;
  const lunarAgeDays =
    ((daysSinceRef % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;

  const fullMoonDay = SYNODIC_MONTH_DAYS / 2;
  const windowHalfWidth = 1.5;

  let lunarPhase: AstronacciCycleResult['lunarPhase'] = 'WAXING';
  let lunarPhaseLabelId = 'Fase Waxing (Ekspansi Awal)';

  if (lunarAgeDays <= windowHalfWidth || lunarAgeDays >= SYNODIC_MONTH_DAYS - windowHalfWidth) {
    lunarPhase = 'NEW_MOON_WINDOW';
    lunarPhaseLabelId = 'New Moon Window (Siklus Titik Balik)';
  } else if (Math.abs(lunarAgeDays - fullMoonDay) <= windowHalfWidth) {
    lunarPhase = 'FULL_MOON_WINDOW';
    lunarPhaseLabelId = 'Full Moon Window (Puncak Volatilitas)';
  } else if (lunarAgeDays < fullMoonDay - windowHalfWidth) {
    lunarPhase = 'WAXING';
    lunarPhaseLabelId = 'Fase Waxing (Menuju Full Moon)';
  } else {
    lunarPhase = 'WANING';
    lunarPhaseLabelId = 'Fase Waning (Menuju New Moon)';
  }

  const daysToNewMoon =
    lunarAgeDays === 0 ? SYNODIC_MONTH_DAYS : SYNODIC_MONTH_DAYS - lunarAgeDays;
  const daysToFullMoon =
    lunarAgeDays <= fullMoonDay
      ? fullMoonDay - lunarAgeDays
      : SYNODIC_MONTH_DAYS - lunarAgeDays + fullMoonDay;

  const nextLunarEvent: 'New Moon' | 'Full Moon' =
    daysToNewMoon <= daysToFullMoon ? 'New Moon' : 'Full Moon';
  const daysUntilNextLunarEvent = Number(
    Math.min(daysToNewMoon, daysToFullMoon).toFixed(1)
  );
  const illuminationPct = Math.round(
    ((1 - Math.cos((2 * Math.PI * lunarAgeDays) / SYNODIC_MONTH_DAYS)) / 2) * 100
  );

  const monthIdx = referenceDate.getUTCMonth();
  const year = referenceDate.getUTCFullYear();
  const isSolarCardinalMonth =
    monthIdx === 2 || monthIdx === 5 || monthIdx === 8 || monthIdx === 11;
  const solarCardinalLabelId = isSolarCardinalMonth
    ? 'Jendela Volatilitas Tinggi (Solar Cardinal)'
    : 'Fase Solar Normal (Non-Kardinal)';

  const fibTimeHits: FibTimeHit[] = [];
  for (const dateStr of majorSwingDates) {
    const parts = dateStr.split('-').map(Number);
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      const swingYear = parts[0];
      const swingMonthIdx = parts[1] - 1;
      const diffMonths = (year - swingYear) * 12 + (monthIdx - swingMonthIdx);
      if (diffMonths > 0 && FIB_TIME_SEQUENCE.includes(diffMonths)) {
        fibTimeHits.push({ swingDate: dateStr, monthsElapsed: diffMonths });
      }
    }
  }
  const isFibTimeCluster = fibTimeHits.length >= 2;

  let astroScore = 50;
  if (lunarPhase === 'NEW_MOON_WINDOW') {
    astroScore += 10;
  } else if (lunarPhase === 'WAXING') {
    astroScore += 6;
  } else if (lunarPhase === 'FULL_MOON_WINDOW') {
    astroScore -= 4;
  } else if (lunarPhase === 'WANING') {
    astroScore -= 6;
  }

  if (isFibTimeCluster) {
    astroScore = 50 + (astroScore - 50) * 0.7;
  }

  const clampedScore = Number(clamp(astroScore, 20, 80).toFixed(1));
  const fibText =
    fibTimeHits.length > 0
      ? `Fib Time ${fibTimeHits.map((h) => `F${h.monthsElapsed} (${h.swingDate.slice(0, 7)})`).join(', ')}`
      : 'Tidak ada pertemuan Fib Time bulan ini';

  const summaryId = `${lunarPhaseLabelId} · ${nextLunarEvent} dlm ${daysUntilNextLunarEvent}h · ${
    isFibTimeCluster ? 'Cluster Fib Time Aktif' : fibText
  }.`;

  return {
    lunarAgeDays: Number(lunarAgeDays.toFixed(1)),
    lunarPhase,
    lunarPhaseLabelId,
    nextLunarEvent,
    daysUntilNextLunarEvent,
    illuminationPct,
    isSolarCardinalMonth,
    solarCardinalLabelId,
    fibTimeHits,
    isFibTimeCluster,
    astroScore: clampedScore,
    summaryId,
  };
}

/**
 * Computes effective activity series: uses exact tick/exchange volume when present,
 * or falls back cleanly to candle range (high - low) for spot XAU/USD feeds with volume === 0.
 */
function resolveEffectiveVolumes(candles: ConfluenceCandle[]): {
  volumes: number[];
  hasRealVolume: boolean;
} {
  const safeVolumes = candles.map((c) =>
    Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0
  );
  const hasRealVolume = safeVolumes.some((v) => v > 0);
  if (hasRealVolume) {
    return {
      volumes: safeVolumes,
      hasRealVolume: true,
    };
  }
  const rangeProxy = candles.map((c) => Math.max(0.01, c.high - c.low));
  return { volumes: rangeProxy, hasRealVolume: false };
}

function computeSma(values: number[], period: number, endExclusive?: number): number {
  const end = endExclusive ?? values.length;
  const start = Math.max(0, end - period);
  const slice = values.slice(start, end);
  if (slice.length === 0) return 1;
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / slice.length || 1;
}

export function computeAtr14(candles: ConfluenceCandle[]): number {
  if (candles.length < 2) {
    return candles[0] ? Math.max(0.5, candles[0].high - candles[0].low) : 5;
  }
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }
  const recent = trs.slice(-14);
  const avg = recent.reduce((acc, v) => acc + v, 0) / Math.max(1, recent.length);
  return Number(Math.max(0.5, avg).toFixed(2));
}

export interface HtfStructuralConstraint {
  htfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  protectedLevel: number; // 1H/HTF Structural HL (for Bullish) or LH (for Bearish)
  rangeLow: number;
  rangeHigh: number;
}

/**
 * Audits a 3-candle Institutional SMC Order Block sequence (C[i] -> C[i+1] -> C[i+2]):
 * 1. Mandatory FVG After OB (hasFvgAfter):
 *    - Bullish: C[i+2].low > C[i].high
 *    - Bearish: C[i+2].high < C[i].low
 * 2. OB Candle NOT Liquidity-Swept by the Subsequent Impulsive Candle (notSweptByImpulsiveCandle):
 *    - Bullish: C[i+1].low >= C[i].low (impulsive candle did not sweep below the OB candle's low)
 *    - Bearish: C[i+1].high <= C[i].high (impulsive candle did not sweep above the OB candle's high)
 * 3. Impulsive Displacement on C[i+1] (isImpulsiveDisplacement):
 *    - Strong body expansion relative to ATR / candle range
 * 4. Unmitigated Status (isUnmitigated):
 *    - Subsequent candles after C[i+2] have not swept through the OB's protected extreme
 */
export function scanDirectionalHealthyOrderBlock(
  candles: ConfluenceCandle[],
  direction: 'BULLISH' | 'BEARISH',
  rangeLow: number,
  rangeHigh: number,
  atr14: number
): HealthyOrderBlockAudit {
  const fallbackPrice = candles?.[candles.length - 1]?.close ?? 0;
  if (!Array.isArray(candles) || candles.length < 6) {
    return {
      detected: false,
      direction,
      obLow: fallbackPrice,
      obHigh: fallbackPrice,
      fvgLow: fallbackPrice,
      fvgHigh: fallbackPrice,
      hasFvgAfter: false,
      notSweptByImpulsiveCandle: false,
      isImpulsiveDisplacement: false,
      isUnmitigated: false,
      isHealthySmcOb: false,
      candleTime: candles?.[candles.length - 1]?.time ?? 0,
      diagnosticNoteId: 'Data candle belum cukup untuk memvalidasi anatomi Order Block.',
      diagnosticNoteEn: 'Insufficient candle data to validate Order Block anatomy.',
    };
  }

  const safeAtr = Math.max(0.5, atr14);
  const span = Math.max(0.5, rangeHigh - rangeLow);
  const startIdx = Math.max(1, candles.length - 150);
  const endIdx = candles.length - 3; // Need C[i], C[i+1], C[i+2]

  let bestCandidate: (HealthyOrderBlockAudit & { qualityRank: number }) | null = null;

  for (let i = startIdx; i <= endIdx; i++) {
    const cOb = candles[i];
    const cImp = candles[i + 1];
    const cFvg = candles[i + 2];

    const impRange = Math.max(0.01, cImp.high - cImp.low);
    const impBody = Math.abs(cImp.close - cImp.open);
    const bodyRatio = impBody / impRange;

    if (direction === 'BULLISH') {
      const isBullishImpulse = cImp.close > cImp.open && cImp.close > cOb.high;
      if (!isBullishImpulse) continue;

      const notSweptByImpulsiveCandle = cImp.low >= cOb.low;
      const hasFvgAfter = cFvg.low > cOb.high;
      const isImpulsiveDisplacement = impBody >= safeAtr * 0.40 || bodyRatio >= 0.55;

      // Check if subsequent candles after C[i+2] (excluding the latest live retest bar) swept below cOb.low
      const laterBars = candles.slice(i + 3, Math.max(i + 3, candles.length - 1));
      const isUnmitigated = laterBars.every((b) => b.low >= cOb.low);

      const obLow = Number(cOb.low.toFixed(2));
      const obHigh = Number(Math.max(cOb.open, cOb.close, cOb.low + Math.min(cOb.high - cOb.low, safeAtr * 0.85)).toFixed(2));
      const fvgLow = Number(cOb.high.toFixed(2));
      const fvgHigh = Number(Math.max(cOb.high, cFvg.low).toFixed(2));

      const isInDiscountOrEq = obLow <= rangeLow + span * 0.62;
      const isHealthySmcOb =
        hasFvgAfter && notSweptByImpulsiveCandle && isImpulsiveDisplacement && isUnmitigated;

      let qualityRank = 0;
      if (isHealthySmcOb) qualityRank += 100;
      if (hasFvgAfter) qualityRank += 35;
      if (notSweptByImpulsiveCandle) qualityRank += 30;
      if (isUnmitigated) qualityRank += 20;
      if (isImpulsiveDisplacement) qualityRank += 10;
      if (isInDiscountOrEq) qualityRank += 16;
      // Mild tie-breaker without overriding deeper structural OBs
      qualityRank += (i - startIdx) * 0.05;

      let diagnosticNoteId = '';
      let diagnosticNoteEn = '';
      if (isHealthySmcOb) {
        diagnosticNoteId = `Bullish OB Sehat ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Memiliki FVG ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)}) & tidak ter-sweep oleh candle impulsif setelahnya.`;
        diagnosticNoteEn = `Healthy Bullish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Followed by FVG ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)}) & not swept by the impulsive candle.`;
      } else if (!notSweptByImpulsiveCandle) {
        diagnosticNoteId = `Bullish OB Tidak Murni ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Ekor OB sudah ter-liquidity sweep oleh candle impulsif setelahnya ($${cImp.low.toFixed(2)} < $${cOb.low.toFixed(2)}).`;
        diagnosticNoteEn = `Impure Bullish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): OB low was liquidity-swept by the subsequent impulsive candle ($${cImp.low.toFixed(2)} < $${cOb.low.toFixed(2)}).`;
      } else if (!hasFvgAfter) {
        diagnosticNoteId = `Bullish OB Lemah ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Tidak meninggalkan FVG setelahnya (C3 langsung menutup celah ke $${cFvg.low.toFixed(2)}).`;
        diagnosticNoteEn = `Weak Bullish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): No FVG left after the OB (C3 closed the gap to $${cFvg.low.toFixed(2)}).`;
      } else if (!isUnmitigated) {
        diagnosticNoteId = `Bullish OB Sudah Terpakai ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Zona OB telah tersapu/termitigasi oleh candle berikutnya.`;
        diagnosticNoteEn = `Mitigated Bullish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): OB zone was already swept by later candles.`;
      } else {
        diagnosticNoteId = `Bullish OB Standar ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Dorongan candle impulsif kurang dominan.`;
        diagnosticNoteEn = `Standard Bullish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Moderate displacement body.`;
      }

      if (!bestCandidate || qualityRank >= bestCandidate.qualityRank) {
        bestCandidate = {
          detected: true,
          direction: 'BULLISH',
          obLow,
          obHigh,
          fvgLow,
          fvgHigh,
          hasFvgAfter,
          notSweptByImpulsiveCandle,
          isImpulsiveDisplacement,
          isUnmitigated,
          isHealthySmcOb,
          candleTime: cOb.time,
          diagnosticNoteId,
          diagnosticNoteEn,
          qualityRank,
        };
      }
    } else {
      const isBearishImpulse = cImp.close < cImp.open && cImp.close < cOb.low;
      if (!isBearishImpulse) continue;

      const notSweptByImpulsiveCandle = cImp.high <= cOb.high;
      const hasFvgAfter = cFvg.high < cOb.low;
      const isImpulsiveDisplacement = impBody >= safeAtr * 0.40 || bodyRatio >= 0.55;

      const laterBars = candles.slice(i + 3, Math.max(i + 3, candles.length - 1));
      const isUnmitigated = laterBars.every((b) => b.high <= cOb.high);

      const obHigh = Number(cOb.high.toFixed(2));
      const obLow = Number(Math.min(cOb.open, cOb.close, cOb.high - Math.min(cOb.high - cOb.low, safeAtr * 0.85)).toFixed(2));
      const fvgLow = Number(Math.min(cOb.low, cFvg.high).toFixed(2));
      const fvgHigh = Number(cOb.low.toFixed(2));

      const isInPremiumOrEq = obHigh >= rangeLow + span * 0.38;
      const isHealthySmcOb =
        hasFvgAfter && notSweptByImpulsiveCandle && isImpulsiveDisplacement && isUnmitigated;

      let qualityRank = 0;
      if (isHealthySmcOb) qualityRank += 100;
      if (hasFvgAfter) qualityRank += 35;
      if (notSweptByImpulsiveCandle) qualityRank += 30;
      if (isUnmitigated) qualityRank += 20;
      if (isImpulsiveDisplacement) qualityRank += 10;
      if (isInPremiumOrEq) qualityRank += 16;
      qualityRank += (i - startIdx) * 0.05;

      let diagnosticNoteId = '';
      let diagnosticNoteEn = '';
      if (isHealthySmcOb) {
        diagnosticNoteId = `Bearish OB Sehat ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Memiliki FVG ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)}) & tidak ter-sweep oleh candle impulsif setelahnya.`;
        diagnosticNoteEn = `Healthy Bearish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Followed by FVG ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)}) & not swept by the impulsive candle.`;
      } else if (!notSweptByImpulsiveCandle) {
        diagnosticNoteId = `Bearish OB Tidak Murni ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Ekor OB sudah ter-liquidity sweep oleh candle impulsif setelahnya ($${cImp.high.toFixed(2)} > $${cOb.high.toFixed(2)}).`;
        diagnosticNoteEn = `Impure Bearish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): OB high was liquidity-swept by the subsequent impulsive candle ($${cImp.high.toFixed(2)} > $${cOb.high.toFixed(2)}).`;
      } else if (!hasFvgAfter) {
        diagnosticNoteId = `Bearish OB Lemah ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Tidak meninggalkan FVG setelahnya (C3 langsung menutup celah ke $${cFvg.high.toFixed(2)}).`;
        diagnosticNoteEn = `Weak Bearish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): No FVG left after the OB (C3 closed the gap to $${cFvg.high.toFixed(2)}).`;
      } else if (!isUnmitigated) {
        diagnosticNoteId = `Bearish OB Sudah Terpakai ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Zona OB telah tersapu/termitigasi oleh candle berikutnya.`;
        diagnosticNoteEn = `Mitigated Bearish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): OB zone was already swept by later candles.`;
      } else {
        diagnosticNoteId = `Bearish OB Standar ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Dorongan candle impulsif kurang dominan.`;
        diagnosticNoteEn = `Standard Bearish OB ($${obLow.toFixed(2)}–$${obHigh.toFixed(2)}): Moderate displacement body.`;
      }

      if (!bestCandidate || qualityRank >= bestCandidate.qualityRank) {
        bestCandidate = {
          detected: true,
          direction: 'BEARISH',
          obLow,
          obHigh,
          fvgLow,
          fvgHigh,
          hasFvgAfter,
          notSweptByImpulsiveCandle,
          isImpulsiveDisplacement,
          isUnmitigated,
          isHealthySmcOb,
          candleTime: cOb.time,
          diagnosticNoteId,
          diagnosticNoteEn,
          qualityRank,
        };
      }
    }
  }

  if (bestCandidate) {
    const { qualityRank: _unusedRank, ...audit } = bestCandidate;
    return audit;
  }

  const defaultObLow =
    direction === 'BULLISH'
      ? Number(rangeLow.toFixed(2))
      : Number((rangeHigh - Math.min(span * 0.18, safeAtr * 0.8)).toFixed(2));
  const defaultObHigh =
    direction === 'BULLISH'
      ? Number((rangeLow + Math.min(span * 0.18, safeAtr * 0.8)).toFixed(2))
      : Number(rangeHigh.toFixed(2));

  return {
    detected: false,
    direction,
    obLow: defaultObLow,
    obHigh: defaultObHigh,
    fvgLow: defaultObLow,
    fvgHigh: defaultObHigh,
    hasFvgAfter: false,
    notSweptByImpulsiveCandle: false,
    isImpulsiveDisplacement: false,
    isUnmitigated: false,
    isHealthySmcOb: false,
    candleTime: candles[candles.length - 1]?.time ?? 0,
    diagnosticNoteId: `Belum ditemukan ${direction === 'BULLISH' ? 'Bullish' : 'Bearish'} OB yang memenuhi syarat FVG + Anti-Sweep Impulsif pada rentang ini.`,
    diagnosticNoteEn: `No ${direction === 'BULLISH' ? 'Bullish' : 'Bearish'} OB with valid FVG + Anti-Impulsive-Sweep found in this range yet.`,
  };
}

/**
 * 2. Contextual Institutional SMC Analyzer per Timeframe
 * Implements:
 * - Dynamic POI Hierarchy: Layer 1 (Decisional FVG + Fibo OTE 0.57–0.70) vs Layer 2 (Extreme OB)
 * - Price Reaction Evaluation at POI Layer 1 (Wick Rejection / Vol Absorption / LTF MSS vs Full-Body Displacement)
 * - Strict Structural Swing (LH/HL) vs Internal Inducement (<50% Equilibrium) & Anti-Fake-BOS filter on M15/M5
 * - Healthy OB Anatomy Audit (Mandatory FVG after OB + OB not swept by subsequent impulsive candle)
 */
export function analyzeTimeframeSmc(
  candles: ConfluenceCandle[],
  timeframe: string,
  htfConstraint?: HtfStructuralConstraint
): TimeframeSmcAnalysis {
  if (!Array.isArray(candles) || candles.length < 10) {
    const last = candles?.[candles.length - 1];
    const price = last?.close ?? 0;
    return {
      timeframe,
      swingHigh: price,
      swingLow: price,
      equilibrium: price,
      oteLow: price,
      oteHigh: price,
      inOteZone: false,
      positionPct: 50,
      pdZone: 'EQUILIBRIUM',
      structureSignal: 'RANGE',
      structureBias: 'NEUTRAL',
      volumeRatio: 1,
      hasVolumeSpike: false,
      hasRealVolume: false,
      inducement: {
        detected: false,
        swept: false,
        price: null,
        type: null,
        isInternalPullback: false,
        noteId: 'Data candle belum mencukupi untuk pemetaan struktur.',
      },
      poiHierarchy: {
        layer1DecisionalFvgOte: {
          low: price,
          high: price,
          midpoint: price,
          hasFvgImbalance: false,
          labelId: 'POI Lapis 1 (FVG/OTE 0.57–0.70)',
        },
        layer2ExtremeOb: {
          low: price,
          high: price,
          midpoint: price,
          unmitigatedFutureLiquidity: false,
          labelId: 'POI Lapis 2 (Extreme OB)',
        },
        reactionStatus: 'AWAITING_POI_TEST',
        activeTargetLayer: 'LAYER_1_FVG_OTE',
        statusBadgeId: 'MENUNGGU DATA CANDLE',
        reactionEvidenceId: 'Menunggu candle cukup untuk evaluasi POI.',
      },
      structuralLock: {
        protectedSwingPrice: price,
        protectedSwingType: 'RANGE_BOUND',
        opposingTargetPrice: price,
        internalBounceFiltered: false,
        internalBounceNoteId: null,
      },
      pdPenaltyApplied: false,
      score: 50,
      summaryId: `Struktur ${timeframe} menunggu candle cukup.`,
    };
  }

  const atr14 = computeAtr14(candles);
  const { volumes, hasRealVolume } = resolveEffectiveVolumes(candles);
  const smaVol20 = computeSma(volumes, 20);
  const activityBaseline = hasRealVolume ? smaVol20 : atr14;
  const lastCandle = candles[candles.length - 1];
  const lastVol = volumes[volumes.length - 1] || 0;
  const recentMaxVol = Math.max(...volumes.slice(-3));
  const volumeRatio = Number((lastVol / Math.max(0.0001, activityBaseline)).toFixed(2));
  const hasVolumeSpike = recentMaxVol > activityBaseline * 1.35;

  // Detect fractal swing highs and swing lows (2-bar left/right confirmation)
  const swingHighs: Array<{ index: number; price: number; vol: number }> = [];
  const swingLows: Array<{ index: number; price: number; vol: number }> = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    if (
      h >= candles[i - 1].high &&
      h >= candles[i - 2].high &&
      h >= candles[i + 1].high &&
      h >= candles[i + 2].high
    ) {
      swingHighs.push({ index: i, price: h, vol: volumes[i] });
    }
    if (
      l <= candles[i - 1].low &&
      l <= candles[i - 2].low &&
      l <= candles[i + 1].low &&
      l <= candles[i + 2].low
    ) {
      swingLows.push({ index: i, price: l, vol: volumes[i] });
    }
  }

  const recentSlice = candles.slice(-45);
  const fallbackHigh = Math.max(...recentSlice.map((c) => c.high));
  const fallbackLow = Math.min(...recentSlice.map((c) => c.low));

  const latestSh = swingHighs[swingHighs.length - 1];
  const prevSh = swingHighs[swingHighs.length - 2];
  const latestSl = swingLows[swingLows.length - 1];
  const prevSl = swingLows[swingLows.length - 2];

  // Structural Range Bounds (Major Swing High & Swing Low)
  const majorHigh = Math.max(latestSh?.price ?? fallbackHigh, prevSh?.price ?? fallbackHigh, fallbackHigh);
  const majorLow = Math.min(latestSl?.price ?? fallbackLow, prevSl?.price ?? fallbackLow, fallbackLow);
  const swingHigh = Number((latestSh?.price ?? majorHigh).toFixed(2));
  const swingLow = Number((latestSl?.price ?? majorLow).toFixed(2));

  const rangeHigh = Math.max(swingHigh, swingLow + 0.5);
  const rangeLow = Math.min(swingLow, rangeHigh - 0.5);
  const span = Math.max(0.5, rangeHigh - rangeLow);

  const equilibrium = Number(((rangeHigh + rangeLow) / 2).toFixed(2));
  const currentPrice = lastCandle.close;
  const rawPosPct = ((currentPrice - rangeLow) / span) * 100;
  const positionPct = Number(clamp(rawPosPct, 0, 100).toFixed(1));
  const pdZone: TimeframeSmcAnalysis['pdZone'] =
    positionPct > 52 ? 'PREMIUM' : positionPct < 48 ? 'DISCOUNT' : 'EQUILIBRIUM';

  // Determine raw BOS / CHoCH structure
  const priorSwingHighVal = latestSh ? latestSh.price : fallbackHigh;
  const priorSwingLowVal = latestSl ? latestSl.price : fallbackLow;
  const wasBearishSwing =
    Boolean(prevSh && latestSh && latestSh.price < prevSh.price) &&
    Boolean(prevSl && latestSl && latestSl.price < prevSl.price);
  const wasBullishSwing =
    Boolean(prevSh && latestSh && latestSh.price > prevSh.price) &&
    Boolean(prevSl && latestSl && latestSl.price > prevSl.price);

  const recentCloses = candles.slice(-4).map((c) => c.close);
  const brokeUp =
    recentCloses.some((c) => c > priorSwingHighVal) ||
    (latestSh && prevSh && latestSh.price > prevSh.price && currentPrice > equilibrium);
  const brokeDown =
    recentCloses.some((c) => c < priorSwingLowVal) ||
    (latestSl && prevSl && latestSl.price < prevSl.price && currentPrice < equilibrium);

  let structureSignal: TimeframeSmcAnalysis['structureSignal'] = 'RANGE';
  let structureBias: TimeframeSmcAnalysis['structureBias'] = 'NEUTRAL';

  if (brokeUp && !brokeDown) {
    structureSignal = wasBearishSwing ? 'CHOCH_BULL' : 'BOS_BULL';
    structureBias = 'BULLISH';
  } else if (brokeDown && !brokeUp) {
    structureSignal = wasBullishSwing ? 'CHOCH_BEAR' : 'BOS_BEAR';
    structureBias = 'BEARISH';
  } else if (wasBullishSwing) {
    structureSignal = 'BOS_BULL';
    structureBias = 'BULLISH';
  } else if (wasBearishSwing) {
    structureSignal = 'BOS_BEAR';
    structureBias = 'BEARISH';
  }

  // Principle 3: Strict Structural Swing (LH/HL) vs Internal Bounce on M15 / M5
  // Never emit counter-trend BOS/CHoCH on 15min/5min if candle close has NOT broken 1H structural LH/HL
  const isLtf = timeframe === '15min' || timeframe === '5min';
  let internalBounceFiltered = false;
  let internalBounceNoteId: string | null = null;

  if (isLtf && htfConstraint && htfConstraint.htfBias !== 'NEUTRAL') {
    if (htfConstraint.htfBias === 'BEARISH' && structureBias === 'BULLISH') {
      const closedAbove1hLh = recentCloses.some((c) => c > htfConstraint.protectedLevel);
      if (!closedAbove1hLh) {
        internalBounceFiltered = true;
        structureSignal = 'RANGE';
        structureBias = 'BEARISH';
        internalBounceNoteId = `Pantulan internal ${timeframe.toUpperCase()} ditahan sebagai IDM/Pullback — belum ada penutupan candle (MSS) di atas LH 1H ($${htfConstraint.protectedLevel.toFixed(2)}).`;
      }
    } else if (htfConstraint.htfBias === 'BULLISH' && structureBias === 'BEARISH') {
      const closedBelow1hHl = recentCloses.some((c) => c < htfConstraint.protectedLevel);
      if (!closedBelow1hHl) {
        internalBounceFiltered = true;
        structureSignal = 'RANGE';
        structureBias = 'BULLISH';
        internalBounceNoteId = `koreksi internal ${timeframe.toUpperCase()} ditahan sebagai IDM/Pullback — belum ada penutupan candle (MSS) di bawah HL 1H ($${htfConstraint.protectedLevel.toFixed(2)}).`;
      }
    }
  }

  // Protected Structural Level (HL for Bullish, LH for Bearish)
  const protectedSwingPrice =
    structureBias === 'BULLISH'
      ? Number(rangeLow.toFixed(2))
      : structureBias === 'BEARISH'
      ? Number(rangeHigh.toFixed(2))
      : equilibrium;
  const protectedSwingType: StructuralLockContext['protectedSwingType'] =
    structureBias === 'BULLISH' ? 'HL' : structureBias === 'BEARISH' ? 'LH' : 'RANGE_BOUND';
  const opposingTargetPrice =
    structureBias === 'BULLISH' ? Number(rangeHigh.toFixed(2)) : Number(rangeLow.toFixed(2));

  // Principle 1: Dynamic POI Hierarchy (Layer 1: Decisional FVG + Fibo OTE 0.57-0.70 vs Layer 2: Extreme OB)
  const effectiveDirection = structureBias === 'BEARISH' ? 'BEARISH' : 'BULLISH';
  let oteLow: number;
  let oteHigh: number;
  let extremeObLow: number;
  let extremeObHigh: number;

  if (effectiveDirection === 'BEARISH') {
    // Bearish retracement upward from rangeLow toward rangeHigh:
    // Layer 1 (Fibo OTE 0.57 - 0.70 retracement from rangeLow)
    oteLow = Number((rangeLow + 0.57 * span).toFixed(2));
    oteHigh = Number((rangeLow + 0.70 * span).toFixed(2));
    // Layer 2 (Extreme Supply OB at 0.82 - 0.98 near Swing High)
    extremeObLow = Number((rangeLow + 0.82 * span).toFixed(2));
    extremeObHigh = Number(rangeHigh.toFixed(2));
  } else {
    // Bullish retracement downward from rangeHigh toward rangeLow:
    // Layer 1 (Fibo OTE 0.57 - 0.70 retracement from rangeHigh)
    oteLow = Number((rangeHigh - 0.70 * span).toFixed(2));
    oteHigh = Number((rangeHigh - 0.57 * span).toFixed(2));
    // Layer 2 (Extreme Demand OB at 0.82 - 1.00 near Swing Low)
    extremeObLow = Number(rangeLow.toFixed(2));
    extremeObHigh = Number((rangeHigh - 0.82 * span).toFixed(2));
  }

  // Scan recent 30 candles for a real 3-candle Fair Value Gap (FVG) near the Decisional 0.45-0.75 zone
  let fvgDetected = false;
  let fvgLow = oteLow;
  let fvgHigh = oteHigh;

  for (let i = Math.max(2, candles.length - 32); i < candles.length - 2; i++) {
    const prevC = candles[i - 1];
    const nextC = candles[i + 1];
    if (effectiveDirection === 'BULLISH' && nextC.low > prevC.high) {
      const gapLow = prevC.high;
      const gapHigh = nextC.low;
      const gapMid = (gapLow + gapHigh) / 2;
      if (gapMid >= rangeLow + 0.22 * span && gapMid <= equilibrium) {
        fvgDetected = true;
        fvgLow = Number(Math.min(oteLow, gapLow).toFixed(2));
        fvgHigh = Number(Math.max(oteHigh, gapHigh).toFixed(2));
      }
    } else if (effectiveDirection === 'BEARISH' && nextC.high < prevC.low) {
      const gapLow = nextC.high;
      const gapHigh = prevC.low;
      const gapMid = (gapLow + gapHigh) / 2;
      if (gapMid >= equilibrium && gapMid <= rangeLow + 0.78 * span) {
        fvgDetected = true;
        fvgLow = Number(Math.min(oteLow, gapLow).toFixed(2));
        fvgHigh = Number(Math.max(oteHigh, gapHigh).toFixed(2));
      }
    }
  }

  const inOteZone = currentPrice >= fvgLow && currentPrice <= fvgHigh;

  // Inducement (IDM) vs Structural Swing:
  // IDM is specifically an internal minor swing (< 50% Equilibrium retracement) before POI Layer 1
  let inducement: InducementSignal = {
    detected: false,
    swept: false,
    price: null,
    type: null,
    isInternalPullback: false,
    noteId: 'Belum terbentuk Inducement (IDM < 50% EQ) pada kaki struktur ini.',
  };

  for (let i = Math.max(2, candles.length - 28); i < candles.length - 2; i++) {
    const c = candles[i];
    const isMinorHigh = c.high >= candles[i - 1].high && c.high >= candles[i + 1].high;
    const isMinorLow = c.low <= candles[i - 1].low && c.low <= candles[i + 1].low;

    if (effectiveDirection === 'BULLISH' && isMinorLow) {
      // In a bullish leg from rangeLow -> rangeHigh, a shallow pullback (<50% retracement from rangeHigh) sits above equilibrium
      const retracementFromHigh = (rangeHigh - c.low) / span;
      if (retracementFromHigh >= 0.18 && retracementFromHigh <= 0.52) {
        const subsequentCandles = candles.slice(i + 1);
        const wasSwept = subsequentCandles.some((sc) => sc.low < c.low);
        inducement = {
          detected: true,
          swept: wasSwept,
          price: Number(c.low.toFixed(2)),
          type: 'BULLISH_TRAP',
          isInternalPullback: true,
          noteId: wasSwept
            ? `IDM Internal ($${c.low.toFixed(2)}, <50% EQ) SUDAH TERSAPU — likuiditas ritel telah diambil menuju POI.`
            : `IDM Internal @ $${c.low.toFixed(2)} (<50% EQ) belum tersapu — rawan disapu dulu sebelum memantul di FVG/OTE.`,
        };
      }
    } else if (effectiveDirection === 'BEARISH' && isMinorHigh) {
      // In a bearish leg from rangeHigh -> rangeLow, a shallow pullback (<50% retracement from rangeLow) sits below equilibrium
      const retracementFromLow = (c.high - rangeLow) / span;
      if (retracementFromLow >= 0.18 && retracementFromLow <= 0.52) {
        const subsequentCandles = candles.slice(i + 1);
        const wasSwept = subsequentCandles.some((sc) => sc.high > c.high);
        inducement = {
          detected: true,
          swept: wasSwept,
          price: Number(c.high.toFixed(2)),
          type: 'BEARISH_TRAP',
          isInternalPullback: true,
          noteId: wasSwept
            ? `IDM Internal ($${c.high.toFixed(2)}, <50% EQ) SUDAH TERSAPU — likuiditas ritel telah diambil menuju POI.`
            : `IDM Internal @ $${c.high.toFixed(2)} (<50% EQ) belum tersapu — rawan disapu dulu sebelum turun dari FVG/OTE.`,
        };
      }
    }
  }

  // Evaluate Price Reaction at POI Layer 1 (FVG + OTE 0.57-0.70) vs Layer 2 (Extreme OB)
  const recent6 = candles.slice(-6);
  const recent6Vols = volumes.slice(-6);
  let touchedLayer1 = false;
  let rejectedAtLayer1 = false;
  let displacedThroughLayer1 = false;

  for (let i = 0; i < recent6.length; i++) {
    const c = recent6[i];
    const v = recent6Vols[i] || 0;
    const cRange = Math.max(0.01, c.high - c.low);
    const body = Math.abs(c.close - c.open);
    const bodyRatio = body / cRange;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);

    if (effectiveDirection === 'BULLISH') {
      if (c.low <= fvgHigh && c.high >= fvgLow) {
        touchedLayer1 = true;
        // Rejection: long lower wick (>=35% range), absorption volume, or bullish close holding above fvgLow
        if (
          (lowerWick / cRange >= 0.35 && c.close >= fvgLow) ||
          (c.close > c.open && c.close >= (fvgLow + fvgHigh) / 2 && v >= activityBaseline * 1.1)
        ) {
          rejectedAtLayer1 = true;
        }
      }
      // Full-body displacement breaking BELOW Layer 1 FVG/OTE toward Extreme OB
      if (c.close < fvgLow && c.close < c.open && bodyRatio >= 0.58) {
        displacedThroughLayer1 = true;
      }
    } else {
      if (c.high >= fvgLow && c.low <= fvgHigh) {
        touchedLayer1 = true;
        // Rejection: long upper wick (>=35% range), absorption volume, or bearish close holding below fvgHigh
        if (
          (upperWick / cRange >= 0.35 && c.close <= fvgHigh) ||
          (c.close < c.open && c.close <= (fvgLow + fvgHigh) / 2 && v >= activityBaseline * 1.1)
        ) {
          rejectedAtLayer1 = true;
        }
      }
      // Full-body displacement breaking ABOVE Layer 1 FVG/OTE toward Extreme OB
      if (c.close > fvgHigh && c.close > c.open && bodyRatio >= 0.58) {
        displacedThroughLayer1 = true;
      }
    }
  }

  // Also check if current price has already bypassed Layer 1 into the deep Extreme OB zone
  const pricePastLayer1TowardOb =
    effectiveDirection === 'BULLISH' ? currentPrice < fvgLow : currentPrice > fvgHigh;

  let reactionStatus: PoiReactionStatus = 'AWAITING_POI_TEST';
  let activeTargetLayer: PoiHierarchyAnalysis['activeTargetLayer'] = 'LAYER_1_FVG_OTE';
  let statusBadgeId = 'MENUNGGU UJI POI LAPIS 1 (FVG/OTE)';
  let reactionEvidenceId = '';
  let unmitigatedFutureLiquidity = false;

  if (displacedThroughLayer1 || pricePastLayer1TowardOb) {
    reactionStatus = 'TARGET_EXTREME_OB';
    activeTargetLayer = 'LAYER_2_EXTREME_OB';
    statusBadgeId = 'POI LAPIS 2: EXTREME OB';
    reactionEvidenceId = `Harga menembus POI Lapis 1 (FVG/OTE $${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(
      2
    )}) dengan displacement — target likuiditas beralih ke Extreme OB ($${extremeObLow.toFixed(
      2
    )}–$${extremeObHigh.toFixed(2)}).`;
  } else if (touchedLayer1 && rejectedAtLayer1) {
    reactionStatus = 'FVG_VALID_REVERSAL';
    activeTargetLayer = 'LAYER_1_FVG_OTE';
    statusBadgeId = 'FVG VALID SEBAGAI TITIK BALIK';
    unmitigatedFutureLiquidity = true;
    reactionEvidenceId = `Reaksi penolakan (wick rejection / penyerapan volume) terkonfirmasi di POI Lapis 1 FVG+OTE ($${fvgLow.toFixed(
      2
    )}–$${fvgHigh.toFixed(2)}). Extreme OB ($${extremeObLow.toFixed(2)}–$${extremeObHigh.toFixed(
      2
    )}) disimpan sebagai unmitigated liquidity untuk masa depan.`;
  } else {
    reactionStatus = 'AWAITING_POI_TEST';
    activeTargetLayer = 'LAYER_1_FVG_OTE';
    statusBadgeId = inOteZone
      ? 'MENGUJI ZONA FVG/OTE (PANTAU REAKSI)'
      : 'PANTAU POI LAPIS 1 (FVG/OTE 0.57–0.70)';
    reactionEvidenceId = `POI Lapis 1 (FVG+OTE $${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(
      2
    )}) menjadi gerbang keputusan pertama; jika tertembus full-body, proyeksi otomatis beralih ke Extreme OB ($${extremeObLow.toFixed(
      2
    )}–$${extremeObHigh.toFixed(2)}).`;
  }

  const poiHierarchy: PoiHierarchyAnalysis = {
    layer1DecisionalFvgOte: {
      low: fvgLow,
      high: fvgHigh,
      midpoint: Number(((fvgLow + fvgHigh) / 2).toFixed(2)),
      hasFvgImbalance: fvgDetected,
      labelId: fvgDetected ? 'POI Lapis 1 (FVG + OTE 0.57–0.70)' : 'POI Lapis 1 (Decisional OTE 0.57–0.70)',
    },
    layer2ExtremeOb: {
      low: extremeObLow,
      high: extremeObHigh,
      midpoint: Number(((extremeObLow + extremeObHigh) / 2).toFixed(2)),
      unmitigatedFutureLiquidity,
      labelId: unmitigatedFutureLiquidity
        ? 'POI Lapis 2 (Extreme OB · Unmitigated Masa Depan)'
        : 'POI Lapis 2 (Extreme OB)',
    },
    reactionStatus,
    activeTargetLayer,
    statusBadgeId,
    reactionEvidenceId,
  };

  // Audit 3-Candle Healthy Order Block (Mandatory FVG after OB + OB not swept by subsequent impulsive candle)
  const healthyOb = scanDirectionalHealthyOrderBlock(
    candles,
    effectiveDirection,
    rangeLow,
    rangeHigh,
    atr14
  );

  // Score calculation (0..100, >50 Bullish, <50 Bearish)
  let score = 50;
  if (structureBias === 'BULLISH') {
    score += hasVolumeSpike ? 22 : 12;
    if (reactionStatus === 'FVG_VALID_REVERSAL') score += 8;
    if (healthyOb.isHealthySmcOb) score += 5;
  } else if (structureBias === 'BEARISH') {
    score -= hasVolumeSpike ? 22 : 12;
    if (reactionStatus === 'FVG_VALID_REVERSAL') score -= 8;
    if (healthyOb.isHealthySmcOb) score -= 5;
  }

  // Premium / Discount Array Adjustment & Penalty
  let pdPenaltyApplied = false;
  if (structureBias === 'BULLISH') {
    if (pdZone === 'PREMIUM') {
      score -= 14;
      pdPenaltyApplied = true;
    } else if (pdZone === 'DISCOUNT') {
      score += 10;
      if (inOteZone) score += 6;
    }
  } else if (structureBias === 'BEARISH') {
    if (pdZone === 'DISCOUNT') {
      score += 14;
      pdPenaltyApplied = true;
    } else if (pdZone === 'PREMIUM') {
      score -= 10;
      if (inOteZone) score -= 6;
    }
  } else {
    if (pdZone === 'DISCOUNT') score += 6;
    if (pdZone === 'PREMIUM') score -= 6;
  }

  // If IDM is detected and NOT yet swept, temper aggressive score slightly
  if (inducement.detected && !inducement.swept && !inOteZone) {
    score = 50 + (score - 50) * 0.85;
  }

  const finalScore = Number(clamp(score, 10, 90).toFixed(1));
  const volNote = hasRealVolume
    ? hasVolumeSpike
      ? `Vol Spike ${volumeRatio}x`
      : `Vol ${volumeRatio}x SMA20`
    : hasVolumeSpike
    ? `Range Spike ${volumeRatio}x ATR`
    : `Range ${volumeRatio}x ATR`;
  const pdNote = `${pdZone} (${positionPct.toFixed(0)}%)`;
  const obHealthBadge = healthyOb.isHealthySmcOb
    ? 'OB Sehat (FVG+AntiSweep)'
    : healthyOb.detected && !healthyOb.notSweptByImpulsiveCandle
    ? 'OB Swept Impulsif'
    : healthyOb.detected && !healthyOb.hasFvgAfter
    ? 'OB Tanpa FVG'
    : '';
  const poiShortNote =
    reactionStatus === 'FVG_VALID_REVERSAL'
      ? `FVG Valid ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)})`
      : reactionStatus === 'TARGET_EXTREME_OB'
      ? `Incar Extreme OB ($${extremeObLow.toFixed(2)}–$${extremeObHigh.toFixed(2)})`
      : `OTE 0.57–0.70 ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)})`;

  const summaryId = `${structureSignal}${internalBounceFiltered ? ' (Tahan Pantulan Internal)' : ''} · ${pdNote} · ${poiShortNote}${obHealthBadge ? ` · ${obHealthBadge}` : ''} · ${volNote}`;

  return {
    timeframe,
    swingHigh: Number(rangeHigh.toFixed(2)),
    swingLow: Number(rangeLow.toFixed(2)),
    equilibrium,
    oteLow: fvgLow,
    oteHigh: fvgHigh,
    inOteZone,
    positionPct,
    pdZone,
    structureSignal,
    structureBias,
    volumeRatio,
    hasVolumeSpike,
    hasRealVolume,
    inducement,
    poiHierarchy,
    structuralLock: {
      protectedSwingPrice,
      protectedSwingType,
      opposingTargetPrice,
      internalBounceFiltered,
      internalBounceNoteId,
    },
    healthyOb,
    pdPenaltyApplied,
    score: finalScore,
    summaryId,
  };
}

/**
 * 3. Adaptive Contextual AMD State Machine (Anti-Pola Kaku)
 * Evaluates session behavior across Tokyo (04:00–13:00), London (13:00–18:00), New York (18:00–04:00 WIB):
 * - Siklus Normal: Akumulasi -> Manipulasi (sweep wick berlawanan arah) -> Distribusi
 * - Skip-Manipulation (Momentum Kuat): Breakout full-body searah tren HTF (>1.3x ATR) -> "DISTRIBUSI AWAL (TANPA MANIPULASI)"
 * - Double Accumulation (Kompresi Ganda): Tokyo & London sama-sama sempit (<1.2x ATR) tanpa saling menyapu -> "AKUMULASI GANDA"
 * - Extended Ranging Pasca-Sweep: Setelah sweep likuiditas tertahan sideways tanpa displacement -> "KONSOLIDASI PASCA-MANIPULASI (TUNGGU MSS)"
 */
export function evaluateRollingAmdStateMachine(
  candles: ConfluenceCandle[],
  macroBias: MacroBiasDirection,
  sessionConfig: SessionHoursWibConfig = DEFAULT_SESSION_HOURS_WIB,
  htfStructureBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL',
  manualAmdOverride: ManualAmdOverrideMode = 'AUTO'
): AmdStateMachineResult {
  if (!Array.isArray(candles) || candles.length < 16) {
    const last = candles?.[candles.length - 1];
    const price = last?.close ?? 0;
    const nowSec = last ? last.time : Math.floor(Date.now() / 1000);
    const session = getSessionWIB(nowSec, sessionConfig);
    const fallbackBase: AmdStateMachineResult = {
      phase: 'ACCUMULATION',
      adaptiveRegime: 'NORMAL_AMD_CYCLE',
      adaptiveRegimeBadgeId: 'SIKLUS NORMAL (MENUNGGU DATA)',
      gatekeeperStatus: 'LOCKED',
      transitionModel: 'CONSOLIDATING',
      currentSession: session,
      activeBox: {
        high: price,
        low: price,
        session,
        startTime: last?.time ?? 0,
        endTime: last?.time ?? 0,
        isCompressed: true,
      },
      atr14: 0,
      tokyoRangeAtrRatio: 1,
      londonRangeAtrRatio: 1,
      sessionAnomalyDetected: false,
      manipulationWatchSession: session === 'NEW_YORK' ? 'ASIA' : session === 'ASIA' ? 'LONDON' : 'NEW_YORK',
      distributionProjectionSession: session === 'NEW_YORK' ? 'LONDON' : 'NEW_YORK',
      nextSessionProjectionId: 'Menunggu data candle LTF yang cukup.',
      nearestBslPrice: price,
      nearestSslPrice: price,
      dampeningFactor: 0.35,
      headlineId: `AKUMULASI (${getSessionLabelId(session)}) — Menunggu Data LTF`,
      detailId: 'Candle eksekusi belum mencukupi untuk validasi fase AMD.',
      manualOverrideMode: 'AUTO',
      isManualOverride: false,
    };
    return applyManualAmdOverrideToState(fallbackBase, manualAmdOverride, sessionConfig);
  }

  const atr14 = computeAtr14(candles);
  const { volumes, hasRealVolume } = resolveEffectiveVolumes(candles);
  const smaVol20 = computeSma(volumes, 20);
  const activityBaseline = hasRealVolume ? smaVol20 : atr14;
  const lastCandle = candles[candles.length - 1];
  const currentSession = getSessionWIB(lastCandle.time, sessionConfig);

  // Partition candles into contiguous session segments using the exact Cycle & Confluence session time division
  const sessionLiquidity = computeSessionLiquidityFromCandles(candles, sessionConfig, atr14);
  const detectedBox: AmdBox = sessionLiquidity.referenceBox;
  const boxEndIdx = sessionLiquidity.referenceBoxEndIdx;

  // Measure the latest single Tokyo (ASIA) and London segments within the current 28h cycle
  // (works consistently for both 15m SCALP and 1h SWING, even deep into New York session)
  const recentSegments = sessionLiquidity.segments.filter(
    (seg) => lastCandle.time - seg.endTime <= 28 * 3600
  );
  let latestLondonSeg: SessionSegmentLiquidity | undefined;
  for (let i = recentSegments.length - 1; i >= 0; i--) {
    if (recentSegments[i].session === 'LONDON') {
      latestLondonSeg = recentSegments[i];
      break;
    }
  }
  let latestTokyoSeg: SessionSegmentLiquidity | undefined;
  if (latestLondonSeg) {
    for (let i = recentSegments.length - 1; i >= 0; i--) {
      const seg = recentSegments[i];
      if (
        seg.session === 'ASIA' &&
        seg.startTime <= latestLondonSeg.startTime &&
        latestLondonSeg.startTime - seg.endTime <= 6 * 3600
      ) {
        latestTokyoSeg = seg;
        break;
      }
    }
  }
  if (!latestTokyoSeg) {
    for (let i = recentSegments.length - 1; i >= 0; i--) {
      if (recentSegments[i].session === 'ASIA') {
        latestTokyoSeg = recentSegments[i];
        break;
      }
    }
  }

  const tokyoCandles = latestTokyoSeg?.candles ?? [];
  const londonCandles = latestLondonSeg?.candles ?? [];

  const tokyoHigh = latestTokyoSeg ? latestTokyoSeg.high : 0;
  const tokyoLow = latestTokyoSeg ? latestTokyoSeg.low : 0;
  const tokyoRange = tokyoHigh > tokyoLow ? tokyoHigh - tokyoLow : atr14;

  const londonHigh = latestLondonSeg ? latestLondonSeg.high : 0;
  const londonLow = latestLondonSeg ? latestLondonSeg.low : 0;
  const londonRange = londonHigh > londonLow ? londonHigh - londonLow : atr14;

  // Normalize per-bar average range across Tokyo & London against session-wide baseline ATR
  // (prevents a quiet pre-news NY window from shrinking atr14 and falsely disqualifying Tokyo/London compression)
  let trSum = 0;
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    trSum += Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
  }
  const fullWindowAvgTr = candles.length > 1 ? trSum / (candles.length - 1) : atr14;
  const sessionAtrBaseline = Math.max(0.1, atr14, fullWindowAvgTr);

  const tokyoAvgBarRange =
    tokyoCandles.length > 0
      ? tokyoCandles.reduce((acc, c) => acc + (c.high - c.low), 0) / tokyoCandles.length
      : atr14;
  const londonAvgBarRange =
    londonCandles.length > 0
      ? londonCandles.reduce((acc, c) => acc + (c.high - c.low), 0) / londonCandles.length
      : atr14;

  const tokyoRangeAtrRatio = Number((tokyoAvgBarRange / sessionAtrBaseline).toFixed(2));
  const londonRangeAtrRatio = Number((londonAvgBarRange / sessionAtrBaseline).toFixed(2));

  const postCandles = candles.slice(Math.min(candles.length - 1, boxEndIdx + 1));
  const postVols = volumes.slice(Math.min(volumes.length - 1, boxEndIdx + 1));

  const effectiveTrendDir: 'BUY' | 'SELL' | 'MIXED' =
    htfStructureBias === 'BULLISH'
      ? 'BUY'
      : htfStructureBias === 'BEARISH'
      ? 'SELL'
      : macroBias;

  let sawSkipManipulationBreakout = false;
  let skipManipDirection: 'BUY' | 'SELL' | null = null;
  let sawRejectionSweep = false;
  let sweepDirection: 'BULL_SWEEP_LOW' | 'BEAR_SWEEP_HIGH' | null = null;
  let sweepBarIdx = -1;
  let hasMssAfterSweep = false;

  for (let i = 0; i < postCandles.length; i++) {
    const c = postCandles[i];
    const v = postVols[i] || 0;
    const range = Math.max(0.01, c.high - c.low);
    const body = Math.abs(c.close - c.open);
    const bodyRatio = body / range;
    const isStrongMomentum =
      bodyRatio >= 0.60 && (range > atr14 * 1.3 || v > activityBaseline * 1.3);

    const bullBreak = c.close > detectedBox.high && c.close > c.open;
    const bearBreak = c.close < detectedBox.low && c.close < c.open;

    // Check for Manipulation sweep first
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    if (
      c.low < detectedBox.low &&
      (lowerWick / range >= 0.38 || c.close >= detectedBox.low)
    ) {
      sawRejectionSweep = true;
      sweepDirection = 'BULL_SWEEP_LOW';
      if (sweepBarIdx === -1) sweepBarIdx = i;
    } else if (
      c.high > detectedBox.high &&
      (upperWick / range >= 0.38 || c.close <= detectedBox.high)
    ) {
      sawRejectionSweep = true;
      sweepDirection = 'BEAR_SWEEP_HIGH';
      if (sweepBarIdx === -1) sweepBarIdx = i;
    }

    // Skip-Manipulation: Direct full-body breakout (>1.3x ATR) aligned with HTF/Macro trend without opposite sweep
    if (isStrongMomentum && !sawRejectionSweep) {
      if (bullBreak && (effectiveTrendDir === 'BUY' || effectiveTrendDir === 'MIXED')) {
        sawSkipManipulationBreakout = true;
        skipManipDirection = 'BUY';
      } else if (bearBreak && (effectiveTrendDir === 'SELL' || effectiveTrendDir === 'MIXED')) {
        sawSkipManipulationBreakout = true;
        skipManipDirection = 'SELL';
      }
    }

    if (sawRejectionSweep) {
      const boxMid = (detectedBox.high + detectedBox.low) / 2;
      const hasDisplacementMss = bodyRatio >= 0.55 && range >= atr14 * 0.95;
      if (
        sweepDirection === 'BULL_SWEEP_LOW' &&
        c.close > boxMid &&
        c.close > c.open &&
        hasDisplacementMss
      ) {
        hasMssAfterSweep = true;
      } else if (
        sweepDirection === 'BEAR_SWEEP_HIGH' &&
        c.close < boxMid &&
        c.close < c.open &&
        hasDisplacementMss
      ) {
        hasMssAfterSweep = true;
      }
    }
  }

  // Check Double Accumulation: Tokyo & London in the same cycle, both compressed in per-bar avg (<1.2x ATR) AND total session range, without sweeping each other
  const tokyoAndLondonSameCycle = Boolean(
    latestTokyoSeg &&
      latestLondonSeg &&
      latestLondonSeg.startTime >= latestTokyoSeg.startTime &&
      latestLondonSeg.startTime - latestTokyoSeg.endTime <= 6 * 3600
  );
  const tokyoMaxCompressedRange =
    atr14 * clamp(Math.sqrt(Math.max(1, tokyoCandles.length)) * 0.95, 2.6, 5.2);
  const londonMaxCompressedRange =
    atr14 * clamp(Math.sqrt(Math.max(1, londonCandles.length)) * 0.95, 2.6, 5.2);

  const londonDidNotSweepTokyoBothSides =
    tokyoCandles.length >= 2 &&
    londonCandles.length >= 2 &&
    !(londonHigh > tokyoHigh + atr14 * 0.35 && londonLow < tokyoLow - atr14 * 0.35);

  const isDoubleAccumulation =
    tokyoAndLondonSameCycle &&
    tokyoCandles.length >= 2 &&
    londonCandles.length >= 2 &&
    tokyoRangeAtrRatio < 1.2 &&
    londonRangeAtrRatio < 1.2 &&
    tokyoRange <= tokyoMaxCompressedRange &&
    londonRange <= londonMaxCompressedRange &&
    londonDidNotSweepTokyoBothSides &&
    !sawSkipManipulationBreakout &&
    !sawRejectionSweep &&
    !hasMssAfterSweep;

  // Check Extended Ranging Post-Sweep: Swept liquidity, but subsequent bars stalled sideways without displacement/MSS
  const barsSinceSweep = sweepBarIdx >= 0 ? postCandles.length - 1 - sweepBarIdx : 0;
  const isExtendedRangingPostSweep =
    sawRejectionSweep && !hasMssAfterSweep && barsSinceSweep >= 2;

  let phase: AmdPhase = 'ACCUMULATION';
  let adaptiveRegime: AdaptiveAmdRegime = 'NORMAL_AMD_CYCLE';
  let adaptiveRegimeBadgeId = 'SIKLUS AMD NORMAL';
  let gatekeeperStatus: GatekeeperStatus = 'LOCKED';
  let transitionModel: AmdStateMachineResult['transitionModel'] = 'CONSOLIDATING';
  let dampeningFactor = 0.35;
  let sessionAnomalyDetected = false;
  let activeBox = detectedBox;

  let manipulationWatchSession: TradingSessionName =
    currentSession === 'ASIA' ? 'LONDON' : currentSession === 'LONDON' ? 'NEW_YORK' : 'ASIA';
  let distributionProjectionSession: TradingSessionName =
    currentSession === 'ASIA' ? 'NEW_YORK' : currentSession === 'LONDON' ? 'NEW_YORK' : 'LONDON';
  let nextSessionProjectionId = '';

  if (sawSkipManipulationBreakout && !sawRejectionSweep) {
    phase = 'EARLY_DISTRIBUTION';
    adaptiveRegime = 'SKIP_MANIPULATION_EARLY_DIST';
    adaptiveRegimeBadgeId = 'DISTRIBUSI AWAL (TANPA MANIPULASI)';
    gatekeeperStatus = 'ACTIVE';
    transitionModel = 'MODEL_B_ONE_WAY';
    dampeningFactor = 1.0;
    nextSessionProjectionId = `Momentum kuat (>1.3x ATR) menembus Box tanpa sweep lawan arah — proyeksikan sesi ${getSessionLabelId(
      distributionProjectionSession
    )} sebagai kelanjutan tren via retest FVG/OB sesi ini.`;
  } else if (sawRejectionSweep && hasMssAfterSweep) {
    phase = 'DISTRIBUTION';
    adaptiveRegime = 'NORMAL_AMD_CYCLE';
    adaptiveRegimeBadgeId = 'SIKLUS NORMAL: DISTRIBUSI PASCA-SWEEP';
    gatekeeperStatus = 'ACTIVE';
    transitionModel = 'MODEL_A_JUDAS_REVERSAL';
    dampeningFactor = 1.0;
    nextSessionProjectionId = `Manipulasi & MSS telah tervalidasi — sesi ${getSessionLabelId(
      currentSession
    )} menjalankan ekspansi distribusi menuju likuiditas eksternal.`;
  } else if (isExtendedRangingPostSweep) {
    phase = 'POST_SWEEP_CONSOLIDATION';
    adaptiveRegime = 'POST_SWEEP_CONSOLIDATION';
    adaptiveRegimeBadgeId = 'KONSOLIDASI PASCA-MANIPULASI (TUNGGU MSS)';
    gatekeeperStatus = 'PREPARE';
    transitionModel = 'CONSOLIDATING';
    dampeningFactor = 0.58;
    nextSessionProjectionId = `Likuiditas tepi Box telah disapu namun harga tertahan sideways tanpa displacement — dilarang memaksa sinyal BOS baru sebelum penutupan candle MSS yang tegas.`;
  } else if (isDoubleAccumulation) {
    phase = 'DOUBLE_ACCUMULATION';
    adaptiveRegime = 'DOUBLE_ACCUMULATION';
    adaptiveRegimeBadgeId = 'AKUMULASI GANDA (TOKYO + LONDON <1.2x ATR)';
    gatekeeperStatus = 'PREPARE';
    transitionModel = 'CONSOLIDATING';
    dampeningFactor = 0.55;
    const combinedHigh = Math.max(tokyoHigh || activeBox.high, londonHigh || activeBox.high);
    const combinedLow = Math.min(
      tokyoLow > 0 ? tokyoLow : activeBox.low,
      londonLow > 0 ? londonLow : activeBox.low
    );
    activeBox = {
      ...activeBox,
      high: Number(combinedHigh.toFixed(2)),
      low: Number(combinedLow.toFixed(2)),
      isCompressed: true,
    };
    manipulationWatchSession = 'NEW_YORK';
    distributionProjectionSession = 'NEW_YORK';
    nextSessionProjectionId = `Tokyo (${tokyoRangeAtrRatio}x ATR) & London (${londonRangeAtrRatio}x ATR) sama-sama terkompresi — Sesi New York / News diproyeksikan sebagai ZONA MANIPULASI / SWEEP LIKUIDITAS (waspadai spike 2 arah sebelum tren asli).`;
  } else if (sawRejectionSweep) {
    phase = 'MANIPULATION';
    adaptiveRegime = 'NORMAL_AMD_CYCLE';
    adaptiveRegimeBadgeId = 'FASE MANIPULASI (JUDAS SWEEP)';
    gatekeeperStatus = 'PREPARE';
    transitionModel = 'MODEL_A_JUDAS_REVERSAL';
    dampeningFactor = 0.65;
    nextSessionProjectionId = `Sweep likuiditas aktif pada sesi ${getSessionLabelId(
      currentSession
    )} — tunggu candle penutupan MSS kembali ke dalam struktur sebelum eksekusi.`;
  } else {
    // Check NY Session Anomaly using actual time window (up to last 6h of active NY session) so 15m and 1h behave consistently
    const activeSeg = sessionLiquidity.activeSessionSegment;
    const nyWindowStart = lastCandle.time - 6 * 3600;
    const nyCandles =
      currentSession === 'NEW_YORK' && activeSeg.session === 'NEW_YORK'
        ? activeSeg.candles.filter((c) => c.time >= nyWindowStart)
        : [];
    if (currentSession === 'NEW_YORK' && nyCandles.length >= 3) {
      const nyHigh = Math.max(...nyCandles.map((c) => c.high));
      const nyLow = Math.min(...nyCandles.map((c) => c.low));
      const nyAvgBarRange =
        nyCandles.reduce((acc, c) => acc + (c.high - c.low), 0) / nyCandles.length;
      const nyMaxRange =
        atr14 * clamp(Math.sqrt(nyCandles.length) * 0.65, 1.35, 2.4);
      if (nyHigh - nyLow < nyMaxRange && nyAvgBarRange < atr14 * 1.15) {
        sessionAnomalyDetected = true;
        phase = 'RE-ACCUMULATION';
        adaptiveRegime = 'NY_REACCUMULATION';
        adaptiveRegimeBadgeId = 'RE-AKUMULASI NEW YORK';
        activeBox = {
          high: Number(nyHigh.toFixed(2)),
          low: Number(nyLow.toFixed(2)),
          session: 'NEW_YORK',
          startTime: nyCandles[0].time,
          endTime: nyCandles[nyCandles.length - 1].time,
          isCompressed: true,
        };
        manipulationWatchSession = 'ASIA';
        distributionProjectionSession = 'LONDON';
      }
    }
    nextSessionProjectionId = `Harga membangun likuiditas di Box ${getSessionLabelId(
      activeBox.session
    )} — pantau potensi sweep di sesi ${getSessionLabelId(manipulationWatchSession)}.`;
  }

  // Single Source of Truth Session BSL & SSL:
  // Highest High and Lowest Low of the active/previous session that have NOT been swept
  const nearestBslPrice = sessionLiquidity.bslPrice;
  const nearestSslPrice = sessionLiquidity.sslPrice;

  const boxSessionWithWib = `${getSessionLabelId(activeBox.session)} (${formatSessionWindowWib(
    activeBox.session,
    sessionConfig
  )})`;

  let headlineId = '';
  let detailId = '';

  if (adaptiveRegime === 'SKIP_MANIPULATION_EARLY_DIST') {
    headlineId = `DISTRIBUSI AWAL (TANPA MANIPULASI) · ${
      skipManipDirection === 'SELL' ? 'BEARISH' : 'BULLISH'
    }`;
    detailId = `Setelah Akumulasi, harga langsung breakout full-body searah tren (>1.3x ATR) keluar dari Box ${boxSessionWithWib} ($${activeBox.low.toFixed(
      2
    )}–$${activeBox.high.toFixed(2)}). ${nextSessionProjectionId}`;
  } else if (adaptiveRegime === 'DOUBLE_ACCUMULATION') {
    headlineId = 'AKUMULASI GANDA (TOKYO + LONDON KOMPRESI)';
    detailId = `Tokyo (${tokyoRangeAtrRatio}x ATR) dan London (${londonRangeAtrRatio}x ATR) bergerak sempit tanpa saling menyapu dalam rentang $${activeBox.low.toFixed(
      2
    )}–$${activeBox.high.toFixed(
      2
    )}. Sesi New York / News menjadi ZONA MANIPULASI / SWEEP LIKUIDITAS (waspada spike 2 arah).`;
  } else if (adaptiveRegime === 'POST_SWEEP_CONSOLIDATION') {
    headlineId = 'KONSOLIDASI PASCA-MANIPULASI (TUNGGU MSS)';
    detailId = `Harga telah menyapu tepi Box ${boxSessionWithWib} ($${activeBox.low.toFixed(
      2
    )}–$${activeBox.high.toFixed(
      2
    )}) namun tertahan sideways tanpa displacement. Jangan memaksa sinyal BOS baru; tunggu konfirmasi candle MSS.`;
  } else if (phase === 'RE-ACCUMULATION') {
    headlineId = 'RE-AKUMULASI SESI NEW YORK (TERKUNCI)';
    detailId = `Sesi New York (${formatSessionWindowWib(
      'NEW_YORK',
      sessionConfig
    )}) bergerak sempit ($${activeBox.low.toFixed(2)}–$${activeBox.high.toFixed(
      2
    )}). Pantau Manipulasi di sesi Tokyo dan proyeksi Distribusi di sesi London.`;
  } else if (phase === 'DISTRIBUTION') {
    headlineId = 'DISTRIBUSI AKTIF · SIKLUS AMD TERKONFIRMASI';
    detailId = `Sweep likuiditas Box ${boxSessionWithWib} diikuti displacement MSS telah tervalidasi. Gatekeeper AKTIF menuju target likuiditas berikutnya.`;
  } else if (phase === 'MANIPULATION') {
    headlineId = 'FASE MANIPULASI / JUDAS SWEEP (SIAP-SIAP)';
    detailId = `Terdeteksi sapuan likuiditas pada tepi Box ${boxSessionWithWib} ($${activeBox.low.toFixed(
      2
    )}–$${activeBox.high.toFixed(2)}). Tunggu penutupan candle MSS sebelum entry.`;
  } else {
    headlineId = `AKUMULASI SESI ${getSessionLabelId(activeBox.session).toUpperCase()} (TERKUNCI)`;
    detailId = `Harga terkompresi dalam rentang Box ${boxSessionWithWib} ($${activeBox.low.toFixed(
      2
    )}–$${activeBox.high.toFixed(2)}). Gatekeeper menahan bias agresif untuk mencegah entry di tengah konsolidasi.`;
  }

  const autoResult: AmdStateMachineResult = {
    phase,
    adaptiveRegime,
    adaptiveRegimeBadgeId,
    gatekeeperStatus,
    transitionModel,
    currentSession,
    activeBox,
    atr14,
    tokyoRangeAtrRatio,
    londonRangeAtrRatio,
    sessionAnomalyDetected,
    manipulationWatchSession,
    distributionProjectionSession,
    nextSessionProjectionId,
    nearestBslPrice,
    nearestSslPrice,
    dampeningFactor,
    headlineId,
    detailId,
    manualOverrideMode: 'AUTO',
    isManualOverride: false,
  };

  return applyManualAmdOverrideToState(autoResult, manualAmdOverride, sessionConfig);
}

/**
 * Applies the user's Manual AMD Override on top of the automatic AMD state machine result
 * without mutating any underlying SMC, POI, OTE, or liquidity level calculations.
 */
export function applyManualAmdOverrideToState(
  base: AmdStateMachineResult,
  overrideMode: ManualAmdOverrideMode,
  sessionConfig: SessionHoursWibConfig = DEFAULT_SESSION_HOURS_WIB
): AmdStateMachineResult {
  if (!overrideMode || overrideMode === 'AUTO') {
    return {
      ...base,
      manualOverrideMode: 'AUTO',
      isManualOverride: false,
    };
  }

  const boxSessionWithWib = `${getSessionLabelId(base.activeBox.session)} (${formatSessionWindowWib(
    base.activeBox.session,
    sessionConfig
  )})`;
  const boxRangeStr =
    base.activeBox.high > 0
      ? `$${base.activeBox.low.toFixed(2)}–$${base.activeBox.high.toFixed(2)}`
      : 'kotak sesi berjalan';

  if (overrideMode === 'ACCUMULATION') {
    const nextWatchLabel = `${getSessionLabelId(
      base.manipulationWatchSession
    )} (${formatSessionWindowWib(base.manipulationWatchSession, sessionConfig)})`;
    const nextProj = `Sesi berikutnya (${nextWatchLabel}) berpotensi melakukan Manipulasi — waspadai sweep BSL ($${base.activeBox.high.toFixed(
      2
    )}) atau SSL ($${base.activeBox.low.toFixed(2)}) kotak sesi berjalan sebelum ekspansi tren.`;
    return {
      ...base,
      phase: 'ACCUMULATION',
      adaptiveRegime: 'NORMAL_AMD_CYCLE',
      adaptiveRegimeBadgeId: 'MANUAL LOCK · AKUMULASI (KOMPRESI)',
      gatekeeperStatus: 'LOCKED',
      transitionModel: 'CONSOLIDATING',
      dampeningFactor: 0, // Holds probability score at neutral 50% / 50%
      nextSessionProjectionId: nextProj,
      headlineId: `AKUMULASI (${getSessionLabelId(base.activeBox.session).toUpperCase()}) · KOMPRESI LIKUIDITAS (TERKUNCI)`,
      detailId: `Mode Manual Akumulasi Aktif: Status Gatekeeper dikunci pada fase kompresi likuiditas di Box ${boxSessionWithWib} (${boxRangeStr}) dan skor probabilitas ditahan ke zona netral (50%). ${nextProj}`,
      manualOverrideMode: 'ACCUMULATION',
      isManualOverride: true,
    };
  }

  if (overrideMode === 'MANIPULATION') {
    const nextProj = `Market sedang dalam fase sapuan likuiditas / stop-hunt pada batas Box (${boxRangeStr}) — tunggu konfirmasi penolakan (wick rejection) atau MSS sebelum entri mengikuti arah distribusi.`;
    return {
      ...base,
      phase: 'MANIPULATION',
      adaptiveRegime: 'NORMAL_AMD_CYCLE',
      adaptiveRegimeBadgeId: 'MANUAL LOCK · FASE MANIPULASI (STOP-HUNT)',
      gatekeeperStatus: 'PREPARE',
      transitionModel: 'MODEL_A_JUDAS_REVERSAL',
      dampeningFactor: 0.65,
      nextSessionProjectionId: nextProj,
      headlineId: 'FASE MANIPULASI · SAPUAN LIKUIDITAS / STOP-HUNT (SIAP)',
      detailId: `Peringatan Fase Manipulasi Aktif: Market sedang melakukan sapuan likuiditas / stop-hunt di sekitar BSL ($${base.nearestBslPrice.toFixed(
        2
      )}) / SSL ($${base.nearestSslPrice.toFixed(
        2
      )}). Wajib menunggu konfirmasi penolakan (rejection) atau penutupan candle MSS sebelum entri mengikuti arah distribusi.`,
      manualOverrideMode: 'MANIPULATION',
      isManualOverride: true,
    };
  }

  if (overrideMode === 'DISTRIBUTION') {
    const nextProj = `Kunci Gatekeeper dibuka penuh — skor konfluensi SMC (D1/4H/1H) berjalan 100% searah tren utama menuju likuiditas eksternal (BSL $${base.nearestBslPrice.toFixed(
      2
    )} / SSL $${base.nearestSslPrice.toFixed(2)}).`;
    return {
      ...base,
      phase: 'DISTRIBUTION',
      adaptiveRegime: 'NORMAL_AMD_CYCLE',
      adaptiveRegimeBadgeId: 'MANUAL LOCK · DISTRIBUSI PENUH AKTIF',
      gatekeeperStatus: 'ACTIVE',
      transitionModel: 'MODEL_A_JUDAS_REVERSAL',
      dampeningFactor: 1.0,
      nextSessionProjectionId: nextProj,
      headlineId: 'DISTRIBUSI AKTIF · KONFLUENSI SMC BERJALAN PENUH',
      detailId: `Mode Manual Distribusi Aktif: Gatekeeper dibuka penuh dan mengizinkan skor konfluensi SMC (D1/4H/1H) berjalan 100% searah tren utama. Fokus pada retest POI Lapis 1 (FVG/OTE) atau Extreme OB.`,
      manualOverrideMode: 'DISTRIBUTION',
      isManualOverride: true,
    };
  }

  // POST_SWEEP_RANGING ("Ranging Pasca-Sweep")
  const nextProj = `Tahan sinyal entry baru (redam false BOS di M15/M5) hingga terbentuk candle displacement / MSS yang menembus struktur 1H.`;
  return {
    ...base,
    phase: 'POST_SWEEP_CONSOLIDATION',
    adaptiveRegime: 'POST_SWEEP_CONSOLIDATION',
    adaptiveRegimeBadgeId: 'MANUAL LOCK · RANGING PASCA-SWEEP (TUNGGU MSS 1H)',
    gatekeeperStatus: 'PREPARE',
    transitionModel: 'CONSOLIDATING',
    dampeningFactor: 0.50,
    nextSessionProjectionId: nextProj,
    headlineId: 'RANGING PASCA-SWEEP · REDAM FALSE BOS M15/M5',
    detailId: `Mode Manual Ranging Pasca-Sweep Aktif: Sinyal entry baru ditahan dan false BOS pada M15/M5 diredam di dalam rentang konsolidasi (${boxRangeStr}) hingga terbentuk displacement / MSS yang menembus struktur 1H.`,
    manualOverrideMode: 'POST_SWEEP_RANGING',
    isManualOverride: true,
  };
}

/**
 * Builds the 3-Part Contextual "ANALISIS DESK TRADER SMC (PRO READ)"
 * 1) KONTEKS STRUKTUR
 * 2) SKENARIO POI AKTIF
 * 3) PROYEKSI PERGERAKAN SELANJUTNYA
 */
function buildSmcProDeskRead(params: {
  tradingMode: TradingConfluenceMode;
  htfAnalysis: TimeframeSmcAnalysis | null;
  mtfAnalysis: TimeframeSmcAnalysis | null;
  ltfAnalysis: TimeframeSmcAnalysis | null;
  amdState: AmdStateMachineResult | null;
  livePrice: number | null;
}): SmcProDeskRead {
  const { tradingMode, htfAnalysis, mtfAnalysis, ltfAnalysis, amdState, livePrice } = params;
  const primaryRef = mtfAnalysis || htfAnalysis || ltfAnalysis;
  const anchorHtf = htfAnalysis || primaryRef;
  const triggerLtf = ltfAnalysis || mtfAnalysis || htfAnalysis;

  if (!primaryRef || !anchorHtf) {
    return {
      structureContextTitleId: '1) KONTEKS STRUKTUR',
      structureContextBodyId: 'Menunggu sinkronisasi candlestick multi-timeframe untuk memetakan struktur D1/4H/1H dan batas LH/HL.',
      structureLockBadgeId: 'MENUNGGU DATA',
      activePoiTitleId: '2) SKENARIO POI AKTIF',
      activePoiBodyId: 'Menunggu pemetaan POI Lapis 1 (FVG/OTE 0.57–0.70) dan POI Lapis 2 (Extreme OB).',
      activePoiBadgeId: 'MENUNGGU POI',
      nextProjectionTitleId: '3) PROYEKSI PERGERAKAN SELANJUTNYA',
      nextProjectionBodyId: 'Menunggu pembacaan perilaku sesi AMD (Tokyo, London, New York).',
      nextProjectionBadgeId: 'MENUNGGU SESI',
      nearestBsl: livePrice ?? 0,
      nearestSsl: livePrice ?? 0,
      entryTriggerChecklistId: 'Muat data candlestick XAU/USD terlebih dahulu.',
    };
  }

  // 1) KONTEKS STRUKTUR
  const htfTfLabel = anchorHtf.timeframe.toUpperCase();
  const mtfTfLabel = mtfAnalysis ? mtfAnalysis.timeframe.toUpperCase() : '';
  const ltfTfLabel = triggerLtf ? triggerLtf.timeframe.toUpperCase() : '';

  const lockType = primaryRef.structuralLock.protectedSwingType;
  const lockPrice = primaryRef.structuralLock.protectedSwingPrice;
  const targetPrice = primaryRef.structuralLock.opposingTargetPrice;

  const idmRef = primaryRef.inducement.detected
    ? primaryRef.inducement
    : anchorHtf.inducement.detected
    ? anchorHtf.inducement
    : triggerLtf?.inducement;

  const idmClause =
    idmRef && idmRef.detected && idmRef.price !== null
      ? idmRef.swept
        ? `Inducement (IDM) internal di $${idmRef.price.toFixed(2)} (<50% EQ) telah tersapu.`
        : `Inducement (IDM) internal terdeteksi di $${idmRef.price.toFixed(2)} (<50% EQ, belum tersapu — rawan dijemput lebih dulu).`
      : 'Belum ada jebakan IDM dangkal (<50% EQ) di tengah rentang.';

  const internalBounceClause =
    triggerLtf?.structuralLock.internalBounceFiltered && triggerLtf.structuralLock.internalBounceNoteId
      ? ` ${triggerLtf.structuralLock.internalBounceNoteId}`
      : '';

  const structureLockBadgeId =
    lockType === 'HL'
      ? `TREN BULLISH · KUNCI HL $${lockPrice.toFixed(2)}`
      : lockType === 'LH'
      ? `TREN BEARISH · KUNCI LH $${lockPrice.toFixed(2)}`
      : `RANGING · EQ $${primaryRef.equilibrium.toFixed(2)}`;

  const structureContextBodyId = `Arah struktur ${htfTfLabel}/${mtfTfLabel || ltfTfLabel}: ${
    anchorHtf.structureBias
  } (${anchorHtf.structureSignal}) → ${primaryRef.structureBias} (${
    primaryRef.structureSignal
  }) pada zona ${primaryRef.pdZone} (${primaryRef.positionPct.toFixed(0)}%). ${idmClause} Batas ${
    lockType === 'HL' ? 'Higher Low (HL)' : lockType === 'LH' ? 'Lower High (LH)' : 'Equilibrium'
  } struktural di $${lockPrice.toFixed(
    2
  )} mengunci tren dengan target struktur di $${targetPrice.toFixed(2)}.${internalBounceClause}`;

  // 2) SKENARIO POI AKTIF
  const poi = primaryRef.poiHierarchy;
  const l1 = poi.layer1DecisionalFvgOte;
  const l2 = poi.layer2ExtremeOb;
  const activePoiBadgeId = poi.statusBadgeId;

  const activePoiBodyId =
    poi.reactionStatus === 'FVG_VALID_REVERSAL'
      ? `${poi.reactionEvidenceId} Fokus eksekusi mengikuti pembalikan dari FVG/OTE ($${l1.low.toFixed(
          2
        )}–$${l1.high.toFixed(2)}) tanpa perlu menunggu harga menyentuh Extreme OB ($${l2.low.toFixed(
          2
        )}–$${l2.high.toFixed(2)}).`
      : poi.reactionStatus === 'TARGET_EXTREME_OB'
      ? `${poi.reactionEvidenceId} Jangan tangkap pisau jatuh di FVG yang sudah jebol; tunggu reaksi likuiditas di Extreme OB ($${l2.low.toFixed(
          2
        )}–$${l2.high.toFixed(2)}).`
      : `POI Lapis 1 (FVG + Fibo OTE 0.57–0.70) berada di $${l1.low.toFixed(2)}–$${l1.high.toFixed(
          2
        )}, sedangkan POI Lapis 2 (Extreme OB) berada di $${l2.low.toFixed(2)}–$${l2.high.toFixed(
          2
        )}. ${poi.reactionEvidenceId}`;

  // 3) PROYEKSI PERGERAKAN SELANJUTNYA
  const bsl = amdState?.nearestBslPrice ?? primaryRef.swingHigh;
  const ssl = amdState?.nearestSslPrice ?? primaryRef.swingLow;
  const nextProjectionBadgeId = amdState?.adaptiveRegimeBadgeId || 'PROYEKSI LIKUIDITAS';

  const liquidityTargetClause =
    primaryRef.structureBias === 'BULLISH'
      ? `Target sapuan likuiditas terdekat mengarah ke Buy-Side Liquidity (BSL) $${bsl.toFixed(
          2
        )} (dengan kolam SSL di $${ssl.toFixed(2)} sebagai area waspada sweep).`
      : primaryRef.structureBias === 'BEARISH'
      ? `Target sapuan likuiditas terdekat mengarah ke Sell-Side Liquidity (SSL) $${ssl.toFixed(
          2
        )} (dengan kolam BSL di $${bsl.toFixed(2)} sebagai area waspada sweep).`
      : `Kolam likuiditas mengapit di BSL $${bsl.toFixed(2)} (atas) dan SSL $${ssl.toFixed(2)} (bawah).`;

  const entryTriggerChecklistId =
    amdState?.manualOverrideMode === 'ACCUMULATION'
      ? `Syarat Validasi Entry: Gatekeeper dikunci pada fase Akumulasi (skor ditahan 50%). Tunggu sesi berikutnya melakukan Manipulasi (sweep BSL $${bsl.toFixed(
          2
        )} / SSL $${ssl.toFixed(2)}) sebelum mencari setup entri.`
      : amdState?.manualOverrideMode === 'MANIPULATION'
      ? `Syarat Validasi Entry: Market dalam fase Manipulasi / Stop-Hunt — wajib tunggu konfirmasi penolakan (wick rejection) atau MSS sebelum entri mengikuti arah distribusi.`
      : amdState?.manualOverrideMode === 'POST_SWEEP_RANGING'
      ? `Syarat Validasi Entry: Mode Ranging Pasca-Sweep aktif — tahan sinyal entry baru (redam false BOS di M15/M5) hingga terbentuk displacement / MSS yang menembus struktur 1H.`
      : amdState?.adaptiveRegime === 'SKIP_MANIPULATION_EARLY_DIST'
      ? `Syarat Validasi Entry: Tunggu pullback retest ke FVG/OB sesi berjalan ($${l1.low.toFixed(
          2
        )}–$${l1.high.toFixed(2)}) searah breakout tanpa menembus kembali titik tengah Box AMD.`
      : amdState?.adaptiveRegime === 'DOUBLE_ACCUMULATION'
      ? `Syarat Validasi Entry: Dilarang entry di tengah kompresi ganda; tunggu spike New York menyapu BSL $${bsl.toFixed(
          2
        )} atau SSL $${ssl.toFixed(2)} lalu konfirmasi penutupan candle MSS di ${
          tradingMode === 'SWING' ? 'M15/1H' : 'M5/M15'
        }.`
      : amdState?.adaptiveRegime === 'POST_SWEEP_CONSOLIDATION'
      ? `Syarat Validasi Entry: Tahan posisi selama konsolidasi pasca-sweep; wajib menunggu 1 candle displacement (MSS) menutup keluar dari range konsolidasi.`
      : `Syarat Validasi Entry: Pastikan IDM tersapu + reaksi penolakan valid di ${
          poi.activeTargetLayer === 'LAYER_2_EXTREME_OB'
            ? `Extreme OB ($${l2.low.toFixed(2)}–$${l2.high.toFixed(2)})`
            : `FVG/OTE ($${l1.low.toFixed(2)}–$${l1.high.toFixed(2)})`
        } + konfirmasi MSS searah kunci ${lockType} $${lockPrice.toFixed(2)}.`;

  const nextProjectionBodyId = `${
    amdState ? amdState.nextSessionProjectionId : ''
  } ${liquidityTargetClause} ${entryTriggerChecklistId}`.trim();

  return {
    structureContextTitleId: '1) KONTEKS STRUKTUR',
    structureContextBodyId,
    structureLockBadgeId,
    activePoiTitleId: '2) SKENARIO POI AKTIF (FVG/OTE vs EXTREME OB)',
    activePoiBodyId,
    activePoiBadgeId,
    nextProjectionTitleId: '3) PROYEKSI PERGERAKAN & LIKUIDITAS SELANJUTNYA',
    nextProjectionBodyId,
    nextProjectionBadgeId,
    nearestBsl: bsl,
    nearestSsl: ssl,
    entryTriggerChecklistId,
  };
}

/**
 * Evaluates the Two-Stage SMC Structure Reversal & Narrow Pullback Break:
 * - Intraday (SWING): Uses 1H as the reversal anchor (Stage 1: Body break of 1H LH/HL = MSS Indication -> Stage 2: Body break of Candidate HH/LL = Confirmed CHoCH).
 * - Scalping (SCALP): Uses M15 as the structural & Equilibrium anchor (checks M15 LH/HL body break without waiting for 1H) and M5 as the narrow trigger timeframe (requires M5 candle body close above the last pullback high in Discount, or below the last pullback low in Premium, before validating reversal).
 */
export function evaluateTwoStageStructureValidation(params: {
  tradingMode: TradingConfluenceMode;
  candlesByTf: Record<string, ConfluenceCandle[]>;
  anchorAnalysis: TimeframeSmcAnalysis | null;
  narrowAnalysis: TimeframeSmcAnalysis | null;
  rawMacroBias: MacroBiasDirection;
}): TwoStageStructureValidation {
  const { tradingMode, candlesByTf, anchorAnalysis, narrowAnalysis, rawMacroBias } = params;
  const isScalp = tradingMode === 'SCALP';
  const structureAnchorTf: 'M15' | '1H' = isScalp ? 'M15' : '1H';
  const narrowTriggerTf: 'M5' | '1H' = isScalp ? 'M5' : '1H';

  const anchorCandles = isScalp
    ? candlesByTf['15min'] || candlesByTf['1h'] || []
    : candlesByTf['1h'] || candlesByTf['4h'] || [];
  const narrowCandles = isScalp
    ? candlesByTf['5min'] || candlesByTf['15min'] || anchorCandles
    : candlesByTf['1h'] || anchorCandles;

  const fallbackPrice =
    narrowCandles[narrowCandles.length - 1]?.close ??
    anchorCandles[anchorCandles.length - 1]?.close ??
    anchorAnalysis?.equilibrium ??
    0;

  // 1. Inspect Anchor Timeframe (M15 for Scalp, 1H for Intraday) for LH / HL Body Break -> Candidate HH / LL -> Stage 2 CHoCH
  const anchorRecent = anchorCandles.slice(-60);
  const swingHighs: Array<{ idx: number; price: number }> = [];
  const swingLows: Array<{ idx: number; price: number }> = [];

  for (let i = 2; i < anchorRecent.length - 2; i++) {
    const h = anchorRecent[i].high;
    const l = anchorRecent[i].low;
    if (
      h >= anchorRecent[i - 1].high &&
      h >= anchorRecent[i - 2].high &&
      h >= anchorRecent[i + 1].high &&
      h >= anchorRecent[i + 2].high
    ) {
      swingHighs.push({ idx: i, price: h });
    }
    if (
      l <= anchorRecent[i - 1].low &&
      l <= anchorRecent[i - 2].low &&
      l <= anchorRecent[i + 1].low &&
      l <= anchorRecent[i + 2].low
    ) {
      swingLows.push({ idx: i, price: l });
    }
  }

  const refLhObj = swingHighs[swingHighs.length - 1] || {
    idx: Math.max(0, anchorRecent.length - 10),
    price: anchorAnalysis?.swingHigh || fallbackPrice,
  };
  const refHlObj = swingLows[swingLows.length - 1] || {
    idx: Math.max(0, anchorRecent.length - 10),
    price: anchorAnalysis?.swingLow || fallbackPrice,
  };

  const referenceLhPrice = Number(refLhObj.price.toFixed(2));
  const referenceHlPrice = Number(refHlObj.price.toFixed(2));

  let anchorLhBrokenByBody = false;
  let lhBreakIdx = -1;
  for (let i = refLhObj.idx + 1; i < anchorRecent.length; i++) {
    if (anchorRecent[i].close > referenceLhPrice) {
      anchorLhBrokenByBody = true;
      lhBreakIdx = i;
      break;
    }
  }

  let anchorHlBrokenByBody = false;
  let hlBreakIdx = -1;
  for (let i = refHlObj.idx + 1; i < anchorRecent.length; i++) {
    if (anchorRecent[i].close < referenceHlPrice) {
      anchorHlBrokenByBody = true;
      hlBreakIdx = i;
      break;
    }
  }

  // Stage 2 check: After breaking LH by body, price forms Candidate HH, pulls back, and breaks Candidate HH by body
  let candidateHhPrice: number | null = null;
  let stage2ChochBullConfirmed = false;
  if (anchorLhBrokenByBody && lhBreakIdx >= 0) {
    let peakVal = anchorRecent[lhBreakIdx].high;
    let peakIdx = lhBreakIdx;
    for (let i = lhBreakIdx; i < anchorRecent.length; i++) {
      if (anchorRecent[i].high >= peakVal) {
        peakVal = anchorRecent[i].high;
        peakIdx = i;
      }
      // Once a pullback candle occurs after the initial breakout bar, lock the first Candidate HH
      if (i > lhBreakIdx && anchorRecent[i].close < anchorRecent[i].open) {
        break;
      }
    }
    candidateHhPrice = Number(peakVal.toFixed(2));
    for (let j = peakIdx + 1; j < anchorRecent.length; j++) {
      if (anchorRecent[j].close > candidateHhPrice) {
        stage2ChochBullConfirmed = true;
        break;
      }
    }
  }

  let candidateLlPrice: number | null = null;
  let stage2ChochBearConfirmed = false;
  if (anchorHlBrokenByBody && hlBreakIdx >= 0) {
    let troughVal = anchorRecent[hlBreakIdx].low;
    let troughIdx = hlBreakIdx;
    for (let i = hlBreakIdx; i < anchorRecent.length; i++) {
      if (anchorRecent[i].low <= troughVal) {
        troughVal = anchorRecent[i].low;
        troughIdx = i;
      }
      if (i > hlBreakIdx && anchorRecent[i].close > anchorRecent[i].open) {
        break;
      }
    }
    candidateLlPrice = Number(troughVal.toFixed(2));
    for (let j = troughIdx + 1; j < anchorRecent.length; j++) {
      if (anchorRecent[j].close < candidateLlPrice) {
        stage2ChochBearConfirmed = true;
        break;
      }
    }
  }

  // 2. Inspect Narrow Trigger Timeframe (M5 for Scalp, 1H for Intraday) for Pullback Candle Body Break (CHoCH / MSS)
  const narrowSlice = narrowCandles.slice(-30);
  let lowestIdx = 0;
  let highestIdx = 0;
  for (let i = 0; i < narrowSlice.length; i++) {
    if (narrowSlice[i].low <= narrowSlice[lowestIdx].low) lowestIdx = i;
    if (narrowSlice[i].high >= narrowSlice[highestIdx].high) highestIdx = i;
  }

  // Find the last pullback high strictly BEFORE the lowest drop (the minor LH that buyers must break by body close)
  const preLowStart = Math.max(1, lowestIdx - 10);
  const preLowEnd = lowestIdx - 1;
  let pullbackHighVal =
    preLowEnd >= 0
      ? narrowSlice[preLowEnd].high
      : narrowSlice[lowestIdx]?.high ?? fallbackPrice;
  for (let i = preLowStart; i <= preLowEnd; i++) {
    const c = narrowSlice[i];
    const prev = narrowSlice[i - 1];
    if (c.close > c.open || c.high > prev.high) {
      pullbackHighVal = c.high;
    }
  }
  const narrowPullbackHighToBreak = Number(pullbackHighVal.toFixed(2));

  // Find the last pullback low strictly BEFORE the highest rally (the minor HL that sellers must break by body close)
  const preHighStart = Math.max(1, highestIdx - 10);
  const preHighEnd = highestIdx - 1;
  let pullbackLowVal =
    preHighEnd >= 0
      ? narrowSlice[preHighEnd].low
      : narrowSlice[highestIdx]?.low ?? fallbackPrice;
  for (let i = preHighStart; i <= preHighEnd; i++) {
    const c = narrowSlice[i];
    const prev = narrowSlice[i - 1];
    if (c.close < c.open || c.low < prev.low) {
      pullbackLowVal = c.low;
    }
  }
  const narrowPullbackLowToBreak = Number(pullbackLowVal.toFixed(2));

  const postLowBars = lowestIdx >= 0 ? narrowSlice.slice(lowestIdx + 1) : [];
  const brokePullbackHighByBody = postLowBars.some((b) => b.close > narrowPullbackHighToBreak);
  const postHighBars = highestIdx >= 0 ? narrowSlice.slice(highestIdx + 1) : [];
  const brokePullbackLowByBody = postHighBars.some((b) => b.close < narrowPullbackLowToBreak);

  const narrowBullishChochValid =
    brokePullbackHighByBody ||
    narrowAnalysis?.structureSignal === 'CHOCH_BULL' ||
    narrowAnalysis?.structureSignal === 'BOS_BULL';

  const narrowBearishChochValid =
    brokePullbackLowByBody ||
    narrowAnalysis?.structureSignal === 'CHOCH_BEAR' ||
    narrowAnalysis?.structureSignal === 'BOS_BEAR';

  const anchorTrend = anchorAnalysis?.structureBias || 'NEUTRAL';
  const pdZone = anchorAnalysis?.pdZone || 'EQUILIBRIUM';

  // Impulsive Momentum Check: Price in Discount but still dropping without narrow M5/1H CHoCH, or in Premium rallying without CHoCH
  const isImpulsiveDropWithoutChoch =
    pdZone === 'DISCOUNT' && !narrowBullishChochValid && anchorTrend !== 'BULLISH';
  const isImpulsiveRallyWithoutChoch =
    pdZone === 'PREMIUM' && !narrowBearishChochValid && anchorTrend !== 'BEARISH';

  const rawMacroValidatedByChart =
    rawMacroBias === 'BUY'
      ? anchorTrend === 'BULLISH' || anchorLhBrokenByBody || narrowBullishChochValid
      : rawMacroBias === 'SELL'
      ? anchorTrend === 'BEARISH' || anchorHlBrokenByBody || narrowBearishChochValid
      : true;

  let statusBadgeId = '';
  let statusBadgeEn = '';
  let summaryId = '';
  let summaryEn = '';

  if (isImpulsiveDropWithoutChoch) {
    statusBadgeId = `HARGA DI DISCOUNT · BELUM ADA CHoCH ${narrowTriggerTf} (MASIH IMPULSIF TURUN)`;
    statusBadgeEn = `IN DISCOUNT · NO ${narrowTriggerTf} CHoCH YET (IMPULSIVE DROP)`;
    summaryId = `Waspada Pisau Jatuh: Walaupun harga sudah di zona Discount (${anchorAnalysis?.positionPct.toFixed(0)}%), struktur ${structureAnchorTf} masih Bearish (LH $${referenceLhPrice.toFixed(1)} belum dijebol body) dan candle ${narrowTriggerTf} belum menembus puncak pullback terakhir ($${narrowPullbackHighToBreak.toFixed(1)}). Jangan langsung Buy sebelum ${narrowTriggerTf} close body di atas $${narrowPullbackHighToBreak.toFixed(1)}.`;
    summaryEn = `Falling Knife Warning: Although price is in Discount (${anchorAnalysis?.positionPct.toFixed(0)}%), ${structureAnchorTf} structure remains Bearish (LH $${referenceLhPrice.toFixed(1)} unbroken) and ${narrowTriggerTf} has not closed above the last pullback high ($${narrowPullbackHighToBreak.toFixed(1)}). Wait for ${narrowTriggerTf} CHoCH above $${narrowPullbackHighToBreak.toFixed(1)} before buying.`;
  } else if (isImpulsiveRallyWithoutChoch) {
    statusBadgeId = `HARGA DI PREMIUM · BELUM ADA CHoCH ${narrowTriggerTf} (MASIH IMPULSIF NAIK)`;
    statusBadgeEn = `IN PREMIUM · NO ${narrowTriggerTf} CHoCH YET (IMPULSIVE RALLY)`;
    summaryId = `Waspada Momentum Naik: Walaupun harga sudah di zona Premium (${anchorAnalysis?.positionPct.toFixed(0)}%), struktur ${structureAnchorTf} masih Bullish (HL $${referenceHlPrice.toFixed(1)} belum dijebol body) dan candle ${narrowTriggerTf} belum menembus dasar pullback terakhir ($${narrowPullbackLowToBreak.toFixed(1)}). Jangan langsung Sell sebelum ${narrowTriggerTf} close body di bawah $${narrowPullbackLowToBreak.toFixed(1)}.`;
    summaryEn = `Impulsive Rally Warning: Although price is in Premium (${anchorAnalysis?.positionPct.toFixed(0)}%), ${structureAnchorTf} structure remains Bullish (HL $${referenceHlPrice.toFixed(1)} unbroken) and ${narrowTriggerTf} has not closed below the last pullback low ($${narrowPullbackLowToBreak.toFixed(1)}). Wait for ${narrowTriggerTf} CHoCH below $${narrowPullbackLowToBreak.toFixed(1)} before selling.`;
  } else if (stage2ChochBullConfirmed || (anchorLhBrokenByBody && narrowBullishChochValid)) {
    statusBadgeId = `REVERSAL BULLISH VALID · ${structureAnchorTf} LH BREAK + ${narrowTriggerTf} CHoCH SAH`;
    statusBadgeEn = `VALID BULLISH REVERSAL · ${structureAnchorTf} LH BREAK + ${narrowTriggerTf} CHoCH`;
    summaryId = `Pembuktian Market Sah: Patokan LH ${structureAnchorTf} ($${referenceLhPrice.toFixed(1)}) dan puncak pullback ${narrowTriggerTf} ($${narrowPullbackHighToBreak.toFixed(1)}) telah dijebol secara body${candidateHhPrice ? ` (Calon HH $${candidateHhPrice.toFixed(1)})` : ''}. Buyer terbukti masuk — cari setup Buy Limit di Order Block Sehat (OB + FVG + Anti-Sweep).`;
    summaryEn = `Market Proof Confirmed: ${structureAnchorTf} LH ($${referenceLhPrice.toFixed(1)}) and ${narrowTriggerTf} pullback high ($${narrowPullbackHighToBreak.toFixed(1)}) broken by candle body. Buyers stepped in — look for Buy Limit in Healthy OB (OB + FVG + Anti-Sweep).`;
  } else if (stage2ChochBearConfirmed || (anchorHlBrokenByBody && narrowBearishChochValid)) {
    statusBadgeId = `REVERSAL BEARISH VALID · ${structureAnchorTf} HL BREAK + ${narrowTriggerTf} CHoCH SAH`;
    statusBadgeEn = `VALID BEARISH REVERSAL · ${structureAnchorTf} HL BREAK + ${narrowTriggerTf} CHoCH`;
    summaryId = `Pembuktian Market Sah: Patokan HL ${structureAnchorTf} ($${referenceHlPrice.toFixed(1)}) dan dasar pullback ${narrowTriggerTf} ($${narrowPullbackLowToBreak.toFixed(1)}) telah dijebol secara body${candidateLlPrice ? ` (Calon LL $${candidateLlPrice.toFixed(1)})` : ''}. Seller terbukti masuk — cari setup Sell Limit di Order Block Sehat (OB + FVG + Anti-Sweep).`;
    summaryEn = `Market Proof Confirmed: ${structureAnchorTf} HL ($${referenceHlPrice.toFixed(1)}) and ${narrowTriggerTf} pullback low ($${narrowPullbackLowToBreak.toFixed(1)}) broken by candle body. Sellers stepped in — look for Sell Limit in Healthy OB (OB + FVG + Anti-Sweep).`;
  } else if (narrowBullishChochValid && anchorTrend === 'BEARISH') {
    statusBadgeId = `INDIKASI AWAL REVERSAL · ${narrowTriggerTf} MSS NAIK (PANTAU LH ${structureAnchorTf} $${referenceLhPrice.toFixed(1)})`;
    statusBadgeEn = `EARLY REVERSAL INDICATION · ${narrowTriggerTf} BULL MSS (WATCH ${structureAnchorTf} LH $${referenceLhPrice.toFixed(1)})`;
    summaryId = `Indikasi Awal (Belum 100%): Candle ${narrowTriggerTf} sudah menembus pullback ($${narrowPullbackHighToBreak.toFixed(1)}), namun patokan LH ${structureAnchorTf} di $${referenceLhPrice.toFixed(1)} belum dijebol body. Hanya ambil Buy di OB Sehat (OB + FVG + Wick Tidak Termitigasi).`;
    summaryEn = `Early Indication: ${narrowTriggerTf} broke pullback ($${narrowPullbackHighToBreak.toFixed(1)}), but ${structureAnchorTf} LH at $${referenceLhPrice.toFixed(1)} is not broken by body yet. Only take Buy on a Healthy OB (OB + FVG + Unmitigated Wick).`;
  } else if (narrowBearishChochValid && anchorTrend === 'BULLISH') {
    statusBadgeId = `INDIKASI AWAL REVERSAL · ${narrowTriggerTf} MSS TURUN (PANTAU HL ${structureAnchorTf} $${referenceHlPrice.toFixed(1)})`;
    statusBadgeEn = `EARLY REVERSAL INDICATION · ${narrowTriggerTf} BEAR MSS (WATCH ${structureAnchorTf} HL $${referenceHlPrice.toFixed(1)})`;
    summaryId = `Indikasi Awal (Belum 100%): Candle ${narrowTriggerTf} sudah menembus pullback ($${narrowPullbackLowToBreak.toFixed(1)}), namun patokan HL ${structureAnchorTf} di $${referenceHlPrice.toFixed(1)} belum dijebol body. Hanya ambil Sell di OB Sehat (OB + FVG + Wick Tidak Termitigasi).`;
    summaryEn = `Early Indication: ${narrowTriggerTf} broke pullback ($${narrowPullbackLowToBreak.toFixed(1)}), but ${structureAnchorTf} HL at $${referenceHlPrice.toFixed(1)} is not broken by body yet. Only take Sell on a Healthy OB (OB + FVG + Unmitigated Wick).`;
  } else {
    statusBadgeId = `STRUKTUR ${structureAnchorTf} ${anchorTrend} · PATOKAN LH $${referenceLhPrice.toFixed(1)} / HL $${referenceHlPrice.toFixed(1)}`;
    statusBadgeEn = `${structureAnchorTf} STRUCTURE ${anchorTrend} · LH $${referenceLhPrice.toFixed(1)} / HL $${referenceHlPrice.toFixed(1)}`;
    summaryId = `Struktur patokan ${structureAnchorTf} berada di rentang HL $${referenceHlPrice.toFixed(1)} – LH $${referenceLhPrice.toFixed(1)}. Konfirmasi patah struktur ${narrowTriggerTf} memantau batas pullback Buy $${narrowPullbackHighToBreak.toFixed(1)} dan Sell $${narrowPullbackLowToBreak.toFixed(1)}.`;
    summaryEn = `${structureAnchorTf} structure holds between HL $${referenceHlPrice.toFixed(1)} – LH $${referenceLhPrice.toFixed(1)}. ${narrowTriggerTf} pullback triggers sit at Buy $${narrowPullbackHighToBreak.toFixed(1)} and Sell $${narrowPullbackLowToBreak.toFixed(1)}.`;
  }

  const stage: TwoStageStructureValidation['stage'] =
    stage2ChochBullConfirmed || (anchorLhBrokenByBody && narrowBullishChochValid)
      ? 'STAGE_2_CHOCH_BULLISH'
      : stage2ChochBearConfirmed || (anchorHlBrokenByBody && narrowBearishChochValid)
      ? 'STAGE_2_CHOCH_BEARISH'
      : isImpulsiveDropWithoutChoch || isImpulsiveRallyWithoutChoch
      ? 'IMPULSIVE_WAIT_CHOCH'
      : narrowBullishChochValid || anchorLhBrokenByBody
      ? 'STAGE_1_MSS_BULLISH'
      : narrowBearishChochValid || anchorHlBrokenByBody
      ? 'STAGE_1_MSS_BEARISH'
      : 'TREND_CONTINUATION';

  const stage2ChochConfirmed =
    stage2ChochBullConfirmed ||
    stage2ChochBearConfirmed ||
    (anchorLhBrokenByBody && narrowBullishChochValid) ||
    (anchorHlBrokenByBody && narrowBearishChochValid);

  const narrowPullbackChochConfirmed =
    narrowBullishChochValid || narrowBearishChochValid;

  const isImpulsiveMomentumWithoutChoch =
    isImpulsiveDropWithoutChoch || isImpulsiveRallyWithoutChoch;

  const narrowPullbackBreakPrice =
    anchorTrend === 'BEARISH' || isImpulsiveDropWithoutChoch
      ? narrowPullbackHighToBreak > 0
        ? narrowPullbackHighToBreak
        : null
      : narrowPullbackLowToBreak > 0
      ? narrowPullbackLowToBreak
      : narrowPullbackHighToBreak > 0
      ? narrowPullbackHighToBreak
      : null;

  return {
    tradingMode,
    structureAnchorTf,
    structureAnchorTfLabel: structureAnchorTf,
    narrowTriggerTf,
    narrowTriggerTfLabel: narrowTriggerTf,
    anchorTrend,
    referenceLhPrice,
    referenceHlPrice,
    anchorLhBrokenByBody,
    anchorHlBrokenByBody,
    candidateHhPrice,
    candidateLlPrice,
    stage,
    stage2ChochBullConfirmed,
    stage2ChochBearConfirmed,
    stage2ChochConfirmed,
    narrowPullbackHighToBreak,
    narrowPullbackLowToBreak,
    narrowPullbackBreakPrice,
    narrowBullishChochValid,
    narrowBearishChochValid,
    narrowPullbackChochConfirmed,
    isImpulsiveDropWithoutChoch,
    isImpulsiveRallyWithoutChoch,
    isImpulsiveMomentumWithoutChoch,
    rawMacroValidatedByChart,
    statusBadgeId,
    statusBadgeEn,
    summaryId,
    summaryEn,
    detailNarrativeId: summaryId,
    detailNarrativeEn: summaryEn,
  };
}

/**
 * 4. Master Probability Scorer
 */
export function evaluateConfluenceMaster(params: {
  viewMode: ConfluenceViewMode;
  tradingMode: TradingConfluenceMode;
  livePrice: number | null;
  macroBias: MacroBiasDirection;
  candlesByTf: Record<string, ConfluenceCandle[]>;
  referenceDate?: Date;
  sessionConfig?: SessionHoursWibConfig;
  manualAmdOverride?: ManualAmdOverrideMode;
  rawMacroContext?: RawMacroConfluenceContext;
}): ConfluenceMasterResult {
  const {
    viewMode,
    tradingMode,
    livePrice,
    macroBias,
    candlesByTf,
    referenceDate = new Date(),
    sessionConfig = DEFAULT_SESSION_HOURS_WIB,
    manualAmdOverride = 'AUTO',
    rawMacroContext,
  } = params;

  const resolvedRawMacroContext: RawMacroConfluenceContext = rawMacroContext || {
    fundamentalBias: macroBias,
    fundamentalSpeechHeadline:
      macroBias === 'BUY'
        ? 'Fundamental USD Dovish / Bullish Gold'
        : macroBias === 'SELL'
        ? 'Fundamental USD Hawkish / Bearish Gold'
        : 'Fundamental & Speech Netral / Menunggu Rilis',
    dxyPrice: null,
    dxyChangePct: null,
    oilPrice: null,
    oilChangePct: null,
    us10yPrice: null,
    us10yChangePct: null,
    us02yPrice: null,
    us02yChangePct: null,
    intermarketEffectOnGold:
      macroBias === 'BUY'
        ? 'BULLISH_GOLD'
        : macroBias === 'SELL'
        ? 'BEARISH_GOLD'
        : 'NEUTRAL',
    rawMacroBias: macroBias,
    combinedRawBias: macroBias,
    rawMacroScore: macroBias === 'BUY' ? 78 : macroBias === 'SELL' ? 22 : 50,
    rawMacroSummaryId: `Data Mentah Fundamental & Intermarket: ${macroBias} (Wajib validasi struktur chart).`,
    rawMacroSummaryEn: `Raw Fundamental & Intermarket Data: ${macroBias} (Requires chart structure validation).`,
  };

  const seasonality = computeMonthlySeasonalityStats(
    XAUUSD_SEASONALITY.currentTargetMonthIndex,
    livePrice
  );
  const astronacci = calculateAstronacciCycle(referenceDate);

  const basicRawScore = 0.60 * seasonality.winRatePct + 0.40 * astronacci.astroScore;
  const basicScore = Number(clamp(basicRawScore, 5, 95).toFixed(1));

  // Analyze 1H first
  const oneHourAnalysis = analyzeTimeframeSmc(candlesByTf['1h'] || [], '1h');

  // IMPORTANT SMC RULE:
  // - In SWING (Intraday D1 • 4H • 1H): 1H is the structure reversal anchor.
  // - In SCALP (Scalping 1H • M15 • M5): Do NOT wait for 1H LH/HL to break! M15 is the structure & Equilibrium anchor, and M5 is the narrow MSS/CHoCH trigger.
  const tfs = tradingMode === 'SWING' ? ['1day', '4h', '1h'] : ['1h', '15min', '5min'];
  const smcByTimeframe: Record<string, TimeframeSmcAnalysis> = {};
  for (const tf of tfs) {
    if (tf === '1h') {
      smcByTimeframe[tf] = oneHourAnalysis;
    } else if (tf === '15min' || tf === '5min') {
      // In SCALP mode, analyze M15 and M5 independently so M15 LH/HL breaks and M5 pullback breaks are detected in real time without being blocked by 1H
      const baseLtf = analyzeTimeframeSmc(candlesByTf[tf] || [], tf);
      if (manualAmdOverride === 'POST_SWEEP_RANGING' && baseLtf.structureSignal !== 'RANGE') {
        const tfCandles = candlesByTf[tf] || [];
        const lastClose = tfCandles[tfCandles.length - 1]?.close ?? 0;
        const m15Ref = smcByTimeframe['15min'] || oneHourAnalysis;
        const brokeStructure =
          (m15Ref.swingHigh > 0 && lastClose > m15Ref.swingHigh) ||
          (m15Ref.swingLow > 0 && lastClose < m15Ref.swingLow);

        if (!brokeStructure) {
          smcByTimeframe[tf] = {
            ...baseLtf,
            structureSignal: 'RANGE',
            structuralLock: {
              ...baseLtf.structuralLock,
              internalBounceFiltered: true,
              internalBounceNoteId: `Mode Ranging Pasca-Sweep aktif — sinyal ${baseLtf.structureSignal} pada ${tf.toUpperCase()} diredam hingga terbentuk displacement/MSS.`,
            },
            summaryId: `RANGE (Redam False BOS · Tunggu MSS) · ${baseLtf.pdZone} (${baseLtf.positionPct.toFixed(0)}%)`,
          };
          continue;
        }
      }
      smcByTimeframe[tf] = baseLtf;
    } else {
      smcByTimeframe[tf] = analyzeTimeframeSmc(candlesByTf[tf] || [], tf);
    }
  }

  const htfAnalysis = smcByTimeframe[tfs[0]] || null;
  const mtfAnalysis = smcByTimeframe[tfs[1]] || null;
  const ltfAnalysis = smcByTimeframe[tfs[2]] || null;

  const effectiveRawMacroBias: MacroBiasDirection =
    resolvedRawMacroContext.combinedRawBias ||
    resolvedRawMacroContext.rawMacroBias ||
    macroBias;

  // Evaluate Two-Stage Structure & Narrow Pullback Break (M15 + M5 in Scalp; 1H in Intraday)
  const twoStageValidation = evaluateTwoStageStructureValidation({
    tradingMode,
    candlesByTf,
    anchorAnalysis: tradingMode === 'SCALP' ? mtfAnalysis : ltfAnalysis,
    narrowAnalysis: ltfAnalysis,
    rawMacroBias: effectiveRawMacroBias,
  });

  // Weight SMC composite score according to mode:
  // - SCALP: M15 (Structure + EQ Anchor) 45% + M5 (Narrow MSS/CHoCH Trigger) 35% + 1H 20%
  // - SWING: 1H (Reversal Anchor) 40% + 4H 35% + D1 25%
  const htfScore = htfAnalysis?.score ?? 50;
  const mtfScore = mtfAnalysis?.score ?? 50;
  const ltfScore = ltfAnalysis?.score ?? 50;
  let smcCompositeScore =
    tradingMode === 'SCALP'
      ? Number((0.20 * htfScore + 0.45 * mtfScore + 0.35 * ltfScore).toFixed(1))
      : Number((0.25 * htfScore + 0.35 * mtfScore + 0.40 * ltfScore).toFixed(1));

  // Enforce Anti-Falling-Knife / Anti-Impulsive-Rally rule on SMC Composite Score:
  // If price is in Discount but still dropping impulsively without M5/1H CHoCH, keep score Bearish (< 45)
  if (twoStageValidation.isImpulsiveDropWithoutChoch) {
    smcCompositeScore = Math.min(smcCompositeScore, 36);
  } else if (twoStageValidation.isImpulsiveRallyWithoutChoch) {
    smcCompositeScore = Math.max(smcCompositeScore, 64);
  }

  // Raw Macro Score (Step 1 Fundamental + Step 2 Intermarket DXY/OIL/US10Y/US02Y):
  // Remember: Raw Macro is NOT 100% until validated by Market Structure!
  // If Raw Macro says BUY, but chart is dropping impulsively without CHoCH, dampen raw macro to 50 until chart prints MSS/CHoCH.
  const rawMacroBaseScore =
    effectiveRawMacroBias === 'BUY' ? 85 : effectiveRawMacroBias === 'SELL' ? 15 : 50;
  const macroNewsScore = twoStageValidation.rawMacroValidatedByChart
    ? rawMacroBaseScore
    : 50 + (rawMacroBaseScore - 50) * 0.25;

  const execTf = tradingMode === 'SWING' ? '1h' : '15min';
  const execCandles =
    candlesByTf[execTf] && candlesByTf[execTf].length >= 16
      ? candlesByTf[execTf]
      : candlesByTf[tfs[2]] || candlesByTf[tfs[1]] || candlesByTf[tfs[0]] || [];

  const amdState =
    viewMode === 'FULL'
      ? evaluateRollingAmdStateMachine(
          execCandles,
          effectiveRawMacroBias,
          sessionConfig,
          (tradingMode === 'SCALP' ? mtfAnalysis?.structureBias : ltfAnalysis?.structureBias) ||
            htfAnalysis?.structureBias ||
            'NEUTRAL',
          manualAmdOverride
        )
      : null;

  const proDeskRead = buildSmcProDeskRead({
    tradingMode,
    htfAnalysis,
    mtfAnalysis,
    ltfAnalysis,
    amdState,
    livePrice,
  });

  if (viewMode === 'BASIC') {
    const uptrendPct = clamp(Math.round(basicScore), 5, 95);
    const downtrendPct = 100 - uptrendPct;
    const dominantDirection: ConfluenceMasterResult['dominantDirection'] =
      uptrendPct >= 56 ? 'BULLISH' : uptrendPct <= 44 ? 'BEARISH' : 'NETRAL';

    return {
      viewMode,
      tradingMode,
      uptrendPct,
      downtrendPct,
      dominantDirection,
      rawScoreBeforeGatekeeper: basicScore,
      seasonality,
      astronacci,
      smcByTimeframe,
      htfAnalysis,
      mtfAnalysis,
      ltfAnalysis,
      smcCompositeScore,
      macroNewsScore,
      amdState: null,
      proDeskRead,
      rawMacroContext: resolvedRawMacroContext,
      twoStageValidation,
      weightsBreakdown: [
        { labelId: 'Seasonality Bulanan (60%)', pct: 60, score: seasonality.winRatePct },
        { labelId: 'Siklus Astronacci (40%)', pct: 40, score: astronacci.astroScore },
      ],
      guidanceId: seasonality.isOverextended
        ? `Peringatan Overextended: Pergerakan bulanan (${seasonality.liveMomPct > 0 ? '+' : ''}${seasonality.liveMomPct}%) melebihi ±8.0%. Waspadai mean-reversion sebelum mengejar tren.`
        : `Mode Dasar aktif: Menggabungkan Win-Rate Hijau ${seasonality.monthFullName} (${seasonality.winRatePct}%) dan fase ${astronacci.lunarPhaseLabelId}.`,
    };
  }

  const rawConfluence =
    0.55 * smcCompositeScore + 0.30 * macroNewsScore + 0.15 * basicScore;
  const rawScoreBeforeGatekeeper = Number(clamp(rawConfluence, 5, 95).toFixed(1));

  // If Manual AMD Override is 'ACCUMULATION', hold probability score to neutral 50%
  // If Manual AMD Override is 'DISTRIBUTION', open Gatekeeper and let full SMC confluence run
  const effectiveDampening = amdState ? amdState.dampeningFactor : 1;
  let dampenedScore =
    manualAmdOverride === 'ACCUMULATION'
      ? 50
      : 50 + (rawScoreBeforeGatekeeper - 50) * effectiveDampening;

  // Hard Structural Safeguard: Never output Bullish (>=56%) if price is in an impulsive bearish drop without M5/1H CHoCH
  if (twoStageValidation.isImpulsiveDropWithoutChoch && dampenedScore > 44) {
    dampenedScore = 41;
  } else if (twoStageValidation.isImpulsiveRallyWithoutChoch && dampenedScore < 56) {
    dampenedScore = 59;
  }

  const uptrendPct = clamp(Math.round(dampenedScore), 5, 95);
  const downtrendPct = 100 - uptrendPct;
  const dominantDirection: ConfluenceMasterResult['dominantDirection'] =
    uptrendPct >= 55 ? 'BULLISH' : uptrendPct <= 45 ? 'BEARISH' : 'NETRAL';

  const guidanceId = `${twoStageValidation.summaryId} ${proDeskRead.entryTriggerChecklistId}`.trim();

  return {
    viewMode,
    tradingMode,
    uptrendPct,
    downtrendPct,
    dominantDirection,
    rawScoreBeforeGatekeeper,
    seasonality,
    astronacci,
    smcByTimeframe,
    htfAnalysis,
    mtfAnalysis,
    ltfAnalysis,
    smcCompositeScore,
    macroNewsScore: Number(macroNewsScore.toFixed(1)),
    amdState,
    proDeskRead,
    rawMacroContext: resolvedRawMacroContext,
    twoStageValidation,
    weightsBreakdown: [
      { labelId: `Struktur SMC ${twoStageValidation.structureAnchorTf}/${twoStageValidation.narrowTriggerTf} (55%)`, pct: 55, score: smcCompositeScore },
      {
        labelId: `Data Mentah Fundamental & DXY/OIL/Yield · ${effectiveRawMacroBias}${
          twoStageValidation.rawMacroValidatedByChart ? ' [Valid]' : ' [Belum CHoCH]'
        } (30%)`,
        pct: 30,
        score: Number(macroNewsScore.toFixed(1)),
      },
      { labelId: 'Seasonality & Astro (15%)', pct: 15, score: basicScore },
    ],
    guidanceId,
  };
}

export interface SessionSegmentLiquidity {
  session: TradingSessionName;
  startIdx: number;
  endIdx: number;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  candles: ConfluenceCandle[];
  highSweptAfter: boolean;
  lowSweptAfter: boolean;
}

export interface SessionLiquidityResult {
  activeSessionSegment: SessionSegmentLiquidity;
  previousSessionSegment: SessionSegmentLiquidity;
  segments: SessionSegmentLiquidity[];
  referenceBox: AmdBox;
  referenceBoxEndIdx: number;
  bslPrice: number;
  sslPrice: number;
  bslSourceSession: TradingSessionName;
  sslSourceSession: TradingSessionName;
}

/**
 * Single Source of Truth for Session BSL / SSL:
 * Partitions chronological candles using the exact Cycle & Confluence / Rolling AMD session clock
 * (Tokyo 21:00–06:00 UTC / 04:00–13:00 WIB, London 06:00–11:00 UTC / 13:00–18:00 WIB,
 * New York 11:00–21:00 UTC / 18:00–04:00 WIB, or user-configured WIB hours).
 * - BSL Sesi = Highest High of the active/previous session that has NOT been swept.
 * - SSL Sesi = Lowest Low of the active/previous session that has NOT been swept.
 */
export function computeSessionLiquidityFromCandles(
  candles: ConfluenceCandle[],
  sessionConfig: SessionHoursWibConfig = DEFAULT_SESSION_HOURS_WIB,
  atr14Override?: number
): SessionLiquidityResult {
  const atr14 = atr14Override !== undefined ? atr14Override : computeAtr14(candles);
  if (!Array.isArray(candles) || candles.length === 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const session = getSessionWIB(nowSec, sessionConfig);
    const emptySeg: SessionSegmentLiquidity = {
      session,
      startIdx: 0,
      endIdx: 0,
      startTime: nowSec,
      endTime: nowSec,
      high: 0,
      low: 0,
      candles: [],
      highSweptAfter: false,
      lowSweptAfter: false,
    };
    return {
      activeSessionSegment: emptySeg,
      previousSessionSegment: emptySeg,
      segments: [emptySeg],
      referenceBox: {
        high: 0,
        low: 0,
        session,
        startTime: nowSec,
        endTime: nowSec,
        isCompressed: true,
      },
      referenceBoxEndIdx: 0,
      bslPrice: 0,
      sslPrice: 0,
      bslSourceSession: session,
      sslSourceSession: session,
    };
  }

  const rawSegments: Array<{
    session: TradingSessionName;
    startIdx: number;
    endIdx: number;
    candles: ConfluenceCandle[];
  }> = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const sess = getSessionWIB(c.time, sessionConfig);
    const prev = rawSegments[rawSegments.length - 1];
    // Start a new segment if session changes or if time gap exceeds 10 hours
    if (!prev || prev.session !== sess || c.time - prev.candles[prev.candles.length - 1].time > 36000) {
      rawSegments.push({
        session: sess,
        startIdx: i,
        endIdx: i,
        candles: [c],
      });
    } else {
      prev.endIdx = i;
      prev.candles.push(c);
    }
  }

  const segments: SessionSegmentLiquidity[] = rawSegments.map((seg, idx) => {
    const high = Math.max(...seg.candles.map((c) => c.high));
    const low = Math.min(...seg.candles.map((c) => c.low));
    const isLastSeg = idx === rawSegments.length - 1;
    const subsequentCandles = isLastSeg ? [] : candles.slice(seg.endIdx + 1);
    const highSweptAfter = subsequentCandles.some((c) => c.high > high);
    const lowSweptAfter = subsequentCandles.some((c) => c.low < low);

    return {
      session: seg.session,
      startIdx: seg.startIdx,
      endIdx: seg.endIdx,
      startTime: seg.candles[0].time,
      endTime: seg.candles[seg.candles.length - 1].time,
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      candles: seg.candles,
      highSweptAfter,
      lowSweptAfter,
    };
  });

  const activeSeg = segments[segments.length - 1];
  const prevSeg = segments.length >= 2 ? segments[segments.length - 2] : activeSeg;

  // Determine BSL Sesi = Highest High of active or previous unswept session (last 3 sessions: Tokyo/London/NY cycle)
  const recentCandidateSegments = segments.slice(-3);
  let bslPrice = activeSeg.high;
  let bslSourceSession = activeSeg.session;

  for (const seg of recentCandidateSegments) {
    const isActive = seg === activeSeg;
    if ((isActive || !seg.highSweptAfter) && seg.high >= bslPrice) {
      bslPrice = seg.high;
      bslSourceSession = seg.session;
    }
  }

  // Determine SSL Sesi = Lowest Low of active or previous unswept session (last 3 sessions: Tokyo/London/NY cycle)
  let sslPrice = activeSeg.low;
  let sslSourceSession = activeSeg.session;

  for (const seg of recentCandidateSegments) {
    const isActive = seg === activeSeg;
    if ((isActive || !seg.lowSweptAfter) && seg.low <= sslPrice) {
      sslPrice = seg.low;
      sslSourceSession = seg.session;
    }
  }

  // Reference Box for AMD manipulation evaluation:
  // When active session is underway and previous session exists, evaluate active session candles against previous session's box
  // unless active session already has >= 6 bars of internal compression.
  let refSeg = prevSeg;
  let refBoxEndIdx = prevSeg.endIdx;

  if (segments.length === 1) {
    const splitIdx = Math.max(1, candles.length - 3);
    const boxSlice = candles.slice(0, splitIdx);
    const boxHigh = Math.max(...boxSlice.map((c) => c.high));
    const boxLow = Math.min(...boxSlice.map((c) => c.low));
    return {
      activeSessionSegment: activeSeg,
      previousSessionSegment: prevSeg,
      segments,
      referenceBox: {
        high: Number(boxHigh.toFixed(2)),
        low: Number(boxLow.toFixed(2)),
        session: activeSeg.session,
        startTime: boxSlice[0].time,
        endTime: boxSlice[boxSlice.length - 1].time,
        isCompressed: boxHigh - boxLow < atr14 * 1.6,
      },
      referenceBoxEndIdx: splitIdx - 1,
      bslPrice: Number(bslPrice.toFixed(2)),
      sslPrice: Number(sslPrice.toFixed(2)),
      bslSourceSession,
      sslSourceSession,
    };
  }

  if (activeSeg.candles.length >= 6 && activeSeg.high - activeSeg.low < atr14 * 1.45) {
    const tailEvalCount = Math.min(4, Math.max(2, activeSeg.candles.length - 3));
    const splitIdx = Math.max(activeSeg.startIdx + 3, candles.length - tailEvalCount);
    const boxSlice = candles.slice(activeSeg.startIdx, splitIdx);
    const boxHigh = Math.max(...boxSlice.map((c) => c.high));
    const boxLow = Math.min(...boxSlice.map((c) => c.low));
    return {
      activeSessionSegment: activeSeg,
      previousSessionSegment: prevSeg,
      segments,
      referenceBox: {
        high: Number(boxHigh.toFixed(2)),
        low: Number(boxLow.toFixed(2)),
        session: activeSeg.session,
        startTime: boxSlice[0].time,
        endTime: boxSlice[boxSlice.length - 1].time,
        isCompressed: true,
      },
      referenceBoxEndIdx: splitIdx - 1,
      bslPrice: Number(bslPrice.toFixed(2)),
      sslPrice: Number(sslPrice.toFixed(2)),
      bslSourceSession,
      sslSourceSession,
    };
  }

  const refRange = refSeg.high - refSeg.low;
  const avgPerBarRange = refRange / Math.max(1, refSeg.candles.length);

  return {
    activeSessionSegment: activeSeg,
    previousSessionSegment: prevSeg,
    segments,
    referenceBox: {
      high: refSeg.high,
      low: refSeg.low,
      session: refSeg.session,
      startTime: refSeg.startTime,
      endTime: refSeg.endTime,
      isCompressed: avgPerBarRange < atr14 * 1.35 || refRange < atr14 * 2.2,
    },
    referenceBoxEndIdx: refBoxEndIdx,
    bslPrice: Number(bslPrice.toFixed(2)),
    sslPrice: Number(sslPrice.toFixed(2)),
    bslSourceSession,
    sslSourceSession,
  };
}

export type SpikeLevelTrackingState = 'PENDING' | 'IN_ZONE' | 'SWEPT';

export interface IntradaySpikeTargetMap {
  hasValidData: boolean;
  spotPrice: number;
  macro4hPdZone: 'PREMIUM' | 'EQUILIBRIUM' | 'DISCOUNT';
  macro4hPositionPct: number;
  atr14_1h: number;
  maxSweepDistance: number;
  upperAtrCapPrice: number;
  lowerAtrCapPrice: number;
  bslPrice: number;
  sslPrice: number;
  rawSessionBslPrice: number;
  rawSessionSslPrice: number;
  bslSourceSession: TradingSessionName;
  sslSourceSession: TradingSessionName;
  targetDirection: 'SWEEP_BSL_UPPER' | 'SWEEP_SSL_LOWER' | 'TWO_WAY';
  intradaySwingHigh: number;
  intradaySwingLow: number;
  layer1FvgOte: {
    low: number;
    high: number;
    hasFvg: boolean;
    isAtrCapped: boolean;
  };
  layer2ExtremeOb: {
    low: number;
    high: number;
    isAtrCapped: boolean;
  };
  spikeTracking: {
    overallState: SpikeLevelTrackingState;
    bslState: SpikeLevelTrackingState;
    sslState: SpikeLevelTrackingState;
    layer1State: SpikeLevelTrackingState;
    layer2State: SpikeLevelTrackingState;
    bslDistanceUsd: number;
    sslDistanceUsd: number;
    bslCapRatioPct: number;
    sslCapRatioPct: number;
    layer1DistanceUsd: number;
    layer2DistanceUsd: number;
  };
  integrationAudit: {
    activeSession: TradingSessionName;
    activeSessionWindowWib: string;
    bslSessionWindowWib: string;
    sslSessionWindowWib: string;
    isBslClampedByAtr: boolean;
    isSslClampedByAtr: boolean;
    isPoiClampedByAtr: boolean;
    candleCount1h: number;
    candleCount15m: number;
    candleCount4h: number;
  };
}

/**
 * Computes realistic, ATR-capped intraday (1H + 15M) spike targets & synchronized session BSL/SSL
 * for the Trade News "Peta Manipulasi & Target Spike" module:
 * 1. Session BSL/SSL synced from the exact Cycle & Confluence session clock (Tokyo, London, NY).
 * 2. TF 4H used ONLY for Macro Context (DISCOUNT / PREMIUM / EQUILIBRIUM).
 * 3. Intraday 1H + 15M structure used for Spike Termination (BSL/SSL, Layer 1 FVG/OTE 0.57–0.70, Layer 2 Extreme OB).
 * 4. Strict ATR Cap: MAX_SWEEP_DISTANCE = 1.8 * ATR(14) 1H (capped at ±$25.00 / 250 pips from XAU/USD spot).
 */
export function computeIntradaySpikeTargetMap(params: {
  candlesByTf: Partial<Record<string, ConfluenceCandle[]>>;
  livePrice: number | null;
  sessionConfig?: SessionHoursWibConfig;
  initialCatalystBias?: MacroBiasDirection | 'NEUTRAL';
  sessionPrimaryBias?: MacroBiasDirection | 'NEUTRAL';
  amdState?: AmdStateMachineResult | null;
}): IntradaySpikeTargetMap {
  const {
    candlesByTf,
    livePrice,
    sessionConfig = DEFAULT_SESSION_HOURS_WIB,
    initialCatalystBias = 'MIXED',
    sessionPrimaryBias = 'MIXED',
    amdState = null,
  } = params;

  const candles4h = candlesByTf['4h'] || [];
  const candles1h = candlesByTf['1h'] || [];
  const candles15m = candlesByTf['15min'] || [];

  const primaryIntradayCandles =
    candles1h.length >= 10
      ? candles1h
      : candles15m.length >= 10
      ? candles15m
      : candles4h;

  if (primaryIntradayCandles.length < 8) {
    const fallbackPrice = livePrice && livePrice > 0 ? livePrice : 0;
    const defaultWindowWib = formatSessionWindowWib('NEW_YORK', sessionConfig);
    return {
      hasValidData: false,
      spotPrice: fallbackPrice,
      macro4hPdZone: 'EQUILIBRIUM',
      macro4hPositionPct: 50,
      atr14_1h: 0,
      maxSweepDistance: 0,
      upperAtrCapPrice: fallbackPrice,
      lowerAtrCapPrice: fallbackPrice,
      bslPrice: fallbackPrice,
      sslPrice: fallbackPrice,
      rawSessionBslPrice: fallbackPrice,
      rawSessionSslPrice: fallbackPrice,
      bslSourceSession: 'NEW_YORK',
      sslSourceSession: 'NEW_YORK',
      targetDirection: 'TWO_WAY',
      intradaySwingHigh: fallbackPrice,
      intradaySwingLow: fallbackPrice,
      layer1FvgOte: { low: fallbackPrice, high: fallbackPrice, hasFvg: false, isAtrCapped: false },
      layer2ExtremeOb: { low: fallbackPrice, high: fallbackPrice, isAtrCapped: false },
      spikeTracking: {
        overallState: 'PENDING',
        bslState: 'PENDING',
        sslState: 'PENDING',
        layer1State: 'PENDING',
        layer2State: 'PENDING',
        bslDistanceUsd: 0,
        sslDistanceUsd: 0,
        bslCapRatioPct: 0,
        sslCapRatioPct: 0,
        layer1DistanceUsd: 0,
        layer2DistanceUsd: 0,
      },
      integrationAudit: {
        activeSession: 'NEW_YORK',
        activeSessionWindowWib: defaultWindowWib,
        bslSessionWindowWib: defaultWindowWib,
        sslSessionWindowWib: defaultWindowWib,
        isBslClampedByAtr: false,
        isSslClampedByAtr: false,
        isPoiClampedByAtr: false,
        candleCount1h: candles1h.length,
        candleCount15m: candles15m.length,
        candleCount4h: candles4h.length,
      },
    };
  }

  // 1. Macro Context (TF 4H ONLY for DISCOUNT / PREMIUM status)
  const macro4hAnalysis = analyzeTimeframeSmc(
    candles4h.length >= 10 ? candles4h : primaryIntradayCandles,
    '4h'
  );
  const macro4hPdZone = macro4hAnalysis.pdZone;
  const macro4hPositionPct = macro4hAnalysis.positionPct;

  // 2. Spot price & 1H ATR(14) Cap: MAX_SWEEP_DISTANCE = 1.8 * ATR(14) 1H (capped at $25.00 / 250 pips)
  const lastIntradayClose =
    candles15m[candles15m.length - 1]?.close ??
    candles1h[candles1h.length - 1]?.close ??
    primaryIntradayCandles[primaryIntradayCandles.length - 1]?.close ??
    0;
  const spotPrice = Number(
    (livePrice && livePrice > 0 ? livePrice : lastIntradayClose).toFixed(2)
  );

  const rawAtr1h = computeAtr14(candles1h.length >= 4 ? candles1h : primaryIntradayCandles);
  const atr14_1h = Number((rawAtr1h > 0 ? rawAtr1h : 10).toFixed(2));
  // Realistic intraday news sweep cap: 1.8 * ATR(14) 1H, bounded to max $25.00 (250 pips) from spot
  const maxSweepDistance = Number(clamp(1.8 * atr14_1h, 4.5, 25.0).toFixed(2));
  const upperAtrCapPrice = Number((spotPrice + maxSweepDistance).toFixed(2));
  const lowerAtrCapPrice = Number((spotPrice - maxSweepDistance).toFixed(2));

  // 3. Synchronized Session BSL / SSL (Single Source of Truth from Cycle & Confluence session clock)
  const sessionLiq = computeSessionLiquidityFromCandles(
    candles1h.length >= 10 ? candles1h : primaryIntradayCandles,
    sessionConfig,
    atr14_1h
  );
  const rawSessionBslPrice =
    amdState && amdState.nearestBslPrice > 0 ? amdState.nearestBslPrice : sessionLiq.bslPrice;
  const rawSessionSslPrice =
    amdState && amdState.nearestSslPrice > 0 ? amdState.nearestSslPrice : sessionLiq.sslPrice;

  // Collect intraday (1H + 15M) swing highs/lows & FVG levels for ATR-capped clamping
  const recent15m = candles15m.slice(-36);
  const recent1h = candles1h.slice(-18);
  const combinedIntraday = [...recent15m, ...recent1h];

  const intradayHighCandidates: number[] = [];
  const intradayLowCandidates: number[] = [];

  for (const seq of [recent15m, recent1h]) {
    for (let i = 1; i < seq.length - 1; i++) {
      const prev = seq[i - 1];
      const curr = seq[i];
      const next = seq[i + 1];
      if (curr.high >= prev.high && curr.high >= next.high && curr.high > spotPrice) {
        intradayHighCandidates.push(Number(curr.high.toFixed(2)));
      }
      if (curr.low <= prev.low && curr.low <= next.low && curr.low < spotPrice) {
        intradayLowCandidates.push(Number(curr.low.toFixed(2)));
      }
    }
  }

  // Scan unmitigated intraday FVGs on 15M and 1H within the ATR cap
  const intradayBearishFvgs: Array<{ low: number; high: number }> = [];
  const intradayBullishFvgs: Array<{ low: number; high: number }> = [];

  for (const seq of [recent15m, recent1h]) {
    for (let i = 2; i < seq.length; i++) {
      const c0 = seq[i - 2];
      const c2 = seq[i];
      // Bearish FVG (Supply imbalance above spot)
      if (c0.low > c2.high && c0.low > spotPrice && c2.high <= upperAtrCapPrice) {
        const laterBars = seq.slice(i + 1);
        const fullyFilled = laterBars.some((b) => b.close > c0.low);
        if (!fullyFilled) {
          intradayBearishFvgs.push({
            low: Number(Math.max(spotPrice + 0.5, c2.high).toFixed(2)),
            high: Number(Math.min(upperAtrCapPrice, c0.low).toFixed(2)),
          });
        }
      }
      // Bullish FVG (Demand imbalance below spot)
      if (c2.low > c0.high && c2.low < spotPrice && c0.high >= lowerAtrCapPrice) {
        const laterBars = seq.slice(i + 1);
        const fullyFilled = laterBars.some((b) => b.close < c0.high);
        if (!fullyFilled) {
          intradayBullishFvgs.push({
            low: Number(Math.max(lowerAtrCapPrice, c0.high).toFixed(2)),
            high: Number(Math.min(spotPrice - 0.5, c2.low).toFixed(2)),
          });
        }
      }
    }
  }

  // Clamp BSL Sesi to nearest intraday swing high / Equal Highs within MAX_SWEEP_DISTANCE if raw session BSL is either below spot or beyond ATR cap
  const validHighsWithinCap = intradayHighCandidates
    .filter((h) => h > spotPrice + 0.5 && h <= upperAtrCapPrice)
    .sort((a, b) => a - b);

  let bslPrice = rawSessionBslPrice;
  const isBslClampedByAtr = bslPrice <= spotPrice || bslPrice > upperAtrCapPrice;
  if (isBslClampedByAtr) {
    if (validHighsWithinCap.length > 0) {
      // Pick the highest unswept intraday liquidity pool within the 1.8x ATR cap
      bslPrice = validHighsWithinCap[validHighsWithinCap.length - 1];
    } else {
      const barHighsWithinCap = combinedIntraday
        .map((c) => c.high)
        .filter((h) => h > spotPrice + 0.5 && h <= upperAtrCapPrice);
      bslPrice =
        barHighsWithinCap.length > 0
          ? Number(Math.max(...barHighsWithinCap).toFixed(2))
          : Number((spotPrice + maxSweepDistance * 0.65).toFixed(2));
    }
  }

  // Clamp SSL Sesi to nearest intraday swing low / Equal Lows within MAX_SWEEP_DISTANCE if raw session SSL is either above spot or beyond ATR cap
  const validLowsWithinCap = intradayLowCandidates
    .filter((l) => l < spotPrice - 0.5 && l >= lowerAtrCapPrice)
    .sort((a, b) => b - a);

  let sslPrice = rawSessionSslPrice;
  const isSslClampedByAtr = sslPrice >= spotPrice || sslPrice < lowerAtrCapPrice;
  if (isSslClampedByAtr) {
    if (validLowsWithinCap.length > 0) {
      // Pick the lowest unswept intraday liquidity pool within the 1.8x ATR cap
      sslPrice = validLowsWithinCap[validLowsWithinCap.length - 1];
    } else {
      const barLowsWithinCap = combinedIntraday
        .map((c) => c.low)
        .filter((l) => l < spotPrice - 0.5 && l >= lowerAtrCapPrice);
      sslPrice =
        barLowsWithinCap.length > 0
          ? Number(Math.min(...barLowsWithinCap).toFixed(2))
          : Number((spotPrice - maxSweepDistance * 0.65).toFixed(2));
    }
  }

  // 4. Determine Manipulation Target Direction
  let targetDirection: IntradaySpikeTargetMap['targetDirection'] = 'TWO_WAY';
  if (initialCatalystBias === 'BUY' && sessionPrimaryBias === 'SELL') {
    targetDirection = 'SWEEP_BSL_UPPER';
  } else if (initialCatalystBias === 'SELL' && sessionPrimaryBias === 'BUY') {
    targetDirection = 'SWEEP_SSL_LOWER';
  } else if (sessionPrimaryBias === 'SELL') {
    targetDirection = 'SWEEP_BSL_UPPER';
  } else if (sessionPrimaryBias === 'BUY') {
    targetDirection = 'SWEEP_SSL_LOWER';
  } else if (macro4hPdZone === 'PREMIUM') {
    targetDirection = 'SWEEP_BSL_UPPER';
  } else if (macro4hPdZone === 'DISCOUNT') {
    targetDirection = 'SWEEP_SSL_LOWER';
  }

  // 5. Intraday (1H / 15M) Swing Range & ATR-Capped POI Hierarchy (Layer 1 FVG/OTE 0.57–0.70 & Layer 2 Extreme OB)
  const rawIntradayHigh = Math.max(
    ...combinedIntraday.slice(-24).map((c) => c.high),
    bslPrice
  );
  const rawIntradayLow = Math.min(
    ...combinedIntraday.slice(-24).map((c) => c.low),
    sslPrice
  );

  const isUpperCapped = rawIntradayHigh > upperAtrCapPrice;
  const isLowerCapped = rawIntradayLow < lowerAtrCapPrice;

  const intradaySwingHigh = Number(
    Math.max(bslPrice, Math.min(rawIntradayHigh, upperAtrCapPrice)).toFixed(2)
  );
  const intradaySwingLow = Number(
    Math.min(sslPrice, Math.max(rawIntradayLow, lowerAtrCapPrice)).toFixed(2)
  );

  let l1Low = 0;
  let l1High = 0;
  let hasFvg = false;
  let l2Low = 0;
  let l2High = 0;
  let isAtrCapped = false;

  if (targetDirection === 'SWEEP_BSL_UPPER') {
    // Manipulation spike UP above spot / BSL into intraday Supply OTE (0.57–0.70 of intraday swing)
    const anchorLow = Math.min(spotPrice - atr14_1h * 0.35, intradaySwingLow);
    const anchorHigh = Math.max(bslPrice + atr14_1h * 0.25, intradaySwingHigh);
    const cappedHigh = Math.min(anchorHigh, upperAtrCapPrice);
    const legRange = Math.max(2.0, cappedHigh - anchorLow);

    let ote57 = anchorLow + legRange * 0.57;
    let ote70 = anchorLow + legRange * 0.70;

    // Ensure the upward manipulation POI sits at or above spotPrice and near/above BSL, strictly within upperAtrCapPrice
    if (ote57 < spotPrice) {
      const upSpan = Math.max(2.0, cappedHigh - spotPrice);
      ote57 = spotPrice + upSpan * 0.57;
      ote70 = spotPrice + upSpan * 0.70;
    }

    const nearestBearFvg = intradayBearishFvgs.find(
      (f) => f.high >= bslPrice * 0.998 && f.high <= upperAtrCapPrice
    ) || intradayBearishFvgs[intradayBearishFvgs.length - 1];

    if (nearestBearFvg && nearestBearFvg.high > nearestBearFvg.low) {
      hasFvg = true;
      l1Low = Math.min(ote57, nearestBearFvg.low);
      l1High = Math.max(ote70, nearestBearFvg.high);
    } else {
      l1Low = ote57;
      l1High = ote70;
    }

    // Clamp Layer 1 FVG/OTE strictly to upperAtrCapPrice
    if (l1High > upperAtrCapPrice) {
      isAtrCapped = true;
      l1High = upperAtrCapPrice;
      l1Low = Math.min(l1Low, upperAtrCapPrice - Math.max(1.2, atr14_1h * 0.18));
    }
    if (isUpperCapped) isAtrCapped = true;

    // Layer 2 Extreme OB at the top of the ATR-filtered intraday impulse
    const obSpan = Math.max(1.5, Math.min(atr14_1h * 0.28, (cappedHigh - spotPrice) * 0.25));
    l2High = Math.min(upperAtrCapPrice, Math.max(l1High + 0.6, cappedHigh));
    l2Low = Math.max(l1High, l2High - obSpan);
  } else {
    // Manipulation spike DOWN below spot / SSL into intraday Demand OTE (0.57–0.70 of intraday swing)
    const anchorHigh = Math.max(spotPrice + atr14_1h * 0.35, intradaySwingHigh);
    const anchorLow = Math.min(sslPrice - atr14_1h * 0.25, intradaySwingLow);
    const cappedLow = Math.max(anchorLow, lowerAtrCapPrice);
    const legRange = Math.max(2.0, anchorHigh - cappedLow);

    let ote57 = anchorHigh - legRange * 0.57;
    let ote70 = anchorHigh - legRange * 0.70;

    // Ensure the downward manipulation POI sits at or below spotPrice and near/below SSL, strictly within lowerAtrCapPrice
    if (ote57 > spotPrice) {
      const downSpan = Math.max(2.0, spotPrice - cappedLow);
      ote57 = spotPrice - downSpan * 0.57;
      ote70 = spotPrice - downSpan * 0.70;
    }

    const nearestBullFvg = intradayBullishFvgs.find(
      (f) => f.low <= sslPrice * 1.002 && f.low >= lowerAtrCapPrice
    ) || intradayBullishFvgs[intradayBullishFvgs.length - 1];

    if (nearestBullFvg && nearestBullFvg.high > nearestBullFvg.low) {
      hasFvg = true;
      l1Low = Math.min(ote70, nearestBullFvg.low);
      l1High = Math.max(ote57, nearestBullFvg.high);
    } else {
      l1Low = Math.min(ote70, ote57);
      l1High = Math.max(ote70, ote57);
    }

    // Clamp Layer 1 FVG/OTE strictly to lowerAtrCapPrice
    if (l1Low < lowerAtrCapPrice) {
      isAtrCapped = true;
      l1Low = lowerAtrCapPrice;
      l1High = Math.max(l1High, lowerAtrCapPrice + Math.max(1.2, atr14_1h * 0.18));
    }
    if (isLowerCapped) isAtrCapped = true;

    // Layer 2 Extreme OB at the bottom of the ATR-filtered intraday impulse
    const obSpan = Math.max(1.5, Math.min(atr14_1h * 0.28, (spotPrice - cappedLow) * 0.25));
    l2Low = Math.max(lowerAtrCapPrice, Math.min(l1Low - 0.6, cappedLow));
    l2High = Math.min(l1Low, l2Low + obSpan);
  }

  const finalL1Low = Number(Math.min(l1Low, l1High).toFixed(2));
  const finalL1High = Number(Math.max(l1Low, l1High).toFixed(2));
  const finalL2Low = Number(Math.min(l2Low, l2High).toFixed(2));
  const finalL2High = Number(Math.max(l2Low, l2High).toFixed(2));
  const finalBslPrice = Number(bslPrice.toFixed(2));
  const finalSslPrice = Number(sslPrice.toFixed(2));

  // 6. Automated Spike Status Tracking (Otomasi Status Spike)
  const activeInspectionBars =
    recent15m.length >= 4 ? recent15m.slice(-6) : recent1h.slice(-3);
  const recentMaxHigh =
    activeInspectionBars.length > 0
      ? Math.max(...activeInspectionBars.map((c) => c.high), spotPrice)
      : spotPrice;
  const recentMinLow =
    activeInspectionBars.length > 0
      ? Math.min(...activeInspectionBars.map((c) => c.low), spotPrice)
      : spotPrice;
  const proximityBand = Math.max(0.8, atr14_1h * 0.12);

  // BSL tracking state
  let bslState: SpikeLevelTrackingState = 'PENDING';
  if (
    (recentMaxHigh >= finalBslPrice && spotPrice < finalBslPrice - 0.15) ||
    (amdState?.phase === 'DISTRIBUTION' && targetDirection === 'SWEEP_BSL_UPPER')
  ) {
    bslState = 'SWEPT';
  } else if (spotPrice >= finalBslPrice - proximityBand) {
    bslState = 'IN_ZONE';
  }

  // SSL tracking state
  let sslState: SpikeLevelTrackingState = 'PENDING';
  if (
    (recentMinLow <= finalSslPrice && spotPrice > finalSslPrice + 0.15) ||
    (amdState?.phase === 'DISTRIBUTION' && targetDirection === 'SWEEP_SSL_LOWER')
  ) {
    sslState = 'SWEPT';
  } else if (spotPrice <= finalSslPrice + proximityBand) {
    sslState = 'IN_ZONE';
  }

  // Layer 1 POI (FVG/OTE) tracking state
  let layer1State: SpikeLevelTrackingState = 'PENDING';
  const touchedLayer1 =
    targetDirection === 'SWEEP_BSL_UPPER'
      ? recentMaxHigh >= finalL1Low
      : recentMinLow <= finalL1High;
  if (spotPrice >= finalL1Low - 0.25 && spotPrice <= finalL1High + 0.25) {
    layer1State = 'IN_ZONE';
  } else if (
    touchedLayer1 &&
    ((targetDirection === 'SWEEP_BSL_UPPER' && spotPrice < finalL1Low - 0.3) ||
      (targetDirection !== 'SWEEP_BSL_UPPER' && spotPrice > finalL1High + 0.3))
  ) {
    layer1State = 'SWEPT';
  }

  // Layer 2 POI (Extreme OB) tracking state
  let layer2State: SpikeLevelTrackingState = 'PENDING';
  const touchedLayer2 =
    targetDirection === 'SWEEP_BSL_UPPER'
      ? recentMaxHigh >= finalL2Low
      : recentMinLow <= finalL2High;
  if (spotPrice >= finalL2Low - 0.25 && spotPrice <= finalL2High + 0.25) {
    layer2State = 'IN_ZONE';
  } else if (
    touchedLayer2 &&
    ((targetDirection === 'SWEEP_BSL_UPPER' && spotPrice < finalL2Low - 0.3) ||
      (targetDirection !== 'SWEEP_BSL_UPPER' && spotPrice > finalL2High + 0.3))
  ) {
    layer2State = 'SWEPT';
  }

  // Overall Spike Manipulation Status
  const primarySweepTargetState =
    targetDirection === 'SWEEP_BSL_UPPER'
      ? bslState
      : targetDirection === 'SWEEP_SSL_LOWER'
      ? sslState
      : bslState === 'SWEPT' || sslState === 'SWEPT'
      ? 'SWEPT'
      : bslState === 'IN_ZONE' || sslState === 'IN_ZONE'
      ? 'IN_ZONE'
      : 'PENDING';

  let overallState: SpikeLevelTrackingState = 'PENDING';
  if (
    primarySweepTargetState === 'SWEPT' ||
    layer1State === 'SWEPT' ||
    layer2State === 'SWEPT'
  ) {
    overallState = 'SWEPT';
  } else if (
    primarySweepTargetState === 'IN_ZONE' ||
    layer1State === 'IN_ZONE' ||
    layer2State === 'IN_ZONE' ||
    amdState?.phase === 'MANIPULATION'
  ) {
    overallState = 'IN_ZONE';
  }

  const bslDistanceUsd = Number(Math.abs(finalBslPrice - spotPrice).toFixed(2));
  const sslDistanceUsd = Number(Math.abs(spotPrice - finalSslPrice).toFixed(2));
  const safeCap = Math.max(1, maxSweepDistance);
  const bslCapRatioPct = clamp(Math.round((bslDistanceUsd / safeCap) * 100), 1, 100);
  const sslCapRatioPct = clamp(Math.round((sslDistanceUsd / safeCap) * 100), 1, 100);

  const l1Mid = (finalL1Low + finalL1High) / 2;
  const l2Mid = (finalL2Low + finalL2High) / 2;
  const layer1DistanceUsd = Number(Math.abs(l1Mid - spotPrice).toFixed(2));
  const layer2DistanceUsd = Number(Math.abs(l2Mid - spotPrice).toFixed(2));

  // 7. Integration Audit Diagnostics (Audit Integrasi Spike)
  const activeSession = amdState?.currentSession ?? sessionLiq.activeSessionSegment.session;
  const activeSessionWindowWib = formatSessionWindowWib(activeSession, sessionConfig);
  const bslSessionWindowWib = formatSessionWindowWib(sessionLiq.bslSourceSession, sessionConfig);
  const sslSessionWindowWib = formatSessionWindowWib(sessionLiq.sslSourceSession, sessionConfig);

  return {
    hasValidData: true,
    spotPrice,
    macro4hPdZone,
    macro4hPositionPct: Number(macro4hPositionPct.toFixed(1)),
    atr14_1h,
    maxSweepDistance,
    upperAtrCapPrice,
    lowerAtrCapPrice,
    bslPrice: finalBslPrice,
    sslPrice: finalSslPrice,
    rawSessionBslPrice: Number(rawSessionBslPrice.toFixed(2)),
    rawSessionSslPrice: Number(rawSessionSslPrice.toFixed(2)),
    bslSourceSession: sessionLiq.bslSourceSession,
    sslSourceSession: sessionLiq.sslSourceSession,
    targetDirection,
    intradaySwingHigh,
    intradaySwingLow,
    layer1FvgOte: {
      low: finalL1Low,
      high: finalL1High,
      hasFvg,
      isAtrCapped,
    },
    layer2ExtremeOb: {
      low: finalL2Low,
      high: finalL2High,
      isAtrCapped,
    },
    spikeTracking: {
      overallState,
      bslState,
      sslState,
      layer1State,
      layer2State,
      bslDistanceUsd,
      sslDistanceUsd,
      bslCapRatioPct,
      sslCapRatioPct,
      layer1DistanceUsd,
      layer2DistanceUsd,
    },
    integrationAudit: {
      activeSession,
      activeSessionWindowWib,
      bslSessionWindowWib,
      sslSessionWindowWib,
      isBslClampedByAtr,
      isSslClampedByAtr,
      isPoiClampedByAtr: isAtrCapped,
      candleCount1h: candles1h.length,
      candleCount15m: candles15m.length,
      candleCount4h: candles4h.length,
    },
  };
}

// ============================================================================
// 8. Dedicated Institutional SMC Signal Engine (BUY vs SELL Options + Cycle Analogy)
// ============================================================================

export type SmcSignalSetupGrade = 'SETUP_A_PLUS' | 'WAIT_CONFIRMATION' | 'HIGH_RISK';

export type SmcCyclePriorityCode =
  | 'PRIORITIZE_BUY'
  | 'PRIORITIZE_SELL'
  | 'WAIT_PULLBACK_BUY'
  | 'WAIT_PULLBACK_SELL';

export interface SmcSignalChecklistItem {
  id: string;
  stepNumber: number;
  titleId: string;
  titleEn: string;
  passed: boolean;
  statusLabelId: string;
  statusLabelEn: string;
  detailId: string;
  detailEn: string;
}

export interface SmcDirectionalSignalPlan {
  direction: 'BUY' | 'SELL';
  grade: SmcSignalSetupGrade;
  gradeBadgeId: string;
  gradeBadgeEn: string;
  gradeSummaryId: string;
  gradeSummaryEn: string;
  readinessScore: number; // 10..95
  isRecommendedByCycle: boolean;
  structureStage: 'CONFIRMED_CHOCH_BOS' | 'EARLY_MSS_ONLY' | 'NO_SHIFT_YET';
  structureStageBadgeId: string;
  structureStageBadgeEn: string;
  healthyObAudit: HealthyOrderBlockAudit;
  idmAudit: {
    detected: boolean;
    swept: boolean;
    price: number | null;
    noteId: string;
    noteEn: string;
  };
  liquiditySweepAudit: {
    swept: boolean;
    targetLevel: number;
    noteId: string;
    noteEn: string;
  };
  secondVerificationAudit: {
    verified: boolean;
    mtfChochConfirmed: boolean;
    ltfContinuationBosConfirmed: boolean;
    noteId: string;
    noteEn: string;
  };
  checklist: SmcSignalChecklistItem[];
  executionPlan: {
    entryZoneLow: number;
    entryZoneHigh: number;
    entryZoneLabelId: string;
    entryZoneLabelEn: string;
    backupExtremeLow: number;
    backupExtremeHigh: number;
    stopLossPrice: number;
    takeProfit1Eq: number;
    takeProfit2Liquidity: number;
    riskRewardRatio: string;
    invalidationRuleId: string;
    invalidationRuleEn: string;
    tacticalAdviceId: string;
    tacticalAdviceEn: string;
  };
}

export interface SmcCycleCompass {
  tradingMode: TradingConfluenceMode;
  htfLabel: string;
  mtfLabel: string;
  ltfLabel: string;
  htfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  mtfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  ltfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  dominantCycleBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  cycleUptrendPct?: number;
  cycleDowntrendPct?: number;
  cycleDominantDirection?: 'BULLISH' | 'BEARISH' | 'NETRAL';
  pdZone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  positionPct: number;
  rangeLow: number;
  rangeHigh: number;
  equilibriumPrice: number;
  amdPhaseLabelId: string;
  amdSessionLabelId: string;
  priorityCode: SmcCyclePriorityCode;
  recommendedSide: 'BUY' | 'SELL';
  priorityBadgeId: string;
  priorityBadgeEn: string;
  analogyHeadlineId: string;
  analogyHeadlineEn: string;
  analogyExplanationId: string;
  analogyExplanationEn: string;
  twoStageValidation: TwoStageStructureValidation;
  rawMacroContext?: RawMacroConfluenceContext;
}

export interface SmcLimitOrderSetup {
  id: string;
  direction: 'BUY' | 'SELL';
  tier: 'A_PLUS' | 'B_STANDARD' | 'HIGH_RISK';
  headerTitle: string; // e.g. "Buy Limit A+" or "Sell Limit A+"
  isActiveNow: boolean;
  entryLimit: number;
  stopLoss: number;
  slPips: number;      // Consistently 50 pips
  slPoints: number;    // Consistently 20 point slippage buffer ($0.20)
  tp1: number;
  tp1Pips: number;     // 50–70 pips (1:1)
  tp2: number;         // 100 pips (1:2)
  tpMax: number;       // Identified last Swing High / Swing Low target
  tpMaxRrLabel: string; // e.g. "1:4"
}

export interface SmcSignalEngineResult {
  tradingMode: TradingConfluenceMode;
  spotPrice: number;
  cycleCompass: SmcCycleCompass;
  buyOption: SmcDirectionalSignalPlan;
  sellOption: SmcDirectionalSignalPlan;
  buyLimitGroups: SmcLimitOrderSetup[];
  sellLimitGroups: SmcLimitOrderSetup[];
}

function buildDirectionalSmcPlan(params: {
  direction: 'BUY' | 'SELL';
  tradingMode: TradingConfluenceMode;
  spotPrice: number;
  htfAnalysis: TimeframeSmcAnalysis;
  mtfAnalysis: TimeframeSmcAnalysis;
  ltfAnalysis: TimeframeSmcAnalysis;
  ltfCandles: ConfluenceCandle[];
  mtfCandles: ConfluenceCandle[];
  amdState: AmdStateMachineResult | null;
  recommendedSide: 'BUY' | 'SELL';
  priorityCode: SmcCyclePriorityCode;
}): SmcDirectionalSignalPlan {
  const {
    direction,
    tradingMode,
    spotPrice,
    htfAnalysis,
    mtfAnalysis,
    ltfAnalysis,
    ltfCandles,
    mtfCandles,
    amdState,
    recommendedSide,
    priorityCode,
  } = params;

  const isBuy = direction === 'BUY';
  const mtfLabel = tradingMode === 'SCALP' ? 'M15' : '4H';
  const ltfLabel = tradingMode === 'SCALP' ? 'M5' : '1H';
  const htfLabel = tradingMode === 'SCALP' ? '1H' : 'D1';

  const primaryRef = mtfAnalysis || htfAnalysis;
  const rangeLow = primaryRef.swingLow;
  const rangeHigh = primaryRef.swingHigh;
  const equilibrium = primaryRef.equilibrium;
  const pdZone = primaryRef.pdZone;
  const positionPct = primaryRef.positionPct;

  const activeCandles = ltfCandles.length >= 10 ? ltfCandles : mtfCandles;
  const atrLtf = computeAtr14(activeCandles);

  // 1. Audit Directional Healthy Order Block (Mandatory FVG after OB + OB not swept by impulsive candle)
  const ltfOb = scanDirectionalHealthyOrderBlock(
    activeCandles,
    isBuy ? 'BULLISH' : 'BEARISH',
    ltfAnalysis.swingLow,
    ltfAnalysis.swingHigh,
    atrLtf
  );
  const mtfOb = scanDirectionalHealthyOrderBlock(
    mtfCandles.length >= 10 ? mtfCandles : activeCandles,
    isBuy ? 'BULLISH' : 'BEARISH',
    mtfAnalysis.swingLow,
    mtfAnalysis.swingHigh,
    computeAtr14(mtfCandles.length >= 10 ? mtfCandles : activeCandles)
  );
  const healthyObAudit = ltfOb.isHealthySmcOb
    ? ltfOb
    : mtfOb.isHealthySmcOb
    ? mtfOb
    : ltfOb.detected
    ? ltfOb
    : mtfOb;

  // 2. Check Cycle Alignment & PD Zone
  const isFavorableZone = isBuy
    ? pdZone === 'DISCOUNT' || (pdZone === 'EQUILIBRIUM' && positionPct <= 50)
    : pdZone === 'PREMIUM' || (pdZone === 'EQUILIBRIUM' && positionPct >= 50);
  const isTrendAligned = isBuy
    ? htfAnalysis.structureBias === 'BULLISH' || mtfAnalysis.structureBias === 'BULLISH'
    : htfAnalysis.structureBias === 'BEARISH' || mtfAnalysis.structureBias === 'BEARISH';
  const step1Passed = isFavorableZone && isTrendAligned;

  // 3. Check Initial Liquidity Sweep (SSL for Buy, BSL for Sell) or POI Tap
  const sslTarget = amdState?.nearestSslPrice || primaryRef.swingLow || ltfAnalysis.swingLow;
  const bslTarget = amdState?.nearestBslPrice || primaryRef.swingHigh || ltfAnalysis.swingHigh;
  const recentLtfSlice = activeCandles.slice(-18);
  const recentLowMin =
    recentLtfSlice.length > 0 ? Math.min(...recentLtfSlice.map((c) => c.low)) : spotPrice;
  const recentHighMax =
    recentLtfSlice.length > 0 ? Math.max(...recentLtfSlice.map((c) => c.high)) : spotPrice;

  const sweptLiquidity = isBuy
    ? recentLowMin <= sslTarget + atrLtf * 0.35 ||
      (spotPrice > ltfAnalysis.swingLow && recentLowMin <= ltfAnalysis.oteHigh)
    : recentHighMax >= bslTarget - atrLtf * 0.35 ||
      (spotPrice < ltfAnalysis.swingHigh && recentHighMax >= ltfAnalysis.oteLow);

  const liquiditySweepAudit = {
    swept: sweptLiquidity,
    targetLevel: Number((isBuy ? sslTarget : bslTarget).toFixed(2)),
    noteId: isBuy
      ? sweptLiquidity
        ? `Likuiditas bawah (SSL / POI Demand $${sslTarget.toFixed(2)}) telah disapu/dijemput sebelum patah struktur.`
        : `Belum ada sapuan likuiditas bawah (SSL $${sslTarget.toFixed(2)}) — waspadai stop-hunt ke bawah sebelum naik.`
      : sweptLiquidity
      ? `Likuiditas atas (BSL / POI Supply $${bslTarget.toFixed(2)}) telah disapu/dijemput sebelum patah struktur.`
      : `Belum ada sapuan likuiditas atas (BSL $${bslTarget.toFixed(2)}) — waspadai stop-hunt ke atas sebelum turun.`,
    noteEn: isBuy
      ? sweptLiquidity
        ? `Lower liquidity (SSL / Demand POI $${sslTarget.toFixed(2)}) was swept/tapped prior to structure shift.`
        : `Lower liquidity (SSL $${sslTarget.toFixed(2)}) not yet swept — watch for a stop-hunt lower first.`
      : sweptLiquidity
      ? `Upper liquidity (BSL / Supply POI $${bslTarget.toFixed(2)}) was swept/tapped prior to structure shift.`
      : `Upper liquidity (BSL $${bslTarget.toFixed(2)}) not yet swept — watch for a stop-hunt higher first.`,
  };

  // 4. Check Initial MSS on LTF (M5 / 1H) + Second Verification (CHoCH on M15/4H OR 2nd BOS on M5/1H)
  const ltfHasMss = isBuy
    ? ltfAnalysis.structureSignal === 'CHOCH_BULL' ||
      ltfAnalysis.structureSignal === 'BOS_BULL' ||
      (healthyObAudit.detected && healthyObAudit.isImpulsiveDisplacement && spotPrice > healthyObAudit.obLow)
    : ltfAnalysis.structureSignal === 'CHOCH_BEAR' ||
      ltfAnalysis.structureSignal === 'BOS_BEAR' ||
      (healthyObAudit.detected && healthyObAudit.isImpulsiveDisplacement && spotPrice < healthyObAudit.obHigh);

  const mtfChochConfirmed = isBuy
    ? mtfAnalysis.structureSignal === 'CHOCH_BULL' || mtfAnalysis.structureSignal === 'BOS_BULL'
    : mtfAnalysis.structureSignal === 'CHOCH_BEAR' || mtfAnalysis.structureSignal === 'BOS_BEAR';

  const ltfContinuationBosConfirmed = isBuy
    ? ltfAnalysis.structureSignal === 'BOS_BULL' && ltfAnalysis.structureBias === 'BULLISH'
    : ltfAnalysis.structureSignal === 'BOS_BEAR' && ltfAnalysis.structureBias === 'BEARISH';

  const secondVerified = ltfHasMss && (mtfChochConfirmed || ltfContinuationBosConfirmed);

  let structureStage: SmcDirectionalSignalPlan['structureStage'] = 'NO_SHIFT_YET';
  let structureStageBadgeId = '';
  let structureStageBadgeEn = '';

  if (secondVerified) {
    structureStage = 'CONFIRMED_CHOCH_BOS';
    structureStageBadgeId = `TERVERIFIKASI KE-2 (${mtfChochConfirmed ? `CHoCH/BOS ${mtfLabel}` : `BOS Lanjutan ${ltfLabel}`})`;
    structureStageBadgeEn = `2ND VERIFICATION PASSED (${mtfChochConfirmed ? `${mtfLabel} CHoCH/BOS` : `${ltfLabel} Continuation BOS`})`;
  } else if (ltfHasMss) {
    structureStage = 'EARLY_MSS_ONLY';
    structureStageBadgeId = `BARU MSS AWAL ${ltfLabel} (BELUM VERIFIKASI KE-2)`;
    structureStageBadgeEn = `EARLY ${ltfLabel} MSS ONLY (AWAITING 2ND VERIFICATION)`;
  } else {
    structureStage = 'NO_SHIFT_YET';
    structureStageBadgeId = `BELUM ADA MSS ${isBuy ? 'BULLISH' : 'BEARISH'} DI ${ltfLabel}`;
    structureStageBadgeEn = `NO ${isBuy ? 'BULLISH' : 'BEARISH'} MSS ON ${ltfLabel} YET`;
  }

  const secondVerificationAudit = {
    verified: secondVerified,
    mtfChochConfirmed,
    ltfContinuationBosConfirmed,
    noteId: secondVerified
      ? mtfChochConfirmed
        ? `Verifikasi Kedua Sah: MSS ${ltfLabel} telah diikuti oleh struktur ${mtfAnalysis.structureSignal} pada ${mtfLabel}.`
        : `Verifikasi Kedua Sah: MSS awal di ${ltfLabel} telah dilanjutkan oleh BOS kedua (${ltfAnalysis.structureSignal}).`
      : ltfHasMss
      ? `Peringatan SMC: Baru terbentuk MSS awal di ${ltfLabel}. Entry langsung berisiko karena belum terverifikasi oleh CHoCH di ${mtfLabel} maupun BOS lanjutan di ${ltfLabel}.`
      : `Menunggu patah struktur pertama (MSS ${isBuy ? 'Bullish' : 'Bearish'}) di ${ltfLabel}.`,
    noteEn: secondVerified
      ? mtfChochConfirmed
        ? `2nd Verification Confirmed: ${ltfLabel} MSS is backed by ${mtfAnalysis.structureSignal} on ${mtfLabel}.`
        : `2nd Verification Confirmed: Initial ${ltfLabel} MSS continued with a 2nd BOS (${ltfAnalysis.structureSignal}).`
      : ltfHasMss
      ? `SMC Warning: Only initial ${ltfLabel} MSS formed. Immediate entry carries risk without ${mtfLabel} CHoCH or ${ltfLabel} continuation BOS.`
      : `Awaiting initial structure shift (${isBuy ? 'Bullish' : 'Bearish'} MSS) on ${ltfLabel}.`,
  };

  // 5. Inducement (IDM) Sweep Before Order Block Audit
  const rawIdm =
    (isBuy && ltfAnalysis.inducement.type === 'BULLISH_TRAP') ||
    (!isBuy && ltfAnalysis.inducement.type === 'BEARISH_TRAP')
      ? ltfAnalysis.inducement
      : (isBuy && mtfAnalysis.inducement.type === 'BULLISH_TRAP') ||
        (!isBuy && mtfAnalysis.inducement.type === 'BEARISH_TRAP')
      ? mtfAnalysis.inducement
      : null;

  const idmDetected = Boolean(rawIdm?.detected);
  const idmSwept = Boolean(rawIdm?.detected && rawIdm?.swept);
  const idmPrice = rawIdm?.price ?? null;

  const idmAudit = {
    detected: idmDetected,
    swept: idmSwept,
    price: idmPrice,
    noteId: idmSwept && idmPrice
      ? `IDM Internal ($${idmPrice.toFixed(2)}) di depan Order Block SUDAH TERSAPU — likuiditas ritel telah diambil sebelum masuk OB.`
      : idmDetected && idmPrice
      ? `IDM Internal terdeteksi di $${idmPrice.toFixed(2)} namun BELUM TERSAPU — waspada harga menyapu IDM ini dulu menuju OB.`
      : `Belum ada Inducement (IDM <50% EQ) di depan OB — hati-hati menjadikan OB sebagai likuiditas pertama (First-Tap Trap).`,
    noteEn: idmSwept && idmPrice
      ? `Internal IDM ($${idmPrice.toFixed(2)}) ahead of Order Block is SWEPT — retail liquidity cleared prior to OB entry.`
      : idmDetected && idmPrice
      ? `Internal IDM detected at $${idmPrice.toFixed(2)} but NOT YET SWEPT — watch for a sweep into OB.`
      : `No Inducement (IDM <50% EQ) formed ahead of OB yet — beware of First-Tap liquidity trap.`,
  };

  // Step 4 Combined Check: Healthy OB (hasFvgAfter + notSweptByImpulsiveCandle + isUnmitigated)
  const step4ObHealthy = healthyObAudit.isHealthySmcOb;

  // Build the 5-step Checklist
  const checklist: SmcSignalChecklistItem[] = [
    {
      id: 'cycle-zone-alignment',
      stepNumber: 1,
      titleId: isBuy
        ? `1. Konteks Cycle & Zona Discount (<50% EQ $${equilibrium.toFixed(2)})`
        : `1. Konteks Cycle & Zona Premium (>50% EQ $${equilibrium.toFixed(2)})`,
      titleEn: isBuy
        ? `1. Cycle Context & Discount Zone (<50% EQ $${equilibrium.toFixed(2)})`
        : `1. Cycle Context & Premium Zone (>50% EQ $${equilibrium.toFixed(2)})`,
      passed: step1Passed,
      statusLabelId: step1Passed
        ? isBuy
          ? `SEARAH CYCLE · ${pdZone} (${positionPct.toFixed(0)}%)`
          : `SEARAH CYCLE · ${pdZone} (${positionPct.toFixed(0)}%)`
        : !isFavorableZone
        ? isBuy
          ? `HARGA DI ${pdZone} (${positionPct.toFixed(0)}% · MAHAL)`
          : `HARGA DI ${pdZone} (${positionPct.toFixed(0)}% · MURAH)`
        : `LAWAN TREN ${htfLabel}/${mtfLabel}`,
      statusLabelEn: step1Passed
        ? `ALIGNED · ${pdZone} (${positionPct.toFixed(0)}%)`
        : !isFavorableZone
        ? `IN ${pdZone} (${positionPct.toFixed(0)}%)`
        : `COUNTER-TREND ${htfLabel}/${mtfLabel}`,
      detailId: isBuy
        ? isFavorableZone
          ? `Harga berada di ${pdZone} (${positionPct.toFixed(0)}%) di bawah Equilibrium $${equilibrium.toFixed(2)} — area ideal mencari opsi BUY.`
          : `Harga sedang berada di ${pdZone} (${positionPct.toFixed(0)}%) di atas Equilibrium $${equilibrium.toFixed(2)} — mengejar BUY di zona Premium rawan terkena koreksi.`
        : isFavorableZone
        ? `Harga berada di ${pdZone} (${positionPct.toFixed(0)}%) di atas Equilibrium $${equilibrium.toFixed(2)} — area ideal mencari opsi SELL.`
        : `Harga sedang berada di ${pdZone} (${positionPct.toFixed(0)}%) di bawah Equilibrium $${equilibrium.toFixed(2)} — mengejar SELL di zona Discount rawan terkena pantulan.`,
      detailEn: isBuy
        ? isFavorableZone
          ? `Price sits in ${pdZone} (${positionPct.toFixed(0)}%) below Equilibrium $${equilibrium.toFixed(2)} — optimal zone for BUY setups.`
          : `Price sits in ${pdZone} (${positionPct.toFixed(0)}%) above Equilibrium $${equilibrium.toFixed(2)} — chasing BUY in Premium is high-risk.`
        : isFavorableZone
        ? `Price sits in ${pdZone} (${positionPct.toFixed(0)}%) above Equilibrium $${equilibrium.toFixed(2)} — optimal zone for SELL setups.`
        : `Price sits in ${pdZone} (${positionPct.toFixed(0)}%) below Equilibrium $${equilibrium.toFixed(2)} — chasing SELL in Discount is high-risk.`,
    },
    {
      id: 'initial-liquidity-sweep',
      stepNumber: 2,
      titleId: isBuy
        ? `2. Sapuan Likuiditas Bawah (Sweep SSL / Tap POI ${mtfLabel})`
        : `2. Sapuan Likuiditas Atas (Sweep BSL / Tap POI ${mtfLabel})`,
      titleEn: isBuy
        ? `2. Lower Liquidity Raid (SSL Sweep / ${mtfLabel} POI Tap)`
        : `2. Upper Liquidity Raid (BSL Sweep / ${mtfLabel} POI Tap)`,
      passed: sweptLiquidity,
      statusLabelId: sweptLiquidity ? 'LIKUIDITAS TERSAPU' : 'BELUM SWEEP',
      statusLabelEn: sweptLiquidity ? 'LIQUIDITY SWEPT' : 'NOT SWEPT YET',
      detailId: liquiditySweepAudit.noteId,
      detailEn: liquiditySweepAudit.noteEn,
    },
    {
      id: 'ltf-mss-displacement',
      stepNumber: 3,
      titleId: `3. Patah Struktur Awal (MSS ${isBuy ? 'Bullish' : 'Bearish'} pada ${ltfLabel})`,
      titleEn: `3. Initial Structure Shift (${isBuy ? 'Bullish' : 'Bearish'} MSS on ${ltfLabel})`,
      passed: ltfHasMss,
      statusLabelId: ltfHasMss ? `MSS ${ltfLabel} TERBENTUK` : `MENUNGGU MSS ${ltfLabel}`,
      statusLabelEn: ltfHasMss ? `${ltfLabel} MSS FORMED` : `AWAITING ${ltfLabel} MSS`,
      detailId: ltfHasMss
        ? `Tanda awal pembalikan (MSS) pada ${ltfLabel} sudah muncul. Ingat aturan SMC: MSS baru pertanda awal dan wajib dicek kualitas OB serta verifikasi keduanya.`
        : `Struktur ${ltfLabel} belum mencetak MSS ${isBuy ? 'Bullish' : 'Bearish'}. Jangan menebak pucuk/dasar sebelum struktur patah.`,
      detailEn: ltfHasMss
        ? `Initial structure shift (MSS) on ${ltfLabel} detected. Per SMC rules, validate OB quality and 2nd verification before entry.`
        : `${ltfLabel} has not printed a ${isBuy ? 'Bullish' : 'Bearish'} MSS yet. Wait for structural shift.`,
    },
    {
      id: 'healthy-ob-fvg-antisweep',
      stepNumber: 4,
      titleId: `4. Anatomi OB Sehat (Wajib Ada FVG + Tidak Ter-Sweep Candle Impulsif + IDM)`,
      titleEn: `4. Healthy OB Anatomy (Mandatory FVG + Not Swept by Impulsive Candle + IDM)`,
      passed: step4ObHealthy,
      statusLabelId: step4ObHealthy
        ? idmSwept
          ? 'OB SEHAT + FVG + IDM SWEPT'
          : 'OB SEHAT (FVG + ANTI-SWEEP)'
        : !healthyObAudit.notSweptByImpulsiveCandle && healthyObAudit.detected
        ? 'GAGAL: OB TER-SWEEP IMPULSIF'
        : !healthyObAudit.hasFvgAfter && healthyObAudit.detected
        ? 'GAGAL: OB TANPA FVG'
        : 'BELUM ADA OB SEHAT',
      statusLabelEn: step4ObHealthy
        ? idmSwept
          ? 'HEALTHY OB + FVG + IDM SWEPT'
          : 'HEALTHY OB (FVG + ANTI-SWEEP)'
        : !healthyObAudit.notSweptByImpulsiveCandle && healthyObAudit.detected
        ? 'FAILED: SWEPT BY IMPULSIVE BAR'
        : !healthyObAudit.hasFvgAfter && healthyObAudit.detected
        ? 'FAILED: NO FVG AFTER OB'
        : 'NO HEALTHY OB YET',
      detailId: `${healthyObAudit.diagnosticNoteId} ${idmAudit.noteId}`,
      detailEn: `${healthyObAudit.diagnosticNoteEn} ${idmAudit.noteEn}`,
    },
    {
      id: 'second-verification-choch-bos',
      stepNumber: 5,
      titleId: `5. Verifikasi Kedua (CHoCH di ${mtfLabel} atau BOS Lanjutan di ${ltfLabel})`,
      titleEn: `5. Second Verification (${mtfLabel} CHoCH or ${ltfLabel} Continuation BOS)`,
      passed: secondVerified,
      statusLabelId: secondVerified
        ? 'TERVERIFIKASI GANDA'
        : ltfHasMss
        ? 'BARU MSS AWAL (BERISIKO)'
        : 'BELUM TERKONFIRMASI',
      statusLabelEn: secondVerified
        ? 'DOUBLE CONFIRMED'
        : ltfHasMss
        ? 'EARLY MSS ONLY (RISKY)'
        : 'UNCONFIRMED',
      detailId: secondVerificationAudit.noteId,
      detailEn: secondVerificationAudit.noteEn,
    },
  ];

  // Calculate Readiness Score & Setup Grade (SETUP_A_PLUS vs WAIT_CONFIRMATION vs HIGH_RISK)
  let rawScore = 25;
  if (step1Passed) rawScore += 22;
  else if (isFavorableZone || isTrendAligned) rawScore += 10;
  else rawScore -= 10;

  if (sweptLiquidity) rawScore += 12;
  if (ltfHasMss) rawScore += 12;
  if (step4ObHealthy) rawScore += 16;
  if (idmSwept) rawScore += 8;
  if (secondVerified) rawScore += 16;

  // Dampen if AMD Gatekeeper is locked in accumulation
  if (amdState?.manualOverrideMode === 'ACCUMULATION') {
    rawScore = Math.min(rawScore, 52);
  }

  const readinessScore = clamp(Math.round(rawScore), 12, 95);
  const isRecommendedByCycle = recommendedSide === direction;

  let grade: SmcSignalSetupGrade = 'HIGH_RISK';
  let gradeBadgeId = '';
  let gradeBadgeEn = '';
  let gradeSummaryId = '';
  let gradeSummaryEn = '';

  if (
    isRecommendedByCycle &&
    step4ObHealthy &&
    secondVerified &&
    (isFavorableZone || sweptLiquidity)
  ) {
    grade = 'SETUP_A_PLUS';
    gradeBadgeId = 'SETUP A+ · SMC SEHAT (PRIORITAS UTAMA)';
    gradeBadgeEn = 'A+ SETUP · HEALTHY SMC (TOP PRIORITY)';
    gradeSummaryId = `Seluruh syarat SMC Sehat terpenuhi: Searah prioritas Cycle, Order Block memiliki FVG & tidak ter-sweep candle impulsif, serta telah lulus verifikasi kedua (${mtfChochConfirmed ? `CHoCH ${mtfLabel}` : `BOS lanjutan ${ltfLabel}`}).`;
    gradeSummaryEn = `All Healthy SMC rules met: Aligned with Cycle priority, OB has FVG & was not swept by impulsive candle, and passed 2nd verification (${mtfChochConfirmed ? `${mtfLabel} CHoCH` : `${ltfLabel} continuation BOS`}).`;
  } else if (
    (isRecommendedByCycle && (ltfHasMss || step4ObHealthy || isFavorableZone)) ||
    (!isRecommendedByCycle && step4ObHealthy && secondVerified)
  ) {
    grade = 'WAIT_CONFIRMATION';
    gradeBadgeId =
      structureStage === 'EARLY_MSS_ONLY'
        ? `SETUP B · EARLY MSS (TUNGGU VERIFIKASI KE-2 ${mtfLabel}/${ltfLabel})`
        : !step4ObHealthy
        ? 'SETUP B · TUNGGU OB SEHAT (FVG + ANTI-SWEEP)'
        : !isRecommendedByCycle
        ? 'SETUP B · COUNTER-SCALP MENUJU EQUILIBRIUM'
        : 'SETUP B · TUNGGU RETEST & SAPUAN IDM';
    gradeBadgeEn =
      structureStage === 'EARLY_MSS_ONLY'
        ? `B-SETUP · EARLY MSS (AWAIT 2ND VERIFICATION ${mtfLabel}/${ltfLabel})`
        : !step4ObHealthy
        ? 'B-SETUP · AWAIT HEALTHY OB (FVG + ANTI-SWEEP)'
        : !isRecommendedByCycle
        ? 'B-SETUP · COUNTER-SCALP TO EQUILIBRIUM'
        : 'B-SETUP · AWAIT RETEST & IDM SWEEP';
    gradeSummaryId =
      structureStage === 'EARLY_MSS_ONLY'
        ? `Hati-hati: Baru terbentuk MSS pertama di ${ltfLabel}. Entry langsung di OB pertama berisiko jika belum diikuti CHoCH di ${mtfLabel}, BOS kedua di ${ltfLabel}, atau sapuan IDM di depan OB.`
        : !step4ObHealthy
        ? `Arah sesuai dengan konteks, tetapi Order Block terdekat belum memenuhi syarat OB Sehat (wajib ada FVG setelahnya & tidak ter-sweep candle impulsif).`
        : `Zona sudah terpetakan; tunggu harga menjemput zona OB/FVG dan menyapu IDM sebelum eksekusi.`;
    gradeSummaryEn =
      structureStage === 'EARLY_MSS_ONLY'
        ? `Caution: Only initial ${ltfLabel} MSS formed. Immediate entry carries risk until confirmed by ${mtfLabel} CHoCH, 2nd ${ltfLabel} BOS, or IDM sweep ahead of OB.`
        : !step4ObHealthy
        ? `Direction aligns with context, but nearest OB fails Healthy OB rules (mandatory FVG after & not swept by impulsive candle).`
        : `Zones mapped; wait for price to retest OB/FVG and sweep IDM before execution.`;
  } else {
    grade = 'HIGH_RISK';
    gradeBadgeId = !isFavorableZone
      ? isBuy
        ? 'HIGH RISK · RAWAN JEBAKAN BUY DI PREMIUM'
        : 'HIGH RISK · RAWAN JEBAKAN SELL DI DISCOUNT'
      : 'HIGH RISK · LAWAN STRUKTUR UTAMA & BELUM ADA OB SEHAT';
    gradeBadgeEn = !isFavorableZone
      ? isBuy
        ? 'HIGH RISK · BUYING IN PREMIUM TRAP'
        : 'HIGH RISK · SELLING IN DISCOUNT TRAP'
      : 'HIGH RISK · COUNTER-STRUCTURE & NO HEALTHY OB';
    gradeSummaryId = isBuy
      ? `Berisiko Tinggi: Struktur atau posisi harga Cycle (${pdZone} ${positionPct.toFixed(0)}%) tidak mendukung opsi BUY saat ini, atau Order Block belum terverifikasi CHoCH/FVG.`
      : `Berisiko Tinggi: Struktur atau posisi harga Cycle (${pdZone} ${positionPct.toFixed(0)}%) tidak mendukung opsi SELL saat ini, atau Order Block belum terverifikasi CHoCH/FVG.`;
    gradeSummaryEn = isBuy
      ? `High Risk: Cycle structure or price position (${pdZone} ${positionPct.toFixed(0)}%) opposes BUY right now, or OB lacks CHoCH/FVG verification.`
      : `High Risk: Cycle structure or price position (${pdZone} ${positionPct.toFixed(0)}%) opposes SELL right now, or OB lacks CHoCH/FVG verification.`;
  }

  // Build Execution Plan Zones (OB + FVG, Backup Extreme OB, SL, TP1 EQ, TP2 Liquidity)
  const fallbackLayer1 = primaryRef.poiHierarchy.layer1DecisionalFvgOte;
  const fallbackLayer2 = primaryRef.poiHierarchy.layer2ExtremeOb;

  const entryZoneLow = healthyObAudit.detected
    ? Number(Math.min(healthyObAudit.obLow, healthyObAudit.fvgLow).toFixed(2))
    : fallbackLayer1.low;
  const entryZoneHigh = healthyObAudit.detected
    ? Number(Math.max(healthyObAudit.obHigh, healthyObAudit.fvgHigh).toFixed(2))
    : fallbackLayer1.high;

  const backupExtremeLow = isBuy
    ? Number(rangeLow.toFixed(2))
    : Number((rangeHigh - Math.max(1.5, (rangeHigh - rangeLow) * 0.16)).toFixed(2));
  const backupExtremeHigh = isBuy
    ? Number((rangeLow + Math.max(1.5, (rangeHigh - rangeLow) * 0.16)).toFixed(2))
    : Number(rangeHigh.toFixed(2));

  const slBuffer = Math.max(1.2, atrLtf * 0.45);
  const stopLossPrice = isBuy
    ? Number((Math.min(entryZoneLow, backupExtremeLow) - slBuffer).toFixed(2))
    : Number((Math.max(entryZoneHigh, backupExtremeHigh) + slBuffer).toFixed(2));

  const entryMid = (entryZoneLow + entryZoneHigh) / 2;
  const takeProfit1Eq = Number(equilibrium.toFixed(2));
  const takeProfit2Liquidity = isBuy
    ? Number(Math.max(bslTarget, rangeHigh, entryMid + atrLtf * 2.2).toFixed(2))
    : Number(Math.min(sslTarget, rangeLow, entryMid - atrLtf * 2.2).toFixed(2));

  const riskDist = Math.max(0.5, Math.abs(entryMid - stopLossPrice));
  const rewardDist = Math.max(0.5, Math.abs(takeProfit2Liquidity - entryMid));
  const rrVal = Number(clamp(rewardDist / riskDist, 0.8, 6.5).toFixed(1));
  const riskRewardRatio = `1 : ${rrVal}`;

  const entryZoneLabelId = healthyObAudit.isHealthySmcOb
    ? `${isBuy ? 'Bullish' : 'Bearish'} OB Sehat + FVG (${ltfOb.isHealthySmcOb ? ltfLabel : mtfLabel})`
    : healthyObAudit.detected
    ? `Zona ${isBuy ? 'Bullish' : 'Bearish'} OB (${healthyObAudit.hasFvgAfter ? 'Ada FVG' : 'Tanpa FVG'})`
    : `Zona Decisional OTE 0.57–0.70 (${mtfLabel})`;
  const entryZoneLabelEn = healthyObAudit.isHealthySmcOb
    ? `Healthy ${isBuy ? 'Bullish' : 'Bearish'} OB + FVG (${ltfOb.isHealthySmcOb ? ltfLabel : mtfLabel})`
    : healthyObAudit.detected
    ? `${isBuy ? 'Bullish' : 'Bearish'} OB Zone (${healthyObAudit.hasFvgAfter ? 'With FVG' : 'No FVG'})`
    : `Decisional OTE 0.57–0.70 Zone (${mtfLabel})`;

  const invalidationRuleId = isBuy
    ? `Batal (Invalidasi) jika candle ${ltfLabel}/${mtfLabel} tutup full-body di bawah $${stopLossPrice.toFixed(2)} (ekor Bullish OB ter-sweep habis).`
    : `Batal (Invalidasi) jika candle ${ltfLabel}/${mtfLabel} tutup full-body di atas $${stopLossPrice.toFixed(2)} (ekor Bearish OB ter-sweep habis).`;
  const invalidationRuleEn = isBuy
    ? `Invalidated if ${ltfLabel}/${mtfLabel} candle closes full-body below $${stopLossPrice.toFixed(2)} (Bullish OB base swept).`
    : `Invalidated if ${ltfLabel}/${mtfLabel} candle closes full-body above $${stopLossPrice.toFixed(2)} (Bearish OB top swept).`;

  const tacticalAdviceId =
    grade === 'SETUP_A_PLUS'
      ? isBuy
        ? `Taktik Eksekusi: Tunggu retest ke Bullish OB+FVG ($${entryZoneLow.toFixed(2)}–$${entryZoneHigh.toFixed(2)}) pasca-sapuan IDM. Ambil parsial TP1 di Equilibrium ($${takeProfit1Eq.toFixed(2)}) dan sisakan menuju BSL ($${takeProfit2Liquidity.toFixed(2)}).`
        : `Taktik Eksekusi: Tunggu retest ke Bearish OB+FVG ($${entryZoneLow.toFixed(2)}–$${entryZoneHigh.toFixed(2)}) pasca-sapuan IDM. Ambil parsial TP1 di Equilibrium ($${takeProfit1Eq.toFixed(2)}) dan sisakan menuju SSL ($${takeProfit2Liquidity.toFixed(2)}).`
      : grade === 'WAIT_CONFIRMATION'
      ? isBuy
        ? `Taktik Sabar: Jangan pasang blind limit di OB pertama jika baru MSS awal di ${ltfLabel}. Tunggu IDM di atas OB disapu lalu muncul CHoCH ${mtfLabel} atau BOS kedua di ${ltfLabel}.`
        : `Taktik Sabar: Jangan pasang blind limit di OB pertama jika baru MSS awal di ${ltfLabel}. Tunggu IDM di bawah OB disapu lalu muncul CHoCH ${mtfLabel} atau BOS kedua di ${ltfLabel}.`
      : priorityCode === 'WAIT_PULLBACK_BUY' && isBuy
      ? `Harga saat ini terlalu tinggi di zona Premium (${positionPct.toFixed(0)}%). Jangan kejar BUY di pucuk; wajib tunggu harga turun melewati Equilibrium ($${equilibrium.toFixed(2)}) ke zona Discount ($${entryZoneLow.toFixed(2)}–$${entryZoneHigh.toFixed(2)}).`
      : priorityCode === 'WAIT_PULLBACK_SELL' && !isBuy
      ? `Harga saat ini terlalu rendah di zona Discount (${positionPct.toFixed(0)}%). Jangan kejar SELL di dasar; wajib tunggu harga naik melewati Equilibrium ($${equilibrium.toFixed(2)}) ke zona Premium ($${entryZoneLow.toFixed(2)}–$${entryZoneHigh.toFixed(2)}).`
      : `Sinyal ini berlawanan dengan struktur utama Cycle. Hindari entry agresif; prioritaskan opsi ${recommendedSide} yang searah struktur.`;

  const tacticalAdviceEn =
    grade === 'SETUP_A_PLUS'
      ? isBuy
        ? `Execution Tactic: Enter on retest of Healthy Bullish OB+FVG ($${entryZoneLow.toFixed(2)}–$${entryZoneHigh.toFixed(2)}) after IDM sweep. Secure partial TP1 at Equilibrium ($${takeProfit1Eq.toFixed(2)}) and hold runner for BSL ($${takeProfit2Liquidity.toFixed(2)}).`
        : `Execution Tactic: Enter on retest of Healthy Bearish OB+FVG ($${entryZoneLow.toFixed(2)}–$${entryZoneHigh.toFixed(2)}) after IDM sweep. Secure partial TP1 at Equilibrium ($${takeProfit1Eq.toFixed(2)}) and hold runner for SSL ($${takeProfit2Liquidity.toFixed(2)}).`
      : grade === 'WAIT_CONFIRMATION'
      ? `Patience Tactic: Avoid blind limit orders on an unverified first MSS. Wait for IDM sweep ahead of OB plus ${mtfLabel} CHoCH or 2nd ${ltfLabel} BOS.`
      : `High-risk counter-structure setup. Avoid aggressive entries and prioritize the ${recommendedSide} option aligned with Cycle structure.`;

  return {
    direction,
    grade,
    gradeBadgeId,
    gradeBadgeEn,
    gradeSummaryId,
    gradeSummaryEn,
    readinessScore,
    isRecommendedByCycle,
    structureStage,
    structureStageBadgeId,
    structureStageBadgeEn,
    healthyObAudit,
    idmAudit,
    liquiditySweepAudit,
    secondVerificationAudit,
    checklist,
    executionPlan: {
      entryZoneLow,
      entryZoneHigh,
      entryZoneLabelId,
      entryZoneLabelEn,
      backupExtremeLow,
      backupExtremeHigh,
      stopLossPrice,
      takeProfit1Eq,
      takeProfit2Liquidity,
      riskRewardRatio,
      invalidationRuleId,
      invalidationRuleEn,
      tacticalAdviceId,
      tacticalAdviceEn,
    },
  };
}

/**
 * Evaluates the complete SMC Signal Desk for both BUY and SELL options while
 * analogizing them with the macro/intraday Cycle structure (Equilibrium, Discount/Premium, AMD).
 */
export function evaluateSmcSignalEngine(params: {
  tradingMode: TradingConfluenceMode;
  livePrice: number | null;
  macroBias?: MacroBiasDirection;
  candlesByTf: Record<string, ConfluenceCandle[]>;
  sessionConfig?: SessionHoursWibConfig;
  manualAmdOverride?: ManualAmdOverrideMode;
  rawMacroContext?: RawMacroConfluenceContext;
}): SmcSignalEngineResult {
  const {
    tradingMode,
    livePrice,
    macroBias = 'MIXED',
    candlesByTf,
    sessionConfig = DEFAULT_SESSION_HOURS_WIB,
    manualAmdOverride = 'AUTO',
    rawMacroContext,
  } = params;

  const master = evaluateConfluenceMaster({
    viewMode: 'FULL',
    tradingMode,
    livePrice,
    macroBias,
    candlesByTf,
    sessionConfig,
    manualAmdOverride,
    rawMacroContext,
  });

  const tfs = tradingMode === 'SCALP' ? ['1h', '15min', '5min'] : ['1day', '4h', '1h'];
  const htfLabel = tradingMode === 'SCALP' ? '1H' : 'D1';
  const mtfLabel = tradingMode === 'SCALP' ? 'M15' : '4H';
  const ltfLabel = tradingMode === 'SCALP' ? 'M5' : '1H';

  const fallbackAnalysis = analyzeTimeframeSmc([], tfs[0]);
  const htfAnalysis = master.htfAnalysis || fallbackAnalysis;
  const mtfAnalysis = master.mtfAnalysis || htfAnalysis;
  const ltfAnalysis = master.ltfAnalysis || mtfAnalysis;

  const ltfCandles = candlesByTf[tfs[2]] || candlesByTf[tfs[1]] || candlesByTf[tfs[0]] || [];
  const mtfCandles = candlesByTf[tfs[1]] || candlesByTf[tfs[0]] || ltfCandles;
  const lastClose = ltfCandles[ltfCandles.length - 1]?.close ?? htfAnalysis.equilibrium ?? 0;
  const spotPrice = Number((livePrice && livePrice > 0 ? livePrice : lastClose).toFixed(2));

  // Primary Dealing Range reference (M15/1H in Scalp, 4H/D1 in Swing)
  const rangeRef = mtfAnalysis.swingHigh > mtfAnalysis.swingLow ? mtfAnalysis : htfAnalysis;
  const pdZone = rangeRef.pdZone;
  const positionPct = rangeRef.positionPct;
  const equilibriumPrice = rangeRef.equilibrium;
  const rangeLow = rangeRef.swingLow;
  const rangeHigh = rangeRef.swingHigh;

  const tsv = master.twoStageValidation;

  // Determine Dominant Cycle Bias (100% aligned with Cycle master confluence direction)
  let dominantCycleBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (tsv.isImpulsiveDropWithoutChoch) {
    dominantCycleBias = 'BEARISH';
  } else if (tsv.isImpulsiveRallyWithoutChoch) {
    dominantCycleBias = 'BULLISH';
  } else if (master.dominantDirection === 'BULLISH') {
    dominantCycleBias = 'BULLISH';
  } else if (master.dominantDirection === 'BEARISH') {
    dominantCycleBias = 'BEARISH';
  } else {
    dominantCycleBias = 'NEUTRAL';
  }

  // Analogize Cycle Structure + PD Zone (Discount/Premium) + Mandatory M5/1H CHoCH Gate into Buy vs Sell Recommendation
  let priorityCode: SmcCyclePriorityCode = 'PRIORITIZE_BUY';
  let recommendedSide: 'BUY' | 'SELL' = 'BUY';
  let priorityBadgeId = '';
  let priorityBadgeEn = '';
  let analogyHeadlineId = '';
  let analogyHeadlineEn = '';
  let analogyExplanationId = '';
  let analogyExplanationEn = '';

  if (tsv.isImpulsiveDropWithoutChoch) {
    // CRITICAL SMC RULE: Price is in Discount, but falling impulsively WITHOUT M5/1H CHoCH (pullback high not broken by body)!
    // Never blindly tell trader "Buy because it's Discount" before CHoCH confirms buyers stepped in.
    priorityCode = 'WAIT_PULLBACK_SELL';
    recommendedSide = 'SELL';
    priorityBadgeId = `BIAS BEARISH · HARGA DI DISCOUNT (${positionPct.toFixed(0)}%) TAPI BELUM ADA CHoCH ${tsv.narrowTriggerTf} (UTAMAKAN SELL PULLBACK / TUNGGU ${tsv.narrowTriggerTf} BREAK $${tsv.narrowPullbackHighToBreak.toFixed(1)})`;
    priorityBadgeEn = `BEARISH BIAS · IN DISCOUNT (${positionPct.toFixed(0)}%) BUT NO ${tsv.narrowTriggerTf} CHoCH YET (PRIORITIZE SELL PULLBACK / WAIT ${tsv.narrowTriggerTf} BREAK $${tsv.narrowPullbackHighToBreak.toFixed(1)})`;
    analogyHeadlineId = `Waspada Momentum Turun di Area DISCOUNT (${positionPct.toFixed(0)}%) — Belum Ada CHoCH ${tsv.narrowTriggerTf} (> $${tsv.narrowPullbackHighToBreak.toFixed(1)})`;
    analogyHeadlineEn = `Impulsive Drop in DISCOUNT (${positionPct.toFixed(0)}%) — No ${tsv.narrowTriggerTf} CHoCH Yet (> $${tsv.narrowPullbackHighToBreak.toFixed(1)})`;
    analogyExplanationId = `Aturan SMC Anti-Pisau Jatuh: Walaupun harga berada di zona Discount (${positionPct.toFixed(0)}%, di bawah EQ $${equilibriumPrice.toFixed(2)}), kita TIDAK BISA otomatis menganggap harga akan berhenti dan naik karena candle ${tsv.narrowTriggerTf} belum menembus puncak pullback terakhir ($${tsv.narrowPullbackHighToBreak.toFixed(1)}) secara body. Selama belum ada CHoCH ${tsv.narrowTriggerTf}, seller masih mendominasi (prioritaskan Sell Limit saat pantulan, atau tunggu candle ${tsv.narrowTriggerTf} close di atas $${tsv.narrowPullbackHighToBreak.toFixed(1)} baru cari Buy OB Sehat).`;
    analogyExplanationEn = `Anti-Falling-Knife SMC Rule: Although price is in Discount (${positionPct.toFixed(0)}%, below EQ $${equilibriumPrice.toFixed(2)}), we cannot assume a reversal until ${tsv.narrowTriggerTf} closes above the last pullback high ($${tsv.narrowPullbackHighToBreak.toFixed(1)}). Prioritize Sell Limit on retracement, or wait for ${tsv.narrowTriggerTf} CHoCH above $${tsv.narrowPullbackHighToBreak.toFixed(1)} before taking Buy.`;
  } else if (tsv.isImpulsiveRallyWithoutChoch) {
    // CRITICAL SMC RULE: Price is in Premium, but rallying impulsively WITHOUT M5/1H CHoCH (pullback low not broken by body)!
    priorityCode = 'WAIT_PULLBACK_BUY';
    recommendedSide = 'BUY';
    priorityBadgeId = `BIAS BULLISH · HARGA DI PREMIUM (${positionPct.toFixed(0)}%) TAPI BELUM ADA CHoCH ${tsv.narrowTriggerTf} (UTAMAKAN BUY PULLBACK / TUNGGU ${tsv.narrowTriggerTf} BREAK $${tsv.narrowPullbackLowToBreak.toFixed(1)})`;
    priorityBadgeEn = `BULLISH BIAS · IN PREMIUM (${positionPct.toFixed(0)}%) BUT NO ${tsv.narrowTriggerTf} CHoCH YET (PRIORITIZE BUY PULLBACK / WAIT ${tsv.narrowTriggerTf} BREAK $${tsv.narrowPullbackLowToBreak.toFixed(1)})`;
    analogyHeadlineId = `Waspada Momentum Naik di Area PREMIUM (${positionPct.toFixed(0)}%) — Belum Ada CHoCH ${tsv.narrowTriggerTf} (< $${tsv.narrowPullbackLowToBreak.toFixed(1)})`;
    analogyHeadlineEn = `Impulsive Rally in PREMIUM (${positionPct.toFixed(0)}%) — No ${tsv.narrowTriggerTf} CHoCH Yet (< $${tsv.narrowPullbackLowToBreak.toFixed(1)})`;
    analogyExplanationId = `Aturan SMC Momentum: Walaupun harga berada di zona Premium (${positionPct.toFixed(0)}%, di atas EQ $${equilibriumPrice.toFixed(2)}), kita TIDAK BISA otomatis menebak pucuk Sell karena candle ${tsv.narrowTriggerTf} belum menembus dasar pullback terakhir ($${tsv.narrowPullbackLowToBreak.toFixed(1)}) secara body. Selama belum ada CHoCH ${tsv.narrowTriggerTf}, buyer masih mendominasi (prioritaskan Buy Limit saat koreksi, atau tunggu candle ${tsv.narrowTriggerTf} close di bawah $${tsv.narrowPullbackLowToBreak.toFixed(1)} baru cari Sell OB Sehat).`;
    analogyExplanationEn = `Momentum SMC Rule: Although price is in Premium (${positionPct.toFixed(0)}%, above EQ $${equilibriumPrice.toFixed(2)}), we cannot call a top until ${tsv.narrowTriggerTf} closes below the last pullback low ($${tsv.narrowPullbackLowToBreak.toFixed(1)}). Prioritize Buy Limit on pullback, or wait for ${tsv.narrowTriggerTf} CHoCH below $${tsv.narrowPullbackLowToBreak.toFixed(1)} before taking Sell.`;
  } else if (dominantCycleBias === 'BULLISH' && pdZone === 'DISCOUNT') {
    priorityCode = 'PRIORITIZE_BUY';
    recommendedSide = 'BUY';
    priorityBadgeId = `PRIORITAS CYCLE: UTAMAKAN OPSI BUY (DISCOUNT ${positionPct.toFixed(0)}% + CHoCH ${tsv.narrowTriggerTf} VALID)`;
    priorityBadgeEn = `CYCLE PRIORITY: PRIORITIZE BUY OPTION (DISCOUNT ${positionPct.toFixed(0)}% + VALID ${tsv.narrowTriggerTf} CHoCH)`;
    analogyHeadlineId = `Struktur ${tsv.structureAnchorTf} BULLISH, Harga di DISCOUNT (${positionPct.toFixed(0)}%) & CHoCH ${tsv.narrowTriggerTf} Valid — Fokus Utama Opsi BUY`;
    analogyHeadlineEn = `${tsv.structureAnchorTf} Structure BULLISH, Price in DISCOUNT (${positionPct.toFixed(0)}%) & Valid ${tsv.narrowTriggerTf} CHoCH — Primary Focus on BUY`;
    analogyExplanationId = `Analogi Struktur Cycle: Harga berada di zona murah / DISCOUNT (${positionPct.toFixed(0)}%, di bawah EQ $${equilibriumPrice.toFixed(2)}) dan candle ${tsv.narrowTriggerTf} telah menembus pullback ($${tsv.narrowPullbackHighToBreak.toFixed(1)}) secara body. Buyer terbukti sudah masuk — utamakan OPSI BUY di Order Block Sehat (OB + FVG + Anti-Sweep).`;
    analogyExplanationEn = `Cycle Structure Analogy: Price sits in DISCOUNT (${positionPct.toFixed(0)}%, below EQ $${equilibriumPrice.toFixed(2)}) and ${tsv.narrowTriggerTf} broke pullback ($${tsv.narrowPullbackHighToBreak.toFixed(1)}) by body. Buyers stepped in — prioritize BUY in a Healthy OB (OB + FVG + Anti-Sweep).`;
  } else if (dominantCycleBias === 'BEARISH' && pdZone === 'PREMIUM') {
    priorityCode = 'PRIORITIZE_SELL';
    recommendedSide = 'SELL';
    priorityBadgeId = `PRIORITAS CYCLE: UTAMAKAN OPSI SELL (PREMIUM ${positionPct.toFixed(0)}% + CHoCH ${tsv.narrowTriggerTf} VALID)`;
    priorityBadgeEn = `CYCLE PRIORITY: PRIORITIZE SELL OPTION (PREMIUM ${positionPct.toFixed(0)}% + VALID ${tsv.narrowTriggerTf} CHoCH)`;
    analogyHeadlineId = `Struktur ${tsv.structureAnchorTf} BEARISH, Harga di PREMIUM (${positionPct.toFixed(0)}%) & CHoCH ${tsv.narrowTriggerTf} Valid — Fokus Utama Opsi SELL`;
    analogyHeadlineEn = `${tsv.structureAnchorTf} Structure BEARISH, Price in PREMIUM (${positionPct.toFixed(0)}%) & Valid ${tsv.narrowTriggerTf} CHoCH — Primary Focus on SELL`;
    analogyExplanationId = `Analogi Struktur Cycle: Harga berada di zona mahal / PREMIUM (${positionPct.toFixed(0)}%, di atas EQ $${equilibriumPrice.toFixed(2)}) dan candle ${tsv.narrowTriggerTf} telah menembus pullback ($${tsv.narrowPullbackLowToBreak.toFixed(1)}) secara body. Seller terbukti sudah masuk — utamakan OPSI SELL di Order Block Sehat (OB + FVG + Anti-Sweep).`;
    analogyExplanationEn = `Cycle Structure Analogy: Price sits in PREMIUM (${positionPct.toFixed(0)}%, above EQ $${equilibriumPrice.toFixed(2)}) and ${tsv.narrowTriggerTf} broke pullback ($${tsv.narrowPullbackLowToBreak.toFixed(1)}) by body. Sellers stepped in — prioritize SELL in a Healthy OB (OB + FVG + Anti-Sweep).`;
  } else if (dominantCycleBias === 'BULLISH' && pdZone === 'PREMIUM') {
    priorityCode = 'WAIT_PULLBACK_BUY';
    recommendedSide = 'BUY';
    priorityBadgeId = `PRIORITAS CYCLE: BIAS BULLISH · PASANG BUY LIMIT DI BAWAH (TUNGGU KOREKSI DARI PREMIUM ${positionPct.toFixed(0)}%)`;
    priorityBadgeEn = `CYCLE PRIORITY: BULLISH BIAS · SET BUY LIMIT BELOW (WAIT FOR PULLBACK FROM PREMIUM ${positionPct.toFixed(0)}%)`;
    analogyHeadlineId = `Struktur ${tsv.structureAnchorTf} BULLISH, Namun Harga Saat Ini di PREMIUM (${positionPct.toFixed(0)}%) — Pasang Buy Limit di Area Koreksi Bawah`;
    analogyHeadlineEn = `${tsv.structureAnchorTf} Structure BULLISH, Currently in PREMIUM (${positionPct.toFixed(0)}%) — Set Buy Limit at Lower Pullback OB`;
    analogyExplanationId = `Analogi Struktur Cycle: Tren utama masih BULLISH, tetapi harga saat ini sedang tinggi di PREMIUM (${positionPct.toFixed(0)}%, di atas EQ $${equilibriumPrice.toFixed(2)}). Jangan kejar Buy Market di pucuk; gunakan angka Buy Limit di bawah harga saat ini (menunggu koreksi ke OB Sehat). Opsi Sell hanya valid jika candle ${tsv.narrowTriggerTf} menjebol pullback $${tsv.narrowPullbackLowToBreak.toFixed(1)} secara body.`;
    analogyExplanationEn = `Cycle Structure Analogy: Primary trend is BULLISH, but price is currently in PREMIUM (${positionPct.toFixed(0)}%, above EQ $${equilibriumPrice.toFixed(2)}). Use Buy Limit orders below current price on pullback. Sell is only valid if ${tsv.narrowTriggerTf} breaks below $${tsv.narrowPullbackLowToBreak.toFixed(1)} by body.`;
  } else if (dominantCycleBias === 'BEARISH' && pdZone === 'DISCOUNT') {
    priorityCode = 'WAIT_PULLBACK_SELL';
    recommendedSide = 'SELL';
    priorityBadgeId = `PRIORITAS CYCLE: BIAS BEARISH · PASANG SELL LIMIT DI ATAS (TUNGGU PANTULAN DARI DISCOUNT ${positionPct.toFixed(0)}%)`;
    priorityBadgeEn = `CYCLE PRIORITY: BEARISH BIAS · SET SELL LIMIT ABOVE (WAIT FOR BOUNCE FROM DISCOUNT ${positionPct.toFixed(0)}%)`;
    analogyHeadlineId = `Struktur ${tsv.structureAnchorTf} BEARISH, Namun Harga Saat Ini di DISCOUNT (${positionPct.toFixed(0)}%) — Pasang Sell Limit di Area Pantulan Atas`;
    analogyHeadlineEn = `${tsv.structureAnchorTf} Structure BEARISH, Currently in DISCOUNT (${positionPct.toFixed(0)}%) — Set Sell Limit at Upper Retracement OB`;
    analogyExplanationId = `Analogi Struktur Cycle: Tren struktur masih BEARISH, tetapi harga saat ini sedang rendah di DISCOUNT (${positionPct.toFixed(0)}%, di bawah EQ $${equilibriumPrice.toFixed(2)}). Jangan kejar Sell Market di dasar; gunakan angka Sell Limit di atas harga saat ini (menunggu pantulan ke OB Sehat). Opsi Buy hanya valid jika candle ${tsv.narrowTriggerTf} menjebol pullback $${tsv.narrowPullbackHighToBreak.toFixed(1)} secara body.`;
    analogyExplanationEn = `Cycle Structure Analogy: Structure trend is BEARISH, but price is currently in DISCOUNT (${positionPct.toFixed(0)}%, below EQ $${equilibriumPrice.toFixed(2)}). Use Sell Limit orders above current price on bounce. Buy is only valid if ${tsv.narrowTriggerTf} breaks above $${tsv.narrowPullbackHighToBreak.toFixed(1)} by body.`;
  } else if (dominantCycleBias === 'BULLISH') {
    // Dominant Cycle is BULLISH and price is at EQUILIBRIUM (~45–55%): keep recommendation strictly BUY!
    const waitingPullbackConfirmation = tsv.narrowBearishChochValid && !tsv.narrowBullishChochValid;
    recommendedSide = 'BUY';
    priorityCode = waitingPullbackConfirmation ? 'WAIT_PULLBACK_BUY' : 'PRIORITIZE_BUY';
    priorityBadgeId = `PRIORITAS CYCLE: BULLISH (${master.uptrendPct}%) · ZONA EQUILIBRIUM (${positionPct.toFixed(0)}%) — UTAMAKAN BUY LIMIT`;
    priorityBadgeEn = `CYCLE PRIORITY: BULLISH (${master.uptrendPct}%) · EQUILIBRIUM (${positionPct.toFixed(0)}%) — PRIORITIZE BUY LIMIT`;
    analogyHeadlineId = `Cycle BULLISH (${master.uptrendPct}%), Harga di Area Tengah EQ ($${equilibriumPrice.toFixed(2)}) — Fokus Opsi BUY Limit Bawah`;
    analogyHeadlineEn = `Cycle BULLISH (${master.uptrendPct}%), Price Near EQ ($${equilibriumPrice.toFixed(2)}) — Focus on Lower BUY Limit`;
    analogyExplanationId = `Probabilitas Cycle dominan BULLISH (${master.uptrendPct}% Uptrend) dan harga berada di sekitar garis tengah Equilibrium ($${equilibriumPrice.toFixed(2)}). Tetap utamakan OPSI BUY di Order Block Sehat area bawah/Discount dengan validasi CHoCH ${tsv.narrowTriggerTf} (> $${tsv.narrowPullbackHighToBreak.toFixed(1)}).`;
    analogyExplanationEn = `Cycle probability is dominantly BULLISH (${master.uptrendPct}% Uptrend) with price near Equilibrium ($${equilibriumPrice.toFixed(2)}). Prioritize BUY options at lower Healthy OB / Discount zones with ${tsv.narrowTriggerTf} CHoCH validation (> $${tsv.narrowPullbackHighToBreak.toFixed(1)}).`;
  } else if (dominantCycleBias === 'BEARISH') {
    // Dominant Cycle is BEARISH and price is at EQUILIBRIUM (~45–55%): keep recommendation strictly SELL!
    const waitingBounceConfirmation = tsv.narrowBullishChochValid && !tsv.narrowBearishChochValid;
    recommendedSide = 'SELL';
    priorityCode = waitingBounceConfirmation ? 'WAIT_PULLBACK_SELL' : 'PRIORITIZE_SELL';
    priorityBadgeId = `PRIORITAS CYCLE: BEARISH (${master.downtrendPct}%) · ZONA EQUILIBRIUM (${positionPct.toFixed(0)}%) — UTAMAKAN SELL LIMIT`;
    priorityBadgeEn = `CYCLE PRIORITY: BEARISH (${master.downtrendPct}%) · EQUILIBRIUM (${positionPct.toFixed(0)}%) — PRIORITIZE SELL LIMIT`;
    analogyHeadlineId = `Cycle BEARISH (${master.downtrendPct}%), Harga di Area Tengah EQ ($${equilibriumPrice.toFixed(2)}) — Fokus Opsi SELL Limit Atas`;
    analogyHeadlineEn = `Cycle BEARISH (${master.downtrendPct}%), Price Near EQ ($${equilibriumPrice.toFixed(2)}) — Focus on Upper SELL Limit`;
    analogyExplanationId = `Probabilitas Cycle dominan BEARISH (${master.downtrendPct}% Downtrend) dan harga berada di sekitar garis tengah Equilibrium ($${equilibriumPrice.toFixed(2)}). Tetap utamakan OPSI SELL di Order Block Sehat area atas/Premium dengan validasi CHoCH ${tsv.narrowTriggerTf} (< $${tsv.narrowPullbackLowToBreak.toFixed(1)}).`;
    analogyExplanationEn = `Cycle probability is dominantly BEARISH (${master.downtrendPct}% Downtrend) with price near Equilibrium ($${equilibriumPrice.toFixed(2)}). Prioritize SELL options at upper Healthy OB / Premium zones with ${tsv.narrowTriggerTf} CHoCH validation (< $${tsv.narrowPullbackLowToBreak.toFixed(1)}).`;
  } else {
    // True NEUTRAL Cycle (e.g. Gatekeeper Locked / balanced probability 46–54%): determine tactical lean conservatively
    const leanBuy =
      mtfAnalysis.structureBias === 'BULLISH'
        ? true
        : mtfAnalysis.structureBias === 'BEARISH'
        ? false
        : tsv.narrowBullishChochValid
        ? true
        : tsv.narrowBearishChochValid
        ? false
        : master.uptrendPct !== master.downtrendPct
        ? master.uptrendPct > master.downtrendPct
        : pdZone === 'DISCOUNT';
    recommendedSide = leanBuy ? 'BUY' : 'SELL';
    priorityCode = leanBuy ? 'PRIORITIZE_BUY' : 'PRIORITIZE_SELL';
    priorityBadgeId = leanBuy
      ? `CYCLE NETRAL (${master.uptrendPct}%/${master.downtrendPct}%) · CONDONG OPSI BUY (ZONA ${pdZone} ${positionPct.toFixed(0)}% · TUNGGU CHoCH ${tsv.narrowTriggerTf} > $${tsv.narrowPullbackHighToBreak.toFixed(1)})`
      : `CYCLE NETRAL (${master.uptrendPct}%/${master.downtrendPct}%) · CONDONG OPSI SELL (ZONA ${pdZone} ${positionPct.toFixed(0)}% · TUNGGU CHoCH ${tsv.narrowTriggerTf} < $${tsv.narrowPullbackLowToBreak.toFixed(1)})`;
    priorityBadgeEn = leanBuy
      ? `CYCLE NEUTRAL (${master.uptrendPct}%/${master.downtrendPct}%) · LEAN BUY OPTION (${pdZone} ${positionPct.toFixed(0)}% · WAIT ${tsv.narrowTriggerTf} CHoCH > $${tsv.narrowPullbackHighToBreak.toFixed(1)})`
      : `CYCLE NEUTRAL (${master.uptrendPct}%/${master.downtrendPct}%) · LEAN SELL OPTION (${pdZone} ${positionPct.toFixed(0)}% · WAIT ${tsv.narrowTriggerTf} CHoCH < $${tsv.narrowPullbackLowToBreak.toFixed(1)})`;
    analogyHeadlineId = `Cycle NETRAL (${master.uptrendPct}%/${master.downtrendPct}%) di Sekitar ${pdZone} ($${equilibriumPrice.toFixed(2)}) — Condong ${recommendedSide} dengan Verifikasi CHoCH ${tsv.narrowTriggerTf}`;
    analogyHeadlineEn = `Cycle NEUTRAL (${master.uptrendPct}%/${master.downtrendPct}%) Near ${pdZone} ($${equilibriumPrice.toFixed(2)}) — Lean ${recommendedSide} with ${tsv.narrowTriggerTf} CHoCH Verification`;
    analogyExplanationId = `Analogi Struktur Cycle: Skor Cycle saat ini masih NETRAL (${master.uptrendPct}% Uptrend vs ${master.downtrendPct}% Downtrend) di dekat titik Equilibrium ($${equilibriumPrice.toFixed(2)}). Sambil menunggu distribusi/Gatekeeper terbuka penuh, condongkan pantauan ke OPSI ${recommendedSide} hanya jika CHoCH ${tsv.narrowTriggerTf} dan OB Sehat (OB + FVG + Anti-Sweep) terkonfirmasi.`;
    analogyExplanationEn = `Cycle Structure Analogy: Cycle score is currently NEUTRAL (${master.uptrendPct}% Uptrend vs ${master.downtrendPct}% Downtrend) near Equilibrium ($${equilibriumPrice.toFixed(2)}). Wait for ${tsv.narrowTriggerTf} CHoCH and a Healthy OB (OB + FVG + Anti-Sweep) before taking the ${recommendedSide} lean.`;
  }

  const amdPhaseLabelId = master.amdState?.adaptiveRegimeBadgeId || 'SIKLUS AMD NORMAL';
  const amdSessionLabelId = master.amdState
    ? getSessionLabelId(master.amdState.currentSession)
    : 'New York / London';

  const cycleCompass: SmcCycleCompass = {
    tradingMode,
    htfLabel,
    mtfLabel,
    ltfLabel,
    htfBias: htfAnalysis.structureBias,
    mtfBias: mtfAnalysis.structureBias,
    ltfBias: ltfAnalysis.structureBias,
    dominantCycleBias,
    cycleUptrendPct: master.uptrendPct,
    cycleDowntrendPct: master.downtrendPct,
    cycleDominantDirection: master.dominantDirection,
    pdZone,
    positionPct,
    rangeLow,
    rangeHigh,
    equilibriumPrice,
    amdPhaseLabelId,
    amdSessionLabelId,
    priorityCode,
    recommendedSide,
    priorityBadgeId,
    priorityBadgeEn,
    analogyHeadlineId,
    analogyHeadlineEn,
    analogyExplanationId,
    analogyExplanationEn,
    twoStageValidation: tsv,
    rawMacroContext: master.rawMacroContext,
  };

  const buyOption = buildDirectionalSmcPlan({
    direction: 'BUY',
    tradingMode,
    spotPrice,
    htfAnalysis,
    mtfAnalysis,
    ltfAnalysis,
    ltfCandles,
    mtfCandles,
    amdState: master.amdState,
    recommendedSide,
    priorityCode,
  });

  const sellOption = buildDirectionalSmcPlan({
    direction: 'SELL',
    tradingMode,
    spotPrice,
    htfAnalysis,
    mtfAnalysis,
    ltfAnalysis,
    ltfCandles,
    mtfCandles,
    amdState: master.amdState,
    recommendedSide,
    priorityCode,
  });

  const buildLimitGroupsForSide = (
    side: 'BUY' | 'SELL',
    plan: SmcDirectionalSignalPlan
  ): SmcLimitOrderSetup[] => {
    const isBuy = side === 'BUY';
    const span = Math.max(4.0, rangeHigh - rangeLow);

    // Fixed SL Rule: 50 pips ($5.00) + 20 point ($0.20 slippage buffer) = $5.20 total distance
    const FIXED_SL_PIPS = 50;
    const FIXED_SL_POINTS = 20;
    const BASE_RISK_USD = 5.0;        // 50 pips ($5.00)
    const SLIPPAGE_BUFFER_USD = 0.20; // 20 point ($0.20)
    const TOTAL_SL_OFFSET_USD = BASE_RISK_USD + SLIPPAGE_BUFFER_USD; // $5.20
    const TP2_OFFSET_USD = 10.0;      // Strictly 1:2 (100 pips = $10.00)

    // Gather all timeframe candle arrays (including 4h & 1day when available for big-picture mapping)
    const tfSources: Array<{ tf: string; weight: number; candles: ConfluenceCandle[] }> = [
      { tf: '4h', weight: 28, candles: candlesByTf['4h'] || [] },
      { tf: '1h', weight: 26, candles: candlesByTf['1h'] || [] },
      { tf: '15min', weight: 20, candles: candlesByTf['15min'] || [] },
      { tf: '1day', weight: 22, candles: candlesByTf['1day'] || [] },
      { tf: '5min', weight: 12, candles: candlesByTf['5min'] || [] },
    ];

    // Collect all fractal Swing Highs & Swing Lows across all loaded timeframes for TP max & structural mapping
    const fractalHighs: number[] = [
      ltfAnalysis.swingHigh,
      mtfAnalysis.swingHigh,
      htfAnalysis.swingHigh,
      master.amdState?.nearestBslPrice ?? 0,
      spotPrice,
    ];
    const fractalLows: number[] = [
      ltfAnalysis.swingLow,
      mtfAnalysis.swingLow,
      htfAnalysis.swingLow,
      master.amdState?.nearestSslPrice ?? 0,
      spotPrice,
    ];

    interface MultiTfObCandidate {
      entryPrice: number;
      distanceUsd: number; // Positive distance away from spotPrice in the limit direction
      score: number;
      isHealthy: boolean;
      tf: string;
    }

    const obCandidates: MultiTfObCandidate[] = [];

    for (const src of tfSources) {
      const bars = src.candles;
      if (!Array.isArray(bars) || bars.length < 6) continue;

      const tfAtr = Math.max(0.5, computeAtr14(bars));
      fractalHighs.push(Math.max(...bars.map((b) => b.high)));
      fractalLows.push(Math.min(...bars.map((b) => b.low)));

      // Extract 2-bar fractal swing highs and swing lows across full 150-bar history
      for (let i = 2; i < bars.length - 2; i++) {
        const h = bars[i].high;
        const l = bars[i].low;
        if (
          h >= bars[i - 1].high &&
          h >= bars[i - 2].high &&
          h >= bars[i + 1].high &&
          h >= bars[i + 2].high
        ) {
          fractalHighs.push(h);
        }
        if (
          l <= bars[i - 1].low &&
          l <= bars[i - 2].low &&
          l <= bars[i + 1].low &&
          l <= bars[i + 2].low
        ) {
          fractalLows.push(l);
        }
      }

      // Scan full candle history for unmitigated Bullish (for BUY) or Bearish (for SELL) Order Blocks
      for (let i = 1; i <= bars.length - 3; i++) {
        const cOb = bars[i];
        const cImp = bars[i + 1];
        const cFvg = bars[i + 2];
        const impRange = Math.max(0.01, cImp.high - cImp.low);
        const impBody = Math.abs(cImp.close - cImp.open);
        const bodyRatio = impBody / impRange;

        if (isBuy) {
          const isBullishImpulse = cImp.close > cImp.open && cImp.close > cOb.high;
          if (!isBullishImpulse) continue;

          const notSweptByImpulsive = cImp.low >= cOb.low;
          const hasFvgAfter = cFvg.low > cOb.high;
          const isImpulsive = impBody >= tfAtr * 0.35 || bodyRatio >= 0.52;
          const laterBars = bars.slice(i + 3, Math.max(i + 3, bars.length - 1));
          const isUnmitigated = laterBars.every((b) => b.low >= cOb.low);

          const obLow = cOb.low;
          const fvgHigh = Math.max(cOb.high, cFvg.low);
          const entryPrice = Number(((obLow + fvgHigh) / 2).toFixed(1));

          // Buy Limit must sit strictly below real-time spotPrice
          const distanceUsd = spotPrice - entryPrice;
          if (distanceUsd < 4.5 || distanceUsd > 40.0) continue;

          const isHealthy = hasFvgAfter && notSweptByImpulsive && isImpulsive && isUnmitigated;
          let score = src.weight;
          if (isHealthy) score += 100;
          if (hasFvgAfter) score += 35;
          if (notSweptByImpulsive) score += 30;
          if (isUnmitigated) score += 25;
          if (isImpulsive) score += 12;

          obCandidates.push({
            entryPrice,
            distanceUsd,
            score,
            isHealthy,
            tf: src.tf,
          });
        } else {
          const isBearishImpulse = cImp.close < cImp.open && cImp.close < cOb.low;
          if (!isBearishImpulse) continue;

          const notSweptByImpulsive = cImp.high <= cOb.high;
          const hasFvgAfter = cFvg.high < cOb.low;
          const isImpulsive = impBody >= tfAtr * 0.35 || bodyRatio >= 0.52;
          const laterBars = bars.slice(i + 3, Math.max(i + 3, bars.length - 1));
          const isUnmitigated = laterBars.every((b) => b.high <= cOb.high);

          const obHigh = cOb.high;
          const fvgLow = Math.min(cOb.low, cFvg.high);
          const entryPrice = Number(((obHigh + fvgLow) / 2).toFixed(1));

          // Sell Limit must sit strictly above real-time spotPrice
          const distanceUsd = entryPrice - spotPrice;
          if (distanceUsd < 4.5 || distanceUsd > 40.0) continue;

          const isHealthy = hasFvgAfter && notSweptByImpulsive && isImpulsive && isUnmitigated;
          let score = src.weight;
          if (isHealthy) score += 100;
          if (hasFvgAfter) score += 35;
          if (notSweptByImpulsive) score += 30;
          if (isUnmitigated) score += 25;
          if (isImpulsive) score += 12;

          obCandidates.push({
            entryPrice,
            distanceUsd,
            score,
            isHealthy,
            tf: src.tf,
          });
        }
      }
    }

    const allStructuralHighs = fractalHighs.filter((v) => Number.isFinite(v) && v > 0);
    const allStructuralLows = fractalLows.filter((v) => Number.isFinite(v) && v > 0);

    // Helper to pick the highest-ranked OB candidate inside a structural distance window (in USD from spotPrice)
    const pickBestCandidateInWindow = (
      minDistUsd: number,
      maxDistUsd: number,
      idealDistUsd: number
    ): number | null => {
      const inWindow = obCandidates.filter(
        (c) => c.distanceUsd >= minDistUsd && c.distanceUsd <= maxDistUsd
      );
      if (inWindow.length > 0) {
        inWindow.sort((a, b) => {
          const proximityPenaltyA = Math.abs(a.distanceUsd - idealDistUsd) * 1.5;
          const proximityPenaltyB = Math.abs(b.distanceUsd - idealDistUsd) * 1.5;
          return b.score - proximityPenaltyB - (a.score - proximityPenaltyA);
        });
        return inWindow[0].entryPrice;
      }

      // Secondary check: look for fractal Swing Lows (for BUY) or Swing Highs (for SELL) in that window
      const swingPool = isBuy ? allStructuralLows : allStructuralHighs;
      const validSwings = swingPool
        .map((price) => ({
          price: Number(price.toFixed(1)),
          dist: isBuy ? spotPrice - price : price - spotPrice,
        }))
        .filter((s) => s.dist >= minDistUsd && s.dist <= maxDistUsd)
        .sort((a, b) => Math.abs(a.dist - idealDistUsd) - Math.abs(b.dist - idealDistUsd));

      if (validSwings.length > 0) {
        return validSwings[0].price;
      }
      return null;
    };

    // Helper to build a single group card given an Entry Limit price
    const createGroupCard = (
      id: string,
      tier: SmcLimitOrderSetup['tier'],
      headerTitle: string,
      isActiveNow: boolean,
      rawEntry: number
    ): SmcLimitOrderSetup => {
      const entryLimit = Number(rawEntry.toFixed(1));

      // SL: Consistently 50 pips ($5.00) + 20 point ($0.20) = $5.20 from Entry Limit
      const stopLoss = isBuy
        ? Number((entryLimit - TOTAL_SL_OFFSET_USD).toFixed(1))
        : Number((entryLimit + TOTAL_SL_OFFSET_USD).toFixed(1));

      // TP 1 (1:1): At least 50 pips ($5.00), or 50–70 pips ($5.00–$7.00) if Equilibrium / internal structure sits in that pocket
      const distToEq = isBuy ? equilibriumPrice - entryLimit : entryLimit - equilibriumPrice;
      const tp1OffsetUsd =
        distToEq >= 5.0 && distToEq <= 7.5
          ? Number(distToEq.toFixed(1))
          : span >= 14.0
          ? 7.0 // 70 pips (1:1 above 50 pips, matching 3770.7 -> 3763.7 example)
          : 5.0; // 50 pips (1:1)
      const tp1Pips = Math.round(tp1OffsetUsd * 10);
      const tp1 = isBuy
        ? Number((entryLimit + tp1OffsetUsd).toFixed(1))
        : Number((entryLimit - tp1OffsetUsd).toFixed(1));

      // TP 2 (1:2): Strictly 1:2 (100 pips = $10.00)
      const tp2 = isBuy
        ? Number((entryLimit + TP2_OFFSET_USD).toFixed(1))
        : Number((entryLimit - TP2_OFFSET_USD).toFixed(1));

      // TP max: Identify last structural Swing High (for BUY) or Swing Low (for SELL) beyond TP 2 (min 1:3 / $15.0, capped at realistic HTF target)
      let tpMax: number;
      if (isBuy) {
        const minTpMax = entryLimit + 15.0; // At least 1:3 (150 pips)
        const maxTpMax = entryLimit + 35.0; // Realistic cap (1:7)
        const validHighs = allStructuralHighs
          .filter((h) => h >= minTpMax && h <= maxTpMax)
          .sort((a, b) => a - b);
        const targetHigh =
          validHighs.length > 0
            ? validHighs[validHighs.length - 1]
            : entryLimit + 20.0; // Default 1:4 (200 pips)
        tpMax = Number(targetHigh.toFixed(1));
      } else {
        const maxTpMaxPrice = entryLimit - 15.0; // At least 1:3 (150 pips below entry)
        const minTpMaxPrice = entryLimit - 35.0; // Realistic cap (1:7)
        const validLows = allStructuralLows
          .filter((l) => l <= maxTpMaxPrice && l >= minTpMaxPrice)
          .sort((a, b) => b - a);
        const targetLow =
          validLows.length > 0
            ? validLows[validLows.length - 1]
            : entryLimit - 20.0; // Default 1:4 (200 pips)
        tpMax = Number(targetLow.toFixed(1));
      }

      const rawRr = Math.max(3, Math.round((Math.abs(tpMax - entryLimit) / BASE_RISK_USD) * 2) / 2);
      const tpMaxRrLabel = `1:${Number.isInteger(rawRr) ? rawRr.toFixed(0) : rawRr.toFixed(1)}`;

      return {
        id,
        direction: side,
        tier,
        headerTitle,
        isActiveNow,
        entryLimit,
        stopLoss,
        slPips: FIXED_SL_PIPS,
        slPoints: FIXED_SL_POINTS,
        tp1,
        tp1Pips,
        tp2,
        tpMax,
        tpMaxRrLabel,
      };
    };

    // Structural distance horizons from real-time spotPrice (10 pips = $1.00 on XAU/USD):
    // - SCALP mode maps big-picture 1H/4H/M15 structure:
    //   * High Risk (Internal OB before IDM sweep): 65–95 pips ($6.5–$9.5) from spot
    //   * Setup A+ (Primary Healthy OB + FVG):      120–185 pips ($12.0–$18.5) from spot
    //   * Setup B (Extreme Swing Origin OB):        190–275 pips ($19.0–$27.5) from spot
    // - SWING (Intraday D1/4H/1H) mode maps even wider structural horizons.
    const isSwing = tradingMode === 'SWING';

    const aPlusMinDist = isSwing ? 14.5 : 11.8; // 118–145 pips
    const aPlusMaxDist = isSwing ? 22.0 : 18.5; // 185–220 pips
    const aPlusIdealDist = isSwing ? 17.5 : 14.2; // ~142 pips ($14.2) default structural anchor

    const bMinDist = isSwing ? 22.5 : 19.0; // 190–225 pips
    const bMaxDist = isSwing ? 33.0 : 28.0; // 280–330 pips
    const bIdealDist = isSwing ? 26.5 : 22.0; // ~220 pips ($22.0) default extreme OB anchor

    const hrMinDist = isSwing ? 8.0 : 6.2; // 62–80 pips
    const hrMaxDist = isSwing ? 12.5 : 9.8; // 98–125 pips
    const hrIdealDist = isSwing ? 9.8 : 7.6; // ~76 pips ($7.6) default internal OB anchor

    // 1. Setup A+ Entry (120–185 pips from real-time spotPrice in SCALP)
    const matchedAPlus = pickBestCandidateInWindow(aPlusMinDist, aPlusMaxDist, aPlusIdealDist);
    const fallbackAPlus = isBuy
      ? Number((spotPrice - aPlusIdealDist).toFixed(1))
      : Number((spotPrice + aPlusIdealDist).toFixed(1));
    const entryAPlus = matchedAPlus !== null ? matchedAPlus : fallbackAPlus;

    // 2. Setup B (Extreme OB: 190–275 pips from real-time spotPrice, at least 65 pips / $6.5 beyond Setup A+)
    const matchedB = pickBestCandidateInWindow(bMinDist, bMaxDist, bIdealDist);
    const minSeparationB = isSwing ? 8.0 : 6.8;
    const rawEntryB =
      matchedB !== null
        ? matchedB
        : isBuy
        ? spotPrice - bIdealDist
        : spotPrice + bIdealDist;
    const entryB = isBuy
      ? Number(Math.min(rawEntryB, entryAPlus - minSeparationB).toFixed(1))
      : Number(Math.max(rawEntryB, entryAPlus + minSeparationB).toFixed(1));

    // 3. Setup High Risk (First Internal OB: 62–98 pips from spotPrice, at least 55 pips / $5.5 closer than Setup A+)
    const matchedHr = pickBestCandidateInWindow(hrMinDist, hrMaxDist, hrIdealDist);
    const minSeparationHr = isSwing ? 6.5 : 5.5;
    const rawEntryHr =
      matchedHr !== null
        ? matchedHr
        : isBuy
        ? spotPrice - hrIdealDist
        : spotPrice + hrIdealDist;
    const entryHr = isBuy
      ? Number(
          clamp(
            rawEntryHr,
            entryAPlus + minSeparationHr,
            spotPrice - hrMinDist
          ).toFixed(1)
        )
      : Number(
          clamp(
            rawEntryHr,
            spotPrice + hrMinDist,
            entryAPlus - minSeparationHr
          ).toFixed(1)
        );

    const prefix = isBuy ? 'Buy Limit' : 'Sell Limit';

    return [
      createGroupCard(
        `${side.toLowerCase()}-a-plus`,
        'A_PLUS',
        `${prefix} A+`,
        plan.grade === 'SETUP_A_PLUS',
        entryAPlus
      ),
      createGroupCard(
        `${side.toLowerCase()}-b-standard`,
        'B_STANDARD',
        `${prefix} B (Extreme OB)`,
        plan.grade === 'WAIT_CONFIRMATION',
        entryB
      ),
      createGroupCard(
        `${side.toLowerCase()}-high-risk`,
        'HIGH_RISK',
        `${prefix} High Risk`,
        plan.grade === 'HIGH_RISK',
        entryHr
      ),
    ];
  };

  const buyLimitGroups = buildLimitGroupsForSide('BUY', buyOption);
  const sellLimitGroups = buildLimitGroupsForSide('SELL', sellOption);

  return {
    tradingMode,
    spotPrice,
    cycleCompass,
    buyOption,
    sellOption,
    buyLimitGroups,
    sellLimitGroups,
  };
}



