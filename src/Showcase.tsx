/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TradeVault — Remotion Portrait Promotional Showcase (1080x1920, 30 FPS, 68 Seconds / 2040 Frames)
 *
 * Core Creative & Technical Architecture:
 * 1. Always centered around a high-precision 3D Smartphone Mockup with Dynamic Island, metallic bezels,
 *    physical side buttons, and reactive ambient glow (#00f2fe, #1769E8, #10B981, #F43F5E).
 * 2. 100% live React/Tailwind/SVG UI inside the phone viewport—zero static screenshots.
 * 3. Grounded directly in TradeVault's real calculation engines (`calculateXauusdLot`,
 *    `calculateCompoundingGrowth`, `BrandLogo`) and design system tokens (`#080A0E`, `#11151B`,
 *    `#171D26`, `#252B34`, `#1769E8`, `#00f2fe`, `#10B981`, `#F43F5E`).
 * 4. Realistic Touch Cursor Indicator with multi-ring ripple physics demonstrating tab switching,
 *    Stop Loss typing, button pressing, and scroll gestures inside the smartphone screen.
 */

import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Composition,
  Easing,
  Series,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  LayoutDashboard,
  BookOpen,
  BarChart3,
  ShieldAlert,
  Plus,
  Lock,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Check,
  Search,
  Calendar,
  SlidersHorizontal,
  ArrowUpRight,
  Clock,
  ShieldCheck,
  Target,
  Flame,
  Eye,
} from 'lucide-react';
import { BrandLogo } from './components/layout/BrandLogo';
import { calculateXauusdLot } from './utils/riskCalculator';
import { calculateCompoundingGrowth } from './utils/compoundingCalculator';

// ============================================================================
// VIDEO CONFIGURATION CONSTANTS (1080x1920 Portrait, 30 FPS, 68 Seconds)
// ============================================================================
export const SHOWCASE_FPS = 30;
export const SHOWCASE_WIDTH = 1080;
export const SHOWCASE_HEIGHT = 1920;

export const SCENE_DURATIONS = {
  hookPsychology: 300, // 00s - 10s (10s): Revenge Trading vs Daily Loss Lockout
  dashboardAwareness: 360, // 10s - 22s (12s): Live Balance, Equity Curve, Performance Calendar & Stop Rule
  lotCalculatorAntiMC: 420, // 22s - 36s (14s): Finger types SL 3950, calculates 0.12 safe lot (1% risk)
  tradeLogAndRadar: 420, // 36s - 50s (14s): Session filter, Setup Checklist & 6-Pillar/5-Dim Radar Bloom
  compoundingSimulator: 300, // 50s - 60s (10s): 12-Month Compounding Growth vs Quick-Rich Illusion
  outroBranding: 240, // 60s - 68s (08s): Psychological Fortress Lockup & Final CTA
} as const;

export const SHOWCASE_DURATION_IN_FRAMES =
  SCENE_DURATIONS.hookPsychology +
  SCENE_DURATIONS.dashboardAwareness +
  SCENE_DURATIONS.lotCalculatorAntiMC +
  SCENE_DURATIONS.tradeLogAndRadar +
  SCENE_DURATIONS.compoundingSimulator +
  SCENE_DURATIONS.outroBranding; // 2040 frames (68.0s @ 30fps)

// Phone internal logical coordinate space (px)
const PHONE_WIDTH = 520;
const PHONE_HEIGHT = 1060;

// ============================================================================
// HELPER UTILITIES FOR DETERMINISTIC FRAME INTERPOLATION
// ============================================================================
function clampInterpolate(
  frame: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  easing?: (t: number) => number
): number {
  return interpolate(frame, inputRange, outputRange, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
}

function formatUsd(val: number, decimals = 2): string {
  const abs = Math.abs(val);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return val < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatSignedUsd(val: number, decimals = 2): string {
  const abs = Math.abs(val);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (val > 0.004) return `+$${formatted}`;
  if (val < -0.004) return `-$${formatted}`;
  return `$${formatted}`;
}

// ============================================================================
// REALISTIC TOUCH CURSOR & RIPPLE INDICATOR (INSIDE SMARTPHONE VIEWPORT)
// ============================================================================
export interface TouchKeyframe {
  frame: number;
  x: number; // 0 .. PHONE_WIDTH (520)
  y: number; // 0 .. PHONE_HEIGHT (1060)
  tap?: boolean;
  label?: string;
}

interface TouchCursorOverlayProps {
  keyframes: TouchKeyframe[];
  visible?: boolean;
}

const TouchCursorOverlay: React.FC<TouchCursorOverlayProps> = ({
  keyframes,
  visible = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!visible || keyframes.length === 0) return null;

  // Resolve current x, y by piecewise smooth interpolation across keyframes
  let currentX = keyframes[0].x;
  let currentY = keyframes[0].y;

  for (let i = 0; i < keyframes.length - 1; i++) {
    const curr = keyframes[i];
    const next = keyframes[i + 1];
    if (frame >= curr.frame && frame <= next.frame) {
      const span = Math.max(1, next.frame - curr.frame);
      const moveDuration = Math.min(24, span);
      const progress = clampInterpolate(
        frame,
        [curr.frame, curr.frame + moveDuration],
        [0, 1],
        Easing.bezier(0.22, 1, 0.36, 1)
      );
      currentX = curr.x + (next.x - curr.x) * progress;
      currentY = curr.y + (next.y - curr.y) * progress;
      break;
    } else if (frame > next.frame) {
      currentX = next.x;
      currentY = next.y;
    }
  }

  // Check if any tap occurred recently (within 22 frames)
  const activeTap = keyframes.find(
    (k) => k.tap && frame >= k.frame && frame <= k.frame + 22
  );
  const tapLocalFrame = activeTap ? frame - activeTap.frame : -1;

  const pressScale =
    tapLocalFrame >= 0
      ? interpolate(tapLocalFrame, [0, 4, 14, 22], [1, 0.78, 1.04, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;

  const rippleRadius =
    tapLocalFrame >= 0
      ? interpolate(tapLocalFrame, [0, 20], [16, 68], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;

  const rippleOpacity =
    tapLocalFrame >= 0
      ? interpolate(tapLocalFrame, [0, 5, 20], [0.95, 0.75, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;

  const secondaryRippleRadius =
    tapLocalFrame >= 3
      ? interpolate(tapLocalFrame, [3, 22], [12, 92], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;

  const secondaryRippleOpacity =
    tapLocalFrame >= 3
      ? interpolate(tapLocalFrame, [3, 22], [0.6, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;

  const fadeOpacity = clampInterpolate(frame, [0, 10], [0, 1]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 90,
        opacity: fadeOpacity,
      }}
    >
      {/* Primary cyan/blue shockwave ripple */}
      {tapLocalFrame >= 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              left: currentX - rippleRadius,
              top: currentY - rippleRadius,
              width: rippleRadius * 2,
              height: rippleRadius * 2,
              borderRadius: '9999px',
              border: '2.5px solid #00f2fe',
              background:
                'radial-gradient(circle, rgba(0,242,254,0.28) 0%, rgba(23,105,232,0.08) 65%, transparent 100%)',
              opacity: rippleOpacity,
              boxShadow: '0 0 24px rgba(0, 242, 254, 0.55)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: currentX - secondaryRippleRadius,
              top: currentY - secondaryRippleRadius,
              width: secondaryRippleRadius * 2,
              height: secondaryRippleRadius * 2,
              borderRadius: '9999px',
              border: '1.5px solid rgba(56, 189, 248, 0.65)',
              opacity: secondaryRippleOpacity,
            }}
          />
        </>
      )}

      {/* Capacitive finger touch disc + ergonomic thumb shadow */}
      <div
        style={{
          position: 'absolute',
          left: currentX - 22,
          top: currentY - 22,
          width: 44,
          height: 44,
          borderRadius: '9999px',
          transform: `scale(${pressScale})`,
          background:
            'radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.95) 0%, rgba(0, 242, 254, 0.82) 45%, rgba(23, 105, 232, 0.85) 100%)',
          border: '2px solid rgba(255, 255, 255, 0.92)',
          boxShadow:
            '0 8px 22px rgba(0, 0, 0, 0.65), 0 0 18px rgba(0, 242, 254, 0.65), inset 0 1px 3px rgba(255,255,255,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '9999px',
            backgroundColor: '#ffffff',
            boxShadow: '0 0 8px #00f2fe',
          }}
        />
      </div>

      {/* Optional micro action tag next to finger on tap */}
      {activeTap?.label && tapLocalFrame >= 0 && tapLocalFrame <= 20 && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(PHONE_WIDTH - 170, Math.max(16, currentX - 65)),
            top: Math.max(54, currentY - 58),
            padding: '4px 10px',
            borderRadius: 8,
            backgroundColor: 'rgba(8, 10, 14, 0.92)',
            border: '1px solid rgba(0, 242, 254, 0.55)',
            color: '#F2F5F9',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 16px rgba(0,0,0,0.55)',
            transform: `translateY(${interpolate(
              tapLocalFrame,
              [0, 6, 20],
              [6, 0, -4],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )}px)`,
            opacity: interpolate(tapLocalFrame, [0, 4, 16, 20], [0, 1, 1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {activeTap.label}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SMARTPHONE MOCKUP SHELL + OUTER NARRATIVE STAGE (1080x1920)
// ============================================================================
export type ActiveAppTab = 'dashboard' | 'trades' | 'analytics' | 'risk';

interface SmartphoneStageProps {
  sceneBadge: string;
  headline: string;
  highlightText?: string;
  subheadline: string;
  bottomCalloutTitle: string;
  bottomCalloutBody: string;
  bottomCalloutTone?: 'cyan' | 'emerald' | 'rose' | 'blue';
  activeTab: ActiveAppTab;
  ambientColor?: string;
  phoneTilt?: { rotateX: number; rotateY: number; scale: number; translateY?: number };
  touchKeyframes?: TouchKeyframe[];
  statusTime?: string;
  children: React.ReactNode;
}

const SmartphoneStage: React.FC<SmartphoneStageProps> = ({
  sceneBadge,
  headline,
  highlightText,
  subheadline,
  bottomCalloutTitle,
  bottomCalloutBody,
  bottomCalloutTone = 'cyan',
  activeTab,
  ambientColor = '#00f2fe',
  phoneTilt = { rotateX: 0, rotateY: 0, scale: 1, translateY: 0 },
  touchKeyframes = [],
  statusTime = '09:41',
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerEnter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 110, mass: 0.8 },
  });

  const footerEnter = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 18, stiffness: 110, mass: 0.8 },
  });

  const tonePalette = {
    cyan: {
      border: 'rgba(0, 242, 254, 0.38)',
      bg: 'rgba(14, 22, 34, 0.88)',
      accent: '#00f2fe',
      pillBg: 'rgba(0, 242, 254, 0.12)',
    },
    emerald: {
      border: 'rgba(16, 185, 129, 0.42)',
      bg: 'rgba(10, 24, 20, 0.88)',
      accent: '#10B981',
      pillBg: 'rgba(16, 185, 129, 0.14)',
    },
    rose: {
      border: 'rgba(244, 63, 94, 0.45)',
      bg: 'rgba(28, 12, 18, 0.90)',
      accent: '#F43F5E',
      pillBg: 'rgba(244, 63, 94, 0.15)',
    },
    blue: {
      border: 'rgba(56, 189, 248, 0.38)',
      bg: 'rgba(12, 20, 34, 0.88)',
      accent: '#38BDF8',
      pillBg: 'rgba(56, 189, 248, 0.14)',
    },
  }[bottomCalloutTone];

  const bottomTabs: { id: ActiveAppTab; label: string; icon: React.FC<any> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'trades', label: 'Trade Log', icon: BookOpen },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'risk', label: 'Risk', icon: ShieldAlert },
  ];

  return (
    <AbsoluteFill
      className="dark"
      style={{
        backgroundColor: '#04060A',
        fontFamily: 'Arial, Helvetica, sans-serif',
        color: '#F2F5F9',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '44px 48px 42px 48px',
      }}
    >
      {/* Subtle Architectural Grid & Radial Ambient Backlight */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(to right, rgba(37, 43, 52, 0.16) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(37, 43, 52, 0.16) 1px, transparent 1px)
          `,
          backgroundSize: '54px 54px',
          maskImage:
            'radial-gradient(ellipse 80% 75% at 50% 50%, black 35%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 75% at 50% 50%, black 35%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Dynamic Ambient Halo Behind Smartphone */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 820,
          height: 1180,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle at 50% 50%, ${ambientColor}2E 0%, rgba(23, 105, 232, 0.12) 42%, transparent 72%)`,
          filter: 'blur(48px)',
          pointerEvents: 'none',
        }}
      />

      {/* ====================================================================
          TOP NARRATIVE ZONE (OUTSIDE SMARTPHONE: SHARP TRADER COPYWRITING)
      ==================================================================== */}
      <div
        style={{
          position: 'relative',
          zIndex: 20,
          width: '100%',
          maxWidth: 960,
          textAlign: 'center',
          transform: `translateY(${interpolate(headerEnter, [0, 1], [-24, 0])}px)`,
          opacity: headerEnter,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 18px',
            borderRadius: 9999,
            backgroundColor: tonePalette.pillBg,
            border: `1px solid ${tonePalette.border}`,
            marginBottom: 16,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 9999,
              backgroundColor: tonePalette.accent,
              boxShadow: `0 0 10px ${tonePalette.accent}`,
            }}
          />
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: tonePalette.accent,
            }}
          >
            {sceneBadge}
          </span>
        </div>

        <h1
          style={{
            fontSize: 44,
            lineHeight: 1.14,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: '#F8FAFC',
            margin: '0 auto 12px auto',
          }}
        >
          {headline}{' '}
          {highlightText && (
            <span
              style={{
                color: tonePalette.accent,
                textShadow: `0 0 28px ${tonePalette.accent}44`,
              }}
            >
              {highlightText}
            </span>
          )}
        </h1>

        <p
          style={{
            fontSize: 22,
            lineHeight: 1.42,
            color: '#94A3B8',
            maxWidth: 880,
            margin: '0 auto',
            fontWeight: 500,
          }}
        >
          {subheadline}
        </p>
      </div>

      {/* ====================================================================
          CENTERpiece: REALISTIC 3D SMARTPHONE MOCKUP ( TITANIUM BEZEL + DYNAMIC ISLAND )
      ==================================================================== */}
      <div
        style={{
          position: 'relative',
          zIndex: 30,
          perspective: 1600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '8px 0',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: PHONE_WIDTH + 32, // 552px outer chassis
            height: PHONE_HEIGHT + 32, // 1092px outer chassis
            borderRadius: 64,
            padding: 16,
            background:
              'linear-gradient(145deg, #2A3241 0%, #12161F 38%, #090C10 72%, #1E2532 100%)',
            boxShadow: `
              0 40px 95px -15px rgba(0, 0, 0, 0.92),
              0 0 65px -10px ${ambientColor}40,
              inset 0 2px 3px rgba(255, 255, 255, 0.28),
              inset 0 -2px 4px rgba(0, 0, 0, 0.85)
            `,
            border: '1.5px solid rgba(255, 255, 255, 0.14)',
            transform: `translateY(${phoneTilt.translateY ?? 0}px) scale(${
              phoneTilt.scale
            }) rotateX(${phoneTilt.rotateX}deg) rotateY(${phoneTilt.rotateY}deg)`,
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Physical Hardware Buttons on Left & Right Titanium Frame */}
          {/* Action Button (Left Top) */}
          <div
            style={{
              position: 'absolute',
              left: -4,
              top: 168,
              width: 4,
              height: 42,
              borderRadius: '4px 0 0 4px',
              background: 'linear-gradient(180deg, #475569, #1E293B)',
              boxShadow: '-1px 0 3px rgba(0,0,0,0.6)',
            }}
          />
          {/* Volume Up (Left Mid) */}
          <div
            style={{
              position: 'absolute',
              left: -4,
              top: 236,
              width: 4,
              height: 76,
              borderRadius: '4px 0 0 4px',
              background: 'linear-gradient(180deg, #475569, #1E293B)',
              boxShadow: '-1px 0 3px rgba(0,0,0,0.6)',
            }}
          />
          {/* Volume Down (Left Lower) */}
          <div
            style={{
              position: 'absolute',
              left: -4,
              top: 328,
              width: 4,
              height: 76,
              borderRadius: '4px 0 0 4px',
              background: 'linear-gradient(180deg, #475569, #1E293B)',
              boxShadow: '-1px 0 3px rgba(0,0,0,0.6)',
            }}
          />
          {/* Power / Side Button (Right) */}
          <div
            style={{
              position: 'absolute',
              right: -4,
              top: 268,
              width: 4,
              height: 108,
              borderRadius: '0 4px 4px 0',
              background: 'linear-gradient(180deg, #475569, #1E293B)',
              boxShadow: '1px 0 3px rgba(0,0,0,0.6)',
            }}
          />

          {/* Inner Glass Screen Viewport (520 x 1060) */}
          <div
            style={{
              position: 'relative',
              width: PHONE_WIDTH,
              height: PHONE_HEIGHT,
              borderRadius: 48,
              backgroundColor: '#080A0E',
              overflow: 'hidden',
              border: '1px solid #1E242D',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* ==============================================================
                1. SMARTPHONE STATUS BAR + DYNAMIC ISLAND
            ============================================================== */}
            <div
              style={{
                position: 'relative',
                zIndex: 60,
                height: 48,
                padding: '0 26px',
                backgroundColor: '#080A0E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              {/* Carrier / Time */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  color: '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {statusTime}
              </span>

              {/* Dynamic Island Hardware Cutout */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 9,
                  transform: 'translateX(-50%)',
                  width: 138,
                  height: 30,
                  borderRadius: 9999,
                  backgroundColor: '#000000',
                  border: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 12px',
                  boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.08)',
                }}
              >
                {/* Live Privacy / Risk Guard LED */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 9999,
                      backgroundColor: ambientColor,
                      boxShadow: `0 0 6px ${ambientColor}`,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: '#94A3B8',
                      letterSpacing: '0.04em',
                    }}
                  >
                    TV·GUARD
                  </span>
                </div>
                {/* Front Camera Lens */}
                <div
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 9999,
                    background:
                      'radial-gradient(circle at 35% 35%, #38BDF8 0%, #0F172A 55%, #020617 100%)',
                    border: '1.5px solid #1E293B',
                  }}
                />
              </div>

              {/* Right Signal / 5G / Battery Icons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 11 }}>
                  <span style={{ width: 3, height: 4, borderRadius: 1, backgroundColor: '#F2F5F9' }} />
                  <span style={{ width: 3, height: 6, borderRadius: 1, backgroundColor: '#F2F5F9' }} />
                  <span style={{ width: 3, height: 9, borderRadius: 1, backgroundColor: '#F2F5F9' }} />
                  <span style={{ width: 3, height: 11, borderRadius: 1, backgroundColor: '#F2F5F9' }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#F2F5F9' }}>5G</span>
                <div
                  style={{
                    width: 22,
                    height: 11,
                    borderRadius: 3,
                    border: '1.2px solid rgba(242,245,249,0.65)',
                    padding: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '86%',
                      height: '100%',
                      borderRadius: 1.5,
                      backgroundColor: '#10B981',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* ==============================================================
                2. AUTHENTIC TRADEVAULT MOBILE TOP NAVBAR (INSIDE PHONE)
            ============================================================== */}
            <div
              style={{
                height: 54,
                padding: '0 18px',
                backgroundColor: '#101318',
                borderBottom: '1px solid #20252D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                zIndex: 50,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BrandLogo variant="symbol" className="h-7 w-7" />
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                        color: '#F2F5F9',
                      }}
                    >
                      Trade<span style={{ color: '#38BDF8' }}>Vault</span>
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        backgroundColor: '#171D26',
                        border: '1px solid #252B34',
                        color: '#929BA9',
                        letterSpacing: '0.06em',
                      }}
                    >
                      XAUUSD · MT5
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Account Discipline Pill */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 10px',
                    borderRadius: 8,
                    backgroundColor: '#161A22',
                    border: '1px solid #252B34',
                  }}
                >
                  <ShieldCheck style={{ width: 13, height: 13, color: '#10B981' }} />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#F2F5F9',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    Rule 1% Aktif
                  </span>
                </div>
              </div>
            </div>

            {/* ==============================================================
                3. LIVE SCROLLABLE / INTERACTIVE SCREEN BODY
            ============================================================== */}
            <div
              style={{
                position: 'relative',
                flex: 1,
                backgroundColor: '#080A0E',
                overflow: 'hidden',
              }}
            >
              {children}
            </div>

            {/* ==============================================================
                4. AUTHENTIC TRADEVAULT 5-SLOT MOBILE BOTTOM NAVIGATION BAR
            ============================================================== */}
            <div
              style={{
                height: 76,
                backgroundColor: 'rgba(11, 13, 17, 0.98)',
                borderTop: '1px solid #20252D',
                padding: '6px 10px 14px 10px',
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                alignItems: 'center',
                flexShrink: 0,
                zIndex: 55,
              }}
            >
              {bottomTabs.slice(0, 2).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <div
                    key={tab.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px 4px',
                      borderRadius: 12,
                      backgroundColor: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                      color: isActive ? '#F2F4F7' : '#8E98A8',
                    }}
                  >
                    <Icon
                      style={{
                        width: 18,
                        height: 18,
                        marginBottom: 3,
                        color: isActive ? '#38BDF8' : '#8E98A8',
                        strokeWidth: isActive ? 2.3 : 1.75,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: isActive ? 700 : 500,
                      }}
                    >
                      {tab.label}
                    </span>
                  </div>
                );
              })}

              {/* Center Position 3: Monochrome [+] Quick Add Trade Button */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 13,
                    backgroundColor: '#1A202A',
                    border: '1px solid rgba(255,255,255,0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#F2F4F7',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
                  }}
                >
                  <Plus style={{ width: 20, height: 20, strokeWidth: 2.3 }} />
                </div>
              </div>

              {bottomTabs.slice(2).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <div
                    key={tab.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px 4px',
                      borderRadius: 12,
                      backgroundColor: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                      color: isActive ? '#F2F4F7' : '#8E98A8',
                    }}
                  >
                    <Icon
                      style={{
                        width: 18,
                        height: 18,
                        marginBottom: 3,
                        color: isActive ? '#38BDF8' : '#8E98A8',
                        strokeWidth: isActive ? 2.3 : 1.75,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: isActive ? 700 : 500,
                      }}
                    >
                      {tab.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* iOS/Android Home Gesture Bar */}
            <div
              style={{
                position: 'absolute',
                bottom: 5,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 134,
                height: 4,
                borderRadius: 9999,
                backgroundColor: 'rgba(242, 245, 249, 0.28)',
                zIndex: 65,
              }}
            />

            {/* ==============================================================
                5. TOUCH CURSOR OVERLAY (SIMULATED FINGER INTERACTION)
            ============================================================== */}
            <TouchCursorOverlay keyframes={touchKeyframes} />
          </div>
        </div>
      </div>

      {/* ====================================================================
          BOTTOM PSYCHOLOGICAL INSIGHT CALLOUT CARD (OUTSIDE SMARTPHONE)
      ==================================================================== */}
      <div
        style={{
          position: 'relative',
          zIndex: 20,
          width: '100%',
          maxWidth: 940,
          padding: '20px 28px',
          borderRadius: 22,
          backgroundColor: tonePalette.bg,
          border: `1.5px solid ${tonePalette.border}`,
          boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          transform: `translateY(${interpolate(footerEnter, [0, 1], [24, 0])}px)`,
          opacity: footerEnter,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: tonePalette.accent,
              marginBottom: 6,
            }}
          >
            {bottomCalloutTitle}
          </div>
          <div
            style={{
              fontSize: 20,
              lineHeight: 1.38,
              color: '#E2E8F0',
              fontWeight: 500,
            }}
          >
            {bottomCalloutBody}
          </div>
        </div>

        <div
          style={{
            padding: '10px 16px',
            borderRadius: 14,
            backgroundColor: 'rgba(8, 10, 14, 0.85)',
            border: '1px solid #252B34',
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#929BA9',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Prinsip Utama
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: '#F2F5F9',
              marginTop: 2,
            }}
          >
            Protect Capital First
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ============================================================================
// SCENE 1: HOOK PSIKOLOGI — REVENGE TRADING VS DAILY LOSS GUARD (300 FRAMES)
// ============================================================================
const SceneHookPsychology: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // From frame 0..95: Daily Loss climbs from $90 to $150 (100% of 3% daily limit on $5,000 account)
  const dailyLoss = clampInterpolate(
    frame,
    [15, 95],
    [95, 150],
    Easing.out(Easing.cubic)
  );
  const dailyLimit = 150;
  const usagePct = (dailyLoss / dailyLimit) * 100;
  const isLocked = frame >= 92;

  // At frame 155, trader's emotional finger tries to tap "+ Paksa Entry Baru (Revenge Trade)"
  // and at frame 160 the Psychological Lockout Modal intercepts and protects the remaining $4,850!
  const showInterceptModal = frame >= 162;
  const modalPop = spring({
    frame: Math.max(0, frame - 162),
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.7 },
  });

  const touchKeyframes: TouchKeyframe[] = [
    { frame: 20, x: 260, y: 310 },
    { frame: 85, x: 380, y: 245, tap: true, label: 'Cek Batas Loss Harian' },
    { frame: 155, x: 260, y: 690, tap: true, label: 'Coba Entry Lagi (Emosi)' },
    { frame: 235, x: 260, y: 625, tap: true, label: 'Patuhi Stop Trading' },
  ];

  const tiltY = interpolate(frame, [0, 150, 300], [-3.5, 2.5, 0]);
  const tiltX = interpolate(frame, [0, 150, 300], [2, -1.5, 1]);

  return (
    <SmartphoneStage
      sceneBadge="PSYCHOLOGICAL FORTRESS · ANTI REVENGE TRADING"
      headline="Musuh Terbesar Trader Bukan Market."
      highlightText="Tapi Emosinya Saat Loss."
      subheadline="Loss beruntun memicu balas dendam (revenge trade) dan over-lot hingga Margin Call. TradeVault mengunci disiplinmu sebelum modal habis."
      bottomCalloutTitle="PROTEKSI BATAS RUGI HARIAN (DAILY LOSS LIMIT 3.0%)"
      bottomCalloutBody="Saat akumulasi loss hari ini menyentuh batas terukur ($150.00), sistem memberi sinyal tegas: BERHENTI TRADING HARI INI. Modal $4,850.00 tetap aman."
      bottomCalloutTone={frame < 225 ? 'rose' : 'cyan'}
      activeTab="risk"
      ambientColor={frame < 220 ? '#F43F5E' : '#00f2fe'}
      phoneTilt={{ rotateX: tiltX, rotateY: tiltY, scale: 1 }}
      touchKeyframes={touchKeyframes}
      statusTime="14:32"
    >
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header Card: Proteksi & Aturan Risiko Harian */}
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: isLocked ? '1.5px solid #F43F5E' : '1px solid #252B34',
            boxShadow: isLocked ? '0 0 28px rgba(244, 63, 94, 0.18)' : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#929BA9',
              }}
            >
              DAILY LOSS USAGE · HARI INI
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 6,
                backgroundColor: isLocked
                  ? 'rgba(244, 63, 94, 0.16)'
                  : 'rgba(245, 158, 11, 0.16)',
                color: isLocked ? '#F43F5E' : '#F59E0B',
              }}
            >
              {isLocked ? 'STOP TRADING HARI INI' : 'WARNING ZONA RAWAN'}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: '#F43F5E',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                -{formatUsd(dailyLoss)}
              </div>
              <div style={{ fontSize: 12, color: '#929BA9', marginTop: 2 }}>
                Dari Batas Maksimal Harian {formatUsd(dailyLimit)} (3.0% Modal)
              </div>
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: isLocked ? '#F43F5E' : '#F59E0B',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {usagePct.toFixed(0)}%
            </div>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              width: '100%',
              height: 10,
              borderRadius: 9999,
              backgroundColor: '#171D26',
              overflow: 'hidden',
              border: '1px solid #252B34',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, usagePct)}%`,
                height: '100%',
                background: isLocked
                  ? 'linear-gradient(90deg, #F59E0B 0%, #F43F5E 100%)'
                  : '#F59E0B',
              }}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid #20252D',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: '#929BA9', textTransform: 'uppercase' }}>
                Saldo Ekuitas Tersisa
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: '#10B981',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 2,
                }}
              >
                $4,850.00 (97.0% Utuh)
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#929BA9', textTransform: 'uppercase' }}>
                Sisa Kuota Risiko Hari Ini
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: '#F43F5E',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 2,
                }}
              >
                {formatUsd(Math.max(0, dailyLimit - dailyLoss))} (Terkunci)
              </div>
            </div>
          </div>
        </div>

        {/* Today's Loss Streak Log causing emotional trigger */}
        <div
          style={{
            padding: 15,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#929BA9',
              }}
            >
              RIWAYAT EKSEKUSI HARI INI (3X CONSECUTIVE LOSS)
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#F43F5E' }}>
              3 / 3 Batas Streak
            </span>
          </div>

          {[
            {
              pair: 'XAUUSD',
              side: 'BUY',
              lot: '0.10 Lot',
              time: '10:15 WIB · London Open',
              pnl: '-$50.00',
              note: 'SL 50 Pips Tersentuh (1.0% Risk)',
            },
            {
              pair: 'XAUUSD',
              side: 'SELL',
              lot: '0.10 Lot',
              time: '12:40 WIB · London Mid',
              pnl: '-$50.00',
              note: 'Liquidity Sweep High (1.0% Risk)',
            },
            {
              pair: 'XAUUSD',
              side: 'BUY',
              lot: '0.10 Lot',
              time: '14:20 WIB · Pre-NY',
              pnl: '-$50.00',
              note: 'Batas Loss Harian 3.0% Tercapai',
            },
          ].map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 10px',
                borderRadius: 10,
                backgroundColor: '#161A22',
                border: '1px solid #20252D',
                marginBottom: idx < 2 ? 8 : 0,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#F2F5F9' }}>
                    {item.pair}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: item.side === 'BUY' ? '#10B981' : '#F43F5E',
                    }}
                  >
                    {item.side}
                  </span>
                  <span style={{ fontSize: 11, color: '#929BA9' }}>{item.lot}</span>
                </div>
                <div style={{ fontSize: 11, color: '#929BA9', marginTop: 2 }}>
                  {item.note}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: '#F43F5E',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {item.pnl}
                </div>
                <div style={{ fontSize: 9.5, color: '#929BA9' }}>CLOSED</div>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison Card: Without TradeVault vs With TradeVault */}
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              backgroundColor: 'rgba(244, 63, 94, 0.08)',
              border: '1px solid rgba(244, 63, 94, 0.28)',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: '#F43F5E' }}>
              TANPA DISIPLIN (REVENGE)
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#F2F5F9', marginTop: 4 }}>
              Balas 1.00 Lot → MC
            </div>
            <div style={{ fontSize: 11, color: '#929BA9', marginTop: 2 }}>
              Modal $5,000 Hancur Semalam
            </div>
          </div>
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              backgroundColor: 'rgba(0, 242, 254, 0.08)',
              border: '1px solid rgba(0, 242, 254, 0.35)',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: '#00f2fe' }}>
              DENGAN TRADEVAULT
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#10B981', marginTop: 4 }}>
              Stop di -3% ($4,850)
            </div>
            <div style={{ fontSize: 11, color: '#929BA9', marginTop: 2 }}>
              97% Modal Aman untuk Besok
            </div>
          </div>
        </div>

        {/* Temptation Button that gets intercepted */}
        <div
          style={{
            padding: '13px 16px',
            borderRadius: 12,
            backgroundColor: '#171D26',
            border: '1px dashed #F43F5E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#F43F5E',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          <AlertTriangle style={{ width: 16, height: 16 }} />
          <span>+ Paksa Buka Posisi Ke-4 (Revenge Trade)</span>
        </div>
      </div>

      {/* ====================================================================
          PSYCHOLOGICAL LOCKOUT MODAL OVERLAY INSIDE PHONE SCREEN
      ==================================================================== */}
      {showInterceptModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(5, 7, 11, 0.86)',
            backdropFilter: 'blur(8px)',
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 22,
          }}
        >
          <div
            style={{
              width: '100%',
              borderRadius: 20,
              backgroundColor: '#11151B',
              border: '1.5px solid #00f2fe',
              boxShadow: '0 24px 60px rgba(0,0,0,0.85), 0 0 35px rgba(0, 242, 254, 0.25)',
              padding: 22,
              transform: `scale(${interpolate(modalPop, [0, 1], [0.86, 1])})`,
              opacity: modalPop,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: 'rgba(244, 63, 94, 0.14)',
                border: '1px solid rgba(244, 63, 94, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <Lock style={{ width: 24, height: 24, color: '#F43F5E' }} />
            </div>

            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: '#00f2fe',
                textTransform: 'uppercase',
              }}
            >
              PROTEKSI DISIPLIN TRADEVAULT AKTIF
            </div>

            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: '#F2F5F9',
                marginTop: 6,
                lineHeight: 1.25,
              }}
            >
              Waktunya Berhenti Trading Hari Ini.
            </div>

            <p
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: '#929BA9',
                marginTop: 8,
              }}
            >
              Anda telah mencapai batas kerugian harian{' '}
              <strong style={{ color: '#F43F5E' }}>-$150.00 (3.0%)</strong> dan{' '}
              <strong style={{ color: '#F43F5E' }}>3x Loss Beruntun</strong>. Memaksakan entry
              saat emosional adalah penyebab utama Margin Call.
            </p>

            <div
              style={{
                padding: 12,
                borderRadius: 12,
                backgroundColor: '#171D26',
                border: '1px solid #252B34',
                marginTop: 12,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 12, color: '#929BA9' }}>Modal Terlindungi:</span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: '#10B981',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                $4,850.00 (97% Ekuitas)
              </span>
            </div>

            <div
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 12,
                background:
                  frame >= 235
                    ? 'linear-gradient(90deg, #10B981 0%, #059669 100%)'
                    : 'linear-gradient(90deg, #1769E8 0%, #00f2fe 100%)',
                color: '#04060A',
                fontWeight: 800,
                fontSize: 13.5,
                textAlign: 'center',
                boxShadow: '0 0 20px rgba(0, 242, 254, 0.35)',
              }}
            >
              {frame >= 235
                ? '✓ Chart Ditutup — Disiplin Terjaga'
                : 'Saya Mengerti · Istirahat & Evaluasi Besok'}
            </div>
          </div>
        </div>
      )}
    </SmartphoneStage>
  );
};

// ============================================================================
// SCENE 2: DASHBOARD SELF-AWARENESS & KALENDER DISIPLIN (360 FRAMES)
// ============================================================================
const SceneDashboardAwareness: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animated counters for Balance, Net Profit, Win Rate
  const countProgress = clampInterpolate(
    frame,
    [15, 115],
    [0, 1],
    Easing.out(Easing.cubic)
  );
  const currentBalance = 5000 + 1420.5 * countProgress;
  const netProfit = 1420.5 * countProgress;
  const growthPct = 28.41 * countProgress;
  const winRate = 68.4 * countProgress;
  const profitFactor = 1.0 + 1.64 * countProgress;

  // Live Equity Curve SVG strokeDashoffset animation
  const curveDrawProgress = clampInterpolate(
    frame,
    [25, 145],
    [0, 1],
    Easing.inOut(Easing.cubic)
  );

  // Smooth vertical scroll inside the phone viewport to reveal Performance Calendar
  const scrollY = clampInterpolate(
    frame,
    [155, 215],
    [0, -255],
    Easing.bezier(0.22, 1, 0.36, 1)
  );

  // Tap on day 20 ("Target Harian Tercapai -> Stop Trading") at frame 270
  const selectedDay = frame >= 270;

  const touchKeyframes: TouchKeyframe[] = [
    { frame: 10, x: 58, y: 948, tap: true, label: 'Buka Dashboard' },
    { frame: 110, x: 390, y: 410, tap: true, label: 'Kurva Ekuitas +28.4%' },
    { frame: 165, x: 260, y: 680 },
    { frame: 205, x: 260, y: 360 },
    { frame: 270, x: 342, y: 635, tap: true, label: 'Cek Hari Profit & Stop Rule' },
  ];

  const equityPoints = [
    { x: 16, y: 122 },
    { x: 58, y: 114 },
    { x: 102, y: 119 }, // small controlled -1% loss
    { x: 146, y: 98 },
    { x: 190, y: 84 },
    { x: 234, y: 90 }, // small controlled -1% loss
    { x: 278, y: 68 },
    { x: 322, y: 52 },
    { x: 366, y: 56 },
    { x: 410, y: 34 },
    { x: 452, y: 18 },
  ];

  const polylineStr = equityPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const areaStr = `16,136 ${polylineStr} 452,136`;
  const pathLength = 620;

  // Calendar days for November 2026
  const calendarDays = [
    { d: 2, type: 'profit', pnl: '+$145' },
    { d: 3, type: 'profit', pnl: '+$110' },
    { d: 4, type: 'loss', pnl: '-$60' },
    { d: 5, type: 'profit', pnl: '+$180' },
    { d: 6, type: 'notrade', pnl: 'NO TRADE' },
    { d: 9, type: 'profit', pnl: '+$125' },
    { d: 10, type: 'profit', pnl: '+$160' },
    { d: 11, type: 'notrade', pnl: 'NO TRADE' },
    { d: 12, type: 'loss', pnl: '-$60' },
    { d: 13, type: 'profit', pnl: '+$195' },
    { d: 16, type: 'profit', pnl: '+$140' },
    { d: 17, type: 'loss', pnl: '-$58' },
    { d: 18, type: 'profit', pnl: '+$172' },
    { d: 19, type: 'notrade', pnl: 'NO TRADE' },
    { d: 20, type: 'profit', pnl: '+$185', highlight: true },
  ];

  return (
    <SmartphoneStage
      sceneBadge="01 · SELF-AWARENESS & PERFORMANCE CALENDAR"
      headline="Sadar Penuh Atas Akunmu."
      highlightText="Tahu Kapan Harus Berhenti."
      subheadline="Pantau saldo riil, kurva ekuitas tanpa manipulasi, serta kalender disiplin harian: Profit Days, Loss Days terkendali, dan No-Trade Days."
      bottomCalloutTitle="DISIPLIN BERHENTI SAAT TARGET HARIAN TERCAPAI"
      bottomCalloutBody="Trader profesional tidak trading setiap jam. Saat profit harian sudah mengamankan target (+2R), TradeVault mengingatkan untuk mengunci profit dan tutup chart."
      bottomCalloutTone="emerald"
      activeTab="dashboard"
      ambientColor="#10B981"
      phoneTilt={{
        rotateX: interpolate(frame, [0, 180, 360], [1.5, -1.5, 1]),
        rotateY: interpolate(frame, [0, 180, 360], [3, -2.5, 2]),
        scale: 1,
      }}
      touchKeyframes={touchKeyframes}
      statusTime="09:41"
    >
      <div
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          transform: `translateY(${scrollY}px)`,
        }}
      >
        {/* Total Balance Hero Card (Dual Currency USD + IDR) */}
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#929BA9',
              }}
            >
              TOTAL ACCOUNT EQUITY · REAL-TIME
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#10B981',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              +{growthPct.toFixed(2)}% All-Time
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                }}
              >
                {formatUsd(currentBalance)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#929BA9',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 2,
                }}
              >
                ≈ Rp {Math.round(currentBalance * 15850).toLocaleString('id-ID')} · Modal Awal $5,000.00
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#929BA9', textTransform: 'uppercase' }}>
                Net Profit Bersih
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: '#10B981',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatSignedUsd(netProfit)}
              </div>
            </div>
          </div>

          {/* 3 Mini KPI Metrics Row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid #20252D',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: '#929BA9' }}>WIN RATE</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#10B981',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {winRate.toFixed(1)}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#929BA9' }}>PROFIT FACTOR</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {profitFactor.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#929BA9' }}>MAX DRAWDOWN</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#00f2fe',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                2.85% (Aman)
              </div>
            </div>
          </div>
        </div>

        {/* Live Animated Equity Curve Card */}
        <div
          style={{
            padding: 15,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#F2F5F9',
                }}
              >
                KURVA EKUITAS (EQUITY CURVE)
              </span>
              <div style={{ fontSize: 11, color: '#929BA9' }}>
                Pertumbuhan stabil dengan risiko terukur 1% per transaksi
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 6,
                backgroundColor: '#171D26',
                color: '#00f2fe',
                border: '1px solid #252B34',
              }}
            >
              38 Trades
            </span>
          </div>

          <svg viewBox="0 0 468 144" style={{ width: '100%', height: 138, overflow: 'visible' }}>
            <defs>
              <linearGradient id="tvEquityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1769E8" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#00f2fe" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {/* Horizontal Reference Grid Lines */}
            {[24, 60, 96, 132].map((y, idx) => (
              <line
                key={idx}
                x1={12}
                y1={y}
                x2={456}
                y2={y}
                stroke="#20252D"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            ))}
            {/* Area under curve */}
            <polygon
              points={areaStr}
              fill="url(#tvEquityFill)"
              style={{ opacity: curveDrawProgress }}
            />
            {/* Animated Equity Line */}
            <polyline
              fill="none"
              stroke="#00f2fe"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polylineStr}
              strokeDasharray={pathLength}
              strokeDashoffset={pathLength * (1 - curveDrawProgress)}
            />
            {/* Endpoint Pulsing Dot */}
            {curveDrawProgress > 0.92 && (
              <g>
                <circle cx={452} cy={18} r={8} fill="#00f2fe" fillOpacity={0.28} />
                <circle
                  cx={452}
                  cy={18}
                  r={4.5}
                  fill="#00f2fe"
                  stroke="#080A0E"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
        </div>

        {/* Performance Calendar Card (Profit Days, Loss Days, No-Trade Days) */}
        <div
          style={{
            padding: 15,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                PERFORMANCE CALENDAR · NOV 2026
              </div>
              <div style={{ fontSize: 11, color: '#929BA9', marginTop: 2 }}>
                Disiplin menjaga hari hijau & berani No-Trade saat market buruk
              </div>
            </div>
          </div>

          {/* 3-Badge Summary */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                backgroundColor: '#161A22',
                border: '1px solid #252B34',
              }}
            >
              <div style={{ fontSize: 10, color: '#929BA9' }}>PROFIT DAYS</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#10B981' }}>10 Hari</div>
            </div>
            <div
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                backgroundColor: '#161A22',
                border: '1px solid #252B34',
              }}
            >
              <div style={{ fontSize: 10, color: '#929BA9' }}>LOSS TERUKUR</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#F43F5E' }}>3 Hari (-1R)</div>
            </div>
            <div
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                backgroundColor: '#161A22',
                border: '1px solid #252B34',
              }}
            >
              <div style={{ fontSize: 10, color: '#929BA9' }}>NO-TRADE DAYS</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#00f2fe' }}>3 Hari Sabar</div>
            </div>
          </div>

          {/* 5-Column Weekday Matrix */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 6,
            }}
          >
            {calendarDays.map((cell) => {
              const isProfit = cell.type === 'profit';
              const isLoss = cell.type === 'loss';
              const isSelected = cell.highlight && selectedDay;

              return (
                <div
                  key={cell.d}
                  style={{
                    padding: '8px 6px',
                    borderRadius: 9,
                    backgroundColor: isSelected
                      ? 'rgba(16, 185, 129, 0.22)'
                      : '#161A22',
                    border: isSelected
                      ? '1.5px solid #10B981'
                      : '1px solid #20252D',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: '#929BA9',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    Nov {cell.d}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 800,
                      marginTop: 3,
                      color: isProfit ? '#10B981' : isLoss ? '#F43F5E' : '#00f2fe',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {cell.pnl}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Day Stop-Trading Self-Awareness Banner */}
          {selectedDay && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                borderRadius: 10,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981' }}>
                  ✓ JUMAT, 20 NOV · TARGET +$185.00 (+2.9R) TERCAPAI
                </div>
                <div style={{ fontSize: 11, color: '#F2F5F9', marginTop: 2 }}>
                  Status Disiplin: Stop Trading Hari Ini — Jangan Serahkan Profit Kembali ke Market.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SmartphoneStage>
  );
};

// ============================================================================
// SCENE 3: SIMULASI KALKULATOR LOT ANTI-MC (420 FRAMES)
// ============================================================================
const SceneLotCalculatorAntiMC: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Typing simulation for Stop Loss Price on XAUUSD BUY @ 4000.00:
  // Frame 0..70: default/empty or 3980, Frame 75..155: finger taps SL input and types "3950.00"
  let typedSlString = '3980.00';
  if (frame >= 75 && frame < 92) typedSlString = '3|';
  else if (frame >= 92 && frame < 108) typedSlString = '39|';
  else if (frame >= 108 && frame < 125) typedSlString = '395|';
  else if (frame >= 125 && frame < 142) typedSlString = '3950|';
  else if (frame >= 142) typedSlString = '3950.00';

  const numericSl = frame >= 142 ? 3950.0 : 3980.0;
  const isLockedCalculation = frame >= 180;

  // Execute real TradeVault `calculateXauusdLot` engine!
  const lotResult = useMemo(() => {
    return calculateXauusdLot({
      symbol: 'XAUUSD',
      equity: 6420.5,
      riskPercent: 1.0,
      entryPrice: 4000.0,
      stopLossPrice: numericSl,
      takeProfitPrice: 4100.0,
      position: 'BUY',
      contractSize: 100,
      minLot: 0.01,
      lotStep: 0.01,
      leverage: 500,
    });
  }, [numericSl]);

  const cardPop = spring({
    frame: Math.max(0, frame - 180),
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.75 },
  });

  const touchKeyframes: TouchKeyframe[] = [
    { frame: 12, x: 462, y: 948, tap: true, label: 'Buka Risk Calculator' },
    { frame: 48, x: 185, y: 242, tap: true, label: 'Pilih Rule Risiko 1.0%' },
    { frame: 75, x: 365, y: 342, tap: true, label: 'Ketik Stop Loss 3950.00' },
    { frame: 178, x: 260, y: 455, tap: true, label: 'Kunci Lot Aman Anti-MC' },
    { frame: 310, x: 260, y: 650, tap: true, label: 'Verifikasi Estimasi Rugi ≤ 1%' },
  ];

  return (
    <SmartphoneStage
      sceneBadge="02 · POSITION SIZING & ANTI-MARGIN CALL"
      headline="Berhenti Menebak Lot."
      highlightText="Kunci Risiko 1% Sebelum Entry."
      subheadline="Jarak Stop Loss XAUUSD melebar ke 50 Pips? Kalkulator otomatis menyesuaikan lot ke 0.12 Lot agar risiko maksimal terkunci di -$60.00."
      bottomCalloutTitle="RUMUS PRESISI XAUUSD (100 OZ): RISIKO ($) ÷ (JARAK PIP × NILAI PIP)"
      bottomCalloutBody="Seberapa lebar pun Stop Loss Anda, kerugian saat SL tersentuh tidak akan pernah melampaui anggaran 1% ekuitas ($64.20). Mustahil Margin Call."
      bottomCalloutTone="cyan"
      activeTab="risk"
      ambientColor="#00f2fe"
      phoneTilt={{
        rotateX: interpolate(frame, [0, 210, 420], [-1.5, 2, -1]),
        rotateY: interpolate(frame, [0, 210, 420], [-3, 3, -1.5]),
        scale: 1,
      }}
      touchKeyframes={touchKeyframes}
      statusTime="15:08"
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Calculator Header & Mode Pill */}
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                KALKULATOR LOT OTOMATIS · XAUUSD
              </span>
              <div style={{ fontSize: 11, color: '#929BA9', marginTop: 1 }}>
                Basis Ekuitas Aktif: <strong style={{ color: '#F2F5F9' }}>$6,420.50</strong>
              </div>
            </div>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#10B981',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              BUY · GOLD
            </span>
          </div>

          {/* Risk Percentage Presets (0.5%, 1.0%, 1.5%, 2.0%) */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: '#929BA9',
                marginBottom: 6,
              }}
            >
              <span>BATAS RISIKO PER TRANSAKSI</span>
              <span style={{ color: '#00f2fe', fontWeight: 700 }}>
                1.0% Ekuitas = Maks. -$64.20
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {['0.5%', '1.0%', '1.5%', '2.0%'].map((pct) => {
                const active = pct === '1.0%';
                return (
                  <div
                    key={pct}
                    style={{
                      padding: '7px 0',
                      borderRadius: 8,
                      textAlign: 'center',
                      fontSize: 12,
                      fontWeight: 800,
                      backgroundColor: active ? '#1769E8' : '#161A22',
                      color: active ? '#FFFFFF' : '#929BA9',
                      border: active ? '1px solid #00f2fe' : '1px solid #252B34',
                    }}
                  >
                    {pct}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Entry, Stop Loss (Live Typed), and Take Profit Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                backgroundColor: '#080A0E',
                border: '1px solid #252B34',
              }}
            >
              <div style={{ fontSize: 10, color: '#929BA9', textTransform: 'uppercase' }}>
                Entry Price (XAUUSD)
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 3,
                }}
              >
                $4,000.00
              </div>
            </div>

            <div
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                backgroundColor: '#080A0E',
                border:
                  frame >= 72 && frame <= 175
                    ? '1.5px solid #00f2fe'
                    : '1px solid #F43F5E',
                boxShadow:
                  frame >= 72 && frame <= 175
                    ? '0 0 16px rgba(0, 242, 254, 0.28)'
                    : 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: '#F43F5E',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                <span>Stop Loss</span>
                <span>{lotResult.slDistancePips} Pips</span>
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 3,
                }}
              >
                ${typedSlString}
              </div>
            </div>
          </div>

          {/* Action Calculate Button */}
          <div
            style={{
              marginTop: 12,
              padding: '11px 14px',
              borderRadius: 10,
              background: isLockedCalculation
                ? 'linear-gradient(90deg, #00f2fe 0%, #1769E8 100%)'
                : '#1769E8',
              color: isLockedCalculation ? '#04060A' : '#FFFFFF',
              fontSize: 13,
              fontWeight: 800,
              textAlign: 'center',
              letterSpacing: '0.02em',
              boxShadow: isLockedCalculation
                ? '0 0 24px rgba(0, 242, 254, 0.45)'
                : 'none',
            }}
          >
            {isLockedCalculation
              ? '✓ Lot Aman Terkunci Sesuai Rule 1% Ekuitas'
              : 'Hitung Ukuran Lot Aman Sekarang'}
          </div>
        </div>

        {/* Dynamic Recommended Safe Lot Output Card */}
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: isLockedCalculation
              ? '1.5px solid #00f2fe'
              : '1px solid #252B34',
            boxShadow: isLockedCalculation
              ? '0 12px 32px rgba(0, 242, 254, 0.16)'
              : 'none',
            transform: isLockedCalculation
              ? `scale(${interpolate(cardPop, [0, 0.5, 1], [0.97, 1.02, 1])})`
              : 'scale(1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#00f2fe',
              }}
            >
              REKOMENDASI LOT AMAN (FLOORED STEP 0.01)
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#10B981',
              }}
            >
              ANTI OVER-LOT
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              paddingBottom: 12,
              borderBottom: '1px solid #20252D',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 38,
                  fontWeight: 900,
                  color: isLockedCalculation ? '#00f2fe' : '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                }}
              >
                {lotResult.recommendedLot.toFixed(2)}{' '}
                <span style={{ fontSize: 18, fontWeight: 700, color: '#929BA9' }}>LOT</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#929BA9', marginTop: 2 }}>
                Nilai Pip: ${(lotResult.pipValueForRecommendedLot ?? 1.2).toFixed(2)} / pip · Jarak SL {lotResult.slDistancePips} Pips
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#929BA9', textTransform: 'uppercase' }}>
                Loss Jika Kena SL
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#10B981',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                -{formatUsd(lotResult.estimatedLossAtSL)}
              </div>
              <div style={{ fontSize: 10.5, color: '#10B981', fontWeight: 700 }}>
                ≤ $64.20 (Aman 0.93%)
              </div>
            </div>
          </div>

          {/* R:R Scenarios & Comparison with Blind Lot */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginTop: 12,
            }}
          >
            {lotResult.tpScenarios.map((sc) => (
              <div
                key={sc.ratio}
                style={{
                  padding: '8px 8px',
                  borderRadius: 9,
                  backgroundColor: '#161A22',
                  border: '1px solid #252B34',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: '#929BA9' }}>
                  TARGET RR {sc.ratio}
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    color: '#10B981',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2,
                  }}
                >
                  +{formatUsd(sc.profitAmount)}
                </div>
                <div style={{ fontSize: 10, color: '#929BA9', marginTop: 1 }}>
                  TP ${sc.targetPrice.toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Danger Contrast Banner: Tebak Lot vs Hitung Presisi */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            backgroundColor: 'rgba(244, 63, 94, 0.09)',
            border: '1px solid rgba(244, 63, 94, 0.32)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#F43F5E' }}>
              BAHAYA TEBAK LOT (MISAL ASAL PASANG 0.50 LOT):
            </div>
            <div style={{ fontSize: 11.5, color: '#F2F5F9', marginTop: 2 }}>
              SL 50 Pips × $5.00/pip = <strong style={{ color: '#F43F5E' }}>-$250.00 (-3.9% Sekali SL!)</strong>
            </div>
          </div>
          <ShieldCheck style={{ width: 24, height: 24, color: '#00f2fe', flexShrink: 0 }} />
        </div>
      </div>
    </SmartphoneStage>
  );
};

// ============================================================================
// SCENE 4: TRADE LOG, CHECKLIST ALASAN ENTRY & RADAR ANALYTICS (420 FRAMES)
// ============================================================================
const SceneTradeLogAndRadar: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // First half (0..205): Trade Log + London Session Filter + Entry Reason Checklist
  // Second half (205..420): Finger taps Analytics tab -> 5/6-Dimension Radar Profile blooms live
  const isAnalyticsPhase = frame >= 205;

  const londonFilterActive = frame >= 45;
  const showChecklistDetail = frame >= 95 && frame < 205;

  const radarBloom = spring({
    frame: Math.max(0, frame - 218),
    fps,
    config: { damping: 16, stiffness: 95, mass: 0.9 },
  });

  const touchKeyframes: TouchKeyframe[] = [
    { frame: 10, x: 155, y: 948, tap: true, label: 'Buka Trade Log' },
    { frame: 45, x: 172, y: 214, tap: true, label: 'Filter Sesi London' },
    { frame: 95, x: 260, y: 320, tap: true, label: 'Audit Alasan Entry' },
    { frame: 205, x: 362, y: 948, tap: true, label: 'Buka Analytics Radar' },
    { frame: 310, x: 260, y: 390, tap: true, label: 'Skor Disiplin 96/100 (Grade A)' },
  ];

  // 5 Key Dimensions + Risk Control for Radar Geometry inside phone
  const radarAxes = [
    { label: 'Win Rate', targetScore: 84, displayVal: '68.4%' },
    { label: 'Profit Factor', targetScore: 88, displayVal: '2.64' },
    { label: 'Avg R:R', targetScore: 86, displayVal: '1 : 2.1' },
    { label: 'Expected Return', targetScore: 90, displayVal: '+$37.38/trd' },
    { label: 'Risk Discipline', targetScore: 96, displayVal: '96 / 100' },
  ];

  const radarSize = 260;
  const center = radarSize / 2;
  const radius = center - 46;
  const angleStep = (Math.PI * 2) / radarAxes.length;

  const getCoord = (score: number, idx: number) => {
    const angle = idx * angleStep - Math.PI / 2;
    const r = (score / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const animatedPolygonPoints = radarAxes
    .map((ax, i) => {
      const p = getCoord(ax.targetScore * radarBloom, i);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  return (
    <SmartphoneStage
      sceneBadge="03 · TRADE LOG COMPLIANCE & RADAR ANALYTICS"
      headline="Pahami Alasan Setiap Entry."
      highlightText="Ukur 5 Dimensi Konsistensi."
      subheadline="Filter sesi London & New York, validasi checklist setup sebelum entry, dan evaluasi Win Rate, Profit Factor, R:R, serta Expectancy secara objektif."
      bottomCalloutTitle="EVALUASI OBJEKTIF · BUKAN SEKADAR CATATAN UNTUNG RUGI"
      bottomCalloutBody="TradeVault memisahkan trade yang menang karena keberuntungan (judi tanpa SL) dari trade yang dieksekusi sesuai rencana (Plan Adherence Grade A)."
      bottomCalloutTone="blue"
      activeTab={isAnalyticsPhase ? 'analytics' : 'trades'}
      ambientColor="#38BDF8"
      phoneTilt={{
        rotateX: interpolate(frame, [0, 210, 420], [1, -2, 1.5]),
        rotateY: interpolate(frame, [0, 210, 420], [2.5, -3, 1.5]),
        scale: 1,
      }}
      touchKeyframes={touchKeyframes}
      statusTime="16:45"
    >
      {!isAnalyticsPhase ? (
        /* ==================================================================
           PART A: TRADE LOG + SESSION FILTER + ENTRY REASON COMPLIANCE
        ================================================================== */
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {/* 4-Category Lifecycle Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {[
              { label: 'PLANNED', count: 1, color: '#38BDF8' },
              { label: 'OPEN', count: 1, color: '#F59E0B' },
              { label: 'CLOSED', count: 36, color: '#10B981' },
              { label: 'CANCELLED', count: 2, color: '#929BA9' },
            ].map((c) => (
              <div
                key={c.label}
                style={{
                  padding: '8px 8px',
                  borderRadius: 10,
                  backgroundColor: '#11151B',
                  border: '1px solid #252B34',
                }}
              >
                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#929BA9' }}>
                  {c.label}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: c.color,
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2,
                  }}
                >
                  {c.count}
                </div>
              </div>
            ))}
          </div>

          {/* Session Filter Pills (All, London, New York, Asian) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 10px',
              borderRadius: 12,
              backgroundColor: '#11151B',
              border: '1px solid #252B34',
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#929BA9', marginRight: 4 }}>
              SESI:
            </span>
            {[
              { id: 'all', label: 'Semua Sesi' },
              { id: 'london', label: 'London (Win 76%)' },
              { id: 'ny', label: 'New York' },
            ].map((s) => {
              const active =
                (s.id === 'london' && londonFilterActive) ||
                (s.id === 'all' && !londonFilterActive);
              return (
                <div
                  key={s.id}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    backgroundColor: active ? '#1769E8' : '#161A22',
                    color: active ? '#FFFFFF' : '#929BA9',
                    border: active ? '1px solid #00f2fe' : '1px solid #252B34',
                  }}
                >
                  {s.label}
                </div>
              );
            })}
          </div>

          {/* Trade Log Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              {
                symbol: 'XAUUSD',
                side: 'BUY',
                lot: '0.12 Lot',
                session: 'London · 15:10 WIB',
                setup: 'HTF Orderblock + Liquidity Sweep',
                pnl: '+$120.00',
                rr: '+2.0R',
                positive: true,
                selected: showChecklistDetail,
              },
              {
                symbol: 'XAUUSD',
                side: 'SELL',
                lot: '0.12 Lot',
                session: 'London · 14:05 WIB',
                setup: 'London High Rejection + FVG',
                pnl: '+$150.00',
                rr: '+2.5R',
                positive: true,
                selected: false,
              },
              {
                symbol: 'EURUSD',
                side: 'BUY',
                lot: '0.20 Lot',
                session: 'London · 13:20 WIB',
                setup: 'Break & Retest Structure',
                pnl: '-$60.00',
                rr: '-1.0R (SL Terukur)',
                positive: false,
                selected: false,
              },
            ].map((t, idx) => (
              <div
                key={idx}
                style={{
                  padding: '11px 13px',
                  borderRadius: 12,
                  backgroundColor: '#11151B',
                  border: t.selected ? '1.5px solid #00f2fe' : '1px solid #252B34',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#F2F5F9' }}>
                      {t.symbol}
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 800,
                        color: t.side === 'BUY' ? '#10B981' : '#F43F5E',
                      }}
                    >
                      {t.side}
                    </span>
                    <span style={{ fontSize: 11.5, color: '#929BA9' }}>{t.lot}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#38BDF8', fontWeight: 600, marginTop: 2 }}>
                    {t.setup}
                  </div>
                  <div style={{ fontSize: 10.5, color: '#929BA9', marginTop: 1 }}>
                    {t.session}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: t.positive ? '#10B981' : '#F43F5E',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {t.pnl}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#929BA9' }}>
                    {t.rr} · CLOSED
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Setup Compliance & Entry Reason Evaluation Card */}
          {showChecklistDetail && (
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                backgroundColor: '#141923',
                border: '1.5px solid #00f2fe',
                boxShadow: '0 10px 28px rgba(0, 242, 254, 0.16)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#00f2fe',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  AUDIT ALASAN ENTRY & SETUP COMPLIANCE
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 6,
                    backgroundColor: 'rgba(16, 185, 129, 0.16)',
                    color: '#10B981',
                  }}
                >
                  GRADE A · 100% PATUH
                </span>
              </div>

              {[
                'Konfirmasi Sweep Likuiditas Sesi London & Break of Structure M15',
                'Risiko Terkunci 0.12 Lot (SL 3950.00 = Maksimal Rugi -$60.00 / < 1%)',
                'Eksekusi Sabar Menunggu Candle Close (Bukan FOMO / Kejar Harga)',
              ].map((reason, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 0',
                    fontSize: 11.5,
                    color: '#F2F5F9',
                  }}
                >
                  <CheckCircle2 style={{ width: 15, height: 15, color: '#10B981', flexShrink: 0 }} />
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ==================================================================
           PART B: ANALYTICS & LIVE 5-DIMENSION RADAR PROFILE BLOOM
        ================================================================== */
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              padding: 15,
              borderRadius: 14,
              backgroundColor: '#11151B',
              border: '1px solid #252B34',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: '#F2F5F9',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  5-DIMENSION PERFORMANCE RADAR
                </div>
                <div style={{ fontSize: 11, color: '#929BA9' }}>
                  Pemetaan objektif kualitas eksekusi & konsistensi akun
                </div>
              </div>
              <span
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(0, 242, 254, 0.14)',
                  color: '#00f2fe',
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                Skor 88.8 / 100
              </span>
            </div>

            {/* Dynamic SVG Radar Polygon */}
            <svg
              viewBox={`0 0 ${radarSize} ${radarSize}`}
              style={{ width: 248, height: 248, overflow: 'visible' }}
            >
              {/* Concentric Pentagon Rings */}
              {[0.25, 0.5, 0.75, 1.0].map((lvl, idx) => {
                const pts = radarAxes
                  .map((_, i) => {
                    const c = getCoord(lvl * 100, i);
                    return `${c.x},${c.y}`;
                  })
                  .join(' ');
                return (
                  <polygon
                    key={idx}
                    points={pts}
                    fill="none"
                    stroke="#252B34"
                    strokeWidth="1"
                    strokeDasharray={idx < 3 ? '2 2' : undefined}
                  />
                );
              })}

              {/* Radial Spokes */}
              {radarAxes.map((_, i) => {
                const c = getCoord(100, i);
                return (
                  <line
                    key={i}
                    x1={center}
                    y1={center}
                    x2={c.x}
                    y2={c.y}
                    stroke="#252B34"
                    strokeWidth="1"
                  />
                );
              })}

              {/* Animated Trader Performance Polygon */}
              <polygon
                points={animatedPolygonPoints}
                fill="#00f2fe"
                fillOpacity={0.2}
                stroke="#00f2fe"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />

              {/* Vertex Nodes & Axis Labels */}
              {radarAxes.map((ax, i) => {
                const pt = getCoord(ax.targetScore * radarBloom, i);
                const lbl = getCoord(124, i);
                return (
                  <g key={ax.label}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={4}
                      fill="#00f2fe"
                      stroke="#080A0E"
                      strokeWidth="1.5"
                    />
                    <text
                      x={lbl.x}
                      y={lbl.y - 5}
                      textAnchor="middle"
                      fill="#929BA9"
                      fontSize="10"
                      fontWeight="700"
                    >
                      {ax.label}
                    </text>
                    <text
                      x={lbl.x}
                      y={lbl.y + 8}
                      textAnchor="middle"
                      fill="#F2F5F9"
                      fontSize="10.5"
                      fontWeight="800"
                    >
                      {ax.displayVal}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Discipline Audit Card */}
          <div
            style={{
              padding: 15,
              borderRadius: 14,
              backgroundColor: '#11151B',
              border: '1px solid #252B34',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981' }}>
                  AUDIT KEPATUHAN DISIPLIN (38 TRANSAKSI)
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#F2F5F9', marginTop: 2 }}>
                  0 Pelanggaran Over-Risk · 100% Memasang Stop Loss
                </div>
              </div>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  backgroundColor: 'rgba(16, 185, 129, 0.16)',
                  border: '1px solid #10B981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  fontWeight: 900,
                  color: '#10B981',
                }}
              >
                A
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  backgroundColor: '#161A22',
                  border: '1px solid #20252D',
                }}
              >
                <div style={{ fontSize: 10, color: '#929BA9' }}>KEPATUHAN RISIKO ≤ 1%</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#10B981', marginTop: 2 }}>
                  38 / 38 Trade (100%)
                </div>
              </div>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  backgroundColor: '#161A22',
                  border: '1px solid #20252D',
                }}
              >
                <div style={{ fontSize: 10, color: '#929BA9' }}>PELANGGARAN DAILY LOSS</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#00f2fe', marginTop: 2 }}>
                  0 Hari Melanggar
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </SmartphoneStage>
  );
};

// ============================================================================
// SCENE 5: SIMULATOR COMPOUNDING VS ILUSI CEPAT KAYA (300 FRAMES)
// ============================================================================
const SceneCompoundingSimulator: React.FC = () => {
  const frame = useCurrentFrame();

  // Execute real TradeVault `calculateCompoundingGrowth` utility!
  // Starting Capital: $5,000, Monthly Growth: +15% (realistic with 1% risk & +15R/month), 12 Months
  const compoundingData = useMemo(() => {
    return calculateCompoundingGrowth({
      startingCapital: 5000,
      growthRatePercent: 15,
      interval: 'monthly',
      duration: 12,
      regularDeposit: 0,
      mode: 'compounding',
    });
  }, []);

  const revealProgress = clampInterpolate(
    frame,
    [20, 175],
    [0, 1],
    Easing.out(Easing.cubic)
  );

  const visibleMonthsCount = Math.max(
    1,
    Math.min(12, Math.ceil(revealProgress * 12))
  );
  const currentStep =
    compoundingData.steps[visibleMonthsCount - 1] ?? compoundingData.steps[0];

  const touchKeyframes: TouchKeyframe[] = [
    { frame: 18, x: 350, y: 195, tap: true, label: 'Target Realistis +15% / Bulan' },
    { frame: 95, x: 260, y: 455, tap: true, label: 'Bulan ke-6: $11,565.30' },
    { frame: 180, x: 435, y: 385, tap: true, label: 'Bulan ke-12: $26,751.25 (+435%)' },
  ];

  return (
    <SmartphoneStage
      sceneBadge="04 · LONG-TERM COMPOUNDING SIMULATOR"
      headline="Hancurkan Ilusi Cepat Kaya."
      highlightText="Biarkan Compounding Bekerja."
      subheadline="Berhenti memaksakan +100% dalam sehari yang berujung MC. Konsisten +15% per bulan mengubah $5,000 menjadi $26,751 dalam 12 bulan tanpa overtrade."
      bottomCalloutTitle="MATEMATIKA KONSISTENSI MENGALAHKAN KESERAKAHAN SESAAT"
      bottomCalloutBody="Dengan risiko 1% per trade, cukup meraih bersih +3.5R per minggu (+15% sebulan) untuk melipatgandakan portofolio lebih dari 5x lipat dalam setahun."
      bottomCalloutTone="emerald"
      activeTab="risk"
      ambientColor="#10B981"
      phoneTilt={{
        rotateX: interpolate(frame, [0, 150, 300], [-1, 1.5, 0]),
        rotateY: interpolate(frame, [0, 150, 300], [-2.5, 2.5, 0]),
        scale: 1,
      }}
      touchKeyframes={touchKeyframes}
      statusTime="20:15"
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Compounding Parameters Card */}
        <div
          style={{
            padding: 15,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                color: '#F2F5F9',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              SIMULATOR COMPOUNDING · 12 BULAN
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(0, 242, 254, 0.14)',
                color: '#00f2fe',
              }}
            >
              REINVEST PROFIT
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 9,
                backgroundColor: '#080A0E',
                border: '1px solid #252B34',
              }}
            >
              <div style={{ fontSize: 9.5, color: '#929BA9' }}>MODAL AWAL</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 2,
                }}
              >
                $5,000
              </div>
            </div>
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 9,
                backgroundColor: '#080A0E',
                border: '1px solid #00f2fe',
              }}
            >
              <div style={{ fontSize: 9.5, color: '#00f2fe', fontWeight: 700 }}>
                TARGET / BULAN
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#00f2fe',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 2,
                }}
              >
                +15.0%
              </div>
            </div>
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 9,
                backgroundColor: '#080A0E',
                border: '1px solid #252B34',
              }}
            >
              <div style={{ fontSize: 9.5, color: '#929BA9' }}>DURASI</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#F2F5F9',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 2,
                }}
              >
                12 Bulan
              </div>
            </div>
          </div>

          {/* Live Projected Balance Banner */}
          <div
            style={{
              marginTop: 12,
              padding: '12px 14px',
              borderRadius: 12,
              backgroundColor: '#161A22',
              border: '1px solid #252B34',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 10.5, color: '#929BA9', fontWeight: 700 }}>
                PROYEKSI SALDO BULAN KE-{currentStep.period}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  color: '#10B981',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 2,
                }}
              >
                {formatUsd(currentStep.endBalance)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#929BA9' }}>AKUMULASI PROFIT</div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: '#00f2fe',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                +{formatUsd(currentStep.cumulativeProfit)}
              </div>
              <div style={{ fontSize: 10.5, color: '#10B981', fontWeight: 700 }}>
                +{((currentStep.cumulativeProfit / 5000) * 100).toFixed(1)}% Growth
              </div>
            </div>
          </div>
        </div>

        {/* 12-Month Exponential Bar & Curve Visualization */}
        <div
          style={{
            padding: 15,
            borderRadius: 14,
            backgroundColor: '#11151B',
            border: '1px solid #252B34',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: '#929BA9',
                textTransform: 'uppercase',
              }}
            >
              KURVA EKSPOENSIAL 12 BULAN (M1 – M12)
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#10B981' }}>
              Tanpa Over-Lot · Tanpa Begadang
            </span>
          </div>

          <div
            style={{
              height: 156,
              display: 'grid',
              gridTemplateColumns: 'repeat(12, 1fr)',
              alignItems: 'end',
              gap: 6,
              paddingTop: 16,
              borderBottom: '1px solid #252B34',
            }}
          >
            {compoundingData.steps.map((step, idx) => {
              const isReached = idx < visibleMonthsCount;
              const maxEnd = compoundingData.endingBalance;
              const heightRatio = step.endBalance / maxEnd;
              const barHeight = isReached ? Math.max(16, Math.round(heightRatio * 132)) : 6;
              const isCurrent = idx === visibleMonthsCount - 1;

              return (
                <div
                  key={step.period}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: barHeight,
                      borderRadius: '5px 5px 0 0',
                      background: isCurrent
                        ? 'linear-gradient(180deg, #00f2fe 0%, #10B981 100%)'
                        : isReached
                        ? 'linear-gradient(180deg, #10B981 0%, rgba(16,185,129,0.35) 100%)'
                        : '#171D26',
                      boxShadow: isCurrent ? '0 0 14px rgba(0,242,254,0.45)' : 'none',
                    }}
                  />
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: isCurrent ? 800 : 600,
                      color: isCurrent ? '#00f2fe' : '#929BA9',
                      marginBottom: 4,
                    }}
                  >
                    M{step.period}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Milestone Rows (Bulan 3, Bulan 6, Bulan 12) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginTop: 12,
            }}
          >
            {[
              { label: 'Bulan Ke-3', step: compoundingData.steps[2] },
              { label: 'Bulan Ke-6', step: compoundingData.steps[5] },
              { label: 'Bulan Ke-12', step: compoundingData.steps[11] },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  padding: '8px 9px',
                  borderRadius: 9,
                  backgroundColor: '#161A22',
                  border: '1px solid #20252D',
                }}
              >
                <div style={{ fontSize: 10, color: '#929BA9' }}>{m.label}</div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    color: '#F2F5F9',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2,
                  }}
                >
                  {formatUsd(m.step.endBalance, 0)}
                </div>
                <div style={{ fontSize: 10, color: '#10B981', fontWeight: 700 }}>
                  +{formatUsd(m.step.growthProfit, 0)}/bln
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SmartphoneStage>
  );
};

// ============================================================================
// SCENE 6: OUTRO BRANDING TRADEVAULT — BENTENG PSIKOLOGIS TRADER (240 FRAMES)
// ============================================================================
const SceneOutroBranding: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const heroSpring = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.85 },
  });

  const ctaTapped = frame >= 115;

  const touchKeyframes: TouchKeyframe[] = [
    { frame: 35, x: 260, y: 420 },
    { frame: 115, x: 260, y: 690, tap: true, label: 'Mulai Disiplin Trading' },
  ];

  return (
    <SmartphoneStage
      sceneBadge="TRADEVAULT · PSYCHOLOGICAL & RISK FORTRESS"
      headline="Kendalikan Dirimu. Lindungi Modalmu."
      highlightText="Trading Tanpa Drama."
      subheadline="Bukan sekadar jurnal transaksi. TradeVault adalah sistem pertahanan diri agar Anda tahu persis batas risiko dan kapan harus berhenti hari ini."
      bottomCalloutTitle="SIAP MENGHENTIKAN SIKLUS OVER-LOT & REVENGE TRADING?"
      bottomCalloutBody="Gunakan TradeVault sekarang di Smartphone & Desktop Anda — 100% Presisi untuk XAUUSD, Forex, Index, dan Crypto."
      bottomCalloutTone="cyan"
      activeTab="dashboard"
      ambientColor="#00f2fe"
      phoneTilt={{
        rotateX: interpolate(frame, [0, 120, 240], [2, 0, 0]),
        rotateY: interpolate(frame, [0, 120, 240], [-3, 0, 0]),
        scale: interpolate(heroSpring, [0, 1], [0.96, 1.02]),
      }}
      touchKeyframes={touchKeyframes}
      statusTime="09:41"
    >
      <div
        style={{
          height: '100%',
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background:
            'radial-gradient(circle at 50% 18%, rgba(23, 105, 232, 0.24) 0%, rgba(8, 10, 14, 1) 70%)',
        }}
      >
        {/* Top Brand Identity Lockup inside Phone */}
        <div
          style={{
            textAlign: 'center',
            paddingTop: 12,
            transform: `scale(${interpolate(heroSpring, [0, 1], [0.9, 1])})`,
          }}
        >
          <div
            style={{
              width: 78,
              height: 78,
              borderRadius: 22,
              backgroundColor: '#11151B',
              border: '1.5px solid #00f2fe',
              boxShadow: '0 0 36px rgba(0, 242, 254, 0.28)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px auto',
            }}
          >
            <BrandLogo variant="symbol" className="h-12 w-12" />
          </div>

          <div
            style={{
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: '-0.02em',
              color: '#F8FAFC',
            }}
          >
            Trade<span style={{ color: '#38BDF8' }}>Vault</span>
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#00f2fe',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            Benteng Psikologis & Disiplin Risiko Trader
          </div>
        </div>

        {/* 4 Core Pillars Summary Checklist Inside Phone */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {[
            {
              title: 'Self-Awareness Akun Penuh',
              desc: 'Saldo riil, Net Profit, Drawdown & Kalender Disiplin Harian',
              accent: '#10B981',
            },
            {
              title: 'Kalkulator Lot Anti-Margin Call',
              desc: 'Kunci otomatis risiko 1% ekuitas terhadap jarak Stop Loss (Pips)',
              accent: '#00f2fe',
            },
            {
              title: 'Proteksi Batas Rugi Harian (Stop Rule)',
              desc: 'Peringatan tegas kapan harus berhenti trading hari ini',
              accent: '#F43F5E',
            },
            {
              title: 'Radar Konsistensi & Simulator Compounding',
              desc: 'Ukur 5 dimensi performa & peta pertumbuhan eksponensial',
              accent: '#38BDF8',
            },
          ].map((pillar, i) => (
            <div
              key={i}
              style={{
                padding: '11px 14px',
                borderRadius: 12,
                backgroundColor: '#11151B',
                border: '1px solid #252B34',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 9999,
                  backgroundColor: pillar.accent,
                  boxShadow: `0 0 10px ${pillar.accent}`,
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#F2F5F9' }}>
                  {pillar.title}
                </div>
                <div style={{ fontSize: 11, color: '#929BA9', marginTop: 1 }}>
                  {pillar.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Interactive CTA Button Inside Smartphone */}
        <div style={{ paddingBottom: 6 }}>
          <div
            style={{
              padding: '15px 18px',
              borderRadius: 14,
              background: ctaTapped
                ? 'linear-gradient(90deg, #10B981 0%, #00f2fe 100%)'
                : 'linear-gradient(90deg, #1769E8 0%, #00f2fe 100%)',
              color: '#04060A',
              fontSize: 14.5,
              fontWeight: 900,
              textAlign: 'center',
              letterSpacing: '0.02em',
              boxShadow: '0 0 32px rgba(0, 242, 254, 0.48)',
              transform: ctaTapped ? 'scale(0.98)' : 'scale(1)',
            }}
          >
            {ctaTapped
              ? '✓ TradeVault Siap Melindungi Akun Anda'
              : 'Mulai Disiplin Trading Bersama TradeVault'}
          </div>
        </div>
      </div>
    </SmartphoneStage>
  );
};

// ============================================================================
// MASTER REMOTION SHOWCASE COMPOSITION COMPONENT (`<Series>`)
// ============================================================================
export const Showcase: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#04060A' }}>
      <Series>
        {/* 1. Hook Psikologi: Revenge Trading vs Daily Loss Lockout (00s - 10s) */}
        <Series.Sequence durationInFrames={SCENE_DURATIONS.hookPsychology}>
          <SceneHookPsychology />
        </Series.Sequence>

        {/* 2. Dashboard Self-Awareness: Balance, Equity Curve & Performance Calendar (10s - 22s) */}
        <Series.Sequence durationInFrames={SCENE_DURATIONS.dashboardAwareness}>
          <SceneDashboardAwareness />
        </Series.Sequence>

        {/* 3. Simulasi Kalkulator Lot Anti-MC: Typing SL 3950 -> 0.12 Safe Lot (22s - 36s) */}
        <Series.Sequence durationInFrames={SCENE_DURATIONS.lotCalculatorAntiMC}>
          <SceneLotCalculatorAntiMC />
        </Series.Sequence>

        {/* 4. Trade Log Session Filter, Entry Checklist & 5-Dim Radar Bloom (36s - 50s) */}
        <Series.Sequence durationInFrames={SCENE_DURATIONS.tradeLogAndRadar}>
          <SceneTradeLogAndRadar />
        </Series.Sequence>

        {/* 5. Simulator Compounding: 12-Month Growth vs Quick-Rich Greed (50s - 60s) */}
        <Series.Sequence durationInFrames={SCENE_DURATIONS.compoundingSimulator}>
          <SceneCompoundingSimulator />
        </Series.Sequence>

        {/* 6. Outro Branding TradeVault: Psychological Fortress Lockup (60s - 68s) */}
        <Series.Sequence durationInFrames={SCENE_DURATIONS.outroBranding}>
          <SceneOutroBranding />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

/**
 * Remotion Root Registry wrapper so `npx remotion studio` or `npx remotion render`
 * can directly mount the 1080x1920 @ 30fps composition.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TradeVaultShowcase"
        component={Showcase}
        durationInFrames={SHOWCASE_DURATION_IN_FRAMES}
        fps={SHOWCASE_FPS}
        width={SHOWCASE_WIDTH}
        height={SHOWCASE_HEIGHT}
      />
    </>
  );
};

export default Showcase;
