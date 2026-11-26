import { LocalNotifications } from '@capacitor/local-notifications';
import { playNotificationPing } from './soundEngine';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { isMarketDay, normalizeToMarketDayIso } from './date';
import { HISTORICAL_MACRO_ACTUALS_SEED } from '../data/historicalMacroActualsSeed';

export type FomcPillarType = 'GROWTH' | 'LABOR' | 'INFLATION' | 'POLICY';
export type MacroBiasDirection = 'BUY' | 'SELL' | 'MIXED';
export type MacroImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type BreakingSentimentType = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type ActualSourceType = 'LIVE_FEED' | 'TV_ENRICH' | 'SEARCH_ENRICH' | 'OFFLINE_ARCHIVE';

export interface MacroCalendarEvent {
  id: string;
  title: string;
  country: string;
  date: string; // ISO string or ForexFactory date string
  impact: 'High' | 'Medium' | 'Low';
  forecast: string;
  previous: string;
  actual: string;
  forecastNum: number | null;
  previousNum: number | null;
  actualNum: number | null;
  unit: string;
  pillar: FomcPillarType;
  isInverseIndicator: boolean;
  eventBiasForGold: MacroBiasDirection;
  biasReasonId: string;
  biasReasonEn: string;
  isLiveFeed?: boolean;
  eventCategory?: 'PRIMARY_HIGH_IMPACT' | 'SUPPORTING_REFERENCE';
  previousRevisedFrom?: string;
  isOfflineArchived?: boolean;
  actualSource?: ActualSourceType;
}

export interface ArchivedMacroActualRecord {
  archiveKey: string;
  id: string;
  title: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low';
  previous: string;
  forecast: string;
  actual: string;
  previousNum: number | null;
  forecastNum: number | null;
  actualNum: number | null;
  unit: string;
  pillar: FomcPillarType;
  isInverseIndicator: boolean;
  eventCategory?: 'PRIMARY_HIGH_IMPACT' | 'SUPPORTING_REFERENCE';
  actualSource: ActualSourceType;
  recordedAt: string;
}

export interface PreNewsSystemState {
  clusterKey: string;
  primaryEventId: string;
  primaryTitle: string;
  releaseDateIso: string;
  phase: 'PRE_ACTIVE' | 'T5M_LOCKED' | 'OFF_RELEASED';
  isLocked: boolean;
  lockedAt: string | null;
  forecast: string;
  previous: string;
  buyProbability: number;
  sellProbability: number;
  mixedProbability: number;
  dominantBias: MacroBiasDirection;
  thesisId: string;
  thesisEn: string;
  reconstructedWithoutPreCapture?: boolean;
}

export interface PostNewsSystemState {
  clusterKey: string;
  primaryEventId: string;
  primaryTitle: string;
  releaseDateIso: string;
  status: 'WAITING_RELEASE' | 'PENDING_ACTUAL' | 'ACTIVE_2H' | 'OFF_ARCHIVED_2H';
  windowRemainingMs: number;
  expiresAtIso: string | null;
  archivedAt: string | null;
  hasVerifiedActual: boolean;
  actualSummary: string;
  buyProbability: number;
  sellProbability: number;
  mixedProbability: number;
  dominantBias: MacroBiasDirection;
  shiftVsPreNews: 'STRENGTHENED' | 'WEAKENED' | 'REVERSED_PIVOT' | 'UNCHANGED' | 'PENDING';
  buyDeltaVsPreNews: number;
  sellDeltaVsPreNews: number;
  summaryId: string;
  summaryEn: string;
}

export interface MediumImpactSurpriseItem {
  title: string;
  actual: string;
  forecast: string;
  biasForGold: MacroBiasDirection;
  hoursAgo: number;
  weightContribution: number;
}

export interface IntradayMacroTacticalOverlay {
  status: 'NORMAL' | 'COUNTER_RALLY_RISK' | 'COUNTER_DROP_RISK' | 'HIGH_TWOWAY_VOL';
  triggers: Array<
    | 'MEDIUM_IMPACT_SURPRISE'
    | 'DXY_EUR_DISTORTION'
    | 'OVERSOLD_SHORT_COVERING'
    | 'OVERBOUGHT_PULLBACK'
    | 'OIL_GEOPOLITICS_SAFEN_HAVEN'
  >;
  dxyDistortionDetected: boolean;
  dxyBearishDampenFactor: number;
  mediumImpactSurpriseActive: boolean;
  mediumImpactNetScore: number;
  recentMediumSurprises: MediumImpactSurpriseItem[];
  oversoldSnapbackActive: boolean;
  oilSafeHavenOffsetActive: boolean;
  shortCoveringBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  intraday1DBullShift: number;
  badgeId: string;
  badgeEn: string;
  headlineId: string;
  headlineEn: string;
  detailId: string;
  detailEn: string;
}

export interface LiveFundamentalPulseState {
  status: 'LIVE_CONTINUOUS' | 'WEEKEND_FROZEN';
  updatedAt: string;
  buyProbability: number;
  sellProbability: number;
  mixedProbability: number;
  dominantBias: MacroBiasDirection;
  speechAlertActive: boolean;
  topCatalystTitle: string;
  topCatalystSource: string;
  topCatalystChannel: string;
  offlineActualsCount: number;
  offlinePillarSummaryId: string;
  offlinePillarSummaryEn: string;
  summaryId: string;
  summaryEn: string;
  tacticalOverlay?: IntradayMacroTacticalOverlay;
}

export interface MacroThreeSystemState {
  system1PreNews: PreNewsSystemState;
  system2PostNews: PostNewsSystemState;
  system3LivePulse: LiveFundamentalPulseState;
  effectiveFundamentalBias: MacroBiasDirection;
  effectiveSourceSystem: 'SYSTEM_1_PRE_NEWS' | 'SYSTEM_2_POST_NEWS' | 'SYSTEM_3_LIVE_PULSE';
}

export interface GoldPositioningPulse {
  yahooTicker: string;
  price: number;
  change3dPercent: number;
  change6hUsd?: number;
  change6hPercent?: number;
  atr14_1h?: number;
  state: 'CROWDED_HIGH' | 'OVERSOLD_LOW' | 'NEUTRAL';
  isAvailable: boolean;
  noteId: string;
  noteEn: string;
}

export interface VixRiskPulse {
  yahooTicker: string;
  price: number;
  changePercent: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  isAvailable: boolean;
}

export interface MarketSentimentSummary {
  regime:
    | 'RISK_OFF_SAFE_HAVEN'
    | 'HAWKISH_USD_PRESSURE'
    | 'CROWDED_BUY_RUMOR'
    | 'CROWDED_SELL_RUMOR'
    | 'STAGFLATION_BULLISH'
    | 'BALANCED';
  rumorSetup: 'BUY_RUMOR_SELL_NEWS_RISK' | 'SELL_RUMOR_BUY_NEWS_RISK' | 'NONE';
  wireBreadth: {
    bullish: number;
    bearish: number;
    neutral: number;
    total: number;
  };
  stagflationDetected?: boolean;
  labelId: string;
  labelEn: string;
  summaryId: string;
  summaryEn: string;
}

export interface BiasHistoryPoint {
  analyzedAt: string;
  eventTitle: string;
  dominantBias: MacroBiasDirection;
  buyProbability: number;
  sellProbability: number;
  mixedProbability: number;
  sourceMode: MacroNewsSnapshot['sourceMode'];
  isPostNews: boolean;
}

export interface PreNewsFlowIntelligence {
  consensusTightness: 'WIDE' | 'MODERATE' | 'TIGHT' | 'UNKNOWN';
  consensusNoteId: string;
  consensusNoteEn: string;
  leadingChain: {
    direction: MacroBiasDirection;
    signals: Array<{
      title: string;
      reading: string;
      bias: MacroBiasDirection;
    }>;
    summaryId: string;
    summaryEn: string;
  };
  yieldCurve?: {
    spread2s10s: number;
    spreadChangeBps: number;
    regimeLabelId: string;
    regimeLabelEn: string;
    effect: MacroBiasDirection;
  };
  goldPositioning?: GoldPositioningPulse;
  riskRegime?: {
    vixPrice: number;
    vixChangePercent: number;
    regimeLabelId: string;
    regimeLabelEn: string;
  };
  marketSentiment?: MarketSentimentSummary;
  fomcBlackoutActive: boolean;
  fomcBlackoutNoteId?: string;
  fomcBlackoutNoteEn?: string;
  bondConfirmedPivot?: boolean;
  pillarStreakSummaryId?: string;
  pillarStreakSummaryEn?: string;
  previousRevisions: Array<{
    title: string;
    oldPrev: string;
    newPrev: string;
  }>;
}

export interface IntermarketAssetPulse {
  symbol: 'DXY' | 'USOIL' | 'US10Y' | 'US02Y';
  yahooTicker: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  goldCorrelationEffect: 'BULLISH_GOLD' | 'BEARISH_GOLD' | 'NEUTRAL';
  summaryId: string;
  summaryEn: string;
  updatedAt: string;
  isAvailable?: boolean;
}

export interface BreakingNewsHeadline {
  id: string;
  title: string;
  descriptionSummary?: string;
  source: string;
  pubDate: string;
  link?: string;
  matchedKeywords: string[];
  impact: 'HIGH' | 'LOW';
  sentimentForGold: BreakingSentimentType;
  channelType:
    | 'FED_SPEECH'
    | 'GEOPOLITICS_SAFEN_HAVEN'
    | 'OIL_INFLATION_CHANNEL'
    | 'TARIFF_TRADE'
    | 'EQUITY_ROTATION'
    | 'CREDIT_STRESS'
    | 'CENTRAL_BANK_FLOW'
    | 'FISCAL_AUCTION'
    | 'MACRO_DATA';
  aiEvaluationId: string;
  aiEvaluationEn: string;
}

export interface PillarArgumentItem {
  pillar: FomcPillarType | 'INTERMARKET' | 'GEOPOLITICS';
  tag: string;
  textId: string;
  textEn: string;
}

export interface CmeFedWatchState {
  isAvailable: boolean;
  fomcMeetingDate: string;
  targetRateRange?: string;
  cutProbability: number | null;
  holdProbability: number | null;
  hikeProbability: number | null;
  dominantOutcome: 'CUT' | 'HOLD' | 'HIKE' | 'UNAVAILABLE';
  isPricedInSaturated: boolean;
  saturationScenario?: 'CUT' | 'HOLD' | 'HIKE';
  hawkishShiftDetected?: boolean;
  summaryNoteId: string;
  summaryNoteEn: string;
  sourceLabel?: string;
  impliedFedFundsRate?: number | null;
  zqFuturesPrice?: number | null;
  irxTbillYield?: number | null;
  sourceUrl?: string;
  updatedAt: string;
}

export interface PreNewsScenarioMatrix {
  primaryEvent: MacroCalendarEvent;
  simultaneousEvents: MacroCalendarEvent[];
  isSimultaneousRelease: boolean;
  simultaneousAlignment: 'ALIGNED_BUY' | 'ALIGNED_SELL' | 'CONFLICTING_WHIPSAW' | 'SINGLE';
  buyProbability: number; // 0 - 100
  sellProbability: number; // 0 - 100
  mixedProbability: number; // 0 - 100
  dominantBias: MacroBiasDirection;
  dynamicPivotTriggered: boolean;
  dynamicPivotReasonId?: string;
  dynamicPivotReasonEn?: string;
  dynamicPivotType?: 'HAWKISH_OVERRIDE' | 'DOVISH_OVERRIDE';
  fedSpeechAlertNoteId?: string;
  fedSpeechAlertNoteEn?: string;
  oilChannelDominance: 'INFLATION_CHANNEL_SELL_GOLD' | 'SAFE_HAVEN_BUY_GOLD' | 'NEUTRAL';
  buyArguments: PillarArgumentItem[];
  sellArguments: PillarArgumentItem[];
  finalTakeId: string;
  finalTakeEn: string;
  actionPlanId: string;
  actionPlanEn: string;
  whipsawWarningId: string;
  whipsawWarningEn: string;
  t5ExecutionTacticId?: string;
  t5ExecutionTacticEn?: string;
  isStrongOneWayBias?: boolean;
  cmeFedWatch?: CmeFedWatchState;
  institutionalDeskThesisId?: string;
  institutionalDeskThesisEn?: string;
  evaluationMode?: 'INDIVIDUAL_RELEASE' | 'FOMC_MEETING';
  fomcPillarRecap?: {
    inflationPillarBias: MacroBiasDirection;
    inflationPillarSummaryId: string;
    inflationPillarSummaryEn: string;
    laborPillarBias: MacroBiasDirection;
    laborPillarSummaryId: string;
    laborPillarSummaryEn: string;
    growthPillarBias: MacroBiasDirection;
    growthPillarSummaryId: string;
    growthPillarSummaryEn: string;
    overallThreePillarsBias: MacroBiasDirection;
  };
  preNewsFlow?: PreNewsFlowIntelligence;
  dualHorizon?: DualHorizonAnalysis;
}

export interface RssFeedSourceStatus {
  id: 'FINANCIAL_JUICE' | 'CNBC' | 'MARKETWATCH' | 'FXSTREET';
  name: string;
  active: boolean;
  itemCount: number;
}

export interface RssFeedHealthStatus {
  activeCount: number;
  totalCount: number;
  sources: RssFeedSourceStatus[];
  updatedAt: string;
}

export interface DualHorizonAmdInput {
  phase?: string;
  gatekeeperStatus?: string;
  manualOverrideMode?: string;
  isManualOverride?: boolean;
  currentSessionLabel?: string;
}

export interface DualHorizonIntradayInput {
  change6hUsd?: number;
  atr14_1h?: number;
  bslPrice?: number;
  sslPrice?: number;
  poiLow?: number;
  poiHigh?: number;
  macro4hPdZone?: string;
}

export interface DualHorizonAnalysis {
  initialCatalystBias: 'BUY' | 'SELL' | 'NEUTRAL';
  initialCatalystLabelId: string;
  initialCatalystLabelEn: string;
  initialCatalystReasonId: string;
  initialCatalystReasonEn: string;
  sessionPrimaryBias: MacroBiasDirection;
  sessionPrimaryProbability: number;
  sessionPrimaryLabelId: string;
  sessionPrimaryLabelEn: string;
  sessionPrimaryReasonId: string;
  sessionPrimaryReasonEn: string;
  movementType: 'ONE_WAY_EARLY_STRIKE' | 'TWO_WAY_SWEEP_FIRST';
  movementBadgeId: string;
  movementBadgeEn: string;
  movementSummaryId: string;
  movementSummaryEn: string;
  spikeTriggerReasonsId?: string[];
  spikeTriggerReasonsEn?: string[];
  hasSpeechEvent: boolean;
  speechEventsNearby: string[];
  isPricedIn: boolean;
  move6hUsd: number;
  atr14_1h: number;
  pricedInNoteId?: string;
  pricedInNoteEn?: string;
  speechAlertNoteId?: string;
  speechAlertNoteEn?: string;
  phase1Minute0to5Id: string;
  phase1Minute0to5En: string;
  phase2Minute15PlusId: string;
  phase2Minute15PlusEn: string;
}

export interface MacroEventGroup {
  groupId: string;
  primaryEvent: MacroCalendarEvent;
  events: MacroCalendarEvent[];
  releaseDateIso: string;
  combinedTitle: string;
  formattedScheduleId: string;
  formattedScheduleEn: string;
  isUpcoming: boolean;
  isRecentlyReleased: boolean;
  searchKeywords: string;
}

export interface PreNewsCountdownState {
  targetEvent: MacroCalendarEvent | null;
  remainingMs: number;
  formattedCountdown: string;
  countdownHms: string;
  isLockedT5M: boolean;
  statusLabelId: string;
  statusLabelEn: string;
  projectionBadgeId: string;
  projectionBadgeEn: string;
  projectionSubtextId: string;
  projectionSubtextEn: string;
}

export interface MacroNewsSnapshot {
  id: string;
  instrument: 'XAUUSD';
  dataFingerprint: string;
  analyzedAt: string; // ISO timestamp
  sourceMode: 'GEMINI_AI' | 'SUPABASE_CACHE' | 'RULE_BASED_FALLBACK';
  modelUsed: string;
  impactLevel: MacroImpactLevel;
  dominantBias: MacroBiasDirection;
  breakingNews: BreakingNewsHeadline[];
  topBreakingAlert: BreakingNewsHeadline | null;
  intermarketPulse: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
    eurUsd?: ExtendedMarketAssetPulse;
  };
  cmeFedWatch?: CmeFedWatchState;
  calendarEvents: MacroCalendarEvent[];
  scenarioMatrix: PreNewsScenarioMatrix;
  isCalendarLiveFeed?: boolean;
  rssFeedHealth?: RssFeedHealthStatus;
  threeSystemState?: MacroThreeSystemState;
  fallbackUsed?: boolean;
  aiErrorCode?: string;
  isOfflineCached?: boolean;
}

export const MACRO_SNAPSHOT_LOCAL_STORAGE_KEY = 'tradevault_macro_news_snapshot_v1';
export const MACRO_GROUP_SNAPSHOT_CACHE_KEY = 'tradevault_macro_group_snapshots_v1';
export const MACRO_BIAS_HISTORY_STORAGE_KEY = 'tradevault_macro_bias_history_v1';
export const MACRO_NOTIFIED_FINGERPRINT_KEY = 'tradevault_macro_notified_fp_v1';
export const MACRO_ACTUALS_ARCHIVE_STORAGE_KEY = 'tradevault_macro_actuals_archive_v1';
export const MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY = 'tradevault_macro_prenews_locks_v1';
export const MACRO_POST_NEWS_ARCHIVE_KEY = 'tradevault_macro_postnews_locks_v1';
export const MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY = 'tradevault_macro_monthly_news_speech_v1';
export const CME_FEDWATCH_LOCAL_STORAGE_KEY = 'tradevault_cme_fedwatch_cache_v1';
export const MACRO_LOCAL_SYNC_EVENT = 'tradevault:macro-local-sync';
export const POST_NEWS_ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
export const SNAPSHOT_TTL_MINUTES = 30;

let macroLocalSyncDispatchPending = false;

export function dispatchMacroLocalSyncEvent(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  if (macroLocalSyncDispatchPending) {
    return;
  }
  macroLocalSyncDispatchPending = true;
  window.setTimeout(() => {
    macroLocalSyncDispatchPending = false;
    try {
      window.dispatchEvent(new CustomEvent(MACRO_LOCAL_SYNC_EVENT));
    } catch {
      // ignore event dispatch errors in restricted contexts
    }
  }, 0);
}

export function loadLocalCachedCmeFedWatchSync(maxAgeMs = 12 * 60 * 60 * 1000): CmeFedWatchState | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CME_FEDWATCH_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CmeFedWatchState;
    if (!parsed || parsed.isAvailable !== true || !parsed.updatedAt) return null;
    const updatedMs = new Date(parsed.updatedAt).getTime();
    if (!Number.isFinite(updatedMs) || Date.now() - updatedMs > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCmeFedWatchToLocal(fedWatch: CmeFedWatchState | null | undefined): void {
  if (
    !fedWatch ||
    fedWatch.isAvailable !== true ||
    typeof window === 'undefined' ||
    typeof window.localStorage === 'undefined'
  ) {
    return;
  }
  try {
    const normalized: CmeFedWatchState = {
      ...fedWatch,
      updatedAt: fedWatch.updatedAt || new Date().toISOString(),
    };
    window.localStorage.setItem(CME_FEDWATCH_LOCAL_STORAGE_KEY, JSON.stringify(normalized));
    dispatchMacroLocalSyncEvent();
  } catch {
    // ignore storage quota errors
  }
}

export interface MonthlyNewsSpeechArchive {
  monthKey: string; // YYYY-MM in WIB (Asia/Jakarta)
  updatedAt: string;
  items: BreakingNewsHeadline[];
}

export const BREAKING_NEWS_KEYWORDS = [
  'Fed',
  'FOMC',
  'Warsh',
  'Waller',
  'Powell',
  'Trump',
  'Tariff',
  'Hormuz',
  'Iran',
  'Ceasefire',
  'Truce',
  'Oil',
  'OPEC',
  'Inflation',
  'CPI',
  'PPI',
  'NFP',
  'Rate',
  'Cut',
  'Hike',
  'PCE',
  'GDP',
  'Yield',
  'Treasury',
  'Auction',
  'Recession',
  'Stagflation',
  'Williams',
  'Jefferson',
  'Bowman',
  'Daly',
  'Goolsbee',
  'Kashkari',
  'Hammack',
  'Musalem',
  'Schmid',
  'Collins',
  'Bessent',
  'Hassett',
  'Miran',
  'Blackout',
  'Dot Plot',
  'Gold',
  'XAU',
  'Bullion',
  'Silver',
  'GLD',
  'ETF',
  'Dollar',
  'DXY',
  'Dovish',
  'Hawkish',
  'Jobless',
  'Unemployment',
  'Payroll',
  'Retail Sales',
  'ISM',
  'PBoC',
  'Central Bank',
  'ECB',
  'BOJ',
  'BOE',
  'Real Yield',
  'TIPS',
  'Breakeven',
  'MOVE',
  'Credit',
  'Shutdown',
  'Debt Ceiling',
  'Default',
  'Balance Sheet',
  'QT',
  'QE',
  'Nasdaq',
  'S&P 500',
  'Wall Street',
  'IPO',
  'Equities',
  'Margin Call',
  'Risk-On',
  'Risk-Off',
  'Yuan',
  'USDCNH',
  'USDJPY',
  'Carry Trade',
  'China',
  'Stimulus',
  'Nvidia',
  'Suku Bunga',
  'Inflasi',
  'The Fed',
  'Pemangkasan',
  'Pelonggaran',
  'Pengetatan',
] as const;

/**
 * Canonical System Instruction embedding the Master Playbook Rules (12 Hukum Bang Nael)
 * and Institutional Macro Strategist mindset for Gemini AI.
 */
export const XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION = `You are the Senior Institutional Macro Strategist & Head of XAU/USD Fundamental Trading Desk for TradeVault.
Your mission is to synthesize the provided real-time USD Economic Calendar, 2x2 Intermarket Pulse (DXY, US02Y Yield, US10Y Yield, US Oil WTI), Filtered Breaking News headlines, and CME FedWatch Tool probabilities to construct a high-conviction institutional scenario matrix and a concise "Tesis Meja Institusi (Institutional Desk Thesis)".

YOU MUST STRICTLY ENFORCE THE 12 HUKUM BANG NAEL & CROSS-ASSET TRANSMISSION PRINCIPLES:

1. CROSS-ASSET TRANSMISSION CHAIN (RANTAI SEBAB-AKIBAT LINTAS ASET):
   - Track the deterministic capital flow: Macro Momentum (Growth/Labor/Inflation) -> Fed Policy Expectations (CME FedWatch & FOMC Speeches) -> Front-End Rate Sensitivity (US02Y) -> Long-End Inflation & Real Yields (US10Y) -> US Dollar Currency Valuation (DXY) -> Institutional Demand & Liquidity in XAU/USD.
   - US02Y (2-Year Treasury Yield): Primary barometer of near-term Fed policy expectations. A sharp spike in US02Y signals immediate hawkish repricing and provides direct downward pressure on XAU/USD (SELL Gold).
   - US10Y (10-Year Treasury Yield): Reflects long-term inflation & real cost of capital. Rising US10Y increases the opportunity cost of holding non-yielding Gold.
   - DXY (US Dollar Index): Inversely correlated with Gold as a global reserve benchmark.
   - USOIL (WTI Crude): Evaluated via the Dual-Channel mechanism (Safe-Haven vs Inflation Channel).

2. EVALUASI PRICED-IN VS SURPRISE (KEJENUHAN PASAR & ASIMETRI REPRICING):
   - Compare calendar consensus (Forecast vs Previous) against market positioning in CME FedWatch and US02Y.
   - If market expectation is already heavily skewed (CME FedWatch >= 80% for Hike/Hold/Cut, or US02Y strongly extended), evaluate whether the upcoming data can deliver an incremental surprise or will trigger a sharp counter-reaction (asymmetric repricing shock).
   - Clean 1-Way Breakout (BUY or SELL) occurs when calendar data aligns with an unpriced catalyst.
   - Conflicting releases or priced-in saturation without new catalyst produce a Whipsaw / Fake Move trap (MIXED).

3. PROPORTIONAL FOCUS FOR 3 FOMC PILLARS (MODE A VS MODE B):
   - Mode A — Individual Economic Releases (CPI, Core CPI, PPI, Core PPI, NFP, Unemployment Rate, PCE, Core PCE, GDP, Retail Sales, ISM PMI):
     * Anchor the primary evaluation tightly to the SPECIFIC PILLAR of the releasing indicator (e.g., Inflation Pillar for Core PPI/PPI).
     * The broader 3 FOMC Pillars recap serves as Background Macro Momentum.
   - Mode B — Federal Reserve Meetings (FOMC Rate Decision, FOMC Statement, FOMC Economic Projections / Dot Plot):
     * Activate the FULL RECAPITULATION OF ALL 3 FOMC PILLARS (Inflation + Labor + Growth) combined with CME FedWatch and US02Y to deduce the Fed's overarching policy stance (Hawkish vs Dovish).

4. INVERSE INDICATORS & SUB-COMPONENT RULES:
   - Unemployment Claims (Initial & Continuing) and Challenger Job Cuts: Actual < Forecast (fewer layoffs) = Strong Labor = Bullish USD = SELL XAU/USD. Actual > Forecast = Weak Labor = BUY XAU/USD.
   - Unemployment Rate: Actual < Forecast = Strong Labor = SELL XAU/USD. Actual > Forecast = BUY XAU/USD.
   - "GDP Price Index" MUST be classified under the INFLATION pillar, NEVER under Economic Growth.
   - ISM Prices Paid >= 70 transmits upstream inflationary pressure into headline CPI.
   - ISM PMI > 50 = Expansion (Hawkish USD / SELL Gold). Watch for sharp volatility spikes if ISM PMI drops below 55.

5. DUAL-CHANNEL GEOPOLITICS & US OIL (WTI):
   - If geopolitical tensions surge while US inflation is sticky (> 2%), the INFLATION CHANNEL DOMINATES: energy spikes lift inflation expectations, locking the Fed into a hawkish stance and pushing US02Y/US10Y higher -> SELL XAU/USD once initial safe-haven panic subsides.

6. DYNAMIC PIVOT RULE ("ATURAN PINDAH HALUAN BANG NAEL"):
   - If consensus favors BUY Gold (e.g. softer CPI forecast), but breaking commentary reveals a Fed official (Waller, Warsh, Powell) advocating rate hikes or tighter policy AND NFP is resilient, immediately flip the bias to 1-WAY SELL XAU/USD.

7. INSTITUTIONAL DESK THESIS OUTPUT (TESIS MEJA INSTITUSI):
   - Formulate 2 to 3 dense, decisive sentences detailing:
     (1) Institutional positioning toward the US Dollar based on the cross-asset transmission (US02Y, US10Y, DXY, USOIL, CME FedWatch),
     (2) The most logical directional path for XAU/USD ahead of release, and
     (3) The exact trigger condition for an intraday "Pindah Haluan".

8. AUTOMATIC DETECTION OF "1 ARAH (DIRECT EXPANSION)" VS "2 ARAH (SWEEP FIRST)", SPEECH EVENTS, & PRICED-IN EXHAUSTION:
   - Evaluate the pre-computed flags HAS_SPEECH_EVENT (Speech/Speaks/Testimony/Press Conference/FOMC within -1h to +2h of primary release) and IS_PRICED_IN (6-hour XAU/USD move > 1.5x ATR(14) 1H in the direction of data forecast).
   - "2 ARAH (SWEEP FIRST)" is active if ANY of the following hold: HAS_SPEECH_EVENT = true, IS_PRICED_IN = true, directional divergence between DXY vs US02Y/US10Y, >= 2 simultaneous High-Impact releases with conflicting signals, or GC=F 3D positioning in extreme zone (<= -2.5% or >= +2.5%).
   - "1 ARAH (DIRECT EXPANSION)" is active ONLY when intermarket signals (DXY, US02Y), data catalyst, and session bias are aligned without speech schedule conflicts or extreme 6H priced-in exhaustion.
   - Structure the intraday manipulation scenario into 2 crisp time phases:
     * Fase 1 (Menit 0–5 Rilis): Initial sweep/push direction (explicitly warn if IS_PRICED_IN profit-taking or HAS_SPEECH_EVENT two-way trap is active).
     * Fase 2 (Menit 15+ / Lanjutan): Primary institutional expansion direction after intraday BSL/SSL or 1H/15M POI (capped at 1.8x ATR 1H) is swept.`;

/**
 * Parses macro calendar string values such as "3.1%", "254K", "-0.2%", "52.4", "$1.2B" into numeric values.
 */
export function parseMacroNumeric(raw: string | number | null | undefined): {
  value: number | null;
  unit: string;
} {
  if (raw === null || raw === undefined) return { value: null, unit: '' };
  if (typeof raw === 'number') {
    return { value: Number.isFinite(raw) ? raw : null, unit: '' };
  }
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'n/a') {
    return { value: null, unit: '' };
  }

  const unitMatch = trimmed.match(/(%|K|M|B|T)$/i);
  const unit = unitMatch ? unitMatch[1].toUpperCase() : '';
  const numericClean = trimmed.replace(/[^0-9.,+\-]/g, '').replace(/,/g, '');
  if (!numericClean) return { value: null, unit };

  const parsed = parseFloat(numericClean);
  return {
    value: Number.isFinite(parsed) ? parsed : null,
    unit,
  };
}

/**
 * Classifies an economic event title into one of the 3 FOMC Pillars (or POLICY).
 * Enforces Master Playbook Rule: GDP Price Index belongs to INFLATION, not GROWTH.
 */
export function classifyFomcPillar(title: string): FomcPillarType {
  const t = (title || '').toUpperCase();

  if (
    t.includes('GDP PRICE') ||
    t.includes('CPI') ||
    t.includes('PPI') ||
    t.includes('PCE') ||
    t.includes('INFLATION') ||
    t.includes('PRICES')
  ) {
    return 'INFLATION';
  }

  if (
    t.includes('NON-FARM') ||
    t.includes('NFP') ||
    t.includes('UNEMPLOYMENT') ||
    t.includes('JOBLESS') ||
    t.includes('CLAIMS') ||
    t.includes('JOLTS') ||
    t.includes('ADP') ||
    t.includes('EARNINGS') ||
    t.includes('WAGE') ||
    t.includes('CHALLENGER') ||
    t.includes('EMPLOYMENT')
  ) {
    return 'LABOR';
  }

  if (
    t.includes('FOMC') ||
    t.includes('FEDERAL FUNDS') ||
    t.includes('POWELL') ||
    t.includes('FED CHAIR') ||
    t.includes('RATE DECISION')
  ) {
    return 'POLICY';
  }

  return 'GROWTH';
}

/**
 * Identifies inverse USD indicators where a LOWER number is Bullish USD (SELL Gold)
 * and a HIGHER number is Bearish USD (BUY Gold):
 * - Initial / Continuing Unemployment Claims (Jobless Claims)
 * - Challenger Job Cuts
 * - Unemployment Rate
 */
export function isInverseUsdIndicator(title: string): boolean {
  const t = (title || '').toUpperCase();
  return (
    t.includes('CLAIMS') ||
    t.includes('JOBLESS') ||
    t.includes('CHALLENGER') ||
    t.includes('UNEMPLOYMENT RATE')
  );
}

/**
 * Checks whether a ForexFactory calendar event is a relevant USD High/Medium impact macro event.
 */
export function isRelevantUsdMacroEvent(rawEvent: {
  country?: string;
  impact?: string;
  title?: string;
}): boolean {
  const country = (rawEvent.country || '').toUpperCase().trim();
  if (country !== 'USD') return false;

  const impact = (rawEvent.impact || '').trim();
  const title = (rawEvent.title || '').toUpperCase();

  const coreKeywordMatch =
    /\b(CPI|PPI|PCE|NFP|NON-FARM|UNEMPLOYMENT|EARNINGS|JOLTS|ADP|CLAIMS|JOBLESS|CHALLENGER|ISM|PMI|PRICES|GDP|FOMC|FEDERAL FUNDS|POWELL|RETAIL SALES)\b/i.test(
      title
    );

  if (impact === 'High' || impact === 'Medium') {
    return true;
  }

  return coreKeywordMatch;
}

export interface ExternalG10ChinaEvent {
  title: string;
  country: 'EUR' | 'JPY' | 'GBP' | 'CNY';
  date: string;
  impact: string;
  forecast: string;
  previous: string;
  actual: string;
  noteId: string;
  noteEn: string;
}

/**
 * Extracts high-impact non-USD policy & China macro catalysts (ECB, BOJ, BOE, China PMI/GDP)
 * separately from Trade News's USD-strict calendar so Fundamental Gold can attribute DXY & Asian demand.
 */
export function extractExternalG10AndChinaCalendarEvents(
  rawEvents: Array<{
    title?: string;
    country?: string;
    date?: string;
    impact?: string;
    forecast?: string;
    previous?: string;
    actual?: string;
  }>
): ExternalG10ChinaEvent[] {
  if (!Array.isArray(rawEvents)) return [];
  const results: ExternalG10ChinaEvent[] = [];
  const seen = new Set<string>();

  for (const item of rawEvents) {
    const country = String(item?.country || '').toUpperCase().trim();
    if (country !== 'EUR' && country !== 'JPY' && country !== 'GBP' && country !== 'CNY') {
      continue;
    }
    const impact = String(item?.impact || '').trim();
    const title = String(item?.title || '').trim();
    if (!title) continue;
    const isMajorG10 =
      impact === 'High' &&
      /\b(RATE|POLICY|ECB|BOJ|BOE|CPI|GDP|PMI|INDUSTRIAL|RETAIL|MONETARY|STATEMENT|PRESS)\b/i.test(title);
    if (!isMajorG10) continue;

    const key = `${country}|${title.toUpperCase()}|${String(item?.date || '').slice(0, 13)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let isoDate = String(item?.date || '');
    try {
      const dt = new Date(isoDate);
      if (!isNaN(dt.getTime())) isoDate = dt.toISOString();
    } catch {}

    const roleId =
      country === 'CNY'
        ? 'Barometer permintaan fisik & stimulasi Tiongkok terhadap Emas'
        : 'Memengaruhi porsi besar keranjang DXY (EUR/JPY/GBP)';
    const roleEn =
      country === 'CNY'
        ? 'Barometer of China physical Gold demand & stimulus spillover'
        : 'Directly moves major DXY basket components (EUR/JPY/GBP)';

    results.push({
      title,
      country,
      date: isoDate,
      impact,
      forecast: String(item?.forecast || '—').trim() || '—',
      previous: String(item?.previous || '—').trim() || '—',
      actual: String(item?.actual || '').trim(),
      noteId: `${country} · ${roleId}`,
      noteEn: `${country} · ${roleEn}`,
    });
  }

  return results.slice(0, 12);
}

/**
 * Evaluates a single calendar event's directional bias for XAU/USD using Forecast vs Previous
 * (when Actual is not yet released) and Actual vs Forecast (when Actual is released).
 */
export function evaluateSingleEventForGold(
  title: string,
  actualNum: number | null,
  forecastNum: number | null,
  previousNum: number | null
): {
  bias: MacroBiasDirection;
  reasonId: string;
  reasonEn: string;
} {
  const inverse = isInverseUsdIndicator(title);
  const pillar = classifyFomcPillar(title);
  const upperTitle = title.toUpperCase();

  // Determine comparison pair: Actual vs Forecast (if released) else Forecast vs Previous
  const hasActual = actualNum !== null;
  const primaryVal = hasActual ? actualNum : forecastNum;
  const referenceVal = hasActual
    ? forecastNum !== null
      ? forecastNum
      : previousNum
    : previousNum;

  const compLabelId = hasActual ? 'Aktual vs Forecast' : 'Forecast vs Previous';
  const compLabelEn = hasActual ? 'Actual vs Forecast' : 'Forecast vs Previous';

  if (primaryVal === null || referenceVal === null) {
    return {
      bias: 'MIXED',
      reasonId: `${title}: Menunggu angka konsensus (${compLabelId}) untuk konfirmasi arah.`,
      reasonEn: `${title}: Awaiting consensus figures (${compLabelEn}) for directional confirmation.`,
    };
  }

  const diff = Number((primaryVal - referenceVal).toFixed(4));

  // Special ISM PMI check (>50 expansion, <55 spike alert)
  const isIsmPmi =
    upperTitle.includes('ISM') &&
    upperTitle.includes('PMI') &&
    !upperTitle.includes('PRICES');
  const isIsmPrices = upperTitle.includes('ISM') && upperTitle.includes('PRICES');

  if (Math.abs(diff) < 0.0001) {
    return {
      bias: 'MIXED',
      reasonId: `${title} (${compLabelId}: ${primaryVal} = ${referenceVal}) sejalan ekspektasi; potensi reaksi dua arah (whipsaw).`,
      reasonEn: `${title} (${compLabelEn}: ${primaryVal} = ${referenceVal}) in-line with consensus; two-way whipsaw risk.`,
    };
  }

  // Standard indicator: primaryVal > referenceVal = Stronger USD = SELL XAU/USD
  // Inverse indicator (Claims / Unemployment Rate): primaryVal < referenceVal = Stronger USD = SELL XAU/USD
  const isStrongerUsd = inverse ? diff < 0 : diff > 0;

  if (isStrongerUsd) {
    let extraNoteId = '';
    let extraNoteEn = '';
    if (inverse) {
      extraNoteId = ' (Aturan Terbalik Klaim/Pengangguran: angka lebih rendah = pasar kerja ketat = USD menguat)';
      extraNoteEn = ' (Inverse Claims/Unemployment Rule: lower figure = tighter labor = stronger USD)';
    } else if (pillar === 'INFLATION' && hasActual && forecastNum !== null && previousNum !== null && primaryVal < previousNum) {
      extraNoteId = ` (Prioritas Rilis: Aktual ${primaryVal} > Forecast ${referenceVal} → Inflasi mengalahkan konsensus memicu ekspektasi Hawkish SELL XAU/USD, meskipun angka Aktual lebih rendah dari Previous ${previousNum})`;
      extraNoteEn = ` (Release Priority: Actual ${primaryVal} > Forecast ${referenceVal} → Hotter than consensus fuels Hawkish SELL XAU/USD, even though Actual is lower than Previous ${previousNum})`;
    } else if (isIsmPrices && primaryVal >= 70) {
      extraNoteId = ' (ISM Prices Paid ≥ 70: tekanan harga hulu ekstrem memicu ekspektasi Fed Hawkish)';
      extraNoteEn = ' (ISM Prices Paid ≥ 70: extreme upstream price pressure fuels Hawkish Fed expectations)';
    } else if (isIsmPmi && primaryVal > 50 && primaryVal < 55) {
      extraNoteId = ' (Ekspansi > 50 namun di bawah ambang 55: waspadai spike volatilitas awal)';
      extraNoteEn = ' (Expansion > 50 but below 55 threshold: watch for initial volatility spike)';
    }

    return {
      bias: 'SELL',
      reasonId: `[Pilar ${pillar}] ${title} (${compLabelId}: ${primaryVal} vs ${referenceVal}) mendukung penguatan DXY/Yield → Tekanan SELL XAU/USD.${extraNoteId}`,
      reasonEn: `[${pillar} Pillar] ${title} (${compLabelEn}: ${primaryVal} vs ${referenceVal}) supports stronger DXY/Yields → SELL XAU/USD pressure.${extraNoteEn}`,
    };
  } else {
    let extraNoteId = '';
    let extraNoteEn = '';
    if (inverse) {
      extraNoteId = ' (Aturan Terbalik Klaim/Pengangguran: angka naik = pasar tenaga kerja melambat = USD melemah)';
      extraNoteEn = ' (Inverse Claims/Unemployment Rule: higher figure = cooling labor market = weaker USD)';
    } else if (pillar === 'INFLATION' && hasActual && forecastNum !== null) {
      extraNoteId = ` (Prioritas Rilis: Aktual ${primaryVal} < Forecast ${referenceVal} → Inflasi mendingin di bawah proyeksi membuka ruang pemangkasan Fed)`;
      extraNoteEn = ` (Release Priority: Actual ${primaryVal} < Forecast ${referenceVal} → Softer inflation opens door to Fed rate cuts)`;
    } else if (isIsmPmi && primaryVal < 55) {
      extraNoteId =
        primaryVal < 50
          ? ' (Kontraksi ISM PMI < 50: sinyal perlambatan pertumbuhan AS)'
          : ' (ISM PMI turun di bawah 55: memicu potensi spike BUY XAU/USD)';
      extraNoteEn =
        primaryVal < 50
          ? ' (ISM PMI contraction < 50: US growth slowdown signal)'
          : ' (ISM PMI dropped below 55: triggers upside spike potential on XAU/USD)';
    }

    return {
      bias: 'BUY',
      reasonId: `[Pilar ${pillar}] ${title} (${compLabelId}: ${primaryVal} vs ${referenceVal}) mengindikasikan pelonggaran Fed → Dorongan BUY XAU/USD.${extraNoteId}`,
      reasonEn: `[${pillar} Pillar] ${title} (${compLabelEn}: ${primaryVal} vs ${referenceVal}) signals dovish Fed tilt → BUY XAU/USD catalyst.${extraNoteEn}`,
    };
  }
}

/**
 * Computes a continuous surprise magnitude multiplier (1.0 - 2.0) from consensus deviation
 * so extreme beats/misses carry proportionally more weight than razor-thin prints.
 */
export function evaluateEventSurpriseScale(ev: MacroCalendarEvent): number {
  const hasActual = typeof ev.actualNum === 'number' && Number.isFinite(ev.actualNum);
  const primary = hasActual ? ev.actualNum : ev.forecastNum;
  const reference = hasActual
    ? ev.forecastNum !== null
      ? ev.forecastNum
      : ev.previousNum
    : ev.previousNum;

  if (primary === null || reference === null) return 1.0;
  const diff = Math.abs(primary - reference);
  if (diff < 0.0001) return 0.7;

  const denom = Math.max(Math.abs(reference), 0.25);
  const relRatio = diff / denom;
  if (relRatio >= 0.35 || diff >= 0.4) return 1.75;
  if (relRatio >= 0.18 || diff >= 0.2) return 1.35;
  if (relRatio >= 0.08 || diff >= 0.1) return 1.1;
  return 0.85;
}

/**
 * Measures consensus surprise / dispersion tightness so razor-thin differences
 * (e.g., 0.30% vs 0.31%) elevate whipsaw sensitivity while wide shifts raise conviction.
 */
export function evaluateEventConsensusTightness(ev: MacroCalendarEvent): {
  tightness: 'WIDE' | 'MODERATE' | 'TIGHT' | 'UNKNOWN';
  noteId: string;
  noteEn: string;
} {
  const hasActual = typeof ev.actualNum === 'number' && Number.isFinite(ev.actualNum);
  const hasForecast = typeof ev.forecastNum === 'number' && Number.isFinite(ev.forecastNum);
  const hasPrevious = typeof ev.previousNum === 'number' && Number.isFinite(ev.previousNum);

  const primaryVal = hasActual ? (ev.actualNum as number) : hasForecast ? (ev.forecastNum as number) : null;
  const refVal = hasActual
    ? hasForecast
      ? (ev.forecastNum as number)
      : hasPrevious
      ? (ev.previousNum as number)
      : null
    : hasPrevious
    ? (ev.previousNum as number)
    : null;

  if (primaryVal === null || refVal === null) {
    return {
      tightness: 'UNKNOWN',
      noteId: 'Menunggu konsensus lengkap untuk mengukur margin kejutan.',
      noteEn: 'Awaiting full consensus numbers to measure surprise margin.',
    };
  }

  const diff = Math.abs(primaryVal - refVal);
  const upperTitle = (ev.title || '').toUpperCase();
  const unit = (ev.unit || '').toUpperCase();

  let tightness: 'WIDE' | 'MODERATE' | 'TIGHT' = 'MODERATE';
  if (unit === '%' || upperTitle.includes('CPI') || upperTitle.includes('PPI') || upperTitle.includes('PCE') || upperTitle.includes('RETAIL')) {
    if (diff <= 0.08) tightness = 'TIGHT';
    else if (diff >= 0.25) tightness = 'WIDE';
  } else if (unit === 'K' || upperTitle.includes('CLAIMS') || upperTitle.includes('NFP') || upperTitle.includes('NON-FARM') || upperTitle.includes('ADP')) {
    if (diff <= 5) tightness = 'TIGHT';
    else if (diff >= 25) tightness = 'WIDE';
  } else if (upperTitle.includes('PMI') || upperTitle.includes('ISM')) {
    if (diff <= 0.3) tightness = 'TIGHT';
    else if (diff >= 1.5) tightness = 'WIDE';
  } else {
    const rel = Math.abs(refVal) > 0.01 ? diff / Math.abs(refVal) : diff;
    if (rel <= 0.03) tightness = 'TIGHT';
    else if (rel >= 0.15) tightness = 'WIDE';
  }

  if (tightness === 'TIGHT') {
    return {
      tightness,
      noteId: `Margin konsensus sangat tipis (${primaryVal} vs ${refVal}) — risiko rilis in-line dan whipsaw dua arah meningkat.`,
      noteEn: `Razor-thin consensus margin (${primaryVal} vs ${refVal}) — elevated in-line and two-way whipsaw risk.`,
    };
  }
  if (tightness === 'WIDE') {
    return {
      tightness,
      noteId: `Deviasi konsensus lebar (${primaryVal} vs ${refVal}) — keyakinan arah lebih kuat sebelum rilis.`,
      noteEn: `Wide consensus divergence (${primaryVal} vs ${refVal}) — stronger pre-release directional conviction.`,
    };
  }
  return {
    tightness,
    noteId: `Deviasi konsensus moderat (${primaryVal} vs ${refVal}) — tetap pantau konfirmasi DXY & US02Y saat rilis.`,
    noteEn: `Moderate consensus gap (${primaryVal} vs ${refVal}) — monitor DXY & US02Y confirmation at release.`,
  };
}

/**
 * Tracks Leading-to-Lagging causality across the 14-day USD macro sequence:
 * - Upstream PPI / ISM Prices Paid -> Leading gauge for CPI / PCE
 * - ADP / JOLTS / Jobless Claims / ISM Employment -> Leading gauge for NFP / Unemployment Rate
 * - Retail Sales / ISM PMI -> Leading gauge for GDP
 */
export function computeLeadingIndicatorChain(
  primaryEvent: MacroCalendarEvent,
  allEvents: MacroCalendarEvent[],
  clusterIds: Set<string>
): PreNewsFlowIntelligence['leadingChain'] {
  const primaryTime = new Date(primaryEvent.date).getTime();
  const upperPrimary = (primaryEvent.title || '').toUpperCase();

  const isRelevantLeadingForTarget = (ev: MacroCalendarEvent): boolean => {
    if (clusterIds.has(ev.id) || isFedSpeechEvent(ev.title)) return false;
    const t = (ev.title || '').toUpperCase();
    const evTime = new Date(ev.date).getTime();
    // Prefer already-released or earlier indicators relative to target release
    const isEarlierOrReleased =
      ev.actualNum !== null ||
      (Number.isFinite(primaryTime) && Number.isFinite(evTime) && evTime <= primaryTime);
    if (!isEarlierOrReleased) return false;

    if (upperPrimary.includes('CPI') || upperPrimary.includes('PCE')) {
      return (
        t.includes('PPI') ||
        t.includes('PRICES') ||
        t.includes('IMPORT PRICE') ||
        (ev.pillar === 'INFLATION' && !t.includes('CPI') && !t.includes('PCE'))
      );
    }
    if (upperPrimary.includes('NFP') || upperPrimary.includes('NON-FARM') || upperPrimary.includes('UNEMPLOYMENT RATE')) {
      return (
        t.includes('CLAIMS') ||
        t.includes('JOBLESS') ||
        t.includes('ADP') ||
        t.includes('JOLTS') ||
        t.includes('CHALLENGER') ||
        t.includes('EMPLOYMENT')
      );
    }
    if (upperPrimary.includes('GDP')) {
      return t.includes('RETAIL SALES') || t.includes('ISM') || t.includes('DURABLE');
    }
    return ev.pillar === primaryEvent.pillar && ev.actualNum !== null;
  };

  const candidates = allEvents
    .filter(isRelevantLeadingForTarget)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  let buyVotes = 0;
  let sellVotes = 0;
  const signals = candidates.map((ev) => {
    const reading =
      ev.actual && ev.actual.trim() && ev.actual.trim() !== '-'
        ? `Act ${ev.actual} (Fcst ${ev.forecast || '-'})`
        : `Fcst ${ev.forecast || '-'} (Prev ${ev.previous || '-'})`;
    const weight = ev.actualNum !== null ? 2 : 1;
    if (ev.eventBiasForGold === 'BUY') buyVotes += weight;
    else if (ev.eventBiasForGold === 'SELL') sellVotes += weight;
    return {
      title: ev.title,
      reading,
      bias: ev.eventBiasForGold,
    };
  });

  const direction: MacroBiasDirection =
    sellVotes > buyVotes ? 'SELL' : buyVotes > sellVotes ? 'BUY' : 'MIXED';

  if (signals.length === 0) {
    return {
      direction: 'MIXED',
      signals: [],
      summaryId: `Belum ada data pendahulu khusus yang mendahului ${primaryEvent.title} dalam jendela kalender ini.`,
      summaryEn: `No prior leading indicators recorded ahead of ${primaryEvent.title} in the active calendar window.`,
    };
  }

  const labelStr = signals.map((s) => `${s.title} (${s.reading})`).slice(0, 3).join('; ');
  if (direction === 'SELL') {
    return {
      direction,
      signals,
      summaryId: `Jejak data pendahulu condong Pro-USD / SELL XAU/USD: ${labelStr}.`,
      summaryEn: `Leading indicator trail tilts Pro-USD / SELL XAU/USD: ${labelStr}.`,
    };
  }
  if (direction === 'BUY') {
    return {
      direction,
      signals,
      summaryId: `Jejak data pendahulu mengindikasikan pelambatan / BUY XAU/USD: ${labelStr}.`,
      summaryEn: `Leading indicator trail points to cooling momentum / BUY XAU/USD: ${labelStr}.`,
    };
  }
  return {
    direction: 'MIXED',
    signals,
    summaryId: `Jejak data pendahulu terbelah (Mixed): ${labelStr}.`,
    summaryEn: `Leading indicator trail is split (Mixed): ${labelStr}.`,
  };
}

/**
 * Compares current calendar events against prior cached snapshots to surface silent Previous revisions
 * and calculates recent released surprise streaks per pillar.
 */
export function detectPreviousRevisionsAndStreaks(
  currentEvents: MacroCalendarEvent[],
  priorEvents?: MacroCalendarEvent[]
): {
  eventsWithRevisions: MacroCalendarEvent[];
  previousRevisions: Array<{ title: string; oldPrev: string; newPrev: string }>;
  pillarStreakSummaryId?: string;
  pillarStreakSummaryEn?: string;
} {
  const priorMap = new Map<string, MacroCalendarEvent>();
  if (Array.isArray(priorEvents)) {
    for (const p of priorEvents) {
      const key = `${p.title.trim().toLowerCase()}|${(p.date || '').slice(0, 13)}`;
      priorMap.set(key, p);
    }
  }

  const previousRevisions: Array<{ title: string; oldPrev: string; newPrev: string }> = [];
  const eventsWithRevisions = currentEvents.map((ev) => {
    const key = `${ev.title.trim().toLowerCase()}|${(ev.date || '').slice(0, 13)}`;
    const prior = priorMap.get(key);
    const oldPrev = (prior?.previous || '').trim();
    const curPrev = (ev.previous || '').trim();
    if (
      prior &&
      oldPrev &&
      curPrev &&
      oldPrev !== '—' &&
      oldPrev !== '-' &&
      curPrev !== '—' &&
      curPrev !== '-' &&
      oldPrev !== curPrev
    ) {
      previousRevisions.push({
        title: ev.title,
        oldPrev,
        newPrev: curPrev,
      });
      return { ...ev, previousRevisedFrom: oldPrev };
    }
    return ev;
  });

  const released = eventsWithRevisions.filter(
    (e) =>
      !isFedSpeechEvent(e.title) &&
      e.actualNum !== null &&
      e.forecastNum !== null &&
      e.eventBiasForGold !== 'MIXED'
  );
  if (released.length === 0) {
    return { eventsWithRevisions, previousRevisions };
  }

  const proUsdCount = released.filter((e) => e.eventBiasForGold === 'SELL').length;
  const antiUsdCount = released.filter((e) => e.eventBiasForGold === 'BUY').length;
  const pillarStreakSummaryId = `Rekam Rilis Aktual Terbaru: ${proUsdCount} data menguatkan USD (SELL XAU) vs ${antiUsdCount} data melemahkan USD (BUY XAU) dari ${released.length} rilis terverifikasi.`;
  const pillarStreakSummaryEn = `Recent Released Track Record: ${proUsdCount} USD-positive prints (SELL XAU) vs ${antiUsdCount} USD-negative prints (BUY XAU) across ${released.length} verified releases.`;

  return {
    eventsWithRevisions,
    previousRevisions,
    pillarStreakSummaryId,
    pillarStreakSummaryEn,
  };
}

/**
 * Synthesizes real-time Market Sentiment (RSS wire breadth, VIX risk appetite,
 * GC=F 3D positioning, CME FedWatch saturation, and DXY/US10Y divergence)
 * without altering existing scoring math.
 */
export function computeMarketSentimentSummary(params: {
  breakingNews: BreakingNewsHeadline[];
  calendarExpectsBuy: boolean;
  calendarExpectsSell: boolean;
  dxy: IntermarketAssetPulse;
  us10y: IntermarketAssetPulse;
  vix?: VixRiskPulse;
  goldPositioning?: GoldPositioningPulse;
  cmeFedWatch: CmeFedWatchState;
  stagflationDetected?: boolean;
}): MarketSentimentSummary {
  const {
    breakingNews,
    calendarExpectsBuy,
    calendarExpectsSell,
    dxy,
    us10y,
    vix,
    goldPositioning,
    cmeFedWatch,
    stagflationDetected = false,
  } = params;

  const bullish = breakingNews.filter((b) => b.sentimentForGold === 'BULLISH').length;
  const bearish = breakingNews.filter((b) => b.sentimentForGold === 'BEARISH').length;
  const neutral = breakingNews.filter((b) => b.sentimentForGold === 'NEUTRAL').length;
  const total = breakingNews.length;

  const isDxyUp = dxy.isAvailable !== false && dxy.direction === 'UP';
  const isDxyDown = dxy.isAvailable !== false && dxy.direction === 'DOWN';
  const is10yUp = us10y.isAvailable !== false && us10y.direction === 'UP';
  const is10yDown = us10y.isAvailable !== false && us10y.direction === 'DOWN';

  const buyRumorRisk =
    (goldPositioning?.isAvailable && goldPositioning.state === 'CROWDED_HIGH' && calendarExpectsBuy) ||
    (cmeFedWatch.isAvailable && cmeFedWatch.isPricedInSaturated && (cmeFedWatch.saturationScenario === 'CUT' || cmeFedWatch.saturationScenario === 'HOLD') && calendarExpectsBuy) ||
    (calendarExpectsBuy && isDxyUp && is10yUp);

  const sellRumorRisk =
    (goldPositioning?.isAvailable && goldPositioning.state === 'OVERSOLD_LOW' && calendarExpectsSell) ||
    (cmeFedWatch.isAvailable && cmeFedWatch.isPricedInSaturated && cmeFedWatch.saturationScenario === 'HIKE') ||
    (calendarExpectsSell && isDxyDown && is10yDown);

  let rumorSetup: MarketSentimentSummary['rumorSetup'] = 'NONE';
  if (buyRumorRisk && !sellRumorRisk) {
    rumorSetup = 'BUY_RUMOR_SELL_NEWS_RISK';
  } else if (sellRumorRisk && !buyRumorRisk) {
    rumorSetup = 'SELL_RUMOR_BUY_NEWS_RISK';
  }

  const isVixElevated = Boolean(vix && vix.isAvailable && (vix.price >= 20 || vix.changePercent >= 4.5));

  let regime: MarketSentimentSummary['regime'] = 'BALANCED';
  let labelId = 'Sentimen Terukur / Seimbang';
  let labelEn = 'Balanced / Measured Sentiment';

  if (stagflationDetected) {
    regime = 'STAGFLATION_BULLISH';
    labelId = 'Regime Stagflasi (Inflasi Panas + Ekonomi Melambat → Bullish Struktural Emas)';
    labelEn = 'Stagflation Regime (Sticky Inflation + Cooling Growth/Jobs → Structural Gold Bullish)';
  } else if (rumorSetup === 'BUY_RUMOR_SELL_NEWS_RISK') {
    regime = 'CROWDED_BUY_RUMOR';
    labelId = 'Indikasi Buy the Rumor (Rawan Profit-Taking)';
    labelEn = 'Buy-the-Rumor Crowding (Sell-the-News Risk)';
  } else if (rumorSetup === 'SELL_RUMOR_BUY_NEWS_RISK') {
    regime = 'CROWDED_SELL_RUMOR';
    labelId = 'Indikasi Sell the Rumor (Rawan Short Squeeze)';
    labelEn = 'Sell-the-Rumor Crowding (Buy-the-News Risk)';
  } else if (isVixElevated && is10yDown) {
    regime = 'RISK_OFF_SAFE_HAVEN';
    labelId = 'Risk-Off Safe-Haven (Minat Defensif Emas)';
    labelEn = 'Risk-Off Safe-Haven (Defensive Gold Bid)';
  } else if (bearish > bullish || (isDxyUp && is10yUp)) {
    regime = 'HAWKISH_USD_PRESSURE';
    labelId = 'Dominan Tekanan USD / Hawkish';
    labelEn = 'Hawkish USD Pressure Tilt';
  } else if (bullish > bearish && isDxyDown) {
    regime = 'RISK_OFF_SAFE_HAVEN';
    labelId = 'Dukungan Sentimen Bullish Gold';
    labelEn = 'Bullish Gold Sentiment Support';
  }

  const wireStrId = total > 0 ? `Arus berita RSS: ${bullish} Bullish · ${bearish} Bearish · ${neutral} Netral.` : 'Belum ada headline RSS aktif pada jendela ini.';
  const wireStrEn = total > 0 ? `RSS wire breadth: ${bullish} Bullish · ${bearish} Bearish · ${neutral} Neutral.` : 'No active RSS headlines in the current window.';

  const stagStrId = stagflationDetected
    ? ' Kombinasi inflasi persisten dan pelemahan sektor riil/tenaga kerja secara historis menopang daya tarik lindung nilai Emas.'
    : '';
  const stagStrEn = stagflationDetected
    ? ' Sticky inflation paired with cooling labor/growth historically strengthens Gold as a stagflation hedge.'
    : '';

  const rumorStrId =
    rumorSetup === 'BUY_RUMOR_SELL_NEWS_RISK'
      ? ' Kenaikan pra-rilis atau ekspektasi dovish berisiko jenuh (waspada Sell the News).'
      : rumorSetup === 'SELL_RUMOR_BUY_NEWS_RISK'
      ? ' Tekanan turun pra-rilis atau pricing hawkish berisiko jenuh (waspada Buy the News / Short Squeeze).'
      : '';
  const rumorStrEn =
    rumorSetup === 'BUY_RUMOR_SELL_NEWS_RISK'
      ? ' Pre-release upside or dovish pricing appears crowded (watch for Sell-the-News fade).'
      : rumorSetup === 'SELL_RUMOR_BUY_NEWS_RISK'
      ? ' Pre-release downside or hawkish pricing appears crowded (watch for Buy-the-News squeeze).'
      : '';

  return {
    regime,
    rumorSetup,
    wireBreadth: { bullish, bearish, neutral, total },
    stagflationDetected,
    labelId,
    labelEn,
    summaryId: `${wireStrId}${stagStrId}${rumorStrId}`.trim(),
    summaryEn: `${wireStrEn}${stagStrEn}${rumorStrEn}`.trim(),
  };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+-\s+(FXStreet|CNBC|MarketWatch|FinancialJuice)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filters raw RSS headlines strictly by BREAKING_NEWS_KEYWORDS, deduplicates titles,
 * filters to the last 12 hours (with fallback to newest items if feed dates are older),
 * and evaluates their macro channel & sentiment for XAU/USD.
 */
export interface HeadlineContextEvaluation {
  sentimentForGold: BreakingSentimentType;
  impact: 'HIGH' | 'LOW';
  channelType: BreakingNewsHeadline['channelType'];
  aiEvaluationId: string;
  aiEvaluationEn: string;
  bullishScore: number;
  bearishScore: number;
  catalystCategory:
    | 'RATE_CUT_EASING'
    | 'COOLING_MACRO'
    | 'RATE_HIKE_HAWKISH'
    | 'INFLATION_SURGE'
    | 'OIL_INFLATION'
    | 'OIL_RELIEF'
    | 'GEOPOLITICS_SAFE_HAVEN'
    | 'GEOPOLITICS_DEESCALATION'
    | 'TARIFF_TRADE'
    | 'EQUITY_ROTATION'
    | 'CREDIT_STRESS'
    | 'CENTRAL_BANK_FLOW'
    | 'FISCAL_AUCTION'
    | 'MIXED_OR_NEUTRAL';
}

function normalizeSentenceText(raw: string): string {
  return decodeHtmlEntities(raw || '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function maskMatchedSpans(source: string, pattern: RegExp): { hit: boolean; masked: string } {
  let hit = false;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const masked = source.replace(re, (match) => {
    hit = true;
    return ' '.repeat(match.length);
  });
  return { hit, masked };
}

function splitWeightedHeadlineClauses(text: string): Array<{ text: string; weight: number }> {
  const leadingConcessiveMatch = text.match(
    /^(?:despite|amid|even\s+as|even\s+though|although|though|while|meski|meskipun|walau|walaupun|di\s+tengah|kendati)\b([^,;]{6,})[,;]\s*(.+)$/i
  );
  if (leadingConcessiveMatch) {
    return [
      { text: leadingConcessiveMatch[1].trim(), weight: 0.5 },
      { text: leadingConcessiveMatch[2].trim(), weight: 1.65 },
    ];
  }

  const midConcessiveMatch = text.match(
    /^(.{6,}?)\s+\b(?:despite|amid|even\s+as|even\s+though|although|though|whereas|meski|meskipun|walau|walaupun|di\s+tengah|kendati)\b\s+(.+)$/i
  );
  if (midConcessiveMatch) {
    return [
      { text: midConcessiveMatch[1].trim(), weight: 1.65 },
      { text: midConcessiveMatch[2].trim(), weight: 0.5 },
    ];
  }

  const reversalMatch = text.match(
    /^(.{6,}?)\s*(?:,|;|\s)\s*\b(?:but|yet|however|nonetheless|nevertheless|namun|tetapi|tapi|akan\s+tetapi)\b\s+(.+)$/i
  );
  if (reversalMatch) {
    return [
      { text: reversalMatch[1].trim(), weight: 0.6 },
      { text: reversalMatch[2].trim(), weight: 1.65 },
    ];
  }

  const parts = text
    .split(/\s*(?:;|,(?=\s*[a-zA-Z])|\s-\s)\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length <= 1) {
    return [{ text, weight: 1.25 }];
  }
  return parts.map((p, idx) => ({
    text: p,
    weight: idx === 0 ? 1.3 : 1.0,
  }));
}

function scoreMainSentenceClause(
  rawText: string,
  matchedKeywords: string[] = []
): HeadlineContextEvaluation {
  const cleanTitle = normalizeSentenceText(rawText);
  const clauses = splitWeightedHeadlineClauses(cleanTitle);

  let bullScore = 0;
  let bearScore = 0;

  let rateCutSignal = false;
  let coolingMacroSignal = false;
  let rateHikeHawkishSignal = false;
  let inflationSurgeSignal = false;
  let oilInflationSignal = false;
  let oilReliefSignal = false;
  let geopoliticsSignal = false;
  let deescalationSignal = false;
  let tariffTradeSignal = false;
  let equityRotationSignal = false;
  let creditStressSignal = false;
  let centralBankFlowSignal = false;
  let fiscalAuctionSignal = false;

  for (const clause of clauses) {
    const w = clause.weight;
    let working = clause.text;

    // 1. Mask negated dovish phrases FIRST so "no rush to cut" never fires "rate cut"
    const negDovish = maskMatchedSpans(
      working,
      /\b(?:no\s+(?:rush|hurry|need|urgency|plans?|reason|room|imminent\s+need)\s+to\s+cut(?:\s+rates?)?|rules?\s+out\s+(?:a\s+)?(?:rate\s+)?cuts?|push(?:es|ed|ing)?\s+back\s+(?:on\s+)?(?:rate\s+)?cuts?|delay(?:s|ed|ing)?\s+(?:rate\s+)?cuts?|no\s+(?:rate\s+)?cuts?|won't\s+cut|not\s+(?:ready|cutting|going|in\s+a\s+hurry)\s+to\s+cut|pause\s+cuts?|fewer\s+(?:rate\s+)?cuts?|less\s+(?:room|likely)\s+to\s+cut|dial(?:s|ed|ing)?\s+back\s+(?:rate\s+)?cut\s*(?:bets|odds)?|scale[sd]?\s+back\s+(?:rate\s+)?cut\s*(?:bets|odds)?|(?:rate\s+)?cut\s+(?:odds|bets|expectations|hopes)\s+(?:fade|drop|fall|plunge|slip|tumble|retreat|recede|cool)|tidak\s+buru[- ]buru\s+(?:pangkas|memangkas|turunkan)|tunda\s+pemangkasan(?:\s+suku\s+bunga)?|menunda\s+pemangkasan(?:\s+suku\s+bunga)?|batal\s+(?:pangkas|memangkas)|tidak\s+ada\s+pemangkasan|peluang\s+pemangkasan(?:\s+suku\s+bunga)?\s+(?:memudar|turun|menurun|merosot))\b/gi
    );
    working = negDovish.masked;
    if (negDovish.hit) {
      bearScore += 3.2 * w;
      rateHikeHawkishSignal = true;
    }

    // 2. Mask negated hawkish phrases ("no more hikes", "done hiking") -> Bullish
    const negHawkish = maskMatchedSpans(
      working,
      /\b(?:no\s+(?:more|further)\s+(?:rate\s+)?hikes?|done\s+hiking|rules?\s+out\s+(?:a\s+)?(?:rate\s+)?hikes?|end\s+of\s+(?:rate\s+)?hikes?|pause[sd]?\s+(?:rate\s+)?hikes?|stop\s+hiking|(?:rate\s+)?hike\s+(?:odds|bets)\s+(?:fade|drop|fall)|tidak\s+(?:ada\s+)?kenaikan\s+suku\s+bunga|hentikan\s+kenaikan\s+(?:suku\s+)?bunga|jeda\s+kenaikan\s+(?:suku\s+)?bunga)\b/gi
    );
    working = negHawkish.masked;
    if (negHawkish.hit) {
      bullScore += 2.8 * w;
      rateCutSignal = true;
    }

    // 3. Rate Cut / Fed Easing Narrative (EN + ID) -> BULLISH
    const rateCutMatch = maskMatchedSpans(
      working,
      /\b(?:(?:fed\s+)?rate\s+cuts?|cut(?:s|ting)?\s+(?:interest\s+)?rates?|fed\s+pivot|dovish\s+(?:pivot|tilt|shift|stance|fed|surprise|tone|remarks?|commentary)|monetary\s+easing|policy\s+easing|easing\s+cycle|room\s+(?:for|to)\s+cut|open[sd]?\s+(?:the\s+)?door\s+(?:to|for)\s+(?:rate\s+)?cuts?|support[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|back[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|favor[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|eye[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|signal[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|(?:rate\s+)?cut\s+(?:bets|odds|expectations|hopes)\s+(?:rise|jump|surge|climb|grow|strengthen|mount|boost)|lower\s+(?:interest\s+)?rates?|dovish|qe\b|liquidity\s+injection|(?:peluang\s+|ekspektasi\s+|sinyal\s+)?pemangkasan\s+suku\s+bunga|pangkas\s+suku\s+bunga|potong\s+suku\s+bunga|penurunan\s+suku\s+bunga|turunkan\s+suku\s+bunga|pelonggaran\s+(?:kebijakan(?:\s+the\s+fed)?|moneter|the\s+fed|fed)|kebijakan\s+dovish|sinyal\s+dovish)\b/gi
    );
    working = rateCutMatch.masked;
    if (rateCutMatch.hit) {
      bullScore += 3.2 * w;
      rateCutSignal = true;
    }

    // 4. Slowing / Cooling Inflation, CPI, PCE, PPI, ISM, or Labor -> BULLISH
    const coolingMacroMatch = maskMatchedSpans(
      working,
      /\b(?:(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|prices?|price\s+pressures?|tekanan\s+inflasi|inflasi|ism(?:\s+manufacturing|\s+services|\s+prices)?|labor\s+market|jobs?|hiring|payrolls?|wage\s+growth|wages|economy|economic\s+activity)\s+(?:cools?(?:\s+down)?|cooling|slows?(?:\s+down)?|slowing|slowed|eases?|easing|eased|moderates?|moderating|softens?|softening|falls?|falling|drops?|dropping|dips?|slips?|retreats?|wanes?|tumbles?|subsides?|melambat|mereda|menurun|turun|melemah|melandai)|(?:cooling|cooler|softer|soft|slower|easing|moderating|subdued|benign|muted|lower|weaker|disinflationary|melambatnya|meredanya|turunnya|pelemahan)\s+(?:us\s+)?(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|price\s+pressures?|tekanan\s+inflasi|inflasi|ism(?:\s+manufacturing|\s+services|\s+prices)?|labor|jobs?|hiring|payrolls?|wages?)|disinflation|below\s+(?:forecast|estimate|consensus|expectations?)|misses?\s+(?:forecast|estimates?|expectations?)|(?:cooler|softer|weaker)[- ]than[- ]expected)\b/gi
    );
    working = coolingMacroMatch.masked;
    if (coolingMacroMatch.hit) {
      bullScore += 2.8 * w;
      coolingMacroSignal = true;
    }

    // 5. Rate Hike / Fresh Hawkish Tightening (EN + ID) -> BEARISH
    const rateHikeMatch = maskMatchedSpans(
      working,
      /\b(?:(?:fed\s+)?rate\s+hikes?|hike[sd]?\s+(?:interest\s+)?rates?|hiking\s+(?:interest\s+)?rates?|raise[sd]?\s+(?:interest\s+)?rates?|raising\s+rates?|hawkish\s+(?:pivot|shift|turn|surprise|tightening|stance|tilt|fed|rhetoric|tone|bias|warning)|(?:fresh|new|monetary|policy|further)\s+tightening|tighten(?:s|ing)?\s+(?:policy|monetary)|higher\s+for\s+longer|restrictive\s+(?:policy|stance|for\s+longer)|more\s+(?:rate\s+)?hikes?|(?:25|50|75)[- ]?bps?\s+hike|quantitative\s+tightening|\bqt\b|kenaikan\s+suku\s+bunga|naikkan\s+suku\s+bunga|pengetatan\s+(?:hawkish(?:\s+baru)?|moneter|kebijakan)|kebijakan\s+hawkish|nada\s+hawkish|suku\s+bunga\s+tinggi\s+lebih\s+lama)\b/gi
    );
    working = rateHikeMatch.masked;
    if (rateHikeMatch.hit) {
      bearScore += 3.2 * w;
      rateHikeHawkishSignal = true;
    }

    // 6. Inflation / CPI / ISM Prices Surge / Hotter Macro -> BEARISH
    const inflationSurgeMatch = maskMatchedSpans(
      working,
      /\b(?:(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|prices?|price\s+pressures?|tekanan\s+inflasi|inflasi|ism(?:\s+prices)?)\s+(?:surges?|surging|jumps?|jumping|spikes?|spiking|accelerates?|accelerating|reaccelerates?|heats?\s+up|rises?|rising|climbs?|climbing|runs?\s+hot|stays?\s+(?:hot|elevated|sticky)|rebounds?|persists?|melonjak|memanas|menguat|meningkat|naik\s+tajam)|(?:hotter|hot|surging|spiking|accelerating|rebounding|resurgent|elevated|sticky|persistent|stubborn|upside|lonjakan|memanasnya)\s+(?:us\s+)?(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|price\s+pressures?|tekanan\s+inflasi|inflasi|inflation\s+risks?|ism(?:\s+prices)?)|(?:hotter|stronger)[- ]than[- ]expected|beats?\s+(?:forecast|estimates?|expectations?)|above\s+(?:forecast|estimate|consensus|expectations?)|upside\s+inflation\s+risk)\b/gi
    );
    working = inflationSurgeMatch.masked;
    if (inflationSurgeMatch.hit) {
      bearScore += 2.8 * w;
      inflationSurgeSignal = true;
    }

    // 7A. Geopolitics De-escalation / Ceasefire / Truce & Tariff Rollback -> Safe-Haven Unwind (BEARISH)
    const deescalationMatch = maskMatchedSpans(
      working,
      /\b(?:ceasefire|truce|peace\s+(?:deal|talks?|agreement)|de[- ]?escalat(?:e|es|ion)|hormuz\s+reopen(?:s|ing)?|tariff\s+(?:deal|pause|rollback|truce|exemption|cut)|trade\s+(?:deal|truce|accord)|gencatan\s+senjata|kesepakatan\s+damai|penundaan\s+tarif)\b/gi
    );
    working = deescalationMatch.masked;
    if (deescalationMatch.hit) {
      bearScore += 2.5 * w;
      deescalationSignal = true;
    }

    // 7B. Oil & Energy Relief (OPEC output hike / crude plunge / easing supply) -> BULLISH (lowers inflation)
    const oilReliefMatch = maskMatchedSpans(
      working,
      /\b(?:oil|crude|wti|brent)\b[^.;,]{0,48}\b(?:falls?|drops?|plunges?|tumbles?|slides?|eases?|cools?|retreats?|sinks?|turun|anjlok|merosot)\b|\b(?:opec|opec\+)\b[^.;,]{0,48}\b(?:boost|increase|raise|hike|add)(?:s|ing)?\s+(?:output|supply|production)\b/gi
    );
    working = oilReliefMatch.masked;
    if (oilReliefMatch.hit) {
      bullScore += 2.0 * w;
      oilReliefSignal = true;
    }

    // 7C. Energy / Hormuz / Iran / OPEC Cut Inflation Channel -> BEARISH (Inflation Channel)
    const isOilEnergySurge =
      /\b(OIL|CRUDE|WTI|BRENT|HORMUZ|OPEC)\b/i.test(working) &&
      /\b(SURGE|SURGES|SURGING|SPIKE|SPIKES|SPIKING|JUMP|JUMPS|RALLY|HIGHER|INFLATION|BLOCKADE|CLOSURE|DISRUPTION|OUTPUT\s+CUT|CLIMBS|MELONJAK|TIGHTEN)\b/i.test(
        working
      );
    if (isOilEnergySurge) {
      bearScore += 2.4 * w;
      oilInflationSignal = true;
    }

    // 7D. Tariff & Trade Conflict (assigns TARIFF_TRADE channel distinctly)
    const tariffConflictMatch = maskMatchedSpans(
      working,
      /\b(?:tariffs?|trade\s+war|import\s+dut(?:y|ies)|levies|retaliat(?:e|ion|ory)\s+tariffs?|perang\s+dagang|tarif\s+impor)\b/gi
    );
    working = tariffConflictMatch.masked;
    if (tariffConflictMatch.hit) {
      bullScore += 1.4 * w;
      tariffTradeSignal = true;
    }

    // 7E. Kinetic Geopolitics Safe-Haven Escalation (Hormuz / Iran / Middle East)
    // Strip explicit official denials/refutations first so e.g. "US Centcom: Iran did not strike..." doesn't inflate false safe-haven score
    const deniedGeoCleaned = working.replace(
      /(?:\b(?:iran|israel|russia|hormuz|us|military)\s+)?\b(?:did\s+not|didn't|does\s+not|has\s+not|denies?|denied|refutes?|no\s+evidence\s+of|not\s+true\s+that|falsely\s+claim(?:s|ed)?)\b[^.;,]{0,60}/gi,
      ' '
    );
    const geoEscalationMatch = maskMatchedSpans(
      deniedGeoCleaned,
      /\b(?:hormuz|iran|middle\s+east|israel|strike[sd]?|sanctions?|escalation|missile|nuclear|geopolitic(?:al)?\s+(?:risk|tension|crisis)|safe[- ]haven\s+(?:bid|demand|surge))\b/gi
    );
    if (geoEscalationMatch.hit) {
      bullScore += 2.0 * w;
      geopoliticsSignal = true;
    }

    // 7F. US Equity / Mega-IPO Capital Rotation vs Risk-Off Equity Selloff
    const equityRiskOnDrain = maskMatchedSpans(
      working,
      /\b(?:mega[- ]?ipo|blockbuster\s+ipo|ipo\s+(?:boom|frenzy|surge|debut|draws?\s+liquidity)|risk[- ]on\s+(?:rally|rotation|appetite)|(?:s&p\s*500|nasdaq|dow|wall\s+street|us\s+equities|stocks?)\s+(?:hit(?:s)?\s+(?:record|all[- ]time)\s+high|surges?|rall(?:y|ies)|rallied|booms?|rotates?\s+into\s+risk)|rotation\s+(?:out\s+of\s+(?:gold|safe[- ]havens?)|into\s+(?:equities|stocks|tech|ai)))\b/gi
    );
    working = equityRiskOnDrain.masked;
    if (equityRiskOnDrain.hit) {
      bearScore += 1.9 * w;
      equityRotationSignal = true;
    }

    const equitySelloffMatch = maskMatchedSpans(
      working,
      /\b(?:(?:s&p\s*500|nasdaq|wall\s+street|stocks?|equities)\s+(?:tumbles?|plunges?|selloff|sells?\s+off|drops?|crashes?|slides?)|risk[- ]off\s+(?:selloff|panic|rout)|margin\s+call\s+selloff|flight\s+to\s+safety)\b/gi
    );
    working = equitySelloffMatch.masked;
    if (equitySelloffMatch.hit) {
      bullScore += 1.8 * w;
      equityRotationSignal = true;
    }

    // 7G. Central Bank Physical Buying / China PBoC / Gold ETF Flows
    const cbBullMatch = maskMatchedSpans(
      working,
      /\b(?:central\s+banks?\s+(?:buy(?:s|ing)?|add(?:s|ed|ing)?|boost(?:s|ing)?|accumulat(?:e|es|ing))\s+gold|pboc\s+(?:buys?|adds?|boosts?|reserves?|gold)|china\s+(?:gold\s+(?:buying|reserves?|demand)|stimulus|pboc\s+(?:easing|cut))|(?:gld|gold\s+etf)\s+(?:inflows?|buying|adds?))\b/gi
    );
    working = cbBullMatch.masked;
    if (cbBullMatch.hit) {
      bullScore += 2.2 * w;
      centralBankFlowSignal = true;
    }
    const cbBearMatch = maskMatchedSpans(
      working,
      /\b(?:pboc\s+(?:pauses?|halts?|stops?)\s+gold|(?:gld|gold\s+etf)\s+(?:outflows?|redemptions?)|central\s+bank\s+gold\s+sales?)\b/gi
    );
    working = cbBearMatch.masked;
    if (cbBearMatch.hit) {
      bearScore += 1.9 * w;
      centralBankFlowSignal = true;
    }

    // 7H. Credit / Banking Stress & Treasury Auction / US Fiscal Stress
    const creditOrFiscalMatch = maskMatchedSpans(
      working,
      /\b(?:weak\s+(?:treasury|bond)\s+auction|auction\s+(?:tail|slump)|poor\s+bid[- ]to[- ]cover|government\s+shutdown|debt\s+ceiling\s+(?:standoff|crisis)|sovereign\s+(?:debt|downgrade)|banking\s+(?:stress|crisis|turmoil)|credit\s+(?:crunch|stress|default)|regional\s+bank\s+(?:loss|trouble))\b/gi
    );
    working = creditOrFiscalMatch.masked;
    if (creditOrFiscalMatch.hit) {
      bullScore += 2.2 * w;
      if (/auction|shutdown|debt\s+ceiling/i.test(clause.text)) {
        fiscalAuctionSignal = true;
      } else {
        creditStressSignal = true;
      }
    }

    // 8. Direct DXY / Yield / Gold Market Reaction Signals
    if (
      /\b(?:(?:us\s+)?dollar\s+(?:falls?|drops?|slides?|slips?|weakens?|retreats?|tumbles?)|dxy\s+(?:falls?|drops?|slides?|weakens?)|(?:treasury\s+)?yields?\s+(?:fall|drop|slide|slip|tumble|ease|retreat|pull\s+back)|gold\s+(?:rallies|surges|climbs|jumps|gains|soars|rebounds)|safe[- ]haven\s+(?:demand|bid|buying|flows?))\b/i.test(
        working
      )
    ) {
      bullScore += 2.0 * w;
    }
    if (
      /\b(?:(?:us\s+)?dollar\s+(?:rallies|surges|climbs|jumps|strengthens|gains|hits)|dxy\s+(?:rallies|surges|climbs|jumps|gains)|(?:treasury\s+)?yields?\s+(?:surge|jump|spike|climb|rise|soar)|gold\s+(?:falls|drops|slides|tumbles|slips|retreats|sinks))\b/i.test(
        working
      )
    ) {
      bearScore += 2.0 * w;
    }

    // 9. Weak residual macro caveat phrases (never cancel out main rate-cut / cooling thesis!)
    if (
      /\b(?:tekanan\s+inflasi|inflation\s+pressures?|inflation\s+risks?|risiko\s+inflasi|hold\s+rates?|steady\s+rates?)\b/i.test(
        working
      )
    ) {
      bearScore += 0.65 * w;
    }
  }

  const netDiff = bullScore - bearScore;
  const sentimentForGold: BreakingSentimentType =
    netDiff >= 0.6 ? 'BULLISH' : netDiff <= -0.6 ? 'BEARISH' : 'NEUTRAL';

  let channelType: BreakingNewsHeadline['channelType'] = 'MACRO_DATA';
  let catalystCategory: HeadlineContextEvaluation['catalystCategory'] = 'MIXED_OR_NEUTRAL';

  if (sentimentForGold === 'BULLISH') {
    if (rateCutSignal) {
      channelType = 'FED_SPEECH';
      catalystCategory = 'RATE_CUT_EASING';
    } else if (coolingMacroSignal) {
      channelType = 'MACRO_DATA';
      catalystCategory = 'COOLING_MACRO';
    } else if (centralBankFlowSignal) {
      channelType = 'CENTRAL_BANK_FLOW';
      catalystCategory = 'CENTRAL_BANK_FLOW';
    } else if (creditStressSignal) {
      channelType = 'CREDIT_STRESS';
      catalystCategory = 'CREDIT_STRESS';
    } else if (fiscalAuctionSignal) {
      channelType = 'FISCAL_AUCTION';
      catalystCategory = 'FISCAL_AUCTION';
    } else if (oilReliefSignal) {
      channelType = 'OIL_INFLATION_CHANNEL';
      catalystCategory = 'OIL_RELIEF';
    } else if (tariffTradeSignal) {
      channelType = 'TARIFF_TRADE';
      catalystCategory = 'TARIFF_TRADE';
    } else if (geopoliticsSignal) {
      channelType = 'GEOPOLITICS_SAFEN_HAVEN';
      catalystCategory = 'GEOPOLITICS_SAFE_HAVEN';
    } else if (equityRotationSignal) {
      channelType = 'EQUITY_ROTATION';
      catalystCategory = 'EQUITY_ROTATION';
    }
  } else if (sentimentForGold === 'BEARISH') {
    if (oilInflationSignal) {
      channelType = 'OIL_INFLATION_CHANNEL';
      catalystCategory = 'OIL_INFLATION';
    } else if (rateHikeHawkishSignal) {
      channelType = 'FED_SPEECH';
      catalystCategory = 'RATE_HIKE_HAWKISH';
    } else if (inflationSurgeSignal) {
      channelType = 'MACRO_DATA';
      catalystCategory = 'INFLATION_SURGE';
    } else if (deescalationSignal) {
      channelType = 'GEOPOLITICS_SAFEN_HAVEN';
      catalystCategory = 'GEOPOLITICS_DEESCALATION';
    } else if (equityRotationSignal) {
      channelType = 'EQUITY_ROTATION';
      catalystCategory = 'EQUITY_ROTATION';
    } else if (centralBankFlowSignal) {
      channelType = 'CENTRAL_BANK_FLOW';
      catalystCategory = 'CENTRAL_BANK_FLOW';
    }
  }

  const hasHighImpactTerm =
    rateCutSignal ||
    rateHikeHawkishSignal ||
    oilInflationSignal ||
    inflationSurgeSignal ||
    coolingMacroSignal ||
    deescalationSignal ||
    centralBankFlowSignal ||
    creditStressSignal ||
    fiscalAuctionSignal ||
    matchedKeywords.some((k) =>
      [
        'Fed',
        'FOMC',
        'Warsh',
        'Waller',
        'Powell',
        'Hormuz',
        'Iran',
        'Ceasefire',
        'CPI',
        'PPI',
        'NFP',
        'PCE',
        'ISM',
        'Rate',
        'Cut',
        'Hike',
        'Tariff',
        'Gold',
        'XAU',
        'PBoC',
        'Central Bank',
        'GLD',
        'Shutdown',
        'IPO',
        'Nasdaq',
        'S&P 500',
        'Suku Bunga',
        'Inflasi',
      ].includes(k)
    );

  const impact: 'HIGH' | 'LOW' = hasHighImpactTerm ? 'HIGH' : 'LOW';

  let aiEvaluationId = '';
  let aiEvaluationEn = '';

  if (sentimentForGold === 'BULLISH') {
    if (catalystCategory === 'RATE_CUT_EASING') {
      aiEvaluationId =
        'Konteks kalimat utama: peluang pemangkasan suku bunga / pelonggaran kebijakan The Fed → Katalis BULLISH pada XAU/USD.';
      aiEvaluationEn =
        'Main clause context: Fed rate-cut odds / policy easing narrative → BULLISH catalyst for XAU/USD.';
    } else if (catalystCategory === 'COOLING_MACRO') {
      aiEvaluationId =
        'Konteks kalimat utama: komponen inflasi/CPI/ISM atau tenaga kerja melambat → Katalis BULLISH (menekan DXY & yield).';
      aiEvaluationEn =
        'Main clause context: cooling inflation/CPI/ISM or labor components → BULLISH catalyst (weighs on DXY & yields).';
    } else if (catalystCategory === 'CENTRAL_BANK_FLOW') {
      aiEvaluationId =
        'Arus akumulasi Bank Sentral (PBoC/global) atau aliran dana masuk ETF Emas (GLD) → Penopang struktural BULLISH pada XAU/USD.';
      aiEvaluationEn =
        'Central bank accumulation (PBoC/global) or Gold ETF (GLD) inflows → Structural BULLISH tailwind for XAU/USD.';
    } else if (catalystCategory === 'CREDIT_STRESS' || catalystCategory === 'FISCAL_AUCTION') {
      aiEvaluationId =
        'Tekanan fiskal AS / lelang obligasi lemah / stres kredit perbankan → Aliran dana lindung nilai masuk ke XAU/USD (BULLISH).';
      aiEvaluationEn =
        'US fiscal/debt stress, weak Treasury auction, or credit turmoil → Flight-to-safety inflows into XAU/USD (BULLISH).';
    } else if (catalystCategory === 'OIL_RELIEF') {
      aiEvaluationId =
        'Harga minyak melemah / tambahan pasokan OPEC meredakan kecemasan inflasi energi → Mengurangi beban suku bunga tinggi bagi Emas (BULLISH).';
      aiEvaluationEn =
        'Oil pullback / OPEC supply boost eases energy inflation worries → Reduces hawkish rate pressure on Gold (BULLISH).';
    } else if (catalystCategory === 'TARIFF_TRADE' || catalystCategory === 'GEOPOLITICS_SAFE_HAVEN') {
      aiEvaluationId =
        'Sentimen geopolitik / konflik dagang memicu permintaan Safe-Haven pada XAU/USD (BULLISH).';
      aiEvaluationEn =
        'Geopolitical / trade-tariff tension sparks Safe-Haven demand for XAU/USD (BULLISH).';
    } else if (catalystCategory === 'EQUITY_ROTATION') {
      aiEvaluationId =
        'Aksi jual saham AS (Risk-Off) mengalihkan dana ke aset aman termasuk XAU/USD (BULLISH).';
      aiEvaluationEn =
        'US equity risk-off selloff rotates capital toward defensive Safe-Haven assets like XAU/USD (BULLISH).';
    } else {
      aiEvaluationId =
        'Konteks narasi makro mendukung dorongan naik XAU/USD (BULLISH).';
      aiEvaluationEn =
        'Macro narrative context supports upward XAU/USD momentum (BULLISH).';
    }
  } else if (sentimentForGold === 'BEARISH') {
    if (catalystCategory === 'OIL_INFLATION') {
      aiEvaluationId =
        'Lonjakan energi (Hormuz/OPEC/Minyak) mengaktifkan Inflation Channel → Memicu risiko Fed tetap ketat (BEARISH pada XAU/USD).';
      aiEvaluationEn =
        'Energy spike (Hormuz/OPEC/Oil) activates the Inflation Channel → Increases risk of tighter Fed policy (BEARISH pressure on XAU/USD).';
    } else if (catalystCategory === 'RATE_HIKE_HAWKISH') {
      aiEvaluationId =
        'Konteks kalimat utama: sinyal kenaikan suku bunga / pengetatan hawkish The Fed → Yield & DXY menguat menekan XAU/USD (BEARISH).';
      aiEvaluationEn =
        'Main clause context: rate-hike / fresh hawkish tightening rhetoric → US10Y & DXY reprice higher (BEARISH pressure on XAU/USD).';
    } else if (catalystCategory === 'INFLATION_SURGE') {
      aiEvaluationId =
        'Konteks kalimat utama: lonjakan inflasi / data AS lebih panas → Tekanan BEARISH pada XAU/USD.';
      aiEvaluationEn =
        'Main clause context: inflation surge / hotter US print → BEARISH pressure on XAU/USD.';
    } else if (catalystCategory === 'GEOPOLITICS_DEESCALATION') {
      aiEvaluationId =
        'Merdekanya tensi geopolitik / gencatan senjata / kesepakatan tarif mengurangi kebutuhan lindung nilai → Premi Safe-Haven Emas tergerus (BEARISH).';
      aiEvaluationEn =
        'Geopolitical de-escalation / ceasefire / trade truce unwinds Safe-Haven risk premium → Near-term BEARISH pressure on XAU/USD.';
    } else if (catalystCategory === 'EQUITY_ROTATION') {
      aiEvaluationId =
        'Reli saham AS / daya tarik IPO besar menyedot likuiditas (Risk-On Rotation) keluar sementara dari Emas → Tekanan BEARISH jangka pendek.';
      aiEvaluationEn =
        'US equity rally / mega-IPO liquidity rotation draws speculative capital into Risk-On stocks → Near-term BEARISH headwind on Gold.';
    } else if (catalystCategory === 'CENTRAL_BANK_FLOW') {
      aiEvaluationId =
        'Jeda pembelian Bank Sentral atau arus keluar ETF Emas (GLD outflows) → Melemahkan dukungan aliran fisik (BEARISH).';
      aiEvaluationEn =
        'Central bank purchase pause or Gold ETF (GLD) outflows → Softens institutional physical support (BEARISH).';
    } else {
      aiEvaluationId =
        'Konteks narasi makro mengindikasikan penguatan USD & yield → Tekanan BEARISH pada XAU/USD.';
      aiEvaluationEn =
        'Macro narrative context points to firmer USD & yields → BEARISH pressure on XAU/USD.';
    }
  } else {
    aiEvaluationId =
      'Headline terpantau pada radar makro 12 jam terakhir tanpa arah dominan; tunggu konfirmasi rilis aktual & respons US10Y.';
    aiEvaluationEn =
      'Headline tracked on 12h macro radar without clear directional tilt; await actual release & US10Y yield reaction.';
  }

  return {
    sentimentForGold,
    impact,
    channelType,
    aiEvaluationId,
    aiEvaluationEn,
    bullishScore: Number(bullScore.toFixed(2)),
    bearishScore: Number(bearScore.toFixed(2)),
    catalystCategory,
  };
}

/**
 * Evaluates an RSS headline's main-sentence context for XAU/USD without naive opposing-keyword cancellation.
 * Falls back to the first sentence of `description` only when the headline title itself is neutral.
 */
export function evaluateBreakingHeadlineContext(
  title: string,
  description?: string,
  matchedKeywords: string[] = []
): HeadlineContextEvaluation {
  const titleEval = scoreMainSentenceClause(title, matchedKeywords);
  if (titleEval.sentimentForGold !== 'NEUTRAL' || !description) {
    return titleEval;
  }

  const firstDescSentence = normalizeSentenceText(description).split(/(?<=[.!?])\s+/)[0] || '';
  if (firstDescSentence.length < 15) {
    return titleEval;
  }

  const descEval = scoreMainSentenceClause(firstDescSentence, matchedKeywords);
  if (descEval.sentimentForGold !== 'NEUTRAL') {
    return {
      ...descEval,
      impact: titleEval.impact === 'HIGH' || descEval.impact === 'HIGH' ? 'HIGH' : 'LOW',
    };
  }
  return titleEval;
}

/**
 * Filters raw RSS headlines strictly by BREAKING_NEWS_KEYWORDS, deduplicates titles,
 * filters to the last 12 hours (with fallback to newest items if feed dates are older),
 * and evaluates their macro channel & sentiment for XAU/USD using main-clause context analysis.
 */
export function filterAndScoreBreakingHeadlines(
  rawItems: Array<{ title: string; source: string; pubDate: string; link?: string; description?: string }>
): BreakingNewsHeadline[] {
  const candidates: Array<{
    cleanTitle: string;
    cleanDescription?: string;
    source: string;
    pubDateIso: string;
    pubTimeMs: number;
    link?: string;
    matchedKeywords: string[];
  }> = [];
  const seenTitles = new Set<string>();
  const nowMs = Date.now();
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

  for (const item of rawItems) {
    const cleanTitle = decodeHtmlEntities(item.title || '');
    if (!cleanTitle || cleanTitle.length < 10) continue;

    // Normalize title for strict deduplication across sources
    const normalizedKey = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 75);
    if (!normalizedKey || seenTitles.has(normalizedKey)) continue;

    const matchedKeywords: string[] = [];
    for (const kw of BREAKING_NEWS_KEYWORDS) {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(cleanTitle)) {
        matchedKeywords.push(kw);
      }
    }

    if (matchedKeywords.length === 0) continue;
    seenTitles.add(normalizedKey);

    let pubTimeMs = nowMs;
    let pubDateIso = new Date(nowMs).toISOString();
    if (item.pubDate) {
      const parsedMs = new Date(item.pubDate).getTime();
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        pubTimeMs = parsedMs;
        pubDateIso = new Date(parsedMs).toISOString();
      }
    }

    const cleanDescription = item.description ? decodeHtmlEntities(item.description) : undefined;

    candidates.push({
      cleanTitle,
      cleanDescription,
      source: item.source || 'Macro Wire',
      pubDateIso,
      pubTimeMs,
      link: item.link,
      matchedKeywords,
    });
  }

  // Sort newest first
  candidates.sort((a, b) => b.pubTimeMs - a.pubTimeMs);

  // Filter strictly to the last 12 hours if at least 3 recent items exist; otherwise keep top recent items
  const within12h = candidates.filter((c) => nowMs - c.pubTimeMs <= TWELVE_HOURS_MS && c.pubTimeMs <= nowMs + 3600_000);
  const effectiveList = within12h.length >= 3 ? within12h : candidates;

  const results: BreakingNewsHeadline[] = [];

  for (const item of effectiveList.slice(0, 16)) {
    const { cleanTitle, cleanDescription, matchedKeywords } = item;
    const evaluation = evaluateBreakingHeadlineContext(
      cleanTitle,
      cleanDescription,
      matchedKeywords
    );

    results.push({
      id: `news-${results.length + 1}-${Date.now()}`,
      title: cleanTitle,
      descriptionSummary: cleanDescription ? cleanDescription.slice(0, 220) : undefined,
      source: item.source,
      pubDate: item.pubDateIso,
      link: item.link,
      matchedKeywords,
      impact: evaluation.impact,
      sentimentForGold: evaluation.sentimentForGold,
      channelType: evaluation.channelType,
      aiEvaluationId: evaluation.aiEvaluationId,
      aiEvaluationEn: evaluation.aiEvaluationEn,
    });
  }

  return results;
}

/**
 * Checks if a calendar event is a Fed speech, testimony, or press conference (NOT a quantitative rate decision).
 */
export function isFedSpeechEvent(title: string): boolean {
  const t = (title || '').toUpperCase();
  if (
    t.includes('RATE DECISION') ||
    t.includes('FEDERAL FUNDS RATE') ||
    t.includes('FOMC STATEMENT') ||
    t.includes('ECONOMIC PROJECTIONS') ||
    t.includes('DOT PLOT')
  ) {
    return false;
  }
  return (
    t.includes('SPEAKS') ||
    t.includes('SPEECH') ||
    t.includes('TESTIFIES') ||
    t.includes('TESTIMONY') ||
    t.includes('POWELL') ||
    t.includes('FOMC MEMBER') ||
    t.includes('FED CHAIR') ||
    t.includes('FED GOVERNOR') ||
    t.includes('FOMC PRESS CONFERENCE') ||
    t.includes('CENTRAL BANK')
  );
}

/**
 * Strictly determines whether a USD calendar event is a Primary High-Impact Quantitative Target:
 * ONLY High-impact (Red Folder) quantitative releases:
 * - CPI, Core CPI, PPI, Core PPI
 * - NFP (Non-Farm Employment Change), Unemployment Rate, Average Hourly Earnings
 * - FOMC Rate Decision / Federal Funds Rate / FOMC Statement / Economic Projections / Dot Plot
 * - PCE, Core PCE
 * - GDP (Advance, Prelim, Final, GDP Price Index)
 * - Retail Sales, Core Retail Sales
 * - ISM Manufacturing PMI, ISM Services PMI
 *
 * Strictly EXCLUDES:
 * - Fed Speeches (FOMC Member Speaks, Fed Chair Speaks, Testifies)
 * - Medium / Secondary indicators (Initial Jobless Claims, Unemployment Claims, ADP, JOLTS, Challenger, UoM, Consumer Confidence, ISM Prices)
 */
export function isPrimaryHighImpactEvent(ev: {
  title?: string;
  impact?: string;
  country?: string;
  eventCategory?: 'PRIMARY_HIGH_IMPACT' | 'SUPPORTING_REFERENCE';
}): boolean {
  if (ev.eventCategory === 'SUPPORTING_REFERENCE') return false;
  const title = (ev.title || '').toUpperCase().trim();
  const impact = (ev.impact || 'High').trim();

  // 1. Never allow Fed speeches as primary target
  if (isFedSpeechEvent(title)) {
    return false;
  }

  // 2. Never allow Medium/Secondary supporting reference indicators as primary target
  if (
    title.includes('CLAIMS') ||
    title.includes('JOBLESS') ||
    title.includes('ADP') ||
    title.includes('JOLTS') ||
    title.includes('CHALLENGER') ||
    title.includes('UOM') ||
    title.includes('CONSUMER CONFIDENCE') ||
    title.includes('EMPIRE STATE') ||
    title.includes('PHILLY FED') ||
    title.includes('ISM MANUFACTURING PRICES') ||
    title.includes('ISM SERVICES PRICES') ||
    title.includes('FLASH MANUFACTURING PMI') ||
    title.includes('FLASH SERVICES PMI')
  ) {
    return false;
  }

  // 3. Must match one of the core Tier-1 quantitative volatility targets
  const isTier1Quantitative =
    /\b(CPI|PPI|PCE|NFP|NON-FARM|UNEMPLOYMENT RATE|AVERAGE HOURLY EARNINGS|FOMC RATE|FOMC STATEMENT|FOMC ECONOMIC PROJECTIONS|FEDERAL FUNDS RATE|DOT PLOT|RATE DECISION|GDP|RETAIL SALES|ISM MANUFACTURING PMI|ISM SERVICES PMI)\b/i.test(
      title
    );

  if (!isTier1Quantitative) {
    return false;
  }

  // Allow Average Hourly Earnings when grouped with NFP even if tagged Medium, otherwise require High
  if (title.includes('AVERAGE HOURLY EARNINGS')) {
    return impact === 'High' || impact === 'Medium';
  }

  return impact === 'High';
}

/**
 * Checks whether a USD calendar event belongs to the Supporting Reference & Fed Speeches category
 * (Medium impact data like Initial Jobless Claims, ADP, JOLTS, or any FOMC/Fed Speech).
 */
export function isSupportingReferenceEvent(ev: {
  title?: string;
  impact?: string;
  country?: string;
  eventCategory?: 'PRIMARY_HIGH_IMPACT' | 'SUPPORTING_REFERENCE';
}): boolean {
  return !isPrimaryHighImpactEvent(ev);
}

/**
 * Extracts all Supporting Reference & Fed Speech events (Medium data + FOMC speeches)
 * sorted chronologically near the current time so they can be displayed in "Konteks Pendukung & Pidato Fed"
 * and fed into Gemini as supporting context / Pindah Haluan signals.
 */
export function getSupportingContextEvents(
  events: MacroCalendarEvent[],
  nowMs: number = Date.now()
): MacroCalendarEvent[] {
  if (!events || events.length === 0) return [];
  const THREE_DAYS_PAST_MS = 3 * 24 * 60 * 60 * 1000;
  return events
    .filter((ev) => isSupportingReferenceEvent(ev))
    .filter((ev) => {
      const t = new Date(ev.date).getTime();
      return !Number.isFinite(t) || t >= nowMs - THREE_DAYS_PAST_MS;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Verifies whether a headline explicitly references an FOMC official or central bank policy remark
 * so generic tariff/equity/commodity stories do not falsely trigger Dynamic Pivot.
 */
export function isFedOfficialSpeechOrPolicyHeadline(text: string): boolean {
  if (!text) return false;
  return /\b(?:fed(?:'s)?\s+(?:chair|governor|vice\s+chair|president|officials?|policymakers?|minutes|statement)|fomc|powell|waller|warsh|williams|jefferson|bowman|daly|goolsbee|kashkari|hammack|musalem|schmid|collins|miran|the\s+fed)\b/i.test(
    text
  );
}

/**
 * Analyzes the tone of a Fed speech statement or breaking news headline.
 */
export function analyzeStatementTone(statement: string): 'HAWKISH' | 'DOVISH' | 'NEUTRAL' {
  if (!statement || !statement.trim()) return 'NEUTRAL';
  const contextEval = scoreMainSentenceClause(statement);
  if (contextEval.sentimentForGold === 'BEARISH') return 'HAWKISH';
  if (
    contextEval.sentimentForGold === 'BULLISH' &&
    contextEval.catalystCategory !== 'GEOPOLITICS_SAFE_HAVEN' &&
    contextEval.catalystCategory !== 'TARIFF_TRADE'
  ) {
    return 'DOVISH';
  }
  return 'NEUTRAL';
}

/**
 * Creates a BreakingNewsHeadline from user-pasted speech quote or breaking headline.
 */
export function createCustomBreakingHeadline(text: string): BreakingNewsHeadline {
  const tone = analyzeStatementTone(text);
  const matchedKeywords: string[] = [];
  for (const kw of BREAKING_NEWS_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(text)) {
      matchedKeywords.push(kw);
    }
  }
  if (matchedKeywords.length === 0) {
    matchedKeywords.push('Fed', 'Rate');
  }

  const sentimentForGold: BreakingSentimentType =
    tone === 'HAWKISH' ? 'BEARISH' : tone === 'DOVISH' ? 'BULLISH' : 'NEUTRAL';

  return {
    id: `custom-headline-${Date.now()}`,
    title: text,
    source: 'User Input / Breaking Wire',
    pubDate: new Date().toISOString(),
    matchedKeywords,
    impact: 'HIGH',
    sentimentForGold,
    channelType: 'FED_SPEECH',
    aiEvaluationId:
      tone === 'HAWKISH'
        ? 'Pernyataan bernada Hawkish: memicu kenaikan imbal hasil obligasi & DXY → Tekanan SELL kuat pada XAU/USD (Pindah Haluan: Hawkish Override).'
        : tone === 'DOVISH'
        ? 'Pernyataan bernada Dovish: memicu ekspektasi penurunan imbal hasil & pelemahan DXY → Dorongan BUY kuat pada XAU/USD (Pindah Haluan: Dovish Override).'
        : 'Pernyataan pejabat Fed dipantau; perhatikan reaksi respons US10Y & DXY.',
    aiEvaluationEn:
      tone === 'HAWKISH'
        ? 'Hawkish statement: pushes yields & DXY higher → Strong SELL pressure on XAU/USD (Dynamic Pivot: Hawkish Override).'
        : tone === 'DOVISH'
        ? 'Dovish statement: drives yields & DXY lower → Strong BUY momentum on XAU/USD (Dynamic Pivot: Dovish Override).'
        : 'Fed remarks monitored; observe US10Y & DXY market reaction.',
  };
}

/**
 * Computes a deterministic fingerprint from calendar events, latest multi-source RSS headlines,
 * and optionally the selected event group ID/slot so that any new article from CNBC/FinancialJuice/MarketWatch/FXStreet
 * or any Actual/Forecast calendar update immediately invalidates stale Supabase cache.
 */
export function computeMacroDataFingerprint(
  events: MacroCalendarEvent[],
  headlines: BreakingNewsHeadline[],
  selectedEventSlotKey?: string
): string {
  const eventSig = events
    .slice(0, 10)
    .map((e) => `${e.title}:${e.previous}:${e.forecast}:${e.actual}`)
    .join('|');
  const newsSig = headlines
    .slice(0, 10)
    .map((h) => `${h.source}:${h.title.trim().toLowerCase().slice(0, 64)}:${h.sentimentForGold}`)
    .join('|');
  const slotPart = selectedEventSlotKey ? `##slot:${selectedEventSlotKey}` : '';
  const raw = `${eventSig}##${newsSig}${slotPart}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(16)}`;
}

/**
 * Separates the analysis into two distinct horizons automatically:
 * 1) KATALIS AWAL / POTENSI SPIKE: Computed from latest RSS narrative sentiment + GC=F 3D exhaustion (Oversold <= -2.5% -> BUY spike, Overbought >= +2.5% -> SELL spike).
 * 2) BIAS UTAMA SESI (HASIL AKHIR): Computed from hard macro data (CME FedWatch, US10Y/US02Y Yield, DXY, Actual vs Forecast).
 * 3) Movement Type Badge: "TIPE: 1-ARAH (EARLY STRIKE)" vs "TIPE: 2-ARAH / SWEEP DULU".
 */
export function computeDualHorizonAnalysis(params: {
  breakingNews: BreakingNewsHeadline[];
  goldPositioning?: GoldPositioningPulse;
  dominantBias: MacroBiasDirection;
  buyProbability: number;
  sellProbability: number;
  mixedProbability: number;
  cmeFedWatch: CmeFedWatchState;
  dxy: IntermarketAssetPulse;
  us02y?: IntermarketAssetPulse;
  us10y: IntermarketAssetPulse;
  primaryEvent: MacroCalendarEvent;
  isSimultaneousRelease: boolean;
  simultaneousAlignment: PreNewsScenarioMatrix['simultaneousAlignment'];
  amdContext?: DualHorizonAmdInput;
  calendarEvents?: MacroCalendarEvent[];
  intradayContext?: DualHorizonIntradayInput;
}): DualHorizonAnalysis {
  const {
    breakingNews,
    goldPositioning,
    dominantBias,
    buyProbability,
    sellProbability,
    mixedProbability,
    cmeFedWatch,
    dxy,
    us02y,
    us10y,
    primaryEvent,
    isSimultaneousRelease,
    simultaneousAlignment,
    amdContext,
    calendarEvents = [],
    intradayContext,
  } = params;

  // Re-evaluate narrative RSS headlines using main-sentence context (preserving descriptionSummary when title is neutral)
  const evaluatedHeadlines = breakingNews.map((item) => {
    const ctx = evaluateBreakingHeadlineContext(
      item.title,
      item.descriptionSummary,
      item.matchedKeywords || []
    );
    return {
      item,
      sentiment: ctx.sentimentForGold !== 'NEUTRAL' ? ctx.sentimentForGold : item.sentimentForGold,
      ctx,
    };
  });

  const rssBullishItems = evaluatedHeadlines.filter((h) => h.sentiment === 'BULLISH');
  const rssBearishItems = evaluatedHeadlines.filter((h) => h.sentiment === 'BEARISH');
  const rssBullish = rssBullishItems.length;
  const rssBearish = rssBearishItems.length;
  const rssBullishScore = evaluatedHeadlines.reduce(
    (sum, h) => sum + (h.sentiment === 'BULLISH' ? Math.max(1, h.ctx.bullishScore) : 0),
    0
  );
  const rssBearishScore = evaluatedHeadlines.reduce(
    (sum, h) => sum + (h.sentiment === 'BEARISH' ? Math.max(1, h.ctx.bearishScore) : 0),
    0
  );

  const gold3d =
    goldPositioning && goldPositioning.isAvailable && Number.isFinite(goldPositioning.change3dPercent)
      ? goldPositioning.change3dPercent
      : 0;
  const isOversold3d = goldPositioning?.isAvailable !== false && gold3d <= -2.5;
  const isOverbought3d = goldPositioning?.isAvailable !== false && gold3d >= 2.5;
  const isExtreme3d = isOversold3d || isOverbought3d;

  // 1. Evaluate Initial Catalyst / Spike Potential strictly from Main-Clause RSS Narrative + GC=F 3D Positioning
  // Never overwrite neutral/balanced RSS with Session Primary Bias ("Buy the Rumor" / Hard Macro).
  let initialCatalystBias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  let initialCatalystReasonId = '';
  let initialCatalystReasonEn = '';

  const topBullHeadline = rssBullishItems[0];
  const topBearHeadline = rssBearishItems[0];
  const clipTitle = (t: string) => (t.length > 78 ? `${t.slice(0, 75)}...` : t);

  const isRssNetBullish =
    rssBullish > rssBearish || (rssBullish > 0 && rssBullish === rssBearish && rssBullishScore > rssBearishScore + 0.5);
  const isRssNetBearish =
    rssBearish > rssBullish || (rssBearish > 0 && rssBearish === rssBearish && rssBearishScore > rssBullishScore + 0.5);

  if (isOversold3d) {
    initialCatalystBias = 'BUY';
    initialCatalystReasonId = `GC=F 3D Oversold (${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Rawan dorongan short-covering ke ATAS (BUY awal).`;
    initialCatalystReasonEn = `GC=F 3D Oversold (${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Prone to initial upward BUY short-covering push.`;
  } else if (isOverbought3d) {
    initialCatalystBias = 'SELL';
    initialCatalystReasonId = `GC=F 3D Overbought (+${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Rawan tekanan profit-taking ke BAWAH (SELL awal).`;
    initialCatalystReasonEn = `GC=F 3D Overbought (+${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Prone to initial downward SELL profit-taking push.`;
  } else if (isRssNetBullish && topBullHeadline) {
    initialCatalystBias = 'BUY';
    const driverId =
      topBullHeadline.ctx.catalystCategory === 'RATE_CUT_EASING'
        ? 'peluang rate cut / pelonggaran The Fed'
        : topBullHeadline.ctx.catalystCategory === 'COOLING_MACRO'
        ? 'pelambatan inflasi / CPI / ISM'
        : topBullHeadline.ctx.catalystCategory === 'GEOPOLITICS_SAFE_HAVEN'
        ? 'permintaan safe-haven'
        : 'narasi dovish';
    const driverEn =
      topBullHeadline.ctx.catalystCategory === 'RATE_CUT_EASING'
        ? 'Fed rate-cut / easing odds'
        : topBullHeadline.ctx.catalystCategory === 'COOLING_MACRO'
        ? 'cooling inflation / CPI / ISM'
        : topBullHeadline.ctx.catalystCategory === 'GEOPOLITICS_SAFE_HAVEN'
        ? 'safe-haven flows'
        : 'dovish narrative';
    initialCatalystReasonId = `Konteks kalimat utama RSS (${rssBullish}B/${rssBearish}S) menyoroti ${driverId} ["${clipTitle(
      topBullHeadline.item.title
    )}"] + GC=F 3D netral (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%).`;
    initialCatalystReasonEn = `RSS main-clause context (${rssBullish}B/${rssBearish}S) highlights ${driverEn} ["${clipTitle(
      topBullHeadline.item.title
    )}"] + neutral GC=F 3D (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%).`;
  } else if (isRssNetBearish && topBearHeadline) {
    initialCatalystBias = 'SELL';
    const driverId =
      topBearHeadline.ctx.catalystCategory === 'RATE_HIKE_HAWKISH'
        ? 'kenaikan suku bunga / pengetatan hawkish'
        : topBearHeadline.ctx.catalystCategory === 'INFLATION_SURGE' ||
          topBearHeadline.ctx.catalystCategory === 'OIL_INFLATION'
        ? 'lonjakan inflasi / risiko energi'
        : 'narasi hawkish';
    const driverEn =
      topBearHeadline.ctx.catalystCategory === 'RATE_HIKE_HAWKISH'
        ? 'rate-hike / hawkish tightening'
        : topBearHeadline.ctx.catalystCategory === 'INFLATION_SURGE' ||
          topBearHeadline.ctx.catalystCategory === 'OIL_INFLATION'
        ? 'inflation / energy surge'
        : 'hawkish narrative';
    initialCatalystReasonId = `Konteks kalimat utama RSS (${rssBearish}S/${rssBullish}B) menyoroti ${driverId} ["${clipTitle(
      topBearHeadline.item.title
    )}"] + GC=F 3D netral (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%).`;
    initialCatalystReasonEn = `RSS main-clause context (${rssBearish}S/${rssBullish}B) highlights ${driverEn} ["${clipTitle(
      topBearHeadline.item.title
    )}"] + neutral GC=F 3D (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%).`;
  } else {
    initialCatalystBias = 'NEUTRAL';
    initialCatalystReasonId = `Narasi RSS berimbang (${rssBullish}B/${rssBearish}S) & posisi GC=F 3D netral (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%).`;
    initialCatalystReasonEn = `Balanced RSS narrative (${rssBullish}B/${rssBearish}S) & neutral GC=F 3D positioning (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%).`;
  }

  const initialCatalystLabelId =
    initialCatalystBias === 'BUY'
      ? 'TEKANAN AWAL NAIK (BUY)'
      : initialCatalystBias === 'SELL'
      ? 'TEKANAN AWAL TURUN (SELL)'
      : 'NETRAL / SEIMBANG';
  const initialCatalystLabelEn =
    initialCatalystBias === 'BUY'
      ? 'INITIAL PUSH UP (BUY)'
      : initialCatalystBias === 'SELL'
      ? 'INITIAL PUSH DOWN (SELL)'
      : 'NEUTRAL / BALANCED';

  // 2. Evaluate Session Primary Bias (Hard Macro Data: CME FedWatch, US10Y/US02Y, DXY, Actual vs Forecast)
  const sessionPrimaryBias: MacroBiasDirection = dominantBias;
  const sessionPrimaryProbability =
    dominantBias === 'BUY'
      ? buyProbability
      : dominantBias === 'SELL'
      ? sellProbability
      : mixedProbability;

  const sessionPrimaryLabelId = `${sessionPrimaryBias} ${sessionPrimaryProbability}%`;
  const sessionPrimaryLabelEn = `${sessionPrimaryBias} ${sessionPrimaryProbability}%`;

  const fedWatchTag = cmeFedWatch.isAvailable
    ? cmeFedWatch.dominantOutcome === 'CUT'
      ? `FedWatch Cut ${cmeFedWatch.cutProbability}%`
      : cmeFedWatch.dominantOutcome === 'HIKE'
      ? `FedWatch Hike ${cmeFedWatch.hikeProbability}%`
      : `FedWatch Hold ${cmeFedWatch.holdProbability}%`
    : 'Implied Rate';

  const hasActual = Boolean(primaryEvent.actual && primaryEvent.actual.trim());
  const dataTagId = hasActual
    ? `Aktual ${primaryEvent.actual} vs Fcst ${primaryEvent.forecast}`
    : `Fcst ${primaryEvent.forecast} vs Prev ${primaryEvent.previous}`;
  const dataTagEn = hasActual
    ? `Actual ${primaryEvent.actual} vs Fcst ${primaryEvent.forecast}`
    : `Fcst ${primaryEvent.forecast} vs Prev ${primaryEvent.previous}`;

  const yieldTag =
    us10y.isAvailable !== false && us10y.price > 0
      ? `US10Y ${us10y.price.toFixed(2)}% (${us10y.direction})`
      : 'US10Y';
  const dxyTag =
    dxy.isAvailable !== false && dxy.price > 0
      ? `DXY ${dxy.price.toFixed(2)} (${dxy.direction})`
      : 'DXY';

  const sessionPrimaryReasonId = `${fedWatchTag} · ${yieldTag} · ${dxyTag} · ${dataTagId}`;
  const sessionPrimaryReasonEn = `${fedWatchTag} · ${yieldTag} · ${dxyTag} · ${dataTagEn}`;

  // 3A. Automatic Detection: HAS_SPEECH_EVENT (-1 hour to +2 hours around primaryEvent.date)
  const SPEECH_EVENT_REGEX = /\b(SPEECH|SPEAKS|TESTIMONY|TESTIFIES|PRESS CONFERENCE|FOMC)\b/i;
  const primaryTimeMs = new Date(primaryEvent.date).getTime();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  const speechEventsNearbySet = new Set<string>();
  if (SPEECH_EVENT_REGEX.test(primaryEvent.title || '')) {
    speechEventsNearbySet.add(primaryEvent.title);
  }
  if (Number.isFinite(primaryTimeMs) && Array.isArray(calendarEvents)) {
    for (const ev of calendarEvents) {
      if (!ev || !ev.title) continue;
      if (!SPEECH_EVENT_REGEX.test(ev.title)) continue;
      const evMs = new Date(ev.date).getTime();
      if (!Number.isFinite(evMs)) continue;
      const diffMs = evMs - primaryTimeMs;
      if (diffMs >= -ONE_HOUR_MS && diffMs <= TWO_HOURS_MS) {
        speechEventsNearbySet.add(ev.title);
      }
    }
  }
  const speechEventsNearby = Array.from(speechEventsNearbySet);
  const hasSpeechEvent = speechEventsNearby.length > 0;

  const speechAlertNoteId = hasSpeechEvent
    ? `HAS_SPEECH_EVENT Aktif: Terjadwal agenda [${speechEventsNearby.join(', ')}] dalam rentang -1 jam s/d +2 jam dari rilis utama — waspadai volatilitas 2 arah & komentar dadakan pejabat Fed.`
    : undefined;
  const speechAlertNoteEn = hasSpeechEvent
    ? `HAS_SPEECH_EVENT Active: [${speechEventsNearby.join(', ')}] scheduled within -1h to +2h of primary release — watch for 2-way whipsaws & live Fed remarks.`
    : undefined;

  // 3B. Automatic Detection: IS_PRICED_IN (6-hour XAU/USD move > 1.5x ATR(14) 1H in direction of forecast)
  const rawMove6hUsd =
    typeof intradayContext?.change6hUsd === 'number' && Number.isFinite(intradayContext.change6hUsd)
      ? intradayContext.change6hUsd
      : typeof goldPositioning?.change6hUsd === 'number' && Number.isFinite(goldPositioning.change6hUsd)
      ? goldPositioning.change6hUsd
      : 0;
  const rawAtr14_1h =
    typeof intradayContext?.atr14_1h === 'number' && Number.isFinite(intradayContext.atr14_1h) && intradayContext.atr14_1h > 0
      ? intradayContext.atr14_1h
      : typeof goldPositioning?.atr14_1h === 'number' && Number.isFinite(goldPositioning.atr14_1h) && goldPositioning.atr14_1h > 0
      ? goldPositioning.atr14_1h
      : 12.0;

  const move6hUsd = Number(rawMove6hUsd.toFixed(2));
  const atr14_1h = Number(rawAtr14_1h.toFixed(2));
  const pricedInThresholdUsd = Number((1.5 * atr14_1h).toFixed(2));

  const forecastDirection: MacroBiasDirection =
    primaryEvent.eventBiasForGold !== 'MIXED' ? primaryEvent.eventBiasForGold : sessionPrimaryBias;

  const isPricedIn =
    atr14_1h > 0 &&
    ((forecastDirection === 'BUY' && move6hUsd > pricedInThresholdUsd) ||
      (forecastDirection === 'SELL' && move6hUsd < -pricedInThresholdUsd) ||
      (forecastDirection === 'MIXED' && Math.abs(move6hUsd) > pricedInThresholdUsd));

  const pricedInNoteId = isPricedIn
    ? `IS_PRICED_IN Aktif: Harga XAU/USD dalam 6 jam terakhir sudah bergerak ekstrem ${
        move6hUsd >= 0 ? '+' : ''
      }$${move6hUsd.toFixed(2)} (> 1.5x ATR 1H = $${pricedInThresholdUsd.toFixed(
        2
      )}) searah ekspektasi data (${forecastDirection}) — rawan profit-taking / gerak balik di menit awal rilis.`
    : undefined;
  const pricedInNoteEn = isPricedIn
    ? `IS_PRICED_IN Active: XAU/USD moved ${
        move6hUsd >= 0 ? '+' : ''
      }$${move6hUsd.toFixed(2)} in the last 6 hours (> 1.5x ATR 1H = $${pricedInThresholdUsd.toFixed(
        2
      )}) in the direction of data forecast (${forecastDirection}) — prone to opening profit-taking / reverse sweep.`
    : undefined;

  // 3C. Determine Movement Type: "2 ARAH (SWEEP FIRST)" vs "1 ARAH (DIRECT EXPANSION)"
  const isDxyAvail = dxy.isAvailable !== false && dxy.price > 0;
  const isUs02yAvail = Boolean(us02y && us02y.isAvailable !== false && us02y.price > 0);
  const isUs10yAvail = us10y.isAvailable !== false && us10y.price > 0;
  const dxyPct = isDxyAvail ? dxy.changePercent : 0;
  const us02yPct = isUs02yAvail && us02y ? us02y.changePercent : 0;
  const us10yPct = isUs10yAvail ? us10y.changePercent : 0;

  const hasOpposingCatalyst =
    (initialCatalystBias === 'BUY' && sessionPrimaryBias === 'SELL') ||
    (initialCatalystBias === 'SELL' && sessionPrimaryBias === 'BUY');

  const hasDxyUs02yDivergence = Boolean(
    isDxyAvail &&
      isUs02yAvail &&
      us02y &&
      ((dxy.direction === 'UP' && us02y.direction === 'DOWN') ||
        (dxy.direction === 'DOWN' && us02y.direction === 'UP') ||
        (dxyPct >= 0.5 && us02yPct <= -0.3) ||
        (dxyPct <= -0.5 && us02yPct >= 0.3))
  );

  const hasDxyUs10yDivergence = Boolean(
    isDxyAvail &&
      isUs10yAvail &&
      ((dxy.direction === 'UP' && us10y.direction === 'DOWN') ||
        (dxy.direction === 'DOWN' && us10y.direction === 'UP') ||
        (dxyPct >= 0.5 && us10yPct <= -0.3) ||
        (dxyPct <= -0.5 && us10yPct >= 0.3))
  );

  const hasDxyYieldDivergence = hasDxyUs02yDivergence || hasDxyUs10yDivergence;

  const hasSimultaneousMultiHighImpact =
    isSimultaneousRelease || simultaneousAlignment === 'CONFLICTING_WHIPSAW';

  const amdPhaseUpper = String(amdContext?.phase || '').toUpperCase();
  const manualOverrideUpper = String(amdContext?.manualOverrideMode || 'AUTO').toUpperCase();
  const isAmdAccumulationOrManipulation =
    manualOverrideUpper === 'ACCUMULATION' ||
    manualOverrideUpper === 'MANIPULATION' ||
    amdPhaseUpper === 'ACCUMULATION' ||
    amdPhaseUpper === 'DOUBLE_ACCUMULATION' ||
    amdPhaseUpper === 'RE-ACCUMULATION' ||
    amdPhaseUpper === 'MANIPULATION';

  const spikeTriggerReasonsId: string[] = [];
  const spikeTriggerReasonsEn: string[] = [];

  if (hasSpeechEvent && speechAlertNoteId && speechAlertNoteEn) {
    spikeTriggerReasonsId.push(speechAlertNoteId);
    spikeTriggerReasonsEn.push(speechAlertNoteEn);
  }
  if (isPricedIn && pricedInNoteId && pricedInNoteEn) {
    spikeTriggerReasonsId.push(pricedInNoteId);
    spikeTriggerReasonsEn.push(pricedInNoteEn);
  }
  if (hasOpposingCatalyst) {
    spikeTriggerReasonsId.push(
      `Katalis Awal (${initialCatalystBias}) berlawanan arah dengan Bias Utama Sesi (${sessionPrimaryBias} ${sessionPrimaryProbability}%) — rawan fake move pembuka sebelum harga berbalik searah data makro keras.`
    );
    spikeTriggerReasonsEn.push(
      `Initial Catalyst (${initialCatalystBias}) opposes Main Session Bias (${sessionPrimaryBias} ${sessionPrimaryProbability}%) — prone to an opening fake move before reversing with hard macro data.`
    );
  }
  if (isExtreme3d) {
    spikeTriggerReasonsId.push(
      `GC=F 3D berada di zona ekstrem (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%, ${
        isOversold3d ? 'Oversold ≤ -2.5%' : 'Overbought ≥ +2.5%'
      }) — rawan ${isOversold3d ? 'short-squeeze' : 'profit-taking / long-liquidation'} di detik rilis.`
    );
    spikeTriggerReasonsEn.push(
      `GC=F 3D is at an extreme (${gold3d >= 0 ? '+' : ''}${gold3d.toFixed(2)}%, ${
        isOversold3d ? 'Oversold ≤ -2.5%' : 'Overbought ≥ +2.5%'
      }) — prone to ${isOversold3d ? 'short-squeeze' : 'long-liquidation'} at release.`
    );
  }
  if (hasDxyYieldDivergence) {
    const yieldCompareLabel = hasDxyUs02yDivergence && us02y
      ? `US02Y Yield (${us02y.direction} ${us02yPct >= 0 ? '+' : ''}${us02yPct.toFixed(2)}%)`
      : `US10Y Yield (${us10y.direction} ${us10yPct >= 0 ? '+' : ''}${us10yPct.toFixed(2)}%)`;
    spikeTriggerReasonsId.push(
      `Divergensi arah DXY (${dxy.direction} ${dxyPct >= 0 ? '+' : ''}${dxyPct.toFixed(
        2
      )}%) vs ${yieldCompareLabel} — arus lintas aset terbelah memicu sapuan likuiditas 2 arah.`
    );
    spikeTriggerReasonsEn.push(
      `Directional divergence between DXY (${dxy.direction} ${dxyPct >= 0 ? '+' : ''}${dxyPct.toFixed(
        2
      )}%) and ${yieldCompareLabel} — split cross-asset flow induces 2-way liquidity sweeps.`
    );
  }
  if (hasSimultaneousMultiHighImpact) {
    spikeTriggerReasonsId.push(
      simultaneousAlignment === 'CONFLICTING_WHIPSAW'
        ? 'Rilis simultan ≥ 2 data High-Impact dengan sinyal bertabrakan — probabilitas spike 2 arah sangat tinggi.'
        : 'Terdapat ≥ 2 data ekonomi berdampak tinggi rilis bersamaan pada slot waktu yang sama.'
    );
    spikeTriggerReasonsEn.push(
      simultaneousAlignment === 'CONFLICTING_WHIPSAW'
        ? 'Simultaneous release of ≥ 2 High-Impact prints with conflicting signals — high 2-way whipsaw risk.'
        : '≥ 2 High-Impact economic indicators release simultaneously in the same time slot.'
    );
  }
  if (isAmdAccumulationOrManipulation) {
    const isManipulationPhase =
      manualOverrideUpper === 'MANIPULATION' || amdPhaseUpper === 'MANIPULATION';
    const sourceTagId = amdContext?.isManualOverride ? 'Manual AMD Lock' : 'AMD Gatekeeper Otomatis';
    const sourceTagEn = amdContext?.isManualOverride ? 'Manual AMD Lock' : 'Auto AMD Gatekeeper';
    spikeTriggerReasonsId.push(
      isManipulationPhase
        ? `${sourceTagId} berada di fase Manipulasi${
            amdContext?.currentSessionLabel ? ` (${amdContext.currentSessionLabel})` : ''
          } — pasar aktif melakukan sapuan likuiditas / stop-hunt sebelum ekspansi tren.`
        : `${sourceTagId} berada di fase Akumulasi${
            amdContext?.currentSessionLabel ? ` (${amdContext.currentSessionLabel})` : ''
          } — rentang sesi terkompresi membangun kolam likuiditas BSL/SSL yang siap disapu saat rilis.`
    );
    spikeTriggerReasonsEn.push(
      isManipulationPhase
        ? `${sourceTagEn} is in Manipulation phase${
            amdContext?.currentSessionLabel ? ` (${amdContext.currentSessionLabel})` : ''
          } — active liquidity sweep / stop-hunt in progress ahead of trend expansion.`
        : `${sourceTagEn} is in Accumulation phase${
            amdContext?.currentSessionLabel ? ` (${amdContext.currentSessionLabel})` : ''
          } — compressed session box builds BSL/SSL liquidity primed to be swept at release.`
    );
  }

  const hasTwoWaySweepTrigger =
    hasSpeechEvent ||
    isPricedIn ||
    hasOpposingCatalyst ||
    isExtreme3d ||
    hasDxyYieldDivergence ||
    hasSimultaneousMultiHighImpact ||
    isAmdAccumulationOrManipulation;

  const isOneWayEarlyStrike = !hasTwoWaySweepTrigger;

  const movementType: DualHorizonAnalysis['movementType'] = isOneWayEarlyStrike
    ? 'ONE_WAY_EARLY_STRIKE'
    : 'TWO_WAY_SWEEP_FIRST';

  const movementBadgeId = isOneWayEarlyStrike
    ? 'TIPE PERGERAKAN: [1 ARAH — DIRECT EXPANSION]'
    : 'TIPE PERGERAKAN: [2 ARAH — SWEEP FIRST]';
  const movementBadgeEn = isOneWayEarlyStrike
    ? 'MOVEMENT TYPE: [1-WAY — DIRECT EXPANSION]'
    : 'MOVEMENT TYPE: [2-WAY — SWEEP FIRST]';

  const movementSummaryId = isOneWayEarlyStrike
    ? 'Seluruh sinyal intermarket (DXY & US02Y/US10Y), katalis data, dan bias sesi selaras tanpa konflik jadwal pidato maupun kejenuhan harga 6 jam — mendukung ekspansi langsung 1 arah (Direct Expansion).'
    : `Terdeteksi ${spikeTriggerReasonsId.length} pemicu otomatis [2 ARAH — SWEEP FIRST] — tahan eksekusi detik ke-0 dan jangan entry melawan Bias Utama (${sessionPrimaryBias}); perlakukan potensi sapuan hanya sebagai zona tunggu konfirmasi.`;
  const movementSummaryEn = isOneWayEarlyStrike
    ? 'All intermarket signals (DXY & US02Y/US10Y), data catalyst, and session bias align with no speech schedule conflicts or 6H priced-in exhaustion — supports 1-Way Direct Expansion.'
    : `${spikeTriggerReasonsEn.length} automatic [2-WAY — SWEEP FIRST] trigger(s) active — hold 0-second orders and never trade against Main Bias (${sessionPrimaryBias}); treat any sweep zone strictly as a confirmation wait area.`;

  // 4. Construct 2-Phase Manipulation & Expansion Scenario:
  //    - Fase 1 (Menit 0–5 Rilis)
  //    - Fase 2 (Menit 15+ / Lanjutan)
  const bslLabel =
    typeof intradayContext?.bslPrice === 'number' && intradayContext.bslPrice > 0
      ? `$${intradayContext.bslPrice.toFixed(2)}`
      : 'BSL Sesi';
  const sslLabel =
    typeof intradayContext?.sslPrice === 'number' && intradayContext.sslPrice > 0
      ? `$${intradayContext.sslPrice.toFixed(2)}`
      : 'SSL Sesi';
  const poiRangeLabel =
    typeof intradayContext?.poiLow === 'number' &&
    typeof intradayContext?.poiHigh === 'number' &&
    intradayContext.poiLow > 0 &&
    intradayContext.poiHigh > 0
      ? `$${intradayContext.poiLow.toFixed(2)} – $${intradayContext.poiHigh.toFixed(2)}`
      : 'POI Lapis 1 (1H/15M)';

  let phase1Minute0to5Id = '';
  let phase1Minute0to5En = '';
  let phase2Minute15PlusId = '';
  let phase2Minute15PlusEn = '';

  const extraWarningsId: string[] = [];
  const extraWarningsEn: string[] = [];
  if (isPricedIn) {
    extraWarningsId.push(
      `PERINGATAN PRICED-IN: Harga 6J sudah lari ${move6hUsd >= 0 ? '+' : ''}$${move6hUsd.toFixed(
        2
      )} (>1.5x ATR 1H $${pricedInThresholdUsd.toFixed(2)}), rawan profit-taking balik di menit pembuka`
    );
    extraWarningsEn.push(
      `PRICED-IN WARNING: 6H price already ran ${move6hUsd >= 0 ? '+' : ''}$${move6hUsd.toFixed(
        2
      )} (>1.5x 1H ATR $${pricedInThresholdUsd.toFixed(2)}), prone to opening profit-taking fade`
    );
  }
  if (hasSpeechEvent) {
    extraWarningsId.push(`PERINGATAN PIDATO: Jadwal [${speechEventsNearby.slice(0, 2).join(', ')}] di sekitar rilis`);
    extraWarningsEn.push(`SPEECH ALERT: [${speechEventsNearby.slice(0, 2).join(', ')}] near release window`);
  }
  const warningSuffixId = extraWarningsId.length > 0 ? ` [${extraWarningsId.join(' · ')}].` : '';
  const warningSuffixEn = extraWarningsEn.length > 0 ? ` [${extraWarningsEn.join(' · ')}].` : '';

  if (isOneWayEarlyStrike) {
    if (sessionPrimaryBias === 'BUY') {
      phase1Minute0to5Id = `Dorongan impulsif 1-arah (Direct Expansion) langsung menguji & menembus ${bslLabel} seiring keselarasan DXY melemah & US02Y turun tanpa hambatan priced-in.${warningSuffixId}`;
      phase1Minute0to5En = `Direct 1-way bullish expansion immediately testing and breaking ${bslLabel} as softening DXY & US02Y align without priced-in exhaustion.${warningSuffixEn}`;
      phase2Minute15PlusId = `Harga bertahan di atas ${bslLabel}; manfaatkan retest dangkal pada FVG/struktur M5–M15 (${poiRangeLabel}) untuk kelanjutan ekspansi BUY XAU/USD (${sessionPrimaryProbability}%).`;
      phase2Minute15PlusEn = `Price holds above ${bslLabel}; use shallow M5–M15 pullback into ${poiRangeLabel} for BUY XAU/USD trend continuation (${sessionPrimaryProbability}%).`;
    } else if (sessionPrimaryBias === 'SELL') {
      phase1Minute0to5Id = `Dorongan impulsif 1-arah (Direct Expansion) langsung menekan & menjebol ${sslLabel} seiring keselarasan DXY menguat & US02Y naik tanpa hambatan priced-in.${warningSuffixId}`;
      phase1Minute0to5En = `Direct 1-way bearish expansion immediately pressuring and breaking ${sslLabel} as firming DXY & US02Y align without priced-in exhaustion.${warningSuffixEn}`;
      phase2Minute15PlusId = `Harga bertahan di bawah ${sslLabel}; manfaatkan pullback tipis ke FVG/struktur M5–M15 (${poiRangeLabel}) untuk kelanjutan ekspansi SELL XAU/USD (${sessionPrimaryProbability}%).`;
      phase2Minute15PlusEn = `Price holds below ${sslLabel}; use shallow M5–M15 pullback into ${poiRangeLabel} for SELL XAU/USD trend continuation (${sessionPrimaryProbability}%).`;
    } else {
      phase1Minute0to5Id = `Reaksi pembuka menguji batas likuiditas terdekat (${bslLabel} / ${sslLabel}) sambil menunggu konfirmasi deviasi aktual.${warningSuffixId}`;
      phase1Minute0to5En = `Opening reaction probes nearest session liquidity (${bslLabel} / ${sslLabel}) awaiting actual print deviation.${warningSuffixEn}`;
      phase2Minute15PlusId = `Ekspansi lanjutan mengikuti penutupan candle M15 di luar rentang sesi (${poiRangeLabel}) yang terkonfirmasi searah oleh DXY & US02Y.`;
      phase2Minute15PlusEn = `Follow-through expansion tracks the M15 candle close outside the session range (${poiRangeLabel}) confirmed by DXY & US02Y.`;
    }
  } else {
    // 2 ARAH (SWEEP FIRST) — align narrative strictly with initialCatalystBias + sessionPrimaryBias
    if (sessionPrimaryBias === 'SELL') {
      if (initialCatalystBias === 'SELL') {
        phase1Minute0to5Id = `Katalis awal & Bias Utama sama-sama BEARISH — harga berpeluang langsung menekan ${sslLabel} sejak detik awal; namun karena pemicu 2-arah aktif, waspadai pantulan/sapuan semu ke atas menuju ${bslLabel} / Supply ${poiRangeLabel} (BUKAN sinyal BUY, hanya area tunggu SELL).${warningSuffixId}`;
        phase1Minute0to5En = `Both Initial Catalyst and Main Bias are BEARISH — price may drop straight toward ${sslLabel} from second 0; however, with 2-way triggers active, watch for a false upside bounce/sweep into ${bslLabel} / Supply ${poiRangeLabel} (NOT a BUY signal — wait-for-SELL zone only).${warningSuffixEn}`;
        phase2Minute15PlusId = `Fokus HANYA cari SELL (${sessionPrimaryProbability}%): ikuti kelanjutan turun lewat pullback M5–M15 jika langsung jebol ${sslLabel}, atau tunggu wick rejection / CHoCH di ${poiRangeLabel} bila sempat terjadi sapuan ke atas.`;
        phase2Minute15PlusEn = `Focus ONLY on SELL (${sessionPrimaryProbability}%): join continuation via M5–M15 pullback if ${sslLabel} breaks immediately, or wait for wick rejection / CHoCH at ${poiRangeLabel} if an upside sweep occurs.`;
      } else {
        phase1Minute0to5Id = `Waspadai jebakan naik sesaat (sapuan likuiditas atas) menyapu ${bslLabel} ke Supply Intraday ${poiRangeLabel} (Cap 1.8x ATR 1H) — BUKAN sinyal BUY detik ke-0; hindari entry melawan Bias Utama SELL.${warningSuffixId}`;
        phase1Minute0to5En = `Watch for a temporary upside liquidity sweep clearing ${bslLabel} into Intraday Supply ${poiRangeLabel} (1.8x 1H ATR Cap) — NOT a 0-second BUY signal; avoid trading against the Main SELL Bias.${warningSuffixEn}`;
        phase2Minute15PlusId = `Fokus HANYA cari SELL (${sessionPrimaryProbability}%): tunggu sapuan atas mereda & muncul wick rejection / CHoCH M5–M15 di ${poiRangeLabel} (atau manfaatkan retest jika harga langsung turun), menargetkan ${sslLabel}.`;
        phase2Minute15PlusEn = `Focus ONLY on SELL (${sessionPrimaryProbability}%): wait for the upside sweep to stall with M5–M15 wick rejection / CHoCH at ${poiRangeLabel} (or use a pullback retest if price drops immediately), targeting ${sslLabel}.`;
      }
    } else if (sessionPrimaryBias === 'BUY') {
      if (initialCatalystBias === 'BUY') {
        phase1Minute0to5Id = `Katalis awal & Bias Utama sama-sama BULLISH — harga berpeluang langsung menembus ${bslLabel} sejak detik awal; namun karena pemicu 2-arah aktif, waspadai koreksi/sapuan semu ke bawah menuju ${sslLabel} / Demand ${poiRangeLabel} (BUKAN sinyal SELL, hanya area tunggu BUY).${warningSuffixId}`;
        phase1Minute0to5En = `Both Initial Catalyst and Main Bias are BULLISH — price may break straight toward ${bslLabel} from second 0; however, with 2-way triggers active, watch for a false downside dip/sweep into ${sslLabel} / Demand ${poiRangeLabel} (NOT a SELL signal — wait-for-BUY zone only).${warningSuffixEn}`;
        phase2Minute15PlusId = `Fokus HANYA cari BUY (${sessionPrimaryProbability}%): ikuti kelanjutan naik lewat pullback M5–M15 jika langsung tembus ${bslLabel}, atau tunggu penolakan / CHoCH di ${poiRangeLabel} bila sempat terjadi sapuan ke bawah.`;
        phase2Minute15PlusEn = `Focus ONLY on BUY (${sessionPrimaryProbability}%): join continuation via M5–M15 pullback if ${bslLabel} breaks immediately, or wait for rejection / CHoCH at ${poiRangeLabel} if a downside sweep occurs.`;
      } else {
        phase1Minute0to5Id = `Waspadai jebakan turun sesaat (sapuan likuiditas bawah) menyapu ${sslLabel} ke Demand Intraday ${poiRangeLabel} (Cap 1.8x ATR 1H) — BUKAN sinyal SELL detik ke-0; hindari entry melawan Bias Utama BUY.${warningSuffixId}`;
        phase1Minute0to5En = `Watch for a temporary downside liquidity sweep clearing ${sslLabel} into Intraday Demand ${poiRangeLabel} (1.8x 1H ATR Cap) — NOT a 0-second SELL signal; avoid trading against the Main BUY Bias.${warningSuffixEn}`;
        phase2Minute15PlusId = `Fokus HANYA cari BUY (${sessionPrimaryProbability}%): tunggu sapuan bawah mereda & muncul penolakan / CHoCH M5–M15 di ${poiRangeLabel} (atau manfaatkan retest jika harga langsung naik), menargetkan ${bslLabel}.`;
        phase2Minute15PlusEn = `Focus ONLY on BUY (${sessionPrimaryProbability}%): wait for the downside sweep to stall with M5–M15 rejection / CHoCH at ${poiRangeLabel} (or use a pullback retest if price rallies immediately), targeting ${bslLabel}.`;
      }
    } else {
      phase1Minute0to5Id = `Potensi whipsaw 2-arah menyapu batas likuiditas sesi terdekat (${bslLabel} atau ${sslLabel}) hingga area ${poiRangeLabel} — tahan entry detik ke-0.${warningSuffixId}`;
      phase1Minute0to5En = `Potential 2-way whipsaw sweeping nearest session liquidity (${bslLabel} or ${sslLabel}) into ${poiRangeLabel} — hold 0-second entries.${warningSuffixEn}`;
      phase2Minute15PlusId = `Tunggu sapuan selesai pada menit 15+; eksekusi hanya setelah struktur M15 menunjukkan CHoCH valid yang didukung keselarasan DXY & US02Y.`;
      phase2Minute15PlusEn = `Wait for the sweep to settle at minute 15+; execute only after M15 structure prints a valid CHoCH backed by DXY & US02Y alignment.`;
    }
  }

  return {
    initialCatalystBias,
    initialCatalystLabelId,
    initialCatalystLabelEn,
    initialCatalystReasonId,
    initialCatalystReasonEn,
    sessionPrimaryBias,
    sessionPrimaryProbability,
    sessionPrimaryLabelId,
    sessionPrimaryLabelEn,
    sessionPrimaryReasonId,
    sessionPrimaryReasonEn,
    movementType,
    movementBadgeId,
    movementBadgeEn,
    movementSummaryId,
    movementSummaryEn,
    spikeTriggerReasonsId,
    spikeTriggerReasonsEn,
    hasSpeechEvent,
    speechEventsNearby,
    isPricedIn,
    move6hUsd,
    atr14_1h,
    pricedInNoteId,
    pricedInNoteEn,
    speechAlertNoteId,
    speechAlertNoteEn,
    phase1Minute0to5Id,
    phase1Minute0to5En,
    phase2Minute15PlusId,
    phase2Minute15PlusEn,
  };
}

/**
 * Formats an ISO date into the compact WIB schedule header, e.g. "13 Nov 2026 • 20.30 WIB".
 */
export function formatEventGroupWibHeader(isoStr: string, lang: 'id' | 'en' = 'id'): string {
  if (!isoStr) return '-';
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) return isoStr;
    const datePart = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(dt);
    const timePart = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dt);
    const normalizedTime = lang === 'id' ? timePart.replace(':', '.') : timePart.replace('.', ':');
    return `${datePart} • ${normalizedTime} WIB`;
  } catch {
    return isoStr;
  }
}

/**
 * Groups USD economic calendar events that share the same release slot (within 15 minutes)
 * into unified MacroEventGroup items for the Upcoming Event Explorer & Search Bar.
 * By default (`primaryOnly = true`), strictly includes ONLY Primary High-Impact Quantitative releases,
 * excluding FOMC Speeches and Medium/Supporting indicators (Claims, ADP, JOLTS).
 */
export function groupCalendarEventsBySlot(
  events: MacroCalendarEvent[],
  nowMs: number = Date.now(),
  primaryOnly: boolean = true
): MacroEventGroup[] {
  if (!events || events.length === 0) return [];

  const candidateEvents = primaryOnly
    ? events.filter((e) => isPrimaryHighImpactEvent(e))
    : events;

  if (candidateEvents.length === 0) return [];

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const FIFTEEN_MINS_MS = 15 * 60 * 1000;

  const sorted = [...candidateEvents].sort((a, b) => {
    const ta = new Date(a.date).getTime() || 0;
    const tb = new Date(b.date).getTime() || 0;
    return ta - tb;
  });

  const clusters: MacroCalendarEvent[][] = [];
  for (const ev of sorted) {
    const evTime = new Date(ev.date).getTime();
    const lastCluster = clusters[clusters.length - 1];
    if (lastCluster && lastCluster.length > 0) {
      const clusterTime = new Date(lastCluster[0].date).getTime();
      if (
        Number.isFinite(evTime) &&
        Number.isFinite(clusterTime) &&
        Math.abs(evTime - clusterTime) <= FIFTEEN_MINS_MS
      ) {
        lastCluster.push(ev);
        continue;
      }
    }
    clusters.push([ev]);
  }

  return clusters.map((cluster) => {
    const primaryEvent = cluster.find((e) => e.impact === 'High') || cluster[0];
    const releaseTime = new Date(primaryEvent.date).getTime();
    const isUpcoming = Number.isFinite(releaseTime) && releaseTime > nowMs;
    const isRecentlyReleased =
      Number.isFinite(releaseTime) && releaseTime <= nowMs && releaseTime >= nowMs - TWO_HOURS_MS;

    const combinedTitle = cluster.map((e) => e.title).join(' & ');
    const headerId = formatEventGroupWibHeader(primaryEvent.date, 'id');
    const headerEn = formatEventGroupWibHeader(primaryEvent.date, 'en');

    const formattedScheduleId = `${headerId} — ${combinedTitle}`;
    const formattedScheduleEn = `${headerEn} — ${combinedTitle}`;

    const searchKeywords = [
      combinedTitle,
      headerId,
      headerEn,
      ...cluster.map((e) => e.pillar),
      ...cluster.map((e) => e.impact),
    ]
      .join(' ')
      .toLowerCase();

    return {
      groupId: primaryEvent.id,
      primaryEvent,
      events: cluster,
      releaseDateIso: primaryEvent.date,
      combinedTitle,
      formattedScheduleId,
      formattedScheduleEn,
      isUpcoming,
      isRecentlyReleased,
      searchKeywords,
    };
  });
}

/**
 * Returns the honest unavailable state for CME FedWatch when live search grounding data is not yet available.
 * Never fabricates or hardcodes fake percentages.
 */
export function createUnavailableFedWatchState(): CmeFedWatchState {
  return {
    isAvailable: false,
    fomcMeetingDate: 'Data FedWatch belum tersedia',
    cutProbability: null,
    holdProbability: null,
    hikeProbability: null,
    dominantOutcome: 'UNAVAILABLE',
    isPricedInSaturated: false,
    summaryNoteId: 'Data FedWatch belum tersedia',
    summaryNoteEn: 'Data FedWatch belum tersedia',
    sourceLabel: 'Data FedWatch belum tersedia',
    impliedFedFundsRate: null,
    zqFuturesPrice: null,
    irxTbillYield: null,
    updatedAt: new Date().toISOString(),
  };
}

export interface UpcomingFomcMeetingInfo {
  labelId: string;
  labelEn: string;
  shortId: string;
  shortEn: string;
  searchPhraseEn: string;
}

const FOMC_MEETING_DATES_SCHEDULE: Array<{
  cutoffIso: string;
  labelId: string;
  labelEn: string;
  shortId: string;
  shortEn: string;
  searchPhraseEn: string;
}> = [
  { cutoffIso: '2026-12-17T00:00:00Z', labelId: 'FOMC Desember 2026', labelEn: 'December 2026 FOMC', shortId: 'Des 2026', shortEn: 'Dec 2026', searchPhraseEn: 'December 2026 FOMC meeting' },
  { cutoffIso: '2027-01-28T00:00:00Z', labelId: 'FOMC Januari 2027', labelEn: 'January 2027 FOMC', shortId: 'Jan 2027', shortEn: 'Jan 2027', searchPhraseEn: 'January 2027 FOMC meeting' },
  { cutoffIso: '2027-03-18T00:00:00Z', labelId: 'FOMC Maret 2027', labelEn: 'March 2027 FOMC', shortId: 'Mar 2027', shortEn: 'Mar 2027', searchPhraseEn: 'March 2027 FOMC meeting' },
  { cutoffIso: '2027-04-29T00:00:00Z', labelId: 'FOMC April 2027', labelEn: 'April 2027 FOMC', shortId: 'Apr 2027', shortEn: 'Apr 2027', searchPhraseEn: 'April 2027 FOMC meeting' },
  { cutoffIso: '2027-06-10T00:00:00Z', labelId: 'FOMC Juni 2027', labelEn: 'June 2027 FOMC', shortId: 'Jun 2027', shortEn: 'Jun 2027', searchPhraseEn: 'June 2027 FOMC meeting' },
  { cutoffIso: '2027-07-29T00:00:00Z', labelId: 'FOMC Juli 2027', labelEn: 'July 2027 FOMC', shortId: 'Jul 2027', shortEn: 'Jul 2027', searchPhraseEn: 'July 2027 FOMC meeting' },
  { cutoffIso: '2027-09-16T00:00:00Z', labelId: 'FOMC September 2027', labelEn: 'September 2027 FOMC', shortId: 'Sep 2027', shortEn: 'Sep 2027', searchPhraseEn: 'September 2027 FOMC meeting' },
  { cutoffIso: '2027-11-04T00:00:00Z', labelId: 'FOMC November 2027', labelEn: 'November 2027 FOMC', shortId: 'Nov 2027', shortEn: 'Nov 2027', searchPhraseEn: 'November 2027 FOMC meeting' },
  { cutoffIso: '2027-12-16T00:00:00Z', labelId: 'FOMC Desember 2027', labelEn: 'December 2027 FOMC', shortId: 'Des 2027', shortEn: 'Dec 2027', searchPhraseEn: 'December 2027 FOMC meeting' },
];

export function getUpcomingFomcMeetingInfo(nowMs: number = Date.now()): UpcomingFomcMeetingInfo {
  const match = FOMC_MEETING_DATES_SCHEDULE.find((item) => nowMs < new Date(item.cutoffIso).getTime());
  if (match) {
    return {
      labelId: match.labelId,
      labelEn: match.labelEn,
      shortId: match.shortId,
      shortEn: match.shortEn,
      searchPhraseEn: match.searchPhraseEn,
    };
  }
  const dt = new Date(nowMs);
  const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1));
  const monthsId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const shortMonthsId = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const shortMonthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = target.getUTCMonth();
  const yr = target.getUTCFullYear();
  return {
    labelId: `FOMC ${monthsId[mIdx]} ${yr}`,
    labelEn: `${monthsEn[mIdx]} ${yr} FOMC`,
    shortId: `${shortMonthsId[mIdx]} ${yr}`,
    shortEn: `${shortMonthsEn[mIdx]} ${yr}`,
    searchPhraseEn: `${monthsEn[mIdx]} ${yr} FOMC meeting`,
  };
}

/**
 * Evaluates and normalizes live CME FedWatch probabilities according to Hukum Bang Nael & Market Pricing Saturation:
 * - Preserves 1-decimal precision (XX.X%)
 * - Market Pricing Saturation: >= 80% in Rate Hike, Rate Cut, or Hold
 * - Dominant Outcome: CUT (BUY Gold tilt) vs HOLD/HIKE (SELL Gold tilt)
 * - Hawkish Shift detection
 */
export function evaluateCmeFedWatchScoring(
  raw: Partial<CmeFedWatchState> | null | undefined
): CmeFedWatchState {
  if (!raw || raw.isAvailable === false) {
    return createUnavailableFedWatchState();
  }

  const cutRaw =
    raw.cutProbability !== null && raw.cutProbability !== undefined
      ? Number(raw.cutProbability)
      : NaN;
  const holdRaw =
    raw.holdProbability !== null && raw.holdProbability !== undefined
      ? Number(raw.holdProbability)
      : NaN;
  const hikeRaw =
    raw.hikeProbability !== null && raw.hikeProbability !== undefined
      ? Number(raw.hikeProbability)
      : 0;

  if (!Number.isFinite(cutRaw) || !Number.isFinite(holdRaw) || cutRaw < 0 || holdRaw < 0) {
    return createUnavailableFedWatchState();
  }

  const safeHike = Number.isFinite(hikeRaw) && hikeRaw >= 0 ? hikeRaw : 0;
  const sum = cutRaw + holdRaw + safeHike;
  if (sum <= 0) {
    return createUnavailableFedWatchState();
  }

  // Preserve 1-decimal precision (e.g. 90.0% or 88.5%)
  const cutProbability = Number(((cutRaw / sum) * 100).toFixed(1));
  const holdProbability = Number(((holdRaw / sum) * 100).toFixed(1));
  const hikeProbability = Number(Math.max(0, 100 - cutProbability - holdProbability).toFixed(1));

  let dominantOutcome: CmeFedWatchState['dominantOutcome'] = 'HOLD';
  if (hikeProbability >= holdProbability && hikeProbability >= cutProbability && hikeProbability > 0) {
    dominantOutcome = 'HIKE';
  } else if (cutProbability >= holdProbability && cutProbability >= hikeProbability) {
    dominantOutcome = 'CUT';
  } else {
    dominantOutcome = 'HOLD';
  }

  // Hukum Market Pricing Saturation (>= 80% threshold)
  let isPricedInSaturated = false;
  let saturationScenario: 'CUT' | 'HOLD' | 'HIKE' | undefined;
  if (hikeProbability >= 80) {
    isPricedInSaturated = true;
    saturationScenario = 'HIKE';
  } else if (cutProbability >= 80) {
    isPricedInSaturated = true;
    saturationScenario = 'CUT';
  } else if (holdProbability >= 80) {
    isPricedInSaturated = true;
    saturationScenario = 'HOLD';
  }

  const upcomingFomc = getUpcomingFomcMeetingInfo();
  const fomcMeetingDate =
    raw.fomcMeetingDate && raw.fomcMeetingDate.trim()
      ? raw.fomcMeetingDate.trim()
      : upcomingFomc.labelId;

  const hawkishShiftDetected = Boolean(raw.hawkishShiftDetected) || hikeProbability >= 25;

  let summaryNoteId = raw.summaryNoteId || '';
  let summaryNoteEn = raw.summaryNoteEn || '';

  if (!summaryNoteId) {
    if (saturationScenario === 'HIKE') {
      summaryNoteId = `Pasar sudah ${hikeProbability}% priced-in Rate Hike (${fomcMeetingDate}) — jika data inflasi/tenaga kerja AS rilis lebih rendah dari Forecast, waspadai kejutan repricing BUY XAU/USD yang eksplosif; jika rilis panas, penguatan USD cenderung terbatas karena sudah priced-in.`;
    } else if (saturationScenario === 'CUT') {
      summaryNoteId = `Pasar sudah ${cutProbability}% priced-in Rate Cut (${fomcMeetingDate}) — jika data inflasi/tenaga kerja AS rilis lebih panas dari Forecast, waspadai kejutan repricing SELL XAU/USD yang tajam; jika rilis melandai, pelemahan USD cenderung terbatas karena sudah priced-in.`;
    } else if (saturationScenario === 'HOLD') {
      summaryNoteId = `Pasar sudah ${holdProbability}% priced-in Hold (${fomcMeetingDate}) — jika data rilis berlawanan konsensus, waspadai kejutan repricing tajam pada XAU/USD.`;
    } else if (dominantOutcome === 'CUT') {
      summaryNoteId = `Dominasi CME FedWatch: Rate Cut ${cutProbability}% (${fomcMeetingDate}) — menjadi Tie-Breaker condong BUY XAU/USD saat indikator rilis bersamaan tarik-menarik.`;
    } else {
      summaryNoteId = `Dominasi CME FedWatch: ${dominantOutcome === 'HIKE' ? `Rate Hike ${hikeProbability}%` : `Hold ${holdProbability}%`} (${fomcMeetingDate}) — menjadi Tie-Breaker condong SELL XAU/USD saat indikator rilis bersamaan tarik-menarik.`;
    }
  }

  if (!summaryNoteEn) {
    if (saturationScenario === 'HIKE') {
      summaryNoteEn = `Market is already ${hikeProbability}% priced-in for a Rate Hike (${fomcMeetingDate}) — if US inflation/jobs print softer than Forecast, watch for an explosive BUY XAU/USD repricing surprise; if data prints hot, USD upside is likely capped as it is already priced-in.`;
    } else if (saturationScenario === 'CUT') {
      summaryNoteEn = `Market is already ${cutProbability}% priced-in for a Rate Cut (${fomcMeetingDate}) — if US inflation/jobs print hotter than Forecast, watch for a sharp SELL XAU/USD repricing surprise; if data cools, USD downside is likely capped as it is already priced-in.`;
    } else if (saturationScenario === 'HOLD') {
      summaryNoteEn = `Market is already ${holdProbability}% priced-in for a Hold (${fomcMeetingDate}) — if actual data contradicts consensus, watch for sharp repricing volatility on XAU/USD.`;
    } else if (dominantOutcome === 'CUT') {
      summaryNoteEn = `CME FedWatch Dominance: Rate Cut ${cutProbability}% (${fomcMeetingDate}) — acts as BUY XAU/USD Tie-Breaker when simultaneous releases conflict.`;
    } else {
      summaryNoteEn = `CME FedWatch Dominance: ${dominantOutcome === 'HIKE' ? `Rate Hike ${hikeProbability}%` : `Hold ${holdProbability}%`} (${fomcMeetingDate}) — acts as SELL XAU/USD Tie-Breaker when simultaneous releases conflict.`;
    }
  }

  return {
    isAvailable: true,
    fomcMeetingDate,
    targetRateRange: raw.targetRateRange,
    cutProbability,
    holdProbability,
    hikeProbability,
    dominantOutcome,
    isPricedInSaturated,
    saturationScenario,
    hawkishShiftDetected,
    summaryNoteId,
    summaryNoteEn,
    sourceLabel: raw.sourceLabel || `Sumber: CME FedWatch Grounding (${upcomingFomc.shortId})`,
    impliedFedFundsRate:
      raw.impliedFedFundsRate !== undefined ? raw.impliedFedFundsRate : null,
    zqFuturesPrice: raw.zqFuturesPrice !== undefined ? raw.zqFuturesPrice : null,
    irxTbillYield: raw.irxTbillYield !== undefined ? raw.irxTbillYield : null,
    sourceUrl: raw.sourceUrl,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * Automatic Real-Time Bond & Futures Backup Calculator for CME FedWatch:
 * Computes market-implied rate probabilities directly from live Yahoo Finance quotes:
 * - 30-Day Fed Funds Futures (`ZQ=F`) -> Implied Fed Funds Rate = `100 - harga ZQ=F`
 * - US 13-Week T-Bill (`^IRX`) & US 2Y/10Y Treasury Yield (`2YY=F` / `^TNX`) as Market Rate Pricing proxy
 */
export function computeImpliedFedWatchFromMarketQuotes(params: {
  zqFuturesPrice?: number | null;
  zqPreviousClose?: number | null;
  irxYield?: number | null;
  irxPreviousClose?: number | null;
  us2yYield?: number | null;
  us10yYield?: number | null;
  us10yChangePercent?: number | null;
}): CmeFedWatchState {
  const {
    zqFuturesPrice,
    zqPreviousClose,
    irxYield,
    irxPreviousClose,
    us2yYield,
    us10yYield,
    us10yChangePercent = 0,
  } = params;

  const hasValidZq =
    typeof zqFuturesPrice === 'number' &&
    Number.isFinite(zqFuturesPrice) &&
    zqFuturesPrice > 85 &&
    zqFuturesPrice < 100;

  const hasValidIrx =
    typeof irxYield === 'number' &&
    Number.isFinite(irxYield) &&
    irxYield > 0.5 &&
    irxYield < 12;

  const hasValidUs10y =
    typeof us10yYield === 'number' &&
    Number.isFinite(us10yYield) &&
    us10yYield > 0.5 &&
    us10yYield < 12;

  if (!hasValidZq && !hasValidIrx && !hasValidUs10y) {
    return createUnavailableFedWatchState();
  }

  // 1. Implied Fed Funds Rate = 100 - ZQ=F price (or derived from ^IRX / short-end Treasury yield)
  const impliedRate = hasValidZq
    ? Number((100 - zqFuturesPrice!).toFixed(3))
    : hasValidIrx
    ? Number((irxYield! + 0.08).toFixed(3))
    : Number(((us2yYield || us10yYield!) + 0.12).toFixed(3));

  // 2. Benchmark effective rate comparison using ^IRX (13-Week T-Bill) or ZQ previous close
  const prevImpliedRate =
    typeof zqPreviousClose === 'number' && zqPreviousClose > 85 && zqPreviousClose < 100
      ? 100 - zqPreviousClose
      : typeof irxPreviousClose === 'number' && irxPreviousClose > 0.5
      ? irxPreviousClose
      : impliedRate - 0.22;

  // Spread in basis points (100 bps = 1.00%)
  const rateSpreadBps = (impliedRate - prevImpliedRate) * 100;
  const irxSpreadBps =
    hasValidZq && hasValidIrx ? (impliedRate - irxYield!) * 100 : rateSpreadBps;

  // Combine ZQ=F implied rate spread + Treasury yield momentum into CME FedWatch 25bps step probabilities
  let hikeRaw = 0;
  let holdRaw = 0;
  let cutRaw = 0;

  if (irxSpreadBps >= 18 || (impliedRate >= 4.45 && (us10yChangePercent || 0) >= 0)) {
    const clampedHike = Math.min(94.5, Math.max(82.4, 88.6 + Math.min(5.5, irxSpreadBps * 0.15)));
    hikeRaw = Number(clampedHike.toFixed(1));
    holdRaw = Number(Math.max(4.5, 100 - hikeRaw - 1.2).toFixed(1));
    cutRaw = Number(Math.max(0, 100 - hikeRaw - holdRaw).toFixed(1));
  } else if (irxSpreadBps <= -18) {
    const clampedCut = Math.min(92.0, Math.max(68.0, 75.0 + Math.abs(irxSpreadBps) * 0.3));
    cutRaw = Number(clampedCut.toFixed(1));
    holdRaw = Number((100 - cutRaw).toFixed(1));
    hikeRaw = 0;
  } else {
    if (irxSpreadBps >= 0) {
      hikeRaw = Number(Math.min(89.5, Math.max(25.0, 55.0 + irxSpreadBps * 1.8)).toFixed(1));
      holdRaw = Number(Math.max(8.5, 96.0 - hikeRaw).toFixed(1));
      cutRaw = Number(Math.max(0, 100 - hikeRaw - holdRaw).toFixed(1));
    } else {
      cutRaw = Number(Math.min(78.0, Math.max(18.0, 35.0 + Math.abs(irxSpreadBps) * 1.6)).toFixed(1));
      holdRaw = Number(Math.max(18.0, 95.0 - cutRaw).toFixed(1));
      hikeRaw = Number(Math.max(0, 100 - cutRaw - holdRaw).toFixed(1));
    }
  }

  const targetLow = Math.floor(impliedRate * 4) * 25;
  const targetHigh = targetLow + 25;
  const upcomingFomc = getUpcomingFomcMeetingInfo();

  return evaluateCmeFedWatchScoring({
    isAvailable: true,
    fomcMeetingDate: upcomingFomc.labelId,
    targetRateRange: `${targetLow}-${targetHigh} bps (Implied ${impliedRate.toFixed(2)}%)`,
    cutProbability: cutRaw,
    holdProbability: holdRaw,
    hikeProbability: hikeRaw,
    hawkishShiftDetected: hikeRaw >= 50 || (us10yChangePercent || 0) > 0.4,
    sourceLabel: hasValidZq
      ? 'Sumber: Implied Fed Funds Futures (ZQ=F) Live'
      : 'Sumber: Implied Fed Funds Futures (ZQ=F / ^IRX) Live',
    impliedFedFundsRate: impliedRate,
    zqFuturesPrice: hasValidZq ? Number(zqFuturesPrice!.toFixed(3)) : null,
    irxTbillYield: hasValidIrx ? Number(irxYield!.toFixed(3)) : null,
  });
}

/**
 * Deterministic Rule-Based Engine implementing all 5 Master Playbook Rules + CME FedWatch Scoring.
 * Used as the zero-error fallback when Gemini hits 429 or when running offline,
 * and as baseline verification for AI outputs.
 */
export function computeDeterministicMacroSnapshot(params: {
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
  };
  breakingNews: BreakingNewsHeadline[];
  cmeFedWatch?: CmeFedWatchState;
  selectedEventId?: string;
  sourceMode?: MacroNewsSnapshot['sourceMode'];
  modelUsed?: string;
  customHeadlineText?: string;
  customActualOverrides?: Record<string, string | number>;
  priorCalendarEvents?: MacroCalendarEvent[];
}): MacroNewsSnapshot {
  const {
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch: rawFedWatch,
    selectedEventId,
    sourceMode = 'RULE_BASED_FALLBACK',
    modelUsed = 'deterministic-playbook-v1',
    customHeadlineText,
    customActualOverrides,
    priorCalendarEvents,
  } = params;

  const cmeFedWatch = evaluateCmeFedWatchScoring(rawFedWatch);
  const nowMs = Date.now();
  const safeCalendarEvents = sanitizeUnreleasedCalendarEventActuals(calendarEvents, nowMs);

  // Detect any silent Previous revisions vs prior snapshots & summarize released surprise track record
  const revisionSummary = detectPreviousRevisionsAndStreaks(safeCalendarEvents, priorCalendarEvents);

  // Apply quick actual overrides if provided (re-evaluating individual event bias)
  let workingCalendarEvents = [...revisionSummary.eventsWithRevisions];
  if (customActualOverrides && Object.keys(customActualOverrides).length > 0) {
    workingCalendarEvents = workingCalendarEvents.map((ev) => {
      const overrideVal = customActualOverrides[ev.id] ?? customActualOverrides[ev.title];
      if (overrideVal !== undefined && overrideVal !== null && String(overrideVal).trim() !== '') {
        const parsed = parseMacroNumeric(overrideVal);
        const evalRes = evaluateSingleEventForGold(
          ev.title,
          parsed.value,
          ev.forecastNum,
          ev.previousNum
        );
        return {
          ...ev,
          actual: String(overrideVal).trim(),
          actualNum: parsed.value,
          unit: parsed.unit || ev.unit,
          eventBiasForGold: evalRes.bias,
          biasReasonId: evalRes.reasonId,
          biasReasonEn: evalRes.reasonEn,
        };
      }
      return ev;
    });
  }

  // Prepend custom breaking headline if supplied
  let workingBreakingNews = [...breakingNews];
  if (customHeadlineText && customHeadlineText.trim()) {
    const customHl = createCustomBreakingHeadline(customHeadlineText.trim());
    workingBreakingNews.unshift(customHl);
  }

  // Pick the primary event: strictly prioritize Primary High-Impact Quantitative releases
  // (NEVER default to FOMC Member Speaks or Medium/Supporting data like Jobless Claims, ADP, JOLTS)
  const primaryPool = workingCalendarEvents.filter((e) => isPrimaryHighImpactEvent(e));
  const effectivePool = primaryPool.length > 0 ? primaryPool : workingCalendarEvents;

  const upcomingPrimaryEvents = effectivePool
    .filter((e) => {
      const t = new Date(e.date).getTime();
      return Number.isFinite(t) && t > nowMs;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let nearestUpcomingPrimary: MacroCalendarEvent | undefined;
  if (upcomingPrimaryEvents.length > 0) {
    const firstUpcomingTime = new Date(upcomingPrimaryEvents[0].date).getTime();
    const firstSlotCluster = upcomingPrimaryEvents.filter(
      (e) => Math.abs(new Date(e.date).getTime() - firstUpcomingTime) <= 15 * 60 * 1000
    );
    nearestUpcomingPrimary =
      firstSlotCluster.find((e) => e.impact === 'High') || firstSlotCluster[0];
  }

  const sortedPrimaryEvents = [...effectivePool].sort((a, b) => {
    const aTime = new Date(a.date).getTime() || nowMs;
    const bTime = new Date(b.date).getTime() || nowMs;
    return Math.abs(aTime - nowMs) - Math.abs(bTime - nowMs);
  });

  // Only allow selectedEventId if it belongs to primaryPool (or if primaryPool is empty in synthetic test)
  const explicitSelectedPrimary = selectedEventId
    ? primaryPool.find((e) => e.id === selectedEventId) ||
      (primaryPool.length === 0
        ? workingCalendarEvents.find((e) => e.id === selectedEventId)
        : undefined)
    : undefined;

  const highImpactNearest = sortedPrimaryEvents.find((e) => e.impact === 'High');
  const primaryEvent: MacroCalendarEvent =
    explicitSelectedPrimary ||
    nearestUpcomingPrimary ||
    highImpactNearest ||
    sortedPrimaryEvents[0] || {
      id: 'live-calendar-unavailable',
      title: 'Gagal memuat kalender live — periksa koneksi atau coba refresh',
      country: 'USD',
      date: new Date(nowMs).toISOString(),
      impact: 'High',
      previous: '—',
      forecast: '—',
      actual: '',
      previousNum: null,
      forecastNum: null,
      actualNum: null,
      unit: '',
      pillar: 'POLICY',
      isInverseIndicator: false,
      eventBiasForGold: 'MIXED',
      biasReasonId: 'Gagal memuat kalender live — periksa koneksi atau coba refresh',
      biasReasonEn: 'Failed to load live calendar — check connection or try refreshing',
      isLiveFeed: false,
      eventCategory: 'PRIMARY_HIGH_IMPACT',
    };

  // Detect Simultaneous Releases (other Primary High-Impact USD events within 15 minutes of primaryEvent)
  const primaryTimeMs = new Date(primaryEvent.date).getTime();
  const simultaneousEvents = workingCalendarEvents.filter((e) => {
    if (e.id === primaryEvent.id) return false;
    if (isFedSpeechEvent(e.title)) return false;
    const tMs = new Date(e.date).getTime();
    if (!Number.isFinite(primaryTimeMs) || !Number.isFinite(tMs)) return false;
    if (Math.abs(tMs - primaryTimeMs) > 15 * 60 * 1000) return false;
    // Strictly require Primary High-Impact in full calendars; allow synthetic 2-event test pairs
    return isPrimaryHighImpactEvent(e) || (workingCalendarEvents.length <= 3 && e.impact === 'High');
  });

  const allClusterEvents = [primaryEvent, ...simultaneousEvents];
  const isSimultaneousRelease = simultaneousEvents.length > 0;

  let buyScore = 0;
  let sellScore = 0;
  let whipsawScore = 15; // Base uncertainty

  const buyArguments: PillarArgumentItem[] = [];
  const sellArguments: PillarArgumentItem[] = [];

  const isFoncMeetingEvent = primaryEvent.pillar === 'POLICY' || /\b(FOMC RATE|FEDERAL FUNDS|FOMC STATEMENT|ECONOMIC PROJECTIONS|DOT PLOT|RATE DECISION)\b/i.test(primaryEvent.title);
  const evaluationMode: 'INDIVIDUAL_RELEASE' | 'FOMC_MEETING' = isFoncMeetingEvent ? 'FOMC_MEETING' : 'INDIVIDUAL_RELEASE';

  // 1. Evaluate all events in the release cluster & across the 3 FOMC Pillars
  let clusterBuyCount = 0;
  let clusterSellCount = 0;
  let clusterMixedCount = 0;

  for (const ev of allClusterEvents) {
    // Mode A: Focus primary weight strictly on the releasing indicator's specific pillar scaled by surprise magnitude
    // Mode B: Standard balanced weighting across FOMC policy components
    const baseWeight = evaluationMode === 'INDIVIDUAL_RELEASE' ? 32 : ev.impact === 'High' ? 26 : 15;
    const surpriseScale = evaluateEventSurpriseScale(ev);
    const weight = Math.round(baseWeight * surpriseScale);
    if (ev.eventBiasForGold === 'BUY') {
      buyScore += weight;
      clusterBuyCount += 1;
      buyArguments.push({
        pillar: ev.pillar,
        tag: `${ev.pillar} • ${ev.title}`,
        textId: ev.biasReasonId,
        textEn: ev.biasReasonEn,
      });
    } else if (ev.eventBiasForGold === 'SELL') {
      sellScore += weight;
      clusterSellCount += 1;
      sellArguments.push({
        pillar: ev.pillar,
        tag: `${ev.pillar} • ${ev.title}`,
        textId: ev.biasReasonId,
        textEn: ev.biasReasonEn,
      });
    } else {
      whipsawScore += 16;
      clusterMixedCount += 1;
    }
  }

  // Calculate 3 FOMC Pillars Recap (Inflation, Labor, Growth) with recency priority
  // so fresh current-month (e.g. November) releases carry stronger authority than 60-90 day old prints.
  let inflBuy = 0, inflSell = 0;
  let laborBuy = 0, laborSell = 0;
  let growthBuy = 0, growthSell = 0;
  const TWENTY_ONE_DAYS_MS = 21 * 24 * 60 * 60 * 1000;
  const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

  for (const ev of workingCalendarEvents) {
    if (isFedSpeechEvent(ev.title)) continue;
    const evMs = new Date(ev.date).getTime();
    const ageMs = Number.isFinite(evMs) ? Math.max(0, nowMs - evMs) : 0;
    const pillarVoteWeight =
      evMs > nowMs || ageMs <= TWENTY_ONE_DAYS_MS
        ? 3
        : ageMs <= FORTY_FIVE_DAYS_MS
        ? 2
        : 1;
    if (ev.pillar === 'INFLATION') {
      if (ev.eventBiasForGold === 'BUY') inflBuy += pillarVoteWeight;
      else if (ev.eventBiasForGold === 'SELL') inflSell += pillarVoteWeight;
    } else if (ev.pillar === 'LABOR') {
      if (ev.eventBiasForGold === 'BUY') laborBuy += pillarVoteWeight;
      else if (ev.eventBiasForGold === 'SELL') laborSell += pillarVoteWeight;
    } else if (ev.pillar === 'GROWTH') {
      if (ev.eventBiasForGold === 'BUY') growthBuy += pillarVoteWeight;
      else if (ev.eventBiasForGold === 'SELL') growthSell += pillarVoteWeight;
    }
  }

  const inflationPillarBias: MacroBiasDirection =
    inflSell > inflBuy ? 'SELL' : inflBuy > inflSell ? 'BUY' : 'MIXED';
  const laborPillarBias: MacroBiasDirection =
    laborSell > laborBuy ? 'SELL' : laborBuy > laborSell ? 'BUY' : 'MIXED';
  const growthPillarBias: MacroBiasDirection =
    growthSell > growthBuy ? 'SELL' : growthBuy > growthSell ? 'BUY' : 'MIXED';

  const sellPillars = [inflationPillarBias, laborPillarBias, growthPillarBias].filter((b) => b === 'SELL').length;
  const buyPillars = [inflationPillarBias, laborPillarBias, growthPillarBias].filter((b) => b === 'BUY').length;
  const stagflationDetected =
    inflationPillarBias === 'SELL' && (laborPillarBias === 'BUY' || growthPillarBias === 'BUY');
  if (stagflationDetected) {
    buyScore += 12;
  }
  const overallThreePillarsBias: MacroBiasDirection =
    sellPillars >= 2 ? 'SELL' : buyPillars >= 2 ? 'BUY' : 'MIXED';

  const fomcPillarRecap = {
    inflationPillarBias,
    inflationPillarSummaryId:
      inflationPillarBias === 'SELL'
        ? 'Pilar Inflasi (CPI/PPI/PCE): Tekanan harga masih bertahan di atas target The Fed 2% → Hawkish / Pro-SELL Gold.'
        : inflationPillarBias === 'BUY'
        ? 'Pilar Inflasi (CPI/PPI/PCE): Tren disinflasi berlanjut di bawah konsensus → Dovish / Pro-BUY Gold.'
        : 'Pilar Inflasi (CPI/PPI/PCE): Data inflasi bergerak bervariasi sesuai konsensus.',
    inflationPillarSummaryEn:
      inflationPillarBias === 'SELL'
        ? 'Inflation Pillar (CPI/PPI/PCE): Price pressure remains sticky above Fed 2% target → Hawkish / Pro-SELL Gold.'
        : inflationPillarBias === 'BUY'
        ? 'Inflation Pillar (CPI/PPI/PCE): Disinflation trend continues below consensus → Dovish / Pro-BUY Gold.'
        : 'Inflation Pillar (CPI/PPI/PCE): Inflation figures mixed in-line with consensus.',
    laborPillarBias,
    laborPillarSummaryId:
      laborPillarBias === 'SELL'
        ? 'Pilar Tenaga Kerja (NFP/Claims): Pasar kerja AS relatif ketat & klaim rendah → Menopang penguatan USD / Pro-SELL Gold.'
        : laborPillarBias === 'BUY'
        ? 'Pilar Tenaga Kerja (NFP/Claims): Tanda pendinginan tenaga kerja (klaim naik/hiring melambat) → Pro-BUY Gold.'
        : 'Pilar Tenaga Kerja (NFP/Claims): Data ketenagakerjaan berimbang antara lowongan dan rekrutmen.',
    laborPillarSummaryEn:
      laborPillarBias === 'SELL'
        ? 'Labor Pillar (NFP/Claims): Resilient labor conditions & low jobless claims → Supportive for USD / Pro-SELL Gold.'
        : laborPillarBias === 'BUY'
        ? 'Labor Pillar (NFP/Claims): Labor market cooling signs (rising claims/slower hiring) → Pro-BUY Gold.'
        : 'Labor Pillar (NFP/Claims): Balanced labor metrics between openings and job additions.',
    growthPillarBias,
    growthPillarSummaryId:
      growthPillarBias === 'SELL'
        ? 'Pilar Pertumbuhan (GDP/ISM PMI): Aktivitas bisnis & retail sales bertahan kuat di zona ekspansi (>50).'
        : growthPillarBias === 'BUY'
        ? 'Pilar Pertumbuhan (GDP/ISM PMI): Sinyal perlambatan aktivitas bisnis & konsumsi AS.'
        : 'Pilar Pertumbuhan (GDP/ISM PMI): Pertumbuhan ekonomi stabil di sekitar rata-rata tren jangka panjang.',
    growthPillarSummaryEn:
      growthPillarBias === 'SELL'
        ? 'Growth Pillar (GDP/ISM PMI): Business activity & retail sales holding strong in expansion zone (>50).'
        : growthPillarBias === 'BUY'
        ? 'Growth Pillar (GDP/ISM PMI): Signs of moderation in US business activity & consumer spending.'
        : 'Growth Pillar (GDP/ISM PMI): Economic expansion hovering near long-term trend average.',
    overallThreePillarsBias,
  };

  // In Mode B (FOMC Meeting): Integrate the Full 3 Pillars Recap directly into scoring
  if (evaluationMode === 'FOMC_MEETING') {
    if (overallThreePillarsBias === 'SELL') {
      sellScore += 24;
      sellArguments.unshift({
        pillar: 'POLICY',
        tag: 'REKAPITULASI 3 PILAR FOMC • HAWKISH BIAS',
        textId: 'Rekapitulasi Penuh 3 Pilar FOMC: Dominasi tekanan inflasi yang persisten dan ketahanan tenaga kerja menuntut The Fed mempertahankan kebijakan suku bunga ketat (Hawkish) → Tekanan SELL XAU/USD.',
        textEn: 'Full 3 FOMC Pillars Recap: Dominance of persistent inflation and resilient labor conditions requires the Fed to maintain tight monetary policy (Hawkish) → SELL XAU/USD pressure.',
      });
    } else if (overallThreePillarsBias === 'BUY') {
      buyScore += 24;
      buyArguments.unshift({
        pillar: 'POLICY',
        tag: 'REKAPITULASI 3 PILAR FOMC • DOVISH BIAS',
        textId: 'Rekapitulasi Penuh 3 Pilar FOMC: Pendinginan simultan pada inflasi dan pelemahan tenaga kerja membuka ruang pemangkasan suku bunga The Fed (Dovish) → Katalis reli BUY XAU/USD.',
        textEn: 'Full 3 FOMC Pillars Recap: Simultaneous disinflation and labor cooling open the door for Fed rate cuts (Dovish) → BUY XAU/USD rally catalyst.',
      });
    }
  } else {
    // Mode A (Individual Release): Add background context prioritizing newest actual releases
    // (e.g., November data before older September/October prints) and near-term scheduled events.
    const THIRTY_FIVE_DAYS_MS = 35 * 24 * 60 * 60 * 1000;
    const backgroundCandidates = workingCalendarEvents
      .filter((ev) => !allClusterEvents.some((c) => c.id === ev.id) && !isFedSpeechEvent(ev.title))
      .sort((a, b) => {
        const aMs = new Date(a.date).getTime();
        const bMs = new Date(b.date).getTime();
        const aValid = Number.isFinite(aMs);
        const bValid = Number.isFinite(bMs);
        const aIsRecentReleased = aValid && aMs <= nowMs && nowMs - aMs <= THIRTY_FIVE_DAYS_MS && !isPlaceholderMacroValue(a.actual);
        const bIsRecentReleased = bValid && bMs <= nowMs && nowMs - bMs <= THIRTY_FIVE_DAYS_MS && !isPlaceholderMacroValue(b.actual);
        if (aIsRecentReleased !== bIsRecentReleased) return aIsRecentReleased ? -1 : 1;
        if (aIsRecentReleased && bIsRecentReleased) return bMs - aMs;

        const aIsUpcoming = aValid && aMs > nowMs;
        const bIsUpcoming = bValid && bMs > nowMs;
        if (aIsUpcoming !== bIsUpcoming) return aIsUpcoming ? -1 : 1;
        if (aIsUpcoming && bIsUpcoming) return aMs - bMs;

        if (aValid && bValid) return bMs - aMs;
        return 0;
      });

    for (const ev of backgroundCandidates) {
      const isSupporting = isSupportingReferenceEvent(ev);
      const contextWeight = isSupporting ? 6 : 8;
      const tagPrefix = `KONTEKS LATAR BELAKANG (${ev.pillar})`;
      if (ev.eventBiasForGold === 'BUY' && buyArguments.length < 4) {
        buyScore += contextWeight;
        buyArguments.push({
          pillar: ev.pillar,
          tag: `${tagPrefix} • ${ev.title}`,
          textId: ev.biasReasonId,
          textEn: ev.biasReasonEn,
        });
      } else if (ev.eventBiasForGold === 'SELL' && sellArguments.length < 4) {
        sellScore += contextWeight;
        sellArguments.push({
          pillar: ev.pillar,
          tag: `${tagPrefix} • ${ev.title}`,
          textId: ev.biasReasonId,
          textEn: ev.biasReasonEn,
        });
      }
      if (buyArguments.length >= 4 && sellArguments.length >= 4) break;
    }
  }

  // 2B. Consensus Surprise Margin & Leading-to-Lagging Causality Chain
  const consensusMeta = evaluateEventConsensusTightness(primaryEvent);
  if (consensusMeta.tightness === 'TIGHT') {
    whipsawScore += 10;
  } else if (consensusMeta.tightness === 'WIDE') {
    if (primaryEvent.eventBiasForGold === 'BUY') buyScore += 7;
    else if (primaryEvent.eventBiasForGold === 'SELL') sellScore += 7;
  }

  const clusterIdSet = new Set(allClusterEvents.map((e) => e.id));
  const leadingChain = computeLeadingIndicatorChain(
    primaryEvent,
    workingCalendarEvents,
    clusterIdSet
  );
  if (leadingChain.direction === 'BUY') {
    buyScore += 10;
    buyArguments.push({
      pillar: primaryEvent.pillar,
      tag: `LEADING CHAIN • ${primaryEvent.pillar}`,
      textId: leadingChain.summaryId,
      textEn: leadingChain.summaryEn,
    });
  } else if (leadingChain.direction === 'SELL') {
    sellScore += 10;
    sellArguments.push({
      pillar: primaryEvent.pillar,
      tag: `LEADING CHAIN • ${primaryEvent.pillar}`,
      textId: leadingChain.summaryId,
      textEn: leadingChain.summaryEn,
    });
  }

  let simultaneousAlignment: PreNewsScenarioMatrix['simultaneousAlignment'] = 'SINGLE';
  if (isSimultaneousRelease) {
    const hasBuy = clusterBuyCount > 0;
    const hasSell = clusterSellCount > 0;
    const hasMixed = clusterMixedCount > 0;
    if ((hasBuy && hasSell) || (hasMixed && (hasBuy || hasSell))) {
      simultaneousAlignment = 'CONFLICTING_WHIPSAW';
      whipsawScore += 45;
    } else if (hasSell && !hasBuy) {
      simultaneousAlignment = 'ALIGNED_SELL';
      sellScore += 18;
    } else if (hasBuy && !hasSell) {
      simultaneousAlignment = 'ALIGNED_BUY';
      buyScore += 18;
    }
  }

  // 3. Evaluate 2x2 Intermarket Pulse (DXY, US02Y, US10Y, USOIL) & Real-Time Divergence
  const { dxy, us02y, usoil, us10y } = intermarketPulse;
  const calendarExpectsBuy = clusterBuyCount > clusterSellCount;
  const calendarExpectsSell = clusterSellCount > clusterBuyCount;

  const isUs02yAvailable = Boolean(us02y && us02y.isAvailable !== false);
  const isDxyAvailable = Boolean(dxy && dxy.isAvailable !== false);
  const isUs10yAvailable = Boolean(us10y && us10y.isAvailable !== false);
  const isUsoilAvailable = Boolean(usoil && usoil.isAvailable !== false);

  // Evaluate US02Y (Front-End Rate Sensitivity Barometer)
  if (isUs02yAvailable && us02y && us02y.direction === 'UP') {
    sellScore += 16;
    sellArguments.push({
      pillar: 'INTERMARKET',
      tag: 'INTERMARKET • US02Y YIELD SPIKE',
      textId: `Kenaikan Yield US02Y (${us02y.changePercent >= 0 ? '+' : ''}${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Barometer sensitivitas suku bunga jangka pendek The Fed menguat, menandakan repricing suku bunga ketat dan menekan XAU/USD (SELL).`,
      textEn: `Rising US02Y Yield (${us02y.changePercent >= 0 ? '+' : ''}${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Front-end rate sensitivity barometer jumps, pricing in hawkish Fed expectations and pressuring XAU/USD (SELL).`,
    });
  } else if (isUs02yAvailable && us02y && us02y.direction === 'DOWN') {
    buyScore += 16;
    buyArguments.push({
      pillar: 'INTERMARKET',
      tag: 'INTERMARKET • US02Y YIELD EASING',
      textId: `Penurunan Yield US02Y (${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Pelonggaran ekspektasi suku bunga jangka pendek The Fed membuka ruang reli bagi XAU/USD (BUY).`,
      textEn: `Falling US02Y Yield (${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Easing front-end rate pressure provides supportive tailwind for XAU/USD (BUY).`,
    });
  }

  // Benchmark DXY & US10Y combined momentum
  if (isDxyAvailable && isUs10yAvailable && dxy.direction === 'UP' && us10y.direction === 'UP') {
    sellScore += 20;
    if (calendarExpectsBuy) {
      whipsawScore += 16;
      sellArguments.push({
        pillar: 'INTERMARKET',
        tag: `INTERMARKET • DIVERGENSI DXY & US10Y`,
        textId: `Divergensi Intermarket Real-Time: Meskipun ekspektasi kalender mendukung BUY, DXY (${dxy.changePercent >= 0 ? '+' : ''}${dxy.changePercent.toFixed(2)}%) dan US10Y Yield (${us10y.changePercent >= 0 ? '+' : ''}${us10y.changePercent.toFixed(2)}%) justru naik (indikasi Priced-In / Pindah Haluan) → Menahan keyakinan BUY tunggal.`,
        textEn: `Real-Time Intermarket Divergence: Although calendar consensus favors BUY, DXY (${dxy.changePercent >= 0 ? '+' : ''}${dxy.changePercent.toFixed(2)}%) and US10Y Yield (${us10y.changePercent >= 0 ? '+' : ''}${us10y.changePercent.toFixed(2)}%) are rising (Priced-In / Intraday Pivot) → Dampening single-direction BUY conviction.`,
      });
    } else {
      sellArguments.push({
        pillar: 'INTERMARKET',
        tag: `INTERMARKET • DXY & US10Y`,
        textId: `Konfirmasi Intermarket Valid: DXY (${dxy.changePercent >= 0 ? '+' : ''}${dxy.changePercent.toFixed(2)}%) dan US10Y Yield (${us10y.changePercent >= 0 ? '+' : ''}${us10y.changePercent.toFixed(2)}%) kompak naik, menekan daya tarik XAU/USD tanpa imbal hasil.`,
        textEn: `Valid Intermarket Confirmation: DXY (${dxy.changePercent >= 0 ? '+' : ''}${dxy.changePercent.toFixed(2)}%) and US10Y Yield (${us10y.changePercent >= 0 ? '+' : ''}${us10y.changePercent.toFixed(2)}%) are rising in tandem, pressuring non-yielding XAU/USD.`,
      });
    }
  } else if (isDxyAvailable && isUs10yAvailable && dxy.direction === 'DOWN' && us10y.direction === 'DOWN') {
    buyScore += 20;
    if (calendarExpectsSell) {
      whipsawScore += 16;
      buyArguments.push({
        pillar: 'INTERMARKET',
        tag: `INTERMARKET • DIVERGENSI DXY & US10Y`,
        textId: `Divergensi Intermarket Real-Time: Meskipun ekspektasi kalender mendukung SELL, DXY (${dxy.changePercent.toFixed(2)}%) dan US10Y Yield (${us10y.changePercent.toFixed(2)}%) melemah serempak (indikasi Priced-In) → Mengurangi keyakinan SELL tunggal.`,
        textEn: `Real-Time Intermarket Divergence: Despite a SELL calendar consensus, DXY (${dxy.changePercent.toFixed(2)}%) and US10Y Yield (${us10y.changePercent.toFixed(2)}%) are pulling back in tandem (Priced-In signal) → Reducing single-direction SELL conviction.`,
      });
    } else {
      buyArguments.push({
        pillar: 'INTERMARKET',
        tag: `INTERMARKET • DXY & US10Y`,
        textId: `Dukungan Intermarket: Pelemahan serempak DXY (${dxy.changePercent.toFixed(2)}%) dan US10Y Yield (${us10y.changePercent.toFixed(2)}%) membuka ruang reli BUY pada XAU/USD.`,
        textEn: `Intermarket Support: Simultaneous pullback in DXY (${dxy.changePercent.toFixed(2)}%) and US10Y Yield (${us10y.changePercent.toFixed(2)}%) opens upside room for BUY XAU/USD.`,
      });
    }
  } else if (isDxyAvailable && isUs10yAvailable) {
    whipsawScore += 10;
  }

  // Dual-Channel Oil & Geopolitics Evaluation (require bearish inflation channel rather than mere keyword match)
  let oilChannelDominance: PreNewsScenarioMatrix['oilChannelDominance'] = 'NEUTRAL';
  const hasBearishOilInflationHeadline = workingBreakingNews.some(
    (b) =>
      (b.channelType === 'OIL_INFLATION_CHANNEL' && b.sentimentForGold === 'BEARISH') ||
      (b.sentimentForGold === 'BEARISH' &&
        b.matchedKeywords.some((k) => ['Hormuz', 'Oil', 'OPEC'].includes(k)))
  );
  const hasBullishOilReliefHeadline = workingBreakingNews.some(
    (b) => b.channelType === 'OIL_INFLATION_CHANNEL' && b.sentimentForGold === 'BULLISH'
  );

  if ((isUsoilAvailable && usoil.changePercent >= 1.25) || hasBearishOilInflationHeadline) {
    oilChannelDominance = 'INFLATION_CHANNEL_SELL_GOLD';
    sellScore += 18;
    const oilRateLabel = isUsoilAvailable
      ? `${usoil.changePercent >= 0 ? '+' : ''}${usoil.changePercent.toFixed(2)}% @ $${usoil.price.toFixed(2)}`
      : 'Headline Energi/Geopolitik';
    sellArguments.push({
      pillar: 'GEOPOLITICS',
      tag: 'DUAL-CHANNEL • USOIL INFLATION',
      textId: `Dominasi Inflation Channel (US Oil WTI ${oilRateLabel}): Kenaikan minyak memicu transmisi ke PPI & CPI (time-lag), memaksa Fed tetap ketat → Tekanan SELL Gold.`,
      textEn: `Inflation Channel Dominance (US Oil WTI ${oilRateLabel}): Oil surge transmits into PPI & CPI (with time-lag), keeping the Fed tighter → SELL Gold pressure.`,
    });
  } else if ((isUsoilAvailable && usoil.changePercent <= -1.0) || hasBullishOilReliefHeadline) {
    oilChannelDominance = 'SAFE_HAVEN_BUY_GOLD';
    buyScore += 12;
    buyArguments.push({
      pillar: 'INTERMARKET',
      tag: 'INFLATION RELIEF • USOIL',
      textId: `Penurunan harga US Oil WTI (${isUsoilAvailable ? `${usoil.changePercent.toFixed(2)}%` : 'Headline mereda'}) meredakan ekspektasi inflasi energi utama → Mengurangi tekanan suku bunga Fed (Pendukung BUY XAU/USD).`,
      textEn: `Pullback in US Oil WTI (${isUsoilAvailable ? `${usoil.changePercent.toFixed(2)}%` : 'Supply relief headline'}) eases headline energy inflation expectations → Reduces Hawkish Fed pressure (Supports BUY XAU/USD).`,
    });
  }

  // 3A. Yield Curve Spread (US10Y - US02Y), VIX Risk Regime, & Gold Run-Up Exhaustion Check
  let yieldCurveInfo: PreNewsFlowIntelligence['yieldCurve'];
  if (isUs10yAvailable && isUs02yAvailable && us02y) {
    const spread2s10s = Number((us10y.price - us02y.price).toFixed(2));
    const prevSpread = us10y.previousClose - us02y.previousClose;
    const spreadChangeBps = Number(((spread2s10s - prevSpread) * 100).toFixed(1));
    let effect: MacroBiasDirection = 'MIXED';
    let regimeLabelId = `Kurva 2s10s stabil (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%)`;
    let regimeLabelEn = `2s10s Curve steady (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%)`;

    if (us02y.direction === 'UP' && us02y.change >= us10y.change) {
      effect = 'SELL';
      sellScore += 8;
      regimeLabelId = `Bear Flattening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): Tenor 2Y naik lebih cepat → Repricing suku bunga ketat (Pro-SELL Gold)`;
      regimeLabelEn = `Bear Flattening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): 2Y leading yields higher → Tightening repricing (SELL Gold tilt)`;
    } else if (us02y.direction === 'DOWN' && us02y.change <= us10y.change) {
      effect = 'BUY';
      buyScore += 8;
      regimeLabelId = `Bull Steepening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): Tenor 2Y turun lebih cepat → Ekspektasi pelonggaran Fed (Pro-BUY Gold)`;
      regimeLabelEn = `Bull Steepening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): 2Y leading yields lower → Fed easing tailwind (BUY Gold tilt)`;
    } else if (us10y.direction === 'UP' && spreadChangeBps >= 3) {
      effect = 'MIXED';
      whipsawScore += 8;
      regimeLabelId = `Bear Steepening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): Tenor 10Y naik lebih tajam → Premi inflasi jangka panjang (Rawan Tarik-Menarik)`;
      regimeLabelEn = `Bear Steepening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): Long-end leading higher → Inflation term-premium tug-of-war`;
    } else if (us10y.direction === 'DOWN' && spreadChangeBps <= -3) {
      effect = 'BUY';
      buyScore += 6;
      regimeLabelId = `Bull Flattening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): Permintaan obligasi tenor panjang menguat → Safe-Haven mendukung Emas`;
      regimeLabelEn = `Bull Flattening (${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(2)}%): Long-end bond bid rising → Safe-Haven support for Gold`;
    }

    yieldCurveInfo = {
      spread2s10s,
      spreadChangeBps,
      regimeLabelId,
      regimeLabelEn,
      effect,
    };
  }

  let riskRegimeInfo: PreNewsFlowIntelligence['riskRegime'];
  if (intermarketPulse.vix && intermarketPulse.vix.isAvailable && intermarketPulse.vix.price > 0) {
    const vix = intermarketPulse.vix;
    const isVixElevated = vix.price >= 20 || vix.changePercent >= 4.5;
    let regimeLabelId = `Volatilitas VIX normal (${vix.price.toFixed(2)})`;
    let regimeLabelEn = `VIX volatility normal (${vix.price.toFixed(2)})`;
    if (isVixElevated && isUs10yAvailable && us10y.direction === 'DOWN') {
      buyScore += 8;
      regimeLabelId = `Pure Risk-Off Safe-Haven (VIX ${vix.price.toFixed(2)} naik + US10Y turun) → Dukungan defensif BUY Gold`;
      regimeLabelEn = `Pure Risk-Off Safe-Haven (VIX ${vix.price.toFixed(2)} elevated + US10Y lower) → Defensive BUY Gold support`;
    } else if (isVixElevated && isUs10yAvailable && us10y.direction === 'UP') {
      sellScore += 6;
      whipsawScore += 6;
      regimeLabelId = `Stress Likuiditas / Inflasi (VIX ${vix.price.toFixed(2)} + US10Y naik) → Waspada volatilitas dua arah`;
      regimeLabelEn = `Liquidity / Inflation Stress (VIX ${vix.price.toFixed(2)} + US10Y higher) → Watch two-way volatility`;
    } else if (isVixElevated) {
      whipsawScore += 5;
      regimeLabelId = `VIX meningkat (${vix.price.toFixed(2)}) — sentimen pasar lebih sensitif terhadap kejutan data`;
      regimeLabelEn = `Elevated VIX (${vix.price.toFixed(2)}) — heightened sensitivity to macro surprises`;
    }
    riskRegimeInfo = {
      vixPrice: vix.price,
      vixChangePercent: vix.changePercent,
      regimeLabelId,
      regimeLabelEn,
    };
  }

  const goldPos = intermarketPulse.goldPositioning;
  if (goldPos && goldPos.isAvailable) {
    if (goldPos.state === 'CROWDED_HIGH' && calendarExpectsBuy) {
      whipsawScore += 8;
    } else if (goldPos.state === 'OVERSOLD_LOW' && calendarExpectsSell) {
      whipsawScore += 8;
    }
  }

  // 3B. Evaluate CME FedWatch Tool Scoring Rules (Hukum Market Pricing Saturation >= 80% & Tie-Breaker)
  if (cmeFedWatch.isAvailable) {
    // Rule 1: Hukum Market Pricing Saturation (>= 80% Rate Hike, Rate Cut, or Hold)
    if (cmeFedWatch.isPricedInSaturated) {
      if (cmeFedWatch.saturationScenario === 'HIKE') {
        const hikeMsgId = `Pasar sudah ${cmeFedWatch.hikeProbability}% priced-in Rate Hike Desember — jika PPI rilis lebih rendah dari Forecast, waspadai kejutan repricing BUY XAU/USD yang eksplosif; jika PPI rilis panas, penguatan USD cenderung terbatas karena sudah priced-in.`;
        const hikeMsgEn = `Market is already ${cmeFedWatch.hikeProbability}% priced-in for a December Rate Hike — if PPI releases lower than Forecast, watch for an explosive BUY XAU/USD repricing surprise; if PPI prints hot, USD upside is likely capped as it is already priced-in.`;

        if (calendarExpectsBuy) {
          buyScore += 22;
          buyArguments.unshift({
            pillar: 'POLICY',
            tag: 'CME FEDWATCH • PRICED-IN SATURATION (≥80%)',
            textId: hikeMsgId,
            textEn: hikeMsgEn,
          });
        } else {
          buyScore += 10; // Asymmetry protection: capped USD upside because Hike >= 80% is already priced-in
          buyArguments.push({
            pillar: 'POLICY',
            tag: 'CME FEDWATCH • PRICED-IN SATURATION (≥80%)',
            textId: hikeMsgId,
            textEn: hikeMsgEn,
          });
        }
      } else if (cmeFedWatch.saturationScenario === 'CUT') {
        const cutMsgId = `Pasar sudah ${cmeFedWatch.cutProbability}% priced-in Rate Cut Desember — jika PPI/inflasi rilis lebih panas dari Forecast, waspadai kejutan repricing SELL XAU/USD yang tajam; jika rilis melandai, pelemahan USD cenderung terbatas karena sudah priced-in.`;
        const cutMsgEn = `Market is already ${cmeFedWatch.cutProbability}% priced-in for a December Rate Cut — if PPI/inflation prints hotter than Forecast, watch for a sharp SELL XAU/USD repricing surprise; if data cools, USD downside is likely capped as it is already priced-in.`;

        if (calendarExpectsSell) {
          sellScore += 22;
          sellArguments.unshift({
            pillar: 'POLICY',
            tag: 'CME FEDWATCH • PRICED-IN SATURATION (≥80%)',
            textId: cutMsgId,
            textEn: cutMsgEn,
          });
        } else {
          sellScore += 10;
          sellArguments.push({
            pillar: 'POLICY',
            tag: 'CME FEDWATCH • PRICED-IN SATURATION (≥80%)',
            textId: cutMsgId,
            textEn: cutMsgEn,
          });
        }
      } else if (cmeFedWatch.saturationScenario === 'HOLD' && calendarExpectsBuy) {
        buyScore += 16;
        buyArguments.push({
          pillar: 'POLICY',
          tag: 'CME FEDWATCH • PRICED-IN SATURATION (≥80%)',
          textId: `Priced-In Saturation CME FedWatch (Hold ${cmeFedWatch.holdProbability}% ≥ 80%): Ekspektasi tahan suku bunga sudah jenuh terdiskon; konsensus kalender yang mendukung BUY memberi bobot kejutan repricing ke atas pada XAU/USD.`,
          textEn: `CME FedWatch Priced-In Saturation (Hold ${cmeFedWatch.holdProbability}% ≥ 80%): Hold pricing is saturated; a BUY-leaning calendar consensus carries asymmetric upside repricing potential for XAU/USD.`,
        });
      }
    }

    // Rule 2: Tie-Breaker Mixed Data (when simultaneous indicators conflict or scores are tightly balanced)
    if (
      simultaneousAlignment === 'CONFLICTING_WHIPSAW' ||
      Math.abs(buyScore - sellScore) <= 12
    ) {
      if (cmeFedWatch.dominantOutcome === 'CUT') {
        buyScore += 14;
        buyArguments.push({
          pillar: 'POLICY',
          tag: 'CME FEDWATCH • TIE-BREAKER MIXED DATA',
          textId: `Tie-Breaker CME FedWatch (Rate Cut ${cmeFedWatch.cutProbability}%): Saat indikator rilis bersamaan saling tarik-menarik, arah dominan FedWatch (Cut) menjadi penentu arah condong BUY XAU/USD.`,
          textEn: `CME FedWatch Tie-Breaker (Rate Cut ${cmeFedWatch.cutProbability}%): When simultaneous indicators pull in opposite directions, dominant FedWatch Cut pricing tilts the balance toward BUY XAU/USD.`,
        });
      } else if (
        cmeFedWatch.dominantOutcome === 'HOLD' ||
        cmeFedWatch.dominantOutcome === 'HIKE'
      ) {
        sellScore += 14;
        sellArguments.push({
          pillar: 'POLICY',
          tag: 'CME FEDWATCH • TIE-BREAKER MIXED DATA',
          textId: `Tie-Breaker CME FedWatch (${cmeFedWatch.dominantOutcome === 'HIKE' ? `Rate Hike ${cmeFedWatch.hikeProbability}%` : `Hold ${cmeFedWatch.holdProbability}%`}): Saat indikator rilis bersamaan saling tarik-menarik, arah dominan FedWatch (${cmeFedWatch.dominantOutcome}) menjadi penentu arah condong SELL XAU/USD.`,
          textEn: `CME FedWatch Tie-Breaker (${cmeFedWatch.dominantOutcome === 'HIKE' ? `Rate Hike ${cmeFedWatch.hikeProbability}%` : `Hold ${cmeFedWatch.holdProbability}%`}): When simultaneous indicators pull in opposite directions, dominant FedWatch ${cmeFedWatch.dominantOutcome} pricing tilts the balance toward SELL XAU/USD.`,
        });
      }
    }
  }

  // 4. Auto-Scan RSS Headline & Evaluate Dynamic Pivot Rule ("Aturan Pindah Haluan Bang Nael")
  const fedSpeechEvents = workingCalendarEvents.filter((e) => isFedSpeechEvent(e.title));
  const primaryDayStr = (primaryEvent?.date || '').slice(0, 10);
  const nowDayStr = new Date().toISOString().slice(0, 10);
  const hasFedSpeechTodayOrSameDay = fedSpeechEvents.some((e) => {
    const eDay = (e.date || '').slice(0, 10);
    return eDay === primaryDayStr || eDay === nowDayStr;
  });

  // Evaluate Tone of explicit Fed Official Speech / Policy Headlines (guarding against false pivots from generic news)
  let statementTone: 'HAWKISH' | 'DOVISH' | 'NEUTRAL' = 'NEUTRAL';
  let speechToneSource: BreakingNewsHeadline | null = null;

  for (const b of workingBreakingNews.slice(0, 12)) {
    const isGenuineFedSignal =
      b.channelType === 'FED_SPEECH' ||
      isFedOfficialSpeechOrPolicyHeadline(b.title);
    if (!isGenuineFedSignal) continue;
    const tone = analyzeStatementTone(
      b.descriptionSummary ? `${b.title}. ${b.descriptionSummary}` : b.title
    );
    if (tone !== 'NEUTRAL') {
      statementTone = tone;
      speechToneSource = b;
      break;
    }
  }

  if (statementTone === 'NEUTRAL' && customHeadlineText) {
    statementTone = analyzeStatementTone(customHeadlineText);
  }

  const hasCoolingCpiForecast = workingCalendarEvents.some(
    (e) =>
      e.pillar === 'INFLATION' &&
      e.title.toUpperCase().includes('CPI') &&
      e.forecastNum !== null &&
      e.previousNum !== null &&
      e.forecastNum < e.previousNum
  );
  const hawkishFedNews = workingBreakingNews.find(
    (b) => b.channelType === 'FED_SPEECH' && b.sentimentForGold === 'BEARISH'
  );
  const strongNfpEvent = workingCalendarEvents.find(
    (e) =>
      e.pillar === 'LABOR' &&
      (e.title.toUpperCase().includes('NON-FARM') || e.title.toUpperCase().includes('NFP')) &&
      e.eventBiasForGold === 'SELL'
  );

  let dynamicPivotTriggered = false;
  let dynamicPivotType: 'HAWKISH_OVERRIDE' | 'DOVISH_OVERRIDE' | undefined;
  let dynamicPivotReasonId: string | undefined;
  let dynamicPivotReasonEn: string | undefined;
  let fedSpeechAlertNoteId: string | undefined;
  let fedSpeechAlertNoteEn: string | undefined;

  const bondConfirmedHawkish =
    (isUs02yAvailable && us02y?.direction === 'UP') || (isUs10yAvailable && us10y.direction === 'UP');
  const bondConfirmedDovish =
    (isUs02yAvailable && us02y?.direction === 'DOWN') || (isUs10yAvailable && us10y.direction === 'DOWN');

  // Check if FOMC Rate Decision is within 1..10 days (FOMC Blackout Period)
  const fomcUpcoming = workingCalendarEvents.find((ev) => {
    const t = ev.title.toUpperCase();
    const isRateDecision =
      t.includes('FOMC RATE') || t.includes('FEDERAL FUNDS RATE') || t.includes('RATE DECISION');
    if (!isRateDecision) return false;
    const diffDays = (new Date(ev.date).getTime() - nowMs) / (24 * 60 * 60 * 1000);
    return Number.isFinite(diffDays) && diffDays >= 0.2 && diffDays <= 10.5;
  });
  const fomcBlackoutActive = Boolean(fomcUpcoming);
  const fomcBlackoutNoteId = fomcUpcoming
    ? `Periode Tenang FOMC (Blackout): Menjelang ${fomcUpcoming.title} — pasar fokus penuh pada data makro, CME FedWatch, & US02Y.`
    : undefined;
  const fomcBlackoutNoteEn = fomcUpcoming
    ? `FOMC Blackout Window: Ahead of ${fomcUpcoming.title} — price discovery focuses purely on macro prints, CME FedWatch, & US02Y.`
    : undefined;

  let bondConfirmedPivot: boolean | undefined;

  // HAWKISH OVERRIDE: Auto-scanned RSS headline reveals Fed official backing rate hike / tightening / sticky inflation OR explicit Hawkish shift in CME FedWatch when calendar does not contradict saturation
  if (
    statementTone === 'HAWKISH' ||
    (hawkishFedNews && (hasCoolingCpiForecast || strongNfpEvent)) ||
    (cmeFedWatch.isAvailable &&
      Boolean(rawFedWatch?.hawkishShiftDetected) &&
      !(cmeFedWatch.saturationScenario === 'HIKE' && calendarExpectsBuy))
  ) {
    dynamicPivotTriggered = true;
    dynamicPivotType = 'HAWKISH_OVERRIDE';
    bondConfirmedPivot = bondConfirmedHawkish;
    sellScore += 45;
    buyScore = Math.max(5, Math.min(buyScore, 15));
    const officialName =
      speechToneSource?.matchedKeywords?.join(', ') ||
      hawkishFedNews?.matchedKeywords?.join(', ') ||
      (rawFedWatch?.hawkishShiftDetected ? 'CME FedWatch Hawkish Shift' : 'Pejabat Fed');
    const bondTagId = bondConfirmedHawkish ? ' [Terkonfirmasi Yield Obligasi]' : '';
    const bondTagEn = bondConfirmedHawkish ? ' [Bond-Yield Confirmed]' : '';
    dynamicPivotReasonId = `PINDAH HALUAN: HAWKISH OVERRIDE (Aturan Pindah Haluan Bang Nael)${bondTagId} — Deteksi otomatis mendapati sinyal Hawkish (${officialName}) yang membalikkan arah skenario menjadi SELL 1 ARAH pada XAU/USD.`;
    dynamicPivotReasonEn = `DYNAMIC PIVOT: HAWKISH OVERRIDE (Bang Nael Pivot Rule)${bondTagEn} — Automatic scan detected Hawkish signal (${officialName}), flipping the scenario into a 1-WAY SELL on XAU/USD.`;
    sellArguments.unshift({
      pillar: 'POLICY',
      tag: 'PINDAH HALUAN • HAWKISH OVERRIDE',
      textId: dynamicPivotReasonId,
      textEn: dynamicPivotReasonEn,
    });
  } else if (statementTone === 'DOVISH') {
    // DOVISH OVERRIDE: Auto-scanned RSS headline reveals Fed official signaling rate cuts / easing / pause
    dynamicPivotTriggered = true;
    dynamicPivotType = 'DOVISH_OVERRIDE';
    bondConfirmedPivot = bondConfirmedDovish;
    buyScore += 45;
    sellScore = Math.max(5, Math.min(sellScore, 15));
    const officialName = speechToneSource?.matchedKeywords?.join(', ') || 'Pejabat Fed';
    const bondTagId = bondConfirmedDovish ? ' [Terkonfirmasi Yield Obligasi]' : '';
    const bondTagEn = bondConfirmedDovish ? ' [Bond-Yield Confirmed]' : '';
    dynamicPivotReasonId = `PINDAH HALUAN: DOVISH OVERRIDE (Aturan Pindah Haluan Bang Nael)${bondTagId} — Auto-scan RSS mendeteksi pernyataan pejabat Fed (${officialName}) bernada Dovish (sinyal pemangkasan suku bunga / pelonggaran moneter) yang membalikkan arah skenario menjadi BUY 1 ARAH pada XAU/USD.`;
    dynamicPivotReasonEn = `DYNAMIC PIVOT: DOVISH OVERRIDE (Bang Nael Pivot Rule)${bondTagEn} — RSS auto-scan detected Fed official remarks (${officialName}) tilting Dovish (rate cuts / monetary easing guidance), flipping the scenario into a 1-WAY BUY on XAU/USD.`;
    buyArguments.unshift({
      pillar: 'POLICY',
      tag: 'PINDAH HALUAN • DOVISH OVERRIDE',
      textId: dynamicPivotReasonId,
      textEn: dynamicPivotReasonEn,
    });
  }

  // Fed Speech Cautionary Note if Fed speech is on calendar today with no directional speech headline yet
  if (hasFedSpeechTodayOrSameDay && !dynamicPivotTriggered) {
    fedSpeechAlertNoteId =
      'Waspada jadwal pidato pejabat Fed hari ini — pantau DXY & US02Y sebelum entry';
    fedSpeechAlertNoteEn =
      'Caution: Fed official speech scheduled today — monitor DXY & US02Y before entry';
  }

  // Ensure both argument lists have at least 2 structured points for balanced tactical review
  if (buyArguments.length === 0) {
    buyArguments.push({
      pillar: 'LABOR',
      tag: 'LABOR • SLOW HIRE SLOW FIRE',
      textId:
        'Sub-komponen JOLTS Hiring & ISM Employment yang melambat di bawah 50 membuka peluang rebound BUY XAU/USD jika rilis data aktual meleset di bawah konsensus.',
      textEn:
        'Sub-components JOLTS Hiring & ISM Employment cooling below 50 open a BUY XAU/USD rebound window if actual data misses consensus.',
    });
  }
  if (sellArguments.length === 0) {
    sellArguments.push({
      pillar: 'INFLATION',
      tag: 'INFLATION • STICKY CORE',
      textId:
        'Inflasi inti layanan & komponen ISM Prices Paid yang bertahan tinggi menjaga imbal hasil riil AS tetap ketat, membatasi reli XAU/USD di area resistance.',
      textEn:
        'Sticky core services inflation & elevated ISM Prices Paid keep US real yields restrictive, capping XAU/USD rallies at resistance.',
    });
  }

  // 5. Normalize Probabilities (buyProbability + sellProbability + mixedProbability === 100)
  const rawTotal = Math.max(1, buyScore + sellScore + whipsawScore);
  let buyProbability = Math.round((buyScore / rawTotal) * 100);
  let sellProbability = Math.round((sellScore / rawTotal) * 100);
  let mixedProbability = Math.max(5, 100 - buyProbability - sellProbability);

  // Enforce >= 40% MIXED / WHIPSAW probability when Simultaneous Release Conflict is detected (unless overridden by Dynamic Pivot)
  if (
    simultaneousAlignment === 'CONFLICTING_WHIPSAW' &&
    !dynamicPivotTriggered &&
    mixedProbability < 40
  ) {
    mixedProbability = 42;
    const remaining = 100 - mixedProbability;
    const dirSum = Math.max(1, buyScore + sellScore);
    buyProbability = Math.round((buyScore / dirSum) * remaining);
    sellProbability = Math.max(0, remaining - buyProbability);
  }

  if (buyProbability + sellProbability + mixedProbability !== 100) {
    const diff = 100 - (buyProbability + sellProbability + mixedProbability);
    mixedProbability += diff;
  }

  // Determine Dominant Bias
  let dominantBias: MacroBiasDirection = 'MIXED';
  if (dynamicPivotTriggered) {
    dominantBias = dynamicPivotType === 'HAWKISH_OVERRIDE' ? 'SELL' : 'BUY';
  } else if (simultaneousAlignment === 'CONFLICTING_WHIPSAW' && mixedProbability >= 30) {
    dominantBias = 'MIXED';
  } else if (sellProbability >= buyProbability + 8) {
    dominantBias = 'SELL';
  } else if (buyProbability >= sellProbability + 8) {
    dominantBias = 'BUY';
  } else {
    dominantBias = 'MIXED';
  }

  // Impact Level
  const hasHighImpactNews = workingBreakingNews.some((b) => b.impact === 'HIGH');
  const hasHighImpactEvent = primaryEvent.impact === 'High';
  const impactLevel: MacroImpactLevel =
    hasHighImpactNews || hasHighImpactEvent || dynamicPivotTriggered ? 'HIGH' : 'MEDIUM';

  // T-5M First-Second Execution Tactics (100% Automatic from Probability Distribution)
  const isStrongOneWayBias = buyProbability >= 60 || sellProbability >= 60;
  const t5ExecutionTacticId = isStrongOneWayBias
    ? 'BIAS 1 ARAH KUAT (FINAL T-5M) — Siapkan setup dan kalkulasi lot di area struktur M1/M5 sebelum detik rilis, gunakan SL ketat.'
    : 'POTENSI SPIKE 2 ARAH / WHIPSAW (FINAL T-5M) — Tahan entry sebelum rilis; biarkan likuiditas 1–2 menit pertama tersapu terlebih dahulu.';
  const t5ExecutionTacticEn = isStrongOneWayBias
    ? 'STRONG 1-WAY BIAS (FINAL T-5M) — Prepare setup and lot calculation at M1/M5 structure zones before release second, use tight SL.'
    : 'TWO-WAY SPIKE / WHIPSAW RISK (FINAL T-5M) — Hold entry before release; let the first 1–2 minutes of liquidity sweep settle first.';

  // Final Take, Action Plan, and Whipsaw Warning (including Market Pricing Saturation note when >= 80%)
  const saturationActionNoteId =
    cmeFedWatch.isAvailable && cmeFedWatch.saturationScenario === 'HIKE'
      ? `\n4. [HUKUM MARKET PRICING SATURATION] Pasar sudah ${cmeFedWatch.hikeProbability}% priced-in Rate Hike (${cmeFedWatch.fomcMeetingDate}) — jika data inflasi/tenaga kerja AS rilis lebih rendah dari Forecast, waspadai kejutan repricing BUY XAU/USD yang eksplosif; jika data rilis panas, penguatan USD cenderung terbatas karena sudah priced-in.`
      : cmeFedWatch.isAvailable && cmeFedWatch.saturationScenario === 'CUT'
      ? `\n4. [HUKUM MARKET PRICING SATURATION] Pasar sudah ${cmeFedWatch.cutProbability}% priced-in Rate Cut (${cmeFedWatch.fomcMeetingDate}) — jika data inflasi/tenaga kerja AS rilis lebih panas dari Forecast, waspadai kejutan repricing SELL XAU/USD yang tajam; jika data melandai, pelemahan USD cenderung terbatas karena sudah priced-in.`
      : '';

  const saturationActionNoteEn =
    cmeFedWatch.isAvailable && cmeFedWatch.saturationScenario === 'HIKE'
      ? `\n4. [MARKET PRICING SATURATION RULE] Market is already ${cmeFedWatch.hikeProbability}% priced-in for a Rate Hike (${cmeFedWatch.fomcMeetingDate}) — if US inflation/jobs print lower than Forecast, watch for an explosive BUY XAU/USD repricing surprise; if data prints hot, USD upside is likely capped as it is already priced-in.`
      : cmeFedWatch.isAvailable && cmeFedWatch.saturationScenario === 'CUT'
      ? `\n4. [MARKET PRICING SATURATION RULE] Market is already ${cmeFedWatch.cutProbability}% priced-in for a Rate Cut (${cmeFedWatch.fomcMeetingDate}) — if US inflation/jobs print hotter than Forecast, watch for a sharp SELL XAU/USD repricing surprise; if data cools, USD downside is likely capped as it is already priced-in.`
      : '';

  const finalTakeId =
    dominantBias === 'SELL'
      ? `BIAS DOMINAN: SELL XAU/USD (${sellProbability}%). Kombinasi tekanan 3 Pilar FOMC${dynamicPivotTriggered ? ', sinyal Pindah Haluan pejabat Fed,' : ''} serta konfirmasi imbal hasil US10Y/DXY menempatkan XAU/USD dalam skenario jual saat pullback (Sell on Rally).`
      : dominantBias === 'BUY'
      ? `BIAS DOMINAN: BUY XAU/USD (${buyProbability}%). Ekspektasi pelambatan data makro AS dan meredanya tekanan DXY/US10Y mendukung skenario beli terukur (Buy on Dip) setelah likuiditas rilis berita terserap.`
      : `BIAS DOMINAN: MIXED / RAWAN WHIPSAW (${mixedProbability}%). Terdapat divergensi antar-pilar data makro atau rilis simultan yang berlawanan arah. Hindari entry agresif sebelum arah candle M15 pasca-rilis terkonfirmasi.`;

  const finalTakeEn =
    dominantBias === 'SELL'
      ? `DOMINANT BIAS: SELL XAU/USD (${sellProbability}%). Alignment across the 3 FOMC Pillars${dynamicPivotTriggered ? ', Dynamic Hawkish Fed Pivot,' : ''} and US10Y/DXY confirmation places XAU/USD in a Sell-on-Rally regime.`
      : dominantBias === 'BUY'
      ? `DOMINANT BIAS: BUY XAU/USD (${buyProbability}%). Cooling US macro consensus and softer DXY/US10Y yields support a disciplined Buy-on-Dip setup once initial release volatility settles.`
      : `DOMINANT BIAS: MIXED / WHIPSAW RISK (${mixedProbability}%). Cross-pillar divergence or conflicting simultaneous releases detected. Avoid aggressive execution until the post-release M15 candle structure confirms direction.`;

  const actionPlanId =
    (dominantBias === 'SELL'
      ? `1. ${t5ExecutionTacticId}\n2. Konfirmasi SELL 1 Arah jika pergerakan harga selaras dengan kenaikan US10Y Yield & DXY.\n3. Jika FedWatch ≥ 80%, fokuskan eksekusi pada nada Forward Guidance & kejutan repricing data aktual.`
      : dominantBias === 'BUY'
      ? `1. ${t5ExecutionTacticId}\n2. Eksekusi BUY terukur di area struktur M1/M5 apabila DXY & US10Y Yield tertahan turun.\n3. Amankan parsial pada rasio 1:2 R:R.`
      : `1. ${t5ExecutionTacticId}\n2. Tunggu sweep likuiditas atas & bawah pasca-rilis ${primaryEvent.title}.\n3. Hanya eksekusi searah breakout struktur M5/M15 yang dikonfirmasi oleh arah DXY & US10Y.`) +
    saturationActionNoteId;

  const actionPlanEn =
    (dominantBias === 'SELL'
      ? `1. ${t5ExecutionTacticEn}\n2. Confirm 1-Way SELL if price action aligns with rising US10Y Yields & DXY.\n3. If FedWatch pricing ≥ 80%, anchor execution on Forward Guidance & actual data repricing surprises.`
      : dominantBias === 'BUY'
      ? `1. ${t5ExecutionTacticEn}\n2. Scale into BUY setups at M1/M5 structure zones as DXY & US10Y Yields roll over.\n3. Lock partial profit at 1:2 R:R.`
      : `1. ${t5ExecutionTacticEn}\n2. Wait for the two-way liquidity sweep after the ${primaryEvent.title} release.\n3. Only execute in the direction of the M5/M15 structure break confirmed by DXY & US10Y.`) +
    saturationActionNoteEn;

  const whipsawWarningId =
    simultaneousAlignment === 'CONFLICTING_WHIPSAW'
      ? `RISIKO WHIPSAW SAAT RILIS: ${allClusterEvents.length} data rilis bersamaan (${allClusterEvents.map((e) => e.title).join(' + ')}) memiliki sinyal berlawanan! Potensi spike 2 arah sangat tinggi pada menit pertama.`
      : isSimultaneousRelease
      ? `Rilis Simultan (${allClusterEvents.length} Event Bersamaan): Pastikan seluruh komponen searah saat rilis. Jika salah satu komponen berlawanan arah, waspadai RISIKO WHIPSAW SAAT RILIS.`
      : `Waspadai spike likuiditas awal pada detik rilis jika angka konsensus tipis atau terdapat divergensi intermarket.`;

  const whipsawWarningEn =
    simultaneousAlignment === 'CONFLICTING_WHIPSAW'
      ? `RELEASE WHIPSAW RISK: ${allClusterEvents.length} simultaneous releases (${allClusterEvents.map((e) => e.title).join(' + ')}) show conflicting signals! High risk of a two-way Fake Move in the first minute.`
      : isSimultaneousRelease
      ? `Simultaneous Release (${allClusterEvents.length} Concurrent Events): Verify all sub-components align at release. If one component diverges, guard against a Fake Move.`
      : `Watch for initial liquidity spikes at the release second if consensus figures are tight or intermarket diverges.`;

  const topBreakingAlert =
    workingBreakingNews.find((b) => b.impact === 'HIGH') || workingBreakingNews[0] || null;

  const slotKey = selectedEventId ? `${primaryEvent.id}:${primaryEvent.date}` : undefined;
  const dataFingerprint = computeMacroDataFingerprint(
    workingCalendarEvents,
    workingBreakingNews,
    slotKey
  );

  return {
    id: `macro-snap-${Date.now()}`,
    instrument: 'XAUUSD',
    dataFingerprint,
    analyzedAt: new Date().toISOString(),
    sourceMode,
    modelUsed,
    impactLevel,
    dominantBias,
    breakingNews: workingBreakingNews,
    topBreakingAlert,
    intermarketPulse,
    cmeFedWatch,
    calendarEvents: workingCalendarEvents,
    scenarioMatrix: {
      primaryEvent,
      simultaneousEvents,
      isSimultaneousRelease,
      simultaneousAlignment,
      buyProbability,
      sellProbability,
      mixedProbability,
      dominantBias,
      dynamicPivotTriggered,
      dynamicPivotReasonId,
      dynamicPivotReasonEn,
      dynamicPivotType,
      fedSpeechAlertNoteId,
      fedSpeechAlertNoteEn,
      oilChannelDominance,
      buyArguments,
      sellArguments,
      finalTakeId,
      finalTakeEn,
      actionPlanId,
      actionPlanEn,
      whipsawWarningId,
      whipsawWarningEn,
      t5ExecutionTacticId,
      t5ExecutionTacticEn,
      isStrongOneWayBias,
      cmeFedWatch,
      evaluationMode,
      fomcPillarRecap,
      institutionalDeskThesisId:
        dominantBias === 'SELL'
          ? `Transmisi lintas aset (${isDxyAvailable ? 'kenaikan DXY' : 'tekanan USD'}${isUs02yAvailable && us02y ? ` & yield US02Y ${us02y.price.toFixed(2)}%` : ''}${isUs10yAvailable ? ` + yield US10Y ${us10y.price.toFixed(2)}%` : ''}) mencerminkan akumulasi posisi institusional yang menahan penguatan Dolar AS menjelang rilis ${primaryEvent.title}. Aliran modal condong menekan XAU/USD (Sell-on-Rally); waspadai pembalikan arah tajam (Pindah Haluan) HANYA jika data aktual meleset jauh di bawah konsensus atau komentar The Fed berbalik dovish.`
          : dominantBias === 'BUY'
          ? `Pelemahan momentum lintas aset (${isDxyAvailable ? 'pelonggaran DXY' : 'pelemahan USD'}${isUs02yAvailable && us02y ? ` & yield US02Y ${us02y.price.toFixed(2)}%` : ''}${isUs10yAvailable ? ` serta US10Y ${us10y.price.toFixed(2)}%` : ''}) mengindikasikan penurunan premi risiko suku bunga, membuka likuiditas institusi masuk ke XAU/USD (Buy-on-Dip). Jalur kenaikan Emas tetap valid selama data aktual rilis tidak melompat signifikan di atas konsensus atau pejabat The Fed memicu Hawkish Pivot.`
          : `Keseimbangan kekuatan lintas aset dan potensi rilis bersamaan yang berlawanan menandakan pasar berada dalam fase konsolidasi ketat (Priced-In Equilibrium). Institusi menahan posisi terarah untuk menyapu likuiditas dua arah (Whipsaw); eksekusi directional baru valid pasca-penutupan struktur M5/M15 yang terkonfirmasi oleh arah DXY dan US02Y/US10Y.`,
      institutionalDeskThesisEn:
        dominantBias === 'SELL'
          ? `Cross-asset transmission (${isDxyAvailable ? 'firming DXY' : 'USD resilience'}${isUs02yAvailable && us02y ? ` & US02Y yield at ${us02y.price.toFixed(2)}%` : ''}${isUs10yAvailable ? ` alongside US10Y at ${us10y.price.toFixed(2)}%` : ''}) reflects institutional positioning favoring US Dollar resilience ahead of the ${primaryEvent.title} release. Capital flows point to downward pressure on XAU/USD (Sell-on-Rally); monitor for a sharp Dynamic Pivot ONLY if actual data misses substantially below consensus or Fed speakers tilt dovish.`
          : dominantBias === 'BUY'
          ? `Softening cross-asset momentum (${isDxyAvailable ? 'pullback in DXY' : 'softer USD'}${isUs02yAvailable && us02y ? ` & US02Y yield at ${us02y.price.toFixed(2)}%` : ''}${isUs10yAvailable ? ` with US10Y at ${us10y.price.toFixed(2)}%` : ''}) signals receding policy rate risk premia, unlocking institutional inflows into XAU/USD (Buy-on-Dip). Gold upside trajectory remains intact unless actual data prints heavily above forecast or Fed commentary sparks a Hawkish Pivot.`
          : `Cross-asset equilibrium and concurrent diverging releases indicate the desk is navigating a tight consolidation phase (Priced-In Equilibrium). Institutions are holding neutral risk budgets to absorb two-way liquidity whipsaws; directional conviction is only warranted following a confirmed M5/M15 structure break validated by DXY and US02Y/US10Y yields.`,
      preNewsFlow: {
        consensusTightness: consensusMeta.tightness,
        consensusNoteId: consensusMeta.noteId,
        consensusNoteEn: consensusMeta.noteEn,
        leadingChain,
        yieldCurve: yieldCurveInfo,
        goldPositioning: goldPos?.isAvailable ? goldPos : undefined,
        riskRegime: riskRegimeInfo,
        marketSentiment: computeMarketSentimentSummary({
          breakingNews: workingBreakingNews,
          calendarExpectsBuy,
          calendarExpectsSell,
          dxy,
          us10y,
          vix: intermarketPulse.vix,
          goldPositioning: goldPos,
          cmeFedWatch,
          stagflationDetected,
        }),
        fomcBlackoutActive,
        fomcBlackoutNoteId,
        fomcBlackoutNoteEn,
        bondConfirmedPivot,
        pillarStreakSummaryId: revisionSummary.pillarStreakSummaryId,
        pillarStreakSummaryEn: revisionSummary.pillarStreakSummaryEn,
        previousRevisions: revisionSummary.previousRevisions,
      },
      dualHorizon: computeDualHorizonAnalysis({
        breakingNews: workingBreakingNews,
        goldPositioning: goldPos?.isAvailable ? goldPos : undefined,
        dominantBias,
        buyProbability,
        sellProbability,
        mixedProbability,
        cmeFedWatch,
        dxy,
        us02y,
        us10y,
        primaryEvent,
        isSimultaneousRelease,
        simultaneousAlignment,
        calendarEvents: workingCalendarEvents,
      }),
    },
  };
}

/**
 * Formats remaining milliseconds into HH:MM:SS countdown format (e.g., "00:14:32").
 */
export function formatCountdownHms(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return '00:00:00';
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Analyzes a selected MacroEventGroup (or event ID) with 100% automatic Pre-News rules:
 * - Simultaneous release grouping (e.g. Core PPI m/m & PPI m/m)
 * - Forecast vs Previous directional scoring
 * - Simultaneous release conflict detection (MIXED >= 40% & RISIKO WHIPSAW SAAT RILIS)
 * - Real-time DXY, USOIL, US10Y intermarket confirmation & divergence detection
 * - CME FedWatch scoring (Priced-In Saturation >= 85%, Tie-Breaker Mixed Data, Pindah Haluan)
 * - RSS headline filtering for Fed speeches & geopolitics (Aturan Pindah Haluan Bang Nael)
 */
export function analyzeMacroEvent(
  selectedEventGroupOrParams:
    | MacroEventGroup
    | {
        calendarEvents: MacroCalendarEvent[];
        intermarketPulse: {
          dxy: IntermarketAssetPulse;
          us02y?: IntermarketAssetPulse;
          usoil: IntermarketAssetPulse;
          us10y: IntermarketAssetPulse;
          vix?: VixRiskPulse;
          goldPositioning?: GoldPositioningPulse;
        };
        breakingNews: BreakingNewsHeadline[];
        cmeFedWatch?: CmeFedWatchState;
        selectedEventId?: string;
        selectedEventGroup?: MacroEventGroup;
        sourceMode?: MacroNewsSnapshot['sourceMode'];
        modelUsed?: string;
        priorCalendarEvents?: MacroCalendarEvent[];
      },
  context?: {
    calendarEvents: MacroCalendarEvent[];
    intermarketPulse: {
      dxy: IntermarketAssetPulse;
      us02y?: IntermarketAssetPulse;
      usoil: IntermarketAssetPulse;
      us10y: IntermarketAssetPulse;
      vix?: VixRiskPulse;
      goldPositioning?: GoldPositioningPulse;
    };
    breakingNews: BreakingNewsHeadline[];
    cmeFedWatch?: CmeFedWatchState;
    sourceMode?: MacroNewsSnapshot['sourceMode'];
    modelUsed?: string;
    priorCalendarEvents?: MacroCalendarEvent[];
  }
): MacroNewsSnapshot {
  if ('groupId' in selectedEventGroupOrParams) {
    const group = selectedEventGroupOrParams;
    const ctx = context || {
      calendarEvents: group.events,
      intermarketPulse: {
        dxy: {
          symbol: 'DXY',
          yahooTicker: 'DX-Y.NYB',
          name: 'US Dollar Index (DXY)',
          price: 104.5,
          previousClose: 104.5,
          change: 0,
          changePercent: 0,
          direction: 'FLAT',
          goldCorrelationEffect: 'NEUTRAL',
          summaryId: 'DXY mendatar',
          summaryEn: 'DXY flat',
          updatedAt: new Date().toISOString(),
        },
        us02y: {
          symbol: 'US02Y',
          yahooTicker: '2YY=F',
          name: 'US 2Y Treasury Yield',
          price: 4.25,
          previousClose: 4.25,
          change: 0,
          changePercent: 0,
          direction: 'FLAT',
          goldCorrelationEffect: 'NEUTRAL',
          summaryId: 'Yield 2Y stabil',
          summaryEn: '2Y Yield stable',
          updatedAt: new Date().toISOString(),
        },
        usoil: {
          symbol: 'USOIL',
          yahooTicker: 'CL=F',
          name: 'US Oil WTI',
          price: 73.0,
          previousClose: 73.0,
          change: 0,
          changePercent: 0,
          direction: 'FLAT',
          goldCorrelationEffect: 'NEUTRAL',
          summaryId: 'WTI stabil',
          summaryEn: 'WTI stable',
          updatedAt: new Date().toISOString(),
        },
        us10y: {
          symbol: 'US10Y',
          yahooTicker: '^TNX',
          name: 'US 10Y Treasury Yield',
          price: 4.35,
          previousClose: 4.35,
          change: 0,
          changePercent: 0,
          direction: 'FLAT',
          goldCorrelationEffect: 'NEUTRAL',
          summaryId: 'Yield 10Y stabil',
          summaryEn: '10Y Yield stable',
          updatedAt: new Date().toISOString(),
        },
      },
      breakingNews: [],
    };
    return computeDeterministicMacroSnapshot({
      calendarEvents: ctx.calendarEvents.length > 0 ? ctx.calendarEvents : group.events,
      intermarketPulse: ctx.intermarketPulse,
      breakingNews: ctx.breakingNews,
      cmeFedWatch: ctx.cmeFedWatch,
      selectedEventId: group.groupId,
      sourceMode: ctx.sourceMode,
      modelUsed: ctx.modelUsed,
      priorCalendarEvents: ctx.priorCalendarEvents,
    });
  }

  const targetId =
    selectedEventGroupOrParams.selectedEventGroup?.groupId ||
    selectedEventGroupOrParams.selectedEventId;

  return computeDeterministicMacroSnapshot({
    calendarEvents: selectedEventGroupOrParams.calendarEvents,
    intermarketPulse: selectedEventGroupOrParams.intermarketPulse,
    breakingNews: selectedEventGroupOrParams.breakingNews,
    cmeFedWatch: selectedEventGroupOrParams.cmeFedWatch,
    selectedEventId: targetId,
    sourceMode: selectedEventGroupOrParams.sourceMode,
    modelUsed: selectedEventGroupOrParams.modelUsed,
    priorCalendarEvents: selectedEventGroupOrParams.priorCalendarEvents,
  });
}

/**
 * Computes the T-5 Minute Pre-News Lock and Real-Time Countdown state for the selected or nearest upcoming USD release.
 * Distinguishes clearly between:
 * 1) Early Reference (> 5 minutes before release, including H-1 / tomorrow):
 *    projectionBadgeId = "REFERENSI AWAL • DATA SEMENTARA (BELUM FINAL T-5M)"
 *    projectionSubtextId = "Proyeksi berdasarkan Forecast, korelasi DXY/USOIL/US10Y, & sentimen RSS terkini. Tekan Refresh berkala menjelang rilis."
 * 2) Final T-5M Lock (0 < remainingMs <= 5 minutes before release):
 *    projectionBadgeId = "FINAL PRE-NEWS LOCKED (T-5M) • SIAP EKSEKUSI"
 */
export function computePreNewsLockState(
  calendarEvents: MacroCalendarEvent[],
  nowMs: number = Date.now(),
  selectedEventId?: string | null
): PreNewsCountdownState {
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  // Prefer the selected event if it is a Primary High-Impact release; otherwise pick the nearest upcoming Primary High-Impact release
  const primaryPool = calendarEvents.filter((e) => isPrimaryHighImpactEvent(e));
  const effectivePool = primaryPool.length > 0 ? primaryPool : calendarEvents;

  const selectedEv = selectedEventId
    ? effectivePool.find((e) => e.id === selectedEventId)
    : undefined;

  let targetEvent: MacroCalendarEvent | null = null;
  if (selectedEv) {
    targetEvent = selectedEv;
  } else {
    const upcoming = effectivePool
      .filter((e) => {
        const t = new Date(e.date).getTime();
        return Number.isFinite(t) && t > nowMs;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    targetEvent = upcoming[0] || effectivePool[0] || null;
  }

  const targetTimeMs = targetEvent ? new Date(targetEvent.date).getTime() : NaN;
  const isReleased = Boolean(
    targetEvent && Number.isFinite(targetTimeMs) && targetTimeMs <= nowMs
  );
  const hasActual = Boolean(targetEvent?.actual && targetEvent.actual.trim());
  const remainingMs =
    Number.isFinite(targetTimeMs) && targetTimeMs > nowMs ? targetTimeMs - nowMs : 0;

  const isLockedT5M = remainingMs > 0 && remainingMs <= FIVE_MINUTES_MS;
  const formattedCountdown = formatCountdownHms(remainingMs);

  const statusLabelId = isReleased
    ? hasActual
      ? 'Rilis Selesai (Post-News)'
      : 'Sudah Rilis'
    : isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M)'
    : 'Auto-Update Final pada T-05:00';
  const statusLabelEn = isReleased
    ? hasActual
      ? 'Released (Post-News)'
      : 'Released'
    : isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M)'
    : 'Final Auto-Update at T-05:00';

  const projectionBadgeId = isReleased
    ? hasActual
      ? 'POST-NEWS RELEASED • DATA AKTUAL TERVERIFIKASI'
      : 'SUDAH RILIS • DATA AKTUAL BELUM TERSEDIA'
    : isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M) • SIAP EKSEKUSI'
    : 'REFERENSI AWAL • DATA SEMENTARA (BELUM FINAL T-5M)';
  const projectionBadgeEn = isReleased
    ? hasActual
      ? 'POST-NEWS RELEASED • VERIFIED ACTUAL DATA'
      : 'RELEASED • ACTUAL DATA PENDING'
    : isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M) • READY FOR EXECUTION'
    : 'EARLY REFERENCE • PRELIMINARY DATA (NOT FINAL T-5M)';

  const projectionSubtextId = isReleased
    ? hasActual
      ? 'Analisis Post-News membandingkan Actual vs Forecast serta evaluasi apakah rilis aktual membalik bias Pre-News.'
      : 'Waktu rilis telah lewat. Tekan Analisis Live untuk menarik data Actual terbaru bila sudah tersedia.'
    : isLockedT5M
    ? 'Auto-Update Final telah dieksekusi pada T-05:00. Tampilan dikunci (Freeze Auto-Refresh) agar probabilitas BUY / SELL / MIXED stabil saat eksekusi.'
    : 'Proyeksi berdasarkan Forecast, korelasi DXY/USOIL/US10Y, & sentimen RSS terkini. Tekan Refresh berkala menjelang rilis.';
  const projectionSubtextEn = isReleased
    ? hasActual
      ? 'Post-News evaluation compares Actual vs Forecast and highlights whether the print flipped the Pre-News consensus.'
      : 'Release time has passed. Tap Live Sync to pull the latest Actual value once published.'
    : isLockedT5M
    ? 'Final Auto-Update executed at T-05:00. Display locked (Freeze Auto-Refresh) so BUY / SELL / MIXED probabilities remain stable for execution.'
    : 'Projection based on Forecast, DXY/USOIL/US10Y correlation, & latest RSS sentiment. Press Refresh periodically ahead of release.';

  return {
    targetEvent,
    remainingMs,
    formattedCountdown,
    countdownHms: formattedCountdown,
    isLockedT5M,
    statusLabelId,
    statusLabelEn,
    projectionBadgeId,
    projectionBadgeEn,
    projectionSubtextId,
    projectionSubtextEn,
  };
}

/**
 * Formats an ISO timestamp into WIB (Asia/Jakarta, UTC+7) human-readable string.
 */
export function formatTimestampWib(isoStr: string, lang: 'id' | 'en' = 'id'): string {
  if (!isoStr) return '-';
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) return isoStr;
    const formatted = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dt);
    return `${formatted.replace(',', ' ·')} WIB`;
  } catch {
    return isoStr;
  }
}

/**
 * Formats an ISO timestamp into precision live clock format: "Update Live: HH:mm:ss WIB".
 */
export function formatLiveUpdateClockWib(isoStr: string, lang: 'id' | 'en' = 'id'): string {
  if (!isoStr) return lang === 'en' ? 'Live Update: --:--:-- WIB' : 'Update Live: --:--:-- WIB';
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) {
      return lang === 'en' ? 'Live Update: --:--:-- WIB' : 'Update Live: --:--:-- WIB';
    }
    const timePart = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(dt);
    const normalizedHms = timePart.replace(/\./g, ':');
    return lang === 'en'
      ? `Live Update: ${normalizedHms} WIB`
      : `Update Live: ${normalizedHms} WIB`;
  } catch {
    return lang === 'en' ? 'Live Update: --:--:-- WIB' : 'Update Live: --:--:-- WIB';
  }
}

/**
 * Checks if a snapshot was analyzed within the last `maxAgeMinutes` (default 30 mins).
 */
export function isSnapshotFresh(
  snapshot: MacroNewsSnapshot | null | undefined,
  maxAgeMinutes = SNAPSHOT_TTL_MINUTES
): boolean {
  if (!snapshot || !snapshot.analyzedAt) return false;
  const analyzedMs = new Date(snapshot.analyzedAt).getTime();
  if (!Number.isFinite(analyzedMs)) return false;
  return Date.now() - analyzedMs < maxAgeMinutes * 60 * 1000;
}

/**
 * Verifies that a MacroNewsSnapshot contains 100% authentic live ForexFactory calendar data
 * and zero legacy/mock fallback items.
 */
export function isVerifiedLiveCalendarSnapshot(
  snap: MacroNewsSnapshot | null | undefined
): boolean {
  if (!snap || !snap.scenarioMatrix || !snap.intermarketPulse) return false;
  if (!snap.isCalendarLiveFeed) return false;
  if (!Array.isArray(snap.calendarEvents) || snap.calendarEvents.length === 0) return false;
  return snap.calendarEvents.every(
    (e) =>
      e.isLiveFeed === true &&
      !String(e.id || '').startsWith('ff-usd-') &&
      e.id !== 'fallback-ppi-event' &&
      e.id !== 'live-calendar-unavailable'
  );
}

/**
 * Loads the latest cached MacroNewsSnapshot from localStorage and/or Supabase (`macro_news_snapshots`).
 * Strictly rejects any legacy/non-live mock snapshot so only verified live ForexFactory data is used.
 * Uses 0 Gemini tokens!
 */
export function loadLocalCachedMacroSnapshotSync(): MacroNewsSnapshot | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MacroNewsSnapshot;
      if (isVerifiedLiveCalendarSnapshot(parsed)) {
        return {
          ...parsed,
          calendarEvents: sanitizeUnreleasedCalendarEventActuals(parsed.calendarEvents),
        };
      }
      // Purge stale mock snapshot from localStorage
      localStorage.removeItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY);
      localStorage.removeItem(MACRO_GROUP_SNAPSHOT_CACHE_KEY);
    }
  } catch {
    // ignore local storage parse error
  }
  return null;
}

export async function loadLatestCachedMacroSnapshot(options?: {
  localOnly?: boolean;
}): Promise<MacroNewsSnapshot | null> {
  const localSnap = loadLocalCachedMacroSnapshotSync();

  if (options?.localOnly) {
    return localSnap;
  }

  if (isSupabaseConfigured()) {
    const client = getSupabase();
    if (client) {
      try {
        const { data, error } = await client
          .from('macro_news_snapshots')
          .select('id, data_fingerprint, snapshot_payload, analyzed_at')
          .eq('instrument', 'XAUUSD')
          .order('analyzed_at', { ascending: false })
          .limit(12);

        if (!error && Array.isArray(data)) {
          // Harvest any released actuals across prior Supabase snapshots into offline archive (0 Gemini tokens)
          for (const row of data) {
            const snapCandidate = row?.snapshot_payload as MacroNewsSnapshot | undefined;
            if (snapCandidate && Array.isArray(snapCandidate.calendarEvents) && snapCandidate.calendarEvents.length > 0) {
              recordReleasedActualsToOfflineArchive(snapCandidate.calendarEvents, 'OFFLINE_ARCHIVE');
            }
          }

          // Prefer snapshots analyzed on a weekday (Senin–Jumat) via isMarketDay
          const sortedRows = [...data].sort((a, b) => {
            const aMarket = isMarketDay(a.analyzed_at || a.snapshot_payload?.analyzedAt) ? 1 : 0;
            const bMarket = isMarketDay(b.analyzed_at || b.snapshot_payload?.analyzedAt) ? 1 : 0;
            if (aMarket !== bMarket) return bMarket - aMarket;
            return (
              new Date(b.analyzed_at || 0).getTime() - new Date(a.analyzed_at || 0).getTime()
            );
          });

          for (const row of sortedRows) {
            const remoteSnap = row.snapshot_payload as MacroNewsSnapshot;
            if (isVerifiedLiveCalendarSnapshot(remoteSnap)) {
              const remoteTime = new Date(row.analyzed_at || remoteSnap.analyzedAt).getTime();
              const localTime = localSnap ? new Date(localSnap.analyzedAt).getTime() : 0;
              const remoteIsWeekday = isMarketDay(row.analyzed_at || remoteSnap.analyzedAt);
              const localIsWeekday = localSnap ? isMarketDay(localSnap.analyzedAt) : false;

              if (
                !localSnap ||
                (remoteIsWeekday && !localIsWeekday) ||
                (remoteIsWeekday === localIsWeekday && remoteTime >= localTime)
              ) {
                const hydratedEvents = hydrateEventsWithOfflineArchive(remoteSnap.calendarEvents);
                if (Array.isArray(remoteSnap.breakingNews) && remoteSnap.breakingNews.length > 0) {
                  recordBreakingNewsToMonthlyArchive(remoteSnap.breakingNews);
                }
                const hydrated: MacroNewsSnapshot = {
                  ...remoteSnap,
                  calendarEvents: hydratedEvents,
                  sourceMode: 'SUPABASE_CACHE',
                };
                if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
                  try {
                    localStorage.setItem(
                      MACRO_SNAPSHOT_LOCAL_STORAGE_KEY,
                      JSON.stringify(hydrated)
                    );
                  } catch {}
                }
                return hydrated;
              }
              break;
            }
          }
        }
      } catch {
        // Fallback silently to localSnap if table does not exist or offline
      }
    }
  }

  if (localSnap) {
    if (Array.isArray(localSnap.breakingNews) && localSnap.breakingNews.length > 0) {
      recordBreakingNewsToMonthlyArchive(localSnap.breakingNews);
    }
    return {
      ...localSnap,
      calendarEvents: hydrateEventsWithOfflineArchive(localSnap.calendarEvents),
    };
  }
  return localSnap;
}

/**
 * Loads a cached MacroNewsSnapshot for a specific event group or data_fingerprint from localStorage or Supabase.
 */
export async function loadCachedSnapshotByFingerprint(
  dataFingerprint: string,
  maxAgeMinutes = 15
): Promise<MacroNewsSnapshot | null> {
  if (!dataFingerprint) return null;

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const rawMap = localStorage.getItem(MACRO_GROUP_SNAPSHOT_CACHE_KEY);
      if (rawMap) {
        const parsedMap = JSON.parse(rawMap) as Record<string, MacroNewsSnapshot>;
        const candidate = parsedMap[dataFingerprint];
        if (
          candidate &&
          isVerifiedLiveCalendarSnapshot(candidate) &&
          isSnapshotFresh(candidate, maxAgeMinutes)
        ) {
          return { ...candidate, sourceMode: 'SUPABASE_CACHE' };
        }
      }
    } catch {
      // ignore localStorage parse error
    }
  }

  if (isSupabaseConfigured()) {
    const client = getSupabase();
    if (client) {
      try {
        const { data, error } = await client
          .from('macro_news_snapshots')
          .select('id, data_fingerprint, snapshot_payload, analyzed_at')
          .eq('instrument', 'XAUUSD')
          .eq('data_fingerprint', dataFingerprint)
          .order('analyzed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data && data.snapshot_payload) {
          const remoteSnap = data.snapshot_payload as MacroNewsSnapshot;
          if (
            remoteSnap &&
            isVerifiedLiveCalendarSnapshot(remoteSnap) &&
            isSnapshotFresh(remoteSnap, maxAgeMinutes)
          ) {
            return {
              ...remoteSnap,
              sourceMode: 'SUPABASE_CACHE',
            };
          }
        }
      } catch {
        // ignore network error
      }
    }
  }

  return null;
}

/**
 * Saves a newly analyzed MacroNewsSnapshot to both localStorage (latest + per-fingerprint map)
 * and Supabase (`macro_news_snapshots` keyed with `data_fingerprint`).
 * Strictly refuses to cache any snapshot whose calendar data is not verified live.
 */
export async function saveMacroSnapshotToCache(
  snapshot: MacroNewsSnapshot
): Promise<{ success: boolean; error?: string; remoteSaved: boolean }> {
  if (!isVerifiedLiveCalendarSnapshot(snapshot)) {
    return {
      success: false,
      remoteSaved: false,
      error: 'Gagal memuat kalender live — periksa koneksi atau coba refresh',
    };
  }

  recordReleasedActualsToOfflineArchive(snapshot.calendarEvents);

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
      if (snapshot.dataFingerprint) {
        const rawMap = localStorage.getItem(MACRO_GROUP_SNAPSHOT_CACHE_KEY);
        const parsedMap: Record<string, MacroNewsSnapshot> = rawMap ? JSON.parse(rawMap) : {};
        parsedMap[snapshot.dataFingerprint] = snapshot;
        if (snapshot.scenarioMatrix?.primaryEvent?.id) {
          parsedMap[`event:${snapshot.scenarioMatrix.primaryEvent.id}`] = snapshot;
        }
        localStorage.setItem(MACRO_GROUP_SNAPSHOT_CACHE_KEY, JSON.stringify(parsedMap));
      }
      dispatchMacroLocalSyncEvent();

      // Append verified live snapshot to chronological bias history cache (max 24 points)
      const primaryEv = snapshot.scenarioMatrix?.primaryEvent;
      if (primaryEv) {
        const entry: BiasHistoryPoint = {
          analyzedAt: snapshot.analyzedAt || new Date().toISOString(),
          eventTitle: primaryEv.title,
          dominantBias: snapshot.scenarioMatrix.dominantBias,
          buyProbability: snapshot.scenarioMatrix.buyProbability,
          sellProbability: snapshot.scenarioMatrix.sellProbability,
          mixedProbability: snapshot.scenarioMatrix.mixedProbability,
          sourceMode: snapshot.sourceMode,
          isPostNews: primaryEv.actualNum !== null && primaryEv.actualNum !== undefined,
        };
        const rawHist = localStorage.getItem(MACRO_BIAS_HISTORY_STORAGE_KEY);
        const hist: BiasHistoryPoint[] = rawHist ? JSON.parse(rawHist) : [];
        const prevLast = hist[hist.length - 1];
        const isDuplicatePoint =
          prevLast &&
          prevLast.eventTitle === entry.eventTitle &&
          prevLast.dominantBias === entry.dominantBias &&
          prevLast.buyProbability === entry.buyProbability &&
          prevLast.sellProbability === entry.sellProbability &&
          Math.abs(new Date(entry.analyzedAt).getTime() - new Date(prevLast.analyzedAt).getTime()) < 90 * 1000;
        if (!isDuplicatePoint) {
          const nextHist = [...hist, entry].slice(-24);
          localStorage.setItem(MACRO_BIAS_HISTORY_STORAGE_KEY, JSON.stringify(nextHist));
        }
      }
    } catch {
      // ignore storage quota errors
    }
  }

  if (isSupabaseConfigured()) {
    const client = getSupabase();
    if (client) {
      try {
        const normalizedAnalyzedAt = isMarketDay(snapshot.analyzedAt, {
          useUtc: true,
          enforceFridayCloseUtc: true,
        })
          ? snapshot.analyzedAt
          : normalizeToMarketDayIso(snapshot.analyzedAt);

        const { error } = await client.from('macro_news_snapshots').insert({
          instrument: 'XAUUSD',
          data_fingerprint: snapshot.dataFingerprint,
          snapshot_payload: {
            ...snapshot,
            analyzedAt: normalizedAnalyzedAt,
          },
          impact_level: snapshot.impactLevel,
          dominant_bias: snapshot.dominantBias,
          source_mode: snapshot.sourceMode,
          analyzed_at: normalizedAnalyzedAt,
        });

        if (error) {
          console.warn('[TradeVault Supabase] Gagal menyimpan snapshot ke macro_news_snapshots:', error);
          return {
            success: false,
            remoteSaved: false,
            error: error.message || error.details || 'Gagal menyimpan snapshot ke tabel Supabase macro_news_snapshots.',
          };
        }

        return { success: true, remoteSaved: true };
      } catch (err: any) {
        console.warn('[TradeVault Supabase] Exception saat menyimpan snapshot:', err);
        return {
          success: false,
          remoteSaved: false,
          error: err?.message || 'Terjadi kesalahan jaringan saat menyimpan ke Supabase.',
        };
      }
    }
  }

  return { success: true, remoteSaved: false };
}

/**
 * Triggers a local notification on Android (@capacitor/local-notifications) or Web Notification API
 * when `snapshot.impactLevel === 'HIGH'`.
 */
export async function triggerHighImpactMacroNotification(
  snapshot: MacroNewsSnapshot,
  lang: 'id' | 'en' = 'id',
  forceNotify = false
): Promise<boolean> {
  if (snapshot.impactLevel !== 'HIGH' && !forceNotify) {
    return false;
  }

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && !forceNotify) {
    try {
      const lastFp = localStorage.getItem(MACRO_NOTIFIED_FINGERPRINT_KEY);
      if (lastFp === snapshot.dataFingerprint) {
        return false; // Already notified for this exact data fingerprint
      }
      localStorage.setItem(MACRO_NOTIFIED_FINGERPRINT_KEY, snapshot.dataFingerprint);
    } catch {}
  }

  const matrix = snapshot.scenarioMatrix;
  const title =
    lang === 'en'
      ? `⚡ HIGH IMPACT XAU/USD: ${matrix.dominantBias} BIAS (BUY ${matrix.buyProbability}% | SELL ${matrix.sellProbability}%)`
      : `⚡ HIGH IMPACT XAU/USD: BIAS ${matrix.dominantBias} (BUY ${matrix.buyProbability}% | SELL ${matrix.sellProbability}%)`;

  const body =
    lang === 'en'
      ? `${matrix.primaryEvent.title}: ${matrix.finalTakeEn.slice(0, 140)}`
      : `${matrix.primaryEvent.title}: ${matrix.finalTakeId.slice(0, 140)}`;

  try {
    const permStatus = await LocalNotifications.checkPermissions();
    let granted = permStatus.display === 'granted';
    if (!granted) {
      const req = await LocalNotifications.requestPermissions();
      granted = req.display === 'granted';
    }

    if (granted) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor((Date.now() % 2000000000) + 1),
            title,
            body,
            schedule: { at: new Date(Date.now() + 300) },
            extra: {
              instrument: 'XAUUSD',
              dominantBias: matrix.dominantBias,
              impactLevel: snapshot.impactLevel,
            },
          },
        ],
      });
      playNotificationPing();
      return true;
    }
  } catch {
    // Fallback to browser Notification API if available
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        if (Notification.permission === 'granted') {
          new Notification(title, { body });
          playNotificationPing();
          return true;
        }
      } catch {}
    }
  }

  return false;
}

/**
 * Loads chronological Bias History points from Supabase `macro_news_snapshots`
 * merged with localStorage history cache so traders can inspect probability shifts
 * across refresh intervals and Pre-News -> Post-News transitions.
 */
export async function loadMacroBiasHistory(
  eventTitle?: string,
  limit = 10
): Promise<BiasHistoryPoint[]> {
  const collected: BiasHistoryPoint[] = [];

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(MACRO_BIAS_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.analyzedAt && typeof item.buyProbability === 'number') {
              collected.push(item as BiasHistoryPoint);
            }
          }
        }
      }
    } catch {
      // ignore storage parse error
    }
  }

  if (isSupabaseConfigured()) {
    const client = getSupabase();
    if (client) {
      try {
        const { data, error } = await client
          .from('macro_news_snapshots')
          .select('analyzed_at, dominant_bias, source_mode, snapshot_payload')
          .eq('instrument', 'XAUUSD')
          .order('analyzed_at', { ascending: false })
          .limit(20);

        if (!error && Array.isArray(data)) {
          for (const row of data) {
            const payload = row.snapshot_payload as MacroNewsSnapshot | undefined;
            const matrix = payload?.scenarioMatrix;
            const primary = matrix?.primaryEvent;
            if (!payload || !matrix || !primary || !isVerifiedLiveCalendarSnapshot(payload)) {
              continue;
            }
            collected.push({
              analyzedAt: row.analyzed_at || payload.analyzedAt,
              eventTitle: primary.title,
              dominantBias: matrix.dominantBias,
              buyProbability: matrix.buyProbability,
              sellProbability: matrix.sellProbability,
              mixedProbability: matrix.mixedProbability,
              sourceMode: payload.sourceMode,
              isPostNews: primary.actualNum !== null && primary.actualNum !== undefined,
            });
          }
        }
      } catch {
        // Fallback silently to local history
      }
    }
  }

  // Deduplicate by 2-minute bucket + title, sort chronologically oldest -> newest
  const dedup = new Map<string, BiasHistoryPoint>();
  for (const pt of collected) {
    const ts = new Date(pt.analyzedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    const bucket = Math.floor(ts / (2 * 60 * 1000));
    const key = `${bucket}|${(pt.eventTitle || '').trim().toLowerCase()}`;
    dedup.set(key, pt);
  }

  let sorted = Array.from(dedup.values()).sort(
    (a, b) => new Date(a.analyzedAt).getTime() - new Date(b.analyzedAt).getTime()
  );

  if (eventTitle && eventTitle.trim()) {
    const targetLower = eventTitle.trim().toLowerCase();
    const matching = sorted.filter((p) => (p.eventTitle || '').trim().toLowerCase() === targetLower);
    if (matching.length >= 2) {
      sorted = matching;
    }
  }

  return sorted.slice(-limit);
}

// ============================================================================
// PER-EVENT PRE-RELEASE FREEZE ARCHIVE (IMMUTABLE ONCE RELEASED, LIVE WHILE UPCOMING)
// ============================================================================

export const MACRO_PRERELEASE_FROZEN_ARCHIVE_KEY = 'tradevault_macro_prerelease_frozen_v1';

export interface FrozenPreReleaseSpikeLevels {
  hasValidData: boolean;
  bslPrice: number;
  sslPrice: number;
  poiLow: number;
  poiHigh: number;
  macro4hPdZone: string;
}

export interface FrozenPreReleaseRecord {
  eventKey: string;
  eventId: string;
  eventTitle: string;
  releaseDateIso: string;
  capturedAtIso: string;
  isFinalT5Lock: boolean;
  source: 'LOCAL_PRE_RELEASE' | 'SUPABASE_PRE_RELEASE';
  dominantBias: MacroBiasDirection;
  buyProbability: number;
  sellProbability: number;
  mixedProbability: number;
  dualHorizon: DualHorizonAnalysis;
  preNewsFlow?: MacroNewsSnapshot['scenarioMatrix']['preNewsFlow'];
  spikeLevels?: FrozenPreReleaseSpikeLevels;
}

let inMemoryFrozenPreReleaseMap: Record<string, FrozenPreReleaseRecord> | null = null;

export function getPreReleaseFreezeEventKey(
  ev: Pick<MacroCalendarEvent, 'title' | 'date'> | null | undefined
): string {
  if (!ev || !ev.title || !ev.date) return '';
  const canonicalTitle = normalizeCanonicalMacroTitleKey(ev.title) || ev.title.trim().toLowerCase();
  const dt = new Date(ev.date);
  const slot = Number.isFinite(dt.getTime())
    ? dt.toISOString().slice(0, 16)
    : String(ev.date).trim().slice(0, 16);
  return `${canonicalTitle}|${slot}`;
}

function readFrozenPreReleaseMap(): Record<string, FrozenPreReleaseRecord> {
  if (inMemoryFrozenPreReleaseMap) {
    return inMemoryFrozenPreReleaseMap;
  }
  const map: Record<string, FrozenPreReleaseRecord> = {};
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(MACRO_PRERELEASE_FROZEN_ARCHIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (
              v &&
              typeof v === 'object' &&
              typeof (v as any).eventKey === 'string' &&
              typeof (v as any).releaseDateIso === 'string' &&
              typeof (v as any).capturedAtIso === 'string' &&
              (v as any).dualHorizon
            ) {
              map[k] = v as FrozenPreReleaseRecord;
            }
          }
        }
      }
    } catch {
      // ignore corrupted storage
    }
  }
  inMemoryFrozenPreReleaseMap = map;
  return map;
}

function writeFrozenPreReleaseMap(map: Record<string, FrozenPreReleaseRecord>): void {
  // Prune to the 60 most recently scheduled events so localStorage stays compact
  const entries = Object.entries(map);
  let targetMap = map;
  if (entries.length > 60) {
    entries.sort(
      (a, b) =>
        new Date(b[1].releaseDateIso).getTime() - new Date(a[1].releaseDateIso).getTime()
    );
    targetMap = Object.fromEntries(entries.slice(0, 60));
  }
  inMemoryFrozenPreReleaseMap = targetMap;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MACRO_PRERELEASE_FROZEN_ARCHIVE_KEY, JSON.stringify(targetMap));
    } catch {
      // ignore quota error
    }
  }
}

/**
 * Loads the frozen Pre-Release record for a specific calendar event if it was genuinely
 * captured strictly BEFORE the scheduled release time.
 */
export function loadFrozenPreReleaseRecord(
  ev: Pick<MacroCalendarEvent, 'title' | 'date'> | null | undefined
): FrozenPreReleaseRecord | null {
  const key = getPreReleaseFreezeEventKey(ev);
  if (!key) return null;
  const map = readFrozenPreReleaseMap();
  const candidate = map[key];
  if (!candidate) return null;

  const releaseMs = new Date(candidate.releaseDateIso).getTime();
  const capturedMs = new Date(candidate.capturedAtIso).getTime();
  if (!Number.isFinite(releaseMs) || !Number.isFinite(capturedMs) || capturedMs >= releaseMs) {
    return null;
  }
  return candidate;
}

/**
 * Records/updates a Pre-Release snapshot for an UPCOMING event.
 * Strict immutability guarantee:
 * - For LOCAL_PRE_RELEASE writes, strictly REFUSES to write once `nowMs >= releaseMs`
 *   or `capturedMs >= releaseMs`, ensuring already-released news NEVER gets overwritten
 *   by live post-release data.
 * - For SUPABASE_PRE_RELEASE historical recovery, accepts only records whose `capturedAtIso`
 *   is strictly earlier than `releaseDateIso` and does not overwrite an existing local lock.
 */
export function saveFrozenPreReleaseRecord(
  record: FrozenPreReleaseRecord,
  nowMs = Date.now()
): boolean {
  if (!record || !record.eventKey || !record.releaseDateIso || !record.capturedAtIso) {
    return false;
  }
  const releaseMs = new Date(record.releaseDateIso).getTime();
  const capturedMs = new Date(record.capturedAtIso).getTime();
  if (!Number.isFinite(releaseMs) || !Number.isFinite(capturedMs)) {
    return false;
  }
  // Never store a record captured at or after the release timestamp
  if (capturedMs >= releaseMs) {
    return false;
  }

  const map = { ...readFrozenPreReleaseMap() };
  const existing = map[record.eventKey];

  if (record.source === 'LOCAL_PRE_RELEASE') {
    // Once the scheduled release time has arrived or passed, refuse any live mutation
    if (nowMs >= releaseMs) {
      return false;
    }
    map[record.eventKey] = record;
    writeFrozenPreReleaseMap(map);
    return true;
  }

  // Historical recovery from Supabase: never overwrite an already stored local pre-release lock
  if (existing && existing.source === 'LOCAL_PRE_RELEASE') {
    return false;
  }
  map[record.eventKey] = record;
  writeFrozenPreReleaseMap(map);
  return true;
}

/**
 * Attempts to recover an authentic Pre-Release snapshot for an already-released event
 * from Supabase `macro_news_snapshots` (strictly `analyzed_at < ev.date`, within 24h before release).
 * Returns null honestly if no pre-release snapshot was ever recorded before the event released.
 */
export async function loadFrozenPreReleaseFromSupabase(
  ev: MacroCalendarEvent | null | undefined
): Promise<FrozenPreReleaseRecord | null> {
  if (!ev || !ev.title || !ev.date) return null;
  const existing = loadFrozenPreReleaseRecord(ev);
  if (existing) return existing;

  const releaseMs = new Date(ev.date).getTime();
  if (!Number.isFinite(releaseMs)) return null;
  if (!isSupabaseConfigured()) return null;

  const client = getSupabase();
  if (!client) return null;

  const eventKey = getPreReleaseFreezeEventKey(ev);
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const earliestAllowedIso = new Date(releaseMs - TWENTY_FOUR_HOURS_MS).toISOString();

  try {
    const { data, error } = await client
      .from('macro_news_snapshots')
      .select('analyzed_at, snapshot_payload')
      .eq('instrument', 'XAUUSD')
      .lt('analyzed_at', ev.date)
      .gte('analyzed_at', earliestAllowedIso)
      .order('analyzed_at', { ascending: false })
      .limit(6);

    if (error || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    for (const row of data) {
      const snap = row?.snapshot_payload as MacroNewsSnapshot | undefined;
      const analyzedAtIso = String(row?.analyzed_at || snap?.analyzedAt || '');
      const analyzedMs = new Date(analyzedAtIso).getTime();
      if (!snap || !isVerifiedLiveCalendarSnapshot(snap)) continue;
      if (!Number.isFinite(analyzedMs) || analyzedMs >= releaseMs) continue;

      // Match event inside the historical pre-release snapshot
      const matchedEv =
        (snap.calendarEvents || []).find(
          (c) => getPreReleaseFreezeEventKey(c) === eventKey
        ) || ev;

      const historicalSnap = analyzeMacroEvent({
        calendarEvents: snap.calendarEvents,
        intermarketPulse: snap.intermarketPulse,
        breakingNews: snap.breakingNews,
        cmeFedWatch: snap.cmeFedWatch || snap.scenarioMatrix?.cmeFedWatch,
        selectedEventId: matchedEv.id,
        sourceMode: snap.sourceMode,
        modelUsed: snap.modelUsed,
      });

      const histMatrix = historicalSnap.scenarioMatrix;
      const histDualHorizon =
        histMatrix.dualHorizon ||
        computeDualHorizonAnalysis({
          breakingNews: snap.breakingNews || [],
          goldPositioning:
            histMatrix.preNewsFlow?.goldPositioning || snap.intermarketPulse?.goldPositioning,
          dominantBias: histMatrix.dominantBias,
          buyProbability: histMatrix.buyProbability,
          sellProbability: histMatrix.sellProbability,
          mixedProbability: histMatrix.mixedProbability,
          cmeFedWatch:
            histMatrix.cmeFedWatch || snap.cmeFedWatch || createUnavailableFedWatchState(),
          dxy: snap.intermarketPulse.dxy,
          us02y: snap.intermarketPulse.us02y,
          us10y: snap.intermarketPulse.us10y,
          primaryEvent: histMatrix.primaryEvent,
          isSimultaneousRelease: histMatrix.isSimultaneousRelease,
          simultaneousAlignment: histMatrix.simultaneousAlignment,
          calendarEvents: snap.calendarEvents,
        });

      const recovered: FrozenPreReleaseRecord = {
        eventKey,
        eventId: ev.id,
        eventTitle: ev.title,
        releaseDateIso: ev.date,
        capturedAtIso: analyzedAtIso,
        isFinalT5Lock: releaseMs - analyzedMs <= 6 * 60 * 1000,
        source: 'SUPABASE_PRE_RELEASE',
        dominantBias: histMatrix.dominantBias,
        buyProbability: histMatrix.buyProbability,
        sellProbability: histMatrix.sellProbability,
        mixedProbability: histMatrix.mixedProbability,
        dualHorizon: histDualHorizon,
        preNewsFlow: histMatrix.preNewsFlow,
      };

      saveFrozenPreReleaseRecord(recovered);
      return recovered;
    }
  } catch {
    // Graceful failure — return null so UI stays honest
  }

  return null;
}

// ============================================================================
// OFFLINE ACTUALS ARCHIVE & 3-SYSTEM ARCHITECTURE (PRE-NEWS / POST-NEWS 2H / LIVE PULSE)
// ============================================================================

let inMemoryActualsArchive: ArchivedMacroActualRecord[] = [];
let inMemoryPreNewsLocks: Record<string, PreNewsSystemState> = {};
let inMemoryPostNewsLocks: Record<string, PostNewsSystemState> = {};
let inMemoryMonthlyNewsSpeechArchive: MonthlyNewsSpeechArchive | null = null;

export function isPlaceholderMacroValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  const trimmed = String(raw).trim();
  if (!trimmed) return true;
  return /^(-|—|–|n\/a|na|null|undefined|menunggu|pending|tba|tbd)$/i.test(trimmed);
}

export function normalizeCanonicalMacroTitleKey(title: string): string {
  const raw = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!raw) return '';

  // Flash / S&P Global PMI aliases (ForexFactory vs TradingView)
  if (
    raw === 'flash manufacturing pmi' ||
    raw === 's&p global manufacturing pmi flash' ||
    raw === 's&p global manufacturing pmi' ||
    raw === 's&p global us manufacturing pmi' ||
    raw === 'markit manufacturing pmi' ||
    raw === 'manufacturing pmi'
  ) {
    return 'flash manufacturing pmi';
  }
  if (
    raw === 'flash services pmi' ||
    raw === 's&p global services pmi flash' ||
    raw === 's&p global services pmi' ||
    raw === 's&p global us services pmi' ||
    raw === 'markit services pmi' ||
    raw === 'services pmi'
  ) {
    return 'flash services pmi';
  }
  if (
    raw === 'flash composite pmi' ||
    raw === 's&p global composite pmi flash' ||
    raw === 's&p global composite pmi' ||
    raw === 'composite pmi'
  ) {
    return 'flash composite pmi';
  }

  // Jobless claims aliases
  if (raw === 'unemployment claims' || raw === 'initial jobless claims') {
    return 'unemployment claims';
  }
  if (raw === 'continuing claims' || raw === 'continuing jobless claims') {
    return 'continuing jobless claims';
  }

  // ADP aliases
  if (
    raw === 'adp non-farm employment change' ||
    raw === 'adp employment change' ||
    raw === 'adp national employment'
  ) {
    return 'adp non-farm employment change';
  }

  // Regional Fed manufacturing aliases
  if (
    raw === 'philly fed manufacturing index' ||
    raw === 'philadelphia fed manufacturing index'
  ) {
    return 'philly fed manufacturing index';
  }
  if (
    raw === 'empire state manufacturing index' ||
    raw === 'ny empire state manufacturing index'
  ) {
    return 'empire state manufacturing index';
  }
  if (
    raw === 'richmond manufacturing index' ||
    raw === 'richmond fed manufacturing index'
  ) {
    return 'richmond manufacturing index';
  }

  // Michigan / UoM Consumer Sentiment & Inflation Expectations aliases
  if (
    raw.includes('uom consumer sentiment') ||
    raw.includes('michigan consumer sentiment')
  ) {
    return raw.includes('prelim') || raw.includes('prel')
      ? 'prelim uom consumer sentiment'
      : 'revised uom consumer sentiment';
  }
  if (
    raw.includes('uom inflation expectations') ||
    raw.includes('michigan inflation expectations') ||
    raw.includes('michigan 1-year inflation')
  ) {
    return raw.includes('prelim') || raw.includes('prel')
      ? 'prelim uom inflation expectations'
      : 'revised uom inflation expectations';
  }

  return raw;
}

export function normalizeActualArchiveKey(title: string, dateIso: string): string {
  const cleanTitle = normalizeCanonicalMacroTitleKey(title);
  let dayKey = '';
  try {
    const dt = new Date(dateIso);
    if (!isNaN(dt.getTime())) {
      dayKey = dt.toISOString().slice(0, 10);
    }
  } catch {
    // ignore invalid date
  }
  return `${cleanTitle}|${dayKey || String(dateIso || '').slice(0, 10)}`;
}

export function isEventReleasedOrImminent(dateIso: string, nowMs: number = Date.now()): boolean {
  const evMs = new Date(dateIso).getTime();
  // Allow up to 2 minutes of minor clock skew; anything scheduled further in the future is strictly unreleased
  return Number.isFinite(evMs) && evMs <= nowMs + 2 * 60 * 1000;
}

/**
 * Strips any leaked or prematurely populated `actual` / `actualNum` values from calendar events
 * whose scheduled release timestamp is still in the future (> nowMs + 2 minutes),
 * recomputing their Pre-News directional bias from Forecast vs Previous.
 */
export function sanitizeUnreleasedCalendarEventActuals(
  events: MacroCalendarEvent[],
  nowMs: number = Date.now()
): MacroCalendarEvent[] {
  if (!Array.isArray(events) || events.length === 0) return events || [];
  return events.map((ev) => {
    if (!ev) return ev;
    if (isEventReleasedOrImminent(ev.date, nowMs)) return ev;
    if (isPlaceholderMacroValue(ev.actual) && (ev.actualNum === null || ev.actualNum === undefined)) {
      return ev;
    }
    const evalPre = evaluateSingleEventForGold(ev.title, null, ev.forecastNum, ev.previousNum);
    return {
      ...ev,
      actual: '',
      actualNum: null,
      eventBiasForGold: evalPre.bias,
      biasReasonId: evalPre.reasonId,
      biasReasonEn: evalPre.reasonEn,
      actualSource: undefined,
      isOfflineArchived: false,
    };
  });
}

export function loadOfflineActualsArchive(): ArchivedMacroActualRecord[] {
  const nowMs = Date.now();
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(MACRO_ACTUALS_ARCHIVE_STORAGE_KEY);
      if (!raw) {
        inMemoryActualsArchive = [];
        return [];
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (r): r is ArchivedMacroActualRecord =>
            Boolean(
              r &&
                r.title &&
                !isPlaceholderMacroValue(r.actual) &&
                isEventReleasedOrImminent(r.date, nowMs)
            )
        );
        if (valid.length !== parsed.length) {
          try {
            localStorage.setItem(MACRO_ACTUALS_ARCHIVE_STORAGE_KEY, JSON.stringify(valid));
          } catch {
            // ignore storage quota errors
          }
        }
        inMemoryActualsArchive = valid;
        return valid;
      }
    } catch {
      // ignore storage parse failure
    }
  }
  return inMemoryActualsArchive.filter((r) =>
    Boolean(r && r.title && !isPlaceholderMacroValue(r.actual) && isEventReleasedOrImminent(r.date, nowMs))
  );
}

export function saveOfflineActualsArchive(records: ArchivedMacroActualRecord[]): void {
  const nowMs = Date.now();
  const cleaned = records
    .filter((r) =>
      Boolean(
        r &&
          r.title &&
          !isPlaceholderMacroValue(r.actual) &&
          isEventReleasedOrImminent(r.date, nowMs)
      )
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 500);
  inMemoryActualsArchive = cleaned;

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MACRO_ACTUALS_ARCHIVE_STORAGE_KEY, JSON.stringify(cleaned));
    } catch {
      // ignore storage quota errors
    }
  }
}

/**
 * Records all verified released USD `actual` prints into persistent Offline Archive.
 * CRITICAL RULE: Never overwrites an already saved non-empty actual with blank/"Menunggu",
 * and NEVER records an event whose release time is still in the future.
 */
export function recordReleasedActualsToOfflineArchive(
  events: MacroCalendarEvent[],
  defaultSource: ActualSourceType = 'LIVE_FEED',
  archiveOverride?: ArchivedMacroActualRecord[],
  nowMs: number = Date.now()
): ArchivedMacroActualRecord[] {
  const baseRecords = archiveOverride ? [...archiveOverride] : [...loadOfflineActualsArchive()];
  const map = new Map<string, ArchivedMacroActualRecord>();
  for (const r of baseRecords) {
    if (
      r &&
      r.archiveKey &&
      !isPlaceholderMacroValue(r.actual) &&
      isEventReleasedOrImminent(r.date, nowMs)
    ) {
      map.set(r.archiveKey, r);
    }
  }

  for (const ev of events || []) {
    if (!ev || !ev.title || isFedSpeechEvent(ev.title)) continue;
    if (isPlaceholderMacroValue(ev.actual)) continue;
    if (!isEventReleasedOrImminent(ev.date, nowMs)) continue;

    const key = normalizeActualArchiveKey(ev.title, ev.date);
    const existing = map.get(key);
    const parsedAct =
      ev.actualNum !== null && ev.actualNum !== undefined
        ? ev.actualNum
        : parseMacroNumeric(ev.actual).value;

    const record: ArchivedMacroActualRecord = {
      archiveKey: key,
      id: ev.id || existing?.id || `arch-${key.replace(/[^a-z0-9]/gi, '').slice(0, 20)}`,
      title: ev.title.trim(),
      date: ev.date,
      impact: ev.impact || existing?.impact || 'Medium',
      previous: !isPlaceholderMacroValue(ev.previous)
        ? ev.previous
        : existing?.previous || '—',
      forecast: !isPlaceholderMacroValue(ev.forecast)
        ? ev.forecast
        : existing?.forecast || '—',
      actual: ev.actual.trim(),
      previousNum:
        ev.previousNum !== null && ev.previousNum !== undefined
          ? ev.previousNum
          : existing?.previousNum ?? null,
      forecastNum:
        ev.forecastNum !== null && ev.forecastNum !== undefined
          ? ev.forecastNum
          : existing?.forecastNum ?? null,
      actualNum: parsedAct,
      unit: ev.unit || existing?.unit || parseMacroNumeric(ev.actual).unit || '',
      pillar: ev.pillar || existing?.pillar || classifyFomcPillar(ev.title),
      isInverseIndicator:
        typeof ev.isInverseIndicator === 'boolean'
          ? ev.isInverseIndicator
          : isInverseUsdIndicator(ev.title),
      eventCategory: ev.eventCategory || existing?.eventCategory,
      actualSource: ev.actualSource || existing?.actualSource || defaultSource,
      recordedAt: new Date().toISOString(),
    };
    map.set(key, record);
  }

  const next = Array.from(map.values())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 500);

  if (!archiveOverride) {
    saveOfflineActualsArchive(next);
  }
  return next;
}

/**
 * Ensures the permanent offline archive contains verified historical USD releases
 * (Sep–Nov 2026 CPI, PPI, NFP, PCE, FOMC, GDP, Retail Sales, ISM) for newly installed APKs
 * without ever overwriting existing LIVE_FEED / TV_ENRICH / SEARCH_ENRICH records.
 */
export function ensureHistoricalActualsArchiveSeeded(
  archiveOverride?: ArchivedMacroActualRecord[]
): ArchivedMacroActualRecord[] {
  const nowMs = Date.now();
  const existing = archiveOverride ? [...archiveOverride] : [...loadOfflineActualsArchive()];
  const byKey = new Map<string, ArchivedMacroActualRecord>();
  for (const r of existing) {
    if (
      r &&
      r.archiveKey &&
      !isPlaceholderMacroValue(r.actual) &&
      isEventReleasedOrImminent(r.date, nowMs)
    ) {
      byKey.set(r.archiveKey, r);
    }
  }

  let addedAny = false;
  for (const seed of HISTORICAL_MACRO_ACTUALS_SEED) {
    if (!isEventReleasedOrImminent(seed.date, nowMs)) continue;
    const key = normalizeActualArchiveKey(seed.title, seed.date);
    if (byKey.has(key)) continue;

    // Also avoid duplicating if an alias title (e.g. "Core Inflation Rate MoM" vs "Core CPI m/m") exists on the same date window
    const seedMs = new Date(seed.date).getTime();
    const seedLower = seed.title.toLowerCase();
    const isDuplicateEquivalent = existing.some((rec) => {
      const recMs = new Date(rec.date).getTime();
      if (!Number.isFinite(recMs) || Math.abs(recMs - seedMs) > 12 * 60 * 60 * 1000) return false;
      const recLower = rec.title.toLowerCase();
      if (recLower === seedLower) return true;
      if (seedLower === 'core cpi m/m' && /core.*(cpi|inflation).*m/.test(recLower)) return true;
      if (seedLower === 'cpi m/m' && !recLower.includes('core') && /^(cpi|inflation rate).*m/.test(recLower)) return true;
      if (seedLower === 'core cpi y/y' && /core.*(cpi|inflation).*y/.test(recLower)) return true;
      if (seedLower === 'cpi y/y' && !recLower.includes('core') && /^(cpi|inflation rate).*y/.test(recLower)) return true;
      if (seedLower === 'non-farm employment change' && /(non[\s-]*farm|nfp)/.test(recLower) && !recLower.includes('adp') && !recLower.includes('private')) return true;
      if (seedLower === 'core retail sales m/m' && /retail sales ex autos/.test(recLower)) return true;
      if (seedLower === 'federal funds rate' && /(interest rate|federal funds|fomc)/.test(recLower)) return true;
      return false;
    });
    if (isDuplicateEquivalent) continue;

    const record: ArchivedMacroActualRecord = {
      archiveKey: key,
      id: `seed-${key.replace(/[^a-z0-9]/gi, '').slice(0, 22)}`,
      title: seed.title,
      date: seed.date,
      impact: seed.impact,
      previous: seed.previous,
      forecast: seed.forecast,
      actual: seed.actual,
      previousNum: seed.previousNum,
      forecastNum: seed.forecastNum,
      actualNum: seed.actualNum,
      unit: seed.unit,
      pillar: seed.pillar,
      isInverseIndicator: seed.isInverseIndicator,
      eventCategory: seed.eventCategory,
      actualSource: 'OFFLINE_ARCHIVE',
      recordedAt: seed.date,
    };
    byKey.set(key, record);
    existing.push(record);
    addedAny = true;
  }

  if (!addedAny) {
    return existing.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  const next = Array.from(byKey.values())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 500);

  if (!archiveOverride) {
    saveOfflineActualsArchive(next);
    dispatchMacroLocalSyncEvent();
  }
  return next;
}

export interface RawTradingViewCalendarEvent {
  id?: string | number;
  title?: string;
  indicator?: string;
  country?: string;
  date?: string;
  actual?: number | null;
  forecast?: number | null;
  previous?: number | null;
  unit?: string;
  scale?: string;
  importance?: number;
}

export function mapTradingViewTitleToCanonical(rawTitle: string): {
  canonicalTitle: string;
  forceHighImpact: boolean;
} | null {
  const t = String(rawTitle || '').trim();
  const lower = t
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Exact match map for primary & medium-impact USD macro releases
  const exactMap: Record<string, { title: string; high: boolean }> = {
    'core inflation rate mom': { title: 'Core CPI m/m', high: true },
    'inflation rate mom': { title: 'CPI m/m', high: true },
    'core inflation rate yoy': { title: 'Core CPI y/y', high: true },
    'inflation rate yoy': { title: 'CPI y/y', high: true },
    'ppi mom': { title: 'PPI m/m', high: true },
    'core ppi mom': { title: 'Core PPI m/m', high: true },
    'ppi yoy': { title: 'PPI y/y', high: false },
    'core ppi yoy': { title: 'Core PPI y/y', high: false },
    'non farm payrolls': { title: 'Non-Farm Employment Change', high: true },
    'unemployment rate': { title: 'Unemployment Rate', high: true },
    'average hourly earnings mom': { title: 'Average Hourly Earnings m/m', high: true },
    'average hourly earnings yoy': { title: 'Average Hourly Earnings y/y', high: false },
    'core pce price index mom': { title: 'Core PCE Price Index m/m', high: true },
    'pce price index mom': { title: 'PCE Price Index m/m', high: false },
    'core pce price index yoy': { title: 'Core PCE Price Index y/y', high: false },
    'pce price index yoy': { title: 'PCE Price Index y/y', high: false },
    'retail sales mom': { title: 'Retail Sales m/m', high: true },
    'retail sales ex autos mom': { title: 'Core Retail Sales m/m', high: false },
    'gdp growth rate qoq adv': { title: 'Advance GDP q/q', high: true },
    'gdp growth rate qoq 2nd est': { title: 'Prelim GDP q/q', high: true },
    'gdp growth rate qoq final': { title: 'Final GDP q/q', high: true },
    'gdp growth rate qoq': { title: 'Advance GDP q/q', high: true },
    'gdp price index qoq adv': { title: 'Advance GDP Price Index q/q', high: false },
    'gdp price index qoq 2nd est': { title: 'Prelim GDP Price Index q/q', high: false },
    'gdp price index qoq final': { title: 'Final GDP Price Index q/q', high: false },
    'gdp price index qoq': { title: 'Advance GDP Price Index q/q', high: false },
    'ism manufacturing pmi': { title: 'ISM Manufacturing PMI', high: true },
    'ism services pmi': { title: 'ISM Services PMI', high: true },
    'ism non-manufacturing pmi': { title: 'ISM Services PMI', high: true },
    'ism manufacturing prices': { title: 'ISM Manufacturing Prices', high: false },
    'ism services prices': { title: 'ISM Services Prices', high: false },
    's&p global manufacturing pmi flash': { title: 'Flash Manufacturing PMI', high: false },
    's&p global manufacturing pmi': { title: 'Flash Manufacturing PMI', high: false },
    's&p global us manufacturing pmi': { title: 'Flash Manufacturing PMI', high: false },
    'markit manufacturing pmi flash': { title: 'Flash Manufacturing PMI', high: false },
    'manufacturing pmi': { title: 'Flash Manufacturing PMI', high: false },
    'flash manufacturing pmi': { title: 'Flash Manufacturing PMI', high: false },
    's&p global services pmi flash': { title: 'Flash Services PMI', high: false },
    's&p global services pmi': { title: 'Flash Services PMI', high: false },
    's&p global us services pmi': { title: 'Flash Services PMI', high: false },
    'markit services pmi flash': { title: 'Flash Services PMI', high: false },
    'services pmi': { title: 'Flash Services PMI', high: false },
    'flash services pmi': { title: 'Flash Services PMI', high: false },
    's&p global composite pmi flash': { title: 'Flash Composite PMI', high: false },
    's&p global composite pmi': { title: 'Flash Composite PMI', high: false },
    'composite pmi': { title: 'Flash Composite PMI', high: false },
    'chicago pmi': { title: 'Chicago PMI', high: false },
    'philadelphia fed manufacturing index': { title: 'Philly Fed Manufacturing Index', high: false },
    'philly fed manufacturing index': { title: 'Philly Fed Manufacturing Index', high: false },
    'ny empire state manufacturing index': { title: 'Empire State Manufacturing Index', high: false },
    'empire state manufacturing index': { title: 'Empire State Manufacturing Index', high: false },
    'richmond fed manufacturing index': { title: 'Richmond Manufacturing Index', high: false },
    'richmond manufacturing index': { title: 'Richmond Manufacturing Index', high: false },
    'cb consumer confidence': { title: 'CB Consumer Confidence', high: false },
    'consumer confidence': { title: 'CB Consumer Confidence', high: false },
    'interest rate': { title: 'Federal Funds Rate', high: true },
    'fed interest rate decision': { title: 'Federal Funds Rate', high: true },
    'initial jobless claims': { title: 'Unemployment Claims', high: false },
    'unemployment claims': { title: 'Unemployment Claims', high: false },
    'continuing jobless claims': { title: 'Continuing Jobless Claims', high: false },
    'adp employment change': { title: 'ADP Non-Farm Employment Change', high: false },
    'adp non-farm employment change': { title: 'ADP Non-Farm Employment Change', high: false },
    'jolts job openings': { title: 'JOLTS Job Openings', high: true },
    'durable goods orders mom': { title: 'Durable Goods Orders m/m', high: false },
    'core durable goods orders mom': { title: 'Core Durable Goods Orders m/m', high: false },
    'durable goods orders ex transp mom': { title: 'Core Durable Goods Orders m/m', high: false },
    'factory orders mom': { title: 'Factory Orders m/m', high: false },
    'existing home sales': { title: 'Existing Home Sales', high: false },
    'new home sales': { title: 'New Home Sales', high: false },
    'pending home sales mom': { title: 'Pending Home Sales m/m', high: false },
    'building permits': { title: 'Building Permits', high: false },
    'building permits prel': { title: 'Building Permits', high: false },
    'housing starts': { title: 'Housing Starts', high: false },
    'michigan consumer sentiment prel': { title: 'Prelim UoM Consumer Sentiment', high: false },
    'michigan consumer sentiment prelim': { title: 'Prelim UoM Consumer Sentiment', high: false },
    'prelim uom consumer sentiment': { title: 'Prelim UoM Consumer Sentiment', high: false },
    'michigan consumer sentiment final': { title: 'Revised UoM Consumer Sentiment', high: false },
    'michigan consumer sentiment': { title: 'Revised UoM Consumer Sentiment', high: false },
    'revised uom consumer sentiment': { title: 'Revised UoM Consumer Sentiment', high: false },
    'michigan inflation expectations prel': { title: 'Prelim UoM Inflation Expectations', high: false },
    'michigan inflation expectations prelim': { title: 'Prelim UoM Inflation Expectations', high: false },
    'michigan inflation expectations final': { title: 'Revised UoM Inflation Expectations', high: false },
    'michigan inflation expectations': { title: 'Prelim UoM Inflation Expectations', high: false },
    'balance of trade': { title: 'Trade Balance', high: false },
    'trade balance': { title: 'Trade Balance', high: false },
    'goods trade balance': { title: 'Goods Trade Balance', high: false },
    'goods trade balance adv': { title: 'Goods Trade Balance', high: false },
    'industrial production mom': { title: 'Industrial Production m/m', high: false },
    'capacity utilization': { title: 'Capacity Utilization', high: false },
    'import prices mom': { title: 'Import Prices m/m', high: false },
    'export prices mom': { title: 'Export Prices m/m', high: false },
    'business inventories mom': { title: 'Business Inventories m/m', high: false },
    'wholesale inventories mom': { title: 'Wholesale Inventories m/m', high: false },
    'nahb housing market index': { title: 'NAHB Housing Market Index', high: false },
    'nfib business optimism index': { title: 'NFIB Small Business Index', high: false },
  };

  const hit = exactMap[lower];
  if (hit) {
    return { canonicalTitle: hit.title, forceHighImpact: hit.high };
  }

  // Deterministic pattern fallback for TradingView title suffixes/variations
  if (lower.includes('s&p global') && lower.includes('manufacturing') && lower.includes('pmi')) {
    return { canonicalTitle: 'Flash Manufacturing PMI', forceHighImpact: false };
  }
  if (lower.includes('s&p global') && lower.includes('services') && lower.includes('pmi')) {
    return { canonicalTitle: 'Flash Services PMI', forceHighImpact: false };
  }
  if (lower.includes('s&p global') && lower.includes('composite') && lower.includes('pmi')) {
    return { canonicalTitle: 'Flash Composite PMI', forceHighImpact: false };
  }
  if (lower.includes('ism') && lower.includes('manufacturing') && lower.includes('pmi')) {
    return { canonicalTitle: 'ISM Manufacturing PMI', forceHighImpact: true };
  }
  if (lower.includes('ism') && (lower.includes('services') || lower.includes('non-manufacturing')) && lower.includes('pmi')) {
    return { canonicalTitle: 'ISM Services PMI', forceHighImpact: true };
  }
  if (lower.includes('philadelphia fed') && lower.includes('manufacturing')) {
    return { canonicalTitle: 'Philly Fed Manufacturing Index', forceHighImpact: false };
  }
  if (lower.includes('empire state') && lower.includes('manufacturing')) {
    return { canonicalTitle: 'Empire State Manufacturing Index', forceHighImpact: false };
  }
  if (lower.includes('richmond') && lower.includes('manufacturing')) {
    return { canonicalTitle: 'Richmond Manufacturing Index', forceHighImpact: false };
  }
  if (lower.includes('michigan consumer sentiment')) {
    const isPrel = lower.includes('prel');
    return {
      canonicalTitle: isPrel ? 'Prelim UoM Consumer Sentiment' : 'Revised UoM Consumer Sentiment',
      forceHighImpact: false,
    };
  }
  if (lower.includes('michigan') && lower.includes('inflation expectations')) {
    const isPrel = lower.includes('prel');
    return {
      canonicalTitle: isPrel ? 'Prelim UoM Inflation Expectations' : 'Revised UoM Inflation Expectations',
      forceHighImpact: false,
    };
  }

  return null;
}

/**
 * Matches and enriches calendar events whose scheduled release time has already passed
 * (`isEventReleasedOrImminent(ev.date, nowMs)`) against raw TradingView US Economic Calendar items.
 * Handles both High-Impact and Medium-Impact USD events (including Flash Manufacturing/Services PMI,
 * Unemployment Claims, CB Consumer Confidence, Philly Fed, Empire State, UoM Sentiment, etc.).
 */
export function enrichCalendarEventsWithRawTradingViewActuals(
  events: MacroCalendarEvent[],
  tvEvents: RawTradingViewCalendarEvent[],
  nowMs: number = Date.now()
): MacroCalendarEvent[] {
  if (!Array.isArray(events) || events.length === 0 || !Array.isArray(tvEvents) || tvEvents.length === 0) {
    return events || [];
  }

  const mappedTv = mapRawTradingViewEventsToCalendarEvents(tvEvents, nowMs);
  const byArchiveKey = new Map<string, MacroCalendarEvent>();
  const byCanonicalTitle = new Map<string, MacroCalendarEvent[]>();

  for (const tvEv of mappedTv) {
    if (!tvEv || isPlaceholderMacroValue(tvEv.actual)) continue;
    const key = normalizeActualArchiveKey(tvEv.title, tvEv.date);
    byArchiveKey.set(key, tvEv);
    const cTitle = normalizeCanonicalMacroTitleKey(tvEv.title);
    const list = byCanonicalTitle.get(cTitle) || [];
    list.push(tvEv);
    byCanonicalTitle.set(cTitle, list);
  }

  return events.map((ev) => {
    if (!ev || !isPlaceholderMacroValue(ev.actual)) return ev;
    if (!isEventReleasedOrImminent(ev.date, nowMs)) return ev;

    const evMs = new Date(ev.date).getTime();
    if (!Number.isFinite(evMs)) return ev;

    // 1) Fast path: canonical key + day match or canonical title within 14h on same release day
    const exactKey = normalizeActualArchiveKey(ev.title, ev.date);
    let matchedMapped = byArchiveKey.get(exactKey);
    if (!matchedMapped) {
      const cTitle = normalizeCanonicalMacroTitleKey(ev.title);
      const candidates = byCanonicalTitle.get(cTitle) || [];
      let bestDiff = Infinity;
      for (const cand of candidates) {
        const candMs = new Date(cand.date).getTime();
        if (!Number.isFinite(candMs)) continue;
        const diff = Math.abs(evMs - candMs);
        if (diff <= 14 * 60 * 60 * 1000 && diff < bestDiff) {
          bestDiff = diff;
          matchedMapped = cand;
        }
      }
    }

    if (matchedMapped && !isPlaceholderMacroValue(matchedMapped.actual)) {
      const parsedNum =
        matchedMapped.actualNum !== null && matchedMapped.actualNum !== undefined
          ? matchedMapped.actualNum
          : parseMacroNumeric(matchedMapped.actual).value;
      const evalRes = evaluateSingleEventForGold(
        ev.title,
        parsedNum,
        ev.forecastNum ?? matchedMapped.forecastNum,
        ev.previousNum ?? matchedMapped.previousNum
      );
      return {
        ...ev,
        actual: matchedMapped.actual,
        actualNum: parsedNum,
        unit: ev.unit || matchedMapped.unit,
        eventBiasForGold: evalRes.bias,
        biasReasonId: evalRes.reasonId,
        biasReasonEn: evalRes.reasonEn,
        actualSource: 'TV_ENRICH',
      };
    }

    // 2) Fallback: token + timestamp + previousNum scoring against raw TradingView items
    const ffTitle = ev.title.toLowerCase().trim();
    const stopWords = new Set(['prelim', 'final', 'advance', 'revised', 'us', 'm/m', 'y/y', 'q/q', 'the', 'of']);
    const ffTokens = ffTitle
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !stopWords.has(w));

    let bestRaw: RawTradingViewCalendarEvent | null = null;
    let bestScore = -1;

    for (const raw of tvEvents) {
      if (!raw || raw.actual === null || raw.actual === undefined || !Number.isFinite(Number(raw.actual))) {
        continue;
      }
      const tvMs = new Date(String(raw.date || '')).getTime();
      if (!Number.isFinite(tvMs) || tvMs > nowMs + 2 * 60 * 1000) continue;
      if (Math.abs(tvMs - evMs) > 2 * 60 * 60 * 1000) continue;

      const tvTitle = String(raw.title || '').toLowerCase().trim();
      const tvInd = String(raw.indicator || '').toLowerCase().trim();
      const combinedTv = `${tvTitle} ${tvInd}`;

      let score = 0;
      if (
        ffTitle === 'flash manufacturing pmi' &&
        combinedTv.includes('manufacturing') &&
        combinedTv.includes('pmi') &&
        !combinedTv.includes('ism')
      ) {
        score += 70;
      } else if (
        ffTitle === 'flash services pmi' &&
        combinedTv.includes('services') &&
        combinedTv.includes('pmi') &&
        !combinedTv.includes('ism')
      ) {
        score += 70;
      } else {
        let overlap = 0;
        for (const tok of ffTokens) {
          if (combinedTv.includes(tok)) overlap++;
        }
        if (overlap >= 2) score += overlap * 22;
      }

      if (score <= 0) continue;
      if (Math.abs(tvMs - evMs) <= 15 * 60 * 1000) score += 15;
      if (ev.previousNum !== null && raw.previous !== null && raw.previous !== undefined) {
        const diff = Math.abs(Number(raw.previous) - ev.previousNum);
        if (diff <= 0.1) score += 20;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRaw = raw;
      }
    }

    if (!bestRaw || bestScore < 44) return ev;

    const actualNum = Number(bestRaw.actual);
    const tvUnit = String(bestRaw.unit || '').trim();
    const tvScale = String(bestRaw.scale || '').trim();
    const effectiveUnit =
      ev.unit ||
      (tvUnit === '%' ? '%' : tvScale === 'K' || tvScale === 'M' || tvScale === 'B' ? tvScale : tvUnit);
    const actualStr = `${actualNum}${effectiveUnit}`;
    const evalRes = evaluateSingleEventForGold(ev.title, actualNum, ev.forecastNum, ev.previousNum);

    return {
      ...ev,
      actual: actualStr,
      actualNum,
      unit: effectiveUnit,
      eventBiasForGold: evalRes.bias,
      biasReasonId: evalRes.reasonId,
      biasReasonEn: evalRes.reasonEn,
      actualSource: 'TV_ENRICH',
    };
  });
}

function decodeWireHtmlEntities(raw: string): string {
  return String(raw || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function parseGoogleNewsRssItemsFromXml(xmlText: string): Array<{ title: string; pubDate: string; pubMs: number }> {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const out: Array<{ title: string; pubDate: string; pubMs: number }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1] || '';
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const pubMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    if (!titleMatch || !titleMatch[1]) continue;
    const rawTitle = titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
    const title = decodeWireHtmlEntities(rawTitle).replace(/\s+/g, ' ').trim();
    const pubDate = pubMatch && pubMatch[1] ? pubMatch[1].trim() : '';
    const pubMs = pubDate ? new Date(pubDate).getTime() : NaN;
    if (title) {
      out.push({ title, pubDate, pubMs });
    }
  }
  return out;
}

export function buildGoogleNewsRssQueryForMissingActual(eventTitle: string): string | null {
  const cTitle = normalizeCanonicalMacroTitleKey(eventTitle);
  if (!cTitle) return null;

  if (cTitle === 'flash manufacturing pmi' || cTitle === 'flash services pmi' || cTitle === 'flash composite pmi') {
    return '"Flash Manufacturing PMI" OR "S&P Global Manufacturing PMI" OR "Flash Services PMI" OR "Services PMI" US';
  }
  if (cTitle === 'ism manufacturing pmi' || cTitle === 'ism manufacturing prices') {
    return '"ISM Manufacturing PMI" US';
  }
  if (cTitle === 'ism services pmi' || cTitle === 'ism services prices') {
    return '"ISM Services PMI" US';
  }
  if (cTitle === 'cb consumer confidence') {
    return '"CB Consumer Confidence" OR "Conference Board Consumer Confidence" US';
  }
  if (cTitle.includes('uom consumer sentiment')) {
    return '"Michigan Consumer Sentiment" OR "UoM Consumer Sentiment" US';
  }
  if (cTitle === 'philly fed manufacturing index') {
    return '"Philadelphia Fed Manufacturing" OR "Philly Fed Manufacturing" US';
  }
  if (cTitle === 'empire state manufacturing index') {
    return '"Empire State Manufacturing" US';
  }
  if (cTitle === 'richmond manufacturing index') {
    return '"Richmond Fed Manufacturing" OR "Richmond Manufacturing Index" US';
  }
  if (cTitle === 'chicago pmi') {
    return '"Chicago PMI" US';
  }
  if (cTitle === 'unemployment claims') {
    return '"Initial Jobless Claims" OR "Unemployment Claims" US';
  }
  if (cTitle === 'adp non-farm employment change') {
    return '"ADP Employment" OR "ADP private payrolls" US';
  }
  if (cTitle === 'jolts job openings') {
    return '"JOLTS Job Openings" US';
  }
  if (cTitle.includes('non-farm employment change')) {
    return '"Nonfarm Payrolls" OR "Non-Farm Payrolls" US';
  }
  if (cTitle === 'unemployment rate') {
    return '"US Unemployment Rate"';
  }
  if (cTitle.includes('cpi')) {
    return '"US CPI" OR "US Core CPI" inflation';
  }
  if (cTitle.includes('ppi')) {
    return '"US PPI" OR "Producer Price Index"';
  }
  if (cTitle.includes('pce')) {
    return '"Core PCE" OR "PCE Price Index" US';
  }
  if (cTitle.includes('gdp')) {
    return '"US GDP" growth rate';
  }
  if (cTitle.includes('retail sales')) {
    return '"US Retail Sales"';
  }
  return `"${eventTitle}" US economic`;
}

/**
 * Deterministically extracts and cross-validates the released `Actual` value for a past USD calendar event
 * from financial wire headlines (TradingView News Wire, FXStreet, Reuters, MarketScreener, etc.)
 * when S&P Global or calendar JSON feeds leave the `actual` field null due to licensing restrictions.
 */
export function extractVerifiedActualFromWireHeadlines(
  headlines: Array<{ title: string; pubDate?: string; pubMs?: number }>,
  event: Pick<MacroCalendarEvent, 'title' | 'date' | 'forecastNum' | 'previousNum' | 'unit'>,
  nowMs: number = Date.now()
): { actual: string; actualNum: number } | null {
  if (!event || !Array.isArray(headlines) || headlines.length === 0) return null;
  const evMs = new Date(event.date).getTime();
  // Strictly only extract actuals for events that have already released
  if (!Number.isFinite(evMs) || evMs > nowMs - 30 * 1000) return null;

  const cTitle = normalizeCanonicalMacroTitleKey(event.title);
  const refNum = event.forecastNum ?? event.previousNum;
  const unit = String(event.unit || '').trim();

  const isPlausibleValue = (val: number): boolean => {
    if (!Number.isFinite(val)) return false;
    if (cTitle.includes('pmi')) {
      if (val < 25 || val > 80) return false;
    } else if (cTitle === 'cb consumer confidence' || cTitle.includes('uom consumer sentiment')) {
      if (val < 35 || val > 160) return false;
    }
    if (refNum !== null && refNum !== undefined && Number.isFinite(refNum)) {
      const maxDelta =
        cTitle.includes('manufacturing index')
          ? 35
          : Math.max(12, Math.abs(refNum) * 0.45);
      if (Math.abs(val - refNum) > maxDelta) return false;
    }
    return true;
  };

  const candidates: number[] = [];

  for (const item of headlines) {
    const headline = decodeWireHtmlEntities(String(item.title || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!headline) continue;
    const lower = headline.toLowerCase();

    // Must be published around or after the scheduled release time (evMs - 5m .. evMs + 48h)
    const pubMs =
      typeof item.pubMs === 'number' && Number.isFinite(item.pubMs)
        ? item.pubMs
        : item.pubDate
        ? new Date(item.pubDate).getTime()
        : NaN;
    if (!Number.isFinite(pubMs) || pubMs < evMs - 5 * 60 * 1000 || pubMs > evMs + 48 * 60 * 60 * 1000) {
      continue;
    }

    // Reject foreign country PMI/macro headlines
    if (
      /\b(germany|german|uk|united kingdom|britain|eurozone|euro area|france|french|australia|australian|japan|japanese|canada|canadian|china|chinese|india|indian|spain|italy)\b/i.test(
        lower
      )
    ) {
      continue;
    }

    // Reject pre-release preview headlines that have no actual report
    if (/\b(expected to|preview|due today|ahead of|what to expect)\b/i.test(lower) && !/\bvs\.?\b/i.test(lower)) {
      continue;
    }

    let extracted: number | null = null;

    if (cTitle === 'flash manufacturing pmi' || cTitle === 'ism manufacturing pmi') {
      const wantIsm = cTitle === 'ism manufacturing pmi';
      if (wantIsm !== lower.includes('ism')) continue;
      if (!lower.includes('manufacturing')) continue;

      const patterns = [
        /manufacturing\s+pmi(?:\s+flash)?\s+(?:at|to|of|is|stands\s+at|retreats\s+to|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|edges\s+up\s+to|comes\s+in\s+at|hits|reaches|holds\s+at)?\s*(\d{2}(?:\.\d{1,2})?)/i,
        /(\d{2}(?:\.\d{1,2})?)\s*:\s*(?:u\.?s\.?|us)\s+(?:s&p\s+(?:global\s+)?)?(?:flash\s+)?manufacturing\s+pmi/i,
        /flash\s+(?:u\.?s\.?|us)\s+manufacturing\s+pmi\s+(\d{2}(?:\.\d{1,2})?)/i,
      ];
      for (const rx of patterns) {
        const m = headline.match(rx);
        if (m && m[1]) {
          const val = Number(m[1]);
          if (isPlausibleValue(val)) {
            extracted = val;
            break;
          }
        }
      }
    } else if (cTitle === 'flash services pmi' || cTitle === 'ism services pmi') {
      const wantIsm = cTitle === 'ism services pmi';
      if (wantIsm !== lower.includes('ism')) continue;
      if (!lower.includes('services')) continue;

      const patterns = [
        /services\s+pmi(?:\s+flash)?\s+(?:at|to|of|is|stands\s+at|retreats\s+to|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|edges\s+up\s+to|comes\s+in\s+at|hits|reaches|holds\s+at)?\s*(\d{2}(?:\.\d{1,2})?)/i,
        /(\d{2}(?:\.\d{1,2})?)\s*:\s*(?:u\.?s\.?|us)\s+(?:s&p\s+(?:global\s+)?)?(?:flash\s+)?services\s+pmi/i,
        /flash\s+(?:u\.?s\.?|us)\s+services\s+pmi\s+(\d{2}(?:\.\d{1,2})?)/i,
      ];
      for (const rx of patterns) {
        const m = headline.match(rx);
        if (m && m[1]) {
          const val = Number(m[1]);
          if (isPlausibleValue(val)) {
            extracted = val;
            break;
          }
        }
      }
    } else if (cTitle === 'flash composite pmi') {
      if (!lower.includes('composite') || !lower.includes('pmi')) continue;
      const m = headline.match(
        /composite\s+pmi(?:\s+flash)?\s+(?:at|to|of|is|retreats\s+to|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|comes\s+in\s+at|hits|reaches)?\s*(\d{2}(?:\.\d{1,2})?)/i
      );
      if (m && m[1] && isPlausibleValue(Number(m[1]))) {
        extracted = Number(m[1]);
      }
    } else if (cTitle === 'cb consumer confidence') {
      if (!lower.includes('consumer confidence')) continue;
      const m = headline.match(
        /consumer\s+confidence(?:\s+index)?\s+(?:at|to|of|is|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|jumps\s+to|comes\s+in\s+at|hits|reaches)?\s*(\d{2,3}(?:\.\d{1,2})?)/i
      );
      if (m && m[1] && isPlausibleValue(Number(m[1]))) {
        extracted = Number(m[1]);
      }
    } else if (cTitle.includes('uom consumer sentiment')) {
      if (!lower.includes('consumer sentiment')) continue;
      const m = headline.match(
        /consumer\s+sentiment(?:\s+index)?\s+(?:at|to|of|is|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|comes\s+in\s+at|hits|reaches)?\s*(\d{2,3}(?:\.\d{1,2})?)/i
      );
      if (m && m[1] && isPlausibleValue(Number(m[1]))) {
        extracted = Number(m[1]);
      }
    } else if (cTitle === 'chicago pmi') {
      if (!lower.includes('chicago pmi')) continue;
      const m = headline.match(
        /chicago\s+pmi\s+(?:at|to|of|is|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|comes\s+in\s+at|hits|reaches)?\s*(\d{2}(?:\.\d{1,2})?)/i
      );
      if (m && m[1] && isPlausibleValue(Number(m[1]))) {
        extracted = Number(m[1]);
      }
    } else if (
      cTitle === 'philly fed manufacturing index' ||
      cTitle === 'empire state manufacturing index' ||
      cTitle === 'richmond manufacturing index'
    ) {
      const hasMatchTopic =
        (cTitle.includes('philly') && (lower.includes('philly fed') || lower.includes('philadelphia fed'))) ||
        (cTitle.includes('empire') && lower.includes('empire state')) ||
        (cTitle.includes('richmond') && lower.includes('richmond'));
      if (!hasMatchTopic) continue;
      const m = headline.match(
        /(?:manufacturing\s+index|business\s+index|fed\s+index)\s+(?:at|to|of|is|falls\s+to|drops\s+to|slips\s+to|declines\s+to|rises\s+to|climbs\s+to|jumps\s+to|comes\s+in\s+at|hits|reaches)?\s*(-?\d{1,2}(?:\.\d{1,2})?)/i
      );
      if (m && m[1] && isPlausibleValue(Number(m[1]))) {
        extracted = Number(m[1]);
      }
    } else if (cTitle === 'unemployment rate') {
      if (!lower.includes('unemployment rate')) continue;
      const m = headline.match(
        /unemployment\s+rate\s+(?:at|to|of|is|holds\s+at|stays\s+at|falls\s+to|drops\s+to|ticks\s+down\s+to|rises\s+to|ticks\s+up\s+to|climbs\s+to|comes\s+in\s+at)?\s*(\d(?:\.\d{1,2})?)%/i
      );
      if (m && m[1] && isPlausibleValue(Number(m[1]))) {
        extracted = Number(m[1]);
      }
    } else if (cTitle === 'unemployment claims') {
      if (!lower.includes('jobless claims') && !lower.includes('unemployment claims')) continue;
      const m = headline.match(
        /(?:initial\s+jobless\s+claims|unemployment\s+claims)\s+(?:at|to|of|is|fall\s+to|drop\s+to|decline\s+to|rise\s+to|climb\s+to|come\s+in\s+at|total)?\s*(\d{3}(?:\.\d)?)\s*k\b/i
      );
      if (m && m[1] && isPlausibleValue(Number(m[1]))) {
        extracted = Number(m[1]);
      }
    }

    if (extracted !== null) {
      candidates.push(extracted);
    }
  }

  if (candidates.length === 0) return null;

  // Pick mode (consensus across independent financial wires)
  const counts = new Map<number, number>();
  let bestVal = candidates[0];
  let bestCount = 0;
  for (const val of candidates) {
    const c = (counts.get(val) || 0) + 1;
    counts.set(val, c);
    if (c > bestCount) {
      bestCount = c;
      bestVal = val;
    }
  }

  const formattedNum = Number.isInteger(bestVal) ? bestVal.toFixed(1) : String(bestVal);
  const actualStr = unit ? `${bestVal}${unit}` : cTitle.includes('pmi') ? formattedNum : `${bestVal}`;

  return {
    actual: actualStr,
    actualNum: bestVal,
  };
}

/**
 * Converts raw TradingView US Economic Calendar items (already released) into canonical
 * `MacroCalendarEvent[]` entries for 0-token 90-day offline archive backfill.
 */
export function mapRawTradingViewEventsToCalendarEvents(
  rawEvents: RawTradingViewCalendarEvent[],
  nowMs: number = Date.now()
): MacroCalendarEvent[] {
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) return [];

  const out: MacroCalendarEvent[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < rawEvents.length; i++) {
    const raw = rawEvents[i];
    if (!raw || raw.actual === null || raw.actual === undefined || !Number.isFinite(Number(raw.actual))) {
      continue;
    }
    const country = String(raw.country || 'US').toUpperCase().trim();
    if (country !== 'US' && country !== 'USD') continue;

    const dt = new Date(String(raw.date || ''));
    const evMs = dt.getTime();
    if (!Number.isFinite(evMs) || evMs > nowMs + 2 * 60 * 1000) continue;

    const mapped = mapTradingViewTitleToCanonical(String(raw.title || ''));
    if (!mapped) continue;

    const isoDate = dt.toISOString();
    const dedupeKey = normalizeActualArchiveKey(mapped.canonicalTitle, isoDate);
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const tvUnit = String(raw.unit || '').trim();
    const tvScale = String(raw.scale || '').trim();
    const effectiveUnit =
      tvUnit === '%'
        ? '%'
        : tvScale === 'K' || tvScale === 'M' || tvScale === 'B'
        ? tvScale
        : tvUnit;

    const formatNumber = (val: number | null | undefined): { text: string; num: number | null; unit: string } => {
      if (val === null || val === undefined || !Number.isFinite(Number(val))) {
        return { text: '—', num: null, unit: effectiveUnit };
      }
      let num = Number(val);
      let u = effectiveUnit;
      const isKSeries = /employment|payrolls|claims/i.test(mapped.canonicalTitle);
      if (isKSeries && !u && Math.abs(num) >= 1000) {
        num = Number((num / 1000).toFixed(1));
        u = 'K';
      }
      return {
        text: `${num}${u}`,
        num,
        unit: u,
      };
    };

    const actParsed = formatNumber(raw.actual);
    const fcstParsed = formatNumber(raw.forecast);
    const prevParsed = formatNumber(raw.previous);
    const finalUnit = actParsed.unit || fcstParsed.unit || prevParsed.unit || '';

    const impact: 'High' | 'Medium' =
      mapped.forceHighImpact || Number(raw.importance) >= 1 ? 'High' : 'Medium';

    const evalRes = evaluateSingleEventForGold(
      mapped.canonicalTitle,
      actParsed.num,
      fcstParsed.num,
      prevParsed.num
    );

    const eventCategory: MacroCalendarEvent['eventCategory'] = isPrimaryHighImpactEvent({
      title: mapped.canonicalTitle,
      impact,
      country: 'USD',
    })
      ? 'PRIMARY_HIGH_IMPACT'
      : 'SUPPORTING_REFERENCE';

    out.push({
      id: `tv-hist-${String(raw.id || i)}-${mapped.canonicalTitle.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`,
      title: mapped.canonicalTitle,
      country: 'USD',
      date: isoDate,
      impact,
      previous: prevParsed.text,
      forecast: fcstParsed.text,
      actual: actParsed.text,
      previousNum: prevParsed.num,
      forecastNum: fcstParsed.num,
      actualNum: actParsed.num,
      unit: finalUnit,
      pillar: classifyFomcPillar(mapped.canonicalTitle),
      isInverseIndicator: isInverseUsdIndicator(mapped.canonicalTitle),
      eventBiasForGold: evalRes.bias,
      biasReasonId: evalRes.reasonId,
      biasReasonEn: evalRes.reasonEn,
      isLiveFeed: true,
      eventCategory,
      actualSource: 'TV_ENRICH',
    });
  }

  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Hydrates incoming calendar events from the Offline Actuals Archive:
 * 1) Strips any leaked/unreleased `actual` on future events (> nowMs + 2m).
 * 2) Restores missing/blank past `actual` values on matching current-week events that have already released.
 * 3) Re-attaches prior-week/prior-month released High-Impact USD events (default 90 days) and recent
 *    Medium-Impact USD events (last 30 days) that rolled off `ff_calendar_thisweek.json`.
 */
export function hydrateEventsWithOfflineArchive(
  events: MacroCalendarEvent[],
  nowMs: number = Date.now(),
  archiveOverride?: ArchivedMacroActualRecord[],
  retentionDays: number = 90
): MacroCalendarEvent[] {
  const sanitizedInput = sanitizeUnreleasedCalendarEventActuals(events || [], nowMs);
  const archive = archiveOverride ?? loadOfflineActualsArchive();
  if (!archive || archive.length === 0) return sanitizedInput;

  const exactMap = new Map<string, ArchivedMacroActualRecord>();
  const byTitle = new Map<string, ArchivedMacroActualRecord[]>();
  for (const r of archive) {
    if (!r || isPlaceholderMacroValue(r.actual)) continue;
    if (!isEventReleasedOrImminent(r.date, nowMs)) continue;
    const normalizedKey = normalizeActualArchiveKey(r.title, r.date);
    exactMap.set(normalizedKey, r);
    exactMap.set(r.archiveKey, r);
    const tKey = normalizeCanonicalMacroTitleKey(r.title);
    const arr = byTitle.get(tKey) || [];
    arr.push(r);
    byTitle.set(tKey, arr);
  }

  const findArchiveMatch = (title: string, dateIso: string): ArchivedMacroActualRecord | undefined => {
    const evMs = new Date(dateIso).getTime();
    // Strictly forbid matching archive actuals onto future unreleased events
    if (!Number.isFinite(evMs) || !isEventReleasedOrImminent(dateIso, nowMs)) return undefined;

    const exact = exactMap.get(normalizeActualArchiveKey(title, dateIso));
    if (exact) return exact;

    const candidates = byTitle.get(normalizeCanonicalMacroTitleKey(title)) || [];
    let best: ArchivedMacroActualRecord | undefined;
    let bestDiff = Infinity;
    for (const cand of candidates) {
      const candMs = new Date(cand.date).getTime();
      if (!Number.isFinite(candMs) || !isEventReleasedOrImminent(cand.date, nowMs)) continue;
      const diff = Math.abs(evMs - candMs);
      // Allow up to 14 hours for minor timezone/feed schedule differences on the same release day
      if (diff <= 14 * 60 * 60 * 1000 && diff < bestDiff) {
        bestDiff = diff;
        best = cand;
      }
    }
    return best;
  };

  const hydratedKeys = new Set<string>();
  const hydratedEvents: MacroCalendarEvent[] = sanitizedInput.map((ev) => {
    const key = normalizeActualArchiveKey(ev.title, ev.date);
    hydratedKeys.add(key);

    if (!isEventReleasedOrImminent(ev.date, nowMs)) {
      return ev;
    }

    if (!isPlaceholderMacroValue(ev.actual)) {
      return ev;
    }

    const match = findArchiveMatch(ev.title, ev.date);
    if (!match) return ev;

    hydratedKeys.add(match.archiveKey);
    hydratedKeys.add(normalizeActualArchiveKey(match.title, match.date));
    const parsedNum =
      match.actualNum !== null && match.actualNum !== undefined
        ? match.actualNum
        : parseMacroNumeric(match.actual).value;
    const evalRes = evaluateSingleEventForGold(
      ev.title,
      parsedNum,
      ev.forecastNum ?? match.forecastNum,
      ev.previousNum ?? match.previousNum
    );

    return {
      ...ev,
      actual: match.actual,
      actualNum: parsedNum,
      unit: match.unit || ev.unit,
      eventBiasForGold: evalRes.bias,
      biasReasonId: evalRes.reasonId,
      biasReasonEn: evalRes.reasonEn,
      actualSource: 'OFFLINE_ARCHIVE',
    };
  });

  // Re-attach prior-week & prior-month released events missing from current feed
  const RETENTION_MS = retentionDays * 24 * 60 * 60 * 1000;
  const MEDIUM_RETENTION_MS = Math.min(RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
  for (const rec of archive) {
    const recCanonicalKey = normalizeActualArchiveKey(rec.title, rec.date);
    if (hydratedKeys.has(rec.archiveKey) || hydratedKeys.has(recCanonicalKey)) continue;
    const recMs = new Date(rec.date).getTime();
    if (!Number.isFinite(recMs) || !isEventReleasedOrImminent(rec.date, nowMs)) {
      continue;
    }
    const recCanonicalTitle = normalizeCanonicalMacroTitleKey(rec.title);
    const alreadyPresentByTitleWindow = hydratedEvents.some((ev) => {
      if (normalizeCanonicalMacroTitleKey(ev.title) !== recCanonicalTitle) return false;
      const evMs = new Date(ev.date).getTime();
      return Number.isFinite(evMs) && Math.abs(evMs - recMs) <= 36 * 60 * 60 * 1000;
    });
    if (alreadyPresentByTitleWindow) continue;

    const isHighOrPrimary =
      rec.impact === 'High' ||
      rec.eventCategory === 'PRIMARY_HIGH_IMPACT' ||
      isPrimaryHighImpactEvent({ title: rec.title, impact: rec.impact, country: 'USD' });
    const ageMs = nowMs - recMs;
    if (isHighOrPrimary) {
      if (ageMs > RETENTION_MS) continue;
    } else if (rec.impact === 'Medium') {
      if (ageMs > MEDIUM_RETENTION_MS) continue;
    } else {
      continue;
    }

    const evalRes = evaluateSingleEventForGold(
      rec.title,
      rec.actualNum,
      rec.forecastNum,
      rec.previousNum
    );
    hydratedEvents.push({
      id: rec.id || `ff-arch-${rec.archiveKey.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`,
      title: rec.title,
      country: 'USD',
      date: rec.date,
      impact: rec.impact,
      previous: rec.previous || '—',
      forecast: rec.forecast || '—',
      actual: rec.actual,
      previousNum: rec.previousNum,
      forecastNum: rec.forecastNum,
      actualNum: rec.actualNum,
      unit: rec.unit || '',
      pillar: rec.pillar || classifyFomcPillar(rec.title),
      isInverseIndicator: rec.isInverseIndicator,
      eventBiasForGold: evalRes.bias,
      biasReasonId: evalRes.reasonId,
      biasReasonEn: evalRes.reasonEn,
      isLiveFeed: true,
      eventCategory:
        rec.eventCategory ||
        (isPrimaryHighImpactEvent({ title: rec.title, impact: rec.impact, country: 'USD' })
          ? 'PRIMARY_HIGH_IMPACT'
          : 'SUPPORTING_REFERENCE'),
      isOfflineArchived: true,
      actualSource: 'OFFLINE_ARCHIVE',
    });
    hydratedKeys.add(rec.archiveKey);
    hydratedKeys.add(recCanonicalKey);
  }

  return hydratedEvents.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

export function loadPreNewsLockArchive(): Record<string, PreNewsSystemState> {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          inMemoryPreNewsLocks = parsed;
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
  }
  return inMemoryPreNewsLocks;
}

export function savePreNewsLockArchive(map: Record<string, PreNewsSystemState>): void {
  const entries = Object.entries(map).slice(-60);
  const pruned = Object.fromEntries(entries);
  inMemoryPreNewsLocks = pruned;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY, JSON.stringify(pruned));
      dispatchMacroLocalSyncEvent();
    } catch {
      // ignore storage quota errors
    }
  }
}

export function loadPostNewsArchive(): Record<string, PostNewsSystemState> {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(MACRO_POST_NEWS_ARCHIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          inMemoryPostNewsLocks = parsed;
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
  }
  return inMemoryPostNewsLocks;
}

export function savePostNewsArchive(map: Record<string, PostNewsSystemState>): void {
  const entries = Object.entries(map).slice(-250);
  const pruned = Object.fromEntries(entries);
  inMemoryPostNewsLocks = pruned;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MACRO_POST_NEWS_ARCHIVE_STORAGE_KEY_COMPAT, JSON.stringify(pruned));
      dispatchMacroLocalSyncEvent();
    } catch {
      // ignore storage quota errors
    }
  }
}

const MACRO_POST_NEWS_ARCHIVE_STORAGE_KEY_COMPAT = MACRO_POST_NEWS_ARCHIVE_KEY;

/**
 * Returns ALL released/archived USD actual calendar events across months (NEVER reset at month turnover),
 * sorted newest-first for the dedicated Post-News workspace.
 */
export function getAllOfflineActualCalendarEvents(
  liveEvents: MacroCalendarEvent[] = [],
  nowMs: number = Date.now(),
  archiveOverride?: ArchivedMacroActualRecord[]
): MacroCalendarEvent[] {
  const archive = archiveOverride ?? loadOfflineActualsArchive();
  const byKey = new Map<string, MacroCalendarEvent>();

  for (const ev of liveEvents) {
    if (!ev || isFedSpeechEvent(ev.title)) continue;
    const evMs = new Date(ev.date).getTime();
    const isPast = Number.isFinite(evMs) && evMs <= nowMs + 2 * 60 * 1000;
    if (!isPast) continue;
    const key = normalizeActualArchiveKey(ev.title, ev.date);
    byKey.set(key, ev);
  }

  for (const rec of archive) {
    if (!rec || isPlaceholderMacroValue(rec.actual) || isFedSpeechEvent(rec.title)) continue;
    if (!isEventReleasedOrImminent(rec.date, nowMs)) continue;
    const key = normalizeActualArchiveKey(rec.title, rec.date);
    const existing = byKey.get(key);
    if (existing && !isPlaceholderMacroValue(existing.actual)) continue;

    const evalRes = evaluateSingleEventForGold(
      rec.title,
      rec.actualNum,
      rec.forecastNum,
      rec.previousNum
    );
    byKey.set(key, {
      id: existing?.id || rec.id || `ff-arch-${rec.archiveKey.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`,
      title: rec.title,
      country: 'USD',
      date: rec.date,
      impact: rec.impact,
      previous: existing?.previous && existing.previous !== '—' ? existing.previous : rec.previous || '—',
      forecast: existing?.forecast && existing.forecast !== '—' ? existing.forecast : rec.forecast || '—',
      actual: rec.actual,
      previousNum: existing?.previousNum ?? rec.previousNum,
      forecastNum: existing?.forecastNum ?? rec.forecastNum,
      actualNum: rec.actualNum,
      unit: rec.unit || existing?.unit || '',
      pillar: rec.pillar || classifyFomcPillar(rec.title),
      isInverseIndicator: rec.isInverseIndicator,
      eventBiasForGold: evalRes.bias,
      biasReasonId: evalRes.reasonId,
      biasReasonEn: evalRes.reasonEn,
      isLiveFeed: true,
      eventCategory:
        rec.eventCategory ||
        existing?.eventCategory ||
        (isPrimaryHighImpactEvent({ title: rec.title, impact: rec.impact, country: 'USD' })
          ? 'PRIMARY_HIGH_IMPACT'
          : 'SUPPORTING_REFERENCE'),
      isOfflineArchived: true,
      actualSource: rec.actualSource || 'OFFLINE_ARCHIVE',
    });
  }

  return Array.from(byKey.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Returns the YYYY-MM month key in WIB (UTC+7 / Asia/Jakarta).
 */
export function getWibMonthKey(tsMs: number = Date.now()): string {
  const safeMs = Number.isFinite(tsMs) ? tsMs : Date.now();
  const wibDate = new Date(safeMs + 7 * 60 * 60 * 1000);
  const year = wibDate.getUTCFullYear();
  const month = String(wibDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeMonthlyHeadlineKey(item: BreakingNewsHeadline): string {
  const cleanTitle = String(item.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const cleanSource = String(item.source || '').toLowerCase().trim();
  return `${cleanSource}|${cleanTitle}`;
}

/**
 * Loads the 1-calendar-month Offline Archive for Breaking News & Fed Speeches (System 3).
 * Automatically resets when entering a new WIB calendar month (`YYYY-MM` rollover).
 */
export function loadMonthlyNewsSpeechArchive(
  nowMs: number = Date.now()
): MonthlyNewsSpeechArchive {
  const currentMonthKey = getWibMonthKey(nowMs);
  const emptyArchive: MonthlyNewsSpeechArchive = {
    monthKey: currentMonthKey,
    updatedAt: new Date(nowMs).toISOString(),
    items: [],
  };

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MonthlyNewsSpeechArchive;
        if (parsed && parsed.monthKey === currentMonthKey && Array.isArray(parsed.items)) {
          inMemoryMonthlyNewsSpeechArchive = parsed;
          return parsed;
        }
        // Calendar month rolled over -> reset archive cleanly for the new month
        inMemoryMonthlyNewsSpeechArchive = emptyArchive;
        localStorage.setItem(MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY, JSON.stringify(emptyArchive));
        return emptyArchive;
      }
    } catch {
      // ignore storage parse failure
    }
  }

  if (
    inMemoryMonthlyNewsSpeechArchive &&
    inMemoryMonthlyNewsSpeechArchive.monthKey === currentMonthKey
  ) {
    return inMemoryMonthlyNewsSpeechArchive;
  }
  inMemoryMonthlyNewsSpeechArchive = emptyArchive;
  return emptyArchive;
}

export function saveMonthlyNewsSpeechArchive(archive: MonthlyNewsSpeechArchive): void {
  const sortedItems = [...(archive.items || [])]
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
    .slice(0, 400);
  const next: MonthlyNewsSpeechArchive = {
    monthKey: archive.monthKey,
    updatedAt: archive.updatedAt || new Date().toISOString(),
    items: sortedItems,
  };
  inMemoryMonthlyNewsSpeechArchive = next;

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY, JSON.stringify(next));
      dispatchMacroLocalSyncEvent();
    } catch {
      // ignore storage quota errors
    }
  }
}

export function mergeBreakingHeadlinesForPulse(
  primary: BreakingNewsHeadline[] = [],
  archiveItems: BreakingNewsHeadline[] = []
): BreakingNewsHeadline[] {
  const deduped = new Map<string, BreakingNewsHeadline>();
  for (const h of [...(primary || []), ...(archiveItems || [])]) {
    if (!h || !h.title) continue;
    const key = normalizeMonthlyHeadlineKey(h);
    const prev = deduped.get(key);
    if (!prev || new Date(h.pubDate).getTime() > new Date(prev.pubDate).getTime()) {
      deduped.set(key, h);
    }
  }
  return Array.from(deduped.values()).sort(
    (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );
}

/**
 * Immediately saves incoming Breaking News & Fed Speeches offline for the active calendar month.
 * Items from prior calendar months are NOT carried over once the new month begins.
 */
export function recordBreakingNewsToMonthlyArchive(
  incomingHeadlines: BreakingNewsHeadline[],
  nowMs: number = Date.now()
): MonthlyNewsSpeechArchive {
  const currentMonthKey = getWibMonthKey(nowMs);
  const base = loadMonthlyNewsSpeechArchive(nowMs);
  const map = new Map<string, BreakingNewsHeadline>();

  for (const item of base.items) {
    if (!item || !item.title) continue;
    const pubMs = new Date(item.pubDate).getTime();
    if (Number.isFinite(pubMs) && getWibMonthKey(pubMs) !== currentMonthKey) continue;
    map.set(normalizeMonthlyHeadlineKey(item), item);
  }

  for (const item of incomingHeadlines || []) {
    if (!item || !item.title) continue;
    const pubMs = new Date(item.pubDate).getTime();
    const effectivePubDate = Number.isFinite(pubMs)
      ? item.pubDate
      : new Date(nowMs).toISOString();
    const effectiveMonthKey = Number.isFinite(pubMs) ? getWibMonthKey(pubMs) : currentMonthKey;

    // Do not back-import prior-month headlines after monthly reset
    if (effectiveMonthKey !== currentMonthKey) continue;

    const ctx = evaluateBreakingHeadlineContext(
      item.title,
      undefined,
      item.matchedKeywords || []
    );
    const enriched: BreakingNewsHeadline =
      ctx.sentimentForGold !== 'NEUTRAL'
        ? {
            ...item,
            pubDate: effectivePubDate,
            impact: ctx.impact,
            sentimentForGold: ctx.sentimentForGold,
            channelType: ctx.channelType,
            aiEvaluationId: ctx.aiEvaluationId,
            aiEvaluationEn: ctx.aiEvaluationEn,
          }
        : {
            ...item,
            pubDate: effectivePubDate,
          };

    const key = normalizeMonthlyHeadlineKey(enriched);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, enriched);
    } else if (
      existing.sentimentForGold === 'NEUTRAL' &&
      enriched.sentimentForGold !== 'NEUTRAL'
    ) {
      map.set(key, enriched);
    }
  }

  const next: MonthlyNewsSpeechArchive = {
    monthKey: currentMonthKey,
    updatedAt: new Date(nowMs).toISOString(),
    items: Array.from(map.values())
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, 400),
  };
  saveMonthlyNewsSpeechArchive(next);
  return next;
}

function computePreReleaseBaselineEvents(
  allCalendarEvents: MacroCalendarEvent[],
  clusterIds: Set<string>
): MacroCalendarEvent[] {
  return allCalendarEvents.map((ev) => {
    if (!clusterIds.has(ev.id)) return ev;
    const evalPre = evaluateSingleEventForGold(ev.title, null, ev.forecastNum, ev.previousNum);
    return {
      ...ev,
      actual: '',
      actualNum: null,
      eventBiasForGold: evalPre.bias,
      biasReasonId: evalPre.reasonId,
      biasReasonEn: evalPre.reasonEn,
    };
  });
}

function buildClusterKey(primaryEv: MacroCalendarEvent): string {
  const cleanTitle = (primaryEv.title || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const hourIso = String(primaryEv.date || '').slice(0, 13);
  return `${cleanTitle}|${hourIso}`;
}

function isPreNewsStateSemanticallyEqual(
  a: PreNewsSystemState | undefined,
  b: PreNewsSystemState
): boolean {
  if (!a) return false;
  return (
    a.clusterKey === b.clusterKey &&
    a.primaryEventId === b.primaryEventId &&
    a.primaryTitle === b.primaryTitle &&
    a.releaseDateIso === b.releaseDateIso &&
    a.phase === b.phase &&
    a.isLocked === b.isLocked &&
    a.forecast === b.forecast &&
    a.previous === b.previous &&
    a.buyProbability === b.buyProbability &&
    a.sellProbability === b.sellProbability &&
    a.mixedProbability === b.mixedProbability &&
    a.dominantBias === b.dominantBias &&
    a.thesisId === b.thesisId &&
    a.thesisEn === b.thesisEn
  );
}

function isPostNewsStateSemanticallyEqual(
  a: PostNewsSystemState | undefined,
  b: PostNewsSystemState
): boolean {
  if (!a) return false;
  return (
    a.clusterKey === b.clusterKey &&
    a.primaryEventId === b.primaryEventId &&
    a.primaryTitle === b.primaryTitle &&
    a.releaseDateIso === b.releaseDateIso &&
    a.status === b.status &&
    a.hasVerifiedActual === b.hasVerifiedActual &&
    a.actualSummary === b.actualSummary &&
    a.buyProbability === b.buyProbability &&
    a.sellProbability === b.sellProbability &&
    a.mixedProbability === b.mixedProbability &&
    a.dominantBias === b.dominantBias &&
    a.shiftVsPreNews === b.shiftVsPreNews &&
    a.buyDeltaVsPreNews === b.buyDeltaVsPreNews &&
    a.sellDeltaVsPreNews === b.sellDeltaVsPreNews
  );
}

export function resolveSystem1PreNewsState(params: {
  primaryEvent: MacroCalendarEvent;
  simultaneousEvents: MacroCalendarEvent[];
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: MacroNewsSnapshot['intermarketPulse'];
  breakingNews: BreakingNewsHeadline[];
  cmeFedWatch?: CmeFedWatchState;
  currentMatrix: PreNewsScenarioMatrix;
  nowMs?: number;
  archiveOverride?: Record<string, PreNewsSystemState>;
}): PreNewsSystemState {
  const {
    primaryEvent,
    simultaneousEvents,
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch,
    currentMatrix,
    nowMs = Date.now(),
    archiveOverride,
  } = params;

  const clusterEvents = [primaryEvent, ...simultaneousEvents];
  const clusterKey = buildClusterKey(primaryEvent);
  const targetMs = new Date(primaryEvent.date).getTime();
  const isReleasedByClock = Number.isFinite(targetMs) && nowMs >= targetMs;
  const hasActual =
    isReleasedByClock && clusterEvents.some((e) => !isPlaceholderMacroValue(e.actual));
  const remainingMs = Number.isFinite(targetMs) ? targetMs - nowMs : 0;
  const isLockedT5M = !isReleasedByClock && !hasActual && remainingMs > 0 && remainingMs <= 5 * 60 * 1000;

  const archive = archiveOverride ?? { ...loadPreNewsLockArchive() };
  const existing = archive[clusterKey];

  // If release already happened or actual already landed, keep Pre-News permanently OFF / frozen
  if (isReleasedByClock || hasActual) {
    if (existing) {
      if (existing.phase !== 'OFF_RELEASED' || !existing.isLocked) {
        const finalized: PreNewsSystemState = {
          ...existing,
          phase: 'OFF_RELEASED',
          isLocked: true,
          lockedAt: existing.lockedAt || new Date(nowMs).toISOString(),
        };
        archive[clusterKey] = finalized;
        if (!archiveOverride) savePreNewsLockArchive(archive);
        return finalized;
      }
      return existing;
    }

    // Reconstruct deterministic Pre-News baseline (Forecast vs Previous, strictly without Actual)
    const clusterIdSet = new Set(clusterEvents.map((e) => e.id));
    const preEvents = computePreReleaseBaselineEvents(calendarEvents, clusterIdSet);
    const preSnap = computeDeterministicMacroSnapshot({
      calendarEvents: preEvents,
      intermarketPulse,
      breakingNews,
      cmeFedWatch,
      selectedEventId: primaryEvent.id,
      sourceMode: 'RULE_BASED_FALLBACK',
      modelUsed: 'system1-prenews-baseline',
    });
    const m = preSnap.scenarioMatrix;
    const finalized: PreNewsSystemState = {
      clusterKey,
      primaryEventId: primaryEvent.id,
      primaryTitle: clusterEvents.map((e) => e.title).join(' & '),
      releaseDateIso: primaryEvent.date,
      phase: 'OFF_RELEASED',
      isLocked: true,
      lockedAt: new Date(nowMs).toISOString(),
      forecast: primaryEvent.forecast || '—',
      previous: primaryEvent.previous || '—',
      buyProbability: m.buyProbability,
      sellProbability: m.sellProbability,
      mixedProbability: m.mixedProbability,
      dominantBias: m.dominantBias,
      thesisId: m.finalTakeId,
      thesisEn: m.finalTakeEn,
      reconstructedWithoutPreCapture: true,
    };
    archive[clusterKey] = finalized;
    if (!archiveOverride && !isPreNewsStateSemanticallyEqual(existing, finalized)) {
      savePreNewsLockArchive(archive);
    }
    return finalized;
  }

  // Inside T-5M Final Lock: capture once and hold frozen until release
  if (isLockedT5M) {
    if (existing && existing.phase === 'T5M_LOCKED' && existing.isLocked) {
      return existing;
    }
    const locked: PreNewsSystemState = {
      clusterKey,
      primaryEventId: primaryEvent.id,
      primaryTitle: clusterEvents.map((e) => e.title).join(' & '),
      releaseDateIso: primaryEvent.date,
      phase: 'T5M_LOCKED',
      isLocked: true,
      lockedAt: new Date(nowMs).toISOString(),
      forecast: primaryEvent.forecast || '—',
      previous: primaryEvent.previous || '—',
      buyProbability: currentMatrix.buyProbability,
      sellProbability: currentMatrix.sellProbability,
      mixedProbability: currentMatrix.mixedProbability,
      dominantBias: currentMatrix.dominantBias,
      thesisId: currentMatrix.finalTakeId,
      thesisEn: currentMatrix.finalTakeEn,
    };
    archive[clusterKey] = locked;
    if (!archiveOverride && !isPreNewsStateSemanticallyEqual(existing, locked)) {
      savePreNewsLockArchive(archive);
    }
    return locked;
  }

  // > T-5M before release: Pre-News is ACTIVE and tracks live consensus + intermarket
  const active: PreNewsSystemState = {
    clusterKey,
    primaryEventId: primaryEvent.id,
    primaryTitle: clusterEvents.map((e) => e.title).join(' & '),
    releaseDateIso: primaryEvent.date,
    phase: 'PRE_ACTIVE',
    isLocked: false,
    lockedAt: null,
    forecast: primaryEvent.forecast || '—',
    previous: primaryEvent.previous || '—',
    buyProbability: currentMatrix.buyProbability,
    sellProbability: currentMatrix.sellProbability,
    mixedProbability: currentMatrix.mixedProbability,
    dominantBias: currentMatrix.dominantBias,
    thesisId: currentMatrix.finalTakeId,
    thesisEn: currentMatrix.finalTakeEn,
  };
  archive[clusterKey] = active;
  if (!archiveOverride && !isPreNewsStateSemanticallyEqual(existing, active)) {
    savePreNewsLockArchive(archive);
  }
  return active;
}

export function resolveSystem2PostNewsState(params: {
  primaryEvent: MacroCalendarEvent;
  simultaneousEvents: MacroCalendarEvent[];
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: MacroNewsSnapshot['intermarketPulse'];
  breakingNews: BreakingNewsHeadline[];
  cmeFedWatch?: CmeFedWatchState;
  preNewsState: PreNewsSystemState;
  nowMs?: number;
  archiveOverride?: Record<string, PostNewsSystemState>;
}): PostNewsSystemState {
  const {
    primaryEvent,
    simultaneousEvents,
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch,
    preNewsState,
    nowMs = Date.now(),
    archiveOverride,
  } = params;

  const clusterEvents = [primaryEvent, ...simultaneousEvents];
  const clusterKey = buildClusterKey(primaryEvent);
  const targetMs = new Date(primaryEvent.date).getTime();
  const isReleased = Number.isFinite(targetMs) && nowMs >= targetMs;
  const elapsedAfterReleaseMs = isReleased ? Math.max(0, nowMs - targetMs) : 0;
  const expiresAtIso = Number.isFinite(targetMs)
    ? new Date(targetMs + POST_NEWS_ACTIVE_WINDOW_MS).toISOString()
    : null;
  const windowRemainingMs = isReleased
    ? Math.max(0, POST_NEWS_ACTIVE_WINDOW_MS - elapsedAfterReleaseMs)
    : POST_NEWS_ACTIVE_WINDOW_MS;
  const isWindowExpired = isReleased && elapsedAfterReleaseMs > POST_NEWS_ACTIVE_WINDOW_MS;
  const hasActual =
    isReleased && clusterEvents.some((e) => !isPlaceholderMacroValue(e.actual));
  const actualSummary = clusterEvents
    .map((e) =>
      isReleased && !isPlaceholderMacroValue(e.actual)
        ? `${e.title}: ${e.actual} (Fcst ${e.forecast || '—'})`
        : `${e.title}: Menunggu`
    )
    .join(' · ');

  const archive = archiveOverride ?? { ...loadPostNewsArchive() };
  const existingArchived = archive[clusterKey];

  // If already archived (>2h) with verified actuals, freeze forever as OFF
  if (
    isWindowExpired &&
    existingArchived &&
    existingArchived.status === 'OFF_ARCHIVED_2H' &&
    existingArchived.hasVerifiedActual
  ) {
    return existingArchived;
  }

  if (!isReleased && !hasActual) {
    return {
      clusterKey,
      primaryEventId: primaryEvent.id,
      primaryTitle: clusterEvents.map((e) => e.title).join(' & '),
      releaseDateIso: primaryEvent.date,
      status: 'WAITING_RELEASE',
      windowRemainingMs: POST_NEWS_ACTIVE_WINDOW_MS,
      expiresAtIso,
      archivedAt: null,
      hasVerifiedActual: false,
      actualSummary,
      buyProbability: preNewsState.buyProbability,
      sellProbability: preNewsState.sellProbability,
      mixedProbability: preNewsState.mixedProbability,
      dominantBias: preNewsState.dominantBias,
      shiftVsPreNews: 'PENDING',
      buyDeltaVsPreNews: 0,
      sellDeltaVsPreNews: 0,
      summaryId: `Menunggu jadwal rilis ${primaryEvent.title}. Modul Post-News aktif selama 2 jam setelah angka Actual keluar.`,
      summaryEn: `Awaiting ${primaryEvent.title} release. Post-News module remains active for 2 hours once Actual prints.`,
    };
  }

  if (isReleased && !hasActual) {
    const status: PostNewsSystemState['status'] = isWindowExpired
      ? 'OFF_ARCHIVED_2H'
      : 'PENDING_ACTUAL';
    return {
      clusterKey,
      primaryEventId: primaryEvent.id,
      primaryTitle: clusterEvents.map((e) => e.title).join(' & '),
      releaseDateIso: primaryEvent.date,
      status,
      windowRemainingMs: isWindowExpired ? 0 : windowRemainingMs,
      expiresAtIso,
      archivedAt: isWindowExpired ? new Date(nowMs).toISOString() : null,
      hasVerifiedActual: false,
      actualSummary,
      buyProbability: preNewsState.buyProbability,
      sellProbability: preNewsState.sellProbability,
      mixedProbability: preNewsState.mixedProbability,
      dominantBias: preNewsState.dominantBias,
      shiftVsPreNews: 'PENDING',
      buyDeltaVsPreNews: 0,
      sellDeltaVsPreNews: 0,
      summaryId: isWindowExpired
        ? `Jendela 2 jam pasca-rilis ${primaryEvent.title} telah berakhir tanpa angka Actual.`
        : `Jadwal rilis ${primaryEvent.title} telah lewat — menyinkronkan angka Actual untuk kalkulasi Post-News.`,
      summaryEn: isWindowExpired
        ? `The 2-hour post-release window for ${primaryEvent.title} ended without an Actual print.`
        : `${primaryEvent.title} release time passed — syncing Actual data for Post-News evaluation.`,
    };
  }

  // Evaluate Actual prints explicitly (Post-News deterministic calculation)
  const postSnap = computeDeterministicMacroSnapshot({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch,
    selectedEventId: primaryEvent.id,
    sourceMode: 'RULE_BASED_FALLBACK',
    modelUsed: 'system2-postnews-2h',
  });
  const pm = postSnap.scenarioMatrix;
  const buyDelta = pm.buyProbability - preNewsState.buyProbability;
  const sellDelta = pm.sellProbability - preNewsState.sellProbability;

  let shiftVsPreNews: PostNewsSystemState['shiftVsPreNews'] = 'UNCHANGED';
  if (
    (preNewsState.dominantBias === 'BUY' && pm.dominantBias === 'SELL') ||
    (preNewsState.dominantBias === 'SELL' && pm.dominantBias === 'BUY')
  ) {
    shiftVsPreNews = 'REVERSED_PIVOT';
  } else if (pm.dominantBias === 'BUY') {
    if (buyDelta >= 5 || preNewsState.dominantBias === 'MIXED') shiftVsPreNews = 'STRENGTHENED';
    else if (buyDelta <= -5) shiftVsPreNews = 'WEAKENED';
  } else if (pm.dominantBias === 'SELL') {
    if (sellDelta >= 5 || preNewsState.dominantBias === 'MIXED') shiftVsPreNews = 'STRENGTHENED';
    else if (sellDelta <= -5) shiftVsPreNews = 'WEAKENED';
  } else if (preNewsState.dominantBias !== 'MIXED') {
    shiftVsPreNews = 'WEAKENED';
  }

  const shiftLabelId =
    shiftVsPreNews === 'REVERSED_PIVOT'
      ? `PINDAH HALUAN vs Pre-News (${preNewsState.dominantBias} → ${pm.dominantBias})`
      : shiftVsPreNews === 'STRENGTHENED'
      ? `KEYAKINAN MENINGKAT vs Pre-News (${pm.dominantBias} +${Math.max(Math.abs(buyDelta), Math.abs(sellDelta))}%)`
      : shiftVsPreNews === 'WEAKENED'
      ? `KEYAKINAN MELEMAH vs Pre-News`
      : `SEJALAN DENGAN PRE-NEWS (${pm.dominantBias})`;

  const shiftLabelEn =
    shiftVsPreNews === 'REVERSED_PIVOT'
      ? `REVERSED vs Pre-News (${preNewsState.dominantBias} → ${pm.dominantBias})`
      : shiftVsPreNews === 'STRENGTHENED'
      ? `CONVICTION STRENGTHENED vs Pre-News (${pm.dominantBias} +${Math.max(Math.abs(buyDelta), Math.abs(sellDelta))}%)`
      : shiftVsPreNews === 'WEAKENED'
      ? `CONVICTION WEAKENED vs Pre-News`
      : `ALIGNED WITH PRE-NEWS (${pm.dominantBias})`;

  const status: PostNewsSystemState['status'] = isWindowExpired ? 'OFF_ARCHIVED_2H' : 'ACTIVE_2H';
  const result: PostNewsSystemState = {
    clusterKey,
    primaryEventId: primaryEvent.id,
    primaryTitle: clusterEvents.map((e) => e.title).join(' & '),
    releaseDateIso: primaryEvent.date,
    status,
    windowRemainingMs: isWindowExpired ? 0 : windowRemainingMs,
    expiresAtIso,
    archivedAt: isWindowExpired ? existingArchived?.archivedAt || new Date(nowMs).toISOString() : null,
    hasVerifiedActual: true,
    actualSummary,
    buyProbability: pm.buyProbability,
    sellProbability: pm.sellProbability,
    mixedProbability: pm.mixedProbability,
    dominantBias: pm.dominantBias,
    shiftVsPreNews,
    buyDeltaVsPreNews: buyDelta,
    sellDeltaVsPreNews: sellDelta,
    summaryId: isWindowExpired
      ? `[ARSIP OFF · >2 JAM] ${shiftLabelId}. Actual: ${actualSummary}.`
      : `[POST-NEWS AKTIF] ${shiftLabelId}. Actual: ${actualSummary}.`,
    summaryEn: isWindowExpired
      ? `[OFF ARCHIVE · >2H] ${shiftLabelEn}. Actual: ${actualSummary}.`
      : `[POST-NEWS ACTIVE] ${shiftLabelEn}. Actual: ${actualSummary}.`,
  };

  if (status === 'OFF_ARCHIVED_2H') {
    archive[clusterKey] = result;
    if (!archiveOverride && !isPostNewsStateSemanticallyEqual(existingArchived, result)) {
      savePostNewsArchive(archive);
    }
  }
  return result;
}

/**
 * Additive Intraday Tactical Overlay (0 Gemini Tokens).
 * Preserves Tier-1 System 1/2 and 1W/1M structural thesis while diagnosing intraday catalysts
 * that spark counter-trend spikes or drops:
 * 1) Recently released (0-4h) Medium-Impact consensus surprises (Flash PMIs, ADP, JOLTS, Claims, UoM, etc.)
 * 2) DXY / EUR Distortion (DXY rising due to EUR/GBP drag while US yields are soft/flat)
 * 3) Oversold Short-Covering Snapback (or Crowded Overbought Pullback)
 * 4) Context-Aware Dual-Channel Oil (War/Risk-Off panic offset vs pure Inflation drag)
 */
export function computeIntradayMacroTacticalOverlay(params: {
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
    eurUsd?: ExtendedMarketAssetPulse;
  };
  breakingNews?: BreakingNewsHeadline[];
  extendedFeeds?: FundamentalExtendedFeeds;
  nowMs?: number;
}): IntradayMacroTacticalOverlay {
  const {
    calendarEvents = [],
    intermarketPulse,
    breakingNews = [],
    extendedFeeds = {},
    nowMs = Date.now(),
  } = params;

  const { dxy, us02y, usoil, us10y, vix, goldPositioning } = intermarketPulse;
  const eurUsd = extendedFeeds.eurUsd ?? intermarketPulse.eurUsd;
  const es = extendedFeeds.esFutures;
  const nq = extendedFeeds.nqFutures;
  const equityAvgDay =
    es?.isAvailable && nq?.isAvailable
      ? (es.changePercent + nq.changePercent) / 2
      : es?.isAvailable
      ? es.changePercent
      : nq?.isAvailable
      ? nq.changePercent
      : null;

  const triggers: IntradayMacroTacticalOverlay['triggers'] = [];

  // 1) Medium-Impact Surprise Scanner (0–4h window, NEVER mutates isPrimaryHighImpactEvent)
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const recentMediumSurprises: MediumImpactSurpriseItem[] = [];
  let mediumImpactNetRaw = 0;

  for (const ev of calendarEvents) {
    if (isFedSpeechEvent(ev.title)) continue;
    if (isPrimaryHighImpactEvent(ev)) continue;
    if (isPlaceholderMacroValue(ev.actual) || ev.actualNum === null || ev.forecastNum === null) continue;

    const evMs = new Date(ev.date).getTime();
    if (!Number.isFinite(evMs)) continue;
    const diffMs = nowMs - evMs;
    if (diffMs < -5 * 60 * 1000 || diffMs > FOUR_HOURS_MS) continue;

    const hoursAgo = Math.max(0, Number((diffMs / (60 * 60 * 1000)).toFixed(2)));
    const decay = hoursAgo <= 1.5 ? 1.0 : hoursAgo <= 2.5 ? 0.75 : 0.45;
    const evalRes = evaluateSingleEventForGold(ev.title, ev.actualNum, ev.forecastNum, ev.previousNum);
    if (evalRes.bias === 'MIXED') continue;

    const upperTitle = ev.title.toUpperCase();
    const isKeySecondary =
      upperTitle.includes('FLASH') ||
      upperTitle.includes('PMI') ||
      upperTitle.includes('ADP') ||
      upperTitle.includes('JOLTS') ||
      upperTitle.includes('CLAIMS') ||
      upperTitle.includes('JOBLESS') ||
      upperTitle.includes('CONSUMER CONFIDENCE') ||
      upperTitle.includes('UOM') ||
      upperTitle.includes('ISM') ||
      upperTitle.includes('PHILLY') ||
      upperTitle.includes('EMPIRE') ||
      upperTitle.includes('DURABLE');

    const surpriseScale = Math.min(1.6, Math.max(0.75, evaluateEventSurpriseScale(ev)));
    const baseWeight = isKeySecondary ? 6.5 : 4.5;
    const weight = Number((baseWeight * surpriseScale * decay).toFixed(2));
    const dir = evalRes.bias === 'BUY' ? 1 : -1;
    mediumImpactNetRaw += dir * weight;

    recentMediumSurprises.push({
      title: ev.title,
      actual: ev.actual,
      forecast: ev.forecast,
      biasForGold: evalRes.bias,
      hoursAgo,
      weightContribution: Number((dir * weight).toFixed(2)),
    });
  }

  recentMediumSurprises.sort((a, b) => Math.abs(b.weightContribution) - Math.abs(a.weightContribution));
  const mediumImpactNetScore = Number(Math.max(-14, Math.min(14, mediumImpactNetRaw)).toFixed(2));
  const mediumImpactSurpriseActive =
    recentMediumSurprises.length > 0 && Math.abs(mediumImpactNetScore) >= 3.0;
  if (mediumImpactSurpriseActive) {
    triggers.push('MEDIUM_IMPACT_SURPRISE');
  }

  // 2) DXY / EUR Distortion Detector
  const dxyUp = dxy?.isAvailable !== false && dxy.price > 0 && dxy.changePercent >= 0.15;
  const eurWeak = Boolean(eurUsd?.isAvailable && eurUsd.changePercent <= -0.30);
  const yieldsNotSurging =
    (us10y?.isAvailable === false || us10y.changePercent <= 0.15) &&
    (!us02y || us02y.isAvailable === false || us02y.changePercent <= 0.20);
  const dxyDistortionDetected = Boolean(dxyUp && eurWeak && yieldsNotSurging);
  const dxyBearishDampenFactor = dxyDistortionDetected ? 0.55 : 1.0;
  if (dxyDistortionDetected) {
    triggers.push('DXY_EUR_DISTORTION');
  }

  // 3) Oversold Short-Covering Snapback (or Crowded Overbought Pullback)
  const gold3dPct = goldPositioning?.isAvailable ? goldPositioning.change3dPercent : undefined;
  const gold6hPct = goldPositioning?.isAvailable ? goldPositioning.change6hPercent : undefined;
  const isGoldOversold = Boolean(
    goldPositioning?.isAvailable &&
      ((typeof gold3dPct === 'number' && gold3dPct <= -3.0) || goldPositioning.state === 'OVERSOLD_LOW')
  );
  const isGoldOverbought = Boolean(
    goldPositioning?.isAvailable &&
      ((typeof gold3dPct === 'number' && gold3dPct >= 3.0) || goldPositioning.state === 'CROWDED_HIGH')
  );

  const hasBullishSnapSpark =
    mediumImpactNetScore >= 3.5 ||
    (equityAvgDay !== null && equityAvgDay >= 0.4) ||
    Boolean(vix?.isAvailable && vix.changePercent <= -3.5) ||
    (us10y?.isAvailable !== false && us10y.changePercent <= -0.35) ||
    Boolean(us02y?.isAvailable !== false && (us02y?.changePercent ?? 0) <= -0.35) ||
    Boolean(typeof gold6hPct === 'number' && gold6hPct >= 0.45);

  const hasBearishSnapSpark =
    mediumImpactNetScore <= -3.5 ||
    (us10y?.isAvailable !== false && us10y.changePercent >= 0.45) ||
    Boolean(us02y?.isAvailable !== false && (us02y?.changePercent ?? 0) >= 0.45) ||
    Boolean(typeof gold6hPct === 'number' && gold6hPct <= -0.45);

  const oversoldSnapbackActive = isGoldOversold && hasBullishSnapSpark;
  const overboughtPullbackActive = !oversoldSnapbackActive && isGoldOverbought && hasBearishSnapSpark;

  if (oversoldSnapbackActive) {
    triggers.push('OVERSOLD_SHORT_COVERING');
  } else if (overboughtPullbackActive) {
    triggers.push('OVERBOUGHT_PULLBACK');
  }

  // 4) Context-Aware Dual-Channel Oil Transmission
  const hasRecentGeoWarBull = breakingNews.slice(0, 12).some((h) => {
    const pubMs = new Date(h.pubDate).getTime();
    const ageH = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / (60 * 60 * 1000)) : 6;
    return h.channelType === 'GEOPOLITICS_SAFEN_HAVEN' && h.sentimentForGold === 'BULLISH' && ageH <= 8;
  });
  const riskPanicForOil =
    (vix?.isAvailable && vix.price >= 22 && vix.changePercent >= 4.0) ||
    (equityAvgDay !== null && equityAvgDay <= -1.0);
  const yieldsNotPanickingHawkish =
    (us10y?.isAvailable === false || us10y.changePercent < 0.8) &&
    (!us02y || us02y.isAvailable === false || us02y.changePercent < 0.8);

  const oilSafeHavenOffsetActive = Boolean(
    usoil?.isAvailable !== false &&
      usoil.price > 0 &&
      usoil.changePercent >= 1.4 &&
      (hasRecentGeoWarBull || riskPanicForOil) &&
      yieldsNotPanickingHawkish
  );
  if (oilSafeHavenOffsetActive) {
    triggers.push('OIL_GEOPOLITICS_SAFEN_HAVEN');
  }

  // Calculate bounded 1D tactical shift (+ positive bullish bounce risk, - negative pullback risk)
  let rawShift = 0;
  if (mediumImpactSurpriseActive) rawShift += mediumImpactNetScore * 0.65;
  if (oversoldSnapbackActive) rawShift += 6.5;
  if (overboughtPullbackActive) rawShift -= 6.5;
  if (dxyDistortionDetected && yieldsNotSurging) rawShift += 3.0;
  if (oilSafeHavenOffsetActive) rawShift += 3.0;

  const intraday1DBullShift = Number(Math.max(-13, Math.min(13, rawShift)).toFixed(1));

  let status: IntradayMacroTacticalOverlay['status'] = 'NORMAL';
  let shortCoveringBias: IntradayMacroTacticalOverlay['shortCoveringBias'] = 'NEUTRAL';

  if (oversoldSnapbackActive || (intraday1DBullShift >= 4.5 && (mediumImpactSurpriseActive || dxyDistortionDetected))) {
    status = 'COUNTER_RALLY_RISK';
    shortCoveringBias = 'BULLISH';
  } else if (overboughtPullbackActive || intraday1DBullShift <= -4.5) {
    status = 'COUNTER_DROP_RISK';
    shortCoveringBias = 'BEARISH';
  } else if (dxyDistortionDetected || oilSafeHavenOffsetActive || (mediumImpactSurpriseActive && Math.abs(mediumImpactNetScore) >= 3)) {
    status = 'HIGH_TWOWAY_VOL';
  }

  const triggerReasonsId: string[] = [];
  const triggerReasonsEn: string[] = [];

  if (mediumImpactSurpriseActive && recentMediumSurprises[0]) {
    const topMed = recentMediumSurprises[0];
    triggerReasonsId.push(
      `Data ${topMed.title} (${topMed.actual} vs cons ${topMed.forecast}, ${topMed.hoursAgo.toFixed(1)}j lalu) memberi kejutan ${
        topMed.biasForGold === 'BUY' ? 'Dovish/Bullish' : 'Hawkish/Bearish'
      } jangka pendek`
    );
    triggerReasonsEn.push(
      `${topMed.title} (${topMed.actual} vs ${topMed.forecast} est, ${topMed.hoursAgo.toFixed(1)}h ago) delivered a near-term ${
        topMed.biasForGold === 'BUY' ? 'Dovish/Bullish' : 'Hawkish/Bearish'
      } surprise`
    );
  }
  if (dxyDistortionDetected && eurUsd) {
    triggerReasonsId.push(
      `Distorsi DXY: DXY +${dxy.changePercent.toFixed(2)}% lebih didorong pelemahan EUR/USD (${eurUsd.changePercent.toFixed(
        2
      )}%) sementara yield AS tidak melonjak`
    );
    triggerReasonsEn.push(
      `DXY Distortion: DXY +${dxy.changePercent.toFixed(2)}% is mainly driven by EUR/USD weakness (${eurUsd.changePercent.toFixed(
        2
      )}%) without US yield confirmation`
    );
  }
  if (oversoldSnapbackActive) {
    triggerReasonsId.push(
      `Gold sudah oversold (${typeof gold3dPct === 'number' ? `${gold3dPct.toFixed(1)}% 3D` : 'posisi tipis'}) sehingga rentan short-covering snapback`
    );
    triggerReasonsEn.push(
      `Gold sits in an oversold short-term pocket (${typeof gold3dPct === 'number' ? `${gold3dPct.toFixed(1)}% 3D` : 'washed out'}), vulnerable to short-covering snapbacks`
    );
  } else if (overboughtPullbackActive) {
    triggerReasonsId.push(
      `Gold relatif jenuh beli jangka pendek (${typeof gold3dPct === 'number' ? `+${gold3dPct.toFixed(1)}% 3D` : 'stretched'}), rawan profit-taking intraday`
    );
    triggerReasonsEn.push(
      `Gold is stretched in the near term (${typeof gold3dPct === 'number' ? `+${gold3dPct.toFixed(1)}% 3D` : 'overbought'}), vulnerable to intraday profit-taking`
    );
  }
  if (oilSafeHavenOffsetActive) {
    triggerReasonsId.push(
      `Lonjakan minyak (+${usoil.changePercent.toFixed(2)}%) bersamaan kecemasan risiko/geopolitik memberi bantalan safe-haven 1D`
    );
    triggerReasonsEn.push(
      `Oil surge (+${usoil.changePercent.toFixed(2)}%) alongside geopolitical/risk stress provides a 1D safe-haven offset`
    );
  }

  let badgeId = 'SINKRON INTRAHARI';
  let badgeEn = 'INTRADAY ALIGNED';
  let headlineId = 'Tidak ada anomali taktis intraday khusus — pergerakan selaras dengan driver utama.';
  let headlineEn = 'No special intraday tactical anomaly detected — price drivers align with primary macro tone.';

  if (status === 'COUNTER_RALLY_RISK') {
    badgeId = 'WASPADA PANTULAN / SHORT-COVERING 1D';
    badgeEn = 'INTRADAY SHORT-COVERING / BOUNCE RISK';
    headlineId = 'Waspada lonjakan pantulan intraday (counter-move naik / short-covering) meskipun tren besar tetap diawasi.';
    headlineEn = 'Watch for sharp intraday relief bounces / short-covering spikes even if broader structure remains guarded.';
  } else if (status === 'COUNTER_DROP_RISK') {
    badgeId = 'WASPADA KOREKSI CEPAT 1D';
    badgeEn = 'INTRADAY PULLBACK / FADE RISK';
    headlineId = 'Waspada tekanan profit-taking / koreksi cepat intraday dari area jenuh beli.';
    headlineEn = 'Watch for rapid intraday profit-taking / pullback pressure from stretched near-term levels.';
  } else if (status === 'HIGH_TWOWAY_VOL') {
    badgeId = 'ANOMALI LINTAS ASET · 2 ARAH';
    badgeEn = 'CROSS-ASSET DIVERGENCE · TWO-WAY';
    headlineId = 'Terdeteksi divergensi antar-aset intraday (DXY/Yield/Data Sekunder) — waspadai spike dua arah.';
    headlineEn = 'Intraday cross-asset divergence active (DXY/Yields/Secondary data) — watch for two-way spikes.';
  }

  const detailId =
    triggerReasonsId.length > 0
      ? triggerReasonsId.join(' · ') + '.'
      : headlineId;
  const detailEn =
    triggerReasonsEn.length > 0
      ? triggerReasonsEn.join(' · ') + '.'
      : headlineEn;

  return {
    status,
    triggers,
    dxyDistortionDetected,
    dxyBearishDampenFactor,
    mediumImpactSurpriseActive,
    mediumImpactNetScore,
    recentMediumSurprises,
    oversoldSnapbackActive,
    oilSafeHavenOffsetActive,
    shortCoveringBias,
    intraday1DBullShift,
    badgeId,
    badgeEn,
    headlineId,
    headlineEn,
    detailId,
    detailEn,
  };
}

/**
 * SYSTEM 3 — Live News, Fed Speeches & Fundamental Pulse (0 Gemini Tokens).
 * Runs continuously while market is open, combining breaking RSS news/speeches, live Intermarket,
 * CME FedWatch, Offline Actuals Archive, and the additive Intraday Tactical Overlay without mutating System 1 or locked System 2.
 */
export function computeLiveFundamentalPulse(params: {
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: MacroNewsSnapshot['intermarketPulse'];
  breakingNews: BreakingNewsHeadline[];
  cmeFedWatch?: CmeFedWatchState;
  nowMs?: number;
  offlineArchive?: ArchivedMacroActualRecord[];
  extendedFeeds?: FundamentalExtendedFeeds;
}): LiveFundamentalPulseState {
  const {
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch: rawFedWatch,
    nowMs = Date.now(),
    offlineArchive,
    extendedFeeds,
  } = params;

  const isMarketOpen = isMarketDay(nowMs, { useUtc: true, enforceFridayCloseUtc: true });
  const cmeFedWatch = evaluateCmeFedWatchScoring(rawFedWatch);
  const archiveRecords = offlineArchive ?? loadOfflineActualsArchive();

  const tacticalOverlay = computeIntradayMacroTacticalOverlay({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    extendedFeeds,
    nowMs,
  });

  let buyScore = 20;
  let sellScore = 20;
  let mixedScore = 20;

  // 1) Breaking News & Fed Speeches with recency decay & topic-clustering (prevents duplicate wire amplification)
  let speechAlertActive = false;
  const recentHeadlines = (breakingNews || []).slice(0, 16);
  const channelClusterSeenCount = new Map<string, number>();
  for (const h of recentHeadlines) {
    const pubMs = new Date(h.pubDate).getTime();
    const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / (60 * 60 * 1000)) : 4;
    const recencyWeight = ageHours <= 2 ? 1.45 : ageHours <= 6 ? 1.0 : ageHours <= 12 ? 0.6 : 0.3;
    const clusterKey = `${h.channelType}:${h.sentimentForGold}`;
    const priorClusterHits = channelClusterSeenCount.get(clusterKey) || 0;
    channelClusterSeenCount.set(clusterKey, priorClusterHits + 1);
    const clusterDecay = priorClusterHits === 0 ? 1.0 : priorClusterHits === 1 ? 0.5 : 0.25;
    const baseWeight = h.impact === 'HIGH' ? 12 : 5;
    const weight = Math.max(1, Math.round(baseWeight * recencyWeight * clusterDecay));

    if (h.channelType === 'FED_SPEECH' && ageHours <= 8) {
      speechAlertActive = true;
    }

    if (h.sentimentForGold === 'BULLISH') buyScore += weight;
    else if (h.sentimentForGold === 'BEARISH') sellScore += weight;
    else mixedScore += Math.round(weight * 0.4);
  }

  // 2) Live Intermarket Transmission (DXY with EUR Distortion Dampening, US02Y, US10Y, Context-Aware USOIL, VIX)
  const { dxy, us02y, us10y, usoil, vix } = intermarketPulse;
  if (dxy?.isAvailable !== false && dxy?.price > 0) {
    if (dxy.direction === 'UP') {
      sellScore += Math.round(18 * tacticalOverlay.dxyBearishDampenFactor);
      if (tacticalOverlay.dxyDistortionDetected) {
        mixedScore += 6;
      }
    } else if (dxy.direction === 'DOWN') {
      buyScore += 18;
    }
  }
  if (us02y && us02y.isAvailable !== false && us02y.price > 0) {
    if (us02y.direction === 'UP') sellScore += 16;
    else if (us02y.direction === 'DOWN') buyScore += 16;
  }
  if (us10y?.isAvailable !== false && us10y?.price > 0) {
    if (us10y.direction === 'UP') sellScore += 12;
    else if (us10y.direction === 'DOWN') buyScore += 12;
  }
  if (usoil?.isAvailable !== false && usoil?.price > 0) {
    if (usoil.changePercent >= 1.0) {
      if (tacticalOverlay.oilSafeHavenOffsetActive) {
        buyScore += 6;
        mixedScore += 6;
      } else {
        sellScore += 12; // Inflation channel
      }
    } else if (usoil.changePercent <= -1.0) {
      buyScore += 10;
    }
  }
  if (vix?.isAvailable && vix.price >= 22 && vix.direction === 'UP') {
    buyScore += 10;
  }

  // 2b) Additive 0-4h Medium-Impact Surprise & Oversold Snapback Intraday Impulse
  if (tacticalOverlay.mediumImpactSurpriseActive) {
    const medPts = Math.round(Math.abs(tacticalOverlay.mediumImpactNetScore));
    if (tacticalOverlay.mediumImpactNetScore > 0) buyScore += medPts;
    else if (tacticalOverlay.mediumImpactNetScore < 0) sellScore += medPts;
  }
  if (tacticalOverlay.oversoldSnapbackActive) {
    buyScore += 6;
    mixedScore += 4;
  } else if (tacticalOverlay.triggers.includes('OVERBOUGHT_PULLBACK')) {
    sellScore += 6;
    mixedScore += 4;
  }

  // 3) CME FedWatch baseline
  if (cmeFedWatch.isAvailable) {
    if (cmeFedWatch.dominantOutcome === 'CUT') buyScore += 14;
    else if (cmeFedWatch.dominantOutcome === 'HIKE') sellScore += 16;
    else if (cmeFedWatch.hawkishShiftDetected) sellScore += 10;
    else mixedScore += 8;
  }

  // 4) Offline Historical Actuals Track Record (0 network/tokens — uses prior released CPI/PPI/NFP)
  const streakInfo = detectPreviousRevisionsAndStreaks(calendarEvents);
  const releasedArchiveCount = Math.max(
    archiveRecords.length,
    calendarEvents.filter((e) => !isPlaceholderMacroValue(e.actual) && !isFedSpeechEvent(e.title)).length
  );
  let histBuy = 0;
  let histSell = 0;
  for (const ev of calendarEvents) {
    if (isPlaceholderMacroValue(ev.actual) || isFedSpeechEvent(ev.title)) continue;
    const evMs = new Date(ev.date).getTime();
    const ageDays = Number.isFinite(evMs) ? Math.max(0, (nowMs - evMs) / (24 * 60 * 60 * 1000)) : 30;
    const w =
      ageDays <= 21
        ? ev.impact === 'High'
          ? 5
          : 2
        : ageDays <= 45
        ? ev.impact === 'High'
          ? 3
          : 1
        : 1;
    if (ev.eventBiasForGold === 'BUY') {
      buyScore += w;
      histBuy++;
    } else if (ev.eventBiasForGold === 'SELL') {
      sellScore += w;
      histSell++;
    }
  }

  // Anti-whipsaw balance check when DXY & yields diverge
  if (
    dxy?.isAvailable !== false &&
    us02y?.isAvailable !== false &&
    ((dxy.direction === 'UP' && us02y?.direction === 'DOWN') ||
      (dxy.direction === 'DOWN' && us02y?.direction === 'UP'))
  ) {
    mixedScore += 14;
  }

  const total = buyScore + sellScore + mixedScore;
  const buyProbability = Math.round((buyScore / total) * 100);
  const sellProbability = Math.round((sellScore / total) * 100);
  const mixedProbability = Math.max(0, 100 - buyProbability - sellProbability);

  let dominantBias: MacroBiasDirection = 'MIXED';
  if (buyProbability >= sellProbability + 6 && buyProbability > mixedProbability) {
    dominantBias = 'BUY';
  } else if (sellProbability >= buyProbability + 6 && sellProbability > mixedProbability) {
    dominantBias = 'SELL';
  }

  const topHl =
    recentHeadlines.find((h) => h.channelType === 'FED_SPEECH' || h.impact === 'HIGH') ||
    recentHeadlines[0];
  const topMed = tacticalOverlay.recentMediumSurprises[0];

  const offlinePillarSummaryId =
    streakInfo.pillarStreakSummaryId ||
    `Arsip offline ${releasedArchiveCount} rilis aktual (${histSell} pro-SELL / ${histBuy} pro-BUY Gold).`;
  const offlinePillarSummaryEn =
    streakInfo.pillarStreakSummaryEn ||
    `Offline archive ${releasedArchiveCount} actual prints (${histSell} pro-SELL / ${histBuy} pro-BUY Gold).`;

  const tacticalNoteSuffixId =
    tacticalOverlay.status !== 'NORMAL' ? ` · ${tacticalOverlay.detailId}` : '';
  const tacticalNoteSuffixEn =
    tacticalOverlay.status !== 'NORMAL' ? ` · ${tacticalOverlay.detailEn}` : '';

  const summaryId =
    (dominantBias === 'SELL'
      ? `Pulse fundamental berkelanjutan condong BEARISH Gold (${sellProbability}%) dari ${
          topHl ? `berita/pidato "${topHl.title}"` : 'tekanan DXY/Yield'
        } serta ${releasedArchiveCount} rekam rilis aktual offline.`
      : dominantBias === 'BUY'
      ? `Pulse fundamental berkelanjutan condong BULLISH Gold (${buyProbability}%) didukung ${
          topHl ? `berita/pidato "${topHl.title}"` : 'pelonggaran DXY/Yield'
        } dan ${releasedArchiveCount} arsip data aktual offline.`
      : `Pulse berita & pidato terkini masih seimbang (${mixedProbability}% MIXED) sementara pasar mencerna katalis lintas aset dan ${releasedArchiveCount} arsip aktual.`) +
    tacticalNoteSuffixId;

  const summaryEn =
    (dominantBias === 'SELL'
      ? `Continuous fundamental pulse leans BEARISH Gold (${sellProbability}%) driven by ${
          topHl ? `"${topHl.title}"` : 'firm DXY/Yields'
        } and ${releasedArchiveCount} archived offline actuals.`
      : dominantBias === 'BUY'
      ? `Continuous fundamental pulse leans BULLISH Gold (${buyProbability}%) backed by ${
          topHl ? `"${topHl.title}"` : 'softer DXY/Yields'
        } and ${releasedArchiveCount} archived offline actuals.`
      : `Live news & speech pulse remains balanced (${mixedProbability}% MIXED) as markets digest cross-asset flows and ${releasedArchiveCount} archived actuals.`) +
    tacticalNoteSuffixEn;

  return {
    status: isMarketOpen ? 'LIVE_CONTINUOUS' : 'WEEKEND_FROZEN',
    updatedAt: new Date(nowMs).toISOString(),
    buyProbability,
    sellProbability,
    mixedProbability,
    dominantBias,
    speechAlertActive,
    topCatalystTitle:
      topHl?.title ||
      (topMed ? `${topMed.title} (${topMed.actual} vs ${topMed.forecast})` : null) ||
      (isMarketOpen ? 'Memantau feed RSS & pidato Fed' : 'Akhir pekan — data Jumat'),
    topCatalystSource: topHl?.source || (topMed ? 'Economic Calendar' : 'Multi-RSS'),
    topCatalystChannel: topHl?.channelType || 'MACRO_DATA',
    offlineActualsCount: releasedArchiveCount,
    offlinePillarSummaryId,
    offlinePillarSummaryEn,
    summaryId,
    summaryEn,
    tacticalOverlay,
  };
}

export function computeMacroThreeSystemState(params: {
  snapshot: MacroNewsSnapshot;
  selectedEventId?: string | null;
  nowMs?: number;
  offlineArchive?: ArchivedMacroActualRecord[];
  preNewsArchive?: Record<string, PreNewsSystemState>;
  postNewsArchive?: Record<string, PostNewsSystemState>;
  extendedFeeds?: FundamentalExtendedFeeds;
}): MacroThreeSystemState {
  const {
    snapshot,
    selectedEventId,
    nowMs = Date.now(),
    offlineArchive,
    preNewsArchive,
    postNewsArchive,
    extendedFeeds,
  } = params;

  const matrix =
    selectedEventId && snapshot.scenarioMatrix.primaryEvent.id !== selectedEventId
      ? analyzeMacroEvent({
          calendarEvents: snapshot.calendarEvents,
          intermarketPulse: snapshot.intermarketPulse,
          breakingNews: snapshot.breakingNews,
          cmeFedWatch: snapshot.cmeFedWatch || snapshot.scenarioMatrix.cmeFedWatch,
          selectedEventId,
          sourceMode: snapshot.sourceMode,
          modelUsed: snapshot.modelUsed,
        }).scenarioMatrix
      : snapshot.scenarioMatrix;

  const system1PreNews = resolveSystem1PreNewsState({
    primaryEvent: matrix.primaryEvent,
    simultaneousEvents: matrix.simultaneousEvents || [],
    calendarEvents: snapshot.calendarEvents,
    intermarketPulse: snapshot.intermarketPulse,
    breakingNews: snapshot.breakingNews,
    cmeFedWatch: snapshot.cmeFedWatch || matrix.cmeFedWatch,
    currentMatrix: matrix,
    nowMs,
    archiveOverride: preNewsArchive,
  });

  const system2PostNews = resolveSystem2PostNewsState({
    primaryEvent: matrix.primaryEvent,
    simultaneousEvents: matrix.simultaneousEvents || [],
    calendarEvents: snapshot.calendarEvents,
    intermarketPulse: snapshot.intermarketPulse,
    breakingNews: snapshot.breakingNews,
    cmeFedWatch: snapshot.cmeFedWatch || matrix.cmeFedWatch,
    preNewsState: system1PreNews,
    nowMs,
    archiveOverride: postNewsArchive,
  });

  const system3LivePulse = computeLiveFundamentalPulse({
    calendarEvents: snapshot.calendarEvents,
    intermarketPulse: snapshot.intermarketPulse,
    breakingNews: snapshot.breakingNews,
    cmeFedWatch: snapshot.cmeFedWatch || matrix.cmeFedWatch,
    nowMs,
    offlineArchive,
    extendedFeeds,
  });

  let effectiveSourceSystem: MacroThreeSystemState['effectiveSourceSystem'] = 'SYSTEM_3_LIVE_PULSE';
  let effectiveFundamentalBias: MacroBiasDirection = system3LivePulse.dominantBias;

  if (system2PostNews.status === 'ACTIVE_2H' && system2PostNews.hasVerifiedActual) {
    effectiveSourceSystem = 'SYSTEM_2_POST_NEWS';
    effectiveFundamentalBias = system2PostNews.dominantBias;
  } else if (system1PreNews.phase === 'T5M_LOCKED') {
    effectiveSourceSystem = 'SYSTEM_1_PRE_NEWS';
    effectiveFundamentalBias = system1PreNews.dominantBias;
  } else if (system1PreNews.phase === 'PRE_ACTIVE') {
    // Before release, blend/respect System 1 + System 3 (System 3 reflects live headlines/speeches + Pre-News)
    effectiveSourceSystem = 'SYSTEM_3_LIVE_PULSE';
    effectiveFundamentalBias = system3LivePulse.dominantBias;
  }

  return {
    system1PreNews,
    system2PostNews,
    system3LivePulse,
    effectiveFundamentalBias,
    effectiveSourceSystem,
  };
}

// ============================================================================
// FUNDAMENTAL GOLD STRUCTURAL ENGINE (1D / 1W / 1M · BULLISH vs BEARISH ONLY)
// ============================================================================

export const FUNDAMENTAL_GOLD_SNAPSHOT_STORAGE_KEY = 'tradevault_fundamental_gold_snapshot_v1';

export type FundamentalDirectionBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface ExtendedMarketAssetPulse {
  symbol: string;
  yahooTicker: string;
  name: string;
  category:
    | 'REAL_YIELD'
    | 'EQUITY'
    | 'CREDIT_STRESS'
    | 'VOLATILITY'
    | 'METALS_FLOW'
    | 'FX_G10'
    | 'LIQUIDITY';
  price: number;
  previousClose: number;
  changePercent: number;
  change5dPercent?: number;
  change20dPercent?: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  effectOnGold: FundamentalDirectionBias;
  noteId: string;
  noteEn: string;
  isAvailable: boolean;
  updatedAt: string;
}

export interface CftcCotGoldState {
  isAvailable: boolean;
  reportDate: string;
  managedMoneyLong: number;
  managedMoneyShort: number;
  netSpeculativeContracts: number;
  netPercentile1y: number; // 0..100
  crowdingState: 'EXTREME_LONG' | 'ELEVATED_LONG' | 'NEUTRAL' | 'WASHED_OUT_SHORT';
  noteId: string;
  noteEn: string;
}

export interface FundamentalExtendedFeeds {
  esFutures?: ExtendedMarketAssetPulse;
  nqFutures?: ExtendedMarketAssetPulse;
  tipEtf?: ExtendedMarketAssetPulse;
  iefEtf?: ExtendedMarketAssetPulse;
  hygEtf?: ExtendedMarketAssetPulse;
  moveIndex?: ExtendedMarketAssetPulse;
  gvzIndex?: ExtendedMarketAssetPulse;
  gldEtf?: ExtendedMarketAssetPulse;
  silverFutures?: ExtendedMarketAssetPulse;
  copperFutures?: ExtendedMarketAssetPulse;
  btcUsd?: ExtendedMarketAssetPulse;
  eurUsd?: ExtendedMarketAssetPulse;
  usdJpy?: ExtendedMarketAssetPulse;
  usdCnh?: ExtendedMarketAssetPulse;
  cotGold?: CftcCotGoldState;
  externalEvents?: ExternalG10ChinaEvent[];
  fetchedAt?: string;
}

export interface FundamentalHorizonBias {
  horizon: '1D' | '1W' | '1M';
  bias: FundamentalDirectionBias;
  bullishProbability: number;
  bearishProbability: number;
  headlineId: string;
  headlineEn: string;
}

export interface FundamentalNarrativeLanguageBlock {
  headlineSummary: string;
  dataStatusNote: string;
  sectionA_StatusAndChange: string;
  sectionB_RatesInflationAndGrowth: string;
  sectionC_CrossMarketEquitiesCentralBanks: string;
  sectionD_HorizonOutlookAndRisks: string;
}

export interface FundamentalDriverBreakdownItem {
  id: string;
  category: 'RATES_REAL_YIELD' | 'DOLLAR_FX' | 'EQUITIES_LIQUIDITY' | 'CREDIT_GEOPOLITICS' | 'FLOWS_CHINA_COT';
  effect: FundamentalDirectionBias;
  weight: number;
  labelId: string;
  labelEn: string;
  metricText: string;
  explainId: string;
  explainEn: string;
}

export type FundamentalMarketRegime =
  | 'STAGFLATION'
  | 'REFLATION_HAWKISH'
  | 'DISINFLATION_EASING'
  | 'RISK_OFF_CRISIS'
  | 'DELEVERAGING_DASH_FOR_CASH'
  | 'RISK_ON_EQUITY_ROTATION'
  | 'GOLDILOCKS_NEUTRAL';

export interface FundamentalGoldSnapshot {
  id: string;
  instrument: 'XAUUSD';
  analyzedAt: string;
  sourceMode: 'GEMINI_AI' | 'DETERMINISTIC_FALLBACK';
  modelUsed: string;
  fallbackUsed?: boolean;
  aiErrorCode?: string;
  isOfflineCached?: boolean;
  overallBias: FundamentalDirectionBias;
  bullishProbability: number;
  bearishProbability: number;
  horizons: {
    daily1D: FundamentalHorizonBias;
    weekly1W: FundamentalHorizonBias;
    monthly1M: FundamentalHorizonBias;
  };
  marketRegime: FundamentalMarketRegime;
  regimeLabelId: string;
  regimeLabelEn: string;
  fundamentalFingerprint: string;
  changeDetection: {
    hasChanged: boolean;
    changeScore: number;
    previousAnalyzedAt: string | null;
    statusTitleId: string;
    statusTitleEn: string;
    statusDetailId: string;
    statusDetailEn: string;
    changedFactorsId: string[];
    changedFactorsEn: string[];
  };
  cadenceSchedule: {
    currentSlotId: 'ASIA_PRE_LONDON' | 'LONDON_OPEN' | 'NEW_YORK_SESSION' | 'WEEKEND';
    currentSlotLabelId: string;
    currentSlotLabelEn: string;
    recommendedDailyUpdates: number;
    nextWindowWib: string;
  };
  narrative: {
    id: FundamentalNarrativeLanguageBlock;
    en: FundamentalNarrativeLanguageBlock;
  };
  drivers: FundamentalDriverBreakdownItem[];
  tacticalOverlay?: IntradayMacroTacticalOverlay;
  evidenceSummary: {
    dxyPrice?: number;
    dxyChangePct?: number;
    us10yPrice?: number;
    us10yChangePct?: number;
    us02yPrice?: number;
    realYieldSpreadPct?: number;
    tipIefChangePct?: number;
    esChangePct?: number;
    nqChangePct?: number;
    vixPrice?: number;
    movePrice?: number;
    gvzPrice?: number;
    hygIefSpreadPct?: number;
    gldChangePct?: number;
    goldSilverRatio?: number;
    copperGoldRatioPct?: number;
    usdCnhChangePct?: number;
    eurUsdChangePct?: number;
    btcChangePct?: number;
    usOilChangePct?: number;
    cftcNetPercentile?: number;
    cftcReportDate?: string;
    fedWatchDominant?: string;
    fedWatchCutPct?: number | null;
    fedWatchHoldPct?: number | null;
    fedWatchHikePct?: number | null;
    fedWatchMeeting?: string;
    fedWatchSourceLabel?: string;
    fedWatchImpliedRate?: number | null;
    activeDriversCount: number;
  };
}

export function computeFundamentalGoldCadenceSlot(
  nowMs: number = Date.now()
): FundamentalGoldSnapshot['cadenceSchedule'] {
  const isMarketOpen = isMarketDay(nowMs, { useUtc: true, enforceFridayCloseUtc: true });
  if (!isMarketOpen) {
    return {
      currentSlotId: 'WEEKEND',
      currentSlotLabelId: 'Akhir Pekan · Data Penutupan Jumat',
      currentSlotLabelEn: 'Weekend · Friday Closing Baseline',
      recommendedDailyUpdates: 3,
      nextWindowWib: 'Senin 07:30 WIB',
    };
  }

  let wibHour = 12;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date(nowMs));
    const hVal = Number(parts.find((p) => p.type === 'hour')?.value);
    if (Number.isFinite(hVal)) wibHour = hVal;
  } catch {
    wibHour = new Date(nowMs + 7 * 3600 * 1000).getUTCHours();
  }

  if (wibHour >= 6 && wibHour < 14) {
    return {
      currentSlotId: 'ASIA_PRE_LONDON',
      currentSlotLabelId: 'Jendela 1 · Sesi Pagi Asia & Tiongkok (07:30 WIB)',
      currentSlotLabelEn: 'Window 1 · Asia & China Morning Session (07:30 WIB)',
      recommendedDailyUpdates: 3,
      nextWindowWib: '14:30 WIB (Pembukaan London)',
    };
  }
  if (wibHour >= 14 && wibHour < 20) {
    return {
      currentSlotId: 'LONDON_OPEN',
      currentSlotLabelId: 'Jendela 2 · Sesi London & Eropa (14:30 WIB)',
      currentSlotLabelEn: 'Window 2 · London & Europe Open (14:30 WIB)',
      recommendedDailyUpdates: 3,
      nextWindowWib: '20:30 WIB (Sesi AS & Saham NY)',
    };
  }
  return {
    currentSlotId: 'NEW_YORK_SESSION',
    currentSlotLabelId: 'Jendela 3 · Sesi New York, Data AS & Wall Street (20:30 WIB)',
    currentSlotLabelEn: 'Window 3 · New York, US Data & Wall Street Session (20:30 WIB)',
    recommendedDailyUpdates: 3,
    nextWindowWib: '07:30 WIB (Sesi Asia Esok)',
  };
}

function clampProb(val: number, min = 18, max = 82): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function sanitizeNoBuySellWording(text: string): string {
  return text
    .replace(/\bSTRONG\s+BUY\b/gi, 'STRONG BULLISH')
    .replace(/\bSTRONG\s+SELL\b/gi, 'STRONG BEARISH')
    .replace(/\bBUY\s+XAU\/USD\b/gi, 'BULLISH XAU/USD')
    .replace(/\bSELL\s+XAU\/USD\b/gi, 'BEARISH XAU/USD')
    .replace(/\bPRO-BUY\b/gi, 'PRO-BULLISH')
    .replace(/\bPRO-SELL\b/gi, 'PRO-BEARISH');
}

export function computeFundamentalGoldSnapshot(params: {
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
    eurUsd?: ExtendedMarketAssetPulse;
  };
  breakingNews: BreakingNewsHeadline[];
  cmeFedWatch: CmeFedWatchState;
  extendedFeeds?: FundamentalExtendedFeeds;
  previousSnapshot?: FundamentalGoldSnapshot | null;
  nowMs?: number;
}): FundamentalGoldSnapshot {
  const {
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch: rawFedWatch,
    extendedFeeds = {},
    previousSnapshot = null,
    nowMs = Date.now(),
  } = params;

  const cmeFedWatch = evaluateCmeFedWatchScoring(rawFedWatch);
  const { dxy, us02y, usoil, us10y, vix, goldPositioning } = intermarketPulse;
  const drivers: FundamentalDriverBreakdownItem[] = [];

  const tacticalOverlay = computeIntradayMacroTacticalOverlay({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    extendedFeeds,
    nowMs,
  });

  // Horizon structural scores (centered around 0; positive = Bullish Gold, negative = Bearish Gold)
  let score1D = 0;
  let score1W = 0;
  let score1M = 0;

  // 1) FOMC 3 Pillars & Historical Calendar Archive (1W & 1M structural backbone + Stagflation detection)
  let inflScore = 0;
  let laborGrowthScore = 0;
  for (const ev of calendarEvents) {
    if (isFedSpeechEvent(ev.title)) continue;
    const evMs = new Date(ev.date).getTime();
    const ageDays = Number.isFinite(evMs) ? (nowMs - evMs) / (24 * 60 * 60 * 1000) : 14;
    if (ageDays > 65 || ageDays < -14) continue;
    const recency = ageDays <= 14 ? 1.25 : ageDays <= 35 ? 0.85 : 0.45;
    const scale = evaluateEventSurpriseScale(ev);
    const mag = (ev.impact === 'High' ? 4.2 : 1.8) * recency * scale;
    const dir = ev.eventBiasForGold === 'BUY' ? 1 : ev.eventBiasForGold === 'SELL' ? -1 : 0;
    if (ev.pillar === 'INFLATION') inflScore += dir * mag;
    else if (ev.pillar === 'LABOR' || ev.pillar === 'GROWTH') laborGrowthScore += dir * mag;
  }

  const isStagflationRegime = inflScore <= -4 && laborGrowthScore >= 3;
  const calendarNet = inflScore + laborGrowthScore;
  if (isStagflationRegime) {
    score1W += 11;
    score1M += 16;
    drivers.push({
      id: 'stagflation-regime',
      category: 'RATES_REAL_YIELD',
      effect: 'BULLISH',
      weight: 16,
      labelId: 'Pola Stagflasi AS (Inflasi Lengket + Ekonomi Melambat)',
      labelEn: 'US Stagflation Pattern (Sticky Inflation + Cooling Growth/Jobs)',
      metricText: `Inflasi ${inflScore.toFixed(1)} / Pertumbuhan ${laborGrowthScore > 0 ? '+' : ''}${laborGrowthScore.toFixed(1)}`,
      explainId: 'Ketika harga barang masih sulit turun tapi ekonomi dan lowongan kerja melambat, investor biasanya memilih Emas untuk melindungi nilai kekayaan.',
      explainEn: 'When inflation remains stubborn while jobs and growth cool, investors historically accumulate Gold to protect purchasing power.',
    });
  } else if (Math.abs(calendarNet) >= 2.5) {
    const calShift = Math.max(-18, Math.min(18, calendarNet * 0.9));
    score1W += calShift * 0.85;
    score1M += calShift;
    const eff: FundamentalDirectionBias = calShift > 0 ? 'BULLISH' : 'BEARISH';
    drivers.push({
      id: 'macro-calendar-pillars',
      category: 'RATES_REAL_YIELD',
      effect: eff,
      weight: Math.round(Math.abs(calShift)),
      labelId: 'Rangkaian Data Ekonomi AS (CPI, NFP, GDP)',
      labelEn: 'US Macro Data Streak (CPI, NFP, GDP)',
      metricText: `Skor 3 Pilar ${calShift > 0 ? '+' : ''}${calShift.toFixed(1)}`,
      explainId:
        eff === 'BULLISH'
          ? 'Data inflasi dan ekonomi AS belakangan lebih jinak dari perkiraan, membuka ruang suku bunga turun di masa depan (mendukung Emas).'
          : 'Data ekonomi dan inflasi AS masih kuat/panas, memberi alasan bagi bank sentral AS mempertahankan suku bunga tinggi (menekan Emas).',
      explainEn:
        eff === 'BULLISH'
          ? 'Recent US inflation and growth prints came in softer than expected, giving the Fed room to ease policy later (Bullish Gold).'
          : 'US growth and inflation figures remain resilient, giving the Fed reason to keep interest rates restrictive (Bearish Gold).',
    });
  }

  // 2) CME FedWatch & Yield Curve + Real Yield Proxy (TIP / IEF + US10Y + US02Y)
  if (cmeFedWatch.isAvailable) {
    let fedDelta = 0;
    const isRestrictiveHold =
      cmeFedWatch.dominantOutcome === 'HOLD' &&
      (cmeFedWatch.cutProbability ?? 50) < 42 &&
      ((us10y.isAvailable !== false && us10y.price >= 4.35) ||
        (us02y?.isAvailable !== false && (us02y?.price ?? 0) >= 4.25));

    if (cmeFedWatch.dominantOutcome === 'CUT') fedDelta = 11;
    else if (cmeFedWatch.dominantOutcome === 'HIKE') fedDelta = -13;
    else if (cmeFedWatch.hawkishShiftDetected) fedDelta = -8;
    else if (isRestrictiveHold) {
      fedDelta = (cmeFedWatch.holdProbability ?? 0) >= 58 ? -7.5 : -5.5;
    }

    score1D += fedDelta * 0.7;
    score1W += fedDelta * 0.95;
    score1M += fedDelta;

    const eff: FundamentalDirectionBias = fedDelta > 0 ? 'BULLISH' : fedDelta < 0 ? 'BEARISH' : 'NEUTRAL';
    if (eff !== 'NEUTRAL') {
      drivers.push({
        id: 'fedwatch-policy',
        category: 'RATES_REAL_YIELD',
        effect: eff,
        weight: Math.round(Math.abs(fedDelta)),
        labelId: 'Ekspektasi Suku Bunga The Fed',
        labelEn: 'Fed Interest Rate Expectations',
        metricText:
          cmeFedWatch.dominantOutcome === 'CUT' && cmeFedWatch.cutProbability !== null
            ? `Peluang Turun ${cmeFedWatch.cutProbability.toFixed(0)}%`
            : cmeFedWatch.dominantOutcome === 'HIKE' && cmeFedWatch.hikeProbability !== null
            ? `Peluang Naik ${cmeFedWatch.hikeProbability.toFixed(0)}%`
            : `Tahan ${cmeFedWatch.holdProbability?.toFixed(0) ?? '—'}% (Cut ${cmeFedWatch.cutProbability?.toFixed(0) ?? '—'}%)`,
        explainId:
          eff === 'BULLISH'
            ? 'Pasar melihat peluang pemangkasan suku bunga AS semakin dekat. Suku bunga turun membuat Emas lebih menarik.'
            : 'Pasar memperkirakan The Fed menahan bunga tinggi lebih lama (peluang potong bunga rendah), sehingga imbal hasil obligasi/USD bersaing ketat dengan Emas.',
        explainEn:
          eff === 'BULLISH'
            ? 'Markets are pricing higher odds of Fed rate cuts. Lower interest rates reduce the opportunity cost of holding Gold.'
            : 'Markets price restrictive US rates staying on hold for longer (low cut odds), creating real competition for non-yielding Gold.',
      });
    }
  }

  // US10Y & Real Yield Breakeven via TIP vs IEF
  const tip = extendedFeeds.tipEtf;
  const ief = extendedFeeds.iefEtf;
  let tipIefSpreadPct: number | undefined;
  if (tip?.isAvailable && ief?.isAvailable) {
    tipIefSpreadPct = Number((tip.changePercent - ief.changePercent).toFixed(2));
    const tipIef5dSpread = Number(((tip.change5dPercent ?? 0) - (ief.change5dPercent ?? 0)).toFixed(2));
    // When TIP outperforms IEF, inflation expectations (breakeven) are rising -> lowers REAL yield -> Bullish Gold
    const rySignal = tipIefSpreadPct * 4.5 + tipIef5dSpread * 2.0;
    const boundedRy = Math.max(-10, Math.min(10, rySignal));
    if (Math.abs(boundedRy) >= 1.5) {
      score1D += boundedRy * 0.5;
      score1W += boundedRy * 0.85;
      score1M += boundedRy;
      const eff: FundamentalDirectionBias = boundedRy > 0 ? 'BULLISH' : 'BEARISH';
      drivers.push({
        id: 'real-yield-tip-ief',
        category: 'RATES_REAL_YIELD',
        effect: eff,
        weight: Math.round(Math.abs(boundedRy)),
        labelId: 'Imbal Hasil Riil & Ekspektasi Inflasi (TIPS vs Obligasi)',
        labelEn: 'Real Yield & Breakeven Proxy (TIPS vs Treasuries)',
        metricText: `TIPS vs IEF ${tipIefSpreadPct >= 0 ? '+' : ''}${tipIefSpreadPct.toFixed(2)}%`,
        explainId:
          eff === 'BULLISH'
            ? 'Obligasi anti-inflasi (TIPS) lebih diburu daripada obligasi biasa, menandakan bunga riil cenderung turun dan mendukung Emas.'
            : 'Bunga riil AS terasa lebih ketat karena obligasi biasa mengungguli TIPS, menahan kenaikan Emas.',
        explainEn:
          eff === 'BULLISH'
            ? 'Inflation-protected bonds (TIPS) are outperforming nominal Treasuries, signaling lower real yields and a tailwind for Gold.'
            : 'Nominal Treasuries are outperforming TIPS, indicating firmer real yields that restrain Gold upside.',
      });
    }
  }

  if (us10y.isAvailable !== false && us10y.price > 0) {
    const isHighAbsoluteYield = us10y.price >= 4.55;
    let yDelta =
      us10y.changePercent <= -1.2 ? 7 : us10y.changePercent >= 1.2 ? -9 : us10y.direction === 'DOWN' ? 3.5 : us10y.direction === 'UP' ? -4.5 : 0;
    // High absolute yield ceiling dampens a single day's bounce & penalizes 1W/1M structural holding cost
    if (isHighAbsoluteYield && yDelta > 0) {
      yDelta *= 0.45;
    }
    score1D += yDelta;
    score1W += yDelta * 0.7 - (isHighAbsoluteYield ? 5 : 0);
    score1M += yDelta * 0.35 - (us10y.price >= 4.7 ? 6 : isHighAbsoluteYield ? 3 : 0);
  }
  if (us02y?.isAvailable !== false && us02y && us02y.price > 0) {
    const y2Delta = us02y.direction === 'DOWN' ? 3.5 : us02y.direction === 'UP' ? -6 : 0;
    score1D += y2Delta;
    score1W += y2Delta * 0.6 - (us02y.price >= 4.6 ? 3 : 0);
  }

  // 3) DXY & G10/China Currency Basket (EUR/USD, USD/JPY, USD/CNH)
  if (dxy.isAvailable !== false && dxy.price > 0) {
    const rawDxyScore = Math.max(-14, Math.min(14, -dxy.changePercent * 14));
    const dxyScore1D =
      rawDxyScore < 0 ? rawDxyScore * tacticalOverlay.dxyBearishDampenFactor : rawDxyScore;
    score1D += dxyScore1D * 1.15;
    score1W += rawDxyScore * 0.85;
    score1M += rawDxyScore * 0.5;
    if (Math.abs(rawDxyScore) >= 2.5) {
      const eff: FundamentalDirectionBias = rawDxyScore > 0 ? 'BULLISH' : 'BEARISH';
      const eurNoteId = tacticalOverlay.dxyDistortionDetected
        ? ` Catatan distorsi intraday: kenaikan DXY sebagian didorong melemahnya EUR/USD (${(
            extendedFeeds.eurUsd?.changePercent ?? intermarketPulse.eurUsd?.changePercent ?? 0
          ).toFixed(2)}%) sementara yield obligasi AS tidak melonjak, sehingga tekanan pada 1D Emas berkurang.`
        : '';
      const eurNoteEn = tacticalOverlay.dxyDistortionDetected
        ? ` Intraday distortion note: DXY gains stem heavily from EUR/USD weakness (${(
            extendedFeeds.eurUsd?.changePercent ?? intermarketPulse.eurUsd?.changePercent ?? 0
          ).toFixed(2)}%) while US Treasury yields remain muted, softening 1D drag on Gold.`
        : '';
      drivers.push({
        id: 'dxy-strength',
        category: 'DOLLAR_FX',
        effect: eff,
        weight: Math.round(Math.abs(dxyScore1D)),
        labelId: tacticalOverlay.dxyDistortionDetected
          ? 'Kekuatan Dolar AS (DXY · Distorsi EUR)'
          : 'Kekuatan Dolar AS (DXY)',
        labelEn: tacticalOverlay.dxyDistortionDetected
          ? 'US Dollar Index (DXY · EUR Distortion)'
          : 'US Dollar Index (DXY)',
        metricText: `${dxy.price.toFixed(2)} (${dxy.changePercent >= 0 ? '+' : ''}${dxy.changePercent.toFixed(2)}%)`,
        explainId:
          (eff === 'BULLISH'
            ? 'Dolar AS sedang melemah. Karena harga Emas dunia dihitung dalam USD, Dolar yang lemah membuat Emas lebih murah dibeli dunia.'
            : 'Dolar AS sedang menguat. Penguatan Dolar membuat harga Emas relatif lebih mahal bagi pembeli di luar AS.') +
          eurNoteId,
        explainEn:
          (eff === 'BULLISH'
            ? 'The US Dollar is softening, making USD-denominated Gold cheaper for international buyers.'
            : 'The US Dollar is strengthening, making USD-priced Gold costlier for global buyers.') +
          eurNoteEn,
      });
    }
  }

  const usdCnh = extendedFeeds.usdCnh;
  if (usdCnh?.isAvailable) {
    // Rising USD/CNH (Yuan weakens) often sparks Chinese household & PBoC Gold hedging demand over 1W/1M
    const cnhMove = usdCnh.change5dPercent ?? usdCnh.changePercent;
    if (Math.abs(cnhMove) >= 0.35) {
      const cnhBull = cnhMove > 0 ? 5.5 : -2.5;
      score1W += cnhBull;
      score1M += cnhBull * 1.25;
      if (cnhMove > 0) {
        drivers.push({
          id: 'china-yuan-hedge',
          category: 'FLOWS_CHINA_COT',
          effect: 'BULLISH',
          weight: 6,
          labelId: 'Lindung Nilai Yuan Tiongkok (USD/CNH)',
          labelEn: 'China Yuan Hedge Demand (USD/CNH)',
          metricText: `USD/CNH ${cnhMove >= 0 ? '+' : ''}${cnhMove.toFixed(2)}%`,
          explainId: 'Saat mata uang Yuan Tiongkok melemah, masyarakat dan bank sentral Tiongkok cenderung memperbanyak simpanan Emas fisik.',
          explainEn: 'As China’s Yuan weakens, domestic investors and institutions tend to increase physical Gold hedging demand.',
        });
      }
    }
  }

  const usdJpy = extendedFeeds.usdJpy;
  if (usdJpy?.isAvailable && usdJpy.changePercent <= -0.8) {
    // Sharp Yen surge / Carry Trade unwind -> global risk-off tailwind for Gold
    score1D += 6;
    score1W += 5;
  }

  // 4) US Equities & Risk-On Liquidity Drain (S&P 500 Futures ES=F, Nasdaq NQ=F, Mega-IPO / Bitcoin)
  const es = extendedFeeds.esFutures;
  const nq = extendedFeeds.nqFutures;
  const equityAvgDay =
    es?.isAvailable && nq?.isAvailable
      ? (es.changePercent + nq.changePercent) / 2
      : es?.isAvailable
      ? es.changePercent
      : nq?.isAvailable
      ? nq.changePercent
      : null;
  const equityAvg5d =
    es?.isAvailable && nq?.isAvailable
      ? ((es.change5dPercent ?? 0) + (nq.change5dPercent ?? 0)) / 2
      : es?.isAvailable
      ? es.change5dPercent ?? 0
      : nq?.isAvailable
      ? nq.change5dPercent ?? 0
      : 0;

  const gld = extendedFeeds.gldEtf;
  const silver = extendedFeeds.silverFutures;
  const copper = extendedFeeds.copperFutures;
  const gld1dPct = gld?.isAvailable ? gld.changePercent : undefined;
  const gold3dPct = goldPositioning?.isAvailable ? goldPositioning.change3dPercent : undefined;
  const gold6hPct = goldPositioning?.isAvailable ? goldPositioning.change6hPercent : undefined;

  // Detect Margin-Call / Liquidation "Dash for Cash": Equities plunging + VIX spiking + Gold/GLD simultaneously falling
  const isGoldActivelySellingOff =
    (typeof gld1dPct === 'number' && gld1dPct <= -1.2) ||
    (typeof gold3dPct === 'number' && gold3dPct <= -3.0) ||
    (typeof gold6hPct === 'number' && gold6hPct <= -0.6);

  const isDashForCashLiquidation =
    ((equityAvgDay !== null && equityAvgDay <= -2.0) || Boolean(vix?.isAvailable && vix.price >= 26)) &&
    isGoldActivelySellingOff;

  if (isDashForCashLiquidation) {
    const gldDrag = typeof gld1dPct === 'number' && gld1dPct < 0 ? Math.abs(gld1dPct) * 3.8 : 0;
    const gc3dDrag = typeof gold3dPct === 'number' && gold3dPct < 0 ? Math.abs(gold3dPct) * 1.5 : 0;
    const liq1D = Math.min(22, Math.max(11, gldDrag + 6));
    const liq1W = Math.min(16, Math.max(8, gc3dDrag + gldDrag * 0.6));
    score1D -= liq1D;
    score1W -= liq1W;
    drivers.push({
      id: 'dash-for-cash-liquidation',
      category: 'EQUITIES_LIQUIDITY',
      effect: 'BEARISH',
      weight: Math.round(liq1W + 4),
      labelId: 'Aksi Jual Likuiditas & Margin Call (Saham + Emas Turun Bersama)',
      labelEn: 'Margin-Call Dash for Cash (Stocks & Gold Liquidated Together)',
      metricText: `GLD ${typeof gld1dPct === 'number' ? `${gld1dPct.toFixed(2)}%` : '—'} · GC=F 3D ${typeof gold3dPct === 'number' ? `${gold3dPct.toFixed(2)}%` : '—'} · VIX ${vix?.isAvailable ? vix.price.toFixed(1) : '—'}`,
      explainId: 'Saat pasar saham jatuh tajam dan VIX melonjak tapi harga Emas ikut turun, dana besar sedang menjual Emas untuk mencairkan Dolar tunai (menutup margin call). Ini sering menekan Emas dalam jangka pendek-mingguan sebelum fungsi aset aman pulih.',
      explainEn: 'When Wall Street tumbles alongside Gold ETF & futures outflows, institutions are selling profitable Gold positions to raise USD cash and meet margin calls — creating real 1D/1W downside pressure.',
    });
  }

  let isEquityRotationRiskOn = false;
  if (equityAvgDay !== null) {
    // Sharp equity rally pulls speculative liquidity into stocks & mega-IPOs (short-term headwind unless yields drop)
    // Moderate equity selloff (when Gold holds/rises) triggers flight-to-safety; if Gold falls simultaneously, it is Dash-for-Cash liquidation handled above!
    if (equityAvgDay >= 0.7 || equityAvg5d >= 1.8) {
      isEquityRotationRiskOn = true;
      const drag = Math.min(11, Math.max(4, equityAvgDay * 4 + equityAvg5d * 1.2));
      score1D -= drag;
      score1W -= drag * 0.75;
      drivers.push({
        id: 'us-equities-rotation',
        category: 'EQUITIES_LIQUIDITY',
        effect: 'BEARISH',
        weight: Math.round(drag),
        labelId: 'Rotasi Uang ke Saham AS (Risk-On)',
        labelEn: 'Capital Rotation into US Equities (Risk-On)',
        metricText: `S&P/Nasdaq ${equityAvgDay >= 0 ? '+' : ''}${equityAvgDay.toFixed(2)}% (1D)`,
        explainId: 'Pasar saham AS sedang bergairah, membuat sebagian dana investor berpindah sementara dari Emas ke saham teknologi dan IPO baru.',
        explainEn: 'Strong US equity momentum is pulling risk appetite and short-term capital away from defensive Gold into stocks and IPOs.',
      });
    } else if (!isDashForCashLiquidation && (equityAvgDay <= -0.8 || equityAvg5d <= -2.0)) {
      const boost = Math.min(11, Math.max(4, Math.abs(equityAvgDay) * 3.5 + Math.abs(equityAvg5d) * 1.0));
      score1D += boost;
      score1W += boost * 0.8;
      drivers.push({
        id: 'us-equities-riskoff',
        category: 'EQUITIES_LIQUIDITY',
        effect: 'BULLISH',
        weight: Math.round(boost),
        labelId: 'Pelemahan Saham AS → Cari Aset Aman',
        labelEn: 'US Equity Pullback → Safe-Haven Flight',
        metricText: `S&P/Nasdaq ${equityAvgDay.toFixed(2)}% (1D)`,
        explainId: 'Ketika bursa saham AS memerah sementara Emas bertahan kuat, investor besar memarkir dana ke Emas.',
        explainEn: 'When Wall Street stocks decline while Gold holds firm, institutional portfolios rotate capital into defensive Gold.',
      });
    }
  }

  const btc = extendedFeeds.btcUsd;
  if (btc?.isAvailable && Math.abs(btc.changePercent) >= 3.5 && btc.changePercent <= -4.0 && vix?.isAvailable && vix.price >= 22) {
    // Acute liquidity crunch signal if Bitcoin dumps simultaneously with rising VIX
    score1D -= 3; // possible brief cash/margin raise volatility
    score1W += 5; // safe-haven recovery once margin dust settles
  }

  // 5) Credit Stress & Volatility (VIX, ^MOVE, HYG vs IEF, ^GVZ)
  const move = extendedFeeds.moveIndex;
  const hyg = extendedFeeds.hygEtf;
  const gvz = extendedFeeds.gvzIndex;
  let hygIefSpreadPct: number | undefined;
  let hasCreditStress = false;
  if (hyg?.isAvailable && ief?.isAvailable) {
    hygIefSpreadPct = Number((hyg.changePercent - ief.changePercent).toFixed(2));
    if (hygIefSpreadPct <= -0.45) {
      hasCreditStress = true;
      if (!isDashForCashLiquidation) {
        score1W += 6;
      }
      score1M += 9;
    }
  }
  const isVixElevated = Boolean(vix?.isAvailable && (vix.price >= 21 || vix.changePercent >= 5));
  const isMoveElevated = Boolean(move?.isAvailable && (move.price >= 110 || move.changePercent >= 4));
  if (!isDashForCashLiquidation && (isVixElevated || isMoveElevated || hasCreditStress)) {
    score1D += isVixElevated ? 5 : 2;
    score1W += 7;
    score1M += 6;
    drivers.push({
      id: 'volatility-credit-stress',
      category: 'CREDIT_GEOPOLITICS',
      effect: 'BULLISH',
      weight: 8,
      labelId: 'Tingkat Kecemasan Pasar & Obligasi (VIX / MOVE)',
      labelEn: 'Market Fear & Bond Stress (VIX / MOVE)',
      metricText: `VIX ${vix?.isAvailable ? vix.price.toFixed(1) : '—'}${move?.isAvailable ? ` · MOVE ${move.price.toFixed(0)}` : ''}`,
      explainId: 'Indeks kecemasan di pasar saham maupun obligasi sedang meningkat. Dalam situasi tidak pasti, Emas dicari sebagai pelindung utama.',
      explainEn: 'Elevated equity or Treasury bond volatility reflects financial anxiety, strengthening demand for Gold as a hedge.',
    });
  } else if (isDashForCashLiquidation && (isVixElevated || hasCreditStress)) {
    // High VIX confirms acute stress supports 1M structural hedge, even while 1D/1W suffers liquidation
    score1M += 5;
  }

  // 6) Energy / Oil Channel & Metals Confirmation (GLD, Silver, Copper/Gold, GC=F Momentum)
  if (usoil.isAvailable !== false && usoil.price > 0) {
    if (usoil.changePercent >= 1.4) {
      if (tacticalOverlay.oilSafeHavenOffsetActive) {
        score1D += 2.5; // Safe-haven / stagflation panic offsets 1D oil inflation drag
        score1W -= 2.5;
        drivers.push({
          id: 'oil-safehaven-offset',
          category: 'CREDIT_GEOPOLITICS',
          effect: 'BULLISH',
          weight: 5,
          labelId: 'Lonjakan Minyak + Ketegangan Risiko (Bantalan Safe-Haven 1D)',
          labelEn: 'Oil Surge + Risk/Geopolitical Stress (1D Safe-Haven Offset)',
          metricText: `WTI $${usoil.price.toFixed(2)} (+${usoil.changePercent.toFixed(2)}%)`,
          explainId: 'Minyak naik tajam bersamaan dengan ketegangan geopolitik / pelemahan saham tanpa lonjakan yield AS — permintaan aset aman sementara mengimbangi jalur inflasi.',
          explainEn: 'Crude oil surged alongside geopolitical/equity stress without a US yield spike — near-term safe-haven hedging offsets the inflation channel on 1D.',
        });
      } else {
        score1D -= 6;
        score1W -= 4.5;
        drivers.push({
          id: 'oil-inflation-channel',
          category: 'RATES_REAL_YIELD',
          effect: 'BEARISH',
          weight: 6,
          labelId: 'Kenaikan Harga Minyak Dunia (Jalur Inflasi)',
          labelEn: 'Crude Oil Surge (Inflation Channel)',
          metricText: `WTI $${usoil.price.toFixed(2)} (+${usoil.changePercent.toFixed(2)}%)`,
          explainId: 'Lonjakan harga minyak dapat membuat biaya hidup & inflasi naik lagi, yang berisiko membuat The Fed menunda penurunan bunga.',
          explainEn: 'Rising oil prices threaten to reignite headline inflation, potentially delaying Fed rate cuts.',
        });
      }
    } else if (usoil.changePercent <= -1.5) {
      score1D += 5;
      score1W += 4;
    }
  }

  const goldPriceRef = goldPositioning?.isAvailable && goldPositioning.price > 0 ? goldPositioning.price : 0;
  const goldSilverRatio =
    goldPriceRef > 0 && silver?.isAvailable && silver.price > 0
      ? Number((goldPriceRef / silver.price).toFixed(1))
      : undefined;
  const copperGoldRatioPct =
    copper?.isAvailable && goldPositioning?.isAvailable
      ? Number((copper.changePercent - (goldPositioning.change6hPercent ?? 0)).toFixed(2))
      : undefined;

  if (gld?.isAvailable) {
    if (Math.abs(gld.changePercent) >= 1.0 && !isDashForCashLiquidation) {
      const gldDayScore = Math.max(-12, Math.min(10, gld.changePercent * 3.0));
      score1D += gldDayScore;
      score1W += gldDayScore * 0.5;
    }
    const gld5d = gld.change5dPercent ?? gld.changePercent;
    if (Math.abs(gld5d) >= 1.0) {
      const gldScore = Math.max(-9, Math.min(9, gld5d * 1.4));
      score1W += gldScore;
      score1M += gldScore * 0.9;
    }
  }
  if (!isDashForCashLiquidation && typeof gold3dPct === 'number' && Math.abs(gold3dPct) >= 2.5) {
    // Near-term institutional tape flow: strong 3D drop weighs on 1D/1W follow-through until price stabilizes
    const momDelta = Math.max(-10, Math.min(8, gold3dPct * 1.1));
    score1D += momDelta;
    score1W += momDelta * 0.85;
  }
  if (goldSilverRatio !== undefined && goldSilverRatio >= 88) {
    // High GSR signals defensive Gold leadership
    score1W += 3;
    score1M += 4;
  }

  // 7) CFTC Commitments of Traders (Managed Money Crowding on 1M / 1W)
  const cot = extendedFeeds.cotGold;
  if (cot?.isAvailable) {
    if (cot.crowdingState === 'EXTREME_LONG') {
      score1D -= 3;
      score1W -= 5;
      // High crowding caps near-term upside even in structural bull markets (shakeout risk)
      drivers.push({
        id: 'cftc-cot-crowding',
        category: 'FLOWS_CHINA_COT',
        effect: 'BEARISH',
        weight: 6,
        labelId: 'Posisi Dana Besar CFTC Sudah Sangat Penuh',
        labelEn: 'CFTC Managed Money Positioning Crowded Long',
        metricText: `Persentil ${cot.netPercentile1y.toFixed(0)}/100 (${cot.reportDate})`,
        explainId: 'Banyak pengelola dana besar sudah memegang Emas dalam porsi sangat tinggi, sehingga rawan koreksi sehat (ambil untung) jangka pendek.',
        explainEn: 'Institutional futures positioning sits near 1-year highs, raising near-term profit-taking and shakeout risk.',
      });
    } else if (cot.crowdingState === 'WASHED_OUT_SHORT') {
      score1W += 7;
      score1M += 9;
      drivers.push({
        id: 'cftc-cot-washed',
        category: 'FLOWS_CHINA_COT',
        effect: 'BULLISH',
        weight: 8,
        labelId: 'Posisi Dana Besar CFTC Masih Ringan (Ruang Naik Lebar)',
        labelEn: 'CFTC Managed Money Under-Positioned (Room to Build)',
        metricText: `Persentil ${cot.netPercentile1y.toFixed(0)}/100 (${cot.reportDate})`,
        explainId: 'Posisi beli institusi besar masih relatif rendah, memberi ruang lebar bagi arus modal masuk jika ada katalis positif.',
        explainEn: 'Speculative long positioning is light relative to the past year, leaving ample room for fresh institutional inflows.',
      });
    }
  }

  // 8) Breaking RSS Wire Synthesis (Topic-clustered + time-decayed for 1D & 1W)
  let rssBull = 0;
  let rssBear = 0;
  const clusterSeen = new Map<string, number>();
  for (const b of breakingNews.slice(0, 16)) {
    const pubMs = new Date(b.pubDate).getTime();
    const ageH = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / (60 * 60 * 1000)) : 4;
    const decay = ageH <= 2 ? 1.0 : ageH <= 6 ? 0.7 : ageH <= 12 ? 0.45 : 0.25;
    const key = `${b.channelType}:${b.sentimentForGold}`;
    const prevHits = clusterSeen.get(key) || 0;
    clusterSeen.set(key, prevHits + 1);
    const clusterWeight = prevHits === 0 ? 1.0 : prevHits === 1 ? 0.45 : 0.2;
    const pts = (b.impact === 'HIGH' ? 3.2 : 1.5) * decay * clusterWeight;
    if (b.sentimentForGold === 'BULLISH') rssBull += pts;
    else if (b.sentimentForGold === 'BEARISH') rssBear += pts;
  }
  const rssNet = Math.max(-10, Math.min(10, rssBull - rssBear));
  if (Math.abs(rssNet) >= 1.5) {
    score1D += rssNet * 1.1;
    score1W += rssNet * 0.55;
    const eff: FundamentalDirectionBias = rssNet > 0 ? 'BULLISH' : 'BEARISH';
    drivers.push({
      id: 'news-wire-sentiment',
      category: 'CREDIT_GEOPOLITICS',
      effect: eff,
      weight: Math.round(Math.abs(rssNet)),
      labelId: 'Arus Berita & Geopolitik Global',
      labelEn: 'Global News & Geopolitical Flow',
      metricText: `${breakingNews.filter((x) => x.sentimentForGold === 'BULLISH').length} Bullish · ${breakingNews.filter((x) => x.sentimentForGold === 'BEARISH').length} Bearish`,
      explainId:
        eff === 'BULLISH'
          ? 'Berita utama hari ini lebih banyak menyorot hal yang mendorong minat lindung nilai atau pelemahan Dolar AS.'
          : 'Berita global hari ini lebih banyak menyorot risiko suku bunga tinggi, meredanya konflik, atau penguatan aset berisiko.',
      explainEn:
        eff === 'BULLISH'
          ? 'Today’s news flow leans toward safe-haven hedging demand or softer US rate expectations.'
          : 'Recent global headlines lean toward higher-for-longer rates, geopolitical de-escalation, or risk-on appetite.',
    });
  }

  // 9) Additive Intraday Tactical Overlay (applies bounded 1D shift ONLY — leaves 1W & 1M structural backbone intact)
  if (tacticalOverlay.status !== 'NORMAL' && Math.abs(tacticalOverlay.intraday1DBullShift) >= 2.0) {
    score1D += tacticalOverlay.intraday1DBullShift;
    const tactEff: FundamentalDirectionBias =
      tacticalOverlay.intraday1DBullShift > 0 ? 'BULLISH' : 'BEARISH';
    drivers.push({
      id: 'intraday-tactical-overlay',
      category: 'EQUITIES_LIQUIDITY',
      effect: tactEff,
      weight: Math.min(12, Math.max(5, Math.round(Math.abs(tacticalOverlay.intraday1DBullShift)))),
      labelId: tacticalOverlay.badgeId,
      labelEn: tacticalOverlay.badgeEn,
      metricText:
        tacticalOverlay.recentMediumSurprises[0]
          ? `${tacticalOverlay.recentMediumSurprises[0].title}: ${tacticalOverlay.recentMediumSurprises[0].actual} vs ${tacticalOverlay.recentMediumSurprises[0].forecast}`
          : tacticalOverlay.triggers.join(' · '),
      explainId: tacticalOverlay.detailId,
      explainEn: tacticalOverlay.detailEn,
    });
  }

  // Sort drivers by weight descending so most impactful evidence leads
  drivers.sort((a, b) => b.weight - a.weight);

  // Convert horizon raw scores cleanly into BULLISH % + BEARISH % === 100
  let bull1D = clampProb(50 + score1D);
  let bull1W = clampProb(50 + score1W);
  const bull1M = clampProb(50 + score1M);

  // Reality-Check Guardrail: Never display euphoric Bullish odds on 1D/1W when live GLD/GC=F is plunging (-1.5% 1D or -3.5% 3D)
  if (isDashForCashLiquidation || (typeof gld1dPct === 'number' && gld1dPct <= -1.5)) {
    bull1D = Math.min(bull1D, 46);
  }
  if (isDashForCashLiquidation || (typeof gold3dPct === 'number' && gold3dPct <= -4.0)) {
    bull1W = Math.min(bull1W, 49);
  }

  const bear1D = 100 - bull1D;
  const bear1W = 100 - bull1W;
  const bear1M = 100 - bull1M;

  // Overall structural probability blends 25% 1D + 40% 1W + 35% 1M
  const bullishProbability = clampProb(bull1D * 0.25 + bull1W * 0.4 + bull1M * 0.35);
  const bearishProbability = 100 - bullishProbability;

  const getBiasFromProb = (bull: number): FundamentalDirectionBias =>
    bull >= 54 ? 'BULLISH' : bull <= 46 ? 'BEARISH' : 'NEUTRAL';

  const overallBias = getBiasFromProb(bullishProbability);
  const bias1D = getBiasFromProb(bull1D);
  const bias1W = getBiasFromProb(bull1W);
  const bias1M = getBiasFromProb(bull1M);

  // Determine Market Regime
  let marketRegime: FundamentalMarketRegime = 'GOLDILOCKS_NEUTRAL';
  let regimeLabelId = 'Pasar Seimbang (Menunggu Pemicu Baru)';
  let regimeLabelEn = 'Balanced Regime (Awaiting Fresh Catalyst)';

  if (isDashForCashLiquidation) {
    marketRegime = 'DELEVERAGING_DASH_FOR_CASH';
    regimeLabelId = 'Likuidasi Tunai / Margin Call (Saham & Emas Dijual Bersamaan)';
    regimeLabelEn = 'Dash-for-Cash Deleveraging (Equities & Gold Sold Together)';
  } else if (isStagflationRegime) {
    marketRegime = 'STAGFLATION';
    regimeLabelId = 'Stagflasi (Inflasi Lengket + Ekonomi Melambat)';
    regimeLabelEn = 'Stagflation (Sticky Inflation + Cooling Growth)';
  } else if (isVixElevated || isMoveElevated || hasCreditStress) {
    marketRegime = 'RISK_OFF_CRISIS';
    regimeLabelId = 'Mode Defensif / Safe-Haven (Kecemasan Pasar Naik)';
    regimeLabelEn = 'Risk-Off Safe-Haven (Rising Market Stress)';
  } else if (isEquityRotationRiskOn && overallBias === 'BEARISH') {
    marketRegime = 'RISK_ON_EQUITY_ROTATION';
    regimeLabelId = 'Rotasi Risk-On (Uang Mengalir ke Saham AS / IPO)';
    regimeLabelEn = 'Risk-On Equity Rotation (Capital Flowing to US Stocks / IPOs)';
  } else if (overallBias === 'BULLISH') {
    marketRegime = 'DISINFLATION_EASING';
    regimeLabelId = 'Pelonggaran Bunga & Dukungan Struktural Emas';
    regimeLabelEn = 'Easing Rate Path & Structural Gold Support';
  } else if (overallBias === 'BEARISH') {
    marketRegime = 'REFLATION_HAWKISH';
    regimeLabelId = 'Tekanan Suku Bunga Ketat & Dolar Kuat';
    regimeLabelEn = 'Tighter Yield & Strong US Dollar Pressure';
  }

  // Structural Fingerprint (rounded buckets so normal 1-pip noise doesn't look like a fundamental shift!)
  const dxyBucket = dxy.isAvailable !== false && dxy.price > 0 ? Math.round(dxy.price * 2) / 2 : 0;
  const y10Bucket = us10y.isAvailable !== false && us10y.price > 0 ? Math.round(us10y.price * 10) / 10 : 0;
  const esBucket = es?.isAvailable ? Math.round(es.changePercent) : 0;
  const topHeadlineSig = breakingNews
    .slice(0, 4)
    .map((h) => `${h.channelType}:${h.sentimentForGold}`)
    .join(',');
  const fpRaw = [
    `regime:${marketRegime}`,
    `overall:${overallBias}:${Math.round(bullishProbability / 5) * 5}`,
    `h:${bias1D}-${bias1W}-${bias1M}`,
    `dxy:${dxyBucket}:y10:${y10Bucket}:es:${esBucket}`,
    `fed:${cmeFedWatch.dominantOutcome}:${Math.round((cmeFedWatch.cutProbability ?? 0) / 10) * 10}`,
    `cal:${calendarEvents.filter((e) => !isPlaceholderMacroValue(e.actual)).slice(0, 6).map((e) => `${e.title}:${e.actual}`).join('|')}`,
    `cot:${cot?.crowdingState || 'NA'}`,
    `news:${topHeadlineSig}`,
    `tact:${tacticalOverlay.status}:${tacticalOverlay.triggers.join(',')}`,
  ].join('##');

  let fpHash = 2166136261;
  for (let i = 0; i < fpRaw.length; i++) {
    fpHash ^= fpRaw.charCodeAt(i);
    fpHash = Math.imul(fpHash, 16777619);
  }
  const fundamentalFingerprint = `fg-${(fpHash >>> 0).toString(16)}`;

  // Honest Change Detection vs Previous Snapshot
  const changedFactorsId: string[] = [];
  const changedFactorsEn: string[] = [];
  let hasChanged = false;
  let changeScore = 0;

  if (!previousSnapshot) {
    hasChanged = true;
    changeScore = 100;
    changedFactorsId.push('Pembacaan awal fundamental XAU/USD disusun dari seluruh data makro & pasar global.');
    changedFactorsEn.push('Initial XAU/USD structural fundamental reading compiled from macro & cross-asset feeds.');
  } else {
    const bullDiff = Math.abs(bullishProbability - previousSnapshot.bullishProbability);
    if (previousSnapshot.marketRegime !== marketRegime) {
      hasChanged = true;
      changeScore += 45;
      changedFactorsId.push(`Iklim pasar bergeser ke "${regimeLabelId}".`);
      changedFactorsEn.push(`Market regime shifted to "${regimeLabelEn}".`);
    }
    if (previousSnapshot.overallBias !== overallBias || bullDiff >= 5) {
      hasChanged = true;
      changeScore += 35;
      changedFactorsId.push(
        `Peluang arah berubah dari ${previousSnapshot.bullishProbability}% Bullish menjadi ${bullishProbability}% Bullish.`
      );
      changedFactorsEn.push(
        `Directional probability shifted from ${previousSnapshot.bullishProbability}% Bullish to ${bullishProbability}% Bullish.`
      );
    }
    if (previousSnapshot.fundamentalFingerprint !== fundamentalFingerprint && !hasChanged) {
      hasChanged = true;
      changeScore += 20;
      changedFactorsId.push('Ada pembaruan rilis berita / pergeseran antar-aset (DXY, Obligasi, atau Saham AS).');
      changedFactorsEn.push('Updated macro headlines or cross-asset moves detected (DXY, yields, or US equities).');
    }
  }

  const cadenceSchedule = computeFundamentalGoldCadenceSlot(nowMs);
  const biasWordId =
    overallBias === 'BULLISH' ? 'Cenderung Naik (Bullish)' : overallBias === 'BEARISH' ? 'Cenderung Turun (Bearish)' : 'Netral / Seimbang';
  const biasWordEn =
    overallBias === 'BULLISH' ? 'Bullish Tilt' : overallBias === 'BEARISH' ? 'Bearish Tilt' : 'Neutral / Balanced';

  const statusTitleId = !previousSnapshot
    ? 'Analisis Fundamental Siap'
    : hasChanged
    ? 'Ada Pergeseran Data Fundamental'
    : 'Data Fundamental Masih Sama';
  const statusTitleEn = !previousSnapshot
    ? 'Fundamental Readout Ready'
    : hasChanged
    ? 'Fundamental Drivers Shifted'
    : 'Fundamental Data Unchanged';

  const statusDetailId = !previousSnapshot
    ? 'Disusun dari pembacaan suku bunga The Fed, imbal hasil obligasi AS, indeks Dolar (DXY), sentimen Wall Street, arus institusi, dan risiko global.'
    : hasChanged
    ? changedFactorsId.join(' ')
    : `Belum ada katalis makro baru yang mengubah struktur sejak pengecekan terakhir. Arah besar Emas tetap ${biasWordId} dengan pendorong inti yang sama.`;
  const statusDetailEn = !previousSnapshot
    ? 'Synthesized from Fed rate pricing, US Treasury yields, the US Dollar Index (DXY), Wall Street risk flows, institutional positioning, and global stress.'
    : hasChanged
    ? changedFactorsEn.join(' ')
    : `No fresh macro catalyst has altered the backdrop since the last check. Gold’s structural leaning stays ${biasWordEn} on the same core drivers.`;

  // Crisp Macro Desk Brief Deterministic Narrative (used offline, as fallback, or when data is unchanged)
  const topDriver = drivers[0];
  const ratesDriver = drivers.find((d) => d.category === 'RATES_REAL_YIELD');
  const flowDriver =
    drivers.find((d) => d.category === 'EQUITIES_LIQUIDITY') ||
    drivers.find((d) => d.category === 'FLOWS_CHINA_COT') ||
    drivers.find((d) => d.category === 'DOLLAR_FX');

  const headlineId =
    overallBias === 'BULLISH'
      ? `Bias makro XAU/USD mengarah Bullish (${bullishProbability}%) di bawah rezim ${regimeLabelId.toLowerCase()}.`
      : overallBias === 'BEARISH'
      ? `Bias makro XAU/USD berada di bawah tekanan Bearish (${bearishProbability}%) akibat rezim ${regimeLabelId.toLowerCase()}.`
      : `Bias makro XAU/USD masih seimbang (${bullishProbability}% Bullish vs ${bearishProbability}% Bearish) di tengah tarik-menarik pendorong naik dan penahan lintas pasar.`;

  const headlineEn =
    overallBias === 'BULLISH'
      ? `XAU/USD macro bias leans Bullish (${bullishProbability}%) within a ${regimeLabelEn.toLowerCase()} regime.`
      : overallBias === 'BEARISH'
      ? `XAU/USD macro bias faces Bearish pressure (${bearishProbability}%) under a ${regimeLabelEn.toLowerCase()} regime.`
      : `XAU/USD macro bias stays balanced (${bullishProbability}% Bullish vs ${bearishProbability}% Bearish) as supportive and headwind forces offset.`;

  const horizon1DTextId =
    bias1D === 'BULLISH'
      ? `condong menguat (${bull1D}% Bullish)`
      : bias1D === 'BEARISH'
      ? `rawan tekanan jangka pendek (${bear1D}% Bearish)`
      : `cenderung mendatar (${bull1D}% Bullish)`;
  const horizon1WTextId =
    bias1W === 'BULLISH'
      ? `berpihak pada sisi Bullish (${bull1W}%)`
      : bias1W === 'BEARISH'
      ? `didominasi tekanan Bearish (${bear1W}%)`
      : `bergerak selektif netral (${bull1W}% Bullish)`;
  const horizon1MTextId =
    bias1M === 'BULLISH'
      ? `menopang struktur naik (${bull1M}% Bullish)`
      : bias1M === 'BEARISH'
      ? `membebani arah tren besar (${bear1M}% Bearish)`
      : `berkonsolidasi netral (${bull1M}% Bullish)`;

  const horizon1DTextEn =
    bias1D === 'BULLISH'
      ? `tilted higher (${bull1D}% Bullish)`
      : bias1D === 'BEARISH'
      ? `facing near-term pressure (${bear1D}% Bearish)`
      : `range-bound (${bull1D}% Bullish)`;
  const horizon1WTextEn =
    bias1W === 'BULLISH'
      ? `Bullish-leaning (${bull1W}%)`
      : bias1W === 'BEARISH'
      ? `Bearish-tilted (${bear1W}%)`
      : `selective neutral (${bull1W}% Bullish)`;
  const horizon1MTextEn =
    bias1M === 'BULLISH'
      ? `supportive for the broader uptrend (${bull1M}% Bullish)`
      : bias1M === 'BEARISH'
      ? `weighing on the macro trend (${bear1M}% Bearish)`
      : `consolidating neutrally (${bull1M}% Bullish)`;

  const sectionA_Id = `${
    hasChanged
      ? 'Pembaruan data terbaru mengonfirmasi pergeseran rezim yang menempatkan'
      : 'Belum ada perubahan fundamental berarti sejak pengecekan sebelumnya — struktur makro masih menempatkan'
  } Emas (XAU/USD) pada posisi ${biasWordId} (${bullishProbability}% Bullish vs ${bearishProbability}% Bearish). ${
    topDriver
      ? `Penggerak paling dominan saat ini datang dari ${topDriver.labelId.toLowerCase()}: ${topDriver.explainId}`
      : ''
  }`.trim();

  const sectionB_Id = ratesDriver
    ? `Pada poros utama penentu harga Emas — suku bunga The Fed, bunga riil, dan obligasi AS — ${ratesDriver.explainId} ${
        dxy.isAvailable !== false && dxy.price > 0
          ? `Sejalan dengan itu, Indeks Dolar AS (DXY di ${dxy.price.toFixed(2)}, ${
              dxy.changePercent >= 0 ? 'menguat' : 'melemah'
            } ${Math.abs(dxy.changePercent).toFixed(2)}%) bersama yield obligasi AS 10 tahun (${
              us10y.isAvailable !== false ? `${us10y.price.toFixed(2)}%` : '—'
            }) menjadi barometer langsung apakah biaya peluang menahan Emas sedang melonggar atau justru mengetat.`
          : ''
      }`.trim()
    : `Pada poros suku bunga dan inflasi AS, pasar tetap menjadikan ekspektasi kebijakan The Fed sebagai jangkar utama. ${
        cmeFedWatch.isAvailable
          ? cmeFedWatch.summaryNoteId || ''
          : 'Pergerakan yield obligasi AS dan DXY tetap menentukan ruang gerak struktural Emas jangka menengah.'
      }`.trim();

  const sectionC_Id = [
    flowDriver
      ? `Dari sisi rotasi modal lintas pasar (Wall Street, mata uang Asia, dan arus institusi): ${flowDriver.explainId}`
      : '',
    es?.isAvailable
      ? `Di bursa saham AS, indeks utama sedang ${
          es.changePercent >= 0
            ? `menguat (+${es.changePercent.toFixed(2)}%), menandakan sebagian likuiditas jangka pendek masih nyaman bertahan di aset berisiko`
            : `terkoreksi (${es.changePercent.toFixed(2)}%), sehingga minat lindung nilai defensif terhadap Emas mulai terjaga`
        }.`
      : '',
    cot?.isAvailable
      ? `Sementara di pasar berjangka global (laporan CFTC COT), eksposur beli bersih dana institusi berada di persentil ${cot.netPercentile1y.toFixed(
          0
        )} dari 100 dalam setahun terakhir.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const tacticalSectionDId =
    tacticalOverlay.status !== 'NORMAL' ? ` Catatan taktis intraday: ${tacticalOverlay.detailId}` : '';
  const tacticalSectionDEn =
    tacticalOverlay.status !== 'NORMAL' ? ` Intraday tactical note: ${tacticalOverlay.detailEn}` : '';

  const sectionD_Id = `Memetakan tiga horizon waktu: dalam 1 hari ke depan XAU/USD ${horizon1DTextId}, pada rentang 1 minggu arah fundamental ${horizon1WTextId}, dan secara struktural 1 bulan ke depan masih ${horizon1MTextId}.${tacticalSectionDId} Skenario ini berisiko berbalik apabila rilis inflasi atau tenaga kerja AS melenceng tajam dari konsensus, DXY dan yield US10Y menembus naik secara agresif, atau terjadi pergeseran mendadak pada sentimen risiko geopolitik.`;

  const sectionA_En = `${
    hasChanged
      ? 'Incoming macro data confirms a shift placing'
      : 'No material fundamental change since the prior check — the broader macro backdrop continues to place'
  } Gold (XAU/USD) at a ${biasWordEn} (${bullishProbability}% Bullish vs ${bearishProbability}% Bearish). ${
    topDriver
      ? `The dominant driver right now is ${topDriver.labelEn}: ${topDriver.explainEn}`
      : ''
  }`.trim();

  const sectionB_En = ratesDriver
    ? `Across Gold’s core rate-and-dollar engine — Fed expectations, real yields, and Treasuries — ${ratesDriver.explainEn} ${
        dxy.isAvailable !== false && dxy.price > 0
          ? `Alongside this, the US Dollar Index (DXY at ${dxy.price.toFixed(2)}, ${
              dxy.changePercent >= 0 ? 'up' : 'down'
            } ${Math.abs(dxy.changePercent).toFixed(2)}%) and the 10-year Treasury yield (${
              us10y.isAvailable !== false ? `${us10y.price.toFixed(2)}%` : '—'
            }) directly dictate whether the opportunity cost of holding non-yielding Gold is easing or tightening.`
          : ''
      }`.trim()
    : `Across US rates and inflation, Federal Reserve policy pricing remains Gold’s primary anchor. ${
        cmeFedWatch.isAvailable
          ? cmeFedWatch.summaryNoteEn || ''
          : 'Treasury yields and the US Dollar continue setting the medium-term tone for Gold.'
      }`.trim();

  const sectionC_En = [
    flowDriver
      ? `Looking at cross-market capital flows (Wall Street risk appetite, Asia FX, and institutions): ${flowDriver.explainEn}`
      : '',
    es?.isAvailable
      ? `On the equity side, US stock futures are ${
          es.changePercent >= 0
            ? `advancing (+${es.changePercent.toFixed(2)}%), keeping short-term speculative capital rotated toward risk assets`
            : `pulling back (${es.changePercent.toFixed(2)}%), keeping defensive hedging interest in Gold supported`
        }.`
      : '',
    cot?.isAvailable
      ? `In institutional futures positioning (CFTC COT), managed money net longs sit at the ${cot.netPercentile1y.toFixed(
          0
        )}th percentile over the past 12 months.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const sectionD_En = `Across time horizons: over the next 1 Day XAU/USD is ${horizon1DTextEn}, across 1 Week fundamentals stay ${horizon1WTextEn}, and on a 1 Month window structural forces remain ${horizon1MTextEn}.${tacticalSectionDEn} Watch for invalidation if upcoming US inflation or labor prints surprise sharply, DXY and US10Y yields break decisively higher, or geopolitical stress abruptly shifts.`;

  return {
    id: `fgs-${nowMs}`,
    instrument: 'XAUUSD',
    analyzedAt: new Date(nowMs).toISOString(),
    sourceMode: 'DETERMINISTIC_FALLBACK',
    modelUsed: 'fundamental-engine-v1',
    overallBias,
    bullishProbability,
    bearishProbability,
    horizons: {
      daily1D: {
        horizon: '1D',
        bias: bias1D,
        bullishProbability: bull1D,
        bearishProbability: bear1D,
        headlineId: sanitizeNoBuySellWording(`Harian (1 Hari): ${bias1D === 'BULLISH' ? 'Condong Bullish' : bias1D === 'BEARISH' ? 'Condong Bearish' : 'Seimbang'} (${bull1D}% Bullish / ${bear1D}% Bearish)`),
        headlineEn: sanitizeNoBuySellWording(`1-Day Outlook: ${bias1D} (${bull1D}% Bullish / ${bear1D}% Bearish)`),
      },
      weekly1W: {
        horizon: '1W',
        bias: bias1W,
        bullishProbability: bull1W,
        bearishProbability: bear1W,
        headlineId: sanitizeNoBuySellWording(`Mingguan (1 Minggu): ${bias1W === 'BULLISH' ? 'Condong Bullish' : bias1W === 'BEARISH' ? 'Condong Bearish' : 'Seimbang'} (${bull1W}% Bullish / ${bear1W}% Bearish)`),
        headlineEn: sanitizeNoBuySellWording(`1-Week Outlook: ${bias1W} (${bull1W}% Bullish / ${bear1W}% Bearish)`),
      },
      monthly1M: {
        horizon: '1M',
        bias: bias1M,
        bullishProbability: bull1M,
        bearishProbability: bear1M,
        headlineId: sanitizeNoBuySellWording(`Bulanan (1 Bulan): ${bias1M === 'BULLISH' ? 'Condong Bullish' : bias1M === 'BEARISH' ? 'Condong Bearish' : 'Seimbang'} (${bull1M}% Bullish / ${bear1M}% Bearish)`),
        headlineEn: sanitizeNoBuySellWording(`1-Month Outlook: ${bias1M} (${bull1M}% Bullish / ${bear1M}% Bearish)`),
      },
    },
    marketRegime,
    regimeLabelId,
    regimeLabelEn,
    fundamentalFingerprint,
    changeDetection: {
      hasChanged,
      changeScore,
      previousAnalyzedAt: previousSnapshot?.analyzedAt || null,
      statusTitleId,
      statusTitleEn,
      statusDetailId: sanitizeNoBuySellWording(statusDetailId),
      statusDetailEn: sanitizeNoBuySellWording(statusDetailEn),
      changedFactorsId: changedFactorsId.map(sanitizeNoBuySellWording),
      changedFactorsEn: changedFactorsEn.map(sanitizeNoBuySellWording),
    },
    cadenceSchedule,
    narrative: {
      id: {
        headlineSummary: sanitizeNoBuySellWording(headlineId),
        dataStatusNote: sanitizeNoBuySellWording(statusDetailId),
        sectionA_StatusAndChange: sanitizeNoBuySellWording(sectionA_Id),
        sectionB_RatesInflationAndGrowth: sanitizeNoBuySellWording(sectionB_Id),
        sectionC_CrossMarketEquitiesCentralBanks: sanitizeNoBuySellWording(sectionC_Id || 'Aliran dana lintas pasar sedang bergerak stabil menantikan katalis besar berikutnya.'),
        sectionD_HorizonOutlookAndRisks: sanitizeNoBuySellWording(sectionD_Id),
      },
      en: {
        headlineSummary: sanitizeNoBuySellWording(headlineEn),
        dataStatusNote: sanitizeNoBuySellWording(statusDetailEn),
        sectionA_StatusAndChange: sanitizeNoBuySellWording(sectionA_En),
        sectionB_RatesInflationAndGrowth: sanitizeNoBuySellWording(sectionB_En),
        sectionC_CrossMarketEquitiesCentralBanks: sanitizeNoBuySellWording(sectionC_En || 'Cross-market capital flows remain relatively balanced awaiting the next major macro catalyst.'),
        sectionD_HorizonOutlookAndRisks: sanitizeNoBuySellWording(sectionD_En),
      },
    },
    drivers,
    tacticalOverlay,
    evidenceSummary: {
      dxyPrice: dxy.isAvailable !== false && dxy.price > 0 ? dxy.price : undefined,
      dxyChangePct: dxy.isAvailable !== false ? dxy.changePercent : undefined,
      us10yPrice: us10y.isAvailable !== false && us10y.price > 0 ? us10y.price : undefined,
      us10yChangePct: us10y.isAvailable !== false ? us10y.changePercent : undefined,
      us02yPrice: us02y?.isAvailable !== false && us02y && us02y.price > 0 ? us02y.price : undefined,
      tipIefChangePct: tipIefSpreadPct,
      esChangePct: es?.isAvailable ? es.changePercent : undefined,
      nqChangePct: nq?.isAvailable ? nq.changePercent : undefined,
      vixPrice: vix?.isAvailable ? vix.price : undefined,
      movePrice: move?.isAvailable ? move.price : undefined,
      gvzPrice: gvz?.isAvailable ? gvz.price : undefined,
      hygIefSpreadPct,
      gldChangePct: gld?.isAvailable ? gld.changePercent : undefined,
      goldSilverRatio,
      copperGoldRatioPct,
      usdCnhChangePct: usdCnh?.isAvailable ? usdCnh.changePercent : undefined,
      eurUsdChangePct: (extendedFeeds.eurUsd ?? intermarketPulse.eurUsd)?.isAvailable
        ? (extendedFeeds.eurUsd ?? intermarketPulse.eurUsd)?.changePercent
        : undefined,
      btcChangePct: btc?.isAvailable ? btc.changePercent : undefined,
      usOilChangePct: usoil.isAvailable !== false ? usoil.changePercent : undefined,
      cftcNetPercentile: cot?.isAvailable ? cot.netPercentile1y : undefined,
      cftcReportDate: cot?.isAvailable ? cot.reportDate : undefined,
      fedWatchDominant: cmeFedWatch.isAvailable ? cmeFedWatch.dominantOutcome : undefined,
      fedWatchCutPct: cmeFedWatch.isAvailable ? cmeFedWatch.cutProbability : undefined,
      fedWatchHoldPct: cmeFedWatch.isAvailable ? cmeFedWatch.holdProbability : undefined,
      fedWatchHikePct: cmeFedWatch.isAvailable ? cmeFedWatch.hikeProbability : undefined,
      fedWatchMeeting: cmeFedWatch.isAvailable ? cmeFedWatch.fomcMeetingDate : undefined,
      fedWatchSourceLabel: cmeFedWatch.isAvailable ? cmeFedWatch.sourceLabel : undefined,
      fedWatchImpliedRate: cmeFedWatch.isAvailable ? cmeFedWatch.impliedFedFundsRate : undefined,
      activeDriversCount: drivers.length,
    },
  };
}

export function loadLocalCachedFundamentalGoldSnapshotSync(): FundamentalGoldSnapshot | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(FUNDAMENTAL_GOLD_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.instrument === 'XAUUSD' &&
      typeof parsed.bullishProbability === 'number' &&
      parsed.horizons &&
      parsed.narrative
    ) {
      return parsed as FundamentalGoldSnapshot;
    }
  } catch {
    // ignore corrupted cache
  }
  return null;
}

export function saveFundamentalGoldSnapshotToLocal(snapshot: FundamentalGoldSnapshot): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(FUNDAMENTAL_GOLD_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    dispatchMacroLocalSyncEvent();
  } catch {
    // ignore storage quota errors
  }
}

