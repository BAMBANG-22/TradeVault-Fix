import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trade } from '../../types/trade';
import { AppSettings } from '../../types/settings';
import {
  PerformanceMetrics,
  EquityPoint,
  formatCurrency,
  formatProfitFactor,
  formatRMultiple,
  formatGrowthPercent,
} from '../../utils/calculations';
import { BehavioralAnalyticsResult } from '../../utils/journalExtras';
import {
  generatePerformancePdfBlob,
  renderPerformanceReportCanvases,
} from '../../utils/pdfReportGenerator';
import { useLanguage } from '../../utils/language';
import { Download, X, Eye, EyeOff, Share2, FileText, Check } from 'lucide-react';

interface PerformanceExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  metrics: PerformanceMetrics;
  equityCurve: EquityPoint[];
  behavioral: BehavioralAnalyticsResult;
  trades: Trade[];
  settings: AppSettings;
  periodLabel: string;
  initialPrivacyMode: boolean;
}

export const PerformanceExportModal: React.FC<PerformanceExportModalProps> = ({
  isOpen,
  onClose,
  metrics,
  equityCurve,
  behavioral,
  trades,
  settings,
  periodLabel,
  initialPrivacyMode,
}) => {
  const { tr, isEn } = useLanguage();
  const [activeTab, setActiveTab] = useState<'CARD' | 'PDF'>('CARD');
  const [hideBalances, setHideBalances] = useState(initialPrivacyMode);
  const [cardTheme, setCardTheme] = useState<'dark' | 'light'>('dark');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number>(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setHideBalances(initialPrivacyMode);
    setStatusMessage(null);
  }, [initialPrivacyMode, isOpen]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 2600);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  // Render live Page 1 preview when PDF tab is active
  useEffect(() => {
    if (!isOpen || activeTab !== 'PDF') return;
    try {
      const canvases = renderPerformanceReportCanvases({
        metrics,
        equityCurve,
        behavioral,
        trades,
        settings,
        periodLabel,
        hideBalances,
        isEn,
      });
      setPdfPageCount(canvases.length);
      if (canvases[0]) {
        setPdfPreviewUrl(canvases[0].toDataURL('image/jpeg', 0.86));
      }
    } catch {
      setPdfPreviewUrl(null);
    }
  }, [isOpen, activeTab, metrics, equityCurve, behavioral, trades, settings, periodLabel, hideBalances, isEn]);

  // Draw crisp 2x editorial VLO Performance Card onto canvas
  useEffect(() => {
    if (!isOpen || activeTab !== 'CARD') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 1200;
    const H = 675;
    canvas.width = W;
    canvas.height = H;

    const isDark = cardTheme === 'dark';
    const bg = isDark ? '#0B0E13' : '#FFFFFF';
    const surface = isDark ? '#12161E' : '#FAFAFA';
    const border = isDark ? '#20252D' : '#E4E4E7';
    const textPrimary = isDark ? '#F2F4F7' : '#0F172A';
    const textMuted = isDark ? '#929BA9' : '#526071';
    const profitColor = isDark ? '#00A878' : '#059669';
    const lossColor = isDark ? '#E05260' : '#E11D48';

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Outer subtle border
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, W - 48, H - 48);

    // Header: VLO Brand + Period
    ctx.fillStyle = textPrimary;
    ctx.font = '700 28px Inter, -apple-system, sans-serif';
    ctx.fillText('VLO JOURNAL', 68, 92);

    ctx.fillStyle = '#1769E8';
    ctx.beginPath();
    ctx.arc(274, 82, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = textMuted;
    ctx.font = '600 18px Inter, -apple-system, sans-serif';
    ctx.fillText(`XAUUSD PERFORMANCE · ${periodLabel.toUpperCase()}`, 68, 124);

    // Date stamp right aligned
    const dateStamp = new Date().toLocaleDateString(isEn ? 'en-US' : 'id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    ctx.textAlign = 'right';
    ctx.fillStyle = textMuted;
    ctx.font = '500 18px Inter, -apple-system, sans-serif';
    ctx.fillText(dateStamp, W - 68, 92);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(68, 152);
    ctx.lineTo(W - 68, 152);
    ctx.stroke();

    // Primary Metric: Net Profit or Growth %
    const isPos = hideBalances ? metrics.totalGainPercent >= 0 : metrics.totalNetProfit >= 0;
    const heroColor = isPos ? profitColor : lossColor;
    const formattedGrowth = formatGrowthPercent(
      metrics.totalGainPercent,
      metrics.hasValidGrowthPercent,
      2
    );
    ctx.fillStyle = textMuted;
    ctx.font = '600 16px Inter, -apple-system, sans-serif';
    ctx.fillText(
      hideBalances
        ? tr('PERTUMBUHAN BERSIH (%)', 'NET GROWTH (%)')
        : tr('TOTAL PROFIT / LOSS BERSIH', 'TOTAL NET PROFIT / LOSS'),
      68,
      202
    );

    ctx.fillStyle = heroColor;
    ctx.font = '800 64px Inter, -apple-system, sans-serif';
    const heroText = hideBalances
      ? formattedGrowth
      : `${metrics.totalNetProfit >= 0 ? '+' : ''}${formatCurrency(metrics.totalNetProfit, settings)}`;
    ctx.fillText(heroText, 68, 276);

    if (!hideBalances) {
      ctx.fillStyle = textMuted;
      ctx.font = '600 22px Inter, -apple-system, sans-serif';
      ctx.fillText(
        `${formattedGrowth} ${tr('Pertumbuhan', 'Growth')}`,
        68,
        316
      );
    }

    // Equity Sparkline on right top
    const curve = equityCurve || [];
    const chartX = 650;
    const chartY = 184;
    const chartW = 482;
    const chartH = 148;
    ctx.fillStyle = surface;
    ctx.fillRect(chartX, chartY, chartW, chartH);
    ctx.strokeStyle = border;
    ctx.strokeRect(chartX, chartY, chartW, chartH);

    if (curve.length >= 2) {
      const vals = curve.map((p) => p.equity);
      const minV = Math.min(...vals);
      const maxV = Math.max(...vals);
      const span = Math.max(maxV - minV, 1);

      ctx.beginPath();
      curve.forEach((pt, idx) => {
        const px = chartX + 16 + (idx / (curve.length - 1)) * (chartW - 32);
        const py = chartY + chartH - 18 - ((pt.equity - minV) / span) * (chartH - 36);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = heroColor;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else {
      ctx.fillStyle = textMuted;
      ctx.font = '500 15px Inter, sans-serif';
      ctx.fillText(tr('Kurva Ekuitas', 'Equity Curve'), chartX + 20, chartY + chartH / 2);
    }

    // 4 KPI Cards Row
    const kpis = [
      { label: tr('WINRATE', 'WIN RATE'), value: `${metrics.winRate}%` },
      { label: 'PROFIT FACTOR', value: formatProfitFactor(metrics.profitFactor) },
      { label: tr('RATA-RATA R', 'AVERAGE R'), value: formatRMultiple(metrics.averageRiskReward) },
      {
        label: tr('TOTAL TRADE', 'TOTAL TRADES'),
        value: `${metrics.totalTrades} (${metrics.winningTrades}W/${metrics.losingTrades}L)`,
      },
    ];

    const cardGap = 20;
    const cardW = (W - 136 - cardGap * 3) / 4;
    const cardY = 382;
    const cardH = 138;

    kpis.forEach((kpi, idx) => {
      const x = 68 + idx * (cardW + cardGap);
      ctx.fillStyle = surface;
      ctx.fillRect(x, cardY, cardW, cardH);
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, cardY, cardW, cardH);

      ctx.fillStyle = textMuted;
      ctx.font = '600 14px Inter, -apple-system, sans-serif';
      ctx.fillText(kpi.label, x + 22, cardY + 42);

      ctx.fillStyle = textPrimary;
      ctx.font = '700 32px Inter, -apple-system, sans-serif';
      ctx.fillText(kpi.value, x + 22, cardY + 96);
    });

    // Footer
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(68, 566);
    ctx.lineTo(W - 68, 566);
    ctx.stroke();

    ctx.fillStyle = textMuted;
    ctx.font = '500 16px Inter, -apple-system, sans-serif';
    ctx.fillText(
      `Max Drawdown: ${metrics.maxDrawdownPercent}%  ·  ${tr('Disiplin Bersih', 'Clean Winrate')}: ${behavioral.cleanWinRate}%`,
      68,
      610
    );
    ctx.textAlign = 'right';
    ctx.fillText('vlojournal.app', W - 68, 610);
    ctx.textAlign = 'left';
  }, [isOpen, activeTab, cardTheme, hideBalances, metrics, equityCurve, behavioral, settings, periodLabel, isEn, tr]);

  if (!isOpen) return null;

  const safeFileSuffix = periodLabel.replace(/[^a-zA-Z0-9_-]/g, '_') || 'All_Time';

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  };

  const canShareFile = (file: File): boolean => {
    try {
      return (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      );
    } catch {
      return false;
    }
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const filename = `VLO_Performance_${safeFileSuffix}.png`;
    canvas.toBlob(
      (blob) => {
        if (blob) {
          triggerBlobDownload(blob, filename);
        } else {
          const url = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        setStatusMessage(tr('Kartu PNG berhasil diunduh.', 'PNG card downloaded.'));
      },
      'image/png'
    );
  };

  const handleSharePng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const filename = `VLO_Performance_${safeFileSuffix}.png`;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], filename, { type: 'image/png' });
      if (canShareFile(file)) {
        try {
          await navigator.share({
            title: `VLO Journal — ${periodLabel}`,
            files: [file],
          });
          setStatusMessage(tr('Kartu PNG dibagikan.', 'PNG card shared.'));
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
        }
      }
      triggerBlobDownload(blob, filename);
      setStatusMessage(tr('Kartu PNG berhasil diunduh.', 'PNG card downloaded.'));
    }, 'image/png');
  };

  const handleDownloadPdfReport = async (mode: 'download' | 'share' = 'download') => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const { blob, pageCount } = generatePerformancePdfBlob({
        metrics,
        equityCurve,
        behavioral,
        trades,
        settings,
        periodLabel,
        hideBalances,
        isEn,
      });
      setPdfPageCount(pageCount);
      const filename = `VLO_Report_${safeFileSuffix}.pdf`;

      if (mode === 'share') {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (canShareFile(file)) {
          try {
            await navigator.share({
              title: `VLO Journal Report — ${periodLabel}`,
              files: [file],
            });
            setStatusMessage(tr('Laporan PDF dibagikan.', 'PDF report shared.'));
            return;
          } catch (err: any) {
            if (err?.name === 'AbortError') return;
          }
        }
      }

      triggerBlobDownload(blob, filename);
      setStatusMessage(
        tr(
          `Laporan PDF (${pageCount} halaman) berhasil diunduh.`,
          `PDF report (${pageCount} ${pageCount > 1 ? 'pages' : 'page'}) downloaded.`
        )
      );
    } catch {
      setStatusMessage(
        tr('Gagal membuat file PDF. Coba lagi.', 'Failed to generate PDF file. Please try again.')
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const modalNode = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('Export Laporan & Kartu Performa', 'Export Report & Performance Card')}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/55 dark:bg-black/75 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[90vh] flex flex-col rounded-t-[20px] sm:rounded-2xl border border-[#E4E4E7] dark:border-[#20252D] bg-white dark:bg-[#101318] text-[#0F172A] dark:text-[#F2F4F7] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E4E4E7] dark:border-[#20252D]">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-[#FAFAFA] dark:bg-[#161A22] border border-[#E4E4E7] dark:border-[#20252D] flex items-center justify-center">
              <Share2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold">
                {tr('Export Laporan PDF & Kartu PNG', 'Export PDF Report & PNG Card')}
              </h2>
              <p className="text-[11px] text-[#526071] dark:text-[#929BA9]">
                {tr('Periode aktif:', 'Active period:')} {periodLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup', 'Close')}
            className="p-1.5 rounded-full text-[#526071] dark:text-[#929BA9] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex p-0.5 rounded-full bg-[#FAFAFA] dark:bg-[#0B0E13] border border-[#E4E4E7] dark:border-[#20252D]">
              <button
                type="button"
                onClick={() => setActiveTab('CARD')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                  activeTab === 'CARD'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A]'
                    : 'text-[#526071] dark:text-[#929BA9]'
                }`}
              >
                {tr('Kartu PNG (Share)', 'PNG Share Card')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('PDF')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                  activeTab === 'PDF'
                    ? 'bg-[#0F172A] text-white dark:bg-white dark:text-[#0F172A]'
                    : 'text-[#526071] dark:text-[#929BA9]'
                }`}
              >
                {tr('Laporan PDF', 'PDF Report')}
              </button>
            </div>

            <div className="flex items-center gap-2">
              {activeTab === 'CARD' && (
                <button
                  type="button"
                  onClick={() => setCardTheme(cardTheme === 'dark' ? 'light' : 'dark')}
                  className="px-3 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-xs font-medium cursor-pointer"
                >
                  {cardTheme === 'dark' ? tr('Tema Gelap', 'Dark Card') : tr('Tema Terang', 'Light Card')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setHideBalances((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] text-xs font-medium cursor-pointer"
              >
                {hideBalances ? <EyeOff className="h-3.5 w-3.5 text-[#D97706]" /> : <Eye className="h-3.5 w-3.5" />}
                <span>{hideBalances ? tr('Nominal Disembunyikan', 'Balance Hidden') : tr('Tampilkan Nominal', 'Show Balance')}</span>
              </button>
            </div>
          </div>

          {statusMessage && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#059669]/25 bg-[#059669]/8 dark:border-[#00A878]/30 dark:bg-[#00A878]/10 text-xs font-medium text-[#059669] dark:text-[#00A878]">
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {activeTab === 'CARD' ? (
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-[#E4E4E7] dark:border-[#20252D] bg-[#0B0E13]">
                <canvas ref={canvasRef} className="w-full h-auto block" />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                  <button
                    type="button"
                    onClick={handleSharePng}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] text-xs font-semibold cursor-pointer"
                  >
                    <Share2 className="h-4 w-4" />
                    <span>{tr('Bagikan', 'Share')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadPng}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-bold cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>{tr('Unduh Kartu PNG (HD)', 'Download HD PNG Card')}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0E13] space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <FileText className="h-4 w-4 text-[#0F172A] dark:text-[#F2F4F7] shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <h3 className="text-xs sm:text-sm font-bold">
                        {tr('Laporan PDF Editorial A4', 'Editorial A4 PDF Report')}
                      </h3>
                      <p className="text-[11px] text-[#526071] dark:text-[#929BA9] leading-relaxed">
                        {tr(
                          `Siap diunduh langsung sebagai file .pdf (${pdfPageCount} halaman A4) lengkap dengan KPI, Kurva Ekuitas, Cost of Mistakes, dan hingga 40 transaksi terbaru.`,
                          `Downloads directly as a .pdf file (${pdfPageCount} A4 ${pdfPageCount > 1 ? 'pages' : 'page'}) with KPIs, Equity Curve, Cost of Mistakes, and up to 40 recent trades.`
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {pdfPreviewUrl && (
                  <div className="rounded-lg overflow-hidden border border-[#E4E4E7] dark:border-[#20252D] bg-white max-h-[320px] overflow-y-auto">
                    <img
                      src={pdfPreviewUrl}
                      alt={tr('Pratinjau Halaman 1 Laporan PDF', 'PDF Report Page 1 Preview')}
                      className="w-full h-auto block"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                  <button
                    type="button"
                    disabled={isExportingPdf}
                    onClick={() => handleDownloadPdfReport('share')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] hover:bg-[#F4F4F5] dark:bg-[#161A22] dark:hover:bg-[#1E2430] text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Share2 className="h-4 w-4" />
                    <span>{tr('Bagikan PDF', 'Share PDF')}</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isExportingPdf}
                  onClick={() => handleDownloadPdfReport('download')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white dark:bg-white dark:hover:bg-[#E2E8F0] dark:text-[#0F172A] text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  <span>
                    {isExportingPdf
                      ? tr('Menyusun PDF...', 'Generating PDF...')
                      : tr('Unduh Laporan PDF', 'Download PDF Report')}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
};
