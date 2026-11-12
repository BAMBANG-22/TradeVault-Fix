import {
  CsvImportReport,
  CsvRowValidationError,
  Trade,
  TradeOutcome,
  TradePosition,
} from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import {
  classifyNetProfitOutcome,
  computeGrossFromNet,
  computeRealizedRMultiple,
} from './calculations';
import { calculateLotBasedOrderMetrics } from './riskCalculator';
import { normalizeTradeDateTimeLocal } from './supabaseSync';
import { exportFile, ExportResult } from './fileExport';

const FORMULA_INJECTION_PREFIX_REGEX = /^[\s]*[=+\-@]/;

/**
 * Escapes a value into an RFC 4180 quoted CSV cell and neutralizes spreadsheet formula injection
 * (`=`, `+`, `-`, `@` on non-numeric text fields) by prefixing a single quote `'`.
 */
export function escapeCsvCell(val: unknown, isNumericField: boolean = false): string {
  if (val === undefined || val === null || val === '') return '""';
  let str = String(val);
  if (!isNumericField && typeof val !== 'number' && typeof val !== 'boolean') {
    if (FORMULA_INJECTION_PREFIX_REGEX.test(str)) {
      const trimmed = str.trim();
      const isSignedNumber = /^[+-]?\d+(\.\d+)?$/.test(trimmed);
      if (!isSignedNumber) {
        str = `'${str}`;
      }
    }
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Unescapes a formula-escaped text cell if it was prefixed with `'` before `=`, `+`, `-`, `@`.
 */
export function unescapeFormulaSafeText(raw: string): string {
  if (raw.length >= 2 && raw[0] === "'" && /^[=+\-@]/.test(raw.slice(1).trimStart())) {
    return raw.slice(1);
  }
  return raw;
}

/**
 * Exports all 28 fields of Trade records to an RFC 4180 compliant CSV string.
 */
export function exportTradesToCsv(trades: Trade[]): string {
  const headers = [
    'ID',
    'Tanggal & Waktu',
    'Instrumen',
    'Posisi',
    'Setup / Strategi',
    'Sesi',
    'Entry Price',
    'Stop Loss',
    'Take Profit',
    'Exit Price',
    'Lot Size',
    'Risk Amount',
    'Risk %',
    'Hasil (Outcome)',
    'Gross Profit',
    'Komisi',
    'Swap',
    'Net Profit',
    'R-Multiple',
    'Rating Disiplin',
    'Catatan',
    'Alasan Entry',
    'Evaluasi Pasca-Trade',
    'Catatan Eksekusi',
    'Screenshot URL',
    'Is Demo',
    'Created At',
    'Updated At',
  ];

  const rows = trades.map((t) => [
    escapeCsvCell(t.id, false),
    escapeCsvCell(t.dateTime, false),
    escapeCsvCell(t.instrument, false),
    escapeCsvCell(t.position, false),
    escapeCsvCell(t.strategy, false),
    escapeCsvCell(t.session ?? '', false),
    escapeCsvCell(t.entryPrice, true),
    escapeCsvCell(t.stopLoss ?? '', true),
    escapeCsvCell(t.takeProfit ?? '', true),
    escapeCsvCell(t.exitPrice ?? '', true),
    escapeCsvCell(t.lotSize, true),
    escapeCsvCell(t.riskAmount, true),
    escapeCsvCell(t.riskPercentage, true),
    escapeCsvCell(t.outcome, false),
    escapeCsvCell(t.grossProfit, true),
    escapeCsvCell(t.commission, true),
    escapeCsvCell(t.swap, true),
    escapeCsvCell(t.netProfit, true),
    escapeCsvCell(t.rMultiple ?? '', true),
    escapeCsvCell(t.disciplineRating ?? '', true),
    escapeCsvCell(t.notes ?? '', false),
    escapeCsvCell(t.entryReason ?? '', false),
    escapeCsvCell(t.postTradeEvaluation ?? '', false),
    escapeCsvCell(t.executionNotes ?? '', false),
    escapeCsvCell(t.screenshotUrl ?? '', false),
    escapeCsvCell(Boolean(t.isDemo), false),
    escapeCsvCell(t.createdAt ?? '', false),
    escapeCsvCell(t.updatedAt ?? '', false),
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  return csvContent;
}

export async function downloadCsvFile(
  csvContent: string,
  filename: string = 'TradeVault_Journal.csv'
): Promise<ExportResult> {
  return exportFile({
    data: '\uFEFF' + csvContent,
    fileName: filename,
    mimeType: 'text/csv;charset=utf-8;',
  });
}

export interface CsvImportResult extends CsvImportReport {
  success: boolean;
  validTrades: Trade[];
  trades: Trade[];
  errors: string[];
}

/**
 * Full RFC 4180 state-machine CSV tokenizer that supports embedded commas, escaped quotes (`""`),
 * and multi-line newlines inside quoted cells.
 */
function tokenizeCsvDocument(csvText: string): string[][] {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleanText[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell);
        currentCell = '';
      } else if (ch === '\r') {
        if (cleanText[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentCell);
        if (currentRow.some((c) => c.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else if (ch === '\n') {
        currentRow.push(currentCell);
        if (currentRow.some((c) => c.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  currentRow.push(currentCell);
  if (currentRow.some((c) => c.trim().length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Strict numeric parser for CSV cells:
 * - Preserves valid 0 and negative numbers (e.g. "-2.5", "0", "$1,250.50").
 * - Never coerces malformed non-numeric text (e.g. "abc", "NaN", "Infinity") into 0.
 */
function parseStrictCsvNumber(
  rawCell: string | undefined
): { isEmpty: boolean; isValid: boolean; value?: number } {
  if (rawCell === undefined || rawCell === null) {
    return { isEmpty: true, isValid: true };
  }
  const trimmed = rawCell.trim();
  if (trimmed === '') {
    return { isEmpty: true, isValid: true };
  }

  // Strip optional currency symbol ($/Rp/€) and thousand-separator commas ONLY if the rest is a strict decimal number
  const normalized = trimmed.replace(/^[$€£]\s*/, '').replace(/^Rp\s*/i, '').replace(/,/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
    return { isEmpty: false, isValid: false };
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return { isEmpty: false, isValid: false };
  }

  return { isEmpty: false, isValid: true, value: num };
}

export function parseCsvToTrades(
  csvText: string,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS,
  activeCapitalBasis?: number
): CsvImportResult {
  const trimmedInput = (csvText || '').trim();

  // Support MT5 EA JSON Export payload if user pastes or uploads JSON array/object in MT5/CSV importer
  if (trimmedInput.startsWith('{') || trimmedInput.startsWith('[')) {
    try {
      const parsedJson = JSON.parse(trimmedInput);
      const rowsArray = Array.isArray(parsedJson)
        ? parsedJson
        : Array.isArray(parsedJson?.trades)
        ? parsedJson.trades
        : Array.isArray(parsedJson?.deals)
        ? parsedJson.deals
        : null;
      if (rowsArray && rowsArray.length > 0) {
        const accountBalance =
          Number(parsedJson?.accountBalance || parsedJson?.balance) ||
          activeCapitalBasis ||
          settings.startingBalance ||
          10000;
        const accountEquity =
          Number(parsedJson?.accountEquity || parsedJson?.equity) || accountBalance;
        const basisVal =
          (settings.riskCapitalBasis || 'EQUITY') === 'BALANCE' ? accountBalance : accountEquity;

        const validTrades: Trade[] = [];
        const errors: string[] = [];
        const rowErrors: CsvRowValidationError[] = [];

        rowsArray.forEach((item: any, idx: number) => {
          const rowNum = idx + 1;
          const id = String(item.id || item.ticket || item.positionId || `MT5-${Date.now()}-${rowNum}`);
          const rawDir = String(item.position || item.direction || item.type || 'BUY').toUpperCase();
          const position: TradePosition = rawDir.includes('SELL') || rawDir.includes('SHORT') ? 'SELL' : 'BUY';
          const entryPrice = Number(
            item.entryPrice ?? item.openPrice ?? item.price_open ?? item.entry ?? item.price
          );
          const lotSize = Number(item.lotSize ?? item.lot ?? item.volume ?? 0.01);
          if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(lotSize) || lotSize <= 0) {
            rowErrors.push({
              rowNumber: rowNum,
              tradeId: id,
              field: 'entryPrice/lotSize',
              rawValue: `${entryPrice}/${lotSize}`,
              reason: 'Entry Price dan Lot Size wajib positif (> 0).',
            });
            errors.push(`Baris ${rowNum}: Entry Price / Lot Size tidak valid.`);
            return;
          }
          const stopLoss = Number(item.stopLoss ?? item.sl ?? 0) || 0;
          const takeProfit = Number(item.takeProfit ?? item.tp ?? 0) || 0;
          const exitPrice =
            item.exitPrice !== undefined ||
            item.closePrice !== undefined ||
            item.price_close !== undefined
              ? Number(item.exitPrice ?? item.closePrice ?? item.price_close) || undefined
              : undefined;
          const commission = Math.abs(Number(item.commission ?? 0) || 0);
          const swap = Number(item.swap ?? 0) || 0;
          const instrument = String(item.instrument || item.symbol || 'XAUUSD').toUpperCase();

          const orderCalc = calculateLotBasedOrderMetrics(
            {
              symbol: instrument,
              position,
              lotSize,
              entryPrice,
              stopLossPrice: stopLoss > 0 ? stopLoss : undefined,
              takeProfitPrice: takeProfit > 0 ? takeProfit : undefined,
              exitPrice,
              capitalBasisAmount: basisVal,
              customSpecOverride: item.contractSize
                ? {
                    contractSize: Number(item.contractSize),
                    ...(item.tickSize ? { tickSize: Number(item.tickSize) } : {}),
                    ...(item.tickValue ? { tickValue: Number(item.tickValue) } : {}),
                    ...(item.digits !== undefined ? { digits: Number(item.digits) } : {}),
                  }
                : undefined,
            },
            settings
          );

          const riskAmount =
            item.riskAmount !== undefined && Number.isFinite(Number(item.riskAmount))
              ? Number(item.riskAmount)
              : orderCalc.riskAmount ?? 0;
          const riskPercentage =
            item.riskPercentage !== undefined && Number.isFinite(Number(item.riskPercentage))
              ? Number(item.riskPercentage)
              : orderCalc.riskPercentage ?? 0;

          const hasActualNet = item.netProfit !== undefined || item.profit !== undefined;
          const hasActualGross = item.grossProfit !== undefined;
          let netProfit = 0;
          let grossProfit = 0;
          if (hasActualGross) {
            grossProfit = Number(Number(item.grossProfit).toFixed(2));
            netProfit = Number((grossProfit - commission + swap).toFixed(2));
          } else if (hasActualNet) {
            const rawProfit = Number(item.netProfit ?? item.profit ?? 0);
            // In MT5 Deals/Positions export, "Profit" is gross deal profit before Commission & Swap unless netProfit is specified
            if (item.netProfit !== undefined) {
              netProfit = Number(rawProfit.toFixed(2));
              grossProfit = computeGrossFromNet(netProfit, commission, swap);
            } else {
              grossProfit = Number(rawProfit.toFixed(2));
              netProfit = Number((grossProfit - commission + swap).toFixed(2));
            }
          } else if (orderCalc.realizedNetProfit !== null) {
            grossProfit = orderCalc.realizedGrossProfit ?? 0;
            netProfit = orderCalc.realizedNetProfit;
          }

          const outcome = classifyNetProfitOutcome(netProfit);
          const rMultiple =
            computeRealizedRMultiple({
              netProfit,
              grossProfit,
              commission,
              swap,
              riskAmount,
            }) ?? undefined;

          validTrades.push({
            id,
            dateTime: normalizeTradeDateTimeLocal(
              item.dateTime || item.openTime || item.closeTime || new Date().toISOString()
            ),
            instrument,
            position,
            strategy: String(item.strategy || item.setup || 'MT5 Import'),
            session: item.session || undefined,
            entryPrice,
            stopLoss,
            takeProfit,
            exitPrice,
            lotSize,
            riskAmount,
            riskPercentage,
            outcome,
            grossProfit,
            commission,
            swap,
            netProfit,
            rMultiple,
            notes: String(item.notes || item.comment || ''),
          });
        });

        return {
          success: validTrades.length > 0,
          validTrades,
          trades: validTrades,
          errors,
          totalRows: rowsArray.length,
          acceptedRowsCount: validTrades.length,
          rejectedRowsCount: rowErrors.length,
          rowErrors,
        };
      }
    } catch {
      // Fall through to standard RFC 4180 CSV parser
    }
  }

  const rows = tokenizeCsvDocument(csvText || '');
  if (rows.length < 2) {
    return {
      success: false,
      validTrades: [],
      trades: [],
      errors: ['File CSV kosong atau tidak memiliki baris data.'],
      totalRows: 0,
      acceptedRowsCount: 0,
      rejectedRowsCount: 0,
      rowErrors: [],
    };
  }

  const headerRow = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const findExactOrIncludes = (exactList: string[], includeKeywords: string[]) => {
    const exactIdx = headerRow.findIndex((h) => exactList.includes(h));
    if (exactIdx !== -1) return exactIdx;
    return headerRow.findIndex((h) => includeKeywords.some((k) => h.includes(k)));
  };

  const idxId = findExactOrIncludes(['id', 'tradeid', 'ticket', 'order', 'deal'], ['id', 'tradeid', 'ticket', 'order']);
  const idxDate = findExactOrIncludes(
    ['tanggalwaktu', 'datetime', 'tanggal', 'date', 'opentime', 'time'],
    ['date', 'tanggal', 'waktu', 'time']
  );
  const idxInstrument = findExactOrIncludes(['instrumen', 'instrument', 'symbol', 'pair'], ['instrument', 'instrumen', 'symbol', 'pair']);
  const idxPosition = findExactOrIncludes(['posisi', 'position', 'direction', 'side', 'type'], ['posisi', 'position', 'type', 'arah', 'side']);
  const idxStrategy = findExactOrIncludes(['setupstrategi', 'setup', 'strategy', 'strategi'], ['setup', 'strategy', 'strategi']);
  const idxSession = findExactOrIncludes(['sesi', 'session', 'tradingsession'], ['sesi', 'session']);
  const idxEntry = findExactOrIncludes(['entryprice', 'entry', 'open', 'openprice', 'price'], ['entry', 'open', 'buyprice', 'sellprice', 'price']);
  const idxSl = findExactOrIncludes(['stoploss', 'sl', 'stop'], ['sl', 'stoploss', 'stop']);
  const idxTp = findExactOrIncludes(['takeprofit', 'tp', 'target'], ['tp', 'takeprofit', 'target']);
  const idxExit = findExactOrIncludes(['exitprice', 'exit', 'closeprice', 'close'], ['exit', 'closeprice', 'close']);
  const idxLot = findExactOrIncludes(['lotsize', 'lot', 'volume', 'size', 'lots'], ['lot', 'lotsize', 'volume', 'size']);
  const idxRisk = findExactOrIncludes(['riskamount', 'risk', 'risiko'], ['riskamount', 'risiko']);
  const idxRiskFallback = idxRisk !== -1 ? idxRisk : headerRow.findIndex((h) => h === 'risk');
  const idxRiskPct = findExactOrIncludes(['risk', 'riskpercent', 'riskpct', 'persen'], ['riskpercent', 'riskpct', 'persen']);
  const idxOutcome = findExactOrIncludes(['hasiloutcome', 'hasil', 'outcome', 'result'], ['hasil', 'outcome', 'result', 'status']);
  const idxGross = findExactOrIncludes(['grossprofit', 'grosspnl', 'gross'], ['grossprofit', 'gross']);
  const idxCommission = findExactOrIncludes(['komisi', 'commission', 'fee'], ['komisi', 'commission']);
  const idxSwap = findExactOrIncludes(['swap', 'overnightswap'], ['swap']);
  const idxNet = findExactOrIncludes(['netprofit', 'netpnl', 'profit', 'pnl', 'net'], ['netprofit', 'profit', 'pnl', 'net', 'cuan', 'rugi']);
  const idxRMultiple = findExactOrIncludes(['rmultiple', 'realizedr'], ['rmultiple']);
  const idxDiscipline = findExactOrIncludes(['ratingdisiplin', 'disciplinerating', 'disiplin'], ['ratingdisiplin', 'disciplinerating']);
  const idxNotes = findExactOrIncludes(['catatan', 'notes', 'comment'], ['catatan', 'notes', 'comment']);
  const idxEntryReason = findExactOrIncludes(['alasanentry', 'entryreason'], ['alasanentry', 'entryreason']);
  const idxPostEval = findExactOrIncludes(['evaluasipascatrade', 'posttradeevaluation'], ['evaluasipascatrade', 'posttradeevaluation']);
  const idxExecNotes = findExactOrIncludes(['catataneksekusi', 'executionnotes'], ['catataneksekusi', 'executionnotes']);
  const idxScreenshot = findExactOrIncludes(['screenshoturl', 'screenshot'], ['screenshoturl', 'screenshot']);
  const idxIsDemo = findExactOrIncludes(['isdemo', 'demo'], ['isdemo']);
  const idxCreatedAt = findExactOrIncludes(['createdat'], ['createdat']);
  const idxUpdatedAt = findExactOrIncludes(['updatedat'], ['updatedat']);

  const validTrades: Trade[] = [];
  const errors: string[] = [];
  const rowErrors: CsvRowValidationError[] = [];

  const rejectRow = (
    rowNumber: number,
    tradeId: string | undefined,
    field: string,
    rawValue: string,
    reason: string
  ) => {
    rowErrors.push({
      rowNumber,
      tradeId,
      field,
      rawValue,
      reason,
    });
    errors.push(`Baris ${rowNumber} (${field}): ${reason} [nilai: "${rawValue || 'kosong'}"]`);
  };

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length === 0 || cols.every((c) => c.trim() === '')) continue;

    const rowNum = i + 1;
    const getCell = (idx: number): string | undefined =>
      idx !== -1 && idx < cols.length ? cols[idx].trim() : undefined;

    const rawId = getCell(idxId);
    const id = rawId ? unescapeFormulaSafeText(rawId) : `CSV-${Date.now()}-${i}`;

    const dateRaw = getCell(idxDate);
    if (idxDate !== -1 && dateRaw) {
      const normalizedMt5Date = dateRaw.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3');
      const testDate = new Date(normalizedMt5Date);
      if (isNaN(testDate.getTime()) && !/^\d{4}-\d{2}-\d{2}/.test(normalizedMt5Date)) {
        rejectRow(rowNum, id, 'dateTime', dateRaw, 'Format Tanggal & Waktu tidak valid.');
        continue;
      }
    }
    const normalizedRawDate = dateRaw
      ? dateRaw.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3')
      : new Date().toISOString();
    const dateTime = normalizeTradeDateTimeLocal(normalizedRawDate);

    const rawInst = getCell(idxInstrument);
    const instrument = rawInst ? unescapeFormulaSafeText(rawInst).toUpperCase() : 'XAUUSD';

    let position: TradePosition = 'BUY';
    const rawPos = getCell(idxPosition);
    if (rawPos) {
      const p = rawPos.toLowerCase();
      if (p.includes('sell') || p.includes('jual') || p.includes('short')) {
        position = 'SELL';
      } else if (p.includes('buy') || p.includes('beli') || p.includes('long')) {
        position = 'BUY';
      } else {
        rejectRow(rowNum, id, 'position', rawPos, 'Posisi harus berupa BUY atau SELL.');
        continue;
      }
    }

    const rawStrategy = getCell(idxStrategy);
    const strategy = rawStrategy ? unescapeFormulaSafeText(rawStrategy) : 'Umum / Standard';

    const rawSession = getCell(idxSession);
    const session = rawSession ? unescapeFormulaSafeText(rawSession) : undefined;

    // Entry Price (Required > 0)
    const entryParsed = parseStrictCsvNumber(getCell(idxEntry));
    if (entryParsed.isEmpty || !entryParsed.isValid || entryParsed.value === undefined || entryParsed.value <= 0) {
      rejectRow(
        rowNum,
        id,
        'entryPrice',
        getCell(idxEntry) ?? '',
        'Entry Price wajib berupa angka positif (> 0).'
      );
      continue;
    }
    const entryPrice = entryParsed.value;

    // Stop Loss (Optional >= 0)
    const slParsed = parseStrictCsvNumber(getCell(idxSl));
    if (!slParsed.isValid) {
      rejectRow(rowNum, id, 'stopLoss', getCell(idxSl) ?? '', 'Stop Loss bukan angka valid.');
      continue;
    }
    const stopLoss = slParsed.isEmpty ? 0 : slParsed.value!;

    // Take Profit (Optional >= 0)
    const tpParsed = parseStrictCsvNumber(getCell(idxTp));
    if (!tpParsed.isValid) {
      rejectRow(rowNum, id, 'takeProfit', getCell(idxTp) ?? '', 'Take Profit bukan angka valid.');
      continue;
    }
    const takeProfit = tpParsed.isEmpty ? 0 : tpParsed.value!;

    // Exit Price (Optional)
    const exitParsed = parseStrictCsvNumber(getCell(idxExit));
    if (!exitParsed.isValid) {
      rejectRow(rowNum, id, 'exitPrice', getCell(idxExit) ?? '', 'Exit Price bukan angka valid.');
      continue;
    }
    const exitPrice = exitParsed.isEmpty ? undefined : exitParsed.value;

    // Lot Size (> 0, default 0.1 if omitted)
    const lotParsed = parseStrictCsvNumber(getCell(idxLot));
    if (!lotParsed.isValid || (!lotParsed.isEmpty && lotParsed.value! <= 0)) {
      rejectRow(
        rowNum,
        id,
        'lotSize',
        getCell(idxLot) ?? '',
        'Lot Size harus berupa angka positif (> 0).'
      );
      continue;
    }
    const lotSize = lotParsed.isEmpty ? 0.1 : lotParsed.value!;

    // Automatically calculate Lot × Pip Risk Amount & Risk % if omitted in CSV/MT5 export
    const basisVal = activeCapitalBasis || settings.startingBalance || 10000;
    const autoLotPipMetrics = calculateLotBasedOrderMetrics(
      {
        symbol: instrument,
        position,
        lotSize,
        entryPrice,
        stopLossPrice: stopLoss > 0 ? stopLoss : undefined,
        takeProfitPrice: takeProfit > 0 ? takeProfit : undefined,
        exitPrice,
        capitalBasisAmount: basisVal,
      },
      settings
    );

    // Risk Amount (>= 0, derived from Lot × SL Distance if omitted and SL > 0, else 0)
    const riskParsed = parseStrictCsvNumber(getCell(idxRiskFallback));
    if (!riskParsed.isValid || (!riskParsed.isEmpty && riskParsed.value! < 0)) {
      rejectRow(
        rowNum,
        id,
        'riskAmount',
        getCell(idxRiskFallback) ?? '',
        'Risk Amount harus berupa angka valid (>= 0).'
      );
      continue;
    }
    const riskAmount = !riskParsed.isEmpty
      ? riskParsed.value!
      : autoLotPipMetrics.riskAmount !== null
      ? autoLotPipMetrics.riskAmount
      : 0;

    // Risk Percentage (>= 0, derived from Risk Amount / Capital Basis if omitted)
    const riskPctParsed = parseStrictCsvNumber(getCell(idxRiskPct));
    if (!riskPctParsed.isValid || (!riskPctParsed.isEmpty && riskPctParsed.value! < 0)) {
      rejectRow(
        rowNum,
        id,
        'riskPercentage',
        getCell(idxRiskPct) ?? '',
        'Risk % harus berupa angka valid (>= 0).'
      );
      continue;
    }
    const riskPercentage = !riskPctParsed.isEmpty
      ? riskPctParsed.value!
      : riskAmount > 0 && basisVal > 0
      ? Number(((riskAmount / basisVal) * 100).toFixed(2))
      : 0;

    // Commission (optional, default 0)
    const commParsed = parseStrictCsvNumber(getCell(idxCommission));
    if (!commParsed.isValid) {
      rejectRow(rowNum, id, 'commission', getCell(idxCommission) ?? '', 'Komisi bukan angka valid.');
      continue;
    }
    const commission = commParsed.isEmpty ? 0 : Math.abs(commParsed.value!);

    // Swap (optional, default 0, can be negative, 0, or positive!)
    const swapParsed = parseStrictCsvNumber(getCell(idxSwap));
    if (!swapParsed.isValid) {
      rejectRow(rowNum, id, 'swap', getCell(idxSwap) ?? '', 'Swap bukan angka valid.');
      continue;
    }
    const swap = swapParsed.isEmpty ? 0 : swapParsed.value!;

    // Net Profit (can be negative, 0, or positive!)
    const netParsed = parseStrictCsvNumber(getCell(idxNet));
    if (!netParsed.isValid) {
      rejectRow(rowNum, id, 'netProfit', getCell(idxNet) ?? '', 'Net Profit bukan angka valid.');
      continue;
    }
    const netProfit = netParsed.isEmpty ? 0 : Number(netParsed.value!.toFixed(2));

    // Gross Profit (if present in CSV, validate it; otherwise compute from netProfit, commission, swap)
    const grossParsed = parseStrictCsvNumber(getCell(idxGross));
    if (!grossParsed.isValid) {
      rejectRow(rowNum, id, 'grossProfit', getCell(idxGross) ?? '', 'Gross Profit bukan angka valid.');
      continue;
    }
    const grossProfit = grossParsed.isEmpty
      ? computeGrossFromNet(netProfit, commission, swap)
      : Number(grossParsed.value!.toFixed(2));

    // R-Multiple
    const rMultParsed = parseStrictCsvNumber(getCell(idxRMultiple));
    if (!rMultParsed.isValid) {
      rejectRow(rowNum, id, 'rMultiple', getCell(idxRMultiple) ?? '', 'R-Multiple bukan angka valid.');
      continue;
    }
    const computedR = computeRealizedRMultiple({
      netProfit,
      grossProfit,
      commission,
      swap,
      riskAmount,
      rMultiple: rMultParsed.isEmpty ? undefined : rMultParsed.value,
    });
    const rMultiple = !rMultParsed.isEmpty
      ? rMultParsed.value
      : computedR !== null
      ? computedR
      : undefined;

    // Discipline Rating (optional 1..5)
    const discParsed = parseStrictCsvNumber(getCell(idxDiscipline));
    if (!discParsed.isValid) {
      rejectRow(
        rowNum,
        id,
        'disciplineRating',
        getCell(idxDiscipline) ?? '',
        'Rating Disiplin bukan angka valid.'
      );
      continue;
    }
    const disciplineRating = discParsed.isEmpty ? undefined : discParsed.value;

    const outcome: TradeOutcome = classifyNetProfitOutcome(netProfit);

    const rawNotes = idxNotes !== -1 && idxNotes < cols.length ? cols[idxNotes] : '';
    const notes = rawNotes !== '' ? unescapeFormulaSafeText(rawNotes) : '';

    const rawEntryReason = idxEntryReason !== -1 && idxEntryReason < cols.length ? cols[idxEntryReason] : '';
    const entryReason = rawEntryReason !== '' ? unescapeFormulaSafeText(rawEntryReason) : undefined;

    const rawPostEval = idxPostEval !== -1 && idxPostEval < cols.length ? cols[idxPostEval] : '';
    const postTradeEvaluation = rawPostEval !== '' ? unescapeFormulaSafeText(rawPostEval) : undefined;

    const rawExecNotes = idxExecNotes !== -1 && idxExecNotes < cols.length ? cols[idxExecNotes] : '';
    const executionNotes = rawExecNotes !== '' ? unescapeFormulaSafeText(rawExecNotes) : undefined;

    const rawScreenshot = getCell(idxScreenshot);
    const screenshotUrl = rawScreenshot ? unescapeFormulaSafeText(rawScreenshot) : undefined;

    const rawIsDemo = getCell(idxIsDemo);
    const isDemo =
      rawIsDemo !== undefined && rawIsDemo !== ''
        ? rawIsDemo.toLowerCase() === 'true' || rawIsDemo === '1'
        : undefined;

    const rawCreatedAt = getCell(idxCreatedAt);
    const createdAt = rawCreatedAt ? unescapeFormulaSafeText(rawCreatedAt) : undefined;

    const rawUpdatedAt = getCell(idxUpdatedAt);
    const updatedAt = rawUpdatedAt ? unescapeFormulaSafeText(rawUpdatedAt) : undefined;

    const tradeRecord: Trade = {
      id,
      dateTime,
      instrument,
      position,
      strategy,
      ...(session !== undefined ? { session } : {}),
      entryPrice,
      stopLoss,
      takeProfit,
      exitPrice,
      lotSize,
      riskAmount,
      riskPercentage,
      outcome,
      grossProfit,
      commission,
      swap,
      netProfit,
      rMultiple,
      ...(screenshotUrl !== undefined ? { screenshotUrl } : {}),
      notes,
      ...(entryReason !== undefined ? { entryReason } : {}),
      ...(postTradeEvaluation !== undefined ? { postTradeEvaluation } : {}),
      ...(disciplineRating !== undefined ? { disciplineRating } : {}),
      ...(executionNotes !== undefined ? { executionNotes } : {}),
      ...(isDemo !== undefined ? { isDemo } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    };

    validTrades.push(tradeRecord);
  }

  const totalDataRows = rows.length - 1;
  return {
    success: validTrades.length > 0,
    validTrades,
    trades: validTrades,
    errors,
    totalRows: totalDataRows,
    acceptedRowsCount: validTrades.length,
    rejectedRowsCount: rowErrors.length,
    rowErrors,
  };
}

export function parseMt5EaJsonTrades(
  jsonText: string,
  settings: Partial<AppSettings> = DEFAULT_SETTINGS,
  activeCapitalBasis?: number
): CsvImportResult {
  return parseCsvToTrades(jsonText, settings, activeCapitalBasis);
}



