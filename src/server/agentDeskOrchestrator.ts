/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TradeVault Multi-Agent Office Orchestrator.
 *
 * Covers 3 Office Workflows:
 * 1. News & Fundamental Division Drafting (`runSpecialistNewsDraft`)
 *    - Trade News Division: Groq primary -> OpenRouter backup -> hands draft to Boss Gemini for ACC
 *    - Fundamental Gold Division: OpenRouter primary -> Groq backup -> hands draft to Boss Gemini for ACC
 * 2. Conversational AI Desk Chat (`runAgentDeskOrchestration`)
 *    - Smart Routing: quick follow-ups answered directly by Boss (saves quota & feels instant)
 *    - Full Office Teamwork: Macro Division [Groq] + Journal Division [OpenRouter] -> Boss Gemini Audit & Revision
 *    - Natural, human, persona-aware replies (casual / concise / mentor) — zero robotic templates
 * 3. QA / Cleaning Service Diagnostics Analyst (`runAiQaDiagnostics`)
 *    - Reads deterministic APK/Web health probe + error log and identifies exact root cause & fix.
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export type AgentProviderId = 'gemini' | 'groq' | 'openrouter' | 'system';
export type AgentChatPersona = 'casual' | 'concise' | 'mentor';

export interface AgentWorkflowStep {
  stepNumber: number;
  role:
    | 'BOSS_DISPATCH'
    | 'DIVISI_MAKRO'
    | 'DIVISI_JURNAL'
    | 'BOSS_AUDIT'
    | 'REVISION'
    | 'BOSS_SIGNOFF'
    | 'BOSS_DIRECT';
  divisionName: string;
  provider: AgentProviderId;
  model: string;
  action: string;
  status: 'completed' | 'revised' | 'fallback';
  summary: string;
  latencyMs: number;
}

export interface AgentDeskActionCard {
  directionClarity: 'BUY' | 'SELL' | 'WAIT_MIXED' | 'INFO_ONLY';
  directionLabel: string;
  spikeWarning: string;
  riskReminder: string;
}

export interface AgentDeskChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export type AgentDeskRouteType =
  | 'SMALL_TALK'
  | 'OUT_OF_SCOPE'
  | 'LIVE_PRICE_CHECK'
  | 'DIRECT_FOLLOWUP'
  | 'FULL_OFFICE';

export interface AgentExtractedMemoryFact {
  text: string;
  category: 'preference' | 'market' | 'journal' | 'general';
}

export interface AgentDeskResponsePayload {
  success: boolean;
  answer: string;
  routeType?: AgentDeskRouteType;
  actionCard: AgentDeskActionCard;
  workflowTrace: AgentWorkflowStep[];
  revisionTriggered: boolean;
  activeProviders: string[];
  totalLatencyMs: number;
  detectedAgentName?: string;
  newMemoryNotes?: AgentExtractedMemoryFact[];
  error?: string;
}

export interface AgentDeskEnvKeys {
  geminiKeys: string[];
  groqKeys: string[];
  openRouterKeys: string[];
}

const GEMINI_FAST_CHAT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;
const GEMINI_DEEP_CHAT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] as const;
const OPENROUTER_FREE_MODELS = ['meta-llama/llama-3.3-70b-instruct:free'] as const;

// Short in-memory cooldown when an external provider fails with 401/402/403/404/429
// so subsequent chat turns skip broken/unavailable providers in 0ms.
const providerCooldownUntil = new Map<string, { until: number; reason: string }>();
const PROVIDER_COOLDOWN_MS = 120_000;

function isProviderOnCooldown(provider: string): string | null {
  const entry = providerCooldownUntil.get(provider);
  if (!entry) return null;
  if (Date.now() < entry.until) return entry.reason;
  providerCooldownUntil.delete(provider);
  return null;
}

function markProviderCooldown(provider: string, reason: string): void {
  providerCooldownUntil.set(provider, {
    until: Date.now() + PROVIDER_COOLDOWN_MS,
    reason,
  });
}

export function parseEnvKeyList(raw: string | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length >= 8)
    )
  );
}

export function resolveAgentDeskEnvKeys(): AgentDeskEnvKeys {
  const geminiKeys = Array.from(
    new Set([
      ...parseEnvKeyList(process.env.GEMINI_NEWS_API_KEY),
      ...parseEnvKeyList(process.env.GEMINI_API_KEY),
    ])
  );
  const groqKeys = parseEnvKeyList(process.env.GROQ_API_KEY);
  const openRouterKeys = parseEnvKeyList(process.env.OPENROUTER_API_KEY);
  return { geminiKeys, groqKeys, openRouterKeys };
}

function sanitizeAgentError(err: unknown): string {
  return String((err as { message?: unknown })?.message || err || 'Unknown error')
    .replace(/AIza[0-9A-Za-z\-_]{16,}/g, '[REDACTED_KEY]')
    .replace(/gsk_[0-9A-Za-z\-_]{16,}/g, '[REDACTED_KEY]')
    .replace(/sk-or-[a-zA-Z0-9\-_]{16,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function withAbortTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    fn(controller.signal).then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function parseJsonLoose(rawText: string): Record<string, any> | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const sliced = cleaned.slice(start, end + 1);
        const parsed = JSON.parse(sliced);
        if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface ProviderCallResult {
  provider: AgentProviderId;
  model: string;
  text: string;
  json: Record<string, any> | null;
  latencyMs: number;
  skippedErrors?: string[];
}

function getRemainingBudgetMs(deadlineMs: number | undefined, capMs: number): number {
  if (!deadlineMs) return capMs;
  return Math.min(capMs, Math.max(0, deadlineMs - Date.now()));
}

async function callGeminiProvider(params: {
  keys: string[];
  models: readonly string[];
  systemInstruction: string;
  userPrompt: string;
  expectJson: boolean;
  timeoutMs: number;
  temperature?: number;
  deadlineMs?: number;
}): Promise<ProviderCallResult> {
  if (params.keys.length === 0) {
    throw new Error('Gemini API key not configured');
  }
  let lastErr: unknown = new Error('Gemini call failed');
  const deadKeys = new Set<string>();

  for (const model of params.models) {
    const modelCapMs =
      model === 'gemini-3.1-flash-lite' ? Math.min(params.timeoutMs, 6_800) : Math.min(params.timeoutMs, 9_000);
    for (const apiKey of params.keys) {
      if (deadKeys.has(apiKey)) continue;
      const budgetMs = getRemainingBudgetMs(params.deadlineMs, modelCapMs);
      if (budgetMs < 1500) {
        throw new Error(sanitizeAgentError(lastErr || new Error('Request deadline reached')));
      }
      const start = Date.now();
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
          retryOptions: { attempts: 1 },
        },
      });

      try {
        const response = await withAbortTimeout(
          (abortSignal) =>
            ai.models.generateContent({
              model,
              contents: params.userPrompt,
              config: {
                abortSignal,
                systemInstruction: params.systemInstruction,
                maxOutputTokens: 1400,
                ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
                ...(model === 'gemini-4-hydrogen'
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                ...(params.expectJson ? { responseMimeType: 'application/json' } : {}),
              },
            }),
          budgetMs,
          `Gemini(${model})`
        );

        const text = (response?.text || '').trim();
        if (text) {
          const json = params.expectJson ? parseJsonLoose(text) : null;
          if (!params.expectJson || json) {
            return {
              provider: 'gemini',
              model,
              text,
              json,
              latencyMs: Date.now() - start,
            };
          }
          lastErr = new Error(`Gemini(${model}) returned non-JSON`);
        } else {
          lastErr = new Error(`Gemini(${model}) empty response`);
        }
      } catch (err) {
        lastErr = err;
        const msg = sanitizeAgentError(err);
        if (/\b(401|403|429|API_KEY_INVALID|RESOURCE_EXHAUSTED)\b/i.test(msg)) {
          deadKeys.add(apiKey);
          continue;
        }
      }
    }
  }

  throw new Error(sanitizeAgentError(lastErr));
}

async function callOpenAiCompatibleProvider(params: {
  provider: 'groq' | 'openrouter';
  endpoint: string;
  keys: string[];
  models: readonly string[];
  systemInstruction: string;
  userPrompt: string;
  expectJson: boolean;
  timeoutMs: number;
  temperature?: number;
  deadlineMs?: number;
}): Promise<ProviderCallResult> {
  if (params.keys.length === 0) {
    throw new Error(`${params.provider} API key not configured`);
  }
  let lastErr: unknown = new Error(`${params.provider} call failed`);

  for (const apiKey of params.keys) {
    let keyFatal = false;
    for (const model of params.models) {
      if (keyFatal) break;
      const budgetMs = getRemainingBudgetMs(params.deadlineMs, params.timeoutMs);
      if (budgetMs < 1500) {
        throw new Error(sanitizeAgentError(lastErr || new Error('Request deadline reached')));
      }
      const start = Date.now();
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        };
        if (params.provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://tradevault.app';
          headers['X-Title'] = 'TradeVault AI Desk';
        }

        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: 'system', content: params.systemInstruction },
            { role: 'user', content: params.userPrompt },
          ],
          temperature: params.temperature ?? (params.expectJson ? 0.35 : 0.7),
          max_tokens: 1300,
        };
        if (params.expectJson && params.provider === 'groq') {
          body.response_format = { type: 'json_object' };
        }

        const res = await withAbortTimeout(
          (signal) =>
            fetch(params.endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal,
            }),
          budgetMs,
          `${params.provider}(${model})`
        );

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastErr = new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`);
          // Fast circuit-breaker: 401/402/403/404/429 won't succeed on sibling models of same key
          if (
            res.status === 401 ||
            res.status === 402 ||
            res.status === 403 ||
            res.status === 404 ||
            res.status === 429
          ) {
            keyFatal = true;
            markProviderCooldown(params.provider, `HTTP ${res.status}`);
          }
          continue;
        }

        const data = (await res.json()) as any;
        const rawContent = String(data?.choices?.[0]?.message?.content || '').trim();
        if (!rawContent) {
          lastErr = new Error(`${params.provider}(${model}) empty content`);
          continue;
        }

        const json = params.expectJson ? parseJsonLoose(rawContent) : null;
        if (!params.expectJson || json) {
          return {
            provider: params.provider,
            model,
            text: rawContent,
            json,
            latencyMs: Date.now() - start,
          };
        }
        lastErr = new Error(`${params.provider}(${model}) invalid JSON`);
      } catch (err) {
        lastErr = err;
        // Abort/timeout on first model of provider -> immediately exit provider so we don't burn 2x-3x timeout
        if (/timed out|abort/i.test(String((err as any)?.message || err))) {
          keyFatal = true;
        }
      }
    }
  }

  throw new Error(sanitizeAgentError(lastErr));
}

async function runWithProviderCascade(params: {
  order: Array<'gemini' | 'groq' | 'openrouter'>;
  keys: AgentDeskEnvKeys;
  preferDeepGemini?: boolean;
  isBoss?: boolean;
  systemInstruction: string;
  userPrompt: string;
  expectJson: boolean;
  timeoutMs: number;
  temperature?: number;
  deadlineMs?: number;
}): Promise<ProviderCallResult> {
  const errors: string[] = [];
  const useDeepGemini = params.preferDeepGemini ?? Boolean(params.isBoss);

  for (const prov of params.order) {
    if (params.deadlineMs && params.deadlineMs - Date.now() < 1500) {
      errors.push(`${prov}: skipped (deadline budget reached)`);
      break;
    }
    if (prov !== 'gemini') {
      const cdReason = isProviderOnCooldown(prov);
      if (cdReason) {
        errors.push(`${prov}: cooldown (${cdReason})`);
        continue;
      }
    }
    try {
      if (prov === 'groq' && params.keys.groqKeys.length > 0) {
        const res = await callOpenAiCompatibleProvider({
          provider: 'groq',
          endpoint: 'https://api.groq.com/openai/v1/chat/completions',
          keys: params.keys.groqKeys,
          models: GROQ_MODELS,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          expectJson: params.expectJson,
          timeoutMs: Math.min(params.timeoutMs, 4_500),
          temperature: params.temperature,
          deadlineMs: params.deadlineMs,
        });
        return { ...res, skippedErrors: errors.length > 0 ? errors : undefined };
      }
      if (prov === 'openrouter' && params.keys.openRouterKeys.length > 0) {
        const res = await callOpenAiCompatibleProvider({
          provider: 'openrouter',
          endpoint: 'https://openrouter.ai/api/v1/chat/completions',
          keys: params.keys.openRouterKeys,
          models: OPENROUTER_FREE_MODELS,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          expectJson: params.expectJson,
          timeoutMs: Math.min(params.timeoutMs, 4_500),
          temperature: params.temperature,
          deadlineMs: params.deadlineMs,
        });
        return { ...res, skippedErrors: errors.length > 0 ? errors : undefined };
      }
      if (prov === 'gemini' && params.keys.geminiKeys.length > 0) {
        const res = await callGeminiProvider({
          keys: params.keys.geminiKeys,
          models: useDeepGemini ? GEMINI_DEEP_CHAT_MODELS : GEMINI_FAST_CHAT_MODELS,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          expectJson: params.expectJson,
          timeoutMs: Math.min(params.timeoutMs, 11_500),
          temperature: params.temperature,
          deadlineMs: params.deadlineMs,
        });
        return { ...res, skippedErrors: errors.length > 0 ? errors : undefined };
      }
    } catch (err) {
      errors.push(`${prov}: ${sanitizeAgentError(err)}`);
    }
  }

  throw new Error(errors.join(' | ') || 'No configured AI provider succeeded');
}

// ============================================================================
// 1. MULTI-AGENT STAFF DRAFTING FOR TRADE NEWS & FUNDAMENTAL GOLD (BOSS GEMINI ACC)
// ============================================================================

export interface SpecialistNewsDraftResult {
  used: boolean;
  provider: 'groq' | 'openrouter' | null;
  model: string | null;
  draftText: string;
  latencyMs: number;
}

/**
 * Offloads initial heavy research synthesis for Trade News (Groq primary -> OpenRouter backup)
 * or Fundamental Gold (OpenRouter primary -> Groq backup) before handing the memo to Boss Gemini
 * for strict verification and ACC sign-off.
 * Returns `{ used: false }` cleanly when neither GROQ_API_KEY nor OPENROUTER_API_KEY is set.
 */
export async function runSpecialistNewsDraft(params: {
  division: 'TRADE_NEWS' | 'FUNDAMENTAL_GOLD';
  dataset: Record<string, unknown>;
  keys?: AgentDeskEnvKeys;
}): Promise<SpecialistNewsDraftResult> {
  const keys = params.keys || resolveAgentDeskEnvKeys();
  const hasExternalStaff = keys.groqKeys.length > 0 || keys.openRouterKeys.length > 0;
  if (!hasExternalStaff) {
    return { used: false, provider: null, model: null, draftText: '', latencyMs: 0 };
  }

  const order: Array<'groq' | 'openrouter'> =
    params.division === 'TRADE_NEWS' ? ['groq', 'openrouter'] : ['openrouter', 'groq'];

  const systemInstruction =
    params.division === 'TRADE_NEWS'
      ? `Kamu adalah Divisi Riset Berita & Spike XAU/USD. Tugasmu menyusun DRAFT MEMO singkat dan tajam untuk diperiksa & di-ACC oleh Boss Gemini.
Fokus: (1) arah dominan XAU/USD (BUY/SELL/MIXED) & probabilitas wajar berdasarkan DXY, US02Y, US10Y, USOIL, FedWatch, dan rilis kalender, (2) deteksi jelas 1-Arah vs 2-Arah Sweep First (Fase 0-5 menit vs Fase 15+ menit), (3) peringatan jebakan pidato Fed / priced-in / whipsaw, (4) tesis singkat lintas aset.
Keluarkan memo ringkas padat (maks 280 kata) berbasis data nyata saja.`
      : `Kamu adalah Divisi Riset Fundamental Emas (XAU/USD). Tugasmu menyusun DRAFT MEMO lintas-aset untuk diperiksa & di-ACC oleh Boss Gemini.
ATURAN: DILARANG menulis kata "BUY" atau "SELL" — gunakan hanya "BULLISH", "BEARISH", atau "NEUTRAL".
Fokus: (A) rezim makro & perubahan terbaru, (B) Real Yield, US10Y, FedWatch & DXY, (C) arus modal lintas pasar (Wall Street, VIX, GLD, CFTC COT, Asia/China, Oil), (D) proyeksi 1D / 1W / 1M + pemicu invalidasi.
Keluarkan memo padat (maks 320 kata) hanya dari angka nyata di dataset.`;

  const userPrompt = `Dataset terverifikasi untuk ${params.division}:\n${JSON.stringify(params.dataset).slice(
    0,
    13_500
  )}\n\nSusun draft memo riset untuk di-review & di-ACC oleh Boss Gemini.`;

  try {
    const res = await runWithProviderCascade({
      order,
      keys,
      isBoss: false,
      systemInstruction,
      userPrompt,
      expectJson: false,
      timeoutMs: 7000,
      temperature: 0.2,
    });
    if (res.provider === 'groq' || res.provider === 'openrouter') {
      return {
        used: true,
        provider: res.provider,
        model: res.model,
        draftText: res.text.slice(0, 2600),
        latencyMs: res.latencyMs,
      };
    }
  } catch {
    // Non-blocking: Boss Gemini still completes the full analysis directly
  }
  return { used: false, provider: null, model: null, draftText: '', latencyMs: 0 };
}

// ============================================================================
// 2. CONVERSATIONAL MULTI-AGENT AI DESK (SMART ROUTING + NATURAL PERSONA)
// ============================================================================

function sanitizeIncomingPayload(raw: unknown): {
  valid: boolean;
  error?: string;
  message: string;
  language: 'id' | 'en';
  persona: AgentChatPersona;
  agentName: string;
  history: AgentDeskChatHistoryItem[];
  contextObj: Record<string, any>;
} {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';
  if (!message) {
    return {
      valid: false,
      error: 'Pertanyaan tidak boleh kosong.',
      message: '',
      language: 'id',
      persona: 'casual',
      agentName: 'Head Desk',
      history: [],
      contextObj: {},
    };
  }

  const language: 'id' | 'en' = body.language === 'en' ? 'en' : 'id';
  const rawPersona = String(body.persona || 'casual').toLowerCase();
  const persona: AgentChatPersona =
    rawPersona === 'concise' || rawPersona === 'mentor' ? rawPersona : 'casual';
  const agentName =
    typeof body.agentName === 'string' && body.agentName.trim()
      ? body.agentName.trim().slice(0, 40)
      : 'Head Desk';

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: AgentDeskChatHistoryItem[] = rawHistory
    .slice(-10)
    .filter(
      (item: any) =>
        item &&
        typeof item === 'object' &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0
    )
    .map((item: any) => ({
      role: item.role as 'user' | 'assistant',
      content: String(item.content).trim().slice(0, 800),
    }));

  const contextObj =
    body.context && typeof body.context === 'object' && !Array.isArray(body.context)
      ? (body.context as Record<string, any>)
      : {};

  return {
    valid: true,
    message,
    language,
    persona,
    agentName,
    history,
    contextObj,
  };
}

function getPersonaStyleGuide(persona: AgentChatPersona, agentName: string, isEn: boolean): string {
  if (isEn) {
    if (persona === 'concise') {
      return `Your name is ${agentName}, the user's personal trading assistant inside TradeVault. Reply crisp, sharp, natural, and direct (2–4 short sentences). Zero robotic filler.`;
    }
    if (persona === 'mentor') {
      return `Your name is ${agentName}, the user's trusted personal trading partner & mentor inside TradeVault (calm, perceptive, grounded like Alfred). Speak warmly and honestly like a real human partner.`;
    }
    return `Your name is ${agentName}, the user's close personal trading assistant inside TradeVault (smart, warm, witty like Jarvis/Alfred). Chat like a real human friend on WhatsApp/DM — match the user's vibe naturally, never use repetitive cliché lines like "Copy that, boss! I'm always standing by" on every reply.`;
  }
  if (persona === 'concise') {
    return `Namamu ${agentName}, asisten pribadi trading di dalam aplikasi TradeVault. Balas singkat, lugas, dan langsung ke intinya (2–4 kalimat pendek). Tanpa basa-basi robot.`;
  }
  if (persona === 'mentor') {
    return `Namamu ${agentName}, asisten pribadi sekaligus mentor trading di TradeVault (tenang, jeli membaca risiko, hangat seperti Alfred). Ngobrol jujur dan membumi seperti partner manusia sungguhan.`;
  }
  return `Namamu ${agentName}, asisten pribadi trading pengguna di TradeVault. Ngobrol santai, akrab, cerdas, dan luwes layaknya teman dekat/partner di WhatsApp.
GAYA BAHASA WAJIB:
- Ikuti nada bicara user secara alami (kalau user pakai aku/kamu atau santai, imbangi dengan natural — jangan kaku seperti customer service).
- DILARANG mengulang-ulang kalimat klise bot seperti "Siap, bos!", "Saya standby kalau butuh bantuan apa-apa hari ini", atau format daftar kaku "1. ... 2. ... 3. ..." setiap kali membalas.
- Pahami partikel percakapan Indonesia (yaa, deh, dong, aja, nih, sih, kan, kok, yuk) sebagai nada bicara biasa, BUKAN bagian dari nama atau istilah.`;
}

function cleanExtractedAgentName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let cleaned = raw
    .replace(/["'`~!?.,()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;

  // Strip trailing Indonesian/English conversational particles including stretched vowels ("yaa", "yaaa", "dehh", "dongg")
  cleaned = cleaned
    .replace(
      /\b(ya+h?|yakk?|de+h+|do+ng+|a+ja+|sa+ja+|ni+h+|si+h+|la+h+|ka+n|ko+k|yu+k+|o+ke+y?h?|si+p+|bo+s+|bro+|ga+n|ka+k|bang|min|pls|please|biar|supaya|karena|soal|soalnya|aja|gitu)\b.*$/i,
      ''
    )
    .trim();

  // Keep max 2 words for a clean nickname
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 2);
  cleaned = words.join(' ').trim();
  if (cleaned.length < 2 || cleaned.length > 24) return undefined;
  if (/^(kamu|lu|lo|anda|aku|saya|gue|gw|nama|panggil|ai|bot|null|none|undefined)$/i.test(cleaned)) {
    return undefined;
  }
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractNicknameRenameFallback(message: string): string | undefined {
  const m = message.match(
    /(?:panggil(?:\s+kamu|\s+lu|\s+lo|\s+anda)?(?:\s+dengan)?|namamu(?:\s+sekarang)?|mulai\s+sekarang\s+(?:kamu\s+)?(?:saya\s+|aku\s+)?panggil(?:\s+kamu)?|call\s+you|your\s+name\s+is)\s+["']?([A-Za-z][A-Za-z0-9._\- ]{1,30})["']?/i
  );
  if (!m || !m[1]) return undefined;
  return cleanExtractedAgentName(m[1]);
}

function formatMemoryListForPrompt(contextObj: Record<string, any>): string {
  const rawList = Array.isArray(contextObj?.memoryNotes) ? contextObj.memoryNotes : [];
  if (rawList.length === 0) return '(Belum ada memori tersimpan)';
  return rawList
    .slice(0, 20)
    .map((item: any, idx: number) => {
      if (typeof item === 'string') return `${idx + 1}. ${item.slice(0, 200)}`;
      if (item && typeof item.text === 'string') {
        return `${idx + 1}. [${String(item.category || 'general')}] ${item.text.slice(0, 200)}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function formatHistoryBlock(history: AgentDeskChatHistoryItem[]): string {
  if (history.length === 0) return '(Baru memulai obrolan)';
  return history
    .slice(-8)
    .map((h) => `${h.role === 'user' ? 'USER' : 'ASISTEN'}: ${h.content}`)
    .join('\n');
}

function preClassifySpeedHint(message: string): {
  likelyHeavyMarket: boolean;
  likelyMarketOutlook: boolean;
  likelyLivePrice: boolean;
  likelyJournalOrApp: boolean;
} {
  const q = message.trim().toLowerCase();
  const hasPriceCue =
    /\b(harga|price|spot|level|berapa|brp|skrg|sekarang|saat ini|di angka|dimana|di mana|running|update harga|cek harga)\b/i.test(
      q
    );
  const hasAssetCue = /\b(xau|xauusd|gold|emas|dxy|us10y|us02y|usoil|oil|btc|eurusd)\b/i.test(q);
  const asksDeepAnalysis =
    /\b(kenapa|mengapa|analisis|analisa|fundamental|berita|news|jurnal|journal|spike|sweep|prediksi|arah|kemana|ke mana|buy|sell|entry|posisi|risiko|risk|drawdown|win\s?rate|fomc|cpi|nfp|evaluasi|audit|bagusnya|ambil|grow|growth|selisih|compound|monte\s?carlo|simulasi|cycle|siklus|confluence|astronacci|seasonality|smc)\b/i.test(
      q
    );
  const asksLivePrice = hasPriceCue && hasAssetCue && !asksDeepAnalysis;

  const asksJournalOrApp =
    /\b(jurnal|journal|trade|trading|posisi|open|planned|lot|risiko|risk|drawdown|dd|win\s?rate|profit|loss|rugi|equity|saldo|balance|guardrail|evaluasi|audit|rekap|grow|growth|pertumbuhan|selisih|kemarin|kemaren|tgl|tanggal|minggu\s+(?:ini|lalu)|bulan\s+(?:ini|lalu)|hari\s+ini|persen|persentase|modal|compound|compounding|monte\s?carlo|simulasi|simulation|expectancy|profit\s?factor|r[\s-]?multiple|kalkulator|calculator|playbook|radar|ocr|scan|screenshot|vela|replay|strategi|strategy|streak|komisi|commission|swap|pip|pips|hit\s*tp|hit\s*sl|manual\s*close|close\s*manual|rasio|rr|disiplin|kebiasaan|bocor|kesalahan|mistake|emosi|checklist|fitur|menu|cara\s+(?:pakai|input|buka|gunakan|catat|cek|export)|struktur\s+app|kurang\s+paham|belum\s+paham|gak\s+paham|ga\s+paham|bingung|jelasin|jelaskan|maksud|maksudnya|simpel|sederhana)\b/i.test(
      q
    );

  // Explicit market/macro/fundamental/cycle/news/direction cues
  const explicitMarketNewsOrCycleCue =
    /\b(news|berita|makro|macro|fundamental|fomc|fed|fedwatch|cpi|ppi|nfp|pmi|powell|polymarket|cot|cftc|real\s*yield|dxy|yield|us10y|us02y|usoil|oil|cycle|siklus|confluence|astronacci|lunar|bulan\s+purnama|seasonality|smc|heatmap|spike|sweep|whipsaw|arah\s+(?:emas|gold|xau|market|pasar)|(?:emas|gold|xau|xauusd|market|pasar)\s+(?:mau\s+)?(?:kemana|ke\s+mana|naik|turun|hari\s+ini)|sentimen|outlook|bias\s+(?:emas|gold|xau|hari\s+ini|market)|kalender\s+ekonomi|jadwal\s+news|ada\s+news|ga\s*ada\s+news|gak\s+ada\s+news|tidak\s+ada\s+news)\b/i.test(
      q
    );

  // Asset/direction words ONLY count as Market Outlook if user is NOT purely asking about their own journal trades!
  const isPureJournalMentioningGold =
    asksJournalOrApp &&
    !explicitMarketNewsOrCycleCue &&
    /\b(jurnal|journal|trade\s+(?:saya|ku|aku|kemarin|kemaren|hari|tgl)|profit|loss|hit\s*tp|hit\s*sl|manual|rasio|rr|disiplin|evaluasi|audit|rekap|selisih|grow|growth|kebiasaan|bocor|tgl|tanggal|kemarin|kemaren|cara\s+(?:pakai|input|buka)|fitur|menu|monte\s?carlo|compound)\b/i.test(
      q
    );

  const genericMarketCue =
    /\b(xau|xauusd|gold|emas|forex|market|pasar|chart|candle|buy|sell|long|short|bullish|bearish|entry)\b/i.test(
      q
    );

  const likelyMarketOutlook =
    explicitMarketNewsOrCycleCue || (genericMarketCue && !isPureJournalMentioningGold);

  return {
    likelyHeavyMarket: (likelyMarketOutlook || asksJournalOrApp) && !asksLivePrice,
    likelyMarketOutlook,
    likelyLivePrice: asksLivePrice,
    likelyJournalOrApp: asksJournalOrApp,
  };
}

function buildCompactDeviceContext(contextObj: Record<string, any>): Record<string, unknown> {
  // Put runtime.localClock, liveMarketQuote, marketAlertBadge, and journal FIRST so heavy market text never truncates journal math!
  return {
    runtime: contextObj?.runtime ?? null,
    liveMarketQuote: contextObj?.liveMarketQuote ?? null,
    marketAlertBadge: contextObj?.marketAlertBadge ?? null,
    journal: contextObj?.journal ?? null,
    // Module 1: Berita Trading (intraday/event catalyst & 1-Way vs 2-Way Sweep First)
    macroNews: contextObj?.macroNews
      ? {
          moduleName: 'Berita Trading (Trade News / Event Intraday)',
          analyzedAt: contextObj.macroNews.analyzedAt,
          dominantBias: contextObj.macroNews.dominantBias,
          buyProbability: contextObj.macroNews.buyProbability,
          sellProbability: contextObj.macroNews.sellProbability,
          mixedProbability: contextObj.macroNews.mixedProbability,
          primaryEvent: contextObj.macroNews.primaryEvent,
          institutionalDeskThesis: contextObj.macroNews.institutionalDeskThesis,
          actionPlan: contextObj.macroNews.actionPlan,
          whipsawWarning: contextObj.macroNews.whipsawWarning,
          dualHorizon: contextObj.macroNews.dualHorizon,
          intermarketPulse: contextObj.macroNews.intermarketPulse,
          topHeadlines: contextObj.macroNews.topHeadlines,
        }
      : null,
    // Module 2: Fundamental Emas (multi-horizon macro regime 1D/1W/1M — strictly BULLISH/BEARISH/NEUTRAL)
    fundamentalGold: contextObj?.fundamentalGold
      ? {
          moduleName: 'Fundamental Emas (Makro Multi-Horizon 1D/1W/1M)',
          analyzedAt: contextObj.fundamentalGold.analyzedAt,
          overallBias: contextObj.fundamentalGold.overallBias,
          bullishProbability: contextObj.fundamentalGold.bullishProbability,
          bearishProbability: contextObj.fundamentalGold.bearishProbability,
          regime: contextObj.fundamentalGold.regime,
          horizons: contextObj.fundamentalGold.horizons,
          tacticalOverlayStatus: contextObj.fundamentalGold.tacticalOverlayStatus,
          tacticalOverlayHeadline: contextObj.fundamentalGold.tacticalOverlayHeadline,
          headlineSummary: contextObj.fundamentalGold.headlineSummary,
        }
      : null,
    // Module 3: Siklus & Confluence (WIB session, Astronacci lunar/solar/Fib time, XAU seasonality, AMD/SMC)
    cycleConfluence: contextObj?.cycleConfluence ?? null,
    cmeFedWatch: contextObj?.cmeFedWatch ?? null,
    polymarket: contextObj?.polymarket ?? null,
    smcSignal: contextObj?.smcSignal ?? null,
    syncStatus: contextObj?.syncStatus ?? null,
  };
}

function normalizeActionCard(raw: any, language: 'id' | 'en'): AgentDeskActionCard {
  const dirRaw = String(raw?.directionClarity || 'INFO_ONLY').toUpperCase();
  const directionClarity: AgentDeskActionCard['directionClarity'] =
    dirRaw === 'BUY' || dirRaw === 'SELL' || dirRaw === 'WAIT_MIXED' ? dirRaw : 'INFO_ONLY';
  return {
    directionClarity,
    directionLabel: String(raw?.directionLabel || (language === 'en' ? 'Desk Chat' : 'Obrolan Asisten')).slice(0, 120),
    spikeWarning: String(raw?.spikeWarning || '-').slice(0, 220),
    riskReminder: String(raw?.riskReminder || '-').slice(0, 220),
  };
}

function formatProviderDisplayName(p: AgentProviderId): string {
  if (p === 'gemini') return 'Gemini';
  if (p === 'groq') return 'Groq';
  if (p === 'openrouter') return 'OpenRouter';
  return 'System';
}

export async function runAgentDeskOrchestration(
  rawBody: unknown,
  keys: AgentDeskEnvKeys
): Promise<{ status: number; payload: AgentDeskResponsePayload }> {
  const startedAt = Date.now();
  const deadlineMs = startedAt + 21_000; // Fast & resilient budget well under client 26s timeout

  const validated = sanitizeIncomingPayload(rawBody);
  if (!validated.valid) {
    return {
      status: 400,
      payload: {
        success: false,
        answer: '',
        actionCard: normalizeActionCard(null, 'id'),
        workflowTrace: [],
        revisionTriggered: false,
        activeProviders: [],
        totalLatencyMs: Date.now() - startedAt,
        error: validated.error || 'Payload tidak valid.',
      },
    };
  }

  const totalKeysAvailable =
    keys.geminiKeys.length + keys.groqKeys.length + keys.openRouterKeys.length;
  if (totalKeysAvailable === 0) {
    return {
      status: 503,
      payload: {
        success: false,
        answer: '',
        actionCard: normalizeActionCard(null, validated.language),
        workflowTrace: [],
        revisionTriggered: false,
        activeProviders: [],
        totalLatencyMs: Date.now() - startedAt,
        error:
          validated.language === 'en'
            ? 'No AI provider key configured on the server yet.'
            : 'Belum ada API Key AI yang aktif di server.',
      },
    };
  }

  const isEn = validated.language === 'en';
  const speedHint = preClassifySpeedHint(validated.message);
  const memoryText = formatMemoryListForPrompt(validated.contextObj);
  const personaGuide = getPersonaStyleGuide(validated.persona, validated.agentName, isEn);

  // Smart context routing:
  // - Market outlook / live price -> full 3-module market context + journal + localClock + marketAlertBadge
  // - Pure journal / app / ongoing chat -> runtime.localClock + marketAlertBadge (peripheral awareness only!) + full micro-forensic journal (NO heavy news dump that causes news-bleeding!)
  // - Pure small talk -> minimal runtime + spot quote only
  const needsMarketData = speedHint.likelyMarketOutlook || speedHint.likelyLivePrice;
  const needsJournalData = speedHint.likelyJournalOrApp || validated.history.length >= 2;
  const compactContext = needsMarketData
    ? buildCompactDeviceContext(validated.contextObj)
    : needsJournalData
    ? {
        runtime: validated.contextObj?.runtime ?? null,
        liveMarketQuote: validated.contextObj?.liveMarketQuote?.xauusd
          ? { xauusd: validated.contextObj.liveMarketQuote.xauusd }
          : null,
        marketAlertBadge: validated.contextObj?.marketAlertBadge ?? null,
        journal: validated.contextObj?.journal ?? null,
      }
    : {
        runtime: validated.contextObj?.runtime ?? null,
        liveMarketQuote: validated.contextObj?.liveMarketQuote?.xauusd
          ? { xauusd: validated.contextObj.liveMarketQuote.xauusd }
          : null,
      };

  const systemInstruction = `${personaGuide}

IDENTITAS & JIWA ASISTEN (ALFRED / JARVIS PRIBADI DI TRADEVAULT / VLO JOURNAL):
Kamu adalah partner trading pribadi yang hidup, peka konteks, luwes, dan sangat teliti. Kamu BUKAN bot kaku yang menjawab dengan template berita setiap saat.
- ALUR PERCAKAPAN NON-LINEAR: User bebas lompat topik kapan saja (misalnya dari audit jurnal -> tiba-tiba tanya arah emas hari ini -> tanya cara pakai fitur app -> balik lagi ke detail jurnal). Selalu ikuti konteks terbaru secara mulus dan pahami rujukan obrolan sebelumnya ("kemarin", "yang tadi", "total profitnya berapa", "kebiasaan yang bocor apa").
- INSTING FLEKSIBEL (ANTI-MEMAKSA NEWS!):
  * Saat user sedang membahas **jurnal trade murni**, audit eksekusi, perhitungan growth/compounding/Monte Carlo, atau cara pakai app -> fokus 100% pada jurnal/topik itu. **DILARANG** memaksakan komentar berita makro/news kecuali user sendiri yang menyinggungnya atau catatan trade memang menyebut news!
  * Saat user menanyakan **arah market / outlook emas** (mis. "hari ini emas mau kemana?", "gold gimana hari ini?") -> berikan analisis utuh dengan membedakan 3 modul pasar secara jelas, DAN **secara proaktif cek \`marketAlertBadge.hasHighImpactNews\`**:
    - Jika \`hasHighImpactNews === true\`, WAJIB ingatkan user ada berita/katalis berdampak tinggi (\`primaryEventTitle\`, \`primaryEventImpact\`, pola 1-Arah vs 2-Arah Sweep First) yang berpotensi mengguncang emas supaya tidak terlewat!
    - Jika \`hasHighImpactNews === false\` (atau \`macroNews\` sepi), sampaikan dengan jujur bahwa kalender berita sedang relatif sepi/tidak ada katalis besar, lalu fokuskan bacaan ke Fundamental Emas & Siklus/Confluence tanpa mengarang narasi berita!
- PROAKTIF ALA ALFRED/JARVIS: Beri arahan bijak, peringatan risiko, atau larangan halus saat memang penting bagi keselamatan akun user (mis. batas rugi harian kena, kebiasaan close manual kepagian di bawah 60% TP, rasio RR terbalik SL > TP, lot kegedean/over-risk, atau ada jadwal rilis high-impact sebentar lagi) — sampaikan dengan bahasa manusiawi yang hangat, bukan menggurui.

PILIH SATU JALUR PALING TEPAT DI FIELD "intent":
1. "SMALL_TALK" — Sapaan, perkenalan, obrolan santai, terima kasih, atau ganti nama panggilan ("saya panggil kamu Wowo yaa").
   - ATURAN KERAS: DILARANG membocorkan arah market, harga XAU, berita, atau isi jurnal jika user tidak menanyakannya!
   - Jika ganti nama, isi "renamedTo" HANYA nama bersih tanpa partikel ("Wowo yaa" -> "Wowo").
2. "OUT_OF_SCOPE" — Topik umum di luar trading, matematika keuangan/trading, & aplikasi TradeVault (resep, bola, gosip, obat, film, dll). Tolak hangat sesuai karaktermu.
3. "LIVE_PRICE_CHECK" — User hanya menanyakan harga spot terkini (mis. harga XAU/USD sekarang berapa). Gunakan HANYA angka nyata dari \`liveMarketQuote\`.
4. "DIRECT_FOLLOWUP" — Pertanyaan/tanggapan lanjutan singkat dalam obrolan yang sedang berjalan (mis. "total profitnya berapa?", "kurang paham", "jelasin lebih simpel", "balik lagi ke jurnal").
5. "FULL_OFFICE" — Analisis arah market XAU/USD, Berita Trading, Fundamental Emas, Siklus & Confluence, evaluasi/forensik jurnal, selisih growth, hitungan compounding/lot/risiko, atau panduan fitur & struktur aplikasi TradeVault.

ATURAN JAM LOKAL, TANGGAL & KALKULASI PRESISI (0% SALAH TANGGAL, 0% SALAH HITUNG!):
- SELALU baca \`runtime.localClock\` terlebih dahulu:
  * \`localReadableId\` (tanggal lokal user hari ini, mis. "Jumat, 27 November 2026"), \`localTimeHHMM\` + \`timezone\` (mis. "01:05 WIB"), \`yesterdayReadableId\` (tanggal "kemarin" yang BENAR menurut jam lokal user!).
  * Perhatikan \`isEarlyMorningLocal\`: jika user chat jam 00:00–05:59 dini hari, "kemarin" adalah \`yesterdayDateKey\` (\`yesterdayReadableId\`), BUKAN minggu sebelumnya!
- SELALU baca \`journal.focusedPeriod\` untuk pertanyaan tentang tanggal/hari/minggu/bulan tertentu (termasuk pertanyaan lanjutan seperti "total profitnya kemarin berapa persisnya?" karena resolver otomatis membaca riwayat chat!):
  * Gunakan ANGKA DETERMINISTIK langsung dari \`journal.focusedPeriod\`: \`label\`, \`startDate\`, \`endDate\`, \`matchedFrom\`, \`tradesCount\`, \`wins\`, \`losses\`, \`breakeven\`, \`winRatePct\`, \`totalGrossProfit\`, \`totalCommission\`, \`totalSwap\`, \`totalNetProfit\`, \`periodGainDeltaOnStartingBalancePct\`, \`totalR\`, \`avgR\`, \`avgPlannedRR\`, \`closeTypeCounts\` (\`hitTP\`, \`hitSL\`, \`manualProfit\`, \`manualLoss\`, \`manualBE\`), \`auditSummary\`, dan daftar \`trades\` di periode tersebut.
  * **DILARANG KERAS** menjumlahkan profit secara manual jika sudah ada \`focusedPeriod.totalNetProfit\` atau \`dailyHistory[i].netProfit\`! Gunakan angka persisnya (termasuk gross, komisi, swap, dan net jika relevan) agar 100% akurat hingga sen!
  * Jika \`focusedPeriod.tradesCount === 0\`, sampaikan jujur belum ada trade selesai di tanggal tersebut, lalu boleh tawarkan melihat hari aktif terdekat dari \`journal.dailyHistory\`.
- Untuk pertanyaan SELISIH GROWTH kemarin vs hari ini, gunakan \`journal.growthComparison\`:
  * \`beforeTodayCumulativeGainPct\` (total grow s/d kemarin), \`currentTotalGainPct\` (total grow sekarang), **\`todayCumulativeGainDeltaPct\`** (SELISIH total persen grow hari ini), \`todayCompoundedReturnPct\` (return harian terhadap ekuitas kemarin), \`todayClosedTradesCount\`, \`todayNetProfit\`.

FORENSIK MIKRO JURNAL (WAJIB PAHAM SAMPAI DETAIL TERKECIL!):
Kamu bisa melihat setiap trade hingga detail mikro di \`journal.focusedPeriod.trades\`, \`journal.recentClosedTrades\`, \`journal.openOrPlannedTrades\`, \`journal.microPatternsSummary\`, \`journal.dailyHistory\` (30 hari), \`journal.strategyBreakdown\`, \`journal.sessionBreakdown\`, \`journal.topMistakes\`, \`journal.playbooks\`, dan \`journal.riskGuardrails\`:
- **Cara Close (\`closeType\`)**: bedakan dengan tajam antara **HIT_TP** (kena Take Profit penuh), **HIT_SL** (kena Stop Loss sesuai rencana), **MANUAL_PROFIT** (ditutup manual saat profit — cek \`tpCompletionPct\`! Jika < 65% artinya tutup kepagian / profit terpotong), **MANUAL_LOSS** (cut loss manual sebelum SL), dan **MANUAL_BE** (tutup impas).
- **Rasio & Kualitas Setup**: bandingkan \`plannedRR\` (rasio TP vs SL awal) dengan \`realizedR\` (hasil R nyata). Soroti jika ada flag mikro di \`microAuditFlags\`:
  * \`INVERTED_RR\` (rasio terbalik: jarak SL lebih lebar dari TP / RR < 1:1 — ini risiko bocor besar!)
  * \`EARLY_MANUAL_PROFIT\` (close manual kepagian jauh sebelum TP)
  * \`MANUAL_CUT_LOSS\` (panik cut loss manual sebelum kena SL)
  * \`OVER_RISK\` (risiko trade melebihi batas maxTradeRiskPercent user)
  * \`NO_SL\` (entry tanpa Stop Loss!)
  * \`SL_MODIFIED\` / \`TP_MODIFIED\` (menggeser SL/TP saat posisi berjalan)
  * \`HIGH_FEE_DRAG\` (komisi + swap menggerus porsi besar profit)
  * \`RULE_VIOLATED\` / \`CHECKLIST_SKIPPED\` (melanggar aturan / melewatkan checklist SOP)
- **Psikologi & Catatan Trade**: baca \`disciplineRating\` (1–5), \`emotionTag\`, \`mistakeTags\`, \`entryReason\`, \`notes\`, \`postTradeEvaluation\`, \`executionNotes\`, dan kesesuaian dengan \`playbooks\` user.
- Saat user meminta analisis trade (harian/periode/keseluruhan), sebutkan temuan mikro konkret (mis. "dari 3 trade kemarin, 1 kena TP penuh, 1 kamu close manual kepagian padahal baru 45% jalan ke TP, dan 1 lagi RR-nya terbalik 1:0.6 karena SL lebih lebar dari TP").

PEMISAHAN TEGAS 3 MODUL INTELIJEN PASAR (JANGAN PERNAH DICAMPURADUKKAN!):
Kamu WAJIB membedakan dengan jelas karakter & sumber data dari 3 modul pasar di TradeVault:
1. **Berita Trading (\`macroNews\`)** — Fokus **katalis jangka pendek / intraday / kalender rilis**. Membaca pola **1-Arah (ONE_WAY_IMPULSE)** vs **2-Arah Sweep First (TWO_WAY_SWEEP_FIRST: Fase 0–5 menit rawan sapuan tipuan, arah bersih terlihat menit 15+)**, \`primaryEvent\`, \`dominantBias\` (BUY/SELL/MIXED), \`whipsawWarning\`, \`intermarketPulse\` (DXY, US02Y, US10Y, USOIL).
   * Anti salah baca: "Bearish Spike awal" = XAU/USD berpotensi TURUN tajam dulu, BUKAN sinyal BUY langsung!
2. **Fundamental Emas (\`fundamentalGold\`)** — Fokus **rezim makro multi-horizon (1D / 1W / 1M)**. Membaca struktur makro: Real Yield, US10Y, DXY, FedWatch (\`cmeFedWatch\`), CFTC COT, arus ETF/GLD, geopolitik/Polymarket (\`polymarket\`), dan Intraday Tactical Overlay.
   * WAJIB gunakan istilah **BULLISH / BEARISH / NEUTRAL** saat membahas Fundamental Emas (bedakan dari sinyal intraday Berita Trading!).
3. **Siklus & Confluence (\`cycleConfluence\`)** — Fokus **timing waktu, siklus, musiman & struktur teknikal**. Membaca:
   * Sesi trading WIB aktif (\`activeSessionWib\`: Asia / London / New York / Overlap)
   * Siklus Astronacci (\`astronacciCycle\`: fase bulan/lunar, Solar Cardinal, Fibonacci Time Cluster, astroScore)
   * Seasonality bulanan historis XAU/USD (\`monthlySeasonalityXauUsd\`: win rate & rata-rata return historis bulan berjalan + overextension)
   * Mode Confluence aktif (\`activeTradingMode\`: Swing / Scalp), AMD Phase, dan Sinyal SMC (\`smcSignal\` / \`latestSmcSignal\`).
- Saat menjawab pertanyaan arah pasar, jelaskan hubungan ketiganya secara jernih (misalnya: Fundamental 1W masih Bullish, Siklus masuk sesi London + seasonality positif, sementara Berita Trading hari ini ada rilis CPI high-impact rawan sweep 2 arah).

PENGUASAAN LENGKAP STRUKTUR & CARA PAKAI APLIKASI TRADEVAULT (VLO JOURNAL):
Kamu menguasai seluruh peta navigasi Sidebar & cara penggunaan tiap fitur di aplikasi ini:
- **Grup Jurnal**:
  1) **Dasbor** (\`Dasbor\`): Ringkasan ekuitas, kurva pertumbuhan, KPI utama (Win Rate, Profit Factor, Expectancy, Max DD), statistik harian, dan ringkasan posisi aktif.
  2) **Jurnal Trade** (\`Jurnal Trade\`): Tempat mencatat & mengelola semua trade (Open / Planned / Closed).
     * **Cara input trade**: Klik tombol **+ Catat Trade / Tambah Trade** -> bisa isi manual (pair, BUY/SELL, entry, SL, TP, lot, komisi, swap, emosi, alasan entry, checklist SOP, strategi/Playbook) ATAU pakai **Scan Kilat AI / Offline OCR Screenshot MT5** (upload screenshot riwayat/order MT5 -> otomatis mengekstrak pair, arah, entry, SL, TP, lot, dan profit!).
     * Klik trade untuk melihat detail forensik, edit SL/TP/close type, konteks macro news saat trade, atau ekspor **Laporan PDF / Shareable PNG Card**.
  3) **Analitik** (\`Analitik\`): Bedah mendalam Win Rate, Profit Factor, Expectancy, R-Multiple, **Radar 5-Dimensi**, performa per Sesi/Strategi/Pair, **Cost of Mistakes** (berapa uang bocor gara-gara emosi/kesalahan), **Playbook Setup A+**, dan **Review Mingguan/Bulanan**.
  4) **Manajemen Risiko** (\`Manajemen Risiko\`): Berisi **Kalkulator Risiko & Lot** (standar XAU/USD di app: 1 pip = 0.10, mis. 4000 -> 3995 = 50 pips; mendukung USD <-> IDR), **Guardrail Risiko** (batas rugi harian, max loss beruntun, max drawdown), **Kalkulator Compounding / Growth Plan** (Mode Compounding \`Modal × (1 + r)^n\` vs Mode Profit Tetap/Ditarik), dan **Simulasi Trade & Monte Carlo** (1.000–10.000 acakan urutan trade -> lihat Median P50, Best P95, Worst P5, Probabilitas Profit, & Rata-rata Max DD).
- **Grup Market Insight**:
  5) **Tanya AI** (\`Tanya AI\`): Ruang obrolan denganmu (bisa ganti persona Santai/Ringkas/Mentor, ganti nama panggilan, kelola Memori Jangka Panjang di menu Tema, dan tombol **Akhiri Sesi** untuk merangkum & menyimpan pelajaran penting ke memori).
  6) **Chart Pasar** (\`Chart Pasar\`): Dua mode chart — **TradingView** dan **Vela Replay** (dilengkapi Bar Replay untuk backtest, penanda Sesi Kustom WIB, dan Auto-Fullscreen).
  7) **Berita Trading** (\`Berita Trading\`): Kalender ekonomi, rilis aktual real-time, Dual-Horizon 1-Arah vs 2-Arah Sweep First, dan intermarket pulse.
  8) **Fundamental Emas** (\`Fundamental Emas\`): Peta makro XAU/USD 1D/1W/1M (Real Yield, US10Y, DXY, FedWatch, CFTC COT, Polymarket, Tactical Overlay).
  9) **Siklus & Confluence** (\`Siklus & Confluence\`): Sesi WIB aktif, Siklus Astronacci (Lunar/Solar/Fib Time), Seasonality bulanan XAU/USD, AMD Phase, dan confluence Swing/Scalp.
  10) **Sinyal SMC** (\`Sinyal SMC\`): Smart Money Concept heatmap, struktur, POI, dan zona likuiditas XAU/USD.
- **Pengaturan** (\`Pengaturan\`): Multi-Akun / Sub-Portofolio, Mata Uang USD <-> IDR, Standar Broker & Pip, Suara Notifikasi/Tactile Click, Mode Offline, Backup & Restore JSON, Tema Light/Dark, serta Diagnostik Sistem APK.
- **Pintasan Cepat**: Mendukung **Cmd/Ctrl + K** (Quick Command) untuk lompat cepat antar menu.
- **ATURAN MENGAJAR ADAPTIF**: Jika user tanya cara pakai fitur atau konsep (Monte Carlo, Compounding, Expectancy, dll.), jelaskan langkahnya urut & jelas. Jika user bilang "kurang paham", "bingung", atau "jelasin lebih simpel", segera pakai analogi dunia nyata yang super sederhana (lempar koin, dagang warung, celengan harian) tanpa istilah statistik rumit!

ATURAN MEMORI:
- Isi "newMemories" (0–2 item singkat) HANYA jika ada fakta baru yang benar-benar penting diingat untuk hari-hari mendatang (nama panggilan baru, kebiasaan jurnal penting, level XAU patokan, atau preferensi user).

Keluarkan HANYA JSON valid:
{
  "intent": "SMALL_TALK" | "OUT_OF_SCOPE" | "LIVE_PRICE_CHECK" | "DIRECT_FOLLOWUP" | "FULL_OFFICE",
  "reply": "Balasan percakapan natural, cerdas & manusiawi dalam ${isEn ? 'English' : 'Bahasa Indonesia'}",
  "renamedTo": null | "NamaPanggilanBersih",
  "directionClarity": "BUY" | "SELL" | "WAIT_MIXED" | "INFO_ONLY",
  "newMemories": [{"text": "1 kalimat fakta penting", "category": "preference" | "market" | "journal" | "general"}]
}`;

  const userPrompt = `Bahasa: ${isEn ? 'English' : 'Bahasa Indonesia'}
Nama asisten saat ini: "${validated.agentName}"

MEMORI JANGKA PANJANG:
${memoryText}

RIWAYAT OBROLAN TERAKHIR:
${formatHistoryBlock(validated.history)}

DATA PERANGKAT (baca sesuai konteks pertanyaan user — jangan memaksakan bahas news jika user hanya bahas jurnal!):
${JSON.stringify(compactContext).slice(0, 18_000)}

PESAN TERBARU USER:
"${validated.message}"

Keluarkan HANYA JSON valid.`;

  // Always prioritize Gemini Flash-Lite first (1.2s–4.5s, zero thinking stalls, zero Groq 404 waste),
  // with Gemini Hydrogen, Groq, and OpenRouter as automatic fast fallbacks.
  const order: Array<'gemini' | 'groq' | 'openrouter'> = ['gemini', 'groq', 'openrouter'];

  try {
    const res = await runWithProviderCascade({
      order,
      keys,
      preferDeepGemini: false,
      systemInstruction,
      userPrompt,
      expectJson: true,
      timeoutMs: 11_500,
      temperature: speedHint.likelyHeavyMarket || speedHint.likelyLivePrice || speedHint.likelyJournalOrApp ? 0.25 : 0.65,
      deadlineMs,
    });

    const parsed = res.json || {};
    const rawIntent = String(parsed.intent || 'FULL_OFFICE').toUpperCase();
    const routeType: AgentDeskRouteType =
      rawIntent === 'SMALL_TALK' ||
      rawIntent === 'OUT_OF_SCOPE' ||
      rawIntent === 'LIVE_PRICE_CHECK' ||
      rawIntent === 'DIRECT_FOLLOWUP'
        ? rawIntent
        : 'FULL_OFFICE';

    const answer = String(parsed.reply || res.text || '').trim();
    const llmRename = cleanExtractedAgentName(parsed.renamedTo);
    const regexRename = extractNicknameRenameFallback(validated.message);
    const detectedAgentName = llmRename || regexRename;

    const rawMems = Array.isArray(parsed.newMemories) ? parsed.newMemories : [];
    const newMemoryNotes: AgentExtractedMemoryFact[] = rawMems
      .slice(0, 3)
      .filter((m: any) => m && typeof m.text === 'string' && m.text.trim().length > 4)
      .map((m: any) => ({
        text: String(m.text).trim().slice(0, 220),
        category:
          m.category === 'preference' || m.category === 'market' || m.category === 'journal'
            ? m.category
            : 'general',
      }));

    if (
      detectedAgentName &&
      !newMemoryNotes.some((m) => m.category === 'preference' && m.text.toLowerCase().includes(detectedAgentName.toLowerCase()))
    ) {
      newMemoryNotes.unshift({
        text: `User memanggil asisten dengan nama "${detectedAgentName}".`,
        category: 'preference',
      });
    }

    const traceSummary =
      res.skippedErrors && res.skippedErrors.length > 0
        ? `${routeType} via ${formatProviderDisplayName(res.provider)} (${res.model}) · skip: ${res.skippedErrors
            .join('; ')
            .slice(0, 120)}`
        : `${routeType} via ${formatProviderDisplayName(res.provider)} (${res.model})`;

    return {
      status: 200,
      payload: {
        success: true,
        routeType,
        answer,
        actionCard: normalizeActionCard(
          {
            directionClarity: parsed.directionClarity || 'INFO_ONLY',
            directionLabel: detectedAgentName || validated.agentName,
          },
          validated.language
        ),
        workflowTrace: [
          {
            stepNumber: 1,
            role: 'BOSS_DIRECT',
            divisionName: `${detectedAgentName || validated.agentName} (Single-Pass)`,
            provider: res.provider,
            model: res.model,
            action:
              routeType === 'SMALL_TALK'
                ? isEn
                  ? 'Personal Assistant Chat'
                  : 'Mode Asisten (Santai)'
                : routeType === 'OUT_OF_SCOPE'
                ? isEn
                  ? 'Scope Guard'
                  : 'Penjaga Batas Ranah'
                : routeType === 'LIVE_PRICE_CHECK'
                ? isEn
                  ? 'Live XAU/USD Lookup'
                  : 'Cek Harga Live'
                : isEn
                ? 'Smart Unified Desk Brain'
                : 'Otak Terpadu (Hemat Kuota)',
            status: res.skippedErrors && res.skippedErrors.length > 0 ? 'fallback' : 'completed',
            summary: traceSummary,
            latencyMs: res.latencyMs,
          },
        ],
        revisionTriggered: false,
        activeProviders: [formatProviderDisplayName(res.provider)],
        detectedAgentName,
        newMemoryNotes: newMemoryNotes.slice(0, 3),
        totalLatencyMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    return {
      status: 502,
      payload: {
        success: false,
        answer: '',
        actionCard: normalizeActionCard(null, validated.language),
        workflowTrace: [],
        revisionTriggered: false,
        activeProviders: [],
        totalLatencyMs: Date.now() - startedAt,
        error: isEn
          ? `Assistant AI temporarily unavailable: ${sanitizeAgentError(err)}`
          : `Asisten AI sementara tidak dapat merespons: ${sanitizeAgentError(err)}`,
      },
    };
  }
}

// ============================================================================
// 2B. END-SESSION MEMORY DISTILLATION ("Akhiri Sesi / New Day")
// ============================================================================

export async function runEndSessionMemoryDistillation(
  rawBody: unknown,
  keys: AgentDeskEnvKeys
): Promise<{
  status: number;
  payload: {
    success: boolean;
    sessionSummary: string;
    memoryFacts: AgentExtractedMemoryFact[];
    providerUsed?: string;
    latencyMs: number;
    error?: string;
  };
}> {
  const startedAt = Date.now();
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const language: 'id' | 'en' = body.language === 'en' ? 'en' : 'id';
  const isEn = language === 'en';
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .slice(-24)
    .filter(
      (h: any) =>
        h &&
        (h.role === 'user' || h.role === 'assistant') &&
        typeof h.content === 'string' &&
        h.content.trim().length > 0
    )
    .map((h: any) => ({ role: h.role as 'user' | 'assistant', content: String(h.content).trim().slice(0, 600) }));

  if (history.length === 0) {
    return {
      status: 200,
      payload: {
        success: true,
        sessionSummary: isEn ? 'Empty session closed.' : 'Sesi kosong ditutup.',
        memoryFacts: [],
        latencyMs: 1,
      },
    };
  }

  const existingMemories = Array.isArray(body.existingMemories)
    ? body.existingMemories
        .slice(0, 20)
        .map((m: any) => (typeof m === 'string' ? m : m?.text || ''))
        .filter(Boolean)
    : [];

  if (keys.geminiKeys.length + keys.groqKeys.length + keys.openRouterKeys.length === 0) {
    return {
      status: 503,
      payload: {
        success: false,
        sessionSummary: '',
        memoryFacts: [],
        latencyMs: Date.now() - startedAt,
        error: isEn ? 'No AI key active on server.' : 'Belum ada API key AI aktif di server.',
      },
    };
  }

  const systemInstruction = `Kamu adalah MANAJER MEMORI ASISTEN PRIBADI TradeVault (seperti sistem ingatan Jarvis / Alfred).
Tugasmu menyaring sesi obrolan yang baru saja berakhir menjadi:
1. "sessionSummary": 1 kalimat padat merangkum sesi hari ini.
2. "memoryFacts": maksimal 3 butir fakta PALING PENTING yang layak diingat untuk sesi-sesi mendatang (mis. nama panggilan baru, kebiasaan/kesalahan trading user yang dibahas, level/arah XAUUSD penting yang sempat jadi patokan, atau preferensi user).
ATURAN:
- Jangan ulangi fakta yang sudah persis ada di memori lama.
- Jangan masukkan basa-basi kosong ("user menyapa halo").
- Keluarkan HANYA JSON valid:
  {"sessionSummary":string,"memoryFacts":[{"text":string,"category":"preference"|"market"|"journal"|"general"}]}`;

  const userPrompt = `Bahasa: ${isEn ? 'English' : 'Bahasa Indonesia'}
Memori lama yang sudah tersimpan:
${existingMemories.length > 0 ? existingMemories.map((x, i) => `${i + 1}. ${x}`).join('\n') : '(kosong)'}

Transkrip Sesi yang Diakhiri:
${history.map((h) => `${h.role === 'user' ? 'USER' : 'ASISTEN'}: ${h.content}`).join('\n')}

Keluarkan HANYA JSON.`;

  try {
    const res = await runWithProviderCascade({
      order: ['gemini', 'groq', 'openrouter'],
      keys,
      preferDeepGemini: false,
      isBoss: false,
      systemInstruction,
      userPrompt,
      expectJson: true,
      timeoutMs: 9000,
    });
    const parsed = res.json || {};
    const facts: AgentExtractedMemoryFact[] = (Array.isArray(parsed.memoryFacts) ? parsed.memoryFacts : [])
      .slice(0, 3)
      .filter((f: any) => f && typeof f.text === 'string' && f.text.trim().length > 4)
      .map((f: any) => ({
        text: String(f.text).trim().slice(0, 220),
        category:
          f.category === 'preference' || f.category === 'market' || f.category === 'journal'
            ? f.category
            : 'general',
      }));

    return {
      status: 200,
      payload: {
        success: true,
        sessionSummary: String(parsed.sessionSummary || (isEn ? 'Session archived.' : 'Sesi diarsipkan.')).slice(
          0,
          280
        ),
        memoryFacts: facts,
        providerUsed: formatProviderDisplayName(res.provider),
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    return {
      status: 502,
      payload: {
        success: false,
        sessionSummary: '',
        memoryFacts: [],
        latencyMs: Date.now() - startedAt,
        error: sanitizeAgentError(err),
      },
    };
  }
}

// ============================================================================
// 3. AI QA / CLEANING SERVICE DIAGNOSTICS ANALYST
// ============================================================================

export async function runAiQaDiagnostics(
  rawBody: unknown,
  keys: AgentDeskEnvKeys
): Promise<{
  status: number;
  payload: {
    success: boolean;
    healthGrade: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    summary: string;
    rootCauses: string[];
    recommendedActions: string[];
    providerUsed?: string;
    modelUsed?: string;
    latencyMs: number;
    error?: string;
  };
}> {
  const startedAt = Date.now();
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const language: 'id' | 'en' = body.language === 'en' ? 'en' : 'id';
  const isEn = language === 'en';

  const probePayload = body.diagnostics && typeof body.diagnostics === 'object' ? body.diagnostics : null;
  if (!probePayload) {
    return {
      status: 400,
      payload: {
        success: false,
        healthGrade: 'WARNING',
        summary: '',
        rootCauses: [],
        recommendedActions: [],
        latencyMs: Date.now() - startedAt,
        error: isEn ? 'Missing diagnostics payload.' : 'Payload diagnostik kosong.',
      },
    };
  }

  const totalKeys = keys.geminiKeys.length + keys.groqKeys.length + keys.openRouterKeys.length;
  if (totalKeys === 0) {
    return {
      status: 503,
      payload: {
        success: false,
        healthGrade: 'WARNING',
        summary: '',
        rootCauses: [],
        recommendedActions: [],
        latencyMs: Date.now() - startedAt,
        error: isEn ? 'No AI key configured on server.' : 'Belum ada API key AI aktif di server.',
      },
    };
  }

  const systemInstruction = `Kamu adalah DIVISI QA / CLEANING SERVICE ENGINEER untuk aplikasi trading TradeVault (Web & Android APK Capacitor).
Analisis laporan JSON diagnostik sistem + error log perangkat secara objektif, lugas, dan akurat.
ATURAN:
1. Jangan pernah mengarang masalah yang tidak ada di JSON. Jika semua hijau (HTTP 200, cachePurgeMatchesBuild=true, OCR OK, feeds OK, errorLogs kosong), nyatakan HEALTHY dengan tegas.
2. Jika ada masalah (mis. cache mismatch, API key OFF, HTTP 404/429, OCR asset gagal, sync drift, atau error log berulang), sebutkan AKAR MASALAH paling spesifik dan langkah perbaikan konkret.
3. Keluarkan HANYA JSON valid:
   {"healthGrade":"HEALTHY"|"WARNING"|"CRITICAL","summary":string,"rootCauses":string[],"recommendedActions":string[]}`;

  const userPrompt = `Bahasa output: ${isEn ? 'English' : 'Bahasa Indonesia'}\nData Diagnostik Sistem & Log Error:\n${JSON.stringify(
    probePayload
  ).slice(0, 15_000)}\n\nKeluarkan HANYA JSON hasil audit QA.`;

  try {
    const res = await runWithProviderCascade({
      order: ['gemini', 'groq', 'openrouter'],
      keys,
      preferDeepGemini: false,
      isBoss: false,
      systemInstruction,
      userPrompt,
      expectJson: true,
      timeoutMs: 11_000,
    });
    const parsed = res.json || {};
    const gradeRaw = String(parsed.healthGrade || 'WARNING').toUpperCase();
    const healthGrade: 'HEALTHY' | 'WARNING' | 'CRITICAL' =
      gradeRaw === 'HEALTHY' || gradeRaw === 'CRITICAL' ? gradeRaw : 'WARNING';

    return {
      status: 200,
      payload: {
        success: true,
        healthGrade,
        summary: String(parsed.summary || '').slice(0, 600),
        rootCauses: Array.isArray(parsed.rootCauses)
          ? parsed.rootCauses.slice(0, 6).map((x: any) => String(x).slice(0, 220))
          : [],
        recommendedActions: Array.isArray(parsed.recommendedActions)
          ? parsed.recommendedActions.slice(0, 6).map((x: any) => String(x).slice(0, 220))
          : [],
        providerUsed: formatProviderDisplayName(res.provider),
        modelUsed: res.model,
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    return {
      status: 502,
      payload: {
        success: false,
        healthGrade: 'WARNING',
        summary: '',
        rootCauses: [],
        recommendedActions: [],
        latencyMs: Date.now() - startedAt,
        error: sanitizeAgentError(err),
      },
    };
  }
}
