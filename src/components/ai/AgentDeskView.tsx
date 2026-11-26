/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tanya AI — Customizable Messenger UI (WhatsApp / Instagram DM style)
 * Powered by TradeVault's Multi-Agent Office (Boss Gemini + Groq + OpenRouter)
 * with full offline local fallback & zero raw-data clutter.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send,
  Trash2,
  Palette,
  CheckCheck,
  X,
  Camera,
  Image as ImageIcon,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  WifiOff,
  Check,
  Sparkles,
  Sun,
  Brain,
} from 'lucide-react';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import { useLanguage } from '../../utils/language';
import { useTheme } from '../../utils/theme';
import {
  AGENT_DESK_CHAT_STORAGE_KEY,
  AGENT_CHAT_THEME_PRESETS,
  AgentChatPersona,
  AgentChatThemeConfig,
  AgentDeskMessage,
  AgentMemoryItem,
  buildAgentDeskContext,
  clearAgentMemory,
  compressImageFileToDataUrl,
  deleteAgentMemoryItem,
  endAgentDeskSession,
  getContrastPalette,
  getTodayLocalDateKey,
  loadAgentChatTheme,
  loadAgentMemory,
  loadLastSessionDayKey,
  resetAgentChatTheme,
  saveAgentChatTheme,
  saveLastSessionDayKey,
  sendAgentDeskChatMessage,
  syncAgentDeskLiveContext,
} from '../../utils/agentDeskContext';

interface AgentDeskViewProps {
  trades: Trade[];
  settings: AppSettings;
  isActive?: boolean;
  onNavigate?: (tab: string) => void;
}

const MAX_STORED_MESSAGES = 60;

function loadStoredMessages(): AgentDeskMessage[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AGENT_DESK_CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_STORED_MESSAGES) : [];
  } catch {
    return [];
  }
}

function saveStoredMessages(messages: AgentDeskMessage[]) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(
      AGENT_DESK_CHAT_STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES))
    );
  } catch {
    // Ignore storage quota errors
  }
}

function formatChatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

function getAgentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AI';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Safe inline markdown renderer (bold **text** & line breaks) using pure React nodes.
 */
function renderSafeRichText(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={lineIdx}>
        {parts.map((segment, segIdx) => {
          if (segment.startsWith('**') && segment.endsWith('**') && segment.length > 4) {
            return (
              <strong key={segIdx} className="font-semibold">
                {segment.slice(2, -2)}
              </strong>
            );
          }
          return <React.Fragment key={segIdx}>{segment}</React.Fragment>;
        })}
        {lineIdx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

export const AgentDeskView: React.FC<AgentDeskViewProps> = ({ trades, settings, isActive = true }) => {
  const { language, tr } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [messages, setMessages] = useState<AgentDeskMessage[]>(() => loadStoredMessages());
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [memoryItems, setMemoryItems] = useState<AgentMemoryItem[]>(() => loadAgentMemory());
  const [expandedTraceIds, setExpandedTraceIds] = useState<Record<string, boolean>>({});
  const [chatTheme, setChatTheme] = useState<AgentChatThemeConfig>(() =>
    loadAgentChatTheme(isDark)
  );
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const wallpaperInputRef = useRef<HTMLInputElement | null>(null);
  const lastBgSyncRef = useRef<number>(0);
  const rolloverCheckedRef = useRef<boolean>(false);

  const { absorbedSummary } = useMemo(
    () => buildAgentDeskContext(trades, settings, language),
    [trades, settings, language, messages.length, syncStatusText, memoryItems.length]
  );

  const userContrast = useMemo(
    () => getContrastPalette(chatTheme.userBubbleColor),
    [chatTheme.userBubbleColor]
  );
  const agentContrast = useMemo(
    () => getContrastPalette(chatTheme.agentBubbleColor),
    [chatTheme.agentBubbleColor]
  );
  const bgContrast = useMemo(
    () =>
      chatTheme.wallpaperDataUrl
        ? { text: '#F8FAFC', muted: 'rgba(248, 250, 252, 0.78)', isLightSurface: false }
        : getContrastPalette(chatTheme.bgColor),
    [chatTheme.bgColor, chatTheme.wallpaperDataUrl]
  );

  useEffect(() => {
    saveStoredMessages(messages);
  }, [messages]);

  useEffect(() => {
    if (isActive) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, isSending, isActive]);

  // Quiet background auto-sync of lightweight live XAUUSD spot quote (zero-AI) when chat opens.
  // Heavy Trade News / Fundamental Gold AI feeds sync on-demand only when the user asks market questions.
  useEffect(() => {
    if (!isActive) return;
    if (absorbedSummary.isOfflineMode || !absorbedSummary.isNavigatorOnline) return;
    const now = Date.now();
    if (now - lastBgSyncRef.current < 60_000) return;
    lastBgSyncRef.current = now;
    void syncAgentDeskLiveContext({
      forcePrice: false,
      syncMarketFeeds: false,
      language,
      onStatus: setSyncStatusText,
    });
  }, [isActive, absorbedSummary.isOfflineMode, absorbedSummary.isNavigatorOnline, language]);

  // Auto-New-Day Rollover: distill previous day's chat into offline memory on a new calendar date
  useEffect(() => {
    if (!isActive || rolloverCheckedRef.current) return;
    rolloverCheckedRef.current = true;

    const today = getTodayLocalDateKey();
    const lastDay = loadLastSessionDayKey();
    const stored = loadStoredMessages();
    const lastMsgDay =
      stored.length > 0 && stored[stored.length - 1]?.createdAt
        ? getTodayLocalDateKey(new Date(stored[stored.length - 1].createdAt))
        : null;

    const isFromPreviousDay =
      stored.length > 0 && ((lastDay && lastDay !== today) || (!lastDay && lastMsgDay && lastMsgDay !== today));

    if (isFromPreviousDay) {
      void (async () => {
        setIsEndingSession(true);
        try {
          const result = await endAgentDeskSession({ messages: stored, language });
          setMessages([]);
          setExpandedTraceIds({});
          saveStoredMessages([]);
          setMemoryItems(loadAgentMemory());
          setSessionNotice(
            language === 'en'
              ? `New Day started · Previous session archived (${result.savedMemoriesCount} memories kept).`
              : `Hari baru dimulai · Sesi sebelumnya diarsipkan (${result.savedMemoriesCount} catatan memori aktif).`
          );
        } finally {
          setIsEndingSession(false);
        }
      })();
    } else if (!lastDay) {
      saveLastSessionDayKey(today);
    }
  }, [isActive, language]);

  const updateChatTheme = (patch: Partial<AgentChatThemeConfig>) => {
    setChatTheme((prev) => {
      const next = { ...prev, ...patch };
      saveAgentChatTheme(next);
      return next;
    });
  };

  const handleResetTheme = () => {
    const fresh = resetAgentChatTheme(isDark);
    setChatTheme(fresh);
    setUploadError(null);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const dataUrl = await compressImageFileToDataUrl(file, {
        maxDim: 160,
        quality: 0.82,
        squareCrop: true,
      });
      updateChatTheme({ avatarDataUrl: dataUrl });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : tr('Gagal memuat foto.', 'Failed to load photo.'));
    }
  };

  const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const dataUrl = await compressImageFileToDataUrl(file, {
        maxDim: 900,
        quality: 0.72,
        squareCrop: false,
      });
      updateChatTheme({ wallpaperDataUrl: dataUrl });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : tr('Gagal memuat wallpaper.', 'Failed to load wallpaper.')
      );
    }
  };

  const quickPrompts = useMemo(
    () =>
      language === 'en'
        ? [
            'Where is live XAU/USD price right now?',
            'What is today’s market direction? Will it spike first?',
            'Check my journal performance & active risk right now',
            'Are my open positions aligned with today’s news?',
          ]
        : [
            'Harga XAUUSD saat ini di angka berapa?',
            'Hari ini market mau kemana? Bakal spike dulu ga?',
            'Cek perkembangan jurnal & risiko akun saya sekarang',
            'Posisi aktif saya aman ga sama berita hari ini?',
          ],
    [language]
  );

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isSending || isEndingSession) return;

    setSessionNotice(null);
    const userMsg: AgentDeskMessage = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    saveLastSessionDayKey(getTodayLocalDateKey());
    setInput('');
    setIsSending(true);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const reply = await sendAgentDeskChatMessage({
        message: text,
        history: messages,
        trades,
        settings,
        language,
        persona: chatTheme.persona,
        agentName: chatTheme.agentName,
        onSyncStatus: setSyncStatusText,
      });

      if (reply.detectedAgentName) {
        updateChatTheme({ agentName: reply.detectedAgentName });
      }
      setMemoryItems(loadAgentMemory());

      const assistantMsg: AgentDeskMessage = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        createdAt: new Date().toISOString(),
        ...reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const fallbackErr: AgentDeskMessage = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        createdAt: new Date().toISOString(),
        mode: 'OFFLINE_LOCAL',
        content: tr(
          'Maaf, koneksi lagi sedikit tersendat. Coba kirim ulang sebentar lagi ya.',
          'Sorry, the connection hiccupped for a moment. Please try sending again.'
        ),
      };
      setMessages((prev) => [...prev, fallbackErr]);
    } finally {
      setSyncStatusText(null);
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setExpandedTraceIds({});
    saveStoredMessages([]);
  };

  const handleEndSession = async () => {
    if (messages.length === 0 || isSending || isEndingSession) return;
    setIsEndingSession(true);
    try {
      const result = await endAgentDeskSession({ messages, language });
      setMessages([]);
      setExpandedTraceIds({});
      saveStoredMessages([]);
      setMemoryItems(loadAgentMemory());
      setSessionNotice(
        tr(
          `Sesi diakhiri · Intisari disimpan ke memori offline (${result.savedMemoriesCount} catatan).`,
          `Session ended · Key facts saved to offline memory (${result.savedMemoriesCount} total).`
        )
      );
    } finally {
      setIsEndingSession(false);
    }
  };

  const toggleTrace = (id: string) => {
    setExpandedTraceIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isOfflineNow = absorbedSummary.isOfflineMode || !absorbedSummary.isNavigatorOnline;

  const statusLine = isEndingSession
    ? tr('menyimpan memori sesi...', 'saving session memory...')
    : isSending
    ? tr('sedang mengetik...', 'typing...')
    : syncStatusText
    ? syncStatusText
    : isOfflineNow
    ? tr('mode offline (data lokal)', 'offline mode (local data)')
    : chatTheme.agentSubtitle || tr('online', 'online');

  const renderAvatar = (sizeClass = 'h-9 w-9', textClass = 'text-xs') =>
    chatTheme.avatarDataUrl ? (
      <img
        src={chatTheme.avatarDataUrl}
        alt={chatTheme.agentName}
        className={`${sizeClass} rounded-full object-cover shrink-0 border border-black/10 dark:border-white/15`}
      />
    ) : (
      <div
        className={`${sizeClass} rounded-full shrink-0 flex items-center justify-center font-bold ${textClass} border border-black/10 dark:border-white/15 select-none`}
        style={{
          backgroundColor: chatTheme.userBubbleColor,
          color: userContrast.text,
        }}
      >
        {getAgentInitials(chatTheme.agentName)}
      </div>
    );

  return (
    <div className="max-w-4xl mx-auto w-full h-[calc(100dvh-124px)] sm:h-[calc(100dvh-104px)] min-h-[480px] flex flex-col rounded-2xl overflow-hidden border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] shadow-xs">
      {/* ================================================================= */}
      {/* MESSENGER TOP HEADER (WhatsApp / IG DM style)                     */}
      {/* ================================================================= */}
      <header className="shrink-0 px-3.5 sm:px-4 py-2.5 bg-white dark:bg-[#101318] border-b border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-between gap-3 z-10">
        <button
          type="button"
          onClick={() => {
            setMemoryItems(loadAgentMemory());
            setIsCustomizeOpen(true);
          }}
          className="flex items-center gap-3 min-w-0 text-left group cursor-pointer focus-visible:outline-none"
          title={tr('Ketuk untuk kustom profil, memori & tema chat', 'Tap to customize profile, memory & theme')}
        >
          <div className="relative shrink-0">
            {renderAvatar('h-10 w-10', 'text-xs')}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#101318] ${
                isOfflineNow ? 'bg-[#94A3B8]' : 'bg-[#10B981]'
              }`}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7] truncate group-hover:underline decoration-[#94A3B8]">
                {chatTheme.agentName}
              </h1>
            </div>
            <p
              className={`text-[11px] truncate ${
                isSending || syncStatusText || isEndingSession
                  ? 'text-[#059669] dark:text-[#34D399] font-medium'
                  : 'text-[#64748B] dark:text-[#929BA9]'
              }`}
            >
              {statusLine}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {isOfflineNow && (
            <span
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#F4F4F5] dark:bg-[#161B24] text-[10px] font-medium text-[#64748B] dark:text-[#929BA9]"
              title={tr('Menggunakan data lokal perangkat', 'Using device local data')}
            >
              <WifiOff className="h-3 w-3" />
              {tr('Offline', 'Offline')}
            </span>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              disabled={isSending || isEndingSession}
              onClick={() => void handleEndSession()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-medium text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161B24] disabled:opacity-40 transition-colors cursor-pointer"
              title={tr(
                'Akhiri sesi hari ini, simpan intisari ke memori offline & mulai kanvas hari baru',
                'End today’s session, save key facts to offline memory & start a fresh day'
              )}
            >
              <Sun className="h-3.5 w-3.5" />
              <span>{tr('Akhiri Sesi', 'New Day')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMemoryItems(loadAgentMemory());
              setIsCustomizeOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-medium text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161B24] transition-colors cursor-pointer"
            title={tr('Kustomisasi Tampilan & Memori AI', 'Customize Chat & Memory')}
          >
            <Palette className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tr('Tema', 'Theme')}</span>
          </button>
        </div>
      </header>

      {/* ================================================================= */}
      {/* CHAT CANVAS (Custom Solid Color or Custom Wallpaper + Dim Layer)  */}
      {/* ================================================================= */}
      <div
        className="relative flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-2.5"
        style={{
          backgroundColor: chatTheme.bgColor,
          backgroundImage: chatTheme.wallpaperDataUrl
            ? `url(${chatTheme.wallpaperDataUrl})`
            : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Optional Wallpaper Dim Overlay so bubbles remain super readable */}
        {chatTheme.wallpaperDataUrl && (
          <div
            className="pointer-events-none fixed sm:absolute inset-0 z-0"
            style={{
              backgroundColor: `rgba(0, 0, 0, ${chatTheme.wallpaperDim / 100})`,
            }}
          />
        )}

        <div className="relative z-10 flex flex-col min-h-full space-y-2.5">
          {sessionNotice && (
            <div className="mx-auto max-w-md w-full px-3 py-1.5 rounded-full bg-black/25 backdrop-blur-xs text-[11px] text-white flex items-center justify-between gap-2">
              <span className="truncate">{sessionNotice}</span>
              <button
                type="button"
                onClick={() => setSessionNotice(null)}
                className="shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
                aria-label={tr('Tutup notifikasi', 'Dismiss notice')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="my-auto py-8 flex flex-col items-center text-center max-w-md mx-auto space-y-4">
              {renderAvatar('h-16 w-16', 'text-lg')}
              <div className="space-y-1">
                <h2
                  className="text-base font-semibold"
                  style={{ color: bgContrast.text }}
                >
                  {chatTheme.agentName}
                </h2>
                <p
                  className="text-xs leading-relaxed px-2"
                  style={{ color: bgContrast.muted }}
                >
                  {tr(
                    'Asisten pribadi TradeVault siap sedia. Sapa santai, cek harga XAUUSD live, atau tanya arah berita & jurnal — semua data disinkronkan otomatis dengan memori jangka panjang.',
                    'Your TradeVault personal assistant is standing by. Chat casually, check live XAUUSD quotes, or analyze news & your journal — with auto-synced data & persistent memory.'
                  )}
                </p>
                {memoryItems.length > 0 && (
                  <p className="text-[11px] pt-0.5" style={{ color: bgContrast.muted }}>
                    {tr(
                      `${memoryItems.length} catatan memori aktif dari sesi sebelumnya.`,
                      `${memoryItems.length} persistent memories active from previous sessions.`
                    )}
                  </p>
                )}
              </div>

              {/* Conversational Quick Starters */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                {quickPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isSending}
                    onClick={() => void handleSend(prompt)}
                    className="text-left px-3.5 py-2.5 rounded-2xl text-xs leading-snug transition-transform active:scale-[0.98] cursor-pointer shadow-xs border"
                    style={{
                      backgroundColor: chatTheme.agentBubbleColor,
                      color: agentContrast.text,
                      borderColor: agentContrast.isLightSurface
                        ? 'rgba(15, 23, 42, 0.08)'
                        : 'rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const palette = isUser ? userContrast : agentContrast;
              const bubbleBg = isUser ? chatTheme.userBubbleColor : chatTheme.agentBubbleColor;
              const hasTrace =
                !isUser &&
                chatTheme.showDivisionTrace &&
                Array.isArray(msg.workflowTrace) &&
                msg.workflowTrace.length > 0;
              const traceOpen = Boolean(expandedTraceIds[msg.id]);

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && <div className="mb-1 shrink-0">{renderAvatar('h-7 w-7', 'text-[10px]')}</div>}

                  <div
                    className={`max-w-[84%] sm:max-w-[74%] px-3.5 py-2.5 shadow-xs ${
                      isUser
                        ? 'rounded-2xl rounded-br-md'
                        : 'rounded-2xl rounded-bl-md'
                    }`}
                    style={{
                      backgroundColor: bubbleBg,
                      color: palette.text,
                      border: palette.isLightSurface
                        ? '1px solid rgba(15, 23, 42, 0.07)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <div className="text-[13px] sm:text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                      {renderSafeRichText(msg.content)}
                    </div>

                    {/* Optional Subtle Division Workflow Trace (only if enabled in Customize) */}
                    {hasTrace && (
                      <div
                        className="mt-2 pt-1.5"
                        style={{
                          borderTop: `1px solid ${
                            palette.isLightSurface
                              ? 'rgba(15, 23, 42, 0.1)'
                              : 'rgba(255, 255, 255, 0.12)'
                          }`,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleTrace(msg.id)}
                          className="inline-flex items-center gap-1 text-[10.5px] font-medium cursor-pointer opacity-80 hover:opacity-100"
                          style={{ color: palette.muted }}
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>
                            {msg.routeType === 'SMALL_TALK'
                              ? tr('Mode Asisten', 'Assistant Mode')
                              : msg.routeType === 'OUT_OF_SCOPE'
                              ? tr('Batas Ranah', 'Scope Guard')
                              : msg.routeType === 'LIVE_PRICE_CHECK'
                              ? tr('Harga Live', 'Live Price')
                              : msg.routeType === 'DIRECT_FOLLOWUP'
                              ? tr('Smart Direct', 'Smart Direct')
                              : tr(
                                  `Alur divisi (${msg.workflowTrace!.length})${
                                    msg.revisionTriggered ? ' · Revisi ACC' : ''
                                  }`,
                                  `Division trace (${msg.workflowTrace!.length})${
                                    msg.revisionTriggered ? ' · Revised' : ''
                                  }`
                                )}
                          </span>
                          {traceOpen ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>

                        {traceOpen && (
                          <div className="mt-1.5 space-y-1 text-[10.5px]" style={{ color: palette.muted }}>
                            {msg.workflowTrace!.map((step) => (
                              <div key={step.stepNumber} className="leading-snug">
                                <span className="font-semibold" style={{ color: palette.text }}>
                                  {step.stepNumber}. {step.divisionName}
                                </span>{' '}
                                ({step.provider} · {step.latencyMs}ms): {step.summary}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Messenger Footer: Timestamp + Read Checkmarks */}
                    <div
                      className="mt-1 flex items-center justify-end gap-1 text-[10px] select-none"
                      style={{ color: palette.muted }}
                    >
                      <span>{formatChatTime(msg.createdAt)}</span>
                      {isUser && <CheckCheck className="h-3.5 w-3.5 opacity-85" />}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Typing Indicator Bubble */}
          {isSending && (
            <div className="flex items-end gap-2 justify-start">
              <div className="mb-1 shrink-0">{renderAvatar('h-7 w-7', 'text-[10px]')}</div>
              <div
                className="px-4 py-3 rounded-2xl rounded-bl-md shadow-xs inline-flex items-center gap-1.5"
                style={{
                  backgroundColor: chatTheme.agentBubbleColor,
                  color: agentContrast.text,
                  border: agentContrast.isLightSurface
                    ? '1px solid rgba(15, 23, 42, 0.07)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.25s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.12s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-bounce" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ================================================================= */}
      {/* MESSENGER COMPOSER BAR                                            */}
      {/* ================================================================= */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        className="shrink-0 px-3 sm:px-4 py-2.5 bg-white dark:bg-[#101318] border-t border-[#E4E4E7] dark:border-[#20252D] flex items-end gap-2 z-10"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(110, e.target.scrollHeight)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={tr(
            `Ketik pesan ke ${chatTheme.agentName}...`,
            `Message ${chatTheme.agentName}...`
          )}
          className="flex-1 resize-none max-h-[110px] px-4 py-2.5 rounded-2xl bg-[#F4F4F5] dark:bg-[#161B24] border border-transparent focus:border-[#CBD5E1] dark:focus:border-[#334155] text-[13.5px] text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#64748B] dark:placeholder-[#929BA9] focus:outline-none leading-snug"
        />
        <button
          type="submit"
          disabled={!input.trim() || isSending}
          className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40 cursor-pointer"
          style={{
            backgroundColor: chatTheme.userBubbleColor,
            color: userContrast.text,
          }}
          aria-label={tr('Kirim pesan', 'Send message')}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      {/* ================================================================= */}
      {/* IN-CHAT CUSTOMIZATION MODAL (Profile, Style, Colors, Wallpaper)   */}
      {/* ================================================================= */}
      {isCustomizeOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsCustomizeOpen(false)}
        >
          <div
            className="w-full sm:max-w-md max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] p-5 space-y-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7] dark:border-[#20252D]">
              <div>
                <h2 className="text-sm font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                  {tr('Kustomisasi Chat AI', 'Customize AI Chat')}
                </h2>
                <p className="text-[11px] text-[#64748B] dark:text-[#929BA9]">
                  {tr(
                    'Atur profil, gaya ngobrol, warna bubble & wallpaper',
                    'Customize profile, chat tone, bubble colors & wallpaper'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomizeOpen(false)}
                className="p-1.5 rounded-full text-[#64748B] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161B24] cursor-pointer"
                aria-label={tr('Tutup', 'Close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {uploadError && (
              <div className="px-3 py-2 rounded-xl bg-[#FEF2F2] dark:bg-[#2A1215] border border-[#FECACA] dark:border-[#7F1D1D] text-[11px] text-[#DC2626] dark:text-[#FCA5A5]">
                {uploadError}
              </div>
            )}

            {/* 1. Agent Profile (Avatar, Name, Subtitle) */}
            <div className="space-y-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                {tr('Profil Agent', 'Agent Profile')}
              </span>
              <div className="flex items-center gap-3.5">
                <div className="relative shrink-0">
                  {renderAvatar('h-14 w-14', 'text-base')}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] flex items-center justify-center shadow-xs cursor-pointer"
                    title={tr('Ubah foto profil', 'Change profile photo')}
                  >
                    <Camera className="h-3 w-3" />
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleAvatarUpload(e)}
                  />
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                  <input
                    type="text"
                    maxLength={40}
                    value={chatTheme.agentName}
                    onChange={(e) => updateChatTheme({ agentName: e.target.value })}
                    placeholder={tr('Nama Agent (mis. Raka Desk)', 'Agent Name')}
                    className="w-full px-3 py-1.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                  />
                  <input
                    type="text"
                    maxLength={50}
                    value={chatTheme.agentSubtitle}
                    onChange={(e) => updateChatTheme({ agentSubtitle: e.target.value })}
                    placeholder={tr('Status / Peran (mis. Partner Trading)', 'Status / Role')}
                    className="w-full px-3 py-1.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-[11px] text-[#526071] dark:text-[#929BA9] focus:outline-none focus:border-[#0F172A] dark:focus:border-white"
                  />
                </div>
              </div>
              {chatTheme.avatarDataUrl && (
                <button
                  type="button"
                  onClick={() => updateChatTheme({ avatarDataUrl: null })}
                  className="text-[11px] text-[#E11D48] hover:underline cursor-pointer"
                >
                  {tr('Hapus foto profil', 'Remove profile photo')}
                </button>
              )}
            </div>

            {/* 2. Speaking Persona */}
            <div className="space-y-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                {tr('Gaya Bicara AI', 'AI Speaking Style')}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'casual', labelId: 'Santai & Akrab', labelEn: 'Casual' },
                    { id: 'concise', labelId: 'Lugas Singkat', labelEn: 'Concise' },
                    { id: 'mentor', labelId: 'Mentor Tegas', labelEn: 'Direct Mentor' },
                  ] as Array<{ id: AgentChatPersona; labelId: string; labelEn: string }>
                ).map((opt) => {
                  const active = chatTheme.persona === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateChatTheme({ persona: opt.id })}
                      className={`px-2.5 py-2 rounded-xl text-[11px] font-medium border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#0F172A] text-white border-[#0F172A] dark:bg-white dark:text-[#0F172A] dark:border-white'
                          : 'bg-[#FAFAFA] dark:bg-[#0B0E13] text-[#526071] dark:text-[#929BA9] border-[#E4E4E7] dark:border-[#20252D] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                      }`}
                    >
                      {tr(opt.labelId, opt.labelEn)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Quick Theme Presets */}
            <div className="space-y-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                {tr('Preset Tema Cepat', 'Quick Theme Presets')}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {AGENT_CHAT_THEME_PRESETS.map((preset) => {
                  const selected =
                    !chatTheme.wallpaperDataUrl &&
                    chatTheme.bgColor.toLowerCase() === preset.bgColor.toLowerCase() &&
                    chatTheme.userBubbleColor.toLowerCase() === preset.userBubbleColor.toLowerCase() &&
                    chatTheme.agentBubbleColor.toLowerCase() === preset.agentBubbleColor.toLowerCase();
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        updateChatTheme({
                          bgColor: preset.bgColor,
                          userBubbleColor: preset.userBubbleColor,
                          agentBubbleColor: preset.agentBubbleColor,
                          wallpaperDataUrl: null,
                        })
                      }
                      className={`p-2 rounded-xl border text-left space-y-1.5 transition-all cursor-pointer ${
                        selected
                          ? 'border-[#0F172A] dark:border-white ring-1 ring-[#0F172A] dark:ring-white'
                          : 'border-[#E4E4E7] dark:border-[#20252D] hover:border-[#94A3B8]'
                      }`}
                    >
                      <div
                        className="h-9 rounded-lg p-1.5 flex flex-col justify-between border border-black/10"
                        style={{ backgroundColor: preset.bgColor }}
                      >
                        <div
                          className="h-2 w-8 rounded-full"
                          style={{ backgroundColor: preset.agentBubbleColor }}
                        />
                        <div
                          className="h-2 w-9 rounded-full self-end"
                          style={{ backgroundColor: preset.userBubbleColor }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10.5px] font-medium text-[#0F172A] dark:text-[#F2F4F7] truncate">
                          {preset.label}
                        </span>
                        {selected && <Check className="h-3 w-3 shrink-0 text-[#059669]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Free Color Pickers */}
            <div className="space-y-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                {tr('Kustom Warna Bebas', 'Custom Colors')}
              </span>
              <div className="grid grid-cols-3 gap-2.5">
                <label className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] cursor-pointer">
                  <span className="text-[10px] font-medium text-[#526071] dark:text-[#929BA9]">
                    {tr('Background', 'Background')}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={chatTheme.bgColor}
                      onChange={(e) => updateChatTheme({ bgColor: e.target.value })}
                      className="h-6 w-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="text-[10px] font-mono text-[#0F172A] dark:text-[#F2F4F7] uppercase">
                      {chatTheme.bgColor}
                    </span>
                  </div>
                </label>

                <label className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] cursor-pointer">
                  <span className="text-[10px] font-medium text-[#526071] dark:text-[#929BA9]">
                    {tr('Bubble Kamu', 'Your Bubble')}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={chatTheme.userBubbleColor}
                      onChange={(e) => updateChatTheme({ userBubbleColor: e.target.value })}
                      className="h-6 w-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="text-[10px] font-mono text-[#0F172A] dark:text-[#F2F4F7] uppercase">
                      {chatTheme.userBubbleColor}
                    </span>
                  </div>
                </label>

                <label className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] cursor-pointer">
                  <span className="text-[10px] font-medium text-[#526071] dark:text-[#929BA9]">
                    {tr('Bubble Agent', 'Agent Bubble')}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={chatTheme.agentBubbleColor}
                      onChange={(e) => updateChatTheme({ agentBubbleColor: e.target.value })}
                      className="h-6 w-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="text-[10px] font-mono text-[#0F172A] dark:text-[#F2F4F7] uppercase">
                      {chatTheme.agentBubbleColor}
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* 5. Wallpaper Image + Dim Slider */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                  {tr('Wallpaper Chat', 'Chat Wallpaper')}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => wallpaperInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[11px] font-medium text-[#0F172A] dark:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161B24] cursor-pointer"
                  >
                    <ImageIcon className="h-3 w-3" />
                    <span>{tr('Pilih Foto', 'Choose Photo')}</span>
                  </button>
                  {chatTheme.wallpaperDataUrl && (
                    <button
                      type="button"
                      onClick={() => updateChatTheme({ wallpaperDataUrl: null })}
                      className="text-[11px] text-[#E11D48] hover:underline cursor-pointer"
                    >
                      {tr('Hapus', 'Remove')}
                    </button>
                  )}
                </div>
                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleWallpaperUpload(e)}
                />
              </div>

              {chatTheme.wallpaperDataUrl && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[#526071] dark:text-[#929BA9]">
                    <span>{tr('Gelapkan Wallpaper', 'Wallpaper Dim')}</span>
                    <span className="font-mono">{chatTheme.wallpaperDim}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={85}
                    value={chatTheme.wallpaperDim}
                    onChange={(e) => updateChatTheme({ wallpaperDim: Number(e.target.value) })}
                    className="w-full accent-[#0F172A] dark:accent-white cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* 6. Offline Persistent Memory Manager */}
            <div className="space-y-2.5 pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9]" />
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                    {tr(
                      `Memori Offline (${memoryItems.length}/25)`,
                      `Offline Memory (${memoryItems.length}/25)`
                    )}
                  </span>
                </div>
                {memoryItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMemoryItems(clearAgentMemory())}
                    className="text-[11px] text-[#E11D48] hover:underline cursor-pointer"
                  >
                    {tr('Hapus Semua', 'Clear All')}
                  </button>
                )}
              </div>

              {memoryItems.length === 0 ? (
                <p className="text-[11px] text-[#64748B] dark:text-[#929BA9] leading-relaxed">
                  {tr(
                    'Belum ada memori tersimpan. Nama panggilan baru, level penting, atau ringkasan saat klik "Akhiri Sesi" akan otomatis disimpan di sini.',
                    'No memories saved yet. Nicknames, key market levels, or summaries when ending a session will be stored locally here.'
                  )}
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {memoryItems.map((mem) => (
                    <div
                      key={mem.id}
                      className="flex items-start justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <span className="inline-block text-[9.5px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#929BA9]">
                          {mem.category === 'preference'
                            ? tr('Preferensi', 'Preference')
                            : mem.category === 'market'
                            ? tr('Market', 'Market')
                            : mem.category === 'journal'
                            ? tr('Jurnal', 'Journal')
                            : tr('Umum', 'General')}
                        </span>
                        <p className="text-[11px] text-[#0F172A] dark:text-[#F2F4F7] leading-snug break-words">
                          {mem.text}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMemoryItems(deleteAgentMemoryItem(mem.id))}
                        className="shrink-0 p-1 rounded-full text-[#64748B] hover:text-[#E11D48] hover:bg-[#F4F4F5] dark:hover:bg-[#161B24] cursor-pointer"
                        title={tr('Hapus memori ini', 'Delete this memory')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 7. Division Trace Toggle */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
              <div className="min-w-0">
                <span className="text-xs font-medium text-[#0F172A] dark:text-[#F2F4F7] block">
                  {tr('Tampilkan Alur Divisi AI', 'Show AI Division Trace')}
                </span>
                <span className="text-[11px] text-[#64748B] dark:text-[#929BA9] block">
                  {tr(
                    'Matikan agar chat terlihat murni seperti WhatsApp / DM',
                    'Turn off for a pure WhatsApp / DM messenger look'
                  )}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={chatTheme.showDivisionTrace}
                onClick={() => updateChatTheme({ showDivisionTrace: !chatTheme.showDivisionTrace })}
                className={`relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors cursor-pointer ${
                  chatTheme.showDivisionTrace
                    ? 'bg-[#0F172A] dark:bg-white'
                    : 'bg-[#E4E4E7] dark:bg-[#2A313C]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white dark:bg-[#0F172A] transform transition-transform mt-1 ${
                    chatTheme.showDivisionTrace ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Footer Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleResetTheme}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-[#64748B] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161B24] cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{tr('Reset Tema', 'Reset Theme')}</span>
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClearChat();
                      setIsCustomizeOpen(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium text-[#E11D48] hover:bg-[#FEF2F2] dark:hover:bg-[#2A1215] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{tr('Hapus Chat', 'Wipe Chat')}</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsCustomizeOpen(false)}
                className="px-4 py-1.5 rounded-full bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-xs font-semibold cursor-pointer"
              >
                {tr('Selesai', 'Done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
