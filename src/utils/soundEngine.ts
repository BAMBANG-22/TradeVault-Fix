/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';

export interface SoundPreferences {
  uiClickEnabled: boolean;
  notificationSoundEnabled: boolean;
  hapticEnabled: boolean;
}

export const SOUND_PREFS_STORAGE_KEY = 'vlo_sound_prefs_v1';
export const SOUND_PREFS_CHANGE_EVENT = 'vlo-sound-prefs-change';

const DEFAULT_SOUND_PREFS: SoundPreferences = {
  uiClickEnabled: true,
  notificationSoundEnabled: true,
  hapticEnabled: true,
};

let sharedAudioCtx: AudioContext | null = null;
let hasUserInteracted = false;
let lastClickPlayedAt = 0;
let lastChimePlayedAt = 0;

function readPreferencesFromStorage(): SoundPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_SOUND_PREFS };
  try {
    const raw = window.localStorage.getItem(SOUND_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SOUND_PREFS };
    const parsed = JSON.parse(raw);
    return {
      uiClickEnabled:
        typeof parsed?.uiClickEnabled === 'boolean'
          ? parsed.uiClickEnabled
          : DEFAULT_SOUND_PREFS.uiClickEnabled,
      notificationSoundEnabled:
        typeof parsed?.notificationSoundEnabled === 'boolean'
          ? parsed.notificationSoundEnabled
          : DEFAULT_SOUND_PREFS.notificationSoundEnabled,
      hapticEnabled:
        typeof parsed?.hapticEnabled === 'boolean'
          ? parsed.hapticEnabled
          : DEFAULT_SOUND_PREFS.hapticEnabled,
    };
  } catch {
    return { ...DEFAULT_SOUND_PREFS };
  }
}

export function getSoundPreferences(): SoundPreferences {
  return readPreferencesFromStorage();
}

export function saveSoundPreferences(next: Partial<SoundPreferences>): SoundPreferences {
  const merged: SoundPreferences = {
    ...readPreferencesFromStorage(),
    ...next,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SOUND_PREFS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore storage quota errors
    }
    window.dispatchEvent(new CustomEvent(SOUND_PREFS_CHANGE_EVENT, { detail: merged }));
  }
  return merged;
}

export function useSoundPreferences() {
  const [prefs, setPrefs] = useState<SoundPreferences>(() => getSoundPreferences());

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const custom = e as CustomEvent<SoundPreferences>;
      setPrefs(custom.detail || getSoundPreferences());
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SOUND_PREFS_STORAGE_KEY) {
        setPrefs(getSoundPreferences());
      }
    };
    window.addEventListener(SOUND_PREFS_CHANGE_EVENT, handleEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(SOUND_PREFS_CHANGE_EVENT, handleEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const updatePrefs = useCallback((patch: Partial<SoundPreferences>) => {
    const updated = saveSoundPreferences(patch);
    setPrefs(updated);
    return updated;
  }, []);

  return {
    ...prefs,
    updateSoundPreferences: updatePrefs,
  };
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      sharedAudioCtx = new Ctx({ latencyHint: 'interactive' });
    } catch {
      try {
        sharedAudioCtx = new Ctx();
      } catch {
        return null;
      }
    }
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function unlockAudioEngine(): void {
  hasUserInteracted = true;
  getAudioContext();
}

export function triggerHaptic(pattern: number | number[] = 6): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const { hapticEnabled } = getSoundPreferences();
  if (!hapticEnabled) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore vibration restrictions on desktop/iOS
  }
}

function scheduleTone(
  ctx: AudioContext,
  options: {
    type?: OscillatorType;
    startFreq: number;
    endFreq: number;
    startTime: number;
    durationSec: number;
    peakGain: number;
  }
): void {
  const {
    type = 'sine',
    startFreq,
    endFreq,
    startTime,
    durationSec,
    peakGain,
  } = options;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, startTime);
  if (endFreq !== startFreq) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFreq),
      startTime + durationSec
    );
  }

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + Math.min(0.004, durationSec * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + durationSec + 0.01);
}

/**
 * Crisp, quiet tactile click/tap feedback (< 20ms)
 */
export function playUiClick(isTouchPointer = false): void {
  const nowMs = Date.now();
  if (nowMs - lastClickPlayedAt < 42) return;
  lastClickPlayedAt = nowMs;

  if (isTouchPointer) {
    triggerHaptic(6);
  }

  const { uiClickEnabled } = getSoundPreferences();
  if (!uiClickEnabled) return;

  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  const t = ctx.currentTime;
  scheduleTone(ctx, {
    type: 'triangle',
    startFreq: 960,
    endFreq: 430,
    startTime: t,
    durationSec: 0.018,
    peakGain: 0.028,
  });
}

/**
 * Soft mechanical detent when switching tabs, themes, or segmented controls
 */
export function playTabSwitch(isTouchPointer = false): void {
  const nowMs = Date.now();
  if (nowMs - lastClickPlayedAt < 42) return;
  lastClickPlayedAt = nowMs;

  if (isTouchPointer) {
    triggerHaptic(7);
  }

  const { uiClickEnabled } = getSoundPreferences();
  if (!uiClickEnabled) return;

  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  const t = ctx.currentTime;
  scheduleTone(ctx, {
    type: 'sine',
    startFreq: 690,
    endFreq: 350,
    startTime: t,
    durationSec: 0.022,
    peakGain: 0.03,
  });
}

/**
 * Warm two-note ascending chime for trade saved / positive action
 */
export function playSuccessChime(force = false): void {
  const nowMs = Date.now();
  if (!force && nowMs - lastChimePlayedAt < 140) return;
  lastChimePlayedAt = nowMs;

  triggerHaptic([8, 26, 10]);

  if (!force && !hasUserInteracted) return;
  const { notificationSoundEnabled } = getSoundPreferences();
  if (!force && !notificationSoundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const t = ctx.currentTime;
  scheduleTone(ctx, {
    type: 'sine',
    startFreq: 1046.5, // C6
    endFreq: 1046.5,
    startTime: t,
    durationSec: 0.085,
    peakGain: 0.04,
  });
  scheduleTone(ctx, {
    type: 'sine',
    startFreq: 1318.5, // E6
    endFreq: 1318.5,
    startTime: t + 0.072,
    durationSec: 0.145,
    peakGain: 0.045,
  });
}

/**
 * Clear glassy two-pulse bell for new notifications / high-impact macro news
 */
export function playNotificationPing(force = false): void {
  const nowMs = Date.now();
  if (!force && nowMs - lastChimePlayedAt < 140) return;
  lastChimePlayedAt = nowMs;

  triggerHaptic([10, 30, 14]);

  if (!force && !hasUserInteracted) return;
  const { notificationSoundEnabled } = getSoundPreferences();
  if (!force && !notificationSoundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const t = ctx.currentTime;
  scheduleTone(ctx, {
    type: 'sine',
    startFreq: 880, // A5
    endFreq: 880,
    startTime: t,
    durationSec: 0.11,
    peakGain: 0.044,
  });
  scheduleTone(ctx, {
    type: 'sine',
    startFreq: 1174.66, // D6
    endFreq: 1174.66,
    startTime: t + 0.088,
    durationSec: 0.18,
    peakGain: 0.048,
  });
}

/**
 * Gentle muted double-low tone for validation errors or risk warnings
 */
export function playErrorTone(force = false): void {
  const nowMs = Date.now();
  if (!force && nowMs - lastChimePlayedAt < 140) return;
  lastChimePlayedAt = nowMs;

  triggerHaptic([16, 32, 16]);

  if (!force && !hasUserInteracted) return;
  const { notificationSoundEnabled } = getSoundPreferences();
  if (!force && !notificationSoundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const t = ctx.currentTime;
  scheduleTone(ctx, {
    type: 'triangle',
    startFreq: 245,
    endFreq: 205,
    startTime: t,
    durationSec: 0.085,
    peakGain: 0.048,
  });
  scheduleTone(ctx, {
    type: 'triangle',
    startFreq: 195,
    endFreq: 165,
    startTime: t + 0.085,
    durationSec: 0.11,
    peakGain: 0.044,
  });
}

/**
 * Attaches a single passive delegated listener for instant tactile UI click/touch feedback.
 * Returns a cleanup function.
 */
export function initGlobalUiSoundFeedback(): () => void {
  if (typeof document === 'undefined') return () => {};

  const INTERACTIVE_SELECTOR =
    'button, [role="button"], a[href], [role="tab"], input[type="checkbox"], input[type="radio"], select, [data-sound]';

  const handleTrigger = (targetEl: HTMLElement | null, isTouchPointer: boolean) => {
    hasUserInteracted = true;
    if (!targetEl) return;

    const interactive = targetEl.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
    if (!interactive) return;

    const explicitMode = interactive.getAttribute('data-sound');
    if (explicitMode === 'none') return;
    if (
      (interactive as HTMLButtonElement).disabled ||
      interactive.getAttribute('aria-disabled') === 'true'
    ) {
      return;
    }

    unlockAudioEngine();

    if (explicitMode === 'tab' || interactive.getAttribute('role') === 'tab') {
      playTabSwitch(isTouchPointer);
    } else {
      playUiClick(isTouchPointer);
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    handleTrigger(e.target as HTMLElement | null, isTouch);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const inputType = (target as HTMLInputElement).type;
      if (inputType !== 'checkbox' && inputType !== 'radio' && inputType !== 'submit' && inputType !== 'button') {
        return;
      }
    }
    handleTrigger(target, false);
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
  document.addEventListener('keydown', onKeyDown, { passive: true, capture: true });

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}
