import { Trade } from '../types/trade';
import { AppSettings } from '../types/settings';
import {
  PerformanceMetrics,
  EquityPoint,
  formatCurrency,
  formatProfitFactor,
  formatRMultiple,
  formatGrowthPercent,
} from './calculations';
import { BehavioralAnalyticsResult, getMistakeLabel } from './journalExtras';

export interface PdfReportParams {
  metrics: PerformanceMetrics;
  equityCurve: EquityPoint[];
  behavioral: BehavioralAnalyticsResult;
  trades: Trade[];
  settings: AppSettings;
  periodLabel: string;
  hideBalances: boolean;
  isEn: boolean;
}

const A4_PT_W = 595.28;
const A4_PT_H = 841.89;
// 2x A4 resolution (144 DPI) for razor-sharp editorial typography & tables
const PAGE_W = 1190;
const PAGE_H = 1684;

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Assemble one or more JPEG-encoded A4 page canvases into a spec-compliant
 * PDF 1.4 binary Blob (zero external dependencies, works inside sandboxed iframes & mobile WebViews).
 */
export function buildPdfBlobFromJpegPages(
  pages: Array<{ bytes: Uint8Array; width: number; height: number }>
): Blob {
  const chunks: Uint8Array[] = [];
  let cursor = 0;

  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    cursor += chunk.length;
  };
  const pushStr = (str: string) => push(encodeAscii(str));

  // PDF 1.4 Header + binary transfer marker
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const pageCount = pages.length;
  const totalObjects = 2 + pageCount * 3;
  const offsets: number[] = new Array(totalObjects + 1).fill(0);

  const kidsRefs: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    kidsRefs.push(`${3 + i * 3} 0 R`);
  }

  // Object 1: Document Catalog
  offsets[1] = cursor;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages Tree
  offsets[2] = cursor;
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${kidsRefs.join(' ')}] /Count ${pageCount} >>\nendobj\n`);

  // Objects 3..N: Page, Image XObject, Content Stream per page
  for (let i = 0; i < pageCount; i++) {
    const pageObjId = 3 + i * 3;
    const imgObjId = 4 + i * 3;
    const contentObjId = 5 + i * 3;
    const { bytes: jpegBytes, width, height } = pages[i];

    // Page object
    offsets[pageObjId] = cursor;
    pushStr(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_PT_W.toFixed(2)} ${A4_PT_H.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imgObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`
    );

    // Image XObject (raw JPEG /DCTDecode)
    offsets[imgObjId] = cursor;
    pushStr(
      `${imgObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\n` +
        `stream\n`
    );
    push(jpegBytes);
    pushStr('\nendstream\nendobj\n');

    // Content stream drawing the image full-bleed onto the A4 page
    const contentStream = `q\n${A4_PT_W.toFixed(2)} 0 0 ${A4_PT_H.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = encodeAscii(contentStream);
    offsets[contentObjId] = cursor;
    pushStr(`${contentObjId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    pushStr('endstream\nendobj\n');
  }

  // Cross-reference table
  const xrefOffset = cursor;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjects; id++) {
    pushStr(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }

  // Trailer
  pushStr(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`
  );

  const blobParts: BlobPart[] = chunks.map((u8) => {
    const copy = new Uint8Array(u8.byteLength);
    copy.set(u8);
    return copy.buffer;
  });

  return new Blob(blobParts, { type: 'application/pdf' });
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createPageCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  return { canvas, ctx };
}

function drawPageFooter(
  ctx: CanvasRenderingContext2D,
  pageNumber: number,
  totalPages: number,
  periodLabel: string,
  isEn: boolean
) {
  const margin = 72;
  const footerY = PAGE_H - 58;
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(margin, footerY - 24);
  ctx.lineTo(PAGE_W - margin, footerY - 24);
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`VLO Journal · ${periodLabel}`, margin, footerY);

  ctx.textAlign = 'right';
  ctx.fillText(
    isEn ? `Page ${pageNumber} of ${totalPages}` : `Halaman ${pageNumber} dari ${totalPages}`,
    PAGE_W - margin,
    footerY
  );
  ctx.textAlign = 'left';
}

function drawTradesTableHeader(ctx: CanvasRenderingContext2D, y: number, isEn: boolean): number {
  const margin = 72;
  const contentW = PAGE_W - margin * 2;
  const rowH = 38;

  ctx.fillStyle = '#F4F4F5';
  ctx.fillRect(margin, y, contentW, rowH);
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin, y + rowH);
  ctx.lineTo(margin + contentW, y + rowH);
  ctx.stroke();

  ctx.fillStyle = '#526071';
  ctx.font = '700 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  const textY = y + 25;
  ctx.fillText(isEn ? 'TIME' : 'WAKTU', margin + 12, textY);
  ctx.fillText('PAIR', margin + 210, textY);
  ctx.fillText(isEn ? 'SIDE' : 'ARAH', margin + 355, textY);
  ctx.fillText('LOT', margin + 455, textY);
  ctx.fillText(isEn ? 'STRATEGY' : 'STRATEGI', margin + 540, textY);
  ctx.fillText(isEn ? 'RESULT' : 'HASIL', margin + 790, textY);
  ctx.textAlign = 'right';
  ctx.fillText('NET P/L', margin + contentW - 12, textY);
  ctx.textAlign = 'left';

  return y + rowH;
}

/**
 * Render editorial multi-page A4 report canvases so both live preview & PDF download
 * share the exact same deterministic visual layout.
 */
export function renderPerformanceReportCanvases(params: PdfReportParams): HTMLCanvasElement[] {
  const { metrics, equityCurve, behavioral, trades, settings, periodLabel, hideBalances, isEn } = params;
  const tr = (idText: string, enText: string) => (isEn ? enText : idText);

  const margin = 72;
  const contentW = PAGE_W - margin * 2;
  const pages: Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> = [];

  const page1 = createPageCanvas();
  pages.push(page1);
  let ctx = page1.ctx;
  let y = 76;

  // ── HEADER ──
  ctx.fillStyle = '#0F172A';
  ctx.font = '800 32px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('VLO JOURNAL', margin, y);

  ctx.fillStyle = '#1769E8';
  ctx.beginPath();
  ctx.arc(margin + 236, y - 11, 6.5, 0, Math.PI * 2);
  ctx.fill();

  const generatedStamp = new Date().toLocaleDateString(isEn ? 'en-US' : 'id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  ctx.textAlign = 'right';
  ctx.fillStyle = '#526071';
  ctx.font = '600 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`${tr('Dibuat', 'Generated')}: ${generatedStamp}`, PAGE_W - margin, y - 4);
  ctx.textAlign = 'left';

  y += 32;
  ctx.fillStyle = '#526071';
  ctx.font = '600 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(
    `${tr('LAPORAN PERFORMA TRADING', 'TRADING PERFORMANCE REPORT')}  ·  ${periodLabel.toUpperCase()}` +
      (hideBalances ? `  ·  ${tr('MODE PRIVASI', 'PRIVACY MODE')}` : ''),
    margin,
    y
  );

  y += 24;
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, y);
  ctx.lineTo(PAGE_W - margin, y);
  ctx.stroke();

  // ── 4 PRIMARY KPI CARDS ──
  y += 28;
  const isPositiveNet = metrics.totalNetProfit >= 0;
  const formattedGrowth = formatGrowthPercent(
    metrics.totalGainPercent,
    metrics.hasValidGrowthPercent,
    2
  );
  const formattedNetPnl = `${isPositiveNet ? '+' : ''}${formatCurrency(metrics.totalNetProfit, settings)}`;

  const kpiCards = [
    {
      label: hideBalances ? tr('PERTUMBUHAN BERSIH', 'NET GROWTH') : tr('PROFIT / LOSS BERSIH', 'NET PROFIT / LOSS'),
      value: hideBalances ? formattedGrowth : formattedNetPnl,
      sub: hideBalances
        ? `${metrics.totalTrades} ${tr('Transaksi', 'Trades')}`
        : `${formattedGrowth} ${tr('Pertumbuhan', 'Growth')}`,
      color: isPositiveNet ? '#059669' : '#E11D48',
    },
    {
      label: tr('WINRATE', 'WIN RATE'),
      value: `${metrics.winRate}%`,
      sub: `${metrics.winningTrades}W / ${metrics.losingTrades}L`,
      color: '#0F172A',
    },
    {
      label: 'PROFIT FACTOR',
      value: formatProfitFactor(metrics.profitFactor),
      sub: `${tr('Rata-rata R', 'Avg R')}: ${formatRMultiple(metrics.averageRiskReward)}`,
      color: '#0F172A',
    },
    {
      label: 'MAX DRAWDOWN',
      value: `${metrics.maxDrawdownPercent}%`,
      sub: `${tr('Disiplin Bersih', 'Clean WR')}: ${behavioral.cleanWinRate}%`,
      color: metrics.maxDrawdownPercent > 10 ? '#E11D48' : '#0F172A',
    },
  ];

  const cardGap = 18;
  const cardW = (contentW - cardGap * 3) / 4;
  const cardH = 128;

  kpiCards.forEach((card, idx) => {
    const cx = margin + idx * (cardW + cardGap);
    drawRoundedRect(ctx, cx, y, cardW, cardH, 14);
    ctx.fillStyle = '#FAFAFA';
    ctx.fill();
    ctx.strokeStyle = '#E4E4E7';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#526071';
    ctx.font = '700 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(card.label, cx + 18, y + 32);

    ctx.fillStyle = card.color;
    ctx.font = '800 30px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(truncateText(ctx, card.value, cardW - 36), cx + 18, y + 76);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(truncateText(ctx, card.sub, cardW - 36), cx + 18, y + 106);
  });

  y += cardH + 30;

  // ── EQUITY CURVE SECTION ──
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(tr('KURVA EKUITAS PERIODE AKTIF', 'ACTIVE PERIOD EQUITY CURVE'), margin, y);

  y += 14;
  const chartH = 160;
  drawRoundedRect(ctx, margin, y, contentW, chartH, 14);
  ctx.fillStyle = '#FAFAFA';
  ctx.fill();
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (equityCurve.length >= 2) {
    const vals = equityCurve.map((p) => p.equity);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(maxV - minV, 1);

    // Subtle horizontal grid lines
    ctx.strokeStyle = '#EAECEF';
    ctx.lineWidth = 1;
    for (let g = 1; g <= 3; g++) {
      const gy = y + (chartH / 4) * g;
      ctx.beginPath();
      ctx.moveTo(margin + 20, gy);
      ctx.lineTo(margin + contentW - 20, gy);
      ctx.stroke();
    }

    ctx.beginPath();
    equityCurve.forEach((pt, idx) => {
      const px = margin + 24 + (idx / (equityCurve.length - 1)) * (contentW - 48);
      const py = y + chartH - 22 - ((pt.equity - minV) / span) * (chartH - 44);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = isPositiveNet ? '#059669' : '#E11D48';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else {
    ctx.fillStyle = '#64748B';
    ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(
      tr('Belum cukup titik transaksi untuk menampilkan kurva ekuitas.', 'Not enough trade points to plot an equity curve.'),
      margin + 24,
      y + chartH / 2 + 6
    );
  }

  y += chartH + 34;

  // ── DISCIPLINE & COST OF MISTAKES SECTION ──
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(tr('ANALITIK DISIPLIN & COST OF MISTAKES', 'DISCIPLINE & COST OF MISTAKES'), margin, y);

  y += 14;
  const mistakeHeaderH = 36;
  ctx.fillStyle = '#F4F4F5';
  ctx.fillRect(margin, y, contentW, mistakeHeaderH);
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin, y + mistakeHeaderH);
  ctx.lineTo(margin + contentW, y + mistakeHeaderH);
  ctx.stroke();

  ctx.fillStyle = '#526071';
  ctx.font = '700 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(tr('KATEGORI KESALAHAN', 'MISTAKE TAG'), margin + 12, y + 24);
  ctx.fillText(tr('JUMLAH', 'COUNT'), margin + 520, y + 24);
  ctx.fillText('WINRATE', margin + 700, y + 24);
  ctx.textAlign = 'right';
  ctx.fillText('NET P/L', margin + contentW - 12, y + 24);
  ctx.textAlign = 'left';

  y += mistakeHeaderH;

  const mistakes = behavioral.mistakeBreakdown.slice(0, 6);
  if (mistakes.length === 0) {
    ctx.fillStyle = '#64748B';
    ctx.font = '500 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(
      tr('Tidak ada pelanggaran disiplin tercatat pada periode ini.', 'No recorded discipline mistakes in this period.'),
      margin + 12,
      y + 28
    );
    y += 42;
  } else {
    mistakes.forEach((m) => {
      const rh = 38;
      ctx.fillStyle = '#0F172A';
      ctx.font = '600 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(truncateText(ctx, getMistakeLabel(m.tagId, isEn), 480), margin + 12, y + 25);

      ctx.fillStyle = '#526071';
      ctx.font = '500 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(`${m.count}x`, margin + 520, y + 25);
      ctx.fillText(`${m.winRate}%`, margin + 700, y + 25);

      ctx.textAlign = 'right';
      ctx.fillStyle = m.netProfit >= 0 ? '#059669' : '#E11D48';
      ctx.font = '700 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      const pnlText = hideBalances
        ? '••••'
        : `${m.netProfit >= 0 ? '+' : ''}${formatCurrency(m.netProfit, settings)}`;
      ctx.fillText(pnlText, margin + contentW - 12, y + 25);
      ctx.textAlign = 'left';

      y += rh;
      ctx.strokeStyle = '#EFEFF1';
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(margin + contentW, y);
      ctx.stroke();
    });
  }

  y += 32;

  // ── RECENT CLOSED TRADES (MULTI-PAGE PAGINATED, MAX 40) ──
  const recentTrades = trades.slice(0, 40);
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(
    tr(
      `RINGKASAN TRANSAKSI TERBARU (${recentTrades.length} TRADE)`,
      `RECENT CLOSED TRADES (${recentTrades.length} TRADES)`
    ),
    margin,
    y
  );
  y += 14;
  y = drawTradesTableHeader(ctx, y, isEn);

  const maxBottomY = PAGE_H - 104;
  const tradeRowH = 40;

  if (recentTrades.length === 0) {
    ctx.fillStyle = '#64748B';
    ctx.font = '500 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(
      tr('Belum ada transaksi tertutup pada periode ini.', 'No closed trades in this period.'),
      margin + 12,
      y + 28
    );
  } else {
    recentTrades.forEach((t, idx) => {
      if (y + tradeRowH > maxBottomY) {
        const nextPage = createPageCanvas();
        pages.push(nextPage);
        ctx = nextPage.ctx;
        y = 76;

        ctx.fillStyle = '#0F172A';
        ctx.font = '700 20px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(
          tr('RINGKASAN TRANSAKSI TERBARU (LANJUTAN)', 'RECENT CLOSED TRADES (CONTINUED)'),
          margin,
          y
        );
        y += 20;
        y = drawTradesTableHeader(ctx, y, isEn);
      }

      if (idx % 2 === 1) {
        ctx.fillStyle = '#FAFAFB';
        ctx.fillRect(margin, y, contentW, tradeRowH);
      }

      const textY = y + 26;
      ctx.fillStyle = '#526071';
      ctx.font = '500 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText((t.dateTime || '').slice(0, 16).replace('T', ' '), margin + 12, textY);

      ctx.fillStyle = '#0F172A';
      ctx.font = '700 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(truncateText(ctx, t.instrument || '-', 135), margin + 210, textY);

      ctx.fillStyle = t.position === 'BUY' ? '#059669' : '#E11D48';
      ctx.font = '700 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(t.position || '-', margin + 355, textY);

      ctx.fillStyle = '#0F172A';
      ctx.font = '500 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(String(t.lotSize ?? '-'), margin + 455, textY);

      ctx.fillStyle = '#526071';
      ctx.fillText(truncateText(ctx, t.strategy || '-', 235), margin + 540, textY);

      ctx.fillStyle = '#0F172A';
      ctx.font = '600 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(t.outcome || '-', margin + 790, textY);

      ctx.textAlign = 'right';
      ctx.fillStyle = t.netProfit >= 0 ? '#059669' : '#E11D48';
      ctx.font = '700 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      const rightVal = hideBalances
        ? t.rMultiple !== undefined && Number.isFinite(t.rMultiple)
          ? formatRMultiple(t.rMultiple)
          : t.outcome
        : `${t.netProfit >= 0 ? '+' : ''}${formatCurrency(t.netProfit, settings)}`;
      ctx.fillText(rightVal, margin + contentW - 12, textY);
      ctx.textAlign = 'left';

      y += tradeRowH;
      ctx.strokeStyle = '#EFEFF1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(margin + contentW, y);
      ctx.stroke();
    });
  }

  // Stamp page numbers on every page
  const totalPages = pages.length;
  pages.forEach((p, idx) => {
    drawPageFooter(p.ctx, idx + 1, totalPages, periodLabel, isEn);
  });

  return pages.map((p) => p.canvas);
}

/**
 * Generate a complete, ready-to-download multi-page PDF Blob.
 */
export function generatePerformancePdfBlob(params: PdfReportParams): {
  blob: Blob;
  pageCount: number;
} {
  const canvases = renderPerformanceReportCanvases(params);
  const jpegPages = canvases.map((canvas) => ({
    bytes: dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.94)),
    width: canvas.width,
    height: canvas.height,
  }));
  return {
    blob: buildPdfBlobFromJpegPages(jpegPages),
    pageCount: canvases.length,
  };
}
