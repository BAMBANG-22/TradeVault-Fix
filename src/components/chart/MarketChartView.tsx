/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import {
  Cloud,
  CloudOff,
  LayoutTemplate,
  LogIn,
  Maximize2,
  Minimize2,
  Pencil,
  PanelTop,
  PanelTopClose,
  SlidersHorizontal,
  Smartphone,
  UserCheck,
  X,
} from 'lucide-react';
import { getSupabase } from '../../utils/supabaseClient';
import { isNativeAndroidOrIos } from '../../utils/apiConfig';
import type { Trade } from '../../types/trade';
import type { AppSettings } from '../../types/settings';
import { useLanguage } from '../../utils/language';
import { useTheme } from '../../utils/theme';
import {
  CHART_AUTO_FULLSCREEN_STORAGE_KEY,
  CHART_DISPLAY_MODE_STORAGE_KEY,
  CHART_ENGINE_MODE_STORAGE_KEY,
  CHART_PREFS_STORAGE_KEY,
  DEFAULT_CHART_PREFS,
  DEFAULT_TWELVE_DATA_API_KEY,
  INTERVAL_PRESETS,
  SYMBOL_PRESETS,
  TWELVE_DATA_API_KEY_STORAGE_KEY,
  WHEEL_PAIRS,
  WHEEL_TIMEFRAMES,
  computeChartWorkspaceLayout,
  formatBarCountdown,
  getMostRecentFridayCloseTimestamp,
  getScopedChartPrefsKey,
  getStoredTwelveDataApiKey,
  getTwelveDataInterval,
  isMarketOpenForPair,
  isValidDisplayMode,
  loadCachedCandles,
  loadStoredAutoFullscreen,
  loadStoredChartEngineMode,
  loadStoredChartPreferences,
  loadStoredDisplayMode,
  readActualViewportSize,
  sanitizeAndFilterCandles,
  sanitizeChartPreferences,
  saveStoredAutoFullscreen,
  saveStoredChartEngineMode,
  saveStoredChartPreferences,
  saveStoredDisplayMode,
  saveStoredTwelveDataApiKey,
  type CandleColorStyle,
  type ChartDisplayMode,
  type ChartEngineMode,
  type ComputedChartWorkspaceLayout,
  type MarketChartPreferences,
  type OhlcCandle,
  type ViewportSize,
  type WorkspaceBounds,
} from '../../utils/marketChartHelpers';

export {
  CHART_AUTO_FULLSCREEN_STORAGE_KEY,
  CHART_DISPLAY_MODE_STORAGE_KEY,
  CHART_ENGINE_MODE_STORAGE_KEY,
  CHART_PREFS_STORAGE_KEY,
  DEFAULT_CHART_PREFS,
  DEFAULT_TWELVE_DATA_API_KEY,
  INTERVAL_PRESETS,
  SYMBOL_PRESETS,
  TWELVE_DATA_API_KEY_STORAGE_KEY,
  WHEEL_PAIRS,
  WHEEL_TIMEFRAMES,
  computeChartWorkspaceLayout,
  formatBarCountdown,
  getMostRecentFridayCloseTimestamp,
  getScopedChartPrefsKey,
  getStoredTwelveDataApiKey,
  getTwelveDataInterval,
  isMarketOpenForPair,
  isValidDisplayMode,
  loadCachedCandles,
  loadStoredAutoFullscreen,
  loadStoredChartEngineMode,
  loadStoredChartPreferences,
  loadStoredDisplayMode,
  readActualViewportSize,
  sanitizeAndFilterCandles,
  sanitizeChartPreferences,
  saveStoredAutoFullscreen,
  saveStoredChartEngineMode,
  saveStoredChartPreferences,
  saveStoredDisplayMode,
  saveStoredTwelveDataApiKey,
  type CandleColorStyle,
  type ChartDisplayMode,
  type ChartEngineMode,
  type ComputedChartWorkspaceLayout,
  type MarketChartPreferences,
  type OhlcCandle,
  type ViewportSize,
  type WorkspaceBounds,
};

declare global {
  interface Window {
    TradeVaultSystemBars?: {
      setTheme?: (theme: 'light' | 'dark') => void;
      setScreenOrientation?: (mode: 'portrait' | 'landscape') => void;
      getNativeAppInfo?: () => string;
    };
  }
}

const VelaBetaChartView = lazy(() => import('./VelaBetaChartView'));

interface MarketChartViewProps {
  isActive?: boolean;
  currentUser?: any;
  trades?: Trade[];
  settings?: AppSettings;
  currentEquity?: number;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onCreateTradeFromPosition?: (tradeData: {
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
  }) => void;
}

function resolvePairWheelIndex(symbol: string): number {
  const clean = (symbol || '').trim().toUpperCase();
  const idx = WHEEL_PAIRS.findIndex((p) => p.symbol.toUpperCase() === clean);
  if (idx !== -1) return idx;
  const ticker = clean.replace(/^.*:/, '');
  const fallbackIdx = WHEEL_PAIRS.findIndex(
    (p) => p.label.toUpperCase() === ticker || p.symbol.endsWith(`:${ticker}`)
  );
  return fallbackIdx !== -1 ? fallbackIdx : 0;
}

function resolveTfWheelIndex(interval: string): number {
  const clean = (interval || '').trim();
  const idx = WHEEL_TIMEFRAMES.findIndex((tf) => tf.value === clean);
  return idx !== -1 ? idx : 3;
}

const CandleCountdownText: React.FC<{
  intervalSeconds: number;
  isMarketOpen: boolean;
}> = React.memo(({ intervalSeconds, isMarketOpen }) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isMarketOpen) return;
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [isMarketOpen]);

  if (!isMarketOpen) return null;

  return (
    <span
      data-testid="chart-candle-countdown"
      className="font-mono-numbers tabular-nums text-[11px] text-[#526071] dark:text-[#929BA9] whitespace-nowrap"
    >
      {formatBarCountdown(intervalSeconds, nowMs)}
    </span>
  );
});
CandleCountdownText.displayName = 'CandleCountdownText';

export interface TradingViewOandaWidgetProps {
  symbol: string;
  interval: string;
  theme?: 'dark' | 'light';
  locale?: 'id' | 'en';
  candleColorStyle?: CandleColorStyle;
  showLiveDrawingTools?: boolean;
  isLiveCleanView?: boolean;
  isActive?: boolean;
}

export const TradingViewOandaWidget: React.FC<TradingViewOandaWidgetProps> = React.memo(
  ({
    symbol,
    interval,
    theme = 'dark',
    locale = 'id',
    candleColorStyle = 'monochrome',
    showLiveDrawingTools = false,
    isLiveCleanView = false,
    isActive = true,
  }) => {
    const tvWidgetContainerRef = useRef<HTMLDivElement | null>(null);
    const mountedConfigKeyRef = useRef<string | null>(null);
    const lastSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
    const resizeRafRef = useRef<number | null>(null);
    const initRafRef = useRef<number | null>(null);

    const tvInterval = useMemo(() => {
      if (interval === '1' || interval === '3' || interval === '5' || interval === '15') return interval;
      if (interval === '60') return '60';
      if (interval === '240') return '240';
      if (interval === 'D' || interval === '1d') return 'D';
      return '15';
    }, [interval]);

    useEffect(() => {
      const container = tvWidgetContainerRef.current;
      if (!isActive) {
        if (container && container.innerHTML !== '') {
          container.innerHTML = '';
        }
        mountedConfigKeyRef.current = null;
        return;
      }
      if (!container) return;

      const nextConfigKey = `${symbol}|${tvInterval}|${theme}|${locale}|${candleColorStyle}|${
        showLiveDrawingTools ? '1' : '0'
      }|${isLiveCleanView ? '1' : '0'}|tvtouch_v4`;

      if (
        mountedConfigKeyRef.current === nextConfigKey &&
        container.querySelector('iframe') !== null
      ) {
        return;
      }

      const mountTradingViewWidget = () => {
        const host = tvWidgetContainerRef.current;
        if (!host) return;

        if (
          mountedConfigKeyRef.current === nextConfigKey &&
          host.querySelector('iframe') !== null
        ) {
          return;
        }

        mountedConfigKeyRef.current = nextConfigKey;
        host.innerHTML = '';

        const widgetContainer = document.createElement('div');
        widgetContainer.className = 'tradingview-widget-container__widget';
        widgetContainer.style.position = 'absolute';
        widgetContainer.style.inset = '0';
        widgetContainer.style.width = '100%';
        widgetContainer.style.height = '100%';
        widgetContainer.style.minHeight = '0';
        widgetContainer.style.minWidth = '0';
        widgetContainer.style.touchAction = 'none';
        widgetContainer.style.pointerEvents = 'none';
        host.appendChild(widgetContainer);

        const isMono = candleColorStyle !== 'classic';
        const isLightTheme = theme === 'light';
        const chartBg = isLightTheme ? '#FFFFFF' : '#050607';
        const scaleTextColor = isLightTheme ? '#526071' : '#929BA9';
        const scaleLineColor = isLightTheme ? '#E4E4E7' : '#1A1E26';
        const monoUpColor = '#FFFFFF';
        const monoDownColor = isLightTheme ? '#0F172A' : '#050607';
        const monoBorderColor = isLightTheme ? '#0F172A' : '#F2F4F7';

        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.type = 'text/javascript';
        script.async = true;
        script.innerHTML = JSON.stringify({
          autosize: true,
          symbol,
          interval: tvInterval,
          timezone: 'Asia/Bangkok',
          theme: isLightTheme ? 'light' : 'dark',
          style: '1',
          locale,
          allow_symbol_change: false,
          calendar: false,
          hide_top_toolbar: Boolean(isLiveCleanView),
          hide_legend: false,
          hide_side_toolbar: !showLiveDrawingTools,
          hide_volume: true,
          horztouchdrag: true,
          verttouchdrag: true,
          studies: [],
          save_image: true,
          backgroundColor: chartBg,
          gridColor: 'rgba(0, 0, 0, 0)',
          overrides: {
            'paneProperties.background': chartBg,
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': 'rgba(0, 0, 0, 0)',
            'paneProperties.horzGridProperties.color': 'rgba(0, 0, 0, 0)',
            'paneProperties.topMargin': 10,
            'paneProperties.bottomMargin': 8,
            'symbolWatermarkProperties.visibility': false,
            'symbolWatermarkProperties.color': 'rgba(0, 0, 0, 0)',
            'scalesProperties.textColor': scaleTextColor,
            'scalesProperties.fontSize': 10,
            'scalesProperties.lineColor': scaleLineColor,
            'volumePaneSize': 'tiny',
            'create_volume_indicator_by_default': false,
            'mainSeriesProperties.candleStyle.upColor': isMono ? monoUpColor : '#059669',
            'mainSeriesProperties.candleStyle.downColor': isMono ? monoDownColor : '#E11D48',
            'mainSeriesProperties.candleStyle.drawBorder': true,
            'mainSeriesProperties.candleStyle.borderColor': monoBorderColor,
            'mainSeriesProperties.candleStyle.borderUpColor': isMono ? monoBorderColor : '#059669',
            'mainSeriesProperties.candleStyle.borderDownColor': isMono ? monoBorderColor : '#E11D48',
            'mainSeriesProperties.candleStyle.wickUpColor': isMono ? monoBorderColor : '#059669',
            'mainSeriesProperties.candleStyle.wickDownColor': isMono ? monoBorderColor : '#E11D48',
          },
          support_host: 'https://www.tradingview.com',
        });

        host.appendChild(script);
      };

      if (container.clientWidth > 0 && container.clientHeight > 0) {
        mountTradingViewWidget();
      } else {
        if (initRafRef.current !== null) {
          window.cancelAnimationFrame(initRafRef.current);
        }
        initRafRef.current = window.requestAnimationFrame(() => {
          initRafRef.current = null;
          mountTradingViewWidget();
        });
      }

      return () => {
        if (initRafRef.current !== null) {
          window.cancelAnimationFrame(initRafRef.current);
          initRafRef.current = null;
        }
      };
    }, [isActive, symbol, tvInterval, theme, locale, candleColorStyle, showLiveDrawingTools, isLiveCleanView]);

    useEffect(() => {
      const container = tvWidgetContainerRef.current;
      return () => {
        if (initRafRef.current !== null) {
          window.cancelAnimationFrame(initRafRef.current);
          initRafRef.current = null;
        }
        if (resizeRafRef.current !== null) {
          window.cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
        mountedConfigKeyRef.current = null;
        if (container) {
          container.innerHTML = '';
        }
      };
    }, []);

    useEffect(() => {
      const container = tvWidgetContainerRef.current;
      if (!container || typeof ResizeObserver === 'undefined') return;

      const enforceIframeTouchStyles = (): boolean => {
        const widgetHost = container.querySelector<HTMLElement>(
          '.tradingview-widget-container__widget'
        );
        if (widgetHost) {
          widgetHost.style.position = 'absolute';
          widgetHost.style.inset = '0';
          widgetHost.style.width = '100%';
          widgetHost.style.height = '100%';
          widgetHost.style.pointerEvents = 'none';
          widgetHost.style.touchAction = 'none';
        }

        const iframeEl = container.querySelector<HTMLIFrameElement>('iframe');
        if (iframeEl) {
          iframeEl.style.position = 'absolute';
          iframeEl.style.inset = '0';
          iframeEl.style.display = 'block';
          iframeEl.style.width = '100%';
          iframeEl.style.height = '100%';
          iframeEl.style.border = '0';
          iframeEl.style.zIndex = '20';
          iframeEl.style.pointerEvents = 'auto';
          iframeEl.style.touchAction = 'none';
          return true;
        }
        return false;
      };

      const syncDimensions = () => {
        const nextWidth = Math.round(container.clientWidth);
        const nextHeight = Math.round(container.clientHeight);
        if (nextWidth <= 0 || nextHeight <= 0) return;

        enforceIframeTouchStyles();

        if (
          nextWidth === lastSizeRef.current.width &&
          nextHeight === lastSizeRef.current.height
        ) {
          return;
        }

        lastSizeRef.current = { width: nextWidth, height: nextHeight };
        container.dataset.widgetWidth = String(nextWidth);
        container.dataset.widgetHeight = String(nextHeight);
      };

      syncDimensions();

      const observer = new ResizeObserver(() => {
        if (resizeRafRef.current !== null) {
          window.cancelAnimationFrame(resizeRafRef.current);
        }
        resizeRafRef.current = window.requestAnimationFrame(() => {
          resizeRafRef.current = null;
          syncDimensions();
        });
      });

      observer.observe(container);

      const mutationObserver =
        typeof MutationObserver !== 'undefined'
          ? new MutationObserver(() => {
              enforceIframeTouchStyles();
            })
          : null;

      mutationObserver?.observe(container, { childList: true, subtree: false });

      return () => {
        observer.disconnect();
        mutationObserver?.disconnect();
        if (resizeRafRef.current !== null) {
          window.cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
      };
    }, []);

    return (
      <div
        ref={tvWidgetContainerRef}
        data-testid="tradingview-oanda-widget-container"
        className="tradingview-widget-container absolute inset-0 w-full h-full min-h-0 min-w-0 z-10 bg-white dark:bg-[#050607] overflow-hidden overscroll-none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          touchAction: 'none',
          pointerEvents: 'auto',
        }}
      />
    );
  }
);
TradingViewOandaWidget.displayName = 'TradingViewOandaWidget';

export const MarketChartView: React.FC<MarketChartViewProps> = ({
  isActive = true,
  currentUser = null,
  onOpenAuth,
  onOpenAccount,
}) => {
  const { language } = useLanguage();
  const { isDark } = useTheme();
  const isEn = language === 'en';
  const tr = useCallback((idText: string, enText: string) => (isEn ? enText : idText), [isEn]);

  const activeUserId: string | null = currentUser?.id || null;

  const [prefs, setPrefs] = useState<MarketChartPreferences>(() =>
    loadStoredChartPreferences(activeUserId)
  );
  const [chartEngineMode, setChartEngineMode] = useState<ChartEngineMode>(() =>
    loadStoredChartEngineMode()
  );
  const [autoFullscreenOnOpen, setAutoFullscreenOnOpen] = useState<boolean>(() =>
    loadStoredAutoFullscreen()
  );
  const [displayMode, setDisplayMode] = useState<ChartDisplayMode>(() => {
    const storedAuto = loadStoredAutoFullscreen();
    const storedDisplay = loadStoredDisplayMode();
    if (storedAuto) {
      return storedDisplay === 'landscape' ? 'landscape' : 'full';
    }
    return storedDisplay;
  });

  const [showLiveDrawingTools, setShowLiveDrawingTools] = useState<boolean>(false);
  const [isLiveCleanView, setIsLiveCleanView] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => getStoredTwelveDataApiKey());
  const [apiKeySavedToast, setApiKeySavedToast] = useState<boolean>(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>(
    'idle'
  );

  // Pair & Timeframe wheel picker state (Live Mode bottom bar)
  const [wheelPairIndex, setWheelPairIndex] = useState<number>(() =>
    resolvePairWheelIndex(prefs.symbol)
  );
  const [wheelTfIndex, setWheelTfIndex] = useState<number>(() =>
    resolveTfWheelIndex(prefs.interval)
  );

  const [viewport, setViewport] = useState<ViewportSize>(() => readActualViewportSize());
  const [bounds, setBounds] = useState<WorkspaceBounds>({ top: 56, bottom: 58, left: 0 });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const wasActiveRef = useRef<boolean>(false);
  const wheelDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pairTouchStartYRef = useRef<number | null>(null);
  const pairTouchMovedRef = useRef<boolean>(false);
  const tfTouchStartYRef = useRef<number | null>(null);
  const tfTouchMovedRef = useRef<boolean>(false);

  const isLiveMode = chartEngineMode === 'live_oanda';
  const isVelaReplayMode = chartEngineMode === 'vela_replay';
  const isImmersive = displayMode !== 'normal';

  const activePairMeta = useMemo(
    () => WHEEL_PAIRS[resolvePairWheelIndex(prefs.symbol)] || WHEEL_PAIRS[0],
    [prefs.symbol]
  );
  const activeTfMeta = useMemo(
    () => WHEEL_TIMEFRAMES[resolveTfWheelIndex(prefs.interval)] || WHEEL_TIMEFRAMES[3],
    [prefs.interval]
  );
  const marketStatus = useMemo(
    () => isMarketOpenForPair(activePairMeta.label),
    [activePairMeta.label]
  );

  const activePairItem = WHEEL_PAIRS[wheelPairIndex] || WHEEL_PAIRS[0];
  const prevPairItem =
    WHEEL_PAIRS[(wheelPairIndex - 1 + WHEEL_PAIRS.length) % WHEEL_PAIRS.length];
  const nextPairItem = WHEEL_PAIRS[(wheelPairIndex + 1) % WHEEL_PAIRS.length];

  const activeTfItem = WHEEL_TIMEFRAMES[wheelTfIndex] || WHEEL_TIMEFRAMES[3];
  const prevTfItem =
    WHEEL_TIMEFRAMES[(wheelTfIndex - 1 + WHEEL_TIMEFRAMES.length) % WHEEL_TIMEFRAMES.length];
  const nextTfItem = WHEEL_TIMEFRAMES[(wheelTfIndex + 1) % WHEEL_TIMEFRAMES.length];

  const handleSetChartEngineMode = useCallback((mode: ChartEngineMode) => {
    setChartEngineMode(mode);
    saveStoredChartEngineMode(mode);
  }, []);

  const requestBrowserFullscreenSafely = useCallback(() => {
    if (typeof document === 'undefined') return;
    // On native Android/iOS Capacitor APK, CSS immersive mode already fills 100% of the
    // bounded WebView cleanly; calling DOM requestFullscreen can cause WebChromeClient flicker.
    if (isNativeAndroidOrIos()) return;
    try {
      const docAny = document as any;
      if (docAny.fullscreenElement || docAny.webkitFullscreenElement) return;
      const el = document.documentElement as any;
      if (typeof el.requestFullscreen === 'function') {
        void el.requestFullscreen().catch(() => {});
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        el.webkitRequestFullscreen();
      }
    } catch {
      // Gracefully fall back to CSS full-viewport mode
    }
  }, []);

  const exitBrowserFullscreenSafely = useCallback(() => {
    if (typeof document === 'undefined') return;
    try {
      const docAny = document as any;
      if (docAny.fullscreenElement && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => {});
      } else if (
        docAny.webkitFullscreenElement &&
        typeof docAny.webkitExitFullscreen === 'function'
      ) {
        docAny.webkitExitFullscreen();
      }
    } catch {
      // Ignore fullscreen exit errors
    }
  }, []);

  const applyDisplayMode = useCallback(
    (nextMode: ChartDisplayMode, triggerBrowserFullscreen = false) => {
      setDisplayMode(nextMode);
      saveStoredDisplayMode(nextMode);
      if (nextMode === 'normal') {
        exitBrowserFullscreenSafely();
      } else if (triggerBrowserFullscreen) {
        requestBrowserFullscreenSafely();
      }
    },
    [exitBrowserFullscreenSafely, requestBrowserFullscreenSafely]
  );

  const handleToggleFullscreen = useCallback(() => {
    if (displayMode === 'normal') {
      applyDisplayMode('full', true);
    } else {
      applyDisplayMode('normal', false);
    }
  }, [applyDisplayMode, displayMode]);

  const handleToggleAutoFullscreen = useCallback(() => {
    setAutoFullscreenOnOpen((prev) => {
      const next = !prev;
      saveStoredAutoFullscreen(next);
      return next;
    });
  }, []);

  // Automatically enter Fullscreen whenever Market Chart tab is opened (if enabled)
  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      if (autoFullscreenOnOpen) {
        setDisplayMode((prev) => (prev === 'landscape' ? 'landscape' : 'full'));
      }
    } else if (!isActive && wasActiveRef.current) {
      setIsSettingsOpen(false);
      exitBrowserFullscreenSafely();
    }
    wasActiveRef.current = isActive;
  }, [isActive, autoFullscreenOnOpen, exitBrowserFullscreenSafely]);

  // Keyboard Escape handler: closes settings popover first, then exits fullscreen cleanly
  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return;
      }
      if (displayMode !== 'normal') {
        applyDisplayMode('normal', false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive, isSettingsOpen, displayMode, applyDisplayMode]);

  // Sync wheel indices when prefs change
  useEffect(() => {
    setWheelPairIndex(resolvePairWheelIndex(prefs.symbol));
  }, [prefs.symbol]);

  useEffect(() => {
    setWheelTfIndex(resolveTfWheelIndex(prefs.interval));
  }, [prefs.interval]);

  // Load account-synced chart preferences when user logs in
  useEffect(() => {
    const localForUser = loadStoredChartPreferences(activeUserId);
    const cloudRaw = currentUser?.user_metadata?.tradevault_chart_prefs;

    if (cloudRaw && typeof cloudRaw === 'object') {
      const cloudPrefs = sanitizeChartPreferences(cloudRaw);
      const merged =
        !localForUser.updatedAt ||
        (cloudPrefs.updatedAt && cloudPrefs.updatedAt >= localForUser.updatedAt)
          ? cloudPrefs
          : localForUser;

      setPrefs(merged);
      saveStoredChartPreferences(merged, activeUserId);
      setCloudSyncStatus('synced');
    } else {
      setPrefs(localForUser);
      setCloudSyncStatus(activeUserId ? 'synced' : 'idle');
    }
  }, [activeUserId, currentUser?.user_metadata?.tradevault_chart_prefs]);

  const syncPrefsToCloudAccount = useCallback(
    async (nextPrefs: MarketChartPreferences) => {
      if (!activeUserId) return;
      const client = getSupabase();
      if (!client) return;

      setCloudSyncStatus('syncing');
      try {
        const { error } = await client.auth.updateUser({
          data: { tradevault_chart_prefs: nextPrefs },
        });
        setCloudSyncStatus(error ? 'error' : 'synced');
      } catch {
        setCloudSyncStatus('error');
      }
    },
    [activeUserId]
  );

  const updatePrefs = useCallback(
    (updater: (prev: MarketChartPreferences) => MarketChartPreferences) => {
      setPrefs((prev) => {
        const next: MarketChartPreferences = {
          ...updater(prev),
          backgroundColor: '#000000',
          hideTopToolbar: true,
          updatedAt: new Date().toISOString(),
        };
        saveStoredChartPreferences(next, activeUserId);
        if (activeUserId) {
          if (cloudSyncTimeoutRef.current) clearTimeout(cloudSyncTimeoutRef.current);
          cloudSyncTimeoutRef.current = setTimeout(() => {
            void syncPrefsToCloudAccount(next);
          }, 600);
        }
        return next;
      });
    },
    [activeUserId, syncPrefsToCloudAccount]
  );

  const scheduleWheelCommit = useCallback(
    (nextPairIdx: number, nextTfIdx: number) => {
      if (wheelDebounceRef.current) {
        clearTimeout(wheelDebounceRef.current);
      }
      wheelDebounceRef.current = setTimeout(() => {
        const selectedPair = WHEEL_PAIRS[nextPairIdx] || WHEEL_PAIRS[0];
        const selectedTf = WHEEL_TIMEFRAMES[nextTfIdx] || WHEEL_TIMEFRAMES[3];
        updatePrefs((prev) => {
          if (prev.symbol === selectedPair.symbol && prev.interval === selectedTf.value) {
            return prev;
          }
          return {
            ...prev,
            symbol: selectedPair.symbol,
            interval: selectedTf.value,
          };
        });
      }, 260);
    },
    [updatePrefs]
  );

  const stepPairWheel = useCallback(
    (delta: number) => {
      setWheelPairIndex((prevIdx) => {
        const len = WHEEL_PAIRS.length;
        const nextIdx = (prevIdx + delta + len) % len;
        scheduleWheelCommit(nextIdx, wheelTfIndex);
        return nextIdx;
      });
    },
    [scheduleWheelCommit, wheelTfIndex]
  );

  const stepTfWheel = useCallback(
    (delta: number) => {
      setWheelTfIndex((prevIdx) => {
        const len = WHEEL_TIMEFRAMES.length;
        const nextIdx = (prevIdx + delta + len) % len;
        scheduleWheelCommit(wheelPairIndex, nextIdx);
        return nextIdx;
      });
    },
    [scheduleWheelCommit, wheelPairIndex]
  );

  const handlePairTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      pairTouchStartYRef.current = e.touches[0].clientY;
      pairTouchMovedRef.current = false;
    }
  };
  const handlePairTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pairTouchStartYRef.current === null || e.touches.length === 0) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - pairTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      pairTouchMovedRef.current = true;
      pairTouchStartYRef.current = currentY;
      stepPairWheel(deltaY < 0 ? 1 : -1);
    }
  };
  const handlePairPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pairTouchStartYRef.current = e.clientY;
    pairTouchMovedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };
  const handlePairPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pairTouchStartYRef.current === null) return;
    const currentY = e.clientY;
    const deltaY = currentY - pairTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      pairTouchMovedRef.current = true;
      pairTouchStartYRef.current = currentY;
      stepPairWheel(deltaY < 0 ? 1 : -1);
    }
  };
  const handlePairPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pairTouchStartYRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };

  const handleTfTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      tfTouchStartYRef.current = e.touches[0].clientY;
      tfTouchMovedRef.current = false;
    }
  };
  const handleTfTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (tfTouchStartYRef.current === null || e.touches.length === 0) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - tfTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      tfTouchMovedRef.current = true;
      tfTouchStartYRef.current = currentY;
      stepTfWheel(deltaY < 0 ? 1 : -1);
    }
  };
  const handleTfPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    tfTouchStartYRef.current = e.clientY;
    tfTouchMovedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };
  const handleTfPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tfTouchStartYRef.current === null) return;
    const currentY = e.clientY;
    const deltaY = currentY - tfTouchStartYRef.current;
    if (Math.abs(deltaY) >= 12) {
      tfTouchMovedRef.current = true;
      tfTouchStartYRef.current = currentY;
      stepTfWheel(deltaY < 0 ? 1 : -1);
    }
  };
  const handleTfPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    tfTouchStartYRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };

  // Prevent host page scroll/overscroll while Market Chart is active
  useEffect(() => {
    if (!isActive || typeof document === 'undefined') return;

    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    const prevHtmlOverflow = htmlEl.style.overflow;
    const prevHtmlOverscroll = htmlEl.style.overscrollBehavior;
    const prevHtmlTouchAction = htmlEl.style.touchAction;
    const prevBodyOverflow = bodyEl.style.overflow;
    const prevBodyOverscroll = bodyEl.style.overscrollBehavior;
    const prevBodyTouchAction = bodyEl.style.touchAction;

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    htmlEl.style.overflow = 'hidden';
    htmlEl.style.overscrollBehavior = 'none';
    htmlEl.style.touchAction = 'none';
    bodyEl.style.overflow = 'hidden';
    bodyEl.style.overscrollBehavior = 'none';
    bodyEl.style.touchAction = 'none';

    const preventHostPagePinchZoom = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 1 && e.cancelable) {
        const targetEl = e.target as HTMLElement | null;
        if (targetEl && typeof targetEl.closest === 'function' && targetEl.closest('[data-testid="vela-workspace-host"]')) {
          return;
        }
        e.preventDefault();
      }
    };
    const preventHostGestureZoom = (e: Event) => {
      if (e.cancelable) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', preventHostPagePinchZoom, { passive: false });
    document.addEventListener('gesturestart', preventHostGestureZoom, { passive: false });
    document.addEventListener('gesturechange', preventHostGestureZoom, { passive: false });
    document.addEventListener('gestureend', preventHostGestureZoom, { passive: false });

    return () => {
      document.removeEventListener('touchmove', preventHostPagePinchZoom);
      document.removeEventListener('gesturestart', preventHostGestureZoom);
      document.removeEventListener('gesturechange', preventHostGestureZoom);
      document.removeEventListener('gestureend', preventHostGestureZoom);
      htmlEl.style.overflow = prevHtmlOverflow;
      htmlEl.style.overscrollBehavior = prevHtmlOverscroll;
      htmlEl.style.touchAction = prevHtmlTouchAction;
      bodyEl.style.overflow = prevBodyOverflow;
      bodyEl.style.overscrollBehavior = prevBodyOverscroll;
      bodyEl.style.touchAction = prevBodyTouchAction;
    };
  }, [isActive]);

  // Hide app Navbar, Sidebar, and Bottom Nav in Fullscreen / Landscape modes + orientation lock
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (isActive && displayMode === 'landscape') {
      try {
        window.TradeVaultSystemBars?.setScreenOrientation?.('landscape');
        const screenAny = window.screen as any;
        if (screenAny?.orientation?.lock) {
          void screenAny.orientation.lock('landscape').catch(() => {});
        }
      } catch {
        // ignore on desktop
      }
    } else {
      try {
        window.TradeVaultSystemBars?.setScreenOrientation?.('portrait');
        const screenAny = window.screen as any;
        if (screenAny?.orientation?.unlock) {
          screenAny.orientation.unlock();
        }
      } catch {
        // ignore
      }
      if (!isActive) {
        exitBrowserFullscreenSafely();
      }
    }

    const isImmersiveActive = Boolean(isActive && displayMode !== 'normal');
    if (!isImmersiveActive) return;

    const headerEl = document.querySelector<HTMLElement>('[data-testid="app-header"]');
    const sidebarEl = document.querySelector<HTMLElement>('[data-testid="desktop-sidebar"]');
    const mobileNavEl = document.querySelector<HTMLElement>('nav[aria-label="Navigasi Utama Bawah"]');

    const elements = [headerEl, sidebarEl, mobileNavEl].filter(
      (el): el is HTMLElement => el !== null
    );
    const savedStyles = elements.map((el) => ({
      el,
      visibility: el.style.visibility,
      pointerEvents: el.style.pointerEvents,
    }));

    for (const { el } of savedStyles) {
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
    }

    return () => {
      for (const { el, visibility, pointerEvents } of savedStyles) {
        el.style.visibility = visibility;
        el.style.pointerEvents = pointerEvents;
      }
      try {
        window.TradeVaultSystemBars?.setScreenOrientation?.('portrait');
      } catch {
        // ignore
      }
    };
  }, [isActive, displayMode, exitBrowserFullscreenSafely]);

  const measureViewportAndBounds = useCallback((): ViewportSize => {
    const actualViewport = readActualViewportSize();

    setViewport((prev) => {
      if (prev.width === actualViewport.width && prev.height === actualViewport.height) {
        return prev;
      }
      return actualViewport;
    });

    if (typeof document !== 'undefined' && typeof window !== 'undefined' && displayMode === 'normal') {
      const vh = actualViewport.height;
      const headerEl = document.querySelector<HTMLElement>('[data-testid="app-header"]');
      const sidebarEl = document.querySelector<HTMLElement>('[data-testid="desktop-sidebar"]');
      const mobileNavEl = document.querySelector<HTMLElement>(
        'nav[aria-label="Navigasi Utama Bawah"]'
      );

      const top = headerEl ? Math.max(0, Math.floor(headerEl.getBoundingClientRect().bottom)) : 56;

      let left = 0;
      if (sidebarEl) {
        const sidebarRect = sidebarEl.getBoundingClientRect();
        if (sidebarRect.width > 0 && window.getComputedStyle(sidebarEl).display !== 'none') {
          left = Math.max(0, Math.floor(sidebarRect.right));
        }
      }

      let bottom = 0;
      if (mobileNavEl) {
        const navRect = mobileNavEl.getBoundingClientRect();
        if (navRect.height > 0 && window.getComputedStyle(mobileNavEl).display !== 'none') {
          bottom = Math.max(Math.ceil(navRect.height), Math.ceil(vh - navRect.top));
        }
      }

      setBounds((prev) => {
        if (prev.top === top && prev.bottom === bottom && prev.left === left) {
          return prev;
        }
        return { top, bottom, left };
      });
    }

    return actualViewport;
  }, [displayMode]);

  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return;

    measureViewportAndBounds();
    const rafId = window.requestAnimationFrame(() => measureViewportAndBounds());
    const t1 = window.setTimeout(() => measureViewportAndBounds(), 120);

    const onResize = () => measureViewportAndBounds();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(t1);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [isActive, displayMode, measureViewportAndBounds]);

  useEffect(() => {
    return () => {
      if (wheelDebounceRef.current) clearTimeout(wheelDebounceRef.current);
      if (cloudSyncTimeoutRef.current) clearTimeout(cloudSyncTimeoutRef.current);
    };
  }, []);

  const workspaceLayout = useMemo(
    () => computeChartWorkspaceLayout(displayMode, viewport, bounds),
    [displayMode, viewport, bounds]
  );

  const safeAreaStyle: React.CSSProperties = useMemo(() => {
    if (!workspaceLayout.isImmersive) return {};
    return {
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      paddingLeft: 'env(safe-area-inset-left, 0px)',
      paddingRight: 'env(safe-area-inset-right, 0px)',
    };
  }, [workspaceLayout.isImmersive]);

  const displayModeOptions: Array<{
    id: ChartDisplayMode;
    label: string;
    Icon: typeof LayoutTemplate;
  }> = [
    { id: 'normal', label: tr('App', 'App'), Icon: LayoutTemplate },
    { id: 'full', label: tr('Penuh', 'Full'), Icon: Maximize2 },
    { id: 'landscape', label: 'Landscape', Icon: Smartphone },
  ];

  return (
    <section
      ref={viewportRef}
      data-testid="market-chart-view"
      data-display-mode={displayMode}
      aria-label="Market Chart Workspace"
      style={{
        position: 'fixed',
        top: workspaceLayout.top,
        left: workspaceLayout.left,
        width: `${workspaceLayout.width}px`,
        height: `${workspaceLayout.height}px`,
        zIndex: workspaceLayout.zIndex,
        ...safeAreaStyle,
      }}
      className="fixed flex flex-col min-h-0 min-w-0 overflow-hidden overscroll-none bg-white dark:bg-[#050607] text-[#0F172A] dark:text-[#F2F4F7]"
    >
      {/* Unified Architectural Top Header */}
      <header
        data-testid="chart-top-sub-bar"
        className="h-11 shrink-0 w-full bg-white dark:bg-[#0C0F14] border-b border-[#E4E4E7] dark:border-[#20252D] px-3 sm:px-4 flex items-center justify-between gap-3 z-30 select-none"
      >
        {/* Zone 1: Clean Instrument Typography & Quiet Unboxed Metadata */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            data-testid="chart-header-symbol-label"
            className="text-[13px] font-semibold tracking-tight text-[#0F172A] dark:text-[#F2F4F7] whitespace-nowrap"
          >
            {activePairItem.label}
          </span>

          {isLiveMode && (
            <>
              <span aria-hidden="true" className="text-[#CBD5E1] dark:text-[#333B48] text-xs">
                /
              </span>
              <span className="text-xs font-mono-numbers tabular-nums font-medium text-[#526071] dark:text-[#929BA9] whitespace-nowrap">
                {activeTfItem.label}
              </span>
            </>
          )}

          <span
            data-testid="chart-header-instrument-name"
            className="hidden md:inline text-[11px] text-[#526071] dark:text-[#929BA9] truncate"
          >
            · {activePairItem.sourceLabel}
          </span>

          <span
            aria-hidden="true"
            className="hidden sm:inline text-[#CBD5E1] dark:text-[#333B48] text-xs"
          >
            ·
          </span>

          {marketStatus.isOpen ? (
            <div className="hidden sm:flex items-center gap-1.5 whitespace-nowrap">
              <span
                data-testid="chart-live-status-badge"
                className="text-[11px] font-medium text-[#059669] dark:text-[#00A878]"
              >
                Live
              </span>
              {isLiveMode && (
                <>
                  <span aria-hidden="true" className="text-[#CBD5E1] dark:text-[#333B48] text-xs">
                    ·
                  </span>
                  <CandleCountdownText
                    intervalSeconds={activeTfMeta.seconds}
                    isMarketOpen={marketStatus.isOpen}
                  />
                </>
              )}
            </div>
          ) : (
            <span
              data-testid="chart-closed-status-badge"
              className="hidden sm:inline text-[11px] font-medium text-[#526071] dark:text-[#929BA9] whitespace-nowrap"
              title={tr(
                'Pasar tutup akhir pekan (Sabtu–Minggu).',
                'Market closed on weekends (Sat–Sun).'
              )}
            >
              {tr('Tutup', 'Closed')}
            </span>
          )}
        </div>

        {/* Zone 2: Minimalist 2-Engine Segmented Switcher (Live | Vela Replay) */}
        <div
          data-testid="chart-engine-mode-switcher"
          role="tablist"
          aria-label={tr('Pilih mode chart', 'Select chart mode')}
          className="inline-flex items-center p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D] shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={isLiveMode}
            data-testid="engine-mode-live-oanda-btn"
            onClick={() => handleSetChartEngineMode('live_oanda')}
            className={`h-7 px-3 rounded-md text-[11px] font-medium tracking-tight transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
              isLiveMode
                ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
            }`}
          >
            Live
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={isVelaReplayMode}
            data-testid="engine-mode-vela-replay-btn"
            onClick={() => handleSetChartEngineMode('vela_replay')}
            className={`h-7 px-3 rounded-md text-[11px] font-medium tracking-tight transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
              isVelaReplayMode
                ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
            }`}
          >
            Vela Replay
          </button>
        </div>

        {/* Zone 3: Focused Utility Actions (Settings + Fullscreen) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="market-chart-settings-button"
            onClick={() => setIsSettingsOpen((prev) => !prev)}
            aria-label={tr('Pengaturan Chart', 'Chart Settings')}
            aria-expanded={isSettingsOpen}
            title={tr('Pengaturan tampilan, layar penuh & API Key', 'Display, fullscreen & API settings')}
            className={`inline-flex items-center justify-center h-8 w-8 rounded-lg border transition-colors cursor-pointer touch-manipulation ${
              isSettingsOpen
                ? 'bg-[#0F172A] border-[#0F172A] text-white dark:bg-[#F2F4F7] dark:border-[#F2F4F7] dark:text-[#050607]'
                : 'bg-transparent border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            data-testid="chart-fullscreen-toggle-btn"
            onClick={handleToggleFullscreen}
            aria-label={
              isImmersive
                ? tr('Keluar Layar Penuh', 'Exit Fullscreen')
                : tr('Buka Layar Penuh', 'Enter Fullscreen')
            }
            aria-pressed={isImmersive}
            title={
              isImmersive
                ? tr('Keluar dari Layar Penuh (Esc)', 'Exit Fullscreen (Esc)')
                : tr('Tampilkan Chart Layar Penuh', 'Expand Chart to Fullscreen')
            }
            className={`inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
              isImmersive
                ? 'px-2.5 bg-[#0F172A] border-[#0F172A] text-white dark:bg-[#F2F4F7] dark:border-[#F2F4F7] dark:text-[#050607]'
                : 'w-8 sm:w-auto sm:px-2.5 bg-transparent border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#FAFAFA] dark:hover:bg-[#161A22]'
            }`}
          >
            {isImmersive ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden xs:inline sm:inline">{tr('Keluar', 'Exit')}</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{tr('Penuh', 'Full')}</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Primary Chart Viewport */}
      <div
        data-testid="market-chart-viewport"
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          minWidth: 0,
          touchAction: isVelaReplayMode ? 'auto' : 'none',
          WebkitOverflowScrolling: 'touch',
          pointerEvents: 'auto',
        }}
        className={`relative flex-1 flex flex-col w-full h-full min-h-0 min-w-0 overflow-hidden bg-white dark:bg-[#050607] ${
          isVelaReplayMode ? 'touch-auto' : 'touch-none'
        }`}
      >
        {/* Engine 1: Live TradingView Advanced Chart (Persistent single iframe) */}
        <div
          data-testid="live-oanda-widget-overlay"
          aria-hidden={!isLiveMode}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            visibility: isLiveMode ? 'visible' : 'hidden',
            opacity: isLiveMode ? 1 : 0,
            zIndex: isLiveMode ? 10 : -1,
            touchAction: 'none',
            pointerEvents: isLiveMode ? 'auto' : 'none',
          }}
          className={
            isLiveMode
              ? 'absolute inset-0 w-full h-full z-10 bg-white dark:bg-[#050607] overflow-hidden overscroll-none touch-none'
              : 'absolute inset-0 w-full h-full -z-10 opacity-0 invisible pointer-events-none overflow-hidden touch-none'
          }
        >
          <TradingViewOandaWidget
            symbol={prefs.symbol}
            interval={prefs.interval}
            theme={isDark ? 'dark' : 'light'}
            locale={isEn ? 'en' : 'id'}
            candleColorStyle={prefs.candleColorStyle}
            showLiveDrawingTools={showLiveDrawingTools}
            isLiveCleanView={isLiveCleanView}
            isActive={isActive && isLiveMode}
          />
        </div>

        {/* Engine 2: Vela Replay Workspace (Lazy-loaded, sole replay engine) */}
        {isVelaReplayMode && (
          <Suspense
            fallback={
              <div
                data-testid="vela-beta-loading"
                className="absolute inset-0 z-15 flex flex-col items-center justify-center gap-3 bg-white dark:bg-[#050607] text-[#526071] dark:text-[#929BA9] text-xs"
              >
                <div className="h-5 w-5 rounded-full border-2 border-[#E4E4E7] dark:border-[#20252D] border-t-[#0F172A] dark:border-t-[#F2F4F7] animate-spin" />
                <span>{tr('Menyiapkan Vela Replay...', 'Preparing Vela Replay...')}</span>
              </div>
            }
          >
            <VelaBetaChartView
              symbol={prefs.symbol}
              interval={prefs.interval}
              isDark={isDark}
              isEn={isEn}
              onSwitchToLive={() => handleSetChartEngineMode('live_oanda')}
            />
          </Suspense>
        )}

        {/* Minimalist Floating Chart Settings Popover */}
        {isSettingsOpen && (
          <div
            data-testid="market-chart-settings-backdrop"
            className="absolute inset-0 z-40 bg-black/20 dark:bg-black/45 flex items-start justify-end p-3"
            onClick={() => setIsSettingsOpen(false)}
          >
            <div
              data-testid="market-chart-settings-popover"
              role="dialog"
              aria-modal="true"
              aria-label={tr('Pengaturan Market Chart', 'Market Chart Settings')}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[330px] max-h-[calc(100%-0.5rem)] overflow-y-auto rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_14px_36px_-10px_rgba(15,23,42,0.18)] dark:shadow-[0_18px_44px_-10px_rgba(0,0,0,0.75)] text-[#0F172A] dark:text-[#F2F4F7] text-xs select-none animate-in fade-in duration-150"
            >
              {/* Popover Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-white dark:bg-[#101318] border-b border-[#E4E4E7] dark:border-[#20252D]">
                <h2 className="text-[13px] font-semibold tracking-tight">
                  {tr('Pengaturan Chart', 'Chart Settings')}
                </h2>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  aria-label={tr('Tutup pengaturan', 'Close settings')}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* 1. Screen Mode & Auto-Fullscreen on Open */}
                <div className="space-y-2.5">
                  <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] block">
                    {tr('Mode Layar', 'Screen Mode')}
                  </span>

                  <div className="grid grid-cols-3 p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]">
                    {displayModeOptions.map(({ id, label, Icon }) => {
                      const isSelected = displayMode === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          data-testid={`chart-mode-option-${id}`}
                          onClick={() => {
                            applyDisplayMode(id, id === 'full');
                            measureViewportAndBounds();
                          }}
                          className={`h-8 rounded-md text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                              : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                          }`}
                        >
                          <Icon className={`h-3 w-3 ${id === 'landscape' ? 'rotate-90' : ''}`} />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Auto-Fullscreen on Open Toggle */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="min-w-0">
                      <span className="text-xs font-medium block text-[#0F172A] dark:text-[#F2F4F7]">
                        {tr('Layar penuh saat buka chart', 'Auto fullscreen on open')}
                      </span>
                      <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                        {tr(
                          'Langsung memaksimalkan kanvas saat tab dibuka',
                          'Automatically expands canvas when opening chart'
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoFullscreenOnOpen}
                      data-testid="toggle-auto-fullscreen-on-open"
                      onClick={handleToggleAutoFullscreen}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                        autoFullscreenOnOpen
                          ? 'bg-[#0F172A] dark:bg-[#F2F4F7]'
                          : 'bg-[#E4E4E7] dark:bg-[#20252D]'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                          autoFullscreenOnOpen
                            ? 'translate-x-[18px] bg-white dark:bg-[#050607]'
                            : 'translate-x-[3px] bg-white dark:bg-[#929BA9]'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* 2. Live Chart Appearance (Shown in Live Mode) */}
                {isLiveMode && (
                  <div className="space-y-2.5 pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
                    <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] block">
                      {tr('Gaya Candlestick Live', 'Live Candlestick Style')}
                    </span>
                    <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]">
                      <button
                        type="button"
                        data-testid="candle-style-monochrome-btn"
                        onClick={() =>
                          updatePrefs((prev) => ({ ...prev, candleColorStyle: 'monochrome' }))
                        }
                        className={`h-8 rounded-md text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          prefs.candleColorStyle !== 'classic'
                            ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                            : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                        }`}
                      >
                        <span className="h-2.5 w-2.5 rounded-xs bg-white border border-[#0F172A]" />
                        <span>{tr('Monokrom', 'Monochrome')}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="candle-style-classic-btn"
                        onClick={() =>
                          updatePrefs((prev) => ({ ...prev, candleColorStyle: 'classic' }))
                        }
                        className={`h-8 rounded-md text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          prefs.candleColorStyle === 'classic'
                            ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                            : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                        }`}
                      >
                        <span className="h-2.5 w-2.5 rounded-xs bg-[#059669]" />
                        <span>{tr('Hijau / Merah', 'Green / Red')}</span>
                      </button>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <button
                        type="button"
                        data-testid="toggle-live-clean-view"
                        onClick={() => setIsLiveCleanView((prev) => !prev)}
                        className="w-full h-8 px-3 rounded-lg border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0D11] text-[11px] flex items-center justify-between text-[#0F172A] dark:text-[#F2F4F7] cursor-pointer"
                      >
                        <span>{tr('Sembunyikan toolbar atas TradingView', 'Hide TradingView top bar')}</span>
                        <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9]">
                          {isLiveCleanView ? tr('Aktif', 'On') : tr('Mati', 'Off')}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. Twelve Data API Key (Used by Vela Replay) */}
                <div className="space-y-2 pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
                  <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] block">
                    {tr('Twelve Data API Key (Vela Replay)', 'Twelve Data API Key (Vela Replay)')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={tr('Masukkan API Key Twelve Data...', 'Enter Twelve Data API Key...')}
                      data-testid="twelve-data-api-key-input"
                      className="flex-1 h-8 px-2.5 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0D11] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-mono-numbers text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#0F172A] dark:focus:border-[#F2F4F7]"
                    />
                    <button
                      type="button"
                      data-testid="twelve-data-api-key-save-btn"
                      onClick={() => {
                        saveStoredTwelveDataApiKey(apiKeyInput);
                        setApiKeySavedToast(true);
                        window.setTimeout(() => setApiKeySavedToast(false), 2000);
                      }}
                      className="h-8 px-3 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-[#F2F4F7] dark:hover:bg-white dark:text-[#050607] text-[11px] font-medium cursor-pointer shrink-0 transition-colors"
                    >
                      {apiKeySavedToast ? tr('Tersimpan', 'Saved') : tr('Simpan', 'Save')}
                    </button>
                  </div>
                </div>

                {/* 4. Cloud Account Sync Row */}
                <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
                  <div className="p-2.5 rounded-lg bg-[#FAFAFA] dark:bg-[#0B0D11] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-7 w-7 rounded-md bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center text-[#0F172A] dark:text-[#F2F4F7] shrink-0">
                        {currentUser ? (
                          <UserCheck className="h-3.5 w-3.5" />
                        ) : (
                          <CloudOff className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium block truncate">
                          {currentUser
                            ? currentUser.email
                            : tr('Mode Lokal', 'Local Mode')}
                        </span>
                        <span className="text-[10px] text-[#526071] dark:text-[#929BA9] block truncate">
                          {currentUser
                            ? cloudSyncStatus === 'syncing'
                              ? tr('Menyinkronkan...', 'Syncing...')
                              : tr('Setelan tersinkron ke cloud', 'Preferences synced to cloud')
                            : tr('Masuk untuk sinkronisasi cloud', 'Sign in for cloud sync')}
                        </span>
                      </div>
                    </div>
                    {currentUser ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          onOpenAccount?.();
                        }}
                        className="h-7 px-2.5 rounded-md border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#161A22] text-[11px] font-medium shrink-0 cursor-pointer inline-flex items-center gap-1"
                      >
                        <Cloud className="h-3 w-3" />
                        <span>{tr('Akun', 'Account')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          onOpenAuth?.();
                        }}
                        className="h-7 px-2.5 rounded-md bg-[#0F172A] text-white dark:bg-[#F2F4F7] dark:text-[#050607] text-[11px] font-medium shrink-0 cursor-pointer inline-flex items-center gap-1"
                      >
                        <LogIn className="h-3 w-3" />
                        <span>{tr('Masuk', 'Sign In')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Minimalist Bottom Control Bar (Live Mode Only — Vela Replay uses its own native symbol/timeframe toolbar) */}
      {isLiveMode && (
        <div
          data-testid="market-chart-footer-bar"
          className="h-11 shrink-0 w-full px-3 sm:px-4 bg-white dark:bg-[#0C0F14] border-t border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-2 select-none"
        >
          {/* Left: Pair & Timeframe Selectors */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
            {/* Mobile Vertical Wheel Picker: Pair */}
            <div
              data-testid="wheel-picker-pair"
              role="spinbutton"
              aria-label={tr('Pilihan Pair', 'Pair Selector')}
              aria-valuetext={activePairItem.label}
              tabIndex={0}
              onTouchStart={handlePairTouchStart}
              onTouchMove={handlePairTouchMove}
              onPointerDown={handlePairPointerDown}
              onPointerMove={handlePairPointerMove}
              onPointerUp={handlePairPointerUp}
              onPointerCancel={handlePairPointerUp}
              onWheel={(e) => stepPairWheel(e.deltaY > 0 ? 1 : -1)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  stepPairWheel(-1);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  stepPairWheel(1);
                }
              }}
              className="lg:hidden relative h-9 min-w-[66px] px-1.5 flex flex-col items-center justify-between py-0.5 touch-none cursor-pointer select-none overflow-hidden shrink-0"
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (!pairTouchMovedRef.current) stepPairWheel(-1);
                  pairTouchMovedRef.current = false;
                }}
                className="text-[9px] text-[#94A3B8] dark:text-[#526071] leading-none"
              >
                {prevPairItem.label}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (!pairTouchMovedRef.current) stepPairWheel(1);
                  pairTouchMovedRef.current = false;
                }}
                className="text-[13px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] leading-none tracking-tight"
              >
                {activePairItem.label}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (!pairTouchMovedRef.current) stepPairWheel(1);
                  pairTouchMovedRef.current = false;
                }}
                className="text-[9px] text-[#94A3B8] dark:text-[#526071] leading-none"
              >
                {nextPairItem.label}
              </span>
            </div>

            {/* Mobile Vertical Wheel Picker: Timeframe */}
            <div
              data-testid="wheel-picker-timeframe"
              role="spinbutton"
              aria-label={tr('Pilihan Timeframe', 'Timeframe Selector')}
              aria-valuetext={activeTfItem.label}
              tabIndex={0}
              onTouchStart={handleTfTouchStart}
              onTouchMove={handleTfTouchMove}
              onPointerDown={handleTfPointerDown}
              onPointerMove={handleTfPointerMove}
              onPointerUp={handleTfPointerUp}
              onPointerCancel={handleTfPointerUp}
              onWheel={(e) => stepTfWheel(e.deltaY > 0 ? 1 : -1)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  stepTfWheel(-1);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  stepTfWheel(1);
                }
              }}
              className="md:hidden relative h-9 min-w-[40px] px-1 flex flex-col items-center justify-between py-0.5 touch-none cursor-pointer select-none overflow-hidden shrink-0"
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (!tfTouchMovedRef.current) stepTfWheel(-1);
                  tfTouchMovedRef.current = false;
                }}
                className="text-[9px] text-[#94A3B8] dark:text-[#526071] leading-none font-mono-numbers tabular-nums"
              >
                {prevTfItem.label}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (!tfTouchMovedRef.current) stepTfWheel(1);
                  tfTouchMovedRef.current = false;
                }}
                className="text-[13px] font-semibold text-[#0F172A] dark:text-[#F2F4F7] leading-none font-mono-numbers tabular-nums"
              >
                {activeTfItem.label}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (!tfTouchMovedRef.current) stepTfWheel(1);
                  tfTouchMovedRef.current = false;
                }}
                className="text-[9px] text-[#94A3B8] dark:text-[#526071] leading-none font-mono-numbers tabular-nums"
              >
                {nextTfItem.label}
              </span>
            </div>

            {/* Desktop Quick Pair Selector */}
            <div
              data-testid="responsive-symbol-bar"
              className="hidden lg:flex items-center gap-1 overflow-x-auto no-scrollbar"
            >
              {WHEEL_PAIRS.map((pair, idx) => {
                const isSelectedPair = prefs.symbol.toUpperCase() === pair.symbol.toUpperCase();
                return (
                  <button
                    key={pair.symbol}
                    type="button"
                    data-testid={`quick-pair-btn-${pair.label}`}
                    onClick={() => {
                      setWheelPairIndex(idx);
                      updatePrefs((prev) =>
                        prev.symbol === pair.symbol ? prev : { ...prev, symbol: pair.symbol }
                      );
                    }}
                    className={`h-7 px-2.5 rounded-md text-[11px] font-medium tracking-tight transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                      isSelectedPair
                        ? 'bg-[#0F172A] text-white dark:bg-[#F2F4F7] dark:text-[#050607]'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22]'
                    }`}
                  >
                    {pair.label}
                  </button>
                );
              })}
            </div>

            {/* Tablet & Desktop Quick Timeframe Selector */}
            <div
              data-testid="responsive-timeframe-bar"
              className="hidden md:flex items-center gap-1 lg:pl-3 lg:border-l lg:border-[#E4E4E7] lg:dark:border-[#20252D] overflow-x-auto no-scrollbar"
            >
              {WHEEL_TIMEFRAMES.map((tf, idx) => {
                const isSelectedTf = prefs.interval === tf.value;
                return (
                  <button
                    key={tf.value}
                    type="button"
                    data-testid={`quick-tf-btn-${tf.label}`}
                    onClick={() => {
                      setWheelTfIndex(idx);
                      updatePrefs((prev) =>
                        prev.interval === tf.value ? prev : { ...prev, interval: tf.value }
                      );
                    }}
                    className={`h-7 px-2 rounded-md text-[11px] font-mono-numbers tabular-nums font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                      isSelectedTf
                        ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] border border-[#E4E4E7] dark:border-[#2B313C]'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22]'
                    }`}
                  >
                    {tf.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Live Chart Functional Tools */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowLiveDrawingTools((prev) => !prev)}
              data-testid="chart-toggle-drawing-tools-button"
              aria-label={tr('Alat Gambar TradingView', 'TradingView Drawing Tools')}
              aria-pressed={showLiveDrawingTools}
              title={
                showLiveDrawingTools
                  ? tr('Sembunyikan alat gambar kiri', 'Hide left drawing toolbar')
                  : tr('Tampilkan alat gambar kiri', 'Show left drawing toolbar')
              }
              className={`inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
                showLiveDrawingTools
                  ? 'bg-[#0F172A] border-[#0F172A] text-white dark:bg-[#F2F4F7] dark:border-[#F2F4F7] dark:text-[#050607]'
                  : 'bg-transparent border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              <Pencil className="h-3 w-3 shrink-0" />
              <span className="hidden sm:inline">{tr('Gambar', 'Draw')}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsLiveCleanView((prev) => !prev)}
              data-testid="chart-toggle-clean-view-button"
              aria-label={tr('Tampilan Bersih Widget', 'Clean Widget View')}
              aria-pressed={isLiveCleanView}
              title={
                isLiveCleanView
                  ? tr('Tampilkan toolbar atas TradingView', 'Show TradingView top bar')
                  : tr('Sembunyikan toolbar atas TradingView', 'Hide TradingView top bar')
              }
              className={`inline-flex items-center justify-center h-7 w-7 rounded-md border transition-colors cursor-pointer touch-manipulation ${
                isLiveCleanView
                  ? 'bg-[#0F172A] border-[#0F172A] text-white dark:bg-[#F2F4F7] dark:border-[#F2F4F7] dark:text-[#050607]'
                  : 'bg-transparent border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              {isLiveCleanView ? (
                <PanelTop className="h-3.5 w-3.5" />
              ) : (
                <PanelTopClose className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
