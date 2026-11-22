/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FundamentalDirectionBias,
  FundamentalGoldSnapshot,
  MacroNewsSnapshot,
  loadLocalCachedCmeFedWatchSync,
  loadLocalCachedMacroSnapshotSync,
} from './macroNewsEngine';
import {
  XAUUSD_SEASONALITY,
  computeMonthlySeasonalityStats,
} from '../data/xauusdSeasonality';

export type SmartHeatmapVerdict =
  | 'STRONG_BULLISH'
  | 'BULLISH'
  | 'MIXED'
  | 'BEARISH'
  | 'STRONG_BEARISH';

export interface SmartHeatmapTile {
  id: string;
  labelId: string;
  labelEn: string;
  sourceTagId: string;
  sourceTagEn: string;
  metricValue: string;
  metricSub: string;
  metricSubEn?: string;
  xauEffect: FundamentalDirectionBias;
  /** 0 = neutral/unavailable, 1 = mild, 2 = moderate, 3 = strong */
  intensity: 0 | 1 | 2 | 3;
  impactShortId: string;
  impactShortEn: string;
  detailId: string;
  detailEn: string;
  isAvailable: boolean;
}

export interface XauSmartHeatmapModel {
  tiles: SmartHeatmapTile[];
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  availableCount: number;
  heatScore: number; // -100 to +100
  verdict: SmartHeatmapVerdict;
  verdictTitleId: string;
  verdictTitleEn: string;
  verdictSummaryId: string;
  verdictSummaryEn: string;
  syncedSourcesId: string;
  syncedSourcesEn: string;
  lastSyncedAt: string;
}

export const SMC_OFFLINE_SIGNALS_STORAGE_KEY = 'tradevault_smc_offline_signals_v1';

interface CachedSmcSignalSummary {
  direction: 'BUY' | 'SELL';
  status: string;
  createdAt?: string;
  setupLabel?: string;
  rrRatio?: number;
}

function readLatestCachedSmcSignal(): CachedSmcSignalSummary | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SMC_OFFLINE_SIGNALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Prefer latest ACTIVE / RUNNING / PENDING signal, else latest recorded signal
    const validRecords = parsed.filter(
      (item: any) =>
        item &&
        typeof item === 'object' &&
        (item.direction === 'BUY' || item.direction === 'SELL')
    );
    if (validRecords.length === 0) return null;

    const sorted = [...validRecords].sort((a: any, b: any) => {
      const tA = new Date(a.createdAt || a.timestamp || 0).getTime() || 0;
      const tB = new Date(b.createdAt || b.timestamp || 0).getTime() || 0;
      return tB - tA;
    });

    const preferred =
      sorted.find((r: any) => {
        const st = String(r.status || r.outcome || '').toUpperCase();
        return st === 'ACTIVE' || st === 'RUNNING' || st === 'PENDING' || st === 'OPEN';
      }) || sorted[0];

    return {
      direction: preferred.direction,
      status: String(preferred.status || preferred.outcome || 'RECORDED').toUpperCase(),
      createdAt: preferred.createdAt || preferred.timestamp,
      setupLabel: preferred.setupName || preferred.strategy || preferred.timeframe || undefined,
      rrRatio: typeof preferred.rrRatio === 'number' ? preferred.rrRatio : undefined,
    };
  } catch {
    return null;
  }
}

function formatSigned(val?: number, suffix = '%', decimals = 2): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
  return `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}${suffix}`;
}

function getIntensityFromMagnitude(absVal: number, mild: number, strong: number): 1 | 2 | 3 {
  if (absVal >= strong) return 3;
  if (absVal >= mild) return 2;
  return 1;
}

function isMacroSnapshotFresher(
  macro: MacroNewsSnapshot | null,
  fundamental: FundamentalGoldSnapshot
): boolean {
  if (!macro?.analyzedAt) return false;
  const macroMs = new Date(macro.analyzedAt).getTime();
  const fundMs = new Date(fundamental.analyzedAt).getTime();
  if (!Number.isFinite(macroMs)) return false;
  if (!Number.isFinite(fundMs)) return true;
  return macroMs > fundMs;
}

/**
 * Pure, deterministic XAU/USD Smart Heatmap synthesizer.
 * Zero network calls, zero AI tokens, 100% compatible with Web, Offline PWA, and Android Capacitor APK.
 * Automatically reconciles freshest readings across Fundamental Gold, Trade News, SMC Signal, and Cycle Seasonality.
 */
export function buildXauSmartHeatmap(
  fundamental: FundamentalGoldSnapshot,
  macroOverride?: MacroNewsSnapshot | null
): XauSmartHeatmapModel {
  const macroSnap = macroOverride !== undefined ? macroOverride : loadLocalCachedMacroSnapshotSync();
  const cachedFedWatch = loadLocalCachedCmeFedWatchSync();
  const useMacroLive = isMacroSnapshotFresher(macroSnap, fundamental);
  const ev = fundamental?.evidenceSummary || {};
  const macroPulse = macroSnap?.intermarketPulse;
  const activeFedWatch =
    useMacroLive && macroSnap?.cmeFedWatch?.isAvailable
      ? macroSnap.cmeFedWatch
      : cachedFedWatch?.isAvailable
      ? cachedFedWatch
      : macroSnap?.cmeFedWatch?.isAvailable
      ? macroSnap.cmeFedWatch
      : null;

  const fedDominant =
    activeFedWatch?.dominantOutcome ||
    (ev.fedWatchDominant && ev.fedWatchDominant !== 'UNAVAILABLE' ? ev.fedWatchDominant : undefined);
  const fedCutPct = activeFedWatch?.cutProbability ?? ev.fedWatchCutPct ?? null;
  const fedHoldPct = activeFedWatch?.holdProbability ?? ev.fedWatchHoldPct ?? null;
  const fedHikePct = activeFedWatch?.hikeProbability ?? ev.fedWatchHikePct ?? null;
  const fedMeeting = activeFedWatch?.fomcMeetingDate || ev.fedWatchMeeting || 'FOMC';
  const fedSubText =
    fedDominant === 'CUT' && fedCutPct != null
      ? `Fed Cut ${fedCutPct.toFixed(0)}%`
      : fedDominant === 'HIKE' && fedHikePct != null
      ? `Fed Hike ${fedHikePct.toFixed(0)}%`
      : fedDominant === 'HOLD' && fedHoldPct != null
      ? `Fed Hold ${fedHoldPct.toFixed(0)}%`
      : fedDominant || undefined;
  const fedSentenceId = fedSubText
    ? ` CME FedWatch (${fedMeeting}): ${fedSubText}${
        activeFedWatch?.sourceLabel ? ` · ${activeFedWatch.sourceLabel}` : ''
      }.`
    : '';
  const fedSentenceEn = fedSubText
    ? ` CME FedWatch (${fedMeeting}): ${fedSubText}.`
    : '';

  const tiles: SmartHeatmapTile[] = [];

  // 1. DXY (US Dollar Index) — Inverse correlation to XAU/USD
  const dxyPrice =
    useMacroLive && macroPulse?.dxy?.isAvailable && macroPulse.dxy.price > 0
      ? macroPulse.dxy.price
      : ev.dxyPrice && ev.dxyPrice > 0
      ? ev.dxyPrice
      : macroPulse?.dxy?.isAvailable && macroPulse.dxy.price > 0
      ? macroPulse.dxy.price
      : undefined;
  const dxyPct =
    useMacroLive && macroPulse?.dxy?.isAvailable
      ? macroPulse.dxy.changePercent
      : typeof ev.dxyChangePct === 'number' && Number.isFinite(ev.dxyChangePct)
      ? ev.dxyChangePct
      : macroPulse?.dxy?.isAvailable
      ? macroPulse.dxy.changePercent
      : undefined;

  if (typeof dxyPct === 'number' && Number.isFinite(dxyPct) && dxyPrice) {
    const absDxy = Math.abs(dxyPct);
    const effect: FundamentalDirectionBias =
      dxyPct <= -0.08 ? 'BULLISH' : dxyPct >= 0.08 ? 'BEARISH' : 'NEUTRAL';
    const intensity = effect === 'NEUTRAL' ? 0 : getIntensityFromMagnitude(absDxy, 0.25, 0.55);
    tiles.push({
      id: 'dxy',
      labelId: 'DXY (Dolar AS)',
      labelEn: 'DXY (US Dollar)',
      sourceTagId: 'Makro',
      sourceTagEn: 'Macro',
      metricValue: dxyPrice.toFixed(2),
      metricSub: formatSigned(dxyPct),
      xauEffect: effect,
      intensity,
      impactShortId:
        effect === 'BULLISH'
          ? 'Dukung Bullish'
          : effect === 'BEARISH'
          ? 'Tekan Bearish'
          : 'Netral · Datar',
      impactShortEn:
        effect === 'BULLISH'
          ? 'Bullish Tailwind'
          : effect === 'BEARISH'
          ? 'Bearish Headwind'
          : 'Neutral · Flat',
      detailId:
        effect === 'BULLISH'
          ? `DXY melemah ${formatSigned(dxyPct)} ke ${dxyPrice.toFixed(2)}. Pelemahan Dolar AS membuat harga emas lebih murah bagi pembeli global dan membuka ruang penguatan XAU/USD.`
          : effect === 'BEARISH'
          ? `DXY menguat ${formatSigned(dxyPct)} ke ${dxyPrice.toFixed(2)}. Penguatan Dolar AS biasanya menjadi rem alami bagi reli XAU/USD dan memperbesar risiko rejection.`
          : `DXY bergerak sempit (${formatSigned(dxyPct)}) di ${dxyPrice.toFixed(2)}, sehingga dorongan dari sisi mata uang Dolar sementara netral.`,
      detailEn:
        effect === 'BULLISH'
          ? `DXY slipped ${formatSigned(dxyPct)} to ${dxyPrice.toFixed(2)}. A softer US Dollar lowers Gold’s global cost and supports XAU/USD upside.`
          : effect === 'BEARISH'
          ? `DXY rose ${formatSigned(dxyPct)} to ${dxyPrice.toFixed(2)}. Dollar strength creates a direct headwind for Gold rallies.`
          : `DXY is trading flat (${formatSigned(dxyPct)}) around ${dxyPrice.toFixed(2)}, leaving USD pressure neutral for now.`,
      isAvailable: true,
    });
  } else {
    tiles.push({
      id: 'dxy',
      labelId: 'DXY (Dolar AS)',
      labelEn: 'DXY (US Dollar)',
      sourceTagId: 'Makro',
      sourceTagEn: 'Macro',
      metricValue: '—',
      metricSub: 'Offline',
      xauEffect: 'NEUTRAL',
      intensity: 0,
      impactShortId: 'Menunggu Data',
      impactShortEn: 'Awaiting Data',
      detailId: 'Data live DXY belum tersedia (mode offline atau sumber harga belum tersinkron).',
      detailEn: 'Live DXY quote is currently unavailable (offline mode or feed not yet synced).',
      isAvailable: false,
    });
  }

  // 2. US10Y Treasury Yield — Inverse correlation to XAU/USD
  const us10yPrice =
    useMacroLive && macroPulse?.us10y?.isAvailable && macroPulse.us10y.price > 0
      ? macroPulse.us10y.price
      : ev.us10yPrice && ev.us10yPrice > 0
      ? ev.us10yPrice
      : macroPulse?.us10y?.isAvailable && macroPulse.us10y.price > 0
      ? macroPulse.us10y.price
      : undefined;
  const us10yPct =
    useMacroLive && macroPulse?.us10y?.isAvailable
      ? macroPulse.us10y.changePercent
      : typeof ev.us10yChangePct === 'number' && Number.isFinite(ev.us10yChangePct)
      ? ev.us10yChangePct
      : macroPulse?.us10y?.isAvailable
      ? macroPulse.us10y.changePercent
      : undefined;

  if (typeof us10yPct === 'number' && Number.isFinite(us10yPct) && us10yPrice) {
    const absY = Math.abs(us10yPct);
    const effect: FundamentalDirectionBias =
      us10yPct <= -0.35 ? 'BULLISH' : us10yPct >= 0.35 ? 'BEARISH' : 'NEUTRAL';
    const intensity = effect === 'NEUTRAL' ? 0 : getIntensityFromMagnitude(absY, 0.9, 1.8);
    tiles.push({
      id: 'us10y',
      labelId: 'Yield US10Y',
      labelEn: 'US10Y Yield',
      sourceTagId: 'Obligasi',
      sourceTagEn: 'Bonds',
      metricValue: `${us10yPrice.toFixed(2)}%`,
      metricSub: formatSigned(us10yPct),
      xauEffect: effect,
      intensity,
      impactShortId:
        effect === 'BULLISH'
          ? 'Dukung Bullish'
          : effect === 'BEARISH'
          ? 'Tekan Bearish'
          : 'Netral · Stabil',
      impactShortEn:
        effect === 'BULLISH'
          ? 'Bullish Tailwind'
          : effect === 'BEARISH'
          ? 'Bearish Headwind'
          : 'Neutral · Steady',
      detailId:
        effect === 'BULLISH'
          ? `Yield obligasi AS 10 tahun turun ${formatSigned(us10yPct)} ke ${us10yPrice.toFixed(2)}%. Biaya peluang menahan emas tanpa bunga berkurang—positif untuk XAU/USD.`
          : effect === 'BEARISH'
          ? `Yield US10Y naik ${formatSigned(us10yPct)} ke ${us10yPrice.toFixed(2)}%. Kenaikan imbal hasil obligasi menarik modal keluar dari emas yang tidak memberi kupon.`
          : `Yield US10Y relatif stabil (${formatSigned(us10yPct)}) di ${us10yPrice.toFixed(2)}%, belum memberi dorongan arah baru yang ekstrem.`,
      detailEn:
        effect === 'BULLISH'
          ? `US 10Y yield eased ${formatSigned(us10yPct)} to ${us10yPrice.toFixed(2)}%, lowering the opportunity cost of holding non-yielding Gold.`
          : effect === 'BEARISH'
          ? `US 10Y yield climbed ${formatSigned(us10yPct)} to ${us10yPrice.toFixed(2)}%, increasing opportunity-cost pressure on Gold.`
          : `US 10Y yield is holding steady (${formatSigned(us10yPct)}) near ${us10yPrice.toFixed(2)}%.`,
      isAvailable: true,
    });
  } else {
    tiles.push({
      id: 'us10y',
      labelId: 'Yield US10Y',
      labelEn: 'US10Y Yield',
      sourceTagId: 'Obligasi',
      sourceTagEn: 'Bonds',
      metricValue: '—',
      metricSub: 'Offline',
      xauEffect: 'NEUTRAL',
      intensity: 0,
      impactShortId: 'Menunggu Data',
      impactShortEn: 'Awaiting Data',
      detailId: 'Data yield US10Y belum tersedia saat offline.',
      detailEn: 'US10Y yield quote is currently unavailable offline.',
      isAvailable: false,
    });
  }

  // 3. Real Yield Proxy (TIP vs IEF) & CME FedWatch Policy Pricing
  if (typeof ev.tipIefChangePct === 'number' && Number.isFinite(ev.tipIefChangePct)) {
    const tipPct = ev.tipIefChangePct;
    let effect: FundamentalDirectionBias =
      tipPct >= 0.08 ? 'BULLISH' : tipPct <= -0.08 ? 'BEARISH' : 'NEUTRAL';
    let intensity: 0 | 1 | 2 | 3 =
      effect === 'NEUTRAL' ? 0 : getIntensityFromMagnitude(Math.abs(tipPct), 0.25, 0.55);

    if (effect === 'NEUTRAL' && fedDominant) {
      if (fedDominant === 'CUT') {
        effect = 'BULLISH';
        intensity = 1;
      } else if (fedDominant === 'HIKE' || (fedDominant === 'HOLD' && (fedHoldPct ?? 0) >= 60)) {
        effect = 'BEARISH';
        intensity = 1;
      }
    }

    tiles.push({
      id: 'real-yield',
      labelId: 'Real Yield & FedWatch',
      labelEn: 'Real Yield & FedWatch',
      sourceTagId: 'TIP · CME FedWatch',
      sourceTagEn: 'TIP · CME FedWatch',
      metricValue: formatSigned(tipPct),
      metricSub: fedSubText || (ev.us02yPrice ? `2Y ${ev.us02yPrice.toFixed(2)}%` : 'Proxy'),
      xauEffect: effect,
      intensity,
      impactShortId:
        effect === 'BULLISH'
          ? 'Bunga Riil / Fed Dovish'
          : effect === 'BEARISH'
          ? 'Bunga Riil / Fed Ketat'
          : 'Seimbang',
      impactShortEn:
        effect === 'BULLISH'
          ? 'Dovish / Lower Real Rates'
          : effect === 'BEARISH'
          ? 'Tighter Real Rates / Fed'
          : 'Balanced',
      detailId:
        (effect === 'BULLISH'
          ? `Rasio TIP/IEF (${formatSigned(tipPct)}) dan ekspektasi suku bunga condong dovish—bahan bakar struktural bagi tren naik Emas.`
          : effect === 'BEARISH'
          ? `Rasio TIP/IEF (${formatSigned(tipPct)}) serta penetapan harga suku bunga terasa ketat sehingga menahan agresivitas kenaikan Emas.`
          : `Ekspektasi bunga riil (TIP/IEF ${formatSigned(tipPct)}) berada di area seimbang menanti rilis inflasi/Fed berikutnya.`) +
        fedSentenceId,
      detailEn:
        (effect === 'BULLISH'
          ? `TIP/IEF ratio (${formatSigned(tipPct)}) and policy pricing tilt dovish—a key structural tailwind for Gold.`
          : effect === 'BEARISH'
          ? `TIP/IEF ratio (${formatSigned(tipPct)}) and rate pricing reflect tighter real rates, capping Gold upside.`
          : `Real yield proxy (TIP/IEF ${formatSigned(tipPct)}) is balanced ahead of upcoming inflation/Fed data.`) +
        fedSentenceEn,
      isAvailable: true,
    });
  } else if ((ev.us02yPrice && ev.us02yPrice > 0) || fedDominant) {
    const us02yPct = macroPulse?.us02y?.isAvailable ? macroPulse.us02y.changePercent : 0;
    let effect: FundamentalDirectionBias =
      us02yPct <= -0.25 ? 'BULLISH' : us02yPct >= 0.25 ? 'BEARISH' : 'NEUTRAL';
    let intensity: 0 | 1 | 2 | 3 =
      effect === 'NEUTRAL' ? 0 : getIntensityFromMagnitude(Math.abs(us02yPct), 0.7, 1.4);

    if (effect === 'NEUTRAL' && fedDominant) {
      if (fedDominant === 'CUT') {
        effect = 'BULLISH';
        intensity = (fedCutPct ?? 0) >= 65 ? 2 : 1;
      } else if (fedDominant === 'HIKE' || (fedDominant === 'HOLD' && (fedHoldPct ?? 0) >= 58)) {
        effect = 'BEARISH';
        intensity = fedDominant === 'HIKE' ? 2 : 1;
      }
    }

    tiles.push({
      id: 'real-yield',
      labelId: 'CME FedWatch & US02Y',
      labelEn: 'CME FedWatch & US02Y',
      sourceTagId: 'Suku Bunga',
      sourceTagEn: 'Fed Pricing',
      metricValue: ev.us02yPrice && ev.us02yPrice > 0 ? `${ev.us02yPrice.toFixed(2)}%` : fedSubText || 'FedWatch',
      metricSub: fedSubText || formatSigned(us02yPct),
      xauEffect: effect,
      intensity,
      impactShortId:
        effect === 'BULLISH'
          ? 'Ekspektasi Dovish'
          : effect === 'BEARISH'
          ? 'Bunga Ketat / Hawkish'
          : 'Stabil',
      impactShortEn:
        effect === 'BULLISH'
          ? 'Dovish Lean'
          : effect === 'BEARISH'
          ? 'Tight / Hawkish Lean'
          : 'Steady',
      detailId:
        (ev.us02yPrice && ev.us02yPrice > 0
          ? `Yield 2 tahun berada di ${ev.us02yPrice.toFixed(2)}%. Penurunan yield 2Y mendukung narasi pemangkasan bunga yang positif bagi XAU/USD.`
          : `Pembacaan arah suku bunga The Fed (${fedMeeting}) ikut menentukan biaya peluang memegang Emas.`) +
        fedSentenceId,
      detailEn:
        (ev.us02yPrice && ev.us02yPrice > 0
          ? `US 2Y yield sits at ${ev.us02yPrice.toFixed(2)}%. Softer front-end yields support rate-cut expectations and Gold.`
          : `Federal Reserve rate expectations (${fedMeeting}) anchor the opportunity cost of holding Gold.`) +
        fedSentenceEn,
      isAvailable: true,
    });
  } else {
    tiles.push({
      id: 'real-yield',
      labelId: 'Real Yield & FedWatch',
      labelEn: 'Real Yield & FedWatch',
      sourceTagId: 'Suku Bunga',
      sourceTagEn: 'Rates',
      metricValue: '—',
      metricSub: 'Offline',
      xauEffect: 'NEUTRAL',
      intensity: 0,
      impactShortId: 'Menunggu Data',
      impactShortEn: 'Awaiting Data',
      detailId: 'Proxy bunga riil & data CME FedWatch belum tersedia saat offline.',
      detailEn: 'Real yield proxy & CME FedWatch data are unavailable while offline.',
      isAvailable: false,
    });
  }

  // 4. Risk Stress & Equity Flow (VIX + S&P 500 ES=F, with Dash-for-Cash intelligence!)
  const vixPrice =
    useMacroLive && macroPulse?.vix?.isAvailable && macroPulse.vix.price > 0
      ? macroPulse.vix.price
      : ev.vixPrice && ev.vixPrice > 0
      ? ev.vixPrice
      : macroPulse?.vix?.isAvailable && macroPulse.vix.price > 0
      ? macroPulse.vix.price
      : undefined;
  const esPct = typeof ev.esChangePct === 'number' && Number.isFinite(ev.esChangePct) ? ev.esChangePct : undefined;

  if (vixPrice || esPct !== undefined) {
    const isDashForCash = fundamental.marketRegime === 'DELEVERAGING_DASH_FOR_CASH';
    let effect: FundamentalDirectionBias = 'NEUTRAL';
    let intensity: 0 | 1 | 2 | 3 = 0;

    if (isDashForCash) {
      effect = 'BEARISH';
      intensity = 3;
    } else if ((vixPrice && vixPrice >= 20) || (esPct !== undefined && esPct <= -0.55)) {
      effect = 'BULLISH';
      intensity = vixPrice && vixPrice >= 25 ? 3 : 2;
    } else if (esPct !== undefined && esPct >= 0.75 && (!vixPrice || vixPrice < 16)) {
      effect = 'BEARISH';
      intensity = esPct >= 1.4 ? 2 : 1;
    }

    tiles.push({
      id: 'vix-risk',
      labelId: 'VIX & Saham AS',
      labelEn: 'VIX & US Equities',
      sourceTagId: 'Sentimen Risiko',
      sourceTagEn: 'Risk Sentiment',
      metricValue: vixPrice ? `VIX ${vixPrice.toFixed(1)}` : formatSigned(esPct),
      metricSub: esPct !== undefined ? `S&P ${formatSigned(esPct)}` : 'Safe-Haven',
      xauEffect: effect,
      intensity,
      impactShortId: isDashForCash
        ? 'Waspada Margin Call'
        : effect === 'BULLISH'
        ? 'Arus Safe-Haven'
        : effect === 'BEARISH'
        ? 'Risk-On ke Saham'
        : 'Risiko Terkendali',
      impactShortEn: isDashForCash
        ? 'Dash-for-Cash Risk'
        : effect === 'BULLISH'
        ? 'Safe-Haven Bid'
        : effect === 'BEARISH'
        ? 'Equity Risk-On'
        : 'Calm Sentiment',
      detailId: isDashForCash
        ? `Mode Dash-for-Cash terdeteksi (VIX ${vixPrice?.toFixed(1) || 'tinggi'}): saat kepanikan ekstrem, dana besar kerap menjual emas sementara untuk menutup margin call tunai.`
        : effect === 'BULLISH'
        ? `Kewaspadaan pasar meningkat (VIX ${vixPrice ? vixPrice.toFixed(1) : '—'}, S&P ${formatSigned(esPct)}). Arus modal defensif cenderung melirik Emas sebagai lindung nilai.`
        : effect === 'BEARISH'
        ? `Selera risiko saham AS sedang tinggi (S&P ${formatSigned(esPct)}), sehingga dana spekulatif jangka pendek lebih nyaman parkir di ekuitas ketimbang Emas.`
        : `Sentimen saham AS dan VIX (${vixPrice ? vixPrice.toFixed(1) : '—'}) berada di zona tenang, belum memicu arus panic buying maupun rotasi ekstrem.`,
      detailEn: isDashForCash
        ? `Dash-for-Cash stress detected (VIX ${vixPrice?.toFixed(1) || 'elevated'}): funds may briefly liquidate Gold to raise USD cash for margin calls.`
        : effect === 'BULLISH'
        ? `Risk aversion is rising (VIX ${vixPrice ? vixPrice.toFixed(1) : '—'}, S&P ${formatSigned(esPct)}), encouraging defensive rotation into Gold.`
        : effect === 'BEARISH'
        ? `Strong US equity appetite (S&P ${formatSigned(esPct)}) pulls short-term speculative flows toward stocks rather than Gold.`
        : `US equities and VIX (${vixPrice ? vixPrice.toFixed(1) : '—'}) remain orderly with balanced risk appetite.`,
      isAvailable: true,
    });
  } else {
    tiles.push({
      id: 'vix-risk',
      labelId: 'VIX & Saham AS',
      labelEn: 'VIX & US Equities',
      sourceTagId: 'Sentimen Risiko',
      sourceTagEn: 'Risk Sentiment',
      metricValue: '—',
      metricSub: 'Offline',
      xauEffect: 'NEUTRAL',
      intensity: 0,
      impactShortId: 'Menunggu Data',
      impactShortEn: 'Awaiting Data',
      detailId: 'Data VIX dan S&P 500 belum tersedia saat offline.',
      detailEn: 'VIX and S&P 500 quotes are unavailable while offline.',
      isAvailable: false,
    });
  }

  // 5. Institutional Gold Flow (GLD ETF + GC=F + CFTC COT)
  const gldPct = typeof ev.gldChangePct === 'number' && Number.isFinite(ev.gldChangePct) ? ev.gldChangePct : undefined;
  const gcPulse = macroPulse?.goldPositioning?.isAvailable ? macroPulse.goldPositioning : undefined;
  const cotPct = typeof ev.cftcNetPercentile === 'number' && Number.isFinite(ev.cftcNetPercentile) ? ev.cftcNetPercentile : undefined;

  if (gldPct !== undefined || gcPulse) {
    const primaryPct = gldPct !== undefined ? gldPct : gcPulse?.change3dPercent ?? 0;
    const effect: FundamentalDirectionBias =
      primaryPct >= 0.2 ? 'BULLISH' : primaryPct <= -0.2 ? 'BEARISH' : 'NEUTRAL';
    const intensity = effect === 'NEUTRAL' ? 0 : getIntensityFromMagnitude(Math.abs(primaryPct), 0.65, 1.4);
    tiles.push({
      id: 'gold-flow',
      labelId: 'Arus ETF & Institusi',
      labelEn: 'ETF & Inst. Flow',
      sourceTagId: 'GLD · COT',
      sourceTagEn: 'GLD · COT',
      metricValue: gldPct !== undefined ? `GLD ${formatSigned(gldPct)}` : `GC ${formatSigned(primaryPct)}`,
      metricSub: cotPct !== undefined ? `COT ${cotPct}/100` : ev.gvzPrice ? `GVZ ${ev.gvzPrice.toFixed(1)}` : 'Futures',
      xauEffect: effect,
      intensity,
      impactShortId:
        effect === 'BULLISH'
          ? 'Akumulasi Institusi'
          : effect === 'BEARISH'
          ? 'Distribusi / Profit Taking'
          : 'Aliran Seimbang',
      impactShortEn:
        effect === 'BULLISH'
          ? 'Institutional Inflow'
          : effect === 'BEARISH'
          ? 'Profit Taking / Outflow'
          : 'Balanced Flow',
      detailId:
        effect === 'BULLISH'
          ? `Arus ETF Emas (${gldPct !== undefined ? `GLD ${formatSigned(gldPct)}` : `GC=F ${formatSigned(primaryPct)}`}) menunjukkan minat beli fisik/institusi aktif${cotPct !== undefined ? ` dengan posisi CFTC COT di persentil ${cotPct}/100` : ''}.`
          : effect === 'BEARISH'
          ? `Arus ETF/Futures Emas (${gldPct !== undefined ? `GLD ${formatSigned(gldPct)}` : `GC=F ${formatSigned(primaryPct)}`}) melemah, mengindikasikan aksi ambil untung jangka pendek institusi.`
          : `Arus modal pada ETF Emas dan kontrak berjangka sedang seimbang tanpa tekanan jual-beli agresif.`,
      detailEn:
        effect === 'BULLISH'
          ? `Gold ETF/Futures flow (${gldPct !== undefined ? `GLD ${formatSigned(gldPct)}` : `GC=F ${formatSigned(primaryPct)}`}) reflects active institutional demand${cotPct !== undefined ? ` with CFTC COT at the ${cotPct}th percentile` : ''}.`
          : effect === 'BEARISH'
          ? `Gold ETF/Futures flow (${gldPct !== undefined ? `GLD ${formatSigned(gldPct)}` : `GC=F ${formatSigned(primaryPct)}`}) softened, indicating near-term institutional profit-taking.`
          : `Institutional ETF and futures positioning is balanced with muted net flows.`,
      isAvailable: true,
    });
  } else {
    tiles.push({
      id: 'gold-flow',
      labelId: 'Arus ETF & Institusi',
      labelEn: 'ETF & Inst. Flow',
      sourceTagId: 'GLD · COT',
      sourceTagEn: 'GLD · COT',
      metricValue: cotPct !== undefined ? `COT ${cotPct}` : '—',
      metricSub: 'Offline',
      xauEffect: 'NEUTRAL',
      intensity: 0,
      impactShortId: 'Menunggu Data',
      impactShortEn: 'Awaiting Data',
      detailId: 'Data arus ETF Emas (GLD) & Gold Futures belum tersedia saat offline.',
      detailEn: 'Gold ETF (GLD) & Futures flow data is unavailable while offline.',
      isAvailable: false,
    });
  }

  // 6. Asia FX & Energy Inflation (USD/CNH & WTI Oil)
  const cnhPct = typeof ev.usdCnhChangePct === 'number' && Number.isFinite(ev.usdCnhChangePct) ? ev.usdCnhChangePct : undefined;
  const oilPct =
    useMacroLive && macroPulse?.usoil?.isAvailable
      ? macroPulse.usoil.changePercent
      : typeof ev.usOilChangePct === 'number' && Number.isFinite(ev.usOilChangePct)
      ? ev.usOilChangePct
      : macroPulse?.usoil?.isAvailable
      ? macroPulse.usoil.changePercent
      : undefined;

  if (cnhPct !== undefined || oilPct !== undefined) {
    // Rising USD/CNH (weaker Yuan) often triggers Chinese physical Gold hedging; rising oil signals geopolitical/inflation hedge
    let score = 0;
    if (cnhPct !== undefined) {
      if (cnhPct >= 0.15) score += 1;
      else if (cnhPct <= -0.2) score -= 1;
    }
    if (oilPct !== undefined) {
      if (oilPct >= 1.2) score += 1;
      else if (oilPct <= -1.5) score -= 1;
    }
    const effect: FundamentalDirectionBias =
      score > 0 ? 'BULLISH' : score < 0 ? 'BEARISH' : 'NEUTRAL';
    const intensity: 0 | 1 | 2 | 3 = effect === 'NEUTRAL' ? 0 : Math.abs(score) >= 2 ? 2 : 1;

    tiles.push({
      id: 'asia-energy',
      labelId: 'Asia & Energi',
      labelEn: 'Asia FX & Energy',
      sourceTagId: 'CNH · Oil',
      sourceTagEn: 'CNH · Oil',
      metricValue: oilPct !== undefined ? `Oil ${formatSigned(oilPct)}` : `CNH ${formatSigned(cnhPct)}`,
      metricSub: cnhPct !== undefined && oilPct !== undefined ? `CNH ${formatSigned(cnhPct)}` : 'Inflasi · Asia',
      metricSubEn: cnhPct !== undefined && oilPct !== undefined ? `CNH ${formatSigned(cnhPct)}` : 'Inflation · Asia',
      xauEffect: effect,
      intensity,
      impactShortId:
        effect === 'BULLISH'
          ? 'Lindung Nilai Inflasi'
          : effect === 'BEARISH'
          ? 'Tekanan Inflasi Reda'
          : 'Kondisi Stabil',
      impactShortEn:
        effect === 'BULLISH'
          ? 'Inflation / FX Hedge'
          : effect === 'BEARISH'
          ? 'Cooling Energy Press.'
          : 'Steady Backdrop',
      detailId:
        effect === 'BULLISH'
          ? `Kombinasi minyak WTI (${formatSigned(oilPct)}) dan USD/CNH (${formatSigned(cnhPct)}) memperkuat kebutuhan lindung nilai inflasi & permintaan fisik Asia terhadap Emas.`
          : effect === 'BEARISH'
          ? `Meredanya harga minyak WTI (${formatSigned(oilPct)}) atau menguatnya Yuan (${formatSigned(cnhPct)}) mengurangi urgensi hedging inflasi jangka pendek pada Emas.`
          : `Minyak WTI (${formatSigned(oilPct)}) dan kurs Yuan (${formatSigned(cnhPct)}) bergerak stabil tanpa memicu lonjakan premi inflasi.`,
      detailEn:
        effect === 'BULLISH'
          ? `WTI Oil (${formatSigned(oilPct)}) and USD/CNH (${formatSigned(cnhPct)}) reinforce inflation-hedging and Asian physical demand for Gold.`
          : effect === 'BEARISH'
          ? `Softer WTI Oil (${formatSigned(oilPct)}) or firmer Yuan (${formatSigned(cnhPct)}) reduces near-term inflation-hedging urgency in Gold.`
          : `WTI Oil (${formatSigned(oilPct)}) and offshore Yuan (${formatSigned(cnhPct)}) are trading calmly without inflation shock.`,
      isAvailable: true,
    });
  } else {
    tiles.push({
      id: 'asia-energy',
      labelId: 'Asia & Energi',
      labelEn: 'Asia FX & Energy',
      sourceTagId: 'CNH · Oil',
      sourceTagEn: 'CNH · Oil',
      metricValue: '—',
      metricSub: 'Offline',
      xauEffect: 'NEUTRAL',
      intensity: 0,
      impactShortId: 'Menunggu Data',
      impactShortEn: 'Awaiting Data',
      detailId: 'Data minyak WTI & USD/CNH belum tersedia saat offline.',
      detailEn: 'WTI Oil & USD/CNH quotes are unavailable while offline.',
      isAvailable: false,
    });
  }

  // 7. Sinyal SMC (Synced from local SMC Signal history/active setup — 0 network!)
  const latestSmc = readLatestCachedSmcSignal();
  if (latestSmc) {
    const effect: FundamentalDirectionBias = latestSmc.direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const isActiveSetup =
      latestSmc.status === 'ACTIVE' ||
      latestSmc.status === 'RUNNING' ||
      latestSmc.status === 'PENDING' ||
      latestSmc.status === 'OPEN';
    tiles.push({
      id: 'smc-signal',
      labelId: 'Struktur SMC',
      labelEn: 'SMC Structure',
      sourceTagId: 'Sinyal SMC',
      sourceTagEn: 'SMC Signal',
      metricValue: latestSmc.direction === 'BUY' ? 'BULLISH' : 'BEARISH',
      metricSub: isActiveSetup ? 'Setup Aktif' : latestSmc.setupLabel || 'Sinyal Terakhir',
      metricSubEn: isActiveSetup ? 'Active Setup' : latestSmc.setupLabel || 'Latest Signal',
      xauEffect: effect,
      intensity: isActiveSetup ? 2 : 1,
      impactShortId:
        effect === 'BULLISH' ? 'Searah Tren Naik' : 'Searah Tren Turun',
      impactShortEn:
        effect === 'BULLISH' ? 'Bullish Structure' : 'Bearish Structure',
      detailId: `Tersinkron otomatis dengan menu Sinyal SMC: pembacaan struktur teknikal terakhir mengarah ${effect === 'BULLISH' ? 'Bullish (naik)' : 'Bearish (turun)'}${isActiveSetup ? ' dengan status setup aktif' : ''}.`,
      detailEn: `Auto-synced from SMC Signal: latest technical market structure leans ${effect === 'BULLISH' ? 'Bullish' : 'Bearish'}${isActiveSetup ? ' with an active setup' : ''}.`,
      isAvailable: true,
    });
  } else {
    tiles.push({
      id: 'smc-signal',
      labelId: 'Struktur SMC',
      labelEn: 'SMC Structure',
      sourceTagId: 'Sinyal SMC',
      sourceTagEn: 'SMC Signal',
      metricValue: 'STANDBY',
      metricSub: 'Belum Discan',
      metricSubEn: 'Not Scanned',
      xauEffect: 'NEUTRAL',
      intensity: 0,
      impactShortId: 'Sinkron Otomatis',
      impactShortEn: 'Auto-Synced',
      detailId: 'Belum ada riwayat sinyal tersimpan. Saat Anda memindai di menu Sinyal SMC, arah struktur teknikal akan otomatis tampil di sini.',
      detailEn: 'No saved SMC signal yet. Once you run a scan in SMC Signal, its technical direction automatically syncs here.',
      isAvailable: false,
    });
  }

  // 8. XAU/USD Monthly Seasonality (Synced directly with Cycle & Confluence dataset — always available offline!)
  const seasonality = computeMonthlySeasonalityStats(XAUUSD_SEASONALITY.currentTargetMonthIndex);
  const seasonEffect: FundamentalDirectionBias =
    seasonality.winRatePct >= 58
      ? 'BULLISH'
      : seasonality.winRatePct <= 42
      ? 'BEARISH'
      : 'NEUTRAL';
  const seasonIntensity: 0 | 1 | 2 | 3 =
    seasonEffect === 'NEUTRAL'
      ? 0
      : seasonality.winRatePct >= 70 || seasonality.winRatePct <= 30
      ? 2
      : 1;

  tiles.push({
    id: 'seasonality',
    labelId: `Siklus ${seasonality.monthLabel}`,
    labelEn: `${seasonality.monthLabel} Seasonality`,
    sourceTagId: 'Siklus',
    sourceTagEn: 'Cycle',
    metricValue: `${seasonality.winRatePct}% WR`,
    metricSub: `Avg ${formatSigned(seasonality.avgReturnPct)}`,
    xauEffect: seasonEffect,
    intensity: seasonIntensity,
    impactShortId:
      seasonEffect === 'BULLISH'
        ? 'Historis Positif'
        : seasonEffect === 'BEARISH'
        ? 'Historis Lemah'
        : 'Historis Campuran',
    impactShortEn:
      seasonEffect === 'BULLISH'
        ? 'Seasonal Tailwind'
        : seasonEffect === 'BEARISH'
        ? 'Seasonal Drag'
        : 'Mixed History',
    detailId: `Tersinkron dengan Siklus & Confluence: dalam ${seasonality.sampleYears} tahun terakhir, bulan ${seasonality.monthFullName} ditutup hijau ${seasonality.greenCount}x (${seasonality.winRatePct}%) dengan rata-rata return ${formatSigned(seasonality.avgReturnPct)}.`,
    detailEn: `Synced with Cycle & Confluence: over the past ${seasonality.sampleYears} years, ${seasonality.monthFullName} closed positive ${seasonality.greenCount} times (${seasonality.winRatePct}%) with a ${formatSigned(seasonality.avgReturnPct)} average return.`,
    isAvailable: true,
  });

  // Aggregate confluence score
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let availableCount = 0;
  let weightedSum = 0;
  let maxPossibleWeight = 0;

  for (const tile of tiles) {
    if (!tile.isAvailable) continue;
    availableCount++;
    maxPossibleWeight += 3;
    if (tile.xauEffect === 'BULLISH') {
      bullishCount++;
      weightedSum += tile.intensity || 1;
    } else if (tile.xauEffect === 'BEARISH') {
      bearishCount++;
      weightedSum -= tile.intensity || 1;
    } else {
      neutralCount++;
    }
  }

  const heatScore =
    maxPossibleWeight > 0 ? Math.round((weightedSum / maxPossibleWeight) * 100) : 0;

  let verdict: SmartHeatmapVerdict = 'MIXED';
  if (heatScore >= 32 && bullishCount >= bearishCount + 2) {
    verdict = 'STRONG_BULLISH';
  } else if (heatScore >= 12 && bullishCount > bearishCount) {
    verdict = 'BULLISH';
  } else if (heatScore <= -32 && bearishCount >= bullishCount + 2) {
    verdict = 'STRONG_BEARISH';
  } else if (heatScore <= -12 && bearishCount > bullishCount) {
    verdict = 'BEARISH';
  }

  const verdictCopy: Record<
    SmartHeatmapVerdict,
    { titleId: string; titleEn: string; summaryId: string; summaryEn: string }
  > = {
    STRONG_BULLISH: {
      titleId: 'Konfluensi Bullish Kuat',
      titleEn: 'Strong Bullish Confluence',
      summaryId: `${bullishCount} dari ${availableCount} faktor aktif serempak mendukung penguatan XAU/USD. Tekanan balik dari pasar lintas aset tergolong rendah.`,
      summaryEn: `${bullishCount} of ${availableCount} active drivers align behind XAU/USD upside with minimal cross-market headwinds.`,
    },
    BULLISH: {
      titleId: 'Condong Bullish',
      titleEn: 'Bullish Tilt',
      summaryId: `${bullishCount} faktor mendorong naik melawan ${bearishCount} faktor penahan. Bias makro mendukung sisi naik selama konfirmasi struktur chart tetap terjaga.`,
      summaryEn: `${bullishCount} supportive drivers vs ${bearishCount} headwinds. Macro backdrop favors upside while chart structure holds.`,
    },
    MIXED: {
      titleId: 'Pasar Konflik · Selektif',
      titleEn: 'Conflicting Forces · Selective',
      summaryId: `Pendorong naik (${bullishCount}) dan penekan turun (${bearishCount}) masih tarik-menarik. Rawan fakeout—prioritaskan validasi struktur sebelum ambil posisi.`,
      summaryEn: `Bullish (${bullishCount}) and bearish (${bearishCount}) forces are offsetting each other. Higher fakeout risk—wait for clean chart confirmation.`,
    },
    BEARISH: {
      titleId: 'Condong Bearish',
      titleEn: 'Bearish Tilt',
      summaryId: `${bearishCount} faktor menekan XAU/USD melawan ${bullishCount} faktor pendukung. Kenaikan intraday rentan tertahan area suplai.`,
      summaryEn: `${bearishCount} headwind drivers vs ${bullishCount} supportive factors. Intraday bounces face heavier supply pressure.`,
    },
    STRONG_BEARISH: {
      titleId: 'Tekanan Bearish Kuat',
      titleEn: 'Strong Bearish Pressure',
      summaryId: `${bearishCount} dari ${availableCount} faktor aktif kompak membebani XAU/USD. Hindari melawan arus utama sebelum terjadi perubahan struktur yang jelas.`,
      summaryEn: `${bearishCount} of ${availableCount} active drivers weigh on XAU/USD. Avoid fading dominant pressure without a clear structure shift.`,
    },
  };

  const activeSourcesId = [
    'Fundamental',
    ...(fedDominant ? ['CME FedWatch'] : []),
    ...(macroSnap ? ['Berita Trading'] : []),
    ...(latestSmc ? ['Sinyal SMC'] : []),
    'Siklus',
  ];
  const activeSourcesEn = [
    'Fundamental',
    ...(fedDominant ? ['CME FedWatch'] : []),
    ...(macroSnap ? ['Trade News'] : []),
    ...(latestSmc ? ['SMC Signal'] : []),
    'Cycle',
  ];

  const lastSyncedAt =
    useMacroLive && macroSnap?.analyzedAt ? macroSnap.analyzedAt : fundamental.analyzedAt;

  return {
    tiles,
    bullishCount,
    bearishCount,
    neutralCount,
    availableCount,
    heatScore,
    verdict,
    verdictTitleId: verdictCopy[verdict].titleId,
    verdictTitleEn: verdictCopy[verdict].titleEn,
    verdictSummaryId: verdictCopy[verdict].summaryId,
    verdictSummaryEn: verdictCopy[verdict].summaryEn,
    syncedSourcesId: activeSourcesId.join(' · '),
    syncedSourcesEn: activeSourcesEn.join(' · '),
    lastSyncedAt,
  };
}
