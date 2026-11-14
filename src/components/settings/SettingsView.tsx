/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppSettings } from '../../types/settings';
import { Trade } from '../../types/trade';
import { formatCurrency } from '../../utils/calculations';
import { isDemoTrade, DEMO_TRADES } from '../../utils/demoData';
import { mergeTradesDatasets } from '../../utils/supabaseSync';
import { useTheme } from '../../utils/theme';
import { useLanguage } from '../../utils/language';
import { CsvImportModal } from './CsvImportModal';
import { FinancialAuditModal } from './FinancialAuditModal';
import { TradingPreferencesModal, PreferenceCategory } from './TradingPreferencesModal';
import {
  getStandaloneBackendUrl,
  getEnvStandaloneBackendUrl,
  saveStandaloneBackendUrl,
  clearStandaloneBackendUrl,
  testStandaloneBackendConnection,
  StandaloneBackendHealthResult,
} from '../../utils/apiConfig';

interface SettingsViewProps {
  settings: AppSettings;
  trades: Trade[];
  onSaveSettings: (settings: AppSettings) => void;
  onUpdateTrades: (trades: Trade[]) => void;
  onImportCsvTrades?: (trades: Trade[], mode: 'merge' | 'replace') => Promise<void> | void;
  onLoadDemoTrades?: () => Promise<void> | void;
  onClearAllTrades?: () => Promise<void> | void;
  onRequestClearDemo: () => void;
  onOpenLocalInfo: () => void;
  onOpenBackupModal: () => void;
  currentUser?: any;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onOpenConfig?: () => void;
  isCloudSyncing?: boolean;
  onSyncLocalToCloud?: () => void;
  onReloadFromCloud?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  trades,
  onSaveSettings,
  onUpdateTrades,
  onImportCsvTrades,
  onLoadDemoTrades,
  onClearAllTrades,
  onRequestClearDemo,
  onOpenLocalInfo,
  onOpenBackupModal,
  currentUser,
  onOpenAuth,
  onOpenAccount,
  onOpenConfig,
  isCloudSyncing = false,
  onSyncLocalToCloud,
  onReloadFromCloud,
}) => {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, tr } = useLanguage();

  // Modals state
  const [activePrefModal, setActivePrefModal] = useState<PreferenceCategory | null>(null);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isConfirmingClearAll, setIsConfirmingClearAll] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Standalone Backend Server (Gemini AI & CORS Proxy) config state
  const [isEditingBackend, setIsEditingBackend] = useState(false);
  const [backendUrlInput, setBackendUrlInput] = useState(() => getStandaloneBackendUrl());
  const [activeBackendUrl, setActiveBackendUrl] = useState(() => getStandaloneBackendUrl());
  const [isTestingBackend, setIsTestingBackend] = useState(false);
  const [backendHealth, setBackendHealth] = useState<StandaloneBackendHealthResult | null>(null);
  const envBackendUrl = getEnvStandaloneBackendUrl();

  const demoCount = trades.filter((t) => isDemoTrade(t)).length;
  const realCount = trades.filter((t) => !isDemoTrade(t)).length;

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMsg({ text, type });
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleSavePreferences = (newSettings: AppSettings) => {
    onSaveSettings(newSettings);
    showFeedback(tr('Pengaturan berhasil diperbarui!', 'Settings updated successfully!'));
  };

  const handleLoadDemo = async () => {
    if (onLoadDemoTrades) {
      await onLoadDemoTrades();
    } else {
      const nonDemo = trades.filter((t) => !isDemoTrade(t));
      onUpdateTrades([...nonDemo, ...DEMO_TRADES]);
    }
    showFeedback(
      tr(
        `Berhasil memuat ${DEMO_TRADES.length} transaksi contoh DEMO.`,
        `Successfully loaded ${DEMO_TRADES.length} DEMO sample trades.`
      )
    );
  };

  const handleConfirmClearAllTrades = async () => {
    setIsConfirmingClearAll(false);
    if (onClearAllTrades) {
      await onClearAllTrades();
    } else {
      onUpdateTrades([]);
    }
    showFeedback(tr('Seluruh riwayat transaksi telah dihapus.', 'All trade history has been cleared.'));
  };

  const handleImportCsvSuccess = async (newTrades: Trade[], mode: 'merge' | 'replace') => {
    if (onImportCsvTrades) {
      await onImportCsvTrades(newTrades, mode);
    } else {
      const { finalTrades } = mergeTradesDatasets(trades, newTrades, mode);
      onUpdateTrades(finalTrades);
    }
    showFeedback(
      tr(
        `Berhasil mengimpor ${newTrades.length} transaksi dari CSV!`,
        `Successfully imported ${newTrades.length} trades from CSV!`
      )
    );
  };

  const handleTestBackend = async (customUrl?: string) => {
    setIsTestingBackend(true);
    const result = await testStandaloneBackendConnection(customUrl);
    setBackendHealth(result);
    setIsTestingBackend(false);
  };

  const handleSaveBackendUrl = async (andTest = false) => {
    const saved = saveStandaloneBackendUrl(backendUrlInput);
    setActiveBackendUrl(saved || envBackendUrl);
    setBackendUrlInput(saved || envBackendUrl);
    if (!saved && backendUrlInput.trim()) {
      showFeedback(
        tr(
          'Format URL tidak valid. Gunakan URL http:// atau https:// yang benar.',
          'Invalid URL format. Please enter a valid http:// or https:// URL.'
        ),
        'error'
      );
      return;
    }
    showFeedback(
      saved
        ? tr('URL Server Backend Mandiri disimpan.', 'Standalone Backend Server URL saved.')
        : tr('Override URL dihapus; menggunakan konfigurasi bawaan.', 'URL override cleared; using default configuration.')
    );
    if (andTest) {
      await handleTestBackend(saved || envBackendUrl);
    }
  };

  const handleResetBackendUrl = () => {
    clearStandaloneBackendUrl();
    setActiveBackendUrl(envBackendUrl);
    setBackendUrlInput(envBackendUrl);
    setBackendHealth(null);
    showFeedback(
      envBackendUrl
        ? tr('URL dikembalikan ke bawaan build.', 'URL reset to build default.')
        : tr('Konfigurasi URL Server Backend dikosongkan.', 'Backend Server URL configuration cleared.')
    );
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      {/* Top Header */}
      <div className="pb-3 border-b border-[#DDE3EA] dark:border-[#252B34]">
        <h2 className="text-xl font-bold tracking-tight text-[#151D2A] dark:text-[#F2F5F9]">
          {tr('Pengaturan & Cadangan', 'Settings & Backup')}
        </h2>
        <p className="text-xs text-[#697586] dark:text-[#929BA9] mt-0.5">
          {tr(
            'Ruang kerja minimalis untuk mengelola bahasa, tampilan antarmuka, akun trading, sinkronisasi cloud, cadangan data, dan dataset.',
            'Minimalist workspace to manage language, interface appearance, trading account, cloud sync, data backup, and datasets.'
          )}
        </p>
      </div>

      {/* Feedback Message Banner */}
      {feedbackMsg && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-semibold animate-in fade-in duration-150 ${
            feedbackMsg.type === 'success'
              ? 'bg-[#EEF2F6] dark:bg-[#171D26] border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-[#EEF2F6] dark:bg-[#171D26] border-rose-500/30 text-rose-600 dark:text-rose-400'
          }`}
        >
          {feedbackMsg.text}
        </div>
      )}

      {/* ========================================================================= */}
      {/* A. TAMPILAN & BAHASA */}
      {/* ========================================================================= */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block px-1">
          {tr('Tampilan & Bahasa', 'Appearance & Language')}
        </span>
        <div className="bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] rounded-xl divide-y divide-[#DDE3EA] dark:divide-[#252B34]">
          {/* Row 1: Tema Tampilan */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Tema Tampilan', 'Appearance Theme')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr(
                  'Pilihan mode visual aplikasi TradeVault disimpan di perangkat Anda',
                  'Visual theme preference for TradeVault saved on your device'
                )}
              </span>
            </div>

            <div className="flex items-center rounded-lg bg-[#F5F7FA] dark:bg-[#080A0E] p-1 border border-[#DDE3EA] dark:border-[#252B34] shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                  theme === 'light'
                    ? 'bg-white text-[#1458C4] font-semibold shadow-xs'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                }`}
              >
                {tr('Terang', 'Light')}
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-[#171D26] text-[#38BDF8] font-semibold shadow-xs'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                }`}
              >
                {tr('Gelap', 'Dark')}
              </button>
            </div>
          </div>

          {/* Row 2: Bahasa Aplikasi */}
          <div
            data-testid="settings-language-row"
            className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Bahasa Aplikasi', 'Application Language')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr(
                  'Terapkan Bahasa Indonesia atau Bahasa Inggris ke seluruh tampilan aplikasi',
                  'Apply Bahasa Indonesia or English across the entire application interface'
                )}
              </span>
            </div>

            <div
              data-testid="settings-language-selector"
              className="flex items-center rounded-lg bg-[#F5F7FA] dark:bg-[#080A0E] p-1 border border-[#DDE3EA] dark:border-[#252B34] shrink-0 self-start sm:self-auto"
            >
              <button
                type="button"
                data-testid="lang-option-id"
                onClick={() => {
                  setLanguage('id');
                  showFeedback('Bahasa aplikasi diubah ke Bahasa Indonesia.');
                }}
                className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                  language === 'id'
                    ? 'bg-white dark:bg-[#171D26] text-[#1458C4] dark:text-[#38BDF8] font-semibold shadow-xs'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                }`}
              >
                Bahasa Indonesia
              </button>
              <button
                type="button"
                data-testid="lang-option-en"
                onClick={() => {
                  setLanguage('en');
                  showFeedback('Application language changed to English.');
                }}
                className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                  language === 'en'
                    ? 'bg-white dark:bg-[#171D26] text-[#1458C4] dark:text-[#38BDF8] font-semibold shadow-xs'
                    : 'text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9]'
                }`}
              >
                English
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* B. AKUN & PREFERENSI TRADING */}
      {/* ========================================================================= */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block px-1">
          {tr('Akun & Preferensi Trading', 'Account & Trading Preferences')}
        </span>
        <div className="bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] rounded-xl divide-y divide-[#DDE3EA] dark:divide-[#252B34]">
          {/* Row 1: Saldo Akun */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Saldo Akun (Modal Awal)', 'Account Balance (Initial Capital)')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr('Dasar kalkulasi pertumbuhan dan risiko', 'Base for growth and risk calculations')}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-bold font-mono-numbers tabular-nums text-[#151D2A] dark:text-[#F2F5F9]">
                {formatCurrency(settings.startingBalance, settings)}
              </span>
              <button
                type="button"
                onClick={() => setActivePrefModal('balance')}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Ubah ›', 'Edit ›')}
              </button>
            </div>
          </div>

          {/* Row 2: Mata Uang */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Mata Uang Akun', 'Account Currency')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr('Format simbol moneter jurnal', 'Journal monetary symbol format')}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-medium text-[#151D2A] dark:text-[#F2F5F9]">
                {settings.currency} ({settings.currencySymbol})
              </span>
              <button
                type="button"
                onClick={() => setActivePrefModal('currency')}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Ubah ›', 'Edit ›')}
              </button>
            </div>
          </div>

          {/* Row 3: Spesifikasi Broker */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Spesifikasi Broker (XAUUSD)', 'Broker Specification (XAUUSD)')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5 truncate">
                {settings.xauusdPipSize === 0.1
                  ? tr('Mode A (1 Pip = $0.10 Harga)', 'Mode A (1 Pip = $0.10 Price)')
                  : tr('Mode B (1 Pip = $1.00 Harga)', 'Mode B (1 Pip = $1.00 Price)')}{' '}
                • {settings.xauusdContractSize} oz • {tr('Komisi', 'Commission')} ${settings.brokerCommissionPerLot}/lot
              </span>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setActivePrefModal('broker')}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Atur ›', 'Configure ›')}
              </button>
            </div>
          </div>

          {/* Row 4: Parameter Risiko & Target */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Parameter Risiko & Target', 'Risk & Target Parameters')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5 truncate">
                {tr('Risiko', 'Risk')} {settings.defaultRiskPercent}% {tr('per trade', 'per trade')} (
                {settings.riskCapitalBasis === 'BALANCE'
                  ? tr('Saldo Awal', 'Initial Balance')
                  : tr('Ekuitas', 'Equity')}
                ) • {tr('Target', 'Target')} {settings.targetMonthlyReturnPercent}%/{tr('bln', 'mo')}
              </span>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setActivePrefModal('risk')}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Atur ›', 'Configure ›')}
              </button>
            </div>
          </div>

          {/* Row 5: Penyesuaian Modal (Deposit / WD) */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Penyesuaian Modal', 'Capital Adjustments')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5 truncate">
                {tr('Deposit', 'Deposits')} +{formatCurrency(settings.totalDeposits ?? 0, settings)} •{' '}
                {tr('Penarikan', 'Withdrawals')} -{formatCurrency(settings.totalWithdrawals ?? 0, settings)}
              </span>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setActivePrefModal('adjustments')}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Atur ›', 'Configure ›')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* C. AKUN & KONEKSI */}
      {/* ========================================================================= */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block px-1">
          {tr('Akun & Koneksi', 'Account & Connection')}
        </span>
        <div className="bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] rounded-xl divide-y divide-[#DDE3EA] dark:divide-[#252B34]">
          {/* Row 1: Informasi Akun TradeVault */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Akun TradeVault', 'TradeVault Account')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5 truncate">
                {currentUser
                  ? currentUser.email
                  : tr('Mode Offline / Lokal (Belum Masuk)', 'Offline / Local Mode (Not Signed In)')}
              </span>
            </div>
            <div className="shrink-0">
              {currentUser ? (
                <button
                  type="button"
                  onClick={onOpenAccount}
                  className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
                >
                  {tr('Kelola ›', 'Manage ›')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
                >
                  {tr('Masuk ›', 'Sign In ›')}
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Sinkronisasi Cloud */}
          <div className="px-4 py-3.5 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                  {tr('Sinkronisasi Cloud Supabase', 'Supabase Cloud Synchronization')}
                </span>
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                  {currentUser
                    ? tr('Tabel public.trades aktif • RLS terlindungi', 'Table public.trades active • RLS protected')
                    : tr(
                        'Sinkronisasi nonaktif. Masuk akun untuk mengaktifkan sinkronisasi.',
                        'Sync inactive. Sign in to enable cloud synchronization.'
                      )}
                </span>
              </div>
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={onOpenConfig}
                  className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
                >
                  {tr('Konfigurasi ›', 'Configure ›')}
                </button>
              </div>
            </div>

            {/* Cloud Controls if logged in */}
            {currentUser && (
              <div className="pt-2 flex flex-wrap items-center gap-2">
                {onSyncLocalToCloud && trades.length > 0 && (
                  <button
                    type="button"
                    disabled={isCloudSyncing}
                    onClick={onSyncLocalToCloud}
                    className="px-3 py-1.5 rounded-lg bg-[#1458C4] hover:bg-[#11469e] text-white text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isCloudSyncing
                      ? tr('Menyinkronkan...', 'Syncing...')
                      : tr(`Unggah ${trades.length} Trade ke Cloud`, `Upload ${trades.length} Trades to Cloud`)}
                  </button>
                )}
                {onReloadFromCloud && (
                  <button
                    type="button"
                    disabled={isCloudSyncing}
                    onClick={onReloadFromCloud}
                    className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-[11px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {tr('Ambil dari Cloud', 'Fetch from Cloud')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Row 3: Server Backend Mandiri (Gemini AI & Proxy) */}
          <div className="px-4 py-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                  {tr(
                    'Server Backend Mandiri (Gemini AI & Feed Proxy)',
                    'Standalone Backend Server (Gemini AI & Feed Proxy)'
                  )}
                </span>
                <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5 truncate">
                  {activeBackendUrl
                    ? activeBackendUrl
                    : tr(
                        'Belum diatur — APK memakai feed langsung & scanner lokal; atur URL server Node.js mandiri untuk Gemini AI penuh.',
                        'Not configured — APK uses direct feeds & local scanner; set your standalone Node.js server URL for full Gemini AI.'
                      )}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  disabled={isTestingBackend}
                  onClick={() => handleTestBackend(isEditingBackend ? backendUrlInput : activeBackendUrl)}
                  className="text-xs font-medium text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] disabled:opacity-50 cursor-pointer"
                >
                  {isTestingBackend ? tr('Menguji...', 'Testing...') : tr('Tes Koneksi', 'Test')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingBackend((prev) => !prev);
                    setBackendUrlInput(activeBackendUrl);
                  }}
                  className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
                >
                  {isEditingBackend ? tr('Tutup', 'Close') : tr('Atur ›', 'Configure ›')}
                </button>
              </div>
            </div>

            {backendHealth && (
              <div
                className={`px-3 py-2 rounded-lg border text-[11px] leading-relaxed ${
                  backendHealth.reachable && backendHealth.geminiConfigured
                    ? 'bg-[#EEF2F6] dark:bg-[#171D26] border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : backendHealth.reachable
                    ? 'bg-[#EEF2F6] dark:bg-[#171D26] border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-[#EEF2F6] dark:bg-[#171D26] border-rose-500/30 text-rose-600 dark:text-rose-400'
                }`}
              >
                {language === 'id' ? backendHealth.messageId : backendHealth.messageEn}
              </div>
            )}

            {isEditingBackend && (
              <div className="pt-1 space-y-2">
                <input
                  type="url"
                  value={backendUrlInput}
                  onChange={(e) => setBackendUrlInput(e.target.value)}
                  placeholder="https://tradevault-api.up.railway.app"
                  className="w-full px-3 py-2 rounded-lg bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] text-xs text-[#151D2A] dark:text-[#F2F5F9] placeholder-[#929BA9] focus:outline-none focus:border-[#1458C4] dark:focus:border-[#38BDF8]"
                />
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    'Arahkan ke deployment Node.js (server.ts) milik Anda yang menyimpan GEMINI_API_KEY di server — aman dan terpisah penuh dari Google AI Studio.',
                    'Point to your self-hosted Node.js (server.ts) deployment with server-side GEMINI_API_KEY — secure and completely separate from Google AI Studio.'
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isTestingBackend}
                    onClick={() => handleSaveBackendUrl(true)}
                    className="px-3 py-1.5 rounded-lg bg-[#1458C4] hover:bg-[#11469e] text-white text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {tr('Simpan & Tes Koneksi', 'Save & Test')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveBackendUrl(false)}
                    className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    {tr('Simpan', 'Save')}
                  </button>
                  {activeBackendUrl && (
                    <button
                      type="button"
                      onClick={handleResetBackendUrl}
                      className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9] hover:text-rose-600 dark:hover:text-rose-400 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      {tr('Reset', 'Reset')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Row 4: Penyimpanan Lokal */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Penyimpanan Lokal Browser', 'Browser Local Storage')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr(
                  `${trades.length} Transaksi tersimpan di browser (localStorage)`,
                  `${trades.length} Trades stored in browser (localStorage)`
                )}
              </span>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={onOpenLocalInfo}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Detail ›', 'Details ›')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* D. BACKUP & PEMULIHAN */}
      {/* ========================================================================= */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block px-1">
          {tr('Cadangan & Pemulihan', 'Backup & Recovery')}
        </span>
        <div className="bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
              {tr('Cadangan Data (Backup & Restore)', 'Data Backup (Backup & Restore)')}
            </span>
            <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
              {tr(
                'Simpan atau pulihkan transaksi dan data pendukung TradeVault dalam format ZIP lengkap, JSON, atau CSV.',
                'Save or restore TradeVault trades and supporting data in full ZIP, JSON, or CSV format.'
              )}
            </span>
          </div>
          <div className="shrink-0">
            <button
              type="button"
              onClick={onOpenBackupModal}
              className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
            >
              {tr('Buka ›', 'Open ›')}
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* E. MANAJEMEN DATA */}
      {/* ========================================================================= */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#697586] dark:text-[#929BA9] block px-1">
          {tr('Manajemen Data', 'Data Management')}
        </span>
        <div className="bg-white dark:bg-[#11151B] border border-[#DDE3EA] dark:border-[#252B34] rounded-xl divide-y divide-[#DDE3EA] dark:divide-[#252B34]">
          {/* Row 1: Transaksi Demo */}
          <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Dataset Transaksi Demo', 'Demo Trades Dataset')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr(
                  `${demoCount} transaksi contoh • ${realCount} transaksi asli`,
                  `${demoCount} sample trades • ${realCount} real trades`
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleLoadDemo}
                className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#252B34] hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-[#151D2A] dark:text-[#F2F5F9] text-xs font-medium transition-colors cursor-pointer"
              >
                {tr('Muat Demo', 'Load Demo')}
              </button>
              {demoCount > 0 && (
                <button
                  type="button"
                  onClick={onRequestClearDemo}
                  className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#252B34] text-amber-600 dark:text-amber-400 hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] text-xs font-semibold transition-colors cursor-pointer"
                >
                  {tr(`Hapus Demo (${demoCount})`, `Clear Demo (${demoCount})`)}
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Audit Rumus Finansial */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Audit Rumus Finansial', 'Financial Formula Audit')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5 truncate">
                {tr(
                  'Uji 46 formula matematis (Tingkat Menang, Faktor Profit, Ekspektasi, Penurunan, Ukuran Lot)',
                  'Test 46 mathematical formulas (Win Rate, Profit Factor, Expectancy, Drawdown, Lot Sizing)'
                )}
              </span>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setIsAuditModalOpen(true)}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Jalankan ›', 'Run ›')}
              </button>
            </div>
          </div>

          {/* Row 3: Impor CSV Spreadsheet */}
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#151D2A] dark:text-[#F2F5F9] block">
                {tr('Impor Transaksi Spreadsheet (CSV)', 'Import Spreadsheet Trades (CSV)')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr(
                  'Unggah riwayat transaksi dari format tabel CSV/Excel',
                  'Upload trade history from CSV/Excel table format'
                )}
              </span>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setIsCsvModalOpen(true)}
                className="text-xs font-semibold text-[#1458C4] dark:text-[#38BDF8] hover:underline cursor-pointer"
              >
                {tr('Impor ›', 'Import ›')}
              </button>
            </div>
          </div>

          {/* Row 4: Tindakan Sensitif — Reset Total Jurnal */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 block">
                {tr('Reset Total Jurnal', 'Full Journal Reset')}
              </span>
              <span className="text-[11px] text-[#697586] dark:text-[#929BA9] block mt-0.5">
                {tr(
                  'Hapus seluruh transaksi untuk memulai jurnal baru dari nol. Tindakan ini tidak dapat dibatalkan.',
                  'Delete all trades to start a fresh journal from scratch. This action cannot be undone.'
                )}
              </span>
            </div>

            <div className="shrink-0 self-start sm:self-auto">
              {!isConfirmingClearAll ? (
                <button
                  type="button"
                  disabled={isCloudSyncing || trades.length === 0}
                  onClick={() => setIsConfirmingClearAll(true)}
                  className="px-3.5 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9] hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-300 dark:hover:border-rose-900 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {tr('Reset Semua', 'Reset All')}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isCloudSyncing}
                    onClick={() => setIsConfirmingClearAll(false)}
                    className="px-3 py-1.5 rounded-lg border border-[#DDE3EA] dark:border-[#252B34] text-[#151D2A] dark:text-[#F2F5F9] text-xs font-medium hover:bg-[#EEF2F6] dark:hover:bg-[#171D26] transition-colors cursor-pointer"
                  >
                    {tr('Batal', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={isCloudSyncing}
                    onClick={handleConfirmClearAllTrades}
                    className="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors cursor-pointer"
                  >
                    {tr('Ya, Hapus Semua', 'Yes, Delete All')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Trading Preferences Modal (Group B Editor) */}
      <TradingPreferencesModal
        isOpen={Boolean(activePrefModal)}
        onClose={() => setActivePrefModal(null)}
        category={activePrefModal || 'balance'}
        settings={settings}
        onSave={handleSavePreferences}
      />

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        onConfirmImport={handleImportCsvSuccess}
      />

      {/* Financial Calculations Audit Modal */}
      <FinancialAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
      />
    </div>
  );
};
