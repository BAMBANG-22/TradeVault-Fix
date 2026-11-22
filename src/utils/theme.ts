/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';

export type AppTheme = 'light' | 'dark';
export type ThemeMode = AppTheme;

export const THEME_STORAGE_KEY = 'tradevault_theme_v1';
export const THEME_CHANGE_EVENT = 'tradevault-theme-change';
export const THEME_EVENT_NAME = THEME_CHANGE_EVENT;

const THEME_INSTANT_CLASS = 'vlo-theme-instant';

/**
 * Reads the persisted theme from localStorage.
 * Defaults to 'dark' if not set or invalid.
 * Guaranteed to never read or overwrite financial data or settings keys.
 */
export function getStoredTheme(): AppTheme {
  try {
    if (typeof window === 'undefined') return 'dark';
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light') return 'light';
    if (val === 'dark') return 'dark';
    return 'dark'; // Default theme
  } catch {
    return 'dark';
  }
}

export const getThemeMode = getStoredTheme;

function commitThemeChange(theme: AppTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (err) {
    console.warn('Failed to save theme preference:', err);
  }
  applyThemeToDocument(theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    );
  } catch {
    return false;
  }
}

/**
 * Lightweight GPU-composited veil fallback for browsers without View Transitions API.
 * Uses only opacity + translateZ(0) so zero CPU color interpolation occurs.
 */
function runFallbackGpuVeil(targetTheme: AppTheme): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  try {
    const veil = document.createElement('div');
    veil.setAttribute('aria-hidden', 'true');
    veil.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483646',
      'pointer-events:none',
      `background:${targetTheme === 'dark' ? '#050607' : '#FFFFFF'}`,
      'opacity:0.24',
      'transform:translateZ(0)',
      'will-change:opacity',
      'transition:opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    ].join(';');

    document.body.appendChild(veil);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        veil.style.opacity = '0';
      });
    });
    window.setTimeout(() => {
      veil.remove();
    }, 230);
  } catch {
    // Ignore fallback veil errors
  }
}

/**
 * Persists the user's manual theme choice and executes a zero-jank GPU-composited transition.
 * Suppresses per-element CSS color transitions during the swap so the browser never runs
 * hundreds of simultaneous CPU repaints, then crossfades smoothly on the GPU compositor.
 */
export function setStoredTheme(theme: AppTheme): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const root = document.documentElement;
  const currentIsLight = root.classList.contains('light');
  const isNoop =
    (theme === 'light' && currentIsLight) ||
    (theme === 'dark' && !currentIsLight && root.classList.contains('dark'));

  if (isNoop) {
    commitThemeChange(theme);
    return;
  }

  root.classList.add(THEME_INSTANT_CLASS);

  const startViewTransition = (document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  }).startViewTransition;

  if (!prefersReducedMotion() && typeof startViewTransition === 'function') {
    try {
      const transition = startViewTransition.call(document, () => {
        flushSync(() => {
          commitThemeChange(theme);
        });
      });

      transition.finished
        .catch(() => {})
        .finally(() => {
          root.classList.remove(THEME_INSTANT_CLASS);
        });
      return;
    } catch {
      // Fall through to atomic swap + GPU veil fallback
    }
  }

  commitThemeChange(theme);
  runFallbackGpuVeil(theme);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      root.classList.remove(THEME_INSTANT_CLASS);
    });
  });
}

export const setThemeMode = setStoredTheme;

export function toggleThemeMode(): AppTheme {
  const next: AppTheme = getStoredTheme() === 'dark' ? 'light' : 'dark';
  setStoredTheme(next);
  return next;
}

/**
 * Immediately synchronizes HTML classes and meta tags to prevent visual flash.
 */
export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
  }

  // Update theme-color meta tag for mobile browsers and PWA header
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'light' ? '#FFFFFF' : '#050607');
  }

  // Synchronize native Android status bar (top) and navigation bar (bottom) colors
  try {
    if (typeof window !== 'undefined') {
      const nativeBridge = (window as any).TradeVaultSystemBars;
      if (nativeBridge && typeof nativeBridge.setTheme === 'function') {
        nativeBridge.setTheme(theme);
      }
    }
  } catch {
    // Ignore bridge errors in standard web browsers
  }
}

/**
 * React hook to access and toggle theme across any component.
 */
export function useTheme() {
  const [theme, setCurrentThemeState] = useState<AppTheme>(() => getStoredTheme());

  useEffect(() => {
    applyThemeToDocument(getStoredTheme());

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<AppTheme>;
      setCurrentThemeState(customEvent.detail || getStoredTheme());
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        const nextTheme = e.newValue === 'light' ? 'light' : 'dark';
        setCurrentThemeState(nextTheme);
        applyThemeToDocument(nextTheme);
      }
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setStoredTheme(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    toggleThemeMode();
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    isLight: theme === 'light',
    setTheme,
    toggleTheme,
  };
}
