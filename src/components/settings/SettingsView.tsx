/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sun,
  Moon,
  Globe,
  Wallet,
  Coins,
  SlidersHorizontal,
  ShieldCheck,
  ArrowLeftRight,
  User,
  Cloud,
  Server,
  Wifi,
  WifiOff,
  Database,
  HardDriveDownload,
  FileSpreadsheet,
  Layers,
  Calculator,
  Trash2,
  ChevronRight,
  RefreshCw,
  UploadCloud,
  Check,
  AlertCircle,
  Camera,
  Volume2,
  VolumeX,
  BellRing,
  Smartphone,
  BookOpen,
  ClipboardCheck,
  Plus,
  Terminal,
  Copy,
  EyeOff,
  Lock,
  Sparkles,
  Wrench,
  ShieldAlert,
  CheckCircle2,
  X,
} from 'lucide-react';
import { AppSettings } from '../../types/settings';
import { Trade } from '../../types/trade';
import {
  resolveConfiguredAccounts,
  resolveAccountScopedSettings,
  filterTradesByAccount,
  getActivePlaybooks,
  getActiveChecklist,
} from '../../utils/journalExtras';
import { PWAInstallButton } from '../layout/PWAInstallButton';
import { formatCurrency, calculatePerformance } from '../../utils/calculations';
import { calculateCapitalGrowthBreakdown } from '../../utils/currencyRate';
import { isDemoTrade, DEMO_TRADES } from '../../utils/demoData';
import { mergeTradesDatasets } from '../../utils/supabaseSync';
import {
  getUserAvatarUrl,
  updateUserProfileAvatar,
  removeUserProfileAvatar,
} from '../../utils/supabaseClient';
import { useTheme } from '../../utils/theme';
import { useLanguage } from '../../utils/language';
import {
  useSoundPreferences,
  playNotificationPing,
  playUiClick,
  playSuccessChime,
  playErrorTone,
  triggerHaptic,
} from '../../utils/soundEngine';
import { CsvImportModal } from './CsvImportModal';
import { FinancialAuditModal } from './FinancialAuditModal';
import { TradingPreferencesModal, PreferenceCategory } from './TradingPreferencesModal';
import {
  getStandaloneBackendUrl,
  getBackendSourceInfo,
  saveStandaloneBackendUrl,
  clearStandaloneBackendUrl,
  testStandaloneBackendConnection,
  StandaloneBackendHealthResult,
  isNewsCycleOfflineMode,
  setNewsCycleOfflineMode,
  NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT,
  NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY,
} from '../../utils/apiConfig';
import {
  APP_VERSION,
  APP_RELEASE_DATE,
  APP_VERSION_HISTORY,
  BUILD_GIT_SHA,
  getAppBuildIdentity,
} from '../../config/appVersion';
import {
  clearMt5OcrScanDiagnostics,
  getRecentMt5OcrScanDiagnostics,
  Mt5OcrScanDiagnostic,
  OfflineOcrRuntimeProbe,
  probeOfflineOcrRuntimeEnvironment,
} from '../../utils/offlineMt5Ocr';
import {
  runFullApkSystemProbe,
  type FullApkSystemProbeResult,
} from '../../utils/apkDiagnostics';
import {
  verifyDeveloperPasscode,
  getAppDiagnosticEvents,
  clearAppDiagnosticEvents,
  runSafeCleaningService,
  runAiQaDiagnosticsAnalysis,
  type AppDiagnosticEvent,
  type CleaningServiceReport,
  type AiQaDiagnosisClientResult,
} from '../../utils/devDiagnosticsStore';

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
  isDeveloperMode?: boolean;
  onUnlockDeveloperMode?: () => void;
  onLockDeveloperMode?: () => void;
  onUserUpdated?: (user: any) => void;
  onOpenPlaybook?: () => void;
  onOpenAccountSwitcher?: () => void;
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
  isDeveloperMode = false,
  onUnlockDeveloperMode,
  onLockDeveloperMode,
  onUserUpdated,
  onOpenPlaybook,
  onOpenAccountSwitcher,
}) => {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, tr } = useLanguage();
  const {
    uiClickEnabled,
    notificationSoundEnabled,
    hapticEnabled,
    updateSoundPreferences,
  } = useSoundPreferences();

  // Modals state
  const [activePrefModal, setActivePrefModal] = useState<PreferenceCategory | null>(null);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isConfirmingClearAll, setIsConfirmingClearAll] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  // Standalone Backend Server config state
  const [isEditingBackend, setIsEditingBackend] = useState(false);
  const [backendInfo, setBackendInfo] = useState(() => getBackendSourceInfo());
  const [backendUrlInput, setBackendUrlInput] = useState(() => getStandaloneBackendUrl());
  const [isTestingBackend, setIsTestingBackend] = useState(false);
  const [backendHealth, setBackendHealth] = useState<StandaloneBackendHealthResult | null>(null);
  const [isNewsCycleOffline, setIsNewsCycleOffline] = useState(() => isNewsCycleOfflineMode());
  const [devTapCount, setDevTapCount] = useState(0);
  const devLastTapRef = useRef<number>(0);
  const [isDevPasscodeModalOpen, setIsDevPasscodeModalOpen] = useState(false);
  const [devPasscodeInput, setDevPasscodeInput] = useState('');
  const [devPasscodeError, setDevPasscodeError] = useState<string | null>(null);
  const [isVerifyingPasscode, setIsVerifyingPasscode] = useState(false);

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [ocrRuntimeProbe, setOcrRuntimeProbe] = useState<OfflineOcrRuntimeProbe | null>(null);
  const [apkSystemProbe, setApkSystemProbe] = useState<FullApkSystemProbeResult | null>(null);
  const [isProbingOcr, setIsProbingOcr] = useState(false);
  const [ocrScanHistory, setOcrScanHistory] = useState<Mt5OcrScanDiagnostic[]>(() =>
    getRecentMt5OcrScanDiagnostics()
  );
  const [recentErrorLogs, setRecentErrorLogs] = useState<AppDiagnosticEvent[]>(() =>
    getAppDiagnosticEvents()
  );
  const [isCleaningRunning, setIsCleaningRunning] = useState(false);
  const [cleaningReport, setCleaningReport] = useState<CleaningServiceReport | null>(null);
  const [isRunningAiQa, setIsRunningAiQa] = useState(false);
  const [aiQaResult, setAiQaResult] = useState<AiQaDiagnosisClientResult | null>(null);
  const [aiQaError, setAiQaError] = useState<string | null>(null);
  const [copiedOcrReport, setCopiedOcrReport] = useState(false);
  const appBuildIdentity = useMemo(() => getAppBuildIdentity(), []);
  const [isChecklistEditorOpen, setIsChecklistEditorOpen] = useState(false);
  const [newChecklistLabel, setNewChecklistLabel] = useState('');

  const handleRunOcrRuntimeProbe = async () => {
    setIsProbingOcr(true);
    try {
      const [probe, apkProbe] = await Promise.all([
        probeOfflineOcrRuntimeEnvironment(),
        runFullApkSystemProbe(),
      ]);
      setOcrRuntimeProbe(probe);
      setApkSystemProbe(apkProbe);
      setOcrScanHistory(getRecentMt5OcrScanDiagnostics());
      setRecentErrorLogs(getAppDiagnosticEvents());
    } finally {
      setIsProbingOcr(false);
    }
  };

  useEffect(() => {
    if (isDeveloperMode) {
      setRecentErrorLogs(getAppDiagnosticEvents());
      setOcrScanHistory(getRecentMt5OcrScanDiagnostics());
      if (!ocrRuntimeProbe && !isProbingOcr) {
        void handleRunOcrRuntimeProbe();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeveloperMode]);

  const handleVersionBadgeTap = () => {
    if (isDeveloperMode) return;
    const now = Date.now();
    const withinWindow = now - devLastTapRef.current <= 3000;
    devLastTapRef.current = now;
    const next = withinWindow ? devTapCount + 1 : 1;
    if (next >= 7) {
      setDevTapCount(0);
      setDevPasscodeInput('');
      setDevPasscodeError(null);
      setIsDevPasscodeModalOpen(true);
    } else {
      setDevTapCount(next);
    }
  };

  const handleSubmitDevPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devPasscodeInput.trim() || isVerifyingPasscode) return;
    setIsVerifyingPasscode(true);
    setDevPasscodeError(null);
    try {
      const ok = await verifyDeveloperPasscode(devPasscodeInput);
      if (ok) {
        setIsDevPasscodeModalOpen(false);
        setDevPasscodeInput('');
        onUnlockDeveloperMode?.();
        showFeedback(
          tr('Mode Pengembang aktif. Cloud, Backend & Diagnostik ditampilkan.', 'Developer Mode enabled.')
        );
      } else {
        setDevPasscodeError(tr('Kode akses tidak cocok.', 'Invalid access code.'));
      }
    } finally {
      setIsVerifyingPasscode(false);
    }
  };

  const handleHideDeveloperMode = () => {
    setIsEditingBackend(false);
    setAiQaResult(null);
    setAiQaError(null);
    setCleaningReport(null);
    onLockDeveloperMode?.();
    showFeedback(
      tr('Mode Pengembang disembunyikan kembali.', 'Developer Mode hidden.')
    );
  };

  const handleRunCleaningService = async () => {
    setIsCleaningRunning(true);
    setCleaningReport(null);
    try {
      const report = await runSafeCleaningService();
      setCleaningReport(report);
      setRecentErrorLogs(getAppDiagnosticEvents());
      setOcrScanHistory(getRecentMt5OcrScanDiagnostics());
      await handleRunOcrRuntimeProbe();
      showFeedback(
        tr('Cleaning Service selesai — cache usang dibersihkan, data jurnal aman.', 'Cleaning Service complete.')
      );
    } finally {
      setIsCleaningRunning(false);
    }
  };

  const handleRunAiQaDiagnosis = async () => {
    setIsRunningAiQa(true);
    setAiQaError(null);
    try {
      let currentProbe = ocrRuntimeProbe;
      let currentApk = apkSystemProbe;
      if (!currentProbe || !currentApk) {
        const [p, a] = await Promise.all([
          probeOfflineOcrRuntimeEnvironment(),
          runFullApkSystemProbe(),
        ]);
        currentProbe = p;
        currentApk = a;
        setOcrRuntimeProbe(p);
        setApkSystemProbe(a);
      }
      const latestErrors = getAppDiagnosticEvents();
      setRecentErrorLogs(latestErrors);
      const latestScans = getRecentMt5OcrScanDiagnostics();
      setOcrScanHistory(latestScans);

      const diagnosis = await runAiQaDiagnosticsAnalysis({
        language,
        diagnosticReport: {
          build: appBuildIdentity,
          apkSystemProbe: currentApk,
          runtimeProbe: currentProbe,
          recentScans: latestScans.slice(0, 5),
          recentErrorLogs: latestErrors.slice(0, 15),
        },
      });
      setAiQaResult(diagnosis);
    } catch (err) {
      setAiQaError(
        err instanceof Error
          ? err.message
          : tr('Gagal menjalankan analisa AI QA.', 'Failed to run AI QA diagnosis.')
      );
    } finally {
      setIsRunningAiQa(false);
    }
  };

  const handleCopyFullOcrDiagnostics = async () => {
    const payload = {
      build: appBuildIdentity,
      apkSystemProbe,
      runtimeProbe: ocrRuntimeProbe,
      recentScans: ocrScanHistory,
      recentErrorLogs,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedOcrReport(true);
      window.setTimeout(() => setCopiedOcrReport(false), 1800);
    } catch {
      // ignore clipboard errors on restricted WebViews
    }
  };

  const effectiveAccounts = resolveConfiguredAccounts(settings);
  const effectivePlaybooks = getActivePlaybooks(settings);
  const effectiveChecklist = getActiveChecklist(settings);
  const activeAccountId = settings.activeAccountId || 'ALL';

  const scopedSettings = useMemo(
    () => resolveAccountScopedSettings(settings, activeAccountId),
    [settings, activeAccountId]
  );

  const scopedTrades = useMemo(
    () => filterTradesByAccount(trades, activeAccountId),
    [trades, activeAccountId]
  );

  const capitalBreakdown = useMemo(() => {
    const { metrics } = calculatePerformance(scopedTrades, scopedSettings);
    return calculateCapitalGrowthBreakdown(scopedSettings, metrics.totalNetProfit || 0);
  }, [scopedTrades, scopedSettings]);

  const handleToggleChecklistEnabled = (itemId: string) => {
    const next = effectiveChecklist.map((item) =>
      item.id === itemId ? { ...item, enabled: !item.enabled } : item
    );
    onSaveSettings({ ...settings, preTradeChecklist: next });
  };

  const handleAddChecklistItem = () => {
    const trimmed = newChecklistLabel.trim();
    if (!trimmed) return;
    const next = [
      ...effectiveChecklist,
      { id: `chk-${Date.now()}`, labelId: trimmed, labelEn: trimmed, enabled: true },
    ];
    onSaveSettings({ ...settings, preTradeChecklist: next });
    setNewChecklistLabel('');
    showFeedback(tr('Item checklist SOP ditambahkan.', 'SOP checklist item added.'));
  };

  const handleDeleteChecklistItem = (itemId: string) => {
    const next = effectiveChecklist.filter((item) => item.id !== itemId);
    onSaveSettings({ ...settings, preTradeChecklist: next });
  };

  useEffect(() => {
    const syncOffline = () => setIsNewsCycleOffline(isNewsCycleOfflineMode());
    const handleStorage = (e: StorageEvent) => {
      if (e.key === NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY) {
        syncOffline();
      }
    };
    window.addEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, syncOffline);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, syncOffline);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMsg({ text, type });
    if (type === 'error') {
      playErrorTone();
    } else {
      playSuccessChime();
    }
    window.setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleSettingsAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUpdatingAvatar(true);
    const res = await updateUserProfileAvatar(file);
    setIsUpdatingAvatar(false);

    if (res.success && res.user) {
      onUserUpdated?.(res.user);
      showFeedback(tr('Foto profil berhasil diperbarui.', 'Profile photo updated successfully.'));
    } else {
      showFeedback(
        res.error || tr('Gagal memperbarui foto profil.', 'Failed to update profile photo.'),
        'error'
      );
    }
  };

  const handleSettingsAvatarRemove = async () => {
    if (isUpdatingAvatar) return;
    setIsUpdatingAvatar(true);
    const res = await removeUserProfileAvatar();
    setIsUpdatingAvatar(false);

    if (res.success && res.user) {
      onUserUpdated?.(res.user);
      showFeedback(tr('Foto profil telah dihapus.', 'Profile photo has been removed.'));
    } else {
      showFeedback(
        res.error || tr('Gagal menghapus foto profil.', 'Failed to remove profile photo.'),
        'error'
      );
    }
  };

  const activeAvatarUrl = currentUser ? getUserAvatarUrl(currentUser) : '';

  const handleToggleNewsCycleOffline = () => {
    const next = !isNewsCycleOffline;
    setNewsCycleOfflineMode(next);
    setIsNewsCycleOffline(next);
    showFeedback(
      next
        ? tr(
            'Mode Offline aktif untuk Trade News & Cycle. Scan Kilat AI tetap aktif online.',
            'Offline Mode enabled for Trade News & Cycle. Instant AI Scan remains online.'
          )
        : tr(
            'Mode Online aktif kembali untuk Trade News & Cycle.',
            'Online Mode re-enabled for Trade News & Cycle.'
          )
    );
  };

  const demoCount = trades.filter((t) => isDemoTrade(t)).length;
  const realCount = trades.filter((t) => !isDemoTrade(t)).length;

  const handleSavePreferences = (newSettings: AppSettings) => {
    onSaveSettings(newSettings);
    showFeedback(tr('Pengaturan berhasil diperbarui.', 'Settings updated successfully.'));
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
        `Berhasil mengimpor ${newTrades.length} transaksi dari CSV.`,
        `Successfully imported ${newTrades.length} trades from CSV.`
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
    const nextInfo = getBackendSourceInfo();
    setBackendInfo(nextInfo);
    setBackendUrlInput(nextInfo.url);
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
        ? tr('URL Server Backend disimpan.', 'Backend Server URL saved.')
        : tr(
            'Override URL dihapus; kembali ke konfigurasi otomatis.',
            'URL override cleared; reverted to automatic configuration.'
          )
    );
    if (andTest) {
      await handleTestBackend(nextInfo.url);
    }
  };

  const handleResetBackendUrl = () => {
    clearStandaloneBackendUrl();
    const nextInfo = getBackendSourceInfo();
    setBackendInfo(nextInfo);
    setBackendUrlInput(nextInfo.url);
    setBackendHealth(null);
    showFeedback(
      nextInfo.source === 'supabase-edge'
        ? tr(
            'Kembali ke Supabase Edge Functions otomatis.',
            'Reverted to automatic Supabase Edge Functions.'
          )
        : nextInfo.url
        ? tr('URL dikembalikan ke bawaan aplikasi.', 'URL reset to build default.')
        : tr('Konfigurasi URL Server Backend dikosongkan.', 'Backend Server URL configuration cleared.')
    );
  };

  const sectionLabelClass =
    'text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071] dark:text-[#929BA9] px-1 block';
  const cardClass =
    'bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none rounded-xl divide-y divide-[#E4E4E7] dark:divide-[#20252D] overflow-hidden';
  const rowInteractiveClass =
    'w-full px-4 py-3.5 flex items-center justify-between gap-4 text-left hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]/75 transition-colors duration-150 cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35';
  const iconClass = 'h-4 w-4 shrink-0 text-[#526071] dark:text-[#929BA9] stroke-[1.75]';
  const chevronClass =
    'h-4 w-4 shrink-0 text-[#526071] dark:text-[#929BA9] group-hover:text-[#0F172A] dark:group-hover:text-[#F2F4F7] transition-colors stroke-[1.75]';

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F2F4F7]">
            {tr('Pengaturan Aplikasi', 'App Settings')}
          </h1>
          <p className="text-xs text-[#526071] dark:text-[#929BA9] mt-1">
            {tr(
              'Kelola tampilan, parameter trading XAUUSD, sinkronisasi cloud, serta cadangan data VLO.',
              'Manage appearance, XAUUSD trading parameters, cloud sync, and VLO data backups.'
            )}
          </p>
        </div>
        <span className="text-[11px] font-mono-numbers tabular-nums font-medium text-[#526071] dark:text-[#929BA9] shrink-0">
          {tr(`${trades.length} Transaksi`, `${trades.length} Trades`)}
        </span>
      </div>

      {/* Inline Feedback Notice */}
      {feedbackMsg && (
        <div
          role="status"
          className="px-4 py-3 rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none flex items-center gap-2.5 text-xs font-semibold animate-in fade-in duration-150"
        >
          {feedbackMsg.type === 'success' ? (
            <Check className="h-4 w-4 shrink-0 text-[#059669] dark:text-[#00A878] stroke-[2]" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-[#E11D48] dark:text-[#E05260] stroke-[2]" />
          )}
          <span
            className={
              feedbackMsg.type === 'success'
                ? 'text-[#059669] dark:text-[#00A878]'
                : 'text-[#E11D48] dark:text-[#E05260]'
            }
          >
            {feedbackMsg.text}
          </span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TOP ACCOUNT & SYNC SUMMARY CARD                                       */}
      {/* ===================================================================== */}
      <div className="bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none rounded-xl p-4 sm:p-5 space-y-4">
        <input
          ref={avatarFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleSettingsAvatarChange}
          data-testid="settings-avatar-file-input"
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            {currentUser ? (
              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={isUpdatingAvatar}
                  onClick={() => avatarFileInputRef.current?.click()}
                  data-testid="settings-avatar-upload-trigger"
                  aria-label={tr('Ubah Foto Profil', 'Change Profile Photo')}
                  title={tr('Klik untuk mengubah foto profil', 'Click to change profile photo')}
                  className="group relative h-12 w-12 rounded-full bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#0F172A] dark:text-[#F2F4F7] overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 disabled:opacity-60"
                >
                  {activeAvatarUrl ? (
                    <img
                      src={activeAvatarUrl}
                      alt={
                        currentUser.user_metadata?.full_name ||
                        currentUser.user_metadata?.name ||
                        currentUser.email ||
                        'User'
                      }
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="font-bold uppercase text-base select-none">
                      {(
                        currentUser.user_metadata?.full_name ||
                        currentUser.user_metadata?.name ||
                        currentUser.email ||
                        'U'
                      ).charAt(0)}
                    </span>
                  )}
                  <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    {isUpdatingAvatar ? (
                      <RefreshCw className="h-3.5 w-3.5 text-white animate-spin stroke-[2]" />
                    ) : (
                      <Camera className="h-3.5 w-3.5 text-white stroke-[2]" />
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isUpdatingAvatar}
                  onClick={() => avatarFileInputRef.current?.click()}
                  aria-label={tr('Unggah Foto Profil', 'Upload Profile Photo')}
                  title={tr('Unggah Foto Profil', 'Upload Profile Photo')}
                  className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] border-2 border-white dark:border-[#101318] flex items-center justify-center shadow-xs transition-colors cursor-pointer disabled:opacity-60"
                >
                  {isUpdatingAvatar ? (
                    <RefreshCw className="h-2.5 w-2.5 animate-spin stroke-[2]" />
                  ) : (
                    <Camera className="h-2.5 w-2.5 stroke-[2]" />
                  )}
                </button>
              </div>
            ) : (
              <div className="h-11 w-11 rounded-full bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-[#0F172A] dark:text-[#F2F4F7] stroke-[1.75]" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                  {currentUser
                    ? currentUser.user_metadata?.full_name ||
                      currentUser.user_metadata?.name ||
                      currentUser.email
                    : tr('Mode Penyimpanan Lokal', 'Local Storage Mode')}
                </span>
              </div>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-0.5 leading-snug">
                {currentUser ? (
                  <span className="text-[#059669] dark:text-[#00A878] font-medium">
                    {tr('VLO Cloud aktif · Data terenkripsi & terisolasi', 'VLO Cloud active · Data encrypted & isolated')}
                  </span>
                ) : (
                  tr(
                    'Masuk akun untuk mengaktifkan sinkronisasi jurnal lintas perangkat.',
                    'Sign in to enable cross-device journal synchronization.'
                  )
                )}
              </p>
            </div>
          </div>

          <div className="shrink-0 self-start sm:self-center flex flex-wrap items-center gap-2">
            {currentUser ? (
              <>
                <button
                  type="button"
                  disabled={isUpdatingAvatar}
                  onClick={() => avatarFileInputRef.current?.click()}
                  data-testid="settings-upload-photo-btn"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] hover:bg-[#F4F4F5] dark:hover:bg-[#1F2530] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 disabled:opacity-50"
                >
                  {isUpdatingAvatar ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin stroke-[1.75]" />
                  ) : (
                    <Camera className="h-3.5 w-3.5 stroke-[1.75]" />
                  )}
                  <span>
                    {activeAvatarUrl
                      ? tr('Ganti Foto', 'Change Photo')
                      : tr('Tambah Foto', 'Add Photo')}
                  </span>
                </button>
                {activeAvatarUrl && (
                  <button
                    type="button"
                    disabled={isUpdatingAvatar}
                    onClick={handleSettingsAvatarRemove}
                    data-testid="settings-remove-photo-btn"
                    aria-label={tr('Hapus Foto Profil', 'Remove Profile Photo')}
                    title={tr('Hapus Foto Profil', 'Remove Profile Photo')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] hover:bg-[#F4F4F5] dark:hover:bg-[#1F2530] text-[#526071] hover:text-[#E11D48] dark:text-[#929BA9] dark:hover:text-[#E05260] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenAccount}
                  className="px-4 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {tr('Kelola Akun', 'Manage Account')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-4 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                {tr('Masuk Akun', 'Sign In')}
              </button>
            )}
          </div>
        </div>

        {currentUser && (onSyncLocalToCloud || onReloadFromCloud) && (
          <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D] flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#526071] dark:text-[#929BA9]">
              {tr('Sinkronisasi manual data jurnal & pengaturan', 'Manual sync for journal trades & settings')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {onSyncLocalToCloud && trades.length > 0 && (
                <button
                  type="button"
                  disabled={isCloudSyncing}
                  onClick={onSyncLocalToCloud}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  <UploadCloud className="h-3.5 w-3.5 stroke-[1.75]" />
                  <span>
                    {isCloudSyncing
                      ? tr('Menyinkronkan...', 'Syncing...')
                      : tr(`Unggah (${trades.length})`, `Upload (${trades.length})`)}
                  </span>
                </button>
              )}
              {onReloadFromCloud && (
                <button
                  type="button"
                  disabled={isCloudSyncing}
                  onClick={onReloadFromCloud}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] text-[11px] font-medium transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  <RefreshCw className={`h-3.5 w-3.5 stroke-[1.75] ${isCloudSyncing ? 'animate-spin' : ''}`} />
                  <span>{tr('Muat Ulang dari Cloud', 'Reload from Cloud')}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 1. TAMPILAN & BAHASA                                                  */}
      {/* ===================================================================== */}
      <section id="settings-appearance" className="space-y-2">
        <span className={sectionLabelClass}>
          {tr('Tampilan & Bahasa', 'Appearance & Language')}
        </span>
        <div className={cardClass}>
          {/* Tema Tampilan */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              {theme === 'dark' ? (
                <Moon className={`${iconClass} mt-0.5`} />
              ) : (
                <Sun className={`${iconClass} mt-0.5`} />
              )}
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Tema Visual', 'Visual Theme')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Mode warna antarmuka VLO disimpan pada perangkat ini',
                    'VLO interface color mode saved on this device'
                  )}
                </span>
              </div>
            </div>

            <div className="inline-flex items-center rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] p-1 border border-[#E4E4E7] dark:border-[#20252D] shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  theme === 'light'
                    ? 'bg-[#0F172A] text-white font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                {tr('Terang', 'Light')}
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  theme === 'dark'
                    ? 'bg-white text-[#050607] font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                {tr('Gelap', 'Dark')}
              </button>
            </div>
          </div>

          {/* Bahasa Aplikasi */}
          <div
            data-testid="settings-language-row"
            className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3 min-w-0">
              <Globe className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Bahasa Aplikasi', 'Application Language')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Terapkan Bahasa Indonesia atau Bahasa Inggris ke seluruh antarmuka',
                    'Apply Bahasa Indonesia or English across the entire application'
                  )}
                </span>
              </div>
            </div>

            <div
              data-testid="settings-language-selector"
              className="inline-flex items-center rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] p-1 border border-[#E4E4E7] dark:border-[#20252D] shrink-0 self-start sm:self-auto"
            >
              <button
                type="button"
                data-testid="lang-option-id"
                onClick={() => {
                  setLanguage('id');
                  showFeedback('Bahasa aplikasi diubah ke Bahasa Indonesia.');
                }}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  language === 'id'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                Indonesia
              </button>
              <button
                type="button"
                data-testid="lang-option-en"
                onClick={() => {
                  setLanguage('en');
                  showFeedback('Application language changed to English.');
                }}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  language === 'en'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                English
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 1B. SUARA & UMPAN BALIK SENTUHAN                                      */}
      {/* ===================================================================== */}
      <section id="settings-sound" className="space-y-2">
        <span className={sectionLabelClass}>
          {tr('Suara & Umpan Balik Sentuhan', 'Sound & Touch Feedback')}
        </span>
        <div className={cardClass}>
          {/* Suara Klik & Sentuhan UI */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              {uiClickEnabled ? (
                <Volume2 className={`${iconClass} mt-0.5`} />
              ) : (
                <VolumeX className={`${iconClass} mt-0.5`} />
              )}
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Suara Klik & Sentuhan UI', 'UI Click & Touch Sounds')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Efek suara taktil halus saat mengetuk tombol, tab, dan menu',
                    'Subtle tactile sound feedback when tapping buttons, tabs, and menus'
                  )}
                </span>
              </div>
            </div>

            <div className="inline-flex items-center rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] p-1 border border-[#E4E4E7] dark:border-[#20252D] shrink-0 self-start sm:self-auto">
              <button
                type="button"
                data-sound="none"
                onClick={() => {
                  updateSoundPreferences({ uiClickEnabled: true });
                  playUiClick(false);
                }}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  uiClickEnabled
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                {tr('Aktif', 'On')}
              </button>
              <button
                type="button"
                data-sound="none"
                onClick={() => updateSoundPreferences({ uiClickEnabled: false })}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  !uiClickEnabled
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                {tr('Mati', 'Off')}
              </button>
            </div>
          </div>

          {/* Suara Notifikasi & Alert */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <BellRing className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Suara Notifikasi & Alert', 'Notification & Alert Chimes')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Chime saat simpan transaksi, error validasi, dan berita high-impact',
                    'Chime on trade saved, validation alerts, and high-impact news'
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <button
                type="button"
                data-sound="none"
                onClick={() => playNotificationPing(true)}
                className="px-3 py-1 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                {tr('Tes', 'Test')}
              </button>
              <div className="inline-flex items-center rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] p-1 border border-[#E4E4E7] dark:border-[#20252D]">
                <button
                  type="button"
                  data-sound="none"
                  onClick={() => {
                    updateSoundPreferences({ notificationSoundEnabled: true });
                    playNotificationPing(true);
                  }}
                  className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    notificationSoundEnabled
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                  }`}
                >
                  {tr('Aktif', 'On')}
                </button>
                <button
                  type="button"
                  data-sound="none"
                  onClick={() => updateSoundPreferences({ notificationSoundEnabled: false })}
                  className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    !notificationSoundEnabled
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                  }`}
                >
                  {tr('Mati', 'Off')}
                </button>
              </div>
            </div>
          </div>

          {/* Umpan Balik Getar (Haptic) */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Smartphone className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Getar Sentuhan (Haptic)', 'Haptic Touch Feedback')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Getaran mikro saat sentuhan dan notifikasi pada perangkat seluler',
                    'Micro vibration on touch interactions and alerts on mobile devices'
                  )}
                </span>
              </div>
            </div>

            <div className="inline-flex items-center rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] p-1 border border-[#E4E4E7] dark:border-[#20252D] shrink-0 self-start sm:self-auto">
              <button
                type="button"
                data-sound="none"
                onClick={() => {
                  updateSoundPreferences({ hapticEnabled: true });
                  triggerHaptic(12);
                }}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  hapticEnabled
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                {tr('Aktif', 'On')}
              </button>
              <button
                type="button"
                data-sound="none"
                onClick={() => updateSoundPreferences({ hapticEnabled: false })}
                className={`px-3.5 py-1 text-xs rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                  !hapticEnabled
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] font-semibold'
                    : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium'
                }`}
              >
                {tr('Mati', 'Off')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 2. PARAMETER TRADING & MODAL                                          */}
      {/* ===================================================================== */}
      <section className="space-y-2">
        <span className={sectionLabelClass}>
          {tr('Parameter Trading & Modal', 'Trading & Capital Parameters')}
        </span>
        <div className={cardClass}>
          {/* Saldo Awal & Sinkronisasi MT5 */}
          <button
            type="button"
            onClick={() => setActivePrefModal('balance')}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Wallet className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Modal Awal & Saldo MT5', 'Initial Capital & MT5 Balance')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Atur saldo awal manual atau selaraskan otomatis dengan saldo MT5',
                    'Set starting balance manually or auto-align with current MT5 balance'
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right">
                <span className="text-xs font-bold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] block">
                  {formatCurrency(scopedSettings.startingBalance, scopedSettings)}
                </span>
                <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr('Ekuitas:', 'Equity:')}{' '}
                  {formatCurrency(capitalBreakdown.currentBalance, scopedSettings)}
                </span>
              </div>
              <ChevronRight className={chevronClass} />
            </div>
          </button>

          {/* Mata Uang */}
          <button
            type="button"
            onClick={() => setActivePrefModal('currency')}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Coins className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Mata Uang Jurnal', 'Journal Currency')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr('Satuan moneter utama laporan dan pencatatan', 'Primary monetary unit for reports and entries')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {settings.currency} ({settings.currencySymbol})
              </span>
              <ChevronRight className={chevronClass} />
            </div>
          </button>

          {/* Spesifikasi Broker XAUUSD */}
          <button
            type="button"
            onClick={() => setActivePrefModal('broker')}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <SlidersHorizontal className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Spesifikasi Broker (XAUUSD)', 'Broker Specification (XAUUSD)')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5 break-words">
                  {settings.xauusdPipSize === 1.0
                    ? tr('Mode B (1 Pip = $1.00)', 'Mode B (1 Pip = $1.00)')
                    : tr('Mode A (1 Pip = $0.10)', 'Mode A (1 Pip = $0.10)')}{' '}
                  · {settings.xauusdContractSize} oz · {tr('Komisi', 'Comm.')} ${settings.brokerCommissionPerLot}/lot
                </span>
              </div>
            </div>
            <ChevronRight className={chevronClass} />
          </button>

          {/* Parameter Risiko & Target */}
          <button
            type="button"
            onClick={() => setActivePrefModal('risk')}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <ShieldCheck className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Parameter Risiko & Target', 'Risk & Target Parameters')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5 break-words">
                  {tr('Risiko', 'Risk')}{' '}
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {settings.defaultRiskPercent}%
                  </span>{' '}
                  ({settings.riskCapitalBasis === 'BALANCE' ? tr('Saldo Awal', 'Initial Balance') : tr('Ekuitas', 'Equity')}) ·{' '}
                  {tr('Target', 'Target')}{' '}
                  <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {settings.targetMonthlyReturnPercent}%
                  </span>
                  /{tr('bln', 'mo')}
                </span>
              </div>
            </div>
            <ChevronRight className={chevronClass} />
          </button>

          {/* Penyesuaian Modal */}
          <button
            type="button"
            onClick={() => setActivePrefModal('adjustments')}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <ArrowLeftRight className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Penyesuaian Modal (Deposit & WD)', 'Capital Adjustments (Deposit & WD)')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5 break-words">
                  <span className="font-mono-numbers tabular-nums text-[#059669] dark:text-[#00A878]">
                    +{formatCurrency(settings.totalDeposits ?? 0, settings)}
                  </span>{' '}
                  ·{' '}
                  <span className="font-mono-numbers tabular-nums text-[#E11D48] dark:text-[#E05260]">
                    -{formatCurrency(settings.totalWithdrawals ?? 0, settings)}
                  </span>
                </span>
              </div>
            </div>
            <ChevronRight className={chevronClass} />
          </button>

          {/* Multi-Akun & Sub-Portofolio */}
          {onOpenAccountSwitcher && (
            <button
              type="button"
              onClick={onOpenAccountSwitcher}
              className={rowInteractiveClass}
            >
              <div className="flex items-start gap-3 min-w-0">
                <Layers className={`${iconClass} mt-0.5`} />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                    {tr('Multi-Akun & Sub-Portofolio', 'Multi-Account & Sub-Portfolios')}
                  </span>
                  <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                    {tr(
                      'Pisahkan akun Live, Prop Firm, Demo, atau Cent dalam satu jurnal',
                      'Separate Live, Prop Firm, Demo, or Cent accounts in one journal'
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                  {effectiveAccounts.length}
                </span>
                <ChevronRight className={chevronClass} />
              </div>
            </button>
          )}

          {/* Playbook Setup A+ */}
          {onOpenPlaybook && (
            <button
              type="button"
              onClick={onOpenPlaybook}
              className={rowInteractiveClass}
            >
              <div className="flex items-start gap-3 min-w-0">
                <BookOpen className={`${iconClass} mt-0.5`} />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                    {tr('Playbook Setup A+', 'A+ Setup Playbook Library')}
                  </span>
                  <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                    {tr(
                      'Kelola kriteria entry & invalidasi setup unggulan Anda',
                      'Manage entry criteria and invalidation rules for your best setups'
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                  {effectivePlaybooks.length}
                </span>
                <ChevronRight className={chevronClass} />
              </div>
            </button>
          )}

          {/* Checklist SOP Pra-Eksekusi */}
          <div className="px-4 py-3.5 space-y-2.5">
            <button
              type="button"
              onClick={() => setIsChecklistEditorOpen((prev) => !prev)}
              className="w-full flex items-center justify-between gap-4 text-left cursor-pointer group"
            >
              <div className="flex items-start gap-3 min-w-0">
                <ClipboardCheck className={`${iconClass} mt-0.5`} />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                    {tr('Checklist SOP Pra-Eksekusi', 'Pre-Trade SOP Checklist')}
                  </span>
                  <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                    {tr(
                      'Daftar verifikasi disiplin yang tampil di formulir tambah transaksi',
                      'Discipline checklist displayed inside the Add Trade form'
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                  {effectiveChecklist.filter((i) => i.enabled).length}/{effectiveChecklist.length}
                </span>
                <ChevronRight
                  className={`${chevronClass} transition-transform duration-150 ${
                    isChecklistEditorOpen ? 'rotate-90' : ''
                  }`}
                />
              </div>
            </button>

            {isChecklistEditorOpen && (
              <div className="ml-7 pt-2 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-2">
                {effectiveChecklist.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 py-1 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleChecklistEnabled(item.id)}
                      className="flex items-center gap-2 text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <span
                        className={`h-4 w-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          item.enabled
                            ? 'bg-[#0F172A] border-[#0F172A] text-white dark:bg-white dark:border-white dark:text-[#050607]'
                            : 'border-[#CBD5E1] dark:border-[#323A46]'
                        }`}
                      >
                        {item.enabled && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                      </span>
                      <span
                        className={`truncate ${
                          item.enabled
                            ? 'text-[#0F172A] dark:text-[#F2F4F7] font-medium'
                            : 'text-[#94A3B8] dark:text-[#64748B] line-through'
                        }`}
                      >
                        {tr(item.labelId, item.labelEn)}
                      </span>
                    </button>
                    {effectiveChecklist.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteChecklistItem(item.id)}
                        className="p-1 text-[#94A3B8] hover:text-[#E11D48] dark:hover:text-[#E05260] cursor-pointer"
                        aria-label={tr('Hapus item', 'Delete item')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newChecklistLabel}
                    onChange={(e) => setNewChecklistLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklistItem();
                      }
                    }}
                    placeholder={tr('Tambah aturan SOP baru...', 'Add new SOP rule...')}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#929BA9] focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddChecklistItem}
                    disabled={!newChecklistLabel.trim()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#0F172A] text-white dark:bg-white dark:text-[#050607] text-[11px] font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>{tr('Tambah', 'Add')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 3. KONEKSI & MODE DATA (PLUS PENGATURAN DEVELOPER BILA AKTIF)         */}
      {/* ===================================================================== */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className={sectionLabelClass}>
            {isDeveloperMode
              ? tr('Koneksi, Cloud & Backend (Developer)', 'Connection, Cloud & Backend (Developer)')
              : tr('Koneksi & Mode Data', 'Connection & Data Mode')}
          </span>
          {isDeveloperMode && onLockDeveloperMode && (
            <button
              type="button"
              onClick={handleHideDeveloperMode}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[10px] font-semibold text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer"
            >
              <EyeOff className="h-3 w-3" />
              <span>{tr('Sembunyikan (Hide)', 'Hide Dev')}</span>
            </button>
          )}
        </div>
        <div className={cardClass}>
          {isDeveloperMode && (
            <>
              {/* Konfigurasi Supabase (Developer Only) */}
              <button
                type="button"
                onClick={onOpenConfig}
                className={rowInteractiveClass}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <Cloud className={`${iconClass} mt-0.5`} />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                      {tr('Konfigurasi Cloud Supabase', 'Supabase Cloud Configuration')}
                    </span>
                    <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                      {tr(
                        'Atur Project URL & Anon Key untuk server VLO Cloud',
                        'Configure Project URL & Anon Key for VLO Cloud server'
                      )}
                    </span>
                  </div>
                </div>
                <ChevronRight className={chevronClass} />
              </button>

              {/* Server Backend Mandiri (Developer Only) */}
              <div className="px-4 py-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <Server className={`${iconClass} mt-0.5`} />
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                        {tr('Server Backend & AI Proxy', 'Backend Server & AI Proxy')}
                      </span>
                      <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5 break-all">
                        {backendInfo.source === 'supabase-edge'
                          ? `${tr('Otomatis Supabase Edge:', 'Auto Supabase Edge:')} ${backendInfo.url}`
                          : backendInfo.url
                          ? backendInfo.url
                          : tr(
                              'Belum diatur — gunakan Supabase Edge otomatis atau URL server kustom.',
                              'Not configured — uses auto Supabase Edge or custom server URL.'
                            )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isTestingBackend}
                      onClick={() => handleTestBackend(isEditingBackend ? backendUrlInput : backendInfo.url)}
                      className="px-3 py-1 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-medium text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      {isTestingBackend ? tr('Menguji...', 'Testing...') : tr('Tes', 'Test')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const fresh = getBackendSourceInfo();
                        setBackendInfo(fresh);
                        setIsEditingBackend((prev) => !prev);
                        setBackendUrlInput(fresh.url);
                      }}
                      className="px-3 py-1 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#1F2530] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      {isEditingBackend ? tr('Tutup', 'Close') : tr('Atur', 'Configure')}
                    </button>
                  </div>
                </div>

                {backendHealth && (
                  <div className="ml-7 px-3 py-2 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] leading-relaxed text-editorial-justify">
                    <span
                      className={
                        backendHealth.reachable && backendHealth.geminiConfigured
                          ? 'text-[#059669] dark:text-[#00A878] font-medium'
                          : backendHealth.reachable
                          ? 'text-[#D97706] dark:text-[#F59E0B] font-medium'
                          : 'text-[#E11D48] dark:text-[#E05260] font-medium'
                      }
                    >
                      {language === 'id' ? backendHealth.messageId : backendHealth.messageEn}
                    </span>
                  </div>
                )}

                {isEditingBackend && (
                  <div className="ml-7 pt-1 space-y-2">
                    <input
                      type="url"
                      value={backendUrlInput}
                      onChange={(e) => setBackendUrlInput(e.target.value)}
                      placeholder="https://xxxx.supabase.co/functions/v1/tradevault-api"
                      className="w-full px-3 py-2 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#929BA9] focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isTestingBackend}
                        onClick={() => handleSaveBackendUrl(true)}
                        className="px-3.5 py-1.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                      >
                        {tr('Simpan & Tes', 'Save & Test')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveBackendUrl(false)}
                        className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                      >
                        {tr('Simpan', 'Save')}
                      </button>
                      {backendInfo.source === 'custom' && (
                        <button
                          type="button"
                          onClick={handleResetBackendUrl}
                          className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                        >
                          {tr('Reset Otomatis', 'Reset to Auto')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Mode Offline News & Cycle */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              {isNewsCycleOffline ? (
                <WifiOff className={`${iconClass} mt-0.5`} />
              ) : (
                <Wifi className={`${iconClass} mt-0.5`} />
              )}
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Mode Offline (News & Cycle)', 'Offline Mode (News & Cycle)')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5 leading-relaxed text-editorial-justify">
                  {tr(
                    'Hemat kuota API dengan menjeda pembaruan otomatis berita & cycle. Scan Kilat AI tetap aktif.',
                    'Save API quota by pausing live news & cycle updates. Instant AI Scan stays active.'
                  )}
                </span>
              </div>
            </div>
            <div className="shrink-0 self-start sm:self-center">
              <button
                type="button"
                data-testid="settings-offline-mode-toggle"
                onClick={handleToggleNewsCycleOffline}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                <span
                  className={
                    isNewsCycleOffline
                      ? 'text-[#D97706] dark:text-[#F59E0B]'
                      : 'text-[#059669] dark:text-[#00A878]'
                  }
                >
                  {isNewsCycleOffline ? tr('Aktif (Offline)', 'Active (Offline)') : tr('Online', 'Online')}
                </span>
              </button>
            </div>
          </div>

          {/* Instal Aplikasi PWA (Offline-First) */}
          <PWAInstallButton variant="settings-row" />
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 4. DATA, PENYIMPANAN & CADANGAN                                       */}
      {/* ===================================================================== */}
      <section className="space-y-2">
        <span className={sectionLabelClass}>
          {tr('Data, Penyimpanan & Cadangan', 'Data, Storage & Backups')}
        </span>
        <div className={cardClass}>
          {/* Penyimpanan Lokal Browser */}
          <button
            type="button"
            onClick={onOpenLocalInfo}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Database className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Penyimpanan Lokal Perangkat', 'Device Local Storage')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Ringkasan kapasitas & status cache transaksi di browser/aplikasi',
                    'Storage capacity summary & transaction cache status on this device'
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7]">
                {trades.length}
              </span>
              <ChevronRight className={chevronClass} />
            </div>
          </button>

          {/* Cadangan & Pemulihan (ZIP / JSON / CSV) */}
          <button
            type="button"
            onClick={onOpenBackupModal}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <HardDriveDownload className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Cadangan & Pemulihan Data', 'Backup & Restore Data')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Ekspor atau pulihkan jurnal dan screenshot dalam format ZIP, JSON, atau CSV',
                    'Export or restore journal trades and screenshots in ZIP, JSON, or CSV format'
                  )}
                </span>
              </div>
            </div>
            <ChevronRight className={chevronClass} />
          </button>

          {/* Impor CSV Spreadsheet */}
          <button
            type="button"
            onClick={() => setIsCsvModalOpen(true)}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <FileSpreadsheet className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Impor Spreadsheet (CSV / Excel)', 'Import Spreadsheet (CSV / Excel)')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Unggah riwayat transaksi broker dari tabel CSV',
                    'Upload broker trade history from CSV spreadsheet'
                  )}
                </span>
              </div>
            </div>
            <ChevronRight className={chevronClass} />
          </button>

          {/* Dataset Contoh DEMO */}
          <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Layers className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Dataset Transaksi Demo', 'Demo Trades Dataset')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5 font-mono-numbers tabular-nums">
                  {tr(
                    `${demoCount} transaksi contoh · ${realCount} transaksi asli`,
                    `${demoCount} sample trades · ${realCount} real trades`
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleLoadDemo}
                className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                {tr('Muat Demo', 'Load Demo')}
              </button>
              {demoCount > 0 && (
                <button
                  type="button"
                  onClick={onRequestClearDemo}
                  className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[#D97706] dark:text-[#F59E0B] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {tr(`Hapus Demo (${demoCount})`, `Clear Demo (${demoCount})`)}
                </button>
              )}
            </div>
          </div>

          {/* Audit Rumus Finansial */}
          <button
            type="button"
            onClick={() => setIsAuditModalOpen(true)}
            className={rowInteractiveClass}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Calculator className={`${iconClass} mt-0.5`} />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Audit Rumus Finansial', 'Financial Formula Audit')}
                </span>
                <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                  {tr(
                    'Verifikasi 46 kalkulasi Win Rate, Profit Factor, Expectancy, Drawdown, dan Lot',
                    'Verify 46 Win Rate, Profit Factor, Expectancy, Drawdown, and Lot calculations'
                  )}
                </span>
              </div>
            </div>
            <ChevronRight className={chevronClass} />
          </button>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 5. ZONA SENSITIF                                                      */}
      {/* ===================================================================== */}
      <section className="space-y-2">
        <span className={sectionLabelClass}>
          {tr('Zona Sensitif', 'Danger Zone')}
        </span>
        <div className="bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Trash2 className="h-4 w-4 shrink-0 text-[#E11D48] dark:text-[#E05260] stroke-[1.75] mt-0.5" />
            <div className="min-w-0">
              <span className="text-xs font-semibold text-[#E11D48] dark:text-[#E05260] block">
                {tr('Reset Total Jurnal', 'Full Journal Reset')}
              </span>
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block mt-0.5">
                {tr(
                  'Hapus permanen seluruh transaksi untuk memulai jurnal baru dari nol.',
                  'Permanently delete all trades to start a fresh journal from scratch.'
                )}
              </span>
            </div>
          </div>

          <div className="shrink-0 self-start sm:self-auto">
            {!isConfirmingClearAll ? (
              <button
                type="button"
                disabled={isCloudSyncing || trades.length === 0}
                onClick={() => setIsConfirmingClearAll(true)}
                className="px-4 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] dark:hover:text-[#E05260] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                {tr('Reset Semua', 'Reset All')}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isCloudSyncing}
                  onClick={() => setIsConfirmingClearAll(false)}
                  className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] text-xs font-medium hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="button"
                  disabled={isCloudSyncing}
                  onClick={handleConfirmClearAllTrades}
                  className="px-4 py-1.5 rounded-full bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]/50"
                >
                  {tr('Ya, Hapus Semua', 'Yes, Delete All')}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Minimalist App Version & Build Identity Footer (7-tap + Secret Code unlocks Developer Mode) */}
      <div className="pt-2 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[#526071] dark:text-[#929BA9]">
          <div className="inline-flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setShowVersionHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer"
            >
              <span>{tr('Vlo Journal', 'Vlo Journal')}</span>
              <span className="text-[#929BA9] dark:text-[#64748B]">·</span>
              <span className="underline underline-offset-2 decoration-[#E4E4E7] dark:decoration-[#20252D]">
                {showVersionHistory
                  ? tr('Tutup Riwayat Versi', 'Hide Version Log')
                  : tr('Riwayat Perubahan', 'Changelog')}
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={handleVersionBadgeTap}
            className="font-mono-numbers tabular-nums hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-default select-none"
            title={`${tr('Versi', 'Version')} v${APP_VERSION} · ${BUILD_GIT_SHA} (${APP_RELEASE_DATE})`}
          >
            v{APP_VERSION} · {BUILD_GIT_SHA}
          </button>
        </div>

        {isDeveloperMode && (
          <div className="rounded-2xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] p-4 space-y-3 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-[#0F172A] dark:text-[#F2F4F7]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                  {tr('Konsol Developer, Cleaning Service & AI QA', 'Developer Console, Cleaning Service & AI QA')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={isProbingOcr}
                  onClick={() => void handleRunOcrRuntimeProbe()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[10px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`h-2.5 w-2.5 ${isProbingOcr ? 'animate-spin' : ''}`} />
                  <span>{isProbingOcr ? tr('Menguji...', 'Probing...') : tr('Uji Lengkap APK', 'Probe All')}</span>
                </button>
                <button
                  type="button"
                  disabled={isCleaningRunning}
                  onClick={() => void handleRunCleaningService()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[10px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] cursor-pointer disabled:opacity-50"
                >
                  <Wrench className={`h-2.5 w-2.5 ${isCleaningRunning ? 'animate-spin' : ''}`} />
                  <span>
                    {isCleaningRunning
                      ? tr('Membersihkan...', 'Cleaning...')
                      : tr('Cleaning Service', 'Cleaning Service')}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isRunningAiQa}
                  onClick={() => void handleRunAiQaDiagnosis()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-semibold hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className={`h-2.5 w-2.5 ${isRunningAiQa ? 'animate-pulse' : ''}`} />
                  <span>
                    {isRunningAiQa
                      ? tr('Menganalisa...', 'Analyzing...')
                      : tr('Analisa AI QA', 'AI QA Diagnose')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyFullOcrDiagnostics()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[10px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] cursor-pointer"
                >
                  {copiedOcrReport ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                  <span>{copiedOcrReport ? tr('Disalin', 'Copied') : 'Copy JSON'}</span>
                </button>
                {onLockDeveloperMode && (
                  <button
                    type="button"
                    onClick={handleHideDeveloperMode}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#E11D48]/30 text-[10px] font-semibold text-[#E11D48] dark:text-[#FB7185] hover:bg-[#FFF1F2] dark:hover:bg-[#2A1215] cursor-pointer"
                  >
                    <EyeOff className="h-2.5 w-2.5" />
                    <span>{tr('Sembunyikan', 'Hide')}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Cleaning Service Result Banner */}
            {cleaningReport && (
              <div className="p-3 rounded-xl bg-[#ECFDF5] dark:bg-[#052E16]/40 border border-[#A7F3D0] dark:border-[#065F46] text-[11px] text-[#065F46] dark:text-[#A7F3D0] flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold">
                    {tr('Cleaning Service (Auto-Repair Aman)', 'Cleaning Service (Safe Auto-Repair)')}
                  </div>
                  <p className="leading-relaxed">
                    {tr(cleaningReport.summaryId, cleaningReport.summaryEn)}
                  </p>
                </div>
              </div>
            )}

            {/* AI QA Diagnosis Result Card */}
            {aiQaError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#2A1215] border border-[#FECACA] dark:border-[#7F1D1D] text-[11px] text-[#DC2626] dark:text-[#FCA5A5]">
                {aiQaError}
              </div>
            )}
            {aiQaResult && (
              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#0F172A] dark:text-[#F2F4F7]" />
                    <span className="text-[11px] font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                      {tr('Laporan Analis AI QA', 'AI QA Analyst Report')}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      aiQaResult.healthGrade === 'HEALTHY'
                        ? 'bg-[#DCFCE7] text-[#166534] dark:bg-[#052E16] dark:text-[#86EFAC]'
                        : aiQaResult.healthGrade === 'WARNING'
                        ? 'bg-[#FEF3C7] text-[#92400E] dark:bg-[#451A03] dark:text-[#FDE68A]'
                        : 'bg-[#FEE2E2] text-[#991B1B] dark:bg-[#450A0A] dark:text-[#FCA5A5]'
                    }`}
                  >
                    {aiQaResult.healthGrade} · {aiQaResult.provider} ({aiQaResult.latencyMs}ms)
                  </span>
                </div>
                <p className="text-[11.5px] text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed">
                  {aiQaResult.summary}
                </p>
                {aiQaResult.rootCauses.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                      {tr('Temuan / Akar Masalah', 'Findings / Root Causes')}
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-[#526071] dark:text-[#CBD5E1]">
                      {aiQaResult.rootCauses.map((rc, i) => (
                        <li key={i}>{rc}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiQaResult.recommendedActions.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                      {tr('Langkah Perbaikan Disarankan', 'Recommended Fixes')}
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-[#0F172A] dark:text-[#F2F4F7]">
                      {aiQaResult.recommendedActions.map((act, i) => (
                        <li key={i}>{act}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Deterministic Build Identity */}
            <div className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] font-mono text-[10px] grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[#526071] dark:text-[#929BA9] select-text">
              <div>
                <span className="text-[#94A3B8]">App Version: </span>
                <span className="text-[#0F172A] dark:text-[#F2F4F7] font-semibold">
                  v{appBuildIdentity.appVersion} ({appBuildIdentity.changeCode})
                </span>
              </div>
              <div>
                <span className="text-[#94A3B8]">Git Commit: </span>
                <span className="text-[#0F172A] dark:text-[#F2F4F7] font-semibold">
                  {appBuildIdentity.gitCommitSha} · run #{appBuildIdentity.ciRunNumber}
                </span>
              </div>
              <div className="sm:col-span-2 break-all">
                <span className="text-[#94A3B8]">Build Timestamp: </span>
                <span className="text-[#0F172A] dark:text-[#F2F4F7]">{appBuildIdentity.buildTimestamp}</span>
              </div>
              <div>
                <span className="text-[#94A3B8]">OCR Engine: </span>
                <span className="text-[#0F172A] dark:text-[#F2F4F7]">
                  {appBuildIdentity.ocrEngine} {appBuildIdentity.ocrEngineVersion}
                </span>
              </div>
              <div>
                <span className="text-[#94A3B8]">OCR Pipeline: </span>
                <span className="text-[#0F172A] dark:text-[#F2F4F7]">{appBuildIdentity.ocrPipelineVersion}</span>
              </div>
            </div>

            {/* Live Runtime & Bundled OCR Assets Probe */}
            {ocrRuntimeProbe && (
              <div className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] font-mono text-[10px] space-y-2 select-text">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[#526071] dark:text-[#929BA9]">
                  <div>
                    <span className="text-[#94A3B8]">Runtime: </span>
                    <span className="text-[#0F172A] dark:text-[#F2F4F7]">
                      {ocrRuntimeProbe.isNativeCapacitor
                        ? `Capacitor (${ocrRuntimeProbe.capacitorPlatform})`
                        : `Web (${ocrRuntimeProbe.capacitorPlatform})`}
                    </span>
                  </div>
                  <div className="break-all">
                    <span className="text-[#94A3B8]">Origin: </span>
                    <span className="text-[#0F172A] dark:text-[#F2F4F7]">{ocrRuntimeProbe.origin}</span>
                  </div>
                  <div>
                    <span className="text-[#94A3B8]">Service Workers: </span>
                    <span className="text-[#0F172A] dark:text-[#F2F4F7]">
                      {ocrRuntimeProbe.serviceWorkerCount} (ctrl:{ocrRuntimeProbe.hasServiceWorkerController ? 'YES' : 'no'})
                    </span>
                  </div>
                  <div className="break-all">
                    <span className="text-[#94A3B8]">CacheStorage: </span>
                    <span className="text-[#0F172A] dark:text-[#F2F4F7]">
                      {ocrRuntimeProbe.cacheBucketNames.length > 0
                        ? ocrRuntimeProbe.cacheBucketNames.join(', ')
                        : '(empty)'}
                    </span>
                  </div>
                </div>
                <div className="space-y-1 pt-1.5 border-t border-[#E4E4E7] dark:border-[#20252D]">
                  <div className="text-[#94A3B8] uppercase">Bundled Offline OCR Assets</div>
                  {ocrRuntimeProbe.assetChecks.map((a) => (
                    <div key={a.name} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate text-[#0F172A] dark:text-[#F2F4F7]">{a.name}</span>
                      <span
                        className={`shrink-0 ${
                          a.ok
                            ? 'text-[#059669] dark:text-[#34D399]'
                            : 'text-[#E11D48] dark:text-[#E05260]'
                        }`}
                      >
                        {a.ok
                          ? `OK (${a.status}) · ${a.bytes !== null ? `${(a.bytes / 1024).toFixed(0)} KB` : '?'}`
                          : `FAIL (${a.status}${a.error ? `: ${a.error}` : ''})`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full APK Live Feeds, AI Backend & 3-Feature Macro Sync Audit */}
            {apkSystemProbe && (
              <div className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] font-mono text-[10px] space-y-2 select-text">
                <div className="text-[#94A3B8] uppercase">
                  {tr('Status Subsistem APK, AI & Sinkronisasi', 'APK Subsystems, AI & Sync Status')}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#526071] dark:text-[#929BA9]">Native APK / Cache Purge</span>
                    <span
                      className={
                        apkSystemProbe.cachePurgeMatchesBuild
                          ? 'text-[#059669] dark:text-[#34D399]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }
                    >
                      {apkSystemProbe.nativeApp.available
                        ? `v${apkSystemProbe.nativeApp.versionName} (code ${apkSystemProbe.nativeApp.versionCode}) · WebViewPurged:${
                            apkSystemProbe.nativeApp.webViewCacheClearedOnBoot ? 'YES' : 'cached-ok'
                          }`
                        : `Web · SW-Code:${apkSystemProbe.swPurgedChangeCode || 'none'}`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#526071] dark:text-[#929BA9]">AI Backend & Proxy</span>
                    <span
                      className={
                        apkSystemProbe.backend.status === 'ok'
                          ? 'text-[#059669] dark:text-[#34D399]'
                          : apkSystemProbe.backend.status === 'degraded' ||
                            apkSystemProbe.backend.status === 'offline_skipped'
                          ? 'text-[#B45309] dark:text-[#FBBF24]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }
                    >
                      {apkSystemProbe.backend.status === 'offline_skipped'
                        ? 'SKIP (Offline Mode)'
                        : `${apkSystemProbe.backend.status.toUpperCase()} · ScanAI:${
                            apkSystemProbe.backend.scannerGeminiConfigured ? 'ON' : 'OFF'
                          } · NewsAI:${
                            apkSystemProbe.backend.newsGeminiConfigured ? 'ON' : 'OFF'
                          } · ${apkSystemProbe.backend.latencyMs}ms`}
                    </span>
                  </div>
                  {apkSystemProbe.backend.note && (
                    <div className="text-[9.5px] text-[#64748B] dark:text-[#929BA9] pl-2 border-l border-[#E4E4E7] dark:border-[#20252D]">
                      {apkSystemProbe.backend.note}
                      {` · MultiAgent[Desk:${apkSystemProbe.backend.agentDeskReady ? 'ON' : 'OFF'}, Groq:${
                        apkSystemProbe.backend.groqConfigured ? 'ON' : 'OFF'
                      }, OR:${apkSystemProbe.backend.openRouterConfigured ? 'ON' : 'OFF'}]`}
                      {apkSystemProbe.backend.proxyCapabilities
                        ? ` · Proxy[Poly:${apkSystemProbe.backend.proxyCapabilities.polymarket ? 'OK' : 'NO'}, CFTC:${
                            apkSystemProbe.backend.proxyCapabilities.cftc ? 'OK' : 'NO'
                          }, TD:${apkSystemProbe.backend.proxyCapabilities.twelvedata ? 'OK' : 'NO'}, BIN:${
                            apkSystemProbe.backend.proxyCapabilities.binance ? 'OK' : 'NO'
                          }]`
                        : ''}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#526071] dark:text-[#929BA9]">Vela Chart Feed (XAU H1)</span>
                    <span
                      className={
                        apkSystemProbe.velaChartFeed.status === 'ok'
                          ? 'text-[#059669] dark:text-[#34D399]'
                          : apkSystemProbe.velaChartFeed.status === 'cache' ||
                            apkSystemProbe.velaChartFeed.status === 'offline_skipped'
                          ? 'text-[#B45309] dark:text-[#FBBF24]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }
                    >
                      {apkSystemProbe.velaChartFeed.source.toUpperCase()} · {apkSystemProbe.velaChartFeed.count} bars ·{' '}
                      {apkSystemProbe.velaChartFeed.latencyMs}ms
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#526071] dark:text-[#929BA9]">Polymarket Macro Feed</span>
                    <span
                      className={
                        apkSystemProbe.polymarketFeed.status === 'ok'
                          ? 'text-[#059669] dark:text-[#34D399]'
                          : apkSystemProbe.polymarketFeed.status === 'cache' ||
                            apkSystemProbe.polymarketFeed.status === 'offline_skipped'
                          ? 'text-[#B45309] dark:text-[#FBBF24]'
                          : 'text-[#E11D48] dark:text-[#E05260]'
                      }
                    >
                      {apkSystemProbe.polymarketFeed.source} · {apkSystemProbe.polymarketFeed.count} events ·{' '}
                      {apkSystemProbe.polymarketFeed.latencyMs}ms
                    </span>
                  </div>

                  <div className="pt-1.5 border-t border-[#E4E4E7] dark:border-[#20252D] space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#526071] dark:text-[#929BA9]">Sync Makro · Fundamental · Cycle</span>
                      <span
                        className={
                          apkSystemProbe.macroSync.status === 'aligned'
                            ? 'text-[#059669] dark:text-[#34D399]'
                            : apkSystemProbe.macroSync.status === 'drift'
                            ? 'text-[#E11D48] dark:text-[#E05260]'
                            : 'text-[#526071] dark:text-[#929BA9]'
                        }
                      >
                        {apkSystemProbe.macroSync.status.toUpperCase()} (News:{apkSystemProbe.macroSync.macroBias} / Fund:
                        {apkSystemProbe.macroSync.fundamentalBias})
                      </span>
                    </div>
                    <div className="text-[9.5px] text-[#64748B] dark:text-[#929BA9]">
                      {tr(apkSystemProbe.macroSync.noteId, apkSystemProbe.macroSync.noteEn)}
                    </div>
                    <div className="text-[9.5px] text-[#64748B] dark:text-[#929BA9]">
                      Offline Caches: Actuals({apkSystemProbe.macroSync.offlineActualsCount}) · Candles(
                      {apkSystemProbe.macroSync.localCandleBuckets}) · Polymarket(
                      {apkSystemProbe.macroSync.polymarketCachedCount}) · FedWatch(
                      {apkSystemProbe.macroSync.fedWatchDominant || 'none'})
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Recorded Offline OCR Scans */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                  {tr('Riwayat Scan OCR Sesi Ini', 'Session OCR Scan Telemetry')} ({ocrScanHistory.length})
                </span>
                {ocrScanHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      clearMt5OcrScanDiagnostics();
                      setOcrScanHistory([]);
                    }}
                    className="text-[10px] text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] cursor-pointer"
                  >
                    {tr('Bersihkan', 'Clear')}
                  </button>
                )}
              </div>
              {ocrScanHistory.length === 0 ? (
                <p className="text-[11px] text-[#697586] dark:text-[#929BA9]">
                  {tr(
                    'Belum ada scan offline di sesi ini. Lakukan scan MT5 mode Offline lalu buka panel ini untuk memeriksa hasil mentah.',
                    'No offline scans recorded in this session yet. Run an Offline MT5 scan then open this panel to inspect raw telemetry.'
                  )}
                </p>
              ) : (
                <div className="space-y-2">
                  {ocrScanHistory.slice(0, 3).map((rec) => (
                    <div
                      key={rec.id}
                      className="p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] font-mono text-[10px] space-y-1 select-text"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[#0F172A] dark:text-[#F2F4F7]">
                        <span className="font-semibold">
                          {rec.resolvedEngine} · {rec.parserOutputSummary.length} trades · {rec.totalDurationMs}ms
                        </span>
                        <span className="text-[#526071] dark:text-[#929BA9]">
                          conf {rec.finalConfidence}% · {rec.finalWordBoxCount} words
                        </span>
                      </div>
                      <div className="text-[#526071] dark:text-[#929BA9]">
                        input:{' '}
                        {rec.inputDimensions
                          ? `${rec.inputDimensions.width}x${rec.inputDimensions.height}`
                          : 'n/a'}{' '}
                        · passes: {rec.passes.length} · fallback: {rec.invokedFallback ? 'YES' : 'no'}
                      </div>
                      {rec.validationFailures.length > 0 && (
                        <div className="text-[#E11D48] dark:text-[#E05260]">
                          validation issues: {rec.validationFailures.length}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Silent App Error Recorder */}
            <div className="space-y-1.5 pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#526071] dark:text-[#929BA9]">
                  <ShieldAlert className="h-3 w-3" />
                  {tr('Perekam Error Terbaru', 'Recorded Runtime & API Errors')} ({recentErrorLogs.length})
                </span>
                {recentErrorLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      clearAppDiagnosticEvents();
                      setRecentErrorLogs([]);
                    }}
                    className="text-[10px] text-[#526071] dark:text-[#929BA9] hover:text-[#E11D48] cursor-pointer"
                  >
                    {tr('Bersihkan', 'Clear')}
                  </button>
                )}
              </div>
              {recentErrorLogs.length === 0 ? (
                <p className="text-[11px] text-[#059669] dark:text-[#34D399]">
                  {tr(
                    'Tidak ada error runtime/API yang terekam sejauh ini.',
                    'No runtime or API errors recorded so far.'
                  )}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {recentErrorLogs.slice(0, 8).map((ev) => (
                    <div
                      key={ev.id}
                      className="p-2 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] font-mono text-[10px] space-y-0.5 select-text"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#E11D48] dark:text-[#FB7185]">
                          [{ev.source}]
                        </span>
                        <span className="text-[#94A3B8] text-[9px]">{ev.timestamp}</span>
                      </div>
                      <div className="text-[#0F172A] dark:text-[#F2F4F7] break-words">{ev.message}</div>
                      {ev.detail && (
                        <div className="text-[#64748B] dark:text-[#929BA9] text-[9.5px] break-all">
                          {ev.detail}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {showVersionHistory && (
          <div className="rounded-2xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] p-4 space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Riwayat Versi', 'Version History')}
              </span>
              <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                v{APP_VERSION} · {BUILD_GIT_SHA}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] font-mono text-[10px] text-[#526071] dark:text-[#929BA9] space-y-0.5 select-text">
              <div>
                Build: v{appBuildIdentity.appVersion} · #{appBuildIdentity.changeCode} · git {appBuildIdentity.gitCommitSha} · run #{appBuildIdentity.ciRunNumber}
              </div>
              <div className="break-all">Built: {appBuildIdentity.buildTimestamp}</div>
              <div>
                OCR: {appBuildIdentity.ocrEngine} {appBuildIdentity.ocrEngineVersion} ({appBuildIdentity.ocrPipelineVersion})
              </div>
            </div>
            <div className="space-y-2.5">
              {APP_VERSION_HISTORY.map((entry) => (
                <div
                  key={`${entry.version}-${entry.changeCode}`}
                  className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono-numbers tabular-nums">
                      <span className="text-xs font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                        v{entry.version}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                      {entry.date}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                    {tr(entry.titleId, entry.titleEn)}
                  </p>
                  <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed text-editorial-justify">
                    {tr(entry.summaryId, entry.summaryEn)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Trading Preferences Modal */}
      <TradingPreferencesModal
        isOpen={Boolean(activePrefModal)}
        onClose={() => setActivePrefModal(null)}
        category={activePrefModal || 'balance'}
        settings={settings}
        trades={trades}
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

      {/* Secret Developer Mode Passcode Gate Modal (triggered by 7x version tap) */}
      {isDevPasscodeModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setIsDevPasscodeModalOpen(false)}
        >
          <form
            onSubmit={(e) => void handleSubmitDevPasscode(e)}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-[#0F172A] dark:text-[#F2F4F7]" />
                <h3 className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                  {tr('Akses Pengembang', 'Developer Access')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDevPasscodeModalOpen(false)}
                className="p-1 rounded-full text-[#64748B] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer"
                aria-label={tr('Tutup', 'Close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
              {tr(
                'Masukkan seri kode akses untuk membuka pengaturan Cloud, Backend, Cleaning Service & Diagnostik.',
                'Enter the access serial code to unlock Cloud, Backend, Cleaning Service & Diagnostics.'
              )}
            </p>

            <div className="space-y-1.5">
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                maxLength={20}
                value={devPasscodeInput}
                onChange={(e) => {
                  setDevPasscodeInput(e.target.value);
                  if (devPasscodeError) setDevPasscodeError(null);
                }}
                placeholder={tr('Masukkan kode seri...', 'Enter serial code...')}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-sm tracking-widest font-mono text-center text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
              />
              {devPasscodeError && (
                <p className="text-[11px] text-[#E11D48] text-center font-medium">
                  {devPasscodeError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsDevPasscodeModalOpen(false)}
                className="px-3.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-xs font-medium text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer"
              >
                {tr('Batal', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={!devPasscodeInput.trim() || isVerifyingPasscode}
                className="px-4 py-1.5 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                {isVerifyingPasscode ? tr('Memeriksa...', 'Checking...') : tr('Buka', 'Unlock')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
