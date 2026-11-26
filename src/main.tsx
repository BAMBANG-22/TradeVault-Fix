import {createRoot} from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import App from './App.tsx';
import { APP_CHANGE_CODE } from './config/appVersion';
import './index.css';

if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  const SW_CACHE_VERSION_KEY = 'vlo_sw_purged_change_code_v2';
  const SW_RELOAD_GUARD_KEY = `vlo_sw_reloaded_once_${APP_CHANGE_CODE}`;
  const prevCode = (() => {
    try {
      return window.localStorage.getItem(SW_CACHE_VERSION_KEY);
    } catch {
      return null;
    }
  })();

  const hadController = Boolean(navigator.serviceWorker?.controller);
  const needsPurge = prevCode !== APP_CHANGE_CODE || hadController || import.meta.env.DEV;

  if (needsPurge) {
    try {
      window.localStorage.setItem(SW_CACHE_VERSION_KEY, APP_CHANGE_CODE);
    } catch {}

    const cleanupPromises: Promise<unknown>[] = [];
    if ('serviceWorker' in navigator) {
      cleanupPromises.push(
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)))
          )
          .catch(() => {})
      );
    }
    if ('caches' in window) {
      cleanupPromises.push(
        window.caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter(
                  (k) =>
                    k.includes('workbox') ||
                    k.includes('precache') ||
                    k.includes('ocr') ||
                    k.includes('vlo-')
                )
                .map((k) => window.caches.delete(k).catch(() => false))
            )
          )
          .catch(() => {})
      );
    }
    // Remove legacy tesseract.js IndexedDB cache ('keyval-store') left over from v1.3.0-v1.3.1
    if (prevCode !== APP_CHANGE_CODE && typeof window.indexedDB !== 'undefined') {
      cleanupPromises.push(
        new Promise<void>((resolve) => {
          try {
            const req = window.indexedDB.deleteDatabase('keyval-store');
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          } catch {
            resolve();
          }
        })
      );
    }

    // Critical fix: reload whenever an old SW was actively controlling the page (even if prevCode was null
    // when upgrading directly from v1.3.0-v1.3.2), protected by a one-shot sessionStorage guard.
    const alreadyReloaded = (() => {
      try {
        return window.sessionStorage.getItem(SW_RELOAD_GUARD_KEY) === '1';
      } catch {
        return false;
      }
    })();

    if (hadController && !alreadyReloaded && !import.meta.env.DEV) {
      try {
        window.sessionStorage.setItem(SW_RELOAD_GUARD_KEY, '1');
      } catch {}
      Promise.all(cleanupPromises).finally(() => {
        window.location.reload();
      });
    }
  }
}

createRoot(document.getElementById('root')!).render(<App />);
