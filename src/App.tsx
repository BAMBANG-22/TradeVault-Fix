/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Check, AlertCircle, X } from 'lucide-react';
import { Trade } from './types/trade';
import { AppSettings } from './types/settings';
import {
  loadStoredTrades,
  saveStoredTrades,
  loadStoredSettings,
  saveStoredSettings,
  mergeWithExistingSettings,
  removeTradeFromLatestList,
} from './utils/storage';
import { calculatePerformance } from './utils/calculations';
import { DEMO_TRADES, isDemoTrade } from './utils/demoData';
import { getSupabase, getCurrentSession, getCurrentUser } from './utils/supabaseClient';
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
import { useTheme } from './utils/theme';
import { useLanguage } from './utils/language';

// Layout
import { Sidebar } from './components/layout/Sidebar';
import { Navbar } from './components/layout/Navbar';
import { MobileNav } from './components/layout/MobileNav';

// Views
import { DashboardView } from './components/dashboard/DashboardView';
import { TradeTable } from './components/trades/TradeTable';
import { TradeForm } from './components/trades/TradeForm';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { RiskCalculatorView } from './components/risk/RiskCalculatorView';
import { MarketChartView } from './components/chart/MarketChartView';
import { MacroNewsView } from './components/news/MacroNewsView';
import { SettingsView } from './components/settings/SettingsView';

// Modals
import { DeleteConfirmModal } from './components/trades/DeleteConfirmModal';
import { TradeDetailModal } from './components/trades/TradeDetailModal';
import { ScreenshotModal } from './components/trades/ScreenshotModal';
import { LocalPrototypeModal } from './components/layout/LocalPrototypeModal';
import { JsonBackupModal } from './components/backup/JsonBackupModal';
import { ClearDemoModal } from './components/backup/ClearDemoModal';
import { AuthModal } from './components/auth/AuthModal';
import { UserAccountModal } from './components/auth/UserAccountModal';
import { SupabaseConfigModal } from './components/supabase/SupabaseConfigModal';
import {
  decodeLifecycleMetaFromExecutionNotes,
  encodeLifecycleMetaIntoExecutionNotes,
} from './utils/tradeLifecycle';

export default function App() {
  // Theme & Language state
  useTheme();
  const { tr } = useLanguage();

  // Primary state backed by localStorage with live Supabase synchronization
  const [trades, setTrades] = useState<Trade[]>(() => loadStoredTrades(null));
  const [settings, setSettings] = useState<AppSettings>(() => loadStoredSettings());
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({
    dashboard: true,
    trades: true,
  });

  // Supabase Auth States
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [isSupabaseConfigOpen, setIsSupabaseConfigOpen] = useState<boolean>(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [cloudLoadError, setCloudLoadError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'cloud' | 'local_fallback' | 'local'>('local');

  // Modal and editing states
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [isAddTradeModalOpen, setIsAddTradeModalOpen] = useState<boolean>(false);
  const [tradeForDetail, setTradeForDetail] = useState<Trade | null>(null);
  const [tradeForDelete, setTradeForDelete] = useState<Trade | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ url: string; title: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
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
      if (isMounted && session?.user) {
        authGenerationRef.current++;
        setCurrentUser(session.user);
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
    setIsCloudSyncing(true);
    setCloudLoadError(null);

    // Pre-load this user's isolated local cache immediately while cloud fetch is pending
    // (never leaks another account's trades or settings)
    const userCachedTrades = loadStoredTrades(activeUserId);
    tradesRef.current = userCachedTrades;
    setTrades(userCachedTrades);
    const userCachedSettings = loadStoredSettings(activeUserId);
    setSettings(userCachedSettings);

    // Load user settings from Supabase with isolated fallback
    loadUserSettingsWithFallback(activeUserId, fetchSettingsFromSupabase).then((settingsResult) => {
      if (!isCurrent) return;
      setSettings(settingsResult.settings);
    });

    fetchTradesFromSupabase(activeUserId).then((result) => {
      // Race condition protection: ignore if user logged out or switched accounts during fetch
      if (!isCurrent) return;
      setIsCloudSyncing(false);

      if (result.success && result.data) {
        setCloudLoadError(null);
        setDataSource('cloud');
        tradesRef.current = result.data;
        setTrades(result.data);
        saveStoredTrades(result.data, activeUserId);

        if (result.data.length > 0) {
          showToast(
            tr(
              `Berhasil memuat ${result.data.length} transaksi dari database Supabase.`,
              `Successfully loaded ${result.data.length} trades from Supabase database.`
            )
          );
        } else {
          showToast(
            tr(
              'Terhubung ke database Supabase. Akun ini belum memiliki transaksi cloud.',
              'Connected to Supabase database. This account has no cloud trades yet.'
            )
          );
        }
      } else if (!result.success) {
        setCloudLoadError(
          result.error ||
            tr('Gagal memuat data dari database Supabase.', 'Failed to load data from Supabase database.')
        );
        setDataSource('local_fallback');
        const fallbackTrades = loadStoredTrades(activeUserId);
        tradesRef.current = fallbackTrades;
        setTrades(fallbackTrades);
        showToast(
          tr(
            `Gagal memuat transaksi dari Supabase: ${result.error}. Menampilkan data cadangan luring akun ini (${fallbackTrades.length} transaksi).`,
            `Failed to load trades from Supabase: ${result.error}. Showing offline backup data for this account (${fallbackTrades.length} trades).`
          ),
          'error'
        );
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [currentUser?.id]);

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

  // Performance calculation engine (authoritative on trades & settings)
  const { metrics } = calculatePerformance(trades, settings);
  const currentEquity = metrics.currentEquity;

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

      // Verify authenticated user id from Supabase Auth
      let verifiedUserId: string | null = null;
      if (currentUser) {
        const { user } = await getCurrentUser();
        if (user?.id) {
          verifiedUserId = user.id;
        }
      }

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

      // If user is logged in and attached a NEW base64 screenshot, upload to private Storage first.
      // uploadScreenshotToSupabase internally reuses and verifies screenshotUploadCache (and evicts deleted paths).
      if (
        verifiedUserId &&
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
          const uploadErrMsg = `Gagal mengunggah screenshot ke Storage: ${uploadRes.error}. Data formulir Anda tetap tersimpan.`;
          showToast(uploadErrMsg, 'error');
          // Do NOT close form, do NOT reset editingTrade, do NOT navigate away!
          return { success: false, error: uploadErrMsg };
        }

        // Store the relative object path in screenshot_url
        finalTrade.screenshotUrl = uploadRes.data;
        uploadedScreenshotPath = uploadRes.data;
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
            } else if (verifiedUserId && beforeTrimmed.startsWith('data:image/')) {
              setIsCloudSyncing(true);
              const beforeUploadRes = await uploadScreenshotToSupabase(
                beforeTrimmed,
                `${finalTrade.id}_before`,
                verifiedUserId
              );
              setIsCloudSyncing(false);
              if (!beforeUploadRes.success || !beforeUploadRes.data) {
                const beforeErrMsg = `Gagal mengunggah screenshot Before Trade ke Storage: ${beforeUploadRes.error}.`;
                showToast(beforeErrMsg, 'error');
                return { success: false, error: beforeErrMsg };
              }
              nextMeta.beforeScreenshotUrl = beforeUploadRes.data;
              metaChanged = true;
            }
          }

          if (
            verifiedUserId &&
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
              const afterErrMsg = `Gagal mengunggah screenshot After Trade ke Storage: ${afterUploadRes.error}.`;
              showToast(afterErrMsg, 'error');
              return { success: false, error: afterErrMsg };
            }
            nextMeta.afterScreenshotUrl = afterUploadRes.data;
            metaChanged = true;
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

      // If user is logged in, persist to Supabase public.trades
      if (verifiedUserId) {
        setIsCloudSyncing(true);
        const cloudResult = isEdit
          ? await updateTradeInSupabase(finalTrade, verifiedUserId, targetOriginalId)
          : await insertTradeToSupabase(finalTrade, verifiedUserId);
        setIsCloudSyncing(false);

        if (!cloudResult.success) {
          const dbErrMsg = `Gagal memperbarui database Supabase: ${cloudResult.error}`;
          showToast(dbErrMsg, 'error');
          // Do not update the in-memory trade list as a cloud success if cloud write failed
          return {
            success: false,
            error: dbErrMsg,
            uploadedScreenshotPath,
          };
        }

        // Clean up any replaced/deleted storage files ONLY after database update is confirmed successful
        for (const oldPath of oldStoragePathsToClean) {
          deleteScreenshotFromSupabase(oldPath).catch((err) => {
            console.warn('Peringatan: Gagal membersihkan screenshot lama dari storage:', err);
          });
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

      // Guest / Local Mode: saveStoredTrades is the AUTHORITATIVE persistence (F-01)
      if (!verifiedUserId) {
        const localSaveResult = saveStoredTrades(updatedTrades, null);
        if (!localSaveResult.success) {
          const failMsg = localSaveResult.error || 'Gagal menyimpan transaksi ke penyimpanan lokal.';
          showToast(failMsg, 'error');
          // F-01: DO NOT update tradesRef.current, DO NOT update trades state,
          // DO NOT reset editingTrade, DO NOT navigate away from form!
          return {
            success: false,
            error: failMsg,
            uploadedScreenshotPath,
          };
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
        return { success: true, uploadedScreenshotPath };
      }

      // Authenticated Mode: Cloud persistence confirmed above; now update state & offline cache
      tradesRef.current = updatedTrades;
      setTrades(updatedTrades);

      const cacheResult = saveStoredTrades(updatedTrades, verifiedUserId);
      if (!cacheResult.success) {
        // Non-blocking offline cache warning (cloud write already succeeded)
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
      showToast(
        isEdit
          ? tr(
              `Transaksi ${finalTrade.id} berhasil diperbarui di database Supabase!`,
              `Trade ${finalTrade.id} updated in Supabase database!`
            )
          : tr(
              `Transaksi ${finalTrade.id} berhasil disimpan ke database Supabase!`,
              `Trade ${finalTrade.id} saved to Supabase database!`
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
      // Verify authenticated user id
      let verifiedUserId: string | null = null;
      if (currentUser) {
        const { user } = await getCurrentUser();
        if (user?.id) {
          verifiedUserId = user.id;
        }
      }

      // If logged in, delete row from Supabase
      if (verifiedUserId) {
        if (!isDemoTradeItem) {
          setIsCloudSyncing(true);
          const deleteResult = await deleteTradeFromSupabase(deletedId, verifiedUserId);
          setIsCloudSyncing(false);

          if (!deleteResult.success) {
            showToast(`Gagal menghapus dari database Supabase: ${deleteResult.error}`, 'error');
            return;
          }

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
        } else {
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

      setTrades(filtered);
      setTradeForDelete(null);
      if (tradeForDetail?.id === deletedId) {
        setTradeForDetail(null);
        if (activeTabRef.current === 'detail') {
          handleNavigateTab('trades');
        }
      }

      if (verifiedUserId && !isDemoTradeItem) {
        showToast(
          tr(
            `Transaksi ${deletedId} berhasil dihapus dari database Supabase.`,
            `Trade ${deletedId} deleted from Supabase database.`
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
            `Berhasil menyinkronkan seluruh (${res.count}) transaksi ke tabel public.trades!`,
            `Successfully synced all (${res.count}) trades to public.trades!`
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

  // Manual trigger to reload fresh trades from Supabase cloud
  const handleReloadFromCloud = async () => {
    let verifiedUserId: string | null = null;
    if (currentUser) {
      const { user } = await getCurrentUser();
      if (user?.id) {
        verifiedUserId = user.id;
      }
    }

    if (!verifiedUserId) {
      showToast(tr('Harap masuk terlebih dahulu.', 'Please sign in first.'), 'error');
      return;
    }

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

    if (result.success && result.data) {
      setCloudLoadError(null);
      setDataSource('cloud');
      tradesRef.current = result.data;
      setTrades(result.data);
      saveStoredTrades(result.data, verifiedUserId);
      if (result.data.length > 0) {
        showToast(
          tr(
            `Berhasil memuat ${result.data.length} transaksi dari database Supabase!`,
            `Successfully loaded ${result.data.length} trades from Supabase database!`
          )
        );
      } else {
        showToast(
          tr(
            'Terhubung ke database Supabase. Akun ini belum memiliki transaksi cloud.',
            'Connected to Supabase database. This account has no cloud trades yet.'
          )
        );
      }
    } else {
      setCloudLoadError(
        result.error ||
          tr('Gagal memuat transaksi dari Supabase.', 'Failed to load trades from Supabase.')
      );
      setDataSource('local_fallback');
      const fallbackTrades = loadStoredTrades(verifiedUserId);
      tradesRef.current = fallbackTrades;
      setTrades(fallbackTrades);
      showToast(
        tr(
          `Gagal memuat dari Supabase: ${result.error}. Menggunakan cache luring akun ini (${fallbackTrades.length} transaksi).`,
          `Failed to load from Supabase: ${result.error}. Using offline cache for this account (${fallbackTrades.length} trades).`
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
                'Gagal menghapus seluruh transaksi dari database cloud Supabase.',
                'Failed to delete all trades from Supabase cloud database.'
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
      showToast('Menyinkronkan transaksi pemulihan ke database Supabase...');

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
              ? `Berhasil menggantikan jurnal dengan ${finalTrades.length} trade dan menyinkronkannya ke database Supabase!`
              : `Berhasil menggabungkan cadangan (${finalTrades.length} total trade) dan menyinkronkannya ke database Supabase!`
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
            `Data berhasil dimuat di browser lokal, namun sinkronisasi ke Supabase gagal: ${res.error}. Transaksi BELUM tersimpan di cloud.`,
            'error'
          );
        }
      } finally {
        setIsCloudSyncing(false);
      }
    } else {
      if (currentUser && !syncToCloud) {
        showToast(
          `Data cadangan (${backupTrades.length} trade) dimuat ke browser lokal. Data BELUM tersimpan di cloud Supabase. Gunakan tombol 'Sinkronkan ke Cloud' untuk mengunggahnya.`,
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
        saveSettingsToSupabase(normalized, currentUser.id).catch(() => {
          // Non-blocking background settings sync
        });
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
    <div className="min-h-screen w-full bg-[#F5F7FA] text-[#151D2A] dark:bg-[#050607] dark:text-[#F2F4F7] flex flex-col font-sans transition-colors duration-150">
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
            className={`w-full max-w-[360px] rounded-2xl border bg-[#FFFFFF] border-[#E2E8F0] dark:border-[#CBD5E1]/80 px-3.5 py-3 shadow-[0_10px_28px_-6px_rgba(15,23,42,0.14)] dark:shadow-[0_14px_34px_-6px_rgba(0,0,0,0.55)] select-none touch-none motion-reduce:transition-none ${
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
                    ? 'bg-[#F0FDF4] text-[#15803D] border-[#DCFCE7]'
                    : 'bg-[#FEF2F2] text-[#B91C1C] border-[#FEE2E2]'
                }`}
              >
                {notification.type === 'success' ? (
                  <Check className="h-3 w-3 stroke-[2.25]" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 stroke-[2]" />
                )}
              </div>

              {/* Clean Dark Charcoal Title & Readable Secondary Message */}
              <div className="min-w-0 flex-1 pr-1">
                <span className="block text-[12.5px] font-bold leading-snug text-[#11151B]">
                  {notification.type === 'success'
                    ? tr('Berhasil disimpan', 'Saved successfully')
                    : tr('Perhatian', 'Notice')}
                </span>
                <p
                  data-testid="toast-message-text"
                  className="mt-0.5 text-[11.5px] font-medium leading-relaxed text-[#4B5565] break-words"
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
                className="shrink-0 -mr-1 -mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg text-[#64748B] hover:text-[#11151B] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
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
            }
            handleNavigateTab(tab);
          }}
          onAddTrade={() => {
            setEditingTrade(null);
            setIsAddTradeModalOpen(true);
          }}
          tradesCount={trades.length}
          currentEquity={currentEquity}
          settings={settings}
          onOpenLocalInfo={() => setIsLocalInfoModalOpen(true)}
          onOpenBackupModal={() => setIsBackupModalOpen(true)}
          currentUser={currentUser}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenAccount={() => setIsAccountModalOpen(true)}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 w-full">
          {/* Top Navbar */}
          <Navbar
            currentEquity={currentEquity}
            settings={settings}
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
          />

          {/* View Container with balanced bottom padding for mobile navigation & Android safe area */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
            {/* Cloud Connection / Load Error Banner */}
            {cloudLoadError && (
              <div className="mb-6 p-4 rounded-xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] text-[#151D2A] dark:text-[#F2F5F9] flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
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
                    <h4 className="text-sm font-bold text-rose-600 dark:text-rose-400">
                      {tr('Gagal Mengambil Data dari Supabase', 'Failed to Fetch Data from Supabase')}
                    </h4>
                    <p className="text-xs text-[#151D2A] dark:text-[#F2F5F9] mt-0.5">{cloudLoadError}</p>
                    <p className="text-[11px] text-[#697586] dark:text-[#929BA9] mt-1">
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
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1769E8] hover:bg-[#1458C4] text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
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

            <div className={activeTab === 'dashboard' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'dashboard'}>
              <DashboardView
                trades={trades}
                settings={settings}
                onNavigate={handleNavigateTab}
                onAddTrade={() => {
                  setEditingTrade(null);
                  setIsAddTradeModalOpen(true);
                }}
                onViewTrade={handleOpenTradeDetail}
                onClearDemoTrades={() => setIsClearDemoModalOpen(true)}
              />
            </div>

            <div className={activeTab === 'trades' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'trades'}>
              <TradeTable
                trades={trades}
                settings={settings}
                onAddTrade={() => {
                  setEditingTrade(null);
                  setIsAddTradeModalOpen(true);
                }}
                onEditTrade={handleOpenEdit}
                onDeleteTrade={(t) => setTradeForDelete(t)}
                onViewDetail={handleOpenTradeDetail}
                onViewScreenshot={handleViewScreenshot}
                onClearDemoTrades={() => setIsClearDemoModalOpen(true)}
                currentUser={currentUser}
                dataSource={dataSource}
                isCloudSyncing={isCloudSyncing}
                cloudLoadError={cloudLoadError}
                onReloadFromCloud={handleReloadFromCloud}
                onSyncLocalToCloud={handleSyncLocalToCloud}
                onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
                onUpdateTradeLifecycle={(updatedTrade, origId) =>
                  handleSaveTrade(updatedTrade, origId, { stayOnCurrentTab: true })
                }
              />
            </div>

            {(activeTab === 'detail' || visitedTabs['detail']) && (
              <div className={activeTab === 'detail' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'detail'}>
                <TradeDetailModal
                  trade={tradeForDetail || (trades.length > 0 ? trades[0] : null)}
                  allTrades={trades}
                  settings={settings}
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

            {(activeTab === 'analytics' || visitedTabs['analytics']) && (
              <div className={activeTab === 'analytics' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'analytics'}>
                <AnalyticsView
                  trades={trades}
                  settings={settings}
                  onViewTrade={handleOpenTradeDetail}
                />
              </div>
            )}

            {(activeTab === 'risk' || visitedTabs['risk']) && (
              <div className={activeTab === 'risk' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'risk'}>
                <RiskCalculatorView
                  currentEquity={currentEquity}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  dailyLossToday={metrics.dailyLossToday}
                  trades={trades}
                />
              </div>
            )}

            {(activeTab === 'market-chart' || visitedTabs['market-chart']) && (
              <div className={activeTab === 'market-chart' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'market-chart'}>
                <MarketChartView
                  isActive={activeTab === 'market-chart'}
                  currentUser={currentUser}
                  trades={trades}
                  settings={settings}
                  currentEquity={currentEquity}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                  onOpenAccount={() => setIsAccountModalOpen(true)}
                  onCreateTradeFromPosition={handleCreateTradeFromChart}
                />
              </div>
            )}

            {(activeTab === 'macro-news' || visitedTabs['macro-news']) && (
              <div className={activeTab === 'macro-news' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'macro-news'}>
                <MacroNewsView />
              </div>
            )}

            {(activeTab === 'settings' || visitedTabs['settings']) && (
              <div className={activeTab === 'settings' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'settings'}>
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
                />
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Mobile Navigation Drawer & Bottom Bar */}
      <MobileNav
        activeTab={activeTab}
        onNavigate={(tab) => {
          if (tab === 'add-trade') {
            setEditingTrade(null);
          }
          handleNavigateTab(tab);
        }}
        onAddTrade={() => {
          setEditingTrade(null);
          setIsAddTradeModalOpen(true);
        }}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        tradesCount={trades.length}
        currentEquity={currentEquity}
        settings={settings}
        onOpenLocalInfo={() => setIsLocalInfoModalOpen(true)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenAccount={() => setIsAccountModalOpen(true)}
      />

      {/* Add / Edit Trade Popup Form Modal */}
      {(isAddTradeModalOpen || activeTab === 'add-trade') && (
        <TradeForm
          initialTrade={editingTrade}
          settings={settings}
          currentEquity={currentEquity}
          existingTrades={trades}
          onSave={handleSaveTrade}
          onCancel={() => {
            setEditingTrade(null);
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

      {/* Supabase Authentication Modal (Login, Signup, Forgot Password, Email Verification Notice) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          showToast(
            tr(`Berhasil masuk sebagai ${user.email}`, `Signed in as ${user.email}`)
          );
        }}
        onOpenConfig={() => {
          setIsAuthModalOpen(false);
          setIsSupabaseConfigOpen(true);
        }}
      />

      {/* User Account & Logout Confirmation Modal */}
      <UserAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        currentUser={currentUser}
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
    </div>
  );
}
