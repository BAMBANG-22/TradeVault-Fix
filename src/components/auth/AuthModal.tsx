/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  getSupabase,
  isSupabaseConfigured,
  translateAuthError,
  resendVerificationEmail,
  signInWithOAuthProvider,
  OAuthProviderId,
} from '../../utils/supabaseClient';
import {
  X,
  LogIn,
  UserPlus,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Database,
  RefreshCw,
  Send,
  HardDrive,
} from 'lucide-react';
import { useLanguage } from '../../utils/language';
import { useTheme } from '../../utils/theme';
import { VloMech } from '../layout/VloMechanicalOrbit';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: any) => void;
  onOpenConfig: () => void;
  onContinueLocal?: () => void;
  isDeveloperMode?: boolean;
}

type AuthMode = 'signin' | 'signup' | 'forgot' | 'verify_notice';

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  onOpenConfig,
  onContinueLocal,
  isDeveloperMode = false,
}) => {
  const { tr } = useLanguage();
  const { theme } = useTheme();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthProviderLoading, setOauthProviderLoading] = useState<OAuthProviderId | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string>('');

  const isBusy = loading || resendingEmail || oauthProviderLoading !== null;

  useEffect(() => {
    if (!isOpen || isBusy) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isBusy, onClose]);

  if (!isOpen) return null;

  const isConfigured = isSupabaseConfigured();

  const handleResetState = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleOAuthLogin = async (provider: OAuthProviderId) => {
    handleResetState();

    if (!isConfigured) {
      setErrorMessage(
        tr(
          'Layanan VLO Cloud belum diaktifkan pada build ini.',
          'VLO Cloud service is not enabled on this build.'
        )
      );
      return;
    }

    setOauthProviderLoading(provider);
    const result = await signInWithOAuthProvider(provider);
    if (!result.success) {
      setOauthProviderLoading(null);
      setErrorMessage(
        result.error ||
          tr('Gagal memulai autentikasi pihak ketiga.', 'Failed to start social authentication.')
      );
      return;
    }
    // Note: on web the page redirects; on Capacitor Android Browser opens and appUrlOpen handles return.
    // Release spinner after short timeout in case user closes browser manually.
    window.setTimeout(() => {
      setOauthProviderLoading(null);
    }, 8000);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    handleResetState();

    if (!isConfigured) {
      setErrorMessage(
        tr(
          'Layanan VLO Cloud belum tersedia.',
          'VLO Cloud service is unavailable.'
        )
      );
      return;
    }

    const client = getSupabase();
    if (!client) {
      setErrorMessage(tr('Koneksi VLO Cloud tidak tersedia.', 'VLO Cloud connection is unavailable.'));
      return;
    }

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setErrorMessage(
        tr('Email dan kata sandi wajib diisi.', 'Email and password are required.')
      );
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (error) {
        setErrorMessage(translateAuthError(error));
        setLoading(false);
        return;
      }

      if (data?.user) {
        setSuccessMessage(
          tr('Berhasil masuk! Memuat jurnal Anda...', 'Signed in! Loading your journal...')
        );
        setTimeout(() => {
          onAuthSuccess(data.user);
          onClose();
        }, 450);
      } else {
        setErrorMessage(
          tr(
            'Sesi login tidak ditemukan. Silakan periksa kembali email dan kata sandi.',
            'Sign-in session not found. Please check your email and password.'
          )
        );
      }
    } catch (err: any) {
      setErrorMessage(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    handleResetState();

    if (!isConfigured) {
      setErrorMessage(
        tr(
          'Layanan VLO Cloud belum tersedia.',
          'VLO Cloud service is unavailable.'
        )
      );
      return;
    }

    const client = getSupabase();
    if (!client) {
      setErrorMessage(tr('Koneksi VLO Cloud tidak tersedia.', 'VLO Cloud connection is unavailable.'));
      return;
    }

    const cleanName = fullName.trim();
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setErrorMessage(
        tr('Email dan kata sandi wajib diisi.', 'Email and password are required.')
      );
      return;
    }

    if (cleanPassword.length < 6) {
      setErrorMessage(
        tr(
          'Kata sandi harus memiliki panjang minimal 6 karakter.',
          'Password must be at least 6 characters long.'
        )
      );
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await client.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
          data: cleanName ? { full_name: cleanName } : undefined,
        },
      });

      if (error) {
        setErrorMessage(translateAuthError(error));
        setLoading(false);
        return;
      }

      if (data?.user && !data.session) {
        setRegisteredEmail(cleanEmail);
        setMode('verify_notice');
        setSuccessMessage(
          tr(
            'Akun VLO berhasil dibuat. Silakan cek email Anda untuk konfirmasi.',
            'VLO account created. Please check your email to confirm.'
          )
        );
      } else if (data?.session && data?.user) {
        setSuccessMessage(
          tr(
            'Pendaftaran berhasil! Selamat datang di Vlo Journal.',
            'Registration successful! Welcome to Vlo Journal.'
          )
        );
        setTimeout(() => {
          onAuthSuccess(data.user);
          onClose();
        }, 550);
      } else {
        setErrorMessage(
          tr(
            'Pendaftaran tidak dapat diselesaikan. Silakan coba lagi.',
            'Registration could not be completed. Please try again.'
          )
        );
      }
    } catch (err: any) {
      setErrorMessage(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    handleResetState();

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage(
        tr(
          'Masukkan alamat email untuk menerima tautan pemulihan kata sandi.',
          'Enter your email address to receive a password reset link.'
        )
      );
      return;
    }

    const client = getSupabase();
    if (!client) {
      setErrorMessage(tr('Koneksi VLO Cloud tidak tersedia.', 'VLO Cloud connection is unavailable.'));
      return;
    }

    setLoading(true);

    try {
      const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: window.location.origin,
      });

      if (error) {
        setErrorMessage(translateAuthError(error));
      } else {
        setSuccessMessage(
          tr(
            `Tautan pemulihan kata sandi telah dikirim ke ${cleanEmail}. Periksa kotak masuk atau folder spam.`,
            `Password recovery link sent to ${cleanEmail}. Check your inbox or spam folder.`
          )
        );
      }
    } catch (err: any) {
      setErrorMessage(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = registeredEmail || email.trim();
    if (!targetEmail) {
      setErrorMessage(tr('Alamat email tidak ditemukan.', 'Email address not found.'));
      return;
    }

    setResendingEmail(true);
    setErrorMessage(null);

    const result = await resendVerificationEmail(targetEmail);
    setResendingEmail(false);

    if (result.success) {
      setSuccessMessage(result.message);
    } else {
      setErrorMessage(result.message);
    }
  };

  const handleContinueLocalClick = () => {
    if (onContinueLocal) {
      onContinueLocal();
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Autentikasi Vlo Journal', 'Vlo Journal Authentication')}
        className="w-full max-w-md max-h-[92vh] max-h-[92dvh] overflow-y-auto rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-6 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] text-[#0F172A] dark:text-[#F2F4F7] relative transform-gpu"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="flex items-center gap-3 min-w-0">
            <VloMech theme={theme} size={44} slowMo={0.8} className="shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                {mode === 'signin' && tr('Masuk ke Vlo Journal', 'Sign In to Vlo Journal')}
                {mode === 'signup' && tr('Buat Akun Vlo Journal', 'Create Vlo Journal Account')}
                {mode === 'forgot' && tr('Pemulihan Kata Sandi', 'Password Recovery')}
                {mode === 'verify_notice' && tr('Konfirmasi Email Anda', 'Confirm Your Email')}
              </h3>
              <p className="text-xs text-[#526071] dark:text-[#929BA9] truncate">
                {tr(
                  'Sinkronkan jurnal trading lintas perangkat',
                  'Sync your trading journal across devices'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            aria-label={tr('Tutup', 'Close')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {!isConfigured ? (
          <div className="my-5 space-y-4">
            <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                <HardDrive className="h-4 w-4 shrink-0 text-[#0F172A] dark:text-white stroke-[1.75]" />
                <span>{tr('Mode Penyimpanan Lokal Aktif', 'Local Storage Mode Active')}</span>
              </div>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
                {tr(
                  'Sinkronisasi cloud belum diaktifkan pada build ini. Anda tetap dapat mencatat dan menganalisis transaksi XAUUSD secara penuh di perangkat ini.',
                  'Cloud sync is not active on this build yet. You can still log and analyze your XAUUSD trades locally on this device.'
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={handleContinueLocalClick}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] font-semibold text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
            >
              {tr('Lanjutkan dengan Mode Lokal', 'Continue in Local Mode')}
            </button>

            {isDeveloperMode && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenConfig();
                }}
                className="w-full min-h-[40px] flex items-center justify-center gap-2 py-2 px-4 rounded-full border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] font-medium text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
              >
                <Database className="h-3.5 w-3.5 stroke-[1.75]" />
                <span>{tr('Konfigurasi Cloud (Developer)', 'Cloud Config (Developer)')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="pt-4 space-y-4">
            {/* Navigation Tabs (only for signin & signup) */}
            {(mode === 'signin' || mode === 'signup') && (
              <div className="grid grid-cols-2 p-1 rounded-full bg-[#F4F4F5] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] text-xs">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setMode('signin');
                    handleResetState();
                  }}
                  className={`min-h-[38px] py-1.5 rounded-full font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    mode === 'signin'
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A] shadow-2xs'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {tr('Masuk', 'Sign In')}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setMode('signup');
                    handleResetState();
                  }}
                  className={`min-h-[38px] py-1.5 rounded-full font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 ${
                    mode === 'signup'
                      ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A] shadow-2xs'
                      : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                  }`}
                >
                  {tr('Daftar Akun', 'Create Account')}
                </button>
              </div>
            )}

            {/* Error Message Box */}
            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E11D48]/30 dark:border-[#E05260]/30 text-xs text-[#E11D48] dark:text-[#E05260] flex items-start gap-2.5 animate-in fade-in"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 stroke-[1.75]" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
            )}

            {/* Success Message Box */}
            {successMessage && (
              <div
                role="status"
                className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#059669]/30 dark:border-[#00A878]/30 text-xs text-[#059669] dark:text-[#00A878] flex items-start gap-2.5 animate-in fade-in"
              >
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 stroke-[1.75]" />
                <span className="leading-relaxed">{successMessage}</span>
              </div>
            )}

            {/* Social / OAuth Providers (Standard App Login Flow) */}
            {(mode === 'signin' || mode === 'signup') && (
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={isBusy}
                  data-testid="auth-google-button"
                  onClick={() => handleOAuthLogin('google')}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] text-[#0F172A] dark:text-[#F2F4F7] text-xs font-semibold transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {oauthProviderLoading === 'google' ? (
                    <RefreshCw className="h-4 w-4 animate-spin stroke-[1.75]" />
                  ) : (
                    <GoogleIcon className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {mode === 'signup'
                      ? tr('Daftar dengan Google', 'Sign up with Google')
                      : tr('Lanjutkan dengan Google', 'Continue with Google')}
                  </span>
                </button>

                {/* Divider */}
                <div className="relative flex items-center py-1.5">
                  <div className="flex-grow border-t border-[#E4E4E7] dark:border-[#20252D]" />
                  <span className="shrink-0 mx-3 text-[11px] text-[#526071] dark:text-[#929BA9]">
                    {mode === 'signup'
                      ? tr('atau daftar dengan Akun VLO', 'or sign up with VLO Account')
                      : tr('atau masuk dengan Akun VLO', 'or sign in with VLO Account')}
                  </span>
                  <div className="flex-grow border-t border-[#E4E4E7] dark:border-[#20252D]" />
                </div>
              </div>
            )}

            {/* VIEW 1: SIGN IN (AKUN VLO) */}
            {mode === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-[#0F172A] dark:text-[#F2F4F7] font-semibold mb-1.5">
                    {tr('Email Akun VLO', 'VLO Account Email')}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
                    <input
                      type="email"
                      required
                      placeholder="trader@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] pl-9 pr-3 py-2 text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#526071] dark:placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[#0F172A] dark:text-[#F2F4F7] font-semibold">
                      {tr('Kata Sandi', 'Password')}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        handleResetState();
                      }}
                      className="text-[11px] text-[#0F172A] dark:text-white font-semibold hover:underline cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                    >
                      {tr('Lupa kata sandi?', 'Forgot password?')}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder={tr('Masukkan kata sandi', 'Enter password')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] pl-9 pr-10 py-2 text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#526071] dark:placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 h-6 w-6 flex items-center justify-center text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                      aria-label={
                        showPassword
                          ? tr('Sembunyikan kata sandi', 'Hide password')
                          : tr('Tampilkan kata sandi', 'Show password')
                      }
                    >
                      {showPassword ? <EyeOff className="h-4 w-4 stroke-[1.75]" /> : <Eye className="h-4 w-4 stroke-[1.75]" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin stroke-[1.75]" />
                      <span>{tr('Memverifikasi...', 'Verifying...')}</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4 stroke-[1.75]" />
                      <span>{tr('Masuk dengan Akun VLO', 'Sign In with VLO Account')}</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* VIEW 2: SIGN UP (AKUN VLO) */}
            {mode === 'signup' && (
              <form onSubmit={handleSignUp} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-[#0F172A] dark:text-[#F2F4F7] font-semibold mb-1.5">
                    {tr('Nama Trader (Opsional)', 'Trader Name (Optional)')}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
                    <input
                      type="text"
                      placeholder={tr('Contoh: Bambang A.', 'e.g., Alex Morgan')}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] pl-9 pr-3 py-2 text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#526071] dark:placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#0F172A] dark:text-[#F2F4F7] font-semibold mb-1.5">
                    {tr('Alamat Email', 'Email Address')}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
                    <input
                      type="email"
                      required
                      placeholder="trader@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] pl-9 pr-3 py-2 text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#526071] dark:placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#0F172A] dark:text-[#F2F4F7] font-semibold mb-1.5">
                    {tr('Buat Kata Sandi', 'Create Password')}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder={tr('Minimal 6 karakter', 'Minimum 6 characters')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] pl-9 pr-10 py-2 text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#526071] dark:placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 h-6 w-6 flex items-center justify-center text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                      aria-label={
                        showPassword
                          ? tr('Sembunyikan kata sandi', 'Hide password')
                          : tr('Tampilkan kata sandi', 'Show password')
                      }
                    >
                      {showPassword ? <EyeOff className="h-4 w-4 stroke-[1.75]" /> : <Eye className="h-4 w-4 stroke-[1.75]" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin stroke-[1.75]" />
                      <span>{tr('Mendaftarkan...', 'Registering...')}</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 stroke-[1.75]" />
                      <span>{tr('Daftar Akun VLO', 'Create VLO Account')}</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* VIEW 3: FORGOT PASSWORD */}
            {mode === 'forgot' && (
              <form onSubmit={handleForgotPassword} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[#0F172A] dark:text-[#F2F4F7] font-semibold mb-1.5">
                    {tr('Alamat Email Terdaftar', 'Registered Email Address')}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
                    <input
                      type="email"
                      required
                      autoFocus
                      placeholder="trader@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] pl-9 pr-3 py-2 text-[#0F172A] dark:text-[#F2F4F7] placeholder-[#526071] dark:placeholder-[#929BA9] focus:border-[#0F172A] dark:focus:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/25 dark:focus-visible:ring-white/25"
                    />
                  </div>
                  <p className="text-[11px] text-[#526071] dark:text-[#929BA9] mt-1.5">
                    {tr(
                      'Kami akan mengirimkan tautan untuk mengatur ulang kata sandi Akun VLO Anda.',
                      'We will send a link to reset your VLO Account password.'
                    )}
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin stroke-[1.75]" />
                      <span>{tr('Mengirimkan...', 'Sending...')}</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 stroke-[1.75]" />
                      <span>{tr('Kirim Tautan Pemulihan', 'Send Recovery Link')}</span>
                    </>
                  )}
                </button>

                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      handleResetState();
                    }}
                    className="text-xs text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-white font-medium cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  >
                    {tr('← Kembali ke Halaman Masuk', '← Back to Sign In')}
                  </button>
                </div>
              </form>
            )}

            {/* VIEW 4: VERIFY NOTICE */}
            {mode === 'verify_notice' && (
              <div className="space-y-4 text-xs py-1">
                <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D] space-y-2.5">
                  <div className="flex items-center gap-2 text-[#0F172A] dark:text-white font-bold text-sm">
                    <Mail className="h-5 w-5 shrink-0 stroke-[1.75]" />
                    <span>{tr('Tautan Konfirmasi Terkirim!', 'Confirmation Link Sent!')}</span>
                  </div>
                  <p className="text-[#0F172A] dark:text-[#F2F4F7] leading-relaxed text-xs">
                    {tr(
                      'Silakan konfirmasi pendaftaran Akun VLO Anda melalui tautan yang telah dikirim ke:',
                      'Please confirm your VLO Account registration via the link sent to:'
                    )}
                  </p>
                  <div className="pt-2 border-t border-[#E4E4E7] dark:border-[#20252D] font-mono-numbers text-[#0F172A] dark:text-white text-xs font-bold break-all">
                    {registeredEmail || email}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      handleResetState();
                    }}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  >
                    <LogIn className="h-4 w-4 stroke-[1.75]" />
                    <span>
                      {tr('Saya Sudah Konfirmasi, Masuk Sekarang', 'I Confirmed, Sign In Now')}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={resendingEmail}
                    onClick={handleResendVerification}
                    className="w-full min-h-[40px] py-2 px-4 rounded-full bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] font-medium text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                  >
                    {resendingEmail ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin stroke-[1.75]" />
                        <span>{tr('Mengirim ulang...', 'Resending...')}</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 stroke-[1.75] text-[#526071] dark:text-[#929BA9]" />
                        <span>{tr('Kirim Ulang Email Konfirmasi', 'Resend Confirmation Email')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Local Offline Option */}
            {(mode === 'signin' || mode === 'signup') && (
              <div className="pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
                <button
                  type="button"
                  disabled={isBusy}
                  data-testid="auth-continue-local-button"
                  onClick={handleContinueLocalClick}
                  className="w-full min-h-[40px] py-2 px-4 rounded-full text-[11px] font-medium text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35"
                >
                  {tr('Gunakan Mode Lokal Tanpa Akun', 'Use Local Mode Without Account')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
