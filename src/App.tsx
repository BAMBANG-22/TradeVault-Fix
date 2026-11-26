/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, startTransition, Suspense, lazy, Component, ErrorInfo, ReactNode } from 'react';
import { Check, AlertCircle, X } from 'lucide-react';
import { Trade, PlaybookSetup } from './types/trade';
import { AppSettings } from './types/settings';
import {
  loadStoredTrades,
  saveStoredTrades,
  loadStoredSettings,
  saveStoredSettings,
  mergeWithExistingSettings,
  removeTradeFromLatestList,
  removeTradesListFromLatestList,
} from './utils/storage';
import { calculatePerformance } from './utils/calculations';
import { DEMO_TRADES, isDemoTrade } from './utils/demoData';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  getSupabase,
  getCurrentSession,
  getCurrentUser,
  isSupabaseConfigured,
  handleNativeOAuthCallbackUrl,
  translateAuthError,
} from './utils/supabaseClient';
import {
  fetchTradesFromSupabase,
  saveTradeToSupabase,
  updateTradeInSupabase,
  insertTradeToSupabase,
  deleteTradeFromSupabase,
  migrateLocalTradesToSupabase,
  isStoragePath,
  uploadScreenshotToSupabase,
  deleteScreenshotFromSupabase,
  setCachedBase64ForStoragePath,
  clearSessionSyncCaches,
  mergeTradesDatasets,
  deleteTradesListFromSupabase,
  deleteObsoleteTradesFromSupabase,
  fetchSettingsFromSupabase,
  loadUserSettingsWithFallback,
  saveSettingsToSupabase,
  extractAllTradeStoragePaths,
} from './utils/supabaseSync';
import { applyThemeToDocument, getStoredTheme, toggleThemeMode } from './utils/theme';
import { useLanguage } from './utils/language';
import {
  initGlobalUiSoundFeedback,
  playErrorTone,
  playSuccessChime,
} from './utils/soundEngine';
import {
  filterTradesByAccount,
  resolveAccountScopedSettings,
} from './utils/journalExtras';
import {
  isBrowserOnline,
  isLikelyOfflineOrNetworkError,
  loadOfflineSyncQueue,
  saveOfflineSyncQueue,
  enqueueOfflineTradeUpsert,
  enqueueOfflineTradeDelete,
  enqueueOfflineSettingsUpdate,
  applyPendingQueueToTrades,
  type OfflineSyncOperation,
} from './utils/offlineSyncQueue';
import { installGlobalErrorRecorder } from './utils/devDiagnosticsStore';

// Layout
import { Sidebar } from './components/layout/Sidebar';
import { Navbar } from './components/layout/Navbar';
import { MobileNav } from './components/layout/MobileNav';
import { SplashScreen } from './components/layout/SplashScreen';
import { OfflineIndicator } from './components/layout/PWAInstallButton';
import { QuickCommandModal } from './components/layout/QuickCommandModal';
import { AccountSwitcherModal } from './components/layout/AccountSwitcherModal';

// Views (Core primary views eagerly loaded; heavy secondary views code-split via React.lazy)
import { DashboardView } from './components/dashboard/DashboardView';
import { TradeTable } from './components/trades/TradeTable';
import { TradeForm } from './components/trades/TradeForm';

const LAZY_RELOAD_GUARD_KEY = 'vlo_lazy_module_reload_ts_v1';

function isDynamicImportFetchError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('chunkloaderror') ||
    msg.includes('loading chunk') ||
    msg.includes('invalid hook call') ||
    msg.includes("cannot read properties of null (reading 'use")
  );
}

function tryGuardedReloadForStaleModule(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const lastReloadRaw = window.sessionStorage.getItem(LAZY_RELOAD_GUARD_KEY);
    const lastReloadTs = lastReloadRaw ? Number(lastReloadRaw) : 0;
    const now = Date.now();
    if (!Number.isFinite(lastReloadTs) || now - lastReloadTs > 15_000) {
      window.sessionStorage.setItem(LAZY_RELOAD_GUARD_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    // Ignore sessionStorage restrictions in private contexts
  }
  return false;
}

function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }

    if (isDynamicImportFetchError(lastError) && tryGuardedReloadForStaleModule()) {
      return await new Promise<{ default: T }>(() => {});
    }

    throw lastError;
  });
}

class LazyViewErrorBoundary extends Component<
  { resetKey: string; tr: (id: string, en: string) => string; children: ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { resetKey: string; tr: (id: string, en: string) => string; children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message || 'Module load error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LazyViewErrorBoundary]', error, info);
    if (isDynamicImportFetchError(error)) {
      tryGuardedReloadForStaleModule();
    }
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="my-8 mx-auto max-w-md rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] p-5 text-center space-y-3">
          <p className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
            {this.props.tr('Gagal Memuat Modul Tampilan', 'Failed to Load View Module')}
          </p>
          <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed">
            {this.props.tr(
              'Koneksi ke modul tampilan sempat terputus atau cache halaman belum diperbarui. Silakan coba muat ulang.',
              'The view module request was interrupted or stale. Please retry loading.'
            )}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (isDynamicImportFetchError(this.state.errorMessage)) {
                  window.location.reload();
                  return;
                }
                this.setState({ hasError: false, errorMessage: '' });
              }}
              className="h-9 px-4 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-xs font-semibold text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22] cursor-pointer"
            >
              {this.props.tr('Coba Lagi', 'Retry')}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-9 px-4 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#050607] text-xs font-semibold hover:opacity-90 cursor-pointer"
            >
              {this.props.tr('Muat Ulang Halaman', 'Reload Page')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const AnalyticsView = lazyWithRetry(() =>
  import('./components/analytics/AnalyticsView').then((m) => ({ default: m.AnalyticsView }))
);
const RiskCalculatorView = lazyWithRetry(() =>
  import('./components/risk/RiskCalculatorView').then((m) => ({ default: m.RiskCalculatorView }))
);
const MarketChartView = lazyWithRetry(() =>
  import('./components/chart/MarketChartView').then((m) => ({ default: m.MarketChartView }))
);
const AgentDeskView = lazyWithRetry(() =>
  import('./components/ai/AgentDeskView').then((m) => ({ default: m.AgentDeskView }))
);
const MacroNewsView = lazyWithRetry(() =>
  import('./components/news/MacroNewsView').then((m) => ({ default: m.MacroNewsView }))
);
const FundamentalGoldView = lazyWithRetry(() =>
  import('./components/news/FundamentalGoldView').then((m) => ({ default: m.FundamentalGoldView }))
);
const CycleConfluencePage = lazyWithRetry(() =>
  import('./pages/CycleConfluencePage').then((m) => ({ default: m.CycleConfluencePage }))
);
const SmcSignalPage = lazyWithRetry(() =>
  import('./pages/SmcSignalPage').then((m) => ({ default: m.SmcSignalPage }))
);
const SettingsView = lazyWithRetry(() =>
  import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);

// Modals
import { DeleteConfirmModal } from './components/trades/DeleteConfirmModal';
import {
  BatchDeleteDateModal,
  type BatchDeleteDateRequest,
} from './components/trades/BatchDeleteDateModal';
import { TradeDetailModal } from './components/trades/TradeDetailModal';
import { ScreenshotModal } from './components/trades/ScreenshotModal';
import { LocalPrototypeModal } from './components/layout/LocalPrototypeModal';
import { JsonBackupModal } from './components/backup/JsonBackupModal';
import { ClearDemoModal } from './components/backup/ClearDemoModal';
import { AuthModal } from './components/auth/AuthModal';
import { UserAccountModal } from './components/auth/UserAccountModal';
import { SupabaseConfigModal } from './components/supabase/SupabaseConfigModal';
import { PlaybookLibraryModal } from './components/trades/PlaybookLibraryModal';
import {
  decodeLifecycleMetaFromExecutionNotes,
  encodeLifecycleMetaIntoExecutionNotes,
} from './utils/tradeLifecycle';
import {
  AppNotificationItem,
  NOTIFICATIONS_UPDATED_EVENT,
  clearAppNotifications,
  loadAppNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushBatchTradesNotification,
  pushTradeNotification,
} from './utils/appNotifications';

export default function App() {
  // Sync stored theme class once at mount without re-rendering the entire App tree on theme switches
  useEffect(() => {
    applyThemeToDocument(getStoredTheme());
  }, []);
  const { isEn, tr } = useLanguage();

  // Primary state backed by localStorage with live Supabase synchronization
  const [trades, setTrades] = useState<Trade[]>(() => loadStoredTrades(null));
  const [settings, setSettings] = useState<AppSettings>(() => loadStoredSettings());
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({
    dashboard: true,
    trades: true,
  });

  // Cloud Auth & Onboarding States
  const GUEST_MODE_STORAGE_KEY = 'vlo_guest_mode_v1';
  const DEV_MODE_SESSION_KEY = 'vlo_dev_mode';
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [isSupabaseConfigOpen, setIsSupabaseConfigOpen] = useState<boolean>(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [cloudLoadError, setCloudLoadError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'cloud' | 'local_fallback' | 'local'>('local');
  const isFlushingOfflineQueueRef = useRef<boolean>(false);
  const [shouldPromptOnboarding, setShouldPromptOnboarding] = useState<boolean>(false);
  const [isDeveloperMode, setIsDeveloperMode] = useState<boolean>(() => {
    try {
      return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DEV_MODE_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    installGlobalErrorRecorder();
  }, []);

  const handleUnlockDeveloperMode = useCallback(() => {
    try {
      sessionStorage.setItem(DEV_MODE_SESSION_KEY, '1');
    } catch {}
    setIsDeveloperMode(true);
  }, []);

  const handleLockDeveloperMode = useCallback(() => {
    try {
      sessionStorage.removeItem(DEV_MODE_SESSION_KEY);
    } catch {}
    setIsDeveloperMode(false);
  }, []);

  // Modal and editing states
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [isAddTradeModalOpen, setIsAddTradeModalOpen] = useState<boolean>(false);
  const [selectedPlaybookForTrade, setSelectedPlaybookForTrade] = useState<PlaybookSetup | null>(null);
  const [isQuickCommandOpen, setIsQuickCommandOpen] = useState<boolean>(false);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState<boolean>(false);
  const [isPlaybookModalOpen, setIsPlaybookModalOpen] = useState<boolean>(false);
  const [tradeForDetail, setTradeForDetail] = useState<Trade | null>(null);
  const [tradeForDelete, setTradeForDelete] = useState<Trade | null>(null);
  const [batchDeleteRequest, setBatchDeleteRequest] = useState<BatchDeleteDateRequest | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ url: string; title: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [appNotifications, setAppNotifications] = useState<AppNotificationItem[]>(() =>
    loadAppNotifications()
  );
  const [notification, setNotification] = useState<{
    id: number;
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [isToastVisible, setIsToastVisible] = useState<boolean>(false);
  const [toastSwipeOffset, setToastSwipeOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isToastDragging, setIsToastDragging] = useState<boolean>(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdCounterRef = useRef<number>(0);
  const toastGestureRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startTime: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
  });

  // Prototype & Backup Modals
  const [isLocalInfoModalOpen, setIsLocalInfoModalOpen] = useState<boolean>(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [isClearDemoModalOpen, setIsClearDemoModalOpen] = useState<boolean>(false);
  const [isWorkspaceReady, setIsWorkspaceReady] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (isWorkspaceReady) return;
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setIsWorkspaceReady(true);
      });
    }, 1450);
    return () => window.clearTimeout(timer);
  }, [isWorkspaceReady]);

  const handleSplashComplete = useCallback(() => {
    startTransition(() => {
      setIsWorkspaceReady(true);
    });
  }, []);

  useEffect(() => {
    const syncNotifications = () => {
      setAppNotifications(loadAppNotifications());
    };
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, syncNotifications);
    return () => window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, syncNotifications);
  }, []);

  useEffect(() => {
    return initGlobalUiSoundFeedback();
  }, []);

  // Synchronous concurrency locks & latest references to prevent double-submit and stale closures
  const isSavingTradeRef = useRef<boolean>(false);
  const isDeletingTradeRef = useRef<boolean>(false);
  const tradesRef = useRef<Trade[]>(trades);
  tradesRef.current = trades;

  // Independent per-page scroll position storage (in-memory for current session)
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const activeTabRef = useRef<string>(activeTab);
  activeTabRef.current = activeTab;

  // Centralized navigation handler to save outgoing tab scroll position before switching
  const handleNavigateTab = useCallback((nextTab: string) => {
    if (nextTab === 'add-trade') {
      setIsAddTradeModalOpen(true);
      return;
    }
    const currentTab = activeTabRef.current;
    if (currentTab && currentTab !== 'add-trade') {
      scrollPositionsRef.current[currentTab] =
        window.scrollY || document.documentElement.scrollTop || 0;
    }
    if (nextTab === 'detail') {
      scrollPositionsRef.current['detail'] = 0;
      setTradeForDetail((prev) => {
        if (prev) return prev;
        const latest = tradesRef.current;
        if (latest.length === 0) return null;
        const sorted = [...latest].sort(
          (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()
        );
        return sorted[0];
      });
    }
    activeTabRef.current = nextTab;
    setVisitedTabs((prev) => (prev[nextTab] ? prev : { ...prev, [nextTab]: true }));
    setActiveTab(nextTab);
  }, []);

  // Self-healing storage pass: deduplicate any legacy trade where beforeScreenshotUrl in [TV_META]
  // duplicates trade.screenshotUrl, freeing up localStorage & RAM on mobile devices.
  useEffect(() => {
    let anyDeduplicated = false;
    const cleaned = tradesRef.current.map((t) => {
      if (!t.executionNotes || !t.screenshotUrl) return t;
      const meta = decodeLifecycleMetaFromExecutionNotes(t.executionNotes);
      if (meta.beforeScreenshotUrl && meta.beforeScreenshotUrl.trim() === t.screenshotUrl.trim()) {
        anyDeduplicated = true;
        const nextMeta = { ...meta };
        delete nextMeta.beforeScreenshotUrl;
        return {
          ...t,
          executionNotes:
            encodeLifecycleMetaIntoExecutionNotes(t.executionNotes, nextMeta) || undefined,
        };
      }
      return t;
    });
    if (anyDeduplicated) {
      tradesRef.current = cleaned;
      setTrades(cleaned);
      saveStoredTrades(cleaned, currentUser?.id || null);
    }
  }, [currentUser?.id]);

  // Continuously track window scroll position for the active main view
  useEffect(() => {
    const handleWindowScroll = () => {
      const currentTab = activeTabRef.current;
      if (currentTab && currentTab !== 'add-trade') {
        scrollPositionsRef.current[currentTab] =
          window.scrollY || document.documentElement.scrollTop || 0;
      }
    };
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, []);

  // Native Android hardware back button handling: close modals/drawers first, or return to Dashboard before exiting
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let isDisposed = false;

    CapacitorApp.addListener('backButton', () => {
      if (screenshotModal) {
        setScreenshotModal(null);
        return;
      }
      if (tradeForDelete && !isCloudSyncing) {
        setTradeForDelete(null);
        return;
      }
      if (isClearDemoModalOpen) {
        setIsClearDemoModalOpen(false);
        return;
      }
      if (isBackupModalOpen) {
        setIsBackupModalOpen(false);
        return;
      }
      if (isLocalInfoModalOpen) {
        setIsLocalInfoModalOpen(false);
        return;
      }
      if (isSupabaseConfigOpen) {
        setIsSupabaseConfigOpen(false);
        return;
      }
      if (isAccountModalOpen) {
        setIsAccountModalOpen(false);
        return;
      }
      if (isAuthModalOpen) {
        setIsAuthModalOpen(false);
        return;
      }
      if (isAddTradeModalOpen || activeTabRef.current === 'add-trade') {
        setEditingTrade(null);
        setIsAddTradeModalOpen(false);
        if (activeTabRef.current === 'add-trade') {
          handleNavigateTab('trades');
        }
        return;
      }
      if (isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
        return;
      }
      if (activeTabRef.current === 'detail') {
        handleNavigateTab('trades');
        return;
      }
      if (activeTabRef.current !== 'dashboard') {
        handleNavigateTab('dashboard');
        return;
      }
      void CapacitorApp.exitApp();
    }).then((handle) => {
      if (isDisposed) {
        void handle.remove();
      } else {
        listenerHandle = handle;
      }
    });

    return () => {
      isDisposed = true;
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, [
    screenshotModal,
    tradeForDelete,
    isCloudSyncing,
    isClearDemoModalOpen,
    isBackupModalOpen,
    isLocalInfoModalOpen,
    isSupabaseConfigOpen,
    isAccountModalOpen,
    isAuthModalOpen,
    isAddTradeModalOpen,
    isMobileMenuOpen,
    handleNavigateTab,
  ]);

  // Synchronously restore target view scroll position before browser paint
  useLayoutEffect(() => {
    const targetY =
      activeTab === 'add-trade' || activeTab === 'detail'
        ? 0
        : (scrollPositionsRef.current[activeTab] ?? 0);
    const scrollingEl = document.scrollingElement || document.documentElement;
    const maxScroll = Math.max(0, scrollingEl.scrollHeight - window.innerHeight);
    const clampedY = Math.min(Math.max(0, targetY), maxScroll);
    window.scrollTo({ top: clampedY, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeTab]);
  const previousUserIdRef = useRef<string | null>(null);
  const authGenerationRef = useRef<number>(0);

  const resetTransientModalsAndCaches = () => {
    clearSessionSyncCaches();
    setEditingTrade(null);
    setIsAddTradeModalOpen(false);
    setTradeForDetail(null);
    setTradeForDelete(null);
    setScreenshotModal(null);
    setIsClearDemoModalOpen(false);
  };

  // Session Recovery & Auth Listener
  useEffect(() => {
    let isMounted = true;

    // 1. Initial check for persistent session on page load/refresh
    getCurrentSession().then(({ session }) => {
      if (!isMounted) return;
      if (session?.user) {
        authGenerationRef.current++;
        setCurrentUser(session.user);
        try {
          localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
        } catch {}
      } else if (isSupabaseConfigured()) {
        let skippedOnboarding = false;
        try {
          skippedOnboarding = localStorage.getItem(GUEST_MODE_STORAGE_KEY) === '1';
        } catch {}
        if (!skippedOnboarding) {
          setShouldPromptOnboarding(true);
        }
      }
    });

    // 2. Listen to Supabase auth state changes (sign in, sign out, token refresh)
    const client = getSupabase();
    if (client) {
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, session) => {
        if (!isMounted) return;
        authGenerationRef.current++;
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          setCurrentUser(session?.user || null);
          if (session?.user) {
            setShouldPromptOnboarding(false);
            try {
              localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
            } catch {}
          }
        } else if (event === 'SIGNED_OUT') {
          resetTransientModalsAndCaches();
          previousUserIdRef.current = null;
          setCurrentUser(null);
          setCloudLoadError(null);
          setDataSource('local');
          const guestTrades = loadStoredTrades(null);
          tradesRef.current = guestTrades;
          setTrades(guestTrades);
          setSettings(loadStoredSettings(null));
        }
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Resolve authenticated user ID safely without hanging when browser is offline
  const resolveEffectiveCloudUserId = useCallback(async (): Promise<string | null> => {
    if (!currentUser) return null;
    if (!isBrowserOnline()) {
      return currentUser.id || null;
    }
    try {
      const { user } = await getCurrentUser();
      return user?.id || currentUser.id || null;
    } catch {
      return currentUser.id || null;
    }
  }, [currentUser]);

  // Upload any remaining base64 screenshots on a trade to Supabase Storage before cloud write
  const uploadQueuedTradeScreenshots = useCallback(
    async (
      trade: Trade,
      userId: string
    ): Promise<{ success: boolean; trade: Trade; error?: string }> => {
      const nextTrade: Trade = { ...trade };

      if (nextTrade.screenshotUrl && nextTrade.screenshotUrl.startsWith('data:image/')) {
        const uploadRes = await uploadScreenshotToSupabase(
          nextTrade.screenshotUrl,
          nextTrade.id,
          userId
        );
        if (!uploadRes.success || !uploadRes.data) {
          return {
            success: false,
            trade: nextTrade,
            error: uploadRes.error || 'Gagal mengunggah screenshot ke Storage.',
          };
        }
        nextTrade.screenshotUrl = uploadRes.data;
      }

      if (nextTrade.executionNotes) {
        const decodedMeta = decodeLifecycleMetaFromExecutionNotes(nextTrade.executionNotes);
        if (Object.keys(decodedMeta).length > 0) {
          let metaChanged = false;
          const nextMeta = { ...decodedMeta };

          if (
            nextMeta.beforeScreenshotUrl &&
            nextMeta.beforeScreenshotUrl.startsWith('data:image/')
          ) {
            const beforeRes = await uploadScreenshotToSupabase(
              nextMeta.beforeScreenshotUrl,
              `${nextTrade.id}_before`,
              userId
            );
            if (!beforeRes.success || !beforeRes.data) {
              return {
                success: false,
                trade: nextTrade,
                error: beforeRes.error || 'Gagal mengunggah screenshot Before Trade.',
              };
            }
            nextMeta.beforeScreenshotUrl = beforeRes.data;
            metaChanged = true;
          }

          if (
            nextMeta.afterScreenshotUrl &&
            nextMeta.afterScreenshotUrl.startsWith('data:image/')
          ) {
            const afterRes = await uploadScreenshotToSupabase(
              nextMeta.afterScreenshotUrl,
              `${nextTrade.id}_after`,
              userId
            );
            if (!afterRes.success || !afterRes.data) {
              return {
                success: false,
                trade: nextTrade,
                error: afterRes.error || 'Gagal mengunggah screenshot After Trade.',
              };
            }
            nextMeta.afterScreenshotUrl = afterRes.data;
            metaChanged = true;
          }

          if (metaChanged) {
            nextTrade.executionNotes = encodeLifecycleMetaIntoExecutionNotes(
              nextTrade.executionNotes,
              nextMeta
            );
          }
        }
      }

      return { success: true, trade: nextTrade };
    },
    []
  );

  // Flush queued offline mutations sequentially (FIFO) whenever connectivity returns
  const flushOfflineSyncQueue = useCallback(
    async (
      userId: string,
      options?: { silent?: boolean }
    ): Promise<{ flushed: number; remaining: number; lastError?: string }> => {
      const initialQueue = loadOfflineSyncQueue(userId);

      if (!userId || initialQueue.length === 0 || !isBrowserOnline()) {
        return { flushed: 0, remaining: initialQueue.length };
      }
      if (isFlushingOfflineQueueRef.current) {
        return { flushed: 0, remaining: initialQueue.length };
      }

      isFlushingOfflineQueueRef.current = true;
      setIsCloudSyncing(true);
      let flushed = 0;
      let lastError: string | undefined = undefined;
      let remaining: OfflineSyncOperation[] = [...initialQueue];

      try {
        while (remaining.length > 0) {
          if (!isBrowserOnline()) break;
          const op = remaining[0];

          if (op.kind === 'upsert_trade') {
            const uploaded = await uploadQueuedTradeScreenshots(op.trade, userId);
            if (!uploaded.success) {
              lastError = uploaded.error;
              if (isLikelyOfflineOrNetworkError(uploaded.error)) {
                break;
              }
              break;
            }

            const preparedTrade = uploaded.trade;
            let cloudRes = op.isEdit
              ? await updateTradeInSupabase(preparedTrade, userId, op.originalId)
              : await insertTradeToSupabase(preparedTrade, userId);

            // If an offline edit targeted a trade that was not yet inserted on cloud, fallback to insert
            if (!cloudRes.success && op.isEdit && !isLikelyOfflineOrNetworkError(cloudRes.error)) {
              const fallbackInsert = await insertTradeToSupabase(preparedTrade, userId);
              if (fallbackInsert.success) {
                cloudRes = fallbackInsert;
              }
            }

            if (!cloudRes.success) {
              lastError = cloudRes.error;
              break;
            }

            // Update local cache with any newly uploaded storage paths
            const currentList = tradesRef.current;
            const idx = currentList.findIndex(
              (t) => t.id.toLowerCase() === preparedTrade.id.toLowerCase()
            );
            if (idx >= 0) {
              const nextList = [...currentList];
              nextList[idx] = preparedTrade;
              tradesRef.current = nextList;
              setTrades(nextList);
              saveStoredTrades(nextList, userId);
            }
          } else if (op.kind === 'delete_trade') {
            const delRes = await deleteTradeFromSupabase(op.tradeId, userId);
            if (!delRes.success) {
              lastError = delRes.error;
              break;
            }
            if (op.storagePathsToClean && op.storagePathsToClean.length > 0) {
              for (const storagePath of op.storagePathsToClean) {
                deleteScreenshotFromSupabase(storagePath).catch(() => {
                  // best-effort storage cleanup
                });
              }
            }
          } else if (op.kind === 'update_settings') {
            try {
              const savedOk = await saveSettingsToSupabase(op.settings, userId);
              if (!savedOk) {
                lastError = 'Gagal menyinkronkan pengaturan ke Cloud.';
                break;
              }
            } catch (err: any) {
              lastError = err?.message || 'Gagal menyinkronkan pengaturan ke Cloud.';
              break;
            }
          }

          flushed++;
          remaining = remaining.slice(1);
          saveOfflineSyncQueue(userId, remaining);
        }

        if (flushed > 0 && remaining.length === 0) {
          setDataSource('cloud');
          setCloudLoadError(null);
          if (!options?.silent) {
            showToast(
              tr(
                `${flushed} perubahan offline berhasil disinkronkan ke VLO Cloud!`,
                `${flushed} offline changes synced to VLO Cloud!`
              )
            );
          }
        }
      } finally {
        isFlushingOfflineQueueRef.current = false;
        setIsCloudSyncing(false);
      }

      return { flushed, remaining: remaining.length, lastError };
    },
    [uploadQueuedTradeScreenshots, tr]
  );

  // Automatically flush queued offline mutations when device regains internet connectivity
  useEffect(() => {
    const activeUserId = currentUser?.id;
    if (!activeUserId || typeof window === 'undefined') return;

    const handleBackOnline = () => {
      const queued = loadOfflineSyncQueue(activeUserId);
      if (queued.length > 0) {
        flushOfflineSyncQueue(activeUserId);
      }
    };

    window.addEventListener('online', handleBackOnline);
    return () => {
      window.removeEventListener('online', handleBackOnline);
    };
  }, [currentUser?.id, flushOfflineSyncQueue]);

  // Fetch authenticated user trades and settings from Supabase whenever user logs in or switches account
  useEffect(() => {
    const activeUserId = currentUser?.id || null;

    // Clear session caches and transient modals whenever the active user changes or logs out
    if (previousUserIdRef.current !== activeUserId) {
      resetTransientModalsAndCaches();
      previousUserIdRef.current = activeUserId;
    }

    if (!activeUserId) {
      setDataSource('local');
      setCloudLoadError(null);
      const guestTrades = loadStoredTrades(null);
      tradesRef.current = guestTrades;
      setTrades(guestTrades);
      setSettings(loadStoredSettings(null));
      return;
    }

    let isCurrent = true;
    const initialPendingQueue = loadOfflineSyncQueue(activeUserId);

    // Pre-load this user's isolated local cache immediately while cloud fetch is pending
    // (never leaks another account's trades or settings)
    const userCachedTrades = applyPendingQueueToTrades(
      loadStoredTrades(activeUserId),
      initialPendingQueue
    );
    tradesRef.current = userCachedTrades;
    setTrades(userCachedTrades);
    const userCachedSettings = loadStoredSettings(activeUserId);
    setSettings(userCachedSettings);

    // If launching offline while signed in, keep isolated local cache quietly without alarming error banner
    if (!isBrowserOnline()) {
      setIsCloudSyncing(false);
      setCloudLoadError(null);
      setDataSource('local_fallback');
      return () => {
        isCurrent = false;
      };
    }

    setIsCloudSyncing(true);
    setCloudLoadError(null);

    const runInitialCloudSync = async () => {
      if (initialPendingQueue.length > 0) {
        await flushOfflineSyncQueue(activeUserId, { silent: true });
      }
      if (!isCurrent) return;

      const [result, settingsResult] = await Promise.all([
        fetchTradesFromSupabase(activeUserId),
        loadUserSettingsWithFallback(activeUserId, fetchSettingsFromSupabase),
      ]);

      if (!isCurrent) return;
      setIsCloudSyncing(false);
      setSettings(settingsResult.settings);

      const remainingQueue = loadOfflineSyncQueue(activeUserId);

      if (result.success && result.data) {
        setCloudLoadError(null);
        const mergedWithPending = applyPendingQueueToTrades(result.data, remainingQueue);
        setDataSource(remainingQueue.length > 0 ? 'local_fallback' : 'cloud');
        tradesRef.current = mergedWithPending;
        setTrades(mergedWithPending);
        saveStoredTrades(mergedWithPending, activeUserId);

        if (mergedWithPending.length > 0) {
          showToast(
            tr(
              `Berhasil memuat ${mergedWithPending.length} transaksi dari VLO Cloud.`,
              `Successfully loaded ${mergedWithPending.length} trades from VLO Cloud.`
            )
          );
        } else {
          showToast(
            tr(
              'Terhubung ke VLO Cloud. Akun ini belum memiliki transaksi cloud.',
              'Connected to VLO Cloud. This account has no cloud trades yet.'
            )
          );
        }
      } else if (!result.success) {
        if (!isBrowserOnline()) {
          setCloudLoadError(null);
          setDataSource('local_fallback');
          return;
        }
        setCloudLoadError(
          result.error ||
            tr('Gagal memuat data dari VLO Cloud.', 'Failed to load data from VLO Cloud.')
        );
        setDataSource('local_fallback');
        const fallbackTrades = applyPendingQueueToTrades(
          loadStoredTrades(activeUserId),
          remainingQueue
        );
        tradesRef.current = fallbackTrades;
        setTrades(fallbackTrades);
        showToast(
          tr(
            `Gagal memuat transaksi dari VLO Cloud: ${result.error}. Menampilkan data cadangan luring akun ini (${fallbackTrades.length} transaksi).`,
            `Failed to load trades from VLO Cloud: ${result.error}. Showing offline backup data for this account (${fallbackTrades.length} trades).`
          ),
          'error'
        );
      }
    };

    runInitialCloudSync();

    return () => {
      isCurrent = false;
    };
  }, [currentUser?.id, flushOfflineSyncQueue]);

  const clearToastTimers = useCallback(() => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    if (toastExitTimerRef.current !== null) {
      clearTimeout(toastExitTimerRef.current);
      toastExitTimerRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setIsToastDragging(false);
    setIsToastVisible(false);
    if (toastExitTimerRef.current !== null) {
      clearTimeout(toastExitTimerRef.current);
    }
    toastExitTimerRef.current = setTimeout(() => {
      setNotification(null);
      setToastSwipeOffset({ x: 0, y: 0 });
      toastExitTimerRef.current = null;
    }, 180);
  }, []);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      clearToastTimers();
      const nextId = ++toastIdCounterRef.current;
      toastGestureRef.current.active = false;
      setIsToastDragging(false);
      setToastSwipeOffset({ x: 0, y: 0 });
      setNotification({ id: nextId, message, type });
      setIsToastVisible(true);

      if (type === 'error') {
        playErrorTone();
      } else {
        playSuccessChime();
      }

      toastTimerRef.current = setTimeout(() => {
        if (toastIdCounterRef.current === nextId) {
          dismissToast();
        }
      }, 3800);
    },
    [clearToastTimers, dismissToast]
  );

  useEffect(() => {
    return () => {
      clearToastTimers();
    };
  }, [clearToastTimers]);

  // First-launch public onboarding prompt after splash finishes (only if cloud is active and user has not chosen local mode)
  useEffect(() => {
    if (!isWorkspaceReady || !shouldPromptOnboarding || currentUser) return;
    setShouldPromptOnboarding(false);
    setIsAuthModalOpen(true);
  }, [isWorkspaceReady, shouldPromptOnboarding, currentUser]);

  // Handle web OAuth error redirect parameters and native Android APK deep-link OAuth callbacks
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const oauthError =
          urlParams.get('error_description') ||
          urlParams.get('error') ||
          hashParams.get('error_description') ||
          hashParams.get('error');
        if (oauthError) {
          showToast(translateAuthError({ message: oauthError }), 'error');
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch {}
    }

    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = CapacitorApp.addListener('appUrlOpen', async (event) => {
      if (!event?.url) return;
      const result = await handleNativeOAuthCallbackUrl(event.url);
      if (!result.handled) return;

      if (result.success && result.user) {
        setCurrentUser(result.user);
        setIsAuthModalOpen(false);
        setShouldPromptOnboarding(false);
        try {
          localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
        } catch {}
        const label =
          result.user.user_metadata?.full_name || result.user.email || 'Trader';
        showToast(
          tr(`Berhasil masuk sebagai ${label}`, `Signed in as ${label}`)
        );
      } else if (!result.success && result.error) {
        showToast(result.error, 'error');
      }
    });

    return () => {
      listenerPromise.then((handle) => handle.remove()).catch(() => {});
    };
  }, [showToast, tr]);

  const handleToastGestureStart = (clientX: number, clientY: number) => {
    toastGestureRef.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
    };
    setIsToastDragging(true);
  };

  const handleToastGestureMove = (clientX: number, clientY: number) => {
    if (!toastGestureRef.current.active) return;
    const rawDeltaX = clientX - toastGestureRef.current.startX;
    const rawDeltaY = clientY - toastGestureRef.current.startY;
    // Allow full upward movement and horizontal movement; dampen downward pull
    const clampedY = rawDeltaY < 0 ? rawDeltaY : rawDeltaY * 0.15;
    setToastSwipeOffset({ x: rawDeltaX, y: clampedY });
  };

  const handleToastGestureEnd = (clientX: number, clientY: number) => {
    if (!toastGestureRef.current.active) return;
    const deltaX = clientX - toastGestureRef.current.startX;
    const deltaY = clientY - toastGestureRef.current.startY;
    const elapsedMs = Math.max(1, Date.now() - toastGestureRef.current.startTime);
    const velocityY = deltaY / elapsedMs; // px per ms (negative = upward)
    const velocityX = Math.abs(deltaX) / elapsedMs;

    toastGestureRef.current.active = false;
    setIsToastDragging(false);

    const shouldDismissUpward = deltaY <= -20 || (deltaY <= -10 && velocityY <= -0.22);
    const shouldDismissHorizontal = Math.abs(deltaX) >= 60 || (Math.abs(deltaX) >= 30 && velocityX >= 0.35);

    if (shouldDismissUpward || shouldDismissHorizontal) {
      dismissToast();
    } else {
      setToastSwipeOffset({ x: 0, y: 0 });
    }
  };

  const handleToastGestureCancel = () => {
    toastGestureRef.current.active = false;
    setIsToastDragging(false);
    setToastSwipeOffset({ x: 0, y: 0 });
  };

  // Multi-account scoped data (keeps underlying trades & settings untouched for storage/sync)
  const activeAccountId = settings.activeAccountId || 'ALL';
  const scopedTrades = useMemo(
    () => filterTradesByAccount(trades, activeAccountId),
    [trades, activeAccountId]
  );
  const scopedSettings = useMemo(
    () => resolveAccountScopedSettings(settings, activeAccountId),
    [settings, activeAccountId]
  );

  // Performance calculation engine (authoritative on active sub-portfolio)
  const { metrics } = useMemo(
    () => calculatePerformance(scopedTrades, scopedSettings),
    [scopedTrades, scopedSettings]
  );
  const currentEquity = metrics.currentEquity;

  // Global keyboard shortcuts: Cmd/Ctrl+K (Quick Command), N (New Trade), / (Search Trades), Esc
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsQuickCommandOpen((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        if (isQuickCommandOpen) {
          setIsQuickCommandOpen(false);
          return;
        }
        if (isAccountSwitcherOpen) {
          setIsAccountSwitcherOpen(false);
          return;
        }
        if (isPlaybookModalOpen) {
          setIsPlaybookModalOpen(false);
          return;
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      const isEditableTarget =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isEditableTarget || e.metaKey || e.ctrlKey || e.altKey) return;

      const anyModalOpen =
        isQuickCommandOpen ||
        isAccountSwitcherOpen ||
        isPlaybookModalOpen ||
        isAddTradeModalOpen ||
        isAuthModalOpen ||
        isAccountModalOpen ||
        isSupabaseConfigOpen ||
        Boolean(tradeForDelete) ||
        Boolean(screenshotModal);
      if (anyModalOpen) return;

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setEditingTrade(null);
        setSelectedPlaybookForTrade(null);
        setIsAddTradeModalOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        handleNavigateTab('trades');
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('vlo:focus-trade-search'));
        }, 60);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    isQuickCommandOpen,
    isAccountSwitcherOpen,
    isPlaybookModalOpen,
    isAddTradeModalOpen,
    isAuthModalOpen,
    isAccountModalOpen,
    isSupabaseConfigOpen,
    tradeForDelete,
    screenshotModal,
    handleNavigateTab,
  ]);

  // Save trades handler: writes directly to Supabase public.trades if logged in
  const handleSaveTrade = async (
    tradeToSave: Trade,
    originalId?: string,
    options?: { stayOnCurrentTab?: boolean }
  ): Promise<{
    success: boolean;
    error?: string;
    ignored?: boolean;
    uploadedScreenshotPath?: string;
  }> => {
    if (isSavingTradeRef.current) {
      return { success: false, ignored: true };
    }
    isSavingTradeRef.current = true;

    let uploadedScreenshotPath: string | undefined = undefined;

    try {
      const targetOriginalId = originalId || editingTrade?.id;
      const isEdit = Boolean(targetOriginalId);
      const finalTrade = { ...tradeToSave };

      // Duplicate ID guard against latest tradesRef.current: ensure no other trade shares the new ID
      const latestTradesBeforeSave = tradesRef.current;
      const isDuplicate = latestTradesBeforeSave.some(
        (t) =>
          t.id.toLowerCase() === finalTrade.id.toLowerCase() &&
          (!targetOriginalId || t.id.toLowerCase() !== targetOriginalId.toLowerCase())
      );
      if (isDuplicate) {
        const duplicateMsg = tr(
          `ID Transaksi "${finalTrade.id}" sudah digunakan oleh transaksi lain. Gunakan ID unik.`,
          `Trade ID "${finalTrade.id}" is already used by another trade. Please use a unique ID.`
        );
        showToast(duplicateMsg, 'error');
        return { success: false, error: duplicateMsg };
      }

      // Verify authenticated user id safely (never blocks when offline)
      const verifiedUserId = await resolveEffectiveCloudUserId();

      // Identify existing trade record in store (works for both TradeForm and TradeDetailModal updates)
      const existingTradeRecord =
        tradesRef.current.find(
          (t) =>
            t.id.toLowerCase() ===
            (targetOriginalId || finalTrade.id).toLowerCase()
        ) || editingTrade;

      const previousStoragePaths = isEdit
        ? extractAllTradeStoragePaths(existingTradeRecord)
        : [];

      let queuedOfflineForCloud = Boolean(verifiedUserId && !isBrowserOnline());

      // If user is logged in and online, upload NEW base64 screenshots to private Storage first.
      if (
        verifiedUserId &&
        !queuedOfflineForCloud &&
        finalTrade.screenshotUrl &&
        finalTrade.screenshotUrl.startsWith('data:image/')
      ) {
        const rawBase64 = finalTrade.screenshotUrl;
        setIsCloudSyncing(true);
        const uploadRes = await uploadScreenshotToSupabase(
          rawBase64,
          finalTrade.id,
          verifiedUserId
        );
        setIsCloudSyncing(false);

        if (!uploadRes.success || !uploadRes.data) {
          if (isLikelyOfflineOrNetworkError(uploadRes.error)) {
            queuedOfflineForCloud = true;
          } else {
            const uploadErrMsg = `Gagal mengunggah screenshot ke Storage: ${uploadRes.error}. Data formulir Anda tetap tersimpan.`;
            showToast(uploadErrMsg, 'error');
            return { success: false, error: uploadErrMsg };
          }
        } else {
          finalTrade.screenshotUrl = uploadRes.data;
          uploadedScreenshotPath = uploadRes.data;
        }
      }

      // Also upload/deduplicate BEFORE & AFTER TRADE screenshots in [TV_META] if present
      if (finalTrade.executionNotes) {
        const decodedMeta = decodeLifecycleMetaFromExecutionNotes(finalTrade.executionNotes);
        if (Object.keys(decodedMeta).length > 0) {
          let metaChanged = false;
          const nextMeta = { ...decodedMeta };
          const mainUrl = finalTrade.screenshotUrl ? finalTrade.screenshotUrl.trim() : '';

          if (nextMeta.beforeScreenshotUrl) {
            const beforeTrimmed = nextMeta.beforeScreenshotUrl.trim();
            if (beforeTrimmed === mainUrl || (uploadedScreenshotPath && beforeTrimmed.startsWith('data:image/'))) {
              delete nextMeta.beforeScreenshotUrl;
              metaChanged = true;
            } else if (verifiedUserId && !queuedOfflineForCloud && beforeTrimmed.startsWith('data:image/')) {
              setIsCloudSyncing(true);
              const beforeUploadRes = await uploadScreenshotToSupabase(
                beforeTrimmed,
                `${finalTrade.id}_before`,
                verifiedUserId
              );
              setIsCloudSyncing(false);
              if (!beforeUploadRes.success || !beforeUploadRes.data) {
                if (isLikelyOfflineOrNetworkError(beforeUploadRes.error)) {
                  queuedOfflineForCloud = true;
                } else {
                  const beforeErrMsg = `Gagal mengunggah screenshot Before Trade ke Storage: ${beforeUploadRes.error}.`;
                  showToast(beforeErrMsg, 'error');
                  return { success: false, error: beforeErrMsg };
                }
              } else {
                nextMeta.beforeScreenshotUrl = beforeUploadRes.data;
                metaChanged = true;
              }
            }
          }

          if (
            verifiedUserId &&
            !queuedOfflineForCloud &&
            nextMeta.afterScreenshotUrl &&
            nextMeta.afterScreenshotUrl.startsWith('data:image/')
          ) {
            setIsCloudSyncing(true);
            const afterUploadRes = await uploadScreenshotToSupabase(
              nextMeta.afterScreenshotUrl,
              `${finalTrade.id}_after`,
              verifiedUserId
            );
            setIsCloudSyncing(false);
            if (!afterUploadRes.success || !afterUploadRes.data) {
              if (isLikelyOfflineOrNetworkError(afterUploadRes.error)) {
                queuedOfflineForCloud = true;
              } else {
                const afterErrMsg = `Gagal mengunggah screenshot After Trade ke Storage: ${afterUploadRes.error}.`;
                showToast(afterErrMsg, 'error');
                return { success: false, error: afterErrMsg };
              }
            } else {
              nextMeta.afterScreenshotUrl = afterUploadRes.data;
              metaChanged = true;
            }
          }
          if (metaChanged) {
            finalTrade.executionNotes = encodeLifecycleMetaIntoExecutionNotes(
              finalTrade.executionNotes,
              nextMeta
            );
          }
        }
      }

      const activeStoragePathsOnFinalTrade = new Set(extractAllTradeStoragePaths(finalTrade));
      const oldStoragePathsToClean = previousStoragePaths.filter(
        (p) => !activeStoragePathsOnFinalTrade.has(p)
      );

      // If user is logged in and online, persist to Supabase public.trades
      if (verifiedUserId && !queuedOfflineForCloud) {
        setIsCloudSyncing(true);
        const cloudResult = isEdit
          ? await updateTradeInSupabase(finalTrade, verifiedUserId, targetOriginalId)
          : await insertTradeToSupabase(finalTrade, verifiedUserId);
        setIsCloudSyncing(false);

        if (!cloudResult.success) {
          if (isLikelyOfflineOrNetworkError(cloudResult.error)) {
            queuedOfflineForCloud = true;
          } else {
            const dbErrMsg = `Gagal memperbarui VLO Cloud: ${cloudResult.error}`;
            showToast(dbErrMsg, 'error');
            return {
              success: false,
              error: dbErrMsg,
              uploadedScreenshotPath,
            };
          }
        } else {
          // Clean up any replaced/deleted storage files ONLY after database update is confirmed successful
          for (const oldPath of oldStoragePathsToClean) {
            deleteScreenshotFromSupabase(oldPath).catch((err) => {
              console.warn('Peringatan: Gagal membersihkan screenshot lama dari storage:', err);
            });
          }
        }
      }

      // Update in-memory state and local storage cache
      // Read from tradesRef.current to prevent stale closure overwrites after async awaits
      const currentTrades = tradesRef.current;
      let existingIndex = -1;
      if (targetOriginalId) {
        existingIndex = currentTrades.findIndex(
          (t) => t.id.toLowerCase() === targetOriginalId.toLowerCase()
        );
      }
      if (existingIndex === -1) {
        existingIndex = currentTrades.findIndex(
          (t) => t.id.toLowerCase() === finalTrade.id.toLowerCase()
        );
      }

      let updatedTrades: Trade[];
      if (existingIndex >= 0) {
        updatedTrades = [...currentTrades];
        updatedTrades[existingIndex] = finalTrade;
      } else {
        updatedTrades = [finalTrade, ...currentTrades];
      }

      // Guest / Local Mode OR Authenticated Offline Queue fallback: local persistence is authoritative
      if (!verifiedUserId || queuedOfflineForCloud) {
        const targetScopeUserId = verifiedUserId || null;
        const localSaveResult = saveStoredTrades(updatedTrades, targetScopeUserId);
        if (!localSaveResult.success) {
          const failMsg = localSaveResult.error || 'Gagal menyimpan transaksi ke penyimpanan lokal.';
          showToast(failMsg, 'error');
          return {
            success: false,
            error: failMsg,
            uploadedScreenshotPath,
          };
        }

        let queuedTotal = 0;
        if (verifiedUserId && queuedOfflineForCloud) {
          const queueRes = enqueueOfflineTradeUpsert(verifiedUserId, finalTrade, {
            isEdit,
            originalId: targetOriginalId,
          });
          if (!queueRes.success) {
            const qErr = queueRes.error || 'Gagal menambahkan ke antrean sinkronisasi offline.';
            showToast(qErr, 'error');
            return {
              success: false,
              error: qErr,
              uploadedScreenshotPath,
            };
          }
          queuedTotal = queueRes.queueLength;
          setDataSource('local_fallback');
        }

        // Local save strictly confirmed: now commit to in-memory state and navigate
        tradesRef.current = updatedTrades;
        setTrades(updatedTrades);
        setEditingTrade(null);
        setIsAddTradeModalOpen(false);
        if (
          tradeForDetail &&
          (tradeForDetail.id.toLowerCase() === finalTrade.id.toLowerCase() ||
            (targetOriginalId && tradeForDetail.id.toLowerCase() === targetOriginalId.toLowerCase()))
        ) {
          setTradeForDetail(finalTrade);
        }
        if (!options?.stayOnCurrentTab && activeTabRef.current !== 'detail') {
          handleNavigateTab('trades');
        }
        pushTradeNotification(finalTrade, isEdit ? 'updated' : 'created', existingTradeRecord, isEn);
        if (verifiedUserId && queuedOfflineForCloud) {
          showToast(
            tr(
              `Transaksi ${finalTrade.id} tersimpan offline (${queuedTotal} antrean). Akan otomatis sinkron ke Cloud saat online.`,
              `Trade ${finalTrade.id} saved offline (${queuedTotal} queued). Will auto-sync to Cloud once online.`
            )
          );
        } else {
          showToast(
            isEdit
              ? tr(
                  `Transaksi ${finalTrade.id} berhasil diperbarui (Lokal).`,
                  `Trade ${finalTrade.id} updated successfully (Local).`
                )
              : tr(
                  `Transaksi ${finalTrade.id} berhasil dicatat ke jurnal lokal!`,
                  `Trade ${finalTrade.id} logged to local journal!`
                )
          );
        }
        return { success: true, uploadedScreenshotPath };
      }

      // Authenticated Mode: Cloud persistence confirmed above; now update state & offline cache
      tradesRef.current = updatedTrades;
      setTrades(updatedTrades);

      const cacheResult = saveStoredTrades(updatedTrades, verifiedUserId);
      if (!cacheResult.success) {
        showToast(
          cacheResult.error ||
            tr(
              'Peringatan: Gagal memperbarui cache luring lokal.',
              'Warning: Failed to update local offline cache.'
            ),
          'error'
        );
      }

      setEditingTrade(null);
      setIsAddTradeModalOpen(false);
      if (
        tradeForDetail &&
        (tradeForDetail.id.toLowerCase() === finalTrade.id.toLowerCase() ||
          (targetOriginalId && tradeForDetail.id.toLowerCase() === targetOriginalId.toLowerCase()))
      ) {
        setTradeForDetail(finalTrade);
      }
      if (!options?.stayOnCurrentTab && activeTabRef.current !== 'detail') {
        handleNavigateTab('trades');
      }
      pushTradeNotification(finalTrade, isEdit ? 'updated' : 'created', existingTradeRecord, isEn);
      showToast(
        isEdit
          ? tr(
              `Transaksi ${finalTrade.id} berhasil diperbarui di VLO Cloud!`,
              `Trade ${finalTrade.id} updated in VLO Cloud!`
            )
          : tr(
              `Transaksi ${finalTrade.id} berhasil disimpan ke VLO Cloud!`,
              `Trade ${finalTrade.id} saved to VLO Cloud!`
            )
      );

      return { success: true, uploadedScreenshotPath };
    } catch (err: any) {
      const unexpectedMsg =
        err?.message ||
        tr(
          'Terjadi kesalahan tak terduga saat menyimpan transaksi. Silakan coba lagi.',
          'An unexpected error occurred while saving the trade. Please try again.'
        );
      showToast(unexpectedMsg, 'error');
      return {
        success: false,
        error: unexpectedMsg,
        uploadedScreenshotPath,
      };
    } finally {
      setIsCloudSyncing(false);
      isSavingTradeRef.current = false;
    }
  };

  // Delete trade handler: deletes from Supabase public.trades if logged in
  const handleConfirmDelete = async () => {
    if (!tradeForDelete || isDeletingTradeRef.current) return;
    isDeletingTradeRef.current = true;

    const targetTrade = tradeForDelete;
    const deletedId = targetTrade.id;
    const isDemoTradeItem = Boolean(targetTrade.isDemo);

    try {
      // Verify authenticated user id safely (never blocks when offline)
      const verifiedUserId = await resolveEffectiveCloudUserId();
      let queuedDeleteOffline = Boolean(verifiedUserId && !isDemoTradeItem && !isBrowserOnline());

      // If logged in and online, delete row from Supabase
      if (verifiedUserId && !queuedDeleteOffline) {
        if (!isDemoTradeItem) {
          setIsCloudSyncing(true);
          const deleteResult = await deleteTradeFromSupabase(deletedId, verifiedUserId);
          setIsCloudSyncing(false);

          if (!deleteResult.success) {
            if (isLikelyOfflineOrNetworkError(deleteResult.error)) {
              queuedDeleteOffline = true;
            } else {
              showToast(`Gagal menghapus dari VLO Cloud: ${deleteResult.error}`, 'error');
              return;
            }
          } else {
            // Clean up all private storage files (Before & After) ONLY after database deletion is confirmed successful
            for (const storagePath of extractAllTradeStoragePaths(targetTrade)) {
              try {
                await deleteScreenshotFromSupabase(storagePath);
              } catch (err) {
                console.warn(
                  `Peringatan: Gagal menghapus file storage "${storagePath}":`,
                  err
                );
              }
            }
          }
        } else if (isBrowserOnline()) {
          // If it's a demo trade, try to remove from cloud if previously synced, but don't error out if local-only
          try {
            await deleteTradeFromSupabase(deletedId, verifiedUserId);
          } catch {
            // ignore
          }
        }
      }

      // Use latest tradesRef.current to prevent stale closure overwrites after adjacent state updates
      const previousLatest = tradesRef.current;
      const filtered = removeTradeFromLatestList(tradesRef, deletedId);
      const saveResult = saveStoredTrades(filtered, verifiedUserId || currentUser?.id || null);
      if (!saveResult.success) {
        tradesRef.current = previousLatest;
        showToast(saveResult.error || 'Gagal menghapus data lokal.', 'error');
        return;
      }

      let queuedCount = 0;
      if (verifiedUserId && queuedDeleteOffline) {
        const qRes = enqueueOfflineTradeDelete(
          verifiedUserId,
          deletedId,
          extractAllTradeStoragePaths(targetTrade)
        );
        queuedCount = qRes.queueLength;
        setDataSource('local_fallback');
      }

      setTrades(filtered);
      setTradeForDelete(null);
      if (tradeForDetail?.id === deletedId) {
        setTradeForDetail(null);
        if (activeTabRef.current === 'detail') {
          handleNavigateTab('trades');
        }
      }

      if (verifiedUserId && queuedDeleteOffline) {
        showToast(
          tr(
            `Transaksi ${deletedId} dihapus secara lokal (${queuedCount} antrean sinkronisasi Cloud).`,
            `Trade ${deletedId} deleted locally (${queuedCount} queued for Cloud sync).`
          )
        );
      } else if (verifiedUserId && !isDemoTradeItem) {
        showToast(
          tr(
            `Transaksi ${deletedId} berhasil dihapus dari VLO Cloud.`,
            `Trade ${deletedId} deleted from VLO Cloud.`
          )
        );
      } else {
        showToast(
          tr(`Transaksi ${deletedId} telah dihapus.`, `Trade ${deletedId} has been deleted.`)
        );
      }
    } finally {
      setIsCloudSyncing(false);
      isDeletingTradeRef.current = false;
    }
  };

  // Batch delete trades by date (supports Journal DateGroupCard and Dashboard/Analytics Calendar)
  const handleConfirmBatchDeleteByDate = async () => {
    if (
      !batchDeleteRequest ||
      !Array.isArray(batchDeleteRequest.trades) ||
      batchDeleteRequest.trades.length === 0 ||
      isDeletingTradeRef.current
    ) {
      return;
    }

    isDeletingTradeRef.current = true;
    const requestSnapshot = batchDeleteRequest;
    const targetTrades = requestSnapshot.trades;
    const targetIds = new Set(targetTrades.map((t) => t.id));
    const targetIdsLower = new Set(targetTrades.map((t) => t.id.toLowerCase()));
    const realCloudTrades = targetTrades.filter((t) => !t.isDemo);
    const dateLabel =
      requestSnapshot.headerLabel && requestSnapshot.headerLabel !== requestSnapshot.dateKey
        ? `${requestSnapshot.headerLabel} (${requestSnapshot.dateKey})`
        : requestSnapshot.dateKey;

    try {
      const verifiedUserId = await resolveEffectiveCloudUserId();
      let queuedDeleteOffline = Boolean(
        verifiedUserId && realCloudTrades.length > 0 && !isBrowserOnline()
      );

      if (verifiedUserId && realCloudTrades.length > 0 && !queuedDeleteOffline) {
        const remainingTrades = tradesRef.current.filter((t) => !targetIds.has(t.id));
        const keepScreenshotPaths = new Set<string>();
        for (const rem of remainingTrades) {
          for (const pathItem of extractAllTradeStoragePaths(rem)) {
            keepScreenshotPaths.add(pathItem);
          }
        }

        setIsCloudSyncing(true);
        const cloudDeleteRes = await deleteTradesListFromSupabase(
          realCloudTrades,
          verifiedUserId,
          keepScreenshotPaths
        );
        setIsCloudSyncing(false);

        if (!cloudDeleteRes.success) {
          if (isLikelyOfflineOrNetworkError(cloudDeleteRes.error)) {
            queuedDeleteOffline = true;
          } else {
            showToast(`Gagal menghapus dari VLO Cloud: ${cloudDeleteRes.error}`, 'error');
            return;
          }
        } else {
          // Prune any stale offline queue operations targeting these now-deleted trades
          const existingQueue = loadOfflineSyncQueue(verifiedUserId);
          if (existingQueue.length > 0) {
            const cleanedQueue = existingQueue.filter((op) => {
              if (op.kind === 'delete_trade') {
                return !targetIdsLower.has(op.tradeId.toLowerCase());
              }
              if (op.kind === 'upsert_trade') {
                const opCurr = op.trade.id.toLowerCase();
                const opOrig = (op.originalId || op.trade.id).toLowerCase();
                return !targetIdsLower.has(opCurr) && !targetIdsLower.has(opOrig);
              }
              return true;
            });
            if (cleanedQueue.length !== existingQueue.length) {
              saveOfflineSyncQueue(verifiedUserId, cleanedQueue);
            }
          }
        }
      }

      const previousLatest = tradesRef.current;
      const filtered = removeTradesListFromLatestList(tradesRef, targetIds);
      const saveResult = saveStoredTrades(filtered, verifiedUserId || currentUser?.id || null);
      if (!saveResult.success) {
        tradesRef.current = previousLatest;
        showToast(saveResult.error || 'Gagal menghapus data lokal.', 'error');
        return;
      }

      let queuedCount = 0;
      if (verifiedUserId && queuedDeleteOffline) {
        for (const item of realCloudTrades) {
          const qRes = enqueueOfflineTradeDelete(
            verifiedUserId,
            item.id,
            extractAllTradeStoragePaths(item)
          );
          queuedCount = qRes.queueLength;
        }
        setDataSource('local_fallback');
      }

      setTrades(filtered);
      setBatchDeleteRequest(null);
      if (tradeForDetail && targetIds.has(tradeForDetail.id)) {
        setTradeForDetail(null);
        if (activeTabRef.current === 'detail') {
          handleNavigateTab('trades');
        }
      }

      if (verifiedUserId && queuedDeleteOffline) {
        showToast(
          tr(
            `${targetTrades.length} transaksi pada ${dateLabel} dihapus lokal (${queuedCount} antrean sinkronisasi Cloud).`,
            `${targetTrades.length} trades on ${dateLabel} deleted locally (${queuedCount} queued for Cloud sync).`
          )
        );
      } else if (verifiedUserId && realCloudTrades.length > 0) {
        showToast(
          tr(
            `${targetTrades.length} transaksi pada ${dateLabel} berhasil dihapus dari VLO Cloud.`,
            `${targetTrades.length} trades on ${dateLabel} deleted from VLO Cloud.`
          )
        );
      } else {
        showToast(
          tr(
            `${targetTrades.length} transaksi pada ${dateLabel} telah dihapus.`,
            `${targetTrades.length} trades on ${dateLabel} have been deleted.`
          )
        );
      }
    } finally {
      setIsCloudSyncing(false);
      isDeletingTradeRef.current = false;
    }
  };

  // Manual trigger to upload local trades to Supabase cloud
  const handleSyncLocalToCloud = async () => {
    let verifiedUserId: string | null = null;
    if (currentUser) {
      const { user } = await getCurrentUser();
      if (user?.id) {
        verifiedUserId = user.id;
      }
    }

    if (!verifiedUserId) {
      showToast(
        tr(
          'Harap masuk terlebih dahulu untuk sinkronisasi ke cloud.',
          'Please sign in first to sync to the cloud.'
        ),
        'error'
      );
      return;
    }

    const currentTradesToSync = tradesRef.current;
    if (currentTradesToSync.length === 0) {
      showToast(
        tr('Tidak ada transaksi untuk disinkronkan.', 'No trades available to sync.'),
        'error'
      );
      return;
    }

    setIsCloudSyncing(true);
    try {
      const res = await migrateLocalTradesToSupabase(currentTradesToSync, verifiedUserId);

      // Update state & localStorage with synced storage paths for succeeded trades
      // while preserving original Base64 screenshots for any failed trades
      if (res.syncedTrades && res.syncedTrades.length > 0) {
        tradesRef.current = res.syncedTrades;
        setTrades(res.syncedTrades);
        saveStoredTrades(res.syncedTrades, verifiedUserId);
      }

      if (res.success && res.failedCount === 0) {
        setDataSource('cloud');
        setCloudLoadError(null);
        showToast(
          tr(
            `Berhasil menyinkronkan seluruh (${res.count}) transaksi ke VLO Cloud!`,
            `Successfully synced all (${res.count}) trades to VLO Cloud!`
          )
        );
      } else if (res.count > 0 && res.failedCount > 0) {
        setDataSource('local_fallback');
        showToast(
          tr(
            `Sinkronisasi parsial: ${res.count} berhasil, ${res.failedCount} gagal (${res.error})`,
            `Partial sync: ${res.count} succeeded, ${res.failedCount} failed (${res.error})`
          ),
          'error'
        );
      } else {
        setDataSource('local_fallback');
        showToast(
          tr(`Gagal menyinkronkan ke cloud: ${res.error}`, `Failed to sync to cloud: ${res.error}`),
          'error'
        );
      }
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Manual trigger to push any pending offline queue and reload fresh trades from Supabase cloud
  const handleReloadFromCloud = async () => {
    const verifiedUserId = await resolveEffectiveCloudUserId();

    if (!verifiedUserId) {
      showToast(tr('Harap masuk terlebih dahulu.', 'Please sign in first.'), 'error');
      return;
    }

    if (!isBrowserOnline()) {
      showToast(
        tr(
          'Perangkat sedang offline. Sinkronisasi cloud akan berjalan otomatis saat internet terhubung kembali.',
          'Device is offline. Cloud sync will resume automatically once internet reconnects.'
        ),
        'error'
      );
      return;
    }

    const flushResult = await flushOfflineSyncQueue(verifiedUserId, { silent: true });

    setIsCloudSyncing(true);
    setCloudLoadError(null);
    const [result, settingsResult] = await Promise.all([
      fetchTradesFromSupabase(verifiedUserId),
      loadUserSettingsWithFallback(verifiedUserId, fetchSettingsFromSupabase),
    ]);
    setIsCloudSyncing(false);

    // Race condition guard: ignore if user changed during fetch
    if (currentUser?.id !== verifiedUserId) {
      return;
    }

    setSettings(settingsResult.settings);
    const remainingQueue = loadOfflineSyncQueue(verifiedUserId);

    if (result.success && result.data) {
      setCloudLoadError(null);
      const mergedTrades = applyPendingQueueToTrades(result.data, remainingQueue);
      setDataSource(remainingQueue.length > 0 ? 'local_fallback' : 'cloud');
      tradesRef.current = mergedTrades;
      setTrades(mergedTrades);
      saveStoredTrades(mergedTrades, verifiedUserId);

      if (flushResult.flushed > 0) {
        showToast(
          tr(
            `${flushResult.flushed} perubahan offline disinkronkan & ${mergedTrades.length} transaksi dimuat dari VLO Cloud!`,
            `${flushResult.flushed} offline changes synced & ${mergedTrades.length} trades loaded from VLO Cloud!`
          )
        );
      } else if (mergedTrades.length > 0) {
        showToast(
          tr(
            `Berhasil memuat ${mergedTrades.length} transaksi dari VLO Cloud!`,
            `Successfully loaded ${mergedTrades.length} trades from VLO Cloud!`
          )
        );
      } else {
        showToast(
          tr(
            'Terhubung ke VLO Cloud. Akun ini belum memiliki transaksi cloud.',
            'Connected to VLO Cloud. This account has no cloud trades yet.'
          )
        );
      }
    } else {
      setCloudLoadError(
        result.error ||
          tr('Gagal memuat transaksi dari VLO Cloud.', 'Failed to load trades from VLO Cloud.')
      );
      setDataSource('local_fallback');
      const fallbackTrades = applyPendingQueueToTrades(
        loadStoredTrades(verifiedUserId),
        remainingQueue
      );
      tradesRef.current = fallbackTrades;
      setTrades(fallbackTrades);
      showToast(
        tr(
          `Gagal memuat dari VLO Cloud: ${result.error}. Menggunakan cache luring akun ini (${fallbackTrades.length} transaksi).`,
          `Failed to load from VLO Cloud: ${result.error}. Using offline cache for this account (${fallbackTrades.length} trades).`
        ),
        'error'
      );
    }
  };

  // Clear DEMO data handler with protective feedback and Supabase cloud cleanup
  const handleConfirmClearDemoTrades = async () => {
    const currentList = tradesRef.current;
    const demoTrades = currentList.filter((t) => isDemoTrade(t));
    const realTrades = currentList.filter((t) => !isDemoTrade(t));
    const demoCount = demoTrades.length;

    let verifiedUserId: string | null = null;
    if (currentUser) {
      const { user } = await getCurrentUser();
      verifiedUserId = user?.id || currentUser.id || null;
    }

    if (verifiedUserId && demoTrades.length > 0) {
      setIsCloudSyncing(true);
      try {
        const keepScreenshotPaths = new Set(
          realTrades
            .map((t) => (t.screenshotUrl ? String(t.screenshotUrl).trim() : ''))
            .filter(Boolean)
        );
        const cloudDel = await deleteTradesListFromSupabase(
          demoTrades,
          verifiedUserId,
          keepScreenshotPaths
        );
        if (!cloudDel.success) {
          showToast(
            cloudDel.error || 'Gagal menghapus transaksi DEMO dari database cloud.',
            'error'
          );
          return;
        }
      } finally {
        setIsCloudSyncing(false);
      }
    }

    const saveResult = saveStoredTrades(realTrades, verifiedUserId || currentUser?.id || null);
    if (saveResult.success) {
      tradesRef.current = realTrades;
      setTrades(realTrades);
      showToast(
        tr(
          `${demoCount} transaksi DEMO berhasil dibersihkan. Data asli Anda tetap aman.`,
          `${demoCount} DEMO trades cleared. Your real trades remain safe.`
        )
      );
    } else {
      showToast(tr('Gagal membersihkan data demo.', 'Failed to clear demo data.'), 'error');
    }
  };

  // Load DEMO trades without deleting real trades (and sync to cloud if logged in)
  const handleLoadDemoTrades = async () => {
    const nonDemo = tradesRef.current.filter((t) => !isDemoTrade(t));
    const demoCopies = DEMO_TRADES.map((t) => ({ ...t, isDemo: true }));
    const nextTrades = [...nonDemo, ...demoCopies];

    let verifiedUserId: string | null = null;
    if (currentUser) {
      const { user } = await getCurrentUser();
      verifiedUserId = user?.id || currentUser.id || null;
    }

    const saveResult = saveStoredTrades(nextTrades, verifiedUserId || currentUser?.id || null);
    if (!saveResult.success) {
      showToast(
        saveResult.error ||
          tr(
            'Gagal memuat data demo ke penyimpanan lokal.',
            'Failed to load demo data into local storage.'
          ),
        'error'
      );
      return;
    }

    tradesRef.current = nextTrades;
    setTrades(nextTrades);

    if (verifiedUserId) {
      setIsCloudSyncing(true);
      try {
        const syncRes = await migrateLocalTradesToSupabase(demoCopies, verifiedUserId);
        if (syncRes.success) {
          showToast(
            tr(
              `Berhasil memuat ${DEMO_TRADES.length} transaksi DEMO dan menyinkronkannya ke cloud.`,
              `Loaded ${DEMO_TRADES.length} DEMO trades and synced them to the cloud.`
            )
          );
        } else {
          showToast(
            tr(
              `Data DEMO dimuat secara lokal, namun sinkronisasi cloud mengalami kendala: ${syncRes.error}`,
              `DEMO data loaded locally, but cloud sync encountered an issue: ${syncRes.error}`
            ),
            'error'
          );
        }
      } finally {
        setIsCloudSyncing(false);
      }
    } else {
      showToast(
        tr(
          `Berhasil memuat ${DEMO_TRADES.length} transaksi contoh DEMO.`,
          `Successfully loaded ${DEMO_TRADES.length} sample DEMO trades.`
        )
      );
    }
  };

  // Clear ALL trades (both local state/storage and Supabase cloud when logged in)
  const handleClearAllTrades = async () => {
    const previousTrades = [...tradesRef.current];

    let verifiedUserId: string | null = null;
    if (currentUser) {
      const { user } = await getCurrentUser();
      verifiedUserId = user?.id || currentUser.id || null;
    }

    if (verifiedUserId) {
      setIsCloudSyncing(true);
      try {
        const cloudClear = await deleteObsoleteTradesFromSupabase([], previousTrades, verifiedUserId);
        if (!cloudClear.success) {
          showToast(
            cloudClear.error ||
              tr(
                'Gagal menghapus seluruh transaksi dari VLO Cloud.',
                'Failed to delete all trades from VLO Cloud.'
              ),
            'error'
          );
          return;
        }
      } finally {
        setIsCloudSyncing(false);
      }
    }

    const saveResult = saveStoredTrades([], verifiedUserId || currentUser?.id || null);
    if (saveResult.success) {
      tradesRef.current = [];
      setTrades([]);
      setTradeForDetail(null);
      showToast(
        tr(
          'Seluruh riwayat transaksi berhasil dihapus hingga bersih.',
          'All trade history has been completely cleared.'
        )
      );
    } else {
      showToast(
        saveResult.error ||
          tr('Gagal mereset penyimpanan lokal.', 'Failed to reset local storage.'),
        'error'
      );
    }
  };

  // Import CSV trades with canonical merge/replace and automatic Supabase cloud sync
  const handleImportCsvTrades = async (importedTrades: Trade[], mode: 'merge' | 'replace') => {
    const previousTrades = [...tradesRef.current];
    const activeOwnerScope = currentUser?.id || 'GUEST';
    const { finalTrades } = mergeTradesDatasets(previousTrades, importedTrades, mode, activeOwnerScope);


    let verifiedUserId: string | null = null;
    if (currentUser) {
      const { user } = await getCurrentUser();
      verifiedUserId = user?.id || currentUser.id || null;
    }

    const saveResult = saveStoredTrades(finalTrades, verifiedUserId || currentUser?.id || null);
    if (!saveResult.success && !verifiedUserId) {
      showToast(saveResult.error || 'Gagal menyimpan hasil impor CSV ke browser.', 'error');
      return;
    }

    tradesRef.current = finalTrades;
    setTrades(finalTrades);

    if (verifiedUserId) {
      setIsCloudSyncing(true);
      try {
        const syncRes = await migrateLocalTradesToSupabase(finalTrades, verifiedUserId);
        if (syncRes.syncedTrades) {
          tradesRef.current = syncRes.syncedTrades;
          setTrades(syncRes.syncedTrades);
          saveStoredTrades(syncRes.syncedTrades, verifiedUserId);
        }

        if (syncRes.success && syncRes.failedCount === 0) {
          if (mode === 'replace') {
            const cleanupRes = await deleteObsoleteTradesFromSupabase(
              syncRes.syncedTrades,
              previousTrades,
              verifiedUserId
            );
            if (!cleanupRes.success) {
              showToast(
                `Data CSV tersimpan, namun gagal membersihkan transaksi lama di cloud: ${cleanupRes.error}`,
                'error'
              );
              return;
            }
          }
          setDataSource('cloud');
          setCloudLoadError(null);
          showToast(
            mode === 'replace'
              ? `Berhasil menggantikan jurnal dengan ${importedTrades.length} trade CSV dan menyinkronkannya ke cloud!`
              : `Berhasil menggabungkan ${importedTrades.length} trade CSV dan menyinkronkannya ke cloud!`
          );
        } else {
          setDataSource('local_fallback');
          showToast(
            `Impor CSV tersimpan di browser, namun sinkronisasi cloud terkendala: ${syncRes.error}`,
            'error'
          );
        }
      } finally {
        setIsCloudSyncing(false);
      }
    } else {
      showToast(
        mode === 'replace'
          ? `Berhasil menggantikan jurnal dengan ${importedTrades.length} trade dari CSV!`
          : `Berhasil menggabungkan ${importedTrades.length} trade dari CSV!`
      );
    }
  };

  // Batch import trades from Scan Kilat Riwayat MT5 (supports both Local Mode and Cloud Sync)
  const handleImportBatchTrades = async (
    newTrades: Trade[]
  ): Promise<{ success: boolean; error?: string; importedCount?: number }> => {
    if (!Array.isArray(newTrades) || newTrades.length === 0) {
      return { success: false, error: tr('Tidak ada transaksi untuk diimpor.', 'No trades to import.') };
    }

    const existingIds = new Set(tradesRef.current.map((t) => t.id.toLowerCase()));
    const sanitizedBatch: Trade[] = [];
    for (const item of newTrades) {
      let id = item.id;
      while (existingIds.has(id.toLowerCase())) {
        id = `TRD-${Math.floor(100000 + Math.random() * 900000)}`;
      }
      existingIds.add(id.toLowerCase());
      sanitizedBatch.push({ ...item, id });
    }

    const verifiedUserId = await resolveEffectiveCloudUserId();

    if (!verifiedUserId) {
      const updatedTrades = [...sanitizedBatch, ...tradesRef.current];
      const saveResult = saveStoredTrades(updatedTrades, null);
      if (!saveResult.success) {
        const err =
          saveResult.error ||
          tr('Gagal menyimpan transaksi MT5 ke penyimpanan lokal.', 'Failed to save MT5 trades locally.');
        showToast(err, 'error');
        return { success: false, error: err };
      }
      tradesRef.current = updatedTrades;
      setTrades(updatedTrades);
      pushBatchTradesNotification(sanitizedBatch, isEn);
      showToast(
        tr(
          `${sanitizedBatch.length} transaksi riwayat MT5 berhasil dicatat ke Jurnal!`,
          `${sanitizedBatch.length} MT5 history trades logged to Journal!`
        )
      );
      return { success: true, importedCount: sanitizedBatch.length };
    }

    // Authenticated offline path: persist locally + enqueue all imported trades for auto Cloud sync
    if (!isBrowserOnline()) {
      const updatedTrades = [...sanitizedBatch, ...tradesRef.current];
      const saveResult = saveStoredTrades(updatedTrades, verifiedUserId);
      if (!saveResult.success) {
        const err =
          saveResult.error ||
          tr('Gagal menyimpan transaksi MT5 ke penyimpanan lokal.', 'Failed to save MT5 trades locally.');
        showToast(err, 'error');
        return { success: false, error: err };
      }
      let latestQueueLength = 0;
      for (const item of sanitizedBatch) {
        const qRes = enqueueOfflineTradeUpsert(verifiedUserId, item, { isEdit: false });
        latestQueueLength = qRes.queueLength;
      }
      tradesRef.current = updatedTrades;
      setTrades(updatedTrades);
      setDataSource('local_fallback');
      pushBatchTradesNotification(sanitizedBatch, isEn);
      showToast(
        tr(
          `${sanitizedBatch.length} transaksi MT5 tersimpan offline (${latestQueueLength} antrean sinkronisasi Cloud).`,
          `${sanitizedBatch.length} MT5 trades saved offline (${latestQueueLength} queued for Cloud sync).`
        )
      );
      return { success: true, importedCount: sanitizedBatch.length };
    }

    setIsCloudSyncing(true);
    const savedCloudTrades: Trade[] = [];
    const queuedOfflineTrades: Trade[] = [];
    let firstCloudError: string | undefined = undefined;

    try {
      for (let i = 0; i < sanitizedBatch.length; i++) {
        const item = sanitizedBatch[i];
        const res = await insertTradeToSupabase(item, verifiedUserId);
        if (res.success && res.data) {
          savedCloudTrades.push(res.data);
        } else if (isLikelyOfflineOrNetworkError(res.error)) {
          // Network dropped mid-batch: queue current & remaining trades cleanly
          for (let j = i; j < sanitizedBatch.length; j++) {
            queuedOfflineTrades.push(sanitizedBatch[j]);
          }
          break;
        } else {
          firstCloudError =
            res.error ||
            tr('Gagal menyimpan salah satu transaksi ke Cloud.', 'Failed to save trade to Cloud.');
          break;
        }
      }

      const allImportedTrades = [...queuedOfflineTrades, ...savedCloudTrades];
      if (allImportedTrades.length > 0) {
        const updatedTrades = [...allImportedTrades, ...tradesRef.current];
        tradesRef.current = updatedTrades;
        setTrades(updatedTrades);
        saveStoredTrades(updatedTrades, verifiedUserId);
      }

      if (queuedOfflineTrades.length > 0) {
        for (const item of queuedOfflineTrades) {
          enqueueOfflineTradeUpsert(verifiedUserId, item, { isEdit: false });
        }
        setDataSource('local_fallback');
        pushBatchTradesNotification(allImportedTrades, isEn);
        showToast(
          tr(
            `${allImportedTrades.length} transaksi MT5 dicatat (${queuedOfflineTrades.length} menunggu sinkronisasi Cloud saat online).`,
            `${allImportedTrades.length} MT5 trades logged (${queuedOfflineTrades.length} queued for Cloud sync once online).`
          )
        );
        return { success: true, importedCount: allImportedTrades.length };
      }

      if (firstCloudError) {
        const msg =
          savedCloudTrades.length > 0
            ? tr(
                `${savedCloudTrades.length} trade tersimpan ke Cloud, namun transaksi berikutnya gagal: ${firstCloudError}`,
                `${savedCloudTrades.length} trades saved to Cloud, next trade failed: ${firstCloudError}`
              )
            : firstCloudError;
        showToast(msg, 'error');
        return { success: false, error: msg, importedCount: savedCloudTrades.length };
      }

      setDataSource('cloud');
      setCloudLoadError(null);
      pushBatchTradesNotification(savedCloudTrades, isEn);
      showToast(
        tr(
          `${savedCloudTrades.length} transaksi riwayat MT5 berhasil dicatat & disinkronkan ke Cloud!`,
          `${savedCloudTrades.length} MT5 history trades logged & synced to Cloud!`
        )
      );
      return { success: true, importedCount: savedCloudTrades.length };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Update whole trades array fallback
  const handleUpdateTrades = (newTrades: Trade[]) => {
    const saveResult = saveStoredTrades(newTrades, currentUser?.id || null);
    if (saveResult.success) {
      tradesRef.current = newTrades;
      setTrades(newTrades);
    } else {
      showToast(saveResult.error || 'Gagal menyimpan perubahan trade.', 'error');
    }
  };

  // Restore from JSON or ZIP Backup (with overwrite or merge mode and optional cloud sync)
  const handleRestoreBackupJson = async (
    backupTrades: Trade[],
    backupSettings?: AppSettings,
    mode: 'replace' | 'merge' = 'replace',
    syncToCloud: boolean = false
  ) => {
    const previousTrades = [...tradesRef.current];

    // Preserve any existing local Base64 screenshot mapping before overwriting tradesRef.current
    // in case the restored JSON contains a storage path for the same trade ID.
    const existingById = new Map<string, Trade>(
      previousTrades.map((t) => [t.id.toLowerCase(), t])
    );
    for (const incoming of backupTrades) {
      const incRef = incoming.screenshotUrl?.trim() || '';
      if (incRef && isStoragePath(incRef)) {
        const existingMatch = existingById.get(incoming.id.toLowerCase());
        const existingRef = existingMatch?.screenshotUrl?.trim() || '';
        if (existingRef.startsWith('data:image/')) {
          setCachedBase64ForStoragePath(incRef, existingRef);
        }
      }
    }

    const activeOwnerScope = currentUser?.id || 'GUEST';
    const { finalTrades } = mergeTradesDatasets(previousTrades, backupTrades, mode, activeOwnerScope);


    // Verify authenticated user for cloud sync
    let verifiedUserId: string | null = null;
    if (currentUser) {
      const { user } = await getCurrentUser();
      if (user?.id) {
        verifiedUserId = user.id;
      }
    }

    const tradeSaveRes = saveStoredTrades(finalTrades, verifiedUserId || currentUser?.id || null);
    if (!tradeSaveRes.success && !(verifiedUserId && syncToCloud)) {
      showToast(tradeSaveRes.error || 'Gagal menyimpan data cadangan ke browser.', 'error');
      return { success: false, error: tradeSaveRes.error };
    }
    tradesRef.current = finalTrades;
    setTrades(finalTrades);

    let mergedSettings: AppSettings | undefined;
    if (backupSettings && typeof backupSettings === 'object') {
      mergedSettings = mergeWithExistingSettings(settings, backupSettings);
      saveStoredSettings(mergedSettings, verifiedUserId || currentUser?.id || null);
      setSettings(mergedSettings);
    }

    if (verifiedUserId && syncToCloud) {
      setIsCloudSyncing(true);
      showToast('Menyinkronkan transaksi pemulihan ke VLO Cloud...');

      try {
        const res = await migrateLocalTradesToSupabase(finalTrades, verifiedUserId);

        if (mergedSettings) {
          await saveSettingsToSupabase(mergedSettings, verifiedUserId);
        }

        if (res.syncedTrades) {
          tradesRef.current = res.syncedTrades;
          setTrades(res.syncedTrades);
          saveStoredTrades(res.syncedTrades, verifiedUserId);
          if (tradeForDetail) {
            const updatedDetail = res.syncedTrades.find((t) => t.id === tradeForDetail.id);
            if (updatedDetail) {
              setTradeForDetail(updatedDetail);
            } else if (mode === 'replace') {
              setTradeForDetail(null);
            }
          }
        }

        if (res.success && res.failedCount === 0) {
          if (mode === 'replace') {
            const cleanupRes = await deleteObsoleteTradesFromSupabase(
              res.syncedTrades,
              previousTrades,
              verifiedUserId
            );
            if (!cleanupRes.success) {
              setDataSource('local_fallback');
              showToast(
                `Data baru tersimpan di cloud, namun gagal menghapus transaksi cloud lama: ${cleanupRes.error}`,
                'error'
              );
              return { success: false, error: cleanupRes.error };
            }
          }

          setDataSource('cloud');
          setCloudLoadError(null);
          showToast(
            mode === 'replace'
              ? `Berhasil menggantikan jurnal dengan ${finalTrades.length} trade dan menyinkronkannya ke VLO Cloud!`
              : `Berhasil menggabungkan cadangan (${finalTrades.length} total trade) dan menyinkronkannya ke VLO Cloud!`
          );
        } else if (res.count > 0 && res.failedCount > 0) {
          setDataSource('local_fallback');
          showToast(
            `Pemulihan lokal selesai, namun sinkronisasi cloud parsial: ${res.count} tersimpan, ${res.failedCount} gagal (${res.error}).`,
            'error'
          );
        } else {
          setDataSource('local_fallback');
          showToast(
            `Data berhasil dimuat di browser lokal, namun sinkronisasi ke VLO Cloud gagal: ${res.error}. Transaksi BELUM tersimpan di cloud.`,
            'error'
          );
        }
      } finally {
        setIsCloudSyncing(false);
      }
    } else {
      if (currentUser && !syncToCloud) {
        showToast(
          `Data cadangan (${backupTrades.length} trade) dimuat ke browser lokal. Data BELUM tersimpan di VLO Cloud. Gunakan tombol 'Sinkronkan ke Cloud' untuk mengunggahnya.`,
          'error'
        );
      } else {
        showToast(
          mode === 'replace'
            ? `Berhasil memulihkan seluruh data (${finalTrades.length} trade) dari file backup!`
            : `Berhasil menggabungkan ${backupTrades.length} trade dari cadangan ke jurnal!`
        );
      }
    }
    return { success: true };
  };

  // Update settings handler
  const handleUpdateSettings = (newSettings: AppSettings) => {
    const normalized = mergeWithExistingSettings(settings, newSettings);
    const saveResult = saveStoredSettings(normalized, currentUser?.id || null);
    if (saveResult.success) {
      setSettings(normalized);
      if (currentUser?.id) {
        const uid = currentUser.id;
        if (!isBrowserOnline()) {
          enqueueOfflineSettingsUpdate(uid, normalized);
        } else {
          saveSettingsToSupabase(normalized, uid)
            .then((savedOk) => {
              if (!savedOk) {
                enqueueOfflineSettingsUpdate(uid, normalized);
              }
            })
            .catch(() => {
              enqueueOfflineSettingsUpdate(uid, normalized);
            });
        }
      }
    } else {
      showToast(saveResult.error || 'Gagal menyimpan pengaturan.', 'error');
    }
  };

  // Open Edit in Popup Form
  const handleOpenEdit = (trade: Trade) => {
    setEditingTrade(trade);
    setIsAddTradeModalOpen(true);
  };

  // Open Full Page Trade Detail
  const handleOpenTradeDetail = (trade: Trade) => {
    setTradeForDetail(trade);
    handleNavigateTab('detail');
  };

  // Open Screenshot zoom modal
  const handleViewScreenshot = (url: string, title?: string) => {
    setScreenshotModal({ url, title: title || 'Screenshot Transaksi' });
  };

  // Open TradeForm pre-filled from Chart Long/Short position drawing
  const handleCreateTradeFromChart = useCallback(
    (tradeData: {
      pair?: string;
      position?: 'BUY' | 'SELL';
      entryPrice?: number;
      stopLoss?: number;
      takeProfit?: number;
      notes?: string;
      plannedRiskReward?: number;
      lotSize?: number;
      riskAmount?: number;
      riskPercentage?: number;
    }) => {
      const nowIso = new Date().toISOString();
      const newTradeTemplate: Trade = {
        id: crypto.randomUUID ? crypto.randomUUID() : `trade_${Date.now()}`,
        dateTime: nowIso,
        instrument: tradeData.pair || 'XAUUSD',
        position: tradeData.position || 'BUY',
        strategy: 'Chart Analysis',
        session: 'London',
        entryPrice: tradeData.entryPrice || 0,
        stopLoss: tradeData.stopLoss,
        takeProfit: tradeData.takeProfit,
        exitPrice: tradeData.entryPrice || 0,
        lotSize: tradeData.lotSize && tradeData.lotSize > 0 ? tradeData.lotSize : 0.01,
        riskAmount:
          typeof tradeData.riskAmount === 'number' && tradeData.riskAmount >= 0
            ? tradeData.riskAmount
            : 0,
        riskPercentage:
          tradeData.riskPercentage && tradeData.riskPercentage > 0
            ? tradeData.riskPercentage
            : settings.defaultRiskPercent || 1,
        grossProfit: 0,
        netProfit: 0,
        commission: 0,
        swap: 0,
        outcome: 'BREAKEVEN',
        notes: tradeData.notes || 'Dari Analisis Chart TradingView',
      };
      setEditingTrade(newTradeTemplate);
      setIsAddTradeModalOpen(true);
    },
    [settings.defaultRiskPercent]
  );

  return (
    <div className="min-h-screen w-full bg-white text-[#0F172A] dark:bg-[#050607] dark:text-[#F2F4F7] flex flex-col font-sans transition-colors duration-150">
      <SplashScreen onComplete={handleSplashComplete} />
      {isWorkspaceReady && (
        <>
      {/* Non-blocking Floating Toast Notification with Swipe-to-Dismiss & Manual Close */}
      {notification && (
        <div
          data-testid="toast-notification-wrapper"
          className="fixed top-[calc(0.75rem+env(safe-area-inset-top,0px))] left-3 right-3 sm:left-auto sm:right-5 z-[60] flex justify-center sm:justify-end pointer-events-none"
        >
          <div
            key={notification.id}
            role={notification.type === 'error' ? 'alert' : 'status'}
            aria-live={notification.type === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
            data-testid="toast-notification-card"
            onTouchStart={(e) => {
              if (e.touches.length === 1) {
                handleToastGestureStart(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 1) {
                handleToastGestureMove(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
            onTouchEnd={(e) => {
              const t = e.changedTouches[0];
              if (t) {
                handleToastGestureEnd(t.clientX, t.clientY);
              } else {
                handleToastGestureCancel();
              }
            }}
            onTouchCancel={handleToastGestureCancel}
            onPointerDown={(e) => {
              if (e.pointerType === 'touch') return;
              if ((e.target as HTMLElement)?.closest('button')) return;
              handleToastGestureStart(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (e.pointerType === 'touch') return;
              handleToastGestureMove(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              if (e.pointerType === 'touch') return;
              handleToastGestureEnd(e.clientX, e.clientY);
            }}
            onPointerCancel={(e) => {
              if (e.pointerType === 'touch') return;
              handleToastGestureCancel();
            }}
            style={
              toastSwipeOffset.x !== 0 || toastSwipeOffset.y !== 0
                ? {
                    transform: `translate3d(${toastSwipeOffset.x}px, ${toastSwipeOffset.y}px, 0)`,
                  }
                : undefined
            }
            className={`w-full max-w-[360px] rounded-2xl border bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] px-3.5 py-3 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.10)] dark:shadow-[0_18px_40px_-8px_rgba(0,0,0,0.72)] select-none touch-none motion-reduce:transition-none ${
              isToastDragging ? 'transition-none' : 'transition-all duration-180 ease-[cubic-bezier(0.22,1,0.36,1)]'
            } ${
              isToastVisible
                ? 'opacity-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 -translate-y-4 pointer-events-none'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {/* Soft Controlled Status Indicator Icon */}
              <div
                data-testid="toast-status-icon"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  notification.type === 'success'
                    ? 'bg-[#059669]/10 text-[#059669] border-[#059669]/20 dark:bg-[#00A878]/15 dark:text-[#00A878] dark:border-[#00A878]/25'
                    : 'bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/20 dark:bg-[#E05260]/15 dark:text-[#E05260] dark:border-[#E05260]/25'
                }`}
              >
                {notification.type === 'success' ? (
                  <Check className="h-3 w-3 stroke-[2.25]" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 stroke-[2]" />
                )}
              </div>

              {/* Clean Title & Readable Secondary Message */}
              <div className="min-w-0 flex-1 pr-1">
                <span className="block text-[12.5px] font-bold leading-snug text-[#0F172A] dark:text-[#F2F4F7]">
                  {notification.type === 'success'
                    ? tr('Berhasil disimpan', 'Saved successfully')
                    : tr('Perhatian', 'Notice')}
                </span>
                <p
                  data-testid="toast-message-text"
                  className="mt-0.5 text-[11.5px] font-medium leading-relaxed text-[#526071] dark:text-[#929BA9] break-words"
                >
                  {notification.message}
                </p>
              </div>

              {/* Accessible Manual Close Button - aria-label="Tutup notifikasi" */}
              <button
                type="button"
                onClick={dismissToast}
                aria-label={tr('Tutup notifikasi', 'Close notification')}
                data-testid="toast-close-button"
                className="shrink-0 -mr-1 -mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5 stroke-[2]" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 w-full">
        {/* Desktop Sidebar Navigation */}
        <Sidebar
          activeTab={activeTab}
          onNavigate={(tab) => {
            if (tab === 'add-trade') {
              setEditingTrade(null);
              setSelectedPlaybookForTrade(null);
            }
            handleNavigateTab(tab);
          }}
          onAddTrade={() => {
            setEditingTrade(null);
            setSelectedPlaybookForTrade(null);
            setIsAddTradeModalOpen(true);
          }}
          tradesCount={scopedTrades.length}
          currentEquity={currentEquity}
          settings={scopedSettings}
          onOpenLocalInfo={() => setIsLocalInfoModalOpen(true)}
          onOpenBackupModal={() => setIsBackupModalOpen(true)}
          currentUser={currentUser}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenAccount={() => setIsAccountModalOpen(true)}
          onOpenAccountSwitcher={() => setIsAccountSwitcherOpen(true)}
          onOpenQuickCommand={() => setIsQuickCommandOpen(true)}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 w-full">
          {/* Top Navbar */}
          <Navbar
            currentEquity={currentEquity}
            settings={scopedSettings}
            activeTab={activeTab}
            onNavigate={(tab) => {
              if (tab === 'add-trade') {
                setEditingTrade(null);
              }
              handleNavigateTab(tab);
            }}
            onOpenMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            isMobileMenuOpen={isMobileMenuOpen}
            onOpenLocalInfo={() => setIsLocalInfoModalOpen(true)}
            onOpenBackupModal={() => setIsBackupModalOpen(true)}
            currentUser={currentUser}
            onOpenAuth={() => setIsAuthModalOpen(true)}
            onOpenAccount={() => setIsAccountModalOpen(true)}
            notifications={appNotifications}
            onMarkAllNotificationsRead={() => {
              setAppNotifications(markAllNotificationsRead());
            }}
            onClearNotifications={() => {
              setAppNotifications(clearAppNotifications());
            }}
            onSelectNotification={(item) => {
              setAppNotifications(markNotificationRead(item.id));
              if (item.tradeId) {
                const targetTrade = tradesRef.current.find(
                  (t) => t.id.toLowerCase() === item.tradeId?.toLowerCase()
                );
                if (targetTrade) {
                  handleOpenTradeDetail(targetTrade);
                } else {
                  handleNavigateTab('trades');
                }
              } else if (item.targetTab) {
                handleNavigateTab(item.targetTab);
              }
            }}
          />

          {/* View Container with balanced bottom padding for mobile navigation & Android safe area */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
            {/* Cloud Connection / Load Error Banner */}
            {cloudLoadError && (
              <div className="mb-6 p-4 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#E11D48]/10 dark:bg-[#E05260]/15 border border-[#E11D48]/20 dark:border-[#E05260]/25 text-[#E11D48] dark:text-[#E05260] shrink-0 mt-0.5">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#E11D48] dark:text-[#E05260]">
                      {tr('Gagal Mengambil Data dari VLO Cloud', 'Failed to Fetch Data from VLO Cloud')}
                    </h4>
                    <p className="text-xs text-[#0F172A] dark:text-[#F2F4F7] mt-0.5">{cloudLoadError}</p>
                    <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-1">
                      {tr(
                        'Aplikasi saat ini menampilkan data cadangan lokal sementara. Transaksi baru tidak akan tersimpan ke cloud sampai koneksi berhasil dipulihkan.',
                        'The app is currently displaying temporary local backup data. New trades will not be saved to the cloud until connection is restored.'
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                  <button
                    onClick={handleReloadFromCloud}
                    disabled={isCloudSyncing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                  >
                    <span className={isCloudSyncing ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
                    <span>
                      {isCloudSyncing
                        ? tr('Memuat Ulang...', 'Reloading...')
                        : tr('Coba Muat Ulang', 'Try Reloading')}
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div className={activeTab === 'dashboard' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'dashboard'}>
              <DashboardView
                trades={scopedTrades}
                settings={scopedSettings}
                onNavigate={handleNavigateTab}
                onAddTrade={() => {
                  setEditingTrade(null);
                  setSelectedPlaybookForTrade(null);
                  setIsAddTradeModalOpen(true);
                }}
                onViewTrade={handleOpenTradeDetail}
                onClearDemoTrades={() => setIsClearDemoModalOpen(true)}
                onDeleteTradesByDate={(req) => setBatchDeleteRequest(req)}
              />
            </div>

            <div className={activeTab === 'trades' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'trades'}>
              <TradeTable
                trades={scopedTrades}
                settings={scopedSettings}
                onAddTrade={() => {
                  setEditingTrade(null);
                  setSelectedPlaybookForTrade(null);
                  setIsAddTradeModalOpen(true);
                }}
                onEditTrade={handleOpenEdit}
                onDeleteTrade={(t) => setTradeForDelete(t)}
                onDeleteTradesByDate={(req) => setBatchDeleteRequest(req)}
                onViewDetail={handleOpenTradeDetail}
                onViewScreenshot={handleViewScreenshot}
                onClearDemoTrades={() => setIsClearDemoModalOpen(true)}
                currentUser={currentUser}
                dataSource={dataSource}
                isCloudSyncing={isCloudSyncing}
                cloudLoadError={cloudLoadError}
                onReloadFromCloud={handleReloadFromCloud}
                onSyncLocalToCloud={handleSyncLocalToCloud}
                onImportBatchTrades={handleImportBatchTrades}
                onOpenPlaybook={() => setIsPlaybookModalOpen(true)}
                onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
                onUpdateTradeLifecycle={(updatedTrade, origId) =>
                  handleSaveTrade(updatedTrade, origId, { stayOnCurrentTab: true })
                }
              />
            </div>

            {(activeTab === 'detail' || visitedTabs['detail']) && (
              <div className={activeTab === 'detail' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'detail'}>
                <TradeDetailModal
                  trade={tradeForDetail || (scopedTrades.length > 0 ? scopedTrades[0] : null)}
                  allTrades={scopedTrades}
                  settings={scopedSettings}
                  isOpen={activeTab === 'detail'}
                  isFullPage={true}
                  isChildModalOpen={Boolean(screenshotModal)}
                  onClose={() => handleNavigateTab('trades')}
                  onSelectTrade={(t) => setTradeForDetail(t)}
                  onEdit={handleOpenEdit}
                  onDelete={(t) => setTradeForDelete(t)}
                  onViewScreenshot={handleViewScreenshot}
                  onSaveTradeUpdate={(updatedTrade, origId) =>
                    handleSaveTrade(updatedTrade, origId, { stayOnCurrentTab: true })
                  }
                  onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
                />
              </div>
            )}

            <LazyViewErrorBoundary resetKey={activeTab} tr={tr}>
            <Suspense
              fallback={
                <div
                  aria-label={tr('Memuat tampilan...', 'Loading view...')}
                  className="space-y-6 py-2 vlo-view-fade"
                >
                  <div className="space-y-2 pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
                    <div className="h-6 w-48 rounded-lg vlo-skeleton" />
                    <div className="h-3.5 w-72 max-w-full rounded-md vlo-skeleton" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="h-28 rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] vlo-skeleton" />
                    <div className="h-28 rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] vlo-skeleton" />
                    <div className="hidden lg:block h-28 rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] vlo-skeleton" />
                  </div>
                  <div className="h-56 rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] vlo-skeleton" />
                </div>
              }
            >
              {(activeTab === 'analytics' || visitedTabs['analytics']) && (
                <div className={activeTab === 'analytics' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'analytics'}>
                  <AnalyticsView
                    trades={scopedTrades}
                    settings={scopedSettings}
                    onViewTrade={handleOpenTradeDetail}
                    onDeleteTradesByDate={(req) => setBatchDeleteRequest(req)}
                    userId={currentUser?.id || null}
                  />
                </div>
              )}

              {(activeTab === 'risk' || visitedTabs['risk']) && (
                <div className={activeTab === 'risk' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'risk'}>
                  <RiskCalculatorView
                    currentEquity={currentEquity}
                    settings={scopedSettings}
                    onUpdateSettings={handleUpdateSettings}
                    dailyLossToday={metrics.dailyLossToday}
                    trades={scopedTrades}
                  />
                </div>
              )}

              {(activeTab === 'ai-desk' || visitedTabs['ai-desk']) && (
                <div className={activeTab === 'ai-desk' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'ai-desk'}>
                  <AgentDeskView
                    trades={scopedTrades}
                    settings={scopedSettings}
                    isActive={activeTab === 'ai-desk'}
                    onNavigate={handleNavigateTab}
                  />
                </div>
              )}

              {(activeTab === 'market-chart' || visitedTabs['market-chart']) && (
                <div className={activeTab === 'market-chart' ? 'block vlo-view-fade' : 'hidden'} aria-hidden={activeTab !== 'market-chart'}>
                  <MarketChartView
                    isActive={activeTab === 'market-chart'}
                    currentUser={currentUser}
                    trades={scopedTrades}
                    settings={scopedSettings}
                    currentEquity={currentEquity}
                    onOpenAuth={() => setIsAuthModalOpen(true)}
                    onOpenAccount={() => setIsAccountModalOpen(true)}
                    onCreateTradeFromPosition={handleCreateTradeFromChart}
                  />
                </div>
              )}

              {(activeTab === 'macro-news' || visitedTabs['macro-news']) && (
                <div className={activeTab === 'macro-news' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'macro-news'}>
                  <MacroNewsView isActive={activeTab === 'macro-news'} />
                </div>
              )}

              {(activeTab === 'fundamental-gold' || visitedTabs['fundamental-gold']) && (
                <div className={activeTab === 'fundamental-gold' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'fundamental-gold'}>
                  <FundamentalGoldView isActive={activeTab === 'fundamental-gold'} />
                </div>
              )}

              {(activeTab === 'cycle-confluence' || visitedTabs['cycle-confluence']) && (
                <div className={activeTab === 'cycle-confluence' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'cycle-confluence'}>
                  <CycleConfluencePage
                    isActive={activeTab === 'cycle-confluence'}
                    onNavigate={handleNavigateTab}
                  />
                </div>
              )}

              {(activeTab === 'smc-signal' || visitedTabs['smc-signal']) && (
                <div className={activeTab === 'smc-signal' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'smc-signal'}>
                  <SmcSignalPage
                    isActive={activeTab === 'smc-signal'}
                    onNavigate={handleNavigateTab}
                  />
                </div>
              )}

              {(activeTab === 'settings' || visitedTabs['settings']) && (
                <div className={activeTab === 'settings' ? 'block vlo-view-enter' : 'hidden'} aria-hidden={activeTab !== 'settings'}>
                  <SettingsView
                    settings={settings}
                    trades={trades}
                    onSaveSettings={handleUpdateSettings}
                    onUpdateTrades={handleUpdateTrades}
                    onImportCsvTrades={handleImportCsvTrades}
                    onLoadDemoTrades={handleLoadDemoTrades}
                    onClearAllTrades={handleClearAllTrades}
                    onRequestClearDemo={() => setIsClearDemoModalOpen(true)}
                    onOpenLocalInfo={() => setIsLocalInfoModalOpen(true)}
                    onOpenBackupModal={() => setIsBackupModalOpen(true)}
                    currentUser={currentUser}
                    onOpenAuth={() => setIsAuthModalOpen(true)}
                    onOpenAccount={() => setIsAccountModalOpen(true)}
                    onOpenConfig={() => setIsSupabaseConfigOpen(true)}
                    isCloudSyncing={isCloudSyncing}
                    onSyncLocalToCloud={handleSyncLocalToCloud}
                    onReloadFromCloud={handleReloadFromCloud}
                    isDeveloperMode={isDeveloperMode}
                    onUnlockDeveloperMode={handleUnlockDeveloperMode}
                    onLockDeveloperMode={handleLockDeveloperMode}
                    onUserUpdated={(updatedUser) => setCurrentUser(updatedUser)}
                    onOpenPlaybook={() => setIsPlaybookModalOpen(true)}
                    onOpenAccountSwitcher={() => setIsAccountSwitcherOpen(true)}
                  />
                </div>
              )}
            </Suspense>
            </LazyViewErrorBoundary>
          </main>
        </div>
      </div>

      {/* Mobile Navigation Drawer & Bottom Bar */}
      <MobileNav
        activeTab={activeTab}
        onNavigate={(tab) => {
          if (tab === 'add-trade') {
            setEditingTrade(null);
            setSelectedPlaybookForTrade(null);
          }
          handleNavigateTab(tab);
        }}
        onAddTrade={() => {
          setEditingTrade(null);
          setSelectedPlaybookForTrade(null);
          setIsAddTradeModalOpen(true);
        }}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        tradesCount={scopedTrades.length}
        currentEquity={currentEquity}
        settings={scopedSettings}
        onOpenLocalInfo={() => setIsLocalInfoModalOpen(true)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenAccount={() => setIsAccountModalOpen(true)}
        onOpenAccountSwitcher={() => setIsAccountSwitcherOpen(true)}
      />

      {/* Add / Edit Trade Popup Form Modal */}
      {(isAddTradeModalOpen || activeTab === 'add-trade') && (
        <TradeForm
          initialTrade={editingTrade}
          settings={scopedSettings}
          currentEquity={currentEquity}
          existingTrades={trades}
          dailyLossToday={metrics.dailyLossToday}
          activeAccountId={activeAccountId}
          initialPlaybook={selectedPlaybookForTrade}
          onSave={handleSaveTrade}
          onCancel={() => {
            setEditingTrade(null);
            setSelectedPlaybookForTrade(null);
            setIsAddTradeModalOpen(false);
            if (activeTab === 'add-trade') {
              handleNavigateTab('trades');
            }
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        trade={tradeForDelete}
        isOpen={Boolean(tradeForDelete)}
        isDeleting={isCloudSyncing}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!isCloudSyncing) {
            setTradeForDelete(null);
          }
        }}
      />

      {/* Batch Delete by Date Confirmation Modal */}
      <BatchDeleteDateModal
        request={batchDeleteRequest}
        settings={scopedSettings}
        isOpen={Boolean(batchDeleteRequest)}
        isDeleting={isCloudSyncing}
        onConfirm={handleConfirmBatchDeleteByDate}
        onCancel={() => {
          if (!isCloudSyncing) {
            setBatchDeleteRequest(null);
          }
        }}
      />

      {/* Screenshot Viewer Modal */}
      <ScreenshotModal
        imageUrl={screenshotModal?.url || null}
        tradeTitle={screenshotModal?.title}
        isOpen={Boolean(screenshotModal)}
        onClose={() => setScreenshotModal(null)}
      />

      {/* Local Prototype Info Modal */}
      <LocalPrototypeModal
        isOpen={isLocalInfoModalOpen}
        onClose={() => setIsLocalInfoModalOpen(false)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        tradesCount={trades.length}
      />

      {/* JSON Backup Export & Import Modal (with Validation & Overwrite Confirmation) */}
      <JsonBackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        trades={trades}
        settings={settings}
        currentUser={currentUser}
        onRestoreSuccess={handleRestoreBackupJson}
      />

      {/* Clear DEMO Confirmation Modal */}
      <ClearDemoModal
        isOpen={isClearDemoModalOpen}
        onClose={() => setIsClearDemoModalOpen(false)}
        onConfirm={handleConfirmClearDemoTrades}
        trades={trades}
      />

      {/* Authentication Modal (Google / Social OAuth, VLO Account, Forgot Password, Local Mode) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          setShouldPromptOnboarding(false);
          try {
            localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
          } catch {}
          const displayLabel = user.user_metadata?.full_name || user.email;
          showToast(
            tr(`Berhasil masuk sebagai ${displayLabel}`, `Signed in as ${displayLabel}`)
          );
        }}
        onContinueLocal={() => {
          setShouldPromptOnboarding(false);
          try {
            localStorage.setItem(GUEST_MODE_STORAGE_KEY, '1');
          } catch {}
          setIsAuthModalOpen(false);
          showToast(
            tr(
              'Mode Lokal aktif. Anda dapat masuk akun kapan saja melalui Pengaturan.',
              'Local Mode active. You can sign in anytime from Settings.'
            )
          );
        }}
        onOpenConfig={() => {
          setIsAuthModalOpen(false);
          setIsSupabaseConfigOpen(true);
        }}
        isDeveloperMode={isDeveloperMode}
      />

      {/* User Account & Logout Confirmation Modal */}
      <UserAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        currentUser={currentUser}
        onUserUpdated={(updatedUser) => setCurrentUser(updatedUser)}
        onLogoutSuccess={() => {
          resetTransientModalsAndCaches();
          previousUserIdRef.current = null;
          setCurrentUser(null);
          setCloudLoadError(null);
          setDataSource('local');
          const guestTrades = loadStoredTrades(null);
          tradesRef.current = guestTrades;
          setTrades(guestTrades);
          setSettings(loadStoredSettings(null));
          showToast(
            tr(
              'Anda telah berhasil keluar dari akun cloud.',
              'You have successfully signed out of your cloud account.'
            )
          );
        }}
      />

      {/* Supabase Connection & Credentials Modal */}
      <SupabaseConfigModal
        isOpen={isSupabaseConfigOpen}
        onClose={() => setIsSupabaseConfigOpen(false)}
        onConfigSaved={() => {
          showToast(
            tr(
              'Konfigurasi Supabase berhasil disimpan!',
              'Supabase configuration saved successfully!'
            )
          );
        }}
      />

      {/* Quick Command Palette (Cmd/Ctrl+K) */}
      <QuickCommandModal
        isOpen={isQuickCommandOpen}
        onClose={() => setIsQuickCommandOpen(false)}
        trades={scopedTrades}
        onNavigateTab={handleNavigateTab}
        onAddTrade={() => {
          setEditingTrade(null);
          setSelectedPlaybookForTrade(null);
          setIsAddTradeModalOpen(true);
        }}
        onOpenPlaybook={() => setIsPlaybookModalOpen(true)}
        onOpenAccountSwitcher={() => setIsAccountSwitcherOpen(true)}
        onToggleTheme={() => toggleThemeMode()}
        onViewTrade={handleOpenTradeDetail}
      />

      {/* Multi-Account / Sub-Portfolio Switcher Modal */}
      <AccountSwitcherModal
        isOpen={isAccountSwitcherOpen}
        onClose={() => setIsAccountSwitcherOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* A+ Setup Playbook Library Modal */}
      <PlaybookLibraryModal
        isOpen={isPlaybookModalOpen}
        onClose={() => setIsPlaybookModalOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onSelectForNewTrade={(playbook) => {
          setIsPlaybookModalOpen(false);
          setEditingTrade(null);
          setSelectedPlaybookForTrade(playbook);
          setIsAddTradeModalOpen(true);
        }}
      />

      {/* Offline Status Pill (Only visible when device is offline) */}
      <OfflineIndicator />
        </>
      )}
    </div>
  );
}
