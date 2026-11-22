import { Trade, PeriodicReview, TradingAccount, PlaybookSetup } from '../types/trade';
import { AppSettings, DEFAULT_PLAYBOOKS, DEFAULT_PRE_TRADE_CHECKLIST } from '../types/settings';
import {
  calculatePerformance,
  extractTradeLocalDateKey,
} from './calculations';
import {
  resolveTradeLifecycle,
  isTradeClosedForRealizedMetrics,
} from './tradeLifecycle';
import {
  MACRO_SNAPSHOT_LOCAL_STORAGE_KEY,
  MACRO_GROUP_SNAPSHOT_CACHE_KEY,
  MacroCalendarEvent,
  MacroNewsSnapshot,
} from './macroNewsEngine';

export interface TagCatalogItem {
  id: string;
  labelId: string;
  labelEn: string;
  isPositive?: boolean;
}

export const MISTAKE_TAGS_CATALOG: TagCatalogItem[] = [
  { id: 'A_PLUS_SETUP', labelId: 'A+ Setup Disiplin', labelEn: 'A+ Disciplined Setup', isPositive: true },
  { id: 'FOMO', labelId: 'FOMO / Kejar Harga', labelEn: 'FOMO / Chasing' },
  { id: 'REVENGE', labelId: 'Revenge Trade', labelEn: 'Revenge Trade' },
  { id: 'OVERLOT', labelId: 'Overlot / Over-Risk', labelEn: 'Overlot / Over-Risk' },
  { id: 'EARLY_EXIT', labelId: 'Tutup Terlalu Cepat', labelEn: 'Early Exit' },
  { id: 'MOVE_SL', labelId: 'Geser / Lepas SL', labelEn: 'Moved / Removed SL' },
  { id: 'NO_PLAN', labelId: 'Tanpa Rencana / Impulsif', labelEn: 'Off-Plan / Impulsive' },
  { id: 'NEWS_GAMBLE', labelId: 'Judi Saat High News', labelEn: 'High-News Gamble' },
];

export const EMOTION_TAGS_CATALOG: TagCatalogItem[] = [
  { id: 'CALM', labelId: 'Tenang & Objektif', labelEn: 'Calm & Objective', isPositive: true },
  { id: 'CONFIDENT', labelId: 'Yakin Sesuai SOP', labelEn: 'Confident on Plan', isPositive: true },
  { id: 'HESITANT', labelId: 'Ragu-ragu', labelEn: 'Hesitant' },
  { id: 'ANXIOUS', labelId: 'Cemas / Tegang', labelEn: 'Anxious' },
  { id: 'GREEDY', labelId: 'Serakah / Euforia', labelEn: 'Greedy / Euphoric' },
  { id: 'FRUSTRATED', labelId: 'Frustrasi / Tilt', labelEn: 'Frustrated / Tilt' },
  { id: 'TIRED', labelId: 'Lelah / Kurang Fokus', labelEn: 'Tired / Unfocused' },
];

export interface ResolvedTradeBehavior {
  mistakeTags: string[];
  hasNegativeMistake: boolean;
  emotionTag?: string;
  accountId?: string;
  playbookId?: string;
  checklistPassed?: boolean;
  ruleCompliant?: boolean;
}

export function resolveTradeBehavior(trade: Trade): ResolvedTradeBehavior {
  const lifecycle = resolveTradeLifecycle(trade);
  const rawMistakes =
    Array.isArray(trade.mistakeTags) && trade.mistakeTags.length > 0
      ? trade.mistakeTags
      : Array.isArray(lifecycle.mistakeTags)
      ? lifecycle.mistakeTags
      : [];
  const mistakeTags = Array.from(new Set(rawMistakes.filter((t) => typeof t === 'string' && t.trim() !== '')));
  const hasNegativeMistake = mistakeTags.some((t) => t !== 'A_PLUS_SETUP');

  return {
    mistakeTags,
    hasNegativeMistake,
    emotionTag: trade.emotionTag || lifecycle.emotionTag,
    accountId: trade.accountId || lifecycle.accountId,
    playbookId: trade.playbookId || lifecycle.playbookId,
    checklistPassed:
      typeof trade.checklistPassed === 'boolean'
        ? trade.checklistPassed
        : lifecycle.checklistPassed,
    ruleCompliant:
      typeof trade.ruleCompliant === 'boolean'
        ? trade.ruleCompliant
        : lifecycle.ruleCompliant,
  };
}

export function getMistakeLabel(id: string, isEn: boolean): string {
  const found = MISTAKE_TAGS_CATALOG.find((item) => item.id === id);
  if (!found) return id;
  return isEn ? found.labelEn : found.labelId;
}

export function getEmotionLabel(id: string, isEn: boolean): string {
  const found = EMOTION_TAGS_CATALOG.find((item) => item.id === id);
  if (!found) return id;
  return isEn ? found.labelEn : found.labelId;
}

export interface MistakeCostRow {
  tagId: string;
  count: number;
  winCount: number;
  lossCount: number;
  netProfit: number;
  totalLossImpact: number;
  winRate: number;
}

export interface EmotionStatRow {
  emotionId: string;
  count: number;
  winRate: number;
  netProfit: number;
}

export interface BehavioralAnalyticsResult {
  taggedTradesCount: number;
  cleanTradesCount: number;
  mistakeTradesCount: number;
  cleanWinRate: number;
  mistakeWinRate: number;
  overallWinRate: number;
  cleanNetProfit: number;
  mistakeNetProfit: number;
  costOfMistakes: number; // positive dollar figure lost due to mistake trades (or 0 if net positive)
  ruleCompliantCount: number;
  ruleBrokenCount: number;
  checklistPassedCount: number;
  mistakeBreakdown: MistakeCostRow[];
  emotionBreakdown: EmotionStatRow[];
  topMistakeId?: string;
}

export function computeBehavioralAnalytics(trades: Trade[]): BehavioralAnalyticsResult {
  const closed = (trades || []).filter(isTradeClosedForRealizedMetrics);
  let taggedTradesCount = 0;
  let cleanTradesCount = 0;
  let cleanWins = 0;
  let cleanNetProfit = 0;
  let mistakeTradesCount = 0;
  let mistakeWins = 0;
  let mistakeNetProfit = 0;
  let ruleCompliantCount = 0;
  let ruleBrokenCount = 0;
  let checklistPassedCount = 0;
  let totalWins = 0;

  const mistakeMap = new Map<
    string,
    { count: number; winCount: number; lossCount: number; netProfit: number; totalLossImpact: number }
  >();
  const emotionMap = new Map<string, { count: number; winCount: number; netProfit: number }>();

  for (const t of closed) {
    const behavior = resolveTradeBehavior(t);
    const isWin = t.outcome === 'WIN';
    const isLoss = t.outcome === 'LOSS';
    if (isWin) totalWins += 1;

    if (behavior.ruleCompliant === true) ruleCompliantCount += 1;
    else if (behavior.ruleCompliant === false) ruleBrokenCount += 1;
    if (behavior.checklistPassed === true) checklistPassedCount += 1;

    const hasAnyTag = behavior.mistakeTags.length > 0 || Boolean(behavior.emotionTag);
    if (hasAnyTag) taggedTradesCount += 1;

    if (behavior.hasNegativeMistake || behavior.ruleCompliant === false) {
      mistakeTradesCount += 1;
      if (isWin) mistakeWins += 1;
      mistakeNetProfit += Number(t.netProfit) || 0;
    } else {
      cleanTradesCount += 1;
      if (isWin) cleanWins += 1;
      cleanNetProfit += Number(t.netProfit) || 0;
    }

    for (const tagId of behavior.mistakeTags) {
      if (tagId === 'A_PLUS_SETUP') continue;
      const cur = mistakeMap.get(tagId) || {
        count: 0,
        winCount: 0,
        lossCount: 0,
        netProfit: 0,
        totalLossImpact: 0,
      };
      cur.count += 1;
      if (isWin) cur.winCount += 1;
      if (isLoss) cur.lossCount += 1;
      cur.netProfit += Number(t.netProfit) || 0;
      if ((Number(t.netProfit) || 0) < 0) {
        cur.totalLossImpact += Math.abs(Number(t.netProfit) || 0);
      }
      mistakeMap.set(tagId, cur);
    }

    if (behavior.emotionTag) {
      const cur = emotionMap.get(behavior.emotionTag) || { count: 0, winCount: 0, netProfit: 0 };
      cur.count += 1;
      if (isWin) cur.winCount += 1;
      cur.netProfit += Number(t.netProfit) || 0;
      emotionMap.set(behavior.emotionTag, cur);
    }
  }

  const mistakeBreakdown: MistakeCostRow[] = Array.from(mistakeMap.entries())
    .map(([tagId, v]) => ({
      tagId,
      count: v.count,
      winCount: v.winCount,
      lossCount: v.lossCount,
      netProfit: Number(v.netProfit.toFixed(2)),
      totalLossImpact: Number(v.totalLossImpact.toFixed(2)),
      winRate: v.count > 0 ? Number(((v.winCount / v.count) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => a.netProfit - b.netProfit || b.count - a.count);

  const emotionBreakdown: EmotionStatRow[] = Array.from(emotionMap.entries())
    .map(([emotionId, v]) => ({
      emotionId,
      count: v.count,
      winRate: v.count > 0 ? Number(((v.winCount / v.count) * 100).toFixed(1)) : 0,
      netProfit: Number(v.netProfit.toFixed(2)),
    }))
    .sort((a, b) => b.count - a.count);

  const costOfMistakes = mistakeNetProfit < 0 ? Number(Math.abs(mistakeNetProfit).toFixed(2)) : 0;

  return {
    taggedTradesCount,
    cleanTradesCount,
    mistakeTradesCount,
    cleanWinRate: cleanTradesCount > 0 ? Number(((cleanWins / cleanTradesCount) * 100).toFixed(1)) : 0,
    mistakeWinRate:
      mistakeTradesCount > 0 ? Number(((mistakeWins / mistakeTradesCount) * 100).toFixed(1)) : 0,
    overallWinRate: closed.length > 0 ? Number(((totalWins / closed.length) * 100).toFixed(1)) : 0,
    cleanNetProfit: Number(cleanNetProfit.toFixed(2)),
    mistakeNetProfit: Number(mistakeNetProfit.toFixed(2)),
    costOfMistakes,
    ruleCompliantCount,
    ruleBrokenCount,
    checklistPassedCount,
    mistakeBreakdown,
    emotionBreakdown,
    topMistakeId: mistakeBreakdown[0]?.tagId,
  };
}

// =============================================================================
// MACRO NEWS CONTEXT MATCHER FOR TRADE DETAIL MODAL
// =============================================================================

export interface TradeMacroNewsMatch {
  eventId: string;
  title: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  timeIso: string;
  minutesDelta: number; // positive = event after trade entry, negative = event before trade entry
  proximity: 'IMMEDIATE' | 'SAME_DAY';
  actual?: string | null;
  forecast?: string | null;
}

function loadCachedMacroEvents(): MacroCalendarEvent[] {
  const events: MacroCalendarEvent[] = [];
  const seen = new Set<string>();

  const ingestSnapshot = (snap: MacroNewsSnapshot | null | undefined) => {
    if (!snap || !Array.isArray(snap.calendarEvents)) return;
    for (const ev of snap.calendarEvents) {
      if (!ev || !ev.id || !ev.title) continue;
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      events.push(ev);
    }
  };

  try {
    const rawPrimary = localStorage.getItem(MACRO_SNAPSHOT_LOCAL_STORAGE_KEY);
    if (rawPrimary) {
      ingestSnapshot(JSON.parse(rawPrimary));
    }
    const rawGroup = localStorage.getItem(MACRO_GROUP_SNAPSHOT_CACHE_KEY);
    if (rawGroup) {
      const parsed = JSON.parse(rawGroup);
      if (parsed && typeof parsed === 'object') {
        Object.values(parsed).forEach((entry: any) => {
          if (entry && entry.snapshot) ingestSnapshot(entry.snapshot);
          else ingestSnapshot(entry);
        });
      }
    }
  } catch {
    // ignore storage parse issues
  }

  return events;
}

export function findNearbyMacroEventsForTrade(trade: Trade): TradeMacroNewsMatch[] {
  if (!trade?.dateTime) return [];
  const tradeTs = new Date(trade.dateTime).getTime();
  if (!Number.isFinite(tradeTs)) return [];

  const tradeDateKey = extractTradeLocalDateKey(trade.dateTime);
  const cachedEvents = loadCachedMacroEvents();
  if (cachedEvents.length === 0) return [];

  const matches: TradeMacroNewsMatch[] = [];
  for (const ev of cachedEvents) {
    const impact = (ev.impact || '').toUpperCase();
    if (impact !== 'HIGH' && impact !== 'MEDIUM') continue;
    const rawIso = ev.date || (ev as any).timeIso || (ev as any).dateTime;
    if (!rawIso) continue;
    const evTs = new Date(rawIso).getTime();
    if (!Number.isFinite(evTs)) continue;

    const diffMin = Math.round((evTs - tradeTs) / 60000);
    const absMin = Math.abs(diffMin);

    if (absMin <= 60) {
      matches.push({
        eventId: ev.id,
        title: ev.title,
        impact: impact as 'HIGH' | 'MEDIUM',
        timeIso: rawIso,
        minutesDelta: diffMin,
        proximity: 'IMMEDIATE',
        actual: ev.actual,
        forecast: ev.forecast,
      });
    } else if (impact === 'HIGH' && tradeDateKey && extractTradeLocalDateKey(rawIso) === tradeDateKey) {
      matches.push({
        eventId: ev.id,
        title: ev.title,
        impact: 'HIGH',
        timeIso: rawIso,
        minutesDelta: diffMin,
        proximity: 'SAME_DAY',
        actual: ev.actual,
        forecast: ev.forecast,
      });
    }
  }

  return matches
    .sort((a, b) => Math.abs(a.minutesDelta) - Math.abs(b.minutesDelta))
    .slice(0, 3);
}

// =============================================================================
// PERIODIC REVIEW STORAGE & AUTO-SUMMARY (WEEKLY / MONTHLY)
// =============================================================================

const PERIODIC_REVIEWS_KEY_PREFIX = 'vlo_periodic_reviews_v1_';

export function loadPeriodicReviews(userId?: string | null): PeriodicReview[] {
  try {
    const key = `${PERIODIC_REVIEWS_KEY_PREFIX}${userId || 'guest'}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePeriodicReviews(reviews: PeriodicReview[], userId?: string | null): void {
  try {
    const key = `${PERIODIC_REVIEWS_KEY_PREFIX}${userId || 'guest'}`;
    localStorage.setItem(key, JSON.stringify(reviews));
  } catch {
    // ignore storage quota errors
  }
}

export function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getIsoWeekDateRangeKeys(weekKey: string): [string, string] | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;
  // ISO week 1 always contains Jan 4
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  const week1Monday = new Date(Date.UTC(year, 0, 4 - (jan4Day - 1)));
  const start = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate()
    ).padStart(2, '0')}`;
  return [fmt(start), fmt(end)];
}

export function filterTradesForReviewPeriod(
  trades: Trade[],
  periodType: 'WEEKLY' | 'MONTHLY',
  periodKey: string
): Trade[] {
  if (!Array.isArray(trades) || trades.length === 0 || !periodKey) return [];

  if (periodType === 'MONTHLY') {
    return trades.filter((t) => {
      if (!isTradeClosedForRealizedMetrics(t)) return false;
      const dKey = extractTradeLocalDateKey(t.dateTime);
      return Boolean(dKey) && dKey.slice(0, 7) === periodKey;
    });
  }

  const weekRange = getIsoWeekDateRangeKeys(periodKey);
  if (weekRange) {
    const [startKey, endKey] = weekRange;
    return trades.filter((t) => {
      if (!isTradeClosedForRealizedMetrics(t)) return false;
      const dKey = extractTradeLocalDateKey(t.dateTime);
      return Boolean(dKey) && dKey >= startKey && dKey <= endKey;
    });
  }

  return trades.filter((t) => {
    if (!isTradeClosedForRealizedMetrics(t)) return false;
    const dKey = extractTradeLocalDateKey(t.dateTime);
    if (!dKey) return false;
    const d = new Date(`${dKey}T12:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    return getIsoWeekKey(d) === periodKey;
  });
}

export function computeReviewSnapshotStats(
  periodTrades: Trade[],
  settings: AppSettings
): PeriodicReview['snapshotStats'] {
  const { metrics } = calculatePerformance(periodTrades, settings);
  const behavior = computeBehavioralAnalytics(periodTrades);
  return {
    totalTrades: metrics.totalTrades,
    winRate: metrics.winRate,
    netProfit: metrics.totalNetProfit,
    profitFactor: Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 0,
    avgR: metrics.averageRiskReward,
    topMistake: behavior.topMistakeId,
  };
}

// =============================================================================
// MULTI-ACCOUNT / SUB-PORTFOLIO HELPERS
// =============================================================================

export const PRIMARY_ACCOUNT_ID = 'ACC-PRIMARY';

export function resolveConfiguredAccounts(settings: AppSettings): TradingAccount[] {
  if (Array.isArray(settings.accounts) && settings.accounts.length > 0) {
    return settings.accounts;
  }
  return [
    {
      id: PRIMARY_ACCOUNT_ID,
      name: 'Akun Utama',
      broker: 'XAUUSD',
      accountType: 'LIVE',
      startingBalance: settings.startingBalance,
      currency: settings.currency,
    },
  ];
}

export function filterTradesByAccount(
  trades: Trade[],
  activeAccountId?: string
): Trade[] {
  if (!activeAccountId || activeAccountId === 'ALL') {
    return trades;
  }
  return (trades || []).filter((t) => {
    const resolvedAcc = resolveTradeBehavior(t).accountId || PRIMARY_ACCOUNT_ID;
    return resolvedAcc === activeAccountId;
  });
}

export function resolveAccountScopedSettings(
  settings: AppSettings,
  activeAccountId?: string
): AppSettings {
  if (!activeAccountId || activeAccountId === 'ALL') {
    return settings;
  }
  const accounts = resolveConfiguredAccounts(settings);
  const matched = accounts.find((a) => a.id === activeAccountId);
  if (!matched) return settings;
  return {
    ...settings,
    startingBalance: matched.startingBalance,
  };
}

export function getActivePlaybooks(settings: AppSettings): PlaybookSetup[] {
  return Array.isArray(settings.playbooks) && settings.playbooks.length > 0
    ? settings.playbooks
    : DEFAULT_PLAYBOOKS;
}

export function getActiveChecklist(settings: AppSettings) {
  return Array.isArray(settings.preTradeChecklist) && settings.preTradeChecklist.length > 0
    ? settings.preTradeChecklist
    : DEFAULT_PRE_TRADE_CHECKLIST;
}
