/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MarketSessionId = 'ASIA' | 'LONDON' | 'NEW YORK';
export type MarketSessionTimezone = 'WIB' | 'UTC';

export interface MarketSessionItemConfig {
  id: MarketSessionId;
  enabled: boolean;
  startTime: string; // "HH:MM" in configured timezone
  endTime: string;   // "HH:MM" in configured timezone
  color: string;     // "#RRGGBB"
}

export interface MarketSessionSettings {
  timezone: MarketSessionTimezone;
  showTimeLabels: boolean;
  sessions: MarketSessionItemConfig[];
}

export interface MarketSessionSegment {
  id: string;
  name: MarketSessionId;
  subLabel: string;
  shortTimeLabel: string;
  color: string;
  bgColor: string;
  borderColor: string;
  startLogical: number;
  endLogical: number;
  high: number;
  low: number;
}

export interface SessionCandleLike {
  time: number;
  high: number;
  low: number;
}

const SESSION_ORDER: MarketSessionId[] = ['ASIA', 'LONDON', 'NEW YORK'];

export const DEFAULT_SESSION_ITEMS_WIB: MarketSessionItemConfig[] = [
  {
    id: 'ASIA',
    enabled: true,
    startTime: '07:00',
    endTime: '15:00',
    color: '#C084FC',
  },
  {
    id: 'LONDON',
    enabled: true,
    startTime: '14:00',
    endTime: '23:00',
    color: '#38BDF8',
  },
  {
    id: 'NEW YORK',
    enabled: true,
    startTime: '19:00',
    endTime: '04:00',
    color: '#F59E0B',
  },
];

export const DEFAULT_MARKET_SESSION_SETTINGS: MarketSessionSettings = {
  timezone: 'WIB',
  showTimeLabels: true,
  sessions: DEFAULT_SESSION_ITEMS_WIB.map((item) => ({ ...item })),
};

export const ICT_KILLZONE_ITEMS_WIB: MarketSessionItemConfig[] = [
  {
    id: 'ASIA',
    enabled: true,
    startTime: '07:00',
    endTime: '11:00',
    color: '#C084FC',
  },
  {
    id: 'LONDON',
    enabled: true,
    startTime: '14:00',
    endTime: '17:00',
    color: '#38BDF8',
  },
  {
    id: 'NEW YORK',
    enabled: true,
    startTime: '19:00',
    endTime: '22:00',
    color: '#F59E0B',
  },
];

function cloneDefaultSessions(): MarketSessionItemConfig[] {
  return DEFAULT_SESSION_ITEMS_WIB.map((item) => ({ ...item }));
}

export function isValidSessionHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

export function hexToSessionRgba(hex: string, alpha: number): string {
  const clean = isValidSessionHexColor(hex) ? hex.trim().slice(1) : '38BDF8';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const clamped = Math.min(1, Math.max(0, Number(alpha) || 0));
  return `rgba(${r}, ${g}, ${b}, ${Number(clamped.toFixed(2))})`;
}

export function normalizeSessionTimeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return fallback;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function parseHHMMToMinutes(value: string, fallbackMinutes = 0): number {
  const normalized = normalizeSessionTimeString(value, '');
  if (!normalized) return fallbackMinutes;
  const [hhStr, mmStr] = normalized.split(':');
  return Number(hhStr) * 60 + Number(mmStr);
}

export function minutesToHHMM(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function shiftHHMMByHours(hhmm: string, deltaHours: number): string {
  const mins = parseHHMMToMinutes(hhmm, 0);
  return minutesToHHMM(mins + deltaHours * 60);
}

export function sanitizeMarketSessionSettings(raw: unknown): MarketSessionSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      timezone: 'WIB',
      showTimeLabels: true,
      sessions: cloneDefaultSessions(),
    };
  }
  const obj = raw as Record<string, unknown>;
  const timezone: MarketSessionTimezone = obj.timezone === 'UTC' ? 'UTC' : 'WIB';
  const showTimeLabels =
    typeof obj.showTimeLabels === 'boolean' ? obj.showTimeLabels : true;

  const rawList = Array.isArray(obj.sessions) ? obj.sessions : [];
  const byId = new Map<MarketSessionId, Record<string, unknown>>();
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (rec.id === 'ASIA' || rec.id === 'LONDON' || rec.id === 'NEW YORK') {
      byId.set(rec.id, rec);
    }
  }

  const sessions: MarketSessionItemConfig[] = SESSION_ORDER.map((sessionId) => {
    const fallback = DEFAULT_SESSION_ITEMS_WIB.find((d) => d.id === sessionId)!;
    const found = byId.get(sessionId);
    if (!found) {
      return timezone === 'UTC'
        ? {
            ...fallback,
            startTime: shiftHHMMByHours(fallback.startTime, -7),
            endTime: shiftHHMMByHours(fallback.endTime, -7),
          }
        : { ...fallback };
    }
    const defaultStart =
      timezone === 'UTC' ? shiftHHMMByHours(fallback.startTime, -7) : fallback.startTime;
    const defaultEnd =
      timezone === 'UTC' ? shiftHHMMByHours(fallback.endTime, -7) : fallback.endTime;

    return {
      id: sessionId,
      enabled: typeof found.enabled === 'boolean' ? found.enabled : fallback.enabled,
      startTime: normalizeSessionTimeString(found.startTime, defaultStart),
      endTime: normalizeSessionTimeString(found.endTime, defaultEnd),
      color: isValidSessionHexColor(found.color) ? found.color.toUpperCase() : fallback.color,
    };
  });

  return {
    timezone,
    showTimeLabels,
    sessions,
  };
}

export function shiftMarketSessionSettingsTimezone(
  settings: MarketSessionSettings,
  targetTz: MarketSessionTimezone
): MarketSessionSettings {
  const sanitized = sanitizeMarketSessionSettings(settings);
  if (sanitized.timezone === targetTz) return sanitized;
  const deltaHours = targetTz === 'WIB' ? 7 : -7;
  return {
    ...sanitized,
    timezone: targetTz,
    sessions: sanitized.sessions.map((item) => ({
      ...item,
      startTime: shiftHHMMByHours(item.startTime, deltaHours),
      endTime: shiftHHMMByHours(item.endTime, deltaHours),
    })),
  };
}

export function buildMarketSessionPreset(
  preset: 'standard' | 'killzone',
  targetTz: MarketSessionTimezone,
  showTimeLabels = true
): MarketSessionSettings {
  const baseWib = preset === 'killzone' ? ICT_KILLZONE_ITEMS_WIB : DEFAULT_SESSION_ITEMS_WIB;
  const wibSettings: MarketSessionSettings = {
    timezone: 'WIB',
    showTimeLabels,
    sessions: baseWib.map((item) => ({ ...item })),
  };
  return targetTz === 'UTC' ? shiftMarketSessionSettingsTimezone(wibSettings, 'UTC') : wibSettings;
}

export function formatSessionSummaryLine(settings: MarketSessionSettings): string {
  const clean = sanitizeMarketSessionSettings(settings);
  const enabledItems = clean.sessions.filter((s) => s.enabled);
  if (enabledItems.length === 0) {
    return 'Semua sesi dinonaktifkan';
  }
  const shortName = (id: MarketSessionId) =>
    id === 'NEW YORK' ? 'NY' : id === 'LONDON' ? 'London' : 'Asia';
  return `${enabledItems
    .map((s) => `${shortName(s.id)} ${s.startTime}–${s.endTime}`)
    .join(' · ')} ${clean.timezone}`;
}

/**
 * Computes static logical/price session segments for the Replay Chart SVG overlay.
 * Supports both intra-day (e.g. 07:00-15:00) and overnight wrap-around (e.g. 19:00-04:00)
 * in either WIB (UTC+7) or UTC without breaking continuous boxes at midnight.
 */
export function computeMarketSessionSegments(
  candles: SessionCandleLike[],
  rawSettings: MarketSessionSettings | undefined,
  sampleStartOffset = 0
): MarketSessionSegment[] {
  if (!candles || candles.length < 8) return [];
  const settings = sanitizeMarketSessionSettings(rawSettings);
  const tzOffsetSeconds = settings.timezone === 'WIB' ? 7 * 3600 : 0;
  const segments: MarketSessionSegment[] = [];

  for (const session of settings.sessions) {
    if (!session.enabled) continue;
    const startMin = parseHHMMToMinutes(session.startTime, 0);
    const endMin = parseHHMMToMinutes(session.endTime, 0);
    if (startMin === endMin) continue;

    const isOvernight = startMin > endMin;
    const bgColor = hexToSessionRgba(session.color, 0.08);
    const borderColor = hexToSessionRgba(session.color, 0.45);
    const shortTimeLabel = `${session.startTime}–${session.endTime}`;
    const subLabel = `${shortTimeLabel} ${settings.timezone}`;

    let currentSegStart: number | null = null;
    let currentHigh = -Infinity;
    let currentLow = Infinity;
    let currentAnchorKey = '';
    let lastInSessionUnixSec = -Infinity;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const unixSec = Number(c.time);
      if (!Number.isFinite(unixSec)) continue;

      const shiftedDate = new Date((unixSec + tzOffsetSeconds) * 1000);
      const minOfDay = shiftedDate.getUTCHours() * 60 + shiftedDate.getUTCMinutes();

      const inSession = isOvernight
        ? minOfDay >= startMin || minOfDay < endMin
        : minOfDay >= startMin && minOfDay < endMin;

      if (inSession) {
        let anchorDateMs = Date.UTC(
          shiftedDate.getUTCFullYear(),
          shiftedDate.getUTCMonth(),
          shiftedDate.getUTCDate()
        );
        if (isOvernight && minOfDay < endMin) {
          anchorDateMs -= 24 * 3600 * 1000;
        }
        const anchorKey = String(anchorDateMs);
        const hasLargeGap =
          currentSegStart !== null && unixSec - lastInSessionUnixSec > 16 * 3600;

        if (currentSegStart === null || currentAnchorKey !== anchorKey || hasLargeGap) {
          if (currentSegStart !== null) {
            segments.push({
              id: `${session.id}_${currentAnchorKey}_${currentSegStart}`,
              name: session.id,
              subLabel,
              shortTimeLabel,
              color: session.color,
              bgColor,
              borderColor,
              startLogical: sampleStartOffset + currentSegStart,
              endLogical: sampleStartOffset + i - 1,
              high: currentHigh,
              low: currentLow,
            });
          }
          currentSegStart = i;
          currentHigh = c.high;
          currentLow = c.low;
          currentAnchorKey = anchorKey;
        } else {
          if (c.high > currentHigh) currentHigh = c.high;
          if (c.low < currentLow) currentLow = c.low;
        }
        lastInSessionUnixSec = unixSec;
      } else if (currentSegStart !== null) {
        segments.push({
          id: `${session.id}_${currentAnchorKey}_${currentSegStart}`,
          name: session.id,
          subLabel,
          shortTimeLabel,
          color: session.color,
          bgColor,
          borderColor,
          startLogical: sampleStartOffset + currentSegStart,
          endLogical: sampleStartOffset + i - 1,
          high: currentHigh,
          low: currentLow,
        });
        currentSegStart = null;
        currentHigh = -Infinity;
        currentLow = Infinity;
        currentAnchorKey = '';
      }
    }

    if (currentSegStart !== null) {
      segments.push({
        id: `${session.id}_${currentAnchorKey}_${currentSegStart}`,
        name: session.id,
        subLabel,
        shortTimeLabel,
        color: session.color,
        bgColor,
        borderColor,
        startLogical: sampleStartOffset + currentSegStart,
        endLogical: sampleStartOffset + candles.length - 1,
        high: currentHigh,
        low: currentLow,
      });
    }
  }

  return segments;
}
