/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayState, Vela } from '@luxalgo/vela';
import { VelaWorkspace, type VelaWorkspaceOptions } from '@luxalgo/vela/workspace';
import {
  AlertTriangle,
  Clock,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Settings2,
  SkipForward,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import {
  isNativeAndroidOrIos,
  NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT,
  NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY,
} from '../../utils/apiConfig';
import {
  TWELVE_DATA_API_KEY_STORAGE_KEY,
  TWELVE_DATA_KEY_CHANGE_EVENT,
} from '../../utils/marketChartHelpers';
import {
  DEFAULT_VELA_SESSION_SETTINGS,
  ensureVelaSessionsIndicatorRegistered,
  normalizeSessionSettings,
  settingsToVelaInputs,
  VELA_SESSIONS_INDICATOR_TYPE,
  type VelaSessionSettings,
} from '../../utils/velaSessionIndicator';
import {
  mapTradeVaultIntervalToVela,
  mapTradeVaultSymbolToVela,
  TradeVaultVelaProvider,
  type VelaFeedPreference,
  type VelaFeedStatus,
} from '../../utils/velaTradeVaultProvider';
import { VelaSessionSettingsPopover } from './VelaSessionSettingsPopover';

const VELA_BACKEND_STORAGE_KEY = 'tradevault_vela_beta_backend_v1';
const VELA_FEED_STORAGE_KEY = 'tradevault_vela_beta_feed_v1';
const VELA_SESSIONS_STORAGE_KEY = 'tradevault_vela_beta_sessions_v1';
const VELA_SESSIONS_CONFIG_STORAGE_KEY = 'tradevault_vela_beta_sessions_config_v1';
const VELA_WORKSPACE_PERSIST_KEY = 'tradevault_vela_beta_workspace_v1';

type VelaNativeBackend = NonNullable<VelaWorkspaceOptions['nativeBackend']>;
type QuickLayoutId = '1' | '2h' | '4';

const REPLAY_SPEEDS: ReadonlyArray<{ label: string; ms: number }> = [
  { label: '0.5x', ms: 1600 },
  { label: '1x', ms: 900 },
  { label: '2x', ms: 450 },
  { label: '4x', ms: 220 },
];

const INITIAL_REPLAY_STATE: ReplayState = {
  active: false,
  playing: false,
  cursorTime: null,
  remaining: 0,
  nextTime: null,
  intervalMs: 900,
};

export interface VelaBetaChartViewProps {
  symbol: string;
  interval: string;
  isDark: boolean;
  isEn: boolean;
  onSwitchToLive: () => void;
}

function loadInitialBackend(): VelaNativeBackend {
  const defaultBackend: VelaNativeBackend = isNativeAndroidOrIos() ? 'canvas2d' : 'auto';
  if (typeof window === 'undefined') return defaultBackend;
  try {
    const raw = window.localStorage.getItem(VELA_BACKEND_STORAGE_KEY);
    if (raw === 'canvas2d' || raw === 'webgl2' || raw === 'auto') {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return defaultBackend;
}

function saveBackend(backend: VelaNativeBackend): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VELA_BACKEND_STORAGE_KEY, backend);
  } catch {
    // ignore storage errors
  }
}

function loadInitialFeedPreference(): VelaFeedPreference {
  if (typeof window === 'undefined') return 'twelvedata';
  try {
    const raw = window.localStorage.getItem(VELA_FEED_STORAGE_KEY);
    if (raw === 'twelvedata' || raw === 'binance') {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return 'twelvedata';
}

function saveFeedPreference(feed: VelaFeedPreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VELA_FEED_STORAGE_KEY, feed);
  } catch {
    // ignore storage errors
  }
}

function loadInitialSessionsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(VELA_SESSIONS_STORAGE_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // ignore storage errors
  }
  return true;
}

function saveSessionsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VELA_SESSIONS_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

function loadInitialSessionSettings(): VelaSessionSettings {
  if (typeof window === 'undefined') return DEFAULT_VELA_SESSION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(VELA_SESSIONS_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_VELA_SESSION_SETTINGS;
    return normalizeSessionSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_VELA_SESSION_SETTINGS;
  }
}

function saveSessionSettings(settings: VelaSessionSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VELA_SESSIONS_CONFIG_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

function syncSessionIndicatorOnChart(
  chart: Vela,
  enabled: boolean,
  settings: VelaSessionSettings
): void {
  try {
    const existing = chart
      .indicators()
      .filter((h) => h.nativeType === VELA_SESSIONS_INDICATOR_TYPE);
    const inputMap = settingsToVelaInputs(settings);

    if (enabled) {
      if (existing.length === 0) {
        chart.addNativeIndicator(VELA_SESSIONS_INDICATOR_TYPE, { inputs: inputMap });
      } else {
        for (const handle of existing) {
          if (!handle.visible) {
            handle.setVisible(true);
          }
          handle.setInputs(inputMap);
        }
      }
    } else {
      for (const handle of existing) {
        handle.remove();
      }
    }
  } catch (err) {
    console.warn('[VelaReplay] syncSessionIndicatorOnChart error:', err);
  }
}

function formatReplayCursorWib(epochMs: number | null, isEn: boolean): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return '—';
  try {
    return (
      new Date(epochMs).toLocaleString(isEn ? 'en-US' : 'id-ID', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta',
      }) + ' WIB'
    );
  } catch {
    return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ');
  }
}

const VelaBetaChartView: React.FC<VelaBetaChartViewProps> = ({
  symbol,
  interval,
  isDark,
  isEn,
  onSwitchToLive,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<VelaWorkspace | null>(null);

  const [backend, setBackend] = useState<VelaNativeBackend>(() => loadInitialBackend());
  const [feedPreference, setFeedPreference] = useState<VelaFeedPreference>(() =>
    loadInitialFeedPreference()
  );
  const [sessionsEnabled, setSessionsEnabled] = useState<boolean>(() =>
    loadInitialSessionsEnabled()
  );
  const [sessionSettings, setSessionSettings] = useState<VelaSessionSettings>(() =>
    loadInitialSessionSettings()
  );
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState<boolean>(false);
  const [workspaceOptionsOpen, setWorkspaceOptionsOpen] = useState<boolean>(false);

  const sessionsEnabledRef = useRef<boolean>(sessionsEnabled);
  sessionsEnabledRef.current = sessionsEnabled;
  const sessionSettingsRef = useRef<VelaSessionSettings>(sessionSettings);
  sessionSettingsRef.current = sessionSettings;

  const [activeLayout, setActiveLayout] = useState<string>('1');
  const [feedStatus, setFeedStatus] = useState<VelaFeedStatus | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  // Native Vela Bar Replay UI state
  const [replayPanelOpen, setReplayPanelOpen] = useState<boolean>(false);
  const [isPickingCutPoint, setIsPickingCutPoint] = useState<boolean>(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState<number>(900);
  const [replayState, setReplayState] = useState<ReplayState>(INITIAL_REPLAY_STATE);
  const [replayMessage, setReplayMessage] = useState<string | null>(null);

  const initialVelaSymbol = useMemo(() => mapTradeVaultSymbolToVela(symbol), [symbol]);
  const initialVelaTimeframe = useMemo(() => mapTradeVaultIntervalToVela(interval), [interval]);
  const isNativeApk = useMemo(() => isNativeAndroidOrIos(), []);

  const tr = useCallback((idText: string, enText: string) => (isEn ? enText : idText), [isEn]);

  const handleSelectBackend = (next: VelaNativeBackend) => {
    setInitError(null);
    saveBackend(next);
    setBackend(next);
  };

  const handleSelectFeed = (next: VelaFeedPreference) => {
    if (next === feedPreference) return;
    setInitError(null);
    setFeedStatus(null);
    saveFeedPreference(next);
    setFeedPreference(next);
  };

  const handleToggleSessions = () => {
    const next = !sessionsEnabled;
    saveSessionsEnabled(next);
    setSessionsEnabled(next);
    if (!next) {
      setSessionSettingsOpen(false);
    }
    const ws = workspaceRef.current;
    if (!ws) return;
    ensureVelaSessionsIndicatorRegistered();
    for (const cell of ws.cells()) {
      syncSessionIndicatorOnChart(cell.chart, next, sessionSettingsRef.current);
    }
  };

  const handleSessionSettingsChange = (next: VelaSessionSettings) => {
    const normalized = normalizeSessionSettings(next);
    saveSessionSettings(normalized);
    setSessionSettings(normalized);
    if (!sessionsEnabledRef.current) {
      saveSessionsEnabled(true);
      setSessionsEnabled(true);
    }
    const ws = workspaceRef.current;
    if (!ws) return;
    ensureVelaSessionsIndicatorRegistered();
    for (const cell of ws.cells()) {
      syncSessionIndicatorOnChart(cell.chart, true, normalized);
    }
  };

  const handleResetSessionSettings = () => {
    handleSessionSettingsChange(DEFAULT_VELA_SESSION_SETTINGS);
  };

  const handleSelectLayout = (layoutId: QuickLayoutId) => {
    const ws = workspaceRef.current;
    if (!ws) return;
    try {
      ws.setLayout(layoutId);
      setActiveLayout(layoutId);
    } catch (err) {
      console.warn('[VelaReplay] setLayout failed:', err);
    }
  };

  const startReplayAtTimestamp = useCallback(
    async (targetEpochMs: number) => {
      const ws = workspaceRef.current;
      if (!ws) return;
      try {
        setReplayMessage(null);
        setIsPickingCutPoint(false);
        await ws.replay.start({ from: targetEpochMs });
        setReplayState({ ...ws.replay.state });
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err || 'Replay start failed');
        setReplayMessage(msg);
      }
    },
    []
  );

  const handleQuickStartReplay = async (ratio: number) => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const bounds = ws.replay.bounds;
    if (!bounds || !Number.isFinite(bounds.first) || !Number.isFinite(bounds.last)) {
      setReplayMessage(
        tr(
          'Data candle belum siap untuk Replay. Tunggu beberapa detik lalu coba lagi.',
          'Candle data is not ready for Replay yet. Wait a moment and retry.'
        )
      );
      return;
    }
    const span = Math.max(1, bounds.last - bounds.first);
    const cutTime = Math.floor(bounds.first + span * ratio);
    await startReplayAtTimestamp(cutTime);
  };

  const handleReplayPlayPause = () => {
    const ws = workspaceRef.current;
    if (!ws || !ws.replay.state.active) return;
    if (ws.replay.state.playing) {
      ws.replay.pause();
    } else {
      ws.replay.play(replaySpeedMs);
    }
    setReplayState({ ...ws.replay.state });
  };

  const handleReplayStep = () => {
    const ws = workspaceRef.current;
    if (!ws || !ws.replay.state.active) return;
    if (ws.replay.state.playing) {
      ws.replay.pause();
    }
    ws.replay.stepUpdate();
    setReplayState({ ...ws.replay.state });
  };

  const handleReplaySpeedChange = (nextMs: number) => {
    setReplaySpeedMs(nextMs);
    const ws = workspaceRef.current;
    if (ws && ws.replay.state.active && ws.replay.state.playing) {
      ws.replay.play(nextMs);
      setReplayState({ ...ws.replay.state });
    }
  };

  const handleReplayStop = () => {
    const ws = workspaceRef.current;
    setIsPickingCutPoint(false);
    setReplayMessage(null);
    if (ws && ws.replay.state.active) {
      ws.replay.stop();
      setReplayState({ ...ws.replay.state });
    } else {
      setReplayState(INITIAL_REPLAY_STATE);
    }
  };

  const handleToggleReplayPanel = () => {
    if (replayPanelOpen) {
      handleReplayStop();
      setReplayPanelOpen(false);
    } else {
      setReplayMessage(null);
      setWorkspaceOptionsOpen(false);
      setReplayPanelOpen(true);
    }
  };

  // Mount & recreate VelaWorkspace when renderer backend, preferred feed, or manual reload changes
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    ensureVelaSessionsIndicatorRegistered();

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const unsubs: Array<() => void> = [];

    setInitError(null);
    setIsPickingCutPoint(false);
    setReplayMessage(null);
    setReplayState(INITIAL_REPLAY_STATE);
    host.innerHTML = '';

    try {
      const provider = new TradeVaultVelaProvider({
        preferredFeed: feedPreference,
        onStatus: (status) => {
          if (!disposed) {
            setFeedStatus(status);
          }
        },
      });

      const workspace = new VelaWorkspace(host, {
        layout: '1',
        symbol: initialVelaSymbol,
        timeframe: initialVelaTimeframe,
        live: true,
        theme: isDark ? 'dark' : 'light',
        nativeBackend: backend,
        providers: {
          tradevault: () => provider,
        },
        persist: VELA_WORKSPACE_PERSIST_KEY,
        autofocus: false,
        symbolMenuFromKey: true,
        layoutMode: 'auto',
      });

      workspaceRef.current = workspace;
      setActiveLayout(workspace.layout?.id || '1');

      for (const cell of workspace.cells()) {
        syncSessionIndicatorOnChart(
          cell.chart,
          sessionsEnabledRef.current,
          sessionSettingsRef.current
        );
      }

      unsubs.push(
        workspace.on('cell:created', ({ id }) => {
          if (disposed) return;
          const cell = workspace.cell(id);
          if (cell) {
            syncSessionIndicatorOnChart(
              cell.chart,
              sessionsEnabledRef.current,
              sessionSettingsRef.current
            );
          }
        })
      );

      unsubs.push(
        workspace.on('layout:changed', (payload) => {
          if (!disposed && payload?.layout) {
            setActiveLayout(payload.layout);
          }
        })
      );

      const syncReplay = () => {
        if (!disposed) {
          setReplayState({ ...workspace.replay.state });
        }
      };
      unsubs.push(workspace.replay.on('replay:start', syncReplay));
      unsubs.push(workspace.replay.on('replay:step', syncReplay));
      unsubs.push(workspace.replay.on('replay:tick', syncReplay));
      unsubs.push(workspace.replay.on('replay:play', syncReplay));
      unsubs.push(workspace.replay.on('replay:pause', syncReplay));
      unsubs.push(
        workspace.replay.on('replay:end', () => {
          if (!disposed) {
            setIsPickingCutPoint(false);
            setReplayState({ ...workspace.replay.state });
          }
        })
      );

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (!disposed && workspaceRef.current) {
            try {
              workspaceRef.current.resize();
            } catch {
              // ignore resize race during teardown
            }
          }
        });
        resizeObserver.observe(host);
      }
    } catch (err: any) {
      const message =
        err instanceof Error ? err.message : String(err || 'Vela initialization error');
      console.error('[VelaReplay] Workspace initialization failed:', err);
      setInitError(message);
    }

    return () => {
      disposed = true;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      for (const unsub of unsubs) {
        try {
          unsub();
        } catch {
          // ignore
        }
      }
      if (workspaceRef.current) {
        try {
          workspaceRef.current.destroy();
        } catch {
          // ignore teardown errors
        }
        workspaceRef.current = null;
      }
      if (host) {
        host.innerHTML = '';
      }
    };
    // Theme updates are synced live in the dedicated effect below to avoid rebuilding the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, feedPreference, reloadNonce]);

  // Reload Vela cleanly when Offline Mode or Twelve Data API key changes in Settings / Chart Drawer
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const triggerReload = () => setReloadNonce((n) => n + 1);
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY ||
        e.key === TWELVE_DATA_API_KEY_STORAGE_KEY
      ) {
        triggerReload();
      }
    };
    window.addEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, triggerReload);
    window.addEventListener(TWELVE_DATA_KEY_CHANGE_EVENT, triggerReload);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, triggerReload);
      window.removeEventListener(TWELVE_DATA_KEY_CHANGE_EVENT, triggerReload);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Click-to-cut bar picker when Bar Replay cut mode is armed
  useEffect(() => {
    if (!isPickingCutPoint) return;
    const ws = workspaceRef.current;
    if (!ws) return;

    const cleanups: Array<() => void> = [];
    for (const cell of ws.cells()) {
      const off = cell.chart.renderer.onClick((ev) => {
        if (ev && typeof ev.time === 'number' && Number.isFinite(ev.time)) {
          void startReplayAtTimestamp(ev.time);
        }
      });
      cleanups.push(off);
    }

    return () => {
      for (const off of cleanups) {
        try {
          off();
        } catch {
          // ignore
        }
      }
    };
  }, [isPickingCutPoint, activeLayout, startReplayAtTimestamp]);

  // Live theme sync without tearing down the Vela workspace
  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) return;
    try {
      ws.setTheme(isDark ? 'dark' : 'light');
    } catch {
      // ignore if workspace is mid-transition
    }
  }, [isDark]);

  // Clean unboxed feed caption (Zero-Pill discipline)
  const feedCaption = useMemo(() => {
    if (!feedStatus) {
      return {
        source: tr('Memuat data', 'Loading data'),
        detail: null as string | null,
        isError: false,
      };
    }
    if (feedStatus.source === 'twelvedata') {
      return {
        source: 'TwelveData',
        detail: `${feedStatus.barCount} ${tr('bar', 'bars')}`,
        isError: false,
      };
    }
    if (feedStatus.source === 'binance') {
      return {
        source: feedStatus.note ? 'Binance Fallback' : 'Binance',
        detail: `${feedStatus.barCount} ${tr('bar', 'bars')}`,
        isError: false,
      };
    }
    if (feedStatus.source === 'cache') {
      return {
        source: tr('Cache Offline', 'Offline Cache'),
        detail: `${feedStatus.barCount} ${tr('bar', 'bars')}`,
        isError: false,
      };
    }
    return {
      source: tr('Data tidak tersedia', 'Data unavailable'),
      detail: null,
      isError: true,
    };
  }, [feedStatus, tr]);

  return (
    <div
      data-testid="vela-beta-chart-overlay"
      className="absolute inset-0 z-15 flex flex-col w-full h-full min-h-0 min-w-0 bg-white dark:bg-[#050607] text-[#0F172A] dark:text-[#F2F4F7] overflow-hidden"
      style={{ touchAction: 'auto' }}
    >
      {/* Minimalist Architectural Workspace Strip */}
      <div
        data-testid="vela-beta-control-strip"
        className="shrink-0 h-9 px-3 sm:px-4 bg-[#FAFAFA] dark:bg-[#0C0F14] border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-2 text-xs select-none"
      >
        {/* Left: Quiet Unboxed Feed Metadata */}
        <div
          data-testid="vela-beta-feed-status"
          className="flex items-center gap-1.5 min-w-0 text-[11px] text-[#526071] dark:text-[#929BA9] truncate"
          title={
            feedStatus
              ? `${feedStatus.ticker} (${feedStatus.timeframe}) · ${feedCaption.source}${feedStatus.note ? ` · ${feedStatus.note}` : ''}`
              : undefined
          }
        >
          <span
            className={`font-medium truncate ${
              feedCaption.isError
                ? 'text-[#E11D48] dark:text-[#E05260]'
                : 'text-[#0F172A] dark:text-[#F2F4F7]'
            }`}
          >
            {feedCaption.source}
          </span>
          {feedCaption.detail && (
            <>
              <span aria-hidden="true" className="text-[#CBD5E1] dark:text-[#333B48]">
                ·
              </span>
              <span className="font-mono-numbers tabular-nums whitespace-nowrap">
                {feedCaption.detail}
              </span>
            </>
          )}
          {feedStatus?.ticker && (
            <span className="hidden sm:inline font-mono-numbers tabular-nums text-[#94A3B8] dark:text-[#64748B] truncate">
              · {feedStatus.ticker}
            </span>
          )}
        </div>

        {/* Right: Focused Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Trading Sessions Split Toggle + Settings */}
          <div className="inline-flex items-center h-7 rounded-lg border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] overflow-hidden">
            <button
              type="button"
              data-testid="vela-sessions-toggle"
              onClick={handleToggleSessions}
              title={tr(
                'Tampilkan atau sembunyikan kotak sesi Asia, London & New York',
                'Toggle Asia, London & New York session boxes'
              )}
              className={`inline-flex items-center gap-1.5 h-full px-2.5 text-[11px] font-medium transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
                sessionsEnabled
                  ? 'bg-[#0F172A] text-white dark:bg-[#F2F4F7] dark:text-[#050607]'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
              }`}
            >
              <Clock className="h-3 w-3 shrink-0" />
              <span>{tr('Sesi', 'Sessions')}</span>
            </button>
            <button
              type="button"
              data-testid="vela-sessions-settings-button"
              onClick={() => {
                setWorkspaceOptionsOpen(false);
                setSessionSettingsOpen((prev) => !prev);
              }}
              aria-label={tr('Pengaturan kotak sesi', 'Session box settings')}
              title={tr(
                'Atur warna, opacity, garis tepi & jam WIB kotak sesi',
                'Customize session box colors, opacity, borders & WIB hours'
              )}
              className={`inline-flex items-center justify-center h-full w-7 border-l border-[#E4E4E7] dark:border-[#20252D] transition-colors cursor-pointer touch-manipulation ${
                sessionSettingsOpen
                  ? 'bg-[#F4F4F5] dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7]'
                  : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22]'
              }`}
            >
              <Settings2 className="h-3 w-3" />
            </button>
          </div>

          {/* Bar Replay Toggle */}
          <button
            type="button"
            data-testid="vela-replay-toggle"
            onClick={handleToggleReplayPanel}
            title={tr('Buka kontrol Bar Replay', 'Open Bar Replay controls')}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
              replayPanelOpen || replayState.active
                ? 'bg-[#0F172A] border-[#0F172A] text-white dark:bg-[#F2F4F7] dark:border-[#F2F4F7] dark:text-[#050607]'
                : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
            }`}
          >
            <Scissors className="h-3 w-3 shrink-0" />
            <span>Replay</span>
          </button>

          {/* Workspace Options Popover Trigger (Feed, Layout, Renderer, Reload) */}
          <button
            type="button"
            data-testid="vela-workspace-options-button"
            onClick={() => {
              setSessionSettingsOpen(false);
              setWorkspaceOptionsOpen((prev) => !prev);
            }}
            aria-label={tr('Opsi Workspace Vela', 'Vela Workspace Options')}
            aria-expanded={workspaceOptionsOpen}
            title={tr('Sumber Data, Multi-Chart & Renderer', 'Data Feed, Multi-Chart & Renderer')}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-lg border transition-colors cursor-pointer touch-manipulation ${
              workspaceOptionsOpen
                ? 'bg-[#0F172A] border-[#0F172A] text-white dark:bg-[#F2F4F7] dark:border-[#F2F4F7] dark:text-[#050607]'
                : 'bg-white dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Bar Replay Transport Strip (Shown only when Replay is open/active) */}
      {(replayPanelOpen || replayState.active) && (
        <div
          data-testid="vela-replay-toolbar"
          className="shrink-0 px-3 sm:px-4 py-1.5 bg-white dark:bg-[#0B0D11] border-b border-[#E4E4E7] dark:border-[#20252D] flex flex-wrap items-center justify-between gap-2 text-[11px] select-none"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="vela-replay-pick-bar"
              onClick={() => {
                setReplayMessage(null);
                setIsPickingCutPoint((prev) => !prev);
              }}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border font-medium transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
                isPickingCutPoint
                  ? 'bg-[#0F172A] border-[#0F172A] text-white dark:bg-[#F2F4F7] dark:border-[#F2F4F7] dark:text-[#050607]'
                  : 'bg-[#FAFAFA] dark:bg-[#101318] border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22]'
              }`}
            >
              <Scissors className="h-3 w-3 shrink-0" />
              <span>
                {isPickingCutPoint
                  ? tr('Tap Candle di Chart...', 'Tap a Candle...')
                  : tr('Pilih Candle', 'Pick Bar')}
              </span>
            </button>

            {!replayState.active && (
              <div className="flex items-center gap-1">
                <span className="text-[#526071] dark:text-[#929BA9] hidden sm:inline mr-0.5">
                  {tr('Potong cepat:', 'Quick cut:')}
                </span>
                {[
                  { label: '50%', ratio: 0.5 },
                  { label: '75%', ratio: 0.75 },
                  { label: '88%', ratio: 0.88 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => void handleQuickStartReplay(preset.ratio)}
                    className="h-7 px-2 rounded-lg bg-[#FAFAFA] dark:bg-[#101318] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] font-mono-numbers tabular-nums font-medium cursor-pointer touch-manipulation"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}

            {replayState.active && (
              <>
                <button
                  type="button"
                  data-testid="vela-replay-play-pause"
                  onClick={handleReplayPlayPause}
                  className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-[#F2F4F7] dark:hover:bg-white dark:text-[#050607] font-medium cursor-pointer touch-manipulation whitespace-nowrap"
                >
                  {replayState.playing ? (
                    <>
                      <Pause className="h-3 w-3" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      <span>Play</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  data-testid="vela-replay-step"
                  onClick={handleReplayStep}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FAFAFA] dark:bg-[#101318] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] font-mono-numbers tabular-nums font-medium cursor-pointer touch-manipulation"
                  title={tr('Maju 1 candle berikutnya', 'Step forward 1 bar')}
                >
                  <SkipForward className="h-3 w-3" />
                  <span>+1</span>
                </button>

                <div className="flex items-center p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]">
                  {REPLAY_SPEEDS.map((spd) => (
                    <button
                      key={spd.label}
                      type="button"
                      onClick={() => handleReplaySpeedChange(spd.ms)}
                      className={`h-6 px-2 rounded-md text-[10px] font-medium font-mono-numbers tabular-nums cursor-pointer touch-manipulation transition-colors ${
                        replaySpeedMs === spd.ms
                          ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                          : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {spd.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  data-testid="vela-replay-stop"
                  onClick={handleReplayStop}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#E11D48]/25 dark:border-[#E05260]/30 bg-[#E11D48]/[0.06] dark:bg-[#E05260]/10 hover:bg-[#E11D48]/12 dark:hover:bg-[#E05260]/18 text-[#E11D48] dark:text-[#E05260] font-medium cursor-pointer touch-manipulation whitespace-nowrap"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  <span>{tr('Selesai', 'Stop')}</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            {replayState.active ? (
              <div className="flex items-center gap-1.5 font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                <span className="font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                  {formatReplayCursorWib(replayState.cursorTime, isEn)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {tr(`Sisa ${replayState.remaining} bar`, `${replayState.remaining} bars left`)}
                </span>
              </div>
            ) : replayMessage ? (
              <span className="text-[#D97706] dark:text-[#F59E0B]">{replayMessage}</span>
            ) : (
              <span className="text-[#526071] dark:text-[#929BA9]">
                {tr(
                  'Pilih candle pada chart atau gunakan potong cepat.',
                  'Pick any candle on the chart or use a quick cut.'
                )}
              </span>
            )}

            {!replayState.active && (
              <button
                type="button"
                onClick={() => {
                  setIsPickingCutPoint(false);
                  setReplayPanelOpen(false);
                }}
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
                title={tr('Tutup bar replay', 'Close replay bar')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Vela Workspace Mount Surface */}
      <div className="relative flex-1 min-h-0 min-w-0 w-full h-full overflow-hidden">
        {initError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-[#050607] z-20">
            <div className="max-w-sm rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] p-5 space-y-3">
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-[#E11D48]/10 text-[#E11D48] dark:bg-[#E05260]/15 dark:text-[#E05260] mx-auto">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Vela Workspace Gagal Dimuat', 'Vela Workspace Failed to Load')}
              </h3>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] leading-relaxed break-words">
                {initError}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {backend !== 'canvas2d' && (
                  <button
                    type="button"
                    onClick={() => handleSelectBackend('canvas2d')}
                    className="h-8 px-3 rounded-lg bg-[#0F172A] text-white dark:bg-[#F2F4F7] dark:text-[#050607] text-xs font-medium cursor-pointer"
                  >
                    {tr('Gunakan Canvas2D', 'Use Canvas2D')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onSwitchToLive}
                  className="h-8 px-3 rounded-lg border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] text-xs font-medium cursor-pointer"
                >
                  {tr('Beralih ke Live Chart', 'Switch to Live Chart')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div
          ref={hostRef}
          data-testid="vela-workspace-host"
          className={`w-full h-full min-h-0 min-w-0 overflow-hidden ${
            isPickingCutPoint ? 'cursor-crosshair' : ''
          }`}
        />

        {/* Workspace Options Popover (Feed, Multi-Chart Layout, Renderer, Reload) */}
        {workspaceOptionsOpen && (
          <div
            data-testid="vela-workspace-options-popover"
            role="dialog"
            aria-label={tr('Opsi Workspace Vela', 'Vela Workspace Options')}
            className="absolute top-2 right-2 z-30 w-[calc(100%-1rem)] max-w-[300px] rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_12px_32px_-8px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.7)] text-[#0F172A] dark:text-[#F2F4F7] text-xs select-none animate-in fade-in duration-150"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
              <h4 className="text-[13px] font-semibold tracking-tight">
                {tr('Workspace Vela', 'Vela Workspace')}
              </h4>
              <button
                type="button"
                onClick={() => setWorkspaceOptionsOpen(false)}
                aria-label={tr('Tutup opsi workspace', 'Close workspace options')}
                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Data Feed */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] block">
                  {tr('Sumber Data Utama', 'Primary Data Feed')}
                </span>
                <div
                  data-testid="vela-beta-feed-switcher"
                  className="grid grid-cols-2 p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]"
                >
                  {(
                    [
                      { id: 'twelvedata', label: 'TwelveData' },
                      { id: 'binance', label: 'Binance' },
                    ] as Array<{ id: VelaFeedPreference; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`vela-feed-${opt.id}`}
                      onClick={() => handleSelectFeed(opt.id)}
                      className={`h-7 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                        feedPreference === opt.id
                          ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                          : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Multi-Chart Layout */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] block">
                  {tr('Tata Letak Multi-Chart', 'Multi-Chart Layout')}
                </span>
                <div className="grid grid-cols-3 p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]">
                  {(
                    [
                      { id: '1', label: tr('1 Chart', '1 Chart') },
                      { id: '2h', label: tr('2 Panel', '2 Split') },
                      { id: '4', label: tr('4 Grid', '4 Grid') },
                    ] as Array<{ id: QuickLayoutId; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectLayout(opt.id)}
                      className={`h-7 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                        activeLayout === opt.id
                          ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                          : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Renderer Engine */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9] block">
                  {tr('Engine Render', 'Renderer Engine')}
                </span>
                <div
                  data-testid="vela-beta-backend-switcher"
                  className="grid grid-cols-3 p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]"
                >
                  {(
                    [
                      { id: 'canvas2d', label: 'Canvas2D' },
                      { id: 'webgl2', label: 'WebGL2' },
                      { id: 'auto', label: 'Auto' },
                    ] as Array<{ id: VelaNativeBackend; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`vela-backend-${opt.id}`}
                      onClick={() => handleSelectBackend(opt.id)}
                      className={`h-7 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                        backend === opt.id
                          ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                          : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {isNativeApk && backend === 'canvas2d' && (
                  <p className="text-[10px] text-[#526071] dark:text-[#929BA9]">
                    {tr('Direkomendasikan untuk stabilitas Android WebView.', 'Recommended for Android WebView stability.')}
                  </p>
                )}
              </div>

              {/* Reload Action */}
              <div className="pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceOptionsOpen(false);
                    setReloadNonce((n) => n + 1);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] hover:bg-[#F4F4F5] dark:hover:bg-[#1D222C] text-[11px] font-medium text-[#0F172A] dark:text-[#F2F4F7] transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{tr('Muat Ulang Workspace', 'Reload Workspace')}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {sessionSettingsOpen && (
          <VelaSessionSettingsPopover
            settings={sessionSettings}
            isEn={isEn}
            onChange={handleSessionSettingsChange}
            onReset={handleResetSessionSettings}
            onClose={() => setSessionSettingsOpen(false)}
          />
        )}
      </div>
    </div>
  );
};

export default VelaBetaChartView;
