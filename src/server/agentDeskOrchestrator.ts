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
                maxOutputTokens: 1024,
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
          max_tokens: 950,
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
  likelyMarketNews: boolean;
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
    /\b(kenapa|mengapa|analisis|analisa|fundamental|berita|news|jurnal|journal|spike|sweep|prediksi|arah|kemana|ke mana|buy|sell|entry|posisi|risiko|risk|drawdown|win\s?rate|fomc|cpi|nfp|evaluasi|audit|bagusnya|ambil|grow|growth|selisih|compound|monte\s?carlo|simulasi)\b/i.test(
      q
    );
  const asksLivePrice = hasPriceCue && hasAssetCue && !asksDeepAnalysis;
  const asksJournalOrApp =
    /\b(jurnal|journal|trade|trading|posisi|open|planned|lot|risiko|risk|drawdown|dd|win\s?rate|profit|loss|rugi|equity|saldo|balance|guardrail|evaluasi|audit|rekap|grow|growth|pertumbuhan|selisih|kemarin|kemaren|persen|persentase|modal|compound|compounding|monte\s?carlo|simulasi|simulation|expectancy|profit\s?factor|r[\s-]?multiple|kalkulator|calculator|playbook|radar|ocr|scan|vela|replay|strategi|strategy|streak|komisi|commission|swap|pip|pips|kurang\s+paham|belum\s+paham|gak\s+paham|ga\s+paham|bingung|jelasin|jelaskan|maksud|maksudnya|simpel|sederhana)\b/i.test(
      q
    );
  const asksMarket =
    /\b(xau|xauusd|gold|emas|dxy|yield|us10y|us02y|usoil|oil|forex|market|pasar|chart|candle|news|berita|makro|macro|fundamental|fomc|fed|fedwatch|cpi|ppi|nfp|pmi|powell|polymarket|cycle|confluence|smc|heatmap|spike|sweep|whipsaw|buy|sell|long|short|entry|sl|tp)\b/i.test(
      q
    );
  return {
    likelyHeavyMarket: (asksMarket || asksJournalOrApp) && !asksLivePrice,
    likelyMarketNews: asksMarket,
    likelyLivePrice: asksLivePrice,
    likelyJournalOrApp: asksJournalOrApp,
  };
}

function buildCompactDeviceContext(contextObj: Record<string, any>): Record<string, unknown> {
  // Put journal & liveMarketQuote FIRST so heavy macroNews/fundamentalGold text can NEVER truncate journal growthComparison!
  return {
    runtime: contextObj?.runtime ?? null,
    liveMarketQuote: contextObj?.liveMarketQuote ?? null,
    journal: contextObj?.journal ?? null,
    macroNews: contextObj?.macroNews
      ? {
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
    fundamentalGold: contextObj?.fundamentalGold
      ? {
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

  // Smart context slimming: send only what's relevant so TTFT stays ultra-fast (1.2s–3s)
  const needsMarketData = speedHint.likelyMarketNews || speedHint.likelyLivePrice;
  const needsJournalData = speedHint.likelyJournalOrApp || validated.history.length >= 2;
  const compactContext = needsMarketData
    ? buildCompactDeviceContext(validated.contextObj)
    : needsJournalData
    ? {
        runtime: validated.contextObj?.runtime ?? null,
        journal: validated.contextObj?.journal ?? null,
      }
    : {
        runtime: validated.contextObj?.runtime ?? null,
        liveMarketQuote: validated.contextObj?.liveMarketQuote?.xauusd
          ? { xauusd: validated.contextObj.liveMarketQuote.xauusd }
          : null,
      };

  const systemInstruction = `${personaGuide}

TUGAS UTAMA (OTAK TUNGGAL CERDAS TRADEVAULT / VLO JOURNAL):
Pahami MAKSUD & KONTEKS pesan user secara menyeluruh dari riwayat obrolan, lalu pilih SATU jalur paling tepat di field "intent":
1. "SMALL_TALK" — Sapaan, perkenalan, obrolan santai, curhat ringan, terima kasih, atau user memberi nama panggilan baru (mis. "saya panggil kamu Wowo yaa").
   - ATURAN KERAS: DILARANG membocorkan/membahas arah market, bias BUY/SELL, harga XAU, berita, atau data jurnal jika user tidak menanyakannya!
   - Jika user memberi nama panggilan baru, isi "renamedTo" HANYA dengan NAMA BERSIHNYA saja tanpa kata penyambung/partikel (contoh: "saya panggil kamu Wowo yaa" -> renamedTo: "Wowo", BUKAN "Wowo yaa").
2. "OUT_OF_SCOPE" — Pertanyaan topik umum di luar trading, matematika keuangan/trading, & fitur TradeVault (cuaca, bola, resep makanan, gosip, film, obat, dll).
   - Tolak dengan santai, sopan, dan tetap hangat sesuai karaktermu; jelaskan ranah tugasmu khusus di market XAU/USD, berita makro, fundamental emas, jurnal trading, dan semua fitur di dalam TradeVault / Vlo Journal.
3. "LIVE_PRICE_CHECK" — User menanyakan harga spot terkini (mis. harga XAU/USD sekarang berapa).
   - Gunakan HANYA angka nyata dari "DATA PERANGKAT -> liveMarketQuote". Sebutkan angka + sumber + jam update dengan natural. DILARANG mengarang harga jika data kosong/offline.
4. "DIRECT_FOLLOWUP" — Tanggapan lanjutan singkat dalam obrolan trading/jurnal/edukasi yang sedang berlangsung (TERMASUK jika user bilang "kurang paham", "bingung", "jelasin lebih simpel").
5. "FULL_OFFICE" — Analisis arah market XAU/USD, Trade News, Spike/Sweep, Fundamental Gold, Polymarket, FedWatch, evaluasi jurnal lengkap, hitungan selisih growth harian/kemarin, hitungan compounding/lot/risiko, atau penjelasan fitur & istilah di dalam aplikasi TradeVault.

ATURAN PRESISI JURNAL & SELISIH GROWTH (WAJIB IKUTI!):
- Baca data nyata di "DATA PERANGKAT -> journal":
  * "journal.growthComparison.beforeTodayCumulativeGainPct" = Total akumulasi growth (%) SAMPAI KEMARIN (sebelum trade hari ini).
  * "journal.growthComparison.currentTotalGainPct" = Total akumulasi growth (%) SEKARANG (sudah termasuk trade hari ini).
  * "journal.growthComparison.todayCumulativeGainDeltaPct" = SELISIH total persen growth yang disumbang trade hari ini (currentTotalGainPct - beforeTodayCumulativeGainPct).
  * "journal.growthComparison.todayCompoundedReturnPct" = Return harian hari ini dibandingkan ekuitas penutupan kemarin (todayNetProfit / beforeTodayEquity × 100).
  * "journal.last14TradingDays" = Riwayat harian lengkap (date, trades, wins, losses, netProfit, dayGainDeltaPct, dayCompoundedReturnPct, endEquity, cumulativeGainPct).
  * "journal.strategyBreakdown", "journal.sessionBreakdown", "journal.topMistakes", "journal.summary" (winRatePct, profitFactor, expectancy, averageWin, averageLoss, maxDrawdownPercent, totalCommission, totalSwap, maxConsecutiveWins, maxConsecutiveLosses), "journal.riskGuardrails".
- JIKA user menanyakan SELISIH / PERBEDAAN / PERUBAHAN total grow kemarin dengan trade hari ini:
  * JANGAN hanya menjawab total grow sekarang!
  * Sebutkan dengan tegas: Total Grow sampai kemarin (beforeTodayCumulativeGainPct%), Total Grow sekarang (currentTotalGainPct%), lalu **SELISIHNYA (todayCumulativeGainDeltaPct%)** beserta jumlah trade & net profit hari ini, plus info return hariannya terhadap ekuitas kemarin (todayCompoundedReturnPct%) agar tidak ambigu.
  * DILARANG mengarang angka atau menulis "(misal)". Jika hari ini belum ada trade close (todayClosedTradesCount === 0), sampaikan jujur bahwa belum ada trade close hari ini sehingga selisihnya 0%.

PENGETAHUAN LENGKAP FITUR & MEKANISME APLIKASI TRADEVAULT (VLO JOURNAL):
Kamu WAJIB paham dan bisa menjelaskan + menghitung semua fitur di aplikasi ini:
- **Jurnal & Analitik**: Mencatat trade (Open/Planned/Closed), otomatis hitung Net PnL (gross - komisi - swap), Total Growth %, Win Rate, Profit Factor (Gross Profit / Gross Loss), Expectancy (rata-rata ekspektasi $ per trade), R-Multiple, Max Drawdown %, Radar 5-Dimensi, Cost of Mistakes, dan Guardrail Risiko (batas rugi harian, batas loss beruntun, batas drawdown).
- **Kalkulator Compounding (Growth Plan)**: Ada 2 mode:
  1) Mode **Compounding (Gulung Modal)**: profit dibiarkan di akun sehingga target % berikutnya dihitung dari saldo yang terus membesar. Rumus: Saldo Akhir = Modal Awal × (1 + r)^n (mendukung setoran rutin awal/akhir periode).
  2) Mode **Profit Tetap / Ditarik (Fixed Withdrawn)**: profit setiap periode ditarik keluar sehingga profit tiap periode tetap sebesar Modal Awal × r.
  Jika user bertanya hitungan compounding (misal modal sekian, target X% per hari/minggu/bulan selama N periode), HITUNG DENGAN AKURAT (tampilkan saldo akhir, total profit, dan persentase kenaikannya).
- **Simulasi Trade & Monte Carlo** (di tab Risiko & Simulasi): Mengacak urutan menang-kalah sebanyak 1.000 / 5.000 / 10.000 kali percobaan menggunakan Win Rate, RR, Risiko %, dan jumlah trade untuk melihat seberapa tahan akun menghadapi urutan kalah beruntun (losing streak). Output utamanya: **Median (P50)** hasil tengah paling realistis, **P95** skenario terbaik/hoki, **P5** skenario terburuk/apes, **Probabilitas Profit**, dan **Rata-rata Max Drawdown**.
- **Kalkulator Risiko & Lot**: Standar XAU/USD di aplikasi ini memakai 1 pip = 0.10 (misal 4000 → 3995 = 50 pips), mendukung konversi USD ↔ IDR, menghitung ukuran lot aman dari % risiko atau nominal SL.
- **Fitur Pasar & Eksekusi**: Trade News Dual-Horizon (1-Arah vs 2-Arah Sweep First menit 0–5 vs 15+), Fundamental Gold (1D/1W/1M + DXY, US10Y, Real Yield, FedWatch, CFTC COT, Polymarket), Cycle & Confluence, SMC Smart Heatmap, Vela Replay Chart, Playbook Setup A+, dan Scan Kilat AI / Offline OCR screenshot MT5.

ATURAN MENGAJAR ADAPTIF (ANTI-BINGUNG):
- Saat menjelaskan konsep/fitur (Monte Carlo, Compounding, Expectancy, Profit Factor, Drawdown, dll.), pakai bahasa Indonesia yang santai, jelas, dan mudah dicerna — beri contoh angka kecil bila perlu.
- JIKA user berkata "kurang paham", "belum paham", "bingung", "ribet", atau "jelasin lebih simpel", SEGERA ubah pendekatan ke analogi dunia nyata yang super sederhana (misalnya lempar koin, dagang warung, atau celengan harian) dengan kalimat pendek tanpa istilah statistik yang rumit!

ATURAN ANTI-SALAH BACA PASAR:
- "Bearish Spike awal" = harga XAU/USD berpotensi TURUN tajam dulu, BUKAN sinyal BUY langsung!
- "Bullish Spike awal" = harga XAU/USD berpotensi NAIK tajam dulu, jangan dikejar buta jika bias utama SELL!
- "TWO_WAY_SWEEP_FIRST" = rawan sapuan 2 arah di menit 0–5, tunggu konfirmasi struktur di menit 15+.
- Jelaskan mengalir seperti partner trading di chat WA (bukan laporan template bernomor kaku).

ATURAN MEMORI:
- Isi "newMemories" (0–2 item singkat) HANYA jika ada fakta baru yang benar-benar penting diingat untuk hari-hari mendatang (mis. nama panggilan baru, preferensi user, level XAU penting, atau pola jurnal penting). Jangan simpan basa-basi kosong.

Keluarkan HANYA JSON valid:
{
  "intent": "SMALL_TALK" | "OUT_OF_SCOPE" | "LIVE_PRICE_CHECK" | "DIRECT_FOLLOWUP" | "FULL_OFFICE",
  "reply": "Balasan percakapan natural & manusiawi dalam ${isEn ? 'English' : 'Bahasa Indonesia'}",
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

DATA PERANGKAT (hanya baca jika user memang bertanya soal harga/market/jurnal):
${JSON.stringify(compactContext).slice(0, 15_500)}

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
      temperature: speedHint.likelyHeavyMarket || speedHint.likelyLivePrice || speedHint.likelyJournalOrApp ? 0.3 : 0.65,
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
