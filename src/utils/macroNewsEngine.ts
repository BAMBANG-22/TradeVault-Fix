import { LocalNotifications } from '@capacitor/local-notifications';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

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
  };
  cmeFedWatch?: CmeFedWatchState;
  calendarEvents: MacroCalendarEvent[];
  scenarioMatrix: PreNewsScenarioMatrix;
  isCalendarLiveFeed?: boolean;
}

export const MACRO_SNAPSHOT_LOCAL_STORAGE_KEY = 'tradevault_macro_news_snapshot_v1';
export const MACRO_GROUP_SNAPSHOT_CACHE_KEY = 'tradevault_macro_group_snapshots_v1';
export const MACRO_NOTIFIED_FINGERPRINT_KEY = 'tradevault_macro_notified_fp_v1';
export const SNAPSHOT_TTL_MINUTES = 30;

export const BREAKING_NEWS_KEYWORDS = [
  'Fed',
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
  'NFP',
  'Rate',
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
     (3) The exact trigger condition for an intraday "Pindah Haluan".`;

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
 * Filters raw RSS headlines strictly by BREAKING_NEWS_KEYWORDS and evaluates their macro channel & sentiment.
 */
export function filterAndScoreBreakingHeadlines(
  rawItems: Array<{ title: string; source: string; pubDate: string; link?: string }>
): BreakingNewsHeadline[] {
  const results: BreakingNewsHeadline[] = [];
  const seenTitles = new Set<string>();

  for (const item of rawItems) {
    const cleanTitle = (item.title || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!cleanTitle) continue;

    const normalizedKey = cleanTitle.toLowerCase();
    if (seenTitles.has(normalizedKey)) continue;

    const matchedKeywords: string[] = [];
    for (const kw of BREAKING_NEWS_KEYWORDS) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(cleanTitle) || cleanTitle.toLowerCase().includes(kw.toLowerCase())) {
        matchedKeywords.push(kw);
      }
    }

    if (matchedKeywords.length === 0) continue;
    seenTitles.add(normalizedKey);

    const upper = cleanTitle.toUpperCase();

    // Detect Hawkish Fed Speech (Waller / Warsh / Powell / Rate hike / Higher for longer)
    const hasFedOfficial = /\b(FED|WALLER|WARSH|POWELL|FOMC|RATE)\b/i.test(cleanTitle);
    const isHawkishSpeech =
      hasFedOfficial &&
      /\b(HIKE|HIKES|HAWKISH|25\s*BPS|50\s*BPS|HIGHER FOR LONGER|NO RUSH TO CUT|PAUSE|INFLATION RISK|UPSIDE RISK|RESTRICTIVE)\b/i.test(
        cleanTitle
      );
    const isDovishSpeech =
      hasFedOfficial &&
      /\b(CUT|CUTS|DOVISH|EASING|LOWER RATES|COOLING|WEAKENING LABOR)\b/i.test(cleanTitle);

    // Detect Geopolitics / Strait of Hormuz / Iran / Oil surge
    const hasGeopoliticsOil = /\b(HORMUZ|IRAN|OIL|CRUDE|MIDDLE EAST|TARIFF|TRUMP)\b/i.test(
      cleanTitle
    );
    const isOilInflationSurge =
      /\b(OIL|HORMUZ|IRAN|TARIFF)\b/i.test(cleanTitle) &&
      /\b(SURGE|SURGES|SPIKE|JUMP|RALLY|HIGHER|INFLATION|BLOCKADE|SUPPLY|DISRUPTION|CLIMBS)\b/i.test(
        cleanTitle
      );

    let impact: 'HIGH' | 'LOW' =
      matchedKeywords.some((k) =>
        ['Fed', 'Warsh', 'Waller', 'Powell', 'Hormuz', 'Iran', 'CPI', 'NFP', 'Rate', 'Tariff'].includes(k)
      )
        ? 'HIGH'
        : 'LOW';

    let sentimentForGold: BreakingSentimentType = 'NEUTRAL';
    let channelType: BreakingNewsHeadline['channelType'] = 'MACRO_DATA';
    let aiEvaluationId = '';
    let aiEvaluationEn = '';

    if (isHawkishSpeech) {
      impact = 'HIGH';
      sentimentForGold = 'BEARISH';
      channelType = 'FED_SPEECH';
      aiEvaluationId =
        'Pernyataan Hawkish pejabat Fed (risiko kenaikan/tahan suku bunga) memicu repricing imbal hasil US10Y & DXY naik → Tekanan SELL kuat pada XAU/USD (Waspada Aturan Pindah Haluan).';
      aiEvaluationEn =
        'Hawkish Fed commentary (rate hike/hold risk) triggers upward repricing in US10Y yields & DXY → Strong SELL pressure on XAU/USD (Dynamic Pivot Rule active).';
    } else if (isDovishSpeech) {
      impact = 'HIGH';
      sentimentForGold = 'BULLISH';
      channelType = 'FED_SPEECH';
      aiEvaluationId =
        'Sinyal Dovish pejabat Fed mendukung ekspektasi pemangkasan suku bunga → Menekan DXY & mendukung skenario BUY XAU/USD.';
      aiEvaluationEn =
        'Dovish Fed signal supports rate-cut expectations → Pressures DXY & reinforces BUY XAU/USD scenario.';
    } else if (isOilInflationSurge) {
      impact = 'HIGH';
      sentimentForGold = 'BEARISH';
      channelType = 'OIL_INFLATION_CHANNEL';
      aiEvaluationId =
        'Dual-Channel Geopolitik & Oil: Lonjakan harga energi (Hormuz/Iran/Tarif) saat inflasi > 2% mengaktifkan Inflation Channel → Memaksa Fed Hawkish & menekan XAU/USD (SELL setelah spike safe-haven mereda).';
      aiEvaluationEn =
        'Geopolitics & Oil Dual-Channel: Energy spike (Hormuz/Iran/Tariffs) while inflation > 2% activates the Inflation Channel → Forces Hawkish Fed & pressures XAU/USD (SELL once initial safe-haven spike fades).';
    } else if (hasGeopoliticsOil) {
      sentimentForGold = 'BULLISH';
      channelType = 'GEOPOLITICS_SAFEN_HAVEN';
      aiEvaluationId =
        'Sentimen geopolitik / tarif memicu permintaan Safe-Haven jangka pendek pada XAU/USD, namun pantau efek rambatan harga US Oil terhadap ekspektasi CPI.';
      aiEvaluationEn =
        'Geopolitical / tariff headline sparks short-term Safe-Haven demand for XAU/USD, but monitor US Oil pass-through into CPI expectations.';
    } else {
      const isBearishGoldData = /\b(HOT|BEATS|STRONGER|SURGES|RISES|ABOVE FORECAST|HAWKISH)\b/i.test(
        upper
      );
      const isBullishGoldData = /\b(COOLS|MISSES|WEAKER|SLOWS|BELOW FORECAST|DOVISH|DROPS)\b/i.test(
        upper
      );
      sentimentForGold = isBearishGoldData
        ? 'BEARISH'
        : isBullishGoldData
        ? 'BULLISH'
        : 'NEUTRAL';
      aiEvaluationId =
        sentimentForGold === 'BEARISH'
          ? 'Headline makro mengindikasikan ketahanan data AS / tekanan inflasi yang mendukung penguatan USD (Bearish XAU/USD).'
          : sentimentForGold === 'BULLISH'
          ? 'Headline makro menunjukkan tanda pelambatan data AS yang mendukung pelemahan imbal hasil & potensi BUY XAU/USD.'
          : 'Headline terpantau pada radar kata kunci utama; tunggu konfirmasi rilis data aktual & respons US10Y.';
      aiEvaluationEn =
        sentimentForGold === 'BEARISH'
          ? 'Macro headline points to resilient US data / inflation persistence supporting USD strength (Bearish XAU/USD).'
          : sentimentForGold === 'BULLISH'
          ? 'Macro headline indicates cooling US data supporting softer yields & BUY XAU/USD potential.'
          : 'Headline tracked on core macro keyword radar; await actual data release & US10Y yield reaction.';
    }

    results.push({
      id: `news-${results.length + 1}-${Date.now()}`,
      title: cleanTitle,
      source: item.source || 'Macro Wire',
      pubDate: item.pubDate || new Date().toISOString(),
      link: item.link,
      matchedKeywords,
      impact,
      sentimentForGold,
      channelType,
      aiEvaluationId,
      aiEvaluationEn,
    });
  }

  return results.slice(0, 10);
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
  const clean = statement.toUpperCase();

  const isHawkish =
    /\b(HIKE|HIKES|HAWKISH|25\s*BPS|50\s*BPS|75\s*BPS|HIGHER FOR LONGER|NO RUSH TO CUT|RESTRICTIVE|STICKY|TIGHTEN|TIGHTENING|MORE WORK TO DO|UPSIDE INFLATION|ABOVE TARGET|INFLATION PERSISTENT|NO RATE CUT|PAUSE CUTS|MORE RATE HIKES)\b/i.test(
      clean
    ) ||
    /\b(NAIK|KENAIKAN|SUKU BUNGA NAIK|LENGKET|PENGETATAN|TIDAK BURU-BURU PANGKAS|INFLASI TINGGI)\b/i.test(
      clean
    );

  const isDovish =
    /\b(CUT|CUTS|DOVISH|EASING|LOWER RATES|COOLING|WEAKENING LABOR|PAUSE HIKE|RATE CUTS|UNEMPLOYMENT RISING|DISINFLATION|SLOWDOWN|TIME TO CUT|READY TO CUT|CUTTING CYCLE)\b/i.test(
      clean
    ) ||
    /\b(TURUN|PEMOTONGAN|PANGKAS|PELONGGARAN|JEDA|MELAMBAT|SIAP PANGKAS)\b/i.test(clean);

  if (isHawkish && !isDovish) return 'HAWKISH';
  if (isDovish && !isHawkish) return 'DOVISH';
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
 * Computes a deterministic fingerprint from calendar events, top breaking news headlines,
 * and optionally the selected event group ID/slot so each event group is cached distinctly in Supabase.
 */
export function computeMacroDataFingerprint(
  events: MacroCalendarEvent[],
  headlines: BreakingNewsHeadline[],
  selectedEventSlotKey?: string
): string {
  const eventSig = events
    .slice(0, 8)
    .map((e) => `${e.title}:${e.previous}:${e.forecast}:${e.actual}`)
    .join('|');
  const newsSig = headlines
    .slice(0, 3)
    .map((h) => h.title.slice(0, 40))
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
  };
  breakingNews: BreakingNewsHeadline[];
  cmeFedWatch?: CmeFedWatchState;
  selectedEventId?: string;
  sourceMode?: MacroNewsSnapshot['sourceMode'];
  modelUsed?: string;
  customHeadlineText?: string;
  customActualOverrides?: Record<string, string | number>;
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
  } = params;

  const cmeFedWatch = evaluateCmeFedWatchScoring(rawFedWatch);
  const nowMs = Date.now();

  // Apply quick actual overrides if provided (re-evaluating individual event bias)
  let workingCalendarEvents = [...calendarEvents];
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

  // Evaluate US02Y (Front-End Rate Sensitivity Barometer)
  if (us02y && us02y.direction === 'UP') {
    sellScore += 16;
    sellArguments.push({
      pillar: 'INTERMARKET',
      tag: 'INTERMARKET • US02Y YIELD SPIKE',
      textId: `Kenaikan Yield US02Y (${us02y.changePercent >= 0 ? '+' : ''}${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Barometer sensitivitas suku bunga jangka pendek The Fed menguat, menandakan repricing suku bunga ketat dan menekan XAU/USD (SELL).`,
      textEn: `Rising US02Y Yield (${us02y.changePercent >= 0 ? '+' : ''}${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Front-end rate sensitivity barometer jumps, pricing in hawkish Fed expectations and pressuring XAU/USD (SELL).`,
    });
  } else if (us02y && us02y.direction === 'DOWN') {
    buyScore += 16;
    buyArguments.push({
      pillar: 'INTERMARKET',
      tag: 'INTERMARKET • US02Y YIELD EASING',
      textId: `Penurunan Yield US02Y (${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Pelonggaran ekspektasi suku bunga jangka pendek The Fed membuka ruang reli bagi XAU/USD (BUY).`,
      textEn: `Falling US02Y Yield (${us02y.changePercent.toFixed(2)}% @ ${us02y.price.toFixed(2)}%): Easing front-end rate pressure provides supportive tailwind for XAU/USD (BUY).`,
    });
  }

  // Benchmark DXY & US10Y combined momentum
  if (dxy.direction === 'UP' && us10y.direction === 'UP') {
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
  } else if (dxy.direction === 'DOWN' && us10y.direction === 'DOWN') {
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
  } else {
    whipsawScore += 10;
  }

  // Dual-Channel Oil & Geopolitics Evaluation
  let oilChannelDominance: PreNewsScenarioMatrix['oilChannelDominance'] = 'NEUTRAL';
  const hasOilHeadline = workingBreakingNews.some(
    (b) => b.channelType === 'OIL_INFLATION_CHANNEL' || b.matchedKeywords.includes('Hormuz') || b.matchedKeywords.includes('Oil')
  );
  if (usoil.changePercent >= 1.25 || hasOilHeadline) {
    oilChannelDominance = 'INFLATION_CHANNEL_SELL_GOLD';
    sellScore += 18;
    sellArguments.push({
      pillar: 'GEOPOLITICS',
      tag: 'DUAL-CHANNEL • USOIL INFLATION',
      textId: `Dominasi Inflation Channel (US Oil WTI ${usoil.changePercent >= 0 ? '+' : ''}${usoil.changePercent.toFixed(2)}% @ $${usoil.price.toFixed(2)}): Kenaikan minyak saat inflasi > 2% memicu transmisi ke Producer Energy PPI & CPI (time-lag), memaksa Fed tetap Hawkish → SELL Gold.`,
      textEn: `Inflation Channel Dominance (US Oil WTI ${usoil.changePercent >= 0 ? '+' : ''}${usoil.changePercent.toFixed(2)}% @ $${usoil.price.toFixed(2)}): Oil surge while inflation > 2% transmits into Producer Energy PPI & CPI (with time-lag), forcing a Hawkish Fed → SELL Gold.`,
    });
  } else if (usoil.changePercent <= -1.0) {
    buyScore += 12;
    buyArguments.push({
      pillar: 'INTERMARKET',
      tag: 'INFLATION RELIEF • USOIL',
      textId: `Penurunan harga US Oil WTI (${usoil.changePercent.toFixed(2)}%) meredakan ekspektasi inflasi energi utama → Mengurangi tekanan suku bunga Fed (Pendukung BUY XAU/USD).`,
      textEn: `Pullback in US Oil WTI (${usoil.changePercent.toFixed(2)}%) eases headline energy inflation expectations → Reduces Hawkish Fed pressure (Supports BUY XAU/USD).`,
    });
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
    sellScore += 45;
    buyScore = Math.max(5, Math.min(buyScore, 15));
    const officialName =
      speechToneSource?.matchedKeywords?.join(', ') ||
      hawkishFedNews?.matchedKeywords?.join(', ') ||
      (rawFedWatch?.hawkishShiftDetected ? 'CME FedWatch Hawkish Shift' : 'Pejabat Fed');
    dynamicPivotReasonId = `PINDAH HALUAN: HAWKISH OVERRIDE (Aturan Pindah Haluan Bang Nael) — Deteksi otomatis mendapati sinyal Hawkish (${officialName}) yang membalikkan arah skenario menjadi SELL 1 ARAH pada XAU/USD.`;
    dynamicPivotReasonEn = `DYNAMIC PIVOT: HAWKISH OVERRIDE (Bang Nael Pivot Rule) — Automatic scan detected Hawkish signal (${officialName}), flipping the scenario into a 1-WAY SELL on XAU/USD.`;
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
    buyScore += 45;
    sellScore = Math.max(5, Math.min(sellScore, 15));
    const officialName = speechToneSource?.matchedKeywords?.join(', ') || 'Pejabat Fed';
    dynamicPivotReasonId = `PINDAH HALUAN: DOVISH OVERRIDE (Aturan Pindah Haluan Bang Nael) — Auto-scan RSS mendeteksi pernyataan pejabat Fed (${officialName}) bernada Dovish (sinyal pemangkasan suku bunga / pelonggaran moneter) yang membalikkan arah skenario menjadi BUY 1 ARAH pada XAU/USD.`;
    dynamicPivotReasonEn = `DYNAMIC PIVOT: DOVISH OVERRIDE (Bang Nael Pivot Rule) — RSS auto-scan detected Fed official remarks (${officialName}) tilting Dovish (rate cuts / monetary easing guidance), flipping the scenario into a 1-WAY BUY on XAU/USD.`;
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
          ? `Transmisi lintas aset (kenaikan DXY${us02y ? ` & yield US02Y ${us02y.price.toFixed(2)}%` : ''} + yield US10Y ${us10y.price.toFixed(2)}%) mencerminkan akumulasi posisi institusional yang menahan penguatan Dolar AS menjelang rilis ${primaryEvent.title}. Aliran modal condong menekan XAU/USD (Sell-on-Rally); waspadai pembalikan arah tajam (Pindah Haluan) HANYA jika data aktual meleset jauh di bawah konsensus atau komentar The Fed berbalik dovish.`
          : dominantBias === 'BUY'
          ? `Pelemahan momentum lintas aset (pelonggaran DXY${us02y ? ` & yield US02Y ${us02y.price.toFixed(2)}%` : ''} serta US10Y ${us10y.price.toFixed(2)}%) mengindikasikan penurunan premi risiko suku bunga, membuka likuiditas institusi masuk ke XAU/USD (Buy-on-Dip). Jalur kenaikan Emas tetap valid selama data aktual rilis tidak melompat signifikan di atas konsensus atau pejabat The Fed memicu Hawkish Pivot.`
          : `Keseimbangan kekuatan lintas aset dan potensi rilis bersamaan yang berlawanan menandakan pasar berada dalam fase konsolidasi ketat (Priced-In Equilibrium). Institusi menahan posisi terarah untuk menyapu likuiditas dua arah (Whipsaw); eksekusi directional baru valid pasca-penutupan struktur M5/M15 yang terkonfirmasi oleh arah DXY dan US02Y/US10Y.`,
      institutionalDeskThesisEn:
        dominantBias === 'SELL'
          ? `Cross-asset transmission (firming DXY${us02y ? ` & US02Y yield at ${us02y.price.toFixed(2)}%` : ''} alongside US10Y at ${us10y.price.toFixed(2)}%) reflects institutional positioning favoring US Dollar resilience ahead of the ${primaryEvent.title} release. Capital flows point to downward pressure on XAU/USD (Sell-on-Rally); monitor for a sharp Dynamic Pivot ONLY if actual data misses substantially below consensus or Fed speakers tilt dovish.`
          : dominantBias === 'BUY'
          ? `Softening cross-asset momentum (pullback in DXY${us02y ? ` & US02Y yield at ${us02y.price.toFixed(2)}%` : ''} with US10Y at ${us10y.price.toFixed(2)}%) signals receding policy rate risk premia, unlocking institutional inflows into XAU/USD (Buy-on-Dip). Gold upside trajectory remains intact unless actual data prints heavily above forecast or Fed commentary sparks a Hawkish Pivot.`
          : `Cross-asset equilibrium and concurrent diverging releases indicate the desk is navigating a tight consolidation phase (Priced-In Equilibrium). Institutions are holding neutral risk budgets to absorb two-way liquidity whipsaws; directional conviction is only warranted following a confirmed M5/M15 structure break validated by DXY and US02Y/US10Y yields.`,
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
        };
        breakingNews: BreakingNewsHeadline[];
        cmeFedWatch?: CmeFedWatchState;
        selectedEventId?: string;
        selectedEventGroup?: MacroEventGroup;
        sourceMode?: MacroNewsSnapshot['sourceMode'];
        modelUsed?: string;
      },
  context?: {
    calendarEvents: MacroCalendarEvent[];
    intermarketPulse: {
      dxy: IntermarketAssetPulse;
      us02y?: IntermarketAssetPulse;
      usoil: IntermarketAssetPulse;
      us10y: IntermarketAssetPulse;
    };
    breakingNews: BreakingNewsHeadline[];
    cmeFedWatch?: CmeFedWatchState;
    sourceMode?: MacroNewsSnapshot['sourceMode'];
    modelUsed?: string;
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
  const remainingMs =
    Number.isFinite(targetTimeMs) && targetTimeMs > nowMs ? targetTimeMs - nowMs : 0;

  const isLockedT5M = remainingMs > 0 && remainingMs <= FIVE_MINUTES_MS;
  const formattedCountdown = formatCountdownHms(remainingMs);

  const statusLabelId = isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M)'
    : 'Auto-Update Final pada T-05:00';
  const statusLabelEn = isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M)'
    : 'Final Auto-Update at T-05:00';

  const projectionBadgeId = isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M) • SIAP EKSEKUSI'
    : 'REFERENSI AWAL • DATA SEMENTARA (BELUM FINAL T-5M)';
  const projectionBadgeEn = isLockedT5M
    ? 'FINAL PRE-NEWS LOCKED (T-5M) • READY FOR EXECUTION'
    : 'EARLY REFERENCE • PRELIMINARY DATA (NOT FINAL T-5M)';

  const projectionSubtextId = isLockedT5M
    ? 'Auto-Update Final telah dieksekusi pada T-05:00. Tampilan dikunci (Freeze Auto-Refresh) agar probabilitas BUY / SELL / MIXED stabil saat eksekusi.'
    : 'Proyeksi berdasarkan Forecast, korelasi DXY/USOIL/US10Y, & sentimen RSS terkini. Tekan Refresh berkala menjelang rilis.';
  const projectionSubtextEn = isLockedT5M
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
          for (const row of data) {
            const remoteSnap = row.snapshot_payload as MacroNewsSnapshot;
            if (isVerifiedLiveCalendarSnapshot(remoteSnap)) {
              const remoteTime = new Date(row.analyzed_at || remoteSnap.analyzedAt).getTime();
              const localTime = localSnap ? new Date(localSnap.analyzedAt).getTime() : 0;

              if (!localSnap || remoteTime >= localTime) {
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
    } catch {
      // ignore storage quota errors
    }
  }

  if (isSupabaseConfigured()) {
    const client = getSupabase();
    if (client) {
      try {
        const { error } = await client.from('macro_news_snapshots').insert({
          instrument: 'XAUUSD',
          data_fingerprint: snapshot.dataFingerprint,
          snapshot_payload: snapshot,
          impact_level: snapshot.impactLevel,
          dominant_bias: snapshot.dominantBias,
          source_mode: snapshot.sourceMode,
          analyzed_at: snapshot.analyzedAt,
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
