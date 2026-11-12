import { createClient, SupabaseClient } from '@supabase/supabase-js';

const CONFIG_STORAGE_KEY = 'tradevault_supabase_config';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = '';

/**
 * Sanitizes Supabase Project URL to ensure it is strictly the root origin (e.g. https://xxx.supabase.co).
 * Strips any accidentally appended paths such as /auth/v1, /rest/v1, or trailing slashes,
 * allowing the official Supabase SDK to build auth endpoints properly.
 */
export function sanitizeSupabaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let clean = rawUrl.trim().replace(/^['"]+|['"]+$/g, '');

  try {
    const hasScheme = clean.startsWith('http://') || clean.startsWith('https://');
    const parsed = new URL(hasScheme ? clean : `https://${clean}`);
    // parsed.origin guarantees protocol + host (e.g. "https://xxxx.supabase.co")
    // and strips any path like /auth/v1, trailing slashes, query params, etc.
    return parsed.origin;
  } catch {
    return clean
      .replace(/\/auth\/v1\/?$/i, '')
      .replace(/\/rest\/v1\/?$/i, '')
      .replace(/\/v1\/?$/i, '')
      .replace(/\/+$/, '');
  }
}

export function getSupabaseConfig(): SupabaseConfig {
  let envUrl = '';
  let envKey = '';

  // 1. Read environment variables first
  try {
    if (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) {
      envUrl = ((import.meta as any).env.VITE_SUPABASE_URL || '').trim();
      envKey = ((import.meta as any).env.VITE_SUPABASE_ANON_KEY || '').trim();
    }
  } catch {
    // ignore import.meta access error
  }

  if (!envUrl && typeof process !== 'undefined' && process?.env) {
    envUrl = (process.env.VITE_SUPABASE_URL || '').trim();
    envKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  }

  // 2. Read in-app localStorage config (allows user overrides or manual setups)
  let storedUrl = '';
  let storedKey = '';

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.url && parsed?.anonKey) {
          storedUrl = parsed.url.trim();
          storedKey = parsed.anonKey.trim();

          // Auto-clean stored URL if it had /auth/v1 or trailing slashes
          const cleanedStoredUrl = sanitizeSupabaseUrl(storedUrl);
          if (cleanedStoredUrl !== storedUrl) {
            localStorage.setItem(
              CONFIG_STORAGE_KEY,
              JSON.stringify({ url: cleanedStoredUrl, anonKey: storedKey })
            );
            storedUrl = cleanedStoredUrl;
          }
        }
      }
    } catch {
      // ignore localStorage read issues
    }
  }

  // Priority: If environment variables are provided and valid, prioritize them.
  // Otherwise use stored localStorage configuration.
  const finalUrl = sanitizeSupabaseUrl(envUrl || storedUrl);
  const finalKey = (envKey || storedKey).trim();

  return {
    url: finalUrl,
    anonKey: finalKey,
  };
}

export function saveSupabaseConfig(url: string, anonKey: string): void {
  const cleanUrl = sanitizeSupabaseUrl(url);
  const cleanKey = anonKey.trim();
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({ url: cleanUrl, anonKey: cleanKey })
    );
  }
  cachedClient = null;
  cachedConfigKey = '';
}

export function clearSupabaseConfig(): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
  }
  cachedClient = null;
  cachedConfigKey = '';
}

export function isSupabaseConfigured(): boolean {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) return false;
  const cleanUrl = sanitizeSupabaseUrl(config.url);
  try {
    const parsed = new URL(cleanUrl);
    const isValidProtocol = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    return isValidProtocol && config.anonKey.trim().length > 15;
  } catch {
    return false;
  }
}

export function getSupabase(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    return null;
  }

  const cleanUrl = sanitizeSupabaseUrl(config.url);
  const cleanKey = config.anonKey.trim();

  const keyString = `${cleanUrl}_${cleanKey}`;
  if (cachedClient && cachedConfigKey === keyString) {
    return cachedClient;
  }

  try {
    // Official Supabase JS client will automatically append /auth/v1 internally
    // Never pass /auth/v1 in cleanUrl!
    cachedClient = createClient(cleanUrl, cleanKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    cachedConfigKey = keyString;
    return cachedClient;
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    return null;
  }
}

/**
 * Translates Supabase Auth errors into user-friendly Indonesian messages
 */
export function translateAuthError(error: any): string {
  if (!error) return 'Terjadi kesalahan sistem yang tidak diketahui.';

  const message: string = (error.message || error.error_description || String(error)).toLowerCase();
  const status: number = error.status || 0;

  if (message.includes('invalid path') || message.includes('path is invalid') || message.includes('requested path is invalid')) {
    return 'Jalur endpoint autentikasi Supabase tidak valid. Pastikan Project URL hanya berupa domain dasar (tanpa /auth/v1 atau path tambahan).';
  }

  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return 'Email atau kata sandi tidak cocok. Silakan periksa kembali.';
  }

  if (message.includes('email not confirmed')) {
    return 'Email belum dikonfirmasi. Silakan buka kotak masuk atau folder spam email Anda dan klik tautan verifikasi.';
  }

  if (message.includes('user already registered') || message.includes('already registered')) {
    return 'Alamat email ini sudah terdaftar. Silakan beralih ke tab Masuk (Login) atau gunakan opsi lupa sandi.';
  }

  if (message.includes('password should be at least 6 characters') || message.includes('password is too short')) {
    return 'Kata sandi minimal harus 6 karakter demi keamanan akun Anda.';
  }

  if (message.includes('rate limit') || message.includes('over_email_send_rate_limit')) {
    return 'Terlalu banyak permintaan dalam waktu singkat. Demi keamanan, harap tunggu 2-3 menit sebelum mencoba lagi.';
  }

  if (message.includes('invalid email') || message.includes('unable to validate email address')) {
    return 'Format alamat email tidak valid. Masukkan format yang benar, contoh: nama@email.com.';
  }

  if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network request failed')) {
    return 'Gagal terhubung ke server Supabase. Periksa koneksi internet Anda atau pastikan URL project dapat diakses.';
  }

  if (message.includes('signup requires a valid password')) {
    return 'Pendaftaran memerlukan kata sandi yang valid.';
  }

  if (message.includes('user not found')) {
    return 'Akun dengan email tersebut tidak ditemukan.';
  }

  if (message.includes('token has expired') || message.includes('otp expired')) {
    return 'Tautan atau kode verifikasi telah kedaluwarsa. Silakan minta tautan verifikasi baru.';
  }

  if (status === 400) {
    return `Permintaan autentikasi tidak valid: ${error.message || 'Periksa input data Anda.'}`;
  }

  if (status === 429) {
    return 'Batas permintaan terlampaui. Silakan tunggu beberapa saat lagi.';
  }

  return error.message || 'Terjadi kesalahan saat memproses autentikasi. Silakan coba lagi.';
}

/**
 * Gets the current active session
 */
export async function getCurrentSession() {
  const client = getSupabase();
  if (!client) return { session: null, error: null };
  try {
    const { data, error } = await client.auth.getSession();
    return { session: data.session, error };
  } catch (err) {
    return { session: null, error: err };
  }
}

/**
 * Gets the current active user
 */
export async function getCurrentUser() {
  const client = getSupabase();
  if (!client) return { user: null, error: null };
  try {
    const { data, error } = await client.auth.getUser();
    return { user: data.user, error };
  } catch (err) {
    return { user: null, error: err };
  }
}

/**
 * Signs out the current user safely
 */
export async function signOutUser(): Promise<{ success: boolean; error: any }> {
  const client = getSupabase();
  if (!client) return { success: true, error: null };
  try {
    const { error } = await client.auth.signOut();
    return { success: !error, error };
  } catch (err) {
    return { success: false, error: err };
  }
}

/**
 * Resends email verification confirmation link
 */
export async function resendVerificationEmail(email: string): Promise<{ success: boolean; message: string }> {
  const client = getSupabase();
  if (!client) {
    return { success: false, message: 'Supabase client belum terkonfigurasi.' };
  }

  try {
    const { error } = await client.auth.resend({
      type: 'signup',
      email: email.trim(),
    });

    if (error) {
      return { success: false, message: translateAuthError(error) };
    }

    return {
      success: true,
      message: `Tautan verifikasi baru telah dikirimkan ke ${email}. Silakan periksa kotak masuk dan folder spam Anda.`,
    };
  } catch (err: any) {
    return { success: false, message: translateAuthError(err) };
  }
}

/**
 * Tests connection to Supabase project
 */
export async function testSupabaseConnection(): Promise<{
  success: boolean;
  message: string;
  hasTables?: boolean;
}> {
  const client = getSupabase();
  if (!client) {
    return {
      success: false,
      message: 'Konfigurasi URL atau Anon Key Supabase belum diisi atau tidak valid.',
    };
  }

  try {
    // Test auth service reachability
    const { data: sessionData, error: sessionErr } = await client.auth.getSession();
    if (sessionErr) {
      return {
        success: false,
        message: `Gagal menghubungi Supabase Auth: ${translateAuthError(sessionErr)}`,
      };
    }

    // Test trades table existence
    const { error: tableErr } = await client
      .from('trades')
      .select('id')
      .limit(1);

    if (tableErr) {
      // Check if table does not exist
      if (tableErr.code === '42P01') {
        return {
          success: true,
          hasTables: false,
          message: 'Terkoneksi ke Supabase, namun tabel "trades" belum dibuat. Silakan jalankan skrip SQL di Supabase SQL Editor.',
        };
      }
      return {
        success: true,
        hasTables: true,
        message: `Terkoneksi ke Supabase! (Catatan: ${tableErr.message})`,
      };
    }

    return {
      success: true,
      hasTables: true,
      message: 'Koneksi ke Supabase & tabel database berhasil diverifikasi!',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Koneksi gagal: ${translateAuthError(err)}`,
    };
  }
}
