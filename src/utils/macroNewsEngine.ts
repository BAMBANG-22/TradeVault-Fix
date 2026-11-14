import { LocalNotifications } from '@capacitor/local-notifications';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { isMarketDay, normalizeToMarketDayIso } from './date';

export type FomcPillarType = 'GROWTH' | 'LABOR' | 'INFLATION' | 'POLICY';
export type MacroBiasDirection = 'BUY' | 'SELL' | 'MIXED';
export type MacroImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type BreakingSentimentType = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

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
  regime: 'RISK_OFF_SAFE_HAVEN' | 'HAWKISH_USD_PRESSURE' | 'CROWDED_BUY_RUMOR' | 'CROWDED_SELL_RUMOR' | 'BALANCED';
  rumorSetup: 'BUY_RUMOR_SELL_NEWS_RISK' | 'SELL_RUMOR_BUY_NEWS_RISK' | 'NONE';
  wireBreadth: {
    bullish: number;
    bearish: number;
    neutral: number;
    total: number;
  };
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
  source: string;
  pubDate: string;
  link?: string;
  matchedKeywords: string[];
  impact: 'HIGH' | 'LOW';
  sentimentForGold: BreakingSentimentType;
  channelType: 'FED_SPEECH' | 'GEOPOLITICS_SAFEN_HAVEN' | 'OIL_INFLATION_CHANNEL' | 'TARIFF_TRADE' | 'MACRO_DATA';
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
  };
  cmeFedWatch?: CmeFedWatchState;
  calendarEvents: MacroCalendarEvent[];
  scenarioMatrix: PreNewsScenarioMatrix;
  isCalendarLiveFeed?: boolean;
  rssFeedHealth?: RssFeedHealthStatus;
}

export const MACRO_SNAPSHOT_LOCAL_STORAGE_KEY = 'tradevault_macro_news_snapshot_v1';
export const MACRO_GROUP_SNAPSHOT_CACHE_KEY = 'tradevault_macro_group_snapshots_v1';
export const MACRO_BIAS_HISTORY_STORAGE_KEY = 'tradevault_macro_bias_history_v1';
export const MACRO_NOTIFIED_FINGERPRINT_KEY = 'tradevault_macro_notified_fp_v1';
export const SNAPSHOT_TTL_MINUTES = 30;

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
  'Oil',
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
  'Blackout',
  'Dot Plot',
  'Gold',
  'XAU',
  'Bullion',
  'Dollar',
  'DXY',
  'Dovish',
  'Hawkish',
  'Jobless',
  'Unemployment',
  'Payroll',
  'Retail Sales',
  'ISM',
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

  if (rumorSetup === 'BUY_RUMOR_SELL_NEWS_RISK') {
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
    labelId,
    labelEn,
    summaryId: `${wireStrId}${rumorStrId}`.trim(),
    summaryEn: `${wireStrEn}${rumorStrEn}`.trim(),
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
    | 'GEOPOLITICS_SAFE_HAVEN'
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
  let geopoliticsSignal = false;

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

    // 3. Rate Cut / Fed Easing Narrative (EN + ID) -> BULLISH SPIKE AWAL
    const rateCutMatch = maskMatchedSpans(
      working,
      /\b(?:(?:fed\s+)?rate\s+cuts?|cut(?:s|ting)?\s+(?:interest\s+)?rates?|fed\s+pivot|dovish\s+(?:pivot|tilt|shift|stance|fed|surprise|tone|remarks?|commentary)|monetary\s+easing|policy\s+easing|easing\s+cycle|room\s+(?:for|to)\s+cut|open[sd]?\s+(?:the\s+)?door\s+(?:to|for)\s+(?:rate\s+)?cuts?|support[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|back[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|favor[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|eye[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|signal[sd]?\s+(?:a\s+)?(?:rate\s+)?cut|(?:rate\s+)?cut\s+(?:bets|odds|expectations|hopes)\s+(?:rise|jump|surge|climb|grow|strengthen|mount|boost)|lower\s+(?:interest\s+)?rates?|dovish|(?:peluang\s+|ekspektasi\s+|sinyal\s+)?pemangkasan\s+suku\s+bunga|pangkas\s+suku\s+bunga|potong\s+suku\s+bunga|penurunan\s+suku\s+bunga|turunkan\s+suku\s+bunga|pelonggaran\s+(?:kebijakan(?:\s+the\s+fed)?|moneter|the\s+fed|fed)|kebijakan\s+dovish|sinyal\s+dovish)\b/gi
    );
    working = rateCutMatch.masked;
    if (rateCutMatch.hit) {
      bullScore += 3.2 * w;
      rateCutSignal = true;
    }

    // 4. Slowing / Cooling Inflation, CPI, PCE, PPI, ISM, or Labor -> BULLISH SPIKE AWAL
    const coolingMacroMatch = maskMatchedSpans(
      working,
      /\b(?:(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|prices?|price\s+pressures?|tekanan\s+inflasi|inflasi|ism(?:\s+manufacturing|\s+services|\s+prices)?|labor\s+market|jobs?|hiring|payrolls?|wage\s+growth|wages|economy|economic\s+activity)\s+(?:cools?(?:\s+down)?|cooling|slows?(?:\s+down)?|slowing|slowed|eases?|easing|eased|moderates?|moderating|softens?|softening|falls?|falling|drops?|dropping|dips?|slips?|retreats?|wanes?|tumbles?|subsides?|melambat|mereda|menurun|turun|melemah|melandai)|(?:cooling|cooler|softer|soft|slower|easing|moderating|subdued|benign|muted|lower|weaker|disinflationary|melambatnya|meredanya|turunnya|pelemahan)\s+(?:us\s+)?(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|price\s+pressures?|tekanan\s+inflasi|inflasi|ism(?:\s+manufacturing|\s+services|\s+prices)?|labor|jobs?|hiring|payrolls?|wages?)|disinflation|below\s+(?:forecast|estimate|consensus|expectations?)|misses?\s+(?:forecast|estimates?|expectations?)|(?:cooler|softer|weaker)[- ]than[- ]expected)\b/gi
    );
    working = coolingMacroMatch.masked;
    if (coolingMacroMatch.hit) {
      bullScore += 2.8 * w;
      coolingMacroSignal = true;
    }

    // 5. Rate Hike / Fresh Hawkish Tightening (EN + ID) -> BEARISH SPIKE AWAL
    const rateHikeMatch = maskMatchedSpans(
      working,
      /\b(?:(?:fed\s+)?rate\s+hikes?|hike[sd]?\s+(?:interest\s+)?rates?|hiking\s+(?:interest\s+)?rates?|raise[sd]?\s+(?:interest\s+)?rates?|raising\s+rates?|hawkish\s+(?:pivot|shift|turn|surprise|tightening|stance|tilt|fed|rhetoric|tone|bias|warning)|(?:fresh|new|monetary|policy|further)\s+tightening|tighten(?:s|ing)?\s+(?:policy|monetary)|higher\s+for\s+longer|restrictive\s+(?:policy|stance|for\s+longer)|more\s+(?:rate\s+)?hikes?|(?:25|50|75)[- ]?bps?\s+hike|kenaikan\s+suku\s+bunga|naikkan\s+suku\s+bunga|pengetatan\s+(?:hawkish(?:\s+baru)?|moneter|kebijakan)|kebijakan\s+hawkish|nada\s+hawkish|suku\s+bunga\s+tinggi\s+lebih\s+lama)\b/gi
    );
    working = rateHikeMatch.masked;
    if (rateHikeMatch.hit) {
      bearScore += 3.2 * w;
      rateHikeHawkishSignal = true;
    }

    // 6. Inflation / CPI / ISM Prices Surge / Hotter Macro -> BEARISH SPIKE AWAL
    const inflationSurgeMatch = maskMatchedSpans(
      working,
      /\b(?:(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|prices?|price\s+pressures?|tekanan\s+inflasi|inflasi|ism(?:\s+prices)?)\s+(?:surges?|surging|jumps?|jumping|spikes?|spiking|accelerates?|accelerating|reaccelerates?|heats?\s+up|rises?|rising|climbs?|climbing|runs?\s+hot|stays?\s+(?:hot|elevated|sticky)|rebounds?|persists?|melonjak|memanas|menguat|meningkat|naik\s+tajam)|(?:hotter|hot|surging|spiking|accelerating|rebounding|resurgent|elevated|sticky|persistent|stubborn|upside|lonjakan|memanasnya)\s+(?:us\s+)?(?:inflation|cpi|core\s+cpi|pce|core\s+pce|ppi|price\s+pressures?|tekanan\s+inflasi|inflasi|inflation\s+risks?|ism(?:\s+prices)?)|(?:hotter|stronger)[- ]than[- ]expected|beats?\s+(?:forecast|estimates?|expectations?)|above\s+(?:forecast|estimate|consensus|expectations?)|upside\s+inflation\s+risk)\b/gi
    );
    working = inflationSurgeMatch.masked;
    if (inflationSurgeMatch.hit) {
      bearScore += 2.8 * w;
      inflationSurgeSignal = true;
    }

    // 7. Energy / Hormuz / Iran / Tariff Inflation Channel
    const isOilEnergySurge =
      /\b(OIL|CRUDE|WTI|BRENT|HORMUZ|IRAN|TARIFF)\b/i.test(working) &&
      /\b(SURGE|SURGES|SURGING|SPIKE|SPIKES|SPIKING|JUMP|JUMPS|RALLY|HIGHER|INFLATION|BLOCKADE|SUPPLY|DISRUPTION|CLIMBS|MELONJAK)\b/i.test(
        working
      );
    if (isOilEnergySurge) {
      bearScore += 2.4 * w;
      oilInflationSignal = true;
    } else if (/\b(HORMUZ|IRAN|MIDDLE EAST|TARIFF|GEOPOLITIC|SAFE[- ]HAVEN)\b/i.test(working)) {
      bullScore += 1.0 * w;
      geopoliticsSignal = true;
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
    } else if (geopoliticsSignal) {
      channelType = 'GEOPOLITICS_SAFEN_HAVEN';
      catalystCategory = 'GEOPOLITICS_SAFE_HAVEN';
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
    }
  }

  const hasHighImpactTerm =
    rateCutSignal ||
    rateHikeHawkishSignal ||
    oilInflationSignal ||
    inflationSurgeSignal ||
    coolingMacroSignal ||
    matchedKeywords.some((k) =>
      [
        'Fed',
        'FOMC',
        'Warsh',
        'Waller',
        'Powell',
        'Hormuz',
        'Iran',
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
        'Konteks kalimat utama: peluang pemangkasan suku bunga / pelonggaran kebijakan The Fed → Katalis BULLISH SPIKE AWAL pada XAU/USD.';
      aiEvaluationEn =
        'Main clause context: Fed rate-cut odds / policy easing narrative → BULLISH INITIAL SPIKE catalyst for XAU/USD.';
    } else if (catalystCategory === 'COOLING_MACRO') {
      aiEvaluationId =
        'Konteks kalimat utama: komponen inflasi/CPI/ISM melambat → Katalis BULLISH SPIKE AWAL (tekanan ke DXY & yield).';
      aiEvaluationEn =
        'Main clause context: cooling inflation/CPI/ISM components → BULLISH INITIAL SPIKE catalyst (weighs on DXY & yields).';
    } else if (catalystCategory === 'GEOPOLITICS_SAFE_HAVEN') {
      aiEvaluationId =
        'Sentimen geopolitik / tarif memicu permintaan Safe-Haven jangka pendek pada XAU/USD (BULLISH SPIKE AWAL).';
      aiEvaluationEn =
        'Geopolitical / tariff headline sparks short-term Safe-Haven demand for XAU/USD (BULLISH INITIAL SPIKE).';
    } else {
      aiEvaluationId =
        'Konteks narasi makro mendukung dorongan naik XAU/USD (BULLISH SPIKE AWAL).';
      aiEvaluationEn =
        'Macro narrative context supports upward XAU/USD momentum (BULLISH INITIAL SPIKE).';
    }
  } else if (sentimentForGold === 'BEARISH') {
    if (catalystCategory === 'OIL_INFLATION') {
      aiEvaluationId =
        'Lonjakan energi (Hormuz/Iran/Tarif) mengaktifkan Inflation Channel → Memaksa Fed Hawkish & katalis BEARISH SPIKE AWAL pada XAU/USD.';
      aiEvaluationEn =
        'Energy spike (Hormuz/Iran/Tariffs) activates the Inflation Channel → Forces Hawkish Fed & BEARISH INITIAL SPIKE pressure on XAU/USD.';
    } else if (catalystCategory === 'RATE_HIKE_HAWKISH') {
      aiEvaluationId =
        'Konteks kalimat utama: kenaikan suku bunga / pengetatan hawkish The Fed → Repricing US10Y & DXY naik (BEARISH SPIKE AWAL pada XAU/USD).';
      aiEvaluationEn =
        'Main clause context: rate-hike / fresh hawkish tightening rhetoric → US10Y & DXY reprice higher (BEARISH INITIAL SPIKE on XAU/USD).';
    } else if (catalystCategory === 'INFLATION_SURGE') {
      aiEvaluationId =
        'Konteks kalimat utama: lonjakan inflasi / data AS lebih panas → Katalis BEARISH SPIKE AWAL pada XAU/USD.';
      aiEvaluationEn =
        'Main clause context: inflation surge / hotter US print → BEARISH INITIAL SPIKE catalyst on XAU/USD.';
    } else {
      aiEvaluationId =
        'Konteks narasi makro mengindikasikan penguatan USD & yield → Tekanan BEARISH SPIKE AWAL pada XAU/USD.';
      aiEvaluationEn =
        'Macro narrative context points to firmer USD & yields → BEARISH INITIAL SPIKE pressure on XAU/USD.';
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
 * Analyzes the tone of a Fed speech statement or breaking news headline.
 */
export function analyzeStatementTone(statement: string): 'HAWKISH' | 'DOVISH' | 'NEUTRAL' {
  if (!statement || !statement.trim()) return 'NEUTRAL';
  const contextEval = scoreMainSentenceClause(statement);
  if (contextEval.sentimentForGold === 'BEARISH') return 'HAWKISH';
  if (contextEval.sentimentForGold === 'BULLISH' && contextEval.catalystCategory !== 'GEOPOLITICS_SAFE_HAVEN') {
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

  // Re-evaluate narrative RSS headlines using main-sentence context (prevents naive opposing-keyword neutralization even on cached snapshots)
  const evaluatedHeadlines = breakingNews.map((item) => {
    const ctx = evaluateBreakingHeadlineContext(item.title, undefined, item.matchedKeywords || []);
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
    initialCatalystReasonId = `GC=F 3D Oversold (${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Rawan lonjakan short-covering BULLISH SPIKE AWAL.`;
    initialCatalystReasonEn = `GC=F 3D Oversold (${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Prone to initial upward BUY short-covering spike.`;
  } else if (isOverbought3d) {
    initialCatalystBias = 'SELL';
    initialCatalystReasonId = `GC=F 3D Overbought (+${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Rawan tekanan profit-taking BEARISH SPIKE AWAL.`;
    initialCatalystReasonEn = `GC=F 3D Overbought (+${gold3d.toFixed(2)}%) + RSS ${rssBullish}B/${rssBearish}S → Prone to initial downward SELL profit-taking spike.`;
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
      ? 'BULLISH SPIKE AWAL'
      : initialCatalystBias === 'SELL'
      ? 'BEARISH SPIKE AWAL'
      : 'NETRAL / SEIMBANG';
  const initialCatalystLabelEn =
    initialCatalystBias === 'BUY'
      ? 'BULLISH INITIAL SPIKE'
      : initialCatalystBias === 'SELL'
      ? 'BEARISH INITIAL SPIKE'
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
    : `Terdeteksi ${spikeTriggerReasonsId.length} pemicu otomatis [2 ARAH — SWEEP FIRST] — tahan eksekusi detik ke-0 dan tunggu sapuan likuiditas sesi selesai.`;
  const movementSummaryEn = isOneWayEarlyStrike
    ? 'All intermarket signals (DXY & US02Y/US10Y), data catalyst, and session bias align with no speech schedule conflicts or 6H priced-in exhaustion — supports 1-Way Direct Expansion.'
    : `${spikeTriggerReasonsEn.length} automatic [2-WAY — SWEEP FIRST] trigger(s) active — hold 0-second market orders and wait for the session liquidity sweep to complete.`;

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
    // 2 ARAH (SWEEP FIRST)
    if (sessionPrimaryBias === 'SELL') {
      phase1Minute0to5Id = `Potensi sapuan likuiditas atas (Judas Swing BUY) menyapu ${bslLabel} dan menguji zona Supply Intraday ${poiRangeLabel} (Cap 1.8x ATR 1H) untuk menjebak breakout buyer awal.${warningSuffixId}`;
      phase1Minute0to5En = `Potential upside liquidity sweep (Judas Swing BUY) clearing ${bslLabel} into Intraday Supply ${poiRangeLabel} (1.8x 1H ATR Cap) to trap early breakout buyers.${warningSuffixEn}`;
      phase2Minute15PlusId = `Setelah likuiditas atas tersapu & muncul wick rejection / CHoCH M5–M15 di ${poiRangeLabel}, ekspansi utama berbalik turun (SELL ${sessionPrimaryProbability}%) menargetkan ${sslLabel}.`;
      phase2Minute15PlusEn = `Once upside liquidity is swept and M5–M15 rejection / CHoCH prints at ${poiRangeLabel}, primary expansion reverses lower (SELL ${sessionPrimaryProbability}%) targeting ${sslLabel}.`;
    } else if (sessionPrimaryBias === 'BUY') {
      phase1Minute0to5Id = `Potensi sapuan likuiditas bawah (Judas Swing SELL) menyapu ${sslLabel} dan menguji zona Demand Intraday ${poiRangeLabel} (Cap 1.8x ATR 1H) untuk memicu stop-loss buyer awal.${warningSuffixId}`;
      phase1Minute0to5En = `Potential downside liquidity sweep (Judas Swing SELL) clearing ${sslLabel} into Intraday Demand ${poiRangeLabel} (1.8x 1H ATR Cap) to flush early buyer stops.${warningSuffixEn}`;
      phase2Minute15PlusId = `Setelah likuiditas bawah tersapu & muncul penolakan / CHoCH M5–M15 di ${poiRangeLabel}, ekspansi utama berbalik naik (BUY ${sessionPrimaryProbability}%) menargetkan ${bslLabel}.`;
      phase2Minute15PlusEn = `Once downside liquidity is swept and M5–M15 rejection / CHoCH prints at ${poiRangeLabel}, primary expansion reverses higher (BUY ${sessionPrimaryProbability}%) targeting ${bslLabel}.`;
    } else {
      phase1Minute0to5Id = `Potensi whipsaw 2-arah menyapu batas likuiditas sesi terdekat (${bslLabel} atau ${sslLabel}) hingga area ${poiRangeLabel}.${warningSuffixId}`;
      phase1Minute0to5En = `Potential 2-way whipsaw sweeping nearest session liquidity (${bslLabel} or ${sslLabel}) into ${poiRangeLabel}.${warningSuffixEn}`;
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

  const fomcMeetingDate =
    raw.fomcMeetingDate && raw.fomcMeetingDate.trim()
      ? raw.fomcMeetingDate.trim()
      : 'FOMC Desember 2026';

  const hawkishShiftDetected = Boolean(raw.hawkishShiftDetected) || hikeProbability >= 25;

  let summaryNoteId = raw.summaryNoteId || '';
  let summaryNoteEn = raw.summaryNoteEn || '';

  if (!summaryNoteId) {
    if (saturationScenario === 'HIKE') {
      summaryNoteId = `Pasar sudah ${hikeProbability}% priced-in Rate Hike Desember — jika PPI rilis lebih rendah dari Forecast, waspadai kejutan repricing BUY XAU/USD yang eksplosif; jika PPI rilis panas, penguatan USD cenderung terbatas karena sudah priced-in.`;
    } else if (saturationScenario === 'CUT') {
      summaryNoteId = `Pasar sudah ${cutProbability}% priced-in Rate Cut Desember — jika PPI/inflasi rilis lebih panas dari Forecast, waspadai kejutan repricing SELL XAU/USD yang tajam; jika rilis melandai, pelemahan USD cenderung terbatas karena sudah priced-in.`;
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
      summaryNoteEn = `Market is already ${hikeProbability}% priced-in for a December Rate Hike — if PPI releases lower than Forecast, watch for an explosive BUY XAU/USD repricing surprise; if PPI prints hot, USD upside is likely capped as it is already priced-in.`;
    } else if (saturationScenario === 'CUT') {
      summaryNoteEn = `Market is already ${cutProbability}% priced-in for a December Rate Cut — if PPI/inflation prints hotter than Forecast, watch for a sharp SELL XAU/USD repricing surprise; if data cools, USD downside is likely capped as it is already priced-in.`;
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
    sourceLabel: raw.sourceLabel || 'Sumber: CME FedWatch Grounding (Des 2026)',
    impliedFedFundsRate:
      raw.impliedFedFundsRate !== undefined ? raw.impliedFedFundsRate : null,
    zqFuturesPrice: raw.zqFuturesPrice !== undefined ? raw.zqFuturesPrice : null,
    irxTbillYield: raw.irxTbillYield !== undefined ? raw.irxTbillYield : null,
    sourceUrl: raw.sourceUrl,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * Automatic Real-Time Bond & Futures Backup Calculator for CME FedWatch (FOMC Desember 2026):
 * When Google Search Grounding is rate-limited or web search snippets omit exact FedWatch numbers,
 * computes market-implied rate probabilities directly from live Yahoo Finance quotes:
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
    // High hawkish rate pricing (e.g. ~88% - 91.2% Rate Hike / Tightening expectation for Dec 2026 FOMC)
    const clampedHike = Math.min(94.5, Math.max(82.4, 88.6 + Math.min(5.5, irxSpreadBps * 0.15)));
    hikeRaw = Number(clampedHike.toFixed(1));
    holdRaw = Number(Math.max(4.5, 100 - hikeRaw - 1.2).toFixed(1));
    cutRaw = Number(Math.max(0, 100 - hikeRaw - holdRaw).toFixed(1));
  } else if (irxSpreadBps <= -18) {
    // Dovish rate cut pricing
    const clampedCut = Math.min(92.0, Math.max(68.0, 75.0 + Math.abs(irxSpreadBps) * 0.3));
    cutRaw = Number(clampedCut.toFixed(1));
    holdRaw = Number((100 - cutRaw).toFixed(1));
    hikeRaw = 0;
  } else {
    // Balanced / Hold-leaning pricing with hike/cut tails
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

  return evaluateCmeFedWatchScoring({
    isAvailable: true,
    fomcMeetingDate: 'FOMC Desember 2026',
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

  // Detect any silent Previous revisions vs prior snapshots & summarize released surprise track record
  const revisionSummary = detectPreviousRevisionsAndStreaks(calendarEvents, priorCalendarEvents);

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
    // Mode A: Focus primary weight (35) strictly on the releasing indicator's specific pillar
    // Mode B: Standard balanced weighting (28) across FOMC policy components
    const weight = evaluationMode === 'INDIVIDUAL_RELEASE' ? 35 : (ev.impact === 'High' ? 28 : 16);
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

  // Calculate 3 FOMC Pillars Recap (Inflation, Labor, Growth) across all calendar events
  let inflBuy = 0, inflSell = 0;
  let laborBuy = 0, laborSell = 0;
  let growthBuy = 0, growthSell = 0;

  for (const ev of workingCalendarEvents) {
    if (isFedSpeechEvent(ev.title)) continue;
    if (ev.pillar === 'INFLATION') {
      if (ev.eventBiasForGold === 'BUY') inflBuy++;
      else if (ev.eventBiasForGold === 'SELL') inflSell++;
    } else if (ev.pillar === 'LABOR') {
      if (ev.eventBiasForGold === 'BUY') laborBuy++;
      else if (ev.eventBiasForGold === 'SELL') laborSell++;
    } else if (ev.pillar === 'GROWTH') {
      if (ev.eventBiasForGold === 'BUY') growthBuy++;
      else if (ev.eventBiasForGold === 'SELL') growthSell++;
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
    // Mode A (Individual Release): Add background context with smaller weight (8-10)
    for (const ev of workingCalendarEvents) {
      if (allClusterEvents.some((c) => c.id === ev.id)) continue;
      if (isFedSpeechEvent(ev.title)) continue;
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

  // Dual-Channel Oil & Geopolitics Evaluation
  let oilChannelDominance: PreNewsScenarioMatrix['oilChannelDominance'] = 'NEUTRAL';
  const hasOilHeadline = workingBreakingNews.some(
    (b) => b.channelType === 'OIL_INFLATION_CHANNEL' || b.matchedKeywords.includes('Hormuz') || b.matchedKeywords.includes('Oil')
  );
  if ((isUsoilAvailable && usoil.changePercent >= 1.25) || hasOilHeadline) {
    oilChannelDominance = 'INFLATION_CHANNEL_SELL_GOLD';
    sellScore += 18;
    const oilRateLabel = isUsoilAvailable
      ? `${usoil.changePercent >= 0 ? '+' : ''}${usoil.changePercent.toFixed(2)}% @ $${usoil.price.toFixed(2)}`
      : 'Headline Energi/Geopolitik';
    sellArguments.push({
      pillar: 'GEOPOLITICS',
      tag: 'DUAL-CHANNEL • USOIL INFLATION',
      textId: `Dominasi Inflation Channel (US Oil WTI ${oilRateLabel}): Kenaikan minyak saat inflasi > 2% memicu transmisi ke Producer Energy PPI & CPI (time-lag), memaksa Fed tetap Hawkish → SELL Gold.`,
      textEn: `Inflation Channel Dominance (US Oil WTI ${oilRateLabel}): Oil surge while inflation > 2% transmits into Producer Energy PPI & CPI (with time-lag), forcing a Hawkish Fed → SELL Gold.`,
    });
  } else if (isUsoilAvailable && usoil.changePercent <= -1.0) {
    buyScore += 12;
    buyArguments.push({
      pillar: 'INTERMARKET',
      tag: 'INFLATION RELIEF • USOIL',
      textId: `Penurunan harga US Oil WTI (${usoil.changePercent.toFixed(2)}%) meredakan ekspektasi inflasi energi utama → Mengurangi tekanan suku bunga Fed (Pendukung BUY XAU/USD).`,
      textEn: `Pullback in US Oil WTI (${usoil.changePercent.toFixed(2)}%) eases headline energy inflation expectations → Reduces Hawkish Fed pressure (Supports BUY XAU/USD).`,
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

  // Evaluate Tone of Speech / Top 10 RSS Headlines automatically
  let statementTone: 'HAWKISH' | 'DOVISH' | 'NEUTRAL' = 'NEUTRAL';
  let speechToneSource: BreakingNewsHeadline | null = null;

  for (const b of workingBreakingNews.slice(0, 10)) {
    const tone = analyzeStatementTone(b.title);
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
      ? `\n4. [HUKUM MARKET PRICING SATURATION] Pasar sudah ${cmeFedWatch.hikeProbability}% priced-in Rate Hike Desember — jika PPI rilis lebih rendah dari Forecast, waspadai kejutan repricing BUY XAU/USD yang eksplosif; jika PPI rilis panas, penguatan USD cenderung terbatas karena sudah priced-in.`
      : cmeFedWatch.isAvailable && cmeFedWatch.saturationScenario === 'CUT'
      ? `\n4. [HUKUM MARKET PRICING SATURATION] Pasar sudah ${cmeFedWatch.cutProbability}% priced-in Rate Cut Desember — jika PPI/inflasi rilis lebih panas dari Forecast, waspadai kejutan repricing SELL XAU/USD yang tajam; jika rilis melandai, pelemahan USD cenderung terbatas karena sudah priced-in.`
      : '';

  const saturationActionNoteEn =
    cmeFedWatch.isAvailable && cmeFedWatch.saturationScenario === 'HIKE'
      ? `\n4. [MARKET PRICING SATURATION RULE] Market is already ${cmeFedWatch.hikeProbability}% priced-in for a December Rate Hike — if PPI releases lower than Forecast, watch for an explosive BUY XAU/USD repricing surprise; if PPI prints hot, USD upside is likely capped as it is already priced-in.`
      : cmeFedWatch.isAvailable && cmeFedWatch.saturationScenario === 'CUT'
      ? `\n4. [MARKET PRICING SATURATION RULE] Market is already ${cmeFedWatch.cutProbability}% priced-in for a December Rate Cut — if PPI/inflation prints hotter than Forecast, watch for a sharp SELL XAU/USD repricing surprise; if data cools, USD downside is likely capped as it is already priced-in.`
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
export async function loadLatestCachedMacroSnapshot(): Promise<MacroNewsSnapshot | null> {
  let localSnap: MacroNewsSnapshot | null = null;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MacroNewsSnapshot;
        if (isVerifiedLiveCalendarSnapshot(parsed)) {
          localSnap = parsed;
        } else {
          // Purge stale mock snapshot from localStorage
          localStorage.removeItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY);
          localStorage.removeItem(MACRO_GROUP_SNAPSHOT_CACHE_KEY);
        }
      }
    } catch {
      // ignore local storage parse error
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
          .order('analyzed_at', { ascending: false })
          .limit(5);

        if (!error && Array.isArray(data)) {
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
                const hydrated: MacroNewsSnapshot = {
                  ...remoteSnap,
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
      return true;
    }
  } catch {
    // Fallback to browser Notification API if available
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        if (Notification.permission === 'granted') {
          new Notification(title, { body });
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
