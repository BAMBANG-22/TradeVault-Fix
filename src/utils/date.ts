/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MarketDayOptions {
  /**
   * Evaluate day-of-week in UTC (`getUTCDay()`) when true, or local timezone (`getDay()`) when false.
   * Defaults to `true` for deterministic cloud synchronization and global XAU/USD market alignment.
   */
  useUtc?: boolean;
  /**
   * When true, also treats Friday >= 22:00 UTC (New York market close) as outside active market hours.
   * Defaults to `false` for pure calendar weekday (Monday–Friday) checks.
   */
  enforceFridayCloseUtc?: boolean;
}

/**
 * Safely parses a Date instance, UNIX timestamp (seconds or milliseconds), or ISO/date string
 * into a valid `Date` object, or returns `null` if invalid.
 */
export function parseMarketDateInput(input?: Date | number | string | null): Date | null {
  if (input === undefined) {
    return new Date();
  }
  if (input === null) {
    return null;
  }

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      return null;
    }
    // Auto-detect UNIX seconds (< 1e11) vs UNIX milliseconds (>= 1e11)
    const ms = input < 1e11 ? input * 1000 : input;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof input === 'string') {
    const clean = input.trim();
    if (!clean) return null;

    // Handle pure calendar date string "YYYY-MM-DD" deterministically in UTC noon to prevent timezone day-shift
    const dateOnlyMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const year = parseInt(dateOnlyMatch[1], 10);
      const month = parseInt(dateOnlyMatch[2], 10) - 1;
      const day = parseInt(dateOnlyMatch[3], 10);
      const d = new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
      return Number.isNaN(d.getTime()) ? null : d;
    }

    let normalizedIso = clean.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, '$1T$2');
    normalizedIso = normalizedIso.replace(/([+-]\d{2})$/, '$1:00');
    normalizedIso = normalizedIso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

    const parsed = new Date(normalizedIso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
 * Checks whether a given date/timestamp falls on a weekday (Monday–Friday / Senin–Jumat).
 * - Returns `true` for Monday (1) through Friday (5).
 * - Returns `false` for Saturday (6) and Sunday (0), or if the input date is invalid.
 * - When `options.enforceFridayCloseUtc` is `true`, also returns `false` on Friday >= 22:00 UTC.
 */
export function isMarketDay(
  input?: Date | number | string | null,
  options?: MarketDayOptions
): boolean {
  const parsed = parseMarketDateInput(input);
  if (!parsed) return false;

  const useUtc = options?.useUtc ?? true;
  const dayOfWeek = useUtc ? parsed.getUTCDay() : parsed.getDay();

  // 0 = Sunday (Minggu), 6 = Saturday (Sabtu)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  if (options?.enforceFridayCloseUtc) {
    const utcDay = parsed.getUTCDay();
    const utcHour = parsed.getUTCHours();
    if (utcDay === 5 && utcHour >= 22) {
      return false;
    }
  }

  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Clamps a weekend timestamp (Saturday or Sunday, or Friday >= 22:00 UTC) back to the most recent
 * Friday market close (`21:59:59.000Z`) so cloud data synchronization (`macro_news_snapshots` & `trades`)
 * remains strictly aligned with Monday–Friday market sessions.
 */
export function normalizeToMarketDayIso(input?: Date | number | string | null): string {
  const parsed = parseMarketDateInput(input) || new Date();
  if (isMarketDay(parsed, { useUtc: true, enforceFridayCloseUtc: true })) {
    return parsed.toISOString();
  }

  const clamped = new Date(parsed.getTime());
  const utcDay = clamped.getUTCDay();
  if (utcDay === 6) {
    // Saturday -> go back 1 day to Friday 21:59:59 UTC
    clamped.setUTCDate(clamped.getUTCDate() - 1);
  } else if (utcDay === 0) {
    // Sunday -> go back 2 days to Friday 21:59:59 UTC
    clamped.setUTCDate(clamped.getUTCDate() - 2);
  }
  clamped.setUTCHours(21, 59, 59, 0);
  return clamped.toISOString();
}
