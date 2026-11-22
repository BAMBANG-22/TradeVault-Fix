import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const CONFIG_STORAGE_KEY = 'tradevault_supabase_config';
export const NATIVE_OAUTH_REDIRECT_URL = 'com.tradevault.journal.next://login-callback';
export type OAuthProviderId = 'google';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = '';

export const DEFAULT_DEPLOYED_SUPABASE_URL = 'https://hhotzotsdhkgymgtwfdk.supabase.co';
export const DEFAULT_DEPLOYED_SUPABASE_ANON_KEY =
  'sb_publishable_vKVwLGvnwhIemsvegm0X_Q_69p7_Eml';

const PLACEHOLDER_SUPABASE_HOSTS = new Set([
  'your-project-id.supabase.co',
  'your-project.supabase.co',
  'xxxx.supabase.co',
  'xxx.supabase.co',
  'xyzcompany.supabase.co',
  'placeholder.supabase.co',
]);

export function isPlaceholderSupabaseUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return true;
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  if (/^(sb_publishable_|sb_secret_|eyJhbGci|AIza)/i.test(trimmed)) return true;

  try {
    const clean = sanitizeSupabaseUrl(trimmed);
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    if (PLACEHOLDER_SUPABASE_HOSTS.has(host)) return true;
    if (host !== 'localhost' && host !== '127.0.0.1' && !host.includes('.')) return true;
    return false;
  } catch {
    return true;
  }
}

export function isPlaceholderSupabaseKey(rawKey: string): boolean {
  if (!rawKey || typeof rawKey !== 'string') return true;
  const trimmed = rawKey.trim().replace(/^['"]+|['"]+$/g, '');
  if (!trimmed || trimmed.length < 20) return true;
  if (trimmed.endsWith('...')) return true;
  if (/^(your[-_]?anon[-_]?key|placeholder|example)/i.test(trimmed)) return true;
  return false;
}

/**
 * Sanitizes Supabase Project URL to ensure it is strictly the root origin (e.g. https://xxx.supabase.co).
 * Strips any accidentally appended paths such as /auth/v1, /rest/v1, or trailing slashes,
 * allowing the official Supabase SDK to build auth endpoints properly.
 */
export function sanitizeSupabaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let clean = rawUrl.trim().replace(/^['"]+|['"]+$/g, '');
  if (!clean) return '';

  // Convert Supabase Dashboard URL (https://supabase.com/dashboard/project/<ref>) to https://<ref>.supabase.co
  const dashboardMatch = clean.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{15,30})/i);
  if (dashboardMatch && dashboardMatch[1]) {
    return `https://${dashboardMatch[1].toLowerCase()}.supabase.co`;
  }

  // Convert bare project reference ID (e.g. "hhotzotsdhkgymgtwfdk") to https://<ref>.supabase.co
  if (/^[a-z0-9]{15,30}$/i.test(clean) && !clean.includes('.')) {
    return `https://${clean.toLowerCase()}.supabase.co`;
  }

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
  let envApiBase = '';

  // 1. Read environment variables first
  try {
    if (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) {
      envUrl = ((import.meta as any).env.VITE_SUPABASE_URL || '').trim();
      envKey = ((import.meta as any).env.VITE_SUPABASE_ANON_KEY || '').trim();
      envApiBase = ((import.meta as any).env.VITE_API_BASE_URL || '').trim();
    }
  } catch {
    // ignore import.meta access error
  }

  if (typeof process !== 'undefined' && process?.env) {
    if (!envUrl) envUrl = (process.env.VITE_SUPABASE_URL || '').trim();
    if (!envKey) envKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    if (!envApiBase) envApiBase = (process.env.VITE_API_BASE_URL || '').trim();
  }

  // Filter out template placeholders (e.g. "https://your-project-id.supabase.co" or "eyJ...")
  const validEnvUrl = !isPlaceholderSupabaseUrl(envUrl) ? sanitizeSupabaseUrl(envUrl) : '';
  let validEnvKey = !isPlaceholderSupabaseKey(envKey) ? envKey.trim() : '';

  // Recover if user placed a Supabase publishable/anon key into VITE_API_BASE_URL by mistake
  if (
    !validEnvKey &&
    envApiBase &&
    /^(sb_publishable_|eyJhbGci)/i.test(envApiBase) &&
    !isPlaceholderSupabaseKey(envApiBase)
  ) {
    validEnvKey = envApiBase;
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
          const candidateUrl = sanitizeSupabaseUrl(String(parsed.url));
          const candidateKey = String(parsed.anonKey).trim();

          if (!isPlaceholderSupabaseUrl(candidateUrl) && !isPlaceholderSupabaseKey(candidateKey)) {
            storedUrl = candidateUrl;
            storedKey = candidateKey;

            if (candidateUrl !== parsed.url.trim()) {
              localStorage.setItem(
                CONFIG_STORAGE_KEY,
                JSON.stringify({ url: candidateUrl, anonKey: candidateKey })
              );
            }
          } else {
            // Auto-evict invalid placeholder config stored in localStorage
            localStorage.removeItem(CONFIG_STORAGE_KEY);
          }
        }
      }
    } catch {
      // ignore localStorage read issues
    }
  }

  // Priority:
  // 1. Valid user override in localStorage
  // 2. Valid build/runtime environment variable
  // 3. Built-in deployed VLO Cloud project credentials
  const finalUrl = storedUrl || validEnvUrl || DEFAULT_DEPLOYED_SUPABASE_URL;
  const finalKey = storedKey || validEnvKey || DEFAULT_DEPLOYED_SUPABASE_ANON_KEY;

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

export function isBuiltInCloudConfigured(): boolean {
  const cfg = getSupabaseConfig();
  return !isPlaceholderSupabaseUrl(cfg.url) && !isPlaceholderSupabaseKey(cfg.anonKey);
}

export function isSupabaseConfigured(): boolean {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) return false;
  if (isPlaceholderSupabaseUrl(config.url) || isPlaceholderSupabaseKey(config.anonKey)) {
    return false;
  }
  const cleanUrl = sanitizeSupabaseUrl(config.url);
  try {
    const parsed = new URL(cleanUrl);
    const isValidProtocol = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    return isValidProtocol && config.anonKey.trim().length >= 20;
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
        flowType: 'pkce',
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

  if (message.includes('provider is not enabled') || message.includes('unsupported provider')) {
    return 'Metode login ini belum diaktifkan pada server VLO.';
  }

  if (message.includes('access_denied') || message.includes('user cancelled') || message.includes('canceled')) {
    return 'Proses masuk dibatalkan.';
  }

  if (status === 400) {
    return `Permintaan autentikasi tidak valid: ${error.message || 'Periksa input data Anda.'}`;
  }

  if (status === 429) {
    return 'Batas permintaan terlampaui. Silakan tunggu beberapa saat lagi.';
  }

  return error.message || 'Terjadi kesalahan saat memproses autentikasi. Silakan coba lagi.';
}

export function getOAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  if (Capacitor.isNativePlatform()) {
    return NATIVE_OAUTH_REDIRECT_URL;
  }
  return window.location.origin;
}

export async function signInWithOAuthProvider(
  provider: OAuthProviderId
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabase();
  if (!client) {
    return {
      success: false,
      error: 'Layanan cloud VLO belum terhubung.',
    };
  }

  try {
    const isNative = Capacitor.isNativePlatform();
    const redirectTo = getOAuthRedirectUrl();

    if (isNative) {
      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      });

      if (error) {
        return { success: false, error: translateAuthError(error) };
      }

      if (!data?.url) {
        return { success: false, error: 'URL autentikasi tidak tersedia.' };
      }

      await Browser.open({
        url: data.url,
        presentationStyle: 'popover',
      });
      return { success: true };
    }

    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
      },
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: translateAuthError(err) };
  }
}

export async function handleNativeOAuthCallbackUrl(
  rawUrl: string
): Promise<{ handled: boolean; success: boolean; user?: any; error?: string }> {
  if (!rawUrl || !rawUrl.startsWith('com.tradevault.journal.next://')) {
    return { handled: false, success: false };
  }

  try {
    if (Capacitor.isNativePlatform()) {
      await Browser.close().catch(() => {});
    }
  } catch {}

  const client = getSupabase();
  if (!client) {
    return { handled: true, success: false, error: 'Koneksi cloud tidak tersedia.' };
  }

  try {
    const parsed = new URL(rawUrl);
    const searchParams = parsed.searchParams;
    const hashParams = new URLSearchParams(parsed.hash ? parsed.hash.replace(/^#/, '') : '');

    const errorParam =
      searchParams.get('error_description') ||
      searchParams.get('error') ||
      hashParams.get('error_description') ||
      hashParams.get('error');

    if (errorParam) {
      return {
        handled: true,
        success: false,
        error: translateAuthError({ message: errorParam }),
      };
    }

    const code = searchParams.get('code');
    if (code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        return { handled: true, success: false, error: translateAuthError(error) };
      }
      return { handled: true, success: true, user: data?.user || data?.session?.user };
    }

    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        return { handled: true, success: false, error: translateAuthError(error) };
      }
      return { handled: true, success: true, user: data?.user || data?.session?.user };
    }

    return { handled: true, success: false, error: 'Token sesi login tidak ditemukan.' };
  } catch (err: any) {
    return { handled: true, success: false, error: translateAuthError(err) };
  }
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

const LOCAL_AVATAR_CACHE_PREFIX = 'tradevault_user_avatar_';

/**
 * Resolves the active user's profile avatar URL.
 * Prioritizes high-DPI local cache for the same user when a custom avatar is set,
 * falling back to user_metadata.avatar_url or OAuth picture (unless explicitly removed).
 */
export function getUserAvatarUrl(user: any): string {
  if (!user || typeof user !== 'object') return '';
  const meta = user.user_metadata || {};

  if (meta.avatar_removed === true && !meta.avatar_url) {
    return '';
  }

  const userId = typeof user.id === 'string' ? user.id.trim() : '';
  if (userId && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem(`${LOCAL_AVATAR_CACHE_PREFIX}${userId}`);
      if (cached && cached.startsWith('data:image/')) {
        return cached;
      }
    } catch {
      // ignore localStorage read errors
    }
  }

  const rawUrl = meta.avatar_url || meta.picture || '';
  return typeof rawUrl === 'string' ? rawUrl.trim() : '';
}

/**
 * Center-crops and compresses an uploaded image file into:
 * 1) highResDataUrl (256x256 JPEG) for crisp local retina rendering
 * 2) cloudDataUrl (compact square JPEG <= 3.2 KB) safe for Supabase Auth user_metadata without bloating JWT headers
 */
export async function compressAndCropAvatarImage(
  file: File
): Promise<{ highResDataUrl: string; cloudDataUrl: string }> {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('File yang dipilih bukan format gambar yang valid (gunakan JPG, PNG, atau WebP).');
  }
  const MAX_RAW_BYTES = 8 * 1024 * 1024; // 8 MB
  if (file.size > MAX_RAW_BYTES) {
    throw new Error('Ukuran file foto maksimal 8 MB.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Gagal membaca file gambar.'));
    };
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Format gambar rusak atau tidak didukung.'));
    image.src = dataUrl;
  });

  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;
  if (!srcWidth || !srcHeight) {
    throw new Error('Dimensi gambar tidak valid.');
  }

  // Center 1:1 square crop coordinates
  const cropSize = Math.min(srcWidth, srcHeight);
  const cropX = Math.floor((srcWidth - cropSize) / 2);
  const cropY = Math.floor((srcHeight - cropSize) / 2);

  const renderSquareJpeg = (targetDim: number, quality: number): string => {
    const canvas = document.createElement('canvas');
    canvas.width = targetDim;
    canvas.height = targetDim;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Gagal menginisialisasi pengolah gambar.');
    }
    // Fill subtle dark/neutral background for transparent PNGs
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, targetDim, targetDim);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, targetDim, targetDim);
    return canvas.toDataURL('image/jpeg', quality);
  };

  const highResDataUrl = renderSquareJpeg(256, 0.86);

  // Produce a compact cloud avatar safe for JWT user_metadata (<= 3200 chars)
  let cloudDataUrl = renderSquareJpeg(96, 0.72);
  const candidateConfigs: Array<[number, number]> = [
    [96, 0.64],
    [80, 0.65],
    [72, 0.62],
    [64, 0.58],
  ];
  for (const [dim, q] of candidateConfigs) {
    if (cloudDataUrl.length <= 3200) break;
    cloudDataUrl = renderSquareJpeg(dim, q);
  }

  return { highResDataUrl, cloudDataUrl };
}

/**
 * Uploads and updates the currently logged-in user's profile avatar in Supabase Auth
 * and caches the high-resolution version locally for instant rendering.
 */
export async function updateUserProfileAvatar(
  file: File
): Promise<{ success: boolean; user?: any; error?: string }> {
  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Layanan VLO Cloud belum terhubung.' };
  }

  try {
    const { data: sessionData } = await client.auth.getSession();
    const activeUser = sessionData?.session?.user;
    if (!activeUser?.id) {
      return { success: false, error: 'Sesi login tidak ditemukan. Silakan masuk kembali.' };
    }

    const { highResDataUrl, cloudDataUrl } = await compressAndCropAvatarImage(file);

    const { data, error } = await client.auth.updateUser({
      data: {
        avatar_url: cloudDataUrl,
        avatar_removed: false,
        avatar_updated_at: Date.now(),
      },
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`${LOCAL_AVATAR_CACHE_PREFIX}${activeUser.id}`, highResDataUrl);
      } catch {
        // ignore quota errors
      }
    }

    return { success: true, user: data.user };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || translateAuthError(err),
    };
  }
}

/**
 * Removes the logged-in user's profile photo and reverts to the default initial/icon avatar.
 */
export async function removeUserProfileAvatar(): Promise<{
  success: boolean;
  user?: any;
  error?: string;
}> {
  const client = getSupabase();
  if (!client) {
    return { success: false, error: 'Layanan VLO Cloud belum terhubung.' };
  }

  try {
    const { data: sessionData } = await client.auth.getSession();
    const activeUser = sessionData?.session?.user;
    if (!activeUser?.id) {
      return { success: false, error: 'Sesi login tidak ditemukan. Silakan masuk kembali.' };
    }

    const { data, error } = await client.auth.updateUser({
      data: {
        avatar_url: '',
        avatar_removed: true,
        avatar_updated_at: Date.now(),
      },
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(`${LOCAL_AVATAR_CACHE_PREFIX}${activeUser.id}`);
      } catch {}
    }

    return { success: true, user: data.user };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || translateAuthError(err),
    };
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
