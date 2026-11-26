import React, { useState, useEffect, useMemo } from 'react';
import { AppSettings, CurrencyCode } from '../../types/settings';
import { Trade } from '../../types/trade';
import { calculatePerformance, formatCurrency } from '../../utils/calculations';
import { calculateCapitalGrowthBreakdown } from '../../utils/currencyRate';
import {
  PRIMARY_ACCOUNT_ID,
  filterTradesByAccount,
  resolveAccountScopedSettings,
} from '../../utils/journalExtras';
import { useLanguage } from '../../utils/language';
import { X, Check, AlertTriangle } from 'lucide-react';

export type PreferenceCategory = 'balance' | 'currency' | 'broker' | 'risk' | 'adjustments';

interface TradingPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: PreferenceCategory;
  settings: AppSettings;
  trades?: Trade[];
  onSave: (updatedSettings: AppSettings) => void;
}

export const TradingPreferencesModal: React.FC<TradingPreferencesModalProps> = ({
  isOpen,
  onClose,
  category,
  settings,
  trades = [],
  onSave,
}) => {
  const { tr } = useLanguage();
  const activeAccountId = settings.activeAccountId || 'ALL';
  const scopedSettings = useMemo(
    () => resolveAccountScopedSettings(settings, activeAccountId),
    [settings, activeAccountId]
  );
  const scopedTrades = useMemo(
    () => filterTradesByAccount(trades, activeAccountId),
    [trades, activeAccountId]
  );

  const journalNetSummary = useMemo(() => {
    const { metrics } = calculatePerformance(scopedTrades, scopedSettings);
    return {
      totalTrades: metrics.totalTrades,
      netProfit: Number((metrics.totalNetProfit || 0).toFixed(2)),
    };
  }, [scopedTrades, scopedSettings]);

  const activeAccountName = useMemo(() => {
    if (!activeAccountId || activeAccountId === 'ALL' || !Array.isArray(settings.accounts)) {
      return null;
    }
    return settings.accounts.find((a) => a.id === activeAccountId)?.name || null;
  }, [activeAccountId, settings.accounts]);

  const [activeCategory, setActiveCategory] = useState<PreferenceCategory>(category);
  const [balanceEntryMode, setBalanceEntryMode] = useState<'manual' | 'mt5_sync'>('manual');
  const [formData, setFormData] = useState<AppSettings>({ ...scopedSettings });
  const [numericInputs, setNumericInputs] = useState({
    startingBalance: Number.isFinite(scopedSettings.startingBalance)
      ? String(scopedSettings.startingBalance)
      : '',
    brokerCommissionPerLot: settings.brokerCommissionPerLot
      ? String(settings.brokerCommissionPerLot)
      : '',
    defaultRiskPercent: settings.defaultRiskPercent ? String(settings.defaultRiskPercent) : '',
    targetMonthlyReturnPercent: settings.targetMonthlyReturnPercent
      ? String(settings.targetMonthlyReturnPercent)
      : '',
    totalDeposits: settings.totalDeposits ? String(settings.totalDeposits) : '',
    totalWithdrawals: settings.totalWithdrawals ? String(settings.totalWithdrawals) : '',
  });
  const [mt5CurrentBalanceInput, setMt5CurrentBalanceInput] = useState<string>(() => {
    const breakdown = calculateCapitalGrowthBreakdown(scopedSettings, journalNetSummary.netProfit);
    return String(breakdown.currentBalance);
  });

  useEffect(() => {
    setActiveCategory(category);
  }, [category]);

  useEffect(() => {
    const nextScoped = resolveAccountScopedSettings(settings, settings.activeAccountId || 'ALL');
    const breakdown = calculateCapitalGrowthBreakdown(nextScoped, journalNetSummary.netProfit);
    setFormData({ ...nextScoped });
    setBalanceEntryMode('manual');
    setNumericInputs({
      startingBalance: Number.isFinite(nextScoped.startingBalance)
        ? String(nextScoped.startingBalance)
        : '',
      brokerCommissionPerLot: settings.brokerCommissionPerLot
        ? String(settings.brokerCommissionPerLot)
        : '',
      defaultRiskPercent: settings.defaultRiskPercent ? String(settings.defaultRiskPercent) : '',
      targetMonthlyReturnPercent: settings.targetMonthlyReturnPercent
        ? String(settings.targetMonthlyReturnPercent)
        : '',
      totalDeposits: settings.totalDeposits ? String(settings.totalDeposits) : '',
      totalWithdrawals: settings.totalWithdrawals ? String(settings.totalWithdrawals) : '',
    });
    setMt5CurrentBalanceInput(String(breakdown.currentBalance));
  }, [settings, isOpen, journalNetSummary.netProfit]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sanitizeNumericString = (raw: string) => {
    if (raw === '') return '';
    return raw.replace(/^0+(?=\d)/, '');
  };

  const handleCurrencySelect = (curr: CurrencyCode) => {
    let symbol = '$';
    if (curr === 'IDR') symbol = 'Rp';
    if (curr === 'EUR') symbol = '€';
    setFormData({ ...formData, currency: curr, currencySymbol: symbol });
  };

  const netAdjustment = (formData.totalDeposits ?? 0) - (formData.totalWithdrawals ?? 0);
  const parsedMt5Target = parseFloat(mt5CurrentBalanceInput);
  const computedMt5StartingBalance = Number.isFinite(parsedMt5Target)
    ? Number((parsedMt5Target - journalNetSummary.netProfit - netAdjustment).toFixed(2))
    : NaN;
  const isMt5SyncInvalidNegative =
    activeCategory === 'balance' &&
    balanceEntryMode === 'mt5_sync' &&
    (!Number.isFinite(parsedMt5Target) ||
      parsedMt5Target < 0 ||
      !Number.isFinite(computedMt5StartingBalance) ||
      computedMt5StartingBalance < 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMt5SyncInvalidNegative) {
      return;
    }

    const parsedBalance =
      balanceEntryMode === 'mt5_sync' && Number.isFinite(computedMt5StartingBalance)
        ? computedMt5StartingBalance
        : parseFloat(numericInputs.startingBalance);
    const parsedCommission = parseFloat(numericInputs.brokerCommissionPerLot);
    const parsedRisk = parseFloat(numericInputs.defaultRiskPercent);
    const parsedTarget = parseFloat(numericInputs.targetMonthlyReturnPercent);
    const parsedDeposits = parseFloat(numericInputs.totalDeposits);
    const parsedWithdrawals = parseFloat(numericInputs.totalWithdrawals);

    const finalStartingBalance =
      Number.isFinite(parsedBalance) && parsedBalance >= 0 ? Number(parsedBalance.toFixed(2)) : 0;

    let nextAccounts = formData.accounts;
    let nextRootStartingBalance = finalStartingBalance;

    if (Array.isArray(formData.accounts) && formData.accounts.length > 0) {
      if (activeAccountId && activeAccountId !== 'ALL') {
        nextAccounts = formData.accounts.map((acc) =>
          acc.id === activeAccountId ? { ...acc, startingBalance: finalStartingBalance } : acc
        );
        // Preserve root startingBalance for non-primary sub-accounts unless editing primary account
        if (activeAccountId !== PRIMARY_ACCOUNT_ID) {
          nextRootStartingBalance = settings.startingBalance;
        }
      } else if (formData.accounts.length === 1) {
        nextAccounts = formData.accounts.map((acc) => ({
          ...acc,
          startingBalance: finalStartingBalance,
        }));
      }
    }

    onSave({
      ...formData,
      startingBalance: nextRootStartingBalance,
      accounts: nextAccounts,
      brokerCommissionPerLot:
        Number.isFinite(parsedCommission) && parsedCommission >= 0 ? parsedCommission : 0,
      defaultRiskPercent:
        Number.isFinite(parsedRisk) && parsedRisk > 0 ? parsedRisk : settings.defaultRiskPercent || 1.0,
      targetMonthlyReturnPercent:
        Number.isFinite(parsedTarget) && parsedTarget >= 0 ? parsedTarget : 0,
      totalDeposits: Number.isFinite(parsedDeposits) && parsedDeposits >= 0 ? parsedDeposits : 0,
      totalWithdrawals:
        Number.isFinite(parsedWithdrawals) && parsedWithdrawals >= 0 ? parsedWithdrawals : 0,
    });
    onClose();
  };

  const categoryTitles: Record<PreferenceCategory, string> = {
    balance: tr('Modal Awal Akun', 'Initial Account Capital'),
    currency: tr('Mata Uang Jurnal', 'Journal Currency'),
    broker: tr('Spesifikasi Broker (XAUUSD)', 'Broker Specification (XAUUSD)'),
    risk: tr('Parameter Risiko & Target', 'Risk & Target Parameters'),
    adjustments: tr('Penyesuaian Modal (Deposit & WD)', 'Capital Adjustments (Deposit & WD)'),
  };

  const categorySubtitles: Record<PreferenceCategory, string> = {
    balance: tr('Basis awal pertumbuhan ekuitas akun', 'Starting baseline for account equity growth'),
    currency: tr('Satuan moneter tampilan laporan jurnal', 'Monetary unit displayed across journal reports'),
    broker: tr('Standar ukuran pip, kontrak, dan komisi emas', 'Gold pip scale, contract size, and commission'),
    risk: tr('Batas risiko default dan target bulanan', 'Default risk sizing and monthly return target'),
    adjustments: tr('Catat total modal masuk dan penarikan dana', 'Record cumulative deposits and withdrawals'),
  };

  const labelClass = 'block text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] mb-1.5';
  const inputClass =
    'w-full min-h-[40px] rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] px-3 py-2 text-xs font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25';

  const previewBreakdown = calculateCapitalGrowthBreakdown(
    {
      ...formData,
      startingBalance:
        balanceEntryMode === 'mt5_sync' && Number.isFinite(computedMt5StartingBalance)
          ? Math.max(0, computedMt5StartingBalance)
          : formData.startingBalance,
    },
    journalNetSummary.netProfit
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={categoryTitles[activeCategory]}
        className="w-full max-w-lg bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] rounded-2xl shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden text-[#0F172A] dark:text-[#F2F4F7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
              {categoryTitles[activeCategory]}
            </h3>
            <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5">
              {categorySubtitles[activeCategory]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            aria-label={tr('Tutup', 'Close')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-5">
            {/* Category Segmented Switcher */}
            <div className="grid grid-cols-5 gap-1 p-1 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
              {(['balance', 'currency', 'broker', 'risk', 'adjustments'] as PreferenceCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`min-h-[34px] py-1.5 px-1 text-[11px] rounded-full transition-colors cursor-pointer text-center truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    activeCategory === cat
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A] font-semibold'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                  }`}
                >
                  {cat === 'balance' && tr('Modal', 'Capital')}
                  {cat === 'currency' && tr('Kurs', 'Currency')}
                  {cat === 'broker' && tr('Broker', 'Broker')}
                  {cat === 'risk' && tr('Risiko', 'Risk')}
                  {cat === 'adjustments' && tr('Kas', 'Cashflow')}
                </button>
              ))}
            </div>

            {/* CATEGORY: BALANCE */}
            {activeCategory === 'balance' && (
              <div className="space-y-4">
                {activeAccountName && (
                  <div className="px-3 py-2 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between text-[11px]">
                    <span className="text-[#526071] dark:text-[#929BA9]">
                      {tr('Sub-Portofolio Aktif', 'Active Sub-Portfolio')}
                    </span>
                    <span className="font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                      {activeAccountName}
                    </span>
                  </div>
                )}

                {/* Balance Mode Switcher: Manual Starting Balance vs Sync from MT5 Current Balance */}
                <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
                  <button
                    type="button"
                    data-testid="balance-mode-manual"
                    onClick={() => setBalanceEntryMode('manual')}
                    className={`min-h-[34px] py-1.5 px-2 text-[11px] rounded-full transition-colors cursor-pointer text-center truncate ${
                      balanceEntryMode === 'manual'
                        ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A] font-semibold'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                    }`}
                  >
                    {tr('Atur Saldo Awal', 'Set Starting Balance')}
                  </button>
                  <button
                    type="button"
                    data-testid="balance-mode-mt5-sync"
                    onClick={() => {
                      const currentEqu = calculateCapitalGrowthBreakdown(
                        formData,
                        journalNetSummary.netProfit
                      ).currentBalance;
                      setMt5CurrentBalanceInput(String(currentEqu));
                      setBalanceEntryMode('mt5_sync');
                    }}
                    className={`min-h-[34px] py-1.5 px-2 text-[11px] rounded-full transition-colors cursor-pointer text-center truncate ${
                      balanceEntryMode === 'mt5_sync'
                        ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A] font-semibold'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                    }`}
                  >
                    {tr('Selaraskan dgn MT5', 'Sync with MT5')}
                  </button>
                </div>

                {balanceEntryMode === 'manual' ? (
                  <div>
                    <label className={labelClass}>
                      {tr(
                        'Saldo Awal Sebelum Trade Pertama',
                        'Initial Balance Before First Trade'
                      )}{' '}
                      ({formData.currencySymbol})
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#526071] dark:text-[#929BA9] font-mono-numbers">
                        {formData.currencySymbol}
                      </span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0"
                        data-testid="starting-balance-manual-input"
                        value={numericInputs.startingBalance}
                        onChange={(e) => {
                          const clean = sanitizeNumericString(e.target.value);
                          setNumericInputs((prev) => ({ ...prev, startingBalance: clean }));
                          const parsed = parseFloat(clean);
                          setFormData((prev) => ({
                            ...prev,
                            startingBalance: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                          }));
                        }}
                        className={`${inputClass} pl-9`}
                      />
                    </div>
                    <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-1.5 leading-relaxed">
                      {tr(
                        'Masukkan saldo MT5 Anda tepat sebelum transaksi paling awal yang dicatat di jurnal.',
                        'Enter your MT5 balance right before the earliest trade recorded in the journal.'
                      )}
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className={labelClass}>
                      {tr('Saldo / Balance MT5 Saat Ini', 'Current MT5 Account Balance')} (
                      {formData.currencySymbol})
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#526071] dark:text-[#929BA9] font-mono-numbers">
                        {formData.currencySymbol}
                      </span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0"
                        data-testid="mt5-current-balance-input"
                        value={mt5CurrentBalanceInput}
                        onChange={(e) => {
                          const clean = sanitizeNumericString(e.target.value);
                          setMt5CurrentBalanceInput(clean);
                          const targetVal = parseFloat(clean);
                          if (Number.isFinite(targetVal) && targetVal >= 0) {
                            const computedStart = Number(
                              (targetVal - journalNetSummary.netProfit - netAdjustment).toFixed(2)
                            );
                            if (computedStart >= 0) {
                              setNumericInputs((prev) => ({
                                ...prev,
                                startingBalance: String(computedStart),
                              }));
                              setFormData((prev) => ({
                                ...prev,
                                startingBalance: computedStart,
                              }));
                            }
                          }
                        }}
                        className={`${inputClass} pl-9`}
                      />
                    </div>
                    <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-1.5 leading-relaxed">
                      {tr(
                        'Masukkan saldo Balance yang tampil di MT5 sekarang. Aplikasi otomatis menghitung mundur Saldo Awal agar Ekuitas sama persis dengan MT5.',
                        'Enter the Balance currently shown in MT5. The app automatically back-calculates your Starting Balance so Equity matches MT5.'
                      )}
                    </p>
                  </div>
                )}

                {isMt5SyncInvalidNegative && (
                  <div className="rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/15 border border-[#E11D48]/25 px-3 py-2.5 flex items-start gap-2 text-[11px] text-[#E11D48] dark:text-[#E05260]">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 stroke-[1.75]" />
                    <span>
                      {tr(
                        'Saldo Awal hasil perhitungan menjadi negatif. Periksa kembali nominal Saldo MT5 Saat Ini, atau sesuaikan Deposit/WD jika ada penarikan dana di MT5.',
                        'Calculated Starting Balance is negative. Verify your Current MT5 Balance or record any Deposit/Withdrawal adjustments.'
                      )}
                    </span>
                  </div>
                )}

                {/* Real-time Reconciliation Breakdown Card */}
                <div className="rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] divide-y divide-[#E4E4E7] dark:divide-[#20252D] text-xs font-mono-numbers tabular-nums">
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <span className="font-sans text-[#526071] dark:text-[#929BA9]">
                      {balanceEntryMode === 'mt5_sync'
                        ? tr('Saldo Awal Otomatis', 'Calculated Starting Balance')
                        : tr('Modal Awal Akun', 'Starting Balance')}
                    </span>
                    <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                      {balanceEntryMode === 'mt5_sync' && !Number.isFinite(computedMt5StartingBalance)
                        ? '-'
                        : balanceEntryMode === 'mt5_sync' && computedMt5StartingBalance < 0
                        ? `-${formatCurrency(Math.abs(computedMt5StartingBalance), formData)}`
                        : formatCurrency(previewBreakdown.startingBalance, formData)}
                    </span>
                  </div>

                  {netAdjustment !== 0 && (
                    <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                      <span className="font-sans text-[#526071] dark:text-[#929BA9]">
                        {tr('Arus Kas (Dep - WD)', 'Net Cashflow (Dep - WD)')}
                      </span>
                      <span
                        className={`font-semibold ${
                          netAdjustment >= 0
                            ? 'text-[#059669] dark:text-[#00A878]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {netAdjustment >= 0 ? '+' : '-'}
                        {formatCurrency(Math.abs(netAdjustment), formData)}
                      </span>
                    </div>
                  )}

                  <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                    <span className="font-sans text-[#526071] dark:text-[#929BA9]">
                      {tr(
                        `Net P/L Jurnal (${journalNetSummary.totalTrades} trade)`,
                        `Journal Net P/L (${journalNetSummary.totalTrades} trades)`
                      )}
                    </span>
                    <span
                      className={`font-semibold ${
                        journalNetSummary.netProfit > 0
                          ? 'text-[#059669] dark:text-[#00A878]'
                          : journalNetSummary.netProfit < 0
                          ? 'text-[#E11D48] dark:text-[#E05260]'
                          : 'text-[#0F172A] dark:text-[#F2F4F7]'
                      }`}
                    >
                      {journalNetSummary.netProfit > 0
                        ? '+'
                        : journalNetSummary.netProfit < 0
                        ? '-'
                        : ''}
                      {formatCurrency(Math.abs(journalNetSummary.netProfit), formData)}
                    </span>
                  </div>

                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-white/60 dark:bg-[#101318]/60">
                    <span className="font-sans font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                      {tr('Ekuitas Akhir di Aplikasi', 'Resulting App Equity')}
                    </span>
                    <span className="font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                      {balanceEntryMode === 'mt5_sync' && Number.isFinite(parsedMt5Target) && parsedMt5Target >= 0
                        ? formatCurrency(parsedMt5Target, formData)
                        : formatCurrency(previewBreakdown.currentBalance, formData)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* CATEGORY: CURRENCY */}
            {activeCategory === 'currency' && (
              <div className="space-y-2.5">
                <span className={labelClass}>{tr('Pilih Mata Uang', 'Select Currency')}</span>
                <div className="grid grid-cols-3 gap-2.5">
                  {(['USD', 'IDR', 'EUR'] as CurrencyCode[]).map((c) => {
                    const isSelected = formData.currency === c;
                    const symbol = c === 'IDR' ? 'Rp' : c === 'EUR' ? '€' : '$';
                    const fullName = c === 'IDR' ? 'Rupiah' : c === 'EUR' ? 'Euro' : 'US Dollar';
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleCurrencySelect(c)}
                        className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                          isSelected
                            ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#161A22]'
                            : 'border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0B0E13] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/70'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-sm font-bold font-mono-numbers ${
                              isSelected
                                ? 'text-[#0F172A] dark:text-white'
                                : 'text-[#0F172A] dark:text-[#F2F4F7]'
                            }`}
                          >
                            {c}
                          </span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-[#0F172A] dark:text-white stroke-[2]" />}
                        </div>
                        <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-1">
                          {symbol} · {fullName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CATEGORY: BROKER */}
            {activeCategory === 'broker' && (
              <div className="space-y-4">
                {/* Pip Distance Standard */}
                <div>
                  <span className={labelClass}>
                    {tr('Standar 1 Pip XAUUSD', 'XAUUSD 1 Pip Standard')}
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      {
                        val: 0.1,
                        title: tr('Mode A · $0.10 (Standar App)', 'Mode A · $0.10 (App Standard)'),
                        desc: tr('4000 → 3995 = 50 pips', '4000 → 3995 = 50 pips'),
                      },
                      {
                        val: 1.0,
                        title: tr('Mode B · $1.00', 'Mode B · $1.00'),
                        desc: tr('4000 → 3950 = 50 pips', '4000 → 3950 = 50 pips'),
                      },
                    ].map((opt) => {
                      const active = (formData.xauusdPipSize === 1.0 ? 1.0 : 0.1) === opt.val;
                      return (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => setFormData({ ...formData, xauusdPipSize: opt.val })}
                          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                            active
                              ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#161A22]'
                              : 'border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0B0E13] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`text-xs font-bold font-mono-numbers ${
                                active
                                  ? 'text-[#0F172A] dark:text-white'
                                  : 'text-[#0F172A] dark:text-[#F2F4F7]'
                              }`}
                            >
                              {opt.title}
                            </span>
                            {active && <Check className="h-3.5 w-3.5 text-[#0F172A] dark:text-white stroke-[2]" />}
                          </div>
                          <span className="text-[11px] text-[#526071] dark:text-[#929BA9] font-mono-numbers block mt-1">
                            {opt.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Contract Size */}
                <div>
                  <span className={labelClass}>
                    {tr('Contract Size (per 1.0 Lot)', 'Contract Size (per 1.0 Lot)')}
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: 100, label: '100 oz', sub: tr('Standar MT5', 'MT5 Standard') },
                      { val: 10, label: '10 oz', sub: tr('Akun Mini', 'Mini Account') },
                      { val: 1, label: '1 oz', sub: tr('Micro / Cent', 'Micro / Cent') },
                    ].map((opt) => {
                      const active = formData.xauusdContractSize === opt.val;
                      return (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => setFormData({ ...formData, xauusdContractSize: opt.val })}
                          className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                            active
                              ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#161A22]'
                              : 'border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0B0E13] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/70'
                          }`}
                        >
                          <span
                            className={`text-xs font-bold font-mono-numbers block ${
                              active
                                ? 'text-[#0F172A] dark:text-white'
                                : 'text-[#0F172A] dark:text-[#F2F4F7]'
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                            {opt.sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Commission */}
                <div>
                  <label className={labelClass}>
                    {tr('Komisi Broker per Lot ($)', 'Broker Commission per Lot ($)')}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#526071] dark:text-[#929BA9] font-mono-numbers">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="0"
                      value={numericInputs.brokerCommissionPerLot}
                      onChange={(e) => {
                        const clean = sanitizeNumericString(e.target.value);
                        setNumericInputs((prev) => ({ ...prev, brokerCommissionPerLot: clean }));
                        const parsed = parseFloat(clean);
                        setFormData((prev) => ({
                          ...prev,
                          brokerCommissionPerLot: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                        }));
                      }}
                      className={`${inputClass} pl-7 pr-12`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#526071] dark:text-[#929BA9]">
                      / lot
                    </span>
                  </div>
                </div>

                {/* Reference Note */}
                <div className="px-3 py-2.5 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] text-[#526071] dark:text-[#929BA9] font-mono-numbers tabular-nums">
                  0.01 lot = $0.10/pip · 0.10 lot = $1.00/pip · 1.00 lot = $10.00/pip
                </div>
              </div>
            )}

            {/* CATEGORY: RISK */}
            {activeCategory === 'risk' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>
                      {tr('Risiko per Trade (%)', 'Risk per Trade (%)')}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="100"
                      placeholder="1.0"
                      value={numericInputs.defaultRiskPercent}
                      onChange={(e) => {
                        const clean = sanitizeNumericString(e.target.value);
                        setNumericInputs((prev) => ({ ...prev, defaultRiskPercent: clean }));
                        const parsed = parseFloat(clean);
                        setFormData((prev) => ({
                          ...prev,
                          defaultRiskPercent: Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0,
                        }));
                      }}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>
                      {tr('Target Return Bulanan (%)', 'Monthly Return Target (%)')}
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="0"
                      value={numericInputs.targetMonthlyReturnPercent}
                      onChange={(e) => {
                        const clean = sanitizeNumericString(e.target.value);
                        setNumericInputs((prev) => ({ ...prev, targetMonthlyReturnPercent: clean }));
                        const parsed = parseFloat(clean);
                        setFormData((prev) => ({
                          ...prev,
                          targetMonthlyReturnPercent: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                        }));
                      }}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <span className={labelClass}>
                    {tr('Basis Modal Perhitungan Risiko', 'Risk Capital Basis')}
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      {
                        val: 'EQUITY' as const,
                        title: tr('Ekuitas Saat Ini', 'Current Equity'),
                        desc: tr('Dinamis mengikuti profit/loss', 'Scales with realized P/L'),
                      },
                      {
                        val: 'BALANCE' as const,
                        title: tr('Saldo Awal', 'Initial Balance'),
                        desc: tr('Tetap berdasar modal awal', 'Fixed to starting capital'),
                      },
                    ].map((opt) => {
                      const active = (formData.riskCapitalBasis || 'EQUITY') === opt.val;
                      return (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => setFormData({ ...formData, riskCapitalBasis: opt.val })}
                          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                            active
                              ? 'border-[#0F172A] dark:border-white bg-[#FAFAFA] dark:bg-[#161A22]'
                              : 'border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#0B0E13] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`text-xs font-bold ${
                                active
                                  ? 'text-[#0F172A] dark:text-white'
                                  : 'text-[#0F172A] dark:text-[#F2F4F7]'
                              }`}
                            >
                              {opt.title}
                            </span>
                            {active && <Check className="h-3.5 w-3.5 text-[#0F172A] dark:text-white stroke-[2]" />}
                          </div>
                          <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-1">
                            {opt.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* CATEGORY: ADJUSTMENTS */}
            {activeCategory === 'adjustments' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>
                      {tr('Total Deposit', 'Total Deposits')} ({formData.currencySymbol})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={numericInputs.totalDeposits}
                      onChange={(e) => {
                        const clean = sanitizeNumericString(e.target.value);
                        setNumericInputs((prev) => ({ ...prev, totalDeposits: clean }));
                        const parsed = parseFloat(clean);
                        setFormData((prev) => ({
                          ...prev,
                          totalDeposits: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                        }));
                      }}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>
                      {tr('Total Penarikan (WD)', 'Total Withdrawals')} ({formData.currencySymbol})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={numericInputs.totalWithdrawals}
                      onChange={(e) => {
                        const clean = sanitizeNumericString(e.target.value);
                        setNumericInputs((prev) => ({ ...prev, totalWithdrawals: clean }));
                        const parsed = parseFloat(clean);
                        setFormData((prev) => ({
                          ...prev,
                          totalWithdrawals: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                        }));
                      }}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between text-xs">
                  <span className="text-[#526071] dark:text-[#929BA9]">
                    {tr('Arus Kas Bersih', 'Net Cashflow')}
                  </span>
                  <span
                    className={`font-bold font-mono-numbers tabular-nums ${
                      netAdjustment >= 0
                        ? 'text-[#059669] dark:text-[#00A878]'
                        : 'text-[#E11D48] dark:text-[#E05260]'
                    }`}
                  >
                    {netAdjustment >= 0 ? '+' : ''}
                    {formatCurrency(netAdjustment, formData)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13]/60 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] px-4 py-2 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              {tr('Batal', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isMt5SyncInvalidNegative}
              className="min-h-[38px] px-4 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              {tr('Simpan Pengaturan', 'Save Settings')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
