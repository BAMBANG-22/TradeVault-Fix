export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN';
export type TradePosition = 'BUY' | 'SELL';
export type TradingSession = 'Asian' | 'London' | 'New York' | 'Overlap' | 'Other';

export type TradeLifecycleStatus = 'PLANNED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
export type TradeOrderType = 'Market' | 'Pending';
export type TradeCloseType = 'TP' | 'SL' | 'Manual';

export type TradeActivityEventType =
  | 'TRADE_CREATED'
  | 'POSITION_OPENED'
  | 'SL_CHANGED'
  | 'TP_CHANGED'
  | 'POSITION_CLOSED'
  | 'TRADE_CANCELLED'
  | 'EVALUATION_ADDED';

export interface TradeActivityEvent {
  id: string;
  type: TradeActivityEventType;
  timestamp: string;
  label: string;
  previousValue?: string;
  newValue?: string;
  note?: string;
}

export interface HistoricalExchangeRateSnapshot {
  rate: number;
  baseCurrency: 'USD';
  quoteCurrency: 'IDR';
  timestamp: string;
  source: string;
  status: 'LIVE' | 'CACHED_OFFLINE' | 'UNVERIFIED_LEGACY';
}

export interface Trade {
  id: string;
  dateTime: string; // ISO format: YYYY-MM-DDTHH:mm
  instrument: string; // e.g. "XAUUSD"
  position: TradePosition;
  strategy: string; // e.g. "Liquidity Sweep + CHoCH", "Order Block", "FVG Fill"
  session?: string; // e.g. "London", "New York", "Asian", "Overlap"
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  exitPrice?: number;
  lotSize: number;
  riskAmount: number; // in account currency
  riskPercentage: number; // e.g. 1.0 for 1%
  outcome: TradeOutcome;
  grossProfit: number; // gross PnL
  commission: number; // broker commission/fee
  swap: number; // overnight swap (can be negative or positive)
  netProfit: number; // grossProfit - commission + swap
  rMultiple?: number; // realized Risk-to-Reward ratio (e.g. 2.5R)
  screenshotUrl?: string; // base64 or URL
  notes?: string;
  entryReason?: string; // technical / market context reason
  postTradeEvaluation?: string; // post-trade review & lessons
  disciplineRating?: number; // 1 to 5
  executionNotes?: string;
  closeExchangeRate?: HistoricalExchangeRateSnapshot; // Historical snapshot rate at close time (USD/IDR)
  mistakeTags?: string[]; // e.g. ['FOMO', 'OVERLOT', 'EARLY_EXIT']
  emotionTag?: string; // e.g. 'CALM', 'ANXIOUS', 'CONFIDENT'
  accountId?: string; // Multi-account / sub-portfolio identifier
  playbookId?: string; // Reference to A+ Setup Playbook entry
  checklistPassed?: boolean; // Whether pre-trade SOP checklist was completed
  ruleCompliant?: boolean; // Whether trade obeyed risk & daily loss guardrails
  isDemo?: boolean; // explicitly marks demo sample data
  createdAt?: string;
  updatedAt?: string;
}

export interface TradingAccount {
  id: string;
  name: string;
  broker?: string;
  accountType: 'LIVE' | 'PROP' | 'DEMO' | 'CENT';
  startingBalance: number;
  currency?: 'USD' | 'IDR' | 'EUR';
  createdAt?: string;
}

export interface PreTradeChecklistItem {
  id: string;
  labelId: string;
  labelEn: string;
  enabled: boolean;
}

export interface PlaybookSetup {
  id: string;
  name: string;
  session: TradingSession;
  minRR: number;
  summary: string;
  criteria: string[];
  exampleScreenshotUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PeriodicReview {
  id: string;
  periodType: 'WEEKLY' | 'MONTHLY';
  periodKey: string; // e.g. '2026-W47' or '2026-11'
  periodLabel: string;
  accountId?: string;
  whatWorked: string;
  recurringMistakes: string;
  nextPeriodFocus: string;
  rating: number; // 1..5
  snapshotStats: {
    totalTrades: number;
    winRate: number;
    netProfit: number;
    profitFactor: number;
    avgR: number;
    topMistake?: string;
  };
  updatedAt: string;
}

export interface TradeFilter {
  search: string;
  lifecycleStatus?: 'ALL' | TradeLifecycleStatus;
  outcome: 'ALL' | TradeOutcome;
  position: 'ALL' | TradePosition;
  strategy: string;
  instrument: string;
  session: string;
  startDate: string;
  endDate: string;
  sortBy: 'date-desc' | 'date-asc' | 'profit-desc' | 'profit-asc' | 'lot-desc';
}

export interface CsvRowValidationError {
  rowNumber: number;
  tradeId?: string;
  field: string;
  rawValue: string;
  reason: string;
}

export interface CsvImportReport {
  totalRows: number;
  acceptedRowsCount: number;
  rejectedRowsCount: number;
  rowErrors: CsvRowValidationError[];
}

