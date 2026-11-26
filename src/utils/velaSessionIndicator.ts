/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Native LuxAlgo Vela indicator for Forex/Gold Trading Sessions (Asia, London, New York).
 * Supports customizable colors, fill/border opacity, border width & style, custom WIB/UTC hours,
 * labels, 50% equilibrium midline, and stays 100% synced during Vela Bar Replay.
 */

import {
  getNativeIndicator,
  registerNativeIndicator,
  type DrawingBox,
  type DrawingLine,
  type InputSchema,
  type InputValue,
  type LineStyle,
  type NativeIndicator,
  type NativeIndicatorContext,
  type NativeIndicatorDescriptor,
  type OHLCV,
} from '@luxalgo/vela';

export const VELA_SESSIONS_INDICATOR_TYPE = 'tradevault-sessions';

export interface VelaSessionSettings {
  showAsia: boolean;
  asiaColor: string;
  asiaStartWib: number; // 0..23 (default 7 = 00:00 UTC)
  asiaEndWib: number; // 0..23 (default 15 = 08:00 UTC)

  showLondon: boolean;
  londonColor: string;
  londonStartWib: number; // default 14 = 07:00 UTC
  londonEndWib: number; // default 23 = 16:00 UTC

  showNewYork: boolean;
  nyColor: string;
  nyStartWib: number; // default 19 = 12:00 UTC
  nyEndWib: number; // default 4 = 21:00 UTC

  fillOpacity: number; // 0..60 (%)
  borderOpacity: number; // 0..100 (%)
  borderWidth: number; // 0..3 px
  borderStyle: LineStyle; // 'solid' | 'dashed' | 'dotted'
  showLabels: boolean;
  showMidline: boolean;
  maxSessions: number; // 3..40
}

export const DEFAULT_VELA_SESSION_SETTINGS: VelaSessionSettings = {
  showAsia: true,
  asiaColor: '#38BDF8',
  asiaStartWib: 7,
  asiaEndWib: 15,

  showLondon: true,
  londonColor: '#10B981',
  londonStartWib: 14,
  londonEndWib: 23,

  showNewYork: true,
  nyColor: '#F59E0B',
  nyStartWib: 19,
  nyEndWib: 4,

  fillOpacity: 10,
  borderOpacity: 58,
  borderWidth: 1,
  borderStyle: 'solid',
  showLabels: true,
  showMidline: false,
  maxSessions: 12,
};

export function settingsToVelaInputs(settings: VelaSessionSettings): Record<string, InputValue> {
  return {
    showAsia: settings.showAsia,
    asiaColor: settings.asiaColor,
    asiaStartWib: settings.asiaStartWib,
    asiaEndWib: settings.asiaEndWib,
    showLondon: settings.showLondon,
    londonColor: settings.londonColor,
    londonStartWib: settings.londonStartWib,
    londonEndWib: settings.londonEndWib,
    showNewYork: settings.showNewYork,
    nyColor: settings.nyColor,
    nyStartWib: settings.nyStartWib,
    nyEndWib: settings.nyEndWib,
    fillOpacity: settings.fillOpacity,
    borderOpacity: settings.borderOpacity,
    borderWidth: settings.borderWidth,
    borderStyle: settings.borderStyle,
    showLabels: settings.showLabels,
    showMidline: settings.showMidline,
    maxSessions: settings.maxSessions,
  };
}

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function sanitizeHexColor(val: unknown, fallback: string): string {
  if (typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val.trim())) {
    return val.trim().toUpperCase();
  }
  return fallback;
}

function sanitizeLineStyle(val: unknown, fallback: LineStyle): LineStyle {
  if (val === 'solid' || val === 'dashed' || val === 'dotted') {
    return val;
  }
  return fallback;
}

export function normalizeSessionSettings(
  raw: Partial<VelaSessionSettings> | Partial<Record<string, unknown>> | null | undefined
): VelaSessionSettings {
  const src = (raw || {}) as Record<string, unknown>;
  return {
    showAsia: src.showAsia !== undefined ? Boolean(src.showAsia) : DEFAULT_VELA_SESSION_SETTINGS.showAsia,
    asiaColor: sanitizeHexColor(src.asiaColor, DEFAULT_VELA_SESSION_SETTINGS.asiaColor),
    asiaStartWib: clampInt(src.asiaStartWib, DEFAULT_VELA_SESSION_SETTINGS.asiaStartWib, 0, 23),
    asiaEndWib: clampInt(src.asiaEndWib, DEFAULT_VELA_SESSION_SETTINGS.asiaEndWib, 0, 23),

    showLondon:
      src.showLondon !== undefined ? Boolean(src.showLondon) : DEFAULT_VELA_SESSION_SETTINGS.showLondon,
    londonColor: sanitizeHexColor(src.londonColor, DEFAULT_VELA_SESSION_SETTINGS.londonColor),
    londonStartWib: clampInt(src.londonStartWib, DEFAULT_VELA_SESSION_SETTINGS.londonStartWib, 0, 23),
    londonEndWib: clampInt(src.londonEndWib, DEFAULT_VELA_SESSION_SETTINGS.londonEndWib, 0, 23),

    showNewYork:
      src.showNewYork !== undefined ? Boolean(src.showNewYork) : DEFAULT_VELA_SESSION_SETTINGS.showNewYork,
    nyColor: sanitizeHexColor(src.nyColor, DEFAULT_VELA_SESSION_SETTINGS.nyColor),
    nyStartWib: clampInt(src.nyStartWib, DEFAULT_VELA_SESSION_SETTINGS.nyStartWib, 0, 23),
    nyEndWib: clampInt(src.nyEndWib, DEFAULT_VELA_SESSION_SETTINGS.nyEndWib, 0, 23),

    fillOpacity: clampInt(src.fillOpacity, DEFAULT_VELA_SESSION_SETTINGS.fillOpacity, 0, 60),
    borderOpacity: clampInt(src.borderOpacity, DEFAULT_VELA_SESSION_SETTINGS.borderOpacity, 0, 100),
    borderWidth: clampInt(src.borderWidth, DEFAULT_VELA_SESSION_SETTINGS.borderWidth, 0, 3),
    borderStyle: sanitizeLineStyle(src.borderStyle, DEFAULT_VELA_SESSION_SETTINGS.borderStyle),
    showLabels:
      src.showLabels !== undefined ? Boolean(src.showLabels) : DEFAULT_VELA_SESSION_SETTINGS.showLabels,
    showMidline:
      src.showMidline !== undefined ? Boolean(src.showMidline) : DEFAULT_VELA_SESSION_SETTINGS.showMidline,
    maxSessions: clampInt(src.maxSessions, DEFAULT_VELA_SESSION_SETTINGS.maxSessions, 3, 40),
  };
}

function hexToRgba(hex: string, alpha01: number): string | undefined {
  const clamped = Math.min(1, Math.max(0, alpha01));
  if (clamped <= 0) return undefined;
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return undefined;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return undefined;
  return `rgba(${r}, ${g}, ${b}, ${Number(clamped.toFixed(3))})`;
}

function wibHourToUtcHour(wibHour: number): number {
  return ((Math.round(wibHour) - 7) % 24 + 24) % 24;
}

interface ResolvedSessionWindow {
  id: 'asia' | 'london' | 'ny';
  label: string;
  startHourUtc: number;
  endHourUtc: number;
  hexColor: string;
}

function isIntradayTimeframe(timeframe: string): boolean {
  const upper = String(timeframe || '').trim().toUpperCase();
  if (!upper) return true;
  if (upper.endsWith('D') || upper.endsWith('W') || upper.endsWith('M')) {
    if (/^\d+M$/i.test(upper)) return true;
    return false;
  }
  const mins = Number(upper);
  if (Number.isFinite(mins) && mins >= 1440) return false;
  return true;
}

function getSessionGroupDayKey(timeMs: number, startHourUtc: number, endHourUtc: number): string {
  const d = new Date(timeMs);
  const hourUtc = d.getUTCHours();
  // For overnight UTC sessions (e.g. 22:00..06:00 UTC), shift pre-end hours back 1 day so one continuous box forms.
  const shiftedMs =
    startHourUtc > endHourUtc && hourUtc < endHourUtc ? timeMs - 24 * 60 * 60 * 1000 : timeMs;
  const sd = new Date(shiftedMs);
  const y = sd.getUTCFullYear();
  const m = String(sd.getUTCMonth() + 1).padStart(2, '0');
  const day = String(sd.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isInUtcHourWindow(hourUtc: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hourUtc >= startHour && hourUtc < endHour;
  }
  return hourUtc >= startHour || hourUtc < endHour;
}

interface SessionSegment {
  def: ResolvedSessionWindow;
  dayKey: string;
  leftIdx: number;
  rightIdx: number;
  high: number;
  low: number;
}

function buildSessionVisuals(
  bars: readonly OHLCV[],
  timeframe: string,
  inputs: Record<string, InputValue>
): { boxes: DrawingBox[]; lines: DrawingLine[] } {
  if (!bars.length || !isIntradayTimeframe(timeframe)) {
    return { boxes: [], lines: [] };
  }

  const cfg = normalizeSessionSettings(inputs);
  const activeDefs: ResolvedSessionWindow[] = [];

  if (cfg.showAsia) {
    activeDefs.push({
      id: 'asia',
      label: 'ASIA',
      startHourUtc: wibHourToUtcHour(cfg.asiaStartWib),
      endHourUtc: wibHourToUtcHour(cfg.asiaEndWib),
      hexColor: cfg.asiaColor,
    });
  }
  if (cfg.showLondon) {
    activeDefs.push({
      id: 'london',
      label: 'LONDON',
      startHourUtc: wibHourToUtcHour(cfg.londonStartWib),
      endHourUtc: wibHourToUtcHour(cfg.londonEndWib),
      hexColor: cfg.londonColor,
    });
  }
  if (cfg.showNewYork) {
    activeDefs.push({
      id: 'ny',
      label: 'NEW YORK',
      startHourUtc: wibHourToUtcHour(cfg.nyStartWib),
      endHourUtc: wibHourToUtcHour(cfg.nyEndWib),
      hexColor: cfg.nyColor,
    });
  }

  if (activeDefs.length === 0) {
    return { boxes: [], lines: [] };
  }

  const fillAlpha = cfg.fillOpacity / 100;
  const borderAlpha = cfg.borderOpacity / 100;
  const boxes: DrawingBox[] = [];
  const lines: DrawingLine[] = [];

  for (const def of activeDefs) {
    const segments: SessionSegment[] = [];
    let current: SessionSegment | null = null;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (!bar || !Number.isFinite(bar.time)) continue;

      const d = new Date(bar.time);
      const hourUtc = d.getUTCHours();
      const inSession = isInUtcHourWindow(hourUtc, def.startHourUtc, def.endHourUtc);
      const dayKey = getSessionGroupDayKey(bar.time, def.startHourUtc, def.endHourUtc);

      if (inSession) {
        if (current && current.dayKey === dayKey) {
          current.rightIdx = i;
          if (bar.high > current.high) current.high = bar.high;
          if (bar.low < current.low) current.low = bar.low;
        } else {
          if (current) segments.push(current);
          current = {
            def,
            dayKey,
            leftIdx: i,
            rightIdx: i,
            high: bar.high,
            low: bar.low,
          };
        }
      } else if (current) {
        segments.push(current);
        current = null;
      }
    }

    if (current) {
      segments.push(current);
    }

    const bgColor = hexToRgba(def.hexColor, fillAlpha);
    const borderColor = cfg.borderWidth > 0 ? hexToRgba(def.hexColor, borderAlpha) : undefined;
    const midlineColor = hexToRgba(def.hexColor, Math.max(borderAlpha, 0.45)) || def.hexColor;
    const recentSegments = segments.slice(-cfg.maxSessions);

    for (const seg of recentSegments) {
      const rightIdx = Math.max(seg.rightIdx, seg.leftIdx);
      const boxId = `tv_sess_${seg.def.id}_${seg.dayKey}_${seg.leftIdx}`;

      boxes.push({
        id: boxId,
        paneId: 'price',
        xloc: 'bar_index',
        left: seg.leftIdx,
        right: rightIdx,
        top: seg.high,
        bottom: seg.low,
        extend: 'none',
        bgColor,
        borderColor,
        borderWidth: cfg.borderWidth,
        borderStyle: cfg.borderStyle,
        text: cfg.showLabels ? seg.def.label : undefined,
        textColor: def.hexColor,
        textSize: 'tiny',
        hAlign: 'left',
        vAlign: 'top',
        wrap: false,
        fontFamily: 'monospace',
        bold: true,
        italic: false,
        overlay: true,
      });

      if (cfg.showMidline && rightIdx > seg.leftIdx) {
        const mid = (seg.high + seg.low) / 2;
        lines.push({
          id: `${boxId}_mid`,
          paneId: 'price',
          xloc: 'bar_index',
          x1: seg.leftIdx,
          y1: mid,
          x2: rightIdx,
          y2: mid,
          extend: 'none',
          color: midlineColor,
          invisible: false,
          width: 1,
          style: 'dashed',
          arrowLeft: false,
          arrowRight: false,
          overlay: true,
        });
      }
    }
  }

  return { boxes, lines };
}

class TradeVaultSessionsNativeIndicator implements NativeIndicator {
  private ctx: NativeIndicatorContext | null = null;
  private inputs: Record<string, InputValue> = {};
  private suspended = false;

  start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
    this.ctx = ctx;
    this.inputs = { ...inputs };
    this.suspended = false;
    this.recompute();
  }

  onBars(): void {
    if (this.suspended) return;
    this.recompute();
  }

  onViewport(): void {
    // Session segments are bar-index aligned; no viewport recompute required.
  }

  setInputs(inputs: Record<string, InputValue>): void {
    this.inputs = { ...inputs };
    if (!this.suspended) {
      this.recompute();
    }
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
    this.recompute();
  }

  stop(): void {
    this.suspended = true;
    this.ctx = null;
  }

  private recompute(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bars = ctx.bars();
    const { boxes, lines } = buildSessionVisuals(bars, ctx.timeframe, this.inputs);
    ctx.emit({
      title: 'Trading Sessions (Asia / LDN / NY)',
      shortTitle: 'Sessions',
      paneHint: 'price',
      boxes,
      lines,
    });
    ctx.setStatus(ctx.live ? 'live' : 'idle');
  }
}

const SESSIONS_INPUT_SCHEMA: InputSchema[] = [
  { key: 'showAsia', title: 'Asia Session', type: 'bool', defval: true, group: 'Asia (WIB)' },
  { key: 'asiaColor', title: 'Asia Color', type: 'color', defval: '#38BDF8', group: 'Asia (WIB)' },
  { key: 'asiaStartWib', title: 'Asia Start (WIB Hour)', type: 'int', defval: 7, min: 0, max: 23, step: 1, group: 'Asia (WIB)' },
  { key: 'asiaEndWib', title: 'Asia End (WIB Hour)', type: 'int', defval: 15, min: 0, max: 23, step: 1, group: 'Asia (WIB)' },

  { key: 'showLondon', title: 'London Session', type: 'bool', defval: true, group: 'London (WIB)' },
  { key: 'londonColor', title: 'London Color', type: 'color', defval: '#10B981', group: 'London (WIB)' },
  { key: 'londonStartWib', title: 'London Start (WIB Hour)', type: 'int', defval: 14, min: 0, max: 23, step: 1, group: 'London (WIB)' },
  { key: 'londonEndWib', title: 'London End (WIB Hour)', type: 'int', defval: 23, min: 0, max: 23, step: 1, group: 'London (WIB)' },

  { key: 'showNewYork', title: 'New York Session', type: 'bool', defval: true, group: 'New York (WIB)' },
  { key: 'nyColor', title: 'New York Color', type: 'color', defval: '#F59E0B', group: 'New York (WIB)' },
  { key: 'nyStartWib', title: 'New York Start (WIB Hour)', type: 'int', defval: 19, min: 0, max: 23, step: 1, group: 'New York (WIB)' },
  { key: 'nyEndWib', title: 'New York End (WIB Hour)', type: 'int', defval: 4, min: 0, max: 23, step: 1, group: 'New York (WIB)' },

  { key: 'fillOpacity', title: 'Box Fill Opacity (%)', type: 'int', defval: 10, min: 0, max: 60, step: 1, group: 'Box Style' },
  { key: 'borderOpacity', title: 'Border Opacity (%)', type: 'int', defval: 58, min: 0, max: 100, step: 5, group: 'Box Style' },
  { key: 'borderWidth', title: 'Border Width (px)', type: 'int', defval: 1, min: 0, max: 3, step: 1, group: 'Box Style' },
  { key: 'borderStyle', title: 'Border Style', type: 'string', defval: 'solid', options: ['solid', 'dashed', 'dotted'], group: 'Box Style' },
  { key: 'showLabels', title: 'Show Session Labels', type: 'bool', defval: true, group: 'Box Style' },
  { key: 'showMidline', title: 'Show 50% Midline', type: 'bool', defval: false, group: 'Box Style' },
  { key: 'maxSessions', title: 'Max Sessions Per Type', type: 'int', defval: 12, min: 3, max: 40, step: 1, group: 'Box Style' },
];

const TRADEVAULT_SESSIONS_DESCRIPTOR: NativeIndicatorDescriptor = {
  type: VELA_SESSIONS_INDICATOR_TYPE,
  title: 'Trading Sessions (Asia / London / NY)',
  shortTitle: 'Sessions',
  paneHint: 'price',
  overlay: true,
  catalog: true,
  inputsSchema: () => SESSIONS_INPUT_SCHEMA,
  defaultInputs: () => settingsToVelaInputs(DEFAULT_VELA_SESSION_SETTINGS),
  create: () => new TradeVaultSessionsNativeIndicator(),
};

export function ensureVelaSessionsIndicatorRegistered(): void {
  if (!getNativeIndicator(VELA_SESSIONS_INDICATOR_TYPE)) {
    registerNativeIndicator(TRADEVAULT_SESSIONS_DESCRIPTOR);
  }
}
