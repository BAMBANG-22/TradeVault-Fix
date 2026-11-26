/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { LineStyle } from '@luxalgo/vela';
import { RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_VELA_SESSION_SETTINGS,
  type VelaSessionSettings,
} from '../../utils/velaSessionIndicator';

interface VelaSessionSettingsPopoverProps {
  settings: VelaSessionSettings;
  isEn: boolean;
  onChange: (next: VelaSessionSettings) => void;
  onReset: () => void;
  onClose: () => void;
}

const WIB_HOURS: number[] = Array.from({ length: 24 }, (_, i) => i);

const BORDER_STYLES: ReadonlyArray<{ id: LineStyle; labelId: string; labelEn: string }> = [
  { id: 'solid', labelId: 'Solid', labelEn: 'Solid' },
  { id: 'dashed', labelId: 'Putus', labelEn: 'Dashed' },
  { id: 'dotted', labelId: 'Titik', labelEn: 'Dotted' },
];

function formatHourWib(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export const VelaSessionSettingsPopover: React.FC<VelaSessionSettingsPopoverProps> = ({
  settings,
  isEn,
  onChange,
  onReset,
  onClose,
}) => {
  const tr = (idText: string, enText: string) => (isEn ? enText : idText);

  const patch = (partial: Partial<VelaSessionSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const sessionRows: Array<{
    key: 'asia' | 'london' | 'ny';
    name: string;
    enabled: boolean;
    color: string;
    startWib: number;
    endWib: number;
    onToggle: (v: boolean) => void;
    onColor: (v: string) => void;
    onStart: (v: number) => void;
    onEnd: (v: number) => void;
  }> = [
    {
      key: 'asia',
      name: 'Asia',
      enabled: settings.showAsia,
      color: settings.asiaColor,
      startWib: settings.asiaStartWib,
      endWib: settings.asiaEndWib,
      onToggle: (v) => patch({ showAsia: v }),
      onColor: (v) => patch({ asiaColor: v }),
      onStart: (v) => patch({ asiaStartWib: v }),
      onEnd: (v) => patch({ asiaEndWib: v }),
    },
    {
      key: 'london',
      name: 'London',
      enabled: settings.showLondon,
      color: settings.londonColor,
      startWib: settings.londonStartWib,
      endWib: settings.londonEndWib,
      onToggle: (v) => patch({ showLondon: v }),
      onColor: (v) => patch({ londonColor: v }),
      onStart: (v) => patch({ londonStartWib: v }),
      onEnd: (v) => patch({ londonEndWib: v }),
    },
    {
      key: 'ny',
      name: 'New York',
      enabled: settings.showNewYork,
      color: settings.nyColor,
      startWib: settings.nyStartWib,
      endWib: settings.nyEndWib,
      onToggle: (v) => patch({ showNewYork: v }),
      onColor: (v) => patch({ nyColor: v }),
      onStart: (v) => patch({ nyStartWib: v }),
      onEnd: (v) => patch({ nyEndWib: v }),
    },
  ];

  return (
    <div
      data-testid="vela-session-settings-popover"
      role="dialog"
      aria-label={tr('Pengaturan Kotak Sesi', 'Session Box Settings')}
      className="absolute top-2 right-2 z-30 w-[calc(100%-1rem)] max-w-[332px] max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] shadow-[0_12px_32px_-8px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.7)] text-[#0F172A] dark:text-[#F2F4F7] text-xs select-none animate-in fade-in duration-150"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-white dark:bg-[#101318] border-b border-[#E4E4E7] dark:border-[#20252D]">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold tracking-tight text-[#0F172A] dark:text-[#F2F4F7] leading-tight">
            {tr('Pengaturan Sesi', 'Session Settings')}
          </h4>
          <p className="mt-0.5 text-[11px] text-[#526071] dark:text-[#929BA9]">
            {tr('Waktu WIB · Update langsung di chart', 'WIB hours · Updates live on chart')}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onReset}
            title={tr('Kembalikan ke pengaturan awal', 'Reset to defaults')}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#161A22] hover:bg-[#F4F4F5] dark:hover:bg-[#1D222C] text-[11px] font-medium text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup pengaturan sesi', 'Close session settings')}
            className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7] hover:bg-[#F4F4F5] dark:hover:bg-[#161A22] transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Per-Session Toggle, Color & WIB Hours */}
        <div className="space-y-2.5">
          <div className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9]">
            {tr('Sesi, Warna & Jam (WIB)', 'Sessions, Color & Hours (WIB)')}
          </div>

          <div className="divide-y divide-[#E4E4E7] dark:divide-[#20252D] rounded-lg border border-[#E4E4E7] dark:border-[#20252D] bg-[#FAFAFA] dark:bg-[#0B0D11]">
            {sessionRows.map((row) => (
              <div key={row.key} className="p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-[#0F172A] dark:text-[#F2F4F7]">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) => row.onToggle(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[#0F172A] dark:accent-[#F2F4F7] cursor-pointer"
                    />
                    <span>{row.name}</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono-numbers tabular-nums text-[#526071] dark:text-[#929BA9]">
                      {row.color}
                    </span>
                    <input
                      type="color"
                      value={row.color}
                      onChange={(e) => row.onColor(e.target.value)}
                      aria-label={`${row.name} color`}
                      className="h-6 w-7 rounded border border-[#E4E4E7] dark:border-[#20252D] bg-transparent cursor-pointer p-0.5"
                    />
                  </div>
                </div>

                {row.enabled && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <select
                      value={row.startWib}
                      onChange={(e) => row.onStart(Number(e.target.value))}
                      className="flex-1 h-7 bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] rounded-md px-2 text-[11px] font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none"
                    >
                      {WIB_HOURS.map((h) => (
                        <option key={h} value={h}>
                          {formatHourWib(h)} WIB
                        </option>
                      ))}
                    </select>
                    <span className="text-[#94A3B8] dark:text-[#526071]">–</span>
                    <select
                      value={row.endWib}
                      onChange={(e) => row.onEnd(Number(e.target.value))}
                      className="flex-1 h-7 bg-white dark:bg-[#101318] border border-[#E4E4E7] dark:border-[#20252D] rounded-md px-2 text-[11px] font-mono-numbers tabular-nums text-[#0F172A] dark:text-[#F2F4F7] focus:outline-none"
                    >
                      {WIB_HOURS.map((h) => (
                        <option key={h} value={h}>
                          {formatHourWib(h)} WIB
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Opacity & Border */}
        <div className="space-y-3 pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
          <div className="text-[11px] font-medium text-[#526071] dark:text-[#929BA9]">
            {tr('Transparansi & Garis Tepi', 'Opacity & Border')}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#526071] dark:text-[#929BA9]">
                {tr('Opacity Isi Kotak', 'Fill Opacity')}
              </span>
              <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {settings.fillOpacity}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={settings.fillOpacity}
              onChange={(e) => patch({ fillOpacity: Number(e.target.value) })}
              data-testid="vela-session-fill-opacity"
              className="w-full h-1.5 accent-[#0F172A] dark:accent-[#F2F4F7] cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#526071] dark:text-[#929BA9]">
                {tr('Opacity Garis Tepi', 'Border Opacity')}
              </span>
              <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {settings.borderOpacity}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.borderOpacity}
              onChange={(e) => patch({ borderOpacity: Number(e.target.value) })}
              data-testid="vela-session-border-opacity"
              className="w-full h-1.5 accent-[#0F172A] dark:accent-[#F2F4F7] cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-0.5">
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                {tr('Tebal Garis', 'Border Width')}
              </span>
              <div className="flex items-center p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]">
                {[0, 1, 2, 3].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => patch({ borderWidth: w })}
                    className={`flex-1 py-1 rounded-md text-[10px] font-medium font-mono-numbers tabular-nums cursor-pointer transition-colors ${
                      settings.borderWidth === w
                        ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                    }`}
                  >
                    {w === 0 ? 'Off' : `${w}px`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] text-[#526071] dark:text-[#929BA9] block">
                {tr('Gaya Garis', 'Border Style')}
              </span>
              <div className="flex items-center p-0.5 rounded-lg bg-[#F4F4F5] dark:bg-[#050607] border border-[#E4E4E7] dark:border-[#20252D]">
                {BORDER_STYLES.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => patch({ borderStyle: st.id })}
                    className={`flex-1 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-colors ${
                      settings.borderStyle === st.id
                        ? 'bg-white dark:bg-[#161A22] text-[#0F172A] dark:text-[#F2F4F7] shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:shadow-none'
                        : 'text-[#526071] dark:text-[#929BA9] hover:text-[#0F172A] dark:hover:text-[#F2F4F7]'
                    }`}
                  >
                    {isEn ? st.labelEn : st.labelId}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Display Options & History Count */}
        <div className="space-y-3 pt-3 border-t border-[#E4E4E7] dark:border-[#20252D]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-[#0F172A] dark:text-[#F2F4F7]">
              <input
                type="checkbox"
                checked={settings.showLabels}
                onChange={(e) => patch({ showLabels: e.target.checked })}
                className="h-3.5 w-3.5 rounded accent-[#0F172A] dark:accent-[#F2F4F7] cursor-pointer"
              />
              <span>{tr('Label Sesi', 'Session Labels')}</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-[#0F172A] dark:text-[#F2F4F7]">
              <input
                type="checkbox"
                checked={settings.showMidline}
                onChange={(e) => patch({ showMidline: e.target.checked })}
                className="h-3.5 w-3.5 rounded accent-[#0F172A] dark:accent-[#F2F4F7] cursor-pointer"
              />
              <span>{tr('Garis Tengah 50%', '50% Midline')}</span>
            </label>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#526071] dark:text-[#929BA9]">
                {tr('Jumlah Riwayat Sesi', 'Max Sessions Shown')}
              </span>
              <span className="font-mono-numbers tabular-nums font-semibold text-[#0F172A] dark:text-[#F2F4F7]">
                {settings.maxSessions}
              </span>
            </div>
            <input
              type="range"
              min={3}
              max={40}
              step={1}
              value={settings.maxSessions}
              onChange={(e) => patch({ maxSessions: Number(e.target.value) })}
              className="w-full h-1.5 accent-[#0F172A] dark:accent-[#F2F4F7] cursor-pointer"
            />
          </div>

          <p className="text-[10px] text-[#526071] dark:text-[#929BA9] leading-relaxed font-mono-numbers tabular-nums">
            {tr(
              `Standar: Asia ${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.asiaStartWib)}–${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.asiaEndWib)} · London ${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.londonStartWib)}–${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.londonEndWib)} · NY ${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.nyStartWib)}–${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.nyEndWib)} WIB`,
              `Default: Asia ${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.asiaStartWib)}–${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.asiaEndWib)} · London ${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.londonStartWib)}–${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.londonEndWib)} · NY ${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.nyStartWib)}–${formatHourWib(DEFAULT_VELA_SESSION_SETTINGS.nyEndWib)} WIB`
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
