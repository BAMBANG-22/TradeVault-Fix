import React, { useState, useEffect } from 'react';
import { X, Download, Loader2, AlertCircle } from 'lucide-react';
import {
  isStoragePath,
  resolveScreenshotSignedUrlWithDiagnostics,
  getCachedBase64ForStoragePath,
} from '../../utils/supabaseSync';
import { resolveTradingViewSnapshotUrl } from '../../utils/tradeScreenshotScanner';
import { useLanguage } from '../../utils/language';

interface ScreenshotModalProps {
  imageUrl: string | null;
  tradeTitle?: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({
  imageUrl,
  tradeTitle,
  isOpen,
  onClose,
}) => {
  const { tr } = useLanguage();
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !imageUrl) {
      setResolvedUrl(null);
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    const trimmed = imageUrl.trim();

    if (trimmed.startsWith('data:image/')) {
      setResolvedUrl(trimmed);
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const resolvedTv = resolveTradingViewSnapshotUrl(trimmed);
      setResolvedUrl(resolvedTv.directImageUrl || trimmed);
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    if (isStoragePath(trimmed)) {
      let isMounted = true;
      setIsLoading(true);
      setLoadError(null);
      setResolvedUrl(null);

      resolveScreenshotSignedUrlWithDiagnostics(trimmed, 3600)
        .then((res) => {
          if (!isMounted) return;
          setIsLoading(false);
          if (res.url) {
            setResolvedUrl(res.url);
          } else {
            setLoadError(
              res.errorMessage ||
                tr(
                  'Gagal memuat screenshot dari Storage privat. Pastikan sesi login aktif.',
                  'Failed to load screenshot from private storage. Make sure your sign-in session is active.'
                )
            );
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          setIsLoading(false);
          setLoadError(
            err?.message ||
              tr(
                'Terjadi kesalahan saat memuat gambar dari storage.',
                'An error occurred while loading image from storage.'
              )
          );
        });

      return () => {
        isMounted = false;
      };
    }

    setResolvedUrl(null);
    setIsLoading(false);
    setLoadError(tr('Format tautan screenshot tidak dikenali.', 'Unrecognized screenshot link format.'));
  }, [isOpen, imageUrl, tr]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 dark:bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full rounded-2xl border border-[#DDE3EA] dark:border-[#252B34] bg-white dark:bg-[#11151B] p-4 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#DDE3EA] dark:border-[#252B34] mb-3">
          <div className="text-sm font-semibold text-[#151D2A] dark:text-[#F2F5F9] truncate pr-4">
            {tradeTitle || tr('Screenshot Chart', 'Chart Screenshot')}
          </div>
          <div className="flex items-center gap-2">
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                download="Trade_Screenshot.jpg"
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9] hover:text-[#1769E8] hover:border-[#1769E8] text-xs flex items-center gap-1 transition-colors"
                title={tr('Unduh Gambar', 'Download Image')}
                aria-label={tr('Unduh screenshot', 'Download screenshot')}
              >
                <Download className="h-4 w-4 stroke-[1.75]" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#EEF2F6] dark:bg-[#171D26] border border-[#DDE3EA] dark:border-[#252B34] text-[#697586] dark:text-[#929BA9] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] transition-colors"
              aria-label={tr('Tutup pratinjau screenshot', 'Close screenshot preview')}
            >
              <X className="h-4 w-4 stroke-[1.75]" />
            </button>
          </div>
        </div>

        <div className="max-h-[75vh] min-h-[200px] overflow-auto rounded-xl bg-[#F5F7FA] dark:bg-[#080A0E] border border-[#DDE3EA] dark:border-[#252B34] flex items-center justify-center p-2">
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-2 text-[#1769E8] py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs text-[#697586] dark:text-[#929BA9]">
                {tr('Memuat gambar dari Storage privat...', 'Loading image from private storage...')}
              </span>
            </div>
          )}

          {loadError && !isLoading && (
            <div className="flex flex-col items-center justify-center gap-2 text-rose-500 py-12 text-center px-4">
              <AlertCircle className="h-7 w-7 stroke-[1.75] text-rose-500" />
              <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{loadError}</p>
            </div>
          )}

          {resolvedUrl && !isLoading && (
            <img
              src={resolvedUrl}
              alt="Chart Analysis"
              width={1200}
              height={675}
              decoding="async"
              className="w-full h-auto object-contain rounded-lg"
              onError={() => {
                const trimmed = imageUrl.trim();
                const fallbackB64 = isStoragePath(trimmed)
                  ? getCachedBase64ForStoragePath(trimmed)
                  : undefined;
                if (fallbackB64 && resolvedUrl !== fallbackB64) {
                  setResolvedUrl(fallbackB64);
                } else {
                  setResolvedUrl(null);
                  setLoadError(
                    tr(
                      'Gagal merender file gambar dari Storage privat. Pastikan file gambar masih tersedia di bucket trade-screenshots.',
                      'Failed to render image file from private storage. Make sure the image file still exists in the trade-screenshots bucket.'
                    )
                  );
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
