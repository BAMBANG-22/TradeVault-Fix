/**
 * Unit verification for MT5/MT4 History Screenshot Scanner, numeric parsing,
 * OCR fallback row extraction, deterministic math auditor, duplicate checks,
 * and closed trade builder (`src/utils/tradeScreenshotScanner.ts`).
 */

import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  auditMt5HistoryCandidate,
  buildClosedTradeFromMt5Candidate,
  clearMt5HistoryScanCache,
  deduplicateBatchMt5Candidates,
  detectDuplicateMt5Trade,
  normalizeChartPriceNumber,
  parseMt5HistoryRowsFromOcrText,
  parseSignedMt5Number,
  recheckDuplicateMt5Candidate,
  scanBatchMt5HistoryScreenshots,
  type Mt5HistoryTradeCandidate,
} from '../src/utils/tradeScreenshotScanner';
import {
  reconstructStructuredLinesFromWords,
  runOfflineTesseractOcr,
  terminateOfflineTesseractWorker,
} from '../src/utils/offlineMt5Ocr';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { Trade } from '../src/types/trade';
import { decodeLifecycleMetaFromExecutionNotes } from '../src/utils/tradeLifecycle';

// 1. parseSignedMt5Number: Unicode minus, accounting parens, space-thousands, comma decimals
assert.equal(parseSignedMt5Number('−45.20', false, 'XAUUSD'), -45.2);
assert.equal(parseSignedMt5Number('–12.50', false, 'EURUSD'), -12.5);
assert.equal(parseSignedMt5Number('- 45.20', false, 'XAUUSD'), -45.2);
assert.equal(parseSignedMt5Number('(125.40)', false, 'XAUUSD'), -125.4);
assert.equal(parseSignedMt5Number('1 234,50', false, 'XAUUSD'), 1234.5);
assert.equal(parseSignedMt5Number('-1 234,50', false, 'XAUUSD'), -1234.5);
assert.equal(parseSignedMt5Number('-1.234,50', false, 'XAUUSD'), -1234.5);
assert.equal(parseSignedMt5Number('1,234.50', false, 'XAUUSD'), 1234.5);
// Non-price profit on XAUUSD must NEVER trigger *1000 price heuristic
assert.equal(parseSignedMt5Number('4.50', false, 'XAUUSD'), 4.5);
// Price on XAUUSD with dot-thousands misread ("4.054" -> 4054) MUST still normalize
assert.equal(parseSignedMt5Number('4.054', true, 'XAUUSD'), 4054);
assert.equal(normalizeChartPriceNumber('4.054,405', 'XAUUSD'), 4054.405);

// 2. OCR fallback row parser: Mobile multiline dark-mode + space-thousands + Unicode minus + SL/TP/Swap/Comm + Deposit filtering
const sampleOcrMobile = `
Balance: 10 000.00
Deposit: 500.00
XAUUSD, sell 0.10
2026.11.18 14:32:10
2650.50 -> 2640.00 [tp]
S / L: 2660.00  T / P: 2640.00
Swap: -1.20  Commission: -0.70  #88392011
105.00
EURUSD, buy 0.20
18.11.2026 16:45
1.08500 -> 1.08250 [sl]
−50.00
BTCUSD, buy 0.05
91 200.00 -> 90 800.00
20.00
`;
const ocrRows = parseMt5HistoryRowsFromOcrText(sampleOcrMobile);

assert.equal(ocrRows.length, 3, 'Should ignore Balance/Deposit and extract all 3 closed trades');

assert.equal(ocrRows[0].instrument, 'XAUUSD');
assert.equal(ocrRows[0].position, 'SELL');
assert.equal(ocrRows[0].lotSize, 0.1);
assert.equal(ocrRows[0].entryPrice, 2650.5);
assert.equal(ocrRows[0].exitPrice, 2640.0);
assert.equal(ocrRows[0].stopLoss, 2660.0);
assert.equal(ocrRows[0].takeProfit, 2640.0);
assert.equal(ocrRows[0].swap, -1.2);
assert.equal(ocrRows[0].commission, 0.7);
assert.equal(ocrRows[0].ticketId, '88392011');
assert.equal(ocrRows[0].closeType, 'TP');
assert.equal(ocrRows[0].netProfit, 105.0);
assert.equal(ocrRows[0].closeDateTime, '2026-11-18T14:32');
assert.equal(ocrRows[0].ocrSignRecovered, false);

assert.equal(ocrRows[1].instrument, 'EURUSD');
assert.equal(ocrRows[1].position, 'BUY');
assert.equal(ocrRows[1].lotSize, 0.2);
assert.equal(ocrRows[1].entryPrice, 1.085);
assert.equal(ocrRows[1].exitPrice, 1.0825);
assert.equal(ocrRows[1].closeType, 'SL');
assert.equal(ocrRows[1].netProfit, -50.0);
assert.equal(ocrRows[1].closeDateTime, '2026-11-18T16:45');

// Row 3: Space-thousands prices + Dropped red '-' sign on BUY 91 200 -> 90 800 with OCR "20.00" should auto-recover to -20.00
assert.equal(ocrRows[2].instrument, 'BTCUSD');
assert.equal(ocrRows[2].entryPrice, 91200);
assert.equal(ocrRows[2].exitPrice, 90800);
assert.equal(ocrRows[2].netProfit, -20.0);
assert.equal(ocrRows[2].ocrSignRecovered, true);

// 2b. OCR parser edge cases: OCR arrow variants (- >, = >, >), #US30 / dot headers, dual open+close timestamps, and Desktop table rows
const sampleOcrVariants = `
#US30, sell 0.05
44250.00 - > 44150.00
25.00
XAUUSD. buy 0.10
2026.11.20 08:00:00   2026.11.20 11:45:22
2640.00 = > 2652.00
120.00
2026.11.20 12:00:00  #99112233  GBPUSD  buy  0.10  1.26500  2026.11.20 13:15:00  1.26800  -0.50  0.00  30.00
`;
const variantRows = parseMt5HistoryRowsFromOcrText(sampleOcrVariants);
assert.equal(variantRows.length, 3, 'Should parse OCR arrow variants, punctuation variants, and single-line desktop table rows');
assert.equal(variantRows[0].instrument, 'US30');
assert.equal(variantRows[0].entryPrice, 44250);
assert.equal(variantRows[0].exitPrice, 44150);
assert.equal(variantRows[1].closeDateTime, '2026-11-20T11:45', 'Should prefer close timestamp when open & close timestamps appear');
assert.equal(variantRows[1].exitPrice, 2652);
assert.equal(variantRows[2].instrument, 'GBPUSD');
assert.equal(variantRows[2].entryPrice, 1.265);
assert.equal(variantRows[2].exitPrice, 1.268);
assert.equal(variantRows[2].netProfit, 30.0);

// 2c. Coordinate Y-band row reconstruction keeps split left/right columns aligned on the same row
const splitColumnWords = [
  { text: '105.00', left: 720, top: 102, width: 85, height: 22, centerX: 762, centerY: 113 },
  { text: 'XAUUSD,', left: 24, top: 100, width: 110, height: 22, centerX: 79, centerY: 111 },
  { text: 'sell', left: 142, top: 100, width: 42, height: 22, centerX: 163, centerY: 111 },
  { text: '0.10', left: 192, top: 100, width: 46, height: 22, centerX: 215, centerY: 111 },
  { text: '2650.50', left: 24, top: 140, width: 90, height: 20, centerX: 69, centerY: 150 },
  { text: '->', left: 122, top: 140, width: 28, height: 20, centerX: 136, centerY: 150 },
  { text: '2640.00', left: 158, top: 140, width: 90, height: 20, centerX: 203, centerY: 150 },
];
const reconstructedLines = reconstructStructuredLinesFromWords(splitColumnWords);
assert.equal(reconstructedLines.length, 2);
assert.equal(reconstructedLines[0].text, 'XAUUSD, sell 0.10   105.00');
assert.equal(reconstructedLines[1].text, '2650.50 -> 2640.00');

// 3. Indonesian & Deals format OCR rows
const sampleOcrIndoDeals = `
GOLD jual 0.05
2645.00 -> 2652.00
-35.00
XAUUSD, buy out 0.15
2026.11.19 09:10
2640.00 -> 2648.00
120.00
XAUUSD, buy 0.10
2026.11.19 09:20
canceled
`;
const indoRows = parseMt5HistoryRowsFromOcrText(sampleOcrIndoDeals);
assert.equal(indoRows.length, 2, 'Should skip canceled order and parse Indonesian/Deals rows');
assert.equal(indoRows[0].instrument, 'XAUUSD');
assert.equal(indoRows[0].position, 'SELL');
assert.equal(indoRows[0].netProfit, -35.0);
assert.equal(indoRows[1].position, 'BUY');
assert.equal(indoRows[1].netProfit, 120.0);

// 4. Deterministic Math Auditor: clean trades & edge-case brokers pass without false positives
const cleanXauStd = auditMt5HistoryCandidate({
  instrument: 'XAUUSD',
  position: 'BUY',
  lotSize: 0.1,
  entryPrice: 2640.0,
  exitPrice: 2650.0,
  stopLoss: 2635.0,
  takeProfit: 2650.0,
  netProfit: 100.0,
  closeType: 'TP',
});
assert.equal(cleanXauStd.status, 'OK');
assert.equal(cleanXauStd.issues.length, 0);

// XAUUSD mini / 10 oz broker spec (e.g., 10 points * 0.10 lot * 10 = $10) should also pass OK
const cleanXauMini = auditMt5HistoryCandidate({
  instrument: 'XAUUSD',
  position: 'BUY',
  lotSize: 0.1,
  entryPrice: 2640.0,
  exitPrice: 2650.0,
  netProfit: 10.0,
});
assert.equal(cleanXauMini.status, 'OK');

const cleanEurUsd = auditMt5HistoryCandidate({
  instrument: 'EURUSD',
  position: 'SELL',
  lotSize: 0.2,
  entryPrice: 1.085,
  exitPrice: 1.082,
  netProfit: 60.0,
});
assert.equal(cleanEurUsd.status, 'OK');

const cleanUsdJpy = auditMt5HistoryCandidate({
  instrument: 'USDJPY',
  position: 'BUY',
  lotSize: 0.1,
  entryPrice: 154.0,
  exitPrice: 154.5,
  netProfit: 32.36,
});
assert.equal(cleanUsdJpy.status, 'OK');

// 5. Auditor catches SIGN_MISMATCH, PRICE_JUMP_EXTREME, MAGNITUDE_MISMATCH, SL_TP_INVALID, CLOSE_TYPE_PROFIT_CONFLICT
const signMismatchAudit = auditMt5HistoryCandidate({
  instrument: 'XAUUSD',
  position: 'BUY',
  lotSize: 0.1,
  entryPrice: 2650.0,
  exitPrice: 2640.0,
  netProfit: 100.0, // Should be negative
});
assert.equal(signMismatchAudit.status, 'ERROR');
const signIssue = signMismatchAudit.issues.find((i) => i.code === 'SIGN_MISMATCH');
assert.ok(signIssue, 'Should flag SIGN_MISMATCH');
assert.equal(signIssue?.suggestedNetProfit, -100);
assert.equal(signIssue?.suggestedPosition, 'SELL');
assert.equal(signIssue?.canSwapEntryExit, true);

const extremeJumpAudit = auditMt5HistoryCandidate({
  instrument: 'XAUUSD',
  position: 'BUY',
  lotSize: 0.1,
  entryPrice: 2650.0,
  exitPrice: 265.0, // Cut digit!
  netProfit: 10.0,
});
assert.equal(extremeJumpAudit.status, 'ERROR');
assert.ok(extremeJumpAudit.issues.some((i) => i.code === 'PRICE_JUMP_EXTREME'));

const magnitudeAudit = auditMt5HistoryCandidate({
  instrument: 'EURUSD',
  position: 'BUY',
  lotSize: 0.01,
  entryPrice: 1.08,
  exitPrice: 1.082, // 20 pips = $2 standard, reported $200 = 100x mismatch!
  netProfit: 200.0,
});
assert.equal(magnitudeAudit.status, 'WARNING');
assert.ok(magnitudeAudit.issues.some((i) => i.code === 'MAGNITUDE_MISMATCH'));

const slTpInvalidAudit = auditMt5HistoryCandidate({
  instrument: 'XAUUSD',
  position: 'BUY',
  lotSize: 0.1,
  entryPrice: 2650.0,
  exitPrice: 2660.0,
  stopLoss: 2655.0, // Invalid SL above Entry for BUY!
  takeProfit: 2660.0,
  netProfit: 100.0,
});
assert.equal(slTpInvalidAudit.status, 'WARNING');
assert.ok(slTpInvalidAudit.issues.some((i) => i.code === 'SL_TP_INVALID'));

const closeTypeConflictAudit = auditMt5HistoryCandidate({
  instrument: 'XAUUSD',
  position: 'SELL',
  lotSize: 0.1,
  entryPrice: 2640.0,
  exitPrice: 2645.0,
  netProfit: -50.0,
  closeType: 'TP',
});
assert.equal(closeTypeConflictAudit.status, 'WARNING');
assert.ok(closeTypeConflictAudit.issues.some((i) => i.code === 'CLOSE_TYPE_PROFIT_CONFLICT'));

// 5b. Edge case: Commission immediately preceding profit without #ticket in between
const adjacentCommRows = parseMt5HistoryRowsFromOcrText(`
XAUUSD, buy 0.10
2640.00 -> 2650.00
Commission: -0.70   105.00
`);
assert.equal(adjacentCommRows.length, 1);
assert.equal(adjacentCommRows[0].commission, 0.7);
assert.equal(adjacentCommRows[0].netProfit, 105.0);

// 6. Duplicate detection, live recheck & batch deduplication + trade builder
const existingTrade: Trade = {
  id: 'MT5-99001122',
  dateTime: '2026-11-18T14:32',
  instrument: 'XAUUSD',
  position: 'BUY',
  session: 'London',
  strategy: 'MT5 History Scan',
  lotSize: 0.1,
  entryPrice: 2640.0,
  exitPrice: 2650.0,
  grossProfit: 100.0,
  commission: 0,
  swap: 0,
  netProfit: 100.0,
  riskAmount: 0,
  riskPercentage: 0,
  outcome: 'WIN',
  createdAt: '2026-11-18T14:32:00.000Z',
};

const dupByTicket = detectDuplicateMt5Trade(
  {
    ticketId: '99001122',
    instrument: 'XAUUSD',
    position: 'BUY',
    lotSize: 0.1,
    entryPrice: 2640.0,
    exitPrice: 2650.0,
    netProfit: 100.0,
    closeDateTime: '2026-11-18T14:32',
  },
  [existingTrade]
);
assert.equal(dupByTicket, 'MT5-99001122');

const baseCand: Mt5HistoryTradeCandidate = {
  tempId: 'tmp-1',
  ticketId: null,
  instrument: 'XAUUSD',
  position: 'BUY',
  lotSize: 0.1,
  entryPrice: 2640.0,
  exitPrice: 2650.0,
  stopLoss: 2635.0,
  takeProfit: 2650.0,
  commission: 0.7,
  swap: -0.3,
  netProfit: 99.0,
  openDateTime: null,
  closeDateTime: '2026-11-18T14:32',
  closeType: 'TP',
  notes: '',
  strategy: 'MT5 History Scan',
  session: 'London',
  isDuplicate: false,
  selected: true,
};

const recheckedNotDup = recheckDuplicateMt5Candidate(baseCand, [existingTrade]);
assert.equal(recheckedNotDup.isDuplicate, false);

const recheckedIsDup = recheckDuplicateMt5Candidate(
  { ...baseCand, netProfit: 100.0 },
  [existingTrade]
);
assert.equal(recheckedIsDup.isDuplicate, true);
assert.equal(recheckedIsDup.duplicateMatchId, 'MT5-99001122');

const deduped = deduplicateBatchMt5Candidates([
  { ...baseCand, tempId: 'a', ticketId: '555' },
  { ...baseCand, tempId: 'b', ticketId: '555' },
  { ...baseCand, tempId: 'c', ticketId: null, entryPrice: 2642.0 },
  { ...baseCand, tempId: 'd', ticketId: null, entryPrice: 2642.0 },
]);
assert.equal(deduped.length, 2, 'Should deduplicate both by ticketId and by fingerprint');

const usedIds = new Set<string>(['mt5-99001122']);
const builtTrade = buildClosedTradeFromMt5Candidate(
  { ...baseCand, ticketId: '777888', commission: 1.0, swap: -0.5, netProfit: -45.5 },
  usedIds,
  DEFAULT_SETTINGS
);
assert.equal(builtTrade.id, 'MT5-777888');
const builtMeta = decodeLifecycleMetaFromExecutionNotes(builtTrade.executionNotes);
assert.equal(builtMeta.status, 'CLOSED');
assert.equal(builtMeta.closeType, 'TP');
assert.equal(builtTrade.outcome, 'LOSS');
assert.equal(builtTrade.netProfit, -45.5);
// grossProfit = net + comm - swap = -45.5 + 1.0 - (-0.5) = -44.0
assert.equal(builtTrade.grossProfit, -44.0);

// 7. End-to-End Offline Tesseract WASM OCR Test on Pure-Node Rasterized MT5 PNG Pixels
const GLYPH_7X9: Record<string, string[]> = {
  ' ': ['0000000', '0000000', '0000000', '0000000', '0000000', '0000000', '0000000', '0000000', '0000000'],
  ',': ['0000000', '0000000', '0000000', '0000000', '0000000', '0000000', '0011000', '0011000', '0110000'],
  '.': ['0000000', '0000000', '0000000', '0000000', '0000000', '0000000', '0000000', '0011000', '0011000'],
  '-': ['0000000', '0000000', '0000000', '0000000', '1111110', '0000000', '0000000', '0000000', '0000000'],
  '>': ['0000000', '0000000', '1100000', '0011000', '0000110', '0011000', '1100000', '0000000', '0000000'],
  '0': ['0011100', '0110110', '1100011', '1100011', '1100011', '1100011', '1100011', '0110110', '0011100'],
  '1': ['0001100', '0011100', '0111100', '0001100', '0001100', '0001100', '0001100', '0001100', '0111111'],
  '2': ['0111110', '1100011', '0000011', '0000110', '0001100', '0011000', '0110000', '1100000', '1111111'],
  '3': ['0111110', '1100011', '0000011', '0000011', '0011110', '0000011', '0000011', '1100011', '0111110'],
  '4': ['0000110', '0001110', '0011110', '0110110', '1100110', '1111111', '0000110', '0000110', '0000110'],
  '5': ['1111111', '1100000', '1100000', '1111110', '0000011', '0000011', '0000011', '1100011', '0111110'],
  '6': ['0011110', '0110000', '1100000', '1111110', '1100011', '1100011', '1100011', '1100011', '0111110'],
  '7': ['1111111', '0000011', '0000110', '0001100', '0001100', '0011000', '0011000', '0011000', '0011000'],
  '8': ['0111110', '1100011', '1100011', '1100011', '0111110', '1100011', '1100011', '1100011', '0111110'],
  '9': ['0111110', '1100011', '1100011', '1100011', '0111111', '0000011', '0000011', '0000110', '0111100'],
  A: ['0011100', '0110110', '1100011', '1100011', '1111111', '1100011', '1100011', '1100011', '1100011'],
  D: ['1111100', '1100110', '1100011', '1100011', '1100011', '1100011', '1100011', '1100110', '1111100'],
  S: ['0111110', '1100011', '1100000', '0110000', '0011100', '0000110', '0000011', '1100011', '0111110'],
  U: ['1100011', '1100011', '1100011', '1100011', '1100011', '1100011', '1100011', '1100011', '0111110'],
  X: ['1100011', '1100011', '0110110', '0011100', '0011100', '0011100', '0110110', '1100011', '1100011'],
  b: ['1100000', '1100000', '1100000', '1111110', '1100011', '1100011', '1100011', '1100011', '1111110'],
  u: ['0000000', '0000000', '0000000', '1100011', '1100011', '1100011', '1100011', '1100111', '0111011'],
  y: ['0000000', '0000000', '0000000', '1100011', '1100011', '1100011', '0111111', '0000011', '0111110'],
};

function crc32Png(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32Png(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function renderLinesToWhitePngDataUrl(textLines: string[]): string {
  const scale = 3;
  const charAdvance = 9 * scale;
  const lineAdvance = 16 * scale;
  const pad = 48;
  const maxCols = Math.max(...textLines.map((l) => l.length));
  const width = pad * 2 + maxCols * charAdvance;
  const height = pad * 2 + textLines.length * lineAdvance;

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // PNG filter type 0
  }

  for (let li = 0; li < textLines.length; li++) {
    const line = textLines[li];
    const baseY = pad + li * lineAdvance;
    for (let ci = 0; ci < line.length; ci++) {
      const glyph = GLYPH_7X9[line[ci]] || GLYPH_7X9[' '];
      const baseX = pad + ci * charAdvance;
      for (let gy = 0; gy < 9; gy++) {
        for (let gx = 0; gx < 7; gx++) {
          if (glyph[gy][gx] !== '1') continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const py = baseY + gy * scale + sy;
              const px = baseX + gx * scale + sx;
              const off = py * stride + 1 + px * 3;
              raw[off] = 15;
              raw[off + 1] = 23;
              raw[off + 2] = 42;
            }
          }
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const idat = deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const pngBuf = Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${pngBuf.toString('base64')}`;
}

async function runOfflineOcrEndToEndChecks() {
  clearMt5HistoryScanCache();

  const syntheticMt5DataUrl = renderLinesToWhitePngDataUrl([
    'XAUUSD, buy 0.10',
    '2640.00 -> 2650.00',
    '100.00',
  ]);

  const pngBase64 = syntheticMt5DataUrl.split(',')[1];
  const pngBuffer = Buffer.from(pngBase64, 'base64');

  const directOcr = await runOfflineTesseractOcr(pngBuffer, { psm: '6' });
  assert.ok(
    directOcr.fullText.toUpperCase().includes('XAUUSD'),
    `Expected XAUUSD in OCR output, got: ${directOcr.fullText}`
  );

  const batchOfflineRes = await scanBatchMt5HistoryScreenshots(
    [{ imageDataUrl: syntheticMt5DataUrl, sourceImageIndex: 0 }],
    { mode: 'offline' }
  );
  assert.equal(batchOfflineRes.source, 'MT5_HISTORY_OFFLINE');
  assert.equal(batchOfflineRes.perImageOutcomes[0]?.scanEngine, 'offline-ocr');
  assert.equal(batchOfflineRes.trades.length, 1, 'Offline batch scan should extract 1 closed XAUUSD trade from PNG pixels');
  const extracted = batchOfflineRes.trades[0];
  assert.equal(extracted.instrument, 'XAUUSD');
  assert.equal(extracted.position, 'BUY');
  assert.equal(extracted.lotSize, 0.1);
  assert.equal(extracted.entryPrice, 2640);
  assert.equal(extracted.exitPrice, 2650);
  assert.equal(extracted.netProfit, 100);

  // Verify auditor passes on the OCR-extracted trade
  const auditRes = auditMt5HistoryCandidate(extracted, DEFAULT_SETTINGS);
  assert.equal(auditRes.status, 'OK');

  // Verify instant offline cache hit on repeat scan
  const cachedRes = await scanBatchMt5HistoryScreenshots(
    [{ imageDataUrl: syntheticMt5DataUrl, sourceImageIndex: 0 }],
    { mode: 'offline' }
  );
  assert.equal(cachedRes.cacheHitsCount, 1);
  assert.equal(cachedRes.perImageOutcomes[0]?.scanEngine, 'cache');

  await terminateOfflineTesseractWorker();
  clearMt5HistoryScanCache();
  console.log('ALL MT5 HISTORY SCANNER & OFFLINE TESSERACT OCR TESTS PASSED!');
}

runOfflineOcrEndToEndChecks().catch(async (err) => {
  await terminateOfflineTesseractWorker();
  console.error(err);
  process.exit(1);
});

