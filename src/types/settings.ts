import { TradingAccount, PreTradeChecklistItem, PlaybookSetup } from './trade';

export type CurrencyCode = 'USD' | 'IDR' | 'EUR';

export interface AppSettings {
  currency: CurrencyCode;
  currencySymbol: string;
  startingBalance: number;
  // XAUUSD specific broker specifications
  xauusdContractSize: number; // typically 100 for standard lot (100 oz), 10 for mini, 1 for micro
  xauusdPointValue: number; // e.g. 0.01 for gold with 2 decimals
  xauusdTickSize?: number; // default 0.01
  xauusdTickValue?: number; // default 1.00 for 100 oz standard lot
  xauusdPipSize?: number; // default 0.1 (1 pip = 0.10 poin harga XAUUSD, mis. 4000 -> 3995 = 50 pips; opsi 1.00 untuk mode 1.00 poin)
  xauusdPipValuePer001Lot?: number; // default 0.10 ($0.10 per pip untuk 0.01 lot; $10.00 per pip untuk 1.00 lot)
  xauusdMinLot?: number; // default 0.01
  xauusdLotStep?: number; // default 0.01
  defaultLeverage?: number; // e.g. 500 for 1:500
  brokerCommissionPerLot: number; // e.g. $6 per standard lot roundturn
  riskCapitalBasis?: 'EQUITY' | 'BALANCE'; // basis perhitungan Risk % (Ekuitas berjalan vs Saldo/Modal awal)
  // Risk management parameters
  defaultRiskPercent: number; // e.g. 1.0%
  maxTradeRiskPercent?: number; // e.g. 2.0%
  maxTradeRiskAmount?: number; // e.g. $200
  maxDailyLossPercent: number; // e.g. 3.0%
  maxDailyLossAmount: number; // e.g. $300
  maxConsecutiveLossLimit: number; // e.g. 3 trades
  maxDrawdownLimitPercent?: number; // e.g. 10.0%
  resetTimezone?: string; // e.g. 'WIB (UTC+7)'
  dailyLossAlertEnabled?: boolean; // default true
  stopTradingAlertEnabled?: boolean; // default true
  targetMonthlyReturnPercent: number; // e.g. 8%
  totalDeposits?: number; // cumulative external deposits (excluded from trading profit)
  totalWithdrawals?: number; // cumulative external withdrawals (excluded from trading loss)
  // Multi-account / sub-portfolio & workflow extensions (100% backward-compatible optional fields)
  accounts?: TradingAccount[];
  activeAccountId?: string; // 'ALL' or specific TradingAccount.id
  preTradeChecklist?: PreTradeChecklistItem[];
  playbooks?: PlaybookSetup[];
}

export const DEFAULT_PRE_TRADE_CHECKLIST: PreTradeChecklistItem[] = [
  {
    id: 'chk-htf-bias',
    labelId: 'Entry searah struktur & bias HTF (H1/H4)',
    labelEn: 'Entry aligned with HTF structure & bias (H1/H4)',
    enabled: true,
  },
  {
    id: 'chk-risk-limit',
    labelId: 'Risiko & ukuran lot sesuai batas aturan',
    labelEn: 'Risk & lot size strictly within plan limits',
    enabled: true,
  },
  {
    id: 'chk-news-window',
    labelId: 'Bebas rilis berita High-Impact USD (+/- 15 mnt)',
    labelEn: 'Clear of High-Impact USD news release (+/- 15 min)',
    enabled: true,
  },
  {
    id: 'chk-rr-sl',
    labelId: 'Stop Loss & Take Profit logis (min. 1:2 R:R)',
    labelEn: 'Logical Stop Loss & Take Profit (min. 1:2 R:R)',
    enabled: true,
  },
];

export const DEFAULT_PLAYBOOKS: PlaybookSetup[] = [
  {
    id: 'pb-london-sweep',
    name: 'London Open Liquidity Sweep',
    session: 'London',
    minRR: 2.5,
    summary: 'Sapuan likuiditas Asian High/Low diikuti CHoCH M5/M15 dan retest FVG/OB.',
    criteria: [
      'Asian High atau Asian Low tersapu bersih saat killzone London',
      'Konfirmasi displacement + CHoCH pada M5 atau M15',
      'Entry di area FVG / Order Block dengan SL di balik swing sweep',
    ],
  },
  {
    id: 'pb-ny-fvg',
    name: 'NY Session FVG Fill + CHoCH',
    session: 'New York',
    minRR: 2.0,
    summary: 'Kelanjutan tren intraday setelah manipulasi pembukaan New York.',
    criteria: [
      'Searah bias harian (D1/H4) dan momentum DXY berlawanan',
      'Menunggu 15 menit pasca rilis berita USD (jika ada)',
      'Retracement menyentuh FVG premium/discount dengan konfirmasi candle',
    ],
  },
  {
    id: 'pb-ob-m15',
    name: 'Order Block Retest M15',
    session: 'Overlap',
    minRR: 2.0,
    summary: 'Retest zona institusional Order Block pasca Break of Structure (BOS).',
    criteria: [
      'Terjadi BOS impulsif meninggalkan imbalance / FVG',
      'Zona Order Block masih fresh (unmitigated)',
      'Risiko maksimal sesuai aturan harian tanpa menggeser SL',
    ],
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  currency: 'USD',
  currencySymbol: '$',
  startingBalance: 10000,
  xauusdContractSize: 100, // standard 100 oz
  xauusdPointValue: 0.01,
  xauusdTickSize: 0.01,
  xauusdTickValue: 1.00,
  xauusdPipSize: 0.1,
  xauusdPipValuePer001Lot: 0.10,
  xauusdMinLot: 0.01,
  xauusdLotStep: 0.01,
  defaultLeverage: 500,
  brokerCommissionPerLot: 6,
  riskCapitalBasis: 'EQUITY',
  defaultRiskPercent: 1.0,
  maxTradeRiskPercent: 2.0,
  maxTradeRiskAmount: 200,
  maxDailyLossPercent: 3.0,
  maxDailyLossAmount: 300,
  maxConsecutiveLossLimit: 3,
  maxDrawdownLimitPercent: 10.0,
  resetTimezone: 'WIB (UTC+7)',
  dailyLossAlertEnabled: true,
  stopTradingAlertEnabled: true,
  targetMonthlyReturnPercent: 8,
  totalDeposits: 0,
  totalWithdrawals: 0,
  activeAccountId: 'ALL',
  preTradeChecklist: DEFAULT_PRE_TRADE_CHECKLIST,
  playbooks: DEFAULT_PLAYBOOKS,
};
