/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { RadarIndicators } from '../../utils/calculations';
import { useLanguage } from '../../utils/language';
import { HelpCircle, X, ShieldAlert } from 'lucide-react';

interface RadarChartProps {
  indicators: RadarIndicators;
  size?: number;
}

export const RadarChart: React.FC<RadarChartProps> = ({ indicators, size = 290 }) => {
  const { tr } = useLanguage();
  const [showFormulaModal, setShowFormulaModal] = useState(false);

  useEffect(() => {
    if (!showFormulaModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowFormulaModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showFormulaModal]);

  const axes = [
    {
      key: 'winRateScore',
      label: tr('Rasio Menang', 'Win Rate'),
      val: indicators.isDataSufficient ? indicators.winRateScore : 0,
      description: tr(
        'Persentase kemenangan transaksi (Target: > 50% = 65, >= 70% = 100)',
        'Win rate percentage across closed trades (Target: > 50% = 65, >= 70% = 100)'
      ),
    },
    {
      key: 'profitFactorScore',
      label: tr('Faktor Profit', 'Profit Factor'),
      val: indicators.isDataSufficient ? indicators.profitFactorScore : 0,
      description: tr(
        'Rasio Gross Profit terhadap Gross Loss (Target: >= 1.5 = 70, >= 2.0 = 85, >= 3.0 / ∞ = 100)',
        'Gross Profit to Gross Loss ratio (Target: >= 1.5 = 70, >= 2.0 = 85, >= 3.0 / ∞ = 100)'
      ),
    },
    {
      key: 'rewardRiskScore',
      label: tr('Rata-rata RR', 'Avg RR'),
      val: indicators.isDataSufficient ? indicators.rewardRiskScore : 0,
      description: tr(
        'Rata-rata Realized Risk/Reward aktual (Target: 0R = 50, +0.5R = 70, +1R = 85, >= +2R = 100)',
        'Average realized Risk/Reward multiple (Target: 0R = 50, +0.5R = 70, +1R = 85, >= +2R = 100)'
      ),
    },
    {
      key: 'expectancyScore',
      label: tr('Ekspektansi', 'Expectancy'),
      val: indicators.isDataSufficient ? indicators.expectancyScore : 0,
      description: tr(
        'Nilai harapan rata-rata keuntungan per transaksi (Target: Positif > 0, >= 1% modal = 100)',
        'Expected net return per trade (Target: Positive > 0, >= 1% of balance = 100)'
      ),
    },
    {
      key: 'riskControlScore',
      label: tr('Kontrol Risiko', 'Risk Control'),
      val: indicators.isDataSufficient ? (indicators.riskControlScore ?? indicators.drawdownControlScore) : 0,
      description: tr(
        'Pengendalian risiko dan toleransi drawdown (Target: Max DD <= 2% = 100, <= 5% = 85, <= 10% = 70)',
        'Risk control and drawdown tolerance (Target: Max DD <= 2% = 100, <= 5% = 85, <= 10% = 70)'
      ),
    },
    {
      key: 'consistencyScore',
      label: tr('Konsistensi', 'Consistency'),
      val: indicators.isDataSufficient ? indicators.consistencyScore : 0,
      description: tr(
        'Konsistensi performa harian dan rasio hari profit (Target: >= 60% hari profit = 80+)',
        'Daily performance consistency and profit day ratio (Target: >= 60% profit days = 80+)'
      ),
    },
  ];

  const center = size / 2;
  const radius = center - 54;
  const totalAxes = axes.length;
  const angleStep = (Math.PI * 2) / totalAxes;

  // Grid concentric polygons (20%, 40%, 60%, 80%, 100%)
  const levels = [0.2, 0.4, 0.6, 0.8, 1.0];

  const getCoordinates = (value: number, index: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const r = (value / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  // Polygon points
  const polygonPoints = axes
    .map((axis, i) => {
      const coord = getCoordinates(axis.val, i);
      return `${coord.x},${coord.y}`;
    })
    .join(' ');

  return (
    <div className="relative w-full font-['Arial',Helvetica,sans-serif]">
      {/* Subtle Top Action for Methodology Info */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[#697586] dark:text-[#7D8796]">
          {tr('Geometri Radar 6 Pilar', '6-Pillar Radar Geometry')}
        </span>
        <button
          type="button"
          onClick={() => setShowFormulaModal(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] bg-black/[0.03] dark:bg-white/[0.04] border border-[#DDE3EA] dark:border-white/[0.07] transition-colors cursor-pointer"
          title={tr('Penjelasan formula & kriteria penilaian radar', 'Radar formula & scoring criteria explanation')}
          aria-label={tr('Penjelasan formula & kriteria penilaian radar', 'Radar formula & scoring criteria explanation')}
        >
          <HelpCircle className="h-3 w-3 stroke-[1.75]" />
          <span>{tr('Metodologi', 'Methodology')}</span>
        </button>
      </div>

      {/* Main Radar Presentation */}
      <div className="flex flex-col items-center justify-center relative w-full">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full max-w-[280px] h-auto aspect-square select-none"
        >
          {/* Concentric grid rings */}
          {levels.map((level, lvlIdx) => {
            const ringPoints = axes
              .map((_, i) => {
                const angle = i * angleStep - Math.PI / 2;
                const r = level * radius;
                return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
              })
              .join(' ');

            return (
              <polygon
                key={lvlIdx}
                points={ringPoints}
                fill="none"
                stroke="currentColor"
                className="text-[#DDE3EA] dark:text-[#1E242D]"
                strokeWidth="1"
                strokeDasharray={lvlIdx < 4 ? '2 2' : undefined}
              />
            );
          })}

          {/* Radial axis lines */}
          {axes.map((_, i) => {
            const coord = getCoordinates(100, i);
            return (
              <line
                key={i}
                x1={center}
                y1={center}
                x2={coord.x}
                y2={coord.y}
                stroke="currentColor"
                className="text-[#DDE3EA] dark:text-[#1E242D]"
                strokeWidth="1"
              />
            );
          })}

          {/* Filled polygon for trader performance (only if data is sufficient) */}
          {indicators.isDataSufficient ? (
            <polygon
              points={polygonPoints}
              fill="#3B82F6"
              fillOpacity="0.16"
              stroke="#3B82F6"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
          ) : (
            <polygon
              points={polygonPoints}
              fill="currentColor"
              className="text-[#697586] dark:text-[#7D8796]"
              fillOpacity="0.06"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}

          {/* Node dots and labels */}
          {axes.map((axis, i) => {
            const coord = getCoordinates(axis.val, i);
            const labelCoord = getCoordinates(121, i);

            return (
              <g key={i}>
                <circle
                  cx={coord.x}
                  cy={coord.y}
                  r="3"
                  fill={indicators.isDataSufficient ? '#3B82F6' : '#697586'}
                  stroke="currentColor"
                  className="text-white dark:text-[#0B0E11]"
                  strokeWidth="1.5"
                />
                <text
                  x={labelCoord.x}
                  y={labelCoord.y - 4}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-[#697586] dark:fill-[#8E98A8] text-[10px] font-medium"
                >
                  {axis.label}
                </text>
                <text
                  x={labelCoord.x}
                  y={labelCoord.y + 8}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`tabular-nums text-[10px] font-bold ${
                    indicators.isDataSufficient
                      ? 'fill-[#151D2A] dark:fill-[#F2F5F9]'
                      : 'fill-[#697586] dark:fill-[#7D8796]'
                  }`}
                >
                  {indicators.isDataSufficient ? `${axis.val}` : '-'}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Insufficient data notice (clean inline text, no bulky card) */}
        {!indicators.isDataSufficient && (
          <div className="mt-2 py-2 px-3 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-[#DDE3EA] dark:border-white/[0.06] text-center max-w-xs">
            <div className="flex items-center justify-center gap-1.5 text-amber-600 dark:text-amber-400 text-[11px] font-semibold">
              <ShieldAlert className="h-3.5 w-3.5 stroke-[1.75]" />
              <span>{tr('Data Belum Cukup (Min. 3 Trade)', 'Insufficient Data (Min. 3 Trades)')}</span>
            </div>
            <p className="text-[11px] text-[#697586] dark:text-[#8E98A8] mt-0.5 leading-relaxed">
              {tr(
                'Dibutuhkan minimal 3 transaksi tertutup untuk menghitung profil 6 pilar secara objektif (saat ini: ',
                'At least 3 closed trades are required to objectively calculate the 6-pillar profile (current: '
              )}
              <strong className="text-[#151D2A] dark:text-[#F2F5F9] tabular-nums">{indicators.totalTrades || 0}</strong>).
            </p>
          </div>
        )}
      </div>

      {/* Formula & Scoring Criteria Modal */}
      {showFormulaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowFormulaModal(false)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl border border-[#DDE3EA] dark:border-white/10 bg-white dark:bg-[#0D1014] p-5 shadow-2xl space-y-4 max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#DDE3EA] dark:border-white/[0.07]">
              <h3 className="text-sm font-bold text-[#151D2A] dark:text-[#F2F5F9]">
                {tr('Metodologi & Target 6 Pilar Profil Performa', '6-Pillar Performance Profile Methodology & Targets')}
              </h3>
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                className="p-1 rounded-lg text-[#697586] dark:text-[#8E98A8] hover:text-[#151D2A] dark:hover:text-[#F2F5F9] transition-colors cursor-pointer"
                aria-label={tr('Tutup metodologi', 'Close methodology')}
              >
                <X className="h-4 w-4 stroke-[1.75]" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#151D2A] dark:text-[#F2F5F9]">
              <p className="text-[#697586] dark:text-[#8E98A8] leading-relaxed">
                {tr(
                  'Skala normalisasi skor 0–100 dirancang secara objektif berdasarkan standar evaluasi manajemen risiko prop-firm dan hedge fund profesional:',
                  'The 0–100 normalized scoring scale is objectively designed based on professional prop-firm and hedge fund risk management benchmarks:'
                )}
              </p>

              <div className="divide-y divide-[#DDE3EA] dark:divide-white/[0.06]">
                <div className="py-2.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{tr('1. Rasio Menang (Tingkat Kemenangan)', '1. Win Rate (Winning Percentage)')}</span>
                    <span className="text-[#3B82F6] tabular-nums">{tr('Skala: 0 - 100', 'Scale: 0 - 100')}</span>
                  </div>
                  <p className="text-[#697586] dark:text-[#8E98A8] text-[11px] mt-0.5">
                    {tr(
                      'Normalisasi persentase transaksi menang. Target: 50% = skor 65, sedangkan 70%+ = skor 100.',
                      'Normalized percentage of winning trades. Target: 50% = score 65, while 70%+ = score 100.'
                    )}
                  </p>
                </div>

                <div className="py-2.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{tr('2. Faktor Profit (Faktor Keuntungan)', '2. Profit Factor')}</span>
                    <span className="text-[#3B82F6] tabular-nums">{tr('Profit Kotor / Rugi Kotor', 'Gross Profit / Gross Loss')}</span>
                  </div>
                  <p className="text-[#697586] dark:text-[#8E98A8] text-[11px] mt-0.5">
                    {tr(
                      'Target: 1.0 = skor 50 (impas), 1.5 = skor 70, 2.0 = skor 85, dan ≥ 3.0 atau nol rugi (∞) = skor 100.',
                      'Target: 1.0 = score 50 (breakeven), 1.5 = score 70, 2.0 = score 85, and ≥ 3.0 or zero loss (∞) = score 100.'
                    )}
                  </p>
                </div>

                <div className="py-2.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{tr('3. Rata-rata RR (Risiko / Imbalan Aktual)', '3. Average RR (Realized Risk / Reward)')}</span>
                    <span className="text-[#3B82F6] tabular-nums">{tr('Rata-rata (Profit Bersih / Risiko)', 'Average (Net Profit / Risk)')}</span>
                  </div>
                  <p className="text-[#697586] dark:text-[#8E98A8] text-[11px] mt-0.5">
                    {tr(
                      'Rata-rata Realized Risk/Reward aktual dari seluruh transaksi tertutup: 0R = skor 50, +0.5R = skor 70, +1.0R = skor 85, ≥ +2.0R = skor 100.',
                      'Average realized Risk/Reward across closed trades: 0R = score 50, +0.5R = score 70, +1.0R = score 85, ≥ +2.0R = score 100.'
                    )}
                  </p>
                </div>

                <div className="py-2.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{tr('4. Ekspektansi (Nilai Harapan per Trade)', '4. Expectancy (Expected Value per Trade)')}</span>
                    <span className="text-[#3B82F6] tabular-nums">{tr('Total P/L Bersih / Total Trade', 'Total Net P/L / Total Trades')}</span>
                  </div>
                  <p className="text-[#697586] dark:text-[#8E98A8] text-[11px] mt-0.5">
                    {tr(
                      'Rata-rata keuntungan bersih setiap posisi dieksekusi terhadap modal. Positif bernilai > 50, mencapai 100 jika ≥ 1% modal.',
                      'Average net return per executed trade relative to balance. Positive scores > 50, reaching 100 at ≥ 1% of balance.'
                    )}
                  </p>
                </div>

                <div className="py-2.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{tr('5. Kontrol Risiko (Pengendalian Risiko)', '5. Risk Control (Drawdown Discipline)')}</span>
                    <span className="text-[#3B82F6] tabular-nums">{tr('Toleransi Drawdown Maks.', 'Max Drawdown Tolerance')}</span>
                  </div>
                  <p className="text-[#697586] dark:text-[#8E98A8] text-[11px] mt-0.5">
                    {tr(
                      'Toleransi penurunan modal dari puncak ekuitas: Max DD ≤ 2% = 100, ≤ 5% = 85, ≤ 10% = 70, ≤ 20% = 40.',
                      'Equity drawdown tolerance from peak: Max DD ≤ 2% = 100, ≤ 5% = 85, ≤ 10% = 70, ≤ 20% = 40.'
                    )}
                  </p>
                </div>

                <div className="py-2.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{tr('6. Konsistensi (Konsistensi Harian)', '6. Consistency (Daily Consistency)')}</span>
                    <span className="text-[#3B82F6] tabular-nums">{tr('Rasio Hari Profit', 'Profit Day Ratio')}</span>
                  </div>
                  <p className="text-[#697586] dark:text-[#8E98A8] text-[11px] mt-0.5">
                    {tr(
                      'Rasio hari trading profit dibanding total hari trading aktif: ≥ 60% hari profit = 80+, 50% = 65.',
                      'Ratio of profitable trading days to total active trading days: ≥ 60% profit days = 80+, 50% = 65.'
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                className="px-4 py-1.5 rounded-full bg-[#1769E8] hover:bg-[#1458C4] text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                {tr('Tutup', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
