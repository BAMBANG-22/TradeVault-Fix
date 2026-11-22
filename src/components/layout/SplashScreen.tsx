/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { VloMech } from './VloMechanicalOrbit';
import { BrandLogo } from './BrandLogo';
import { useTheme } from '../../utils/theme';

interface SplashScreenProps {
  onComplete?: () => void;
}

/**
 * VLO Startup Splash Screen
 * Plays the Mechanical Orbital Assembly reveal once on app mount,
 * then smoothly fades out into the live dashboard without blocking background hydration.
 */
export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const { theme } = useTheme();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [phase, setPhase] = useState<'active' | 'fading' | 'done'>(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return 'done';
    }
    return 'active';
  });

  useEffect(() => {
    if (phase === 'done') {
      onCompleteRef.current?.();
      return;
    }

    if (phase === 'fading') return;

    const fadeTimer = window.setTimeout(() => {
      setPhase('fading');
    }, 1780);

    const doneTimer = window.setTimeout(() => {
      setPhase('done');
      onCompleteRef.current?.();
    }, 2060);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <div
      data-testid="vlo-splash-screen"
      onClick={() => {
        onCompleteRef.current?.();
        setPhase('fading');
        window.setTimeout(() => {
          setPhase('done');
        }, 180);
      }}
      style={{ contain: 'strict', transform: 'translateZ(0)' }}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white dark:bg-[#050607] transition-opacity duration-280 ease-out will-change-[opacity] select-none ${
        phase === 'fading' ? 'opacity-0 pointer-events-none' : 'opacity-100 cursor-pointer'
      }`}
      aria-label="VLO"
    >
      <div className="flex flex-col items-center gap-6">
        <VloMech theme={theme} size={144} slowMo={1} className="shrink-0" />
        <div className="vlo-splash-wordmark flex flex-col items-center gap-2">
          <BrandLogo variant="wordmark" className="h-10 sm:h-11 w-auto" title="VLO" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#697586] dark:text-[#929BA9]">
            Trading Journal
          </span>
        </div>
      </div>
    </div>
  );
};
