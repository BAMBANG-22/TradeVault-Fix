import { Trade } from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { calculateLotBasedOrderMetrics, getInstrumentPipSpec } from './riskCalculator';

export type ComplianceStatus =
  | 'COMPLIANT_TP'
  | 'COMPLIANT_SL'
  | 'MANUAL_DISCIPLINED'
  | 'VIOLATION_SL'
  | 'VIOLATION_TP'
  | 'VIOLATION_NO_SL'
  | 'UNRATED';

export type ExecutionAdherenceTag =
  | 'AUTO'
  | 'PLAN_FOLLOWED'
  | 'SL_MOVED_VIOLATION'
  | 'TP_MODIFIED_VIOLATION'
  | 'MANUAL_CLOSE_VALID';

export interface TradeComplianceEvaluation {
  /** Rating 1..5, or null when insufficient data exists to evaluate compliance honestly */
  rating: number | null;
  status: ComplianceStatus;
  /** Short badge label in Bahasa Indonesia */
  label: string;
  /** Transparent, audit-grade explanation of how the rating was derived */
  reason: string;
  /** Explicit disclosure if MT5 tick-by-tick SL/TP shift history is unavailable */
  auditDisclosure: string;
  /** Detected or recorded adherence tag */
  adherenceTag: ExecutionAdherenceTag;
}

const ADHERENCE_PREFIX_MAP: Record<Exclude<ExecutionAdherenceTag, 'AUTO'>, string> = {
  PLAN_FOLLOWED: '[COMPLIANCE:PLAN_FOLLOWED]',
  SL_MOVED_VIOLATION: '[COMPLIANCE:SL_MOVED_VIOLATION]',
  TP_MODIFIED_VIOLATION: '[COMPLIANCE:TP_MODIFIED_VIOLATION]',
  MANUAL_CLOSE_VALID: '[COMPLIANCE:MANUAL_CLOSE_VALID]',
};

/**
 * Extracts structured execution adherence tag from executionNotes if present.
 */
export function parseExecutionAdherenceTag(executionNotes?: string): {
  tag: ExecutionAdherenceTag;
  cleanNotes: string;
} {
  if (!executionNotes || typeof executionNotes !== 'string') {
    return { tag: 'AUTO', cleanNotes: '' };
  }
  const withoutLifecycleMeta = executionNotes.replace(/\s*\[TV_META:[A-Za-z0-9_-]+\]\s*$/, '').trim();
  for (const [tagKey, prefix] of Object.entries(ADHERENCE_PREFIX_MAP) as [
    Exclude<ExecutionAdherenceTag, 'AUTO'>,
    string
  ][]) {
    if (withoutLifecycleMeta.startsWith(prefix)) {
      return {
        tag: tagKey,
        cleanNotes: withoutLifecycleMeta.slice(prefix.length).trim(),
      };
    }
  }
  return { tag: 'AUTO', cleanNotes: withoutLifecycleMeta };
}

/**
 * Encodes structured execution adherence tag into executionNotes without altering the database schema.
 */
export function encodeExecutionAdherenceNotes(
  tag: ExecutionAdherenceTag,
  userNotes: string
): string {
  const clean = parseExecutionAdherenceTag(userNotes).cleanNotes;
  if (tag === 'AUTO') {
    return clean;
  }
  const prefix = ADHERENCE_PREFIX_MAP[tag];
  return clean ? `${prefix} ${clean}` : prefix;
}

/**
 * Evaluates a trade's compliance rating automatically based on objective plan parameters:
 * - Entry Price, Stop Loss (SL), Take Profit (TP), Exit Price, Lot Size, Realized Net Profit,
 *   Planned Risk Amount, and any recorded execution adherence tag.
 * - Never fabricates a rating when a trade lacks SL/TP/Exit data: returns rating = null ('UNRATED').
 * - Rewards closing at SL according to plan as high discipline (Patuh Rencana: Cut Loss Sesuai SL),
 *   never punishing a disciplined stop loss just because P/L is negative.
 */
export function evaluateTradeCompliance(
  trade: Partial<Trade>,
  settings?: Partial<AppSettings>
): TradeComplianceEvaluation {
  const activeSettings = { ...DEFAULT_SETTINGS, ...settings };
  const entry = Number(trade.entryPrice) || 0;
  const sl = Number(trade.stopLoss) || 0;
  const tp = Number(trade.takeProfit) || 0;
  const exit = Number(trade.exitPrice) || 0;
  const lotSize = Number(trade.lotSize) || 0;
  const netProfit = Number(trade.netProfit) || 0;
  const instrument = trade.instrument || 'XAUUSD';
  const position = trade.position || 'BUY';
  const { tag: adherenceTag } = parseExecutionAdherenceTag(trade.executionNotes);

  const auditDisclosure =
    'Catatan Audit: Evaluasi dihitung secara objektif dari harga Entry, SL, TP, Exit, dan status eksekusi yang tercatat. Riwayat pergeseran SL/TP tick-by-tick di MT5 tidak dapat dideteksi otomatis kecuali dicatat pada status eksekusi.';

  // 1. Explicit violation recorded by trader (SL moved/widened or TP modified without rule basis)
  if (adherenceTag === 'SL_MOVED_VIOLATION') {
    return {
      rating: 1,
      status: 'VIOLATION_SL',
      label: 'Pelanggaran SL (1/5)',
      reason:
        'Stop Loss digeser/diperlebar atau tidak dipatuhi saat harga bergerak berlawanan dengan rencana awal.',
      auditDisclosure,
      adherenceTag,
    };
  }

  if (adherenceTag === 'TP_MODIFIED_VIOLATION') {
    return {
      rating: 2,
      status: 'VIOLATION_TP',
      label: 'Deviasi Rencana TP (2/5)',
      reason:
        'Take Profit diubah atau transaksi ditutup prematur tanpa dasar aturan sistem trading.',
      auditDisclosure,
      adherenceTag,
    };
  }

  // 2. Check if there is enough data to evaluate objectively
  const hasEntryAndExit = entry > 0 && exit > 0;
  const hasSl = sl > 0;
  const hasTp = tp > 0;

  if (!hasEntryAndExit || (!hasSl && !hasTp && adherenceTag === 'AUTO')) {
    return {
      rating: null,
      status: 'UNRATED',
      label: 'Belum Dapat Dinilai',
      reason: !hasEntryAndExit
        ? 'Harga Entry dan Exit belum lengkap untuk memverifikasi kepatuhan eksekusi.'
        : 'Data Stop Loss (SL) dan Take Profit (TP) tidak tercatat pada transaksi ini sehingga kepatuhan terhadap rencana awal tidak dapat diverifikasi.',
      auditDisclosure,
      adherenceTag,
    };
  }

  // 3. Validate directional geometry and planned metrics
  const orderMetrics = calculateLotBasedOrderMetrics(
    {
      symbol: instrument,
      position,
      lotSize: lotSize > 0 ? lotSize : 0.01,
      entryPrice: entry,
      stopLossPrice: hasSl ? sl : null,
      takeProfitPrice: hasTp ? tp : null,
      exitPrice: exit,
    },
    activeSettings
  );

  // If trade was executed with TP but NO Stop Loss at all
  if (!hasSl && hasTp) {
    return {
      rating: 2,
      status: 'VIOLATION_NO_SL',
      label: 'Tanpa Proteksi SL (2/5)',
      reason:
        'Transaksi memiliki target TP namun dieksekusi tanpa batas Stop Loss (SL) yang terukur.',
      auditDisclosure,
      adherenceTag,
    };
  }

  const spec = getInstrumentPipSpec(instrument, activeSettings);
  const onePipPriceStep = spec.pipSize > 0 ? spec.pipSize : 0.01;

  // 4. Evaluate Take Profit adherence
  if (
    hasTp &&
    orderMetrics.isTpValid &&
    orderMetrics.tpDistancePrice !== null &&
    orderMetrics.tpDistancePrice > 0
  ) {
    const tpTolerance = Math.max(orderMetrics.tpDistancePrice * 0.12, onePipPriceStep * 1.5);
    const diffToTp = Math.abs(exit - tp);
    const reachedOrExceededTp =
      position === 'BUY' ? exit >= tp - tpTolerance : exit <= tp + tpTolerance;

    if (diffToTp <= tpTolerance || reachedOrExceededTp) {
      return {
        rating: 5,
        status: 'COMPLIANT_TP',
        label: 'Patuh Rencana — TP Tercapai (5/5)',
        reason: hasSl
          ? 'Transaksi memiliki proteksi SL & target TP yang valid, dan ditutup sesuai rencana pada area Take Profit.'
          : 'Transaksi ditutup sesuai target Take Profit.',
        auditDisclosure,
        adherenceTag,
      };
    }
  }

  // 5. Evaluate Stop Loss adherence vs Stop Loss violation
  if (
    hasSl &&
    orderMetrics.isSlValid &&
    orderMetrics.slDistancePrice !== null &&
    orderMetrics.slDistancePrice > 0
  ) {
    const slTolerance = Math.max(orderMetrics.slDistancePrice * 0.15, onePipPriceStep * 1.5);
    const diffToSl = Math.abs(exit - sl);
    const breachedBeyondSl =
      position === 'BUY' ? exit < sl - slTolerance : exit > sl + slTolerance;

    const plannedRisk =
      orderMetrics.riskAmount !== null && orderMetrics.riskAmount > 0
        ? orderMetrics.riskAmount
        : Number(trade.riskAmount) || 0;
    const realizedLossMagnitude = netProfit < 0 ? Math.abs(netProfit) : 0;
    const lossExceededPlannedRisk =
      plannedRisk > 0 && realizedLossMagnitude > plannedRisk * 1.25 + 1.0;

    if (breachedBeyondSl || lossExceededPlannedRisk) {
      return {
        rating: 1,
        status: 'VIOLATION_SL',
        label: 'Pelanggaran Batas SL (1/5)',
        reason:
          'Harga penutupan atau realisasi kerugian melampaui batas Stop Loss awal secara signifikan (indikasi SL digeser atau tidak dieksekusi tepat waktu).',
        auditDisclosure,
        adherenceTag,
      };
    }

    // Closed right at SL (within tolerance) -> High compliance! Loss at SL is disciplined trading.
    if (diffToSl <= slTolerance) {
      return {
        rating: hasTp && orderMetrics.isTpValid ? 5 : 4,
        status: 'COMPLIANT_SL',
        label:
          hasTp && orderMetrics.isTpValid
            ? 'Patuh Rencana — Disiplin SL (5/5)'
            : 'Disiplin Cut Loss SL (4/5)',
        reason:
          'Meskipun hasil transaksi rugi (Loss), eksekusi tetap patuh pada rencana manajemen risiko dengan menutup posisi tepat pada batas Stop Loss.',
        auditDisclosure,
        adherenceTag,
      };
    }
  }

  // 6. Trade closed manually between SL and TP (neither SL nor TP hit)
  if (adherenceTag === 'PLAN_FOLLOWED' || adherenceTag === 'MANUAL_CLOSE_VALID') {
    return {
      rating: 4,
      status: 'MANUAL_DISCIPLINED',
      label: 'Eksekusi Terukur (4/5)',
      reason:
        'Posisi ditutup secara terukur dalam koridor manajemen risiko sesuai aturan evaluasi posisi.',
      auditDisclosure,
      adherenceTag,
    };
  }

  if (hasSl && orderMetrics.isSlValid) {
    return {
      rating: 3,
      status: 'MANUAL_DISCIPLINED',
      label: 'Tutup Manual Sebelum Target (3/5)',
      reason:
        'Transaksi memiliki SL yang valid, namun ditutup sebelum mencapai batas Stop Loss maupun target Take Profit awal.',
      auditDisclosure,
      adherenceTag,
    };
  }

  return {
    rating: null,
    status: 'UNRATED',
    label: 'Belum Dapat Dinilai',
    reason:
      'Parameter rencana SL/TP tidak valid terhadap arah posisi sehingga kepatuhan tidak dapat dinilai secara objektif.',
    auditDisclosure,
    adherenceTag,
  };
}
