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
 * 2. Contextual Institutional SMC Analyzer per Timeframe
 * Implements:
 * - Dynamic POI Hierarchy: Layer 1 (Decisional FVG + Fibo OTE 0.57–0.70) vs Layer 2 (Extreme OB)
 * - Price Reaction Evaluation at POI Layer 1 (Wick Rejection / Vol Absorption / LTF MSS vs Full-Body Displacement)
 * - Strict Structural Swing (LH/HL) vs Internal Inducement (<50% Equilibrium) & Anti-Fake-BOS filter on M15/M5
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

  // Score calculation (0..100, >50 Bullish, <50 Bearish)
  let score = 50;
  if (structureBias === 'BULLISH') {
    score += hasVolumeSpike ? 22 : 12;
    if (reactionStatus === 'FVG_VALID_REVERSAL') score += 8;
  } else if (structureBias === 'BEARISH') {
    score -= hasVolumeSpike ? 22 : 12;
    if (reactionStatus === 'FVG_VALID_REVERSAL') score -= 8;
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
  const poiShortNote =
    reactionStatus === 'FVG_VALID_REVERSAL'
      ? `FVG Valid ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)})`
      : reactionStatus === 'TARGET_EXTREME_OB'
      ? `Incar Extreme OB ($${extremeObLow.toFixed(2)}–$${extremeObHigh.toFixed(2)})`
      : `OTE 0.57–0.70 ($${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)})`;

  const summaryId = `${structureSignal}${internalBounceFiltered ? ' (Tahan Pantulan Internal)' : ''} · ${pdNote} · ${poiShortNote} · ${volNote}`;

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

  // Measure recent Tokyo (ASIA) and London session ranges vs ATR(14) for Double Accumulation detection
  const recentWindow = candles.slice(-36);
  const tokyoCandles = recentWindow.filter((c) => getSessionWIB(c.time, sessionConfig) === 'ASIA');
  const londonCandles = recentWindow.filter((c) => getSessionWIB(c.time, sessionConfig) === 'LONDON');

  const tokyoHigh = tokyoCandles.length > 0 ? Math.max(...tokyoCandles.map((c) => c.high)) : 0;
  const tokyoLow = tokyoCandles.length > 0 ? Math.min(...tokyoCandles.map((c) => c.low)) : 0;
  const tokyoRange = tokyoHigh > tokyoLow ? tokyoHigh - tokyoLow : atr14;

  const londonHigh = londonCandles.length > 0 ? Math.max(...londonCandles.map((c) => c.high)) : 0;
  const londonLow = londonCandles.length > 0 ? Math.min(...londonCandles.map((c) => c.low)) : 0;
  const londonRange = londonHigh > londonLow ? londonHigh - londonLow : atr14;

  // Normalize per-bar average range across Tokyo & London against ATR(14) so multi-bar sessions scale accurately
  const tokyoAvgBarRange =
    tokyoCandles.length > 0
      ? tokyoCandles.reduce((acc, c) => acc + (c.high - c.low), 0) / tokyoCandles.length
      : atr14;
  const londonAvgBarRange =
    londonCandles.length > 0
      ? londonCandles.reduce((acc, c) => acc + (c.high - c.low), 0) / londonCandles.length
      : atr14;

  const tokyoRangeAtrRatio = Number((tokyoAvgBarRange / Math.max(0.1, atr14)).toFixed(2));
  const londonRangeAtrRatio = Number((londonAvgBarRange / Math.max(0.1, atr14)).toFixed(2));

  // Partition candles into contiguous session segments using the exact Cycle & Confluence session time division
  const sessionLiquidity = computeSessionLiquidityFromCandles(candles, sessionConfig, atr14);
  const detectedBox: AmdBox = sessionLiquidity.referenceBox;
  const boxEndIdx = sessionLiquidity.referenceBoxEndIdx;

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

  // Check Double Accumulation: Tokyo & London both compressed (<1.2x ATR) without sweeping each other
  const londonDidNotSweepTokyoBothSides =
    tokyoCandles.length >= 2 &&
    londonCandles.length >= 2 &&
    !(londonHigh > tokyoHigh + atr14 * 0.35 && londonLow < tokyoLow - atr14 * 0.35);

  const isDoubleAccumulation =
    tokyoCandles.length >= 2 &&
    londonCandles.length >= 2 &&
    tokyoRangeAtrRatio < 1.2 &&
    londonRangeAtrRatio < 1.2 &&
    londonDidNotSweepTokyoBothSides &&
    !sawSkipManipulationBreakout &&
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

  if (sawSkipManipulationBreakout) {
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
    // Check NY Session Anomaly
    const nyCandles = candles
      .slice(-10)
      .filter((c) => getSessionWIB(c.time, sessionConfig) === 'NEW_YORK');
    if (currentSession === 'NEW_YORK' && nyCandles.length >= 3) {
      const nyHigh = Math.max(...nyCandles.map((c) => c.high));
      const nyLow = Math.min(...nyCandles.map((c) => c.low));
      if (nyHigh - nyLow < atr14 * 1.35) {
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
  } = params;

  const seasonality = computeMonthlySeasonalityStats(
    XAUUSD_SEASONALITY.currentTargetMonthIndex,
    livePrice
  );
  const astronacci = calculateAstronacciCycle(referenceDate);

  const basicRawScore = 0.60 * seasonality.winRatePct + 0.40 * astronacci.astroScore;
  const basicScore = Number(clamp(basicRawScore, 5, 95).toFixed(1));

  // Analyze 1H first so its structural LH/HL lock can constrain M15 and M5 against fake internal BOS
  const oneHourAnalysis = analyzeTimeframeSmc(candlesByTf['1h'] || [], '1h');
  const htfConstraintForLtf: HtfStructuralConstraint = {
    htfBias: oneHourAnalysis.structureBias,
    protectedLevel: oneHourAnalysis.structuralLock.protectedSwingPrice,
    rangeLow: oneHourAnalysis.swingLow,
    rangeHigh: oneHourAnalysis.swingHigh,
  };

  const tfs = tradingMode === 'SWING' ? ['1day', '4h', '1h'] : ['1h', '15min', '5min'];
  const smcByTimeframe: Record<string, TimeframeSmcAnalysis> = {};
  for (const tf of tfs) {
    if (tf === '1h') {
      smcByTimeframe[tf] = oneHourAnalysis;
    } else if (tf === '15min' || tf === '5min') {
      const baseLtf = analyzeTimeframeSmc(candlesByTf[tf] || [], tf, htfConstraintForLtf);
      if (manualAmdOverride === 'POST_SWEEP_RANGING' && baseLtf.structureSignal !== 'RANGE') {
        const tfCandles = candlesByTf[tf] || [];
        const lastClose = tfCandles[tfCandles.length - 1]?.close ?? 0;
        const broke1hStructure =
          (oneHourAnalysis.swingHigh > 0 && lastClose > oneHourAnalysis.swingHigh) ||
          (oneHourAnalysis.swingLow > 0 && lastClose < oneHourAnalysis.swingLow);

        if (!broke1hStructure) {
          smcByTimeframe[tf] = {
            ...baseLtf,
            structureSignal: 'RANGE',
            structuralLock: {
              ...baseLtf.structuralLock,
              internalBounceFiltered: true,
              internalBounceNoteId: `Mode Ranging Pasca-Sweep aktif — sinyal ${baseLtf.structureSignal} pada ${tf.toUpperCase()} diredam hingga terbentuk displacement/MSS yang menembus struktur 1H ($${oneHourAnalysis.swingLow.toFixed(
                2
              )}–$${oneHourAnalysis.swingHigh.toFixed(2)}).`,
            },
            summaryId: `RANGE (Redam False BOS · Tunggu MSS 1H) · ${baseLtf.pdZone} (${baseLtf.positionPct.toFixed(0)}%)`,
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

  const htfScore = htfAnalysis?.score ?? 50;
  const ltfBlendedScore = ((mtfAnalysis?.score ?? 50) + (ltfAnalysis?.score ?? 50)) / 2;
  const smcCompositeScore = Number((0.60 * htfScore + 0.40 * ltfBlendedScore).toFixed(1));

  const macroNewsScore = macroBias === 'BUY' ? 85 : macroBias === 'SELL' ? 15 : 50;

  const execTf = tradingMode === 'SWING' ? '1h' : '15min';
  const execCandles =
    candlesByTf[execTf] && candlesByTf[execTf].length >= 16
      ? candlesByTf[execTf]
      : candlesByTf[tfs[2]] || candlesByTf[tfs[1]] || candlesByTf[tfs[0]] || [];

  const amdState =
    viewMode === 'FULL'
      ? evaluateRollingAmdStateMachine(
          execCandles,
          macroBias,
          sessionConfig,
          htfAnalysis?.structureBias || 'NEUTRAL',
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
    0.45 * smcCompositeScore + 0.35 * macroNewsScore + 0.20 * basicScore;
  const rawScoreBeforeGatekeeper = Number(clamp(rawConfluence, 5, 95).toFixed(1));

  // If Manual AMD Override is 'ACCUMULATION', hold probability score to neutral 50%
  // If Manual AMD Override is 'DISTRIBUTION', open Gatekeeper and let full SMC confluence run
  const effectiveDampening = amdState ? amdState.dampeningFactor : 1;
  const dampenedScore =
    manualAmdOverride === 'ACCUMULATION'
      ? 50
      : 50 + (rawScoreBeforeGatekeeper - 50) * effectiveDampening;

  const uptrendPct = clamp(Math.round(dampenedScore), 5, 95);
  const downtrendPct = 100 - uptrendPct;
  const dominantDirection: ConfluenceMasterResult['dominantDirection'] =
    uptrendPct >= 56 ? 'BULLISH' : uptrendPct <= 44 ? 'BEARISH' : 'NETRAL';

  const guidanceId = proDeskRead.entryTriggerChecklistId;

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
    macroNewsScore,
    amdState,
    proDeskRead,
    weightsBreakdown: [
      { labelId: 'SMC Kontekstual · POI · Struktur (45%)', pct: 45, score: smcCompositeScore },
      { labelId: `Bias Makro News · ${macroBias} (35%)`, pct: 35, score: macroNewsScore },
      { labelId: 'Seasonality & Astro (20%)', pct: 20, score: basicScore },
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
    const splitIdx = Math.max(activeSeg.startIdx + 2, candles.length - 2);
    const boxSlice = candles.slice(activeSeg.startIdx, splitIdx);
    const boxHigh = Math.max(...boxSlice.map((c) => c.high));
    const boxLow = Math.min(...boxSlice.map((c) => c.low));
    return {
      activeSessionSegment: activeSeg,
      previousSessionSegment: prevSeg,
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

