/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  LogOut,
  User,
  Mail,
  ShieldCheck,
  Calendar,
  Key,
  HardDrive,
  AlertTriangle,
  RefreshCw,
  Camera,
  Trash2,
  Check,
} from 'lucide-react';
import {
  signOutUser,
  getUserAvatarUrl,
  updateUserProfileAvatar,
  removeUserProfileAvatar,
} from '../../utils/supabaseClient';
import { useLanguage } from '../../utils/language';

interface UserAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
  onLogoutSuccess: () => void;
  onUserUpdated?: (user: any) => void;
}

export const UserAccountModal: React.FC<UserAccountModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLogoutSuccess,
  onUserUpdated,
}) => {
  const { tr, locale } = useLanguage();
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setAvatarFeedback(null);
      setConfirmLogout(false);
      setLogoutError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || loggingOut || isUpdatingAvatar) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmLogout) {
          setConfirmLogout(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loggingOut, isUpdatingAvatar, confirmLogout, onClose]);

  if (!isOpen || !currentUser) return null;

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUpdatingAvatar(true);
    setAvatarFeedback(null);

    const res = await updateUserProfileAvatar(file);
    setIsUpdatingAvatar(false);

    if (res.success && res.user) {
      onUserUpdated?.(res.user);
      setAvatarFeedback({
        text: tr('Foto profil berhasil diperbarui.', 'Profile photo updated successfully.'),
        type: 'success',
      });
    } else {
      setAvatarFeedback({
        text:
          res.error ||
          tr('Gagal memperbarui foto profil.', 'Failed to update profile photo.'),
        type: 'error',
      });
    }
  };

  const handleRemoveAvatar = async () => {
    if (isUpdatingAvatar) return;
    setIsUpdatingAvatar(true);
    setAvatarFeedback(null);

    const res = await removeUserProfileAvatar();
    setIsUpdatingAvatar(false);

    if (res.success && res.user) {
      onUserUpdated?.(res.user);
      setAvatarFeedback({
        text: tr('Foto profil telah dihapus.', 'Profile photo has been removed.'),
        type: 'success',
      });
    } else {
      setAvatarFeedback({
        text:
          res.error ||
          tr('Gagal menghapus foto profil.', 'Failed to remove profile photo.'),
        type: 'error',
      });
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);

    const { success, error } = await signOutUser();
    setLoggingOut(false);

    if (success) {
      onLogoutSuccess();
      onClose();
    } else {
      setLogoutError(
        error?.message ||
          tr(
            'Gagal keluar dari sesi. Silakan coba beberapa saat lagi.',
            'Failed to sign out of session. Please try again shortly.'
          )
      );
    }
  };

  const displayName =
    currentUser.user_metadata?.full_name ||
    currentUser.user_metadata?.name ||
    currentUser.user_metadata?.preferred_username ||
    '';
  const avatarUrl = getUserAvatarUrl(currentUser);
  const rawProvider = String(currentUser.app_metadata?.provider || 'email').toLowerCase();
  const providerLabel =
    rawProvider === 'google' ? 'Google' : tr('Akun VLO', 'VLO Account');

  const email = currentUser.email || tr('Pengguna Tanpa Email', 'User Without Email');
  const userId = currentUser.id || '-';
  const createdAt = currentUser.created_at
    ? new Date(currentUser.created_at).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '-';
  const lastSignIn = currentUser.last_sign_in_at
    ? new Date(currentUser.last_sign_in_at).toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/75 p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Profil Akun VLO', 'VLO Account Profile')}
        className="w-full max-w-md max-h-[90vh] max-h-[90dvh] overflow-y-auto rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] p-6 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.22)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] text-[#0F172A] dark:text-[#F2F4F7] relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-[#FAFAFA] dark:bg-[#161A22] text-[#526071] dark:text-[#929BA9] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center">
              <User className="h-5 w-5 stroke-[1.75]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0F172A] dark:text-[#F2F4F7]">
                {tr('Profil Akun VLO', 'VLO Account Profile')}
              </h3>
              <p className="text-xs text-[#526071] dark:text-[#929BA9]">
                {tr('Sinkronisasi VLO Cloud aktif & terisolasi', 'VLO Cloud sync active & isolated')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full bg-[#FAFAFA] hover:bg-[#F4F4F5] text-[#526071] hover:text-[#0F172A] dark:bg-[#161A22] dark:hover:bg-[#1E2430] dark:text-[#929BA9] dark:hover:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 transition-colors cursor-pointer"
            aria-label={tr('Tutup', 'Close')}
          >
            <X className="h-4 w-4 stroke-[1.75]" />
          </button>
        </div>

        {/* Hidden File Input for Avatar Upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleAvatarFileChange}
          data-testid="account-avatar-file-input"
        />

        {/* User Summary & Profile Photo Control */}
        <div className="py-4 border-b border-[#E4E4E7] dark:border-[#20252D] space-y-3">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="uppercase font-semibold tracking-wider text-[#526071] dark:text-[#929BA9]">
              {tr('Status Akun', 'Account Status')}
            </span>
            <span className="font-semibold text-[#059669] dark:text-[#00A878]">
              {tr('Aktif & Terisolasi', 'Active & Isolated')}
            </span>
          </div>

          <div className="flex items-center gap-3.5">
            <div className="relative shrink-0">
              <button
                type="button"
                disabled={isUpdatingAvatar}
                onClick={() => fileInputRef.current?.click()}
                data-testid="account-modal-avatar-button"
                aria-label={tr('Ubah Foto Profil', 'Change Profile Photo')}
                title={tr('Klik untuk mengubah foto profil', 'Click to change profile photo')}
                className="group relative h-14 w-14 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] flex items-center justify-center text-[#0F172A] dark:text-white overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/35 dark:focus-visible:ring-white/35 disabled:opacity-60"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName || email}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-bold uppercase text-lg select-none">
                    {(displayName || email).charAt(0)}
                  </span>
                )}
                <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  {isUpdatingAvatar ? (
                    <RefreshCw className="h-4 w-4 text-white animate-spin stroke-[2]" />
                  ) : (
                    <Camera className="h-4 w-4 text-white stroke-[2]" />
                  )}
                </span>
              </button>

              <button
                type="button"
                disabled={isUpdatingAvatar}
                onClick={() => fileInputRef.current?.click()}
                aria-label={tr('Unggah Foto Profil', 'Upload Profile Photo')}
                title={tr('Unggah Foto Profil', 'Upload Profile Photo')}
                className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] border-2 border-white dark:border-[#101318] flex items-center justify-center shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                {isUpdatingAvatar ? (
                  <RefreshCw className="h-3 w-3 animate-spin stroke-[2]" />
                ) : (
                  <Camera className="h-3 w-3 stroke-[2]" />
                )}
              </button>
            </div>

            <div className="min-w-0 flex-1">
              {displayName && (
                <div className="text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7] truncate">
                  {displayName}
                </div>
              )}
              <div
                className={`${
                  displayName
                    ? 'text-xs text-[#526071] dark:text-[#929BA9]'
                    : 'text-sm font-bold text-[#0F172A] dark:text-[#F2F4F7]'
                } break-all`}
                title={email}
              >
                {email}
              </div>
              <div className="text-[11px] text-[#526071] dark:text-[#929BA9] flex items-center gap-1.5 mt-0.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[#059669] dark:text-[#00A878] shrink-0 stroke-[1.75]" />
                <span>{providerLabel}</span>
                <span aria-hidden="true">·</span>
                <span>VLO Cloud</span>
              </div>

              {/* Circular Profile Photo Action Buttons */}
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  disabled={isUpdatingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="account-modal-upload-photo-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isUpdatingAvatar ? (
                    <RefreshCw className="h-3 w-3 animate-spin stroke-[2]" />
                  ) : (
                    <Camera className="h-3 w-3 stroke-[2]" />
                  )}
                  <span>
                    {avatarUrl
                      ? tr('Ganti Foto', 'Change Photo')
                      : tr('Tambah Foto', 'Add Photo')}
                  </span>
                </button>

                {avatarUrl && (
                  <button
                    type="button"
                    disabled={isUpdatingAvatar}
                    onClick={handleRemoveAvatar}
                    data-testid="account-modal-remove-photo-btn"
                    aria-label={tr('Hapus Foto Profil', 'Remove Profile Photo')}
                    title={tr('Hapus Foto Profil', 'Remove Profile Photo')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] border border-[#E4E4E7] dark:border-[#20252D] text-[#526071] hover:text-[#E11D48] dark:text-[#929BA9] dark:hover:text-[#E05260] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 stroke-[1.75]" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {avatarFeedback && (
            <div
              role="status"
              className={`px-3 py-2 rounded-xl border text-[11px] font-medium flex items-center gap-2 animate-in fade-in duration-150 ${
                avatarFeedback.type === 'success'
                  ? 'bg-[#059669]/10 border-[#059669]/25 text-[#059669] dark:bg-[#00A878]/10 dark:border-[#00A878]/25 dark:text-[#00A878]'
                  : 'bg-[#E11D48]/10 border-[#E11D48]/25 text-[#E11D48] dark:bg-[#E05260]/10 dark:border-[#E05260]/25 dark:text-[#E05260]'
              }`}
            >
              {avatarFeedback.type === 'success' ? (
                <Check className="h-3.5 w-3.5 shrink-0 stroke-[2]" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 stroke-[2]" />
              )}
              <span>{avatarFeedback.text}</span>
            </div>
          )}
        </div>

        {/* Account Details Hairline List (Flat, zero nested mini-cards) */}
        <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] text-xs">
          <div className="py-3 flex items-center justify-between gap-3">
            <span className="text-[#526071] dark:text-[#929BA9] flex items-center gap-2 shrink-0">
              <Key className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
              <span>{tr('ID Akun', 'Account ID')}</span>
            </span>
            <span className="font-mono-numbers text-[11px] text-[#0F172A] dark:text-[#F2F4F7] max-w-[190px] truncate" title={userId}>
              {userId}
            </span>
          </div>

          <div className="py-3 flex items-center justify-between gap-3">
            <span className="text-[#526071] dark:text-[#929BA9] flex items-center gap-2 shrink-0">
              <Calendar className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
              <span>{tr('Terdaftar Sejak', 'Registered Since')}</span>
            </span>
            <span className="text-[#0F172A] dark:text-[#F2F4F7] font-medium font-mono-numbers tabular-nums">
              {createdAt}
            </span>
          </div>

          <div className="py-3 flex items-center justify-between gap-3">
            <span className="text-[#526071] dark:text-[#929BA9] flex items-center gap-2 shrink-0">
              <Mail className="h-3.5 w-3.5 text-[#526071] dark:text-[#929BA9] stroke-[1.75]" />
              <span>{tr('Login Terakhir', 'Last Sign In')}</span>
            </span>
            <span className="text-[#0F172A] dark:text-[#F2F4F7] font-medium font-mono-numbers tabular-nums">
              {lastSignIn}
            </span>
          </div>
        </div>

        {/* Data Safety Note */}
        <div className="py-3.5 border-t border-[#E4E4E7] dark:border-[#20252D] text-[11px] text-[#526071] dark:text-[#929BA9] flex items-start gap-2.5">
          <HardDrive className="h-4 w-4 text-[#526071] dark:text-[#929BA9] shrink-0 mt-0.5 stroke-[1.75]" />
          <p className="leading-relaxed">
            <strong className="text-[#0F172A] dark:text-[#F2F4F7]">{tr('Privasi & Isolasi Data:', 'Data Privacy & Isolation:')}</strong>{' '}
            {tr(
              'Jurnal dan screenshot Anda diproteksi khusus untuk akun ini dan terpisah sepenuhnya dari akun pengguna lain.',
              'Your journal and screenshots are strictly scoped to this account and completely isolated from other users.'
            )}
          </p>
        </div>

        {logoutError && (
          <div className="mb-3 p-3 rounded-xl bg-[#E11D48]/10 dark:bg-[#E05260]/10 border border-[#E11D48]/25 dark:border-[#E05260]/25 text-xs text-[#E11D48] dark:text-[#E05260] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
            <span>{logoutError}</span>
          </div>
        )}

        {/* Logout Actions */}
        <div className="pt-2 border-t border-[#E4E4E7] dark:border-[#20252D]">
          {!confirmLogout ? (
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="w-full min-h-[44px] py-2.5 rounded-full bg-[#FAFAFA] dark:bg-[#161A22] hover:bg-[#F4F4F5] dark:hover:bg-[#1E2430] text-[#E11D48] dark:text-[#E05260] border border-[#E4E4E7] dark:border-[#20252D] text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="h-4 w-4 stroke-[1.75]" />
              <span>{tr('Keluar dari Akun', 'Sign Out')}</span>
            </button>
          ) : (
            <div className="pt-2 space-y-2.5 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-[#E11D48] dark:text-[#E05260]">
                <AlertTriangle className="h-4 w-4 shrink-0 stroke-[1.75]" />
                <span>{tr('Yakin ingin keluar dari akun ini?', 'Are you sure you want to sign out?')}</span>
              </div>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
                {tr(
                  'Sesi cloud Anda akan ditutup di perangkat ini. Anda dapat masuk kembali kapan saja.',
                  'Your cloud session will be closed on this device. You can sign back in anytime.'
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={() => setConfirmLogout(false)}
                  className="min-h-[40px] py-2 rounded-full bg-[#F4F4F5] hover:bg-[#E4E4E7] dark:bg-[#161A22] dark:hover:bg-[#20252D] border border-[#E4E4E7] dark:border-[#20252D] text-[#0F172A] dark:text-[#F2F4F7] text-xs font-semibold transition-colors cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={handleLogout}
                  className="min-h-[40px] py-2 rounded-full bg-[#E11D48] hover:bg-[#BE123C] dark:bg-[#E05260] dark:hover:bg-[#E11D48] text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {loggingOut ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin stroke-[1.75]" />
                      <span>{tr('Keluar...', 'Signing out...')}</span>
                    </>
                  ) : (
                    <span>{tr('Ya, Keluar', 'Yes, Sign Out')}</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
